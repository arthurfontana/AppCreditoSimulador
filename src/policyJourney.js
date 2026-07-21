// ── Etapas da Política + Checklist de Prontidão (Jornada EP, Sessão EP1) ─────────────
//
// Peça 3 da Jornada de Construção Assistida (docs/wiki/Jornada-Prompts-Sessoes.md,
// DEC-EP-001..003 + seção "Detectores do v1"). Dá o eixo narrativo do método do analista
// experiente — onde estou na construção (6 etapas canônicas) e o que falta para estar
// "pronta para o comitê" (checklist de prontidão) — como instrumento de governança.
//
// Módulo PURO (sem React/DOM/worker), compartilhado main/worker/teste, no mesmo padrão de
// src/goalSeek.js / src/clusterVar.js / src/policySimplify.js. Importa apenas o hash
// canônico do PolicyIR (policyFingerprint.js, também folha) — o MESMO usado pela
// Documentação e pelo feed NB para "diff vazio desde a geração" (DEC-EP-003: por
// construção, `policyIRFingerprint(atual) === docFingerprint` ⇔ `diffPolicyIR` vazio).
//
// REUSO, NÃO DUPLICAÇÃO (regra da sessão): a matemática dos motores existentes NÃO é
// recomputada aqui. Os detectores/critérios que dependem de motor recebem o RESULTADO já
// calculado via `artifacts` (fatos crus), e só fazem leitura estrutural determinística
// sobre shapes/conns/csvStore (adjacência/roteamento — não é a matemática do motor):
//   - `artifacts.lint`      : findings de computePolicyInsights (worker) — Tier 1 do feed.
//   - `artifacts.coverage`  : { totalQty, decidedQty } do resultado da simulação (funil).
//   - `artifacts.baseProfile`: BaseProfileModel de computeBaseProfile (flags por variável).
//   - `artifacts.simplify`  : { proposal, equivalence } de computeSimplify.
//   - `artifacts.pendingVars`: pendências de mapeamento da Biblioteca de Políticas.
//   - `artifacts.docFingerprint`: policyIRFingerprint do IR na ÚLTIMA doc gerada (null =
//                             nunca gerada). Comparado com policyIRFingerprint(artifacts.ir).
//   - `artifacts.ir`        : PolicyIR atual (buildPolicyIR) — só para o fingerprint da doc.
//   - `artifacts.calibrationApplied` / `artifacts.goalMet`: sinais do histórico do cenário
//                             (Goal Seek/otimizador aplicado; delta vs AS IS dentro da meta).
//   - `artifacts.hasAsIs`   : override opcional; senão derivado de csvStore[csvId].asIsConfig.
//   - `artifacts.overrides` : { [stageId]: 'done'|'reopened'|null } — override manual por
//                             etapa (DEC-EP-002, persistido em journeyState.stageOverrides).
//   - `artifacts.readinessConfig`: passado a computeReadiness p/ derivar a etapa E6.
//
// Detectores são IMPERFEITOS POR NATUREZA (DEC-EP-002): cada etapa SEMPRE declara em
// `facts` o que detectou e por quê, e SEMPRE aceita override manual — nunca finge certeza.

import { policyIRFingerprint } from './policyFingerprint.js';

const DECISION_LIKE = new Set(['decision', 'cineminha', 'decision_lens']);
const TERMINALS = new Set(['approved', 'rejected', 'as_is']);
const COVERAGE_EPS = 1e-9; // tolerância p/ "100% decidido" (qty são inteiros, mas defensivo)

// As 6 etapas canônicas (DEC-EP-001), na ordem de progresso.
export const STAGE_IDS = ['know_base', 'eligibility', 'segmentation', 'risk', 'calibration', 'validation'];

// Critérios v1 do Checklist de Prontidão (DEC-EP-003), na ordem de exibição.
export const READINESS_CRITERIA_IDS = [
  'lint_no_blockers', 'full_coverage', 'no_pending_vars', 'asis_delta',
  'doc_current', 'no_lossless_simplify', 'stable_vars',
];

// ═══ Leitura estrutural do fluxo (adjacência/roteamento — não é matemática de motor) ═══

