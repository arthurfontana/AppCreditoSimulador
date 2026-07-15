// ── Variável de Faixas — interpretação do Criar Faixas por Risco (Épico FR) ───────
//
// Criar Faixas por Risco (COMPUTE_RISK_BANDS) é uma ANÁLISE efêmera: descobre os
// cortes que maximizam a discriminação de inadimplência (binning supervisionado por
// IV/WoE) sobre UMA coluna contínua e devolve um RangeModel. Este módulo transforma
// esse resultado numa VARIÁVEL de fluxo reutilizável — uma coluna Filtro ORDINAL
// derivada na base, cujos valores são os rótulos das faixas — para o usuário
// arrastar ao canvas e seguir com aberturas/políticas, exatamente como a Variável de
// Cluster (`src/clusterVar.js`, o espelho que este módulo segue à risca).
//
// A "regra" de cada faixa é um intervalo semiaberto [min, max) sobre a coluna de
// origem (min/max null = ±infinito) — ver deriveRangeColumn em columnar.js: busca
// binária pelas fronteiras, cellNum-consistente, sem casar (não parseável) ⇒
// unmatchedLabel. As faixas nascem do binning supervisionado (DP exata, DEC-FR-004);
// o usuário cura os cortes/rótulos depois (editRangeCuts/renameRangeBand) — mesmo
// padrão proposta→refino do app.
//
// Módulo PURO (sem React/DOM/worker): a materialização vive em columnar.js
// (deriveRangeColumn); aqui ficam a sugestão de nome, o builder de definição a
// partir do RangeModel, a formatação de rótulos (canônica — o worker usa a MESMA
// função, DEC-FR-004), a descrição das regras (docs) e as edições puras de
// cortes/rótulos. A propagação de referências (rename de coluna/rótulo no canvas)
// REUSA renameClusterColumnRefs/renameClusterLabelRefs de clusterVar.js sem
// duplicação — são genéricas por nome de coluna/rótulo (DEC-FR-009). Compartilhado
// main/worker/teste, como src/clusterVar.js / src/goalSeek.js.

// Def de uma variável de faixas (guardada em csvStore[csvId].rangeDefs[col]):
// {
//   id, col, csvId, source: 'range', sourceCol,      // coluna contínua de origem
//   metric: { id, label },
//   bands: [{ id, label, min, max }],                 // ordenadas; [min, max); null = ±∞
//   unmatchedLabel,
//   meta: { k, monotonic, iv, ivUniform, minShare, prebins, scope, generatedAt },
//   createdAt,
// }

import { uniqueName } from './clusterVar.js';

// Nome sugerido para a VARIÁVEL (coluna) — baseado na coluna de origem, único vs.
// headers existentes da base.
export function suggestRangeVarName(model, existingHeaders) {
  const col = model?.col || 'Faixas';
  return uniqueName(`Faixas de ${col}`, existingHeaders);
}

// ── Rótulo compacto pt-BR de uma faixa [min, max) (null = ±∞) — CANÔNICO ─────────
// A mesma função que o worker usa para o rótulo provisório do RangeModel
// (COMPUTE_RISK_BANDS, DEC-FR-004) — nenhuma duplicação de formatação.
function rangeNumberLabelPtBR(x) {
  const abs = Math.abs(x);
  const fmt = (v, suf) => (Math.round(v * 100) / 100).toString().replace('.', ',') + suf;
  if (abs >= 1e9) return fmt(x / 1e9, ' bi');
  if (abs >= 1e6) return fmt(x / 1e6, ' mi');
  if (abs >= 1e3) return fmt(x / 1e3, ' mil');
  return (Math.round(x * 100) / 100).toString().replace('.', ',');
}
export function formatBandLabel(min, max) {
  if (min == null && max == null) return 'Todos';
  if (min == null) return `até ${rangeNumberLabelPtBR(max)}`;
  if (max == null) return `acima de ${rangeNumberLabelPtBR(min)}`;
  return `${rangeNumberLabelPtBR(min)} a ${rangeNumberLabelPtBR(max)}`;
}

