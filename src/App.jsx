import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList, ScatterChart, Scatter, ZAxis, Cell } from "recharts";
// Armazenamento colunar do csvStore (Otimização de Memória — Fase 1). O csvStore
// guarda as bases vetorizadas (Float64Array + dictionary encoding); todo acesso a
// célula passa pelo accessor abaixo, que também funciona sobre o legado string[][].
import { buildColumnar, isColumnar, rowCount, cellStr, cellNum, getRow, distinctColValues, serializeCsvStore, deserializeCsvStore, buildCsvStoreMessage, METRIC_COL_TYPES, parseCSVToColumnarAsync, finalizeImportedColumns, deriveMappedDictColumn, deriveClusterColumn, retypeColumn, codesCtorForDict, estimateColumnarRamBytes, estimateCsvStoreRamBytes, estimateCsvStoreRowCount, formatRamBytes, RAM_COMFORT_BYTES, ROW_COMFORT_COUNT } from "./columnar.js";
import { applyGoalSeekMoves } from "./goalSeek.js";
import { applySimplifyCandidates } from "./policySimplify.js";
// Variável de Cluster (interpretação da Clusterização H8 — vira coluna Filtro derivada,
// editável, arrastável ao canvas). Módulo puro compartilhado (materialização em columnar.js).
import { suggestClusterVarName, suggestClusterLabels, buildClusterDefFromModel, isClusterVar, renameClusterGroup, toggleValueInGroup, clusterMembershipTable, renameClusterColumnRefs, renameClusterLabelRefs } from "./clusterVar.js";
// Execução Híbrida H4/H6 — ComputeRouter (fronteira única worker/sidecar, DEC-HX-002)
// + funções puras de UX do motor (badge, degradação declarada, aviso de fallback).
import { createComputeRouter, createWorkerProvider, createSidecarProvider, describeComputeBadge, describeCapabilitiesDetail, ceilingNotice, fallbackNoticeText, hashChunks } from "./computeRouter.js";

// ── Build metadata (injected by Vite at build time) ──────────────────────────
const BUILD_NUMBER = typeof __BUILD_NUMBER__ !== "undefined" ? __BUILD_NUMBER__ : "dev";
const BUILD_TIME   = typeof __BUILD_TIME__   !== "undefined" ? __BUILD_TIME__   : new Date().toISOString();
const BUILD_HASH   = typeof __BUILD_HASH__   !== "undefined" ? __BUILD_HASH__   : "local";
const BUILD_BRANCH = typeof __BUILD_BRANCH__ !== "undefined" ? __BUILD_BRANCH__ : "local";
const BUILD_AUTHOR = typeof __BUILD_AUTHOR__ !== "undefined" ? __BUILD_AUTHOR__ : "";
// Modo dev do Vite (servidor local) — decide se os campos URL/token do Motor Python
// aparecem nas preferências (DEC-HX-003: no release o sidecar é same-origin, sem
// config; só no dev ele roda à parte e precisa de URL + token colado pela UI).
const IS_DEV_BUILD = typeof import.meta !== "undefined" && !!(import.meta.env && import.meta.env.DEV);

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

// ── Execução Híbrida H6: UX do Motor Python (badge, degradação declarada, jobs) ──
// Componentes de apresentação puros sobre o `status` do ComputeRouter (H4/H5) — a
// lógica de texto/ícone vive em src/computeRouter.js (testável sem React); aqui só o
// JSX. Ver docs/wiki/Arquitetura-Execucao-Hibrida.md (DEC-HX-001/007/009, §9).
const COMPUTE_BADGE_TONE = {
  full:   { bg: "#f0fdf4", color: "#16a34a", border: "#bbf7d0" },
  stdlib: { bg: "#eff6ff", color: "#2563eb", border: "#bfdbfe" },
  gray:   { bg: "#f8fafc", color: "#94a3b8", border: "#e2e8f0" },
  off:    { bg: "#f8fafc", color: "#94a3b8", border: "#e2e8f0" },
};

