import { describe, it, expect } from 'vitest';
import {
  computeSegmentDiscovery,
  discoverSegments,
  explainSegment,
  resolveRiskMetric,
  segBinomTwoSided,
  segBenjaminiHochberg,
  matchLensRule,
} from '../src/simulation.worker.js';

// ── GATE Copiloto Sessão 10 (Descoberta de Segmentos — DEC-SD-001..006) ──────────
// docs/wiki/Copiloto-DescobertaSegmentos.md. `computeSegmentDiscovery` é o motor de
// subgroup discovery: beam search de conjunções de LensRule sobre colunas Filtro, com
// explicação (WoE/lift/dispersão/binomial), rigor estatístico (FDR/shrinkage/dedup) e
// prioritização — tudo determinístico, agregação exata, SEM re-simulação nesta sessão.
//
// Fixtures em base legada (`rows: string[][]`) — o motor cai no caminho por-linha
// (fallback do M8), mesma matemática do caminho colunar.

// matchLensRule não é exportado do worker? é — usamos como oráculo de agregação manual.

const csvOf = (rows) => ({
  headers: ['SCORE', 'CANAL', 'qty', 'qtdAltas', 'inadReal'],
  columnTypes: { SCORE: 'decision', CANAL: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
  rows,
});

// Política "reprova tudo": um Decision Lens sem regras (passa 100%) → ❌ Reprovado. Serve
// de raiz do motor sem consumir nenhuma coluna candidata — todo segmento fica "hoje
// reprovado", cenário do achado approvable_low_risk.
const rejectAll = {
  shapes: [
    { id: 'L', type: 'decision_lens', label: 'Todos', rules: [] },
    { id: 'REJ', type: 'rejected', label: 'Reprovado' },
  ],
  conns: [{ id: 'c1', from: 'L', to: 'REJ' }],
};

// Agregação manual de controle via matchLensRule (o oráculo do épico).
function manualAgg(csv, conditions) {
  const cix = { qty: 2, qtdAltas: 3, inadReal: 4 };
  let qty = 0, qtdAltas = 0, inadReal = 0;
  for (const row of csv.rows) {
    const ok = conditions.every(c => matchLensRule(row[csv.headers.indexOf(c.col)], 'equal', c.value));
    if (!ok) continue;
    qty += +row[cix.qty]; qtdAltas += +row[cix.qtdAltas]; inadReal += +row[cix.inadReal];
  }
  return { qty, qtdAltas, inadReal, rate: qtdAltas > 0 ? inadReal / qtdAltas : null };
}

describe('segmentDiscovery · plantar e achar (interação 2D) + agregados exatos', () => {
  // Só a conjunção 2D desvia (marginais de SCORE e CANAL = 20% = global — padrão de
  // interação): R08×Digital e R05×Fisico têm inad 2% (baixo risco), tudo hoje reprovado.
  const csv = csvOf([
    ['R08', 'Digital', '1000', '1000', '20'],   // 2%
    ['R08', 'Fisico', '1000', '1000', '380'],   // 38%
    ['R05', 'Digital', '1000', '1000', '380'],  // 38%
    ['R05', 'Fisico', '1000', '1000', '20'],    // 2%
  ]);
  const store = { seg: csv };

  it('encontra o subgrupo plantado com as CONDIÇÕES EXATAS e code approvable_low_risk', () => {
    const m = computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, store, null, { minQty: 1 });
    const planted = m.findings.find(f => {
      const s = new Set(f.segment.conditions.map(c => `${c.col}=${c.value}`));
      return s.size === 2 && s.has('SCORE=R08') && s.has('CANAL=Digital');
    });
    expect(planted).toBeTruthy();
    expect(planted.code).toBe('approvable_low_risk');
    expect(planted.metrics.currentDecision).toBe('rejected');
  });

  it('agregados do achado ≡ agregação manual via matchLensRule', () => {
    const m = computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, store, null, { minQty: 1 });
    const planted = m.findings.find(f => f.segment.conditions.length === 2 &&
      f.segment.conditions.some(c => c.col === 'SCORE' && c.value === 'R08'));
    const ctrl = manualAgg(csv, [{ col: 'SCORE', value: 'R08' }, { col: 'CANAL', value: 'Digital' }]);
    expect(planted.metrics.qty).toBe(ctrl.qty);
    expect(planted.metrics.qtdAltas).toBe(ctrl.qtdAltas);
    expect(planted.metrics.inadReal).toBeCloseTo(ctrl.rate, 12);
  });

  it('lift ≡ segmento/complemento manual (referência = fora do segmento)', () => {
    const m = computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, store, null, { minQty: 1 });
    const planted = m.findings.find(f => f.segment.conditions.length === 2 &&
      f.segment.conditions.some(c => c.col === 'SCORE' && c.value === 'R08') &&
      f.segment.conditions.some(c => c.col === 'CANAL' && c.value === 'Digital'));
    // complemento = base − (R08×Digital): (380+380+20)/3000 = 780/3000 = 0.26
    const refRate = 780 / 3000;
    expect(planted.metrics.lift).toBeCloseTo(0.02 / refRate, 12);
  });

  it('marginais (lift=1) são contabilizados como notSignificant, não viram achado', () => {
    const m = computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, store, null, { minQty: 1 });
    expect(m.diagnostics.discarded.notSignificant).toBeGreaterThan(0);
    const has1D = m.findings.some(f => f.kind !== 'het' && f.segment.conditions.length === 1);
    expect(has1D).toBe(false);
  });
});

