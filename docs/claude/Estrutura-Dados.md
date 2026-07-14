# Estrutura de dados (src/App.jsx)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia esta página antes de
> mexer em estado do componente principal, shapes do canvas, csvStore ou nos
> helpers/componentes globais listados abaixo.

### Estado principal
- `shapes`: formas no canvas — tipos: `rect`, `circle`, `diamond`, `decision`, `port`, `approved`, `rejected`, `as_is`, `csv`, `simPanel`, `cineminha`, `decision_lens`, `frame`
- `conns`: conexões/setas entre shapes — `{id, from, to, label?}`
- `csvStore`: `{[csvId]: {name, headers, columns, rowCount, columnTypes, varTypes, asIsConfig}}` (formato colunar — ver "csvStore: entrada por dataset")
- `wizard`: modal de importação em 3 passos — `{file, filename, delimiter, hasHeader, step: 1|2|3, columnTypes, varTypes, asIsVar, asIsMapping, editCsvId, decimalSep, decimalSepConfident, parsedHeaders, parsedColumns, parsedRowCount, previewRows}`. Desde o M1 **não guarda** `rawText` nem `string[][]`: o parse vai direto para colunas dict (`parsedColumns`), o preview é uma amostra de ~100 linhas (`previewRows`) e trocar delimitador/cabeçalho relê o `File` handle (`file`)
- `vp`: viewport — `{x, y, s}` (posição + zoom)
- `axisModal`: modal de seleção de eixo do Cineminha — `null | {shapeId, col, csvId}`
- `optimModal`: modal de otimização do Cineminha (single) — `null | {shapeId, cellMetrics, frontier, scenarios, activeCard, proposedCells, sliderApprovalIdx, sliderInadReal, sliderInadInf, maxInadReal, maxInadInf, matrixZoom, matrixPanX, matrixPanY}`
- `johnnyModal`: otimizador multi-cineminha — `null | {pooledMetrics, frontier, scenarios, mixCats, shapeMetas, baselineApprovalRate, activeCard, proposedByShape, sliderApprovalIdx, sliderInadReal, sliderInadInf, maxInadReal, maxInadInf, activeShapePreview, riskLevels, hierarchyMode, inadMetric}`
- `goalSeekModal`: Goal Seek da política inteira (Copiloto Sessão 4) — `null | {step:'form'|'loading'|'result', goal, constraints, baseline?, frontier?, moves?, goalReached?, bindingConstraint?, result?}` (ver `docs/claude/Copiloto-GoalSeek.md`)
- `simplifyModal`: simplificação com prova de equivalência (Copiloto Sessão 5) — `null | {step:'loading'|'result', proposal, equivalence}` (ver `docs/claude/Copiloto-Simplificacao.md`)
- `docModal`: documentação automática (Copiloto Sessão 6) — `null | {step:'form'|'loading'|'result', includeDomains, compareCanvasId, compareIr?, compareName?, docModel?}` (ver `docs/claude/Copiloto-Documentacao.md`)
- `lensModal`: modal de edição do Decision Lens — `null | {shapeId, rules, population}`
- `incrementalResult`: resultado comparativo AS IS vs. simulado — `null | {baseline, simulated, impacted}`
- ~~`simulationOverlay`~~: **removido** (Otimização de Memória Fase 4). O overlay por-linha (`rowDecisions`, ~1MM objetos) era clonado do worker pra main a cada tick e guardado num estado que **ninguém lia** — fonte de OOM no Canvas. Hoje o worker calcula o `incrementalResult` localmente e **não** envia o overlay; o Dashboard usa seu próprio overlay memoizado (`cachedCanvasOverlay`), independente
- `nodeArrivals`: contagem reativa de registros que chegam a cada nó por valor de domínio (worker, junto do `COMPUTE_OVERLAY`) — `{[nodeId]: {val|row|col: {[valor]: qty}}}` (ver `docs/claude/Dominio-Exibido.md`)
- `domainModal`: modal "Configurar nó" (domínio exibido) — `null | {shapeId, draft:{val?|row?|col?: null|string[]}}`
- `lensCounts`: contagens de população impactada por lens, computadas no worker (M10) e recebidas no `OVERLAY_RESULT` — `{[lensId]: {count, total}}` (ponderadas pelo volume; alimentam o rótulo do nó `decision_lens`). As populações por-linha (`Uint8Array`) vivem só no worker, não na main
- `cinemaLibrary`: biblioteca de configurações de Cineminha salvas localmente — `array`
- `policyLibrary`: biblioteca de templates de PolicyIR (Copiloto Sessão 2) — `array` de `{id, name, description, tags, ir, requiredVars, savedAt}` (ver `docs/claude/Bibliotecas.md`)
- `businessWidget`: widget de impacto de negócio flutuante — `{visible, x, y, w, h}`
- `activeTab`: aba ativa — `"analysis" | "canvas"` (padrão `"canvas"` — aba exibida no label como "Dashboard")
- `analyticsDataset`: dataset analítico largo cacheado do worker (`COMPUTE_ANALYTICS_DATASET`) — `null | AnalyticsDataset` (formato **colunar** desde a Otimização de Memória Fase 4 — ver `docs/claude/Analytics-Workspace.md` / accessors `awColStr`/`awColNum`)
- `analyticsLayout`: gráficos do dashboard da aba Análise — `WidgetConfig[]` (ver `docs/claude/Analytics-Workspace.md`)
- `analyticsGroupings`: agrupamentos (dimensões derivadas) reutilizáveis nos gráficos — `Grouping[]` (ver Agrupamentos, `docs/claude/Analytics-Workspace.md`). `groupedDataset` (useMemo) = `analyticsDataset` enriquecido por `applyGroupingsToDataset` — é o que a aba Dashboard consome
- `analyticsPageFilters`: filtro de página do Dashboard — `FilterCard[]` (ver Filtros, `docs/claude/Analytics-Workspace.md`). Combina por AND com o filtro de cada visual (`widget.config.filters`)
- `canvases`: store multi-canvas (Sub-sessão 5A, DEC-AW-007) — `{[id]: {id, name, shapes, conns, includeInDashboard}}`; `shapes`/`conns` são o **working copy** do canvas ativo
- `activeCanvasId`: ID do canvas ativo
- `renamingCanvasId` / `renameValue` / `canvasTabMenu`: estado UI da barra de abas de canvas

