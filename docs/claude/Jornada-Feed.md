# Feed de Próxima Melhor Ação (Épico NB — aba 🧭 Copiloto)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer no
> `NextActionsModel`, em `computeNextActions` (worker), em `src/nextActionInsights.js`
> ou na aba 🧭 Copiloto do painel direito (`src/App.jsx`).

Converte as saídas dos motores JÁ existentes (lint estrutural, ranking de variáveis,
estado da política) num feed de cards priorizados que responde "o que eu faço agora?" —
substitui o antigo painel de lint isolado (Sessão 1). Ver `docs/wiki/
Jornada-Prompts-Sessoes.md` (DEC-NB-001..009) para as decisões normativas completas.

## Duas camadas: motor (NB1) × apresentação (NB2)

- **`computeNextActions`** (`src/simulation.worker.js`) — orquestrador determinístico.
  Mensagem `COMPUTE_NEXT_ACTIONS` → `NEXT_ACTIONS_RESULT` (fora do cache do tick, M6).
  Devolve **fatos crus + códigos** (`{kind, title:{code,facts}}`), nunca prosa — mesmo
  contrato do `docModel` (Copiloto Sessão 6) e do `BaseProfileModel` (Épico EB).
- **`src/nextActionInsights.js`** (NB2) — módulo FOLHA, espelho exato do contrato de
  `src/exploreInsights.js`: `describeAction(action)` (leitura do card, dispatch por
  `action.kind`), `describeWhyItMatters(action)` ("ⓘ Por que isso importa", texto fixo
  por `kind`, NÃO usa `facts`), `severityLabel`/`ctaLabel` (rótulos curtos),
  `formatActionDelta` (delta validado — string vazia se `delta` for `null`, nunca
  estimado). GATE: `tests/nextActionInsights.test.js` — cobertura total dos 18 `kind`
  do catálogo v1, nenhum placeholder vazado, determinismo byte a byte.

## `NextActionsModel` — quem calcula o quê

`computeNextActions(shapes, conns, csvStore, ir, nodeArrivals, lensCounts, context, tier2)`.
Duas camadas de fonte (DEC-NB-002):
- **Tier 1** (sempre fresco, recomputado no mesmo debounce ~300ms do lint): lint
  consciente de tráfego (`computePolicyInsights`, DEC-NB-009 — `dead_branch`
  consolidado, `port_dangling` só com tráfego real), portas desconectadas com top-3 do
  ranking da porta, estado estrutural (canvas vazio, AS IS ausente, variável pendente,
  documentação nunca gerada/desatualizada).
- **Tier 2** (caro, NUNCA rodado pelo orquestrador): Descoberta de Segmentos e
  Simplificação — o orquestrador só COSTURA achados já calculados via `tier2`. A NB2
  ainda envia `tier2: {}` (a fonte "🔎 Buscar oportunidades" que popula `tier2` de
  verdade é a **Sessão NB3**, ainda não implementada); os kinds `apply_opportunity`/
  `add_break`/`simplify` já têm template completo (`nextActionInsights.js`) e comando
  no registro, prontos para quando a NB3 injetar os achados.

O `context` (montado em `App.jsx`, efeito `nextActionsDebounceRef`) inclui heurísticas
v1 que **não são** o detector definitivo do Épico EP (`policyJourney.js`, ainda não
construído) — documentadas aqui para não serem confundidas com contrato estável:
- `pendingVars`: losangos com `variableCol` nulo mas `label` preenchido (rastro de
  `applyPolicyVarMapping` sem mapeamento — Biblioteca de Políticas).
- `policyMature`: tem terminal Aprovado E Reprovado, e nenhum achado `error` do lint.
- `hasLibraryTemplate`: existe item na Biblioteca de Políticas com o mesmo nome do
  canvas ativo (comparação por nome, não por fingerprint do IR).
- `lastDocFingerprint`: snapshot do `policyFingerprint` do último `NEXT_ACTIONS_RESULT`
  no instante em que `POLICY_DOC_RESULT` chega com sucesso (não um recálculo dedicado —
  doc e feed partem do mesmo `shapesR.current`/`connsR.current` no mesmo tick). Efêmero
  (não persiste — `docModal` também não persiste hoje).

## UI — aba 🧭 Copiloto

