// ── PolicyIR — representação canônica da política (Copiloto Sessão 0, DEC-IA-002) ──
// O "JSON canônico da política" é a lingua franca do épico do Copiloto
// (docs/wiki/Epicos-CopilotoIA.md): templates, sugestões, Goal Seek, documentação e
// trocas com a IA leem/escrevem PolicyIR. `shapes`/`conns` seguem sendo a fonte de
// verdade do canvas; o IR é DERIVADO (buildPolicyIR) e patches de IR são materializados
// de volta em shapes/conns por um ÚNICO aplicador (applyPolicyPatch). Regras do IR:
//   - derivável de shapes/conns SEM PERDA DE ROTEAMENTO — GATE tests/policyIR.test.js:
//     simular o canvas materializado do IR ≡ motor compilado (M8) sobre o canvas
//     original, decisão por linha idêntica;
//   - serializável/versionável (JSON puro — sem Map, typed array ou função);
//   - livre de dados linha a linha e de posições x/y (layout não é política).
// O achatamento de rotas resolve cadeias de ports (decision→port→destino vira
// {values, to: destino}) — assume o idioma padrão do canvas em que losango/cineminha
// roteiam via ports (createDecisionNode/createCinemaNode); uma aresta rotulada de
// losango DIRETO para outro nó de fluxo (sem port) é materializada de volta COM port,
// o que preserva o caminho da linha mas pode alterar qual nó o motor elege como raiz
// (critério: "sem aresta de entrada vinda de port") — fora do idioma padrão, não
// ocorre nos fluxos construídos pela UI. Valores numéricos de casela (grades de
// oferta, setCinemaCellValue) não entram no IR: para o roteamento só importa
// elegível/não elegível (isCellEligible), capturado em `blockedCells`.
//
// Extraído de src/App.jsx (Sessão C4, docs/wiki/Contexto-Claude.md) — movimentação
// literal, sem mudança de lógica. App.jsx importa e re-exporta estes helpers; os testes
// (tests/policyIR.test.js, tests/policyTemplates.test.js) seguem importando de App.jsx.
import { isColumnar, distinctColValues } from './columnar.js';
import {
  uid, SW, SH, CINEMINHA_TYPES, getCinemaType,
  LENS_W, LENS_H, computeCinemaSize, isCellEligible,
} from './App.jsx';

export const POLICY_TERMINAL_LABELS = { approved: 'Aprovado', rejected: 'Reprovado', as_is: 'AS IS' };

