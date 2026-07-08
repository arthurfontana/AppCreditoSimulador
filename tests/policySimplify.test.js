import { describe, it, expect } from 'vitest';
import {
  computeSimplify,
  detectSimplifyCandidates,
  computeSimplifyEquivalence,
  computeLensStats,
  computeNodeArrivals,
  runSimulation,
} from '../src/simulation.worker.js';
import { applySimplifyCandidates } from '../src/policySimplify.js';

// ── GATE — Copiloto Sessão 5 (Simplificação com prova de equivalência, DEC-IA-005/006) ──
// docs/wiki/Copiloto-SugestoesMelhoria.md pede, para tests/policySimplify.test.js:
//   1. fixture com nó colapsável ⇒ proposta reduz e computeSimulatedDecisions (aqui,
//      computeSimplifyEquivalence — a mesma técnica de diff linha a linha) diff = 0;
//   2. fixture com simplificação lossy ⇒ delta reportado corretamente;
//   3. nó com chegada zero removível.
// Testes adicionais cobrem os outros dois detectores do catálogo (regra de lens sem
// efeito, variável re-testada) e determinismo.

function arrivals(shapes, conns, csvStore) {
  return computeNodeArrivals(shapes, conns, csvStore, {});
}

// Nota de fixture: um losango/Cineminha/lens que é ele mesmo a ÚNICA raiz do fluxo (sem
// nó a montante) não pode ser colapsado direto num terminal — o motor exige pelo menos um
// nó decision/cineminha/lens como raiz pra sequer começar a andar pela linha (runSimulation:
// `rootNodes.length === 0` ⇒ nenhuma linha é processada). Por isso os fixtures abaixo
// colocam o nó colapsável ATRÁS de um losango a montante (U) — o caso realista em que a
// simplificação religa a aresta de entrada direto pro destino, preservando U como raiz.
describe('Simplificação · nó colapsável (losango) — proposta reduz, diff = 0', () => {
  const csvStore = {
    base: {
      name: 'base',
      headers: ['COLZ', 'COLX', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
      rows: [
        ['X', 'A', '100', '40', '38', '4', '3.5'],
        ['X', 'B', '50', '20', '18', '2', '1.8'],
        ['Y', 'A', '30', '10', '9', '1', '0.9'],
      ],
      columnTypes: { COLZ: 'decision', COLX: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
      varTypes: {},
      asIsConfig: null,
    },
  };
  const shapes = [
    { id: 'U', type: 'decision', variableCol: 'COLZ', csvId: 'base' },
    { id: 'pX', type: 'port', label: 'X' },
    { id: 'pY', type: 'port', label: 'Y' },
    { id: 'D', type: 'decision', variableCol: 'COLX', csvId: 'base' },
    { id: 'pA', type: 'port', label: 'A' },
    { id: 'pB', type: 'port', label: 'B' },
    { id: 'AP', type: 'approved' },
    { id: 'RJ2', type: 'rejected' },
  ];
  const conns = [
    { id: 'c1', from: 'U', to: 'pX', label: 'X' },
    { id: 'c2', from: 'U', to: 'pY', label: 'Y' },
    { id: 'c3', from: 'pX', to: 'D' },
    { id: 'c4', from: 'pY', to: 'RJ2' },
    { id: 'c5', from: 'D', to: 'pA', label: 'A' },
    { id: 'c6', from: 'D', to: 'pB', label: 'B' },
    { id: 'c7', from: 'pA', to: 'AP' },
    { id: 'c8', from: 'pB', to: 'AP' },
  ];

  it('detecta o losango D como colapsável (ambos os valores vão pro mesmo destino)', () => {
    const na = arrivals(shapes, conns, csvStore);
    const lensStats = computeLensStats(shapes, conns, csvStore);
    const candidates = detectSimplifyCandidates(shapes, conns, na, lensStats);
    expect(candidates.length).toBe(1);
    expect(candidates[0].code).toBe('collapsible_node');
    expect(candidates[0].apply).toEqual({ type: 'collapse_node', nodeId: 'D', destId: 'AP' });
  });

  it('nó travado (shape.locked) fica de fora do catálogo — mesmo padrão de trava do Goal Seek', () => {
    const lockedShapes = shapes.map(s => s.id === 'D' ? { ...s, locked: true } : s);
    const na = arrivals(lockedShapes, conns, csvStore);
    const lensStats = computeLensStats(lockedShapes, conns, csvStore);
    const candidates = detectSimplifyCandidates(lockedShapes, conns, na, lensStats);
    expect(candidates).toEqual([]);
  });

  it('computeSimplify reduz o canvas (remove D + as 2 portas) e prova diff = 0', () => {
    const na = arrivals(shapes, conns, csvStore);
    const { proposal, equivalence } = computeSimplify(shapes, conns, csvStore, na);
    expect(proposal.candidates.length).toBe(1);
    expect(proposal.removedNodeCount).toBe(3); // D, pA, pB
    expect(equivalence.identical).toBe(true);
    expect(equivalence.diffCount).toBe(0);
    expect(equivalence.delta).toBeNull();

    const { shapes: s2, conns: c2 } = applySimplifyCandidates(shapes, conns, proposal.candidates);
    expect(s2.map(s => s.id).sort()).toEqual(['AP', 'RJ2', 'U', 'pX', 'pY'].sort());
    const manual = runSimulation(s2, c2, csvStore);
    const before = runSimulation(shapes, conns, csvStore);
    expect(manual.approvedQty).toBe(before.approvedQty);
    expect(manual.rejectedQty).toBe(before.rejectedQty);
    expect(manual.approvalRate).toBeCloseTo(before.approvalRate, 9);
  });
});

describe('Simplificação · nó colapsável (Cineminha) — Elegível e Não Elegível no mesmo destino', () => {
  const csvStore = {
    base: {
      name: 'base',
      headers: ['COLZ', 'GRUPO', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
      rows: [
        ['X', 'G1', '100', '40', '38', '4', '3.5'],
        ['X', 'G2', '50', '20', '18', '2', '1.8'],
        ['Y', 'G1', '30', '10', '9', '1', '0.9'],
      ],
      columnTypes: { COLZ: 'decision', GRUPO: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
      varTypes: {},
      asIsConfig: null,
    },
  };
  const shapes = [
    { id: 'U', type: 'decision', variableCol: 'COLZ', csvId: 'base' },
    { id: 'pX', type: 'port', label: 'X' },
    { id: 'pY', type: 'port', label: 'Y' },
    { id: 'AP2', type: 'approved' },
    { id: 'CIN', type: 'cineminha', cinemaType: 'eligibility',
      rowVar: { col: 'GRUPO', csvId: 'base' }, colVar: null,
      rowDomain: ['G1', 'G2'], colDomain: [],
      cells: {} },
    { id: 'pE', type: 'port', label: 'Elegível' },
    { id: 'pN', type: 'port', label: 'Não Elegível' },
    { id: 'RJ', type: 'rejected' },
  ];
  const conns = [
    { id: 'c1', from: 'U', to: 'pX', label: 'X' },
    { id: 'c2', from: 'U', to: 'pY', label: 'Y' },
    { id: 'c3', from: 'pX', to: 'CIN' },
    { id: 'c4', from: 'pY', to: 'AP2' },
    { id: 'c5', from: 'CIN', to: 'pE', label: 'Elegível' },
    { id: 'c6', from: 'CIN', to: 'pN', label: 'Não Elegível' },
    { id: 'c7', from: 'pE', to: 'RJ' },
    { id: 'c8', from: 'pN', to: 'RJ' },
  ];

  it('colapsa o Cineminha (ambos os ports levam a Reprovado) sem mudar nenhuma decisão', () => {
    const na = arrivals(shapes, conns, csvStore);
    const lensStats = computeLensStats(shapes, conns, csvStore);
    const candidates = detectSimplifyCandidates(shapes, conns, na, lensStats);
    const cand = candidates.find(c => c.nodeId === 'CIN');
    expect(cand?.code).toBe('collapsible_node');
    expect(cand.apply).toEqual({ type: 'collapse_node', nodeId: 'CIN', destId: 'RJ' });

    const { proposal, equivalence } = computeSimplify(shapes, conns, csvStore, na);
    expect(proposal.candidates.some(c => c.nodeId === 'CIN')).toBe(true);
    expect(equivalence.identical).toBe(true);
    expect(equivalence.diffCount).toBe(0);

    const before = runSimulation(shapes, conns, csvStore);
    const { shapes: s2, conns: c2 } = applySimplifyCandidates(shapes, conns, proposal.candidates);
    const after = runSimulation(s2, c2, csvStore);
    expect(after.approvedQty).toBe(before.approvedQty);
    expect(after.rejectedQty).toBe(before.rejectedQty);
  });
});

describe('Simplificação · chegada zero — nó nunca visitado é removível', () => {
  const csvStore = {
    base: {
      name: 'base',
      // Só linhas com COLX='A' — o ramo 'B' do D1 (e tudo dependurado nele) nunca é visitado.
      headers: ['COLX', 'COLY', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
      rows: [
        ['A', 'C', '100', '40', '38', '4', '3.5'],
        ['A', 'D', '50', '20', '18', '2', '1.8'],
      ],
      columnTypes: { COLX: 'decision', COLY: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
      varTypes: {},
      asIsConfig: null,
    },
  };
  const shapes = [
    { id: 'D1', type: 'decision', variableCol: 'COLX', csvId: 'base' },
    { id: 'pA', type: 'port', label: 'A' },
    { id: 'pB', type: 'port', label: 'B' },
    { id: 'AP', type: 'approved' },
    { id: 'D2', type: 'decision', variableCol: 'COLY', csvId: 'base' }, // só alcançável via B — nunca visitado
    { id: 'pC', type: 'port', label: 'C' },
    { id: 'pD', type: 'port', label: 'D' },
    { id: 'RJ', type: 'rejected' },
  ];
  const conns = [
    { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
    { id: 'c2', from: 'D1', to: 'pB', label: 'B' },
    { id: 'c3', from: 'pA', to: 'AP' },
    { id: 'c4', from: 'pB', to: 'D2' },
    { id: 'c5', from: 'D2', to: 'pC', label: 'C' },
    { id: 'c6', from: 'D2', to: 'pD', label: 'D' },
    { id: 'c7', from: 'pC', to: 'AP' },
    { id: 'c8', from: 'pD', to: 'RJ' },
  ];

  it('nodeArrivals confirma chegada zero em D2 (nenhuma linha tem COLX=B)', () => {
    const na = arrivals(shapes, conns, csvStore);
    expect(na['D2'].val).toEqual({});
  });

  it('detecta e remove D2 (+ portas próprias pC/pD) sem alterar nenhuma decisão', () => {
    const na = arrivals(shapes, conns, csvStore);
    const lensStats = computeLensStats(shapes, conns, csvStore);
    const candidates = detectSimplifyCandidates(shapes, conns, na, lensStats);
    const pruneCand = candidates.find(c => c.code === 'zero_arrival_node' && c.nodeId === 'D2');
    expect(pruneCand).toBeTruthy();
    expect(pruneCand.apply).toEqual({ type: 'prune_node', nodeId: 'D2' });

    const { proposal, equivalence } = computeSimplify(shapes, conns, csvStore, na);
    const ids = proposal.candidates.map(c => c.nodeId);
    expect(ids).toContain('D2');
    expect(equivalence.identical).toBe(true);
    expect(equivalence.diffCount).toBe(0);

    const { shapes: s2 } = applySimplifyCandidates(shapes, conns, proposal.candidates);
    const remainingIds = new Set(s2.map(s => s.id));
    expect(remainingIds.has('D2')).toBe(false);
    expect(remainingIds.has('pC')).toBe(false);
    expect(remainingIds.has('pD')).toBe(false);
    // RJ só era alcançável através do ramo morto (D2→pD→RJ) — a cascata de poda o remove
    // também (sem entrada externa sobrevivente); não afeta a simulação, pois nunca era visitado.
    expect(remainingIds.has('RJ')).toBe(false);
    expect(remainingIds.has('AP')).toBe(true);

    const before = runSimulation(shapes, conns, csvStore);
    const { shapes: sAfter, conns: cAfter } = applySimplifyCandidates(shapes, conns, proposal.candidates);
    const after = runSimulation(sAfter, cAfter, csvStore);
    expect(after.approvedQty).toBe(before.approvedQty);
    expect(after.rejectedQty).toBe(before.rejectedQty);
  });
});

describe('Simplificação · regra de lens sem efeito (passa 100% do que chega)', () => {
  const csvStore = {
    base: {
      name: 'base',
      headers: ['COLZ', 'SCORE', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
      rows: [
        ['X', '600', '40', '15', '14', '1.5', '1.4'],
        ['X', '700', '20', '8', '7', '0.8', '0.7'],
        ['Y', '400', '10', '3', '2', '0.3', '0.2'],
      ],
      columnTypes: { COLZ: 'decision', SCORE: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
      varTypes: {},
      asIsConfig: null,
    },
  };
  const shapes = [
    { id: 'U', type: 'decision', variableCol: 'COLZ', csvId: 'base' },
    { id: 'pX', type: 'port', label: 'X' },
    { id: 'pY', type: 'port', label: 'Y' },
    { id: 'RJ3', type: 'rejected' },
    // Regra sempre verdadeira pro volume que chega por X (SCORE >= 500, mas todo o grupo X é >= 600).
    { id: 'L', type: 'decision_lens', rules: [{ col: 'SCORE', operator: 'gte', value: '500', logic: null }] },
    { id: 'AP', type: 'approved' },
  ];
  const conns = [
    { id: 'c1', from: 'U', to: 'pX', label: 'X' },
    { id: 'c2', from: 'U', to: 'pY', label: 'Y' },
    { id: 'c3', from: 'pX', to: 'L' },
    { id: 'c4', from: 'pY', to: 'RJ3' },
    { id: 'c5', from: 'L', to: 'AP' },
  ];

  it('detecta a regra como sem efeito e colapsa o lens sem mudar nenhuma decisão', () => {
    const na = arrivals(shapes, conns, csvStore);
    const lensStats = computeLensStats(shapes, conns, csvStore);
    expect(lensStats['L']).toEqual({ arrived: 60, passed: 60 });
    const candidates = detectSimplifyCandidates(shapes, conns, na, lensStats);
    const cand = candidates.find(c => c.nodeId === 'L');
    expect(cand?.code).toBe('lens_no_effect');
    expect(cand.apply).toEqual({ type: 'collapse_node', nodeId: 'L', destId: 'AP' });

    const { proposal, equivalence } = computeSimplify(shapes, conns, csvStore, na);
    expect(proposal.candidates.some(c => c.nodeId === 'L')).toBe(true);
    expect(equivalence.identical).toBe(true);

    const before = runSimulation(shapes, conns, csvStore);
    const { shapes: s2, conns: c2 } = applySimplifyCandidates(shapes, conns, proposal.candidates);
    const after = runSimulation(s2, c2, csvStore);
    expect(after.approvedQty).toBe(before.approvedQty);
    expect(after.rejectedQty).toBe(before.rejectedQty);
  });
});

describe('Simplificação · variável re-testada sem ganho', () => {
  const csvStore = {
    base: {
      name: 'base',
      headers: ['COLX', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
      rows: [
        ['A', '100', '40', '38', '4', '3.5'],
        ['B', '50', '20', '18', '2', '1.8'],
      ],
      columnTypes: { COLX: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
      varTypes: {},
      asIsConfig: null,
    },
  };
  // D1 testa COLX; o ramo 'A' cai direto num segundo losango D2 que TESTA A MESMA COLUNA
  // de novo — quem chega por esse ramo já tem COLX=='A', então o retest não discrimina nada.
  const shapes = [
    { id: 'D1', type: 'decision', variableCol: 'COLX', csvId: 'base' },
    { id: 'pA', type: 'port', label: 'A' },
    { id: 'pB', type: 'port', label: 'B' },
    { id: 'RJ', type: 'rejected' },
    { id: 'D2', type: 'decision', variableCol: 'COLX', csvId: 'base' },
    { id: 'p2A', type: 'port', label: 'A' },
    { id: 'p2B', type: 'port', label: 'B' },
    { id: 'AP', type: 'approved' },
  ];
  const conns = [
    { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
    { id: 'c2', from: 'D1', to: 'pB', label: 'B' },
    { id: 'c3', from: 'pA', to: 'D2' },
    { id: 'c4', from: 'pB', to: 'RJ' },
    { id: 'c5', from: 'D2', to: 'p2A', label: 'A' },
    { id: 'c6', from: 'D2', to: 'p2B', label: 'B' },
    { id: 'c7', from: 'p2A', to: 'AP' },
    { id: 'c8', from: 'p2B', to: 'RJ' },
  ];

  it('detecta D2 como retest redundante e reaponta a aresta direto pro destino do valor fixo', () => {
    const na = arrivals(shapes, conns, csvStore);
    const lensStats = computeLensStats(shapes, conns, csvStore);
    const candidates = detectSimplifyCandidates(shapes, conns, na, lensStats);
    const cand = candidates.find(c => c.code === 'redundant_variable');
    expect(cand).toBeTruthy();
    expect(cand.apply).toEqual({ type: 'reroute_edge', connId: 'c3', newTo: 'AP' });
  });

  it('computeSimplify aplica o reroute e prova diff = 0 contra a política original', () => {
    const na = arrivals(shapes, conns, csvStore);
    const { proposal, equivalence } = computeSimplify(shapes, conns, csvStore, na);
    expect(proposal.candidates.some(c => c.code === 'redundant_variable')).toBe(true);
    expect(equivalence.identical).toBe(true);
    expect(equivalence.diffCount).toBe(0);

    const before = runSimulation(shapes, conns, csvStore);
    const { shapes: s2, conns: c2 } = applySimplifyCandidates(shapes, conns, proposal.candidates);
    const after = runSimulation(s2, c2, csvStore);
    expect(after.approvedQty).toBe(before.approvedQty);
    expect(after.rejectedQty).toBe(before.rejectedQty);
  });
});

describe('Simplificação · prova de equivalência lossy — delta reportado corretamente', () => {
  // Testa a PRIMITIVA (computeSimplifyEquivalence) diretamente com um par de canvases que
  // NÃO decidem igual (troca deliberada de terminal) — verifica que o diffCount e o delta
  // batem com o cálculo manual via runSimulation antes/depois (mesmo padrão do GATE do
  // Goal Seek: delta declarado ≡ resimulação real, nunca estimado).
  const csvStore = {
    base: {
      name: 'base',
      headers: ['COLX', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
      rows: [
        ['A', '100', '40', '38', '4', '3.5'],
        ['B', '50', '20', '18', '2', '1.8'],
      ],
      columnTypes: { COLX: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
      varTypes: {},
      asIsConfig: null,
    },
  };
  const origShapes = [
    { id: 'D', type: 'decision', variableCol: 'COLX', csvId: 'base' },
    { id: 'pA', type: 'port', label: 'A' },
    { id: 'pB', type: 'port', label: 'B' },
    { id: 'AP', type: 'approved' },
    { id: 'RJ', type: 'rejected' },
  ];
  const origConns = [
    { id: 'c1', from: 'D', to: 'pA', label: 'A' },
    { id: 'c2', from: 'D', to: 'pB', label: 'B' },
    { id: 'c3', from: 'pA', to: 'AP' },
    { id: 'c4', from: 'pB', to: 'RJ' },
  ];
  // "Proposta" deliberadamente diferente: inverte o terminal do valor B (Reprovado→Aprovado).
  const propConns = origConns.map(c => (c.id === 'c4' ? { ...c, to: 'AP' } : c));

  it('diffCount bate com a contagem manual de linhas que mudam de decisão', () => {
    const eq = computeSimplifyEquivalence(origShapes, origConns, origShapes, propConns, csvStore);
    expect(eq.identical).toBe(false);
    // Só a linha B (qty=50, 1 "linha" na fixture) muda de decisão.
    expect(eq.diffCount).toBe(1);
    expect(eq.totalRows).toBe(2);
  });

  it('delta declarado ≡ runSimulation antes/depois (nunca estimado)', () => {
    const eq = computeSimplifyEquivalence(origShapes, origConns, origShapes, propConns, csvStore);
    const before = runSimulation(origShapes, origConns, csvStore);
    const after  = runSimulation(origShapes, propConns, csvStore);
    expect(eq.delta.approvedQty.before).toBe(before.approvedQty);
    expect(eq.delta.approvedQty.after).toBe(after.approvedQty);
    expect(eq.delta.approvedQty.delta).toBe(after.approvedQty - before.approvedQty);
    expect(eq.delta.approvedQty.delta).toBe(50); // qty da linha B, que passa a aprovar
    expect(eq.delta.rejectedQty.delta).toBe(-50);
    expect(eq.delta.approvalRate.before).toBeCloseTo(before.approvalRate, 9);
    expect(eq.delta.approvalRate.after).toBeCloseTo(after.approvalRate, 9);
  });
});

describe('Simplificação · determinismo', () => {
  const csvStore = {
    base: {
      name: 'base',
      headers: ['COLX', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
      rows: [
        ['A', '100', '40', '38', '4', '3.5'],
        ['B', '50', '20', '18', '2', '1.8'],
      ],
      columnTypes: { COLX: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
      varTypes: {},
      asIsConfig: null,
    },
  };
  const shapes = [
    { id: 'D', type: 'decision', variableCol: 'COLX', csvId: 'base' },
    { id: 'pA', type: 'port', label: 'A' },
    { id: 'pB', type: 'port', label: 'B' },
    { id: 'AP', type: 'approved' },
  ];
  const conns = [
    { id: 'c1', from: 'D', to: 'pA', label: 'A' },
    { id: 'c2', from: 'D', to: 'pB', label: 'B' },
    { id: 'c3', from: 'pA', to: 'AP' },
    { id: 'c4', from: 'pB', to: 'AP' },
  ];

  it('mesma entrada ⇒ mesma proposta', () => {
    const na = arrivals(shapes, conns, csvStore);
    const a = computeSimplify(shapes, conns, csvStore, na);
    const b = computeSimplify(shapes, conns, csvStore, na);
    expect(a).toEqual(b);
  });
});
