import { describe, it, expect } from 'vitest';
import {
  detectJourneyStages,
  computeReadiness,
  STAGE_IDS,
  READINESS_CRITERIA_IDS,
} from '../src/policyJourney.js';
import { policyIRFingerprint } from '../src/policyFingerprint.js';
import {
  computePolicyInsights,
  computeNodeArrivals,
  computeSimplify,
} from '../src/simulation.worker.js';

// ── GATE Sessão EP1 · Etapas da Política + Checklist de Prontidão (Jornada EP) ────────
// docs/wiki/Jornada-Prompts-Sessoes.md (DEC-EP-001..003 + "Detectores do v1"). Duas frentes:
//   (A) detectJourneyStages — 6 detectores determinísticos, cada um com `facts` declarando o
//       que detectou + override manual por etapa respeitado.
//   (B) computeReadiness — checklist ≡ estado REAL dos motores (lint/cobertura/pendências/
//       diff da doc/simplificação) número a número; critério desativado ⇒ 'na'; determinismo.
// policyJourney.js é PURO: reusa os motores como fonte via `artifacts` (fatos crus), nunca
// recomputa matemática. Aqui rodamos os motores reais do worker e conferimos a leitura.

const idsOf = (arr) => arr.map((x) => x.id);
const byId = (stages, id) => stages.find((s) => s.id === id);

// ═══════════════════════════════════════════════════════════════════════════════════
// (A) detectJourneyStages — detectores por etapa
// ═══════════════════════════════════════════════════════════════════════════════════

