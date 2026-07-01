import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList } from "recharts";
// Armazenamento colunar do csvStore (Otimização de Memória — Fase 1). O csvStore
// guarda as bases vetorizadas (Float64Array + dictionary encoding); todo acesso a
// célula passa pelo accessor abaixo, que também funciona sobre o legado string[][].
import { buildColumnar, rowCount, cellStr, cellNum, getRow, materializeRows, distinctColValues, serializeCsvStore, deserializeCsvStore, buildCsvStoreMessage } from "./columnar.js";

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
  { value:"mixRisco",      icon:"🎨", label:"Mix de Risco",       shortLabel:"Mix"      },
  { value:"temporal",      icon:"⏱", label:"Data/Tempo",         shortLabel:"Data"     },
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

// Abreviações de mês de 3 letras (SAS DDMONYYYY) — inglês e português, já que
// "JUN"/"JAN" coincidem nos dois idiomas mas MAI/ABR/AGO/SET/OUT/DEZ/FEV não
// são reconhecidos pelo Date.parse do JS (só entende abreviações em inglês).
const MONTH_ABBR = {
  jan:0, fev:1, feb:1, mar:2, abr:3, apr:3, mai:4, may:4, jun:5,
  jul:6, ago:7, aug:7, set:8, sep:8, out:9, oct:9, nov:10, dez:11, dec:11,
};

// Parse a temporal cell value into a sortable numeric key (UTC ms), or null if
// unparseable. Supports ISO (YYYY-MM-DD / YYYY-MM), BR (DD/MM/YYYY), compact
// (YYYYMMDD), SAS DDMONYYYY (ex: 10MAI2026), e um fallback via Date.parse.
// Usado para ordenar o eixo X cronologicamente.
function parseTemporalKey(str) {
  const s = String(str ?? "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);          // YYYY-MM-DD / YYYY-MM
  if (m) return Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);                  // DD/MM/YYYY
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return Date.UTC(y, +m[2] - 1, +m[1]); }
  m = s.match(/^(\d{4})(\d{2})(\d{2})?$/);                               // YYYYMMDD / YYYYMM
  if (m) return Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1);
  m = s.match(/^(\d{1,2})[-\s]?([A-Za-zÀ-ÿ]{3})[-\s]?(\d{2,4})$/);       // DDMONYYYY (SAS)
  if (m) {
    const mon = MONTH_ABBR[m[2].toLowerCase()];
    if (mon != null) { let y = +m[3]; if (y < 100) y += 2000; return Date.UTC(y, mon, +m[1]); }
  }
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}

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

// Versão assíncrona/chunked de parseCSV — cede a thread principal a cada lote
// de linhas (setTimeout 0) para não congelar a UI em bases grandes, e reporta
// progresso via onProgress(offset, total) (fração consumida do texto). Usada no
// carregamento de CSV (onFileChange/reparseWizardFile) para alimentar o modal
// de progresso.
//
// Otimização de memória (Fase 0): NÃO materializa `text.split(/\r?\n/)` — esse
// array de dezenas de milhões de strings dobrava o pico de RAM do parse. Aqui o
// texto é varrido por índice (`indexOf('\n')`) e cada linha é fatiada/parseada
// sob demanda, alimentando `rows` diretamente. O único array grande que
// sobrevive é o próprio `rows` (a saída). A referência ao `text` cru vive só na
// closure enquanto o parse roda e é solta assim que a Promise resolve.
function parseCSVAsync(text, delimiter, hasHeader, onProgress) {
  return new Promise((resolve, reject) => {
    try {
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
      const len = text.length;
      let pos = 0;
      // Avança até a próxima linha não-vazia a partir de `pos`, sem alocar o
      // array inteiro de linhas. Equivale a `split(/\r?\n/).filter(l=>l.trim())`:
      // quebra só em '\n', tira um '\r' final (suporta CRLF) e pula linhas em
      // branco. Retorna o conteúdo cru da linha ou null no fim do texto.
      const nextLine = () => {
        while (pos < len) {
          let nl = text.indexOf('\n', pos);
          if (nl === -1) nl = len;
          const start = pos;
          let end = nl;
          if (end > start && text.charCodeAt(end - 1) === 13) end--; // \r final
          pos = nl + 1;
          if (end > start) {
            const line = text.slice(start, end);
            if (line.trim()) return line;
          }
        }
        return null;
      };

      const firstLine = nextLine();
      if (firstLine === null) { resolve({ headers: [], rows: [] }); return; }
      const first = split(firstLine);
      const headers = hasHeader ? first : first.map((_,i)=>`Coluna ${i+1}`);
      const rows = [];
      if (!hasHeader) rows.push(first); // sem cabeçalho, a 1ª linha também é dado

      const CHUNK = 3000;
      let finished = false;
      const step = () => {
        let count = 0;
        while (count < CHUNK) {
          const line = nextLine();
          if (line === null) { finished = true; break; }
          rows.push(split(line));
          count++;
        }
        if (onProgress) onProgress(finished ? len : Math.min(pos, len), len);
        if (finished) resolve({ headers, rows });
        else setTimeout(step, 0);
      };
      step();
    } catch (err) { reject(err); }
  });
}

const tDist = (t) => { const dx=t[0].clientX-t[1].clientX,dy=t[0].clientY-t[1].clientY; return Math.sqrt(dx*dx+dy*dy); };
const trunc = (s, n) => s && s.length > n ? s.slice(0,n-1)+"…" : s;
// Estimativa de largura do label da seta (DM Sans ~11px) — usada para
// dimensionar a caixa do label e o vão nó↔ports no autoLayout.
const CONN_LABEL_CW = 6.6;   // avanço médio por caractere
const CONN_LABEL_MAX = 16;   // máximo de chars exibidos no label da seta
const estConnLabelW = (s) => {
  const t = trunc(s || "", CONN_LABEL_MAX);
  return t ? t.length * CONN_LABEL_CW : 0;
};
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

// ── Inferência de negados — indexação da Tabela de Referência (Fase 1) ──
// Lê o artefato do SAS (delimitador ';', decimal '.') e o indexa UMA vez na
// importação. Chaves, ordem de colapso e quantidade de níveis são derivados
// DINAMICAMENTE de `vars_usadas` + cabeçalho (nunca nomes hardcoded — ver
// CONTRATO_INFERENCIA.md §1 e Proposta §2). NÃO entra no csvStore.
// Nomes normalizados das colunas de metadados/métricas fixas do artefato:
const INF_META_NORMS = {
  nivel:  'nivel',
  confiab:'confiabilidade',
  conv:   'taxaconversaoref',
  fpd:    'taxafpdref',
  nAprov: 'naprovados',
  nConv:  'nconvertidos',
  nMaus:  'nmaus',
  vars:   'varsusadas',
};
export function indexInferenceRef(headers, rows, name) {
  const idxByNorm = {};
  headers.forEach((h, i) => { idxByNorm[normalizeColName(h)] = i; });
  const col = (norm) => (norm in idxByNorm ? idxByNorm[norm] : -1);

  const iNivel  = col(INF_META_NORMS.nivel);
  const iConf   = col(INF_META_NORMS.confiab);
  const iConv   = col(INF_META_NORMS.conv);
  const iFpd    = col(INF_META_NORMS.fpd);
  const iNAprov = col(INF_META_NORMS.nAprov);
  const iNConv  = col(INF_META_NORMS.nConv);
  const iNMaus  = col(INF_META_NORMS.nMaus);
  const iVars   = col(INF_META_NORMS.vars);

  const parseNum = (v) => { const n = parseFloat(String(v ?? '').trim()); return Number.isFinite(n) ? n : 0; };
  const parseIntSafe = (v) => { const n = parseInt(String(v ?? '').trim(), 10); return Number.isFinite(n) ? n : null; };

  // 1) keyCols: derivados da linha mais granular (maior `vars_usadas`).
  //    A ordem em `vars_usadas` é a ordem de colapso (a última variável cai
  //    primeiro), então keyCols[0] é a âncora (nunca colapsa).
  let keyCols = [];
  if (iVars >= 0) {
    for (const r of rows) {
      const raw = String(r[iVars] ?? '').trim();
      if (!raw || raw.toUpperCase() === 'GLOBAL') continue;
      const vs = raw.split(/\s+/).filter(Boolean);
      if (vs.length > keyCols.length) keyCols = vs;
    }
  }
  // Fallback (sem `vars_usadas`): tudo que não for coluna de metadado/métrica.
  if (keyCols.length === 0) {
    const metaNorms = new Set(Object.values(INF_META_NORMS));
    keyCols = headers.filter(h => !metaNorms.has(normalizeColName(h)));
  }
  const keyIdx = keyCols.map(k => col(normalizeColName(k)));
  const anchorCol = keyCols[0] || null;

  const levels = {};        // {[nivel]: Map<keyConcat, premissa>}
  const levelKeyCount = {}; // {[nivel]: nº de chaves usadas}
  let global = null;

  for (const r of rows) {
    const conf    = iConf >= 0 ? String(r[iConf] ?? '').trim() : '';
    const varsRaw = iVars >= 0 ? String(r[iVars] ?? '').trim() : '';
    const premissa = {
      conv:    iConv  >= 0 ? parseNum(r[iConv]) : 0,
      fpd:     iFpd   >= 0 ? parseNum(r[iFpd])  : 0,
      confiab: conf,
      nAprov:  iNAprov >= 0 ? parseIntSafe(r[iNAprov]) : null,
      nConv:   iNConv  >= 0 ? parseIntSafe(r[iNConv])  : null,
      nMaus:   iNMaus  >= 0 ? parseIntSafe(r[iNMaus])  : null,
    };
    const isGlobal = conf.toUpperCase() === 'GLOBAL' || varsRaw.toUpperCase() === 'GLOBAL';
    if (isGlobal) { global = premissa; continue; }

    // Quantas chaves este nível usa (prefixo de keyCols).
    let k;
    if (varsRaw) k = varsRaw.split(/\s+/).filter(Boolean).length;
    else {
      k = 0;
      for (let j = 0; j < keyIdx.length; j++) {
        const v = keyIdx[j] >= 0 ? String(r[keyIdx[j]] ?? '').trim() : '';
        if (v) k++; else break;
      }
    }
    if (k <= 0) { if (!global) global = premissa; continue; }

    const niv = iNivel >= 0 ? (parseIntSafe(r[iNivel]) ?? k) : k;
    if (!levels[niv]) { levels[niv] = new Map(); levelKeyCount[niv] = k; }
    const parts = [];
    for (let j = 0; j < k; j++) parts.push(keyIdx[j] >= 0 ? String(r[keyIdx[j]] ?? '').trim() : '');
    levels[niv].set(parts.join('|'), premissa);
  }

  return {
    name: name || 'inferencia_ref',
    importedAt: new Date().toISOString(),
    keyCols,
    anchorCol,
    levels,
    global,
    levelKeyCount,
    rowCount: rows.length,
  };
}

// ── Serialização do índice de inferência (Salvar/Abrir Projeto) ──────────────
// `inferenceRef.levels` é `{[nivel]: Map}` — JSON não serializa Map, então
// convertemos para arrays de entradas na exportação e reconstruímos na carga.
export function serializeInferenceRef(ref) {
  if (!ref) return null;
  const levels = {};
  for (const [niv, map] of Object.entries(ref.levels || {})) {
    levels[niv] = map instanceof Map ? Array.from(map.entries()) : map;
  }
  return { ...ref, levels };
}

export function deserializeInferenceRef(ser) {
  if (!ser) return null;
  const levels = {};
  for (const [niv, entries] of Object.entries(ser.levels || {})) {
    levels[niv] = entries instanceof Map ? entries : new Map(entries || []);
  }
  return { ...ser, levels };
}

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

