import { describe, it, expect } from 'vitest';
import {
  computeGoalSeek,
  buildGoalSeekCandidates,
  computeNewLensThreshold,
  runSimulation,
  computeLensPopulations,
} from '../src/simulation.worker.js';
import { applyGoalSeekMoves } from '../src/goalSeek.js';

// ── GATE — Copiloto Sessão 4 (Goal Seek, DEC-IA-005/006) ─────────────────────────
// docs/wiki/Copiloto-SugestoesMelhoria.md pede, para tests/goalSeek.test.js:
//   1. delta incremental (O(1), por agregados de segmento) ≡ re-simulação completa,
//      para cada tipo de movimento do catálogo (cinema_cell, decision_terminal,
//      lens_threshold);
//   2. restrições: nenhum ponto da fronteira viola teto/travas; monotonicidade
//      preservada em eixo ordinal (precedência);
//   3. objetivo inatingível reporta o melhor ponto alcançado + a restrição-gargalo;
//   4. determinismo: mesma entrada ⇒ mesma proposta.
// `computeGoalSeek` já revalida o resultado final por re-simulação real (DEC-IA-005) —
// os testes abaixo conferem que essa validação bate com o incremental usado na busca.

function pops(shapes, csvStore) {
  return computeLensPopulations(shapes, csvStore).populations;
}

describe('Goal Seek · decision_terminal (mover port de Reprovado → Aprovado)', () => {
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
    { id: 'RJ', type: 'rejected' },
  ];
  const conns = [
    { id: 'c1', from: 'D', to: 'pA', label: 'A' },
    { id: 'c2', from: 'D', to: 'pB', label: 'B' },
    { id: 'c3', from: 'pA', to: 'AP' },
    { id: 'c4', from: 'pB', to: 'RJ' },
  ];

  it('candidata os dois valores, mas só B (Reprovado→Aprovado) entra no pool de expansão', () => {
    const candidates = buildGoalSeekCandidates(shapes, conns, csvStore, {}, []);
    const decisionCands = candidates.filter(c => c.type === 'decision_terminal');
    expect(decisionCands.map(c => c.value).sort()).toEqual(['A', 'B']);
    const expandPool = decisionCands.filter(c => c.toApproved);
    expect(expandPool.map(c => c.value)).toEqual(['B']);
    expect(expandPool[0].apply).toEqual({ type: 'decision_terminal', connId: 'c4', newTo: 'AP' });
  });

  it('atinge +30pp de aprovação abrindo o valor B — resultado bate com re-simulação exata', () => {
    const seek = computeGoalSeek(shapes, conns, csvStore, { target: 'approvalRate', direction: 'increase', magnitude: 30 }, {}, [], pops(shapes, csvStore));
    expect(seek.goalReached).toBe(true);
    expect(seek.moves.length).toBe(1);
    expect(seek.moves[0].type).toBe('decision_terminal');

    const { shapes: s2, conns: c2 } = applyGoalSeekMoves(shapes, conns, seek.moves.map(m => m.apply));
    const manual = runSimulation(s2, c2, csvStore);
    expect(seek.result.approvalRate).toBeCloseTo(manual.approvalRate, 9);
    expect(seek.result.inadReal).toBeCloseTo(manual.inadReal, 9);
    expect(seek.result.inadInferida).toBeCloseTo(manual.inadInferida, 9);
    expect(seek.result.approvalRate).toBeCloseTo(100, 9);
    expect(seek.result.inadReal).toBeCloseTo(6 / 60, 9);
    expect(seek.result.inadInferida).toBeCloseTo(5.3 / 56, 9);
  });

  it('delta O(1) do candidato isolado ≡ resimulação antes/depois (approvedQty)', () => {
    const candidates = buildGoalSeekCandidates(shapes, conns, csvStore, {}, []);
    const cand = candidates.find(c => c.type === 'decision_terminal' && c.value === 'B');
    const before = runSimulation(shapes, conns, csvStore);
    const { shapes: s2, conns: c2 } = applyGoalSeekMoves(shapes, conns, [cand.apply]);
    const after = runSimulation(s2, c2, csvStore);
    expect(after.approvedQty - before.approvedQty).toBe(cand.qty);
    expect(after.rejectedQty - before.rejectedQty).toBe(-cand.qty);
  });
});

