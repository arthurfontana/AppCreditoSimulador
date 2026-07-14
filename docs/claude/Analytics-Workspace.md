# Analytics Workspace (aba Dashboard)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer em
> gráficos/widgets do Dashboard, agrupamentos (dimensões derivadas) ou filtros
> (página/visual). Ver também `docs/wiki/Epicos-AnalyticsWorkspace.md`.

Segunda aba da aplicação (`activeTab: "analysis"`, label exibido: "Dashboard") — builder de dashboards sobre os resultados da simulação. A aba padrão ao carregar é `"canvas"`.

- **Pipeline (DEC-AW-002)**: worker emite `analyticsDataset` (formato largo **colunar**, DEC-AW-003 + Otimização de Memória Fase 4) via `COMPUTE_ANALYTICS_DATASET`, debounced junto com a simulação (só na aba Dashboard — Fase 3); cada gráfico faz pivot client-side.
- **Formato colunar do dataset largo (Fase 4)**: em vez de 1 objeto por linha (~1MM numa base diária, clonado inteiro pra main e recopiado por agrupamento — OOM ao abrir a aba Dashboard), o dataset é `{rowCount, columns:{[nome]:ColDef}, activeRows?, dimensions, temporalColumns, metrics, scenarios, dimensionOrders?, groupedDimensions?}`. `ColDef` = dict encoding (dimensões/decisões) ou `Float64Array` (métricas). Os `ArrayBuffer`s são **transferidos** (zero-cópia, sem depender de COI) no `postMessage`. Toda leitura por-linha passa pelos accessors globais `awColStr(col, r)` / `awColNum(col, r)` — nenhum consumidor reconstrói objetos por-linha. `activeRows` é a máscara `Int32Array` dos filtros (null = todas). `applyGroupingsToDataset` **adiciona uma coluna dict** (~4MB/1MM) em vez de copiar as linhas; filtros produzem `activeRows` em vez de subarrays de objetos.
- **Tipo `temporal` (DEC-AW-005)**: marcado no Passo 2 do wizard (toggle de 3 estados Categórica → Ordinal → ⏱ Temporal, grava `columnTypes[col]='temporal'`). `parseTemporalKey(str)` deriva a chave de ordenação cronológica.
- **Sessão 1** (entregue): pipeline ponta a ponta com um gráfico de linha fixo (Recharts, DEC-AW-001).
- **Sessão 2** (entregue): builder de dashboard configurável — gráficos de linha configuráveis + painel de campos arrastáveis.
  - **Estado** `analyticsLayout: WidgetConfig[]` em `App.jsx` — array de gráficos do dashboard. Cada `WidgetConfig`: `{id, type, x, y, w, h, config:{title, xDimension, metric, serieBy, kpiA?, kpiB?, filters?}}` (`kpiA`/`kpiB` só nos cards `kpi`, 5C; `filters: FilterCard[]` é o filtro de nível visual — ver Filtros). Não tem ref espelho (não usado em event listeners). Auto-init: ao chegar o 1º `analyticsDataset` com layout vazio, cria o gráfico padrão (Taxa de Aprovação × 1ª temporal, série por cenário).
  - **`AnalysisTab`**: layout em 2 colunas — área de gráficos (scroll) + `FieldPanel` à direita. Header com botão **+ Adicionar gráfico**. Funções: `addWidget`, `duplicateWidget(id)`, `removeWidget(id)`, `changeConfig(id, patch)`.
  - **`FieldPanel`**: chips arrastáveis — dimensões (temporais ⏱ primeiro, depois categóricas; `kind:'dim'`) e métricas (`kind:'metric'`). MIME `application/aw-field`.
  - **`AnalyticsWidget`**: card com título editável, botões duplicar (⧉) e remover, barra de 3 `FieldWell` (Eixo X, Métrica, Série) e `LineChart`. Pivot memoizado por `[analyticsDataset, xDimension, metric, serieBy]`.
  - **`FieldWell`**: drop zone (valida `kind` via `accept`) + `<select>` fallback. Destaca ao arrastar.
  - **`pivotWidget(ds, config)`**: `serieBy` aceita `__cenario__` (AS IS vs Simulado), `__none__` (linha única Simulado) ou nome de dimensão (série por valores distintos, teto `MAX_SERIES=12`). Eixo X temporal ordena via `parseTemporalKey`; senão numérico/A-Z.
  - **Métricas disponíveis**: `approvalRate`, `inadReal`, `inadInferida` (pct), `qty`, `approvedQty`, `approvedAltasInfer` (qty — Vol. Vendas Inferidas).
  - **Tabs de navegação**: barra inferior esquerda com "Canvas" e "Dashboard" — padrão ao carregar é Canvas.
