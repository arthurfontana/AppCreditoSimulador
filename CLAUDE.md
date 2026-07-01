# AppCreditoSimulador

## Stack
- React + Vite, arquivo único: `src/App.jsx` (~10670 linhas)
- Sem CSS externo — tudo inline styles
- SVG puro para o canvas; matrizes interativas via `foreignObject` (sem biblioteca de diagramas)
- **Recharts** para gráficos na aba Dashboard (exceção pontual ao ADR-003 — ver `DEC-AW-001`)
- Web Worker (`src/simulation.worker.js`, ~1357 linhas) para cálculos pesados fora da thread principal
- **`src/columnar.js`**: módulo de armazenamento colunar do `csvStore` (otimização de memória — Fases 0, 1, 2)
- **Vitest** para testes (`tests/*.test.js`, jsdom) — `npm test`

## O que é
Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos ou matrizes cruzadas (Cineminha) e monta um fluxo de política de crédito. O painel de simulação exibe taxa de aprovação e indicadores de inadimplência em tempo real, comparando com a política atual (AS IS).

## Estrutura de arquivos

```
AppCreditoSimulador/
├── src/
│   ├── App.jsx                   # Componente único — ~10670 linhas
│   ├── simulation.worker.js      # Web Worker: simulação, overlay, Pareto, Johnny (~1357 linhas)
│   ├── columnar.js               # Armazenamento colunar do csvStore (typed arrays + dictionary encoding)
│   └── main.jsx                  # Entry point React
├── tests/                        # Vitest (jsdom)
│   ├── analytics.test.js         # autoBuckets, distinctDimValues, applyGroupingsToDataset, pivotWidget
│   ├── columnar.test.js          # GATE colunar: accessor, round-trip projeto, SharedArrayBuffer
│   ├── inferenceCascade.test.js  # GATE: cascata da Tabela de Inferência sobre amostra real
│   └── inferenceRef.test.js      # indexInferenceRef + round-trip serialize/deserialize
├── docs/
│   ├── HANDOFF.md                # Documento de handoff para desenvolvimento corporativo
│   └── wiki/                     # Documentação sincronizada com GitHub Wiki
│       ├── Arquitetura.md
│       ├── Epicos-*.md
│       ├── Otimizacao-Memoria.md # Plano de otimização de memória para datasets grandes
│       ├── Roadmap.md
│       ├── Decisoes.md
│       └── _Sidebar.md
├── release/                      # Artefato de build (commitado via CI)
│   ├── index.html
│   ├── assets/
│   ├── iniciar.bat               # Abre a aplicação no navegador (Windows)
│   └── ...
├── .github/workflows/
│   ├── build-release.yml         # Build automático em push para main → commit em release/
│   └── sync-wiki.yml             # Sincroniza docs/wiki/ com o GitHub Wiki
├── vite.config.js                # Build config + injeção de metadados de build
├── package.json
└── index.html
```

## Estrutura de dados (src/App.jsx)

### Estado principal
- `shapes`: formas no canvas — tipos: `rect`, `circle`, `diamond`, `decision`, `port`, `approved`, `rejected`, `as_is`, `csv`, `simPanel`, `cineminha`, `decision_lens`, `frame`
- `conns`: conexões/setas entre shapes — `{id, from, to, label?}`
- `csvStore`: `{[csvId]: {name, headers, rows, columnTypes, varTypes, asIsConfig}}`
- `wizard`: modal de importação em 3 passos — `{rawText, filename, delimiter, hasHeader, step: 1|2|3, columnTypes, varTypes, asIsVar, asIsMapping, editCsvId, decimalSep, decimalSepConfident}`
- `vp`: viewport — `{x, y, s}` (posição + zoom)
- `axisModal`: modal de seleção de eixo do Cineminha — `null | {shapeId, col, csvId}`
- `optimModal`: modal de otimização do Cineminha (single) — `null | {shapeId, cellMetrics, frontier, scenarios, activeCard, proposedCells, sliderApprovalIdx, sliderInadReal, sliderInadInf, maxInadReal, maxInadInf, matrixZoom, matrixPanX, matrixPanY}`
- `johnnyModal`: otimizador multi-cineminha — `null | {pooledMetrics, frontier, scenarios, mixCats, shapeMetas, baselineApprovalRate, activeCard, proposedByShape, sliderApprovalIdx, sliderInadReal, sliderInadInf, maxInadReal, maxInadInf, activeShapePreview, riskLevels, hierarchyMode, inadMetric}`
- `lensModal`: modal de edição do Decision Lens — `null | {shapeId, rules, population}`
- `incrementalResult`: resultado comparativo AS IS vs. simulado — `null | {baseline, simulated, impacted}`
- `simulationOverlay`: mapa de decisões por linha — `null | {[csvId]: {rowDecisions, summaryStats}}`
- `nodeArrivals`: contagem reativa de registros que chegam a cada nó por valor de domínio (worker, junto do overlay) — `{[nodeId]: {val|row|col: {[valor]: qty}}}` (ver Domínio Exibido)
- `domainModal`: modal "Configurar nó" (domínio exibido) — `null | {shapeId, draft:{val?|row?|col?: null|string[]}}`
- `lensPopulations`: populações filtradas por cada lens — `{[lensId]: {[csvId]: boolean[]}}`
- `cinemaLibrary`: biblioteca de configurações de Cineminha salvas localmente — `array`
- `businessWidget`: widget de impacto de negócio flutuante — `{visible, x, y, w, h}`
- `activeTab`: aba ativa — `"analysis" | "canvas"` (padrão `"canvas"` — aba exibida no label como "Dashboard")
- `analyticsDataset`: dataset analítico largo cacheado do worker (`COMPUTE_ANALYTICS_DATASET`) — `null | AnalyticsDataset`
- `analyticsLayout`: gráficos do dashboard da aba Análise — `WidgetConfig[]` (ver Analytics Workspace)
- `analyticsGroupings`: agrupamentos (dimensões derivadas) reutilizáveis nos gráficos — `Grouping[]` (ver Agrupamentos). `groupedDataset` (useMemo) = `analyticsDataset` enriquecido por `applyGroupingsToDataset` — é o que a aba Dashboard consome
- `analyticsPageFilters`: filtro de página do Dashboard — `FilterCard[]` (ver Filtros). Combina por AND com o filtro de cada visual (`widget.config.filters`)
- `canvases`: store multi-canvas (Sub-sessão 5A, DEC-AW-007) — `{[id]: {id, name, shapes, conns, includeInDashboard}}`; `shapes`/`conns` são o **working copy** do canvas ativo
- `activeCanvasId`: ID do canvas ativo
- `renamingCanvasId` / `renameValue` / `canvasTabMenu`: estado UI da barra de abas de canvas
- `inferenceRef`: tabela de referência de inferência de negados, indexada uma vez na importação (Fase 1; ver Inferência de Negados) — `null | InferenceRefIndex`
- `infRefError`: erro de importação da Tabela de Inferência — `null | string`

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
- Ports cujos valores não chegam ao nó são **escondidos** (não-destrutivo) — ver Domínio Exibido

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
}
```
- **Tipo `eligibility`**: ports `"Elegível"` (verde) e `"Não Elegível"` (vermelho)
- **Tipo `offer`**: ports `"Com Oferta"` (azul-claro) e `"Sem Oferta"` (amarelo)
- Chave de célula 1D-linha: `"${rowVal}|*"` / 1D-coluna: `"*|${colVal}"`

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
  inferenceConfig, // { source:'columns'|'ref', keyMap:{[refKeyCol]:baseCol}, weightCol, weightMode:'propostas'|'aprovados', normalizeScore } — origem da inferência (ver Inferência de Negados)
}
// ColDef (em src/columnar.js):
//   { kind: 'num', data: Float64Array }  — para colunas métricas (qty, qtdAltas, etc.)
//   { kind: 'dict', dict: string[], codes: Int32Array }  — para dimensões/decisão
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
- `autoLayout()`: reorganização inteligente do canvas (botão **⊹ Reorganizar**) — ver seção "Reorganização Automática (Auto Layout)"
- `renderConn(conn)`: renderiza seta com label no ponto médio da bezier
- `renderCSVNode(shape)`: tabela interativa minimizável no canvas
- `renderCinemaNode(shape)`: matriz interativa — estado vazio (ícone), 1D ou 2D via `foreignObject`
- `renderDecisionLensNode(shape)`: nó de filtro de população com contagem de linhas afetadas
- `renderSimPanel(shape)`: painel SVG com Taxa de Aprovação, Inad. Real e Inad. Inferida

### Componentes globais (fora do componente principal)
- `BuildBadge`: badge de versão/deploy exibido no header do painel direito — lê as constantes de build injetadas pelo Vite, exibe `#<número> · DD/MM HH:MM`, fica verde se o build tem menos de 5 min, e mostra tooltip com hash, branch e autor ao hover
- `SimIndicators`: exibe indicadores de simulação na sidebar direita — mostra resultado atual + comparativo com baseline AS IS quando disponível (`incrementalResult`)
- `InferenceSignal({source, confiabVolume, weightMode, scale})`: sinalização da inferência por referência (Fase 3, refinada na Fase 4) — selo de origem + **selo de base de peso** (⚖️ Propostas/Aprovados/Misto, ver Toggle de Peso) + indicador "% do volume inferido com confiab ALTA" com barra empilhada, **legenda das faixas** e alerta em dois níveis (⚡ atenção 50–80% / ⚠ alerta <50%). Renderizado no `renderSimPanel` e no `businessWidget` (ver Sinalização de Confiabilidade)
- `AnalysisTab`: aba Dashboard — layout em 2 colunas (gráficos + `FieldPanel`); funções `addWidget`, `removeWidget(id)`, `changeConfig(id, patch)`, `changeType(id, type)`
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
- `suggestVarType(colName, values)`: heurística para sugerir `ordinal` ou `categorical`
- `suggestMetricColumns(headers)`: heurística para mapear nomes de colunas aos tipos de métrica
- `detectDelimiter(text)`: detecta separador CSV com score de confiança
- `detectDecimalSep(text, delimiter)`: detecta separador decimal (`,` ou `.`)
- `matchLensRule(cellVal, operator, ruleVal)`: avalia uma regra de Decision Lens contra um valor de célula
- `computeLensPopulation(rules, csvStore)`: calcula `{[csvId]: boolean[]}` — quais linhas de cada CSV passam pelas regras do lens
- `computeLensAffectedRows(lensId, csvStore, lensPopulations)`: retorna contagem de linhas afetadas pelo lens (para exibição no nó `decision_lens`)
- `buildFlowGraph(shapes, conns)`: constrói lista de adjacências do grafo de fluxo para o motor de simulação e `autoLayout`
- `normalizeColName(s)`: normaliza nome de coluna para comparação fuzzy
- `exportDiagnosticCSV(shapes, conns, csvStore, simulationOverlay)`: gera CSV de auditoria com métricas de funil por nó+valor (aprovação, volume, inadimplência) para diagnóstico da política
- `pivotWidget(ds, config)`: pivot client-side genérico → `{state, data, series, metricDef, xCol, truncated}`; usado pelos gráficos do Analytics Workspace
- `resolveKpiScenarios(scenarios, kpiA, kpiB)`: resolve os cenários Baseline (A) e Comparação (B) do KPI a partir dos ids salvos no `WidgetConfig`, com fallback retrocompatível (A=AS IS, B=1º canvas; DEC-AW-008)
- `buildAnalyticsCSV(ds)` / `exportAnalyticsDatasetCSV(ds)`: serializa/baixa o dataset analítico largo como CSV (dimensões + métricas intrínsecas + uma coluna de decisão por cenário, incl. AS IS), com BOM e escape RFC 4180 — abrível no Excel (5C)
- `computeWidgetMetric(rows, metricId, decisionCol)`: agrega 1 métrica sobre linhas do dataset largo, replicando a semântica do motor (numeradores acumulados só sobre `APROVADO`). Suporta `approvedAltasInfer` (∑ qtdAltasInfer sobre aprovados = Vol. Vendas Inferidas)

