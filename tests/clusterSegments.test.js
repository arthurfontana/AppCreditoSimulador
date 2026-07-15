import { describe, it, expect } from 'vitest';
import { buildColumnar } from '../src/columnar.js';
import {
  computeClusterSegments,
  clampClusterParamsForBrowser,
  clusterSeedOf,
  clusterMulberry32,
  resolveScopeRowMask,
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

// ── GATE FR1 — Clusterização Contextual (escopo por nó, DEC-FR-001) ──────────────
// A máscara filtra as linhas cujo roteamento REAL passa pelo nó ANTES da agregação; o
// resto do motor (features, z-score, k-means, tetos) é o MESMO. Casos: (1) escopo ≡
// sub-base filtrada à mão (mesma seed ⇒ número a número), (2) scope=null byte-idêntico
// ao atual, (3) escopo vazio ⇒ no_rows com scope, (4) determinismo escopado. O caso (5)
// — tests/segmentDiscovery.test.js inalterado após a extração de buildScopeWalk — é
// coberto pela própria suíte daquele arquivo.
describe('clusterSegments · escopo por nó (DEC-FR-001)', () => {
  // D1(GRP): A → pA → ❌ Reprovado ; B → pB → ✅ Aprovado. Escopo pA ⇒ só GRP=A.
  // pZ é uma porta inalcançável (nenhuma linha chega) — caso de escopo vazio.
  const shapes = [
    { id: 'D1', type: 'decision', label: 'Grupo', variableCol: 'GRP', csvId: 'b' },
    { id: 'pA', type: 'port', label: 'Porte A' },
    { id: 'pB', type: 'port', label: 'Porte B' },
    { id: 'pZ', type: 'port', label: 'Porte Z' },
    { id: 'REJ', type: 'rejected', label: 'Reprovado' },
    { id: 'AP', type: 'approved', label: 'Aprovado' },
  ];
  const conns = [
    { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
    { id: 'c2', from: 'pA', to: 'REJ' },
    { id: 'c3', from: 'D1', to: 'pB', label: 'B' },
    { id: 'c4', from: 'pB', to: 'AP' },
  ];
  const headers = ['GRP', 'SEG', '__DECISAO_ORIGINAL', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'];
  const columnTypes = {
    GRP: 'decision', SEG: 'decision', qty: 'qty', qtdAltas: 'qtdAltas',
    qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida',
  };
  // GRP=A: dois perfis plantados em SEG (s1/s2 baixo risco, s3/s4 alto risco).
  // GRP=B: perfil intermediário — se vazasse pro escopo, mudaria a partição.
  const mk = (grp, seg, dec, qty, altas, inadR) =>
    [grp, seg, dec, String(qty), String(altas), String(altas), String(inadR), String(inadR)];
  const rows = [
    mk('A', 's1', 'APROVADO', 800, 700, 14), mk('A', 's1', 'REPROVADO', 200, 0, 0),
    mk('A', 's2', 'APROVADO', 820, 720, 15), mk('A', 's2', 'REPROVADO', 180, 0, 0),
    mk('A', 's3', 'APROVADO', 300, 280, 140), mk('A', 's3', 'REPROVADO', 700, 0, 0),
    mk('A', 's4', 'APROVADO', 320, 300, 150), mk('A', 's4', 'REPROVADO', 680, 0, 0),
    mk('B', 'b1', 'APROVADO', 500, 450, 90), mk('B', 'b1', 'REPROVADO', 500, 0, 0),
    mk('B', 'b2', 'APROVADO', 600, 500, 250), mk('B', 'b2', 'REPROVADO', 400, 0, 0),
  ];
  const store = { b: { headers, columnTypes, rows } };
  const params = { csvId: 'b', dims: ['SEG'], k: 2 };
  const SEED = 12345;

  it('(1) escopo por nó ≡ sub-base filtrada à mão (mesma seed ⇒ número a número)', () => {
    const scoped = computeClusterSegments(toColumnarStore(store), { ...params, seed: SEED },
      { shapes, conns, scope: { nodeId: 'pA' } });
    const subRows = rows.filter(r => r[0] === 'A');
    const sub = computeClusterSegments(
      toColumnarStore({ b: { headers, columnTypes, rows: subRows } }), { ...params, seed: SEED });
    expect(scoped.error).toBe(null);
    expect(scoped.clusters).toHaveLength(2);
    // Partição, perfis, qualidade, features e params idênticos à sub-base (mesmo seed).
    expect(scoped.clusters).toEqual(sub.clusters);
    expect(scoped.population).toEqual(sub.population);
    expect(scoped.quality).toEqual(sub.quality);
    expect(scoped.features).toEqual(sub.features);
    expect(scoped.params).toEqual(sub.params);
    // População do escopo = só GRP=A.
    expect(scoped.population.qty).toBe(subRows.reduce((s, r) => s + Number(r[3]), 0));
    // model.scope preenchido (aditivo); a sub-base global não carrega o campo.
    expect(scoped.scope).toEqual({ nodeId: 'pA', label: 'Porte A' });
    expect('scope' in sub).toBe(false);
  });

  it('(1b) resolveScopeRowMask marca só as linhas que chegam ao nó', () => {
    const m = resolveScopeRowMask(shapes, conns, toColumnarStore(store), 'pA').b;
    expect([...m].reduce((s, v) => s + v, 0)).toBe(8);       // 8 linhas GRP=A
    expect([...m.slice(0, 8)]).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect([...m.slice(8)]).toEqual([0, 0, 0, 0]);           // 4 linhas GRP=B fora
    // scopeNodeId null ⇒ máscara cheia (todas pertencem).
    const full = resolveScopeRowMask(shapes, conns, toColumnarStore(store), null).b;
    expect([...full].reduce((s, v) => s + v, 0)).toBe(12);
  });

  it('(2) scope=null ⇒ byte-idêntico ao atual (sem campo scope, seed sem escopo)', () => {
    const plain = stripTime(computeClusterSegments(toColumnarStore(store), params));
    const nullCtx = stripTime(computeClusterSegments(toColumnarStore(store), params, null));
    const nullScope = stripTime(computeClusterSegments(toColumnarStore(store), params, { shapes, conns, scope: null }));
    expect(nullCtx).toEqual(plain);
    expect(nullScope).toEqual(plain);
    expect('scope' in plain).toBe(false);
    // Seed derivada = SEM componente de escopo (fórmula atual, fixtures douradas intactas).
    expect(plain.params.seed).toBe(clusterSeedOf('b', ['SEG'], 2, plain.params.features, 12));
  });

  it('seed escopada inclui o nó (difere da global) e é registrada', () => {
    const scoped = computeClusterSegments(toColumnarStore(store), params, { shapes, conns, scope: { nodeId: 'pA' } });
    const global = computeClusterSegments(toColumnarStore(store), params);
    expect(scoped.params.seed).not.toBe(global.params.seed);
    expect(scoped.params.seed).toBe(clusterSeedOf('b', ['SEG'], 2, scoped.params.features, 12, 'pA'));
  });

  it('(3) escopo vazio (nenhuma linha chega ao nó) ⇒ no_rows com scope preenchido', () => {
    const m = computeClusterSegments(toColumnarStore(store), params, { shapes, conns, scope: { nodeId: 'pZ' } });
    expect(m.error).toBe('no_rows');
    expect(m.scope).toEqual({ nodeId: 'pZ', label: 'Porte Z' });
  });

  it('(4) determinismo escopado: duas execuções ⇒ modelo idêntico e serializável', () => {
    const ctx = { shapes, conns, scope: { nodeId: 'pA' } };
    const a = stripTime(computeClusterSegments(toColumnarStore(store), params, ctx));
    const b = stripTime(computeClusterSegments(toColumnarStore(store), params, ctx));
    expect(b).toEqual(a);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    // Caminho legado string[][] produz o MESMO modelo escopado.
    const legacy = stripTime(computeClusterSegments(store, params, ctx));
    expect(JSON.parse(JSON.stringify(legacy))).toEqual(JSON.parse(JSON.stringify(a)));
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
