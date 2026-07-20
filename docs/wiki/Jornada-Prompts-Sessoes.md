# Jornada de Construção Assistida — Peças 2 e 3 (Épicos NB e EP, Prompts das Sessões)

> **Objetivo**: completar a Jornada de Construção Assistida (decisão de produto de
> 20/07/2026 — tornar a plataforma produtiva de estagiário a sênior, codificando o
> método do analista experiente no produto). A **peça 1** (Explorar a Base) é o
> [[Epicos-ExplorarBase|Épico EB]]. Este documento especifica:
>
> - **Peça 2 — Épico NB**: o **Feed de Próxima Melhor Ação** — a aba 🧭 Copiloto vira
>   um condutor permanente que sempre responde "o que eu faço agora?".
> - **Peça 3 — Épico EP**: as **Etapas da Política + Checklist de Prontidão** — o
>   método (elegibilidade → segmentação → risco → calibração → validação) como mapa
>   de progresso visível e gate de governança.
>
> **Ordem de execução**: **EB1–EB5 → NB1 → NB2 → NB3 → NB4 → EP1 → EP2 → EP3** —
> estritamente incremental; cada sessão termina com o app 100% funcional e
> `npm test` verde. Exceção declarada: **EP1 (motor) só depende de código já
> existente** e pode ser intercalada após NB1, mas EP2 (UI) exige NB2.
>
> Referência normativa: esta página (DEC-NB-001..008 e DEC-EP-001..007 — **leia
> inteira antes de qualquer sessão**) · [[Epicos-ExplorarBase]] (padrão de insights
> determinísticos DEC-EB-004, ranking global DEC-EB-008) · [[Ribbon-Prompts-Sessoes]]
> (registro de comandos, painel Copiloto da Sessão 6) ·
> [[Copiloto-DescobertaSegmentos]] e [[Copiloto-SugestoesMelhoria]] (motores
> orquestrados) · `docs/claude/Copiloto-Simplificacao.md` ·
> `docs/claude/Copiloto-Documentacao.md` (`diffPolicyIR`) ·
> `docs/claude/Worker-Protocolo.md` · `docs/claude/Persistencia-Projeto.md`.
>
> **🏷️ Tag de modelo por sessão**: `[OPUS]` para orquestração/priorização/detectores
> com matemática de borda; `[SONNET]` para UI sobre padrões consolidados; `[HAIKU]`
> para sincronização documental mecânica.
>
> **Regras transversais (valem para TODAS as sessões dos dois épicos):**
> 1. `npm test` passa inalterado ao fim de cada sessão; GATEs existentes são
>    contrato; nenhuma fixture dourada é regenerada.
> 2. **Nenhum aplicador novo (DEC-IA-002)**: todo CTA de card dispara comando do
>    registro + aplicadores existentes (`applyGoalSeekMoves`, `applyPolicyPatch`,
>    `applySimplifyCandidates`, `createDecisionNode`, modais). O feed propõe; quem
>    materializa é o que já existe.
> 3. **Delta exibido = delta validado**: qualquer número de impacto num card vem de
>    re-simulação real (padrão da Descoberta Sessão 12) — nunca estimado. Card sem
>    delta validado não exibe delta.
> 4. Determinismo: mesma entrada ⇒ mesmo modelo (ordem de cards inclusive — tie-break
>    estável). Toda prosa é template determinístico sobre fatos crus (padrão
>    DEC-EB-004); **integração com LLM está explicitamente fora de escopo**
>    (decisão de 20/07/2026 — só será considerada após feedback real das peças 1–3).
> 5. **O tick de edição JAMAIS dispara motor caro**: Descoberta/Simplificação nunca
>    rodam automaticamente no caminho do tick (M6). Fontes caras são sob demanda ou
>    em idle explícito, com staleness declarado (DEC-NB-003).
> 6. Regra inviolável do CLAUDE.md: tudo que o usuário configura/descarta persiste
>    (`.credito.json` + sessão), com bump de `schemaVersion` na sessão que introduz o
>    estado e round-trip coberto por GATE.
> 7. Um comando = um descritor no registro (UX 2.0); nada silencioso — cards
>    descartados podem ser revistos ("ver descartados"), staleness é exibido, nunca
>    escondido.
> 8. CLAUDE.md: no máximo 1 linha de ponteiro por sessão (`npm run check:claude-md`);
>    detalhe em `docs/claude/Jornada-Feed.md` (NB2) e `docs/claude/Jornada-Etapas.md`
>    (EP2).

