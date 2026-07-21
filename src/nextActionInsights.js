// src/nextActionInsights.js — templates determinísticos do Feed de Próxima Melhor Ação
// (Jornada NB, Épico NB, Sessão NB2 — docs/wiki/Jornada-Prompts-Sessoes.md, DEC-NB-007).
//
// MESMO CONTRATO de src/exploreInsights.js (DEC-EB-004): o worker (`computeNextActions`,
// simulation.worker.js) devolve só FATOS CRUS + CÓDIGOS (`action.kind`, `action.title.facts`)
// — nunca prosa. Este módulo é a ÚNICA fonte de prosa pt-BR do feed, sempre determinística
// (mesma entrada ⇒ mesma prosa, byte a byte) e nunca gerada por modelo de linguagem
// (integração com LLM está fora de escopo — decisão de 20/07/2026).
//
// Duas alturas de texto por card (DEC-NB-007):
//   (1) `describeAction(action)`  — a leitura do card (equivalente a `describeFinding`).
//   (2) `describeWhyItMatters(action)` — "ⓘ Por que isso importa", texto pedagógico FIXO
//       por `action.kind` (equivalente a `describeHowToRead`/`howToReadTopic`, mas sem a
//       indireção por widget — aqui `kind` já é o tópico).
// Mais dois helpers de apresentação: `severityLabel` (rótulo da classe de severidade) e
// `ctaLabel`/`formatActionDelta` (texto curto de botão e do delta validado).
//
// Módulo FOLHA (não importa App.jsx nem o worker) — mesmo padrão de src/exploreInsights.js.

