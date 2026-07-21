// ═══ Analytics Workspace — helpers globais puros (aba Dashboard) ═══
// Extraído de src/App.jsx (lote C4 do plano docs/wiki/Contexto-Claude.md) por
// movimentação literal — zero mudança de lógica/matemática. Contém os helpers puros
// do Analytics Workspace (pivot, filtros, agrupamentos, métricas, export CSV, KPI) e
// as constantes que só a aba Dashboard usa. As funções que leem estado/refs do
// componente permanecem em App.jsx.
//
// `uid`, `parseTemporalKey`, `matchLensRule` e `LENS_OP_LABEL` continuam definidos em
// App.jsx (usados em todo o componente) e são importados aqui — só referenciados dentro
// dos corpos das funções (nunca em tempo de carga do módulo), então a dependência
// circular App.jsx ⇄ analytics.js resolve normalmente em tempo de chamada.
import { uid, parseTemporalKey, matchLensRule, LENS_OP_LABEL } from "./App.jsx";

// ── Accessors do dataset analítico largo (formato COLUNAR — Otimização de Memória Fase 4) ──
// O dataset largo deixou de ser um array de 1MM objetos e virou colunar:
//   ds = { rowCount, columns:{[nome]:ColDef}, activeRows?:Int32Array|null, dimensions,
//          temporalColumns, metrics, scenarios, dimensionOrders?, groupedDimensions? }
// ColDef: {kind:'dict', dict:string[], codes:Int32Array} | {kind:'num', data:Float64Array}.
// `activeRows` = subconjunto de linhas após filtros (null/ausente = todas). Toda leitura por
// linha passa por estes accessors — nenhum consumidor reconstrói objetos por-linha.
function awColStr(col, r) {
  if (!col) return "";
  if (col.kind === "dict") { const v = col.dict[col.codes[r]]; return v == null ? "" : v; }
  const n = col.data[r]; return Number.isNaN(n) ? "" : String(n);
}
function awColNum(col, r) {
  if (!col) return 0;
  if (col.kind === "num") { const n = col.data[r]; return Number.isNaN(n) ? 0 : n; }
  const p = parseFloat(col.dict[col.codes[r]]); return Number.isNaN(p) ? 0 : p;
}

// Métricas intrínsecas do agrupamento exportadas no dataset largo (DEC-AW-003).
const ANALYTICS_EXPORT_METRICS = [
  { key: "qty",           label: "Vol. Propostas" },
  { key: "qtdAltas",      label: "Altas Reais" },
  { key: "qtdAltasInfer", label: "Conv. Inferida" },
  { key: "inadRRaw",      label: "Inad. Real (num)" },
  { key: "inadIRaw",      label: "Inad. Inferida (num)" },
];

// Nº de linhas por parte do CSV exportado (M5) — em vez de montar 1MM strings de linha e
// dar join numa string única (~200-400MB de strings temporárias + a string final, tudo de
// uma vez), acumula um buffer e o empurra para o array de BlobPart a cada N linhas. O Blob
// aceita o array de partes sem concatenar em RAM.
const CSV_EXPORT_CHUNK_ROWS = 50000;

// Gera as partes do CSV do dataset analítico largo (dimensões + métricas intrínsecas + uma
// coluna de decisão por cenário, AS IS + cada aba marcada) — concatenadas, equivalem
// byte-a-byte ao CSV completo (sem quebra de linha final, mesma semântica de `join("\n")`).
export function buildAnalyticsCSVParts(ds) {
  if (!ds || !ds.rowCount || !ds.columns) return null;
  const dimensions = ds.dimensions || [];
  const scenarios = ds.scenarios || [];
  const cols = ds.columns;
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const header = [
    ...dimensions,
    ...ANALYTICS_EXPORT_METRICS.map(m => m.label),
    ...scenarios.map(s => `Decisão · ${s.nome}`),
  ].map(esc).join(",");
  const N = ds.rowCount;
  const parts = [header];
  let buf = "";
  for (let r = 0; r < N; r++) {
    buf += "\n" + [
      ...dimensions.map(d => awColStr(cols[d], r)),
      ...ANALYTICS_EXPORT_METRICS.map(m => cols[m.key] ? awColNum(cols[m.key], r) : 0),
      ...scenarios.map(s => awColStr(cols[s.decisionCol], r)),
    ].map(esc).join(",");
    if ((r + 1) % CSV_EXPORT_CHUNK_ROWS === 0) { parts.push(buf); buf = ""; }
  }
  if (buf) parts.push(buf);
  return parts;
}

