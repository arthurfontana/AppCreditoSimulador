import { describe, it, expect } from 'vitest';
import { buildColumnar, deriveClusterColumn, rowCount, serializeCsvStore, deserializeCsvStore } from '../src/columnar.js';
import { computeClusterSegments } from '../src/simulation.worker.js';
import {
  suggestClusterVarName, suggestClusterLabels, buildClusterDefFromModel,
  isClusterVar, describeClusterRules, renameClusterGroup, moveValueToGroup,
  toggleValueInGroup, clusterMembershipTable, renameClusterColumnRefs,
  renameClusterLabelRefs, uniqueName,
} from '../src/clusterVar.js';

// ── GATE — Variável de Cluster (interpretação da Clusterização H8) ───────────────
// A materialização (deriveClusterColumn) é first-match-wins por faixas de valor:
// exato para 1 dimensão, bounding box editável para 2+. Aqui: correção da
// materialização (1D exata, 2D first-match/overlap, trim, fora dos grupos), sugestões
// de nome únicas, redação de regras para docs, operações de edição e propagação de
// referências no canvas + round-trip de persistência.

const colDef = (dict, codes) => ({ kind: 'dict', dict, codes });
const valuesOf = (col) => Array.from(col.codes, c => col.dict[c]);

const g = (id, label, members) => ({ id, label, members });

describe('deriveClusterColumn · materialização', () => {
  it('1 dimensão: reproduz a partição exatamente (first-match trivial)', () => {
    const csv = { name: 'x', headers: ['SEG', 'qty'], columnTypes: { SEG: 'decision', qty: 'qty' },
      ...buildColumnar(['SEG', 'qty'], [['A', '1'], ['B', '1'], ['C', '1'], ['D', '1'], ['A', '1']], { SEG: 'decision', qty: 'qty' }) };
    const def = { dims: ['SEG'], unmatchedLabel: 'Fora',
      groups: [g('g1', 'Baixo', { SEG: ['A', 'B'] }), g('g2', 'Alto', { SEG: ['C'] })] };
    const col = deriveClusterColumn(csv, def);
    expect(valuesOf(col)).toEqual(['Baixo', 'Baixo', 'Alto', 'Fora', 'Baixo']);
  });

  it('trima o valor da linha antes de casar (paridade com a agregação da clusterização)', () => {
    const csv = { headers: ['SEG'], columnTypes: { SEG: 'decision' },
      ...buildColumnar(['SEG'], [[' A '], ['A'], [' C']], { SEG: 'decision' }) };
    const def = { dims: ['SEG'], unmatchedLabel: 'Fora', groups: [g('g1', 'X', { SEG: ['A'] })] };
    expect(valuesOf(deriveClusterColumn(csv, def))).toEqual(['X', 'X', 'Fora']);
  });

  it('2 dimensões: AND por dimensão, first-match na sobreposição de bounding boxes', () => {
    const csv = { headers: ['D1', 'D2'], columnTypes: { D1: 'decision', D2: 'decision' },
      ...buildColumnar(['D1', 'D2'], [['x', 'p'], ['x', 'q'], ['x', 'r'], ['y', 'p'], ['z', 'z']], { D1: 'decision', D2: 'decision' }) };
    const def = { dims: ['D1', 'D2'], unmatchedLabel: 'Fora', groups: [
      g('g1', 'C1', { D1: ['x', 'y'], D2: ['p', 'r'] }),
      g('g2', 'C2', { D1: ['x'], D2: ['q', 'r'] }),
    ] };
    // (x,p)→C1; (x,q)→C2; (x,r)→casa C1 e C2 ⇒ first-match C1; (y,p)→C1; (z,z)→Fora.
    expect(valuesOf(deriveClusterColumn(csv, def))).toEqual(['C1', 'C2', 'C1', 'C1', 'Fora']);
  });

  it('dimensão ausente na base é curinga (não fragmenta)', () => {
    const csv = { headers: ['D1'], columnTypes: { D1: 'decision' },
      ...buildColumnar(['D1'], [['x'], ['y']], { D1: 'decision' }) };
    const def = { dims: ['D1', 'FALTANTE'], unmatchedLabel: 'Fora',
      groups: [g('g1', 'C1', { D1: ['x'], FALTANTE: ['nunca'] })] };
    // FALTANTE não existe ⇒ curinga; só D1 decide.
    expect(valuesOf(deriveClusterColumn(csv, def))).toEqual(['C1', 'Fora']);
  });
});