### Tipos de coluna (`COL_TYPES`)
| value          | icon | label              | uso                                              |
|----------------|------|--------------------|--------------------------------------------------|
| `id`           | 🔑   | ID                 | Identificador do registro                        |
| `decision`     | 🔀   | Filtro             | Variável de decisão arrastável ao canvas         |
| `qty`          | 📊   | Vol. Propostas     | Volume total de propostas do agrupamento         |
| `qtdAltas`     | 📈   | Altas Reais        | Volume convertido em vendas/ativações reais      |
| `qtdAltasInfer`| 🔮   | Conv. Inferida     | Conversão estimada pelo modelo de inferência     |
| `inadReal`     | ⚠️   | Inad. Real         | Inadimplência histórica observada                |
| `inadInferida` | 🎯   | Inad. Inferida     | Inadimplência estimada para aprovados            |
| `mixRisco`     | 🎨   | Mix de Risco       | Segmento/categoria de risco (usado no Johnny)    |
| `temporal`     | ⏱   | Data/Tempo         | Coluna de data — eixo cronológico na aba Análise |

### Shape: `decision` (losango)
```js
{
  id, type:"decision", x, y, w, h,
  label,                    // nome da variável
  variableCol: string,      // nome da coluna no CSV
  csvId: string,            // ID do csvStore associado
  visibleVals: null|string[], // "Configurar nó": null = automático (só ports cujo
                              // valor chega ao nó); array = manual (ver Domínio Exibido)
}
```
- Criado ao arrastar chip de variável para área vazia do canvas
- Gera ports automáticos (um por valor distinto, máx. 10) com setas rotuladas
- Ports cujos valores não chegam ao nó são **escondidos** (não-destrutivo) — ver `docs/claude/Dominio-Exibido.md`