// Serializa o dataset analítico largo como CSV: dimensões + métricas intrínsecas +
// uma coluna de decisão por cenário (AS IS + cada aba marcada). Excel-friendly (5C).
export function buildAnalyticsCSV(ds) {
  const parts = buildAnalyticsCSVParts(ds);
  return parts ? parts.join("") : null;
}

// ── Analytics Workspace (Sessão 2: builder configurável) ─────────────────────
const SCENARIO_COLORS = ["#94a3b8", "#2563eb", "#16a34a", "#d97706", "#9333ea"];
export const SERIE_COLORS = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2", "#db2777", "#65a30d", "#7c3aed", "#ea580c", "#0d9488", "#be123c"];
export const MAX_SERIES = 12; // teto de séries ao quebrar por dimensão categórica

// Sentinelas de "série por": cenário (AS IS vs Simulado) ou nenhuma (linha única).
export const SERIE_CENARIO = "__cenario__";
export const SERIE_NONE = "__none__";
// Sentinela de "eixo X por cenário": cada aba vira um bucket no X.
export const XDIM_CENARIO = "__x_cenario__";

// Tipos de gráfico (Sessão 3). 'line' e 'bar'/'bar100' usam o pivot tidy; 'kpi' é pontual.
export const CHART_TYPES = [
  { id: "line",   icon: "📈", label: "Linha" },
  { id: "bar",    icon: "📊", label: "Barras" },
  { id: "bar100", icon: "🧱", label: "100%" },
  { id: "kpi",    icon: "🔢", label: "KPI" },
];
// Métricas em que "menor é melhor" — orienta a cor do delta no KPI.
export const GOOD_WHEN_LOWER = new Set(["inadReal", "inadInferida"]);

// Agrega uma métrica sobre um conjunto de linhas (dataset largo COLUNAR) para uma coluna
// de decisão. Replica a semântica do motor: numeradores/denominadores só sobre aprovados.
// `indices`: Int32Array|number[]|null — subconjunto de linhas; null = todas as linhas
// ativas do ds (respeitando ds.activeRows dos filtros).
export function computeWidgetMetric(ds, indices, metricId, decisionCol) {
  if (!ds || !ds.columns) return null;
  const cols = ds.columns;
  const qtyC = cols.qty, decC = cols[decisionCol];
  const inadRC = cols.inadRRaw, altasC = cols.qtdAltas, inadIC = cols.inadIRaw, altasInfC = cols.qtdAltasInfer;
  const act = indices || ds.activeRows || null;
  const N = act ? act.length : (ds.rowCount || 0);
  // M14: resolve o código de "APROVADO" uma vez (coluna de decisão é dict-encoded) e
  // compara inteiros por linha em vez de reconstruir/comparar strings a cada iteração.
  const decIsDict = decC && decC.kind === "dict";
  const apprCode = decIsDict ? decC.dict.indexOf("APROVADO") : -1;
  const decCodes = decIsDict ? decC.codes : null;
  let total = 0, appr = 0, inadR = 0, altas = 0, inadI = 0, altasInf = 0;
  for (let i = 0; i < N; i++) {
    const r = act ? act[i] : i;
    const q = awColNum(qtyC, r);
    total += q;
    const isAppr = decIsDict ? (decCodes[r] === apprCode) : (awColStr(decC, r) === "APROVADO");
    if (isAppr) {
      appr += q;
      inadR += awColNum(inadRC, r);
      altas += awColNum(altasC, r);
      inadI += awColNum(inadIC, r);
      altasInf += awColNum(altasInfC, r);
    }
  }
  switch (metricId) {
    case "approvalRate": return total > 0 ? (appr / total) * 100 : null;
    case "inadReal":     return altas > 0 ? (inadR / altas) * 100 : null;
    case "inadInferida": return altasInf > 0 ? (inadI / altasInf) * 100 : (appr > 0 ? (inadI / appr) * 100 : null);
    case "qty":          return total;
    case "approvedQty":  return appr;
    case "approvedAltasInfer": return altasInf;
    default:             return null;
  }
}