---

## Visão — por que feed + etapas (e não mais modais)

O app tem os motores certos, organizados por funcionalidade. O analista experiente
sabe qual abrir e quando; o júnior não — e é ele quem precisa entregar valor num time
que perde sêniores. A resposta NÃO é um wizard que prende (o sênior odiaria e o
júnior não aprenderia), e sim duas camadas ignoráveis sobre o mesmo canvas:

- O **feed** (NB) converte as saídas dos motores existentes em cards priorizados com
  o *porquê* e um CTA — a conversa contínua que substitui "saber qual modal abrir".
- As **etapas** (EP) dão o eixo narrativo: onde estou na construção, o que falta
  para estar "pronta para o comitê" — e viram instrumento de governança do gestor
  (toda política, de qualquer autor, passou pelos mesmos gates).

**DEC de produto transversal (registrada aqui, vale para os dois épicos): NÃO existe
"modo júnior".** É o mesmo app para todos; o scaffolding (feed, trilho de etapas,
leituras) é colapsável/ignorável pelo sênior e onipresente para quem precisa. Um
"modo" separado criaria dois produtos para manter e estigmatizaria o uso.

---

# Épico NB — Feed de Próxima Melhor Ação

## Decisões de arquitetura (DEC-NB)

| DEC | Decisão (resumo) |
|-----|------------------|
| DEC-NB-001 | Orquestrador no worker: `COMPUTE_NEXT_ACTIONS` → `NEXT_ACTIONS_RESULT` devolvendo um `NextActionsModel` (padrão `docModel`: **fatos crus + códigos, nunca prosa**). Fora do cache do tick (M6); debounced após a simulação estabilizar |
| DEC-NB-002 | **Duas camadas de fonte**: Tier 1 (barato, sempre fresco — recalculado no debounce): lint do Copiloto S1, portas desconectadas (+ ranking da porta), estado estrutural (canvas vazio, AS IS ausente, variável pendente de biblioteca, doc nunca gerada/desatualizada via `diffPolicyIR` contra fingerprint da última geração). Tier 2 (caro, NUNCA automático no tick): Descoberta de Segmentos e Simplificação — sob demanda ("🔎 Buscar oportunidades") com resultados carimbados |
| DEC-NB-003 | **Staleness declarado**: cada card Tier 2 guarda o fingerprint do PolicyIR no momento do cálculo; política mudou ⇒ card marcado "⏳ desatualizado" com CTA "recalcular" — nunca some nem se recalcula sozinho, nunca finge estar fresco |
| DEC-NB-004 | Priorização unificada: `priority = {score, impact, confidence, effort}` — reusa o score da Descoberta (impacto × confiança × acionabilidade) onde existe; fontes estruturais entram por classe de severidade (bloqueante > oportunidade > higiene) antes do score; ordenação total determinística com tie-break estável (id) |
| DEC-NB-005 | UI: a aba **🧭 Copiloto** do painel direito vira o feed. O lint atual integra-se como cards (categoria "higiene") — um único lugar, sem painel paralelo. O feed **nunca está vazio**: sem nada acionável, mostra o próximo passo da jornada (ex.: "explore a base", "documente a política", "salve na biblioteca") |
| DEC-NB-006 | Descartar/adiar por card, persistente: fingerprint estável por (kind + alvo) para que regeneração não ressuscite descartados; "ver descartados" reexibe. Estado em `nextActionsPrefs {dismissed[], snoozed[], autoScanIdle:false}` — `schemaVersion` 3.2 → **3.3** |
| DEC-NB-007 | Educação embutida: todo card tem "ⓘ Por que isso importa" — templates determinísticos em módulo puro `src/nextActionInsights.js` (mesmo contrato do `exploreInsights.js` da DEC-EB-004), com GATE de cobertura total código→template |
| DEC-NB-008 | CTAs = descritores do registro (UX 2.0) com `contextWhen`; aplicar cria cenário/patch pelos aplicadores existentes com `pushHistory()` (undo cobre); nó 🔒 travado ⇒ card `actionable:false` com razão declarada (padrão da Descoberta) |