### Shape: `cineminha`
```js
{
  id, type:"cineminha", x, y, w, h,
  label: "Cineminha",
  cinemaType: "eligibility" | "offer",  // tipo de Cineminha
  rowVar: null | {col, csvId},          // variável no eixo de linhas
  colVar: null | {col, csvId},          // variável no eixo de colunas
  rowDomain: string[],                  // valores distintos ordenados do eixo linha
  colDomain: string[],                  // valores distintos ordenados do eixo coluna
  cells: { [`${rowVal}|${colVal}`]: boolean },  // true = Elegível (default), false = Não Elegível
  resultVar: null | {col, csvId},       // coluna de resultado para preenchimento automático
  metadata: CinemaMetadata | null,      // metadados de biblioteca (type, identifiers, dimensions, etc.)
  visibleRow: null|string[],            // "Configurar nó" eixo linha (ver Domínio Exibido)
  visibleCol: null|string[],            // "Configurar nó" eixo coluna
  cellsUserEdited: boolean,             // true = usuário mexeu nas caselas (bloqueia a prévia AS IS — ver Prévia AS IS)
}
```
- **Tipo `eligibility`**: ports `"Elegível"` (verde) e `"Não Elegível"` (vermelho)
- **Tipo `offer`**: ports `"Com Oferta"` (azul-claro) e `"Sem Oferta"` (amarelo)
- Chave de célula 1D-linha: `"${rowVal}|*"` / 1D-coluna: `"*|${colVal}"`
- **Prévia AS IS**: ao atribuir uma variável de eixo (`assignCinemaVar`), se as caselas ainda não foram editadas manualmente (`!cellsUserEdited`) e o dataset tem decisão histórica (`__DECISAO_ORIGINAL`), as caselas são pré-preenchidas como *baseline*: caselas com qualquer aprovação AS IS ficam elegíveis; uma casela só fica **não elegível** quando **100% do volume decidido da interseção é REPROVADO** (nenhuma aprovação). Qualquer edição manual (toggle, valor, otimizador, Johnny, biblioteca) grava `cellsUserEdited=true` e passa a sobrescrever a prévia. Persistido junto do shape (via `canvases`, sem bump de schema).
  - **Contextualizada ao nó (worker)**: a prévia respeita os **filtros a montante** (Decision Lens, ports, losangos) — é agregada só sobre a população que **efetivamente chega** a este cineminha pelo grafo de fluxo, não sobre a base completa da interseção. Por isso é computada no worker (`computeCinemaAsIsCells`, mensagem `COMPUTE_ASIS_PREVIEW`), de forma **assíncrona**: `assignCinemaVar` aplica primeiro as caselas herdadas (default elegível) e dispara a mensagem; a resposta `ASIS_PREVIEW_RESULT` substitui as caselas quando chega. Um **token por shape** (`asIsPreviewTokenRef`) descarta respostas obsoletas (reatribuição da variável antes da resposta chegar) e a aplicação é ignorada se o usuário já editou as caselas (`cellsUserEdited`). A regra de derivação é idêntica à de `computeAsIsCells` (mesmo GATE de paridade quando o cineminha é raiz, sem filtro a montante — `tests/asIsPreview.test.js`). Ver `docs/claude/Worker-Protocolo.md` para o detalhe do protocolo.

### Shape: `decision_lens`
```js
{
  id, type:"decision_lens", x, y, w, h,
  label: "Decision Lens",
  rules: LensRule[],        // array de regras lógicas AND/OR
  color: string,
}
```
- Filtra uma sub-população por regras sobre colunas do CSV
- Não tem ports de saída múltiplos — a população que passa vai para o fluxo normal
- Acompanhado por `lensModal` para edição das regras
- `lensPopulations`: mapa `{[lensId]: {[csvId]: boolean[]}}` indexando quais linhas são afetadas
- Detalhe completo (populações M10, fluxo no motor) em `docs/claude/Decision-Lens.md`