// Pivot client-side: dataset largo + config → série tidy {data, series, metricDef, xCol}.
export function pivotWidget(ds, config) {
  if (!ds) return { state: "no_data" };
  const { scenarios, metrics, temporalColumns } = ds;
  const xCol = config.xDimension;
  if (!xCol) return { state: "no_x" };
  const metricDef = metrics.find(m => m.id === config.metric) || metrics[0];
  if (!metricDef) return { state: "no_metric" };
  const serieBy = config.serieBy || SERIE_CENARIO;

  // Iteração sobre o dataset colunar (respeitando ds.activeRows dos filtros).
  const cols = ds.columns || {};
  const act = ds.activeRows || null;
  const rowStr = (name, r) => awColStr(cols[name], r);
  // Valores distintos de uma dimensão nas linhas ativas (para séries/eixo por dimensão).
  // M14: para colunas dict, o trabalho de string acontece só uma vez por código visto
  // (limitado ao dicionário) e o loop por linha lê apenas o inteiro do código.
  const distinctOf = (name) => {
    const c = cols[name];
    const L = act ? act.length : (ds.rowCount || 0);
    if (c && c.kind === "dict") {
      const codes = c.codes, dict = c.dict;
      const seen = new Uint8Array(dict.length);
      const set = new Set();
      for (let i = 0; i < L; i++) {
        const r = act ? act[i] : i;
        const code = codes[r];
        if (code < 0 || code >= seen.length || seen[code]) continue;
        seen[code] = 1;
        const v = String(dict[code] ?? "").trim();
        if (v) set.add(v);
      }
      return [...set];
    }
    const set = new Set();
    for (let i = 0; i < L; i++) { const r = act ? act[i] : i; const v = rowStr(name, r).trim(); if (v) set.add(v); }
    return [...set];
  };
  // Lista de índices ativos que satisfazem um predicado (subconjunto para séries).
  const filterIndices = (pred) => {
    const out = [];
    const L = act ? act.length : (ds.rowCount || 0);
    for (let i = 0; i < L; i++) { const r = act ? act[i] : i; if (pred(r)) out.push(r); }
    return out;
  };
  // Predicado por linha "valor trimado da coluna === target". M14: quando a coluna é
  // dict, pré-computa quais códigos casam (uma passada pelo dicionário) e por linha só
  // consulta a máscara pelo código — sem trim/comparação de string por linha. Preserva
  // a semântica anterior (compara o valor TRIMADO da célula com `target`).
  const makeValPred = (colName, target) => {
    const c = cols[colName];
    if (c && c.kind === "dict") {
      const pass = new Uint8Array(c.dict.length);
      for (let k = 0; k < c.dict.length; k++) if (String(c.dict[k] ?? "").trim() === target) pass[k] = 1;
      const codes = c.codes, len = pass.length;
      const emptyMatch = ("" === target);
      return (r) => { const code = codes[r]; return code >= 0 && code < len ? pass[code] === 1 : emptyMatch; };
    }
    return (r) => awColStr(c, r).trim() === target;
  };

  // Comparador de valores de uma dimensão. Dimensões agrupadas (derivadas) carregam
  // uma ordem explícita de buckets em ds.dimensionOrders — respeitada aqui para que
  // "R01-R05 < R06-R10 < … < Outros" não vire ordenação alfabética/numérica crua.
  const dimOrders = ds.dimensionOrders || {};
  const makeCmp = (col) => {
    const ord = dimOrders[col];
    if (ord && ord.length) {
      const idx = new Map(ord.map((v, i) => [v, i]));
      return (a, b) => {
        const ia = idx.has(a) ? idx.get(a) : Infinity;
        const ib = idx.has(b) ? idx.get(b) : Infinity;
        if (ia !== ib) return ia - ib;
        return a.localeCompare(b, "pt-BR");
      };
    }
    return (a, b) => {
      const na = parseFloat(a), nb = parseFloat(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b, "pt-BR");
    };
  };

  // Modo especial: cenários no eixo X (cada aba = um bucket X).
  if (xCol === XDIM_CENARIO) {
    const activeIds = config.activeScenarios;
    const visScenarios = (activeIds && activeIds.length > 0)
      ? scenarios.filter(s => activeIds.includes(s.id))
      : scenarios;
    if (visScenarios.length === 0) return { state: "empty" };

    // Série = dimensão categórica ou linha única.
    let seriesDefs;
    let truncated = false;
    if (serieBy === SERIE_NONE || serieBy === SERIE_CENARIO) {
      seriesDefs = [{ key: "valor", label: metricDef.label, color: SCENARIO_COLORS[1] }];
    } else {
      const distinct = distinctOf(serieBy).sort(makeCmp(serieBy));
      const capped = distinct.slice(0, MAX_SERIES);
      truncated = capped.length >= MAX_SERIES && distinct.length > MAX_SERIES;
      seriesDefs = capped.map((v, i) => ({ key: v, label: v, filterCol: serieBy, filterVal: v, color: SERIE_COLORS[i % SERIE_COLORS.length] }));
    }

    // Subconjunto por série independe do cenário — computa uma vez (via código) e reusa.
    const seriesSubsets = seriesDefs.map(sd => sd.filterCol ? filterIndices(makeValPred(sd.filterCol, sd.filterVal)) : null);
    const data = visScenarios.map((s) => {
      const row = { x: s.nome };
      seriesDefs.forEach((sd, si) => {
        row[sd.label] = computeWidgetMetric(ds, seriesSubsets[si], metricDef.id, s.decisionCol);
      });
      return row;
    });
    return { state: "ok", data, series: seriesDefs, metricDef, xCol, truncated };
  }

  // Define as séries.
  let seriesDefs;
  if (serieBy === SERIE_CENARIO) {
    const activeIds = config.activeScenarios;
    const visScenarios = (activeIds && activeIds.length > 0)
      ? scenarios.filter(s => activeIds.includes(s.id))
      : scenarios;
    seriesDefs = visScenarios.map((s) => {
      const origIdx = scenarios.indexOf(s);
      return { key: s.id, label: s.nome, decisionCol: s.decisionCol, color: SCENARIO_COLORS[origIdx % SCENARIO_COLORS.length] };
    });
  } else {
    // Quebra por dimensão categórica usando o cenário Simulado implícito. Com um ÚNICO
    // cenário no dataset (Explorar a Base, Épico EB, EB4, DEC-EB-011 — builder livre sobre
    // cenário FIXO AS IS, sem canvases) o rótulo genérico "Simulado" mentiria sobre a
    // natureza do dado — usa o `nome` real do cenário nesse caso (o Dashboard, com 2+
    // cenários, mantém o rótulo genérico "Simulado" de sempre).
    const simScenario = scenarios.find(s => s.id === "simulado") || scenarios[scenarios.length - 1];
    const simCol = simScenario.decisionCol;
    const simLabel = scenarios.length === 1 ? simScenario.nome : "Simulado";
    if (serieBy === SERIE_NONE) {
      seriesDefs = [{ key: "simulado", label: simLabel, decisionCol: simCol, color: SCENARIO_COLORS[1] }];
    } else {
      const distinct = distinctOf(serieBy).sort(makeCmp(serieBy));
      const capped = distinct.slice(0, MAX_SERIES);
      seriesDefs = capped.map((v, i) => ({ key: v, label: v, decisionCol: simCol, filterCol: serieBy, filterVal: v, color: SERIE_COLORS[i % SERIE_COLORS.length] }));
    }
  }

  // M14: acumulação [bucket][série] num ÚNICO passe pela base, em vez de bucketizar e
  // depois re-varrer cada bucket por série (`filter` + `computeWidgetMetric`, O(linhas ×
  // séries)). Cada linha resolve seu bucket (código do eixo X) e sua série (código do
  // eixo de quebra, ou todas as séries de cenário) e soma os 6 componentes da métrica
  // (mesma decomposição de `computeWidgetMetric`) na célula certa. A matemática é idêntica
  // — só o momento/forma do cômputo muda.
  const L = act ? act.length : (ds.rowCount || 0);
  const qtyC = cols.qty, inadRC = cols.inadRRaw, altasC = cols.qtdAltas, inadIC = cols.inadIRaw, altasInfC = cols.qtdAltasInfer;

  // Resolve o bucket (índice denso) de uma linha pelo eixo X, colapsando códigos/strings
  // que trimam pro mesmo rótulo (mesma semântica do keyed-por-string anterior). Descobre
  // os buckets sob demanda, na ordem em que aparecem; a ordenação final acontece depois.
  const xCC = cols[xCol];
  const bucketKeys = [];             // rótulo trimado por índice de bucket
  const bucketKeyToIdx = new Map();  // rótulo → índice de bucket
  const keyToBucket = (v) => {
    let bi = bucketKeyToIdx.get(v);
    if (bi === undefined) { bi = bucketKeys.length; bucketKeys.push(v); bucketKeyToIdx.set(v, bi); }
    return bi;
  };
  let bucketOf;
  if (xCC && xCC.kind === "dict") {
    const codes = xCC.codes, dict = xCC.dict;
    const codeToBucket = new Int32Array(dict.length); codeToBucket.fill(-2); // -2 = não resolvido
    bucketOf = (r) => {
      const code = codes[r];
      if (code < 0 || code >= dict.length) return -1;
      let bi = codeToBucket[code];
      if (bi === -2) { const v = String(dict[code] ?? "").trim(); bi = v ? keyToBucket(v) : -1; codeToBucket[code] = bi; }
      return bi;
    };
  } else {
    bucketOf = (r) => { const v = awColStr(xCC, r).trim(); return v ? keyToBucket(v) : -1; };
  }

  // Modo de série: quebra por dimensão (todas as séries partilham a coluna de decisão e
  // uma linha cai em NO MÁXIMO uma série, pela sua própria célula) vs. cenário (a linha
  // contribui para TODAS as séries, cada uma com sua coluna de decisão).
  const dimensionMode = seriesDefs.some(sd => sd.filterCol);
  const nSeries = seriesDefs.length;
  const apprInfoOf = (decisionCol) => {
    const dc = cols[decisionCol];
    const isDict = dc && dc.kind === "dict";
    return { decC: dc, decIsDict: isDict, apprCode: isDict ? dc.dict.indexOf("APROVADO") : -1, decCodes: isDict ? dc.codes : null };
  };
  const isApprAt = (info, r) => info.decIsDict ? (info.decCodes[r] === info.apprCode) : (awColStr(info.decC, r) === "APROVADO");

  let serieOf = null, sharedAppr = null, seriesAppr = null;
  if (dimensionMode) {
    sharedAppr = apprInfoOf(seriesDefs[0].decisionCol); // todas as séries: mesma decisão (simCol)
    const fCC = cols[seriesDefs[0].filterCol];
    const valToSeries = new Map(seriesDefs.map((sd, i) => [sd.filterVal, i]));
    if (fCC && fCC.kind === "dict") {
      const codes = fCC.codes, dict = fCC.dict;
      const codeToSerie = new Int32Array(dict.length); codeToSerie.fill(-2);
      serieOf = (r) => {
        const code = codes[r];
        if (code < 0 || code >= dict.length) return valToSeries.has("") ? valToSeries.get("") : -1;
        let si = codeToSerie[code];
        if (si === -2) { const v = String(dict[code] ?? "").trim(); si = valToSeries.has(v) ? valToSeries.get(v) : -1; codeToSerie[code] = si; }
        return si;
      };
    } else {
      serieOf = (r) => { const v = awColStr(fCC, r).trim(); return valToSeries.has(v) ? valToSeries.get(v) : -1; };
    }
  } else {
    seriesAppr = seriesDefs.map(sd => apprInfoOf(sd.decisionCol));
  }

  // acc[bucketIdx][seriesIdx] = {t,a,ir,al,ii,ai} — 6 acumuladores por célula.
  const acc = [];
  const ensureBucket = (bi) => {
    while (acc.length <= bi) {
      const arr = new Array(nSeries);
      for (let s = 0; s < nSeries; s++) arr[s] = { t: 0, a: 0, ir: 0, al: 0, ii: 0, ai: 0 };
      acc.push(arr);
    }
  };
  for (let i = 0; i < L; i++) {
    const r = act ? act[i] : i;
    const bi = bucketOf(r);
    if (bi < 0) continue;
    ensureBucket(bi);
    const q = awColNum(qtyC, r);
    const bucket = acc[bi];
    if (dimensionMode) {
      const si = serieOf(r);
      if (si < 0) continue;
      const cell = bucket[si];
      cell.t += q;
      if (isApprAt(sharedAppr, r)) { cell.a += q; cell.ir += awColNum(inadRC, r); cell.al += awColNum(altasC, r); cell.ii += awColNum(inadIC, r); cell.ai += awColNum(altasInfC, r); }
    } else {
      for (let s = 0; s < nSeries; s++) {
        const cell = bucket[s];
        cell.t += q;
        if (isApprAt(seriesAppr[s], r)) { cell.a += q; cell.ir += awColNum(inadRC, r); cell.al += awColNum(altasC, r); cell.ii += awColNum(inadIC, r); cell.ai += awColNum(altasInfC, r); }
      }
    }
  }
  if (bucketKeys.length === 0) return { state: "empty" };

  // Métrica a partir dos acumuladores — MESMAS fórmulas de `computeWidgetMetric`.
  const metricFromAcc = (c) => {
    switch (metricDef.id) {
      case "approvalRate": return c.t > 0 ? (c.a / c.t) * 100 : null;
      case "inadReal":     return c.al > 0 ? (c.ir / c.al) * 100 : null;
      case "inadInferida": return c.ai > 0 ? (c.ii / c.ai) * 100 : (c.a > 0 ? (c.ii / c.a) * 100 : null);
      case "qty":          return c.t;
      case "approvedQty":  return c.a;
      case "approvedAltasInfer": return c.ai;
      default:             return null;
    }
  };

  const isTemporal = (temporalColumns || []).includes(xCol);
  const xCmp = makeCmp(xCol);
  const order = bucketKeys.map((_, i) => i).sort((ia, ib) => {
    const a = bucketKeys[ia], b = bucketKeys[ib];
    if (isTemporal) {
      const ka = parseTemporalKey(a), kb = parseTemporalKey(b);
      if (ka != null && kb != null) return ka - kb;
      if (ka != null) return -1;
      if (kb != null) return 1;
    }
    return xCmp(a, b);
  });
  const data = order.map((bi) => {
    const row = { x: bucketKeys[bi] };
    const bucket = acc[bi];
    seriesDefs.forEach((sd, si) => { row[sd.label] = metricFromAcc(bucket[si]); });
    return row;
  });
  return { state: "ok", data, series: seriesDefs, metricDef, xCol, truncated: serieBy !== SERIE_CENARIO && serieBy !== SERIE_NONE && seriesDefs.length >= MAX_SERIES };
}