### `NextActionsModel` (esboço)

```js
{
  version, generatedAt, canvasId,
  policyFingerprint,                       // hash do PolicyIR no momento do cálculo
  actions: [{
    id, fingerprint,                       // estável por (kind + alvo) — DEC-NB-006
    kind,                                  // ver catálogo abaixo
    tier: 1|2, severity: 'blocker'|'opportunity'|'hygiene'|'journey',
    title: {code, facts},                  // prosa só no render (nextActionInsights)
    priority: {score, impact, confidence, effort},
    delta: null | {...},                   // SÓ se validado por re-simulação real
    cta: [{commandId, args, labelCode}],
    staleness: null | {computedAt, policyFingerprint, stale: bool},   // Tier 2
    actionable: bool, reason: null|string, // nó travado etc. — declarado
  }],
  diagnostics: {sources: {...}, discarded: {...}},
}
```

Catálogo de `kind` do v1: `connect_port` (porta solta — com top-3 do ranking da
porta embutido), `fix_lint_*` (categorias do lint S1), `add_break`
(`heterogeneous_block`), `apply_opportunity` (deviation da Descoberta),
`simplify` (candidato com prova), `document` (doc nunca gerada / desatualizada),
`configure_asis`, `map_pending_var` (variável pendente de biblioteca),
`explore_base` (canvas vazio ⇒ aponta a aba Explorar), `first_branch` (base
explorada + canvas vazio ⇒ top do ranking global como sugestão de raiz, DEC-EB-008),
`save_library` (política madura sem template salvo). Todo kind novo exige template
(DEC-NB-007) e GATE.

## Sessão NB1 — Orquestrador + modelo + priorização 🏷️ [OPUS]

**Documentação**: esta página (DEC-NB-001..004, 008) + `docs/claude/Worker-Protocolo.md`

**Pré-requisitos**: Épico EB concluído (ranking global DEC-EB-008; padrão de insights).

**O que vai entregar**:
- `computeNextActions` no worker (Tier 1 completo; Tier 2 = costura sobre resultados
  já calculados que a main envia — o orquestrador NÃO roda Descoberta/Simplificação)
- Fingerprints (card e PolicyIR — reusa `diffPolicyIR`/serialização canônica do IR)
- Priorização unificada DEC-NB-004; mensagens novas documentadas no protocolo
- **GATE novo `tests/nextActions.test.js`**: cada fonte Tier 1 ≡ motor original
  (mesmos achados do lint, mesmas portas soltas, mesmo ranking); ordenação
  determinística e monótona por severidade/score; fingerprint estável sob
  regeneração; staleness vira `true` quando o IR muda; card de nó travado
  `actionable:false`; feed nunca vazio (fixture sem pendências ⇒ cards `journey`)

**Resultado esperado**: modelo completo e testado, zero UI.

**Prompt**:
```
Vamos à Sessão NB1 da Jornada de Construção (feed de próxima melhor ação — motor),
conforme docs/wiki/Jornada-Prompts-Sessoes.md (DEC-NB-001..004 e 008 são
normativas; releia também docs/claude/Worker-Protocolo.md e os motores que serão
orquestrados: lint do Copiloto S1, computeVariableRanking, diffPolicyIR).
Implemente computeNextActions no worker com as fontes Tier 1 (lint, portas
desconectadas com top-3 do ranking, estado estrutural: canvas vazio, AS IS
ausente, variável pendente, doc desatualizada por fingerprint do PolicyIR) e a
costura Tier 2 (recebe achados de Descoberta/Simplificação já calculados — o
orquestrador nunca os executa), a priorização unificada (severidade > score, com
tie-break estável) e o NextActionsModel do esboço (fatos crus + códigos, nunca
prosa; delta só quando validado). Mensagens COMPUTE_NEXT_ACTIONS →
NEXT_ACTIONS_RESULT fora do cache do tick, documentadas em Worker-Protocolo.md.
GATE novo tests/nextActions.test.js conforme a lista da sessão. Nenhuma mudança de
matemática nos motores existentes — npm test inalterado é contrato.
```

