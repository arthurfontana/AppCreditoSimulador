import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList, ScatterChart, Scatter, ZAxis, Cell } from "recharts";
// Armazenamento colunar do csvStore (Otimização de Memória — Fase 1). O csvStore
// guarda as bases vetorizadas (Float64Array + dictionary encoding); todo acesso a
// célula passa pelo accessor abaixo, que também funciona sobre o legado string[][].
import { buildColumnar, isColumnar, rowCount, cellStr, cellNum, getRow, distinctColValues, serializeCsvStore, deserializeCsvStore, buildCsvStoreMessage, METRIC_COL_TYPES, parseCSVToColumnarAsync, finalizeImportedColumns, deriveMappedDictColumn, deriveClusterColumn, deriveRangeColumn, retypeColumn, codesCtorForDict, estimateColumnarRamBytes, estimateCsvStoreRamBytes, estimateCsvStoreRowCount, formatRamBytes, RAM_COMFORT_BYTES, ROW_COMFORT_COUNT } from "./columnar.js";
import { applyGoalSeekMoves } from "./goalSeek.js";
import { applySimplifyCandidates } from "./policySimplify.js";
// Variável de Cluster (interpretação da Clusterização H8 — vira coluna Filtro derivada,
// editável, arrastável ao canvas). Módulo puro compartilhado (materialização em columnar.js).
import { suggestClusterVarName, suggestClusterLabels, buildClusterDefFromModel, isClusterVar, renameClusterGroup, toggleValueInGroup, clusterMembershipTable, renameClusterColumnRefs, renameClusterLabelRefs } from "./clusterVar.js";
// Variável de Faixas (interpretação do Criar Faixas por Risco — vira coluna Filtro ORDINAL
// derivada, espelho exato da Variável de Cluster acima). Módulo puro compartilhado
// (materialização deriveRangeColumn em columnar.js; propagação de refs REUSA
// renameClusterColumnRefs/renameClusterLabelRefs, DEC-FR-009).
import { suggestRangeVarName, buildRangeDefFromModel, formatBandLabel, isRangeVar, editRangeCuts, renameRangeBand } from "./rangeVar.js";
// Heurística de variável (temporal/score por nome) + parse temporal — módulo folha
// compartilhado com o worker (Explorar a Base, DEC-EB-008). `parseTemporalKey` é
// re-exportado abaixo para os consumidores que ainda o importam de App.jsx (analytics.js).
import { segVarDefaultReason, parseTemporalKey } from "./segVar.js";
export { parseTemporalKey };
// Explorar a Base (Épico EB, EB2) — layout default da aba, puro (buildDefaultExploreLayout).
import { buildDefaultExploreLayout, computeFirstBranchPosition } from "./explore.js";
// Execução Híbrida H4/H6 — ComputeRouter (fronteira única worker/sidecar, DEC-HX-002)
// + funções puras de UX do motor (badge, degradação declarada, aviso de fallback).
import { createComputeRouter, createWorkerProvider, createSidecarProvider, describeComputeBadge, describeCapabilitiesDetail, ceilingNotice, fallbackNoticeText, hashChunks } from "./computeRouter.js";
// Analytics Workspace (aba Dashboard) — helpers globais puros + constantes extraídos para
// ./analytics.js (lote C4). Importados aqui para uso no componente e re-exportados abaixo
// para os testes que ainda importam de App.jsx (tests/analytics.test.js). Dependência
// circular App.jsx ⇄ analytics.js: analytics.js só usa uid/parseTemporalKey/matchLensRule/
// LENS_OP_LABEL (exportados abaixo) dentro de corpos de função, então resolve em runtime.
import {
  buildAnalyticsCSV, buildAnalyticsCSVParts, computeWidgetMetric, pivotWidget,
  applyAnalyticsFilters, applyFiltersToDataset, describeFilterCards,
  distinctDimValues, autoBuckets, applyGroupingsToDataset, resolveKpiScenarios,
  CHART_TYPES, GOOD_WHEN_LOWER, MAX_SERIES, SERIE_COLORS,
  SERIE_CENARIO, SERIE_NONE, XDIM_CENARIO, GROUPING_OTHER_DEFAULT,
} from "./analytics.js";
export {
  buildAnalyticsCSV, computeWidgetMetric, pivotWidget,
  applyAnalyticsFilters, applyFiltersToDataset, describeFilterCards,
  distinctDimValues, autoBuckets, applyGroupingsToDataset, resolveKpiScenarios,
};
// PolicyIR — helpers globais puros da representação canônica da política, extraídos para
// ./policyIR.js (lote C4). Importados aqui para uso no componente (Exportar Fluxo,
// Biblioteca de Políticas, Documentação Automática) e re-exportados abaixo para os testes
// que ainda importam de App.jsx (tests/policyIR.test.js, tests/policyTemplates.test.js,
// tests/policyDoc.test.js). Dependência circular App.jsx ⇄ policyIR.js: policyIR.js só usa
// uid/SW/SH/CINEMINHA_TYPES/getCinemaType/LENS_W/LENS_H/computeCinemaSize/isCellEligible
// (exportados abaixo) dentro de corpos de função, então resolve em runtime.
import {
  buildPolicyIR, applyPolicyPatch, extractPolicyRequiredVars,
  applyPolicyVarMapping, diffPolicyIR, POLICY_TERMINAL_LABELS,
} from "./policyIR.js";
export {
  buildPolicyIR, applyPolicyPatch, extractPolicyRequiredVars,
  applyPolicyVarMapping, diffPolicyIR,
};
// Renderers da Documentação Automática (Copiloto Sessão 6) — camada de apresentação PURA
// do docModel/PolicyIR já montado, extraída para ./policyDocRender.js (lote C4). Importados
// aqui para uso no componente (docModal: prévia/download/print) e re-exportados abaixo para
// os testes que ainda importam de App.jsx (tests/policyDoc.test.js). Dependência circular
// App.jsx ⇄ policyDocRender.js: o módulo só usa fmtQty/fmtPct/BUILD_NUMBER/BUILD_HASH/
// COL_TYPES/LENS_OP_LABEL/escHtml (exportados abaixo) dentro de corpos de função, então
// resolve em runtime (mesmo padrão de analytics.js/policyIR.js).
import { renderDocMarkdown, renderDocHTML } from "./policyDocRender.js";
export { renderDocMarkdown, renderDocHTML };
// Reorganização Automática do Canvas (Auto Layout) — cálculo PURO das posições de
// destino (camadas Sugiyama + portas + parking), extraído para ./autoLayout.js (lote C4).
// A animação por RAF + pushHistory/setShapes fica no componente (closure). Dependência
// circular App.jsx ⇄ autoLayout.js: o módulo só usa trunc/CONN_LABEL_MAX/CONN_LABEL_CW/
// estConnLabelW/fmtQty/fmtPct (exportados abaixo/adiante) dentro de corpos de função,
// então resolve em runtime (mesmo padrão de analytics.js/policyIR.js/policyDocRender.js).
import { computeAutoLayout } from "./autoLayout.js";

// Componentes React da aba Dashboard e dos cards do Copiloto (Segmentos/Clusters), extraídos
// para ./dashboardComponents.jsx (lote C4). Importados aqui para uso na árvore JSX do App e
// nos modais do Copiloto; newFilterCard re-exportada para compatibilidade. Dependência circular
// App.jsx ⇄ dashboardComponents.jsx: o módulo só usa fmtQty/fmtPct/uid/escHtml/LENS_OPERATORS/
// exportAnalyticsDatasetCSV (exportados por App.jsx) em corpos de função/render — resolve em runtime.
import {
  AnalysisTab, ExploreTab, SegmentFindingCard, DiagnosticsStrip, SegmentQuadrant,
  ClusterQuadrant, GoalSeekFrontierChart, ClusterCard, clusterColor, fmtPP, newFilterCard,
} from "./dashboardComponents.jsx";
export { newFilterCard };
// Feed de Próxima Melhor Ação (Jornada NB, Sessão NB2) — templates de prosa pt-BR sobre o
// NextActionsModel do worker (mesmo contrato de src/exploreInsights.js, DEC-NB-007).
import {
  describeAction, describeWhyItMatters, severityLabel, ctaLabel, formatActionDelta,
} from "./nextActionInsights.js";
// Etapas da Política + Checklist de Prontidão (Jornada EP, Sessão EP1/EP2) — motor puro
// compartilhado main/worker/teste (DEC-EP-001..006). A main chama os detectores direto
// (custo estrutural barato, mesmo debounce do feed NB) — não precisa de round-trip ao worker.
import {
  detectJourneyStages, computeReadiness, STAGE_IDS, READINESS_CRITERIA_IDS,
  ACTION_KIND_STAGE, stageForActionKind,
} from "./policyJourney.js";

// ═══ REGIÃO: Constantes e Helpers Globais ═══
// ── Build metadata (injected by Vite at build time) ──────────────────────────
// Versão do schema de Projeto (.credito.json) — fonte única para buildProjectPayload e para
// a tabela "Versão do schema" da seção ℹ️ Sobre do Hub (evita os dois textos divergirem,
// como aconteceu entre a Sessão 5, que fixou "3.0" na Sobre, e a Sessão 6, que bumpou o
// schema real para "3.1" sem atualizar aquele texto). 3.2 (Épico EB, EB2) — novo campo de
// topo `exploreLayouts` (layout da aba Explorar, por csvId). 3.3 (Épico EB, EB4) — novos
// campos de topo `exploreGroupings`/`explorePageFilters` (builder livre da aba Explorar,
// por csvId). 3.4 (Épico NB, Sessão NB2) — novo campo de topo `nextActionsPrefs`
// (descartados/adiados do Feed de Próxima Melhor Ação, DEC-NB-006); a wiki (Jornada-
// Prompts-Sessoes.md) previa "3.3" para esta sessão, mas o Épico EB (EB4) já havia
// consumido "3.3" antes desta sessão rodar — bump real é sequencial sobre o schema atual.
// 3.5 (Épico EP, Sessão EP2) — novo campo de topo `journeyState` (override manual por etapa
// do trilho + config do Checklist de Prontidão + colapso do trilho, DEC-EP-006); a wiki
// previa "3.4" para esta sessão, mas o Épico NB (NB2) já havia consumido "3.4".
export const PROJECT_SCHEMA_VERSION = "3.5";
export const BUILD_NUMBER = typeof __BUILD_NUMBER__ !== "undefined" ? __BUILD_NUMBER__ : "dev";
const BUILD_TIME   = typeof __BUILD_TIME__   !== "undefined" ? __BUILD_TIME__   : new Date().toISOString();
export const BUILD_HASH   = typeof __BUILD_HASH__   !== "undefined" ? __BUILD_HASH__   : "local";
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