describe('segmentDiscovery · fixture homogênea ⇒ zero achados (controle negativo)', () => {
  const csv = csvOf([
    ['R08', 'Digital', '1000', '1000', '200'],
    ['R08', 'Fisico', '1000', '1000', '200'],
    ['R05', 'Digital', '1000', '1000', '200'],
    ['R05', 'Fisico', '1000', '1000', '200'],
  ]);
  it('nenhum segmento passa os filtros (sem desvio, sem heterogeneidade)', () => {
    const m = computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, { seg: csv }, null, { minQty: 1 });
    expect(m.findings.length).toBe(0);
    expect(m.diagnostics.candidatesTested).toBeGreaterThan(0);
  });
});

describe('segmentDiscovery · dispersão ≡ contagem manual por terminal (segmento em 2+ nós)', () => {
  // D1(GRP): A → ✅ Aprovado (decidido em D1); B → D2(GRP): B → ❌ Reprovado (decidido em D2).
  // O segmento SEG=X tem linhas em GRP=A (aprovado) e GRP=B (reprovado) — decidido em 2 nós.
  const shapes = [
    { id: 'D1', type: 'decision', label: 'G1', variableCol: 'GRP', csvId: 'b' },
    { id: 'pA', type: 'port', label: 'A' },
    { id: 'pB', type: 'port', label: 'B' },
    { id: 'AP', type: 'approved', label: 'Aprovado' },
    { id: 'D2', type: 'decision', label: 'G2', variableCol: 'GRP', csvId: 'b' },
    { id: 'pB2', type: 'port', label: 'B' },
    { id: 'REJ', type: 'rejected', label: 'Reprovado' },
  ];
  const conns = [
    { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
    { id: 'c2', from: 'pA', to: 'AP' },
    { id: 'c3', from: 'D1', to: 'pB', label: 'B' },
    { id: 'c4', from: 'pB', to: 'D2' },
    { id: 'c5', from: 'D2', to: 'pB2', label: 'B' },
    { id: 'c6', from: 'pB2', to: 'REJ' },
  ];
  const csv = {
    headers: ['GRP', 'SEG', 'qty', 'qtdAltas', 'inadReal'],
    columnTypes: { GRP: 'decision', SEG: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
    rows: [
      ['A', 'X', '300', '300', '30'],
      ['A', 'Y', '100', '100', '10'],
      ['B', 'X', '200', '200', '40'],
      ['B', 'Y', '100', '100', '10'],
    ],
  };
  it('nodesCount = 2 e shares por terminal batem com a contagem manual (qty)', () => {
    const disc = discoverSegments(shapes, conns, { b: csv }, null, resolveRiskMetric('inadReal'), { minQty: 1 });
    const cand = disc.candidates.find(c => c.conds.length === 1 && c.conds[0].col === 'SEG' && c.conds[0].value === 'X');
    expect(cand).toBeTruthy();
    const disp = explainSegment(cand, disc.ctx).explanation.dispersion;
    expect(disp.nodesCount).toBe(2);
    // SEG=X: A,X=300 aprovado; B,X=200 reprovado → total 500.
    const approved = disp.terminals.find(t => t.terminal === 'approved');
    const rejected = disp.terminals.find(t => t.terminal === 'rejected');
    expect(approved.qty).toBe(300);
    expect(rejected.qty).toBe(200);
    expect(approved.sharePct).toBeCloseTo(60, 10);
    expect(rejected.sharePct).toBeCloseTo(40, 10);
    expect(disp.currentDecision).toBe('mixed');
  });
});

describe('segmentDiscovery · teste binomial bate com controle manual + FDR', () => {
  it('segBinomTwoSided(2,10,0.5) = 0.109375 (dobro da menor cauda, exato)', () => {
    // P(X≤2)=(1+10+45)/1024=0.0546875; P(X≥2)=1−(1+10)/1024=0.98926 → 2·min=0.109375
    expect(segBinomTwoSided(2, 10, 0.5)).toBeCloseTo(0.109375, 12);
  });

  it('p-value do achado ≡ segBinomTwoSided(segNum, segDen, refRate) recomputado', () => {
    const csv = csvOf([
      ['R08', 'Digital', '10', '10', '0'],    // segmento pequeno, 0 maus
      ['R08', 'Fisico', '100', '100', '30'],
      ['R05', 'Digital', '100', '100', '30'],
      ['R05', 'Fisico', '100', '100', '30'],
    ]);
    const disc = discoverSegments(rejectAll.shapes, rejectAll.conns, { seg: csv }, null, resolveRiskMetric('inadReal'), { minQty: 1 });
    const cand = disc.candidates.find(c => c.conds.length === 2 &&
      c.conds.some(x => x.value === 'R08') && c.conds.some(x => x.value === 'Digital'));
    const ex = explainSegment(cand, disc.ctx);
    // complemento de R08×Digital: (30+30+30)/300 = 0.3 ; segNum=0, segDen=10
    const control = segBinomTwoSided(0, 10, 90 / 300);
    expect(ex.explanation.pValue).toBeCloseTo(control, 12);
    expect(control).toBeCloseTo(2 * Math.pow(1 - 0.3, 10), 12); // P(X≥0)=1 → 2·P(X≤0)
  });

  it('Benjamini–Hochberg: q-values monótonos, ruído descartado', () => {
    const q = segBenjaminiHochberg([0.001, 0.04, 0.04, 0.04, 0.5]);
    expect(q).toEqual([0.005, 0.05, 0.05, 0.05, 0.5]);
    // com alpha 0.05, os quatro primeiros sobrevivem; o 0.5 (ruído) é descartado.
    expect(q.filter(x => x <= 0.05).length).toBe(4);
  });
});

describe('segmentDiscovery · shrinkage rebaixa nicho minúsculo abaixo do achado real', () => {
  // Achado real: BIG com muito volume e inad baixa; nicho: SMALL, ínfimo volume, inad 0.
  const csv = {
    headers: ['SEG', 'qty', 'qtdAltas', 'inadReal'],
    columnTypes: { SEG: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
    rows: [
      ['BIG', '1000', '1000', '10'],     // 1%
      ['SMALL', '30', '30', '0'],        // 0%, nicho minúsculo
      ['REST1', '1000', '1000', '200'],  // 20% (referência alta)
      ['REST2', '1000', '1000', '200'],  // 20%
    ],
  };
  it('o achado real fica acima do nicho, e a confiança do nicho é menor (shrinkage)', () => {
    const m = computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, { seg: csv }, null, { minQty: 1 });
    const big = m.findings.find(f => f.segment.conditions.some(c => c.value === 'BIG'));
    const small = m.findings.find(f => f.segment.conditions.some(c => c.value === 'SMALL'));
    expect(big).toBeTruthy();
    expect(small).toBeTruthy(); // o nicho é significativo, mas rebaixado — não sumiu
    expect(big.priority.score).toBeGreaterThan(small.priority.score);
    expect(small.priority.confidence).toBeLessThan(big.priority.confidence);
    // o achado real vem primeiro na ordenação por prioridade
    expect(m.findings.findIndex(f => f === big)).toBeLessThan(m.findings.findIndex(f => f === small));
  });
});

describe('segmentDiscovery · escopo por nó ≡ sub-base filtrada manualmente', () => {
  // D1(GRP): A → pA → ❌ Reprovado ; B → pB → ✅ Aprovado. Escopo = pA ⇒ só GRP=A.
  const shapes = [
    { id: 'D1', type: 'decision', label: 'G', variableCol: 'GRP', csvId: 'b' },
    { id: 'pA', type: 'port', label: 'A' },
    { id: 'pB', type: 'port', label: 'B' },
    { id: 'REJ', type: 'rejected', label: 'Reprovado' },
    { id: 'AP', type: 'approved', label: 'Aprovado' },
  ];
  const conns = [
    { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
    { id: 'c2', from: 'pA', to: 'REJ' },
    { id: 'c3', from: 'D1', to: 'pB', label: 'B' },
    { id: 'c4', from: 'pB', to: 'AP' },
  ];
  const full = {
    headers: ['GRP', 'SEG', 'qty', 'qtdAltas', 'inadReal'],
    columnTypes: { GRP: 'decision', SEG: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
    rows: [
      ['A', 'X', '300', '300', '6'],
      ['A', 'Y', '200', '200', '40'],
      ['B', 'X', '500', '500', '100'],  // GRP=B: fora do escopo pA
      ['B', 'Y', '500', '500', '100'],
    ],
  };
  const spec = resolveRiskMetric('inadReal');

  it('população do escopo por nó = soma manual das linhas GRP=A', () => {
    const disc = discoverSegments(shapes, conns, { b: full }, { nodeId: 'pA' }, spec, { minQty: 1 });
    expect(disc.population.qty).toBe(500); // 300 + 200
  });

  it('agregado de um candidato no escopo ≡ sub-base (GRP=A) filtrada à mão', () => {
    const disc = discoverSegments(shapes, conns, { b: full }, { nodeId: 'pA' }, spec, { minQty: 1 });
    const cand = disc.candidates.find(c => c.conds.length === 1 && c.conds[0].col === 'SEG' && c.conds[0].value === 'X');
    const ctrl = manualAgg({ ...full, headers: full.headers }, [{ col: 'GRP', value: 'A' }, { col: 'SEG', value: 'X' }]);
    expect(cand.agg.qty).toBe(ctrl.qty);
    expect(cand.agg.qtdAltas).toBe(ctrl.qtdAltas);
    expect(cand.agg.inadReal).toBe(ctrl.inadReal);
  });

  it('escopo por nó ≡ descoberta global sobre a sub-base contendo só GRP=A', () => {
    const subRows = full.rows.filter(r => r[0] === 'A');
    const sub = { ...full, rows: subRows };
    const byNode = discoverSegments(shapes, conns, { b: full }, { nodeId: 'pA' }, spec, { minQty: 1 });
    const byFilter = discoverSegments(rejectAll.shapes, rejectAll.conns, { b: sub }, null, spec, { minQty: 1 });
    expect(byNode.population.qty).toBe(byFilter.population.qty);
    const pick = (d, val) => d.candidates.find(c => c.conds.length === 1 && c.conds[0].col === 'SEG' && c.conds[0].value === val);
    for (const val of ['X', 'Y']) {
      expect(pick(byNode, val).agg.qtdAltas).toBe(pick(byFilter, val).agg.qtdAltas);
      expect(pick(byNode, val).agg.inadReal).toBe(pick(byFilter, val).agg.inadReal);
    }
  });
});

describe('segmentDiscovery · dedup de segmento aninhado sem ganho incremental', () => {
  // A inad depende SÓ de P; Q é irrelevante. P=v (aprovável) é reportado; o filho
  // P=v & Q=w tem a MESMA taxa (Q não separa nada) → deduplicado.
  const csv = {
    headers: ['P', 'Q', 'qty', 'qtdAltas', 'inadReal'],
    columnTypes: { P: 'decision', Q: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
    rows: [
      ['v', 'w', '500', '500', '10'],       // 2%
      ['v', 'z', '500', '500', '10'],       // 2%
      ['other', 'w', '500', '500', '100'],  // 20%
      ['other', 'z', '500', '500', '100'],  // 20%
    ],
  };
  it('o pai P=v é achado; o filho P=v & Q=* some (duplicate contabilizado)', () => {
    const m = computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, { seg: csv }, null, { minQty: 1 });
    const dev = m.findings.filter(f => f.kind !== 'het');
    const parent = dev.find(f => f.segment.conditions.length === 1 && f.segment.conditions[0].col === 'P' && f.segment.conditions[0].value === 'v');
    expect(parent).toBeTruthy();
    expect(parent.code).toBe('approvable_low_risk');
    const nestedChildren = dev.filter(f => f.segment.conditions.length === 2 &&
      f.segment.conditions.some(c => c.col === 'P' && c.value === 'v'));
    expect(nestedChildren.length).toBe(0);
    expect(m.diagnostics.discarded.duplicate).toBeGreaterThan(0);
  });
});

describe('segmentDiscovery · heterogeneous_block e determinismo', () => {
  it('bloco de tratamento único, internamente heterogêneo ⇒ heterogeneous_block com a variável que separa', () => {
    // Toda a base é reprovada (tratamento único), mas SCORE separa fortemente a inad.
    const csv = csvOf([
      ['R08', 'Digital', '1000', '1000', '20'],
      ['R08', 'Fisico', '1000', '1000', '20'],
      ['R05', 'Digital', '1000', '1000', '400'],
      ['R05', 'Fisico', '1000', '1000', '400'],
    ]);
    const m = computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, { seg: csv }, null, { minQty: 1 });
    const het = m.findings.find(f => f.code === 'heterogeneous_block');
    expect(het).toBeTruthy();
    expect(het.explanation.contributions[0].col).toBe('SCORE'); // a que mais separa
    expect(het.metrics.currentDecision).toBe('rejected');
  });

  it('determinismo: mesma entrada ⇒ mesmo SegmentModel (módulo generatedAt)', () => {
    const csv = csvOf([
      ['R08', 'Digital', '1000', '1000', '20'],
      ['R08', 'Fisico', '1000', '1000', '380'],
      ['R05', 'Digital', '1000', '1000', '380'],
      ['R05', 'Fisico', '1000', '1000', '20'],
    ]);
    const a = computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, { seg: csv }, null, { minQty: 1 });
    const b = computeSegmentDiscovery(rejectAll.shapes, rejectAll.conns, { seg: csv }, null, { minQty: 1 });
    const strip = (m) => ({ ...m, generatedAt: null });
    expect(strip(a)).toEqual(strip(b));
  });
});
