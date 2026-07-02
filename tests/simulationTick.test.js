import { describe, it, expect } from 'vitest';
import {
  runSimulation,
  computeSimulatedDecisions,
  computeIncrementalResult,
  computeNodeArrivals,
  computeSimulationTick,
  computeLensPopulations,
} from '../src/simulation.worker.js';

// ── GATE — equivalência do passe único do tick de edição (Otimização de Performance M6) ──
// `computeSimulationTick` funde runSimulation + computeSimulatedDecisions (overlay) +
// computeIncrementalResult + computeNodeArrivals numa única iteração por csv×linha. Este
// arquivo confere, para cada cenário, que a saída do passe único bate EXATAMENTE (deep
// equal) com a composição das quatro funções originais — que continuam intocadas/exportadas
// e são o "valor de controle" aqui.
function computeViaOldPath(shapes, conns, csvStore, inferenceRef) {
  const simResult = runSimulation(shapes, conns, csvStore, inferenceRef);
  const { populations } = computeLensPopulations(shapes, csvStore);
  const overlay = computeSimulatedDecisions(shapes, conns, csvStore, populations);
  const incrementalResult = computeIncrementalResult(overlay, csvStore, inferenceRef);
  const nodeArrivals = computeNodeArrivals(shapes, conns, csvStore, null);
  return { simResult, incrementalResult, nodeArrivals };
}

function computeViaNewPath(shapes, conns, csvStore, inferenceRef) {
  const { populations } = computeLensPopulations(shapes, csvStore);
  return computeSimulationTick(shapes, conns, csvStore, inferenceRef, populations);
}

function assertEquivalent(shapes, conns, csvStore, inferenceRef = null) {
  const oldRes = computeViaOldPath(shapes, conns, csvStore, inferenceRef);
  const newRes = computeViaNewPath(shapes, conns, csvStore, inferenceRef);
  expect(newRes.simResult).toEqual(oldRes.simResult);
  expect(newRes.incrementalResult).toEqual(oldRes.incrementalResult);
  expect(newRes.nodeArrivals).toEqual(oldRes.nodeArrivals);
  return { oldRes, newRes };
}