### Tipos de terminal
| Tipo | Label | Comportamento |
|------|-------|---------------|
| `approved` | "Aprovado" ✅ | Acumula como aprovado |
| `rejected` | "Reprovado" ❌ | Acumula como reprovado |
| `as_is` | "AS IS" ⟳ | Roteia pela coluna `__DECISAO_ORIGINAL` (preserva decisão histórica) |

### Shape: `frame`
```js
{ id, type:"frame", x, y, w, h, label, color }
```
- Agrupamento visual não-funcional — não afeta a simulação
- Renderizado como retângulo com borda tracejada

### csvStore: entrada por dataset
```js
{
  name,          // nome do arquivo
  headers,       // string[] — inclui '__DECISAO_ORIGINAL' se asIsConfig configurado
  // Formato colunar (Fase 1 — substituiu string[][]): typed arrays por coluna
  columns,       // {[colName]: ColDef} — ver abaixo
  rowCount,      // número de linhas (inteiro)
  // NB: `rows: string[][]` não existe mais na forma nativa; aparece só em arquivos
  // antigos (.credito.json pré-Fase 1) e é migrado por deserializeCsvStore()
  columnTypes,   // {[colName]: COL_TYPE}
  varTypes,      // {[colName]: 'categorical'|'ordinal'}
  asIsConfig,    // null | { col: string, mapping: {[value]: 'APROVADO'|'REPROVADO'|'IGNORAR'} }
  clusterDefs,   // opcional {[col]: ClusterDef} — Variáveis de Cluster derivadas (ver docs/claude/Copiloto-Clusterizacao.md)
}
// ColDef (em src/columnar.js):
//   { kind: 'num', data: Float64Array }  — para colunas métricas (qty, qtdAltas, etc.)
//   { kind: 'dict', dict: string[], codes: Uint8Array|Uint16Array|Int32Array }  — dimensões/decisão
//     (codes = menor typed array pela cardinalidade — dieta de memória H2; ver Fase 1)
```

### Lens Rule
```js
{
  col: string,
  operator: 'equal'|'notEqual'|'in'|'notIn'|'lt'|'lte'|'gt'|'gte',
  value: string,    // valor único ou lista separada por vírgula para 'in'/'notIn'
  logic: 'AND'|'OR' // combinator com a regra seguinte
}
```

### Funções-chave
- `createDecisionNode(col, csvId, wx, wy)`: cria losango de decisão + ports automáticos com setas rotuladas (valores distintos da coluna)
- `createCinemaNode(wx, wy)`: cria nó Cineminha vazio + ports de saída pelo tipo
- `assignCinemaVar(shapeId, col, csvId, axis)`: atribui variável ao eixo `'row'` ou `'col'`, recomputa domínio e reconstrói `cells`
- `toggleCinemaCell(shapeId, cellKey)`: alterna elegibilidade de uma célula
- `deleteShape(id)`: deleta shape + cascade (ports filhos de nós `decision` e `cineminha`)
- `startPanelDrag(e, col, csvId)`: inicia drag de variável do painel para o canvas
- `openOptimModal(shapeId)`: dispara `COMPUTE_OPTIM` no worker → abre modal single-cineminha
- `applyOptimResult(shapeId, proposedCells)`: escreve `proposedCells` de volta no Cineminha e fecha o modal
- `openJohnnyModal(shapeIds)`: dispara `COMPUTE_JOHNNY` no worker → abre modal multi-cineminha
- `applyJohnnyResult(proposedByShape)`: aplica células propostas a múltiplos Cineminhas
- `autoLayout()`: reorganização inteligente do canvas (botão **⊹ Reorganizar**) — ver `docs/claude/Auto-Layout.md`
- `renderConn(conn)`: renderiza seta com label no ponto médio da bezier
- `renderCSVNode(shape)`: tabela interativa minimizável no canvas
- `renderCinemaNode(shape)`: matriz interativa — estado vazio (ícone), 1D ou 2D via `foreignObject`
- `renderDecisionLensNode(shape)`: nó de filtro de população com contagem de linhas afetadas
- `renderSimPanel(shape)`: painel SVG com Taxa de Aprovação, Inad. Real e Inad. Inferida