- **Sessão 3** (entregue): tipos de gráfico — barras, barras 100% empilhadas e KPI card.
  - **`WidgetConfig.type`**: `"line" | "bar" | "bar100" | "kpi"` — seletor segmentado (📈/📊/🧱/🔢) no header do `AnalyticsWidget`; handler `changeType(id, type)` em `AnalysisTab`.
  - **`bar`**: reusa `pivotWidget`; renderiza `<Bar>` agrupado por série (Recharts `BarChart`).
  - **`bar100`**: normaliza cada bucket do eixo X para somar 100% (memo `stacked100` derivado do pivot), `<Bar stackId>`, eixo Y `[0,100]%`; poço de série rotulado "Composição".
  - **`kpi`**: ignora Eixo X/Série, usa só a Métrica + seletores Baseline (A)/Comparação (B) (5C, DEC-AW-008); `KpiCard` computa A e B sobre todas as linhas via `computeWidgetMetric`; valor grande = B + baseline A + delta `B − A` (pp/qty) colorido por `GOOD_WHEN_LOWER` (`inadReal`/`inadInferida` = menor é melhor). A/B persistidos em `config.kpiA`/`kpiB`; export do dataset largo via **⬇ Exportar CSV** no header.
  - **Constantes**: `CHART_TYPES`, `GOOD_WHEN_LOWER`.
- **Caixas de texto (`type: "text"`)**: além dos gráficos, o `analyticsLayout` aceita
  widgets de **texto livre** para anotar análises e conclusões, renderizados pelo
  componente `TextWidget` (não pelo `AnalyticsWidget` — o `AnalysisTab` faz o branch por
  `w.type === "text"`). `config: {title, text, spellCheck}`. Adicionados pelo botão
  **📝 Adicionar texto** no header. A área de texto usa a **correção automática nativa do
  navegador** (`spellCheck`/`autoCorrect`/`autoCapitalize`, `lang="pt-BR"` — sublinha
  erros e sugere correções no menu de contexto); botão **ABC** liga/desliga (`config.spellCheck`,
  default `true`). Como vive dentro de `analyticsLayout`, já é persistido no Projeto e na
  `sessionStorage` sem mudança de schema.
- **Duplicar widget**: `duplicateWidget(id)` (botão ⧉ no header de gráficos e caixas de
  texto) — cria uma cópia independente com deep clone da `config` (filtros/regras
  desacoplados do original), título com sufixo "(cópia)", offset de +28px em x/y e
  inserida logo após o original na lista.
- **Redimensionamento livre**: `startWidgetInteract` (resize) **não tem teto** de largura/
  altura — o usuário aumenta qualquer widget o quanto quiser; só há um piso por tipo
  (gráfico `340×340`, texto `160×100`) para o card não colapsar.
- **Exportar PDF** (`exportDashboardPDF` em `AnalysisTab`, botão **📄 Exportar PDF** no
  header ao lado do CSV): monta um HTML self-contained numa nova janela e chama
  `window.print()` (→ PDF pelo diálogo nativo do navegador — mesmo padrão de
  `printDocHTML`). Exporta **todos os componentes** do Dashboard na **visão dos filtros
  aplicados**: (1) uma seção de topo com o **filtro da página como um todo** (aplicado a
  todos os componentes) e (2) por componente, o **detalhamento dos filtros efetivos** —
  os filtros da página (aplicados a todos) + os filtros exclusivos daquele visual —
  ambos via `describeFilterCards`. Gráficos são capturados do **DOM vivo** (o `outerHTML`
  do `.recharts-wrapper` — SVG + legenda HTML — localizado por `data-aw-widget-id={w.id}`
  no wrapper de cada widget); KPIs são **recomputados** (`applyFiltersToDataset` +
  `computeWidgetMetric` + `resolveKpiScenarios`, para não capturar os `<select>` do
  card); caixas de texto vêm da `config.text`. Componentes na ordem de layout (Y depois
  X). Botão desabilitado com layout vazio.

## Agrupamentos (dimensões derivadas)

Permitem colapsar uma dimensão de alta cardinalidade (ex.: Faixa Score R01–R20)
em poucas faixas, **criadas uma vez e reutilizáveis em qualquer gráfico** (Eixo X,
Série ou KPI), no export CSV e salvas no projeto. Implementação 100% client-side
(não toca o worker).

- **Estado** `analyticsGroupings: Grouping[]` em `App.jsx` (sessionStorage
  `aw_groupings_v1` + `.credito.json`). Cada `Grouping`:
  `{id, name, source, buckets:[{id, label, values:string[]}], unmatched:'other'|'keep', otherLabel}`.
  `name` é a chave/rótulo da dimensão derivada (não pode colidir com dimensão real
  nem com outro agrupamento). `source` é a dimensão-base.
