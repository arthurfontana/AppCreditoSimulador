import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeWidgetMetric,
  pivotWidget,
  resolveKpiScenarios,
  buildAnalyticsCSV,
  cloneCanvasWithNewIds,
  applyGroupingsToDataset,
  autoBuckets,
  distinctDimValues,
} from '../src/App.jsx';
import {
  computeAnalyticsDataset,
  computeNodeArrivals,
  __setWorkerCsvStoreForTest,
} from '../src/simulation.worker.js';

// ── Helpers p/ o dataset largo COLUNAR (Otimização de Memória Fase 4) ──────────
// O dataset deixou de ser array de objetos e virou colunar: { rowCount, columns:{...} }.
// Estes helpers montam um ds colunar a partir de objetos legíveis e leem células —
// mantêm as fixtures dos testes concisas e verificam o mesmo contrato numérico.
const AW_NUM = new Set(['qty', 'qtdAltas', 'inadRRaw', 'qtdAltasInfer', 'inadIRaw']);
function columnarDataset(objs, meta = {}) {
  const rowCount = objs.length;
  const names = new Set();
  for (const o of objs) for (const k of Object.keys(o)) names.add(k);
  const columns = {};
  for (const name of names) {
    if (AW_NUM.has(name)) {
      const data = new Float64Array(rowCount);
      for (let r = 0; r < rowCount; r++) {
        const v = objs[r][name];
        data[r] = (v === undefined || v === null || v === '') ? NaN : Number(v);
      }
      columns[name] = { kind: 'num', data };
    } else {
      const dict = [], dictIndex = new Map(), codes = new Int32Array(rowCount);
      for (let r = 0; r < rowCount; r++) {
        const v = String(objs[r][name] ?? '');
        let c = dictIndex.get(v);
        if (c === undefined) { c = dict.length; dict.push(v); dictIndex.set(v, c); }
        codes[r] = c;
      }
      columns[name] = { kind: 'dict', dict, codes };
    }
  }
  return {
    rowCount, columns,
    dimensions: meta.dimensions || [],
    temporalColumns: meta.temporalColumns || [],
    metrics: meta.metrics || [],
    scenarios: meta.scenarios || [],
    ...(meta.extra || {}),
  };
}
function awCell(ds, name, r) {
  const c = ds.columns[name];
  if (!c) return undefined;
  if (c.kind === 'num') { const n = c.data[r]; return Number.isNaN(n) ? 0 : n; }
  return c.dict[c.codes[r]];
}
function awRowAt(ds, r) { const o = {}; for (const name of Object.keys(ds.columns)) o[name] = awCell(ds, name, r); return o; }
function awColumn(ds, name) { const out = []; for (let r = 0; r < ds.rowCount; r++) out.push(awCell(ds, name, r)); return out; }

// ── Fixture: dataset analítico largo (DEC-AW-003) com 2 cenários ──────────────
// AS IS aprova rows 1 e 3; Política X aprova rows 1 e 2.
function makeDataset() {
  return columnarDataset([
    { mes: '2024-01', score: 'R1', qty: 100, qtdAltas: 40, qtdAltasInfer: 0, inadRRaw: 4, inadIRaw: 2, __DECISAO_AS_IS: 'APROVADO',  __DECISAO_cv1: 'APROVADO' },
    { mes: '2024-01', score: 'R2', qty: 50,  qtdAltas: 10, qtdAltasInfer: 0, inadRRaw: 5, inadIRaw: 1, __DECISAO_AS_IS: 'REPROVADO', __DECISAO_cv1: 'APROVADO' },
    { mes: '2024-02', score: 'R1', qty: 80,  qtdAltas: 30, qtdAltasInfer: 0, inadRRaw: 3, inadIRaw: 1, __DECISAO_AS_IS: 'APROVADO',  __DECISAO_cv1: 'REPROVADO' },
  ], {
    dimensions: ['mes', 'score'],
    temporalColumns: ['mes'],
    metrics: [
      { id: 'approvalRate', label: 'Taxa de Aprovação', unit: 'pct' },
      { id: 'inadReal',     label: 'Inad. Real',        unit: 'pct' },
      { id: 'inadInferida', label: 'Inad. Inferida',    unit: 'pct' },
      { id: 'qty',          label: 'Vol. Propostas',    unit: 'qty' },
      { id: 'approvedQty',  label: 'Vol. Aprovado',     unit: 'qty' },
    ],
    scenarios: [
      { id: 'as_is', nome: 'AS IS',      decisionCol: '__DECISAO_AS_IS' },
      { id: 'cv1',   nome: 'Política X', decisionCol: '__DECISAO_cv1' },
    ],
  });
}

