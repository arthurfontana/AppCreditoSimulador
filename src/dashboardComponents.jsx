// ═══ dashboardComponents.jsx — AnalysisTab e Widgets do Dashboard (lote C4) ═══
// Componentes React globais da aba Dashboard e dos cards do Copiloto (Segmentos/Clusters),
// extraídos de src/App.jsx (região "AnalysisTab e Widgets do Dashboard"). Movimentação
// LITERAL — zero mudança de lógica/JSX. Todos são componentes de módulo (sem closure sobre
// estado/refs do App(): recebem tudo por props). Contrato de domínio em
// docs/claude/Analytics-Workspace.md; navegação em docs/claude/Mapa-App.md.
//
// Dependência circular App.jsx ⇄ dashboardComponents.jsx: o módulo importa de App.jsx só
// fmtQty/fmtPct/uid/escHtml/LENS_OPERATORS/exportAnalyticsDatasetCSV, e todos são usados
// dentro de corpos de função/render (runtime) — nunca na inicialização do módulo —, então
// resolve como em analytics.js/policyIR.js. Helpers puros e constantes da aba Dashboard vêm
// de ./analytics.js.
import { useState, useEffect, useMemo, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, ComposedChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LabelList, ScatterChart, Scatter, ZAxis, Cell,
} from "recharts";
import {
  pivotWidget, computeWidgetMetric, applyFiltersToDataset, describeFilterCards,
  distinctDimValues, autoBuckets, resolveKpiScenarios,
  CHART_TYPES, GOOD_WHEN_LOWER, MAX_SERIES, SERIE_COLORS,
  SERIE_CENARIO, SERIE_NONE, XDIM_CENARIO, GROUPING_OTHER_DEFAULT,
} from "./analytics.js";
import { buildDefaultExploreLayout } from "./explore.js";
import { describeFinding, describeSection, describeHowToRead, howToReadTopic } from "./exploreInsights.js";
import { fmtQty, fmtPct, uid, escHtml, LENS_OPERATORS, exportAnalyticsDatasetCSV } from "./App.jsx";

// MIME do drag de campos (dimensões/métricas) no FieldPanel/FieldWell (estilo Power BI).

const AW_DRAG_MIME = "application/aw-field";

