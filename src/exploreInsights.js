// src/exploreInsights.js — camada interpretativa determinística do Perfil da Base
// (Explorar a Base, Épico EB — docs/wiki/Epicos-ExplorarBase.md, DEC-EB-004).
//
// EB3: as 3 alturas de texto completas — (1) Leitura (`describeFinding`/
// `describeSection`, herdadas da EB2 sem mudança de assinatura), (2) "ⓘ Como ler"
// pedagógico por tópico de widget (`describeHowToRead`/`howToReadTopic`), (3) Avisos
// (já renderizados pelo widget `insight` preset `warnings` via `describeFinding`).
// GATE dedicado: tests/exploreInsights.test.js (cobertura total código→template,
// nenhum placeholder vazado, determinismo, degradação declarada em fatos ausentes).
//
// Módulo FOLHA (não importa App.jsx nem o worker) — mesmo padrão de src/segVar.js.
// Nunca gerado por modelo de linguagem, sempre reproduzível: mesma entrada ⇒ mesma
// prosa, byte a byte (DEC-EB-004 in fine).

const pct = (v, d = 1) => (v == null || !isFinite(v)) ? "—" : `${(v * 100).toFixed(d)}%`;
const qty = (v) => (v == null || !isFinite(v)) ? "—" : Math.round(v).toLocaleString("pt-BR");
const iv2 = (v) => (v == null || !isFinite(v)) ? "—" : v.toFixed(2);
const str = (v) => (v == null || v === "") ? "—" : v; // texto livre (nome de coluna/safra/valor) — nunca "undefined" cru

