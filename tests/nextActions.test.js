import { describe, it, expect } from 'vitest';
import {
  computeNextActions,
  computePolicyInsights,
  policyIRFingerprint,
  computeVariableRanking,
  computeSegmentDiscovery,
  computeSimplify,
  computeNodeArrivals,
  buildFeedTier2,
} from '../src/simulation.worker.js';
import { buildColumnar } from '../src/columnar.js';

// ── GATE Sessão NB1 · Feed de Próxima Melhor Ação (Jornada NB) ────────────────────
// docs/wiki/Jornada-Prompts-Sessoes.md (DEC-NB-001..004, 008, 009). Duas frentes:
//   (A) DEC-NB-009 — lint consciente de tráfego (sobre `computePolicyInsights` puro):
//       porta solta com 0 chegadas vira `dead_branch` (nunca `error`), colapso por
//       causa-raiz, contagens ≡ nodeArrivals.
//   (B) `computeNextActions` — orquestrador do NextActionsModel: fontes Tier 1 ≡ motor,
//       costura Tier 2, priorização determinística, fingerprint/staleness, nó travado.
// Todas as funções são puras (padrão policyLint.test.js): fixtures literais de
// shapes/conns + nodeArrivals/lensCounts/csvStore/context/tier2, sem protocolo de worker.

function toColumnar(csv) {
  const { columns, rowCount } = buildColumnar(csv.headers, csv.rows, csv.columnTypes);
  const { rows, ...rest } = csv;
  return { ...rest, columns, rowCount };
}

const codesOf = (arr) => arr.map((x) => x.code || x.kind);

// ═══════════════════════════════════════════════════════════════════════════════════
// (A) DEC-NB-009 — lint consciente de tráfego
// ═══════════════════════════════════════════════════════════════════════════════════