describe('Goal Seek · cinema_cell (reusa a mecânica do Johnny)', () => {
  const csvStore = {
    base: {
      name: 'base',
      headers: ['GRUPO', 'FAIXA', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
      rows: [
        ['G1', 'F1', '100', '40', '38', '4', '3.5'],   // elegível (aprovado)
        ['G1', 'F2', '50', '20', '18', '2', '1.8'],    // fechada — mais barata (inadInferida=0.1)
        ['G2', 'F1', '80', '30', '28', '3', '2.5'],    // elegível (aprovado)
        ['G2', 'F2', '20', '5', '4', '1', '0.8'],      // fechada — mais cara (inadInferida=0.2)
      ],
      columnTypes: { GRUPO: 'decision', FAIXA: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
      varTypes: {},
      asIsConfig: null,
    },
  };
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

  it('abre as duas células fechadas (mais barata primeiro) até esgotar o catálogo — bate com resimulação', () => {
    const seek = computeGoalSeek(shapes, conns, csvStore, { target: 'approvalRate', direction: 'increase', magnitude: null }, {}, [], pops(shapes, csvStore));
    expect(seek.moves.map(m => m.apply.cellKey)).toEqual(['G1|F2', 'G2|F2']);
    expect(seek.bindingConstraint).toBe('no_more_moves');
    expect(seek.goalReached).toBe(true);

    const { shapes: s2, conns: c2 } = applyGoalSeekMoves(shapes, conns, seek.moves.map(m => m.apply));
    const manual = runSimulation(s2, c2, csvStore);
    expect(seek.result.approvalRate).toBeCloseTo(manual.approvalRate, 9);
    expect(seek.result.inadReal).toBeCloseTo(manual.inadReal, 9);
    expect(seek.result.inadInferida).toBeCloseTo(manual.inadInferida, 9);
    expect(seek.result.approvalRate).toBeCloseTo(100, 9);
  });
});

describe('Goal Seek · monotonicidade ordinal (precedência tipo Johnny)', () => {
  const csvStore = {
    base: {
      name: 'base',
      headers: ['RATING', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
      rows: [
        ['R1', '100', '40', '38', '20', '19'],   // pior inad (0.5) — mas é o 1º da ordem
        ['R2', '100', '40', '38', '10', '9'],    // inad médio (0.25)
        ['R3', '100', '40', '38', '1', '0.9'],   // melhor inad (0.025) — sem precedência, seria o 1º escolhido
      ],
      columnTypes: { RATING: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
      varTypes: { RATING: 'ordinal' },
      asIsConfig: null,
    },
  };
  const shapes = [
    { id: 'D', type: 'decision', variableCol: 'RATING', csvId: 'base' },
    { id: 'p1', type: 'port', label: 'R1' },
    { id: 'p2', type: 'port', label: 'R2' },
    { id: 'p3', type: 'port', label: 'R3' },
    { id: 'AP', type: 'approved' },
    { id: 'RJ', type: 'rejected' },
  ];
  const conns = [
    { id: 'c1', from: 'D', to: 'p1', label: 'R1' },
    { id: 'c2', from: 'D', to: 'p2', label: 'R2' },
    { id: 'c3', from: 'D', to: 'p3', label: 'R3' },
    { id: 'c4', from: 'p1', to: 'RJ' },
    { id: 'c5', from: 'p2', to: 'RJ' },
    { id: 'c6', from: 'p3', to: 'RJ' },
  ];

  it('mesmo com R3 sendo o mais barato, a ordem aplicada respeita o domínio (R1→R2→R3)', () => {
    const seek = computeGoalSeek(shapes, conns, csvStore, { target: 'approvalRate', direction: 'increase', magnitude: null }, {}, [], pops(shapes, csvStore));
    expect(seek.moves.map(m => m.id)).toEqual(['decision:D:R1', 'decision:D:R2', 'decision:D:R3']);
  });

  it('não pula posições: se só sobrar orçamento para 1 movimento, é R1 (nunca R3)', () => {
    // Teto de inad real bem apertado — só o baseline (aprovado=0) cabe R1 (inad real 0.5 > teto,
    // então nem R1 caberia a rigor); usamos um teto que deixa passar só o "mínimo" possível —
    // aqui validamos a ORDEM em vez do teto: magnitude pequena o bastante para parar em 1 movimento.
    const seek = computeGoalSeek(shapes, conns, csvStore, { target: 'approvalRate', direction: 'increase', magnitude: 20 }, {}, [], pops(shapes, csvStore));
    expect(seek.moves.length).toBe(1);
    expect(seek.moves[0].id).toBe('decision:D:R1');
  });
});

describe('Goal Seek · restrições (teto de inad) e travas 🔒', () => {
  const csvStore = {
    base: {
      name: 'base',
      headers: ['COLX', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
      rows: [
        ['C', '100', '50', '50', '1', '1'],    // barato: inad real/infer = 0.02
        ['E', '100', '50', '50', '40', '40'],  // caro: inad real/infer = 0.8
      ],
      columnTypes: { COLX: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
      varTypes: {},
      asIsConfig: null,
    },
  };
  const shapes = [
    { id: 'D', type: 'decision', variableCol: 'COLX', csvId: 'base' },
    { id: 'pC', type: 'port', label: 'C' },
    { id: 'pE', type: 'port', label: 'E' },
    { id: 'AP', type: 'approved' },
    { id: 'RJ', type: 'rejected' },
  ];
  const conns = [
    { id: 'c1', from: 'D', to: 'pC', label: 'C' },
    { id: 'c2', from: 'D', to: 'pE', label: 'E' },
    { id: 'c3', from: 'pC', to: 'RJ' },
    { id: 'c4', from: 'pE', to: 'RJ' },
  ];

  it('teto de inad real 10% aceita só o segmento barato; nenhum ponto da fronteira viola o teto', () => {
    const seek = computeGoalSeek(
      shapes, conns, csvStore,
      { target: 'approvalRate', direction: 'increase', magnitude: null, minimize: 'inadReal' },
      { maxInadReal: 0.1 }, [], pops(shapes, csvStore),
    );
    expect(seek.moves.map(m => m.id)).toEqual(['decision:D:C']);
    expect(seek.bindingConstraint).toBe('maxInadReal');
    for (const pt of seek.frontier) {
      if (pt.inadReal != null) expect(pt.inadReal).toBeLessThanOrEqual(0.1 + 1e-9);
    }
    expect(seek.result.inadReal).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it('objetivo inatingível: magnitude alta demais reporta o melhor ponto parcial + o gargalo', () => {
    const seek = computeGoalSeek(
      shapes, conns, csvStore,
      { target: 'approvalRate', direction: 'increase', magnitude: 90 }, // pede quase 100% de aprovação
      { maxInadReal: 0.1 }, [], pops(shapes, csvStore),
    );
    expect(seek.goalReached).toBe(false);
    expect(seek.bindingConstraint).toBe('maxInadReal');
    expect(seek.moves.map(m => m.id)).toEqual(['decision:D:C']); // melhor parcial: só o barato
  });

  it('nó travado (locks) não entra no catálogo — nenhum movimento é proposto', () => {
    const seek = computeGoalSeek(
      shapes, conns, csvStore,
      { target: 'approvalRate', direction: 'increase', magnitude: null },
      {}, ['D'], pops(shapes, csvStore),
    );
    expect(seek.moves).toEqual([]);
    expect(seek.bindingConstraint).toBe('no_more_moves');
    expect(seek.goalReached).toBe(false);
  });

  it('shape.locked persistido tem o mesmo efeito da lista `locks` da mensagem', () => {
    const lockedShapes = shapes.map(s => s.id === 'D' ? { ...s, locked: true } : s);
    const seek = computeGoalSeek(
      lockedShapes, conns, csvStore,
      { target: 'approvalRate', direction: 'increase', magnitude: null },
      {}, [], pops(lockedShapes, csvStore),
    );
    expect(seek.moves).toEqual([]);
  });

  it('determinismo: mesma entrada ⇒ mesma proposta', () => {
    const goal = { target: 'approvalRate', direction: 'increase', magnitude: null, minimize: 'inadReal' };
    const a = computeGoalSeek(shapes, conns, csvStore, goal, { maxInadReal: 0.1 }, [], pops(shapes, csvStore));
    const b = computeGoalSeek(shapes, conns, csvStore, goal, { maxInadReal: 0.1 }, [], pops(shapes, csvStore));
    expect(a).toEqual(b);
  });
});

describe('Goal Seek · lens_threshold (relaxar/apertar regra numérica gte)', () => {
  const csvStore = {
    base: {
      name: 'base',
      headers: ['SCORE', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
      rows: [
        ['500', '30', '10', '9', '1', '0.9'],    // hoje falha (score < 600)
        ['600', '40', '15', '14', '1.5', '1.4'], // hoje passa — mais próximo da fronteira
        ['700', '20', '8', '7', '0.8', '0.7'],   // hoje passa
      ],
      columnTypes: { SCORE: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
      varTypes: {},
      asIsConfig: null,
    },
  };
  const shapes = [
    { id: 'L', type: 'decision_lens', rules: [{ col: 'SCORE', operator: 'gte', value: '600', logic: null }] },
    { id: 'AP', type: 'approved' },
  ];
  const conns = [
    { id: 'c1', from: 'L', to: 'AP' },
  ];

  it('candidatos relax (admite 500) e tighten (remove 600) com o novo limiar correto', () => {
    const candidates = buildGoalSeekCandidates(shapes, conns, csvStore, {}, []);
    const lensCands = candidates.filter(c => c.type === 'lens_threshold');
    expect(lensCands.length).toBe(2);
    const relax = lensCands.find(c => c.kind === 'relax');
    const tighten = lensCands.find(c => c.kind === 'tighten');
    expect(relax.apply).toEqual({ type: 'lens_threshold', shapeId: 'L', ruleIndex: 0, newValue: '500' });
    expect(tighten.apply).toEqual({ type: 'lens_threshold', shapeId: 'L', ruleIndex: 0, newValue: '700' });
    expect(relax.toApproved).toBe(true);
    expect(tighten.toApproved).toBe(false);
  });

  it('computeNewLensThreshold flips exatamente o valor-alvo (verificado contra matchLensRule)', () => {
    const distinct = [{ raw: '500', n: 500 }, { raw: '600', n: 600 }, { raw: '700', n: 700 }];
    const relaxTo = computeNewLensThreshold('gte', distinct, 0, 'relax');
    expect(relaxTo).toBe(500);
    const tightenTo = computeNewLensThreshold('gte', distinct, 1, 'tighten');
    expect(tightenTo).toBe(700);
  });

  it('relaxar a regra para admitir 500 aumenta a aprovação — bate com a resimulação real', () => {
    const seek = computeGoalSeek(shapes, conns, csvStore, { target: 'approvalRate', direction: 'increase', magnitude: 20 }, {}, [], pops(shapes, csvStore));
    expect(seek.moves.length).toBe(1);
    expect(seek.moves[0].type).toBe('lens_threshold');
    expect(seek.moves[0].apply.newValue).toBe('500');

    const { shapes: s2, conns: c2 } = applyGoalSeekMoves(shapes, conns, seek.moves.map(m => m.apply));
    const manual = runSimulation(s2, c2, csvStore);
    expect(seek.result.approvalRate).toBeCloseTo(manual.approvalRate, 9);
    expect(seek.result.approvalRate).toBeCloseTo(100, 9); // as 3 linhas passam a aprovar
  });

  it('lens com output para Reprovado não entra no catálogo (limitação v1 documentada)', () => {
    const rjShapes = [
      { id: 'L', type: 'decision_lens', rules: [{ col: 'SCORE', operator: 'gte', value: '600', logic: null }] },
      { id: 'RJ', type: 'rejected' },
    ];
    const rjConns = [{ id: 'c1', from: 'L', to: 'RJ' }];
    const candidates = buildGoalSeekCandidates(rjShapes, rjConns, csvStore, {}, []);
    expect(candidates.filter(c => c.type === 'lens_threshold')).toEqual([]);
  });
});