// Descoberta de Segmentos (Copiloto Sessão 10/11, DEC-SD-001..006) — metadados de UI por
// código de achado (findings vêm de COMPUTE_SEGMENT_DISCOVERY/SEGMENT_DISCOVERY_RESULT).
// Cores validadas para separação CVD (scripts/validate_palette.js da skill dataviz).
const SEGMENT_CODE_META = {
  approvable_low_risk: { icon: "💰", label: "Aprovável de baixo risco", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
  approved_high_risk:  { icon: "🔥", label: "Aprovado de alto risco",   color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
  heterogeneous_block: { icon: "🪓", label: "Bloco heterogêneo",       color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
  asis_divergence:     { icon: "🔀", label: "Divergência vs. AS IS",   color: "#ea580c", bg: "#fff7ed", border: "#fed7aa" },
  anomaly:             { icon: "⚠️", label: "Anomalia de dado",         color: "#b45309", bg: "#fffbeb", border: "#fde68a" },
};
const SEGMENT_TERMINAL_LABEL = { approved: "Aprovado", rejected: "Reprovado", as_is: "AS IS" };

// Condições do segmento em linguagem de regra ("Score = R08 e Canal = Digital").
function segmentRuleText(conditions) {
  if (!conditions || conditions.length === 0) return null;
  return conditions.map(c => `${c.col} = ${c.value}`).join(" e ");
}

// "2,4× menor"/"2,4× maior" — sempre relativo (nunca "lift 0.42", sempre a leitura direta.
function fmtLift(lift) {
  if (lift == null || !isFinite(lift) || lift <= 0) return null;
  const factor = lift >= 1 ? lift : 1 / lift;
  const word = lift < 1 ? "menor" : lift > 1 ? "maior" : "igual";
  return `${factor.toFixed(1)}× ${word}`;
}

// Template determinístico da dispersão ("por que nunca vi isso antes") — só quando o
// segmento é decidido em mais de um nó da política hoje (dispersion.nodesCount > 1).
function segmentDispersionText(dispersion) {
  if (!dispersion || dispersion.nodesCount <= 1) return null;
  const parts = (dispersion.terminals || []).map(t => `${t.sharePct.toFixed(0)}% em ${SEGMENT_TERMINAL_LABEL[t.terminal] || t.terminal}`);
  return `Hoje este segmento está diluído em ${dispersion.nodesCount} nós da política: ${parts.join(", ")} — nenhum corte atual o enxerga inteiro.`;
}

const fmtMetricVal = (v, unit) => v == null ? "N/A" : unit === "qty" ? fmtQty(v) : `${v.toFixed(1)}%`;

export function newFilterCard() {
  return { id: uid(), dim: null, mode: "basic", selected: null, rules: [] };
}

// Calcula cor de texto com contraste WCAG sobre um fundo hex.
function getContrastColor(hex) {
  if (!hex || hex.length < 7) return "#ffffff";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? "#1e293b" : "#ffffff";
}

// Rótulo customizado para barras: badge colorido com contraste automático e posição inteligente.
function ChartBarLabel({ x, y, width, height, value, color, metricDef, isBar100 }) {
  if (value == null) return null;
  const text = isBar100 ? `${(+value).toFixed(1)}%` : fmtMetricVal(value, metricDef?.unit);
  const textColor = getContrastColor(color || "#2563eb");
  const labelW = Math.max(34, text.length * 6.2 + 12);
  const labelH = 17;
  const cx = (x || 0) + (width || 0) / 2;
  const barH = Math.abs(height || 0);
  const barTop = (height || 0) >= 0 ? (y || 0) : (y || 0) + (height || 0);
  const inside = barH > labelH + 8;
  const ly = inside ? barTop + barH / 2 - labelH / 2 : barTop - labelH - 3;
  return (
    <g>
      <rect x={cx - labelW / 2} y={ly} width={labelW} height={labelH} fill={color} rx={3} opacity={0.93} />
      <text x={cx} y={ly + labelH / 2} textAnchor="middle" dominantBaseline="middle"
        fill={textColor} fontSize={10} fontFamily="inherit" fontWeight={500}>{text}</text>
    </g>
  );
}

// Rótulo customizado para pontos de linha: texto puro com outline branco e posição inteligente.
// Sem fundo colorido para não tapar a linha. Posição acima/abaixo baseada em extremos locais
// e índice de série (séries pares acima, ímpares abaixo) para reduzir sobreposição.
function ChartLineLabel({ x, y, value, color, metricDef, index, seriesIndex, allData, seriesKey }) {
  if (value == null) return null;
  const text = fmtMetricVal(value, metricDef?.unit);

  const prev = (allData && index > 0) ? allData[index - 1]?.[seriesKey] : null;
  const next = (allData && index != null && index < allData.length - 1) ? allData[index + 1]?.[seriesKey] : null;

  let above;
  if (prev != null && next != null) {
    if (value >= prev && value >= next) above = false; // pico local → rótulo abaixo
    else if (value <= prev && value <= next) above = true; // vale local → rótulo acima
    else above = (seriesIndex ?? 0) % 2 === 0;
  } else {
    above = (seriesIndex ?? 0) % 2 === 0;
  }

  const cy = y || 0;
  const ly = above ? cy - 10 : cy + 14;

  return (
    <text x={x || 0} y={ly} textAnchor="middle" dominantBaseline="middle"
      fill={color} fontSize={9.5} fontFamily="inherit" fontWeight={700}
      stroke="#ffffff" strokeWidth={3} paintOrder="stroke">
      {text}
    </text>
  );
}

// Painel inline de personalização de séries (cor + estilo de linha para tipo "line").
function SeriesStylePanel({ series, isLine, seriesStyles, onChange }) {
  const DASH_OPTS = [
    { id: "0",   title: "Contínua",   icon: <svg width={22} height={8}><line x1={1} y1={4} x2={21} y2={4} stroke="currentColor" strokeWidth={2} /></svg> },
    { id: "8 4", title: "Tracejada",  icon: <svg width={22} height={8}><line x1={1} y1={4} x2={21} y2={4} stroke="currentColor" strokeWidth={2} strokeDasharray="8 4" /></svg> },
    { id: "2 4", title: "Pontilhada", icon: <svg width={22} height={8}><line x1={1} y1={4} x2={21} y2={4} stroke="currentColor" strokeWidth={2} strokeDasharray="2 4" /></svg> },
  ];
  const WIDTH_OPTS = [
    { id: 1.5, title: "Fina",   icon: <svg width={22} height={8}><line x1={1} y1={4} x2={21} y2={4} stroke="currentColor" strokeWidth={1.5} /></svg> },
    { id: 2.5, title: "Média",  icon: <svg width={22} height={8}><line x1={1} y1={4} x2={21} y2={4} stroke="currentColor" strokeWidth={2.5} /></svg> },
    { id: 4,   title: "Grossa", icon: <svg width={22} height={8}><line x1={1} y1={4} x2={21} y2={4} stroke="currentColor" strokeWidth={4} /></svg> },
  ];
  if (!series || series.length === 0) return null;
  return (
    <div style={{ background: "#fafafa", borderRadius: 9, border: "1px solid #e8ecf0", padding: "10px 12px", marginBottom: 10, flexShrink: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.7 }}>Personalizar séries</div>
      {series.map((sd) => {
        const st = seriesStyles[sd.key] || {};
        const curDash = st.strokeDasharray ?? "0";
        const curWidth = st.strokeWidth ?? 2.5;
        const btnBase = (active) => ({
          width: 32, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
          borderRadius: 5, border: `1px solid ${active ? "#2563eb" : "#e2e8f0"}`,
          background: active ? "#eff6ff" : "#fff", color: active ? "#2563eb" : "#64748b",
          cursor: "pointer", padding: 0,
        });
        return (
          <div key={sd.key} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, flexWrap: "wrap" }}>
            <div style={{ width: 11, height: 11, borderRadius: "50%", background: sd.color, flexShrink: 0, border: "1px solid rgba(0,0,0,.12)" }} />
            <span style={{ fontSize: 11.5, color: "#374151", flex: 1, minWidth: 60, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {sd.label}
            </span>
            <input type="color" value={sd.color} title="Cor da série"
              onChange={(e) => onChange(sd.key, { color: e.target.value })}
              style={{ width: 26, height: 22, border: "1px solid #e2e8f0", borderRadius: 5, padding: "1px", cursor: "pointer", flexShrink: 0 }} />
            {isLine && (
              <>
                <div style={{ display: "flex", gap: 2 }}>
                  {DASH_OPTS.map(opt => (
                    <button key={opt.id} title={opt.title} onClick={() => onChange(sd.key, { strokeDasharray: opt.id })} style={btnBase(curDash === opt.id)}>{opt.icon}</button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 2 }}>
                  {WIDTH_OPTS.map(opt => (
                    <button key={opt.id} title={opt.title} onClick={() => onChange(sd.key, { strokeWidth: opt.id })} style={btnBase(curWidth === opt.id)}>{opt.icon}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Estado vazio reutilizável.
function AWEmptyState({ icon, title, hint }) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#94a3b8", textAlign: "center", padding: 40, minHeight: 240 }}>
      <div style={{ fontSize: 48, marginBottom: 14, opacity: 0.7 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#475569", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, maxWidth: 420, lineHeight: 1.5 }}>{hint}</div>
    </div>
  );
}

// ── FieldPanel — campos arrastáveis (dimensões + métricas), estilo Power BI ───
function FieldPanel({ analyticsDataset, groupings = [], onNewGrouping, onEditGrouping, onDeleteGrouping, pageFilters = [], onPageFiltersChange }) {
  const dims = analyticsDataset?.dimensions || [];
  const temporalCols = new Set(analyticsDataset?.temporalColumns || []);
  const groupedSet = new Set(analyticsDataset?.groupedDimensions || []);
  const metrics = analyticsDataset?.metrics || [];
  // Dimensões "reais" (exclui as derivadas, que ganham seção própria).
  // Temporais primeiro, depois categóricas (A-Z).
  const orderedDims = [...dims].filter(d => !groupedSet.has(d)).sort((a, b) => {
    const ta = temporalCols.has(a), tb = temporalCols.has(b);
    if (ta !== tb) return ta ? -1 : 1;
    return a.localeCompare(b, "pt-BR");
  });

  const startDrag = (e, kind, id) => {
    e.dataTransfer.setData(AW_DRAG_MIME, JSON.stringify({ kind, id }));
    e.dataTransfer.effectAllowed = "copy";
  };

  const chip = (label, icon, bg, border, color, kind, id) => (
    <div key={`${kind}-${id}`} draggable onDragStart={(e) => startDrag(e, kind, id)}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 9px", borderRadius: 8,
        border: `1.5px solid ${border}`, background: bg, marginBottom: 4, cursor: "grab", userSelect: "none",
        fontSize: 12, fontWeight: 500, color }}>
      <span style={{ fontSize: 12 }}>{icon}</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: 13, opacity: 0.45 }}>⠿</span>
    </div>
  );

  // Chip de agrupamento (derivado): arrastável + botões editar/remover.
  const groupingChip = (g) => (
    <div key={`grp-${g.id}`} draggable onDragStart={(e) => startDrag(e, "dim", g.name)}
      style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 8px", borderRadius: 8,
        border: "1.5px solid #ddd6fe", background: "#f5f3ff", marginBottom: 4, cursor: "grab", userSelect: "none",
        fontSize: 12, fontWeight: 500, color: "#6d28d9" }}>
      <span style={{ fontSize: 12 }}>🧩</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={`${g.name} · base: ${g.source}`}>{g.name}</span>
      <button onClick={() => onEditGrouping && onEditGrouping(g.id)} title="Editar agrupamento"
        style={{ border: "none", background: "transparent", color: "#7c3aed", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}>✎</button>
      <button onClick={() => onDeleteGrouping && onDeleteGrouping(g.id)} title="Remover agrupamento"
        style={{ border: "none", background: "transparent", color: "#a78bfa", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1 }}>✕</button>
    </div>
  );

  const pageFilterCount = pageFilters.filter(c => c.dim).length;

  return (
    <div style={{ width: 220, flexShrink: 0, borderLeft: "1px solid #e2e8f0", background: "#fff", overflowY: "auto", padding: "16px 14px" }}>
      <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>
        🔎 Filtros da Página {pageFilterCount > 0 && <span style={{ color: "#2563eb" }}>({pageFilterCount})</span>}
      </p>
      <p style={{ fontSize: 10.5, color: "#cbd5e1", marginBottom: 8, lineHeight: 1.4 }}>
        Aplica-se a todos os gráficos do Dashboard. Um filtro no visual recorta em cima deste.
      </p>
      <FilterCardsEditor cards={pageFilters} dataset={analyticsDataset} onChange={onPageFiltersChange} />

      <div style={{ height: 1, background: "#e2e8f0", margin: "16px 0" }} />

      <p style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>Dimensões</p>
      {chip("Cenários (abas)", "🎬", "#fff7ed", "#fed7aa", "#c2410c", "dim", XDIM_CENARIO)}
      {orderedDims.length > 0 ? orderedDims.map(d =>
        temporalCols.has(d)
          ? chip(d, "⏱", "#eef2ff", "#c7d2fe", "#4338ca", "dim", d)
          : chip(d, "▦", "#f1f5f9", "#e2e8f0", "#475569", "dim", d)
      ) : <div style={{ fontSize: 11.5, color: "#cbd5e1", padding: "4px 2px" }}>—</div>}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0 8px" }}>
        <p style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>Agrupamentos</p>
        <button onClick={() => onNewGrouping && onNewGrouping()} title="Criar agrupamento de uma dimensão"
          style={{ border: "1px solid #ddd6fe", background: "#f5f3ff", color: "#7c3aed", cursor: "pointer",
            fontSize: 11, fontWeight: 600, borderRadius: 7, padding: "2px 8px", fontFamily: "inherit" }}>+ Novo</button>
      </div>
      {groupings.length > 0 ? groupings.map(groupingChip)
        : <div style={{ fontSize: 10.5, color: "#cbd5e1", padding: "2px", lineHeight: 1.5 }}>
            Agrupe valores de uma dimensão (ex.: Faixa Score R01–R20 em poucas faixas) para reusar em qualquer gráfico.
          </div>}

      <p style={{ fontSize: 11, color: "#94a3b8", margin: "16px 0 8px", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6 }}>Métricas</p>
      {metrics.length > 0 ? metrics.map(m =>
        chip(m.label, "Σ", "#ecfdf5", "#bbf7d0", "#15803d", "metric", m.id)
      ) : <div style={{ fontSize: 11.5, color: "#cbd5e1", padding: "4px 2px" }}>—</div>}

      <p style={{ fontSize: 10.5, color: "#cbd5e1", marginTop: 18, lineHeight: 1.5 }}>
        Arraste uma dimensão para o Eixo X ou a Série de um gráfico. Métricas vão para o campo Métrica.
      </p>
    </div>
  );
}

// ── FieldWell — poço de campo (drop zone + select) de um gráfico ──────────────
function FieldWell({ icon, label, accept, value, displayValue, options, onChange }) {
  const [over, setOver] = useState(false);
  const onDrop = (e) => {
    e.preventDefault();
    setOver(false);
    try {
      const payload = JSON.parse(e.dataTransfer.getData(AW_DRAG_MIME));
      if (payload && payload.kind === accept) onChange(payload.id);
    } catch { /* ignore */ }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 }}>{icon} {label}</span>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        style={{ position: "relative", borderRadius: 8, border: over ? "1.5px dashed #3b82f6" : "1.5px solid #e2e8f0",
          background: over ? "#eff6ff" : "#f8fafc", transition: "all .12s" }}>
        <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}
          style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "none", background: "transparent",
            fontSize: 12, color: displayValue ? "#1e293b" : "#94a3b8", fontWeight: 500, fontFamily: "inherit",
            outline: "none", cursor: "pointer", appearance: "none", boxSizing: "border-box" }}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
}

// ── FilterCardsEditor — cartões de filtro (nível página ou nível visual) ─────
// Inspirado no painel de filtros do Power BI: cada cartão fixa uma dimensão e
// alterna entre "Básico" (lista de valores com checkbox) e "Avançado" (regras
// AND/OR, mesma semântica do Decision Lens).
function FilterCardRow({ card, dataset, onChange, onRemove }) {
  const dims = dataset?.dimensions || [];
  const temporalCols = new Set(dataset?.temporalColumns || []);
  const groupedCols = new Set(dataset?.groupedDimensions || []);
  const dimLabel = (d) => groupedCols.has(d) ? `🧩 ${d}` : (temporalCols.has(d) ? `⏱ ${d}` : d);
  const orderedDims = [...dims].sort((a, b) => {
    const ga = groupedCols.has(a), gb = groupedCols.has(b);
    if (ga !== gb) return ga ? 1 : -1;
    const ta = temporalCols.has(a), tb = temporalCols.has(b);
    if (ta !== tb) return ta ? -1 : 1;
    return a.localeCompare(b, "pt-BR");
  });

  const [search, setSearch] = useState("");
  const distinct = useMemo(() => {
    if (!card.dim || !dataset) return [];
    const vals = distinctDimValues(dataset, card.dim);
    const order = dataset.dimensionOrders?.[card.dim];
    if (!order || !order.length) return vals;
    const idx = new Map(order.map((v, i) => [v, i]));
    return [...vals].sort((a, b) => {
      const ia = idx.has(a) ? idx.get(a) : Infinity, ib = idx.has(b) ? idx.get(b) : Infinity;
      return ia !== ib ? ia - ib : a.localeCompare(b, "pt-BR");
    });
  }, [dataset, card.dim]);
  const shown = search ? distinct.filter(v => v.toLowerCase().includes(search.toLowerCase())) : distinct;
  const selectedList = card.selected ?? distinct;
  const selectedSet = new Set(selectedList);

  const toggleVal = (v) => {
    const base = card.selected ?? distinct;
    const next = base.includes(v) ? base.filter(x => x !== v) : [...base, v];
    onChange({ ...card, selected: next });
  };
  const addRule = () => onChange({ ...card, rules: [...card.rules, { id: uid(), operator: "equal", value: "", logic: card.rules.length > 0 ? "AND" : null }] });
  const updateRule = (ruleId, patch) => onChange({ ...card, rules: card.rules.map(r => r.id === ruleId ? { ...r, ...patch } : r) });
  const removeRule = (ruleId) => onChange({ ...card, rules: card.rules.filter(r => r.id !== ruleId).map((r, i) => i === 0 ? { ...r, logic: null } : r) });

  const activeCount = !card.dim ? 0 : card.mode === "basic"
    ? (Array.isArray(card.selected) ? card.selected.length : distinct.length)
    : card.rules.filter(r => String(r.value ?? "").trim()).length;

  const selStyle = { padding: "5px 7px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff",
    fontSize: 11.5, color: "#1e293b", fontFamily: "inherit", outline: "none", cursor: "pointer" };

  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, background: "#fff", marginBottom: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 9px", background: "#f8fafc", borderBottom: card.dim ? "1px solid #f1f5f9" : "none" }}>
        <select value={card.dim ?? ""} onChange={(e) => onChange({ ...card, dim: e.target.value || null, selected: null, rules: [] })}
          style={{ ...selStyle, flex: 1, minWidth: 0 }}>
          <option value="">— escolher dimensão —</option>
          {orderedDims.map(d => <option key={d} value={d}>{dimLabel(d)}</option>)}
        </select>
        <button onClick={onRemove} title="Remover filtro"
          style={{ flexShrink: 0, border: "none", background: "transparent", color: "#f87171", cursor: "pointer", fontSize: 13, padding: "2px 4px" }}>✕</button>
      </div>
      {card.dim && (
        <div style={{ padding: "8px 9px" }}>
          <div style={{ display: "flex", gap: 2, marginBottom: 8, padding: 2, background: "#f1f5f9", borderRadius: 8, width: "fit-content" }}>
            {[["basic", "Básico"], ["advanced", "Avançado"]].map(([id, label]) => (
              <button key={id} onClick={() => onChange({ ...card, mode: id })}
                style={{ padding: "3px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600,
                  fontFamily: "inherit", background: card.mode === id ? "#fff" : "transparent",
                  color: card.mode === id ? "#1e293b" : "#94a3b8", boxShadow: card.mode === id ? "0 1px 2px rgba(0,0,0,.08)" : "none" }}>
                {label}
              </button>
            ))}
          </div>

          {card.mode === "basic" ? (
            <>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar valor..."
                style={{ width: "100%", padding: "5px 8px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#f8fafc",
                  fontSize: 11.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 6 }} />
              <div style={{ display: "flex", gap: 10, marginBottom: 6 }}>
                <button onClick={() => onChange({ ...card, selected: null })} style={{ border: "none", background: "none", color: "#2563eb", cursor: "pointer", fontSize: 10.5, fontFamily: "inherit", padding: 0 }}>Selecionar tudo</button>
                <button onClick={() => onChange({ ...card, selected: [] })} style={{ border: "none", background: "none", color: "#2563eb", cursor: "pointer", fontSize: 10.5, fontFamily: "inherit", padding: 0 }}>Limpar</button>
              </div>
              <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #f1f5f9", borderRadius: 7 }}>
                {shown.length === 0 ? (
                  <div style={{ padding: "10px 8px", fontSize: 11, color: "#cbd5e1", textAlign: "center" }}>Nenhum valor</div>
                ) : shown.map(v => (
                  <label key={v} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", fontSize: 11.5, color: "#334155", cursor: "pointer" }}>
                    <input type="checkbox" checked={selectedSet.has(v)} onChange={() => toggleVal(v)} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                  </label>
                ))}
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 5 }}>
                {activeCount} de {distinct.length} selecionados
              </div>
            </>
          ) : (
            <div>
              {card.rules.length === 0 ? (
                <div style={{ fontSize: 11, color: "#94a3b8", padding: "6px 2px" }}>Nenhuma regra ainda.</div>
              ) : card.rules.map((rule, idx) => (
                <div key={rule.id} style={{ marginBottom: 5 }}>
                  {idx > 0 && (
                    <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                      {["AND", "OR"].map(logic => (
                        <button key={logic} onClick={() => updateRule(rule.id, { logic })}
                          style={{ padding: "1px 8px", borderRadius: 10, border: `1px solid ${rule.logic === logic ? "#0891b2" : "#e2e8f0"}`,
                            background: rule.logic === logic ? "#ecfeff" : "#fff", color: rule.logic === logic ? "#0891b2" : "#94a3b8",
                            fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{logic}</button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 5 }}>
                    <select value={rule.operator} onChange={(e) => updateRule(rule.id, { operator: e.target.value })} style={{ ...selStyle, flexShrink: 0 }}>
                      {LENS_OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                    </select>
                    <input value={rule.value || ""} onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                      placeholder={rule.operator === "in" || rule.operator === "notIn" ? "val1, val2…" : "valor..."}
                      style={{ flex: 1, minWidth: 0, padding: "5px 8px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff",
                        fontSize: 11.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
                    <button onClick={() => removeRule(rule.id)} style={{ flexShrink: 0, border: "none", background: "transparent", color: "#f87171", cursor: "pointer", fontSize: 12 }}>✕</button>
                  </div>
                </div>
              ))}
              <button onClick={addRule} style={{ marginTop: 4, ...selStyle, background: "#f8fafc", fontWeight: 600, color: "#475569" }}>+ Regra</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilterCardsEditor({ cards, dataset, onChange }) {
  const setCard = (id, patch) => onChange(cards.map(c => c.id === id ? patch : c));
  const removeCard = (id) => onChange(cards.filter(c => c.id !== id));
  const addCard = () => onChange([...cards, newFilterCard()]);
  return (
    <div>
      {cards.map(c => (
        <FilterCardRow key={c.id} card={c} dataset={dataset}
          onChange={(next) => setCard(c.id, next)} onRemove={() => removeCard(c.id)} />
      ))}
      <button onClick={addCard} style={{ width: "100%", padding: "6px 8px", borderRadius: 8, border: "1px dashed #cbd5e1",
        background: "#f8fafc", color: "#475569", cursor: "pointer", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit" }}>
        + Adicionar filtro
      </button>
    </div>
  );
}

// Sparkline temporal do desvio do segmento (Sessão 12) — série {bucket, rate}. Instabilidade
// fica visível sem estatística. Sem série (sem coluna temporal) não renderiza nada.
function SegmentSparkline({ series }) {
  const pts = (series || []).filter(p => p && p.rate != null);
  if (pts.length < 2) return null;
  const W = 96, H = 22, PAD = 2;
  const rates = pts.map(p => p.rate);
  const min = Math.min(...rates), max = Math.max(...rates);
  const span = max - min || 1;
  const step = pts.length > 1 ? (W - 2 * PAD) / (pts.length - 1) : 0;
  const coords = pts.map((p, i) => {
    const x = PAD + i * step;
    const y = H - PAD - ((p.rate - min) / span) * (H - 2 * PAD);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <polyline points={coords} fill="none" stroke="#6366f1" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// pp = pontos percentuais assinados (delta de taxa). `ratio` converte 0–1 → 0–100.
function fmtPP(v, ratio) {
  if (v == null || !isFinite(v)) return "—";
  const x = ratio ? v * 100 : v;
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)} pp`;
}

// ── SegmentFindingCard — card de oportunidade da Descoberta de Segmentos ──────────
// (Copiloto Sessão 11/12, UI sobre o SegmentModel). Puro: regra + métricas com referência/
// lift + decomposição + dispersão + selos + estabilidade (sparkline) + RECOMENDAÇÃO
// (delta validado + ✓ Aplicar como novo cenário / 🎯 Enviar ao Goal Seek / seleção p/
// combinação). asis_divergence/anomaly têm layout próprio (sem patch — só navegação).
function SegmentFindingCard({ finding, segmentModel, focused, onFocus, onViewDashboard, onViewFlow,
  onApply, onSendGoalSeek, selectable, selected, onToggleSelect }) {
  const rec = finding.recommendation;
  if (finding.code === 'asis_divergence' || finding.code === 'anomaly') {
    return <SegmentInfoCard finding={finding} focused={focused} onFocus={onFocus}
      onViewDashboard={onViewDashboard} onViewFlow={onViewFlow} />;
  }
  return <SegmentOpportunityCard finding={finding} segmentModel={segmentModel} focused={focused}
    onFocus={onFocus} onViewDashboard={onViewDashboard} onViewFlow={onViewFlow}
    rec={rec} onApply={onApply} onSendGoalSeek={onSendGoalSeek}
    selectable={selectable} selected={selected} onToggleSelect={onToggleSelect} />;
}

// asis_divergence / anomaly — achados informativos (sem recomendação de patch, DEC-SD-003).
function SegmentInfoCard({ finding, focused, onFocus, onViewDashboard, onViewFlow }) {
  const meta = SEGMENT_CODE_META[finding.code];
  const { metrics } = finding;
  const ruleText = segmentRuleText(finding.segment.conditions);
  const isAnomaly = finding.code === 'anomaly';
  return (
    <div id={`segfind-${finding.id}`} onClick={() => onFocus(finding.id)}
      style={{ padding: "12px 14px", borderRadius: 12, background: meta.bg,
        border: `1.5px solid ${focused ? meta.color : meta.border}`,
        boxShadow: focused ? `0 0 0 3px ${meta.color}22` : "none", cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: meta.color, textTransform: "uppercase", letterSpacing: .4 }}>{meta.label}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginTop: 2 }}>{ruleText || "—"}</div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{fmtQty(metrics.qty)}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>{(metrics.share * 100).toFixed(1)}% do escopo</div>
        </div>
      </div>
      {isAnomaly ? (
        <div style={{ fontSize: 12, color: "#475569", marginTop: 8, lineHeight: 1.5 }}>
          Métrica <b>{fmtPct(metrics.rate)}</b> — mediana do domínio <b>{fmtPct(metrics.median)}</b> (z robusto {metrics.z.toFixed(1)}{metrics.temporal ? ", por safra" : ""}).
          Inspecione a carga antes de otimizar sobre este valor.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Reprovado → Aprovado</div>
            <div style={{ fontSize: 12.5, color: "#1e293b" }}><b>{fmtQty(metrics.rToA)}</b> ({(metrics.rToAShare * 100).toFixed(0)}% do rToA global)</div>
          </div>
          <div>
            <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Aprovado → Reprovado</div>
            <div style={{ fontSize: 12.5, color: "#1e293b" }}><b>{fmtQty(metrics.aToR)}</b> ({(metrics.aToRShare * 100).toFixed(0)}% do aToR global)</div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 9 }} onClick={e => e.stopPropagation()}>
        <button onClick={() => onViewDashboard(finding)}
          style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #bfdbfe", background: "#eff6ff", color: "#1d4ed8", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>
          👁 Ver no Dashboard
        </button>
        <button onClick={() => onViewFlow(finding)}
          style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff", color: "#475569", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>
          🎯 Ver no fluxo
        </button>
      </div>
    </div>
  );
}

function SegmentOpportunityCard({ finding, segmentModel, focused, onFocus, onViewDashboard, onViewFlow,
  rec, onApply, onSendGoalSeek, selectable, selected, onToggleSelect }) {
  const meta = SEGMENT_CODE_META[finding.code] || SEGMENT_CODE_META.heterogeneous_block;
  const { metrics, explanation, priority } = finding;
  const isHet = finding.code === 'heterogeneous_block';
  const ruleText = segmentRuleText(finding.segment.conditions);
  const metricId = segmentModel?.metric?.id || 'inadReal';
  const primaryVal = metricId === 'inadInferida' ? metrics.inadInferida : metrics.inadReal;
  const refVal = metricId === 'inadInferida' ? metrics.refInadInferida : metrics.refInadReal;
  const metricLabel = segmentModel?.metric?.label || 'Inad. Real';
  const liftText = fmtLift(metrics.lift);
  const dispersionText = segmentDispersionText(explanation.dispersion);
  const contributions = isHet
    ? (explanation.contributions || [])
    : (explanation.contributions || []);
  const RAMP = ["#0369a1", "#0ea5e9", "#7dd3fc", "#bae6fd"];

  const confidenceBadge = isHet
    ? { icon: "🪓", text: "achado estrutural (IV)", color: "#7c3aed" }
    : (explanation.qValue != null && explanation.qValue <= 0.01)
      ? { icon: "✅", text: "muito significativo", color: "#16a34a" }
      : { icon: "✅", text: "significativo (FDR)", color: "#16a34a" };

  return (
    <div id={`segfind-${finding.id}`} onClick={() => onFocus(finding.id)}
      style={{ padding: "12px 14px", borderRadius: 12, background: meta.bg,
        border: `1.5px solid ${focused ? meta.color : meta.border}`,
        boxShadow: focused ? `0 0 0 3px ${meta.color}22` : "none",
        cursor: "pointer", transition: "box-shadow .15s, border-color .15s" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>{meta.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: meta.color, textTransform: "uppercase", letterSpacing: .4 }}>
            {meta.label}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginTop: 2, lineHeight: 1.4 }}>
            {ruleText || (segmentModel?.scope ? `Escopo: ${segmentModel.scope.label}` : "Base inteira")}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{fmtQty(metrics.qty)}</div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>{(metrics.share * 100).toFixed(1)}% do escopo</div>
        </div>
      </div>

      {segmentModel?.scope && (
        <div style={{ fontSize: 10.5, color: "#64748b", marginTop: 6, fontStyle: "italic" }}>
          Dentro da população que chega a "{segmentModel.scope.label}".
        </div>
      )}

      <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{metricLabel}</div>
          <div style={{ fontSize: 12.5, color: "#1e293b" }}>
            <b>{fmtPct(primaryVal)}</b>
            {refVal != null && <> vs. <b>{fmtPct(refVal)}</b> do restante{liftText ? ` (${liftText})` : ""}</>}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>Decisão atual</div>
          <div style={{ fontSize: 12.5, color: "#1e293b" }}>{SEGMENT_TERMINAL_LABEL[metrics.currentDecision] || (metrics.currentDecision === 'mixed' ? 'Misto' : 'Não decidido')}</div>
        </div>
      </div>

      {contributions.length > 0 && (
        <div style={{ marginTop: 9 }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", marginBottom: 3 }}>
            {isHet ? "Variáveis discriminantes" : "Decomposição do desvio"}
          </div>
          <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", gap: 1 }}>
            {contributions.map((c, i) => (
              <div key={i} title={`${c.col}${c.value != null ? ` = ${c.value}` : ""} — ${c.sharePct.toFixed(0)}%`}
                style={{ width: `${c.sharePct}%`, minWidth: 3, background: RAMP[i % RAMP.length] }} />
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            {contributions.map((c, i) => (
              <span key={i} style={{ fontSize: 10, color: "#64748b", display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: RAMP[i % RAMP.length], display: "inline-block" }} />
                {c.col}{c.value != null ? ` = ${c.value}` : ""} ({c.sharePct.toFixed(0)}%)
              </span>
            ))}
          </div>
        </div>
      )}

      {dispersionText && (
        <div style={{ marginTop: 8, padding: "6px 8px", borderRadius: 7, background: "rgba(255,255,255,.6)", fontSize: 10.5, color: "#475569", lineHeight: 1.5 }}>
          🔀 {dispersionText}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 9, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: confidenceBadge.color, display: "flex", alignItems: "center", gap: 3 }}>
          {confidenceBadge.icon} {confidenceBadge.text}
        </span>
        {explanation.stability
          ? <span style={{ fontSize: 10, fontWeight: 700, color: explanation.stability.holds ? "#16a34a" : "#b45309" }}>
              {explanation.stability.holds ? "✅ estável no tempo" : "⚠ instável no tempo"}
            </span>
          : <span style={{ fontSize: 10, color: "#94a3b8" }}>⏱ estabilidade não avaliável</span>}
        {finding.locked && (
          <span style={{ fontSize: 10, fontWeight: 700, color: "#b91c1c" }}>🔒 não acionável (nó travado)</span>
        )}
        {explanation.stabilitySeries && (
          <span title="Desvio do segmento por safra" style={{ marginLeft: 4 }}><SegmentSparkline series={explanation.stabilitySeries} /></span>
        )}
        <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: "auto" }}>score {priority.score.toFixed(1)}</span>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 8 }} onClick={e => e.stopPropagation()}>
        {!isHet && (
          <button onClick={() => onViewDashboard(finding)}
            style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #bfdbfe", background: "#eff6ff",
              color: "#1d4ed8", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>
            👁 Ver no Dashboard
          </button>
        )}
        <button onClick={() => onViewFlow(finding)}
          style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff",
            color: "#475569", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit" }}>
          🎯 Ver no fluxo
        </button>
      </div>

      {/* Recomendação (patch + delta validado por re-simulação — DEC-SD-003) */}
      {rec && (
        <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px dashed rgba(0,0,0,.1)" }} onClick={e => e.stopPropagation()}>
          {!rec.actionable ? (
            <div style={{ fontSize: 11, color: "#b91c1c", fontWeight: 600 }}>🔒 {rec.reason || "Recomendação não acionável."}</div>
          ) : (
            <>
              {rec.delta && (
                <div style={{ fontSize: 11.5, color: "#0f172a", marginBottom: 7, lineHeight: 1.5 }}>
                  <b>Impacto simulado</b> ({rec.kind === 'add_break' ? 'nova quebra' : 'movimento'}):
                  {" "}aprovação <b>{fmtPP(rec.delta.approvalDelta)}</b>,
                  {" "}{segmentModel?.metric?.id === 'inadInferida' ? 'inad. inf.' : 'inad. real'}
                  {" "}<b>{fmtPP(segmentModel?.metric?.id === 'inadInferida' ? rec.delta.inadInfDelta : rec.delta.inadRealDelta, true)}</b>
                  {" "}· <b>{fmtQty(rec.delta.movedQty)}</b> propostas
                </div>
              )}
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => onApply(finding)}
                  style={{ padding: "6px 12px", borderRadius: 7, border: "none", background: "#4f46e5", color: "#fff", cursor: "pointer", fontSize: 11.5, fontWeight: 700, fontFamily: "inherit" }}>
                  ✓ Aplicar como novo cenário
                </button>
                <button onClick={() => onSendGoalSeek(finding)}
                  style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid #c7d2fe", background: "#eef2ff", color: "#4338ca", cursor: "pointer", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit" }}>
                  🎯 Enviar ao Goal Seek
                </button>
                {selectable && (
                  <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#475569", cursor: "pointer", fontWeight: 600 }}>
                    <input type="checkbox" checked={!!selected} onChange={() => onToggleSelect(finding.id)} />
                    combinar
                  </label>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Contadores de descarte da varredura (diagnostics) — sempre visíveis: o assistente nunca
// "some" com candidatos silenciosamente (DEC-SD-002).
function DiagnosticsStrip({ diag }) {
  const d = diag.discarded || {};
  const parts = [
    d.lowVolume ? `${d.lowVolume} baixo volume` : null,
    d.notSignificant ? `${d.notSignificant} não significativo` : null,
    d.unstable ? `${d.unstable} instável` : null,
    d.duplicate ? `${d.duplicate} duplicado` : null,
    d.noOpportunity ? `${d.noOpportunity} sem oportunidade` : null,
  ].filter(Boolean);
  return (
    <div style={{ fontSize: 10.5, color: "#94a3b8", padding: "8px 10px", borderRadius: 8, background: "#f8fafc", border: "1px solid #f1f5f9" }}>
      🔬 {diag.candidatesTested} candidato{diag.candidatesTested !== 1 ? "s" : ""} testado{diag.candidatesTested !== 1 ? "s" : ""}
      {parts.length > 0 ? ` · descartados: ${parts.join(", ")}` : " · nenhum descarte"}
    </div>
  );
}

// Quadrante Volume × Risco (Recharts, DEC-AW-001) — cada achado é um ponto (x=volume,
// y=lift de risco, cor=tipo de achado, tamanho=score de prioridade). Clique foca o card
// (scroll + borda), mesmo padrão de "ir até o nó". Blocos heterogêneos (sem lift definido —
// o complemento do escopo inteiro é vazio) ficam em y=1 (neutro) por convenção.
function SegmentQuadrant({ findings, focusedId, onPick }) {
  const data = findings.map(f => ({
    id: f.id, code: f.code,
    qty: f.metrics.qty,
    lift: (f.metrics.lift != null && isFinite(f.metrics.lift)) ? f.metrics.lift : 1,
    score: f.priority.score,
  }));
  return (
    <div>
      <p style={{fontSize:10.5,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>
        Quadrante Volume × Risco — clique num ponto para focar o card
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <ScatterChart margin={{top:8,right:16,bottom:8,left:8}}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
          <XAxis type="number" dataKey="qty" name="Volume" tickFormatter={fmtQty} tick={{fontSize:10,fill:'#94a3b8'}}/>
          <YAxis type="number" dataKey="lift" name="Lift de risco" tick={{fontSize:10,fill:'#94a3b8'}}/>
          <ZAxis type="number" dataKey="score" range={[60,360]} name="Prioridade"/>
          <Tooltip cursor={{strokeDasharray:'3 3'}}/>
          <Scatter data={data} onClick={(p)=>onPick(p?.payload?.id ?? p?.id)} cursor="pointer">
            {data.map((d,i)=>(
              <Cell key={i} fill={(SEGMENT_CODE_META[d.code]||SEGMENT_CODE_META.heterogeneous_block).color}
                stroke={d.id===focusedId?'#1e293b':'none'} strokeWidth={d.id===focusedId?2:0}/>
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div style={{display:"flex",gap:12,marginTop:2,flexWrap:"wrap"}}>
        {Object.entries(SEGMENT_CODE_META).map(([code,m])=>(
          <span key={code} style={{fontSize:10,color:"#64748b",display:"flex",alignItems:"center",gap:4}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:m.color,display:"inline-block"}}/>
            {m.icon} {m.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Clusterização de Segmentos — apresentação (Execução Híbrida H8) ──────────────
// Paleta fixa por posição (clusters já vêm ordenados por volume desc do motor).
const CLUSTER_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#0ea5e9', '#a855f7',
  '#f97316', '#14b8a6', '#e11d48', '#84cc16', '#64748b', '#d946ef'];
const clusterColor = (id) => CLUSTER_COLORS[(parseInt(String(id).slice(1), 10) - 1 + CLUSTER_COLORS.length * 4) % CLUSTER_COLORS.length];

// Quadrante Volume × Risco (Recharts, DEC-AW-001) — cada cluster é um ponto (x=volume,
// y=risco em %, tamanho=share, cor=cluster). Clique foca o card (mesmo padrão do
// SegmentQuadrant). O risco exibido é a 1ª taxa disponível (inad. real → inferida).
function ClusterQuadrant({ clusters, focusedId, onPick }) {
  const data = clusters.map(c => ({
    id: c.id,
    qty: c.qty,
    risk: (c.inadReal ?? c.inadInferida ?? 0) * 100,
    share: (c.share ?? 0) * 100,
  }));
  return (
    <div>
      <p style={{fontSize:10.5,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>
        Quadrante Volume × Risco — clique num ponto para focar o card
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <ScatterChart margin={{top:8,right:16,bottom:8,left:8}}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
          <XAxis type="number" dataKey="qty" name="Volume" tickFormatter={fmtQty} tick={{fontSize:10,fill:'#94a3b8'}}/>
          <YAxis type="number" dataKey="risk" name="Inadimplência (%)" tickFormatter={(v)=>`${v.toFixed(1)}%`} tick={{fontSize:10,fill:'#94a3b8'}}/>
          <ZAxis type="number" dataKey="share" range={[80, 420]} name="Share"/>
          <Tooltip cursor={{strokeDasharray:'3 3'}} formatter={(v, name)=>name==='Volume'?fmtQty(v):`${Number(v).toFixed(2)}%`}/>
          <Scatter data={data} onClick={(p)=>onPick(p?.payload?.id ?? p?.id)} cursor="pointer">
            {data.map((d,i)=>(
              <Cell key={i} fill={clusterColor(d.id)}
                stroke={d.id===focusedId?'#1e293b':'none'} strokeWidth={d.id===focusedId?2:0}/>
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div style={{display:"flex",gap:12,marginTop:2,flexWrap:"wrap"}}>
        {clusters.map(c=>(
          <span key={c.id} style={{fontSize:10,color:"#64748b",display:"flex",alignItems:"center",gap:4}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:clusterColor(c.id),display:"inline-block"}}/>
            Cluster {String(c.id).slice(1)} · {fmtQty(c.qty)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Goal Seek Profundo — fronteira (Recharts, Execução Híbrida GS6, DEC-GS-006) ──────
// Eixo X = Inad. Real, eixo Y = Taxa de Aprovação — SÉRIE ÚNICA quando o usuário declara
// um teto de Inad. Inferida (ou no modo guloso clássico); FAMÍLIA DE CURVAS (uma por teto
// de Inad. Inferida) quando ele NÃO declara teto e o solver do sidecar devolve `curves`.
// Decisão explícita da wiki: nunca gráfico 3D (Recharts não suporta; um scatter 3D não
// seria legível) — a "fronteira 3D" vira séries num plano 2D, reusando a mesma paleta
// categórica de `ClusterQuadrant` (CLUSTER_COLORS). Cada ponto pode vir "achatado" (a
// fronteira já validada de GOAL_SEEK_RESULT, `predicted` boolean/ausente) ou "aninhado"
// (as curvas cruas do sidecar, `{level, ids, predicted:{...}}`) — `ptVal` normaliza os dois.
function GoalSeekFrontierChart({ frontier, curves }) {
  const ptVal = (p) => (p && typeof p.predicted === 'object' && p.predicted) ? p.predicted : (p || {});
  const toPts = (pts) => (pts || [])
    .map(p => ptVal(p))
    .filter(v => v.inadReal != null && v.approvalRate != null)
    .map(v => ({ inadReal: v.inadReal * 100, approvalRate: v.approvalRate }))
    .sort((a, b) => a.inadReal - b.inadReal);
  const series = (Array.isArray(curves) && curves.length > 0)
    ? curves.map((c, i) => ({
        key: `c${i}`, color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
        name: c.maxInadInf != null ? `teto inad.inf. ${fmtPct(c.maxInadInf)}` : 'sem teto',
        data: toPts(c.frontier),
      }))
    : [{ key: 'main', color: '#f59e0b', name: 'Fronteira', data: toPts(frontier) }];
  const usable = series.filter(s => s.data.length >= 2);
  if (usable.length === 0) return null;
  const isPredicted = Array.isArray(frontier) && frontier.some(p => p.predicted === true);
  return (
    <div>
      <p style={{fontSize:11,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>
        Fronteira (Aprovação × Inad. Real){isPredicted ? ' — prevista' : ''}
      </p>
      <ResponsiveContainer width="100%" height={usable.length > 1 ? 220 : 150}>
        <LineChart margin={{top:8,right:16,bottom:8,left:0}}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
          <XAxis type="number" dataKey="inadReal" name="Inad. Real" domain={['dataMin','dataMax']}
            tickFormatter={v=>`${v.toFixed(1)}%`} tick={{fontSize:10,fill:'#94a3b8'}}/>
          <YAxis type="number" dataKey="approvalRate" name="Aprovação"
            tickFormatter={v=>`${v.toFixed(0)}%`} tick={{fontSize:10,fill:'#94a3b8'}}/>
          <Tooltip formatter={(v)=>`${Number(v).toFixed(2)}%`}/>
          {usable.length > 1 && <Legend wrapperStyle={{fontSize:10}}/>}
          {usable.map(s => (
            <Line key={s.key} data={s.data} dataKey="approvalRate" name={s.name}
              stroke={s.color} strokeWidth={2} dot={{r:2.5}} isAnimationActive={false}/>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Card de um cluster — dados crus do ClusterModel: volume/share, taxas, perfil por
// dimensão (top valores por volume), mix de risco e centroide. Ação: 👁 Ver no Dashboard.
function ClusterCard({ cluster, model, focused, onFocus, onViewDashboard }) {
  const color = clusterColor(cluster.id);
  const num = String(cluster.id).slice(1);
  const MAX_VALS = 5;
  return (
    <div id={`clucard-${cluster.id}`} onClick={()=>onFocus(cluster.id)}
      style={{padding:"12px 14px",borderRadius:12,background:"#fafafa",
        border:`1.5px solid ${focused ? color : "#e2e8f0"}`,
        boxShadow:focused?`0 0 0 3px ${color}22`:"none",cursor:"pointer"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:8}}>
        <span style={{width:12,height:12,borderRadius:"50%",background:color,flexShrink:0,marginTop:3}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1e293b"}}>Cluster {num} <span style={{fontWeight:500,color:"#94a3b8"}}>· {cluster.size} grupo{cluster.size!==1?'s':''}</span></div>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div style={{fontSize:13,fontWeight:700,color:"#1e293b"}}>{fmtQty(cluster.qty)}</div>
          <div style={{fontSize:10,color:"#94a3b8"}}>{cluster.share!=null?`${(cluster.share*100).toFixed(1)}% do total`:"—"}</div>
        </div>
      </div>
      <div style={{display:"flex",gap:14,flexWrap:"wrap",marginTop:8,fontSize:11.5,color:"#475569"}}>
        <span>Aprovação AS IS: <b style={{color:"#1e293b"}}>{fmtPct(cluster.approvalRate)}</b></span>
        <span>Inad. Real: <b style={{color:cluster.inadReal!=null&&cluster.inadReal>0.05?"#dc2626":"#1e293b"}}>{fmtPct(cluster.inadReal)}</b></span>
        <span>Inad. Inferida: <b style={{color:cluster.inadInferida!=null&&cluster.inadInferida>0.05?"#dc2626":"#1e293b"}}>{fmtPct(cluster.inadInferida)}</b></span>
      </div>
      <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:5}}>
        {cluster.dims.map(dm=>(
          <div key={dm.col} style={{display:"flex",alignItems:"baseline",gap:6,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.4,flexShrink:0}}>{dm.col}:</span>
            {dm.values.slice(0,MAX_VALS).map(v=>(
              <span key={v.value} title={`${fmtQty(v.qty)} propostas${v.share!=null?` · ${(v.share*100).toFixed(1)}% do cluster`:''}`}
                style={{fontSize:10.5,padding:"1px 7px",borderRadius:10,background:"#fff",border:"1px solid #e2e8f0",color:"#475569"}}>
                {v.value === '' ? '(vazio)' : v.value}{v.share!=null?` ${(v.share*100).toFixed(0)}%`:''}
              </span>
            ))}
            {dm.values.length>MAX_VALS && (
              <span style={{fontSize:10,color:"#94a3b8"}}>+{dm.values.length-MAX_VALS} valor{dm.values.length-MAX_VALS!==1?'es':''}</span>
            )}
          </div>
        ))}
        {cluster.mix && cluster.mix.length>0 && (
          <div style={{display:"flex",alignItems:"baseline",gap:6,flexWrap:"wrap"}}>
            <span style={{fontSize:10,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.4,flexShrink:0}}>Mix de risco:</span>
            <span style={{fontSize:10.5,color:"#64748b"}}>
              {cluster.mix.slice(0,4).map(mx=>`${mx.value === '' ? '(vazio)' : mx.value} ${(mx.share!=null?mx.share*100:0).toFixed(0)}%`).join(' · ')}
              {cluster.mix.length>4?` · +${cluster.mix.length-4}`:''}
            </span>
          </div>
        )}
      </div>
      <div style={{display:"flex",gap:6,marginTop:9,paddingTop:8,borderTop:"1px dashed #e2e8f0",alignItems:"center",flexWrap:"wrap"}}>
        <span style={{fontSize:10,color:"#cbd5e1",flex:1}} title={`Centroide: ${model.features.map(f=>`${f.label} ${fmtPct(cluster.centroid[f.id])}`).join(' · ')}`}>
          ⌖ {model.features.map(f=>`${f.label.replace(' (AS IS)','')} ${fmtPct(cluster.centroid[f.id])}`).join(' · ')}
        </span>
        <button onClick={(e)=>{e.stopPropagation();onViewDashboard(cluster);}}
          title="Filtrar o Dashboard inteiro para a população deste cluster (um FilterCard por dimensão)"
          style={{padding:"4px 10px",borderRadius:7,border:"1px solid #c7d2fe",background:"#eef2ff",color:"#4338ca",
            cursor:"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit",flexShrink:0}}>
          👁 Ver no Dashboard
        </button>
      </div>
    </div>
  );
}

// resolveKpiScenarios foi extraída para ./analytics.js (lote C4) e importada no topo.

// ── KpiCard — indicador pontual comparando dois cenários (A vs B, DEC-AW-008) ──
function KpiCard({ analyticsDataset, metricId, kpiA, kpiB, onChange }) {
  const kpi = useMemo(() => {
    if (!analyticsDataset) return null;
    const { scenarios, metrics } = analyticsDataset;
    const md = metrics.find(m => m.id === metricId) || metrics[0];
    if (!md) return null;
    const { a, b } = resolveKpiScenarios(scenarios, kpiA, kpiB);
    return {
      metricDef: md,
      aScen: a, bScen: b,
      aVal: a ? computeWidgetMetric(analyticsDataset, null, md.id, a.decisionCol) : null,
      bVal: b ? computeWidgetMetric(analyticsDataset, null, md.id, b.decisionCol) : null,
    };
  }, [analyticsDataset, metricId, kpiA, kpiB]);

  if (!kpi) return <AWEmptyState icon="🔢" title="Escolha a métrica" hint="Selecione uma métrica para o indicador." />;
  const { metricDef, aScen, bScen, aVal, bVal } = kpi;
  const scenarios = analyticsDataset.scenarios;
  const unit = metricDef.unit;
  let deltaTxt = null, deltaColor = "#94a3b8", arrow = "→";
  if (bVal != null && aVal != null) {
    const delta = bVal - aVal;
    const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
    const mag = Math.abs(delta);
    deltaTxt = unit === "qty" ? `${sign}${fmtQty(mag)}` : `${sign}${mag.toFixed(2)} pp`;
    arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "→";
    if (delta !== 0) {
      const good = GOOD_WHEN_LOWER.has(metricDef.id) ? delta < 0 : delta > 0;
      deltaColor = good ? "#16a34a" : "#dc2626";
    }
  }

  const selStyle = { width: "100%", padding: "4px 6px", borderRadius: 7, border: "1px solid #e2e8f0",
    background: "#f8fafc", fontSize: 11.5, color: "#1e293b", fontFamily: "inherit", outline: "none", cursor: "pointer", boxSizing: "border-box" };
  const labelStyle = { fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3, display: "block" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 240 }}>
      {/* Seletores Baseline (A) e Comparação (B) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 4, flexShrink: 0 }}>
        <div>
          <span style={labelStyle}>Baseline (A)</span>
          <select value={aScen?.id ?? ""} onChange={(e) => onChange && onChange({ kpiA: e.target.value })} style={selStyle}>
            {scenarios.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </div>
        <div>
          <span style={labelStyle}>Comparação (B)</span>
          <select value={bScen?.id ?? ""} onChange={(e) => onChange && onChange({ kpiB: e.target.value })} style={selStyle}>
            {scenarios.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        </div>
      </div>

      {/* Indicador — número grande é B (Comparação) */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "14px 16px 18px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>{metricDef.label}</div>
        <div style={{ fontSize: 52, fontWeight: 700, color: "#1e293b", lineHeight: 1 }}>{fmtMetricVal(bVal, unit)}</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 10, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bScen?.nome ?? "—"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, flexWrap: "wrap", justifyContent: "center" }}>
          <span style={{ fontSize: 13, color: "#64748b" }}>{aScen?.nome ?? "—"} <strong style={{ color: "#475569" }}>{fmtMetricVal(aVal, unit)}</strong></span>
          {deltaTxt && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 700, color: deltaColor,
              background: deltaColor === "#94a3b8" ? "#f1f5f9" : `${deltaColor}14`, padding: "3px 9px", borderRadius: 20 }}>
              {arrow} {deltaTxt}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── AnalyticsWidget — um gráfico configurável ─────────────────────────────────
function AnalyticsWidget({ widget, analyticsDataset, pageFilters = [], onConfigChange, onTypeChange, onDelete, onDuplicate, onDragStart, onResizeStart }) {
  const cfg = widget.config;
  const type = widget.type || "line";
  const isKpi = type === "kpi";
  // Dataset filtrado: filtro de página AND filtro do visual (o visual recorta em cima da página).
  const filteredDataset = useMemo(() => applyFiltersToDataset(analyticsDataset, pageFilters, cfg.filters),
    [analyticsDataset, pageFilters, cfg.filters]);
  const pivot = useMemo(() => isKpi ? { state: "kpi" } : pivotWidget(filteredDataset, cfg),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredDataset, isKpi, cfg.xDimension, cfg.metric, cfg.serieBy, cfg.activeScenarios]);

  const [seriesStylesOpen, setSeriesStylesOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const widgetFilterCount = (cfg.filters || []).filter(c => c.dim).length;
  const styles = cfg.seriesStyles || {};
  // Aplica overrides de cor sem precisar modificar pivotWidget.
  const effectiveSeries = pivot.state === "ok"
    ? pivot.series.map(sd => { const ov = styles[sd.key]; return ov?.color ? { ...sd, color: ov.color } : sd; })
    : [];

  // Barra 100% empilhada: normaliza cada bucket do eixo X para somar 100%.
  const stacked100 = useMemo(() => {
    if (type !== "bar100" || pivot.state !== "ok") return null;
    return pivot.data.map((row) => {
      let sum = 0;
      for (const sd of pivot.series) { const v = row[sd.label]; if (typeof v === "number") sum += v; }
      const out = { x: row.x };
      for (const sd of pivot.series) {
        const v = row[sd.label];
        out[sd.label] = (sum > 0 && typeof v === "number") ? (v / sum) * 100 : null;
      }
      return out;
    });
  }, [type, pivot]);

  const dims = analyticsDataset?.dimensions || [];
  const temporalCols = new Set(analyticsDataset?.temporalColumns || []);
  const groupedCols = new Set(analyticsDataset?.groupedDimensions || []);
  const metrics = analyticsDataset?.metrics || [];
  const allScenarios = analyticsDataset?.scenarios || [];
  // Reais primeiro (temporais antes), depois as derivadas (agrupamentos) ao fim.
  const orderedDims = [...dims].sort((a, b) => {
    const ga = groupedCols.has(a), gb = groupedCols.has(b);
    if (ga !== gb) return ga ? 1 : -1;
    const ta = temporalCols.has(a), tb = temporalCols.has(b);
    if (ta !== tb) return ta ? -1 : 1;
    return a.localeCompare(b, "pt-BR");
  });
  const dimLabel = (d) => groupedCols.has(d) ? `🧩 ${d}` : (temporalCols.has(d) ? `⏱ ${d}` : d);

  const xIsCenario = cfg.xDimension === XDIM_CENARIO;
  const xOptions = [
    { value: "", label: "— escolher —" },
    { value: XDIM_CENARIO, label: "🎬 Cenários (abas)" },
    ...orderedDims.map(d => ({ value: d, label: dimLabel(d) })),
  ];
  const metricOptions = metrics.map(m => ({ value: m.id, label: m.label }));
  const serieOptions = xIsCenario
    ? [
      { value: SERIE_NONE, label: "Nenhuma (linha única)" },
      ...orderedDims.map(d => ({ value: d, label: dimLabel(d) })),
    ]
    : [
      { value: SERIE_CENARIO, label: "Cenário (todas as abas)" },
      { value: SERIE_NONE, label: "Nenhuma (linha única)" },
      ...orderedDims.map(d => ({ value: d, label: dimLabel(d) })),
    ];

  const set = (patch) => onConfigChange(widget.id, patch);
  const isPct = pivot.metricDef?.unit !== "qty";
  const showLabels = cfg.showLabels ?? false;

  // Auto Y-axis domain: computa min/max dos dados reais com folga estilo Excel.
  const autoYDomain = useMemo(() => {
    if (pivot.state !== "ok" || type === "bar100") return null;
    let minVal = Infinity, maxVal = -Infinity;
    for (const row of pivot.data) {
      for (const sd of pivot.series) {
        const v = row[sd.label];
        if (typeof v === "number" && !isNaN(v)) { minVal = Math.min(minVal, v); maxVal = Math.max(maxVal, v); }
      }
    }
    if (minVal === Infinity) return null;
    const range = maxVal - minVal;
    const pad = range === 0 ? Math.max(maxVal * 0.1, 1) : range * 0.1;
    return [Math.max(0, Math.floor(minVal - pad)), Math.ceil(maxVal + pad)];
  }, [pivot.state, pivot.data, pivot.series, type]);

  const yDomain = (() => {
    if (type === "bar100") return [0, 100];
    const hasMin = cfg.yMin !== null && cfg.yMin !== undefined && cfg.yMin !== "";
    const hasMax = cfg.yMax !== null && cfg.yMax !== undefined && cfg.yMax !== "";
    const fallback = autoYDomain || (isPct ? [0, 100] : ["auto", "auto"]);
    return [hasMin ? Number(cfg.yMin) : fallback[0], hasMax ? Number(cfg.yMax) : fallback[1]];
  })();
  const setSeriesStyle = (key, patch) => {
    const current = cfg.seriesStyles || {};
    set({ seriesStyles: { ...current, [key]: { ...(current[key] || {}), ...patch } } });
  };

  return (
    <div style={{ position: "relative", background: "#fff", borderRadius: 14, border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,.04)", padding: "14px 16px 12px", display: "flex", flexDirection: "column", height: "100%", boxSizing: "border-box" }}>
      {/* Título editável + seletor de tipo + remover */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexShrink: 0 }}>
        {onDragStart && <div onMouseDown={(e) => { e.stopPropagation(); onDragStart(e); }} style={{ cursor: "grab", color: "#cbd5e1", fontSize: 15, userSelect: "none", flexShrink: 0, lineHeight: 1 }}>⠿</div>}
        <input value={cfg.title} onChange={(e) => set({ title: e.target.value })}
          placeholder="Título do gráfico"
          style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#1e293b", border: "1px solid transparent",
            borderRadius: 7, padding: "4px 7px", background: "transparent", fontFamily: "inherit", outline: "none", minWidth: 0 }}
          onFocus={(e) => { e.target.style.borderColor = "#e2e8f0"; e.target.style.background = "#f8fafc"; }}
          onBlur={(e) => { e.target.style.borderColor = "transparent"; e.target.style.background = "transparent"; }} />
        <div style={{ display: "flex", flexShrink: 0, gap: 2, padding: 2, background: "#f1f5f9", borderRadius: 9 }}>
          {CHART_TYPES.map((ct) => (
            <button key={ct.id} onClick={() => onTypeChange(widget.id, ct.id)} title={ct.label}
              style={{ width: 30, height: 26, borderRadius: 7, border: "none", cursor: "pointer", fontSize: 13, lineHeight: 1,
                background: type === ct.id ? "#fff" : "transparent", boxShadow: type === ct.id ? "0 1px 2px rgba(0,0,0,.1)" : "none",
                opacity: type === ct.id ? 1 : 0.55 }}>{ct.icon}</button>
          ))}
        </div>
        {!isKpi && (
          <>
            <button onClick={() => set({ showLabels: !showLabels })} title={showLabels ? "Ocultar rótulos" : "Mostrar rótulos nos pontos"}
              style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, border: `1px solid ${showLabels ? "#0891b2" : "#e2e8f0"}`,
                background: showLabels ? "#ecfeff" : "#fff", color: showLabels ? "#0891b2" : "#94a3b8",
                cursor: "pointer", fontSize: 12, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>Aa</button>
            {pivot.state === "ok" && (
              <button onClick={() => setSeriesStylesOpen(v => !v)} title="Personalizar séries (cor, estilo, espessura)"
                style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, border: `1px solid ${seriesStylesOpen ? "#7c3aed" : "#e2e8f0"}`,
                  background: seriesStylesOpen ? "#f5f3ff" : "#fff", color: seriesStylesOpen ? "#7c3aed" : "#94a3b8",
                  cursor: "pointer", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>🎨</button>
            )}
          </>
        )}
        <button onClick={() => setFiltersOpen(v => !v)} title="Filtros deste visual (combinam com os filtros da página)"
          style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, position: "relative",
            border: `1px solid ${filtersOpen ? "#2563eb" : (widgetFilterCount > 0 ? "#93c5fd" : "#e2e8f0")}`,
            background: filtersOpen || widgetFilterCount > 0 ? "#eff6ff" : "#fff",
            color: filtersOpen || widgetFilterCount > 0 ? "#2563eb" : "#94a3b8",
            cursor: "pointer", fontSize: 12, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          🔎
          {widgetFilterCount > 0 && (
            <span style={{ position: "absolute", top: -4, right: -4, background: "#2563eb", color: "#fff", borderRadius: 8,
              fontSize: 8.5, fontWeight: 700, minWidth: 13, height: 13, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 2px" }}>
              {widgetFilterCount}
            </span>
          )}
        </button>
        {onDuplicate && (
          <button onClick={() => onDuplicate(widget.id)} title="Duplicar gráfico (cria uma cópia independente com as mesmas configurações)"
            style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff",
              color: "#64748b", cursor: "pointer", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>⧉</button>
        )}
        <button onClick={() => onDelete(widget.id)} title="Remover gráfico"
          style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, border: "1px solid #fecaca", background: "#fef2f2",
            color: "#dc2626", cursor: "pointer", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
      </div>

      {/* Barra de configuração — poços de campo (KPI usa apenas a métrica) */}
      <div style={{ display: "grid", gridTemplateColumns: isKpi ? "1fr" : "1fr 1fr 1fr", gap: 10, marginBottom: 14, padding: "10px 12px", background: "#f8fafc", borderRadius: 10, border: "1px solid #f1f5f9", flexShrink: 0 }}>
        {!isKpi && (
          <FieldWell icon="📅" label="Eixo X" accept="dim" value={cfg.xDimension} displayValue={cfg.xDimension}
            options={xOptions} onChange={(v) => {
              const patch = { xDimension: v };
              if (v === XDIM_CENARIO && (cfg.serieBy == null || cfg.serieBy === SERIE_CENARIO)) {
                patch.serieBy = SERIE_NONE;
              }
              set(patch);
            }} />
        )}
        <FieldWell icon="Σ" label="Métrica" accept="metric" value={cfg.metric} displayValue={cfg.metric}
          options={metricOptions} onChange={(v) => set({ metric: v || metrics[0]?.id })} />
        {!isKpi && (
          <FieldWell icon="🎨" label={type === "bar100" ? "Composição" : "Série"} accept="dim" value={cfg.serieBy} displayValue
            options={serieOptions} onChange={(v) => set({ serieBy: v || SERIE_CENARIO })} />
        )}
      </div>

      {/* Controles de Eixo Y — min/max personalizáveis */}
      {!isKpi && type !== "bar100" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "#64748b", fontWeight: 500, letterSpacing: 0.2 }}>Eixo Y:</span>
          {[["Mín", "yMin"], ["Máx", "yMax"]].map(([label, key]) => {
            const val = cfg[key];
            const hasVal = val !== null && val !== undefined && val !== "";
            return (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#64748b" }}>
                {label}
                <input
                  type="number"
                  placeholder="auto"
                  value={hasVal ? val : ""}
                  onChange={(e) => set({ [key]: e.target.value === "" ? null : Number(e.target.value) })}
                  style={{ width: 64, padding: "3px 6px", borderRadius: 6, border: `1px solid ${hasVal ? "#86efac" : "#e2e8f0"}`,
                    fontSize: 11, fontFamily: "inherit", textAlign: "right", outline: "none",
                    background: hasVal ? "#f0fdf4" : "#f8fafc", color: "#1e293b" }}
                />
              </label>
            );
          })}
          {(cfg.yMin !== null && cfg.yMin !== undefined && cfg.yMin !== "" || cfg.yMax !== null && cfg.yMax !== undefined && cfg.yMax !== "") && (
            <button onClick={() => set({ yMin: null, yMax: null })} title="Redefinir para automático"
              style={{ fontSize: 10, padding: "2px 8px", borderRadius: 5, border: "1px solid #e2e8f0",
                background: "#f8fafc", color: "#94a3b8", cursor: "pointer", fontFamily: "inherit" }}>
              ↺ auto
            </button>
          )}
        </div>
      )}

      {/* Chips de cenário — visíveis quando a série ou o eixo X está em modo Cenário */}
      {!isKpi && allScenarios.length > 1 && (xIsCenario || cfg.serieBy == null || cfg.serieBy === SERIE_CENARIO) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10, flexShrink: 0 }}>
          {allScenarios.map((s) => {
            const active = cfg.activeScenarios == null || cfg.activeScenarios.includes(s.id);
            return (
              <span key={s.id} onClick={() => {
                const allIds = allScenarios.map(x => x.id);
                const current = cfg.activeScenarios ?? allIds;
                if (active && current.length <= 1) return;
                const next = active ? current.filter(x => x !== s.id) : [...current, s.id];
                set({ activeScenarios: next.length === allIds.length ? null : next });
              }} style={{
                padding: "3px 10px", borderRadius: 12, fontSize: 11, cursor: "pointer",
                border: `1px solid ${active ? "#0891b2" : "#e2e8f0"}`,
                background: active ? "#ecfeff" : "#fff",
                color: active ? "#0891b2" : "#94a3b8",
                transition: "all .1s", userSelect: "none",
                fontWeight: active ? 500 : 400,
              }}>
                {s.nome}
              </span>
            );
          })}
        </div>
      )}

      {/* Painel de personalização de séries */}
      {seriesStylesOpen && pivot.state === "ok" && (
        <SeriesStylePanel series={effectiveSeries} isLine={type === "line"} seriesStyles={styles} onChange={setSeriesStyle} />
      )}

      {/* Painel de filtros do visual — recorta em cima do que já chega filtrado pela página */}
      {filtersOpen && (
        <div style={{ background: "#fafafa", borderRadius: 9, border: "1px solid #e8ecf0", padding: "10px 12px", marginBottom: 10, flexShrink: 0, maxHeight: 320, overflowY: "auto" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.7 }}>Filtros deste visual</div>
          <FilterCardsEditor cards={cfg.filters || []} dataset={analyticsDataset} onChange={(next) => set({ filters: next })} />
        </div>
      )}

      {/* Gráfico ou estado vazio */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {isKpi ? (
          <KpiCard analyticsDataset={filteredDataset} metricId={cfg.metric}
            kpiA={cfg.kpiA} kpiB={cfg.kpiB} onChange={set} />
        ) : pivot.state === "no_x" ? (
          <AWEmptyState icon="📐" title="Escolha o Eixo X"
            hint="Arraste uma dimensão para o campo Eixo X (temporais ⏱ habilitam evolução cronológica)." />
        ) : pivot.state === "empty" ? (
          <AWEmptyState icon="📉" title="Sem valores para agrupar"
            hint="A dimensão escolhida não tem valores preenchidos nas linhas da base." />
        ) : pivot.state === "ok" ? (
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ width: "100%", flex: 1, minHeight: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                {type === "line" ? (
                  <LineChart data={pivot.data} margin={{ top: showLabels ? 22 : 8, right: 24, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="x" tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" />
                    <YAxis tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1"
                      unit={isPct ? "%" : ""} domain={yDomain} />
                    <Tooltip formatter={(v) => fmtMetricVal(v, pivot.metricDef.unit)}
                      contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12, fontFamily: "inherit" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {effectiveSeries.map((sd, si) => {
                      const st = styles[sd.key] || {};
                      const strokeW = st.strokeWidth ?? 2.5;
                      const strokeDash = st.strokeDasharray && st.strokeDasharray !== "0" ? st.strokeDasharray : undefined;
                      return (
                        <Line key={sd.key} type="monotone" dataKey={sd.label}
                          stroke={sd.color} strokeWidth={strokeW} strokeDasharray={strokeDash}
                          dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls>
                          {showLabels && <LabelList dataKey={sd.label} content={(props) => <ChartLineLabel {...props} color={sd.color} metricDef={pivot.metricDef} seriesIndex={si} allData={pivot.data} seriesKey={sd.label} />} />}
                        </Line>
                      );
                    })}
                  </LineChart>
                ) : (
                  <BarChart data={type === "bar100" ? stacked100 : pivot.data} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="x" tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1" />
                    <YAxis tick={{ fontSize: 11, fill: "#64748b" }} stroke="#cbd5e1"
                      unit={type === "bar100" ? "%" : (isPct ? "%" : "")}
                      domain={yDomain} />
                    <Tooltip formatter={(v) => type === "bar100" ? (v == null ? "N/A" : `${v.toFixed(1)}%`) : fmtMetricVal(v, pivot.metricDef.unit)}
                      contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12, fontFamily: "inherit" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {effectiveSeries.map((sd) => (
                      <Bar key={sd.key} dataKey={sd.label} fill={sd.color} radius={type === "bar100" ? 0 : [3, 3, 0, 0]}
                        stackId={type === "bar100" ? "s" : undefined}>
                        {showLabels && <LabelList dataKey={sd.label} content={(props) => <ChartBarLabel {...props} color={sd.color} metricDef={pivot.metricDef} isBar100={type === "bar100"} />} />}
                      </Bar>
                    ))}
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
            {pivot.truncated && (
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, paddingLeft: 6, flexShrink: 0 }}>
                Mostrando as primeiras {MAX_SERIES} séries.
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Resize handles — transparentes, ativam cursor e drag */}
      {onResizeStart && ['n','s','e','w','ne','nw','se','sw'].map(dir => {
        const H = 8, C = 16;
        const cur = { n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize', ne:'ne-resize', nw:'nw-resize', se:'se-resize', sw:'sw-resize' };
        const pos = { n:{top:0,left:C,right:C,height:H}, s:{bottom:0,left:C,right:C,height:H}, e:{right:0,top:C,bottom:C,width:H}, w:{left:0,top:C,bottom:C,width:H}, ne:{top:0,right:0,width:C,height:C}, nw:{top:0,left:0,width:C,height:C}, se:{bottom:0,right:0,width:C,height:C}, sw:{bottom:0,left:0,width:C,height:C} }[dir];
        return <div key={dir} onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, dir); }} style={{ position:"absolute", zIndex:10, cursor:cur[dir], ...pos }} />;
      })}
    </div>
  );
}

// ── TextWidget — caixa de texto livre para anotar análises e conclusões ───────
// Componente de texto (não é gráfico): título + área de texto livre com correção
// automática (spellcheck nativo do navegador — sublinha erros e sugere correções no
// menu de contexto). Vive no mesmo `analyticsLayout` dos gráficos (persistido no
// projeto e na sessionStorage), diferenciado por `type: "text"`.
function TextWidget({ widget, onConfigChange, onDelete, onDuplicate, onDragStart, onResizeStart }) {
  const cfg = widget.config || {};
  const set = (patch) => onConfigChange(widget.id, patch);
  const spell = cfg.spellCheck ?? true;
  return (
    <div style={{ position: "relative", background: "#fffef7", borderRadius: 14, border: "1px solid #fde68a",
      boxShadow: "0 1px 3px rgba(0,0,0,.04)", padding: "12px 14px 12px", display: "flex", flexDirection: "column",
      height: "100%", boxSizing: "border-box" }}>
      {/* Cabeçalho: arrasto + título + correção + duplicar + remover */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexShrink: 0 }}>
        {onDragStart && <div onMouseDown={(e) => { e.stopPropagation(); onDragStart(e); }} style={{ cursor: "grab", color: "#d6b45a", fontSize: 15, userSelect: "none", flexShrink: 0, lineHeight: 1 }}>⠿</div>}
        <span style={{ fontSize: 14, flexShrink: 0, lineHeight: 1 }}>📝</span>
        <input value={cfg.title ?? ""} onChange={(e) => set({ title: e.target.value })}
          placeholder="Título da anotação"
          style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#78350f", border: "1px solid transparent",
            borderRadius: 7, padding: "4px 7px", background: "transparent", fontFamily: "inherit", outline: "none", minWidth: 0 }}
          onFocus={(e) => { e.target.style.borderColor = "#fde68a"; e.target.style.background = "#fffbeb"; }}
          onBlur={(e) => { e.target.style.borderColor = "transparent"; e.target.style.background = "transparent"; }} />
        <button onClick={() => set({ spellCheck: !spell })} title={spell ? "Correção automática ligada (clique p/ desligar)" : "Correção automática desligada (clique p/ ligar)"}
          style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, border: `1px solid ${spell ? "#f59e0b" : "#e2e8f0"}`,
            background: spell ? "#fef3c7" : "#fff", color: spell ? "#b45309" : "#94a3b8",
            cursor: "pointer", fontSize: 11, fontWeight: 700, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>ABC</button>
        {onDuplicate && (
          <button onClick={() => onDuplicate(widget.id)} title="Duplicar anotação"
            style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, border: "1px solid #fde68a", background: "#fffbeb",
              color: "#b45309", cursor: "pointer", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>⧉</button>
        )}
        <button onClick={() => onDelete(widget.id)} title="Remover anotação"
          style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, border: "1px solid #fecaca", background: "#fef2f2",
            color: "#dc2626", cursor: "pointer", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
      </div>

      {/* Área de texto livre — correção automática via spellcheck nativo */}
      <textarea value={cfg.text ?? ""} onChange={(e) => set({ text: e.target.value })}
        placeholder="Escreva aqui suas análises e conclusões…"
        spellCheck={spell} autoCorrect={spell ? "on" : "off"} autoCapitalize="sentences" lang="pt-BR"
        style={{ flex: 1, minHeight: 0, width: "100%", resize: "none", boxSizing: "border-box",
          border: "1px solid #fef3c7", borderRadius: 9, background: "#fff", padding: "10px 12px",
          fontSize: 13.5, lineHeight: 1.55, color: "#334155", fontFamily: "inherit", outline: "none" }}
        onFocus={(e) => { e.target.style.borderColor = "#fcd34d"; }}
        onBlur={(e) => { e.target.style.borderColor = "#fef3c7"; }} />

      {/* Resize handles — transparentes, ativam cursor e drag */}
      {onResizeStart && ['n','s','e','w','ne','nw','se','sw'].map(dir => {
        const H = 8, C = 16;
        const cur = { n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize', ne:'ne-resize', nw:'nw-resize', se:'se-resize', sw:'sw-resize' };
        const pos = { n:{top:0,left:C,right:C,height:H}, s:{bottom:0,left:C,right:C,height:H}, e:{right:0,top:C,bottom:C,width:H}, w:{left:0,top:C,bottom:C,width:H}, ne:{top:0,right:0,width:C,height:C}, nw:{top:0,left:0,width:C,height:C}, se:{bottom:0,right:0,width:C,height:C}, sw:{bottom:0,left:0,width:C,height:C} }[dir];
        return <div key={dir} onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, dir); }} style={{ position:"absolute", zIndex:10, cursor:cur[dir], ...pos }} />;
      })}
    </div>
  );
}

// ── Explorar a Base — widgets do layout default (Épico EB, EB2) ───────────────
// docs/wiki/Epicos-ExplorarBase.md (DEC-EB-001..012). Consomem o BaseProfileModel
// (não o analyticsDataset — pipeline próprio, DEC-EB-002/003). Mesmo chassi de widget
// do Dashboard (título editável + duplicar + remover + arrastar + redimensionar,
// DEC-EB-005), corpo próprio por tipo: insight/ivrank/varprofile/quality/stability.

const EXPLORE_SEVERITY_META = {
  good:   { bg: "#f0fdf4", border: "#bbf7d0", icon: "✅" },
  warn:   { bg: "#fffbeb", border: "#fde68a", icon: "⚠️" },
  info:   { bg: "#f1f5f9", border: "#e2e8f0", icon: "ℹ️" },
  danger: { bg: "#fef2f2", border: "#fecaca", icon: "🔥" },
};
const EXPLORE_FLAG_META = {
  suspect_score:    { icon: "🎯", title: "Parece score/rating já em uso" },
  suspect_temporal: { icon: "🕐", title: "Parece coluna de safra/cohort" },
  low_coverage:     { icon: "⚠️", title: "Cobertura baixa" },
  dominant_value:   { icon: "🏔", title: "Categoria dominante" },
  high_cardinality: { icon: "🔀", title: "Alta cardinalidade" },
  unstable_psi:     { icon: "📉", title: "Instável no tempo (PSI)" },
};

// Casca comum (título editável + AUTO badge + duplicar/remover/arrastar/redimensionar) —
// mesmo padrão de AnalyticsWidget/TextWidget. `data-explore-capture` marca o corpo para
// a exportação em PDF (captura genérica de DOM, sem branch por tipo).
function ExploreWidgetShell({ widget, accent, topic, onConfigChange, onDelete, onDuplicate, onDragStart, onResizeStart, children }) {
  const cfg = widget.config || {};
  const set = (patch) => onConfigChange(widget.id, patch);
  const [howOpen, setHowOpen] = useState(false);
  return (
    <div style={{ position: "relative", background: "#fff", borderRadius: 14, border: `1px solid ${accent || "#e2e8f0"}`,
      boxShadow: "0 1px 3px rgba(0,0,0,.04)", padding: "14px 16px 12px", display: "flex", flexDirection: "column",
      height: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexShrink: 0 }}>
        {onDragStart && <div onMouseDown={(e) => { e.stopPropagation(); onDragStart(e); }} style={{ cursor: "grab", color: "#cbd5e1", fontSize: 15, userSelect: "none", flexShrink: 0, lineHeight: 1 }}>⠿</div>}
        <input value={cfg.title || ""} onChange={(e) => set({ title: e.target.value })} placeholder="Título"
          style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#1e293b", border: "1px solid transparent",
            borderRadius: 7, padding: "4px 7px", background: "transparent", fontFamily: "inherit", outline: "none", minWidth: 0 }}
          onFocus={(e) => { e.target.style.borderColor = "#e2e8f0"; e.target.style.background = "#f8fafc"; }}
          onBlur={(e) => { e.target.style.borderColor = "transparent"; e.target.style.background = "transparent"; }} />
        {widget.origin === "auto" && (
          <span title="Gerado automaticamente pela análise — editar promove este card a seu (não é recriado ao Regenerar)"
            style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: "#94a3b8", background: "#f1f5f9", borderRadius: 6, padding: "2px 6px", letterSpacing: 0.3 }}>AUTO</span>
        )}
        <button onClick={() => setHowOpen(v => !v)} title="Como ler este card"
          aria-expanded={howOpen}
          style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, border: `1px solid ${howOpen ? "#c7d2fe" : "#e2e8f0"}`,
            background: howOpen ? "#eef2ff" : "#fff", color: howOpen ? "#4338ca" : "#64748b", cursor: "pointer", fontSize: 13,
            lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>ⓘ</button>
        {onDuplicate && (
          <button onClick={() => onDuplicate(widget.id)} title="Duplicar"
            style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, border: "1px solid #e2e8f0", background: "#fff",
              color: "#64748b", cursor: "pointer", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>⧉</button>
        )}
        <button onClick={() => onDelete(widget.id)} title="Remover"
          style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, border: "1px solid #fecaca", background: "#fef2f2",
            color: "#dc2626", cursor: "pointer", fontSize: 13, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
      </div>
      {howOpen && (
        <div style={{ flexShrink: 0, marginBottom: 10, padding: "9px 11px", borderRadius: 9, background: "#eef2ff",
          border: "1px solid #c7d2fe", fontSize: 12, color: "#3730a3", lineHeight: 1.55 }}>
          <strong style={{ display: "block", marginBottom: 3, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>ⓘ Como ler</strong>
          {describeHowToRead(topic)}
        </div>
      )}
      <div data-explore-capture style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
        {children}
      </div>
      {onResizeStart && ['n','s','e','w','ne','nw','se','sw'].map(dir => {
        const H = 8, C = 16;
        const cur = { n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize', ne:'ne-resize', nw:'nw-resize', se:'se-resize', sw:'sw-resize' };
        const pos = { n:{top:0,left:C,right:C,height:H}, s:{bottom:0,left:C,right:C,height:H}, e:{right:0,top:C,bottom:C,width:H}, w:{left:0,top:C,bottom:C,width:H}, ne:{top:0,right:0,width:C,height:C}, nw:{top:0,left:0,width:C,height:C}, se:{bottom:0,right:0,width:C,height:C}, sw:{bottom:0,left:0,width:C,height:C} }[dir];
        return <div key={dir} onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, dir); }} style={{ position:"absolute", zIndex:10, cursor:cur[dir], ...pos }} />;
      })}
    </div>
  );
}

// `insight` — card de leitura (DEC-EB-004/EB-006). `preset` abre uma seção (leitura sobre
// o BaseProfileModel inteiro); `preset:'warnings'` lista TODOS os achados (insights[]).
function ExploreInsightBody({ widget, profile }) {
  const preset = widget.config?.preset;
  if (preset === "warnings") {
    const insights = profile?.insights || [];
    if (insights.length === 0) return <div style={{ fontSize: 12.5, color: "#94a3b8" }}>Nenhum aviso encontrado nesta base.</div>;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {insights.map((f, i) => {
          const meta = EXPLORE_SEVERITY_META[f.severity] || EXPLORE_SEVERITY_META.info;
          return (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "7px 10px", borderRadius: 9, background: meta.bg, border: `1px solid ${meta.border}` }}>
              <span style={{ fontSize: 12.5, flexShrink: 0, marginTop: 1 }}>{meta.icon}</span>
              <span style={{ fontSize: 12, color: "#334155", lineHeight: 1.5 }}>{describeFinding(f)}</span>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
      <p style={{ fontSize: 13.5, color: "#334155", lineHeight: 1.6, margin: 0 }}>{describeSection(preset, profile)}</p>
    </div>
  );
}

// Pontes para o fluxo (Épico EB, EB4, DEC-EB-010) — 3 CTAs reusados nos cards `ivrank`
// (ícones compactos por linha) e `varprofile` (botões rotulados no rodapé). REUSAM os
// aplicadores existentes (App.jsx: createDecisionNode/openRangeModal/openClusterModal) —
// este componente só repassa `col`/`csvId` aos callbacks, nenhuma lógica nova aqui.
const EXPLORE_CTA_META = {
  firstBranch: { icon: "➕", title: "Usar como 1º galho — cria este losango no Canvas" },
  ranges:      { icon: "📐", title: "Criar Faixas por Risco a partir desta variável" },
  cluster:     { icon: "🧩", title: "Clusterizar a partir desta variável" },
};
function ExploreVarActions({ col, csvId, continuous, actions, compact }) {
  if (!actions) return null;
  const { onUseAsFirstBranch, onCreateRanges, onClusterize } = actions;
  const btnStyle = compact
    ? { border: "none", background: "transparent", cursor: "pointer", fontSize: 12, padding: "1px 3px", lineHeight: 1, opacity: 0.7 }
    : { display: "flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 7, border: "1px solid #e2e8f0",
        background: "#fff", color: "#475569", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit" };
  const label = (key) => compact ? null : <span>{EXPLORE_CTA_META[key].title.split(" — ")[0]}</span>;
  return (
    <span style={{ display: "flex", gap: compact ? 2 : 6, flexShrink: 0 }}>
      {onUseAsFirstBranch && (
        <button onClick={() => onUseAsFirstBranch(col, csvId)} title={EXPLORE_CTA_META.firstBranch.title} style={btnStyle}>
          {EXPLORE_CTA_META.firstBranch.icon}{label("firstBranch")}
        </button>
      )}
      {continuous && onCreateRanges && (
        <button onClick={() => onCreateRanges(col, csvId)} title={EXPLORE_CTA_META.ranges.title} style={btnStyle}>
          {EXPLORE_CTA_META.ranges.icon}{label("ranges")}
        </button>
      )}
      {onClusterize && (
        <button onClick={() => onClusterize(col, csvId)} title={EXPLORE_CTA_META.cluster.title} style={btnStyle}>
          {EXPLORE_CTA_META.cluster.icon}{label("cluster")}
        </button>
      )}
    </span>
  );
}

// `ivrank` — barra horizontal (div-based, controle total sobre os badges de flag) do
// ranking global de variáveis (já ordenado por IV desc — DEC-EB-008).
function ExploreIvRankBody({ profile, csvId, actions }) {
  const vars = profile?.variables || [];
  if (vars.length === 0) return <AWEmptyState icon="📊" title="Sem variáveis" hint="Nenhuma coluna marcada como Variável de Decisão nesta base." />;
  const maxIv = Math.max(0.01, ...vars.map(v => v.iv || 0));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {vars.map(v => (
        <div key={v.col} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 140, flexShrink: 0, fontSize: 11.5, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.col}>{v.col}</span>
          <div style={{ flex: 1, height: 15, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${v.iv != null ? Math.max(2, (v.iv / maxIv) * 100) : 0}%`, height: "100%",
              background: v.iv >= 0.3 ? "#16a34a" : v.iv >= 0.1 ? "#2563eb" : "#94a3b8", borderRadius: 4 }} />
          </div>
          <span style={{ width: 42, flexShrink: 0, fontSize: 11, color: "#64748b", textAlign: "right" }}>{v.iv != null ? v.iv.toFixed(2) : "—"}</span>
          <span style={{ display: "flex", gap: 3, flexShrink: 0, minWidth: 60 }}>
            {v.flags.filter(f => EXPLORE_FLAG_META[f]).map(f => (
              <span key={f} title={EXPLORE_FLAG_META[f].title} style={{ fontSize: 11.5 }}>{EXPLORE_FLAG_META[f].icon}</span>
            ))}
          </span>
          <ExploreVarActions col={v.col} csvId={csvId} continuous={v.continuous} actions={actions} compact />
        </div>
      ))}
    </div>
  );
}

// `varprofile` — volume (barras) + taxa da métrica-alvo (linha) por valor, eixo duplo
// (Recharts ComposedChart, exceção DEC-AW-001 estendida à aba Explorar).
function ExploreVarProfileBody({ widget, profile, csvId, actions }) {
  const col = widget.config?.col;
  const v = (profile?.variables || []).find(x => x.col === col);
  if (!v) return <AWEmptyState icon="📊" title="Variável não encontrada" hint="Esta variável pode não existir mais nesta base." />;
  const data = (v.profile || []).map(p => ({ x: String(p.value), qty: p.qty, rate: p.rate != null ? p.rate * 100 : null }));
  const metricLabel = profile?.metric?.label || "Taxa";
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6, flexShrink: 0 }}>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>
          IV {v.iv != null ? v.iv.toFixed(2) : "—"} · {v.distinct} valores · cobertura {v.coveragePct.toFixed(1)}%
          {v.continuous && <span style={{ marginLeft: 6, color: "#2563eb" }}>· contínua</span>}
        </div>
        <ExploreVarActions col={col} csvId={csvId} continuous={v.continuous} actions={actions} />
      </div>
      <div style={{ flex: 1, minHeight: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
            <XAxis dataKey="x" tick={{ fontSize: 10.5, fill: "#64748b" }} stroke="#cbd5e1" />
            <YAxis yAxisId="qty" tick={{ fontSize: 10.5, fill: "#64748b" }} stroke="#cbd5e1" />
            <YAxis yAxisId="rate" orientation="right" tick={{ fontSize: 10.5, fill: "#64748b" }} stroke="#cbd5e1" unit="%" />
            <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12, fontFamily: "inherit" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="qty" dataKey="qty" name="Volume" fill="#94a3b8" radius={[3, 3, 0, 0]} />
            <Line yAxisId="rate" type="monotone" dataKey="rate" name={`${metricLabel} (%)`} stroke="#dc2626" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {v.profileTruncated && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4, flexShrink: 0 }}>Mostrando os valores de maior volume.</div>}
    </div>
  );
}

// `quality` — tabela de cobertura/valores não-numéricos/categoria dominante por variável.
function ExploreQualityBody({ profile }) {
  const rows = profile?.quality || [];
  if (rows.length === 0) return <AWEmptyState icon="🧪" title="Sem variáveis" hint="Nenhuma coluna marcada como Variável de Decisão nesta base." />;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ textAlign: "left", color: "#94a3b8", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>
          <th style={{ padding: "4px 8px" }}>Variável</th>
          <th style={{ padding: "4px 8px" }}>Cobertura</th>
          <th style={{ padding: "4px 8px" }}>Não numérico</th>
          <th style={{ padding: "4px 8px" }}>Categoria dominante</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(q => (
          <tr key={q.col} style={{ borderTop: "1px solid #f1f5f9" }}>
            <td style={{ padding: "5px 8px", fontWeight: 600, color: "#1e293b" }}>{q.col}</td>
            <td style={{ padding: "5px 8px", color: q.coveragePct < 85 ? "#b45309" : "#334155" }}>{q.coveragePct.toFixed(1)}%</td>
            <td style={{ padding: "5px 8px", color: "#64748b" }}>{q.unparseablePct != null ? `${q.unparseablePct.toFixed(1)}%` : "—"}</td>
            <td style={{ padding: "5px 8px", color: q.dominantValue && q.dominantValue.sharePct >= 80 ? "#b45309" : "#64748b" }}>
              {q.dominantValue ? `${q.dominantValue.value} (${q.dominantValue.sharePct.toFixed(0)}%)` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// `stability` — série por safra (volume + aprovação + inad., DEC-EB-009) + selo de PSI
// por variável. Sem coluna ⏱ Temporal, declara a degradação (nunca inventa série).
function ExploreStabilityBody({ profile }) {
  if (!profile?.temporal) {
    return <AWEmptyState icon="⏱" title="Sem coluna temporal"
      hint='Marque uma coluna como "⏱ Temporal" no passo 2 do wizard de importação para habilitar esta análise.' />;
  }
  const series = profile.temporal.series.map(s => ({
    x: s.bucket, qty: s.qty,
    approvalRate: s.approvalRate != null ? s.approvalRate * 100 : null,
    inadRate: s.inadRate != null ? s.inadRate * 100 : null,
  }));
  const psiRows = (profile.variables || []).filter(v => v.psi).sort((a, b) => b.psi.value - a.psi.value).slice(0, 8);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, gap: 10 }}>
      <div style={{ flex: 1, minHeight: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
            <XAxis dataKey="x" tick={{ fontSize: 10.5, fill: "#64748b" }} stroke="#cbd5e1" />
            <YAxis yAxisId="qty" tick={{ fontSize: 10.5, fill: "#64748b" }} stroke="#cbd5e1" />
            <YAxis yAxisId="rate" orientation="right" tick={{ fontSize: 10.5, fill: "#64748b" }} stroke="#cbd5e1" unit="%" />
            <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", fontSize: 12, fontFamily: "inherit" }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar yAxisId="qty" dataKey="qty" name="Volume" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
            <Line yAxisId="rate" type="monotone" dataKey="approvalRate" name="Aprovação (%)" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            <Line yAxisId="rate" type="monotone" dataKey="inadRate" name="Inadimplência (%)" stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {psiRows.length > 0 && (
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: 5, letterSpacing: 0.4 }}>
            PSI por variável (janela referência → atual)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {psiRows.map(v => {
              const val = v.psi.value;
              const color = val > 0.25 ? "#dc2626" : val > 0.1 ? "#b45309" : "#16a34a";
              const bg = val > 0.25 ? "#fef2f2" : val > 0.1 ? "#fffbeb" : "#f0fdf4";
              return (
                <span key={v.col} title={`${v.psi.refWindow.from}–${v.psi.refWindow.to} → ${v.psi.curWindow.from}–${v.psi.curWindow.to}`}
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 12, background: bg, color, fontWeight: 600 }}>
                  {v.col}: {val.toFixed(2)}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Dispatcher por tipo — a casca (shell) é sempre a mesma, só o corpo muda.
function ExploreWidget({ widget, profile, csvId, actions, onConfigChange, onDelete, onDuplicate, onDragStart, onResizeStart }) {
  const body = widget.type === "ivrank" ? <ExploreIvRankBody profile={profile} csvId={csvId} actions={actions} />
    : widget.type === "varprofile" ? <ExploreVarProfileBody widget={widget} profile={profile} csvId={csvId} actions={actions} />
    : widget.type === "quality" ? <ExploreQualityBody profile={profile} />
    : widget.type === "stability" ? <ExploreStabilityBody profile={profile} />
    : <ExploreInsightBody widget={widget} profile={profile} />;
  const accent = widget.type === "insight" ? "#ddd6fe" : "#e2e8f0";
  return (
    <ExploreWidgetShell widget={widget} accent={accent} topic={howToReadTopic(widget)} onConfigChange={onConfigChange} onDelete={onDelete}
      onDuplicate={onDuplicate} onDragStart={onDragStart} onResizeStart={onResizeStart}>
      {body}
    </ExploreWidgetShell>
  );
}

// Tipos "livres" do builder (DEC-EB-011) — MESMOS tipos do Dashboard (gráfico/KPI/texto),
// dividindo o mesmo array `layout` com os widgets automáticos da aba (insight/ivrank/
// varprofile/quality/stability). O dispatcher de render abaixo decide o componente pelo tipo.
const EXPLORE_FREE_TYPES = new Set([...CHART_TYPES.map(ct => ct.id), "text"]);

// ── ExploreTab — página da aba Explorar ────────────────────────────────────────
// Header: seletor de base + seletor de métrica-alvo + ↻ Regenerar análise + Exportar PDF +
// "+ Adicionar gráfico"/"📝 Adicionar texto" (builder livre, EB4). Canvas: mesma mecânica de
// posicionamento livre (drag/resize) do Dashboard. Painel de campos (FieldPanel) à direita:
// MESMO chassi do Dashboard, operando sobre `datasetGrouped`/`datasetRaw` — dataset largo
// escopado à base selecionada, cenário FIXO AS IS (DEC-EB-011 — a aba analisa a base
// observada, não a política simulada).
function ExploreTab({ profile, csvStore, csvId, onCsvIdChange, riskMetric, onRiskMetricChange, layout, setLayout, onRegenerate,
  actions, datasetGrouped, datasetRaw, groupings, setGroupings, pageFilters, setPageFilters, actionNotice, onDismissActionNotice }) {
  // Auto-init: primeiro perfil desta base com layout vazio ⇒ gera o default (DEC-EB-005).
  useEffect(() => {
    if (!profile || profile.error) return;
    setLayout(prev => (prev && prev.length > 0) ? prev : buildDefaultExploreLayout(profile));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const changeConfig = (id, patch) => setLayout(prev => prev.map(w => w.id === id ? { ...w, config: { ...w.config, ...patch }, origin: "user" } : w));
  const changeType = (id, type) => setLayout(prev => prev.map(w => w.id === id ? { ...w, type } : w));
  const removeWidget = (id) => setLayout(prev => prev.filter(w => w.id !== id));
  const duplicateWidget = (id) => setLayout(prev => {
    const src = prev.find(w => w.id === id);
    if (!src) return prev;
    const clonedConfig = JSON.parse(JSON.stringify(src.config || {}));
    clonedConfig.title = `${clonedConfig.title || "Card"} (cópia)`;
    const copy = { ...src, id: uid(), origin: "user", config: clonedConfig, x: (src.x ?? 24) + 28, y: (src.y ?? 24) + 28 };
    const idx = prev.findIndex(w => w.id === id);
    return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
  });

  // ── Builder livre (DEC-EB-011) — "+ Adicionar gráfico"/"📝 Adicionar texto", MESMOS
  // WidgetConfig do Dashboard (AnalyticsWidget/TextWidget), nascem `origin:'user'` (não há
  // "AUTO" para algo que o próprio usuário pediu).
  const dims = datasetGrouped?.dimensions || [];
  const temporalCols = datasetGrouped?.temporalColumns || [];
  const makeChartWidget = () => {
    const nextY = layout.reduce((acc, w) => Math.max(acc, (w.y ?? 0) + (w.h ?? 360)), 0);
    return {
      id: uid(), type: "line", origin: "user", x: 24, y: layout.length === 0 ? 24 : nextY + 24, w: 560, h: 420,
      config: { title: "Novo gráfico", xDimension: temporalCols[0] || dims[0] || null, metric: "approvalRate", serieBy: SERIE_NONE, yMin: null, yMax: null, filters: [] },
    };
  };
  const makeTextWidget = () => {
    const nextY = layout.reduce((acc, w) => Math.max(acc, (w.y ?? 0) + (w.h ?? 360)), 0);
    return { id: uid(), type: "text", origin: "user", x: 24, y: layout.length === 0 ? 24 : nextY + 24, w: 380, h: 220, config: { title: "Anotação", text: "", spellCheck: true } };
  };
  const addChartWidget = () => setLayout(prev => [...prev, makeChartWidget()]);
  const addTextWidget = () => setLayout(prev => [...prev, makeTextWidget()]);

  // ── Agrupamentos (dimensões derivadas), MESMO GroupingModal do Dashboard ───────────
  const [editingGrouping, setEditingGrouping] = useState(null); // null | draft
  const newGrouping = () => setEditingGrouping({ id: null, name: "", source: "", buckets: [], unmatched: "other", otherLabel: GROUPING_OTHER_DEFAULT });
  const editGrouping = (id) => { const g = groupings.find(x => x.id === id); if (g) setEditingGrouping({ ...g }); };
  const deleteGrouping = (id) => setGroupings(prev => prev.filter(g => g.id !== id));
  const saveGrouping = (g) => {
    const isNew = !g.id;
    const withId = isNew ? { ...g, id: uid() } : g;
    setGroupings(prev => isNew ? [...prev, withId] : prev.map(x => x.id === g.id ? withId : x));
    setEditingGrouping(null);
  };
  const existingNames = useMemo(() => {
    const real = (datasetRaw?.dimensions || []).filter(d => !(datasetRaw?.groupedDimensions || []).includes(d));
    const others = groupings.filter(g => !editingGrouping || g.id !== editingGrouping.id).map(g => g.name);
    return new Set([...real, ...others]);
  }, [datasetRaw, groupings, editingGrouping]);

  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  const dragRef = useRef(null);
  const startWidgetInteract = (id, e, type, dir) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const wgt = layoutRef.current.find(w => w.id === id);
    if (!wgt) return;
    dragRef.current = { id, type, dir, startX: e.clientX, startY: e.clientY, startWx: wgt.x ?? 24, startWy: wgt.y ?? 24, startW: wgt.w ?? 520, startH: wgt.h ?? 360, minW: 340, minH: 160 };
    const onMove = (ev) => {
      const dr = dragRef.current; if (!dr) return;
      const dx = ev.clientX - dr.startX, dy = ev.clientY - dr.startY;
      if (dr.type === "move") {
        setLayout(prev => prev.map(w => w.id === dr.id ? { ...w, x: Math.max(0, dr.startWx + dx), y: Math.max(0, dr.startWy + dy) } : w));
      } else {
        const d = dr.dir;
        let nx = dr.startWx, ny = dr.startWy, nw = dr.startW, nh = dr.startH;
        if (d.includes('e')) nw = Math.max(dr.minW, dr.startW + dx);
        if (d.includes('s')) nh = Math.max(dr.minH, dr.startH + dy);
        if (d.includes('w')) { nw = Math.max(dr.minW, dr.startW - dx); nx = Math.max(0, dr.startWx + dr.startW - nw); }
        if (d.includes('n')) { nh = Math.max(dr.minH, dr.startH - dy); ny = Math.max(0, dr.startWy + dr.startH - nh); }
        setLayout(prev => prev.map(w => w.id === dr.id ? { ...w, x: nx, y: ny, w: nw, h: nh } : w));
      }
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Exportar Explorar como PDF — mesmo padrão de exportDashboardPDF (janela + print),
  // captura genérica via [data-explore-capture] (sem branch por tipo de widget).
  const exportExplorePDF = () => {
    if (!profile || layout.length === 0) return;
    const ordered = [...layout].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
    const cards = ordered.map(w => {
      const node = typeof document !== "undefined" ? document.querySelector(`[data-explore-widget-id="${w.id}"] [data-explore-capture]`) : null;
      const body = node ? node.outerHTML : '<p class="muted">(sem conteúdo)</p>';
      return `<section class="card"><h3>${escHtml(w.config?.title || "Componente")}</h3><div class="visual">${body}</div></section>`;
    }).join("");
    const style = `<style>
      *{box-sizing:border-box;} body{font-family:system-ui,-apple-system,sans-serif;color:#1e293b;margin:0;padding:28px 32px;background:#fff;}
      h1{font-size:22px;margin:0 0 4px;} .sub{color:#94a3b8;font-size:12px;margin:0 0 20px;}
      h3{font-size:15px;margin:0 0 8px;color:#0f172a;} .muted{color:#94a3b8;}
      .card{border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px 14px;margin:0 0 18px;page-break-inside:avoid;break-inside:avoid;}
      table{width:100%;border-collapse:collapse;font-size:12px;} th,td{padding:4px 8px;text-align:left;}
      @media print{body{padding:0;} .card{box-shadow:none;}}
    </style>`;
    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Explorar a Base — Exportação</title>${style}</head><body>
      <h1>Explorar a Base — ${escHtml(csvStore?.[csvId]?.name || csvId || "")}</h1>
      <p class="sub">Exportado em ${escHtml(new Date().toLocaleString("pt-BR"))} · ${ordered.length} componente(s)</p>
      ${cards}
    </body></html>`;
    const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
    if (!win) return;
    win.document.open(); win.document.write(html); win.document.close(); win.focus();
    setTimeout(() => { try { win.print(); } catch { /* ignore */ } }, 400);
  };

  const csvOptions = Object.entries(csvStore || {});
  const hasData = csvOptions.length > 0;
  const canvasH = layout.reduce((acc, w) => Math.max(acc, (w.y ?? 24) + (w.h ?? 360) + 80), 600);
  const canvasW = layout.reduce((acc, w) => Math.max(acc, (w.x ?? 24) + (w.w ?? 1100) + 40), 1160);

  const selStyle = { padding: "7px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "#fff",
    fontSize: 12.5, color: "#1e293b", fontFamily: "inherit", outline: "none", cursor: "pointer" };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row", overflow: "hidden", background: "#f8fafc" }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Aviso efêmero do CTA "➕ Usar como 1º galho" quando o canvas já não estava vazio
            (nó criado SOLTO — DEC-EB-010). */}
        {actionNotice && (
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "8px 28px",
            background: "#eff6ff", borderBottom: "1px solid #bfdbfe", fontSize: 11.5, color: "#1d4ed8", lineHeight: 1.5 }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>💡</span>
            <span style={{ flex: 1 }}>{actionNotice}</span>
            <button onClick={onDismissActionNotice} title="Dispensar aviso"
              style={{ border: "none", background: "transparent", color: "#2563eb", cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>
        )}
        <div style={{ flexShrink: 0, padding: "20px 28px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: "#1e293b", letterSpacing: 0.2 }}>🔎 Explorar a Base</h1>
            <p style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 3 }}>
              A análise que um analista sênior faria antes do primeiro galho — funciona com o canvas vazio.
            </p>
          </div>
          {hasData && (
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <select value={csvId || ""} onChange={(e) => onCsvIdChange(e.target.value)} style={selStyle} title="Base analisada">
                {csvOptions.map(([id, c]) => <option key={id} value={id}>{c.name || id}</option>)}
              </select>
              <select value={riskMetric} onChange={(e) => onRiskMetricChange(e.target.value)} style={selStyle} title="Métrica-alvo">
                <option value="inadReal">Inad. Real</option>
                <option value="inadInferida">Inad. Inferida</option>
              </select>
              <button onClick={onRegenerate}
                title="Recria os cards gerados automaticamente (origin AUTO), preservando os que você criou ou editou"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9,
                  border: "1px solid #cbd5e1", background: "#fff", color: "#475569", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>↻</span> Regenerar análise
              </button>
              <button onClick={exportExplorePDF} disabled={layout.length === 0}
                title="Exporta os componentes desta análise como PDF (via impressão do navegador)"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9,
                  border: "1px solid #cbd5e1", background: "#fff", color: layout.length === 0 ? "#cbd5e1" : "#475569",
                  cursor: layout.length === 0 ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>📄</span> Exportar PDF
              </button>
              <button onClick={addTextWidget}
                title="Adiciona uma caixa de texto livre para anotações sobre a análise"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9,
                  border: "1px solid #f59e0b", background: "#fffbeb", color: "#b45309", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>📝</span> Adicionar texto
              </button>
              <button onClick={addChartWidget}
                title="Adiciona um gráfico livre sobre a base (dimensões/métricas no painel à direita)"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9,
                  border: "1px solid #2563eb", background: "#2563eb", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>
                <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Adicionar gráfico
              </button>
            </div>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "auto" }}>
          {!hasData ? (
            <AWEmptyState icon="🔎" title="Nenhuma base carregada"
              hint="Importe um CSV para a análise exploratória aparecer aqui automaticamente." />
          ) : !profile ? (
            <AWEmptyState icon="⏳" title="Calculando o perfil da base…" hint="Isso é rápido — só agregação exata sobre a base." />
          ) : profile.error ? (
            <AWEmptyState icon="⚠️" title="Não foi possível calcular o perfil" hint={`Erro: ${profile.error}`} />
          ) : layout.length === 0 ? (
            <AWEmptyState icon="⏳" title="Gerando a análise…" hint="O layout automático aparece assim que o perfil da base terminar de calcular." />
          ) : (
            <div style={{ position: "relative", minHeight: canvasH, minWidth: canvasW }}>
              {layout.map(w => (
                <div key={w.id} data-explore-widget-id={w.id} style={{ position: "absolute", left: w.x ?? 24, top: w.y ?? 24, width: w.w ?? 1100, height: w.h ?? 360 }}>
                  {EXPLORE_FREE_TYPES.has(w.type) ? (
                    <div data-explore-capture style={{ height: "100%" }}>
                      {w.type === "text" ? (
                        <TextWidget widget={w}
                          onConfigChange={changeConfig} onDelete={removeWidget} onDuplicate={duplicateWidget}
                          onDragStart={(e) => startWidgetInteract(w.id, e, 'move', null)}
                          onResizeStart={(e, dir) => startWidgetInteract(w.id, e, 'resize', dir)} />
                      ) : (
                        <AnalyticsWidget widget={w} analyticsDataset={datasetGrouped} pageFilters={pageFilters}
                          onConfigChange={changeConfig} onTypeChange={changeType} onDelete={removeWidget} onDuplicate={duplicateWidget}
                          onDragStart={(e) => startWidgetInteract(w.id, e, 'move', null)}
                          onResizeStart={(e, dir) => startWidgetInteract(w.id, e, 'resize', dir)} />
                      )}
                    </div>
                  ) : (
                    <ExploreWidget widget={w} profile={profile} csvId={csvId} actions={actions}
                      onConfigChange={changeConfig} onDelete={removeWidget} onDuplicate={duplicateWidget}
                      onDragStart={(e) => startWidgetInteract(w.id, e, 'move', null)}
                      onResizeStart={(e, dir) => startWidgetInteract(w.id, e, 'resize', dir)} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Painel de campos (builder livre, DEC-EB-011) — MESMO chassi do Dashboard. */}
      {hasData && <FieldPanel analyticsDataset={datasetGrouped} groupings={groupings}
        onNewGrouping={newGrouping} onEditGrouping={editGrouping} onDeleteGrouping={deleteGrouping}
        pageFilters={pageFilters} onPageFiltersChange={setPageFilters} />}

      {editingGrouping && (
        <GroupingModal draft={editingGrouping} baseDataset={datasetRaw} existingNames={existingNames}
          onSave={saveGrouping} onClose={() => setEditingGrouping(null)} />
      )}
    </div>
  );
}

// ── GroupingModal — editor de agrupamento (dimensão derivada) ─────────────────
function GroupingModal({ draft, baseDataset, existingNames, onSave, onClose }) {
  const [name, setName]           = useState(draft.name || "");
  const [source, setSource]       = useState(draft.source || "");
  const [buckets, setBuckets]     = useState(() => (draft.buckets || []).map(b => ({ id: b.id || uid(), label: b.label, values: [...(b.values || [])] })));
  const [unmatched, setUnmatched] = useState(draft.unmatched || "other");
  const [otherLabel, setOtherLabel] = useState(draft.otherLabel || GROUPING_OTHER_DEFAULT);
  const [autoSize, setAutoSize]   = useState(5);

  // Dimensões-base candidatas: só dimensões reais (não derivadas, não o eixo Cenário).
  const sourceDims = (baseDataset?.dimensions || []).filter(d => !(baseDataset?.groupedDimensions || []).includes(d));
  const temporalCols = new Set(baseDataset?.temporalColumns || []);
  const distinct = useMemo(() => distinctDimValues(baseDataset, source), [baseDataset, source]);

  const v2b = useMemo(() => { const m = {}; for (const b of buckets) for (const v of b.values) m[v] = b.id; return m; }, [buckets]);
  const unassigned = distinct.filter(v => !v2b[v]);

  const changeSource = (s) => { setSource(s); setBuckets([]); };
  const applyAuto = () => setBuckets(autoBuckets(distinct, autoSize));
  const addBucket = () => setBuckets(prev => [...prev, { id: uid(), label: `Grupo ${prev.length + 1}`, values: [] }]);
  const renameBucket = (id, label) => setBuckets(prev => prev.map(b => b.id === id ? { ...b, label } : b));
  const removeBucket = (id) => setBuckets(prev => prev.filter(b => b.id !== id));
  const assignValue = (val, bucketId) => setBuckets(prev =>
    prev.map(b => ({ ...b, values: b.values.filter(v => v !== val) }))
        .map(b => (bucketId && b.id === bucketId) ? { ...b, values: [...b.values, val] } : b));

  const nameTrim = name.trim();
  const labels = buckets.map(b => b.label.trim());
  const dupLabel = labels.some((l, i) => l && labels.indexOf(l) !== i);
  const emptyLabel = buckets.some(b => !b.label.trim());
  const filledBuckets = buckets.filter(b => b.values.length > 0);
  let error = null;
  if (!nameTrim) error = "Dê um nome ao agrupamento.";
  else if (existingNames.has(nameTrim)) error = "Já existe uma dimensão ou agrupamento com esse nome.";
  else if (!source) error = "Escolha a dimensão-base.";
  else if (filledBuckets.length === 0) error = "Atribua valores a pelo menos um grupo.";
  else if (emptyLabel) error = "Todo grupo precisa de um nome.";
  else if (dupLabel) error = "Há grupos com nomes repetidos.";

  const save = () => {
    if (error) return;
    onSave({
      id: draft.id, name: nameTrim, source,
      buckets: buckets.filter(b => b.values.length > 0).map(b => ({ id: b.id, label: b.label.trim(), values: b.values })),
      unmatched, otherLabel: otherLabel.trim() || GROUPING_OTHER_DEFAULT,
    });
  };

  const selStyle = { padding: "5px 7px", borderRadius: 7, border: "1px solid #e2e8f0", background: "#f8fafc",
    fontSize: 12, color: "#1e293b", fontFamily: "inherit", outline: "none", cursor: "pointer" };
  const inStyle = { padding: "7px 9px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff",
    fontSize: 13, color: "#1e293b", fontFamily: "inherit", outline: "none", boxSizing: "border-box" };

  return (
    <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", zIndex: 9000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onMouseDown={(e) => e.stopPropagation()} style={{ width: 560, maxWidth: "100%", maxHeight: "90vh", background: "#fff",
        borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,.3)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", borderBottom: "1px solid #eef2f7" }}>
          <span style={{ fontSize: 18 }}>🧩</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b" }}>{draft.id ? "Editar agrupamento" : "Novo agrupamento"}</div>
            <div style={{ fontSize: 11.5, color: "#94a3b8" }}>Colapse valores de uma dimensão em poucas faixas reutilizáveis.</div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>Nome do agrupamento</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Faixa Score (agrupada)" style={inStyle} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>Dimensão-base</span>
              <select value={source} onChange={(e) => changeSource(e.target.value)} style={{ ...inStyle, cursor: "pointer", appearance: "auto" }}>
                <option value="">— escolher —</option>
                {sourceDims.map(d => <option key={d} value={d}>{temporalCols.has(d) ? `⏱ ${d}` : d}</option>)}
              </select>
            </label>
          </div>

          {source && (
            <>
              {/* Auto-faixas */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", background: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: 10, padding: "10px 12px" }}>
                <span style={{ fontSize: 12, color: "#475569" }}>Agrupar automaticamente em faixas de</span>
                <input type="number" min={1} value={autoSize} onChange={(e) => setAutoSize(Math.max(1, Number(e.target.value) || 1))}
                  style={{ ...selStyle, width: 56, textAlign: "right" }} />
                <span style={{ fontSize: 12, color: "#475569" }}>valores ({distinct.length} no total)</span>
                <button onClick={applyAuto} style={{ ...selStyle, background: "#ede9fe", border: "1px solid #ddd6fe", color: "#6d28d9", fontWeight: 600 }}>Gerar faixas</button>
              </div>

              {/* Grupos */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Grupos</span>
                  <button onClick={addBucket} style={{ ...selStyle, padding: "3px 9px", fontWeight: 600, color: "#475569" }}>+ Adicionar grupo</button>
                </div>
                {buckets.length === 0
                  ? <div style={{ fontSize: 12, color: "#94a3b8", padding: "6px 2px" }}>Gere faixas automaticamente ou adicione grupos manualmente.</div>
                  : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {buckets.map((b, i) => (
                        <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 3, background: SERIE_COLORS[i % SERIE_COLORS.length], flexShrink: 0 }} />
                          <input value={b.label} onChange={(e) => renameBucket(b.id, e.target.value)}
                            style={{ ...inStyle, flex: 1, padding: "5px 8px", fontSize: 12.5 }} />
                          <span style={{ fontSize: 11, color: "#94a3b8", width: 54, textAlign: "right" }}>{b.values.length} val.</span>
                          <button onClick={() => removeBucket(b.id)} title="Remover grupo"
                            style={{ border: "none", background: "transparent", color: "#f87171", cursor: "pointer", fontSize: 13 }}>✕</button>
                        </div>
                      ))}
                    </div>}
              </div>

              {/* Atribuição de valores */}
              <div>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Valores {unassigned.length > 0 && <span style={{ color: "#d97706", fontWeight: 500 }}>· {unassigned.length} sem grupo</span>}
                </span>
                <div style={{ marginTop: 6, maxHeight: 220, overflowY: "auto", border: "1px solid #eef2f7", borderRadius: 10 }}>
                  {distinct.map((v, i) => (
                    <div key={v} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px",
                      borderTop: i === 0 ? "none" : "1px solid #f1f5f9", background: v2b[v] ? "#fff" : "#fffbeb" }}>
                      <span style={{ flex: 1, fontSize: 12.5, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                      <select value={v2b[v] || ""} onChange={(e) => assignValue(v, e.target.value)} style={{ ...selStyle, minWidth: 150 }}>
                        <option value="">— sem grupo —</option>
                        {buckets.map(b => <option key={b.id} value={b.id}>{b.label || "(sem nome)"}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Valores fora dos grupos */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, color: "#64748b" }}>Valores sem grupo:</span>
                {[["other", "Reunir em um grupo"], ["keep", "Manter valor original"]].map(([id, lbl]) => (
                  <label key={id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "#334155", cursor: "pointer" }}>
                    <input type="radio" checked={unmatched === id} onChange={() => setUnmatched(id)} />
                    {lbl}
                  </label>
                ))}
                {unmatched === "other" && (
                  <input value={otherLabel} onChange={(e) => setOtherLabel(e.target.value)} placeholder={GROUPING_OTHER_DEFAULT}
                    style={{ ...inStyle, padding: "5px 8px", fontSize: 12.5, width: 130 }} />
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderTop: "1px solid #eef2f7" }}>
          <span style={{ flex: 1, fontSize: 12, color: error ? "#d97706" : "#94a3b8" }}>{error || "Pronto para salvar."}</span>
          <button onClick={onClose} style={{ ...selStyle, padding: "7px 14px", color: "#475569" }}>Cancelar</button>
          <button onClick={save} disabled={!!error}
            style={{ padding: "7px 16px", borderRadius: 8, border: "none", fontFamily: "inherit", fontSize: 13, fontWeight: 600,
              cursor: error ? "not-allowed" : "pointer", background: error ? "#e2e8f0" : "#7c3aed", color: error ? "#94a3b8" : "#fff" }}>
            {draft.id ? "Salvar" : "Criar agrupamento"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AnalysisTab — página da aba Análise ───────────────────────────────────────
function AnalysisTab({ analyticsDataset, baseDataset, analyticsLayout, setAnalyticsLayout, groupings, setGroupings, pageFilters, setPageFilters, scopeNotice, onDismissScopeNotice }) {
  const dims = analyticsDataset?.dimensions || [];
  const temporalCols = analyticsDataset?.temporalColumns || [];

  const makeWidget = (title) => {
    const nextY = analyticsLayout.reduce((acc, w) => Math.max(acc, (w.y ?? 0) + (w.h ?? 500)), 0);
    return {
      id: uid(), type: "line", x: 24, y: analyticsLayout.length === 0 ? 24 : nextY + 24, w: 560, h: 500,
      config: { title, xDimension: temporalCols[0] || dims[0] || null, metric: "approvalRate", serieBy: SERIE_CENARIO, yMin: null, yMax: null, filters: [] },
    };
  };

  // Auto-init: ao chegar o primeiro dataset com layout vazio, cria o gráfico padrão (Sessão 1).
  useEffect(() => {
    if (!analyticsDataset) return;
    setAnalyticsLayout(prev => prev.length === 0 ? [makeWidget("Taxa de Aprovação ao longo do tempo")] : prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyticsDataset]);

  const makeTextWidget = () => {
    const nextY = analyticsLayout.reduce((acc, w) => Math.max(acc, (w.y ?? 0) + (w.h ?? 500)), 0);
    return {
      id: uid(), type: "text", x: 24, y: analyticsLayout.length === 0 ? 24 : nextY + 24, w: 380, h: 220,
      config: { title: "Anotação", text: "", spellCheck: true },
    };
  };

  const addWidget = () => setAnalyticsLayout(prev => [...prev, makeWidget("Novo gráfico")]);
  const addTextWidget = () => setAnalyticsLayout(prev => [...prev, makeTextWidget()]);
  const duplicateWidget = (id) => setAnalyticsLayout(prev => {
    const src = prev.find(w => w.id === id);
    if (!src) return prev;
    // Deep clone da config (filters/rules, seriesStyles etc.) — desacopla do original.
    const clonedConfig = JSON.parse(JSON.stringify(src.config || {}));
    clonedConfig.title = `${clonedConfig.title || "Gráfico"} (cópia)`;
    const copy = { ...src, id: uid(), config: clonedConfig, x: (src.x ?? 24) + 28, y: (src.y ?? 24) + 28 };
    // Insere logo após o original na lista.
    const idx = prev.findIndex(w => w.id === id);
    return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
  });
  const removeWidget = (id) => setAnalyticsLayout(prev => prev.filter(w => w.id !== id));
  const changeConfig = (id, patch) => setAnalyticsLayout(prev => prev.map(w => w.id === id ? { ...w, config: { ...w.config, ...patch } } : w));
  const changeType = (id, type) => setAnalyticsLayout(prev => prev.map(w => w.id === id ? { ...w, type } : w));

  // ── Exportar Dashboard como PDF ─────────────────────────────────────────────
  // Monta um documento HTML self-contained (padrão do printDocHTML da Doc. Automática)
  // com TODOS os componentes do Dashboard na visão dos filtros aplicados:
  //  · uma seção de topo com o FILTRO DA PÁGINA como um todo (aplicado a tudo);
  //  · por componente, o detalhamento dos filtros efetivos (página + filtros do visual).
  // Gráficos são capturados do DOM vivo (SVG + legenda do Recharts); KPIs são
  // recomputados (o DOM tem <select>, que não queremos no papel); texto vem da config.
  const exportDashboardPDF = () => {
    const ds = analyticsDataset;
    if (!ds || analyticsLayout.length === 0) return;
    const metricLabel = (id) => (ds.metrics || []).find(m => m.id === id)?.label || id || "—";
    const scenName = (id) => (ds.scenarios || []).find(s => s.id === id)?.nome || id || "—";

    const filtersBlockHTML = (descs, emptyText) => {
      if (!descs.length) return `<p class="nofilter">${escHtml(emptyText)}</p>`;
      return `<ul class="filters">${descs.map(d => {
        if (d.mode === "basic") {
          const countTxt = d.total != null ? ` <span class="muted">(${d.values.length} de ${d.total})</span>` : "";
          return `<li><span class="fdim">${escHtml(d.dim)}</span>: ${escHtml(d.text)}${countTxt}</li>`;
        }
        return `<li><span class="fdim">${escHtml(d.dim)}</span> ${escHtml(d.text)}</li>`;
      }).join("")}</ul>`;
    };

    const kpiHTML = (w) => {
      const cfg = w.config || {};
      const fds = applyFiltersToDataset(ds, pageFilters, cfg.filters);
      const md = (fds.metrics || []).find(m => m.id === cfg.metric) || (fds.metrics || [])[0];
      if (!md) return `<p class="muted">(métrica indisponível)</p>`;
      const { a, b } = resolveKpiScenarios(fds.scenarios, cfg.kpiA, cfg.kpiB);
      const aVal = a ? computeWidgetMetric(fds, null, md.id, a.decisionCol) : null;
      const bVal = b ? computeWidgetMetric(fds, null, md.id, b.decisionCol) : null;
      let deltaTxt = "";
      if (aVal != null && bVal != null) {
        const delta = bVal - aVal, sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
        deltaTxt = md.unit === "qty" ? `${sign}${fmtQty(Math.abs(delta))}` : `${sign}${Math.abs(delta).toFixed(2)} pp`;
      }
      return `<div class="kpi">
        <div class="kpi-metric">${escHtml(md.label)}</div>
        <div class="kpi-big">${escHtml(fmtMetricVal(bVal, md.unit))}</div>
        <div class="kpi-scen">${escHtml(b?.nome ?? "—")}</div>
        <div class="kpi-base">${escHtml(a?.nome ?? "—")}: <strong>${escHtml(fmtMetricVal(aVal, md.unit))}</strong>${deltaTxt ? ` · Δ ${escHtml(deltaTxt)}` : ""}</div>
      </div>`;
    };

    const widgetVisualHTML = (w) => {
      if (w.type === "text") {
        const txt = (w.config?.text || "").trim();
        return `<div class="textbox">${txt ? escHtml(txt).replace(/\n/g, "<br>") : '<span class="muted">(vazio)</span>'}</div>`;
      }
      if (w.type === "kpi") return kpiHTML(w);
      const node = typeof document !== "undefined" ? document.querySelector(`[data-aw-widget-id="${w.id}"] .recharts-wrapper`) : null;
      if (node) return `<div class="chart">${node.outerHTML}</div>`;
      return `<p class="muted">(gráfico sem dados para exibir)</p>`;
    };

    const widgetMetaHTML = (w) => {
      const cfg = w.config || {};
      if (w.type === "text") return "";
      if (w.type === "kpi")
        return `<div class="meta">Indicador · Métrica: <strong>${escHtml(metricLabel(cfg.metric))}</strong> · ${escHtml(scenName(cfg.kpiA))} vs ${escHtml(scenName(cfg.kpiB))}</div>`;
      const typeLabel = { line: "Gráfico de linha", bar: "Gráfico de barras", bar100: "Barras 100% empilhadas" }[w.type] || w.type;
      const serie = cfg.serieBy === SERIE_CENARIO ? "Cenário" : cfg.serieBy === SERIE_NONE ? "—" : (cfg.serieBy || "—");
      const xdim = cfg.xDimension === XDIM_CENARIO ? "Cenários (abas)" : (cfg.xDimension || "—");
      return `<div class="meta">${escHtml(typeLabel)} · Métrica: <strong>${escHtml(metricLabel(cfg.metric))}</strong> · Eixo X: ${escHtml(xdim)} · Série: ${escHtml(serie)}</div>`;
    };

    const pageDescs = describeFilterCards(pageFilters, ds);
    const orderedWidgets = [...analyticsLayout].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));

    const cards = orderedWidgets.map((w) => {
      const cfg = w.config || {};
      const title = cfg.title || (w.type === "text" ? "Anotação" : "Componente");
      const widgetDescs = w.type === "text" ? [] : describeFilterCards(cfg.filters, ds);
      const filtersSection = w.type === "text" ? "" : `
        <div class="wfilters">
          <div class="wfilters-title">Filtros aplicados neste componente</div>
          ${pageDescs.length ? `<div class="wfilters-sub">↳ Filtros da página (aplicados a todos):</div>${filtersBlockHTML(pageDescs, "")}` : `<p class="nofilter">Sem filtros de página.</p>`}
          ${widgetDescs.length ? `<div class="wfilters-sub">↳ Filtros exclusivos deste visual:</div>${filtersBlockHTML(widgetDescs, "")}` : `<p class="nofilter">Nenhum filtro exclusivo deste visual.</p>`}
        </div>`;
      return `<section class="card ${w.type === "text" ? "card-text" : ""}">
        <h3>${escHtml(title)}</h3>
        ${widgetMetaHTML(w)}
        <div class="visual">${widgetVisualHTML(w)}</div>
        ${filtersSection}
      </section>`;
    }).join("");

    const style = `<style>
      *{box-sizing:border-box;}
      body{font-family:system-ui,-apple-system,sans-serif;color:#1e293b;margin:0;padding:28px 32px;background:#fff;}
      h1{font-size:22px;margin:0 0 4px;}
      h3{font-size:15px;margin:0 0 6px;color:#0f172a;}
      .sub{color:#94a3b8;font-size:12px;margin:0 0 20px;}
      .pagefilters{border:1px solid #cbd5e1;border-radius:12px;padding:14px 18px;margin:0 0 24px;background:#f8fafc;}
      .pagefilters h2{font-size:14px;margin:0 0 8px;color:#334155;text-transform:uppercase;letter-spacing:.5px;}
      .meta{font-size:11.5px;color:#64748b;margin:0 0 10px;}
      ul.filters{margin:4px 0 0;padding-left:18px;font-size:12.5px;color:#334155;line-height:1.6;}
      ul.filters .fdim{font-weight:700;color:#0f172a;}
      .muted{color:#94a3b8;}
      .nofilter{color:#94a3b8;font-size:12px;font-style:italic;margin:4px 0 0;}
      .card{border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px 14px;margin:0 0 18px;page-break-inside:avoid;break-inside:avoid;}
      .card-text{background:#fffef7;border-color:#fde68a;}
      .visual{margin:6px 0 12px;}
      .chart{width:100%;overflow:hidden;}
      .textbox{font-size:13px;line-height:1.6;color:#334155;white-space:pre-wrap;}
      .kpi{text-align:center;padding:16px 0;}
      .kpi-metric{font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px;}
      .kpi-big{font-size:44px;font-weight:700;color:#0f172a;line-height:1.1;margin:8px 0 4px;}
      .kpi-scen{font-size:12px;color:#94a3b8;}
      .kpi-base{font-size:12.5px;color:#475569;margin-top:8px;}
      .wfilters{border-top:1px dashed #e2e8f0;padding-top:10px;}
      .wfilters-title{font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px;margin-bottom:6px;}
      .wfilters-sub{font-size:11.5px;font-weight:600;color:#64748b;margin-top:6px;}
      @media print{body{padding:0;} .card,.pagefilters{box-shadow:none;}}
    </style>`;

    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Dashboard — Exportação</title>${style}</head><body>
      <h1>Dashboard de Simulação de Crédito</h1>
      <p class="sub">Exportado em ${escHtml(new Date().toLocaleString("pt-BR"))} · ${orderedWidgets.length} componente(s)</p>
      <div class="pagefilters">
        <h2>🔎 Filtro da página (visão geral — aplicado a todos os componentes)</h2>
        ${filtersBlockHTML(pageDescs, "Nenhum filtro de página aplicado — todos os componentes usam a base completa.")}
      </div>
      ${cards}
    </body></html>`;

    const win = typeof window !== "undefined" ? window.open("", "_blank") : null;
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch {} }, 400);
  };

  // ── Agrupamentos (dimensões derivadas) ──────────────────────────────────────
  const [editingGrouping, setEditingGrouping] = useState(null); // null | draft
  const newGrouping = () => setEditingGrouping({ id: null, name: "", source: "", buckets: [], unmatched: "other", otherLabel: GROUPING_OTHER_DEFAULT });
  const editGrouping = (id) => { const g = groupings.find(x => x.id === id); if (g) setEditingGrouping({ ...g }); };
  const deleteGrouping = (id) => setGroupings(prev => prev.filter(g => g.id !== id));
  const saveGrouping = (g) => {
    const isNew = !g.id;
    const withId = isNew ? { ...g, id: uid() } : g;
    // Renomeou? Migra as referências (Eixo X / Série) dos gráficos existentes.
    if (!isNew) {
      const prevName = groupings.find(x => x.id === g.id)?.name;
      if (prevName && prevName !== g.name) {
        setAnalyticsLayout(prev => prev.map(w => {
          const c = w.config; let nc = c;
          if (c.xDimension === prevName) nc = { ...nc, xDimension: g.name };
          if (c.serieBy === prevName) nc = { ...nc, serieBy: g.name };
          return nc === c ? w : { ...w, config: nc };
        }));
      }
    }
    setGroupings(prev => isNew ? [...prev, withId] : prev.map(x => x.id === g.id ? withId : x));
    setEditingGrouping(null);
  };
  // Nomes já em uso (dimensões reais + outros agrupamentos) — bloqueia colisão.
  const existingNames = useMemo(() => {
    const real = (baseDataset?.dimensions || []).filter(d => !(baseDataset?.groupedDimensions || []).includes(d));
    const others = groupings.filter(g => !editingGrouping || g.id !== editingGrouping.id).map(g => g.name);
    return new Set([...real, ...others]);
  }, [baseDataset, groupings, editingGrouping]);

  const hasData = !!analyticsDataset;

  const layoutRef = useRef(analyticsLayout);
  useEffect(() => { layoutRef.current = analyticsLayout; }, [analyticsLayout]);
  const dragRef = useRef(null);

  const startWidgetInteract = (id, e, type, dir) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const wgt = layoutRef.current.find(w => w.id === id);
    if (!wgt) return;
    // Sem teto de tamanho — o usuário aumenta o quanto quiser (só um piso p/ não colapsar).
    // Caixas de texto podem ser menores que os gráficos.
    const isText = wgt.type === 'text';
    const minW = isText ? 160 : 340, minH = isText ? 100 : 340;
    dragRef.current = { id, type, dir, startX: e.clientX, startY: e.clientY, startWx: wgt.x ?? 24, startWy: wgt.y ?? 24, startW: wgt.w ?? 560, startH: wgt.h ?? 500, minW, minH };
    const onMove = (ev) => {
      const dr = dragRef.current; if (!dr) return;
      const dx = ev.clientX - dr.startX, dy = ev.clientY - dr.startY;
      if (dr.type === 'move') {
        setAnalyticsLayout(prev => prev.map(w => w.id === dr.id ? { ...w, x: Math.max(0, dr.startWx + dx), y: Math.max(0, dr.startWy + dy) } : w));
      } else {
        const d = dr.dir;
        let nx = dr.startWx, ny = dr.startWy, nw = dr.startW, nh = dr.startH;
        if (d.includes('e')) nw = Math.max(dr.minW, dr.startW + dx);
        if (d.includes('s')) nh = Math.max(dr.minH, dr.startH + dy);
        if (d.includes('w')) { nw = Math.max(dr.minW, dr.startW - dx); nx = Math.max(0, dr.startWx + dr.startW - nw); }
        if (d.includes('n')) { nh = Math.max(dr.minH, dr.startH - dy); ny = Math.max(0, dr.startWy + dr.startH - nh); }
        setAnalyticsLayout(prev => prev.map(w => w.id === dr.id ? { ...w, x: nx, y: ny, w: nw, h: nh } : w));
      }
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const canvasH = analyticsLayout.reduce((acc, w) => Math.max(acc, (w.y ?? 24) + (w.h ?? 500) + 80), 600);
  const canvasW = analyticsLayout.reduce((acc, w) => Math.max(acc, (w.x ?? 24) + (w.w ?? 560) + 40), 640);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row", overflow: "hidden", background: "#f8fafc" }}>
      {/* Área principal */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Aviso de escopo (DEC-FR-002) — declara quando o filtro de página veio de um
            cluster ESCOPADO (👁 Ver no Dashboard de uma Clusterização "aqui"). */}
        {scopeNotice && (
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "8px 28px",
            background: "#f5f3ff", borderBottom: "1px solid #ddd6fe", fontSize: 11.5, color: "#5b21b6", lineHeight: 1.5 }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>🧩</span>
            <span style={{ flex: 1 }}>{scopeNotice}</span>
            <button onClick={onDismissScopeNotice} title="Dispensar aviso"
              style={{ border: "none", background: "transparent", color: "#7c3aed", cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1, flexShrink: 0 }}>✕</button>
          </div>
        )}
        {/* Header fixo */}
        <div style={{ flexShrink: 0, padding: "20px 28px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: "#1e293b", letterSpacing: 0.2 }}>Dashboard</h1>
            <p style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 3 }}>
              Construa análises sobre os resultados da simulação · cenários lado a lado
            </p>
          </div>
          {hasData && (
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => exportAnalyticsDatasetCSV(analyticsDataset)}
                title="Exporta o dataset largo (dimensões + métricas + todos os cenários) como CSV"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9,
                  border: "1px solid #cbd5e1", background: "#fff", color: "#475569", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>⬇</span> Exportar CSV
              </button>
              <button onClick={exportDashboardPDF} disabled={analyticsLayout.length === 0}
                title="Exporta todos os componentes do Dashboard como PDF (via impressão do navegador), detalhando o filtro da página e os filtros de cada componente"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9,
                  border: "1px solid #cbd5e1", background: "#fff", color: analyticsLayout.length === 0 ? "#cbd5e1" : "#475569",
                  cursor: analyticsLayout.length === 0 ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>📄</span> Exportar PDF
              </button>
              <button onClick={addTextWidget}
                title="Adiciona uma caixa de texto livre para explicar análises e conclusões"
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9,
                  border: "1px solid #f59e0b", background: "#fffbeb", color: "#b45309", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>📝</span> Adicionar texto
              </button>
              <button onClick={addWidget}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9,
                  border: "1px solid #2563eb", background: "#2563eb", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit" }}>
                <span style={{ fontSize: 15, lineHeight: 1 }}>+</span> Adicionar gráfico
              </button>
            </div>
          )}
        </div>

        {/* Canvas — área scrollável com widgets posicionados livremente */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "auto" }}>
          {!hasData ? (
            <AWEmptyState icon="📊" title="Nenhum dado de simulação ainda"
              hint="Importe um CSV com a Decisão AS IS configurada e monte um fluxo no Canvas. Quando a simulação rodar, os gráficos aparecem aqui." />
          ) : analyticsLayout.length === 0 ? (
            <AWEmptyState icon="➕" title="Nenhum gráfico"
              hint='Clique em "+ Adicionar gráfico" para começar a montar seu dashboard.' />
          ) : (
            <div style={{ position: "relative", minHeight: canvasH, minWidth: canvasW }}>
              {analyticsLayout.map(w => (
                <div key={w.id} data-aw-widget-id={w.id} style={{ position: "absolute", left: w.x ?? 24, top: w.y ?? 24, width: w.w ?? 560, height: w.h ?? 500 }}>
                  {w.type === "text" ? (
                    <TextWidget widget={w}
                      onConfigChange={changeConfig} onDelete={removeWidget} onDuplicate={duplicateWidget}
                      onDragStart={(e) => startWidgetInteract(w.id, e, 'move', null)}
                      onResizeStart={(e, dir) => startWidgetInteract(w.id, e, 'resize', dir)} />
                  ) : (
                    <AnalyticsWidget widget={w} analyticsDataset={analyticsDataset} pageFilters={pageFilters}
                      onConfigChange={changeConfig} onTypeChange={changeType} onDelete={removeWidget} onDuplicate={duplicateWidget}
                      onDragStart={(e) => startWidgetInteract(w.id, e, 'move', null)}
                      onResizeStart={(e, dir) => startWidgetInteract(w.id, e, 'resize', dir)} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Painel de campos */}
      {hasData && <FieldPanel analyticsDataset={analyticsDataset} groupings={groupings}
        onNewGrouping={newGrouping} onEditGrouping={editGrouping} onDeleteGrouping={deleteGrouping}
        pageFilters={pageFilters} onPageFiltersChange={setPageFilters} />}

      {/* Modal de agrupamento */}
      {editingGrouping && (
        <GroupingModal draft={editingGrouping} baseDataset={baseDataset} existingNames={existingNames}
          onSave={saveGrouping} onClose={() => setEditingGrouping(null)} />
      )}
    </div>
  );
}

// Re-exportados para App.jsx (uso na árvore JSX do Shell e nos modais do Copiloto).
export {
  AnalysisTab, ExploreTab, SegmentFindingCard, DiagnosticsStrip, SegmentQuadrant,
  ClusterQuadrant, GoalSeekFrontierChart, ClusterCard, clusterColor, fmtPP,
};

