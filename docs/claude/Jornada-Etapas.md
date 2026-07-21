# Etapas da Política + Checklist de Prontidão (Épico EP — aba 🧭 Copiloto)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer no motor
> `detectJourneyStages`/`computeReadiness` (`src/policyJourney.js`), no trilho de etapas ou no
> Checklist de Prontidão da aba 🧭 Copiloto (`src/App.jsx`), ou na seção "Prontidão da
> Política" da Documentação Automática (`src/simulation.worker.js` + `src/policyDocRender.js`).

Dá o eixo narrativo do método do analista experiente — onde a política está na construção (6
etapas canônicas) e o que falta para estar "pronta para o comitê" (Checklist de Prontidão) —
como instrumento de governança. Ver `docs/wiki/Jornada-Prompts-Sessoes.md` (DEC-EP-001..007)
para as decisões normativas completas.

## Duas camadas: motor (EP1) × apresentação (EP2)

- **`src/policyJourney.js`** — módulo PURO compartilhado main/worker/teste (mesmo padrão de
  `goalSeek.js`/`clusterVar.js`). Exporta:
  - `STAGE_IDS` — as 6 etapas canônicas, em ordem: `know_base`, `eligibility`,
    `segmentation`, `risk`, `calibration`, `validation`.
  - `detectJourneyStages(shapes, conns, csvStore, artifacts)` — detectores determinísticos
    (DEC-EP-002, "Detectores do v1"), cada um retornando `{id, index, detected, override,
    state, facts}`. `facts` declara o QUE foi detectado (nunca finge certeza); `override`
    (`'done'|'reopened'|null`, vindo de `artifacts.overrides`) resolve por cima do detectado.
  - `READINESS_CRITERIA_IDS` — os 7 critérios do Checklist de Prontidão, em ordem de exibição.
  - `computeReadiness(shapes, conns, csvStore, artifacts, config)` — `{criteria: [{id,
    state:'pass'|'fail'|'na', facts, fixCommandId}]}`. `config[id] === false` desativa o
    critério (`'na'`, sai da conta de E6).
  - `ACTION_KIND_STAGE` / `stageForActionKind(kind)` (EP2, DEC-EP-004) — mapeia cada `kind` do
    catálogo do Feed NB para uma das 6 etapas (heurística DECLARADA, documentada no próprio
    módulo — agrupa por ONDE no método aquele tipo de card normalmente surge, não pelo nó
    específico do card). `kind` sem entrada ⇒ `null`, e a UI nunca esconde um card por lacuna
    de mapeamento.
  - **REUSO, NÃO DUPLICAÇÃO**: nenhum motor é recomputado aqui. Os detectores/critérios que
    dependem de matemática de motor recebem o RESULTADO já calculado via `artifacts` (lint de
    `computePolicyInsights`, cobertura do funil, `BaseProfileModel`, proposta+prova da
    Simplificação, fingerprint da última doc gerada) — só a leitura estrutural
    (adjacência/roteamento do fluxo) é feita neste módulo.

- **UI (App.jsx, EP2)** — a main chama `detectJourneyStages`/`computeReadiness` DIRETO (sem
  round-trip ao worker: custo estrutural, não varredura de base), no MESMO debounce barato do
  Feed NB (`nextActionsDebounceRef`, ~300ms) — reusa exatamente os mesmos insumos já montados
  ali (`ir`, `pendingVars`, `hasAsIs`, `lastDocFingerprint`) + `coverage` derivado do
  `simResult` do último tick + `baseProfileResult` (Perfil da Base) + `nextActionsTier2.simplify`
  (mesmo blob Tier 2 do feed, sem recomputar). Resultado em dois states DERIVADOS (não
  persistem): `journeyStages` e `journeyReadiness`.

## `artifacts.calibrationApplied` — como a etapa 5 (Calibração) é marcada