### Padrão de refs
Toda variável de estado crítica tem um ref espelho para uso em event listeners sem closure stale. Em todo `setX(...)`, o ref correspondente é atualizado imediatamente.

Refs existentes: `vpR`, `shapesR`, `connsR`, `toolR`, `fromIdR`, `editR`, `csvStoreR`, `inferenceRefR`, `activeCellR`, `panelDragR`, `editConnR`, `axisModalR`, `multiSelR`, `selRectR`, `selR`, `undoStackR`, `redoStackR`, `lensModalR`, `johnnyModalR`, `lensPopulationsR`, `businessWidgetR`, `cinemaLibraryR`, `canvasesR`, `activeCanvasIdR`.

## Reorganização Automática (Auto Layout)

`autoLayout()` (botão **⊹ Reorganizar** na toolbar) é um layout em camadas estilo Sugiyama, sempre **horizontal (esquerda → direita)** porque as portas saem sempre pelo lado direito do nó.

### Classificação dos nós
- **Portas** (`type:'port'`): nunca entram no grafo de camadas; são posicionadas como filhas do nó dono.
- **Nós de fluxo**: parents que possuem ao menos uma aresta (via porta) para **outro** parent.
- **Parqueados** (área lateral): `csv` e `simPanel` (sempre, definidos em `NON_FLOW`) + fragmentos isolados (sem nenhuma conexão a outro parent). Um nó alcançado por uma porta do fluxo deixa de ser isolado e entra no fluxo.

### Conceito de *cluster*
Cada parent + sua coluna de portas forma um cluster:
- `clusterW = w + (PORT_GAP_X + maxPortW)` → a largura da coluna inclui as portas, então a próxima camada nunca sobrepõe as portas.
- `clusterH = max(h, somatório das alturas das portas + gaps)` → o empilhamento vertical reserva espaço para a pilha de portas.

### Pipeline
1. **Camadas**: longest-path a partir das fontes (Kahn). Ciclos → fallback camada 0.
2. **Redução de cruzamentos**: ordenação por baricentro (8 sweeps alternando ↓/↑).
3. **X por camada**: cumulativo, somando `clusterW` + `GAP_X`.
4. **Y por nó**: regressão isotônica (PAVA) puxando cada nó para o baricentro dos vizinhos, mantendo ordem e gap mínimo (16 sweeps alternando ↓ usa predecessores / ↑ usa sucessores). Garante alinhamento lógico filho↔pai sem sobreposição.

### Portas
Sempre à **direita** do nó (`x = parent.x + w + PORT_GAP_X`), empilhadas e centradas verticalmente no nó, ordenadas pelo Y do destino downstream (reduz cruzamento das setas).

### Área de parking
À direita de todo o fluxo (`flowRight + PARK_GAP_X`), empilhada **verticalmente** com gaps uniformes (`PARK_GAP_Y`), alinhada à esquerda. Portas de nós parqueados também ficam à direita deles.

### Consciência dos "balões" das arestas (edge labels)
Cada aresta renderiza, no ponto médio da bezier, um **balão**: a caixa do label do domínio (altura 20) + (com a simulação rodando) o chip de `volume · inad.real · inad.inferida` empilhado logo abaixo (altura 14). Como o balão fica no **ponto médio**, arestas que saem de um mesmo nó têm seus balões a **meio passo vertical** de distância — se os nós ficam colados, os balões se sobrepõem.

`autoLayout` mede cada balão (`balloonOf` espelha a lógica de `renderConn`, respeitando os toggles `showEdgeVol/InadReal/InadInf` e o `simResult.edgeStats` atuais via refs) e infla os vãos:
- **`portGapY[node]` (vertical, por nó)**: o passo entre portas empilhadas (`pt.h + portGapY`) é forçado a ≥ `2 × (maiorBalãoIncidente + BALLOON_VPAD)`, porque o balão nó→port fica a meio passo. Cobre o leque saindo do losango e o funil entrando em Aprovado/Reprovado.
- **`portGapX[node]` (horizontal, por nó)**: agora dimensionado pela **largura do balão** (label OU chip de analytics, o que for mais largo), não só pelo label.
- **`gapX` (entre camadas)**: `max(GAP_X, maiorBalãoW + BALLOON_HPAD)` — o balão port→nó cabe no vão entre camadas.
- **`gapY` (entre clusters)**: `max(GAP_Y, maiorBalãoH + BALLOON_VPAD)`.

Sem labels/simulação (`balloonH = 0`), tudo recai nos valores-piso e o comportamento é o de antes.

### Constantes (locais em `autoLayout`)
`ORIGIN_X/Y=80`, `PORT_GAP_X_MIN=96`, `PORT_GAP_X_MAX=260`, `PORT_GAP_Y=16` (piso), `GAP_X=96` (piso), `GAP_Y=36` (piso), `PARK_GAP_X=160`, `PARK_GAP_Y=44`, `BALLOON_VPAD=6`, `BALLOON_HPAD=18`. `PORT_GAP_Y`/`GAP_X`/`GAP_Y` viram pisos; os valores efetivos (`portGapY`/`gapX`/`gapY`) crescem com os balões. Animação via RAF (`DURATION=600`, easeInOut), com `pushHistory()` antes de aplicar.

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

