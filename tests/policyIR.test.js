import { describe, it, expect } from 'vitest';
import { buildPolicyIR, applyPolicyPatch } from '../src/App.jsx';
import {
  computeSimulationTick,
  computeSimulatedDecisions,
  computeLensPopulations,
} from '../src/simulation.worker.js';
import { buildColumnar } from '../src/columnar.js';

// ── GATE Sessão 0 do Copiloto (PolicyIR — DEC-IA-002) ────────────────────────────
// O PolicyIR é a representação canônica da política, DERIVADA de shapes/conns
// (buildPolicyIR) e materializada de volta por um único aplicador (applyPolicyPatch).
// Este GATE confere, sobre as MESMAS fixtures do GATE do motor compilado
// (tests/compiledEngine.test.js):
//   1. Roteamento via IR ≡ motor compilado (M8): simular o canvas materializado do IR
//      = simular o canvas original, incluindo a decisão simulada POR LINHA;
//   2. Round-trip IR→canvas→IR estável (igualdade estrutural, módulo renomeação de IDs);
//   3. IR livre de posições x/y e de dados linha a linha.

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
  const { populations } = computeLensPopulations(shapes, csvStore);
  return {
    tick: computeSimulationTick(shapes, conns, csvStore, populations),
    populations,
  };
}

// Canonicaliza um IR para comparação estrutural: remove generatedAt e renomeia os IDs
// de nó posicionalmente (n0, n1, ...), reescrevendo todas as referências (routes/to/entry).
function canonIR(ir) {
  const rename = {};
  ir.nodes.forEach((n, i) => { rename[n.id] = `n${i}`; });
  const mapId = (id) => (id == null ? null : (rename[id] ?? id));
  const { generatedAt, ...rest } = ir;
  return {
    ...rest,
    nodes: ir.nodes.map(n => {
      const c = { ...n, id: mapId(n.id) };
      if (n.kind === 'decision') c.routes = n.routes.map(rt => ({ ...rt, to: mapId(rt.to) }));
      if (n.kind === 'cinema') c.routes = { eligible: mapId(n.routes.eligible), notEligible: mapId(n.routes.notEligible) };
      if (n.kind === 'lens') c.to = mapId(n.to);
      return c;
    }),
    entry: ir.entry.map(mapId),
  };
}

// GATE central: (1) roteamento original ≡ roteamento do canvas materializado do IR
// (agregados, incremental, chegadas por nó via idMap e decisão POR LINHA) e
// (2) round-trip IR→canvas→IR estável. Retorna os artefatos p/ asserts extras.
function assertIREquivalent(shapes, conns, legacyStore) {
  const csvStore = toColumnarStore(legacyStore);
  const ir = buildPolicyIR(shapes, conns, csvStore);
  const { shapes: irShapes, conns: irConns, idMap } = applyPolicyPatch(ir);

  const orig = tickOf(shapes, conns, csvStore);
  const mat = tickOf(irShapes, irConns, csvStore);

  // Agregados do tick (edgeStats fica de fora: é chaveado por IDs de conexão,
  // que são novos por construção no canvas materializado).
  const { edgeStats: _a, ...aggOrig } = orig.tick.simResult;
  const { edgeStats: _b, ...aggMat } = mat.tick.simResult;
  expect(aggMat).toEqual(aggOrig);
  expect(mat.tick.incrementalResult).toEqual(orig.tick.incrementalResult);

  // Chegadas por nó — módulo idMap (os nós materializados têm IDs novos).
  const mappedArrivals = {};
  for (const [nid, v] of Object.entries(orig.tick.nodeArrivals)) mappedArrivals[idMap[nid] ?? nid] = v;
  expect(mat.tick.nodeArrivals).toEqual(mappedArrivals);

  // Decisão simulada POR LINHA idêntica — a prova mais forte de "sem perda de roteamento".
  const ovOrig = computeSimulatedDecisions(shapes, conns, csvStore, orig.populations);
  const ovMat = computeSimulatedDecisions(irShapes, irConns, csvStore, mat.populations);
  if (ovOrig === null) expect(ovMat).toBeNull();
  else {
    expect(Object.keys(ovMat).sort()).toEqual(Object.keys(ovOrig).sort());
    for (const csvId of Object.keys(ovOrig)) {
      expect(Array.from(ovMat[csvId].sim)).toEqual(Array.from(ovOrig[csvId].sim));
    }
  }

  // Round-trip: o IR do canvas materializado é o MESMO IR (módulo renomeação de IDs).
  const ir2 = buildPolicyIR(irShapes, irConns, csvStore);
  expect(canonIR(ir2)).toEqual(canonIR(ir));

  return { ir, irShapes, irConns, idMap, tick: mat.tick, csvStore };
}