### Componentes globais (fora do componente principal)
- `BuildBadge`: badge de versão/deploy exibido no header do painel direito — lê as constantes de build injetadas pelo Vite, exibe `#<número> · DD/MM HH:MM`, fica verde se o build tem menos de 5 min, e mostra tooltip com hash, branch e autor ao hover
- `SimIndicators`: exibe indicadores de simulação na sidebar direita — mostra resultado atual + comparativo com baseline AS IS quando disponível (`incrementalResult`)
- `AnalysisTab`: aba Dashboard — layout em 2 colunas (gráficos + `FieldPanel`); funções `addWidget`, `addTextWidget`, `duplicateWidget(id)`, `removeWidget(id)`, `changeConfig(id, patch)`, `changeType(id, type)`
- `FieldPanel({analyticsDataset})`: chips arrastáveis (HTML5 drag, MIME `application/aw-field`) com dimensões e métricas do dataset analítico
- `AnalyticsWidget({widget, analyticsDataset, onConfigChange, onTypeChange, onDelete})`: card de gráfico configurável com `FieldWell`, seletor de tipo (`line`/`bar`/`bar100`/`kpi`) e `LineChart`/`BarChart`/`KpiCard` (Recharts)
- `KpiCard({analyticsDataset, metricId, kpiA, kpiB, onChange})`: indicador pontual comparando dois cenários (DEC-AW-008) — seletores Baseline (A) e Comparação (B) aceitam qualquer cenário (incl. AS IS); valor grande = B, baseline = A, delta `B − A` colorido pela direção da métrica (`GOOD_WHEN_LOWER`). A/B persistidos em `config.kpiA`/`kpiB`; default via `resolveKpiScenarios`
- `FieldWell`: drop zone para campos — valida `kind` via `accept`; destaca ao arrastar por cima

