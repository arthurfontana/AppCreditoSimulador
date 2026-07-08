import { describe, it, expect } from 'vitest';
import {
  runSimulation,
  computeSimulatedDecisions,
  computeIncrementalResult,
  computeNodeArrivals,
  computeSimulationTick,
  computeLensPopulations,
  computeCinemaArrivals,
} from '../src/simulation.worker.js';
import { buildColumnar } from '../src/columnar.js';

// ── GATE M8 (D2) — motor "compilado" sobre códigos do dicionário ─────────────────
// O roteamento sobre base COLUNAR passa a ser pré-resolvido por dicionário
// (routeByCode / eligByPair / passByCode); sobre base legada (string[][]) continua o
// caminho por-linha. Este arquivo confere, para cada cenário, que os DOIS caminhos
// produzem exatamente o mesmo resultado — e que ambos batem com as funções de
// referência não-compiladas (runSimulation / computeNodeArrivals / o próprio caminho
// antigo em 4 passes), que seguem intocadas como valor de controle.

function toColumnarStore(store) {
  const out = {};
  for (const [id, csv] of Object.entries(store)) {
    const { columns, rowCount } = buildColumnar(csv.headers, csv.rows, csv.columnTypes);
    const { rows, ...rest } = csv;
    out[id] = { ...rest, columns, rowCount };
  }
  return out;
}

function tickOf(shapes, conns, csvStore) {
  const { populations, counts } = computeLensPopulations(shapes, csvStore);
  return {
    tick: computeSimulationTick(shapes, conns, csvStore, populations),
    populations,
    counts,
  };
}

// Compara TODOS os artefatos do motor entre a base legada (caminho por string) e a
// mesma base colunar (caminho compilado): tick fundido, populações/contagens de lens,
// overlay tipado, chegadas de cineminha — e cruza com as referências não-compiladas.
function assertCompiledEquivalent(shapes, conns, legacyStore) {
  const colStore = toColumnarStore(legacyStore);
  const legacy = tickOf(shapes, conns, legacyStore);
  const compiled = tickOf(shapes, conns, colStore);

  expect(compiled.tick.simResult).toEqual(legacy.tick.simResult);
  expect(compiled.tick.incrementalResult).toEqual(legacy.tick.incrementalResult);
  expect(compiled.tick.nodeArrivals).toEqual(legacy.tick.nodeArrivals);
  expect(compiled.counts).toEqual(legacy.counts);

  // populações por lens×csv batem byte a byte
  for (const [lensId, perCsv] of Object.entries(legacy.populations)) {
    for (const [csvId, arr] of Object.entries(perCsv)) {
      expect(Array.from(compiled.populations[lensId][csvId])).toEqual(Array.from(arr));
    }
  }

  // overlay tipado (decisões simuladas por linha)
  const ovLegacy = computeSimulatedDecisions(shapes, conns, legacyStore, legacy.populations);
  const ovCompiled = computeSimulatedDecisions(shapes, conns, colStore, compiled.populations);
  if (ovLegacy === null) expect(ovCompiled).toBeNull();
  else {
    expect(Object.keys(ovCompiled).sort()).toEqual(Object.keys(ovLegacy).sort());
    for (const csvId of Object.keys(ovLegacy)) {
      expect(Array.from(ovCompiled[csvId].sim)).toEqual(Array.from(ovLegacy[csvId].sim));
    }
    // incremental derivado do overlay compilado = incremental do tick legado
    expect(computeIncrementalResult(ovCompiled, colStore))
      .toEqual(legacy.tick.incrementalResult);
  }

  // chegadas de cineminha (Johnny)
  const arrLegacy = computeCinemaArrivals(shapes, conns, legacyStore, null);
  const arrCompiled = computeCinemaArrivals(shapes, conns, colStore, null);
  expect(arrCompiled).toEqual(arrLegacy);

  // referências NÃO-compiladas (intocadas) sobre a MESMA base colunar
  expect(compiled.tick.simResult).toEqual(runSimulation(shapes, conns, colStore));
  expect(compiled.tick.nodeArrivals).toEqual(computeNodeArrivals(shapes, conns, colStore, null));

  return { legacy, compiled };
}