`rightPanelMode === 'copilot'` renderiza `nextActionsModel.actions` como lista de
cards, ordenados pelo próprio worker (severidade > score > id, DEC-NB-004). Cada card:
badge de severidade (`NEXT_ACTION_SEV_META` — 4 classes: blocker/opportunity/hygiene/
journey), leitura (`describeAction`), delta validado quando `action.delta != null`,
badge "⏳ desatualizado" quando `staleness.stale`, razão declarada quando
`actionable === false` (nó 🔒 travado), "ⓘ Por que isso importa" expansível
(`describeWhyItMatters`, estado efêmero `expandedActionWhy`), "🎯 Ir até o nó" quando
`title.facts.nodeId` aponta para um shape existente no canvas ativo (reusa
`goToCopilotNode`), e os CTAs do card.

## CTAs = comandos do registro (DEC-NB-008)

Cada `{commandId, args, labelCode}` do card é resolvido em `COMMANDS` (`runNextActionCTA`)
— **nenhum aplicador novo**: todo `copilot.*` chama uma função já existente
(`applyCopilotConnectTerminal`, `openDomainModal`, `createDecisionNode`,
`openPolicyLibrary`, `openDocModal`, `openSegmentDiscoveryModal`, `openSimplifyModal`,
`setActiveTab('explore')`). Esses comandos usam `tab: 'feed'` (sem Ribbon
correspondente) + `contextWhen: () => false` — nunca aparecem no Ctrl+K nem na Ribbon,
só existem para ficar centralizados no registro em vez de handlers soltos no JSX.
Duas simplificações v1, documentadas para revisão futura:
- `copilot.connectTerminal` tem UM commandId no modelo, mas a UI renderiza DOIS botões
  (❌ Reprovado / ✅ Aprovado — mesmo padrão do antigo painel de lint), cada um chamando
  o comando com `args.terminal` diferente — decisão de terminal fica na UI, não no worker.
- `copilot.removeFromDomain` (fix `dead_branch`, DEC-NB-009) abre o modal "Configurar
  nó" (mesmo de `open_domain_modal`) em vez de excluir o valor diretamente — não existe
  hoje um applier de "excluir 1 valor do domínio" fora desse modal; a exclusão real
  acontece lá, com confirmação do usuário.

## Descartar / adiar / ver descartados (DEC-NB-006)

`nextActionsPrefs {dismissed: string[], snoozed: string[], autoScanIdle: boolean}` —
arrays de `action.fingerprint` (estável por `kind`+alvo — regenerar o feed nunca
ressuscita um card descartado). `dismissNextAction`/`snoozeNextAction`/
`restoreNextAction` só editam esse estado; a lista visível filtra por `!dismissed &&
!snoozed`. Botão "🗂 Descartados" no cabeçalho da aba (e comando
`analyze.copilotDiscarded`, "Ver descartados") alterna `showDiscardedActions`
(efêmero) para a visão secundária, com botão "↺ Restaurar" por card. `autoScanIdle`
já reservado no contêiner — opt-in da Sessão NB3 (ainda sem UI/efeito).

**Persistência (regra inviolável do CLAUDE.md)**: `nextActionsPrefs` é criação do
usuário (o que ele decidiu não ver mais) — entra em `buildProjectPayload`/`loadProject`
(schema **3.4**, default defensivo por campo) e em `sessionStorage`
(`next_actions_prefs_v1`). O `NextActionsModel` em si é DERIVADO (recomputável) e
**não** persiste — mesmo padrão do `BaseProfileModel`/`copilotFindings`.

## O que falta (Sessões NB3/NB4)

- NB3: "🔎 Buscar oportunidades" roda Descoberta + Simplificação sob demanda, injeta os
  achados em `tier2`, staleness real quando o IR muda, `autoScanIdle` funcional.
- NB4: sincronização documental (wiki, roadmap) contra o que foi de fato entregue em
  NB1–NB3.

## Teste
`tests/nextActionInsights.test.js` — cobertura total dos 18 `kind` do catálogo v1 para
`describeAction`/`describeWhyItMatters`, nenhum placeholder vazado, `describeWhyItMatters`
independente de `facts`, determinismo. `tests/projectSave.test.js` cobre o round-trip de
`nextActionsPrefs` via `buildProjectJSONChunks`. O motor (`computeNextActions`,
DEC-NB-009) é travado por `tests/nextActions.test.js` (Sessão NB1) — inalterado nesta
sessão.
