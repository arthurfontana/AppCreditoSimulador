import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";

// ── Build metadata (injected by Vite at build time) ──────────────────────────
const BUILD_NUMBER = typeof __BUILD_NUMBER__ !== "undefined" ? __BUILD_NUMBER__ : "dev";
const BUILD_TIME   = typeof __BUILD_TIME__   !== "undefined" ? __BUILD_TIME__   : new Date().toISOString();
const BUILD_HASH   = typeof __BUILD_HASH__   !== "undefined" ? __BUILD_HASH__   : "local";
const BUILD_BRANCH = typeof __BUILD_BRANCH__ !== "undefined" ? __BUILD_BRANCH__ : "local";
const BUILD_AUTHOR = typeof __BUILD_AUTHOR__ !== "undefined" ? __BUILD_AUTHOR__ : "";

function formatBuildTime(iso) {
  try {
    const d = new Date(iso);
    const day   = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year  = d.getFullYear();
    const hh    = String(d.getHours()).padStart(2, "0");
    const mm    = String(d.getMinutes()).padStart(2, "0");
    return { short: `${day}/${month} ${hh}:${mm}`, full: `${day}/${month}/${year} ${hh}:${mm}:${String(d.getSeconds()).padStart(2,"0")}` };
  } catch { return { short: "—", full: "—" }; }
}

function BuildBadge() {
  const [tip, setTip] = useState(false);
  const { short, full } = formatBuildTime(BUILD_TIME);
  const isRecent = Date.now() - new Date(BUILD_TIME).getTime() < 5 * 60 * 1000;

  return (
    <div style={{position:"relative",display:"inline-flex",alignItems:"center"}}
      onMouseEnter={()=>setTip(true)} onMouseLeave={()=>setTip(false)}>
      <span style={{
        fontSize:9.5,fontWeight:600,color:"#94a3b8",letterSpacing:.3,
        background:"#f1f5f9",borderRadius:6,padding:"2px 7px",cursor:"default",
        border:"1px solid #e2e8f0",whiteSpace:"nowrap",userSelect:"none",
        transition:"all .15s",
        ...(isRecent ? {color:"#16a34a",background:"#f0fdf4",borderColor:"#bbf7d0"} : {}),
      }}>
        #{BUILD_NUMBER} · {short}
      </span>
      {tip && (
        <div style={{
          position:"absolute",top:"calc(100% + 6px)",right:0,zIndex:9999,
          background:"#1e293b",color:"#f8fafc",borderRadius:8,
          padding:"10px 13px",fontSize:11,lineHeight:1.8,whiteSpace:"nowrap",
          boxShadow:"0 8px 24px rgba(0,0,0,.25)",pointerEvents:"none",
        }}>
          <div style={{fontWeight:700,fontSize:11.5,marginBottom:4,borderBottom:"1px solid #334155",paddingBottom:4}}>
            🏷 Build #{BUILD_NUMBER}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"1px 10px"}}>
            <span style={{color:"#94a3b8"}}>Deploy</span><span>{full}</span>
            <span style={{color:"#94a3b8"}}>Commit</span><span style={{fontFamily:"monospace"}}>{BUILD_HASH}</span>
            <span style={{color:"#94a3b8"}}>Branch</span><span style={{fontFamily:"monospace"}}>{BUILD_BRANCH}</span>
            {BUILD_AUTHOR && <><span style={{color:"#94a3b8"}}>Autor</span><span>{BUILD_AUTHOR}</span></>}
          </div>
          {isRecent && (
            <div style={{marginTop:6,paddingTop:5,borderTop:"1px solid #334155",color:"#4ade80",fontSize:10.5,fontWeight:600}}>
              ✓ Atualizado recentemente
            </div>
          )}
        </div>
      )}
    </div>
  );
}

let _id = 1;
const uid = () => `e${_id++}`;

// ── Constants ────────────────────────────────────────────────────────────────
const SW = 144, SH = 82;
const CSV_W = 500, CSV_H = 310, CSV_TH = 38; // title bar height
const CSV_MINI_W = 160, CSV_MINI_H = 64;
const MAX_ROWS = 200;
const MAX_DISTINCT = 10;

// ── Cineminha (Cross Decision Matrix) constants ───────────────────────────────
const CINEMA_CELL_W   = 70;
const CINEMA_CELL_H   = 30;
const CINEMA_TITLE_H  = 38;
const CINEMA_HDR_H    = 32;
const CINEMA_LBL_W    = 84;
const CINEMA_PAD      = 12;
const CINEMA_MAX_W    = 540;
const CINEMA_MAX_H    = 420;

const COLORS = ["#ffffff","#dbeafe","#fef3c7","#dcfce7","#fce7f3","#e0e7ff","#ffedd5","#fef9c3"];

// ── Cineminha typing system ───────────────────────────────────────────────────
const CINEMINHA_TYPES = {
  eligibility: {
    id: 'eligibility',
    label: 'Elegibilidade',
    icon: '🎯',
    desc: 'Aprovação ou reprovação de registro',
    color: '#6366f1',
    badgeBg: '#eef2ff',
    badgeFg: '#4f46e5',
    ports: [
      { label: 'Elegível',     color: '#f0fdf4' },
      { label: 'Não Elegível', color: '#fff1f2' },
    ],
  },
  offer: {
    id: 'offer',
    label: 'Oferta',
    icon: '💼',
    desc: 'Definição de grade ou nível de oferta',
    color: '#0891b2',
    badgeBg: '#ecfeff',
    badgeFg: '#0e7490',
    ports: [
      { label: 'Com Oferta',  color: '#ecfeff' },
      { label: 'Sem Oferta',  color: '#fef9c3' },
    ],
  },
};
const getCinemaType = (cinemaType) => CINEMINHA_TYPES[cinemaType] ?? CINEMINHA_TYPES.eligibility;

const TOOLS  = [
  { id:"hand",          icon:"✋",  label:"Mover"          },
  { id:"select",        icon:"↖",   label:"Selecionar"     },
  { id:"frame",         icon:"⬚",   label:"Frame"          },
  { id:"rect",          icon:"▭",   label:"Retângulo"      },
  { id:"cineminha",     icon:"⊞",   label:"Cineminha"      },
  { id:"decision_lens", icon:"🔎",  label:"Decision Lens"  },
  { id:"connect",       icon:"⟶",   label:"Conectar"       },
  { id:"approved",      icon:"✅",  label:"Aprovado"       },
  { id:"rejected",      icon:"❌",  label:"Reprovado"      },
  { id:"as_is",         icon:"⟳",   label:"AS IS"          },
];

// ── Decision Lens constants ───────────────────────────────────────────────────
const LENS_W = 182, LENS_H = 86;
const LENS_OPERATORS = [
  { value:"equal",    label:"Igual a"             },
  { value:"notEqual", label:"Diferente de"         },
  { value:"in",       label:"Está em uma lista"    },
  { value:"notIn",    label:"Não está em uma lista"},
  { value:"lt",       label:"Menor que"            },
  { value:"lte",      label:"Menor ou igual a"     },
  { value:"gt",       label:"Maior que"            },
  { value:"gte",      label:"Maior ou igual a"     },
];

const COL_TYPES = [
  { value:"id",            icon:"🔑", label:"ID",                shortLabel:"ID"       },
  { value:"decision",      icon:"🔀", label:"Filtro",            shortLabel:"Filtro"   },
  { value:"qty",           icon:"📊", label:"Vol. Propostas",    shortLabel:"Vol."     },
  { value:"qtdAltas",      icon:"📈", label:"Altas Reais",       shortLabel:"Altas R"  },
  { value:"qtdAltasInfer", icon:"🔮", label:"Conv. Inferida",    shortLabel:"Conv.I"   },
  { value:"inadReal",      icon:"⚠️", label:"Inad. Real",        shortLabel:"Inad.R"   },
  { value:"inadInferida",  icon:"🎯", label:"Inad. Inferida",    shortLabel:"Inad.I"   },
];

const DELIMITERS = [
  { value:",",  label:'Vírgula  ","'  },
  { value:";",  label:'Ponto e vírgula  ";"' },
  { value:"|",  label:'Pipe  "|"'     },
  { value:"\t", label:"Tabulação"      },
];

const VAR_TYPES = [
  { value:"ordinal",     label:"Ordinal",    icon:"📶" },
  { value:"categorical", label:"Categórica", icon:"🏷️" },
];

// Heuristics: infer whether a column is likely ordinal or categorical
function suggestVarType(colName, values) {
  const name = (colName || "").toLowerCase();
  const sample = values.slice(0, 200).map(v => String(v ?? "").trim()).filter(Boolean);
  if (!sample.length) return "categorical";

  // Name-based clues for ordinal
  const ordinalNamePat = /score|rating|rank|faixa|bucket|classe|tier|nivel|grau|nota|range|band|r\d|class|categoria\s*\d|grupo\s*\d/i;
  const nameHintsOrdinal = ordinalNamePat.test(colName);

  // All numeric?
  const allNum = sample.every(v => !isNaN(parseFloat(v)) && isFinite(Number(v)));
  if (allNum) return "ordinal";

  // Pattern like R1, R2 … R20 / AA, AB, AC / Score_01 etc.
  const seqPat = /^([a-zA-Z]{1,3})[\s\-_]?(\d{1,4})$/;
  const seqMatches = sample.filter(v => seqPat.test(v));
  if (seqMatches.length > sample.length * 0.7) return "ordinal";

  // Bucket patterns: "0-10", "10-20", ">50", "≤100"
  const bucketPat = /^\d[\d\s]*[-–]\d|^[<>≤≥]\s*\d/;
  const bucketMatches = sample.filter(v => bucketPat.test(v));
  if (bucketMatches.length > sample.length * 0.6) return "ordinal";

  // All values start with same alpha prefix followed by a number
  const prefixNum = /^([a-zA-Z]{1,4})\d+$/;
  const prefixMatches = sample.filter(v => prefixNum.test(v));
  if (prefixMatches.length > sample.length * 0.7) {
    const prefixes = new Set(prefixMatches.map(v => v.match(prefixNum)[1]));
    if (prefixes.size <= 3) return "ordinal";
  }

  // Name-based clue after data checks
  if (nameHintsOrdinal) return "ordinal";

  // Low cardinality with natural ordering detected by locale sort stability
  const distinct = [...new Set(sample)];
  const sorted = sortDomain(distinct);
  if (distinct.length >= 3 && distinct.length <= 20) {
    // Check if all values look like they have a natural order (sortDomain produced numeric-ish sequence)
    const numericLabels = sorted.every(v => !isNaN(parseFloat(v)) && isFinite(Number(v)));
    if (numericLabels) return "ordinal";
  }

  return "categorical";
}

function suggestMetricColumns(headers) {
  const patterns = [
    { type:'qty',           re: /qtd_proposta|qtd_prop|num_proposta|vol_proposta|qt_prop|count_prop|total_prop|qtde_prop/i },
    { type:'qtdAltas',      re: /qtd_altas?(?!.*infer)|qtd_aprov(?!.*infer)|num_altas?|vol_altas?|altas_reais/i },
    { type:'inadReal',      re: /qtd_atrs|qtd_inad(?!.*infer)|vol_atrs|over_30(?!.*infer)|parc_over(?!.*infer)|inadimpl(?!.*infer)|atraso(?!.*infer)|ftra_parc/i },
    { type:'qtdAltasInfer', re: /infer_conv|conv_infer|infer.*conv|altas_infer|qtd_infer_conv/i },
    { type:'inadInferida',  re: /infer.*atrs|infer.*inad|infer.*over|fl_atrs|inad_infer|inadimpl_infer|infer_fl/i },
  ];
  const result = {};
  const used = new Set();
  for (const {type, re} of patterns) {
    const match = headers.find(h => re.test(h) && !used.has(h));
    if (match) { result[type] = match; used.add(match); }
  }
  return result;
}

// ── CSV helpers ──────────────────────────────────────────────────────────────
function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).slice(0, 12).filter(l => l.trim());
  if (!lines.length) return { delimiter:",", confident:true };
  const scores = {};
  for (const d of [",",";","|","\t"]) {
    const counts = lines.map(l => l.split(d).length - 1);
    const avg = counts.reduce((a,b)=>a+b,0) / counts.length;
    if (avg < 1) { scores[d] = 0; continue; }
    const variance = counts.reduce((a,b)=>a+Math.abs(b-avg),0) / counts.length;
    scores[d] = avg / (variance + 1);
  }
  const sorted = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  const confident = sorted[0][1] > 0 && sorted[0][1] / (sorted[1][1]+0.01) > 1.8;
  return { delimiter: sorted[0][1] > 0 ? sorted[0][0] : ",", confident };
}

function detectDecimalSep(text, delimiter) {
  const lines = text.split(/\r?\n/).slice(1, 60).filter(l => l.trim());
  let commas = 0, dots = 0;
  for (const line of lines) {
    const cells = line.split(delimiter);
    for (const cell of cells) {
      const v = cell.trim();
      // Matches values like "0,394" or "1.234,56" (comma decimal) vs "0.394" or "1,234.56" (dot decimal)
      if (/^\-?\d+,\d+$/.test(v)) commas++;
      else if (/^\-?\d+\.\d+$/.test(v)) dots++;
    }
  }
  if (commas === 0 && dots === 0) return { decimalSep: '.', confident: false };
  const confident = Math.abs(commas - dots) / (commas + dots) > 0.7;
  return { decimalSep: commas >= dots ? ',' : '.', confident };
}

function parseCSV(text, delimiter, hasHeader) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const split = (line) => {
    const res = []; let f = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === delimiter && !q) { res.push(f.trim()); f = ""; }
      else f += c;
    }
    res.push(f.trim());
    return res;
  };
  if (!lines.length) return { headers:[], rows:[] };
  const first = split(lines[0]);
  const headers = hasHeader ? first : first.map((_,i)=>`Coluna ${i+1}`);
  const rows = (hasHeader ? lines.slice(1) : lines).map(split);
  return { headers, rows };
}

const tDist = (t) => { const dx=t[0].clientX-t[1].clientX,dy=t[0].clientY-t[1].clientY; return Math.sqrt(dx*dx+dy*dy); };
const trunc = (s, n) => s && s.length > n ? s.slice(0,n-1)+"…" : s;
const fmtQty = (n) => n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}k` : Number.isInteger(n) ? String(n) : n.toFixed(1);
const fmtPct = (v) => v === null ? "N/A" : `${(v * 100).toFixed(2)}%`;
const normalizeColName = (s) => (s || "").toLowerCase().replace(/[\s_\-\.]+/g, "").trim();
const normalizeDecimalSep = (rows, sep) => {
  if (sep === '.') return rows;
  return rows.map(row => row.map(cell => {
    const v = cell.trim();
    if (/^\-?\d+,\d+$/.test(v)) return v.replace(',', '.');
    return cell;
  }));
};

function sortDomain(values) {
  const allNum = values.length > 0 && values.every(v => v !== "" && !isNaN(parseFloat(v)) && isFinite(Number(v)));
  return allNum
    ? [...values].sort((a,b) => parseFloat(a)-parseFloat(b))
    : [...values].sort((a,b) => String(a).localeCompare(String(b),"pt-BR",{numeric:true,sensitivity:"base"}));
}

function computeCinemaSize(rowDomain, colDomain) {
  const nR = rowDomain.length, nC = colDomain.length;
  if (nR === 0 && nC === 0) return {w:170, h:100};
  const nCeff = Math.max(nC, 1), nReff = Math.max(nR, 1);
  const idealW = CINEMA_LBL_W + nCeff * CINEMA_CELL_W + CINEMA_PAD;
  const idealH = CINEMA_TITLE_H + CINEMA_HDR_H + nReff * CINEMA_CELL_H + CINEMA_PAD;
  return {
    w: Math.min(CINEMA_MAX_W, Math.max(210, idealW)),
    h: Math.min(CINEMA_MAX_H, Math.max(120, idealH)),
  };
}

// ── Color helpers ────────────────────────────────────────────────────────────
function lerpColor(a, b, t) {
  const ah=parseInt(a.slice(1),16), bh=parseInt(b.slice(1),16);
  const ar=(ah>>16)&255, ag=(ah>>8)&255, ab=ah&255;
  const br=(bh>>16)&255, bg=(bh>>8)&255, bb=bh&255;
  const r=Math.round(ar+(br-ar)*t), g=Math.round(ag+(bg-ag)*t), bl2=Math.round(ab+(bb-ab)*t);
  return `#${((1<<24)|(r<<16)|(g<<8)|bl2).toString(16).slice(1)}`;
}
function inadColor(t) { // t in [0,1]
  if (t<=0.5) return lerpColor("#86efac","#fde68a",t*2);
  return lerpColor("#fde68a","#fca5a5",(t-0.5)*2);
}

// ── Decision Lens helpers ────────────────────────────────────────────────────
function matchLensRule(cellVal, operator, ruleVal) {
  const cv = String(cellVal ?? "").trim();
  const rv = String(ruleVal ?? "").trim();
  const cvN = parseFloat(cv), rvN = parseFloat(rv);
  const numOk = !isNaN(cvN) && !isNaN(rvN);
  switch (operator) {
    case "equal":    return cv.toLowerCase() === rv.toLowerCase();
    case "notEqual": return cv.toLowerCase() !== rv.toLowerCase();
    case "in":       return rv.split(",").map(s=>s.trim().toLowerCase()).includes(cv.toLowerCase());
    case "notIn":    return !rv.split(",").map(s=>s.trim().toLowerCase()).includes(cv.toLowerCase());
    case "lt":       return numOk ? cvN < rvN : cv < rv;
    case "lte":      return numOk ? cvN <= rvN : cv <= rv;
    case "gt":       return numOk ? cvN > rvN : cv > rv;
    case "gte":      return numOk ? cvN >= rvN : cv >= rv;
    default: return true;
  }
}

function rowMatchesLensRules(row, headers, rules) {
  if (!rules || rules.length === 0) return true;
  let result = null;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const colIdx = headers.indexOf(rule.col);
    const cellVal = colIdx >= 0 ? (row[colIdx] ?? "") : "";
    const matches = matchLensRule(cellVal, rule.operator, rule.value ?? "");
    if (result === null) { result = matches; }
    else if (rule.logic === "OR") { result = result || matches; }
    else { result = result && matches; }
  }
  return result ?? true;
}

function computeLensPopulation(rules, csvStore) {
  let count = 0, total = 0;
  for (const csv of Object.values(csvStore)) {
    const types = csv.columnTypes || {};
    const qtyCol = Object.entries(types).find(([,t])=>t==='qty')?.[0];
    const qtyIdx = qtyCol ? csv.headers.indexOf(qtyCol) : -1;
    for (const row of csv.rows) {
      const qty = qtyIdx >= 0 ? (parseFloat(row[qtyIdx]) || 1) : 1;
      total += qty;
      if (rowMatchesLensRules(row, csv.headers, rules)) count += qty;
    }
  }
  return { count, total };
}

// ── Engine de População Impactada (Feature 4) ─────────────────────────────────
// Retorna {[csvId]: boolean[]} — índice por rowIdx, true = FLAG_POPULACAO_ALVO
function computeLensAffectedRows(lensShape, csvStore) {
  const rules = lensShape.rules || [];
  const result = {};
  for (const [csvId, csv] of Object.entries(csvStore)) {
    result[csvId] = csv.rows.map(row => rowMatchesLensRules(row, csv.headers, rules));
  }
  return result;
}

// ── Flow engine ──────────────────────────────────────────────────────────────
function buildFlowGraph(shapes, conns) {
  const out = {}, inc = {};
  for (const s of shapes) { out[s.id] = []; inc[s.id] = []; }
  for (const c of conns) {
    if (out[c.from]) out[c.from].push({to: c.to, label: c.label ?? ''});
    if (inc[c.to])   inc[c.to].push({from: c.from, label: c.label ?? ''});
  }
  return {out, inc};
}

function validateFlow(shapes, conns) {
  const errors = {};
  const FLOW = new Set(['decision','port','approved','rejected','as_is','cineminha','decision_lens']);
  const TERM = new Set(['approved','rejected','as_is']);
  const flowShapes = shapes.filter(s => FLOW.has(s.type));
  if (flowShapes.length === 0) return errors;
  const {out} = buildFlowGraph(shapes, conns);

  function dfs(nodeId, path) {
    if (path.has(nodeId)) { errors[nodeId] = 'Loop infinito detectado'; return false; }
    const node = shapes.find(s => s.id === nodeId);
    if (!node) return false;
    if (TERM.has(node.type)) return true;
    const edges = out[nodeId] || [];
    if (edges.length === 0) { errors[nodeId] = 'Caminho sem finalização'; return false; }
    path.add(nodeId);
    let ok = true;
    for (const e of edges) { if (!dfs(e.to, new Set(path))) ok = false; }
    if (!ok && !errors[nodeId]) errors[nodeId] = 'Possui caminhos sem finalização';
    return ok;
  }
  shapes.filter(s => s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens').forEach(d => dfs(d.id, new Set()));
  return errors;
}

// ── Exportação de Diagnóstico de Simulação ────────────────────────────────────
// Gera CSV com visão de funil por nó+valor: qty_entrada, aprovados, reprovados,
// numeradores e denominadores brutos das inadimplências.
function exportDiagnosticCSV(shapes, conns, csvStore) {
  const {out} = buildFlowGraph(shapes, conns);
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const TERM = new Set(['approved','rejected','as_is']);
  const portIds = new Set(shapes.filter(s => s.type === 'port').map(s => s.id));
  const decWithPortInc = new Set(conns.filter(c => portIds.has(c.from)).map(c => c.to));
  const rootNodes = shapes.filter(s =>
    (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') && !decWithPortInc.has(s.id)
  );
  if (rootNodes.length === 0) return;

  const edgeLookup = {};
  for (const c of conns) {
    if (!edgeLookup[c.from]) edgeLookup[c.from] = {};
    edgeLookup[c.from][`${c.to}::${c.label??''}`] = c.id;
  }

  // nodeValAcc: { [nodeId_label]: { nodeName, stepOrder, label, qty, approvedQty, rejectedQty, qtdAltasSum, qtdAltasInferSum, inadRealSum, inadInferidaSum } }
  const nodeValAcc = {};
  const nodeOrder = {};
  let stepCounter = 0;

  function getNodeLabel(node) {
    if (node.type === 'decision') return node.label || node.variableCol || node.id;
    if (node.type === 'cineminha') return node.label || 'Cineminha';
    if (node.type === 'decision_lens') return node.label || 'Decision Lens';
    return node.label || node.id;
  }

  function accKey(nodeId, val) { return `${nodeId}__${val}`; }

  function initAcc(nodeId, val, nodeName) {
    const k = accKey(nodeId, val);
    if (!nodeValAcc[k]) {
      if (nodeOrder[nodeId] === undefined) { nodeOrder[nodeId] = stepCounter++; }
      nodeValAcc[k] = { nodeName, stepOrder: nodeOrder[nodeId], label: val, qty: 0, approvedQty: 0, rejectedQty: 0, qtdAltasSum: 0, qtdAltasInferSum: 0, inadRealSum: 0, inadInferidaSum: 0 };
    }
    return k;
  }

  function traverseRow(row, headers, startId) {
    let cur = startId;
    const visited = new Set();
    const stops = []; // [{nodeId, val}]
    while (cur) {
      if (visited.has(cur)) break;
      visited.add(cur);
      const node = shapesMap[cur]; if (!node) break;
      if (TERM.has(node.type)) break;
      if (node.type === 'decision') {
        const ci = headers.indexOf(node.variableCol);
        const val = (ci >= 0 ? (row[ci] ?? '') : '').trim();
        stops.push({ nodeId: cur, val, nodeName: getNodeLabel(node) });
        const match = (out[cur] || []).find(e => (e.label ?? '').trim() === val);
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const ri = node.rowVar ? headers.indexOf(node.rowVar.col) : -1;
        const ci = node.colVar ? headers.indexOf(node.colVar.col) : -1;
        const rv = node.rowVar && ri >= 0 ? (row[ri] ?? '').trim() : '*';
        const cv = node.colVar && ci >= 0 ? (row[ci] ?? '').trim() : '*';
        const cellKey = `${rv}|${cv}`;
        stops.push({ nodeId: cur, val: cellKey, nodeName: getNodeLabel(node) });
        const isEligible = isCellEligible(node.cells, cellKey);
        const typeCfg = getCinemaType(node.cinemaType);
        const targetLabel = isEligible ? typeCfg.ports[0].label : typeCfg.ports[1].label;
        const match = (out[cur] || []).find(e => e.label === targetLabel);
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'port') {
        const edges = out[cur] || []; if (edges.length === 0) break;
        cur = edges[0].to;
      } else break;
    }
    const termNode = shapesMap[cur];
    const result = termNode && TERM.has(termNode.type) ? termNode.type : null;
    return { stops, result };
  }

  let totalQty = 0, totalApproved = 0, totalRejected = 0;
  let gQtdAltasSum = 0, gQtdAltasInferSum = 0, gInadRealSum = 0, gInadInferidaSum = 0;

  for (const [csvId, csv] of Object.entries(csvStore)) {
    const types = csv.columnTypes || {};
    const colIdx = (type) => { const col = Object.entries(types).find(([,t]) => t === type)?.[0]; return col ? csv.headers.indexOf(col) : -1; };
    const qtyIdx = colIdx('qty'), qtdAltasIdx = colIdx('qtdAltas'), qtdAltasInferIdx = colIdx('qtdAltasInfer');
    const inadRealIdx = colIdx('inadReal'), inadInferidaIdx = colIdx('inadInferida');
    const dOrigIdx = csv.headers.indexOf('__DECISAO_ORIGINAL');
    const csvRoots = rootNodes.filter(d => {
      if (d.type === 'decision') return d.csvId === csvId;
      if (d.type === 'cineminha') return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      return true;
    });
    if (csvRoots.length === 0) continue;
    const rootId = csvRoots[0].id;

    for (const row of csv.rows) {
      const qty = qtyIdx >= 0 ? (parseFloat(row[qtyIdx]) || 0) : 1;
      const qtdAltas = qtdAltasIdx >= 0 ? (parseFloat(row[qtdAltasIdx]) || 0) : 0;
      const qtdAltasInfer = qtdAltasInferIdx >= 0 ? (parseFloat(row[qtdAltasInferIdx]) || 0) : 0;
      const inadR = inadRealIdx >= 0 ? (parseFloat(row[inadRealIdx]) || 0) : 0;
      const inadI = inadInferidaIdx >= 0 ? (parseFloat(row[inadInferidaIdx]) || 0) : 0;
      totalQty += qty;

      const { stops, result } = traverseRow(row, csv.headers, rootId);
      let isApproved = result === 'approved';
      let isRejected = result === 'rejected';
      if (result === 'as_is') {
        const orig = dOrigIdx >= 0 ? String(row[dOrigIdx] ?? '').toUpperCase() : '';
        if (orig === 'APROVADO') isApproved = true;
        else if (orig === 'REPROVADO') isRejected = true;
      }
      if (isApproved) { totalApproved += qty; gQtdAltasSum += qtdAltas; gQtdAltasInferSum += qtdAltasInfer; gInadRealSum += inadR; gInadInferidaSum += inadI; }
      else if (isRejected) totalRejected += qty;

      for (const { nodeId, val, nodeName } of stops) {
        const k = initAcc(nodeId, val, nodeName);
        const a = nodeValAcc[k];
        a.qty += qty;
        if (isApproved) { a.approvedQty += qty; a.qtdAltasSum += qtdAltas; a.qtdAltasInferSum += qtdAltasInfer; a.inadRealSum += inadR; a.inadInferidaSum += inadI; }
        else if (isRejected) a.rejectedQty += qty;
      }
    }
  }

  // Build CSV rows
  const header = [
    'etapa','no','valor',
    'qty_entrada','qty_aprovado','qty_reprovado',
    'taxa_aprovacao',
    'inad_real_num','qtd_altas_den','inad_real_resultado',
    'inad_inf_num','qty_aprovado_den','inad_inf_resultado',
  ];

  const rows = Object.values(nodeValAcc)
    .sort((a, b) => a.stepOrder - b.stepOrder || a.nodeName.localeCompare(b.nodeName) || a.label.localeCompare(b.label))
    .map((a, i) => {
      const inadReal = a.qtdAltasSum > 0 ? a.inadRealSum / a.qtdAltasSum : null;
      const inadInf = a.qtdAltasInferSum > 0 ? a.inadInferidaSum / a.qtdAltasInferSum
                    : a.approvedQty > 0 ? a.inadInferidaSum / a.approvedQty : null;
      const apRate = a.qty > 0 ? a.approvedQty / a.qty : null;
      const inadInfDen = a.qtdAltasInferSum > 0 ? a.qtdAltasInferSum : a.approvedQty;
      return [
        a.stepOrder + 1, a.nodeName, a.label,
        a.qty, a.approvedQty, a.rejectedQty,
        apRate !== null ? (apRate * 100).toFixed(4) + '%' : 'N/A',
        a.inadRealSum.toFixed(6), a.qtdAltasSum, inadReal !== null ? (inadReal * 100).toFixed(4) + '%' : 'N/A',
        a.inadInferidaSum.toFixed(6), inadInfDen, inadInf !== null ? (inadInf * 100).toFixed(4) + '%' : 'N/A',
      ];
    });

  // Totals row
  const gInadReal = gQtdAltasSum > 0 ? gInadRealSum / gQtdAltasSum : null;
  const gInadInf = gQtdAltasInferSum > 0 ? gInadInferidaSum / gQtdAltasInferSum : totalApproved > 0 ? gInadInferidaSum / totalApproved : null;
  const gInadInfDen = gQtdAltasInferSum > 0 ? gQtdAltasInferSum : totalApproved;
  rows.unshift([
    '(total)', '— RESULTADO GLOBAL —', '—',
    totalQty, totalApproved, totalRejected,
    totalQty > 0 ? ((totalApproved / totalQty) * 100).toFixed(4) + '%' : 'N/A',
    gInadRealSum.toFixed(6), gQtdAltasSum, gInadReal !== null ? (gInadReal * 100).toFixed(4) + '%' : 'N/A',
    gInadInferidaSum.toFixed(6), gInadInfDen, gInadInf !== null ? (gInadInf * 100).toFixed(4) + '%' : 'N/A',
  ]);

  const escape = (v) => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [header, ...rows].map(r => r.map(escape).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `diagnostico_simulacao_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── Cell value helpers ───────────────────────────────────────────────────────
// Reads a cell's numeric result value with backward-compat for legacy booleans.
function getCellValue(cells, key) {
  const v = (cells ?? {})[key];
  if (v === false) return 0;
  if (v === undefined || v === null || v === true) return 1;
  return typeof v === 'number' ? v : 1;
}

function isCellEligible(cells, key) {
  return getCellValue(cells, key) > 0;
}

// ── populateCellsFromResultVar ───────────────────────────────────────────────
// Reads resultVar column from CSV rows and builds a cells object keyed by
// "rowVal|colVal". Uses the first matching row per combination.
// Non-numeric values map to 1 (present) or 0 (absent/empty).
function populateCellsFromResultVar(shape, csvStore) {
  const { rowVar, colVar, rowDomain, colDomain, resultVar } = shape;
  if (!resultVar) return shape.cells ?? {};
  const csv = csvStore[resultVar.csvId];
  if (!csv) return shape.cells ?? {};
  const resultColIdx = csv.headers.indexOf(resultVar.col);
  if (resultColIdx === -1) return shape.cells ?? {};
  const rowCI = rowVar && rowVar.csvId === resultVar.csvId ? csv.headers.indexOf(rowVar.col) : -1;
  const colCI = colVar && colVar.csvId === resultVar.csvId ? csv.headers.indexOf(colVar.col) : -1;
  const rDom = rowDomain?.length > 0 ? rowDomain : ['*'];
  const cDom = colDomain?.length > 0 ? colDomain : ['*'];
  const lookup = {};
  for (const row of csv.rows) {
    const rv = rowVar && rowCI >= 0 ? (row[rowCI] ?? '').toString().trim() : '*';
    const cv = colVar && colCI >= 0 ? (row[colCI] ?? '').toString().trim() : '*';
    const key = `${rv}|${cv}`;
    if (lookup[key] === undefined) {
      const raw = row[resultColIdx];
      const num = parseFloat(raw);
      lookup[key] = isNaN(num) ? (raw ? 1 : 0) : num;
    }
  }
  const newCells = {};
  for (const rv of rDom) for (const cv of cDom) {
    const key = `${rv}|${cv}`;
    newCells[key] = lookup[key] ?? 0;
  }
  return newCells;
}

// ── SimIndicators — right panel simulation card ───────────────────────────────
function SimIndicators({ simResult, csvStore, incrementalResult }) {
  const inc = incrementalResult;
  const hasInc = !!inc;
  const displayResult = hasInc ? inc.simulated : simResult;
  const hasData = displayResult.totalQty > 0;

  const rate = hasData ? displayResult.approvalRate : null;
  const irV = displayResult.inadReal;
  const iiV = displayResult.inadInferida;

  // Semantic color system — direction-aware
  const rateColor = rate === null ? "#94a3b8" : rate >= 70 ? "#22c55e" : rate >= 40 ? "#f59e0b" : "#ef4444";
  const inadColor = (v) => v === null ? "#64748b" : v > 0.05 ? "#ef4444" : v > 0.02 ? "#f59e0b" : "#22c55e";
  const deltaClr = (d, positiveHigh = true) => {
    if (d === null || d === undefined || isNaN(d)) return "#64748b";
    return positiveHigh ? (d > 0 ? "#4ade80" : d < 0 ? "#f87171" : "#64748b")
                        : (d < 0 ? "#4ade80" : d > 0 ? "#f87171" : "#64748b");
  };
  const fmtDelta = (d, scale = 100) => {
    if (d === null || isNaN(d)) return null;
    return `${d >= 0 ? '+' : '−'}${Math.abs(d * scale).toFixed(2)} p.p`;
  };

  const rateDelta = hasInc && inc.baseline.totalQty > 0 ? inc.simulated.approvalRate - inc.baseline.approvalRate : null;
  const irDelta = hasInc && irV !== null && inc.baseline.inadReal !== null ? irV - inc.baseline.inadReal : null;
  const iiDelta = hasInc && iiV !== null && inc.baseline.inadInferida !== null ? iiV - inc.baseline.inadInferida : null;

  // Hero KPI
  const heroVal = hasInc && rateDelta !== null ? (fmtDelta(rateDelta / 100) ?? '—') : (rate !== null ? `${rate.toFixed(1)}%` : '—');
  const heroLabel = hasInc && rateDelta !== null ? 'VARIAÇÃO NA APROVAÇÃO' : 'TAXA DE APROVAÇÃO';
  const heroColor = hasInc && rateDelta !== null ? deltaClr(rateDelta, true) : rateColor;
  const heroIsGood = hasInc && rateDelta !== null ? rateDelta > 0 : rate !== null && rate >= 50;


  // Context badges
  const badges = [];
  if (hasInc) {
    if (rateDelta !== null) {
      const txt = fmtDelta(rateDelta / 100);
      if (txt) badges.push({ text: `Δ Aprov. ${txt}`, bg: rateDelta > 0 ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)', color: rateDelta > 0 ? '#4ade80' : '#f87171' });
    }
    if (irDelta !== null && Math.abs(irDelta) > 0.0005) {
      const txt = fmtDelta(irDelta);
      if (txt) badges.push({ text: `Inad. ${txt}`, bg: irDelta < 0 ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)', color: irDelta < 0 ? '#4ade80' : '#f87171' });
    }
  }
  if (hasData && irV !== null) {
    const rl = irV > 0.05 ? 'Alto Risco' : irV > 0.02 ? 'Risco Moderado' : 'Baixo Risco';
    const rlColor = irV > 0.05 ? '#f87171' : irV > 0.02 ? '#fbbf24' : '#4ade80';
    badges.push({ text: rl, bg: rlColor + '22', color: rlColor });
  }

  const MCard = ({ label, value, delta, positiveHigh = true, sub }) => (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 9, padding: '8px 10px', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: '#e2e8f0', lineHeight: 1, fontFamily: "'DM Sans',system-ui,sans-serif" }}>{value}</div>
      {delta !== null && delta !== undefined && (
        <div style={{ fontSize: 9.5, fontWeight: 700, color: deltaClr(delta, positiveHigh), marginTop: 3 }}>
          {fmtDelta(delta)}
        </div>
      )}
      {sub && <div style={{ fontSize: 8, color: '#475569', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{
      marginTop: 10,
      background: 'linear-gradient(160deg, #0f172a 0%, #1a1040 100%)',
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: '0 4px 28px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.07)',
      fontFamily: "'DM Sans',system-ui,sans-serif",
    }}>
      {/* Header */}
      <div style={{ padding: '11px 13px 9px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: badges.length ? 8 : 0 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Business Impact</span>
          <span style={{ fontSize: 9, color: '#334155', fontWeight: 500 }}>
            {hasData ? `${fmtQty(displayResult.totalQty)} reg.` : 'sem dados'}
          </span>
        </div>
        {badges.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {badges.map((b, i) => (
              <span key={i} style={{ fontSize: 8.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: b.bg, color: b.color, letterSpacing: '0.03em' }}>{b.text}</span>
            ))}
          </div>
        )}
      </div>

      {/* Hero KPI */}
      <div style={{ padding: '16px 14px 12px', textAlign: 'center', position: 'relative', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {heroIsGood && hasData && (
          <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at 50% 0%, ${heroColor}20 0%, transparent 70%)`, pointerEvents: 'none' }}/>
        )}
        <div style={{ fontSize: 42, fontWeight: 900, color: hasData ? heroColor : '#1e293b', lineHeight: 1, letterSpacing: '-0.02em', fontFamily: "'DM Sans',system-ui,sans-serif" }}>
          {heroVal}
        </div>
        <div style={{ fontSize: 9.5, color: '#475569', fontWeight: 700, letterSpacing: '0.1em', marginTop: 5, textTransform: 'uppercase' }}>{heroLabel}</div>
        {hasInc && inc.baseline.totalQty > 0 && (
          <div style={{ fontSize: 9, color: '#334155', marginTop: 5 }}>
            {inc.baseline.approvalRate.toFixed(1)}% → {(displayResult.approvalRate ?? 0).toFixed(1)}%
          </div>
        )}
      </div>

      {/* Approval bar */}
      {hasData && (
        <div style={{ padding: '7px 13px 0' }}>
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', position: 'relative' }}>
            <div style={{ height: '100%', width: `${rate ?? 0}%`, borderRadius: 2, background: `linear-gradient(90deg, ${rateColor}99, ${rateColor})`, transition: 'width 0.4s ease' }}/>
            {hasInc && inc.baseline.totalQty > 0 && (
              <div style={{ position: 'absolute', top: 0, height: '100%', left: `${inc.baseline.approvalRate}%`, width: 2, background: 'rgba(255,255,255,0.35)', borderRadius: 1 }}/>
            )}
          </div>
        </div>
      )}

      {/* Metric Grid */}
      <div style={{ padding: '9px 11px 9px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <MCard label="Aprovação" value={rate !== null ? `${rate.toFixed(1)}%` : '—'} delta={rateDelta !== null ? rateDelta / 100 : null} positiveHigh={true} sub={hasData ? `✓ ${fmtQty(displayResult.approvedQty)} · ✗ ${fmtQty(displayResult.rejectedQty)}${simResult.asIsQty>0?` · ⟳${fmtQty(simResult.asIsQty)}`:""}` : null}/>
          <MCard label="Inad. Real" value={irV !== null ? fmtPct(irV) : '—'} delta={irDelta} positiveHigh={false} sub="∑ Inad / ∑ Altas"/>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <MCard label="Inad. Inferida" value={iiV !== null ? fmtPct(iiV) : '—'} delta={iiDelta} positiveHigh={false} sub="∑ Inad.I / Aprov."/>
          <MCard label="Vol. Aprovado" value={hasData ? fmtQty(displayResult.approvedQty) : '—'} delta={null} positiveHigh={true} sub={hasData ? `${(rate ?? 0).toFixed(1)}% da base` : null}/>
        </div>
      </div>

      {/* Efeito da Mudança */}
      {hasInc && inc.impacted.qty > 0 && (
        <div style={{ padding: '9px 11px 12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 9, color: '#a78bfa', fontWeight: 800, marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.08em' }}>⚡ Efeito da Mudança</div>
          {/* Volume row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
            <div style={{ background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 8, padding: '6px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 7.5, color: '#4ade80', fontWeight: 700, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Novos Aprovados</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#4ade80' }}>+{fmtQty(inc.impacted.rToA)}</div>
            </div>
            <div style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '6px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 7.5, color: '#f87171', fontWeight: 700, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Novos Reprovados</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#f87171' }}>−{fmtQty(inc.impacted.aToR)}</div>
            </div>
          </div>
          {/* Vendas row — only when conv. inferida is available */}
          {(inc.impacted.altasInferRtoA > 0 || inc.impacted.altasRealAtoR > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
              <div style={{ background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.15)', borderRadius: 8, padding: '6px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 7.5, color: '#86efac', fontWeight: 700, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Conv. Inferida</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#86efac' }}>+{fmtQty(inc.impacted.altasInferRtoA)}</div>
                <div style={{ fontSize: 7, color: '#475569', marginTop: 1 }}>altas estimadas</div>
              </div>
              <div style={{ background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.15)', borderRadius: 8, padding: '6px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: 7.5, color: '#fca5a5', fontWeight: 700, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Altas Reais Perdidas</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#fca5a5' }}>−{fmtQty(inc.impacted.altasRealAtoR)}</div>
                <div style={{ fontSize: 7, color: '#475569', marginTop: 1 }}>altas históricas</div>
              </div>
            </div>
          )}
          <div style={{ marginTop: 2, textAlign: 'center', fontSize: 8.5, color: '#475569' }}>
            {fmtQty(inc.impacted.qty)} registros impactados · {inc.impacted.pct.toFixed(1)}% da base
          </div>
        </div>
      )}
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [shapes, setShapes] = useState([]);
  const [conns,   setConns]   = useState([]);
  const [tool,       setTool]       = useState("hand");
  const [sel,        setSel]        = useState(null);
  const [fromId,     setFromId]     = useState(null);
  const [vp,         setVp]         = useState({x:20,y:40,s:1});
  const [edit,       setEdit]       = useState(null);
  const [palette,    setPalette]    = useState(false);
  const [hint,       setHint]       = useState(null);
  // CSV state
  const [csvStore,   setCsvStore]   = useState({});     // {[csvId]: {name,headers,rows,columnTypes}}
  const [wizard,     setWizard]     = useState(null);   // null | wizard obj
  const [activeCell, setActiveCell] = useState(null);   // {shapeId,csvId,ri,ci}
  // Credit simulator state
  const [editConn,   setEditConn]   = useState(null);   // {id, val} — edição de label de conexão
  const [panelDrag,  setPanelDrag]  = useState(null);   // {col, csvId} — drag em andamento
  const [ghostPos,   setGhostPos]   = useState(null);   // {x, y} — posição do ghost element
  const [importError,setImportError]= useState(null);   // string | null — erro de importação de fluxo
  const [importWarn, setImportWarn] = useState(null);   // string | null — aviso pós-importação
  const [exportModal,setExportModal]= useState(false);  // boolean — modal de escolha de exportação
  const [axisModal,  setAxisModal]  = useState(null);   // null | {shapeId, col, csvId}
  const [resultVarModal, setResultVarModal] = useState(null); // null | {shapeId} — modal de seleção de variável de resultado
  const [varSearch,  setVarSearch]  = useState("");     // filtro de busca no painel
  const [multiSel,   setMultiSel]   = useState(new Set()); // ids selecionados em grupo
  const [selRect,    setSelRect]    = useState(null);   // {x1,y1,x2,y2} rect de seleção (world coords)
  // Undo / Redo stacks — each entry is { shapes, conns }
  const [undoStack,  setUndoStack]  = useState([]);
  const [redoStack,  setRedoStack]  = useState([]);
  // Feature: analytics
  const [hoveredConn,       setHoveredConn]       = useState(null);
  const [hoveredConnPos,    setHoveredConnPos]    = useState(null); // {x,y} screen coords
  const [enableDynThickness,setEnableDynThickness] = useState(false);
  const [showEdgeVol,       setShowEdgeVol]        = useState(true);
  const [showEdgeInadReal,  setShowEdgeInadReal]   = useState(true);
  const [showEdgeInadInf,   setShowEdgeInadInf]    = useState(true);
  // Feature: tooltips
  const [tooltip,    setTooltip]    = useState(null);   // null | {x,y,lines:[]}
  // Optimization modal
  const [optimModal, setOptimModal] = useState(null);   // null | optim obj
  // Decision Lens modal
  const [lensModal,  setLensModal]  = useState(null);   // null | {shapeId, rules, population}
  // Cineminha toolbar dropdown
  const [cinemaDropdownOpen, setCinemaDropdownOpen] = useState(false);
  const [cinemaDropdownPos,  setCinemaDropdownPos]  = useState({x:0,y:0});
  const cinemaDropdownBtnRef = useRef(null);
  // Cineminha export/import
  const [cinemaImportModal, setCinemaImportModal] = useState(null); // null | {shapeId, config, step, rowMapping, colMapping, availableVars}
  // Cineminha library
  const [cinemaLibrary,      setCinemaLibrary]      = useState([]);   // array of saved cineminha items
  const [cinemaLibraryModal, setCinemaLibraryModal] = useState(null); // null | {mode:'browse'|'save', shapeId, search, filterType, saveMeta, overwriteId, selectedLibIds}
  const [libWizard,          setLibWizard]          = useState(null); // null | wizard de importação de biblioteca
  // Business Impact floating widget
  const [businessWidget, setBusinessWidget] = useState({ visible: false, x: 80, y: 80, w: 420, h: 520 });
  const tooltipTimer = useRef(null);

  // ── Refs ──────────────────────────────────────────────────────
  const svgRef        = useRef(null);
  const fileInputRef  = useRef(null);
  const dragR         = useRef(null);
  const pinchR        = useRef(null);
  const movedR        = useRef(false);
  const longTimer     = useRef(null);
  const connClickTimer= useRef(null);

  const vpR         = useRef(vp);         useEffect(()=>{vpR.current=vp},         [vp]);
  const shapesR     = useRef(shapes);     useEffect(()=>{shapesR.current=shapes},  [shapes]);
  const connsR      = useRef(conns);      useEffect(()=>{connsR.current=conns},    [conns]);
  const toolR       = useRef(tool);       useEffect(()=>{toolR.current=tool},      [tool]);
  const fromIdR     = useRef(fromId);     useEffect(()=>{fromIdR.current=fromId},  [fromId]);
  const editR       = useRef(edit);       useEffect(()=>{editR.current=edit},      [edit]);
  const csvStoreR   = useRef(csvStore);   useEffect(()=>{csvStoreR.current=csvStore},  [csvStore]);
  const activeCellR = useRef(activeCell); useEffect(()=>{activeCellR.current=activeCell},[activeCell]);
  const panelDragR  = useRef(panelDrag);  useEffect(()=>{panelDragR.current=panelDrag}, [panelDrag]);
  const editConnR   = useRef(editConn);   useEffect(()=>{editConnR.current=editConn},   [editConn]);
  const flowImportRef      = useRef(null);
  const cinemaImportRef    = useRef(null);
  const libFileInputRef    = useRef(null);
  const cinemaImportTarget = useRef(null);
  const prevToolR          = useRef(null);
  const axisModalR    = useRef(axisModal);  useEffect(()=>{axisModalR.current=axisModal},[axisModal]);
  const multiSelR     = useRef(multiSel);   useEffect(()=>{multiSelR.current=multiSel},   [multiSel]);
  const selRectR      = useRef(selRect);    useEffect(()=>{selRectR.current=selRect},      [selRect]);
  const selR          = useRef(sel);        useEffect(()=>{selR.current=sel},              [sel]);
  const undoStackR    = useRef(undoStack);  useEffect(()=>{undoStackR.current=undoStack},  [undoStack]);
  const redoStackR    = useRef(redoStack);  useEffect(()=>{redoStackR.current=redoStack},  [redoStack]);
  const lensModalR    = useRef(lensModal);  useEffect(()=>{lensModalR.current=lensModal},  [lensModal]);
  const businessWidgetR = useRef(businessWidget); useEffect(()=>{businessWidgetR.current=businessWidget},[businessWidget]);
  const cinemaLibraryR  = useRef(cinemaLibrary);  useEffect(()=>{cinemaLibraryR.current=cinemaLibrary}, [cinemaLibrary]);
  const bwDragR = useRef(null);

  // ── Web Worker — simulation off the main thread ───────────────
  const workerRef = useRef(null);
  const pendingOptimShapeIdRef = useRef(null);

  useEffect(() => {
    const worker = new Worker(new URL('./simulation.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (e) => {
      const { type: msgType } = e.data;
      if (msgType === 'SIMULATION_RESULT') {
        setSimResult(e.data.result);
      } else if (msgType === 'OVERLAY_RESULT') {
        setSimulationOverlay(e.data.overlay);
        setIncrementalResult(e.data.incrementalResult);
      } else if (msgType === 'OPTIM_RESULT') {
        const { shapeId, cellMetrics, frontier, scenarios, maxInadReal, maxInadInf } = e.data;
        if (pendingOptimShapeIdRef.current !== shapeId) return;
        pendingOptimShapeIdRef.current = null;
        const shape = shapesR.current.find(s => s.id === shapeId);
        if (!shape) return;
        const initCells = { ...(shape.cells || {}) };
        const totalQty  = Object.values(cellMetrics).reduce((s, m) => s + m.qty, 0);
        const initApprQty = Object.keys(initCells)
          .filter(k => isCellEligible(initCells, k))
          .reduce((s, k) => s + (cellMetrics[k]?.qty || 0), 0);
        const initRate = totalQty > 0 ? initApprQty / totalQty : 0;
        let initIdx = 0, bestD = Infinity;
        frontier.forEach((pt, i) => {
          const d = Math.abs(pt.approvalRate - initRate);
          if (d < bestD) { bestD = d; initIdx = i; }
        });
        setOptimModal({
          shapeId, cellMetrics, frontier, scenarios,
          activeCard:        'personalizado',
          proposedCells:     initCells,
          sliderApprovalIdx: initIdx,
          sliderInadReal:    maxInadReal || 0.2,
          sliderInadInf:     maxInadInf  || 0.2,
          maxInadReal:       maxInadReal || 0.2,
          maxInadInf:        maxInadInf  || 0.2,
          matrixZoom: 1, matrixPanX: 0, matrixPanY: 0,
        });
      }
    };
    return () => worker.terminate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep worker's csvStore in sync — send once per csvStore change (no debounce
  // needed here: UPDATE_CSV_STORE is lightweight and must arrive before any
  // subsequent RUN_SIMULATION / COMPUTE_OVERLAY that references the new data).
  useEffect(() => {
    workerRef.current?.postMessage({ type: 'UPDATE_CSV_STORE', csvStore });
  }, [csvStore]);

  // ── Simulation engine (reactive) ──────────────────────────────
  const flowErrors = useMemo(() => validateFlow(shapes, conns), [shapes, conns]);
  const [simResult, setSimResult] = useState(() => ({ totalQty:0, approvedQty:0, rejectedQty:0, asIsQty:0, approvalRate:0, inadReal:null, inadInferida:null, edgeStats:{} }));
  const simDebounceRef = useRef(null);
  useEffect(() => {
    clearTimeout(simDebounceRef.current);
    simDebounceRef.current = setTimeout(() => {
      workerRef.current?.postMessage({ type: 'RUN_SIMULATION', shapes: shapesR.current, conns: connsR.current });
    }, 300);
    return () => clearTimeout(simDebounceRef.current);
  }, [shapes, conns, csvStore]);

  // ── Engine de População Impactada (Feature 4) ─────────────────
  // lensPopulations: {[lensId]: {[csvId]: boolean[]}} — FLAG_POPULACAO_ALVO por linha
  // lensRulesKey: chave estável que só muda quando regras de um lens mudam (não quando x/y muda)
  const lensRulesKey = useMemo(() =>
    JSON.stringify(
      shapes
        .filter(s => s.type === 'decision_lens')
        .map(s => ({ id: s.id, rules: s.rules }))
    )
  , [shapes]);

  const lensPopulations = useMemo(() => {
    const result = {};
    for (const shape of shapes) {
      if (shape.type !== 'decision_lens') continue;
      result[shape.id] = computeLensAffectedRows(shape, csvStore);
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lensRulesKey, csvStore]);

  const lensPopulationsR = useRef(lensPopulations);
  useEffect(() => { lensPopulationsR.current = lensPopulations; }, [lensPopulations]);

  // ── Engine de Sobrescrita de Decisão Simulada (Feature 5) ──────
  // simulationOverlay: null | {[csvId]: {rowDecisions, summaryStats}}
  const [simulationOverlay, setSimulationOverlay] = useState(null);
  const simOverlayDebounceRef = useRef(null);
  useEffect(() => {
    clearTimeout(simOverlayDebounceRef.current);
    simOverlayDebounceRef.current = setTimeout(() => {
      workerRef.current?.postMessage({ type: 'COMPUTE_OVERLAY', shapes: shapesR.current, conns: connsR.current, lensPopulations: lensPopulationsR.current });
    }, 300);
    return () => clearTimeout(simOverlayDebounceRef.current);
  }, [shapes, conns, csvStore, lensPopulations]);

  // ── Feature 6: Reprocessamento Incremental de Indicadores ──────
  // incrementalResult: null | {baseline, simulated, impacted}
  // Computed in the worker alongside COMPUTE_OVERLAY to avoid re-scanning rows.
  const [incrementalResult, setIncrementalResult] = useState(null);

  // ── Business Widget drag/resize ───────────────────────────────
  const startBwDrag = (e, type, dir) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const bw = businessWidgetR.current;
    bwDragR.current = { type, dir, startX: e.clientX, startY: e.clientY, startWx: bw.x, startWy: bw.y, startW: bw.w, startH: bw.h };
    const onMove = (ev) => {
      const dr = bwDragR.current; if (!dr) return;
      const dx = ev.clientX - dr.startX, dy = ev.clientY - dr.startY;
      if (dr.type === 'move') {
        setBusinessWidget(p => ({ ...p, x: dr.startWx + dx, y: dr.startWy + dy }));
      } else {
        const d = dr.dir;
        let nx = dr.startWx, ny = dr.startWy, nw = dr.startW, nh = dr.startH;
        if (d.includes('e')) nw = Math.min(1400, Math.max(320, dr.startW + dx));
        if (d.includes('s')) nh = Math.min(1200, Math.max(220, dr.startH + dy));
        if (d.includes('w')) { nw = Math.min(1400, Math.max(320, dr.startW - dx)); nx = dr.startWx + dr.startW - nw; }
        if (d.includes('n')) { nh = Math.min(1200, Math.max(220, dr.startH - dy)); ny = dr.startWy + dr.startH - nh; }
        setBusinessWidget(p => ({ ...p, x: nx, y: ny, w: nw, h: nh }));
      }
    };
    const onUp = () => {
      bwDragR.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ── Geometry ──────────────────────────────────────────────────
  const getBR   = () => svgRef.current.getBoundingClientRect();
  const svgPt   = (cx,cy) => { const r=getBR(); return [cx-r.left,cy-r.top]; };
  const toWorld = (sx,sy) => { const {x,y,s}=vpR.current; return [(sx-x)/s,(sy-y)/s]; };
  const ctr     = (s) => [s.x+s.w/2, s.y+s.h/2];
  const getSid  = (el) => {
    while (el && el!==svgRef.current) {
      const v = el.getAttribute?.("data-sid"); if (v) return v;
      el = el.parentElement;
    }
    return null;
  };

  // ── Zoom ──────────────────────────────────────────────────────
  const doZoom = useCallback((sx,sy,f) => {
    setVp(v => { const ns=Math.max(0.1,Math.min(5,v.s*f)), wx=(sx-v.x)/v.s, wy=(sy-v.y)/v.s; return {s:ns,x:sx-wx*ns,y:sy-wy*ns}; });
  },[]);

  // ── Touch handlers ────────────────────────────────────────────
  const onTouchStart = useCallback((e) => {
    e.preventDefault(); clearTimeout(longTimer.current); movedR.current=false;
    const touches=e.touches;
    if (touches.length===2) {
      dragR.current=null;
      const r=getBR();
      pinchR.current={dist:tDist(touches),mx:(touches[0].clientX+touches[1].clientX)/2-r.left,my:(touches[0].clientY+touches[1].clientY)/2-r.top,vpSnap:{...vpR.current}};
      return;
    }
    const t=touches[0], [sx,sy]=svgPt(t.clientX,t.clientY), sid=getSid(e.target), curTool=toolR.current;
    if (sid && curTool!=="hand") {
      const shape=shapesR.current.find(s=>s.id===sid);
      if (!shape) return;
      if (curTool==="select") {
        const [wx,wy]=toWorld(sx,sy);
        if (shape.type==="csv" && !shape.minimized && wy>shape.y+CSV_TH) return;
        setSel(sid); setPalette(false);
        dragR.current={type:"shape",id:sid,sx,sy,offX:wx-shape.x,offY:wy-shape.y};
        longTimer.current=setTimeout(()=>{ if(!movedR.current){setHint(null);setEdit({id:sid,val:shape.label||""});}},620);
        setTimeout(()=>{ if(!movedR.current) setHint("Segure para editar..."); },200);
      } else if (curTool==="connect") {
        dragR.current={type:"tap-connect",id:sid};
      }
    } else {
      setSel(null); setFromId(null); setPalette(false); setActiveCell(null);
      const {x:ox,y:oy}=vpR.current;
      dragR.current={type:"pan",sx,sy,ox,oy};
    }
  },[]); // eslint-disable-line

  const onTouchMove = useCallback((e) => {
    e.preventDefault(); const touches=e.touches;
    if (touches.length===2 && pinchR.current) {
      const r=getBR(),mx=(touches[0].clientX+touches[1].clientX)/2-r.left,my=(touches[0].clientY+touches[1].clientY)/2-r.top;
      const scale=tDist(touches)/pinchR.current.dist;
      const {mx:pmx,my:pmy,vpSnap:{x:ox,y:oy,s:os}}=pinchR.current;
      const ns=Math.max(0.1,Math.min(5,os*scale)),wx=(pmx-ox)/os,wy=(pmy-oy)/os;
      setVp({s:ns,x:pmx-wx*ns+(mx-pmx),y:pmy-wy*ns+(my-pmy)}); return;
    }
    const dr=dragR.current; if (!dr) return;
    const t=touches[0],r=getBR(),sx=t.clientX-r.left,sy=t.clientY-r.top,dx=sx-dr.sx,dy=sy-dr.sy;
    if (Math.abs(dx)>5||Math.abs(dy)>5){movedR.current=true;setHint(null);clearTimeout(longTimer.current);}
    if (dr.type==="pan"){const ox=dr.ox,oy=dr.oy;setVp(v=>({...v,x:ox+dx,y:oy+dy}));}
    else if(dr.type==="shape"){const id=dr.id,offX=dr.offX,offY=dr.offY,{x:vx,y:vy,s}=vpR.current,wx=(sx-vx)/s,wy=(sy-vy)/s;setShapes(p=>p.map(sh=>sh.id===id?{...sh,x:wx-offX,y:wy-offY}:sh));}
  },[]); // eslint-disable-line

  const onTouchEnd = useCallback((e) => {
    e.preventDefault(); clearTimeout(longTimer.current); setHint(null);
    const moved=movedR.current,dr=dragR.current,curTool=toolR.current;
    if (!moved && dr) {
      if (dr.type==="tap-connect"){const sid=dr.id,fid=fromIdR.current;if(!fid){setFromId(sid);}else if(fid!==sid){if(!connsR.current.some(c=>c.from===fid&&c.to===sid))setConns(p=>[...p,{id:uid(),from:fid,to:sid}]);setFromId(null);}}
      if (dr.type==="pan"&&curTool!=="hand"&&curTool!=="select"&&curTool!=="connect"){const{x:vx,y:vy,s}=vpR.current,wx=(dr.sx-vx)/s,wy=(dr.sy-vy)/s;if(curTool==="cineminha"){createCinemaNode(wx,wy,'eligibility');}else if(curTool==="decision_lens"){createLensNode(wx,wy);}else if(curTool==="frame"){const id=uid();setShapes(p=>[...p,{id,type:"frame",x:wx-160,y:wy-120,w:320,h:240,label:"Frame",color:"rgba(219,234,254,0.25)"}]);setSel(id);}else{const id=uid();const isTerminal=curTool==="approved"||curTool==="rejected"||curTool==="as_is";const nw=isTerminal?120:SW,nh=isTerminal?44:SH;const lbl=curTool==="approved"?"Aprovado":curTool==="rejected"?"Reprovado":curTool==="as_is"?"AS IS":"";setShapes(p=>[...p,{id,type:curTool,x:wx-nw/2,y:wy-nh/2,w:nw,h:nh,label:lbl,color:"#ffffff"}]);setSel(id);}}
    }
    dragR.current=null; pinchR.current=null; movedR.current=false;
  },[]); // eslint-disable-line

  const onWheel = useCallback((e)=>{e.preventDefault();const[sx,sy]=svgPt(e.clientX,e.clientY);doZoom(sx,sy,e.deltaY<0?1.12:0.9);},[doZoom]);

  useEffect(()=>{
    const el=svgRef.current,o={passive:false};
    el.addEventListener("touchstart",onTouchStart,o); el.addEventListener("touchmove",onTouchMove,o);
    el.addEventListener("touchend",onTouchEnd,o);     el.addEventListener("touchcancel",onTouchEnd,o);
    el.addEventListener("wheel",onWheel,o);
    const onMidDown=(e)=>{
      if (e.button!==1) return;
      e.preventDefault();
      movedR.current=false;
      const r=el.getBoundingClientRect();
      const sx=e.clientX-r.left, sy=e.clientY-r.top;
      prevToolR.current=toolR.current;
      dragR.current={type:"midpan",sx,sy,ox:vpR.current.x,oy:vpR.current.y};
    };
    el.addEventListener("mousedown",onMidDown,o);
    return()=>{el.removeEventListener("touchstart",onTouchStart);el.removeEventListener("touchmove",onTouchMove);el.removeEventListener("touchend",onTouchEnd);el.removeEventListener("touchcancel",onTouchEnd);el.removeEventListener("wheel",onWheel);el.removeEventListener("mousedown",onMidDown);};
  },[onTouchStart,onTouchMove,onTouchEnd,onWheel]);

  // ── Mouse handlers ────────────────────────────────────────────
  const onCanvasDown = (e) => {
    if (panelDragR.current) return;
    if (e.button!==0) return;
    movedR.current=false; setSel(null); setFromId(null); setPalette(false); setActiveCell(null);
    const [sx,sy]=svgPt(e.clientX,e.clientY);
    if (toolR.current==="select") {
      // start selection rectangle in world coords
      const [wx,wy]=toWorld(sx,sy);
      setMultiSel(new Set());
      setSelRect(null);
      dragR.current={type:"selRect",sx,sy,wx,wy};
    } else {
      setMultiSel(new Set());
      dragR.current={type:"pan",sx,sy,ox:vp.x,oy:vp.y};
    }
  };
  const onCanvasClick = (e) => {
    if (movedR.current) return;
    if (tool==="cineminha") {
      const [sx,sy]=svgPt(e.clientX,e.clientY),[wx,wy]=toWorld(sx,sy);
      createCinemaNode(wx, wy, 'eligibility'); return;
    }
    if (tool==="decision_lens") {
      const [sx,sy]=svgPt(e.clientX,e.clientY),[wx,wy]=toWorld(sx,sy);
      createLensNode(wx,wy); return;
    }
    if (tool==="frame") {
      pushHistory();
      const [sx,sy]=svgPt(e.clientX,e.clientY),[wx,wy]=toWorld(sx,sy),id=uid();
      setShapes(p=>[...p,{id,type:"frame",x:wx-160,y:wy-120,w:320,h:240,label:"Frame",color:"rgba(219,234,254,0.25)"}]);
      setSel(id); return;
    }
    if (tool!=="hand"&&tool!=="select"&&tool!=="connect") {
      pushHistory();
      const [sx,sy]=svgPt(e.clientX,e.clientY),[wx,wy]=toWorld(sx,sy),id=uid();
      const isTerminal=tool==="approved"||tool==="rejected"||tool==="as_is";
      const nw=isTerminal?120:SW, nh=isTerminal?44:SH;
      const lbl=tool==="approved"?"Aprovado":tool==="rejected"?"Reprovado":tool==="as_is"?"AS IS":"";
      setShapes(p=>[...p,{id,type:tool,x:wx-nw/2,y:wy-nh/2,w:nw,h:nh,label:lbl,color:"#ffffff"}]);
      setSel(id);
    }
  };
  const onShapeDown = (e, id) => {
    e.stopPropagation(); if (e.button!==0) return;
    movedR.current=false;
    const shape=shapesR.current.find(s=>s.id===id);
    if (tool==="select") {
      if (shape?.type==="csv"&&!shape.minimized) {
        const [sx,sy]=svgPt(e.clientX,e.clientY),[,wy]=toWorld(sx,sy);
        if (wy>shape.y+CSV_TH) return;
      }
      if (shape?.type==="cineminha"&&(shape.rowVar||shape.colVar)) {
        const [sx,sy]=svgPt(e.clientX,e.clientY),[,wy]=toWorld(sx,sy);
        if (wy>shape.y+CINEMA_TITLE_H) return;
      }
      const [sx,sy]=svgPt(e.clientX,e.clientY),[wx,wy]=toWorld(sx,sy);
      const ms=multiSelR.current;
      if (e.ctrlKey||e.metaKey) {
        // CTRL+click: toggle in multiSel, handle via onShapeClick
        dragR.current=null;
        return;
      }
      const preSnap={shapes:shapesR.current,conns:connsR.current};
      if (ms.size>1&&ms.has(id)) {
        // drag entire multi-selection — snapshot positions
        const snaps={};
        shapesR.current.forEach(s=>{if(ms.has(s.id)) snaps[s.id]={x:s.x,y:s.y};});
        dragR.current={type:"shape",id,sx,sy,offX:wx-shape.x,offY:wy-shape.y,wx0:wx,wy0:wy,snaps,preSnap};
      } else {
        setSel(id); setMultiSel(new Set()); setPalette(false);
        dragR.current={type:"shape",id,sx,sy,offX:wx-shape.x,offY:wy-shape.y,snaps:{},preSnap};
      }
    }
  };
  const onShapeClick = (e, id) => {
    e.stopPropagation(); if (movedR.current) return;
    if (tool==="connect"){
      const s=shapes.find(sh=>sh.id===id);
      if (s?.type==="simPanel") return; // simPanel cannot be connected
      if(!fromId){setFromId(id);}
      else if(fromId!==id){
        const fromShape=shapes.find(sh=>sh.id===fromId);
        if (fromShape?.type!=="simPanel") {
          if(!conns.some(c=>c.from===fromId&&c.to===id)){pushHistory();setConns(p=>[...p,{id:uid(),from:fromId,to:id}]);}
        }
        setFromId(null);
      }
    }
    else if(tool==="select") {
      if (e.ctrlKey||e.metaKey) {
        // CTRL+click: toggle item in multi-selection
        setMultiSel(prev=>{const n=new Set(prev);if(n.has(id))n.delete(id);else n.add(id);return n;});
        setSel(null);
      } else {
        setSel(id);
      }
    }
  };
  const onShapeDbl = (e, id) => {
    e.stopPropagation();
    const s=shapesR.current.find(s=>s.id===id);
    if (s&&s.type!=="csv") setEdit({id,val:s.label||""});
  };
  const onMouseMove = (e) => {
    const dr=dragR.current; if (!dr) return;
    const [sx,sy]=svgPt(e.clientX,e.clientY),dx=sx-dr.sx,dy=sy-dr.sy;
    if (Math.abs(dx)>3||Math.abs(dy)>3) movedR.current=true;
    if (dr.type==="pan"||dr.type==="midpan"){const ox=dr.ox,oy=dr.oy;setVp(v=>({...v,x:ox+dx,y:oy+dy}));}
    else if(dr.type==="shape"){
      const id=dr.id,offX=dr.offX,offY=dr.offY,[wx,wy]=toWorld(sx,sy);
      const ms=multiSelR.current;
      if (ms.size>1&&ms.has(id)) {
        // move all selected shapes preserving relative positions
        const deltX=wx-dr.wx0, deltY=wy-dr.wy0;
        setShapes(p=>p.map(s=>{
          const snap=dr.snaps[s.id]; if(!snap) return s;
          return {...s,x:snap.x+deltX,y:snap.y+deltY};
        }));
      } else {
        setShapes(p=>p.map(s=>s.id===id?{...s,x:wx-offX,y:wy-offY}:s));
      }
    }
    else if(dr.type==="selRect"){
      const [wx,wy]=toWorld(sx,sy);
      const rect={x1:dr.wx,y1:dr.wy,x2:wx,y2:wy};
      setSelRect(rect);
      // Highlight intersecting shapes
      const rx1=Math.min(rect.x1,rect.x2),ry1=Math.min(rect.y1,rect.y2);
      const rx2=Math.max(rect.x1,rect.x2),ry2=Math.max(rect.y1,rect.y2);
      const hit=new Set(shapesR.current.filter(s=>s.type!=="frame"&&s.x<rx2&&s.x+s.w>rx1&&s.y<ry2&&s.y+s.h>ry1).map(s=>s.id));
      setMultiSel(hit);
    }
    else if(dr.type==="resize"){
      const {id,dir,sx:dsx,sy:dsy,ix,iy,iw,ih}=dr;
      const ddx=(sx-dsx)/vpR.current.s, ddy=(sy-dsy)/vpR.current.s;
      const MIN=80;
      setShapes(p=>p.map(s=>{
        if(s.id!==id) return s;
        let {x:nx,y:ny,w:nw,h:nh}={x:ix,y:iy,w:iw,h:ih};
        if(dir.includes("e")) nw=Math.max(MIN,iw+ddx);
        if(dir.includes("s")) nh=Math.max(MIN,ih+ddy);
        if(dir.includes("w")){nw=Math.max(MIN,iw-ddx);nx=ix+iw-nw;}
        if(dir.includes("n")){nh=Math.max(MIN,ih-ddy);ny=iy+ih-nh;}
        return {...s,x:nx,y:ny,w:nw,h:nh};
      }));
    }
  };
  const onMouseUp = () => {
    const dr=dragR.current;
    // Push pre-drag snapshot to undo stack when a real move/resize completed
    if ((dr?.type==="shape"||dr?.type==="resize")&&movedR.current&&dr.preSnap) {
      setUndoStack(prev=>[...prev.slice(-49),dr.preSnap]);
      setRedoStack([]);
    }
    if(dr?.type==="selRect") setSelRect(null);
    if(dr?.type==="midpan"&&prevToolR.current!=null) setTool(prevToolR.current);
    dragR.current=null;
  };

  // ── History (Undo / Redo) ────────────────────────────────────
  const pushHistory = useCallback(() => {
    const snap = { shapes: shapesR.current, conns: connsR.current };
    setUndoStack(prev => [...prev.slice(-49), snap]);
    setRedoStack([]);
  }, []); // eslint-disable-line

  const undo = useCallback(() => {
    const stack = undoStackR.current;
    if (stack.length === 0) return;
    const snap = stack[stack.length - 1];
    const cur = { shapes: shapesR.current, conns: connsR.current };
    setRedoStack(prev => [...prev.slice(-49), cur]);
    setUndoStack(prev => prev.slice(0, -1));
    setShapes(snap.shapes);
    setConns(snap.conns);
    setSel(null); setMultiSel(new Set());
  }, []); // eslint-disable-line

  const redo = useCallback(() => {
    const stack = redoStackR.current;
    if (stack.length === 0) return;
    const snap = stack[stack.length - 1];
    const cur = { shapes: shapesR.current, conns: connsR.current };
    setUndoStack(prev => [...prev.slice(-49), cur]);
    setRedoStack(prev => prev.slice(0, -1));
    setShapes(snap.shapes);
    setConns(snap.conns);
    setSel(null); setMultiSel(new Set());
  }, []); // eslint-disable-line

  const deleteSelected = useCallback(() => {
    const ids = multiSelR.current.size > 0 ? [...multiSelR.current] : (selR.current ? [selR.current] : []);
    if (ids.length === 0) return;
    pushHistory();
    const allRemove = new Set(ids);
    const shapes_ = shapesR.current;
    const conns_  = connsR.current;
    for (const id of ids) {
      const shape = shapes_.find(s=>s.id===id);
      if (shape?.type==="decision"||shape?.type==="cineminha") {
        conns_.filter(c=>c.from===id).forEach(c=>{
          if (shapes_.find(s=>s.id===c.to&&s.type==="port")) allRemove.add(c.to);
        });
      }
    }
    setShapes(p=>p.filter(s=>!allRemove.has(s.id)));
    setConns(p=>p.filter(c=>!allRemove.has(c.from)&&!allRemove.has(c.to)));
    setSel(null); setMultiSel(new Set()); setPalette(false);
  }, []); // eslint-disable-line

  // ── Keyboard ──────────────────────────────────────────────────
  useEffect(()=>{
    const h=(e)=>{
      if (editR.current) return;
      const ac=activeCellR.current;
      if (ac) {
        const arrows=["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"];
        if (e.key==="Escape"){setActiveCell(null);return;}
        if (arrows.includes(e.key)) {
          e.preventDefault(); e.stopPropagation();
          const csv=csvStoreR.current[ac.csvId]; if(!csv) return;
          let {ri,ci}=ac;
          const maxR=Math.min(csv.rows.length,MAX_ROWS)-1, maxC=csv.headers.length-1;
          if (e.key==="ArrowUp")    ri=Math.max(0,ri-1);
          if (e.key==="ArrowDown")  ri=Math.min(maxR,ri+1);
          if (e.key==="ArrowLeft")  ci=Math.max(0,ci-1);
          if (e.key==="ArrowRight") ci=Math.min(maxC,ci+1);
          setActiveCell({...ac,ri,ci});
          return;
        }
      }
      // Undo / Redo
      if (e.ctrlKey||e.metaKey) {
        if (e.key==="z"||e.key==="Z") { e.preventDefault(); undo(); return; }
        if (e.key==="y"||e.key==="Y") { e.preventDefault(); redo(); return; }
      }
      if (e.key==="Delete"||e.key==="Backspace") {
        const ms=multiSelR.current;
        if (ms.size>0||selR.current) deleteSelected();
      }
      if (e.key==="Escape"){setFromId(null);setSel(null);}
    };
    window.addEventListener("keydown",h); return()=>window.removeEventListener("keydown",h);
  },[undo, redo, deleteSelected]);

  const zoomCenter=(f)=>{const r=getBR();doZoom(r.width/2,r.height/2,f);};

  // ── CSV import ────────────────────────────────────────────────
  const onFileChange = (e) => {
    const file=e.target.files[0]; if (!file) return;
    const reader=new FileReader();
    reader.onload=(ev)=>{
      const text=ev.target.result;
      const {delimiter,confident}=detectDelimiter(text);
      const {decimalSep, confident: decConfident}=detectDecimalSep(text, delimiter);
      setWizard({rawText:text,filename:file.name,delimiter,detected:delimiter,confident,hasHeader:true,step:1,columnTypes:{},varTypes:{},asIsVar:null,asIsMapping:{},editCsvId:null,decimalSep,decimalSepConfident:decConfident});
    };
    reader.readAsText(file);
    e.target.value="";
  };

  const onLibFileChange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const { delimiter, confident } = detectDelimiter(text);
      setLibWizard({ rawText: text, filename: file.name, delimiter, detected: delimiter, confident, hasHeader: true, step: 1, columnRoles: {}, agrupadorOrder: [], resultadoMapping: {}, rowLabelCol: null, colLabelCol: null });
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const onLibWizardConfirm = () => {
    if (!libWizard) return;
    const { headers, rows } = parseCSV(libWizard.rawText, libWizard.delimiter, libWizard.hasHeader);
    const { columnRoles, agrupadorOrder, resultadoMapping, rowLabelCol, colLabelCol } = libWizard;
    const linhaCol = Object.entries(columnRoles).find(([,v]) => v === 'linha')?.[0] ?? null;
    const colunaCol = Object.entries(columnRoles).find(([,v]) => v === 'coluna')?.[0] ?? null;
    const resultadoCol = Object.entries(columnRoles).find(([,v]) => v === 'resultado')?.[0] ?? null;
    const agrupadores = agrupadorOrder.filter(c => columnRoles[c] === 'agrupador');

    const groups = new Map();
    for (const row of rows) {
      const obj = Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']));
      const groupKey = agrupadores.length > 0 ? agrupadores.map(a => obj[a]).join(' | ') : '__all__';
      if (!groups.has(groupKey)) {
        const meta = {};
        agrupadores.forEach(a => { meta[a] = obj[a]; });
        groups.set(groupKey, { key: groupKey, meta, rowObjs: [] });
      }
      groups.get(groupKey).rowObjs.push(obj);
    }

    const INELIGIBLE_VALS = new Set(['NÃO ELEGÍVEL','NAO ELEGIVEL','INELEGIVEL','INELEGÍVEL','N','FALSE','0','NE','REPROVADO','R','NEGADO','RECUSADO']);
    const rm = resultadoMapping || {};
    const newItems = [];
    for (const group of groups.values()) {
      const rowVals = linhaCol ? [...new Set(group.rowObjs.map(r => r[linhaCol]).filter(v => v !== ''))] : [];
      const colVals = colunaCol ? [...new Set(group.rowObjs.map(r => r[colunaCol]).filter(v => v !== ''))] : [];
      const rowDomain = sortDomain(rowVals);
      const colDomain = sortDomain(colVals);
      const cells = {};
      for (const rowObj of group.rowObjs) {
        const rv = linhaCol ? rowObj[linhaCol] : null;
        const cv = colunaCol ? rowObj[colunaCol] : null;
        if (!rv || !String(rv).trim()) continue;
        const ck = cv && String(cv).trim() ? `${rv}|${cv}` : `${rv}|*`;
        if (cells.hasOwnProperty(ck)) continue; // first occurrence wins — determinism
        if (resultadoCol) {
          const raw = String(rowObj[resultadoCol] ?? '');
          const norm = raw.toUpperCase().trim();
          cells[ck] = rm.hasOwnProperty(raw) ? rm[raw] : !INELIGIBLE_VALS.has(norm);
        } else {
          cells[ck] = true;
        }
      }

      // Build value→label lookup dictionaries for row and col variables
      const rowValueLabels = {};
      if (linhaCol && rowLabelCol && rowLabelCol !== linhaCol) {
        for (const rowObj of group.rowObjs) {
          const techVal = String(rowObj[linhaCol] ?? '').trim();
          const labelVal = String(rowObj[rowLabelCol] ?? '').trim();
          if (techVal && labelVal && !rowValueLabels[techVal]) rowValueLabels[techVal] = labelVal;
        }
      }
      const colValueLabels = {};
      if (colunaCol && colLabelCol && colLabelCol !== colunaCol) {
        for (const rowObj of group.rowObjs) {
          const techVal = String(rowObj[colunaCol] ?? '').trim();
          const labelVal = String(rowObj[colLabelCol] ?? '').trim();
          if (techVal && labelVal && !colValueLabels[techVal]) colValueLabels[techVal] = labelVal;
        }
      }

      const name = agrupadores.length > 0
        ? agrupadores.map(a => group.meta[a]).filter(Boolean).join(' | ')
        : 'Cineminha Importado';
      newItems.push({
        id: uid(),
        savedAt: new Date().toISOString(),
        name,
        cinemaType: 'eligibility',
        rowVar: linhaCol ? { col: linhaCol } : null,
        colVar: colunaCol ? { col: colunaCol } : null,
        rowDomain,
        colDomain,
        cells,
        metadata: {
          type: 'eligibility',
          identifiers: group.meta,
          dimensions: { rowVariable: linhaCol, columnVariable: colunaCol },
          variables: {
            rowLabel: rowLabelCol || null,
            colLabel: colLabelCol || null,
            ...(Object.keys(rowValueLabels).length > 0 ? { rowValueLabels } : {}),
            ...(Object.keys(colValueLabels).length > 0 ? { colValueLabels } : {}),
          },
          source: 'library_import_csv',
          description: '',
          tags: [],
          version: 1,
        },
      });
    }

    setCinemaLibrary(prev => [...prev, ...newItems]);
    setLibWizard(null);
    setCinemaLibraryModal({
      mode: 'browse',
      shapeId: null,
      search: '',
      filterType: null,
      saveMeta: { name: '', description: '', tags: '', identifiers: '{}' },
      overwriteId: null,
      justImported: newItems.length,
    });
  };

  const onImportConfirm = () => {
    if (!wizard) return;
    const {rawText,filename,delimiter,hasHeader,columnTypes,varTypes,asIsVar,asIsMapping,editCsvId,decimalSep}=wizard;

    // Auto-assign 'decision' to all columns without an explicit type
    const buildFinalTypes = (headers, types) => {
      const final = {...(types || {})};
      for (const h of headers) { if (!final[h]) final[h] = 'decision'; }
      return final;
    };

    // ── Edit mode: update existing dataset, no new canvas nodes ──
    if (editCsvId) {
      const prev = csvStoreR.current[editCsvId];
      if (!prev) { setWizard(null); return; }
      pushHistory();

      // Strip any existing __DECISAO_ORIGINAL column from headers/rows
      const DORIGINAL_COL = '__DECISAO_ORIGINAL';
      const existingIdx = prev.headers.indexOf(DORIGINAL_COL);
      const baseHeaders = existingIdx >= 0 ? prev.headers.filter((_,i) => i !== existingIdx) : prev.headers;
      const baseRows = existingIdx >= 0 ? prev.rows.map(r => r.filter((_,i) => i !== existingIdx)) : prev.rows;

      // Rebuild __DECISAO_ORIGINAL if asIsVar is configured
      let finalHeaders = baseHeaders;
      let finalRows = baseRows;
      if (asIsVar && baseHeaders.includes(asIsVar)) {
        const asIsIdx = baseHeaders.indexOf(asIsVar);
        finalHeaders = [...baseHeaders, DORIGINAL_COL];
        finalRows = baseRows.map(r => {
          const val = String(r[asIsIdx] ?? '');
          const mapped = (asIsMapping || {})[val] || '';
          return [...r, mapped];
        });
      }

      const finalTypes = buildFinalTypes(baseHeaders, columnTypes);
      const newAsIsConfig = asIsVar ? { col: asIsVar, mapping: asIsMapping || {} } : (prev.asIsConfig || null);

      setCsvStore(store => ({
        ...store,
        [editCsvId]: { ...prev, name: filename||prev.name, headers: finalHeaders, rows: finalRows, columnTypes: finalTypes, varTypes: varTypes||{}, asIsConfig: newAsIsConfig }
      }));
      setWizard(null);
      return;
    }

    const {headers, rows: rawRows}=parseCSV(rawText,delimiter,hasHeader);
    const rows = normalizeDecimalSep(rawRows, decimalSep || '.');

    pushHistory();
    const csvId=uid();

    // Build normalized name → original header map for reconciliation
    const normMap = {};
    for (const h of headers) normMap[normalizeColName(h)] = h;

    // Derive DECISAO_ORIGINAL column if asIsVar is configured
    let finalHeaders = headers;
    let finalRows = rows;
    if (asIsVar && headers.includes(asIsVar)) {
      const asIsIdx = headers.indexOf(asIsVar);
      const DORIGINAL_COL = '__DECISAO_ORIGINAL';
      // Strip existing derived column if re-importing
      const existingIdx = headers.indexOf(DORIGINAL_COL);
      const baseHeaders = existingIdx >= 0 ? headers.filter((_,i)=>i!==existingIdx) : headers;
      const baseRows = existingIdx >= 0 ? rows.map(r=>r.filter((_,i)=>i!==existingIdx)) : rows;
      finalHeaders = [...baseHeaders, DORIGINAL_COL];
      finalRows = baseRows.map(r => {
        const val = String(r[asIsIdx] ?? '');
        const mapped = (asIsMapping||{})[val] || '';
        return [...r, mapped];
      });
    }
    const finalTypes = buildFinalTypes(headers, columnTypes);
    setCsvStore(prev=>({...prev,[csvId]:{name:filename,headers:finalHeaders,rows:finalRows,columnTypes:finalTypes,varTypes:varTypes||{},asIsConfig:asIsVar?{col:asIsVar,mapping:asIsMapping||{}}:null}}));

    const svgEl=svgRef.current;
    const cx=(svgEl.clientWidth/2-vp.x)/vp.s, cy=(svgEl.clientHeight/2-vp.y)/vp.s;
    const nodeId=uid();

    setShapes(p=>{
      const csvNode={id:nodeId,type:"csv",x:cx-CSV_W/2,y:cy-CSV_H/2,w:CSV_W,h:CSV_H,label:filename,csvId,minimized:false};
      const hasPanel=p.some(s=>s.type==="simPanel");
      const panelNodes=hasPanel?[]:[{id:uid(),type:"simPanel",x:cx+CSV_W/2+50,y:cy-120,w:300,h:440,label:"Simulação",color:"#fff"}];

      // Reconcile orphan decision nodes: nodes whose csvId no longer has a matching store entry
      // We pass the full updated store (prev + new entry) via closure is not possible here,
      // so we compare against current csvStoreR which excludes the new entry (added above via setCsvStore).
      // We treat any decision node whose csvId is NOT in the current store OR whose csvId IS missing as orphan.
      const currentStoreKeys = new Set(Object.keys(csvStoreR.current));
      const reconciledShapes = p.map(s => {
        if (s.type === "decision") {
          if (!s.variableCol) return s;
          if (s.csvId === csvId) return s;
          if (s.csvId && currentStoreKeys.has(s.csvId)) return s;
          const matchedHeader = normMap[normalizeColName(s.variableCol)];
          if (matchedHeader) return {...s, csvId, variableCol: matchedHeader};
          return s;
        }
        if (s.type === "cineminha") {
          let updated = {...s};
          let changed = false;
          // Reconcile rowVar
          if (s.rowVar && !currentStoreKeys.has(s.rowVar.csvId) && s.rowVar.csvId !== csvId) {
            const matched = normMap[normalizeColName(s.rowVar.col)];
            if (matched) { updated.rowVar = {col:matched, csvId}; changed = true; }
          }
          // Reconcile colVar
          if (s.colVar && !currentStoreKeys.has(s.colVar.csvId) && s.colVar.csvId !== csvId) {
            const matched = normMap[normalizeColName(s.colVar.col)];
            if (matched) { updated.colVar = {col:matched, csvId}; changed = true; }
          }
          if (!changed) return s;
          // Recompute domains from new data
          if (updated.rowVar) {
            const ci = headers.indexOf(updated.rowVar.col);
            if (ci >= 0) {
              const vals = [...new Set(rows.map(r=>r[ci]??'').filter(v=>v!==''))];
              updated.rowDomain = sortDomain(vals);
            }
          }
          if (updated.colVar) {
            const ci = headers.indexOf(updated.colVar.col);
            if (ci >= 0) {
              const vals = [...new Set(rows.map(r=>r[ci]??'').filter(v=>v!==''))];
              updated.colDomain = sortDomain(vals);
            }
          }
          // Rebuild cells preserving existing states
          const rDom = updated.rowDomain.length>0 ? updated.rowDomain : ['*'];
          const cDom = updated.colDomain.length>0 ? updated.colDomain : ['*'];
          const newCells = {};
          for (const r of rDom) for (const c of cDom) {
            const key=`${r}|${c}`;
            newCells[key] = getCellValue(s.cells, key);
          }
          updated.cells = newCells;
          const {w:nw,h:nh} = computeCinemaSize(updated.rowDomain, updated.colDomain);
          updated.w = nw; updated.h = nh;
          return updated;
        }
        return s;
      });

      return [...reconciledShapes, csvNode, ...panelNodes];
    });

    setSel(nodeId); setWizard(null); setImportWarn(null);
  };

  // ── onEditDataset: reopen wizard step 2 for an existing dataset ──
  const onEditDataset = (csvId) => {
    const csv = csvStoreR.current[csvId];
    if (!csv) return;
    // Pre-populate suggestions for columns that have no varType yet
    const varTypes = { ...(csv.varTypes || {}) };
    for (const h of csv.headers) {
      if (!varTypes[h]) {
        const ci = csv.headers.indexOf(h);
        const vals = csv.rows.map(r => r[ci] ?? '').filter(Boolean);
        varTypes[h] = suggestVarType(h, vals);
      }
    }
    setWizard({
      rawText: null,
      filename: csv.name,
      delimiter: ",",
      detected: ",",
      confident: true,
      hasHeader: true,
      step: 2,
      columnTypes: { ...(csv.columnTypes || {}) },
      varTypes,
      asIsVar: csv.asIsConfig?.col || null,
      asIsMapping: csv.asIsConfig?.mapping || {},
      editCsvId: csvId,
      decimalSep: '.',
      decimalSepConfident: true,
    });
  };

  // ── deleteShape (com cascade de ports filhos) ─────────────────
  const deleteShape = (id) => {
    pushHistory();
    const shape = shapesR.current.find(s=>s.id===id);
    const portIds = (shape?.type==="decision" || shape?.type==="cineminha")
      ? connsR.current.filter(c=>c.from===id).map(c=>c.to).filter(toId=>shapesR.current.find(s=>s.id===toId&&s.type==="port"))
      : [];
    const removeIds = [id,...portIds];
    setShapes(p=>p.filter(s=>!removeIds.includes(s.id)));
    setConns(p=>p.filter(c=>!removeIds.includes(c.from)&&!removeIds.includes(c.to)));
    setSel(null); setPalette(false);
  };

  // ── deleteCsvDataset ──────────────────────────────────────
  const deleteCsvDataset = (csvId) => {
    pushHistory();
    setCsvStore(prev => { const next = {...prev}; delete next[csvId]; return next; });
    // Remove the CSV canvas node for this dataset
    setShapes(prev => prev.filter(s => !(s.type === "csv" && s.csvId === csvId)));
    // Decision nodes keep their structure; simulation naturally returns 0 with no csvStore entry
    setImportWarn(null);
  };

  // ── exportFlow ────────────────────────────────────────────
  const exportFlow = () => setExportModal(true);

  const doExport = (includeData) => {
    const payload = {
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      flowId: uid(),
      exportMode: includeData ? "flow+dataset" : "flow-only",
      viewport: vp,
      shapes,
      conns,
      csvStore: includeData ? csvStore : {},
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fluxo_credito_${new Date().toISOString().slice(0,10)}${includeData?"_com_dados":""}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportModal(false);
  };

  // ── validateAndImportFlow ─────────────────────────────────
  const validateAndImportFlow = (data) => {
    // Schema integrity
    if (!data.schemaVersion || !Array.isArray(data.shapes) || !Array.isArray(data.conns)) {
      setImportError("Arquivo inválido: estrutura do fluxo não reconhecida. Verifique se é um arquivo exportado por este sistema.");
      return;
    }
    // Connection integrity
    const shapeIds = new Set(data.shapes.map(s => s.id));
    const badConns = data.conns.filter(c => !shapeIds.has(c.from) || !shapeIds.has(c.to));
    if (badConns.length > 0) {
      setImportError(`Integridade comprometida: ${badConns.length} conexão(ões) referenciam elementos inexistentes.`);
      return;
    }
    // Bump _id counter to avoid ID collisions with new elements
    const allIds = [...data.shapes.map(s => s.id), ...data.conns.map(c => c.id)];
    const maxNum = Math.max(0, ...allIds.map(id => parseInt(id.replace(/\D/g,''))).filter(n => !isNaN(n)));
    if (maxNum >= _id) _id = maxNum + 1;
    // Detect missing variables (decision/cineminha nodes whose columns don't exist in the stored CSV)
    const importedCsvStore = data.csvStore || {};
    const noDataset = Object.keys(importedCsvStore).length === 0;
    const missingVars = data.shapes.flatMap(s => {
      if (s.type === 'decision' && s.csvId && s.variableCol) {
        const csv = importedCsvStore[s.csvId];
        return (!csv || !csv.headers.includes(s.variableCol)) ? [s.variableCol] : [];
      }
      if (s.type === 'cineminha') {
        const missing = [];
        if (s.rowVar) { const csv=importedCsvStore[s.rowVar.csvId]; if(!csv||!csv.headers.includes(s.rowVar.col)) missing.push(s.rowVar.col); }
        if (s.colVar) { const csv=importedCsvStore[s.colVar.csvId]; if(!csv||!csv.headers.includes(s.colVar.col)) missing.push(s.colVar.col); }
        return missing;
      }
      return [];
    });
    // Restore state
    pushHistory();
    setShapes(data.shapes);
    setConns(data.conns);
    setCsvStore(importedCsvStore);
    if (data.viewport) setVp(data.viewport);
    setSel(null); setFromId(null); setPalette(false); setActiveCell(null);
    setImportError(null);
    if (noDataset) {
      setImportWarn("Fluxo importado sem dataset. A política pode ser editada normalmente. Importe um CSV compatível para ativar a simulação.");
    } else if (missingVars.length > 0) {
      setImportWarn(`Fluxo importado. Variáveis ausentes na base: ${[...new Set(missingVars)].join(", ")}. Importe um CSV compatível para reativar a simulação.`);
    } else {
      setImportWarn(null);
    }
  };

  const onFlowFileChange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        validateAndImportFlow(data);
      } catch {
        setImportError("Arquivo inválido: não foi possível ler o JSON. Verifique se o arquivo não está corrompido.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── exportCinema ──────────────────────────────────────────────
  const exportCinema = (shapeId) => {
    const shape = shapesR.current.find(s => s.id === shapeId);
    if (!shape || shape.type !== 'cineminha') return;
    const payload = {
      schemaVersion: "1.0",
      componentType: "cineminha",
      cinemaType: shape.cinemaType ?? 'eligibility',
      ...(shape.rowVar ? { rowVar: { col: shape.rowVar.col } } : {}),
      ...(shape.colVar ? { colVar: { col: shape.colVar.col } } : {}),
      rowDomain: shape.rowDomain || [],
      colDomain: shape.colDomain || [],
      cells: shape.cells || {},
      metadata: shape.metadata ?? {},
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cineminha-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── startCinemaImport ─────────────────────────────────────────
  const startCinemaImport = (shapeId) => {
    cinemaImportTarget.current = shapeId;
    cinemaImportRef.current?.click();
  };

  // ── onCinemaFileChange ────────────────────────────────────────
  const onCinemaFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const shapeId = cinemaImportTarget.current;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const config = JSON.parse(ev.target.result);
        if (config.componentType !== 'cineminha' || !config.schemaVersion) {
          setImportError("Arquivo inválido: não é uma configuração de Cineminha exportada por este sistema.");
          return;
        }
        const shape = shapesR.current.find(s => s.id === shapeId);
        if (!shape) return;
        // Collect available decision variables from all loaded CSVs
        const availableVars = [];
        for (const [csvId, csv] of Object.entries(csvStoreR.current)) {
          for (const col of (csv.headers || [])) {
            if ((csv.columnTypes?.[col] || '') === 'decision') {
              availableVars.push({ col, csvId, csvName: csv.name });
            }
          }
        }
        // Auto-match by name (exact first, then case-insensitive)
        const tryMatch = (colName) => {
          if (!colName) return null;
          return availableVars.find(v => v.col === colName)
            || availableVars.find(v => v.col.toLowerCase() === colName.toLowerCase())
            || null;
        };
        const rowMatch = config.rowVar ? tryMatch(config.rowVar.col) : null;
        const colMatch = config.colVar ? tryMatch(config.colVar.col) : null;
        const hasExistingConfig = !!(shape.rowVar || shape.colVar);
        setCinemaImportModal({
          shapeId,
          config,
          step: hasExistingConfig ? 'confirm' : 'mapping',
          rowMapping: rowMatch,
          colMapping: colMatch,
          availableVars,
        });
      } catch {
        setImportError("Arquivo inválido: não foi possível ler o JSON. Verifique se o arquivo não está corrompido.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── applyCinemaImport ─────────────────────────────────────────
  const applyCinemaImport = () => {
    const { shapeId, config, rowMapping, colMapping, fromLibrary } = cinemaImportModal;
    pushHistory();
    const rowVarFinal = config.rowVar && rowMapping ? { col: rowMapping.col, csvId: rowMapping.csvId } : null;
    const colVarFinal = config.colVar && colMapping ? { col: colMapping.col, csvId: colMapping.csvId } : null;
    let rowDomain = config.rowDomain || [];
    let colDomain = config.colDomain || [];
    if (rowVarFinal) {
      const csv = csvStoreR.current[rowVarFinal.csvId];
      if (csv) {
        const colIdx = csv.headers.indexOf(rowVarFinal.col);
        if (colIdx !== -1) {
          const vals = [...new Set(csv.rows.map(r => r[colIdx]??'').filter(v => v !== ''))];
          rowDomain = sortDomain(vals);
        }
      }
    }
    if (colVarFinal) {
      const csv = csvStoreR.current[colVarFinal.csvId];
      if (csv) {
        const colIdx = csv.headers.indexOf(colVarFinal.col);
        if (colIdx !== -1) {
          const vals = [...new Set(csv.rows.map(r => r[colIdx]??'').filter(v => v !== ''))];
          colDomain = sortDomain(vals);
        }
      }
    }
    const rDom = rowDomain.length > 0 ? rowDomain : ['*'];
    const cDom = colDomain.length > 0 ? colDomain : ['*'];
    const importedCells = config.cells || {};
    const newCells = {};
    for (const r of rDom) for (const c of cDom) {
      const key = `${r}|${c}`;
      newCells[key] = key in importedCells ? getCellValue(importedCells, key) : 1;
    }
    const skipped = Object.keys(importedCells).filter(k => !(k in newCells)).length;
    const { w, h } = computeCinemaSize(rowDomain, colDomain);
    const importedType = config.cinemaType && CINEMINHA_TYPES[config.cinemaType] ? config.cinemaType : undefined;
    setShapes(prev => prev.map(s => s.id !== shapeId ? s : {
      ...s, rowVar: rowVarFinal, colVar: colVarFinal, rowDomain, colDomain, cells: newCells, w, h,
      ...(importedType ? { cinemaType: importedType } : {}),
      ...(fromLibrary && config.name ? { label: config.name } : {}),
    }));
    setCinemaImportModal(null);
    if (skipped > 0) {
      setImportWarn(`Importação do Cineminha concluída com avisos: ${skipped} combinação(ões) do arquivo não existem no dataset atual e foram ignoradas.`);
    }
  };

  // ── Cinema Library functions ──────────────────────────────────
  const openCinemaLibrary = (shapeId, mode = 'browse') => {
    const shape = shapeId ? shapesR.current.find(s => s.id === shapeId) : null;
    const meta = shape?.metadata ?? {};
    setCinemaLibraryModal({
      mode,
      shapeId: shapeId ?? null,
      search: '',
      filterType: null,
      saveMeta: {
        name: shape?.label ?? 'Cineminha',
        description: meta.description ?? '',
        tags: (meta.tags ?? []).join(', '),
        identifiers: JSON.stringify(meta.identifiers ?? {}, null, 2),
      },
      overwriteId: null,
      selectedLibIds: [],
    });
  };

  const saveToLibrary = () => {
    const { shapeId, saveMeta, overwriteId } = cinemaLibraryModal;
    const shape = shapesR.current.find(s => s.id === shapeId);
    if (!shape) return;
    let parsedIdentifiers = {};
    try { parsedIdentifiers = JSON.parse(saveMeta.identifiers || '{}'); } catch { parsedIdentifiers = {}; }
    const parsedTags = (saveMeta.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const newMeta = {
      type: shape.cinemaType ?? 'eligibility',
      identifiers: parsedIdentifiers,
      dimensions: { rowVariable: shape.rowVar?.col ?? null, columnVariable: shape.colVar?.col ?? null },
      variables: {},
      source: overwriteId ? 'manual' : 'manual',
      description: saveMeta.description ?? '',
      tags: parsedTags,
      version: overwriteId ? ((cinemaLibraryR.current.find(it => it.id === overwriteId)?.metadata?.version ?? 0) + 1) : 1,
    };
    const item = {
      id: overwriteId ?? uid(),
      savedAt: new Date().toISOString(),
      name: saveMeta.name || 'Cineminha',
      cinemaType: shape.cinemaType ?? 'eligibility',
      rowVar: shape.rowVar ? { col: shape.rowVar.col } : null,
      colVar: shape.colVar ? { col: shape.colVar.col } : null,
      rowDomain: shape.rowDomain || [],
      colDomain: shape.colDomain || [],
      cells: { ...(shape.cells || {}) },
      metadata: newMeta,
    };
    setCinemaLibrary(prev => overwriteId ? prev.map(it => it.id === overwriteId ? item : it) : [...prev, item]);
    setShapes(prev => prev.map(s => s.id !== shapeId ? s : {
      ...s, label: saveMeta.name || s.label, metadata: { ...newMeta },
    }));
    setCinemaLibraryModal(null);
  };

  const loadFromLibraryWithMapping = (item) => {
    // Build a config object compatible with cinemaImportModal
    const config = {
      schemaVersion: "1.0",
      componentType: "cineminha",
      cinemaType: item.cinemaType ?? 'eligibility',
      ...(item.rowVar ? { rowVar: item.rowVar } : {}),
      ...(item.colVar ? { colVar: item.colVar } : {}),
      rowDomain: item.rowDomain || [],
      colDomain: item.colDomain || [],
      cells: { ...(item.cells || {}) },
      metadata: { ...(item.metadata ?? {}), source: 'library_import' },
      name: item.name,
    };

    // Collect available decision variables from all loaded datasets
    const availableVars = [];
    for (const [csvId, csv] of Object.entries(csvStoreR.current)) {
      for (const col of (csv.headers || [])) {
        if ((csv.columnTypes?.[col] || '') === 'decision') {
          availableVars.push({ col, csvId, csvName: csv.name });
        }
      }
    }
    const tryMatchVar = (colName) => {
      if (!colName) return null;
      return availableVars.find(v => v.col === colName)
        || availableVars.find(v => v.col.toLowerCase() === colName.toLowerCase())
        || null;
    };

    // If a cineminha is currently selected on the board, apply to it
    const selectedCinema = selR.current
      ? shapesR.current.find(s => s.id === selR.current && s.type === 'cineminha')
      : null;

    if (selectedCinema) {
      const hasExistingConfig = !!(selectedCinema.rowVar || selectedCinema.colVar);
      setCinemaImportModal({
        shapeId: selectedCinema.id,
        config,
        step: hasExistingConfig ? 'confirm' : 'mapping',
        rowMapping: config.rowVar ? tryMatchVar(config.rowVar.col) : null,
        colMapping: config.colVar ? tryMatchVar(config.colVar.col) : null,
        availableVars,
        fromLibrary: true,
      });
      setCinemaLibraryModal(null);
      return;
    }

    // No cineminha selected — create a new blank shape then immediately open mapping
    const cx = (-vpR.current.x + 500) / vpR.current.s;
    const cy = (-vpR.current.y + 320) / vpR.current.s;
    pushHistory();
    const id = uid();
    const cinemaType = item.cinemaType ?? 'eligibility';
    const cfg = getCinemaType(cinemaType);
    const PORT_W = 100, PORT_H = 32;
    const W = 170, H = 108;
    const cinemaShape = {
      id, type: 'cineminha', x: cx - W / 2, y: cy - H / 2, w: W, h: H,
      label: item.name || 'Cineminha', color: '#fff', cinemaType,
      rowVar: null, colVar: null, rowDomain: [], colDomain: [], cells: {},
      metadata: { ...(item.metadata ?? {}), source: 'library_import' },
    };
    const eligId = uid(), notId = uid();
    const eligPort = { id: eligId, type: 'port', x: cx + W / 2 + 36, y: cy - PORT_H - 6, w: PORT_W, h: PORT_H, label: cfg.ports[0].label, color: cfg.ports[0].color };
    const notPort  = { id: notId,  type: 'port', x: cx + W / 2 + 36, y: cy + 6,          w: PORT_W, h: PORT_H, label: cfg.ports[1].label, color: cfg.ports[1].color };
    setShapes(prev => [...prev, cinemaShape, eligPort, notPort]);
    setConns(prev  => [...prev,
      { id: uid(), from: id, to: eligId, label: cfg.ports[0].label },
      { id: uid(), from: id, to: notId,  label: cfg.ports[1].label },
    ]);
    setSel(id);
    setCinemaImportModal({
      shapeId: id,
      config,
      step: 'mapping',
      rowMapping: config.rowVar ? tryMatchVar(config.rowVar.col) : null,
      colMapping: config.colVar ? tryMatchVar(config.colVar.col) : null,
      availableVars,
      fromLibrary: true,
    });
    setCinemaLibraryModal(null);
  };

  const deleteFromLibrary = (itemId) => {
    setCinemaLibrary(prev => prev.filter(it => it.id !== itemId));
  };

  // ── batchImportFromLibrary ────────────────────────────────────
  const batchImportFromLibrary = (selectedIds) => {
    const items = cinemaLibraryR.current.filter(it => selectedIds.includes(it.id));
    if (!items.length) return;
    pushHistory();

    const svgEl = svgRef.current;
    const svgRect = svgEl ? svgEl.getBoundingClientRect() : {width: 1000, height: 700};
    const {x: vx, y: vy, s} = vpR.current;
    const centerX = (-vx + svgRect.width  * 0.5) / s;
    const centerY = (-vy + svgRect.height * 0.5) / s;

    const PORT_W = 100, PORT_H = 32, GAP = 40;
    const sizes = items.map(item => computeCinemaSize(item.rowDomain || [], item.colDomain || []));
    const totalH = sizes.reduce((acc, sz, i) => acc + sz.h + (i > 0 ? GAP : 0), 0);

    let curY = centerY - totalH / 2;
    const newShapes = [], newConns = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const {w: W, h: H} = sizes[i];
      const cx = centerX, cy = curY + H / 2;
      const cinemaType = item.cinemaType ?? 'eligibility';
      const cfg = getCinemaType(cinemaType);
      const id = uid(), eligId = uid(), notId = uid();

      newShapes.push(
        { id, type:'cineminha', x:cx-W/2, y:cy-H/2, w:W, h:H,
          label:item.name||'Cineminha', color:'#fff', cinemaType,
          rowVar:null, colVar:null,
          rowDomain:[...(item.rowDomain||[])], colDomain:[...(item.colDomain||[])],
          cells:{...(item.cells||{})}, resultVar:null,
          metadata:{...(item.metadata??{}), source:'library_import'} },
        { id:eligId, type:'port', x:cx+W/2+36, y:cy-PORT_H-6, w:PORT_W, h:PORT_H, label:cfg.ports[0].label, color:cfg.ports[0].color },
        { id:notId,  type:'port', x:cx+W/2+36, y:cy+6,         w:PORT_W, h:PORT_H, label:cfg.ports[1].label, color:cfg.ports[1].color },
      );
      newConns.push(
        {id:uid(), from:id, to:eligId, label:cfg.ports[0].label},
        {id:uid(), from:id, to:notId,  label:cfg.ports[1].label},
      );
      curY += H + GAP;
    }

    setShapes(prev => [...prev, ...newShapes]);
    setConns(prev  => [...prev, ...newConns]);
    setCinemaLibraryModal(null);
  };

  // ── exportLibrary ─────────────────────────────────────────────
  const exportLibrary = () => {
    const library = cinemaLibraryR.current;
    if (library.length === 0) return;

    // Collect all unique identifier keys across every item (for consistent columns)
    const allIdKeys = [...new Set(library.flatMap(item => Object.keys(item.metadata?.identifiers ?? {})))];

    const csvHeaders = [
      'NOME_MODELO', 'TIPO',
      'VARIAVEL_LINHA', 'VARIAVEL_COLUNA',
      'LABEL_LINHA', 'LABEL_COLUNA',
      ...allIdKeys.map(k => `ID_${k}`),
      'VALOR_LINHA', 'VALOR_COLUNA', 'RESULTADO',
      'VERSAO', 'SOURCE', 'SALVO_EM',
    ];

    const escCSV = (v) => {
      const s = String(v ?? '');
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const dataRows = [];
    for (const item of library) {
      const ids = item.metadata?.identifiers ?? {};
      const vars = item.metadata?.variables ?? {};
      const rowDom = item.rowDomain || [];
      const colDom = item.colDomain.length > 0 ? item.colDomain : ['*'];

      const baseFields = [
        item.name,
        item.cinemaType ?? 'eligibility',
        item.rowVar?.col ?? '',
        item.colVar?.col ?? '',
        vars.rowLabel ?? '',
        vars.colLabel ?? '',
        ...allIdKeys.map(k => String(ids[k] ?? '')),
      ];
      const tailFields = [
        String(item.metadata?.version ?? 1),
        item.metadata?.source ?? '',
        item.savedAt ?? '',
      ];

      if (rowDom.length === 0) {
        dataRows.push([...baseFields, '', '', '', ...tailFields]);
      } else {
        for (const r of rowDom) {
          for (const c of colDom) {
            const eligible = getCellValue(item.cells, `${r}|${c}`);
            dataRows.push([...baseFields, r, c === '*' ? '' : c, eligible > 0 ? 'ELEGÍVEL' : 'NÃO ELEGÍVEL', ...tailFields]);
          }
        }
      }
    }

    const csv = [csvHeaders, ...dataRows].map(row => row.map(escCSV).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `biblioteca-cineminhas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── createDecisionNode ────────────────────────────────────────
  const createDecisionNode = (variableCol, csvId, wx, wy) => {
    pushHistory();
    const csv = csvStoreR.current[csvId];
    if (!csv) return;
    const colIdx = csv.headers.indexOf(variableCol);
    if (colIdx === -1) return;
    const allVals = [...new Set(csv.rows.map(r=>r[colIdx]??"").filter(v=>v!==""))];
    const distinctVals = allVals.slice(0, MAX_DISTINCT);
    const decId = uid();
    const decisionShape = {id:decId,type:"decision",x:wx-SW/2,y:wy-SH/2,w:SW,h:SH,label:variableCol,color:"#fef3c7",variableCol,csvId};
    const PORT_W=80, PORT_H=32, DIST=200;
    const n = distinctVals.length;
    const ports = distinctVals.map((val,i)=>{
      let angle;
      if (n===1)      angle=0;
      else if (n===2) angle=i===0?-Math.PI/4:Math.PI/4;
      else { const span=Math.min(Math.PI*0.75,(n-1)*0.4); angle=-span/2+(span/(n-1))*i; }
      const px=wx+Math.cos(angle)*DIST-PORT_W/2;
      const py=wy+Math.sin(angle)*DIST-PORT_H/2;
      return {id:uid(),type:"port",x:px,y:py,w:PORT_W,h:PORT_H,label:val,color:"#f0fdf4"};
    });
    const newConns = ports.map(p=>({id:uid(),from:decId,to:p.id,label:p.label}));
    setShapes(prev=>[...prev,decisionShape,...ports]);
    setConns(prev=>[...prev,...newConns]);
    setSel(decId);
  };

  // ── toggleCinemaCell ──────────────────────────────────────────
  const toggleCinemaCell = useCallback((shapeId, cellKey) => {
    pushHistory();
    setShapes(prev => prev.map(s => {
      if (s.id !== shapeId) return s;
      const cur = getCellValue(s.cells, cellKey);
      return {...s, cells: {...(s.cells??{}), [cellKey]: cur > 0 ? 0 : 1}};
    }));
  }, []);

  // ── setCinemaCellValue ────────────────────────────────────────
  const setCinemaCellValue = useCallback((shapeId, cellKey, value) => {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    pushHistory();
    setShapes(prev => prev.map(s => {
      if (s.id !== shapeId) return s;
      return {...s, cells: {...(s.cells??{}), [cellKey]: n}};
    }));
  }, []);

  // ── createCinemaNode ──────────────────────────────────────────
  const createCinemaNode = useCallback((wx, wy, cinemaType = 'eligibility') => {
    pushHistory();
    const id = uid();
    const W = 170, H = 108;
    const cfg = getCinemaType(cinemaType);
    const cinemaShape = {
      id, type:"cineminha", x:wx-W/2, y:wy-H/2, w:W, h:H,
      label:"Cineminha", color:"#fff", cinemaType,
      rowVar:null, colVar:null, rowDomain:[], colDomain:[], cells:{}, resultVar:null,
      metadata: {
        type: cinemaType, identifiers: {}, dimensions: { rowVariable: null, columnVariable: null },
        variables: {}, source: 'manual', description: '', tags: [], version: 1,
      },
    };
    const PORT_W = 100, PORT_H = 32;
    const eligId = uid(), notId = uid();
    const eligPort = {id:eligId, type:"port", x:wx+W/2+36, y:wy-PORT_H-6, w:PORT_W, h:PORT_H, label:cfg.ports[0].label, color:cfg.ports[0].color};
    const notPort  = {id:notId,  type:"port", x:wx+W/2+36, y:wy+6,         w:PORT_W, h:PORT_H, label:cfg.ports[1].label, color:cfg.ports[1].color};
    const newConns = [
      {id:uid(), from:id, to:eligId, label:cfg.ports[0].label},
      {id:uid(), from:id, to:notId,  label:cfg.ports[1].label},
    ];
    setShapes(prev => [...prev, cinemaShape, eligPort, notPort]);
    setConns(prev  => [...prev, ...newConns]);
    setSel(id);
  }, []); // eslint-disable-line

  // ── changeCinemaType ──────────────────────────────────────────
  const changeCinemaType = useCallback((shapeId, newType) => {
    pushHistory();
    const cfg = getCinemaType(newType);
    const cinConns = connsR.current.filter(c => c.from === shapeId);
    setShapes(prev => prev.map(s => {
      if (s.id === shapeId) return { ...s, cinemaType: newType };
      const ci = cinConns.findIndex(c => c.to === s.id);
      if (ci >= 0 && cfg.ports[ci]) return { ...s, label: cfg.ports[ci].label, color: cfg.ports[ci].color };
      return s;
    }));
    setConns(prev => prev.map(c => {
      if (c.from !== shapeId) return c;
      const ci = cinConns.findIndex(cc => cc.id === c.id);
      if (ci >= 0 && cfg.ports[ci]) return { ...c, label: cfg.ports[ci].label };
      return c;
    }));
  }, []); // eslint-disable-line

  // ── createLensNode ────────────────────────────────────────────
  const createLensNode = useCallback((wx, wy) => {
    pushHistory();
    const id = uid();
    const lensShape = {
      id, type:"decision_lens",
      x: wx - LENS_W / 2, y: wy - LENS_H / 2,
      w: LENS_W, h: LENS_H,
      label: "Decision Lens",
      rules: [],
      color: "#fff",
    };
    setShapes(prev => [...prev, lensShape]);
    setSel(id);
  }, []); // eslint-disable-line

  // ── openLensModal ─────────────────────────────────────────────
  const openLensModal = useCallback((shapeId) => {
    const shape = shapesR.current.find(s => s.id === shapeId);
    if (!shape) return;
    const rules = (shape.rules || []).map(r => ({...r}));
    const population = computeLensPopulation(rules, csvStoreR.current);
    setLensModal({ shapeId, rules, population });
  }, []); // eslint-disable-line

  // ── applyLensRules ────────────────────────────────────────────
  const applyLensRules = useCallback((shapeId, rules) => {
    pushHistory();
    setShapes(prev => prev.map(s => s.id === shapeId ? {...s, rules} : s));
    setLensModal(null);
  }, []); // eslint-disable-line

  // ── assignCinemaVar ───────────────────────────────────────────
  const assignCinemaVar = useCallback((shapeIdOrIds, col, csvId, axis) => {
    pushHistory();
    const shapeIds = Array.isArray(shapeIdOrIds) ? shapeIdOrIds : [shapeIdOrIds];
    const csv = csvStoreR.current[csvId];
    if (!csv) return;
    const colIdx = csv.headers.indexOf(col);
    if (colIdx === -1) return;
    const allVals = [...new Set(csv.rows.map(r => r[colIdx]??'').filter(v=>v!==''))];
    const domain  = sortDomain(allVals);

    // Pre-compute port repositioning for each cineminha
    const PORT_H = 32;
    const portPositions = {};
    for (const shapeId of shapeIds) {
      const shape = shapesR.current.find(s => s.id === shapeId);
      if (!shape) continue;
      const newRowDomain = axis==='row' ? domain : shape.rowDomain;
      const newColDomain = axis==='col' ? domain : shape.colDomain;
      const {w: nw, h: nh} = computeCinemaSize(newRowDomain, newColDomain);
      connsR.current.filter(c => c.from === shapeId).forEach((c, i) => {
        portPositions[c.to] = {
          x: shape.x + nw + 36,
          y: i === 0 ? shape.y + nh/2 - PORT_H - 6 : shape.y + nh/2 + 6,
        };
      });
    }

    setShapes(prev => prev.map(s => {
      if (shapeIds.includes(s.id)) {
        const newRowVar    = axis==='row' ? {col,csvId} : s.rowVar;
        const newColVar    = axis==='col' ? {col,csvId} : s.colVar;
        const newRowDomain = axis==='row' ? domain : s.rowDomain;
        const newColDomain = axis==='col' ? domain : s.colDomain;
        const rDom = newRowDomain.length>0 ? newRowDomain : ['*'];
        const cDom = newColDomain.length>0 ? newColDomain : ['*'];
        const newCells = {};
        for (const r of rDom) for (const c of cDom) {
          const key = `${r}|${c}`;
          newCells[key] = getCellValue(s.cells, key);
        }
        const {w:nw, h:nh} = computeCinemaSize(newRowDomain, newColDomain);
        const baseShape = {...s, rowVar:newRowVar, colVar:newColVar, rowDomain:newRowDomain, colDomain:newColDomain, cells:newCells, w:nw, h:nh};
        if (s.resultVar) {
          baseShape.cells = populateCellsFromResultVar(baseShape, csvStoreR.current);
        }
        return baseShape;
      }
      if (portPositions[s.id]) {
        return {...s, ...portPositions[s.id]};
      }
      return s;
    }));
    setAxisModal(null);
  }, []); // eslint-disable-line

  // ── assignResultVar ───────────────────────────────────────────
  const assignResultVar = useCallback((shapeId, col, csvId) => {
    pushHistory();
    setShapes(prev => prev.map(s => {
      if (s.id !== shapeId) return s;
      const updated = { ...s, resultVar: { col, csvId } };
      if (s.rowDomain?.length > 0 || s.colDomain?.length > 0 || s.rowVar || s.colVar) {
        updated.cells = populateCellsFromResultVar(updated, csvStoreR.current);
      }
      return updated;
    }));
    setAxisModal(null);
    setResultVarModal(null);
  }, []); // eslint-disable-line

  // ── clearResultVar ────────────────────────────────────────────
  const clearResultVar = useCallback((shapeId) => {
    pushHistory();
    setShapes(prev => prev.map(s => s.id === shapeId ? { ...s, resultVar: null } : s));
  }, []);

  // ── startPanelDrag ────────────────────────────────────────────
  const startPanelDrag = (e, col, csvId) => {
    e.preventDefault();
    setPanelDrag({col,csvId});
    setGhostPos({x:e.clientX,y:e.clientY});
  };

  // ── Global mouse listeners for panel→canvas drag ──────────────
  useEffect(()=>{
    const onMove=(e)=>{
      if (!panelDragR.current) return;
      setGhostPos({x:e.clientX,y:e.clientY});
    };
    const onUp=(e)=>{
      const drag=panelDragR.current;
      if (!drag) return;
      const svgEl=svgRef.current;
      if (svgEl) {
        const rect=svgEl.getBoundingClientRect();
        if (e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom) {
          const sx=e.clientX-rect.left,sy=e.clientY-rect.top;
          const {x:vx,y:vy,s}=vpR.current;
          const wx=(sx-vx)/s, wy=(sy-vy)/s;
          // Check if dropped on a cineminha node
          const cinema=shapesR.current.find(sh=>sh.type==='cineminha'&&wx>=sh.x&&wx<=sh.x+sh.w&&wy>=sh.y&&wy<=sh.y+sh.h);
          if (cinema) {
            const ms = multiSelR.current;
            const selCinemaIds = ms.size > 1 && ms.has(cinema.id)
              ? [...ms].filter(id => shapesR.current.find(s => s.id === id && s.type === 'cineminha'))
              : null;
            if (selCinemaIds && selCinemaIds.length > 1) {
              setAxisModal({shapeIds: selCinemaIds, col: drag.col, csvId: drag.csvId});
            } else {
              setAxisModal({shapeId: cinema.id, col: drag.col, csvId: drag.csvId});
            }
          } else {
            createDecisionNode(drag.col,drag.csvId,wx,wy);
          }
        }
      }
      setPanelDrag(null); setGhostPos(null);
    };
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
    return()=>{ window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); };
  },[]); // eslint-disable-line

  // ── Wizard preview ────────────────────────────────────────────
  const wizardPreview = wizard
    ? (wizard.editCsvId
        ? (() => { const csv = csvStore[wizard.editCsvId]; return csv ? {headers: csv.headers, rows: csv.rows} : null; })()
        : parseCSV(wizard.rawText, wizard.delimiter, wizard.hasHeader))
    : null;

  const libWizardPreview = libWizard
    ? parseCSV(libWizard.rawText, libWizard.delimiter, libWizard.hasHeader)
    : null;

  // ── Analytics color scale ─────────────────────────────────────
  const edgeColorScale = useMemo(() => {
    const stats = simResult.edgeStats || {};
    const vals = Object.values(stats).map(s => s.inadInferida).filter(v => v !== null);
    if (vals.length < 2) return null;
    const mn = Math.min(...vals), mx = Math.max(...vals);
    if (mx === mn) return null;
    return {mn, mx};
  }, [simResult]);

  const edgeQtyScale = useMemo(() => {
    const stats = simResult.edgeStats || {};
    const vals = Object.values(stats).map(s => s.qty);
    if (vals.length === 0) return null;
    const mn = Math.min(...vals), mx = Math.max(...vals);
    if (mx === mn) return null;
    return {mn, mx};
  }, [simResult]);

  // ── Render: connection (adaptive routing) ─────────────────────
  const renderConn = (conn) => {
    const from=shapes.find(s=>s.id===conn.from), to=shapes.find(s=>s.id===conn.to);
    if (!from||!to) return null;
    const [fx,fy]=ctr(from), [tx,ty]=ctr(to);
    const dx=tx-fx, dy=ty-fy;
    const adx=Math.abs(dx), ady=Math.abs(dy);
    const dist=Math.sqrt(dx*dx+dy*dy)||1;
    const hl=Math.min(dist*0.45, 140);

    // Choose exit/entry edges based on dominant direction
    let sx,sy,ex,ey,c1x,c1y,c2x,c2y;
    if (adx >= ady) {
      // Horizontal dominant
      if (dx>0) { sx=from.x+from.w; sy=fy; ex=to.x;       ey=ty; }
      else       { sx=from.x;       sy=fy; ex=to.x+to.w;   ey=ty; }
      c1x=sx+(dx>0?hl:-hl); c1y=sy;
      c2x=ex+(dx>0?-hl:hl); c2y=ey;
    } else {
      // Vertical dominant
      if (dy>0) { sx=fx; sy=from.y+from.h; ex=tx; ey=to.y;       }
      else       { sx=fx; sy=from.y;        ex=tx; ey=to.y+to.h;   }
      c1x=sx; c1y=sy+(dy>0?hl:-hl);
      c2x=ex; c2y=ey+(dy>0?-hl:hl);
    }

    // Trim end point back so arrowhead sits on the edge
    const edx=ex-c2x, edy=ey-c2y, elen=Math.sqrt(edx*edx+edy*edy)||1;
    const aex=ex-(edx/elen)*10, aey=ey-(edy/elen)*10;

    const d=`M ${sx} ${sy} C ${c1x} ${c1y} ${c2x} ${c2y} ${aex} ${aey}`;
    // Label at cubic bezier midpoint (t=0.5)
    const lx=0.125*sx+0.375*c1x+0.375*c2x+0.125*aex;
    const ly=0.125*sy+0.375*c1y+0.375*c2y+0.125*aey;
    const labelText=conn.label?trunc(conn.label,12):null;

    // Analytics
    const es = simResult.edgeStats?.[conn.id];
    let strokeColor = "#3b82f6";
    if (es && edgeColorScale) {
      const t = (es.inadInferida !== null)
        ? (es.inadInferida - edgeColorScale.mn) / (edgeColorScale.mx - edgeColorScale.mn)
        : null;
      if (t !== null) strokeColor = inadColor(Math.max(0, Math.min(1, t)));
    }
    let strokeW = 2;
    if (enableDynThickness && es && edgeQtyScale) {
      const t2 = (es.qty - edgeQtyScale.mn) / (edgeQtyScale.mx - edgeQtyScale.mn);
      strokeW = 1.5 + t2 * 2.5;
    }
    const analyticsLabel = es ? [
      showEdgeVol     && fmtQty(es.qty),
      showEdgeInadReal && fmtPct(es.inadReal),
      showEdgeInadInf  && fmtPct(es.inadInferida),
    ].filter(Boolean).join(" · ") || null : null;

    // Hover card position in screen coords
    const isHovered = hoveredConn === conn.id;
    const hcScreenX = lx * vp.s + vp.x + 10;
    const hcScreenY = ly * vp.s + vp.y - 80;

    return (
      <g key={conn.id}>
        <path d={d} fill="none" stroke="transparent" strokeWidth={18} style={{cursor:"pointer"}}
          onMouseEnter={e=>{setHoveredConn(conn.id);setHoveredConnPos({x:e.clientX+12,y:e.clientY-20});}}
          onMouseMove={e=>{setHoveredConnPos({x:e.clientX+12,y:e.clientY-20});}}
          onMouseLeave={()=>{setHoveredConn(null);setHoveredConnPos(null);}}
          onClick={e=>{e.stopPropagation();connClickTimer.current=setTimeout(()=>{pushHistory();setConns(p=>p.filter(c=>c.id!==conn.id));},220);}}
          onDoubleClick={e=>{e.stopPropagation();clearTimeout(connClickTimer.current);setEditConn({id:conn.id,val:conn.label||""});}}/>
        <path d={d} fill="none" stroke={strokeColor} strokeWidth={strokeW} markerEnd="url(#arr)" style={{pointerEvents:"none"}}/>
        {labelText&&(
          <>
            <rect x={lx-28} y={ly-10} width={56} height={20} rx={5}
              fill="#fff" stroke="#e2e8f0" strokeWidth={1} style={{pointerEvents:"none"}}/>
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              fontSize={11} fontFamily="'DM Sans',system-ui,sans-serif" fill="#475569"
              style={{pointerEvents:"none",userSelect:"none"}}>{labelText}</text>
          </>
        )}
        {analyticsLabel&&(
          <>
            <rect x={lx - analyticsLabel.length * 3.2} y={ly+(labelText?10:-3)} width={analyticsLabel.length*6.4} height={14} rx={4}
              fill="rgba(255,255,255,0.92)" stroke="#e2e8f0" strokeWidth={0.8} style={{pointerEvents:"none"}}/>
            <text x={lx} y={ly+(labelText?20:7)} textAnchor="middle"
              fontSize={9} fontFamily="'DM Sans',system-ui,sans-serif" fontWeight="600" fill="#475569"
              style={{pointerEvents:"none",userSelect:"none"}}>{analyticsLabel}</text>
          </>
        )}
      </g>
    );
  };

  // ── Render: CSV node ──────────────────────────────────────────
  const renderCSVNode = (shape) => {
    const {id,x,y,label,csvId,minimized}=shape;
    const csv=csvStore[csvId];
    const isSel=sel===id, isFrom=fromId===id;
    const stroke=isFrom?"#f59e0b":isSel?"#3b82f6":"#e2e8f0";
    const sw=isSel||isFrom?2:1;
    const gp={
      "data-sid":id,
      onMouseDown:(e)=>onShapeDown(e,id),
      onClick:(e)=>onShapeClick(e,id),
      style:{cursor:tool==="connect"?"crosshair":"default"},
    };

    // ── Minimized ──
    if (minimized) {
      return (
        <g key={id} {...gp} style={{cursor:tool==="select"?"grab":tool==="connect"?"crosshair":"default", filter:"drop-shadow(0 1px 4px rgba(0,0,0,.1))"}}>
          <rect x={x} y={y} width={CSV_MINI_W} height={CSV_MINI_H} rx={10}
            fill="#fff" stroke={stroke} strokeWidth={sw}/>
          <text x={x+14} y={y+36} fontSize={22} style={{pointerEvents:"none"}}>📊</text>
          <text x={x+44} y={y+26} fontSize={11} fontWeight="600" fill="#1e293b"
            fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none"}}>
            {trunc(label.replace(/\.csv$/i,""),20)}
          </text>
          <text x={x+44} y={y+42} fontSize={10} fill="#94a3b8"
            fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none"}}>
            {csv?`${csv.rows.length} linhas · ${csv.headers.length} colunas`:"CSV"}
          </text>
          {/* Maximize btn */}
          <g onClick={e=>{e.stopPropagation();pushHistory();setShapes(p=>p.map(s=>s.id===id?{...s,minimized:false,w:CSV_W,h:CSV_H}:s));}} style={{cursor:"pointer"}}>
            <rect x={x+CSV_MINI_W-30} y={y+8} width={22} height={22} rx={6} fill="#f1f5f9"/>
            <text x={x+CSV_MINI_W-19} y={y+23} fontSize={13} textAnchor="middle" fill="#475569">⤢</text>
          </g>
        </g>
      );
    }

    // ── Maximized ──
    const w=CSV_W, h=CSV_H;
    const displayRows = csv ? csv.rows.slice(0,MAX_ROWS) : [];
    const truncated = csv && csv.rows.length > MAX_ROWS;

    return (
      <g key={id} data-sid={id} style={{filter:"drop-shadow(0 4px 16px rgba(0,0,0,.1))"}}>
        {/* Frame */}
        <rect x={x} y={y} width={w} height={h} rx={10} fill="#fff" stroke={stroke} strokeWidth={sw}/>

        {/* Title bar — drag handle */}
        <rect data-sid={id} x={x} y={y} width={w} height={CSV_TH} rx={10} fill="#f8fafc"
          onMouseDown={e=>onShapeDown(e,id)} onClick={e=>onShapeClick(e,id)} style={{cursor:"grab"}}/>
        <rect x={x} y={y+CSV_TH-8} width={w} height={8} fill="#f8fafc"/>
        <line x1={x+1} y1={y+CSV_TH} x2={x+w-1} y2={y+CSV_TH} stroke="#e2e8f0"/>

        {/* Icon + filename */}
        <text x={x+12} y={y+25} fontSize={16} style={{pointerEvents:"none"}}>📊</text>
        <text x={x+34} y={y+25} fontSize={12.5} fontWeight="600" fill="#1e293b"
          fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none"}}>
          {trunc(label.replace(/\.csv$/i,""), 42)}
        </text>

        {/* Row/col count */}
        {csv && (
          <text x={x+w-100} y={y+25} fontSize={10} fill="#94a3b8" textAnchor="end"
            fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none"}}>
            {truncated?`${MAX_ROWS}/${csv.rows.length} linhas`:(`${csv.rows.length} linhas`)} · {csv?.headers.length} colunas
          </text>
        )}

        {/* Minimize btn */}
        <g onClick={e=>{e.stopPropagation();pushHistory();setShapes(p=>p.map(s=>s.id===id?{...s,minimized:true,w:CSV_MINI_W,h:CSV_MINI_H}:s));setActiveCell(null);}} style={{cursor:"pointer"}}>
          <rect x={x+w-32} y={y+8} width={24} height={22} rx={6} fill="#f1f5f9"/>
          <text x={x+w-20} y={y+23} fontSize={14} textAnchor="middle" fill="#475569">⊟</text>
        </g>

        {/* Table via foreignObject */}
        {csv && (
          <foreignObject x={x+1} y={y+CSV_TH+1} width={w-2} height={h-CSV_TH-2}>
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              style={{width:"100%",height:"100%",overflow:"auto",background:"#fff",
                borderBottomLeftRadius:9,borderBottomRightRadius:9}}
              onMouseDown={e=>e.stopPropagation()}
              onWheel={e=>e.stopPropagation()}
              onClick={e=>e.stopPropagation()}
              onTouchStart={e=>e.stopPropagation()}>
              <table style={{borderCollapse:"collapse",fontSize:11.5,
                fontFamily:"'DM Sans',system-ui,sans-serif",width:"max-content",minWidth:"100%"}}>
                <thead>
                  <tr>
                    <th style={{position:"sticky",top:0,left:0,zIndex:3,
                      width:36,background:"#f8fafc",border:"1px solid #e2e8f0",
                      padding:"4px 6px",color:"#94a3b8",fontSize:10,fontWeight:500,userSelect:"none"}}>#</th>
                    {csv.headers.map((h,ci)=>(
                      <th key={ci} style={{position:"sticky",top:0,zIndex:2,
                        background:"#f8fafc",border:"1px solid #e2e8f0",
                        padding:"5px 12px",color:"#475569",fontWeight:600,
                        whiteSpace:"nowrap",minWidth:90,maxWidth:220,
                        overflow:"hidden",textOverflow:"ellipsis",userSelect:"none"}}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row,ri)=>(
                    <tr key={ri}>
                      <td style={{position:"sticky",left:0,zIndex:1,
                        background:"#f8fafc",border:"1px solid #f1f5f9",
                        padding:"3px 6px",color:"#cbd5e1",fontSize:10,
                        textAlign:"center",userSelect:"none"}}>{ri+1}</td>
                      {csv.headers.map((_,ci)=>{
                        const isAc=activeCell?.shapeId===id&&activeCell?.ri===ri&&activeCell?.ci===ci;
                        return (
                          <td key={ci}
                            onClick={()=>setActiveCell({shapeId:id,csvId,ri,ci})}
                            style={{
                              border:isAc?"2px solid #3b82f6":"1px solid #f1f5f9",
                              padding:isAc?"2px 11px":"3px 12px",
                              background:isAc?"#eff6ff":ri%2===0?"#fff":"#fafafa",
                              color:"#1e293b",whiteSpace:"nowrap",
                              maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",
                              cursor:"cell",userSelect:"none",
                            }}>{row[ci]??""}</td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {truncated&&(
                <div style={{padding:"6px 12px",fontSize:10.5,color:"#94a3b8",
                  background:"#fafafa",borderTop:"1px solid #f1f5f9",textAlign:"center"}}>
                  Exibindo {MAX_ROWS} de {csv.rows.length} linhas
                </div>
              )}
            </div>
          </foreignObject>
        )}

        {/* Invisible border overlay — keeps shape selectable/connectable */}
        <rect data-sid={id} x={x} y={y} width={w} height={h} rx={10}
          fill="transparent" stroke="none" style={{pointerEvents:"none"}}/>
      </g>
    );
  };

  const onCinemaResizeDown = (e, id, dir) => {
    e.stopPropagation(); if (e.button!==0) return;
    movedR.current=false;
    const shape=shapesR.current.find(s=>s.id===id); if (!shape) return;
    const [sx,sy]=svgPt(e.clientX,e.clientY);
    const preSnap={shapes:shapesR.current,conns:connsR.current};
    dragR.current={type:"resize",id,dir,sx,sy,ix:shape.x,iy:shape.y,iw:shape.w,ih:shape.h,preSnap};
  };

  // ── Render: Cineminha (Cross Decision Matrix) ─────────────────
  const renderCinemaNode = (shape) => {
    const {id, x, y, w, h, rowVar, colVar, rowDomain, colDomain, cells, minimized, resultVar} = shape;
    const typeCfg = getCinemaType(shape.cinemaType);
    const isOffer = shape.cinemaType === 'offer';
    const isSel=sel===id, isFrom=fromId===id;
    const hasErr=!!flowErrors[id];
    const stroke=isFrom?"#f59e0b":isSel?"#3b82f6":hasErr?"#dc2626":typeCfg.color;
    const sw=isSel||isFrom?2:hasErr?2.5:1.5;
    const flt=hasErr?"drop-shadow(0 0 6px rgba(220,38,38,.5))":
               isSel?`drop-shadow(0 0 0 2px ${typeCfg.badgeBg}) drop-shadow(0 2px 8px ${typeCfg.badgeBg})`:
               isFrom?"drop-shadow(0 0 0 2px rgba(245,158,11,.25)) drop-shadow(0 2px 8px rgba(245,158,11,.18))":
               `drop-shadow(0 2px 12px ${typeCfg.badgeBg})`;
    const cur=tool==="connect"?"crosshair":tool==="select"?"grab":"default";
    const hasVars = rowVar || colVar;

    // Compute max cell value for offer gradient normalization
    const maxCellVal = isOffer
      ? Math.max(1, ...Object.values(cells || {}).map(v => typeof v === 'number' ? v : (v ? 1 : 0)))
      : 1;

    // Returns {bg, label, color} for a cell depending on type and value
    const cellVisual = (cellVal) => {
      if (isOffer) {
        if (cellVal === 0) return { bg: '#f1f5f9', label: '—', color: '#94a3b8' };
        const t = Math.min(cellVal / maxCellVal, 1);
        const r = Math.round(224 - t * 164);
        const g = Math.round(242 - t * 146);
        const b = Math.round(254 - t * 54);
        return { bg: `rgb(${r},${g},${b})`, label: String(cellVal), color: t > 0.55 ? '#fff' : '#0c4a6e' };
      }
      if (cellVal === 0) return { bg: '#ef4444', label: '✗', color: '#fff' };
      if (cellVal === 1) return { bg: '#22c55e', label: '✓', color: '#fff' };
      return { bg: '#6366f1', label: String(cellVal), color: '#fff' };
    };

    // Compact axis label list for header
    const axisLabels = [
      rowVar    ? { prefix: 'L', col: rowVar.col }    : null,
      colVar    ? { prefix: 'C', col: colVar.col }    : null,
      resultVar ? { prefix: 'R', col: resultVar.col } : null,
    ].filter(Boolean);

    // ── Minimized state ──
    if (minimized) {
      const MH=44;
      const MW=Math.max(170, w); // preserve last expanded width so resize works
      const lbl=shape.label||"Cineminha";
      return (
        <g key={id} data-sid={id}
          onMouseDown={e=>onShapeDown(e,id)} onClick={e=>onShapeClick(e,id)} onDoubleClick={e=>onShapeDbl(e,id)}
          style={{cursor:cur, filter:flt}}>
          <rect x={x} y={y} width={MW} height={MH} rx={10} fill={typeCfg.color} stroke={stroke} strokeWidth={sw}/>
          <text x={x+12} y={y+27} fontSize={13} fontFamily="'DM Sans',system-ui,sans-serif" fontWeight="700" fill="#fff" style={{pointerEvents:"none",userSelect:"none"}}>
            <title>{lbl}</title>
            ⊞ {trunc(lbl, Math.max(14, Math.floor((MW-90)/8)))}
          </text>
          {/* Type badge */}
          <rect x={x+MW-78} y={y+11} width={44} height={16} rx={8} fill="rgba(255,255,255,.22)" style={{pointerEvents:"none"}}/>
          <text x={x+MW-56} y={y+22} fontSize={8.5} textAnchor="middle" fontWeight="700" fill="#fff" fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>{typeCfg.icon} {typeCfg.label.slice(0,5)}</text>
          {resultVar&&(
            <text x={x+12} y={y+42} fontSize={8} fill="rgba(255,255,255,.75)" fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>R: {trunc(resultVar.col,14)}</text>
          )}
          <g onClick={e=>{e.stopPropagation();pushHistory();setShapes(p=>p.map(s=>s.id===id?{...s,minimized:false,...computeCinemaSize(s.rowDomain||[],s.colDomain||[])}:s));}} style={{cursor:"pointer"}}>
            <rect x={x+MW-28} y={y+8} width={22} height={22} rx={6} fill="rgba(255,255,255,.2)"/>
            <text x={x+MW-17} y={y+23} fontSize={13} textAnchor="middle" fill="#fff">⤢</text>
          </g>
          {/* Resize handle (right edge) when selected */}
          {isSel&&[
            [x+MW,y+MH/2,"e"],[x+MW,y,"ne"],[x+MW,y+MH,"se"],
          ].map(([hx,hy,dir])=>(
            <rect key={dir} x={hx-5} y={hy-5} width={10} height={10} rx={3}
              fill={typeCfg.color} stroke="#fff" strokeWidth={1.5}
              style={{cursor:resizeCursor(dir)}}
              onMouseDown={e=>{
                e.stopPropagation();
                const [sx,sy]=svgPt(e.clientX,e.clientY);
                dragR.current={type:"resize",id,dir,sx,sy,ix:x,iy:y,iw:MW,ih:MH};
              }}/>
          ))}
        </g>
      );
    }

    // ── Empty state ──
    if (!hasVars) {
      // For offer type, show gradient mini matrix icon
      const emptyColors = isOffer
        ? ["#bae6fd","#7dd3fc","#38bdf8","#0ea5e9","#0284c7","#0369a1"]
        : ["#22c55e","#ef4444","#22c55e","#ef4444","#22c55e","#22c55e"];
      return (
        <g key={id} data-sid={id}
          onMouseDown={e=>onShapeDown(e,id)} onClick={e=>onShapeClick(e,id)} onDoubleClick={e=>onShapeDbl(e,id)}
          style={{cursor:cur, filter:flt}}>
          <rect data-sid={id} x={x} y={y} width={w} height={h} rx={12}
            fill="#fff" stroke={stroke} strokeWidth={sw}/>
          {/* Mini matrix icon */}
          {[0,1,2].map(ci=>[0,1].map(ri=>(
            <rect key={`${ci}-${ri}`} x={x+20+ci*16} y={y+20+ri*14} width={13} height={11} rx={2} fill={emptyColors[ri*3+ci]} opacity={.85}/>
          )))}
          <text x={x+w/2} y={y+62} textAnchor="middle" fontSize={10.5}
            fontFamily="'DM Sans',system-ui,sans-serif" fontWeight="600" fill={typeCfg.color}
            style={{pointerEvents:"none",userSelect:"none"}}>
            <title>{shape.label||"Cineminha"}</title>
            {trunc(shape.label||"Cineminha", Math.max(16, Math.floor(w/8)))}
          </text>
          {/* Type badge */}
          <rect x={x+w/2-28} y={y+66} width={56} height={16} rx={8} fill={typeCfg.badgeBg} style={{pointerEvents:"none"}}/>
          <text x={x+w/2} y={y+77} textAnchor="middle" fontSize={8.5} fontWeight="700" fill={typeCfg.badgeFg} fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>{typeCfg.icon} {typeCfg.label.slice(0,7)}</text>
          <text x={x+w/2} y={y+92} textAnchor="middle" fontSize={9} fill="#94a3b8"
            fontFamily="'DM Sans',system-ui,sans-serif"
            style={{pointerEvents:"none",userSelect:"none"}}>Arraste variáveis aqui</text>
          {hasErr&&<>
            <circle cx={x+w} cy={y} r={9} fill="#dc2626" style={{pointerEvents:"none"}}/>
            <text x={x+w} y={y+4} textAnchor="middle" fontSize={11} fontWeight="700" fill="#fff" style={{pointerEvents:"none",userSelect:"none"}}>!</text>
          </>}
        </g>
      );
    }

    // ── Matrix state (1D or 2D) ──
    const rDom = rowDomain.length>0 ? rowDomain : ['*'];
    const cDom = colDomain.length>0 ? colDomain : ['*'];
    const show2D = rowVar && colVar;
    // Header colors per type
    const hdrBg   = isOffer ? '#ecfeff' : '#eef2ff';
    const hdrFg   = isOffer ? '#0e7490' : '#4f46e5';

    return (
      <g key={id} data-sid={id} style={{filter:flt}}>
        {/* Frame */}
        <rect x={x} y={y} width={w} height={h} rx={12} fill="#fff" stroke={stroke} strokeWidth={sw}/>

        {/* Title bar — drag handle */}
        <rect data-sid={id} x={x} y={y} width={w} height={CINEMA_TITLE_H} rx={12} fill={typeCfg.color}
          onMouseDown={e=>onShapeDown(e,id)} onClick={e=>onShapeClick(e,id)} style={{cursor:"grab"}}/>
        <rect x={x} y={y+CINEMA_TITLE_H-8} width={w} height={8} fill={typeCfg.color}/>

        {/* Title text */}
        <text x={x+12} y={y+24} fontSize={11} fontWeight="700" fill="#fff"
          fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>⊞ {trunc(shape.label||"Cineminha",16)}</text>

        {/* Type badge in title bar */}
        <rect x={x+12} y={y+27} width={58} height={14} rx={7} fill="rgba(255,255,255,.2)" style={{pointerEvents:"none"}}/>
        <text x={x+41} y={y+37} textAnchor="middle" fontSize={8.5} fontWeight="700" fill="#fff" fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>{typeCfg.icon} {typeCfg.label.slice(0,7)}</text>

        {/* Axis + result variable labels — stacked on right of header */}
        {axisLabels.map((lbl, i) => {
          const maxChars = Math.max(12, Math.floor((w - 90) / 6));
          return (
            <text key={lbl.prefix} x={x+w-40} y={y+13+i*10} textAnchor="end"
              fontSize={8.5} fill={lbl.prefix==='R' ? "rgba(255,255,255,.55)" : "rgba(255,255,255,.75)"}
              fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>
              <title>{lbl.prefix}: {lbl.col}</title>
              {lbl.prefix}: {trunc(lbl.col, maxChars)}
            </text>
          );
        })}

        {/* Interactive matrix via foreignObject */}
        <foreignObject x={x+1} y={y+CINEMA_TITLE_H} width={w-2} height={h-CINEMA_TITLE_H-1}>
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            style={{width:"100%",height:"100%",overflow:"auto",background:"#fff",
              borderBottomLeftRadius:11,borderBottomRightRadius:11,
              fontFamily:"'DM Sans',system-ui,sans-serif"}}
            onMouseDown={e=>e.stopPropagation()}
            onWheel={e=>e.stopPropagation()}
            onClick={e=>e.stopPropagation()}
            onTouchStart={e=>e.stopPropagation()}>
            {/* Result variable indicator bar */}
            {resultVar&&(
              <div style={{display:"flex",alignItems:"center",gap:5,padding:"3px 8px",
                background: isOffer ? "#ecfeff" : "#eef2ff",
                borderBottom:`1px solid ${isOffer?"#a5f3fc":"#c7d2fe"}`,fontSize:9,
                color: isOffer ? "#0e7490" : "#4f46e5", fontWeight:600}}>
                <span style={{opacity:.7}}>Resultado:</span>
                <span>{trunc(resultVar.col, 22)}</span>
                <button
                  onClick={()=>clearResultVar(id)}
                  title="Remover variável de resultado"
                  style={{marginLeft:"auto",border:"none",background:"transparent",
                    color:isOffer?"#0e7490":"#4f46e5",cursor:"pointer",fontSize:11,lineHeight:1,padding:"0 2px",opacity:.6}}>
                  ×
                </button>
              </div>
            )}
            <table style={{borderCollapse:"collapse",fontSize:11,width:"max-content",minWidth:"100%",tableLayout:"fixed"}}>
              {show2D&&(
                <thead>
                  <tr>
                    <th style={{width:CINEMA_LBL_W,background:"#f8fafc",border:"1px solid #e2e8f0",
                      padding:"4px 6px",fontSize:10,color:"#94a3b8",fontWeight:600,position:"sticky",top:0,left:0,zIndex:3}}>
                      {trunc(rowVar.col,8)} \ {trunc(colVar.col,8)}
                    </th>
                    {cDom.map(cv=>(
                      <th key={cv} style={{width:CINEMA_CELL_W,background:hdrBg,border:"1px solid #e2e8f0",
                        padding:"4px 6px",fontSize:10,color:hdrFg,fontWeight:600,textAlign:"center",
                        position:"sticky",top:0,zIndex:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                        {cv}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {rDom.map(rv=>(
                  <tr key={rv}>
                    {/* Row label */}
                    {rowVar&&(
                      <td style={{width:CINEMA_LBL_W,background:hdrBg,border:"1px solid #e2e8f0",
                        padding:"3px 8px",fontSize:10.5,fontWeight:600,color:hdrFg,
                        position:"sticky",left:0,zIndex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                        {rv}
                      </td>
                    )}
                    {cDom.map(cv=>{
                      const rKey = rowVar ? rv : '*';
                      const cKey = colVar ? cv : '*';
                      const cellKey = `${rKey}|${cKey}`;
                      const cellVal = getCellValue(cells, cellKey);
                      const eligible = cellVal > 0;
                      const vis = cellVisual(cellVal);
                      const portLabel = eligible ? typeCfg.ports[0].label : typeCfg.ports[1].label;
                      return (
                        <td key={cv} style={{width:CINEMA_CELL_W,padding:2,border:"1px solid #f1f5f9",textAlign:"center",background:"#fff"}}>
                          {!rowVar&&colVar&&(
                            <div style={{fontSize:10.5,fontWeight:600,color:hdrFg,marginBottom:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:CINEMA_CELL_W-4}}>
                              {cv}
                            </div>
                          )}
                          <button
                            onClick={()=>toggleCinemaCell(id, cellKey)}
                            onContextMenu={e=>{
                              e.preventDefault();
                              const v = window.prompt(`Valor da célula (0 = ${typeCfg.ports[1].label}, ≥1 = ${typeCfg.ports[0].label}):`, String(cellVal));
                              if (v !== null) setCinemaCellValue(id, cellKey, v);
                            }}
                            title={`${portLabel} — clique para alternar, botão direito para editar valor`}
                            style={{
                              width:"100%",height:CINEMA_CELL_H-6,border:"none",borderRadius:4,
                              background:vis.bg,color:vis.color,
                              cursor:"pointer",fontSize:13,fontWeight:700,
                              display:"flex",alignItems:"center",justifyContent:"center",
                              transition:"background .12s",
                            }}>
                            {vis.label}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </foreignObject>

        {/* Invisible pointer overlay for title bar clicks — excludes minimize btn area */}
        <rect data-sid={id} x={x} y={y} width={w-34} height={CINEMA_TITLE_H}
          fill="transparent" stroke="none"
          onMouseDown={e=>onShapeDown(e,id)} onClick={e=>onShapeClick(e,id)} onDoubleClick={e=>onShapeDbl(e,id)}
          style={{cursor:"grab"}}/>
        {/* Minimize btn — rendered above overlay */}
        <g onMouseDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setShapes(p=>p.map(s=>s.id===id?{...s,minimized:true,w:170,h:44}:s));}} style={{cursor:"pointer"}}>
          <rect x={x+w-30} y={y+7} width={24} height={24} rx={6} fill="rgba(255,255,255,.2)"/>
          <text x={x+w-18} y={y+23} fontSize={15} textAnchor="middle" fill="#fff" style={{pointerEvents:"none",userSelect:"none"}}>−</text>
        </g>

        {hasErr&&<>
          <circle cx={x+w} cy={y} r={9} fill="#dc2626" style={{pointerEvents:"none"}}/>
          <text x={x+w} y={y+4} textAnchor="middle" fontSize={11} fontWeight="700" fill="#fff" style={{pointerEvents:"none",userSelect:"none"}}>!</text>
        </>}
        {/* Resize handles when selected */}
        {isSel&&hasVars&&[
          [x,y,"nw"],[x+w/2,y,"n"],[x+w,y,"ne"],
          [x+w,y+h/2,"e"],[x+w,y+h,"se"],[x+w/2,y+h,"s"],
          [x,y+h,"sw"],[x,y+h/2,"w"],
        ].map(([hx,hy,dir])=>(
          <rect key={dir} x={hx-5} y={hy-5} width={10} height={10} rx={3}
            fill={typeCfg.color} stroke="#fff" strokeWidth={1.5}
            style={{cursor:resizeCursor(dir)}}
            onMouseDown={e=>onCinemaResizeDown(e,id,dir)}/>
        ))}
      </g>
    );
  };

  // ── Render: Decision Lens node ────────────────────────────────
  const renderDecisionLensNode = (shape) => {
    const {id, x, y, w, h, rules} = shape;
    const isSel = sel === id;
    const isMulti = multiSel.has(id) && !isSel;
    const ruleCount = (rules || []).length;
    // Compute population stats for this lens (Feature 4)
    const popMap = lensPopulations[id];
    let popQty = 0, popTotal = 0;
    if (popMap) {
      for (const [csvId, flags] of Object.entries(popMap)) {
        const csv = csvStore[csvId];
        if (!csv) continue;
        const types = csv.columnTypes || {};
        const qtyCol = Object.entries(types).find(([,t]) => t === 'qty')?.[0];
        const qtyIdx = qtyCol ? csv.headers.indexOf(qtyCol) : -1;
        flags.forEach((inPop, ri) => {
          const q = qtyIdx >= 0 ? (parseFloat(csv.rows[ri]?.[qtyIdx]) || 1) : 1;
          popTotal += q;
          if (inPop) popQty += q;
        });
      }
    }
    const stroke = isSel || isMulti ? "#3b82f6" : "#0891b2";
    const sw = isSel || isMulti ? 2 : 1.5;
    const filter = isSel
      ? "drop-shadow(0 0 0 2px rgba(59,130,246,.25)) drop-shadow(0 2px 8px rgba(59,130,246,.18))"
      : "drop-shadow(0 1px 6px rgba(8,145,178,.18))";
    const cur = tool === "connect" ? "crosshair" : tool === "select" ? "grab" : "default";
    return (
      <g key={id} data-sid={id}
        onMouseDown={e => onShapeDown(e, id)}
        onClick={e => onShapeClick(e, id)}
        onDoubleClick={e => onShapeDbl(e, id)}
        style={{cursor: cur, filter}}>
        {/* Outer border */}
        <rect data-sid={id} x={x} y={y} width={w} height={h} rx={12}
          fill="#ecfeff" stroke={stroke} strokeWidth={sw}/>
        {/* Header band */}
        <rect x={x} y={y} width={w} height={28} rx={12} fill="#0891b2"/>
        <rect x={x} y={y+16} width={w} height={12} fill="#0891b2"/>
        {/* Header icons + title */}
        <text x={x+10} y={y+19} fontSize={12} fill="#fff"
          fontFamily="'DM Sans',system-ui,sans-serif"
          style={{pointerEvents:"none",userSelect:"none"}}>🛢 🔎</text>
        <text x={x+w/2+10} y={y+19} textAnchor="middle" fontSize={11} fontWeight="700" fill="#fff"
          fontFamily="'DM Sans',system-ui,sans-serif"
          style={{pointerEvents:"none",userSelect:"none"}}>Decision Lens</text>
        {/* Body */}
        {ruleCount === 0 ? (
          <text x={x+w/2} y={y+57} textAnchor="middle" fontSize={10.5} fill="#94a3b8"
            fontFamily="'DM Sans',system-ui,sans-serif"
            style={{pointerEvents:"none",userSelect:"none"}}>Sem filtros — clique Configurar</text>
        ) : (
          <>
            <text x={x+w/2} y={y+46} textAnchor="middle" fontSize={12} fontWeight="700" fill="#0e7490"
              fontFamily="'DM Sans',system-ui,sans-serif"
              style={{pointerEvents:"none",userSelect:"none"}}>
              {`${ruleCount} filtro${ruleCount !== 1 ? "s" : ""} ativo${ruleCount !== 1 ? "s" : ""}`}
            </text>
            {popTotal > 0 && (
              <text x={x+w/2} y={y+61} textAnchor="middle" fontSize={10} fontWeight="600" fill="#0891b2"
                fontFamily="'DM Sans',system-ui,sans-serif"
                style={{pointerEvents:"none",userSelect:"none"}}>
                {`👥 ${fmtQty(popQty)} / ${fmtQty(popTotal)} impactados`}
              </text>
            )}
            {popTotal === 0 && (
              <text x={x+w/2} y={y+61} textAnchor="middle" fontSize={10} fill="#64748b"
                fontFamily="'DM Sans',system-ui,sans-serif"
                style={{pointerEvents:"none",userSelect:"none"}}>
                Clique Configurar para editar
              </text>
            )}
          </>
        )}
        {/* Selection handles */}
        {(isSel || isMulti) && [
          [x,y],[x+w/2,y],[x+w,y],
          [x+w,y+h/2],[x+w,y+h],[x+w/2,y+h],[x,y+h],[x,y+h/2]
        ].map(([hx,hy],i)=>(
          <rect key={i} x={hx-4} y={hy-4} width={8} height={8} rx={2}
            fill="#3b82f6" stroke="#fff" strokeWidth={1.5}
            style={{pointerEvents:"none"}}/>
        ))}
      </g>
    );
  };

  // ── Render: regular shape ─────────────────────────────────────
  const renderShape = (shape) => {
    if (shape.type==="frame")         return null; // rendered separately in lower layer
    if (shape.type==="csv")           return renderCSVNode(shape);
    if (shape.type==="simPanel")      return renderSimPanel(shape);
    if (shape.type==="cineminha")     return renderCinemaNode(shape);
    if (shape.type==="decision_lens") return renderDecisionLensNode(shape);
    const {id,type,x,y,w,h,label,color}=shape;
    const isSel=sel===id, isFrom=fromId===id, isMulti=multiSel.has(id)&&!isSel;
    const hasErr=!!flowErrors[id];
    const stroke=isFrom?"#f59e0b":(isSel||isMulti)?"#3b82f6":hasErr?"#dc2626":"#94a3b8";
    const sw=(isSel||isFrom||isMulti)?2:hasErr?2.5:1.5;
    const fill=color||"#fff";
    const flt=hasErr?"drop-shadow(0 0 6px rgba(220,38,38,.5))":
               isSel?"drop-shadow(0 0 0 2px rgba(59,130,246,.25)) drop-shadow(0 2px 8px rgba(59,130,246,.18))":
               isFrom?"drop-shadow(0 0 0 2px rgba(245,158,11,.25)) drop-shadow(0 2px 8px rgba(245,158,11,.18))":
               "drop-shadow(0 1px 4px rgba(0,0,0,.1))";
    const cur=tool==="connect"?"crosshair":tool==="select"?"grab":"default";
    const errBadge=hasErr&&(<>
      <circle cx={x+w} cy={y} r={9} fill="#dc2626" style={{pointerEvents:"none"}}/>
      <text x={x+w} y={y+4} textAnchor="middle" fontSize={11} fontWeight="700" fill="#fff"
        style={{pointerEvents:"none",userSelect:"none"}}>!</text>
    </>);
    const txt=(<text data-sid={id} x={x+w/2} y={y+h/2} textAnchor="middle" dominantBaseline="middle"
      fontSize={12} fontFamily="'DM Sans',system-ui,sans-serif" fontWeight="500" fill="#1e293b"
      style={{pointerEvents:"none",userSelect:"none"}}>{label}</text>);
    const showTooltip=()=>{
      clearTimeout(tooltipTimer.current);
      tooltipTimer.current=setTimeout(()=>{
        const sx2=shape.x*vp.s+vp.x, sy2=shape.y*vp.s+vp.y;
        let lines=[label];
        if(type==="decision"){
          lines=[shape.label,shape.variableCol||""];
          const csv2=shape.csvId&&csvStore[shape.csvId];
          if(csv2){const ci=csv2.headers.indexOf(shape.variableCol);if(ci>=0){const cnt=new Set(csv2.rows.map(r=>r[ci]??'')).size;lines.push(`${cnt} valores distintos`);}}
        } else if(type==="port"){lines=[shape.label];}
        setTooltip({x:sx2,y:sy2,lines});
      },400);
    };
    const hideTooltip=()=>{clearTimeout(tooltipTimer.current);setTooltip(null);};
    const gp={"data-sid":id,onMouseDown:(e)=>onShapeDown(e,id),onClick:(e)=>onShapeClick(e,id),onDoubleClick:(e)=>onShapeDbl(e,id),onMouseEnter:showTooltip,onMouseLeave:hideTooltip,style:{cursor:cur,filter:flt}};
    if (type==="rect")    return <g key={id} {...gp}><rect data-sid={id} x={x} y={y} width={w} height={h} rx={10} fill={fill} stroke={stroke} strokeWidth={sw}/>{txt}{errBadge}</g>;
    if (type==="circle")  return <g key={id} {...gp}><ellipse data-sid={id} cx={x+w/2} cy={y+h/2} rx={w/2} ry={h/2} fill={fill} stroke={stroke} strokeWidth={sw}/>{txt}{errBadge}</g>;
    if (type==="diamond"){const pts=`${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}`;return <g key={id} {...gp}><polygon data-sid={id} points={pts} fill={fill} stroke={stroke} strokeWidth={sw}/>{txt}{errBadge}</g>;}
    if (type==="decision") {
      const pts=`${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}`;
      const decStroke=isFrom?"#f59e0b":isSel?"#3b82f6":hasErr?"#dc2626":"#d97706";
      return (
        <g key={id} {...gp}>
          <polygon data-sid={id} points={pts} fill={hasErr?"#fff1f2":"#fef3c7"} stroke={decStroke} strokeWidth={sw}/>
          <text x={x+w/2} y={y+h/2-9} textAnchor="middle" fontSize={9} fill={hasErr?"#dc2626":"#92400e"}
            fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>decisão</text>
          <text x={x+w/2} y={y+h/2+7} textAnchor="middle" fontSize={12} fontWeight="600" fill="#1e293b"
            fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>{trunc(label,14)}</text>
          {errBadge}
        </g>
      );
    }
    if (type==="port") {
      const isRed = (color==="#fff1f2");
      const portFill  = hasErr?"#fff1f2":(color||"#f0fdf4");
      const portTxt   = hasErr?"#dc2626":isRed?"#991b1b":"#166534";
      const portStroke= isFrom?"#f59e0b":isSel?"#3b82f6":hasErr?"#dc2626":isRed?"#fca5a5":"#86efac";
      return (
        <g key={id} {...gp}>
          <rect data-sid={id} x={x} y={y} width={w} height={h} rx={h/2}
            fill={portFill} stroke={portStroke} strokeWidth={sw}/>
          <text x={x+w/2} y={y+h/2} textAnchor="middle" dominantBaseline="middle"
            fontSize={11} fontFamily="'DM Sans',system-ui,sans-serif" fontWeight="500" fill={portTxt}
            style={{pointerEvents:"none",userSelect:"none"}}>{trunc(label,14)}</text>
          {errBadge}
        </g>
      );
    }
    if (type==="approved") {
      return (
        <g key={id} {...gp}>
          <rect data-sid={id} x={x} y={y} width={w} height={h} rx={22}
            fill="#dcfce7" stroke={isSel?"#3b82f6":"#16a34a"} strokeWidth={sw}/>
          <text x={x+w/2} y={y+h/2} textAnchor="middle" dominantBaseline="middle"
            fontSize={12} fontFamily="'DM Sans',system-ui,sans-serif" fontWeight="600" fill="#15803d"
            style={{pointerEvents:"none",userSelect:"none"}}>✅ {label||"Aprovado"}</text>
        </g>
      );
    }
    if (type==="rejected") {
      return (
        <g key={id} {...gp}>
          <rect data-sid={id} x={x} y={y} width={w} height={h} rx={22}
            fill="#fee2e2" stroke={isSel?"#3b82f6":"#dc2626"} strokeWidth={sw}/>
          <text x={x+w/2} y={y+h/2} textAnchor="middle" dominantBaseline="middle"
            fontSize={12} fontFamily="'DM Sans',system-ui,sans-serif" fontWeight="600" fill="#dc2626"
            style={{pointerEvents:"none",userSelect:"none"}}>❌ {label||"Reprovado"}</text>
        </g>
      );
    }
    if (type==="as_is") {
      return (
        <g key={id} {...gp}>
          <title>Mantém o comportamento original da base sem alterar o resultado da simulação.</title>
          <rect data-sid={id} x={x} y={y} width={w} height={h} rx={22}
            fill="#f3f4f6" stroke={isSel?"#3b82f6":"#9ca3af"} strokeWidth={sw}/>
          <text x={x+w/2} y={y+h/2} textAnchor="middle" dominantBaseline="middle"
            fontSize={12} fontFamily="'DM Sans',system-ui,sans-serif" fontWeight="600" fill="#4b5563"
            style={{pointerEvents:"none",userSelect:"none"}}>⟳ {label||"AS IS"}</text>
        </g>
      );
    }
    return null;
  };

  // ── Render: simulation panel ──────────────────────────────────
  const renderSimPanel = (shape) => {
    const {id,x,y,w,h}=shape;
    const isSel=sel===id;
    const HDR_H = 44;

    const inc = incrementalResult;
    const hasInc = !!inc;
    const displayResult = hasInc ? inc.simulated : simResult;
    const hasData = displayResult.totalQty > 0;

    const rate = hasData ? displayResult.approvalRate : null;
    const irV = displayResult.inadReal;
    const iiV = displayResult.inadInferida;

    // Semantic colors
    const rateColor = rate === null ? "#94a3b8" : rate >= 70 ? "#22c55e" : rate >= 40 ? "#f59e0b" : "#ef4444";
    const inadColor = (v) => v === null ? "#64748b" : v > 0.05 ? "#ef4444" : v > 0.02 ? "#f59e0b" : "#22c55e";
    const deltaClr = (d, positiveHigh = true) => {
      if (d === null || isNaN(d)) return "#64748b";
      return positiveHigh ? (d > 0 ? "#4ade80" : d < 0 ? "#f87171" : "#64748b")
                          : (d < 0 ? "#4ade80" : d > 0 ? "#f87171" : "#64748b");
    };
    const fmtD = (d, scale = 100) => {
      if (d === null || isNaN(d)) return null;
      return `${d >= 0 ? '+' : '−'}${Math.abs(d * scale).toFixed(2)}pp`;
    };

    const rateDelta = hasInc && inc.baseline.totalQty > 0 ? inc.simulated.approvalRate - inc.baseline.approvalRate : null;
    const irDelta = hasInc && irV !== null && inc.baseline.inadReal !== null ? irV - inc.baseline.inadReal : null;
    const iiDelta = hasInc && iiV !== null && inc.baseline.inadInferida !== null ? iiV - inc.baseline.inadInferida : null;

    const heroVal = hasInc && rateDelta !== null ? (fmtD(rateDelta / 100) ?? '—') : (rate !== null ? `${rate.toFixed(1)}%` : '—');
    const heroLabel = hasInc && rateDelta !== null ? 'VARIAÇÃO NA APROVAÇÃO' : 'TAXA DE APROVAÇÃO';
    const heroColor = hasInc && rateDelta !== null ? deltaClr(rateDelta, true) : rateColor;

    return (
      <g key={id} data-sid={id}
        onMouseDown={e=>onShapeDown(e,id)} onClick={e=>onShapeClick(e,id)}
        style={{cursor:tool==="select"?"grab":"default",
          filter:isSel?"drop-shadow(0 0 6px rgba(129,140,248,.6)) drop-shadow(0 4px 24px rgba(99,102,241,.25))":"drop-shadow(0 6px 28px rgba(0,0,0,.45))"}}>
        {/* Background */}
        <rect x={x} y={y} width={w} height={h} rx={14} fill="#0f172a" stroke={isSel?"#818cf8":"#1e1b4b"} strokeWidth={isSel?2:1.5}/>
        {/* Header gradient */}
        <defs>
          <linearGradient id={`hg-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#1e1b4b"/>
            <stop offset="100%" stopColor="#1a1040"/>
          </linearGradient>
        </defs>
        <rect x={x} y={y} width={w} height={HDR_H} rx={14} fill={`url(#hg-${id})`}/>
        <rect x={x} y={y+HDR_H-14} width={w} height={14} fill={`url(#hg-${id})`}/>
        <text x={x+13} y={y+27} fontSize={10} fontWeight="800" fill="#818cf8" letterSpacing="1.5"
          fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none",textTransform:"uppercase"}}>BUSINESS IMPACT</text>
        {hasData && <text x={x+w-13} y={y+27} textAnchor="end" fontSize={9} fill="#334155"
          fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>{fmtQty(displayResult.totalQty)} reg.</text>}
        {/* Hero KPI via foreignObject */}
        <foreignObject x={x} y={y+HDR_H} width={w} height={h-HDR_H}>
          <div xmlns="http://www.w3.org/1999/xhtml"
            style={{width:"100%",height:"100%",overflow:"hidden",fontFamily:"'DM Sans',system-ui,sans-serif",
              background:"linear-gradient(160deg,#0f172a 0%,#1a1040 100%)",
              borderBottomLeftRadius:13,borderBottomRightRadius:13,display:"flex",flexDirection:"column"}}
            onMouseDown={e=>e.stopPropagation()}>

            {/* Hero */}
            <div style={{padding:"14px 14px 10px",textAlign:"center",borderBottom:"1px solid rgba(255,255,255,0.05)",position:"relative",flexShrink:0}}>
              <div style={{fontSize:36,fontWeight:900,color:hasData?heroColor:"#1e293b",lineHeight:1,letterSpacing:"-0.02em"}}>{heroVal}</div>
              <div style={{fontSize:8.5,color:"#475569",fontWeight:700,letterSpacing:"0.1em",marginTop:5,textTransform:"uppercase"}}>{heroLabel}</div>
              {hasInc && inc.baseline.totalQty > 0 && (
                <div style={{fontSize:9,color:"#334155",marginTop:4}}>{inc.baseline.approvalRate.toFixed(1)}% → {(rate ?? 0).toFixed(1)}%</div>
              )}
            </div>

            {/* Progress bar */}
            {hasData && (
              <div style={{padding:"6px 12px 0",flexShrink:0}}>
                <div style={{height:4,borderRadius:2,background:"rgba(255,255,255,0.06)",overflow:"hidden",position:"relative"}}>
                  <div style={{height:"100%",width:`${rate??0}%`,borderRadius:2,background:`linear-gradient(90deg,${rateColor}88,${rateColor})`,transition:"width .4s ease"}}/>
                  {hasInc && inc.baseline.totalQty > 0 && (
                    <div style={{position:"absolute",top:0,height:"100%",left:`${inc.baseline.approvalRate}%`,width:2,background:"rgba(255,255,255,0.3)",borderRadius:1}}/>
                  )}
                </div>
              </div>
            )}

            {/* Metric grid */}
            <div style={{padding:"8px 10px 6px",display:"flex",flexDirection:"column",gap:5,flexShrink:0}}>
              {/* Row 1 */}
              <div style={{display:"flex",gap:5}}>
                {[
                  {label:"Aprovação", val:rate!==null?`${rate.toFixed(1)}%`:"—", delta:rateDelta!==null?rateDelta/100:null, ph:true, sub:hasData?`✓${fmtQty(displayResult.approvedQty)} ✗${fmtQty(displayResult.rejectedQty)}${simResult.asIsQty>0?` ⟳${fmtQty(simResult.asIsQty)}`:""}`:null},
                  {label:"Inad. Real", val:irV!==null?fmtPct(irV):"—", delta:irDelta, ph:false, sub:"∑Inad/∑Altas"},
                ].map((m,i)=>(
                  <div key={i} style={{flex:1,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:8,padding:"6px 8px"}}>
                    <div style={{fontSize:7.5,color:"#64748b",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>{m.label}</div>
                    <div style={{fontSize:15,fontWeight:800,color:m.label==="Aprovação"?rateColor:inadColor(irV),lineHeight:1}}>{m.val}</div>
                    {m.delta!==null&&m.delta!==undefined&&<div style={{fontSize:8.5,fontWeight:700,color:deltaClr(m.delta,m.ph),marginTop:2}}>{fmtD(m.delta)}</div>}
                    {m.sub&&<div style={{fontSize:7.5,color:"#334155",marginTop:1}}>{m.sub}</div>}
                  </div>
                ))}
              </div>
              {/* Row 2 */}
              <div style={{display:"flex",gap:5}}>
                {[
                  {label:"Inad. Inferida", val:iiV!==null?fmtPct(iiV):"—", delta:iiDelta, ph:false, col:inadColor(iiV), sub:"∑Inad.I/Aprov."},
                  {label:"Vol. Aprovado", val:hasData?fmtQty(displayResult.approvedQty):"—", delta:null, ph:true, col:"#e2e8f0", sub:hasData?`${(rate??0).toFixed(1)}% da base`:null},
                ].map((m,i)=>(
                  <div key={i} style={{flex:1,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:8,padding:"6px 8px"}}>
                    <div style={{fontSize:7.5,color:"#64748b",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>{m.label}</div>
                    <div style={{fontSize:15,fontWeight:800,color:m.col,lineHeight:1}}>{m.val}</div>
                    {m.delta!==null&&m.delta!==undefined&&<div style={{fontSize:8.5,fontWeight:700,color:deltaClr(m.delta,m.ph),marginTop:2}}>{fmtD(m.delta)}</div>}
                    {m.sub&&<div style={{fontSize:7.5,color:"#334155",marginTop:1}}>{m.sub}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Efeito da Mudança */}
            {hasInc && inc.impacted.qty > 0 && (
              <div style={{padding:"7px 10px 10px",borderTop:"1px solid rgba(255,255,255,0.05)",flexShrink:0}}>
                <div style={{fontSize:8,color:"#a78bfa",fontWeight:800,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.08em"}}>⚡ Efeito da Mudança</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:5}}>
                  <div style={{background:"rgba(74,222,128,0.07)",border:"1px solid rgba(74,222,128,0.18)",borderRadius:7,padding:"5px 8px",textAlign:"center"}}>
                    <div style={{fontSize:7,color:"#4ade80",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:2}}>Novos Aprov.</div>
                    <div style={{fontSize:14,fontWeight:800,color:"#4ade80"}}>+{fmtQty(inc.impacted.rToA)}</div>
                  </div>
                  <div style={{background:"rgba(248,113,113,0.07)",border:"1px solid rgba(248,113,113,0.18)",borderRadius:7,padding:"5px 8px",textAlign:"center"}}>
                    <div style={{fontSize:7,color:"#f87171",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:2}}>Novos Repr.</div>
                    <div style={{fontSize:14,fontWeight:800,color:"#f87171"}}>−{fmtQty(inc.impacted.aToR)}</div>
                  </div>
                </div>
                {(inc.impacted.altasInferRtoA > 0 || inc.impacted.altasRealAtoR > 0) && (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:5,marginBottom:5}}>
                    <div style={{background:"rgba(74,222,128,0.05)",border:"1px solid rgba(74,222,128,0.12)",borderRadius:7,padding:"5px 8px",textAlign:"center"}}>
                      <div style={{fontSize:7,color:"#86efac",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:2}}>Conv. Inferida</div>
                      <div style={{fontSize:14,fontWeight:800,color:"#86efac"}}>+{fmtQty(inc.impacted.altasInferRtoA)}</div>
                      <div style={{fontSize:6.5,color:"#475569",marginTop:1}}>altas estimadas</div>
                    </div>
                    <div style={{background:"rgba(248,113,113,0.05)",border:"1px solid rgba(248,113,113,0.12)",borderRadius:7,padding:"5px 8px",textAlign:"center"}}>
                      <div style={{fontSize:7,color:"#fca5a5",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:2}}>Altas Perdidas</div>
                      <div style={{fontSize:14,fontWeight:800,color:"#fca5a5"}}>−{fmtQty(inc.impacted.altasRealAtoR)}</div>
                      <div style={{fontSize:6.5,color:"#475569",marginTop:1}}>altas históricas</div>
                    </div>
                  </div>
                )}
                <div style={{textAlign:"center",fontSize:8,color:"#475569"}}>
                  {fmtQty(inc.impacted.qty)} impactados · {inc.impacted.pct.toFixed(1)}% da base
                </div>
              </div>
            )}
          </div>
        </foreignObject>
      </g>
    );
  };

  // ── Render: Frame (visual grouping container) ─────────────────
  const RESIZE_DIRS = ["nw","n","ne","e","se","s","sw","w"];
  const resizeCursor = (dir) => ({nw:"nw-resize",n:"n-resize",ne:"ne-resize",e:"e-resize",se:"se-resize",s:"s-resize",sw:"sw-resize",w:"w-resize"}[dir]||"default");

  const onFrameResizeDown = (e, id, dir) => {
    e.stopPropagation(); if (e.button!==0) return;
    movedR.current=false;
    const shape=shapesR.current.find(s=>s.id===id); if (!shape) return;
    const [sx,sy]=svgPt(e.clientX,e.clientY);
    dragR.current={type:"resize",id,dir,sx,sy,ix:shape.x,iy:shape.y,iw:shape.w,ih:shape.h};
  };

  const renderFrame = (shape) => {
    const {id,x,y,w,h,label,color}=shape;
    const isSel=sel===id;
    const isMulti=multiSel.has(id);
    const stroke=isSel||isMulti?"#3b82f6":"#94a3b8";
    const sw=isSel||isMulti?2:1.5;
    const fill=color||"rgba(219,234,254,0.25)";
    const TITLE_H=28;
    const resizeHandles=[
      [x,y,"nw"],[x+w/2,y,"n"],[x+w,y,"ne"],
      [x+w,y+h/2,"e"],[x+w,y+h,"se"],[x+w/2,y+h,"s"],
      [x,y+h,"sw"],[x,y+h/2,"w"],
    ];
    return (
      <g key={id} data-sid={id}>
        {/* Body */}
        <rect data-sid={id} x={x} y={y} width={w} height={h} rx={10}
          fill={fill} stroke={stroke} strokeWidth={sw} strokeDasharray={isSel?"none":"8 4"}
          onMouseDown={e=>onShapeDown(e,id)} onClick={e=>onShapeClick(e,id)} onDoubleClick={e=>onShapeDbl(e,id)}
          style={{cursor:tool==="select"?"grab":"default"}}/>
        {/* Title strip */}
        <rect x={x} y={y} width={w} height={TITLE_H} rx={10}
          fill="rgba(148,163,184,0.18)" style={{pointerEvents:"none"}}/>
        <rect x={x} y={y+TITLE_H-6} width={w} height={6}
          fill="rgba(148,163,184,0.18)" style={{pointerEvents:"none"}}/>
        {/* Title text */}
        <text x={x+12} y={y+18} fontSize={12} fontWeight="600" fill="#475569"
          fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>
          {label||"Frame"}
        </text>
        {/* Resize handles (only when selected) */}
        {isSel && resizeHandles.map(([hx,hy,dir])=>(
          <rect key={dir} x={hx-5} y={hy-5} width={10} height={10} rx={3}
            fill="#3b82f6" stroke="#fff" strokeWidth={1.5}
            style={{cursor:resizeCursor(dir)}}
            onMouseDown={e=>onFrameResizeDown(e,id,dir)}/>
        ))}
      </g>
    );
  };

  // ── Edit & helpers ────────────────────────────────────────────
  const editShape=edit?shapes.find(s=>s.id===edit.id):null;
  const commitEdit=()=>{if(!edit)return;pushHistory();setShapes(p=>p.map(s=>s.id===edit.id?{...s,label:edit.val}:s));setEdit(null);};
  const selShape=sel?shapes.find(s=>s.id===sel):null;
  const canvasCursor=tool==="hand"?"grab":tool==="select"?"default":"crosshair";

  // ── Decision variables computed for right panel ───────────────
  const decisionVars = Object.entries(csvStore).flatMap(([csvId,csv])=>
    Object.entries(csv.columnTypes||{})
      .filter(([,type])=>type==="decision")
      .map(([col])=>({col,csvId}))
  );

  // ── Optimization modal ────────────────────────────────────────────────────
  const openOptimModal = (shapeId) => {
    const shape = shapes.find(s => s.id === shapeId);
    if (!shape) return;
    pendingOptimShapeIdRef.current = shapeId;
    workerRef.current?.postMessage({ type: 'COMPUTE_OPTIM', shape });
  };

  const applyOptimResult = (shapeId, proposedCells) => {
    pushHistory();
    setShapes(prev => prev.map(s => s.id === shapeId ? { ...s, cells: proposedCells } : s));
    setOptimModal(null);
  };

  // ────────────────────────────────────────────────────────────────────────────
  // JSX
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{display:"flex",width:"100%",height:"100vh",overflow:"hidden",fontFamily:"'DM Sans',system-ui,sans-serif",background:"#f1f5f9"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        .wbt{transition:background .12s,color .12s;}
        .wbt:hover{background:#eff6ff!important;color:#2563eb!important;}
        .wbz:hover{background:#eff6ff!important;color:#2563eb!important;}
        .wbz:active{transform:scale(.93);}
        @media(max-width:560px){.wbl{display:none!important;}}
      `}</style>

      {/* ═══════════════ CANVAS AREA ═══════════════ */}
      <div style={{flex:1,position:"relative",overflow:"hidden"}}>

        {/* Toolbar */}
        <div style={{position:"absolute",top:14,left:"50%",transform:"translateX(-50%)",zIndex:300,
          display:"flex",gap:2,alignItems:"center",background:"#fff",padding:"6px 8px",borderRadius:14,
          border:"1px solid #e2e8f0",boxShadow:"0 2px 12px rgba(0,0,0,.08)",maxWidth:"calc(100% - 24px)",overflowX:"auto"}}>
          {TOOLS.map(t=>{
            if (t.id === 'cineminha') return (
              <div key={t.id} style={{position:"relative"}}>
                <button className="wbt"
                  ref={cinemaDropdownBtnRef}
                  onClick={()=>{
                    const r = cinemaDropdownBtnRef.current?.getBoundingClientRect();
                    if(r) setCinemaDropdownPos({x:r.left, y:r.bottom+6});
                    setCinemaDropdownOpen(o=>!o);
                  }}
                  title={t.label}
                  style={{display:"flex",alignItems:"center",gap:5,padding:"6px 11px",borderRadius:9,border:"none",
                    background:tool==='cineminha'?"#2563eb":"transparent",
                    color:tool==='cineminha'?"#fff":"#475569",
                    cursor:"pointer",fontSize:12.5,fontWeight:500,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                  <span style={{fontSize:15,lineHeight:1}}>⊞</span>
                  <span className="wbl">Cineminha</span>
                  <span style={{fontSize:9,marginLeft:1,opacity:.7}}>▾</span>
                </button>
                {cinemaDropdownOpen && createPortal(
                  <>
                    <div style={{position:"fixed",inset:0,zIndex:9998}} onClick={()=>setCinemaDropdownOpen(false)}/>
                    <div style={{position:"fixed",top:cinemaDropdownPos.y,left:cinemaDropdownPos.x,background:"#fff",borderRadius:10,
                      border:"1px solid #e2e8f0",boxShadow:"0 8px 24px rgba(0,0,0,.12)",minWidth:210,zIndex:9999,overflow:"hidden"}}>
                      <button
                        onClick={()=>{setTool('cineminha');setFromId(null);setCinemaDropdownOpen(false);}}
                        style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"10px 16px",border:"none",
                          background:"transparent",cursor:"pointer",fontSize:13,fontFamily:"inherit",color:"#1e293b",textAlign:"left"}}
                        onMouseEnter={e=>e.currentTarget.style.background="#f8fafc"}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <span style={{fontSize:15}}>⊞</span>
                        <div>
                          <div style={{fontWeight:600}}>Inserir no Canvas</div>
                          <div style={{fontSize:11,color:"#94a3b8",marginTop:1}}>Clique no canvas para posicionar</div>
                        </div>
                      </button>
                      <div style={{height:1,background:"#f1f5f9",margin:"0 12px"}}/>
                      <button
                        onClick={()=>{openCinemaLibrary(null,'browse');setCinemaDropdownOpen(false);}}
                        style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"10px 16px",border:"none",
                          background:"transparent",cursor:"pointer",fontSize:13,fontFamily:"inherit",color:"#1e293b",textAlign:"left"}}
                        onMouseEnter={e=>e.currentTarget.style.background="#f8fafc"}
                        onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <span style={{fontSize:15}}>📥</span>
                        <div>
                          <div style={{fontWeight:600}}>Importar da Biblioteca</div>
                          <div style={{fontSize:11,color:"#94a3b8",marginTop:1}}>Adicionar modelos salvos ao canvas</div>
                        </div>
                      </button>
                    </div>
                  </>,
                  document.body
                )}
              </div>
            );
            return (
              <button key={t.id} className="wbt" onClick={()=>{setTool(t.id);setFromId(null);}} title={t.label}
                style={{display:"flex",alignItems:"center",gap:5,padding:"6px 11px",borderRadius:9,border:"none",
                  background:tool===t.id?"#2563eb":"transparent",color:tool===t.id?"#fff":"#475569",
                  cursor:"pointer",fontSize:12.5,fontWeight:500,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                <span style={{fontSize:15,lineHeight:1}}>{t.icon}</span>
                <span className="wbl">{t.label}</span>
              </button>
            );
          })}
          <div style={{width:1,height:22,background:"#e2e8f0",margin:"0 3px",flexShrink:0}}/>
          {/* Undo / Redo */}
          <button className="wbt" onClick={undo} disabled={undoStack.length===0} title="Desfazer (Ctrl+Z)"
            style={{display:"flex",alignItems:"center",gap:4,padding:"6px 10px",borderRadius:9,border:"none",
              background:"transparent",color:undoStack.length>0?"#475569":"#cbd5e1",
              cursor:undoStack.length>0?"pointer":"default",fontSize:12.5,fontFamily:"inherit",flexShrink:0}}>
            ↩ <span className="wbl">Desfazer</span>
          </button>
          <button className="wbt" onClick={redo} disabled={redoStack.length===0} title="Refazer (Ctrl+Y)"
            style={{display:"flex",alignItems:"center",gap:4,padding:"6px 10px",borderRadius:9,border:"none",
              background:"transparent",color:redoStack.length>0?"#475569":"#cbd5e1",
              cursor:redoStack.length>0?"pointer":"default",fontSize:12.5,fontFamily:"inherit",flexShrink:0}}>
            ↪ <span className="wbl">Refazer</span>
          </button>
          <div style={{width:1,height:22,background:"#e2e8f0",margin:"0 3px",flexShrink:0}}/>
          {selShape&&selShape.type!=="csv"&&(
            <button className="wbt" onClick={()=>setPalette(v=>!v)} title="Cor"
              style={{width:28,height:28,borderRadius:8,flexShrink:0,
                border:`2px solid ${palette?"#3b82f6":"#e2e8f0"}`,
                background:selShape.color||"#fff",cursor:"pointer",transition:"border-color .15s"}}/>
          )}
          {(sel||multiSel.size>0)&&(
            <button className="wbt" onClick={deleteSelected}
              style={{display:"flex",alignItems:"center",gap:4,padding:"6px 10px",borderRadius:9,border:"none",
                background:"#fff1f2",color:"#e11d48",
                cursor:"pointer",fontSize:12.5,fontWeight:500,fontFamily:"inherit",flexShrink:0}}>
              🗑 <span className="wbl">{multiSel.size>1?`Deletar (${multiSel.size})`:"Deletar"}</span>
            </button>
          )}
        </div>

        {/* Alignment toolbar — shows when multiSel.size > 1 */}
        {multiSel.size>1&&(()=>{
          const applyAlign=(dir)=>{
            const sel2=shapes.filter(s=>multiSel.has(s.id));
            if(sel2.length<2) return;
            pushHistory();
            setShapes(prev=>prev.map(s=>{
              if(!multiSel.has(s.id)) return s;
              if(dir==="left")    return {...s,x:Math.min(...sel2.map(q=>q.x))};
              if(dir==="right")   return {...s,x:Math.max(...sel2.map(q=>q.x+q.w))-s.w};
              if(dir==="top")     return {...s,y:Math.min(...sel2.map(q=>q.y))};
              if(dir==="bottom")  return {...s,y:Math.max(...sel2.map(q=>q.y+q.h))-s.h};
              if(dir==="centerH") {
                const midX=(Math.min(...sel2.map(q=>q.x))+Math.max(...sel2.map(q=>q.x+q.w)))/2;
                return {...s,x:midX-s.w/2};
              }
              if(dir==="centerV") {
                const midY=(Math.min(...sel2.map(q=>q.y))+Math.max(...sel2.map(q=>q.y+q.h)))/2;
                return {...s,y:midY-s.h/2};
              }
              if(dir==="distH"){
                const sorted=[...sel2].sort((a,b)=>(a.x+a.w/2)-(b.x+b.w/2));
                const totalW=sorted.reduce((a,q)=>a+q.w,0);
                const span=Math.max(...sorted.map(q=>q.x+q.w))-Math.min(...sorted.map(q=>q.x));
                const gap=(span-totalW)/(sorted.length-1);
                let cx2=Math.min(...sorted.map(q=>q.x));
                const posMap={};
                for(const q of sorted){posMap[q.id]=cx2;cx2+=q.w+gap;}
                return {...s,x:posMap[s.id]??s.x};
              }
              if(dir==="distV"){
                const sorted=[...sel2].sort((a,b)=>(a.y+a.h/2)-(b.y+b.h/2));
                const totalH=sorted.reduce((a,q)=>a+q.h,0);
                const span=Math.max(...sorted.map(q=>q.y+q.h))-Math.min(...sorted.map(q=>q.y));
                const gap=(span-totalH)/(sorted.length-1);
                let cy2=Math.min(...sorted.map(q=>q.y));
                const posMap={};
                for(const q of sorted){posMap[q.id]=cy2;cy2+=q.h+gap;}
                return {...s,y:posMap[s.id]??s.y};
              }
              return s;
            }));
          };
          const btnStyle={padding:"5px 10px",borderRadius:7,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",whiteSpace:"nowrap"};
          return (
            <div style={{position:"absolute",top:70,left:"50%",transform:"translateX(-50%)",zIndex:300,
              display:"flex",flexWrap:"wrap",gap:4,padding:"5px 8px",borderRadius:10,background:"rgba(255,255,255,.95)",
              border:"1px solid #e2e8f0",boxShadow:"0 2px 12px rgba(0,0,0,.08)",maxWidth:"calc(100% - 24px)",justifyContent:"center"}}>
              {[["left","Esq ←"],["right","Dir →"],["top","Topo ↑"],["bottom","Base ↓"],["centerH","Centro ↔"],["centerV","Centro ↕"],["distH","Dist. H"],["distV","Dist. V"]].map(([d,l])=>(
                <button key={d} style={btnStyle} onClick={()=>applyAlign(d)}>{l}</button>
              ))}
            </div>
          );
        })()}

        {/* Cineminha toolbar — shows when a single cineminha is selected */}
        {selShape?.type==='cineminha'&&multiSel.size<=1&&(()=>{
          const selCfg = getCinemaType(selShape.cinemaType);
          return (
            <div style={{position:"absolute",top:70,left:"50%",transform:"translateX(-50%)",zIndex:300,
              display:"flex",gap:4,padding:"5px 8px",borderRadius:10,background:"rgba(255,255,255,.95)",
              border:"1px solid #e2e8f0",boxShadow:"0 2px 12px rgba(0,0,0,.08)",alignItems:"center"}}>
              {/* Type selector */}
              <div style={{display:"flex",gap:2,marginRight:4,paddingRight:8,borderRight:"1px solid #e2e8f0"}}>
                {Object.values(CINEMINHA_TYPES).map(t=>{
                  const active = (selShape.cinemaType ?? 'eligibility') === t.id;
                  return (
                    <button key={t.id} onClick={()=>changeCinemaType(sel,t.id)}
                      title={t.desc}
                      style={{padding:"4px 10px",borderRadius:6,fontFamily:"inherit",fontSize:11,fontWeight:600,cursor:"pointer",
                        whiteSpace:"nowrap",transition:"all .12s",
                        border: active ? `1.5px solid ${t.badgeFg}` : "1.5px solid #e2e8f0",
                        background: active ? t.badgeBg : "#fff",
                        color: active ? t.badgeFg : "#94a3b8"}}>
                      {t.icon} {t.label}
                    </button>
                  );
                })}
              </div>
              <button onClick={()=>setResultVarModal({shapeId:sel})}
                title="Configurar qual coluna do CSV define o valor de cada casela"
                style={{padding:"5px 14px",borderRadius:7,
                  border:`1.5px solid ${selShape.resultVar ? selCfg.badgeFg : "#e2e8f0"}`,
                  background:selShape.resultVar ? selCfg.badgeBg : "#fff",
                  color:selShape.resultVar ? selCfg.badgeFg : "#64748b",
                  cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                  whiteSpace:"nowrap",fontWeight:selShape.resultVar ? 700 : 500}}>
                {selShape.resultVar ? `⊞ ${trunc(selShape.resultVar.col,10)}` : "⊞ Resultado"}
              </button>
              <button onClick={()=>openOptimModal(sel)}
                style={{padding:"5px 14px",borderRadius:7,border:`1px solid ${selCfg.badgeBg}`,background:selCfg.badgeBg,
                  color:selCfg.badgeFg,cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                  whiteSpace:"nowrap",fontWeight:600}}>
                ⚙ Otimizar Decisão
              </button>
              <button onClick={()=>exportCinema(sel)}
                style={{padding:"5px 14px",borderRadius:7,border:"1px solid #bbf7d0",background:"#f0fdf4",
                  color:"#16a34a",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                  whiteSpace:"nowrap",fontWeight:600}}>
                ⬇ Exportar
              </button>
              <button onClick={()=>startCinemaImport(sel)}
                style={{padding:"5px 14px",borderRadius:7,border:"1px solid #fed7aa",background:"#fff7ed",
                  color:"#ea580c",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                  whiteSpace:"nowrap",fontWeight:600}}>
                ⬆ Importar
              </button>
              <div style={{width:1,height:22,background:"#e2e8f0",margin:"0 2px"}}/>
              <button onClick={()=>openCinemaLibrary(sel,'browse')}
                style={{padding:"5px 14px",borderRadius:7,border:"1px solid #c7d2fe",background:"#eef2ff",
                  color:"#4f46e5",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                  whiteSpace:"nowrap",fontWeight:600}}>
                📚 Biblioteca
              </button>
              <button onClick={()=>openCinemaLibrary(sel,'save')}
                style={{padding:"5px 14px",borderRadius:7,border:"1px solid #bbf7d0",background:"#f0fdf4",
                  color:"#15803d",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                  whiteSpace:"nowrap",fontWeight:600}}>
                💾 Salvar
              </button>
            </div>
          );
        })()}

        {/* Decision Lens toolbar — shows when a single decision_lens is selected */}
        {selShape?.type==='decision_lens'&&multiSel.size<=1&&(
          <div style={{position:"absolute",top:70,left:"50%",transform:"translateX(-50%)",zIndex:300,
            display:"flex",gap:4,padding:"5px 8px",borderRadius:10,background:"rgba(255,255,255,.95)",
            border:"1px solid #e2e8f0",boxShadow:"0 2px 12px rgba(0,0,0,.08)"}}>
            <button onClick={()=>openLensModal(sel)}
              style={{padding:"5px 14px",borderRadius:7,border:"1px solid #a5f3fc",background:"#ecfeff",
                color:"#0891b2",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                whiteSpace:"nowrap",fontWeight:600}}>
              🔎 Configurar
            </button>
          </div>
        )}

        {/* Color palette */}
        {palette&&selShape&&(
          <div style={{position:"absolute",top:70,left:"50%",transform:"translateX(-50%)",zIndex:400,
            display:"flex",gap:6,padding:"10px 14px",background:"#fff",border:"1px solid #e2e8f0",
            borderRadius:12,boxShadow:"0 8px 24px rgba(0,0,0,.1)"}}>
            {COLORS.map(c=>(
              <div key={c} onClick={()=>{pushHistory();setShapes(p=>p.map(s=>s.id===sel?{...s,color:c}:s));setPalette(false);}}
                style={{width:26,height:26,borderRadius:7,background:c,cursor:"pointer",transition:"transform .12s",
                  border:selShape.color===c?"2.5px solid #3b82f6":"1.5px solid #e2e8f0"}}/>
            ))}
          </div>
        )}

        {/* Zoom controls */}
        <div style={{position:"absolute",bottom:16,right:16,zIndex:200,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
          {[["+",()=>zoomCenter(1.2)],["−",()=>zoomCenter(1/1.2)],["⌂",()=>setVp({x:20,y:40,s:1})]].map(([icon,fn])=>(
            <button key={icon} className="wbz" onClick={fn} style={{width:36,height:36,borderRadius:10,border:"1px solid #e2e8f0",background:"#fff",boxShadow:"0 1px 4px rgba(0,0,0,.08)",color:"#64748b",cursor:"pointer",fontSize:17,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit",transition:"all .15s"}}>{icon}</button>
          ))}
          <div style={{color:"#94a3b8",fontSize:10,fontFamily:"inherit",marginTop:1}}>{Math.round(vp.s*100)}%</div>
        </div>

        {/* Floating hint */}
        {(fromId||hint)&&(
          <div style={{position:"absolute",bottom:16,left:"50%",transform:"translateX(-50%)",zIndex:200,padding:"8px 18px",borderRadius:10,background:fromId?"#fffbeb":"#eff6ff",border:fromId?"1px solid #fde68a":"1px solid #bfdbfe",color:fromId?"#92400e":"#1d4ed8",fontSize:12.5,fontFamily:"inherit",whiteSpace:"nowrap",boxShadow:"0 2px 8px rgba(0,0,0,.08)"}}>
            {fromId?"⟶ Clique em outro elemento para conectar · Esc cancela":hint}
          </div>
        )}

        {/* Tips */}
        <div style={{position:"absolute",bottom:16,left:16,zIndex:100,background:"#fff",border:"1px solid #e2e8f0",boxShadow:"0 1px 4px rgba(0,0,0,.06)",color:"#94a3b8",padding:"7px 11px",borderRadius:10,fontSize:10.5,fontFamily:"inherit",lineHeight:1.9}}>
          <span style={{color:"#64748b",fontWeight:600}}>Dicas</span><br/>
          ✋ Mover · ↖ Selecionar e arrastar<br/>
          📱 Pinça → zoom · Segurar → editar<br/>
          Clique na seta → deletar conexão
        </div>

        {/* SVG Canvas */}
        <svg ref={svgRef} width="100%" height="100%" onMouseDown={onCanvasDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onClick={onCanvasClick} style={{display:"block",cursor:canvasCursor,touchAction:"none"}}>
          <defs>
            <pattern id="pg" width={28*vp.s} height={28*vp.s} patternUnits="userSpaceOnUse" x={vp.x%(28*vp.s)} y={vp.y%(28*vp.s)}>
              <circle cx={14*vp.s} cy={14*vp.s} r={1} fill="#c8d3de"/>
            </pattern>
            <marker id="arr" markerWidth="7" markerHeight="7" refX="6.5" refY="3.5" orient="auto">
              <polygon points="0 0.8,6.5 3.5,0 6.2" fill="#3b82f6"/>
            </marker>
          </defs>
          <rect width="100%" height="100%" fill="url(#pg)"/>
          <g transform={`translate(${vp.x},${vp.y}) scale(${vp.s})`}>
            {/* Frames render below everything else */}
            {shapes.filter(s=>s.type==="frame").map(renderFrame)}
            {conns.map(renderConn)}
            {shapes.map(renderShape)}
            {/* Selection rectangle */}
            {selRect&&(()=>{
              const rx=Math.min(selRect.x1,selRect.x2), ry=Math.min(selRect.y1,selRect.y2);
              const rw=Math.abs(selRect.x2-selRect.x1), rh=Math.abs(selRect.y2-selRect.y1);
              return <rect x={rx} y={ry} width={rw} height={rh} rx={4}
                fill="rgba(59,130,246,0.08)" stroke="#3b82f6" strokeWidth={1.5}
                strokeDasharray="5 3" style={{pointerEvents:"none"}}/>;
            })()}
          </g>
        </svg>

        {/* Inline label editor — shapes */}
        {edit&&editShape&&(()=>{
          const ex=editShape.x*vp.s+vp.x,ey=editShape.y*vp.s+vp.y,ew=editShape.w*vp.s,eh=editShape.h*vp.s;
          const isCinema = editShape.type==="cineminha";
          const iTop = isCinema ? ey + CINEMA_TITLE_H*vp.s/2 : ey+eh/2;
          const iLeft = isCinema ? ex + ew/2 - (ew*0.5)/2 : ex+ew/2;
          const iW = isCinema ? ew*0.5 : ew*0.8;
          const iBg = isCinema ? "rgba(99,102,241,0.9)" : "transparent";
          const iColor = isCinema ? "#fff" : "#1e293b";
          return <input autoFocus value={edit.val} onChange={e=>setEdit(p=>({...p,val:e.target.value}))} onBlur={commitEdit} onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape")commitEdit();}} style={{position:"absolute",left:iLeft,top:iTop,transform:"translate(-50%,-50%)",width:iW,background:iBg,border:"none",outline:"none",textAlign:"center",fontSize:Math.max(11,12*vp.s),fontFamily:"'DM Sans',system-ui,sans-serif",fontWeight:isCinema?700:500,color:iColor,zIndex:500,borderRadius:isCinema?6:0,padding:isCinema?"2px 6px":0}}/>;
        })()}
        {/* Tooltip */}
        {tooltip&&(
          <div style={{position:"fixed",left:tooltip.x+12,top:tooltip.y-4,zIndex:3000,pointerEvents:"none",
            background:"#fff",border:"1px solid #e2e8f0",borderRadius:8,padding:"6px 10px",
            fontSize:11.5,fontFamily:"'DM Sans',system-ui,sans-serif",maxWidth:240,
            boxShadow:"0 4px 16px rgba(0,0,0,.12)",color:"#1e293b"}}>
            {tooltip.lines.filter(Boolean).map((l,i)=>(
              <div key={i} style={{fontWeight:i===0?700:400,color:i===0?"#1e293b":"#64748b"}}>{l}</div>
            ))}
          </div>
        )}

        {/* ═══════════════ BUSINESS IMPACT FLOATING WIDGET ═══════════════ */}
        {businessWidget.visible && (() => {
          const { x: bwX, y: bwY, w: bwW, h: bwH } = businessWidget;
          const BASE_W = 420;
          const sf = Math.max(0.55, Math.min(2.5, bwW / BASE_W));
          const small = bwW < 380;
          const large = bwW >= 620;

          const inc = incrementalResult;
          const hasInc = !!inc;
          const displayResult = hasInc ? inc.simulated : simResult;
          const hasData = displayResult.totalQty > 0;
          const rate = hasData ? displayResult.approvalRate : null;
          const irV = displayResult.inadReal;
          const iiV = displayResult.inadInferida;
          const rateColor = rate === null ? "#94a3b8" : rate >= 70 ? "#22c55e" : rate >= 40 ? "#f59e0b" : "#ef4444";
          const inadColor = (v) => v === null ? "#64748b" : v > 0.05 ? "#ef4444" : v > 0.02 ? "#f59e0b" : "#22c55e";
          const deltaClr = (d, ph = true) => d === null || isNaN(d) ? "#64748b" : ph ? (d > 0 ? "#4ade80" : d < 0 ? "#f87171" : "#64748b") : (d < 0 ? "#4ade80" : d > 0 ? "#f87171" : "#64748b");
          const fmtD = (d, scale = 100) => d === null || isNaN(d) ? null : `${d >= 0 ? '+' : '−'}${Math.abs(d * scale).toFixed(2)} p.p`;
          const rateDelta = hasInc && inc.baseline.totalQty > 0 ? inc.simulated.approvalRate - inc.baseline.approvalRate : null;
          const irDelta = hasInc && irV !== null && inc.baseline.inadReal !== null ? irV - inc.baseline.inadReal : null;
          const iiDelta = hasInc && iiV !== null && inc.baseline.inadInferida !== null ? iiV - inc.baseline.inadInferida : null;
          const heroVal = hasInc && rateDelta !== null ? (fmtD(rateDelta / 100) ?? '—') : (rate !== null ? `${rate.toFixed(1)}%` : '—');
          const heroLabel = hasInc && rateDelta !== null ? 'VARIAÇÃO NA APROVAÇÃO' : 'TAXA DE APROVAÇÃO';
          const heroColor = hasInc && rateDelta !== null ? deltaClr(rateDelta, true) : rateColor;
          const heroIsGood = hasInc && rateDelta !== null ? rateDelta > 0 : rate !== null && rate >= 50;
          const balance = !hasData ? 0.5 : (() => {
            const a = Math.min(1, (rate ?? 50) / 100);
            const i = irV !== null ? Math.max(0, 1 - irV / 0.12) : 0.5;
            return a * 0.6 + i * 0.4;
          })();
          const balColor = balance > 0.6 ? "#22c55e" : balance < 0.4 ? "#ef4444" : "#f59e0b";
          const balLabel = balance > 0.65 ? "Perfil expansivo" : balance < 0.35 ? "Perfil conservador" : "Perfil balanceado";

          const badges = [];
          if (hasInc && rateDelta !== null) {
            const txt = fmtD(rateDelta / 100);
            if (txt) badges.push({ text: `Δ Aprov. ${txt}`, bg: rateDelta > 0 ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)', color: rateDelta > 0 ? '#4ade80' : '#f87171' });
          }
          if (hasData && irV !== null) {
            const rl = irV > 0.05 ? 'Alto Risco' : irV > 0.02 ? 'Risco Moderado' : 'Baixo Risco';
            const rlColor = irV > 0.05 ? '#f87171' : irV > 0.02 ? '#fbbf24' : '#4ade80';
            badges.push({ text: rl, bg: rlColor + '22', color: rlColor });
          }

          const s = (v) => v * sf;
          const MCard = ({ label, value, delta, ph = true, sub, valColor }) => (
            <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: s(9), padding: `${s(8)}px ${s(10)}px`, flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: s(9), color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: s(3) }}>{label}</div>
              <div style={{ fontSize: s(17), fontWeight: 800, color: valColor || '#e2e8f0', lineHeight: 1 }}>{value}</div>
              {delta !== null && delta !== undefined && <div style={{ fontSize: s(9.5), fontWeight: 700, color: deltaClr(delta, ph), marginTop: s(3) }}>{fmtD(delta)}</div>}
              {sub && !small && <div style={{ fontSize: s(8), color: '#475569', marginTop: s(2) }}>{sub}</div>}
            </div>
          );

          // Resize handle cursor map
          const resCur = { n:'n-resize', s:'s-resize', e:'e-resize', w:'w-resize', ne:'ne-resize', nw:'nw-resize', se:'se-resize', sw:'sw-resize' };
          const ResHandle = ({ dir, style: sty }) => (
            <div onMouseDown={ev => startBwDrag(ev, 'resize', dir)} style={{ position: 'absolute', zIndex: 10, cursor: resCur[dir], ...sty }}/>
          );
          const HANDLE = 8;

          return (
            <div key="bw" style={{
              position: 'absolute', left: bwX, top: bwY, width: bwW, height: bwH,
              zIndex: 600, display: 'flex', flexDirection: 'column',
              fontFamily: "'DM Sans',system-ui,sans-serif",
              background: 'linear-gradient(160deg, #0f172a 0%, #1a1040 100%)',
              borderRadius: s(16),
              boxShadow: '0 8px 40px rgba(0,0,0,0.55), 0 2px 8px rgba(99,102,241,0.15), inset 0 1px 0 rgba(255,255,255,0.07)',
              border: '1.5px solid rgba(129,140,248,0.25)',
              overflow: 'hidden',
              transition: 'box-shadow 0.15s',
              userSelect: 'none',
            }}>
              {/* Resize handles */}
              <ResHandle dir="n"  style={{ top: 0, left: HANDLE, right: HANDLE, height: HANDLE }} />
              <ResHandle dir="s"  style={{ bottom: 0, left: HANDLE, right: HANDLE, height: HANDLE }} />
              <ResHandle dir="w"  style={{ left: 0, top: HANDLE, bottom: HANDLE, width: HANDLE }} />
              <ResHandle dir="e"  style={{ right: 0, top: HANDLE, bottom: HANDLE, width: HANDLE }} />
              <ResHandle dir="nw" style={{ top: 0, left: 0, width: HANDLE*2, height: HANDLE*2 }} />
              <ResHandle dir="ne" style={{ top: 0, right: 0, width: HANDLE*2, height: HANDLE*2 }} />
              <ResHandle dir="sw" style={{ bottom: 0, left: 0, width: HANDLE*2, height: HANDLE*2 }} />
              <ResHandle dir="se" style={{ bottom: 0, right: 0, width: HANDLE*2, height: HANDLE*2 }} />

              {/* Drag header */}
              <div onMouseDown={ev => startBwDrag(ev, 'move')}
                style={{ padding: `${s(11)}px ${s(14)}px ${s(9)}px`, borderBottom: '1px solid rgba(255,255,255,0.07)', cursor: 'grab', flexShrink: 0, position: 'relative', zIndex: 5 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: badges.length && !small ? s(7) : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: s(7) }}>
                    <span style={{ fontSize: s(10), fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.1em' }}>⬡ Business Impact</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: s(8) }}>
                    {hasData && <span style={{ fontSize: s(9), color: '#334155', fontWeight: 500 }}>{fmtQty(displayResult.totalQty)} reg.</span>}
                    <button onMouseDown={ev => ev.stopPropagation()} onClick={() => setBusinessWidget(p => ({ ...p, visible: false }))}
                      style={{ width: s(20), height: s(20), borderRadius: '50%', border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#64748b', cursor: 'pointer', fontSize: s(11), lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, fontFamily: 'inherit', transition: 'all .12s', flexShrink: 0 }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.2)'; e.currentTarget.style.color = '#f87171'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#64748b'; }}>
                      ✕
                    </button>
                  </div>
                </div>
                {badges.length > 0 && !small && (
                  <div style={{ display: 'flex', gap: s(4), flexWrap: 'wrap' }}>
                    {badges.map((b, i) => (
                      <span key={i} style={{ fontSize: s(8.5), fontWeight: 700, padding: `${s(2)}px ${s(8)}px`, borderRadius: s(20), background: b.bg, color: b.color, letterSpacing: '0.03em' }}>{b.text}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Scrollable content */}
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }} onMouseDown={ev => ev.stopPropagation()}>

                {/* Hero KPI */}
                <div style={{ padding: `${s(16)}px ${s(14)}px ${s(12)}px`, textAlign: 'center', position: 'relative', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
                  {heroIsGood && hasData && (
                    <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at 50% 0%, ${heroColor}20 0%, transparent 70%)`, pointerEvents: 'none' }} />
                  )}
                  <div style={{ fontSize: s(42), fontWeight: 900, color: hasData ? heroColor : '#1e293b', lineHeight: 1, letterSpacing: '-0.02em' }}>
                    {heroVal}
                  </div>
                  <div style={{ fontSize: s(9.5), color: '#475569', fontWeight: 700, letterSpacing: '0.1em', marginTop: s(5), textTransform: 'uppercase' }}>{heroLabel}</div>
                  {hasInc && inc.baseline.totalQty > 0 && !small && (
                    <div style={{ fontSize: s(9), color: '#334155', marginTop: s(5) }}>
                      {inc.baseline.approvalRate.toFixed(1)}% → {(displayResult.approvalRate ?? 0).toFixed(1)}%
                    </div>
                  )}
                </div>

                {/* Approval bar */}
                {hasData && (
                  <div style={{ padding: `${s(7)}px ${s(13)}px 0`, flexShrink: 0 }}>
                    <div style={{ height: s(4), borderRadius: s(2), background: 'rgba(255,255,255,0.06)', overflow: 'hidden', position: 'relative' }}>
                      <div style={{ height: '100%', width: `${rate ?? 0}%`, borderRadius: s(2), background: `linear-gradient(90deg, ${rateColor}99, ${rateColor})`, transition: 'width 0.4s ease' }} />
                      {hasInc && inc.baseline.totalQty > 0 && (
                        <div style={{ position: 'absolute', top: 0, height: '100%', left: `${inc.baseline.approvalRate}%`, width: 2, background: 'rgba(255,255,255,0.35)', borderRadius: 1 }} />
                      )}
                    </div>
                  </div>
                )}

                {/* Metric grid */}
                {!small && (
                  <div style={{ padding: `${s(9)}px ${s(11)}px ${s(9)}px`, display: 'flex', flexDirection: 'column', gap: s(6) }}>
                    <div style={{ display: 'flex', gap: s(6) }}>
                      <MCard label="Aprovação" value={rate !== null ? `${rate.toFixed(1)}%` : '—'} delta={rateDelta !== null ? rateDelta / 100 : null} ph={true} sub={hasData ? `✓ ${fmtQty(displayResult.approvedQty)} · ✗ ${fmtQty(displayResult.rejectedQty)}${simResult.asIsQty>0?` · ⟳${fmtQty(simResult.asIsQty)}`:""}` : null} valColor={rateColor} />
                      <MCard label="Inad. Real" value={irV !== null ? fmtPct(irV) : '—'} delta={irDelta} ph={false} sub="∑ Inad / ∑ Altas" valColor={inadColor(irV)} />
                    </div>
                    <div style={{ display: 'flex', gap: s(6) }}>
                      <MCard label="Inad. Inferida" value={iiV !== null ? fmtPct(iiV) : '—'} delta={iiDelta} ph={false} sub="∑ Inad.I / Aprov." valColor={inadColor(iiV)} />
                      <MCard label="Vol. Aprovado" value={hasData ? fmtQty(displayResult.approvedQty) : '—'} delta={null} ph={true} sub={hasData ? `${(rate ?? 0).toFixed(1)}% da base` : null} valColor="#e2e8f0" />
                    </div>
                  </div>
                )}

                {/* Risk/Growth balance bar */}
                {!small && (
                  <div style={{ padding: `${s(7)}px ${s(13)}px ${s(11)}px`, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: s(5) }}>
                      <span style={{ fontSize: s(8), color: '#ef4444', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>◄ Risco</span>
                      <span style={{ fontSize: s(8), color: '#334155', fontWeight: 600 }}>Equilíbrio Estratégico</span>
                      <span style={{ fontSize: s(8), color: '#22c55e', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Crescimento ►</span>
                    </div>
                    <div style={{ position: 'relative', height: s(8), borderRadius: s(4), background: 'linear-gradient(90deg, #7f1d1d44, #1e293b 42%, #1e293b 58%, #14532d44)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ position: 'absolute', top: '50%', left: `${Math.round(balance * 100)}%`, transform: 'translate(-50%, -50%)', width: s(14), height: s(14), borderRadius: '50%', background: hasData ? balColor : '#1e293b', border: '2px solid rgba(255,255,255,0.25)', boxShadow: hasData ? `0 0 ${s(10)}px ${balColor}66` : 'none', transition: 'left 0.4s ease' }} />
                    </div>
                    {hasData && <div style={{ textAlign: 'center', marginTop: s(5), fontSize: s(8.5), color: balColor, fontWeight: 600 }}>{balLabel}</div>}
                  </div>
                )}

                {/* Large mode extras */}
                {large && hasData && (
                  <div style={{ padding: `${s(8)}px ${s(13)}px ${s(12)}px`, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontSize: s(9), color: '#a78bfa', fontWeight: 800, marginBottom: s(8), textTransform: 'uppercase', letterSpacing: '0.08em' }}>⚡ Análise de Portfolio</div>
                    <div style={{ display: 'grid', gridTemplateColumns: simResult.asIsQty > 0 ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: s(6) }}>
                      {[
                        { label: 'Total Base', val: fmtQty(displayResult.totalQty), color: '#94a3b8' },
                        { label: 'Aprovados', val: fmtQty(displayResult.approvedQty), color: '#4ade80' },
                        { label: 'Reprovados', val: fmtQty(displayResult.rejectedQty), color: '#f87171' },
                        ...(simResult.asIsQty > 0 ? [{ label: 'AS IS', val: fmtQty(simResult.asIsQty), color: '#9ca3af' }] : []),
                      ].map((item, i) => (
                        <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: s(8), padding: `${s(8)}px ${s(10)}px`, textAlign: 'center' }}>
                          <div style={{ fontSize: s(8), color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: s(3) }}>{item.label}</div>
                          <div style={{ fontSize: s(18), fontWeight: 800, color: item.color }}>{item.val}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Exportar Diagnóstico */}
                {hasData && (
                  <div style={{ padding: `${s(6)}px ${s(11)}px ${s(8)}px`, borderTop: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
                    <button
                      onClick={() => exportDiagnosticCSV(shapes, conns, csvStore)}
                      style={{ width: '100%', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: s(8), padding: `${s(6)}px ${s(10)}px`, cursor: 'pointer', color: '#818cf8', fontSize: s(10), fontWeight: 700, fontFamily: "'DM Sans',system-ui,sans-serif", letterSpacing: '0.04em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: s(6) }}
                    >
                      <span style={{ fontSize: s(12) }}>⬇</span> Exportar Diagnóstico (.csv)
                    </button>
                  </div>
                )}

                {/* Efeito da Mudança */}
                {hasInc && inc.impacted.qty > 0 && (
                  <div style={{ padding: `${s(9)}px ${s(11)}px ${s(12)}px`, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: s(9), color: '#a78bfa', fontWeight: 800, marginBottom: s(7), textTransform: 'uppercase', letterSpacing: '0.08em' }}>⚡ Efeito da Mudança</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: s(6) }}>
                      <div style={{ background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: s(8), padding: `${s(6)}px ${s(10)}px`, textAlign: 'center' }}>
                        <div style={{ fontSize: s(7.5), color: '#4ade80', fontWeight: 700, marginBottom: s(2), textTransform: 'uppercase', letterSpacing: '0.05em' }}>Novos Aprovados</div>
                        <div style={{ fontSize: s(15), fontWeight: 800, color: '#4ade80' }}>+{fmtQty(inc.impacted.rToA)}</div>
                      </div>
                      <div style={{ background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: s(8), padding: `${s(6)}px ${s(10)}px`, textAlign: 'center' }}>
                        <div style={{ fontSize: s(7.5), color: '#f87171', fontWeight: 700, marginBottom: s(2), textTransform: 'uppercase', letterSpacing: '0.05em' }}>Novos Reprovados</div>
                        <div style={{ fontSize: s(15), fontWeight: 800, color: '#f87171' }}>−{fmtQty(inc.impacted.aToR)}</div>
                      </div>
                    </div>
                    {!small && (
                      <div style={{ marginTop: s(7), textAlign: 'center', fontSize: s(8.5), color: '#475569' }}>
                        {fmtQty(inc.impacted.qty)} registros impactados · {inc.impacted.pct.toFixed(1)}% da base
                      </div>
                    )}
                  </div>
                )}

              </div>
            </div>
          );
        })()}

        {/* Inline label editor — connections */}
        {editConn&&(()=>{
          const conn=conns.find(c=>c.id===editConn.id);
          if(!conn) return null;
          const from=shapes.find(s=>s.id===conn.from),to=shapes.find(s=>s.id===conn.to);
          if(!from||!to) return null;
          const [fx,fy]=ctr(from),[tx,ty]=ctr(to);
          const mx=(fx+tx)/2*vp.s+vp.x, my=(fy+ty)/2*vp.s+vp.y;
          return <input autoFocus value={editConn.val}
            onChange={e=>setEditConn(p=>({...p,val:e.target.value}))}
            onBlur={()=>{pushHistory();setConns(p=>p.map(c=>c.id===editConn.id?{...c,label:editConn.val}:c));setEditConn(null);}}
            onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape"){pushHistory();setConns(p=>p.map(c=>c.id===editConn.id?{...c,label:editConn.val}:c));setEditConn(null);}}}
            style={{position:"absolute",left:mx,top:my,transform:"translate(-50%,-50%)",
              width:90,background:"#fff",border:"1.5px solid #3b82f6",borderRadius:6,
              outline:"none",textAlign:"center",fontSize:11,
              fontFamily:"'DM Sans',system-ui,sans-serif",color:"#475569",padding:"3px 8px",zIndex:500}}/>;
        })()}

        {/* ═══ Edge hover card (above all SVG content) ═══ */}
        {hoveredConn&&hoveredConnPos&&(()=>{
          const conn=conns.find(c=>c.id===hoveredConn);
          const es=conn&&simResult.edgeStats?.[conn.id];
          if(!es) return null;
          return (
            <div style={{position:"fixed",left:hoveredConnPos.x,top:hoveredConnPos.y,zIndex:4000,pointerEvents:"none",
              background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:"10px 14px",
              boxShadow:"0 8px 28px rgba(0,0,0,.14)",fontSize:12,
              fontFamily:"'DM Sans',system-ui,sans-serif",color:"#1e293b",lineHeight:1.8,minWidth:190,whiteSpace:"nowrap"}}>
              <div style={{fontWeight:700,fontSize:12.5,color:"#1e293b",marginBottom:4,borderBottom:"1px solid #f1f5f9",paddingBottom:4}}>📊 Estatísticas da Aresta</div>
              <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"1px 10px"}}>
                <span style={{color:"#94a3b8",fontSize:11}}>Vol. Propostas</span><span style={{fontWeight:600}}>{fmtQty(es.qty)}</span>
                <span style={{color:"#94a3b8",fontSize:11}}>Vol. Aprovado</span><span style={{fontWeight:600,color:"#16a34a"}}>{fmtQty(es.approvedQty)}</span>
                <span style={{color:"#94a3b8",fontSize:11}}>Vol. Reprovado</span><span style={{fontWeight:600,color:"#dc2626"}}>{fmtQty(es.rejectedQty)}</span>
                {es.asIsQty>0&&<><span style={{color:"#94a3b8",fontSize:11}}>Vol. AS IS</span><span style={{fontWeight:600,color:"#9ca3af"}}>{fmtQty(es.asIsQty)}</span></>}
                <span style={{color:"#94a3b8",fontSize:11}}>Taxa de Aprovação</span><span style={{fontWeight:700,color:es.approvalRate>=70?"#16a34a":es.approvalRate>=40?"#d97706":"#dc2626"}}>{fmtPct(es.approvalRate)}</span>
                <span style={{color:"#94a3b8",fontSize:11}}>Inad. Real</span><span style={{fontWeight:600,color:es.inadReal===null?"#94a3b8":es.inadReal>0.05?"#dc2626":"#d97706"}}>{fmtPct(es.inadReal)}</span>
                <span style={{color:"#94a3b8",fontSize:11}}>Inad. Inferida</span><span style={{fontWeight:600,color:es.inadInferida===null?"#94a3b8":es.inadInferida>0.05?"#dc2626":"#d97706"}}>{fmtPct(es.inadInferida)}</span>
                <span style={{color:"#94a3b8",fontSize:11}}>Qtd Altas/Vendas</span><span style={{fontWeight:600}}>{fmtQty(es.qtdAltas)}</span>
                {simResult.totalQty>0&&<><span style={{color:"#94a3b8",fontSize:11}}>Part. no fluxo</span><span style={{fontWeight:600}}>{((es.qty/simResult.totalQty)*100).toFixed(1)}%</span></>}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ═══════════════ RIGHT PANEL ═══════════════ */}
      <div style={{width:272,flexShrink:0,background:"#fff",borderLeft:"1px solid #e2e8f0",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {/* Header — fixed */}
        <div style={{padding:"12px 14px 10px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:"#3b82f6",boxShadow:"0 0 0 3px #dbeafe",flexShrink:0}}/>
          <span style={{fontSize:13,fontWeight:600,color:"#1e293b",letterSpacing:.1,flex:1}}>Painel</span>
          <BuildBadge />
        </div>

        {/* Scrollable content area */}
        <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>

        {/* Importar CSV button */}
        <div style={{padding:"14px 16px",borderBottom:"1px solid #f1f5f9"}}>
          <p style={{fontSize:11,color:"#94a3b8",marginBottom:10,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Dados</p>
          <button onClick={()=>fileInputRef.current?.click()}
            style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px 14px",borderRadius:10,border:"1.5px dashed #cbd5e1",background:"#fafafa",color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit",transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="#3b82f6";e.currentTarget.style.color="#2563eb";e.currentTarget.style.background="#eff6ff";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="#cbd5e1";e.currentTarget.style.color="#475569";e.currentTarget.style.background="#fafafa";}}>
            <span style={{fontSize:18}}>📂</span> Importar CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={onFileChange}/>
        </div>

        {/* Exportar / Importar Fluxo */}
        <div style={{padding:"14px 16px",borderBottom:"1px solid #f1f5f9"}}>
          <p style={{fontSize:11,color:"#94a3b8",marginBottom:10,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Fluxo</p>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <button onClick={exportFlow}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"9px 14px",borderRadius:10,border:"1.5px solid #a5b4fc",background:"#eef2ff",color:"#4f46e5",cursor:"pointer",fontSize:12.5,fontWeight:500,fontFamily:"inherit",transition:"all .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.background="#e0e7ff";e.currentTarget.style.borderColor="#818cf8";}}
              onMouseLeave={e=>{e.currentTarget.style.background="#eef2ff";e.currentTarget.style.borderColor="#a5b4fc";}}>
              <span style={{fontSize:16}}>⬇</span> Exportar Fluxo
            </button>
            <button onClick={()=>flowImportRef.current?.click()}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"9px 14px",borderRadius:10,border:"1.5px dashed #a5b4fc",background:"#fafafa",color:"#4f46e5",cursor:"pointer",fontSize:12.5,fontWeight:500,fontFamily:"inherit",transition:"all .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="#6366f1";e.currentTarget.style.background="#eef2ff";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="#a5b4fc";e.currentTarget.style.background="#fafafa";}}>
              <span style={{fontSize:16}}>⬆</span> Importar Fluxo
            </button>
            <input ref={flowImportRef} type="file" accept=".json,application/json" style={{display:"none"}} onChange={onFlowFileChange}/>
            <input ref={cinemaImportRef} type="file" accept=".json,application/json" style={{display:"none"}} onChange={onCinemaFileChange}/>
            <input ref={libFileInputRef} type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={onLibFileChange}/>
          </div>
          {importWarn&&(
            <div style={{marginTop:8,padding:"8px 10px",borderRadius:8,background:"#fffbeb",border:"1px solid #fde68a",fontSize:11,color:"#92400e",lineHeight:1.5,display:"flex",gap:6,alignItems:"flex-start"}}>
              <span style={{flexShrink:0}}>⚠</span>
              <span>{importWarn}</span>
            </div>
          )}
        </div>

        {/* Loaded CSVs list */}
        {Object.keys(csvStore).length > 0 && (
          <div style={{padding:"12px 16px",borderBottom:"1px solid #f1f5f9"}}>
            <p style={{fontSize:11,color:"#94a3b8",marginBottom:8,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Arquivos carregados</p>
            {Object.entries(csvStore).map(([cid,csv])=>(
              <div key={cid} style={{display:"flex",alignItems:"center",gap:6,padding:"6px 8px",borderRadius:8,background:"#f8fafc",marginBottom:4}}>
                <span>📊</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:500,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{csv.name}</div>
                  <div style={{fontSize:10.5,color:"#94a3b8"}}>{csv.rows.length} linhas · {csv.headers.length} colunas</div>
                </div>
                <button
                  title="Editar configurações do dataset"
                  onClick={()=>onEditDataset(cid)}
                  style={{width:22,height:22,borderRadius:6,border:"1px solid #bfdbfe",background:"#eff6ff",color:"#2563eb",cursor:"pointer",fontSize:11,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,lineHeight:1,padding:0,transition:"all .12s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="#dbeafe";e.currentTarget.style.borderColor="#93c5fd";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="#eff6ff";e.currentTarget.style.borderColor="#bfdbfe";}}>
                  ✏️
                </button>
                <button
                  title="Remover dataset"
                  onClick={()=>deleteCsvDataset(cid)}
                  style={{width:22,height:22,borderRadius:6,border:"1px solid #fecaca",background:"#fff1f2",color:"#e11d48",cursor:"pointer",fontSize:13,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,lineHeight:1,padding:0,transition:"all .12s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="#fee2e2";e.currentTarget.style.borderColor="#fca5a5";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="#fff1f2";e.currentTarget.style.borderColor="#fecaca";}}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Decision Variables */}
        {decisionVars.length > 0 && (
          <div style={{padding:"12px 16px",borderBottom:"1px solid #f1f5f9"}}>
            <p style={{fontSize:11,color:"#94a3b8",marginBottom:8,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Variáveis de Decisão</p>
            <p style={{fontSize:10.5,color:"#cbd5e1",marginBottom:8,lineHeight:1.5}}>Arraste para o canvas → losango, ou sobre um ⊞ Cineminha → matriz cruzada</p>
            {/* Search box */}
            <div style={{position:"relative",marginBottom:8}}>
              <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",fontSize:13,pointerEvents:"none",color:"#94a3b8"}}>🔍</span>
              <input
                type="text"
                value={varSearch}
                onChange={e=>setVarSearch(e.target.value)}
                placeholder="Buscar variável..."
                style={{width:"100%",padding:"6px 10px 6px 30px",borderRadius:8,border:"1.5px solid #e2e8f0",
                  background:"#f8fafc",fontSize:12,color:"#1e293b",fontFamily:"inherit",outline:"none",
                  boxSizing:"border-box",transition:"border-color .15s"}}
                onFocus={e=>e.target.style.borderColor="#3b82f6"}
                onBlur={e=>e.target.style.borderColor="#e2e8f0"}
              />
              {varSearch&&(
                <button onClick={()=>setVarSearch("")}
                  style={{position:"absolute",right:7,top:"50%",transform:"translateY(-50%)",
                    background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#94a3b8",lineHeight:1,padding:0}}>✕</button>
              )}
            </div>
            {(()=>{
              const norm = s => s.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
              const q = norm(varSearch);
              const filtered = q ? decisionVars.filter(({col})=>norm(col).includes(q)) : decisionVars;
              return filtered.length>0 ? filtered.map(({col,csvId})=>(
                <div key={`${csvId}-${col}`}
                  onMouseDown={(e)=>startPanelDrag(e,col,csvId)}
                  style={{display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:8,
                    border:"1.5px solid #fde68a",background:"#fef9c3",marginBottom:4,
                    cursor:"grab",userSelect:"none",fontSize:12,fontWeight:500,color:"#92400e",transition:"all .12s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="#fef3c7";e.currentTarget.style.borderColor="#f59e0b";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="#fef9c3";e.currentTarget.style.borderColor="#fde68a";}}>
                  <span>◇</span>
                  <span style={{flex:1}}>{col}</span>
                  <span style={{fontSize:14,opacity:.5}}>⠿</span>
                </div>
              )) : (
                <div style={{padding:"8px 4px",fontSize:11.5,color:"#94a3b8",textAlign:"center"}}>
                  Nenhuma variável encontrada
                </div>
              );
            })()}
          </div>
        )}

        {/* Decision Lens button */}
        {Object.keys(csvStore).length > 0 && (
          <div style={{padding:"12px 16px",borderBottom:"1px solid #f1f5f9"}}>
            <p style={{fontSize:11,color:"#94a3b8",marginBottom:8,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Segmentação</p>
            <button
              onClick={()=>{
                pushHistory();
                const svgEl=svgRef.current;
                const cx=(svgEl.clientWidth/2-vp.x)/vp.s, cy=(svgEl.clientHeight/2-vp.y)/vp.s;
                const id=uid();
                setShapes(p=>[...p,{id,type:"decision_lens",x:cx-LENS_W/2,y:cy-LENS_H/2,w:LENS_W,h:LENS_H,label:"Decision Lens",rules:[],color:"#fff"}]);
                setSel(id);
              }}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px 14px",borderRadius:10,
                border:"1.5px solid #a5f3fc",background:"#ecfeff",
                color:"#0891b2",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit",transition:"all .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.background="#cffafe";e.currentTarget.style.borderColor="#06b6d4";}}
              onMouseLeave={e=>{e.currentTarget.style.background="#ecfeff";e.currentTarget.style.borderColor="#a5f3fc";}}>
              <span style={{fontSize:16}}>🛢</span> Adicionar Decision Lens
            </button>
            <p style={{fontSize:10.5,color:"#cbd5e1",marginTop:6,lineHeight:1.4}}>Ou use a ferramenta 🔎 na barra lateral</p>
          </div>
        )}

        {/* Simulation panel button — always shown so user can add the panel even without data */}
        {true && (
          <div style={{padding:"12px 16px",borderBottom:"1px solid #f1f5f9"}}>
            <p style={{fontSize:11,color:"#94a3b8",marginBottom:8,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Simulação</p>
            <button
              onClick={()=>{
                if (shapes.some(s=>s.type==="simPanel")) return;
                pushHistory();
                const svgEl=svgRef.current;
                const cx=(svgEl.clientWidth/2-vp.x)/vp.s, cy=(svgEl.clientHeight/2-vp.y)/vp.s;
                setShapes(p=>[...p,{id:uid(),type:"simPanel",x:cx-150,y:cy-220,w:300,h:440,label:"Simulação",color:"#fff"}]);
              }}
              disabled={shapes.some(s=>s.type==="simPanel")}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px 14px",borderRadius:10,
                border:"1.5px solid",borderColor:shapes.some(s=>s.type==="simPanel")?"#c7d2fe":"#a5b4fc",
                background:shapes.some(s=>s.type==="simPanel")?"#f5f3ff":"#eef2ff",
                color:shapes.some(s=>s.type==="simPanel")?"#a78bfa":"#4f46e5",
                cursor:shapes.some(s=>s.type==="simPanel")?"default":"pointer",
                fontSize:13,fontWeight:500,fontFamily:"inherit",transition:"all .15s"}}
              onMouseEnter={e=>{if(!shapes.some(s=>s.type==="simPanel")){e.currentTarget.style.background="#e0e7ff";e.currentTarget.style.borderColor="#818cf8";}}}
              onMouseLeave={e=>{e.currentTarget.style.background=shapes.some(s=>s.type==="simPanel")?"#f5f3ff":"#eef2ff";e.currentTarget.style.borderColor=shapes.some(s=>s.type==="simPanel")?"#c7d2fe":"#a5b4fc";}}>
              <span style={{fontSize:16}}>📊</span>
              {shapes.some(s=>s.type==="simPanel")?"Painel ativo no canvas":"Adicionar Painel"}
            </button>
            {/* Business Impact widget toggle */}
            <div style={{marginTop:12,padding:"10px 12px",borderRadius:10,background:"linear-gradient(135deg,#0f172a,#1a1040)",border:"1px solid rgba(129,140,248,0.25)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                <span style={{fontSize:10,fontWeight:800,color:"#818cf8",textTransform:"uppercase",letterSpacing:"0.1em"}}>Business Impact</span>
                <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}>
                  <input type="checkbox" checked={businessWidget.visible}
                    onChange={e => setBusinessWidget(p => ({ ...p, visible: e.target.checked }))}
                    style={{width:14,height:14,accentColor:"#818cf8",cursor:"pointer"}}/>
                  <span style={{fontSize:11,color:"#94a3b8",fontWeight:500}}>Exibir no board</span>
                </label>
              </div>
              <button
                onClick={() => setBusinessWidget(p => ({ ...p, visible: true }))}
                disabled={businessWidget.visible}
                style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:6,
                  padding:"7px 12px",borderRadius:8,border:"1px solid",
                  borderColor:businessWidget.visible?"rgba(129,140,248,0.2)":"rgba(129,140,248,0.5)",
                  background:businessWidget.visible?"rgba(255,255,255,0.03)":"rgba(129,140,248,0.12)",
                  color:businessWidget.visible?"#475569":"#a5b4fc",
                  cursor:businessWidget.visible?"default":"pointer",fontSize:12,fontWeight:500,fontFamily:"inherit",transition:"all .15s"}}
                onMouseEnter={e=>{if(!businessWidget.visible){e.currentTarget.style.background="rgba(129,140,248,0.2)";e.currentTarget.style.borderColor="rgba(129,140,248,0.7)";}}}
                onMouseLeave={e=>{if(!businessWidget.visible){e.currentTarget.style.background="rgba(129,140,248,0.12)";e.currentTarget.style.borderColor="rgba(129,140,248,0.5)";}}}>
                <span style={{fontSize:14}}>{businessWidget.visible ? "✦" : "⬡"}</span>
                {businessWidget.visible ? "Widget ativo no board" : "Abrir Widget"}
              </button>
            </div>
          </div>
        )}

        {/* Feature flags */}
        <div style={{padding:"10px 16px",borderBottom:"1px solid #f1f5f9"}}>
          <p style={{fontSize:11,color:"#94a3b8",marginBottom:8,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Visualização</p>
          <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12.5,color:"#475569",fontWeight:500}}>
            <input type="checkbox" checked={enableDynThickness} onChange={()=>setEnableDynThickness(v=>!v)}
              style={{width:15,height:15,accentColor:"#6366f1"}}/>
            Espessura Dinâmica
          </label>
          <div style={{fontSize:10.5,color:"#94a3b8",marginTop:3,marginLeft:23}}>Arestas mais espessas = maior volume</div>
          <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:5}}>
            <p style={{fontSize:10.5,color:"#94a3b8",fontWeight:500,textTransform:"uppercase",letterSpacing:.5,marginBottom:2}}>Indicadores nas Arestas</p>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12.5,color:"#475569",fontWeight:500}}>
              <input type="checkbox" checked={showEdgeVol} onChange={()=>setShowEdgeVol(v=>!v)}
                style={{width:15,height:15,accentColor:"#6366f1"}}/>
              📊 Volume de Propostas
            </label>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12.5,color:"#475569",fontWeight:500}}>
              <input type="checkbox" checked={showEdgeInadReal} onChange={()=>setShowEdgeInadReal(v=>!v)}
                style={{width:15,height:15,accentColor:"#6366f1"}}/>
              ⚠️ Inad. Real
            </label>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12.5,color:"#475569",fontWeight:500}}>
              <input type="checkbox" checked={showEdgeInadInf} onChange={()=>setShowEdgeInadInf(v=>!v)}
                style={{width:15,height:15,accentColor:"#6366f1"}}/>
              🎯 Inad. Inferida
            </label>
          </div>
        </div>

        {/* Empty state */}
        {Object.keys(csvStore).length === 0 && (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,padding:24,color:"#cbd5e1"}}>
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
              <rect x="6" y="6" width="32" height="32" rx="7" stroke="#e2e8f0" strokeWidth="1.5" strokeDasharray="4 3"/>
              <path d="M14 22h16M22 14v16" stroke="#e2e8f0" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <p style={{fontSize:12,color:"#94a3b8",textAlign:"center",lineHeight:1.6}}>
              Importe um CSV para<br/>adicioná-lo ao fluxo
            </p>
          </div>
        )}

        </div>{/* end scrollable area */}
      </div>

      {/* ═══════════════ GHOST ELEMENT (panel drag) ═══════════════ */}
      {ghostPos&&panelDrag&&(
        <div style={{position:"fixed",left:ghostPos.x,top:ghostPos.y,transform:"translate(-50%,-50%)",
          background:"#fef3c7",border:"1.5px solid #f59e0b",borderRadius:8,
          padding:"5px 12px",fontSize:12,fontWeight:600,color:"#92400e",
          pointerEvents:"none",zIndex:2000,boxShadow:"0 4px 16px rgba(0,0,0,.15)",
          display:"flex",alignItems:"center",gap:6}}>
          ◇ {panelDrag.col}
        </div>
      )}

      {/* ═══════════════ AXIS SELECTION MODAL (Cineminha) ═══════════ */}
      {/* ═══════════════ DECISION LENS MODAL ═══════════════ */}
      {lensModal&&(()=>{
        const { shapeId, rules, population } = lensModal;

        // Build all available columns (deduplicated by column name)
        const allHeaders = Object.entries(csvStore).flatMap(([csvId, csv]) =>
          csv.headers.map(h => ({ col: h, csvId }))
        ).filter((v,i,arr) => arr.findIndex(x=>x.col===v.col)===i);

        const setRules = (newRules) => {
          const pop = computeLensPopulation(newRules, csvStore);
          setLensModal(prev => prev ? { ...prev, rules: newRules, population: pop } : prev);
        };

        const addRule = (col, csvId) => {
          // Default operator based on column type
          const colType = (() => {
            for (const csv of Object.values(csvStore)) {
              const types = csv.columnTypes || {};
              if (types[col]) return types[col];
            }
            return null;
          })();
          const isNumericType = ["qty","qtdAltas","inadReal","inadInferida"].includes(colType);
          const defaultOp = isNumericType ? "gte" : "equal";
          const newRule = { id: uid(), col, csvId, operator: defaultOp, value: "", logic: rules.length > 0 ? "AND" : null };
          setRules([...rules, newRule]);
        };

        const removeRule = (ruleId) => {
          const updated = rules.filter(r => r.id !== ruleId).map((r,i)=>i===0?{...r,logic:null}:r);
          setRules(updated);
        };

        const duplicateRule = (ruleId) => {
          const idx = rules.findIndex(r => r.id === ruleId);
          if (idx < 0) return;
          const src = rules[idx];
          const copy = { ...src, id: uid(), logic: "AND" };
          const next = [...rules];
          next.splice(idx + 1, 0, copy);
          setRules(next);
        };

        const updateRule = (ruleId, patch) => {
          // If operator changes between single/multi mode, reset value
          const rule = rules.find(r => r.id === ruleId);
          const wasMulti = rule && (rule.operator === "in" || rule.operator === "notIn");
          const willBeMulti = patch.operator && (patch.operator === "in" || patch.operator === "notIn");
          const resetVal = patch.operator && wasMulti !== willBeMulti ? { value: "" } : {};
          setRules(rules.map(r => r.id === ruleId ? {...r, ...patch, ...resetVal} : r));
        };

        // Detect if column is numeric: check columnTypes first, then sample values
        const isNumericCol = (col) => {
          for (const csv of Object.values(csvStore)) {
            const types = csv.columnTypes || {};
            if (["qty","qtdAltas","inadReal","inadInferida"].includes(types[col])) return true;
          }
          // Auto-detect: if >70% of sampled non-empty values parse as numbers
          let numCount = 0, total = 0;
          for (const csv of Object.values(csvStore)) {
            const idx = csv.headers.indexOf(col);
            if (idx < 0) continue;
            for (const row of csv.rows.slice(0, 200)) {
              const v = String(row[idx] ?? "").trim();
              if (!v) continue;
              total++;
              if (!isNaN(parseFloat(v)) && isFinite(v)) numCount++;
            }
          }
          return total > 0 && numCount / total > 0.7;
        };

        const getOperatorsForCol = (col) => {
          const numeric = isNumericCol(col);
          return LENS_OPERATORS.filter(op => {
            if (numeric) return !["in","notIn"].includes(op.value);
            return !["lt","lte","gt","gte"].includes(op.value);
          });
        };

        const getDistinctVals = (col, search = "") => {
          const vals = new Set();
          for (const csv of Object.values(csvStore)) {
            const idx = csv.headers.indexOf(col);
            if (idx < 0) continue;
            const rows = csv.rows;
            // Random sample of up to 2000 rows to ensure full value coverage
            const sample = rows.length <= 2000
              ? rows
              : Array.from({length: 2000}, () => rows[Math.floor(Math.random() * rows.length)]);
            for (const row of sample) {
              const v = String(row[idx] ?? "").trim();
              if (v) vals.add(v);
            }
          }
          let sorted = sortDomain([...vals]);
          if (search) sorted = sorted.filter(v => v.toLowerCase().includes(search.toLowerCase()));
          return sorted.slice(0, 50);
        };

        const pct = population.total > 0 ? (population.count / population.total * 100).toFixed(1) : "0.0";
        const needsMultiVal = (op) => op === "in" || op === "notIn";
        const hasInvalidRules = rules.some(r => !String(r.value ?? "").trim());

        // Variable search state lives in lensModal
        const varSearch = lensModal.varSearch || "";
        const setVarSearch = (v) => setLensModal(prev => prev ? {...prev, varSearch: v} : prev);
        const filteredHeaders = varSearch
          ? allHeaders.filter(({col}) => col.toLowerCase().includes(varSearch.toLowerCase()))
          : allHeaders;

        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.5)",backdropFilter:"blur(4px)",zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:18,width:"100%",maxWidth:900,maxHeight:"90vh",boxShadow:"0 24px 80px rgba(0,0,0,.22)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
              {/* Header */}
              <div style={{display:"flex",alignItems:"center",gap:14,padding:"20px 28px 16px",borderBottom:"1px solid #f1f5f9",flexShrink:0}}>
                <div style={{width:44,height:44,borderRadius:12,background:"#ecfeff",border:"2px solid #a5f3fc",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>🛢</div>
                <div style={{flex:1}}>
                  <h2 style={{fontSize:16,fontWeight:700,color:"#1e293b",marginBottom:2}}>Builder de Filtros — Decision Lens</h2>
                  <p style={{fontSize:12.5,color:"#64748b"}}>Construa filtros compostos para definir a população alvo</p>
                </div>
                {/* Population counter */}
                <div style={{textAlign:"right",padding:"8px 14px",borderRadius:12,background:"#ecfeff",border:"1.5px solid #a5f3fc",minWidth:150}}>
                  <div style={{fontSize:18,fontWeight:800,color:"#0891b2",lineHeight:1}}>{fmtQty(population.count)}</div>
                  <div style={{fontSize:11,color:"#0e7490",fontWeight:600,marginTop:2}}>{pct}% da base</div>
                  <div style={{fontSize:10,color:"#94a3b8",marginTop:1}}>registros selecionados</div>
                </div>
                <button onClick={()=>setLensModal(null)}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#f8fafc",cursor:"pointer",fontSize:17,color:"#94a3b8",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontFamily:"inherit",lineHeight:1}}>
                  ✕
                </button>
              </div>

              {/* Body — two columns */}
              <div style={{display:"flex",flex:1,overflow:"hidden",minHeight:0}}>
                {/* Left — Variables */}
                <div style={{width:230,flexShrink:0,borderRight:"1px solid #f1f5f9",display:"flex",flexDirection:"column",background:"#fafafa"}}>
                  <div style={{padding:"12px 12px 8px",borderBottom:"1px solid #f1f5f9",flexShrink:0}}>
                    <p style={{fontSize:11,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.6,marginBottom:6}}>Variáveis disponíveis</p>
                    <input
                      type="text"
                      value={varSearch}
                      onChange={e=>setVarSearch(e.target.value)}
                      placeholder="Buscar variável..."
                      style={{width:"100%",padding:"6px 10px",borderRadius:8,border:"1px solid #e2e8f0",
                        background:"#fff",fontSize:12,color:"#1e293b",fontFamily:"inherit",outline:"none",
                        boxSizing:"border-box"}}
                      onFocus={e=>e.target.style.borderColor="#0891b2"}
                      onBlur={e=>e.target.style.borderColor="#e2e8f0"}/>
                  </div>
                  <div style={{flex:1,overflowY:"auto",padding:"8px 10px"}}>
                    {allHeaders.length === 0 ? (
                      <div style={{padding:"20px 8px",textAlign:"center",fontSize:12,color:"#cbd5e1"}}>
                        Nenhum CSV carregado
                      </div>
                    ) : filteredHeaders.length === 0 ? (
                      <div style={{padding:"16px 8px",textAlign:"center",fontSize:12,color:"#cbd5e1"}}>
                        Nenhuma variável encontrada
                      </div>
                    ) : filteredHeaders.map(({col, csvId}) => {
                      const numeric = isNumericCol(col);
                      return (
                        <div key={col}
                          onClick={() => addRule(col, csvId)}
                          title={col}
                          style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:8,
                            marginBottom:3,cursor:"pointer",fontSize:12.5,fontWeight:500,color:"#1e293b",
                            background:"#fff",border:"1px solid #e2e8f0",transition:"all .12s"}}
                          onMouseEnter={e=>{e.currentTarget.style.borderColor="#0891b2";e.currentTarget.style.background="#ecfeff";}}
                          onMouseLeave={e=>{e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.background="#fff";}}>
                          <span style={{fontSize:10,color:numeric?"#d97706":"#7c3aed",background:numeric?"#fef3c7":"#f3e8ff",
                            padding:"1px 5px",borderRadius:4,fontWeight:700,flexShrink:0,letterSpacing:.3}}>
                            {numeric ? "NUM" : "CAT"}
                          </span>
                          <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{col}</span>
                          <span style={{fontSize:13,color:"#0891b2",flexShrink:0}}>+</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right — Rules workspace */}
                <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
                  <div style={{padding:"12px 20px 8px",borderBottom:"1px solid #f1f5f9",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <p style={{fontSize:11,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.6,margin:0}}>
                      Regras {rules.length > 0 && <span style={{color:"#0891b2"}}>({rules.length})</span>}
                    </p>
                    {rules.length > 0 && (
                      <button onClick={()=>setRules([])}
                        style={{fontSize:11,color:"#e11d48",background:"none",border:"none",cursor:"pointer",
                          fontFamily:"inherit",fontWeight:500,padding:"2px 6px",borderRadius:5}}>
                        Limpar tudo
                      </button>
                    )}
                  </div>
                  <div style={{flex:1,overflowY:"auto",padding:"12px 20px"}}>
                    {rules.length === 0 ? (
                      <div style={{textAlign:"center",padding:"48px 20px",color:"#cbd5e1"}}>
                        <div style={{fontSize:36,marginBottom:12}}>🔎</div>
                        <p style={{fontSize:13,fontWeight:600,color:"#94a3b8",marginBottom:4}}>Nenhum filtro ainda</p>
                        <p style={{fontSize:12,color:"#cbd5e1",lineHeight:1.5}}>Clique em uma variável à esquerda<br/>para adicionar uma regra de filtro</p>
                      </div>
                    ) : rules.map((rule, idx) => {
                      const distinctVals = getDistinctVals(rule.col, "");
                      const isMultiVal = needsMultiVal(rule.operator);
                      const isEmpty = !String(rule.value ?? "").trim();
                      const availableOps = getOperatorsForCol(rule.col);
                      // Ensure current operator is valid for this column type
                      const validOp = availableOps.find(o => o.value === rule.operator)
                        ? rule.operator
                        : availableOps[0]?.value ?? rule.operator;

                      return (
                        <div key={rule.id}>
                          {/* AND/OR connector */}
                          {idx > 0 && (
                            <div style={{display:"flex",alignItems:"center",gap:6,margin:"4px 0 6px",paddingLeft:4}}>
                              <div style={{flex:1,height:1,background:"#f1f5f9"}}/>
                              {["AND","OR"].map(logic => (
                                <button key={logic} onClick={() => updateRule(rule.id, {logic})}
                                  style={{padding:"3px 14px",borderRadius:20,border:"1.5px solid",fontSize:11,fontWeight:700,
                                    cursor:"pointer",fontFamily:"inherit",transition:"all .12s",lineHeight:1.4,
                                    borderColor: rule.logic===logic ? "#0891b2" : "#e2e8f0",
                                    background: rule.logic===logic ? "#ecfeff" : "#fff",
                                    color: rule.logic===logic ? "#0891b2" : "#94a3b8"}}>
                                  {logic}
                                </button>
                              ))}
                              <div style={{flex:1,height:1,background:"#f1f5f9"}}/>
                            </div>
                          )}
                          {/* Rule card */}
                          <div style={{display:"flex",alignItems:"flex-start",gap:8,padding:"11px 13px",borderRadius:12,
                            border:`1.5px solid ${isEmpty ? "#fca5a5" : "#e2e8f0"}`,
                            background: isEmpty ? "#fff5f5" : "#f8fafc",
                            marginBottom:6,transition:"border-color .15s,background .15s"}}
                            onMouseEnter={e=>{if(!isEmpty){e.currentTarget.style.borderColor="#a5f3fc";e.currentTarget.style.background="#f0fdfe";}}}
                            onMouseLeave={e=>{if(!isEmpty){e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.background="#f8fafc";}}}>
                            <div style={{display:"flex",flexDirection:"column",gap:5,flex:1,minWidth:0}}>
                              {/* Column label */}
                              <div style={{display:"flex",alignItems:"center",gap:6}}>
                                <span style={{fontSize:11.5,fontWeight:700,color:"#0e7490",background:"#ecfeff",
                                  padding:"2px 10px",borderRadius:20,border:"1px solid #a5f3fc",whiteSpace:"nowrap",
                                  overflow:"hidden",textOverflow:"ellipsis",maxWidth:200}}>
                                  {rule.col}
                                </span>
                                {isEmpty && (
                                  <span style={{fontSize:10.5,color:"#dc2626",fontWeight:600}}>Valor obrigatório</span>
                                )}
                              </div>
                              {/* Operator + Value row */}
                              <div style={{display:"flex",gap:7,flexWrap:"wrap",alignItems:"flex-start"}}>
                                <select value={validOp} onChange={e=>updateRule(rule.id,{operator:e.target.value})}
                                  style={{padding:"5px 8px",borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                                    fontSize:12,color:"#1e293b",fontFamily:"inherit",cursor:"pointer",outline:"none",
                                    flexShrink:0,maxWidth:180}}>
                                  {availableOps.map(op=>(
                                    <option key={op.value} value={op.value}>{op.label}</option>
                                  ))}
                                </select>
                                {isMultiVal ? (
                                  <div style={{flex:1,minWidth:130}}>
                                    <input type="text" value={rule.value || ""}
                                      onChange={e=>updateRule(rule.id,{value:e.target.value})}
                                      placeholder="val1, val2, val3…"
                                      style={{width:"100%",padding:"5px 10px",borderRadius:8,
                                        border:`1px solid ${isEmpty?"#fca5a5":"#e2e8f0"}`,
                                        background:"#fff",fontSize:12,color:"#1e293b",fontFamily:"inherit",outline:"none",
                                        boxSizing:"border-box"}}
                                      onFocus={e=>e.target.style.borderColor="#0891b2"}
                                      onBlur={e=>e.target.style.borderColor=isEmpty?"#fca5a5":"#e2e8f0"}/>
                                    {distinctVals.length > 0 && (
                                      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:5}}>
                                        {distinctVals.slice(0,15).map(v => {
                                          const cur = (rule.value||"").split(",").map(s=>s.trim()).filter(Boolean);
                                          const active = cur.includes(v);
                                          return (
                                            <span key={v} onClick={()=>{
                                              const next = active ? cur.filter(x=>x!==v) : [...cur,v];
                                              updateRule(rule.id,{value:next.join(", ")});
                                            }} style={{padding:"2px 8px",borderRadius:12,fontSize:10.5,cursor:"pointer",
                                              border:"1px solid",transition:"all .1s",userSelect:"none",
                                              borderColor:active?"#0891b2":"#e2e8f0",
                                              background:active?"#ecfeff":"#fff",
                                              color:active?"#0891b2":"#64748b"}}>
                                              {v}
                                            </span>
                                          );
                                        })}
                                        {distinctVals.length > 15 && (
                                          <span style={{fontSize:10,color:"#94a3b8",alignSelf:"center"}}>+{distinctVals.length-15} mais</span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div style={{flex:1,minWidth:100}}>
                                    <input type="text" value={rule.value || ""}
                                      onChange={e=>updateRule(rule.id,{value:e.target.value})}
                                      placeholder="valor..."
                                      list={`lens-dl-${rule.id}`}
                                      style={{width:"100%",padding:"5px 10px",borderRadius:8,
                                        border:`1px solid ${isEmpty?"#fca5a5":"#e2e8f0"}`,
                                        background:"#fff",fontSize:12,color:"#1e293b",fontFamily:"inherit",outline:"none",
                                        boxSizing:"border-box"}}
                                      onFocus={e=>e.target.style.borderColor="#0891b2"}
                                      onBlur={e=>e.target.style.borderColor=isEmpty?"#fca5a5":"#e2e8f0"}/>
                                    {distinctVals.length > 0 && (
                                      <datalist id={`lens-dl-${rule.id}`}>
                                        {distinctVals.map(v=><option key={v} value={v}/>)}
                                      </datalist>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                            {/* Rule actions */}
                            <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0,marginTop:1}}>
                              <button onClick={()=>duplicateRule(rule.id)} title="Duplicar regra"
                                style={{width:26,height:26,borderRadius:7,border:"1px solid #e2e8f0",background:"#fff",
                                  color:"#64748b",cursor:"pointer",fontSize:12,fontFamily:"inherit",
                                  display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>
                                ⧉
                              </button>
                              <button onClick={()=>removeRule(rule.id)} title="Remover regra"
                                style={{width:26,height:26,borderRadius:7,border:"1px solid #fecaca",background:"#fff1f2",
                                  color:"#e11d48",cursor:"pointer",fontSize:13,fontFamily:"inherit",
                                  display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1}}>
                                ✕
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:"12px 24px",borderTop:"1px solid #e2e8f0",flexShrink:0,background:"#fafafa"}}>
                <button onClick={()=>setLensModal(null)}
                  style={{padding:"8px 18px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",
                    color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
                  Cancelar
                </button>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  {hasInvalidRules && (
                    <span style={{fontSize:11.5,color:"#dc2626",fontWeight:500}}>
                      ⚠ Existem regras com valor vazio
                    </span>
                  )}
                  <span style={{fontSize:11.5,color:"#94a3b8"}}>
                    {rules.length === 0
                      ? "Toda a base será usada"
                      : population.count > 0
                        ? `${fmtQty(population.count)} registros · ${pct}% da base`
                        : "Nenhum registro corresponde"}
                  </span>
                  <button onClick={()=>applyLensRules(shapeId, rules)}
                    disabled={hasInvalidRules}
                    style={{padding:"9px 22px",borderRadius:9,border:"none",
                      background: hasInvalidRules ? "#94a3b8" : "#0891b2",
                      color:"#fff",cursor: hasInvalidRules ? "not-allowed" : "pointer",
                      fontSize:13,fontWeight:700,fontFamily:"inherit",
                      display:"flex",alignItems:"center",gap:6,transition:"background .15s"}}>
                    ✓ Salvar Lens
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {axisModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.45)",backdropFilter:"blur(4px)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"#fff",borderRadius:18,width:"100%",maxWidth:400,boxShadow:"0 24px 80px rgba(0,0,0,.2)",padding:"28px 32px",display:"flex",flexDirection:"column",gap:20}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                <div style={{width:38,height:38,borderRadius:10,background:"#eef2ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>⊞</div>
                <div>
                  <h3 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:2}}>
                    {axisModal.shapeIds ? `Adicionar a ${axisModal.shapeIds.length} Cineminhas` : 'Adicionar ao Cineminha'}
                  </h3>
                  <p style={{fontSize:12.5,color:"#64748b"}}>Variável: <strong>{axisModal.col}</strong></p>
                </div>
              </div>
              <p style={{fontSize:13,color:"#475569",lineHeight:1.6}}>Como deseja posicionar esta variável na matriz?</p>
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>assignCinemaVar(axisModal.shapeIds??axisModal.shapeId, axisModal.col, axisModal.csvId, 'row')}
                style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:"16px 10px",borderRadius:12,border:"1.5px solid #c7d2fe",background:"#eef2ff",cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="#818cf8";e.currentTarget.style.background="#e0e7ff";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="#c7d2fe";e.currentTarget.style.background="#eef2ff";}}>
                <span style={{fontSize:22}}>↕</span>
                <span style={{fontSize:13,fontWeight:700,color:"#4f46e5"}}>Linhas</span>
                <span style={{fontSize:11,color:"#64748b",textAlign:"center"}}>Valores como linhas da matriz</span>
              </button>
              <button onClick={()=>assignCinemaVar(axisModal.shapeIds??axisModal.shapeId, axisModal.col, axisModal.csvId, 'col')}
                style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:"16px 10px",borderRadius:12,border:"1.5px solid #c7d2fe",background:"#eef2ff",cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="#818cf8";e.currentTarget.style.background="#e0e7ff";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="#c7d2fe";e.currentTarget.style.background="#eef2ff";}}>
                <span style={{fontSize:22}}>↔</span>
                <span style={{fontSize:13,fontWeight:700,color:"#4f46e5"}}>Colunas</span>
                <span style={{fontSize:11,color:"#64748b",textAlign:"center"}}>Valores como colunas da matriz</span>
              </button>
              {!axisModal.shapeIds&&(
                <button onClick={()=>assignResultVar(axisModal.shapeId, axisModal.col, axisModal.csvId)}
                  style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:"16px 10px",borderRadius:12,border:"1.5px solid #d1fae5",background:"#f0fdf4",cursor:"pointer",fontFamily:"inherit",transition:"all .15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="#6ee7b7";e.currentTarget.style.background="#dcfce7";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor="#d1fae5";e.currentTarget.style.background="#f0fdf4";}}>
                  <span style={{fontSize:22}}>⊞</span>
                  <span style={{fontSize:13,fontWeight:700,color:"#15803d"}}>Resultado</span>
                  <span style={{fontSize:11,color:"#64748b",textAlign:"center"}}>Valor de cada casela</span>
                </button>
              )}
            </div>
            <button onClick={()=>setAxisModal(null)}
              style={{alignSelf:"flex-end",padding:"9px 20px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ RESULT VARIABLE MODAL ════════════ */}
      {resultVarModal&&(()=>{
        const rShape = shapes.find(s => s.id === resultVarModal.shapeId);
        if (!rShape) return null;
        // Collect available CSV(s) from the shape's axis vars
        const csvIds = [...new Set([rShape.rowVar?.csvId, rShape.colVar?.csvId].filter(Boolean))];
        // If no axes are set yet, collect from all imported CSVs
        const availCsvIds = csvIds.length > 0 ? csvIds : Object.keys(csvStore);
        const axisColsUsed = new Set([rShape.rowVar?.col, rShape.colVar?.col].filter(Boolean));
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.45)",backdropFilter:"blur(4px)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:18,width:"100%",maxWidth:460,boxShadow:"0 24px 80px rgba(0,0,0,.2)",padding:"28px 32px",display:"flex",flexDirection:"column",gap:18}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:2}}>
                <div style={{width:40,height:40,borderRadius:10,background:"#f0fdf4",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>⊞</div>
                <div>
                  <h3 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:2}}>Variável de Resultado</h3>
                  <p style={{fontSize:12.5,color:"#64748b",lineHeight:1.5}}>Selecione qual coluna define o valor de cada casela da matriz.</p>
                </div>
              </div>
              {rShape.resultVar&&(
                <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",borderRadius:8,background:"#f0fdf4",border:"1px solid #bbf7d0"}}>
                  <span style={{fontSize:12,color:"#15803d",fontWeight:600}}>Atual: {rShape.resultVar.col}</span>
                  <button onClick={()=>{clearResultVar(resultVarModal.shapeId);setResultVarModal(null);}}
                    style={{marginLeft:"auto",padding:"3px 10px",borderRadius:6,border:"1px solid #bbf7d0",background:"#fff",color:"#dc2626",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",fontWeight:600}}>
                    Remover
                  </button>
                </div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:300,overflowY:"auto"}}>
                {availCsvIds.map(csvId => {
                  const csv = csvStore[csvId];
                  if (!csv) return null;
                  const cols = csv.headers.filter(h => h !== '__DECISAO_ORIGINAL' && !axisColsUsed.has(h));
                  return (
                    <div key={csvId}>
                      {availCsvIds.length > 1 && (
                        <div style={{fontSize:10,color:"#94a3b8",fontWeight:700,textTransform:"uppercase",letterSpacing:.5,padding:"4px 0 2px"}}>
                          {csv.name}
                        </div>
                      )}
                      {cols.map(col => {
                        const isActive = rShape.resultVar?.col === col && rShape.resultVar?.csvId === csvId;
                        const colType = csv.columnTypes?.[col];
                        const typeInfo = COL_TYPES.find(t => t.value === colType);
                        return (
                          <button key={col} onClick={()=>assignResultVar(resultVarModal.shapeId, col, csvId)}
                            style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"9px 14px",borderRadius:9,
                              border:`1.5px solid ${isActive?"#6ee7b7":"#e2e8f0"}`,
                              background:isActive?"#f0fdf4":"#fafafa",
                              cursor:"pointer",fontFamily:"inherit",textAlign:"left",
                              transition:"border-color .12s,background .12s"}}
                            onMouseEnter={e=>{if(!isActive){e.currentTarget.style.borderColor="#bbf7d0";e.currentTarget.style.background="#f7fffe";}}}
                            onMouseLeave={e=>{if(!isActive){e.currentTarget.style.borderColor="#e2e8f0";e.currentTarget.style.background="#fafafa";}}}>
                            <span style={{fontSize:14}}>{typeInfo?.icon ?? '📋'}</span>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:13,fontWeight:isActive?700:500,color:isActive?"#15803d":"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{col}</div>
                              {typeInfo&&<div style={{fontSize:10.5,color:"#94a3b8"}}>{typeInfo.label}</div>}
                            </div>
                            {isActive&&<span style={{fontSize:14,color:"#22c55e"}}>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
                {availCsvIds.length === 0 && (
                  <p style={{fontSize:13,color:"#94a3b8",textAlign:"center",padding:"16px 0"}}>Nenhum CSV importado. Importe uma base de dados primeiro.</p>
                )}
              </div>
              <button onClick={()=>setResultVarModal(null)}
                style={{alignSelf:"flex-end",padding:"9px 20px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
                Cancelar
              </button>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════ IMPORT FLOW ERROR MODAL ═══════════ */}
      {importError&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.45)",backdropFilter:"blur(4px)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:440,boxShadow:"0 24px 80px rgba(0,0,0,.2)",padding:"28px 32px",display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:40,height:40,borderRadius:12,background:"#fee2e2",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>⚠</div>
              <div>
                <h3 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:2}}>Erro ao Importar Fluxo</h3>
                <p style={{fontSize:12.5,color:"#64748b",lineHeight:1.5}}>{importError}</p>
              </div>
            </div>
            <button onClick={()=>setImportError(null)}
              style={{alignSelf:"flex-end",padding:"9px 22px",borderRadius:9,border:"none",background:"#2563eb",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ CINEMINHA IMPORT MODAL ═══════════════ */}
      {cinemaImportModal&&(()=>{
        const {config, step, rowMapping, colMapping, availableVars, fromLibrary} = cinemaImportModal;
        const hasRow = !!config.rowVar;
        const hasCol = !!config.colVar;
        const vars = config.metadata?.variables ?? {};
        const rowValueLabels = vars.rowValueLabels ?? {};
        const colValueLabels = vars.colValueLabels ?? {};
        const rowLabelSamples = Object.values(rowValueLabels).slice(0, 5);
        const colLabelSamples = Object.values(colValueLabels).slice(0, 5);
        const btnStyle = (active) => ({
          padding:"5px 14px",borderRadius:7,border:`1px solid ${active?"#6366f1":"#e2e8f0"}`,
          background:active?"#eef2ff":"#fff",color:active?"#4f46e5":"#64748b",
          cursor:"pointer",fontSize:12,fontFamily:"inherit",fontWeight:active?600:400,
        });
        const selectStyle = {
          width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #e2e8f0",
          fontSize:12.5,fontFamily:"inherit",color:"#1e293b",background:"#fff",cursor:"pointer",
          outline:"none",
        };
        // fromLibrary: allow applying without mapping (structure-only import when no datasets loaded)
        const canApply = fromLibrary
          ? ((!hasRow || !availableVars.length || rowMapping) && (!hasCol || !availableVars.length || colMapping))
          : ((!hasRow || rowMapping) && (!hasCol || colMapping));

        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.45)",backdropFilter:"blur(4px)",zIndex:3500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:18,width:"100%",maxWidth:480,boxShadow:"0 24px 80px rgba(0,0,0,.2)",padding:"28px 32px",display:"flex",flexDirection:"column",gap:20}}>
              {/* Header */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <h2 style={{fontSize:17,fontWeight:700,color:"#1e293b",marginBottom:4}}>
                    {step==='confirm' ? "Substituir Configuração?" : fromLibrary ? "Aplicar da Biblioteca" : "Importar Configuração"}
                  </h2>
                  <p style={{fontSize:12.5,color:"#64748b"}}>
                    {step==='confirm'
                      ? "Este Cineminha já possui variáveis configuradas."
                      : fromLibrary
                        ? `Mapeie as variáveis de "${config.name||'Cineminha'}" para o dataset atual.`
                        : "Mapeie as variáveis do arquivo para o dataset atual."}
                  </p>
                </div>
                <button onClick={()=>setCinemaImportModal(null)}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#f8fafc",cursor:"pointer",fontSize:16,color:"#64748b",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>

              {step==='confirm' && (
                <div style={{padding:"14px 16px",borderRadius:12,background:"#fffbeb",border:"1px solid #fde68a",fontSize:12.5,color:"#78350f",lineHeight:1.6}}>
                  <div style={{fontWeight:600,marginBottom:6}}>⚠ Configuração atual será substituída por:</div>
                  {config.rowVar && (
                    <div>Linha: <strong>{config.rowVar.col}</strong>
                      {rowLabelSamples.length > 0 && <span style={{color:"#92400e",fontWeight:400}}> ({rowLabelSamples.join(', ')}{Object.keys(rowValueLabels).length > 5 ? '…' : ''})</span>}
                    </div>
                  )}
                  {config.colVar && (
                    <div>Coluna: <strong>{config.colVar.col}</strong>
                      {colLabelSamples.length > 0 && <span style={{color:"#92400e",fontWeight:400}}> ({colLabelSamples.join(', ')}{Object.keys(colValueLabels).length > 5 ? '…' : ''})</span>}
                    </div>
                  )}
                  <div style={{marginTop:4}}>Domínio: {(config.rowDomain||[]).length} × {(config.colDomain||[]).length} células</div>
                </div>
              )}

              {step==='mapping' && (
                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  {hasRow && (
                    <div>
                      <div style={{fontSize:12,fontWeight:600,color:"#374151",marginBottom:2}}>
                        Variável de Linha
                        <span style={{fontWeight:400,color:"#6b7280",marginLeft:6}}>
                          (original: <code style={{background:"#f1f5f9",padding:"1px 5px",borderRadius:4}}>{config.rowVar.col}</code>)
                        </span>
                      </div>
                      {rowLabelSamples.length > 0 && (
                        <div style={{fontSize:11,color:"#0369a1",background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:6,padding:"3px 8px",marginBottom:6,lineHeight:1.5}}>
                          🏷 Labels: <strong>{rowLabelSamples.join(', ')}</strong>{Object.keys(rowValueLabels).length > 5 ? '…' : ''}
                        </div>
                      )}
                      {availableVars.length > 0 ? (
                        <select value={rowMapping ? `${rowMapping.csvId}::${rowMapping.col}` : ""}
                          onChange={e => {
                            const v = e.target.value;
                            setCinemaImportModal(prev => ({...prev, rowMapping: v ? availableVars.find(x=>`${x.csvId}::${x.col}`===v)||null : null}));
                          }}
                          style={selectStyle}>
                          <option value="">— Não mapear —</option>
                          {availableVars.map(v=>(
                            <option key={`${v.csvId}::${v.col}`} value={`${v.csvId}::${v.col}`}>
                              {v.col} ({v.csvName})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div style={{fontSize:12,color:"#94a3b8",fontStyle:"italic"}}>Nenhuma variável de decisão disponível no dataset.</div>
                      )}
                    </div>
                  )}
                  {hasCol && (
                    <div>
                      <div style={{fontSize:12,fontWeight:600,color:"#374151",marginBottom:2}}>
                        Variável de Coluna
                        <span style={{fontWeight:400,color:"#6b7280",marginLeft:6}}>
                          (original: <code style={{background:"#f1f5f9",padding:"1px 5px",borderRadius:4}}>{config.colVar.col}</code>)
                        </span>
                      </div>
                      {colLabelSamples.length > 0 && (
                        <div style={{fontSize:11,color:"#0369a1",background:"#f0f9ff",border:"1px solid #bae6fd",borderRadius:6,padding:"3px 8px",marginBottom:6,lineHeight:1.5}}>
                          🏷 Labels: <strong>{colLabelSamples.join(', ')}</strong>{Object.keys(colValueLabels).length > 5 ? '…' : ''}
                        </div>
                      )}
                      {availableVars.length > 0 ? (
                        <select value={colMapping ? `${colMapping.csvId}::${colMapping.col}` : ""}
                          onChange={e => {
                            const v = e.target.value;
                            setCinemaImportModal(prev => ({...prev, colMapping: v ? availableVars.find(x=>`${x.csvId}::${x.col}`===v)||null : null}));
                          }}
                          style={selectStyle}>
                          <option value="">— Não mapear —</option>
                          {availableVars.map(v=>(
                            <option key={`${v.csvId}::${v.col}`} value={`${v.csvId}::${v.col}`}>
                              {v.col} ({v.csvName})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div style={{fontSize:12,color:"#94a3b8",fontStyle:"italic"}}>Nenhuma variável de decisão disponível no dataset.</div>
                      )}
                    </div>
                  )}
                  {!hasRow && !hasCol && (
                    <div style={{fontSize:12.5,color:"#64748b",fontStyle:"italic"}}>
                      A configuração não possui variáveis definidas. Apenas os estados de célula serão restaurados.
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:4}}>
                <button onClick={()=>setCinemaImportModal(null)} style={btnStyle(false)}>Cancelar</button>
                {step==='confirm' && (
                  <button onClick={()=>setCinemaImportModal(prev=>({...prev,step:'mapping'}))}
                    style={{...btnStyle(true),background:"#fef3c7",borderColor:"#fcd34d",color:"#92400e"}}>
                    Substituir →
                  </button>
                )}
                {step==='mapping' && (
                  <button onClick={applyCinemaImport}
                    disabled={!canApply}
                    style={{...btnStyle(true),opacity:canApply?1:0.5,cursor:canApply?"pointer":"not-allowed"}}>
                    Aplicar
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════ EXPORT MODAL ═══════════════ */}
      {exportModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.45)",backdropFilter:"blur(4px)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"#fff",borderRadius:18,width:"100%",maxWidth:480,boxShadow:"0 24px 80px rgba(0,0,0,.2)",padding:"28px 32px",display:"flex",flexDirection:"column",gap:20}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <h2 style={{fontSize:17,fontWeight:700,color:"#1e293b",marginBottom:4}}>Exportar Fluxo</h2>
                <p style={{fontSize:12.5,color:"#64748b"}}>Escolha o que incluir na exportação</p>
              </div>
              <button onClick={()=>setExportModal(false)} style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#f8fafc",cursor:"pointer",fontSize:16,color:"#64748b",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {/* Option 1: Flow only */}
              <button onClick={()=>doExport(false)}
                style={{display:"flex",alignItems:"flex-start",gap:14,padding:"16px 18px",borderRadius:12,border:"1.5px solid #e0e7ff",background:"#f5f3ff",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="#818cf8";e.currentTarget.style.background="#ede9fe";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="#e0e7ff";e.currentTarget.style.background="#f5f3ff";}}>
                <div style={{width:38,height:38,borderRadius:10,background:"#ede9fe",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>📋</div>
                <div>
                  <div style={{fontSize:13.5,fontWeight:700,color:"#4f46e5",marginBottom:3}}>Somente a Política</div>
                  <div style={{fontSize:12,color:"#6b7280",lineHeight:1.5}}>Exporta estrutura, nós, conexões, regras e posicionamento visual. Nenhum dado do CSV é incluído.</div>
                </div>
              </button>

              {/* Option 2: Flow + dataset */}
              <button onClick={()=>doExport(true)}
                disabled={Object.keys(csvStore).length===0}
                style={{display:"flex",alignItems:"flex-start",gap:14,padding:"16px 18px",borderRadius:12,border:`1.5px solid ${Object.keys(csvStore).length===0?"#e2e8f0":"#c7d2fe"}`,background:Object.keys(csvStore).length===0?"#f8fafc":"#eef2ff",cursor:Object.keys(csvStore).length===0?"not-allowed":"pointer",textAlign:"left",fontFamily:"inherit",opacity:Object.keys(csvStore).length===0?0.55:1,transition:"all .15s"}}
                onMouseEnter={e=>{if(Object.keys(csvStore).length>0){e.currentTarget.style.borderColor="#818cf8";e.currentTarget.style.background="#e0e7ff";}}}
                onMouseLeave={e=>{if(Object.keys(csvStore).length>0){e.currentTarget.style.borderColor="#c7d2fe";e.currentTarget.style.background="#eef2ff";}}}>
                <div style={{width:38,height:38,borderRadius:10,background:Object.keys(csvStore).length===0?"#f1f5f9":"#e0e7ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>📦</div>
                <div>
                  <div style={{fontSize:13.5,fontWeight:700,color:Object.keys(csvStore).length===0?"#94a3b8":"#3730a3",marginBottom:3}}>Política + Dataset</div>
                  <div style={{fontSize:12,color:"#6b7280",lineHeight:1.5}}>
                    {Object.keys(csvStore).length===0
                      ? "Nenhum dataset carregado no momento."
                      : "Exporta a política completa junto com os dados do CSV carregado e metadados de relacionamento."}
                  </div>
                </div>
              </button>
            </div>

            <button onClick={()=>setExportModal(false)}
              style={{alignSelf:"flex-end",padding:"9px 20px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ LIBRARY IMPORT WIZARD ═══════════════ */}
      {libWizard && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.4)",backdropFilter:"blur(4px)",zIndex:3500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"#fff",borderRadius:18,width:"100%",maxWidth:libWizard.step===2?880:640,maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 24px 80px rgba(0,0,0,.2)",transition:"max-width .2s"}}>

            {/* Header */}
            <div style={{padding:"22px 28px 18px",borderBottom:"1px solid #f1f5f9",flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <h2 style={{fontSize:17,fontWeight:700,color:"#1e293b",marginBottom:3}}>Importar Biblioteca</h2>
                  <p style={{fontSize:12.5,color:"#64748b"}}>{libWizard.filename}</p>
                  <div style={{display:"flex",alignItems:"center",gap:4,marginTop:8}}>
                    <div style={{width:24,height:4,borderRadius:2,background:"#6366f1"}}/>
                    <div style={{width:24,height:4,borderRadius:2,background:libWizard.step>=2?"#6366f1":"#e2e8f0"}}/>
                    <div style={{width:24,height:4,borderRadius:2,background:libWizard.step>=3?"#6366f1":"#e2e8f0"}}/>
                    <span style={{fontSize:10.5,color:"#94a3b8",marginLeft:4}}>Passo {libWizard.step} de 3</span>
                  </div>
                </div>
                <button onClick={()=>setLibWizard(null)} style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#f8fafc",cursor:"pointer",fontSize:16,color:"#64748b",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>✕</button>
              </div>
            </div>

            {/* Body */}
            <div style={{padding:"20px 28px",overflowY:"auto",flex:1}}>
              {libWizard.step===1 ? (
                <>
                  <div style={{marginBottom:20}}>
                    <p style={{fontSize:12,fontWeight:600,color:"#475569",marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>
                      Delimitador
                      {libWizard.confident && <span style={{marginLeft:8,fontSize:11,color:"#16a34a",background:"#f0fdf4",border:"1px solid #bbf7d0",padding:"1px 8px",borderRadius:20}}>detectado automaticamente</span>}
                      {!libWizard.confident && <span style={{marginLeft:8,fontSize:11,color:"#d97706",background:"#fffbeb",border:"1px solid #fde68a",padding:"1px 8px",borderRadius:20}}>verifique abaixo</span>}
                    </p>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                      {DELIMITERS.map(d=>(
                        <label key={d.value} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",borderRadius:9,border:`1.5px solid ${libWizard.delimiter===d.value?"#6366f1":"#e2e8f0"}`,background:libWizard.delimiter===d.value?"#eef2ff":"#fafafa",cursor:"pointer",fontSize:13,color:libWizard.delimiter===d.value?"#4338ca":"#475569",fontWeight:libWizard.delimiter===d.value?600:400,transition:"all .12s"}}>
                          <input type="radio" name="lib-delim" value={d.value} checked={libWizard.delimiter===d.value} onChange={()=>setLibWizard(w=>({...w,delimiter:d.value}))} style={{accentColor:"#6366f1"}}/>
                          {d.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:13,color:"#475569",marginBottom:16}}>
                    <input type="checkbox" checked={libWizard.hasHeader} onChange={()=>setLibWizard(w=>({...w,hasHeader:!w.hasHeader}))} style={{width:15,height:15,accentColor:"#6366f1"}}/>
                    Primeira linha é cabeçalho
                  </label>
                  <p style={{fontSize:12,fontWeight:600,color:"#475569",marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>Prévia</p>
                  <div style={{overflowX:"auto",borderRadius:8,border:"1px solid #e2e8f0"}}>
                    {libWizardPreview && libWizardPreview.headers.length > 0 ? (
                      <table style={{borderCollapse:"collapse",fontSize:12,width:"100%"}}>
                        <thead>
                          <tr>{libWizardPreview.headers.map((h,i)=>(<th key={i} style={{background:"#f8fafc",border:"1px solid #e2e8f0",padding:"6px 12px",color:"#475569",fontWeight:600,whiteSpace:"nowrap",minWidth:80}}>{h}</th>))}</tr>
                        </thead>
                        <tbody>
                          {libWizardPreview.rows.slice(0,5).map((row,ri)=>(
                            <tr key={ri}>{libWizardPreview.headers.map((_,ci)=>(<td key={ci} style={{border:"1px solid #f1f5f9",padding:"5px 12px",color:"#334155",whiteSpace:"nowrap"}}>{row[ci]??""}</td>))}</tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div style={{padding:16,color:"#94a3b8",fontSize:12}}>Nenhum dado detectado. Verifique o delimitador.</div>
                    )}
                  </div>
                  {libWizardPreview && <p style={{fontSize:11,color:"#94a3b8",marginTop:6}}>{libWizardPreview.rows.length} linhas · {libWizardPreview.headers.length} colunas encontradas</p>}
                </>
              ) : libWizard.step===2 ? (
                <>
                  <p style={{fontSize:13,color:"#475569",marginBottom:16,lineHeight:1.6}}>
                    Configure como cada coluna será usada para gerar os Cineminhas.
                  </p>
                  <div style={{border:"1px solid #e2e8f0",borderRadius:10,overflow:"hidden",marginBottom:16}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 190px",alignItems:"center",padding:"8px 14px",background:"#f8fafc",borderBottom:"2px solid #e2e8f0",position:"sticky",top:0,zIndex:1}}>
                      <span style={{fontSize:11,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.5}}>Coluna</span>
                      <span style={{fontSize:11,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.5,textAlign:"center"}}>Papel</span>
                    </div>
                    <div style={{maxHeight:360,overflowY:"auto",overflowX:"hidden"}}>
                      {(libWizardPreview?.headers||[]).map((colName,i)=>{
                        const role = libWizard.columnRoles[colName] || '';
                        const rc = role==='agrupador' ? {bg:"#fffbeb",fg:"#92400e",bc:"#fde68a"}
                               : role==='linha'      ? {bg:"#f0fdf4",fg:"#15803d",bc:"#bbf7d0"}
                               : role==='coluna'     ? {bg:"#eff6ff",fg:"#1d4ed8",bc:"#bfdbfe"}
                               : role==='resultado'  ? {bg:"#fdf4ff",fg:"#7e22ce",bc:"#e9d5ff"}
                               :                      {bg:"#f8fafc",fg:"#94a3b8",bc:"#e2e8f0"};
                        return (
                          <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 190px",alignItems:"center",padding:"9px 14px",borderBottom:i<(libWizardPreview.headers.length-1)?"1px solid #f1f5f9":"none",background:i%2===0?"#fff":"#fafafa"}}>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <span style={{fontSize:13,fontWeight:500,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={colName}>{colName}</span>
                              {role==='agrupador' && (
                                <div style={{display:"flex",alignItems:"center",gap:2,flexShrink:0}}>
                                  <button onClick={()=>setLibWizard(w=>{const idx=w.agrupadorOrder.indexOf(colName);if(idx<=0)return w;const o=[...w.agrupadorOrder];[o[idx-1],o[idx]]=[o[idx],o[idx-1]];return {...w,agrupadorOrder:o};})}
                                    style={{width:18,height:18,border:"1px solid #e2e8f0",borderRadius:3,background:"#f8fafc",cursor:"pointer",fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",padding:0,fontFamily:"inherit"}}>▲</button>
                                  <button onClick={()=>setLibWizard(w=>{const idx=w.agrupadorOrder.indexOf(colName);if(idx<0||idx>=w.agrupadorOrder.length-1)return w;const o=[...w.agrupadorOrder];[o[idx],o[idx+1]]=[o[idx+1],o[idx]];return {...w,agrupadorOrder:o};})}
                                    style={{width:18,height:18,border:"1px solid #e2e8f0",borderRadius:3,background:"#f8fafc",cursor:"pointer",fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",padding:0,fontFamily:"inherit"}}>▼</button>
                                  <span style={{fontSize:10,color:"#92400e",fontWeight:700,marginLeft:2}}>#{libWizard.agrupadorOrder.indexOf(colName)+1}</span>
                                </div>
                              )}
                            </div>
                            <div style={{display:"flex",justifyContent:"center"}}>
                              <select value={role}
                                onChange={e=>{
                                  const newRole=e.target.value;
                                  const prev=libWizard.columnRoles[colName]||'';
                                  const INEL=new Set(['NÃO ELEGÍVEL','NAO ELEGIVEL','INELEGIVEL','INELEGÍVEL','N','FALSE','0','NE','REPROVADO','R','NEGADO','RECUSADO']);
                                  setLibWizard(w=>{
                                    const roles={...w.columnRoles,[colName]:newRole};
                                    let order=[...w.agrupadorOrder];
                                    if(prev==='agrupador'&&newRole!=='agrupador') order=order.filter(c=>c!==colName);
                                    if(newRole==='agrupador'&&prev!=='agrupador') order=[...order,colName];
                                    if(['linha','coluna','resultado'].includes(newRole)){
                                      for(const k of Object.keys(roles)){if(k!==colName&&roles[k]===newRole)roles[k]='';}
                                    }
                                    let resultadoMapping={...(w.resultadoMapping||{})};
                                    if(newRole==='resultado'){
                                      const colIdx=libWizardPreview?.headers.indexOf(colName)??-1;
                                      if(colIdx>=0){
                                        const distinctVals=[...new Set((libWizardPreview?.rows||[]).map(r=>String(r[colIdx]??'')).filter(v=>v!==''))];
                                        for(const val of distinctVals){
                                          if(!resultadoMapping.hasOwnProperty(val)) resultadoMapping[val]=!INEL.has(val.toUpperCase().trim());
                                        }
                                      }
                                    } else if(prev==='resultado'){
                                      resultadoMapping={};
                                    }
                                    return {...w,columnRoles:roles,agrupadorOrder:order,resultadoMapping};
                                  });
                                }}
                                style={{fontSize:12,padding:"4px 8px",borderRadius:7,border:`1.5px solid ${rc.bc}`,background:rc.bg,color:rc.fg,fontFamily:"inherit",cursor:"pointer",outline:"none",fontWeight:600,width:170,appearance:"none",WebkitAppearance:"none",textAlign:"center"}}>
                                <option value="">— Ignorar</option>
                                <option value="agrupador">⚙ Agrupador</option>
                                <option value="linha">→ Linha (eixo Y)</option>
                                <option value="coluna">↓ Coluna (eixo X)</option>
                                <option value="resultado">✓ Resultado</option>
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,fontSize:11.5,color:"#64748b",lineHeight:1.6,padding:"10px 12px",background:"#f8fafc",borderRadius:8,border:"1px solid #e2e8f0"}}>
                    <div><strong style={{color:"#92400e"}}>⚙ Agrupador</strong> — segmenta em Cineminhas distintos</div>
                    <div><strong style={{color:"#15803d"}}>→ Linha</strong> — variável no eixo Y da matriz</div>
                    <div><strong style={{color:"#1d4ed8"}}>↓ Coluna</strong> — variável no eixo X (opcional)</div>
                    <div><strong style={{color:"#7e22ce"}}>✓ Resultado</strong> — elegibilidade por célula (opcional)</div>
                  </div>
                  {/* ── Label columns selector (optional) ── */}
                  {(()=>{
                    const linhaCol=Object.entries(libWizard.columnRoles).find(([,v])=>v==='linha')?.[0]??null;
                    const colunaCol=Object.entries(libWizard.columnRoles).find(([,v])=>v==='coluna')?.[0]??null;
                    if(!linhaCol&&!colunaCol) return null;
                    const labelCandidates=(libWizardPreview?.headers||[]).filter(h=>h!==linhaCol&&h!==colunaCol&&(libWizard.columnRoles[h]||'')==='');
                    const selStyle={flex:1,fontSize:12,padding:"5px 8px",borderRadius:7,border:"1.5px solid #bae6fd",background:"#fff",fontFamily:"inherit",cursor:"pointer",outline:"none"};
                    return (
                      <div style={{marginTop:14,padding:"14px 16px",background:"#f0f9ff",border:"1.5px solid #bae6fd",borderRadius:12}}>
                        <p style={{fontSize:11.5,fontWeight:700,color:"#0369a1",textTransform:"uppercase",letterSpacing:.5,margin:"0 0 6px"}}>🏷 Labels de Variáveis <span style={{fontWeight:400,color:"#0ea5e9",fontSize:11}}>(opcional)</span></p>
                        <p style={{fontSize:12,color:"#0c4a6e",marginBottom:10,lineHeight:1.5}}>Selecione a coluna com o nome operacional de cada variável para exibir durante o mapeamento.</p>
                        <div style={{display:"flex",flexDirection:"column",gap:8}}>
                          {linhaCol&&(
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <span style={{fontSize:12,fontWeight:600,color:"#15803d",minWidth:140,flexShrink:0}}>→ Linha ({linhaCol})</span>
                              <select value={libWizard.rowLabelCol||''} onChange={e=>setLibWizard(w=>({...w,rowLabelCol:e.target.value||null}))} style={selStyle}>
                                <option value="">— Nenhum —</option>
                                {labelCandidates.map(h=><option key={h} value={h}>{h}</option>)}
                              </select>
                            </div>
                          )}
                          {colunaCol&&(
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <span style={{fontSize:12,fontWeight:600,color:"#1d4ed8",minWidth:140,flexShrink:0}}>↓ Coluna ({colunaCol})</span>
                              <select value={libWizard.colLabelCol||''} onChange={e=>setLibWizard(w=>({...w,colLabelCol:e.target.value||null}))} style={selStyle}>
                                <option value="">— Nenhum —</option>
                                {labelCandidates.map(h=><option key={h} value={h}>{h}</option>)}
                              </select>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                  {(()=>{
                    const resultadoCol=Object.entries(libWizard.columnRoles).find(([,v])=>v==='resultado')?.[0]??null;
                    if(!resultadoCol||!libWizardPreview) return null;
                    const colIdx=libWizardPreview.headers.indexOf(resultadoCol);
                    if(colIdx<0) return null;
                    const distinctVals=[...new Set(libWizardPreview.rows.map(r=>String(r[colIdx]??'')).filter(v=>v!==''))];
                    if(distinctVals.length===0) return null;
                    const INEL=new Set(['NÃO ELEGÍVEL','NAO ELEGIVEL','INELEGIVEL','INELEGÍVEL','N','FALSE','0','NE','REPROVADO','R','NEGADO','RECUSADO']);
                    const rm=libWizard.resultadoMapping||{};
                    const eligCount=distinctVals.filter(v=>rm.hasOwnProperty(v)?rm[v]:!INEL.has(v.toUpperCase().trim())).length;
                    return (
                      <div style={{marginTop:16,padding:"14px 16px",background:"#fdf4ff",border:"1.5px solid #e9d5ff",borderRadius:12}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                          <p style={{fontSize:11.5,fontWeight:700,color:"#7e22ce",textTransform:"uppercase",letterSpacing:.5,margin:0}}>✓ Mapeamento de Resultado</p>
                          <span style={{fontSize:11,color:"#6b21a8",background:"#f3e8ff",padding:"2px 8px",borderRadius:10}}>{eligCount} Elegível · {distinctVals.length-eligCount} Não Elegível</span>
                        </div>
                        <p style={{fontSize:12,color:"#6b21a8",marginBottom:10,lineHeight:1.5}}>
                          Defina o que cada valor de <strong>{resultadoCol}</strong> representa.
                        </p>
                        <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:200,overflowY:"auto"}}>
                          {distinctVals.map((val,i)=>{
                            const isElig=rm.hasOwnProperty(val)?rm[val]:!INEL.has(val.toUpperCase().trim());
                            return (
                              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 10px",background:"#fff",borderRadius:8,border:`1.5px solid ${isElig?"#bbf7d0":"#fecaca"}`}}>
                                <span style={{flex:1,fontSize:13,fontWeight:500,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={val}>{val}</span>
                                <div style={{display:"flex",gap:4,flexShrink:0}}>
                                  <button onClick={()=>setLibWizard(w=>({...w,resultadoMapping:{...(w.resultadoMapping||{}),[val]:true}}))}
                                    style={{padding:"3px 10px",borderRadius:6,border:`1.5px solid ${isElig?"#16a34a":"#e2e8f0"}`,background:isElig?"#f0fdf4":"#f8fafc",color:isElig?"#15803d":"#94a3b8",cursor:"pointer",fontSize:12,fontWeight:isElig?700:400,fontFamily:"inherit",transition:"all .1s"}}>
                                    ✅ Elegível
                                  </button>
                                  <button onClick={()=>setLibWizard(w=>({...w,resultadoMapping:{...(w.resultadoMapping||{}),[val]:false}}))}
                                    style={{padding:"3px 10px",borderRadius:6,border:`1.5px solid ${!isElig?"#dc2626":"#e2e8f0"}`,background:!isElig?"#fef2f2":"#f8fafc",color:!isElig?"#dc2626":"#94a3b8",cursor:"pointer",fontSize:12,fontWeight:!isElig?700:400,fontFamily:"inherit",transition:"all .1s"}}>
                                    ❌ N. Elegível
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </>
              ) : libWizard.step===3 ? (()=>{
                const { headers, rows } = libWizardPreview || { headers: [], rows: [] };
                const { columnRoles, agrupadorOrder, resultadoMapping } = libWizard;
                const linhaCol = Object.entries(columnRoles).find(([,v]) => v === 'linha')?.[0] ?? null;
                const colunaCol = Object.entries(columnRoles).find(([,v]) => v === 'coluna')?.[0] ?? null;
                const resultadoCol = Object.entries(columnRoles).find(([,v]) => v === 'resultado')?.[0] ?? null;
                const agrupadores = agrupadorOrder.filter(c => columnRoles[c] === 'agrupador');
                const groups = new Map();
                for (const row of rows) {
                  const obj = Object.fromEntries(headers.map((h, i) => [h, row[i] ?? '']));
                  const groupKey = agrupadores.length > 0 ? agrupadores.map(a => obj[a]).join(' | ') : '__all__';
                  if (!groups.has(groupKey)) groups.set(groupKey, { key: groupKey, count: 0, rowObjs: [] });
                  const g = groups.get(groupKey);
                  g.count++;
                  if (g.rowObjs.length < 200) g.rowObjs.push(obj); // cap for preview perf
                }
                const groupList = [...groups.values()];

                // Build mini-matrix preview for the first group
                const previewGroup = groupList[0];
                const INEL_P = new Set(['NÃO ELEGÍVEL','NAO ELEGIVEL','INELEGIVEL','INELEGÍVEL','N','FALSE','0','NE','REPROVADO','R','NEGADO','RECUSADO']);
                const rm = resultadoMapping || {};
                let previewMatrix = null;
                if (previewGroup && linhaCol) {
                  const fRows = previewGroup.rowObjs;
                  const rvSet = [...new Set(fRows.map(r => r[linhaCol]).filter(Boolean))];
                  const cvSet = colunaCol ? [...new Set(fRows.map(r => r[colunaCol]).filter(Boolean))] : [];
                  const previewRowDom = sortDomain(rvSet).slice(0, 6);
                  const previewColDom = sortDomain(cvSet).slice(0, 5);
                  const cellMap = {};
                  for (const rowObj of fRows) {
                    const rv = rowObj[linhaCol];
                    const cv = colunaCol ? rowObj[colunaCol] : null;
                    if (!rv || !String(rv).trim()) continue;
                    const ck = cv && String(cv).trim() ? `${rv}|${cv}` : `${rv}|*`;
                    if (cellMap.hasOwnProperty(ck)) continue;
                    if (resultadoCol) {
                      const raw = String(rowObj[resultadoCol] ?? '');
                      cellMap[ck] = rm.hasOwnProperty(raw) ? rm[raw] : !INEL_P.has(raw.toUpperCase().trim());
                    } else {
                      cellMap[ck] = true;
                    }
                  }
                  const rowTrunc = rvSet.length > 6;
                  const colTrunc = cvSet.length > 5;
                  previewMatrix = { previewRowDom, previewColDom, cellMap, rowTrunc, colTrunc, rvSet, cvSet, is2D: previewColDom.length > 0 };
                }

                return (
                  <>
                    <div style={{padding:"14px 16px",borderRadius:12,background:"#f0fdf4",border:"1px solid #bbf7d0",marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
                      <span style={{fontSize:28,flexShrink:0}}>⊞</span>
                      <div>
                        <div style={{fontSize:15,fontWeight:700,color:"#15803d"}}>{groupList.length} Cineminha{groupList.length!==1?'s':''} {groupList.length!==1?'serão criados':'será criado'}</div>
                        <div style={{fontSize:12,color:"#4b7c61",marginTop:2}}>
                          {linhaCol && <span>Linha: <strong>{linhaCol}</strong></span>}
                          {linhaCol && colunaCol && <span> · </span>}
                          {colunaCol && <span>Coluna: <strong>{colunaCol}</strong></span>}
                          {agrupadores.length>0 && <span> · Agrupadores: <strong>{agrupadores.join(', ')}</strong></span>}
                        </div>
                      </div>
                    </div>

                    {/* Mini-matrix preview for first group */}
                    {previewMatrix && (
                      <div style={{border:"1px solid #e2e8f0",borderRadius:10,overflow:"hidden",marginBottom:12}}>
                        <div style={{padding:"8px 14px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0",fontSize:11,fontWeight:600,color:"#64748b",textTransform:"uppercase",letterSpacing:.5,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <span>Pré-visualização — {previewGroup.key==='__all__'?'Cineminha gerado':previewGroup.key}</span>
                          {(previewMatrix.rowTrunc||previewMatrix.colTrunc) && <span style={{fontSize:10,fontWeight:400,color:"#94a3b8"}}>exibição parcial</span>}
                        </div>
                        <div style={{overflowX:"auto",padding:10}}>
                          {previewMatrix.is2D ? (
                            <table style={{borderCollapse:"collapse",fontSize:11}}>
                              <thead>
                                <tr>
                                  <th style={{padding:"4px 8px",background:"#f1f5f9",border:"1px solid #e2e8f0",fontSize:10,color:"#64748b",minWidth:60,fontWeight:600}}>{linhaCol} ↓ / {colunaCol} →</th>
                                  {previewMatrix.previewColDom.map((cv,i)=><th key={i} style={{padding:"4px 8px",background:"#f1f5f9",border:"1px solid #e2e8f0",fontWeight:600,color:"#1e293b",whiteSpace:"nowrap",minWidth:50,textAlign:"center"}}>{cv}</th>)}
                                  {previewMatrix.colTrunc&&<th style={{padding:"4px 8px",background:"#f1f5f9",border:"1px solid #e2e8f0",color:"#94a3b8",textAlign:"center"}}>…</th>}
                                </tr>
                              </thead>
                              <tbody>
                                {previewMatrix.previewRowDom.map((rv,ri)=>(
                                  <tr key={ri}>
                                    <td style={{padding:"4px 8px",background:"#f8fafc",border:"1px solid #e2e8f0",fontWeight:600,color:"#1e293b",whiteSpace:"nowrap"}}>{rv}</td>
                                    {previewMatrix.previewColDom.map((cv,ci)=>{
                                      const ck=`${rv}|${cv}`;
                                      const st=previewMatrix.cellMap[ck];
                                      return <td key={ci} style={{padding:"4px 8px",border:"1px solid #e2e8f0",textAlign:"center",background:st===undefined?"#f8fafc":st?"#f0fdf4":"#fef2f2"}}>{st===undefined?<span style={{color:"#cbd5e1",fontSize:11}}>—</span>:<span style={{fontSize:13}}>{st?"✅":"❌"}</span>}</td>;
                                    })}
                                    {previewMatrix.colTrunc&&<td style={{padding:"4px 8px",border:"1px solid #e2e8f0",textAlign:"center",color:"#94a3b8"}}>…</td>}
                                  </tr>
                                ))}
                                {previewMatrix.rowTrunc&&<tr><td colSpan={previewMatrix.previewColDom.length+1+(previewMatrix.colTrunc?1:0)} style={{padding:"4px 14px",border:"1px solid #e2e8f0",textAlign:"center",color:"#94a3b8",fontSize:11}}>+{previewMatrix.rvSet.length-6} linhas…</td></tr>}
                              </tbody>
                            </table>
                          ) : (
                            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                              {previewMatrix.previewRowDom.map((rv,i)=>{
                                const ck=`${rv}|*`;
                                const st=previewMatrix.cellMap[ck];
                                return <div key={i} style={{padding:"4px 10px",borderRadius:6,background:st===undefined?"#f1f5f9":st?"#f0fdf4":"#fef2f2",border:`1px solid ${st===undefined?"#e2e8f0":st?"#bbf7d0":"#fecaca"}`,fontSize:12,fontWeight:500,color:"#1e293b",display:"flex",alignItems:"center",gap:4}}><span>{st===undefined?"—":st?"✅":"❌"}</span><span>{rv}</span></div>;
                              })}
                              {previewMatrix.rowTrunc&&<div style={{padding:"4px 10px",fontSize:11,color:"#94a3b8",alignSelf:"center"}}>+{previewMatrix.rvSet.length-6} mais…</div>}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {groupList.length>0 && (
                      <div style={{border:"1px solid #e2e8f0",borderRadius:10,overflow:"hidden",marginBottom:12}}>
                        <div style={{padding:"8px 14px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0",fontSize:11,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.5}}>
                          Grupos{groupList.length>10?` (mostrando 10 de ${groupList.length})`:''}
                        </div>
                        <div style={{maxHeight:200,overflowY:"auto"}}>
                          {groupList.slice(0,10).map((g,i)=>(
                            <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 14px",borderBottom:i<Math.min(groupList.length,10)-1?"1px solid #f1f5f9":"none",background:i%2===0?"#fff":"#fafafa"}}>
                              <span style={{fontSize:13,fontWeight:500,color:"#1e293b"}}>{g.key==='__all__'?'(sem agrupador)':g.key}</span>
                              <span style={{fontSize:11,color:"#94a3b8"}}>{g.count} linha{g.count!==1?'s':''}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <p style={{fontSize:11.5,color:"#94a3b8",lineHeight:1.7}}>
                      Os Cineminhas gerados serão adicionados à <strong style={{color:"#475569"}}>Biblioteca</strong>. Use o botão <strong style={{color:"#4f46e5"}}>📚 Biblioteca</strong> em qualquer nó Cineminha para inserir no canvas.
                    </p>
                  </>
                );
              })() : null}
            </div>

            {/* Footer */}
            <div style={{padding:"16px 28px",borderTop:"1px solid #f1f5f9",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
              <div style={{display:"flex",gap:8}}>
                {libWizard.step>1 && (
                  <button onClick={()=>setLibWizard(w=>({...w,step:w.step-1}))}
                    style={{padding:"9px 18px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
                    ← Voltar
                  </button>
                )}
                <button onClick={()=>setLibWizard(null)}
                  style={{padding:"9px 18px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
                  Cancelar
                </button>
              </div>
              {libWizard.step<3 ? (()=>{
                const canAdvance = libWizard.step===1
                  ? (libWizardPreview && libWizardPreview.headers.length>0)
                  : Object.values(libWizard.columnRoles).includes('linha');
                return (
                  <button disabled={!canAdvance} onClick={()=>setLibWizard(w=>({...w,step:w.step+1}))}
                    style={{padding:"9px 22px",borderRadius:9,border:"none",background:canAdvance?"#6366f1":"#e2e8f0",color:canAdvance?"#fff":"#94a3b8",cursor:canAdvance?"pointer":"default",fontSize:13,fontWeight:600,fontFamily:"inherit",transition:"all .15s"}}>
                    Avançar →
                  </button>
                );
              })() : (
                <button onClick={onLibWizardConfirm}
                  style={{padding:"9px 22px",borderRadius:9,border:"none",background:"#6366f1",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
                  ⊞ Gerar e Adicionar à Biblioteca
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ IMPORT WIZARD MODAL ═══════════════ */}
      {wizard && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.4)",backdropFilter:"blur(4px)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"#fff",borderRadius:18,width:"100%",maxWidth:wizard.step===2?820:600,maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 24px 80px rgba(0,0,0,.2)",transition:"max-width .2s"}}>

            {/* Wizard header */}
            <div style={{padding:"22px 28px 18px",borderBottom:"1px solid #f1f5f9"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <h2 style={{fontSize:17,fontWeight:700,color:"#1e293b",marginBottom:3}}>{wizard.editCsvId ? "Editar Dataset" : "Importar CSV"}</h2>
                  <p style={{fontSize:12.5,color:"#64748b"}}>{wizard.filename}</p>
                  {/* Progress indicator — hidden in edit mode */}
                  {!wizard.editCsvId && (
                    <div style={{display:"flex",alignItems:"center",gap:4,marginTop:8}}>
                      <div style={{width:24,height:4,borderRadius:2,background:"#3b82f6"}}/>
                      <div style={{width:24,height:4,borderRadius:2,background:wizard.step>=2?"#3b82f6":"#e2e8f0"}}/>
                      <span style={{fontSize:10.5,color:"#94a3b8",marginLeft:4}}>Passo {wizard.step} de 2</span>
                    </div>
                  )}
                </div>
                <button onClick={()=>setWizard(null)} style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#f8fafc",cursor:"pointer",fontSize:16,color:"#64748b",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>
            </div>

            <div style={{padding:"20px 28px",overflowY:"auto",flex:1}}>
              {wizard.step===1 ? (
                <>
                  {/* Delimiter detection (step 1) */}
                  <div style={{marginBottom:20}}>
                    <p style={{fontSize:12,fontWeight:600,color:"#475569",marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>
                      Delimitador
                      {wizard.confident && <span style={{marginLeft:8,fontSize:11,color:"#16a34a",background:"#f0fdf4",border:"1px solid #bbf7d0",padding:"1px 8px",borderRadius:20}}>detectado automaticamente</span>}
                      {!wizard.confident && <span style={{marginLeft:8,fontSize:11,color:"#d97706",background:"#fffbeb",border:"1px solid #fde68a",padding:"1px 8px",borderRadius:20}}>verifique abaixo</span>}
                    </p>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                      {DELIMITERS.map(d=>(
                        <label key={d.value} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",borderRadius:9,border:`1.5px solid ${wizard.delimiter===d.value?"#3b82f6":"#e2e8f0"}`,background:wizard.delimiter===d.value?"#eff6ff":"#fafafa",cursor:"pointer",fontSize:13,color:wizard.delimiter===d.value?"#1d4ed8":"#475569",fontWeight:wizard.delimiter===d.value?600:400,transition:"all .12s"}}>
                          <input type="radio" name="delim" value={d.value} checked={wizard.delimiter===d.value} onChange={()=>setWizard(w=>({...w,delimiter:d.value}))} style={{accentColor:"#3b82f6"}}/>
                          {d.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  {/* Decimal separator */}
                  <div style={{marginBottom:20}}>
                    <p style={{fontSize:12,fontWeight:600,color:"#475569",marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>
                      Separador Decimal
                      {wizard.decimalSepConfident
                        ? <span style={{marginLeft:8,fontSize:11,color:"#16a34a",background:"#f0fdf4",border:"1px solid #bbf7d0",padding:"1px 8px",borderRadius:20}}>detectado automaticamente</span>
                        : <span style={{marginLeft:8,fontSize:11,color:"#d97706",background:"#fffbeb",border:"1px solid #fde68a",padding:"1px 8px",borderRadius:20}}>verifique abaixo</span>}
                    </p>
                    <div style={{display:"flex",gap:8}}>
                      {[{value:',',label:'Vírgula  ( 1,50 )'},{value:'.',label:'Ponto  ( 1.50 )'}].map(opt=>(
                        <label key={opt.value} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",borderRadius:9,border:`1.5px solid ${wizard.decimalSep===opt.value?"#3b82f6":"#e2e8f0"}`,background:wizard.decimalSep===opt.value?"#eff6ff":"#fafafa",cursor:"pointer",fontSize:13,color:wizard.decimalSep===opt.value?"#1d4ed8":"#475569",fontWeight:wizard.decimalSep===opt.value?600:400,transition:"all .12s"}}>
                          <input type="radio" name="dec-sep" value={opt.value} checked={wizard.decimalSep===opt.value} onChange={()=>setWizard(w=>({...w,decimalSep:opt.value}))} style={{accentColor:"#3b82f6"}}/>
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  {/* Header row */}
                  <div style={{marginBottom:20}}>
                    <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                      <input type="checkbox" checked={wizard.hasHeader} onChange={e=>setWizard(w=>({...w,hasHeader:e.target.checked}))} style={{width:16,height:16,accentColor:"#3b82f6"}}/>
                      <span style={{fontSize:13,color:"#1e293b",fontWeight:500}}>Primeira linha como cabeçalho</span>
                    </label>
                  </div>
                  {/* Preview */}
                  <div>
                    <p style={{fontSize:12,fontWeight:600,color:"#475569",marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>Prévia (5 primeiras linhas)</p>
                    <div style={{border:"1px solid #e2e8f0",borderRadius:10,overflow:"auto",maxHeight:200}}>
                      {wizardPreview && wizardPreview.headers.length > 0 ? (
                        <table style={{borderCollapse:"collapse",fontSize:12,fontFamily:"inherit",width:"max-content",minWidth:"100%"}}>
                          <thead>
                            <tr>
                              {wizardPreview.headers.map((h,i)=>(<th key={i} style={{background:"#f8fafc",border:"1px solid #e2e8f0",padding:"6px 12px",color:"#475569",fontWeight:600,whiteSpace:"nowrap",minWidth:80}}>{h}</th>))}
                            </tr>
                          </thead>
                          <tbody>
                            {wizardPreview.rows.slice(0,5).map((row,ri)=>(
                              <tr key={ri} style={{background:ri%2===0?"#fff":"#fafafa"}}>
                                {wizardPreview.headers.map((_,ci)=>(<td key={ci} style={{border:"1px solid #f1f5f9",padding:"5px 12px",color:"#334155",whiteSpace:"nowrap"}}>{row[ci]??""}</td>))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div style={{padding:20,textAlign:"center",color:"#94a3b8",fontSize:13}}>Nenhum dado detectado com este delimitador</div>
                      )}
                    </div>
                    {wizardPreview && <p style={{fontSize:11,color:"#94a3b8",marginTop:6}}>{wizardPreview.rows.length} linhas · {wizardPreview.headers.length} colunas encontradas</p>}
                  </div>
                </>
              ) : wizard.step===2 ? (()=>{
                const METRIC_TYPES_SET = new Set(['qty','qtdAltas','qtdAltasInfer','inadReal','inadInferida']);
                const allHeaders = wizardPreview?.headers || (wizard.editCsvId ? csvStore[wizard.editCsvId]?.headers?.filter(h=>h!=='__DECISAO_ORIGINAL') : []) || [];
                const rows4preview = wizardPreview?.rows || (wizard.editCsvId ? csvStore[wizard.editCsvId]?.rows : []) || [];

                // Derive current metric col selections from columnTypes
                const selMetric = {};
                for (const t of METRIC_TYPES_SET) {
                  const col = Object.entries(wizard.columnTypes||{}).find(([,v])=>v===t)?.[0];
                  if (col) selMetric[t] = col;
                }
                const usedMetricCols = new Set(Object.values(selMetric));

                const setMetricCol = (metricType, colName) => {
                  setWizard(w => {
                    const newTypes = {...(w.columnTypes||{})};
                    for (const [h, t] of Object.entries(newTypes)) { if (t === metricType) delete newTypes[h]; }
                    if (colName) newTypes[colName] = metricType;
                    return {...w, columnTypes: newTypes};
                  });
                };

                const availableFor = (metricType) => {
                  const cur = selMetric[metricType];
                  return allHeaders.filter(h => !usedMetricCols.has(h) || h === cur);
                };

                const asIsCandidates = allHeaders.filter(h => !usedMetricCols.has(h));
                const filterCols = allHeaders.filter(h => !usedMetricCols.has(h) && h !== wizard.asIsVar);

                const asIsColIdx = wizard.asIsVar ? allHeaders.indexOf(wizard.asIsVar) : -1;
                const distinctVals = asIsColIdx >= 0
                  ? [...new Set(rows4preview.map(r => String(r[asIsColIdx]??'')).filter(v=>v!==''))].sort()
                  : [];
                const mapping = wizard.asIsMapping || {};
                const hasAprovado = distinctVals.some(v => mapping[v]==='APROVADO');
                const hasReprovado = distinctVals.some(v => mapping[v]==='REPROVADO');
                const allMapped = distinctVals.length > 0 && distinctVals.every(v => mapping[v]==='APROVADO'||mapping[v]==='REPROVADO'||mapping[v]==='IGNORAR');

                const METRIC_DEFS = [
                  { type:'qty',           icon:'📊', label:'Volume de Propostas',    desc:'Contagem de propostas por grupo' },
                  { type:'qtdAltas',       icon:'📈', label:'Altas Reais',            desc:'Altas/vendas reais observadas' },
                  { type:'inadReal',       icon:'⚠️', label:'Inadimplência Real',     desc:'Atrasos históricos observados' },
                  { type:'qtdAltasInfer',  icon:'🔮', label:'Conversões Inferidas',   desc:'Altas estimadas pelo modelo de inferência' },
                  { type:'inadInferida',   icon:'🎯', label:'Inadimplência Inferida', desc:'Inadimplência estimada pelo modelo' },
                ];

                return (
                  <>
                    {/* ── Métricas ── */}
                    <div style={{marginBottom:22}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                        <span style={{fontSize:10.5,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.7}}>Variáveis de Métricas</span>
                        <div style={{flex:1,height:1,background:"#f1f5f9"}}/>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:9}}>
                        {METRIC_DEFS.map(m=>(
                          <div key={m.type} style={{display:"grid",gridTemplateColumns:"200px 1fr",alignItems:"center",gap:12}}>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              <span style={{fontSize:17,lineHeight:1}}>{m.icon}</span>
                              <div>
                                <div style={{fontSize:12.5,fontWeight:600,color:"#1e293b",lineHeight:1.2}}>{m.label}</div>
                                <div style={{fontSize:10.5,color:"#94a3b8",lineHeight:1.3}}>{m.desc}</div>
                              </div>
                            </div>
                            <select
                              value={selMetric[m.type]||''}
                              onChange={e=>setMetricCol(m.type, e.target.value||null)}
                              style={{padding:"8px 12px",borderRadius:8,border:`1.5px solid ${selMetric[m.type]?"#3b82f6":"#e2e8f0"}`,fontSize:12.5,fontFamily:"inherit",background:selMetric[m.type]?"#eff6ff":"#fafafa",color:selMetric[m.type]?"#1d4ed8":"#94a3b8",outline:"none",cursor:"pointer",fontWeight:selMetric[m.type]?600:400}}>
                              <option value="">— Não usar —</option>
                              {availableFor(m.type).map(h=>(<option key={h} value={h}>{h}</option>))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* ── Decisão AS IS ── */}
                    <div style={{marginBottom:22}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                        <span style={{fontSize:10.5,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.7}}>Decisão AS IS</span>
                        <div style={{flex:1,height:1,background:"#f1f5f9"}}/>
                        <span style={{fontSize:10,color:"#94a3b8",background:"#f8fafc",border:"1px solid #e2e8f0",padding:"1px 8px",borderRadius:10}}>opcional</span>
                      </div>
                      <select
                        value={wizard.asIsVar||''}
                        onChange={e=>setWizard(w=>({...w,asIsVar:e.target.value||null,asIsMapping:{}}))}
                        style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1.5px solid ${wizard.asIsVar?"#3b82f6":"#e2e8f0"}`,fontSize:12.5,fontFamily:"inherit",background:wizard.asIsVar?"#eff6ff":"#fafafa",color:wizard.asIsVar?"#1d4ed8":"#94a3b8",outline:"none",cursor:"pointer",fontWeight:wizard.asIsVar?600:400,marginBottom:10}}>
                        <option value="">— Selecionar variável de decisão histórica —</option>
                        {asIsCandidates.map(c=>(<option key={c} value={c}>{c}</option>))}
                      </select>
                      {wizard.asIsVar && distinctVals.length > 0 && (
                        <>
                          <div style={{border:"1px solid #e2e8f0",borderRadius:9,overflow:"hidden",marginBottom:8}}>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 170px",padding:"7px 14px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0"}}>
                              <span style={{fontSize:10.5,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.5}}>Valor na base</span>
                              <span style={{fontSize:10.5,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.5}}>Significado</span>
                            </div>
                            <div style={{maxHeight:160,overflowY:"auto"}}>
                              {distinctVals.map((val,i)=>{
                                const mapped = mapping[val]||'';
                                const color = mapped==='APROVADO'?'#16a34a':mapped==='REPROVADO'?'#dc2626':mapped==='IGNORAR'?'#94a3b8':'#64748b';
                                return (
                                  <div key={val} style={{display:"grid",gridTemplateColumns:"1fr 170px",alignItems:"center",padding:"7px 14px",borderBottom:i<distinctVals.length-1?"1px solid #f1f5f9":"none",background:i%2===0?"#fff":"#fafafa"}}>
                                    <span style={{fontSize:12,fontWeight:500,color:"#1e293b",fontFamily:"monospace",background:"#f1f5f9",display:"inline-block",padding:"2px 8px",borderRadius:4}}>{val}</span>
                                    <select
                                      value={mapped}
                                      onChange={e=>setWizard(w=>({...w,asIsMapping:{...(w.asIsMapping||{}),[val]:e.target.value}}))}
                                      style={{padding:"4px 8px",borderRadius:6,border:`1.5px solid ${mapped?color+"66":"#e2e8f0"}`,fontSize:12,fontFamily:"inherit",color,background:mapped==='APROVADO'?"#f0fdf4":mapped==='REPROVADO'?"#fff1f2":mapped==='IGNORAR'?"#f8fafc":"#fff",fontWeight:mapped?600:400,outline:"none",cursor:"pointer"}}>
                                      <option value="">Selecionar...</option>
                                      <option value="APROVADO">✅ Aprovado</option>
                                      <option value="REPROVADO">❌ Reprovado</option>
                                      <option value="IGNORAR">— Ignorar</option>
                                    </select>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                            <span style={{fontSize:11,display:"flex",alignItems:"center",gap:4,color:hasAprovado?"#16a34a":"#94a3b8"}}>{hasAprovado?"✅":"○"} Aprovado mapeado</span>
                            <span style={{fontSize:11,display:"flex",alignItems:"center",gap:4,color:hasReprovado?"#dc2626":"#94a3b8"}}>{hasReprovado?"❌":"○"} Reprovado mapeado</span>
                            <span style={{fontSize:11,display:"flex",alignItems:"center",gap:4,color:allMapped?"#2563eb":"#94a3b8"}}>{allMapped?"🔵":"○"} Todos os valores mapeados</span>
                          </div>
                        </>
                      )}
                    </div>

                    {/* ── Filtros ── */}
                    {filterCols.length > 0 && (
                      <div>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                          <span style={{fontSize:10.5,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.7}}>Variáveis de Filtro</span>
                          <div style={{flex:1,height:1,background:"#f1f5f9"}}/>
                          <span style={{fontSize:10,color:"#94a3b8"}}>{filterCols.length} coluna(s) — disponíveis no canvas</span>
                        </div>
                        <div style={{border:"1px solid #e2e8f0",borderRadius:9,overflow:"hidden"}}>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 120px",padding:"7px 14px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0"}}>
                            <span style={{fontSize:10.5,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.5}}>Coluna</span>
                            <span style={{fontSize:10.5,fontWeight:700,color:"#7c3aed",textTransform:"uppercase",letterSpacing:.5,textAlign:"center"}}>Tipo de Variável</span>
                          </div>
                          <div style={{maxHeight:220,overflowY:"auto"}}>
                            {filterCols.map((colName,i)=>{
                              const varType = (wizard.varTypes||{})[colName] || "categorical";
                              return (
                                <div key={colName} style={{display:"grid",gridTemplateColumns:"1fr 120px",alignItems:"center",padding:"8px 14px",borderBottom:i<filterCols.length-1?"1px solid #f1f5f9":"none",background:i%2===0?"#fff":"#fafafa"}}>
                                  <span style={{fontSize:12.5,fontWeight:500,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:8}} title={colName}>{colName}</span>
                                  <div style={{display:"flex",justifyContent:"center"}}>
                                    <button
                                      onClick={()=>setWizard(w=>({...w,varTypes:{...(w.varTypes||{}),[colName]:varType==="ordinal"?"categorical":"ordinal"}}))}
                                      style={{padding:"4px 14px",borderRadius:20,border:`1.5px solid ${varType==="ordinal"?"#7c3aed":"#e2e8f0"}`,background:varType==="ordinal"?"#f5f3ff":"#f8fafc",color:varType==="ordinal"?"#7c3aed":"#64748b",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",transition:"all .12s"}}>
                                      {varType==="ordinal"?"📶 Ordinal":"🏷️ Categ."}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <p style={{fontSize:10.5,color:"#94a3b8",marginTop:8,lineHeight:1.5}}>
                          <strong style={{color:"#7c3aed"}}>Ordinal</strong> = hierarquia natural de risco (ex: score, faixa) · <strong>Categórica</strong> = sem ordem definida
                        </p>
                      </div>
                    )}
                  </>
                );
              })() : null}
            </div>

            {/* Wizard footer */}
            <div style={{padding:"16px 28px",borderTop:"1px solid #f1f5f9",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
              <div>
                {wizard.step===2&&!wizard.editCsvId?(
                  <button onClick={()=>setWizard(w=>({...w,step:1}))}
                    style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
                    ← Voltar
                  </button>
                ):null}
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setWizard(null)} style={{padding:"9px 20px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>Cancelar</button>
                {wizard.step===1 ? (
                  <button onClick={()=>{
                    if (!wizardPreview) return;
                    const {headers, rows} = wizardPreview;
                    // Auto-suggest varTypes and metric columns
                    const varSuggestions = {};
                    for (const h of headers) {
                      const ci = headers.indexOf(h);
                      const vals = rows.map(r => r[ci] ?? '').filter(Boolean);
                      varSuggestions[h] = suggestVarType(h, vals);
                    }
                    const metricSuggestions = suggestMetricColumns(headers);
                    const colTypes = {};
                    for (const [metricType, colName] of Object.entries(metricSuggestions)) {
                      colTypes[colName] = metricType;
                    }
                    setWizard(w => ({
                      ...w, step:2,
                      varTypes: {...varSuggestions, ...(w.varTypes||{})},
                      columnTypes: {...colTypes, ...(w.columnTypes||{})},
                    }));
                  }}
                    disabled={!wizardPreview||wizardPreview.headers.length===0}
                    style={{padding:"9px 22px",borderRadius:9,border:"none",background:(!wizardPreview||wizardPreview.headers.length===0)?"#cbd5e1":"#2563eb",color:"#fff",cursor:(!wizardPreview||wizardPreview.headers.length===0)?"not-allowed":"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>
                    Próximo →
                  </button>
                ) : (
                  <button onClick={onImportConfirm}
                    disabled={!wizardPreview&&!wizard.editCsvId}
                    style={{padding:"9px 22px",borderRadius:9,border:"none",background:(!wizardPreview&&!wizard.editCsvId)?"#cbd5e1":"#2563eb",color:"#fff",cursor:(!wizardPreview&&!wizard.editCsvId)?"not-allowed":"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>
                    {wizard.editCsvId ? "Salvar" : "Importar"} →
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ OPTIMIZATION MODAL ═══════════════ */}
      {optimModal&&(()=>{
        const { shapeId, cellMetrics, frontier, scenarios, activeCard,
                proposedCells, sliderApprovalIdx, sliderInadReal, sliderInadInf,
                maxInadReal, maxInadInf, matrixZoom, matrixPanX, matrixPanY } = optimModal;
        const shape = shapes.find(s => s.id === shapeId);
        if (!shape) return null;

        const rDom   = shape.rowDomain?.length > 0 ? shape.rowDomain : ['*'];
        const cDom   = shape.colDomain?.length > 0 ? shape.colDomain : ['*'];
        const show2D = shape.rowVar && shape.colVar;
        const totalQty = Object.values(cellMetrics).reduce((s, m) => s + m.qty, 0);

        // Compute personalizado metrics dynamically from proposedCells
        const eligKeys  = Object.keys(proposedCells).filter(k => isCellEligible(proposedCells, k));
        const pApprQty  = eligKeys.reduce((s,k)=>s+(cellMetrics[k]?.qty||0),0);
        const pAltas    = eligKeys.reduce((s,k)=>s+(cellMetrics[k]?.qtdAltas||0),0);
        const pInadRRaw = eligKeys.reduce((s,k)=>s+(cellMetrics[k]?.inadRRaw||0),0);
        const pInadIRaw = eligKeys.reduce((s,k)=>s+(cellMetrics[k]?.inadIRaw||0),0);
        const personalizado = {
          approvalRate: totalQty>0 ? pApprQty/totalQty : 0,
          inadReal:     pAltas>0   ? pInadRRaw/pAltas  : null,
          inadInferida: pApprQty>0 ? pInadIRaw/pApprQty: null,
          approvedQty:  pApprQty,
        };

        // Slider: approval maps to frontier index (snap to valid states only)
        const maxFIdx = Math.max(0, frontier.length - 1);
        const handleApprovalSlider = (idx) => {
          const pt = frontier[idx];
          if (!pt) return;
          setOptimModal(m => ({ ...m,
            proposedCells:     { ...pt.cells },
            sliderApprovalIdx: idx,
            activeCard: 'personalizado',
          }));
        };

        // Inad sliders: ceiling — find best frontier point respecting the ceiling
        const handleInadSlider = (val, type) => {
          let best = null;
          for (const pt of frontier) {
            const inad = type === 'real' ? pt.inadReal : pt.inadInferida;
            if (inad === null || inad <= val) {
              if (!best || pt.approvalRate > best.approvalRate) best = pt;
            }
          }
          if (!best) return;
          // Find frontier index of best
          const idx = frontier.indexOf(best);
          setOptimModal(m => ({ ...m,
            proposedCells:     { ...best.cells },
            sliderApprovalIdx: idx >= 0 ? idx : m.sliderApprovalIdx,
            [type === 'real' ? 'sliderInadReal' : 'sliderInadInf']: val,
            activeCard: 'personalizado',
          }));
        };

        const selectCard = (card, pt) => {
          if (!pt) return;
          const idx = frontier.indexOf(pt);
          setOptimModal(m => ({ ...m,
            activeCard:        card,
            proposedCells:     { ...pt.cells },
            sliderApprovalIdx: idx >= 0 ? idx : m.sliderApprovalIdx,
            sliderInadReal:    pt.inadReal     ?? maxInadReal,
            sliderInadInf:     pt.inadInferida ?? maxInadInf,
          }));
        };

        // Toggle cell manually (sets personalizado)
        const toggleCell = (cellKey, isCurrentlyElig) => {
          const nc = { ...proposedCells, [cellKey]: isCurrentlyElig ? 0 : 1 };
          // Find nearest frontier index
          const newApprQty = Object.keys(nc)
            .filter(k => isCellEligible(nc, k)).reduce((s,k)=>s+(cellMetrics[k]?.qty||0),0);
          const newRate = totalQty > 0 ? newApprQty/totalQty : 0;
          let nearIdx = 0, bestD = Infinity;
          frontier.forEach((pt, i) => {
            const d = Math.abs(pt.approvalRate - newRate);
            if (d < bestD) { bestD = d; nearIdx = i; }
          });
          setOptimModal(m => ({ ...m,
            proposedCells:     nc,
            sliderApprovalIdx: nearIdx,
            activeCard: 'personalizado',
          }));
        };

        // Matrix zoom/pan handlers
        const handleMatrixWheel = (e) => {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.2 : 1/1.2;
          setOptimModal(m => ({...m, matrixZoom: Math.max(0.4, Math.min(4, m.matrixZoom * factor))}));
        };
        const startMatrixPan = (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const sx = e.clientX, sy = e.clientY;
          const initX = matrixPanX, initY = matrixPanY;
          const onMove = (ev) => setOptimModal(m => ({...m,
            matrixPanX: initX + ev.clientX - sx,
            matrixPanY: initY + ev.clientY - sy,
          }));
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',   onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup',   onUp);
        };

        const scen = scenarios;
        const CARD_DEFS = [
          { id:'conservador',     pt:scen.conservador,    icon:'🛡', label:'Conservador',    sub:'Menor risco',      iconBg:'#dcfce7', textColor:'#15803d' },
          { id:'balanceado',      pt:scen.balanceado,     icon:'⚖', label:'Balanceado',     sub:'Prudente',         iconBg:'#fef9c3', textColor:'#a16207' },
          { id:'melhorEficiencia',pt:scen.melhorEficiencia,icon:'✦',label:'Melhor Eficiência',sub:'Ótimo equilíbrio',iconBg:'#fef3c7', textColor:'#92400e' },
          { id:'expansao',        pt:scen.expansao,       icon:'🚀', label:'Expansão',        sub:'Maior volume',     iconBg:'#dbeafe', textColor:'#1d4ed8' },
          { id:'personalizado',   pt:personalizado,       icon:'🎛', label:'Personalizado',  sub:'Estado atual',     iconBg:'#f3e8ff', textColor:'#7c3aed' },
        ];

        const MetricBadge = ({label, val, color}) => (
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:9.5,color:'#94a3b8',marginBottom:2}}>{label}</div>
            <div style={{fontSize:13,fontWeight:700,color:color||'#1e293b'}}>{fmtPct(val)}</div>
          </div>
        );

        // For approval rate on cards (0–1 ratio)
        const approvalColor = (r) => r >= 0.7 ? '#16a34a' : r >= 0.4 ? '#d97706' : '#dc2626';

        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.55)",backdropFilter:"blur(4px)",
            zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:1100,maxHeight:"92vh",
              boxShadow:"0 32px 100px rgba(0,0,0,.25)",display:"flex",flexDirection:"column",overflow:"hidden"}}>

              {/* ── Header ── */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"14px 24px",borderBottom:"1px solid #e2e8f0",flexShrink:0}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:36,height:36,borderRadius:10,background:"#eef2ff",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>⚙</div>
                  <div>
                    <h2 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:1}}>Otimizar Decisão</h2>
                    <p style={{fontSize:11,color:"#64748b"}}>⊞ {shape.label||"Cineminha"}</p>
                  </div>
                </div>
                <button onClick={()=>setOptimModal(null)}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#f8fafc",
                    cursor:"pointer",fontSize:15,color:"#64748b",display:"flex",alignItems:"center",
                    justifyContent:"center",fontFamily:"inherit"}}>✕</button>
              </div>

              {/* ── Top scenario card strip ── */}
              <div style={{display:"flex",gap:10,padding:"12px 24px",borderBottom:"1px solid #f1f5f9",
                flexShrink:0,overflowX:"auto"}}>
                {CARD_DEFS.map(({id, pt, icon, label, sub, iconBg, textColor}) => {
                  const isActive = activeCard === id;
                  const isPersonalizado = id === 'personalizado';
                  return (
                    <button key={id}
                      onClick={() => id === 'personalizado' ? null : selectCard(id, pt)}
                      style={{flex:'1 1 160px',minWidth:140,padding:'10px 12px',borderRadius:12,
                        textAlign:'left',fontFamily:'inherit',transition:'all .15s',
                        cursor: (isPersonalizado||!pt) ? 'default' : 'pointer',
                        border:`2px solid ${isActive?textColor:'#e2e8f0'}`,
                        background: isActive ? iconBg : '#f8fafc',
                        opacity: (!isPersonalizado && !pt) ? 0.5 : 1,
                      }}>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                        <div style={{width:24,height:24,borderRadius:7,background:iconBg,
                          display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0,
                          border:`1px solid ${isActive?textColor:'transparent'}`}}>{icon}</div>
                        <div>
                          <div style={{fontSize:11.5,fontWeight:700,color:textColor,lineHeight:1.2}}>{label}</div>
                          <div style={{fontSize:9.5,color:'#94a3b8'}}>{sub}</div>
                        </div>
                        {isActive&&(
                          <span style={{marginLeft:'auto',fontSize:8,background:textColor,color:'#fff',
                            borderRadius:99,padding:'2px 6px',fontWeight:700,flexShrink:0}}>ativo</span>
                        )}
                      </div>
                      {pt ? (
                        <div style={{display:'flex',gap:8,justifyContent:'space-between'}}>
                          <MetricBadge label="Aprovação" val={pt.approvalRate} color={approvalColor(pt.approvalRate)}/>
                          <MetricBadge label="Inad. Real" val={pt.inadReal} color={pt.inadReal===null?'#94a3b8':pt.inadReal>0.05?'#dc2626':'#d97706'}/>
                          <MetricBadge label="Inad. Inf." val={pt.inadInferida} color={pt.inadInferida===null?'#94a3b8':pt.inadInferida>0.05?'#dc2626':'#d97706'}/>
                        </div>
                      ) : <span style={{fontSize:10,color:'#94a3b8'}}>Dados insuficientes</span>}
                    </button>
                  );
                })}
              </div>

              {/* ── Body ── */}
              <div style={{display:"flex",flex:1,overflow:"hidden",minHeight:0}}>

                {/* Left panel — sliders */}
                <div style={{width:230,flexShrink:0,borderRight:"1px solid #f1f5f9",
                  padding:"16px 18px",display:"flex",flexDirection:"column",gap:14,overflowY:"auto"}}>

                  <div style={{fontSize:10.5,fontWeight:700,color:"#64748b",
                    textTransform:"uppercase",letterSpacing:".06em"}}>Simulação</div>

                  {/* Approval slider — snaps to frontier states */}
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                      <span style={{fontSize:11.5,fontWeight:600,color:"#1e293b"}}>Taxa de Aprovação</span>
                      <span style={{fontSize:13,fontWeight:700,color:"#6366f1"}}>
                        {`${Math.round(personalizado.approvalRate*100)}%`}
                      </span>
                    </div>
                    <input type="range"
                      min={0} max={maxFIdx} step={1}
                      value={sliderApprovalIdx}
                      onChange={e=>handleApprovalSlider(parseInt(e.target.value))}
                      style={{width:"100%",accentColor:"#6366f1",cursor:"pointer"}}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:9.5,color:"#94a3b8",marginTop:2}}>
                      <span>0%</span>
                      <span>{frontier.length > 0 ? `${Math.round((frontier[maxFIdx]?.approvalRate||0)*100)}%` : '100%'}</span>
                    </div>
                    <div style={{fontSize:10,color:"#94a3b8",marginTop:3}}>
                      {frontier.length > 1 ? `${frontier.length-1} cenários válidos` : 'Sem dados'}
                    </div>
                  </div>

                  <div style={{height:1,background:"#f1f5f9"}}/>

                  {/* Inad Real ceiling slider */}
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                      <span style={{fontSize:11.5,fontWeight:600,color:"#1e293b"}}>⚠ Teto Inad. Real</span>
                      <span style={{fontSize:13,fontWeight:700,color:"#f59e0b"}}>{fmtPct(sliderInadReal)}</span>
                    </div>
                    <input type="range"
                      min={0} max={maxInadReal} step={maxInadReal/200||0.001}
                      value={sliderInadReal}
                      onChange={e=>handleInadSlider(parseFloat(e.target.value),'real')}
                      style={{width:"100%",accentColor:"#f59e0b",cursor:"pointer"}}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:9.5,color:"#94a3b8",marginTop:2}}>
                      <span>0%</span><span>{fmtPct(maxInadReal)}</span>
                    </div>
                  </div>

                  {/* Inad Inferida ceiling slider */}
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                      <span style={{fontSize:11.5,fontWeight:600,color:"#1e293b"}}>🎯 Teto Inad. Inf.</span>
                      <span style={{fontSize:13,fontWeight:700,color:"#8b5cf6"}}>{fmtPct(sliderInadInf)}</span>
                    </div>
                    <input type="range"
                      min={0} max={maxInadInf} step={maxInadInf/200||0.001}
                      value={sliderInadInf}
                      onChange={e=>handleInadSlider(parseFloat(e.target.value),'inferida')}
                      style={{width:"100%",accentColor:"#8b5cf6",cursor:"pointer"}}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:9.5,color:"#94a3b8",marginTop:2}}>
                      <span>0%</span><span>{fmtPct(maxInadInf)}</span>
                    </div>
                  </div>

                  <div style={{height:1,background:"#f1f5f9"}}/>

                  {/* Quick stats for current proposed state */}
                  <div style={{background:"#f8fafc",borderRadius:10,padding:"10px 12px",border:"1px solid #e2e8f0"}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#64748b",marginBottom:8,textTransform:"uppercase",letterSpacing:".05em"}}>
                      Estado Atual
                    </div>
                    {[
                      {label:"Aprovação", val:`${Math.round(personalizado.approvalRate*100)}%`, color:approvalColor(personalizado.approvalRate)},
                      {label:"Inad. Real", val:fmtPct(personalizado.inadReal), color:personalizado.inadReal===null?'#94a3b8':personalizado.inadReal>0.05?'#dc2626':'#d97706'},
                      {label:"Inad. Inf.", val:fmtPct(personalizado.inadInferida), color:personalizado.inadInferida===null?'#94a3b8':personalizado.inadInferida>0.05?'#dc2626':'#d97706'},
                    ].map(({label,val,color})=>(
                      <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                        <span style={{fontSize:11,color:"#64748b"}}>{label}</span>
                        <span style={{fontSize:12,fontWeight:700,color}}>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Center — matrix (main focus) with zoom/pan */}
                <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",position:"relative"}}>
                  <div style={{padding:"10px 16px 6px",borderBottom:"1px solid #f1f5f9",flexShrink:0,
                    display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <span style={{fontSize:10.5,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:".06em"}}>
                      Matriz de Decisão
                    </span>
                    <div style={{display:"flex",gap:4,alignItems:"center"}}>
                      <span style={{fontSize:10,color:"#94a3b8",marginRight:4}}>{Math.round(matrixZoom*100)}%</span>
                      {[["−",()=>setOptimModal(m=>({...m,matrixZoom:Math.max(0.4,m.matrixZoom/1.2)}))],
                        ["⌂",()=>setOptimModal(m=>({...m,matrixZoom:1,matrixPanX:0,matrixPanY:0}))],
                        ["+",()=>setOptimModal(m=>({...m,matrixZoom:Math.min(4,m.matrixZoom*1.2)}))],
                      ].map(([icon,fn])=>(
                        <button key={icon} onClick={fn}
                          style={{width:26,height:26,borderRadius:7,border:"1px solid #e2e8f0",background:"#fff",
                            cursor:"pointer",fontSize:13,color:"#64748b",display:"flex",alignItems:"center",
                            justifyContent:"center",fontFamily:"inherit"}}>
                          {icon}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Scrollable/zoomable/pannable matrix area */}
                  <div style={{flex:1,overflow:"hidden",position:"relative",background:"#f8fafc",
                    cursor:"grab"}}
                    onWheel={handleMatrixWheel}
                    onMouseDown={startMatrixPan}>
                    <div style={{
                      transform:`translate(${matrixPanX}px,${matrixPanY}px) scale(${matrixZoom})`,
                      transformOrigin:"top left",
                      display:"inline-block",
                      padding:"20px",
                      userSelect:"none",
                    }}>
                      <table style={{borderCollapse:"collapse",fontSize:12,
                        fontFamily:"'DM Sans',system-ui,sans-serif",background:"#fff",
                        borderRadius:10,overflow:"hidden",boxShadow:"0 1px 6px rgba(0,0,0,.06)"}}>
                        {show2D&&(
                          <thead>
                            <tr>
                              <th style={{width:90,background:"#f1f5f9",border:"1px solid #e2e8f0",
                                padding:"6px 8px",fontSize:11,color:"#94a3b8",fontWeight:600,
                                whiteSpace:"nowrap",minWidth:90}}>
                                {trunc(shape.rowVar.col,8)} \ {trunc(shape.colVar.col,8)}
                              </th>
                              {cDom.map(cv=>(
                                <th key={cv} style={{width:CINEMA_CELL_W,background:"#f1f5f9",
                                  border:"1px solid #e2e8f0",padding:"6px 4px",fontSize:11,
                                  color:"#475569",fontWeight:600,textAlign:"center",
                                  whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
                                  maxWidth:CINEMA_CELL_W}}>
                                  {cv}
                                </th>
                              ))}
                            </tr>
                          </thead>
                        )}
                        <tbody>
                          {rDom.map(rv=>(
                            <tr key={rv}>
                              <td style={{background:"#f1f5f9",border:"1px solid #e2e8f0",
                                padding:"6px 10px",fontSize:12,fontWeight:600,color:"#475569",
                                whiteSpace:"nowrap",minWidth:90}}>
                                {show2D ? rv : (shape.rowVar?.col||shape.colVar?.col||'')}
                              </td>
                              {cDom.map(cv=>{
                                const cellKey = `${rv}|${cv}`;
                                const isElig  = isCellEligible(proposedCells, cellKey);
                                const m = cellMetrics[cellKey];
                                return (
                                  <td key={cv}
                                    onClick={(e)=>{e.stopPropagation();toggleCell(cellKey,isElig);}}
                                    style={{width:CINEMA_CELL_W,border:"1px solid #e2e8f0",
                                      background:isElig?"#dcfce7":"#fee2e2",
                                      textAlign:"center",padding:"5px 3px",cursor:"pointer",
                                      transition:"background .1s"}}>
                                    <div style={{fontSize:15,fontWeight:700,
                                      color:isElig?"#15803d":"#dc2626",lineHeight:1}}>
                                      {isElig?"✓":"✗"}
                                    </div>
                                    {m&&m.qty>0&&(
                                      <div style={{fontSize:9.5,color:"#64748b",marginTop:2}}>{fmtQty(m.qty)}</div>
                                    )}
                                    {m&&m.inadInferida!=null&&(
                                      <div style={{fontSize:8.5,color:m.inadInferida>0.05?"#dc2626":"#94a3b8",marginTop:1}}>
                                        {fmtPct(m.inadInferida)}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Pan hint */}
                    <div style={{position:"absolute",bottom:8,left:"50%",transform:"translateX(-50%)",
                      fontSize:9.5,color:"#94a3b8",background:"rgba(255,255,255,.8)",
                      borderRadius:99,padding:"3px 10px",pointerEvents:"none",whiteSpace:"nowrap"}}>
                      Scroll = zoom · Arrastar = mover · Clique na célula = alternar
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Footer ── */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:"12px 24px",borderTop:"1px solid #e2e8f0",flexShrink:0,background:"#fafafa"}}>
                <button onClick={()=>setOptimModal(null)}
                  style={{padding:"8px 18px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",
                    color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
                  Cancelar
                </button>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:11,color:"#94a3b8"}}>
                    {`${Math.round(personalizado.approvalRate*100)}% aprovação · ${fmtQty(personalizado.approvedQty)} proposta${personalizado.approvedQty!==1?'s':''}`}
                  </span>
                  <button onClick={()=>applyOptimResult(shapeId,proposedCells)}
                    style={{padding:"9px 22px",borderRadius:9,border:"none",background:"#6366f1",color:"#fff",
                      cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",
                      display:"flex",alignItems:"center",gap:6}}>
                    ✓ Aplicar ao Cineminha
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════ CINEMA LIBRARY MODAL ═══════════════ */}
      {cinemaLibraryModal&&(()=>{
        const { mode, shapeId, search, filterType, saveMeta, overwriteId } = cinemaLibraryModal;
        const upd = (patch) => setCinemaLibraryModal(prev => ({ ...prev, ...patch }));
        const updMeta = (patch) => setCinemaLibraryModal(prev => ({ ...prev, saveMeta: { ...prev.saveMeta, ...patch } }));

        const filteredItems = cinemaLibrary.filter(it => {
          if (filterType && it.cinemaType !== filterType) return false;
          if (!search.trim()) return true;
          const q = search.toLowerCase();
          return (
            it.name.toLowerCase().includes(q) ||
            (it.metadata?.description ?? '').toLowerCase().includes(q) ||
            (it.metadata?.tags ?? []).some(t => t.toLowerCase().includes(q)) ||
            Object.values(it.metadata?.identifiers ?? {}).some(v => String(v).toLowerCase().includes(q))
          );
        });

        const isSaveMode = mode === 'save';
        const title = isSaveMode ? 'Salvar na Biblioteca' : 'Biblioteca de Cineminhas';
        const icon  = isSaveMode ? '💾' : '📚';

        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.5)",backdropFilter:"blur(4px)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:18,width:"100%",maxWidth:isSaveMode?520:700,maxHeight:"88vh",boxShadow:"0 24px 80px rgba(0,0,0,.22)",display:"flex",flexDirection:"column",overflow:"hidden"}}>

              {/* Header */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 28px 16px",borderBottom:"1px solid #f1f5f9",flexShrink:0}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:40,height:40,borderRadius:11,background:"#eef2ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{icon}</div>
                  <div>
                    <h3 style={{fontSize:16,fontWeight:700,color:"#1e293b",marginBottom:2}}>{title}</h3>
                    <p style={{fontSize:12,color:"#94a3b8"}}>{isSaveMode ? "Preencha os metadados e salve o Cineminha atual" : `${cinemaLibrary.length} modelo${cinemaLibrary.length!==1?'s':''} salvo${cinemaLibrary.length!==1?'s':''}`}</p>
                  </div>
                </div>
                <button onClick={()=>setCinemaLibraryModal(null)}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",color:"#94a3b8",cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>×</button>
              </div>

              {isSaveMode ? (
                /* ── Save mode ── */
                <div style={{padding:"20px 28px",display:"flex",flexDirection:"column",gap:16,overflowY:"auto"}}>
                  {/* Name */}
                  <div>
                    <label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:6}}>Nome *</label>
                    <input value={saveMeta.name} onChange={e=>updMeta({name:e.target.value})}
                      placeholder="Ex: Elegibilidade Varejo G1"
                      style={{width:"100%",padding:"9px 12px",borderRadius:9,border:"1.5px solid #e2e8f0",fontSize:13,fontFamily:"inherit",boxSizing:"border-box",outline:"none"}}/>
                  </div>
                  {/* Description */}
                  <div>
                    <label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:6}}>Descrição</label>
                    <textarea value={saveMeta.description} onChange={e=>updMeta({description:e.target.value})}
                      placeholder="Descreva o objetivo e contexto desta matriz…"
                      rows={3}
                      style={{width:"100%",padding:"9px 12px",borderRadius:9,border:"1.5px solid #e2e8f0",fontSize:13,fontFamily:"inherit",boxSizing:"border-box",resize:"vertical",outline:"none"}}/>
                  </div>
                  {/* Tags */}
                  <div>
                    <label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:6}}>Tags <span style={{fontWeight:400,color:"#94a3b8"}}>(separadas por vírgula)</span></label>
                    <input value={saveMeta.tags} onChange={e=>updMeta({tags:e.target.value})}
                      placeholder="Ex: varejo, oferta, G1"
                      style={{width:"100%",padding:"9px 12px",borderRadius:9,border:"1.5px solid #e2e8f0",fontSize:13,fontFamily:"inherit",boxSizing:"border-box",outline:"none"}}/>
                  </div>
                  {/* Identifiers */}
                  <div>
                    <label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:6}}>Identificadores <span style={{fontWeight:400,color:"#94a3b8"}}>(JSON)</span></label>
                    <textarea value={saveMeta.identifiers} onChange={e=>updMeta({identifiers:e.target.value})}
                      rows={4}
                      placeholder={'{\n  "cluster": "G1",\n  "politica": "Oferta"\n}'}
                      style={{width:"100%",padding:"9px 12px",borderRadius:9,border:"1.5px solid #e2e8f0",fontSize:12,fontFamily:"monospace",boxSizing:"border-box",resize:"vertical",outline:"none"}}/>
                  </div>
                  {/* Overwrite selector */}
                  {cinemaLibrary.length > 0 && (
                    <div>
                      <label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:6}}>Sobrescrever modelo existente <span style={{fontWeight:400,color:"#94a3b8"}}>(opcional)</span></label>
                      <select value={overwriteId??''} onChange={e=>upd({overwriteId:e.target.value||null})}
                        style={{width:"100%",padding:"9px 12px",borderRadius:9,border:"1.5px solid #e2e8f0",fontSize:13,fontFamily:"inherit",background:"#fff",outline:"none"}}>
                        <option value="">— Salvar como novo —</option>
                        {cinemaLibrary.map(it=>(
                          <option key={it.id} value={it.id}>{it.name} ({getCinemaType(it.cinemaType).label})</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              ) : (
                /* ── Browse mode ── */
                <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0}}>
                  {/* Post-import success banner */}
                  {cinemaLibraryModal.justImported > 0 && (
                    <div style={{margin:"12px 28px 0",padding:"12px 16px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
                      <span style={{fontSize:22,flexShrink:0}}>✅</span>
                      <div style={{flex:1}}>
                        <div style={{fontSize:13,fontWeight:700,color:"#15803d"}}>{cinemaLibraryModal.justImported} Cineminha{cinemaLibraryModal.justImported!==1?'s':''} gerado{cinemaLibraryModal.justImported!==1?'s':''} com sucesso!</div>
                        <div style={{fontSize:12,color:"#4b7c61",marginTop:1}}>Selecione um item abaixo para inserir no canvas.</div>
                      </div>
                      <button onClick={()=>upd({justImported:0})}
                        style={{fontSize:16,background:"none",border:"none",color:"#4b7c61",cursor:"pointer",padding:0,lineHeight:1,fontFamily:"inherit"}}>×</button>
                    </div>
                  )}
                  {/* Search + filters */}
                  <div style={{padding:"14px 28px 12px",borderBottom:"1px solid #f1f5f9",flexShrink:0,display:"flex",gap:10,alignItems:"center"}}>
                    <input value={search} onChange={e=>upd({search:e.target.value})}
                      placeholder="Buscar por nome, tag, descrição…"
                      style={{flex:1,padding:"8px 12px",borderRadius:9,border:"1.5px solid #e2e8f0",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
                    {Object.values(CINEMINHA_TYPES).map(t=>(
                      <button key={t.id} onClick={()=>upd({filterType:filterType===t.id?null:t.id})}
                        style={{padding:"6px 12px",borderRadius:7,fontSize:11.5,fontFamily:"inherit",cursor:"pointer",whiteSpace:"nowrap",fontWeight:600,
                          border:`1.5px solid ${filterType===t.id?t.badgeFg:t.badgeBg}`,
                          background:filterType===t.id?t.badgeBg:"#fff",
                          color:filterType===t.id?t.badgeFg:"#94a3b8"}}>
                        {t.icon} {t.label}
                      </button>
                    ))}
                    {shapeId && (
                      <button onClick={()=>upd({mode:'save',saveMeta:{name:shapesR.current.find(s=>s.id===shapeId)?.label??'Cineminha',description:(shapesR.current.find(s=>s.id===shapeId)?.metadata?.description??''),tags:(shapesR.current.find(s=>s.id===shapeId)?.metadata?.tags??[]).join(', '),identifiers:JSON.stringify(shapesR.current.find(s=>s.id===shapeId)?.metadata?.identifiers??{},null,2)},overwriteId:null})}
                        style={{padding:"7px 14px",borderRadius:8,border:"1px solid #bbf7d0",background:"#f0fdf4",color:"#15803d",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",fontWeight:600,whiteSpace:"nowrap"}}>
                        💾 Salvar atual
                      </button>
                    )}
                  </div>

                  {/* Item list */}
                  <div style={{flex:1,overflowY:"auto",padding:"12px 28px"}}>
                    {filteredItems.length === 0 ? (
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"48px 0",gap:12,color:"#94a3b8"}}>
                        <div style={{fontSize:40}}>{cinemaLibrary.length===0?'📭':'🔍'}</div>
                        <div style={{fontSize:14,fontWeight:600}}>{cinemaLibrary.length===0?'Biblioteca vazia':'Nenhum resultado'}</div>
                        <div style={{fontSize:12,textAlign:"center",maxWidth:280}}>
                          {cinemaLibrary.length===0
                            ? 'Selecione um Cineminha no canvas e clique em "💾 Salvar" para adicionar à biblioteca.'
                            : 'Tente ajustar a busca ou remover filtros.'}
                        </div>
                      </div>
                    ) : (
                      <div style={{display:"flex",flexDirection:"column",gap:10}}>
                        {filteredItems.map(item => {
                          const cfg = getCinemaType(item.cinemaType);
                          const tags = item.metadata?.tags ?? [];
                          const identifiers = item.metadata?.identifiers ?? {};
                          const identKeys = Object.keys(identifiers);
                          const isSelected = (cinemaLibraryModal.selectedLibIds||[]).includes(item.id);
                          return (
                            <div key={item.id}
                              style={{border:`1.5px solid ${isSelected?"#6366f1":"#e2e8f0"}`,borderRadius:12,padding:"14px 16px",display:"flex",gap:14,alignItems:"flex-start",background:isSelected?"#eef2ff":"#fafafa",transition:"border-color .15s, background .15s",cursor:"pointer"}}
                              onClick={()=>{ setCinemaLibraryModal(prev=>{ const cur=prev.selectedLibIds||[]; const sel=cur.includes(item.id); return {...prev,selectedLibIds:sel?cur.filter(id=>id!==item.id):[...cur,item.id]}; }); }}
                              onMouseEnter={e=>{if(!isSelected){e.currentTarget.style.borderColor=cfg.color;}}}
                              onMouseLeave={e=>{if(!isSelected){e.currentTarget.style.borderColor="#e2e8f0";}}}>
                              <input type="checkbox" checked={isSelected} readOnly
                                style={{marginTop:2,accentColor:"#6366f1",width:15,height:15,cursor:"pointer",flexShrink:0}}
                                onClick={e=>e.stopPropagation()}/>
                              {/* Type badge */}
                              <div style={{width:36,height:36,borderRadius:9,background:cfg.badgeBg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{cfg.icon}</div>
                              {/* Info */}
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                                  <span style={{fontSize:13.5,fontWeight:700,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</span>
                                  <span style={{fontSize:10.5,fontWeight:600,padding:"2px 7px",borderRadius:99,background:cfg.badgeBg,color:cfg.badgeFg,flexShrink:0}}>{cfg.label}</span>
                                  {item.metadata?.version>1&&<span style={{fontSize:10,color:"#94a3b8",flexShrink:0}}>v{item.metadata.version}</span>}
                                </div>
                                {item.metadata?.description&&(
                                  <div style={{fontSize:11.5,color:"#64748b",marginBottom:5,lineHeight:1.4}}>{item.metadata.description}</div>
                                )}
                                <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:identKeys.length?5:0}}>
                                  {tags.map(t=>(
                                    <span key={t} style={{fontSize:10,padding:"2px 7px",borderRadius:99,background:"#f1f5f9",color:"#64748b",border:"1px solid #e2e8f0"}}>{t}</span>
                                  ))}
                                </div>
                                {identKeys.length>0&&(
                                  <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                                    {identKeys.map(k=>(
                                      <span key={k} style={{fontSize:10,padding:"2px 7px",borderRadius:99,background:"#eff6ff",color:"#3b82f6",border:"1px solid #bfdbfe"}}>{k}: {String(identifiers[k])}</span>
                                    ))}
                                  </div>
                                )}
                                <div style={{fontSize:10,color:"#cbd5e1",marginTop:5}}>
                                  {item.rowVar?.col&&`Linhas: ${item.rowVar.col}${item.metadata?.variables?.rowLabel?` (${item.metadata.variables.rowLabel})`:''}`}
                                  {item.rowVar?.col&&item.colVar?.col&&' · '}
                                  {item.colVar?.col&&`Colunas: ${item.colVar.col}${item.metadata?.variables?.colLabel?` (${item.metadata.variables.colLabel})`:''}`}
                                  {(item.rowVar?.col||item.colVar?.col)&&' · '}
                                  Salvo em {new Date(item.savedAt).toLocaleDateString('pt-BR')}
                                </div>
                              </div>
                              {/* Actions */}
                              <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0}}>
                                <button onClick={()=>loadFromLibraryWithMapping(item)}
                                  style={{padding:"6px 14px",borderRadius:7,border:"1px solid #c7d2fe",background:"#eef2ff",color:"#4f46e5",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",fontWeight:600,whiteSpace:"nowrap"}}>
                                  + Adicionar ao Board
                                </button>
                                <button onClick={()=>deleteFromLibrary(item.id)}
                                  style={{padding:"5px 14px",borderRadius:7,border:"1px solid #fecaca",background:"#fff",color:"#dc2626",cursor:"pointer",fontSize:11,fontFamily:"inherit",fontWeight:500,whiteSpace:"nowrap"}}>
                                  Remover
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Footer */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 28px",borderTop:"1px solid #f1f5f9",flexShrink:0}}>
                {isSaveMode ? (
                  <>
                    <button onClick={()=>upd({mode:'browse'})}
                      style={{padding:"8px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#64748b",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
                      ← Voltar
                    </button>
                    <button onClick={saveToLibrary} disabled={!saveMeta.name.trim()}
                      style={{padding:"9px 22px",borderRadius:9,border:"none",background:saveMeta.name.trim()?"#4f46e5":"#c7d2fe",color:"#fff",cursor:saveMeta.name.trim()?"pointer":"not-allowed",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>
                      {overwriteId ? '🔄 Substituir' : '💾 Salvar na Biblioteca'}
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <span style={{fontSize:11.5,color:"#94a3b8"}}>{filteredItems.length} resultado{filteredItems.length!==1?'s':''}</span>
                      <button onClick={()=>libFileInputRef.current?.click()}
                        style={{padding:"6px 13px",borderRadius:7,border:"1px solid #e2e8f0",background:"#f8fafc",color:"#475569",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",fontWeight:500,display:"flex",alignItems:"center",gap:5}}>
                        ↑ Importar Biblioteca
                      </button>
                      {cinemaLibrary.length > 0 && (
                        <button onClick={exportLibrary}
                          style={{padding:"6px 13px",borderRadius:7,border:"1px solid #e2e8f0",background:"#f8fafc",color:"#475569",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",fontWeight:500,display:"flex",alignItems:"center",gap:5}}>
                          ↓ Exportar Biblioteca
                        </button>
                      )}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      {(cinemaLibraryModal.selectedLibIds||[]).length > 0 && (
                        <button onClick={()=>batchImportFromLibrary(cinemaLibraryModal.selectedLibIds||[])}
                          style={{padding:"9px 18px",borderRadius:9,border:"none",background:"#4f46e5",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",display:"flex",alignItems:"center",gap:6}}>
                          📥 Importar Selecionados ({(cinemaLibraryModal.selectedLibIds||[]).length})
                        </button>
                      )}
                      <button onClick={()=>setCinemaLibraryModal(null)}
                        style={{padding:"8px 20px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
                        Fechar
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