function buildGraph(shapes, conns) {
  const shapesMap = {};
  for (const s of (shapes || [])) shapesMap[s.id] = s;
  const out = {};
  for (const s of (shapes || [])) out[s.id] = [];
  for (const c of (conns || [])) { if (out[c.from]) out[c.from].push(c); }
  return { shapesMap, out };
}

// Segue cadeias de ports "puros" (primeira aresta de saída) até um nó não-port — MESMA
// semântica de resolveThroughPorts do PolicyIR e do walk do motor. Port sem saída, destino
// inexistente ou ciclo só de ports → null (a linha morre no plumbing).
function resolveThroughPorts(id, shapesMap, out) {
  let cur = id;
  const seen = new Set();
  while (cur != null) {
    const node = shapesMap[cur];
    if (!node) return null;
    if (node.type !== 'port') return cur;
    if (seen.has(cur)) return null;
    seen.add(cur);
    cur = out[cur][0] ? out[cur][0].to : null;
  }
  return null;
}

// Destinos resolvidos das arestas de saída de um nó de fluxo (ports achatados).
function targetsOf(nodeId, shapesMap, out) {
  const res = [];
  for (const e of (out[nodeId] || [])) {
    const t = resolveThroughPorts(e.to, shapesMap, out);
    if (t != null) res.push(t);
  }
  return res;
}

// Raízes do fluxo — MESMO critério do motor/PolicyIR: nó de fluxo sem aresta de entrada
// vinda de um port.
function findRoots(shapes, conns) {
  const portIds = new Set((shapes || []).filter(s => s.type === 'port').map(s => s.id));
  const hasPortIn = new Set((conns || []).filter(c => portIds.has(c.from)).map(c => c.to));
  return (shapes || []).filter(s => DECISION_LIKE.has(s.type) && !hasPortIn.has(s.id)).map(s => s.id);
}

// Nível (menor nº de nós de decisão da raiz até o nó, raiz = 1) por BFS sobre o grafo de
// nós de decisão — grafo pequeno, BFS não-ponderado dá o caminho mínimo sem relaxamento.
function decisionLevels(shapes, conns, shapesMap, out) {
  const level = {};
  const queue = [];
  for (const r of findRoots(shapes, conns)) {
    if (level[r] == null) { level[r] = 1; queue.push(r); }
  }
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    for (const t of targetsOf(id, shapesMap, out)) {
      if (DECISION_LIKE.has(shapesMap[t]?.type) && level[t] == null) {
        level[t] = level[id] + 1;
        queue.push(t);
      }
    }
  }
  return level;
}

// ═══ Tipagem de variável (leitura de csvStore/baseProfile — sem recomputar nada) ═══

function varInfo(csvStore, csvId, col) {
  const csv = csvStore ? csvStore[csvId] : null;
  return {
    present: !!col,
    ordinal: csv?.varTypes?.[col] === 'ordinal',
    cluster: !!(csv?.clusterDefs && csv.clusterDefs[col]),
    range: !!(csv?.rangeDefs && csv.rangeDefs[col]),
  };
}

// Score é reconhecido só pela flag do Perfil da Base (suspect_score), quando o perfil EB
// existir — sem heurística de nome duplicada (segVarDefaultReason vive no worker).
function profileFlag(baseProfile, col, flag) {
  if (!baseProfile || !Array.isArray(baseProfile.variables)) return false;
  const v = baseProfile.variables.find(x => x.col === col);
  return !!(v && Array.isArray(v.flags) && v.flags.includes(flag));
}

// Colunas de variável de um nó de fluxo. Lens usa regras booleanas (casam por nome, sem
// tipo/csvId) — não conta como variável tipada para E3/E4.
function nodeVars(shape) {
  if (shape.type === 'decision') return shape.variableCol ? [{ col: shape.variableCol, csvId: shape.csvId ?? null }] : [];
  if (shape.type === 'cineminha') {
    const a = [];
    if (shape.rowVar?.col) a.push({ col: shape.rowVar.col, csvId: shape.rowVar.csvId ?? null });
    if (shape.colVar?.col) a.push({ col: shape.colVar.col, csvId: shape.colVar.csvId ?? null });
    return a;
  }
  return [];
}