---

## Sessão NB2 — Feed na aba Copiloto + persistência 🏷️ [SONNET]

**Documentação**: esta página (DEC-NB-005..007) + [[Ribbon-Prompts-Sessoes]] (Sessão 6)

**Pré-requisitos**: NB1.

**O que vai entregar**:
- Aba 🧭 Copiloto do painel direito renderizando o feed (cards com severidade,
  leitura, "ⓘ Por que isso importa", CTA, delta validado quando houver); lint
  integrado como cards (o painel de lint atual é substituído — sem duplicação)
- `src/nextActionInsights.js` (puro) com templates pt-BR de TODOS os kinds + GATE
  `tests/nextActionInsights.test.js` (cobertura total, sem placeholder vazado,
  determinismo)
- Descartar/adiar/ver descartados (DEC-NB-006); `nextActionsPrefs` persistido
  (payload + loadProject com default defensivo + sessionStorage), `schemaVersion`
  3.2 → **3.3**; round-trip em GATE
- Comandos no registro: "Buscar oportunidades", "Ver descartados", CTAs por kind
- `docs/claude/Jornada-Feed.md` + 1 linha no CLAUDE.md + checklist de save

**Resultado esperado**: o feed vivo e persistente; usuário descarta/adia; nada some
sozinho.

**Prompt**:
```
Vamos à Sessão NB2 da Jornada de Construção (feed — UI e persistência), conforme
docs/wiki/Jornada-Prompts-Sessoes.md (DEC-NB-005..007). A aba 🧭 Copiloto do
painel direito passa a renderizar o NextActionsModel da NB1 como feed de cards
(severidade visual, leitura por template, "ⓘ Por que isso importa" expansível,
CTAs via registro de comandos, delta só quando validado); o painel de lint atual
integra-se como cards de higiene (remova a superfície antiga sem perder nenhum
achado — mesma fonte). Crie src/nextActionInsights.js (puro, espelho do contrato
de exploreInsights.js) com templates de todos os kinds e GATE de cobertura.
Implemente descartar/adiar por fingerprint com "ver descartados", persistindo
nextActionsPrefs no projeto e na sessão (bump schemaVersion 3.2 → 3.3, defaults
defensivos, round-trip em teste). O feed nunca fica vazio (cards journey).
Releia a regra inviolável de persistência do CLAUDE.md antes de começar.
```

---

## Sessão NB3 — Fontes caras sob demanda + staleness 🏷️ [OPUS]

**Documentação**: esta página (DEC-NB-002/003) + [[Copiloto-DescobertaSegmentos]] +
`docs/claude/Copiloto-Simplificacao.md`

**Pré-requisitos**: NB2.

**O que vai entregar**:
- "🔎 Buscar oportunidades" no feed: roda Descoberta (global) + Simplificação em
  sequência não-bloqueante (pool H3 quando disponível), injeta os achados como cards
  Tier 2 carimbados com `policyFingerprint`
- Invalidação declarada: mudança do IR ⇒ cards Tier 2 marcados "⏳ desatualizado"
  com CTA "recalcular" (nunca removidos/recalculados sozinhos)
- Opt-in `autoScanIdle` (default OFF, no Hub de Configurações): re-executa a busca em
  idle real (nunca no tick), com a mesma marcação de staleness
- GATE (extensão de `tests/nextActions.test.js`): cards Tier 2 ≡ achados dos motores
  originais número a número; staleness no momento certo; dismissed não ressuscita
  após rebusca

**Resultado esperado**: oportunidades profundas no feed, sempre honestas sobre
frescor.

