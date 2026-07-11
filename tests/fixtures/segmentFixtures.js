// Fixtures da Descoberta de Segmentos COMPARTILHADAS entre o GATE numérico do worker
// (tests/segmentDiscovery.test.js — que mantém as suas cópias locais, intocadas) e o
// GATE dourado cross-runtime da Execução Híbrida H7 (DEC-HX-005):
// tests/segmentDiscoveryGolden.test.js gera tests/fixtures/golden/segment_discovery_*.json
// a partir DESTAS entradas, e tests_python/test_segment_discovery.py executa as MESMAS
// entradas no motor numpy do sidecar exigindo igualdade número a número.
//
// Formato de cada fixture: { name, store: {csvId: {headers, columnTypes, rows}},
// shapes, conns, scope, params } — `rows` em formato legado string[][]; o gerador
// vetoriza via buildColumnar (o mesmo caminho de produção) antes de serializar.

const csvOf = (rows) => ({
  headers: ['SCORE', 'CANAL', 'qty', 'qtdAltas', 'inadReal'],
  columnTypes: { SCORE: 'decision', CANAL: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
  rows,
});

// Política "reprova tudo" — mesma raiz neutra de tests/segmentDiscovery.test.js.
export const rejectAll = {
  shapes: [
    { id: 'L', type: 'decision_lens', label: 'Todos', rules: [] },
    { id: 'REJ', type: 'rejected', label: 'Reprovado' },
  ],
  conns: [{ id: 'c1', from: 'L', to: 'REJ' }],
};

const plantedRows = [
  ['R08', 'Digital', '1000', '1000', '20'],
  ['R08', 'Fisico', '1000', '1000', '380'],
  ['R05', 'Digital', '1000', '1000', '380'],
  ['R05', 'Fisico', '1000', '1000', '20'],
];

const dispersionPolicy = {
  shapes: [
    { id: 'D1', type: 'decision', label: 'G1', variableCol: 'GRP', csvId: 'b' },
    { id: 'pA', type: 'port', label: 'A' },
    { id: 'pB', type: 'port', label: 'B' },
    { id: 'AP', type: 'approved', label: 'Aprovado' },
    { id: 'D2', type: 'decision', label: 'G2', variableCol: 'GRP', csvId: 'b' },
    { id: 'pB2', type: 'port', label: 'B' },
    { id: 'REJ', type: 'rejected', label: 'Reprovado' },
  ],
  conns: [
    { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
    { id: 'c2', from: 'pA', to: 'AP' },
    { id: 'c3', from: 'D1', to: 'pB', label: 'B' },
    { id: 'c4', from: 'pB', to: 'D2' },
    { id: 'c5', from: 'D2', to: 'pB2', label: 'B' },
    { id: 'c6', from: 'pB2', to: 'REJ' },
  ],
};

const scopePolicy = {
  shapes: [
    { id: 'D1', type: 'decision', label: 'G', variableCol: 'GRP', csvId: 'b' },
    { id: 'pA', type: 'port', label: 'A' },
    { id: 'pB', type: 'port', label: 'B' },
    { id: 'REJ', type: 'rejected', label: 'Reprovado' },
    { id: 'AP', type: 'approved', label: 'Aprovado' },
  ],
  conns: [
    { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
    { id: 'c2', from: 'pA', to: 'REJ' },
    { id: 'c3', from: 'D1', to: 'pB', label: 'B' },
    { id: 'c4', from: 'pB', to: 'AP' },
  ],
};

export const goldenFixtures = [
  {
    name: 'planted_2d',
    store: { seg: csvOf(plantedRows) },
    ...rejectAll, scope: null, params: { minQty: 1 },
  },
  {
    name: 'planted_2d_depth1',
    store: { seg: csvOf(plantedRows) },
    ...rejectAll, scope: null, params: { minQty: 1, maxDepth: 1 },
  },
  {
    name: 'planted_2d_beam2',
    store: { seg: csvOf(plantedRows) },
    ...rejectAll, scope: null, params: { minQty: 1, beamWidth: 2 },
  },
  {
    name: 'homogeneous',
    store: {
      seg: csvOf([
        ['R08', 'Digital', '1000', '1000', '200'],
        ['R08', 'Fisico', '1000', '1000', '200'],
        ['R05', 'Digital', '1000', '1000', '200'],
        ['R05', 'Fisico', '1000', '1000', '200'],
      ]),
    },
    ...rejectAll, scope: null, params: { minQty: 1 },
  },
  {
    name: 'dispersion_multinode',
    store: {
      b: {
        headers: ['GRP', 'SEG', 'qty', 'qtdAltas', 'inadReal'],
        columnTypes: { GRP: 'decision', SEG: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
        rows: [
          ['A', 'X', '300', '300', '30'],
          ['A', 'Y', '100', '100', '10'],
          ['B', 'X', '200', '200', '40'],
          ['B', 'Y', '100', '100', '10'],
        ],
      },
    },
    ...dispersionPolicy, scope: null, params: { minQty: 1 },
  },
  {
    name: 'binomial_small_segment',
    store: {
      seg: csvOf([
        ['R08', 'Digital', '10', '10', '0'],
        ['R08', 'Fisico', '100', '100', '30'],
        ['R05', 'Digital', '100', '100', '30'],
        ['R05', 'Fisico', '100', '100', '30'],
      ]),
    },
    ...rejectAll, scope: null, params: { minQty: 1 },
  },
  {
    name: 'shrinkage_niche',
    store: {
      seg: {
        headers: ['SEG', 'qty', 'qtdAltas', 'inadReal'],
        columnTypes: { SEG: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
        rows: [
          ['BIG', '1000', '1000', '10'],
          ['SMALL', '30', '30', '0'],
          ['REST1', '1000', '1000', '200'],
          ['REST2', '1000', '1000', '200'],
        ],
      },
    },
    ...rejectAll, scope: null, params: { minQty: 1 },
  },
  {
    name: 'node_scope',
    store: {
      b: {
        headers: ['GRP', 'SEG', 'qty', 'qtdAltas', 'inadReal'],
        columnTypes: { GRP: 'decision', SEG: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
        rows: [
          ['A', 'X', '300', '300', '6'],
          ['A', 'Y', '200', '200', '40'],
          ['B', 'X', '500', '500', '100'],
          ['B', 'Y', '500', '500', '100'],
        ],
      },
    },
    ...scopePolicy, scope: { nodeId: 'pA' }, params: { minQty: 1 },
  },
  {
    name: 'dedup_nested',
    store: {
      seg: {
        headers: ['P', 'Q', 'qty', 'qtdAltas', 'inadReal'],
        columnTypes: { P: 'decision', Q: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
        rows: [
          ['v', 'w', '500', '500', '10'],
          ['v', 'z', '500', '500', '10'],
          ['other', 'w', '500', '500', '100'],
          ['other', 'z', '500', '500', '100'],
        ],
      },
    },
    ...rejectAll, scope: null, params: { minQty: 1 },
  },
  {
    name: 'het_block',
    store: {
      seg: csvOf([
        ['R08', 'Digital', '1000', '1000', '20'],
        ['R08', 'Fisico', '1000', '1000', '20'],
        ['R05', 'Digital', '1000', '1000', '400'],
        ['R05', 'Fisico', '1000', '1000', '400'],
      ]),
    },
    ...rejectAll, scope: null, params: { minQty: 1 },
  },
  {
    name: 'asis_divergence',
    store: {
      b: {
        headers: ['SCORE', 'qty', 'qtdAltas', 'inadReal', '__DECISAO_ORIGINAL'],
        columnTypes: { SCORE: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
        rows: [
          ['R08', '1000', '1000', '20', 'REPROVADO'],
          ['R05', '1000', '1000', '200', 'REPROVADO'],
        ],
      },
    },
    shapes: [
      { id: 'D', type: 'decision', label: 'SCORE', variableCol: 'SCORE', csvId: 'b' },
      { id: 'pA', type: 'port', label: 'R08' },
      { id: 'pR', type: 'port', label: 'R05' },
      { id: 'AP', type: 'approved', label: 'Aprovado' },
      { id: 'REJ', type: 'rejected', label: 'Reprovado' },
    ],
    conns: [
      { id: 'c1', from: 'D', to: 'pA', label: 'R08' },
      { id: 'c2', from: 'pA', to: 'AP' },
      { id: 'c3', from: 'D', to: 'pR', label: 'R05' },
      { id: 'c4', from: 'pR', to: 'REJ' },
    ],
    scope: null, params: { minQty: 1 },
  },
  {
    name: 'anomaly_regiao',
    store: {
      seg: {
        headers: ['REGIAO', 'qty', 'qtdAltas', 'inadReal'],
        columnTypes: { REGIAO: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
        rows: [
          ['N', '1000', '1000', '100'],
          ['S', '1000', '1000', '105'],
          ['L', '1000', '1000', '95'],
          ['O', '1000', '1000', '110'],
          ['??', '1000', '1000', '900'],
        ],
      },
    },
    ...rejectAll, scope: null, params: { minQty: 1 },
  },
  {
    name: 'temporal_stability',
    store: {
      seg: {
        headers: ['SEG', 'MES', 'qty', 'qtdAltas', 'inadReal'],
        columnTypes: { SEG: 'decision', MES: 'temporal', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
        rows: [
          ['X', '1', '1000', '1000', '20'],
          ['Y', '1', '1000', '1000', '300'],
          ['X', '2', '1000', '1000', '20'],
          ['Y', '2', '1000', '1000', '300'],
        ],
      },
    },
    ...rejectAll, scope: null, params: { minQty: 1 },
  },
  {
    name: 'locked_node',
    store: { seg: csvOf(plantedRows) },
    shapes: [{ ...rejectAll.shapes[0], locked: true }, rejectAll.shapes[1]],
    conns: rejectAll.conns,
    scope: null, params: { minQty: 1 },
  },
  {
    // Valores com espaços nas bordas: o dict guarda o cru; bins/rotas casam pelo
    // TRIMADO (merge de códigos) — exercita trimmedDictVals/segCandValue dos 2 motores.
    name: 'trim_merge',
    store: {
      seg: {
        headers: ['SEG', 'qty', 'qtdAltas', 'inadReal'],
        columnTypes: { SEG: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
        rows: [
          ['GOOD', '600', '600', '6'],
          [' GOOD ', '400', '400', '4'],
          ['BAD', '500', '500', '100'],
          ['BAD ', '500', '500', '100'],
        ],
      },
    },
    ...rejectAll, scope: null, params: { minQty: 1 },
  },
  {
    // Dois csvs: o winner é o de maior população no escopo (critério do motor).
    name: 'multi_csv_winner',
    store: {
      small: csvOf([
        ['R01', 'Digital', '10', '10', '1'],
        ['R02', 'Fisico', '10', '10', '1'],
      ]),
      big: csvOf(plantedRows),
    },
    ...rejectAll, scope: null, params: { minQty: 1 },
  },
];