### Helpers globais (fora do componente)
- `sortDomain(values)`: ordena domínio — numérico crescente ou A-Z (locale pt-BR)
- `computeCinemaSize(rowDomain, colDomain)`: calcula `{w, h}` do nó a partir dos domínios (caps: 540×420)
- `fmtQty(n)`: formata número como inteiro, `k` ou `M`
- `fmtPct(v)`: formata ratio como `"XX.XX%"` ou `"N/A"` quando `v === null`
- `fmtMetricVal(v, unit)`: formata `qty` via `fmtQty`, demais como `XX.XX%` — usado no Analytics Workspace
- `parseTemporalKey(str)`: converte valor de coluna temporal (ISO, formato BR, compacto, **SAS `DDMONYYYY` como `10MAI2026`**, etc.) em milissegundos UTC para ordenação cronológica no eixo X dos gráficos. Suporta abreviações de mês em PT-BR (MAI, ABR, AGO, SET, OUT, DEZ, FEV) e EN.
- `computeCellMetrics(shape, csvStore)`: agrega métricas do CSV por célula do Cineminha → `{[cellKey]: {qty, qtdAltas, qtdAltasInfer, inadRRaw, inadIRaw, inadReal, inadInferida}}`
- `buildParetoFrontier(cellMetrics)`: ordena células por `inadInferida` crescente e varre acumulando pontos da fronteira Pareto → array de pontos
- `extractScenarios(frontier)`: extrai 4 pontos representativos → `{conservador, balanceado, melhorEficiencia, expansao}` onde `melhorEficiencia` é o joelho da curva
- `isCellEligible(cells, key)`: retorna `true` se a célula está elegível (considera `null`/`true` como elegível, `false` como não elegível)
- `computeAsIsCells(shape, csvStore)`: deriva a prévia de elegibilidade das caselas a partir da decisão histórica AS IS (`__DECISAO_ORIGINAL`) — agrega volume aprovado/reprovado por interseção `rowVal|colVal` **sobre a base completa** (sem roteamento); casela = `1` (elegível) se há qualquer aprovação, `0` só quando 100% do volume decidido é REPROVADO. Retorna `null` sem AS IS. Exportada do `App.jsx`. Usada no botão **↺ Resgatar AS IS** do Johnny (contexto pooled) e como valor de controle do GATE de paridade da prévia contextualizada. A prévia do `assignCinemaVar` **não** usa mais esta função (migrou para o worker — ver `computeCinemaAsIsCells` / Prévia AS IS)
- `suggestVarType(colName, values)`: heurística para sugerir `ordinal` ou `categorical`
- `suggestMetricColumns(headers)`: heurística para mapear nomes de colunas aos tipos de métrica
- `detectDelimiter(text)`: detecta separador CSV com score de confiança
- `detectDecimalSep(text, delimiter)`: detecta separador decimal (`,` ou `.`)
- `matchLensRule(cellVal, operator, ruleVal)`: avalia uma regra de Decision Lens contra um valor de célula
- `computeLensPopulation(rules, csvStore)`: calcula `{count, total}` ponderado por volume — usado só no preview síncrono do `lensModal` ao editar regras (o rótulo do nó `decision_lens` usa `lensCounts`, vindo do worker via M10)
- `buildFlowGraph(shapes, conns)`: constrói lista de adjacências do grafo de fluxo para o motor de simulação e `autoLayout`
- `buildPolicyIR(shapes, conns, csvStore, opts?)`: deriva o **PolicyIR** (JSON canônico da política — Copiloto Sessão 0, DEC-IA-002) do canvas — ver `docs/claude/Copiloto-PolicyIR.md`
- `applyPolicyPatch(patch, base?)`: materializa um patch de PolicyIR de volta em `{shapes, conns, idMap}` (IDs via contador `_id`/`uid()` existente) — ver `docs/claude/Copiloto-PolicyIR.md`
- `extractPolicyRequiredVars(ir)` / `applyPolicyVarMapping(ir, mapping)`: variáveis exigidas por um PolicyIR (uma por nome distinto) e remapeamento delas antes de `applyPolicyPatch` — Copiloto Sessão 2, ver `docs/claude/Bibliotecas.md`
- `normalizeColName(s)`: normaliza nome de coluna para comparação fuzzy
- `exportDiagnosticCSV(shapes, conns, csvStore)`: gera CSV de auditoria com métricas de funil por nó+valor (aprovação, volume, inadimplência) para diagnóstico da política
- `pivotWidget(ds, config)`: pivot client-side genérico → `{state, data, series, metricDef, xCol, truncated}`; usado pelos gráficos do Analytics Workspace
- `resolveKpiScenarios(scenarios, kpiA, kpiB)`: resolve os cenários Baseline (A) e Comparação (B) do KPI a partir dos ids salvos no `WidgetConfig`, com fallback retrocompatível (A=AS IS, B=1º canvas; DEC-AW-008)
- `buildAnalyticsCSV(ds)` / `exportAnalyticsDatasetCSV(ds)`: serializa/baixa o dataset analítico largo como CSV (dimensões + métricas intrínsecas + uma coluna de decisão por cenário, incl. AS IS), com BOM e escape RFC 4180 — abrível no Excel (5C)
- `describeFilterCards(cards, dataset)`: helper global exportado (puro) — descreve, em texto legível, cada `FilterCard` **ativo** de uma lista (filtro de página ou de visual). Retorna `[{dim, mode:'basic'|'advanced', text, values?, total?}]` (cartões inativos omitidos): modo básico lista os valores marcados + `N de M` distintos (via `distinctDimValues`); modo avançado usa os rótulos de `LENS_OPERATORS` + conector E/OU. Base do detalhamento de filtros no **Exportar PDF** do Dashboard. Testado em `tests/analytics.test.js`
- `computeWidgetMetric(ds, indices, metricId, decisionCol)`: agrega 1 métrica sobre um conjunto de linhas do dataset largo **colunar** (`indices`: `Int32Array|number[]|null`, null = todas as linhas ativas), replicando a semântica do motor (numeradores acumulados só sobre `APROVADO`). Suporta `approvedAltasInfer` (∑ qtdAltasInfer sobre aprovados = Vol. Vendas Inferidas)

