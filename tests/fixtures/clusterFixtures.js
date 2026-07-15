// Fixtures da Clusterização de Segmentos (Execução Híbrida H8) COMPARTILHADAS entre o
// GATE numérico do worker (tests/clusterSegments.test.js) e o GATE dourado
// cross-runtime (DEC-HX-005): tests/clusterSegmentsGolden.test.js gera
// tests/fixtures/golden/cluster_segments_*.json a partir DESTAS entradas, e
// tests_python/test_cluster_segments.py executa as MESMAS entradas no motor numpy do
// sidecar (release/python/motor_clusters.py) exigindo igualdade número a número.
//
// Formato de cada fixture: { name, store: {csvId: {headers, columnTypes, rows}},
// params } — `rows` em formato legado string[][]; o gerador vetoriza via buildColumnar
// (o mesmo caminho de produção) antes de serializar. Não há shapes/conns: a
// clusterização é sobre a BASE agregada, não sobre o grafo da política.
//
// Todas as fixtures ficam DENTRO dos tetos do browser (dims ≤ 3, k ≤ 8) — é o recorte
// onde a paridade total (P4) exige o mesmo resultado nos dois motores; `truncated`
// exercita o próprio teto de pontos (maxPoints), provando a paridade da REGRA de
// truncamento declarado.

// ── planted_1d — 9 segmentos em 3 perfis plantados bem separados ─────────────────
// Perfil A (S1–S3): aprovação alta (80%), inad ~2%  · qty 1000/grupo → cluster maior
// Perfil B (S4–S6): aprovação média (50%), inad ~15% · qty 800/grupo
// Perfil C (S7–S9): aprovação baixa (20%), inad ~40% · qty 600/grupo
// Jitter leve por segmento (inad varia ±0.4pp dentro do perfil) para os grupos não
// serem idênticos — k=3 precisa recuperar exatamente a partição plantada.
const planted1dRows = [];
const P1D = [
  // [segmento, qtyAprov, qtyReprov, altas, inadReal(bruto), altasInfer, inadInfer(bruto)]
  ['S1', '800', '200', '700', '14', '700', '14'],
  ['S2', '800', '200', '700', '16', '700', '15'],
  ['S3', '800', '200', '700', '12', '700', '13'],
  ['S4', '400', '400', '380', '57', '380', '55'],
  ['S5', '400', '400', '380', '60', '380', '58'],
  ['S6', '400', '400', '380', '54', '380', '52'],
  ['S7', '120', '480', '110', '44', '110', '43'],
  ['S8', '120', '480', '110', '46', '110', '45'],
  ['S9', '120', '480', '110', '42', '110', '41'],
];
for (const [seg, qa, qr, altas, inadR, altasInf, inadI] of P1D) {
  planted1dRows.push([seg, 'APROVADO', qa, altas, altasInf, inadR, inadI]);
  planted1dRows.push([seg, 'REPROVADO', qr, '0', '0', '0', '0']);
}

// ── planted_2d_mix — REGIAO × CANAL (6 grupos), com mix de risco, 2 perfis ───────
// R1 (qualquer canal): risco baixo/aprovação alta; R2/R3: risco alto/aprovação baixa.
const planted2dRows = [];
const P2D = [
  // [regiao, canal, mix, qtyAprov, qtyReprov, altas, inadReal, altasInfer, inadInfer]
  ['R1', 'Digital', 'Baixo', '900', '100', '800', '16', '800', '15'],
  ['R1', 'Fisico', 'Baixo', '850', '150', '760', '19', '760', '18'],
  ['R2', 'Digital', 'Alto', '200', '800', '180', '63', '180', '61'],
  ['R2', 'Fisico', 'Alto', '180', '820', '160', '59', '160', '57'],
  ['R3', 'Digital', 'Medio', '220', '780', '200', '70', '200', '68'],
  ['R3', 'Fisico', 'Alto', '160', '840', '140', '52', '140', '50'],
];
for (const [reg, canal, mix, qa, qr, altas, inadR, altasInf, inadI] of P2D) {
  planted2dRows.push([reg, canal, mix, 'APROVADO', qa, altas, altasInf, inadR, inadI]);
  planted2dRows.push([reg, canal, mix, 'REPROVADO', qr, '0', '0', '0', '0']);
}

// ── truncated — 6 faixas com volumes distintos; maxPoints=4 derruba as 2 menores ──
// F9 tem qtdAltas ZERO (grupo sem denominador ⇒ feature cai na taxa do escopo, o
// caso de fallback que os dois motores precisam tratar igual).
const truncatedRows = [
  ['F1', 'APROVADO', '5000', '4000', '4000', '80', '78'],
  ['F1', 'REPROVADO', '1000', '0', '0', '0', '0'],
  ['F2', 'APROVADO', '4000', '3200', '3200', '160', '150'],
  ['F2', 'REPROVADO', '1500', '0', '0', '0', '0'],
  ['F3', 'APROVADO', '800', '700', '700', '140', '130'],
  ['F3', 'REPROVADO', '2200', '0', '0', '0', '0'],
  ['F4', 'APROVADO', '600', '500', '500', '150', '140'],
  ['F4', 'REPROVADO', '1900', '0', '0', '0', '0'],
  ['F8', 'APROVADO', '100', '80', '80', '4', '4'],
  ['F8', 'REPROVADO', '150', '0', '0', '0', '0'],
  ['F9', 'APROVADO', '90', '0', '0', '0', '0'],
  ['F9', 'REPROVADO', '110', '0', '0', '0', '0'],
];