// ── Filtros do Analytics Workspace (página + visual) ─────────────────────────
// FilterCard: {id, dim, mode:'basic'|'advanced', selected: string[]|null, rules: FilterRule[]}
// - modo 'basic': `selected===null` = todos os valores passam (inativo até desmarcar algo);
//   `selected` array = lista explícita de valores marcados.
// - modo 'advanced': `rules` — mesma semântica de LensRule (operator/value/logic AND-OR),
//   avaliadas via `matchLensRule` sobre o valor da dimensão na linha.
// Filtros de página e de visual se combinam por AND (um recorta em cima do outro).
function filterCardActive(card) {
  if (!card || !card.dim) return false;
  if (card.mode === "advanced") return (card.rules || []).some(r => String(r.value ?? "").trim());
  return Array.isArray(card.selected);
}

// Avalia um cartão de filtro sobre um valor de dimensão já extraído (string trimada).
function filterCardMatchesVal(val, card) {
  if (card.mode === "advanced") {
    const rules = card.rules || [];
    if (rules.length === 0) return true;
    let result = null;
    for (const rule of rules) {
      const m = matchLensRule(val, rule.operator, rule.value ?? "");
      result = result === null ? m : (rule.logic === "OR" ? (result || m) : (result && m));
    }
    return result ?? true;
  }
  return !Array.isArray(card.selected) || card.selected.includes(val);
}