## Web Worker — Protocolo de Mensagens

O arquivo `src/simulation.worker.js` recebe mensagens via `postMessage` e responde de forma assíncrona.

### Mensagens de entrada
| type | payload | O que faz |
|------|---------|-----------|
| `UPDATE_CSV_STORE` | `{csvStore}` | Atualiza o cache do csvStore no worker (evita re-serialização a cada tick) |
| `UPDATE_INFERENCE_REF` | `{inferenceRef}` | Espelha o índice da Tabela de Inferência no worker (Fase 2); usado pelo lookup em cascata quando `inferenceConfig.source==='ref'` |
| `RUN_SIMULATION` | `{shapes, conns}` | Roda `runSimulation` e responde com `SIMULATION_RESULT` |
| `COMPUTE_OVERLAY` | `{shapes, conns, lensPopulations}` | Roda `computeSimulatedDecisions` + `computeIncrementalResult` + `computeNodeArrivals`; responde com `OVERLAY_RESULT` |
| `COMPUTE_OPTIM` | `{shape}` | Roda `computeCellMetrics` + `buildParetoFrontier` + `extractScenarios`; responde com `OPTIM_RESULT` |
| `COMPUTE_JOHNNY` | `{shapes, cinemaIds, conns, lensPopulations, riskLevels?, hierarchyMode?, inadMetric?}` | Roda `computeCinemaArrivals` + `computeJohnnyData` com greedy+precedência; responde com `JOHNNY_RESULT` |
| `COMPUTE_ANALYTICS_DATASET` | `{canvases}` | `canvases: [{id, nome, shapes, conns, lensPopulations}]` — abas marcadas (cenários, 5B). Roda `computeAnalyticsDataset`; responde com `ANALYTICS_RESULT` |

### Mensagens de saída
| type | payload |
|------|---------|
| `SIMULATION_RESULT` | `{result: SimulationResult}` — inclui `inferenceSource` e `confiabVolume` (Fase 3) + `inferenceWeightMode` (Fase 4) |
| `OVERLAY_RESULT` | `{overlay, incrementalResult, nodeArrivals}` — `nodeArrivals: {[nodeId]: {val\|row\|col: {[valor]: qty}}}` (ver Domínio Exibido) |
| `OPTIM_RESULT` | `{shapeId, cellMetrics, frontier, scenarios, maxInadReal, maxInadInf}` |
| `JOHNNY_RESULT` | `{pooledMetrics, frontier, scenarios, mixCats, shapeMetas, baselineApprovalRate, maxInadReal, maxInadInf}` ou `{error: 'no_data'}` |
| `ANALYTICS_RESULT` | `{dataset: AnalyticsDataset \| null}` — formato largo (DEC-AW-003): `{rows, dimensions, temporalColumns, metrics, scenarios}` |

### Funções no worker
- `runSimulation(shapes, conns, csvStore)`: percorre todas as linhas de todos os CSVs pelo grafo, acumula métricas e retorna `SimulationResult`
- `computeSimulatedDecisions(shapes, conns, csvStore, lensPopulations)`: compara decisão simulada vs. `__DECISAO_ORIGINAL` por linha
- `computeIncrementalResult(overlay, csvStore)`: agrega `baseline`, `simulated` e `impacted` a partir do overlay
- `computeCellMetrics(shape, csvStore)`: agrega métricas por célula do Cineminha
- `buildParetoFrontier(cellMetrics)`: fronteira Pareto greedy (sort por `inadInferida` crescente)
- `extractScenarios(frontier)`: `{conservador, balanceado, melhorEficiencia, expansao}` — `melhorEficiencia` é o joelho da curva
- `computeCinemaArrivals(shapes, conns, csvStore, lensPopulations)`: percorre o grafo de fluxo linha a linha e retorna `{[shapeId]: {[cellKey]: {qty, qtdAltas, qtdAltasInfer, inadRRaw, inadIRaw, mix}}}` — métricas filtradas pelas linhas que efetivamente chegam a cada Cineminha via roteamento (respeita losangos, decision_lens e ports a montante)
- `computeNodeArrivals(shapes, conns, csvStore, lensPopulations)`: percorre o fluxo a partir das entradas reais (in-degree 0 sobre arestas de fluxo — exclui corretamente um cineminha logo abaixo de um Decision Lens) e retorna, por nó, a contagem de registros por valor de domínio: `decision → {val: {[valor]: qty}}`, `cineminha → {row, col}`. Base do "Configurar nó" — ver Domínio Exibido
- `computeJohnnyData(allShapes, cinemaIds, conns, csvStore, lensPopulations, riskLevels, hierarchyMode, inadMetric)`: greedy com restrição de precedência (DEC-JO-003/004) — constrói grafo de precedência com (a) monotonicidade interna por eixo ordinal e (b) aninhamento de cascata entre níveis de risco; a cada passo abre a célula liberada de menor inadimplência suavizada (shrinkage bayesiano); modo `independente` aplica só monotonicidade interna
- `computeAnalyticsDataset(canvasInputs, csvStore)`: recebe N abas marcadas (`[{id, nome, shapes, conns, lensPopulations}]`), roda `computeSimulatedDecisions` por canvas (overlay memoizado via `cachedCanvasOverlay`), faz **join por `(csvId, rowIdx)`** e emite o dataset analítico **largo** (dimensões + métricas intrínsecas + `__DECISAO_AS_IS` global + uma coluna `__DECISAO_<canvasId>` por cenário); `scenarios` = AS IS + uma entrada por aba (nome = nome da aba) — ver Analytics Workspace
- `cachedCanvasOverlay(canvasId, shapes, conns, lensPopulations)`: overlay por canvas memoizado por hash de `shapes`/`conns`/`lensPopulations` + `csvStoreVersion` (não reprocessa canvases intocados ao editar um só)

## Analytics Workspace (aba Dashboard)

Segunda aba da aplicação (`activeTab: "analysis"`, label exibido: "Dashboard") — builder de dashboards sobre os resultados da simulação. A aba padrão ao carregar é `"canvas"`. Ver `docs/wiki/Epicos-AnalyticsWorkspace.md`.

- **Pipeline (DEC-AW-002)**: worker emite `analyticsDataset` (formato largo, DEC-AW-003) via `COMPUTE_ANALYTICS_DATASET`, debounced junto com a simulação; cada gráfico faz pivot client-side.
- **Tipo `temporal` (DEC-AW-005)**: marcado no Passo 2 do wizard (toggle de 3 estados Categórica → Ordinal → ⏱ Temporal, grava `columnTypes[col]='temporal'`). `parseTemporalKey(str)` deriva a chave de ordenação cronológica.
- **Sessão 1** (entregue): pipeline ponta a ponta com um gráfico de linha fixo (Recharts, DEC-AW-001).
- **Sessão 2** (entregue): builder de dashboard configurável — gráficos de linha configuráveis + painel de campos arrastáveis.
  - **Estado** `analyticsLayout: WidgetConfig[]` em `App.jsx` — array de gráficos do dashboard. Cada `WidgetConfig`: `{id, type, x, y, w, h, config:{title, xDimension, metric, serieBy, kpiA?, kpiB?, filters?}}` (`kpiA`/`kpiB` só nos cards `kpi`, 5C; `filters: FilterCard[]` é o filtro de nível visual — ver Filtros). Não tem ref espelho (não usado em event listeners). Auto-init: ao chegar o 1º `analyticsDataset` com layout vazio, cria o gráfico padrão (Taxa de Aprovação × 1ª temporal, série por cenário).
  - **`AnalysisTab`**: layout em 2 colunas — área de gráficos (scroll) + `FieldPanel` à direita. Header com botão **+ Adicionar gráfico**. Funções: `addWidget`, `removeWidget(id)`, `changeConfig(id, patch)`.
  - **`FieldPanel`**: chips arrastáveis — dimensões (temporais ⏱ primeiro, depois categóricas; `kind:'dim'`) e métricas (`kind:'metric'`). MIME `application/aw-field`.
  - **`AnalyticsWidget`**: card com título editável, botão remover, barra de 3 `FieldWell` (Eixo X, Métrica, Série) e `LineChart`. Pivot memoizado por `[analyticsDataset, xDimension, metric, serieBy]`.
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

### Agrupamentos (dimensões derivadas)

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

### Filtros (nível página + nível visual)

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
  filtro do visual e devolve o dataset largo com `rows` filtradas; ignora cartões cuja
  dimensão não existe mais no dataset atual — base trocada/agrupamento removido).
- **`FilterCardsEditor`/`FilterCardRow`**: componentes reutilizados nos dois níveis —
  só mudam a lista de cartões e o callback `onChange`.