function rowMatchesLensRules(csv, r, rules) {
  if (!rules || rules.length === 0) return true;
  const headers = csv.headers;
  let result = null;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const colIdx = headers.indexOf(rule.col);
    const cellVal = colIdx >= 0 ? (cellStr(csv, r, colIdx) ?? "") : "";
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
    const n = rowCount(csv);
    for (let r = 0; r < n; r++) {
      const qty = qtyIdx >= 0 ? (cellNum(csv, r, qtyIdx) || 1) : 1;
      total += qty;
      if (rowMatchesLensRules(csv, r, rules)) count += qty;
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
    const n = rowCount(csv);
    const arr = new Array(n);
    for (let r = 0; r < n; r++) arr[r] = rowMatchesLensRules(csv, r, rules);
    result[csvId] = arr;
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

  function traverseRow(csv, r, startId) {
    const headers = csv.headers;
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
        const val = (ci >= 0 ? (cellStr(csv, r, ci) ?? '') : '').trim();
        stops.push({ nodeId: cur, val, nodeName: getNodeLabel(node) });
        const match = (out[cur] || []).find(e => (e.label ?? '').trim() === val);
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const ri = node.rowVar ? headers.indexOf(node.rowVar.col) : -1;
        const ci = node.colVar ? headers.indexOf(node.colVar.col) : -1;
        const rv = node.rowVar && ri >= 0 ? (cellStr(csv, r, ri) ?? '').trim() : '*';
        const cv = node.colVar && ci >= 0 ? (cellStr(csv, r, ci) ?? '').trim() : '*';
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

    const nRows = rowCount(csv);
    for (let r = 0; r < nRows; r++) {
      const qty = qtyIdx >= 0 ? (cellNum(csv, r, qtyIdx) || 0) : 1;
      const qtdAltas = qtdAltasIdx >= 0 ? (cellNum(csv, r, qtdAltasIdx) || 0) : 0;
      const qtdAltasInfer = qtdAltasInferIdx >= 0 ? (cellNum(csv, r, qtdAltasInferIdx) || 0) : 0;
      const inadR = inadRealIdx >= 0 ? (cellNum(csv, r, inadRealIdx) || 0) : 0;
      const inadI = inadInferidaIdx >= 0 ? (cellNum(csv, r, inadInferidaIdx) || 0) : 0;
      totalQty += qty;

      const { stops, result } = traverseRow(csv, r, rootId);
      let isApproved = result === 'approved';
      let isRejected = result === 'rejected';
      if (result === 'as_is') {
        const orig = dOrigIdx >= 0 ? String(cellStr(csv, r, dOrigIdx) ?? '').toUpperCase() : '';
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

// Métricas intrínsecas do agrupamento exportadas no dataset largo (DEC-AW-003).
const ANALYTICS_EXPORT_METRICS = [
  { key: "qty",           label: "Vol. Propostas" },
  { key: "qtdAltas",      label: "Altas Reais" },
  { key: "qtdAltasInfer", label: "Conv. Inferida" },
  { key: "inadRRaw",      label: "Inad. Real (num)" },
  { key: "inadIRaw",      label: "Inad. Inferida (num)" },
];

// Serializa o dataset analítico largo como CSV: dimensões + métricas intrínsecas +
// uma coluna de decisão por cenário (AS IS + cada aba marcada). Excel-friendly (5C).
export function buildAnalyticsCSV(ds) {
  if (!ds || !Array.isArray(ds.rows) || ds.rows.length === 0) return null;
  const dimensions = ds.dimensions || [];
  const scenarios = ds.scenarios || [];
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const header = [
    ...dimensions,
    ...ANALYTICS_EXPORT_METRICS.map(m => m.label),
    ...scenarios.map(s => `Decisão · ${s.nome}`),
  ];
  const lines = ds.rows.map(r => [
    ...dimensions.map(d => r[d]),
    ...ANALYTICS_EXPORT_METRICS.map(m => r[m.key]),
    ...scenarios.map(s => r[s.decisionCol]),
  ].map(esc).join(","));
  return [header.map(esc).join(","), ...lines].join("\n");
}

function exportAnalyticsDatasetCSV(ds) {
  const csv = buildAnalyticsCSV(ds);
  if (!csv) return;
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `analytics_cenarios_${new Date().toISOString().slice(0,10)}.csv`;
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

// Resolve quais valores de um domínio devem ser exibidos num nó ("Configurar nó").
// cfg === null/undefined → modo automático (só valores com volume > 0 no contexto
// atual; fallback para o domínio completo se nada chega ainda — ex.: nó sem upstream).
// cfg === string[] → modo manual (exibe exatamente esses, na ordem do domínio).
// Em ambos os modos, se o resultado ficar vazio cai para o domínio completo, para
// nunca renderizar um nó sem nenhuma linha/coluna/port.
function effectiveDomain(fullDomain, cfg, counts) {
  if (Array.isArray(cfg)) {
    const set = new Set(cfg);
    const filtered = fullDomain.filter(v => set.has(v));
    return filtered.length > 0 ? filtered : fullDomain;
  }
  if (!counts) return fullDomain;
  const withVol = fullDomain.filter(v => (counts[v] || 0) > 0);
  return withVol.length > 0 ? withVol : fullDomain;
}

function buildProposedByShape(poolCells, shapeMetas, pooledMetrics) {
  const result = {};
  for (const meta of shapeMetas) {
    const rDom = meta.rowDomain.length > 0 ? meta.rowDomain : ['*'];
    const cDom = meta.colDomain.length > 0 ? meta.colDomain : ['*'];
    const sc = {};
    for (const rv of rDom)
      for (const cv of cDom) {
        const ck = `${rv}|${cv}`;
        const pk = `${meta.id}|${ck}`;
        // Cells with no data are not in pooledMetrics; preserve original eligibility
        // rather than forcing ineligible, which would corrupt the Cineminha visually.
        if (pooledMetrics && !(pk in pooledMetrics)) {
          sc[ck] = isCellEligible(meta.originalCells || {}, ck) ? 1 : 0;
        } else {
          sc[ck] = poolCells[pk] === true ? 1 : 0;
        }
      }
    result[meta.id] = sc;
  }
  return result;
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
  const nRows = rowCount(csv);
  for (let r = 0; r < nRows; r++) {
    const rv = rowVar && rowCI >= 0 ? (cellStr(csv, r, rowCI) ?? '').toString().trim() : '*';
    const cv = colVar && colCI >= 0 ? (cellStr(csv, r, colCI) ?? '').toString().trim() : '*';
    const key = `${rv}|${cv}`;
    if (lookup[key] === undefined) {
      const raw = cellStr(csv, r, resultColIdx);
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

// ── Sinalização de inferência por referência (Fase 3 / Proposta §4.5, CONTRATO §7) ──
// Selo discreto de origem + indicador "% do volume inferido com confiab ALTA" com
// alerta visual quando uma fatia relevante herdou premissa colapsada (caso PAP §7).
// Renderiza um <div> — funciona tanto dentro de foreignObject (simPanel) quanto no
// businessWidget. `scale` reaproveita o fator de escala do contexto (1 = padrão).
function InferenceSignal({ source, confiabVolume, weightMode, scale = 1 }) {
  if (source !== 'ref') return null;
  const s = (v) => v * scale;

  const BUCKETS = [
    { key: 'ALTA',   label: 'Alta',   color: '#4ade80' },
    { key: 'MEDIA',  label: 'Média',  color: '#fbbf24' },
    { key: 'BAIXA',  label: 'Baixa',  color: '#fb923c' },
    { key: 'GLOBAL', label: 'Global', color: '#f87171' },
  ];
  const cv = confiabVolume || {};
  const total = BUCKETS.reduce((a, b) => a + (cv[b.key] || 0), 0);
  const present = BUCKETS.filter(b => (cv[b.key] || 0) > 0);
  const alta = cv.ALTA || 0;
  const pctAlta = total > 0 ? alta / total : null;
  // ≥80% ALTA = ok; 50–80% atenção; <50% alerta (fatia relevante herdou premissa colapsada).
  const low = pctAlta !== null && pctAlta < 0.5;
  const mid = pctAlta !== null && pctAlta >= 0.5 && pctAlta < 0.8;
  const accent = pctAlta === null ? '#64748b' : low ? '#f87171' : mid ? '#fbbf24' : '#4ade80';
  const tone = low ? { bg: 'rgba(248,113,113,0.07)', border: 'rgba(248,113,113,0.45)' }
            : mid  ? { bg: 'rgba(251,191,36,0.07)',  border: 'rgba(251,191,36,0.40)' }
                   : { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.07)' };

  // Base de peso (Fase 4): selo discreto para não confundir a leitura do número.
  const wmLabel = weightMode === 'aprovados' ? 'Aprovados' : weightMode === 'misto' ? 'Misto' : 'Propostas';
  const wmTitle = weightMode === 'aprovados'
    ? 'Peso = volume de aprovados — leitura "FPD sobre aprovados".'
    : weightMode === 'misto'
    ? 'Estudos com bases de peso diferentes (propostas e aprovados).'
    : 'Peso = volume total de propostas — leitura "abrir para os reprovados".';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: s(6) }}>
      {/* Selos: origem + base de peso */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: s(4) }}>
        <span title="As taxas de conversão/inadimplência vêm da Tabela de Referência (lookup em cascata), não de colunas da base."
          style={{ display: 'inline-flex', alignItems: 'center', gap: s(4), fontSize: s(8), fontWeight: 700, padding: `${s(2)}px ${s(8)}px`, borderRadius: s(20), background: 'rgba(129,140,248,0.15)', color: '#a5b4fc', letterSpacing: '0.03em' }}>
          🧮 Inferência: Tabela de referência
        </span>
        <span title={wmTitle}
          style={{ display: 'inline-flex', alignItems: 'center', gap: s(4), fontSize: s(8), fontWeight: 700, padding: `${s(2)}px ${s(8)}px`, borderRadius: s(20), background: 'rgba(148,163,184,0.14)', color: '#cbd5e1', letterSpacing: '0.03em' }}>
          ⚖️ Peso: {wmLabel}
        </span>
      </div>

      {/* Indicador de confiabilidade */}
      {total > 0 && (
        <div style={{ background: tone.bg, border: `1px solid ${tone.border}`, borderRadius: s(8), padding: `${s(7)}px ${s(9)}px` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: s(5) }}>
            <span style={{ fontSize: s(8), color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Confiab. da Inferência</span>
            <span style={{ fontSize: s(14), fontWeight: 800, color: accent, lineHeight: 1 }}>
              {(pctAlta * 100).toFixed(0)}%<span style={{ fontSize: s(7.5), color: '#64748b', fontWeight: 700, marginLeft: s(3) }}>ALTA</span>
            </span>
          </div>
          {/* Barra empilhada por faixa de confiab */}
          <div style={{ display: 'flex', height: s(5), borderRadius: s(3), overflow: 'hidden', background: 'rgba(255,255,255,0.05)' }}>
            {BUCKETS.map(b => {
              const v = cv[b.key] || 0;
              if (!(v > 0)) return null;
              return <div key={b.key} title={`${b.label}: ${(v / total * 100).toFixed(1)}% do volume inferido`} style={{ width: `${(v / total) * 100}%`, background: b.color }} />;
            })}
          </div>
          {/* Legenda das faixas presentes */}
          {present.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: s(8), marginTop: s(5) }}>
              {present.map(b => (
                <span key={b.key} style={{ display: 'inline-flex', alignItems: 'center', gap: s(3), fontSize: s(7.5), color: '#94a3b8', fontWeight: 600 }}>
                  <span style={{ width: s(6), height: s(6), borderRadius: s(2), background: b.color, display: 'inline-block' }} />
                  {b.label} {(cv[b.key] / total * 100).toFixed(0)}%
                </span>
              ))}
            </div>
          )}
          {(low || mid) && (
            <div style={{ fontSize: s(7.5), color: low ? '#fca5a5' : '#fcd34d', marginTop: s(5), lineHeight: 1.35 }}>
              {low ? '⚠' : '⚡'} {((1 - pctAlta) * 100).toFixed(0)}% do volume inferido herdou premissa colapsada (≠ ALTA).
              {low
                ? ' Cuidado com células de baixa amostra — ex.: canal PAP. Leia o número como estimativa, não como certo.'
                : ' Parte da inferência veio de níveis mais gerais (ex.: canal PAP). Trate como aproximação.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
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

// ── Analytics Workspace (Sessão 2: builder configurável) ─────────────────────
const SCENARIO_COLORS = ["#94a3b8", "#2563eb", "#16a34a", "#d97706", "#9333ea"];
const SERIE_COLORS = ["#2563eb", "#16a34a", "#d97706", "#9333ea", "#dc2626", "#0891b2", "#db2777", "#65a30d", "#7c3aed", "#ea580c", "#0d9488", "#be123c"];
const MAX_SERIES = 12; // teto de séries ao quebrar por dimensão categórica
const AW_DRAG_MIME = "application/aw-field";

// Sentinelas de "série por": cenário (AS IS vs Simulado) ou nenhuma (linha única).
const SERIE_CENARIO = "__cenario__";
const SERIE_NONE = "__none__";
// Sentinela de "eixo X por cenário": cada aba vira um bucket no X.
const XDIM_CENARIO = "__x_cenario__";

// Tipos de gráfico (Sessão 3). 'line' e 'bar'/'bar100' usam o pivot tidy; 'kpi' é pontual.
const CHART_TYPES = [
  { id: "line",   icon: "📈", label: "Linha" },
  { id: "bar",    icon: "📊", label: "Barras" },
  { id: "bar100", icon: "🧱", label: "100%" },
  { id: "kpi",    icon: "🔢", label: "KPI" },
];
// Métricas em que "menor é melhor" — orienta a cor do delta no KPI.
const GOOD_WHEN_LOWER = new Set(["inadReal", "inadInferida"]);

// Agrega uma métrica sobre um conjunto de linhas (formato largo) para uma coluna de decisão.
// Replica a semântica do motor: numeradores/denominadores acumulados apenas sobre aprovados.
export function computeWidgetMetric(rows, metricId, decisionCol) {
  let total = 0, appr = 0, inadR = 0, altas = 0, inadI = 0, altasInf = 0;
  for (const r of rows) {
    const q = r.qty || 0;
    total += q;
    if (r[decisionCol] === "APROVADO") {
      appr += q;
      inadR += r.inadRRaw || 0;
      altas += r.qtdAltas || 0;
      inadI += r.inadIRaw || 0;
      altasInf += r.qtdAltasInfer || 0;
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

const fmtMetricVal = (v, unit) => v == null ? "N/A" : unit === "qty" ? fmtQty(v) : `${v.toFixed(1)}%`;

// Pivot client-side: dataset largo + config → série tidy {data, series, metricDef, xCol}.
export function pivotWidget(ds, config) {
  if (!ds) return { state: "no_data" };
  const { rows, scenarios, metrics, temporalColumns } = ds;
  const xCol = config.xDimension;
  if (!xCol) return { state: "no_x" };
  const metricDef = metrics.find(m => m.id === config.metric) || metrics[0];
  if (!metricDef) return { state: "no_metric" };
  const serieBy = config.serieBy || SERIE_CENARIO;

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
      const distinct = [...new Set(rows.map(r => String(r[serieBy] ?? "").trim()).filter(Boolean))].sort(makeCmp(serieBy));
      const capped = distinct.slice(0, MAX_SERIES);
      truncated = capped.length >= MAX_SERIES && distinct.length > MAX_SERIES;
      seriesDefs = capped.map((v, i) => ({ key: v, label: v, filterCol: serieBy, filterVal: v, color: SERIE_COLORS[i % SERIE_COLORS.length] }));
    }

    const data = visScenarios.map((s) => {
      const row = { x: s.nome };
      for (const sd of seriesDefs) {
        const subset = sd.filterCol ? rows.filter(r => String(r[sd.filterCol] ?? "").trim() === sd.filterVal) : rows;
        row[sd.label] = computeWidgetMetric(subset, metricDef.id, s.decisionCol);
      }
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
    // Quebra por dimensão categórica usando o cenário Simulado implícito.
    const simCol = (scenarios.find(s => s.id === "simulado") || scenarios[scenarios.length - 1]).decisionCol;
    if (serieBy === SERIE_NONE) {
      seriesDefs = [{ key: "simulado", label: "Simulado", decisionCol: simCol, color: SCENARIO_COLORS[1] }];
    } else {
      const distinct = [...new Set(rows.map(r => String(r[serieBy] ?? "").trim()).filter(Boolean))].sort(makeCmp(serieBy));
      const capped = distinct.slice(0, MAX_SERIES);
      seriesDefs = capped.map((v, i) => ({ key: v, label: v, decisionCol: simCol, filterCol: serieBy, filterVal: v, color: SERIE_COLORS[i % SERIE_COLORS.length] }));
    }
  }

  // Buckets do eixo X.
  const xBuckets = new Map();
  for (const r of rows) {
    const xv = String(r[xCol] ?? "").trim();
    if (!xv) continue;
    if (!xBuckets.has(xv)) xBuckets.set(xv, []);
    xBuckets.get(xv).push(r);
  }
  if (xBuckets.size === 0) return { state: "empty" };

  const isTemporal = (temporalColumns || []).includes(xCol);
  const xCmp = makeCmp(xCol);
  const sortedKeys = [...xBuckets.keys()].sort((a, b) => {
    if (isTemporal) {
      const ka = parseTemporalKey(a), kb = parseTemporalKey(b);
      if (ka != null && kb != null) return ka - kb;
      if (ka != null) return -1;
      if (kb != null) return 1;
    }
    return xCmp(a, b);
  });

  const data = sortedKeys.map((xv) => {
    const bucketRows = xBuckets.get(xv);
    const row = { x: xv };
    for (const sd of seriesDefs) {
      const subset = sd.filterCol ? bucketRows.filter(r => String(r[sd.filterCol] ?? "").trim() === sd.filterVal) : bucketRows;
      row[sd.label] = computeWidgetMetric(subset, metricDef.id, sd.decisionCol);
    }
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
export function newFilterCard() {
  return { id: uid(), dim: null, mode: "basic", selected: null, rules: [] };
}

function filterCardActive(card) {
  if (!card || !card.dim) return false;
  if (card.mode === "advanced") return (card.rules || []).some(r => String(r.value ?? "").trim());
  return Array.isArray(card.selected);
}

function filterCardMatches(row, card) {
  const val = String(row[card.dim] ?? "").trim();
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

// Filtra as linhas do dataset largo pelos cartões de filtro ativos (AND entre todos os cartões).
export function applyAnalyticsFilters(rows, cards) {
  const active = (cards || []).filter(filterCardActive);
  if (active.length === 0) return rows;
  return rows.filter(r => active.every(c => filterCardMatches(r, c)));
}

// Combina filtro de página + filtro do visual (AND) sobre o dataset largo — o visual
// recorta em cima da visão que já chega filtrada pela página. Ignora cartões cuja
// dimensão não existe mais no dataset atual (base trocada/agrupamento removido).
export function applyFiltersToDataset(ds, pageFilters, widgetFilters) {
  if (!ds) return ds;
  const validDims = new Set(ds.dimensions || []);
  const cards = [...(pageFilters || []), ...(widgetFilters || [])].filter(c => c && validDims.has(c.dim));
  const rows = applyAnalyticsFilters(ds.rows, cards);
  return rows === ds.rows ? ds : { ...ds, rows };
}

// ── Agrupamentos (dimensões derivadas) ───────────────────────────────────────
// Um agrupamento colapsa os valores de uma dimensão-base (ex.: FAIXA_SCORE R01–R20)
// em poucos buckets reutilizáveis. Vira uma dimensão derivada usável em qualquer
// gráfico (Eixo X / Série / KPI), no export CSV e salva no projeto.
const GROUPING_OTHER_DEFAULT = "Outros";

// Ordena valores distintos de uma coluna (numérico crescente, senão A-Z pt-BR).
function sortDistinctValues(values) {
  return [...values].sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b), "pt-BR");
  });
}

// Valores distintos de uma dimensão a partir das linhas do dataset (ordenados).
export function distinctDimValues(ds, col) {
  if (!ds || !col) return [];
  const set = new Set();
  for (const r of ds.rows) { const v = String(r[col] ?? "").trim(); if (v) set.add(v); }
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

  const augmenters = valid.map(g => {
    const map = new Map();
    for (const b of (g.buckets || [])) for (const v of (b.values || [])) map.set(String(v), b.label);
    const keepOriginal = g.unmatched === "keep";
    const otherLabel = keepOriginal ? null : (g.otherLabel || GROUPING_OTHER_DEFAULT);
    const order = (g.buckets || []).map(b => b.label);
    if (otherLabel && !order.includes(otherLabel)) order.push(otherLabel);
    return { key: g.name, source: g.source, map, otherLabel, order };
  });

  const rows = ds.rows.map(r => {
    const out = { ...r };
    for (const a of augmenters) {
      const sv = String(r[a.source] ?? "").trim();
      const lbl = a.map.get(sv);
      out[a.key] = lbl != null ? lbl : (a.otherLabel != null ? a.otherLabel : sv);
    }
    return out;
  });

  const dimensions = [...(ds.dimensions || [])];
  const dimensionOrders = { ...(ds.dimensionOrders || {}) };
  const groupedDimensions = [...(ds.groupedDimensions || [])];
  for (const a of augmenters) {
    if (!dimensions.includes(a.key)) dimensions.push(a.key);
    if (!groupedDimensions.includes(a.key)) groupedDimensions.push(a.key);
    // Mantém só os labels efetivamente presentes nas linhas, preservando a ordem.
    const present = new Set(rows.map(r => r[a.key]));
    dimensionOrders[a.key] = a.order.filter(l => present.has(l));
  }
  return { ...ds, rows, dimensions, dimensionOrders, groupedDimensions };
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

// ── KpiCard — indicador pontual comparando dois cenários (A vs B, DEC-AW-008) ──
function KpiCard({ analyticsDataset, metricId, kpiA, kpiB, onChange }) {
  const kpi = useMemo(() => {
    if (!analyticsDataset) return null;
    const { rows, scenarios, metrics } = analyticsDataset;
    const md = metrics.find(m => m.id === metricId) || metrics[0];
    if (!md) return null;
    const { a, b } = resolveKpiScenarios(scenarios, kpiA, kpiB);
    return {
      metricDef: md,
      aScen: a, bScen: b,
      aVal: a ? computeWidgetMetric(rows, md.id, a.decisionCol) : null,
      bVal: b ? computeWidgetMetric(rows, md.id, b.decisionCol) : null,
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
function AnalyticsWidget({ widget, analyticsDataset, pageFilters = [], onConfigChange, onTypeChange, onDelete, onDragStart, onResizeStart }) {
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
function AnalysisTab({ analyticsDataset, baseDataset, analyticsLayout, setAnalyticsLayout, groupings, setGroupings, pageFilters, setPageFilters }) {
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

  const addWidget = () => setAnalyticsLayout(prev => [...prev, makeWidget("Novo gráfico")]);
  const removeWidget = (id) => setAnalyticsLayout(prev => prev.filter(w => w.id !== id));
  const changeConfig = (id, patch) => setAnalyticsLayout(prev => prev.map(w => w.id === id ? { ...w, config: { ...w.config, ...patch } } : w));
  const changeType = (id, type) => setAnalyticsLayout(prev => prev.map(w => w.id === id ? { ...w, type } : w));

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
    dragRef.current = { id, type, dir, startX: e.clientX, startY: e.clientY, startWx: wgt.x ?? 24, startWy: wgt.y ?? 24, startW: wgt.w ?? 560, startH: wgt.h ?? 500 };
    const onMove = (ev) => {
      const dr = dragRef.current; if (!dr) return;
      const dx = ev.clientX - dr.startX, dy = ev.clientY - dr.startY;
      if (dr.type === 'move') {
        setAnalyticsLayout(prev => prev.map(w => w.id === dr.id ? { ...w, x: Math.max(0, dr.startWx + dx), y: Math.max(0, dr.startWy + dy) } : w));
      } else {
        const d = dr.dir;
        let nx = dr.startWx, ny = dr.startWy, nw = dr.startW, nh = dr.startH;
        if (d.includes('e')) nw = Math.min(1200, Math.max(340, dr.startW + dx));
        if (d.includes('s')) nh = Math.min(900, Math.max(340, dr.startH + dy));
        if (d.includes('w')) { nw = Math.min(1200, Math.max(340, dr.startW - dx)); nx = Math.max(0, dr.startWx + dr.startW - nw); }
        if (d.includes('n')) { nh = Math.min(900, Math.max(340, dr.startH - dy)); ny = Math.max(0, dr.startWy + dr.startH - nh); }
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
                <div key={w.id} style={{ position: "absolute", left: w.x ?? 24, top: w.y ?? 24, width: w.w ?? 560, height: w.h ?? 500 }}>
                  <AnalyticsWidget widget={w} analyticsDataset={analyticsDataset} pageFilters={pageFilters}
                    onConfigChange={changeConfig} onTypeChange={changeType} onDelete={removeWidget}
                    onDragStart={(e) => startWidgetInteract(w.id, e, 'move', null)}
                    onResizeStart={(e, dir) => startWidgetInteract(w.id, e, 'resize', dir)} />
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

// ── Multi-canvas store helpers (DEC-AW-007) ─────────────────────────────────
const CANVAS_STORAGE_KEY = 'aw_canvases_v1';

// Cached init — parsed once, shared by canvases / activeCanvasId / shapes / conns initializers
let _canvasInitCache = null;
function _initCanvasStore() {
  if (_canvasInitCache) return _canvasInitCache;
  try {
    const s = sessionStorage.getItem(CANVAS_STORAGE_KEY);
    if (s) {
      const p = JSON.parse(s);
      if (p?.canvases && p?.activeCanvasId && p.canvases[p.activeCanvasId]) {
        _canvasInitCache = { canvases: p.canvases, activeCanvasId: p.activeCanvasId };
        return _canvasInitCache;
      }
    }
  } catch {}
  const id = uid();
  _canvasInitCache = {
    canvases: { [id]: { id, name: 'Canvas 1', shapes: [], conns: [], includeInDashboard: true } },
    activeCanvasId: id,
  };
  return _canvasInitCache;
}

// Clones shapes + conns replacing all IDs — used in canvas duplication
export function cloneCanvasWithNewIds(shapes, conns) {
  const idMap = {};
  for (const s of shapes) idMap[s.id] = uid();
  const newShapes = shapes.map(s => ({ ...s, id: idMap[s.id] }));
  const newConns  = conns.map(c => ({
    ...c, id: uid(),
    from: idMap[c.from] ?? c.from,
    to:   idMap[c.to]   ?? c.to,
  }));
  return { newShapes, newConns };
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [shapes, setShapes] = useState(() => {
    const init = _initCanvasStore();
    return init.canvases[init.activeCanvasId]?.shapes ?? [];
  });
  const [conns,   setConns]   = useState(() => {
    const init = _initCanvasStore();
    return init.canvases[init.activeCanvasId]?.conns ?? [];
  });
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
  const [importLoading, setImportLoading] = useState(null); // null | {phase:'reading'|'parsing', pct, filename} — progresso de carga/parse de CSV
  const [csvImportError, setCsvImportError] = useState(null); // string | null — erro ao carregar/processar uma base CSV
  // Inferência de negados — Tabela de Referência (Fase 1, slot dedicado)
  const [inferenceRef, setInferenceRef] = useState(null); // null | índice da tabela (ver indexInferenceRef / Proposta §4.1)
  const [infRefError,  setInfRefError]  = useState(null); // string | null — erro de importação da tabela de referência
  // Analytics Workspace
  const [activeTab,  setActiveTab]  = useState("canvas"); // "analysis" | "canvas"
  const [analyticsDataset, setAnalyticsDataset] = useState(null); // wide dataset cacheado do worker
  const [analyticsLayout, setAnalyticsLayout] = useState(() => { try { const s = sessionStorage.getItem('aw_layout_v1'); return s ? JSON.parse(s) : []; } catch { return []; } }); // WidgetConfig[] — gráficos do dashboard
  const [analyticsGroupings, setAnalyticsGroupings] = useState(() => { try { const s = sessionStorage.getItem('aw_groupings_v1'); return s ? JSON.parse(s) : []; } catch { return []; } }); // Grouping[] — dimensões derivadas reutilizáveis
  const [analyticsPageFilters, setAnalyticsPageFilters] = useState(() => { try { const s = sessionStorage.getItem('aw_page_filters_v1'); return s ? JSON.parse(s) : []; } catch { return []; } }); // FilterCard[] — filtro de página do Dashboard (aplica-se a todos os gráficos)
  // Dataset enriquecido com as dimensões derivadas (agrupamentos) — consumido pela aba Dashboard.
  const groupedDataset = useMemo(() => applyGroupingsToDataset(analyticsDataset, analyticsGroupings), [analyticsDataset, analyticsGroupings]);
  // Multi-canvas store (DEC-AW-007) — shapes/conns above are the working copy of the active canvas
  const [canvases, setCanvases] = useState(() => _initCanvasStore().canvases);
  const [activeCanvasId, setActiveCanvasId] = useState(() => _initCanvasStore().activeCanvasId);
  const [renamingCanvasId, setRenamingCanvasId] = useState(null); // id being renamed inline
  const [renameValue, setRenameValue] = useState('');
  const [canvasTabMenu, setCanvasTabMenu] = useState(null); // null | {canvasId, x, y}
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
  const [panelCollapsed, setPanelCollapsed] = useState(false); // painel direito colapsado
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
  const [optimModal,  setOptimModal]  = useState(null);   // null | optim obj
  // Johnny multi-cineminha optimizer modal
  const [johnnyModal, setJohnnyModal] = useState(null);   // null | johnny obj
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
  const projectInputRef = useRef(null);
  const infRefInputRef = useRef(null);
  // Feedback transitório do "Salvar Projeto" — null | {kind:'ok'|'err', msg}
  const [projectSaveNotice, setProjectSaveNotice] = useState(null);
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
  const inferenceRefR = useRef(inferenceRef); useEffect(()=>{inferenceRefR.current=inferenceRef},[inferenceRef]);
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
  const johnnyModalR  = useRef(johnnyModal);useEffect(()=>{johnnyModalR.current=johnnyModal},[johnnyModal]);
  const businessWidgetR = useRef(businessWidget); useEffect(()=>{businessWidgetR.current=businessWidget},[businessWidget]);
  const cinemaLibraryR  = useRef(cinemaLibrary);  useEffect(()=>{cinemaLibraryR.current=cinemaLibrary}, [cinemaLibrary]);
  const canvasesR       = useRef(canvases);        useEffect(()=>{canvasesR.current=canvases},         [canvases]);
  const activeCanvasIdR = useRef(activeCanvasId);  useEffect(()=>{activeCanvasIdR.current=activeCanvasId},[activeCanvasId]);
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
        setIncrementalResult(e.data.incrementalResult);
        setNodeArrivals(e.data.nodeArrivals || {});
      } else if (msgType === 'ANALYTICS_RESULT') {
        setAnalyticsDataset(e.data.dataset);
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
      } else if (msgType === 'JOHNNY_RESULT') {
        if (e.data.error) return;
        const { pooledMetrics, frontier, scenarios, mixCats, shapeMetas,
                baselineApprovalRate, maxInadReal, maxInadInf } = e.data;
        const initPt = scenarios?.melhorEficiencia || frontier[Math.floor(frontier.length / 2)];
        const initIdx = Math.max(0, frontier.indexOf(initPt));
        // Preserve user-set riskLevels/hierarchyMode/inadMetric on recalculation;
        // use defaults only on fresh open (modal was null).
        setJohnnyModal(prev => ({
          pooledMetrics, frontier, scenarios, mixCats, shapeMetas,
          baselineApprovalRate,
          activeCard:         'melhorEficiencia',
          proposedByShape:    buildProposedByShape(initPt?.cells || {}, shapeMetas, pooledMetrics),
          sliderApprovalIdx:  initIdx,
          sliderInadReal:     maxInadReal || 0.2,
          sliderInadInf:      maxInadInf  || 0.2,
          maxInadReal:        maxInadReal || 0.2,
          maxInadInf:         maxInadInf  || 0.2,
          activeShapePreview: prev?.activeShapePreview ?? (shapeMetas[0]?.id || null),
          riskLevels:    prev?.riskLevels    ?? Object.fromEntries(shapeMetas.map((m, i) => [m.id, i + 1])),
          hierarchyMode: prev?.hierarchyMode ?? 'cascata',
          inadMetric:    prev?.inadMetric    ?? 'inferida',
        }));
      }
    };
    return () => worker.terminate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep worker's csvStore in sync — send once per csvStore change (no debounce
  // needed here: UPDATE_CSV_STORE is lightweight and must arrive before any
  // subsequent RUN_SIMULATION / COMPUTE_OVERLAY that references the new data).
  //
  // Fase 2 — transferência sem cópia: `buildCsvStoreMessage` monta o payload e a
  // lista de transferables. Sob cross-origin isolation as colunas são SAB-backed e o
  // structured clone COMPARTILHA a memória (sem duplicar a base no worker); a lista de
  // transfer é vazia de propósito — SAB não é transferido/neutralizado, é lido pelos
  // dois lados (a main segue usando o csvStore para render). Ver columnar.js.
  useEffect(() => {
    const w = workerRef.current;
    if (!w) return;
    const { payload, transfer } = buildCsvStoreMessage(csvStore);
    w.postMessage(payload, transfer);
  }, [csvStore]);

  // Espelha a Tabela de Inferência no worker (Fase 2) — análogo ao UPDATE_CSV_STORE.
  // O structured clone do postMessage preserva os Maps de `inferenceRef.levels`.
  useEffect(() => {
    workerRef.current?.postMessage({ type: 'UPDATE_INFERENCE_REF', inferenceRef });
  }, [inferenceRef]);

  // ── Simulation engine (reactive) ──────────────────────────────
  const flowErrors = useMemo(() => validateFlow(shapes, conns), [shapes, conns]);
  const [simResult, setSimResult] = useState(() => ({ totalQty:0, approvedQty:0, rejectedQty:0, asIsQty:0, approvalRate:0, inadReal:null, inadInferida:null, edgeStats:{}, inferenceSource:null, confiabVolume:null, inferenceWeightMode:null }));
  // Espelhos para o autoLayout medir os "balões" das arestas sem closure stale.
  const simResultR        = useRef(simResult);        useEffect(()=>{simResultR.current=simResult},               [simResult]);
  const showEdgeVolR      = useRef(showEdgeVol);       useEffect(()=>{showEdgeVolR.current=showEdgeVol},           [showEdgeVol]);
  const showEdgeInadRealR = useRef(showEdgeInadReal);  useEffect(()=>{showEdgeInadRealR.current=showEdgeInadReal}, [showEdgeInadReal]);
  const showEdgeInadInfR  = useRef(showEdgeInadInf);   useEffect(()=>{showEdgeInadInfR.current=showEdgeInadInf},   [showEdgeInadInf]);
  const simDebounceRef = useRef(null);
  useEffect(() => {
    clearTimeout(simDebounceRef.current);
    simDebounceRef.current = setTimeout(() => {
      workerRef.current?.postMessage({ type: 'RUN_SIMULATION', shapes: shapesR.current, conns: connsR.current });
    }, 300);
    return () => clearTimeout(simDebounceRef.current);
  }, [shapes, conns, csvStore, inferenceRef]);

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
  // Contagem reativa de registros que chegam a cada nó por valor de domínio
  // (computada no worker junto do overlay). Alimenta o "Configurar nó" e o filtro
  // de exibição de domínios (modo automático). {[nodeId]: {val|row|col: {[v]:qty}}}
  const [nodeArrivals, setNodeArrivals] = useState({});
  // Modal "Configurar nó": null | {shapeId, draft:{val?|row?|col?: null|string[]}}
  const [domainModal, setDomainModal] = useState(null);

  // Ports de losangos que não devem ser renderizados dado o domínio efetivo do nó
  // (não-destrutivo: o port/conn continua existindo e roteando na simulação).
  const hiddenPortIds = useMemo(() => {
    const hidden = new Set();
    for (const s of shapes) {
      if (s.type !== 'decision') continue;
      const portConns = conns.filter(c => c.from === s.id);
      const fullVals = portConns.map(c => c.label);
      const visible = new Set(effectiveDomain(fullVals, s.visibleVals, nodeArrivals[s.id]?.val));
      for (const c of portConns) if (!visible.has(c.label)) hidden.add(c.to);
    }
    return hidden;
  }, [shapes, conns, nodeArrivals]);

  const simOverlayDebounceRef = useRef(null);
  useEffect(() => {
    clearTimeout(simOverlayDebounceRef.current);
    simOverlayDebounceRef.current = setTimeout(() => {
      workerRef.current?.postMessage({ type: 'COMPUTE_OVERLAY', shapes: shapesR.current, conns: connsR.current, lensPopulations: lensPopulationsR.current });
    }, 300);
    return () => clearTimeout(simOverlayDebounceRef.current);
  }, [shapes, conns, csvStore, lensPopulations, inferenceRef]);

  // ── Analytics Workspace — dataset analítico canônico (DEC-AW-002) ──
  // Recomputado pelo worker quando a simulação muda; cacheado em analyticsDataset.
  // 5B: monta as abas marcadas (includeInDashboard) como cenários — working copy para o
  // canvas ativo, store para os demais — e resolve lensPopulations por canvas (DEC-AW-007).
  const buildAnalyticsCanvasInputs = useCallback(() => {
    const cs = canvasesR.current;
    const activeId = activeCanvasIdR.current;
    const store = csvStoreR.current;
    const inputs = [];
    for (const id of Object.keys(cs)) {
      const c = cs[id];
      if (!c.includeInDashboard) continue;
      const shapes_ = id === activeId ? shapesR.current : (c.shapes || []);
      const conns_  = id === activeId ? connsR.current  : (c.conns  || []);
      const lensPop = {};
      for (const shape of shapes_) {
        if (shape.type === 'decision_lens') lensPop[shape.id] = computeLensAffectedRows(shape, store);
      }
      inputs.push({ id, nome: c.name, shapes: shapes_, conns: conns_, lensPopulations: lensPop });
    }
    return inputs;
  }, []);

  const analyticsDebounceRef = useRef(null);
  useEffect(() => {
    clearTimeout(analyticsDebounceRef.current);
    // Dataset largo é caro (1 objeto JS por linha × cenário, clonado do worker) — só
    // vale recomputar enquanto a aba Dashboard está aberta. Editar o canvas com a
    // aba Canvas ativa não precisa manter esse dataset em dia a cada 300ms.
    if (activeTab !== 'analysis') return;
    analyticsDebounceRef.current = setTimeout(() => {
      workerRef.current?.postMessage({ type: 'COMPUTE_ANALYTICS_DATASET', canvases: buildAnalyticsCanvasInputs() });
    }, 300);
    return () => clearTimeout(analyticsDebounceRef.current);
  }, [shapes, conns, csvStore, canvases, activeCanvasId, buildAnalyticsCanvasInputs, inferenceRef, activeTab]);

  // Persiste layout do dashboard na sessionStorage para sobreviver a reloads dentro da mesma sessão.
  useEffect(() => { sessionStorage.setItem('aw_layout_v1', JSON.stringify(analyticsLayout)); }, [analyticsLayout]);
  useEffect(() => { sessionStorage.setItem('aw_groupings_v1', JSON.stringify(analyticsGroupings)); }, [analyticsGroupings]);
  useEffect(() => { sessionStorage.setItem('aw_page_filters_v1', JSON.stringify(analyticsPageFilters)); }, [analyticsPageFilters]);

  // Persiste multi-canvas store — inclui working copy do canvas ativo (Sub-sessão 5A).
  useEffect(() => {
    try {
      const toSave = {
        canvases: {
          ...canvases,
          [activeCanvasId]: { ...canvases[activeCanvasId], shapes, conns },
        },
        activeCanvasId,
      };
      sessionStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(toSave));
    } catch {}
  }, [shapes, conns, canvases, activeCanvasId]);

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
      if (curTool==="select") {
        const [wx,wy]=toWorld(sx,sy);
        setMultiSel(new Set());
        setSelRect(null);
        dragR.current={type:"selRect",sx,sy,wx,wy};
      } else {
        const {x:ox,y:oy}=vpR.current;
        dragR.current={type:"pan",sx,sy,ox,oy};
      }
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
    else if(dr.type==="selRect"){const[wx,wy]=toWorld(sx,sy);const rect={x1:dr.wx,y1:dr.wy,x2:wx,y2:wy};setSelRect(rect);const rx1=Math.min(rect.x1,rect.x2),ry1=Math.min(rect.y1,rect.y2),rx2=Math.max(rect.x1,rect.x2),ry2=Math.max(rect.y1,rect.y2);setMultiSel(new Set(shapesR.current.filter(s=>s.type!=="frame"&&s.x<rx2&&s.x+s.w>rx1&&s.y<ry2&&s.y+s.h>ry1).map(s=>s.id)));}
  },[]); // eslint-disable-line

  const onTouchEnd = useCallback((e) => {
    e.preventDefault(); clearTimeout(longTimer.current); setHint(null);
    const moved=movedR.current,dr=dragR.current,curTool=toolR.current;
    if(dr?.type==="selRect") setSelRect(null);
    if (!moved && dr) {
      if (dr.type==="tap-connect"){const sid=dr.id,fid=fromIdR.current;if(!fid){setFromId(sid);}else if(fid!==sid){if(!connsR.current.some(c=>c.from===fid&&c.to===sid))setConns(p=>[...p,{id:uid(),from:fid,to:sid}]);setFromId(null);}}
      if (dr.type==="pan"&&curTool!=="hand"&&curTool!=="select"&&curTool!=="connect"){const{x:vx,y:vy,s}=vpR.current,wx=(dr.sx-vx)/s,wy=(dr.sy-vy)/s;if(curTool==="cineminha"){createCinemaNode(wx,wy,'eligibility');}else if(curTool==="decision_lens"){createLensNode(wx,wy);}else if(curTool==="frame"){const id=uid();setShapes(p=>[...p,{id,type:"frame",x:wx-160,y:wy-120,w:320,h:240,label:"Frame",color:"rgba(219,234,254,0.25)"}]);setSel(id);}else{const id=uid();const isTerminal=curTool==="approved"||curTool==="rejected"||curTool==="as_is";const nw=isTerminal?120:SW,nh=isTerminal?44:SH;const lbl=curTool==="approved"?"Aprovado":curTool==="rejected"?"Reprovado":curTool==="as_is"?"AS IS":"";setShapes(p=>[...p,{id,type:curTool,x:wx-nw/2,y:wy-nh/2,w:nw,h:nh,label:lbl,color:"#ffffff"}]);setSel(id);}}
    }
    // Forward tap to interactive elements inside foreignObject (e.g. cineminha cells)
    // because e.preventDefault() on touchstart blocks synthetic click generation.
    if (!moved && e.changedTouches.length > 0) {
      const t = e.changedTouches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (el) {
        let cur = el;
        while (cur && cur !== svgRef.current) {
          if (cur.tagName?.toLowerCase() === 'foreignobject') { el.click(); break; }
          cur = cur.parentElement;
        }
      }
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

  // ── Multi-canvas operations (Sub-sessão 5A) ──────────────────────
  const switchCanvas = useCallback((targetId) => {
    const curId = activeCanvasIdR.current;
    if (targetId === curId) return;
    // Persist current working copy before leaving
    setCanvases(prev => ({
      ...prev,
      [curId]: { ...prev[curId], shapes: shapesR.current, conns: connsR.current },
    }));
    const target = canvasesR.current[targetId];
    setShapes(target?.shapes ?? []);
    setConns(target?.conns ?? []);
    // Undo/redo scoped per canvas — reset on switch
    setUndoStack([]);
    setRedoStack([]);
    setSel(null);
    setMultiSel(new Set());
    setActiveCanvasId(targetId);
  }, []); // eslint-disable-line

  const createCanvas = useCallback(() => {
    const id = uid();
    const curId = activeCanvasIdR.current;
    const idx = Object.keys(canvasesR.current).length + 1;
    setCanvases(prev => ({
      ...prev,
      [curId]: { ...prev[curId], shapes: shapesR.current, conns: connsR.current },
      [id]: { id, name: `Canvas ${idx}`, shapes: [], conns: [], includeInDashboard: true },
    }));
    setShapes([]); setConns([]);
    setUndoStack([]); setRedoStack([]);
    setSel(null); setMultiSel(new Set());
    setActiveCanvasId(id);
    setActiveTab('canvas');
  }, []); // eslint-disable-line

  const duplicateCanvas = useCallback((sourceId) => {
    const source = canvasesR.current[sourceId];
    if (!source) return;
    const id = uid();
    const curId = activeCanvasIdR.current;
    // Use working copy for the active canvas (may be ahead of stored state)
    const srcShapes = sourceId === curId ? shapesR.current : source.shapes;
    const srcConns  = sourceId === curId ? connsR.current  : source.conns;
    const { newShapes, newConns } = cloneCanvasWithNewIds(srcShapes, srcConns);
    setCanvases(prev => ({
      ...prev,
      [curId]: { ...prev[curId], shapes: shapesR.current, conns: connsR.current },
      [id]: { id, name: `${source.name} (cópia)`, shapes: newShapes, conns: newConns, includeInDashboard: true },
    }));
    setShapes(newShapes); setConns(newConns);
    setUndoStack([]); setRedoStack([]);
    setSel(null); setMultiSel(new Set());
    setActiveCanvasId(id);
    setActiveTab('canvas');
  }, []); // eslint-disable-line

  const deleteCanvas = useCallback((id) => {
    const keys = Object.keys(canvasesR.current);
    if (keys.length <= 1) return; // guard: cannot delete last canvas
    const curId = activeCanvasIdR.current;
    const remaining = keys.filter(k => k !== id);
    const newActiveId = id === curId ? remaining[0] : curId;
    const newCanvases = {};
    for (const k of remaining) {
      newCanvases[k] = canvasesR.current[k];
    }
    // Persist active working copy if we're not deleting it
    if (id !== curId) {
      newCanvases[curId] = { ...newCanvases[curId], shapes: shapesR.current, conns: connsR.current };
    }
    setCanvases(newCanvases);
    if (id === curId) {
      const target = newCanvases[newActiveId];
      setShapes(target?.shapes ?? []);
      setConns(target?.conns ?? []);
      setUndoStack([]); setRedoStack([]);
      setSel(null); setMultiSel(new Set());
      setActiveCanvasId(newActiveId);
      setActiveTab('canvas');
    }
  }, []); // eslint-disable-line

  const renameCanvas = useCallback((id, name) => {
    setCanvases(prev => ({ ...prev, [id]: { ...prev[id], name: name.trim() || prev[id].name } }));
  }, []);

  const toggleCanvasInDashboard = useCallback((id) => {
    setCanvases(prev => ({ ...prev, [id]: { ...prev[id], includeInDashboard: !prev[id].includeInDashboard } }));
  }, []);

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

  // ── Auto Layout ──────────────────────────────────────────────
  const autoLayoutRafRef = useRef(null);
  const autoLayout = useCallback(() => {
    const shapes_ = shapesR.current;
    const conns_  = connsR.current;
    if (shapes_.length === 0) return;

    // ── Spacing constants ────────────────────────────────────────
    const ORIGIN_X = 80, ORIGIN_Y = 80;
    // Vão nó↔ports é adaptativo (depende do label da seta mais largo do nó):
    // piso confortável, teto para não explodir a largura, +respiro fixo.
    const PORT_GAP_X_MIN = 96;   // piso do vão (mesmo nós de label curto respiram)
    const PORT_GAP_X_MAX = 260;  // teto do vão (labels muito longos não estouram o layout)
    const PORT_LABEL_PAD = 44;   // respiro total ao redor do label da seta
    const PORT_GAP_Y = 16;   // vertical gap between stacked ports of the same node
    const GAP_X = 96;        // gap between the port column and the next layer
    const GAP_Y = 36;        // vertical gap between clusters in the same layer
    const PARK_GAP_X = 160;  // gap between the flow and the "parking" area
    const PARK_GAP_Y = 44;   // vertical gap between parked components
    // Cada aresta carrega um "balão" no meio: o label do domínio + (com a
    // simulação rodando) o chip de volume·inad.real·inad.inferida empilhado
    // logo abaixo. Esses balões ficam no ponto médio da seta; se os nós ficam
    // colados, os balões se sobrepõem. Medimos cada balão e inflamos os vãos.
    const BALLOON_VPAD = 6;  // respiro vertical entre balões empilhados
    const BALLOON_HPAD = 18; // respiro horizontal do balão dentro do vão

    // ── Balloon (edge label) measurement — espelha renderConn ────
    const edgeStats_ = simResultR.current?.edgeStats || {};
    const showV = showEdgeVolR.current, showR = showEdgeInadRealR.current, showI = showEdgeInadInfR.current;
    const balloonOf = (conn) => {
      const labelText = conn.label ? trunc(conn.label, CONN_LABEL_MAX) : null;
      const labelBoxW = labelText ? Math.max(56, labelText.length * CONN_LABEL_CW + 16) : 0;
      const es = edgeStats_[conn.id];
      const analytics = es ? [
        showV && fmtQty(es.qty),
        showR && fmtPct(es.inadReal),
        showI && fmtPct(es.inadInferida),
      ].filter(Boolean).join(" · ") || null : null;
      const analyticsW = analytics ? analytics.length * 6.4 : 0;
      // altura: caixa do label (20) + chip de analytics (14), empilhados
      return { w: Math.max(labelBoxW, analyticsW), h: (labelText ? 20 : 0) + (analytics ? 14 : 0) };
    };
    const bMap = {};
    conns_.forEach(c => { bMap[c.id] = balloonOf(c); });
    const maxBalloonH = conns_.reduce((m, c) => Math.max(m, bMap[c.id].h), 0);
    const maxBalloonW = conns_.reduce((m, c) => Math.max(m, bMap[c.id].w), 0);
    // Vãos horizontais/verticais entre camadas crescem para caber o balão.
    const gapX = Math.max(GAP_X, maxBalloonW + BALLOON_HPAD);
    const gapY = Math.max(GAP_Y, maxBalloonH + BALLOON_VPAD);

    // ── Classify nodes ───────────────────────────────────────────
    // Components that are never part of the decision flow → always parked.
    const NON_FLOW = new Set(['csv', 'simPanel']);
    const isPort = s => s.type === 'port';
    const ports = shapes_.filter(isPort);
    const portIds = new Set(ports.map(s => s.id));
    const parents = shapes_.filter(s => !isPort(s));
    const pmap = Object.fromEntries(parents.map(p => [p.id, p]));

    // port → owner (the parent node that emits the port via a from→port conn)
    const portOwner = {};
    conns_.forEach(c => { if (portIds.has(c.to) && !portIds.has(c.from)) portOwner[c.to] = c.from; });
    const ownedPorts = {};
    parents.forEach(p => { ownedPorts[p.id] = []; });
    ports.forEach(pt => { const o = portOwner[pt.id]; if (o && ownedPorts[o]) ownedPorts[o].push(pt); });

    // Label da seta que chega em cada port — dimensiona o vão nó↔ports.
    // Guardamos também o id da conn dona e as conns que saem do port, para
    // medir os balões incidentes e reservar a distância vertical/horizontal.
    const portConnLabel = {}, portOwnerConnId = {}, portOutConnIds = {};
    ports.forEach(pt => { portOutConnIds[pt.id] = []; });
    conns_.forEach(c => {
      if (portIds.has(c.to) && portOwner[c.to] === c.from) { portConnLabel[c.to] = c.label ?? ''; portOwnerConnId[c.to] = c.id; }
      if (portIds.has(c.from) && portOutConnIds[c.from]) portOutConnIds[c.from].push(c.id);
    });

    // resolve a conn endpoint to its owning parent (ports → owner)
    const toParent = id => (portIds.has(id) ? portOwner[id] : id);

    // ── Cluster dimensions (a node + its port column to the right) ─
    const portsH = {}, clusterW = {}, clusterH = {}, portGapX = {}, portGapY = {};
    parents.forEach(p => {
      const pts = ownedPorts[p.id];
      const mpw = pts.length ? Math.max(...pts.map(pt => pt.w)) : 0;
      // Vão vertical adaptativo: os balões nó→port ficam no ponto médio da seta,
      // ou seja, a meio passo vertical entre eles. Para não sobreporem, o passo
      // (pt.h + gap) precisa ser ≥ 2× a altura do balão mais alto incidente.
      let reqH = 0;
      pts.forEach(pt => {
        const oc = portOwnerConnId[pt.id]; if (oc && bMap[oc]) reqH = Math.max(reqH, bMap[oc].h);
        (portOutConnIds[pt.id] || []).forEach(cid => { if (bMap[cid]) reqH = Math.max(reqH, bMap[cid].h); });
      });
      const minPH = pts.length ? Math.min(...pts.map(pt => pt.h)) : 0;
      portGapY[p.id] = reqH > 0 ? Math.max(PORT_GAP_Y, 2 * (reqH + BALLOON_VPAD) - minPH) : PORT_GAP_Y;
      const ph  = pts.length ? pts.reduce((a, pt) => a + pt.h, 0) + (pts.length - 1) * portGapY[p.id] : 0;
      // vão horizontal adaptativo: cresce com o balão mais largo do nó (label do
      // domínio ou chip de analytics), dentro de [MIN, MAX]
      const maxLW = pts.reduce((m, pt) => {
        const oc = portOwnerConnId[pt.id];
        return Math.max(m, oc && bMap[oc] ? bMap[oc].w : estConnLabelW(portConnLabel[pt.id] ?? pt.label));
      }, 0);
      portGapX[p.id] = pts.length
        ? Math.min(PORT_GAP_X_MAX, Math.max(PORT_GAP_X_MIN, maxLW + PORT_LABEL_PAD))
        : 0;
      portsH[p.id]   = ph;
      clusterW[p.id] = p.w + (pts.length ? portGapX[p.id] + mpw : 0);
      clusterH[p.id] = Math.max(p.h, ph);
    });

    // ── Parent-level flow graph (cross-parent edges only) ─────────
    const adj = {}, radj = {};
    parents.forEach(p => { adj[p.id] = new Set(); radj[p.id] = new Set(); });
    conns_.forEach(c => {
      const a = toParent(c.from), b = toParent(c.to);
      if (!a || !b || a === b || !adj[a] || !adj[b]) return;
      if (NON_FLOW.has(pmap[a].type) || NON_FLOW.has(pmap[b].type)) return;
      adj[a].add(b); radj[b].add(a);
    });

    // A node belongs to the flow only if it links to another parent.
    // Datasets/panels and isolated fragments are parked separately.
    const inFlow = new Set();
    parents.forEach(p => {
      if (NON_FLOW.has(p.type)) return;
      if (adj[p.id].size > 0 || radj[p.id].size > 0) inFlow.add(p.id);
    });
    const flowNodes = parents.filter(p => inFlow.has(p.id));
    const parkedNodes = parents.filter(p => !inFlow.has(p.id));
    const flowSet = new Set(flowNodes.map(p => p.id));

    const targets = {};      // shapeId → {x, y}  (top-left)
    const portTargets = {};  // portId  → {x, y}

    // ── Layered (Sugiyama-style) layout for the flow ──────────────
    if (flowNodes.length > 0) {
      // 1) Layer assignment via longest path from sources
      const indeg = {};
      flowNodes.forEach(p => { indeg[p.id] = [...radj[p.id]].filter(n => flowSet.has(n)).length; });
      const layer = {};
      const q = flowNodes.filter(p => indeg[p.id] === 0).map(p => p.id);
      q.forEach(id => { layer[id] = 0; });
      const indegW = { ...indeg };
      for (let qi = 0; qi < q.length; qi++) {
        const id = q[qi];
        adj[id].forEach(c => {
          if (!flowSet.has(c)) return;
          layer[c] = Math.max(layer[c] ?? 0, (layer[id] ?? 0) + 1);
          if (--indegW[c] === 0) q.push(c);
        });
      }
      flowNodes.forEach(p => { if (layer[p.id] === undefined) layer[p.id] = 0; }); // cycle fallback

      // Group into layers (columns), seed order by current Y
      const layers = [];
      flowNodes.forEach(p => { const d = layer[p.id]; (layers[d] ||= []).push(p.id); });
      for (let d = 0; d < layers.length; d++) { layers[d] ||= []; layers[d].sort((a, b) => pmap[a].y - pmap[b].y); }

      // 2) Crossing reduction — barycenter ordering sweeps
      const order = {};
      const reindex = () => layers.forEach(L => L.forEach((id, i) => { order[id] = i; }));
      reindex();
      const nbrs = (id, up) => [...(up ? radj[id] : adj[id])].filter(n => flowSet.has(n));
      for (let it = 0; it < 8; it++) {
        const down = it % 2 === 0;
        const ds = [...layers.keys()];
        if (!down) ds.reverse();
        for (const d of ds) {
          const withB = layers[d].map(id => {
            const ns = nbrs(id, down);
            return [id, ns.length ? ns.reduce((a, n) => a + order[n], 0) / ns.length : order[id]];
          });
          withB.sort((a, b) => a[1] - b[1]);
          layers[d] = withB.map(x => x[0]);
          reindex();
        }
      }

      // 3) X per layer (cumulative; width includes the port column)
      const colX = [];
      let cx = ORIGIN_X;
      for (let d = 0; d < layers.length; d++) {
        colX[d] = cx;
        const w = layers[d].length ? Math.max(...layers[d].map(id => clusterW[id])) : 0;
        cx += w + gapX;
      }

      // 4) Y per node — isotonic (PAVA) placement pulling each node toward
      //    its neighbours' barycenter while keeping order + min gap (no overlap).
      const cy = {};
      layers.forEach(L => {
        let y = ORIGIN_Y;
        L.forEach(id => { cy[id] = y + clusterH[id] / 2; y += clusterH[id] + gapY; });
      });
      const resolveLayer = (L, desired) => {
        const n = L.length;
        if (n === 0) return;
        const off = new Array(n).fill(0);
        for (let i = 1; i < n; i++) off[i] = off[i - 1] + clusterH[L[i - 1]] / 2 + gapY + clusterH[L[i]] / 2;
        const tgt = L.map((id, i) => desired[id] - off[i]);
        const blocks = []; // PAVA isotonic regression (non-decreasing)
        for (let i = 0; i < n; i++) {
          let b = { sum: tgt[i], cnt: 1, val: tgt[i] };
          while (blocks.length && blocks[blocks.length - 1].val > b.val) {
            const last = blocks.pop();
            b = { sum: b.sum + last.sum, cnt: b.cnt + last.cnt, val: (b.sum + last.sum) / (b.cnt + last.cnt) };
          }
          blocks.push(b);
        }
        let i = 0;
        for (const b of blocks) for (let k = 0; k < b.cnt; k++) { cy[L[i]] = b.val + off[i]; i++; }
      };
      for (let it = 0; it < 16; it++) {
        const down = it % 2 === 0;
        const ds = [...layers.keys()];
        if (!down) ds.reverse();
        for (const d of ds) {
          const desired = {};
          layers[d].forEach(id => {
            const ns = nbrs(id, down);
            desired[id] = ns.length ? ns.reduce((a, n) => a + cy[n], 0) / ns.length : cy[id];
          });
          resolveLayer(layers[d], desired);
        }
      }

      // Normalize so the topmost cluster sits at ORIGIN_Y
      let minTop = Infinity;
      flowNodes.forEach(p => { minTop = Math.min(minTop, cy[p.id] - clusterH[p.id] / 2); });
      const shiftY = isFinite(minTop) ? ORIGIN_Y - minTop : 0;

      // Parent positions (centered within their cluster band)
      flowNodes.forEach(p => {
        const band = cy[p.id] + shiftY;
        targets[p.id] = { x: colX[layer[p.id]], y: band - p.h / 2 };
      });

      // Port positions — always to the right of the node, stacked & centered,
      // ordered by their downstream target to keep arrows from crossing.
      flowNodes.forEach(p => {
        const pts = ownedPorts[p.id];
        if (!pts.length) return;
        const band = cy[p.id] + shiftY;
        const px = colX[layer[p.id]] + p.w + portGapX[p.id];
        const dyOf = pt => {
          const outs = conns_.map(c => (c.from === pt.id ? toParent(c.to) : null))
            .filter(t => t && targets[t]);
          if (!outs.length) return null;
          return outs.reduce((a, t) => a + targets[t].y + pmap[t].h / 2, 0) / outs.length;
        };
        const sorted = [...pts].sort((a, b) => {
          const ca = dyOf(a), cb = dyOf(b);
          if (ca == null && cb == null) return a.y - b.y;
          if (ca == null) return 1;
          if (cb == null) return -1;
          return ca - cb;
        });
        let y = band - portsH[p.id] / 2;
        sorted.forEach(pt => { portTargets[pt.id] = { x: px, y }; y += pt.h + portGapY[p.id]; });
      });
    }

    // ── Parking area — non-flow + disconnected, stacked vertically ─
    let flowRight = ORIGIN_X;
    flowNodes.forEach(p => { flowRight = Math.max(flowRight, targets[p.id].x + clusterW[p.id]); });
    const parkX = flowNodes.length ? flowRight + PARK_GAP_X : ORIGIN_X;

    let py = ORIGIN_Y;
    [...parkedNodes].sort((a, b) => a.y - b.y).forEach(p => {
      const clH = clusterH[p.id];
      targets[p.id] = { x: parkX, y: py + (clH - p.h) / 2 };
      const pts = ownedPorts[p.id];
      if (pts.length) {
        const px = parkX + p.w + portGapX[p.id];
        let y = py + (clH - portsH[p.id]) / 2;
        [...pts].sort((a, b) => a.y - b.y).forEach(pt => { portTargets[pt.id] = { x: px, y }; y += pt.h + portGapY[p.id]; });
      }
      py += clH + PARK_GAP_Y;
    });

    // Collect all start positions and target positions for animation
    const starts = {};
    shapes_.forEach(s => { starts[s.id] = { x: s.x, y: s.y }; });

    const allTargets = { ...targets, ...portTargets };

    // Animate via RAF
    if (autoLayoutRafRef.current) cancelAnimationFrame(autoLayoutRafRef.current);
    pushHistory();

    const DURATION = 600;
    const startTime = performance.now();

    const easeInOut = t => t < 0.5 ? 2*t*t : -1+(4-2*t)*t;

    const tick = (now) => {
      const raw = Math.min((now - startTime) / DURATION, 1);
      const t = easeInOut(raw);

      setShapes(prev => prev.map(s => {
        const from = starts[s.id];
        const to   = allTargets[s.id];
        if (!from || !to) return s;
        return { ...s, x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      }));

      if (raw < 1) {
        autoLayoutRafRef.current = requestAnimationFrame(tick);
      } else {
        autoLayoutRafRef.current = null;
      }
    };

    autoLayoutRafRef.current = requestAnimationFrame(tick);
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
          const maxR=Math.min(rowCount(csv),MAX_ROWS)-1, maxC=csv.headers.length-1;
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
    e.target.value="";
    setCsvImportError(null);
    setImportLoading({phase:'reading', pct:0, filename:file.name});
    const reader=new FileReader();
    reader.onerror=()=>{
      setImportLoading(null);
      setCsvImportError(`Não foi possível ler o arquivo "${file.name}". Verifique se ele não está corrompido, vazio ou aberto em outro programa.`);
    };
    reader.onprogress=(ev)=>{
      if (ev.lengthComputable) setImportLoading(l=>l&&({...l,pct:Math.round((ev.loaded/ev.total)*30)}));
    };
    reader.onload=async(ev)=>{
      try {
        const text=ev.target.result;
        if (!text || !text.trim()) {
          setImportLoading(null);
          setCsvImportError(`O arquivo "${file.name}" está vazio.`);
          return;
        }
        const {delimiter,confident}=detectDelimiter(text);
        const {decimalSep, confident: decConfident}=detectDecimalSep(text, delimiter);
        setImportLoading(l=>l&&({...l,phase:'parsing',pct:35}));
        const {headers, rows} = await parseCSVAsync(text, delimiter, true, (done,total)=>{
          setImportLoading(l=>l&&({...l,pct:35+Math.round((done/Math.max(total,1))*60)}));
        });
        if (!headers.length || !rows.length) {
          setImportLoading(null);
          setCsvImportError(`Não foi possível identificar colunas em "${file.name}" com o delimitador detectado ("${delimiter}"). Verifique se o arquivo é um CSV válido.`);
          return;
        }
        setImportLoading(null);
        setWizard({rawText:text,filename:file.name,delimiter,detected:delimiter,confident,hasHeader:true,step:1,columnTypes:{},varTypes:{},asIsVar:null,asIsMapping:{},editCsvId:null,decimalSep,decimalSepConfident:decConfident,inferenceSource:'columns',keyMap:{},weightCol:null,weightMode:'propostas',normalizeScore:true,parsedHeaders:headers,parsedRows:rows,parsedDelimiter:delimiter,parsedHasHeader:true});
      } catch (err) {
        setImportLoading(null);
        setCsvImportError(`Falha ao processar "${file.name}": ${err?.message || err}`);
      }
    };
    reader.readAsText(file);
  };

  // Reprocessa o arquivo bruto com novo delimitador/cabeçalho sem travar a UI
  // (chunked via parseCSVAsync) — usado pelos seletores do Passo 1 do wizard.
  // Mostra o mesmo modal de progresso da carga inicial; só atualiza
  // delimiter/hasHeader no wizard quando o reparse termina.
  const reparseWizardFile = (patch) => {
    if (!wizard) return;
    if (wizard.editCsvId) { setWizard(w => w ? {...w, ...patch} : w); return; }
    const nextDelimiter = 'delimiter' in patch ? patch.delimiter : wizard.delimiter;
    const nextHasHeader = 'hasHeader' in patch ? patch.hasHeader : wizard.hasHeader;
    const { filename, rawText } = wizard;
    setImportLoading({phase:'parsing', pct:5, filename});
    parseCSVAsync(rawText, nextDelimiter, nextHasHeader, (done,total)=>{
      setImportLoading(l=>l&&({...l,pct:5+Math.round((done/Math.max(total,1))*90)}));
    }).then(({headers,rows})=>{
      setImportLoading(null);
      setWizard(w2=>w2?{...w2,...patch,parsedHeaders:headers,parsedRows:rows,parsedDelimiter:nextDelimiter,parsedHasHeader:nextHasHeader}:w2);
    }).catch(err=>{
      setImportLoading(null);
      setCsvImportError(`Falha ao reprocessar "${filename}": ${err?.message||err}`);
    });
  };

  // ── Import da Tabela de Inferência (slot dedicado — Fase 1) ──
  // Parser fixo: delimitador ';', decimal '.'. NÃO entra no csvStore, não vira
  // nó no canvas e não gera chips. Indexa UMA vez via indexInferenceRef.
  const onInferenceRefFileChange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        const { headers, rows } = parseCSV(text, ';', true);
        if (!headers.length || !rows.length) {
          setInfRefError('Arquivo vazio ou ilegível.');
          return;
        }
        const idx = indexInferenceRef(headers, rows, file.name);
        if (!idx.keyCols.length) {
          setInfRefError('Não foi possível identificar as colunas-chave (vars_usadas / cabeçalho).');
          return;
        }
        setInferenceRef(idx);
        setInfRefError(null);
      } catch (err) {
        setInfRefError('Falha ao processar a tabela: ' + (err?.message || err));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
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
    const {rawText,filename,delimiter,hasHeader,columnTypes,varTypes,asIsVar,asIsMapping,editCsvId,decimalSep,inferenceSource,keyMap,weightCol,weightMode,normalizeScore}=wizard;

    // Auto-assign 'decision' to all columns without an explicit type
    const buildFinalTypes = (headers, types) => {
      const final = {...(types || {})};
      for (const h of headers) { if (!final[h]) final[h] = 'decision'; }
      return final;
    };

    // Config de origem da inferência (Fase 1) — persistida por dataset.
    // 'ref' só vale se a Tabela de Inferência ainda está carregada; senão
    // degrada para 'columns' (comportamento atual 🔮/🎯).
    // `normalizeScore` (Fase 2 §6): aplicar R99/vazio→R20 como chave transitória de
    // lookup. Default true (fiel ao SAS); nunca muta dado/domínio/export.
    const wantsRef = inferenceSource === 'ref' && !!inferenceRefR.current;
    // `weightMode` (Fase 4 / CONTRATO §3.2): base de volume do peso —
    // 'propostas' (default, "abrir para reprovados") usa o 📊 volume total;
    // 'aprovados' ("FPD sobre aprovados") usa a coluna de aprovados.
    const inferenceConfig = wantsRef
      ? { source: 'ref', keyMap: keyMap || {}, weightCol: weightCol || null, weightMode: weightMode === 'aprovados' ? 'aprovados' : 'propostas', normalizeScore: normalizeScore !== false }
      : { source: 'columns', keyMap: {}, weightCol: null, weightMode: 'propostas', normalizeScore: true };

    // ── Edit mode: update existing dataset, no new canvas nodes ──
    if (editCsvId) {
      const prev = csvStoreR.current[editCsvId];
      if (!prev) { setWizard(null); return; }
      pushHistory();

      // Strip any existing __DECISAO_ORIGINAL column from headers/rows.
      // `prev` está em formato colunar (Fase 1) — materializa string[][] só aqui
      // (edição é rara) para reusar a lógica de strip/re-derivação da coluna, e
      // re-vetoriza no fim. O array materializado é liberado logo em seguida.
      const DORIGINAL_COL = '__DECISAO_ORIGINAL';
      const existingIdx = prev.headers.indexOf(DORIGINAL_COL);
      const prevRows = materializeRows(prev);
      const baseHeaders = existingIdx >= 0 ? prev.headers.filter((_,i) => i !== existingIdx) : prev.headers;
      const baseRows = existingIdx >= 0 ? prevRows.map(r => r.filter((_,i) => i !== existingIdx)) : prevRows;

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
      const { columns: editColumns, rowCount: editRowCount } = buildColumnar(finalHeaders, finalRows, finalTypes);

      setCsvStore(store => ({
        ...store,
        [editCsvId]: { ...prev, name: filename||prev.name, headers: finalHeaders, columns: editColumns, rowCount: editRowCount, columnTypes: finalTypes, varTypes: varTypes||{}, asIsConfig: newAsIsConfig, inferenceConfig }
      }));
      setWizard(null);
      return;
    }

    // Reusa o parse já cacheado pelo wizard (onFileChange/reparseWizardFile)
    // quando ele bate com o delimiter/hasHeader atuais — evita reparsear a
    // base inteira de novo só para confirmar a importação.
    const {headers, rows: rawRows} = (wizard.parsedHeaders && wizard.parsedDelimiter===delimiter && wizard.parsedHasHeader===hasHeader)
      ? {headers: wizard.parsedHeaders, rows: wizard.parsedRows}
      : parseCSV(rawText,delimiter,hasHeader);
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
    // Vetoriza a base (Fase 1): a partir daqui a base vive como colunar
    // (Float64Array + dictionary encoding), não mais como string[][]. `finalRows`
    // (string[][]) é liberado após esta chamada.
    const { columns: newColumns, rowCount: newRowCount } = buildColumnar(finalHeaders, finalRows, finalTypes);
    setCsvStore(prev=>({...prev,[csvId]:{name:filename,headers:finalHeaders,columns:newColumns,rowCount:newRowCount,columnTypes:finalTypes,varTypes:varTypes||{},asIsConfig:asIsVar?{col:asIsVar,mapping:asIsMapping||{}}:null,inferenceConfig}}));

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

    // Fan-out reconciliation to all OTHER canvases (Sub-sessão 5A)
    {
      const curId = activeCanvasIdR.current;
      const currentStoreKeys = new Set(Object.keys(csvStoreR.current));
      const reconcileForCanvas = (shapes_) => shapes_.map(s => {
        if (s.type === "decision") {
          if (!s.variableCol) return s;
          if (s.csvId === csvId) return s;
          if (s.csvId && currentStoreKeys.has(s.csvId)) return s;
          const mh = normMap[normalizeColName(s.variableCol)];
          if (mh) return {...s, csvId, variableCol: mh};
          return s;
        }
        if (s.type === "cineminha") {
          let upd = {...s}; let ch = false;
          if (s.rowVar && !currentStoreKeys.has(s.rowVar.csvId) && s.rowVar.csvId !== csvId) {
            const m = normMap[normalizeColName(s.rowVar.col)];
            if (m) { upd.rowVar = {col:m, csvId}; ch = true; }
          }
          if (s.colVar && !currentStoreKeys.has(s.colVar.csvId) && s.colVar.csvId !== csvId) {
            const m = normMap[normalizeColName(s.colVar.col)];
            if (m) { upd.colVar = {col:m, csvId}; ch = true; }
          }
          if (!ch) return s;
          if (upd.rowVar) { const ci=headers.indexOf(upd.rowVar.col); if(ci>=0){const vals=[...new Set(rows.map(r=>r[ci]??'').filter(v=>v!==''))];upd.rowDomain=sortDomain(vals);} }
          if (upd.colVar) { const ci=headers.indexOf(upd.colVar.col); if(ci>=0){const vals=[...new Set(rows.map(r=>r[ci]??'').filter(v=>v!==''))];upd.colDomain=sortDomain(vals);} }
          const rDom=upd.rowDomain.length>0?upd.rowDomain:['*']; const cDom=upd.colDomain.length>0?upd.colDomain:['*'];
          const nc={}; for(const rv of rDom) for(const cv of cDom){const k=`${rv}|${cv}`;nc[k]=getCellValue(s.cells,k);}
          upd.cells=nc; const {w:nw,h:nh}=computeCinemaSize(upd.rowDomain,upd.colDomain); upd.w=nw; upd.h=nh;
          return upd;
        }
        return s;
      });
      setCanvases(prev => {
        let changed = false;
        const next = {...prev};
        for (const [cId, canvas] of Object.entries(next)) {
          if (cId === curId) continue;
          const rec = reconcileForCanvas(canvas.shapes);
          next[cId] = {...canvas, shapes: rec};
          changed = true;
        }
        return changed ? next : prev;
      });
    }

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
        const sampleN = Math.min(rowCount(csv), 1000);
        const vals = Array.from({length: sampleN}, (_, i) => cellStr(csv, i, ci) ?? '').filter(Boolean);
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
      inferenceSource: csv.inferenceConfig?.source || 'columns',
      keyMap: csv.inferenceConfig?.keyMap || {},
      weightCol: csv.inferenceConfig?.weightCol || null,
      weightMode: csv.inferenceConfig?.weightMode === 'aprovados' ? 'aprovados' : 'propostas',
      normalizeScore: csv.inferenceConfig?.normalizeScore !== false,
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
      // Serializa a base colunar (typed arrays → arrays planos) p/ caber em JSON.
      csvStore: includeData ? serializeCsvStore(csvStore) : {},
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
    // Reconstrói typed arrays da base colunar (aceita também formato legado antigo).
    const importedCsvStore = deserializeCsvStore(data.csvStore || {});
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

  // ── Salvar / Abrir Projeto completo ───────────────────────────
  // Snapshot integral do estudo: todos os canvas (abas), todas as bases,
  // a Tabela de Inferência, os gráficos do Dashboard, a biblioteca de
  // Cineminhas, o widget de negócio e as preferências de visualização —
  // de modo que o usuário retome exatamente de onde parou.
  // Monta o snapshot integral do estudo. FONTE ÚNICA DA VERDADE do que é
  // persistido — qualquer estado novo criado/ajustado pelo usuário (nova aba,
  // nova preferência, nova biblioteca, novo painel do Dashboard, etc.) precisa
  // ser incluído AQUI e restaurado em `loadProject`. Ver checklist no CLAUDE.md
  // (seção "Salvar / Abrir Projeto").
  const buildProjectPayload = () => {
    // Mescla a working copy do canvas ativo de volta no store (igual ao
    // effect de persistência da sessionStorage) — sem isso, edições no canvas
    // ativo (ex.: um Decision Lens recém-criado) não entrariam no arquivo.
    const mergedCanvases = {
      ...canvases,
      [activeCanvasId]: { ...canvases[activeCanvasId], shapes, conns },
    };
    return {
      schemaVersion: "2.2",
      kind: "credito-project",
      generatedAt: new Date().toISOString(),
      activeTab,
      viewport: vp,
      panelCollapsed,
      canvases: mergedCanvases,
      activeCanvasId,
      // Base colunar → arrays planos (typed arrays não são JSON nativo). Round-trip
      // coberto em tests/columnar.test.js.
      csvStore: serializeCsvStore(csvStore),
      inferenceRef: serializeInferenceRef(inferenceRef),
      analyticsLayout,
      analyticsGroupings,
      analyticsPageFilters,
      cinemaLibrary,
      businessWidget,
      preferences: {
        enableDynThickness,
        showEdgeVol,
        showEdgeInadReal,
        showEdgeInadInf,
      },
    };
  };

  const projectFileName = () => `projeto_credito_${new Date().toISOString().slice(0,10)}.credito.json`;

  const saveProject = async () => {
    let json;
    try {
      json = JSON.stringify(buildProjectPayload());
    } catch {
      setProjectSaveNotice({ kind: "err", msg: "Não foi possível serializar o projeto." });
      return;
    }
    const suggestedName = projectFileName();
    // Preferência: "Salvar como" nativo (File System Access API) — o usuário
    // escolhe pasta e nome, e a escrita via stream não sofre o truncamento que
    // o download por <a>+revokeObjectURL pode causar em projetos grandes.
    if (typeof window !== "undefined" && window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [{
            description: "Projeto Simulador de Crédito",
            accept: { "application/json": [".json"] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        setProjectSaveNotice({ kind: "ok", msg: `Projeto salvo em "${handle.name}".` });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return; // usuário cancelou o diálogo
        // Qualquer outro erro (permissão, browser sem suporte real) → fallback.
      }
    }
    // Fallback: download via <a>. Anexa ao DOM e só revoga o blob URL depois de
    // um tick — revogar imediatamente após click() pode truncar arquivos grandes.
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setProjectSaveNotice({ kind: "ok", msg: "Projeto exportado para os downloads." });
    } catch {
      setProjectSaveNotice({ kind: "err", msg: "Falha ao salvar o projeto." });
    }
  };

  const loadProject = (data) => {
    if (!data || data.kind !== "credito-project" || !data.canvases || typeof data.canvases !== "object") {
      setImportError("Arquivo inválido: não é um projeto salvo por este sistema (.credito.json).");
      return;
    }
    const canv = data.canvases;
    const actId = (data.activeCanvasId && canv[data.activeCanvasId]) ? data.activeCanvasId : Object.keys(canv)[0];
    if (!actId || !canv[actId]) {
      setImportError("Arquivo inválido: projeto sem canvas ativo.");
      return;
    }
    // Sobe o contador de IDs para evitar colisão com novos elementos —
    // varre todos os shapes/conns de todos os canvas + os IDs de canvas.
    const allIds = Object.keys(canv);
    for (const c of Object.values(canv)) {
      (c.shapes || []).forEach(s => allIds.push(s.id));
      (c.conns  || []).forEach(cn => allIds.push(cn.id));
    }
    const maxNum = Math.max(0, ...allIds.map(id => parseInt(String(id).replace(/\D/g, ''))).filter(n => !isNaN(n)));
    if (maxNum >= _id) _id = maxNum + 1;

    setCanvases(canv);
    setActiveCanvasId(actId);
    setShapes(canv[actId].shapes || []);
    setConns(canv[actId].conns || []);
    setCsvStore(deserializeCsvStore(data.csvStore || {}));
    setInferenceRef(deserializeInferenceRef(data.inferenceRef));
    setInfRefError(null);
    setAnalyticsLayout(Array.isArray(data.analyticsLayout) ? data.analyticsLayout : []);
    setAnalyticsGroupings(Array.isArray(data.analyticsGroupings) ? data.analyticsGroupings : []);
    setAnalyticsPageFilters(Array.isArray(data.analyticsPageFilters) ? data.analyticsPageFilters : []);
    setCinemaLibrary(Array.isArray(data.cinemaLibrary) ? data.cinemaLibrary : []);
    if (data.businessWidget) setBusinessWidget(data.businessWidget);
    if (data.viewport) setVp(data.viewport);
    if (data.activeTab) setActiveTab(data.activeTab);
    if (typeof data.panelCollapsed === 'boolean') setPanelCollapsed(data.panelCollapsed);
    const pref = data.preferences || {};
    if (typeof pref.enableDynThickness === 'boolean') setEnableDynThickness(pref.enableDynThickness);
    if (typeof pref.showEdgeVol === 'boolean') setShowEdgeVol(pref.showEdgeVol);
    if (typeof pref.showEdgeInadReal === 'boolean') setShowEdgeInadReal(pref.showEdgeInadReal);
    if (typeof pref.showEdgeInadInf === 'boolean') setShowEdgeInadInf(pref.showEdgeInadInf);
    // Limpa estado transitório de seleção/edição e o histórico (que é por
    // canvas e ficaria inconsistente após substituir todos os canvas).
    setSel(null); setFromId(null); setPalette(false); setActiveCell(null);
    setMultiSel(new Set()); setSelRect(null);
    setUndoStack([]); setRedoStack([]);
    setImportError(null);
    setImportWarn(null);
    setProjectSaveNotice(null);
  };

  const onProjectFileChange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        loadProject(JSON.parse(ev.target.result));
      } catch {
        setImportError("Arquivo inválido: não foi possível ler o projeto. Verifique se o arquivo não está corrompido.");
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
          rowDomain = sortDomain(distinctColValues(csv, colIdx));
        }
      }
    }
    if (colVarFinal) {
      const csv = csvStoreR.current[colVarFinal.csvId];
      if (csv) {
        const colIdx = csv.headers.indexOf(colVarFinal.col);
        if (colIdx !== -1) {
          colDomain = sortDomain(distinctColValues(csv, colIdx));
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

  // ── applyLibraryConfigToCinema ────────────────────────────────
  // Aplica a lógica de caselas (elegível/não elegível) de um item da
  // biblioteca sobre um Cineminha já configurado, preservando variáveis,
  // domínios, tamanho, tipo e todos os conectores. Atualiza o label para o
  // nome do item da biblioteca.
  const applyLibraryConfigToCinema = (shapeId, item) => {
    const shape = shapesR.current.find(s => s.id === shapeId && s.type === 'cineminha');
    if (!shape) return;
    pushHistory();
    const importedCells = item.cells || {};
    const rDom = (shape.rowDomain && shape.rowDomain.length) ? shape.rowDomain : ['*'];
    const cDom = (shape.colDomain && shape.colDomain.length) ? shape.colDomain : ['*'];
    const impR = (item.rowDomain && item.rowDomain.length) ? item.rowDomain : ['*'];
    const impC = (item.colDomain && item.colDomain.length) ? item.colDomain : ['*'];
    const newCells = {};
    for (let i = 0; i < rDom.length; i++) {
      for (let j = 0; j < cDom.length; j++) {
        const key = `${rDom[i]}|${cDom[j]}`;
        if (key in importedCells) {
          // 1) match direto por valor (mesmos rótulos de domínio)
          newCells[key] = getCellValue(importedCells, key);
          continue;
        }
        // 2) match posicional contra os domínios do item importado
        const pr = i < impR.length ? impR[i] : undefined;
        const pc = j < impC.length ? impC[j] : undefined;
        const pKey = (pr !== undefined && pc !== undefined) ? `${pr}|${pc}` : null;
        if (pKey && pKey in importedCells) {
          newCells[key] = getCellValue(importedCells, pKey);
          continue;
        }
        // 3) sem correspondência → preserva o estado atual da casela
        newCells[key] = getCellValue(shape.cells, key);
      }
    }
    setShapes(prev => prev.map(s => s.id !== shapeId ? s : { ...s, cells: newCells, ...(item.name ? { label: item.name } : {}) }));
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
      // Cineminha já configurado: troca apenas a lógica das caselas, mantendo
      // variáveis, conectores e tamanho intactos.
      if (hasExistingConfig) {
        applyLibraryConfigToCinema(selectedCinema.id, item);
        return;
      }
      // Cineminha em branco: não há variáveis a preservar — abre o mapeamento.
      setCinemaImportModal({
        shapeId: selectedCinema.id,
        config,
        step: 'mapping',
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
    const allVals = distinctColValues(csv, colIdx);
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
    const eligPort = {id:eligId, type:"port", x:wx+W/2+72, y:wy-PORT_H-6, w:PORT_W, h:PORT_H, label:cfg.ports[0].label, color:cfg.ports[0].color};
    const notPort  = {id:notId,  type:"port", x:wx+W/2+72, y:wy+6,         w:PORT_W, h:PORT_H, label:cfg.ports[1].label, color:cfg.ports[1].color};
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

  // ── Configurar nó (domínio exibido) ───────────────────────────
  const openDomainModal = useCallback((shapeId) => {
    const s = shapesR.current.find(x => x.id === shapeId);
    if (!s) return;
    if (s.type === 'decision')       setDomainModal({ shapeId, draft: { val: s.visibleVals ?? null } });
    else if (s.type === 'cineminha') setDomainModal({ shapeId, draft: { row: s.visibleRow ?? null, col: s.visibleCol ?? null } });
  }, []); // eslint-disable-line

  const applyDomainConfig = useCallback((shapeId, draft) => {
    pushHistory();
    setShapes(prev => prev.map(s => {
      if (s.id !== shapeId) return s;
      if (s.type === 'decision')  return { ...s, visibleVals: draft.val ?? null };
      if (s.type === 'cineminha') return { ...s, visibleRow: draft.row ?? null, visibleCol: draft.col ?? null };
      return s;
    }));
    setDomainModal(null);
  }, []); // eslint-disable-line

  // ── assignCinemaVar ───────────────────────────────────────────
  const assignCinemaVar = useCallback((shapeIdOrIds, col, csvId, axis) => {
    pushHistory();
    const shapeIds = Array.isArray(shapeIdOrIds) ? shapeIdOrIds : [shapeIdOrIds];
    const csv = csvStoreR.current[csvId];
    if (!csv) return;
    const colIdx = csv.headers.indexOf(col);
    if (colIdx === -1) return;
    const allVals = distinctColValues(csv, colIdx);
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
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    setPanelDrag({col,csvId});
    setGhostPos({x:cx,y:cy});
  };

  // ── Global mouse/touch listeners for panel→canvas drag ───────
  useEffect(()=>{
    const getXY = (e) => e.changedTouches
      ? {x:e.changedTouches[0].clientX,y:e.changedTouches[0].clientY}
      : e.touches
        ? {x:e.touches[0].clientX,y:e.touches[0].clientY}
        : {x:e.clientX,y:e.clientY};
    const onMove=(e)=>{
      if (!panelDragR.current) return;
      const {x,y}=getXY(e);
      setGhostPos({x,y});
    };
    const onUp=(e)=>{
      const drag=panelDragR.current;
      if (!drag) return;
      const {x:cx,y:cy}=getXY(e);
      const svgEl=svgRef.current;
      if (svgEl) {
        const rect=svgEl.getBoundingClientRect();
        if (cx>=rect.left&&cx<=rect.right&&cy>=rect.top&&cy<=rect.bottom) {
          const sx=cx-rect.left,sy=cy-rect.top;
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
    window.addEventListener('touchmove',onMove,{passive:false});
    window.addEventListener('touchend',onUp);
    return()=>{
      window.removeEventListener('mousemove',onMove);
      window.removeEventListener('mouseup',onUp);
      window.removeEventListener('touchmove',onMove);
      window.removeEventListener('touchend',onUp);
    };
  },[]); // eslint-disable-line

  // ── Wizard preview ────────────────────────────────────────────
  // Memoizado: antes este bloco rodava parseCSV() (parse da base inteira) a
  // cada render do App — qualquer setState em qualquer parte do componente
  // (debounce da simulação, hover, etc.) reparseava o arquivo inteiro de novo,
  // o que travava a aba em bases grandes ("Página sem resposta"). Agora só
  // reparseia quando algo relevante muda, e prioriza o cache populado por
  // onFileChange/reparseWizardFile (parse assíncrono/chunked) em vez de
  // reparsear de forma síncrona.
  const editingCsv = wizard?.editCsvId ? csvStore[wizard.editCsvId] : null;
  const wizardPreview = useMemo(() => {
    if (!wizard) return null;
    // Edição: a base já vive em colunar. Materializa só um punhado de linhas para a
    // tabela de amostra e carrega `count` com o total real (sem materializar 1MM).
    if (wizard.editCsvId) {
      if (!editingCsv) return null;
      const total = rowCount(editingCsv);
      const previewRows = Array.from({length: Math.min(total, 20)}, (_, i) => getRow(editingCsv, i));
      return { headers: editingCsv.headers, rows: previewRows, count: total };
    }
    if (wizard.parsedHeaders && wizard.parsedDelimiter === wizard.delimiter && wizard.parsedHasHeader === wizard.hasHeader) {
      return { headers: wizard.parsedHeaders, rows: wizard.parsedRows, count: wizard.parsedRows.length };
    }
    const parsed = parseCSV(wizard.rawText, wizard.delimiter, wizard.hasHeader);
    return { ...parsed, count: parsed.rows.length };
  }, [wizard?.rawText, wizard?.delimiter, wizard?.hasHeader, wizard?.editCsvId, wizard?.parsedHeaders, wizard?.parsedRows, wizard?.parsedDelimiter, wizard?.parsedHasHeader, editingCsv]);

  const libWizardPreview = useMemo(() => {
    if (!libWizard) return null;
    return parseCSV(libWizard.rawText, libWizard.delimiter, libWizard.hasHeader);
  }, [libWizard?.rawText, libWizard?.delimiter, libWizard?.hasHeader]);

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
    if (hiddenPortIds.has(conn.from) || hiddenPortIds.has(conn.to)) return null; // port escondido em "Configurar nó"
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
    const labelText=conn.label?trunc(conn.label,CONN_LABEL_MAX):null;
    const labelBoxW=labelText?Math.max(56, labelText.length*CONN_LABEL_CW+16):0;

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
            <rect x={lx-labelBoxW/2} y={ly-10} width={labelBoxW} height={20} rx={5}
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
            {csv?`${rowCount(csv)} linhas · ${csv.headers.length} colunas`:"CSV"}
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
    const nRowsCsv = csv ? rowCount(csv) : 0;
    // Materializa só as primeiras MAX_ROWS linhas para o preview (base é colunar).
    const displayRows = csv ? Array.from({length: Math.min(nRowsCsv, MAX_ROWS)}, (_, i) => getRow(csv, i)) : [];
    const truncated = csv && nRowsCsv > MAX_ROWS;

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
            {truncated?`${MAX_ROWS}/${nRowsCsv} linhas`:(`${nRowsCsv} linhas`)} · {csv?.headers.length} colunas
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
                  Exibindo {MAX_ROWS} de {nRowsCsv} linhas
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
    // Domínios efetivos: filtra linhas/colunas por "Configurar nó" (modo manual)
    // ou pelo que efetivamente chega ao nó (modo automático). cells permanece intacto.
    const arr = nodeArrivals[id];
    const rDom = rowVar ? effectiveDomain(rowDomain, shape.visibleRow, arr?.row) : ['*'];
    const cDom = colVar ? effectiveDomain(colDomain, shape.visibleCol, arr?.col) : ['*'];
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
        {(()=>{
          const rightReserve = axisLabels.length > 0 ? 100 : 50;
          const titleMaxChars = Math.max(10, Math.floor((w - 20 - rightReserve) / 6.5));
          return (
            <text x={x+12} y={y+24} fontSize={11} fontWeight="700" fill="#fff"
              fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>⊞ {trunc(shape.label||"Cineminha", titleMaxChars)}</text>
          );
        })()}

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
          const q = qtyIdx >= 0 ? (cellNum(csv, ri, qtyIdx) || 1) : 1;
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
    if (shape.type==="port" && hiddenPortIds.has(shape.id)) return null; // domínio filtrado em "Configurar nó"
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
          if(csv2){const ci=csv2.headers.indexOf(shape.variableCol);if(ci>=0){const cnt=distinctColValues(csv2, ci).length;lines.push(`${cnt} valores distintos`);}}
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

            {/* Sinalização de inferência por referência (Fase 3) */}
            {simResult.inferenceSource === 'ref' && (
              <div style={{padding:"0 10px 8px",flexShrink:0}}>
                <InferenceSignal source={simResult.inferenceSource} confiabVolume={simResult.confiabVolume} weightMode={simResult.inferenceWeightMode} />
              </div>
            )}

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

  const openJohnnyModal = (shapeIds) => {
    const hasCinemas = shapeIds.some(id => shapesR.current.find(s => s.id === id && s.type === 'cineminha'));
    if (!hasCinemas) return;
    const cur = johnnyModalR.current;
    workerRef.current?.postMessage({
      type: 'COMPUTE_JOHNNY',
      shapes: shapesR.current,
      cinemaIds: shapeIds,
      conns: connsR.current,
      lensPopulations: lensPopulationsR.current,
      // Pass user settings if they're already configured (re-open with same cinemas)
      riskLevels:    cur?.riskLevels    || null,
      hierarchyMode: cur?.hierarchyMode || 'cascata',
      inadMetric:    cur?.inadMetric    || 'inferida',
    });
  };

  // Re-sends COMPUTE_JOHNNY with current modal settings + optional overrides.
  // Used when the user changes hierarchyMode, inadMetric or riskLevels.
  const recomputeJohnny = (overrides = {}) => {
    const cur = johnnyModalR.current;
    if (!cur) return;
    workerRef.current?.postMessage({
      type: 'COMPUTE_JOHNNY',
      shapes: shapesR.current,
      cinemaIds: cur.shapeMetas.map(m => m.id),
      conns: connsR.current,
      lensPopulations: lensPopulationsR.current,
      riskLevels:    overrides.riskLevels    ?? cur.riskLevels,
      hierarchyMode: overrides.hierarchyMode ?? cur.hierarchyMode,
      inadMetric:    overrides.inadMetric    ?? cur.inadMetric,
    });
  };

  const applyJohnnyResult = (proposedByShape) => {
    pushHistory();
    setShapes(prev => prev.map(s =>
      proposedByShape[s.id] ? { ...s, cells: proposedByShape[s.id] } : s
    ));
    setJohnnyModal(null);
  };

  // ────────────────────────────────────────────────────────────────────────────
  // JSX
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{display:"flex",flexDirection:"column",width:"100%",height:"100vh",overflow:"hidden",fontFamily:"'DM Sans',system-ui,sans-serif",background:"#f1f5f9"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        .wbt{transition:background .12s,color .12s;}
        .wbt:hover{background:#eff6ff!important;color:#2563eb!important;}
        .wbz:hover{background:#eff6ff!important;color:#2563eb!important;}
        .wbz:active{transform:scale(.93);}
        @media(max-width:560px){.wbl{display:none!important;}}
      `}</style>


      {/* ═══════════════ ANALYSIS PANE ═══════════════ */}
      {activeTab==="analysis" && <AnalysisTab analyticsDataset={groupedDataset} baseDataset={analyticsDataset} analyticsLayout={analyticsLayout} setAnalyticsLayout={setAnalyticsLayout} groupings={analyticsGroupings} setGroupings={setAnalyticsGroupings} pageFilters={analyticsPageFilters} setPageFilters={setAnalyticsPageFilters} />}

      {/* ═══════════════ CANVAS PANE ═══════════════ */}
      <div style={{display:activeTab==="canvas"?"flex":"none",flex:1,minHeight:0,width:"100%",overflow:"hidden",position:"relative"}}>

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
          <button className="wbt" onClick={autoLayout} title="Reorganizar o fluxo (camadas + portas à direita); datasets e componentes soltos vão para a área lateral"
            style={{display:"flex",alignItems:"center",gap:4,padding:"6px 10px",borderRadius:9,border:"none",
              background:"transparent",color:"#475569",
              cursor:"pointer",fontSize:12.5,fontWeight:500,fontFamily:"inherit",flexShrink:0}}>
            <span style={{fontSize:15,lineHeight:1}}>⊹</span>
            <span className="wbl">Reorganizar</span>
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
              <button onClick={()=>openDomainModal(sel)}
                title="Escolher quais valores de linha/coluna aparecem neste Cineminha"
                style={{padding:"5px 14px",borderRadius:7,border:"1px solid #e2e8f0",background:"#fff",
                  color:"#64748b",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                  whiteSpace:"nowrap",fontWeight:600}}>
                ⚙ Domínio
              </button>
              <button onClick={()=>openOptimModal(sel)}
                style={{padding:"5px 14px",borderRadius:7,border:`1px solid ${selCfg.badgeBg}`,background:selCfg.badgeBg,
                  color:selCfg.badgeFg,cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                  whiteSpace:"nowrap",fontWeight:600}}>
                ⚙ Otimizar Decisão
              </button>
              <button onClick={()=>openJohnnyModal([sel])}
                style={{padding:"5px 14px",borderRadius:7,border:"1px solid #fde68a",background:"#fefce8",
                  color:"#92400e",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                  whiteSpace:"nowrap",fontWeight:600}}>
                ⚡ Otimização Johnny
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

        {/* Johnny toolbar — shows when 2+ cineminhas are selected */}
        {multiSel.size>1&&[...multiSel].every(id=>shapes.find(s=>s.id===id)?.type==='cineminha')&&(
          <div style={{position:"absolute",top:110,left:"50%",transform:"translateX(-50%)",zIndex:300,
            display:"flex",gap:4,padding:"5px 8px",borderRadius:10,background:"rgba(255,255,255,.95)",
            border:"1px solid #fde68a",boxShadow:"0 2px 12px rgba(0,0,0,.08)",alignItems:"center"}}>
            <span style={{fontSize:11,color:"#92400e",fontWeight:600,padding:"0 4px"}}>
              ⊞ {multiSel.size} cineminhas
            </span>
            <div style={{width:1,height:20,background:"#fde68a"}}/>
            <button onClick={()=>openJohnnyModal([...multiSel])}
              style={{padding:"5px 14px",borderRadius:7,border:"1px solid #fde68a",background:"#fefce8",
                color:"#92400e",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                whiteSpace:"nowrap",fontWeight:700}}>
              ⚡ Otimização Johnny ({multiSel.size})
            </button>
          </div>
        )}

        {/* Decision (losango) toolbar — shows when a single decision is selected */}
        {selShape?.type==='decision'&&multiSel.size<=1&&(
          <div style={{position:"absolute",top:70,left:"50%",transform:"translateX(-50%)",zIndex:300,
            display:"flex",gap:4,padding:"5px 8px",borderRadius:10,background:"rgba(255,255,255,.95)",
            border:"1px solid #e2e8f0",boxShadow:"0 2px 12px rgba(0,0,0,.08)"}}>
            <button onClick={()=>openDomainModal(sel)}
              title="Escolher quais valores aparecem como saídas deste losango"
              style={{padding:"5px 14px",borderRadius:7,border:"1px solid #fde68a",background:"#fffbeb",
                color:"#92400e",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                whiteSpace:"nowrap",fontWeight:600}}>
              ⚙ Domínio
            </button>
          </div>
        )}

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

                {/* Sinalização de inferência por referência (Fase 3) */}
                {simResult.inferenceSource === 'ref' && (
                  <div style={{ padding: `0 ${s(11)}px ${s(8)}px` }}>
                    <InferenceSignal source={simResult.inferenceSource} confiabVolume={simResult.confiabVolume} weightMode={simResult.inferenceWeightMode} scale={sf} />
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
      <div style={{width:panelCollapsed?28:272,flexShrink:0,background:"#fff",borderLeft:"1px solid #e2e8f0",display:"flex",flexDirection:"column",overflow:"hidden",transition:"width 200ms cubic-bezier(0.4,0,0.2,1)"}}>

        {/* Collapsed strip — only visible when collapsed */}
        {panelCollapsed && (
          <div
            onClick={()=>setPanelCollapsed(false)}
            title="Expandir painel"
            style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",gap:16,
              background:"#fff",transition:"background .15s",userSelect:"none"}}
            onMouseEnter={e=>{e.currentTarget.style.background="#f8fafc";}}
            onMouseLeave={e=>{e.currentTarget.style.background="#fff";}}>
            <div style={{width:20,height:20,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:6,background:"#eff6ff",color:"#3b82f6",fontSize:12,fontWeight:700}}>‹</div>
            <div style={{writingMode:"vertical-rl",textOrientation:"mixed",transform:"rotate(180deg)",fontSize:11,fontWeight:600,color:"#94a3b8",letterSpacing:.5,whiteSpace:"nowrap"}}>Painel</div>
          </div>
        )}

        {/* Full panel content — hidden when collapsed */}
        <div style={{display:panelCollapsed?"none":"flex",flexDirection:"column",flex:1,minHeight:0,overflow:"hidden"}}>

        {/* Header — fixed */}
        <div style={{padding:"12px 14px 10px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:"#3b82f6",boxShadow:"0 0 0 3px #dbeafe",flexShrink:0}}/>
          <span style={{fontSize:13,fontWeight:600,color:"#1e293b",letterSpacing:.1,flex:1}}>Painel</span>
          <BuildBadge />
          <button
            onClick={()=>setPanelCollapsed(true)}
            title="Ocultar painel"
            style={{width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:6,border:"1px solid #e2e8f0",background:"transparent",color:"#94a3b8",cursor:"pointer",fontSize:13,fontWeight:700,lineHeight:1,padding:0,flexShrink:0,transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="#f1f5f9";e.currentTarget.style.color="#475569";e.currentTarget.style.borderColor="#cbd5e1";}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";e.currentTarget.style.borderColor="#e2e8f0";}}>
            ›
          </button>
        </div>

        {/* Scrollable content area */}
        <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>

        {/* Salvar / Abrir Projeto completo */}
        <div style={{padding:"14px 16px",borderBottom:"1px solid #f1f5f9"}}>
          <p style={{fontSize:11,color:"#94a3b8",marginBottom:10,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Projeto</p>
          <button onClick={saveProject}
            title="Salvar todo o estudo num arquivo .credito.json — abas, bases, Tabela de Inferência, gráficos do Dashboard, biblioteca e preferências — para retomar exatamente de onde parou"
            style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"11px 14px",borderRadius:10,border:"none",background:"#16a34a",color:"#fff",cursor:"pointer",fontSize:13.5,fontWeight:600,fontFamily:"inherit",transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="#15803d";}}
            onMouseLeave={e=>{e.currentTarget.style.background="#16a34a";}}>
            <span style={{fontSize:17}}>💾</span> Salvar Projeto
          </button>
          <button onClick={()=>projectInputRef.current?.click()}
            title="Abrir um projeto salvo (.credito.json) — substitui o estudo atual"
            style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"9px 14px",borderRadius:10,border:"1.5px solid #86efac",background:"#f0fdf4",color:"#15803d",cursor:"pointer",fontSize:12.5,fontWeight:500,fontFamily:"inherit",transition:"all .15s",marginTop:8}}
            onMouseEnter={e=>{e.currentTarget.style.background="#dcfce7";e.currentTarget.style.borderColor="#4ade80";}}
            onMouseLeave={e=>{e.currentTarget.style.background="#f0fdf4";e.currentTarget.style.borderColor="#86efac";}}>
            <span style={{fontSize:16}}>📁</span> Abrir Projeto
          </button>
          <input ref={projectInputRef} type="file" accept=".json,.credito.json,application/json" style={{display:"none"}} onChange={onProjectFileChange}/>
          {projectSaveNotice && (
            <div style={{marginTop:8,padding:"7px 10px",borderRadius:8,fontSize:11.5,lineHeight:1.35,display:"flex",alignItems:"flex-start",gap:6,
              background: projectSaveNotice.kind==="ok" ? "#f0fdf4" : "#fef2f2",
              color: projectSaveNotice.kind==="ok" ? "#15803d" : "#b91c1c",
              border: `1px solid ${projectSaveNotice.kind==="ok" ? "#bbf7d0" : "#fecaca"}`}}>
              <span>{projectSaveNotice.kind==="ok" ? "✅" : "⚠️"}</span>
              <span style={{flex:1}}>{projectSaveNotice.msg}</span>
              <span onClick={()=>setProjectSaveNotice(null)} style={{cursor:"pointer",opacity:.6,fontWeight:700}} title="Dispensar">×</span>
            </div>
          )}
        </div>

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

          {/* Tabela de Inferência — slot dedicado (Fase 1) */}
          <button onClick={()=>infRefInputRef.current?.click()}
            style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"9px 14px",borderRadius:10,border:`1.5px dashed ${inferenceRef?"#a78bfa":"#cbd5e1"}`,background:inferenceRef?"#f5f3ff":"#fafafa",color:inferenceRef?"#7c3aed":"#475569",cursor:"pointer",fontSize:12.5,fontWeight:500,fontFamily:"inherit",transition:"all .15s",marginTop:8}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="#7c3aed";e.currentTarget.style.color="#7c3aed";e.currentTarget.style.background="#f5f3ff";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor=inferenceRef?"#a78bfa":"#cbd5e1";e.currentTarget.style.color=inferenceRef?"#7c3aed":"#475569";e.currentTarget.style.background=inferenceRef?"#f5f3ff":"#fafafa";}}>
            <span style={{fontSize:16}}>🧮</span> {inferenceRef ? "Trocar Tabela de Inferência" : "Tabela de Inferência"}
          </button>
          <input ref={infRefInputRef} type="file" accept=".csv,text/csv,.CSV" style={{display:"none"}} onChange={onInferenceRefFileChange}/>
          {inferenceRef && (
            <div style={{marginTop:8,padding:"8px 10px",borderRadius:8,background:"#f5f3ff",border:"1px solid #ddd6fe",fontSize:11,color:"#5b21b6",lineHeight:1.5}}>
              <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"space-between"}}>
                <span style={{fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={inferenceRef.name}>🧮 {inferenceRef.name}</span>
                <button onClick={()=>{setInferenceRef(null);setInfRefError(null);}}
                  title="Remover tabela de referência"
                  style={{border:"none",background:"transparent",color:"#7c3aed",cursor:"pointer",fontSize:13,lineHeight:1,padding:0,flexShrink:0}}>✕</button>
              </div>
              <div style={{marginTop:3,color:"#7c3aed"}}>
                {inferenceRef.keyCols.length} chave(s) · {Object.keys(inferenceRef.levels).length + (inferenceRef.global?1:0)} nível(is) · {inferenceRef.rowCount} linhas
              </div>
              <div style={{marginTop:2,color:"#8b5cf6",fontSize:10,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={inferenceRef.keyCols.join(' · ')}>
                {inferenceRef.keyCols.join(' · ')}
              </div>
              {/* Fase 4 (§9.4): trocar/recarregar a referência recalcula automaticamente
                  o overlay dos estudos que a usam, preservando o inferenceConfig de cada um. */}
              {(()=>{ const n = Object.values(csvStore).filter(c=>c.inferenceConfig?.source==='ref').length;
                return n>0 ? (
                  <div style={{marginTop:6,paddingTop:6,borderTop:"1px dashed #ddd6fe",color:"#6d28d9",fontSize:10,lineHeight:1.4}}>
                    🔄 {n} estudo(s) usando esta referência — trocar recalcula automaticamente (mantém o mapeamento de cada um).
                  </div>
                ) : null; })()}
            </div>
          )}
          {/* Degradação: estudos em modo 'ref' ficam sem a tabela (caem p/ colunas 🔮/🎯)
              quando a referência é removida; o inferenceConfig é preservado p/ recarga. */}
          {!inferenceRef && (()=>{ const n = Object.values(csvStore).filter(c=>c.inferenceConfig?.source==='ref').length;
            return n>0 ? (
              <div style={{marginTop:8,padding:"8px 10px",borderRadius:8,background:"#fffbeb",border:"1px solid #fde68a",fontSize:11,color:"#92400e",lineHeight:1.5}}>
                ⚠ {n} estudo(s) configurado(s) para a Tabela de Inferência. Recarregue-a para retomar a inferência por cascata.
              </div>
            ) : null; })()}
          {infRefError && (
            <div style={{marginTop:8,padding:"8px 10px",borderRadius:8,background:"#fff1f2",border:"1px solid #fecaca",fontSize:11,color:"#b91c1c",lineHeight:1.5}}>
              ⚠ {infRefError}
            </div>
          )}
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
                  <div style={{fontSize:10.5,color:"#94a3b8"}}>{rowCount(csv)} linhas · {csv.headers.length} colunas</div>
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
                  onTouchStart={(e)=>startPanelDrag(e,col,csvId)}
                  style={{display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:8,
                    border:"1.5px solid #fde68a",background:"#fef9c3",marginBottom:4,
                    cursor:"grab",userSelect:"none",fontSize:12,fontWeight:500,color:"#92400e",transition:"all .12s",
                    touchAction:"none"}}
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
        </div>{/* end full panel content */}
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
      {domainModal&&(()=>{
        const shape = shapes.find(s => s.id === domainModal.shapeId);
        if (!shape) return null;
        const draft = domainModal.draft;

        // Define as seções (eixos) conforme o tipo de nó
        const sections = [];
        if (shape.type === 'decision') {
          const full = conns.filter(c => c.from === shape.id).map(c => c.label);
          sections.push({ axis: 'val', title: shape.variableCol || shape.label || 'Saídas', full, counts: nodeArrivals[shape.id]?.val || {} });
        } else if (shape.type === 'cineminha') {
          if (shape.rowVar) sections.push({ axis: 'row', title: `Linhas · ${shape.rowVar.col}`, full: shape.rowDomain || [], counts: nodeArrivals[shape.id]?.row || {} });
          if (shape.colVar) sections.push({ axis: 'col', title: `Colunas · ${shape.colVar.col}`, full: shape.colDomain || [], counts: nodeArrivals[shape.id]?.col || {} });
        }

        const setAxisCfg = (axis, val) => setDomainModal(m => m ? { ...m, draft: { ...m.draft, [axis]: val } } : m);
        const toggleVal = (axis, full, counts, value) => {
          const cur = new Set(effectiveDomain(full, draft[axis], counts));
          if (cur.has(value)) cur.delete(value); else cur.add(value);
          setAxisCfg(axis, full.filter(v => cur.has(v)));
        };
        const setOnlyVolume = (axis, on, full, counts) => setAxisCfg(axis, on ? null : effectiveDomain(full, null, counts));

        return (
          <div onMouseDown={()=>setDomainModal(null)}
            style={{position:"fixed",inset:0,zIndex:4000,background:"rgba(15,23,42,.45)",
              display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',system-ui,sans-serif"}}>
            <div onMouseDown={e=>e.stopPropagation()}
              style={{width:440,maxHeight:"82vh",display:"flex",flexDirection:"column",
                background:"#fff",borderRadius:14,boxShadow:"0 20px 60px rgba(0,0,0,.25)",overflow:"hidden"}}>
              {/* Header */}
              <div style={{padding:"16px 20px",borderBottom:"1px solid #e2e8f0"}}>
                <div style={{fontSize:15,fontWeight:700,color:"#1e293b"}}>⚙ Configurar nó</div>
                <div style={{fontSize:11.5,color:"#94a3b8",marginTop:2}}>
                  {trunc(shape.label||(shape.type==='decision'?'Decisão':'Cineminha'),40)} — escolha quais valores exibir
                </div>
              </div>

              {/* Body */}
              <div style={{padding:"6px 20px 12px",overflow:"auto"}}>
                {sections.length===0&&(
                  <div style={{padding:"24px 0",textAlign:"center",color:"#94a3b8",fontSize:12.5}}>
                    Atribua uma variável a este nó primeiro.
                  </div>
                )}
                {sections.map(({axis,title,full,counts})=>{
                  const isAuto  = !Array.isArray(draft[axis]);
                  const visible = new Set(effectiveDomain(full, draft[axis], counts));
                  return (
                    <div key={axis} style={{marginTop:14}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:.4,marginBottom:6}}>
                        {trunc(title,40)}
                      </div>
                      {/* Auto toggle */}
                      <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",padding:"6px 8px",
                        background:isAuto?"#eff6ff":"#f8fafc",borderRadius:8,border:`1px solid ${isAuto?"#bfdbfe":"#e2e8f0"}`,marginBottom:6}}>
                        <input type="checkbox" checked={isAuto}
                          onChange={e=>setOnlyVolume(axis, e.target.checked, full, counts)}
                          style={{cursor:"pointer"}}/>
                        <span style={{fontSize:12,color:"#1e293b",fontWeight:600}}>Mostrar apenas valores com volume</span>
                      </label>
                      {/* Value list */}
                      <div style={{maxHeight:220,overflow:"auto",border:"1px solid #e2e8f0",borderRadius:8}}>
                        {full.length===0&&(
                          <div style={{padding:"10px 12px",fontSize:12,color:"#94a3b8"}}>Sem domínio.</div>
                        )}
                        {full.map((v,i)=>{
                          const cnt = counts[v] || 0;
                          const checked = visible.has(v);
                          return (
                            <label key={v}
                              style={{display:"flex",alignItems:"center",gap:8,padding:"6px 12px",cursor:"pointer",
                                borderTop:i>0?"1px solid #f1f5f9":"none",
                                background:checked?"#fff":"#fafafa",opacity:cnt>0?1:.6}}>
                              <input type="checkbox" checked={checked}
                                onChange={()=>toggleVal(axis, full, counts, v)} style={{cursor:"pointer"}}/>
                              <span style={{flex:1,fontSize:12.5,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {v}
                              </span>
                              <span style={{fontSize:11,fontWeight:600,color:cnt>0?"#0891b2":"#cbd5e1",
                                fontVariantNumeric:"tabular-nums"}}>{fmtQty(cnt)}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div style={{padding:"12px 20px",borderTop:"1px solid #e2e8f0",display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button onClick={()=>setDomainModal(null)}
                  style={{padding:"7px 16px",borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                    color:"#64748b",cursor:"pointer",fontSize:12.5,fontFamily:"inherit",fontWeight:600}}>
                  Cancelar
                </button>
                <button onClick={()=>applyDomainConfig(domainModal.shapeId, domainModal.draft)}
                  style={{padding:"7px 16px",borderRadius:8,border:"none",background:"#3b82f6",
                    color:"#fff",cursor:"pointer",fontSize:12.5,fontFamily:"inherit",fontWeight:700}}>
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
            const sampleN = Math.min(rowCount(csv), 200);
            for (let r = 0; r < sampleN; r++) {
              const v = String(cellStr(csv, r, idx) ?? "").trim();
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
            // Base colunar: os distintos são o dicionário da coluna (cobertura total,
            // sem amostragem). Já vêm sem vazios; ainda trimamos por segurança.
            for (const v0 of distinctColValues(csv, idx)) {
              const v = String(v0 ?? "").trim();
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

      {/* ═══════════════ CSV IMPORT LOADING MODAL ═══════════════ */}
      {importLoading && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.5)",backdropFilter:"blur(4px)",zIndex:2100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <style>{"@keyframes csvSpin{to{transform:rotate(360deg)}}"}</style>
          <div style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:380,boxShadow:"0 24px 80px rgba(0,0,0,.25)",padding:"30px 32px",display:"flex",flexDirection:"column",gap:16,alignItems:"center",textAlign:"center"}}>
            <div style={{width:38,height:38,borderRadius:"50%",border:"3.5px solid #dbeafe",borderTopColor:"#2563eb",animation:"csvSpin .8s linear infinite"}}/>
            <div>
              <h3 style={{fontSize:14,fontWeight:700,color:"#1e293b",marginBottom:3}}>
                {importLoading.phase==='reading' ? "Lendo arquivo…" : "Processando linhas da base…"}
              </h3>
              <p style={{fontSize:12,color:"#64748b"}}>{importLoading.filename}</p>
            </div>
            <div style={{width:"100%",height:8,borderRadius:6,background:"#f1f5f9",overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:6,background:"#2563eb",width:`${Math.min(100,Math.max(0,importLoading.pct||0))}%`,transition:"width .15s ease"}}/>
            </div>
            <p style={{fontSize:11.5,color:"#94a3b8"}}>{Math.min(100,Math.max(0,importLoading.pct||0))}%</p>
          </div>
        </div>
      )}

      {/* ═══════════════ CSV IMPORT ERROR MODAL ═══════════════ */}
      {csvImportError && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.45)",backdropFilter:"blur(4px)",zIndex:2100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:440,boxShadow:"0 24px 80px rgba(0,0,0,.2)",padding:"28px 32px",display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:40,height:40,borderRadius:12,background:"#fee2e2",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>⚠</div>
              <div>
                <h3 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:2}}>Erro ao Carregar Base</h3>
                <p style={{fontSize:12.5,color:"#64748b",lineHeight:1.5}}>{csvImportError}</p>
              </div>
            </div>
            <button onClick={()=>setCsvImportError(null)}
              style={{alignSelf:"flex-end",padding:"9px 22px",borderRadius:9,border:"none",background:"#2563eb",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>
              Entendido
            </button>
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
                          <input type="radio" name="delim" value={d.value} checked={wizard.delimiter===d.value} onChange={()=>reparseWizardFile({delimiter:d.value})} style={{accentColor:"#3b82f6"}}/>
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
                      <input type="checkbox" checked={wizard.hasHeader} onChange={e=>reparseWizardFile({hasHeader:e.target.checked})} style={{width:16,height:16,accentColor:"#3b82f6"}}/>
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
                    {wizardPreview && <p style={{fontSize:11,color:"#94a3b8",marginTop:6}}>{wizardPreview.count ?? wizardPreview.rows.length} linhas · {wizardPreview.headers.length} colunas encontradas</p>}
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
                // Em edição a base é colunar: cobertura total dos distintos vem do
                // dicionário da coluna (rows4preview é só amostra). No import novo,
                // rows4preview já é o string[][] parseado completo.
                const editingColCsv = wizard.editCsvId ? csvStore[wizard.editCsvId] : null;
                const distinctVals = asIsColIdx < 0 ? []
                  : editingColCsv
                    ? [...new Set(distinctColValues(editingColCsv, editingColCsv.headers.indexOf(wizard.asIsVar)).map(v => String(v ?? '')).filter(v=>v!==''))].sort()
                    : [...new Set(rows4preview.map(r => String(r[asIsColIdx]??'')).filter(v=>v!==''))].sort();
                const mapping = wizard.asIsMapping || {};
                const hasAprovado = distinctVals.some(v => mapping[v]==='APROVADO');
                const hasReprovado = distinctVals.some(v => mapping[v]==='REPROVADO');
                const allMapped = distinctVals.length > 0 && distinctVals.every(v => mapping[v]==='APROVADO'||mapping[v]==='REPROVADO'||mapping[v]==='IGNORAR');

                // ── Origem da inferência (Fase 1) ──
                const refLoaded = !!inferenceRef;
                const useRefSource = wizard.inferenceSource === 'ref' && refLoaded;
                const refKeyCols = inferenceRef?.keyCols || [];
                // Sugestão de de-para base↔referência via normalizeColName.
                const suggestBaseCol = (refKeyCol) => {
                  const target = normalizeColName(refKeyCol);
                  return allHeaders.find(h => normalizeColName(h) === target) || '';
                };
                // Ao escolher a fonte, manter o de-para anterior se válido; senão sugerir.
                const setInferenceSource = (src) => {
                  setWizard(w => {
                    if (src !== 'ref') return { ...w, inferenceSource: src };
                    const prevMap = w.keyMap || {};
                    const km = {};
                    for (const k of refKeyCols) {
                      km[k] = (prevMap[k] !== undefined && prevMap[k] !== null) ? prevMap[k] : suggestBaseCol(k);
                    }
                    const wc = w.weightCol || selMetric['qty'] || '';
                    return { ...w, inferenceSource: 'ref', keyMap: km, weightCol: wc, weightMode: w.weightMode === 'aprovados' ? 'aprovados' : 'propostas' };
                  });
                };
                const setKeyMapEntry = (refKeyCol, baseCol) =>
                  setWizard(w => ({ ...w, keyMap: { ...(w.keyMap||{}), [refKeyCol]: baseCol || '' } }));

                const METRIC_DEFS = [
                  { type:'qty',           icon:'📊', label:'Volume de Propostas',    desc:'Contagem de propostas por grupo' },
                  { type:'qtdAltas',       icon:'📈', label:'Altas Reais',            desc:'Altas/vendas reais observadas' },
                  { type:'inadReal',       icon:'⚠️', label:'Inadimplência Real',     desc:'Atrasos históricos observados' },
                  // 🔮/🎯 vêm da base só no modo "Colunas da base"; ocultos no modo "Tabela de referência".
                  ...(useRefSource ? [] : [
                    { type:'qtdAltasInfer',  icon:'🔮', label:'Conversões Inferidas',   desc:'Altas estimadas pelo modelo de inferência' },
                    { type:'inadInferida',   icon:'🎯', label:'Inadimplência Inferida', desc:'Inadimplência estimada pelo modelo' },
                  ]),
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

                    {/* ── Origem da Inferência (Fase 1) ── */}
                    <div style={{marginBottom:22}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                        <span style={{fontSize:10.5,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.7}}>Origem da Inferência</span>
                        <div style={{flex:1,height:1,background:"#f1f5f9"}}/>
                        <span style={{fontSize:10,color:"#94a3b8",background:"#f8fafc",border:"1px solid #e2e8f0",padding:"1px 8px",borderRadius:10}}>altas / inadimplência</span>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {/* Colunas da própria base (comportamento atual) */}
                        <label style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 12px",borderRadius:9,border:`1.5px solid ${!useRefSource?"#3b82f6":"#e2e8f0"}`,background:!useRefSource?"#eff6ff":"#fafafa",cursor:"pointer"}}>
                          <input type="radio" name="inf-source" checked={!useRefSource} onChange={()=>setInferenceSource('columns')} style={{accentColor:"#3b82f6",marginTop:2}}/>
                          <div>
                            <div style={{fontSize:12.5,fontWeight:600,color:!useRefSource?"#1d4ed8":"#1e293b"}}>Colunas da própria base</div>
                            <div style={{fontSize:10.5,color:"#94a3b8",lineHeight:1.3}}>Mapear 🔮 Conversões Inferidas e 🎯 Inadimplência Inferida acima (comportamento atual).</div>
                          </div>
                        </label>
                        {/* Tabela de referência */}
                        <label style={{display:"flex",alignItems:"flex-start",gap:10,padding:"10px 12px",borderRadius:9,border:`1.5px solid ${useRefSource?"#7c3aed":"#e2e8f0"}`,background:useRefSource?"#f5f3ff":(refLoaded?"#fafafa":"#f8fafc"),cursor:refLoaded?"pointer":"not-allowed",opacity:refLoaded?1:.65}}>
                          <input type="radio" name="inf-source" disabled={!refLoaded} checked={useRefSource} onChange={()=>setInferenceSource('ref')} style={{accentColor:"#7c3aed",marginTop:2}}/>
                          <div style={{flex:1}}>
                            <div style={{fontSize:12.5,fontWeight:600,color:useRefSource?"#6d28d9":"#1e293b"}}>Tabela de referência 🧮</div>
                            <div style={{fontSize:10.5,color:"#94a3b8",lineHeight:1.3}}>
                              {refLoaded
                                ? `Usa a Tabela de Inferência carregada (${inferenceRef.name}) por cascata.`
                                : "Carregue a Tabela de Inferência primeiro (botão 🧮 no painel)."}
                            </div>
                          </div>
                        </label>
                      </div>

                      {useRefSource && (
                        <div style={{marginTop:12,padding:"12px 14px",borderRadius:10,border:"1px solid #ddd6fe",background:"#faf5ff"}}>
                          <p style={{fontSize:11,color:"#6d28d9",lineHeight:1.5,marginBottom:12}}>
                            As taxas de conversão e inadimplência serão buscadas na tabela de referência por cascata
                            (do nível mais granular ao GLOBAL). Informe a coluna da base correspondente a cada chave.
                          </p>
                          <div style={{display:"flex",flexDirection:"column",gap:8}}>
                            {refKeyCols.map((rk,i)=>{
                              const isAnchor = i === 0;
                              const val = (wizard.keyMap||{})[rk] ?? '';
                              return (
                                <div key={rk} style={{display:"grid",gridTemplateColumns:"1fr 12px 1fr",alignItems:"center",gap:8}}>
                                  <span style={{fontSize:12,fontWeight:600,color:"#5b21b6",fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={rk}>
                                    {rk}{isAnchor && <span style={{marginLeft:6,fontSize:9,fontWeight:700,color:"#7c3aed",background:"#ede9fe",padding:"1px 5px",borderRadius:8,letterSpacing:.3}}>ÂNCORA</span>}
                                  </span>
                                  <span style={{color:"#a78bfa",textAlign:"center"}}>→</span>
                                  <select
                                    value={val}
                                    onChange={e=>setKeyMapEntry(rk, e.target.value)}
                                    style={{padding:"6px 10px",borderRadius:8,border:`1.5px solid ${val?"#a78bfa":"#e2e8f0"}`,fontSize:12,fontFamily:"inherit",background:val?"#f5f3ff":"#fff",color:val?"#5b21b6":"#94a3b8",outline:"none",cursor:"pointer",fontWeight:val?600:400}}>
                                    <option value="">— Ausente (desce um nível) —</option>
                                    {allHeaders.map(h=>(<option key={h} value={h}>{h}</option>))}
                                  </select>
                                </div>
                              );
                            })}
                          </div>
                          {/* ── Toggle de peso (Fase 4 / CONTRATO §3.2) ── */}
                          {(()=>{
                            const wMode = wizard.weightMode === 'aprovados' ? 'aprovados' : 'propostas';
                            const suggestApprovedCol = () => allHeaders.find(h => h !== selMetric['qty'] && /aprov/i.test(h)) || '';
                            const setWeightMode = (mode) => setWizard(w => {
                              if (mode === 'aprovados') return { ...w, weightMode: 'aprovados', weightCol: w.weightCol || suggestApprovedCol() || null };
                              return { ...w, weightMode: 'propostas', weightCol: null };
                            });
                            const defaultCol = wMode === 'aprovados' ? (suggestApprovedCol() || '—') : (selMetric['qty'] || '—');
                            const TOGGLE = [
                              { mode:'propostas', icon:'📋', title:'Propostas', sub:'abrir p/ reprovados' },
                              { mode:'aprovados', icon:'✅', title:'Aprovados', sub:'FPD sobre aprovados' },
                            ];
                            return (
                              <div style={{marginTop:12,paddingTop:12,borderTop:"1px dashed #ddd6fe"}}>
                                <div style={{fontSize:12,fontWeight:600,color:"#5b21b6",marginBottom:8}}>⚖️ Peso (base de volume)</div>
                                <div style={{display:"flex",gap:8}}>
                                  {TOGGLE.map(t=>{
                                    const on = wMode === t.mode;
                                    return (
                                      <button key={t.mode} type="button" onClick={()=>setWeightMode(t.mode)}
                                        style={{flex:1,textAlign:"left",padding:"8px 10px",borderRadius:9,border:`1.5px solid ${on?"#7c3aed":"#e2e8f0"}`,background:on?"#f5f3ff":"#fff",cursor:"pointer",fontFamily:"inherit"}}>
                                        <div style={{fontSize:12,fontWeight:700,color:on?"#6d28d9":"#475569"}}>{t.icon} {t.title}{t.mode==='propostas'&&<span style={{marginLeft:6,fontSize:8.5,fontWeight:700,color:"#7c3aed",background:"#ede9fe",padding:"1px 5px",borderRadius:8,letterSpacing:.3}}>PADRÃO</span>}</div>
                                        <div style={{fontSize:10,color:on?"#8b5cf6":"#94a3b8",marginTop:2,lineHeight:1.3}}>{t.sub}</div>
                                      </button>
                                    );
                                  })}
                                </div>
                                <div style={{display:"grid",gridTemplateColumns:"auto 12px 1fr",alignItems:"center",gap:8,marginTop:10}}>
                                  <span style={{fontSize:11,color:"#8b5cf6"}}>Coluna de peso</span>
                                  <span style={{color:"#a78bfa",textAlign:"center"}}>→</span>
                                  <select
                                    value={wizard.weightCol||''}
                                    onChange={e=>setWizard(w=>({...w,weightCol:e.target.value||null}))}
                                    style={{padding:"6px 10px",borderRadius:8,border:`1.5px solid ${wizard.weightCol?"#a78bfa":"#e2e8f0"}`,fontSize:12,fontFamily:"inherit",background:wizard.weightCol?"#f5f3ff":"#fff",color:wizard.weightCol?"#5b21b6":"#94a3b8",outline:"none",cursor:"pointer",fontWeight:wizard.weightCol?600:400}}>
                                    <option value="">{`Automático: ${defaultCol}`}</option>
                                    {allHeaders.map(h=>(<option key={h} value={h}>{h}</option>))}
                                  </select>
                                </div>
                              </div>
                            );
                          })()}
                          <label style={{display:"flex",alignItems:"flex-start",gap:9,marginTop:12,paddingTop:12,borderTop:"1px dashed #ddd6fe",cursor:"pointer"}}>
                            <input
                              type="checkbox"
                              checked={wizard.normalizeScore !== false}
                              onChange={e=>setWizard(w=>({...w,normalizeScore:e.target.checked}))}
                              style={{accentColor:"#7c3aed",marginTop:2}}/>
                            <div>
                              <div style={{fontSize:12,fontWeight:600,color:"#5b21b6"}}>Normalizar score no lookup (R99/vazio → R20)</div>
                              <div style={{fontSize:10.5,color:"#8b5cf6",lineHeight:1.4}}>
                                Trata score ausente como a pior faixa, apenas como chave transitória de busca
                                (fiel ao SAS). Não altera o dado, o domínio nem a exportação.
                              </div>
                            </div>
                          </label>
                          <p style={{fontSize:10,color:"#8b5cf6",marginTop:8,lineHeight:1.4}}>
                            As taxas viram físicos por linha: altas = peso × conv; maus = peso × conv × fpd —
                            agregados como ∑maus / ∑altas (Regras de Ouro do contrato).
                          </p>
                        </div>
                      )}
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
                              const isTemporal = (wizard.columnTypes||{})[colName] === 'temporal';
                              const varType = isTemporal ? 'temporal' : ((wizard.varTypes||{})[colName] || "categorical");
                              const cycle = { categorical:'ordinal', ordinal:'temporal', temporal:'categorical' };
                              const cycleType = () => setWizard(w=>{
                                const next = cycle[varType];
                                const newCols = {...(w.columnTypes||{})};
                                const newVars = {...(w.varTypes||{})};
                                if (next === 'temporal') { newCols[colName] = 'temporal'; }
                                else { if (newCols[colName] === 'temporal') delete newCols[colName]; newVars[colName] = next; }
                                return {...w, columnTypes:newCols, varTypes:newVars};
                              });
                              const st = varType==='temporal'
                                ? {border:'#0891b2',bg:'#ecfeff',color:'#0e7490',label:'⏱ Temporal'}
                                : varType==='ordinal'
                                ? {border:'#7c3aed',bg:'#f5f3ff',color:'#7c3aed',label:'📶 Ordinal'}
                                : {border:'#e2e8f0',bg:'#f8fafc',color:'#64748b',label:'🏷️ Categ.'};
                              return (
                                <div key={colName} style={{display:"grid",gridTemplateColumns:"1fr 120px",alignItems:"center",padding:"8px 14px",borderBottom:i<filterCols.length-1?"1px solid #f1f5f9":"none",background:i%2===0?"#fff":"#fafafa"}}>
                                  <span style={{fontSize:12.5,fontWeight:500,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:8}} title={colName}>{colName}</span>
                                  <div style={{display:"flex",justifyContent:"center"}}>
                                    <button
                                      onClick={cycleType}
                                      style={{padding:"4px 14px",borderRadius:20,border:`1.5px solid ${st.border}`,background:st.bg,color:st.color,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",transition:"all .12s"}}>
                                      {st.label}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        <p style={{fontSize:10.5,color:"#94a3b8",marginTop:8,lineHeight:1.5}}>
                          <strong style={{color:"#7c3aed"}}>Ordinal</strong> = hierarquia natural de risco (ex: score, faixa) · <strong>Categórica</strong> = sem ordem definida · <strong style={{color:"#0e7490"}}>⏱ Temporal</strong> = data/tempo (eixo cronológico na Análise)
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
                      // suggestVarType só amostra os 200 primeiros valores — limitar aqui
                      // evita percorrer a base inteira (×colunas) só para sugerir o tipo.
                      const vals = rows.slice(0, 1000).map(r => r[ci] ?? '').filter(Boolean);
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

      {/* ═══════════════ JOHNNY MODAL ═══════════════ */}
      {johnnyModal&&(()=>{
        const {
          pooledMetrics, frontier, scenarios, mixCats, shapeMetas,
          baselineApprovalRate, activeCard, proposedByShape,
          sliderApprovalIdx, sliderInadReal, sliderInadInf,
          maxInadReal, maxInadInf, activeShapePreview,
          riskLevels, hierarchyMode, inadMetric,
        } = johnnyModal;

        const totalQty  = frontier[frontier.length-1]?.totalQty || 0;
        const maxFIdx   = Math.max(0, frontier.length-1);

        // Compute personalizado metrics from proposedByShape
        let pApprQty=0, pAltas=0, pInadRRaw=0, pInadIRaw=0;
        for (const [pk, m] of Object.entries(pooledMetrics)) {
          if (isCellEligible(proposedByShape[m.shapeId]||{}, m.cellKey)) {
            pApprQty += m.qty; pAltas += m.qtdAltas;
            pInadRRaw += m.inadRRaw; pInadIRaw += m.inadIRaw;
          }
        }
        const personalizado = {
          approvalRate: totalQty > 0 ? pApprQty/totalQty : 0,
          inadReal:     pAltas   > 0 ? pInadRRaw/pAltas  : null,
          inadInferida: pApprQty > 0 ? pInadIRaw/pApprQty: null,
          approvedQty:  pApprQty,
        };

        // Handlers
        const selectFrontierPt = (pt, card) => {
          if (!pt) return;
          const idx = frontier.indexOf(pt);
          setJohnnyModal(m => ({
            ...m, activeCard: card || 'personalizado',
            proposedByShape:   buildProposedByShape(pt.cells, m.shapeMetas, m.pooledMetrics),
            sliderApprovalIdx: idx >= 0 ? idx : m.sliderApprovalIdx,
            sliderInadReal:    pt.inadReal     ?? m.maxInadReal,
            sliderInadInf:     pt.inadInferida ?? m.maxInadInf,
          }));
        };
        const handleApprSlider = (idx) => {
          const pt = frontier[idx];
          if (!pt) return;
          setJohnnyModal(m => ({
            ...m, activeCard: 'personalizado',
            proposedByShape:   buildProposedByShape(pt.cells, m.shapeMetas, m.pooledMetrics),
            sliderApprovalIdx: idx,
          }));
        };
        const handleInadSlider = (val, type) => {
          let best = null;
          for (const pt of frontier) {
            const inad = type==='real' ? pt.inadReal : pt.inadInferida;
            if (inad===null || inad<=val) {
              if (!best || pt.approvalRate > best.approvalRate) best = pt;
            }
          }
          if (!best) return;
          const idx = frontier.indexOf(best);
          setJohnnyModal(m => ({
            ...m, activeCard: 'personalizado',
            proposedByShape:   buildProposedByShape(best.cells, m.shapeMetas, m.pooledMetrics),
            sliderApprovalIdx: idx >= 0 ? idx : m.sliderApprovalIdx,
            [type==='real' ? 'sliderInadReal' : 'sliderInadInf']: val,
          }));
        };
        const toggleJohnnyCell = (shapeId, cellKey, isElig) => {
          const newSC = { ...(proposedByShape[shapeId]||{}), [cellKey]: isElig ? 0 : 1 };
          const newPBS = { ...proposedByShape, [shapeId]: newSC };
          let newApprQty = 0;
          for (const [, m] of Object.entries(pooledMetrics)) {
            if (isCellEligible(newPBS[m.shapeId]||{}, m.cellKey)) newApprQty += m.qty;
          }
          const newRate = totalQty > 0 ? newApprQty/totalQty : 0;
          let nearIdx=0, bestD=Infinity;
          frontier.forEach((pt,i) => { const d=Math.abs(pt.approvalRate-newRate); if(d<bestD){bestD=d;nearIdx=i;} });
          setJohnnyModal(m => ({...m, proposedByShape:newPBS, sliderApprovalIdx:nearIdx, activeCard:'personalizado'}));
        };

        // Cards
        const scen = scenarios;
        const approvalColor = r => r>=0.7?'#16a34a':r>=0.4?'#d97706':'#dc2626';
        const CARD_DEFS = [
          {id:'conservador',     pt:scen.conservador,     icon:'🛡', label:'Conservador',     sub:'Menor risco',      bg:'#dcfce7', fg:'#15803d'},
          {id:'melhorEficiencia',pt:scen.melhorEficiencia,icon:'⚖', label:'Melhor Eficiência',sub:'Joelho da curva',  bg:'#fef9c3', fg:'#a16207'},
          {id:'expansao',        pt:scen.expansao,        icon:'🚀', label:'Expansão',         sub:'Máximo volume',    bg:'#dbeafe', fg:'#1d4ed8'},
          {id:'personalizado',   pt:personalizado,         icon:'🎛', label:'Personalizado',    sub:'Estado atual',     bg:'#f3e8ff', fg:'#7c3aed'},
        ];

        // ── SVG Curve ──
        const CW=440, CH=180, PL=44, PR=16, PT=14, PB=32;
        const plotW=CW-PL-PR, plotH=CH-PT-PB;
        const SAMP = Math.min(frontier.length, 300);
        const sStep = frontier.length > 1 ? (frontier.length-1)/(SAMP-1) : 1;
        const sampled = Array.from({length:SAMP},(_,i)=>frontier[Math.round(i*sStep)]).filter(Boolean);
        const cx = (i) => PL + (i/(Math.max(1,SAMP-1)))*plotW;
        const cy = (r) => PT + (1-r)*plotH;
        const curvePts = sampled.map((p,i)=>`${cx(i)},${cy(p.approvalRate)}`).join(' ');
        const pxOf = (pt) => {
          if (!pt) return null;
          const idx = frontier.indexOf(pt);
          if (idx<0) return null;
          const si = Math.round(idx/Math.max(1,frontier.length-1)*(SAMP-1));
          return {x:cx(si), y:cy(pt.approvalRate)};
        };
        const currentSvgPt = {
          x: cx(Math.round(sliderApprovalIdx/Math.max(1,frontier.length-1)*(SAMP-1))),
          y: cy(personalizado.approvalRate),
        };
        const baselineY = cy(baselineApprovalRate);

        // ── Mix chart ──
        const MIX_ORDER_DEF = ["BAIXISSIMO","BAIXO","MEDIO","ALTO","ALTISSIMO","INDETERMINADO"];
        const MIX_COLORS_DEF = {
          ALTISSIMO:"#e35d6a", ALTO:"#f59e0b", MEDIO:"#e0a84e",
          BAIXO:"#4ea1ff", BAIXISSIMO:"#36c98a", INDETERMINADO:"#94a3b8",
        };
        const ordMix = [
          ...MIX_ORDER_DEF.filter(c=>mixCats.includes(c)),
          ...mixCats.filter(c=>!MIX_ORDER_DEF.includes(c)).sort(),
        ];
        const hasMix = ordMix.length > 0;
        const MH = 100;
        const mixPaths = [];
        if (hasMix) {
          const cumBot = sampled.map(()=>0);
          for (const cat of ordMix) {
            const tops = sampled.map((pt,i) => {
              const tot = pt.approvedQty || 1;
              return cumBot[i] + ((pt.mixBreakdown?.[cat]||0)/tot);
            });
            const topLine = sampled.map((_,i)=>`${cx(i).toFixed(1)},${(PT+(1-tops[i])*MH).toFixed(1)}`).join('L');
            const botLine = sampled.map((_,i)=>`${cx(i).toFixed(1)},${(PT+(1-cumBot[i])*MH).toFixed(1)}`).reverse().join('L');
            mixPaths.push({cat, d:`M${topLine}L${botLine}Z`, color:MIX_COLORS_DEF[cat]||'#94a3b8'});
            tops.forEach((t,i)=>{cumBot[i]=t;});
          }
        }

        // ── Preview matrix for selected cineminha ──
        const prevMeta = shapeMetas.find(m=>m.id===activeShapePreview) || shapeMetas[0];
        const prevCells = prevMeta ? (proposedByShape[prevMeta.id]||{}) : {};
        const prevOrig  = prevMeta?.originalCells || {};
        const prevRDom  = prevMeta?.rowDomain?.length>0 ? prevMeta.rowDomain : ['*'];
        const prevCDom  = prevMeta?.colDomain?.length>0 ? prevMeta.colDomain : ['*'];
        const show2D    = prevMeta?.rowVar && prevMeta?.colVar;

        // ── Per-shape breakdown ──
        const breakdown = shapeMetas.map(meta => {
          let vol=0, propApprQty=0, origApprQty=0, eligible=0, changed=0;
          const rDom = meta.rowDomain.length>0?meta.rowDomain:['*'];
          const cDom = meta.colDomain.length>0?meta.colDomain:['*'];
          for (const rv of rDom) for (const cv of cDom) {
            const ck = `${rv}|${cv}`;
            const pk = `${meta.id}|${ck}`;
            const m  = pooledMetrics[pk];
            if (!m) continue;
            vol += m.qty;
            const propElig = isCellEligible(proposedByShape[meta.id]||{}, ck);
            const origElig = isCellEligible(meta.originalCells||{}, ck);
            if (propElig) { propApprQty += m.qty; eligible++; }
            if (origElig)   origApprQty += m.qty;
            if (propElig !== origElig) changed++;
          }
          const total = rDom.length * cDom.length;
          return { meta, vol, propRate: vol>0?propApprQty/vol:0, origRate: vol>0?origApprQty/vol:0, eligible, total, changed };
        });

        const nCinemas = shapeMetas.length;

        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",backdropFilter:"blur(4px)",
            zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:1200,maxHeight:"96vh",
              boxShadow:"0 32px 100px rgba(0,0,0,.28)",display:"flex",flexDirection:"column",overflow:"hidden"}}>

              {/* Header */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"14px 24px",borderBottom:"1px solid #e2e8f0",flexShrink:0,
                background:"linear-gradient(135deg,#fefce8 0%,#fff7ed 100%)"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:38,height:38,borderRadius:10,background:"#fde68a",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>⚡</div>
                  <div>
                    <h2 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:1}}>Otimização Johnny</h2>
                    <p style={{fontSize:11,color:"#92400e"}}>
                      {nCinemas===1 ? `⊞ ${shapeMetas[0]?.label||'Cineminha'}` : `⊞ ${nCinemas} cineminhas · otimização conjunta`}
                    </p>
                  </div>
                </div>
                <button onClick={()=>setJohnnyModal(null)}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                    cursor:"pointer",fontSize:15,color:"#64748b",display:"flex",alignItems:"center",
                    justifyContent:"center",fontFamily:"inherit"}}>✕</button>
              </div>

              {/* Cards strip */}
              <div style={{display:"flex",gap:8,padding:"12px 20px",borderBottom:"1px solid #f1f5f9",
                flexShrink:0,overflowX:"auto"}}>
                {CARD_DEFS.map(({id,pt,icon,label,sub,bg,fg})=>{
                  const isActive = activeCard===id;
                  const isPerso  = id==='personalizado';
                  const disp     = isPerso ? personalizado : pt;
                  return (
                    <button key={id}
                      onClick={()=>isPerso?null:selectFrontierPt(pt,id)}
                      style={{flex:'1 1 150px',minWidth:130,padding:'10px 12px',borderRadius:12,
                        textAlign:'left',fontFamily:'inherit',transition:'all .15s',
                        cursor:(isPerso||!pt)?'default':'pointer',
                        border:`2px solid ${isActive?fg:'#e2e8f0'}`,
                        background:isActive?bg:'#f8fafc',
                        opacity:(!isPerso&&!pt)?0.45:1}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                        <span style={{fontSize:16}}>{icon}</span>
                        <div>
                          <div style={{fontSize:11,fontWeight:700,color:fg,lineHeight:1.2}}>{label}</div>
                          <div style={{fontSize:9.5,color:'#94a3b8'}}>{sub}</div>
                        </div>
                        {isActive&&<span style={{marginLeft:'auto',fontSize:8,background:fg,color:'#fff',
                          borderRadius:99,padding:'2px 6px',fontWeight:700,flexShrink:0}}>ativo</span>}
                      </div>
                      {disp ? (
                        <div style={{display:'flex',gap:6,justifyContent:'space-between'}}>
                          {[['Aprovação',disp.approvalRate,approvalColor(disp.approvalRate)],
                            ['Inad.Real',disp.inadReal,disp.inadReal===null?'#94a3b8':disp.inadReal>0.05?'#dc2626':'#d97706'],
                            ['Inad.Inf.',disp.inadInferida,disp.inadInferida===null?'#94a3b8':disp.inadInferida>0.05?'#dc2626':'#d97706'],
                          ].map(([lbl,val,col])=>(
                            <div key={lbl} style={{textAlign:'center'}}>
                              <div style={{fontSize:9,color:'#94a3b8',marginBottom:1}}>{lbl}</div>
                              <div style={{fontSize:12,fontWeight:700,color:col}}>{fmtPct(val)}</div>
                            </div>
                          ))}
                        </div>
                      ) : <span style={{fontSize:10,color:'#94a3b8'}}>Dados insuficientes</span>}
                    </button>
                  );
                })}
              </div>

              {/* Body */}
              <div style={{display:"flex",flex:1,overflow:"hidden",minHeight:0}}>

                {/* Left — sliders */}
                <div style={{width:220,flexShrink:0,borderRight:"1px solid #f1f5f9",
                  padding:"16px 16px",display:"flex",flexDirection:"column",gap:12,overflowY:"auto"}}>
                  <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:".06em"}}>
                    Configuração
                  </div>

                  {/* Hierarchy mode */}
                  <div>
                    <div style={{fontSize:11,fontWeight:600,color:"#1e293b",marginBottom:5}}>Modo de Hierarquia</div>
                    <div style={{display:"flex",borderRadius:7,overflow:"hidden",border:"1px solid #e2e8f0",width:"100%"}}>
                      {[['cascata','🔗 Cascata'],['independente','⊕ Independente']].map(([val,lbl])=>(
                        <button key={val}
                          onClick={()=>{setJohnnyModal(m=>({...m,hierarchyMode:val}));recomputeJohnny({hierarchyMode:val});}}
                          style={{flex:1,padding:"5px 4px",fontSize:10,fontWeight:hierarchyMode===val?700:500,
                            fontFamily:"inherit",cursor:"pointer",border:"none",
                            background:hierarchyMode===val?"#f59e0b":"#fff",
                            color:hierarchyMode===val?"#fff":"#64748b",
                            transition:"background .12s,color .12s"}}>
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Inad metric toggle */}
                  <div>
                    <div style={{fontSize:11,fontWeight:600,color:"#1e293b",marginBottom:5}}>Métrica de Inad.</div>
                    <div style={{display:"flex",borderRadius:7,overflow:"hidden",border:"1px solid #e2e8f0",width:"100%"}}>
                      {[['inferida','🎯 Inferida'],['real','⚠ Real']].map(([val,lbl])=>(
                        <button key={val}
                          onClick={()=>{setJohnnyModal(m=>({...m,inadMetric:val}));recomputeJohnny({inadMetric:val});}}
                          style={{flex:1,padding:"5px 4px",fontSize:10,fontWeight:inadMetric===val?700:500,
                            fontFamily:"inherit",cursor:"pointer",border:"none",
                            background:inadMetric===val?"#8b5cf6":"#fff",
                            color:inadMetric===val?"#fff":"#64748b",
                            transition:"background .12s,color .12s"}}>
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{height:1,background:"#f1f5f9"}}/>

                  <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:".06em"}}>
                    Simulação
                  </div>

                  {/* Approval slider */}
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <span style={{fontSize:11,fontWeight:600,color:"#1e293b"}}>Taxa de Aprovação</span>
                      <span style={{fontSize:13,fontWeight:700,color:"#92400e"}}>{Math.round(personalizado.approvalRate*100)}%</span>
                    </div>
                    <input type="range" min={0} max={maxFIdx} step={1} value={sliderApprovalIdx}
                      onChange={e=>handleApprSlider(parseInt(e.target.value))}
                      style={{width:"100%",accentColor:"#f59e0b",cursor:"pointer"}}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#94a3b8",marginTop:2}}>
                      <span>0%</span><span>{Math.round((frontier[maxFIdx]?.approvalRate||0)*100)}%</span>
                    </div>
                  </div>

                  <div style={{height:1,background:"#f1f5f9"}}/>

                  {/* Inad Real ceiling */}
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <span style={{fontSize:11,fontWeight:600,color:"#1e293b"}}>⚠ Teto Inad. Real</span>
                      <span style={{fontSize:12,fontWeight:700,color:"#f59e0b"}}>{fmtPct(sliderInadReal)}</span>
                    </div>
                    <input type="range" min={0} max={maxInadReal} step={maxInadReal/200||0.001}
                      value={sliderInadReal} onChange={e=>handleInadSlider(parseFloat(e.target.value),'real')}
                      style={{width:"100%",accentColor:"#f59e0b",cursor:"pointer"}}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#94a3b8",marginTop:2}}>
                      <span>0%</span><span>{fmtPct(maxInadReal)}</span>
                    </div>
                  </div>

                  {/* Inad Inf ceiling */}
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <span style={{fontSize:11,fontWeight:600,color:"#1e293b"}}>🎯 Teto Inad. Inf.</span>
                      <span style={{fontSize:12,fontWeight:700,color:"#8b5cf6"}}>{fmtPct(sliderInadInf)}</span>
                    </div>
                    <input type="range" min={0} max={maxInadInf} step={maxInadInf/200||0.001}
                      value={sliderInadInf} onChange={e=>handleInadSlider(parseFloat(e.target.value),'inferida')}
                      style={{width:"100%",accentColor:"#8b5cf6",cursor:"pointer"}}/>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#94a3b8",marginTop:2}}>
                      <span>0%</span><span>{fmtPct(maxInadInf)}</span>
                    </div>
                  </div>

                  <div style={{height:1,background:"#f1f5f9"}}/>

                  {/* Current state box */}
                  <div style={{background:"#fefce8",borderRadius:10,padding:"10px 12px",border:"1px solid #fde68a"}}>
                    <div style={{fontSize:9.5,fontWeight:700,color:"#92400e",marginBottom:7,textTransform:"uppercase",letterSpacing:".05em"}}>
                      Estado Proposto
                    </div>
                    {[
                      {label:"Aprovação",   val:`${Math.round(personalizado.approvalRate*100)}%`, color:approvalColor(personalizado.approvalRate)},
                      {label:"Inad. Real",  val:fmtPct(personalizado.inadReal),    color:personalizado.inadReal===null?'#94a3b8':personalizado.inadReal>0.05?'#dc2626':'#d97706'},
                      {label:"Inad. Inf.",  val:fmtPct(personalizado.inadInferida),color:personalizado.inadInferida===null?'#94a3b8':personalizado.inadInferida>0.05?'#dc2626':'#d97706'},
                      {label:"Volume",      val:fmtQty(personalizado.approvedQty), color:'#475569'},
                    ].map(({label,val,color})=>(
                      <div key={label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                        <span style={{fontSize:10.5,color:"#64748b"}}>{label}</span>
                        <span style={{fontSize:11.5,fontWeight:700,color}}>{val}</span>
                      </div>
                    ))}
                  </div>

                  {/* Mode note */}
                  <div style={{fontSize:9.5,color:"#92400e",background:"#fff7ed",borderRadius:8,
                    padding:"7px 10px",border:"1px solid #fed7aa",lineHeight:1.5}}>
                    <strong>{hierarchyMode==='cascata'?'🔗 Cascata':'⊕ Independente'}</strong><br/>
                    {hierarchyMode==='cascata'
                      ? 'Região aprovada de nível menor contém a de nível maior (aninhamento obrigatório).'
                      : 'Cineminhas otimizados sem restrição entre si (pool independente).'}
                    {' '}<strong>{inadMetric==='inferida'?'Inad. Inferida':'Inad. Real'}</strong> guia a ordenação.
                  </div>
                </div>

                {/* Center — curve + mix */}
                <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:"#f8fafc"}}>

                  {/* SVG Curve */}
                  <div style={{padding:"12px 16px 0",flexShrink:0}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",
                      letterSpacing:".06em",marginBottom:8}}>
                      Curva de Aprovação
                    </div>
                    <svg width={CW} height={CH} style={{display:"block",overflow:"visible"}}>
                      {/* Axes */}
                      <line x1={PL} y1={PT} x2={PL} y2={PT+plotH} stroke="#e2e8f0" strokeWidth={1}/>
                      <line x1={PL} y1={PT+plotH} x2={PL+plotW} y2={PT+plotH} stroke="#e2e8f0" strokeWidth={1}/>
                      {/* Y grid & labels */}
                      {[0,.25,.5,.75,1].map(r=>(
                        <g key={r}>
                          <line x1={PL} y1={cy(r)} x2={PL+plotW} y2={cy(r)} stroke="#f1f5f9" strokeWidth={1}/>
                          <text x={PL-4} y={cy(r)+4} textAnchor="end" fontSize={9} fill="#94a3b8">{Math.round(r*100)}%</text>
                        </g>
                      ))}
                      {/* Baseline */}
                      <line x1={PL} y1={baselineY} x2={PL+plotW} y2={baselineY}
                        stroke="#94a3b8" strokeWidth={1} strokeDasharray="4,3"/>
                      <text x={PL+plotW+2} y={baselineY+4} fontSize={8.5} fill="#94a3b8">baseline</text>
                      {/* Curve */}
                      <polyline points={curvePts} fill="none" stroke="#f59e0b" strokeWidth={2.5}
                        strokeLinejoin="round" strokeLinecap="round"/>
                      {/* Scenario dots */}
                      {CARD_DEFS.filter(c=>c.id!=='personalizado').map(c=>{
                        const p = pxOf(c.pt); if(!p) return null;
                        return <circle key={c.id} cx={p.x} cy={p.y} r={5}
                          fill={activeCard===c.id?c.fg:'#fff'} stroke={c.fg} strokeWidth={2}/>;
                      })}
                      {/* Current position */}
                      <circle cx={currentSvgPt.x} cy={currentSvgPt.y} r={6}
                        fill="#f59e0b" stroke="#fff" strokeWidth={2}/>
                      {/* Click overlay */}
                      <rect x={PL} y={PT} width={plotW} height={plotH} fill="transparent" cursor="crosshair"
                        onClick={e=>{
                          const rect=e.currentTarget.getBoundingClientRect();
                          const t=Math.max(0,Math.min(1,(e.clientX-rect.left)/plotW));
                          const idx=Math.round(t*(frontier.length-1));
                          handleApprSlider(idx);
                        }}/>
                      {/* X label */}
                      <text x={PL+plotW/2} y={CH-2} textAnchor="middle" fontSize={9} fill="#94a3b8">
                        ← Conservador · · · Expansão →  ({frontier.length-1} pontos)
                      </text>
                    </svg>
                  </div>

                  {/* Mix chart */}
                  {hasMix && (
                    <div style={{padding:"8px 16px 4px",flexShrink:0}}>
                      <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",
                        letterSpacing:".06em",marginBottom:6}}>
                        Mix de Risco (aprovados)
                      </div>
                      <svg width={CW} height={MH+PT+PB} style={{display:"block",overflow:"visible"}}>
                        <line x1={PL} y1={PT+MH} x2={PL+plotW} y2={PT+MH} stroke="#e2e8f0" strokeWidth={1}/>
                        <line x1={PL} y1={PT} x2={PL} y2={PT+MH} stroke="#e2e8f0" strokeWidth={1}/>
                        {[0,.5,1].map(r=>(
                          <g key={r}>
                            <line x1={PL} y1={PT+(1-r)*MH} x2={PL+plotW} y2={PT+(1-r)*MH} stroke="#f1f5f9" strokeWidth={1}/>
                            <text x={PL-4} y={PT+(1-r)*MH+4} textAnchor="end" fontSize={9} fill="#94a3b8">{Math.round(r*100)}%</text>
                          </g>
                        ))}
                        {mixPaths.map(({cat,d,color})=>(
                          <path key={cat} d={d} fill={color} opacity={0.85}/>
                        ))}
                        {/* Current vertical line */}
                        <line x1={currentSvgPt.x} y1={PT} x2={currentSvgPt.x} y2={PT+MH}
                          stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="3,2"/>
                      </svg>
                      {/* Legend */}
                      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:2}}>
                        {ordMix.map(cat=>(
                          <div key={cat} style={{display:"flex",alignItems:"center",gap:3,fontSize:9.5,color:"#475569"}}>
                            <div style={{width:10,height:10,borderRadius:2,background:MIX_COLORS_DEF[cat]||'#94a3b8',flexShrink:0}}/>
                            {cat}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Breakdown table */}
                  <div style={{flex:1,overflow:"auto",padding:"8px 16px 12px"}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",
                      letterSpacing:".06em",marginBottom:6}}>
                      Detalhamento por Cineminha
                    </div>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"inherit"}}>
                      <thead>
                        <tr style={{background:"#f8fafc"}}>
                          {["Cineminha","Risco","Vol. Pool","Original","Proposta","Elegíveis","Alterações"].map(h=>(
                            <th key={h} style={{padding:"6px 10px",textAlign:"left",fontWeight:600,color:"#64748b",
                              borderBottom:"2px solid #e2e8f0",whiteSpace:"nowrap",fontSize:10.5}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {breakdown.map(({meta,vol,propRate,origRate,eligible,total,changed})=>(
                          <tr key={meta.id}
                            onClick={()=>setJohnnyModal(m=>({...m,activeShapePreview:meta.id}))}
                            style={{cursor:"pointer",background:activeShapePreview===meta.id?'#fefce8':'transparent',
                              transition:"background .1s"}}>
                            <td style={{padding:"6px 10px",borderBottom:"1px solid #f1f5f9",color:"#1e293b",fontWeight:500}}>
                              {meta.label||'Cineminha'}
                            </td>
                            <td style={{padding:"4px 10px",borderBottom:"1px solid #f1f5f9"}}
                              onClick={e=>e.stopPropagation()}>
                              <input type="number" min={1} step={1}
                                value={riskLevels[meta.id]??1}
                                onChange={e=>{
                                  const v = Math.max(1, parseInt(e.target.value)||1);
                                  setJohnnyModal(m=>({...m,riskLevels:{...m.riskLevels,[meta.id]:v}}));
                                }}
                                onBlur={()=>setJohnnyModal(cur=>{
                                  if(cur)workerRef.current?.postMessage({type:'COMPUTE_JOHNNY',shapes:shapesR.current,cinemaIds:cur.shapeMetas.map(m=>m.id),conns:connsR.current,lensPopulations:lensPopulationsR.current,riskLevels:cur.riskLevels,hierarchyMode:cur.hierarchyMode,inadMetric:cur.inadMetric});
                                  return cur;
                                })}
                                style={{width:48,padding:"2px 5px",fontSize:11,fontWeight:700,
                                  border:"1px solid #e2e8f0",borderRadius:5,fontFamily:"inherit",
                                  textAlign:"center",color:"#7c3aed",background:"#f5f3ff"}}/>
                            </td>
                            <td style={{padding:"6px 10px",borderBottom:"1px solid #f1f5f9",color:"#64748b"}}>{fmtQty(vol)}</td>
                            <td style={{padding:"6px 10px",borderBottom:"1px solid #f1f5f9",color:"#64748b"}}>{Math.round(origRate*100)}%</td>
                            <td style={{padding:"6px 10px",borderBottom:"1px solid #f1f5f9",fontWeight:700,
                              color:propRate>origRate?'#16a34a':propRate<origRate?'#dc2626':'#475569'}}>
                              {Math.round(propRate*100)}%
                              {propRate!==origRate&&<span style={{fontSize:9.5,marginLeft:3}}>
                                {propRate>origRate?'▲':'▼'}{Math.abs(Math.round((propRate-origRate)*100))}pp
                              </span>}
                            </td>
                            <td style={{padding:"6px 10px",borderBottom:"1px solid #f1f5f9",color:"#64748b"}}>
                              {eligible}/{total}
                            </td>
                            <td style={{padding:"6px 10px",borderBottom:"1px solid #f1f5f9"}}>
                              {changed>0
                                ? <span style={{fontSize:10,background:"#fef3c7",color:"#92400e",padding:"2px 6px",borderRadius:99,fontWeight:600}}>{changed} células</span>
                                : <span style={{fontSize:10,color:"#94a3b8"}}>sem alteração</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Right — matrix preview */}
                <div style={{width:320,flexShrink:0,borderLeft:"1px solid #f1f5f9",display:"flex",flexDirection:"column",overflow:"hidden"}}>
                  <div style={{padding:"10px 14px 6px",borderBottom:"1px solid #f1f5f9",flexShrink:0}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",
                      letterSpacing:".06em",marginBottom:6}}>
                      Preview · Células
                    </div>
                    {shapeMetas.length > 1 && (
                      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                        {shapeMetas.map(meta=>(
                          <button key={meta.id}
                            onClick={()=>setJohnnyModal(m=>({...m,activeShapePreview:meta.id}))}
                            style={{padding:"3px 8px",borderRadius:6,fontSize:10,fontFamily:"inherit",fontWeight:600,cursor:"pointer",
                              border:`1.5px solid ${activeShapePreview===meta.id?'#f59e0b':'#e2e8f0'}`,
                              background:activeShapePreview===meta.id?'#fefce8':'#fff',
                              color:activeShapePreview===meta.id?'#92400e':'#64748b'}}>
                            {(meta.label||'Cineminha').slice(0,14)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{flex:1,overflow:"auto",padding:"10px 12px"}}>
                    {prevMeta && (
                      <>
                        <div style={{fontSize:9.5,color:"#64748b",marginBottom:6}}>
                          {prevMeta.rowVar?.col && <span>Linha: <strong>{prevMeta.rowVar.col}</strong></span>}
                          {prevMeta.rowVar && prevMeta.colVar && <span style={{margin:"0 4px"}}>×</span>}
                          {prevMeta.colVar?.col && <span>Coluna: <strong>{prevMeta.colVar.col}</strong></span>}
                        </div>
                        <table style={{borderCollapse:"collapse",fontSize:11,fontFamily:"inherit"}}>
                          {show2D && (
                            <thead>
                              <tr>
                                <th style={{width:64,background:"#f1f5f9",border:"1px solid #e2e8f0",
                                  padding:"4px 6px",fontSize:9.5,color:"#94a3b8",fontWeight:600,whiteSpace:"nowrap"}}>
                                  {(prevMeta.rowVar?.col||'').slice(0,7)}·{(prevMeta.colVar?.col||'').slice(0,7)}
                                </th>
                                {prevCDom.map(cv=>(
                                  <th key={cv} style={{width:52,background:"#f1f5f9",border:"1px solid #e2e8f0",
                                    padding:"4px 3px",fontSize:9.5,color:"#475569",fontWeight:600,
                                    textAlign:"center",whiteSpace:"nowrap",overflow:"hidden",
                                    textOverflow:"ellipsis",maxWidth:52}}>
                                    {cv}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                          )}
                          <tbody>
                            {prevRDom.map(rv=>(
                              <tr key={rv}>
                                <td style={{background:"#f1f5f9",border:"1px solid #e2e8f0",
                                  padding:"4px 8px",fontSize:10,fontWeight:600,color:"#475569",whiteSpace:"nowrap"}}>
                                  {show2D ? rv : (prevMeta.rowVar?.col||prevMeta.colVar?.col||'')}
                                </td>
                                {prevCDom.map(cv=>{
                                  const ck = `${rv}|${cv}`;
                                  const isElig = isCellEligible(prevCells, ck);
                                  const wasElig= isCellEligible(prevOrig,  ck);
                                  const changed= isElig !== wasElig;
                                  const pk     = `${prevMeta.id}|${ck}`;
                                  const m      = pooledMetrics[pk];
                                  return (
                                    <td key={cv}
                                      onClick={()=>toggleJohnnyCell(prevMeta.id,ck,isElig)}
                                      style={{width:52,border:`2px solid ${changed?(isElig?'#22c55e':'#ef4444'):'#e2e8f0'}`,
                                        background:isElig?'#dcfce7':'#fee2e2',
                                        textAlign:"center",padding:"4px 2px",cursor:"pointer",
                                        transition:"background .1s",position:"relative"}}>
                                      <div style={{fontSize:13,fontWeight:700,color:isElig?"#15803d":"#dc2626",lineHeight:1}}>
                                        {isElig?"✓":"✗"}
                                      </div>
                                      {m&&m.qty>0&&<div style={{fontSize:8.5,color:"#64748b",marginTop:1}}>{fmtQty(m.qty)}</div>}
                                      {changed&&(
                                        <div style={{position:"absolute",top:1,right:2,fontSize:7.5,
                                          fontWeight:700,color:isElig?'#15803d':'#dc2626'}}>
                                          {isElig?'▲':'▼'}
                                        </div>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div style={{marginTop:8,display:"flex",gap:10,fontSize:9.5,color:"#64748b"}}>
                          <span><span style={{display:"inline-block",width:8,height:8,borderRadius:2,
                            border:"2px solid #22c55e",background:"#dcfce7",marginRight:3}}/>Nova elegível</span>
                          <span><span style={{display:"inline-block",width:8,height:8,borderRadius:2,
                            border:"2px solid #ef4444",background:"#fee2e2",marginRight:3}}/>Nova inelegível</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:"12px 24px",borderTop:"1px solid #e2e8f0",flexShrink:0,background:"#fafafa"}}>
                <button onClick={()=>setJohnnyModal(null)}
                  style={{padding:"8px 18px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",
                    color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
                  Cancelar
                </button>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <span style={{fontSize:11,color:"#94a3b8"}}>
                    {`${Math.round(personalizado.approvalRate*100)}% aprovação · ${fmtQty(personalizado.approvedQty)} propostas`}
                    {nCinemas>1 && ` · ${nCinemas} cineminhas`}
                  </span>
                  <button onClick={()=>applyJohnnyResult(proposedByShape)}
                    style={{padding:"9px 22px",borderRadius:9,border:"none",background:"#f59e0b",color:"#fff",
                      cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit",
                      display:"flex",alignItems:"center",gap:6}}>
                    ⚡ Aplicar{nCinemas>1?` (${nCinemas} cineminhas)`:''}
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
        // Cineminha-alvo: prioriza o nó com que a biblioteca foi aberta (shapeId),
        // mas cai para o nó selecionado no canvas (sel) quando a biblioteca foi
        // aberta pela toolbar global. Assim o rótulo e a ação do botão ficam
        // sempre coerentes, independentemente do ponto de entrada.
        const targetCinema =
          (shapeId ? shapes.find(s => s.id === shapeId && s.type === 'cineminha') : null) ||
          (sel ? shapes.find(s => s.id === sel && s.type === 'cineminha') : null) ||
          null;
        const targetHasConfig = !!(targetCinema && (targetCinema.rowVar || targetCinema.colVar));

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
                              onClick={()=>{ setCinemaLibraryModal(prev=>{ if(!prev) return prev; const cur=prev.selectedLibIds||[]; const sel=cur.includes(item.id); return {...prev,selectedLibIds:sel?cur.filter(id=>id!==item.id):[...cur,item.id]}; }); }}
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
                                <button onClick={(e)=>{ e.stopPropagation(); targetHasConfig ? applyLibraryConfigToCinema(targetCinema.id, item) : loadFromLibraryWithMapping(item); }}
                                  title={targetHasConfig ? "Aplica somente a lógica das caselas ao Cineminha selecionado (mantém variáveis e conexões)" : "Adiciona um novo Cineminha ao canvas"}
                                  style={{padding:"6px 14px",borderRadius:7,border:"1px solid #c7d2fe",background:"#eef2ff",color:"#4f46e5",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",fontWeight:600,whiteSpace:"nowrap"}}>
                                  {targetHasConfig ? "↻ Aplicar caselas" : "+ Adicionar ao Board"}
                                </button>
                                <button onClick={(e)=>{ e.stopPropagation(); deleteFromLibrary(item.id); }}
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
      </div>{/* ── fim CANVAS PANE ── */}

      {/* ═══════════════ TAB BAR (BOTTOM LEFT) — multi-canvas ═══════════════ */}
      <div style={{display:"flex",alignItems:"flex-start",gap:2,background:"#e2e8f0",borderTop:"1px solid #cbd5e1",padding:"0 8px 0",flexShrink:0,alignSelf:"flex-start",overflowX:"auto",maxWidth:"100%"}}>

        {/* Dashboard tab — fixed */}
        {(()=>{
          const active=activeTab==="analysis";
          return (
            <button onClick={()=>setActiveTab("analysis")}
              style={{display:"flex",alignItems:"center",gap:6,padding:"7px 16px",border:"1px solid",flexShrink:0,
                borderColor:active?"#cbd5e1":"transparent",borderTop:active?"1px solid #e2e8f0":"1px solid transparent",
                background:active?"#fff":"transparent",color:active?"#1e293b":"#64748b",
                borderBottomLeftRadius:9,borderBottomRightRadius:9,cursor:"pointer",fontSize:13,
                fontWeight:active?600:500,fontFamily:"inherit",marginTop:-1,transition:"all .12s"}}>
              <span style={{fontSize:14}}>📊</span>Dashboard
            </button>
          );
        })()}

        {/* Canvas tabs */}
        {Object.values(canvases).map(canvas=>{
          const active=activeTab==="canvas"&&activeCanvasId===canvas.id;
          const isRen=renamingCanvasId===canvas.id;
          const tabBorder={border:"1px solid",borderColor:active?"#cbd5e1":"transparent",borderTop:active?"1px solid #e2e8f0":"1px solid transparent"};
          return (
            <div key={canvas.id} style={{display:"flex",alignItems:"stretch",flexShrink:0}}>
              <button
                onClick={()=>{switchCanvas(canvas.id);setActiveTab("canvas");}}
                onDoubleClick={()=>{setRenamingCanvasId(canvas.id);setRenameValue(canvas.name);}}
                style={{display:"flex",alignItems:"center",gap:5,padding:"7px 8px 7px 14px",...tabBorder,borderRight:"none",
                  borderBottomLeftRadius:9,background:active?"#fff":"transparent",color:active?"#1e293b":"#64748b",
                  cursor:"pointer",fontSize:13,fontWeight:active?600:500,fontFamily:"inherit",marginTop:-1,transition:"all .12s"}}>
                {isRen
                  ? <input autoFocus value={renameValue} onChange={e=>setRenameValue(e.target.value)}
                      onBlur={()=>{renameCanvas(canvas.id,renameValue);setRenamingCanvasId(null);}}
                      onKeyDown={e=>{
                        if(e.key==="Enter"){renameCanvas(canvas.id,renameValue);setRenamingCanvasId(null);}
                        if(e.key==="Escape")setRenamingCanvasId(null);
                        e.stopPropagation();
                      }}
                      onClick={e=>e.stopPropagation()}
                      style={{border:"1px solid #93c5fd",borderRadius:4,padding:"1px 4px",fontSize:13,
                        fontFamily:"inherit",outline:"none",width:Math.max(60,renameValue.length*8)}}/>
                  : <span style={{maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{canvas.name}</span>
                }
              </button>
              {/* Accessory strip: dashboard toggle + context menu */}
              <div style={{display:"flex",alignItems:"center",gap:1,padding:"0 5px",...tabBorder,borderLeft:"none",
                borderBottomRightRadius:9,background:active?"#fff":"transparent",marginTop:-1}}>
                <span
                  title={canvas.includeInDashboard?"Incluído no Dashboard (clique para excluir)":"Excluído do Dashboard (clique para incluir)"}
                  onClick={e=>{e.stopPropagation();toggleCanvasInDashboard(canvas.id);}}
                  style={{fontSize:11,cursor:"pointer",opacity:canvas.includeInDashboard?.9:.25,
                    padding:"1px 2px",borderRadius:3,lineHeight:1,transition:"opacity .15s",userSelect:"none"}}>📊</span>
                <span
                  title="Mais ações"
                  onClick={e=>{e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();const menuH=136;const flipUp=window.innerHeight-r.bottom<menuH+8;setCanvasTabMenu({canvasId:canvas.id,x:r.left,flipUp,y:flipUp?r.top-menuH-2:r.bottom+2});}}
                  style={{fontSize:13,fontWeight:700,cursor:"pointer",opacity:.45,padding:"1px 3px",
                    borderRadius:3,lineHeight:1,userSelect:"none",letterSpacing:1}}>⋮</span>
              </div>
            </div>
          );
        })}

        {/* New canvas (+) */}
        <button onClick={createCanvas} title="Novo canvas vazio"
          style={{display:"flex",alignItems:"center",padding:"7px 10px",border:"none",background:"transparent",
            color:"#94a3b8",cursor:"pointer",fontSize:18,lineHeight:1,flexShrink:0,marginTop:0}}
          onMouseEnter={e=>e.currentTarget.style.color="#2563eb"}
          onMouseLeave={e=>e.currentTarget.style.color="#94a3b8"}>+</button>
      </div>

      {/* Context menu for canvas tabs */}
      {canvasTabMenu && createPortal(
        <>
          <div style={{position:"fixed",inset:0,zIndex:9000}} onClick={()=>setCanvasTabMenu(null)}/>
          <div style={{position:"fixed",top:canvasTabMenu.y,left:canvasTabMenu.x,background:"#fff",
            borderRadius:10,border:"1px solid #e2e8f0",
            boxShadow:canvasTabMenu.flipUp?"0 -8px 24px rgba(0,0,0,.12)":"0 8px 24px rgba(0,0,0,.12)",
            minWidth:160,zIndex:9001,overflow:"hidden"}}>
            {[
              {label:"✏️  Renomear",action:()=>{setRenamingCanvasId(canvasTabMenu.canvasId);setRenameValue(canvasesR.current[canvasTabMenu.canvasId]?.name??'');setCanvasTabMenu(null);}},
              {label:"⧉  Duplicar", action:()=>{duplicateCanvas(canvasTabMenu.canvasId);setCanvasTabMenu(null);}},
              {label:"🗑  Excluir",  action:()=>{deleteCanvas(canvasTabMenu.canvasId);setCanvasTabMenu(null);},danger:true},
            ].map(item=>{
              const disabled=item.danger&&Object.keys(canvases).length<=1;
              return (
                <button key={item.label} onClick={disabled?undefined:item.action}
                  style={{display:"block",width:"100%",padding:"10px 16px",border:"none",background:"transparent",
                    cursor:disabled?"not-allowed":"pointer",fontSize:13,fontFamily:"inherit",
                    color:item.danger?(disabled?"#fca5a5":"#dc2626"):"#1e293b",
                    textAlign:"left",opacity:disabled?.5:1}}
                  onMouseEnter={e=>{if(!disabled)e.currentTarget.style.background="#f8fafc";}}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                >{item.label}</button>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