// ── Sessão 5A — infraestrutura multi-canvas (duplicação) ──────────────────────
describe('5A · cloneCanvasWithNewIds', () => {
  const shapes = [
    { id: 's1', type: 'decision', label: 'Score' },
    { id: 's2', type: 'approved' },
    { id: 's3', type: 'rejected' },
  ];
  const conns = [
    { id: 'c1', from: 's1', to: 's2', label: 'aprova' },
    { id: 'c2', from: 's1', to: 's3', label: 'reprova' },
  ];

  it('regenera todos os ids de shapes e conns (sem colisão com os originais)', () => {
    const { newShapes, newConns } = cloneCanvasWithNewIds(shapes, conns);
    const origIds = new Set([...shapes.map(s => s.id), ...conns.map(c => c.id)]);
    for (const s of newShapes) expect(origIds.has(s.id)).toBe(false);
    for (const c of newConns) expect(origIds.has(c.id)).toBe(false);
    // ids de shapes únicos
    expect(new Set(newShapes.map(s => s.id)).size).toBe(newShapes.length);
  });

  it('remapeia from/to das conns para os novos ids preservando a topologia', () => {
    const { newShapes, newConns } = cloneCanvasWithNewIds(shapes, conns);
    const map = {};
    shapes.forEach((s, i) => { map[s.id] = newShapes[i].id; });
    expect(newConns[0].from).toBe(map['s1']);
    expect(newConns[0].to).toBe(map['s2']);
    expect(newConns[1].to).toBe(map['s3']);
    // labels e demais campos preservados
    expect(newConns[0].label).toBe('aprova');
    expect(newShapes[0].label).toBe('Score');
  });

  it('preserva a contagem de shapes e conns', () => {
    const { newShapes, newConns } = cloneCanvasWithNewIds(shapes, conns);
    expect(newShapes).toHaveLength(shapes.length);
    expect(newConns).toHaveLength(conns.length);
  });
});