// Filtra as linhas ativas do dataset largo COLUNAR pelos cartões ativos (AND entre eles).
// Retorna um Int32Array de índices sobreviventes (ou ds.activeRows inalterado se nenhum
// cartão está ativo). Não copia linhas — só carrega índices.
export function applyAnalyticsFilters(ds, cards) {
  const active = (cards || []).filter(filterCardActive);
  if (active.length === 0) return ds.activeRows || null;
  const cols = ds.columns || {};
  const base = ds.activeRows || null;
  const N = base ? base.length : (ds.rowCount || 0);
  // M14: para cada cartão sobre uma coluna dict, avalia a regra UMA vez por valor do
  // dicionário (máscara passByCode) — por linha resta um lookup de inteiro pelo código,
  // sem awColStr/trim/matchLensRule por linha. Colunas não-dict caem no caminho anterior.
  const evaluators = active.map(card => {
    const c = cols[card.dim];
    if (c && c.kind === "dict") {
      const pass = new Uint8Array(c.dict.length);
      for (let k = 0; k < c.dict.length; k++) pass[k] = filterCardMatchesVal(String(c.dict[k] ?? "").trim(), card) ? 1 : 0;
      const emptyPass = filterCardMatchesVal("", card) ? 1 : 0; // códigos fora do intervalo → valor ""
      return { dict: true, codes: c.codes, pass, len: pass.length, emptyPass };
    }
    return { dict: false, col: c, card };
  });
  const out = [];
  for (let i = 0; i < N; i++) {
    const r = base ? base[i] : i;
    let ok = true;
    for (let j = 0; j < evaluators.length; j++) {
      const ev = evaluators[j];
      let m;
      if (ev.dict) { const code = ev.codes[r]; m = (code >= 0 && code < ev.len) ? ev.pass[code] : ev.emptyPass; }
      else { m = filterCardMatchesVal(awColStr(ev.col, r).trim(), ev.card) ? 1 : 0; }
      if (!m) { ok = false; break; }
    }
    if (ok) out.push(r);
  }
  return Int32Array.from(out);
}