// ── no_asis — sem __DECISAO_ORIGINAL e sem colunas inferidas: única feature é a
// inad. real (o motor degrada o vetor de features declaradamente, nunca erro).
const noAsisRows = [
  ['G1', '1000', '900', '18'],
  ['G2', '1200', '1000', '22'],
  ['G3', '900', '800', '320'],
  ['G4', '1100', '950', '390'],
  ['G5', '500', '0', '0'],
];

export const clusterGoldenFixtures = [
  {
    name: 'planted_1d',
    store: {
      clu: {
        headers: ['SEGMENTO', '__DECISAO_ORIGINAL', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
        columnTypes: { SEGMENTO: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
        rows: planted1dRows,
      },
    },
    params: { csvId: 'clu', dims: ['SEGMENTO'], k: 3 },
  },
  {
    name: 'planted_2d_mix',
    store: {
      clu: {
        headers: ['REGIAO', 'CANAL', 'MIX', '__DECISAO_ORIGINAL', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
        columnTypes: { REGIAO: 'decision', CANAL: 'decision', MIX: 'mixRisco', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
        rows: planted2dRows,
      },
    },
    params: { csvId: 'clu', dims: ['REGIAO', 'CANAL'], k: 2 },
  },
  {
    name: 'truncated',
    store: {
      clu: {
        headers: ['FAIXA', '__DECISAO_ORIGINAL', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
        columnTypes: { FAIXA: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
        rows: truncatedRows,
      },
    },
    params: { csvId: 'clu', dims: ['FAIXA'], k: 2, maxPoints: 4 },
  },
  {
    name: 'no_asis',
    store: {
      clu: {
        headers: ['GRUPO', 'qty', 'qtdAltas', 'inadReal'],
        columnTypes: { GRUPO: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
        rows: noAsisRows,
      },
    },
    params: { csvId: 'clu', dims: ['GRUPO'], k: 2 },
  },
];

// ── Fixtura ESCOPADA (Clusterização Contextual, DEC-FR-001/003) ──────────────────
// Diferente das globais acima, esta carrega shapes/conns/scope: o cluster é aprendido
// SÓ na subpopulação que chega ao nó (walk compilado M8, single-sourced no worker). A
// política D1(GRP) roteia A → pA → ❌ ; B → pB → ✅. Escopo pA ⇒ só GRP=A (4 perfis em
// SEG: s1/s2 baixo risco, s3/s4 alto risco), k=2. GRP=B tem perfil intermediário que,
// se vazasse, mudaria a partição — a prova de que a máscara filtra ANTES de agregar.
//
// O GATE dourado desta fixtura prova a costura FR3: o worker escopado (browser),
// o caminho por máscara precomputada (fallback do worker) e o motor Python que recebe
// SÓ a máscara (rowMask, sem shapes/conns) produzem o MESMO ClusterModel número a
// número. O gerador (tests/clusterSegmentsGolden.test.js) resolve a máscara via
// resolveScopeRowMask e a empacota em params.rowMask (o que o sidecar recebe).
const scopedGrp = (grp, seg, dec, qty, altas, inadR) =>
  [grp, seg, dec, String(qty), String(altas), String(altas), String(inadR), String(inadR)];
const scopedRows = [
  scopedGrp('A', 's1', 'APROVADO', 800, 700, 14), scopedGrp('A', 's1', 'REPROVADO', 200, 0, 0),
  scopedGrp('A', 's2', 'APROVADO', 820, 720, 15), scopedGrp('A', 's2', 'REPROVADO', 180, 0, 0),
  scopedGrp('A', 's3', 'APROVADO', 300, 280, 140), scopedGrp('A', 's3', 'REPROVADO', 700, 0, 0),
  scopedGrp('A', 's4', 'APROVADO', 320, 300, 150), scopedGrp('A', 's4', 'REPROVADO', 680, 0, 0),
  scopedGrp('B', 'b1', 'APROVADO', 500, 450, 90), scopedGrp('B', 'b1', 'REPROVADO', 500, 0, 0),
  scopedGrp('B', 'b2', 'APROVADO', 600, 500, 250), scopedGrp('B', 'b2', 'REPROVADO', 400, 0, 0),
];

export const clusterScopedGoldenFixtures = [
  {
    name: 'scoped_by_node',
    store: {
      b: {
        headers: ['GRP', 'SEG', '__DECISAO_ORIGINAL', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
        columnTypes: {
          GRP: 'decision', SEG: 'decision', qty: 'qty', qtdAltas: 'qtdAltas',
          qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida',
        },
        rows: scopedRows,
      },
    },
    shapes: [
      { id: 'D1', type: 'decision', label: 'Grupo', variableCol: 'GRP', csvId: 'b' },
      { id: 'pA', type: 'port', label: 'Porte A' },
      { id: 'pB', type: 'port', label: 'Porte B' },
      { id: 'REJ', type: 'rejected', label: 'Reprovado' },
      { id: 'AP', type: 'approved', label: 'Aprovado' },
    ],
    conns: [
      { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
      { id: 'c2', from: 'pA', to: 'REJ' },
      { id: 'c3', from: 'D1', to: 'pB', label: 'B' },
      { id: 'c4', from: 'pB', to: 'AP' },
    ],
    scope: { nodeId: 'pA', label: 'Porte A' },
    params: { csvId: 'b', dims: ['SEG'], k: 2 },
  },
];