// ── Sessão 5B — pipeline N-cenários no worker ─────────────────────────────────
describe('5B · computeAnalyticsDataset', () => {
  const csvStore = {
    c1: {
      name: 'base',
      headers: ['mes', 'score', 'volume', 'altas', 'inad', '__DECISAO_ORIGINAL'],
      rows: [
        ['2024-01', 'R1', '100', '40', '4', 'APROVADO'],
        ['2024-01', 'R2', '50',  '10', '5', 'REPROVADO'],
        ['2024-02', 'R1', '80',  '30', '3', 'APROVADO'],
      ],
      columnTypes: { mes: 'temporal', score: 'decision', volume: 'qty', altas: 'qtdAltas', inad: 'inadReal' },
      varTypes: {},
      asIsConfig: { col: 'dec', mapping: {} },
    },
  };

  // Canvas que aprova tudo: decision_lens sem regras → terminal "approved".
  const canvasInputs = [{
    id: 'cv1', nome: 'Política X',
    shapes: [
      { id: 'L1', type: 'decision_lens', rules: [] },
      { id: 'A1', type: 'approved' },
    ],
    conns: [{ id: 'k1', from: 'L1', to: 'A1', label: '' }],
    lensPopulations: {},
  }];

  beforeEach(() => { __setWorkerCsvStoreForTest(csvStore); });

  it('emite (colunar) uma linha por agrupamento com dimensões e métricas intrínsecas', () => {
    const ds = computeAnalyticsDataset(canvasInputs, csvStore);
    expect(ds).not.toBeNull();
    expect(ds.rowCount).toBe(3);
    expect(ds.dimensions.sort()).toEqual(['mes', 'score']);
    expect(ds.temporalColumns).toEqual(['mes']);
    expect(awRowAt(ds, 0)).toMatchObject({ mes: '2024-01', score: 'R1', qty: 100, qtdAltas: 40, inadRRaw: 4 });
  });

  it('registra os cenários: AS IS global + uma coluna por aba marcada', () => {
    const ds = computeAnalyticsDataset(canvasInputs, csvStore);
    expect(ds.scenarios).toEqual([
      { id: 'as_is', nome: 'AS IS',      decisionCol: '__DECISAO_AS_IS' },
      { id: 'cv1',   nome: 'Política X', decisionCol: '__DECISAO_cv1' },
    ]);
  });

  it('faz join por (csvId,rowIdx): AS IS preserva histórico, cenário reflete a política', () => {
    const ds = computeAnalyticsDataset(canvasInputs, csvStore);
    // AS IS = histórico original
    expect(awColumn(ds, '__DECISAO_AS_IS')).toEqual(['APROVADO', 'REPROVADO', 'APROVADO']);
    // Política X aprova todas as linhas (lens sem regras → approved)
    expect(awColumn(ds, '__DECISAO_cv1')).toEqual(['APROVADO', 'APROVADO', 'APROVADO']);
  });

  it('sem canvases marcados, ainda emite AS IS global', () => {
    const ds = computeAnalyticsDataset([], csvStore);
    expect(ds.scenarios).toEqual([{ id: 'as_is', nome: 'AS IS', decisionCol: '__DECISAO_AS_IS' }]);
    expect('__DECISAO_AS_IS' in ds.columns).toBe(true);
    expect(ds.rowCount).toBe(3);
  });

  it('retorna null quando nenhum CSV tem AS IS configurado', () => {
    const noAsIs = { c9: { headers: ['mes', 'volume'], rows: [['2024-01', '10']], columnTypes: { mes: 'temporal', volume: 'qty' } } };
    __setWorkerCsvStoreForTest(noAsIs);
    expect(computeAnalyticsDataset([], noAsIs)).toBeNull();
  });

  // M15 — regressão: `dimConst`/`dimTranslate` (tabelas de tradução código→código) usam
  // objetos JS crus como cache por nome de dimensão. Um nome de dimensão que colide com
  // uma propriedade herdada de Object.prototype (ex.: "constructor") não pode ser
  // confundido com uma entrada de fato gravada nesse cache — senão o valor lido vira o
  // método herdado (uma function), não o dado real da linha.
  it('dimensão com nome igual a uma propriedade de Object.prototype não quebra a tradução', () => {
    const csvWithProtoName = {
      c1: {
        name: 'base',
        headers: ['constructor', 'volume', '__DECISAO_ORIGINAL'],
        rows: [
          ['valorA', '10', 'APROVADO'],
          ['valorB', '20', 'REPROVADO'],
        ],
        columnTypes: { volume: 'qty' },
        varTypes: {},
        asIsConfig: { col: 'dec', mapping: {} },
      },
    };
    __setWorkerCsvStoreForTest(csvWithProtoName);
    const ds = computeAnalyticsDataset([], csvWithProtoName);
    expect(ds).not.toBeNull();
    expect(awColumn(ds, 'constructor')).toEqual(['valorA', 'valorB']);
  });
});

