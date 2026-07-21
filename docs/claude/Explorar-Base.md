# Explorar a Base (Épico EB, EB1+EB2+EB3+EB4 — DEC-EB-001..012)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer na aba
> **Explorar** (3ª aba da barra inferior), no `BaseProfileModel` (worker), no layout
> automático ou na camada interpretativa (`src/exploreInsights.js`). Referência
> normativa completa (DEC-EB-001..012, filosofia, sessão EB5 planejada):
> `docs/wiki/Epicos-ExplorarBase.md`.

Terceira aba da aplicação (`activeTab:'explore'`, label "Explorar", leftmost na barra —
"conhecer a matéria-prima" abre a jornada Explorar → Canvas → Dashboard). Não depende de
shapes/conns: funciona com o canvas vazio, a partir do momento em que uma base é
carregada. Responde "o que esta base tem a me dizer" (perfil da base observada),
diferente do Dashboard (que responde "como minha política está se saindo" sobre a
**simulação**).

## Pipeline (EB1, motor no worker — sem UI)

`COMPUTE_BASE_PROFILE` → `BASE_PROFILE_RESULT` (mensagens documentadas em
`docs/claude/Worker-Protocolo.md`). `computeBaseProfile(csvStore, {csvId, riskMetric})`
monta o `BaseProfileModel` numa passada dedicada, **Classe A absoluta** (só agregação
O(distintos) local, JAMAIS roteia ao sidecar — DEC-HX-007), fora do cache do tick de
edição. Padrão `docModel`/`SegmentModel`: **dados crus + códigos de achado, nunca
prosa** (DEC-EB-003).

```js
// BaseProfileModel (ver DEC-EB-003 para o esboço completo e tests/baseProfile.test.js
// para o contrato travado por GATE — motor entregue na EB1, sem mudança na EB2)
{
  version, generatedAt, csvId,
  metric: {id, label, direction},              // resolveRiskMetric (DEC-SD-006)
  asIs: null | {totalQty, approvedQty, rejectedQty, otherQty, approvalRate, inadRealAprovados, inadInferidaAprovados},
  variables: [{col, varType, distinct, coveragePct, iv, flags, profile, profileTruncated, psi, continuous}],
  temporal: null | {col, series:[{bucket, qty, approvalRate, inadRate}]},
  quality: [{col, coveragePct, unparseablePct, dominantValue}],
  insights: [{code, severity, facts}],
}
```

`variables[]` já vem **ordenado por IV desc** (mesmo motor do ranking global,
`computeVariableRanking` com âncora nula — DEC-EB-008) — a EB2 reusa essa ordem
diretamente para "top-N variáveis mais discriminantes", sem reordenar.

## Aba Explorar (EB2 — `src/dashboardComponents.jsx`, `ExploreTab`)

- **Header**: seletor de base (`csvStore` carregados) + seletor de métrica-alvo
  (Inad. Real/Inferida) + **↻ Regenerar análise** + **📄 Exportar PDF** (mesmo padrão de
  `exportDashboardPDF`, captura genérica via `[data-explore-capture]` no corpo de cada
  widget — sem branch por tipo).
- **Estado em `App.jsx`**: `exploreCsvId` (base selecionada; `null` até o worker ecoar o
  winner por população), `exploreRiskMetric` (default `'inadReal'`), `baseProfileResult`
  (o `BaseProfileModel` corrente — **DERIVADO, não persiste**), `exploreLayouts`
  (`{[csvId]: WidgetConfig[]}` — **criação do usuário, persiste**, ver
  `docs/claude/Persistencia-Projeto.md`).
- **Dispatch do worker**: `useEffect` dedicado (`COMPUTE_BASE_PROFILE`, debounced
  300ms), depende só de `[csvStore, exploreCsvId, exploreRiskMetric, activeTab]` — NUNCA
  de `shapes`/`conns` (DEC-EB-002: não é o tick de edição). Só computa enquanto
  `activeTab==='explore'` (mesmo racional de custo de `COMPUTE_ANALYTICS_DATASET`).

## Layout automático (DEC-EB-005/006 — `src/explore.js`)

`buildDefaultExploreLayout(profile)` — **puro, testável, determinístico** (ids derivados
do nome da coluna via `colSlug`, nunca `uid()`/timestamp). Gera as 6 seções fixas, cada
uma abrindo com um card `insight`:

1. Retrato da operação AS IS (`insight` preset `asis`)
2. Ranking de variáveis (`insight` preset `ranking` + 1× `ivrank`)
3. Perfis das top-N variáveis (`insight` preset `varprofile` + até `EXPLORE_TOP_N_VARS=5`
   × `varprofile`, uma por variável de maior IV — mesma ordem de `profile.variables`)