// ═══ REGIÃO: PolicyIR ═══
export function buildPolicyIR(shapes, conns, csvStore, opts = {}) {
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const out = {};
  for (const s of shapes) out[s.id] = [];
  for (const c of conns) { if (out[c.from]) out[c.from].push(c); }

  // Segue cadeias de ports "puros" (primeira aresta de saída, como traverseRow) até
  // um nó não-port. Port sem saída, destino inexistente ou ciclo só de ports → null
  // (a linha morre no plumbing — mesma semântica do walk do motor).
  const resolveThroughPorts = (id) => {
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
  };

  // Agrupa pares {value, to} por destino, preservando a ordem de primeira aparição
  // do destino e a ordem dos valores — determinístico (round-trip estável).
  const groupRoutes = (pairs) => {
    const groups = [];
    const byTo = new Map();
    for (const p of pairs) {
      let g = byTo.get(p.to);
      if (!g) { g = { values: [], to: p.to }; byTo.set(p.to, g); groups.push(g); }
      g.values.push(p.value);
    }
    return groups;
  };

  const nodes = [];
  for (const s of shapes) {
    if (s.type === 'decision') {
      // Mesma semântica do motor: rótulo TRIMADO, first-wins em rótulo duplicado.
      const seen = new Set();
      const pairs = [];
      for (const e of out[s.id]) {
        const value = (e.label ?? '').trim();
        if (seen.has(value)) continue;
        seen.add(value);
        pairs.push({ value, to: resolveThroughPorts(e.to) });
      }
      nodes.push({
        id: s.id, kind: 'decision',
        label: s.label || s.variableCol || 'Decisão',
        variable: { col: s.variableCol ?? null, csvId: s.csvId ?? null },
        routes: groupRoutes(pairs),
      });
    } else if (s.type === 'cineminha') {
      const cinemaType = CINEMINHA_TYPES[s.cinemaType] ? s.cinemaType : 'eligibility';
      const cfg = getCinemaType(cinemaType);
      // Mesma semântica do motor: match EXATO do rótulo do port de saída.
      const routeFor = (portLabel) => {
        const e = out[s.id].find(x => x.label === portLabel);
        return e ? resolveThroughPorts(e.to) : null;
      };
      const blockedCells = Object.keys(s.cells || {})
        .filter(k => !isCellEligible(s.cells, k))
        .sort();
      nodes.push({
        id: s.id, kind: 'cinema',
        label: s.label || 'Cineminha',
        cinemaType,
        rowVar: s.rowVar ? { col: s.rowVar.col, csvId: s.rowVar.csvId } : null,
        colVar: s.colVar ? { col: s.colVar.col, csvId: s.colVar.csvId } : null,
        rowDomain: [...(s.rowDomain || [])],
        colDomain: [...(s.colDomain || [])],
        blockedCells,
        routes: { eligible: routeFor(cfg.ports[0].label), notEligible: routeFor(cfg.ports[1].label) },
      });
    } else if (s.type === 'decision_lens') {
      nodes.push({
        id: s.id, kind: 'lens',
        label: s.label || 'Decision Lens',
        rules: (s.rules || []).map(r => ({
          col: r.col, operator: r.operator, value: r.value ?? '', logic: r.logic ?? null,
        })),
        to: resolveThroughPorts(out[s.id][0] ? out[s.id][0].to : null),
      });
    } else if (s.type in POLICY_TERMINAL_LABELS) {
      nodes.push({
        id: s.id, kind: 'terminal',
        label: s.label || POLICY_TERMINAL_LABELS[s.type],
        terminal: s.type,
      });
    }
  }

  // Raízes do fluxo — MESMO critério do motor de simulação (runSimulation /
  // computeSimulationTick): nó de fluxo sem aresta de entrada vinda de um port.
  const portIds = new Set(shapes.filter(s => s.type === 'port').map(s => s.id));
  const hasPortIn = new Set(conns.filter(c => portIds.has(c.from)).map(c => c.to));
  const entry = shapes
    .filter(s => (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') && !hasPortIn.has(s.id))
    .map(s => s.id);

  // Metadados dos datasets — SEM dados (Contrato de Privacidade N0: nomes de coluna,
  // tipos e tamanho do domínio; nunca linhas, dicionários ou valores de métrica).
  const datasets = Object.entries(csvStore || {}).map(([csvId, csv]) => ({
    csvId,
    name: csv.name ?? null,
    columns: (csv.headers || []).map((h, idx) => {
      let domainSize = null;
      if (isColumnar(csv)) {
        const col = csv.columns[h];
        if (col && col.kind === 'dict') {
          let n = 0;
          for (const v of col.dict) if (v !== '' && v != null) n++;
          domainSize = n;
        }
        // coluna num (métrica) → null, sem varrer 1MM de linhas só p/ metadado
      } else {
        domainSize = distinctColValues(csv, idx).length;
      }
      return {
        name: h,
        colType: csv.columnTypes?.[h] ?? null,
        varType: csv.varTypes?.[h] ?? null,
        domainSize,
      };
    }),
  }));

  return {
    kind: 'policy-ir',
    version: '1.0',
    name: opts.name ?? null,
    generatedAt: new Date().toISOString(),
    datasets,
    nodes,
    entry,
  };
}

// Materializa um patch de PolicyIR (IR completo ou parcial: `{nodes: [...]}`) em
// shapes/conns — o ÚNICO aplicador previsto pela DEC-IA-002. Não muta `base`;
// retorna `{shapes, conns, idMap}` com os nós do patch ANEXADOS ao canvas base.
//   - IDs novos via contador `_id` existente (uid()) — `idMap` traduz id do IR → id
//     do shape criado (rotas internas do patch são re-apontadas por ele);
//   - uma rota cujo `to` não está no patch é resolvida contra `base.shapes` (permite
//     patch que conecta a nós já existentes no canvas); destino desconhecido → rota
//     pendurada (port sem saída), mesma semântica de "linha não roteia";
//   - posições são um layout simples em camadas (longest-path sobre as rotas do
//     patch) — só para o canvas nascer legível; o usuário pode usar ⊹ Reorganizar.
export function applyPolicyPatch(patch, base = {}) {
  const baseShapes = base.shapes || [];
  const baseConns = base.conns || [];
  const nodes = Array.isArray(patch?.nodes) ? patch.nodes.filter(n => n && n.id != null) : [];
  const idMap = {};
  for (const n of nodes) idMap[n.id] = uid();
  const baseIds = new Set(baseShapes.map(s => s.id));
  const ref = (to) => (to == null ? null : (idMap[to] ?? (baseIds.has(to) ? to : null)));

  const PORT_W = 100, PORT_H = 32, PORT_GAP_X = 96, PORT_GAP_Y = 10;
  const GAP_X = 120, GAP_Y = 48;

  const refsOf = (n) => {
    if (n.kind === 'decision') return (n.routes || []).map(r => r.to);
    if (n.kind === 'cinema') return [n.routes?.eligible, n.routes?.notEligible];
    if (n.kind === 'lens') return [n.to];
    return [];
  };
  const sizeOf = (n) => {
    if (n.kind === 'decision') return { w: SW, h: SH };
    if (n.kind === 'cinema') return computeCinemaSize(n.rowDomain || [], n.colDomain || []);
    if (n.kind === 'lens') return { w: LENS_W, h: LENS_H };
    return { w: 120, h: 44 }; // terminal
  };
  const portCountOf = (n) => {
    if (n.kind === 'decision') return (n.routes || []).reduce((acc, r) => acc + (r.values || []).length, 0);
    if (n.kind === 'cinema') return 2;
    return 0;
  };

  // Camadas por longest-path sobre as referências internas do patch (relaxamento
  // limitado — ciclos não explodem; profundidade capada em nodes.length).
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const depth = new Array(nodes.length).fill(0);
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false;
    for (let i = 0; i < nodes.length; i++) {
      for (const t of refsOf(nodes[i])) {
        const j = t != null ? index.get(t) : undefined;
        if (j !== undefined && j !== i && depth[j] < depth[i] + 1 && depth[i] + 1 <= nodes.length) {
          depth[j] = depth[i] + 1;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Posiciona à direita do que já existe no canvas base.
  let originX = 80;
  for (const s of baseShapes) originX = Math.max(originX, (s.x || 0) + (s.w || 0) + 160);
  const originY = 80;
  const maxDepth = nodes.length ? Math.max(...depth) : 0;
  const colX = []; // x de cada camada (largura da camada inclui a coluna de ports)
  {
    let x = originX;
    for (let d = 0; d <= maxDepth; d++) {
      colX[d] = x;
      let w = 0;
      for (let i = 0; i < nodes.length; i++) {
        if (depth[i] !== d) continue;
        const sz = sizeOf(nodes[i]);
        w = Math.max(w, sz.w + (portCountOf(nodes[i]) > 0 ? PORT_GAP_X + PORT_W : 0));
      }
      x += (w || 120) + GAP_X;
    }
  }
  const colY = new Array(maxDepth + 1).fill(originY);
  const pos = nodes.map((n, i) => {
    const sz = sizeOf(n);
    const nPorts = portCountOf(n);
    const portsH = nPorts > 0 ? nPorts * PORT_H + (nPorts - 1) * PORT_GAP_Y : 0;
    const y = colY[depth[i]];
    colY[depth[i]] += Math.max(sz.h, portsH) + GAP_Y;
    return { x: colX[depth[i]], y, ...sz };
  });

  const newShapes = [];
  const newConns = [];
  // Ports sempre à direita do nó dono, empilhados e centrados — mesmo idioma de
  // createDecisionNode/createCinemaNode.
  const addPort = (parent, label, color, slot, nSlots) => {
    const totalH = nSlots * PORT_H + (nSlots - 1) * PORT_GAP_Y;
    const p = {
      id: uid(), type: 'port',
      x: parent.x + parent.w + PORT_GAP_X,
      y: parent.y + parent.h / 2 - totalH / 2 + slot * (PORT_H + PORT_GAP_Y),
      w: PORT_W, h: PORT_H, label, color,
    };
    newShapes.push(p);
    newConns.push({ id: uid(), from: parent.id, to: p.id, label });
    return p;
  };

  nodes.forEach((n, i) => {
    const { x, y, w, h } = pos[i];
    const id = idMap[n.id];
    if (n.kind === 'decision') {
      const shape = {
        id, type: 'decision', x, y, w, h,
        label: n.label || n.variable?.col || 'Decisão',
        color: '#fef3c7',
        variableCol: n.variable?.col ?? null,
        csvId: n.variable?.csvId ?? null,
        visibleVals: null,
      };
      newShapes.push(shape);
      const nPorts = portCountOf(n);
      let slot = 0;
      for (const route of (n.routes || [])) {
        const to = ref(route.to);
        for (const value of (route.values || [])) {
          const port = addPort(shape, value, '#f0fdf4', slot++, nPorts);
          if (to != null) newConns.push({ id: uid(), from: port.id, to });
        }
      }
    } else if (n.kind === 'cinema') {
      const cinemaType = CINEMINHA_TYPES[n.cinemaType] ? n.cinemaType : 'eligibility';
      const cfg = getCinemaType(cinemaType);
      const cells = {};
      for (const k of (n.blockedCells || [])) cells[k] = false;
      const shape = {
        id, type: 'cineminha', x, y, w, h,
        label: n.label || 'Cineminha',
        color: '#fff', cinemaType,
        rowVar: n.rowVar ? { col: n.rowVar.col, csvId: n.rowVar.csvId } : null,
        colVar: n.colVar ? { col: n.colVar.col, csvId: n.colVar.csvId } : null,
        rowDomain: [...(n.rowDomain || [])],
        colDomain: [...(n.colDomain || [])],
        cells,
        resultVar: null, metadata: null,
        visibleRow: null, visibleCol: null,
        // Caselas vêm da política (patch), não da prévia AS IS — bloqueia o
        // pré-preenchimento assíncrono (ver Prévia AS IS no CLAUDE.md).
        cellsUserEdited: true,
      };
      newShapes.push(shape);
      [cfg.ports[0], cfg.ports[1]].forEach((portCfg, slot) => {
        const to = ref(slot === 0 ? n.routes?.eligible : n.routes?.notEligible);
        const port = addPort(shape, portCfg.label, portCfg.color, slot, 2);
        if (to != null) newConns.push({ id: uid(), from: port.id, to });
      });
    } else if (n.kind === 'lens') {
      newShapes.push({
        id, type: 'decision_lens', x, y, w, h,
        label: n.label || 'Decision Lens',
        rules: (n.rules || []).map(r => ({
          col: r.col, operator: r.operator, value: r.value ?? '', logic: r.logic ?? null,
        })),
        color: '#fff',
      });
      const to = ref(n.to);
      if (to != null) newConns.push({ id: uid(), from: id, to });
    } else if (n.kind === 'terminal') {
      const type = n.terminal in POLICY_TERMINAL_LABELS ? n.terminal : 'approved';
      newShapes.push({
        id, type, x, y, w, h,
        label: n.label || POLICY_TERMINAL_LABELS[type],
        color: '#ffffff',
      });
    }
  });

  return { shapes: [...baseShapes, ...newShapes], conns: [...baseConns, ...newConns], idMap };
}

// ── Biblioteca de Políticas (Copiloto Sessão 2, docs/wiki/Copiloto-ConstrucaoAssistida.md) ──
// Generalização do padrão já provado no `cinemaLibrary`: salva o PolicyIR (não o canvas
// com posições) + metadados, e aplica com o mesmo fluxo de mapeamento de variáveis do
// `cinemaImportModal` (fuzzy via `normalizeColName`, override manual). O aplicador
// continua sendo o ÚNICO da DEC-IA-002 (`applyPolicyPatch`) — o mapeamento apenas
// reescreve `variable`/`rowVar`/`colVar`/`rules[].col` do IR ANTES de chamar o aplicador,
// não é um segundo caminho de materialização.
//
// `extractPolicyRequiredVars(ir)` lista, uma vez por NOME distinto de coluna (o "slot"
// reutilizável do template — a mesma variável pode aparecer em vários nós), toda coluna
// que o IR referencia: `kind:'decision'` para variável de losango/eixo de Cineminha
// (precisa ser coluna tipada como Filtro no dataset-alvo) e `kind:'any'` para coluna de
// regra de Decision Lens (que casa por NOME contra qualquer coluna carregada, de
// qualquer tipo — mesma semântica de `rowMatchesLensRules`, sem csvId próprio). Se o
// mesmo nome aparece nos dois papéis, prevalece `'decision'` (mais restritivo).
export function extractPolicyRequiredVars(ir) {
  const dsByCsvId = Object.fromEntries((ir?.datasets || []).map(d => [d.csvId, d]));
  const byCol = new Map();
  const add = (col, csvId, kind) => {
    if (!col) return;
    const prev = byCol.get(col);
    if (!prev) {
      byCol.set(col, { col, csvId: csvId ?? null, csvName: csvId ? (dsByCsvId[csvId]?.name ?? null) : null, kind });
    } else if (kind === 'decision' && prev.kind !== 'decision') {
      prev.kind = 'decision';
    }
  };
  for (const n of ir?.nodes || []) {
    if (n.kind === 'decision') add(n.variable?.col, n.variable?.csvId, 'decision');
    else if (n.kind === 'cinema') {
      add(n.rowVar?.col, n.rowVar?.csvId, 'decision');
      add(n.colVar?.col, n.colVar?.csvId, 'decision');
    } else if (n.kind === 'lens') {
      for (const r of (n.rules || [])) add(r.col, null, 'any');
    }
  }
  return [...byCol.values()];
}

// Materializa `mapping: {[origCol]: {col,csvId}|null}` (uma entrada por chave de
// `extractPolicyRequiredVars`) de volta no IR — puro, sem tocar canvas. Variável sem
// mapeamento (entrada ausente ou `null`) vira `null`/coluna `null`: o nó nasce SEM
// variável (pendência visível — não some porta nem rota, só fica sem tráfego; o lint
// da Sessão 1 já aponta isso como achado de "chegada zero" nos ports do nó, reaproveitado
// em vez de reinventado). Nunca aplica mapeamento parcial silencioso de outra coluna.
export function applyPolicyVarMapping(ir, mapping = {}) {
  const mapVar = (v) => {
    if (!v || !v.col) return v ?? null;
    const m = mapping[v.col];
    return m ? { col: m.col, csvId: m.csvId ?? null } : null;
  };
  const nodes = (ir?.nodes || []).map(n => {
    if (n.kind === 'decision') return { ...n, variable: mapVar(n.variable) };
    if (n.kind === 'cinema') return { ...n, rowVar: mapVar(n.rowVar), colVar: mapVar(n.colVar) };
    if (n.kind === 'lens') {
      return { ...n, rules: (n.rules || []).map(r => {
        const m = mapping[r.col];
        return { ...r, col: m ? m.col : null };
      }) };
    }
    return n;
  });
  return { ...ir, nodes };
}

// Diff estrutural entre dois PolicyIR (item 5 do épico — changelog) — reusável pelo
// chat (Nível 3) e pelo Goal Seek (exibir movimentos como "mudanças de IR"), como
// sugerido no épico. Casa nós pelo `id` — correto quando os dois IR vêm da MESMA
// linhagem de canvas (edição in-place, undo/redo, comparação com um snapshot salvo:
// os ids são estáveis nesses casos). Comparar com um canvas clonado via
// `cloneCanvasWithNewIds` (ids todos novos) degrada para "tudo removido + tudo
// adicionado" — limitação documentada, mesmo padrão do "Limite documentado" do IR.
export function diffPolicyIR(a, b) {
  const nodesA = new Map((a?.nodes || []).map(n => [n.id, n]));
  const nodesB = new Map((b?.nodes || []).map(n => [n.id, n]));
  const added = [], removed = [], changed = [];

  const fieldsOf = (na, nb) => {
    const fields = [];
    const cmp = (key, va, vb) => { if (JSON.stringify(va) !== JSON.stringify(vb)) fields.push({ key, before: va, after: vb }); };
    cmp('label', na.label, nb.label);
    if (na.kind === 'decision') { cmp('variable', na.variable, nb.variable); cmp('routes', na.routes, nb.routes); }
    else if (na.kind === 'cinema') {
      cmp('cinemaType', na.cinemaType, nb.cinemaType);
      cmp('rowVar', na.rowVar, nb.rowVar); cmp('colVar', na.colVar, nb.colVar);
      cmp('rowDomain', na.rowDomain, nb.rowDomain); cmp('colDomain', na.colDomain, nb.colDomain);
      cmp('blockedCells', na.blockedCells, nb.blockedCells);
      cmp('routes', na.routes, nb.routes);
    } else if (na.kind === 'lens') { cmp('rules', na.rules, nb.rules); cmp('to', na.to, nb.to); }
    else if (na.kind === 'terminal') { cmp('terminal', na.terminal, nb.terminal); }
    return fields;
  };

  for (const [id, nb] of nodesB) {
    const na = nodesA.get(id);
    if (!na) { added.push({ id, kind: nb.kind, label: nb.label }); continue; }
    if (na.kind !== nb.kind) {
      changed.push({ id, kind: nb.kind, label: nb.label, fields: [{ key: 'kind', before: na.kind, after: nb.kind }] });
      continue;
    }
    const fields = fieldsOf(na, nb);
    if (fields.length > 0) changed.push({ id, kind: nb.kind, label: nb.label, fields });
  }
  for (const [id, na] of nodesA) {
    if (!nodesB.has(id)) removed.push({ id, kind: na.kind, label: na.label });
  }

  const entryA = a?.entry || [], entryB = b?.entry || [];
  const entryChanged = entryA.length !== entryB.length || entryA.some((id, i) => id !== entryB[i]);

  return { added, removed, changed, entryChanged };
}