## Fluxo do simulador
1. Importar CSV → Passo 1 (delimitador) → Passo 2 (classificar colunas) → Passo 3 (variável AS IS)
2. Colunas **Filtro** aparecem como chips arrastáveis no painel direito
3. Arrastar chip para área vazia do canvas → losango com ports automáticos (até 10 valores)
4. Arrastar chip sobre um ⊞ Cineminha → modal "Linha ou Coluna?" → matriz cruzada
5. Conectar ports a outros nós ou a ✅ Aprovado / ❌ Reprovado / ⟳ AS IS
6. Duplo-clique em seta → editar label
7. Painel de simulação atualiza Taxa de Aprovação, Inad. Real e Inad. Inferida em tempo real

## Constantes do Cineminha
```js
CINEMA_CELL_W  = 70   // largura de cada célula da matriz
CINEMA_CELL_H  = 30   // altura de cada célula
CINEMA_TITLE_H = 38   // altura da barra de título (drag handle)
CINEMA_HDR_H   = 32   // altura do cabeçalho de colunas (modo 2D)
CINEMA_LBL_W   = 84   // largura da coluna de rótulos de linha
CINEMA_PAD     = 12   // padding interno
CINEMA_MAX_W   = 540  // largura máxima do nó
CINEMA_MAX_H   = 420  // altura máxima do nó
```

## Painel de Simulação (`simPanel`)
- Tamanho padrão: `w: 260, h: 280`
- Exibe três indicadores:
  1. **Taxa de Aprovação** — número grande + barra de progresso + contadores ✅/❌/⟳
  2. **Inad. Real** — `∑ Inad.Real / ∑ Altas aprovadas`; cor vermelha > 5%, laranja ≤ 5%, cinza = N/A
  3. **Inad. Inferida** — `∑ Inad.Inferida / Vol. Conv. Inferida` (fallback: `/Vol. Aprovado`); mesma escala de cor
- Sidebar direita espelha os três indicadores com recalculo reativo + comparativo AS IS quando disponível

## Engine de simulação
- `validateFlow`: inclui `cineminha` e `decision_lens` no conjunto de nós de fluxo válidos; DFS para detecção de ciclos
- `runSimulation` / `traverseRow`: para nós `cineminha`, faz lookup em `cells` com a chave `${rowVal}|${colVal}` e roteia para o port pelo `cinemaType`; para nós `decision_lens`, avalia `rules` contra a linha; para nós `as_is`, lê `__DECISAO_ORIGINAL`
- Para cada linha aprovada, acumula `inadRealSum`, `qtdAltasSum`, `qtdAltasInferSum` e `inadInferidaSum`
- Retorna `{ totalQty, approvedQty, rejectedQty, asIsQty, approvalRate, inadReal, inadInferida, edgeStats }`
  - `inadReal = ∑ inadRRaw / ∑ qtdAltas` (null se qtdAltasSum = 0)
  - `inadInferida = ∑ inadIRaw / ∑ qtdAltasInfer` (fallback: `/ approvedQty` se qtdAltasInferSum = 0)
- Reconciliação de dataset (`onImportConfirm`): ao trocar CSV, o sistema faz match normalizado de variáveis em nós `cineminha`, recomputa domínios e preserva os estados de elegibilidade existentes

### Padrão de refs
Toda variável de estado crítica tem um ref espelho para uso em event listeners sem closure stale — regra e lista completa de refs em `CLAUDE.md` § "Padrão de refs" (fica no índice enxuto por ser regra transversal).