4. Qualidade dos dados (`insight` preset `quality` + 1× `quality`)
5. Estabilidade temporal (`insight` preset `stability` + 1× `stability`)
6. Avisos/leituras (`insight` preset `warnings` — lista **todos** os `insights[]`)

Todo widget nasce com `origin:'auto'`. Auto-init: `ExploreTab` (`useEffect` sobre
`profile`) chama `buildDefaultExploreLayout` só quando `exploreLayouts[csvId]` está
vazio — nunca sobrescreve um layout já existente.

### ↻ Regenerar análise (DEC-EB-005 — `regenerateExploreLayout` em `App.jsx`)

Ação **explícita** (confirmação via `window.confirm`, único precedente desse padrão no
código — não há modal de confirmação dedicado no resto da app). Recria só os widgets
`origin:'auto'`, preservando os `origin:'user'`:

```js
const kept = prev.filter(w => w.origin === 'user');
const keptIds = new Set(kept.map(w => w.id));
return [...kept, ...buildDefaultExploreLayout(profile).filter(w => !keptIds.has(w.id))];
```

**Ponto sutil**: os ids de `buildDefaultExploreLayout` são **slots estáveis** (ex.:
`auto_insight_asis`, `auto_varprofile_<col>`) — o mesmo id sempre nomeia "o card
automático daquela seção/variável". Um slot promovido a `user` (qualquer edição de
`config`, incl. o título — ver `changeConfig` em `ExploreTab`) precisa ser **excluído**
da nova leva automática, senão dois widgets acabam com o mesmo `id` (React key
duplicada + `changeConfig`/`removeWidget` por id passam a afetar os dois). Coberto
manualmente via teste E2E nesta sessão (edita título → regenera → confere 1 widget só,
sem o AUTO badge, e a contagem total NÃO duplica o slot editado).

## Widgets novos (`src/dashboardComponents.jsx`)

Todos compartilham a casca `ExploreWidgetShell` (título editável + badge `AUTO` +
duplicar/remover/arrastar/redimensionar — mesmo mecanismo de posicionamento livre do
Dashboard). São os widgets do layout AUTOMÁTICO — o `FieldPanel`/filtros/agrupamentos do
builder livre (EB4, DEC-EB-011, ver seção própria abaixo) usam a casca do Dashboard
(`AnalyticsWidget`/`TextWidget`), não esta. Editar qualquer `config` promove `origin` para `'user'`
(`ExploreTab.changeConfig`).

| Tipo | Corpo | Fonte |
|---|---|---|
| `insight` | Leitura mínima (1–2 frases) por seção (`preset`) ou lista de TODOS os achados (`preset:'warnings'`) | `src/exploreInsights.js` |
| `ivrank` | Barra horizontal **div-based** (não Recharts — controle total sobre os badges de flag) do ranking global, com ícones por `flags[]` (🎯 score, 🕐 temporal, ⚠️ baixa cobertura, 🏔 dominante, 🔀 alta cardinalidade, 📉 PSI instável) | `profile.variables` |
| `varprofile` | Volume (barras) + taxa da métrica-alvo (linha), eixo duplo, Recharts `ComposedChart` (exceção DEC-AW-001 estendida à aba Explorar, DEC-EB-011 §7) | `profile.variables[].profile` |
| `quality` | Tabela: cobertura, % não numérico, categoria dominante | `profile.quality` |
| `stability` | Série por safra (volume/aprovação/inadimplência) + selos de PSI top-8 por variável, coloridos pelos limiares da DEC-EB-009 (< 0,1 verde · 0,1–0,25 âmbar · > 0,25 vermelho) | `profile.temporal` + `profile.variables[].psi` |

Degradação sempre declarada: sem AS IS ⇒ `insight` preset `asis` lê o achado
`no_asis`; sem coluna ⏱ ⇒ `stability` mostra o estado vazio dedicado (nunca inventa
série) e o `insight` preset `stability` lê `no_temporal_column`.

## Camada interpretativa completa (EB3 — `src/exploreInsights.js`)

Módulo **folha** (não importa `App.jsx` nem o worker — mesmo padrão de `src/segVar.js`),
com quatro exports. Nunca LLM, sempre determinístico (mesma entrada ⇒ mesma prosa, byte
a byte — DEC-EB-004 in fine).

**1ª altura — Leitura** (herdada da EB2, assinaturas inalteradas):