// ── Sessão 2/3 — métricas e pivot (revalidação) ───────────────────────────────
describe('computeWidgetMetric', () => {
  const ds = makeDataset();
  it('approvalRate = aprovados / total (por coluna de decisão)', () => {
    // AS IS aprova 100+80=180 de 230
    expect(computeWidgetMetric(ds, null, 'approvalRate', '__DECISAO_AS_IS')).toBeCloseTo(180 / 230 * 100, 4);
    // Política X aprova 100+50=150 de 230
    expect(computeWidgetMetric(ds, null, 'approvalRate', '__DECISAO_cv1')).toBeCloseTo(150 / 230 * 100, 4);
  });
  it('qty é o total (independe da decisão); approvedQty acumula só aprovados', () => {
    expect(computeWidgetMetric(ds, null, 'qty', '__DECISAO_AS_IS')).toBe(230);
    expect(computeWidgetMetric(ds, null, 'approvedQty', '__DECISAO_AS_IS')).toBe(180);
  });
  it('inadReal = ∑inadRRaw / ∑qtdAltas só sobre aprovados', () => {
    // AS IS aprovados: rows 1,3 → (4+3)/(40+30) = 10%
    expect(computeWidgetMetric(ds, null, 'inadReal', '__DECISAO_AS_IS')).toBeCloseTo(10, 4);
  });
  it('approvedAltasInfer = ∑qtdAltasInfer só sobre aprovados (vendas inferidas da política)', () => {
    const cds = columnarDataset([
      { qty: 100, qtdAltasInfer: 35, __DECISAO_AS_IS: 'APROVADO' },
      { qty: 50,  qtdAltasInfer: 12, __DECISAO_AS_IS: 'REPROVADO' },
      { qty: 80,  qtdAltasInfer: 20, __DECISAO_AS_IS: 'APROVADO' },
    ]);
    // só as linhas aprovadas contribuem: 35 + 20 = 55
    expect(computeWidgetMetric(cds, null, 'approvedAltasInfer', '__DECISAO_AS_IS')).toBe(55);
  });
  it('retorna null quando o denominador é zero', () => {
    const cds = columnarDataset([{ qty: 10, __DECISAO_AS_IS: 'REPROVADO' }]);
    expect(computeWidgetMetric(cds, null, 'approvalRate', '__DECISAO_AS_IS')).toBe(0); // total>0, appr=0 → 0
    expect(computeWidgetMetric(cds, null, 'inadReal', '__DECISAO_AS_IS')).toBeNull(); // sem altas aprovadas
  });
});

describe('pivotWidget', () => {
  const ds = makeDataset();
  it('quebra por cenário e ordena o eixo X temporal cronologicamente', () => {
    const p = pivotWidget(ds, { xDimension: 'mes', metric: 'approvalRate', serieBy: '__cenario__' });
    expect(p.state).toBe('ok');
    expect(p.data.map(d => d.x)).toEqual(['2024-01', '2024-02']);
    expect(p.series.map(s => s.label)).toEqual(['AS IS', 'Política X']);
    // 2024-01: AS IS aprova só row1 (100/150); Política X aprova ambas (100%)
    expect(p.data[0]['AS IS']).toBeCloseTo(100 / 150 * 100, 4);
    expect(p.data[0]['Política X']).toBe(100);
    // 2024-02: AS IS 100%, Política X reprova (0%)
    expect(p.data[1]['AS IS']).toBe(100);
    expect(p.data[1]['Política X']).toBe(0);
  });
  it('retorna estado no_x quando falta o eixo X', () => {
    expect(pivotWidget(ds, { metric: 'approvalRate' }).state).toBe('no_x');
  });
});