- **Consumo**: `AnalyticsWidget` computa `filteredDataset = applyFiltersToDataset(analyticsDataset, pageFilters, cfg.filters)`
  e usa esse dataset filtrado tanto no `pivotWidget` (line/bar/bar100) quanto no
  `KpiCard`. Os poços de campo (Eixo X/Métrica/Série) continuam listando dimensões do
  dataset **não filtrado** — só os valores agregados mudam com o filtro.

## Engine de simulação
- `validateFlow`: inclui `cineminha` e `decision_lens` no conjunto de nós de fluxo válidos; DFS para detecção de ciclos
- `runSimulation` / `traverseRow`: para nós `cineminha`, faz lookup em `cells` com a chave `${rowVal}|${colVal}` e roteia para o port pelo `cinemaType`; para nós `decision_lens`, avalia `rules` contra a linha; para nós `as_is`, lê `__DECISAO_ORIGINAL`
- Para cada linha aprovada, acumula `inadRealSum`, `qtdAltasSum`, `qtdAltasInferSum` e `inadInferidaSum`
- Retorna `{ totalQty, approvedQty, rejectedQty, asIsQty, approvalRate, inadReal, inadInferida, edgeStats, inferenceSource, confiabVolume }`
  - `inadReal = ∑ inadRRaw / ∑ qtdAltas` (null se qtdAltasSum = 0)
  - `inadInferida = ∑ inadIRaw / ∑ qtdAltasInfer` (fallback: `/ approvedQty` se qtdAltasInferSum = 0)
  - `inferenceSource`: `'ref'` se algum dataset usa a Tabela de Inferência, senão `null` (Fase 3)
  - `confiabVolume`: `{ ALTA, MEDIA, BAIXA, GLOBAL }` — altas inferidas acumuladas por faixa de confiab da premissa usada (só em modo `ref`, senão `null`); base do indicador "% do volume inferido com confiab ALTA" (ver Sinalização de Confiabilidade)
  - `inferenceWeightMode`: `'propostas'|'aprovados'|'misto'|null` — base de peso dos datasets em modo `ref` (Fase 4; `misto` se divergentes); alimenta o selo de peso do `InferenceSignal` (ver Toggle de Peso)
- Reconciliação de dataset (`onImportConfirm`): ao trocar CSV, o sistema faz match normalizado de variáveis em nós `cineminha`, recomputa domínios e preserva os estados de elegibilidade existentes

## Wizard de importação (3 passos)

### Passo 1 — Delimitador
- Modal 600px; detecção automática do delimitador com badge "detectado automaticamente" / "verifique abaixo"
- Detecção automática do separador decimal (`,` ou `.`) com badge de confiança
- Preview das 5 primeiras linhas
- Toggle "Tem cabeçalho?"

### Passo 2 — Classificar colunas
- Modal alarga para 900px para acomodar 7 colunas de tipo + coluna Tipo Var.
- Layout em CSS `grid` com `gridTemplateColumns: "1fr repeat(7, 60px) 100px"`
- Header sticky; lista de colunas com scroll interno (`maxHeight: 340px`)
- Seletor de varType por coluna: `categorical` | `ordinal`
- Sugestão automática via `suggestVarType` e `suggestMetricColumns`

### Passo 3 — Variável de Decisão AS IS
- Modal 680px; etapa obrigatória para configurar a baseline histórica
- **Seletor de coluna**: lista apenas colunas não-métricas
- **Mapping de valores**: ao selecionar a coluna, exibe todos os distinct values com dropdown `✅ Aprovado / ❌ Reprovado / — Ignorar`
- **Validação em tempo real**: indicadores mostram se aprovado mapeado, reprovado mapeado, todos os valores atribuídos
- **On confirm**: deriva coluna `__DECISAO_ORIGINAL` (última posição em `headers`/`rows`) com valores `APROVADO` / `REPROVADO` / `''`; salva `asIsConfig` no csvStore
- **Edit mode**: restaura `asIsVar` e `asIsMapping` do `asIsConfig` salvo
- **Pular**: botão para ignorar o passo (sem AS IS)

## Variável de Decisão AS IS — Conceito

O simulador opera em modelo de **simulação incremental sobre comportamento observado**:
- A base histórica (`asIsConfig`) representa a realidade operacional
- `__DECISAO_ORIGINAL` é a coluna interna com a decisão normalizada de cada linha
- Usada para comparação contrafactual: o que mudaria se a nova política tivesse sido aplicada?

### Estrutura `asIsConfig`
```js
{
  col: string,     // nome da coluna original no CSV (ex: "DECISAO_FINAL")
  mapping: {       // valor encontrado → significado normalizado
    "A": "APROVADO",
    "R": "REPROVADO",
    "P": "IGNORAR",
  }
}
```

### `incrementalResult`
Gerado pelo worker (`COMPUTE_OVERLAY`) a partir de `computeIncrementalResult`:
```js
{
  baseline: { approvedQty, rejectedQty, totalQty, approvalRate, inadReal, inadInferida },
  simulated: { approvedQty, rejectedQty, totalQty, approvalRate, inadReal, inadInferida },
  impacted: { qty, totalQty, pct, rToA, aToR, approvalDelta, altasInferRtoA, altasRealAtoR }
}
```
- `rToA`: Reprovado → Aprovado (promoções da nova política)
- `aToR`: Aprovado → Reprovado (rejeições adicionais)
- Exibido no `SimIndicators` e no painel de simulação

## Painel de Simulação (`simPanel`)
- Tamanho padrão: `w: 260, h: 280`
- Exibe três indicadores:
  1. **Taxa de Aprovação** — número grande + barra de progresso + contadores ✅/❌/⟳
  2. **Inad. Real** — `∑ Inad.Real / ∑ Altas aprovadas`; cor vermelha > 5%, laranja ≤ 5%, cinza = N/A
  3. **Inad. Inferida** — `∑ Inad.Inferida / Vol. Conv. Inferida` (fallback: `/Vol. Aprovado`); mesma escala de cor
- Sidebar direita espelha os três indicadores com recalculo reativo + comparativo AS IS quando disponível

## Motor de Recomendação — Cineminha (`optimModal`)

### Ativação
Selecionar um nó `cineminha` exibe toolbar contextual com botão **⚙ Otimizar Decisão** (único Cineminha selecionado) ou **⚡ Otimização Johnny** (2+ Cineminhas selecionados).

### Estado `optimModal` (single cineminha)
```js
{
  shapeId,           // id do cineminha sendo otimizado
  cellMetrics,       // {[cellKey]: {qty, qtdAltas, qtdAltasInfer, inadRRaw, inadIRaw, inadReal, inadInferida}}
  frontier,          // array de pontos Pareto ordenado por approvalRate crescente
  scenarios,         // {conservador, balanceado, melhorEficiencia, expansao}
  activeCard,        // 'conservador' | 'balanceado' | 'melhorEficiencia' | 'expansao' | 'personalizado'
  proposedCells,     // {[cellKey]: boolean} — estado em edição (não aplicado ao canvas)
  sliderApprovalIdx, // índice no array frontier (não ratio direto)
  sliderInadReal,    // ratio 0–1 (restrição de teto)
  sliderInadInf,     // ratio 0–1 (restrição de teto)
  maxInadReal,       // valor máximo observado nas células
  maxInadInf,        // valor máximo observado nas células
  matrixZoom,        // zoom da grade de células no modal
  matrixPanX,        // pan horizontal da grade
  matrixPanY,        // pan vertical da grade
}
```

### Cenários
| Card | Label | Fonte |
|------|-------|-------|
| 🛡 Conservador | pré-computado | `scenarios.conservador` (menor inad) |
| ⚖ Balanceado | pré-computado | `scenarios.balanceado` (1/4 da curva) |
| ⚡ Melhor Eficiência | pré-computado | `scenarios.melhorEficiencia` (joelho da curva) |
| 🚀 Expansão | pré-computado | `scenarios.expansao` (maior aprovação) |
| 🎛 Personalizado | manual | ativo ao mover slider ou clicar célula |

### Aplicar
`applyOptimResult(shapeId, proposedCells)` — sobrescreve `cells` do Cineminha via `setShapes` e fecha o modal. Não-destrutivo: nenhuma alteração no canvas até o clique em "Aplicar".

## Otimizador Multi-Cineminha — Johnny (`johnnyModal`)

### Ativação
Com 2 ou mais nós Cineminha selecionados, a toolbar contextual exibe **⚡ Otimização Johnny (N)**. Dispara `COMPUTE_JOHNNY` no worker com todos os shapes do canvas, os IDs dos cineminhas selecionados, as conexões e as `lensPopulations`.