- `describeFinding({code, facts})` — 1 frase por código de achado do v1 (`high_iv`,
  `suspect_score`, `suspect_temporal`, `low_coverage`, `dominant_value`,
  `high_cardinality`, `immature_vintage`, `unstable_psi`, `no_temporal_column`,
  `no_asis`). Todo campo de `facts` passa por um formatador (`str`/`pct`/`qty`/`iv2`)
  antes de entrar na frase — nunca interpolado cru — para que `facts` incompleto nunca
  vaze `"undefined"`/`NaN` para a tela. Código sem template conhecido degrada
  declaradamente (nunca `undefined` solto na tela).
- `describeSection(preset, profile)` — 1–2 frases por seção do layout default (`asis`,
  `ranking`, `varprofile`, `quality`, `stability`, `warnings`), lendo o
  `BaseProfileModel` inteiro.

**2ª altura — "ⓘ Como ler" pedagógico** (novo na EB3, texto FIXO por tópico — não
depende de `facts`, é o conceito por trás do indicador, não o resultado):

- `describeHowToRead(topic)` — texto pedagógico por tópico (`asis`, `ranking`,
  `varprofile`, `quality`, `stability`, `warnings` — mesmo vocabulário dos presets de
  seção). Tópico desconhecido/nulo degrada declaradamente (`HOWTOREAD_FALLBACK`).
- `howToReadTopic(widget)` — resolve `{type, config}` de um `WidgetConfig` para o
  tópico certo: o card `insight` usa o próprio `config.preset`; os widgets dedicados
  mapeiam para o tópico do conceito que ilustram (`ivrank` → `ranking`, `varprofile` →
  `varprofile`, `quality` → `quality`, `stability` → `stability`) — é o MESMO indicador,
  só muda a visualização, então reusam o mesmo texto pedagógico. Widget nulo/sem
  `type`/de tipo desconhecido ⇒ `null` (que `describeHowToRead` também degrada
  declaradamente, nunca quebra a UI).

**3ª altura — Avisos**: já coberta pelo widget `insight` preset `warnings`, que lista
`profile.insights[]` via `describeFinding` (sem módulo adicional).

**UI** (`src/dashboardComponents.jsx`, `ExploreWidgetShell`): botão `ⓘ` no cabeçalho de
TODO widget da aba (incl. os 4 tipos dedicados, não só `insight`) alterna um painel
expansível com `describeHowToRead(topic)`, `topic` calculado por `ExploreWidget` via
`howToReadTopic(widget)` e repassado como prop `topic` ao shell.

GATE dedicado `tests/exploreInsights.test.js`: cobertura total código→template e
preset/tópico→template; nenhum placeholder vazado (`undefined`/`NaN`/`[object Object]`)
mesmo com `facts` ausente/incompleto; determinismo byte a byte; resolução
widget→tópico para os 4 tipos dedicados + os 6 presets do `insight`.

## Pontes para o fluxo (EB4 — `src/dashboardComponents.jsx`, DEC-EB-010)

3 CTAs nos cards `varprofile` (botões rotulados no rodapé, ao lado das métricas) e
`ivrank` (ícones compactos por linha) — componente compartilhado `ExploreVarActions`.
REUSAM os aplicadores já existentes do resto do app — **nenhum caminho novo de
materialização** (DEC-IA-002):

| CTA | Aplicador reusado | Comportamento |
|---|---|---|
| ➕ Usar como 1º galho | `createDecisionNode` (App.jsx — o mesmo do drag-and-drop do painel de variáveis) | Posição via `computeFirstBranchPosition` (`src/explore.js`, pura/testável): canvas ativo vazio ⇒ centro do viewport (losango raiz); não-vazio ⇒ ao lado da bounding box existente (nó SOLTO, nunca sobrepõe). Sempre navega para `activeTab='canvas'`, seleciona e centraliza no novo nó (`requestAnimationFrame` + `setVp`). Canvas não-vazio ⇒ mostra `exploreActionNotice` (aviso dispensável dentro da própria aba Explorar) avisando que o nó precisa ser conectado |
| 📐 Criar faixas | `openRangeModal({csvId, col})` | Só aparece quando `v.continuous` (o motor já classifica isso no `BaseProfileModel`). Pré-preenche a coluna no passo 1 do modal |
| 🧩 Clusterizar | `openClusterModal(null)` + patch (`setClusterModal(m => ({...m, csvId, dims:[col]}))`) | `openClusterModal` não recebe pré-seleção de dimensão diretamente (só escopo de nó) — o patch roda logo em seguida, no mesmo gesto (updaters funcionais, o React aplica em ordem) |