// Combina filtro de página + filtro do visual (AND) sobre o dataset largo — o visual
// recorta em cima da visão que já chega filtrada pela página. Ignora cartões cuja
// dimensão não existe mais no dataset atual (base trocada/agrupamento removido).
export function applyFiltersToDataset(ds, pageFilters, widgetFilters) {
  if (!ds) return ds;
  const validDims = new Set(ds.dimensions || []);
  const cards = [...(pageFilters || []), ...(widgetFilters || [])].filter(c => c && validDims.has(c.dim));
  if (cards.filter(filterCardActive).length === 0) return ds;
  return { ...ds, activeRows: applyAnalyticsFilters(ds, cards) };
}

// Descreve, em texto legível, cada cartão de filtro ATIVO de uma lista (filtro de
// página ou de um visual). Base do detalhamento de filtros no export de PDF do
// Dashboard. Cartões inativos (sem dimensão / sem seleção / sem regra) são omitidos.
// Retorna [{ dim, mode:'basic'|'advanced', text, values?, total? }].
export function describeFilterCards(cards, dataset) {
  const out = [];
  for (const card of (cards || [])) {
    if (!filterCardActive(card)) continue;
    if (card.mode === "advanced") {
      const parts = (card.rules || [])
        .filter(r => String(r.value ?? "").trim())
        .map((r, i) => {
          const opLabel = LENS_OP_LABEL[r.operator] || r.operator;
          const connector = i === 0 ? "" : (r.logic === "OR" ? "OU " : "E ");
          return `${connector}${opLabel} ${String(r.value).trim()}`;
        });
      out.push({ dim: card.dim, mode: "advanced", text: parts.join(" ") });
    } else {
      const values = Array.isArray(card.selected) ? card.selected : [];
      const total = dataset ? distinctDimValues(dataset, card.dim).length : null;
      const text = values.length ? values.join(", ") : "(nenhum valor selecionado)";
      out.push({ dim: card.dim, mode: "basic", values, total, text });
    }
  }
  return out;
}