### Algoritmo (Sessão C — DEC-JO-003/004)
1. **Pool de métricas**: agrega células de **todos** os Cineminhas selecionados via `computeCinemaArrivals` (populações filtradas pelo grafo de fluxo)
2. **Grafo de precedência**: (a) monotonicidade interna por eixo ordinal — `(i,j)` exige `(i-1,j)` e `(i,j-1)` no mesmo Cineminha; (b) aninhamento de cascata — `(i,j)` no nível L exige `(i,j)` no nível L−1 (mais seguro, `hierarchyMode='cascata'`); modo `independente` usa só (a)
3. **Greedy com precedência**: a cada passo, entre as células **liberadas** (precedências satisfeitas), abre a de menor inadimplência suavizada (`inadMetric`: inferida ou real); desempate por `qty` desc; suavização bayesiana (shrinkage em direção à média do pool) com `SHRINK_K = 10%` do volume médio — evita inversões por ruído amostral; fallback sem inad: rank hierárquico de nível + posição ordinal interna
4. **Mix de risco**: se coluna `mixRisco` presente, acumula distribuição por categoria por ponto da fronteira
5. **Scenarios**: `{conservador, melhorEficiencia, expansao}` via joelho da curva

### Estado `johnnyModal`
```js
{
  pooledMetrics,        // {[`${shapeId}|${cellKey}`]: CellMetricExtended}
  frontier,             // pontos Pareto globais
  scenarios,            // {conservador, melhorEficiencia, expansao}
  mixCats,              // categorias de mix de risco encontradas
  shapeMetas,           // [{id, label, rowVar, colVar, rowDomain, colDomain, originalCells}]
  baselineApprovalRate, // taxa de aprovação com células atuais
  activeCard,           // card ativo
  proposedByShape,      // {[shapeId]: {[cellKey]: boolean}} — estado em edição
  sliderApprovalIdx,    // índice no frontier
  sliderInadReal,
  sliderInadInf,
  maxInadReal,
  maxInadInf,
  activeShapePreview,   // id do cineminha selecionado no preview de células
  riskLevels,           // {[shapeId]: number} — nível de risco manual (DEC-JO-002); maior = mais restritivo; default = ordem dos selecionados (1,2,3...)
  hierarchyMode,        // 'cascata'|'independente' (DEC-JO-003); default 'cascata'
  inadMetric,           // 'inferida'|'real' (DEC-JO-004); default 'inferida'
}
```

### Aplicar
`applyJohnnyResult(proposedByShape)` — sobrescreve `cells` em múltiplos Cineminhas simultaneamente.

## Biblioteca de Cineminha (`cinemaLibrary`)

- Estado local (array) persistido em `localStorage` implicitamente (futuro)
- Cada entrada: `{id, name, description, tags, cinemaType, rowDomain, colDomain, cells, metadata, savedAt}`
- **Salvar**: toolbar contextual do Cineminha → "Salvar na Biblioteca"
- **Aplicar**: modal da biblioteca → selecionar entrada → modal de mapeamento de variáveis (`cinemaImportModal`) → aplica `cells` com remapeamento de domínio
- **Export/Import**: JSON e CSV de lote via `cinemaLibraryModal`

## Domínio Exibido ("Configurar nó")

### Problema
O distinto do domínio de uma variável era sempre feito sobre a **base completa**, então um losango/Cineminha exibia todos os valores mesmo quando o fluxo a montante (Decision Lens, ports, outro losango) filtra a população. Ex.: variável `Score` que muda por grupo trazia `R01–R24` + `Com/Sem Restritivo` juntos, mesmo chegando só um grupo ao nó.

### Solução
O domínio completo continua guardado no shape (`rowDomain`/`colDomain`, ports). O que muda é **o que se exibe**, controlado por nó e de forma **não-destrutiva** (nada é apagado; ports/células escondidos continuam roteando na simulação).

- **Contagem reativa**: `computeNodeArrivals` (worker, junto do `COMPUTE_OVERLAY`) devolve `nodeArrivals = {[nodeId]: {val|row|col: {[valor]: qty}}}` — quantos registros chegam a cada nó por valor, respeitando o roteamento a montante. Armazenado no estado `nodeArrivals` (sem ref; usado em render/memo/modal).
- **Domínio efetivo** (helper global `effectiveDomain(fullDomain, cfg, counts)`):
  - `cfg === null` → **automático** (default): exibe só valores com `qty > 0`; *fallback* para o domínio completo se nada chega (nó recém-criado/sem upstream), pra nunca renderizar vazio.
  - `cfg === string[]` → **manual**: exibe exatamente esses (na ordem do domínio); fallback p/ completo se vazio.
- **Campos no shape**: `decision.visibleVals`, `cineminha.visibleRow`/`visibleCol` (todos `null` por default = automático).
- **Render**: `renderCinemaNode` usa `effectiveDomain` em `rDom`/`cDom`; ports de losango fora do domínio efetivo entram em `hiddenPortIds` (useMemo) e são pulados em `renderShape`/`renderConn`.
- **Modal `domainModal`** (`null | {shapeId, draft:{val?|row?|col?: null|string[]}}`): aberto pelo botão **⚙ Domínio** na toolbar contextual do losango e do Cineminha. Lista com check + valor + qtd. que chegou (por valor), multi-seleção, e o toggle **"Mostrar apenas valores com volume"** (= modo automático). Mexer em qualquer check vira modo manual. `applyDomainConfig` grava os campos `visible*` no shape (com `pushHistory`).

## Salvar / Abrir Projeto (`.credito.json`)

Botões **💾 Salvar Projeto** e **📁 Abrir Projeto** na seção **Projeto** (topo do
painel direito). Persistência completa do estudo num único arquivo
`.credito.json` (local, sem servidor), para o usuário retomar exatamente de onde
parou.

- **`buildProjectPayload()`** — **FONTE ÚNICA DA VERDADE do que é persistido.**
  Monta o snapshot `{schemaVersion:"2.2", kind:"credito-project", generatedAt,
  activeTab, viewport, panelCollapsed, canvases, activeCanvasId, csvStore,
  inferenceRef, analyticsLayout, analyticsGroupings, analyticsPageFilters,
  cinemaLibrary, businessWidget, preferences}`.
  `preferences` = `{enableDynThickness, showEdgeVol, showEdgeInadReal, showEdgeInadInf}`.
  Mescla a working copy do canvas ativo (`shapes`/`conns`) de volta em `canvases`
  (igual ao effect da `sessionStorage`) — **sem isso, edições no canvas ativo (ex.:
  um Decision Lens recém-criado) não entram no arquivo.**
  O `csvStore` é serializado via `serializeCsvStore()` (typed arrays → arrays planos)
  e restaurado via `deserializeCsvStore()` (arrays planos → typed arrays; também aceita
  o formato legado `rows: string[][]` de projetos anteriores à Fase 1, migrando-os
  transparentemente).
- **`saveProject()`** (async): serializa `buildProjectPayload()` e usa o **"Salvar
  como" nativo** (File System Access API `window.showSaveFilePicker`) quando
  disponível — o usuário escolhe pasta e nome, e a escrita via stream (`createWritable`)
  não sofre truncamento. `AbortError` = usuário cancelou (no-op). *Fallback* para
  download via `<a download>` (browsers sem a API): anexa o `<a>` ao DOM e só revoga o
  blob URL após `setTimeout(…, 2000)` — **revogar imediatamente após `click()` pode
  truncar projetos grandes** (bug histórico: base de dados sumindo do arquivo salvo).
  Dá feedback via `projectSaveNotice` (`{kind:'ok'|'err', msg}`) renderizado sob o botão.
- **`loadProject(data)`** / **`onProjectFileChange`**: valida `kind:"credito-project"`,
  sobe o contador `_id` (varre shapes/conns/ids de todos os canvas) p/ evitar colisão,
  restaura todo o estado (cada seção com default defensivo — seções ausentes não zeram
  o resto), reseta seleção/edição e os stacks de undo/redo (que são por canvas e
  ficariam inconsistentes após trocar todos os canvas). Os effects de
  `csvStore`/`inferenceRef` reenviam `UPDATE_CSV_STORE`/`UPDATE_INFERENCE_REF` ao worker.
- **`serializeInferenceRef` / `deserializeInferenceRef`** (helpers globais exportados):
  `inferenceRef.levels` é `{[nivel]: Map}` — JSON não serializa `Map`, então converte
  para arrays de entradas na exportação e reconstrói os `Map`s na carga. Round-trip
  coberto em `tests/inferenceRef.test.js`.