- **`applyGroupingsToDataset(ds, groupings)`** (helper global exportado): enriquece o
  dataset largo adicionando uma coluna por agrupamento (`out[name] = rótulo do bucket`,
  ou `otherLabel`/valor original para não atribuídos), registra a ordem dos buckets em
  `ds.dimensionOrders[name]` e marca as derivadas em `ds.groupedDimensions`. Pura/no-op
  se não houver agrupamentos válidos. Memoizada em `groupedDataset` no `App`; a aba
  Dashboard consome `groupedDataset`, mas o `GroupingModal` recebe o `analyticsDataset`
  cru como `baseDataset` (lista de dimensões-base e valores distintos).
- **`pivotWidget`** respeita `ds.dimensionOrders` ao ordenar buckets do Eixo X e das
  séries (via `makeCmp`) — assim "R01–R05 < R06–R10 < … < Outros" não vira ordenação
  alfabética. Sem `dimensionOrders`, mantém o comportamento numérico/A-Z anterior.
- **Helpers**: `distinctDimValues(ds, col)` (valores distintos ordenados),
  `autoBuckets(sortedValues, size)` (fatia em faixas de N rotuladas "primeiro–último").
- **UX** — `GroupingModal` (aberto pela seção **Agrupamentos** do `FieldPanel`, botões
  **+ Novo**/✎/✕): nome + dimensão-base + **Gerar faixas** automáticas (tamanho N) +
  edição manual de grupos (renomear/adicionar/remover) + atribuição valor→grupo via
  `<select>` + política de valores fora dos grupos (reunir em "Outros" / manter
  original). Os agrupamentos aparecem como chips 🧩 arrastáveis no `FieldPanel` e com
  prefixo 🧩 nos seletores de Eixo X/Série. Renomear migra as referências
  (`xDimension`/`serieBy`) dos gráficos existentes.
- **Testes**: `tests/analytics.test.js` cobre `autoBuckets`, `distinctDimValues`,
  `applyGroupingsToDataset` (rótulos, ordem, modo keep, colisão de nome, base ausente,
  no-op) e o uso da derivada como Eixo X no `pivotWidget`.

## Filtros (nível página + nível visual)

Dois níveis de filtro sobre o dataset largo, no estilo do painel de filtros do Power
BI, que se combinam por **AND**: o filtro de página restringe a base para todos os
gráficos do Dashboard; o filtro de um visual específico recorta ainda mais em cima do
que já chega filtrado pela página. 100% client-side (não toca o worker).

- **FilterCard**: `{id, dim, mode:'basic'|'advanced', selected: string[]|null, rules: FilterRule[]}`.
  - `dim`: dimensão-alvo (qualquer dimensão real ou agrupamento derivado do dataset largo).
  - Modo **Básico**: lista de valores distintos com checkbox (estilo "seleção básica" do
    Power BI) + busca + Selecionar tudo/Limpar. `selected === null` = todos selecionados
    (cartão inativo até o usuário desmarcar algo); array = lista explícita marcada.
  - Modo **Avançado**: regras AND/OR (`{id, operator, value, logic}`) com os mesmos
    operadores do Decision Lens (`LENS_OPERATORS`), avaliadas via `matchLensRule`.
- **Estado**: `analyticsPageFilters: FilterCard[]` em `App.jsx` (sessionStorage
  `aw_page_filters_v1` + `.credito.json`, seção **Projeto**) — filtro de página, único
  por estudo, editado na seção **🔎 Filtros da Página** do `FieldPanel`. Filtro de
  visual vive em `widget.config.filters: FilterCard[]` (persistido junto do
  `analyticsLayout`), editado no painel **Filtros deste visual** de cada
  `AnalyticsWidget` (ícone 🔎 no header, com badge de contagem).
- **Helpers globais exportados**: `applyAnalyticsFilters(rows, cards)` (filtra linhas
  pelos cartões ativos, AND entre todos os cartões da lista) e
  `applyFiltersToDataset(ds, pageFilters, widgetFilters)` (concatena filtro de página +
  filtro do visual e devolve o dataset largo com `activeRows` (máscara `Int32Array` de
  índices sobreviventes — não copia linhas; Fase 4) restringindo a base; ignora cartões cuja
  dimensão não existe mais no dataset atual — base trocada/agrupamento removido).
- **`FilterCardsEditor`/`FilterCardRow`**: componentes reutilizados nos dois níveis —
  só mudam a lista de cartões e o callback `onChange`.
- **Consumo**: `AnalyticsWidget` computa `filteredDataset = applyFiltersToDataset(analyticsDataset, pageFilters, cfg.filters)`
  e usa esse dataset filtrado tanto no `pivotWidget` (line/bar/bar100) quanto no
  `KpiCard`. Os poços de campo (Eixo X/Métrica/Série) continuam listando dimensões do
  dataset **não filtrado** — só os valores agregados mudam com o filtro.
