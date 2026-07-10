import { describe, it, expect } from 'vitest';
import {
  computeSegmentDiscovery,
  computeSegmentDiscoveryPooled,
  computeSegmentCombined,
  computeSegmentCombinedPooled,
  segValidateMoves,
} from '../src/simulation.worker.js';

// ── GATE Execução Híbrida Sessão H3 (pool de workers) ───────────────────────────────
// docs/wiki/Arquitetura-Execucao-Hibrida.md §7.2 e §14. O pool sharda POR CANDIDATO as
// cargas embaraçosamente paralelas (validação por re-simulação dos top-N da Descoberta e as
// N re-simulações INDIVIDUAIS da aplicação combinada). Em Node/jsdom não há Worker real, então
// o GATE prova a ORQUESTRAÇÃO (shard, coleta fora de ordem, re-ordenação determinística por id,
// fallback) injetando um POOL MOCK que roda cada job inline via `segValidateMoves` — a MESMA
// unidade de shard do worker real — mas resolve FORA DE ORDEM. Provado:
//   1. pool ≡ single-worker número a número (Descoberta e Combinada);
//   2. determinismo em execuções repetidas (e sob ordens de conclusão diferentes);
//   3. fallback transparente (pool === null ⇒ idêntico ao caminho síncrono).

const csvOf = (rows) => ({
  headers: ['SCORE', 'CANAL', 'qty', 'qtdAltas', 'inadReal'],
  columnTypes: { SCORE: 'decision', CANAL: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
  rows,
});

// Política "reprova tudo" (mesma raiz de segmentDiscovery.test.js): todo segmento fica hoje
// reprovado ⇒ vários achados approvable_low_risk acionáveis (⇒ vários jobs de validação).
const rejectAll = {
  shapes: [
    { id: 'L', type: 'decision_lens', label: 'Todos', rules: [] },
    { id: 'REJ', type: 'rejected', label: 'Reprovado' },
  ],
  conns: [{ id: 'c1', from: 'L', to: 'REJ' }],
};

// Base com vários valores acionáveis (para gerar >1 job) e um overlap (R08 × Digital baixos).
const csv = csvOf([
  ['R08', 'Digital', '1000', '1000', '20'],   // 2%
  ['R08', 'Fisico', '1000', '1000', '20'],    // 2%
  ['R05', 'Digital', '1000', '1000', '20'],   // 2%
  ['R05', 'Fisico', '1000', '1000', '400'],   // 40%
  ['R02', 'Digital', '1000', '1000', '30'],   // 3%
  ['R02', 'Fisico', '1000', '1000', '35'],    // 3.5%
]);
const store = { seg: csv };

// Pool MOCK: implementa a mesma interface do pool real (`runValidationJobs(shapes, conns, jobs)`
// → Promise<Map(id → {snapshot}|{error})>`), rodando cada job inline via `segValidateMoves`, mas
// resolvendo FORA DE ORDEM (ordem de conclusão embaralhada) para provar a re-ordenação por id.
function makeMockPool(csvStore, order = 'reverse') {
  return {
    runValidationJobs(shapes, conns, jobs) {
      const idxs = jobs.map((_, i) => i);
      if (order === 'reverse') idxs.reverse();
      else if (order === 'shuffle') idxs.sort((a, b) => ((a * 7 + 3) % jobs.length) - ((b * 7 + 3) % jobs.length));
      const map = new Map();
      // Cada job vira uma microtask que resolve na ordem embaralhada; o resultado só é lido por
      // id depois de TODOS terminarem — a ordem de conclusão não pode influenciar o resultado.
      return Promise.all(idxs.map((i) => Promise.resolve().then(() => {
        const j = jobs[i];
        map.set(j.id, { snapshot: segValidateMoves(shapes, conns, csvStore, j.moves) });
      }))).then(() => map);
    },
  };
}

// Remove o carimbo de tempo (única diferença legítima entre duas gerações).
const stripTs = (m) => { const c = JSON.parse(JSON.stringify(m)); delete c.generatedAt; return c; };

describe('H3 · Descoberta: pool ≡ single-worker (número a número) + determinismo', () => {
  it('recomendações/deltas validados são idênticos entre o síncrono e o pooled (mock)', async () => {
    const sync = computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, store, null, { minQty: 1 });
    const pooled = await computeSegmentDiscoveryPooled(
      rejectAll.shapes, rejectAll.conns, store, null, { minQty: 1 }, makeMockPool(store, 'reverse'));

    // Deve haver mais de uma validação em jogo (senão não estaríamos testando o sharding).
    const validated = sync.findings.filter(f => f.recommendation && f.recommendation.delta).length;
    expect(validated).toBeGreaterThan(1);

    expect(stripTs(pooled)).toEqual(stripTs(sync));
  });

  it('pool === null ⇒ fallback inline idêntico ao síncrono', async () => {
    const sync = computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, store, null, { minQty: 1 });
    const fallback = await computeSegmentDiscoveryPooled(
      rejectAll.shapes, rejectAll.conns, store, null, { minQty: 1 }, null);
    expect(stripTs(fallback)).toEqual(stripTs(sync));
  });

  it('determinístico sob ordens de conclusão diferentes (reverse ≡ shuffle ≡ síncrono)', async () => {
    const sync = stripTs(computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, store, null, { minQty: 1 }));
    const rev = stripTs(await computeSegmentDiscoveryPooled(rejectAll.shapes, rejectAll.conns, store, null, { minQty: 1 }, makeMockPool(store, 'reverse')));
    const shuf = stripTs(await computeSegmentDiscoveryPooled(rejectAll.shapes, rejectAll.conns, store, null, { minQty: 1 }, makeMockPool(store, 'shuffle')));
    expect(rev).toEqual(sync);
    expect(shuf).toEqual(sync);
    expect(rev).toEqual(shuf);
  });
});