// ── InfoDot — "ⓘ" pedagógico para indicadores estatísticos (WoE, IV, p-value, PSI, …) ──
// Convenção do app (CLAUDE.md § Indicadores estatísticos): todo indicador estatístico
// exibido na UI ganha este selo com uma explicação em português simples de como
// interpretá-lo — o estagiário lê o texto no hover, o analista sênior ignora o selo de
// 14px e segue direto para o número. Tooltip nativo (`title`) — mesmo padrão já usado no
// Goal Seek (📍 Ponto de partida), agora extraído para reuso.
function InfoDot({ text }) {
  return (
    <span title={text} tabIndex={0}
      style={{fontSize:10,color:"#94a3b8",cursor:"help",border:"1px solid #cbd5e1",borderRadius:"50%",
        width:14,height:14,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,
        lineHeight:1,fontFamily:"inherit"}}>
      ⓘ
    </span>
  );
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
function ComputeEngineBadge({ enabled, status, checking, onRecheck, onClick, title }) {
  const [tip, setTip] = useState(false);
  const badge = describeComputeBadge(enabled, status);
  const detailLines = describeCapabilitiesDetail(status);
  const tone = COMPUTE_BADGE_TONE[badge.tone] || COMPUTE_BADGE_TONE.off;

  return (
    <div style={{position:"relative",display:"inline-flex",alignItems:"center"}}
      onMouseEnter={()=>setTip(true)} onMouseLeave={()=>setTip(false)}>
      <span
        onClick={onClick || onRecheck}
        title={title || "Clique para verificar a conexão com o Motor Python"}
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
  COMPUTE_NEXT_ACTIONS:      'NEXT_ACTIONS_RESULT',
  COMPUTE_FEED_OPPORTUNITIES:'FEED_OPPORTUNITIES_RESULT',
  COMPUTE_VARIABLE_RANKING:  'VARIABLE_RANKING_RESULT',
  COMPUTE_BASE_PROFILE:      'BASE_PROFILE_RESULT',
  COMPUTE_EXPLORE_DATASET:   'EXPLORE_DATASET_RESULT',
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
export const uid = () => `e${_id++}`;

// ── Constants ────────────────────────────────────────────────────────────────
export const SW = 144, SH = 82;
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
export const CINEMINHA_TYPES = {
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
export const getCinemaType = (cinemaType) => CINEMINHA_TYPES[cinemaType] ?? CINEMINHA_TYPES.eligibility;

// ── Decision Lens constants ───────────────────────────────────────────────────
export const LENS_W = 182, LENS_H = 86;
export const LENS_OPERATORS = [
  { value:"equal",    label:"Igual a"             },
  { value:"notEqual", label:"Diferente de"         },
  { value:"in",       label:"Está em uma lista"    },
  { value:"notIn",    label:"Não está em uma lista"},
  { value:"lt",       label:"Menor que"            },
  { value:"lte",      label:"Menor ou igual a"     },
  { value:"gt",       label:"Maior que"            },
  { value:"gte",      label:"Maior ou igual a"     },
];
// Rótulo por operador de Lens — usado por describeLensRule (renderers da Documentação
// Automática, ./policyDocRender.js) e pelo Analytics Workspace (./analytics.js). Mantido
// em App.jsx (importado por ambos os módulos extraídos) por depender de LENS_OPERATORS.
export const LENS_OP_LABEL = Object.fromEntries(LENS_OPERATORS.map(o => [o.value, o.label]));

export const COL_TYPES = [
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

// parseTemporalKey / MONTH_ABBR migraram para ./segVar.js (módulo folha compartilhado
// com o worker — Explorar a Base, DEC-EB-008); importados e re-exportados no topo.

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

// segVarDefaultReason (heurística temporal/score por nome de coluna) migrou para
// ./segVar.js (módulo folha compartilhado com o worker — Copiloto Sessão 10 + Explorar a
// Base, DEC-EB-008); importado no topo. Tokens inalterados (contrato).

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
export const trunc = (s, n) => s && s.length > n ? s.slice(0,n-1)+"…" : s;
// Estimativa de largura do label da seta (DM Sans ~11px) — usada para
// dimensionar a caixa do label e o vão nó↔ports no autoLayout.
export const CONN_LABEL_CW = 6.6;   // avanço médio por caractere
export const CONN_LABEL_MAX = 16;   // máximo de chars exibidos no label da seta
export const estConnLabelW = (s) => {
  const t = trunc(s || "", CONN_LABEL_MAX);
  return t ? t.length * CONN_LABEL_CW : 0;
};
export const fmtQty = (n) => n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}k` : Number.isInteger(n) ? String(n) : n.toFixed(1);
export const fmtPct = (v) => v === null ? "N/A" : `${(v * 100).toFixed(2)}%`;

// ── Criar Faixas por Risco (DEC-FR-004/008) — aproximação em MAIN da detecção de
// coluna contínua do worker (isContinuousColumn, mesmos tetos), só para filtrar/avisar
// no formulário (dims do cluster, coluna do rangeModal) sem round-trip ao worker; a
// palavra final é sempre do RangeModel (`not_numeric`), nunca escondida.
const RANGE_MIN_DISTINCT_UI = 30, RANGE_MIN_PARSE_UI = 0.90;
function isContinuousColumnUI(csv, col) {
  if (!csv || col == null) return false;
  if ((csv.columnTypes || {})[col] !== 'decision') return false;
  const colIdx = (csv.headers || []).indexOf(col);
  if (colIdx < 0) return false;
  if (distinctColValues(csv, colIdx).length < RANGE_MIN_DISTINCT_UI) return false;
  const n = rowCount(csv);
  const qtyIdx = (csv.headers || []).findIndex(h => (csv.columnTypes || {})[h] === 'qty');
  let totalQty = 0, okQty = 0;
  for (let r = 0; r < n; r++) {
    const q = qtyIdx >= 0 ? (cellNum(csv, r, qtyIdx) || 0) : 1;
    totalQty += q;
    if (Number.isFinite(cellNum(csv, r, colIdx))) okQty += q;
  }
  return totalQty > 0 && (okQty / totalQty) >= RANGE_MIN_PARSE_UI;
}

// Cacheia a lista de colunas contínuas POR OBJETO csv (WeakMap — csvStore só troca a
// referência quando os dados mudam de fato): evita repetir o scan O(linhas) de
// isContinuousColumnUI por coluna a cada re-render do formulário (ex.: cada tecla do
// piso de volume).
const _continuousColsCache = new WeakMap();
function continuousColumnsOf(csv) {
  if (!csv) return [];
  let cached = _continuousColsCache.get(csv);
  if (!cached) {
    cached = (csv.headers || []).filter(h => isContinuousColumnUI(csv, h));
    _continuousColsCache.set(csv, cached);
  }
  return cached;
}

// Agregação O(distintos)-leve por faixa (label→{qty,rate}) sobre a def em edição, para
// o "ao vivo" do rangeVarModal (DEC-FR-009) — mesma leveza de deriveRangeColumn, sem
// duplicar a DP/IV do worker (isto só soma qty/num/den por rótulo já materializado).
function computeBandLiveStats(csv, def) {
  if (!csv || !def) return {};
  const colData = deriveRangeColumn(csv, def);
  const n = rowCount(csv);
  const headers = csv.headers || [];
  const typeIdx = (t) => headers.findIndex(h => (csv.columnTypes || {})[h] === t);
  const qtyIdx = typeIdx('qty');
  const metricId = def?.metric?.id === 'inadInferida' ? 'inadInferida' : 'inadReal';
  const numIdx = typeIdx(metricId);
  const denIdx = typeIdx(metricId === 'inadInferida' ? 'qtdAltasInfer' : 'qtdAltas');
  const stats = {};
  for (let r = 0; r < n; r++) {
    const label = colData.dict[colData.codes[r]];
    const s = stats[label] || (stats[label] = { qty: 0, num: 0, den: 0 });
    s.qty += qtyIdx >= 0 ? (cellNum(csv, r, qtyIdx) || 0) : 1;
    s.num += numIdx >= 0 ? (cellNum(csv, r, numIdx) || 0) : 0;
    s.den += denIdx >= 0 ? (cellNum(csv, r, denIdx) || 0) : 0;
  }
  const totalQty = Object.values(stats).reduce((a, s) => a + s.qty, 0) || 1;
  const out = {};
  for (const [label, s] of Object.entries(stats)) {
    out[label] = { qty: s.qty, share: s.qty / totalQty, rate: s.den > 0 ? s.num / s.den : null };
  }
  return out;
}

// Direção monotônica das taxas por faixa, em ordem (ignora nulls) — usada pelo selo
// recalculado do rangeVarModal após edição de cortes (DEC-FR-009).
function bandRatesMonotonicDir(rates) {
  const vs = rates.filter(v => v != null);
  if (vs.length < 2) return null;
  let inc = true, dec = true;
  for (let i = 1; i < vs.length; i++) {
    if (vs[i] < vs[i - 1]) inc = false;
    if (vs[i] > vs[i - 1]) dec = false;
  }
  return inc ? 'inc' : (dec ? 'dec' : null);
}
// Escapa texto para interpolação segura em HTML — usado pela exportação do Dashboard
// (exportDashboardPDF) e pelos renderers da Documentação Automática (./policyDocRender.js,
// que o importa daqui). Mantido em App.jsx por ser util geral compartilhado.
export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
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

export function computeCinemaSize(rowDomain, colDomain) {
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
export function matchLensRule(cellVal, operator, ruleVal) {
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

// Helpers puros do Analytics Workspace (accessors do dataset largo colunar, export CSV,
// buildAnalyticsCSVParts) foram extraídos para ./analytics.js (lote C4) e importados no topo.

export function exportAnalyticsDatasetCSV(ds) {
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

export function isCellEligible(cells, key) {
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

// Volume total que chega a um losango/Cineminha, a partir do `nodeArrivals[shape.id]`
// já computado pelo worker (val/row/col) — mesma regra de `totalArrivalOf` em
// simulation.worker.js (Simplificação): losango soma todos os valores; Cineminha soma
// o eixo configurado (o maior dos dois quando linha e coluna estão configuradas, já
// que descrevem a MESMA população por ângulos diferentes). Usado pela Status Bar
// (indicador "volume no nó selecionado") — leitura pura, não muda nenhuma matemática.
function totalNodeArrival(shape, arr) {
  if (!arr) return null;
  if (shape.type === 'decision') return Object.values(arr.val || {}).reduce((a, b) => a + b, 0);
  if (shape.type === 'cineminha') {
    const rowSum = Object.values(arr.row || {}).reduce((a, b) => a + b, 0);
    const colSum = Object.values(arr.col || {}).reduce((a, b) => a + b, 0);
    if (shape.rowVar && shape.colVar) return Math.max(rowSum, colSum);
    if (shape.rowVar) return rowSum;
    if (shape.colVar) return colSum;
    return 0;
  }
  return null;
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

// ── Analytics Workspace (Sessão 2: builder configurável) ─────────────────────
// Constantes de série/gráfico (SCENARIO_COLORS, SERIE_COLORS, MAX_SERIES, SERIE_CENARIO,
// SERIE_NONE, XDIM_CENARIO, CHART_TYPES, GOOD_WHEN_LOWER) foram extraídas para ./analytics.js
// (lote C4) e importadas no topo. Os componentes React do Dashboard (e AW_DRAG_MIME) foram
// para ./dashboardComponents.jsx (lote C4) — importados/re-exportados no topo do App.jsx.

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

// Copiloto — Feed de Próxima Melhor Ação (Jornada NB, Sessão NB2, DEC-NB-005). Estilo por
// classe de severidade do card (`action.severity` do NextActionsModel — DEC-NB-004: blocker
// > opportunity > hygiene > journey). Substitui o antigo COPILOT_SEV_META (lint isolado,
// Sessão 1) — o lint agora entra no feed como cards `fix_lint_*`/`connect_port`.
const NEXT_ACTION_SEV_META = {
  blocker:     { emoji: "🔴", color: "#b91c1c", bg: "#fef2f2", border: "#fecaca" },
  opportunity: { emoji: "🟢", color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
  hygiene:     { emoji: "🟡", color: "#92400e", bg: "#fffbeb", border: "#fde68a" },
  journey:     { emoji: "🔵", color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
};

// Etapas da Política (Jornada EP, Sessão EP2, DEC-EP-001/004) — metadados de apresentação do
// trilho no topo da aba 🧭 Copiloto. Ordem == STAGE_IDS (policyJourney.js); "why" vem de
// `stage.facts` (declarado pelo detector), nunca hardcoded aqui.
const JOURNEY_STAGE_META = {
  know_base:    { short: "Base",         label: "1 · Conhecer a base" },
  eligibility:  { short: "Elegibil.",    label: "2 · Elegibilidade" },
  segmentation: { short: "Segmentação",  label: "3 · Segmentação" },
  risk:         { short: "Risco",        label: "4 · Risco e cortes" },
  calibration:  { short: "Calibração",   label: "5 · Calibração" },
  validation:   { short: "Validação",    label: "6 · Validação e entrega" },
};

// "Por que isso importa" de cada etapa — texto pedagógico FIXO (mesmo padrão de
// describeWhyItMatters do feed NB), não usa `facts` (é o conceito, não o resultado específico).
const JOURNEY_STAGE_WHY = {
  know_base: "Conhecer a base (carregada + AS IS configurado) dá o baseline de comparação antes de qualquer corte.",
  eligibility: "Um caminho curto de reprovação automática (knock-out) filtra os casos claramente inelegíveis antes de entrar no mérito de risco.",
  segmentation: "Segmentar por uma variável categórica ou cluster antes de aplicar cortes de risco evita tratar populações heterogêneas como se fossem uma só.",
  risk: "Uma variável ordinal, de faixas ou de score roteada a terminais distintos é o corte de risco propriamente dito — o coração da política.",
  calibration: "Calibrar (Goal Seek/otimizador, ou uma meta de negócio batida) ajusta os cortes para o resultado desejado, não só para o que parece razoável.",
  validation: "O Checklist de Prontidão reúne os critérios objetivos de \"pronta para o comitê\" — governança igual para qualquer autor da política.",
};

// Checklist de Prontidão (DEC-EP-003) — rótulo curto + descrição por critério, na ordem de
// READINESS_CRITERIA_IDS. `facts` de cada critério vem de computeReadiness (policyJourney.js).
export const READINESS_CRITERIA_META = {
  lint_no_blockers:      { label: "Lint sem bloqueantes", desc: "Nenhum achado de severidade erro (porta solta com tráfego, nó inalcançável, ciclo, etc.)." },
  full_coverage:         { label: "100% da população decidida", desc: "Todo o volume da base chega a um terminal Aprovado ou Reprovado — nada se perde no funil." },
  no_pending_vars:       { label: "Nenhuma variável pendente", desc: "Nenhum losango da Biblioteca de Políticas ficou sem mapear para uma coluna da base atual." },
  asis_delta:            { label: "AS IS configurado e delta simulado", desc: "Existe uma decisão AS IS configurada e o delta contra a política simulada foi calculado." },
  doc_current:           { label: "Documentação gerada e atual", desc: "A Documentação Automática foi gerada e reflete a política atual (sem mudanças desde então)." },
  no_lossless_simplify:  { label: "Sem simplificação lossless pendente", desc: "Nenhum candidato de simplificação com equivalência PROVADA (diff = 0) ainda não aplicado." },
  stable_vars:           { label: "Variáveis usadas são estáveis", desc: "Nenhuma variável em uso tem a flag de instabilidade temporal (PSI) do Perfil da Base." },
};

// Leitura curta do "por quê" de cada etapa a partir de `stage.facts` (declarado por
// detectJourneyStages, policyJourney.js — DEC-EP-002: os detectores NUNCA fingem certeza,
// sempre expõem o que detectaram). Determinístico, sem prosa gerada.
function describeJourneyStageFacts(stage) {
  const f = stage?.facts || {};
  switch (stage?.id) {
    case 'know_base':
      if (!f.baseLoaded) return 'Nenhuma base carregada ainda.';
      if (!f.asIsConfigured) return 'Base carregada, mas a decisão AS IS ainda não foi configurada.';
      return f.hasProfile ? 'Base carregada, AS IS configurado e Perfil da Base calculado.' : 'Base carregada e AS IS configurado.';
    case 'eligibility':
      return f.knockoutFound ? `Caminho de reprovação automática (knock-out) encontrado em ${f.minNodes} nó(s).` : 'Nenhum caminho de reprovação automática em até 2 nós foi encontrado ainda.';
    case 'segmentation':
      if (f.segmented) return `Variável de segmentação em uso perto da raiz (nível ${f.level}, ${f.subtreeCount} sub-árvores).`;
      return f.subtreeCount > 0 ? `Melhor candidato encontrado tem só ${f.subtreeCount} sub-árvore(s) — ainda não segmenta.` : 'Nenhuma variável categórica/cluster testada perto da raiz ainda.';
    case 'risk':
      if (f.routed) return `Variável de risco roteada a ${f.terminalCount} terminais distintos.`;
      return f.terminalCount > 0 ? `Melhor candidato roteia a só ${f.terminalCount} terminal — ainda não corta risco.` : 'Nenhuma variável ordinal/faixas/score em uso ainda.';
    case 'calibration':
      if (f.calibrationApplied) return 'Um otimizador (Goal Seek/Cineminha/Johnny) já foi aplicado neste canvas.';
      if (f.goalMet) return 'O delta contra o AS IS está dentro da meta declarada.';
      return 'Nenhum otimizador aplicado ainda neste canvas.';
    case 'validation':
      return f.ready ? 'Todos os critérios ativos do Checklist de Prontidão passam.' : `${f.passCount ?? 0}/${f.activeCount ?? 0} critérios ativos do Checklist de Prontidão passam.`;
    default:
      return '';
  }
}

// Simplificação com prova de equivalência (Copiloto Sessão 5, DEC-IA-005/006) — metadados
// de UI por tipo de candidato do catálogo (findings vêm de COMPUTE_SIMPLIFY/SIMPLIFY_RESULT).
const SIMPLIFY_CODE_META = {
  collapsible_node:   { icon: "🔗", label: "Nó colapsável" },
  zero_arrival_node:  { icon: "🕳", label: "Chegada zero" },
  lens_no_effect:     { icon: "🎚", label: "Regra sem efeito" },
  redundant_variable: { icon: "🔁", label: "Variável re-testada" },
};

// Metadados de UI e helpers de texto da Descoberta de Segmentos (SEGMENT_CODE_META,
// SEGMENT_TERMINAL_LABEL, segmentRuleText, fmtLift, segmentDispersionText) foram extraídos
// para ./dashboardComponents.jsx (lote C4) — usados só pelos cards de Segmentos/Clusters.

// computeWidgetMetric foi extraída para ./analytics.js (lote C4) e importada no topo.

// fmtMetricVal foi extraída para ./dashboardComponents.jsx (lote C4).

// pivotWidget foi extraída para ./analytics.js (lote C4) e importada no topo.

// ── Filtros do Analytics Workspace (página + visual) ─────────────────────────
// FilterCard: {id, dim, mode:'basic'|'advanced', selected: string[]|null, rules: FilterRule[]}
// - modo 'basic': `selected===null` = todos os valores passam (inativo até desmarcar algo);
//   `selected` array = lista explícita de valores marcados.
// - modo 'advanced': `rules` — mesma semântica de LensRule (operator/value/logic AND-OR),
//   avaliadas via `matchLensRule` sobre o valor da dimensão na linha.
// Filtros de página e de visual se combinam por AND (um recorta em cima do outro).
// newFilterCard foi extraída para ./dashboardComponents.jsx (lote C4) e re-exportada no topo.

// Helpers puros de filtro (filterCardActive/filterCardMatchesVal, applyAnalyticsFilters,
// applyFiltersToDataset, describeFilterCards) foram extraídos para ./analytics.js (lote C4)
// e importados no topo.

// ── Agrupamentos (dimensões derivadas) ───────────────────────────────────────
// Helpers puros de agrupamento (GROUPING_OTHER_DEFAULT, distinctDimValues, autoBuckets,
// applyGroupingsToDataset) foram extraídos para ./analytics.js (lote C4) e importados no topo.

// ═══ REGIÃO: AnalysisTab e Widgets do Dashboard ═══
// Todos os componentes React globais da aba Dashboard e dos cards do Copiloto
// (AnalysisTab, AnalyticsWidget, TextWidget, KpiCard, GroupingModal, FieldPanel, FieldWell,
// FilterCardsEditor/FilterCardRow, AWEmptyState, SeriesStylePanel, ChartBarLabel/ChartLineLabel,
// SegmentFindingCard/SegmentInfoCard/SegmentOpportunityCard, SegmentSparkline, DiagnosticsStrip,
// SegmentQuadrant, ClusterQuadrant, ClusterCard, GoalSeekFrontierChart) + helpers usados só por
// eles (getContrastColor, fmtPP, CLUSTER_COLORS, clusterColor) foram extraídos para
// ./dashboardComponents.jsx (lote C4) e importados no topo do App.jsx.

// ── Multi-canvas store helpers (DEC-AW-007) ─────────────────────────────────
const CANVAS_STORAGE_KEY = 'aw_canvases_v1';

// ═══ REGIÃO: Canvases Múltiplos (init/clone) ═══
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

// ═══ REGIÃO: Ribbon (UX 2.0 — Sessão 1/2) ═══
// Componente de casca do Ribbon. É puramente apresentacional: renderiza as 7 abas fixas,
// a aba contextual ativa e a QAT a partir do registro declarativo `COMMANDS` (fonte única,
// montado dentro do App). Cada descritor carrega `onRun`/`enabledWhen`/`activeWhen` como
// closures do App — o Ribbon só lê. As abas contextuais (Sessão 2) surgem destacadas só com
// o tipo correspondente selecionado; seu conteúdo é filtrado por `contextWhen(selection)`
// (o App já entrega o array `contextCommands` pronto).
const RIBBON_TABS = [
  { id: 'inicio',   label: 'Início'   },
  { id: 'inserir',  label: 'Inserir'  },
  { id: 'dados',    label: 'Dados'    },
  { id: 'analisar', label: 'Analisar' },
  { id: 'otimizar', label: 'Otimizar' },
  { id: 'politica', label: 'Política' },
  { id: 'projeto',  label: 'Projeto'  },
];
// Rótulo pt-BR de cada aba contextual (padrão "Contextual Tabs" do Office). O `id`
// corresponde ao valor de `activeContextTab` derivado da seleção no App.
const CTX_TAB_META = {
  'ctx-matriz':   'Matriz',
  'ctx-decisao':  'Decisão',
  'ctx-lens':     'Lens',
  'ctx-terminal': 'Terminal',
  'ctx-porta':    'Porta',
  'ctx-selecao':  'Seleção',
};
// Touch/mobile (UX 2.0 — Sessão 8): abaixo desta largura o Ribbon nasce em modo `compact`
// (em vez de `fixed`) — sem preferência salva ainda respeita o `ribbonMode` explícito do
// usuário (sessionStorage/.credito.json) — e o card de Dicas do canto do canvas migra para
// a seção Sobre do Hub (uma só constante para os dois lugares, ver mais abaixo).
const NARROW_SCREEN_BREAKPOINT = 720;
function defaultRibbonModeForScreen() {
  try { return window.innerWidth <= NARROW_SCREEN_BREAKPOINT ? 'compact' : 'fixed'; } catch { return 'fixed'; }
}
// Conteúdo do card "Dicas" do canto do canvas — fonte única consumida também pela seção
// ℹ️ Sobre do Hub em telas estreitas (Sessão 8), para as duas casas nunca divergirem.
const CANVAS_TIPS = [
  '✋ Mover · ↖ Selecionar e arrastar',
  '📱 Pinça → zoom · Segurar → editar',
  'Clique na seta → deletar conexão',
];

// Botão de comando do Ribbon em duas variantes (UX 2.0 Sessão 10):
//  • secundária (default): ícone+rótulo LADO A LADO, compacto — o leiaute histórico.
//  • primária (`cmd.primary`): ícone GRANDE empilhado VERTICALMENTE sobre o rótulo, para o
//    comando mais usado/representativo de cada grupo. O ícone primário usa font-size bem
//    maior (24px vs 14px) — proposital: emoji NÃO ganha destaque perceptível com um aumento
//    pequeno de font-size (bug visto num mockup de prévia), então a diferença precisa ser
//    grande de verdade. Ambos preservam enabledWhen/activeWhen/title exatos.
function RibbonCmdButton({ cmd }) {
  const enabled = cmd.enabledWhen ? !!cmd.enabledWhen() : true;
  const active  = cmd.activeWhen  ? !!cmd.activeWhen()  : false;
  const title   = (cmd.title || cmd.label) + (cmd.shortcut ? ` (${cmd.shortcut})` : '');
  const border  = active ? '1px solid #2563eb' : '1px solid transparent';
  const bg      = active ? '#2563eb' : 'transparent';
  const color   = !enabled ? '#cbd5e1' : active ? '#fff' : '#475569';
  if (cmd.primary) {
    return (
      <button className="wbt" disabled={!enabled} onClick={enabled ? cmd.onRun : undefined} title={title}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 4, padding: '4px 12px', minWidth: 60, alignSelf: 'stretch', borderRadius: 8, border,
          background: bg, color, cursor: enabled ? 'pointer' : 'default', fontFamily: 'inherit',
          whiteSpace: 'nowrap', flexShrink: 0 }}>
        {cmd.icon && <span style={{ fontSize: 24, lineHeight: 1 }}>{cmd.icon}</span>}
        <span className="wbl" style={{ fontSize: 11, fontWeight: 600 }}>{cmd.label}</span>
      </button>
    );
  }
  return (
    <button className="wbt" disabled={!enabled} onClick={enabled ? cmd.onRun : undefined} title={title}
      style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 10px', borderRadius: 8,
        border, background: bg, color,
        cursor: enabled ? 'pointer' : 'default', fontSize: 12.5, fontWeight: 500,
        fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {cmd.icon && <span style={{ fontSize: 14, lineHeight: 1 }}>{cmd.icon}</span>}
      <span className="wbl">{cmd.label}</span>
    </button>
  );
}

const RIBBON_MODE_META = {
  fixed:   { icon: '⌃', label: 'Fixo',       hint: 'Ribbon inteiro fixo — clique para modo Compacto' },
  compact: { icon: '⌃', label: 'Compacto',   hint: 'Só a faixa de abas — clique para modo Automático' },
  auto:    { icon: '⌄', label: 'Automático', hint: 'Ribbon oculto (hover no topo revela) — clique para modo Fixo' },
};

function Ribbon({ commands, activeTab, onTab, qat, contextTab, contextCommands, onCtxTab, onOpenSettings, onOpenSearch, mode, onCycleMode }) {
  // Aba contextual em foco? Então o conteúdo vem de `contextCommands` (já filtrado por
  // contextWhen no App); senão, das abas fixas por `c.tab`.
  const isCtx = !!contextTab && activeTab === contextTab.id;
  const tabCmds = isCtx ? (contextCommands || []) : commands.filter(c => c.tab === activeTab);
  // Agrupa preservando a ordem de primeira aparição no registro (a ordem do `COMMANDS`
  // define o layout dos grupos — sem tabela de ordenação separada).
  const groupOrder = [];
  const byGroup = new Map();
  for (const c of tabCmds) {
    if (!byGroup.has(c.group)) { byGroup.set(c.group, []); groupOrder.push(c.group); }
    byGroup.get(c.group).push(c);
  }
  // Revelação por hover (modos compact/auto) — o conteúdo revelado é OVERLAY absoluto,
  // NUNCA empurra o SVG (invariante de posicionamento, Sessão 4). Fecho com pequeno atraso
  // para o mouse poder transitar da faixa de abas para o overlay sem sumir.
  const [reveal, setReveal] = useState(false);
  const closeTimer = useRef(null);
  const openReveal = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } setReveal(true); };
  const scheduleClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setReveal(false), 160); };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  // Ao trocar de modo, recolhe qualquer revelação pendente.
  useEffect(() => { setReveal(false); }, [mode]);
  // Touch/mobile (Sessão 8): fecho ao tocar fora do Ribbon revelado. Mouse já tem
  // onMouseLeave (scheduleClose) — bom o bastante, não duplicar com um backdrop: um backdrop
  // position:fixed cobrindo a tela BLOQUEARIA o clique no canvas (ex.: posicionar um shape
  // logo após abrir o Ribbon precisaria de dois toques). Em vez disso, um listener NATIVO de
  // `touchstart` no documento (passivo — não intercepta, só observa) fecha o Ribbon quando o
  // toque cai fora de `rootRef`, sem impedir esse mesmo toque de continuar até o canvas.
  const rootRef = useRef(null);
  useEffect(() => {
    if (!reveal) return;
    const onDocTouch = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) scheduleClose(); };
    document.addEventListener('touchstart', onDocTouch, { passive: true });
    return () => document.removeEventListener('touchstart', onDocTouch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  const qBtn = (icon, label, on, enabled, danger) => (
    <button className="wbt" disabled={!enabled} onClick={enabled ? on : undefined} title={label}
      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 9px', borderRadius: 8, border: 'none',
        background: danger && enabled ? '#fff1f2' : 'transparent',
        color: !enabled ? '#cbd5e1' : danger ? '#e11d48' : '#475569',
        cursor: enabled ? 'pointer' : 'default', fontSize: 12.5, fontFamily: 'inherit', flexShrink: 0 }}>
      <span style={{ fontSize: 14, lineHeight: 1 }}>{icon}</span>
    </button>
  );
  const CTX_ACCENT = '#7c3aed'; // violeta — cor da aba contextual (destaque "Contextual Tabs")
  const modeMeta = RIBBON_MODE_META[mode] || RIBBON_MODE_META.fixed;

  // Cluster QAT (Sessão 9: realocado para o INÍCIO da faixa de abas, antes de "Início") —
  // Desfazer/Refazer/Deletar/Salvar + Abrir Projeto (reusa o onRun do descritor
  // `project.open` via qat.onOpen — sem lógica de arquivo duplicada). Visível nos 3 modos
  // (na faixa de abas em fixed/compact; flutuante em auto). Não faz parte do conteúdo
  // colapsável.
  const leftCluster = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingRight: 8, marginRight: 6, borderRight: '1px solid #f1f5f9' }}>
      {qBtn('↩', 'Desfazer (Ctrl+Z)', qat.undo, qat.canUndo, false)}
      {qBtn('↪', 'Refazer (Ctrl+Y)', qat.redo, qat.canRedo, false)}
      {qBtn('🗑', 'Deletar (Del)', qat.onDelete, qat.canDelete, true)}
      {qBtn('💾', 'Salvar Projeto', qat.onSave, true, false)}
      {qBtn('📁', 'Abrir Projeto', qat.onOpen, true, false)}
    </div>
  );

  // Cluster ciclo de modo + Busca + ⚙ — CONTINUAM à direita da faixa de abas, como hoje
  // (Sessão 9 não move este bloco). Visível nos 3 modos (na faixa de abas em fixed/compact;
  // flutuante em auto). Não faz parte do conteúdo colapsável.
  const rightCluster = (
    <>
      {/* Botão de ciclo de colapso do Ribbon (fixed → compact → auto → fixed). */}
      <button className="wbt" onClick={onCycleMode} title={modeMeta.hint}
        style={{ display: 'flex', alignItems: 'center', gap: 4, height: 28, padding: '0 8px', marginLeft: 6,
          borderRadius: 8, border: '1px solid #e2e8f0', background: 'transparent', color: '#475569',
          cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', flexShrink: 0, fontWeight: 600 }}>
        <span style={{ fontSize: 13, lineHeight: 1 }}>{modeMeta.icon}</span>
        <span className="wbl">{modeMeta.label}</span>
      </button>
      {/* 🔎 Busca de comandos — campo compacto, à esquerda do ⚙ (UX 2.0 Sessão 7). Abre o
          popover Ctrl+K; digitar aqui só foca o campo real dentro do popover. */}
      <button className="wbt" onClick={onOpenSearch} title="Pesquisar comando… (Ctrl+K)"
        style={{ display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 8px 0 9px', marginLeft: 6,
          borderRadius: 8, border: '1px solid #e2e8f0', background: '#fafbfc', color: '#94a3b8',
          cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', flexShrink: 0, minWidth: 0 }}>
        <span style={{ fontSize: 12 }}>🔎</span>
        <span className="wbl" style={{ whiteSpace: 'nowrap' }}>Pesquisar comando…</span>
        <span className="wbl" style={{ fontSize: 9.5, fontWeight: 600, border: '1px solid #e2e8f0', borderRadius: 4, padding: '1px 4px', marginLeft: 2 }}>Ctrl+K</span>
      </button>
      {/* ⚙ Hub de Configurações — visível nos 3 modos de colapso (UX 2.0 Sessão 3/4). */}
      <button className="wbt" onClick={onOpenSettings} title="Configurações (Ctrl+,)"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 28,
          marginLeft: 6, borderRadius: 8, border: 'none', background: 'transparent', color: '#475569',
          cursor: 'pointer', fontSize: 15, fontFamily: 'inherit', flexShrink: 0 }}>
        ⚙
      </button>
    </>
  );

  // Faixa de abas (leftCluster fixo | tabs + contextual, num filho rolável | rightCluster
  // fixo). `withCluster` controla se os clusters QAT (esquerda, Sessão 9) e ciclo/Busca/⚙
  // (direita) vêm embutidos (fixed/compact) ou não (auto usa o flutuante). Touch/mobile
  // (Sessão 8): `onTouchStart` espelha `onMouseEnter` (revela por toque, já que hover não
  // existe em touchscreen) e as abas ficam num filho `overflowX:auto` próprio — em telas
  // estreitas com muitas abas, nem o leftCluster (QAT) nem o rightCluster (ciclo/Busca/⚙)
  // ficam fora da tela, só as abas rolam.
  const tabStrip = (withCluster) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px', borderBottom: '1px solid #f1f5f9', background: '#fff' }}
      onMouseEnter={mode === 'compact' ? openReveal : undefined}
      onTouchStart={mode === 'compact' ? openReveal : undefined}>
      {withCluster && <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{leftCluster}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, minWidth: 0, overflowX: 'auto' }}>
        {RIBBON_TABS.map(t => {
          const on = !isCtx && activeTab === t.id;
          return (
            <button key={t.id} className="rtab" onClick={() => onTab(t.id)} onDoubleClick={on ? onCycleMode : undefined}
              title={on ? 'Duplo-clique alterna o colapso do Ribbon' : undefined}
              style={{ padding: '5px 14px', borderRadius: 8, border: 'none', flexShrink: 0,
                background: on ? '#eff6ff' : 'transparent', color: on ? '#2563eb' : '#64748b',
                fontWeight: on ? 700 : 500, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
                whiteSpace: 'nowrap', transition: 'all .12s' }}>
              {t.label}
            </button>
          );
        })}
        {/* Aba contextual — surge destacada só com o tipo correspondente selecionado. */}
        {contextTab && (
          <button key={contextTab.id} className="rctxtab" onClick={onCtxTab} title={`Ferramentas de ${contextTab.label}`}
            style={{ marginLeft: 6, padding: '5px 15px', borderRadius: 8, flexShrink: 0,
              border: `1px solid ${isCtx ? CTX_ACCENT : '#ddd6fe'}`,
              borderTop: `3px solid ${CTX_ACCENT}`,
              background: isCtx ? '#f5f3ff' : '#faf5ff', color: CTX_ACCENT,
              fontWeight: 700, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
              whiteSpace: 'nowrap', transition: 'all .12s', boxShadow: isCtx ? `0 1px 0 ${CTX_ACCENT}` : 'none' }}>
            <span style={{ fontSize: 10, marginRight: 5, opacity: .8, textTransform: 'uppercase', letterSpacing: .3 }}>◆</span>
            {contextTab.label}
          </button>
        )}
      </div>
      {withCluster && <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>{rightCluster}</div>}
    </div>
  );

  // Grupos de comandos da aba ativa (fundo levemente tingido quando contextual).
  const groups = (
    // minHeight subiu de 58 → 82 (Sessão 10) para acomodar o botão primário empilhado
    // (ícone 24px + rótulo + label do grupo). Só torna o Ribbon fixo mais alto; a conversão
    // tela→mundo (svgPt/toWorld) lê getBoundingClientRect AO VIVO — nenhum cache foi
    // introduzido — logo o reflow do canvas se autocorrige (invariante de posicionamento).
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, padding: '6px 8px', overflowX: 'auto', minHeight: 82,
      background: isCtx ? '#fbfaff' : '#fff' }}>
      {groupOrder.length === 0 ? (
        <div style={{ fontSize: 11.5, color: '#cbd5e1', padding: '10px 6px' }}>—</div>
      ) : groupOrder.map((g, gi) => {
        // Dentro do grupo: o(s) botão(ões) primário(s) (leiaute vertical grande) à esquerda,
        // os secundários (compactos) num bloco que embrulha à direita. Isto NÃO altera a
        // composição nem a ordem dos grupos (o registro COMMANDS é intocado) — é só o
        // leiaute do botão dentro do grupo já existente. Grupos sem nenhum `primary` caem no
        // caminho de sempre (só o bloco compacto, idêntico ao histórico).
        const cmds = byGroup.get(g);
        const primaries = cmds.filter(c => c.primary);
        const secondaries = cmds.filter(c => !c.primary);
        return (
          <div key={g} style={{ display: 'flex', flexDirection: 'column', padding: '0 10px',
            borderRight: gi < groupOrder.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1 }}>
              {primaries.map(c => <RibbonCmdButton key={c.id} cmd={c} />)}
              {secondaries.length > 0 && (
                <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                  {secondaries.map(c => <RibbonCmdButton key={c.id} cmd={c} />)}
                </div>
              )}
            </div>
            <div style={{ fontSize: 9.5, color: isCtx ? '#8b5cf6' : '#94a3b8', textAlign: 'center', marginTop: 3,
              textTransform: 'uppercase', letterSpacing: .4, fontWeight: 600 }}>{g}</div>
          </div>
        );
      })}
    </div>
  );

  const overlayShadow = '0 12px 28px rgba(15,23,42,.16)';

  // ── Modo FIXED: Ribbon inteiro, ocupa altura no flex-column → canvas reflowa. ──
  if (mode === 'fixed') {
    return (
      <div style={{ flexShrink: 0, background: '#fff', borderBottom: '1px solid #e2e8f0', zIndex: 250 }}>
        {tabStrip(true)}
        {groups}
      </div>
    );
  }

  // ── Modo COMPACT: só a faixa de abas ocupa altura (reflowa); os grupos abrem como
  //    OVERLAY absoluto ao passar o mouse / clicar numa aba — SEM reflow do canvas. ──
  if (mode === 'compact') {
    return (
      <div ref={rootRef} style={{ position: 'relative', flexShrink: 0, background: '#fff', borderBottom: '1px solid #e2e8f0', zIndex: 450 }}
        onMouseLeave={scheduleClose}>
        {tabStrip(true)}
        {reveal && (
          <div onMouseEnter={openReveal}
            style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
              background: isCtx ? '#fbfaff' : '#fff', borderBottom: '1px solid #e2e8f0',
              boxShadow: overlayShadow }}>
            {groups}
          </div>
        )}
      </div>
    );
  }

  // ── Modo AUTO: Ribbon oculto, só uma hotzone de ~6px no topo ocupa altura. Hover na
  //    hotzone (ou no overlay) revela o Ribbon INTEIRO como OVERLAY absoluto — SEM reflow.
  //    A QAT + ⚙ ficam num cluster flutuante sempre visível (recolhido durante a revelação,
  //    pois o Ribbon revelado já mostra a faixa completa). Touch/mobile (Sessão 8): a hotzone
  //    responde a `onTouchStart` (hover não existe em touchscreen), o botão ⌄ é o alvo de
  //    toque confiável, e tocar fora (listener no documento, ver acima) fecha o Ribbon. ──
  return (
    // Wrapper de 6px `position:relative` — só ele ocupa altura no flex-column (constante →
    // sem reflow ao revelar). Serve de âncora para os overlays absolutos (robusto contra o
    // `overflow:hidden` da raiz do app) e para o fecho por toque-fora (rootRef).
    <div ref={rootRef} style={{ position: 'relative', flexShrink: 0, height: 6, zIndex: 450 }}>
      {/* Hotzone fina — passe o mouse (ou toque) para revelar o Ribbon inteiro. Numa faixa de
          6px, toque impreciso ("fat finger") é o caso comum — o botão ⌄ no cluster flutuante
          logo abaixo é o alvo de toque garantido; a hotzone é o atalho de hover no desktop. */}
      <div onMouseEnter={openReveal} onTouchStart={openReveal}
        title="Passe o mouse ou toque para revelar o Ribbon"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6,
          background: 'linear-gradient(#e2e8f0,#f1f5f9)', borderBottom: '1px solid #e2e8f0', cursor: 'default' }} />
      {/* Cluster flutuante QAT + ciclo + ⚙ — mantém QAT/Abrir Projeto/⚙ visíveis no modo auto
          sem reflow. Recolhe enquanto o Ribbon está revelado (a faixa revelada já os contém).
          O botão ⌄ (Sessão 8) é o alvo de toque explícito e confiável para revelar o Ribbon —
          um alvo de ~30px é ergonômico em touch; a hotzone de 6px sozinha não é. */}
      {!reveal && (
        <div style={{ position: 'absolute', top: 8, right: 14, zIndex: 320, display: 'flex', alignItems: 'center',
          gap: 2, padding: '2px 4px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
          boxShadow: '0 2px 10px rgba(15,23,42,.10)' }}>
          <button className="wbt" onClick={openReveal} title="Mostrar Ribbon"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26,
              borderRadius: 7, border: 'none', background: 'transparent', color: '#475569',
              cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', flexShrink: 0 }}>
            ⌄
          </button>
          <div style={{ width: 1, height: 16, background: '#f1f5f9', flexShrink: 0 }} />
          {leftCluster}
          {rightCluster}
        </div>
      )}
      {/* Ribbon revelado — OVERLAY absoluto no topo (position:absolute → não empurra o SVG). */}
      {reveal && (
        <div onMouseEnter={openReveal} onMouseLeave={scheduleClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 320,
            background: '#fff', borderBottom: '1px solid #e2e8f0', boxShadow: overlayShadow }}>
          {tabStrip(true)}
          {groups}
        </div>
      )}
    </div>
  );
}

// ═══ Status Bar (UX 2.0 — Sessão 5) ════════════════════════════════════════════
// Faixa fina "soma automática" (padrão Excel), acima da barra de abas de canvas.
// Zona esquerda: indicadores configuráveis — registro abaixo é a FONTE ÚNICA,
// também consumida pela seção 🗔 Interface do Hub de Configurações (mesma escolha,
// dois pontos de entrada). Zona direita fixa: 🐍 Motor Python (abre o Hub),
// BuildBadge, zoom % (clique → centralizar). Só leitura de simResult/
// incrementalResult/nodeArrivals/csvStore já computados pelo App — nenhuma
// matemática nova.
const STATUS_BAR_INDICATORS_META = [
  { id: 'approvalRate',   label: 'Taxa de Aprovação' },
  { id: 'inadReal',       label: 'Inad. Real' },
  { id: 'inadInferida',   label: 'Inad. Inferida' },
  { id: 'selectionCount', label: 'Shapes Selecionados' },
  { id: 'nodeArrival',    label: 'Volume no Nó Selecionado' },
  { id: 'baseRows',       label: 'Linhas da Base' },
];
const DEFAULT_STATUS_BAR_INDICATORS = STATUS_BAR_INDICATORS_META.map(m => m.id);

function StatusBar({ indicators, values, onToggleIndicator, computeSidecar, computeSidecarStatus,
  computeSidecarChecking, onOpenSettings, zoomPct, onZoomClick }) {
  const [menu, setMenu] = useState(null); // efêmero — null | {x,y}
  const closeMenu = () => setMenu(null);
  const openMenuAt = (e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); };

  const shown = indicators.map(id => values[id]).filter(Boolean);

  return (
    <div onContextMenu={openMenuAt}
      title="Clique-direito para escolher os indicadores"
      style={{ display: 'flex', alignItems: 'center', height: 26, flexShrink: 0, background: '#f1f5f9',
        borderTop: '1px solid #e2e8f0', padding: '0 8px', fontSize: 11, color: '#475569',
        fontFamily: "'DM Sans',system-ui,sans-serif", userSelect: 'none', gap: 14 }}>

      {/* Zona esquerda — indicadores configuráveis */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0, overflowX: 'auto' }}>
        <button onClick={openMenuAt} title="Escolher indicadores da Status Bar"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18,
            borderRadius: 5, border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer',
            fontSize: 12, fontFamily: 'inherit', flexShrink: 0 }}>
          ⚙
        </button>
        {shown.length === 0 ? (
          <span style={{ color: '#cbd5e1' }}>Nenhum indicador — clique em ⚙ para escolher</span>
        ) : shown.map(v => (
          <span key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', flexShrink: 0 }}>
            <span style={{ color: '#94a3b8' }}>{v.label}</span>
            <span style={{ fontWeight: 700, color: v.color || '#1e293b' }}>{v.text}</span>
          </span>
        ))}
      </div>

      {/* Zona direita — fixa: 🐍 Motor Python · Build · zoom % */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <ComputeEngineBadge enabled={computeSidecar.enabled} status={computeSidecarStatus}
          checking={computeSidecarChecking} onClick={onOpenSettings}
          title="Motor Python — clique para abrir Configurações"/>
        <BuildBadge/>
        <span onClick={onZoomClick} title="Zoom — clique para centralizar"
          style={{ cursor: 'pointer', color: '#94a3b8', fontWeight: 600, padding: '2px 5px', borderRadius: 5,
            transition: 'background .12s' }}
          onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
          {zoomPct}%
        </span>
      </div>

      {/* Menu de configuração — engrenagem ou clique-direito na barra (abre para cima). */}
      {menu && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 9000 }} onClick={closeMenu}/>
          <div style={{ position: 'fixed', left: menu.x, bottom: Math.max(8, window.innerHeight - menu.y + 4),
            background: '#fff', borderRadius: 10, border: '1px solid #e2e8f0',
            boxShadow: '0 -8px 24px rgba(0,0,0,.12)', minWidth: 230, zIndex: 9001, padding: '6px 2px' }}>
            <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 700, color: '#94a3b8',
              textTransform: 'uppercase', letterSpacing: .5 }}>Indicadores da Status Bar</div>
            {STATUS_BAR_INDICATORS_META.map(m => (
              <label key={m.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5,
                  color: '#475569', fontWeight: 500, padding: '6px 12px' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                <input type="checkbox" checked={indicators.includes(m.id)} onChange={() => onToggleIndicator(m.id)}
                  style={{ width: 14, height: 14, accentColor: '#3b82f6' }}/>
                {m.label}
              </label>
            ))}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

// ═══ Busca de comandos — Ctrl+K (UX 2.0 — Sessão 7) ════════════════════════════
// Popover num portal (padrão dos dropdowns/modais existentes) consumindo `COMMANDS` por
// completo (fixas + contextuais). App já entrega `results` filtrados/ranqueados por
// contextWhen/enabledWhen — este componente só navega (setas), executa (Enter) e fecha
// (Esc / clique fora). Estado efêmero — nada a persistir.
function CommandPalette({ query, activeIndex, results, onQueryChange, onActiveIndex, onRun, onClose }) {
  const inputRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const clampedIndex = results.length === 0 ? -1 : Math.min(activeIndex, results.length - 1);

  const onKeyDown = (e) => {
    // Captura tudo aqui dentro (stopPropagation) para o listener global de teclado do App
    // (Delete/Backspace/Escape sobre o canvas) nunca ver estas teclas enquanto o popover
    // está aberto — evita deletar shape selecionado ao editar a query.
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (results.length) onActiveIndex(Math.min(clampedIndex + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); if (results.length) onActiveIndex(Math.max(clampedIndex - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[clampedIndex];
      if (r && r.enabled) onRun(r.cmd);
      return;
    }
  };

  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 4600, background: 'rgba(15,23,42,.35)' }} onMouseDown={onClose} />
      <div onMouseDown={e => e.stopPropagation()}
        style={{ position: 'fixed', top: '14vh', left: '50%', transform: 'translateX(-50%)', width: 560, maxWidth: '92vw',
          maxHeight: '64vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,.28)', overflow: 'hidden', zIndex: 4601,
          fontFamily: "'DM Sans',system-ui,sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
          <span style={{ fontSize: 15, color: '#94a3b8' }}>🔎</span>
          <input ref={inputRef} value={query} onChange={e => onQueryChange(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Pesquisar comando…"
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, fontFamily: 'inherit', color: '#1e293b', background: 'transparent' }} />
          <span style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 600, border: '1px solid #e2e8f0', borderRadius: 5, padding: '1px 5px', flexShrink: 0 }}>Esc</span>
        </div>
        <div ref={listRef} style={{ overflowY: 'auto', padding: 6 }}>
          {results.length === 0 ? (
            <div style={{ padding: '20px 14px', fontSize: 12.5, color: '#94a3b8', textAlign: 'center' }}>Nenhum comando encontrado</div>
          ) : results.map((r, i) => {
            const c = r.cmd;
            const active = i === clampedIndex;
            const reason = !r.enabled && c.disabledReason ? (typeof c.disabledReason === 'function' ? c.disabledReason() : c.disabledReason) : null;
            return (
              <div key={c.id} data-idx={i}
                onMouseEnter={() => onActiveIndex(i)}
                onMouseDown={e => { e.preventDefault(); if (r.enabled) onRun(c); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9,
                  cursor: r.enabled ? 'pointer' : 'default', background: active ? '#eff6ff' : 'transparent' }}>
                <span style={{ fontSize: 15, width: 20, textAlign: 'center', flexShrink: 0, opacity: r.enabled ? 1 : .5 }}>{c.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: r.enabled ? '#1e293b' : '#94a3b8',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</div>
                  {reason && <div style={{ fontSize: 10.5, color: '#cbd5e1', marginTop: 1 }}>{reason}</div>}
                </div>
                {c.shortcut && <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, flexShrink: 0 }}>{c.shortcut}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </>,
    document.body
  );
}

// ═══ Mini-flutuante de seleção (UX 2.0 — Sessão 8) ═════════════════════════════
// Ergonomia de mão: perto do shape selecionado (single-seleção), só Deletar e Duplicar —
// os mesmos onRun dos descritores `edit.delete`/`edit.duplicate`. Posição em coordenadas
// de tela derivada de shape.x/y/w/h + vp (mesma conta do editor de rótulo inline, algumas
// linhas abaixo no JSX) — nenhuma matemática de viewport nova. Some durante o arraste (o
// shape arrastado sai da cena para o overlay leve — ver dragIds/dragDelta — e sua posição
// em `shapes` só é commitada no mouseup, então a leitura ficaria congelada) e durante a
// edição inline do rótulo.
function SelectionMiniToolbar({ shape, vp, onDuplicate, onDelete }) {
  const sw = shape.w * vp.s, sh = shape.h * vp.s;
  const sx = shape.x * vp.s + vp.x, sy = shape.y * vp.s + vp.y;
  const above = sy > 46;
  const top = above ? sy - 38 : sy + sh + 8;
  const left = sx + sw / 2;
  const btnStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 28,
    borderRadius: 7, border: 'none', background: 'transparent', color: '#e2e8f0',
    cursor: 'pointer', fontSize: 14, fontFamily: 'inherit', touchAction: 'manipulation',
  };
  return (
    <div style={{ position: 'absolute', left, top, transform: 'translateX(-50%)', zIndex: 410,
      display: 'flex', alignItems: 'center', gap: 2, padding: 3, background: '#1e293b',
      borderRadius: 10, boxShadow: '0 6px 18px rgba(15,23,42,.32)' }}
      onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}>
      <button className="wbmini" onClick={onDuplicate} title="Duplicar" style={btnStyle}>⧉</button>
      <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,.18)' }} />
      <button className="wbmini" onClick={onDelete} title="Deletar" style={{ ...btnStyle, color: '#fca5a5' }}>🗑</button>
    </div>
  );
}

// ═══ REGIÃO: Estado Principal do Componente ═══
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
  const [activeTab,  setActiveTab]  = useState("canvas"); // "analysis" | "canvas" | "explore"
  // Ribbon (UX 2.0 — Sessão 1): aba ativa do Ribbon fixo. Persistida em sessionStorage
  // (sobrevive a reload na mesma sessão) e no .credito.json (buildProjectPayload/loadProject).
  const [ribbonActiveTab, setRibbonActiveTab] = useState(() => {
    try { const s = sessionStorage.getItem('ribbon_active_tab_v1'); return s || 'inicio'; } catch { return 'inicio'; }
  });
  // Ribbon (UX 2.0 — Sessão 4): colapso em 3 estados. 'fixed' (Ribbon inteiro, reflowa o
  // canvas) | 'compact' (só a faixa de abas fixa reflowa; grupos abrem como OVERLAY sem
  // reflow) | 'auto' (Ribbon oculto exceto hotzone de ~6px; hover revela o Ribbon inteiro
  // como OVERLAY sem reflow). Persistido (sessionStorage + .credito.json, schema 2.9).
  const [ribbonMode, setRibbonMode] = useState(() => {
    try {
      const s = sessionStorage.getItem('ribbon_mode_v1');
      if (s === 'compact' || s === 'auto' || s === 'fixed') return s;
      // Sem preferência salva ainda nesta sessão: tela estreita (touch/mobile) nasce compact.
      return defaultRibbonModeForScreen();
    } catch { return 'fixed'; }
  });
  const cycleRibbonMode = useCallback(() => {
    setRibbonMode(m => (m === 'fixed' ? 'compact' : m === 'compact' ? 'auto' : 'fixed'));
  }, []);
  // Touch/mobile (UX 2.0 — Sessão 8): estado efêmero, reativo a resize (não persiste — é
  // só um sinal de layout, igual a "a viewport ficou estreita agora"). Usado para: ocultar
  // o card de Dicas flutuante do canto do canvas em telas pequenas (o conteúdo migra para a
  // seção ℹ️ Sobre do Hub, que já existe e tem espaço de sobra).
  const [isNarrowScreen, setIsNarrowScreen] = useState(() => {
    try { return window.innerWidth <= NARROW_SCREEN_BREAKPOINT; } catch { return false; }
  });
  useEffect(() => {
    const onResize = () => setIsNarrowScreen(window.innerWidth <= NARROW_SCREEN_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Painel direito (UX 2.0 — Sessão 6): aba interna ativa — 'assets' (bases + variáveis +
  // bibliotecas) | 'inspector' (propriedades do objeto selecionado) | 'copilot' (lint +
  // Descoberta). Persistido (sessionStorage + .credito.json, schema 3.1). O painel continua
  // à direita, com o mesmo panelCollapsed.
  const [rightPanelMode, setRightPanelMode] = useState(() => {
    try { const s = sessionStorage.getItem('right_panel_mode_v1'); return (s === 'inspector' || s === 'copilot') ? s : 'assets'; } catch { return 'assets'; }
  });
  // Status Bar (UX 2.0 — Sessão 5): quais indicadores aparecem na zona esquerda, e em
  // que ordem — engrenagem/clique-direito na barra (e a seção 🗔 Interface do Hub, mesmo
  // estado). Persistido (sessionStorage + .credito.json, schema 3.0).
  const [statusBarIndicators, setStatusBarIndicators] = useState(() => {
    try {
      const s = sessionStorage.getItem('status_bar_indicators_v1');
      if (!s) return DEFAULT_STATUS_BAR_INDICATORS;
      const arr = JSON.parse(s);
      const valid = new Set(STATUS_BAR_INDICATORS_META.map(m => m.id));
      return Array.isArray(arr) ? arr.filter(id => valid.has(id)) : DEFAULT_STATUS_BAR_INDICATORS;
    } catch { return DEFAULT_STATUS_BAR_INDICATORS; }
  });
  const toggleStatusBarIndicator = useCallback((id) => {
    setStatusBarIndicators(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);
  // Ribbon (UX 2.0 — Sessão 2): a aba contextual está em foco? Efêmero — deriva da seleção
  // (auto-ativa ao selecionar, volta à aba fixa ao desselecionar). Não persiste.
  const [ctxTabShown, setCtxTabShown] = useState(false);
  const [analyticsDataset, setAnalyticsDataset] = useState(null); // wide dataset cacheado do worker
  const [analyticsLayout, setAnalyticsLayout] = useState(() => { try { const s = sessionStorage.getItem('aw_layout_v1'); return s ? JSON.parse(s) : []; } catch { return []; } }); // WidgetConfig[] — gráficos do dashboard
  const [analyticsGroupings, setAnalyticsGroupings] = useState(() => { try { const s = sessionStorage.getItem('aw_groupings_v1'); return s ? JSON.parse(s) : []; } catch { return []; } }); // Grouping[] — dimensões derivadas reutilizáveis
  const [analyticsPageFilters, setAnalyticsPageFilters] = useState(() => { try { const s = sessionStorage.getItem('aw_page_filters_v1'); return s ? JSON.parse(s) : []; } catch { return []; } }); // FilterCard[] — filtro de página do Dashboard (aplica-se a todos os gráficos)
  // Aviso efêmero (não persiste) no topo do Dashboard — DEC-FR-002: declara quando os
  // FilterCard[] acima vieram de um "👁 Ver no Dashboard" de cluster ESCOPADO (o filtro
  // de página reproduz só as dimensões/valores do cluster, não o walk de política do nó).
  const [analyticsScopeNotice, setAnalyticsScopeNotice] = useState(null);
  // Dataset enriquecido com as dimensões derivadas (agrupamentos) — consumido pela aba Dashboard.
  const groupedDataset = useMemo(() => applyGroupingsToDataset(analyticsDataset, analyticsGroupings), [analyticsDataset, analyticsGroupings]);

  // ── Explorar a Base (Épico EB, EB2 — docs/wiki/Epicos-ExplorarBase.md) ──────
  // Pipeline PRÓPRIO (DEC-EB-002): `BaseProfileModel` é DERIVADO (nunca persiste — só o
  // layout, criação do usuário, persiste). `exploreCsvId`/`exploreRiskMetric` controlam o
  // header da aba; `null` em exploreCsvId ⇒ o worker escolhe o csv de maior população
  // (mesmo critério de "winner" de computeVariableRanking) e ecoa o csvId escolhido de volta.
  const [exploreCsvId, setExploreCsvId] = useState(null);
  const [exploreRiskMetric, setExploreRiskMetric] = useState("inadReal");
  const [baseProfileResult, setBaseProfileResult] = useState(null); // BaseProfileModel | null — derivado, não persiste
  // exploreLayouts: {[csvId]: WidgetConfig[]} — CRIAÇÃO DO USUÁRIO (regra inviolável do
  // CLAUDE.md): persiste em .credito.json (buildProjectPayload/loadProject) + sessionStorage.
  const [exploreLayouts, setExploreLayouts] = useState(() => {
    try {
      const s = sessionStorage.getItem('explore_layouts_v1');
      const v = s ? JSON.parse(s) : {};
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    } catch { return {}; }
  });
  const setExploreLayoutForCsv = useCallback((csvId, updater) => {
    if (!csvId) return;
    setExploreLayouts(prev => {
      const cur = prev[csvId] || [];
      const next = typeof updater === 'function' ? updater(cur) : updater;
      return next === cur ? prev : { ...prev, [csvId]: next };
    });
  }, []);
  // Builder livre (Épico EB, EB4 — DEC-EB-011): MESMO FieldPanel/FilterCardsEditor/
  // GroupingModal do Dashboard, operando sobre um dataset largo escopado à base
  // selecionada (cenário fixo AS IS — sem canvases, `exploreAnalyticsDataset` abaixo).
  // Agrupamentos e filtro de página são CRIAÇÃO DO USUÁRIO ⇒ persistem por base (mesmo
  // padrão per-csvId de `exploreLayouts`), separados dos do Dashboard (`analyticsGroupings`/
  // `analyticsPageFilters`, globais e sobre a simulação).
  const [exploreGroupings, setExploreGroupings] = useState(() => {
    try {
      const s = sessionStorage.getItem('explore_groupings_v1');
      const v = s ? JSON.parse(s) : {};
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    } catch { return {}; }
  });
  const [explorePageFilters, setExplorePageFilters] = useState(() => {
    try {
      const s = sessionStorage.getItem('explore_page_filters_v1');
      const v = s ? JSON.parse(s) : {};
      return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    } catch { return {}; }
  });
  const setExploreGroupingsForCsv = useCallback((csvId, updater) => {
    if (!csvId) return;
    setExploreGroupings(prev => {
      const cur = prev[csvId] || [];
      const next = typeof updater === 'function' ? updater(cur) : updater;
      return next === cur ? prev : { ...prev, [csvId]: next };
    });
  }, []);
  const setExplorePageFiltersForCsv = useCallback((csvId, updater) => {
    if (!csvId) return;
    setExplorePageFilters(prev => {
      const cur = prev[csvId] || [];
      const next = typeof updater === 'function' ? updater(cur) : updater;
      return next === cur ? prev : { ...prev, [csvId]: next };
    });
  }, []);
  // Dataset largo do builder livre — DERIVADO (recomputado pelo worker, não persiste),
  // mesmo contrato de `analyticsDataset`. Ver COMPUTE_EXPLORE_DATASET (Worker-Protocolo.md).
  const [exploreAnalyticsDataset, setExploreAnalyticsDataset] = useState(null);
  const groupedExploreDataset = useMemo(
    () => applyGroupingsToDataset(exploreAnalyticsDataset, exploreGroupings[exploreCsvId] || []),
    [exploreAnalyticsDataset, exploreGroupings, exploreCsvId]
  );
  // Aviso efêmero (não persiste) para o CTA "➕ Usar como 1º galho" quando o canvas ativo
  // já não está vazio (nó criado SOLTO, precisa ser conectado ao fluxo — DEC-EB-010).
  const [exploreActionNotice, setExploreActionNotice] = useState(null);
  // Convite pós-import (Épico EB, EB4, DEC-EB-012) — efêmero (não persiste), dispensável;
  // null | {csvId, filename}. Setado ao final do confirm do wizard de importação (só para
  // NOVAS bases — o modo de edição de dataset existente retorna antes desse ponto).
  const [postImportInvite, setPostImportInvite] = useState(null);
  // ↻ Regenerar análise (DEC-EB-005): recria só os widgets `origin:'auto'` desta base,
  // preservando os `origin:'user'` (criados/editados pelo usuário) — nunca sobrescrita
  // silenciosa (confirmação explícita antes de descartar os cards automáticos atuais).
  const regenerateExploreLayout = useCallback(() => {
    if (!baseProfileResult || baseProfileResult.error) return;
    const csvId = baseProfileResult.csvId;
    if (!window.confirm('Regenerar recria os cards automáticos desta análise (os cards que você criou ou editou são preservados). Continuar?')) return;
    setExploreLayoutForCsv(csvId, (prev) => {
      const kept = prev.filter(w => w.origin === 'user');
      // ids são "slots" estáveis (ex.: auto_insight_asis) — um slot promovido a `user`
      // (editado) não deve ganhar um irmão automático duplicado com o mesmo id.
      const keptIds = new Set(kept.map(w => w.id));
      return [...kept, ...buildDefaultExploreLayout(baseProfileResult).filter(w => !keptIds.has(w.id))];
    });
  }, [baseProfileResult, setExploreLayoutForCsv]);

  // ── Feed de Próxima Melhor Ação (Jornada NB, Sessão NB2) ──────────────────────
  // `nextActionsModel`: NextActionsModel DERIVADO (não persiste — recomputado no mesmo
  // debounce do lint, mesmo padrão de `baseProfileResult`/`copilotFindings`).
  const [nextActionsModel, setNextActionsModel] = useState(null);
  const nextActionsModelRef = useRef(null);
  // `nextActionsTier2`: achados CAROS (Descoberta + Simplificação) da última "🔎 Buscar
  // oportunidades" (Sessão NB3), carimbados com o `policyFingerprint` do momento do cálculo.
  // DERIVADO (não persiste — recomputável sob demanda, mesmo padrão do NextActionsModel); vive
  // como blob `{discovery?, simplify?}` que a main REPASSA em todo COMPUTE_NEXT_ACTIONS. O
  // orquestrador do worker deriva o staleness (carimbo vs. IR atual) — nunca some/recalcula
  // sozinho (DEC-NB-002/003). Vazio (`{}`) enquanto o usuário não buscou.
  const [nextActionsTier2, setNextActionsTier2] = useState({});
  const nextActionsTier2Ref = useRef({});
  // `nextActionsScanning`: a busca cara está em andamento (loading do botão/feed). Efêmero.
  const [nextActionsScanning, setNextActionsScanning] = useState(false);
  // `autoScanLastFpRef`: fingerprint do PolicyIR da última busca cara (manual ou em idle) —
  // o opt-in `autoScanIdle` (NB3) só reroda quando a política mudou desde então, evitando
  // rebuscar o mesmo estado. Efêmero (o próprio tier2 não persiste).
  const autoScanLastFpRef = useRef(null);
  // `nextActionsPrefs`: DESCARTE/ADIAMENTO POR CARD É CRIAÇÃO DO USUÁRIO (regra inviolável
  // do CLAUDE.md, DEC-NB-006) — persiste em .credito.json (buildProjectPayload/loadProject,
  // schema 3.4) + sessionStorage. `dismissed`/`snoozed`: fingerprints estáveis (kind+alvo) de
  // cards descartados/adiados — nunca ressuscitam sozinhos na regeneração do feed.
  // `autoScanIdle`: opt-in da NB3 (Buscar oportunidades em idle), já reservado no contêiner.
  const [nextActionsPrefs, setNextActionsPrefs] = useState(() => {
    try {
      const s = sessionStorage.getItem('next_actions_prefs_v1');
      const v = s ? JSON.parse(s) : null;
      return (v && typeof v === 'object' && !Array.isArray(v))
        ? { dismissed: Array.isArray(v.dismissed) ? v.dismissed : [], snoozed: Array.isArray(v.snoozed) ? v.snoozed : [], autoScanIdle: v.autoScanIdle === true }
        : { dismissed: [], snoozed: [], autoScanIdle: false };
    } catch { return { dismissed: [], snoozed: [], autoScanIdle: false }; }
  });
  const dismissNextAction = useCallback((fingerprint) => {
    if (!fingerprint) return;
    setNextActionsPrefs(prev => prev.dismissed.includes(fingerprint) ? prev : { ...prev, dismissed: [...prev.dismissed, fingerprint] });
  }, []);
  const snoozeNextAction = useCallback((fingerprint) => {
    if (!fingerprint) return;
    setNextActionsPrefs(prev => prev.snoozed.includes(fingerprint) ? prev : { ...prev, snoozed: [...prev.snoozed, fingerprint] });
  }, []);
  const restoreNextAction = useCallback((fingerprint) => {
    setNextActionsPrefs(prev => ({
      ...prev,
      dismissed: prev.dismissed.filter(fp => fp !== fingerprint),
      snoozed: prev.snoozed.filter(fp => fp !== fingerprint),
    }));
  }, []);
  // "ⓘ Por que isso importa" expansível por card — efêmero (não persiste, mesmo padrão de
  // `panelDrag`/`activeCell`); "ver descartados" também efêmero (toggle de visualização).
  const [expandedActionWhy, setExpandedActionWhy] = useState(() => new Set());
  const [showDiscardedActions, setShowDiscardedActions] = useState(false);
  const toggleActionWhy = useCallback((id) => {
    setExpandedActionWhy(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  // Fingerprint do PolicyIR no momento da última Documentação gerada com sucesso (DEC-NB-002)
  // — DERIVADO (não persiste; o próprio docModal também não persiste hoje). Snapshot do
  // `policyFingerprint` já computado pelo worker no NEXT_ACTIONS_RESULT mais recente (mesmo
  // algoritmo de fingerprint usado internamente por `computeNextActions` para comparar).
  const [lastDocFingerprint, setLastDocFingerprint] = useState(null);

  // ── Etapas da Política + Checklist de Prontidão (Jornada EP, Sessão EP2) ──────────────
  // `journeyState`: OVERRIDE MANUAL POR ETAPA + CONFIG DO CHECKLIST + COLAPSO DO TRILHO SÃO
  // CRIAÇÃO/CONFIGURAÇÃO DO USUÁRIO (regra inviolável do CLAUDE.md, DEC-EP-006) — persiste em
  // .credito.json (buildProjectPayload/loadProject, schema 3.5) + sessionStorage. O ESTADO
  // DETECTADO (journeyStages/journeyReadiness, abaixo) é DERIVADO e NÃO persiste (mesmo padrão
  // de nextActionsModel/baseProfileResult) — só o que o usuário decidiu persiste.
  const [journeyState, setJourneyState] = useState(() => {
    try {
      const s = sessionStorage.getItem('journey_state_v1');
      const v = s ? JSON.parse(s) : null;
      return (v && typeof v === 'object' && !Array.isArray(v))
        ? {
            stageOverrides: (v.stageOverrides && typeof v.stageOverrides === 'object') ? v.stageOverrides : {},
            readinessConfig: (v.readinessConfig && typeof v.readinessConfig === 'object') ? v.readinessConfig : {},
            railCollapsed: v.railCollapsed === true,
          }
        : { stageOverrides: {}, readinessConfig: {}, railCollapsed: false };
    } catch { return { stageOverrides: {}, readinessConfig: {}, railCollapsed: false }; }
  });
  const setStageOverride = useCallback((stageId, value) => {
    setJourneyState(prev => ({ ...prev, stageOverrides: { ...prev.stageOverrides, [stageId]: value } }));
  }, []);
  const setReadinessCriterionEnabled = useCallback((critId, enabled) => {
    setJourneyState(prev => ({ ...prev, readinessConfig: { ...prev.readinessConfig, [critId]: enabled } }));
  }, []);
  // `journeyStages`/`journeyReadiness`: DERIVADO — recomputado no mesmo debounce barato do
  // feed NB (efeito mais abaixo), nunca persiste. `journeyStageFilter`: qual etapa o clique no
  // trilho está usando para filtrar o feed — efêmero, `null` = sem filtro (mesmo padrão de
  // `showDiscardedActions`).
  const [journeyStages, setJourneyStages] = useState(null);
  const [journeyReadiness, setJourneyReadiness] = useState(null);
  const [journeyStageFilter, setJourneyStageFilter] = useState(null);
  const [readinessModalOpen, setReadinessModalOpen] = useState(false);

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
  // Execução Híbrida H4/H6 — preferência do Motor Python (sidecar opt-in). Default ON:
  // o boot tenta detectar o sidecar automaticamente (release já sobe app+sidecar juntos
  // via serve.py — DEC-HX-003); se a 1ª detecção automática não achar nada, o próprio
  // boot desliga o toggle sozinho (ver effect de detecção abaixo) e o app segue 100% no
  // worker (DEC-HX-001 continua valendo: ausência é estado normal e silencioso). Esse
  // default só vale pra sessão nova/projeto sem a preferência salva — `loadProject`
  // sobrescreve com o que o usuário salvou explicitamente. `url`/`token` só têm efeito no
  // modo dev (release é same-origin, sem config — ver IS_DEV_BUILD). Persistida no
  // contêiner `preferences` do Projeto (sem bump de schema).
  const [computeSidecar,    setComputeSidecar]     = useState({ enabled: true, url: '', token: '' });
  // Status detectado do sidecar (efêmero — nunca persistido, é sempre re-derivado por
  // `detect()`). `reason` espelha o vocabulário do router: not_detected|disabled|
  // no_sidecar|unreachable|protocol_mismatch|ok.
  const [computeSidecarStatus, setComputeSidecarStatus] = useState({ available: false, tier: null, capabilities: null, reason: 'not_detected' });
  const [computeSidecarChecking, setComputeSidecarChecking] = useState(false);
  // ⚙ Hub de Configurações (UX 2.0 — Sessão 3). Modal efêmero (nunca persistido) — o
  // endereço único de toda preferência do app. `settingsModal` = null | { section }.
  // As preferências que ele edita (computeSidecar, toggles de aresta) continuam
  // persistidas onde já estavam (sem bump de schema). `openSettings(sectionId?)` abre o
  // Hub direto numa seção — os 5 deep-links de "ligar o Motor Python" chamam
  // openSettings('motor-python'). A seção aberta por último NÃO persiste.
  const [settingsModal, setSettingsModal] = useState(null);
  const openSettings = useCallback((sectionId) => setSettingsModal({ section: sectionId || 'motor-python' }), []);
  // 🔎 Busca de comandos (UX 2.0 — Sessão 7). Popover efêmero (nunca persistido) — Ctrl+K
  // ou o campo compacto da faixa de abas do Ribbon. `cmdPalette` = null | { query,
  // activeIndex }. Ref espelho (padrão de refs do CLAUDE.md) porque é lido pelo listener
  // global de teclado (guarda Delete/Backspace/Escape do canvas enquanto o popover está
  // aberto — ver useEffect de Keyboard abaixo).
  const [cmdPalette, setCmdPalette] = useState(null);
  const cmdPaletteR = useRef(cmdPalette); useEffect(() => { cmdPaletteR.current = cmdPalette; }, [cmdPalette]);
  const openCmdPalette  = useCallback(() => setCmdPalette({ query: '', activeIndex: 0 }), []);
  const closeCmdPalette = useCallback(() => setCmdPalette(null), []);
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
  //         model?, focusedId?, deepRun?, fallbackNotice?,
  //         scope?: {nodeId,label}|null}  // DEC-FR-002 — "🧩 Clusterizar aqui"
  const [clusterModal, setClusterModal] = useState(null);
  // Editor de Variável de Cluster (aberto pelo ✏️ no chip do painel) — efêmero.
  // null | {csvId, col, draft:ClusterDef, baseValuesByDim:{[dim]:string[]}, notice?, confirmDelete?}
  const [clusterVarModal, setClusterVarModal] = useState(null);
  // Criar Faixas por Risco (Épico FR, DEC-FR-004/008/009/010) — efêmero (só a variável
  // derivada persiste, via rangeDefs). Espelho do clusterModal.
  // null | {step:'form'|'loading'|'result'|'save'|'saved', csvId, col, metric, k, autoK,
  //         monotonic, minShare, model?, scope?: {nodeId,label}|null,
  //         returnTo?: ClusterModalSnapshot|null (DEC-FR-008), compareMonotonicIv?,
  //         save?, savedCol?, savedCsvId?}
  const [rangeModal, setRangeModal] = useState(null);
  // Editor de Variável de Faixas (✏️ no chip 📐 do painel) — efêmero. Espelho do
  // clusterVarModal; `cutsDraft` guarda os textos dos cortes internos em edição.
  // null | {csvId, col, draft:RangeDef, cutsDraft:string[], error, confirmDelete}
  const [rangeVarModal, setRangeVarModal] = useState(null);
  // Decision Lens modal
  const [lensModal,  setLensModal]  = useState(null);   // null | {shapeId, rules, population}
  // Sugestão de próximo nó (Copiloto Sessão 3) — ranking on-demand para a porta selecionada
  const [variableRankingModal, setVariableRankingModal] = useState(null); // null | {portId, loading} | {portId, ...VARIABLE_RANKING_RESULT}
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
  const rangeModalR = useRef(rangeModal); useEffect(()=>{rangeModalR.current=rangeModal},[rangeModal]);
  const rangeVarModalR = useRef(rangeVarModal); useEffect(()=>{rangeVarModalR.current=rangeVarModal},[rangeVarModal]);
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
      } else if (msgType === 'BASE_PROFILE_RESULT') {
        // Explorar a Base (Épico EB, EB2) — `profile.csvId` ecoa a base efetiva (o worker
        // escolhe o winner por população quando exploreCsvId ainda é null); sincroniza o
        // seletor da aba com o que realmente foi calculado.
        const { profile } = e.data;
        setBaseProfileResult(profile);
        if (profile && !profile.error && profile.csvId) {
          setExploreCsvId(cur => cur || profile.csvId);
        }
      } else if (msgType === 'EXPLORE_DATASET_RESULT') {
        // Explorar a Base — builder livre (Épico EB, EB4): dataset largo escopado à base
        // selecionada, cenário fixo AS IS (DEC-EB-011).
        setExploreAnalyticsDataset(e.data.dataset);
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
      } else if (msgType === 'NEXT_ACTIONS_RESULT') {
        // Feed de Próxima Melhor Ação (Jornada NB, Sessão NB1/NB2) — DERIVADO, não persiste.
        nextActionsModelRef.current = e.data.model || null;
        setNextActionsModel(e.data.model || null);
      } else if (msgType === 'FEED_OPPORTUNITIES_RESULT') {
        // Fontes caras do feed (Jornada NB, Sessão NB3) — Descoberta + Simplificação prontas e
        // carimbadas. Guarda o blob `tier2` (ref p/ leitura sem stale + state p/ disparar o
        // efeito que repassa em COMPUTE_NEXT_ACTIONS) e encerra o "buscando…". A costura e o
        // staleness são do worker no próximo feed — aqui só armazenamos.
        nextActionsTier2Ref.current = e.data.tier2 || {};
        setNextActionsTier2(e.data.tier2 || {});
        autoScanLastFpRef.current = e.data.policyFingerprint ?? null;
        setNextActionsScanning(false);
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
        // Feed de Próxima Melhor Ação (DEC-NB-002): carimba o fingerprint do PolicyIR no
        // momento desta geração — mesmo algoritmo do `policyFingerprint` já calculado pelo
        // último NEXT_ACTIONS_RESULT (ambos partem de shapesR.current/connsR.current do
        // mesmo instante); o card "document" compara este valor contra o fingerprint atual.
        setLastDocFingerprint(nextActionsModelRef.current?.policyFingerprint ?? null);
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
      } else if (msgType === 'RISK_BANDS_RESULT') {
        // Criar Faixas por Risco (Classe A, DEC-FR-004) — `reqTag` distingue o pedido
        // PRINCIPAL da consulta-sombra "melhor monotônico" (DEC-FR-005, "ambos os IVs"
        // com o toggle livre ligado).
        const { rangeModel, reqTag } = e.data;
        if (reqTag === 'compareMono') {
          setRangeModal(m => (m ? { ...m, compareMonotonicIv: rangeModel?.error ? null : rangeModel.quality?.iv ?? null } : m));
        } else {
          setRangeModal(m => (m ? { ...m, step: 'result', model: rangeModel, compareMonotonicIv: null } : m));
          // DEC-FR-005: toggle "permitir faixas não monotônicas" ligado ⇒ busca também a
          // melhor solução monotônica só para comparação de IV (nunca substitui o resultado
          // livre já exibido).
          const cur = rangeModalR.current;
          if (rangeModel && !rangeModel.error && cur && cur.monotonic === false) {
            const scopeMsg = cur.scope ? { shapes: shapesR.current, conns: connsR.current, scope: { nodeId: cur.scope.nodeId } } : {};
            workerRef.current?.postMessage({
              type: 'COMPUTE_RISK_BANDS', reqTag: 'compareMono',
              csvId: cur.csvId, col: cur.col, metric: cur.metric,
              ...(cur.autoK ? { autoK: true } : { k: cur.k }),
              monotonic: true,
              ...(cur.minShare != null ? { minShare: cur.minShare } : {}),
              ...scopeMsg,
            });
          }
        }
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
    if (!computeRouterRef.current) return null;
    setComputeSidecarChecking(true);
    try {
      const status = await computeRouterRef.current.detect();
      setComputeSidecarStatus(status);
      return status;
    } finally {
      setComputeSidecarChecking(false);
    }
  }, []);
  const computeSidecarStatusR = useRef(computeSidecarStatus);
  useEffect(()=>{computeSidecarStatusR.current=computeSidecarStatus},[computeSidecarStatus]);

  // Sidecar provider é recriado quando URL/token mudam (o proxy acima garante que o
  // router não precisa saber disso). Re-detecta em seguida — debounced (400ms) pra não
  // disparar um round-trip HTTP a cada tecla digitada no campo de token/URL do modo dev.
  // `bootSidecarCheckDoneRef` marca a 1ª detecção automática do boot: só ELA pode
  // auto-desligar o toggle quando o sidecar não responde (tenta primeiro, desliga
  // sozinho se não achar — ver default `enabled:true` acima). Checagens manuais
  // subsequentes (botão "Verificar conexão", digitar URL/token em dev) nunca
  // auto-desligam — senão atrapalharia quem está configurando o sidecar em dev.
  const bootSidecarCheckDoneRef = useRef(false);
  useEffect(() => {
    sidecarProviderRef.current = createSidecarProvider({
      url: computeSidecar.url || (IS_DEV_BUILD ? 'http://127.0.0.1:8090' : ''),
      token: computeSidecar.token || '',
    });
    if (!computeSidecar.enabled) {
      bootSidecarCheckDoneRef.current = true;
      setComputeSidecarStatus({ available: false, tier: null, capabilities: null, reason: 'disabled' });
      return;
    }
    const isBootCheck = !bootSidecarCheckDoneRef.current;
    const t = setTimeout(async () => {
      const status = await detectSidecar();
      bootSidecarCheckDoneRef.current = true;
      if (isBootCheck && status && !status.available) {
        setComputeSidecar(prev => ({ ...prev, enabled: false }));
      }
    }, 400);
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

  // ── Feed de Próxima Melhor Ação — COMPUTE_NEXT_ACTIONS (Jornada NB, Sessão NB1/NB2) ──
  // Orquestrador do worker SOBRE as fontes já computadas nesta thread (lint acima,
  // nodeArrivals/lensCounts da própria simulação, PolicyIR) — mesmo debounce barato do
  // lint (DEC-NB-001). Tier 2 (Descoberta/Simplificação) chega PRONTO da última "🔎 Buscar
  // oportunidades" (Sessão NB3) via `nextActionsTier2` — o worker só COSTURA e deriva o
  // staleness; o disparo caro é sob demanda/idle, NUNCA neste debounce do tick.
  const nextActionsDebounceRef = useRef(null);
  useEffect(() => {
    clearTimeout(nextActionsDebounceRef.current);
    nextActionsDebounceRef.current = setTimeout(() => {
      // Variável pendente de mapeamento (Biblioteca de Políticas, DEC-NB-002): losango
      // materializado sem variável mapeada — `applyPolicyVarMapping` deixa `variableCol`
      // null mas preserva o `label` original do template. Dedup por nome (1 card por var).
      const pendingVars = [];
      const seenPending = new Set();
      for (const s of shapesR.current) {
        if (s.type === 'decision' && !s.variableCol && s.label && !seenPending.has(s.label)) {
          seenPending.add(s.label);
          pendingVars.push({ name: s.label });
        }
      }
      const hasAsIs = Object.values(csvStoreR.current).some(c => !!c?.asIsConfig);
      // "Madura" (heurística v1 — o detector real é o Épico EP/policyJourney, ainda não
      // construído): tem terminal Aprovado E Reprovado, e nenhum achado bloqueante do lint.
      const policyMature = shapesR.current.some(s => s.type === 'approved')
        && shapesR.current.some(s => s.type === 'rejected')
        && !copilotFindings.some(f => f.severity === 'error');
      const activeName = canvasesR.current[activeCanvasIdR.current]?.name ?? null;
      const hasLibraryTemplate = policyLibraryR.current.some(it => it.name === activeName);
      const lockedNodeIds = shapesR.current.filter(s => s.locked).map(s => s.id);
      // `ir` construído aqui (buildPolicyIR só existe em App.jsx); o worker lê nodeArrivals/
      // lensCounts do próprio cache do tick (getTickResult) e `workerCsvStore` já sincronizado
      // via UPDATE_CSV_STORE — nenhum dos dois viaja nesta mensagem (mesmo padrão de
      // COMPUTE_POLICY_INSIGHTS, que também só envia shapes/conns).
      const ir = buildPolicyIR(shapesR.current, connsR.current, csvStoreR.current, { name: activeName });
      workerRef.current?.postMessage({
        type: 'COMPUTE_NEXT_ACTIONS',
        shapes: shapesR.current, conns: connsR.current, ir,
        context: {
          canvasId: activeCanvasIdR.current,
          baseLoaded: Object.keys(csvStoreR.current).length > 0,
          baseExplored: !!baseProfileResult && !baseProfileResult.error,
          riskMetric: exploreRiskMetric,
          hasAsIs, pendingVars, policyMature, hasLibraryTemplate, lockedNodeIds,
          lastDocFingerprint,
        },
        tier2: nextActionsTier2Ref.current,
      });

      // ── Etapas da Política + Checklist de Prontidão (Jornada EP, Sessão EP2) ───────────
      // Motor PURO (policyJourney.js) — roda direto na main, sem round-trip ao worker (custo
      // estrutural, não varredura de base); reusa exatamente os mesmos insumos do feed acima
      // (ir/pendingVars/hasAsIs/lastDocFingerprint) + coverage do último tick de simulação +
      // o Perfil da Base (EB) + a Simplificação Tier 2 (mesmo blob do feed, sem recomputar).
      const sim = simResultR.current;
      const coverage = sim && sim.totalQty > 0
        ? { totalQty: sim.totalQty, decidedQty: (sim.approvedQty || 0) + (sim.rejectedQty || 0) }
        : null;
      const journeyArtifacts = {
        ir,
        lint: copilotFindings,
        coverage,
        pendingVars,
        hasAsIs,
        docFingerprint: lastDocFingerprint,
        baseProfile: baseProfileResult,
        simplify: nextActionsTier2Ref.current?.simplify ?? null,
        calibrationApplied: !!canvasesR.current[activeCanvasIdR.current]?.calibrationApplied,
        goalMet: false, // metas de negócio persistentes por projeto: fora de escopo (roadmap)
        overrides: journeyState.stageOverrides,
        readinessConfig: journeyState.readinessConfig,
      };
      setJourneyStages(detectJourneyStages(shapesR.current, connsR.current, csvStoreR.current, journeyArtifacts));
      setJourneyReadiness(computeReadiness(shapesR.current, connsR.current, csvStoreR.current, journeyArtifacts, journeyState.readinessConfig));
    }, 300);
    return () => clearTimeout(nextActionsDebounceRef.current);
  }, [shapes, conns, csvStore, activeCanvasId, canvases, exploreRiskMetric, baseProfileResult, policyLibrary, copilotFindings, lastDocFingerprint, nextActionsTier2, journeyState]);

  // autoScanIdle (Sessão NB3): o efeito de rebusca em idle vive JUNTO de `runOpportunityScan`
  // (definido bem depois no corpo do componente) para não referenciá-lo antes da inicialização.

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

  // ── Explorar a Base — COMPUTE_BASE_PROFILE (Épico EB, EB2, DEC-EB-002) ──────
  // Pipeline PRÓPRIO, fora do cache do tick: recomputa só quando a base ou a métrica-alvo
  // mudam (debounced), NUNCA a cada edição de canvas (shapes/conns não entram nas deps) —
  // Classe A absoluta, roda inteiro no worker (DEC-HX-007). Só computa enquanto a aba
  // Explorar está aberta (mesmo racional de custo de COMPUTE_ANALYTICS_DATASET acima).
  const baseProfileDebounceRef = useRef(null);
  useEffect(() => {
    clearTimeout(baseProfileDebounceRef.current);
    if (activeTab !== 'explore') return;
    baseProfileDebounceRef.current = setTimeout(() => {
      workerRef.current?.postMessage({ type: 'COMPUTE_BASE_PROFILE', params: { csvId: exploreCsvId || undefined, riskMetric: exploreRiskMetric } });
    }, 300);
    return () => clearTimeout(baseProfileDebounceRef.current);
  }, [csvStore, exploreCsvId, exploreRiskMetric, activeTab]);

  // ── Explorar a Base — builder livre (Épico EB, EB4, DEC-EB-011) ─────────────────
  // COMPUTE_EXPLORE_DATASET: MESMO racional de custo/debounce do perfil acima — só computa
  // com a aba Explorar aberta e uma base selecionada; nunca depende de shapes/conns (não é
  // o tick de edição, é análise sobre a base observada).
  const exploreDatasetDebounceRef = useRef(null);
  useEffect(() => {
    clearTimeout(exploreDatasetDebounceRef.current);
    if (activeTab !== 'explore' || !exploreCsvId) return;
    exploreDatasetDebounceRef.current = setTimeout(() => {
      workerRef.current?.postMessage({ type: 'COMPUTE_EXPLORE_DATASET', csvId: exploreCsvId });
    }, 300);
    return () => clearTimeout(exploreDatasetDebounceRef.current);
  }, [csvStore, exploreCsvId, activeTab]);

  // Persiste layout do dashboard na sessionStorage para sobreviver a reloads dentro da mesma sessão.
  useEffect(() => { sessionStorage.setItem('aw_layout_v1', JSON.stringify(analyticsLayout)); }, [analyticsLayout]);
  useEffect(() => { sessionStorage.setItem('aw_groupings_v1', JSON.stringify(analyticsGroupings)); }, [analyticsGroupings]);
  useEffect(() => { sessionStorage.setItem('aw_page_filters_v1', JSON.stringify(analyticsPageFilters)); }, [analyticsPageFilters]);
  // Explorar a Base (Épico EB, EB2, DEC-EB-007): persiste o layout por base na sessionStorage.
  useEffect(() => { try { sessionStorage.setItem('explore_layouts_v1', JSON.stringify(exploreLayouts)); } catch { /* quota/privacidade — não bloqueia */ } }, [exploreLayouts]);
  // Explorar a Base — builder livre (Épico EB, EB4, DEC-EB-011): agrupamentos/filtro de página por base.
  useEffect(() => { try { sessionStorage.setItem('explore_groupings_v1', JSON.stringify(exploreGroupings)); } catch { /* quota/privacidade — não bloqueia */ } }, [exploreGroupings]);
  useEffect(() => { try { sessionStorage.setItem('explore_page_filters_v1', JSON.stringify(explorePageFilters)); } catch { /* quota/privacidade — não bloqueia */ } }, [explorePageFilters]);
  // Feed de Próxima Melhor Ação (Jornada NB, Sessão NB2, DEC-NB-006): persiste descarte/adiamento.
  useEffect(() => { try { sessionStorage.setItem('next_actions_prefs_v1', JSON.stringify(nextActionsPrefs)); } catch { /* quota/privacidade — não bloqueia */ } }, [nextActionsPrefs]);
  // journeyState (Jornada EP, Sessão EP2, DEC-EP-006) — mesmo padrão de auto-persistência de
  // sessão do nextActionsPrefs acima.
  useEffect(() => { try { sessionStorage.setItem('journey_state_v1', JSON.stringify(journeyState)); } catch { /* quota/privacidade — não bloqueia */ } }, [journeyState]);
  // Ribbon (UX 2.0 — Sessão 1): persiste a aba ativa do Ribbon na sessionStorage.
  useEffect(() => { try { sessionStorage.setItem('ribbon_active_tab_v1', ribbonActiveTab); } catch { /* quota/privacidade — não bloqueia */ } }, [ribbonActiveTab]);
  useEffect(() => { try { sessionStorage.setItem('ribbon_mode_v1', ribbonMode); } catch { /* quota/privacidade — não bloqueia */ } }, [ribbonMode]);
  // Status Bar (UX 2.0 — Sessão 5): persiste os indicadores escolhidos.
  useEffect(() => { try { sessionStorage.setItem('status_bar_indicators_v1', JSON.stringify(statusBarIndicators)); } catch { /* quota/privacidade — não bloqueia */ } }, [statusBarIndicators]);
  // Painel direito (UX 2.0 — Sessão 6): persiste a aba interna ativa (Ativos/Inspetor/Copiloto).
  useEffect(() => { try { sessionStorage.setItem('right_panel_mode_v1', rightPanelMode); } catch { /* quota/privacidade — não bloqueia */ } }, [rightPanelMode]);

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

  // ═══ REGIÃO: Handlers de Canvas (mouse/touch) ═══
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

  // Duplicar seleção (UX 2.0 — Sessão 8, mini-flutuante + Início›Edição). Mesmo escopo de
  // "o que viaja junto" que deleteSelected: duplicar um losango/Cineminha também duplica as
  // portas que só ele referencia. Reusa cloneCanvasWithNewIds (mesmo helper do duplicateCanvas)
  // sobre o subconjunto selecionado + suas conexões internas; cópia nasce deslocada (+32,+32)
  // e selecionada.
  const duplicateSelected = useCallback(() => {
    const ids = multiSelR.current.size > 0 ? [...multiSelR.current] : (selR.current ? [selR.current] : []);
    if (ids.length === 0) return;
    const shapes_ = shapesR.current;
    const conns_  = connsR.current;
    const idSet = new Set(ids);
    for (const id of ids) {
      const shape = shapes_.find(s=>s.id===id);
      if (shape?.type==="decision"||shape?.type==="cineminha") {
        conns_.filter(c=>c.from===id).forEach(c=>{
          if (shapes_.find(s=>s.id===c.to&&s.type==="port")) idSet.add(c.to);
        });
      }
    }
    const srcShapes = shapes_.filter(s=>idSet.has(s.id));
    if (srcShapes.length===0) return;
    const srcConns = conns_.filter(c=>idSet.has(c.from)&&idSet.has(c.to));
    pushHistory();
    const { newShapes, newConns } = cloneCanvasWithNewIds(srcShapes, srcConns);
    const OFFSET = 32;
    const offsetShapes = newShapes.map(s=>({...s, x:s.x+OFFSET, y:s.y+OFFSET}));
    setShapes(p=>[...p, ...offsetShapes]);
    setConns(p=>[...p, ...newConns]);
    const newSelIds = offsetShapes.filter(s=>s.type!=="port").map(s=>s.id);
    if (newSelIds.length===1) { setSel(newSelIds[0]); setMultiSel(new Set()); }
    else { setSel(null); setMultiSel(new Set(newSelIds)); }
    setPalette(false);
  }, []); // eslint-disable-line

  // ── Auto Layout ──────────────────────────────────────────────
  const autoLayoutRafRef = useRef(null);
  const autoLayout = useCallback(() => {
    const shapes_ = shapesR.current;
    const conns_  = connsR.current;
    if (shapes_.length === 0) return;

    // Cálculo puro das posições de destino vive em ./autoLayout.js (movido em C4).
    // A animação por RAF + pushHistory/setShapes fica aqui (dependência de closure
    // do componente: refs, setState). Ver docs/claude/Auto-Layout.md.
    const { starts, allTargets } = computeAutoLayout(shapes_, conns_, {
      edgeStats: simResultR.current?.edgeStats || {},
      showV: showEdgeVolR.current,
      showR: showEdgeInadRealR.current,
      showI: showEdgeInadInfR.current,
    });

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
      // Busca de comandos aberta: o próprio popover captura (stopPropagation) Escape/setas/
      // Enter/Ctrl+K no seu input; esta guarda é defesa extra para nunca deixar Delete/
      // Backspace/Escape vazarem pro canvas enquanto o usuário digita a query.
      if (cmdPaletteR.current) return;
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
      // Undo / Redo + ⚙ Configurações (Ctrl+,)
      if (e.ctrlKey||e.metaKey) {
        if (e.key==="z"||e.key==="Z") { e.preventDefault(); undo(); return; }
        if (e.key==="y"||e.key==="Y") { e.preventDefault(); redo(); return; }
        if (e.key===",") { e.preventDefault(); openSettings(); return; }
        if (e.key==="k"||e.key==="K") { e.preventDefault(); openCmdPalette(); return; }
      }
      if (e.key==="Delete"||e.key==="Backspace") {
        const ms=multiSelR.current;
        if (ms.size>0||selR.current) deleteSelected();
      }
      if (e.key==="Escape"){setFromId(null);setSel(null);}
    };
    window.addEventListener("keydown",h); return()=>window.removeEventListener("keydown",h);
  },[undo, redo, deleteSelected, openSettings, openCmdPalette]);

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
    // Convite pós-import (Épico EB, EB4, DEC-EB-012) — nunca bloqueante: aponta para a
    // aba Explorar, onde a análise da base já nasce pronta assim que o worker terminar
    // o perfil (COMPUTE_BASE_PROFILE). Dispensável a qualquer momento.
    setPostImportInvite({ csvId, filename });
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

  // ═══ REGIÃO: Persistência (Projeto / sessionStorage) ═══
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
      schemaVersion: PROJECT_SCHEMA_VERSION,
      kind: "credito-project",
      generatedAt: new Date().toISOString(),
      activeTab,
      ribbonActiveTab,
      ribbonMode,
      statusBarIndicators,
      rightPanelMode,
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
      // Explorar a Base (Épico EB, EB2, DEC-EB-007) — layout por base; o BaseProfileModel
      // em si é DERIVADO (recomputável) e não persiste.
      exploreLayouts,
      // Explorar a Base — builder livre (Épico EB, EB4, DEC-EB-011) — agrupamentos e filtro
      // de página do builder livre, por base (o dataset largo em si é DERIVADO e não persiste).
      exploreGroupings,
      explorePageFilters,
      // Feed de Próxima Melhor Ação (Épico NB, Sessão NB2, DEC-NB-006) — descarte/adiamento
      // por card é CRIAÇÃO DO USUÁRIO (regra inviolável do CLAUDE.md); o NextActionsModel em
      // si é DERIVADO (recomputável) e não persiste, mesmo padrão do BaseProfileModel.
      nextActionsPrefs,
      // Etapas da Política + Checklist de Prontidão (Épico EP, Sessão EP2, DEC-EP-006) —
      // override manual por etapa + config do checklist + colapso do trilho são CRIAÇÃO DO
      // USUÁRIO; o estado detectado (journeyStages/journeyReadiness) é DERIVADO e não persiste.
      journeyState,
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
    // schema < 3.2 não tinha exploreLayouts — default defensivo, projeto antigo não quebra.
    setExploreLayouts((data.exploreLayouts && typeof data.exploreLayouts === 'object' && !Array.isArray(data.exploreLayouts)) ? data.exploreLayouts : {});
    // schema < 3.3 não tinha exploreGroupings/explorePageFilters (builder livre, EB4) —
    // default defensivo, projeto antigo não quebra.
    setExploreGroupings((data.exploreGroupings && typeof data.exploreGroupings === 'object' && !Array.isArray(data.exploreGroupings)) ? data.exploreGroupings : {});
    setExplorePageFilters((data.explorePageFilters && typeof data.explorePageFilters === 'object' && !Array.isArray(data.explorePageFilters)) ? data.explorePageFilters : {});
    // schema < 3.4 não tinha nextActionsPrefs (Feed de Próxima Melhor Ação, NB2) — default
    // defensivo por campo (arquivo pode ter só parte do contêiner), projeto antigo não quebra.
    {
      const p = (data.nextActionsPrefs && typeof data.nextActionsPrefs === 'object') ? data.nextActionsPrefs : {};
      setNextActionsPrefs({
        dismissed: Array.isArray(p.dismissed) ? p.dismissed : [],
        snoozed: Array.isArray(p.snoozed) ? p.snoozed : [],
        autoScanIdle: p.autoScanIdle === true,
      });
    }
    // schema < 3.5 não tinha journeyState (Etapas + Checklist de Prontidão, EP2) — default
    // defensivo por campo, projeto antigo não quebra.
    {
      const j = (data.journeyState && typeof data.journeyState === 'object') ? data.journeyState : {};
      setJourneyState({
        stageOverrides: (j.stageOverrides && typeof j.stageOverrides === 'object') ? j.stageOverrides : {},
        readinessConfig: (j.readinessConfig && typeof j.readinessConfig === 'object') ? j.readinessConfig : {},
        railCollapsed: j.railCollapsed === true,
      });
    }
    setCinemaLibrary(Array.isArray(data.cinemaLibrary) ? data.cinemaLibrary : []);
    // schema ≤ 2.3 não tinha policyLibrary — default defensivo, projeto antigo não quebra.
    setPolicyLibrary(Array.isArray(data.policyLibrary) ? data.policyLibrary : []);
    if (data.businessWidget) setBusinessWidget(data.businessWidget);
    if (data.viewport) setVp(data.viewport);
    if (data.activeTab) setActiveTab(data.activeTab);
    // Ribbon (UX 2.0 — Sessão 1): default defensivo p/ projetos antigos (schema < 2.8).
    setRibbonActiveTab(typeof data.ribbonActiveTab === 'string' ? data.ribbonActiveTab : 'inicio');
    // Ribbon colapso (UX 2.0 — Sessão 4): default defensivo p/ projetos antigos (schema < 2.9).
    setRibbonMode((data.ribbonMode === 'compact' || data.ribbonMode === 'auto' || data.ribbonMode === 'fixed') ? data.ribbonMode : defaultRibbonModeForScreen());
    // Status Bar (UX 2.0 — Sessão 5): default defensivo p/ projetos antigos (schema < 3.0) —
    // filtra para ids conhecidos, para uma versão futura desconhecida não quebrar a barra.
    {
      const validIds = new Set(STATUS_BAR_INDICATORS_META.map(m => m.id));
      const loadedIndicators = Array.isArray(data.statusBarIndicators)
        ? data.statusBarIndicators.filter(id => validIds.has(id))
        : DEFAULT_STATUS_BAR_INDICATORS;
      setStatusBarIndicators(loadedIndicators);
    }
    // Painel direito (UX 2.0 — Sessão 6): default defensivo p/ projetos antigos (schema < 3.1).
    setRightPanelMode((data.rightPanelMode === 'inspector' || data.rightPanelMode === 'copilot') ? data.rightPanelMode : 'assets');
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

  // ═══ REGIÃO: Cineminha, Decision Lens e Handlers de Nó (helpers) ═══
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

  // ═══ REGIÃO: Render de Shapes (inclui Cineminha) ═══
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

  // Marca o canvas como tendo passado por um otimizador (Goal Seek/Cineminha/Johnny) — sinal
  // estrutural de E5 Calibração (Jornada EP, `artifacts.calibrationApplied`, DEC-EP-002). Vive
  // DENTRO de `canvases[canvasId]`, contêiner já persistido (buildProjectPayload/loadProject) —
  // nenhum trabalho extra de schema (regra do CLAUDE.md: campo novo dentro de contêiner já salvo).
  const markCalibrationApplied = (canvasId) => {
    setCanvases(prev => prev[canvasId] ? { ...prev, [canvasId]: { ...prev[canvasId], calibrationApplied: true } } : prev);
  };

  const applyOptimResult = (shapeId, proposedCells) => {
    pushHistory();
    setShapes(prev => prev.map(s => s.id === shapeId ? { ...s, cellsUserEdited: true, cells: proposedCells } : s));
    markCalibrationApplied(activeCanvasIdR.current);
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
    markCalibrationApplied(activeCanvasIdR.current);
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
      [id]: { id, name: `${source?.name || 'Canvas'} · ${label}`, shapes: patchedShapes, conns: patchedConns, includeInDashboard: true, calibrationApplied: true },
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

  // ── "🔎 Buscar oportunidades" — fontes caras do feed (Jornada NB, Sessão NB3) ─────
  // Roda a Descoberta de Segmentos (escopo GLOBAL, MESMOS params default do modal — inclusive
  // os `excludedCols` temporais/score da heurística segVarDefaultReason) + a Simplificação,
  // FORA do caminho do tick (DEC-NB-002). O worker devolve o blob `tier2` carimbado; a costura
  // e o staleness são derivados no próximo COMPUTE_NEXT_ACTIONS. Nenhum motor caro no tick de
  // edição — este é o único disparo (mais o autoScanIdle em idle real, mesmo caminho).
  const feedScanDefaultParams = useCallback(() => {
    // Réplica dos defaults do openSegmentDiscoveryModal (escopo global): temporal/score saem
    // marcados por segVarDefaultReason; o resto entra na busca.
    const seen = new Set();
    const excludedCols = [];
    for (const csv of Object.values(csvStoreR.current)) {
      for (const [col, t] of Object.entries(csv.columnTypes || {})) {
        if (t !== 'decision' || seen.has(col)) continue;
        seen.add(col);
        if (segVarDefaultReason(col)) excludedCols.push(col);
      }
    }
    return { riskMetric: 'inadReal', maxDepth: 2, ...(excludedCols.length ? { excludedCols } : {}) };
  }, []);

  const runOpportunityScan = useCallback(() => {
    if (!workerRef.current) return;
    setNextActionsScanning(true);
    const activeName = canvasesR.current[activeCanvasIdR.current]?.name ?? null;
    const ir = buildPolicyIR(shapesR.current, connsR.current, csvStoreR.current, { name: activeName });
    workerRef.current.postMessage({
      type: 'COMPUTE_FEED_OPPORTUNITIES',
      shapes: shapesR.current,
      conns: connsR.current,
      ir,
      params: feedScanDefaultParams(),
    });
  }, [feedScanDefaultParams]);

  // ── autoScanIdle — rebusca das fontes caras em idle REAL (Jornada NB, Sessão NB3) ──
  // Opt-in OFF por default (Hub de Configurações → nextActionsPrefs.autoScanIdle). Quando ON,
  // reroda "🔎 Buscar oportunidades" em ociosidade — NUNCA no tick (regra de ouro DEC-NB-002) —
  // só quando a política MUDOU desde a última busca (fingerprint ≠ autoScanLastFpRef) e há
  // política com base para varrer. requestIdleCallback (com fallback a setTimeout) garante que
  // só dispara quando a main está de fato ociosa; a marcação de staleness é a mesma da busca
  // manual (o carimbo vem do worker). Não faz nada sem opt-in. Fica AQUI (e não junto dos
  // outros efeitos do feed) por depender de `runOpportunityScan`, definido logo acima.
  const autoScanIdleHandleRef = useRef(null);
  useEffect(() => {
    const cancelIdle = () => {
      const h = autoScanIdleHandleRef.current;
      if (!h) return;
      if (h.type === 'idle' && typeof cancelIdleCallback === 'function') cancelIdleCallback(h.id);
      else clearTimeout(h.id);
      autoScanIdleHandleRef.current = null;
    };
    if (!nextActionsPrefs.autoScanIdle) { cancelIdle(); return; }
    const model = nextActionsModel;
    if (!model || nextActionsScanning) return;
    const hasBase = Object.keys(csvStoreR.current).length > 0;
    const hasPolicy = shapesR.current.some(s => s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens');
    if (!hasBase || !hasPolicy) return;
    // Só rebusca se a política mudou desde o último carimbo (evita rebuscar o mesmo estado).
    if (model.policyFingerprint == null || model.policyFingerprint === autoScanLastFpRef.current) return;
    cancelIdle();
    const fire = () => { autoScanIdleHandleRef.current = null; runOpportunityScan(); };
    // Debounce longo + idle: "ociosidade real", nunca a cada edição.
    const schedule = () => {
      if (typeof requestIdleCallback === 'function') {
        autoScanIdleHandleRef.current = { type: 'idle', id: requestIdleCallback(fire, { timeout: 3000 }) };
      } else {
        autoScanIdleHandleRef.current = { type: 'timeout', id: setTimeout(fire, 1500) };
      }
    };
    const t = setTimeout(schedule, 1200);
    autoScanIdleHandleRef.current = { type: 'timeout', id: t };
    return cancelIdle;
  }, [nextActionsPrefs.autoScanIdle, nextActionsModel, nextActionsScanning, runOpportunityScan]);

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
  // FR3 (DEC-FR-003) — teto da máscara de escopo no modo profundo: acima dele o bitmask
  // base64 pesaria demais no POST local (10M linhas ≈ 1,7MB base64; 20M ≈ 3,4MB) e o
  // escopo profundo cai DECLARADAMENTE no worker clampado, com o MESMO escopo.
  const FR_MASK_MAX_ROWS = 20_000_000;
  const clusterAbortRef = useRef(null);

  // scope = {nodeId} (toolbar "🧩 Clusterizar aqui") ou null/ausente (painel = global,
  // DEC-FR-002). O label é resolvido AGORA (momento da abertura), mesmo fallback do
  // resto do app (shapesById.get(...).label || nodeId) — a pílula do modal usa esse
  // label fixo mesmo que o nó seja renomeado depois, enquanto o modal está aberto.
  const openClusterModal = (scope) => {
    const store = csvStoreR.current || {};
    // default = base de maior nº de linhas (mesmo critério do motor)
    let csvId = null, best = -1;
    for (const id of Object.keys(store)) {
      const n = store[id]?.rowCount || 0;
      if (n > best) { best = n; csvId = id; }
    }
    const resolvedScope = (scope && scope.nodeId)
      ? { nodeId: scope.nodeId, label: shapesById.get(scope.nodeId)?.label || scope.nodeId }
      : null;
    setClusterModal({
      step: 'form', csvId, dims: [], k: 4, autoK: false, method: 'kmeans',
      model: null, focusedId: null, deepRun: null, fallbackNotice: null,
      scope: resolvedScope,
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
    // DEC-FR-002: escopado ⇒ shapes/conns/scope na mensagem (ausentes ⇒ global,
    // retrocompat total do handler COMPUTE_CLUSTER_SEGMENTS, FR1).
    const scopeMsg = cur.scope
      ? { shapes: shapesR.current, conns: connsR.current, scope: { nodeId: cur.scope.nodeId } }
      : {};
    const isDeep = cur.dims.length > CLU_BROWSER_DIMS || cur.k > CLU_BROWSER_K ||
      cur.autoK || cur.method !== 'kmeans';
    // Modo raso (dentro dos tetos) ou sem router: worker direto, com escopo por nó via
    // shapes/conns/scope (FR1/FR2). Modo profundo COM router: rota profunda (sidecar),
    // que a partir da FR3 (DEC-FR-003) também sabe escopo por nó — a máscara viaja nos
    // params do job (o walk de política jamais vai ao Python).
    if (!isDeep || !computeRouterRef.current) {
      setClusterModal(m => ({ ...m, step: 'loading', deepRun: null, fallbackNotice: null }));
      workerRef.current?.postMessage({ type: 'COMPUTE_CLUSTER_SEGMENTS', params, ...scopeMsg });
      return;
    }
    runDeepClusterSegments(params, cur.scope || null);
  };

  const runDeepClusterSegments = async (params, scope = null) => {
    const ctrl = new AbortController();
    clusterAbortRef.current = ctrl;
    setClusterModal(m => (m ? {
      ...m, step: 'loading', fallbackNotice: null,
      deepRun: { progress: null, via: 'sidecar' },
    } : m));
    try {
      // FR3 (DEC-FR-003) — escopo por nó no modo profundo: a máscara de linhas é
      // produzida pelo WORKER (resolveScopeRowMask; o walk de política JAMAIS é portado ao
      // Python) e viaja nos `params.rowMask` do job. Acima de FR_MASK_MAX_ROWS o escopo
      // profundo cai DECLARADAMENTE no worker clampado, preservando o MESMO escopo.
      let jobParams = params;
      if (scope && scope.nodeId) {
        const maskRes = await computeRouterRef.current.run('COMPUTE_SCOPE_MASK', {
          shapes: shapesR.current, conns: connsR.current,
          scope: { nodeId: scope.nodeId }, csvId: params.csvId,
        });
        if (ctrl.signal.aborted) return;
        const rowMask = (maskRes && maskRes.result) || {};
        if (!rowMask.maskB64 || (rowMask.rowCount || 0) > FR_MASK_MAX_ROWS) {
          // Teto/máscara indisponível ⇒ worker clampado COM o mesmo escopo (shapes/conns/
          // scope). O motor no worker devolve no_rows se a subpopulação for vazia — nunca
          // um cluster global silencioso quando o usuário pediu por nó.
          setClusterModal(m => (m ? {
            ...m, deepRun: null,
            fallbackNotice: (rowMask.rowCount || 0) > FR_MASK_MAX_ROWS
              ? `Base grande demais (${(rowMask.rowCount || 0).toLocaleString('pt-BR')} linhas) para o escopo por nó no Motor Python — acima do teto de ${FR_MASK_MAX_ROWS / 1e6} milhões de linhas da máscara, a clusterização escopada rodou no navegador com os tetos declarados (até 3 dimensões, k ≤ 8, k-means).`
              : 'A clusterização escopada rodou no navegador com os tetos declarados (até 3 dimensões, k ≤ 8, k-means).',
          } : m));
          workerRef.current?.postMessage({
            type: 'COMPUTE_CLUSTER_SEGMENTS', params,
            shapes: shapesR.current, conns: connsR.current, scope: { nodeId: scope.nodeId },
          });
          return;
        }
        jobParams = {
          ...params,
          scope: { nodeId: scope.nodeId, label: scope.label },
          rowMask: { csvId: rowMask.csvId, rowCount: rowMask.rowCount, maskB64: rowMask.maskB64 },
        };
      }
      // Dataset por hash (DEC-HX-006) — mesmos chunks do serializeCsvStore/M3 da H7;
      // HEAD 200 pula o upload nas execuções seguintes.
      const serialized = serializeCsvStore(csvStoreR.current);
      const buildChunks = () => [JSON.stringify(serialized)];
      const hash = hashChunks(buildChunks());
      const res = await computeRouterRef.current.run('cluster_segments', { params: jobParams }, {
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
    // DEC-FR-002: cluster calculado numa subpopulação (escopo por nó) — o filtro de
    // página reproduz só as dimensões/valores do cluster, NÃO o walk de política do nó;
    // isso é declarado no Dashboard, nunca escondido.
    const scope = clusterModalR.current?.scope;
    setAnalyticsScopeNotice(scope
      ? `Este filtro veio de um cluster calculado na população que chega a "${scope.label}" — o filtro de página reproduz as dimensões do cluster, não o caminho até o nó.`
      : null);
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

  // ── Criar Faixas por Risco (Épico FR, DEC-FR-004/005/008/009/010) ───────────────
  // Abre o formulário (painel = global; toolbars "📐 Faixas aqui" = escopado por nó,
  // DEC-FR-002/FR1; DEC-FR-008 do form do cluster manda `csvId/col/scope/returnTo`
  // pré-preenchidos). Mesmo critério de csv default do clusterModal (maior nº de linhas).
  const openRangeModal = (opts = {}) => {
    const store = csvStoreR.current || {};
    let csvId = opts.csvId || null, best = -1;
    if (!csvId) {
      for (const id of Object.keys(store)) {
        const n = store[id]?.rowCount || 0;
        if (n > best) { best = n; csvId = id; }
      }
    }
    const rawScope = opts.scope || null;
    const resolvedScope = (rawScope && rawScope.nodeId)
      ? { nodeId: rawScope.nodeId, label: rawScope.label || shapesById.get(rawScope.nodeId)?.label || rawScope.nodeId }
      : null;
    setRangeModal({
      step: 'form', csvId, col: opts.col || null,
      metric: 'inadReal', k: 4, autoK: false, monotonic: true, minShare: null,
      model: null, scope: resolvedScope, returnTo: opts.returnTo || null,
      compareMonotonicIv: null,
    });
  };

  // ── Explorar a Base — Pontes para o fluxo (Épico EB, EB4, DEC-EB-010) ───────────
  // Os 3 CTAs dos cards `varprofile`/`ivrank` REUSAM os aplicadores existentes — nenhum
  // caminho novo de materialização (DEC-IA-002): createDecisionNode (drag-and-drop do
  // painel), openRangeModal/openClusterModal (mesmos do canto "Analisar aqui" do canvas).
  // "➕ Usar como 1º galho": canvas ativo vazio ⇒ cria o losango raiz e centraliza nele;
  // canvas não-vazio ⇒ cria um nó SOLTO ao lado do que já existe (nunca reconecta sozinho)
  // e avisa (exploreActionNotice) que ele precisa ser conectado ao fluxo.
  const exploreUseAsFirstBranch = useCallback((col, csvId) => {
    const svgEl = svgRef.current;
    const svgSize = svgEl ? { width: svgEl.clientWidth, height: svgEl.clientHeight } : { width: 800, height: 600 };
    const { wx, wy, empty } = computeFirstBranchPosition(shapesR.current, vpR.current, svgSize);
    createDecisionNode(col, csvId, wx, wy);
    setActiveTab('canvas');
    setExploreActionNotice(empty ? null : `➕ "${col}" criado como nó solto no canvas — conecte-o ao fluxo.`);
    requestAnimationFrame(() => {
      const svg = svgRef.current;
      if (!svg) return;
      setVp(v => ({ s: v.s, x: svg.clientWidth / 2 - wx * v.s, y: svg.clientHeight / 2 - wy * v.s }));
    });
  }, []);
  // "📐 Criar faixas": só variáveis contínuas (o card já esconde o botão quando
  // `!v.continuous` — o gate aqui é defensivo, mesmo padrão do resto do app). Os modais de
  // Faixas/Clusterização vivem no JSX do CANVAS PANE (display:none fora de
  // activeTab==='canvas') — sem navegar para lá primeiro, o modal monta invisível
  // (display:none em cascata, mesmo com position:fixed/inset:0/z-index alto).
  const exploreCreateRangesFor = useCallback((col, csvId) => {
    setActiveTab('canvas');
    openRangeModal({ csvId, col });
  }, []);
  // "🧩 Clusterizar": abre o modal (mesmo default de base por população) e pré-seleciona
  // a variável como 1ª dimensão — openClusterModal não recebe pré-seleção diretamente
  // (seu único parâmetro é o escopo do nó), então o patch vem logo em seguida; como as duas
  // chamadas são setState funcionais no mesmo gesto, o React aplica em ordem.
  const exploreClusterizeFrom = useCallback((col, csvId) => {
    setActiveTab('canvas');
    openClusterModal(null);
    setClusterModal(m => m ? { ...m, csvId, dims: [col] } : m);
  }, []);
  // "✏️ Editar variável": mesmo editor (clusterVarModal/rangeVarModal) do painel de
  // variáveis do canvas — reusa openClusterVarEdit/openRangeVarEdit sem caminho novo.
  // Precisa navegar para o Canvas primeiro (mesmo motivo do Faixas/Clusterizar acima:
  // os modais vivem no JSX do CANVAS PANE, display:none fora de activeTab==='canvas').
  const exploreEditVar = useCallback((col, csvId) => {
    setActiveTab('canvas');
    if (isClusterVar(csvStoreR.current, csvId, col)) openClusterVarEdit(csvId, col);
    else if (isRangeVar(csvStoreR.current, csvId, col)) openRangeVarEdit(csvId, col);
  }, []);

  // Classe A (DEC-FR-004): SEMPRE no worker, JAMAIS roteia ao sidecar — sem
  // ComputeRouter/deep run, ao contrário da Clusterização.
  const runRiskBands = () => {
    const cur = rangeModalR.current;
    if (!cur || !cur.csvId || !cur.col) return;
    const scopeMsg = cur.scope
      ? { shapes: shapesR.current, conns: connsR.current, scope: { nodeId: cur.scope.nodeId } }
      : {};
    setRangeModal(m => ({ ...m, step: 'loading', compareMonotonicIv: null }));
    workerRef.current?.postMessage({
      type: 'COMPUTE_RISK_BANDS', reqTag: 'primary',
      csvId: cur.csvId, col: cur.col, metric: cur.metric,
      ...(cur.autoK ? { autoK: true } : { k: cur.k }),
      monotonic: cur.monotonic,
      ...(cur.minShare != null ? { minShare: cur.minShare } : {}),
      ...scopeMsg,
    });
  };

  // Passo "Salvar como variável" — pré-preenche nome e rótulos por faixa (formatBandLabel),
  // espelho de openClusterSaveStep.
  const openRangeSaveStep = () => {
    const cur = rangeModalR.current;
    if (!cur || !cur.model || cur.model.error || !cur.csvId) return;
    const headers = csvStoreR.current[cur.csvId]?.headers || [];
    setRangeModal(m => ({
      ...m, step: 'save',
      save: {
        varName: suggestRangeVarName(cur.model, headers),
        labels: (cur.model.bands || []).map(b => b.label ?? formatBandLabel(b.min, b.max)),
        unmatched: 'Sem valor',
        error: null,
      },
    }));
  };

  // Materializa a variável (deriveRangeColumn) e insere a coluna + rangeDefs[col] no
  // csvStore. DEC-FR-008: com `returnTo` (veio do form do cluster), volta direto ao
  // form do cluster com a coluna derivada marcada no lugar da contínua — sem passar
  // pelo passo `saved`.
  const saveRangeVariable = () => {
    const cur = rangeModalR.current;
    if (!cur || !cur.model || !cur.csvId || !cur.save) return;
    const { model, csvId, save } = cur;
    const csv = csvStoreR.current[csvId];
    if (!csv) return;
    const varName = (save.varName || '').trim();
    const labels = (save.labels || []).map(l => (l || '').trim());
    const unmatched = (save.unmatched || '').trim() || 'Sem valor';
    if (!varName) return setRangeModal(m => ({ ...m, save: { ...m.save, error: 'Dê um nome à variável.' } }));
    if ((csv.headers || []).includes(varName))
      return setRangeModal(m => ({ ...m, save: { ...m.save, error: `Já existe uma coluna "${varName}" nesta base.` } }));
    if (labels.some(l => !l))
      return setRangeModal(m => ({ ...m, save: { ...m.save, error: 'Toda faixa precisa de um rótulo.' } }));
    if (new Set(labels).size !== labels.length)
      return setRangeModal(m => ({ ...m, save: { ...m.save, error: 'Os rótulos das faixas devem ser distintos.' } }));

    const def = buildRangeDefFromModel(model, { col: varName, csvId, labels, unmatchedLabel: unmatched, genId: uid });
    const colData = deriveRangeColumn(csv, def);
    setCsvStore(prev => {
      const c = prev[csvId]; if (!c) return prev;
      return {
        ...prev,
        [csvId]: {
          ...c,
          headers: [...c.headers, varName],
          columns: { ...c.columns, [varName]: colData },
          columnTypes: { ...(c.columnTypes || {}), [varName]: 'decision' },
          varTypes: { ...(c.varTypes || {}), [varName]: 'ordinal' },
          rangeDefs: { ...(c.rangeDefs || {}), [varName]: def },
        },
      };
    });
    if (cur.returnTo) {
      setClusterModal({ ...cur.returnTo, dims: [...(cur.returnTo.dims || []), varName], contWarnCol: null });
      setRangeModal(null);
      return;
    }
    setRangeModal(m => ({ ...m, step: 'saved', savedCol: varName, savedCsvId: csvId }));
  };

  // ── Editor da Variável de Faixas (✏️ no chip 📐 do painel) ──────────────────────
  const openRangeVarEdit = (csvId, col) => {
    const csv = csvStoreR.current[csvId];
    const def = csv?.rangeDefs?.[col];
    if (!def) return;
    const bands = def.bands || [];
    const cutsDraft = bands.slice(0, -1).map(b => (b.max != null ? String(b.max) : ''));
    setRangeVarModal({ csvId, col, draft: JSON.parse(JSON.stringify(def)), cutsDraft, error: null, confirmDelete: false });
  };

  // Aplica os cortes digitados (cutsDraft) via editRangeCuts (validação pura) — só
  // atualiza o draft se todos os cortes forem válidos; senão mostra o erro.
  const applyRangeCutsEdit = () => {
    const cur = rangeVarModalR.current;
    if (!cur) return;
    const cuts = cur.cutsDraft.map(s => Number(String(s).replace(',', '.')));
    const { def, error } = editRangeCuts(cur.draft, cuts);
    if (error) return setRangeVarModal(m => ({ ...m, error }));
    setRangeVarModal(m => ({ ...m, draft: def, error: null }));
  };

  // Salva a edição: re-materializa, renomeia coluna/rótulos e propaga referências por
  // todas as abas — REUSA renameClusterColumnRefs/renameClusterLabelRefs (genéricas por
  // nome de coluna/rótulo, DEC-FR-009).
  const saveRangeVarEdit = () => {
    const cur = rangeVarModalR.current;
    if (!cur) return;
    const { csvId, col: oldCol, draft } = cur;
    const csv = csvStoreR.current[csvId];
    if (!csv) return;
    const origDef = csv.rangeDefs?.[oldCol];
    const newCol = (draft.col || '').trim();
    if (!newCol) return setRangeVarModal(m => ({ ...m, error: 'Dê um nome à variável.' }));
    if (newCol !== oldCol && (csv.headers || []).includes(newCol))
      return setRangeVarModal(m => ({ ...m, error: `Já existe uma coluna "${newCol}" nesta base.` }));
    const labels = (draft.bands || []).map(b => (b.label || '').trim());
    if (labels.some(l => !l)) return setRangeVarModal(m => ({ ...m, error: 'Toda faixa precisa de um rótulo.' }));
    if (new Set(labels).size !== labels.length)
      return setRangeVarModal(m => ({ ...m, error: 'Os rótulos das faixas devem ser distintos.' }));
    const unmatchedLabel = (draft.unmatchedLabel || '').trim() || 'Sem valor';

    const finalDef = {
      ...draft, col: newCol, csvId, unmatchedLabel,
      bands: (draft.bands || []).map((b, i) => ({ ...b, label: labels[i] })),
    };
    const colData = deriveRangeColumn(csv, finalDef);

    // Mapa de rótulos renomeados (por id de faixa) para propagar às portas/domínios.
    const labelMap = {};
    for (const b of (origDef?.bands || [])) {
      const nb = finalDef.bands.find(x => x.id === b.id);
      if (nb && nb.label !== b.label) labelMap[b.label] = nb.label;
    }
    if (origDef && origDef.unmatchedLabel !== unmatchedLabel) labelMap[origDef.unmatchedLabel] = unmatchedLabel;

    setCsvStore(prev => {
      const c = prev[csvId]; if (!c) return prev;
      const headers = c.headers.map(h => (h === oldCol ? newCol : h));
      const columns = { ...c.columns }; if (newCol !== oldCol) delete columns[oldCol]; columns[newCol] = colData;
      const columnTypes = { ...(c.columnTypes || {}) };
      const varTypes = { ...(c.varTypes || {}) };
      const rangeDefs = { ...(c.rangeDefs || {}) };
      if (newCol !== oldCol) {
        columnTypes[newCol] = columnTypes[oldCol] || 'decision'; delete columnTypes[oldCol];
        varTypes[newCol] = varTypes[oldCol] || 'ordinal'; delete varTypes[oldCol];
        delete rangeDefs[oldCol];
      }
      rangeDefs[newCol] = finalDef;
      return { ...prev, [csvId]: { ...c, headers, columns, columnTypes, varTypes, rangeDefs } };
    });

    if (newCol !== oldCol || Object.keys(labelMap).length > 0) {
      pushHistory();
      applyRefTransformAllCanvases((shapes, conns) => {
        let s = shapes, cn = conns;
        if (newCol !== oldCol) { const t = renameClusterColumnRefs(s, cn, csvId, oldCol, newCol); s = t.shapes; cn = t.conns; }
        if (Object.keys(labelMap).length > 0) { const t = renameClusterLabelRefs(s, cn, csvId, newCol, labelMap); s = t.shapes; cn = t.conns; }
        return { shapes: s, conns: cn };
      });
    }
    setRangeVarModal(null);
  };

  // Remove a variável de faixas (coluna + definição) — mesma degradação declarada de
  // deleteClusterVariable.
  const deleteRangeVariable = () => {
    const cur = rangeVarModalR.current;
    if (!cur) return;
    const { csvId, col } = cur;
    setCsvStore(prev => {
      const c = prev[csvId]; if (!c) return prev;
      const columns = { ...c.columns }; delete columns[col];
      const columnTypes = { ...(c.columnTypes || {}) }; delete columnTypes[col];
      const varTypes = { ...(c.varTypes || {}) }; delete varTypes[col];
      const rangeDefs = { ...(c.rangeDefs || {}) }; delete rangeDefs[col];
      return { ...prev, [csvId]: { ...c, headers: c.headers.filter(h => h !== col), columns, columnTypes, varTypes, rangeDefs } };
    });
    setRangeVarModal(null);
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
      // "Prontidão da Política" (Jornada EP, Sessão EP2, DEC-EP-005) — o worker recomputa
      // lint/coverage/pendingVars/hasAsIs no mesmo passe (varre a base de qualquer forma);
      // só o que é estado-só-da-main viaja aqui, mesmo padrão de COMPUTE_NEXT_ACTIONS.
      docFingerprint: lastDocFingerprint,
      baseProfile: baseProfileResult,
      simplify: nextActionsTier2Ref.current?.simplify ?? null,
      readinessConfig: journeyState.readinessConfig,
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
  // ═══ REGIÃO: Ranking de Variáveis (Copiloto de Porta) ═══
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

  // ═══ REGIÃO: Cena e Overlay de Arraste ═══
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

  // ═══ REGIÃO: Ações do Ribbon (extraídas de JSX inline para o registro) ═══
  // Adiciona um Decision Lens no centro do viewport (antes: botão "Adicionar Decision
  // Lens" da seção Segmentação do painel). Comportamento idêntico.
  const addDecisionLens = () => {
    pushHistory();
    const svgEl = svgRef.current;
    const cx = (svgEl.clientWidth / 2 - vp.x) / vp.s, cy = (svgEl.clientHeight / 2 - vp.y) / vp.s;
    const id = uid();
    setShapes(p => [...p, { id, type: "decision_lens", x: cx - LENS_W / 2, y: cy - LENS_H / 2, w: LENS_W, h: LENS_H, label: "Decision Lens", rules: [], color: "#fff" }]);
    setSel(id);
  };
  // Adiciona o Painel de Simulação no centro do viewport (antes: seção Simulação do
  // painel). Desabilitado se já existe — preservado exatamente pelo enabledWhen.
  const addSimPanel = () => {
    if (shapes.some(s => s.type === "simPanel")) return;
    pushHistory();
    const svgEl = svgRef.current;
    const cx = (svgEl.clientWidth / 2 - vp.x) / vp.s, cy = (svgEl.clientHeight / 2 - vp.y) / vp.s;
    setShapes(p => [...p, { id: uid(), type: "simPanel", x: cx - 150, y: cy - 220, w: 300, h: 440, label: "Simulação", color: "#fff" }]);
  };
  // Alinhar/distribuir multi-seleção — mesma matemática da toolbar flutuante de alinhamento
  // (surface #2, que segue intocada até a Sessão 2). Aqui só para os descritores contextuais
  // do registro (aba ctx-selecao); ainda não renderizado em modo fixed nesta sessão.
  const applyAlign = (dir) => {
    const sel2 = shapes.filter(s => multiSel.has(s.id));
    if (sel2.length < 2) return;
    pushHistory();
    setShapes(prev => prev.map(s => {
      if (!multiSel.has(s.id)) return s;
      if (dir === "left")   return { ...s, x: Math.min(...sel2.map(q => q.x)) };
      if (dir === "right")  return { ...s, x: Math.max(...sel2.map(q => q.x + q.w)) - s.w };
      if (dir === "top")    return { ...s, y: Math.min(...sel2.map(q => q.y)) };
      if (dir === "bottom") return { ...s, y: Math.max(...sel2.map(q => q.y + q.h)) - s.h };
      if (dir === "centerH") { const midX = (Math.min(...sel2.map(q => q.x)) + Math.max(...sel2.map(q => q.x + q.w))) / 2; return { ...s, x: midX - s.w / 2 }; }
      if (dir === "centerV") { const midY = (Math.min(...sel2.map(q => q.y)) + Math.max(...sel2.map(q => q.y + q.h))) / 2; return { ...s, y: midY - s.h / 2 }; }
      if (dir === "distH") { const sorted = [...sel2].sort((a, b) => (a.x + a.w / 2) - (b.x + b.w / 2)); const totalW = sorted.reduce((a, q) => a + q.w, 0); const span = Math.max(...sorted.map(q => q.x + q.w)) - Math.min(...sorted.map(q => q.x)); const gap = (span - totalW) / (sorted.length - 1); let cx2 = Math.min(...sorted.map(q => q.x)); const posMap = {}; for (const q of sorted) { posMap[q.id] = cx2; cx2 += q.w + gap; } return { ...s, x: posMap[s.id] ?? s.x }; }
      if (dir === "distV") { const sorted = [...sel2].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2)); const totalH = sorted.reduce((a, q) => a + q.h, 0); const span = Math.max(...sorted.map(q => q.y + q.h)) - Math.min(...sorted.map(q => q.y)); const gap = (span - totalH) / (sorted.length - 1); let cy2 = Math.min(...sorted.map(q => q.y)); const posMap = {}; for (const q of sorted) { posMap[q.id] = cy2; cy2 += q.h + gap; } return { ...s, y: posMap[s.id] ?? s.y }; }
      return s;
    }));
  };

  // ═══ REGIÃO: Registro Declarativo de Comandos (COMMANDS — FONTE ÚNICA) ═══
  // Descritores {id, label, icon, tab, group, keywords, shortcut, contextWhen, enabledWhen,
  // disabledReason, activeWhen, onRun}. Um comando = um descritor. A Ribbon (7 abas fixas),
  // as abas contextuais (Sessão 2) e a Busca de comandos — Ctrl+K (Sessão 7) renderizam
  // TODAS deste array. Cobre as 12 superfícies do inventário
  // (docs/wiki/Ribbon-Prompts-Sessoes.md):
  //   - tab ∈ {inicio,inserir,dados,analisar,otimizar,politica,projeto}: renderizadas AGORA.
  //   - tab `ctx-*`: descritores nascem agora, renderizados quando a superfície migrar
  //     (abas contextuais Matriz/Decisão/Lens/Terminal/Porta/Seleção — Sessão 2).
  // `contextWhen(shape)` = predicado por tipo de shape selecionado (null = global). Um
  // comando cujo contextWhen não bate com a seleção atual não aparece nem na Ribbon nem na
  // Busca. `disabledReason` (string | () => string) = motivo curto mostrado acinzentado na
  // Busca quando `enabledWhen` é falso (a Ribbon já mostra o botão desabilitado sem motivo,
  // via `title`) — só precisa existir em descritores que têm `enabledWhen`.
  // Os comandos escopados "Descobrir/Clusterizar/Faixas aqui" são UM descritor cada, com
  // contextWhen aceitando os tipos aplicáveis — sem triplicação por tipo.
  const _hasSel        = !!sel || multiSel.size > 0;
  const _simPanelExists = shapes.some(s => s.type === "simPanel");
  const _allCinemas    = multiSel.size > 1 && [...multiSel].every(id => shapesById.get(id)?.type === 'cineminha');
  const _scopeNode     = (t) => ['decision', 'cineminha', 'decision_lens'].includes(t);
  const COMMANDS = [
    // ─── INÍCIO / Edição (toolbar de topo #1) ───
    { id: 'tool.select', label: 'Selecionar', icon: '↖', tab: 'inicio', group: 'Edição', primary: true, keywords: ['selecionar', 'seta', 'mover shapes', 'ponteiro', 'cursor'], activeWhen: () => tool === 'select', onRun: () => { setTool('select'); setFromId(null); } },
    { id: 'tool.hand', label: 'Mover', icon: '✋', tab: 'inicio', group: 'Edição', keywords: ['mão', 'pan', 'arrastar canvas', 'navegar', 'panorâmica'], activeWhen: () => tool === 'hand', onRun: () => { setTool('hand'); setFromId(null); } },
    { id: 'tool.connect', label: 'Conectar', icon: '⟶', tab: 'inicio', group: 'Edição', keywords: ['conexão', 'aresta', 'ligar', 'seta', 'fluxo', 'linha'], activeWhen: () => tool === 'connect', onRun: () => { setTool('connect'); setFromId(null); } },
    { id: 'edit.undo', label: 'Desfazer', icon: '↩', tab: 'inicio', group: 'Edição', shortcut: 'Ctrl+Z', keywords: ['undo', 'voltar', 'desfazer'], enabledWhen: () => undoStack.length > 0, disabledReason: 'nada para desfazer', onRun: undo },
    { id: 'edit.redo', label: 'Refazer', icon: '↪', tab: 'inicio', group: 'Edição', shortcut: 'Ctrl+Y', keywords: ['redo', 'avançar', 'refazer'], enabledWhen: () => redoStack.length > 0, disabledReason: 'nada para refazer', onRun: redo },
    { id: 'edit.delete', label: 'Deletar', icon: '🗑', tab: 'inicio', group: 'Edição', shortcut: 'Del', keywords: ['excluir', 'remover', 'apagar', 'deletar'], enabledWhen: () => _hasSel, disabledReason: 'selecione algo para deletar', onRun: deleteSelected },
    { id: 'edit.duplicate', label: 'Duplicar', icon: '⧉', tab: 'inicio', group: 'Edição', keywords: ['duplicar', 'clonar', 'copiar'], enabledWhen: () => _hasSel, disabledReason: 'selecione algo para duplicar', onRun: duplicateSelected },
    // ─── INÍCIO / Organizar ───
    { id: 'org.reorganize', label: 'Reorganizar', icon: '⊹', tab: 'inicio', group: 'Organizar', primary: true, keywords: ['auto layout', 'organizar', 'arrumar', 'camadas', 'reorganizar', 'sugiyama'], onRun: autoLayout },
    { id: 'org.color', label: 'Cor', icon: '🎨', tab: 'inicio', group: 'Organizar', keywords: ['cor', 'paleta', 'pintar'], enabledWhen: () => !!selShape && selShape.type !== 'csv', disabledReason: 'selecione um shape para colorir', onRun: () => setPalette(v => !v) },
    // ─── INÍCIO / Ver (zoom, canto do canvas #10) ───
    { id: 'view.zoomIn', label: 'Zoom +', icon: '➕', tab: 'inicio', group: 'Ver', keywords: ['aproximar', 'ampliar', 'zoom in'], onRun: () => zoomCenter(1.2) },
    { id: 'view.zoomOut', label: 'Zoom −', icon: '➖', tab: 'inicio', group: 'Ver', keywords: ['afastar', 'reduzir', 'zoom out'], onRun: () => zoomCenter(1 / 1.2) },
    { id: 'view.zoomReset', label: 'Centralizar', icon: '⌂', tab: 'inicio', group: 'Ver', primary: true, keywords: ['reset', 'início', 'home', 'centralizar', 'enquadrar'], onRun: () => setVp({ x: 20, y: 40, s: 1 }) },

    // ─── INSERIR / Nós ───
    { id: 'insert.decision', label: 'Losango', icon: '▭', tab: 'inserir', group: 'Nós', primary: true, keywords: ['losango', 'decisão', 'retângulo', 'nó', 'regra', 'diamante'], activeWhen: () => tool === 'rect', onRun: () => { setTool('rect'); setFromId(null); } },
    { id: 'insert.cineminha', label: 'Cineminha', icon: '⊞', tab: 'inserir', group: 'Nós', keywords: ['matriz', 'cineminha', 'cruzada', 'cinema', 'tabela cruzada'], activeWhen: () => tool === 'cineminha', onRun: () => { setTool('cineminha'); setFromId(null); } },
    { id: 'insert.cineminhaLibrary', label: 'Cineminha da Biblioteca', icon: '📥', tab: 'inserir', group: 'Nós', keywords: ['importar cineminha', 'biblioteca', 'modelos salvos'], onRun: () => openCinemaLibrary(null, 'browse') },
    { id: 'insert.lensTool', label: 'Decision Lens', icon: '🔎', tab: 'inserir', group: 'Nós', keywords: ['lens', 'segmentação', 'regras', 'ferramenta lens', 'população'], activeWhen: () => tool === 'decision_lens', onRun: () => { setTool('decision_lens'); setFromId(null); } },
    { id: 'insert.lensAdd', label: 'Adicionar Lens', icon: '🛢', tab: 'inserir', group: 'Nós', keywords: ['decision lens', 'segmentação', 'adicionar lens'], enabledWhen: () => Object.keys(csvStore).length > 0, disabledReason: 'carregue uma base primeiro', onRun: addDecisionLens },
    { id: 'insert.frame', label: 'Frame', icon: '⬚', tab: 'inserir', group: 'Nós', keywords: ['moldura', 'grupo', 'área', 'frame'], activeWhen: () => tool === 'frame', onRun: () => { setTool('frame'); setFromId(null); } },
    // ─── INSERIR / Terminais ───
    { id: 'insert.approved', label: 'Aprovado', icon: '✅', tab: 'inserir', group: 'Terminais', primary: true, keywords: ['aprovar', 'terminal aprovado'], activeWhen: () => tool === 'approved', onRun: () => { setTool('approved'); setFromId(null); } },
    { id: 'insert.rejected', label: 'Reprovado', icon: '❌', tab: 'inserir', group: 'Terminais', keywords: ['reprovar', 'recusar', 'terminal reprovado'], activeWhen: () => tool === 'rejected', onRun: () => { setTool('rejected'); setFromId(null); } },
    { id: 'insert.asIs', label: 'AS IS', icon: '⟳', tab: 'inserir', group: 'Terminais', keywords: ['as is', 'política atual', 'baseline'], activeWhen: () => tool === 'as_is', onRun: () => { setTool('as_is'); setFromId(null); } },
    // ─── INSERIR / Painéis ───
    { id: 'insert.simPanel', label: _simPanelExists ? 'Painel ativo' : 'Painel de Simulação', icon: '📊', tab: 'inserir', group: 'Painéis', primary: true, keywords: ['simulação', 'painel', 'indicadores', 'kpi', 'taxa de aprovação'], enabledWhen: () => !_simPanelExists, disabledReason: 'painel já ativo no canvas', onRun: addSimPanel },
    { id: 'insert.businessImpact', label: businessWidget.visible ? 'Widget ativo' : 'Business Impact', icon: '⬡', tab: 'inserir', group: 'Painéis', keywords: ['business impact', 'widget', 'impacto', 'negócio'], enabledWhen: () => !businessWidget.visible, disabledReason: 'widget já ativo no canvas', onRun: () => setBusinessWidget(p => ({ ...p, visible: true })) },

    // ─── DADOS ───
    { id: 'data.importCsv', label: 'Importar CSV', icon: '📂', tab: 'dados', group: 'Bases', primary: true, keywords: ['csv', 'importar', 'carregar base', 'dados', 'planilha'], onRun: () => fileInputRef.current?.click() },
    // Explorar a Base (Épico EB, EB2) — DEC-EB-001 (aba) + DEC-EB-005 (regenerar layout).
    { id: 'data.openExplore', label: 'Abrir Explorar', icon: '🔎', tab: 'dados', group: 'Explorar', primary: true, keywords: ['explorar', 'explorar a base', 'análise exploratória', 'perfil da base', 'conhecer a base'], onRun: () => setActiveTab('explore') },
    { id: 'data.regenerateExplore', label: 'Regenerar análise da base', icon: '↻', tab: 'dados', group: 'Explorar', keywords: ['regenerar', 'explorar', 'atualizar análise', 'perfil da base'], enabledWhen: () => !!baseProfileResult && !baseProfileResult.error, disabledReason: 'carregue uma base para gerar a análise', onRun: regenerateExploreLayout },

    // ─── ANALISAR ───
    { id: 'analyze.discover', label: 'Descobrir Segmentos', icon: '🔍', tab: 'analisar', group: 'Descoberta', primary: true, keywords: ['segmentos', 'descobrir', 'subgroup', 'varredura', 'oportunidade'], onRun: () => openSegmentDiscoveryModal(null) },
    { id: 'analyze.cluster', label: 'Clusterizar Segmentos', icon: '🧩', tab: 'analisar', group: 'Descoberta', keywords: ['cluster', 'clusterizar', 'k-means', 'agrupar', 'agrupamento'], onRun: () => openClusterModal(null) },
    { id: 'analyze.range', label: 'Criar Faixas por Risco', icon: '📐', tab: 'analisar', group: 'Descoberta', keywords: ['faixas', 'binning', 'risco', 'iv', 'woe', 'bandas', 'faixa etária', 'faixa de renda', 'cortes'], onRun: () => openRangeModal() },
    { id: 'analyze.copilot', label: 'Copiloto', icon: '🧭', tab: 'analisar', group: 'Copiloto', primary: true, keywords: ['copiloto', 'lint', 'achados', 'diagnóstico', 'assistente', 'feed', 'próxima melhor ação'], onRun: () => { setPanelCollapsed(false); setRightPanelMode('copilot'); } },
    // "Buscar oportunidades" (DEC-NB-002/003, Sessão NB3): roda a Descoberta de Segmentos
    // (global, params default do modal) + a Simplificação FORA do tick e injeta os achados
    // como cards Tier 2 carimbados no feed do Copiloto (staleness derivado quando o IR muda).
    { id: 'analyze.copilotSearch', label: 'Buscar oportunidades', icon: '🔎', tab: 'analisar', group: 'Copiloto', keywords: ['buscar oportunidades', 'descoberta', 'simplificação', 'feed', 'próxima melhor ação'], onRun: () => { setPanelCollapsed(false); setRightPanelMode('copilot'); runOpportunityScan(); } },
    // Recalcular as fontes caras (CTA dos cards Tier 2 desatualizados) — mesmo disparo, sem navegar.
    { id: 'copilot.rescanOpportunities', label: 'Recalcular oportunidades', icon: '🔄', tab: 'feed', contextWhen: () => false, onRun: () => runOpportunityScan() },
    { id: 'analyze.copilotDiscarded', label: 'Ver descartados', icon: '🗂', tab: 'analisar', group: 'Copiloto', keywords: ['descartados', 'adiados', 'feed', 'copiloto'], activeWhen: () => showDiscardedActions, onRun: () => setShowDiscardedActions(v => !v) },
    // CTAs do feed do Copiloto (DEC-NB-008): descritores do registro, invocados com `args`
    // pelo card (`runNextActionCTA`). `tab:'feed'` (sem Ribbon correspondente) + contextWhen
    // sempre falso: nunca aparecem na Ribbon nem no Ctrl+K — só existem para os appliers
    // JÁ EXISTENTES ficarem centralizados num único ponto de disparo (nenhum aplicador novo).
    { id: 'copilot.connectTerminal', label: 'Conectar terminal', icon: '⚡', tab: 'feed', contextWhen: () => false, onRun: (args = {}) => applyCopilotConnectTerminal(args.nodeId, args.terminal || 'rejected') },
    { id: 'copilot.openDomainModal', label: 'Configurar nó', icon: '⚙', tab: 'feed', contextWhen: () => false, onRun: (args = {}) => openDomainModal(args.nodeId) },
    // v1: remover um valor específico do domínio ainda não tem applier dedicado — abre o
    // mesmo modal "Configurar nó" (Domínio Exibido) já usado pelo lint, onde o usuário
    // confirma a exclusão. Ver docs/claude/Dominio-Exibido.md.
    { id: 'copilot.removeFromDomain', label: 'Remover do domínio', icon: '🗑', tab: 'feed', contextWhen: () => false, onRun: (args = {}) => openDomainModal(args.nodeId) },
    { id: 'copilot.exploreBase', label: 'Explorar a base', icon: '🔎', tab: 'feed', contextWhen: () => false, onRun: () => setActiveTab('explore') },
    { id: 'copilot.firstBranch', label: 'Criar primeira decisão', icon: '🌱', tab: 'feed', contextWhen: () => false, onRun: (args = {}) => { if (args.col && args.csvId) createDecisionNode(args.col, args.csvId, 80, 80); } },
    { id: 'copilot.mapPendingVar', label: 'Mapear variável', icon: '🔗', tab: 'feed', contextWhen: () => false, onRun: (args = {}) => { setPanelCollapsed(false); setRightPanelMode('assets'); if (args.name) setVarSearch(args.name); } },
    { id: 'copilot.configureAsIs', label: 'Configurar AS IS', icon: '⟳', tab: 'feed', contextWhen: () => false, onRun: () => { setTool('as_is'); setFromId(null); } },
    { id: 'copilot.generateDoc', label: 'Documentar política', icon: '📄', tab: 'feed', contextWhen: () => false, onRun: () => openDocModal() },
    { id: 'copilot.saveLibrary', label: 'Salvar na Biblioteca', icon: '📚', tab: 'feed', contextWhen: () => false, onRun: () => openPolicyLibrary('save') },
    // Tier 2 (Descoberta/Simplificação): a aplicação em si já existe dentro dos modais
    // respectivos — a CTA do feed navega até lá (a materialização acontece na UI existente,
    // sob os aplicadores `applySegmentRecommendation`/`applySimplifyCandidates` já em uso).
    { id: 'copilot.applyOpportunity', label: 'Ver na Descoberta', icon: '🔍', tab: 'feed', contextWhen: () => false, onRun: () => openSegmentDiscoveryModal(null) },
    { id: 'copilot.applySimplify', label: 'Ver Simplificação', icon: '🧹', tab: 'feed', contextWhen: () => false, onRun: () => openSimplifyModal() },
    // fixCommandId do Checklist de Prontidão (Jornada EP, Sessão EP2, DEC-EP-003): critérios
    // sem um applier dedicado navegam até o feed do Copiloto, onde os cards já resolvem (o
    // lint sem bloqueantes e o funil vêm da MESMA fonte do feed — nenhum aplicador novo).
    { id: 'copilot.reviewBlockers', label: 'Revisar bloqueantes', icon: '🔴', tab: 'feed', contextWhen: () => false, onRun: () => { setPanelCollapsed(false); setRightPanelMode('copilot'); setJourneyStageFilter(null); } },
    { id: 'copilot.reviewCoverage', label: 'Revisar cobertura', icon: '🕳', tab: 'feed', contextWhen: () => false, onRun: () => { setPanelCollapsed(false); setRightPanelMode('copilot'); setJourneyStageFilter(null); } },

    // ─── OTIMIZAR ───
    { id: 'optimize.goalSeek', label: 'Atingir Objetivo', icon: '🎯', tab: 'otimizar', group: 'Política', primary: true, keywords: ['goal seek', 'objetivo', 'meta', 'milp', 'profundo'], onRun: openGoalSeekModal },
    { id: 'optimize.simplify', label: 'Simplificar', icon: '🧹', tab: 'otimizar', group: 'Política', keywords: ['simplificar', 'reduzir', 'equivalência', 'limpar', 'enxugar política'], onRun: openSimplifyModal },
    { id: 'optimize.johnny', label: 'Otimização Johnny', icon: '⚡', tab: 'otimizar', group: 'Matrizes', primary: true, keywords: ['johnny', 'otimizar', 'multi cineminha', 'pareto'], enabledWhen: () => _allCinemas, disabledReason: 'requer 2+ Cineminhas selecionadas', onRun: () => openJohnnyModal([...multiSel]) },

    // ─── POLÍTICA ───
    { id: 'policy.library', label: 'Biblioteca de Políticas', icon: '📚', tab: 'politica', group: 'Biblioteca', primary: true, keywords: ['políticas', 'biblioteca', 'templates', 'policy', 'político', 'regra', 'modelos de política'], onRun: () => openPolicyLibrary('browse') },
    { id: 'policy.doc', label: 'Documentar Política', icon: '📄', tab: 'politica', group: 'Documento', primary: true, keywords: ['documentar', 'documentação', 'relatório', 'executivo', 'político', 'regra'], onRun: openDocModal },
    { id: 'policy.export', label: 'Exportar Fluxo', icon: '⬇', tab: 'politica', group: 'Fluxo', primary: true, keywords: ['exportar', 'policyir', 'json', 'fluxo', 'política', 'regra'], onRun: exportFlow },
    { id: 'policy.import', label: 'Importar Fluxo', icon: '⬆', tab: 'politica', group: 'Fluxo', keywords: ['importar', 'fluxo', 'carregar política', 'regra'], onRun: () => flowImportRef.current?.click() },

    // ─── PROJETO ───
    { id: 'project.save', label: 'Salvar Projeto', icon: '💾', tab: 'projeto', group: 'Arquivo', shortcut: '', primary: true, keywords: ['salvar', 'projeto', 'credito', 'gravar'], onRun: saveProject },
    { id: 'project.open', label: 'Abrir Projeto', icon: '📁', tab: 'projeto', group: 'Arquivo', keywords: ['abrir', 'carregar projeto', 'credito'], onRun: () => projectInputRef.current?.click() },
    { id: 'project.settings', label: 'Configurações', icon: '⚙', tab: 'projeto', group: 'Sistema', shortcut: 'Ctrl+,', primary: true, keywords: ['configurações', 'preferências', 'ajustes', 'settings', 'motor python', 'visualização', 'hub'], onRun: () => openSettings() },

    // ─── CONTEXTUAIS (surfaces #3–#8) — nascem agora; abas contextuais renderizam na Sessão 2 ───
    // Matriz (Cineminha): seletor de tipo (×3), Resultado, Domínio, Otimizar, Johnny, Exportar/
    // Importar, Biblioteca, Salvar. contextWhen por tipo.
    ...Object.values(CINEMINHA_TYPES).map(t => ({
      id: `ctx.cinema.type.${t.id}`, label: `Tipo: ${t.label}`, icon: t.icon, tab: 'ctx-matriz', group: 'Tipo',
      primary: t.id === 'eligibility',
      keywords: ['tipo de cineminha', t.label], contextWhen: (s) => s?.type === 'cineminha',
      activeWhen: () => (selShape?.cinemaType ?? 'eligibility') === t.id, onRun: () => changeCinemaType(sel, t.id),
    })),
    { id: 'ctx.cinema.result', label: 'Resultado', icon: '⊞', tab: 'ctx-matriz', group: 'Configurar', keywords: ['variável de resultado', 'coluna', 'casela'], contextWhen: (s) => s?.type === 'cineminha', onRun: () => setResultVarModal({ shapeId: sel }) },
    { id: 'ctx.node.domain', label: 'Domínio', icon: '⚙', tab: 'ctx-matriz', group: 'Configurar', primary: true, keywords: ['domínio', 'valores', 'linhas colunas', 'configurar nó'], contextWhen: (s) => s?.type === 'cineminha' || s?.type === 'decision', onRun: () => openDomainModal(sel) },
    { id: 'ctx.cinema.optimize', label: 'Otimizar Decisão', icon: '⚙', tab: 'ctx-matriz', group: 'Otimizar', primary: true, keywords: ['otimizar decisão', 'pareto'], contextWhen: (s) => s?.type === 'cineminha', onRun: () => openOptimModal(sel) },
    { id: 'ctx.cinema.johnny', label: 'Otimização Johnny', icon: '⚡', tab: 'ctx-matriz', group: 'Otimizar', keywords: ['johnny'], contextWhen: (s) => s?.type === 'cineminha', onRun: () => openJohnnyModal([sel]) },
    { id: 'ctx.cinema.export', label: 'Exportar', icon: '⬇', tab: 'ctx-matriz', group: 'Biblioteca', keywords: ['exportar cineminha'], contextWhen: (s) => s?.type === 'cineminha', onRun: () => exportCinema(sel) },
    { id: 'ctx.cinema.import', label: 'Importar', icon: '⬆', tab: 'ctx-matriz', group: 'Biblioteca', keywords: ['importar cineminha'], contextWhen: (s) => s?.type === 'cineminha', onRun: () => startCinemaImport(sel) },
    { id: 'ctx.cinema.library', label: 'Biblioteca', icon: '📚', tab: 'ctx-matriz', group: 'Biblioteca', primary: true, keywords: ['biblioteca de cineminhas'], contextWhen: (s) => s?.type === 'cineminha', onRun: () => openCinemaLibrary(sel, 'browse') },
    { id: 'ctx.cinema.save', label: 'Salvar na Biblioteca', icon: '💾', tab: 'ctx-matriz', group: 'Biblioteca', keywords: ['salvar cineminha'], contextWhen: (s) => s?.type === 'cineminha', onRun: () => openCinemaLibrary(sel, 'save') },
    // Decisão (losango): Configurar (domínio) — já coberto por ctx.node.domain acima.
    // Lens (Decision Lens): Configurar regras.
    { id: 'ctx.lens.configure', label: 'Configurar regras', icon: '🔎', tab: 'ctx-lens', group: 'Configurar', primary: true, keywords: ['configurar lens', 'regras', 'população'], contextWhen: (s) => s?.type === 'decision_lens', onRun: () => openLensModal(sel) },
    // "Analisar aqui" — UM descritor cada, contextWhen aceitando os tipos aplicáveis (fim da
    // triplicação losango/Cineminha/Lens). 🔍 aceita também terminais (Aprovado/Reprovado/AS IS).
    { id: 'ctx.scope.discover', label: 'Descobrir aqui', icon: '🔍', tab: 'ctx-analisar', group: 'Analisar aqui', primary: true, keywords: ['descobrir segmentos', 'escopo do nó', 'aqui'], contextWhen: (s) => _scopeNode(s?.type) || ['approved', 'rejected', 'as_is'].includes(s?.type), onRun: () => openSegmentDiscoveryModal({ nodeId: sel }) },
    { id: 'ctx.scope.cluster', label: 'Clusterizar aqui', icon: '🧩', tab: 'ctx-analisar', group: 'Analisar aqui', keywords: ['clusterizar', 'escopo do nó', 'aqui'], contextWhen: (s) => _scopeNode(s?.type), onRun: () => openClusterModal({ nodeId: sel }) },
    { id: 'ctx.scope.range', label: 'Faixas aqui', icon: '📐', tab: 'ctx-analisar', group: 'Analisar aqui', keywords: ['faixas por risco', 'escopo do nó', 'aqui', 'binning'], contextWhen: (s) => _scopeNode(s?.type), onRun: () => openRangeModal({ scope: { nodeId: sel } }) },
    // Trava (Goal Seek) — losango/Cineminha/Lens.
    { id: 'ctx.node.lock', label: 'Travar / Destravar', icon: '🔒', tab: 'ctx-analisar', group: 'Trava', primary: true, keywords: ['travar', 'destravar', 'goal seek', 'lock'], contextWhen: (s) => _scopeNode(s?.type), onRun: () => toggleShapeLock(sel) },
    // Porta solta: sugerir próximo passo (só faz sentido em porta sem conexão de saída).
    { id: 'ctx.port.suggest', label: 'Sugerir próximo passo', icon: '💡', tab: 'ctx-porta', group: 'Sugestão', primary: true, keywords: ['sugerir', 'próximo passo', 'ranking de variáveis'], contextWhen: (s) => s?.type === 'port', enabledWhen: () => conns.filter(c => c.from === sel).length === 0, disabledReason: 'porta já conectada', onRun: () => openVariableRanking(sel) },
    // Seleção múltipla: alinhar/distribuir (8). Mesmo grupo da toolbar flutuante #2.
    ...[['left', 'Alinhar à esquerda', '⊢'], ['right', 'Alinhar à direita', '⊣'], ['top', 'Alinhar ao topo', '⊤'], ['bottom', 'Alinhar à base', '⊥'], ['centerH', 'Centralizar H', '↔'], ['centerV', 'Centralizar V', '↕'], ['distH', 'Distribuir H', '⇹'], ['distV', 'Distribuir V', '⤡']].map(([d, l, ic]) => ({
      id: `ctx.align.${d}`, label: l, icon: ic, tab: 'ctx-selecao', group: 'Alinhar', primary: d === 'left',
      keywords: ['alinhar', 'distribuir', l], contextWhen: () => multiSel.size > 1, enabledWhen: () => multiSel.size > 1, disabledReason: 'selecione 2+ shapes', onRun: () => applyAlign(d),
    })),
    // Otimização Johnny em massa (habilita só com todos Cineminhas) + Deletar em massa.
    { id: 'ctx.sel.johnny', label: `Otimização Johnny (${multiSel.size})`, icon: '⚡', tab: 'ctx-selecao', group: 'Matrizes', primary: true, keywords: ['johnny', 'otimizar', 'multi cineminha'], contextWhen: () => multiSel.size > 1, enabledWhen: () => _allCinemas, disabledReason: 'requer 2+ Cineminhas selecionadas', onRun: () => openJohnnyModal([...multiSel]) },
    { id: 'ctx.sel.delete', label: `Deletar (${multiSel.size})`, icon: '🗑', tab: 'ctx-selecao', group: 'Ações', primary: true, keywords: ['deletar', 'excluir', 'remover em massa'], contextWhen: () => multiSel.size > 1, enabledWhen: () => multiSel.size > 1, disabledReason: 'selecione 2+ shapes', onRun: deleteSelected },
  ];

  // Dispara a CTA de um card do feed (DEC-NB-008) — resolve o commandId no registro acima
  // e chama `onRun(args)` do card. Nenhum aplicador novo: sempre um dos `copilot.*`/comandos
  // já existentes acima, que por sua vez chamam os aplicadores originais.
  const runNextActionCTA = (cta) => {
    const cmd = COMMANDS.find(c => c.id === cta?.commandId);
    if (cmd) cmd.onRun(cta.args || {});
  };

  // ═══ REGIÃO: Abas contextuais do Ribbon (UX 2.0 — Sessão 2) ═══
  // Uma aba contextual (padrão "Contextual Tabs" do Office) surge destacada só quando a
  // seleção casa com um tipo. Seu conteúdo = TODOS os descritores cujo contextWhen(sel) é
  // verdadeiro — o grupo "Analisar aqui" é UM conjunto de descritores compartilhado por
  // losango/Cineminha/Lens/terminal (sem triplicação). Um único shape selecionado por vez
  // (multiSel.size<=1) casa uma aba de tipo; multi-seleção casa a aba Seleção.
  const _selTypeCtx = (!sel || multiSel.size > 1) ? null : selShape?.type;
  const activeContextTab =
    multiSel.size > 1 ? 'ctx-selecao'
    : _selTypeCtx === 'cineminha' ? 'ctx-matriz'
    : _selTypeCtx === 'decision' ? 'ctx-decisao'
    : _selTypeCtx === 'decision_lens' ? 'ctx-lens'
    : (_selTypeCtx === 'approved' || _selTypeCtx === 'rejected' || _selTypeCtx === 'as_is') ? 'ctx-terminal'
    : (_selTypeCtx === 'port' && conns.filter(c => c.from === sel).length === 0) ? 'ctx-porta'
    : null;
  // Alvo do predicado contextWhen: o shape único selecionado. Em multi-seleção passamos
  // null (os descritores de Seleção checam multiSel diretamente) pra nenhum comando de
  // shape único vazar para a aba Seleção.
  const _ctxSelArg = multiSel.size > 1 ? null : selShape;
  const contextCommands = activeContextTab ? COMMANDS.filter(c => c.contextWhen && c.contextWhen(_ctxSelArg)) : [];

  // ═══ REGIÃO: Busca de comandos — Ctrl+K (UX 2.0 — Sessão 7) ═══
  // Consome COMMANDS por completo (fixas + `ctx-*`), independente da aba/aba contextual em
  // foco no Ribbon. Um comando cujo contextWhen não bate com a seleção atual (mesmo
  // `_ctxSelArg` da aba contextual acima) não aparece na lista. Fuzzy simples: normalização
  // de acentos + substring, mesmo padrão da busca de Variáveis de Decisão do painel
  // (`norm(col).includes(q)`), sobre label+keywords. Ranking: match exato > label começa
  // com a query > label contém > só bateu via keyword.
  const _cmdNorm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const cmdPaletteResults = !cmdPalette ? [] : (() => {
    const q = _cmdNorm(cmdPalette.query);
    return COMMANDS
      .filter(c => !c.contextWhen || c.contextWhen(_ctxSelArg))
      .reduce((acc, c) => {
        const label = _cmdNorm(c.label);
        const hay = _cmdNorm([c.label, ...(c.keywords || [])].join(' '));
        if (q && !hay.includes(q)) return acc;
        const rank = !q ? 0 : label === q ? 0 : label.startsWith(q) ? 1 : label.includes(q) ? 2 : 3;
        acc.push({ cmd: c, enabled: c.enabledWhen ? !!c.enabledWhen() : true, rank });
        return acc;
      }, [])
      .sort((a, b) => a.rank - b.rank);
  })();
  const runCmdPaletteCommand = (cmd) => { closeCmdPalette(); cmd.onRun(); };

  // Auto-ativação ao selecionar; retorno à aba fixa anterior ao desselecionar (ou quando a
  // seleção muda para outro tipo → foca a nova aba contextual). Efeito só reage à troca do
  // tipo de contexto, não a cada render.
  const _prevCtxRef = useRef(null);
  useEffect(() => {
    if (activeContextTab && activeContextTab !== _prevCtxRef.current) setCtxTabShown(true);
    else if (!activeContextTab) setCtxTabShown(false);
    _prevCtxRef.current = activeContextTab;
  }, [activeContextTab]);
  // Aba efetivamente exibida: a contextual quando em foco; senão a fixa persistida.
  const ribbonShownTab = (activeContextTab && ctxTabShown) ? activeContextTab : ribbonActiveTab;

  // ═══ Status Bar (UX 2.0 — Sessão 5) — valores dos indicadores ═══
  // Mesma leitura de simResult/incrementalResult que o widget Business Impact e o
  // renderSimPanel (Painel de Simulação) — nenhum denominador novo, só formatação para a
  // faixa fina.
  const statusBarValues = useMemo(() => {
    const inc = incrementalResult;
    const displayResult = inc ? inc.simulated : simResult;
    const hasData = displayResult.totalQty > 0;
    const rate = hasData ? displayResult.approvalRate : null;
    const irV = displayResult.inadReal;
    const iiV = displayResult.inadInferida;
    const selCount = multiSel.size > 0 ? multiSel.size : (sel ? 1 : 0);
    const nodeVol = (multiSel.size === 0 && selShape) ? totalNodeArrival(selShape, nodeArrivals[selShape.id]) : null;
    const baseRows = Object.values(csvStore).reduce((a, c) => a + rowCount(c), 0);
    return {
      approvalRate:   { id: 'approvalRate',   label: 'Taxa de Aprovação', text: rate === null ? 'N/A' : `${rate.toFixed(1)}%`,
        color: rate === null ? undefined : rate >= 70 ? '#16a34a' : rate >= 40 ? '#d97706' : '#dc2626' },
      inadReal:       { id: 'inadReal',       label: 'Inad. Real', text: fmtPct(irV),
        color: irV === null ? undefined : irV > 0.05 ? '#dc2626' : '#d97706' },
      inadInferida:   { id: 'inadInferida',   label: 'Inad. Inferida', text: fmtPct(iiV),
        color: iiV === null ? undefined : iiV > 0.05 ? '#dc2626' : '#d97706' },
      selectionCount: { id: 'selectionCount', label: 'Shapes Selecionados', text: String(selCount) },
      nodeArrival:    { id: 'nodeArrival',    label: 'Volume no Nó Selecionado', text: nodeVol === null ? '—' : fmtQty(nodeVol) },
      baseRows:       { id: 'baseRows',       label: 'Linhas da Base', text: fmtQty(baseRows) },
    };
  }, [simResult, incrementalResult, sel, multiSel, selShape, nodeArrivals, csvStore]);

  // ═══ Inspetor do painel direito (UX 2.0 — Sessão 6) ═══
  // Renderiza as PROPRIEDADES do objeto selecionado (não comandos — comandos vivem na
  // Ribbon). Read-only, exceto o rótulo, que reusa a edição inline já existente (via
  // setShapes+pushHistory, o mesmo caminho do duplo-clique/commitEdit). Sem seleção →
  // propriedades do estudo/canvas com dica.
  const _inspTitleStyle = { fontSize:13, fontWeight:700, color:"#1e293b", marginBottom:12, display:"flex", alignItems:"center", gap:7 };
  const _inspHintStyle = { marginTop:6, padding:"9px 11px", borderRadius:8, background:"#f8fafc", border:"1px solid #eef2f7", fontSize:11, color:"#94a3b8", lineHeight:1.5 };
  const _INSP_TYPE_LABEL = { decision:'Losango', cineminha:'Cineminha', decision_lens:'Decision Lens', approved:'Terminal Aprovado', rejected:'Terminal Reprovado', as_is:'Terminal AS IS', frame:'Frame', port:'Porta', simPanel:'Painel de Simulação', csv:'Base' };
  const inspRow = (label, value, opts = {}) => (
    <div key={label} style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:11 }}>
      <span style={{ fontSize:10, color:"#94a3b8", fontWeight:600, textTransform:"uppercase", letterSpacing:.5 }}>{label}</span>
      <div style={{ fontSize:12.5, color:opts.color || "#1e293b", fontWeight:500, lineHeight:1.45, wordBreak:"break-word" }}>{value}</div>
    </div>
  );
  const inspLabelInput = (shape) => (
    <input
      value={shape.label ?? ''}
      onFocus={e => { pushHistory(); e.target.style.borderColor = '#3b82f6'; }}
      onChange={e => { const v = e.target.value; setShapes(p => p.map(s => s.id === shape.id ? { ...s, label: v } : s)); }}
      onBlur={e => { e.target.style.borderColor = '#e2e8f0'; }}
      placeholder="(sem rótulo)"
      style={{ width:"100%", padding:"6px 9px", borderRadius:7, border:"1.5px solid #e2e8f0", background:"#f8fafc",
        fontSize:12.5, color:"#1e293b", fontFamily:"inherit", fontWeight:500, outline:"none", boxSizing:"border-box", transition:"border-color .15s" }}
    />
  );
  const renderInspector = () => {
    // Multi-seleção: sumário + dica (comandos em massa na aba Seleção do Ribbon).
    if (multiSel.size > 1) {
      const byType = {};
      for (const id of multiSel) { const s = shapesById.get(id); if (s) byType[s.type] = (byType[s.type] || 0) + 1; }
      return (
        <div style={{ padding:"14px 16px" }}>
          <div style={_inspTitleStyle}><span>🔲</span>{multiSel.size} objetos selecionados</div>
          {inspRow('Composição', Object.entries(byType).map(([tp, n]) => `${_INSP_TYPE_LABEL[tp] || tp}: ${n}`).join(' · ') || '—')}
          <div style={_inspHintStyle}>Selecione um único objeto para ver e editar suas propriedades. Alinhar, distribuir, Johnny e deletar em massa estão na aba <b>Seleção</b> do Ribbon.</div>
        </div>
      );
    }
    const s = selShape;
    // Sem seleção → propriedades do estudo/canvas.
    if (!s) {
      const canvasName = canvasesR.current?.[activeCanvasId]?.name ?? 'Canvas';
      const bases = Object.values(csvStore);
      return (
        <div style={{ padding:"14px 16px" }}>
          <div style={_inspTitleStyle}><span>📋</span>Estudo</div>
          {inspRow('Aba ativa', canvasName)}
          {inspRow('Objetos no canvas', `${shapes.length} ${shapes.length === 1 ? 'objeto' : 'objetos'}`)}
          {inspRow('Bases vinculadas', bases.length ? bases.map(b => b.name).join(' · ') : '—')}
          <div style={_inspHintStyle}>💡 Selecione um objeto no canvas para inspecionar suas propriedades aqui. Os comandos para criar e transformar objetos estão na Ribbon acima.</div>
        </div>
      );
    }
    const t = s.type;
    // ── Losango de Decisão ──
    if (t === 'decision') {
      const full = conns.filter(c => c.from === s.id).map(c => c.label);
      const visible = effectiveDomain(full, s.visibleVals, nodeArrivals[s.id]?.val);
      const arrival = totalNodeArrival(s, nodeArrivals[s.id]);
      return (
        <div style={{ padding:"14px 16px" }}>
          <div style={_inspTitleStyle}><span>◇</span>Losango de Decisão</div>
          {inspRow('Rótulo', inspLabelInput(s))}
          {inspRow('Variável', s.variableCol || '—')}
          {inspRow('Domínio', full.length
            ? `${visible.length} de ${full.length} ${full.length === 1 ? 'saída visível' : 'saídas visíveis'}${visible.length ? ' — ' + visible.slice(0, 8).join(', ') + (visible.length > 8 ? '…' : '') : ''}`
            : 'Sem saídas conectadas')}
          {inspRow('Chegadas', arrival === null ? '—' : fmtQty(arrival))}
          <div style={_inspHintStyle}>Ajuste variável e domínio pelo <b>⚙ Domínio</b> na aba <b>Decisão</b> do Ribbon.</div>
        </div>
      );
    }
    // ── Cineminha ──
    if (t === 'cineminha') {
      const cfg = getCinemaType(s.cinemaType);
      const rows = (s.rowDomain || []).length || (s.rowVar ? 0 : 1);
      const cols = (s.colDomain || []).length || (s.colVar ? 0 : 1);
      const filled = Object.keys(s.cells || {}).length;
      const arrival = totalNodeArrival(s, nodeArrivals[s.id]);
      return (
        <div style={{ padding:"14px 16px" }}>
          <div style={_inspTitleStyle}><span>{cfg.icon}</span>Cineminha</div>
          {inspRow('Rótulo', inspLabelInput(s))}
          {inspRow('Tipo', `${cfg.icon} ${cfg.label}`)}
          {inspRow('Variável de linha', s.rowVar?.col || '—')}
          {inspRow('Variável de coluna', s.colVar?.col || '—')}
          {inspRow('Grade', `${rows || '—'} × ${cols || '—'} (${filled} ${filled === 1 ? 'célula preenchida' : 'células preenchidas'})`)}
          {inspRow('Resultado', s.resultVar?.col || '—')}
          {inspRow('Travado', s.locked ? 'Sim 🔒' : 'Não', s.locked ? { color:'#b45309' } : {})}
          {inspRow('Chegadas', arrival === null ? '—' : fmtQty(arrival))}
          <div style={_inspHintStyle}>Edite eixos, células e travas pela aba <b>Matriz</b> do Ribbon (⚙ Domínio, ⚙ Otimizar, 🔒 Travar).</div>
        </div>
      );
    }
    // ── Decision Lens ──
    if (t === 'decision_lens') {
      const rules = s.rules || [];
      const pop = computeLensPopulation(rules, csvStore);
      const share = pop.total > 0 ? (pop.count / pop.total) * 100 : null;
      return (
        <div style={{ padding:"14px 16px" }}>
          <div style={_inspTitleStyle}><span>🔎</span>Decision Lens</div>
          {inspRow('Rótulo', inspLabelInput(s))}
          {inspRow('Regras', rules.length
            ? <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {rules.slice(0, 6).map((r, i) => (
                  <div key={i} style={{ padding:"4px 8px", borderRadius:6, background:"#f8fafc", border:"1px solid #eef2f7", fontSize:11.5 }}>
                    {r.col} {r.op} {Array.isArray(r.value) ? r.value.join('–') : r.value}
                  </div>
                ))}
                {rules.length > 6 && <div style={{ fontSize:11, color:"#94a3b8" }}>+{rules.length - 6} regras…</div>}
              </div>
            : 'Nenhuma regra definida')}
          {inspRow('População', pop.total > 0 ? `${fmtQty(pop.count)} de ${fmtQty(pop.total)}${share !== null ? ` (${share.toFixed(1)}%)` : ''}` : '—')}
          <div style={_inspHintStyle}>Ajuste as regras pelo <b>🔎 Configurar</b> na aba <b>Lens</b> do Ribbon.</div>
        </div>
      );
    }
    // ── Terminais (Aprovado / Reprovado / AS IS) ──
    if (t === 'approved' || t === 'rejected' || t === 'as_is') {
      const meta = t === 'approved' ? { icon:'✅', label:'Aprovado' } : t === 'rejected' ? { icon:'❌', label:'Reprovado' } : { icon:'⟳', label:'AS IS' };
      const es = simResult.edgeStats || {};
      const vol = conns.filter(c => c.to === s.id).reduce((a, c) => a + (es[c.id]?.qty || 0), 0);
      return (
        <div style={{ padding:"14px 16px" }}>
          <div style={_inspTitleStyle}><span>{meta.icon}</span>Terminal · {meta.label}</div>
          {inspRow('Rótulo', inspLabelInput(s))}
          {inspRow('Tipo', `${meta.icon} ${meta.label}`)}
          {inspRow('Volume que chega', fmtQty(vol))}
          {t === 'as_is' && <div style={_inspHintStyle}>O terminal AS IS mantém o comportamento original da base sem alterar o resultado da simulação.</div>}
        </div>
      );
    }
    // ── Frame ──
    if (t === 'frame') {
      return (
        <div style={{ padding:"14px 16px" }}>
          <div style={_inspTitleStyle}><span>▭</span>Frame</div>
          {inspRow('Rótulo', inspLabelInput(s))}
          {inspRow('Dimensões', `${Math.round(s.w)} × ${Math.round(s.h)} px`)}
        </div>
      );
    }
    // ── Painel de Simulação / Porta / outros — read-only mínimo ──
    return (
      <div style={{ padding:"14px 16px" }}>
        <div style={_inspTitleStyle}><span>🔧</span>{_INSP_TYPE_LABEL[t] || t}</div>
        {s.label != null && t !== 'simPanel' && t !== 'port' && inspRow('Rótulo', inspLabelInput(s))}
        {inspRow('Tipo', _INSP_TYPE_LABEL[t] || t)}
        <div style={_inspHintStyle}>Este objeto não tem propriedades editáveis no Inspetor.</div>
      </div>
    );
  };

  // Dicas do canvas vazio (Épico EB, EB4, DEC-EB-012): canvas ativo vazio + alguma base já
  // carregada ⇒ 1ª dica aponta para a aba Explorar como primeiro passo da jornada. Mesma
  // fonte única (CANVAS_TIPS) usada pelo card flutuante e pela seção Sobre do Hub — só
  // prefixa, nunca substitui.
  const canvasTips = (shapes.length === 0 && Object.keys(csvStore).length > 0)
    ? ['🔎 Base carregada — comece pela aba Explorar para conhecer os dados', ...CANVAS_TIPS]
    : CANVAS_TIPS;

  // ═══ REGIÃO: JSX — Shell da Aplicação (toolbar, abas, canvas) ═══
  // ────────────────────────────────────────────────────────────────────────────
  // JSX
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{display:"flex",flexDirection:"column",width:"100%",height:"100vh",overflow:"hidden",fontFamily:"'DM Sans',system-ui,sans-serif",background:"#f1f5f9"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        .wbt{transition:background .12s,color .12s;touch-action:manipulation;}
        .wbt:hover{background:#eff6ff!important;color:#2563eb!important;}
        .wbz{touch-action:manipulation;}
        .wbz:hover{background:#eff6ff!important;color:#2563eb!important;}
        .wbz:active{transform:scale(.93);}
        .wbmini{transition:background .12s;}
        .wbmini:hover{background:rgba(255,255,255,.12);}
        .rtab,.rctxtab{touch-action:manipulation;}
        @media(max-width:560px){.wbl{display:none!important;}}
      `}</style>

      {/* ═══════════════ RIBBON (UX 2.0 — Sessão 1) ═══════════════ */}
      {/* Modo `fixed`: ocupa altura no topo do flex-column → o CANVAS PANE (flex:1) reflowa
          para baixo sozinho. svgPt/toWorld leem getBoundingClientRect ao vivo (invariante de
          posicionamento intacto — nada cacheado). Só no canvas; o Dashboard tem UI própria. */}
      {activeTab === "canvas" && (
        <Ribbon
          commands={COMMANDS}
          activeTab={ribbonShownTab}
          onTab={(id) => { setRibbonActiveTab(id); setCtxTabShown(false); }}
          contextTab={activeContextTab ? { id: activeContextTab, label: CTX_TAB_META[activeContextTab] } : null}
          contextCommands={contextCommands}
          onCtxTab={() => setCtxTabShown(true)}
          onOpenSettings={() => openSettings()}
          onOpenSearch={openCmdPalette}
          mode={ribbonMode}
          onCycleMode={cycleRibbonMode}
          qat={{
            undo, redo, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0,
            onDelete: deleteSelected, canDelete: (!!sel || multiSel.size > 0), onSave: saveProject,
            // Sessão 9: reusa o onRun já registrado no descritor `project.open` — sem duplicar
            // a lógica de abrir arquivo (input file + projectInputRef já existentes).
            onOpen: COMMANDS.find(c => c.id === 'project.open')?.onRun,
          }}
        />
      )}

      {/* ═══════════════ ANALYSIS PANE ═══════════════ */}
      {activeTab==="analysis" && <AnalysisTab analyticsDataset={groupedDataset} baseDataset={analyticsDataset} analyticsLayout={analyticsLayout} setAnalyticsLayout={setAnalyticsLayout} groupings={analyticsGroupings} setGroupings={setAnalyticsGroupings} pageFilters={analyticsPageFilters} setPageFilters={setAnalyticsPageFilters} scopeNotice={analyticsScopeNotice} onDismissScopeNotice={()=>setAnalyticsScopeNotice(null)} />}

      {/* ═══════════════ EXPLORE PANE (Épico EB, EB2 + EB4) ═══════════════ */}
      {activeTab==="explore" && <ExploreTab profile={baseProfileResult} csvStore={csvStore}
        csvId={exploreCsvId} onCsvIdChange={setExploreCsvId}
        riskMetric={exploreRiskMetric} onRiskMetricChange={setExploreRiskMetric}
        layout={exploreLayouts[exploreCsvId] || []} setLayout={(updater) => setExploreLayoutForCsv(exploreCsvId, updater)}
        onRegenerate={regenerateExploreLayout}
        actions={{ onUseAsFirstBranch: exploreUseAsFirstBranch, onCreateRanges: exploreCreateRangesFor, onClusterize: exploreClusterizeFrom, onEditVar: exploreEditVar }}
        datasetGrouped={groupedExploreDataset} datasetRaw={exploreAnalyticsDataset}
        groupings={exploreGroupings[exploreCsvId] || []} setGroupings={(updater) => setExploreGroupingsForCsv(exploreCsvId, updater)}
        pageFilters={explorePageFilters[exploreCsvId] || []} setPageFilters={(updater) => setExplorePageFiltersForCsv(exploreCsvId, updater)}
        actionNotice={exploreActionNotice} onDismissActionNotice={()=>setExploreActionNotice(null)} />}

      {/* ═══════════════ CANVAS PANE ═══════════════ */}
      <div style={{display:activeTab==="canvas"?"flex":"none",flex:1,minHeight:0,width:"100%",overflow:"hidden",position:"relative"}}>

      {/* ═══════════════ CANVAS AREA ═══════════════ */}
      <div style={{flex:1,position:"relative",overflow:"hidden"}}>

        {/* Toolbars flutuantes de contexto APOSENTADAS (UX 2.0 — Sessão 2): todo o
        conteúdo (alinhamento, Cineminha, Johnny, losango, Lens, terminal, porta) migrou
        para as abas contextuais do Ribbon (Matriz/Decisão/Lens/Terminal/Porta/Seleção),
        renderizadas a partir dos descritores `ctx.*` do registro COMMANDS via
        contextWhen(selection). O mini-flutuante ergonômico de Deletar/Duplicar (Sessão 8,
        logo abaixo) e a paleta de cor (acionada pelo comando org.color) são os únicos
        overlays de shape que restam fora do registro — não são "comandos de aba". */}

        {/* Mini-flutuante de seleção (UX 2.0 — Sessão 8) — só Deletar/Duplicar, perto do
            shape. Só single-seleção (sel sem multiSel); some durante arraste (shapes
            arrastados saem de `shapes` para o overlay leve — posição ficaria congelada)
            e durante a edição inline do rótulo/paleta de cor aberta. */}
        {sel && multiSel.size===0 && selShape && !dragIds && !edit && !palette && (
          <SelectionMiniToolbar shape={selShape} vp={vp} onDuplicate={duplicateSelected} onDelete={deleteSelected}/>
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

        {/* Zoom controls — o indicador de % solto migrou para a Status Bar (UX 2.0 —
            Sessão 5, zona direita fixa); os botões +/−/⌂ permanecem no canto do canvas. */}
        <div style={{position:"absolute",bottom:16,right:16,zIndex:200,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
          {[["+",()=>zoomCenter(1.2)],["−",()=>zoomCenter(1/1.2)],["⌂",()=>setVp({x:20,y:40,s:1})]].map(([icon,fn])=>(
            <button key={icon} className="wbz" onClick={fn} style={{width:36,height:36,borderRadius:10,border:"1px solid #e2e8f0",background:"#fff",boxShadow:"0 1px 4px rgba(0,0,0,.08)",color:"#64748b",cursor:"pointer",fontSize:17,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit",transition:"all .15s"}}>{icon}</button>
          ))}
        </div>

        {/* Floating hint */}
        {(fromId||hint)&&(
          <div style={{position:"absolute",bottom:16,left:"50%",transform:"translateX(-50%)",zIndex:200,padding:"8px 18px",borderRadius:10,background:fromId?"#fffbeb":"#eff6ff",border:fromId?"1px solid #fde68a":"1px solid #bfdbfe",color:fromId?"#92400e":"#1d4ed8",fontSize:12.5,fontFamily:"inherit",whiteSpace:"nowrap",boxShadow:"0 2px 8px rgba(0,0,0,.08)"}}>
            {fromId?"⟶ Clique em outro elemento para conectar · Esc cancela":hint}
          </div>
        )}

        {/* Convite pós-import (Épico EB, EB4, DEC-EB-012) — nunca bloqueante, dispensável.
            Só para a base que acabou de ser importada (postImportInvite.csvId). */}
        {postImportInvite && (
          <div style={{position:"absolute",top:16,left:"50%",transform:"translateX(-50%)",zIndex:200,display:"flex",alignItems:"center",gap:10,padding:"9px 12px 9px 16px",borderRadius:12,background:"#eff6ff",border:"1px solid #bfdbfe",color:"#1d4ed8",fontSize:12.5,fontFamily:"inherit",whiteSpace:"nowrap",boxShadow:"0 4px 14px rgba(0,0,0,.1)"}}>
            <span>🔎 Análise da base "{postImportInvite.filename}" pronta</span>
            <button onClick={()=>{setActiveTab('explore');setExploreCsvId(postImportInvite.csvId);setPostImportInvite(null);}}
              style={{padding:"5px 12px",borderRadius:8,border:"none",background:"#2563eb",color:"#fff",cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit"}}>
              Abrir Explorar
            </button>
            <button onClick={()=>setPostImportInvite(null)} title="Dispensar"
              style={{border:"none",background:"transparent",color:"#2563eb",cursor:"pointer",fontSize:13,padding:"0 2px",lineHeight:1}}>✕</button>
          </div>
        )}

        {/* Tips — em telas estreitas (touch/mobile) o card ocuparia espaço precioso do
            canvas; o mesmo conteúdo (CANVAS_TIPS) migra para a seção ℹ️ Sobre do Hub
            (UX 2.0 — Sessão 8). Canvas vazio + alguma base carregada (Épico EB, EB4,
            DEC-EB-012): 1ª dica aponta para a aba Explorar como primeiro passo. */}
        {!isNarrowScreen && (
          <div style={{position:"absolute",bottom:16,left:16,zIndex:100,background:"#fff",border:"1px solid #e2e8f0",boxShadow:"0 1px 4px rgba(0,0,0,.06)",color:"#94a3b8",padding:"7px 11px",borderRadius:10,fontSize:10.5,fontFamily:"inherit",lineHeight:1.9}}>
            <span style={{color:"#64748b",fontWeight:600}}>Dicas</span><br/>
            {canvasTips.map((t, i) => <span key={i}>{t}<br/></span>)}
          </div>
        )}

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
          {/* 🐍 ComputeEngineBadge + BuildBadge MIGRARAM para a Status Bar (UX 2.0 — Sessão 5,
              zona direita fixa). */}
          <button
            onClick={()=>setPanelCollapsed(true)}
            title="Ocultar painel"
            style={{width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:6,border:"1px solid #e2e8f0",background:"transparent",color:"#94a3b8",cursor:"pointer",fontSize:13,fontWeight:700,lineHeight:1,padding:0,flexShrink:0,transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="#f1f5f9";e.currentTarget.style.color="#475569";e.currentTarget.style.borderColor="#cbd5e1";}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color="#94a3b8";e.currentTarget.style.borderColor="#e2e8f0";}}>
            ›
          </button>
        </div>

        {/* Abas internas do painel (UX 2.0 — Sessão 6): Ativos / Inspetor / 🧭 Copiloto.
            Painel continua à direita (com o panelCollapsed existente); só o conteúdo do
            corpo troca por aba. `rightPanelMode` persistido (sessionStorage + .credito.json). */}
        <div style={{display:"flex",gap:2,padding:"6px 8px",borderBottom:"1px solid #f1f5f9",flexShrink:0}}>
          {[
            { id:'assets',    label:'Ativos' },
            { id:'inspector', label:'Inspetor' },
            { id:'copilot',   label:'Copiloto', icon:'🧭', badge: (nextActionsModel?.actions || []).filter(a => a.severity !== 'journey' && !nextActionsPrefs.dismissed.includes(a.fingerprint) && !nextActionsPrefs.snoozed.includes(a.fingerprint)).length },
          ].map(tab => {
            const on = rightPanelMode === tab.id;
            return (
              <button key={tab.id} onClick={()=>setRightPanelMode(tab.id)} title={tab.label}
                style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:4,padding:"6px 4px",borderRadius:7,
                  border:"none",cursor:"pointer",fontFamily:"inherit",fontSize:11.5,fontWeight:on?700:500,
                  background:on?"#eff6ff":"transparent",color:on?"#2563eb":"#64748b",transition:"all .12s"}}
                onMouseEnter={e=>{if(!on)e.currentTarget.style.background="#f8fafc";}}
                onMouseLeave={e=>{if(!on)e.currentTarget.style.background="transparent";}}>
                {tab.icon && <span style={{fontSize:12}}>{tab.icon}</span>}
                <span>{tab.label}</span>
                {tab.badge > 0 && (
                  <span style={{fontSize:9.5,fontWeight:700,color:"#fff",background:on?"#2563eb":"#94a3b8",borderRadius:20,padding:"1px 5px",lineHeight:1.3,minWidth:15,textAlign:"center"}}>{tab.badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Scrollable content area */}
        <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column"}}>

        {/* Inputs de arquivo (ocultos) — acionados pelos comandos do Ribbon (Projeto/Dados/
            Fluxo) e pelas toolbars de contexto. Migraram para cá com as seções; permanecem
            sempre montados, fora de qualquer seção condicional. */}
        <input ref={projectInputRef} type="file" accept=".json,.credito.json,application/json" style={{display:"none"}} onChange={onProjectFileChange}/>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={onFileChange}/>
        <input ref={flowImportRef} type="file" accept=".json,application/json" style={{display:"none"}} onChange={onFlowFileChange}/>
        <input ref={cinemaImportRef} type="file" accept=".json,application/json" style={{display:"none"}} onChange={onCinemaFileChange}/>
        <input ref={libFileInputRef} type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={onLibFileChange}/>
        <input ref={policyLibFileInputRef} type="file" accept=".json,application/json" style={{display:"none"}} onChange={onPolicyLibFileChange}/>

        {/* Avisos de Projeto/Fluxo — antes viviam nas seções Projeto/Fluxo (migradas ao
            Ribbon). O feedback continua no painel, no topo do conteúdo. */}
        {(projectSaveNotice || projectLoadNotice || importWarn) && (
          <div style={{padding:"12px 16px 0",display:"flex",flexDirection:"column",gap:8}}>
            {projectSaveNotice && (
              <div style={{padding:"7px 10px",borderRadius:8,fontSize:11.5,lineHeight:1.35,display:"flex",alignItems:"flex-start",gap:6,
                background: projectSaveNotice.kind==="ok" ? "#f0fdf4" : "#fef2f2",
                color: projectSaveNotice.kind==="ok" ? "#15803d" : "#b91c1c",
                border: `1px solid ${projectSaveNotice.kind==="ok" ? "#bbf7d0" : "#fecaca"}`}}>
                <span>{projectSaveNotice.kind==="ok" ? "✅" : "⚠️"}</span>
                <span style={{flex:1}}>{projectSaveNotice.msg}</span>
                <span onClick={()=>setProjectSaveNotice(null)} style={{cursor:"pointer",opacity:.6,fontWeight:700}} title="Dispensar">×</span>
              </div>
            )}
            {projectLoadNotice && (
              <div style={{padding:"9px 10px",borderRadius:8,fontSize:11.5,lineHeight:1.5,display:"flex",alignItems:"flex-start",gap:7,
                background:"#fdf4ff",border:"1px solid #f0abfc",color:"#86198f"}}>
                <span style={{fontSize:14}}>🐍</span>
                <span style={{flex:1}}>
                  Este projeto tem ~{projectLoadNotice.totalRows.toLocaleString('pt-BR')} linhas
                  (~{formatRamBytes(projectLoadNotice.totalBytes)} estimados) — acima da zona de
                  conforto do navegador (~5MM linhas / ~1,2GB). O app segue funcionando normalmente
                  no browser; para trabalhar sem tetos, {' '}
                  <span onClick={()=>{ openSettings('motor-python'); setProjectLoadNotice(null); }}
                    style={{textDecoration:"underline",cursor:"pointer",fontWeight:600}}>
                    saiba como ligar o Motor Python
                  </span>.
                </span>
                <span onClick={()=>setProjectLoadNotice(null)} style={{cursor:"pointer",opacity:.6,fontWeight:700}} title="Dispensar">×</span>
              </div>
            )}
            {importWarn && (
              <div style={{padding:"8px 10px",borderRadius:8,background:"#fffbeb",border:"1px solid #fde68a",fontSize:11,color:"#92400e",lineHeight:1.5,display:"flex",gap:6,alignItems:"flex-start"}}>
                <span style={{flexShrink:0}}>⚠</span>
                <span>{importWarn}</span>
              </div>
            )}
          </div>
        )}

        {/* Motor Python e Visualização MIGRARAM para o ⚙ Hub de Configurações (UX 2.0 —
            Sessão 3): openSettings('motor-python') / seção 🎨 Visualização. Ver o modal
            `settingsModal` mais abaixo. Os estados (computeSidecar, toggles de aresta)
            continuam vivos aqui no App e persistidos como antes (sem bump de schema). */}

        {/* ═══ Aba ATIVOS: bases carregadas + variáveis de decisão + atalhos às bibliotecas ═══ */}
        {/* Loaded CSVs list */}
        {rightPanelMode === 'assets' && Object.keys(csvStore).length > 0 && (
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
        {rightPanelMode === 'assets' && decisionVars.length > 0 && (
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
                const isRng = !isClu && isRangeVar(csvStore, csvId, col);
                // Chip de cluster: tom roxo + 🧩; chip de faixas: tom teal + 📐; ambos com
                // ✏️ (editar regras/renomear); chip normal: âmbar.
                const base = isClu
                  ? {border:"#ddd6fe",bg:"#f5f3ff",hoverBg:"#ede9fe",hoverBorder:"#c4b5fd",color:"#6d28d9",icon:"🧩"}
                  : isRng
                  ? {border:"#99f6e4",bg:"#f0fdfa",hoverBg:"#ccfbf1",hoverBorder:"#5eead4",color:"#0f766e",icon:"📐"}
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
                  {isRng && (
                    <button
                      title="Editar variável de faixas (renomear, mover cortes)"
                      onMouseDown={(e)=>{e.stopPropagation();}}
                      onTouchStart={(e)=>{e.stopPropagation();}}
                      onClick={(e)=>{e.stopPropagation();openRangeVarEdit(csvId,col);}}
                      style={{width:20,height:20,borderRadius:6,border:"1px solid #99f6e4",background:"#fff",color:"#0f766e",
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

        {/* Atalhos às bibliotecas (UX 2.0 — Sessão 6): entrada rápida para as bibliotecas de
            Cineminha e de Políticas direto do painel de Ativos. O comando canônico continua na
            Ribbon (Inserir/Política) — aqui é só um atalho de descoberta. */}
        {rightPanelMode === 'assets' && (
          <div style={{padding:"12px 16px",borderBottom:"1px solid #f1f5f9"}}>
            <p style={{fontSize:11,color:"#94a3b8",marginBottom:8,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Bibliotecas</p>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              <button onClick={()=>openCinemaLibrary(null,'browse')}
                title="Abrir a biblioteca de Cineminhas salvas"
                style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,border:"1px solid #e0e7ff",background:"#eef2ff",color:"#4338ca",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,textAlign:"left",transition:"all .12s"}}
                onMouseEnter={e=>{e.currentTarget.style.background="#e0e7ff";}}
                onMouseLeave={e=>{e.currentTarget.style.background="#eef2ff";}}>
                <span style={{fontSize:14}}>📥</span><span style={{flex:1}}>Biblioteca de Cineminhas</span><span style={{opacity:.5}}>›</span>
              </button>
              <button onClick={()=>openPolicyLibrary('browse')}
                title="Abrir a biblioteca de Políticas salvas"
                style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,border:"1px solid #fde68a",background:"#fef9c3",color:"#92400e",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,textAlign:"left",transition:"all .12s"}}
                onMouseEnter={e=>{e.currentTarget.style.background="#fef3c7";}}
                onMouseLeave={e=>{e.currentTarget.style.background="#fef9c3";}}>
                <span style={{fontSize:14}}>📚</span><span style={{flex:1}}>Biblioteca de Políticas</span><span style={{opacity:.5}}>›</span>
              </button>
            </div>
          </div>
        )}

        {/* ═══ Aba INSPETOR: propriedades do objeto selecionado (sem comandos) ═══ */}
        {rightPanelMode === 'inspector' && renderInspector()}

        {/* ═══ Aba COPILOTO: Feed de Próxima Melhor Ação (Jornada NB, Sessão NB1/NB2, DEC-NB-005) ═══ */}
        {/* Substitui o antigo painel de lint isolado (Sessão 1) — o lint entra no feed como
            cards `connect_port`/`fix_lint_*` (MESMA fonte, computePolicyInsights, um único
            lugar). NextActionsModel DERIVADO (não persiste); descarte/adiamento por card É
            criação do usuário e persiste em `nextActionsPrefs` (DEC-NB-006). */}
        {rightPanelMode === 'copilot' && (() => {
          const model = nextActionsModel;
          const dismissedSet = new Set(nextActionsPrefs.dismissed);
          const snoozedSet = new Set(nextActionsPrefs.snoozed);
          const allActions = model?.actions || [];
          const isOut = (a) => dismissedSet.has(a.fingerprint) || snoozedSet.has(a.fingerprint);
          const visibleActions = allActions.filter(a => !isOut(a));
          const discardedActions = allActions.filter(isOut);
          const byStage = journeyStageFilter
            ? (arr) => arr.filter(a => stageForActionKind(a.kind) === journeyStageFilter)
            : (arr) => arr;
          const shown = byStage(showDiscardedActions ? discardedActions : visibleActions);
          const activeStage = journeyStages ? journeyStages.find(s => s.id === journeyStageFilter) : null;
          const readinessPassCount = journeyReadiness
            ? journeyReadiness.criteria.filter(c => c.state === 'pass').length : 0;
          const readinessActiveCount = journeyReadiness
            ? journeyReadiness.criteria.filter(c => c.state !== 'na').length : 0;
          return (
            <div style={{padding:"12px 16px",borderBottom:"1px solid #f1f5f9"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,gap:6}}>
                <p style={{fontSize:11,color:"#94a3b8",fontWeight:500,textTransform:"uppercase",letterSpacing:.6,margin:0}}>
                  🧭 Copiloto{showDiscardedActions ? ' — Descartados' : ''}
                </p>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  {!showDiscardedActions && visibleActions.length > 0 && (
                    <span style={{fontSize:10.5,fontWeight:700,color:"#64748b",background:"#f1f5f9",borderRadius:20,padding:"2px 8px"}}>
                      {visibleActions.length}
                    </span>
                  )}
                  {(discardedActions.length > 0 || showDiscardedActions) && (
                    <button onClick={()=>setShowDiscardedActions(v=>!v)}
                      title={showDiscardedActions ? "Voltar ao feed" : "Ver cards descartados/adiados"}
                      style={{padding:"2px 8px",borderRadius:20,border:"1px solid #e2e8f0",background:showDiscardedActions?"#eff6ff":"#fff",color:showDiscardedActions?"#2563eb":"#94a3b8",cursor:"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit"}}>
                      {showDiscardedActions ? '← Feed' : `🗂 Descartados (${discardedActions.length})`}
                    </button>
                  )}
                </div>
              </div>

              {/* ── Trilho de Etapas (Jornada EP, Sessão EP2, DEC-EP-001/004) ─────────────
                  6 etapas canônicas — GUIA, nunca wizard bloqueante (tudo continua acessível
                  em qualquer ordem). Clique numa etapa filtra o feed abaixo pelos cards
                  daquela etapa (ACTION_KIND_STAGE); colapso persiste em journeyState. */}
              {!showDiscardedActions && (
                <div style={{marginBottom:8,padding:"8px 8px 6px",borderRadius:8,background:"#f8fafc",border:"1px solid #e2e8f0"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom: journeyState.railCollapsed ? 0 : 6}}>
                    <span style={{fontSize:10,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:.5}}>🧭 Etapas da política</span>
                    <button onClick={()=>setJourneyState(p=>({...p,railCollapsed:!p.railCollapsed}))}
                      title={journeyState.railCollapsed ? "Expandir trilho" : "Recolher trilho"}
                      style={{background:"none",border:"none",padding:0,cursor:"pointer",fontSize:11,color:"#94a3b8",fontFamily:"inherit"}}>
                      {journeyState.railCollapsed ? '▸ Expandir' : '▾ Recolher'}
                    </button>
                  </div>
                  {!journeyState.railCollapsed && (
                    <>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                        {(journeyStages || STAGE_IDS.map(id => ({ id, state:'todo', override:null, facts:{} }))).map(st => {
                          const meta = JOURNEY_STAGE_META[st.id];
                          const done = st.state === 'done';
                          const active = journeyStageFilter === st.id;
                          return (
                            <button key={st.id}
                              onClick={()=>setJourneyStageFilter(f => f === st.id ? null : st.id)}
                              title={meta.label}
                              style={{padding:"3px 8px",borderRadius:20,cursor:"pointer",fontFamily:"inherit",fontSize:10.5,fontWeight:600,
                                border: active ? "1.5px solid #2563eb" : `1px solid ${done ? "#bbf7d0" : "#e2e8f0"}`,
                                background: active ? "#eff6ff" : (done ? "#f0fdf4" : "#fff"),
                                color: active ? "#2563eb" : (done ? "#15803d" : "#94a3b8"),
                                display:"flex",alignItems:"center",gap:4}}>
                              <span>{done ? '✓' : (st.index + 1)}</span>
                              <span>{meta.short}</span>
                              {st.override && <span title={st.override === 'done' ? "Marcada manualmente" : "Reaberta manualmente"} style={{opacity:.7}}>✎</span>}
                            </button>
                          );
                        })}
                      </div>
                      {activeStage && (
                        <div style={{marginTop:6,padding:"6px 8px",borderRadius:6,background:"#fff",border:"1px solid #e2e8f0",fontSize:10.5,color:"#475569",lineHeight:1.5}}>
                          <div style={{fontWeight:700,color:"#334155",marginBottom:2}}>{JOURNEY_STAGE_META[activeStage.id].label} — {activeStage.state === 'done' ? 'Concluída' : 'Pendente'}{activeStage.override ? ' (override manual)' : ''}</div>
                          <div>{describeJourneyStageFacts(activeStage)}</div>
                          <div style={{marginTop:4,opacity:.85}}>ⓘ {JOURNEY_STAGE_WHY[activeStage.id]}</div>
                          <div style={{display:"flex",gap:6,marginTop:6}}>
                            {activeStage.override !== 'done' && (
                              <button onClick={()=>setStageOverride(activeStage.id, 'done')}
                                style={{padding:"2px 8px",borderRadius:6,border:"1px solid #bbf7d0",background:"#f0fdf4",color:"#15803d",cursor:"pointer",fontSize:10,fontWeight:600,fontFamily:"inherit"}}>
                                ✓ Marcar concluída
                              </button>
                            )}
                            {activeStage.override !== 'reopened' && (
                              <button onClick={()=>setStageOverride(activeStage.id, 'reopened')}
                                style={{padding:"2px 8px",borderRadius:6,border:"1px solid #fde68a",background:"#fffbeb",color:"#92400e",cursor:"pointer",fontSize:10,fontWeight:600,fontFamily:"inherit"}}>
                                ↺ Reabrir
                              </button>
                            )}
                            {activeStage.override && (
                              <button onClick={()=>setStageOverride(activeStage.id, null)}
                                style={{padding:"2px 8px",borderRadius:6,border:"1px solid #e2e8f0",background:"#fff",color:"#94a3b8",cursor:"pointer",fontSize:10,fontWeight:600,fontFamily:"inherit"}}>
                                Usar detecção automática
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Checklist de Prontidão (card fixo, DEC-EP-003/004) — modal expandido abre
                  tests/policyJourney.test.js abaixo. */}
              {!showDiscardedActions && journeyReadiness && (
                <button onClick={()=>setReadinessModalOpen(true)}
                  title="Ver o Checklist de Prontidão completo"
                  style={{width:"100%",marginBottom:8,padding:"7px 10px",borderRadius:8,border:"1px solid #e2e8f0",
                    background:"#fff",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"space-between",gap:6}}>
                  <span style={{fontSize:11.5,fontWeight:600,color:"#334155"}}>✅ Checklist de Prontidão</span>
                  <span style={{fontSize:10.5,fontWeight:700,color: readinessPassCount === readinessActiveCount && readinessActiveCount > 0 ? "#15803d" : "#64748b",
                    background: readinessPassCount === readinessActiveCount && readinessActiveCount > 0 ? "#f0fdf4" : "#f1f5f9", borderRadius:20,padding:"2px 8px"}}>
                    {readinessPassCount}/{readinessActiveCount}
                  </span>
                </button>
              )}

              {/* 🔎 Buscar oportunidades (Sessão NB3): roda Descoberta + Simplificação fora do
                  tick e injeta os achados como cards Tier 2 carimbados. Fica no feed, não no
                  Ribbon — é a ação do Copiloto que popula as fontes caras sob demanda. */}
              {!showDiscardedActions && (
                <button onClick={runOpportunityScan} disabled={nextActionsScanning}
                  title="Descobrir segmentos e simplificações acionáveis (fora do tick de edição)"
                  style={{width:"100%",marginBottom:8,padding:"7px 10px",borderRadius:8,border:"1px solid #ddd6fe",
                    background: nextActionsScanning ? "#f5f3ff" : "#faf5ff", color:"#7c3aed",
                    cursor: nextActionsScanning ? "default" : "pointer", fontSize:11.5,fontWeight:600,fontFamily:"inherit",
                    display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                  {nextActionsScanning ? '🔎 Buscando oportunidades…' : '🔎 Buscar oportunidades'}
                </button>
              )}

              {!model && (
                <div style={{padding:"18px 4px",fontSize:12,color:"#94a3b8",lineHeight:1.6,textAlign:"center"}}>
                  🧭 Calculando o feed…
                </div>
              )}
              {model && shown.length === 0 && (
                <div style={{padding:"9px 10px",borderRadius:8,background: showDiscardedActions ? "#f8fafc" : "#f0fdf4",border:`1px solid ${showDiscardedActions?"#e2e8f0":"#bbf7d0"}`,fontSize:11.5,color: showDiscardedActions ? "#94a3b8" : "#15803d",lineHeight:1.5,display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                  <span>{showDiscardedActions ? '🗂' : '✅'}</span>
                  <span>{showDiscardedActions ? 'Nenhum card descartado ou adiado.' : (journeyStageFilter ? 'Nenhuma pendência para esta etapa.' : 'Nenhuma pendência no momento.')}</span>
                  {journeyStageFilter && !showDiscardedActions && (
                    <button onClick={()=>setJourneyStageFilter(null)}
                      style={{marginLeft:"auto",background:"none",border:"none",padding:0,cursor:"pointer",fontSize:10.5,color:"#15803d",textDecoration:"underline",fontFamily:"inherit"}}>
                      Limpar filtro
                    </button>
                  )}
                </div>
              )}
              {model && shown.length > 0 && journeyStageFilter && !showDiscardedActions && (
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6,fontSize:10.5,color:"#64748b"}}>
                  <span>Filtrado por: <b>{JOURNEY_STAGE_META[journeyStageFilter]?.label}</b></span>
                  <button onClick={()=>setJourneyStageFilter(null)}
                    style={{background:"none",border:"none",padding:0,cursor:"pointer",fontSize:10.5,color:"#2563eb",textDecoration:"underline",fontFamily:"inherit"}}>
                    Limpar
                  </button>
                </div>
              )}
              {model && shown.length > 0 && (
                <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:460,overflowY:"auto"}}>
                  {shown.map(action => {
                    const meta = NEXT_ACTION_SEV_META[action.severity] || NEXT_ACTION_SEV_META.journey;
                    const facts = action.title?.facts || {};
                    const nodeId = facts.nodeId ?? null;
                    const nodeExists = nodeId != null && shapes.some(s => s.id === nodeId);
                    const whyOpen = expandedActionWhy.has(action.id);
                    const discarded = isOut(action);
                    return (
                      <div key={action.id} style={{padding:"8px 10px",borderRadius:8,background:meta.bg,border:`1px solid ${meta.border}`,fontSize:11.5,color:meta.color,lineHeight:1.45,opacity: action.actionable === false ? .75 : 1}}>
                        <div style={{display:"flex",gap:6,alignItems:"flex-start"}}>
                          <span style={{flexShrink:0}}>{meta.emoji}</span>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
                              <span style={{fontSize:9.5,fontWeight:700,textTransform:"uppercase",letterSpacing:.4,opacity:.7}}>{severityLabel(action.severity)}</span>
                              {action.staleness?.stale && (
                                <span style={{fontSize:9.5,fontWeight:700,color:"#92400e",background:"#fffbeb",border:"1px solid #fde68a",borderRadius:20,padding:"0 6px"}}>⏳ desatualizado</span>
                              )}
                            </div>
                            <span>{describeAction(action)}</span>
                            {action.actionable === false && (
                              <div style={{marginTop:4,fontSize:10.5,color:"#92400e"}}>
                                🔒 {action.reason === 'node_locked' ? 'Nó travado — destrave para agir.' : (action.reason || 'Não acionável no momento.')}
                              </div>
                            )}
                            {action.delta != null && (
                              <div style={{marginTop:4,fontSize:10.5,fontWeight:600}}>{formatActionDelta(action.delta)}</div>
                            )}
                            <button onClick={()=>toggleActionWhy(action.id)}
                              style={{display:"block",marginTop:4,background:"none",border:"none",padding:0,cursor:"pointer",fontSize:10.5,color:meta.color,opacity:.75,fontFamily:"inherit",textDecoration:"underline"}}>
                              {whyOpen ? 'ⓘ Ocultar' : 'ⓘ Por que isso importa'}
                            </button>
                            {whyOpen && (
                              <div style={{marginTop:4,padding:"6px 8px",borderRadius:6,background:"rgba(255,255,255,.6)",fontSize:10.5,color:"#475569",lineHeight:1.5}}>
                                {describeWhyItMatters(action)}
                              </div>
                            )}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap",alignItems:"center"}}>
                          {nodeExists && (
                            <button onClick={()=>goToCopilotNode(nodeId)}
                              title="Selecionar e centralizar este nó no canvas"
                              style={{padding:"3px 9px",borderRadius:6,border:`1px solid ${meta.border}`,background:"#fff",color:meta.color,cursor:"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit"}}>
                              🎯 Ir até o nó
                            </button>
                          )}
                          {/* Tier 2 desatualizado (Sessão NB3, DEC-NB-003): recalcular é gesto
                              explícito — o card nunca some nem se atualiza sozinho. */}
                          {action.staleness?.stale && !discarded && (
                            <button onClick={runOpportunityScan} disabled={nextActionsScanning}
                              title="A política mudou desde a última busca — recalcular as oportunidades"
                              style={{padding:"3px 9px",borderRadius:6,border:"1px solid #fde68a",background:"#fffbeb",color:"#92400e",cursor:nextActionsScanning?"default":"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit"}}>
                              {nextActionsScanning ? '🔄 Recalculando…' : '🔄 Recalcular'}
                            </button>
                          )}
                          {action.actionable !== false && !discarded && (action.cta || []).map((cta, ci) => (
                            cta.commandId === 'copilot.connectTerminal' ? [
                              <button key={`${ci}-r`} onClick={()=>runNextActionCTA({ ...cta, args: { ...cta.args, terminal: 'rejected' } })}
                                title="Conectar esta saída a um novo terminal Reprovado"
                                style={{padding:"3px 9px",borderRadius:6,border:"1px solid #fecaca",background:"#fff1f2",color:"#b91c1c",cursor:"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit"}}>
                                ❌ Reprovado
                              </button>,
                              <button key={`${ci}-a`} onClick={()=>runNextActionCTA({ ...cta, args: { ...cta.args, terminal: 'approved' } })}
                                title="Conectar esta saída a um novo terminal Aprovado"
                                style={{padding:"3px 9px",borderRadius:6,border:"1px solid #bbf7d0",background:"#f0fdf4",color:"#15803d",cursor:"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit"}}>
                                ✅ Aprovado
                              </button>,
                            ] : (
                              <button key={ci} onClick={()=>runNextActionCTA(cta)}
                                title={ctaLabel(cta.labelCode)}
                                style={{padding:"3px 9px",borderRadius:6,border:`1px solid ${meta.border}`,background:"#fff",color:meta.color,cursor:"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit"}}>
                                {ctaLabel(cta.labelCode)}
                              </button>
                            )
                          ))}
                          {discarded ? (
                            <button onClick={()=>restoreNextAction(action.fingerprint)}
                              title="Restaurar este card ao feed"
                              style={{marginLeft:"auto",padding:"3px 9px",borderRadius:6,border:"1px solid #bfdbfe",background:"#eff6ff",color:"#2563eb",cursor:"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit"}}>
                              ↺ Restaurar
                            </button>
                          ) : (
                            <div style={{marginLeft:"auto",display:"flex",gap:4}}>
                              <button onClick={()=>snoozeNextAction(action.fingerprint)}
                                title="Adiar — some do feed até ser revisto em 'Ver descartados'"
                                style={{padding:"3px 7px",borderRadius:6,border:"1px solid #e2e8f0",background:"#fff",color:"#94a3b8",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>
                                ⏰
                              </button>
                              <button onClick={()=>dismissNextAction(action.fingerprint)}
                                title="Descartar — some do feed até ser revisto em 'Ver descartados'"
                                style={{padding:"3px 7px",borderRadius:6,border:"1px solid #e2e8f0",background:"#fff",color:"#94a3b8",cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>
                                🗑
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}


        {/* Visualização (Espessura Dinâmica + indicadores de aresta) MIGROU para o ⚙ Hub
            de Configurações → seção 🎨 Visualização (UX 2.0 — Sessão 3). */}

        {/* Empty state (só na aba Ativos) */}
        {rightPanelMode === 'assets' && Object.keys(csvStore).length === 0 && (
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

      {/* ═══════════════ 🔎 BUSCA DE COMANDOS — Ctrl+K (UX 2.0 — Sessão 7) ═══════════════ */}
      {/* Popover efêmero (nunca persistido); funciona em qualquer aba do app (Canvas ou
          Dashboard) — não só quando o Ribbon está montado. */}
      {cmdPalette && (
        <CommandPalette
          query={cmdPalette.query}
          activeIndex={cmdPalette.activeIndex}
          results={cmdPaletteResults}
          onQueryChange={(q) => setCmdPalette(p => ({ ...p, query: q, activeIndex: 0 }))}
          onActiveIndex={(i) => setCmdPalette(p => ({ ...p, activeIndex: i }))}
          onRun={runCmdPaletteCommand}
          onClose={closeCmdPalette}
        />
      )}

      {/* ═══════════════ ⚙ HUB DE CONFIGURAÇÕES (UX 2.0 — Sessão 3) ═══════════════ */}
      {/* Modal com navegação lateral (mesmo padrão visual dos modais existentes). Endereço
          único de toda preferência do app. Efêmero (`settingsModal`) — as preferências que
          ele edita já são/continuam persistidas onde estavam (sem bump de schema). */}
      {settingsModal&&(()=>{
        const section = settingsModal.section;
        const SECTIONS = [
          { id:'motor-python', label:'Motor Python', icon:'🐍' },
          { id:'visualizacao', label:'Visualização', icon:'🎨' },
          { id:'interface',    label:'Interface',    icon:'🗔' },
          { id:'sobre',        label:'Sobre',        icon:'ℹ️' },
        ];
        const go = (id) => setSettingsModal({ section: id });
        const secTitle = SECTIONS.find(s=>s.id===section) || SECTIONS[0];
        const SHORTCUTS = [
          { keys:'Ctrl+Z',           desc:'Desfazer' },
          { keys:'Ctrl+Y',           desc:'Refazer' },
          { keys:'Del / Backspace',  desc:'Deletar seleção' },
          { keys:'Esc',              desc:'Cancelar conexão / limpar seleção' },
          { keys:'Ctrl+,',           desc:'Abrir Configurações' },
          { keys:'Ctrl+K',           desc:'Busca de comandos' },
          { keys:'Ctrl/Cmd+clique',  desc:'Alternar shape na multi-seleção' },
          { keys:'Duplo-clique (aba do Ribbon)', desc:'Alternar colapso do Ribbon (fixo/compacto/automático)' },
        ];
        return (
          <div onMouseDown={()=>setSettingsModal(null)}
            style={{position:"fixed",inset:0,zIndex:4200,background:"rgba(15,23,42,.45)",
              display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',system-ui,sans-serif"}}>
            <div onMouseDown={e=>e.stopPropagation()}
              style={{width:760,maxWidth:"94vw",height:"84vh",maxHeight:640,display:"flex",flexDirection:"column",
                background:"#fff",borderRadius:14,boxShadow:"0 20px 60px rgba(0,0,0,.25)",overflow:"hidden"}}>
              {/* Header */}
              <div style={{padding:"16px 20px",borderBottom:"1px solid #e2e8f0",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:15,fontWeight:700,color:"#1e293b"}}>⚙ Configurações</div>
                  <div style={{fontSize:11.5,color:"#94a3b8",marginTop:2}}>Preferências do app — o endereço único de toda configuração</div>
                </div>
                <button onClick={()=>setSettingsModal(null)} title="Fechar"
                  style={{width:28,height:28,borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",color:"#94a3b8",cursor:"pointer",fontSize:15,fontWeight:700,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
              </div>
              {/* Body: navegação lateral + conteúdo da seção */}
              <div style={{display:"flex",flex:1,minHeight:0}}>
                {/* Sidebar */}
                <div style={{width:196,flexShrink:0,borderRight:"1px solid #f1f5f9",padding:"12px 10px",display:"flex",flexDirection:"column",gap:3,background:"#fafbfc"}}>
                  {SECTIONS.map(s=>{
                    const on = s.id===section;
                    return (
                      <button key={s.id} onClick={()=>go(s.id)}
                        style={{display:"flex",alignItems:"center",gap:9,padding:"9px 11px",borderRadius:9,border:"none",
                          background:on?"#eff6ff":"transparent",color:on?"#2563eb":"#475569",fontWeight:on?700:500,
                          fontSize:12.5,cursor:"pointer",fontFamily:"inherit",textAlign:"left",transition:"all .12s"}}
                        onMouseEnter={e=>{if(!on)e.currentTarget.style.background="#f1f5f9";}}
                        onMouseLeave={e=>{if(!on)e.currentTarget.style.background="transparent";}}>
                        <span style={{fontSize:15,lineHeight:1}}>{s.icon}</span>
                        <span>{s.label}</span>
                      </button>
                    );
                  })}
                </div>
                {/* Conteúdo */}
                <div style={{flex:1,overflowY:"auto",padding:"18px 22px",minWidth:0}}>
                  <div style={{fontSize:13.5,fontWeight:700,color:"#1e293b",display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                    <span style={{fontSize:16}}>{secTitle.icon}</span>{secTitle.label}
                  </div>

                  {/* ── 🐍 Motor Python (migração integral da seção do painel) ── */}
                  {section==='motor-python' && (
                    <div style={{display:"flex",flexDirection:"column",gap:12,maxWidth:520}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <ComputeEngineBadge enabled={computeSidecar.enabled} status={computeSidecarStatus}
                          checking={computeSidecarChecking} onRecheck={detectSidecar}/>
                      </div>
                      <p style={{fontSize:11.5,color:"#64748b",lineHeight:1.55,margin:0}}>
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
                        style={{alignSelf:"flex-start",padding:"8px 12px",borderRadius:8,border:"1px solid #e2e8f0",
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

                  {/* ── 🎨 Visualização (Espessura Dinâmica + 3 indicadores de aresta) ── */}
                  {section==='visualizacao' && (
                    <div style={{display:"flex",flexDirection:"column",gap:6,maxWidth:460}}>
                      <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12.5,color:"#475569",fontWeight:500}}>
                        <input type="checkbox" checked={enableDynThickness} onChange={()=>setEnableDynThickness(v=>!v)}
                          style={{width:15,height:15,accentColor:"#6366f1"}}/>
                        Espessura Dinâmica
                      </label>
                      <div style={{fontSize:10.5,color:"#94a3b8",marginTop:1,marginLeft:23}}>Arestas mais espessas = maior volume</div>
                      <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:6}}>
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
                  )}

                  {/* ── 🗔 Interface (colapso do Ribbon + colapso do painel direito) ── */}
                  {section==='interface' && (
                    <div style={{display:"flex",flexDirection:"column",gap:14,maxWidth:480}}>
                      {/* Colapso do Ribbon em 3 estados (UX 2.0 — Sessão 4) */}
                      <div style={{display:"flex",flexDirection:"column",gap:7}}>
                        <p style={{fontSize:10.5,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.5,margin:0}}>Colapso do Ribbon</p>
                        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                          {[
                            {id:'fixed',   icon:'▭', label:'Fixo',       desc:'Sempre visível — empurra o canvas'},
                            {id:'compact', icon:'▬', label:'Compacto',   desc:'Só as abas fixas; grupos abrem ao passar o mouse'},
                            {id:'auto',    icon:'▔', label:'Automático',  desc:'Oculto; revela ao encostar o mouse no topo'},
                          ].map(o=>{
                            const on = ribbonMode===o.id;
                            return (
                              <button key={o.id} onClick={()=>setRibbonMode(o.id)}
                                style={{flex:"1 1 130px",minWidth:130,textAlign:"left",padding:"10px 12px",borderRadius:10,cursor:"pointer",fontFamily:"inherit",
                                  border:on?"1.5px solid #2563eb":"1.5px solid #e2e8f0",background:on?"#eff6ff":"#fff",transition:"all .12s"}}>
                                <div style={{display:"flex",alignItems:"center",gap:7,fontSize:12.5,fontWeight:700,color:on?"#2563eb":"#334155"}}>
                                  <span style={{fontSize:14,lineHeight:1}}>{o.icon}</span>{o.label}
                                </div>
                                <div style={{fontSize:10,color:"#94a3b8",marginTop:4,lineHeight:1.45}}>{o.desc}</div>
                              </button>
                            );
                          })}
                        </div>
                        <div style={{fontSize:10.5,color:"#94a3b8",lineHeight:1.5}}>
                          Também alternável pelo botão de ciclo na faixa de abas do Ribbon ou por duplo-clique
                          na aba ativa. A QAT (desfazer/refazer/deletar/salvar) e o ⚙ ficam sempre acessíveis.
                        </div>
                      </div>
                      {/* Painel direito */}
                      <div style={{display:"flex",flexDirection:"column",gap:6}}>
                        <p style={{fontSize:10.5,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.5,margin:0}}>Painel direito</p>
                        <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12.5,color:"#475569",fontWeight:500}}>
                          <input type="checkbox" checked={panelCollapsed} onChange={()=>setPanelCollapsed(v=>!v)}
                            style={{width:15,height:15,accentColor:"#3b82f6"}}/>
                          Ocultar painel direito
                        </label>
                        <div style={{fontSize:10.5,color:"#94a3b8",marginLeft:23,lineHeight:1.5}}>
                          Recolhe o painel lateral para ganhar espaço de canvas.
                        </div>
                      </div>
                      {/* Indicadores da Status Bar (UX 2.0 — Sessão 5) — mesmo estado
                          statusBarIndicators da engrenagem/clique-direito na própria barra. */}
                      <div style={{display:"flex",flexDirection:"column",gap:6}}>
                        <p style={{fontSize:10.5,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.5,margin:0}}>Indicadores da Status Bar</p>
                        {STATUS_BAR_INDICATORS_META.map(m=>(
                          <label key={m.id} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12.5,color:"#475569",fontWeight:500}}>
                            <input type="checkbox" checked={statusBarIndicators.includes(m.id)} onChange={()=>toggleStatusBarIndicator(m.id)}
                              style={{width:15,height:15,accentColor:"#3b82f6"}}/>
                            {m.label}
                          </label>
                        ))}
                        <div style={{fontSize:10.5,color:"#94a3b8",lineHeight:1.5}}>
                          Faixa fina acima das abas de canvas — Taxa de Aprovação/Inad. espelham a
                          simulação atual; também alternável pela engrenagem ou clique-direito na
                          própria barra.
                        </div>
                      </div>
                      {/* Copiloto — Feed de Próxima Melhor Ação (Jornada NB, Sessão NB3).
                          Opt-in autoScanIdle: rebusca as fontes caras em ociosidade. Persiste
                          em nextActionsPrefs (mesmo contêiner do descarte/adiamento). */}
                      <div style={{display:"flex",flexDirection:"column",gap:6}}>
                        <p style={{fontSize:10.5,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.5,margin:0}}>Copiloto — Buscar oportunidades</p>
                        <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12.5,color:"#475569",fontWeight:500}}>
                          <input type="checkbox" checked={nextActionsPrefs.autoScanIdle}
                            onChange={()=>setNextActionsPrefs(p=>({...p,autoScanIdle:!p.autoScanIdle}))}
                            style={{width:15,height:15,accentColor:"#7c3aed"}}/>
                          Buscar oportunidades automaticamente em ociosidade
                        </label>
                        <div style={{fontSize:10.5,color:"#94a3b8",marginLeft:23,lineHeight:1.5}}>
                          Reroda a Descoberta de Segmentos e a Simplificação em idle quando a política
                          muda — nunca durante a edição. Os cards continuam marcados “desatualizado”
                          quando a política muda de novo; recalcular é sempre uma ação sua. Desligado
                          por padrão: a busca só acontece pelo botão <b>🔎 Buscar oportunidades</b> do feed.
                        </div>
                      </div>
                      {/* Jornada — Checklist de Prontidão (Épico EP, Sessão EP2, DEC-EP-003) —
                          ativa/desativa critérios do checklist. Persiste em journeyState
                          (schema 3.5); critério desativado vira 'na' e sai da conta de E6. */}
                      <div style={{display:"flex",flexDirection:"column",gap:6}}>
                        <p style={{fontSize:10.5,color:"#94a3b8",fontWeight:600,textTransform:"uppercase",letterSpacing:.5,margin:0}}>Jornada — Checklist de Prontidão</p>
                        {READINESS_CRITERIA_IDS.map(critId => {
                          const meta = READINESS_CRITERIA_META[critId] || { label: critId, desc: '' };
                          const enabled = journeyState.readinessConfig[critId] !== false;
                          return (
                            <label key={critId} style={{display:"flex",alignItems:"flex-start",gap:8,cursor:"pointer",fontSize:12.5,color:"#475569",fontWeight:500}}>
                              <input type="checkbox" checked={enabled}
                                onChange={()=>setReadinessCriterionEnabled(critId, !enabled)}
                                style={{width:15,height:15,accentColor:"#16a34a",marginTop:2}}/>
                              <span>{meta.label}<span style={{display:"block",fontSize:10.5,color:"#94a3b8",fontWeight:400,marginTop:1}}>{meta.desc}</span></span>
                            </label>
                          );
                        })}
                        <div style={{fontSize:10.5,color:"#94a3b8",lineHeight:1.5}}>
                          Critério desativado sai da conta do Checklist de Prontidão (card fixo/modal da
                          aba 🧭 Copiloto) e da etapa 6 · Validação e entrega do trilho.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── ℹ️ Sobre (Build + schema + atalhos) ── */}
                  {section==='sobre' && (
                    <div style={{display:"flex",flexDirection:"column",gap:16,maxWidth:480}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                        <BuildBadge />
                        <span style={{fontSize:11.5,color:"#64748b"}}>Versão do schema de Projeto: <b style={{color:"#334155"}}>{PROJECT_SCHEMA_VERSION}</b></span>
                      </div>
                      <div>
                        <p style={{fontSize:10.5,color:"#94a3b8",fontWeight:500,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Atalhos de teclado</p>
                        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                          <tbody>
                            {SHORTCUTS.map(sc=>(
                              <tr key={sc.keys} style={{borderBottom:"1px solid #f1f5f9"}}>
                                <td style={{padding:"7px 8px",width:150}}>
                                  <code style={{background:"#f1f5f9",border:"1px solid #e2e8f0",borderRadius:6,padding:"2px 7px",fontSize:11,color:"#334155",whiteSpace:"nowrap"}}>{sc.keys}</code>
                                </td>
                                <td style={{padding:"7px 8px",color:"#475569"}}>{sc.desc}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {/* Dicas do canvas — em telas estreitas o card flutuante do canto do
                          canvas fica oculto (ocuparia espaço do canvas); o mesmo conteúdo
                          (CANVAS_TIPS) aparece aqui (UX 2.0 — Sessão 8). */}
                      {isNarrowScreen && (
                        <div>
                          <p style={{fontSize:10.5,color:"#94a3b8",fontWeight:500,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Dicas do canvas</p>
                          <ul style={{margin:0,paddingLeft:18,fontSize:12,color:"#475569",lineHeight:1.9}}>
                            {canvasTips.map((t, i) => <li key={i}>{t}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══════════════ AXIS SELECTION MODAL (Cineminha) ═══════════ */}
      {/* ═══════════════ DECISION LENS MODAL ═══════════════ */}
      {domainModal&&(()=>{
        // ═══ REGIÃO: Modais de Configuração de Nó ═══
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
        // ═══ REGIÃO: Wizard de Importação ═══
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
                                onOpenPrefs={()=>openSettings('motor-python')}
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
                    {filterCols.length > 0 && (()=>{
                      const ignoredCount = filterCols.filter(h => (wizard.columnTypes||{})[h] === 'ignore').length;
                      return (
                      <div>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14}}>
                          <span style={{fontSize:10.5,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.7}}>Variáveis de Filtro</span>
                          <div style={{flex:1,height:1,background:"#f1f5f9"}}/>
                          <span style={{fontSize:10,color:"#94a3b8"}}>{filterCols.length} coluna(s){ignoredCount>0?` · ${ignoredCount} ignorada(s)`:''} — disponíveis no canvas</span>
                        </div>
                        <div style={{border:"1px solid #e2e8f0",borderRadius:9,overflow:"hidden"}}>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 120px",padding:"7px 14px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0"}}>
                            <span style={{fontSize:10.5,fontWeight:700,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.5}}>Coluna</span>
                            <span style={{fontSize:10.5,fontWeight:700,color:"#7c3aed",textTransform:"uppercase",letterSpacing:.5,textAlign:"center"}}>Tipo de Variável</span>
                          </div>
                          <div style={{maxHeight:220,overflowY:"auto"}}>
                            {filterCols.map((colName,i)=>{
                              const colType = (wizard.columnTypes||{})[colName];
                              const isIgnored = colType === 'ignore';
                              const isTemporal = colType === 'temporal';
                              const varType = isIgnored ? 'ignore' : isTemporal ? 'temporal' : ((wizard.varTypes||{})[colName] || "categorical");
                              // categorical → ordinal → temporal → ignore → categorical.
                              // 'ignore' é um columnType (como 'temporal'), não um varType: sobrescreve
                              // o default 'decision' do buildFinalTypes — a coluna nunca mais entra em
                              // ranking/cluster/segmentação/canvas em NENHUM lugar do app, porque todos
                              // esses caminhos já filtram por `columnTypes[col] === 'decision'`.
                              const cycle = { categorical:'ordinal', ordinal:'temporal', temporal:'ignore', ignore:'categorical' };
                              const cycleType = () => setWizard(w=>{
                                const next = cycle[varType];
                                const newCols = {...(w.columnTypes||{})};
                                const newVars = {...(w.varTypes||{})};
                                if (next === 'temporal' || next === 'ignore') { newCols[colName] = next; }
                                else { delete newCols[colName]; newVars[colName] = next; }
                                return {...w, columnTypes:newCols, varTypes:newVars};
                              });
                              const st = varType==='ignore'
                                ? {border:'#cbd5e1',bg:'#f1f5f9',color:'#94a3b8',label:'🚫 Ignorar'}
                                : varType==='temporal'
                                ? {border:'#0891b2',bg:'#ecfeff',color:'#0e7490',label:'⏱ Temporal'}
                                : varType==='ordinal'
                                ? {border:'#7c3aed',bg:'#f5f3ff',color:'#7c3aed',label:'📶 Ordinal'}
                                : {border:'#e2e8f0',bg:'#f8fafc',color:'#64748b',label:'🏷️ Categ.'};
                              return (
                                <div key={colName} style={{display:"grid",gridTemplateColumns:"1fr 120px",alignItems:"center",padding:"8px 14px",borderBottom:i<filterCols.length-1?"1px solid #f1f5f9":"none",background:i%2===0?"#fff":"#fafafa",opacity:isIgnored?0.6:1}}>
                                  <span style={{fontSize:12.5,fontWeight:500,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingRight:8,textDecoration:isIgnored?"line-through":"none"}} title={colName}>{colName}</span>
                                  <div style={{display:"flex",justifyContent:"center"}}>
                                    <button
                                      onClick={cycleType}
                                      title="Clique para alternar o tipo — Ignorar remove esta coluna de todos os processos de inteligência (ranking, clusterização, segmentação, canvas)"
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
                          <strong style={{color:"#7c3aed"}}>Ordinal</strong> = hierarquia natural de risco (ex: score, faixa) · <strong>Categórica</strong> = sem ordem definida · <strong style={{color:"#0e7490"}}>⏱ Temporal</strong> = data/tempo (eixo cronológico na Análise) · <strong style={{color:"#94a3b8"}}>🚫 Ignorar</strong> = nunca usada em ranking, canvas, clusterização, segmentação ou recomendações (ex.: ID de proposta, variável apurada só depois da decisão de crédito)
                        </p>
                      </div>
                      );
                    })()}
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
        // ═══ REGIÃO: Cineminha — Otimizadores (single + Johnny) ═══
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
        // ═══ REGIÃO: Bibliotecas — Cineminha ═══
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
        // ═══ REGIÃO: Modais do Copiloto (Goal Seek, Simplificação, Documentação, Segmentos, Clusterização) ═══
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
                        <InfoDot text="Medido sobre a população que a política decide (chega a um terminal), não sobre a base inteira — por isso pode diferir do painel de simulação." />
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
                        onOpenPrefs={()=>openSettings('motor-python')}
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
      {/* ═══ Modal do Checklist de Prontidão (Jornada EP, Sessão EP2, DEC-EP-003/004) ═══ */}
      {readinessModalOpen && journeyReadiness && (() => {
        const passCount = journeyReadiness.criteria.filter(c => c.state === 'pass').length;
        const activeCount = journeyReadiness.criteria.filter(c => c.state !== 'na').length;
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",backdropFilter:"blur(4px)",
            zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
            onClick={()=>setReadinessModalOpen(false)}>
            <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:560,maxHeight:"88vh",
              boxShadow:"0 32px 100px rgba(0,0,0,.28)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"14px 24px",borderBottom:"1px solid #e2e8f0",flexShrink:0,
                background:"linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%)"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:38,height:38,borderRadius:10,background:"#bbf7d0",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>✅</div>
                  <div>
                    <h2 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:1}}>Checklist de Prontidão</h2>
                    <p style={{fontSize:11,color:"#15803d"}}>{passCount}/{activeCount} critérios ativos passam — "pronta para o comitê?"</p>
                  </div>
                </div>
                <button onClick={()=>setReadinessModalOpen(false)}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                    cursor:"pointer",fontSize:15,color:"#64748b",display:"flex",alignItems:"center",
                    justifyContent:"center",fontFamily:"inherit"}}>✕</button>
              </div>
              <div style={{padding:"14px 24px",overflowY:"auto",flex:1,display:"flex",flexDirection:"column",gap:8}}>
                {READINESS_CRITERIA_IDS.map(critId => {
                  const c = journeyReadiness.criteria.find(x => x.id === critId);
                  if (!c) return null;
                  const meta = READINESS_CRITERIA_META[critId] || { label: critId, desc: '' };
                  const tone = c.state === 'pass' ? { icon:'✅', color:'#15803d', bg:'#f0fdf4', border:'#bbf7d0' }
                    : c.state === 'fail' ? { icon:'❌', color:'#b91c1c', bg:'#fef2f2', border:'#fecaca' }
                    : { icon:'—', color:'#94a3b8', bg:'#f8fafc', border:'#e2e8f0' };
                  return (
                    <div key={critId} style={{padding:"9px 10px",borderRadius:8,background:tone.bg,border:`1px solid ${tone.border}`}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span>{tone.icon}</span>
                        <span style={{flex:1,fontSize:12,fontWeight:700,color:tone.color}}>{meta.label}</span>
                        {c.state === 'na' && <span style={{fontSize:10,color:"#94a3b8"}}>desativado</span>}
                      </div>
                      <div style={{fontSize:10.5,color:"#64748b",marginTop:3,lineHeight:1.45,marginLeft:22}}>{meta.desc}</div>
                      {c.state === 'fail' && c.fixCommandId && (
                        <div style={{marginLeft:22,marginTop:6}}>
                          <button onClick={()=>{ runNextActionCTA({ commandId: c.fixCommandId, args: {} }); setReadinessModalOpen(false); }}
                            style={{padding:"3px 10px",borderRadius:6,border:"1px solid #fecaca",background:"#fff",color:"#b91c1c",cursor:"pointer",fontSize:10.5,fontWeight:600,fontFamily:"inherit"}}>
                            Resolver
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                <div style={{fontSize:10.5,color:"#94a3b8",lineHeight:1.5,marginTop:4}}>
                  Critérios podem ser ativados/desativados no ⚙ Hub de Configurações → 🗔 Interface →
                  "Jornada — Checklist de Prontidão".
                </div>
              </div>
            </div>
          </div>
        );
      })()}

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
                      onOpenPrefs={()=>openSettings('motor-python')}
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
        const { step, csvId, dims, k, autoK, method, model, focusedId, deepRun, fallbackNotice, scope, contWarnCol } = clusterModal;
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
        // DEC-FR-008: a Clusterização NUNCA binariza contínua silenciosamente — marcar
        // uma dimensão contínua não a adiciona; exibe o aviso + "📐 Gerar faixas" abaixo.
        const toggleDim = (col) => {
          if (!dims.includes(col) && isContinuousColumnUI(csv, col)) { upd({ contWarnCol: col }); return; }
          upd({ dims: dims.includes(col) ? dims.filter(d => d !== col) : [...dims, col], contWarnCol: null });
        };
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
                    {/* DEC-FR-002 — pílula de escopo, presente em TODOS os passos (form/
                        loading/result/save/saved) por viver no header comum aos passos. */}
                    <span style={{display:"inline-flex",alignItems:"center",gap:4,marginTop:4,
                      padding:"2px 9px",borderRadius:20,
                      background:scope?"#ede9fe":"#f1f5f9",border:`1px solid ${scope?"#c4b5fd":"#e2e8f0"}`,
                      color:scope?"#6d28d9":"#64748b",fontSize:10.5,fontWeight:600,whiteSpace:"nowrap"}}>
                      🧩 População: {scope ? `chegando em "${scope.label}"` : "base inteira"}
                    </span>
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
                        <select value={csvId} onChange={e=>upd({csvId:e.target.value,dims:[],contWarnCol:null})}
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
                      {contWarnCol && (
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",
                          marginTop:8,padding:"9px 12px",borderRadius:9,background:"#fffbeb",border:"1px solid #fde68a"}}>
                          <div style={{fontSize:11.5,color:"#92400e",lineHeight:1.5,flex:1,minWidth:180}}>
                            <b>{contWarnCol}</b> é coluna contínua — o cluster agrupa por valor exato. Crie faixas
                            primeiro para usá-la como dimensão.
                          </div>
                          <button onClick={()=>openRangeModal({csvId, col: contWarnCol, scope, returnTo: clusterModal})}
                            style={{padding:"7px 12px",borderRadius:8,border:"none",background:"#0f766e",color:"#fff",
                              cursor:"pointer",fontSize:11.5,fontWeight:700,fontFamily:"inherit",flexShrink:0,whiteSpace:"nowrap"}}>
                            📐 Gerar faixas desta coluna
                          </button>
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
                      onOpenPrefs={()=>openSettings('motor-python')}
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
                      {scope && (
                        <div style={{fontSize:11,color:"#6d28d9",lineHeight:1.5,padding:"7px 10px",borderRadius:8,background:"#f5f3ff",border:"1px solid #ddd6fe"}}>
                          🧩 Os grupos foram aprendidos na população do nó "{scope.label}"; a variável classifica a
                          base inteira por essas regras.
                        </div>
                      )}
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

      {/* ═══════════════ RANGE MODAL — Criar Faixas por Risco (Épico FR) ═══════════════ */}
      {rangeModal&&(()=>{
        const { step, csvId, col, metric, k, autoK, monotonic, minShare, model, scope, compareMonotonicIv } = rangeModal;
        const upd = (patch) => setRangeModal(m => ({ ...m, ...patch }));
        const csv = csvId ? csvStore[csvId] : null;
        const availableCols = continuousColumnsOf(csv);
        const maxRate = model && !model.error ? Math.max(...model.bands.map(b => b.rate || 0), model.unmatched?.rate || 0, 1e-9) : 1;
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",backdropFilter:"blur(4px)",
            zIndex:3000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth: step==='result' ? 780 : 520,maxHeight:"92vh",
              boxShadow:"0 32px 100px rgba(0,0,0,.28)",display:"flex",flexDirection:"column",overflow:"hidden"}}>

              {/* Header */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                padding:"14px 24px",borderBottom:"1px solid #e2e8f0",flexShrink:0,
                background:"linear-gradient(135deg,#f0fdfa 0%,#ccfbf1 100%)"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:38,height:38,borderRadius:10,background:"#99f6e4",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>📐</div>
                  <div>
                    <h2 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:1}}>Criar Faixas por Risco</h2>
                    <p style={{fontSize:11,color:"#0f766e"}}>
                      Cortes que maximizam a discriminação de inadimplência (binning supervisionado por IV)
                    </p>
                    <span style={{display:"inline-flex",alignItems:"center",gap:4,marginTop:4,
                      padding:"2px 9px",borderRadius:20,
                      background:scope?"#ccfbf1":"#f1f5f9",border:`1px solid ${scope?"#5eead4":"#e2e8f0"}`,
                      color:scope?"#0f766e":"#64748b",fontSize:10.5,fontWeight:600,whiteSpace:"nowrap"}}>
                      📐 População: {scope ? `chegando em "${scope.label}"` : "base inteira"}
                    </span>
                  </div>
                </div>
                <button onClick={()=>setRangeModal(null)}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                    cursor:"pointer",fontSize:15,color:"#64748b",display:"flex",alignItems:"center",
                    justifyContent:"center",fontFamily:"inherit"}}>✕</button>
              </div>

              <div style={{padding:"18px 24px",overflowY:"auto",flex:1}}>
                {step==='form' && (!csvId ? (
                  <div style={{padding:"24px 0",textAlign:"center",color:"#94a3b8",fontSize:12.5,lineHeight:1.6}}>
                    Nenhuma base carregada — importe um CSV para criar faixas por risco.
                  </div>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    <p style={{fontSize:12,color:"#64748b",lineHeight:1.6}}>
                      Escolha uma coluna contínua (≥30 valores distintos, ≥90% do volume numérico) — o motor
                      testa cortes e escolhe os que melhor separam a inadimplência (IV/WoE), monotônicos por
                      padrão. Sempre no navegador, sem teto de linhas (Classe A).
                    </p>
                    {Object.keys(csvStore).length>1 && (
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Base de dados
                        <select value={csvId} onChange={e=>upd({csvId:e.target.value,col:null})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit"}}>
                          {Object.entries(csvStore).map(([id,c])=>(<option key={id} value={id}>{c.name||id}</option>))}
                        </select>
                      </label>
                    )}
                    <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                      Coluna contínua
                      {availableCols.length===0 ? (
                        <div style={{fontSize:11.5,color:"#94a3b8",marginTop:4}}>
                          Nenhuma coluna Filtro desta base tem ≥30 valores distintos com ≥90% do volume numérico.
                        </div>
                      ) : (
                        <select value={col||''} onChange={e=>upd({col:e.target.value||null})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit"}}>
                          <option value="">— selecione —</option>
                          {availableCols.map(h=>(<option key={h} value={h}>{h}</option>))}
                        </select>
                      )}
                    </label>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Métrica-alvo
                        <select value={metric} onChange={e=>upd({metric:e.target.value})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit"}}>
                          <option value="inadReal">Inad. Real</option>
                          <option value="inadInferida">Inad. Inferida</option>
                        </select>
                      </label>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Nº de faixas (k)
                        <select value={autoK?'auto':k} onChange={e=>e.target.value==='auto'?upd({autoK:true}):upd({autoK:false,k:Number(e.target.value)})}
                          style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit"}}>
                          {[2,3,4,5,6,7].map(v=>(<option key={v} value={v}>{v}</option>))}
                          <option value="auto">Automático (ganho marginal de IV)</option>
                        </select>
                      </label>
                    </div>
                    <label style={{display:"flex",alignItems:"center",gap:8,fontSize:11.5,color:"#475569",fontWeight:600,cursor:"pointer"}}>
                      <input type="checkbox" checked={monotonic} onChange={e=>upd({monotonic:e.target.checked})}/>
                      Faixas monotônicas
                      <span style={{fontWeight:400,color:"#94a3b8"}} title="Padrão de scorecard/governança: taxas sempre crescentes ou sempre decrescentes ao longo das faixas — defensável em comitê de crédito. Desligar libera padrões em 'U' genuínos, mas o resultado é declarado não monotônico.">
                        (padrão de comitê de crédito — desligue para permitir padrões em U)
                      </span>
                    </label>
                    <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                      Piso de volume por faixa <span style={{fontWeight:400,color:"#94a3b8"}}>(opcional — default 5%)</span>
                      <input type="number" min={0} max={0.4} step={0.01} value={minShare??''}
                        onChange={e=>upd({minShare:e.target.value===''?null:Number(e.target.value)})}
                        placeholder="0.05"
                        style={{width:"100%",marginTop:4,padding:"7px 8px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit",boxSizing:"border-box"}}/>
                    </label>
                    <button onClick={runRiskBands} disabled={!col}
                      style={{marginTop:6,padding:"11px 16px",borderRadius:10,border:"none",
                        background:!col?"#e2e8f0":"#0f766e",color:!col?"#94a3b8":"#fff",
                        cursor:!col?"not-allowed":"pointer",fontSize:13,fontWeight:700,fontFamily:"inherit"}}>
                      📐 Gerar faixas
                    </button>
                  </div>
                ))}

                {step==='loading' && (
                  <div style={{padding:"40px 0",textAlign:"center",color:"#0f766e",fontSize:13}}>
                    Calculando os cortes que maximizam a discriminação de inadimplência…
                  </div>
                )}

                {step==='result' && model && (model.error ? (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    <div style={{padding:"14px 16px",borderRadius:10,background:"#fffbeb",border:"1px solid #fde68a",
                      fontSize:12.5,color:"#92400e",lineHeight:1.6}}>
                      {model.error==='no_rows' && 'A base selecionada (ou a população do escopo) não tem linhas.'}
                      {model.error==='not_numeric' && 'Menos de 90% do volume desta coluna é numérico-parseável — não dá para cortar por risco.'}
                      {model.error==='no_contrast' && 'A base não tem contraste de inadimplência (só bons ou só maus) — o IV não se aplica.'}
                      {model.error==='infeasible' && 'O piso de volume por faixa (ou a monotonia exigida) não deixa solução com este k — reduza k ou o piso.'}
                    </div>
                    <button onClick={()=>setRangeModal(m=>({...m,step:'form'}))}
                      style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",
                        color:"#475569",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit",alignSelf:"flex-start"}}>
                      ← Ajustar parâmetros
                    </button>
                  </div>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                      <div style={{fontSize:12,color:"#64748b"}}>
                        <b>{model.bands.length}</b> faixa{model.bands.length!==1?'s':''} de <b>{model.col}</b>
                        {model.params?.autoK && model.quality?.autoKReason && <> · {model.quality.autoKReason}</>}
                      </div>
                      <button onClick={()=>setRangeModal(m=>({...m,step:'form'}))}
                        style={{padding:"6px 12px",borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",
                          color:"#475569",cursor:"pointer",fontSize:11.5,fontWeight:600,fontFamily:"inherit"}}>
                        ← Ajustar parâmetros
                      </button>
                    </div>

                    {/* Selo de monotonia (DEC-FR-005) + IV vs ivUniform (DEC-FR-010) */}
                    <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center"}}>
                      <span style={{display:"inline-flex",alignItems:"center",gap:5,padding:"5px 11px",borderRadius:20,
                        fontSize:11.5,fontWeight:700,
                        background: model.quality.monotonic ? "#f0fdf4" : "#fffbeb",
                        border: `1px solid ${model.quality.monotonic ? "#bbf7d0" : "#fde68a"}`,
                        color: model.quality.monotonic ? "#15803d" : "#92400e"}}>
                        {model.quality.monotonic==='inc' && '📈 monotônico crescente'}
                        {model.quality.monotonic==='dec' && '📉 monotônico decrescente'}
                        {!model.quality.monotonic && '⚠ não monotônico (permitido pelo usuário)'}
                      </span>
                      <span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:11.5,color:"#0f766e",fontWeight:600}}>
                        IV: {model.quality.iv?.toFixed(3)} <span style={{color:"#94a3b8",fontWeight:400}}>(corte uniforme com o mesmo k: {model.quality.ivUniform?.toFixed(3)})</span>
                        <InfoDot text="IV (Information Value) mede o quanto essas faixas separam bons de maus pagadores — quanto maior, mais discriminante a variável. Referência de mercado: <0,02 sem poder preditivo · 0,02–0,10 fraco · 0,10–0,30 médio · 0,30–0,50 forte · >0,50 suspeito (investigue vazamento de dado). 'Corte uniforme' é o IV se as faixas tivessem o mesmo k mas cortes por quantil cego (sem otimizar) — mostra o quanto o binning supervisionado ganhou sobre um corte ingênuo." />
                      </span>
                      {!monotonic && compareMonotonicIv!=null && (
                        <span style={{fontSize:11.5,color:"#92400e",fontWeight:600}}>
                          melhor monotônico: IV {compareMonotonicIv.toFixed(3)}
                        </span>
                      )}
                    </div>

                    {/* CTA — transformar o resultado numa variável de fluxo arrastável */}
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",
                      padding:"10px 14px",borderRadius:10,background:"#f0fdfa",border:"1px solid #99f6e4"}}>
                      <div style={{fontSize:11.5,color:"#0f766e",lineHeight:1.5,flex:1,minWidth:220}}>
                        <b>Usar no fluxo?</b> Salve estas faixas como uma variável Filtro ordinal — vira um chip
                        arrastável ao canvas (e você renomeia/edita cortes depois).
                      </div>
                      <button onClick={openRangeSaveStep}
                        style={{padding:"9px 16px",borderRadius:9,border:"none",background:"#0f766e",color:"#fff",
                          cursor:"pointer",fontSize:12.5,fontWeight:700,fontFamily:"inherit",flexShrink:0}}>
                        ➕ Salvar como variável
                      </button>
                    </div>

                    {/* Tabela de faixas + mini-barras SVG inline (sem Recharts — ADR-003) */}
                    <div style={{border:"1px solid #f1f5f9",borderRadius:10,overflow:"hidden"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:11.5}}>
                        <thead>
                          <tr style={{background:"#f8fafc"}}>
                            <th style={{textAlign:"left",padding:"6px 10px",color:"#94a3b8",fontWeight:600}}>Faixa</th>
                            <th style={{textAlign:"right",padding:"6px 8px",color:"#94a3b8",fontWeight:600}}>Volume</th>
                            <th style={{textAlign:"left",padding:"6px 8px",color:"#94a3b8",fontWeight:600,width:120}}>Share</th>
                            <th style={{textAlign:"left",padding:"6px 8px",color:"#94a3b8",fontWeight:600,width:120}}>Taxa</th>
                            <th style={{textAlign:"right",padding:"6px 10px",color:"#94a3b8",fontWeight:600}}>
                              <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                                WoE
                                <InfoDot text="WoE (Weight of Evidence) compara, nesta faixa, a proporção de pagadores bons vs. maus frente à base toda. Positivo = faixa mais segura que a média (menos inadimplência); negativo = faixa mais arriscada que a média; perto de zero = parecida com a média. Quanto mais distante de zero, mais essa faixa se destaca do padrão geral — é o indicador por faixa que, somado, compõe o IV da variável inteira." />
                              </span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {model.bands.map(b=>(
                            <tr key={b.id} style={{borderTop:"1px solid #f8fafc"}}>
                              <td style={{padding:"6px 10px",color:"#334155",fontWeight:600}}>{b.label}</td>
                              <td style={{padding:"6px 8px",textAlign:"right",color:"#475569"}}>{fmtQty(b.qty)}</td>
                              <td style={{padding:"6px 8px"}}>
                                <svg width="100" height="10"><rect x={0} y={0} width={Math.max(2,100*(b.share||0))} height={10} rx={2} fill="#5eead4"/></svg>
                              </td>
                              <td style={{padding:"6px 8px"}}>
                                <div style={{display:"flex",alignItems:"center",gap:6}}>
                                  <svg width="70" height="10"><rect x={0} y={0} width={Math.max(2,70*((b.rate||0)/maxRate))} height={10} rx={2} fill="#f97316"/></svg>
                                  <span style={{color:"#475569"}}>{fmtPct(b.rate)}</span>
                                </div>
                              </td>
                              <td style={{padding:"6px 10px",textAlign:"right",color:"#94a3b8"}}>{b.woe?.toFixed(3)}</td>
                            </tr>
                          ))}
                          {model.unmatched && (
                            <tr style={{borderTop:"1px solid #f8fafc",background:"#fffbeb"}}>
                              <td style={{padding:"6px 10px",color:"#92400e",fontWeight:600}}>Sem valor</td>
                              <td style={{padding:"6px 8px",textAlign:"right",color:"#92400e"}}>{fmtQty(model.unmatched.qty)}</td>
                              <td style={{padding:"6px 8px",color:"#92400e"}}>{fmtPct(model.unmatched.share)}</td>
                              <td style={{padding:"6px 8px",color:"#92400e"}}>{fmtPct(model.unmatched.rate)}</td>
                              <td style={{padding:"6px 10px"}}></td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {/* ── Passo "Salvar como variável" ── */}
                {step==='save' && model && rangeModal.save && (()=>{
                  const save = rangeModal.save;
                  const updSave = (patch)=>setRangeModal(m=>({...m,save:{...m.save,...patch,error:null}}));
                  const setLabel = (i,val)=>updSave({labels:save.labels.map((l,j)=>j===i?val:l)});
                  return (
                    <div style={{display:"flex",flexDirection:"column",gap:14}}>
                      <div style={{fontSize:12,color:"#64748b",lineHeight:1.6}}>
                        A variável vira uma coluna Filtro ORDINAL na base <b>{csvStore[csvId]?.name||csvId}</b> com um
                        valor por faixa. Você pode renomear tudo agora e editar cortes/rótulos depois pelo ✏️ no painel.
                      </div>
                      {scope && (
                        <div style={{fontSize:11,color:"#0f766e",lineHeight:1.5,padding:"7px 10px",borderRadius:8,background:"#f0fdfa",border:"1px solid #99f6e4"}}>
                          📐 As faixas foram aprendidas na população do nó "{scope.label}"; a variável classifica a
                          base inteira por esses cortes.
                        </div>
                      )}
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Nome da variável
                        <input value={save.varName} onChange={e=>updSave({varName:e.target.value})}
                          style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"1.5px solid #99f6e4",fontSize:13,fontFamily:"inherit",boxSizing:"border-box"}}/>
                      </label>
                      <div>
                        <div style={{fontSize:11.5,color:"#475569",fontWeight:600,marginBottom:6}}>Rótulo de cada faixa</div>
                        <div style={{display:"flex",flexDirection:"column",gap:7}}>
                          {model.bands.map((b,i)=>(
                            <div key={b.id} style={{display:"flex",alignItems:"center",gap:8}}>
                              <input value={save.labels[i]??''} onChange={e=>setLabel(i,e.target.value)}
                                style={{flex:1,padding:"6px 9px",borderRadius:7,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit",boxSizing:"border-box"}}/>
                              <span style={{fontSize:10.5,color:"#94a3b8",flexShrink:0,minWidth:110,textAlign:"right"}}>
                                {fmtQty(b.qty)} · {fmtPct(b.rate)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                        Rótulo para valores não parseáveis/vazios
                        <input value={save.unmatched} onChange={e=>updSave({unmatched:e.target.value})}
                          style={{width:"100%",marginTop:4,padding:"7px 9px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit",boxSizing:"border-box"}}/>
                      </label>
                      {save.error && (
                        <div style={{fontSize:11.5,color:"#b91c1c",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"7px 10px"}}>{save.error}</div>
                      )}
                      <div style={{display:"flex",gap:8,justifyContent:"space-between"}}>
                        <button onClick={()=>setRangeModal(m=>({...m,step:'result',save:null}))}
                          style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit"}}>
                          ← Voltar
                        </button>
                        <button onClick={saveRangeVariable}
                          style={{padding:"9px 18px",borderRadius:9,border:"none",background:"#0f766e",color:"#fff",cursor:"pointer",fontSize:12.5,fontWeight:700,fontFamily:"inherit"}}>
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
                        Variável <b>{rangeModal.savedCol}</b> criada! Ela já aparece em <b>Variáveis de Decisão</b> no
                        painel — arraste ao canvas. Edite ou renomeie a qualquer momento pelo ✏️ no chip.
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                      <button onClick={()=>{const cid=rangeModal.savedCsvId,cc=rangeModal.savedCol;setRangeModal(null);openRangeVarEdit(cid,cc);}}
                        style={{padding:"9px 16px",borderRadius:9,border:"1px solid #99f6e4",background:"#f0fdfa",color:"#0f766e",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit"}}>
                        ✏️ Editar regras
                      </button>
                      <button onClick={()=>setRangeModal(null)}
                        style={{padding:"9px 18px",borderRadius:9,border:"none",background:"#0f766e",color:"#fff",cursor:"pointer",fontSize:12.5,fontWeight:700,fontFamily:"inherit"}}>
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

      {/* ═══════════════ EDITOR DE VARIÁVEL DE FAIXAS (renomear + mover cortes) ═══════════════ */}
      {rangeVarModal&&(()=>{
        const { csvId, col, draft, cutsDraft, error, confirmDelete } = rangeVarModal;
        const upd = (patch)=>setRangeVarModal(m=>({...m,...patch,error:null}));
        const setDraft = (nd)=>upd({draft:nd});
        const setLabel = (bid,val)=>setDraft(renameRangeBand(draft,bid,val));
        const csv = csvStore[csvId];
        const stats = csv ? computeBandLiveStats(csv, draft) : {};
        const dir = bandRatesMonotonicDir(draft.bands.map(b=>stats[b.label]?.rate ?? null));
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.6)",backdropFilter:"blur(4px)",
            zIndex:3100,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
            <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:640,maxHeight:"92vh",
              boxShadow:"0 32px 100px rgba(0,0,0,.28)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
              {/* Header */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 24px",
                borderBottom:"1px solid #e2e8f0",flexShrink:0,background:"linear-gradient(135deg,#f0fdfa 0%,#ccfbf1 100%)"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:38,height:38,borderRadius:10,background:"#99f6e4",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>📐</div>
                  <div>
                    <h2 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:1}}>Editar Variável de Faixas</h2>
                    <p style={{fontSize:11,color:"#0f766e"}}>Renomeie a variável, mova os cortes e edite os rótulos</p>
                  </div>
                </div>
                <button onClick={()=>setRangeVarModal(null)}
                  style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#fff",cursor:"pointer",
                    fontSize:15,color:"#64748b",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit"}}>✕</button>
              </div>

              <div style={{padding:"18px 24px",overflowY:"auto",flex:1,display:"flex",flexDirection:"column",gap:16}}>
                <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                  Nome da variável
                  <input value={draft.col} onChange={e=>setDraft({...draft,col:e.target.value})}
                    style={{width:"100%",marginTop:4,padding:"8px 10px",borderRadius:8,border:"1.5px solid #99f6e4",fontSize:13,fontFamily:"inherit",boxSizing:"border-box"}}/>
                </label>

                <span style={{display:"inline-flex",alignSelf:"flex-start",alignItems:"center",gap:5,padding:"5px 11px",borderRadius:20,
                  fontSize:11.5,fontWeight:700,
                  background: dir ? "#f0fdf4" : "#fffbeb", border: `1px solid ${dir ? "#bbf7d0" : "#fde68a"}`,
                  color: dir ? "#15803d" : "#92400e"}}>
                  {dir==='inc' && '📈 monotônico crescente'}
                  {dir==='dec' && '📉 monotônico decrescente'}
                  {!dir && '⚠ não monotônico'}
                </span>

                <div>
                  <div style={{fontSize:11.5,color:"#475569",fontWeight:600,marginBottom:6}}>Pontos de corte ({cutsDraft.length})</div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                    {cutsDraft.map((c,i)=>(
                      <input key={i} value={c} onChange={e=>upd({cutsDraft:cutsDraft.map((v,j)=>j===i?e.target.value:v)})}
                        style={{width:100,padding:"6px 9px",borderRadius:7,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit",boxSizing:"border-box"}}/>
                    ))}
                    <button onClick={applyRangeCutsEdit}
                      style={{padding:"7px 12px",borderRadius:8,border:"1px solid #99f6e4",background:"#f0fdfa",color:"#0f766e",cursor:"pointer",fontSize:11.5,fontWeight:600,fontFamily:"inherit"}}>
                      Aplicar cortes
                    </button>
                  </div>
                </div>

                <div>
                  <div style={{fontSize:11.5,color:"#475569",fontWeight:600,marginBottom:6}}>Faixas ({draft.bands.length})</div>
                  <div style={{border:"1px solid #f1f5f9",borderRadius:10,overflow:"hidden"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:11.5}}>
                      <thead>
                        <tr style={{background:"#f8fafc"}}>
                          <th style={{textAlign:"left",padding:"6px 10px",color:"#94a3b8",fontWeight:600}}>Rótulo</th>
                          <th style={{textAlign:"left",padding:"6px 8px",color:"#94a3b8",fontWeight:600}}>Intervalo</th>
                          <th style={{textAlign:"right",padding:"6px 8px",color:"#94a3b8",fontWeight:600}}>Volume</th>
                          <th style={{textAlign:"right",padding:"6px 10px",color:"#94a3b8",fontWeight:600}}>Taxa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draft.bands.map(b=>{
                          const s = stats[b.label];
                          return (
                            <tr key={b.id} style={{borderTop:"1px solid #f8fafc"}}>
                              <td style={{padding:"5px 8px"}}>
                                <input value={b.label} onChange={e=>setLabel(b.id,e.target.value)}
                                  style={{width:"100%",padding:"5px 8px",borderRadius:6,border:"1.5px solid #e2e8f0",fontSize:11.5,fontFamily:"inherit",boxSizing:"border-box"}}/>
                              </td>
                              <td style={{padding:"5px 8px",color:"#94a3b8",whiteSpace:"nowrap"}}>{formatBandLabel(b.min,b.max)}</td>
                              <td style={{padding:"5px 8px",textAlign:"right",color:"#475569"}}>{s?fmtQty(s.qty):'—'}</td>
                              <td style={{padding:"5px 10px",textAlign:"right",color:"#475569"}}>{s?fmtPct(s.rate):'—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <label style={{fontSize:11.5,color:"#475569",fontWeight:600}}>
                  Rótulo para valores não parseáveis/vazios
                  <input value={draft.unmatchedLabel} onChange={e=>setDraft({...draft,unmatchedLabel:e.target.value})}
                    style={{width:"100%",marginTop:4,padding:"7px 9px",borderRadius:8,border:"1.5px solid #e2e8f0",fontSize:12.5,fontFamily:"inherit",boxSizing:"border-box"}}/>
                </label>

                {error && (
                  <div style={{fontSize:11.5,color:"#b91c1c",background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,padding:"7px 10px"}}>{error}</div>
                )}
              </div>

              {/* Footer */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"12px 24px",borderTop:"1px solid #e2e8f0",flexShrink:0}}>
                {confirmDelete ? (
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11.5,color:"#b91c1c"}}>Excluir a variável?</span>
                    <button onClick={deleteRangeVariable}
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
                  <button onClick={()=>setRangeVarModal(null)}
                    style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:12.5,fontWeight:600,fontFamily:"inherit"}}>
                    Cancelar
                  </button>
                  <button onClick={saveRangeVarEdit}
                    style={{padding:"9px 18px",borderRadius:9,border:"none",background:"#0f766e",color:"#fff",cursor:"pointer",fontSize:12.5,fontWeight:700,fontFamily:"inherit"}}>
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
        // ═══ REGIÃO: Bibliotecas — Políticas ═══
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

        {/* Explorar tab — fixed (Épico EB, EB2/DEC-EB-001). Leftmost: "conhecer a matéria-
            prima" abre a jornada (Explorar → Canvas → Dashboard). Funciona com canvas vazio. */}
        {(()=>{
          const active=activeTab==="explore";
          return (
            <button onClick={()=>setActiveTab("explore")}
              style={{display:"flex",alignItems:"center",gap:6,padding:"7px 16px",border:"1px solid",flexShrink:0,
                borderColor:active?"#cbd5e1":"transparent",borderTop:active?"1px solid #e2e8f0":"1px solid transparent",
                background:active?"#fff":"transparent",color:active?"#1e293b":"#64748b",
                borderBottomLeftRadius:9,borderBottomRightRadius:9,cursor:"pointer",fontSize:13,
                fontWeight:active?600:500,fontFamily:"inherit",marginTop:-1,transition:"all .12s"}}>
              <span style={{fontSize:14}}>🔎</span>Explorar
            </button>
          );
        })()}

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

      {/* ═══════════════ STATUS BAR (UX 2.0 — Sessão 5) — depois da barra de abas
          de canvas (Sessão 9, ordem invertida em relação à v2 original) ═══════════════ */}
      <StatusBar
        indicators={statusBarIndicators}
        values={statusBarValues}
        onToggleIndicator={toggleStatusBarIndicator}
        computeSidecar={computeSidecar}
        computeSidecarStatus={computeSidecarStatus}
        computeSidecarChecking={computeSidecarChecking}
        onOpenSettings={() => openSettings('motor-python')}
        zoomPct={Math.round(vp.s * 100)}
        onZoomClick={() => setVp({ x: 20, y: 40, s: 1 })}
      />

      {/* H0 — painel dev de telemetria local de custo (?debug=perf) */}
      {debugPerf && <PerfDebugPanel telemetryRef={perfTelemetryRef} />}
    </div>
  );
}