**Armadilha corrigida nesta sessão**: `rangeModal`/`clusterModal` (e os demais modais
globais do app) vivem no JSX do **CANVAS PANE**, cujo wrapper é
`display:activeTab==='canvas'?'flex':'none'`. Um `display:none` em CSS remove a
subárvore inteira do render (mesmo descendentes `position:fixed;inset:0` colapsam para
`0×0`) — abrir esses modais a partir da aba Explorar SEM primeiro `setActiveTab('canvas')`
monta o modal invisível (nenhum erro no console). Por isso `exploreCreateRangesFor`/
`exploreClusterizeFrom` chamam `setActiveTab('canvas')` antes de abrir o modal (o
`exploreUseAsFirstBranch` já navegava para lá por natureza).

## Builder livre (EB4 — DEC-EB-011)

`ExploreTab` ganha o MESMO `FieldPanel`/`FilterCardsEditor`/`GroupingModal` do Dashboard
(`AnalysisTab`), operando sobre um dataset largo **escopado à base selecionada**, com
**cenário FIXO `as_is`** (sem canvases — a aba analisa a base observada, nunca a política
simulada):

- **Pipeline dedicado**: `COMPUTE_EXPLORE_DATASET` → `EXPLORE_DATASET_RESULT` (worker),
  MESMO motor `computeAnalyticsDataset(canvasInputs, csvStore, options)` do Dashboard,
  chamado com `canvasInputs=[]` e o novo `options.csvId` (aditivo — sem `csvId`,
  comportamento idêntico ao pré-EB4, usado pelo Dashboard). Debounce 300ms, só enquanto
  `activeTab==='explore'` e há `exploreCsvId` — mesmo racional de custo do perfil (EB2).
- **Estado em `App.jsx`**: `exploreAnalyticsDataset` (dataset cru — **DERIVADO, não
  persiste**), `exploreGroupings`/`explorePageFilters` (`{[csvId]: [...]}` — **CRIAÇÃO DO
  USUÁRIO, persiste**, mesmo padrão per-csvId de `exploreLayouts`).
  `groupedExploreDataset = applyGroupingsToDataset(exploreAnalyticsDataset,
  exploreGroupings[exploreCsvId])` é o dataset efetivamente passado ao `FieldPanel`/
  `AnalyticsWidget`.
- **Widgets livres reusam os tipos do Dashboard** (`line`/`bar`/`bar100`/`kpi` via
  `AnalyticsWidget`, `text` via `TextWidget`) — nascem `origin:'user'` direto (não há
  "AUTO" para algo que o próprio usuário pediu) e entram no MESMO array `layout`
  (`exploreLayouts[csvId]`) dos widgets automáticos da aba; `EXPLORE_FREE_TYPES` (Set de
  tipos livres) decide, por widget, se o dispatcher de render usa `AnalyticsWidget`/
  `TextWidget` ou `ExploreWidget` (cascas diferentes: a livre tem `FieldPanel`/filtros
  arrastáveis, a automática tem "ⓘ Como ler"/badge AUTO).
- **Rótulo da série declara AS IS** (DEC-EB-011 in fine): `pivotWidget` (`analytics.js`)
  tinha o rótulo `"Simulado"` HARDCODED para a série implícita sem eixo de cenário — correto
  no Dashboard (2+ cenários, o único sem nome "AS IS" é mesmo uma política simulada), mas
  enganoso com dataset de UM cenário só (`scenarios.length===1`, o caso do builder livre —
  mostraria "Simulado" sobre dado que é literalmente AS IS). Fix: com um único cenário, o
  rótulo vira o `nome` real desse cenário (`"AS IS"`); com 2+, mantém `"Simulado"` (sem
  mudança de comportamento do Dashboard).
- **"+ Adicionar gráfico"/"📝 Adicionar texto"** no header — mesmos `makeChartWidget`/
  `makeTextWidget` do Dashboard (`AnalysisTab`), adaptados para nascer sobre `layout`
  (`exploreLayouts[csvId]`) em vez de `analyticsLayout`.
- Exportação em PDF (`exportExplorePDF`) captura os widgets livres também: eles ganham um
  wrapper `<div data-explore-capture>` (mesmo marcador genérico dos widgets automáticos),
  então a captura de DOM funciona sem branch por tipo — a diferença é que o "capture" do
  livre inclui a casca inteira do widget (título/seletores), não só o gráfico (o
  `exportDashboardPDF` do Dashboard tem uma extração mais cirúrgica —
  `widgetVisualHTML`/`.recharts-wrapper` — que não foi replicada aqui nesta sessão).

## Convite pós-import (EB4 — DEC-EB-012)