describe('detectJourneyStages · contrato geral', () => {
  it('devolve as 6 etapas canônicas na ordem de STAGE_IDS, com índice', () => {
    const stages = detectJourneyStages([], [], {}, {});
    expect(idsOf(stages)).toEqual(STAGE_IDS);
    expect(stages.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const s of stages) {
      expect(['done', 'todo']).toContain(s.state);
      expect(typeof s.detected).toBe('boolean');
      expect(s.facts).toBeTruthy();
    }
  });

  it('determinismo: mesma entrada ⇒ mesmo modelo (byte a byte)', () => {
    const csvStore = { base: { headers: ['SEG'], rowCount: 3, varTypes: {}, asIsConfig: { col: 'D', mapping: {} } } };
    const shapes = [{ id: 'D1', type: 'decision', label: 'Seg', variableCol: 'SEG', csvId: 'base' }];
    const a = detectJourneyStages(shapes, [], csvStore, { calibrationApplied: true });
    const b = detectJourneyStages(shapes, [], csvStore, { calibrationApplied: true });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('detectJourneyStages · E1 Conhecer a base', () => {
  const shapes = [];
  it('base carregada + AS IS configurado ⇒ done; perfil EB é sinal forte declarado', () => {
    const csvStore = { base: { headers: ['X'], rowCount: 10, asIsConfig: { col: 'D', mapping: {} } } };
    const st = byId(detectJourneyStages(shapes, [], csvStore, { baseProfile: { variables: [] } }), 'know_base');
    expect(st.state).toBe('done');
    expect(st.facts).toEqual({ baseLoaded: true, asIsConfigured: true, hasProfile: true });
  });

  it('sem AS IS ⇒ todo (declara asIsConfigured:false)', () => {
    const csvStore = { base: { headers: ['X'], rowCount: 10, asIsConfig: null } };
    const st = byId(detectJourneyStages(shapes, [], csvStore, {}), 'know_base');
    expect(st.state).toBe('todo');
    expect(st.facts.baseLoaded).toBe(true);
    expect(st.facts.asIsConfigured).toBe(false);
    expect(st.facts.hasProfile).toBe(false);
  });

  it('sem base ⇒ todo', () => {
    const st = byId(detectJourneyStages(shapes, [], {}, {}), 'know_base');
    expect(st.state).toBe('todo');
    expect(st.facts.baseLoaded).toBe(false);
  });
});

describe('detectJourneyStages · E2 Elegibilidade (knock-out ≤ 2 nós)', () => {
  it('caminho raiz→Reprovado com 1 nó ⇒ done (minNodes=1)', () => {
    const shapes = [
      { id: 'D1', type: 'decision', label: 'KO', variableCol: 'BLOCK', csvId: 'base' },
      { id: 'pN', type: 'port', label: 'N' }, { id: 'pS', type: 'port', label: 'S' },
      { id: 'REJ', type: 'rejected' }, { id: 'AP', type: 'approved' },
    ];
    const conns = [
      { id: 'c1', from: 'D1', to: 'pS', label: 'S' }, { id: 'c2', from: 'pS', to: 'REJ' },
      { id: 'c3', from: 'D1', to: 'pN', label: 'N' }, { id: 'c4', from: 'pN', to: 'AP' },
    ];
    const st = byId(detectJourneyStages(shapes, conns, {}, {}), 'eligibility');
    expect(st.state).toBe('done');
    expect(st.facts).toEqual({ knockoutFound: true, minNodes: 1, nodeId: 'D1' });
  });

  it('caminho raiz→Reprovado com exatamente 2 nós ⇒ done', () => {
    const shapes = [
      { id: 'D1', type: 'decision', variableCol: 'A', csvId: 'base' }, { id: 'p1', type: 'port', label: 'x' },
      { id: 'D2', type: 'decision', variableCol: 'B', csvId: 'base' }, { id: 'p2', type: 'port', label: 'y' },
      { id: 'REJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'D1', to: 'p1', label: 'x' }, { id: 'c2', from: 'p1', to: 'D2' },
      { id: 'c3', from: 'D2', to: 'p2', label: 'y' }, { id: 'c4', from: 'p2', to: 'REJ' },
    ];
    const st = byId(detectJourneyStages(shapes, conns, {}, {}), 'eligibility');
    expect(st.state).toBe('done');
    expect(st.facts.minNodes).toBe(2);
  });

  it('Reprovado só a 3 nós de profundidade ⇒ todo (não é knock-out)', () => {
    const shapes = [
      { id: 'D1', type: 'decision', variableCol: 'A', csvId: 'base' }, { id: 'p1', type: 'port', label: 'x' },
      { id: 'D2', type: 'decision', variableCol: 'B', csvId: 'base' }, { id: 'p2', type: 'port', label: 'y' },
      { id: 'D3', type: 'decision', variableCol: 'C', csvId: 'base' }, { id: 'p3', type: 'port', label: 'z' },
      { id: 'REJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'D1', to: 'p1', label: 'x' }, { id: 'c2', from: 'p1', to: 'D2' },
      { id: 'c3', from: 'D2', to: 'p2', label: 'y' }, { id: 'c4', from: 'p2', to: 'D3' },
      { id: 'c5', from: 'D3', to: 'p3', label: 'z' }, { id: 'c6', from: 'p3', to: 'REJ' },
    ];
    const st = byId(detectJourneyStages(shapes, conns, {}, {}), 'eligibility');
    expect(st.state).toBe('todo');
    expect(st.facts).toEqual({ knockoutFound: false, minNodes: 3, nodeId: 'D3' });
  });

  it('sem terminal Reprovado alcançável ⇒ todo (minNodes null)', () => {
    const shapes = [
      { id: 'D1', type: 'decision', variableCol: 'A', csvId: 'base' }, { id: 'p1', type: 'port', label: 'x' },
      { id: 'AP', type: 'approved' },
    ];
    const conns = [{ id: 'c1', from: 'D1', to: 'p1', label: 'x' }, { id: 'c2', from: 'p1', to: 'AP' }];
    const st = byId(detectJourneyStages(shapes, conns, {}, {}), 'eligibility');
    expect(st.state).toBe('todo');
    expect(st.facts.minNodes).toBeNull();
  });
});

describe('detectJourneyStages · E3 Segmentação', () => {
  // Variável categórica (SEG, não-ordinal) num nó raiz com 2 ramos para subárvores distintas.
  const csvStore = { base: { headers: ['SEG', 'A', 'B'], varTypes: {} } };
  const segShapes = [
    { id: 'D1', type: 'decision', variableCol: 'SEG', csvId: 'base' },
    { id: 'pA', type: 'port', label: 'A' }, { id: 'pB', type: 'port', label: 'B' },
    { id: 'D2', type: 'decision', variableCol: 'A', csvId: 'base' },
    { id: 'D3', type: 'decision', variableCol: 'B', csvId: 'base' },
  ];
  const segConns = [
    { id: 'c1', from: 'D1', to: 'pA', label: 'A' }, { id: 'c2', from: 'pA', to: 'D2' },
    { id: 'c3', from: 'D1', to: 'pB', label: 'B' }, { id: 'c4', from: 'pB', to: 'D3' },
  ];

  it('categórica em nível ≤ 2 com 2 subárvores distintas ⇒ done', () => {
    const st = byId(detectJourneyStages(segShapes, segConns, csvStore, {}), 'segmentation');
    expect(st.state).toBe('done');
    expect(st.facts).toEqual({ segmented: true, nodeId: 'D1', level: 1, subtreeCount: 2 });
  });

  it('categórica com 1 só subárvore (outro ramo é terminal) ⇒ todo', () => {
    const shapes = [
      { id: 'D1', type: 'decision', variableCol: 'SEG', csvId: 'base' },
      { id: 'pA', type: 'port', label: 'A' }, { id: 'pB', type: 'port', label: 'B' },
      { id: 'D2', type: 'decision', variableCol: 'A', csvId: 'base' }, { id: 'REJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'D1', to: 'pA', label: 'A' }, { id: 'c2', from: 'pA', to: 'D2' },
      { id: 'c3', from: 'D1', to: 'pB', label: 'B' }, { id: 'c4', from: 'pB', to: 'REJ' },
    ];
    const st = byId(detectJourneyStages(shapes, conns, csvStore, {}), 'segmentation');
    expect(st.state).toBe('todo');
    expect(st.facts.subtreeCount).toBe(1);
  });

  it('variável ORDINAL não conta como segmentação (é risco) ⇒ todo', () => {
    const ordStore = { base: { headers: ['SEG'], varTypes: { SEG: 'ordinal' } } };
    const st = byId(detectJourneyStages(segShapes, segConns, ordStore, {}), 'segmentation');
    expect(st.state).toBe('todo');
  });

  it('variável de CLUSTER conta como segmentação ⇒ done', () => {
    const clStore = { base: { headers: ['SEG'], varTypes: {}, clusterDefs: { SEG: { groups: [] } } } };
    const st = byId(detectJourneyStages(segShapes, segConns, clStore, {}), 'segmentation');
    expect(st.state).toBe('done');
  });
});

describe('detectJourneyStages · E4 Risco e cortes', () => {
  it('variável ordinal com portas a terminais distintos (Aprovado/Reprovado) ⇒ done', () => {
    const csvStore = { base: { headers: ['SCORE'], varTypes: { SCORE: 'ordinal' } } };
    const shapes = [
      { id: 'R1', type: 'decision', variableCol: 'SCORE', csvId: 'base' },
      { id: 'pH', type: 'port', label: 'Alto' }, { id: 'pL', type: 'port', label: 'Baixo' },
      { id: 'AP', type: 'approved' }, { id: 'REJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'R1', to: 'pH', label: 'Alto' }, { id: 'c2', from: 'pH', to: 'AP' },
      { id: 'c3', from: 'R1', to: 'pL', label: 'Baixo' }, { id: 'c4', from: 'pL', to: 'REJ' },
    ];
    const st = byId(detectJourneyStages(shapes, conns, csvStore, {}), 'risk');
    expect(st.state).toBe('done');
    expect(st.facts).toEqual({ routed: true, nodeId: 'R1', terminalCount: 2 });
  });

  it('variável de FAIXAS (rangeDefs) conta como risco ⇒ done', () => {
    const csvStore = { base: { headers: ['FX'], varTypes: {}, rangeDefs: { FX: { cuts: [] } } } };
    const shapes = [
      { id: 'R1', type: 'decision', variableCol: 'FX', csvId: 'base' },
      { id: 'pH', type: 'port', label: 'Alta' }, { id: 'pL', type: 'port', label: 'Baixa' },
      { id: 'AP', type: 'approved' }, { id: 'REJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'R1', to: 'pH', label: 'Alta' }, { id: 'c2', from: 'pH', to: 'AP' },
      { id: 'c3', from: 'R1', to: 'pL', label: 'Baixa' }, { id: 'c4', from: 'pL', to: 'REJ' },
    ];
    const st = byId(detectJourneyStages(shapes, conns, csvStore, {}), 'risk');
    expect(st.state).toBe('done');
  });

  it('ordinal mas ambas as portas ao MESMO terminal ⇒ todo (não há corte de risco)', () => {
    const csvStore = { base: { headers: ['SCORE'], varTypes: { SCORE: 'ordinal' } } };
    const shapes = [
      { id: 'R1', type: 'decision', variableCol: 'SCORE', csvId: 'base' },
      { id: 'pH', type: 'port', label: 'Alto' }, { id: 'pL', type: 'port', label: 'Baixo' },
      { id: 'AP', type: 'approved' },
    ];
    const conns = [
      { id: 'c1', from: 'R1', to: 'pH', label: 'Alto' }, { id: 'c2', from: 'pH', to: 'AP' },
      { id: 'c3', from: 'R1', to: 'pL', label: 'Baixo' }, { id: 'c4', from: 'pL', to: 'AP' },
    ];
    const st = byId(detectJourneyStages(shapes, conns, csvStore, {}), 'risk');
    expect(st.state).toBe('todo');
    expect(st.facts.terminalCount).toBe(1);
  });

  it('variável categórica (não-ordinal/faixas/score) ⇒ todo', () => {
    const csvStore = { base: { headers: ['SEG'], varTypes: {} } };
    const shapes = [
      { id: 'R1', type: 'decision', variableCol: 'SEG', csvId: 'base' },
      { id: 'pH', type: 'port', label: 'X' }, { id: 'pL', type: 'port', label: 'Y' },
      { id: 'AP', type: 'approved' }, { id: 'REJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'R1', to: 'pH', label: 'X' }, { id: 'c2', from: 'pH', to: 'AP' },
      { id: 'c3', from: 'R1', to: 'pL', label: 'Y' }, { id: 'c4', from: 'pL', to: 'REJ' },
    ];
    const st = byId(detectJourneyStages(shapes, conns, csvStore, {}), 'risk');
    expect(st.state).toBe('todo');
  });
});

describe('detectJourneyStages · E5 Calibração', () => {
  it('Goal Seek/otimizador aplicado no histórico ⇒ done', () => {
    const st = byId(detectJourneyStages([], [], {}, { calibrationApplied: true }), 'calibration');
    expect(st.state).toBe('done');
    expect(st.facts).toEqual({ calibrationApplied: true, goalMet: false });
  });
  it('delta vs AS IS dentro da meta (goalMet) ⇒ done', () => {
    const st = byId(detectJourneyStages([], [], {}, { goalMet: true }), 'calibration');
    expect(st.state).toBe('done');
  });
  it('sem sinal de calibração ⇒ todo', () => {
    const st = byId(detectJourneyStages([], [], {}, {}), 'calibration');
    expect(st.state).toBe('todo');
  });
});

describe('detectJourneyStages · override manual (DEC-EP-002)', () => {
  it("override 'done' força concluída mesmo sem detecção", () => {
    const st = byId(detectJourneyStages([], [], {}, { overrides: { segmentation: 'done' } }), 'segmentation');
    expect(st.detected).toBe(false); // detector honesto: nada detectado
    expect(st.override).toBe('done');
    expect(st.state).toBe('done');   // override respeitado
  });

  it("override 'reopened' força pendente mesmo com detecção", () => {
    const csvStore = { base: { headers: ['X'], rowCount: 1, asIsConfig: { col: 'D', mapping: {} } } };
    const st = byId(detectJourneyStages([], [], csvStore, { overrides: { know_base: 'reopened' } }), 'know_base');
    expect(st.detected).toBe(true);
    expect(st.override).toBe('reopened');
    expect(st.state).toBe('todo');
  });

  it('override inválido é ignorado (cai no detector)', () => {
    const st = byId(detectJourneyStages([], [], {}, { overrides: { calibration: 'lixo' } }), 'calibration');
    expect(st.override).toBeNull();
    expect(st.state).toBe('todo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════
// (B) computeReadiness — checklist ≡ motores reais, número a número
// ═══════════════════════════════════════════════════════════════════════════════════

describe('computeReadiness · contrato geral', () => {
  it('devolve os critérios na ordem de READINESS_CRITERIA_IDS, cada um com fixCommandId', () => {
    const { criteria } = computeReadiness([], [], {}, {}, {});
    expect(criteria.map((c) => c.id)).toEqual(READINESS_CRITERIA_IDS);
    for (const c of criteria) {
      expect(['pass', 'fail', 'na']).toContain(c.state);
      expect(typeof c.fixCommandId).toBe('string');
      expect(c.facts).toBeTruthy();
    }
  });

  it('critério desativado por config ⇒ na (não recomputa)', () => {
    const { criteria } = computeReadiness([], [], {}, { lint: [{ severity: 'error', code: 'x' }] }, { lint_no_blockers: false });
    const c = criteria.find((x) => x.id === 'lint_no_blockers');
    expect(c.state).toBe('na');
    expect(c.facts.reason).toBe('disabled');
  });

  it('determinismo: duas chamadas ⇒ mesmo resultado', () => {
    const art = { lint: [], coverage: { totalQty: 10, decidedQty: 10 }, ir: { nodes: [], entry: [] } };
    const a = computeReadiness([], [], {}, art, {});
    const b = computeReadiness([], [], {}, art, {});
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('computeReadiness · lint_no_blockers ≡ computePolicyInsights (número a número)', () => {
  // Porta solta COM tráfego ⇒ port_dangling (error) — bloqueante REAL do motor.
  const shapes = [
    { id: 'D1', type: 'decision', variableCol: 'SEG', csvId: 'base' },
    { id: 'pX', type: 'port', label: 'X' }, { id: 'pY', type: 'port', label: 'Y' },
    { id: 'TERM', type: 'approved' },
  ];
  const conns = [
    { id: 'c1', from: 'D1', to: 'pX', label: 'X' }, { id: 'c2', from: 'pX', to: 'TERM' },
    { id: 'c3', from: 'D1', to: 'pY', label: 'Y' }, // pY solta, com tráfego
  ];
  const csvStore = { base: { headers: ['SEG'], rows: [['X'], ['Y'], ['X'], ['Y']], columnTypes: { SEG: 'decision' } } };

  it('achado error do motor ⇒ critério FAIL com a contagem/códigos reais', () => {
    const na = computeNodeArrivals(shapes, conns, csvStore, {});
    const lint = computePolicyInsights(shapes, conns, na, {});
    const blockers = lint.filter((f) => f.severity === 'error');
    expect(blockers.length).toBeGreaterThan(0); // sanidade: motor produz bloqueante

    const { criteria } = computeReadiness(shapes, conns, csvStore, { lint }, {});
    const c = criteria.find((x) => x.id === 'lint_no_blockers');
    expect(c.state).toBe('fail');
    expect(c.facts.blockerCount).toBe(blockers.length);
    expect(c.facts.codes).toEqual(blockers.map((f) => f.code));
    expect(c.fixCommandId).toBe('copilot.reviewBlockers');
  });

  it('lint sem error (warning/info não bloqueiam) ⇒ PASS', () => {
    const lint = [{ severity: 'warning', code: 'zero_arrival' }, { severity: 'info', code: 'dead_branch' }];
    const c = computeReadiness([], [], {}, { lint }, {}).criteria.find((x) => x.id === 'lint_no_blockers');
    expect(c.state).toBe('pass');
    expect(c.facts.blockerCount).toBe(0);
  });
});

describe('computeReadiness · full_coverage ≡ funil (decidedQty × totalQty)', () => {
  it('100% decidido ⇒ pass', () => {
    const c = computeReadiness([], [], {}, { coverage: { totalQty: 200, decidedQty: 200 } }, {}).criteria.find((x) => x.id === 'full_coverage');
    expect(c.state).toBe('pass');
    expect(c.facts.undecidedQty).toBe(0);
    expect(c.facts.coveragePct).toBe(100);
  });
  it('população não totalmente decidida ⇒ fail com o resto declarado', () => {
    const c = computeReadiness([], [], {}, { coverage: { totalQty: 200, decidedQty: 150 } }, {}).criteria.find((x) => x.id === 'full_coverage');
    expect(c.state).toBe('fail');
    expect(c.facts.undecidedQty).toBe(50);
  });
  it('sem população (funil vazio) ⇒ na', () => {
    const c = computeReadiness([], [], {}, {}, {}).criteria.find((x) => x.id === 'full_coverage');
    expect(c.state).toBe('na');
    expect(c.facts.reason).toBe('no_population');
  });
});

describe('computeReadiness · no_pending_vars (rastro de mapeamento de biblioteca)', () => {
  it('losango com label sem variableCol ⇒ fail (mesma heurística do feed)', () => {
    const shapes = [{ id: 'D1', type: 'decision', label: 'Renda', variableCol: null }];
    const c = computeReadiness(shapes, [], {}, { pendingVars: [{ name: 'Score' }] }, {}).criteria.find((x) => x.id === 'no_pending_vars');
    expect(c.state).toBe('fail');
    expect(c.facts.names.sort()).toEqual(['Renda', 'Score']);
    expect(c.facts.pendingCount).toBe(2);
  });
  it('nenhuma pendência ⇒ pass', () => {
    const shapes = [{ id: 'D1', type: 'decision', label: 'Renda', variableCol: 'RENDA', csvId: 'base' }];
    const c = computeReadiness(shapes, [], {}, {}, {}).criteria.find((x) => x.id === 'no_pending_vars');
    expect(c.state).toBe('pass');
  });
});

describe('computeReadiness · asis_delta', () => {
  it('AS IS configurado + funil simulado ⇒ pass', () => {
    const csvStore = { base: { asIsConfig: { col: 'D', mapping: {} } } };
    const c = computeReadiness([], [], csvStore, { coverage: { totalQty: 10, decidedQty: 10 } }, {}).criteria.find((x) => x.id === 'asis_delta');
    expect(c.state).toBe('pass');
    expect(c.facts).toEqual({ asIsConfigured: true, deltaSimulated: true });
  });
  it('sem AS IS ⇒ fail', () => {
    const c = computeReadiness([], [], { base: { asIsConfig: null } }, { coverage: { totalQty: 10, decidedQty: 10 } }, {}).criteria.find((x) => x.id === 'asis_delta');
    expect(c.state).toBe('fail');
    expect(c.facts.asIsConfigured).toBe(false);
  });
});

describe('computeReadiness · doc_current ≡ policyIRFingerprint (diff vazio desde a geração)', () => {
  const ir = { nodes: [{ id: 'D1', kind: 'decision', label: 'A', variable: { col: 'SEG', csvId: 'b' }, routes: [] }], entry: ['D1'] };
  const irChanged = { nodes: [{ id: 'D1', kind: 'decision', label: 'A', variable: { col: 'OUTRA', csvId: 'b' }, routes: [] }], entry: ['D1'] };

  it('carimbo da última doc == IR atual ⇒ pass', () => {
    const c = computeReadiness([], [], {}, { ir, docFingerprint: policyIRFingerprint(ir) }, {}).criteria.find((x) => x.id === 'doc_current');
    expect(c.state).toBe('pass');
    expect(c.facts).toEqual({ generated: true, current: true, docFingerprint: policyIRFingerprint(ir), currentFingerprint: policyIRFingerprint(ir) });
  });
  it('doc gerada mas o IR mudou desde então ⇒ fail (desatualizada)', () => {
    const c = computeReadiness([], [], {}, { ir: irChanged, docFingerprint: policyIRFingerprint(ir) }, {}).criteria.find((x) => x.id === 'doc_current');
    expect(c.state).toBe('fail');
    expect(c.facts.generated).toBe(true);
    expect(c.facts.current).toBe(false);
  });
  it('doc nunca gerada ⇒ fail (generated:false)', () => {
    const c = computeReadiness([], [], {}, { ir, docFingerprint: null }, {}).criteria.find((x) => x.id === 'doc_current');
    expect(c.state).toBe('fail');
    expect(c.facts.generated).toBe(false);
  });
});

describe('computeReadiness · no_lossless_simplify ≡ computeSimplify (prova de identidade)', () => {
  // Fixture da policySimplify/nextActions: losango D colapsável atrás de uma raiz U ⇒ prova
  // identical=true (candidato LOSSLESS pendente).
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
      varTypes: {}, asIsConfig: null,
    },
  };
  const shapes = [
    { id: 'U', type: 'decision', variableCol: 'COLZ', csvId: 'base' },
    { id: 'pX', type: 'port', label: 'X' }, { id: 'pY', type: 'port', label: 'Y' },
    { id: 'D', type: 'decision', variableCol: 'COLX', csvId: 'base' },
    { id: 'pA', type: 'port', label: 'A' }, { id: 'pB', type: 'port', label: 'B' },
    { id: 'AP', type: 'approved' }, { id: 'RJ2', type: 'rejected' },
  ];
  const conns = [
    { id: 'c1', from: 'U', to: 'pX', label: 'X' }, { id: 'c2', from: 'U', to: 'pY', label: 'Y' },
    { id: 'c3', from: 'pX', to: 'D' }, { id: 'c4', from: 'pY', to: 'RJ2' },
    { id: 'c5', from: 'D', to: 'pA', label: 'A' }, { id: 'c6', from: 'D', to: 'pB', label: 'B' },
    { id: 'c7', from: 'pA', to: 'AP' }, { id: 'c8', from: 'pB', to: 'AP' },
  ];

  it('candidato lossless pendente do motor ⇒ fail', () => {
    const na = computeNodeArrivals(shapes, conns, csvStore, {});
    const simplify = computeSimplify(shapes, conns, csvStore, na);
    expect(simplify.proposal.candidates.length).toBe(1); // sanidade: motor acha o colapsável
    expect(simplify.equivalence.identical).toBe(true);

    const c = computeReadiness(shapes, conns, csvStore, { simplify }, {}).criteria.find((x) => x.id === 'no_lossless_simplify');
    expect(c.state).toBe('fail');
    expect(c.facts.candidateCount).toBe(1);
    expect(c.facts.identical).toBe(true);
  });

  it('sem proposta de simplificação ⇒ pass', () => {
    const c = computeReadiness([], [], {}, {}, {}).criteria.find((x) => x.id === 'no_lossless_simplify');
    expect(c.state).toBe('pass');
    expect(c.facts.candidateCount).toBe(0);
  });

  it('candidato LOSSY (identical=false) não reprova o critério ⇒ pass', () => {
    const simplify = { proposal: { candidates: [{ id: 'z' }] }, equivalence: { identical: false } };
    const c = computeReadiness([], [], {}, { simplify }, {}).criteria.find((x) => x.id === 'no_lossless_simplify');
    expect(c.state).toBe('pass');
  });
});

describe('computeReadiness · stable_vars ≡ flags do BaseProfileModel', () => {
  const shapes = [{ id: 'D1', type: 'decision', variableCol: 'SEG', csvId: 'base' }];
  it('variável usada com flag unstable_psi ⇒ fail', () => {
    const baseProfile = { variables: [{ col: 'SEG', flags: ['unstable_psi'] }, { col: 'OUTRA', flags: [] }] };
    const c = computeReadiness(shapes, [], {}, { baseProfile }, {}).criteria.find((x) => x.id === 'stable_vars');
    expect(c.state).toBe('fail');
    expect(c.facts.unstableVars).toEqual(['SEG']);
  });
  it('variável usada sem flag instável ⇒ pass', () => {
    const baseProfile = { variables: [{ col: 'SEG', flags: ['high_iv'] }] };
    const c = computeReadiness(shapes, [], {}, { baseProfile }, {}).criteria.find((x) => x.id === 'stable_vars');
    expect(c.state).toBe('pass');
    expect(c.facts.checkedCount).toBe(1);
  });
  it('sem Perfil da Base ⇒ na (degradação declarada)', () => {
    const c = computeReadiness(shapes, [], {}, {}, {}).criteria.find((x) => x.id === 'stable_vars');
    expect(c.state).toBe('na');
    expect(c.facts.reason).toBe('no_profile');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════
// (C) E6 Validação — costura detectJourneyStages × computeReadiness
// ═══════════════════════════════════════════════════════════════════════════════════

describe('detectJourneyStages · E6 Validação = checklist 100% nos critérios ativos', () => {
  // Cenário 100% pronto: sem lint, funil 100%, sem pendência, AS IS + delta, doc atual, sem
  // simplificação, perfil estável. stable_vars precisa de perfil p/ ser um critério ATIVO.
  const ir = { nodes: [{ id: 'D1', kind: 'decision', label: 'A', variable: { col: 'SEG', csvId: 'base' }, routes: [] }], entry: ['D1'] };
  const shapes = [{ id: 'D1', type: 'decision', variableCol: 'SEG', csvId: 'base' }];
  const csvStore = { base: { headers: ['SEG'], rowCount: 10, varTypes: {}, asIsConfig: { col: 'D', mapping: {} } } };
  const readyArt = {
    ir,
    lint: [],
    coverage: { totalQty: 100, decidedQty: 100 },
    docFingerprint: policyIRFingerprint(ir),
    baseProfile: { variables: [{ col: 'SEG', flags: ['high_iv'] }] },
  };

  it('todos os critérios ativos passam ⇒ E6 done', () => {
    const readiness = computeReadiness(shapes, [], csvStore, readyArt, {});
    const active = readiness.criteria.filter((c) => c.state !== 'na');
    expect(active.every((c) => c.state === 'pass')).toBe(true); // sanidade
    const st = byId(detectJourneyStages(shapes, [], csvStore, readyArt), 'validation');
    expect(st.state).toBe('done');
    expect(st.facts.ready).toBe(true);
    expect(st.facts.failing).toEqual([]);
  });

  it('um critério ativo falhando ⇒ E6 todo, com o id do critério em failing', () => {
    const art = { ...readyArt, coverage: { totalQty: 100, decidedQty: 60 } }; // funil não fecha
    const st = byId(detectJourneyStages(shapes, [], csvStore, art), 'validation');
    expect(st.state).toBe('todo');
    expect(st.facts.ready).toBe(false);
    expect(st.facts.failing).toContain('full_coverage');
  });

  it('critério desativado por config sai da conta de E6', () => {
    const art = { ...readyArt, coverage: { totalQty: 100, decidedQty: 60 }, readinessConfig: { full_coverage: false } };
    const st = byId(detectJourneyStages(shapes, [], csvStore, art), 'validation');
    expect(st.state).toBe('done'); // o único que falhava foi desativado
    expect(st.facts.activeCount).toBe(6); // 7 critérios − full_coverage desativado
  });
});