function nodeHasSegmentationVar(shape, csvStore, baseProfile) {
  for (const { col, csvId } of nodeVars(shape)) {
    const vi = varInfo(csvStore, csvId, col);
    if (vi.cluster) return true; // cluster é sempre segmentação
    if (!vi.ordinal && !vi.range && !profileFlag(baseProfile, col, 'suspect_score')) return true; // categórica
  }
  return false;
}

function nodeHasRiskVar(shape, csvStore, baseProfile) {
  for (const { col, csvId } of nodeVars(shape)) {
    const vi = varInfo(csvStore, csvId, col);
    if (vi.ordinal || vi.range || profileFlag(baseProfile, col, 'suspect_score')) return true;
  }
  return false;
}

function collectUsedCols(shapes) {
  const cols = new Set();
  for (const s of (shapes || [])) for (const { col } of nodeVars(s)) if (col) cols.add(col);
  return [...cols];
}

// ═══ detectJourneyStages — estado das 6 etapas (DEC-EP-002 + "Detectores do v1") ═══
// Retorna um array de 6 etapas na ordem de STAGE_IDS. Cada etapa:
//   { id, index, detected, override, state, facts }
// `detected` = conclusão crua do detector; `override` ∈ {'done','reopened',null}; `state`
// resolve os dois: override 'done' ⇒ 'done'; 'reopened' ⇒ 'todo'; senão detected?'done':'todo'.
export function detectJourneyStages(shapes, conns, csvStore, artifacts = {}) {
  const art = artifacts || {};
  const { shapesMap, out } = buildGraph(shapes, conns);
  const levels = decisionLevels(shapes, conns, shapesMap, out);
  const overrides = (art.overrides && typeof art.overrides === 'object') ? art.overrides : {};
  const baseProfile = art.baseProfile || null;

  const resolve = (id, index, detected, facts) => {
    const ov = overrides[id] === 'done' || overrides[id] === 'reopened' ? overrides[id] : null;
    const state = ov === 'done' ? 'done' : ov === 'reopened' ? 'todo' : (detected ? 'done' : 'todo');
    return { id, index, detected: !!detected, override: ov, state, facts };
  };

  // ── E1 Conhecer a base: base carregada + AS IS configurado (+ sinal forte: perfil EB) ─
  const csvs = Object.values(csvStore || {});
  const baseLoaded = art.baseLoaded != null
    ? !!art.baseLoaded
    : csvs.some(c => (c?.rowCount > 0) || (Array.isArray(c?.rows) && c.rows.length > 0) || (Array.isArray(c?.headers) && c.headers.length > 0));
  const asIsConfigured = art.hasAsIs != null ? !!art.hasAsIs : csvs.some(c => !!c?.asIsConfig);
  const hasProfile = !!(baseProfile && !baseProfile.error);
  const e1 = resolve('know_base', 0, baseLoaded && asIsConfigured, { baseLoaded, asIsConfigured, hasProfile });

  // ── E2 Elegibilidade: caminho raiz→terminal Reprovado com ≤ 2 nós (knock-out) ─────────
  let minKnockout = null;
  let knockoutNodeId = null;
  for (const s of (shapes || [])) {
    if (!DECISION_LIKE.has(s.type)) continue;
    const lvl = levels[s.id];
    if (lvl == null) continue;
    for (const t of targetsOf(s.id, shapesMap, out)) {
      if (shapesMap[t]?.type === 'rejected' && (minKnockout == null || lvl < minKnockout)) {
        minKnockout = lvl; knockoutNodeId = s.id;
      }
    }
  }
  const e2Detected = minKnockout != null && minKnockout <= 2;
  const e2 = resolve('eligibility', 1, e2Detected, { knockoutFound: e2Detected, minNodes: minKnockout, nodeId: knockoutNodeId });

  // ── E3 Segmentação: variável categórica/cluster em nível ≤ 2 com ≥2 subárvores distintas ─
  // Detector honesto (DEC-EP-002): guarda o MELHOR candidato visto (maior nº de subárvores)
  // mesmo abaixo do limiar, para o `facts` declarar "achei uma variável de segmentação, mas
  // só com N ramos" — não só um vazio quando falha.
  let segNode = null, segBest = null;
  for (const s of (shapes || [])) {
    if (!DECISION_LIKE.has(s.type)) continue;
    const lvl = levels[s.id];
    if (lvl == null || lvl > 2) continue;
    if (!nodeHasSegmentationVar(s, csvStore, baseProfile)) continue;
    const subtreeCount = new Set(targetsOf(s.id, shapesMap, out).filter(t => DECISION_LIKE.has(shapesMap[t]?.type))).size;
    if (!segBest || subtreeCount > segBest.subtreeCount) segBest = { id: s.id, level: lvl, subtreeCount };
    if (subtreeCount >= 2) { segNode = { id: s.id, level: lvl, subtreeCount }; break; }
  }
  const segChosen = segNode || segBest;
  const e3 = resolve('segmentation', 2, !!segNode, {
    segmented: !!segNode, nodeId: segChosen?.id ?? null,
    level: segChosen?.level ?? null, subtreeCount: segChosen?.subtreeCount ?? 0,
  });

  // ── E4 Risco e cortes: variável ordinal/faixas/score com portas a terminais distintos ──
  let riskNode = null, riskBest = null;
  for (const s of (shapes || [])) {
    if (!DECISION_LIKE.has(s.type)) continue;
    if (!nodeHasRiskVar(s, csvStore, baseProfile)) continue;
    const terminalCount = new Set(targetsOf(s.id, shapesMap, out).map(t => shapesMap[t]?.type).filter(ty => TERMINALS.has(ty))).size;
    if (!riskBest || terminalCount > riskBest.terminalCount) riskBest = { id: s.id, terminalCount };
    if (terminalCount >= 2) { riskNode = { id: s.id, terminalCount }; break; }
  }
  const riskChosen = riskNode || riskBest;
  const e4 = resolve('risk', 3, !!riskNode, {
    routed: !!riskNode, nodeId: riskChosen?.id ?? null, terminalCount: riskChosen?.terminalCount ?? 0,
  });

  // ── E5 Calibração: Goal Seek/otimizador aplicado OU delta vs AS IS dentro da meta ──────
  const calibrationApplied = !!art.calibrationApplied;
  const goalMet = !!art.goalMet;
  const e5 = resolve('calibration', 4, calibrationApplied || goalMet, { calibrationApplied, goalMet });

  // ── E6 Validação: checklist de prontidão 100% nos critérios ATIVOS (não-'na') ──────────
  const readiness = computeReadiness(shapes, conns, csvStore, art, art.readinessConfig || {});
  const active = readiness.criteria.filter(c => c.state !== 'na');
  const passCount = active.filter(c => c.state === 'pass').length;
  const allActivePass = active.length > 0 && passCount === active.length;
  const e6 = resolve('validation', 5, allActivePass, {
    ready: allActivePass, activeCount: active.length, passCount,
    failing: active.filter(c => c.state === 'fail').map(c => c.id),
  });

  return [e1, e2, e3, e4, e5, e6];
}