const qty = (v) => (v == null || !isFinite(v)) ? "—" : Math.round(v).toLocaleString("pt-BR");
const iv2 = (v) => (v == null || !isFinite(v)) ? "—" : v.toFixed(2);
const pctpp = (v, d = 1) => (v == null || !isFinite(v)) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)} p.p.`;
const str = (v) => (v == null || v === "") ? "—" : v;

// Template mínimo por `action.kind` — todo kind emitido por `computeNextActions` (NB1) tem
// entrada aqui. `facts` = `action.title.facts` (nunca interpolado cru — sempre via
// str/qty/iv2 acima), para `facts` incompleto (fixture de teste, kind futuro sem todos os
// campos) nunca vazar "undefined"/"NaN" para a tela.
const ACTION_TEMPLATES = {
  connect_port: (f) => `Porta${f.label ? ` "${f.label}"` : ""} sem conexão de saída${f.arrivals != null ? ` — ${qty(f.arrivals)} proposta(s) que chegam aqui não são roteadas (somem da simulação)` : " — a população que chega aqui não é roteada (some da simulação)"}.`,
  fix_lint_dead_branch: (f) => `Ramo morto: o valor${f.value ? ` "${f.value}"` : ""} não tem tráfego na base atual (0 propostas) e a porta não está conectada${f.coversDerived ? ` — cobre mais ${qty(f.coversDerived)} achado(s) derivado(s) a jusante` : ""}.`,
  fix_lint_unreachable_node: () => `Este nó não é alcançado a partir de nenhuma raiz do fluxo — provável fragmento desconectado.`,
  fix_lint_cycle: () => `Este nó participa de um ciclo no fluxo (loop infinito) — a simulação nunca decide essas linhas.`,
  fix_lint_zero_arrival: (f) => `${f.value ? `O valor "${f.value}"` : "Este ramo"} nunca chega a este nó (0 propostas)${f.coversDerived ? `, e cobre mais ${qty(f.coversDerived)} achado(s) derivado(s) a jusante` : ""}.`,
  fix_lint_lens_empty: () => `As regras deste Decision Lens não casam nenhuma linha da base.`,
  fix_lint_duplicate_variable_path: () => `A mesma variável é testada de novo neste nó, depois de já decidida antes no mesmo caminho — possível redundância.`,
  fix_lint_path_without_terminal: (f) => `Este nó não tem nenhuma saída conectada${f.arrivals != null ? ` — ${qty(f.arrivals)} proposta(s) que chegam aqui são perdidas` : " — todo o volume que chega aqui é perdido"}.`,
  first_branch: (f) => f.top ? `Comece pela variável mais discriminante da base: "${str(f.top.col)}" (IV ${iv2(f.top.iv)}).` : `Comece adicionando a primeira decisão ao canvas.`,
  explore_base: (f) => f.baseLoaded ? `Explore a base carregada para descobrir por onde começar a política.` : `Carregue uma base para começar.`,
  map_pending_var: (f) => `A variável "${str(f.name)}" está pendente de mapeamento — a política referencia uma coluna que a base atual não tem.`,
  configure_asis: () => `Configure a decisão AS IS desta base para ter uma referência de comparação para a política simulada.`,
  document: (f) => f.state === 'never' ? `A documentação desta política ainda não foi gerada.` : `A política mudou desde a última documentação gerada — o documento está desatualizado.`,
  save_library: () => `Esta política já tem estrutura madura e ainda não foi salva na Biblioteca de Políticas.`,
  journey_next: (f) => f.policyEmpty ? `Comece explorando a base ou adicionando a primeira decisão ao canvas.` : `Nenhuma pendência no momento — continue construindo ou documente a política.`,
  apply_opportunity: () => `Oportunidade encontrada pela Descoberta de Segmentos num segmento da base — veja o detalhe na Descoberta.`,
  add_break: () => `Bloco heterogêneo: a Descoberta encontrou um segmento que se beneficia de um novo corte.`,
  simplify: (f) => `${f.candidateCount ? `${qty(f.candidateCount)} candidato(s) de simplificação encontrados` : "Candidatos de simplificação encontrados"}${f.removedNodeCount ? `, removendo ${qty(f.removedNodeCount)} nó(s)` : ""}${f.identical ? " — equivalência PROVADA (diff = 0)" : ""}.`,
};

// Leitura do card ({kind, title:{code,facts}} — `computeNextActions`, NB1). Sem template
// conhecido, degrada declaradamente — nunca `undefined`/`[object Object]` solto na tela.
export function describeAction(action) {
  if (!action) return "";
  const tpl = ACTION_TEMPLATES[action.kind];
  if (!tpl) return `Ação "${action.kind}" (leitura ainda não disponível).`;
  try { return tpl(action.title?.facts || {}) || `Ação "${action.kind}" (leitura ainda não disponível).`; }
  catch { return `Ação "${action.kind}" (leitura ainda não disponível).`; }
}

// ── "ⓘ Por que isso importa" — texto pedagógico FIXO por `kind` (não usa `facts`: é o
// conceito por trás do card, não o resultado específico) ─────────────────────────────
const WHY_TEMPLATES = {
  connect_port: `Toda porta de um losango precisa terminar em algo (outro nó ou um terminal Aprovado/Reprovado). Uma porta solta faz a população daquele valor "sumir" silenciosamente da simulação — ela não é aprovada nem reprovada, só desaparece das contas.`,
  fix_lint_dead_branch: `Diferente de uma porta solta com tráfego, um ramo morto não tem nenhuma proposta na base atual passando por ali. Ele pode voltar a ter tráfego se a política a montante mudar — por isso o Copiloto avisa em vez de esconder, mas não trata como bloqueante.`,
  fix_lint_unreachable_node: `Um nó sem nenhuma entrada vinda de uma raiz do fluxo nunca é avaliado pela simulação — geralmente sobra de uma edição anterior (nó movido, conexão apagada).`,
  fix_lint_cycle: `Um ciclo faz a simulação entrar em loop ao tentar decidir essas linhas — elas nunca chegam a um terminal. Quebre o ciclo redirecionando uma das conexões.`,
  fix_lint_zero_arrival: `Chegada zero não é erro por si só (pode ser um valor raro na base), mas um corte construído sobre um ramo sem nenhum caso não tem como ser validado pela simulação.`,
  fix_lint_lens_empty: `Um Decision Lens cujas regras não casam ninguém normalmente indica um operador ou valor errado na condição — revise as regras.`,
  fix_lint_duplicate_variable_path: `Testar a mesma variável duas vezes no mesmo caminho geralmente é redundante: a segunda decisão nunca muda o resultado, porque o primeiro corte já decidiu o valor.`,
  fix_lint_path_without_terminal: `Sem uma saída conectada, toda a população que chega a este nó é perdida da simulação — nem aprovada, nem reprovada.`,
  first_branch: `O ranking global (IV) aponta a variável que mais separa bons de maus pagadores na base inteira — um bom ponto de partida para a primeira decisão, mas não é obrigatório segui-lo.`,
  explore_base: `Conhecer a base antes de decidir evita cortes às cegas: cobertura, IV e estabilidade de cada variável orientam por onde começar.`,
  map_pending_var: `Uma variável pendente não tem coluna mapeada na base atual — o nó fica sem tráfego (0 chegadas) até você indicar qual coluna usar.`,
  configure_asis: `Sem uma decisão AS IS configurada, não existe uma referência para comparar a política simulada — todo delta de aprovação/inadimplência fica sem contexto.`,
  document: `A Documentação Automática registra os números da política no momento da geração. Se a política mudou depois, o documento não reflete mais o fluxo atual.`,
  save_library: `Salvar na Biblioteca de Políticas permite reaplicar esta estrutura em outra base, com o mapeamento de variáveis feito na hora da aplicação.`,
  journey_next: `Sem nenhuma pendência estrutural, o próximo passo natural é seguir explorando a base, testar mais variáveis ou documentar o que já foi decidido.`,
  apply_opportunity: `A Descoberta de Segmentos varre a base procurando subgrupos onde a política atual se desvia do que os dados sugerem — cada oportunidade traz um delta validado por re-simulação real, nunca estimado.`,
  add_break: `Um bloco heterogêneo é um segmento onde a taxa de risco varia muito internamente — um novo corte pode separar melhor bons de maus pagadores ali.`,
  simplify: `A Simplificação prova (ou declara) o impacto de remover nós que não mudam o resultado final — reduz a política sem perder precisão.`,
};

const WHY_FALLBACK = "Leitura pedagógica ainda não disponível para este card.";

// Texto pedagógico fixo por `kind` — kind sem template conhecido degrada declaradamente.
export function describeWhyItMatters(action) {
  const kind = action?.kind;
  return WHY_TEMPLATES[kind] || WHY_FALLBACK;
}

// ── Metadados de apresentação (curtos, não-narrativos) ────────────────────────────────
const SEVERITY_LABEL = { blocker: 'Bloqueante', opportunity: 'Oportunidade', hygiene: 'Higiene', journey: 'Jornada' };
export function severityLabel(severity) { return SEVERITY_LABEL[severity] || 'Achado'; }

const CTA_LABEL = {
  connect_terminal: 'Conectar terminal',
  open_domain: 'Configurar nó',
  remove_from_domain: 'Remover do domínio',
  first_branch: 'Criar primeira decisão',
  explore_base: 'Explorar a base',
  map_pending_var: 'Mapear variável',
  configure_asis: 'Configurar AS IS',
  document: 'Documentar política',
  save_library: 'Salvar na Biblioteca',
  apply_opportunity: 'Ver na Descoberta',
  add_break: 'Ver bloco heterogêneo',
  simplify: 'Ver Simplificação',
};
export function ctaLabel(labelCode) { return CTA_LABEL[labelCode] || 'Ver detalhe'; }

// Delta validado por re-simulação real (DEC-NB-004/007) — só chamado quando `action.delta`
// não é `null` (contrato: card sem delta validado não exibe delta). Aceita tanto o formato
// da Descoberta (`apply_opportunity`/`add_break`: approvalDelta/inadRealDelta/inadInfDelta/
// movedQty) quanto o da Simplificação (`simplify`: proven + approvalDelta, ou proven:false +
// campos livres da prova) — degrada declaradamente para formato desconhecido.
export function formatActionDelta(delta) {
  if (!delta) return "";
  if (typeof delta.proven === 'boolean') {
    return delta.proven
      ? `Equivalência provada — impacto zero na simulação (diff = 0).`
      : `Impacto estimado por re-simulação: aprovação ${pctpp(delta.approvalDelta)}.`;
  }
  const parts = [];
  if (delta.approvalDelta != null) parts.push(`aprovação ${pctpp(delta.approvalDelta)}`);
  if (delta.inadRealDelta != null) parts.push(`inad. real ${pctpp(delta.inadRealDelta)}`);
  if (delta.inadInfDelta != null) parts.push(`inad. inferida ${pctpp(delta.inadInfDelta)}`);
  if (delta.movedQty != null) parts.push(`${qty(delta.movedQty)} proposta(s) afetadas`);
  return parts.length > 0 ? `Impacto validado: ${parts.join(" · ")}.` : "";
}