describe('sugestões de nome', () => {
  it('uniqueName evita colisão com sufixo incremental', () => {
    expect(uniqueName('Cluster', [])).toBe('Cluster');
    expect(uniqueName('Cluster', ['Cluster'])).toBe('Cluster 2');
    expect(uniqueName('Cluster', ['Cluster', 'Cluster 2'])).toBe('Cluster 3');
  });

  it('suggestClusterVarName é única vs. headers e usa a dimensão quando só há uma', () => {
    const model = { params: { dims: ['FAIXA'] } };
    expect(suggestClusterVarName(model, [])).toBe('Cluster de FAIXA');
    expect(suggestClusterVarName(model, ['Cluster de FAIXA'])).toBe('Cluster de FAIXA 2');
    expect(suggestClusterVarName({ params: { dims: ['A', 'B'] } }, [])).toBe('Cluster de comportamento');
  });

  it('suggestClusterLabels: rótulos legíveis e DISTINTOS entre si', () => {
    const model = { clusters: [
      { id: 'c1', approvalRate: 0.9, inadInferida: 0.2 },
      { id: 'c2', approvalRate: 0.2, inadInferida: 0.6 },
      { id: 'c3', approvalRate: 0.9, inadInferida: 0.2 }, // colide com c1 → deve desempatar
    ] };
    const labels = suggestClusterLabels(model);
    expect(labels).toHaveLength(3);
    expect(new Set(labels).size).toBe(3);
    expect(labels[0]).toContain('aprovação');
  });
});

describe('buildClusterDefFromModel + describeClusterRules', () => {
  const model = {
    generatedAt: 't', params: { dims: ['SEG'], k: 2, seed: 42, features: ['approvalRate'] },
    quality: { method: 'kmeans', explainedVariance: 0.5, silhouette: null },
    clusters: [
      { id: 'c1', dims: [{ col: 'SEG', values: [{ value: 'A' }, { value: 'B' }] }] },
      { id: 'c2', dims: [{ col: 'SEG', values: [{ value: 'C' }] }] },
    ],
  };
  let n = 0;
  const def = buildClusterDefFromModel(model, { col: 'Clu', csvId: 'k', labels: ['Baixo', 'Alto'], unmatchedLabel: 'Fora', genId: () => `id${n++}` });

  it('monta groups.members a partir de cluster.dims[].values', () => {
    expect(def.col).toBe('Clu');
    expect(def.dims).toEqual(['SEG']);
    expect(def.groups.map(x => x.label)).toEqual(['Baixo', 'Alto']);
    expect(def.groups[0].members).toEqual({ SEG: ['A', 'B'] });
    expect(def.groups[1].members).toEqual({ SEG: ['C'] });
    expect(def.meta.seed).toBe(42);
  });

  it('describeClusterRules redige os valores concretos sem includeDomains', () => {
    const withVals = describeClusterRules(def, true);
    expect(withVals.groups[0].dims[0].values).toEqual(['A', 'B']);
    expect(withVals.groups[0].dims[0].valueCount).toBe(2);
    const redacted = describeClusterRules(def, false);
    expect(redacted.groups[0].dims[0].values).toBe(null);
    expect(redacted.groups[0].dims[0].valueCount).toBe(2); // contagem permanece (N1)
  });
});