// ═══ computeReadiness — Checklist de Prontidão (DEC-EP-003) ═══
// Retorna { criteria: [{ id, state:'pass'|'fail'|'na', facts, fixCommandId }] } na ordem de
// READINESS_CRITERIA_IDS. `config[id] === false` desativa o critério ⇒ 'na' (não conta para
// E6). Alguns critérios também degradam para 'na' quando o insumo não se aplica (ex.:
// stable_vars sem Perfil da Base) — `facts.reason` declara o motivo. `fixCommandId` é o id do
// comando (registro UX 2.0, resolvido na EP2) que resolve o critério.
export function computeReadiness(shapes, conns, csvStore, artifacts = {}, config = {}) {
  const art = artifacts || {};
  const cfg = config || {};
  const enabled = (id) => cfg[id] !== false;
  const criteria = [];
  const push = (id, fixCommandId, compute) => {
    if (!enabled(id)) { criteria.push({ id, state: 'na', facts: { reason: 'disabled' }, fixCommandId }); return; }
    const { state, facts } = compute();
    criteria.push({ id, state, facts, fixCommandId });
  };

  // 1 · lint sem bloqueantes — nenhum achado severity 'error' de computePolicyInsights.
  push('lint_no_blockers', 'copilot.reviewBlockers', () => {
    const lint = Array.isArray(art.lint) ? art.lint : [];
    const blockers = lint.filter(f => f && f.severity === 'error');
    return {
      state: blockers.length === 0 ? 'pass' : 'fail',
      facts: { blockerCount: blockers.length, codes: blockers.map(f => f.code ?? null), nodeIds: blockers.map(f => f.nodeId ?? null) },
    };
  });

  // 2 · 100% da população decidida — funil (decidedQty ≥ totalQty). Sem população ⇒ 'na'.
  push('full_coverage', 'copilot.reviewCoverage', () => {
    const cov = art.coverage;
    if (!cov || !(cov.totalQty > 0)) return { state: 'na', facts: { reason: 'no_population' } };
    const decided = typeof cov.decidedQty === 'number' ? cov.decidedQty : 0;
    const undecided = cov.totalQty - decided;
    return {
      state: decided >= cov.totalQty - COVERAGE_EPS ? 'pass' : 'fail',
      facts: { totalQty: cov.totalQty, decidedQty: decided, undecidedQty: Math.max(0, undecided), coveragePct: (decided / cov.totalQty) * 100 },
    };
  });

  // 3 · nenhuma variável pendente — rastro de mapeamento de biblioteca (losango c/ label sem
  //     variableCol) + pendências declaradas em artifacts (mesma heurística do feed NB).
  push('no_pending_vars', 'copilot.mapPendingVar', () => {
    const names = new Set();
    for (const pv of (Array.isArray(art.pendingVars) ? art.pendingVars : [])) {
      const n = typeof pv === 'string' ? pv : (pv?.name ?? pv?.col ?? null);
      if (n) names.add(n);
    }
    for (const s of (shapes || [])) {
      if (s.type === 'decision' && !s.variableCol && s.label) names.add(s.label);
    }
    const list = [...names];
    return { state: list.length === 0 ? 'pass' : 'fail', facts: { pendingCount: list.length, names: list } };
  });

  // 4 · AS IS configurado E delta simulado — baseline de comparação existe e a sim rodou.
  push('asis_delta', 'copilot.configureAsIs', () => {
    const csvs = Object.values(csvStore || {});
    const asIsConfigured = art.hasAsIs != null ? !!art.hasAsIs : csvs.some(c => !!c?.asIsConfig);
    const deltaSimulated = asIsConfigured && art.coverage != null;
    return { state: (asIsConfigured && deltaSimulated) ? 'pass' : 'fail', facts: { asIsConfigured, deltaSimulated } };
  });

  // 5 · documentação gerada e atual — diffPolicyIR vazio desde a geração (por construção:
  //     fingerprint da última doc == fingerprint do IR atual). Nunca gerada ⇒ fail.
  push('doc_current', 'copilot.generateDoc', () => {
    const cur = policyIRFingerprint(art.ir);
    const docFp = art.docFingerprint ?? null;
    const generated = docFp != null;
    const current = generated && docFp === cur;
    return { state: current ? 'pass' : 'fail', facts: { generated, current, docFingerprint: docFp, currentFingerprint: cur } };
  });

  // 6 · sem candidato de simplificação LOSSLESS pendente — proposta com prova de identidade.
  //     Candidato lossy (identical=false) não reprova este critério.
  push('no_lossless_simplify', 'copilot.applySimplify', () => {
    const sp = art.simplify;
    const candidates = sp?.proposal?.candidates;
    const identical = sp?.equivalence?.identical === true;
    const pending = Array.isArray(candidates) && candidates.length > 0 && identical;
    return { state: pending ? 'fail' : 'pass', facts: { candidateCount: Array.isArray(candidates) ? candidates.length : 0, identical: !!identical } };
  });

  // 7 · variáveis usadas sem flag `unstable_psi` — só quando o Perfil da Base existir; senão 'na'.
  push('stable_vars', 'copilot.exploreBase', () => {
    const bp = art.baseProfile;
    if (!bp || bp.error || !Array.isArray(bp.variables)) return { state: 'na', facts: { reason: 'no_profile' } };
    const byCol = {};
    for (const v of bp.variables) byCol[v.col] = v;
    const used = collectUsedCols(shapes);
    const unstable = [];
    for (const col of used) {
      const v = byCol[col];
      if (v && Array.isArray(v.flags) && v.flags.includes('unstable_psi')) unstable.push(col);
    }
    return { state: unstable.length === 0 ? 'pass' : 'fail', facts: { checkedCount: used.length, unstableVars: unstable } };
  });

  return { criteria };
}
