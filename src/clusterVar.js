// ── Variável de Cluster — interpretação da Clusterização de Segmentos (H8) ───────
//
// A Clusterização (COMPUTE_CLUSTER_SEGMENTS) é uma ANÁLISE efêmera: agrupa segmentos
// parecidos por comportamento e devolve um ClusterModel. Este módulo transforma esse
// resultado numa VARIÁVEL de fluxo reutilizável — uma coluna Filtro derivada (dict) na
// base, cujos valores são os clusters — para o usuário arrastar ao canvas e seguir com
// aberturas/políticas.
//
// A "regra" de cada cluster é uma lista de valores por dimensão (bounding box do que o
// k-means agrupou), avaliada first-match-wins (ver deriveClusterColumn em columnar.js):
// exato para 1 dimensão, aproximação editável por faixas para 2+ (mesma técnica do
// "Ver no Dashboard"). O k-means é o PONTO DE PARTIDA; o usuário cura os grupos depois
// (renomear, mover um público de um cluster para outro) — padrão proposta→refino do app.
//
// Módulo PURO (sem React/DOM/worker): a materialização vive em columnar.js
// (deriveClusterColumn); aqui ficam as sugestões de nome, o builder de definição a
// partir do ClusterModel, a descrição das regras (docs) e as operações de edição.
// Compartilhado main/worker/teste, como src/goalSeek.js / src/policySimplify.js.

// Def de uma variável de cluster (guardada em csvStore[csvId].clusterDefs[col]):
// {
//   id, col, csvId, source:'cluster',
//   dims: [dimCol...],
//   groups: [{ id, label, members: {[dimCol]: [valTrimado...]} }],   // ordem first-match
//   unmatchedLabel,
//   meta: { k, seed, features, explainedVariance, silhouette, method, generatedAt },
//   createdAt,
// }

// Torna um nome único contra uma lista de existentes (append " 2", " 3", …).
export function uniqueName(base, existing) {
  const taken = new Set((existing || []).map(s => (s ?? '').toString()));
  const b = (base ?? '').toString().trim() || 'Cluster';
  if (!taken.has(b)) return b;
  let i = 2;
  while (taken.has(`${b} ${i}`)) i++;
  return `${b} ${i}`;
}

// Nome sugerido para a VARIÁVEL (coluna) — baseado nas dimensões usadas, único vs.
// headers existentes da base.
export function suggestClusterVarName(model, existingHeaders) {
  const dims = model?.params?.dims || [];
  const base = dims.length === 1 ? `Cluster de ${dims[0]}` : 'Cluster de comportamento';
  return uniqueName(base, existingHeaders);
}

// Tier de aprovação / risco em PT-BR — só para compor o rótulo sugerido (o usuário
// edita). Thresholds fixos e legíveis; null vira 'sem dados'.
function approvalTier(rate) {
  if (rate == null) return null;
  if (rate >= 0.66) return 'alta aprovação';
  if (rate >= 0.33) return 'média aprovação';
  return 'baixa aprovação';
}
function riskTier(rate) {
  if (rate == null) return null;
  if (rate >= 0.5) return 'alto risco';
  if (rate >= 0.3) return 'médio risco';
  return 'baixo risco';
}

// Rótulos sugeridos para TODOS os clusters de um modelo, garantidamente ÚNICOS entre si
// (sufixa o número do cluster em colisão). Baseados em aprovação AS IS + inadimplência
// inferida (fallback real). Ordem = a dos clusters do modelo (volume desc).
export function suggestClusterLabels(model) {
  const clusters = model?.clusters || [];
  const base = clusters.map((c, i) => {
    const parts = [approvalTier(c.approvalRate), riskTier(c.inadInferida ?? c.inadReal)].filter(Boolean);
    return parts.length ? parts.join(', ') : `Cluster ${String(c.id).slice(1) || i + 1}`;
  });
  // Dedup preservando ordem: colisão → anexa "(cN)".
  const seen = new Map();
  for (const b of base) seen.set(b, (seen.get(b) || 0) + 1);
  const used = new Set();
  return clusters.map((c, i) => {
    let label = base[i];
    if (seen.get(label) > 1 || used.has(label)) label = `${base[i]} (${c.id})`;
    let final = label, k = 2;
    while (used.has(final)) final = `${label} ${k++}`;
    used.add(final);
    return final;
  });
}