describe('operações de edição puras', () => {
  const base = { col: 'C', dims: ['SEG'], unmatchedLabel: 'Fora', groups: [
    g('g1', 'Baixo', { SEG: ['A', 'B'] }), g('g2', 'Alto', { SEG: ['C'] }) ] };

  it('renameClusterGroup só troca o label do grupo alvo', () => {
    const nd = renameClusterGroup(base, 'g2', 'Altíssimo');
    expect(nd.groups.map(x => x.label)).toEqual(['Baixo', 'Altíssimo']);
    expect(base.groups[1].label).toBe('Alto'); // imutável
  });

  it('moveValueToGroup dá posse exclusiva (remove de todos, adiciona no destino)', () => {
    const nd = moveValueToGroup(base, 'SEG', 'A', 'g2');
    expect(nd.groups[0].members.SEG).toEqual(['B']);
    expect(nd.groups[1].members.SEG).toEqual(['C', 'A']);
    // destino null ⇒ some de todos (vai para "fora")
    const out = moveValueToGroup(base, 'SEG', 'A', null);
    expect(out.groups[0].members.SEG).toEqual(['B']);
    expect(out.groups[1].members.SEG).toEqual(['C']);
  });

  it('toggleValueInGroup permite sobreposição (add/remove no grupo)', () => {
    const added = toggleValueInGroup(base, 'SEG', 'A', 'g2'); // A agora em g1 E g2
    expect(added.groups[0].members.SEG).toEqual(['A', 'B']);
    expect(added.groups[1].members.SEG).toEqual(['C', 'A']);
    const removed = toggleValueInGroup(added, 'SEG', 'A', 'g1');
    expect(removed.groups[0].members.SEG).toEqual(['B']);
  });

  it('clusterMembershipTable inclui valores da base não atribuídos e mapeia grupos', () => {
    const table = clusterMembershipTable(base, { SEG: ['A', 'B', 'C', 'D'] });
    const seg = table.find(t => t.col === 'SEG');
    const byVal = Object.fromEntries(seg.values.map(v => [v.value, v.groupIds]));
    expect(byVal.A).toEqual(['g1']);
    expect(byVal.C).toEqual(['g2']);
    expect(byVal.D).toEqual([]); // presente na base, fora dos clusters
  });
});

describe('propagação de referências no canvas', () => {
  it('renameClusterColumnRefs atualiza losango/Cineminha/lens', () => {
    const shapes = [
      { id: 's1', type: 'decision', csvId: 'k', variableCol: 'Clu', label: 'Clu' },
      { id: 's2', type: 'cineminha', rowVar: { col: 'Clu', csvId: 'k' }, colVar: { col: 'Outra', csvId: 'k' } },
      { id: 's3', type: 'decision_lens', rules: [{ col: 'Clu', operator: 'equal', value: 'x' }] },
      { id: 's4', type: 'decision', csvId: 'k', variableCol: 'Outra', label: 'Rótulo custom' },
    ];
    const { shapes: out } = renameClusterColumnRefs(shapes, [], 'k', 'Clu', 'Cluster de Risco');
    expect(out[0].variableCol).toBe('Cluster de Risco');
    expect(out[0].label).toBe('Cluster de Risco'); // label era o nome da coluna → migra
    expect(out[1].rowVar.col).toBe('Cluster de Risco');
    expect(out[1].colVar.col).toBe('Outra');
    expect(out[2].rules[0].col).toBe('Cluster de Risco');
    expect(out[3]).toBe(shapes[3]); // intocado (outra coluna)
  });

  it('renameClusterLabelRefs renomeia portas/arestas e domínio/células de Cineminha', () => {
    const shapes = [
      { id: 'd', type: 'decision', csvId: 'k', variableCol: 'Clu' },
      { id: 'p1', type: 'port', label: 'Baixo' },
      { id: 'p2', type: 'port', label: 'Alto' },
      { id: 'cm', type: 'cineminha', rowVar: { col: 'Clu', csvId: 'k' }, rowDomain: ['Baixo', 'Alto'],
        colVar: { col: 'Sexo', csvId: 'k' }, colDomain: ['M'], cells: { 'Baixo|M': 1, 'Alto|M': 0 } },
    ];
    const conns = [{ id: 'e1', from: 'd', to: 'p1', label: 'Baixo' }, { id: 'e2', from: 'd', to: 'p2', label: 'Alto' }];
    const { shapes: os, conns: oc } = renameClusterLabelRefs(shapes, conns, 'k', 'Clu', { Baixo: 'Conservador' });
    expect(os[1].label).toBe('Conservador');
    expect(os[2].label).toBe('Alto'); // não renomeado
    expect(oc[0].label).toBe('Conservador');
    expect(os[3].rowDomain).toEqual(['Conservador', 'Alto']);
    expect(os[3].cells).toEqual({ 'Conservador|M': 1, 'Alto|M': 0 });
  });
});

