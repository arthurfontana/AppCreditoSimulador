// src/explore.js — layout default da aba Explorar (Explorar a Base, Épico EB, EB2).
// docs/wiki/Epicos-ExplorarBase.md (DEC-EB-005/006). Módulo FOLHA e PURO — não importa
// App.jsx/worker: só monta a lista de widgets (WidgetConfig[]) do chassi a partir do
// BaseProfileModel já computado. Determinístico (mesmo profile ⇒ mesmo layout, ids
// derivados do nome da coluna, nunca `uid()`/`Math.random`).
//
// Seções (DEC-EB-006, ordem fixa — codifica a ordem das perguntas do analista sênior):
// (1) Retrato AS IS · (2) Ranking de variáveis · (3) Perfis das top-N variáveis ·
// (4) Qualidade dos dados · (5) Estabilidade temporal · (6) Avisos/leituras. Cada seção
// abre com um card `insight` (leitura mínima — src/exploreInsights.js, EB2 stub).
// Todo widget nasce com `origin:'auto'` (DEC-EB-005): "↻ Regenerar análise" (App.jsx)
// substitui só esses, preservando os promovidos a `origin:'user'` por edição.

export const EXPLORE_TOP_N_VARS = 5; // teto declarado de variáveis com perfil próprio
const FIRST_BRANCH_OFFSET_X = 220; // distância do losango solto à direita da bounding box
const FIRST_BRANCH_OFFSET_Y = 80;  // distância do losango solto acima do topo da bounding box

const W_FULL = 1100;
const GAP = 20;
const HEIGHTS = { insight: 130, ivrank: 460, varprofile: 360, quality: 380, stability: 440 };

// Slug determinístico do nome da coluna, para ids de widget estáveis entre chamadas
// (colisão improvável — colunas de uma mesma base têm nomes distintos).
function colSlug(col) {
  const s = String(col ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "col";
}

// Monta o layout default (widgets reais do chassi, DEC-EB-005) a partir do
// BaseProfileModel. Base sem perfil válido (`profile.error`) ⇒ layout vazio (nada
// inventado). Puro/testável — só lê `profile`, nunca `Date.now()`/aleatoriedade.
export function buildDefaultExploreLayout(profile) {
  if (!profile || profile.error) return [];
  const widgets = [];
  let y = 24;
  const push = (type, id, config, h) => {
    widgets.push({ id, type, origin: "auto", x: 24, y, w: W_FULL, h: h ?? HEIGHTS[type], config });
    y += (h ?? HEIGHTS[type]) + GAP;
  };

  // (1) Retrato da operação AS IS
  push("insight", "auto_insight_asis", { title: "Retrato da Operação (AS IS)", preset: "asis" });

  // (2) Ranking de variáveis
  push("insight", "auto_insight_ranking", { title: "Como ler o ranking", preset: "ranking" });
  const nVars = (profile.variables || []).length;
  push("ivrank", "auto_ivrank", { title: "Ranking de Variáveis por IV" }, Math.min(760, Math.max(HEIGHTS.ivrank, 90 + nVars * 32)));

  // (3) Perfis das top-N variáveis mais discriminantes (ordem do ranking — já vem em
  // profile.variables, DEC-EB-008: computeVariableRanking ordena por IV desc).
  push("insight", "auto_insight_varprofile", { title: "Perfis das variáveis mais discriminantes", preset: "varprofile" });
  const top = (profile.variables || []).slice(0, EXPLORE_TOP_N_VARS);
  for (const v of top) {
    push("varprofile", `auto_varprofile_${colSlug(v.col)}`, { title: v.col, col: v.col });
  }

  // (4) Qualidade dos dados
  push("insight", "auto_insight_quality", { title: "Qualidade dos dados", preset: "quality" });
  push("quality", "auto_quality", { title: "Qualidade dos Dados" });

  // (5) Estabilidade temporal
  push("insight", "auto_insight_stability", { title: "Estabilidade temporal", preset: "stability" });
  push("stability", "auto_stability", { title: "Estabilidade Temporal" });

  // (6) Avisos/leituras (lista completa dos insights[] do modelo)
  push("insight", "auto_insight_warnings", { title: "Avisos e leituras", preset: "warnings" });

  return widgets;
}

// Posição do novo losango para "➕ Usar como 1º galho" (DEC-EB-010, EB4). Puro/testável —
// canvas ativo vazio ⇒ centro do viewport atual (mesmo cálculo do nó de csv recém-importado
// em App.jsx); canvas não-vazio ⇒ ao lado da bounding box dos shapes existentes, nunca
// sobrepondo (nó SOLTO). Em ambos os ramos o chamador (App.jsx) cria o nó via
// `createDecisionNode(col, csvId, wx, wy)` — nenhum caminho novo de materialização
// (DEC-IA-002); só a posição muda.
export function computeFirstBranchPosition(shapes, viewport, svgSize) {
  const list = Array.isArray(shapes) ? shapes : [];
  if (list.length === 0) {
    const vp = viewport || { x: 0, y: 0, s: 1 };
    const size = svgSize || { width: 800, height: 600 };
    const s = vp.s || 1;
    return { wx: (size.width / 2 - vp.x) / s, wy: (size.height / 2 - vp.y) / s, empty: true };
  }
  const maxX = list.reduce((acc, sh) => Math.max(acc, (sh.x ?? 0) + (sh.w ?? 0)), -Infinity);
  const minY = list.reduce((acc, sh) => Math.min(acc, sh.y ?? 0), Infinity);
  return { wx: maxX + FIRST_BRANCH_OFFSET_X, wy: minY + FIRST_BRANCH_OFFSET_Y, empty: false };
}