// Badge ao lado do BuildBadge: ⚡ tier full / ⚙ tier stdlib / 🐍 ausente (cinza,
// inclui desligado). Clique dispara `onRecheck` — mesma re-checagem do boot
// (DEC-HX-004: `capabilities` é barato, pode ser chamado sob demanda).
function ComputeEngineBadge({ enabled, status, checking, onRecheck }) {
  const [tip, setTip] = useState(false);
  const badge = describeComputeBadge(enabled, status);
  const detailLines = describeCapabilitiesDetail(status);
  const tone = COMPUTE_BADGE_TONE[badge.tone] || COMPUTE_BADGE_TONE.off;

  return (
    <div style={{position:"relative",display:"inline-flex",alignItems:"center"}}
      onMouseEnter={()=>setTip(true)} onMouseLeave={()=>setTip(false)}>
      <span
        onClick={onRecheck}
        title="Clique para verificar a conexão com o Motor Python"
        style={{
          fontSize:9.5,fontWeight:600,color:tone.color,letterSpacing:.3,textTransform:"none",
          background:tone.bg,borderRadius:6,padding:"2px 7px",cursor:"pointer",
          border:`1px solid ${tone.border}`,whiteSpace:"nowrap",userSelect:"none",
          transition:"all .15s",display:"inline-flex",alignItems:"center",gap:4,
        }}>
        <span style={{fontSize:11,lineHeight:1,opacity:checking?0.5:1}}>{checking ? "…" : badge.icon}</span>
        {badge.label}
      </span>
      {tip && (
        <div style={{
          position:"absolute",top:"calc(100% + 6px)",right:0,zIndex:9999,
          background:"#1e293b",color:"#f8fafc",borderRadius:8,
          padding:"10px 13px",fontSize:11,lineHeight:1.8,whiteSpace:"nowrap",
          boxShadow:"0 8px 24px rgba(0,0,0,.25)",pointerEvents:"none",
        }}>
          <div style={{fontWeight:700,fontSize:11.5,marginBottom:4,borderBottom:"1px solid #334155",paddingBottom:4}}>
            🐍 {badge.label}
          </div>
          {badge.detail && <div style={{color:"#94a3b8"}}>{badge.detail}</div>}
          {detailLines.length > 0 && (
            <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"1px 10px",marginTop:4}}>
              {detailLines.map(l => (
                <div key={l.label} style={{display:"contents"}}>
                  <span style={{color:"#94a3b8"}}>{l.label}</span>
                  <span style={{fontFamily:"monospace"}}>{l.value}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{marginTop:6,paddingTop:5,borderTop:"1px solid #334155",color:"#64748b",fontSize:10}}>
            clique para verificar de novo
          </div>
        </div>
      )}
    </div>
  );
}

// Degradação declarada (paridade total, P4, DEC-HX-007): pílula reutilizável por
// qualquer feature Classe B (hoje: só os banners DEC-HX-009; H7/H8 reusam para tetos
// de profundidade/clusterização). `status` vem de `computeSidecarStatus`.
function ComputeCeilingNotice({ ceilingText, unlockedText, status, onOpenPrefs }) {
  const n = ceilingNotice({ ceilingText, unlockedText }, status);
  if (!n.text) return null;
  return (
    <div style={{display:"flex",alignItems:"flex-start",gap:7,padding:"7px 10px",borderRadius:8,
      background:n.capped?"#fdf4ff":"#f0fdf4",border:`1px solid ${n.capped?"#f0abfc":"#bbf7d0"}`,
      fontSize:11,color:n.capped?"#86198f":"#15803d",lineHeight:1.5}}>
      <span style={{fontSize:13,lineHeight:1.3}}>🐍</span>
      <span style={{flex:1}}>{n.text}</span>
      {n.capped && onOpenPrefs && (
        <span onClick={onOpenPrefs} style={{textDecoration:"underline",cursor:"pointer",fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>
          {n.cta}
        </span>
      )}
    </div>
  );
}

// Aviso discreto "concluído no modo browser" — renderizado quando um `router.run()`
// caiu do sidecar pro worker no meio do job (fellBack:true). Nenhuma feature em
// produção roteia pro sidecar ainda (Classe B nasce em H7/H8) — pronto para reuso.
function ComputeFallbackNotice({ runResult }) {
  const text = fallbackNoticeText(runResult);
  if (!text) return null;
  return (
    <div style={{display:"inline-flex",alignItems:"center",gap:5,padding:"3px 8px",borderRadius:6,
      background:"#f8fafc",border:"1px solid #e2e8f0",fontSize:10.5,color:"#94a3b8"}}>
      <span>🌐</span>{text}
    </div>
  );
}

// Corpo do passo "loading" de um job do sidecar — progresso (0..1 ou indeterminado) +
// cancelamento opcional. Mesmo espírito visual do texto simples que `goalSeekModal`/
// `simplifyModal`/`docModal`/`segmentDiscoveryModal` usam hoje no passo `loading`
// (todos Classe A, nunca roteiam pro sidecar — DEC-HX-007); esses modais continuam com
// o texto simples porque não há progresso a mostrar. Este componente é o padrão que
// H7/H8 devem usar quando uma tarefa Classe B de fato rotear pro sidecar.
function ComputeJobProgress({ label, progress, via, onCancel }) {
  const pct = progress == null ? null : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const barColor = via === 'sidecar' ? "#7c3aed" : "#2563eb";
  return (
    <div style={{padding:"24px 4px",textAlign:"center"}}>
      <p style={{fontSize:12.5,color:"#475569",marginBottom:10}}>{label}</p>
      <div style={{height:6,borderRadius:4,background:"#e2e8f0",overflow:"hidden",marginBottom:8}}>
        <div style={{height:"100%",borderRadius:4,background:barColor,
          width: pct == null ? "60%" : `${pct}%`, transition:"width .2s ease"}}/>
      </div>
      <p style={{fontSize:11,color:"#94a3b8"}}>
        {pct == null ? "processando…" : `${pct}%`}{via === 'sidecar' ? " · 🐍 Motor Python" : ""}
      </p>
      {onCancel && (
        <button onClick={onCancel}
          style={{marginTop:10,padding:"6px 14px",borderRadius:8,border:"1px solid #e2e8f0",
            background:"#fff",color:"#64748b",cursor:"pointer",fontSize:11.5,fontWeight:600,fontFamily:"inherit"}}>
          Cancelar
        </button>
      )}
    </div>
  );
}

// Smoke test ponta a ponta do sidecar (`echo_stats` — §17 Fase 1: "sidecar opt-in
// funcionando ponta a ponta com uma tarefa de eco/benchmark"). Fala com o
// `sidecarProviderRef` DIRETO (não via ComputeRouter): é este componente que está
// testando o sidecar em si, não uma feature Classe B com fallback — rotear pelo
// worker aqui não faria sentido (o worker não implementa `echo_stats`, só o sidecar).
function SidecarTestPanel({ status, test, onRun, onCancel, hasDataset }) {
  if (!status || !status.available) {
    return (
      <div style={{fontSize:10.5,color:"#94a3b8",lineHeight:1.5}}>
        Verifique a conexão acima antes de testar o round-trip.
      </div>
    );
  }
  const idle = !test || test.step === 'result' || test.step === 'error';
  return (
    <div style={{padding:"10px 12px",borderRadius:8,border:"1px solid #e2e8f0",background:"#fafafa"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom: test ? 8 : 0}}>
        <span style={{fontSize:11.5,fontWeight:600,color:"#475569"}}>Testar Motor Python (echo_stats)</span>
        {idle && (
          <button onClick={onRun} disabled={!hasDataset}
            title={hasDataset ? "" : "Importe uma base primeiro"}
            style={{padding:"5px 10px",borderRadius:7,border:"none",background:hasDataset?"#7c3aed":"#e2e8f0",
              color:hasDataset?"#fff":"#94a3b8",cursor:hasDataset?"pointer":"default",fontSize:11,fontWeight:600,fontFamily:"inherit"}}>
            ▶ Testar
          </button>
        )}
      </div>

      {test?.step === 'uploading' && (
        <ComputeJobProgress label="Enviando base ao Motor Python — só na primeira vez" progress={null} via="sidecar" onCancel={onCancel}/>
      )}
      {test?.step === 'running' && (
        <ComputeJobProgress label="Rodando echo_stats no Motor Python…" progress={test.progress} via="sidecar" onCancel={onCancel}/>
      )}
      {test?.step === 'result' && test.result && (
        <div style={{fontSize:11.5,color:"#15803d",lineHeight:1.6}}>
          ✅ Round-trip OK — {(test.result.rowCount||0).toLocaleString('pt-BR')} linhas
          {test.result.counted
            ? <> · soma de <code>{test.result.col}</code> = {(test.result.sum||0).toLocaleString('pt-BR')}</>
            : null}.
        </div>
      )}
      {test?.step === 'error' && (
        <div style={{fontSize:11.5,color:"#b91c1c",lineHeight:1.6}}>⚠️ {test.error}</div>
      )}
    </div>
  );
}

// ── H0: Telemetria local de custo (Execução Híbrida — opt-in ?debug=perf) ────
// Mapa request (COMPUTE_*/RUN_SIMULATION) → tipo de resposta *_RESULT correspondente.
// Usado só para casar timestamps por tipo — nunca payload. Ver
// docs/wiki/Arquitetura-Execucao-Hibrida.md (Sessão H0).
const PERF_REQUEST_TO_RESULT = {
  RUN_SIMULATION:            'SIMULATION_RESULT',
  COMPUTE_OVERLAY:           'OVERLAY_RESULT',
  COMPUTE_ASIS_PREVIEW:      'ASIS_PREVIEW_RESULT',
  COMPUTE_OPTIM:             'OPTIM_RESULT',
  COMPUTE_JOHNNY:            'JOHNNY_RESULT',
  COMPUTE_ANALYTICS_DATASET: 'ANALYTICS_RESULT',
  COMPUTE_GOAL_SEEK:         'GOAL_SEEK_RESULT',
  COMPUTE_GOAL_SEEK_CONTEXT: 'GOAL_SEEK_CONTEXT_RESULT',
  COMPUTE_SIMPLIFY:          'SIMPLIFY_RESULT',
  COMPUTE_POLICY_DOC:        'POLICY_DOC_RESULT',
  COMPUTE_SEGMENT_DISCOVERY: 'SEGMENT_DISCOVERY_RESULT',
  COMPUTE_SEGMENT_COMBINED:  'SEGMENT_COMBINED_RESULT',
  COMPUTE_POLICY_INSIGHTS:   'POLICY_INSIGHTS_RESULT',
  COMPUTE_VARIABLE_RANKING:  'VARIABLE_RANKING_RESULT',
};
const PERF_RESULT_TO_REQUEST = Object.fromEntries(
  Object.entries(PERF_REQUEST_TO_RESULT).map(([req, res]) => [res, req])
);
const PERF_RING_SIZE = 200;

function perfPercentile(sortedAsc, p) {
  const n = sortedAsc.length;
  if (n === 0) return null;
  const idx = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1));
  return sortedAsc[idx];
}

function PerfDebugPanel({ telemetryRef }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 500);
    return () => clearInterval(id);
  }, []);

  const buffers = telemetryRef.current?.buffers;
  const rows = buffers ? Array.from(buffers.entries()).map(([reqType, entries]) => {
    const durations = entries.map(e => e.duration).sort((a, b) => a - b);
    const n = durations.length;
    const last = entries[entries.length - 1];
    const avg = n ? durations.reduce((s, d) => s + d, 0) / n : null;
    return {
      reqType,
      resType: PERF_REQUEST_TO_RESULT[reqType],
      count: n,
      lastMs: last ? last.duration : null,
      avgMs: avg,
      p95Ms: perfPercentile(durations, 0.95),
      lastRowCount: last ? last.rowCount : null,
      lastMemMB: last?.memory ? Math.round(last.memory.usedJSHeapSize / 1048576) : null,
    };
  }).sort((a, b) => a.reqType.localeCompare(b.reqType)) : [];

  return (
    <div style={{position:"fixed",bottom:12,right:12,zIndex:99999,background:"#0f172a",color:"#e2e8f0",
      borderRadius:10,padding:"10px 12px",fontSize:11,fontFamily:"monospace",boxShadow:"0 8px 24px rgba(0,0,0,.35)",
      maxWidth:600,maxHeight:360,overflow:"auto"}}>
      <div style={{fontWeight:700,marginBottom:6,color:"#38bdf8"}}>⚡ H0 · Telemetria local do worker (?debug=perf)</div>
      {rows.length === 0 ? (
        <div style={{color:"#94a3b8"}}>Sem medições ainda — edite o canvas ou rode uma análise.</div>
      ) : (
        <table style={{borderCollapse:"collapse",width:"100%"}}>
          <thead>
            <tr style={{color:"#64748b",textAlign:"left"}}>
              <th style={{padding:"2px 10px 4px 0"}}>tipo</th>
              <th style={{padding:"2px 10px"}}>n</th>
              <th style={{padding:"2px 10px"}}>última</th>
              <th style={{padding:"2px 10px"}}>média</th>
              <th style={{padding:"2px 10px"}}>p95</th>
              <th style={{padding:"2px 10px"}}>linhas</th>
              <th style={{padding:"2px 0"}}>heap JS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.reqType}>
                <td style={{padding:"2px 10px 2px 0"}}>{r.reqType}</td>
                <td style={{padding:"2px 10px"}}>{r.count}</td>
                <td style={{padding:"2px 10px"}}>{r.lastMs != null ? `${r.lastMs.toFixed(1)}ms` : "—"}</td>
                <td style={{padding:"2px 10px"}}>{r.avgMs != null ? `${r.avgMs.toFixed(1)}ms` : "—"}</td>
                <td style={{padding:"2px 10px"}}>{r.p95Ms != null ? `${r.p95Ms.toFixed(1)}ms` : "—"}</td>
                <td style={{padding:"2px 10px"}}>{r.lastRowCount ?? "—"}</td>
                <td style={{padding:"2px 0"}}>{r.lastMemMB != null ? `${r.lastMemMB}MB` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

// Heurística do seletor de variáveis da Descoberta de Segmentos (Copiloto Sessão 10):
// colunas de cohort/vintage (mês/safra de referência) e de score já vêm DESMARCADAS por
// padrão no `segmentDiscoveryModal` — a primeira é um artefato temporal/de coleta (não um
// driver de risco acionável, e pode vazar maturação de inadimplência entre safras), a
// segunda costuma já SER o risco (circular) ou já estar em uso em outro nó da política.
// Só define o estado INICIAL do checklist — o usuário marca/desmarca qualquer coluna.
const SEG_TEMPORAL_NAME_TOKENS = new Set(['mes','meses','month','ano','anos','year','safra','vintage','periodo','competencia','data','date','dt']);
const SEG_SCORE_NAME_TOKENS = new Set(['score','rating','bureau']);
function segVarDefaultReason(colName) {
  const norm = (colName || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const tokens = norm.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some(t => SEG_TEMPORAL_NAME_TOKENS.has(t))) return 'temporal';
  if (tokens.some(t => SEG_SCORE_NAME_TOKENS.has(t))) return 'score';
  return null;
}

// ── CSV helpers ──────────────────────────────────────────────────────────────
// Extrai as linhas [start, end) do texto por índice, sem materializar o array
// de todas as linhas do arquivo (equivalente a text.split(/\r?\n/).slice(start,
// end), mas parando de escanear assim que `end` é atingido) — usado pelos
// detectores, que só olham as primeiras linhas mesmo em arquivos grandes.
function sliceLinesByIndex(text, start, end) {
  const result = [];
  const len = text.length;
  let pos = 0;
  let idx = 0;
  while (idx < end && pos <= len) {
    const nl = text.indexOf('\n', pos);
    const rawEnd = nl === -1 ? len : nl;
    let line = text.slice(pos, rawEnd);
    if (line.length > 0 && line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1); // \r final
    if (idx >= start) result.push(line);
    idx++;
    if (nl === -1) break;
    pos = nl + 1;
  }
  return result;
}

function detectDelimiter(text) {
  const lines = sliceLinesByIndex(text, 0, 12).filter(l => l.trim());
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
  const lines = sliceLinesByIndex(text, 1, 60).filter(l => l.trim());
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

// O parse assíncrono/chunked do IMPORT (antigo parseCSVAsync, Fase 0) virou
// parseCSVToColumnarAsync em src/columnar.js (M1): mesma varredura por índice e
// mesmo protocolo de progresso, mas alimentando os encoders colunares
// diretamente — a base nunca existe como string[][]. O parseCSV síncrono acima
// permanece para artefatos pequenos (Tabela de Inferência, biblioteca de
// Cineminha).

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
// A normalização de separador decimal (','→'.') acontece no confirm do wizard,
// sobre os DICIONÁRIOS das colunas (finalizeImportedColumns em src/columnar.js,
// M1) — O(distintos) em vez de uma cópia integral da matriz de linhas.

// ── Serialização do Projeto em partes (M3 — Otimização de Memória) ──────────
// `JSON.stringify(buildProjectPayload())` monta a base inteira (já em base64 —
// ver columnar.js) numa ÚNICA string contígua: com várias colunas de uma base
// diária isso ainda é um pico evitável de memória antes da escrita. Em vez disso,
// monta-se a "casca" do payload (tudo exceto o `csvStore`) e, dentro dele, as
// colunas de cada base UMA POR VEZ — cada `JSON.stringify` cobre só uma coluna
// (no máximo alguns MB em base64), nunca o projeto inteiro. O array resultante é
// tanto uma sequência de `write()` para o `createWritable` (streaming em disco)
// quanto os `BlobPart[]` do fallback `<a download>` — nos dois casos o Blob/stream
// aceita as partes sem que o texto precise existir concatenado na RAM.
// A concatenação das partes é sempre um JSON válido e idêntico, em conteúdo, ao
// que `JSON.stringify(payload)` produziria (só a ordem de escrita muda).
export function buildProjectJSONChunks(payload) {
  const chunks = [];
  const pushKV = (obj, key) => {
    const v = JSON.stringify(obj[key]);
    if (v === undefined) return false; // mesma semântica de JSON.stringify: omite undefined
    chunks.push(JSON.stringify(key) + ':' + v);
    return true;
  };
  const { csvStore, ...rest } = payload;
  chunks.push('{');
  for (const k of Object.keys(rest)) {
    if (pushKV(rest, k)) chunks.push(',');
  }
  chunks.push('"csvStore":{');
  const csvIds = Object.keys(csvStore || {});
  csvIds.forEach((id, ci) => {
    const csv = csvStore[id];
    if (csv && csv.columns) {
      const { columns, ...csvRest } = csv;
      chunks.push(JSON.stringify(id) + ':{');
      for (const k of Object.keys(csvRest)) {
        if (pushKV(csvRest, k)) chunks.push(',');
      }
      chunks.push('"columns":{');
      const colNames = Object.keys(columns);
      colNames.forEach((name, cj) => {
        chunks.push(JSON.stringify(name) + ':' + JSON.stringify(columns[name]));
        if (cj < colNames.length - 1) chunks.push(',');
      });
      chunks.push('}}');
    } else {
      // Entrada legada (sem `columns`) — pequena o bastante para ir de uma vez.
      chunks.push(JSON.stringify(id) + ':' + JSON.stringify(csv));
    }
    if (ci < csvIds.length - 1) chunks.push(',');
  });
  chunks.push('}'); // fecha csvStore
  chunks.push('}'); // fecha o objeto raiz
  return chunks;
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

// DFS iterativo com marcação tricolor (IN_PROGRESS/DONE) + memoização do resultado por nó
// (M13) — equivalente ao DFS recursivo anterior (que copiava `new Set(path)` por aresta
// visitada, O(V×E) em fluxos com losangos encadeados), mas sem cópias e O(V+E): um nó só é
// expandido uma vez (memoizado via `okOf`), e o back-edge para um nó IN_PROGRESS já indica
// ciclo, sem precisar reconstruir o conjunto de ancestrais do caminho atual.
function validateFlow(shapes, conns) {
  const errors = {};
  const FLOW = new Set(['decision','port','approved','rejected','as_is','cineminha','decision_lens']);
  const TERM = new Set(['approved','rejected','as_is']);
  const flowShapes = shapes.filter(s => FLOW.has(s.type));
  if (flowShapes.length === 0) return errors;
  const {out} = buildFlowGraph(shapes, conns);
  const shapesById = new Map(shapes.map(s => [s.id, s]));

  const IN_PROGRESS = 1, DONE = 2;
  const state = new Map();
  const okOf = new Map();

  // Resolve nós triviais (inexistente / terminal / sem saída) sem empilhar frame;
  // marca IN_PROGRESS e devolve o frame para os demais (equivalente a `path.add(nodeId)`
  // antes de recursar nos filhos).
  function makeFrame(nodeId) {
    const node = shapesById.get(nodeId);
    if (!node) { state.set(nodeId, DONE); okOf.set(nodeId, false); return null; }
    if (TERM.has(node.type)) { state.set(nodeId, DONE); okOf.set(nodeId, true); return null; }
    const edges = out[nodeId] || [];
    if (edges.length === 0) {
      if (!errors[nodeId]) errors[nodeId] = 'Caminho sem finalização';
      state.set(nodeId, DONE); okOf.set(nodeId, false);
      return null;
    }
    state.set(nodeId, IN_PROGRESS);
    return { id: nodeId, edges, i: 0, ok: true };
  }

  function visit(rootId) {
    if (state.get(rootId) === DONE) return;
    const root = makeFrame(rootId);
    if (!root) return;
    const stack = [root];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (frame.i < frame.edges.length) {
        const to = frame.edges[frame.i++].to;
        const st = state.get(to);
        if (st === IN_PROGRESS) {
          if (!errors[to]) errors[to] = 'Loop infinito detectado';
          frame.ok = false;
        } else if (st === DONE) {
          if (!okOf.get(to)) frame.ok = false;
        } else {
          const child = makeFrame(to);
          if (child) stack.push(child);
          else if (!okOf.get(to)) frame.ok = false;
        }
        continue;
      }
      stack.pop();
      state.set(frame.id, DONE);
      if (!frame.ok && !errors[frame.id]) errors[frame.id] = 'Possui caminhos sem finalização';
      okOf.set(frame.id, frame.ok);
      if (stack.length && !frame.ok) stack[stack.length - 1].ok = false;
    }
  }

  for (const s of shapes) {
    if (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') visit(s.id);
  }
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
function buildAnalyticsCSVParts(ds) {
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

function exportAnalyticsDatasetCSV(ds) {
  const parts = buildAnalyticsCSVParts(ds);
  if (!parts) return;
  const blob = new Blob(["﻿", ...parts], { type: "text/csv;charset=utf-8;" });
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

// ── computeAsIsCells ─────────────────────────────────────────────────────────
// Deriva uma prévia de elegibilidade a partir da decisão histórica (AS IS,
// coluna __DECISAO_ORIGINAL). Agrega o volume APROVADO/REPROVADO por interseção
// (rowVal|colVal): caselas com aprovações herdam a decisão da política atual
// (elegível = a AS IS aprovou → baseline). Uma casela só é marcada NÃO elegível
// (0) quando 100% do volume DECIDIDO da interseção é REPROVADO (nenhuma
// aprovação); caselas sem decisão/volume ficam elegíveis (1). Retorna null
// quando não há decisão AS IS disponível para o dataset (sem prévia).
export function computeAsIsCells(shape, csvStore) {
  const { rowVar, colVar, rowDomain, colDomain } = shape;
  const csvId = rowVar?.csvId || colVar?.csvId;
  if (!csvId) return null;
  const csv = csvStore?.[csvId];
  if (!csv) return null;
  const decIdx = csv.headers.indexOf('__DECISAO_ORIGINAL');
  if (decIdx === -1) return null;
  const types = csv.columnTypes || {};
  const qtyCol = Object.entries(types).find(([, t]) => t === 'qty')?.[0];
  const qtyIdx = qtyCol != null ? csv.headers.indexOf(qtyCol) : -1;
  const rowCI = rowVar ? csv.headers.indexOf(rowVar.col) : -1;
  const colCI = colVar ? csv.headers.indexOf(colVar.col) : -1;
  const rDom = rowDomain?.length > 0 ? rowDomain : ['*'];
  const cDom = colDomain?.length > 0 ? colDomain : ['*'];
  const acc = {};
  for (const rv of rDom) for (const cv of cDom) acc[`${rv}|${cv}`] = { ap: 0, rp: 0 };
  const nRows = rowCount(csv);
  for (let r = 0; r < nRows; r++) {
    const rv = rowVar && rowCI >= 0 ? (cellStr(csv, r, rowCI) ?? '').toString().trim() : '*';
    const cv = colVar && colCI >= 0 ? (cellStr(csv, r, colCI) ?? '').toString().trim() : '*';
    const cell = acc[`${rv}|${cv}`];
    if (!cell) continue;
    const dec = (cellStr(csv, r, decIdx) ?? '').toString().trim().toUpperCase();
    if (dec !== 'APROVADO' && dec !== 'REPROVADO') continue;
    const qty = qtyIdx >= 0 ? (cellNum(csv, r, qtyIdx) || 0) : 1;
    if (dec === 'APROVADO') cell.ap += qty; else cell.rp += qty;
  }
  const cells = {};
  for (const rv of rDom) for (const cv of cDom) {
    const key = `${rv}|${cv}`;
    const { ap, rp } = acc[key];
    // NÃO elegível só quando 100% do volume decidido é REPROVADO (sem aprovações).
    cells[key] = (rp > 0 && ap === 0) ? 0 : 1;
  }
  return cells;
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

// Goal Seek (Copiloto Sessão 4, DEC-IA-005/006) — metadados de UI do objetivo estruturado.
// `scale`: 'pp100' = escala 0–100 (approvalRate, já nessa escala no motor); 'ratio' =
// 0–1 (inadReal/inadInferida — mesma escala dos sliders do optimModal/johnnyModal);
// 'qty' = unidade absoluta (approvedAltasInfer, Vol. Vendas Inferidas).
const GOAL_SEEK_TARGET_META = {
  approvalRate:      { label: "Taxa de Aprovação",     scale: "pp100", fmt: v => fmtPct(v / 100) },
  inadReal:          { label: "Inad. Real",            scale: "ratio", fmt: v => fmtPct(v) },
  inadInferida:      { label: "Inad. Inferida",        scale: "ratio", fmt: v => fmtPct(v) },
  approvedAltasInfer:{ label: "Vol. Vendas Inferidas", scale: "qty",   fmt: v => fmtQty(v) },
};
const GOAL_SEEK_TARGET_LABELS = Object.fromEntries(Object.entries(GOAL_SEEK_TARGET_META).map(([k, v]) => [k, v.label]));
// GS1 (DEC-GS-002) — os 3 cards fixos de "Ponto de partida" (mock da wiki: sempre estas
// 3 métricas, nesta ordem, independente do alvo/direção declarados no form).
const GOAL_SEEK_CONTEXT_CARDS = [
  { k: 'approvalRate', label: 'Taxa de Aprovação' },
  { k: 'inadInferida', label: 'Inad. Inferida' },
  { k: 'inadReal',     label: 'Inad. Real' },
];
// GS2 (DEC-GS-003) — opções de "Minimizar colateralmente". `collidesWith` é o alvo cujo
// campo é o mesmo do minimize (minimizar a própria coisa que se quer mexer não faz sentido);
// a opção colidente é escondida do select e resetada ao trocar o alvo.
const GOAL_SEEK_MINIMIZE_OPTS = [
  { value: 'inadInferida', label: 'Inad. Inferida',           collidesWith: 'inadInferida' },
  { value: 'inadReal',     label: 'Inad. Real',               collidesWith: 'inadReal' },
  { value: 'approval',     label: 'Impacto em Aprovação',     collidesWith: 'approvalRate' },
  { value: 'salesVolume',  label: 'Vol. de Vendas impactado', collidesWith: 'approvedAltasInfer' },
];
// Reset da DEC-GS-003: se o minimize atual colide com o novo alvo, volta para 'inadInferida'
// — ou 'approval' quando o alvo é uma inadimplência (senão colidiria de novo).
function goalSeekResolveMinimize(target, minimize) {
  const cur = minimize || 'inadInferida';
  const opt = GOAL_SEEK_MINIMIZE_OPTS.find(o => o.value === cur);
  if (opt && opt.collidesWith === target) {
    return (target === 'inadReal' || target === 'inadInferida') ? 'approval' : 'inadInferida';
  }
  return cur;
}
// GS6 (DEC-GS-005/006) — busca ótima MILP no sidecar. Nº de níveis da fronteira 2D
// pedido ao solver (mesmo default documentado na wiki); `timeLimitSec` por subproblema.
const GOAL_SEEK_FRONTIER_POINTS = 13;
const GOAL_SEEK_TIME_LIMIT_SEC = 20;

// Copiloto — lint estrutural (Sessão 1, DEC-IA-006). Estilo por severidade do achado
// (findings vêm de COMPUTE_POLICY_INSIGHTS, sempre {severity, code, nodeId, msg, fix?}).
const COPILOT_SEV_META = {
  error:   { emoji: "🔴", color: "#b91c1c", bg: "#fef2f2", border: "#fecaca" },
  warning: { emoji: "🟡", color: "#92400e", bg: "#fffbeb", border: "#fde68a" },
  info:    { emoji: "🔵", color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
};

// Simplificação com prova de equivalência (Copiloto Sessão 5, DEC-IA-005/006) — metadados
// de UI por tipo de candidato do catálogo (findings vêm de COMPUTE_SIMPLIFY/SIMPLIFY_RESULT).
const SIMPLIFY_CODE_META = {
  collapsible_node:   { icon: "🔗", label: "Nó colapsável" },
  zero_arrival_node:  { icon: "🕳", label: "Chegada zero" },
  lens_no_effect:     { icon: "🎚", label: "Regra sem efeito" },
  redundant_variable: { icon: "🔁", label: "Variável re-testada" },
};

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

const fmtMetricVal = (v, unit) => v == null ? "N/A" : unit === "qty" ? fmtQty(v) : `${v.toFixed(1)}%`;

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
    // Quebra por dimensão categórica usando o cenário Simulado implícito.
    const simCol = (scenarios.find(s => s.id === "simulado") || scenarios[scenarios.length - 1]).decisionCol;
    if (serieBy === SERIE_NONE) {
      seriesDefs = [{ key: "simulado", label: "Simulado", decisionCol: simCol, color: SCENARIO_COLORS[1] }];
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
export function newFilterCard() {
  return { id: uid(), dim: null, mode: "basic", selected: null, rules: [] };
}

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
                <div key={w.id} style={{ position: "absolute", left: w.x ?? 24, top: w.y ?? 24, width: w.w ?? 560, height: w.h ?? 500 }}>
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
  const connIdMap = {};
  const newConns  = conns.map(c => {
    const newId = uid();
    connIdMap[c.id] = newId;
    return {
      ...c, id: newId,
      from: idMap[c.from] ?? c.from,
      to:   idMap[c.to]   ?? c.to,
    };
  });
  // idMap traduz shapeId (e connId, via connIdMap) do canvas original → o clonado —
  // usado por quem precisa reaplicar referências por ID sobre o clone (ex.: Goal Seek,
  // Copiloto Sessão 4 — applyGoalSeekMoves usa shapeId/connId do canvas original).
  return { newShapes, newConns, idMap: { ...idMap, ...connIdMap } };
}

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
const POLICY_TERMINAL_LABELS = { approved: 'Aprovado', rejected: 'Reprovado', as_is: 'AS IS' };

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

// ── Documentação Automática (Copiloto Sessão 6, DEC-IA-006) ──────────────────
// O worker (COMPUTE_POLICY_DOC/POLICY_DOC_RESULT) devolve o docModel — árvore de
// seções com dados NUMÉRICOS CRUS, nunca prosa pronta. As funções abaixo são a
// APRESENTAÇÃO: puras (mesmo docModel ⇒ mesmo texto, sem tocar worker/csvStore),
// para que o Nível 2 (reescrita em prosa por IA) receba o docModel e não HTML, e para
// que o GATE (tests/policyDoc.test.js) possa verificar determinismo/privacidade só
// inspecionando string de saída.

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

// Hash não-criptográfico curto (FNV-1a 32-bit) — só para o carimbo de rastreabilidade
// do documento ("hash da política"), nunca para integridade/segurança.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
function hashPolicyIR(ir) {
  const { generatedAt, ...rest } = ir || {};
  return fnv1a(JSON.stringify(rest));
}

const LENS_OP_LABEL = Object.fromEntries(LENS_OPERATORS.map(o => [o.value, o.label]));
const fmtPct100 = (v) => v == null ? 'N/A' : `${v.toFixed(2)}%`;
const fmtDelta100 = (v) => v == null ? 'N/A' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}pp`;

function describeLensRule(rule) {
  const opLabel = LENS_OP_LABEL[rule.operator] || rule.operator;
  const valueText = rule.value == null ? '(valor omitido)' : `"${rule.value}"`;
  return `${rule.col ?? '?'} ${opLabel} ${valueText}`;
}
function describeLensRules(rules) {
  if (!rules || rules.length === 0) return '(sem regras — deixa passar 100% do volume)';
  let out = describeLensRule(rules[0]);
  for (let i = 1; i < rules.length; i++) out += (rules[i - 1].logic === 'OR' ? ' OU ' : ' E ') + describeLensRule(rules[i]);
  return out;
}
// Condição de um path achatado (raiz→terminal) — texto plano, reusado por Markdown/HTML.
function describeCondition(cond) {
  if (cond.kind === 'decision') {
    return cond.values
      ? `${cond.col || cond.label} ∈ {${cond.values.join(', ')}}`
      : `${cond.col || cond.label} (${cond.valueCount} valor(es), domínio omitido)`;
  }
  if (cond.kind === 'cinema') return `${cond.label}: ${cond.eligible ? 'elegível' : 'não elegível'}`;
  if (cond.kind === 'lens') return `${cond.label}: ${describeLensRules(cond.rules)}`;
  return cond.label || '?';
}
const PATH_REASON_LABEL = {
  ciclo: 'ciclo no fluxo (loop) — não finaliza',
  sem_destino: 'sem destino conectado — não finaliza',
  destino_inexistente: 'destino inexistente — não finaliza',
  sem_rotas: 'sem rotas configuradas — não finaliza',
};
function describeFlowNode(fn) {
  if (fn.kind === 'decision') {
    const routesText = fn.routes.map(r => {
      const dest = r.to || '(sem destino)';
      const vals = r.values ? `{${r.values.join(', ')}}` : `${r.valueCount} valor(es) (domínio omitido)`;
      return `${vals} → ${dest}`;
    }).join('; ');
    return `Segmenta as propostas por **${fn.variable?.col || fn.label}**: ${routesText || '(sem rotas)'}.`;
  }
  if (fn.kind === 'cinema') {
    const axis = [fn.rowVar?.col, fn.colVar?.col].filter(Boolean).join(' × ') || '(sem eixos configurados)';
    const cellsText = fn.blockedCells
      ? `${fn.blockedCells.length} de ${fn.totalCells} combinação(ões) não elegível(is): ${fn.blockedCells.join(', ') || '(nenhuma)'}`
      : `${fn.blockedCount} de ${fn.totalCells} combinação(ões) não elegível(is) (domínio omitido)`;
    return `Matriz cruzada (Cineminha) sobre **${axis}**: ${cellsText}.`;
  }
  if (fn.kind === 'lens') return `Filtra a população por: ${describeLensRules(fn.rules)}.`;
  if (fn.kind === 'terminal') {
    if (fn.terminal === 'approved') return `Encerra o caminho como **Aprovado**.`;
    if (fn.terminal === 'rejected') return `Encerra o caminho como **Reprovado**.`;
    return `Encerra o caminho mantendo a **decisão histórica (AS IS)**.`;
  }
  return '';
}
function describePath(p) {
  const conds = p.conditions.map(describeCondition).join(' E ') || '(sem condições — raiz é terminal)';
  if (p.terminal) return `SE ${conds} ⇒ ${POLICY_TERMINAL_LABELS[p.terminal] || p.terminal}`;
  return `SE ${conds} ⇒ (${PATH_REASON_LABEL[p.reason] || 'sem finalização'})`;
}

function mdTable(headers, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function mdBoldToHtml(s) {
  return escHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
function htmlTable(headers, rows) {
  const th = headers.map(h => `<th>${escHtml(h)}</th>`).join('');
  const trs = rows.map(r => `<tr>${r.map(c => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

// Renderiza o docModel como Markdown — download `.md` (item 7 do épico). Determinístico:
// mesmo docModel ⇒ mesma string (exceto `generatedAt`, carimbado à parte).
export function renderDocMarkdown(docModel) {
  if (!docModel) return '';
  const { meta, ir, flowNodes, paths, kpis, funnel, reliability, scenarios, glossary, changelog, options } = docModel;
  const L = [];
  const p = (s = '') => L.push(s);

  p(`# Documento de Política de Crédito${meta?.name ? ` — ${meta.name}` : ''}`);
  p('');
  p(`_Gerado em ${new Date(docModel.generatedAt).toLocaleString('pt-BR')} · build #${BUILD_NUMBER} (${BUILD_HASH}) · hash da política: ${hashPolicyIR(ir)}${options?.includeDomains ? '' : ' · domínios de valores omitidos'}_`);
  p('');

  p('## Sumário Executivo');
  p('');
  const { simResult, incrementalResult } = kpis || {};
  if (simResult) {
    p(`- **Taxa de Aprovação (simulada):** ${fmtPct100(simResult.approvalRate)}`);
    p(`- **Inad. Real:** ${fmtPct(simResult.inadReal)}`);
    p(`- **Inad. Inferida:** ${fmtPct(simResult.inadInferida)}`);
    p(`- **Volume total:** ${fmtQty(simResult.totalQty)} (✅ ${fmtQty(simResult.approvedQty)} · ❌ ${fmtQty(simResult.rejectedQty)}${simResult.asIsQty ? ` · ⟳ ${fmtQty(simResult.asIsQty)}` : ''})`);
  }
  if (incrementalResult) {
    p('');
    p('**Comparativo vs. AS IS**');
    p('');
    p(mdTable(
      ['', 'AS IS', 'Simulado', 'Delta'],
      [
        ['Taxa de Aprovação', fmtPct100(incrementalResult.baseline.approvalRate), fmtPct100(incrementalResult.simulated.approvalRate), fmtDelta100(incrementalResult.impacted.approvalDelta)],
        ['Inad. Real', fmtPct(incrementalResult.baseline.inadReal), fmtPct(incrementalResult.simulated.inadReal), ''],
        ['Inad. Inferida', fmtPct(incrementalResult.baseline.inadInferida), fmtPct(incrementalResult.simulated.inadInferida), ''],
      ],
    ));
    p('');
    p(`População impactada: ${fmtQty(incrementalResult.impacted.qty)} (${fmtPct100(incrementalResult.impacted.pct)}) — ${fmtQty(incrementalResult.impacted.rToA)} promovida(s) (Reprovado→Aprovado), ${fmtQty(incrementalResult.impacted.aToR)} rejeitada(s) a mais (Aprovado→Reprovado).`);
  } else {
    p('');
    p('_Baseline AS IS não configurada — sem comparativo disponível._');
  }
  p('');

  p('## Fluxo da Política');
  p('');
  if (!flowNodes || flowNodes.length === 0) {
    p('_Canvas vazio — nenhum nó de fluxo._');
  } else {
    for (const fn of flowNodes) p(`- **${fn.label}** _(${fn.kind})_ — ${describeFlowNode(fn)}`);
  }
  p('');

  p('## Regras Achatadas (raiz → terminal)');
  p('');
  if (!paths || paths.list.length === 0) {
    p('_Sem caminhos — nenhuma raiz de fluxo configurada._');
  } else {
    paths.list.forEach((path, i) => p(`${i + 1}. ${describePath(path)}`));
    if (paths.truncated) p('');
    if (paths.truncated) p('_(lista truncada — política com combinações demais para listar por completo)_');
  }
  p('');

  p('## Funil por Nó e Valor');
  p('');
  if (!funnel || funnel.rows.length === 0) {
    p('_Sem dados de funil — nenhuma raiz de fluxo configurada._');
  } else {
    p(mdTable(
      ['Nó', 'Valor', 'Volume', 'Aprovado', 'Reprovado', 'Taxa Aprov.', 'Inad. Real', 'Inad. Inferida'],
      funnel.rows.map(r => [r.nodeName, r.value ?? '(agregado por nó)', fmtQty(r.qty), fmtQty(r.approvedQty), fmtQty(r.rejectedQty), fmtPct(r.approvalRate), fmtPct(r.inadReal), fmtPct(r.inadInferida)]),
    ));
    if (funnel.totals) {
      p('');
      p(`**Total:** ${fmtQty(funnel.totals.qty)} propostas · ${fmtPct100((funnel.totals.approvalRate ?? 0) * 100)} aprovação · Inad. Real ${fmtPct(funnel.totals.inadReal)} · Inad. Inferida ${fmtPct(funnel.totals.inadInferida)}`);
    }
  }
  p('');

  p('## Confiabilidade da Amostra');
  p('');
  if (!reliability || !reliability.hasLowSample) {
    p(`_Nenhum segmento com amostra abaixo de ${reliability?.minSample ?? 30} altas — números estatisticamente estáveis._`);
  } else {
    p(`⚠ Os segmentos abaixo têm menos de ${reliability.minSample} altas (real ou inferida) — leia as taxas com cautela (alta variância amostral):`);
    p('');
    p(mdTable(['Nó', 'Valor', 'Altas Reais', 'Altas Inferidas'], reliability.lowSampleRows.map(r => [r.nodeName, r.value ?? '(agregado por nó)', fmtQty(r.qtdAltasSum), fmtQty(r.qtdAltasInferSum)])));
  }
  p('');

  p('## Comparação de Cenários');
  p('');
  if (!scenarios) {
    p('_Baseline AS IS não configurada — comparação de cenários indisponível._');
  } else {
    p(mdTable(
      ['Cenário', 'Taxa de Aprovação', 'Inad. Real', 'Inad. Inferida'],
      scenarios.rows.map(r => [r.nome, fmtPct100(r.approvalRate), fmtPct(r.inadReal), fmtPct(r.inadInferida)]),
    ));
  }
  p('');

  if (changelog) {
    p('## Changelog Estrutural');
    p('');
    p(`Comparado com: **${changelog.compareName || 'versão anterior'}**`);
    p('');
    const { added, removed, changed, entryChanged } = changelog.irDiff;
    if (added.length === 0 && removed.length === 0 && changed.length === 0 && !entryChanged) {
      p('_Nenhuma diferença estrutural._');
    } else {
      if (added.length) { p('**Adicionados:**'); for (const n of added) p(`- ${n.label} (${n.kind})`); p(''); }
      if (removed.length) { p('**Removidos:**'); for (const n of removed) p(`- ${n.label} (${n.kind})`); p(''); }
      if (changed.length) {
        p('**Alterados:**');
        for (const n of changed) for (const f of n.fields) p(`- ${n.label} (${n.kind}) — campo \`${f.key}\` mudou`);
        p('');
      }
      if (entryChanged) p('- Raízes do fluxo (`entry`) mudaram.');
    }
    p('');
    p(mdTable(
      ['', 'Antes', 'Depois'],
      [
        ['Taxa de Aprovação', fmtPct100(changelog.before.kpis.approvalRate), fmtPct100(changelog.after.kpis.approvalRate)],
        ['Inad. Real', fmtPct(changelog.before.kpis.inadReal), fmtPct(changelog.after.kpis.inadReal)],
        ['Inad. Inferida', fmtPct(changelog.before.kpis.inadInferida), fmtPct(changelog.after.kpis.inadInferida)],
      ],
    ));
    p('');
  }

  p('## Glossário de Variáveis');
  p('');
  if (!glossary || glossary.length === 0) {
    p('_Nenhuma variável referenciada._');
  } else {
    p(mdTable(
      ['Coluna', 'Base', 'Papel', 'Tipo', 'Tipo de Variável', 'Domínio'],
      glossary.map(g => [
        g.col, g.csvName || '—', g.role === 'decision' ? 'Decisão' : 'Regra (Lens)',
        COL_TYPES.find(t => t.value === g.colType)?.label || g.colType || '—',
        g.varType || '—',
        g.values ? g.values.join(', ') : (g.domainSize != null ? `${g.domainSize} valor(es)` : '—'),
      ]),
    ));
  }

  // Regras das Variáveis de Cluster (interpretação da Clusterização) — os grupos e as
  // faixas de valor por dimensão que definem cada cluster. Valores concretos só quando
  // includeDomains (o worker já redige em describeClusterRules).
  const clusterVars = (glossary || []).filter(g => g.cluster);
  if (clusterVars.length) {
    p('');
    p('### Regras dos Clusters');
    p('');
    for (const g of clusterVars) {
      p(`**${g.col}** — agrupa por ${g.cluster.dims.join(', ') || '—'} (${g.cluster.method || 'k-means'}); fora dos grupos → _${g.cluster.unmatchedLabel}_.`);
      p('');
      for (const grp of g.cluster.groups) {
        const dimsTxt = grp.dims.map(d => d.values ? `${d.col}: ${d.values.join(', ')}` : `${d.col}: ${d.valueCount} valor(es)`).join(' · ');
        p(`- **${grp.label}** — ${dimsTxt || '—'}`);
      }
      p('');
    }
  }

  return L.join('\n');
}

// Renderiza o docModel como HTML self-contained (inline styles — ADR-002) para abrir em
// nova janela e `window.print()` (→ PDF via navegador). Mesmo conteúdo/números do Markdown.
export function renderDocHTML(docModel) {
  if (!docModel) return '<html><body>Sem documento.</body></html>';
  const { meta, ir, flowNodes, paths, kpis, funnel, reliability, scenarios, glossary, changelog, options } = docModel;
  const S = [];
  const h = (level, text) => S.push(`<h${level} style="font-family:system-ui,sans-serif;color:#1e293b;">${mdBoldToHtml(text)}</h${level}>`);
  const para = (text) => S.push(`<p style="font-family:system-ui,sans-serif;color:#334155;line-height:1.6;">${mdBoldToHtml(text)}</p>`);
  const tableStyle = `<style>
    table{border-collapse:collapse;width:100%;margin:8px 0 16px;font-family:system-ui,sans-serif;font-size:13px;}
    th,td{border:1px solid #cbd5e1;padding:6px 10px;text-align:left;}
    th{background:#f1f5f9;color:#334155;}
    body{max-width:900px;margin:32px auto;padding:0 16px;}
    ul{font-family:system-ui,sans-serif;color:#334155;line-height:1.7;}
    @media print { body{margin:0;padding:16px;} }
  </style>`;

  S.push(`<!doctype html><html><head><meta charset="utf-8"><title>Documento de Política${meta?.name ? ` — ${escHtml(meta.name)}` : ''}</title>${tableStyle}</head><body>`);
  h(1, `Documento de Política de Crédito${meta?.name ? ` — ${meta.name}` : ''}`);
  S.push(`<p style="font-family:system-ui,sans-serif;color:#94a3b8;font-size:12px;">Gerado em ${escHtml(new Date(docModel.generatedAt).toLocaleString('pt-BR'))} · build #${escHtml(BUILD_NUMBER)} (${escHtml(BUILD_HASH)}) · hash da política: ${hashPolicyIR(ir)}${options?.includeDomains ? '' : ' · domínios de valores omitidos'}</p>`);

  h(2, 'Sumário Executivo');
  const { simResult, incrementalResult } = kpis || {};
  if (simResult) {
    S.push(`<ul>
      <li><strong>Taxa de Aprovação (simulada):</strong> ${fmtPct100(simResult.approvalRate)}</li>
      <li><strong>Inad. Real:</strong> ${fmtPct(simResult.inadReal)}</li>
      <li><strong>Inad. Inferida:</strong> ${fmtPct(simResult.inadInferida)}</li>
      <li><strong>Volume total:</strong> ${fmtQty(simResult.totalQty)} (✅ ${fmtQty(simResult.approvedQty)} · ❌ ${fmtQty(simResult.rejectedQty)}${simResult.asIsQty ? ` · ⟳ ${fmtQty(simResult.asIsQty)}` : ''})</li>
    </ul>`);
  }
  if (incrementalResult) {
    para('**Comparativo vs. AS IS**');
    S.push(htmlTable(['', 'AS IS', 'Simulado', 'Delta'], [
      ['Taxa de Aprovação', fmtPct100(incrementalResult.baseline.approvalRate), fmtPct100(incrementalResult.simulated.approvalRate), fmtDelta100(incrementalResult.impacted.approvalDelta)],
      ['Inad. Real', fmtPct(incrementalResult.baseline.inadReal), fmtPct(incrementalResult.simulated.inadReal), ''],
      ['Inad. Inferida', fmtPct(incrementalResult.baseline.inadInferida), fmtPct(incrementalResult.simulated.inadInferida), ''],
    ]));
    para(`População impactada: ${fmtQty(incrementalResult.impacted.qty)} (${fmtPct100(incrementalResult.impacted.pct)}) — ${fmtQty(incrementalResult.impacted.rToA)} promovida(s) (Reprovado→Aprovado), ${fmtQty(incrementalResult.impacted.aToR)} rejeitada(s) a mais (Aprovado→Reprovado).`);
  } else {
    para('_Baseline AS IS não configurada — sem comparativo disponível._');
  }

  h(2, 'Fluxo da Política');
  if (!flowNodes || flowNodes.length === 0) para('_Canvas vazio — nenhum nó de fluxo._');
  else S.push(`<ul>${flowNodes.map(fn => `<li><strong>${escHtml(fn.label)}</strong> <em>(${escHtml(fn.kind)})</em> — ${mdBoldToHtml(describeFlowNode(fn))}</li>`).join('')}</ul>`);

  h(2, 'Regras Achatadas (raiz → terminal)');
  if (!paths || paths.list.length === 0) para('_Sem caminhos — nenhuma raiz de fluxo configurada._');
  else {
    S.push(`<ol style="font-family:system-ui,sans-serif;color:#334155;line-height:1.7;">${paths.list.map(path => `<li>${escHtml(describePath(path))}</li>`).join('')}</ol>`);
    if (paths.truncated) para('_(lista truncada — política com combinações demais para listar por completo)_');
  }

  h(2, 'Funil por Nó e Valor');
  if (!funnel || funnel.rows.length === 0) para('_Sem dados de funil — nenhuma raiz de fluxo configurada._');
  else {
    S.push(htmlTable(
      ['Nó', 'Valor', 'Volume', 'Aprovado', 'Reprovado', 'Taxa Aprov.', 'Inad. Real', 'Inad. Inferida'],
      funnel.rows.map(r => [r.nodeName, r.value ?? '(agregado por nó)', fmtQty(r.qty), fmtQty(r.approvedQty), fmtQty(r.rejectedQty), fmtPct(r.approvalRate), fmtPct(r.inadReal), fmtPct(r.inadInferida)]),
    ));
    if (funnel.totals) para(`<strong>Total:</strong> ${fmtQty(funnel.totals.qty)} propostas · ${fmtPct100((funnel.totals.approvalRate ?? 0) * 100)} aprovação · Inad. Real ${fmtPct(funnel.totals.inadReal)} · Inad. Inferida ${fmtPct(funnel.totals.inadInferida)}`);
  }

  h(2, 'Confiabilidade da Amostra');
  if (!reliability || !reliability.hasLowSample) para(`_Nenhum segmento com amostra abaixo de ${reliability?.minSample ?? 30} altas — números estatisticamente estáveis._`);
  else {
    para(`⚠ Os segmentos abaixo têm menos de ${reliability.minSample} altas (real ou inferida) — leia as taxas com cautela (alta variância amostral):`);
    S.push(htmlTable(['Nó', 'Valor', 'Altas Reais', 'Altas Inferidas'], reliability.lowSampleRows.map(r => [r.nodeName, r.value ?? '(agregado por nó)', fmtQty(r.qtdAltasSum), fmtQty(r.qtdAltasInferSum)])));
  }

  h(2, 'Comparação de Cenários');
  if (!scenarios) para('_Baseline AS IS não configurada — comparação de cenários indisponível._');
  else S.push(htmlTable(['Cenário', 'Taxa de Aprovação', 'Inad. Real', 'Inad. Inferida'], scenarios.rows.map(r => [r.nome, fmtPct100(r.approvalRate), fmtPct(r.inadReal), fmtPct(r.inadInferida)])));

  if (changelog) {
    h(2, 'Changelog Estrutural');
    para(`Comparado com: <strong>${escHtml(changelog.compareName || 'versão anterior')}</strong>`);
    const { added, removed, changed, entryChanged } = changelog.irDiff;
    if (added.length === 0 && removed.length === 0 && changed.length === 0 && !entryChanged) {
      para('_Nenhuma diferença estrutural._');
    } else {
      if (added.length) S.push(`<p><strong>Adicionados:</strong></p><ul>${added.map(n => `<li>${escHtml(n.label)} (${escHtml(n.kind)})</li>`).join('')}</ul>`);
      if (removed.length) S.push(`<p><strong>Removidos:</strong></p><ul>${removed.map(n => `<li>${escHtml(n.label)} (${escHtml(n.kind)})</li>`).join('')}</ul>`);
      if (changed.length) S.push(`<p><strong>Alterados:</strong></p><ul>${changed.flatMap(n => n.fields.map(f => `<li>${escHtml(n.label)} (${escHtml(n.kind)}) — campo <code>${escHtml(f.key)}</code> mudou</li>`)).join('')}</ul>`);
      if (entryChanged) para('- Raízes do fluxo (entry) mudaram.');
    }
    S.push(htmlTable(['', 'Antes', 'Depois'], [
      ['Taxa de Aprovação', fmtPct100(changelog.before.kpis.approvalRate), fmtPct100(changelog.after.kpis.approvalRate)],
      ['Inad. Real', fmtPct(changelog.before.kpis.inadReal), fmtPct(changelog.after.kpis.inadReal)],
      ['Inad. Inferida', fmtPct(changelog.before.kpis.inadInferida), fmtPct(changelog.after.kpis.inadInferida)],
    ]));
  }

  h(2, 'Glossário de Variáveis');
  if (!glossary || glossary.length === 0) para('_Nenhuma variável referenciada._');
  else S.push(htmlTable(
    ['Coluna', 'Base', 'Papel', 'Tipo', 'Tipo de Variável', 'Domínio'],
    glossary.map(g => [
      g.col, g.csvName || '—', g.role === 'decision' ? 'Decisão' : 'Regra (Lens)',
      COL_TYPES.find(t => t.value === g.colType)?.label || g.colType || '—',
      g.varType || '—',
      g.values ? g.values.join(', ') : (g.domainSize != null ? `${g.domainSize} valor(es)` : '—'),
    ]),
  ));

  const clusterVarsH = (glossary || []).filter(g => g.cluster);
  if (clusterVarsH.length) {
    h(3, 'Regras dos Clusters');
    for (const g of clusterVarsH) {
      para(`**${g.col}** — agrupa por ${escHtml(g.cluster.dims.join(', ') || '—')} (${escHtml(g.cluster.method || 'k-means')}); fora dos grupos → _${escHtml(g.cluster.unmatchedLabel)}_.`);
      const items = g.cluster.groups.map(grp => {
        const dimsTxt = grp.dims.map(d => d.values ? `${d.col}: ${escHtml(d.values.join(', '))}` : `${d.col}: ${d.valueCount} valor(es)`).join(' · ');
        return `<li><strong>${escHtml(grp.label)}</strong> — ${dimsTxt || '—'}</li>`;
      }).join('');
      S.push(`<ul>${items}</ul>`);
    }
  }

  S.push('</body></html>');
  return S.join('\n');
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
  // Execução Híbrida H4/H6 — preferência do Motor Python (sidecar opt-in). Default OFF:
  // com desligado o ComputeRouter nem tenta detectar; tudo roda no worker (DEC-HX-001).
  // `url`/`token` só têm efeito no modo dev (release é same-origin, sem config — ver
  // IS_DEV_BUILD). Persistida no contêiner `preferences` do Projeto (sem bump de schema).
  const [computeSidecar,    setComputeSidecar]     = useState({ enabled: false, url: '', token: '' });
  // Status detectado do sidecar (efêmero — nunca persistido, é sempre re-derivado por
  // `detect()`). `reason` espelha o vocabulário do router: not_detected|disabled|
  // no_sidecar|unreachable|protocol_mismatch|ok.
  const [computeSidecarStatus, setComputeSidecarStatus] = useState({ available: false, tier: null, capabilities: null, reason: 'not_detected' });
  const [computeSidecarChecking, setComputeSidecarChecking] = useState(false);
  // Seção "Motor Python" das preferências — expandida sob demanda (inclusive pelos
  // banners DEC-HX-009, que apontam pra cá via "Saiba como ligar").
  const [sidecarPrefsOpen, setSidecarPrefsOpen] = useState(false);
  // Teste ponta a ponta (echo_stats) — smoke test do round-trip Browser⇄Python (§17
  // Fase 1: "sidecar opt-in funcionando ponta a ponta com uma tarefa de eco/benchmark").
  // null | {step:'uploading'|'running'|'result'|'error', progress, via, fellBack, result, error}
  const [sidecarTest, setSidecarTest] = useState(null);
  // Recomendação proativa (DEC-HX-009) ao abrir um projeto grande — dismissível.
  const [projectLoadNotice, setProjectLoadNotice] = useState(null);
  // Feature: tooltips
  const [tooltip,    setTooltip]    = useState(null);   // null | {x,y,lines:[]}
  // Optimization modal
  const [optimModal,  setOptimModal]  = useState(null);   // null | optim obj
  // Johnny multi-cineminha optimizer modal
  const [johnnyModal, setJohnnyModal] = useState(null);   // null | johnny obj
  // Goal Seek — Copiloto Sessão 4 (DEC-IA-005/006): busca de política inteira por objetivo
  const [goalSeekModal, setGoalSeekModal] = useState(null); // null | {step:'form'|'loading'|'result', goal, constraints, context:null|{baseline,asis}, ...GOAL_SEEK_RESULT}
  // Simplificação com prova de equivalência — Copiloto Sessão 5 (DEC-IA-005/006)
  const [simplifyModal, setSimplifyModal] = useState(null); // null | {step:'loading'|'result', proposal, equivalence}
  // Documentação Automática — Copiloto Sessão 6 (DEC-IA-006): composição efêmera (mesmo
  // padrão não-persistido de goalSeekModal/simplifyModal — ver ⚠️ regra do CLAUDE.md).
  // null | {step:'form'|'loading'|'result', includeDomains, scenarioIds:Set, compareCanvasId, docModel?}
  const [docModal, setDocModal] = useState(null);
  // Descoberta de Segmentos — Copiloto Sessão 10/11 (DEC-SD-001..006): composição efêmera
  // (mesmo padrão não-persistido de goalSeekModal/simplifyModal/docModal — sem recomendação/
  // patch nesta sessão, só descoberta + explicação + priorização + navegação).
  // null | {step:'form'|'loading'|'result', scope:null|{nodeId}, params, segmentModel?, varFilter?, focusedId?}
  const [segmentDiscoveryModal, setSegmentDiscoveryModal] = useState(null);
  // Clusterização de Segmentos (Execução Híbrida H8) — modal EFÊMERO (padrão
  // segmentDiscoveryModal: não persiste; ⚠️ regra do CLAUDE.md não se aplica).
  // null | {step:'form'|'loading'|'result', csvId, dims:string[], k, autoK, method,
  //         model?, focusedId?, deepRun?, fallbackNotice?}
  const [clusterModal, setClusterModal] = useState(null);
  // Editor de Variável de Cluster (aberto pelo ✏️ no chip do painel) — efêmero.
  // null | {csvId, col, draft:ClusterDef, baseValuesByDim:{[dim]:string[]}, notice?, confirmDelete?}
  const [clusterVarModal, setClusterVarModal] = useState(null);
  // Decision Lens modal
  const [lensModal,  setLensModal]  = useState(null);   // null | {shapeId, rules, population}
  // Sugestão de próximo nó (Copiloto Sessão 3) — ranking on-demand para a porta selecionada
  const [variableRankingModal, setVariableRankingModal] = useState(null); // null | {portId, loading} | {portId, ...VARIABLE_RANKING_RESULT}
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
  // Biblioteca de Políticas (Copiloto Sessão 2) — templates de PolicyIR reutilizáveis
  const [policyLibrary,      setPolicyLibrary]      = useState([]);   // array de {id,name,description,tags,ir,requiredVars,savedAt}
  const [policyLibraryModal, setPolicyLibraryModal] = useState(null); // null | {mode:'browse'|'save', search, saveMeta, overwriteId}
  const [policyApplyModal,   setPolicyApplyModal]   = useState(null); // null | {itemId, name, ir, requiredVars, mapping:{[origCol]:{col,csvId}|null}}
  // Business Impact floating widget
  const [businessWidget, setBusinessWidget] = useState({ visible: false, x: 80, y: 80, w: 420, h: 520 });
  const tooltipTimer = useRef(null);

  // ── Refs ──────────────────────────────────────────────────────
  const svgRef        = useRef(null);
  const fileInputRef  = useRef(null);
  const projectInputRef = useRef(null);
  // Feedback transitório do "Salvar Projeto" — null | {kind:'ok'|'err', msg}
  const [projectSaveNotice, setProjectSaveNotice] = useState(null);
  const dragR         = useRef(null);
  const pinchR        = useRef(null);
  const movedR        = useRef(false);
  // M12: durante o arraste de shape(s) NÃO chamamos setShapes por frame (que invalidaria a
  // cena memoizada inteira). Os ids arrastados saem da cena (dragIds) e são desenhados numa
  // camada de overlay leve, transladada por dragDelta (atualizado via rAF). setShapes só no
  // mouseup. dragDeltaR guarda o último delta para o commit; dragRafR faz o throttle por frame.
  const [dragIds, setDragIds]   = useState(null);   // Set<id> dos shapes em arraste (ou null)
  const [dragDelta, setDragDelta] = useState(null); // {dx,dy} em coords de mundo (ou null)
  const dragDeltaR    = useRef(null);
  const dragRafR      = useRef(0);
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
  const policyLibFileInputRef = useRef(null);
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
  const goalSeekModalR = useRef(goalSeekModal); useEffect(()=>{goalSeekModalR.current=goalSeekModal},[goalSeekModal]);
  const simplifyModalR = useRef(simplifyModal); useEffect(()=>{simplifyModalR.current=simplifyModal},[simplifyModal]);
  const docModalR = useRef(docModal); useEffect(()=>{docModalR.current=docModal},[docModal]);
  const segmentDiscoveryModalR = useRef(segmentDiscoveryModal); useEffect(()=>{segmentDiscoveryModalR.current=segmentDiscoveryModal},[segmentDiscoveryModal]);
  const clusterModalR = useRef(clusterModal); useEffect(()=>{clusterModalR.current=clusterModal},[clusterModal]);
  const clusterVarModalR = useRef(clusterVarModal); useEffect(()=>{clusterVarModalR.current=clusterVarModal},[clusterVarModal]);
  const businessWidgetR = useRef(businessWidget); useEffect(()=>{businessWidgetR.current=businessWidget},[businessWidget]);
  const cinemaLibraryR  = useRef(cinemaLibrary);  useEffect(()=>{cinemaLibraryR.current=cinemaLibrary}, [cinemaLibrary]);
  const policyLibraryR  = useRef(policyLibrary);  useEffect(()=>{policyLibraryR.current=policyLibrary}, [policyLibrary]);
  const canvasesR       = useRef(canvases);        useEffect(()=>{canvasesR.current=canvases},         [canvases]);
  const activeCanvasIdR = useRef(activeCanvasId);  useEffect(()=>{activeCanvasIdR.current=activeCanvasId},[activeCanvasId]);
  // Execução Híbrida H6 — lido dentro do ComputeRouter (`getPreference`), que roda em
  // callbacks assíncronos fora do ciclo de render (poll de job, detect no boot).
  const computeSidecarR = useRef(computeSidecar); useEffect(()=>{computeSidecarR.current=computeSidecar},[computeSidecar]);
  const bwDragR = useRef(null);

  // ── Web Worker — simulation off the main thread ───────────────
  const workerRef = useRef(null);
  // H0 — Telemetria local de custo (opt-in ?debug=perf): {pending:Map, buffers:Map}.
  // Só alocado/instrumentado quando o painel dev está ligado — zero overhead fora dele.
  const perfTelemetryRef = useRef(null);
  const debugPerf = useMemo(() => {
    try { return new URLSearchParams(window.location.search).get('debug') === 'perf'; }
    catch { return false; }
  }, []);
  const pendingOptimShapeIdRef = useRef(null);
  const pendingRankingPortIdRef = useRef(null);
  // Prévia AS IS contextualizada (assignCinemaVar): token por shape p/ ignorar
  // respostas obsoletas do worker (reatribuição posterior antes da resposta chegar).
  const asIsPreviewTokenRef = useRef({});
  const asIsPreviewCounterRef = useRef(0);

  // Execução Híbrida H4/H6 — ComputeRouter (fronteira única worker/sidecar). O
  // `sidecarProviderRef` é recriado quando url/token mudam (effect abaixo); o router é
  // criado UMA vez (junto do worker) referenciando um proxy estável cujos métodos só
  // delegam pro provider corrente — assim o router não precisa ser recriado a cada
  // troca de preferência (DEC-HX-002: nenhum outro código sabe/precisa saber disso).
  const sidecarProviderRef = useRef(null);
  const computeRouterRef = useRef(null);
  const sidecarProxyRef = useRef({
    health:          (...a) => sidecarProviderRef.current?.health(...a),
    token_:          (...a) => sidecarProviderRef.current?.token_(...a),
    capabilities:    (...a) => sidecarProviderRef.current?.capabilities(...a),
    registerDataset: (...a) => sidecarProviderRef.current?.registerDataset(...a),
    runJob:          (...a) => sidecarProviderRef.current?.runJob(...a),
    cancelJob:       (...a) => sidecarProviderRef.current?.cancelJob(...a),
  });

  useEffect(() => {
    const worker = new Worker(new URL('./simulation.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    // ComputeRouter — Classe A (tudo hoje) sempre no worker; Classe B tentaria o
    // sidecar via o proxy acima (DEC-HX-007). `getPreference` lê sempre o valor mais
    // recente (ref mirror), então ligar/desligar o toggle não exige recriar o router.
    computeRouterRef.current = createComputeRouter({
      worker: createWorkerProvider(worker),
      sidecar: sidecarProxyRef.current,
      getPreference: () => computeSidecarR.current,
    });

    // H0 — Telemetria local de custo (opt-in ?debug=perf). Wrapper fino sobre o
    // canal postMessage: mede a duração entre cada request (COMPUTE_*/RUN_SIMULATION)
    // e seu *_RESULT casando por tipo (PERF_REQUEST_TO_RESULT), sem tocar no worker
    // nem no handler `onmessage` abaixo (listener extra via addEventListener) — só
    // timestamps + rowCount do csvStore no momento do envio + performance.memory
    // quando existe. Acumula num ring buffer local de ~200 entradas por tipo. Nada é
    // persistido nem sai da máquina. O pareamento é uma FILA FIFO por tipo: o debounce
    // (300ms) só espaça os envios, não espera a resposta anterior — em base grande
    // (tick ~0,7s) requests do MESMO tipo se sobrepõem justamente nos ticks pesados que
    // este painel existe para medir, e um slot único subestimaria a duração e perderia
    // amostras. FIFO é exato aqui porque o worker processa mensagens em ordem e todo
    // request mapeado responde exatamente uma vez; a duração inclui a espera na fila do
    // worker (custo real do canal, intencional). Exceção não capturada num handler do
    // worker é o único caso sem resposta — o evento 'error' limpa as filas pendentes
    // para não desalinhar os pares seguintes.
    let restoreWorkerPostMessage = null;
    if (debugPerf) {
      const telemetry = { pending: new Map(), buffers: new Map() };
      perfTelemetryRef.current = telemetry;
      const origPostMessage = worker.postMessage.bind(worker);
      worker.postMessage = (payload, transferOrOptions) => {
        const reqType = payload && payload.type;
        if (reqType && PERF_REQUEST_TO_RESULT[reqType]) {
          let rowCountTotal = 0;
          const cs = csvStoreR.current;
          if (cs) for (const csvId in cs) rowCountTotal += cs[csvId]?.rowCount || 0;
          let queue = telemetry.pending.get(reqType);
          if (!queue) { queue = []; telemetry.pending.set(reqType, queue); }
          queue.push({ start: performance.now(), rowCount: rowCountTotal });
        }
        return origPostMessage(payload, transferOrOptions);
      };
      restoreWorkerPostMessage = () => { worker.postMessage = origPostMessage; };
      worker.addEventListener('error', () => { telemetry.pending.clear(); });
      worker.addEventListener('message', (e) => {
        const reqType = PERF_RESULT_TO_REQUEST[e.data && e.data.type];
        if (!reqType) return;
        const queue = telemetry.pending.get(reqType);
        const pending = queue && queue.shift();
        if (!pending) return;
        const duration = performance.now() - pending.start;
        const mem = (typeof performance !== 'undefined' && performance.memory)
          ? { usedJSHeapSize: performance.memory.usedJSHeapSize,
              totalJSHeapSize: performance.memory.totalJSHeapSize,
              jsHeapSizeLimit: performance.memory.jsHeapSizeLimit }
          : null;
        let arr = telemetry.buffers.get(reqType);
        if (!arr) { arr = []; telemetry.buffers.set(reqType, arr); }
        arr.push({ ts: Date.now(), duration, rowCount: pending.rowCount, memory: mem });
        if (arr.length > PERF_RING_SIZE) arr.shift();
      });
    }

    worker.onmessage = (e) => {
      const { type: msgType } = e.data;
      if (msgType === 'SIMULATION_RESULT') {
        setSimResult(e.data.result);
      } else if (msgType === 'OVERLAY_RESULT') {
        setIncrementalResult(e.data.incrementalResult);
        setNodeArrivals(e.data.nodeArrivals || {});
        setLensCounts(e.data.lensCounts || {});
      } else if (msgType === 'ANALYTICS_RESULT') {
        setAnalyticsDataset(e.data.dataset);
      } else if (msgType === 'ASIS_PREVIEW_RESULT') {
        // Prévia AS IS contextualizada ao nó (respeita filtros a montante) — chega
        // async do worker após assignCinemaVar. Aplica só se o token ainda for o mais
        // recente (sem reatribuição posterior) e as caselas não tiverem sido editadas
        // manualmente. Não faz pushHistory: a atribuição já registrou o passo de undo.
        const { cellsByShape, reqTokens } = e.data;
        if (!cellsByShape) return;
        setShapes(prev => {
          let changed = false;
          const next = prev.map(s => {
            const cells = cellsByShape[s.id];
            if (!cells) return s;
            if (asIsPreviewTokenRef.current[s.id] !== reqTokens?.[s.id]) return s;
            if (s.cellsUserEdited) return s;
            changed = true;
            return { ...s, cells };
          });
          return changed ? next : prev;
        });
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
      } else if (msgType === 'POLICY_INSIGHTS_RESULT') {
        setCopilotFindings(e.data.findings || []);
      } else if (msgType === 'GOAL_SEEK_RESULT') {
        // GS6 (DEC-GS-001/007): COMPUTE_GOAL_SEEK_VALIDATE pode responder {error:'stale'|
        // 'invalid_solution', detail} na MESMA `*_RESULT` — nunca produzido pelo caminho
        // clássico (COMPUTE_GOAL_SEEK). `runDeepGoalSeek` trata o erro (fallback ao
        // guloso); aqui só evitamos sobrescrever o modal com campos undefined.
        if (e.data.error) return;
        const { goal, baseline, frontier, moves, goalReached, bindingConstraint, result } = e.data;
        setGoalSeekModal(m => (m ? { ...m, step: 'result', deepRun: null, goal, baseline, frontier, moves, goalReached, bindingConstraint, result } : m));
      } else if (msgType === 'GOAL_SEEK_CONTEXT_RESULT') {
        const { baseline, asis } = e.data;
        setGoalSeekModal(m => (m ? { ...m, context: { baseline, asis } } : m));
      } else if (msgType === 'SIMPLIFY_RESULT') {
        const { proposal, equivalence } = e.data;
        setSimplifyModal(m => (m ? { ...m, step: 'result', proposal, equivalence } : m));
      } else if (msgType === 'VARIABLE_RANKING_RESULT') {
        const { nodeId } = e.data;
        if (pendingRankingPortIdRef.current !== nodeId) return; // seleção mudou antes da resposta chegar
        pendingRankingPortIdRef.current = null;
        setVariableRankingModal({ portId: nodeId, ...e.data });
      } else if (msgType === 'POLICY_DOC_RESULT') {
        // Changelog fica de fora do worker (DEC-IA-006): o diff estrutural (diffPolicyIR) é
        // uma função pura sobre dois IR — a main já tem os dois prontos (o próprio docModel.ir
        // e o `compareIr` guardado no modal ao disparar a comparação) — só os KPIs da política
        // de comparação (compareKpis) precisam varrer a base, e esses já voltam no mesmo passe.
        const { docModel } = e.data;
        setDocModal(m => {
          if (!m) return m;
          let changelog = null;
          if (m.compareIr && docModel.compareKpis) {
            changelog = {
              compareName: m.compareName || 'versão anterior',
              irDiff: diffPolicyIR(docModel.ir, m.compareIr),
              before: { kpis: docModel.compareKpis.simResult, incrementalResult: docModel.compareKpis.incrementalResult },
              after:  { kpis: docModel.kpis.simResult, incrementalResult: docModel.kpis.incrementalResult },
            };
          }
          return { ...m, step: 'result', docModel: { ...docModel, changelog } };
        });
      } else if (msgType === 'SEGMENT_DISCOVERY_RESULT') {
        const { segmentModel } = e.data;
        setSegmentDiscoveryModal(m => (m ? { ...m, step: 'result', segmentModel, deepRun: null, varFilter: null,
          focusedId: segmentModel.findings?.[0]?.id ?? null, selectedIds: [], combined: null } : m));
      } else if (msgType === 'SEGMENT_RECS_RESULT') {
        // H7 — modelo da Descoberta profunda (sidecar) de volta do worker com as
        // recomendações anexadas (patch + delta re-simulado real, DEC-SD-003).
        const { segmentModel } = e.data;
        setSegmentDiscoveryModal(m => {
          if (!m) return m;
          if (!segmentModel) return { ...m, step: 'form', deepRun: null };
          return { ...m, step: 'result', segmentModel, deepRun: null, varFilter: null,
            focusedId: segmentModel.findings?.[0]?.id ?? null, selectedIds: [], combined: null };
        });
      } else if (msgType === 'SEGMENT_COMBINED_RESULT') {
        const { combined } = e.data;
        setSegmentDiscoveryModal(m => (m ? { ...m, combined: { loading: false, result: combined } } : m));
      } else if (msgType === 'CLUSTER_SEGMENTS_RESULT') {
        // H8 — Clusterização (baseline browser direto OU fallback clampado do alias
        // `cluster_segments`; o resultado do sidecar não passa por aqui — chega pelo
        // await de runDeepClusterSegments).
        const { clusterModel } = e.data;
        setClusterModal(m => (m ? { ...m, step: 'result', model: clusterModel, deepRun: null,
          focusedId: clusterModel?.clusters?.[0]?.id ?? null } : m));
      }
    };
    return () => { restoreWorkerPostMessage?.(); worker.terminate(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Execução Híbrida H6 — pareamento com o sidecar (§9 "Boot/pareamento"). Re-checagem
  // manual (badge/botão "Verificar conexão") chama a mesma função. `detect()` do router
  // já é NUNCA lança e é silencioso quando a preferência está desligada — chamamos
  // incondicionalmente e deixamos o router decidir (evita duplicar a regra aqui).
  const detectSidecar = useCallback(async () => {
    if (!computeRouterRef.current) return;
    setComputeSidecarChecking(true);
    try {
      const status = await computeRouterRef.current.detect();
      setComputeSidecarStatus(status);
    } finally {
      setComputeSidecarChecking(false);
    }
  }, []);
  const computeSidecarStatusR = useRef(computeSidecarStatus);
  useEffect(()=>{computeSidecarStatusR.current=computeSidecarStatus},[computeSidecarStatus]);

  // Sidecar provider é recriado quando URL/token mudam (o proxy acima garante que o
  // router não precisa saber disso). Re-detecta em seguida — debounced (400ms) pra não
  // disparar um round-trip HTTP a cada tecla digitada no campo de token/URL do modo dev.
  useEffect(() => {
    sidecarProviderRef.current = createSidecarProvider({
      url: computeSidecar.url || (IS_DEV_BUILD ? 'http://127.0.0.1:8090' : ''),
      token: computeSidecar.token || '',
    });
    if (!computeSidecar.enabled) {
      setComputeSidecarStatus({ available: false, tier: null, capabilities: null, reason: 'disabled' });
      return;
    }
    const t = setTimeout(() => { detectSidecar(); }, 400);
    return () => clearTimeout(t);
  }, [computeSidecar.enabled, computeSidecar.url, computeSidecar.token, detectSidecar]);

  // Smoke test ponta a ponta (`echo_stats`, §17 Fase 1) — fala DIRETO com o
  // `sidecarProviderRef` (não pelo ComputeRouter): registra o csvStore atual por hash
  // (upload só na 1ª vez — DEC-HX-006) e roda `echo_stats` sobre a 1ª base carregada,
  // com progresso + cancelamento (AbortController). Puramente demonstrativo/diagnóstico
  // — nenhuma feature de produção depende deste caminho.
  const sidecarTestAbortRef = useRef(null);
  const runSidecarTest = useCallback(async () => {
    const provider = sidecarProviderRef.current;
    const store = csvStoreR.current;
    const csvId = Object.keys(store || {})[0];
    if (!provider || !csvId) return;
    const ctrl = new AbortController();
    sidecarTestAbortRef.current = ctrl;
    setSidecarTest({ step: 'uploading', progress: null });
    try {
      const csv = store[csvId];
      const metricCol = Object.entries(csv.columns || {}).find(([, c]) => c && c.kind === 'num')?.[0] || null;
      const serialized = serializeCsvStore(store);
      const buildChunks = () => [JSON.stringify(serialized)];
      const hash = hashChunks(buildChunks());
      const { datasetId } = await provider.registerDataset({ hash, buildChunks });
      if (ctrl.signal.aborted) return;
      setSidecarTest({ step: 'running', progress: 0 });
      const result = await provider.runJob('echo_stats', { csvId, col: metricCol }, {
        datasetId,
        signal: ctrl.signal,
        onProgress: (p) => setSidecarTest(t => (t && t.step === 'running' ? { ...t, progress: p } : t)),
      });
      setSidecarTest({ step: 'result', result });
    } catch (err) {
      if (ctrl.signal.aborted) { setSidecarTest(null); return; }
      setSidecarTest({ step: 'error', error: (err && err.message) || 'Falha ao testar o Motor Python.' });
    }
  }, []);
  const cancelSidecarTest = useCallback(() => {
    sidecarTestAbortRef.current?.abort();
    setSidecarTest(null);
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

  // ── Simulation engine (reactive) ──────────────────────────────
  // M12: índice O(1) de shapes por id — evita `shapes.find` O(n) em hot paths (renderConn
  // resolve `from`/`to` por conexão a cada frame de pan/zoom/drag; era O(conns × shapes)).
  const shapesById = useMemo(() => {
    const m = new Map();
    for (const s of shapes) m.set(s.id, s);
    return m;
  }, [shapes]);
  // M12: chave topológica — captura só ids/tipos/domínios exibidos e as arestas, NÃO as
  // posições (x/y). Assim `flowErrors` e `hiddenPortIds` (que só dependem de topologia) não
  // recomputam a cada frame de drag, que muda apenas a posição dos shapes. JSON.stringify
  // garante uma chave sem ambiguidade (escape correto) mesmo se um label/valor contiver
  // caracteres de separação, e é O(n) — muito mais barato que o DFS/loops que ele evita.
  const topoKey = useMemo(() => JSON.stringify([
    shapes.map(s => [s.id, s.type, s.visibleVals ?? null]),
    conns.map(c => [c.from, c.to, c.label ?? '']),
  ]), [shapes, conns]);
  // Depende só da topologia (topoKey), não das posições — evita reprocessar o DFS de
  // validação a cada frame de drag. shapes/conns lidos aqui são os do render corrente e
  // são topologicamente idênticos sempre que topoKey não muda.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const flowErrors = useMemo(() => validateFlow(shapes, conns), [topoKey]);
  const [simResult, setSimResult] = useState(() => ({ totalQty:0, approvedQty:0, rejectedQty:0, asIsQty:0, approvalRate:0, inadReal:null, inadInferida:null, edgeStats:{} }));
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
  }, [shapes, conns, csvStore]);

  // ── Engine de População Impactada (Feature 4) ─────────────────
  // M10: as populações de lens (Array<boolean> de ~1MM posições por lens×csv) deixaram de
  // ser computadas/mantidas na main thread (varredura que travava a UI) e de ser clonadas
  // pro worker a cada tick. O worker as deriva das regras dos shapes decision_lens e devolve
  // só as contagens {[lensId]: {count, total}} (ponderadas pelo volume) no OVERLAY_RESULT —
  // o único uso que a main tinha delas era o rótulo do nó decision_lens.
  const [lensCounts, setLensCounts] = useState({});

  // ── Engine de Sobrescrita de Decisão Simulada (Feature 5) ──────
  // Contagem reativa de registros que chegam a cada nó por valor de domínio
  // (computada no worker junto do overlay). Alimenta o "Configurar nó" e o filtro
  // de exibição de domínios (modo automático). {[nodeId]: {val|row|col: {[v]:qty}}}
  const [nodeArrivals, setNodeArrivals] = useState({});
  // Modal "Configurar nó": null | {shapeId, draft:{val?|row?|col?: null|string[]}}
  const [domainModal, setDomainModal] = useState(null);

  // Ports de losangos que não devem ser renderizados dado o domínio efetivo do nó
  // (não-destrutivo: o port/conn continua existindo e roteando na simulação).
  // M12: depende só da topologia (topoKey) + chegadas por nó (nodeArrivals), não das
  // posições — não recomputa o loop conns×decisions a cada frame de drag.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, [topoKey, nodeArrivals]);

  const simOverlayDebounceRef = useRef(null);
  useEffect(() => {
    clearTimeout(simOverlayDebounceRef.current);
    simOverlayDebounceRef.current = setTimeout(() => {
      workerRef.current?.postMessage({ type: 'COMPUTE_OVERLAY', shapes: shapesR.current, conns: connsR.current });
    }, 300);
    return () => clearTimeout(simOverlayDebounceRef.current);
  }, [shapes, conns, csvStore]);

  // ── Copiloto — lint estrutural (Sessão 1, DEC-IA-006) ──────────
  // Achados efêmeros (não persistem — só refletem o estado atual do canvas ativo),
  // recomputados no mesmo debounce da simulação. O worker reaproveita o tick
  // (getTickResult) — nenhuma varredura extra da base.
  const [copilotFindings, setCopilotFindings] = useState([]);
  const copilotDebounceRef = useRef(null);
  useEffect(() => {
    clearTimeout(copilotDebounceRef.current);
    copilotDebounceRef.current = setTimeout(() => {
      workerRef.current?.postMessage({ type: 'COMPUTE_POLICY_INSIGHTS', shapes: shapesR.current, conns: connsR.current });
    }, 300);
    return () => clearTimeout(copilotDebounceRef.current);
  }, [shapes, conns, csvStore]);

  // ── Analytics Workspace — dataset analítico canônico (DEC-AW-002) ──
  // Recomputado pelo worker quando a simulação muda; cacheado em analyticsDataset.
  // 5B: monta as abas marcadas (includeInDashboard) como cenários — working copy para o
  // canvas ativo, store para os demais. M10: as populações de lens são derivadas no worker
  // a partir das regras dos shapes (não mais recomputadas aqui na main a cada tick).
  const buildAnalyticsCanvasInputs = useCallback(() => {
    const cs = canvasesR.current;
    const activeId = activeCanvasIdR.current;
    const inputs = [];
    for (const id of Object.keys(cs)) {
      const c = cs[id];
      if (!c.includeInDashboard) continue;
      const shapes_ = id === activeId ? shapesR.current : (c.shapes || []);
      const conns_  = id === activeId ? connsR.current  : (c.conns  || []);
      inputs.push({ id, nome: c.name, shapes: shapes_, conns: conns_ });
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
  }, [shapes, conns, csvStore, canvases, activeCanvasId, buildAnalyticsCanvasInputs, activeTab]);

  // Persiste layout do dashboard na sessionStorage para sobreviver a reloads dentro da mesma sessão.
  useEffect(() => { sessionStorage.setItem('aw_layout_v1', JSON.stringify(analyticsLayout)); }, [analyticsLayout]);
  useEffect(() => { sessionStorage.setItem('aw_groupings_v1', JSON.stringify(analyticsGroupings)); }, [analyticsGroupings]);
  useEffect(() => { sessionStorage.setItem('aw_page_filters_v1', JSON.stringify(analyticsPageFilters)); }, [analyticsPageFilters]);

  // Persiste multi-canvas store — inclui working copy do canvas ativo (Sub-sessão 5A).
  // Debounced (500ms, mesmo padrão dos effects de simulação): setShapes é chamado por
  // mousemove durante drag, e sem debounce cada frame pagava JSON.stringify de todos os
  // canvases + sessionStorage.setItem síncrono (M11). Flush imediato em beforeunload/
  // visibilitychange para não perder o último estado ao fechar/trocar de aba.
  const flushCanvasStorage = useCallback(() => {
    try {
      const cs = canvasesR.current;
      const activeId = activeCanvasIdR.current;
      const toSave = {
        canvases: {
          ...cs,
          [activeId]: { ...cs[activeId], shapes: shapesR.current, conns: connsR.current },
        },
        activeCanvasId: activeId,
      };
      sessionStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(toSave));
    } catch {}
  }, []);
  const canvasStorageDebounceRef = useRef(null);
  useEffect(() => {
    clearTimeout(canvasStorageDebounceRef.current);
    canvasStorageDebounceRef.current = setTimeout(flushCanvasStorage, 500);
    return () => clearTimeout(canvasStorageDebounceRef.current);
  }, [shapes, conns, canvases, activeCanvasId, flushCanvasStorage]);
  useEffect(() => {
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') { clearTimeout(canvasStorageDebounceRef.current); flushCanvasStorage(); } };
    window.addEventListener('beforeunload', flushCanvasStorage);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', flushCanvasStorage);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [flushCanvasStorage]);

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
        dragR.current={type:"shape",id,sx,sy,offX:wx-shape.x,offY:wy-shape.y,wx0:wx,wy0:wy,snaps,preSnap,ids:new Set(ms),active:false};
      } else {
        setSel(id); setMultiSel(new Set()); setPalette(false);
        dragR.current={type:"shape",id,sx,sy,offX:wx-shape.x,offY:wy-shape.y,wx0:wx,wy0:wy,snaps:{},preSnap,ids:new Set([id]),active:false};
      }
    }
  };
  const onShapeClick = (e, id) => {
    e.stopPropagation(); if (movedR.current) return;
    if (tool==="connect"){
      const s=shapesById.get(id);
      if (s?.type==="simPanel") return; // simPanel cannot be connected
      if(!fromId){setFromId(id);}
      else if(fromId!==id){
        const fromShape=shapesById.get(fromId);
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
      // M12: em vez de setShapes por frame (invalida a cena inteira), guardamos o delta e
      // desenhamos os shapes arrastados numa camada de overlay (translate). setShapes só no up.
      const [wx,wy]=toWorld(sx,sy);
      const nd={dx:wx-dr.wx0, dy:wy-dr.wy0};
      dragDeltaR.current=nd;
      if (!dr.active) {
        if (!movedR.current) return;   // ainda um clique, não um arraste
        dr.active=true;
        setDragIds(dr.ids);            // remove os arrastados da cena memoizada
        setDragDelta(nd);             // e desenha no overlay — mesmo batch, sem flicker
      } else if (!dragRafR.current) {
        dragRafR.current=requestAnimationFrame(()=>{ dragRafR.current=0; setDragDelta(dragDeltaR.current); });
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
    // M12: commit do arraste — aplica o delta acumulado UMA vez (setShapes), depois desmonta
    // o overlay. Antes disso os shapes arrastados viviam só como translate na camada leve.
    if (dr?.type==="shape" && dr.active) {
      const nd=dragDeltaR.current;
      if (nd && (nd.dx!==0 || nd.dy!==0)) {
        const ms=dr.ids, snaps=dr.snaps;
        const hasSnaps = snaps && Object.keys(snaps).length>0;
        setShapes(p=>p.map(s=>{
          if(!ms.has(s.id)) return s;
          const base=hasSnaps?(snaps[s.id]||{x:s.x,y:s.y}):{x:s.x,y:s.y};
          return {...s, x:base.x+nd.dx, y:base.y+nd.dy};
        }));
      }
    }
    if (dr?.type==="shape") {
      if (dragRafR.current){cancelAnimationFrame(dragRafR.current);dragRafR.current=0;}
      dragDeltaR.current=null;
      setDragIds(null); setDragDelta(null);
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
  // M1 (import vetorizado): o parse alimenta os encoders colunares diretamente
  // (parseCSVToColumnarAsync) — a base NUNCA existe como string[][] e o texto cru
  // é solto assim que o parse termina. O wizard guarda só o File handle (para
  // reparse no passo 1), headers, as colunas dict (cujos dicionários já são os
  // distintos que os passos 2/3 precisam) e um preview de ~100 linhas.
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
        const parsed = await parseCSVToColumnarAsync(text, delimiter, true, (done,total)=>{
          setImportLoading(l=>l&&({...l,pct:35+Math.round((done/Math.max(total,1))*60)}));
        });
        if (!parsed.headers.length || !parsed.rowCount) {
          setImportLoading(null);
          setCsvImportError(`Não foi possível identificar colunas em "${file.name}" com o delimitador detectado ("${delimiter}"). Verifique se o arquivo é um CSV válido.`);
          return;
        }
        setImportLoading(null);
        setWizard({file,filename:file.name,delimiter,detected:delimiter,confident,hasHeader:true,step:1,columnTypes:{},varTypes:{},asIsVar:null,asIsMapping:{},editCsvId:null,decimalSep,decimalSepConfident:decConfident,parsedHeaders:parsed.headers,parsedColumns:parsed.columns,parsedRowCount:parsed.rowCount,previewRows:parsed.previewRows,parsedDelimiter:delimiter,parsedHasHeader:true});
      } catch (err) {
        setImportLoading(null);
        setCsvImportError(`Falha ao processar "${file.name}": ${err?.message || err}`);
      }
    };
    reader.readAsText(file);
  };

  // Reprocessa o arquivo com novo delimitador/cabeçalho sem travar a UI —
  // usado pelos seletores do Passo 1 do wizard. Desde o M1 o texto cru não fica
  // mais no estado: o File handle guardado no wizard é RELIDO do disco e passa
  // pelo mesmo parse colunar chunked da carga inicial (mesmo modal de progresso);
  // delimiter/hasHeader só mudam no wizard quando o reparse termina.
  const reparseWizardFile = (patch) => {
    if (!wizard) return;
    if (wizard.editCsvId) { setWizard(w => w ? {...w, ...patch} : w); return; }
    const nextDelimiter = 'delimiter' in patch ? patch.delimiter : wizard.delimiter;
    const nextHasHeader = 'hasHeader' in patch ? patch.hasHeader : wizard.hasHeader;
    const { filename, file } = wizard;
    if (!file) return;
    setImportLoading({phase:'reading', pct:0, filename});
    const reader = new FileReader();
    reader.onerror = () => {
      setImportLoading(null);
      setCsvImportError(`Não foi possível reler o arquivo "${filename}". Verifique se ele ainda existe e não está aberto em outro programa.`);
    };
    reader.onprogress = (ev) => {
      if (ev.lengthComputable) setImportLoading(l=>l&&({...l,pct:Math.round((ev.loaded/ev.total)*30)}));
    };
    reader.onload = async (ev) => {
      try {
        const text = ev.target.result;
        setImportLoading(l=>l&&({...l,phase:'parsing',pct:35}));
        const parsed = await parseCSVToColumnarAsync(text, nextDelimiter, nextHasHeader, (done,total)=>{
          setImportLoading(l=>l&&({...l,pct:35+Math.round((done/Math.max(total,1))*60)}));
        });
        setImportLoading(null);
        setWizard(w2=>w2?{...w2,...patch,parsedHeaders:parsed.headers,parsedColumns:parsed.columns,parsedRowCount:parsed.rowCount,previewRows:parsed.previewRows,parsedDelimiter:nextDelimiter,parsedHasHeader:nextHasHeader}:w2);
      } catch (err) {
        setImportLoading(null);
        setCsvImportError(`Falha ao reprocessar "${filename}": ${err?.message||err}`);
      }
    };
    reader.readAsText(file);
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
    const {filename,delimiter,hasHeader,columnTypes,varTypes,asIsVar,asIsMapping,editCsvId,decimalSep}=wizard;
    const DORIGINAL_COL = '__DECISAO_ORIGINAL';

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

      // M1: a base fica em colunar do começo ao fim — nada de materializeRows.
      // Remover a coluna derivada é só omitir a entrada; reclassificar tipos
      // (métrica ↔ dimensão) converte coluna a coluna via retypeColumn (colunas
      // com o mesmo tipo são compartilhadas por referência, sem cópia); e
      // __DECISAO_ORIGINAL é re-derivada por códigos (deriveMappedDictColumn).
      const prevCol = isColumnar(prev) ? prev
        : { ...prev, ...buildColumnar(prev.headers, prev.rows || [], prev.columnTypes) }; // defensivo: entrada legada
      const n = rowCount(prevCol);
      const baseHeaders = prevCol.headers.filter(h => h !== DORIGINAL_COL);
      const finalTypes = buildFinalTypes(baseHeaders, columnTypes);
      const baseColumns = {};
      for (const h of baseHeaders) {
        baseColumns[h] = retypeColumn(prevCol.columns[h], METRIC_COL_TYPES.has(finalTypes[h]), n);
      }

      // Rebuild __DECISAO_ORIGINAL if asIsVar is configured
      let finalHeaders = baseHeaders;
      let editColumns = baseColumns;
      if (asIsVar && baseHeaders.includes(asIsVar)) {
        const mapping = asIsMapping || {};
        finalHeaders = [...baseHeaders, DORIGINAL_COL];
        editColumns = { ...baseColumns, [DORIGINAL_COL]: deriveMappedDictColumn(baseColumns[asIsVar], n, v => mapping[String(v ?? '')] || '') };
      }

      const newAsIsConfig = asIsVar ? { col: asIsVar, mapping: asIsMapping || {} } : (prev.asIsConfig || null);

      setCsvStore(store => ({
        ...store,
        [editCsvId]: { ...prev, name: filename||prev.name, headers: finalHeaders, columns: editColumns, rowCount: n, columnTypes: finalTypes, varTypes: varTypes||{}, asIsConfig: newAsIsConfig }
      }));
      setWizard(null);
      return;
    }

    // M1: consome o parse colunar cacheado pelo wizard (onFileChange/
    // reparseWizardFile) — a base nunca existiu como string[][]. O confirm só
    // converte tipos (dict → Float64Array nas métricas, normalização decimal
    // sobre os dicionários) e deriva __DECISAO_ORIGINAL por códigos.
    const parsedOk = wizard.parsedColumns && wizard.parsedDelimiter===delimiter && wizard.parsedHasHeader===hasHeader;
    if (!parsedOk) return; // reparse pendente/falho — o botão Importar já fica desabilitado sem preview
    const headers = wizard.parsedHeaders;
    const newRowCount = wizard.parsedRowCount;

    pushHistory();
    const csvId=uid();

    // Build normalized name → original header map for reconciliation
    const normMap = {};
    for (const h of headers) normMap[normalizeColName(h)] = h;

    const finalTypes = buildFinalTypes(headers, columnTypes);
    const { columns: typedColumns } = finalizeImportedColumns(headers, wizard.parsedColumns, newRowCount, finalTypes, decimalSep || '.');

    // Derive DECISAO_ORIGINAL column if asIsVar is configured
    let finalHeaders = headers;
    let newColumns = typedColumns;
    if (asIsVar && headers.includes(asIsVar)) {
      // Strip existing derived column if re-importing
      const baseHeaders = headers.filter(h => h !== DORIGINAL_COL);
      const mapping = asIsMapping || {};
      finalHeaders = [...baseHeaders, DORIGINAL_COL];
      newColumns = {};
      for (const h of baseHeaders) newColumns[h] = typedColumns[h];
      newColumns[DORIGINAL_COL] = deriveMappedDictColumn(typedColumns[asIsVar], newRowCount, v => mapping[String(v ?? '')] || '');
    }
    setCsvStore(prev=>({...prev,[csvId]:{name:filename,headers:finalHeaders,columns:newColumns,rowCount:newRowCount,columnTypes:finalTypes,varTypes:varTypes||{},asIsConfig:asIsVar?{col:asIsVar,mapping:asIsMapping||{}}:null}}));

    // Entrada recém-criada (para recomputar domínios na reconciliação abaixo —
    // os distintos saem dos dicionários, O(distintos), sem varrer linhas).
    const newCsvEntry = { headers: finalHeaders, columns: newColumns, rowCount: newRowCount };
    const domainOfCol = (colName) => {
      const ci = finalHeaders.indexOf(colName);
      return ci >= 0 ? sortDomain(distinctColValues(newCsvEntry, ci)) : null;
    };

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
          // Recompute domains from new data (distintos direto dos dicionários — M1)
          if (updated.rowVar) {
            const d = domainOfCol(updated.rowVar.col);
            if (d) updated.rowDomain = d;
          }
          if (updated.colVar) {
            const d = domainOfCol(updated.colVar.col);
            if (d) updated.colDomain = d;
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
          if (upd.rowVar) { const d=domainOfCol(upd.rowVar.col); if(d) upd.rowDomain=d; }
          if (upd.colVar) { const d=domainOfCol(upd.colVar.col); if(d) upd.colDomain=d; }
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
      // Serializa a base colunar (typed arrays → arrays planos) p/ caber em JSON.
      csvStore: includeData ? serializeCsvStore(csvStore) : {},
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fluxo_credito_${new Date().toISOString().slice(0,10)}${includeData?"_com_dados":""}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportModal(false);
  };

  // Export do JSON canônico da política (PolicyIR — Copiloto Sessão 0, DEC-IA-002).
  // Sem posições x/y e sem dados do CSV: só nós, regras, rotas achatadas, raízes e
  // metadados de coluna. Quita o item "Exportação → JSON canônico" do Roadmap.
  const doExportPolicyIR = () => {
    const ir = buildPolicyIR(shapes, conns, csvStore, { name: canvases[activeCanvasId]?.name ?? null });
    const blob = new Blob([JSON.stringify(ir, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `politica_canonica_${new Date().toISOString().slice(0,10)}.policy.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
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
      schemaVersion: "2.6",
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
      analyticsLayout,
      analyticsGroupings,
      analyticsPageFilters,
      cinemaLibrary,
      // Biblioteca de Políticas (Copiloto Sessão 2) — array de templates de PolicyIR
      // (JSON puro: ir/requiredVars não têm Map/typed array, sem serialize dedicado).
      policyLibrary,
      businessWidget,
      preferences: {
        enableDynThickness,
        showEdgeVol,
        showEdgeInadReal,
        showEdgeInadInf,
        computeSidecar,
      },
    };
  };

  const projectFileName = () => `projeto_credito_${new Date().toISOString().slice(0,10)}.credito.json`;

  const saveProject = async () => {
    let chunks;
    try {
      chunks = buildProjectJSONChunks(buildProjectPayload());
    } catch {
      setProjectSaveNotice({ kind: "err", msg: "Não foi possível serializar o projeto." });
      return;
    }
    const suggestedName = projectFileName();
    // Preferência: "Salvar como" nativo (File System Access API) — o usuário
    // escolhe pasta e nome, e a escrita via stream (em partes, uma coluna por vez —
    // ver buildProjectJSONChunks) não sofre o truncamento que o download por
    // <a>+revokeObjectURL pode causar em projetos grandes, nem monta a string inteira em RAM.
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
        for (const chunk of chunks) await writable.write(chunk);
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
    // O Blob aceita as partes (BlobPart[]) sem concatená-las numa string única.
    try {
      const blob = new Blob(chunks, { type: "application/json" });
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
    const loadedStore = deserializeCsvStore(data.csvStore || {});
    setCsvStore(loadedStore);
    setAnalyticsLayout(Array.isArray(data.analyticsLayout) ? data.analyticsLayout : []);
    setAnalyticsGroupings(Array.isArray(data.analyticsGroupings) ? data.analyticsGroupings : []);
    setAnalyticsPageFilters(Array.isArray(data.analyticsPageFilters) ? data.analyticsPageFilters : []);
    setCinemaLibrary(Array.isArray(data.cinemaLibrary) ? data.cinemaLibrary : []);
    // schema ≤ 2.3 não tinha policyLibrary — default defensivo, projeto antigo não quebra.
    setPolicyLibrary(Array.isArray(data.policyLibrary) ? data.policyLibrary : []);
    if (data.businessWidget) setBusinessWidget(data.businessWidget);
    if (data.viewport) setVp(data.viewport);
    if (data.activeTab) setActiveTab(data.activeTab);
    if (typeof data.panelCollapsed === 'boolean') setPanelCollapsed(data.panelCollapsed);
    const pref = data.preferences || {};
    if (typeof pref.enableDynThickness === 'boolean') setEnableDynThickness(pref.enableDynThickness);
    if (typeof pref.showEdgeVol === 'boolean') setShowEdgeVol(pref.showEdgeVol);
    if (typeof pref.showEdgeInadReal === 'boolean') setShowEdgeInadReal(pref.showEdgeInadReal);
    if (typeof pref.showEdgeInadInf === 'boolean') setShowEdgeInadInf(pref.showEdgeInadInf);
    if (pref.computeSidecar && typeof pref.computeSidecar === 'object') {
      setComputeSidecar({
        enabled: pref.computeSidecar.enabled === true,
        url: typeof pref.computeSidecar.url === 'string' ? pref.computeSidecar.url : '',
        token: typeof pref.computeSidecar.token === 'string' ? pref.computeSidecar.token : '',
      });
    }
    // Execução Híbrida H6 (DEC-HX-009) — recomendação proativa ao abrir um projeto
    // grande. Mesma conta da H2 (linhas × Σ bytes/coluna), sobre o MESMO `loadedStore`
    // já deserializado acima (nunca reprocessa a base — o próprio caso que estamos
    // avisando é o de bases grandes, onde um 2º parse doeria). Nunca bloqueia.
    try {
      const totalRows  = estimateCsvStoreRowCount(loadedStore);
      const totalBytes = estimateCsvStoreRamBytes(loadedStore);
      setProjectLoadNotice(
        (totalRows > ROW_COMFORT_COUNT || totalBytes > RAM_COMFORT_BYTES)
          ? { totalRows, totalBytes } : null
      );
    } catch { /* estimativa é só um aviso — nunca impede o load */ }
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
      ...s, cellsUserEdited: true, rowVar: rowVarFinal, colVar: colVarFinal, rowDomain, colDomain, cells: newCells, w, h,
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
    setShapes(prev => prev.map(s => s.id !== shapeId ? s : { ...s, cellsUserEdited: true, cells: newCells, ...(item.name ? { label: item.name } : {}) }));
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

  // ── Policy Library functions (Copiloto Sessão 2) ────────────────
  // Candidatos de mapeamento por variável exigida do template: 'decision' só aceita
  // colunas tipadas como Filtro (mesma restrição de quem pode ser eixo de losango/
  // Cineminha); 'any' aceita qualquer coluna carregada (regra de Decision Lens casa
  // por nome contra qualquer tipo).
  const buildPolicyVarCandidates = (store) => {
    const decision = [], any = [];
    for (const [csvId, csv] of Object.entries(store || {})) {
      for (const col of (csv.headers || [])) {
        if (col === '__DECISAO_ORIGINAL') continue;
        const entry = { col, csvId, csvName: csv.name };
        any.push(entry);
        if ((csv.columnTypes?.[col] || '') === 'decision') decision.push(entry);
      }
    }
    return { decision, any };
  };

  // Auto-match via normalizeColName (fuzzy) — mesmo padrão da reconciliação de
  // dataset (onImportConfirm) e do de-para da Tabela de Inferência.
  const autoMatchPolicyVar = (reqVar, pool) => {
    if (!pool.length) return null;
    return pool.find(c => c.col === reqVar.col)
      || pool.find(c => normalizeColName(c.col) === normalizeColName(reqVar.col))
      || null;
  };

  const openPolicyLibrary = (mode = 'browse') => {
    setPolicyLibraryModal({
      mode, search: '',
      saveMeta: { name: canvases[activeCanvasId]?.name || 'Política', description: '', tags: '' },
      overwriteId: null,
    });
  };

  const savePolicyToLibrary = () => {
    const { saveMeta, overwriteId } = policyLibraryModal;
    const ir = buildPolicyIR(shapesR.current, connsR.current, csvStoreR.current, { name: saveMeta.name || null });
    const requiredVars = extractPolicyRequiredVars(ir);
    const tags = (saveMeta.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const item = {
      id: overwriteId ?? uid(),
      name: saveMeta.name || 'Política',
      description: saveMeta.description || '',
      tags,
      ir,
      requiredVars,
      savedAt: new Date().toISOString(),
    };
    setPolicyLibrary(prev => overwriteId ? prev.map(it => it.id === overwriteId ? item : it) : [...prev, item]);
    setPolicyLibraryModal(prev => prev ? { ...prev, mode: 'browse', overwriteId: null } : prev);
  };

  const deletePolicyFromLibrary = (itemId) => {
    setPolicyLibrary(prev => prev.filter(it => it.id !== itemId));
  };

  // Abre o modal de mapeamento (padrão cinemaImportModal): auto-match por
  // normalizeColName, pendência visível (mapping[col] = null) para o que não casou.
  const openPolicyApplyModal = (item) => {
    const requiredVars = item.requiredVars?.length ? item.requiredVars : extractPolicyRequiredVars(item.ir);
    const { decision, any } = buildPolicyVarCandidates(csvStoreR.current);
    const mapping = {};
    for (const rv of requiredVars) {
      mapping[rv.col] = autoMatchPolicyVar(rv, rv.kind === 'decision' ? decision : any);
    }
    setPolicyApplyModal({ itemId: item.id, name: item.name, ir: item.ir, requiredVars, mapping });
    setPolicyLibraryModal(null);
  };

  // Materializa o template no canvas ativo: remapeia o IR (applyPolicyVarMapping)
  // e ANEXA via o único aplicador da DEC-IA-002 (applyPolicyPatch). Variáveis sem
  // mapeamento viram pendência visível (aviso + nós sem variável, sinalizados pelo
  // lint do Copiloto Sessão 1 como chegada zero) — nunca erro nem aplicação parcial
  // silenciosa de outra coluna. O posicionamento em camadas do aplicador já deixa o
  // canvas legível; o usuário pode reorganizar com ⊹ Reorganizar se quiser.
  const applyPolicyTemplate = () => {
    const { ir, mapping, requiredVars } = policyApplyModal;
    pushHistory();
    const remapped = applyPolicyVarMapping(ir, mapping);
    const { shapes: newShapes, conns: newConns } = applyPolicyPatch(remapped, { shapes: shapesR.current, conns: connsR.current });
    setShapes(newShapes);
    setConns(newConns);
    const pending = requiredVars.filter(rv => !mapping[rv.col]);
    setPolicyApplyModal(null);
    setImportWarn(pending.length > 0
      ? `Política aplicada com ${pending.length} variável${pending.length !== 1 ? 'is' : ''} sem mapeamento: ${pending.map(p => p.col).join(', ')}. Os nós correspondentes ficaram sem variável definida (0 chegadas — o Copiloto vai sinalizar); configure-os no canvas ou use ⊹ Reorganizar.`
      : null);
  };

  // ── exportPolicyLibrary / onPolicyLibFileChange ─────────────────
  const exportPolicyLibrary = () => {
    const library = policyLibraryR.current;
    if (library.length === 0) return;
    const payload = { schemaVersion: '1.0', kind: 'policy-library', exportedAt: new Date().toISOString(), items: library };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `biblioteca-politicas-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onPolicyLibFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.kind !== 'policy-library' || !Array.isArray(data.items)) {
          setImportError("Arquivo inválido: não é uma biblioteca de políticas exportada por este sistema.");
          return;
        }
        // IDs novos p/ evitar colisão com itens já salvos (mesmo padrão do import de fluxo).
        const imported = data.items.map(it => ({
          ...it,
          id: uid(),
          requiredVars: it.requiredVars?.length ? it.requiredVars : extractPolicyRequiredVars(it.ir),
        }));
        setPolicyLibrary(prev => [...prev, ...imported]);
      } catch {
        setImportError("Arquivo inválido: não foi possível ler o JSON. Verifique se o arquivo não está corrompido.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
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
      return {...s, cellsUserEdited: true, cells: {...(s.cells??{}), [cellKey]: cur > 0 ? 0 : 1}};
    }));
  }, []);

  // ── setCinemaCellValue ────────────────────────────────────────
  const setCinemaCellValue = useCallback((shapeId, cellKey, value) => {
    const n = Math.max(0, Math.floor(Number(value) || 0));
    pushHistory();
    setShapes(prev => prev.map(s => {
      if (s.id !== shapeId) return s;
      return {...s, cellsUserEdited: true, cells: {...(s.cells??{}), [cellKey]: n}};
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

  // ── Copiloto — "ir até o nó" + quick-fixes não-destrutivos (Sessão 1) ─────────
  // Acha o shape pelo id (achados do Copiloto são sempre do canvas ativo — mesmo
  // escopo shapes/conns que RUN_SIMULATION/COMPUTE_OVERLAY), seleciona e centraliza
  // o viewport nele, mantendo o zoom atual.
  const goToCopilotNode = useCallback((nodeId) => {
    const s = shapesR.current.find(x => x.id === nodeId);
    if (!s) return;
    setSel(nodeId);
    setMultiSel(new Set());
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const cx = s.x + (s.w || 0) / 2, cy = s.y + (s.h || 0) / 2;
    setVp(v => ({ s: v.s, x: svgEl.clientWidth / 2 - cx * v.s, y: svgEl.clientHeight / 2 - cy * v.s }));
  }, []); // eslint-disable-line

  // Quick-fix "conectar a um terminal": cria um terminal (Aprovado/Reprovado) e uma
  // conexão a partir do nó/porta solta — mesmo padrão de criação usado pelo tool de
  // terminal na toolbar. Não-destrutivo: só adiciona; pushHistory() antes.
  const applyCopilotConnectTerminal = useCallback((nodeId, terminal) => {
    const s = shapesR.current.find(x => x.id === nodeId);
    if (!s) return;
    pushHistory();
    const id = uid();
    const w = 120, h = 44;
    const label = terminal === 'approved' ? 'Aprovado' : terminal === 'rejected' ? 'Reprovado' : 'AS IS';
    const x = (s.x ?? 0) + (s.w || 0) + 90;
    const y = (s.y ?? 0) + ((s.h || 0) - h) / 2;
    setShapes(p => [...p, { id, type: terminal, x, y, w, h, label, color: '#ffffff' }]);
    setConns(p => [...p, { id: uid(), from: nodeId, to: id }]);
    setSel(id);
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

    // Alvos da prévia AS IS: cineminhas cujas caselas não foram editadas manualmente
    // e não têm resultVar. A prévia agora é CONTEXTUALIZADA ao nó (respeita os filtros
    // a montante — Decision Lens/ports) e por isso é computada no worker, de forma
    // assíncrona; até a resposta chegar, as caselas ficam com o valor herdado (default
    // elegível). `reqTokens` deixa a resposta descartar-se se houver reatribuição.
    const previewTargetIds = [];
    const reqTokens = {};
    const nextShapes = shapesR.current.map(s => {
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
        } else if (!s.cellsUserEdited && (newRowVar || newColVar)) {
          // Prévia contextualizada ao nó: computada no worker sobre a população que
          // efetivamente chega a este cineminha. Registra o token e adia a aplicação.
          const token = ++asIsPreviewCounterRef.current;
          asIsPreviewTokenRef.current[s.id] = token;
          reqTokens[s.id] = token;
          previewTargetIds.push(s.id);
        }
        return baseShape;
      }
      if (portPositions[s.id]) {
        return {...s, ...portPositions[s.id]};
      }
      return s;
    });

    setShapes(nextShapes);
    setAxisModal(null);

    if (previewTargetIds.length > 0) {
      workerRef.current?.postMessage({
        type: 'COMPUTE_ASIS_PREVIEW',
        shapes: nextShapes,
        conns: connsR.current,
        targetIds: previewTargetIds,
        reqTokens,
      });
    }
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
  // M1 (import vetorizado): o preview vem inteiro do que o parse colunar já
  // deixou no wizard (headers + previewRows de ~100 linhas + rowCount) — não
  // existe mais rawText/string[][] para reparsear. Enquanto um reparse do
  // passo 1 está em andamento, os campos parsed* ainda batem com o
  // delimiter/hasHeader vigentes (só mudam juntos, ao fim do reparse).
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
      return { headers: wizard.parsedHeaders, rows: wizard.previewRows || [], count: wizard.parsedRowCount || 0 };
    }
    return null;
  }, [wizard?.delimiter, wizard?.hasHeader, wizard?.editCsvId, wizard?.parsedHeaders, wizard?.previewRows, wizard?.parsedRowCount, wizard?.parsedDelimiter, wizard?.parsedHasHeader, editingCsv]);

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
  const renderConn = (conn, byId = shapesById) => {
    if (hiddenPortIds.has(conn.from) || hiddenPortIds.has(conn.to)) return null; // port escondido em "Configurar nó"
    // M12: `byId` permite ao overlay de arraste resolver `from`/`to` com posições deslocadas
    // (só o extremo arrastado se move); na cena normal usa o índice O(1) padrão.
    const from=byId.get(conn.from), to=byId.get(conn.to);
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
    // Contagem de população impactada (Feature 4) — vem do worker (M10), ponderada pelo
    // volume: {count, total}. Chega via OVERLAY_RESULT (debounced), sem varrer a base na main.
    const stats = lensCounts[id];
    const popQty = stats?.count || 0;
    const popTotal = stats?.total || 0;
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
        const vpc=vpR.current; const sx2=shape.x*vpc.s+vpc.x, sy2=shape.y*vpc.s+vpc.y;
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
  const editShape=edit?shapesById.get(edit.id):null;
  const commitEdit=()=>{if(!edit)return;pushHistory();setShapes(p=>p.map(s=>s.id===edit.id?{...s,label:edit.val}:s));setEdit(null);};
  const selShape=sel?shapesById.get(sel):null;
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
    setShapes(prev => prev.map(s => s.id === shapeId ? { ...s, cellsUserEdited: true, cells: proposedCells } : s));
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
      riskLevels:    overrides.riskLevels    ?? cur.riskLevels,
      hierarchyMode: overrides.hierarchyMode ?? cur.hierarchyMode,
      inadMetric:    overrides.inadMetric    ?? cur.inadMetric,
    });
  };

  const applyJohnnyResult = (proposedByShape) => {
    pushHistory();
    setShapes(prev => prev.map(s =>
      proposedByShape[s.id] ? { ...s, cellsUserEdited: true, cells: proposedByShape[s.id] } : s
    ));
    setJohnnyModal(null);
  };

  // ── Goal Seek — Copiloto Sessão 4 (DEC-IA-005/006) ────────────────────────────
  // Trava/destrava um nó (decision/cineminha/decision_lens) para o Goal Seek — nenhum
  // movimento do catálogo toca um nó com `locked:true` (persiste via canvases, sem
  // trabalho extra de schema — ver regra do CLAUDE.md).
  const toggleShapeLock = (shapeId) => {
    pushHistory();
    setShapes(prev => prev.map(s => s.id === shapeId ? { ...s, locked: !s.locked } : s));
  };

  const openGoalSeekModal = () => {
    setGoalSeekModal({
      step: 'form',
      goal: { target: 'approvalRate', direction: 'increase', magnitude: 2, minimize: 'inadInferida' },
      constraints: { maxInadReal: null, maxInadInf: null },
      context: null, // "Ponto de partida" (GS1, DEC-GS-002) — skeleton até GOAL_SEEK_CONTEXT_RESULT
      via: null,             // GS6 — 'sidecar' (ótimo MILP) | 'greedy' (guloso navegador)
      curves: null,          // GS6 — família de curvas por teto de inad. inferida (sem teto declarado)
      deepRun: null,         // GS6 — job Classe B em andamento ({phase, progress, via})
      fallbackNotice: null,  // GS6 — "concluído no modo guloso" quando o sidecar caiu/não achou solução
    });
    workerRef.current?.postMessage({
      type: 'COMPUTE_GOAL_SEEK_CONTEXT',
      shapes: shapesR.current,
      conns: connsR.current,
    });
  };

  // Execução Híbrida GS6 (docs/wiki/Hibrido-GoalSeek-Profundo.md, DEC-GS-005/010) —
  // modo profundo AUTOMÁTICO (sem toggle manual): quando o sidecar está pareado e
  // declara `goal_seek_deep` em capabilities, a busca vira MILP exata (sem teto) via o
  // fluxo de 3 passos CATALOG → job sidecar → VALIDATE; senão segue 100% no guloso
  // clássico de sempre (COMPUTE_GOAL_SEEK, intocado).
  const goalSeekDeepOk = () => {
    const tasks = computeSidecarStatusR.current?.capabilities?.tasks;
    return !!computeSidecarR.current?.enabled && !!computeSidecarStatusR.current?.available &&
      Array.isArray(tasks) && tasks.includes('goal_seek_deep');
  };

  const runGoalSeek = () => {
    if (!goalSeekModalR.current) return;
    if (goalSeekDeepOk() && computeRouterRef.current) {
      runDeepGoalSeek();
    } else {
      runClassicGoalSeek();
    }
  };

  const runClassicGoalSeek = () => {
    const cur = goalSeekModalR.current;
    if (!cur) return;
    setGoalSeekModal(m => (m ? { ...m, step: 'loading', deepRun: null, via: 'greedy' } : m));
    workerRef.current?.postMessage({
      type: 'COMPUTE_GOAL_SEEK',
      shapes: shapesR.current,
      conns: connsR.current,
      goal: cur.goal,
      constraints: cur.constraints,
      locks: [],
    });
  };

  // GS6 (DEC-GS-005) — fluxo de 3 passos: COMPUTE_GOAL_SEEK_CATALOG (worker, Classe A —
  // catálogo agregado + baselineRaw + token) → `goal_seek_deep` (SÓ sidecar, self-
  // contained, SEM registerDataset — leva o catálogo, nunca a base) → COMPUTE_GOAL_SEEK_VALIDATE
  // (worker, Classe A — invariantes DEC-GS-001 + materialização + re-simulação real).
  // O passo do meio fala com `sidecarProxyRef` DIRETO (não via `computeRouterRef.run`):
  // `goal_seek_deep` não tem gêmeo no worker (DEC-GS-001), então o fallback GENÉRICO do
  // ComputeRouter (postar a mesma task pro worker quando o sidecar cai) travaria
  // esperando uma resposta que nunca chega — mesmo raciocínio do `echo_stats`/
  // `SidecarTestPanel` acima. O fallback real (ao guloso) é feito aqui, explicitamente,
  // em qualquer queda: job/infeasible/solução inválida/token obsoleto. Abort do usuário
  // NÃO dispara fallback (mesmo contrato de H7/H8).
  const goalSeekAbortRef = useRef(null);

  const runDeepGoalSeek = async () => {
    const cur = goalSeekModalR.current;
    if (!cur) return;
    const ctrl = new AbortController();
    goalSeekAbortRef.current = ctrl;
    setGoalSeekModal(m => (m ? { ...m, step: 'loading', fallbackNotice: null, curves: null,
      deepRun: { phase: 'catalog', progress: null, via: 'worker' } } : m));
    try {
      const catalogRes = await computeRouterRef.current.run('COMPUTE_GOAL_SEEK_CATALOG', {
        shapes: shapesR.current, conns: connsR.current, locks: [],
      });
      if (ctrl.signal.aborted) return;
      const { catalogToken, baselineRaw, candidates } = catalogRes.result || {};

      setGoalSeekModal(m => (m ? { ...m, deepRun: { phase: 'optimizing', progress: null, via: 'sidecar' } } : m));
      let jobRes = null;
      try {
        jobRes = await sidecarProxyRef.current.runJob('goal_seek_deep', {
          catalog: { baselineRaw, candidates },
          goal: cur.goal, constraints: cur.constraints,
          frontierPoints: GOAL_SEEK_FRONTIER_POINTS, timeLimitSec: GOAL_SEEK_TIME_LIMIT_SEC,
        }, { signal: ctrl.signal, onProgress: (p) => setGoalSeekModal(m => (
          m && m.deepRun ? { ...m, deepRun: { ...m.deepRun, progress: p } } : m)) });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        jobRes = null; // queda/indisponível ⇒ cai no guloso abaixo
      }
      if (ctrl.signal.aborted) return;

      if (jobRes && jobRes.status !== 'infeasible' && jobRes.solution) {
        setGoalSeekModal(m => (m ? { ...m, deepRun: { phase: 'validating', progress: null, via: 'worker' } } : m));
        const valRes = await computeRouterRef.current.run('COMPUTE_GOAL_SEEK_VALIDATE', {
          shapes: shapesR.current, conns: connsR.current,
          goal: cur.goal, constraints: cur.constraints, locks: [],
          moveIds: jobRes.solution.ids || [],
          catalogToken,
          frontier: jobRes.frontier || [],
        });
        if (ctrl.signal.aborted) return;
        const r = valRes.result;
        if (r && !r.error) {
          setGoalSeekModal(m => (m ? { ...m, step: 'result', deepRun: null, via: 'sidecar',
            curves: jobRes.curves || null,
            goal: r.goal, baseline: r.baseline, frontier: r.frontier, moves: r.moves,
            goalReached: r.goalReached, bindingConstraint: r.bindingConstraint, result: r.result,
            fallbackNotice: jobRes.status === 'time_limit'
              ? 'Motor Python: tempo esgotado — melhor solução encontrada (ótimo não provado).' : null,
          } : m));
          return;
        }
        // solução inválida/token obsoleto (DEC-GS-001) ⇒ cai no guloso abaixo, com aviso
      }
      const notice = 'Motor Python indisponível ou sem solução ótima — a busca rodou no modo guloso (navegador).';
      setGoalSeekModal(m => (m ? { ...m, fallbackNotice: notice } : m));
      runClassicGoalSeek();
    } catch {
      if (!ctrl.signal.aborted) {
        setGoalSeekModal(m => (m ? { ...m, fallbackNotice:
          'Motor Python indisponível — a busca rodou no modo guloso (navegador).' } : m));
        runClassicGoalSeek();
      }
    }
  };

  const cancelDeepGoalSeek = () => {
    goalSeekAbortRef.current?.abort();
    setGoalSeekModal(m => (m ? { ...m, step: 'form', deepRun: null } : m));
  };

  // Materializa os movimentos aceitos numa aba de canvas NOVA (padrão duplicateCanvas/
  // Sub-sessão 5A) — não-destrutivo: a política de origem fica intocada, comparável
  // no Dashboard/KPI A vs B. Aplica no CLONE via applyGoalSeekMoves (mesmo helper
  // usado internamente pelo worker para a validação por re-simulação, DEC-IA-005).
  const applyGoalSeekResult = () => {
    const cur = goalSeekModalR.current;
    if (!cur || !cur.moves || cur.moves.length === 0) return;
    const curCanvasId = activeCanvasIdR.current;
    const source = canvasesR.current[curCanvasId];
    const srcShapes = shapesR.current, srcConns = connsR.current;
    const { newShapes, newConns, idMap } = cloneCanvasWithNewIds(srcShapes, srcConns);
    const { shapes: patchedShapes, conns: patchedConns } =
      applyGoalSeekMoves(newShapes, newConns, cur.moves.map(m => m.apply), idMap);
    const id = uid();
    const label = `${GOAL_SEEK_TARGET_LABELS[cur.goal.target] || 'Objetivo'} ${cur.goal.direction === 'increase' ? '+' : '−'}`;
    setCanvases(prev => ({
      ...prev,
      [curCanvasId]: { ...prev[curCanvasId], shapes: srcShapes, conns: srcConns },
      [id]: { id, name: `${source?.name || 'Canvas'} · ${label}`, shapes: patchedShapes, conns: patchedConns, includeInDashboard: true },
    }));
    setShapes(patchedShapes); setConns(patchedConns);
    setUndoStack([]); setRedoStack([]);
    setSel(null); setMultiSel(new Set());
    setActiveCanvasId(id);
    setActiveTab('canvas');
    setGoalSeekModal(null);
  };

  // ── Simplificação com prova de equivalência — Copiloto Sessão 5 (DEC-IA-005/006) ─────
  // Dispara o detector de candidatos (nó colapsável, chegada zero, regra de lens sem
  // efeito, variável re-testada) direto — sem formulário, ao contrário do Goal Seek —
  // já que não há objetivo a declarar, só a política atual a reduzir.
  const openSimplifyModal = () => {
    setSimplifyModal({ step: 'loading' });
    workerRef.current?.postMessage({
      type: 'COMPUTE_SIMPLIFY',
      shapes: shapesR.current,
      conns: connsR.current,
    });
  };

  // Materializa os candidatos aceitos numa aba de canvas NOVA (mesmo padrão não-destrutivo
  // de applyGoalSeekResult) — aplica no CLONE via applySimplifyCandidates (mesmo helper
  // usado internamente pelo worker para a validação incremental por equivalência).
  const applySimplifyResult = () => {
    const cur = simplifyModalR.current;
    const candidates = cur?.proposal?.candidates || [];
    if (candidates.length === 0) return;
    const curCanvasId = activeCanvasIdR.current;
    const source = canvasesR.current[curCanvasId];
    const srcShapes = shapesR.current, srcConns = connsR.current;
    const { newShapes, newConns, idMap } = cloneCanvasWithNewIds(srcShapes, srcConns);
    const { shapes: patchedShapes, conns: patchedConns } =
      applySimplifyCandidates(newShapes, newConns, candidates, idMap);
    const id = uid();
    setCanvases(prev => ({
      ...prev,
      [curCanvasId]: { ...prev[curCanvasId], shapes: srcShapes, conns: srcConns },
      [id]: { id, name: `${source?.name || 'Canvas'} · Simplificada`, shapes: patchedShapes, conns: patchedConns, includeInDashboard: true },
    }));
    setShapes(patchedShapes); setConns(patchedConns);
    setUndoStack([]); setRedoStack([]);
    setSel(null); setMultiSel(new Set());
    setActiveCanvasId(id);
    setActiveTab('canvas');
    setSimplifyModal(null);
  };

  // ── Descoberta de Segmentos — Copiloto Sessão 10/11 (DEC-SD-001..006) ────────────
  // Dois pontos de entrada: 🔍 Descobrir Segmentos (Fluxo, escopo global — scope=null) e
  // 🔍 Descobrir aqui (toolbar contextual de losango/Cineminha/Decision Lens/terminal —
  // scope={nodeId}, população que efetivamente chega ao nó, mesmo critério de
  // computeCinemaArrivals/prévia AS IS). Form mínimo com defaults → loading → resultado
  // (padrão goalSeekModal). Nesta sessão `recommendation` é sempre null no worker — só
  // descoberta/explicação/priorização + navegação (Dashboard/fluxo), sem patch/aplicação.
  const openSegmentDiscoveryModal = (scope) => {
    // Filtro vars = união das colunas 'decision' de todas as bases carregadas (dedup por
    // nome) — lista fixa do checklist "Variáveis incluídas na busca". reason (heurística
    // segVarDefaultReason) decide o estado INICIAL desmarcado (temporal/score); o resto
    // nasce marcado.
    const seen = new Set();
    const filtroVars = [];
    for (const csv of Object.values(csvStoreR.current)) {
      for (const [col, t] of Object.entries(csv.columnTypes || {})) {
        if (t !== 'decision' || seen.has(col)) continue;
        seen.add(col);
        filtroVars.push({ col, reason: segVarDefaultReason(col) });
      }
    }
    filtroVars.sort((a, b) => a.col.localeCompare(b.col, 'pt-BR'));
    const excludedCols = filtroVars.filter(v => v.reason).map(v => v.col);
    setSegmentDiscoveryModal({
      step: 'form',
      scope: scope || null,
      params: { riskMetric: 'inadReal', minQty: null, maxDepth: 2, beamWidth: null, excludedCols },
      filtroVars,
      varFilter: null,
      focusedId: null,
      selectedIds: [],
      combined: null,
      deepRun: null,        // H7 — job Classe B em andamento ({phase, progress, via})
      fallbackNotice: null, // H7 — "concluído no modo browser" quando o sidecar caiu
    });
  };

  // Execução Híbrida H7 — Descoberta profunda (Classe B, DEC-HX-007). Depth ≤ 2 e beam
  // padrão seguem 100% no caminho atual (COMPUTE_SEGMENT_DISCOVERY no worker — Classe A,
  // intocado). Depth 3–4 / beam ampliado roteiam a task `segment_discovery` pelo
  // ComputeRouter: sidecar (motor numpy, dataset por hash — DEC-HX-006) com fallback
  // transparente ao worker CLAMPADO aos tetos browser. O modelo do sidecar volta SEM
  // recomendações e passa pelo worker (COMPUTE_SEGMENT_RECS) para anexar patch + delta
  // re-simulado de VERDADE (DEC-SD-003 — runSimulation continua single-sourced no worker).
  const SEG_BROWSER_DEPTH = 2, SEG_BROWSER_BEAM = 8;
  const segDiscoveryAbortRef = useRef(null);

  const runSegmentDiscovery = () => {
    const cur = segmentDiscoveryModalR.current;
    if (!cur) return;
    const { riskMetric, minQty, maxDepth, beamWidth, excludedCols } = cur.params;
    const params = {
      riskMetric, maxDepth,
      ...(beamWidth != null ? { beamWidth } : {}),
      ...(minQty != null ? { minQty } : {}),
      ...(excludedCols && excludedCols.length ? { excludedCols } : {}),
    };
    const payload = {
      shapes: shapesR.current,
      conns: connsR.current,
      scope: cur.scope ? { nodeId: cur.scope.nodeId } : null,
      params,
    };
    const isDeep = (maxDepth ?? SEG_BROWSER_DEPTH) > SEG_BROWSER_DEPTH ||
      (beamWidth ?? SEG_BROWSER_BEAM) > SEG_BROWSER_BEAM;
    if (!isDeep || !computeRouterRef.current) {
      setSegmentDiscoveryModal(m => ({ ...m, step: 'loading', deepRun: null, fallbackNotice: null }));
      workerRef.current?.postMessage({ type: 'COMPUTE_SEGMENT_DISCOVERY', ...payload });
      return;
    }
    runDeepSegmentDiscovery(payload);
  };

  const runDeepSegmentDiscovery = async (payload) => {
    const ctrl = new AbortController();
    segDiscoveryAbortRef.current = ctrl;
    setSegmentDiscoveryModal(m => (m ? {
      ...m, step: 'loading', fallbackNotice: null,
      deepRun: { phase: 'discovery', progress: null, via: 'sidecar' },
    } : m));
    try {
      // Dataset por hash (DEC-HX-006): mesmos chunks do serializeCsvStore/M3 do
      // SidecarTestPanel — HEAD 200 pula o upload nas execuções seguintes.
      const serialized = serializeCsvStore(csvStoreR.current);
      const buildChunks = () => [JSON.stringify(serialized)];
      const hash = hashChunks(buildChunks());
      const res = await computeRouterRef.current.run('segment_discovery', payload, {
        dataset: { hash, buildChunks },
        signal: ctrl.signal,
        onProgress: (p) => setSegmentDiscoveryModal(m => (
          m && m.deepRun ? { ...m, deepRun: { ...m.deepRun, progress: p } } : m)),
      });
      if (ctrl.signal.aborted) return;
      if (res.via === 'sidecar') {
        // Modelo sem recomendações → o worker anexa patch + delta re-simulado.
        setSegmentDiscoveryModal(m => (m ? {
          ...m, deepRun: { phase: 'recs', progress: null, via: 'worker' },
        } : m));
        workerRef.current?.postMessage({
          type: 'COMPUTE_SEGMENT_RECS', ...payload,
          segmentModel: res.result?.segmentModel ?? null,
        });
      } else {
        // Fallback: o alias `segment_discovery` do worker clampou os tetos e já
        // respondeu SEGMENT_DISCOVERY_RESULT (o onmessage pôs o resultado no modal);
        // aqui só declaramos a degradação (paridade total, P4 — nunca silenciosa).
        const notice = fallbackNoticeText(res) ||
          'Motor Python indisponível — a Descoberta rodou no modo browser com os tetos declarados (profundidade ≤ 2, beam 8).';
        setSegmentDiscoveryModal(m => (m ? { ...m, fallbackNotice: notice } : m));
      }
    } catch {
      if (!ctrl.signal.aborted) {
        setSegmentDiscoveryModal(m => (m ? { ...m, step: 'form', deepRun: null } : m));
      }
    }
  };

  const cancelDeepSegmentDiscovery = () => {
    segDiscoveryAbortRef.current?.abort();
    setSegmentDiscoveryModal(m => (m ? { ...m, step: 'form', deepRun: null } : m));
  };

  // Foca um card (quadrante → clique no ponto) e rola a lista até ele.
  const focusSegmentFinding = (findingId) => {
    setSegmentDiscoveryModal(m => (m ? { ...m, focusedId: findingId } : m));
    requestAnimationFrame(() => {
      document.getElementById(`segfind-${findingId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  // 👁 Ver no Dashboard — converte SegmentDef.conditions (LensRule[], mesmo formato do
  // Decision Lens) em FilterCard[] de filtro de PÁGINA (foca o Dashboard inteiro no
  // segmento) e troca para a aba Dashboard. Sem condições (heterogeneous_block, escopo
  // inteiro) a ação não aparece no card — não há o que filtrar.
  const viewSegmentInDashboard = (finding) => {
    const conditions = finding?.segment?.conditions || [];
    if (conditions.length === 0) return;
    const cards = conditions.map(c => ({
      id: uid(), dim: c.col, mode: 'advanced', selected: null,
      rules: [{ id: uid(), operator: c.operator || 'equal', value: c.value, logic: null }],
    }));
    setAnalyticsPageFilters(cards);
    setActiveTab('analysis');
    setSegmentDiscoveryModal(null);
  };

  // 🎯 Ver no fluxo — reusa a mecânica de "ir até o nó" do lint (seleção + centralização
  // do viewport), generalizada para múltiplos nós: o nó de escopo (quando a varredura foi
  // restrita a um nó) + qualquer losango/Cineminha/Decision Lens cuja variável aparece nas
  // condições do segmento (ou nas colunas discriminantes, para heterogeneous_block) — mostra
  // onde na política atual essas variáveis já são usadas.
  const viewSegmentInFlow = (finding) => {
    const scopeNodeId = segmentDiscoveryModalR.current?.segmentModel?.scope?.nodeId;
    const cols = new Set((finding.segment.conditions || []).map(c => c.col));
    if (finding.code === 'heterogeneous_block') {
      for (const h of (finding.explanation.contributions || [])) cols.add(h.col);
    }
    const ids = new Set();
    if (scopeNodeId) ids.add(scopeNodeId);
    for (const s of shapesR.current) {
      if (s.type === 'decision' && s.variableCol && cols.has(s.variableCol)) ids.add(s.id);
      else if (s.type === 'cineminha' && ((s.rowVar && cols.has(s.rowVar.col)) || (s.colVar && cols.has(s.colVar.col)))) ids.add(s.id);
      else if (s.type === 'decision_lens' && (s.rules || []).some(r => cols.has(r.col))) ids.add(s.id);
    }
    if (ids.size === 0) return;
    setSel(null);
    setMultiSel(ids);
    setActiveTab('canvas');
    setSegmentDiscoveryModal(null);
    requestAnimationFrame(() => {
      const svgEl = svgRef.current;
      if (!svgEl) return;
      const targets = shapesR.current.filter(s => ids.has(s.id));
      if (targets.length === 0) return;
      const minX = Math.min(...targets.map(s => s.x)), maxX = Math.max(...targets.map(s => s.x + (s.w || 0)));
      const minY = Math.min(...targets.map(s => s.y)), maxY = Math.max(...targets.map(s => s.y + (s.h || 0)));
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      setVp(v => ({ s: v.s, x: svgEl.clientWidth / 2 - cx * v.s, y: svgEl.clientHeight / 2 - cy * v.s }));
    });
  };

  // ── Recomendações da Descoberta — Copiloto Sessão 12 (DEC-SD-003) ────────────────
  // "✓ Aplicar como novo cenário": materializa o(s) patch(es) da recomendação numa aba de
  // canvas NOVA (não-destrutivo, padrão applyGoalSeekResult/applySimplifyResult). Aplica no
  // CLONE via applyGoalSeekMoves (mesmo helper/validador do worker, DEC-IA-005) — nenhum
  // aplicador novo: as recomendações são movimentos do catálogo do Goal Seek (incl. add_break).
  const applySegmentMovesAsScenario = (moves, labelSuffix) => {
    if (!moves || moves.length === 0) return;
    const curCanvasId = activeCanvasIdR.current;
    const source = canvasesR.current[curCanvasId];
    const srcShapes = shapesR.current, srcConns = connsR.current;
    const { newShapes, newConns, idMap } = cloneCanvasWithNewIds(srcShapes, srcConns);
    // genId = uid: ids dos nós criados pela quebra ficam globalmente únicos no canvas.
    const { shapes: patchedShapes, conns: patchedConns } =
      applyGoalSeekMoves(newShapes, newConns, moves, idMap, uid);
    const id = uid();
    setCanvases(prev => ({
      ...prev,
      [curCanvasId]: { ...prev[curCanvasId], shapes: srcShapes, conns: srcConns },
      [id]: { id, name: `${source?.name || 'Canvas'} · ${labelSuffix}`, shapes: patchedShapes, conns: patchedConns, includeInDashboard: true },
    }));
    setShapes(patchedShapes); setConns(patchedConns);
    setUndoStack([]); setRedoStack([]);
    setSel(null); setMultiSel(new Set());
    setActiveCanvasId(id);
    setActiveTab('canvas');
    setSegmentDiscoveryModal(null);
  };

  const applySegmentRecommendation = (finding) => {
    const rec = finding?.recommendation;
    if (!rec || !rec.actionable || !rec.apply?.moves) return;
    applySegmentMovesAsScenario(rec.apply.moves, 'Exceção de segmento');
  };

  // "🎯 Enviar ao Goal Seek": abre o goalSeekModal com o objetivo pré-carregado da
  // recomendação (mesma direção do achado) — o usuário refina os terminais/limiares lá.
  const sendSegmentToGoalSeek = (finding) => {
    const gs = finding?.recommendation?.goalSeek;
    if (!gs) return;
    setSegmentDiscoveryModal(null);
    setGoalSeekModal({ step: 'form', goal: { ...gs }, constraints: { maxInadReal: null, maxInadInf: null } });
  };

  const toggleSegmentSelect = (id) => {
    setSegmentDiscoveryModal(m => {
      if (!m) return m;
      const set = new Set(m.selectedIds || []);
      set.has(id) ? set.delete(id) : set.add(id);
      return { ...m, selectedIds: [...set], combined: null };
    });
  };

  // Aplicação COMBINADA: dispara COMPUTE_SEGMENT_COMBINED com os patches selecionados; o
  // worker aplica em SEQUÊNCIA no mesmo clone e valida por UMA re-simulação (nunca a soma).
  const runSegmentCombined = () => {
    const cur = segmentDiscoveryModalR.current;
    if (!cur) return;
    const byId = new Map((cur.segmentModel?.findings || []).map(f => [f.id, f]));
    const applies = (cur.selectedIds || [])
      .map(id => byId.get(id)?.recommendation)
      .filter(r => r && r.actionable && r.apply?.moves)
      .map(r => r.apply);
    if (applies.length < 2) return;
    setSegmentDiscoveryModal(m => (m ? { ...m, combined: { loading: true } } : m));
    workerRef.current?.postMessage({
      type: 'COMPUTE_SEGMENT_COMBINED',
      shapes: shapesR.current, conns: connsR.current, applies,
    });
  };

  const applySegmentCombinedAsScenario = () => {
    const cur = segmentDiscoveryModalR.current;
    if (!cur) return;
    const byId = new Map((cur.segmentModel?.findings || []).map(f => [f.id, f]));
    const moves = (cur.selectedIds || [])
      .map(id => byId.get(id)?.recommendation)
      .filter(r => r && r.actionable && r.apply?.moves)
      .flatMap(r => r.apply.moves);
    applySegmentMovesAsScenario(moves, `${(cur.selectedIds || []).length} exceções combinadas`);
  };

  // ── Clusterização de Segmentos — Execução Híbrida H8 (DEC-HX-005/007, P4) ────────
  // Botão SEMPRE habilitado (paridade total): dentro dos tetos do browser (≤3 dims,
  // k ≤ 8, k-means) a task roda direto no worker (COMPUTE_CLUSTER_SEGMENTS, clampada);
  // acima deles (mais dims/k, k automático por silhueta, hierárquico — extras sklearn)
  // roteia `cluster_segments` pelo ComputeRouter: sidecar (motor_clusters.py, dataset
  // por hash — DEC-HX-006) com fallback transparente ao worker CLAMPADO + aviso.
  const CLU_BROWSER_DIMS = 3, CLU_BROWSER_K = 8;
  const clusterAbortRef = useRef(null);

  const openClusterModal = () => {
    const store = csvStoreR.current || {};
    // default = base de maior nº de linhas (mesmo critério do motor)
    let csvId = null, best = -1;
    for (const id of Object.keys(store)) {
      const n = store[id]?.rowCount || 0;
      if (n > best) { best = n; csvId = id; }
    }
    setClusterModal({
      step: 'form', csvId, dims: [], k: 4, autoK: false, method: 'kmeans',
      model: null, focusedId: null, deepRun: null, fallbackNotice: null,
    });
  };

  const runClusterSegments = () => {
    const cur = clusterModalR.current;
    if (!cur || !cur.csvId || cur.dims.length === 0) return;
    const params = {
      csvId: cur.csvId, dims: cur.dims, k: cur.k,
      ...(cur.autoK ? { autoK: true } : {}),
      ...(cur.method !== 'kmeans' ? { method: cur.method } : {}),
    };
    const isDeep = cur.dims.length > CLU_BROWSER_DIMS || cur.k > CLU_BROWSER_K ||
      cur.autoK || cur.method !== 'kmeans';
    if (!isDeep || !computeRouterRef.current) {
      setClusterModal(m => ({ ...m, step: 'loading', deepRun: null, fallbackNotice: null }));
      workerRef.current?.postMessage({ type: 'COMPUTE_CLUSTER_SEGMENTS', params });
      return;
    }
    runDeepClusterSegments(params);
  };

  const runDeepClusterSegments = async (params) => {
    const ctrl = new AbortController();
    clusterAbortRef.current = ctrl;
    setClusterModal(m => (m ? {
      ...m, step: 'loading', fallbackNotice: null,
      deepRun: { progress: null, via: 'sidecar' },
    } : m));
    try {
      // Dataset por hash (DEC-HX-006) — mesmos chunks do serializeCsvStore/M3 da H7;
      // HEAD 200 pula o upload nas execuções seguintes.
      const serialized = serializeCsvStore(csvStoreR.current);
      const buildChunks = () => [JSON.stringify(serialized)];
      const hash = hashChunks(buildChunks());
      const res = await computeRouterRef.current.run('cluster_segments', { params }, {
        dataset: { hash, buildChunks },
        signal: ctrl.signal,
        onProgress: (p) => setClusterModal(m => (
          m && m.deepRun ? { ...m, deepRun: { ...m.deepRun, progress: p } } : m)),
      });
      if (ctrl.signal.aborted) return;
      if (res.via === 'sidecar') {
        // Diferente da Descoberta (H7), não há etapa de recomendações no worker: o
        // ClusterModel do sidecar já é final — mesmo payload do CLUSTER_SEGMENTS_RESULT.
        const clusterModel = res.result?.clusterModel ?? null;
        setClusterModal(m => (m ? {
          ...m, step: 'result', model: clusterModel, deepRun: null,
          focusedId: clusterModel?.clusters?.[0]?.id ?? null,
        } : m));
      } else {
        // Fallback: o alias `cluster_segments` do worker clampou os tetos e já
        // respondeu CLUSTER_SEGMENTS_RESULT (o onmessage pôs o resultado no modal);
        // aqui só declaramos a degradação (paridade total, P4 — nunca silenciosa).
        const notice = fallbackNoticeText(res) ||
          'Motor Python indisponível — a clusterização rodou no modo browser com os tetos declarados (até 3 dimensões, k ≤ 8, 2.000 pontos, k-means).';
        setClusterModal(m => (m ? { ...m, fallbackNotice: notice } : m));
      }
    } catch {
      if (!ctrl.signal.aborted) {
        setClusterModal(m => (m ? { ...m, step: 'form', deepRun: null } : m));
      }
    }
  };

  const cancelDeepClusterSegments = () => {
    clusterAbortRef.current?.abort();
    setClusterModal(m => (m ? { ...m, step: 'form', deepRun: null } : m));
  };

  // Foca um card (quadrante → clique no ponto) e rola a lista até ele.
  const focusCluster = (clusterId) => {
    setClusterModal(m => (m ? { ...m, focusedId: clusterId } : m));
    requestAnimationFrame(() => {
      document.getElementById(`clucard-${clusterId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  };

  // 👁 Ver no Dashboard — converte o cluster em FilterCard[] de filtro de PÁGINA (um
  // cartão por dimensão, modo BÁSICO com a lista exata de valores — lossless mesmo
  // quando um valor contém vírgula, o que quebraria o operador `in` do modo avançado;
  // as `conditions` LensRule do modelo continuam disponíveis para lens/relatórios).
  const viewClusterInDashboard = (cluster) => {
    const cards = (cluster?.dims || [])
      .filter(d => (d.values || []).length > 0)
      .map(d => ({
        id: uid(), dim: d.col, mode: 'basic',
        selected: d.values.map(v => v.value), rules: [],
      }));
    if (cards.length === 0) return;
    setAnalyticsPageFilters(cards);
    setActiveTab('analysis');
    setClusterModal(null);
  };

  // ── Variável de Cluster — transformar o resultado numa coluna Filtro arrastável ──
  // Aplica um transform (shapes,conns)=>{shapes,conns} a TODAS as abas + à working copy
  // ativa (rename de coluna/rótulo reflete em todo canvas). O transform deve ser PURO
  // (é chamado uma vez por aba). Ver renameClusterColumnRefs/renameClusterLabelRefs.
  const applyRefTransformAllCanvases = (transform) => {
    const activeId = activeCanvasIdR.current;
    setCanvases(prev => {
      const next = {};
      for (const [id, cv] of Object.entries(prev)) {
        const src = id === activeId
          ? { shapes: shapesR.current, conns: connsR.current }
          : { shapes: cv.shapes || [], conns: cv.conns || [] };
        const t = transform(src.shapes, src.conns);
        next[id] = { ...cv, shapes: t.shapes, conns: t.conns };
      }
      return next;
    });
    const t = transform(shapesR.current, connsR.current);
    setShapes(t.shapes); setConns(t.conns);
  };

  // Passo "Salvar como variável" — pré-preenche nome da variável e rótulos dos clusters
  // com sugestões editáveis (comportamento: aprovação/risco), único vs. headers da base.
  const openClusterSaveStep = () => {
    const cur = clusterModalR.current;
    if (!cur || !cur.model || cur.model.error || !cur.csvId) return;
    const headers = csvStoreR.current[cur.csvId]?.headers || [];
    setClusterModal(m => ({
      ...m, step: 'save',
      save: {
        varName: suggestClusterVarName(cur.model, headers),
        labels: suggestClusterLabels(cur.model),
        unmatched: 'Fora dos clusters',
        error: null,
      },
    }));
  };

  // Materializa a variável: valida nomes, deriva a coluna dict (deriveClusterColumn),
  // e a insere no csvStore (headers/columns/columnTypes/varTypes) junto da DEFINIÇÃO
  // editável (clusterDefs[col]). A coluna passa a aparecer como chip Filtro (decisionVars),
  // arrastável ao canvas; a mudança de csvStore re-semeia o worker e re-simula.
  const saveClusterVariable = () => {
    const cur = clusterModalR.current;
    if (!cur || !cur.model || !cur.csvId || !cur.save) return;
    const { model, csvId, save } = cur;
    const csv = csvStoreR.current[csvId];
    if (!csv) return;
    const varName = (save.varName || '').trim();
    const labels = (save.labels || []).map(l => (l || '').trim());
    const unmatched = (save.unmatched || '').trim() || 'Fora dos clusters';
    if (!varName) return setClusterModal(m => ({ ...m, save: { ...m.save, error: 'Dê um nome à variável.' } }));
    if ((csv.headers || []).includes(varName))
      return setClusterModal(m => ({ ...m, save: { ...m.save, error: `Já existe uma coluna "${varName}" nesta base.` } }));
    if (labels.some(l => !l))
      return setClusterModal(m => ({ ...m, save: { ...m.save, error: 'Todo cluster precisa de um nome.' } }));
    if (new Set(labels).size !== labels.length)
      return setClusterModal(m => ({ ...m, save: { ...m.save, error: 'Os nomes dos clusters devem ser distintos.' } }));

    const def = buildClusterDefFromModel(model, { col: varName, csvId, labels, unmatchedLabel: unmatched, genId: uid });
    const colData = deriveClusterColumn(csv, def);
    setCsvStore(prev => {
      const c = prev[csvId]; if (!c) return prev;
      return {
        ...prev,
        [csvId]: {
          ...c,
          headers: [...c.headers, varName],
          columns: { ...c.columns, [varName]: colData },
          columnTypes: { ...(c.columnTypes || {}), [varName]: 'decision' },
          varTypes: { ...(c.varTypes || {}), [varName]: 'categorical' },
          clusterDefs: { ...(c.clusterDefs || {}), [varName]: def },
        },
      };
    });
    setClusterModal(m => ({ ...m, step: 'saved', savedCol: varName, savedCsvId: csvId }));
  };

  // ── Editor da Variável de Cluster (✏️ no chip do painel) ─────────────────────────
  const openClusterVarEdit = (csvId, col) => {
    const csv = csvStoreR.current[csvId];
    const def = csv?.clusterDefs?.[col];
    if (!def) return;
    // Valores distintos por dimensão (da base) — garante que valores não atribuídos a
    // nenhum cluster apareçam na matriz de edição.
    const baseValuesByDim = {};
    for (const dc of (def.dims || [])) {
      const ci = csv.headers.indexOf(dc);
      baseValuesByDim[dc] = ci >= 0 ? distinctColValues(csv, ci).map(v => (v ?? '').toString().trim()) : [];
    }
    setClusterVarModal({ csvId, col, draft: JSON.parse(JSON.stringify(def)), baseValuesByDim, error: null, confirmDelete: false });
  };

  // Salva a edição: re-materializa a coluna, renomeia a coluna e/ou os rótulos e
  // propaga as referências (losango/porta/Cineminha/lens) por todas as abas.
  const saveClusterVarEdit = () => {
    const cur = clusterVarModalR.current;
    if (!cur) return;
    const { csvId, col: oldCol, draft } = cur;
    const csv = csvStoreR.current[csvId];
    if (!csv) return;
    const origDef = csv.clusterDefs?.[oldCol];
    const newCol = (draft.col || '').trim();
    if (!newCol) return setClusterVarModal(m => ({ ...m, error: 'Dê um nome à variável.' }));
    if (newCol !== oldCol && (csv.headers || []).includes(newCol))
      return setClusterVarModal(m => ({ ...m, error: `Já existe uma coluna "${newCol}" nesta base.` }));
    const labels = (draft.groups || []).map(g => (g.label || '').trim());
    if (labels.some(l => !l)) return setClusterVarModal(m => ({ ...m, error: 'Todo cluster precisa de um nome.' }));
    if (new Set(labels).size !== labels.length)
      return setClusterVarModal(m => ({ ...m, error: 'Os nomes dos clusters devem ser distintos.' }));

    // Def final (com col e labels normalizados).
    const finalDef = {
      ...draft, col: newCol, csvId,
      groups: (draft.groups || []).map((g, i) => ({ ...g, label: labels[i] })),
    };
    const colData = deriveClusterColumn(csv, finalDef);

    // Mapa de rótulos renomeados (por id de grupo) para propagar às portas/domínios.
    const labelMap = {};
    for (const g of (origDef?.groups || [])) {
      const ng = finalDef.groups.find(x => x.id === g.id);
      if (ng && ng.label !== g.label) labelMap[g.label] = ng.label;
    }

    // csvStore: (re)materializa + rename de chave se o nome mudou.
    setCsvStore(prev => {
      const c = prev[csvId]; if (!c) return prev;
      const headers = c.headers.map(h => (h === oldCol ? newCol : h));
      const columns = { ...c.columns }; if (newCol !== oldCol) delete columns[oldCol]; columns[newCol] = colData;
      const columnTypes = { ...(c.columnTypes || {}) };
      const varTypes = { ...(c.varTypes || {}) };
      const clusterDefs = { ...(c.clusterDefs || {}) };
      if (newCol !== oldCol) {
        columnTypes[newCol] = columnTypes[oldCol] || 'decision'; delete columnTypes[oldCol];
        varTypes[newCol] = varTypes[oldCol] || 'categorical'; delete varTypes[oldCol];
        delete clusterDefs[oldCol];
      }
      clusterDefs[newCol] = finalDef;
      return { ...prev, [csvId]: { ...c, headers, columns, columnTypes, varTypes, clusterDefs } };
    });

    // Referências no canvas (todas as abas): rename de coluna e depois de rótulos.
    if (newCol !== oldCol || Object.keys(labelMap).length > 0) {
      pushHistory();
      applyRefTransformAllCanvases((shapes, conns) => {
        let s = shapes, cn = conns;
        if (newCol !== oldCol) { const t = renameClusterColumnRefs(s, cn, csvId, oldCol, newCol); s = t.shapes; cn = t.conns; }
        if (Object.keys(labelMap).length > 0) { const t = renameClusterLabelRefs(s, cn, csvId, newCol, labelMap); s = t.shapes; cn = t.conns; }
        return { shapes: s, conns: cn };
      });
    }
    setClusterVarModal(null);
  };

  // Remove a variável de cluster (coluna + definição). Nós que a referenciam ficam sem
  // domínio (mesma degradação de variável ausente já tratada pelo app) — avisamos no modal.
  const deleteClusterVariable = () => {
    const cur = clusterVarModalR.current;
    if (!cur) return;
    const { csvId, col } = cur;
    setCsvStore(prev => {
      const c = prev[csvId]; if (!c) return prev;
      const columns = { ...c.columns }; delete columns[col];
      const columnTypes = { ...(c.columnTypes || {}) }; delete columnTypes[col];
      const varTypes = { ...(c.varTypes || {}) }; delete varTypes[col];
      const clusterDefs = { ...(c.clusterDefs || {}) }; delete clusterDefs[col];
      return { ...prev, [csvId]: { ...c, headers: c.headers.filter(h => h !== col), columns, columnTypes, varTypes, clusterDefs } };
    });
    setClusterVarModal(null);
  };

  // ── Documentação Automática — Copiloto Sessão 6 (DEC-IA-006) ─────────────────
  // "📄 Documentar política" abre o formulário de composição (toggle de domínios, cenários
  // a comparar, comparação estrutural); ao confirmar, `ir` é construído aqui (buildPolicyIR
  // só existe nesta thread) e viaja PRONTO no payload de COMPUTE_POLICY_DOC — o worker só
  // computa os números que exigem varrer a base (KPIs, funil, confiabilidade, cenários).
  const openDocModal = () => {
    setDocModal({ step: 'form', includeDomains: false, compareCanvasId: null });
  };

  const runPolicyDoc = () => {
    const cur = docModalR.current;
    if (!cur) return;
    const activeId = activeCanvasIdR.current;
    const ir = buildPolicyIR(shapesR.current, connsR.current, csvStoreR.current, { name: canvasesR.current[activeId]?.name ?? null });
    const options = {
      includeDomains: !!cur.includeDomains,
      activeCanvasId: activeId,
      activeCanvasName: canvasesR.current[activeId]?.name ?? null,
    };
    let compareIr = null, compareName = null;
    if (cur.compareCanvasId && canvasesR.current[cur.compareCanvasId]) {
      const cmp = canvasesR.current[cur.compareCanvasId];
      const cmpShapes = cur.compareCanvasId === activeId ? shapesR.current : (cmp.shapes || []);
      const cmpConns  = cur.compareCanvasId === activeId ? connsR.current  : (cmp.conns  || []);
      compareIr = buildPolicyIR(cmpShapes, cmpConns, csvStoreR.current, { name: cmp.name ?? null });
      compareName = cmp.name || null;
      options.compare = { shapes: cmpShapes, conns: cmpConns };
    }
    setDocModal(m => (m ? { ...m, step: 'loading', compareIr, compareName } : m));
    workerRef.current?.postMessage({
      type: 'COMPUTE_POLICY_DOC',
      shapes: shapesR.current,
      conns: connsR.current,
      ir,
      canvases: buildAnalyticsCanvasInputs(),
      options,
    });
  };

  // Download `.md` — mesmo padrão de doExportPolicyIR (Blob + <a download>, revoke atrasado).
  const downloadDocMarkdown = () => {
    const docModel = docModalR.current?.docModel;
    if (!docModel) return;
    const md = renderDocMarkdown(docModel);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `politica_${new Date().toISOString().slice(0,10)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  // HTML self-contained numa nova janela, pronto para window.print() (→ PDF via navegador).
  const printDocHTML = () => {
    const docModel = docModalR.current?.docModel;
    if (!docModel) return;
    const html = renderDocHTML(docModel);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch {} }, 300);
  };

  // ── Sugestão de próximo nó (Copiloto Sessão 3) ─────────────────────────────
  // Dispara o ranking on-demand para a porta selecionada (não entra no tick de
  // edição/cache). `pendingRankingPortIdRef` descarta respostas obsoletas caso a
  // seleção mude antes da resposta chegar (mesmo padrão do optimModal).
  const openVariableRanking = useCallback((portId) => {
    pendingRankingPortIdRef.current = portId;
    setVariableRankingModal({ portId, loading: true });
    workerRef.current?.postMessage({
      type: 'COMPUTE_VARIABLE_RANKING',
      shapes: shapesR.current,
      conns: connsR.current,
      anchor: { nodeId: portId },
    });
  }, []); // eslint-disable-line

  // Cria um losango conectado a partir da porta selecionada, já com os ports
  // automáticos por valor distinto — mesmo idioma de createDecisionNode, mas
  // encadeado (conexão de entrada = a própria porta, sem rótulo).
  const applyRankingCreateDecision = useCallback((portId, col, csvId) => {
    const port = shapesR.current.find(s => s.id === portId);
    const csv = csvStoreR.current[csvId];
    if (!port || !csv) return;
    const colIdx = csv.headers.indexOf(col);
    if (colIdx === -1) return;
    pushHistory();
    const distinctVals = distinctColValues(csv, colIdx).slice(0, MAX_DISTINCT);
    const decId = uid();
    const dx = port.x + port.w + 90, dy = port.y + port.h / 2 - SH / 2;
    const decisionShape = { id: decId, type: 'decision', x: dx, y: dy, w: SW, h: SH, label: col, color: '#fef3c7', variableCol: col, csvId, visibleVals: null };
    const PORT_W = 80, PORT_H = 32, GAP = 14;
    const n = distinctVals.length;
    const totalH = n * PORT_H + Math.max(0, n - 1) * GAP;
    const px = dx + SW + 90;
    const ports = distinctVals.map((val, i) => ({
      id: uid(), type: 'port', x: px, y: dy + SH / 2 - totalH / 2 + i * (PORT_H + GAP), w: PORT_W, h: PORT_H, label: val, color: '#f0fdf4',
    }));
    setShapes(prev => [...prev, decisionShape, ...ports]);
    setConns(prev => [
      ...prev,
      { id: uid(), from: portId, to: decId },
      ...ports.map(p => ({ id: uid(), from: decId, to: p.id, label: p.label })),
    ]);
    setSel(decId);
    setMultiSel(new Set());
    setVariableRankingModal(null);
  }, []); // eslint-disable-line

  // Cria um Cineminha cruzando as duas variáveis da interação detectada, conectado a
  // partir da porta selecionada. Caselas nascem elegíveis por padrão (não-destrutivo,
  // sempre revisável — o usuário pode rodar ⚙ Otimizar Decisão ou ↺ Resgatar AS IS
  // depois; a prévia AS IS contextualizada do assignCinemaVar não se aplica aqui
  // porque o nó nasce com os dois eixos já atribuídos de uma vez).
  const applyRankingCreateCinema = useCallback((portId, colA, colB, csvId) => {
    const port = shapesR.current.find(s => s.id === portId);
    const csv = csvStoreR.current[csvId];
    if (!port || !csv) return;
    const rowIdx = csv.headers.indexOf(colA), colIdx = csv.headers.indexOf(colB);
    if (rowIdx === -1 || colIdx === -1) return;
    pushHistory();
    const rowDomain = sortDomain(distinctColValues(csv, rowIdx));
    const colDomain = sortDomain(distinctColValues(csv, colIdx));
    const { w: cw, h: ch } = computeCinemaSize(rowDomain, colDomain);
    const id = uid();
    const cx = port.x + port.w + 90, cy = port.y + port.h / 2 - ch / 2;
    const cells = {};
    for (const rv of rowDomain) for (const cv of colDomain) cells[`${rv}|${cv}`] = true;
    const cinemaShape = {
      id, type: 'cineminha', x: cx, y: cy, w: cw, h: ch, label: 'Cineminha', color: '#fff', cinemaType: 'eligibility',
      rowVar: { col: colA, csvId }, colVar: { col: colB, csvId }, rowDomain, colDomain, cells, resultVar: null,
      metadata: { type: 'eligibility', identifiers: {}, dimensions: { rowVariable: colA, columnVariable: colB }, variables: {}, source: 'copilot-ranking', description: '', tags: [], version: 1 },
      cellsUserEdited: false,
    };
    const cfg = getCinemaType('eligibility');
    const PORT_W = 100, PORT_H = 32;
    const eligId = uid(), notId = uid();
    const eligPort = { id: eligId, type: 'port', x: cx + cw + 36, y: cy + ch / 2 - PORT_H - 6, w: PORT_W, h: PORT_H, label: cfg.ports[0].label, color: cfg.ports[0].color };
    const notPort  = { id: notId,  type: 'port', x: cx + cw + 36, y: cy + ch / 2 + 6,          w: PORT_W, h: PORT_H, label: cfg.ports[1].label, color: cfg.ports[1].color };
    setShapes(prev => [...prev, cinemaShape, eligPort, notPort]);
    setConns(prev => [
      ...prev,
      { id: uid(), from: portId, to: id },
      { id: uid(), from: id, to: eligId, label: cfg.ports[0].label },
      { id: uid(), from: id, to: notId,  label: cfg.ports[1].label },
    ]);
    setSel(id);
    setMultiSel(new Set());
    setVariableRankingModal(null);
  }, []); // eslint-disable-line

  // M12: memoiza a CENA (frames + conexões + shapes) por seus insumos reativos, EXCLUINDO
  // o viewport `vp`. Como o `transform` de pan/zoom mora no `<g>` raiz (fora deste memo) e as
  // funções de render não leem `vp` (o tooltip usa vpR.current), pan e zoom reusam o MESMO
  // elemento de cena — React pula a reconciliação de toda a subárvore (centenas de nós/matrizes
  // de Cineminha) por frame, que era o re-render mais frequente e mais barato de eliminar.
  // O array de deps enumera exaustivamente o que renderFrame/renderConn/renderShape produzem a
  // partir do estado; qualquer mudança neles recomputa a cena (só posição/zoom não). Um dep a
  // mais só causaria re-render extra (seguro), nunca cena obsoleta — por isso é abrangente.
  // Durante o arraste (M12 item 3), os shapes/arestas em `dragIds` saem da cena e vão pro
  // overlay leve — a cena recompõe só ao INICIAR/ENCERRAR o arraste (dragIds muda), nunca por
  // frame (o dragDelta não é dep desta cena).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sceneEl = useMemo(() => (
    <>
      {shapes.filter(s=>s.type==="frame" && !(dragIds&&dragIds.has(s.id))).map(renderFrame)}
      {conns.filter(c=> !dragIds || (!dragIds.has(c.from) && !dragIds.has(c.to))).map(c=>renderConn(c))}
      {shapes.filter(s=> !(dragIds&&dragIds.has(s.id))).map(renderShape)}
    </>
  ), [shapes, conns, sel, multiSel, fromId, tool, flowErrors, hiddenPortIds, simResult,
      edgeColorScale, edgeQtyScale, enableDynThickness, showEdgeVol, showEdgeInadReal,
      showEdgeInadInf, csvStore, nodeArrivals, lensCounts, incrementalResult, activeCell, dragIds]);

  // Overlay de arraste: os shapes arrastados (transladados) + as arestas incidentes
  // (recomputadas com o extremo arrastado deslocado). Re-renderiza por frame via dragDelta,
  // mas fora da cena memoizada — só esta camada leve muda durante o arraste.
  const dragOverlayEl = useMemo(() => {
    if (!dragIds || !dragDelta) return null;
    const dd = dragDelta;
    const dragged = shapes.filter(s => dragIds.has(s.id));
    const effById = new Map(shapesById);
    for (const s of dragged) effById.set(s.id, { ...s, x: s.x + dd.dx, y: s.y + dd.dy });
    const edges = conns.filter(c => (dragIds.has(c.from) || dragIds.has(c.to)) && !hiddenPortIds.has(c.from) && !hiddenPortIds.has(c.to));
    return (
      <g style={{pointerEvents:"none"}}>
        {edges.map(c => renderConn(c, effById))}
        <g transform={`translate(${dd.dx},${dd.dy})`}>
          {dragged.map(s => s.type==="frame" ? renderFrame(s) : renderShape(s))}
        </g>
      </g>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragIds, dragDelta, shapes, conns, shapesById, hiddenPortIds, simResult, sel, multiSel, fromId, tool, flowErrors, csvStore, nodeArrivals, lensCounts, edgeColorScale, edgeQtyScale, enableDynThickness, showEdgeVol, showEdgeInadReal, showEdgeInadInf, activeCell, incrementalResult]);

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
              <div style={{width:1,height:22,background:"#e2e8f0",margin:"0 2px"}}/>
              <button onClick={()=>openSegmentDiscoveryModal({nodeId:sel})}
                title="Descobrir segmentos na população que efetivamente chega a este Cineminha"
                style={{padding:"5px 14px",borderRadius:7,border:"1px solid #c7d2fe",background:"#eef2ff",
                  color:"#4f46e5",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                  whiteSpace:"nowrap",fontWeight:600}}>
                🔍 Descobrir aqui
              </button>
              <button onClick={()=>toggleShapeLock(sel)}
                title={selShape.locked ? "Destravar (Goal Seek pode propor movimentos neste nó)" : "Travar (Goal Seek nunca propõe movimentos neste nó)"}
                style={{padding:"5px 10px",borderRadius:7,border:selShape.locked?"1px solid #fca5a5":"1px solid #e2e8f0",
                  background:selShape.locked?"#fef2f2":"#fff",color:selShape.locked?"#b91c1c":"#64748b",
                  cursor:"pointer",fontSize:13,fontFamily:"inherit",whiteSpace:"nowrap"}}>
                {selShape.locked ? "🔒" : "🔓"}
              </button>
            </div>
          );
        })()}

        {/* Johnny toolbar — shows when 2+ cineminhas are selected */}
        {multiSel.size>1&&[...multiSel].every(id=>shapesById.get(id)?.type==='cineminha')&&(
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
            <button onClick={()=>openSegmentDiscoveryModal({nodeId:sel})}
              title="Descobrir segmentos na população que efetivamente chega a este losango"
              style={{padding:"5px 14px",borderRadius:7,border:"1px solid #c7d2fe",background:"#eef2ff",
                color:"#4f46e5",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                whiteSpace:"nowrap",fontWeight:600}}>
              🔍 Descobrir aqui
            </button>
            <button onClick={()=>toggleShapeLock(sel)}
              title={selShape.locked ? "Destravar (Goal Seek pode propor movimentos neste nó)" : "Travar (Goal Seek nunca propõe movimentos neste nó)"}
              style={{padding:"5px 10px",borderRadius:7,border:selShape.locked?"1px solid #fca5a5":"1px solid #e2e8f0",
                background:selShape.locked?"#fef2f2":"#fff",color:selShape.locked?"#b91c1c":"#64748b",
                cursor:"pointer",fontSize:13,fontFamily:"inherit",whiteSpace:"nowrap"}}>
              {selShape.locked ? "🔒" : "🔓"}
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
            <button onClick={()=>openSegmentDiscoveryModal({nodeId:sel})}
              title="Descobrir segmentos na população que passa por este Decision Lens"
              style={{padding:"5px 14px",borderRadius:7,border:"1px solid #c7d2fe",background:"#eef2ff",
                color:"#4f46e5",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                whiteSpace:"nowrap",fontWeight:600}}>
              🔍 Descobrir aqui
            </button>
            <button onClick={()=>toggleShapeLock(sel)}
              title={selShape.locked ? "Destravar (Goal Seek pode propor movimentos neste nó)" : "Travar (Goal Seek nunca propõe movimentos neste nó)"}
              style={{padding:"5px 10px",borderRadius:7,border:selShape.locked?"1px solid #fca5a5":"1px solid #e2e8f0",
                background:selShape.locked?"#fef2f2":"#fff",color:selShape.locked?"#b91c1c":"#64748b",
                cursor:"pointer",fontSize:13,fontFamily:"inherit",whiteSpace:"nowrap"}}>
              {selShape.locked ? "🔒" : "🔓"}
            </button>
          </div>
        )}

        {/* Terminal toolbar (Aprovado/Reprovado/AS IS) — Descoberta de Segmentos escopada
            à população que efetivamente TERMINA neste nó (útil pra "por que este terminal
            tem inad alta?"). Terminais não têm trava (shape.locked é só de fluxo/decisão). */}
        {['approved','rejected','as_is'].includes(selShape?.type)&&multiSel.size<=1&&(
          <div style={{position:"absolute",top:70,left:"50%",transform:"translateX(-50%)",zIndex:300,
            display:"flex",gap:4,padding:"5px 8px",borderRadius:10,background:"rgba(255,255,255,.95)",
            border:"1px solid #e2e8f0",boxShadow:"0 2px 12px rgba(0,0,0,.08)"}}>
            <button onClick={()=>openSegmentDiscoveryModal({nodeId:sel})}
              title="Descobrir segmentos na população que termina neste nó"
              style={{padding:"5px 14px",borderRadius:7,border:"1px solid #c7d2fe",background:"#eef2ff",
                color:"#4f46e5",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                whiteSpace:"nowrap",fontWeight:600}}>
              🔍 Descobrir aqui
            </button>
          </div>
        )}

        {/* Porta solta toolbar (Copiloto Sessão 3) — sugestão de próximo nó só faz
            sentido numa porta sem NENHUMA conexão de saída (mesmo critério do lint
            port_dangling); portas já conectadas seguem sem toolbar contextual. */}
        {selShape?.type==='port'&&multiSel.size<=1&&conns.filter(c=>c.from===sel).length===0&&(
          <div style={{position:"absolute",top:70,left:"50%",transform:"translateX(-50%)",zIndex:300,
            display:"flex",gap:4,padding:"5px 8px",borderRadius:10,background:"rgba(255,255,255,.95)",
            border:"1px solid #ddd6fe",boxShadow:"0 2px 12px rgba(0,0,0,.08)"}}>
            <button onClick={()=>openVariableRanking(sel)}
              style={{padding:"5px 14px",borderRadius:7,border:"1px solid #ddd6fe",background:"#f5f3ff",
                color:"#6d28d9",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",
                whiteSpace:"nowrap",fontWeight:600}}>
              💡 Sugerir próximo passo
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
            {/* M12: cena memoizada (frames + conexões + shapes) — pan/zoom só mudam o transform
                deste <g>, sem re-renderizar a subárvore. */}
            {sceneEl}
            {/* Overlay de arraste (shapes movidos + arestas incidentes), fora da cena memoizada */}
            {dragOverlayEl}
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
          const from=shapesById.get(conn.from),to=shapesById.get(conn.to);
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
          <ComputeEngineBadge enabled={computeSidecar.enabled} status={computeSidecarStatus}
            checking={computeSidecarChecking} onRecheck={detectSidecar}/>
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
          {/* Execução Híbrida H6 (DEC-HX-009) — recomendação proativa ao abrir um
              projeto acima da zona de conforto. Nunca bloqueou o load (já aconteceu
              acima); isto é só o aviso + atalho pra ligar o motor. Dismissível. */}
          {projectLoadNotice && (
            <div style={{marginTop:8,padding:"9px 10px",borderRadius:8,fontSize:11.5,lineHeight:1.5,display:"flex",alignItems:"flex-start",gap:7,
              background:"#fdf4ff",border:"1px solid #f0abfc",color:"#86198f"}}>
              <span style={{fontSize:14}}>🐍</span>
              <span style={{flex:1}}>
                Este projeto tem ~{projectLoadNotice.totalRows.toLocaleString('pt-BR')} linhas
                (~{formatRamBytes(projectLoadNotice.totalBytes)} estimados) — acima da zona de
                conforto do navegador (~5MM linhas / ~1,2GB). O app segue funcionando normalmente
                no browser; para trabalhar sem tetos, {' '}
                <span onClick={()=>{ setSidecarPrefsOpen(true); setProjectLoadNotice(null); }}
                  style={{textDecoration:"underline",cursor:"pointer",fontWeight:600}}>
                  saiba como ligar o Motor Python
                </span>.
              </span>
              <span onClick={()=>setProjectLoadNotice(null)} style={{cursor:"pointer",opacity:.6,fontWeight:700}} title="Dispensar">×</span>
            </div>
          )}
        </div>

        {/* Motor Python (Execução Híbrida H4/H5/H6) — preferência opt-in. Desligado
            por padrão: com o toggle off o ComputeRouter nem tenta detectar e NADA muda
            no comportamento do app (DEC-HX-001). */}
        <div style={{padding:"14px 16px",borderBottom:"1px solid #f1f5f9"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer"}}
            onClick={()=>setSidecarPrefsOpen(v=>!v)}>
            <span style={{fontSize:11,color:"#94a3b8",fontWeight:500,textTransform:"uppercase",letterSpacing:.6,display:"flex",alignItems:"center",gap:6}}>
              🐍 Motor Python
              <ComputeEngineBadge enabled={computeSidecar.enabled} status={computeSidecarStatus}
                checking={computeSidecarChecking} onRecheck={(e)=>{e?.stopPropagation?.();detectSidecar();}}/>
            </span>
            <span style={{fontSize:11,color:"#94a3b8",transform:sidecarPrefsOpen?"rotate(180deg)":"none",transition:"transform .15s"}}>▾</span>
          </div>

          {sidecarPrefsOpen && (
            <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:10}}>
              <p style={{fontSize:11,color:"#64748b",lineHeight:1.55}}>
                Camada opcional de aceleração/ampliação de limites (clusterização, buscas mais
                profundas, bases maiores) rodando localmente (127.0.0.1). Desligado, o app funciona
                exatamente como hoje — nenhuma funcionalidade depende dele.
              </p>
              <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12.5,color:"#475569",fontWeight:500}}>
                <input type="checkbox" checked={computeSidecar.enabled}
                  onChange={e=>setComputeSidecar(s=>({...s,enabled:e.target.checked}))}
                  style={{width:15,height:15,accentColor:"#7c3aed"}}/>
                Ligar Motor Python
              </label>

              {IS_DEV_BUILD && (
                <>
                  <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                    URL do sidecar (modo dev)
                    <input type="text" value={computeSidecar.url}
                      onChange={e=>setComputeSidecar(s=>({...s,url:e.target.value}))}
                      placeholder="http://127.0.0.1:8090"
                      style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit",boxSizing:"border-box"}}/>
                  </label>
                  <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                    Token (impresso no console de <code>python sidecar.py --dev</code>)
                    <input type="text" value={computeSidecar.token}
                      onChange={e=>setComputeSidecar(s=>({...s,token:e.target.value}))}
                      placeholder="cole o token aqui"
                      style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"monospace",boxSizing:"border-box"}}/>
                  </label>
                </>
              )}
              {!IS_DEV_BUILD && (
                <p style={{fontSize:10.5,color:"#94a3b8",lineHeight:1.5,margin:0}}>
                  No release, o Motor Python roda na mesma origem do app (nenhuma URL/token a
                  configurar) — <code>iniciar.bat</code> já sobe os dois juntos. Sem os pacotes
                  instalados, o app segue 100% no navegador.
                </p>
              )}

              <button onClick={detectSidecar} disabled={!computeSidecar.enabled || computeSidecarChecking}
                style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e2e8f0",
                  background: computeSidecar.enabled ? "#faf5ff" : "#f8fafc",
                  color: computeSidecar.enabled ? "#7c3aed" : "#cbd5e1",
                  cursor: computeSidecar.enabled ? "pointer" : "default",
                  fontSize:12,fontWeight:600,fontFamily:"inherit"}}>
                {computeSidecarChecking ? "Verificando…" : "🔄 Verificar conexão"}
              </button>

              {computeSidecar.enabled && (
                <SidecarTestPanel
                  status={computeSidecarStatus}
                  test={sidecarTest}
                  onRun={runSidecarTest}
                  onCancel={cancelSidecarTest}
                  hasDataset={Object.keys(csvStore).length > 0}
                />
              )}

              <p style={{fontSize:10,color:"#94a3b8",lineHeight:1.5,margin:0}}>
                Instalação (opcional): <code>release/python/instalar_motor.bat</code>. Sem pacotes
                científicos instalados, o Motor Python roda em tier <b>stdlib</b> (só paralelismo);
                com numpy/scipy, tier <b>full</b> (vetorizado).
              </p>
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
            <button onClick={()=>openPolicyLibrary('browse')}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"9px 14px",borderRadius:10,border:"1.5px solid #c7d2fe",background:"#eef2ff",color:"#4f46e5",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit",transition:"all .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.background="#e0e7ff";e.currentTarget.style.borderColor="#818cf8";}}
              onMouseLeave={e=>{e.currentTarget.style.background="#eef2ff";e.currentTarget.style.borderColor="#c7d2fe";}}>
              <span style={{fontSize:16}}>📚</span> Políticas{policyLibrary.length>0?` (${policyLibrary.length})`:''}
            </button>
            <button onClick={openGoalSeekModal}
              title="Declarar um objetivo (ex.: +2pp de aprovação) e deixar o motor buscar os movimentos que atingem"
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"9px 14px",borderRadius:10,border:"1.5px solid #fde68a",background:"#fffbeb",color:"#92400e",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit",transition:"all .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.background="#fef3c7";e.currentTarget.style.borderColor="#f59e0b";}}
              onMouseLeave={e=>{e.currentTarget.style.background="#fffbeb";e.currentTarget.style.borderColor="#fde68a";}}>
              <span style={{fontSize:16}}>🎯</span> Atingir Objetivo
            </button>
            <button onClick={openSimplifyModal}
              title="Detectar nós colapsáveis, chegada zero, regras de lens sem efeito e variáveis re-testadas — propõe a política reduzida com prova de equivalência"
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"9px 14px",borderRadius:10,border:"1.5px solid #bbf7d0",background:"#f0fdf4",color:"#15803d",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit",transition:"all .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.background="#dcfce7";e.currentTarget.style.borderColor="#86efac";}}
              onMouseLeave={e=>{e.currentTarget.style.background="#f0fdf4";e.currentTarget.style.borderColor="#bbf7d0";}}>
              <span style={{fontSize:16}}>🧹</span> Simplificar
            </button>
            <button onClick={openDocModal}
              title="Gerar documento executivo/técnico da política atual — KPIs, fluxo, regras achatadas, funil, cenários e glossário, com os números da simulação"
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"9px 14px",borderRadius:10,border:"1.5px solid #bfdbfe",background:"#eff6ff",color:"#1d4ed8",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit",transition:"all .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.background="#dbeafe";e.currentTarget.style.borderColor="#93c5fd";}}
              onMouseLeave={e=>{e.currentTarget.style.background="#eff6ff";e.currentTarget.style.borderColor="#bfdbfe";}}>
              <span style={{fontSize:16}}>📄</span> Documentar Política
            </button>
            <button onClick={()=>openSegmentDiscoveryModal(null)}
              title="Varrer a base (subgroup discovery) procurando segmentos onde a política atual está desalinhada — aprovação deixada na mesa, risco vazando ou blocos heterogêneos"
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"9px 14px",borderRadius:10,border:"1.5px solid #c7d2fe",background:"#eef2ff",color:"#4f46e5",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit",transition:"all .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.background="#e0e7ff";e.currentTarget.style.borderColor="#a5b4fc";}}
              onMouseLeave={e=>{e.currentTarget.style.background="#eef2ff";e.currentTarget.style.borderColor="#c7d2fe";}}>
              <span style={{fontSize:16}}>🔍</span> Descobrir Segmentos
            </button>
            <button onClick={openClusterModal}
              title="Agrupar segmentos parecidos por comportamento (aprovação AS IS, inadimplência) via k-means determinístico — sempre disponível; o Motor Python remove os tetos e libera k automático/hierárquico"
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"9px 14px",borderRadius:10,border:"1.5px solid #ddd6fe",background:"#f5f3ff",color:"#6d28d9",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit",transition:"all .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.background="#ede9fe";e.currentTarget.style.borderColor="#c4b5fd";}}
              onMouseLeave={e=>{e.currentTarget.style.background="#f5f3ff";e.currentTarget.style.borderColor="#ddd6fe";}}>
              <span style={{fontSize:16}}>🧩</span> Clusterizar Segmentos
            </button>
            <input ref={flowImportRef} type="file" accept=".json,application/json" style={{display:"none"}} onChange={onFlowFileChange}/>
            <input ref={cinemaImportRef} type="file" accept=".json,application/json" style={{display:"none"}} onChange={onCinemaFileChange}/>
            <input ref={libFileInputRef} type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={onLibFileChange}/>
            <input ref={policyLibFileInputRef} type="file" accept=".json,application/json" style={{display:"none"}} onChange={onPolicyLibFileChange}/>
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
              return filtered.length>0 ? filtered.map(({col,csvId})=>{
                const isClu = isClusterVar(csvStore, csvId, col);
                // Chip de cluster: tom roxo + 🧩 + ✏️ (editar regras/renomear); chip normal: âmbar.
                const base = isClu
                  ? {border:"#ddd6fe",bg:"#f5f3ff",hoverBg:"#ede9fe",hoverBorder:"#c4b5fd",color:"#6d28d9",icon:"🧩"}
                  : {border:"#fde68a",bg:"#fef9c3",hoverBg:"#fef3c7",hoverBorder:"#f59e0b",color:"#92400e",icon:"◇"};
                return (
                <div key={`${csvId}-${col}`}
                  onMouseDown={(e)=>startPanelDrag(e,col,csvId)}
                  onTouchStart={(e)=>startPanelDrag(e,col,csvId)}
                  style={{display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:8,
                    border:`1.5px solid ${base.border}`,background:base.bg,marginBottom:4,
                    cursor:"grab",userSelect:"none",fontSize:12,fontWeight:500,color:base.color,transition:"all .12s",
                    touchAction:"none"}}
                  onMouseEnter={e=>{e.currentTarget.style.background=base.hoverBg;e.currentTarget.style.borderColor=base.hoverBorder;}}
                  onMouseLeave={e=>{e.currentTarget.style.background=base.bg;e.currentTarget.style.borderColor=base.border;}}>
                  <span>{base.icon}</span>
                  <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{col}</span>
                  {isClu && (
                    <button
                      title="Editar variável de cluster (renomear, mover públicos entre clusters)"
                      onMouseDown={(e)=>{e.stopPropagation();}}
                      onTouchStart={(e)=>{e.stopPropagation();}}
                      onClick={(e)=>{e.stopPropagation();openClusterVarEdit(csvId,col);}}
                      style={{width:20,height:20,borderRadius:6,border:"1px solid #ddd6fe",background:"#fff",color:"#7c3aed",
                        cursor:"pointer",fontSize:11,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,padding:0,lineHeight:1}}>
                      ✏️
                    </button>
                  )}
                  <span style={{fontSize:14,opacity:.5}}>⠿</span>
                </div>
                );
              }) : (
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

        {/* Copiloto — lint estrutural (Sessão 1, DEC-IA-006): achados por severidade,
            "ir até o nó" e quick-fixes não-destrutivos. Efêmero (não persiste). */}
        {shapes.length > 0 && (
          <div style={{padding:"12px 16px",borderBottom:"1px solid #f1f5f9"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <p style={{fontSize:11,color:"#94a3b8",fontWeight:500,textTransform:"uppercase",letterSpacing:.6,margin:0}}>🧭 Copiloto</p>
              {copilotFindings.length>0 && (
                <span style={{fontSize:10.5,fontWeight:700,color:"#64748b",background:"#f1f5f9",borderRadius:20,padding:"2px 8px"}}>
                  {copilotFindings.length}
                </span>
              )}
            </div>
            {copilotFindings.length === 0 ? (
              <div style={{padding:"9px 10px",borderRadius:8,background:"#f0fdf4",border:"1px solid #bbf7d0",fontSize:11.5,color:"#15803d",lineHeight:1.5,display:"flex",gap:6,alignItems:"center"}}>
                <span>✅</span><span>Nenhum achado estrutural — fluxo consistente.</span>
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:300,overflowY:"auto"}}>
                {copilotFindings.map((f,i) => {
                  const meta = COPILOT_SEV_META[f.severity] || COPILOT_SEV_META.info;
                  return (
                    <div key={`${f.code}-${f.nodeId}-${i}`} style={{padding:"8px 10px",borderRadius:8,background:meta.bg,border:`1px solid ${meta.border}`,fontSize:11.5,color:meta.color,lineHeight:1.45}}>
                      <div style={{display:"flex",gap:6,alignItems:"flex-start"}}>
                        <span style={{flexShrink:0}}>{meta.emoji}</span>
                        <span style={{flex:1}}>{f.msg}</span>
                      </div>
                      <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
                        <button onClick={()=>goToCopilotNode(f.nodeId)}
                          title="Selecionar e centralizar este nó no canvas"
                          style={{padding:"3px 9px",borderRadius:6,border:`1px solid ${meta.border}`,background:"#fff",color:meta.color,cursor:"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit"}}>
                          🎯 Ir até o nó
                        </button>
                        {f.fix?.kind === 'connect_terminal' && (<>
                          <button onClick={()=>applyCopilotConnectTerminal(f.fix.nodeId,'rejected')}
                            title="Conectar esta saída a um novo terminal Reprovado"
                            style={{padding:"3px 9px",borderRadius:6,border:"1px solid #fecaca",background:"#fff1f2",color:"#b91c1c",cursor:"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit"}}>
                            ❌ Reprovado
                          </button>
                          <button onClick={()=>applyCopilotConnectTerminal(f.fix.nodeId,'approved')}
                            title="Conectar esta saída a um novo terminal Aprovado"
                            style={{padding:"3px 9px",borderRadius:6,border:"1px solid #bbf7d0",background:"#f0fdf4",color:"#15803d",cursor:"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit"}}>
                            ✅ Aprovado
                          </button>
                        </>)}
                        {f.fix?.kind === 'open_domain_modal' && (
                          <button onClick={()=>openDomainModal(f.fix.nodeId)}
                            title="Abrir 'Configurar nó' para revisar/ocultar este valor"
                            style={{padding:"3px 9px",borderRadius:6,border:"1px solid #c7d2fe",background:"#eef2ff",color:"#4338ca",cursor:"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit"}}>
                            ⚙ Configurar nó
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Achado informativo 🔵 apontando pra Descoberta de Segmentos (Sessão 10/11) —
                não duplica a lista (estatística, não estrutural): o painel só aponta, o
                modal detalha. Sempre visível quando há fluxo — a varredura é on-demand. */}
            <div style={{marginTop:6,padding:"8px 10px",borderRadius:8,background:COPILOT_SEV_META.info.bg,border:`1px solid ${COPILOT_SEV_META.info.border}`,fontSize:11.5,color:COPILOT_SEV_META.info.color,lineHeight:1.45}}>
              <div style={{display:"flex",gap:6,alignItems:"flex-start"}}>
                <span style={{flexShrink:0}}>{COPILOT_SEV_META.info.emoji}</span>
                <span style={{flex:1}}>Descoberta de Segmentos disponível — varra a base procurando aprovação deixada na mesa, risco vazando ou blocos heterogêneos que a política atual não trata.</span>
              </div>
              <div style={{marginTop:6}}>
                <button onClick={()=>openSegmentDiscoveryModal(null)}
                  title="Abrir a Descoberta de Segmentos"
                  style={{padding:"3px 9px",borderRadius:6,border:`1px solid ${COPILOT_SEV_META.info.border}`,background:"#fff",color:COPILOT_SEV_META.info.color,cursor:"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit"}}>
                  🔍 Abrir Descoberta
                </button>
              </div>
            </div>
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

      {/* ═══════════════ VARIABLE RANKING MODAL — "Sugerir próximo passo" (Copiloto Sessão 3) ═══ */}
      {variableRankingModal&&(()=>{
        const m = variableRankingModal;
        const port = shapes.find(s => s.id === m.portId);
        const TERMINAL_LABEL = { approved: '✅ Aprovado', rejected: '❌ Reprovado', as_is: '⟳ AS IS' };
        return (
          <div onMouseDown={()=>setVariableRankingModal(null)}
            style={{position:"fixed",inset:0,zIndex:4000,background:"rgba(15,23,42,.45)",
              display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',system-ui,sans-serif"}}>
            <div onMouseDown={e=>e.stopPropagation()}
              style={{width:520,maxHeight:"84vh",display:"flex",flexDirection:"column",
                background:"#fff",borderRadius:14,boxShadow:"0 20px 60px rgba(0,0,0,.25)",overflow:"hidden"}}>
              {/* Header */}
              <div style={{padding:"16px 20px",borderBottom:"1px solid #e2e8f0"}}>
                <div style={{fontSize:15,fontWeight:700,color:"#1e293b"}}>💡 Sugerir próximo passo</div>
                <div style={{fontSize:11.5,color:"#94a3b8",marginTop:2}}>
                  Porta "{trunc(port?.label||'?',30)}" — ranking de variáveis pelo poder discriminante sobre a população que chega aqui
                </div>
              </div>

              {/* Body */}
              <div style={{padding:"14px 20px 6px",overflow:"auto",flex:1}}>
                {m.loading&&(
                  <div style={{padding:"32px 0",textAlign:"center",color:"#94a3b8",fontSize:12.5}}>Calculando ranking…</div>
                )}
                {!m.loading&&m.error==='no_population'&&(
                  <div style={{padding:"24px 0",textAlign:"center",color:"#94a3b8",fontSize:12.5}}>
                    Nenhuma linha da base chega a esta porta com o fluxo atual — verifique o roteamento a montante.
                  </div>
                )}
                {!m.loading&&m.error==='anchor_not_found'&&(
                  <div style={{padding:"24px 0",textAlign:"center",color:"#94a3b8",fontSize:12.5}}>
                    Porta não encontrada no canvas atual.
                  </div>
                )}
                {!m.loading&&!m.error&&(<>
                  {/* Autocompletar terminal — risco do segmento */}
                  <div style={{marginBottom:16,padding:"10px 12px",borderRadius:10,
                    background:"#f8fafc",border:"1px solid #e2e8f0"}}>
                    <div style={{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:.4,marginBottom:6}}>
                      ⟳ Autocompletar terminal · {fmtQty(m.population.qty)} propostas neste segmento
                    </div>
                    <div style={{fontSize:12,color:"#475569",lineHeight:1.5,marginBottom:8}}>{m.population.justification}</div>
                    <div style={{display:"flex",gap:6}}>
                      {['approved','rejected','as_is'].map(t=>(
                        <button key={t} onClick={()=>applyCopilotConnectTerminal(m.portId, t)}
                          style={{flex:1,padding:"6px 8px",borderRadius:7,fontFamily:"inherit",fontSize:11.5,cursor:"pointer",
                            fontWeight: m.population.suggestedTerminal===t ? 700 : 500,
                            border: m.population.suggestedTerminal===t ? "1.5px solid #6d28d9" : "1px solid #e2e8f0",
                            background: m.population.suggestedTerminal===t ? "#f5f3ff" : "#fff",
                            color: m.population.suggestedTerminal===t ? "#6d28d9" : "#64748b"}}>
                          {TERMINAL_LABEL[t]}{m.population.suggestedTerminal===t?' ★':''}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Interações — sugestão de Cineminha */}
                  {m.interactions&&m.interactions.filter(i=>i.suggestCinema).length>0&&(
                    <div style={{marginBottom:16}}>
                      <div style={{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:.4,marginBottom:6}}>
                        ⊞ Interação detectada
                      </div>
                      {m.interactions.filter(i=>i.suggestCinema).map((it,i)=>(
                        <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,
                          border:"1px solid #c7d2fe",background:"#eef2ff",marginBottom:6}}>
                          <div style={{flex:1,fontSize:12,color:"#3730a3",lineHeight:1.4}}>
                            <b>{it.colA} × {it.colB}</b><br/>
                            <span style={{color:"#4f46e5"}}>{it.justification}</span>
                          </div>
                          <button onClick={()=>applyRankingCreateCinema(m.portId, it.colA, it.colB, m.csvId)}
                            style={{padding:"6px 12px",borderRadius:7,border:"1px solid #4f46e5",background:"#4f46e5",
                              color:"#fff",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",fontWeight:700,whiteSpace:"nowrap"}}>
                            ⊞ Criar Cineminha
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Ranking de variáveis candidatas */}
                  <div style={{fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:.4,marginBottom:6}}>
                    📊 Ranking de variáveis {m.metric&&`(métrica ${m.metric==='inferida'?'inferida':'real'})`}
                  </div>
                  {m.ranking.length===0&&(
                    <div style={{padding:"16px 0",textAlign:"center",color:"#94a3b8",fontSize:12.5}}>
                      Sem variáveis candidatas — todas já foram testadas neste caminho.
                    </div>
                  )}
                  {m.ranking.map((r,i)=>(
                    <div key={r.col} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,
                      border:"1px solid #e2e8f0",marginBottom:6,background:i===0?"#fefce8":"#fff"}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12.5,fontWeight:700,color:"#1e293b"}}>
                          {i===0?'🏆 ':''}{r.col}
                        </div>
                        <div style={{fontSize:11.5,color:"#64748b",lineHeight:1.4,marginTop:1}}>{r.justification}</div>
                      </div>
                      <button onClick={()=>applyRankingCreateDecision(m.portId, r.col, r.csvId)}
                        style={{padding:"6px 12px",borderRadius:7,border:"1px solid #f59e0b",background:"#fffbeb",
                          color:"#92400e",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",fontWeight:700,whiteSpace:"nowrap"}}>
                        ◇ Criar losango
                      </button>
                    </div>
                  ))}
                </>)}
              </div>

              {/* Footer */}
              <div style={{padding:"12px 20px",borderTop:"1px solid #e2e8f0",display:"flex",justifyContent:"flex-end"}}>
                <button onClick={()=>setVariableRankingModal(null)}
                  style={{padding:"7px 16px",borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                    color:"#64748b",cursor:"pointer",fontSize:12.5,fontFamily:"inherit",fontWeight:600}}>
                  Fechar
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

      {/* ═══════════════ POLICY APPLY MODAL — mapeamento de variáveis (Copiloto Sessão 2) ═══════════════ */}
      {policyApplyModal&&(()=>{
        const { name, requiredVars, mapping } = policyApplyModal;
        const { decision, any } = buildPolicyVarCandidates(csvStore);
        const pendingCount = requiredVars.filter(rv => !mapping[rv.col]).length;
        const selectStyle = {
          width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #e2e8f0",
          fontSize:12.5,fontFamily:"inherit",color:"#1e293b",background:"#fff",cursor:"pointer",outline:"none",
        };
        const setMap = (col, val) => setPolicyApplyModal(prev => prev ? { ...prev, mapping: { ...prev.mapping, [col]: val } } : prev);
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.45)",backdropFilter:"blur(4px)",zIndex:3500,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:18,width:"100%",maxWidth:560,maxHeight:"85vh",boxShadow:"0 24px 80px rgba(0,0,0,.2)",padding:"28px 32px",display:"flex",flexDirection:"column",gap:18,overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
                <div>
                  <h2 style={{fontSize:17,fontWeight:700,color:"#1e293b",marginBottom:4}}>Aplicar Política</h2>
                  <p style={{fontSize:12.5,color:"#64748b"}}>Mapeie as variáveis de "{name}" para o dataset atual.</p>
                </div>
                <button onClick={()=>setPolicyApplyModal(null)}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#f8fafc",cursor:"pointer",fontSize:16,color:"#64748b",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>✕</button>
              </div>

              {pendingCount>0 && (
                <div style={{padding:"10px 14px",borderRadius:10,background:"#fffbeb",border:"1px solid #fde68a",fontSize:12,color:"#92400e",lineHeight:1.5,flexShrink:0}}>
                  ⚠ {pendingCount} variável{pendingCount!==1?'is':''} sem mapeamento — os nós correspondentes serão aplicados sem variável definida (ficam como pendência visível, sem tráfego, até você configurá-los).
                </div>
              )}

              {requiredVars.length===0 ? (
                <div style={{fontSize:12.5,color:"#64748b",fontStyle:"italic"}}>Esta política não referencia nenhuma variável — pode ser aplicada diretamente.</div>
              ) : (
                <div style={{display:"flex",flexDirection:"column",gap:12,overflowY:"auto",paddingRight:4}}>
                  {requiredVars.map(rv => {
                    const pool = rv.kind === 'decision' ? decision : any;
                    const cur = mapping[rv.col];
                    const isPending = !cur;
                    return (
                      <div key={rv.col}>
                        <div style={{fontSize:12,fontWeight:600,color:"#374151",marginBottom:4,display:"flex",alignItems:"center",gap:6}}>
                          <code style={{background:"#f1f5f9",padding:"1px 5px",borderRadius:4,fontWeight:500}}>{rv.col}</code>
                          <span style={{fontSize:10,fontWeight:500,color:"#94a3b8"}}>{rv.kind==='decision'?'variável de decisão':'coluna de regra (Lens)'}</span>
                          {isPending && (
                            <span style={{fontSize:10,fontWeight:700,color:"#b45309",background:"#fef3c7",border:"1px solid #fde68a",borderRadius:99,padding:"1px 8px"}}>
                              ⚠ pendente
                            </span>
                          )}
                        </div>
                        {pool.length>0 ? (
                          <select value={cur ? `${cur.csvId}::${cur.col}` : ""}
                            onChange={e => {
                              const v = e.target.value;
                              setMap(rv.col, v ? pool.find(x=>`${x.csvId}::${x.col}`===v) || null : null);
                            }}
                            style={selectStyle}>
                            <option value="">— Não mapear —</option>
                            {pool.map(v=>(
                              <option key={`${v.csvId}::${v.col}`} value={`${v.csvId}::${v.col}`}>{v.col} ({v.csvName})</option>
                            ))}
                          </select>
                        ) : (
                          <div style={{fontSize:12,color:"#94a3b8",fontStyle:"italic"}}>
                            Nenhuma coluna {rv.kind==='decision'?'de decisão ':''}disponível no dataset atual.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{display:"flex",justifyContent:"flex-end",gap:8,flexShrink:0}}>
                <button onClick={()=>setPolicyApplyModal(null)}
                  style={{padding:"8px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#64748b",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
                  Cancelar
                </button>
                <button onClick={applyPolicyTemplate}
                  style={{padding:"9px 22px",borderRadius:9,border:"none",background:"#4f46e5",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>
                  {pendingCount>0 ? `Aplicar mesmo assim (${pendingCount} pendente${pendingCount!==1?'s':''})` : 'Aplicar'}
                </button>
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

              {/* Option 3: JSON canônico da política (PolicyIR — Copiloto Sessão 0, DEC-IA-002) */}
              <button onClick={doExportPolicyIR}
                style={{display:"flex",alignItems:"flex-start",gap:14,padding:"16px 18px",borderRadius:12,border:"1.5px solid #ddd6fe",background:"#faf5ff",cursor:"pointer",textAlign:"left",fontFamily:"inherit",transition:"all .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="#a78bfa";e.currentTarget.style.background="#f3e8ff";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="#ddd6fe";e.currentTarget.style.background="#faf5ff";}}>
                <div style={{width:38,height:38,borderRadius:10,background:"#f3e8ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🧩</div>
                <div>
                  <div style={{fontSize:13.5,fontWeight:700,color:"#7c3aed",marginBottom:3}}>JSON Canônico da Política</div>
                  <div style={{fontSize:12,color:"#6b7280",lineHeight:1.5}}>Representação canônica (PolicyIR) para integrações e copiloto: nós, regras e rotas — sem posicionamento visual e sem nenhum dado do CSV.</div>
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
                // Cobertura total dos distintos vem do dicionário da coluna — em
                // edição, do csvStore; em import novo, das colunas dict que o parse
                // colunar deixou no wizard (M1; previewRows é só amostra de UI).
                const editingColCsv = wizard.editCsvId ? csvStore[wizard.editCsvId] : null;
                const distinctVals = asIsColIdx < 0 ? []
                  : editingColCsv
                    ? [...new Set(distinctColValues(editingColCsv, editingColCsv.headers.indexOf(wizard.asIsVar)).map(v => String(v ?? '')).filter(v=>v!==''))].sort()
                    : ((wizard.parsedColumns?.[wizard.asIsVar]?.dict) || []).filter(v => v !== '' && v != null).sort();
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

                // ── Estimativa de RAM colunar (Execução Híbrida H2 / DEC-HX-009) ──
                // linhas × Σ(bytes por coluna): métricas = 8 (Float64), dimensões = o
                // menor dtype de códigos pela cardinalidade (Uint8/Uint16/Int32 —
                // codesCtorForDict). Acima de ~1,2GB o browser sai da zona de conforto.
                const nRows = wizard.editCsvId ? (csvStore[wizard.editCsvId]?.rowCount || 0) : (wizard.parsedRowCount || 0);
                const cardOf = (h) => {
                  if (wizard.editCsvId) { const c = csvStore[wizard.editCsvId]?.columns?.[h]; return c && c.kind === 'dict' ? c.dict.length : null; }
                  const c = wizard.parsedColumns?.[h]; return c && c.dict ? c.dict.length : null;
                };
                let ramBytesPerRow = 0;
                for (const h of allHeaders) {
                  if (METRIC_TYPES_SET.has((wizard.columnTypes||{})[h])) ramBytesPerRow += 8; // Float64
                  else { const card = cardOf(h); ramBytesPerRow += card != null ? codesCtorForDict(card).BYTES_PER_ELEMENT : 4; }
                }
                if (wizard.asIsVar) ramBytesPerRow += 1; // __DECISAO_ORIGINAL (dict minúsculo → Uint8)
                const ramEstBytes = nRows * ramBytesPerRow;
                // Limiares compartilhados com loadProject (RAM_COMFORT_BYTES/ROW_COMFORT_COUNT,
                // src/columnar.js) — "mesma conta" exigida pelo DEC-HX-009 nos dois pontos de
                // carregamento (wizard e abertura de projeto).
                const ramOver = ramEstBytes > RAM_COMFORT_BYTES || nRows > ROW_COMFORT_COUNT;

                return (
                  <>
                    {/* ── Estimativa de RAM colunar (H2/H6 / DEC-HX-009) ── */}
                    {nRows > 0 && (
                      <div style={{marginBottom:18,padding:"10px 14px",borderRadius:10,border:`1px solid ${ramOver?"#fca5a5":"#e2e8f0"}`,background:ramOver?"#fef2f2":"#f8fafc",display:"flex",alignItems:"flex-start",gap:10}}>
                        <span style={{fontSize:16,lineHeight:1.2}}>{ramOver?"⚠️":"💾"}</span>
                        <div style={{flex:1}}>
                          <div style={{fontSize:12,fontWeight:600,color:ramOver?"#b91c1c":"#334155",lineHeight:1.4}}>
                            Memória colunar estimada: ~{formatRamBytes(ramEstBytes)}
                            <span style={{fontWeight:400,color:"#94a3b8"}}> · {nRows.toLocaleString('pt-BR')} linhas × {allHeaders.length} colunas</span>
                          </div>
                          {ramOver && (
                            <>
                              <div style={{fontSize:11,color:"#b91c1c",lineHeight:1.5,marginTop:3,marginBottom:8}}>
                                Acima da zona de conforto do navegador (~5MM linhas / ~1,2&nbsp;GB). A base pode
                                abrir com lentidão ou esgotar a memória da aba. Considere sumarizar mais a base ou
                                reduzir colunas. O import não é bloqueado.
                              </div>
                              <ComputeCeilingNotice
                                ceilingText="Motor Python ausente — ligá-lo prepara o estudo para trabalhar sem tetos declarados assim que as tarefas passarem a suportar bases grandes."
                                unlockedText={`Motor Python detectado (tier ${computeSidecarStatus.tier || '—'}) — este estudo já pode usá-lo conforme as tarefas passarem a suportar bases grandes.`}
                                status={computeSidecarStatus}
                                onOpenPrefs={()=>setSidecarPrefsOpen(true)}
                              />
                              {!computeSidecarStatus.available && (
                                <button onClick={()=>setComputeSidecar(s=>({...s,enabled:true}))}
                                  style={{marginTop:7,padding:"6px 12px",borderRadius:8,border:"none",background:"#7c3aed",color:"#fff",cursor:"pointer",fontSize:11.5,fontWeight:600,fontFamily:"inherit"}}>
                                  🐍 Ligar Motor Python
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}

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
                    const {headers} = wizardPreview;
                    // Auto-suggest varTypes and metric columns — amostra as 1000
                    // primeiras linhas via dicionário (M1: mesma janela que o
                    // caminho legado amostrava do string[][]).
                    const varSuggestions = {};
                    const sampleN = Math.min(1000, wizard.parsedRowCount || 0);
                    for (const h of headers) {
                      const col = wizard.parsedColumns?.[h];
                      const vals = [];
                      if (col?.kind === 'dict') {
                        for (let r = 0; r < sampleN; r++) {
                          const v = col.dict[col.codes[r]];
                          if (v) vals.push(v);
                        }
                      }
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
        // Resgata a configuração baseada na decisão histórica (AS IS) para todos
        // os cineminhas: caselas com aprovações ficam elegíveis (baseline); só as
        // 100% reprovadas ficam não elegíveis. Sobrescreve o estado proposto.
        const asIsAvailable = shapeMetas.some(meta => {
          const csv = csvStoreR.current[meta.rowVar?.csvId || meta.colVar?.csvId];
          return !!(csv && csv.headers.includes('__DECISAO_ORIGINAL'));
        });
        const restoreAsIs = () => {
          const store = csvStoreR.current;
          const newPBS = { ...proposedByShape };
          for (const meta of shapeMetas) {
            const cells = computeAsIsCells(meta, store);
            if (cells) newPBS[meta.id] = cells;
          }
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
                                  if(cur)workerRef.current?.postMessage({type:'COMPUTE_JOHNNY',shapes:shapesR.current,cinemaIds:cur.shapeMetas.map(m=>m.id),conns:connsR.current,riskLevels:cur.riskLevels,hierarchyMode:cur.hierarchyMode,inadMetric:cur.inadMetric});
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
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <button onClick={()=>setJohnnyModal(null)}
                    style={{padding:"8px 18px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",
                      color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
                    Cancelar
                  </button>
                  <button onClick={restoreAsIs} disabled={!asIsAvailable}
                    title={asIsAvailable
                      ? "Preencher com a decisão histórica (AS IS): caselas com aprovações ficam elegíveis; só as 100% reprovadas ficam não elegíveis"
                      : "Nenhum dataset com decisão AS IS configurada"}
                    style={{padding:"8px 16px",borderRadius:9,border:"1px solid #cbd5e1",
                      background: asIsAvailable ? "#fff" : "#f8fafc",
                      color: asIsAvailable ? "#475569" : "#cbd5e1",
                      cursor: asIsAvailable ? "pointer" : "not-allowed",
                      fontSize:12.5,fontWeight:600,fontFamily:"inherit"}}>
                    ↺ Resgatar AS IS
                  </button>
                </div>
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

      {/* ═══════════════ GOAL SEEK MODAL — objetivo estruturado (Copiloto Sessão 4) ═══════════════ */}
      {goalSeekModal&&(()=>{
        const { step, goal, constraints, context, baseline, frontier, moves, goalReached, bindingConstraint,
                result, via, curves, deepRun, fallbackNotice } = goalSeekModal;
        const updGoal = (patch) => setGoalSeekModal(m => {
          const goal = { ...m.goal, ...patch };
          // GS2 (DEC-GS-003): trocar o alvo pode fazer o minimize atual colidir — reseta.
          if ('target' in patch) goal.minimize = goalSeekResolveMinimize(goal.target, goal.minimize);
          return { ...m, goal };
        });
        const updCons = (patch) => setGoalSeekModal(m => ({ ...m, constraints: { ...m.constraints, ...patch } }));
        const targetMeta = GOAL_SEEK_TARGET_META[goal?.target] || GOAL_SEEK_TARGET_META.approvalRate;
        const BINDING_LABEL = {
          maxInadReal: 'Teto de Inad. Real atingido',
          maxInadInf: 'Teto de Inad. Inferida atingido',
          no_more_moves: 'Catálogo de movimentos esgotado',
        };
        const lockedCount = shapes.filter(s => s.locked).length;
        // GS6 (DEC-GS-010) — modo profundo automático quando o sidecar está pareado E
        // declara `goal_seek_deep` em capabilities (tier full + scipy com `milp`).
        const sidecarTasks = computeSidecarStatus?.capabilities?.tasks;
        const deepOk = computeSidecar.enabled && !!computeSidecarStatus?.available &&
          Array.isArray(sidecarTasks) && sidecarTasks.includes('goal_seek_deep');

        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",backdropFilter:"blur(4px)",
            zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:760,maxHeight:"92vh",
              boxShadow:"0 32px 100px rgba(0,0,0,.28)",display:"flex",flexDirection:"column",overflow:"hidden"}}>

              {/* Header */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"14px 24px",borderBottom:"1px solid #e2e8f0",flexShrink:0,
                background:"linear-gradient(135deg,#fffbeb 0%,#fef3c7 100%)"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:38,height:38,borderRadius:10,background:"#fde68a",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🎯</div>
                  <div>
                    <h2 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:1}}>Atingir Objetivo</h2>
                    <p style={{fontSize:11,color:"#92400e"}}>Goal Seek da política inteira · {lockedCount>0?`${lockedCount} nó(s) travado(s) 🔒`:"sem nós travados"}</p>
                  </div>
                </div>
                <button onClick={()=>{ goalSeekAbortRef.current?.abort(); setGoalSeekModal(null); }}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                    cursor:"pointer",fontSize:15,color:"#64748b",display:"flex",alignItems:"center",
                    justifyContent:"center",fontFamily:"inherit"}}>✕</button>
              </div>

              <div style={{padding:"18px 24px",overflowY:"auto",flex:1}}>
                {step==='form' && (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    {/* 📍 Ponto de partida (GS1, DEC-GS-002) — política atual no canvas vs. AS
                        IS, ambos escopados à população decidida (decidedQty), não à base inteira. */}
                    <div style={{border:"1px solid #e2e8f0",borderRadius:12,padding:"12px 14px",background:"#f8fafc"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
                        <span style={{fontSize:11,color:"#475569",fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>
                          📍 Ponto de partida
                        </span>
                        <span style={{fontSize:10.5,color:"#94a3b8",fontWeight:500}}>(população decidida pela política)</span>
                        <span
                          title="Medido sobre a população que a política decide (chega a um terminal), não sobre a base inteira — por isso pode diferir do painel de simulação."
                          style={{fontSize:10,color:"#94a3b8",cursor:"help",border:"1px solid #cbd5e1",borderRadius:"50%",
                            width:14,height:14,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,lineHeight:1}}>
                          ⓘ
                        </span>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                        {GOAL_SEEK_CONTEXT_CARDS.map(({k,label})=>{
                          const meta = GOAL_SEEK_TARGET_META[k];
                          const curVal = context?.baseline?.[k] ?? null;
                          const asVal  = context?.asis?.[k] ?? null;
                          let deltaLine;
                          if (!context) {
                            deltaLine = <div style={{height:11,width:"72%",borderRadius:4,background:"#e2e8f0"}} />;
                          } else if (!context.asis) {
                            deltaLine = <div style={{fontSize:10.5,color:"#94a3b8"}}>AS IS não configurado</div>;
                          } else {
                            const deltaRaw = curVal - asVal;
                            const deltaPp = k === 'approvalRate' ? deltaRaw : deltaRaw * 100;
                            const good = GOOD_WHEN_LOWER.has(k) ? deltaPp < 0 : deltaPp > 0;
                            const color = Math.abs(deltaPp) < 0.005 ? "#94a3b8" : (good ? "#16a34a" : "#dc2626");
                            deltaLine = (
                              <div style={{fontSize:10.5,color:"#94a3b8"}}>
                                AS IS {meta.fmt(asVal)} · <span style={{color,fontWeight:600}}>Δ{deltaPp>=0?'+':''}{deltaPp.toFixed(2)}pp</span>
                              </div>
                            );
                          }
                          return (
                            <div key={k} style={{padding:"9px 10px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff"}}>
                              <div style={{fontSize:10,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",marginBottom:3}}>{label}</div>
                              {context
                                ? <div style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:2}}>{meta.fmt(curVal)}</div>
                                : <div style={{height:16,width:"55%",borderRadius:4,background:"#e2e8f0",marginBottom:5}} />}
                              {deltaLine}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <p style={{fontSize:12,color:"#64748b",lineHeight:1.6}}>
                      Declare o objetivo e as restrições. O motor busca uma sequência de movimentos
                      concretos (abrir/fechar célula, trocar terminal de um segmento, relaxar/apertar
                      regra de lens) que atinja o alvo — o resultado exibido é sempre uma <b>re-simulação
                      real</b>, nunca uma estimativa.
                    </p>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Alvo
                        <select value={goal.target} onChange={e=>updGoal({target:e.target.value})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit"}}>
                          {Object.entries(GOAL_SEEK_TARGET_META).map(([k,v])=>(
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                      </label>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Direção
                        <select value={goal.direction} onChange={e=>updGoal({direction:e.target.value})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit"}}>
                          <option value="increase">Aumentar</option>
                          <option value="decrease">Diminuir</option>
                        </select>
                      </label>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Magnitude {targetMeta.scale==='ratio'?'(pp, ex.: 0.5 = 0,5pp)':targetMeta.scale==='pp100'?'(pp)':'(qty)'}
                        <input type="number" step="any" value={goal.magnitude ?? ''}
                          placeholder="vazio = máximo/mínimo possível"
                          onChange={e=>updGoal({magnitude: e.target.value===''?null:Number(e.target.value)})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit",boxSizing:"border-box"}}/>
                      </label>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Minimizar colateralmente
                        <select value={goal.minimize||'inadInferida'} onChange={e=>updGoal({minimize:e.target.value})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit"}}>
                          {GOAL_SEEK_MINIMIZE_OPTS.filter(o=>o.collidesWith!==goal.target).map(o=>(
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div style={{borderTop:"1px solid #f1f5f9",paddingTop:12}}>
                      <p style={{fontSize:11,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Restrições-teto (opcional)</p>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                        <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                          Teto Inad. Real (ratio 0–1)
                          <input type="number" step="any" min="0" max="1" value={constraints.maxInadReal ?? ''}
                            placeholder="sem teto"
                            onChange={e=>updCons({maxInadReal: e.target.value===''?null:Number(e.target.value)})}
                            style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit",boxSizing:"border-box"}}/>
                        </label>
                        <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                          Teto Inad. Inferida (ratio 0–1)
                          <input type="number" step="any" min="0" max="1" value={constraints.maxInadInf ?? ''}
                            placeholder="sem teto"
                            onChange={e=>updCons({maxInadInf: e.target.value===''?null:Number(e.target.value)})}
                            style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit",boxSizing:"border-box"}}/>
                        </label>
                      </div>
                    </div>
                    {/* GS6 (DEC-GS-010) — modo AUTOMÁTICO: busca ótima (MILP, sem teto) quando
                        o sidecar declara `goal_seek_deep`; senão degradação declarada (H6). */}
                    {deepOk ? (
                      <div style={{display:"flex",alignItems:"center",gap:7,padding:"7px 10px",borderRadius:8,
                        background:"#f0fdf4",border:"1px solid #bbf7d0",fontSize:11,color:"#15803d",fontWeight:600}}>
                        <span style={{fontSize:13}}>⚡</span>
                        Busca ótima (Motor Python) — MILP sobre o catálogo agregado, sem teto artificial.
                      </div>
                    ) : (
                      <ComputeCeilingNotice
                        ceilingText="Busca gulosa no navegador (padrão) — ligue o Motor Python para a busca ÓTIMA (MILP, sem teto artificial) e a fronteira completa."
                        unlockedText="Motor Python detectado — a busca roda ótima (MILP)."
                        status={{ available: false }}
                        onOpenPrefs={()=>setSidecarPrefsOpen(true)}
                      />
                    )}
                    <button onClick={runGoalSeek}
                      style={{marginTop:6,padding:"11px 16px",borderRadius:10,border:"none",
                        background:"#f59e0b",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>
                      🔎 Buscar
                    </button>
                  </div>
                )}

                {step==='loading' && (deepRun ? (
                  <ComputeJobProgress
                    label={
                      deepRun.phase === 'catalog' ? 'Montando catálogo de movimentos…' :
                      deepRun.phase === 'optimizing' ? 'Busca ótima (MILP) no Motor Python…' :
                      'Validando a solução por re-simulação (modo browser)…'
                    }
                    progress={deepRun.progress}
                    via={deepRun.via}
                    onCancel={deepRun.phase === 'optimizing' ? cancelDeepGoalSeek : null}
                  />
                ) : (
                  <div style={{padding:"40px 0",textAlign:"center",color:"#92400e",fontSize:13}}>
                    Buscando movimentos que atingem o objetivo…
                  </div>
                ))}

                {step==='result' && (()=>{
                  const baseVal = baseline?.[goal.target] ?? null;
                  const resVal = result?.[goal.target] ?? null;
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>
                      {/* GS6 — degradação declarada (P4): aviso quando o modo profundo caiu no
                          meio do fluxo (sidecar indisponível/infeasible/solução inválida/tempo
                          esgotado) e a busca terminou no guloso do navegador mesmo assim. */}
                      {fallbackNotice && (
                        <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:8,
                          background:"#f8fafc",border:"1px solid #e2e8f0",fontSize:10.5,color:"#94a3b8",lineHeight:1.5}}>
                          <span>🌐</span><span>{fallbackNotice}</span>
                        </div>
                      )}
                      <div style={{display:"flex",gap:10,alignItems:"center",padding:"10px 14px",borderRadius:10,
                        background: goalReached ? "#f0fdf4" : "#fffbeb",
                        border: `1px solid ${goalReached ? "#bbf7d0" : "#fde68a"}`}}>
                        <span style={{fontSize:18}}>{goalReached ? "✅" : "⚠"}</span>
                        <div style={{fontSize:12,color: goalReached ? "#15803d" : "#92400e",lineHeight:1.5,flex:1}}>
                          {goalReached
                            ? <b>Objetivo atingido.</b>
                            : <><b>Objetivo não totalmente atingido</b> — melhor ponto alcançado abaixo.</>}
                          {bindingConstraint && <> Restrição-gargalo: <b>{BINDING_LABEL[bindingConstraint] || bindingConstraint}</b>.</>}
                        </div>
                        {/* Rodapé de executor (DEC-GS-010): quem de fato produziu este resultado. */}
                        <span style={{fontSize:10,color:"#94a3b8",fontWeight:600,whiteSpace:"nowrap",flexShrink:0}}>
                          {via === 'sidecar' ? '⚡ ótimo (Motor Python)' : '⚙ guloso (navegador)'}
                        </span>
                      </div>

                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                        {[
                          {k:'approvalRate', label:'Taxa de Aprovação'},
                          {k:'inadReal', label:'Inad. Real'},
                          {k:'inadInferida', label:'Inad. Inferida'},
                        ].map(({k,label})=>{
                          const meta = GOAL_SEEK_TARGET_META[k];
                          const bv = baseline?.[k], rv = result?.[k];
                          return (
                            <div key={k} style={{padding:"10px 12px",borderRadius:10,border:"1px solid #e2e8f0",background:"#f8fafc"}}>
                              <div style={{fontSize:10.5,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>{label}</div>
                              <div style={{fontSize:15,fontWeight:700,color:"#1e293b"}}>{meta.fmt(rv)}</div>
                              <div style={{fontSize:10.5,color:"#94a3b8"}}>era {meta.fmt(bv)}</div>
                            </div>
                          );
                        })}
                      </div>

                      <div>
                        <p style={{fontSize:11,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>
                          Movimentos ({moves.length})
                        </p>
                        {moves.length===0 ? (
                          <div style={{padding:"14px 10px",fontSize:12,color:"#94a3b8",textAlign:"center",border:"1px dashed #e2e8f0",borderRadius:10}}>
                            Nenhum movimento disponível no catálogo (verifique travas 🔒 ou se já está no objetivo).
                          </div>
                        ) : (
                          <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:220,overflowY:"auto"}}>
                            {moves.map((mv,i)=>(
                              <div key={mv.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",
                                borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",fontSize:11.5}}>
                                <span style={{width:20,height:20,borderRadius:6,background:"#fef3c7",color:"#92400e",
                                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,flexShrink:0}}>{i+1}</span>
                                <span style={{flex:1,color:"#334155"}}>{mv.label}</span>
                                {/* DEC-GS-004 (GS3) — selo estatístico: informa, nunca reordena/filtra a busca. */}
                                {mv.stats && (mv.stats.fragile || mv.stats.ci95) && (
                                  <span
                                    title={`n=${mv.stats.n ?? '—'}${mv.stats.pValue!=null ? ` · p=${mv.stats.pValue.toFixed(3)}` : ''}`}
                                    style={{fontSize:9.5,fontWeight:700,padding:"2px 6px",borderRadius:6,flexShrink:0,cursor:"help",
                                      background: mv.stats.fragile ? "#fef3c7" : "#f1f5f9",
                                      color: mv.stats.fragile ? "#92400e" : "#64748b"}}>
                                    {mv.stats.fragile
                                      ? "⚠ amostra frágil"
                                      : `IC95 ${(mv.stats.ci95[0]*100).toFixed(1)}–${(mv.stats.ci95[1]*100).toFixed(1)}%`}
                                  </span>
                                )}
                                <span style={{color: mv.deltaApprovalRate>=0 ? "#16a34a" : "#dc2626",fontWeight:600,flexShrink:0}}>
                                  {mv.deltaApprovalRate>=0?'+':''}{mv.deltaApprovalRate.toFixed(2)}pp aprov.
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* GS6 (DEC-GS-006) — fronteira Recharts: série única (greedy/deep com teto
                          declarado) ou família de curvas por teto de inad. inferida (deep sem
                          teto declarado, `curves` vindo do sidecar) — nunca gráfico 3D. */}
                      <GoalSeekFrontierChart frontier={frontier} curves={curves}/>

                      <div style={{display:"flex",gap:8,justifyContent:"flex-end",borderTop:"1px solid #f1f5f9",paddingTop:12}}>
                        <button onClick={()=>setGoalSeekModal(m=>({...m,step:'form'}))}
                          style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",
                            color:"#475569",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit"}}>
                          ← Ajustar objetivo
                        </button>
                        <button onClick={applyGoalSeekResult} disabled={moves.length===0}
                          style={{padding:"9px 18px",borderRadius:9,border:"none",
                            background: moves.length===0 ? "#e2e8f0" : "#16a34a",
                            color:"#fff",cursor: moves.length===0 ? "default" : "pointer",
                            fontSize:12.5,fontWeight:700,fontFamily:"inherit"}}>
                          ✓ Aplicar como novo cenário
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════ SIMPLIFY MODAL — simplificação com prova (Copiloto Sessão 5) ═══════════════ */}
      {simplifyModal&&(()=>{
        const { step, proposal, equivalence } = simplifyModal;
        const candidates = proposal?.candidates || [];
        const fmtPctSigned = (v) => v==null ? 'N/A' : `${(v*100).toFixed(2)}%`;
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",backdropFilter:"blur(4px)",
            zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:680,maxHeight:"92vh",
              boxShadow:"0 32px 100px rgba(0,0,0,.28)",display:"flex",flexDirection:"column",overflow:"hidden"}}>

              {/* Header */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"14px 24px",borderBottom:"1px solid #e2e8f0",flexShrink:0,
                background:"linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%)"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:38,height:38,borderRadius:10,background:"#bbf7d0",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🧹</div>
                  <div>
                    <h2 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:1}}>Simplificação com Prova</h2>
                    <p style={{fontSize:11,color:"#15803d"}}>Copiloto Sessão 5 — detector de equivalência</p>
                  </div>
                </div>
                <button onClick={()=>setSimplifyModal(null)}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                    cursor:"pointer",fontSize:15,color:"#64748b",display:"flex",alignItems:"center",
                    justifyContent:"center",fontFamily:"inherit"}}>✕</button>
              </div>

              <div style={{padding:"18px 24px",overflowY:"auto",flex:1}}>
                {step==='loading' && (
                  <div style={{padding:"40px 0",textAlign:"center",color:"#15803d",fontSize:13}}>
                    Detectando nós colapsáveis, chegada zero, regras sem efeito e variáveis re-testadas…
                  </div>
                )}

                {step==='result' && (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    {candidates.length===0 ? (
                      <div style={{padding:"24px 14px",fontSize:12.5,color:"#64748b",textAlign:"center",
                        border:"1px dashed #e2e8f0",borderRadius:10,lineHeight:1.6}}>
                        Nenhuma simplificação segura encontrada — o detector não achou nó colapsável, chegada
                        zero, regra de lens sem efeito ou variável re-testada nesta política.
                      </div>
                    ) : (
                      <>
                        <div style={{display:"flex",gap:10,alignItems:"center",padding:"10px 14px",borderRadius:10,
                          background: equivalence?.identical ? "#f0fdf4" : "#fffbeb",
                          border: `1px solid ${equivalence?.identical ? "#bbf7d0" : "#fde68a"}`}}>
                          <span style={{fontSize:18}}>{equivalence?.identical ? "✅" : "⚠"}</span>
                          <div style={{fontSize:12,color: equivalence?.identical ? "#15803d" : "#92400e",lineHeight:1.5}}>
                            {equivalence?.identical
                              ? <><b>Prova de equivalência: idêntica.</b> {proposal.removedNodeCount} nó(s) removível(is) de {proposal.totalNodeCount} — 0 de {equivalence.totalRows} linhas mudam de decisão.</>
                              : <><b>Simplificação parcial (lossy).</b> {equivalence?.diffCount} de {equivalence?.totalRows} linhas mudam de decisão — delta declarado abaixo.</>}
                          </div>
                        </div>

                        <div>
                          <p style={{fontSize:11,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>
                            Simplificações propostas ({candidates.length})
                          </p>
                          <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:280,overflowY:"auto"}}>
                            {candidates.map((c)=>{
                              const meta = SIMPLIFY_CODE_META[c.code] || { icon:'•', label: c.code };
                              return (
                                <div key={c.id} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"8px 10px",
                                  borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",fontSize:11.5}}>
                                  <span style={{width:22,height:22,borderRadius:6,background:"#dcfce7",flexShrink:0,
                                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>{meta.icon}</span>
                                  <div style={{flex:1}}>
                                    <div style={{fontSize:10,color:"#16a34a",fontWeight:700,textTransform:"uppercase",letterSpacing:.4,marginBottom:2}}>{meta.label}</div>
                                    <div style={{color:"#334155",lineHeight:1.5}}>{c.label}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {equivalence?.delta && (
                          <div>
                            <p style={{fontSize:11,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Delta declarado</p>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                              {[
                                {k:'approvalRate', label:'Taxa de Aprovação', fmt:v=>v==null?'N/A':`${v.toFixed(2)}%`},
                                {k:'inadReal', label:'Inad. Real', fmt:fmtPctSigned},
                                {k:'inadInferida', label:'Inad. Inferida', fmt:fmtPctSigned},
                              ].map(({k,label,fmt})=>{
                                const d = equivalence.delta[k];
                                return (
                                  <div key={k} style={{padding:"10px 12px",borderRadius:10,border:"1px solid #e2e8f0",background:"#f8fafc"}}>
                                    <div style={{fontSize:10.5,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",marginBottom:4}}>{label}</div>
                                    <div style={{fontSize:15,fontWeight:700,color:"#1e293b"}}>{fmt(d?.after)}</div>
                                    <div style={{fontSize:10.5,color:"#94a3b8"}}>era {fmt(d?.before)}</div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div style={{display:"flex",gap:8,justifyContent:"flex-end",borderTop:"1px solid #f1f5f9",paddingTop:12}}>
                          <button onClick={()=>setSimplifyModal(null)}
                            style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",
                              color:"#475569",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit"}}>
                            Fechar
                          </button>
                          <button onClick={applySimplifyResult} disabled={candidates.length===0}
                            style={{padding:"9px 18px",borderRadius:9,border:"none",
                              background: candidates.length===0 ? "#e2e8f0" : "#16a34a",
                              color:"#fff",cursor: candidates.length===0 ? "default" : "pointer",
                              fontSize:12.5,fontWeight:700,fontFamily:"inherit"}}>
                            ✓ Aplicar como novo cenário
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════ DOCUMENTAÇÃO AUTOMÁTICA — Copiloto Sessão 6 (DEC-IA-006) ═══════════════ */}
      {docModal&&(()=>{
        const { step, includeDomains, compareCanvasId, docModel } = docModal;
        const canvasOptions = Object.values(canvases).filter(c => c.id !== activeCanvasId);
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",backdropFilter:"blur(4px)",
            zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth: step==='result' ? 920 : 480,maxHeight:"92vh",
              boxShadow:"0 32px 100px rgba(0,0,0,.28)",display:"flex",flexDirection:"column",overflow:"hidden"}}>

              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"14px 24px",borderBottom:"1px solid #e2e8f0",flexShrink:0,
                background:"linear-gradient(135deg,#eff6ff 0%,#dbeafe 100%)"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:38,height:38,borderRadius:10,background:"#bfdbfe",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>📄</div>
                  <div>
                    <h2 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:1}}>Documentação Automática</h2>
                    <p style={{fontSize:11,color:"#1d4ed8"}}>Copiloto Sessão 6 — gerado da política viva, com os números da simulação</p>
                  </div>
                </div>
                <button onClick={()=>setDocModal(null)}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                    cursor:"pointer",fontSize:15,color:"#64748b",display:"flex",alignItems:"center",
                    justifyContent:"center",fontFamily:"inherit"}}>✕</button>
              </div>

              <div style={{padding:"18px 24px",overflowY:"auto",flex:1}}>
                {step==='form' && (
                  <div style={{display:"flex",flexDirection:"column",gap:16}}>
                    <label style={{display:"flex",alignItems:"flex-start",gap:8,fontSize:12.5,color:"#334155",lineHeight:1.5,cursor:"pointer"}}>
                      <input type="checkbox" checked={!!includeDomains}
                        onChange={e=>setDocModal(m=>({...m,includeDomains:e.target.checked}))}
                        style={{marginTop:2}}/>
                      <span>
                        <b>Incluir domínios de valores</b> (ex.: R01–R20, Digital/Loja) no documento.
                        Desligado por padrão — o documento pode circular fora do sistema (Contrato de
                        Privacidade, N2 opt-in). Nomes de variáveis e números agregados aparecem sempre.
                      </span>
                    </label>
                    <div>
                      <label style={{fontSize:11,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.5,display:"block",marginBottom:6}}>
                        Changelog — comparar com outro canvas (opcional)
                      </label>
                      <select value={compareCanvasId||''} onChange={e=>setDocModal(m=>({...m,compareCanvasId:e.target.value||null}))}
                        style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit",color:"#334155"}}>
                        <option value="">(nenhum — sem changelog)</option>
                        {canvasOptions.map(c=> <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div style={{display:"flex",justifyContent:"flex-end",gap:8,borderTop:"1px solid #f1f5f9",paddingTop:14}}>
                      <button onClick={()=>setDocModal(null)}
                        style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",
                          color:"#475569",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit"}}>
                        Cancelar
                      </button>
                      <button onClick={runPolicyDoc}
                        style={{padding:"9px 18px",borderRadius:9,border:"none",background:"#2563eb",
                          color:"#fff",cursor:"pointer",fontSize:12.5,fontWeight:700,fontFamily:"inherit"}}>
                        📄 Gerar Documento
                      </button>
                    </div>
                  </div>
                )}

                {step==='loading' && (
                  <div style={{padding:"40px 0",textAlign:"center",color:"#1d4ed8",fontSize:13}}>
                    Montando sumário, fluxo, regras achatadas, funil e cenários…
                  </div>
                )}

                {step==='result' && docModel && (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    <iframe title="Prévia do documento" srcDoc={renderDocHTML(docModel)}
                      style={{width:"100%",height:520,border:"1px solid #e2e8f0",borderRadius:10,background:"#fff"}}/>
                    <div style={{display:"flex",gap:8,justifyContent:"flex-end",borderTop:"1px solid #f1f5f9",paddingTop:12}}>
                      <button onClick={()=>setDocModal(m=>({...m,step:'form'}))}
                        style={{padding:"9px 14px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",
                          color:"#475569",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit"}}>
                        ← Opções
                      </button>
                      <button onClick={downloadDocMarkdown}
                        style={{padding:"9px 14px",borderRadius:9,border:"1px solid #bfdbfe",background:"#eff6ff",
                          color:"#1d4ed8",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit"}}>
                        ⬇ Markdown
                      </button>
                      <button onClick={printDocHTML}
                        style={{padding:"9px 18px",borderRadius:9,border:"none",background:"#2563eb",
                          color:"#fff",cursor:"pointer",fontSize:12.5,fontWeight:700,fontFamily:"inherit"}}>
                        🖨 Imprimir / PDF
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════ SEGMENT DISCOVERY MODAL — Descoberta de Segmentos (Copiloto Sessão 10/11) ═══════════════ */}
      {segmentDiscoveryModal&&(()=>{
        const { step, scope, params, segmentModel, varFilter, focusedId, selectedIds = [], combined, deepRun, fallbackNotice, filtroVars = [] } = segmentDiscoveryModal;
        const updParams = (patch) => setSegmentDiscoveryModal(m => ({ ...m, params: { ...m.params, ...patch } }));
        // H7 — Descoberta profunda (Classe B): depth 3–4 / beam ampliado só quando o
        // sidecar está pareado E declara a task `segment_discovery` em capabilities
        // (tier full com o GATE dourado embarcado — DEC-HX-005). Sem ele, as opções
        // ficam desabilitadas com o teto declarado (helper do H6).
        const sidecarTasks = computeSidecarStatus?.capabilities?.tasks;
        const deepOk = computeSidecar.enabled && !!computeSidecarStatus?.available &&
          Array.isArray(sidecarTasks) && sidecarTasks.includes('segment_discovery');
        const findings = segmentModel?.findings || [];
        const selectedSet = new Set(selectedIds);
        const allVars = [...new Set(findings.flatMap(f => [
          ...(f.segment.conditions||[]).map(c=>c.col),
          ...(f.code==='heterogeneous_block' ? (f.explanation.contributions||[]).map(c=>c.col) : []),
        ]))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
        const filtered = varFilter ? findings.filter(f =>
          (f.segment.conditions||[]).some(c=>c.col===varFilter) ||
          (f.code==='heterogeneous_block' && (f.explanation.contributions||[]).some(c=>c.col===varFilter))
        ) : findings;
        const diag = segmentModel?.diagnostics;
        const scopeLabel = segmentModel?.scope?.label ?? (scope ? (shapesById.get(scope.nodeId)?.label || scope.nodeId) : null);

        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",backdropFilter:"blur(4px)",
            zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth: step==='result' ? 940 : 480,maxHeight:"92vh",
              boxShadow:"0 32px 100px rgba(0,0,0,.28)",display:"flex",flexDirection:"column",overflow:"hidden"}}>

              {/* Header */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"14px 24px",borderBottom:"1px solid #e2e8f0",flexShrink:0,
                background:"linear-gradient(135deg,#eef2ff 0%,#e0e7ff 100%)"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:38,height:38,borderRadius:10,background:"#c7d2fe",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🔍</div>
                  <div>
                    <h2 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:1}}>Descoberta de Segmentos</h2>
                    <p style={{fontSize:11,color:"#4f46e5"}}>
                      {scope ? `Escopo: população que chega a "${scopeLabel}"` : "Escopo: base inteira"}
                    </p>
                  </div>
                </div>
                <button onClick={()=>{ segDiscoveryAbortRef.current?.abort(); setSegmentDiscoveryModal(null); }}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                    cursor:"pointer",fontSize:15,color:"#64748b",display:"flex",alignItems:"center",
                    justifyContent:"center",fontFamily:"inherit"}}>✕</button>
              </div>

              <div style={{padding:"18px 24px",overflowY:"auto",flex:1}}>
                {step==='result' && fallbackNotice && (
                  <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:8,marginBottom:12,
                    background:"#f8fafc",border:"1px solid #e2e8f0",fontSize:10.5,color:"#94a3b8",lineHeight:1.5}}>
                    <span>🌐</span><span>{fallbackNotice}</span>
                  </div>
                )}
                {step==='form' && (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    <p style={{fontSize:12,color:"#64748b",lineHeight:1.6}}>
                      Varredura (subgroup discovery) sobre as colunas Filtro procurando conjunções onde a
                      métrica de risco desvia significativamente da referência — nenhum achado aparece sem
                      passar volume mínimo → shrinkage → teste + FDR → dedup.
                    </p>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Métrica de risco
                        <select value={params.riskMetric} onChange={e=>updParams({riskMetric:e.target.value})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit"}}>
                          <option value="inadReal">Inad. Real</option>
                          <option value="inadInferida">Inad. Inferida</option>
                        </select>
                      </label>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Profundidade máx. da conjunção
                        <select value={params.maxDepth} onChange={e=>updParams({maxDepth:Number(e.target.value)})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit"}}>
                          <option value={1}>1 variável</option>
                          <option value={2}>2 variáveis</option>
                          <option value={3} disabled={!deepOk}>3 variáveis{deepOk?' · 🐍':' — requer Motor Python'}</option>
                          <option value={4} disabled={!deepOk}>4 variáveis{deepOk?' · 🐍':' — requer Motor Python'}</option>
                        </select>
                      </label>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Volume mínimo por segmento
                        <input type="number" min="1" value={params.minQty ?? ''}
                          placeholder="automático (máx. entre 200 e 0,1% da população)"
                          onChange={e=>updParams({minQty: e.target.value===''?null:Number(e.target.value)})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit",boxSizing:"border-box"}}/>
                      </label>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Teto de candidatos (beam)
                        <select value={params.beamWidth ?? 8} onChange={e=>updParams({beamWidth: Number(e.target.value) === 8 ? null : Number(e.target.value)})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit"}}>
                          <option value={8}>8 (padrão)</option>
                          <option value={16} disabled={!deepOk}>16{deepOk?' · 🐍':' — requer Motor Python'}</option>
                          <option value={32} disabled={!deepOk}>32{deepOk?' · 🐍':' — requer Motor Python'}</option>
                        </select>
                      </label>
                    </div>
                    {filtroVars.length > 0 && (()=>{
                      const excludedCols = params.excludedCols || [];
                      const excludedSet = new Set(excludedCols);
                      const includedCount = filtroVars.length - excludedCols.length;
                      const toggleVar = (col) => updParams({ excludedCols: excludedSet.has(col)
                        ? excludedCols.filter(c=>c!==col)
                        : [...excludedCols, col] });
                      return (
                        <div style={{border:"1.5px solid #e2e8f0",borderRadius:10,padding:"10px 12px"}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                            <span style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                              Variáveis incluídas na busca ({includedCount}/{filtroVars.length})
                            </span>
                            <div style={{display:"flex",gap:10}}>
                              <button type="button" onClick={()=>updParams({excludedCols:[]})}
                                style={{fontSize:10.5,color:"#4f46e5",background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
                                Marcar tudo
                              </button>
                              <button type="button" onClick={()=>updParams({excludedCols: filtroVars.map(v=>v.col)})}
                                style={{fontSize:10.5,color:"#64748b",background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>
                                Desmarcar tudo
                              </button>
                            </div>
                          </div>
                          <div style={{maxHeight:150,overflowY:"auto",display:"flex",flexDirection:"column",gap:5}}>
                            {filtroVars.map(v => (
                              <label key={v.col} style={{display:"flex",alignItems:"center",gap:7,fontSize:12,color:"#334155",cursor:"pointer"}}>
                                <input type="checkbox" checked={!excludedSet.has(v.col)} onChange={()=>toggleVar(v.col)}/>
                                <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v.col}</span>
                                {v.reason==='temporal' && (
                                  <span title="Provável variável de cohort/vintage (mês/safra de referência) — não costuma ser um driver de risco acionável; desmarcada por padrão."
                                    style={{fontSize:10,color:"#94a3b8",flexShrink:0}}>🕐 temporal</span>
                                )}
                                {v.reason==='score' && (
                                  <span title="Provável variável de score/rating — geralmente já é o próprio risco ou já está em uso em outro nó da política; desmarcada por padrão."
                                    style={{fontSize:10,color:"#94a3b8",flexShrink:0}}>🎯 score</span>
                                )}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    <ComputeCeilingNotice
                      ceilingText="Sem o Motor Python, a Descoberta respeita os tetos do navegador: profundidade ≤ 2 variáveis e beam 8 (paridade total — nada deixa de funcionar, só os tetos)."
                      unlockedText={`Motor Python detectado (tier ${computeSidecarStatus.tier || '—'}) — profundidade 3–4 e beam ampliado liberados; a varredura profunda roda vetorizada no sidecar.`}
                      status={deepOk ? computeSidecarStatus : { available: false }}
                      onOpenPrefs={()=>setSidecarPrefsOpen(true)}
                    />
                    {filtroVars.length > 0 && filtroVars.length === (params.excludedCols||[]).length && (
                      <p style={{fontSize:11,color:"#dc2626",margin:0}}>Marque ao menos uma variável para buscar.</p>
                    )}
                    <button onClick={runSegmentDiscovery}
                      disabled={filtroVars.length > 0 && filtroVars.length === (params.excludedCols||[]).length}
                      style={{marginTop:6,padding:"11px 16px",borderRadius:10,border:"none",
                        background: (filtroVars.length > 0 && filtroVars.length === (params.excludedCols||[]).length) ? "#c7d2fe" : "#4f46e5",
                        color:"#fff",cursor: (filtroVars.length > 0 && filtroVars.length === (params.excludedCols||[]).length) ? "not-allowed" : "pointer",
                        fontSize:13,fontWeight:700,fontFamily:"inherit"}}>
                      🔎 Buscar
                    </button>
                  </div>
                )}

                {step==='loading' && (deepRun ? (
                  <ComputeJobProgress
                    label={deepRun.phase === 'recs'
                      ? 'Validando recomendações por re-simulação (modo browser)…'
                      : 'Descoberta profunda no Motor Python…'}
                    progress={deepRun.progress}
                    via={deepRun.via}
                    onCancel={deepRun.phase === 'discovery' ? cancelDeepSegmentDiscovery : null}
                  />
                ) : (
                  <div style={{padding:"40px 0",textAlign:"center",color:"#4f46e5",fontSize:13}}>
                    Varrendo a base por segmentos…
                  </div>
                ))}

                {step==='result' && segmentModel && (()=>{
                  if (findings.length === 0) {
                    return (
                      <div style={{display:"flex",flexDirection:"column",gap:14}}>
                        <div style={{padding:"14px 16px",borderRadius:10,background:"#f8fafc",border:"1px dashed #e2e8f0",
                          fontSize:12.5,color:"#64748b",textAlign:"center",lineHeight:1.6}}>
                          Nenhum segmento passou os filtros de relevância (volume mínimo, significância/FDR, acionabilidade).
                        </div>
                        {diag && <DiagnosticsStrip diag={diag}/>}
                        <button onClick={()=>setSegmentDiscoveryModal(m=>({...m,step:'form'}))}
                          style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",
                            color:"#475569",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit",alignSelf:"flex-start"}}>
                          ← Ajustar parâmetros
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                        <div style={{fontSize:12,color:"#64748b"}}>
                          <b>{findings.length}</b> achado{findings.length!==1?'s':''} · população do escopo: <b>{fmtQty(segmentModel.population.qty)}</b>
                        </div>
                        <button onClick={()=>setSegmentDiscoveryModal(m=>({...m,step:'form'}))}
                          style={{padding:"6px 12px",borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                            color:"#475569",cursor:"pointer",fontSize:11.5,fontWeight:600,fontFamily:"inherit"}}>
                          ← Ajustar parâmetros
                        </button>
                      </div>

                      {allVars.length>0 && (
                        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                          <span style={{fontSize:10.5,color:"#94a3b8",fontWeight:600,textTransform:"uppercase"}}>Filtrar por variável:</span>
                          {allVars.map(v=>(
                            <button key={v} onClick={()=>setSegmentDiscoveryModal(m=>({...m,varFilter: m.varFilter===v?null:v}))}
                              style={{padding:"3px 10px",borderRadius:20,border:`1px solid ${varFilter===v?'#4f46e5':'#e2e8f0'}`,
                                background:varFilter===v?'#eef2ff':'#fff',color:varFilter===v?'#4338ca':'#64748b',
                                cursor:"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit"}}>
                              {v}
                            </button>
                          ))}
                          {varFilter && (
                            <button onClick={()=>setSegmentDiscoveryModal(m=>({...m,varFilter:null}))}
                              style={{border:"none",background:"none",color:"#94a3b8",cursor:"pointer",fontSize:10.5,fontFamily:"inherit"}}>
                              ✕ limpar
                            </button>
                          )}
                        </div>
                      )}

                      {filtered.length>1 && (
                        <SegmentQuadrant findings={filtered} focusedId={focusedId} onPick={focusSegmentFinding}/>
                      )}

                      <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:360,overflowY:"auto",paddingRight:2}}>
                        {filtered.map(f=>(
                          <SegmentFindingCard key={f.id} finding={f} segmentModel={segmentModel}
                            focused={focusedId===f.id} onFocus={focusSegmentFinding}
                            onViewDashboard={viewSegmentInDashboard} onViewFlow={viewSegmentInFlow}
                            onApply={applySegmentRecommendation} onSendGoalSeek={sendSegmentToGoalSeek}
                            selectable={!!(f.recommendation && f.recommendation.actionable)}
                            selected={selectedSet.has(f.id)} onToggleSelect={toggleSegmentSelect}/>
                        ))}
                      </div>

                      {/* Aplicação combinada de N recomendações (delta re-simulado, nunca soma) */}
                      {selectedIds.length>=2 && (
                        <div style={{padding:"11px 14px",borderRadius:12,background:"#eef2ff",border:"1.5px solid #c7d2fe",display:"flex",flexDirection:"column",gap:8}}>
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                            <div style={{fontSize:12,color:"#3730a3",fontWeight:600}}>
                              🧩 {selectedIds.length} recomendações selecionadas para aplicar juntas
                            </div>
                            <div style={{display:"flex",gap:6}}>
                              <button onClick={runSegmentCombined} disabled={combined?.loading}
                                style={{padding:"6px 12px",borderRadius:8,border:"1px solid #c7d2fe",background:"#fff",color:"#4338ca",cursor:"pointer",fontSize:11.5,fontWeight:600,fontFamily:"inherit"}}>
                                {combined?.loading ? "Simulando…" : "🔎 Simular combinação"}
                              </button>
                              <button onClick={applySegmentCombinedAsScenario}
                                style={{padding:"6px 12px",borderRadius:8,border:"none",background:"#4f46e5",color:"#fff",cursor:"pointer",fontSize:11.5,fontWeight:700,fontFamily:"inherit"}}>
                                ✓ Aplicar juntas como cenário
                              </button>
                            </div>
                          </div>
                          {combined?.result && (()=>{
                            const r = combined.result;
                            return (
                              <div style={{fontSize:11.5,color:"#1e293b",lineHeight:1.6,paddingTop:6,borderTop:"1px dashed #c7d2fe"}}>
                                <div><b>Combinado (re-simulado):</b> aprovação {fmtPP(r.combinedApprovalDelta)} · {fmtQty(r.combinedMovedQty)} propostas movidas.</div>
                                <div style={{color:"#64748b"}}>Soma dos individuais: {fmtPP(r.sumApprovalDelta)} · {fmtQty(r.sumMovedQty)} — o efeito NÃO é aditivo.</div>
                                {r.interaction?.interacts && r.interaction.note && (
                                  <div style={{marginTop:4,color:"#b45309",fontWeight:600}}>⚠ {r.interaction.note}</div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {diag && <DiagnosticsStrip diag={diag}/>}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════ CLUSTER MODAL — Clusterização de Segmentos (Execução Híbrida H8) ═══════════════ */}
      {clusterModal&&(()=>{
        const { step, csvId, dims, k, autoK, method, model, focusedId, deepRun, fallbackNotice } = clusterModal;
        const upd = (patch) => setClusterModal(m => ({ ...m, ...patch }));
        // H8 — tetos declarados (paridade total, P4): dims > 3 / k > 8 e os extras
        // sklearn (k automático por silhueta, hierárquico) só quando o sidecar está
        // pareado E declara a task `cluster_segments` em capabilities (tier full com o
        // GATE dourado embarcado); sklearn é declarado POR PACOTE (DEC-HX-004).
        const sidecarTasks = computeSidecarStatus?.capabilities?.tasks;
        const deepOk = computeSidecar.enabled && !!computeSidecarStatus?.available &&
          Array.isArray(sidecarTasks) && sidecarTasks.includes('cluster_segments');
        const skVer = computeSidecarStatus?.capabilities?.packages?.sklearn;
        const sklearnOk = deepOk && !!skVer && skVer !== 'loading';
        const csv = csvId ? csvStore[csvId] : null;
        const availableDims = csv
          ? csv.headers.filter(h => (csv.columnTypes||{})[h] === 'decision')
          : [];
        const dimsCapped = !deepOk && dims.length >= CLU_BROWSER_DIMS;
        const toggleDim = (col) => upd({
          dims: dims.includes(col) ? dims.filter(d => d !== col) : [...dims, col],
        });
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",backdropFilter:"blur(4px)",
            zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth: step==='result' ? 940 : 520,maxHeight:"92vh",
              boxShadow:"0 32px 100px rgba(0,0,0,.28)",display:"flex",flexDirection:"column",overflow:"hidden"}}>

              {/* Header */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"14px 24px",borderBottom:"1px solid #e2e8f0",flexShrink:0,
                background:"linear-gradient(135deg,#f5f3ff 0%,#ede9fe 100%)"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:38,height:38,borderRadius:10,background:"#ddd6fe",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🧩</div>
                  <div>
                    <h2 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:1}}>Clusterização de Segmentos</h2>
                    <p style={{fontSize:11,color:"#6d28d9"}}>
                      Agrupa segmentos parecidos por comportamento (k-means determinístico)
                    </p>
                  </div>
                </div>
                <button onClick={()=>{ clusterAbortRef.current?.abort(); setClusterModal(null); }}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                    cursor:"pointer",fontSize:15,color:"#64748b",display:"flex",alignItems:"center",
                    justifyContent:"center",fontFamily:"inherit"}}>✕</button>
              </div>

              <div style={{padding:"18px 24px",overflowY:"auto",flex:1}}>
                {step==='result' && fallbackNotice && (
                  <div style={{display:"flex",alignItems:"center",gap:6,padding:"6px 10px",borderRadius:8,marginBottom:12,
                    background:"#f8fafc",border:"1px solid #e2e8f0",fontSize:10.5,color:"#94a3b8",lineHeight:1.5}}>
                    <span>🌐</span><span>{fallbackNotice}</span>
                  </div>
                )}

                {step==='form' && (!csvId ? (
                  <div style={{padding:"24px 0",textAlign:"center",color:"#94a3b8",fontSize:12.5,lineHeight:1.6}}>
                    Nenhuma base carregada — importe um CSV para clusterizar segmentos.
                  </div>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    <p style={{fontSize:12,color:"#64748b",lineHeight:1.6}}>
                      A base é agregada pelas dimensões escolhidas (cada combinação de valores vira um
                      ponto, ponderado pelo volume) e os pontos são agrupados por perfil de
                      comportamento — aprovação AS IS, inad. real e inad. inferida. Mesmo dataset e
                      parâmetros ⇒ mesmo resultado, no navegador ou no Motor Python.
                    </p>
                    {Object.keys(csvStore).length>1 && (
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Base de dados
                        <select value={csvId} onChange={e=>upd({csvId:e.target.value,dims:[]})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit"}}>
                          {Object.entries(csvStore).map(([id,c])=>(<option key={id} value={id}>{c.name||id}</option>))}
                        </select>
                      </label>
                    )}
                    <div>
                      <div style={{fontSize:11.5,color:"#475569",fontWeight:600,marginBottom:6}}>
                        Dimensões (colunas Filtro) — {dims.length} selecionada{dims.length!==1?'s':''}
                        {!deepOk && <span style={{fontWeight:400,color:"#94a3b8"}}> · máx. 3 sem o Motor Python</span>}
                      </div>
                      {availableDims.length===0 ? (
                        <div style={{fontSize:11.5,color:"#94a3b8"}}>Esta base não tem colunas classificadas como Filtro.</div>
                      ) : (
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          {availableDims.map(col=>{
                            const on = dims.includes(col);
                            const blocked = !on && dimsCapped;
                            return (
                              <button key={col} onClick={()=>!blocked&&toggleDim(col)} disabled={blocked}
                                title={blocked?"Teto do navegador: 3 dimensões — ligue o Motor Python para mais":col}
                                style={{padding:"4px 11px",borderRadius:20,border:`1.5px solid ${on?'#7c3aed':'#e2e8f0'}`,
                                  background:on?'#f5f3ff':'#fff',color:blocked?'#cbd5e1':(on?'#6d28d9':'#64748b'),
                                  cursor:blocked?'not-allowed':'pointer',fontSize:11.5,fontWeight:600,fontFamily:"inherit"}}>
                                {on?'✓ ':''}{col}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Nº de clusters (k){autoK?' — máximo p/ busca':''}
                        <select value={k} onChange={e=>upd({k:Number(e.target.value)})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit"}}>
                          {[2,3,4,5,6,7,8].map(v=>(<option key={v} value={v}>{v}</option>))}
                          {[10,12,16].map(v=>(<option key={v} value={v} disabled={!deepOk}>{v}{deepOk?' · 🐍':' — requer Motor Python'}</option>))}
                        </select>
                      </label>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Método
                        <select value={method} onChange={e=>upd({method:e.target.value})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit"}}>
                          <option value="kmeans">k-means (padrão, determinístico)</option>
                          <option value="hierarchical" disabled={!sklearnOk}>Hierárquico (ward){sklearnOk?' · 🐍':' — requer Motor Python + sklearn'}</option>
                        </select>
                      </label>
                    </div>
                    <label style={{display:"flex",alignItems:"center",gap:8,fontSize:11.5,color:sklearnOk?"#475569":"#cbd5e1",fontWeight:600,cursor:sklearnOk?"pointer":"not-allowed"}}>
                      <input type="checkbox" checked={autoK} disabled={!sklearnOk}
                        onChange={e=>upd({autoK:e.target.checked})}/>
                      k automático pela silhueta (testa 2…k e escolhe o melhor){sklearnOk?' · 🐍':' — requer Motor Python + sklearn'}
                    </label>
                    <ComputeCeilingNotice
                      ceilingText="Sem o Motor Python, a clusterização respeita os tetos do navegador: até 3 dimensões, k ≤ 8, 2.000 pontos agregados e só k-means (paridade total — nada deixa de funcionar, só os tetos)."
                      unlockedText={`Motor Python detectado (tier ${computeSidecarStatus.tier || '—'}) — dimensões/k ampliados liberados${sklearnOk ? ', com k automático (silhueta) e hierárquico via sklearn' : ''}; a clusterização roda vetorizada no sidecar.`}
                      status={deepOk ? computeSidecarStatus : { available: false }}
                      onOpenPrefs={()=>setSidecarPrefsOpen(true)}
                    />
                    <button onClick={runClusterSegments} disabled={dims.length===0}
                      style={{marginTop:6,padding:"11px 16px",borderRadius:10,border:"none",
                        background:dims.length===0?"#e2e8f0":"#7c3aed",color:dims.length===0?"#94a3b8":"#fff",
                        cursor:dims.length===0?"not-allowed":"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>
                      🧩 Clusterizar
                    </button>
                  </div>
                ))}

                {step==='loading' && (deepRun ? (
                  <ComputeJobProgress
                    label="Clusterização no Motor Python…"
                    progress={deepRun.progress}
                    via={deepRun.via}
                    onCancel={cancelDeepClusterSegments}
                  />
                ) : (
                  <div style={{padding:"40px 0",textAlign:"center",color:"#6d28d9",fontSize:13}}>
                    Agregando a base e agrupando segmentos…
                  </div>
                ))}

                {step==='result' && model && (model.error ? (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    <div style={{padding:"14px 16px",borderRadius:10,background:"#fffbeb",border:"1px solid #fde68a",
                      fontSize:12.5,color:"#92400e",lineHeight:1.6}}>
                      {model.error==='no_rows' && 'A base selecionada não tem linhas para agrupar.'}
                      {model.error==='no_dims' && 'Nenhuma dimensão válida — escolha ao menos uma coluna Filtro.'}
                      {model.error==='no_features' && 'A base não tem métricas suficientes (inadimplência/AS IS) para montar o perfil dos grupos.'}
                    </div>
                    <button onClick={()=>setClusterModal(m=>({...m,step:'form'}))}
                      style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",
                        color:"#475569",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit",alignSelf:"flex-start"}}>
                      ← Ajustar parâmetros
                    </button>
                  </div>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                      <div style={{fontSize:12,color:"#64748b"}}>
                        <b>{model.clusters.length}</b> cluster{model.clusters.length!==1?'s':''} sobre <b>{model.population.points}</b> segmento{model.population.points!==1?'s':''} agregados
                        {' '}· população: <b>{fmtQty(model.population.qty)}</b>
                        {model.quality?.explainedVariance!=null && <> · variância explicada: <b>{(model.quality.explainedVariance*100).toFixed(1)}%</b></>}
                        {model.quality?.silhouette!=null && <> · silhueta: <b>{model.quality.silhouette.toFixed(3)}</b></>}
                        {model.quality?.method==='hierarchical' && ' · hierárquico'}
                      </div>
                      <button onClick={()=>setClusterModal(m=>({...m,step:'form'}))}
                        style={{padding:"6px 12px",borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                          color:"#475569",cursor:"pointer",fontSize:11.5,fontWeight:600,fontFamily:"inherit"}}>
                        ← Ajustar parâmetros
                      </button>
                    </div>

                    {/* CTA — transformar o resultado numa variável de fluxo arrastável */}
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",
                      padding:"10px 14px",borderRadius:10,background:"#f5f3ff",border:"1px solid #ddd6fe"}}>
                      <div style={{fontSize:11.5,color:"#5b21b6",lineHeight:1.5,flex:1,minWidth:220}}>
                        <b>Usar no fluxo?</b> Salve estes clusters como uma variável Filtro — vira um chip
                        arrastável ao canvas para abrir a política por cluster (e você renomeia/edita depois).
                      </div>
                      <button onClick={openClusterSaveStep}
                        style={{padding:"9px 16px",borderRadius:9,border:"none",background:"#7c3aed",color:"#fff",
                          cursor:"pointer",fontSize:12.5,fontWeight:700,fontFamily:"inherit",flexShrink:0}}>
                        ➕ Salvar como variável
                      </button>
                    </div>

                    {model.ceilings?.pointsTruncated && (
                      <div style={{display:"flex",gap:6,padding:"7px 10px",borderRadius:8,background:"#fdf4ff",
                        border:"1px solid #f0abfc",fontSize:11,color:"#86198f",lineHeight:1.5}}>
                        <span>✂</span>
                        <span>Teto de pontos do navegador: {model.ceilings.keptGroups} de {model.ceilings.totalGroups} grupos
                          mantidos ({model.ceilings.keptQtyShare!=null?`${(model.ceilings.keptQtyShare*100).toFixed(1)}% do volume`:'—'}) —
                          os menores ficaram fora do agrupamento. O Motor Python processa a íntegra.</span>
                      </div>
                    )}

                    {model.clusters.length>1 && (
                      <ClusterQuadrant clusters={model.clusters} focusedId={focusedId} onPick={focusCluster}/>
                    )}

                    <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:360,overflowY:"auto",paddingRight:2}}>
                      {model.clusters.map(c=>(
                        <ClusterCard key={c.id} cluster={c} model={model}
                          focused={focusedId===c.id} onFocus={focusCluster}
                          onViewDashboard={viewClusterInDashboard}/>
                      ))}
                    </div>

                    <div style={{fontSize:10.5,color:"#94a3b8",padding:"8px 10px",borderRadius:8,background:"#f8fafc",border:"1px solid #f1f5f9"}}>
                      🔬 k-means {model.quality?.converged?'convergiu':'parou'} em {model.quality?.iterations} iteraç{model.quality?.iterations!==1?'ões':'ão'}
                      {' '}· features: {model.features.map(f=>f.label).join(', ')}
                      {' '}· seed {model.params?.seed} (determinístico — mesmo resultado em qualquer executor)
                    </div>
                  </div>
                ))}

                {/* ── Passo "Salvar como variável" — nomes editáveis + sugestões ── */}
                {step==='save' && model && clusterModal.save && (()=>{
                  const save = clusterModal.save;
                  const updSave = (patch)=>setClusterModal(m=>({...m,save:{...m.save,...patch,error:null}}));
                  const setLabel = (i,val)=>updSave({labels:save.labels.map((l,j)=>j===i?val:l)});
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>
                      <div style={{fontSize:12,color:"#64748b",lineHeight:1.6}}>
                        A variável vira uma coluna Filtro na base <b>{csvStore[csvId]?.name||csvId}</b> com um valor por
                        cluster. As regras (faixas de valor por dimensão) vêm do agrupamento; você pode
                        renomear tudo agora e editar/mover públicos depois pelo ✏️ no painel.
                      </div>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Nome da variável
                        <input value={save.varName} onChange={e=>updSave({varName:e.target.value})}
                          style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"1.5px solid #ddd6fe",fontSize:13,fontFamily:"inherit",boxSizing:"border-box"}}/>
                      </label>
                      <div>
                        <div style={{fontSize:11.5,color:"#475569",fontWeight:600,marginBottom:6}}>Nome de cada cluster</div>
                        <div style={{display:"flex",flexDirection:"column",gap:7}}>
                          {model.clusters.map((c,i)=>(
                            <div key={c.id} style={{display:"flex",alignItems:"center",gap:8}}>
                              <span style={{width:12,height:12,borderRadius:"50%",background:clusterColor(c.id),flexShrink:0}}/>
                              <input value={save.labels[i]??''} onChange={e=>setLabel(i,e.target.value)}
                                style={{flex:1,padding:"6px 9px",borderRadius:7,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit",boxSizing:"border-box"}}/>
                              <span style={{fontSize:10.5,color:"#94a3b8",flexShrink:0,minWidth:110,textAlign:"right"}}
                                title="Perfil deste cluster">
                                {fmtQty(c.qty)} · {fmtPct(c.approvalRate)} apr · {fmtPct(c.inadInferida??c.inadReal)} inad
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Rótulo para registros fora de todos os clusters
                        <input value={save.unmatched} onChange={e=>updSave({unmatched:e.target.value})}
                          style={{width:"100%",marginTop:4,padding:"7px 9px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit",boxSizing:"border-box"}}/>
                      </label>
                      {model.clusters.length>1 && (model.params?.dims?.length||0)>1 && (
                        <div style={{fontSize:10.5,color:"#94a3b8",lineHeight:1.5,padding:"6px 10px",borderRadius:8,background:"#f8fafc",border:"1px solid #f1f5f9"}}>
                          ℹ Com 2+ dimensões as regras são faixas de valor por dimensão (aproximação editável);
                          para 1 dimensão reproduzem o agrupamento exatamente.
                        </div>
                      )}
                      {save.error && (
                        <div style={{fontSize:11.5,color:"#b91c1c",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"7px 10px"}}>{save.error}</div>
                      )}
                      <div style={{display:"flex",gap:8,justifyContent:"space-between"}}>
                        <button onClick={()=>setClusterModal(m=>({...m,step:'result',save:null}))}
                          style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit"}}>
                          ← Voltar
                        </button>
                        <button onClick={saveClusterVariable}
                          style={{padding:"9px 18px",borderRadius:9,border:"none",background:"#7c3aed",color:"#fff",cursor:"pointer",fontSize:12.5,fontWeight:700,fontFamily:"inherit"}}>
                          ✓ Criar variável
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Confirmação de criação ── */}
                {step==='saved' && (
                  <div style={{display:"flex",flexDirection:"column",gap:14,padding:"8px 0"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,padding:"14px 16px",borderRadius:12,background:"#f0fdf4",border:"1px solid #bbf7d0"}}>
                      <span style={{fontSize:24}}>✅</span>
                      <div style={{fontSize:12.5,color:"#166534",lineHeight:1.5}}>
                        Variável <b>{clusterModal.savedCol}</b> criada! Ela já aparece em <b>Variáveis de Decisão</b> no
                        painel — arraste ao canvas para abrir a política por cluster. Edite ou renomeie a qualquer
                        momento pelo ✏️ no chip.
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                      <button onClick={()=>{const cid=clusterModal.savedCsvId,cc=clusterModal.savedCol;setClusterModal(null);openClusterVarEdit(cid,cc);}}
                        style={{padding:"9px 16px",borderRadius:9,border:"1px solid #ddd6fe",background:"#f5f3ff",color:"#6d28d9",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit"}}>
                        ✏️ Editar regras
                      </button>
                      <button onClick={()=>setClusterModal(null)}
                        style={{padding:"9px 18px",borderRadius:9,border:"none",background:"#7c3aed",color:"#fff",cursor:"pointer",fontSize:12.5,fontWeight:700,fontFamily:"inherit"}}>
                        Concluir
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════ EDITOR DE VARIÁVEL DE CLUSTER (renomear + mover públicos) ═══════════════ */}
      {clusterVarModal&&(()=>{
        const { csvId, col, draft, baseValuesByDim, error, confirmDelete } = clusterVarModal;
        const upd = (patch)=>setClusterVarModal(m=>({...m,...patch,error:null}));
        const setDraft = (nd)=>upd({draft:nd});
        const setLabel = (gid,val)=>setDraft(renameClusterGroup(draft,gid,val));
        const toggle = (dim,value,gid)=>setDraft(toggleValueInGroup(draft,dim,value,gid));
        const membership = clusterMembershipTable(draft, baseValuesByDim);
        const groups = draft.groups||[];
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",backdropFilter:"blur(4px)",
            zIndex:3100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:760,maxHeight:"92vh",
              boxShadow:"0 32px 100px rgba(0,0,0,.28)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
              {/* Header */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 24px",
                borderBottom:"1px solid #e2e8f0",flexShrink:0,background:"linear-gradient(135deg,#f5f3ff 0%,#ede9fe 100%)"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:38,height:38,borderRadius:10,background:"#ddd6fe",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🧩</div>
                  <div>
                    <h2 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:1}}>Editar Variável de Cluster</h2>
                    <p style={{fontSize:11,color:"#6d28d9"}}>Renomeie a variável e os clusters, e mova públicos entre eles</p>
                  </div>
                </div>
                <button onClick={()=>setClusterVarModal(null)}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",cursor:"pointer",
                    fontSize:15,color:"#64748b",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>✕</button>
              </div>

              <div style={{padding:"18px 24px",overflowY:"auto",flex:1,display:"flex",flexDirection:"column",gap:16}}>
                <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                  Nome da variável
                  <input value={draft.col} onChange={e=>setDraft({...draft,col:e.target.value})}
                    style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"1.5px solid #ddd6fe",fontSize:13,fontFamily:"inherit",boxSizing:"border-box"}}/>
                </label>

                <div>
                  <div style={{fontSize:11.5,color:"#475569",fontWeight:600,marginBottom:6}}>Clusters ({groups.length})</div>
                  <div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {groups.map((g,i)=>(
                      <div key={g.id} style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{width:12,height:12,borderRadius:"50%",background:clusterColor(`c${i+1}`),flexShrink:0}}/>
                        <input value={g.label} onChange={e=>setLabel(g.id,e.target.value)}
                          style={{flex:1,padding:"6px 9px",borderRadius:7,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit",boxSizing:"border-box"}}/>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div style={{fontSize:11.5,color:"#475569",fontWeight:600,marginBottom:2}}>Composição dos clusters</div>
                  <p style={{fontSize:10.5,color:"#94a3b8",lineHeight:1.5,marginBottom:8}}>
                    Marque em qual cluster cada valor entra. Desmarcar em um e marcar em outro = mover o público.
                    Um valor sem nenhum cluster marcado cai em <b>{draft.unmatchedLabel}</b>.
                  </p>
                  <div style={{display:"flex",flexDirection:"column",gap:12}}>
                    {membership.map(dm=>(
                      <div key={dm.col} style={{border:"1px solid #f1f5f9",borderRadius:10,overflow:"hidden"}}>
                        <div style={{padding:"7px 12px",background:"#f8fafc",fontSize:11,fontWeight:700,color:"#475569",textTransform:"uppercase",letterSpacing:.4,borderBottom:"1px solid #f1f5f9"}}>
                          {dm.col} <span style={{fontWeight:400,color:"#94a3b8"}}>· {dm.values.length} valor{dm.values.length!==1?'es':''}</span>
                        </div>
                        <div style={{maxHeight:210,overflowY:"auto"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11.5}}>
                            <thead>
                              <tr style={{position:"sticky",top:0,background:"#fff",boxShadow:"0 1px 0 #f1f5f9"}}>
                                <th style={{textAlign:"left",padding:"6px 10px",color:"#94a3b8",fontWeight:600}}>Valor</th>
                                {groups.map((g,i)=>(
                                  <th key={g.id} title={g.label} style={{padding:"6px 6px",color:clusterColor(`c${i+1}`),fontWeight:700,textAlign:"center",whiteSpace:"nowrap",maxWidth:96,overflow:"hidden",textOverflow:"ellipsis"}}>
                                    {g.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {dm.values.map(row=>{
                                const inSet = new Set(row.groupIds);
                                const orphan = inSet.size===0;
                                return (
                                  <tr key={row.value} style={{borderTop:"1px solid #f8fafc",background:orphan?"#fffbeb":"transparent"}}>
                                    <td style={{padding:"5px 10px",color:"#334155",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                                      title={orphan?`${row.value||'(vazio)'} — fora dos clusters`:(row.value||'(vazio)')}>
                                      {row.value===''?'(vazio)':row.value}{orphan?' ⚠':''}
                                    </td>
                                    {groups.map(g=>(
                                      <td key={g.id} style={{padding:"5px 6px",textAlign:"center"}}>
                                        <input type="checkbox" checked={inSet.has(g.id)}
                                          onChange={()=>toggle(dm.col,row.value,g.id)}
                                          style={{cursor:"pointer",width:15,height:15}}/>
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {error && (
                  <div style={{fontSize:11.5,color:"#b91c1c",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"7px 10px"}}>{error}</div>
                )}
              </div>

              {/* Footer */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"12px 24px",borderTop:"1px solid #e2e8f0",flexShrink:0}}>
                {confirmDelete ? (
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11.5,color:"#b91c1c"}}>Excluir a variável?</span>
                    <button onClick={deleteClusterVariable}
                      style={{padding:"7px 12px",borderRadius:8,border:"none",background:"#dc2626",color:"#fff",cursor:"pointer",fontSize:11.5,fontWeight:700,fontFamily:"inherit"}}>Sim, excluir</button>
                    <button onClick={()=>upd({confirmDelete:false})}
                      style={{padding:"7px 12px",borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:11.5,fontWeight:600,fontFamily:"inherit"}}>Cancelar</button>
                  </div>
                ) : (
                  <button onClick={()=>upd({confirmDelete:true})}
                    style={{padding:"8px 12px",borderRadius:8,border:"1px solid #fecaca",background:"#fff1f2",color:"#e11d48",cursor:"pointer",fontSize:11.5,fontWeight:600,fontFamily:"inherit"}}>
                    🗑 Excluir variável
                  </button>
                )}
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setClusterVarModal(null)}
                    style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit"}}>
                    Cancelar
                  </button>
                  <button onClick={saveClusterVarEdit}
                    style={{padding:"9px 18px",borderRadius:9,border:"none",background:"#7c3aed",color:"#fff",cursor:"pointer",fontSize:12.5,fontWeight:700,fontFamily:"inherit"}}>
                    ✓ Salvar
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════ POLICY LIBRARY MODAL — templates de PolicyIR (Copiloto Sessão 2) ═══════════════ */}
      {policyLibraryModal&&(()=>{
        const { mode, search, saveMeta, overwriteId } = policyLibraryModal;
        const upd = (patch) => setPolicyLibraryModal(prev => ({ ...prev, ...patch }));
        const updMeta = (patch) => setPolicyLibraryModal(prev => ({ ...prev, saveMeta: { ...prev.saveMeta, ...patch } }));
        const isSaveMode = mode === 'save';
        const filteredItems = policyLibrary.filter(it => {
          if (!search.trim()) return true;
          const q = search.toLowerCase();
          return it.name.toLowerCase().includes(q)
            || (it.description || '').toLowerCase().includes(q)
            || (it.tags || []).some(t => t.toLowerCase().includes(q))
            || (it.requiredVars || []).some(v => v.col.toLowerCase().includes(q));
        });
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.5)",backdropFilter:"blur(4px)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:18,width:"100%",maxWidth:isSaveMode?520:700,maxHeight:"88vh",boxShadow:"0 24px 80px rgba(0,0,0,.22)",display:"flex",flexDirection:"column",overflow:"hidden"}}>

              {/* Header */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 28px 16px",borderBottom:"1px solid #f1f5f9",flexShrink:0}}>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:40,height:40,borderRadius:11,background:"#eef2ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{isSaveMode?'💾':'📚'}</div>
                  <div>
                    <h3 style={{fontSize:16,fontWeight:700,color:"#1e293b",marginBottom:2}}>{isSaveMode ? 'Salvar Política na Biblioteca' : 'Biblioteca de Políticas'}</h3>
                    <p style={{fontSize:12,color:"#94a3b8"}}>{isSaveMode ? "Salva o fluxo do canvas ativo como template reutilizável (JSON canônico da política)" : `${policyLibrary.length} política${policyLibrary.length!==1?'s':''} salva${policyLibrary.length!==1?'s':''}`}</p>
                  </div>
                </div>
                <button onClick={()=>setPolicyLibraryModal(null)}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",color:"#94a3b8",cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>×</button>
              </div>

              {isSaveMode ? (
                /* ── Save mode ── */
                <div style={{padding:"20px 28px",display:"flex",flexDirection:"column",gap:16,overflowY:"auto"}}>
                  <div>
                    <label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:6}}>Nome *</label>
                    <input value={saveMeta.name} onChange={e=>updMeta({name:e.target.value})}
                      placeholder="Ex: Política de entrada PF"
                      style={{width:"100%",padding:"9px 12px",borderRadius:9,border:"1.5px solid #e2e8f0",fontSize:13,fontFamily:"inherit",boxSizing:"border-box",outline:"none"}}/>
                  </div>
                  <div>
                    <label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:6}}>Descrição</label>
                    <textarea value={saveMeta.description} onChange={e=>updMeta({description:e.target.value})}
                      placeholder="Descreva o objetivo e contexto desta política…"
                      rows={3}
                      style={{width:"100%",padding:"9px 12px",borderRadius:9,border:"1.5px solid #e2e8f0",fontSize:13,fontFamily:"inherit",boxSizing:"border-box",resize:"vertical",outline:"none"}}/>
                  </div>
                  <div>
                    <label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:6}}>Tags <span style={{fontWeight:400,color:"#94a3b8"}}>(separadas por vírgula)</span></label>
                    <input value={saveMeta.tags} onChange={e=>updMeta({tags:e.target.value})}
                      placeholder="Ex: PF, entrada, varejo"
                      style={{width:"100%",padding:"9px 12px",borderRadius:9,border:"1.5px solid #e2e8f0",fontSize:13,fontFamily:"inherit",boxSizing:"border-box",outline:"none"}}/>
                  </div>
                  {policyLibrary.length > 0 && (
                    <div>
                      <label style={{fontSize:12,fontWeight:600,color:"#475569",display:"block",marginBottom:6}}>Sobrescrever política existente <span style={{fontWeight:400,color:"#94a3b8"}}>(opcional)</span></label>
                      <select value={overwriteId??''} onChange={e=>upd({overwriteId:e.target.value||null})}
                        style={{width:"100%",padding:"9px 12px",borderRadius:9,border:"1.5px solid #e2e8f0",fontSize:13,fontFamily:"inherit",background:"#fff",outline:"none"}}>
                        <option value="">— Salvar como nova —</option>
                        {policyLibrary.map(it=>(<option key={it.id} value={it.id}>{it.name}</option>))}
                      </select>
                    </div>
                  )}
                  <div style={{padding:"10px 12px",borderRadius:9,background:"#f8fafc",border:"1px solid #f1f5f9",fontSize:11.5,color:"#64748b",lineHeight:1.5}}>
                    Salva a estrutura da política (nós, rotas, regras) do canvas ativo — sem dados linha a linha nem posições. {shapes.length===0 ? '⚠ O canvas ativo está vazio.' : `${shapes.filter(s=>['decision','cineminha','decision_lens'].includes(s.type)).length} nó(s) de decisão no canvas ativo.`}
                  </div>
                </div>
              ) : (
                /* ── Browse mode ── */
                <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0}}>
                  <div style={{padding:"14px 28px 12px",borderBottom:"1px solid #f1f5f9",flexShrink:0,display:"flex",gap:10,alignItems:"center"}}>
                    <input value={search} onChange={e=>upd({search:e.target.value})}
                      placeholder="Buscar por nome, tag, variável…"
                      style={{flex:1,padding:"8px 12px",borderRadius:9,border:"1.5px solid #e2e8f0",fontSize:13,fontFamily:"inherit",outline:"none"}}/>
                    <button onClick={()=>upd({mode:'save',saveMeta:{name:canvases[activeCanvasId]?.name||'Política',description:'',tags:''},overwriteId:null})}
                      disabled={shapes.length===0}
                      title={shapes.length===0?"Canvas ativo vazio":"Salvar o canvas ativo como novo template"}
                      style={{padding:"7px 14px",borderRadius:8,border:"1px solid #bbf7d0",background:shapes.length===0?"#f8fafc":"#f0fdf4",color:shapes.length===0?"#cbd5e1":"#15803d",cursor:shapes.length===0?"not-allowed":"pointer",fontSize:11.5,fontFamily:"inherit",fontWeight:600,whiteSpace:"nowrap"}}>
                      💾 Salvar atual
                    </button>
                  </div>

                  <div style={{flex:1,overflowY:"auto",padding:"12px 28px"}}>
                    {filteredItems.length === 0 ? (
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"48px 0",gap:12,color:"#94a3b8"}}>
                        <div style={{fontSize:40}}>{policyLibrary.length===0?'📭':'🔍'}</div>
                        <div style={{fontSize:14,fontWeight:600}}>{policyLibrary.length===0?'Biblioteca vazia':'Nenhum resultado'}</div>
                        <div style={{fontSize:12,textAlign:"center",maxWidth:280}}>
                          {policyLibrary.length===0
                            ? 'Monte um fluxo no canvas e clique em "💾 Salvar atual" para adicionar à biblioteca.'
                            : 'Tente ajustar a busca.'}
                        </div>
                      </div>
                    ) : (
                      <div style={{display:"flex",flexDirection:"column",gap:10}}>
                        {filteredItems.map(item => {
                          const tags = item.tags || [];
                          const reqVars = item.requiredVars || [];
                          const nodeCount = (item.ir?.nodes || []).length;
                          return (
                            <div key={item.id}
                              style={{border:"1.5px solid #e2e8f0",borderRadius:12,padding:"14px 16px",display:"flex",gap:14,alignItems:"flex-start",background:"#fafafa"}}>
                              <div style={{width:36,height:36,borderRadius:9,background:"#eef2ff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>📚</div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                                  <span style={{fontSize:13.5,fontWeight:700,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</span>
                                  <span style={{fontSize:10.5,fontWeight:600,padding:"2px 7px",borderRadius:99,background:"#f1f5f9",color:"#64748b",flexShrink:0}}>{nodeCount} nó{nodeCount!==1?'s':''}</span>
                                </div>
                                {item.description&&(
                                  <div style={{fontSize:11.5,color:"#64748b",marginBottom:5,lineHeight:1.4}}>{item.description}</div>
                                )}
                                {tags.length>0&&(
                                  <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:reqVars.length?5:0}}>
                                    {tags.map(t=>(<span key={t} style={{fontSize:10,padding:"2px 7px",borderRadius:99,background:"#f1f5f9",color:"#64748b",border:"1px solid #e2e8f0"}}>{t}</span>))}
                                  </div>
                                )}
                                {reqVars.length>0&&(
                                  <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                                    {reqVars.map(v=>(
                                      <span key={v.col} style={{fontSize:10,padding:"2px 7px",borderRadius:99,background:v.kind==='decision'?"#eff6ff":"#f5f3ff",color:v.kind==='decision'?"#3b82f6":"#7c3aed",border:`1px solid ${v.kind==='decision'?"#bfdbfe":"#ddd6fe"}`}}>{v.col}</span>
                                    ))}
                                  </div>
                                )}
                                <div style={{fontSize:10,color:"#cbd5e1",marginTop:5}}>Salvo em {new Date(item.savedAt).toLocaleDateString('pt-BR')}</div>
                              </div>
                              <div style={{display:"flex",flexDirection:"column",gap:6,flexShrink:0}}>
                                <button onClick={()=>openPolicyApplyModal(item)}
                                  title="Abre o mapeamento de variáveis e aplica no canvas ativo"
                                  style={{padding:"6px 14px",borderRadius:7,border:"1px solid #c7d2fe",background:"#eef2ff",color:"#4f46e5",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",fontWeight:600,whiteSpace:"nowrap"}}>
                                  ▶ Aplicar
                                </button>
                                <button onClick={()=>deletePolicyFromLibrary(item.id)}
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
                    <button onClick={savePolicyToLibrary} disabled={!saveMeta.name.trim()||shapes.length===0}
                      style={{padding:"9px 22px",borderRadius:9,border:"none",background:(saveMeta.name.trim()&&shapes.length>0)?"#4f46e5":"#c7d2fe",color:"#fff",cursor:(saveMeta.name.trim()&&shapes.length>0)?"pointer":"not-allowed",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>
                      {overwriteId ? '🔄 Substituir' : '💾 Salvar na Biblioteca'}
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                      <span style={{fontSize:11.5,color:"#94a3b8"}}>{filteredItems.length} resultado{filteredItems.length!==1?'s':''}</span>
                      <button onClick={()=>policyLibFileInputRef.current?.click()}
                        style={{padding:"6px 13px",borderRadius:7,border:"1px solid #e2e8f0",background:"#f8fafc",color:"#475569",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",fontWeight:500,display:"flex",alignItems:"center",gap:5}}>
                        ↑ Importar Biblioteca
                      </button>
                      {policyLibrary.length > 0 && (
                        <button onClick={exportPolicyLibrary}
                          style={{padding:"6px 13px",borderRadius:7,border:"1px solid #e2e8f0",background:"#f8fafc",color:"#475569",cursor:"pointer",fontSize:11.5,fontFamily:"inherit",fontWeight:500,display:"flex",alignItems:"center",gap:5}}>
                          ↓ Exportar Biblioteca
                        </button>
                      )}
                    </div>
                    <button onClick={()=>setPolicyLibraryModal(null)}
                      style={{padding:"8px 20px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
                      Fechar
                    </button>
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

      {/* H0 — painel dev de telemetria local de custo (?debug=perf) */}
      {debugPerf && <PerfDebugPanel telemetryRef={perfTelemetryRef} />}
    </div>
  );
}