- **`serializeCsvStore` / `deserializeCsvStore`** (em `src/columnar.js`, importados em `App.jsx`):
  Typed arrays (`Float64Array`, `Int32Array`) não são JSON nativo — `serializeCsvStore`
  converte-os para arrays planos e `deserializeCsvStore` reconstrói os typed arrays
  (inclusive migrando o formato legado `rows: string[][]` para colunar). Round-trip
  coberto em `tests/columnar.test.js`.

Difere do **Exportar/Importar Fluxo** (seção Fluxo), que salva só o canvas ativo
(shapes/conns + opcionalmente csvStore) — o Projeto salva *tudo* (todas as abas,
bases, inferência, dashboard, biblioteca e preferências).

### ⚠️ Regra para novas features — o que o usuário cria/ajusta PRECISA ser salvo

**Toda vez que você adicionar um estado novo que representa algo criado ou
configurado pelo usuário** (uma nova aba/canvas, um novo tipo de shape e seus
campos, uma nova biblioteca, um novo painel/config do Dashboard, uma nova
preferência de visualização, um novo modal de configuração persistente, etc.),
inclua-o no salvamento do Projeto — senão ele se perde ao salvar/abrir. Passos:

1. **Incluir no `buildProjectPayload()`** o novo campo (ou garantir que ele já
   viaja dentro de um contêiner já salvo — ex.: um novo campo de um `shape` já é
   coberto por `canvases`; um novo campo do `csvStore[csvId]` já é coberto por
   `csvStore`). Só precisa de entrada própria estado que vive **fora** desses
   contêineres (um novo `useState` de topo).
2. **Restaurar em `loadProject(data)`** com default defensivo
   (`Array.isArray(...) ? ... : []`, `typeof x === '...' ? ... : default`), para
   arquivos antigos (sem o campo) não quebrarem nem zerarem o resto.
3. **Bump do `schemaVersion`** se a mudança for estrutural (ex.: `2.1` → `2.2`).
   Versão atual: **`"2.2"`** (bumped na Fase 1 de otimização de memória — `csvStore` colunar).
4. Se o estado for um `Map`/`Set`/tipo não-JSON (ou typed arrays como `Float64Array`/`Int32Array`),
   adicionar serialize/deserialize dedicados (padrão de `serializeInferenceRef` e
   `serializeCsvStore`/`deserializeCsvStore`) e cobrir o round-trip em teste.
5. Se também deve sobreviver a reload na mesma sessão, adicionar à
   auto-persistência de `sessionStorage` (ver seção abaixo).

**Checklist do que hoje é salvo** (mantê-lo em dia): canvas e todos os shapes/conns
de **todas** as abas (losangos, Cineminhas, Decision Lens e suas `rules`, frames,
terminais, painéis) · `includeInDashboard`/nome por aba · bases de dados completas
(`csvStore`: headers, rows, columnTypes, varTypes, `asIsConfig`, `inferenceConfig`) ·
Tabela de Inferência (`inferenceRef`) · Dashboard (`analyticsLayout`,
`analyticsGroupings`, `analyticsPageFilters`) · biblioteca de Cineminhas
(`cinemaLibrary`) · widget de negócio · preferências de aresta/espessura ·
viewport · aba ativa · painel colapsado.

## Auto-persistência de sessão (`sessionStorage`)

Além do save/load explícito, parte do estado é persistida automaticamente em
`sessionStorage` para sobreviver a reloads **dentro da mesma sessão** do navegador
(não é durável — some ao fechar a aba). Chaves:

- **`aw_canvases_v1`** (`CANVAS_STORAGE_KEY`): store multi-canvas. O effect grava
  `{canvases, activeCanvasId}` a cada mudança de `shapes`/`conns`/`canvases`/
  `activeCanvasId`, sempre mesclando a working copy do canvas ativo de volta em
  `canvases[activeCanvasId]`. Init cacheado via `_initCanvasStore()` (parseia uma vez,
  compartilhado pelos initializers de `canvases`/`activeCanvasId`/`shapes`/`conns`).
- **`aw_layout_v1`**: `analyticsLayout` (gráficos do dashboard).
- **`aw_groupings_v1`**: `analyticsGroupings` (dimensões derivadas).
- **`aw_page_filters_v1`**: `analyticsPageFilters` (filtro de página do Dashboard).

`csvStore`, `inferenceRef` e `cinemaLibrary` **não** vão para `sessionStorage`
(muito grandes / precisam do Projeto `.credito.json`). Init/gravação são
defensivos (`try/catch`), então quota estourada ou JSON inválido nunca quebram o boot.

## Painel direito colapsável (`panelCollapsed`)

O painel lateral direito (chips de variáveis, Projeto, Dados, indicadores) pode ser
colapsado para uma faixa fina de 28px, liberando espaço de canvas. Estado
`panelCollapsed` (boolean, default `false`); largura anima entre `272px` e `28px`.
Quando colapsado, o conteúdo é escondido (`display:none`) e só a faixa com o botão de
reabrir fica visível.

## Carga de CSV assíncrona + modal de progresso (`importLoading`)

Bases grandes travavam a UI no parse síncrono. `parseCSVAsync(text, delimiter,
hasHeader, onProgress)` fatia o CSV em lotes, cede a thread principal a cada lote
(`setTimeout 0`) e reporta progresso via `onProgress(linhasProcessadas, total)`.

- Estado `importLoading`: `null | {phase:'reading'|'parsing', pct, filename}` —
  alimenta um modal de progresso. `reader.onprogress` cobre a leitura do arquivo
  (`reading`); `parseCSVAsync` cobre o parse (`parsing`).
- Usado em `onFileChange` (import inicial) e `reparseWizardFile` (recarga no wizard) —
  ambos mostram o mesmo modal.
- **Fase 0 (otimização de memória)**: `parseCSVAsync` NÃO materializa mais
  `text.split(/\r?\n/)` inteiro. Varre o texto por índice (`indexOf('\n')`) e fatia
  cada linha sob demanda — elimina o pico de RAM do parse (~260MB em bases grandes).

## Otimização de Memória — `src/columnar.js` (Fases 0–3)

Para bases sumarizadas por dia (~1MM linhas / ~130MB), a arquitetura anterior
mantinha várias cópias completas em `string` na RAM. Ver o plano completo em
`docs/wiki/Otimizacao-Memoria.md`. **Fases 0, 1, 2, 3 entregues.**

### Fase 0 — Parse sem cópia intermediária
`parseCSVAsync` varre o texto por índice em vez de `split(/\r?\n/)`. Sem o array
intermediário de 1MM strings, o pico de RAM do parse cai de ~3× para ~1× o tamanho
da base.

### Fase 1 — Armazenamento colunar no `csvStore`
`src/columnar.js` define a estrutura vetorizada e os accessors:
- Colunas métricas (`METRIC_COL_TYPES = qty, qtdAltas, qtdAltasInfer, inadReal, inadInferida`) → `Float64Array` (números prontos, sem `parseFloat` por tick).
- Dimensões/decisão/ID → *dictionary encoding* `{dict: string[], codes: Int32Array}` — o dicionário já é a lista de distintos.
- **Accessors** (uso obrigatório em hot paths — não acessar `csv.rows[r][c]` diretamente):
  - `rowCount(csv)` — número de linhas
  - `cellStr(csv, r, c)` — equivalente exato a `row[c]` no legado
  - `cellNum(csv, r, c)` — valor numérico (retorna `NaN`, não `0`; o call site aplica `|| 0`)
  - `getRow(csv, r)` — materializa uma linha como `string[]` (uso pontual)
  - `materializeRows(csv)` — materializa tudo (evitar em hot paths)
  - `distinctColValues(csv, c)` — distintos não-vazios (O(distintos) em modo colunar)
- **Persistência**: `serializeCsvStore(store)` / `deserializeCsvStore(store)` — typed arrays ↔ arrays planos para JSON. `deserializeCsvStore` também aceita o formato legado `rows: string[][]` (migração transparente de projetos antigos).
- **GATE**: `tests/columnar.test.js` verifica equivalência célula a célula com o legado, round-trip de projeto e runSimulation sobre base colunar (mesma FPD ≈ 40,06%).

### Fase 2 — Transferência sem cópia para o worker via `SharedArrayBuffer`
Quando o contexto é *cross-origin isolated* (`crossOriginIsolated === true`), os
typed arrays são alocados sobre `SharedArrayBuffer` — o structured clone do
`postMessage` compartilha a memória por referência em vez de copiar.
- `sharedBuffersAvailable()` — feature-detect (retorna `false` em `file://`, Node/jsdom, browser sem COI).
- `buildCsvStoreMessage(csvStore)` — monta `{payload, transfer:[]}`. A lista de transfer é **sempre vazia** (SAB nunca é transferido; `ArrayBuffer` sem COI deixa o clone copiar — a main ainda precisa dos buffers).
- `vite.config.js`: headers `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` em `server`/`preview` para habilitar COI.
- **Ownership**: nenhum buffer da base é neutralizado. Worker é read-only, sem write race.