Ao final do `confirm` do wizard de importação (só para **NOVA** base — o modo de edição
de dataset existente retorna antes desse ponto), `App.jsx` seta
`postImportInvite = {csvId, filename}`: banner dispensável no topo do Canvas
("🔎 Análise da base "{filename}" pronta" + botão "Abrir Explorar" que navega e seleciona
a base) — nunca bloqueante, nunca autofechado sozinho. Canvas vazio + alguma base
carregada ⇒ a 1ª linha do card "Dicas" do canto do canvas (mesma fonte `CANVAS_TIPS`
usada também na seção Sobre do Hub em telas estreitas) vira
"🔎 Base carregada — comece pela aba Explorar para conhecer os dados" — `canvasTips`
(computado em `App.jsx`, antes do JSX principal) prefixa isso sem alterar `CANVAS_TIPS`.

## Persistência (DEC-EB-007/011, schema 3.3)

`exploreLayouts`/`exploreGroupings`/`explorePageFilters`, todos `{[csvId]: [...]}`, são
**criação do usuário** ⇒ regra inviolável do `CLAUDE.md`: entram em
`buildProjectPayload()`/`loadProject()` (default defensivo `{}` para projetos < 3.2/3.3)
+ `sessionStorage` (`explore_layouts_v1`/`explore_groupings_v1`/`explore_page_filters_v1`).
O `BaseProfileModel` (`baseProfileResult`) e o dataset largo do builder livre
(`exploreAnalyticsDataset`) são **derivados** (recomputáveis da base) e NÃO persistem —
mesmo contrato de `analyticsDataset`. Round-trip coberto em `tests/projectSave.test.js`.
`exploreCsvId`/`exploreRiskMetric`/`exploreActionNotice`/`postImportInvite` são estado de
UI efêmero (não persistem).

## Comandos (registro declarativo, `App.jsx` § COMMANDS)

`data.openExplore` ("Abrir Explorar", `setActiveTab('explore')`) e
`data.regenerateExplore` ("Regenerar análise da base", chama a MESMA
`regenerateExploreLayout` do botão do header — sem duplicação de lógica), ambos sob a
aba `dados`/grupo "Explorar". Aparecem automaticamente na Busca Ctrl+K (não filtrada por
aba ativa) e na Ribbon (só quando `activeTab==='canvas'`, já que a Ribbon só monta
nesse caso — mesma limitação estrutural que já existia para qualquer comando de aba
fixa antes desta sessão). **As 3 pontes para o fluxo (EB4) NÃO entraram no registro
COMMANDS** — são parametrizadas por `(col, csvId)` de um card específico, e todo
descritor hoje é global ou escopado a UM shape selecionado (`contextWhen(shape)`); não
há hoje um conceito de "variável focada" fora do canvas para um comando genérico mirar.
Ficam como callbacks de widget (mesmo padrão de "👁 Ver no Dashboard"/"🎯 Ver no fluxo"
dos cards de Segmento/Cluster, que também nunca entraram no registro).

## Testes

- `tests/explore.test.js` — `buildDefaultExploreLayout`: 6 seções na ordem certa, teto
  de top-N (`EXPLORE_TOP_N_VARS`), ids únicos, `origin:'auto'`, determinismo byte a
  byte, layout vazio sem perfil válido; `computeFirstBranchPosition` (EB4): canvas
  vazio ⇒ centro do viewport (desfazendo pan/zoom), não-vazio ⇒ ao lado da bounding box
  sem sobrepor, determinismo.
- `tests/analytics.test.js` — `computeAnalyticsDataset` com `options.csvId` (EB4): escopa
  a UMA base (dimensões/linhas só dessa base, cenário só `as_is`); sem `options.csvId`,
  comportamento idêntico ao caminho original (regressão).
- `tests/projectSave.test.js` — round-trip de `exploreLayouts`/`exploreGroupings`/
  `explorePageFilters` via `buildProjectJSONChunks`.
- `tests/baseProfile.test.js` (EB1, sem mudança) — GATE do `BaseProfileModel`.
- `tests/exploreInsights.test.js` (EB3) — cobertura total código/preset/tópico→template,
  nenhum placeholder vazado, determinismo, resolução widget→tópico do "ⓘ Como ler".

## Fora de escopo (EB5 — sincronização documental)

- Skill `base-testes`: avaliar se a Base de Testes Oficial cobre os cenários novos
  (variável instável entre safras p/ PSI, categoria dominante, coluna de baixa
  cobertura) — nunca regenerar o CSV sem pedido do usuário.
- Wiki: `Decisoes`/`Roadmap`/`Home`/`_Sidebar`; revisão final deste documento contra o
  implementado.