// ── Sessão 5C — KPI A vs B + Export ───────────────────────────────────────────
describe('5C · resolveKpiScenarios', () => {
  const ds = makeDataset();
  it('default: A = AS IS, B = primeiro canvas (preserva leitura Simulado vs AS IS)', () => {
    const { a, b } = resolveKpiScenarios(ds.scenarios, undefined, undefined);
    expect(a.id).toBe('as_is');
    expect(b.id).toBe('cv1');
  });
  it('honra ids salvos no WidgetConfig (qualquer cenário, incl. AS IS em B)', () => {
    const { a, b } = resolveKpiScenarios(ds.scenarios, 'cv1', 'as_is');
    expect(a.id).toBe('cv1');
    expect(b.id).toBe('as_is');
  });
  it('faz fallback ao default quando um id não existe mais (cenário removido)', () => {
    const { a, b } = resolveKpiScenarios(ds.scenarios, 'sumiu', 'tambem_sumiu');
    expect(a.id).toBe('as_is');
    expect(b.id).toBe('cv1');
  });
  it('com um único cenário, A e B caem ambos nele', () => {
    const only = [{ id: 'as_is', nome: 'AS IS', decisionCol: '__DECISAO_AS_IS' }];
    const { a, b } = resolveKpiScenarios(only, undefined, undefined);
    expect(a.id).toBe('as_is');
    expect(b.id).toBe('as_is');
  });
});

describe('5C · buildAnalyticsCSV', () => {
  const ds = makeDataset();
  it('header = dimensões + métricas intrínsecas + uma coluna de decisão por cenário', () => {
    const csv = buildAnalyticsCSV(ds);
    const [header] = csv.split('\n');
    expect(header).toBe(
      'mes,score,Vol. Propostas,Altas Reais,Conv. Inferida,Inad. Real (num),Inad. Inferida (num),Decisão · AS IS,Decisão · Política X'
    );
  });
  it('emite uma linha por agrupamento com valores e decisões de todos os cenários', () => {
    const csv = buildAnalyticsCSV(ds);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(1 + 3); // header + 3 rows
    expect(lines[1]).toBe('2024-01,R1,100,40,0,4,2,APROVADO,APROVADO');
    expect(lines[3]).toBe('2024-02,R1,80,30,0,3,1,APROVADO,REPROVADO');
  });
  it('escapa valores com vírgula/aspas conforme RFC 4180', () => {
    const dirty = columnarDataset(
      [{ canal: 'a,b', qty: 1, qtdAltas: 0, qtdAltasInfer: 0, inadRRaw: 0, inadIRaw: 0, __DECISAO_AS_IS: 'APROVADO' }],
      { dimensions: ['canal'], scenarios: [{ id: 'as_is', nome: 'AS IS', decisionCol: '__DECISAO_AS_IS' }] }
    );
    const line = buildAnalyticsCSV(dirty).split('\n')[1];
    expect(line.startsWith('"a,b",')).toBe(true);
  });
  it('retorna null para dataset vazio', () => {
    expect(buildAnalyticsCSV(null)).toBeNull();
    expect(buildAnalyticsCSV(columnarDataset([], { dimensions: [], scenarios: [] }))).toBeNull();
  });
});

