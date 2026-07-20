// src/segVar.js — helpers puros de heurística de VARIÁVEL, compartilhados entre a
// thread principal (App.jsx), o Web Worker (simulation.worker.js) e os testes. Módulo
// FOLHA (não importa App.jsx nem o worker) — evita a duplicação que existia quando estas
// funções viviam só em App.jsx e o worker não conseguia enxergá-las.
//
// Conteúdo:
//   • segVarDefaultReason — heurística por tokens do NOME da coluna (temporal/score).
//     Estado INICIAL do seletor de variáveis da Descoberta de Segmentos (Copiloto Sessão
//     10) e das badges de alerta do perfil da base (Explorar a Base, DEC-EB-008). Os
//     tokens são contrato: não mudam ao ser promovida a helper compartilhado.
//   • parseTemporalKey — parse de um valor de safra/cohort para chave numérica ordenável
//     (UTC ms). Usado para ordenar cronologicamente o eixo X do Dashboard e as janelas do
//     PSI/estabilidade temporal (Explorar a Base, DEC-EB-009).

// ── Heurística do seletor de variáveis (Copiloto Sessão 10 / Explorar a Base) ─────
// Colunas de cohort/vintage (mês/safra de referência) e de score já vêm DESMARCADAS por
// padrão no `segmentDiscoveryModal` — a primeira é um artefato temporal/de coleta (não um
// driver de risco acionável, e pode vazar maturação de inadimplência entre safras), a
// segunda costuma já SER o risco (circular) ou já estar em uso em outro nó da política.
// No perfil da base, viram as badges `suspect_temporal`/`suspect_score`. Só define o
// estado INICIAL — o usuário marca/desmarca qualquer coluna.
export const SEG_TEMPORAL_NAME_TOKENS = new Set(['mes','meses','month','ano','anos','year','safra','vintage','periodo','competencia','data','date','dt']);
export const SEG_SCORE_NAME_TOKENS = new Set(['score','rating','bureau']);
export function segVarDefaultReason(colName) {
  const norm = (colName || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const tokens = norm.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.some(t => SEG_TEMPORAL_NAME_TOKENS.has(t))) return 'temporal';
  if (tokens.some(t => SEG_SCORE_NAME_TOKENS.has(t))) return 'score';
  return null;
}

// ── Parse temporal ────────────────────────────────────────────────────────────────
// Abreviações de mês de 3 letras (SAS DDMONYYYY) — inglês e português, já que
// "JUN"/"JAN" coincidem nos dois idiomas mas MAI/ABR/AGO/SET/OUT/DEZ/FEV não
// são reconhecidos pelo Date.parse do JS (só entende abreviações em inglês).
export const MONTH_ABBR = {
  jan:0, fev:1, feb:1, mar:2, abr:3, apr:3, mai:4, may:4, jun:5,
  jul:6, ago:7, aug:7, set:8, sep:8, out:9, oct:9, nov:10, dez:11, dec:11,
};

// Parse a temporal cell value into a sortable numeric key (UTC ms), or null if
// unparseable. Supports ISO (YYYY-MM-DD / YYYY-MM), BR (DD/MM/YYYY), compact
// (YYYYMMDD), SAS DDMONYYYY (ex: 10MAI2026), e um fallback via Date.parse.
// Usado para ordenar o eixo X cronologicamente e as janelas do PSI temporal.
export function parseTemporalKey(str) {
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