describe('M8 · decision compilado (routeByCode)', () => {
  it('roteia por código com trim de rótulo/valor, first-wins em rótulo duplicado e valor sem porta', () => {
    const csvStore = {
      base: {
        name: 'base',
        headers: ['COLX', 'qty', 'qtdAltas', 'inadReal', '__DECISAO_ORIGINAL'],
        rows: [
          ['A', '100', '40', '4', 'APROVADO'],
          ['A ', '50', '20', '2', 'REPROVADO'],   // valor com espaço → trim casa a porta 'A'
          ['B', '80', '30', '3', 'APROVADO'],
          ['C', '10', '2', '0.5', ''],            // sem porta correspondente → não roteia
          ['', '7', '1', '0.1', 'REPROVADO'],     // valor vazio → não roteia (sem porta '')
        ],
        columnTypes: { COLX: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
        varTypes: {},
        asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
      },
    };
    const shapes = [
      { id: 'D', type: 'decision', variableCol: 'COLX', csvId: 'base' },
      { id: 'pA', type: 'port', label: 'A' },
      { id: 'pB', type: 'port', label: 'B' },
      { id: 'AP', type: 'approved' },
      { id: 'RJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'D', to: 'pA', label: ' A ' },  // rótulo com espaço → trim
      { id: 'c1dup', from: 'D', to: 'pB', label: 'A' }, // duplicado → first-wins (c1)
      { id: 'c2', from: 'D', to: 'pB', label: 'B' },
      { id: 'c3', from: 'pA', to: 'AP' },
      { id: 'c4', from: 'pB', to: 'RJ' },
    ];
    const { compiled } = assertCompiledEquivalent(shapes, conns, csvStore);
    // sanity: 'A' e 'A ' aprovam via c1 (first-wins); 'C'/'' não roteiam
    expect(compiled.tick.simResult.approvedQty).toBe(150);
    expect(compiled.tick.simResult.rejectedQty).toBe(80);
  });

  it('ciclo no grafo (D2 → port → D2) não trava e bate o legado', () => {
    const csvStore = {
      base: {
        name: 'base',
        headers: ['COLX', 'qty', '__DECISAO_ORIGINAL'],
        rows: [ ['LOOP', '10', 'APROVADO'], ['OK', '20', 'REPROVADO'] ],
        columnTypes: { COLX: 'decision', qty: 'qty' },
        varTypes: {},
        asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
      },
    };
    // D1 é a raiz; D2 (a jusante) tem um ciclo consigo mesmo via porta — a linha
    // 'LOOP' revisita D2 e deve parar (visited por época), sem travar o walk.
    const shapes = [
      { id: 'D1', type: 'decision', variableCol: 'COLX', csvId: 'base' },
      { id: 'p1', type: 'port', label: 'LOOP' },
      { id: 'pOK', type: 'port', label: 'OK' },
      { id: 'D2', type: 'decision', variableCol: 'COLX', csvId: 'base' },
      { id: 'p2', type: 'port', label: 'LOOP' },
      { id: 'AP', type: 'approved' },
    ];
    const conns = [
      { id: 'c1', from: 'D1', to: 'p1', label: 'LOOP' },
      { id: 'c2', from: 'D1', to: 'pOK', label: 'OK' },
      { id: 'c3', from: 'pOK', to: 'AP' },
      { id: 'c4', from: 'p1', to: 'D2' },
      { id: 'c5', from: 'D2', to: 'p2', label: 'LOOP' },
      { id: 'c6', from: 'p2', to: 'D2' },   // ciclo
    ];
    const { compiled } = assertCompiledEquivalent(shapes, conns, csvStore);
    expect(compiled.tick.simResult.approvedQty).toBe(20); // linha LOOP não termina
  });
});

describe('M8 · cineminha compilado (eligByPair/keyByPair)', () => {
  const csvStore = {
    base: {
      name: 'base',
      headers: ['GRUPO', 'FAIXA', 'MIX', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida', '__DECISAO_ORIGINAL'],
      rows: [
        ['G1', 'F1', 'BAIXO', '100', '40', '38', '4', '3.5', 'APROVADO'],
        ['G1', 'F2', 'ALTO',  '50',  '20', '18', '2', '1.8', 'REPROVADO'],
        ['G2', 'F1', 'BAIXO', '80',  '30', '28', '3', '2.5', 'APROVADO'],
        ['G2', 'F2', 'ALTO',  '20',  '5',  '4',  '1', '0.8', 'REPROVADO'],
        ['G3', 'F3', '',      '10',  '2',  '2',  '0.5', '0.4', 'APROVADO'], // fora do domínio de cells → elegível por default
      ],
      columnTypes: {
        GRUPO: 'decision', FAIXA: 'decision', MIX: 'mixRisco',
        qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer',
        inadReal: 'inadReal', inadInferida: 'inadInferida',
      },
      varTypes: {},
      asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
    },
  };

  it('2D eligibility: célula false, célula true e valor fora do domínio', () => {
    const shapes = [
      { id: 'CIN', type: 'cineminha', cinemaType: 'eligibility',
        rowVar: { col: 'GRUPO', csvId: 'base' }, colVar: { col: 'FAIXA', csvId: 'base' },
        rowDomain: ['G1', 'G2'], colDomain: ['F1', 'F2'],
        cells: { 'G1|F2': false, 'G2|F2': false } },
      { id: 'pE', type: 'port', label: 'Elegível' },
      { id: 'pN', type: 'port', label: 'Não Elegível' },
      { id: 'AP', type: 'approved' },
      { id: 'RJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'CIN', to: 'pE', label: 'Elegível' },
      { id: 'c2', from: 'CIN', to: 'pN', label: 'Não Elegível' },
      { id: 'c3', from: 'pE', to: 'AP' },
      { id: 'c4', from: 'pN', to: 'RJ' },
    ];
    const { compiled } = assertCompiledEquivalent(shapes, conns, csvStore);
    // G1|F1 (100) + G2|F1 (80) + G3|F3 fora do domínio (10, default elegível) aprovam
    expect(compiled.tick.simResult.approvedQty).toBe(190);
    expect(compiled.tick.simResult.rejectedQty).toBe(70);
  });

  it('1D (só linha) + tipo offer: ports Com/Sem Oferta', () => {
    const shapes = [
      { id: 'CIN', type: 'cineminha', cinemaType: 'offer',
        rowVar: { col: 'GRUPO', csvId: 'base' }, colVar: null,
        rowDomain: ['G1', 'G2', 'G3'], colDomain: [],
        cells: { 'G2|*': false } },
      { id: 'pC', type: 'port', label: 'Com Oferta' },
      { id: 'pS', type: 'port', label: 'Sem Oferta' },
      { id: 'AP', type: 'approved' },
      { id: 'RJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'CIN', to: 'pC', label: 'Com Oferta' },
      { id: 'c2', from: 'CIN', to: 'pS', label: 'Sem Oferta' },
      { id: 'c3', from: 'pC', to: 'AP' },
      { id: 'c4', from: 'pS', to: 'RJ' },
    ];
    const { compiled } = assertCompiledEquivalent(shapes, conns, csvStore);
    expect(compiled.tick.simResult.rejectedQty).toBe(100); // G2 = 80 + 20
  });

  it('eixo sobre coluna MÉTRICA (num) cai no caminho por-linha e bate o legado', () => {
    // qty é Float64Array na base colunar → o cineminha não compila e usa cellStr.
    const shapes = [
      { id: 'CIN', type: 'cineminha', cinemaType: 'eligibility',
        rowVar: { col: 'qty', csvId: 'base' }, colVar: null,
        rowDomain: ['10', '20', '50', '80', '100'], colDomain: [],
        cells: { '10|*': false } },
      { id: 'pE', type: 'port', label: 'Elegível' },
      { id: 'pN', type: 'port', label: 'Não Elegível' },
      { id: 'AP', type: 'approved' },
      { id: 'RJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'CIN', to: 'pE', label: 'Elegível' },
      { id: 'c2', from: 'CIN', to: 'pN', label: 'Não Elegível' },
      { id: 'c3', from: 'pE', to: 'AP' },
      { id: 'c4', from: 'pN', to: 'RJ' },
    ];
    assertCompiledEquivalent(shapes, conns, csvStore);
  });

  it('encadeado: losango → cineminha (chegadas e arrivals de Johnny idênticos)', () => {
    const shapes = [
      { id: 'D', type: 'decision', variableCol: 'GRUPO', csvId: 'base' },
      { id: 'pG1', type: 'port', label: 'G1' },
      { id: 'pG2', type: 'port', label: 'G2' },
      { id: 'CIN', type: 'cineminha', cinemaType: 'eligibility',
        rowVar: { col: 'FAIXA', csvId: 'base' }, colVar: null,
        rowDomain: ['F1', 'F2'], colDomain: [],
        cells: { 'F2|*': false } },
      { id: 'pE', type: 'port', label: 'Elegível' },
      { id: 'pN', type: 'port', label: 'Não Elegível' },
      { id: 'AP', type: 'approved' },
      { id: 'RJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'D', to: 'pG1', label: 'G1' },
      { id: 'c2', from: 'D', to: 'pG2', label: 'G2' },
      { id: 'c3', from: 'pG1', to: 'CIN' },
      { id: 'c4', from: 'pG2', to: 'RJ' },
      { id: 'c5', from: 'CIN', to: 'pE', label: 'Elegível' },
      { id: 'c6', from: 'CIN', to: 'pN', label: 'Não Elegível' },
      { id: 'c7', from: 'pE', to: 'AP' },
      { id: 'c8', from: 'pN', to: 'RJ' },
    ];
    const { compiled } = assertCompiledEquivalent(shapes, conns, csvStore);
    // sanity: só G1 chega ao cineminha (F1=100 elegível, F2=50 não)
    expect(compiled.tick.nodeArrivals.CIN.row).toEqual({ F1: 100, F2: 50 });
  });
});

describe('M8 · decision_lens compilado (passByCode)', () => {
  const csvStore = {
    base: {
      name: 'base',
      headers: ['CANAL', 'SCORE_NUM', 'GRUPO', 'qty', '__DECISAO_ORIGINAL'],
      rows: [
        ['LOJA', '650', 'G1', '100', 'APROVADO'],
        ['PAP',  '480', 'G1', '50',  'REPROVADO'],
        ['LOJA', '720', 'G2', '80',  'APROVADO'],
        ['APP',  '510', 'G2', '20',  'REPROVADO'],
        ['app',  'ABC', 'G3', '10',  ''],          // case-insensitive + valor não-numérico
      ],
      columnTypes: { CANAL: 'decision', SCORE_NUM: 'decision', GRUPO: 'decision', qty: 'qty' },
      varTypes: {},
      asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
    },
  };
  const terminalShapes = [
    { id: 'AP', type: 'approved' },
    { id: 'RJ', type: 'rejected' },
  ];

  const flowFor = (rules) => ({
    shapes: [
      { id: 'L', type: 'decision_lens', rules },
      { id: 'D', type: 'decision', variableCol: 'GRUPO', csvId: 'base' },
      { id: 'pG1', type: 'port', label: 'G1' },
      { id: 'pG2', type: 'port', label: 'G2' },
      { id: 'pG3', type: 'port', label: 'G3' },
      ...terminalShapes,
    ],
    conns: [
      { id: 'c0', from: 'L', to: 'D' },
      { id: 'c1', from: 'D', to: 'pG1', label: 'G1' },
      { id: 'c2', from: 'D', to: 'pG2', label: 'G2' },
      { id: 'c3', from: 'D', to: 'pG3', label: 'G3' },
      { id: 'c4', from: 'pG1', to: 'AP' },
      { id: 'c5', from: 'pG2', to: 'RJ' },
      { id: 'c6', from: 'pG3', to: 'AP' },
    ],
  });

  it('equal (case-insensitive) + gt numérico com AND', () => {
    const { shapes, conns } = flowFor([
      { col: 'CANAL', operator: 'equal', value: 'loja', logic: null },
      { col: 'SCORE_NUM', operator: 'gt', value: '700', logic: 'AND' },
    ]);
    assertCompiledEquivalent(shapes, conns, csvStore);
  });

  it('in (lista) com OR + notEqual', () => {
    const { shapes, conns } = flowFor([
      { col: 'CANAL', operator: 'in', value: 'PAP, App', logic: null },
      { col: 'GRUPO', operator: 'notEqual', value: 'G2', logic: 'OR' },
    ]);
    assertCompiledEquivalent(shapes, conns, csvStore);
  });

  it('lte com valor não-numérico (fallback string) + regra sobre coluna ausente', () => {
    const { shapes, conns } = flowFor([
      { col: 'SCORE_NUM', operator: 'lte', value: '510', logic: null },
      { col: 'NAO_EXISTE', operator: 'notEqual', value: 'X', logic: 'AND' },
    ]);
    assertCompiledEquivalent(shapes, conns, csvStore);
  });

  it('dois lenses independentes: populações e contagens idênticas por caminho', () => {
    const shapes = [
      { id: 'L1', type: 'decision_lens', rules: [{ col: 'CANAL', operator: 'equal', value: 'LOJA', logic: null }] },
      { id: 'L2', type: 'decision_lens', rules: [{ col: 'SCORE_NUM', operator: 'gte', value: '500', logic: null }] },
      { id: 'D', type: 'decision', variableCol: 'GRUPO', csvId: 'base' },
      { id: 'pG1', type: 'port', label: 'G1' },
      ...terminalShapes,
    ];
    const conns = [
      { id: 'c0', from: 'L1', to: 'D' },
      { id: 'c1', from: 'D', to: 'pG1', label: 'G1' },
      { id: 'c2', from: 'pG1', to: 'AP' },
      { id: 'c3', from: 'L2', to: 'RJ' },
    ];
    assertCompiledEquivalent(shapes, conns, csvStore);
  });
});

describe('M8 · terminal AS IS + múltiplos csvs', () => {
  it('roteia por __DECISAO_ORIGINAL e mantém asIsQty; csv sem raiz só contribui pro incremental', () => {
    const csvStore = {
      base: {
        name: 'base',
        headers: ['COLX', 'qty', '__DECISAO_ORIGINAL'],
        rows: [ ['X', '10', 'APROVADO'], ['X', '20', 'REPROVADO'], ['X', '30', ''] ],
        columnTypes: { COLX: 'decision', qty: 'qty' },
        varTypes: {},
        asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
      },
      noRoot: {
        name: 'noRoot',
        headers: ['qty', '__DECISAO_ORIGINAL'],
        rows: [ ['10', 'APROVADO'], ['20', 'REPROVADO'] ],
        columnTypes: { qty: 'qty' },
        varTypes: {},
        asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
      },
    };
    const shapes = [
      { id: 'D', type: 'decision', variableCol: 'COLX', csvId: 'base' },
      { id: 'pX', type: 'port', label: 'X' },
      { id: 'AS', type: 'as_is' },
    ];
    const conns = [
      { id: 'c1', from: 'D', to: 'pX', label: 'X' },
      { id: 'c2', from: 'pX', to: 'AS' },
    ];
    const { compiled } = assertCompiledEquivalent(shapes, conns, csvStore);
    expect(compiled.tick.simResult.approvedQty).toBe(10);
    expect(compiled.tick.simResult.rejectedQty).toBe(20);
    expect(compiled.tick.simResult.asIsQty).toBe(30);
  });
});

// ── Fluxo completo (lens → losango → cineminha → AS IS) — o cenário integrado ──
describe('M8 · fluxo integrado com todos os tipos de nó', () => {
  it('lens + losango + cineminha + as_is + terminais, com raízes divergentes', () => {
    const csvStore = {
      base: {
        name: 'base',
        headers: ['CANAL', 'GRUPO', 'FAIXA', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida', '__DECISAO_ORIGINAL'],
        rows: [
          ['LOJA', 'G1', 'F1', '100', '40', '38', '4', '3.5', 'APROVADO'],
          ['LOJA', 'G1', 'F2', '50', '20', '18', '2', '1.8', 'REPROVADO'],
          ['PAP', 'G2', 'F1', '80', '30', '28', '3', '2.5', 'APROVADO'],
          ['LOJA', 'G2', 'F2', '20', '5', '4', '1', '0.8', 'REPROVADO'],
          ['APP', 'G3', 'F1', '10', '2', '2', '0.5', '0.4', ''],
        ],
        columnTypes: {
          CANAL: 'decision', GRUPO: 'decision', FAIXA: 'decision',
          qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer',
          inadReal: 'inadReal', inadInferida: 'inadInferida',
        },
        varTypes: {},
        asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
      },
    };
    const shapes = [
      { id: 'L', type: 'decision_lens', rules: [{ col: 'CANAL', operator: 'notEqual', value: 'APP', logic: null }] },
      { id: 'D', type: 'decision', variableCol: 'GRUPO', csvId: 'base' },
      { id: 'pG1', type: 'port', label: 'G1' },
      { id: 'pG2', type: 'port', label: 'G2' },
      { id: 'CIN', type: 'cineminha', cinemaType: 'eligibility',
        rowVar: { col: 'FAIXA', csvId: 'base' }, colVar: { col: 'CANAL', csvId: 'base' },
        rowDomain: ['F1', 'F2'], colDomain: ['LOJA', 'PAP'],
        cells: { 'F2|LOJA': false, 'F1|PAP': false } },
      { id: 'pE', type: 'port', label: 'Elegível' },
      { id: 'pN', type: 'port', label: 'Não Elegível' },
      { id: 'AP', type: 'approved' },
      { id: 'AS', type: 'as_is' },
    ];
    const conns = [
      { id: 'c0', from: 'L', to: 'D' },
      { id: 'c1', from: 'D', to: 'pG1', label: 'G1' },
      { id: 'c2', from: 'D', to: 'pG2', label: 'G2' },
      { id: 'c3', from: 'pG1', to: 'CIN' },
      { id: 'c4', from: 'pG2', to: 'CIN' },
      { id: 'c5', from: 'CIN', to: 'pE', label: 'Elegível' },
      { id: 'c6', from: 'CIN', to: 'pN', label: 'Não Elegível' },
      { id: 'c7', from: 'pE', to: 'AP' },
      { id: 'c8', from: 'pN', to: 'AS' },
    ];
    assertCompiledEquivalent(shapes, conns, csvStore);
  });
});