**Prompt**:
```
Vamos à Sessão NB3 da Jornada de Construção (fontes caras do feed), conforme
docs/wiki/Jornada-Prompts-Sessoes.md (DEC-NB-002/003). Implemente "🔎 Buscar
oportunidades": executa a Descoberta de Segmentos (escopo global, parâmetros
default do modal) e a Simplificação, fora do caminho do tick, e injeta os achados
acionáveis como cards Tier 2 com carimbo do policyFingerprint. Quando o PolicyIR
mudar, os cards Tier 2 ficam marcados "desatualizado" com CTA de recalcular —
jamais removidos ou recalculados automaticamente. Adicione o opt-in autoScanIdle
(default OFF) no Hub de Configurações, persistido em nextActionsPrefs (sem novo
bump — o contêiner já existe). Estenda tests/nextActions.test.js: paridade número
a número com os motores originais, staleness, dismissed que não ressuscita.
A regra de ouro vale: nada caro no tick de edição.
```

---

## Sessão NB4 — Sincronização documental 🏷️ [HAIKU]

**Pré-requisitos**: NB1–NB3.

**O que vai entregar**: [[Decisoes]] (DEC-NB resumidas) · [[Roadmap]] · [[Home]]/
[[_Sidebar]] · `docs/claude/Jornada-Feed.md` revisado contra o implementado ·
skill `base-testes` (avaliar cobertura de cenários do feed na Base Oficial — **nunca
regenerar o CSV sem pedido**) · `npm run check:claude-md` verde.

**Prompt**:
```
Vamos à Sessão NB4 da Jornada de Construção (sincronização documental do Épico
NB), conforme docs/wiki/Jornada-Prompts-Sessoes.md. Atualize Decisoes.md,
Roadmap.md, Home/_Sidebar da wiki e docs/claude/Jornada-Feed.md contra o que foi
de fato implementado em NB1–NB3 (leia o código, não confie na memória). Rode a
skill base-testes para avaliar se a Base de Testes Oficial precisa de regras novas
no gerador (sem regenerar o CSV). npm run check:claude-md e npm test verdes.
Nenhuma mudança de código de produto.
```

---

# Épico EP — Etapas da Política + Checklist de Prontidão

## Decisões de arquitetura (DEC-EP)

| DEC | Decisão (resumo) |
|-----|------------------|
| DEC-EP-001 | **6 etapas canônicas**: 1 Conhecer a base · 2 Elegibilidade · 3 Segmentação · 4 Risco e cortes · 5 Calibração · 6 Validação e entrega. São guia e contexto — **nunca wizard bloqueante**: tudo continua acessível em qualquer ordem |
| DEC-EP-002 | Estado das etapas é **derivado por detectores determinísticos** (motor puro `src/policyJourney.js`) sobre `csvStore`/shapes/conns/artefatos (doc gerada, biblioteca): heurísticas DECLARADAS (o card da etapa diz o que foi detectado e por quê) + **override manual** por etapa ("marcar como concluída/reabrir"), persistido |
| DEC-EP-003 | **Checklist de Prontidão** ("pronta para o comitê?"): lista de critérios objetivos, cada um pass/fail/n-a com link-comando para resolver — nunca nota mágica. Critérios v1: lint sem bloqueantes · 100% da população decidida · nenhuma variável pendente · AS IS configurado e delta simulado · documentação gerada e atual (`diffPolicyIR` vazio desde a geração) · sem candidato de simplificação lossless pendente · variáveis usadas sem flag `unstable_psi` (quando o perfil EB existir). Critérios ativáveis/desativáveis por config |
| DEC-EP-004 | UI: **trilho de etapas** compacto no topo da aba 🧭 Copiloto (colapsável; estado persiste) — clicar numa etapa filtra o feed NB pelos cards daquela etapa (todo kind mapeia para uma etapa). Checklist como card fixo da etapa 6 + modal expandido |
| DEC-EP-005 | Governança: a Documentação Automática ganha a seção **"Prontidão da Política"** (estado do checklist na geração — critérios, pass/fail, data), no mesmo pipeline `docModel` → `renderDocMarkdown`/`renderDocHTML`; sob N2 nada de domínio vaza (só estados) |
| DEC-EP-006 | Persistência: `journeyState {stageOverrides:{[stage]:'done'|'reopened'|null}, readinessConfig:{[critId]:bool}, railCollapsed}` — `schemaVersion` 3.3 → **3.4**; round-trip em GATE. O estado detectado (derivado) não persiste |
| DEC-EP-007 | Sem "modo júnior" (DEC de produto transversal, ver Visão): trilho e checklist são os mesmos para todos e ignoráveis — colapso persistente, zero recurso exclusivo por senioridade |

