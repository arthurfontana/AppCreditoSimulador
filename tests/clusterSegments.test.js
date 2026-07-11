import { describe, it, expect } from 'vitest';
import { buildColumnar } from '../src/columnar.js';
import {
  computeClusterSegments,
  clampClusterParamsForBrowser,
  clusterSeedOf,
  clusterMulberry32,
} from '../src/simulation.worker.js';
import { clusterGoldenFixtures } from './fixtures/clusterFixtures.js';

// ── GATE numérico do baseline browser — Execução Híbrida H8 ─────────────────────
// Clusterização de Segmentos (k-means Lloyd + init k-means++ sobre mulberry32, seed
// derivada de dataset + params): fixture sintética de clusters PLANTADOS ⇒ o baseline
// recupera exatamente a partição; perfil por cluster ≡ agregação manual; determinismo;
// tetos declarados (clamp + truncamento de pontos); degradação de features declarada.
// A paridade cross-runtime (mesmo modelo no motor numpy) é o GATE dourado ao lado
// (tests/clusterSegmentsGolden.test.js + tests_python/test_cluster_segments.py).

const toColumnarStore = (store) => Object.fromEntries(
  Object.entries(store).map(([id, csv]) => [id, {
    name: id,
    headers: csv.headers,
    columnTypes: csv.columnTypes,
    ...buildColumnar(csv.headers, csv.rows, csv.columnTypes),
  }])
);

const fixtureByName = (name) => clusterGoldenFixtures.find(f => f.name === name);
const stripTime = (m) => ({ ...m, generatedAt: null });

// Mapa valor→id de cluster a partir do modelo (cada valor de dim aparece nos
// values do cluster que contém seus grupos).
const clusterOfValue = (model, dimCol) => {
  const map = new Map();
  for (const c of model.clusters) {
    const dm = c.dims.find(d => d.col === dimCol);
    for (const v of (dm?.values || [])) map.set(v.value, c.id);
  }
  return map;
};