// Monta a DEFINIÇÃO da variável a partir do ClusterModel + os rótulos escolhidos.
// members[dim] = os valores (trimados) daquele cluster naquela dimensão (do
// cluster.dims[d].values) — a bounding box que deriveClusterColumn avalia.
export function buildClusterDefFromModel(model, { col, csvId, labels, unmatchedLabel, genId }) {
  const dims = model?.params?.dims || [];
  const clusters = model?.clusters || [];
  const mkId = genId || (() => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const groups = clusters.map((c, i) => ({
    id: mkId(),
    label: labels[i],
    clusterId: c.id, // proveniência (só informativo)
    members: Object.fromEntries((c.dims || []).map(dm => [dm.col, (dm.values || []).map(v => v.value)])),
  }));
  return {
    id: mkId(),
    col, csvId, source: 'cluster',
    dims: [...dims],
    groups,
    unmatchedLabel: unmatchedLabel != null ? unmatchedLabel : 'Fora dos clusters',
    meta: {
      k: model?.params?.k ?? null,
      seed: model?.params?.seed ?? null,
      features: model?.params?.features || (model?.features || []).map(f => f.id),
      explainedVariance: model?.quality?.explainedVariance ?? null,
      silhouette: model?.quality?.silhouette ?? null,
      method: model?.quality?.method ?? model?.params?.method ?? 'kmeans',
      generatedAt: model?.generatedAt ?? null,
    },
    createdAt: new Date().toISOString(),
  };
}

// True se `col` da base `csvId` é uma variável de cluster (tem definição registrada).
export function isClusterVar(csvStore, csvId, col) {
  return !!(csvStore && csvStore[csvId] && csvStore[csvId].clusterDefs && csvStore[csvId].clusterDefs[col]);
}

// Descrição das regras dos clusters (para a Documentação Automática). Estrutura CRUA
// (dados, nunca prosa — padrão docModel): por grupo, os valores por dimensão. Com
// `includeDomains=false` (Contrato de Privacidade N2) omite os valores concretos,
// mantendo só as contagens.
export function describeClusterRules(def, includeDomains = true) {
  if (!def) return null;
  return {
    col: def.col,
    dims: def.dims || [],
    unmatchedLabel: def.unmatchedLabel,
    method: def?.meta?.method ?? null,
    groups: (def.groups || []).map(g => ({
      label: g.label,
      dims: (def.dims || []).map(dc => {
        const vals = (g.members && g.members[dc]) || [];
        return { col: dc, valueCount: vals.length, values: includeDomains ? vals : null };
      }),
    })),
  };
}

// ── Operações de edição PURAS (o modal edita um rascunho e chama estas) ──────────

// Renomeia um cluster (por id) — só troca o `label`. Retorna nova def.
export function renameClusterGroup(def, groupId, newLabel) {
  return {
    ...def,
    groups: (def.groups || []).map(g => g.id === groupId ? { ...g, label: newLabel } : g),
  };
}

// Move um VALOR de uma dimensão de um cluster para outro (remove de todos os grupos
// naquela dimensão e adiciona ao destino) — a operação "tirar um público de um grupo e
// levar para outro". targetGroupId = null ⇒ remove de todos (vai para "fora dos
// clusters"). Idempotente. Retorna nova def.
export function moveValueToGroup(def, dim, value, targetGroupId) {
  const v = (value ?? '').toString();
  return {
    ...def,
    groups: (def.groups || []).map(g => {
      const cur = (g.members && g.members[dim]) || [];
      const without = cur.filter(x => (x ?? '').toString() !== v);
      const next = g.id === targetGroupId ? [...without, v] : without;
      return { ...g, members: { ...(g.members || {}), [dim]: next } };
    }),
  };
}

// Alterna a presença de um VALOR na lista de uma dimensão de um cluster (checkbox da
// matriz de edição). Mantém a sobreposição possível entre clusters (bounding box) —
// diferente de moveValueToGroup, que dá posse exclusiva. Retorna nova def.
export function toggleValueInGroup(def, dim, value, groupId) {
  const v = (value ?? '').toString();
  return {
    ...def,
    groups: (def.groups || []).map(g => {
      if (g.id !== groupId) return g;
      const cur = (g.members && g.members[dim]) || [];
      const has = cur.some(x => (x ?? '').toString() === v);
      const next = has ? cur.filter(x => (x ?? '').toString() !== v) : [...cur, v];
      return { ...g, members: { ...(g.members || {}), [dim]: next } };
    }),
  };
}

// Atualiza referências ao NOME da coluna (rename da variável pelo painel/edição) em
// shapes/conns: losango (variableCol + label quando o label era o nome da coluna),
// Cineminha (rowVar/colVar.col) e regra de Decision Lens (rules[].col). Puro; conns
// inalterado. Chamado por canvas (todas as abas) + working copy ativa.
export function renameClusterColumnRefs(shapes, conns, csvId, oldCol, newCol) {
  const outShapes = (shapes || []).map(s => {
    if (s.type === 'decision' && s.csvId === csvId && s.variableCol === oldCol) {
      return { ...s, variableCol: newCol, label: s.label === oldCol ? newCol : s.label };
    }
    if (s.type === 'cineminha') {
      let r = s.rowVar, c = s.colVar, changed = false;
      if (r && r.csvId === csvId && r.col === oldCol) { r = { ...r, col: newCol }; changed = true; }
      if (c && c.csvId === csvId && c.col === oldCol) { c = { ...c, col: newCol }; changed = true; }
      return changed ? { ...s, rowVar: r, colVar: c } : s;
    }
    if (s.type === 'decision_lens' && Array.isArray(s.rules)) {
      let changed = false;
      const rules = s.rules.map(rl => (rl.col === oldCol ? (changed = true, { ...rl, col: newCol }) : rl));
      return changed ? { ...s, rules } : s;
    }
    return s;
  });
  return { shapes: outShapes, conns: conns || [] };
}

// Atualiza rótulos de cluster renomeados em shapes/conns: portas + arestas de losangos
// que usam a coluna, e domínio/células de Cineminhas com a coluna num eixo. labelMap =
// {[rótuloAntigo]: rótuloNovo}. Puro. As mudanças de MEMBRESIA (mover públicos) não
// precisam disso — refletem sozinhas na re-materialização/re-roteamento; só a
// renomeação de rótulo precisa acompanhar as portas/domínios já materializados.
export function renameClusterLabelRefs(shapes, conns, csvId, col, labelMap) {
  const map = labelMap || {};
  const has = (v) => Object.prototype.hasOwnProperty.call(map, v);
  const remap = (v) => (has(v) ? map[v] : v);
  const decisionIds = new Set(
    (shapes || []).filter(s => s.type === 'decision' && s.csvId === csvId && s.variableCol === col).map(s => s.id)
  );
  const portIds = new Set();
  for (const cn of (conns || [])) if (decisionIds.has(cn.from) && has(cn.label)) portIds.add(cn.to);
  const remapCells = (cells, axis) => {
    const out = {};
    for (const [k, val] of Object.entries(cells || {})) {
      const bar = k.indexOf('|');
      const rp = bar >= 0 ? k.slice(0, bar) : k;
      const cp = bar >= 0 ? k.slice(bar + 1) : '';
      out[axis === 'row' ? `${remap(rp)}|${cp}` : `${rp}|${remap(cp)}`] = val;
    }
    return out;
  };
  const outShapes = (shapes || []).map(s => {
    if (s.type === 'port' && portIds.has(s.id)) return { ...s, label: remap(s.label) };
    if (s.type === 'cineminha') {
      let ns = s, changed = false;
      if (s.rowVar && s.rowVar.csvId === csvId && s.rowVar.col === col) {
        ns = { ...ns, rowDomain: (ns.rowDomain || []).map(remap), cells: remapCells(ns.cells, 'row') }; changed = true;
      }
      if (s.colVar && s.colVar.csvId === csvId && s.colVar.col === col) {
        ns = { ...ns, colDomain: (ns.colDomain || []).map(remap), cells: remapCells(ns.cells, 'col') }; changed = true;
      }
      return changed ? ns : s;
    }
    return s;
  });
  const outConns = (conns || []).map(cn =>
    (decisionIds.has(cn.from) && has(cn.label)) ? { ...cn, label: remap(cn.label) } : cn);
  return { shapes: outShapes, conns: outConns };
}

// Para a UI de edição: para cada dimensão, o conjunto de valores distintos (a união das
// listas dos grupos) e, por valor, a quais grupos pertence hoje. baseValues (opcional,
// da base via distinctColValues) garante que valores não atribuídos apareçam.
export function clusterMembershipTable(def, baseValuesByDim = {}) {
  const dims = def?.dims || [];
  return dims.map(dc => {
    const seen = new Map(); // value -> Set(groupId)
    const order = [];
    const push = (v) => { if (!seen.has(v)) { seen.set(v, new Set()); order.push(v); } };
    for (const v of (baseValuesByDim[dc] || [])) push((v ?? '').toString());
    for (const g of (def.groups || [])) {
      for (const v of ((g.members && g.members[dc]) || [])) {
        const s = (v ?? '').toString(); push(s); seen.get(s).add(g.id);
      }
    }
    return { col: dc, values: order.map(v => ({ value: v, groupIds: [...seen.get(v)] })) };
  });
}
