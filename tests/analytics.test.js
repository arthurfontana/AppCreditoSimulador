import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeWidgetMetric,
  pivotWidget,
  resolveKpiScenarios,
  buildAnalyticsCSV,
  cloneCanvasWithNewIds,
} from '../src/App.jsx';
import {
  computeAnalyticsDataset,
  __setWorkerCsvStoreForTest,
} from '../src/simulation.worker.js';

// ── Fixture: dataset analítico largo (DEC-AW-003) com 2 cenários ──────────────
// AS IS aprova rows 1 e 3; Política X aprova rows 1 e 2.
function makeDataset() {
  return {
    rows: [
      { mes: '2024-01', score: 'R1', qty: 100, qtdAltas: 40, qtdAltasInfer: 0, inadRRaw: 4, inadIRaw: 2, __DECISAO_AS_IS: 'APROVADO',  __DECISAO_cv1: 'APROVADO' },
      { mes: '2024-01', score: 'R2', qty: 50,  qtdAltas: 10, qtdAltasInfer: 0, inadRRaw: 5, inadIRaw: 1, __DECISAO_AS_IS: 'REPROVADO', __DECISAO_cv1: 'APROVADO' },
      { mes: '2024-02', score: 'R1', qty: 80,  qtdAltas: 30, qtdAltasInfer: 0, inadRRaw: 3, inadIRaw: 1, __DECISAO_AS_IS: 'APROVADO',  __DECISAO_cv1: 'REPROVADO' },
    ],
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
  };
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

  it('emite uma linha por agrupamento com dimensões e métricas intrínsecas', () => {
    const ds = computeAnalyticsDataset(canvasInputs, csvStore);
    expect(ds).not.toBeNull();
    expect(ds.rows).toHaveLength(3);
    expect(ds.dimensions.sort()).toEqual(['mes', 'score']);
    expect(ds.temporalColumns).toEqual(['mes']);
    expect(ds.rows[0]).toMatchObject({ mes: '2024-01', score: 'R1', qty: 100, qtdAltas: 40, inadRRaw: 4 });
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
    expect(ds.rows.map(r => r.__DECISAO_AS_IS)).toEqual(['APROVADO', 'REPROVADO', 'APROVADO']);
    // Política X aprova todas as linhas (lens sem regras → approved)
    expect(ds.rows.map(r => r.__DECISAO_cv1)).toEqual(['APROVADO', 'APROVADO', 'APROVADO']);
  });

  it('sem canvases marcados, ainda emite AS IS global', () => {
    const ds = computeAnalyticsDataset([], csvStore);
    expect(ds.scenarios).toEqual([{ id: 'as_is', nome: 'AS IS', decisionCol: '__DECISAO_AS_IS' }]);
    expect(ds.rows.every(r => '__DECISAO_AS_IS' in r)).toBe(true);
  });

  it('retorna null quando nenhum CSV tem AS IS configurado', () => {
    const noAsIs = { c9: { headers: ['mes', 'volume'], rows: [['2024-01', '10']], columnTypes: { mes: 'temporal', volume: 'qty' } } };
    __setWorkerCsvStoreForTest(noAsIs);
    expect(computeAnalyticsDataset([], noAsIs)).toBeNull();
  });
});

// ── Sessão 2/3 — métricas e pivot (revalidação) ───────────────────────────────
describe('computeWidgetMetric', () => {
  const ds = makeDataset();
  it('approvalRate = aprovados / total (por coluna de decisão)', () => {
    // AS IS aprova 100+80=180 de 230
    expect(computeWidgetMetric(ds.rows, 'approvalRate', '__DECISAO_AS_IS')).toBeCloseTo(180 / 230 * 100, 4);
    // Política X aprova 100+50=150 de 230
    expect(computeWidgetMetric(ds.rows, 'approvalRate', '__DECISAO_cv1')).toBeCloseTo(150 / 230 * 100, 4);
  });
  it('qty é o total (independe da decisão); approvedQty acumula só aprovados', () => {
    expect(computeWidgetMetric(ds.rows, 'qty', '__DECISAO_AS_IS')).toBe(230);
    expect(computeWidgetMetric(ds.rows, 'approvedQty', '__DECISAO_AS_IS')).toBe(180);
  });
  it('inadReal = ∑inadRRaw / ∑qtdAltas só sobre aprovados', () => {
    // AS IS aprovados: rows 1,3 → (4+3)/(40+30) = 10%
    expect(computeWidgetMetric(ds.rows, 'inadReal', '__DECISAO_AS_IS')).toBeCloseTo(10, 4);
  });
  it('retorna null quando o denominador é zero', () => {
    const rows = [{ qty: 10, __DECISAO_AS_IS: 'REPROVADO' }];
    expect(computeWidgetMetric(rows, 'approvalRate', '__DECISAO_AS_IS')).toBe(0); // total>0, appr=0 → 0
    expect(computeWidgetMetric(rows, 'inadReal', '__DECISAO_AS_IS')).toBeNull(); // sem altas aprovadas
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
    const dirty = {
      rows: [{ canal: 'a,b', qty: 1, qtdAltas: 0, qtdAltasInfer: 0, inadRRaw: 0, inadIRaw: 0, __DECISAO_AS_IS: 'APROVADO' }],
      dimensions: ['canal'],
      scenarios: [{ id: 'as_is', nome: 'AS IS', decisionCol: '__DECISAO_AS_IS' }],
    };
    const line = buildAnalyticsCSV(dirty).split('\n')[1];
    expect(line.startsWith('"a,b",')).toBe(true);
  });
  it('retorna null para dataset vazio', () => {
    expect(buildAnalyticsCSV(null)).toBeNull();
    expect(buildAnalyticsCSV({ rows: [], dimensions: [], scenarios: [] })).toBeNull();
  });
});