### Fase 3 — `COMPUTE_ANALYTICS_DATASET` só na aba Dashboard
O effect que dispara `COMPUTE_ANALYTICS_DATASET` agora só posta a mensagem quando
`activeTab === 'analysis'`. Editar o canvas na aba Canvas não materializa mais o
dataset largo (array de objetos simples — ainda não é SAB) a cada tick.

## Inferência de Negados (Tabela de Referência)

Fonte alternativa para os números de inferência (🔮 Conv. Inferida e 🎯 Inad.
Inferida). Em vez de ler colunas prontas da base, deriva conv/fpd por linha via
**lookup em cascata** numa tabela de referência gerada no SAS. Fontes de verdade:
`docs/Proposta-Inferencia-Referencia.md` + `CONTRATO_INFERENCIA.md`.

**Faseamento — Fase 1 (entregue): carga + estado + mapeamento + config. Fase 2
(entregue): lookup em cascata + injeção dos físicos no worker + normalização de
score como chave transitória. Fase 3 (entregue): sinalização de confiabilidade na
UI (ver Sinalização de Confiabilidade). Fase 4 (entregue): toggle de peso
(`n_propostas` ↔ `n_aprovados`), recálculo automático na troca/recarga da referência
e refinamento visual do selo/alerta (ver Toggle de Peso e ADR DEC-IR-004).**

### Slot dedicado de import
- Botão **🧮 Tabela de Inferência** no painel direito (seção Dados), separado do
  import de base. Parser fixo: delimitador `;`, decimal `.`.
- **Não** entra no `csvStore`, não vira nó no canvas, não gera chips.
- `onInferenceRefFileChange` parseia + indexa via `indexInferenceRef` e grava em
  `inferenceRef` (erros em `infRefError`).

### `indexInferenceRef(headers, rows, name)` (helper global, exportado)
Indexa o artefato **uma vez**, derivando chaves/níveis **dinamicamente** (nunca
nomes hardcoded). Retorna o `InferenceRefIndex`:
```js
{
  name, importedAt,
  keyCols: string[],      // derivado da maior `vars_usadas` (ordem = colapso; última cai primeiro)
  anchorCol: string,      // keyCols[0] (nunca colapsa)
  levels: { [nivel]: Map<keyConcat, { conv, fpd, confiab, nAprov, nConv, nMaus }> },
  global: premissa|null,  // linha GLOBAL
  levelKeyCount: { [nivel]: number },  // nº de chaves (prefixo de keyCols) por nível
  rowCount,
}
```
O CSV real tem 4 chaves (`FAIXA_SCORE`, `OPERACAO`, `IDENTIFICA_GRUPO_MODELO`,
`CANAL_PCO_AJUSTADO`) e 5 níveis (1..4 + GLOBAL). Validado em `tests/inferenceRef.test.js`.

### Seletor de origem no wizard (Passo 2)
Seção **Origem da Inferência** com duas opções:
- **Colunas da própria base** (default): mapeia 🔮/🎯 como hoje.
- **Tabela de referência**: desabilitada se `!inferenceRef`. Ao escolher, oculta
  os slots 🔮/🎯 e mostra o **mapeamento de chaves** base↔referência (um `select`
  por `keyCol`, pré-preenchido por `normalizeColName`, com override manual) + o
  **toggle de peso** (📋 Propostas / ✅ Aprovados, ver Toggle de Peso) + o seletor de
  coluna de **peso** (default automático pela base de peso escolhida).

### Toggle de Peso (Fase 4 — CONTRATO §3.2)
Define a **base de volume** do peso usado nos físicos da inferência:
- **📋 Propostas** (default, `weightMode:'propostas'`): peso = 📊 volume total de
  propostas (`n_propostas`) — semântica **"abrir para os reprovados"** (quanto de altas
  e maus apareceria se a política passasse a aprovar aquelas propostas).
- **✅ Aprovados** (`weightMode:'aprovados'`): peso = volume de aprovados (`n_aprovados`)
  — semântica **"FPD sobre aprovados"**.
- Resolução da coluna (worker `resolveWeightCol(cfg, headers, qtyCol)`): `weightCol`
  explícito **sempre vence** (override avançado); senão modo `aprovados` usa a coluna de
  aprovados via heurística `findApprovedCol` (`/aprov/i`, excluindo a `qty`), e modo
  `propostas` usa a 📊 `qty`. O wizard pré-preenche o `weightCol` ao trocar p/ aprovados.
- `runSimulation` devolve `inferenceWeightMode: 'propostas'|'aprovados'|'misto'|null`
  (misto = datasets em modo `ref` com bases diferentes); alimenta o selo de peso do
  `InferenceSignal`. **Não muda a matemática** além da coluna de peso escolhida.

### `inferenceConfig` (persistido em `csvStore[csvId]`)
`{ source: 'columns'|'ref', keyMap: {[refKeyCol]: baseCol}, weightCol, weightMode:'propostas'|'aprovados', normalizeScore }`.
Gravado no `onImportConfirm` (import novo e edição). `source:'ref'` degrada para
`'columns'` se a Tabela de Inferência não estiver mais carregada. Restaurado no
`onEditDataset`. `weightMode` (default `'propostas'`) é a base de peso (ver Toggle de
Peso). `normalizeScore` (default `true`) liga a normalização de score no lookup (§6,
abaixo) — checkbox no wizard quando `source==='ref'`.

### Troca/recarga da referência com estudo montado (Fase 4 — Proposta §9.4)
Trocar ou recarregar a Tabela de Inferência **recalcula automaticamente** os estudos
que a usam (os effects debounced de sim/overlay/analytics têm `inferenceRef` nas deps;
o worker recebe `UPDATE_INFERENCE_REF` antes do recompute). O `inferenceConfig` de cada
dataset vive no `csvStore` e é **preservado** — não é tocado ao mexer na referência.
Remover a referência degrada os estudos em modo `ref` para o comportamento de colunas
🔮/🎯, mas o `inferenceConfig` fica salvo para retomar ao recarregar. O painel da Tabela
de Inferência mostra **quantos estudos** usam a referência (e um aviso quando há estudos
configurados sem referência carregada).

### Lookup em cascata + físicos (Fase 2 — worker)
- A `inferenceRef` é espelhada no worker via mensagem **`UPDATE_INFERENCE_REF`**
  (análoga a `UPDATE_CSV_STORE`; o `structured clone` do `postMessage` preserva os
  `Map`s de `levels`). App reenvia a cada mudança de `inferenceRef`; as três effects
  debounced (sim/overlay/analytics) incluem `inferenceRef` nas deps para recomputar.
- **`buildInferenceResolver(csv, inferenceRef)`** (worker): retorna `null` fora do
  modo `ref` (o chamador lê as colunas 🔮/🎯 como antes — retrocompatível). Em modo
  `ref`, retorna `(row) => { altasInfer, inadIRaw }`:
  - monta a chave pelas colunas mapeadas (`keyMap`), aplica `normalizeScoreKey` na
    âncora (score) quando `normalizeScore !== false`;
  - **cascata** `cascadeLookupPremissa`: desce do nível mais granular (mais chaves)
    ao GLOBAL, para no primeiro `Map` que casar (chave ausente desce naturalmente);
  - **físicos** (CONTRATO §3.2): `altasInfer = peso × conv`, `inadIRaw = peso × conv × fpd`,
    `peso` = coluna resolvida por `resolveWeightCol` (`weightCol` explícito → senão a
    base do `weightMode`: 📊 `qty` em propostas, coluna de aprovados em aprovados — ver
    Toggle de Peso).
- O resolvedor alimenta **os acumuladores que já existem** (`qtdAltasInferSum`,
  `inadInferidaSum`) em `runSimulation`, `computeIncrementalResult`,
  `computeCellMetrics`, `computeCinemaArrivals` e `computeAnalyticsDataset` — nenhuma
  agregação nova. As **Regras de Ouro** (CONTRATO §4) valem por construção: somam-se
  os físicos por linha e o agregador faz `∑inadIRaw / ∑qtdAltasInfer` (nunca divide
  maus por contagem de aprovados, nunca multiplica somas).
- **`normalizeScoreKey(s)`**: `R99`/vazio → `R20`, **apenas** como chave transitória
  de lookup (§6) — nunca muta dado, domínio ou export.