// Template mínimo por código de achado (`insights[].code` — DEC-EB-003). Todo código
// emitido pelo worker (computeBaseProfile) tem entrada aqui — sem placeholder vazado.
// Todo campo de `facts` passa por `str`/`pct`/`qty`/`iv2` antes de entrar na frase — nunca
// interpolado cru — para que `facts` incompleto (ex.: fixture de teste, achado futuro sem
// todos os campos) nunca vaze "undefined"/"NaN" para a tela.
const FINDING_TEMPLATES = {
  high_iv: (f) => `Variável promissora: IV ${iv2(f.iv)} (forte poder discriminante).`,
  suspect_score: (f) => `🎯 Parece um score/rating já em uso — risco de circularidade na política${f.iv != null ? ` (IV ${iv2(f.iv)})` : ""}.`,
  suspect_temporal: () => `🕐 Parece uma coluna de safra/cohort — não é característica do cliente.`,
  low_coverage: (f) => `Cobertura de ${pct((f.coveragePct ?? 0) / 100)} — vazios demais para o topo da árvore.`,
  dominant_value: (f) => `A categoria "${str(f.value)}" concentra ${pct((f.sharePct ?? 0) / 100)} do volume — pouco poder de corte.`,
  high_cardinality: (f) => `${qty(f.distinct)} valores distintos — candidata a Agrupamento${f.continuous ? " ou Faixas por Risco" : ""}.`,
  immature_vintage: (f) => `A safra ${str(f.lastBucket)} está com inadimplência de ${pct(f.lastRate)}, bem abaixo da média da base (${pct(f.overallRate)}) — maturação provavelmente incompleta.`,
  unstable_psi: (f) => `PSI ${f.psi != null && isFinite(f.psi) ? f.psi.toFixed(2) : "—"} entre as janelas ${str(f.refWindow?.from)}–${str(f.refWindow?.to)} e ${str(f.curWindow?.from)}–${str(f.curWindow?.to)} — a distribuição mudou, o corte pode envelhecer.`,
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

// Leitura por PRESET de seção do layout default (EB2, DEC-EB-006) — 1-2 frases
// interpretando o retrato/ranking/qualidade/estabilidade a partir do BaseProfileModel
// inteiro (não de um achado isolado). O "ⓘ Como ler" pedagógico de cada preset vive em
// `describeHowToRead`/`HOWTOREAD_TEMPLATES`, abaixo.
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

// ── "ⓘ Como ler" — 2ª altura de texto (DEC-EB-004) ──────────────────────────────
// Texto FIXO por TÓPICO pedagógico (não por achado — o conceito por trás do
// indicador, não o resultado). Um tópico é compartilhado por mais de um widget
// quando o conceito é o mesmo (ex.: IV explica tanto o preset `ranking` do card
// `insight` quanto o corpo do `ivrank`) — ver `howToReadTopic` logo abaixo, que
// resolve {widget.type, widget.config.preset} → tópico.
const HOWTOREAD_TEMPLATES = {
  asis: `O retrato AS IS mostra como a operação decide HOJE, sem nenhuma alteração: ` +
    `Taxa de aprovação = aprovados ÷ (aprovados + rejeitados) — propostas sem decisão ` +
    `configurada (nem aprovado, nem rejeitado) ficam de fora do denominador. Inadimplência ` +
    `entre aprovados é medida só sobre quem a operação de fato aprovou — é a régua para ` +
    `comparar qualquer política nova simulada no Canvas.`,
  ranking: `IV (Information Value) mede o quanto uma variável separa bons de maus ` +
    `pagadores, olhando a distribuição de cada valor entre aprovados adimplentes e ` +
    `inadimplentes. Regra de bolso: < 0,02 inútil · 0,02–0,1 fraca · 0,1–0,3 média · ` +
    `≥ 0,3 forte. Desconfie de IV muito alto (> 0,5): pode ser vazamento — a variável ` +
    `"sabe" o resultado porque foi calculada a partir dele (ex.: um score que já embute ` +
    `a decisão de crédito).`,
  varprofile: `Cada barra é o volume de propostas com aquele valor da variável; a linha é ` +
    `a taxa da métrica-alvo (inadimplência real ou inferida) para o mesmo valor. Procure ` +
    `onde a linha sobe muito acima da média da base — é ali que o risco se concentra. ` +
    `Valores com pouco volume têm taxa mais instável (poucos casos para calcular a taxa) — ` +
    `desconfie de picos isolados num valor com barra baixa.`,
  quality: `Cobertura é o % de linhas com valor preenchido (vazios atrapalham decisões no ` +
    `topo da árvore — cortam menos gente). Não numérico é o % dos valores preenchidos que ` +
    `não convertem para número (texto solto, formatação inesperada). Categoria dominante ` +
    `mostra o valor mais frequente e seu share — quando um único valor concentra quase ` +
    `tudo, a variável separa pouco (não sobra volume nas outras categorias para cortar).`,
  stability: `PSI (Population Stability Index) mede o quanto a distribuição de uma ` +
    `variável mudou entre duas janelas de tempo (metade cronológica antiga → recente das ` +
    `safras): PSI = Σᵢ (pᵢ − qᵢ) · ln(pᵢ / qᵢ), somado sobre cada valor/faixa. Limiares: ` +
    `< 0,1 estável · 0,1–0,25 atenção · > 0,25 instável — desconfie de cortes construídos ` +
    `sobre uma variável instável, o corte tende a "envelhecer" rápido. O gráfico de safra ` +
    `mostra volume e taxas ao longo do tempo; a inadimplência das safras mais recentes ` +
    `costuma estar sub-representada (maturação incompleta), não é queda real de risco.`,
  warnings: `Cada aviso nasce de um limiar declarado no motor (ex.: cobertura < 85%, ` +
    `categoria dominante ≥ 80%, IV ≥ 0,3, PSI > 0,25) — nunca de uma opinião do modelo de ` +
    `linguagem. A cor indica a severidade: verde/bom é uma oportunidade (ex.: variável ` +
    `promissora), âmbar/atenção pede investigação antes de usar a variável no topo da ` +
    `árvore, vermelho/perigo é um risco de leitura errada da base (ex.: safra imatura).`,
};

const HOWTOREAD_FALLBACK = "Leitura pedagógica ainda não disponível para este card.";

// Texto pedagógico fixo por TÓPICO (ver `HOWTOREAD_TEMPLATES` acima). Tópico sem
// template conhecido degrada declaradamente — nunca `undefined` solto na tela.
export function describeHowToRead(topic) {
  return HOWTOREAD_TEMPLATES[topic] || HOWTOREAD_FALLBACK;
}

// Widget → tópico do "ⓘ Como ler". O card `insight` usa o próprio `preset` (mesmo
// vocabulário de `describeSection`); os demais tipos mapeiam para o tópico cujo
// conceito eles ilustram (ex.: `ivrank` reusa o tópico `ranking`, mesmo texto de IV
// do card `insight` preset `ranking` — é o mesmo indicador, só a visualização muda).
const WIDGET_HOWTOREAD_TOPIC = { ivrank: 'ranking', varprofile: 'varprofile', quality: 'quality', stability: 'stability' };

export function howToReadTopic(widget) {
  if (!widget) return null;
  if (widget.type === 'insight') return widget.config?.preset ?? null;
  return WIDGET_HOWTOREAD_TOPIC[widget.type] ?? null;
}