describe('H3 · Aplicação combinada: individuais no pool, combinada única inline', () => {
  it('pooled ≡ síncrono número a número (somas, combinado e interação)', async () => {
    const m = computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, store, null, { minQty: 1 });
    const a = m.findings.find(f => f.code === 'approvable_low_risk' && f.segment.conditions.length === 1 && f.segment.conditions[0].value === 'R08');
    const b = m.findings.find(f => f.code === 'approvable_low_risk' && f.segment.conditions.length === 1 && f.segment.conditions[0].value === 'Digital');
    expect(a && b).toBeTruthy();
    const applies = [a.recommendation.apply, b.recommendation.apply];

    const sync = computeSegmentCombined(rejectAll.shapes, rejectAll.conns, store, applies);
    const pooled = await computeSegmentCombinedPooled(rejectAll.shapes, rejectAll.conns, store, applies, makeMockPool(store, 'reverse'));
    const fallback = await computeSegmentCombinedPooled(rejectAll.shapes, rejectAll.conns, store, applies, null);

    expect(pooled).toEqual(sync);
    expect(fallback).toEqual(sync);
    // O overlap DEVE ser real (senão a paralelização dos individuais não muda nada de risco).
    expect(sync.sumMovedQty).not.toBe(sync.combinedMovedQty);
    expect(sync.interaction.interacts).toBe(true);
  });

  it('determinístico: duas execuções pooled são idênticas', async () => {
    const m = computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, store, null, { minQty: 1 });
    const applies = m.findings.filter(f => f.recommendation && f.recommendation.actionable).slice(0, 3).map(f => f.recommendation.apply);
    const p1 = await computeSegmentCombinedPooled(rejectAll.shapes, rejectAll.conns, store, applies, makeMockPool(store, 'reverse'));
    const p2 = await computeSegmentCombinedPooled(rejectAll.shapes, rejectAll.conns, store, applies, makeMockPool(store, 'shuffle'));
    expect(p1).toEqual(p2);
  });
});