- Painel/otimizador/dashboard são intocados: só consomem os mesmos acumuladores.

### GATE de aceite (validação numérica)
`tests/inferenceCascade.test.js` roda a cascata sobre a amostra real
(`Amostra_Fake.csv` × `INFERENCIA_REF_*.CSV`) e confere o `∑maus/∑altas` agregado
do resolvedor (e de `runSimulation` aprovando tudo) contra uma cascata de
**controle reimplementada do zero** lendo as linhas cruas da referência. Valor de
controle documentado: ∑altas ≈ 418.775, ∑maus ≈ 167.753, **FPD inferida ≈ 40,06%**.

### Restrições respeitadas
- Não quebra o fluxo atual de colunas 🔮/🎯 (fonte alternativa, retrocompatível).
- Não altera domínios, dado exibido nem export — score normalizado só na chave.

### Sinalização de Confiabilidade (Fase 3 — Proposta §4.5, CONTRATO §7)
Sinaliza, **sem mudar a matemática**, quando uma fatia relevante do estudo herdou
premissa colapsada (≠ `ALTA`) — em especial o caso do canal **PAP** (CONTRATO §7).

- **Worker** (`runSimulation`): `buildInferenceResolver` devolve também o `confiab`
  (uppercased) da premissa usada por linha. Sobre as linhas **aprovadas** em modo
  `ref`, acumula `confiabVolume = { ALTA, MEDIA, BAIXA, GLOBAL }` ponderado pelas
  **altas inferidas** (`qtdAltasInfer` — mesma grandeza do "volume inferido"). Retorna
  `inferenceSource: 'ref'|null` e `confiabVolume: {...}|null`. Faixa desconhecida cai
  em `GLOBAL` (mais conservador). Nenhum acumulador novo na matemática da inferência.
- **UI** — componente global `InferenceSignal({ source, confiabVolume, weightMode, scale })`
  (refinado na Fase 4 — Proposta §9.5): renderiza um `<div>` (serve em `foreignObject`
  do `simPanel` e no `businessWidget`, reaproveitando o fator de escala `scale`). Mostra:
  - **Selo discreto** `🧮 Inferência: Tabela de referência` quando `source === 'ref'`
    (para não confundir a origem do número) + **selo de base de peso** `⚖️ Peso:
    Propostas/Aprovados/Misto` (ver Toggle de Peso).
  - **Indicador "% do volume inferido com confiab ALTA"** + barra empilhada por faixa +
    **legenda** das faixas presentes (quando há mais de uma). A cor do indicador e a
    moldura do card seguem o nível: verde ≥ 80%, âmbar 50–80% (⚡ atenção), vermelho
    < 50% (⚠ **alerta**). Ambos os níveis colapsados exibem aviso textual mencionando o
    caso PAP e instruindo a ler como estimativa.
  - Renderizado no `renderSimPanel` e no `businessWidget`, sempre a partir do
    `simResult` (não do `incrementalResult`).
- **GATE**: `tests/inferenceCascade.test.js` confere o `confiabVolume` agregado de
  `runSimulation` contra um controle independente (mesmo padrão da FPD). Na amostra
  real, 100% do volume resolve em `ALTA` (todas as linhas batem no nível 1).

## Decision Lens

### Propósito
Segmentar uma sub-população da base histórica e aplicar regras diferentes a ela. O Decision Lens não filtra o fluxo — ele **marca** quais linhas devem ser processadas pelo fluxo subsequente.

### `lensPopulations`
Calculado via `useMemo` a cada mudança em `shapes` e `csvStore`:
```js
// {[lensId]: {[csvId]: boolean[]}}
// boolean[rowIndex] = true se a linha passa pelas regras do lens
```

### Fluxo no motor
Em `traverseRow`, quando o nó é `decision_lens`:
1. Avalia `rules` da linha via `rowMatchesLensRules`
2. Se **passa**: segue para a saída única do nó
3. Se **não passa**: retorna `null` (linha não processada por este fluxo)

## Widget de Impacto de Negócio

- Componente flutuante arrastável (`businessWidget`)
- Exibe comparativo baseline AS IS vs. política simulada em formato de painel executivo
- Estado: `{visible: boolean, x, y, w, h}`
- Ativado via botão no painel lateral

## Indicador de Versão/Build (`BuildBadge`)

### Localização
Header do painel direito — ao lado do título "Painel".

### Constantes injetadas pelo Vite (`vite.config.js`)
| Constante | Fonte | Exemplo |
|---|---|---|
| `__BUILD_NUMBER__` | `git rev-list --count HEAD` | `"48"` |
| `__BUILD_TIME__` | `new Date().toISOString()` no momento do build | `"2026-05-11T12:07:37Z"` |
| `__BUILD_HASH__` | `git rev-parse --short HEAD` | `"5f5124f"` |
| `__BUILD_BRANCH__` | `git rev-parse --abbrev-ref HEAD` | `"main"` |
| `__BUILD_AUTHOR__` | `git log -1 --format="%an"` | `"arthurfontana"` |

- Em `dev` (`vite`), as constantes não são definidas — o componente usa `"dev"` e `new Date()` como fallback.
- O número incrementa automaticamente a cada novo commit + build, sem manutenção manual.

### Comportamento visual
- Badge cinza padrão: `#48 · 11/05 12:07`
- Badge verde quando build < 5 min (sinaliza deploy recente)
- Tooltip hover: número, data/hora completa, hash, branch, autor

## CI/CD

### `build-release.yml`
- Disparado em push para `main`
- Executa `npm ci` + `npm run build`
- Copia `dist/` → `release/` (preservando `iniciar.bat`)
- Commita com `[skip ci]` para evitar loop

### `sync-wiki.yml`
- Disparado em push para `main` quando `docs/wiki/**` muda
- Clona o repositório do GitHub Wiki
- Copia `docs/wiki/` para o Wiki e faz push

### Release local
A pasta `release/` contém o build compilado. O usuário pode abrir `release/index.html` diretamente no navegador ou usar `release/iniciar.bat` no Windows — sem servidor necessário.

## Suporte a Touch / Mobile

- Pan e zoom com gesto de pinch (dois dedos) via `touchstart`/`touchmove`
- Drag de shapes com um dedo em modo `hand`
- Seleção por rubber-band (retângulo) via touch em modo `select`
- Drag de variáveis do painel lateral via touch (`startPanelDrag`)
- Clique em células do Cineminha via touch

## Decisões arquiteturais (resumo dos ADRs)

| ADR | Decisão | Justificativa |
|-----|---------|---------------|
| ADR-001 | Arquivo único `src/App.jsx` | Estado profundamente compartilhado; protótipo em iteração rápida |
| ADR-002 | Inline styles | Estilos dependentes de estado junto ao JSX; sem colisão de classes |
| ADR-003 | SVG puro para o canvas | Controle total; suporte a `foreignObject` para HTML dentro do SVG. **Exceção**: Recharts (`DEC-AW-001`) para gráficos na aba Dashboard |
| ADR-004 | Refs espelho para event listeners | Evita closure stale em `addEventListener` |
| ADR-005 | Build em `release/` no mesmo repo | Distribuição simplificada — abrir `index.html` sem servidor |

## Comandos de desenvolvimento

```bash
npm install       # instalar dependências
npm run dev       # servidor de desenvolvimento (Vite)
npm run build     # build de produção → dist/
npm run preview   # preview do build de produção
npm test          # roda a suíte Vitest (tests/*.test.js, jsdom) uma vez
```

## Branch de desenvolvimento atual
`claude/claude-md-docs-7xvd3y`

## Roadmap futuro (não implementado)

- **Restrição de monotonicidade**: flag `ordinal` no wizard passo 2 → corte monotônico (Young diagram) no algoritmo Pareto — para variáveis como ratings R1–R20 (parcialmente implementado no Johnny via `badness`/`rowRank`/`colRank`)
- **Sliders adicionais**: margem, rentabilidade ajustada ao risco (RAR), restrição de volume mínimo por segmento
- **Fronteira Pareto multi-dimensional**: 3D (aprovação × inad.real × inad.inferida)
- **Decision Lens — modo incremental**: comparação visual linha a linha das decisões mudadas
- **Exportação**: JSON canônico da política para importação em motor de decisão em produção; exportação do canvas como PNG/SVG
- **Persistência**: export/import de projeto como `.credito.json` ✅ (ver "Salvar / Abrir Projeto") + auto-persistência em `sessionStorage` ✅ (ver "Auto-persistência de sessão"); falta auto-save durável em `localStorage` (sobrevive só à sessão do navegador)
- **Cálculo de delta marginal**: "adicionar esta célula muda aprovação em +X pp e inad em +Y pp"