describe('M6 · computeSimulationTick — equivalência com o caminho antigo (4 passes)', () => {
  it('fluxo básico com AS IS: aprovação/reprovação, rToA/aToR e valor sem porta correspondente', () => {
    const csvStore = {
      base: {
        name: 'base',
        headers: ['COLX', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida', '__DECISAO_ORIGINAL'],
        rows: [
          ['A', '100', '40', '38', '4', '3.5', 'APROVADO'],   // AS IS aprovado, sim aprovado (sem impacto)
          ['A', '50',  '20', '18', '2', '1.8', 'REPROVADO'],  // AS IS reprovado → sim aprova (rToA)
          ['B', '80',  '30', '28', '3', '2.5', 'APROVADO'],   // AS IS aprovado → sim reprova (aToR)
          ['B', '20',  '5',  '4',  '1', '0.8', 'REPROVADO'],  // AS IS reprovado, sim reprovado (sem impacto)
          ['C', '10',  '2',  '2',  '0.5','0.4', ''],          // valor sem porta correspondente (não roteia)
        ],
        columnTypes: { COLX: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
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
      { id: 'c1', from: 'D',  to: 'pA', label: 'A' },
      { id: 'c2', from: 'D',  to: 'pB', label: 'B' },
      { id: 'c3', from: 'pA', to: 'AP' },
      { id: 'c4', from: 'pB', to: 'RJ' },
    ];

    const { oldRes } = assertEquivalent(shapes, conns, csvStore);
    // sanity: garante que o cenário realmente exercita rToA/aToR (não é um teste vazio)
    expect(oldRes.incrementalResult.impacted.rToA).toBe(50);
    expect(oldRes.incrementalResult.impacted.aToR).toBe(80);
  });

  it('terminal AS IS: roteia por __DECISAO_ORIGINAL e conta asIsQty quando indefinido', () => {
    const csvStore = {
      base: {
        name: 'base',
        headers: ['COLX', 'qty', '__DECISAO_ORIGINAL'],
        rows: [
          ['X', '10', 'APROVADO'],
          ['X', '20', 'REPROVADO'],
          ['X', '30', ''], // AS IS indefinido → conta como asIsQty
        ],
        columnTypes: { COLX: 'decision', qty: 'qty' },
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

    const { oldRes } = assertEquivalent(shapes, conns, csvStore);
    expect(oldRes.simResult.approvedQty).toBe(10);
    expect(oldRes.simResult.rejectedQty).toBe(20);
    expect(oldRes.simResult.asIsQty).toBe(30);
  });

  it('raízes divergentes entre simulação (1ª raiz) e chegadas por nó (todas as raízes, sem o nó abaixo do lens)', () => {
    const csvStore = {
      base: {
        name: 'base',
        headers: ['COLX', 'GRUPO', 'qty', '__DECISAO_ORIGINAL'],
        rows: [
          ['A', 'G3', '10', 'APROVADO'],
          ['B', 'G3', '20', 'REPROVADO'],
          ['A', 'G4', '30', 'APROVADO'],
          ['C', 'G4', '5',  'REPROVADO'], // COLX sem porta correspondente em D1
        ],
        columnTypes: { COLX: 'decision', GRUPO: 'decision', qty: 'qty' },
        varTypes: {},
        asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
      },
    };
    // D1 é a 1ª raiz (usada pela simulação/overlay). L2→CIN2 é uma 2ª cadeia de fluxo
    // independente para o mesmo csv: CIN2 fica abaixo de um Decision Lens (sem port entre
    // eles), então é raiz para a simulação (só exclui incoming de port) mas NÃO é raiz para
    // as chegadas por nó (critério mais estrito, exclui qualquer emissor de fluxo).
    const shapes = [
      { id: 'D1',  type: 'decision', variableCol: 'COLX', csvId: 'base' },
      { id: 'pA',  type: 'port', label: 'A' },
      { id: 'pB',  type: 'port', label: 'B' },
      { id: 'AP',  type: 'approved' },
      { id: 'RJ',  type: 'rejected' },
      { id: 'L2',  type: 'decision_lens', rules: [{ col: 'GRUPO', operator: 'equal', value: 'G3', logic: null }] },
      { id: 'CIN2', type: 'cineminha', cinemaType: 'eligibility',
        rowVar: { col: 'GRUPO', csvId: 'base' }, colVar: null,
        rowDomain: ['G3', 'G4'], colDomain: [], cells: {} },
      { id: 'pElig',  type: 'port', label: 'Elegível' },
      { id: 'pNelig', type: 'port', label: 'Não Elegível' },
      { id: 'AP2', type: 'approved' },
      { id: 'RJ2', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
      { id: 'c2', from: 'D1', to: 'pB', label: 'B' },
      { id: 'c3', from: 'pA', to: 'AP' },
      { id: 'c4', from: 'pB', to: 'RJ' },
      { id: 'c5', from: 'L2', to: 'CIN2' },
      { id: 'c6', from: 'CIN2', to: 'pElig',  label: 'Elegível' },
      { id: 'c7', from: 'CIN2', to: 'pNelig', label: 'Não Elegível' },
      { id: 'c8', from: 'pElig',  to: 'AP2' },
      { id: 'c9', from: 'pNelig', to: 'RJ2' },
    ];

    const { oldRes } = assertEquivalent(shapes, conns, csvStore);
    // sanity: CIN2 só recebe as linhas do grupo G3 (via L2), não G4
    expect(oldRes.nodeArrivals.CIN2.row).toEqual({ G3: 30 });
    // sanity: D1 (usado pela simulação) recebe todos os valores de COLX (inclusive 'C', sem porta)
    expect(oldRes.nodeArrivals.D1.val).toEqual({ A: 40, B: 20, C: 5 });
  });

  it('múltiplos csvs: um sem raiz de fluxo (mas com AS IS) e outro com raiz (mas sem AS IS)', () => {
    const csvStore = {
      // csv "noRoot": tem AS IS configurado mas nenhum nó do canvas lê esse csvId —
      // contribui para o incremental (baseline===simulado) mas NADA para totalQty/edgeStats.
      noRoot: {
        name: 'noRoot',
        headers: ['qty', '__DECISAO_ORIGINAL'],
        rows: [ ['10', 'APROVADO'], ['20', 'REPROVADO'] ],
        columnTypes: { qty: 'qty' },
        varTypes: {},
        asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
      },
      // csv "noAsIs": tem raiz de fluxo mas nenhum AS IS configurado — contribui para a
      // simulação normalmente, mas não entra no incremental.
      noAsIs: {
        name: 'noAsIs',
        headers: ['COLY', 'qty'],
        rows: [ ['Y', '15'], ['Z', '25'] ],
        columnTypes: { COLY: 'decision', qty: 'qty' },
        varTypes: {},
        asIsConfig: null,
      },
    };
    const shapes = [
      { id: 'D', type: 'decision', variableCol: 'COLY', csvId: 'noAsIs' },
      { id: 'pY', type: 'port', label: 'Y' },
      { id: 'pZ', type: 'port', label: 'Z' },
      { id: 'AP', type: 'approved' },
      { id: 'RJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'D', to: 'pY', label: 'Y' },
      { id: 'c2', from: 'D', to: 'pZ', label: 'Z' },
      { id: 'c3', from: 'pY', to: 'AP' },
      { id: 'c4', from: 'pZ', to: 'RJ' },
    ];

    const { oldRes } = assertEquivalent(shapes, conns, csvStore);
    // sanity: "noRoot" nunca roteia (sem raiz) mas ainda soma no incremental
    expect(oldRes.incrementalResult.baseline.totalQty).toBe(oldRes.incrementalResult.simulated.totalQty);
    expect(oldRes.incrementalResult.impacted.qty).toBe(0);
    // sanity: só "noAsIs" contribui para totalQty da simulação
    expect(oldRes.simResult.totalQty).toBe(40);
  });

  it('sem nenhuma raiz no canvas inteiro: simResult degenerado, mas incremental ainda é computado', () => {
    const csvStore = {
      base: {
        name: 'base',
        headers: ['qty', '__DECISAO_ORIGINAL'],
        rows: [ ['10', 'APROVADO'], ['20', 'REPROVADO'] ],
        columnTypes: { qty: 'qty' },
        varTypes: {},
        asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
      },
    };
    // Nenhum shape de decisão/cineminha/lens — só terminais soltos.
    const shapes = [ { id: 'AP', type: 'approved' }, { id: 'RJ', type: 'rejected' } ];
    const conns = [];

    const { oldRes } = assertEquivalent(shapes, conns, csvStore);
    expect(oldRes.simResult).toEqual({
      totalQty: 0, approvedQty: 0, rejectedQty: 0, asIsQty: 0,
      approvalRate: 0, inadReal: null, inadInferida: null, edgeStats: {},
    });
    expect(oldRes.incrementalResult.baseline).toEqual(oldRes.incrementalResult.simulated);
  });

  it('inferência via Tabela de Referência (modo ref): confiabVolume, anyRefSource e inferenceWeightMode', () => {
    const inferenceRef = {
      name: 'REF', importedAt: 0,
      keyCols: ['SCORE'], anchorCol: 'SCORE',
      levels: {
        1: new Map([
          ['R01', { conv: 0.5, fpd: 0.1, confiab: 'ALTA' }],
          ['R20', { conv: 0.3, fpd: 0.2, confiab: 'BAIXA' }],
        ]),
      },
      global: { conv: 0.4, fpd: 0.15, confiab: 'GLOBAL' },
      levelKeyCount: { 1: 1 },
      rowCount: 2,
    };
    const csvStore = {
      base: {
        name: 'base',
        headers: ['COLX', 'SCORE_BASE', 'qty', '__DECISAO_ORIGINAL'],
        rows: [
          ['A', 'R01', '100', 'APROVADO'], // score direto, confiab ALTA
          ['A', 'R99', '50',  'REPROVADO'], // normaliza para R20, confiab BAIXA
          ['B', '',    '20',  ''],          // score vazio → normaliza para R20 também
        ],
        columnTypes: { COLX: 'decision', qty: 'qty' },
        varTypes: {},
        asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
        inferenceConfig: { source: 'ref', keyMap: { SCORE: 'SCORE_BASE' }, weightCol: 'qty', weightMode: 'propostas', normalizeScore: true },
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
      { id: 'c1', from: 'D',  to: 'pA', label: 'A' },
      { id: 'c2', from: 'D',  to: 'pB', label: 'B' },
      { id: 'c3', from: 'pA', to: 'AP' },
      { id: 'c4', from: 'pB', to: 'RJ' },
    ];

    const { oldRes } = assertEquivalent(shapes, conns, csvStore, inferenceRef);
    expect(oldRes.simResult.inferenceSource).toBe('ref');
    expect(oldRes.simResult.inferenceWeightMode).toBe('propostas');
    expect(oldRes.simResult.confiabVolume.ALTA).toBeGreaterThan(0);
  });
});
