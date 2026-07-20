# Explorar a Base — Análise Exploratória Assistida (Épico EB)

> **Ordem de execução recomendada**: **EB1 → EB2 → EB3 → EB4 → EB5**, estritamente
> incremental — cada sessão termina com o app 100% funcional, `npm test` verde e nada
> pela metade visível ao usuário. EB1 (motor) não tem UI; EB2 já entrega a aba
> funcionando ponta a ponta; EB3 e EB4 enriquecem; EB5 (sincronização documental) é
> sempre a última.
>
> Referência normativa: esta página (DEC-EB-001..012 — **leia inteira antes de
> qualquer sessão**) · [[Epicos-AnalyticsWorkspace]] (chassi de widgets que a aba reusa)
> · [[Ribbon-Prompts-Sessoes]] (registro de comandos — todo comando novo nasce como
> descritor) · `docs/claude/Analytics-Workspace.md` (dataset largo, filtros,
> agrupamentos) · `docs/claude/Copiloto-Segmentos.md` (heurística `segVarDefaultReason`,
> padrão SegmentModel) · `docs/claude/Copiloto-Documentacao.md` (padrão "dados crus no
> worker, prosa no render") · `docs/claude/Worker-Protocolo.md` (mensagens `COMPUTE_*`)
> · `docs/claude/Persistencia-Projeto.md` (regra inviolável de save/load).
>
> **🏷️ Tag de modelo por sessão**: `[OPUS]` para núcleo algorítmico/matemática nova
> (PSI, generalização do ranking, agregações do perfil); `[SONNET]` para UI/render
> sobre padrões consolidados; `[HAIKU]` para sincronização documental mecânica.
>
> **Regras transversais (valem para TODAS as sessões):**
> 1. `npm test` passa inalterado ao fim de cada sessão — GATEs existentes são
>    contrato; sessões só ADICIONAM casos/arquivos. Nenhuma fixture dourada é
>    regenerada neste épico.
> 2. **Classe A absoluta**: todo o perfil da base roda no worker (agregação
>    O(distintos) sobre os dicionários colunares) — JAMAIS roteia ao sidecar
>    (DEC-HX-007). Fora do cache do tick de edição (é análise, não simulação).
> 3. Todo número exibido vem de agregação exata sobre a base (nunca amostrado, nunca
>    estimado); todo cálculo é determinístico (mesma entrada ⇒ mesmo
>    `BaseProfileModel`, byte a byte).
> 4. Degradação sempre **declarada na UI**, nunca silenciosa: sem coluna ⏱ temporal ⇒
>    seção de estabilidade explica o que falta (e como marcar no wizard); sem AS IS ⇒
>    retrato da operação declara a ausência. Nada é inventado (padrão
>    `stability:null` da Descoberta).
> 5. **Regra inviolável do CLAUDE.md**: o layout da aba Explorar é criação do usuário
>    ⇒ persiste em `.credito.json` + auto-persistência de sessão, com round-trip
>    coberto por GATE e bump de `schemaVersion` (3.1 → 3.2). O `BaseProfileModel` em
>    si é DERIVADO (recomputável da base) e NÃO persiste.
> 6. **Um comando = um descritor**: toda ação nova (abrir Explorar, regenerar
>    análise, CTAs de ponte) entra no registro declarativo de comandos (UX 2.0) — sem
>    botão copiado-e-colado fora do registro.
> 7. Recharts é permitido na aba Explorar (extensão da exceção DEC-AW-001 — a aba é
>    irmã do Dashboard, não do canvas; ADR-003 segue valendo para o canvas).
> 8. **Prosa interpretativa é template determinístico** sobre fatos crus do worker —
>    nunca gerada por modelo de linguagem, nunca não-reproduzível (DEC-EB-004).
> 9. CLAUDE.md ganha no máximo 1 linha de ponteiro por sessão (guard
>    `npm run check:claude-md`); o detalhe vive em `docs/claude/Explorar-Base.md`
>    (criado na EB2) e nesta página.

---

## Visão do épico

Decisão de produto de 20/07/2026 (conversa com o gestor de crédito): a plataforma tem
motores excelentes organizados por funcionalidade, mas **não tem jornada** — e o
público-alvo passa a incluir analistas juniores/estagiários, num contexto de perda
recorrente de pessoas experientes. O método do analista sênior (a ordem das perguntas,
os critérios de "por que a variável A antes da B", os cheiros de leakage) precisa
migrar da cabeça das pessoas para dentro do produto.

A **Jornada de Construção Assistida** foi desenhada em três peças:

1. **Conhecer a base** (ESTE épico) — análise exploratória automática + assistida.
2. **Feed de próxima melhor ação** (épico futuro) — o Copiloto como condutor
   permanente, orquestrando ranking/descoberta/lint/goal-seek num feed priorizado.
3. **Etapas da política + checklist de prontidão** (épico futuro) — o método
   (elegibilidade → segmentação → risco → calibração → validação) como mapa de
   progresso visível e gate de governança.

Este épico entrega a peça 1 **completa e com valor autônomo**: uma terceira aba
(**Canvas · Dashboard · Explorar**) que, a partir do momento da carga de uma base, já
nasce preenchida com a análise que um analista sênior faria antes de desenhar o
primeiro galho — e que qualquer pessoa pode estender arrastando campos, no mesmo
chassi de widgets do Dashboard.

### Por que uma aba separada do Dashboard (e não uma seção nele)

Os dois respondem perguntas diferentes com pipelines diferentes:

- **Dashboard**: consome o `analyticsDataset` (saída da **simulação** — AS IS vs
  Simulado). Responde "como minha política está se saindo". Sem política, é vazio de
  significado.
- **Explorar**: consome o novo `BaseProfileModel` (perfil da **base** — variáveis,
  risco observado, qualidade, safras). Responde "o que esta base tem a me dizer".
  Funciona com canvas vazio — é **anterior** à existência de qualquer política.

A barra de abas passa a contar a jornada sozinha: *Explorar = conhecer a
matéria-prima; Canvas = construir; Dashboard = medir o resultado*.

### Filosofia (decisões de produto, 20/07/2026)

- **Auto-preenchida, mas nunca mágica**: os widgets gerados automaticamente são
  widgets REAIS do chassi (editáveis, deletáveis, duplicáveis, inspecionáveis) — o
  júnior aprende desmontando. Regenerar é ação explícita, nunca sobrescrita
  silenciosa (DEC-EB-005).
- **Nenhum indicador frio**: todo número vem acompanhado de uma leitura interpretativa
  em linguagem de negócio + um "ⓘ Como ler" pedagógico (DEC-EB-004). A ferramenta é
  também o programa de formação do time.
- **A curadoria do layout default É o método**: a ordem das seções (retrato AS IS →
  ranking → perfis → qualidade/estabilidade → avisos) codifica a ordem das perguntas
  do analista experiente (DEC-EB-006).
- **Análise sem ação vira relatório**: os cards trazem pontes diretas para o fluxo
  ("➕ Usar como 1º galho", "📐 Criar faixas", "🧩 Clusterizar") — o embrião da
  jornada guiada (DEC-EB-010).
- **Por base**: cada CSV carregado tem seu perfil e seu layout; análise é propriedade
  da base (DEC-EB-007).

---

## Decisões de arquitetura (DEC-EB)

| DEC | Decisão (resumo) |
|-----|------------------|
| DEC-EB-001 | Nova aba **Explorar** (`activeTab:'explore'`, 3ª aba da barra inferior, entre Canvas e Dashboard na narrativa; posição visual: Canvas · Dashboard · Explorar ou Canvas · Explorar · Dashboard — definir na EB2 com o usuário vendo). Não depende de shapes/conns: funciona com canvas vazio |
| DEC-EB-002 | Pipeline próprio: `COMPUTE_BASE_PROFILE` → `BASE_PROFILE_RESULT` (worker), fora do cache do tick; recomputado quando `csvStore`/métrica-alvo mudam (debounced), NÃO a cada edição de canvas. Agregação O(distintos) via dicionários colunares (`candidateCoder`); Classe A, nunca sidecar |
| DEC-EB-003 | `BaseProfileModel` no padrão `docModel`/`SegmentModel`: **dados crus + códigos de achado, nunca prosa**. Métrica-alvo via `resolveRiskMetric` (DEC-SD-006) — default `inadReal`, seletor no header da aba |
| DEC-EB-004 | **Camada interpretativa determinística**: módulo puro `src/exploreInsights.js` transforma `{code, facts}` em `{title, body, howToRead}` pt-BR por templates — mesmo padrão worker-cru/render-prosa de `policyDocRender.js`. Nunca LLM, sempre reproduzível, coberto por GATE (todo código de achado tem template; nenhum placeholder vaza) |
| DEC-EB-005 | Layout default gerado por `buildDefaultExploreLayout(profile)` como widgets reais do chassi; botão **↻ Regenerar análise** recria só os widgets de origem automática (`origin:'auto'`) após confirmação, preservando os criados/editados pelo usuário (`origin:'user'` — editar um auto o promove a user) |
| DEC-EB-006 | Seções do layout default, nesta ordem: (1) Retrato da operação AS IS · (2) Ranking de variáveis · (3) Perfis das top-N variáveis · (4) Qualidade dos dados · (5) Estabilidade temporal · (6) Avisos/leituras. Cada seção abre com um card de leitura (widget `insight`) |
| DEC-EB-007 | Granularidade **por base**: `exploreLayouts: {[csvId]: WidgetConfig[]}` (estado de topo novo) + seletor de base no header da aba. Persistência: `buildProjectPayload`/`loadProject` + sessionStorage, `schemaVersion` 3.1 → **3.2**. O perfil (derivado) não persiste; o layout (criação do usuário) sim |
| DEC-EB-008 | Ranking global: `computeVariableRanking` generalizado para **âncora nula** (população = base inteira do csv selecionado; `usedCols` vazio) — mesmo motor, dois consumidores (modal da porta continua intacto). Badges de alerta via `segVarDefaultReason` promovida a helper compartilhado (worker + main), com os MESMOS tokens de hoje |
| DEC-EB-009 | Estabilidade temporal + **PSI** no v1: requer coluna ⏱ temporal (`columnTypes='temporal'`, DEC-AW-005). Por variável: PSI entre a primeira e a segunda metade cronológica das safras (ordenação `parseTemporalKey`, suavização ε; limiares declarados 0,1/0,25). Por base: volume e inad por safra (maturação visível). Sem coluna temporal ⇒ card declarativo "marque uma coluna como ⏱ Temporal no passo 2 do wizard" — seção nunca some em silêncio |
| DEC-EB-010 | **Pontes para o fluxo** nos cards de perfil: "➕ Usar como 1º galho" (canvas ativo vazio ⇒ cria losango raiz via `createDecisionNode` e navega ao Canvas; canvas não-vazio ⇒ cria nó solto e avisa), "📐 Criar faixas" (contínua ⇒ `openRangeModal` pré-preenchido), "🧩 Clusterizar" (⇒ `openClusterModal`). Reusam os aplicadores existentes — NENHUM caminho novo de materialização (DEC-IA-002); nada aplica sem clique |
| DEC-EB-011 | Builder livre na aba: mesmo `FieldPanel`/`FilterCardsEditor`/`GroupingModal` do Dashboard, operando sobre o dataset largo com **cenário fixo AS IS** (a aba analisa a base observada, não a política simulada — widgets livres declaram isso no rótulo da série). Widgets novos (`varprofile`, `ivrank`, `quality`, `stability`, `insight`) entram em `dashboardComponents.jsx` ao lado dos atuais |
| DEC-EB-012 | Convite pós-import (nunca bloqueante): ao concluir o wizard, toast/hint "🔎 Análise da base pronta — abrir Explorar" (mesmo padrão dos hints existentes). Canvas vazio + base carregada ⇒ o card de Dicas do canvas aponta para a aba Explorar como primeiro passo |

### DEC-EB-003 — `BaseProfileModel` (esboço)

```js
{
  version, generatedAt, csvId,
  metric: {id, label, direction},              // resolveRiskMetric (DEC-SD-006)
  asIs: null | {                               // null ⇒ sem AS IS (degradação declarada)
    totalQty, approvedQty, rejectedQty, approvalRate,
    inadRealAprovados, inadInferidaAprovados,
  },
  variables: [{                                // uma entrada por coluna 'decision'
    col, varType,                              // categorical | ordinal
    distinct, coveragePct,                     // % linhas com valor não-vazio
    iv,                                        // computeIV contra a métrica-alvo
    flags: ['suspect_temporal'|'suspect_score'|...],   // segVarDefaultReason + qualidade
    profile: [{value, qty, share, rate}],      // volume + taxa por valor (teto declarado de pontos)
    psi: null | {value, refWindow, curWindow}, // DEC-EB-009; null sem coluna temporal
    continuous: bool,                          // isContinuousColumn ⇒ habilita "📐 Criar faixas"
  }],
  temporal: null | {                           // null ⇒ sem coluna ⏱ (declarado)
    col, series: [{bucket, qty, approvalRate, inadReal, inadInferida}],
  },
  quality: [{col, coveragePct, unparseablePct, dominantValue: null|{value, sharePct}}],
  insights: [{code, severity, facts}],         // códigos p/ exploreInsights.js — NUNCA prosa
}
```

Códigos de achado (`insights[].code`) do v1 — cada um com template obrigatório em
`src/exploreInsights.js`: `high_iv` (variável promissora), `suspect_score` (🎯 parece
score/rating já usado — risco de circularidade), `suspect_temporal` (🕐 coluna de
safra/cohort — não é característica do cliente), `low_coverage` (vazios demais para o
topo da árvore), `dominant_value` (categoria com share ≥ teto — pouco poder de corte),
`high_cardinality` (candidata a Agrupamento/Faixas), `immature_vintage` (inad das
safras recentes muito abaixo da média — maturação incompleta, armadilha nº 1 do
júnior), `unstable_psi` (distribuição mudou entre janelas — corte pode envelhecer),
`no_temporal_column` e `no_asis` (degradações declaradas).

### DEC-EB-004 — Camada interpretativa (o pedido central do produto)

Todo widget da aba carrega três alturas de texto, todas determinísticas:

1. **Leitura** (sempre visível): 1–2 frases interpretando O RESULTADO — ex.: *"RATING
   é a variável mais discriminante da base (IV 0,42 — forte). As faixas R14+
   concentram 61% da inadimplência com 18% do volume."* Números sempre da agregação
   exata; texto sempre de template.
2. **ⓘ Como ler** (expansível): o conceito por trás do indicador, em linguagem de
   formação — ex.: *"IV (Information Value) mede o quanto a variável separa bons de
   maus pagadores. Regra de bolso: < 0,02 inútil · 0,02–0,1 fraca · 0,1–0,3 média ·
   > 0,3 forte. Desconfie de IV > 0,5: pode ser vazamento (a variável 'sabe' o
   resultado)."* Texto fixo por tipo de widget/indicador.
3. **Avisos** (quando houver): renderização dos `insights` aplicáveis àquele card,
   com severidade visual.

GATE da camada: todo `code` emitido pelo worker tem template; templates renderizam
sem placeholder vazado para todos os `facts` dos fixtures; determinismo (mesmo model
⇒ mesma prosa, byte a byte).

### DEC-EB-009 — PSI (definição normativa)

`PSI = Σᵢ (pᵢ − qᵢ) · ln(pᵢ / qᵢ)` sobre os valores do dicionário da variável
(categorias; contínuas usam os mesmos buckets do `profile`), onde `q` = distribuição
na janela de referência (primeira metade cronológica das safras por
`parseTemporalKey`) e `p` = janela atual (segunda metade). Suavização: `pᵢ, qᵢ`
recebem ε = 1e-6 antes do log (declarado). Limiares exibidos e explicados no "ⓘ Como
ler": < 0,1 estável · 0,1–0,25 atenção · > 0,25 instável. Janelas exibidas no card
(`refWindow`/`curWindow`). Sem 2+ safras distintas ⇒ `psi:null` + leitura declarando o
porquê.

---

## Sessões

### EB1 `[OPUS]` — Motor do perfil no worker + GATE

**Escopo**: tudo do `BaseProfileModel` SEM nenhuma UI.

- `computeBaseProfile(csvStore, params)` em `src/simulation.worker.js`
  (`params = {csvId, riskMetric}`): agregações por dicionário (O(distintos) por
  coluna), IV via `computeIV` existente, qualidade, `temporal.series`, PSI
  (DEC-EB-009), `insights` (códigos + fatos). Mensagens `COMPUTE_BASE_PROFILE` →
  `BASE_PROFILE_RESULT` documentadas em `docs/claude/Worker-Protocolo.md` na mesma
  sessão.
- Generalização DEC-EB-008: `computeVariableRanking(shapes, conns, csvStore,
  anchorNodeId = null)` — âncora nula ⇒ população total do csv winner (ou
  `params.csvId`), `usedCols` vazio, MESMO shape de resultado. O caminho ancorado
  (porta) permanece byte-idêntico — coberto por teste de regressão.
- `segVarDefaultReason` extraída para helper compartilhado (sem mudar tokens).
- **GATE novo `tests/baseProfile.test.js`**: agregados do perfil ≡ agregação manual
  linha a linha em fixture pequena; IV ≡ `computeIV` aplicado à mão; ranking global ≡
  ranking ancorado numa porta artificial que recebe 100% da base; PSI ≡ cálculo
  manual (incl. caso ε e caso `psi:null`); `immature_vintage`/`unstable_psi`/
  `dominant_value`/`low_coverage` disparam nos fixtures plantados e NÃO disparam nos
  limpos; degradações `no_temporal_column`/`no_asis`; determinismo byte a byte.

### EB2 `[SONNET]` — Aba Explorar + layout automático + widgets novos

**Escopo**: a aba funcionando ponta a ponta com o layout default.

- Aba `explore` na barra inferior; header com seletor de base (csvs carregados) +
  seletor de métrica-alvo + **↻ Regenerar análise** (DEC-EB-005) + exportar PDF
  (reusa o padrão `exportDashboardPDF`).
- Novos tipos de widget em `dashboardComponents.jsx`: `varprofile` (barras de volume
  + linha de taxa, eixo duplo, Recharts `ComposedChart`), `ivrank` (barra horizontal
  com badges de flag), `quality` (tabela), `stability` (série por safra + selo PSI),
  `insight` (card de leitura — consome `exploreInsights`, stub na EB2 com leitura
  mínima; prosa completa na EB3).
- `buildDefaultExploreLayout(profile)` (puro, testável) gera as 6 seções da
  DEC-EB-006 com `origin:'auto'`.
- Estado + persistência DEC-EB-007: `exploreLayouts` (+ ref se necessário a event
  listener), `buildProjectPayload`/`loadProject` com default defensivo, sessionStorage,
  bump `schemaVersion` → **3.2**, round-trip coberto em `tests/projectSave.test.js`
  (caso novo) e/ou GATE próprio.
- Comandos no registro: "Abrir Explorar", "Regenerar análise da base".
- `docs/claude/Explorar-Base.md` criado (detalhe de implementação) + 1 linha no
  CLAUDE.md ("Onde vive o quê") + checklist de save atualizado.
- Teste: `buildDefaultExploreLayout` determinístico e completo (6 seções, teto de
  top-N); round-trip de `exploreLayouts`; regenerar preserva `origin:'user'`.

### EB3 `[SONNET]` — Camada interpretativa completa

**Escopo**: DEC-EB-004 inteira.

- `src/exploreInsights.js` (puro, compartilhado main/teste): templates pt-BR de
  leitura para TODOS os códigos do v1 + textos "ⓘ Como ler" por tipo de widget +
  formatação de números no padrão pt-BR já usado (`formatBandLabel` como referência
  de tom).
- Widgets `insight` e as leituras embutidas nos demais widgets consomem o módulo;
  expansível "ⓘ Como ler" em todos os widgets da aba (incl. os livres).
- **GATE novo `tests/exploreInsights.test.js`**: cobertura total código→template;
  nenhum placeholder vazado; determinismo; casos de borda (facts ausentes ⇒ template
  degrada declaradamente, nunca `undefined` na prosa).

### EB4 `[SONNET]` — Pontes para o fluxo + builder livre + convite

**Escopo**: DEC-EB-010/011/012.

- CTAs nos cards `varprofile`/`ivrank`: "➕ Usar como 1º galho" / "📐 Criar faixas"
  (só `continuous`) / "🧩 Clusterizar" — descritores no registro com `contextWhen`;
  reusam `createDecisionNode`/`openRangeModal`/`openClusterModal`; navegação ao
  Canvas após criar; undo cobre (via `pushHistory` dos aplicadores existentes).
- Builder livre: `FieldPanel` + filtros + agrupamentos na aba, sobre o dataset largo
  com cenário fixo AS IS (DEC-EB-011); "+ Adicionar gráfico"/"📝 Adicionar texto"
  como no Dashboard.
- Convite pós-import + card de Dicas do canvas vazio apontando para Explorar
  (DEC-EB-012).
- Teste: criação via CTA ≡ criação manual equivalente (mesmo shape resultante);
  comandos com `contextWhen` corretos.

### EB5 `[HAIKU]` — Sincronização documental e da Base de Testes

- Skill `base-testes`: avaliar se a Base de Testes Oficial cobre os cenários novos
  (variável instável entre safras p/ PSI, categoria dominante, coluna de baixa
  cobertura) — atualizar docs + regras do gerador na mesma sessão; **NUNCA regenerar
  o CSV sem pedido do usuário** (contrato).
- Wiki: [[Decisoes]] (DEC-EB-001..012 resumidas), [[Roadmap]], [[Home]]/[[_Sidebar]]
  apontando para esta página; `docs/claude/Explorar-Base.md` revisado contra o
  implementado.
- `npm run check:claude-md` verde; GATEs todos verdes.

---

## Fora de escopo deste épico (peças 2 e 3 da Jornada — épicos futuros)

- Feed de próxima melhor ação no painel Copiloto (orquestração priorizada de
  ranking/descoberta/lint/simplificação/goal-seek).
- Etapas da política como mapa de progresso + checklist de prontidão/governança.
- Esqueleto sugerido de política ("montar rascunho a partir da análise").
- Novas métricas-alvo além de inad (margem/churn — extensão do wizard, DEC-SD-006 já
  deixa o motor pronto).