### Detectores do v1 (DEC-EP-002 — heurísticas declaradas)

- **E1 Conhecer a base**: base carregada + AS IS configurado (+ sinal forte: perfil
  EB calculado). — **E2 Elegibilidade**: existe caminho raiz→terminal Reprovado com
  ≤ 2 nós (padrão knock-out) OU override. — **E3 Segmentação**: ≥ 1 variável
  categórica/cluster testada em nível ≤ 2 com ramos que seguem para subárvores
  distintas. — **E4 Risco e cortes**: ≥ 1 variável ordinal/faixas/score em uso com
  portas roteadas a terminais distintos. — **E5 Calibração**: Goal Seek/otimizador já
  aplicado neste canvas (marca no histórico do cenário) OU delta vs AS IS dentro de
  meta declarada OU override. — **E6 Validação**: checklist de prontidão 100% nos
  critérios ativos. Detectores imperfeitos por natureza ⇒ SEMPRE exibem o que
  detectaram + botão de override — nunca fingem certeza.

## Sessão EP1 — Motor de etapas + checklist 🏷️ [OPUS]

**Documentação**: esta página (DEC-EP-001..003, detectores) +
`docs/claude/Copiloto-Documentacao.md` (`diffPolicyIR`)

**Pré-requisitos**: NB1 (fingerprint do IR; fontes do feed reusadas como insumo).
Executável antes de NB2/NB3 se necessário.

**O que vai entregar**:
- `src/policyJourney.js` (puro, compartilhado main/worker/teste):
  `detectJourneyStages(shapes, conns, csvStore, artifacts)` e
  `computeReadiness(shapes, conns, csvStore, artifacts, config)` → `{criteria:[{id,
  state:'pass'|'fail'|'na', facts, fixCommandId}]}`
- Todos os detectores e critérios do v1, cada um com `facts` explicando a detecção
- **GATE novo `tests/policyJourney.test.js`**: fixtures plantadas por etapa
  (knock-out presente/ausente, segmentação presente/ausente, etc.); checklist ≡
  estado real dos motores (lint/cobertura/pendências/diff da doc) número a número;
  override manual respeitado; critério desativado ⇒ `na`; determinismo

**Resultado esperado**: motor completo e testado, zero UI.

**Prompt**:
```
Vamos à Sessão EP1 da Jornada de Construção (motor de etapas e prontidão),
conforme docs/wiki/Jornada-Prompts-Sessoes.md (DEC-EP-001..003 e a seção
"Detectores do v1" são normativas). Crie src/policyJourney.js (módulo puro,
padrão de clusterVar.js/goalSeek.js) com detectJourneyStages e computeReadiness
exatamente como especificados: detectores determinísticos com facts declarando o
que foi detectado, override manual vindo por parâmetro, critérios do checklist
com estado pass/fail/na e fixCommandId. Reuse os motores existentes como fonte
(lint, cobertura de população do funil, pendências de variável, diffPolicyIR
contra o fingerprint da última doc gerada, flags do BaseProfileModel quando
disponível) — nada de matemática duplicada. GATE novo tests/policyJourney.test.js
conforme a lista da sessão. Zero UI nesta sessão; npm test inalterado.
```

---

## Sessão EP2 — Trilho de etapas + checklist na UI + seção na Documentação 🏷️ [SONNET]

**Documentação**: esta página (DEC-EP-004..006) + `docs/claude/Copiloto-Documentacao.md`

**Pré-requisitos**: EP1 + NB2 (o trilho filtra o feed).

**O que vai entregar**:
- Trilho de etapas no topo da aba 🧭 Copiloto (estado por etapa: detectada/concluída/
  override, com "por quê" visível); clique filtra o feed; colapso persistente