// ── Fixtures — as mesmas do GATE do motor compilado (tests/compiledEngine.test.js) ──

const CINEMA_STORE = {
  base: {
    name: 'base',
    headers: ['GRUPO', 'FAIXA', 'MIX', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida', '__DECISAO_ORIGINAL'],
    rows: [
      ['G1', 'F1', 'BAIXO', '100', '40', '38', '4', '3.5', 'APROVADO'],
      ['G1', 'F2', 'ALTO',  '50',  '20', '18', '2', '1.8', 'REPROVADO'],
      ['G2', 'F1', 'BAIXO', '80',  '30', '28', '3', '2.5', 'APROVADO'],
      ['G2', 'F2', 'ALTO',  '20',  '5',  '4',  '1', '0.8', 'REPROVADO'],
      ['G3', 'F3', '',      '10',  '2',  '2',  '0.5', '0.4', 'APROVADO'],
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

const LENS_STORE = {
  base: {
    name: 'base',
    headers: ['CANAL', 'SCORE_NUM', 'GRUPO', 'qty', '__DECISAO_ORIGINAL'],
    rows: [
      ['LOJA', '650', 'G1', '100', 'APROVADO'],
      ['PAP',  '480', 'G1', '50',  'REPROVADO'],
      ['LOJA', '720', 'G2', '80',  'APROVADO'],
      ['APP',  '510', 'G2', '20',  'REPROVADO'],
      ['app',  'ABC', 'G3', '10',  ''],
    ],
    columnTypes: { CANAL: 'decision', SCORE_NUM: 'decision', GRUPO: 'decision', qty: 'qty' },
    varTypes: {},
    asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
  },
};

const lensFlowFor = (rules) => ({
  shapes: [
    { id: 'L', type: 'decision_lens', rules },
    { id: 'D', type: 'decision', variableCol: 'GRUPO', csvId: 'base' },
    { id: 'pG1', type: 'port', label: 'G1' },
    { id: 'pG2', type: 'port', label: 'G2' },
    { id: 'pG3', type: 'port', label: 'G3' },
    { id: 'AP', type: 'approved' },
    { id: 'RJ', type: 'rejected' },
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

describe('PolicyIR · decision (trim, first-wins, valor sem porta)', () => {
  it('roteamento via IR ≡ motor compilado + round-trip estável', () => {
    const legacyStore = {
      base: {
        name: 'base',
        headers: ['COLX', 'qty', 'qtdAltas', 'inadReal', '__DECISAO_ORIGINAL'],
        rows: [
          ['A', '100', '40', '4', 'APROVADO'],
          ['A ', '50', '20', '2', 'REPROVADO'],
          ['B', '80', '30', '3', 'APROVADO'],
          ['C', '10', '2', '0.5', ''],
          ['', '7', '1', '0.1', 'REPROVADO'],
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
      { id: 'c1', from: 'D', to: 'pA', label: ' A ' },   // trim
      { id: 'c1dup', from: 'D', to: 'pB', label: 'A' },  // duplicado → first-wins
      { id: 'c2', from: 'D', to: 'pB', label: 'B' },
      { id: 'c3', from: 'pA', to: 'AP' },
      { id: 'c4', from: 'pB', to: 'RJ' },
    ];
    const { ir, tick } = assertIREquivalent(shapes, conns, legacyStore);
    expect(tick.simResult.approvedQty).toBe(150);
    expect(tick.simResult.rejectedQty).toBe(80);
    // first-wins achatado: 'A' → AP (c1), 'B' → RJ; o duplicado c1dup não gera rota.
    const dec = ir.nodes.find(n => n.kind === 'decision');
    expect(dec.routes).toEqual([
      { values: ['A'], to: 'AP' },
      { values: ['B'], to: 'RJ' },
    ]);
  });

  it('ciclo no grafo (D2 → port → D2) sobrevive ao achatamento e bate o motor', () => {
    const legacyStore = {
      base: {
        name: 'base',
        headers: ['COLX', 'qty', '__DECISAO_ORIGINAL'],
        rows: [['LOOP', '10', 'APROVADO'], ['OK', '20', 'REPROVADO']],
        columnTypes: { COLX: 'decision', qty: 'qty' },
        varTypes: {},
        asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
      },
    };
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
    const { ir, tick } = assertIREquivalent(shapes, conns, legacyStore);
    expect(tick.simResult.approvedQty).toBe(20);
    // o ciclo vira auto-referência no IR (D2 → D2)
    const d2 = ir.nodes.find(n => n.kind === 'decision' && n.id === 'D2');
    expect(d2.routes).toEqual([{ values: ['LOOP'], to: 'D2' }]);
  });
});

describe('PolicyIR · cineminha (blockedCells, 1D/2D, offer, eixo métrico)', () => {
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
    const { ir, tick } = assertIREquivalent(shapes, conns, CINEMA_STORE);
    expect(tick.simResult.approvedQty).toBe(190);
    expect(tick.simResult.rejectedQty).toBe(70);
    const cin = ir.nodes.find(n => n.kind === 'cinema');
    expect(cin.blockedCells).toEqual(['G1|F2', 'G2|F2']); // ordenado, só as NÃO elegíveis
    expect(cin.routes).toEqual({ eligible: 'AP', notEligible: 'RJ' });
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
    const { tick } = assertIREquivalent(shapes, conns, CINEMA_STORE);
    expect(tick.simResult.rejectedQty).toBe(100);
  });

  it('eixo sobre coluna MÉTRICA (num) — caminho por-linha do motor — bate igual', () => {
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
    assertIREquivalent(shapes, conns, CINEMA_STORE);
  });

  it('encadeado: losango → cineminha', () => {
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
    const { tick, idMap } = assertIREquivalent(shapes, conns, CINEMA_STORE);
    expect(tick.nodeArrivals[idMap.CIN].row).toEqual({ F1: 100, F2: 50 });
  });
});

describe('PolicyIR · decision_lens (regras, dois lenses independentes)', () => {
  it('equal (case-insensitive) + gt numérico com AND', () => {
    const { shapes, conns } = lensFlowFor([
      { col: 'CANAL', operator: 'equal', value: 'loja', logic: null },
      { col: 'SCORE_NUM', operator: 'gt', value: '700', logic: 'AND' },
    ]);
    assertIREquivalent(shapes, conns, LENS_STORE);
  });

  it('in (lista) com OR + notEqual', () => {
    const { shapes, conns } = lensFlowFor([
      { col: 'CANAL', operator: 'in', value: 'PAP, App', logic: null },
      { col: 'GRUPO', operator: 'notEqual', value: 'G2', logic: 'OR' },
    ]);
    assertIREquivalent(shapes, conns, LENS_STORE);
  });

  it('lte com valor não-numérico + regra sobre coluna ausente', () => {
    const { shapes, conns } = lensFlowFor([
      { col: 'SCORE_NUM', operator: 'lte', value: '510', logic: null },
      { col: 'NAO_EXISTE', operator: 'notEqual', value: 'X', logic: 'AND' },
    ]);
    assertIREquivalent(shapes, conns, LENS_STORE);
  });

  it('dois lenses independentes (raízes preservadas na ordem)', () => {
    const shapes = [
      { id: 'L1', type: 'decision_lens', rules: [{ col: 'CANAL', operator: 'equal', value: 'LOJA', logic: null }] },
      { id: 'L2', type: 'decision_lens', rules: [{ col: 'SCORE_NUM', operator: 'gte', value: '500', logic: null }] },
      { id: 'D', type: 'decision', variableCol: 'GRUPO', csvId: 'base' },
      { id: 'pG1', type: 'port', label: 'G1' },
      { id: 'AP', type: 'approved' },
      { id: 'RJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c0', from: 'L1', to: 'D' },
      { id: 'c1', from: 'D', to: 'pG1', label: 'G1' },
      { id: 'c2', from: 'pG1', to: 'AP' },
      { id: 'c3', from: 'L2', to: 'RJ' },
    ];
    const { ir } = assertIREquivalent(shapes, conns, LENS_STORE);
    // entry preserva o critério e a ordem do motor: L1, L2 e D (D é alvo de lens,
    // não de port — continua candidato a raiz; a simulação usa a 1ª por csv).
    expect(ir.entry).toEqual(['L1', 'L2', 'D']);
  });
});

describe('PolicyIR · terminal AS IS + múltiplos csvs', () => {
  const legacyStore = {
    base: {
      name: 'base',
      headers: ['COLX', 'qty', '__DECISAO_ORIGINAL'],
      rows: [['X', '10', 'APROVADO'], ['X', '20', 'REPROVADO'], ['X', '30', '']],
      columnTypes: { COLX: 'decision', qty: 'qty' },
      varTypes: {},
      asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
    },
    noRoot: {
      name: 'noRoot',
      headers: ['qty', '__DECISAO_ORIGINAL'],
      rows: [['10', 'APROVADO'], ['20', 'REPROVADO']],
      columnTypes: { qty: 'qty' },
      varTypes: {},
      asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
    },
  };
  it('roteia por __DECISAO_ORIGINAL; csv sem raiz só contribui pro incremental', () => {
    const shapes = [
      { id: 'D', type: 'decision', variableCol: 'COLX', csvId: 'base' },
      { id: 'pX', type: 'port', label: 'X' },
      { id: 'AS', type: 'as_is' },
    ];
    const conns = [
      { id: 'c1', from: 'D', to: 'pX', label: 'X' },
      { id: 'c2', from: 'pX', to: 'AS' },
    ];
    const { tick } = assertIREquivalent(shapes, conns, legacyStore);
    expect(tick.simResult.approvedQty).toBe(10);
    expect(tick.simResult.rejectedQty).toBe(20);
    expect(tick.simResult.asIsQty).toBe(30);
  });
});

// ── Fluxo integrado (lens → losango → cineminha → AS IS) ─────────────────────────
const INTEGRATED_STORE = {
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
const integratedFlow = () => ({
  shapes: [
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
  ],
  conns: [
    { id: 'c0', from: 'L', to: 'D' },
    { id: 'c1', from: 'D', to: 'pG1', label: 'G1' },
    { id: 'c2', from: 'D', to: 'pG2', label: 'G2' },
    { id: 'c3', from: 'pG1', to: 'CIN' },
    { id: 'c4', from: 'pG2', to: 'CIN' },
    { id: 'c5', from: 'CIN', to: 'pE', label: 'Elegível' },
    { id: 'c6', from: 'CIN', to: 'pN', label: 'Não Elegível' },
    { id: 'c7', from: 'pE', to: 'AP' },
    { id: 'c8', from: 'pN', to: 'AS' },
  ],
});

describe('PolicyIR · fluxo integrado com todos os tipos de nó', () => {
  it('lens + losango + cineminha + as_is: roteamento e round-trip', () => {
    const { shapes, conns } = integratedFlow();
    assertIREquivalent(shapes, conns, INTEGRATED_STORE);
  });
});

// ── Regras do IR: sem posições x/y, sem dados linha a linha ──────────────────────
describe('PolicyIR · IR livre de posições e de dados', () => {
  const { shapes, conns } = integratedFlow();
  // shapes COM posições (como no canvas real) — o IR precisa descartá-las
  const positioned = shapes.map((s, i) => ({ ...s, x: 100 + i * 50, y: 200, w: 144, h: 82 }));
  const csvStore = toColumnarStore(INTEGRATED_STORE);
  const ir = buildPolicyIR(positioned, conns, csvStore);

  const collectKeys = (obj, acc = new Set()) => {
    if (Array.isArray(obj)) { obj.forEach(v => collectKeys(v, acc)); return acc; }
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) { acc.add(k); collectKeys(v, acc); }
    }
    return acc;
  };

  it('nenhuma chave de layout ou de dado bruto em lugar nenhum do IR', () => {
    const keys = collectKeys(ir);
    for (const k of ['x', 'y', 'w', 'h', 'color', 'rows', 'codes', 'data', 'dict', 'cells']) {
      expect(keys.has(k), `chave proibida no IR: ${k}`).toBe(false);
    }
  });

  it('estrutura canônica: chaves exatas do topo, dos nós e dos metadados de coluna', () => {
    expect(Object.keys(ir).sort()).toEqual(['datasets', 'entry', 'generatedAt', 'kind', 'name', 'nodes', 'version']);
    expect(ir.kind).toBe('policy-ir');
    expect(ir.version).toBe('1.0');
    const byKind = Object.fromEntries(ir.nodes.map(n => [n.kind, n]));
    expect(Object.keys(byKind.decision).sort()).toEqual(['id', 'kind', 'label', 'routes', 'variable']);
    expect(Object.keys(byKind.cinema).sort()).toEqual(['blockedCells', 'cinemaType', 'colDomain', 'colVar', 'id', 'kind', 'label', 'routes', 'rowDomain', 'rowVar']);
    expect(Object.keys(byKind.lens).sort()).toEqual(['id', 'kind', 'label', 'rules', 'to']);
    expect(Object.keys(byKind.terminal).sort()).toEqual(['id', 'kind', 'label', 'terminal']);
    for (const ds of ir.datasets) {
      expect(Object.keys(ds).sort()).toEqual(['columns', 'csvId', 'name']);
      for (const col of ds.columns) {
        expect(Object.keys(col).sort()).toEqual(['colType', 'domainSize', 'name', 'varType']);
      }
    }
  });

  it('é JSON puro e serializável (round-trip por JSON.stringify)', () => {
    expect(JSON.parse(JSON.stringify(ir))).toEqual(ir);
  });
});

// ── applyPolicyPatch: patch parcial em canvas existente + IDs sem colisão ────────
describe('PolicyIR · applyPolicyPatch em canvas existente', () => {
  it('anexa nós novos, referencia nó do canvas base e não colide IDs', () => {
    // canvas base: um terminal já existente que o patch quer reaproveitar
    const base = {
      shapes: [{ id: 'AP_base', type: 'approved', x: 900, y: 100, w: 120, h: 44, label: 'Aprovado' }],
      conns: [],
    };
    const patch = {
      nodes: [
        { id: 'n_dec', kind: 'decision', label: 'GRUPO', variable: { col: 'GRUPO', csvId: 'base' },
          routes: [{ values: ['G1'], to: 'AP_base' }, { values: ['G2'], to: 'n_rej' }] },
        { id: 'n_rej', kind: 'terminal', label: 'Reprovado', terminal: 'rejected' },
      ],
    };
    const { shapes, conns, idMap } = applyPolicyPatch(patch, base);
    // base preservado intacto + shapes novos anexados
    expect(shapes[0]).toEqual(base.shapes[0]);
    expect(shapes.length).toBeGreaterThan(base.shapes.length);
    // IDs todos únicos (contador _id compartilhado)
    const allIds = [...shapes.map(s => s.id), ...conns.map(c => c.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
    // rota G1 aponta para o terminal do canvas BASE; G2 para o terminal do patch
    const dec = shapes.find(s => s.id === idMap.n_dec);
    expect(dec.type).toBe('decision');
    const portG1 = shapes.find(s => s.type === 'port' && s.label === 'G1');
    const portG2 = shapes.find(s => s.type === 'port' && s.label === 'G2');
    expect(conns.find(c => c.from === portG1.id).to).toBe('AP_base');
    expect(conns.find(c => c.from === portG2.id).to).toBe(idMap.n_rej);
    // patch vazio → no-op estrutural
    const empty = applyPolicyPatch({ nodes: [] }, base);
    expect(empty.shapes).toEqual(base.shapes);
    expect(empty.conns).toEqual(base.conns);
  });
});