// ── "Configurar nó" — distinct do que efetivamente chega ──────────────────────
describe('computeNodeArrivals', () => {
  // GRUPO tem 2 valores; SCORE varia por grupo (G3 → Com/Sem; G4 → R01/R02).
  const csvStore = {
    c: {
      name: 'base',
      headers: ['GRUPO', 'SCORE', 'qty'],
      columnTypes: { GRUPO: 'decision', SCORE: 'decision', qty: 'qty' },
      rows: [
        ['G3', 'ComRestritivo', '10'],
        ['G3', 'SemRestritivo', '20'],
        ['G4', 'R01', '5'],
        ['G4', 'R02', '7'],
      ],
    },
  };

  it('um cineminha abaixo de um Decision Lens só recebe os SCORE do grupo filtrado', () => {
    const shapes = [
      { id: 'L', type: 'decision_lens', rules: [{ col: 'GRUPO', operator: 'equal', value: 'G3', logic: null }] },
      { id: 'CIN', type: 'cineminha', cinemaType: 'eligibility',
        rowVar: { col: 'SCORE', csvId: 'c' }, colVar: null,
        rowDomain: ['ComRestritivo', 'SemRestritivo', 'R01', 'R02'], colDomain: [], cells: {} },
      { id: 'elig', type: 'port', label: 'Elegível' },
      { id: 'nelig', type: 'port', label: 'Não Elegível' },
      { id: 'AP', type: 'approved' }, { id: 'RJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'a', from: 'L', to: 'CIN' },
      { id: 'b', from: 'CIN', to: 'elig', label: 'Elegível' },
      { id: 'c', from: 'CIN', to: 'nelig', label: 'Não Elegível' },
      { id: 'd', from: 'elig', to: 'AP' }, { id: 'e', from: 'nelig', to: 'RJ' },
    ];
    const arr = computeNodeArrivals(shapes, conns, csvStore, {});
    expect(arr.CIN.row).toEqual({ ComRestritivo: 10, SemRestritivo: 20 });
    expect(arr.CIN.row.R01).toBeUndefined();
    expect(arr.CIN.row.R02).toBeUndefined();
  });

  it('um losango raiz recebe todos os valores do domínio', () => {
    const shapes = [
      { id: 'D', type: 'decision', variableCol: 'GRUPO', csvId: 'c' },
      { id: 'pG3', type: 'port', label: 'G3' }, { id: 'pG4', type: 'port', label: 'G4' },
      { id: 'AP', type: 'approved' },
    ];
    const conns = [
      { id: 'a', from: 'D', to: 'pG3', label: 'G3' },
      { id: 'b', from: 'D', to: 'pG4', label: 'G4' },
      { id: 'c', from: 'pG3', to: 'AP' }, { id: 'd', from: 'pG4', to: 'AP' },
    ];
    const arr = computeNodeArrivals(shapes, conns, csvStore, {});
    expect(arr.D.val).toEqual({ G3: 30, G4: 12 });
  });

  it('um losango abaixo de um Lens só recebe os valores filtrados', () => {
    const shapes = [
      { id: 'L', type: 'decision_lens', rules: [{ col: 'GRUPO', operator: 'equal', value: 'G3', logic: null }] },
      { id: 'D', type: 'decision', variableCol: 'GRUPO', csvId: 'c' },
      { id: 'pG3', type: 'port', label: 'G3' }, { id: 'pG4', type: 'port', label: 'G4' },
      { id: 'AP', type: 'approved' },
    ];
    const conns = [
      { id: 'z', from: 'L', to: 'D' },
      { id: 'a', from: 'D', to: 'pG3', label: 'G3' },
      { id: 'b', from: 'D', to: 'pG4', label: 'G4' },
      { id: 'c', from: 'pG3', to: 'AP' }, { id: 'd', from: 'pG4', to: 'AP' },
    ];
    const arr = computeNodeArrivals(shapes, conns, csvStore, {});
    expect(arr.D.val).toEqual({ G3: 30 });
    expect(arr.D.val.G4).toBeUndefined();
  });
});

// ── Agrupamentos (dimensões derivadas) ────────────────────────────────────────
describe('Agrupamentos · autoBuckets', () => {
  it('fatia a lista ordenada em faixas de tamanho N rotuladas "primeiro–último"', () => {
    const vals = ['R01', 'R02', 'R03', 'R04', 'R05'];
    const b = autoBuckets(vals, 2);
    expect(b.map(x => x.label)).toEqual(['R01–R02', 'R03–R04', 'R05']);
    expect(b[0].values).toEqual(['R01', 'R02']);
    expect(b[2].values).toEqual(['R05']);
  });
  it('rótulo de faixa única não usa traço', () => {
    expect(autoBuckets(['A', 'B'], 1).map(x => x.label)).toEqual(['A', 'B']);
  });
  it('tamanho mínimo 1 (valores inválidos caem para 1)', () => {
    expect(autoBuckets(['A', 'B'], 0)).toHaveLength(2);
  });
});

describe('Agrupamentos · distinctDimValues', () => {
  it('retorna valores distintos ordenados, ignorando vazios', () => {
    const ds = columnarDataset([{ s: 'R02' }, { s: 'R10' }, { s: 'R02' }, { s: '' }, { s: 'R01' }], { dimensions: ['s'] });
    expect(distinctDimValues(ds, 's')).toEqual(['R01', 'R02', 'R10']);
  });
});

describe('Agrupamentos · applyGroupingsToDataset', () => {
  const base = () => columnarDataset([
    { s: 'R01', qty: 10 }, { s: 'R02', qty: 10 }, { s: 'R10', qty: 10 }, { s: 'R20', qty: 10 },
  ], {
    dimensions: ['s'],
    temporalColumns: [],
    metrics: [],
    scenarios: [],
  });
  const grouping = {
    id: 'g1', name: 'Faixa (agrup.)', source: 's',
    buckets: [
      { id: 'b1', label: 'Baixo', values: ['R01', 'R02'] },
      { id: 'b2', label: 'Alto', values: ['R10'] },
    ],
    unmatched: 'other', otherLabel: 'Outros',
  };

  it('adiciona uma coluna derivada com o rótulo do bucket por linha', () => {
    const ds = applyGroupingsToDataset(base(), [grouping]);
    expect(awColumn(ds, 'Faixa (agrup.)')).toEqual(['Baixo', 'Baixo', 'Alto', 'Outros']);
    expect(ds.dimensions).toContain('Faixa (agrup.)');
    expect(ds.groupedDimensions).toContain('Faixa (agrup.)');
  });

  it('registra a ordem dos buckets (com Outros ao fim) em dimensionOrders', () => {
    const ds = applyGroupingsToDataset(base(), [grouping]);
    expect(ds.dimensionOrders['Faixa (agrup.)']).toEqual(['Baixo', 'Alto', 'Outros']);
  });

  it('modo "keep" mantém o valor original para os não atribuídos', () => {
    const ds = applyGroupingsToDataset(base(), [{ ...grouping, unmatched: 'keep' }]);
    expect(awColumn(ds, 'Faixa (agrup.)')).toEqual(['Baixo', 'Baixo', 'Alto', 'R20']);
  });

  it('ignora agrupamento cujo nome colide com dimensão real', () => {
    const ds = applyGroupingsToDataset(base(), [{ ...grouping, name: 's' }]);
    expect(ds.groupedDimensions || []).not.toContain('s');
  });

  it('ignora agrupamento cuja base não existe mais', () => {
    const ds = applyGroupingsToDataset(base(), [{ ...grouping, source: 'inexistente' }]);
    expect(ds.dimensions).toEqual(['s']);
  });

  it('é no-op (retorna o mesmo ds) quando não há agrupamentos válidos', () => {
    const b = base();
    expect(applyGroupingsToDataset(b, [])).toBe(b);
    expect(applyGroupingsToDataset(null, [grouping])).toBeNull();
  });

  it('a dimensão derivada é usável como Eixo X no pivot, na ordem dos buckets', () => {
    const ds = applyGroupingsToDataset(columnarDataset([
      { s: 'R01', qty: 10, d: 'APROVADO' }, { s: 'R02', qty: 10, d: 'APROVADO' },
      { s: 'R10', qty: 10, d: 'APROVADO' }, { s: 'R20', qty: 10, d: 'APROVADO' },
    ], {
      dimensions: ['s'],
      scenarios: [{ id: 'as_is', nome: 'AS IS', decisionCol: 'd' }],
      metrics: [{ id: 'qty', label: 'Vol', unit: 'qty' }],
    }), [grouping]);
    const piv = pivotWidget(ds, { xDimension: 'Faixa (agrup.)', metric: 'qty', serieBy: '__none__' });
    expect(piv.state).toBe('ok');
    expect(piv.data.map(d => d.x)).toEqual(['Baixo', 'Alto', 'Outros']);
  });
});