describe('DEC-NB-009 · consolidação port_dangling + zero_arrival → dead_branch', () => {
  const shapes = [
    { id: 'D1', type: 'decision', label: 'Canal', variableCol: 'CANAL', csvId: 'base' },
    { id: 'pA', type: 'port', label: 'A' },
    { id: 'pB', type: 'port', label: 'B' },
    { id: 'AP', type: 'approved' },
  ];
  const conns = [
    { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
    { id: 'c2', from: 'D1', to: 'pB', label: 'B' }, // pB solta
    { id: 'c3', from: 'pA', to: 'AP' },
  ];

  it('porta solta cujo valor tem 0 chegadas: 1 dead_branch (info), 0 port_dangling, 0 zero_arrival', () => {
    // D1 tem entrada em nodeArrivals mas o valor 'B' está ausente ⇒ 0 chegadas provadas.
    const findings = computePolicyInsights(shapes, conns, { D1: { val: { A: 100 } } }, {});
    expect(codesOf(findings).filter((c) => c === 'port_dangling')).toHaveLength(0);
    expect(codesOf(findings).filter((c) => c === 'zero_arrival')).toHaveLength(0);
    const dead = findings.filter((f) => f.code === 'dead_branch');
    expect(dead).toHaveLength(1);
    expect(dead[0].severity).toBe('info');
    expect(dead[0].nodeId).toBe('pB');
    expect(dead[0].arrivals).toBe(0);
    expect(dead[0].parentId).toBe('D1');
    expect(dead[0].value).toBe('B');
    // CTAs "remover do domínio" / "conectar mesmo assim".
    expect(dead[0].fixes.map((x) => x.kind)).toEqual(['remove_from_domain', 'connect_terminal']);
  });

  it('NUNCA um achado error com 0 chegadas', () => {
    const findings = computePolicyInsights(shapes, conns, { D1: { val: { A: 100 } } }, {});
    for (const f of findings) {
      if (f.severity === 'error') expect(f.arrivals).not.toBe(0);
    }
  });

  it('porta solta COM tráfego continua port_dangling (error) — com a contagem na mensagem', () => {
    const findings = computePolicyInsights(shapes, conns, { D1: { val: { A: 100, B: 40 } } }, {});
    const pd = findings.find((f) => f.code === 'port_dangling' && f.nodeId === 'pB');
    expect(pd).toBeTruthy();
    expect(pd.severity).toBe('error');
    expect(pd.arrivals).toBe(40); // contagem ≡ nodeArrivals
    expect(pd.msg).toContain('40');
    expect(findings.some((f) => f.code === 'dead_branch')).toBe(false);
  });

  it('sem dado de chegada (nodeArrivals vazio) ⇒ port_dangling legado (arrivals null)', () => {
    const findings = computePolicyInsights(shapes, conns, {}, {});
    const pd = findings.find((f) => f.code === 'port_dangling' && f.nodeId === 'pB');
    expect(pd).toBeTruthy();
    expect(pd.severity).toBe('error');
    expect(pd.arrivals).toBeNull();
    expect(pd.fix).toEqual({ kind: 'connect_terminal', nodeId: 'pB' });
  });
});

describe('DEC-NB-009 · colapso por causa-raiz (dominância)', () => {
  // D1 decide SEG: 'A' com tráfego (→ TERM), 'B' com 0 chegadas (→ D2, subárvore morta).
  // D2 recebe 0; a porta pC (valor 'C') é ramo morto derivado. Tudo colapsa no zero_arrival
  // de 'B' em D1 (a causa-raiz, num nó que RECEBE volume por outro valor).
  const shapes = [
    { id: 'D1', type: 'decision', label: 'Seg', variableCol: 'SEG', csvId: 'base' },
    { id: 'pA', type: 'port', label: 'A' },
    { id: 'pB', type: 'port', label: 'B' },
    { id: 'D2', type: 'decision', label: 'Sub', variableCol: 'SUB', csvId: 'base' },
    { id: 'pC', type: 'port', label: 'C' },
    { id: 'TERM', type: 'approved' },
  ];
  const conns = [
    { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
    { id: 'c2', from: 'pA', to: 'TERM' },
    { id: 'c3', from: 'D1', to: 'pB', label: 'B' },
    { id: 'c4', from: 'pB', to: 'D2' },
    { id: 'c5', from: 'D2', to: 'pC', label: 'C' }, // pC solta, D2 morto
  ];
  const nodeArrivals = { D1: { val: { A: 100 } }, D2: { val: {} } };

  it('achados a jusante do nó de chegada zero colapsam na causa-raiz com coversDerived', () => {
    const findings = computePolicyInsights(shapes, conns, nodeArrivals, {});
    // nenhum card próprio dos nós mortos a jusante
    expect(findings.some((f) => f.nodeId === 'pC')).toBe(false);
    const rc = findings.find((f) => f.code === 'zero_arrival' && f.nodeId === 'D1' && f.value === 'B');
    expect(rc).toBeTruthy();
    expect(rc.arrivals).toBe(0);
    expect(rc.coversDerived).toBe(1); // cobriu o dead_branch de pC
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════
// (B) computeNextActions — orquestrador
// ═══════════════════════════════════════════════════════════════════════════════════

// Base real (colunar) para o ranking da porta: SEG roteia; SCORE é a variável rankeável.
function rankingBase() {
  return toColumnar({
    name: 'base',
    headers: ['SEG', 'SCORE', 'qty', 'qtdAltas', 'inadReal'],
    rows: [
      ['Y', 'A', '100', '100', '5'],
      ['Y', 'B', '100', '100', '50'],
      ['Y', 'A', '50', '50', '2'],
      ['X', 'A', '80', '80', '4'],
    ],
    columnTypes: { SEG: 'decision', SCORE: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
    varTypes: {},
  });
}
// D1 decide SEG: X→pX→TERM, Y→pY (solta, COM tráfego ⇒ connect_port).
const rankShapes = [
  { id: 'D1', type: 'decision', label: 'Seg', variableCol: 'SEG', csvId: 'base' },
  { id: 'pX', type: 'port', label: 'X' },
  { id: 'pY', type: 'port', label: 'Y' },
  { id: 'TERM', type: 'approved' },
];
const rankConns = [
  { id: 'c1', from: 'D1', to: 'pX', label: 'X' },
  { id: 'c2', from: 'pX', to: 'TERM' },
  { id: 'c3', from: 'D1', to: 'pY', label: 'Y' }, // pY solta com tráfego
];
// Contexto que zera todas as fontes estruturais (isola Tier 1 lint).
const cleanCtx = { baseLoaded: true, baseExplored: false, hasAsIs: true, canvasId: 'cv1' };

describe('computeNextActions · Tier 1 lint ≡ motor (mesmos achados, mesmas portas, mesmo ranking)', () => {
  it('cada achado do lint vira exatamente um card; port_dangling embute o top-3 do ranking da porta', () => {
    const csvStore = { base: rankingBase() };
    const nodeArrivals = { D1: { val: { X: 80, Y: 250 } } }; // Y com tráfego ⇒ port_dangling
    const ir = { nodes: [{ id: 'D1', kind: 'decision', label: 'Seg' }], entry: ['D1'] };

    const lint = computePolicyInsights(rankShapes, rankConns, nodeArrivals, {});
    // Sanidade da fixture: só o port_dangling de pY (X/Y têm tráfego).
    expect(codesOf(lint)).toEqual(['port_dangling']);

    const model = computeNextActions(rankShapes, rankConns, csvStore, ir, nodeArrivals, {}, cleanCtx, {});
    const lintCards = model.actions.filter((a) => a.kind === 'connect_port' || a.kind.startsWith('fix_lint_'));
    expect(lintCards).toHaveLength(lint.length);

    const cp = model.actions.find((a) => a.kind === 'connect_port');
    expect(cp).toBeTruthy();
    expect(cp.severity).toBe('blocker');
    expect(cp.title.facts.nodeId).toBe('pY');
    expect(cp.title.facts.arrivals).toBe(250);

    // Ranking embutido ≡ motor existente (computeVariableRanking), sem cópia.
    const rk = computeVariableRanking(rankShapes, rankConns, csvStore, 'pY');
    const expectedTop3 = (rk.ranking || []).slice(0, 3).map((r) => ({ col: r.col, csvId: r.csvId, iv: r.iv ?? null }));
    expect(cp.title.facts.top3).toEqual(expectedTop3);
    expect(expectedTop3.length).toBeGreaterThan(0); // SCORE entra no ranking
  });

  it('warning do lint vira card de higiene; error vira bloqueante', () => {
    // D1: X (tráfego, →TERM), Z (0 chegadas, porta CONECTADA ⇒ zero_arrival warning).
    const shapes = [
      { id: 'D1', type: 'decision', label: 'Seg', variableCol: 'SEG', csvId: 'base' },
      { id: 'pX', type: 'port', label: 'X' },
      { id: 'pZ', type: 'port', label: 'Z' },
      { id: 'TERM', type: 'approved' },
      { id: 'TERM2', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'D1', to: 'pX', label: 'X' },
      { id: 'c2', from: 'pX', to: 'TERM' },
      { id: 'c3', from: 'D1', to: 'pZ', label: 'Z' },
      { id: 'c4', from: 'pZ', to: 'TERM2' },
    ];
    const nodeArrivals = { D1: { val: { X: 100 } } }; // Z ausente ⇒ zero_arrival
    const ir = { nodes: [{ id: 'D1', kind: 'decision' }], entry: ['D1'] };
    const model = computeNextActions(shapes, conns, {}, ir, nodeArrivals, {}, cleanCtx, {});
    const za = model.actions.find((a) => a.kind === 'fix_lint_zero_arrival');
    expect(za).toBeTruthy();
    expect(za.severity).toBe('hygiene');
    expect(za.title.facts.value).toBe('Z');
    expect(za.title.facts.arrivals).toBe(0);
  });
});

describe('computeNextActions · priorização determinística e monótona (severidade > score > id)', () => {
  const SEV = { blocker: 0, opportunity: 1, hygiene: 2, journey: 3 };
  // Canvas que gera 4 severidades: blocker(connect_port), hygiene(zero_arrival),
  // opportunity(discovery), journey(save_library).
  const shapes = [
    { id: 'D1', type: 'decision', label: 'Seg', variableCol: 'SEG', csvId: 'base' },
    { id: 'pX', type: 'port', label: 'X' },
    { id: 'pY', type: 'port', label: 'Y' },
    { id: 'pZ', type: 'port', label: 'Z' },
    { id: 'TERM', type: 'approved' },
  ];
  const conns = [
    { id: 'c1', from: 'D1', to: 'pX', label: 'X' },
    { id: 'c2', from: 'pX', to: 'TERM' },
    { id: 'c3', from: 'D1', to: 'pY', label: 'Y' }, // solta com tráfego → connect_port
    { id: 'c4', from: 'D1', to: 'pZ', label: 'Z' }, // solta, 0 chegadas → dead_branch (hygiene)
  ];
  const nodeArrivals = { D1: { val: { X: 100, Y: 50 } } }; // Z ausente
  const ir = { nodes: [{ id: 'D1', kind: 'decision' }], entry: ['D1'] };
  const discovery = {
    computedAt: 1, policyFingerprint: policyIRFingerprint(ir),
    findings: [{
      id: 'seg1', code: 'deviation', segment: { conditions: [{ col: 'X', value: '1' }] },
      priority: { score: 42, impact: { movedQty: 10 }, confidence: 0.8, actionability: 1 }, locked: false,
      recommendation: { actionable: true, reason: null, delta: { approvalDelta: 0.02, inadRealDelta: -0.01, inadInfDelta: 0, movedQty: 10 } },
    }],
  };
  const ctx = { ...cleanCtx, policyMature: true, hasLibraryTemplate: false, lastDocFingerprint: policyIRFingerprint(ir) };

  it('as ações saem ordenadas por classe de severidade e, dentro dela, por score desc', () => {
    const model = computeNextActions(shapes, conns, {}, ir, nodeArrivals, {}, ctx, { discovery });
    const sevs = model.actions.map((a) => SEV[a.severity]);
    for (let i = 1; i < sevs.length; i++) expect(sevs[i]).toBeGreaterThanOrEqual(sevs[i - 1]);
    // dentro da mesma classe, score não-crescente
    for (let i = 1; i < model.actions.length; i++) {
      const a = model.actions[i - 1], b = model.actions[i];
      if (a.severity === b.severity) expect(b.priority.score).toBeLessThanOrEqual(a.priority.score);
    }
    // as 4 classes presentes
    expect(new Set(model.actions.map((a) => a.severity))).toEqual(new Set(['blocker', 'opportunity', 'hygiene', 'journey']));
  });

  it('determinismo: duas gerações ⇒ mesma ordem de ids e mesmo policyFingerprint', () => {
    const m1 = computeNextActions(shapes, conns, {}, ir, nodeArrivals, {}, ctx, { discovery });
    const m2 = computeNextActions(shapes, conns, {}, ir, nodeArrivals, {}, ctx, { discovery });
    expect(m2.actions.map((a) => a.id)).toEqual(m1.actions.map((a) => a.id));
    expect(m2.policyFingerprint).toBe(m1.policyFingerprint);
  });
});

describe('computeNextActions · fingerprint estável e staleness Tier 2', () => {
  const ir1 = { nodes: [{ id: 'D1', kind: 'decision', label: 'A', variable: { col: 'SEG', csvId: 'b' }, routes: [] }], entry: ['D1'] };
  const ir2 = { nodes: [{ id: 'D1', kind: 'decision', label: 'A', variable: { col: 'OUTRA', csvId: 'b' }, routes: [] }], entry: ['D1'] };

  it('policyIRFingerprint é estável sob regeneração e muda quando o IR muda', () => {
    expect(policyIRFingerprint(ir1)).toBe(policyIRFingerprint(ir1));
    expect(policyIRFingerprint(ir1)).not.toBe(policyIRFingerprint(ir2));
    // independe da ordem dos nós (ordenação canônica por id)
    const irA = { nodes: [{ id: 'A', kind: 'terminal', terminal: 'approved' }, { id: 'B', kind: 'terminal', terminal: 'rejected' }], entry: [] };
    const irB = { nodes: [{ id: 'B', kind: 'terminal', terminal: 'rejected' }, { id: 'A', kind: 'terminal', terminal: 'approved' }], entry: [] };
    expect(policyIRFingerprint(irA)).toBe(policyIRFingerprint(irB));
  });

  const shapes = [{ id: 'D1', type: 'decision', label: 'A', variableCol: 'SEG', csvId: 'b' }];
  const discoveryFor = (fp) => ({
    computedAt: 10, policyFingerprint: fp,
    findings: [{ id: 's1', code: 'deviation', segment: { conditions: [] }, priority: { score: 5 }, locked: false, recommendation: { actionable: true, delta: { approvalDelta: 0.01, movedQty: 3 } } }],
  });

  it('card Tier 2 stale=false quando o carimbo bate; vira true quando o IR mudou', () => {
    const fp1 = policyIRFingerprint(ir1);
    const fresh = computeNextActions(shapes, [], {}, ir1, {}, {}, cleanCtx, { discovery: discoveryFor(fp1) });
    const cardFresh = fresh.actions.find((a) => a.kind === 'apply_opportunity');
    expect(cardFresh).toBeTruthy();
    expect(cardFresh.staleness.stale).toBe(false);
    expect(cardFresh.delta).toEqual({ approvalDelta: 0.01, inadRealDelta: null, inadInfDelta: null, movedQty: 3 });

    // Mesmo achado carimbado com fp1, mas agora o IR é ir2 ⇒ desatualizado.
    const stale = computeNextActions(shapes, [], {}, ir2, {}, {}, cleanCtx, { discovery: discoveryFor(fp1) });
    const cardStale = stale.actions.find((a) => a.kind === 'apply_opportunity');
    expect(cardStale.staleness.stale).toBe(true);
  });

  it('achado Tier 2 sem recommendation validada NÃO exibe delta', () => {
    const disc = { computedAt: 1, policyFingerprint: policyIRFingerprint(ir1), findings: [{ id: 's2', code: 'deviation', segment: { conditions: [] }, priority: { score: 1 }, locked: false, recommendation: null }] };
    const model = computeNextActions(shapes, [], {}, ir1, {}, {}, cleanCtx, { discovery: disc });
    const card = model.actions.find((a) => a.kind === 'apply_opportunity');
    expect(card.delta).toBeNull();
  });
});

describe('computeNextActions · nó travado ⇒ actionable:false', () => {
  it('card de lint sobre um nó travado (🔒) é não-acionável, com razão declarada', () => {
    // Lens sem saída ⇒ path_without_terminal (error) no nó L1; L1 travado.
    const shapes = [{ id: 'L1', type: 'decision_lens', label: 'Lente', rules: [] }];
    const ir = { nodes: [{ id: 'L1', kind: 'lens' }], entry: ['L1'] };
    const model = computeNextActions(shapes, [], {}, ir, {}, {}, { ...cleanCtx, lockedNodeIds: ['L1'] }, {});
    const card = model.actions.find((a) => a.kind === 'fix_lint_path_without_terminal');
    expect(card).toBeTruthy();
    expect(card.actionable).toBe(false);
    expect(card.reason).toBe('node_locked');
  });

  it('achado Tier 2 em nó travado ⇒ apply_opportunity não-acionável', () => {
    const ir = { nodes: [{ id: 'D1', kind: 'decision' }], entry: ['D1'] };
    const disc = { computedAt: 1, policyFingerprint: policyIRFingerprint(ir), findings: [{ id: 's1', code: 'deviation', segment: { conditions: [] }, priority: { score: 1 }, locked: true, recommendation: { actionable: false, reason: 'Segmento decidido em nó travado (🔒) — desabilite a trava para aplicar.', delta: null } }] };
    const model = computeNextActions([{ id: 'D1', type: 'decision', variableCol: 'X', csvId: 'b' }], [], {}, ir, {}, {}, cleanCtx, { discovery: disc });
    const card = model.actions.find((a) => a.kind === 'apply_opportunity');
    expect(card.actionable).toBe(false);
  });
});

describe('computeNextActions · feed nunca vazio', () => {
  it('política limpa sem pendências ⇒ pelo menos um card de jornada', () => {
    // D1 decide A/B, ambos com tráfego e conectados a terminais: sem lint.
    const shapes = [
      { id: 'D1', type: 'decision', label: 'Seg', variableCol: 'SEG', csvId: 'b' },
      { id: 'pA', type: 'port', label: 'A' },
      { id: 'pB', type: 'port', label: 'B' },
      { id: 'AP', type: 'approved' },
      { id: 'RJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
      { id: 'c2', from: 'pA', to: 'AP' },
      { id: 'c3', from: 'D1', to: 'pB', label: 'B' },
      { id: 'c4', from: 'pB', to: 'RJ' },
    ];
    const nodeArrivals = { D1: { val: { A: 50, B: 50 } } };
    const ir = { nodes: [{ id: 'D1', kind: 'decision' }], entry: ['D1'] };
    const ctx = { baseLoaded: true, hasAsIs: true, lastDocFingerprint: policyIRFingerprint(ir) };
    const model = computeNextActions(shapes, conns, {}, ir, nodeArrivals, {}, ctx, {});
    expect(model.actions.length).toBeGreaterThan(0);
    expect(model.actions.every((a) => a.severity === 'journey')).toBe(true);
  });

  it('canvas vazio + base explorada ⇒ card first_branch (journey) com o topo do ranking', () => {
    const csvStore = { base: rankingBase() };
    const ir = { nodes: [], entry: [] };
    const model = computeNextActions([], [], csvStore, ir, {}, {}, { baseLoaded: true, baseExplored: true }, {});
    const fb = model.actions.find((a) => a.kind === 'first_branch');
    expect(fb).toBeTruthy();
    expect(fb.severity).toBe('journey');
    expect(fb.title.facts.top).toBeTruthy(); // ranking global tem um topo
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════
// (C) Sessão NB3 — fontes caras sob demanda ("🔎 Buscar oportunidades")
// docs/wiki/Jornada-Prompts-Sessoes.md (DEC-NB-002/003). buildFeedTier2 embrulha os achados
// JÁ calculados pela Descoberta/Simplificação (motores originais, intocados) com o carimbo de
// frescor; computeNextActions os costura como cards Tier 2. Aqui provamos: (1) paridade número
// a número — os cards saem exatamente dos findings/proposal dos motores; (2) staleness no
// momento certo; (3) o fingerprint do card é estável sob rebusca (dismissed não ressuscita).
// ═══════════════════════════════════════════════════════════════════════════════════

// Fixture de Descoberta (mesma da segmentDiscovery.test.js): política "reprova tudo" +
// interação 2D plantada (SCORE=R08 × CANAL=Digital com inad baixa) ⇒ findings acionáveis.
const discCsv = {
  headers: ['SCORE', 'CANAL', 'qty', 'qtdAltas', 'inadReal'],
  columnTypes: { SCORE: 'decision', CANAL: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
  rows: [
    ['R08', 'Digital', '1000', '1000', '20'],
    ['R08', 'Fisico', '1000', '1000', '380'],
    ['R05', 'Digital', '1000', '1000', '380'],
    ['R05', 'Fisico', '1000', '1000', '20'],
  ],
};
const discStore = { seg: discCsv };
const discShapes = [
  { id: 'L', type: 'decision_lens', label: 'Todos', rules: [] },
  { id: 'REJ', type: 'rejected', label: 'Reprovado' },
];
const discConns = [{ id: 'c1', from: 'L', to: 'REJ' }];
const discIr = { nodes: [{ id: 'L', kind: 'lens' }, { id: 'REJ', kind: 'terminal', terminal: 'rejected' }], entry: ['L'] };

// Réplica EXATA da regra de costura Tier 2 do worker (computeNextActions) — o oráculo da
// paridade: dado os findings crus, quais cards devem existir e com que delta.
function expectedDiscoveryCards(findings, stampFp, curFp) {
  const stale = stampFp !== curFp;
  const out = [];
  for (const f of findings) {
    if (f.code === 'asis_divergence' || f.code === 'anomaly') continue;
    const kind = f.code === 'heterogeneous_block' ? 'add_break' : 'apply_opportunity';
    const rec = f.recommendation || null;
    const delta = (rec && rec.delta) ? {
      approvalDelta: rec.delta.approvalDelta ?? null,
      inadRealDelta: rec.delta.inadRealDelta ?? null,
      inadInfDelta: rec.delta.inadInfDelta ?? null,
      movedQty: rec.delta.movedQty ?? null,
    } : null;
    out.push({ id: `${kind}::${f.id}`, kind, delta, stale });
  }
  return out;
}

describe('NB3 · buildFeedTier2 embrulha os motores sem refazer matemática', () => {
  it('discovery/simplify carregam os MESMOS objetos dos motores + carimbo de frescor', () => {
    const segmentModel = computeSegmentDiscovery(discShapes, discConns, discStore, null, { minQty: 1 });
    const na = computeNodeArrivals(discShapes, discConns, discStore, {});
    const simplify = computeSimplify(discShapes, discConns, discStore, na);
    const t2 = buildFeedTier2(segmentModel, simplify, 'FP', 12345);
    // findings/proposal são os do motor (mesma referência) — nenhuma cópia/recomputo.
    expect(t2.discovery.findings).toBe(segmentModel.findings);
    expect(t2.discovery.policyFingerprint).toBe('FP');
    expect(t2.discovery.computedAt).toBe(12345);
    expect(t2.simplify.proposal).toBe(simplify.proposal);
    expect(t2.simplify.equivalence).toBe(simplify.equivalence);
    expect(t2.simplify.policyFingerprint).toBe('FP');
  });

  it('sem achados ⇒ blob mínimo, sem chaves inventadas', () => {
    const t2 = buildFeedTier2({ findings: [] }, { proposal: null, equivalence: null }, 'FP', 1);
    expect(t2.discovery.findings).toEqual([]);
    expect(t2.simplify).toBeUndefined(); // proposal null ⇒ nenhuma seção simplify
  });
});

describe('NB3 · paridade número a número — cards Tier 2 ≡ motores originais', () => {
  it('cada finding acionável da Descoberta vira exatamente um card, com o mesmo delta', () => {
    const segmentModel = computeSegmentDiscovery(discShapes, discConns, discStore, null, { minQty: 1 });
    const na = computeNodeArrivals(discShapes, discConns, discStore, {});
    const simplify = computeSimplify(discShapes, discConns, discStore, na);
    const stampFp = policyIRFingerprint(discIr);
    const t2 = buildFeedTier2(segmentModel, simplify, stampFp, 1);

    const model = computeNextActions(discShapes, discConns, discStore, discIr, {}, {}, cleanCtx, t2);
    const t2Cards = model.actions
      .filter((a) => a.tier === 2 && (a.kind === 'apply_opportunity' || a.kind === 'add_break'))
      .map((a) => ({ id: a.id, kind: a.kind, delta: a.delta, stale: a.staleness.stale }));

    const expected = expectedDiscoveryCards(segmentModel.findings, stampFp, policyIRFingerprint(discIr));
    expect(expected.length).toBeGreaterThan(0); // a fixture planta achados de verdade
    // Mesma quantidade, mesmos ids, mesmos deltas (ordenação estável por id).
    const byId = (arr) => [...arr].sort((x, y) => (x.id < y.id ? -1 : 1));
    expect(byId(t2Cards)).toEqual(byId(expected));
  });

  it('o card apunta pro finding correto (findingId nos facts) e delta = recommendation validada', () => {
    const segmentModel = computeSegmentDiscovery(discShapes, discConns, discStore, null, { minQty: 1 });
    const t2 = buildFeedTier2(segmentModel, null, policyIRFingerprint(discIr), 1);
    const model = computeNextActions(discShapes, discConns, discStore, discIr, {}, {}, cleanCtx, t2);
    for (const card of model.actions.filter((a) => a.tier === 2)) {
      const f = segmentModel.findings.find((x) => x.id === card.title.facts.findingId);
      expect(f).toBeTruthy();
      if (f.recommendation && f.recommendation.delta) {
        expect(card.delta.movedQty).toBe(f.recommendation.delta.movedQty ?? null);
        expect(card.delta.approvalDelta).toBe(f.recommendation.delta.approvalDelta ?? null);
      } else {
        expect(card.delta).toBeNull();
      }
    }
  });

  it('Simplificação: candidato colapsável ⇒ 1 card simplify com delta PROVADO (identical)', () => {
    // Fixture da policySimplify.test.js: losango D colapsável atrás de uma raiz U.
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
    const ir = { nodes: [{ id: 'U', kind: 'decision' }, { id: 'D', kind: 'decision' }], entry: ['U'] };

    const na = computeNodeArrivals(shapes, conns, csvStore, {});
    const simplify = computeSimplify(shapes, conns, csvStore, na);
    // Sanidade: o motor original acha o colapsável e prova identidade.
    expect(simplify.proposal.candidates.length).toBe(1);
    expect(simplify.equivalence.identical).toBe(true);

    const t2 = buildFeedTier2({ findings: [] }, simplify, policyIRFingerprint(ir), 1);
    const model = computeNextActions(shapes, conns, csvStore, ir, na, {}, cleanCtx, t2);
    const card = model.actions.find((a) => a.kind === 'simplify');
    expect(card).toBeTruthy();
    expect(card.tier).toBe(2);
    expect(card.title.facts.candidateCount).toBe(simplify.proposal.candidates.length);
    expect(card.title.facts.removedNodeCount).toBe(simplify.proposal.removedNodeCount);
    expect(card.delta).toEqual({ proven: true, approvalDelta: 0 }); // diff=0 PROVADO
    expect(card.staleness.stale).toBe(false);
  });
});

describe('NB3 · staleness no momento certo (DEC-NB-003)', () => {
  const segmentModel = computeSegmentDiscovery(discShapes, discConns, discStore, null, { minQty: 1 });
  const stampFp = policyIRFingerprint(discIr);
  const t2 = buildFeedTier2(segmentModel, null, stampFp, 10);
  // IR alterado (nova entrada de nó) ⇒ fingerprint diferente.
  const irChanged = { nodes: [...discIr.nodes, { id: 'D2', kind: 'decision', label: 'novo', variable: { col: 'SCORE', csvId: 'seg' }, routes: [] }], entry: ['L'] };

  it('carimbo == IR atual ⇒ nenhum card Tier 2 desatualizado', () => {
    const model = computeNextActions(discShapes, discConns, discStore, discIr, {}, {}, cleanCtx, t2);
    const t2Cards = model.actions.filter((a) => a.tier === 2);
    expect(t2Cards.length).toBeGreaterThan(0);
    expect(t2Cards.every((a) => a.staleness.stale === false)).toBe(true);
  });

  it('IR mudou desde o carimbo ⇒ TODOS os cards Tier 2 desatualizados (nunca removidos)', () => {
    expect(policyIRFingerprint(irChanged)).not.toBe(stampFp);
    const model = computeNextActions(discShapes, discConns, discStore, irChanged, {}, {}, cleanCtx, t2);
    const t2Cards = model.actions.filter((a) => a.tier === 2);
    expect(t2Cards.length).toBeGreaterThan(0); // continuam presentes
    expect(t2Cards.every((a) => a.staleness.stale === true)).toBe(true);
    expect(t2Cards.every((a) => a.staleness.policyFingerprint === stampFp)).toBe(true); // carimbo preservado
  });
});

describe('NB3 · dismissed não ressuscita após rebusca (fingerprint estável)', () => {
  it('duas buscas do mesmo estado ⇒ MESMOS fingerprints de card', () => {
    const scan = () => {
      const sm = computeSegmentDiscovery(discShapes, discConns, discStore, null, { minQty: 1 });
      const na = computeNodeArrivals(discShapes, discConns, discStore, {});
      const sp = computeSimplify(discShapes, discConns, discStore, na);
      const t2 = buildFeedTier2(sm, sp, policyIRFingerprint(discIr), Date.now());
      return computeNextActions(discShapes, discConns, discStore, discIr, na, {}, cleanCtx, t2);
    };
    const fps1 = scan().actions.filter((a) => a.tier === 2).map((a) => a.fingerprint).sort();
    const fps2 = scan().actions.filter((a) => a.tier === 2).map((a) => a.fingerprint).sort();
    expect(fps1.length).toBeGreaterThan(0);
    expect(fps2).toEqual(fps1); // rebusca reproduz os mesmos ids ⇒ dismissed[] segue filtrando

    // Simula o filtro do feed: um fingerprint descartado some das duas gerações.
    const dismissed = new Set([fps1[0]]);
    const visible1 = scan().actions.filter((a) => a.tier === 2 && !dismissed.has(a.fingerprint)).map((a) => a.fingerprint);
    const visible2 = scan().actions.filter((a) => a.tier === 2 && !dismissed.has(a.fingerprint)).map((a) => a.fingerprint);
    expect(visible1).not.toContain(fps1[0]);
    expect(visible2).not.toContain(fps1[0]); // não ressuscitou
  });
});