describe('integração ponta-a-ponta: modelo real → def → coluna materializada', () => {
  it('1D: os volumes por cluster da coluna materializada batem com o ClusterModel', () => {
    // Base sintética: 3 perfis de risco bem separados sobre uma dimensão SEGMENTO.
    const headers = ['SEGMENTO', 'qty', 'qtdAltas', 'inadReal', '__DECISAO_ORIGINAL'];
    const types = { SEGMENTO: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' };
    const profiles = {
      S1: 0.01, S2: 0.02, S3: 0.03,   // baixo risco
      S7: 0.40, S8: 0.42, S9: 0.44,   // alto risco
      S4: 0.18, S5: 0.20, S6: 0.22,   // médio risco
    };
    const rows = [];
    for (const [seg, rate] of Object.entries(profiles)) {
      for (let i = 0; i < 20; i++) rows.push([seg, '100', '100', String(rate * 100), i % 2 ? 'APROVADO' : 'REPROVADO']);
    }
    const csv = { name: 'base', headers, columnTypes: types, varTypes: {}, ...buildColumnar(headers, rows, types) };
    const store = { base: csv };

    const model = computeClusterSegments(store, { csvId: 'base', dims: ['SEGMENTO'], k: 3, features: ['inadReal'], maxPoints: 2000 });
    expect(model.error).toBe(null);
    expect(model.clusters).toHaveLength(3);

    let n = 0;
    const def = buildClusterDefFromModel(model, { col: 'RiscoCluster', csvId: 'base',
      labels: model.clusters.map((_, i) => `K${i + 1}`), unmatchedLabel: 'Fora', genId: () => `g${n++}` });
    const colData = deriveClusterColumn(csv, def);

    // Contagem de linhas por rótulo na coluna materializada.
    const cnt = {};
    for (let r = 0; r < rowCount(csv); r++) { const v = colData.dict[colData.codes[r]]; cnt[v] = (cnt[v] || 0) + 1; }
    // Nada cai em "Fora" (a partição 1D cobre todos os valores).
    expect(cnt['Fora'] || 0).toBe(0);
    // Cada cluster do modelo tem `size` grupos × 20 linhas = qty de linhas na coluna.
    for (let i = 0; i < model.clusters.length; i++) {
      expect(cnt[`K${i + 1}`]).toBe(model.clusters[i].size * 20);
    }
    // Soma bate com o total.
    expect(Object.values(cnt).reduce((a, b) => a + b, 0)).toBe(rows.length);
  });
});

describe('persistência (round-trip de clusterDefs + coluna materializada)', () => {
  it('serializeCsvStore/deserializeCsvStore preservam a definição e a coluna', () => {
    const csv = { name: 'x', headers: ['SEG', 'qty'], columnTypes: { SEG: 'decision', qty: 'qty' }, varTypes: {},
      ...buildColumnar(['SEG', 'qty'], [['A', '1'], ['C', '1']], { SEG: 'decision', qty: 'qty' }) };
    const def = { id: 'i', col: 'Clu', csvId: 'k', dims: ['SEG'], unmatchedLabel: 'Fora',
      groups: [g('g1', 'Baixo', { SEG: ['A'] }), g('g2', 'Alto', { SEG: ['C'] })], source: 'cluster' };
    const colData = deriveClusterColumn(csv, def);
    const store = { k: { ...csv, headers: [...csv.headers, 'Clu'],
      columns: { ...csv.columns, Clu: colData }, columnTypes: { ...csv.columnTypes, Clu: 'decision' },
      clusterDefs: { Clu: def } } };
    const round = deserializeCsvStore(JSON.parse(JSON.stringify(serializeCsvStore(store))));
    expect(isClusterVar(round, 'k', 'Clu')).toBe(true);
    expect(round.k.clusterDefs.Clu.groups[0].members.SEG).toEqual(['A']);
    expect(valuesOf(round.k.columns.Clu)).toEqual(['Baixo', 'Alto']);
  });
});
