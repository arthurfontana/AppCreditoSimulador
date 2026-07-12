import { describe, it, expect } from 'vitest';
import {
  computeGoalSeek,
  buildGoalSeekCandidates,
  computeNewLensThreshold,
  runSimulation,
  computeLensPopulations,
  computeGoalSeekContext,
  wilsonCI,
  GOAL_SEEK_MIN_SAMPLE,
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

// ── GS1 (DEC-GS-002) — computeGoalSeekContext: "Ponto de partida" ───────────────────
describe('Goal Seek · computeGoalSeekContext (GS1, DEC-GS-002)', () => {
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

  it('agregados AS IS do contexto ≡ agregação manual via __DECISAO_ORIGINAL sobre as linhas decididas', () => {
    // Política atual (canvas): A → Aprovado, B → Reprovado.
    // AS IS histórico: A e B são AMBOS 'APROVADO' — diverge deliberadamente da política,
    // para o delta do card não ser um empate acidental.
    const csvStore = {
      base: {
        name: 'base',
        headers: ['COLX', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida', '__DECISAO_ORIGINAL'],
        rows: [
          ['A', '100', '40', '38', '4', '3.5', 'APROVADO'],
          ['B', '50', '20', '18', '2', '1.8', 'APROVADO'],
        ],
        columnTypes: { COLX: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' },
        varTypes: {},
        asIsConfig: { col: 'ORIG', mapping: { X: 'APROVADO' } },
      },
    };

    const ctx = computeGoalSeekContext(shapes, conns, csvStore);

    // baseline = política atual, mesmo escopo/matemática de computeGoalSeek's baseline
    expect(ctx.baseline.decidedQty).toBe(150);
    expect(ctx.baseline.approvedQty).toBe(100);
    expect(ctx.baseline.approvalRate).toBeCloseTo((100 / 150) * 100, 9);
    expect(ctx.baseline.inadReal).toBeCloseTo(4 / 40, 9);
    expect(ctx.baseline.inadInferida).toBeCloseTo(3.5 / 38, 9);

    // asis: agregação manual sobre __DECISAO_ORIGINAL das linhas decididas (as duas, aqui)
    expect(ctx.asis).not.toBeNull();
    expect(ctx.asis.decidedQty).toBe(150);
    expect(ctx.asis.approvedQty).toBe(150); // A e B, ambos APROVADO no AS IS
    expect(ctx.asis.approvalRate).toBeCloseTo(100, 9);
    expect(ctx.asis.inadReal).toBeCloseTo((4 + 2) / (40 + 20), 9);
    expect(ctx.asis.inadInferida).toBeCloseTo((3.5 + 1.8) / (38 + 18), 9);
  });

  it('dataset decidido sem __DECISAO_ORIGINAL ⇒ asis:null (nunca 0 forjado)', () => {
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
    const ctx = computeGoalSeekContext(shapes, conns, csvStore);
    expect(ctx.asis).toBeNull();
    expect(ctx.baseline.decidedQty).toBe(150);
    expect(ctx.baseline.approvedQty).toBe(100);
  });
});

// ── GS2 (DEC-GS-003) — "Minimizar colateralmente" generalizado ──────────────────────
// Score generalizado (collQty + collPoolAvg·K)/(tgtQty + tgtPoolAvg·K), 4 opções de
// minimize. Fixture construída para que a escolha do minimize mude qual segmento sai do
// aprovado (mesmo alvo, mesma magnitude): dois candidatos A e B com o MESMO ganho no alvo
// (inadRRaw=30, qtdAltas=100 ⇒ ambos reduzem inadReal identicamente e um só já atinge o
// alvo), mas anti-correlacionados em qty / qtdAltasInfer / inadIRaw.
describe('Goal Seek · minimize generalizado (GS2, DEC-GS-003)', () => {
  const csvStore = {
    base: {
      name: 'base',
      headers: ['COLX', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
      rows: [
        ['A', '10',  '100', '10',  '30', '80'],  // qty baixo, qtdAltasInfer baixo, inadIRaw ALTO
        ['B', '100', '100', '100', '30', '10'],  // qty alto,  qtdAltasInfer alto,  inadIRaw BAIXO
        ['C', '100', '100', '100', '5',  '5'],   // inad baixa (âncora do denominador, nunca escolhida)
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
    { id: 'pC', type: 'port', label: 'C' },
    { id: 'AP', type: 'approved' },
    { id: 'RJ', type: 'rejected' },
  ];
  const conns = [
    { id: 'cA', from: 'D', to: 'pA', label: 'A' },
    { id: 'cB', from: 'D', to: 'pB', label: 'B' },
    { id: 'cC', from: 'D', to: 'pC', label: 'C' },
    { id: 'cpA', from: 'pA', to: 'AP' },
    { id: 'cpB', from: 'pB', to: 'AP' },
    { id: 'cpC', from: 'pC', to: 'AP' },
  ];
  // Reduzir inadReal em 0,04 (baseline 65/300≈0,2167 → 35/200=0,175 após remover A OU B).
  const goalBase = { target: 'inadReal', direction: 'decrease', magnitude: 0.04 };
  const run = (minimize) => computeGoalSeek(shapes, conns, csvStore, { ...goalBase, minimize }, {}, [], pops(shapes, csvStore));
  const sumQty   = s => s.moves.reduce((a, m) => a + m.qty, 0);
  const sumInfer = s => s.moves.reduce((a, m) => a + m.qtdAltasInfer, 0);

  it('caso 1: minimize=approval move MENOS volume de propostas que minimize=inadInferida (mesmo alvo)', () => {
    const byApproval = run('approval');
    const byInadInf  = run('inadInferida');
    // Ambos atingem o alvo em 1 movimento — mas escolhem candidatos diferentes.
    expect(byApproval.moves.map(m => m.id)).toEqual(['decision:D:A']); // menor qty
    expect(byInadInf.moves.map(m => m.id)).toEqual(['decision:D:B']);  // menor inadIRaw
    expect(sumQty(byApproval)).toBeLessThan(sumQty(byInadInf));
    expect(sumQty(byApproval)).toBe(10);
    expect(sumQty(byInadInf)).toBe(100);
  });

  it('caso 2: minimize=salesVolume move MENOS qtdAltasInfer que minimize=inadInferida', () => {
    const bySales   = run('salesVolume');
    const byInadInf = run('inadInferida');
    expect(bySales.moves.map(m => m.id)).toEqual(['decision:D:A']);   // menor qtdAltasInfer
    expect(sumInfer(bySales)).toBeLessThan(sumInfer(byInadInf));
    expect(sumInfer(bySales)).toBe(10);
    expect(sumInfer(byInadInf)).toBe(100);
  });

  it('caso 3: determinismo — mesma entrada ⇒ mesma proposta (por opção de minimize)', () => {
    for (const minimize of ['approval', 'salesVolume', 'inadReal', 'inadInferida']) {
      expect(run(minimize)).toEqual(run(minimize));
    }
  });

  it('retrocompat: minimize ausente/desconhecido ≡ inadInferida', () => {
    const known   = run('inadInferida');
    const missing = run(undefined);
    const bogus   = run('naoExiste');
    expect(missing).toEqual(known);
    expect(bogus).toEqual(known);
    expect(missing.goal.minimize).toBe('inadInferida');
  });
});

// ── GATE — Sessão GS3 (Selos estatísticos por movimento, DEC-GS-004) ─────────────
// docs/wiki/Hibrido-GoalSeek-Profundo.md pede:
//   1. wilsonCI contra valores de referência calculados à mão;
//   2. stats.fragile liga exatamente em n < GOAL_SEEK_MIN_SAMPLE (=30);
//   3. stats presente em todo move (inclusive quando minimize não tem taxa associada,
//      degradando para campos null em vez de omitir o objeto);
//   4. nenhum número da busca (score/ordem/agregados) muda — os asserts do GS2/Sessão 4
//      continuam de pé (arquivo inteiro segue passando).
describe('Goal Seek · wilsonCI (GS3, DEC-GS-004)', () => {
  it('bate com valores de referência calculados à mão', () => {
    // k=8,n=30 — mesmo exemplo normativo da DEC-GS-004 (≈[0.142, 0.448]).
    const [lo1, hi1] = wilsonCI(8, 30);
    expect(lo1).toBeCloseTo(0.1418, 3);
    expect(hi1).toBeCloseTo(0.4445, 3);
    const [lo2, hi2] = wilsonCI(15, 50);
    expect(lo2).toBeCloseTo(0.1910, 3);
    expect(hi2).toBeCloseTo(0.4375, 3);
    const [lo3, hi3] = wilsonCI(0, 20);
    expect(lo3).toBeCloseTo(0, 6);
    expect(hi3).toBeCloseTo(0.1611, 3);
  });

  it('n=0/ausente ⇒ null (sem intervalo)', () => {
    expect(wilsonCI(0, 0)).toBeNull();
    expect(wilsonCI(5, null)).toBeNull();
  });
});

describe('Goal Seek · stats por movimento (GS3, DEC-GS-004)', () => {
  const csvStore = {
    base: {
      name: 'base',
      // A: qtdAltas=30 (piso exato — NÃO frágil), inadReal(raw)=8 ⇒ mesmo par k=8,n=30 do
      // exemplo normativo. B: qtdAltas=10 (< 30 — frágil).
      headers: ['COLX', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'],
      rows: [
        ['A', '50', '30', '25', '8', '5'],
        ['B', '20', '10', '8',  '3', '2'],
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
    { id: 'cA', from: 'D', to: 'pA', label: 'A' },
    { id: 'cB', from: 'D', to: 'pB', label: 'B' },
    { id: 'cpA', from: 'pA', to: 'RJ' },
    { id: 'cpB', from: 'pB', to: 'RJ' },
  ];
  const goal = { target: 'approvalRate', direction: 'increase', magnitude: null, minimize: 'inadReal' };
  const runIt = () => computeGoalSeek(shapes, conns, csvStore, goal, {}, [], pops(shapes, csvStore));

  it('n/rate/ci95/pValue batem com o par (qtdAltas, inadReal) do candidato; fragile só sob o piso', () => {
    const s = runIt();
    expect(s.moves).toHaveLength(2);
    const mvA = s.moves.find(m => m.id === 'decision:D:A');
    const mvB = s.moves.find(m => m.id === 'decision:D:B');

    expect(mvA.stats.n).toBe(30);
    expect(mvA.stats.rate).toBeCloseTo(8 / 30, 9);
    expect(mvA.stats.ci95[0]).toBeCloseTo(0.1418, 3);
    expect(mvA.stats.ci95[1]).toBeCloseTo(0.4445, 3);
    expect(mvA.stats.fragile).toBe(false); // n=30, piso é "< 30", não "<= 30"

    expect(mvB.stats.n).toBe(10);
    expect(mvB.stats.rate).toBeCloseTo(3 / 10, 9);
    expect(mvB.stats.fragile).toBe(true);
    expect(mvB.stats.n).toBeLessThan(GOAL_SEEK_MIN_SAMPLE);

    // p-value é o desvio de CADA candidato vs. a média do pool (não vs. si mesmo) —
    // por isso não é necessariamente 1 mesmo quando o candidato bate na própria taxa.
    expect(typeof mvA.stats.pValue).toBe('number');
    expect(typeof mvB.stats.pValue).toBe('number');
  });

  it('stats presente em todo move mesmo quando minimize não tem taxa associada (approval/salesVolume)', () => {
    for (const minimize of ['approval', 'salesVolume']) {
      const s = computeGoalSeek(shapes, conns, csvStore, { ...goal, minimize }, {}, [], pops(shapes, csvStore));
      for (const mv of s.moves) {
        expect(mv.stats).toBeTruthy();
        expect(mv.stats.n).toBeNull();
        expect(mv.stats.rate).toBeNull();
        expect(mv.stats.ci95).toBeNull();
        expect(mv.stats.pValue).toBeNull();
        expect(mv.stats.fragile).toBe(false);
      }
    }
  });

  it('não muda ordenação/matemática da busca (score e delta de aprovação inalterados) nem determinismo', () => {
    const a = runIt(), b = runIt();
    expect(a.moves.map(m => m.id)).toEqual(b.moves.map(m => m.id));
    expect(a.moves.map(m => m.deltaApprovalRate)).toEqual(b.moves.map(m => m.deltaApprovalRate));
    expect(a).toEqual(b);
  });
});