// ── Agrupamentos (dimensões derivadas) ───────────────────────────────────────
// Um agrupamento colapsa os valores de uma dimensão-base (ex.: FAIXA_SCORE R01–R20)
// em poucos buckets reutilizáveis. Vira uma dimensão derivada usável em qualquer
// gráfico (Eixo X / Série / KPI), no export CSV e salva no projeto.
export const GROUPING_OTHER_DEFAULT = "Outros";

// Ordena valores distintos de uma coluna (numérico crescente, senão A-Z pt-BR).
function sortDistinctValues(values) {
  return [...values].sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b), "pt-BR");
  });
}

// Valores distintos de uma dimensão do dataset largo COLUNAR (ordenados). Para colunas
// dict (o caso comum) os distintos SÃO o dicionário — O(distintos) em vez de varrer 1MM.
export function distinctDimValues(ds, col) {
  if (!ds || !col || !ds.columns) return [];
  const c = ds.columns[col];
  if (!c) return [];
  const set = new Set();
  if (c.kind === "dict") {
    for (const v of c.dict) { const t = String(v ?? "").trim(); if (t) set.add(t); }
  } else {
    const N = ds.rowCount || 0;
    for (let r = 0; r < N; r++) { const v = awColStr(c, r).trim(); if (v) set.add(v); }
  }
  return sortDistinctValues([...set]);
}