// Monta a DEFINIÇÃO da variável a partir do RangeModel (COMPUTE_RISK_BANDS). `labels`
// (opcional) sobrepõe os rótulos auto (formatBandLabel) do modelo — o passo "save" do
// rangeModal os pré-preenche editáveis (FR6). unmatchedLabel default 'Sem valor'
// (DEC-FR-006, mesmo rótulo do "Sem valor" do próprio RangeModel).
export function buildRangeDefFromModel(model, { col, csvId, labels, unmatchedLabel, genId }) {
  const mkId = genId || (() => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
  const srcBands = model?.bands || [];
  const bands = srcBands.map((b, i) => ({
    id: mkId(),
    label: (labels && labels[i] != null) ? labels[i] : (b.label ?? formatBandLabel(b.min, b.max)),
    min: b.min != null ? b.min : null,
    max: b.max != null ? b.max : null,
  }));
  return {
    id: mkId(),
    col, csvId, source: 'range',
    sourceCol: model?.col ?? null,
    metric: { id: model?.metric?.id ?? null, label: model?.metric?.label ?? null },
    bands,
    unmatchedLabel: unmatchedLabel != null ? unmatchedLabel : 'Sem valor',
    meta: {
      k: model?.params?.k ?? null,
      monotonic: model?.params?.monotonic ?? null,
      iv: model?.quality?.iv ?? null,
      ivUniform: model?.quality?.ivUniform ?? null,
      minShare: model?.params?.minShare ?? null,
      prebins: model?.params?.prebins ?? null,
      scope: model?.scope ?? null,
      generatedAt: model?.generatedAt ?? null,
    },
    createdAt: new Date().toISOString(),
  };
}

// True se `col` da base `csvId` é uma variável de faixas (tem definição registrada).
export function isRangeVar(csvStore, csvId, col) {
  return !!(csvStore && csvStore[csvId] && csvStore[csvId].rangeDefs && csvStore[csvId].rangeDefs[col]);
}

// Descrição das regras das faixas (para a Documentação Automática, mesmo ponto onde
// buildGlossary anexa `cluster` via describeClusterRules). Estrutura CRUA (dados,
// nunca prosa — padrão docModel). Com `includeDomains=false` (Contrato de Privacidade
// N2) omite os cortes concretos (min/max), mantendo rótulo e proveniência.
export function describeRangeRules(def, includeDomains = true) {
  if (!def) return null;
  return {
    col: def.col,
    sourceCol: def.sourceCol,
    metric: def.metric || null,
    unmatchedLabel: def.unmatchedLabel,
    bands: (def.bands || []).map(b => ({
      label: b.label,
      min: includeDomains ? (b.min ?? null) : null,
      max: includeDomains ? (b.max ?? null) : null,
    })),
  };
}

// ── Operações de edição PURAS (o modal edita um rascunho e chama estas) ──────────

// Renomeia uma faixa (por id) — só troca o `label`. Retorna nova def.
export function renameRangeBand(def, bandId, newLabel) {
  return {
    ...def,
    bands: (def.bands || []).map(b => b.id === bandId ? { ...b, label: newLabel } : b),
  };
}

// Edita os pontos de corte (as k−1 fronteiras INTERNAS, em ordem crescente, sem os
// ±∞ das pontas) preservando o Nº de faixas e os rótulos/ids existentes — só min/max
// mudam. Validação de ORDENAÇÃO ESTRITA (DEC-FR-009): cortes precisam ser finitos e
// estritamente crescentes; senão retorna `{ def: null, error }` (o modal exibe o erro
// e não salva). Sucesso ⇒ `{ def: novaDef, error: null }`.
export function editRangeCuts(def, cuts) {
  const bands = def?.bands || [];
  const need = Math.max(0, bands.length - 1);
  if (!Array.isArray(cuts) || cuts.length !== need) {
    return { def: null, error: `Eram esperados ${need} corte(s), recebido(s) ${Array.isArray(cuts) ? cuts.length : 0}.` };
  }
  for (const c of cuts) {
    if (typeof c !== 'number' || !Number.isFinite(c)) {
      return { def: null, error: 'Todo corte precisa ser um número.' };
    }
  }
  for (let i = 1; i < cuts.length; i++) {
    if (!(cuts[i] > cuts[i - 1])) {
      return { def: null, error: 'Os cortes precisam estar em ordem estritamente crescente.' };
    }
  }
  const newBands = bands.map((b, i) => ({
    ...b,
    min: i === 0 ? null : cuts[i - 1],
    max: i === bands.length - 1 ? null : cuts[i],
  }));
  return { def: { ...def, bands: newBands }, error: null };
}
