// src/exploreInsights.js — camada interpretativa determinística do Perfil da Base
// (Explorar a Base, Épico EB — docs/wiki/Epicos-ExplorarBase.md, DEC-EB-004).
//
// STUB da EB2: leitura mínima (1-2 frases) por achado (`insights[].code` do
// BaseProfileModel) e por seção do layout default — o suficiente para o widget
// `insight` nunca mostrar um `{code}` cru na tela. A versão completa (3 alturas de
// texto — Leitura + "ⓘ Como ler" pedagógico + cobertura garantida de TODOS os
// códigos/widgets, com GATE dedicado tests/exploreInsights.test.js) é da EB3 — este
// módulo é o ponto de expansão, não substituído.
//
// Módulo FOLHA (não importa App.jsx nem o worker) — mesmo padrão de src/segVar.js.
// Nunca gerado por modelo de linguagem, sempre reproduzível: mesma entrada ⇒ mesma
// prosa, byte a byte (DEC-EB-004 in fine).

const pct = (v, d = 1) => (v == null || !isFinite(v)) ? "—" : `${(v * 100).toFixed(d)}%`;
const qty = (v) => (v == null || !isFinite(v)) ? "—" : Math.round(v).toLocaleString("pt-BR");
const iv2 = (v) => (v == null || !isFinite(v)) ? "—" : v.toFixed(2);

// Template mínimo por código de achado (`insights[].code` — DEC-EB-003). Todo código
// emitido pelo worker (computeBaseProfile) tem entrada aqui — sem placeholder vazado.
const FINDING_TEMPLATES = {
  high_iv: (f) => `Variável promissora: IV ${iv2(f.iv)} (forte poder discriminante).`,
  suspect_score: (f) => `🎯 Parece um score/rating já em uso — risco de circularidade na política${f.iv != null ? ` (IV ${iv2(f.iv)})` : ""}.`,
  suspect_temporal: () => `🕐 Parece uma coluna de safra/cohort — não é característica do cliente.`,
  low_coverage: (f) => `Cobertura de ${pct((f.coveragePct ?? 0) / 100)} — vazios demais para o topo da árvore.`,
  dominant_value: (f) => `A categoria "${f.value}" concentra ${pct((f.sharePct ?? 0) / 100)} do volume — pouco poder de corte.`,
  high_cardinality: (f) => `${f.distinct} valores distintos — candidata a Agrupamento${f.continuous ? " ou Faixas por Risco" : ""}.`,
  immature_vintage: (f) => `A safra ${f.lastBucket} está com inadimplência de ${pct(f.lastRate)}, bem abaixo da média da base (${pct(f.overallRate)}) — maturação provavelmente incompleta.`,
  unstable_psi: (f) => `PSI ${f.psi != null ? f.psi.toFixed(2) : "—"} entre as janelas ${f.refWindow?.from}–${f.refWindow?.to} e ${f.curWindow?.from}–${f.curWindow?.to} — a distribuição mudou, o corte pode envelhecer.`,
  no_temporal_column: () => `Marque uma coluna como ⏱ Temporal no passo 2 do wizard de importação para habilitar a análise de estabilidade.`,
  no_asis: () => `Esta base não tem uma decisão AS IS configurada — o retrato da operação atual não pode ser calculado.`,
};

// Leitura mínima de um achado do BaseProfileModel ({code, severity, facts}). Sem
// template conhecido, degrada declaradamente — nunca `undefined`/`[object Object]`
// solto na tela.
export function describeFinding(finding) {
  if (!finding) return "";
  const tpl = FINDING_TEMPLATES[finding.code];
  if (!tpl) return `Achado "${finding.code}" (leitura ainda não disponível).`;
  try { return tpl(finding.facts || {}) || `Achado "${finding.code}" (leitura ainda não disponível).`; }
  catch { return `Achado "${finding.code}" (leitura ainda não disponível).`; }
}

// Leitura mínima por PRESET de seção do layout default (EB2, DEC-EB-006) — 1-2 frases
// interpretando o retrato/ranking/qualidade/estabilidade a partir do BaseProfileModel
// inteiro (não de um achado isolado). A versão completa por widget (com números
// destacados e "ⓘ Como ler") é da EB3.
export function describeSection(preset, profile) {
  if (!profile) return "";
  switch (preset) {
    case 'asis': {
      const a = profile.asIs;
      if (!a) return describeFinding({ code: 'no_asis', facts: {} });
      return `A operação hoje aprova ${pct(a.approvalRate)} das propostas (${qty(a.approvedQty)} de ${qty(a.totalQty)}), com inadimplência de ${pct(a.inadRealAprovados)} entre os aprovados.`;
    }
    case 'ranking': {
      const top = (profile.variables || [])[0];
      if (!top) return "Nenhuma variável de decisão encontrada nesta base.";
      return `${top.col} é a variável mais discriminante da base (IV ${iv2(top.iv)}).`;
    }
    case 'varprofile':
      return "Volume e taxa da métrica-alvo por valor das variáveis mais discriminantes — onde o risco se concentra.";
    case 'quality': {
      const n = (profile.quality || []).filter(q => q.coveragePct < 85 || (q.dominantValue && q.dominantValue.sharePct >= 80)).length;
      return n > 0 ? `${n} variável(is) com aviso de qualidade (cobertura baixa ou categoria dominante).` : "Nenhuma variável com aviso de qualidade nesta base.";
    }
    case 'stability': {
      if (!profile.temporal) return describeFinding({ code: 'no_temporal_column', facts: {} });
      return `Série por safra da coluna ${profile.temporal.col} — acompanhe volume e inadimplência ao longo do tempo.`;
    }
    case 'warnings': {
      const n = (profile.insights || []).length;
      return n > 0 ? `${n} leitura${n === 1 ? "" : "s"} automática${n === 1 ? "" : "s"} sobre esta base.` : "Nenhum aviso encontrado nesta base.";
    }
    default: return "";
  }
}