Não existe (ainda) meta de negócio persistente por projeto (roadmap futuro — "Metas de
negócio persistentes por projeto", fora de escopo do Épico EP), então `artifacts.goalMet`
é sempre `false` na app real (o detector aceita o campo, mas nada hoje o preenche) — o sinal
prático de E5 é `calibrationApplied`: um campo `calibrationApplied: true` gravado DIRETO em
`canvases[canvasId]` sempre que um otimizador materializa um resultado nesse canvas
(`applyOptimResult`, `applyJohnnyResult`, `applyGoalSeekResult` — helper `markCalibrationApplied`
em `App.jsx`). Como `canvases` já é um contêiner persistido (`buildProjectPayload`/
`loadProject`), esse campo novo viaja de graça — nenhum trabalho extra de schema (regra do
CLAUDE.md: campo novo *dentro* de um contêiner já salvo não precisa de entrada própria).

## UI — trilho de etapas (topo da aba 🧭 Copiloto, DEC-EP-004)

Renderizado só quando `rightPanelMode === 'copilot'` e `!showDiscardedActions` (não faz
sentido misturar com a visão de descartados). Cada uma das 6 etapas vira um chip compacto
(`JOURNEY_STAGE_META`): número/✓, rótulo curto, marca `✎` quando há override manual. Clicar
numa etapa:
1. Define `journeyStageFilter` (estado efêmero — `null` = sem filtro; clicar de novo limpa).
   O feed do Copiloto abaixo passa a mostrar só as ações cujo `stageForActionKind(action.kind)`
   bate com a etapa ativa (com um chip "Filtrado por: … · Limpar" e um estado vazio dedicado
   "Nenhuma pendência para esta etapa.").
2. Expande um painel de detalhe: estado (Concluída/Pendente + "(override manual)" quando
   aplicável), leitura curta de `stage.facts` (`describeJourneyStageFacts`, função pura em
   `App.jsx` — switch por `stage.id`, texto determinístico, nunca placeholder vazado), "ⓘ" com
   o texto pedagógico fixo (`JOURNEY_STAGE_WHY`, mesmo espírito de `describeWhyItMatters` do
   NB), e os botões de override: "✓ Marcar concluída" / "↺ Reabrir" / "Usar detecção
   automática" (`setStageOverride(stageId, value)` → `journeyState.stageOverrides[stageId]`).

O trilho inteiro colapsa com "▾ Recolher"/"▸ Expandir" — `journeyState.railCollapsed`,
persistente.

## UI — Checklist de Prontidão (card fixo + modal, DEC-EP-003/004)

Card fixo logo abaixo do trilho: "✅ Checklist de Prontidão" + badge `passCount/activeCount`
(verde quando 100%). Clique abre o modal (`readinessModalOpen`), que lista
`READINESS_CRITERIA_IDS` na ordem — cada critério com ícone (✅/❌/—), rótulo
(`READINESS_CRITERIA_META`), descrição fixa, e — quando `state === 'fail'` — um botão
"Resolver" que dispara `runNextActionCTA({commandId: crit.fixCommandId})`, o MESMO dispatcher
genérico de CTA do Feed NB (`COMMANDS.find(...).onRun(...)`). Nenhum aplicador novo
(DEC-IA-002): a maioria dos `fixCommandId` já existia (`copilot.mapPendingVar`,
`copilot.configureAsIs`, `copilot.generateDoc`, `copilot.applySimplify`,
`copilot.exploreBase`); esta sessão só adicionou `copilot.reviewBlockers`/
`copilot.reviewCoverage` (sem applier dedicado — navegam até a aba Copiloto, onde o lint e o
funil já vêm da MESMA fonte do feed).

## Config dos critérios (Hub de Configurações)

⚙ Hub → 🗔 Interface → "Jornada — Checklist de Prontidão": um checkbox por critério
(`journeyState.readinessConfig[critId]`). Desativar um critério o tira da conta do checklist
(`state: 'na'`) e da etapa 6 · Validação e entrega.

## Persistência (regra inviolável do CLAUDE.md)

`journeyState {stageOverrides, readinessConfig, railCollapsed}` é CRIAÇÃO/CONFIGURAÇÃO DO
USUÁRIO (DEC-EP-006) — entra em `buildProjectPayload`/`loadProject` (schema **3.5**, default
defensivo por campo) e em `sessionStorage` (`journey_state_v1`), mesmo padrão de
`nextActionsPrefs`. `journeyStages`/`journeyReadiness` são DERIVADOS (recomputáveis) e NÃO
persistem — mesmo padrão do `NextActionsModel`/`BaseProfileModel`.

## Seção "Prontidão da Política" na Documentação Automática (DEC-EP-005)

`computePolicyDoc` (worker) monta os `artifacts` de `computeReadiness` no MESMO passe que já
varre a base para os KPIs/funil do resto do `docModel` — sem recomputar nada: `lint`
(`computePolicyInsights` sobre o `nodeArrivals`/`lensCounts` já calculados),
`coverage` (`{totalQty, decidedQty}` derivado do `simResult` do mesmo tick), `pendingVars`
(varredura direta de `shapes`, mesma heurística do feed NB) e `hasAsIs` (leitura de
`csvStore`) — só o que é estado-só-da-main (`docFingerprint` da última doc gerada,
`baseProfile`, `simplify` Tier 2, `readinessConfig`) viaja em `options` de
`COMPUTE_POLICY_DOC` (mesmo padrão de `COMPUTE_NEXT_ACTIONS`). Resultado anexado como
`docModel.readiness = {criteria}` — fatos crus (`state`/`facts`), nunca prosa.

`renderDocMarkdown`/`renderDocHTML` (`src/policyDocRender.js`) renderizam a seção logo após o
"Sumário Executivo": contagem `passCount/activeCount` + tabela Critério×Estado
(`READINESS_CRITERIA_META` para o rótulo — importado de `App.jsx`, mesmo padrão circular-safe
de `fmtQty`/`COL_TYPES`; `READINESS_CRITERIA_IDS` importado direto de `policyJourney.js`).
Contrato de Privacidade N2: os `facts` de cada critério (contagens, nomes de coluna,
fingerprints) nunca são renderizados — só `state` (Passa/Falha/Desativado) e o rótulo fixo do
critério — então a seção não precisa de toggle de domínios próprio (nunca carrega valor de
domínio concreto).

## Teste

`tests/policyJourney.test.js` — GATE do motor (EP1): os 6 detectores com fixtures plantadas
por etapa, override manual respeitado, critério desativado ⇒ `na`, determinismo, E6 ≡
`computeReadiness` número a número; (EP2) completude de `ACTION_KIND_STAGE` — todo `kind` do
catálogo v1 do Feed NB mapeia para um `STAGE_ID` válido, kind desconhecido degrada para
`null`. `tests/policyDoc.test.js` — GATE da seção "Prontidão da Política": `docModel.readiness`
≡ `computeReadiness` chamado com os mesmos insumos (número a número); `readinessConfig`
respeitado; texto Markdown/HTML mostra a contagem e os rótulos; degradação (doc nunca gerada,
sem AS IS) declarada; privacidade (nenhum valor de domínio vaza); determinismo byte a byte.
`tests/projectSave.test.js` cobre o round-trip de `journeyState` via `buildProjectJSONChunks`.

## O que falta (Sessão EP3)

- EP3: sincronização documental (wiki, roadmap) contra o que foi de fato entregue em EP1–EP2.