- Checklist de prontidão: card fixo + modal expandido (critério → estado → facts →
  botão-comando de resolução); config de critérios no Hub de Configurações
- `journeyState` persistido (payload/loadProject/sessionStorage), `schemaVersion`
  3.3 → **3.4**, round-trip em GATE
- Seção **"Prontidão da Política"** na Documentação Automática (worker anexa o
  resultado de `computeReadiness` ao `docModel`; render nos dois formatos; caso N2
  coberto) — GATE em `tests/policyDoc.test.js` (casos novos, nada regenerado)
- `docs/claude/Jornada-Etapas.md` + 1 linha no CLAUDE.md + checklist de save

**Resultado esperado**: a jornada visível de ponta a ponta; o gestor lê a prontidão
na própria documentação exportada.

**Prompt**:
```
Vamos à Sessão EP2 da Jornada de Construção (etapas e prontidão — UI e
documentação), conforme docs/wiki/Jornada-Prompts-Sessoes.md (DEC-EP-004..006).
Implemente o trilho de 6 etapas no topo da aba 🧭 Copiloto consumindo
detectJourneyStages (estado + "por quê" + override manual), com clique filtrando
o feed NB por etapa e colapso persistente; o checklist de prontidão como card
fixo + modal expandido com link-comando por critério e config no Hub de
Configurações. Persista journeyState no projeto e na sessão (bump 3.3 → 3.4,
defaults defensivos, round-trip em GATE). Adicione a seção "Prontidão da
Política" à Documentação Automática (docModel no worker + renderDocMarkdown/HTML,
respeitando o Contrato de Privacidade N2), com casos novos em
tests/policyDoc.test.js sem regenerar nada. Releia a regra inviolável de
persistência do CLAUDE.md antes de começar.
```

---

## Sessão EP3 — Sincronização documental 🏷️ [HAIKU]

**Pré-requisitos**: EP1–EP2.

**O que vai entregar**: [[Decisoes]] (DEC-EP resumidas) · [[Roadmap]] (jornada
completa: EB+NB+EP entregues, LLM conversacional registrado como "avaliar após
feedback") · [[Home]]/[[_Sidebar]] · `docs/claude/Jornada-Etapas.md` revisado contra
o implementado · skill `base-testes` · `npm run check:claude-md` verde.

**Prompt**:
```
Vamos à Sessão EP3 da Jornada de Construção (sincronização documental do Épico
EP), conforme docs/wiki/Jornada-Prompts-Sessoes.md. Atualize Decisoes.md,
Roadmap.md (marque a Jornada de Construção — Épicos EB/NB/EP — como entregue e
registre "Copiloto conversacional (LLM)" como item futuro a avaliar após
feedback, sem especificá-lo), Home/_Sidebar e docs/claude/Jornada-Etapas.md
contra o código real. Rode a skill base-testes (sem regenerar o CSV). npm run
check:claude-md e npm test verdes. Nenhuma mudança de código de produto.
```

---

## Resumo das dependências

```
Épico EB (peça 1)  ──►  NB1 ──► NB2 ──► NB3 ──► NB4
                          │
                          └────► EP1 ──► EP2 ──► EP3
                                          ▲
                                 (EP2 exige NB2)
```

`schemaVersion`: 3.1 → 3.2 (EB2) → 3.3 (NB2) → 3.4 (EP2).

## Fora de escopo (registrado, não especificado)

- **Copiloto conversacional / integração com LLM** — decisão de 20/07/2026: só será
  avaliado (e então especificado) após feedback real de uso das peças 1–3. Os
  insumos estruturados que ele consumiria (`BaseProfileModel`, `NextActionsModel`,
  PolicyIR redigível N2) já nascem prontos nestes épicos — nenhuma decisão aqui
  bloqueia essa porta.
- Esqueleto completo de política gerado automaticamente ("montar rascunho") — o
  card `first_branch` do feed é deliberadamente o passo mínimo, não a árvore
  inteira.
- Metas de negócio persistentes por projeto (alvo de aprovação/inad usados pela
  etapa E5) além do que o Goal Seek já captura — extensão futura do Hub.