// Gera buckets automaticamente: fatia a lista ordenada de valores em grupos de
// `size` valores consecutivos, rotulando cada faixa como "primeiro–último".
export function autoBuckets(sortedValues, size) {
  const n = Math.max(1, Math.floor(size) || 1);
  const out = [];
  for (let i = 0; i < sortedValues.length; i += n) {
    const slice = sortedValues.slice(i, i + n);
    const label = slice.length === 1 ? slice[0] : `${slice[0]}–${slice[slice.length - 1]}`;
    out.push({ id: uid(), label, values: slice });
  }
  return out;
}

// Aplica os agrupamentos ao dataset largo: adiciona uma coluna derivada por
// agrupamento (chave = nome do agrupamento), registra a ordem dos buckets em
// `dimensionOrders` e marca as derivadas em `groupedDimensions`. Pura/memoizável.
export function applyGroupingsToDataset(ds, groupings) {
  if (!ds) return ds;
  const realDims = new Set(ds.dimensions || []);
  const seen = new Set();
  const valid = (groupings || []).filter(g => {
    if (!g || !g.name || !g.source) return false;
    if (!realDims.has(g.source)) return false;        // base sumiu da base atual
    if (realDims.has(g.name)) return false;            // não sobrescreve coluna real
    if (seen.has(g.name)) return false;                // nomes duplicados — 1º vence
    seen.add(g.name);
    return true;
  });
  if (valid.length === 0) return ds;

  // Cada agrupamento vira UMA nova coluna dict (codes:Int32Array + dict pequeno), ~4MB
  // por 1MM de linhas — em vez de copiar 1MM objetos de linha (o que dobrava o dataset).
  const N = ds.rowCount || 0;
  const newColumns = { ...(ds.columns || {}) };
  const dimensions = [...(ds.dimensions || [])];
  const dimensionOrders = { ...(ds.dimensionOrders || {}) };
  const groupedDimensions = [...(ds.groupedDimensions || [])];

  for (const g of valid) {
    const map = new Map();
    for (const b of (g.buckets || [])) for (const v of (b.values || [])) map.set(String(v), b.label);
    const keepOriginal = g.unmatched === "keep";
    const otherLabel = keepOriginal ? null : (g.otherLabel || GROUPING_OTHER_DEFAULT);
    const order = (g.buckets || []).map(b => b.label);
    if (otherLabel && !order.includes(otherLabel)) order.push(otherLabel);

    const srcCol = (ds.columns || {})[g.source];
    const dict = [], dictIndex = new Map(), codes = new Int32Array(N);
    const present = new Set();
    for (let r = 0; r < N; r++) {
      const sv = awColStr(srcCol, r).trim();
      const lbl = map.get(sv);
      const label = lbl != null ? lbl : (otherLabel != null ? otherLabel : sv);
      let c = dictIndex.get(label);
      if (c === undefined) { c = dict.length; dict.push(label); dictIndex.set(label, c); }
      codes[r] = c;
      present.add(label);
    }
    newColumns[g.name] = { kind: "dict", dict, codes };
    if (!dimensions.includes(g.name)) dimensions.push(g.name);
    if (!groupedDimensions.includes(g.name)) groupedDimensions.push(g.name);
    dimensionOrders[g.name] = order.filter(l => present.has(l));
  }
  return { ...ds, columns: newColumns, dimensions, dimensionOrders, groupedDimensions };
}

// Resolve os cenários Baseline (A) e Comparação (B) do KPI a partir dos ids salvos
// no WidgetConfig, com fallback retrocompatível (DEC-AW-008): A = AS IS, B = 1º canvas.
export function resolveKpiScenarios(scenarios, kpiA, kpiB) {
  if (!scenarios || scenarios.length === 0) return { a: null, b: null };
  const find = (id) => scenarios.find(s => s.id === id);
  const a = find(kpiA) || find("as_is") || scenarios[0];
  const defaultB = scenarios.find(s => s.id !== "as_is") || scenarios[scenarios.length - 1];
  const b = find(kpiB) || defaultB;
  return { a, b };
}