describe('clusterSegments · clusters plantados são recuperados', () => {
  it('planted_1d: k=3 separa exatamente os 3 perfis plantados', () => {
    const fx = fixtureByName('planted_1d');
    const model = computeClusterSegments(toColumnarStore(fx.store), fx.params);
    expect(model.error).toBe(null);
    expect(model.clusters).toHaveLength(3);
    const of = clusterOfValue(model, 'SEGMENTO');
    const groupsOf = (vals) => new Set(vals.map(v => of.get(v)));
    // Cada perfil plantado cai inteiro num único cluster, e perfis distintos em
    // clusters distintos.
    const a = groupsOf(['S1', 'S2', 'S3']);
    const b = groupsOf(['S4', 'S5', 'S6']);
    const c = groupsOf(['S7', 'S8', 'S9']);
    expect(a.size).toBe(1);
    expect(b.size).toBe(1);
    expect(c.size).toBe(1);
    expect(new Set([...a, ...b, ...c]).size).toBe(3);
    // Ordenação declarada: clusters por volume desc (A=3000 > B=2400 > C=1800).
    expect(model.clusters.map(cl => cl.qty)).toEqual([3000, 2400, 1800]);
    expect(model.clusters.map(cl => cl.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('planted_2d_mix: k=2 separa R1 (baixo risco) do resto, com mix por cluster', () => {
    const fx = fixtureByName('planted_2d_mix');
    const model = computeClusterSegments(toColumnarStore(fx.store), fx.params);
    expect(model.clusters).toHaveLength(2);
    const of = clusterOfValue(model, 'REGIAO');
    expect(of.get('R1')).not.toBe(of.get('R2'));
    expect(of.get('R2')).toBe(of.get('R3'));
    // Mix presente e consistente: soma dos qty do mix == qty do cluster.
    for (const cl of model.clusters) {
      expect(cl.mix).not.toBe(null);
      const sum = cl.mix.reduce((s, m) => s + m.qty, 0);
      expect(sum).toBeCloseTo(cl.qty, 9);
    }
    // O cluster de R1 é 100% mix Baixo (plantado assim).
    const r1Cluster = model.clusters.find(cl => cl.id === of.get('R1'));
    expect(r1Cluster.mix).toHaveLength(1);
    expect(r1Cluster.mix[0].value).toBe('Baixo');
  });
});

describe('clusterSegments · perfil por cluster ≡ agregação manual', () => {
  it('planted_1d: qty/aprovação/inadReal batem com a soma manual das linhas', () => {
    const fx = fixtureByName('planted_1d');
    const model = computeClusterSegments(toColumnarStore(fx.store), fx.params);
    const of = clusterOfValue(model, 'SEGMENTO');
    // Agrega as linhas da fixture manualmente por cluster.
    const acc = new Map();
    for (const [seg, dec, qty, altas, , inadR] of fx.store.clu.rows) {
      const cid = of.get(seg);
      let a = acc.get(cid);
      if (!a) { a = { qty: 0, appr: 0, decided: 0, altas: 0, inadR: 0 }; acc.set(cid, a); }
      a.qty += Number(qty);
      a.altas += Number(altas);
      a.inadR += Number(inadR);
      if (dec === 'APROVADO') { a.appr += Number(qty); a.decided += Number(qty); }
      else if (dec === 'REPROVADO') a.decided += Number(qty);
    }
    for (const cl of model.clusters) {
      const a = acc.get(cl.id);
      expect(cl.qty).toBe(a.qty);
      expect(cl.decidedQty).toBe(a.decided);
      expect(cl.approvalRate).toBe(a.appr / a.decided);
      expect(cl.inadReal).toBe(a.inadR / a.altas);
    }
    // População do escopo = soma de tudo.
    expect(model.population.qty).toBe(fx.store.clu.rows.reduce((s, r) => s + Number(r[2]), 0));
  });

  it('centroides são as taxas médias ponderadas des-padronizadas (finitas, na escala original)', () => {
    const fx = fixtureByName('planted_1d');
    const model = computeClusterSegments(toColumnarStore(fx.store), fx.params);
    for (const cl of model.clusters) {
      for (const fid of model.params.features) {
        expect(Number.isFinite(cl.centroid[fid])).toBe(true);
        expect(cl.centroid[fid]).toBeGreaterThanOrEqual(-1e-9);
        expect(cl.centroid[fid]).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
    // Qualidade: partição plantada explica quase toda a variância.
    expect(model.quality.converged).toBe(true);
    expect(model.quality.explainedVariance).toBeGreaterThan(0.9);
    expect(model.quality.silhouette).toBe(null); // extra sklearn — nunca no baseline
  });
});

describe('clusterSegments · determinismo e paridade colunar × legado', () => {
  for (const fx of clusterGoldenFixtures) {
    it(`fixture "${fx.name}": mesma entrada ⇒ mesmo modelo; legado ≡ colunar`, () => {
      const colStore = toColumnarStore(fx.store);
      const a = stripTime(computeClusterSegments(colStore, fx.params));
      const b = stripTime(computeClusterSegments(colStore, fx.params));
      expect(b).toEqual(a);
      // Caminho legado string[][] (fallback por-linha) produz o MESMO modelo.
      const legacy = stripTime(computeClusterSegments(fx.store, fx.params));
      expect(JSON.parse(JSON.stringify(legacy))).toEqual(JSON.parse(JSON.stringify(a)));
      // Serializável (viaja como JSON puro pelo fio — mesmo contrato do SegmentModel).
      expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    });
  }

  it('seed explícita é respeitada; seed derivada é estável e registrada no modelo', () => {
    const fx = fixtureByName('planted_1d');
    const colStore = toColumnarStore(fx.store);
    const m1 = computeClusterSegments(colStore, { ...fx.params, seed: 42 });
    expect(m1.params.seed).toBe(42);
    const m2 = computeClusterSegments(colStore, fx.params);
    expect(m2.params.seed).toBe(
      clusterSeedOf('clu', ['SEGMENTO'], 3, m2.params.features, 18));
  });

  it('mulberry32: sequência especificada, determinística e em [0,1)', () => {
    const r1 = clusterMulberry32(123456789);
    const r2 = clusterMulberry32(123456789);
    const seq1 = [r1(), r1(), r1(), r1()];
    const seq2 = [r2(), r2(), r2(), r2()];
    expect(seq1).toEqual(seq2);
    for (const v of seq1) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
    expect(new Set(seq1).size).toBe(4);
  });
});

describe('clusterSegments · tetos declarados do browser (paridade total, P4)', () => {
  it('clampClusterParamsForBrowser: dims ≤ 3, k ≤ 8, maxPoints imposto, extras desligados', () => {
    expect(clampClusterParamsForBrowser({
      dims: ['A', 'B', 'C', 'D', 'E'], k: 16, autoK: true, method: 'hierarchical',
    })).toEqual({ dims: ['A', 'B', 'C'], k: 8, maxPoints: 2000, autoK: false, method: 'kmeans' });
    // Dentro dos tetos: só o maxPoints default é imposto; o resto fica intocado.
    expect(clampClusterParamsForBrowser({ dims: ['A'], k: 4, method: 'kmeans' }))
      .toEqual({ dims: ['A'], k: 4, method: 'kmeans', maxPoints: 2000 });
  });

  it('truncated: maxPoints mantém os maiores grupos por volume e DECLARA o corte', () => {
    const fx = fixtureByName('truncated');
    const model = computeClusterSegments(toColumnarStore(fx.store), fx.params);
    expect(model.ceilings).toEqual({
      pointsTruncated: true, totalGroups: 6, keptGroups: 4,
      // F1..F4 = 6000+5500+3000+2500 = 17000 de 17450 (F8=250, F9=200 caem)
      keptQtyShare: 17000 / 17450,
    });
    expect(model.population.points).toBe(4);
    expect(model.population.groupCount).toBe(6);
    expect(model.population.qty).toBe(17450); // população segue INTEIRA (o corte é só dos pontos)
    const kept = new Set(model.clusters.flatMap(c => c.dims[0].values.map(v => v.value)));
    expect(kept).toEqual(new Set(['F1', 'F2', 'F3', 'F4']));
  });

  it('no_asis: sem AS IS/inferida o vetor degrada para a única feature disponível', () => {
    const fx = fixtureByName('no_asis');
    const model = computeClusterSegments(toColumnarStore(fx.store), fx.params);
    expect(model.params.features).toEqual(['inadReal']);
    for (const cl of model.clusters) {
      expect(cl.approvalRate).toBe(null);
      expect(cl.inadInferida).toBe(null);
      expect(Number.isFinite(cl.centroid.inadReal)).toBe(true);
    }
    // G5 tem qtdAltas 0 ⇒ feature cai na taxa do escopo (nunca NaN no vetor).
    expect(model.clusters.some(cl => cl.dims[0].values.some(v => v.value === 'G5'))).toBe(true);
  });

  it('condições no formato LensRule (col/operator in/value/logic) por dimensão', () => {
    const fx = fixtureByName('planted_2d_mix');
    const model = computeClusterSegments(toColumnarStore(fx.store), fx.params);
    for (const cl of model.clusters) {
      expect(cl.conditions).toHaveLength(2);
      for (const cond of cl.conditions) {
        expect(['REGIAO', 'CANAL']).toContain(cond.col);
        expect(cond.operator).toBe('in');
        expect(cond.logic).toBe('AND');
        expect(typeof cond.value).toBe('string');
      }
    }
  });
});

describe('clusterSegments · degradação declarada (erros nunca silenciosos)', () => {
  it('store vazio ⇒ no_rows; sem dims válidas ⇒ no_dims; sem features ⇒ no_features', () => {
    expect(computeClusterSegments({}, { dims: ['X'] }).error).toBe('no_rows');
    const fx = fixtureByName('planted_1d');
    const colStore = toColumnarStore(fx.store);
    expect(computeClusterSegments(colStore, { dims: [] }).error).toBe('no_dims');
    // Coluna métrica não vale como dimensão (sem semântica de segmento).
    expect(computeClusterSegments(colStore, { dims: ['qty'] }).error).toBe('no_dims');
    // Base só com dimensões (nenhuma métrica/AS IS) ⇒ no_features.
    const bare = toColumnarStore({
      b: { headers: ['G'], columnTypes: { G: 'decision' }, rows: [['x'], ['y']] },
    });
    expect(computeClusterSegments(bare, { dims: ['G'] }).error).toBe('no_features');
  });
});
