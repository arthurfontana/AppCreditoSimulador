# AppCreditoSimulador

## Stack
- React + Vite, arquivo único: `src/App.jsx` (~11150 linhas)
- Sem CSS externo — tudo inline styles
- SVG puro para o canvas; matrizes interativas via `foreignObject` (sem biblioteca de diagramas)
- **Recharts** para gráficos na aba Dashboard (exceção pontual ao ADR-003 — ver `DEC-AW-001`)
- Web Worker (`src/simulation.worker.js`, ~2430 linhas) para cálculos pesados fora da thread principal
- **`src/columnar.js`**: módulo de armazenamento colunar do `csvStore` (otimização de memória — Fases 0, 1, 2) + pipeline de importação vetorizado (M1 — parse direto para colunar, sem `string[][]`)
- **Vitest** para testes (`tests/*.test.js`, jsdom) — `npm test`

## O que é
Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos ou matrizes cruzadas (Cineminha) e monta um fluxo de política de crédito. O painel de simulação exibe taxa de aprovação e indicadores de inadimplência em tempo real, comparando com a política atual (AS IS).

## Estrutura de arquivos

```
AppCreditoSimulador/
├── src/
│   ├── App.jsx                   # Componente único — ~11150 linhas
│   ├── simulation.worker.js      # Web Worker: simulação, overlay, Pareto, Johnny, Goal Seek (~2430 linhas)
│   ├── columnar.js               # Armazenamento colunar do csvStore (typed arrays + dictionary encoding)
│   ├── goalSeek.js                # applyGoalSeekMoves — materialização de movimentos do Goal Seek (compartilhado worker/main)
│   ├── policySimplify.js          # applySimplifyCandidates — materialização de candidatos de Simplificação (compartilhado worker/main)
│   ├── computeRouter.js           # Execução Híbrida H4 — ComputeRouter + contrato ComputeProvider (worker default / sidecar Python opt-in)
│   └── main.jsx                  # Entry point React
├── tests/                        # Vitest (jsdom)
│   ├── analytics.test.js         # autoBuckets, distinctDimValues, applyGroupingsToDataset, pivotWidget
│   ├── asIsPreview.test.js       # GATE: prévia AS IS contextualizada (computeCinemaAsIsCells) vs. base completa (computeAsIsCells)
│   ├── columnar.test.js          # GATE colunar: accessor, round-trip projeto, SharedArrayBuffer
│   ├── compiledEngine.test.js    # GATE M8: motor compilado (colunar) equivale ao caminho por string (legado)
│   ├── goalSeek.test.js          # GATE Copiloto Sessão 4: delta O(1) por movimento ≡ resimulação, precedência ordinal, restrições/travas, determinismo
│   ├── importPipeline.test.js    # GATE M1: import vetorizado equivale ao caminho legado (parse→normalize→append→buildColumnar)
│   ├── policyDoc.test.js         # GATE Copiloto Sessão 6: docModel ≡ motor (KPIs/funil), completude (todo nó/path), determinismo, degradação sem AS IS, privacidade (toggle de domínios), changelog via diffPolicyIR
│   ├── policyIR.test.js          # GATE Copiloto Sessão 0: roteamento via PolicyIR ≡ motor compilado (M8), round-trip IR→canvas→IR, IR sem posições/dados
│   ├── policySimplify.test.js    # GATE Copiloto Sessão 5: nó colapsável/chegada zero/regra sem efeito/variável re-testada ⇒ proposta prova diff=0; caso lossy ⇒ delta declarado bate com runSimulation
│   ├── policyTemplates.test.js   # GATE Copiloto Sessão 2: biblioteca de políticas — mapeamento de variáveis em base renomeada ≡ roteamento original; variável sem mapeamento vira pendência
│   ├── projectSave.test.js       # buildProjectJSONChunks ≡ JSON.stringify (M3)
│   ├── segmentDiscovery.test.js  # GATE Copiloto Sessão 10: subgrupo plantado achado com condições exatas; homogênea ⇒ zero; agregados ≡ matchLensRule; dispersion ≡ contagem por terminal; p-value binomial ≡ controle; FDR (BH); shrinkage rebaixa nicho; escopo por nó ≡ sub-base; dedup; determinismo
│   └── workerPool.test.js         # GATE Execução Híbrida H3: pool ≡ single-worker número a número (Descoberta + Combinada) via pool mock (jobs fora de ordem); determinismo sob ordens de conclusão diferentes; fallback (pool null ≡ síncrono)
│   └── simulationTick.test.js    # GATE M6: passe único do tick ≡ composição das 4 funções originais
│   └── computeRouter.test.js      # GATE Execução Híbrida H4: Classe A jamais roteia; detecção (indisponível/lento/versão errada) silenciosa; Classe B sidecar (dataset por hash HEAD→POST, progresso) com fallback transparente na queda do job
├── docs/
│   ├── HANDOFF.md                # Documento de handoff para desenvolvimento corporativo
│   └── wiki/                     # Documentação sincronizada com GitHub Wiki
│       ├── Arquitetura.md
│       ├── Epicos-*.md
│       ├── Copiloto-*.md
│       ├── Otimizacao-Memoria.md # Plano de otimização de memória para datasets grandes
│       ├── PERFORMANCE-ANALISE.md # Backlog de performance M1–M15 (Fases A–D)
│       ├── SECURITY-AND-ENTERPRISE-READINESS.md
│       ├── Roadmap.md
│       ├── Decisoes.md
│       └── _Sidebar.md
├── release/                      # Artefato de build (commitado via CI)
│   ├── index.html
│   ├── assets/
│   ├── iniciar.bat               # Abre a aplicação no navegador (Windows)
│   ├── serve.py                  # Servidor local COOP/COEP + monta o sidecar em /api/compute/*
│   ├── sidecar.py                # Execução Híbrida H5 — Motor Python (stdlib) importado por serve.py
│   ├── python/                   # Instalação do Motor Python (opt-in)
│   │   ├── requirements.txt      #   tier full (numpy/scipy) + extras (sklearn/duckdb)
│   │   ├── instalar_motor.bat    #   venv + pip do índice; wheels/ como contingência (P1)
│   │   ├── checar_ambiente.py    #   sonda HP (movida da raiz) — testa install/import na máquina
│   │   └── wheels/               #   wheels offline de CONTINGÊNCIA (vazia por padrão; só LEIAME)
│   └── ...
├── tests_python/                 # GATE H5 (pytest): protocolo do sidecar (health/token/caps/dataset/job)
├── .github/workflows/
│   ├── build-release.yml         # Build automático em push para main → commit em release/
│   ├── test-sidecar.yml          # Job SEPARADO e OPCIONAL: pytest do sidecar (não bloqueia o build)
│   └── sync-wiki.yml             # Sincroniza docs/wiki/ com o GitHub Wiki
├── vite.config.js                # Build config + injeção de metadados de build
├── vitest.config.js              # Config dos testes (jsdom)
├── Amostra_Fake.csv              # Amostra real usada por GATEs (ex.: tests/compiledEngine.test.js)
├── package.json
└── index.html
```

## Estrutura de dados (src/App.jsx)

### Estado principal
- `shapes`: formas no canvas — tipos: `rect`, `circle`, `diamond`, `decision`, `port`, `approved`, `rejected`, `as_is`, `csv`, `simPanel`, `cineminha`, `decision_lens`, `frame`
- `conns`: conexões/setas entre shapes — `{id, from, to, label?}`
- `csvStore`: `{[csvId]: {name, headers, columns, rowCount, columnTypes, varTypes, asIsConfig}}` (formato colunar — ver "csvStore: entrada por dataset")
- `wizard`: modal de importação em 3 passos — `{file, filename, delimiter, hasHeader, step: 1|2|3, columnTypes, varTypes, asIsVar, asIsMapping, editCsvId, decimalSep, decimalSepConfident, parsedHeaders, parsedColumns, parsedRowCount, previewRows}`. Desde o M1 **não guarda** `rawText` nem `string[][]`: o parse vai direto para colunas dict (`parsedColumns`), o preview é uma amostra de ~100 linhas (`previewRows`) e trocar delimitador/cabeçalho relê o `File` handle (`file`)
- `vp`: viewport — `{x, y, s}` (posição + zoom)
- `axisModal`: modal de seleção de eixo do Cineminha — `null | {shapeId, col, csvId}`
- `optimModal`: modal de otimização do Cineminha (single) — `null | {shapeId, cellMetrics, frontier, scenarios, activeCard, proposedCells, sliderApprovalIdx, sliderInadReal, sliderInadInf, maxInadReal, maxInadInf, matrixZoom, matrixPanX, matrixPanY}`
- `johnnyModal`: otimizador multi-cineminha — `null | {pooledMetrics, frontier, scenarios, mixCats, shapeMetas, baselineApprovalRate, activeCard, proposedByShape, sliderApprovalIdx, sliderInadReal, sliderInadInf, maxInadReal, maxInadInf, activeShapePreview, riskLevels, hierarchyMode, inadMetric}`
- `goalSeekModal`: Goal Seek da política inteira (Copiloto Sessão 4) — `null | {step:'form'|'loading'|'result', goal, constraints, baseline?, frontier?, moves?, goalReached?, bindingConstraint?, result?}` (ver "Motor de Goal Seek")
- `simplifyModal`: simplificação com prova de equivalência (Copiloto Sessão 5) — `null | {step:'loading'|'result', proposal, equivalence}` (ver "Simplificação com Prova de Equivalência")
- `docModal`: documentação automática (Copiloto Sessão 6) — `null | {step:'form'|'loading'|'result', includeDomains, compareCanvasId, compareIr?, compareName?, docModel?}` (ver "Documentação Automática")
- `lensModal`: modal de edição do Decision Lens — `null | {shapeId, rules, population}`
- `incrementalResult`: resultado comparativo AS IS vs. simulado — `null | {baseline, simulated, impacted}`
- ~~`simulationOverlay`~~: **removido** (Otimização de Memória Fase 4). O overlay por-linha (`rowDecisions`, ~1MM objetos) era clonado do worker pra main a cada tick e guardado num estado que **ninguém lia** — fonte de OOM no Canvas. Hoje o worker calcula o `incrementalResult` localmente e **não** envia o overlay; o Dashboard usa seu próprio overlay memoizado (`cachedCanvasOverlay`), independente
- `nodeArrivals`: contagem reativa de registros que chegam a cada nó por valor de domínio (worker, junto do `COMPUTE_OVERLAY`) — `{[nodeId]: {val|row|col: {[valor]: qty}}}` (ver Domínio Exibido)
- `domainModal`: modal "Configurar nó" (domínio exibido) — `null | {shapeId, draft:{val?|row?|col?: null|string[]}}`
- `lensCounts`: contagens de população impactada por lens, computadas no worker (M10) e recebidas no `OVERLAY_RESULT` — `{[lensId]: {count, total}}` (ponderadas pelo volume; alimentam o rótulo do nó `decision_lens`). As populações por-linha (`Uint8Array`) vivem só no worker, não na main
- `cinemaLibrary`: biblioteca de configurações de Cineminha salvas localmente — `array`
- `policyLibrary`: biblioteca de templates de PolicyIR (Copiloto Sessão 2) — `array` de `{id, name, description, tags, ir, requiredVars, savedAt}` (ver "Biblioteca de Políticas")
- `businessWidget`: widget de impacto de negócio flutuante — `{visible, x, y, w, h}`
- `activeTab`: aba ativa — `"analysis" | "canvas"` (padrão `"canvas"` — aba exibida no label como "Dashboard")
- `analyticsDataset`: dataset analítico largo cacheado do worker (`COMPUTE_ANALYTICS_DATASET`) — `null | AnalyticsDataset` (formato **colunar** desde a Otimização de Memória Fase 4 — ver Analytics Workspace / accessors `awColStr`/`awColNum`)
- `analyticsLayout`: gráficos do dashboard da aba Análise — `WidgetConfig[]` (ver Analytics Workspace)
- `analyticsGroupings`: agrupamentos (dimensões derivadas) reutilizáveis nos gráficos — `Grouping[]` (ver Agrupamentos). `groupedDataset` (useMemo) = `analyticsDataset` enriquecido por `applyGroupingsToDataset` — é o que a aba Dashboard consome
- `analyticsPageFilters`: filtro de página do Dashboard — `FilterCard[]` (ver Filtros). Combina por AND com o filtro de cada visual (`widget.config.filters`)
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
  cellsUserEdited: boolean,             // true = usuário mexeu nas caselas (bloqueia a prévia AS IS — ver Prévia AS IS)
}
```
- **Tipo `eligibility`**: ports `"Elegível"` (verde) e `"Não Elegível"` (vermelho)
- **Tipo `offer`**: ports `"Com Oferta"` (azul-claro) e `"Sem Oferta"` (amarelo)
- Chave de célula 1D-linha: `"${rowVal}|*"` / 1D-coluna: `"*|${colVal}"`
- **Prévia AS IS**: ao atribuir uma variável de eixo (`assignCinemaVar`), se as caselas ainda não foram editadas manualmente (`!cellsUserEdited`) e o dataset tem decisão histórica (`__DECISAO_ORIGINAL`), as caselas são pré-preenchidas como *baseline*: caselas com qualquer aprovação AS IS ficam elegíveis; uma casela só fica **não elegível** quando **100% do volume decidido da interseção é REPROVADO** (nenhuma aprovação). Qualquer edição manual (toggle, valor, otimizador, Johnny, biblioteca) grava `cellsUserEdited=true` e passa a sobrescrever a prévia. Persistido junto do shape (via `canvases`, sem bump de schema).
  - **Contextualizada ao nó (worker)**: a prévia respeita os **filtros a montante** (Decision Lens, ports, losangos) — é agregada só sobre a população que **efetivamente chega** a este cineminha pelo grafo de fluxo, não sobre a base completa da interseção. Por isso é computada no worker (`computeCinemaAsIsCells`, mensagem `COMPUTE_ASIS_PREVIEW`), de forma **assíncrona**: `assignCinemaVar` aplica primeiro as caselas herdadas (default elegível) e dispara a mensagem; a resposta `ASIS_PREVIEW_RESULT` substitui as caselas quando chega. Um **token por shape** (`asIsPreviewTokenRef`) descarta respostas obsoletas (reatribuição da variável antes da resposta chegar) e a aplicação é ignorada se o usuário já editou as caselas (`cellsUserEdited`). A regra de derivação é idêntica à de `computeAsIsCells` (mesmo GATE de paridade quando o cineminha é raiz, sem filtro a montante — `tests/asIsPreview.test.js`).

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
- `autoLayout()`: reorganização inteligente do canvas (botão **⊹ Reorganizar**) — ver seção "Reorganização Automática (Auto Layout)"
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
- `buildPolicyIR(shapes, conns, csvStore, opts?)`: deriva o **PolicyIR** (JSON canônico da política — Copiloto Sessão 0, DEC-IA-002) do canvas — ver seção "PolicyIR"
- `applyPolicyPatch(patch, base?)`: materializa um patch de PolicyIR de volta em `{shapes, conns, idMap}` (IDs via contador `_id`/`uid()` existente) — ver seção "PolicyIR"
- `extractPolicyRequiredVars(ir)` / `applyPolicyVarMapping(ir, mapping)`: variáveis exigidas por um PolicyIR (uma por nome distinto) e remapeamento delas antes de `applyPolicyPatch` — Copiloto Sessão 2, ver "Biblioteca de Políticas"
- `normalizeColName(s)`: normaliza nome de coluna para comparação fuzzy
- `exportDiagnosticCSV(shapes, conns, csvStore)`: gera CSV de auditoria com métricas de funil por nó+valor (aprovação, volume, inadimplência) para diagnóstico da política
- `pivotWidget(ds, config)`: pivot client-side genérico → `{state, data, series, metricDef, xCol, truncated}`; usado pelos gráficos do Analytics Workspace
- `resolveKpiScenarios(scenarios, kpiA, kpiB)`: resolve os cenários Baseline (A) e Comparação (B) do KPI a partir dos ids salvos no `WidgetConfig`, com fallback retrocompatível (A=AS IS, B=1º canvas; DEC-AW-008)
- `buildAnalyticsCSV(ds)` / `exportAnalyticsDatasetCSV(ds)`: serializa/baixa o dataset analítico largo como CSV (dimensões + métricas intrínsecas + uma coluna de decisão por cenário, incl. AS IS), com BOM e escape RFC 4180 — abrível no Excel (5C)
- `computeWidgetMetric(ds, indices, metricId, decisionCol)`: agrega 1 métrica sobre um conjunto de linhas do dataset largo **colunar** (`indices`: `Int32Array|number[]|null`, null = todas as linhas ativas), replicando a semântica do motor (numeradores acumulados só sobre `APROVADO`). Suporta `approvedAltasInfer` (∑ qtdAltasInfer sobre aprovados = Vol. Vendas Inferidas)

### Padrão de refs
Toda variável de estado crítica tem um ref espelho para uso em event listeners sem closure stale. Em todo `setX(...)`, o ref correspondente é atualizado imediatamente.

Refs existentes: `vpR`, `shapesR`, `connsR`, `toolR`, `fromIdR`, `editR`, `csvStoreR`, `activeCellR`, `panelDragR`, `editConnR`, `axisModalR`, `multiSelR`, `selRectR`, `selR`, `undoStackR`, `redoStackR`, `lensModalR`, `johnnyModalR`, `businessWidgetR`, `cinemaLibraryR`, `canvasesR`, `activeCanvasIdR`.

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
| `RUN_SIMULATION` | `{shapes, conns}` | Lê (ou computa) o tick via `getTickResult` (M6, ver abaixo) e responde com `SIMULATION_RESULT` |
| `COMPUTE_OVERLAY` | `{shapes, conns}` | Lê (ou computa) o mesmo tick via `getTickResult` (M6) e responde com `OVERLAY_RESULT` |
| `COMPUTE_ASIS_PREVIEW` | `{shapes, conns, targetIds, reqTokens}` | Prévia AS IS **contextualizada ao nó** (respeita filtros a montante). Roda `computeCinemaAsIsCells` sobre os cineminhas em `targetIds`; responde com `ASIS_PREVIEW_RESULT`. Disparada por `assignCinemaVar` — ver Prévia AS IS |
| `COMPUTE_OPTIM` | `{shape}` | Roda `computeCellMetrics` + `buildParetoFrontier` + `extractScenarios`; responde com `OPTIM_RESULT` |
| `COMPUTE_JOHNNY` | `{shapes, cinemaIds, conns, riskLevels?, hierarchyMode?, inadMetric?}` | Roda `computeCinemaArrivals` + `computeJohnnyData` com greedy+precedência; responde com `JOHNNY_RESULT` |
| `COMPUTE_ANALYTICS_DATASET` | `{canvases}` | `canvases: [{id, nome, shapes, conns}]` — abas marcadas (cenários, 5B). Populações de lens derivadas no worker (M10). Roda `computeAnalyticsDataset`; responde com `ANALYTICS_RESULT` |
| `COMPUTE_GOAL_SEEK` | `{shapes, conns, goal, constraints, locks}` | Copiloto Sessão 4 — roda `computeGoalSeek` (catálogo de movimentos + busca gulosa com precedência/shrinkage/restrições + validação por re-simulação); responde com `GOAL_SEEK_RESULT` |
| `COMPUTE_SIMPLIFY` | `{shapes, conns}` | Copiloto Sessão 5 — roda `computeSimplify` (detecção de candidatos + aceitação incremental validada por `computeSimplifyEquivalence` + prova de equivalência linha a linha); responde com `SIMPLIFY_RESULT` |
| `COMPUTE_POLICY_DOC` | `{shapes, conns, ir, canvases, options}` | Copiloto Sessão 6 — `ir` chega PRONTO (`buildPolicyIR` só existe em `App.jsx`); `canvases: [{id, nome, shapes, conns}]` para a comparação de cenários (mesmo formato de `COMPUTE_ANALYTICS_DATASET`); `options: {includeDomains, activeCanvasId?, activeCanvasName?, compare?:{shapes,conns}}`. Roda `computePolicyDoc`; responde com `POLICY_DOC_RESULT` |
| `COMPUTE_SEGMENT_DISCOVERY` | `{shapes, conns, scope, params}` | Copiloto Sessão 10/12 — descoberta de segmentos. `scope`: `null` (base inteira) ou `{nodeId}` (população que chega ao nó). `params: {riskMetric:'inadReal'\|'inadInferida', minQty?, maxDepth?, beamWidth?, alpha?, maxFindings?}`. Roda `computeSegmentDiscovery` (achados + recomendações validadas + asis_divergence/anomaly + estabilidade); responde com `SEGMENT_DISCOVERY_RESULT` |
| `COMPUTE_SEGMENT_COMBINED` | `{shapes, conns, applies}` | Copiloto Sessão 12 — aplicação combinada de N recomendações. `applies: [{moves}]`. Aplica os patches EM SEQUÊNCIA sobre UM clone e valida por UMA re-simulação real (`computeSegmentCombined`) — nunca a soma dos deltas; responde com `SEGMENT_COMBINED_RESULT` |
| `POOL_JOB` | `{jobId, shapes, conns, moves}` | **Execução Híbrida H3** — shard do pool de workers aninhados. Chega SÓ nos pool-workers (o worker principal não posta a si mesmo): roda `segValidateMoves` (aplica moves + `runSimulation` + snapshot) sobre o `workerCsvStore` já semeado e responde com `POOL_JOB_RESULT`. Ver "Pool de Workers (Execução Híbrida H3)" |

### Mensagens de saída
| type | payload |
|------|---------|
| `SIMULATION_RESULT` | `{result: SimulationResult}` |
| `OVERLAY_RESULT` | `{incrementalResult, nodeArrivals, lensCounts}` — `nodeArrivals: {[nodeId]: {val\|row\|col: {[valor]: qty}}}` (ver Domínio Exibido); `lensCounts: {[lensId]: {count, total}}` (M10). **Não** envia mais o `overlay` por-linha (Otimização de Memória Fase 4) nem as populações de lens por-linha |
| `ASIS_PREVIEW_RESULT` | `{cellsByShape, reqTokens}` — `cellsByShape: {[shapeId]: {[cellKey]: 0\|1} \| null}` (null = dataset sem AS IS); `reqTokens` ecoado para a main descartar respostas obsoletas (ver Prévia AS IS) |
| `OPTIM_RESULT` | `{shapeId, cellMetrics, frontier, scenarios, maxInadReal, maxInadInf}` |
| `JOHNNY_RESULT` | `{pooledMetrics, frontier, scenarios, mixCats, shapeMetas, baselineApprovalRate, maxInadReal, maxInadInf}` ou `{error: 'no_data'}` |
| `ANALYTICS_RESULT` | `{dataset: AnalyticsDataset \| null}` — formato largo **colunar** (DEC-AW-003 + Otimização de Memória Fase 4): `{rowCount, columns:{[nome]:ColDef}, dimensions, temporalColumns, metrics, scenarios}`. `ColDef` = `{kind:'dict', dict, codes:Int32Array}` \| `{kind:'num', data:Float64Array}`. Os `ArrayBuffer`s das colunas são **transferidos** (zero-cópia) no `postMessage` |
| `GOAL_SEEK_RESULT` | `{goal, baseline, frontier, moves, goalReached, bindingConstraint, result}` — ver seção "Motor de Goal Seek" |
| `SIMPLIFY_RESULT` | `{proposal, equivalence}` — ver seção "Simplificação com Prova de Equivalência" |
| `POLICY_DOC_RESULT` | `{docModel}` — ver seção "Documentação Automática" |
| `SEGMENT_DISCOVERY_RESULT` | `{segmentModel}` — ver seção "Descoberta de Segmentos" |
| `SEGMENT_COMBINED_RESULT` | `{combined}` — `{baseline, combined, combinedApprovalDelta, combinedMovedQty, sumApprovalDelta, sumMovedQty, individual, interaction:{interacts, overlapQty, note}}` (Sessão 12) |
| `POOL_JOB_RESULT` | `{jobId, snapshot}` \| `{jobId, error}` — resposta do pool-worker a um `POOL_JOB` (H3). `snapshot` = resultado de `segValidateMoves`; `error` (candidato que estourou) vira delta null / recomputo inline no orquestrador |

### Funções no worker
- `computeSimulationTick(shapes, conns, csvStore, lensPopulations)` (M6 — passe único do tick de edição): funde, numa única iteração por csv×linha, o que antes eram 4 varreduras completas e independentes da base (`runSimulation` + `computeSimulatedDecisions` + `computeIncrementalResult` + `computeNodeArrivals`). Índices de coluna e mapas de aresta por nó são resolvidos uma vez por nó/csv (não por linha); o "visited" do walk é um array de época reutilizado (sem `new Set()` por linha); o buffer do caminho (edgeStats) é reaproveitado entre linhas. Preserva a diferença sutil entre as raízes usadas pela simulação/overlay (só a 1ª raiz por csv) e pelas chegadas por nó (todas as raízes, critério mais estrito — exclui nós logo abaixo de um Decision Lens). Retorna `{simResult, incrementalResult, nodeArrivals}`. Chamada por `getTickResult` (cache single-slot chaveado por `csvStoreVersion + shapes + conns`, mesmo padrão do `cachedCanvasOverlay`): a primeira das mensagens `RUN_SIMULATION`/`COMPUTE_OVERLAY` de um mesmo tick computa o passe único; a segunda só lê do cache. Equivalência numérica exaustiva com o caminho antigo em `tests/simulationTick.test.js`
- `runSimulation(shapes, conns, csvStore)`: percorre todas as linhas de todos os CSVs pelo grafo, acumula métricas e retorna `SimulationResult`. Continua existindo/exportada sem alteração (usada pelos GATEs numéricos e por quem precisar do resultado isolado) — o tick de edição passa a usar `computeSimulationTick`, não esta função diretamente
- `computeSimulatedDecisions(shapes, conns, csvStore, lensPopulations)`: compara decisão simulada vs. `__DECISAO_ORIGINAL` por linha. Usada pelo `cachedCanvasOverlay` do Dashboard (overlay por canvas, independente do tick de edição). Desde o M8 roteia por **códigos do dicionário** em base colunar (fallback por string no legado) — ver seção M8
- `computeIncrementalResult(overlay, csvStore)`: agrega `baseline`, `simulated` e `impacted` a partir do overlay. Continua existindo/exportada sem alteração
- `computeCellMetrics(shape, csvStore)`: agrega métricas por célula do Cineminha
- `buildParetoFrontier(cellMetrics)`: fronteira Pareto greedy (sort por `inadInferida` crescente)
- `extractScenarios(frontier)`: `{conservador, balanceado, melhorEficiencia, expansao}` — `melhorEficiencia` é o joelho da curva
- `computeCinemaArrivals(shapes, conns, csvStore, lensPopulations)`: percorre o grafo de fluxo linha a linha e retorna `{[shapeId]: {[cellKey]: {qty, qtdAltas, qtdAltasInfer, inadRRaw, inadIRaw, mix}}}` — métricas filtradas pelas linhas que efetivamente chegam a cada Cineminha via roteamento (respeita losangos, decision_lens e ports a montante). Desde o M8 roteia por códigos (chave de célula via `keyByPair`, sem concat por linha) e só lê as métricas da linha quando ela chega a algum Cineminha
- `computeCinemaAsIsCells(shapes, conns, csvStore, targetIds)`: prévia AS IS **contextualizada ao nó** — percorre o grafo de fluxo (mesmo walk compilado de `computeCinemaArrivals`) e agrega o volume APROVADO/REPROVADO (`__DECISAO_ORIGINAL`) por casela **só sobre a população que chega** a cada cineminha de `targetIds` (respeita losangos, Decision Lens e ports a montante). Deriva as caselas com a **mesma regra** de `computeAsIsCells` (elegível=1, 0 só quando 100% do volume decidido é REPROVADO; sem volume → 1). Retorna `{[shapeId]: {[cellKey]: 0\|1} \| null}` (null = dataset do alvo sem AS IS). Alimenta `COMPUTE_ASIS_PREVIEW`. GATE `tests/asIsPreview.test.js` (paridade com `computeAsIsCells` quando raiz; contraste com filtro a montante; legado × colunar)
- `computeNodeArrivals(shapes, conns, csvStore, lensPopulations)`: percorre o fluxo a partir das entradas reais (in-degree 0 sobre arestas de fluxo — exclui corretamente um cineminha logo abaixo de um Decision Lens) e retorna, por nó, a contagem de registros por valor de domínio: `decision → {val: {[valor]: qty}}`, `cineminha → {row, col}`. Base do "Configurar nó" — ver Domínio Exibido. Continua existindo/exportada sem alteração — usada pelos testes; o tick de edição usa a mesma lógica de raízes fundida dentro de `computeSimulationTick`
- `computeJohnnyData(allShapes, cinemaIds, conns, csvStore, lensPopulations, riskLevels, hierarchyMode, inadMetric)`: greedy com restrição de precedência (DEC-JO-003/004) — constrói grafo de precedência com (a) monotonicidade interna por eixo ordinal e (b) aninhamento de cascata entre níveis de risco; a cada passo abre a célula liberada de menor inadimplência suavizada (shrinkage bayesiano); modo `independente` aplica só monotonicidade interna
- `computeAnalyticsDataset(canvasInputs, csvStore)`: recebe N abas marcadas (`[{id, nome, shapes, conns}]`; populações de lens derivadas no worker — M10), roda `computeSimulatedDecisions` por canvas (overlay memoizado via `cachedCanvasOverlay`), faz **join por `(csvId, rowIdx)`** e emite o dataset analítico **largo colunar** (Fase 4): dict encoding por dimensão + `__DECISAO_AS_IS` global + uma coluna dict `__DECISAO_<canvasId>` por cenário + `Float64Array` por métrica intrínseca. Os `ArrayBuffer`s são transferidos (zero-cópia) no `ANALYTICS_RESULT`; `scenarios` = AS IS + uma entrada por aba (nome = nome da aba) — ver Analytics Workspace
- `cachedCanvasOverlay(canvasId, shapes, conns, csvStore)`: overlay por canvas memoizado por hash de `shapes`/`conns` + `csvStoreVersion` (não reprocessa canvases intocados ao editar um só); deriva as populações de lens localmente no cache miss (M10)
- `computeGoalSeek(shapes, conns, csvStore, goal, constraints, locks, lensPopulations)`: busca gulosa com precedência sobre o catálogo de movimentos (Copiloto Sessão 4) — ver seção "Motor de Goal Seek"
- `buildGoalSeekCandidates(shapes, conns, csvStore, lensPopulations, lockedIds)`: catálogo de candidatos a movimento (`cinema_cell`, `decision_terminal`, `lens_threshold`) com precedência entre eles
- `computeGoalSeekArrivals(shapes, conns, csvStore, lensPopulations, lensColByShape)`: walk compilado (M8) que agrega métricas por segmento `(nó de decisão, valor)` e, para lens elegíveis a `lens_threshold`, por valor bruto da coluna da regra
- `computeGoalSeekBaseline(shapes, conns, csvStore)`: agregador paralelo a `runSimulation` que também expõe os somatórios brutos (`qtdAltasSum`, `inadRealSum`, etc.) — necessários para os deltas O(1) da busca
- `computeSimplify(shapes, conns, csvStore, nodeArrivals)`: ponto de entrada da Simplificação (Copiloto Sessão 5) — detecta candidatos, aceita-os incrementalmente (só os que preservam `diff=0`) e devolve `{proposal, equivalence}` — ver seção "Simplificação com Prova de Equivalência"
- `detectSimplifyCandidates(shapes, conns, nodeArrivals, lensStats)`: catálogo de candidatos (`collapsible_node`, `zero_arrival_node`, `redundant_variable`; `lens_no_effect` reusa o `apply` de `collapsible_node`) — cada um com um patch `apply` materializável por `applySimplifyCandidates` (`src/policySimplify.js`)
- `computeLensStats(shapes, conns, csvStore)`: walk dedicado (padrão `computeNodeArrivals`, generalizado a Decision Lens) — `{[lensId]: {arrived, passed}}`, base dos candidatos `zero_arrival_node`/`lens_no_effect` sobre lens (`nodeArrivals` não cobre lens)
- `computeSimplifyEquivalence(origShapes, origConns, propShapes, propConns, csvStore)`: prova de equivalência — compara o desfecho **por linha** (`computeRowOutcomes`, mesma classificação de `runSimulation`) de duas políticas; `identical` só é `true` com `diffCount===0`; quando não, o `delta` vem de `runSimulation` antes/depois de verdade (nunca estimado)
- `computePolicyDoc(shapes, conns, csvStore, ir, canvasInputs, options)`: ponto de entrada da Documentação Automática (Copiloto Sessão 6) — monta o `docModel` inteiro numa única passada; ver seção "Documentação Automática"
- `computeSegmentDiscovery(shapes, conns, csvStore, scope, params)`: ponto de entrada da Descoberta de Segmentos (Copiloto Sessão 10) — orquestra `discoverSegments` → `explainSegment` → `prioritizeFindings` e devolve o `SegmentModel`; ver seção "Descoberta de Segmentos"
- `discoverSegments(shapes, conns, csvStore, scope, metricSpec, params)`: estágio 1 (beam search 1D→2D sobre os dicionários das colunas Filtro, escopo global ou por nó via walk compilado M8) — devolve os candidatos crus + o `ctx` compartilhado (agregados do escopo, dispersão por linha, bins, coders). `metricSpec` resolvido por `resolveRiskMetric` (DEC-SD-006 — nenhuma função interna assume inad)
- `explainSegment(candidate, ctx)`: estágio 2 — decomposição WoE por condição (reusa `computeIV`/bins da Sessão 3), lift vs. complemento, teste binomial (`segBinomTwoSided`) e `dispersion` (nós/terminais onde a política decide o segmento hoje), tudo do mesmo walk do escopo
- `prioritizeFindings(explained, ctx, params)`: estágio 3 — FDR Benjamini–Hochberg (`segBenjaminiHochberg`) sobre todos os candidatos testados, gate de significância/oportunidade, score impacto × confiança × acionabilidade (shrinkage `SHRINK_K`), dedup de segmentos aninhados sem ganho incremental e `diagnostics` com contadores de descarte
- `computeFunnelByNode(shapes, conns, csvStore)`: funil por nó+valor — mesma travessia/acumulação de `exportDiagnosticCSV` (`App.jsx`), reimplementada aqui (worker não importa `App.jsx`) e estendida para atravessar `decision_lens` (a versão original de `exportDiagnosticCSV` para no primeiro lens do caminho — ver seção "Documentação Automática")
- `redactFunnel(funnel, includeDomains)`: Contrato de Privacidade aplicado ao funil — sem `includeDomains`, agrega as linhas por NÓ (perde a granularidade por valor, que é N2)
- `buildPolicyPaths(ir, maxPaths=500)`: regras achatadas raiz→terminal — DFS determinístico sobre o IR compondo as condições de cada nó no caminho (decisão enumera todas as rotas; Cineminha enumera os dois ramos); ciclo/destino ausente terminam o ramo com `terminal:null` + motivo, nunca inventam
- `buildFlowNodes(ir, includeDomains)`: descrição por nó do IR (mapeamento 1:1 sobre `ir.nodes` — garante completude por construção); domínios (`routes[].values`, `rowDomain`/`colDomain`, `blockedCells`, `rule.value`) só entram com `includeDomains`
- `computeReliability(funnelRows)`: substituto local do `InferenceSignal`/`confiabVolume` (feature removida — ver nota abaixo) — flags os segmentos do funil com menos de 30 altas (real ou inferida)
- `computeScenarioComparison(canvasInputs, csvStore, baseline, activeSimulated, activeId, activeName)`: comparação de cenários reaproveitando o par `computeSimulatedDecisions`/`computeIncrementalResult` do pipeline 5B (sem montar o dataset largo colunar, que existe para pivot de gráfico, não para uma tabela de poucas linhas); `null` sem baseline AS IS
- `buildGlossary(ir, csvStore, includeDomains)`: variáveis referenciadas no IR (mesma varredura de `extractPolicyRequiredVars`, reimplementada aqui) enriquecidas com metadados de `ir.datasets`; a lista de valores do domínio só é lida do `csvStore` com `includeDomains`

### M6 — Tick de edição: passe único em vez de ~4 varreduras da base (entregue)
Ver `docs/wiki/PERFORMANCE-ANALISE.md` (item M6, Fase C do backlog). Cada gesto de edição
disparava `RUN_SIMULATION` e `COMPUTE_OVERLAY` (mesmos deps/debounce em `App.jsx`), que
juntos percorriam a base **4 vezes** (`runSimulation`, `computeSimulatedDecisions`,
`computeIncrementalResult`, `computeNodeArrivals`), cada uma recalculando
`headers.indexOf`/mapas de aresta por rótulo **por linha** e alocando `new Set()`/`path=[]`
por linha. **Correção:** `computeSimulationTick` funde as quatro passadas numa única
iteração por csv×linha (índices de coluna e arestas pré-resolvidos por nó/csv, "visited"
por época em vez de `new Set()`, buffer de caminho reaproveitado); `getTickResult` cacheia
o resultado por tick (chave `csvStoreVersion + shapes + conns`, mesmo padrão do
`cachedCanvasOverlay`) para que a segunda mensagem do mesmo gesto (`RUN_SIMULATION` ou
`COMPUTE_OVERLAY`, o que chegar depois) não repita o cômputo. `runSimulation`,
`computeSimulatedDecisions`, `computeIncrementalResult` e `computeNodeArrivals` continuam
existindo/exportadas (usadas pelo `cachedCanvasOverlay` do Dashboard e pelos GATEs) —
nenhuma mudança de matemática. GATE de equivalência exaustiva (todas as combinações de
raiz/AS IS/lens/multi-csv/inferência ref) em `tests/simulationTick.test.js`. O motor
"compilado" sobre códigos do dicionário veio depois, no M8 (ver seção seguinte).

### M8 (D2) — Motor "compilado" sobre códigos do dicionário (entregue)
Ver `docs/wiki/PERFORMANCE-ANALISE.md` (item M8, Fase D do backlog). A base era colunar
com dictionary encoding (Fase 1), mas o motor decidia a rota de **cada linha**
re-materializando strings: `(cellStr(...) ?? '').trim()` + match de rótulo nos losangos,
`` `${rKey}|${cKey}` `` (concat + hash de string) no Cineminha e `matchLensRule`
(`parseFloat`/`toLowerCase`/`split(',')`) por linha nos lens. **Correção:** como a decisão
depende só do valor — e o nº de distintos é pequeno — tudo é pré-resolvido **uma vez por
nó×csv sobre o dicionário** (O(distintos)); no loop de linhas resta ler `codes[r]` e
seguir inteiros. Primitivas (em `simulation.worker.js`):
- `compileRoutes(shapes, conns, out)`: rotas por nó resolvidas uma vez sobre a topologia
  (`decisionRoutes` Map rótulo-trimado→{to,cid} first-wins, `cinemaRoutes`
  eligible/notEligible por rótulo exato, `singleEdge` p/ lens/port) — mesma semântica
  dos `find`s por linha que existiam.
- `compileDecisionNode`: `routeByCode[code]` + `valByCode[code]` (trim por distinto).
- `compileCinemaNode`: `eligByPair[rowCode*nC+colCode]` (`Uint8Array`) + `keyByPair`
  (chave de célula pronta) — teto `CINEMA_COMPILE_MAX_PAIRS = 2^16` pares; acima disso
  (eixo patológico de altíssima cardinalidade) o nó fica no caminho por-linha.
- `compileLensMatcher`: `passByCode: Uint8Array` por regra (matchLensRule avaliado uma
  vez por valor distinto; regra sobre coluna ausente vira constante; coluna não-dict cai
  no matchLensRule por-linha), combinadas com o mesmo AND/OR de `rowMatchesLensRules`.
Consumidores compilados: `computeSimulationTick` (tick de edição), `computeSimulatedDecisions`
(overlay do Dashboard), `computeCinemaArrivals` (Johnny) e `computeLensPopulations`.
Colunas não dict-encoded (legado `string[][]` dos testes, eixo sobre coluna métrica) caem
no caminho por-linha de antes — mesma matemática nos dois caminhos. `runSimulation`,
`computeNodeArrivals` e `computeIncrementalResult` seguem **sem alteração** como
referências de controle dos GATEs. GATE de equivalência colunar×legado (decision com
trim/duplicata/ciclo, cineminha 2D/1D/offer/fora-de-domínio/eixo-métrico, lens com
todos os operadores, AS IS e multi-csv) em `tests/compiledEngine.test.js`. Ordem de
grandeza (1MM linhas, bench local): tick fundido compilado ~0,7s contra ~1,4s de
**um único** passe por string; overlay do Dashboard ~0,2s.

## Analytics Workspace (aba Dashboard)

Segunda aba da aplicação (`activeTab: "analysis"`, label exibido: "Dashboard") — builder de dashboards sobre os resultados da simulação. A aba padrão ao carregar é `"canvas"`. Ver `docs/wiki/Epicos-AnalyticsWorkspace.md`.

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
  filtro do visual e devolve o dataset largo com `activeRows` (máscara `Int32Array` de
  índices sobreviventes — não copia linhas; Fase 4) restringindo a base; ignora cartões cuja
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
- Retorna `{ totalQty, approvedQty, rejectedQty, asIsQty, approvalRate, inadReal, inadInferida, edgeStats }`
  - `inadReal = ∑ inadRRaw / ∑ qtdAltas` (null se qtdAltasSum = 0)
  - `inadInferida = ∑ inadIRaw / ∑ qtdAltasInfer` (fallback: `/ approvedQty` se qtdAltasInferSum = 0)
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
Com 2 ou mais nós Cineminha selecionados, a toolbar contextual exibe **⚡ Otimização Johnny (N)**. Dispara `COMPUTE_JOHNNY` no worker com todos os shapes do canvas, os IDs dos cineminhas selecionados e as conexões (as populações de lens são derivadas no worker — M10).

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

### Resgatar AS IS
Botão **↺ Resgatar AS IS** no rodapé do `johnnyModal` (habilitado só quando algum
dataset dos cineminhas tem `__DECISAO_ORIGINAL`): preenche `proposedByShape` de todos
os cineminhas via `computeAsIsCells` (baseline da decisão histórica — caselas com
aprovação ficam elegíveis; só as 100% reprovadas ficam não elegíveis), recalcula o
índice de slider mais próximo e marca `activeCard='personalizado'`. É apenas proposta
até clicar em **⚡ Aplicar**.

### Aplicar
`applyJohnnyResult(proposedByShape)` — sobrescreve `cells` em múltiplos Cineminhas simultaneamente (grava `cellsUserEdited=true`).

## Motor de Goal Seek (`goalSeekModal`, Copiloto Sessão 4)

Generaliza o Johnny (acima) da célula de Cineminha para a **política inteira**: o usuário
declara um objetivo estruturado e o motor busca uma sequência de movimentos concretos —
não só abrir/fechar célula, mas também trocar o terminal de um segmento de losango e
relaxar/apertar o limiar de uma regra de Decision Lens — que atinja o objetivo. Ver
`docs/wiki/Copiloto-SugestoesMelhoria.md` (Sessão 4) e `docs/wiki/Epicos-CopilotoIA.md`
(DEC-IA-005/006).

### Catálogo de movimentos
Cada candidato tem agregados de segmento conhecidos (mesma técnica de
`computeCinemaArrivals`/`exportDiagnosticCSV`) — trocar o destino de um segmento muda os
acumuladores globais por adição/subtração, sem re-simular a base a cada candidato:
- **`cinema_cell`**: reusa `computeCinemaArrivals` — mesma mecânica do Johnny.
- **`decision_terminal`**: um VALOR de losango cujo port resolve **diretamente** (seguindo
  cadeias de port, como o `resolveThroughPorts` do PolicyIR) a um terminal Aprovado/
  Reprovado — trocar esse terminal move o segmento inteiro sem ambiguidade. Segmentos que
  resolvem em AS IS ficam fora do catálogo (o terminal depende de `__DECISAO_ORIGINAL`
  por linha, não é um destino único).
- **`lens_threshold`**: um Decision Lens de **uma** regra (`gte`/`gt`/`lte`/`lt`) cujo
  único port de saída resolve direto a **Aprovado** — relaxa (admite o próximo valor que
  hoje falha) ou aperta (remove o valor mais próximo da fronteira que hoje passa) por
  **um passo** por execução. Lens com saída para Reprovado/AS IS ou com mais de uma regra
  ficam fora do catálogo (extensível por design).
- **`add_break`** (Sessão 12): a "quebra que falta" — INSERE um losango (1 condição) ou
  Cineminha (2 condições) ANTES de um nó âncora, roteando o sub-segmento acionável a um
  terminal e o resto de volta ao âncora. NÃO é gerado pela busca do Goal Seek (não tem
  agregado O(1) por candidato); é gerado pelo achado `heterogeneous_block`/exceção da
  **Descoberta de Segmentos** (`segBuildBreakMove`) e materializado pelo MESMO applier
  (`applyGoalSeekMoves`, `src/goalSeek.js`) — entregando a pendência declarada da Sessão 4.
  O "🎯 Enviar ao Goal Seek" da Descoberta pré-carrega o objetivo para o refino fino aqui.

### Busca
Greedy com precedência + shrinkage bayesiano (`SHRINK_K`, mesmo padrão do
`computeJohnnyData`), generalizando o pool de "células" do Johnny para candidatos
heterogêneos com direção (`toApproved`): candidatos que movem qty PARA o aprovado
("expandir", usados quando a direção do objetivo é `increase`) ou PARA fora dele
("contrair", usados em `decrease`). Precedência (`requires`) é construída por tipo:
monotonicidade em eixo ordinal do Cineminha (idêntica ao Johnny) e em variável ordinal do
losango (a ordem dos ports no canvas define a posição — não pula rank mesmo que um valor
mais distante seja individualmente mais barato). Travas 🔒 (`shape.locked`, alternável na
toolbar contextual de losango/Cineminha/Decision Lens; ou a lista `locks` da mensagem)
excluem candidatos do nó inteiro **antes** da busca. Restrições de teto
(`constraints.maxInadReal`/`maxInadInf`, ratio 0–1) são invioláveis — um movimento que
estouraria o teto nunca entra na proposta; se nenhum candidato liberado cabe, a busca para
e reporta `bindingConstraint` (`'maxInadReal'`\|`'maxInadInf'`\|`'no_more_moves'`).

### Estado `goal`/`constraints` (payload de `COMPUTE_GOAL_SEEK`)
```js
goal = {
  target: 'approvalRate'|'inadReal'|'inadInferida'|'approvedAltasInfer',
  direction: 'increase'|'decrease',
  magnitude: number|null,  // null = "mínimo"/"máximo" possível dentro das restrições
  minimize: 'inadReal'|'inadInferida', // objetivo colateral que orienta a ordem dos candidatos
}
constraints = { maxInadReal: number|null, maxInadInf: number|null } // tetos, ratio 0–1
```

### Validação por re-simulação (DEC-IA-005)
Ao final da busca (sucesso ou parcial), os movimentos aceitos são materializados de
verdade — `applyGoalSeekMoves(shapes, conns, moves, idMap?)` em **`src/goalSeek.js`**
(módulo compartilhado entre o worker e a main thread, que não se importam entre si: o
worker usa para a validação interna, `idMap` omitido; a main usa para aplicar de verdade
no clone do canvas, `idMap` de `cloneCanvasWithNewIds`) — e **re-simulados**
(`runSimulation`). Nenhum número exibido no `goalSeekModal` tem origem só no delta
incremental interno da busca — o campo `result` de `GOAL_SEEK_RESULT` vem sempre dessa
re-simulação real.

### Taxa de aprovação escopada à política (denominador = população decidida)
A **taxa de aprovação** do Goal Seek (baseline, fronteira e `result`) é medida sobre a
**população que a política de fato decide** — as linhas que chegam a QUALQUER terminal
(Aprovado/Reprovado/AS IS) — e **não** sobre a base inteira. Numa política **parcial**
(atrás de um Decision Lens que restringe a sub-população, ex.: só certas safras/ADABAS),
a base inteira dilui a taxa a ponto de torná-la ininteligível: aprovar 72,8% do que a
política decide aparecia como "3,35%" porque ~95% das linhas ficavam fora do escopo mas
no denominador. `computeGoalSeekBaseline` acumula `decidedQty` (soma de `qty` das linhas
com `res != null`); `goalSeekRatios` divide `approvedQty / decidedQty` (fallback
`totalQty` p/ retrocompat); o delta O(1) só mexe em `decidedQty` para movimentos
`lens_threshold` (que admitem/removem linhas do escopo) — `cinema_cell`/`decision_terminal`
mantêm o denominador fixo (a linha já estava no escopo, só troca de terminal). O
`result.approvalRate` é reescopado a partir da re-simulação (`approvedQty /
(approvedQty+rejectedQty+asIsQty)`). Sem filtro a montante `decidedQty == totalQty` e a
taxa coincide com a de `runSimulation` (o GATE `tests/goalSeek.test.js` é invariante).
**Nota:** o SimPanel/`incrementalResult` e o gráfico do Dashboard continuam com denominador
de base inteira (contrato de vários GATEs) — daí a mesma política aparecer como ~3% no
painel e ~73% escopada no Goal Seek. Alinhar o SimPanel a esse escopo é um follow-up.

### Estado `goalSeekModal`
```js
{
  step: 'form'|'loading'|'result',
  goal, constraints,                 // objetivo em edição
  baseline, frontier, moves,         // devolvidos por GOAL_SEEK_RESULT (step==='result')
  goalReached, bindingConstraint, result,
}
```
`moves[i]`: `{id, type, shapeId, label, qty, qtdAltas, qtdAltasInfer, inadRRaw, inadIRaw, deltaApprovalRate, apply}` — `apply` é o patch mínimo que `applyGoalSeekMoves` materializa (`{type:'cinema_cell', shapeId, cellKey, newValue}` \| `{type:'decision_terminal', connId, newTo}` \| `{type:'lens_threshold', shapeId, ruleIndex, newValue}`).

### Travas (`shape.locked`)
Novo campo booleano em qualquer shape de fluxo (`decision`/`cineminha`/`decision_lens`),
alternável pelo botão 🔒/🔓 na toolbar contextual de cada um. Persiste via `canvases` (não
precisa de entrada própria no Projeto — é só mais um campo de shape, já coberto). Também
respeitado pelos otimizadores futuros que quiserem checar `shape.locked`.

### Ativação e aplicação
Botão **🎯 Atingir Objetivo** na seção Fluxo do painel direito (`openGoalSeekModal`) abre
o formulário; **🔎 Buscar** dispara `COMPUTE_GOAL_SEEK` (`runGoalSeek`); **✓ Aplicar como
novo cenário** (`applyGoalSeekResult`) materializa os movimentos numa aba de canvas **nova**
(`cloneCanvasWithNewIds` + `applyGoalSeekMoves`, mesmo padrão não-destrutivo do
`duplicateCanvas` da Sub-sessão 5A) — a política de origem fica intocada, comparável
imediatamente no Dashboard/KPI A vs B.

### Teste
`tests/goalSeek.test.js` — GATE: delta O(1) por movimento (dos três tipos do catálogo) ≡
re-simulação completa via `runSimulation`; monotonicidade ordinal preservada mesmo quando
o segmento mais barato não é o primeiro do domínio; nenhum ponto da fronteira viola
teto/trava; objetivo inatingível reporta o melhor parcial + a restrição-gargalo;
determinismo (mesma entrada ⇒ mesma proposta).

## Simplificação com Prova de Equivalência (`simplifyModal`, Copiloto Sessão 5)

Generaliza o padrão de detecção estrutural da Sessão 1 (`computePolicyInsights`) para
**propor** uma política reduzida — não só apontar o achado, mas religar o roteamento e
**provar** que a redução não muda nenhuma decisão. Ver `docs/wiki/Copiloto-SugestoesMelhoria.md`
(Sessão 5) e `docs/wiki/Epicos-CopilotoIA.md` (DEC-IA-005/006).

### Catálogo de candidatos (`detectSimplifyCandidates`, worker)
Cada candidato carrega um `apply` mínimo (nunca referencia x/y/layout), materializável por
`applySimplifyCandidates` (**`src/policySimplify.js`** — módulo compartilhado worker/main,
mesmo motivo de `src/goalSeek.js`: os dois precisam da MESMA lógica de aplicação sem se
importar um ao outro):
- **`collapsible_node`**: losango cujos valores TODOS roteiam pro mesmo destino final (via
  `resolveThroughPortsSimplify`, mesma semântica de `resolveThroughPorts` do PolicyIR);
  Cineminha cujos ports Elegível/Não Elegível vão pro mesmo destino; ou Decision Lens cuja
  regra deixa passar 100% do volume que chega (**`lens_no_effect`** — mesmo código de
  achado distinto, mas reusa o `apply` de `collapsible_node`, já que a operação é idêntica:
  colapsar o nó pro próprio destino). `apply: {type:'collapse_node', nodeId, destId}` —
  religa as arestas de ENTRADA do nó direto pro destino e remove o nó + portas próprias
  (as únicas apontadas exclusivamente por ele).
- **`zero_arrival_node`**: losango/Cineminha (via `nodeArrivals` do tick — `totalArrivalOf`
  soma os valores/eixo) ou Decision Lens (via `computeLensStats`, um walk DEDICADO — o
  `nodeArrivals` do tick não cobre lens) que nunca recebe volume na base atual. `apply:
  {type:'prune_node', nodeId}` — remove o nó + descendentes EXCLUSIVOS (sem outra entrada
  externa sobrevivente, cascata por ponto fixo).
- **`redundant_variable`**: losango D2 que retesta a MESMA coluna+csv já decidida por um
  losango D1 a montante, alcançado por uma cadeia DIRETA de ports a partir de um valor
  FIXO v — quem chega aqui já tem coluna==v (garantido por D1), então D2 só pode
  discriminar o próprio ramo de v; os demais nunca chegam. `apply: {type:'reroute_edge',
  connId, newTo}` — religa só a aresta específica (a que liga o último port da cadeia a
  D2) pro destino que D2 daria pra esse v; D2 em si não é removido (pode ser alcançado por
  outros caminhos).

**Limitação importante**: um nó que é ele mesmo a ÚNICA raiz do fluxo (sem nó a montante)
não pode virar candidato `collapsible_node`/`lens_no_effect` de forma útil — o motor exige
pelo menos um nó decision/cineminha/lens como raiz pra sequer começar a andar pela base
(`runSimulation`: `rootNodes.length===0` ⇒ nenhuma linha é processada); colapsar a raiz
única pra um terminal quebraria a política inteira. Os detectores não têm essa
restrição explícita — quem barra esse caso é a validação incremental abaixo (o candidato
é descartado por falhar a prova, nunca aplicado incorretamente).

### Prova de equivalência (`computeSimplifyEquivalence`, worker)
Compara o **desfecho por linha** de duas políticas via `computeRowOutcomes` (mesma
classificação de `runSimulation`, incl. fallback de AS IS via `__DECISAO_ORIGINAL`) — não
só os agregados, já que dois canvases podem empatar na taxa de aprovação com decisões
trocadas por baixo (troca quem é aprovado, sem mudar a soma). `identical` só é `true` com
`diffCount===0` (TODAS as linhas de TODOS os csvs decidem igual). Quando não é idêntico,
o `delta` reportado vem de `runSimulation` antes/depois de VERDADE — nunca estimado
(DEC-IA-005, mesmo contrato de validação do Goal Seek).

### Aceitação incremental (`computeSimplify`, worker)
Cada candidato do catálogo é validado um de cada vez, GREEDY, contra o estado JÁ ACEITO
(não contra o canvas original): só entra na proposta final se preservar `diff=0` sobre
esse estado intermediário. Por transitividade de igualdade linha a linha, a proposta final
inteira é `diff=0` contra a política ORIGINAL — a prova real do épico — **sem depender de
os detectores serem perfeitos**: um candidato que não é seguro (por interação com outro já
aceito, ou por ser a raiz única do fluxo — ver limitação acima) é descartado
silenciosamente, nunca contamina a proposta. Retorna:
```js
{
  proposal: {
    candidates,          // SimplifyCandidate[] aceitos — {id, code, nodeId, label, apply}
    consideredCount,     // total de candidatos detectados (incl. os rejeitados)
    totalNodeCount,       // shapes.length original
    removedNodeCount,     // quantos shapes a proposta remove
  },
  equivalence: { identical, diffCount, totalRows, delta },
}
```

### Estado `simplifyModal`
```js
null | {
  step: 'loading' | 'result',
  proposal,      // devolvido por SIMPLIFY_RESULT
  equivalence,   // devolvido por SIMPLIFY_RESULT
}
```
Sem etapa de formulário (ao contrário do `goalSeekModal`) — não há objetivo a declarar, só
a política atual a reduzir; **🧹 Simplificar** dispara `COMPUTE_SIMPLIFY` direto.

### Ativação e aplicação
Botão **🧹 Simplificar** na seção Fluxo do painel direito (`openSimplifyModal`) dispara
`COMPUTE_SIMPLIFY` direto (sem formulário); o resultado lista as simplificações propostas
(ícone + rótulo por tipo, `SIMPLIFY_CODE_META`) e a prova (✅ idêntica / ⚠ delta
declarado); **✓ Aplicar como novo cenário** (`applySimplifyResult`) materializa os
candidatos aceitos numa aba de canvas **nova** (`cloneCanvasWithNewIds` +
`applySimplifyCandidates`, mesmo padrão não-destrutivo do Goal Seek/Sub-sessão 5A) — a
política de origem fica intocada, comparável imediatamente no Dashboard/KPI A vs B.

### Teste
`tests/policySimplify.test.js` — GATE: nó colapsável (losango e Cineminha) ⇒ proposta
reduz e `computeSimplifyEquivalence` prova `diff=0`; nó com chegada zero (losango/Cineminha
via `nodeArrivals`, Decision Lens via `computeLensStats`) ⇒ removível sem alterar nenhuma
decisão; regra de lens sem efeito e variável re-testada ⇒ detectados e colapsados/religados
sem perda; prova de equivalência **lossy** (par de canvases deliberadamente diferente,
testando a primitiva `computeSimplifyEquivalence` direto, sem passar pelo detector) ⇒
`diffCount` e `delta` batem com o cálculo manual via `runSimulation` antes/depois;
determinismo (mesma entrada ⇒ mesma proposta).

## Documentação Automática (`docModal`, Copiloto Sessão 6)

Gera, a partir da política viva (canvas + resultados de simulação), um documento
executivo/técnico com sumário, fluxo em linguagem natural templateada, regras achatadas,
funil por nó, comparação de cenários, confiabilidade amostral, glossário e changelog
estrutural — sem IA generativa (a documentação de uma estrutura formal é serialização +
templates, não geração criativa). Ver `docs/wiki/Copiloto-DocumentacaoAutomatica.md` e
`docs/wiki/Epicos-CopilotoIA.md` (DEC-IA-006).

### Separação dados/apresentação
`COMPUTE_POLICY_DOC` (worker) devolve um **docModel** — árvore de seções com dados
NUMÉRICOS CRUS, nunca prosa pronta. A apresentação (`renderDocMarkdown`/`renderDocHTML`,
`src/App.jsx`) é feita por funções PURAS na main que só leem o docModel — separação que
torna o Nível 2 (reescrita em prosa por IA) trivial (a IA recebe o docModel, não HTML) e o
GATE mais robusto (determinismo/privacidade verificáveis só inspecionando string de saída).
`buildPolicyIR` só existe em `App.jsx` (Sessão 0) — a main monta o IR ANTES de disparar
`COMPUTE_POLICY_DOC` e ele viaja pronto no payload; o worker nunca importa `App.jsx` (mesmo
motivo de `buildFlowGraph`/`matchLensRule` estarem duplicados lá).

### `docModel`
```js
{
  version, generatedAt, options: {includeDomains},
  meta: {name, nodeCount, entryCount},
  ir,                          // PolicyIR pass-through (buildPolicyIR, construído na main)
  flowNodes,                   // 1 entrada por ir.nodes (bijeção — completude por construção)
  paths: {list, truncated},    // regras achatadas raiz→terminal (buildPolicyPaths)
  kpis: {simResult, incrementalResult},   // MESMO tick de edição (computeSimulationTick)
  funnel: {rows, totals},      // funil por nó+valor (computeFunnelByNode + redactFunnel)
  reliability: {minSample, lowSampleRows, hasLowSample},
  scenarios: null | {rows},    // AS IS + cenário atual + abas marcadas (5B) — null sem AS IS
  glossary,                    // variáveis referenciadas no IR + metadados de coluna
  changelog?,                  // só quando o usuário escolheu "comparar com" — ver abaixo
  compareKpis?,                // KPIs da política de comparação (worker) — insumo do changelog
}
```

### Contrato de Privacidade aplicado ao papel (`options.includeDomains`)
Domínios de valores (rótulos concretos: `R01`, `Digital`, chaves de célula do Cineminha,
`rule.value` do lens) são N2 (Contrato de Privacidade, DEC-IA-004) — só entram no
documento com o toggle ligado (desligado por padrão no `docModal`, já que o documento pode
circular fora do sistema). Nomes de coluna e CONTAGENS (N0/N1) aparecem sempre. A
redação acontece no worker, na montagem do docModel (não no renderer): `buildFlowNodes`
troca `values`/`rowDomain`/`colDomain`/`blockedCells`/`rule.value` por `null` (mantendo
`valueCount`/`totalCells`/`blockedCount`); `redactPathConditions` faz o mesmo nas condições
dos paths; `redactFunnel` AGREGA o funil por nó (perde a granularidade por valor, que é
domínio); `buildGlossary` só lê o dicionário do `csvStore` quando `includeDomains`. GATE:
`tests/policyDoc.test.js` varre o Markdown/HTML gerados por nenhum literal de domínio da
fixture.

### Regras achatadas (`buildPolicyPaths`)
DFS determinístico a partir de `ir.entry`, compondo as condições de cada nó no caminho:
decisão enumera TODAS as rotas (já achatadas pelo IR); Cineminha enumera OS DOIS ramos
(elegível/não elegível); lens segue a única saída. Ciclo (nó revisitado no mesmo caminho)
ou destino ausente/inexistente terminam o ramo com `terminal:null` + `reason` — nunca
lançam nem inventam um terminal. `maxPaths` (teto de segurança) sinaliza `truncated` em vez
de travar numa política patológica.

### Funil por nó+valor (`computeFunnelByNode`)
Mesma travessia/acumulação de `exportDiagnosticCSV` (`App.jsx`) reimplementada no worker
(que não importa `App.jsx`) — com uma diferença: `exportDiagnosticCSV` não tem um `case`
para `decision_lens` no walk (para no primeiro lens do caminho), o que nunca foi notado
porque o CSV de diagnóstico é sempre dominado por losangos/Cineminha em série;
`computeFunnelByNode` ATRAVESSA lens corretamente (mesma semântica de
`computeSimulationTick`/`runSimulation`: passa se a linha casa as regras, senão a linha não
é roteada por este fluxo) — necessário porque o docModel documenta políticas com Decision
Lens como raiz. `redactFunnel` agrega por nó quando os domínios estão desligados.

### Comparação de cenários (`computeScenarioComparison`)
Reaproveita o MESMO par de primitivas do pipeline 5B (`computeSimulatedDecisions` +
`computeIncrementalResult`) em vez do dataset largo colunar inteiro (que existe para pivot
de gráfico, não para uma tabela de poucas linhas): 1 overlay + 1 agregado por cenário
incluído (`buildAnalyticsCanvasInputs()`, mesma função do Dashboard). `baseline` (AS IS) é
o mesmo para todos os cenários — computado uma vez junto dos KPIs e reaproveitado. Sem AS
IS configurado em nenhum dataset, `scenarios` é `null` e o documento declara "Baseline AS
IS não configurada" (nunca omite a seção silenciosamente).

### Confiabilidade da amostra (`computeReliability`)
O épico documenta esta seção como um `InferenceSignal`/`confiabVolume` — sinalização que
dependia da **Tabela de Inferência de Referência, removida do produto** (ver bump de
schema 2.5). `computeReliability` mantém o ESPÍRITO da seção com o volume de altas já
presente no funil: sinaliza segmentos com menos de 30 altas (real ou inferida) — piso de
bom-senso estatístico para uma taxa não ser pura oscilação de amostra.

### Changelog estrutural (`diffPolicyIR`, `App.jsx`)
Função PURA que compara dois PolicyIR por `id` de nó — correto quando os dois IR vêm da
MESMA linhagem de canvas (edição in-place, comparação com outra aba do mesmo estudo: os
ids são estáveis). Comparar com um canvas clonado via `cloneCanvasWithNewIds` (ids todos
novos) degrada para "tudo removido + tudo adicionado" — limitação documentada, mesmo
padrão do "Limite documentado" do PolicyIR (Sessão 0). Retorna `{added, removed, changed,
entryChanged}` — `changed[].fields` lista só os campos que mudaram (`{key, before,
after}`). Reusável pelo chat (Nível 3) e pelo Goal Seek (exibir movimentos como "mudanças
de IR"), como sugerido no épico.

O CHANGELOG em si é montado na MAIN (não no worker): ao escolher "Comparar com" no
`docModal`, `runPolicyDoc` constrói `compareIr` (via `buildPolicyIR` sobre o outro canvas)
e envia `options.compare: {shapes, conns}` (só os dados, não o IR) — o worker roda o MESMO
`computeSimulationTick` sobre essa segunda política e devolve `compareKpis` no
`POLICY_DOC_RESULT`. O handler da main combina `diffPolicyIR(docModel.ir, compareIr)`
(estrutural, síncrono) com `compareKpis` (numérico, do worker) em `docModel.changelog` —
`diffPolicyIR` fica single-sourced em `App.jsx`, o worker só varre a base.

### Estado `docModal`
```js
null | {
  step: 'form' | 'loading' | 'result',
  includeDomains,       // toggle de privacidade (default false)
  compareCanvasId,      // id do canvas a comparar no changelog, ou null
  compareIr?, compareName?,  // guardados ao disparar, para o handler montar o changelog
  docModel?,             // devolvido por POLICY_DOC_RESULT
}
```
Efêmero, **não persistido** — mesmo padrão não-persistido de `goalSeekModal`/
`simplifyModal` (⚠️ regra do CLAUDE.md: não há nada CRIADO pelo usuário aqui, só uma
composição transitória de exibição).

### Ativação e exportação
Botão **📄 Documentar Política** na seção Fluxo do painel direito (`openDocModal`) abre o
formulário (toggle de domínios + seletor de comparação); **📄 Gerar Documento**
(`runPolicyDoc`) dispara `COMPUTE_POLICY_DOC`; o resultado mostra uma prévia (`<iframe
srcDoc>` do HTML renderizado) com **⬇ Markdown** (`downloadDocMarkdown`, padrão
`doExportPolicyIR`: Blob + `<a download>`) e **🖨 Imprimir / PDF** (`printDocHTML`: abre o
HTML numa nova janela e chama `window.print()` — o usuário salva como PDF pelo diálogo
nativo do navegador).

### Teste
`tests/policyDoc.test.js` — GATE: números do docModel ≡ `computeSimulationTick` (e o
renderer exibe os MESMOS tokens formatados, checagem literal de string); completude (todo
nó do IR aparece uma vez em `flowNodes`; paths cobrem exatamente os terminais alcançáveis a
partir das raízes); determinismo (duas gerações com a mesma entrada são idênticas, módulo
`generatedAt`); degradação (sem AS IS ⇒ aviso explícito no texto, nunca omissão
silenciosa); privacidade (toggle desligado ⇒ nenhum valor de domínio da fixture aparece no
Markdown/HTML — contraste positivo com o toggle ligado); changelog (`diffPolicyIR` entre
fixture A/A' com 1 célula de Cineminha mudada ⇒ exatamente essa mudança, delta de métricas
batendo com `computeSimulationTick` antes/depois, e o mesmo delta reproduzido via
`computePolicyDoc({..., options:{compare}})`).

## Descoberta de Segmentos (Copiloto Sessão 10/11/12, motor + UI — DEC-SD-001..006)

Motor de **subgroup discovery** que varre a base (ou a população de um nó) procurando
segmentos acionáveis onde a política atual está desalinhada com o comportamento observado.
Ver `docs/wiki/Copiloto-DescobertaSegmentos.md`. **Sessão 10 = motor de descoberta/explicação/
priorização + GATE; Sessão 11 = UI (modal, cards, quadrante); Sessão 12 = recomendações
materializáveis (patch + re-simulação real), aplicação combinada, achados `asis_divergence`/
`anomaly`, selo de estabilidade temporal e o movimento "adicionar quebra" do Goal Seek.**

### SegmentModel (padrão `docModel` — dados crus, nunca prosa)
`COMPUTE_SEGMENT_DISCOVERY` (worker) devolve:
```js
{
  version, generatedAt, scope,            // null (global) | {nodeId, label}
  metric: {id, label, direction},         // métrica-alvo resolvida (DEC-SD-006)
  population: {qty, decidedQty},
  findings: [SegmentFinding],             // ordenados por prioridade
  diagnostics: {candidatesTested, discarded:{lowVolume, notSignificant, unstable, duplicate, noOpportunity}},
}
  asIsTotals: {rToA, aToR},               // totais de promoções/rebaixamentos (Sessão 12)
}
// SegmentFinding = { id, code, segment:{conditions:LensRule[], scope}, metrics, explanation, priority, recommendation }
//   code: 'approvable_low_risk' | 'approved_high_risk' | 'heterogeneous_block' | 'asis_divergence' | 'anomaly'
//   metrics: {qty, share, qtdAltas, qtdAltasInfer, inadReal, inadInferida, refInadReal, refInadInferida, lift, currentDecision}
//     asis_divergence: {qty, share, rToA, aToR, rToAShare, aToRShare} · anomaly: {qty, share, rate, median, mad, z, temporal}
//   explanation: {contributions:[{col,value,sharePct}], dispersion:{...}, stability:null|{split:'temporal',holds}, stabilitySeries?:[{bucket,rate}], pValue, qValue}
//   priority: {score, impact:{deltaApproval, deltaInadInf, movedQty}, confidence, actionability}
//   recommendation: null | { kind:'goal_seek_move'|'add_break', targetTerminal, actionable, reason,
//                            apply:{moves:[...]}, goalSeek:{target,direction,magnitude,minimize}, delta }  (ver Sessão 12)
```
Segmento = **conjunção de `LensRule`** sobre colunas Filtro (DEC-SD-001) — imediatamente
interpretável e materializável (vira losango/Cineminha/movimento de Goal Seek na Sessão 12).

### Pipeline (três estágios desacoplados, testáveis)
- **`discoverSegments`** — beam search 1D→`maxDepth` (default 2) sobre os **dicionários** das
  colunas Filtro (`candidateCoder`/agregação O(distintos), PODADO — nunca produto cartesiano
  cego). Escopo global (`scope==null`) ou por nó (`scope.nodeId`): as linhas do escopo saem
  de um **walk compilado M8** (raiz do motor, como `runSimulation`) que também registra, por
  linha, o **terminal** e o **nó decisor** — base da `dispersion` (sem passe extra). Winner =
  csv de maior população no escopo (mesmo critério de `computeVariableRanking`; multi-csv é
  extensão). Devolve os candidatos crus + `ctx` compartilhado.
- **`explainSegment`** — decomposição **WoE aditiva** por condição (reusa a matemática
  good/bad de `computeIV`), **lift** vs. complemento, **teste binomial** de proporção
  (`segBinomTwoSided`: exato até `n≤1000`, aproximação normal acima) e **`dispersion`** ("por
  que nunca vi isso antes": em quantos nós/terminais a política decide o segmento hoje).
- **`prioritizeFindings`** — **FDR Benjamini–Hochberg** (`segBenjaminiHochberg`) sobre TODOS
  os candidatos de desvio testados; gate de significância (`qValue ≤ alpha`) + de oportunidade
  (código atribuído); **score = impacto × confiança × acionabilidade** (shrinkage `SHRINK_K`
  proporcional ao volume do escopo, penalidade por profundidade e por nó 🔒 travado); **dedup**
  de filho aninhado sem ganho incremental de |desvio| sobre o pai (parcimônia); `diagnostics`
  com contadores de descarte.

### Métrica-alvo estruturada (DEC-SD-006)
`resolveRiskMetric(riskMetric)` → `{numColType, denColType, direction, ...}`. O formulário só
oferece `inadReal`/`inadInferida` por ora, mas **nenhuma função interna assume inad** — todas
leem `numColType`/`denColType` genericamente (margem/churn/CAC são extensão do wizard, não do
motor).

### Achados desta sessão
- **`approvable_low_risk`**: segmento hoje **reprovado** com risco significativamente MENOR que
  a referência (aprovação deixada na mesa).
- **`approved_high_risk`**: simétrico — hoje **aprovado** com risco maior (vazamento de risco).
- **`heterogeneous_block`**: bloco de **tratamento único** (não `mixed`) internamente
  heterogêneo (IV ≥ `SEG_HET_MIN_IV` numa coluna candidata) — a "quebra que falta". Emitido no
  nível do escopo (depth-0); `contributions` = colunas discriminantes por share de IV.

### Recomendações materializáveis (Sessão 12 — estágio 4, DEC-SD-003)
`buildSegmentRecommendations(shapes, conns, csvStore, findings, ctx)` anexa a cada achado
acionável (deviation com código, `heterogeneous_block`) uma `recommendation` com **patch +
delta VALIDADO por re-simulação real** (`runSimulation` antes/depois — só top-N `SEG_MAX_VALIDATE`;
o card só exibe delta validado). **Nenhum aplicador novo** (DEC-IA-002): os patches são
movimentos do catálogo do Goal Seek (`applyGoalSeekMoves`):
- **`segCoincidenceMove`** — quando o segmento 1D coincide com um valor decidido DIRETO por um
  losango (port → terminal, via `resolveDirectTerminalConn`), a recomendação é um movimento
  `decision_terminal` (troca só aquele terminal).
- **`segBuildBreakMove`** — senão, o movimento NOVO **`add_break`** (a "quebra que falta"
  pendente da Sessão 4): insere um losango (1 condição / het) ou Cineminha (2 condições)
  ANTES do nó âncora (root do escopo ou nó de escopo), roteando o sub-segmento acionável ao
  terminal alvo e o resto de volta ao âncora. Materializado por `applyGoalSeekMoves` (em
  `src/goalSeek.js`, `genId` opcional) — mesma função/validador usado pela main no "Aplicar
  como novo cenário" (`applySegmentRecommendation` → `cloneCanvasWithNewIds` + `applyGoalSeekMoves`).
- `recommendation.goalSeek` pré-carrega o objetivo estruturado para **🎯 Enviar ao Goal Seek**
  (`sendSegmentToGoalSeek` abre o `goalSeekModal`); nó 🔒 travado ⇒ `actionable:false` + `reason`
  declarado, sem delta.

### Aplicação combinada (`computeSegmentCombined`, `COMPUTE_SEGMENT_COMBINED`)
Aplica N recomendações selecionadas **em sequência sobre UM clone** e valida por **UMA
re-simulação real** — **nunca a soma dos deltas individuais** (aplicar A muda a população que
chega ao ponto de B). Devolve `combinedApprovalDelta`/`combinedMovedQty` (união, re-simulada) +
`sumApprovalDelta`/`sumMovedQty` (soma dos isolados) + `interaction:{interacts, overlapQty, note}`
— o modal DECLARA a sobreposição em vez de escondê-la. Main: `runSegmentCombined` (seleção via
checkbox "combinar" no card) e `applySegmentCombinedAsScenario`.

### asis_divergence e anomaly (Sessão 12 — sem patch, só navegação)
- **`asis_divergence`** (`detectAsIsDivergence`): decompõe o rToA/aToR (promoções/rebaixamentos
  vs. AS IS) por valor de segmento, reusando o desfecho por linha do escopo + `__DECISAO_ORIGINAL`.
  A soma ≡ `incrementalResult.impacted` (GATE). `metrics: {rToA, aToR, rToAShare, aToRShare}`.
- **`anomaly`** (`detectAnomalies`): desvio robusto **mediana/MAD** (modified z-score ≥
  `SEG_ANOMALY_Z`) por valor e por **safra** (quando há coluna temporal). Sinalização de
  qualidade de dado. `metrics: {rate, median, mad, z, temporal}`.
- Ambos: `recommendation: null`; ação = **👁 Ver no Dashboard** (`FilterCard`) / **🎯 Ver no fluxo** (highlight).

### Estabilidade temporal (`attachStability`)
Selo split-half por período (`stability:{split:'temporal', holds}`) + `stabilitySeries` (sparkline
no card, `SegmentSparkline`) quando há coluna temporal; sem ela ⇒ `stability:null` (nunca inventado).

### Comportamento
Determinístico (mesma entrada ⇒ mesmo `SegmentModel`, incl. recomendações/deltas); agregados e
deltas sempre da agregação/re-simulação exata (nunca estimados); `segmentDiscoveryModal` efêmero
(não persiste — sem criação do usuário; ⚠️ regra do CLAUDE.md não se aplica).

### Teste
`tests/segmentDiscovery.test.js` — GATE: subgrupo plantado achado com condições exatas;
homogênea ⇒ zero achados; agregados ≡ `matchLensRule`; `dispersion` ≡ contagem manual por
terminal; p-value ≡ controle binomial manual; BH monótono; shrinkage rebaixa nicho; escopo por
nó ≡ sub-base; dedup; **delta exibido ≡ `runSimulation` antes/depois por tipo de recomendação
(add_break 1D/2D, movimento)**; **movimento `add_break` ≡ criação manual equivalente**; **delta
COMBINADO ≡ re-simulação dos N patches, e difere da soma dos individuais em fixture que interage**;
**`asis_divergence` ≡ `incrementalResult.impacted` agregado**; **anomaly (mediana/MAD)**; **selo de
estabilidade temporal**; **nó travado ⇒ recomendação não acionável**; determinismo.

## Pool de Workers (Execução Híbrida H3)

Ver `docs/wiki/Arquitetura-Execucao-Hibrida.md` (§7.2) e `docs/wiki/Hibrido-Prompts-Sessoes.md`
(Sessão H3). As duas cargas **embaraçosamente paralelas** existentes — a validação por
re-simulação dos top-N em `buildSegmentRecommendations` e as N re-simulações **individuais** de
`computeSegmentCombined` — são shardadas **por candidato** num pool de **workers aninhados**
dentro de `src/simulation.worker.js`. A re-simulação **combinada** de `computeSegmentCombined`
**permanece UMA só** (inline, nunca shardada — DEC-SD-003: aplicar A muda a população que chega a
B). Nenhuma matemática mudou: os caminhos síncronos (`computeSegmentDiscovery`/
`computeSegmentCombined`/`buildSegmentRecommendations`) seguem **inalterados** como referência,
fallback e contrato dos testes.

- **Unidade de shard**: `segValidateMoves(shapes, conns, csvStore, moves)` — aplica os moves
  (`applyGoalSeekMoves`) + `runSimulation` + `segSimSnapshot`. **Pura** em (shapes, conns,
  csvStore, moves), então o resultado independe de qual worker rodou e de quando terminou — base
  do determinismo. Envelope seguro `segValidateMovesSafe` → `{snapshot}` \| `{error}` (espelha o
  try/catch por candidato do caminho original).
- **Plano/preenchimento** (puros, compartilhados sync/pooled): `segPlanRecommendations` monta o
  esqueleto de `recommendation` em cada achado e devolve os JOBS `{id, moves}` (top-N acionáveis);
  `segFillRecommendationDeltas` grava `rec.delta` a partir de `Map(id → snapshot)` — consumido por
  id (independe da ordem de conclusão). `segAssembleCombined` monta o resultado da combinada a
  partir dos snapshots (fonte única do cálculo de somas/interação).
- **Entradas paralelas** (`async`, usadas pelos handlers): `computeSegmentDiscoveryPooled` e
  `computeSegmentCombinedPooled` (via `buildSegmentRecommendationsPooled`). `segBuildModelWithoutRecs`
  é a parte comum da descoberta (estágios 1–3 + asis/anomaly/estabilidade) sem as recomendações.
- **Pool** (`getSimPool`/`createSimPool`, lazy): `min(navigator.hardwareConcurrency − 1, 4)`
  workers aninhados (`new Worker(new URL('./simulation.worker.js', import.meta.url), {type:'module'})`
  — Vite bundla como `new Worker(self.location.href, …)`, auto-referência ao mesmo script). Base
  semeada **1×/versão** via `buildCsvStoreMessage` (SAB compartilha sem cópia sob
  `crossOriginIsolated` — Fase 2; senão structured clone copia uma vez por worker). Cada worker
  recebe só `UPDATE_CSV_STORE` + `POOL_JOB`, então **nunca cria pool próprio** (sem recursão) e é
  **stateless por job** (só a base é estado, referenciada por versão). Chamadas ao pool
  serializadas por `pool.tail` (não corrompe `slot.onDone` entre tarefas).
- **Fallback transparente** (`runValidationJobsVia`): pool null/indisponível (`typeof Worker ===
  'undefined'`, erro de construção, ou erro de orquestração) ⇒ roda os jobs **inline**, sequencial
  e determinístico — idêntico ao single-worker. Os handlers `COMPUTE_SEGMENT_*` ainda têm um
  `.catch` que recai no caminho síncrono.
- **Teste**: `tests/workerPool.test.js` — GATE H3: em Node/jsdom não há Worker real, então o GATE
  injeta um **pool mock** (roda cada job inline via `segValidateMoves` mas resolve **fora de
  ordem**) e prova (1) pool ≡ single-worker **número a número** (Descoberta e Combinada), (2)
  determinismo sob ordens de conclusão diferentes (reverse ≡ shuffle ≡ síncrono), (3) fallback
  (pool === null ≡ síncrono).

## ComputeRouter (Execução Híbrida H4 — `src/computeRouter.js`)

Fronteira única (DEC-HX-002) que decide, **por tarefa**, o executor: o Web Worker (default,
completo) ou o **sidecar Python opt-in** (aceleração/ampliação de limites). A UI posta a mesma
mensagem e recebe o **mesmo payload `*_RESULT`** — quem computou é invisível. Ver
`docs/wiki/Arquitetura-Execucao-Hibrida.md` (DEC-HX-002/004/006/007, §8–§10). **Sessão H4 = só
a costura do front (módulo + GATE), com sidecar mockado**; o sidecar Python (H5) e a UX/badge/
recomendação (H6) vêm depois. Módulo **puro**, independente de React/`App.jsx` (sem ciclo de
import): a main injeta worker, provider sidecar e o leitor da preferência; os chunks de dataset
chegam por callback (`buildChunks`), então o router não conhece `columnar.js`.

- **Interface `ComputeProvider`**: `health()` · `capabilities()` · `registerDataset({hash,
  buildChunks})` · `runJob(task, params, {onProgress, signal, datasetId})` · `cancelJob(jobId)`.
- **`createWorkerProvider(worker)`**: adapter fino do `postMessage` atual — **payloads
  intocados** (DEC-HX-002). Correlaciona `runJob(task,…)` com a `*_RESULT` correspondente
  (`RESULT_TYPE`/`resultTypeFor`) por FIFO (cada task é singular por gesto). Usa
  `addEventListener` (aditivo): coexiste com o `onmessage` do App, resolve só as próprias
  promessas, ignora mensagens sem promessa pendente. `registerDataset` é no-op (a base já vive
  no worker via `UPDATE_CSV_STORE`); `cancelJob` no-op.
- **`createSidecarProvider({url, token, fetchImpl?, pollIntervalMs?, healthTimeoutMs?, sleep?})`**:
  fetch em `http://127.0.0.1` (URL vazia ⇒ mesma origem no release), header `X-Compute-Token` em
  tudo exceto `/health`. `registerDataset` faz **HEAD `/datasets/{hash}` antes de POST**
  (DEC-HX-006 — 200 pula o upload; 404 ⇒ `POST /datasets?hash=` com os chunks do
  `serializeCsvStore`/M3 como corpo). `runJob`: `POST /jobs` → **polling** `GET /jobs/{id}` a
  cada `pollIntervalMs` (~500ms) reportando `onProgress`; erro de rede/queda no meio ⇒ o await
  **rejeita** (⇒ fallback do router); `signal` aborta e dispara `DELETE /jobs/{id}`.
  `fetchImpl`/`sleep` são injetáveis (teste sem Python).
- **Tabela de roteamento `TASK_CLASS`/`classOf` (DEC-HX-007, paridade total)**: **Classe A** =
  todo o core de hoje (tick, overlay, otimizadores, Goal Seek, Simplify, DocGen, Descoberta
  depth≤2, …) ⇒ **sempre worker**; o tick de edição e qualquer resposta síncrona a gesto
  **jamais** roteiam (regra de ouro). **Classe B** = cargas ampliadas/análises novas (nenhuma em
  produção ainda; `echo_stats` é o benchmark da H5) ⇒ tenta o sidecar com **fallback
  transparente** ao worker. Default defensivo: task desconhecida ⇒ Classe A (nunca vaza pro
  sidecar). **Nenhuma tarefa exige o sidecar** — sempre há caminho browser.
- **`createComputeRouter({worker, sidecar?, getPreference, dataset?, protocolVersion?})`**:
  `detect()` faz o pareamento no boot (§9) — só quando a preferência está ligada: `health`
  (timeout 1s) → checa `protocolVersion` (mismatch ⇒ indisponível, nunca "tenta mesmo assim") →
  token + `capabilities`; **ausência é estado normal e silencioso** (`detect` nunca lança;
  `reason` ∈ `disabled|no_sidecar|unreachable|protocol_mismatch|ok`). `run(task, params, opts)`
  aplica a tabela e devolve `{via:'worker'|'sidecar', result, fellBack?, error?}` — `result`
  **sempre** no formato `*_RESULT`. `canRouteToSidecar(task)` = Classe B ∧ preferência ligada ∧
  `status.available`.
- **Preferência `computeSidecar {enabled, url}`** (estado `computeSidecar` em `App.jsx`, default
  **off**): persistida dentro do contêiner `preferences` do Projeto (`buildProjectPayload`/
  `loadProject`, **sem bump de schema**). Com desligado o router nem detecta e nada muda — o app
  se comporta exatamente como antes (o wiring vivo do router entra na H5/H6).
- **`hashChunks(chunks)`**: hash de conteúdo FNV-1a 32-bit hex dos chunks do dataset — papel do
  `csvStoreVersion` (DEC-HX-006), computável na main; determinístico e sensível à fronteira dos
  chunks (o sidecar reusa o dataset por HEAD 200).
- **Teste**: `tests/computeRouter.test.js` — GATE H4 com **fetch mockado** (servidor fake em
  memória): (1) Classe A jamais roteia mesmo com sidecar disponível; (2) detecção
  indisponível/lento(timeout)/versão errada ⇒ status indisponível e silencioso; (3) Classe B
  roteia pro sidecar com dataset por hash (HEAD 404→POST; HEAD 200 pula upload) e result idêntico
  ao contrato; (4) queda no meio do job ⇒ fallback transparente ao worker; (5) preferência off ⇒
  tudo no worker; WorkerProvider posta payload intocado e correlaciona a `*_RESULT`.

## Sidecar Python (Execução Híbrida H5 — `release/sidecar.py`)

O executor Python opt-in do outro lado do `ComputeRouter` (H4). Arquivo **único, stdlib
apenas** (`http.server`/`ThreadingHTTPServer`, sem Flask), **importado por `release/serve.py`**
e montado sob `/api/compute/*` na **mesma porta/origem** do app no release (DEC-HX-003) — o
`iniciar.bat` sobe app + sidecar juntos, sem passo extra. Ver
`docs/wiki/Arquitetura-Execucao-Hibrida.md` (DEC-HX-003/004/006/008, §8–§9). **É opt-in e
silencioso**: sem os pacotes científicos, reporta tier `stdlib` e o app segue 100% no
navegador (DEC-HX-001).

- **Endpoints (§8)**: `GET /health` (sem token) · `GET /token` (sem token, mas **só à própria
  origem** — GET same-origin não manda `Origin`; página de terceiro manda e cai fora da
  allowlist) · `GET /capabilities` · `POST /datasets?hash=` + `HEAD /datasets/{hash}` ·
  `POST /jobs` + `GET /jobs/{id}` + `DELETE /jobs/{id}`. Tudo exceto `/health` e `/token` exige
  o header **`X-Compute-Token`** (token aleatório por boot, `secrets.token_urlsafe`). Bind
  **exclusivo em `127.0.0.1`**; **nenhum header CORS** exceto a allowlist do origin do Vite sob
  `--dev` (com preflight `OPTIONS`).
- **Detecção de tier por warm-up ASSÍNCRONO no boot (DEC-HX-004)**: `start_warmup()` importa
  numpy/scipy/sklearn/duckdb numa thread de fundo (a 1ª carga do sklearn mediu 38s sob antivírus
  na sonda HP — por isso **nunca inline no request**). `get_capabilities()` responde imediato
  com status **por pacote** (`{numpy:'2.5.1'|'loading'|null, ...}`), `cores`, `tasks`,
  `protocolVersion=1`. **Tier `full` = numpy+scipy presentes**; sklearn/duckdb são extras por
  pacote, **nunca gate do tier**.
- **Datasets (DEC-HX-006)**: `POST /datasets?hash=` recebe o corpo = chunks base64 do
  `serializeCsvStore`/M3 (`src/columnar.js`), faz `json.loads` e guarda **só em RAM** por hash
  (idempotente: mesmo hash ⇒ `reused:true`, não re-parseia). Colunas métricas decodificadas com
  `numpy.frombuffer('<f8')` (tier full) ou o módulo `array` (stdlib) — **nenhum formato novo**.
- **Jobs**: `submit_job` roda a task num **processo filho** (`multiprocessing`, `_job_entry`
  top-level p/ ser picklável sob spawn no Windows) com fila de progresso e resultado; uma thread
  monitora e atualiza `status`/`progress`; `DELETE` faz `terminate()` (best-effort). Fallback
  inline se `Process` não subir. `run_task(task, store, params, progress_cb)` é o mesmo executor
  síncrono (usado pelo filho e direto nos testes). Task inicial **`echo_stats`** (rowCount + soma
  de uma coluna métrica) — prova o round-trip contra o worker e serve de benchmark.
- **Instalação em camadas (P1) — `release/python/`**: `requirements.txt` (numpy/scipy = tier
  full; sklearn/duckdb extras) + `instalar_motor.bat` (venv + `pip install` **do índice**
  primeiro; para o que falhar, `--no-index --find-links wheels/` como **contingência** — a sonda
  HP não achou wheel imprescindível, então `wheels/` vem vazia com só um `LEIAME.txt` e o passo
  de embarcá-las no `build-release.yml` está **documentado e desativado**). `checar_ambiente.py`
  (a sonda HP) foi **movida da raiz** para `release/python/` (junto do instalador).
- **Modo dev**: `python sidecar.py --dev [--port 8090] [--vite-origin http://localhost:5173]`
  sobe **só a API** à parte, com CORS para o origin do Vite e o token impresso no console (colado
  na UI). No release, `serve.py` chama `configure(dev=False)` + `start_warmup()`.
- **Teste**: `tests_python/` (pytest, rodável sem numpy/scipy — os testes de tier manipulam o
  estado do warm-up): health, token (gate de origem), auth por token, capabilities durante
  (`loading`⇒stdlib) e após o warm-up (numpy+scipy⇒full, sklearn não é gate), dataset round-trip
  por hash (POST idempotente + HEAD 200/404), ciclo de job `echo_stats` e cancelamento. CI:
  workflow **separado e opcional** `.github/workflows/test-sidecar.yml` (não bloqueia o build).
  **Não** é o GATE cross-runtime de fixtures douradas (DEC-HX-005) — esse chega na H7, quando
  houver dupla implementação de fato.

## Biblioteca de Cineminha (`cinemaLibrary`)

- Estado local (array) persistido em `localStorage` implicitamente (futuro)
- Cada entrada: `{id, name, description, tags, cinemaType, rowDomain, colDomain, cells, metadata, savedAt}`
- **Salvar**: toolbar contextual do Cineminha → "Salvar na Biblioteca"
- **Aplicar**: modal da biblioteca → selecionar entrada → modal de mapeamento de variáveis (`cinemaImportModal`) → aplica `cells` com remapeamento de domínio
- **Export/Import**: JSON e CSV de lote via `cinemaLibraryModal`

## Biblioteca de Políticas (`policyLibrary`, Copiloto Sessão 2)

Generalização do padrão do `cinemaLibrary` para políticas inteiras: salva o **PolicyIR**
(Copiloto Sessão 0 — nós/rotas/regras, sem posições nem dados linha a linha) + metadados,
em vez do canvas com posições. Ver `docs/wiki/Copiloto-ConstrucaoAssistida.md` (Sessão 2).

- **Estado**: `policyLibrary: array` de `{id, name, description, tags, ir: PolicyIR, requiredVars, savedAt}`, persistido no `.credito.json` (`buildProjectPayload`/`loadProject`, schema **`"2.4"`**). `policyLibraryModal` (`null | {mode:'browse'|'save', search, saveMeta, overwriteId}`) e `policyApplyModal` (`null | {itemId, name, ir, requiredVars, mapping}`) são efêmeros (UI), não persistem.
- **`extractPolicyRequiredVars(ir)`** (helper global exportado): lista, uma vez por **nome distinto** de coluna referenciada no IR, `{col, csvId, csvName, kind}` — `kind:'decision'` para variável de losango/eixo de Cineminha (precisa ser coluna tipada como Filtro no dataset-alvo), `kind:'any'` para coluna de regra de Decision Lens (casa por nome contra qualquer coluna carregada, de qualquer tipo — mesma semântica de `rowMatchesLensRules`, sem `csvId` próprio). Mesmo nome nos dois papéis → prevalece `'decision'`.
- **`applyPolicyVarMapping(ir, mapping)`** (helper global exportado, puro): materializa `mapping: {[origCol]: {col,csvId}|null}` de volta no IR, reescrevendo `variable`/`rowVar`/`colVar`/`rules[].col` — **antes** de chamar o único aplicador da DEC-IA-002 (`applyPolicyPatch`), nunca um segundo caminho de materialização. Variável sem mapeamento (ausente ou `null`) vira `null`: o nó nasce **sem** variável — pendência visível, não erro nem aplicação parcial silenciosa de outra coluna. Como o nó fica sem tráfego (0 chegadas em todos os ports), o lint do Copiloto Sessão 1 (`zero_arrival`) já sinaliza isso automaticamente no painel — reaproveitado, não reinventado.
- **Salvar**: seção Fluxo → botão **📚 Políticas** → **💾 Salvar atual** (`savePolicyToLibrary`) — roda `buildPolicyIR` sobre o canvas ativo + `extractPolicyRequiredVars`.
- **Aplicar**: item da biblioteca → **▶ Aplicar** (`openPolicyApplyModal`) abre o modal de mapeamento (padrão `cinemaImportModal`): auto-match por `normalizeColName` contra as colunas do dataset atual (filtradas por `kind`), pendência (⚠) visível por variável não casada. **Aplicar** (`applyPolicyTemplate`) roda `applyPolicyVarMapping` → `applyPolicyPatch` (com `pushHistory()`), anexando ao canvas ativo; mostra aviso (`importWarn`) listando variáveis pendentes, se houver. O posicionamento em camadas do `applyPolicyPatch` já deixa o canvas legível — não dispara `autoLayout()` automaticamente (o usuário pode usar ⊹ Reorganizar).
- **Export/Import**: JSON da biblioteca inteira (`{schemaVersion, kind:'policy-library', items}`) via `exportPolicyLibrary`/`onPolicyLibFileChange` — itens importados recebem IDs novos (sem colisão).
- **Teste**: `tests/policyTemplates.test.js` — salvar → aplicar em base com colunas **renomeadas** via mapeamento → roteamento equivalente (agregados + decisão por linha); variável sem mapeamento → pendência (nó sem variável), nunca erro.

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

## PolicyIR — JSON canônico da política (Copiloto Sessão 0, DEC-IA-002)

Representação canônica da política de crédito — a *lingua franca* do épico do
Copiloto (`docs/wiki/Epicos-CopilotoIA.md`): templates, sugestões, Goal Seek,
documentação e trocas com IA leem/escrevem PolicyIR. `shapes`/`conns` seguem sendo a
fonte de verdade do canvas; o IR é **derivado** e patches de IR são materializados de
volta por um **único aplicador**. Ambos são helpers globais exportados de `src/App.jsx`.

- **`buildPolicyIR(shapes, conns, csvStore, opts?)`** → IR:
  ```js
  {
    kind: "policy-ir", version: "1.0", name, generatedAt,
    datasets: [{ csvId, name, columns: [{name, colType, varType, domainSize}] }], // metadados, SEM dados
    nodes: [  // na ordem de `shapes` (preserva a eleição de raiz do motor)
      { id, kind:'decision', label, variable:{col,csvId}, routes:[{values:[...], to}] },
      { id, kind:'cinema',   label, cinemaType, rowVar, colVar, rowDomain, colDomain,
        blockedCells:[...],  // SÓ as caselas não elegíveis, ordenadas (roteamento)
        routes:{eligible, notEligible} },
      { id, kind:'lens',     label, rules:[{col,operator,value,logic}], to },
      { id, kind:'terminal', label, terminal:'approved'|'rejected'|'as_is' },
    ],
    entry: [nodeId...],  // raízes — mesmo critério do motor (sem aresta de entrada vinda de port)
  }
  ```
  Regras: **sem perda de roteamento** (GATE), **JSON puro** (serializável/versionável),
  **sem posições x/y e sem dados linha a linha**. O achatamento resolve cadeias de
  ports (`decision→port→destino` vira `{values, to}`, com o mesmo trim/first-wins do
  motor); rota sem destino → `to: null` (linha morre, como port sem saída). Grades
  numéricas de casela (`setCinemaCellValue`) não entram — só elegibilidade
  (`isCellEligible` → `blockedCells`).
- **`applyPolicyPatch(patch, base = {shapes:[], conns:[]})`** → `{shapes, conns, idMap}`:
  materializa um IR (completo ou parcial `{nodes}`) **anexando** ao canvas base, sem
  mutá-lo. IDs novos via contador `_id` (`uid()`); `idMap` traduz id do IR → id criado;
  rota cujo `to` não está no patch resolve contra `base.shapes` (patch pode conectar a
  nós existentes). Recria ports no idioma padrão do canvas, marca `cellsUserEdited=true`
  no Cineminha (bloqueia a prévia AS IS) e posiciona por camadas simples (longest-path)
  — o usuário pode usar ⊹ Reorganizar.
- **Export**: 3ª opção do modal **Exportar Fluxo** (seção Fluxo) — "JSON Canônico da
  Política" (`doExportPolicyIR`, arquivo `politica_canonica_YYYY-MM-DD.policy.json`).
- **GATE `tests/policyIR.test.js`**: sobre as fixtures do `compiledEngine.test.js`,
  (1) roteamento via IR ≡ motor compilado M8 — agregados do tick, incremental,
  `nodeArrivals` via `idMap` e decisão simulada **por linha**; (2) round-trip
  IR→canvas→IR estável (igualdade estrutural módulo renomeação de IDs); (3) IR sem
  chaves de layout/dados e com estrutura canônica exata; (4) patch parcial sobre
  canvas existente sem colisão de IDs.
- **Limite documentado**: aresta rotulada de losango **direto** para outro nó de fluxo
  (sem port, fora do idioma da UI) volta materializada **com** port — preserva o
  caminho da linha, mas pode mudar qual nó o motor elege como raiz.

## Salvar / Abrir Projeto (`.credito.json`)

Botões **💾 Salvar Projeto** e **📁 Abrir Projeto** na seção **Projeto** (topo do
painel direito). Persistência completa do estudo num único arquivo
`.credito.json` (local, sem servidor), para o usuário retomar exatamente de onde
parou.

- **`buildProjectPayload()`** — **FONTE ÚNICA DA VERDADE do que é persistido.**
  Monta o snapshot `{schemaVersion:"2.5", kind:"credito-project", generatedAt,
  activeTab, viewport, panelCollapsed, canvases, activeCanvasId, csvStore,
  analyticsLayout, analyticsGroupings, analyticsPageFilters,
  cinemaLibrary, policyLibrary, businessWidget, preferences}`.
  `preferences` = `{enableDynThickness, showEdgeVol, showEdgeInadReal, showEdgeInadInf}`.
  Mescla a working copy do canvas ativo (`shapes`/`conns`) de volta em `canvases`
  (igual ao effect da `sessionStorage`) — **sem isso, edições no canvas ativo (ex.:
  um Decision Lens recém-criado) não entram no arquivo.**
  O `csvStore` é serializado via `serializeCsvStore()` (typed arrays → **base64**, ver
  Otimização de Memória — M3) e restaurado via `deserializeCsvStore()` (base64 → typed
  arrays; também aceita os formatos antigos: arrays planos de números — schema ≤ 2.2 —
  e `rows: string[][]` de projetos anteriores à Fase 1, migrando-os transparentemente).
- **`saveProject()`** (async): monta `buildProjectJSONChunks(buildProjectPayload())`
  (helper global em `App.jsx`, M3) — a "casca" do payload (tudo exceto `csvStore`) mais
  as colunas de cada base **uma por vez**, em vez de um único
  `JSON.stringify(payload)` monolítico — e usa o **"Salvar como" nativo** (File System
  Access API `window.showSaveFilePicker`) quando disponível — o usuário escolhe pasta e
  nome, e os *chunks* são escritos em sequência no `createWritable` (streaming real:
  nenhuma string única do projeto inteiro chega a existir em RAM). `AbortError` = usuário
  cancelou (no-op). *Fallback* para download via `<a download>` (browsers sem a API): os
  mesmos *chunks* viram o array de `BlobPart[]` do `Blob` (aceito sem concatenação) e o
  `<a>` é anexado ao DOM, só revogando o blob URL após `setTimeout(…, 2000)` — **revogar
  imediatamente após `click()` pode truncar projetos grandes** (bug histórico: base de
  dados sumindo do arquivo salvo). Dá feedback via `projectSaveNotice`
  (`{kind:'ok'|'err', msg}`) renderizado sob o botão.
- **`loadProject(data)`** / **`onProjectFileChange`**: valida `kind:"credito-project"`,
  sobe o contador `_id` (varre shapes/conns/ids de todos os canvas) p/ evitar colisão,
  restaura todo o estado (cada seção com default defensivo — seções ausentes não zeram
  o resto), reseta seleção/edição e os stacks de undo/redo (que são por canvas e
  ficariam inconsistentes após trocar todos os canvas). O effect de `csvStore`
  reenvia `UPDATE_CSV_STORE` ao worker.
  A leitura do arquivo (`onProjectFileChange`) continua via `FileReader.readAsText` +
  `JSON.parse` — o ganho de memória do M3 é no *tamanho* do JSON (base64, sem números
  boxed), não numa leitura streaming do lado do load.
- **`serializeCsvStore` / `deserializeCsvStore`** (em `src/columnar.js`, importados em `App.jsx`):
  Typed arrays (`Float64Array`, `Int32Array`) não são JSON nativo. Desde a M3 (Otimização
  de Memória), `serializeCsvStore` converte-os para **base64 dos bytes crus** (em vez de
  array plano de números boxed — schema ≤ 2.2) e `deserializeCsvStore` reconstrói os
  typed arrays a partir do base64. Aceita os três formatos na carga: base64 (atual), array
  plano (projetos/exports salvos com schema ≤ 2.2) e `rows: string[][]` (legado pré-Fase 1,
  vetorizado on-the-fly). Round-trip (dos três formatos) coberto em `tests/columnar.test.js`.
- **`buildProjectJSONChunks(payload)`** (helper global em `App.jsx`, M3): serializa o
  payload do Projeto como um **array de strings JSON** em vez de uma string única — a
  "casca" (todo campo exceto `csvStore`) primeiro, depois `csvStore` com cada coluna de
  cada base serializada (`JSON.stringify`) individualmente. A concatenação dos chunks é
  sempre um JSON válido idêntico, em conteúdo, ao de `JSON.stringify(payload)` — só a
  forma de entrega muda (partes em vez de string monolítica), o que permite ao
  `createWritable`/`Blob` consumi-las sem montar o projeto inteiro como uma string
  contígua em memória.

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
   Versão atual: **`"2.5"`** (bumped na remoção da Tabela de Inferência de Referência).
4. Se o estado for um `Map`/`Set`/tipo não-JSON (ou typed arrays como `Float64Array`/`Int32Array`),
   adicionar serialize/deserialize dedicados (padrão de
   `serializeCsvStore`/`deserializeCsvStore`) e cobrir o round-trip em teste.
5. Se também deve sobreviver a reload na mesma sessão, adicionar à
   auto-persistência de `sessionStorage` (ver seção abaixo).

**Checklist do que hoje é salvo** (mantê-lo em dia): canvas e todos os shapes/conns
de **todas** as abas (losangos, Cineminhas, Decision Lens e suas `rules`, frames,
terminais, painéis) · `includeInDashboard`/nome por aba · bases de dados completas
(`csvStore`: headers, rows, columnTypes, varTypes, `asIsConfig`) · Dashboard
(`analyticsLayout`, `analyticsGroupings`, `analyticsPageFilters`) · biblioteca de
Cineminhas (`cinemaLibrary`) · biblioteca de Políticas (`policyLibrary`) · widget de
negócio · preferências de aresta/espessura + Motor Python (`computeSidecar {enabled, url}`, H4) ·
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

`csvStore` e `cinemaLibrary` **não** vão para `sessionStorage`
(muito grandes / precisam do Projeto `.credito.json`). Init/gravação são
defensivos (`try/catch`), então quota estourada ou JSON inválido nunca quebram o boot.

## Painel direito colapsável (`panelCollapsed`)

O painel lateral direito (chips de variáveis, Projeto, Dados, indicadores) pode ser
colapsado para uma faixa fina de 28px, liberando espaço de canvas. Estado
`panelCollapsed` (boolean, default `false`); largura anima entre `272px` e `28px`.
Quando colapsado, o conteúdo é escondido (`display:none`) e só a faixa com o botão de
reabrir fica visível.

## Carga de CSV assíncrona + modal de progresso (`importLoading`)

Bases grandes travavam a UI no parse síncrono. `parseCSVToColumnarAsync(text,
delimiter, hasHeader, onProgress)` (em `src/columnar.js`; substituiu o
`parseCSVAsync` no M1) fatia o CSV em lotes, cede a thread principal a cada lote
(`setTimeout 0`) e reporta progresso via `onProgress(posiçãoConsumida, total)`.

- Estado `importLoading`: `null | {phase:'reading'|'parsing', pct, filename}` —
  alimenta um modal de progresso. `reader.onprogress` cobre a leitura do arquivo
  (`reading`); `parseCSVToColumnarAsync` cobre o parse (`parsing`).
- Usado em `onFileChange` (import inicial) e `reparseWizardFile` (recarga no wizard —
  desde o M1 relê o `File` handle guardado no wizard) — ambos mostram o mesmo modal.
- **Fase 0 (otimização de memória)**: o parse NÃO materializa
  `text.split(/\r?\n/)` inteiro. Varre o texto por índice (`indexOf('\n')`) e fatia
  cada linha sob demanda — elimina o pico de RAM do parse (~260MB em bases grandes).
- **M1 (import vetorizado)**: cada linha alimenta os encoders colunares diretamente
  (dictionary encoding por coluna) — a matriz `string[][]` nunca existe (ver seção
  M1 abaixo).

## Otimização de Memória — `src/columnar.js` (Fases 0–4 + M1/M3/M15)

Para bases sumarizadas por dia (~1MM linhas / ~130MB), a arquitetura anterior
mantinha várias cópias completas em `string` na RAM. Ver o plano completo em
`docs/wiki/Otimizacao-Memoria.md` (Fases 0–4) e `docs/wiki/PERFORMANCE-ANALISE.md`
(backlog M1–M15, priorizado em Fases A–D). **Fases 0, 1, 2, 3, 4 entregues; do
backlog do `PERFORMANCE-ANALISE.md`, M3 e M15 (Fase B), M6 (Fase C) e M1 e M8 (Fase D)
entregues** (M2/M10 documentados nas seções do worker; M8 na seção "M8 (D2) — Motor
compilado").

### Fase 0 — Parse sem cópia intermediária
O parse do import varre o texto por índice em vez de `split(/\r?\n/)`. Sem o array
intermediário de 1MM strings, o pico de RAM do parse cai de ~3× para ~1× o tamanho
da base. (A técnica vive hoje dentro de `parseCSVToColumnarAsync` — ver M1.)

### Fase 1 — Armazenamento colunar no `csvStore`
`src/columnar.js` define a estrutura vetorizada e os accessors:
- Colunas métricas (`METRIC_COL_TYPES = qty, qtdAltas, qtdAltasInfer, inadReal, inadInferida`) → `Float64Array` (números prontos, sem `parseFloat` por tick).
- Dimensões/decisão/ID → *dictionary encoding* `{dict: string[], codes}` — o dicionário já é a lista de distintos. Os `codes` usam o **menor typed array pela cardinalidade** (`codesCtorForDict`): `Uint8Array` (≤256 distintos), `Uint16Array` (≤65536), `Int32Array` acima — **dieta de memória H2** (Execução Híbrida §2.2 Eixo 1): colunas de baixa cardinalidade caem de 4 para 1–2 bytes/linha. Aplicado no import vetorizado (M1) e no `buildColumnar` legado; todo consumidor lê `codes[r]` por indexação (dtype-agnóstico — motor M8, M15, accessors). Métricas seguem `Float64Array` (GATEs de igualdade exigem).
- **Accessors** (uso obrigatório em hot paths — não acessar `csv.rows[r][c]` diretamente):
  - `rowCount(csv)` — número de linhas
  - `cellStr(csv, r, c)` — equivalente exato a `row[c]` no legado
  - `cellNum(csv, r, c)` — valor numérico (retorna `NaN`, não `0`; o call site aplica `|| 0`)
  - `getRow(csv, r)` — materializa uma linha como `string[]` (uso pontual)
  - `materializeRows(csv)` — materializa tudo (evitar em hot paths)
  - `distinctColValues(csv, c)` — distintos não-vazios (O(distintos) em modo colunar)
- **Persistência**: `serializeCsvStore(store)` / `deserializeCsvStore(store)` — typed arrays ↔ **base64** dos bytes crus para JSON (M3; era array plano de números boxed até o schema 2.2). `deserializeCsvStore` aceita os três formatos: base64 (atual), array plano (schema ≤ 2.2) e o legado `rows: string[][]` (migração transparente de projetos anteriores à Fase 1).
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
dataset largo a cada tick.

### Fase 4 — cortar os picos transitórios que ainda causavam OOM
As Fases 0–3 enxugaram o **estado permanente** (`csvStore` colunar ~100MB), mas o
"Out of memory" persistia em dois **picos transitórios** por-linha que ninguém tocara:

1. **Overlay do Canvas.** `COMPUTE_OVERLAY` enviava o `overlay` inteiro
   (`rowDecisions`: 1 objeto por linha, ~1MM numa base diária) de volta pela
   `postMessage` → o structured clone materializava **outra** cópia de ~1MM objetos na
   main, guardada no estado morto `simulationOverlay` (nunca lido). Estourava ao editar
   o canvas com base grande. **Correção:** o worker computa o `incrementalResult`
   localmente e **descarta** o overlay; a main só recebe `{incrementalResult,
   nodeArrivals}`. Estado `simulationOverlay` removido. Zero mudança de matemática.
2. **Dataset analítico largo (Dashboard).** `computeAnalyticsDataset` materializava 1
   objeto por linha (~1MM), clonado pra main e recopiado por `applyGroupingsToDataset`.
   Estourava ao abrir a aba Dashboard. **Correção:** dataset **colunar** (dict encoding +
   `Float64Array`), `ArrayBuffer`s **transferidos** (zero-cópia) no `ANALYTICS_RESULT`;
   consumidores (`pivotWidget`, `computeWidgetMetric`, filtros, `distinctDimValues`,
   `applyGroupingsToDataset`, `buildAnalyticsCSV`) iteram por índice via `awColStr`/
   `awColNum`; agrupamentos adicionam 1 coluna dict; filtros viram máscara `activeRows`.
   Ver "Analytics Workspace / Formato colunar do dataset largo". GATE `analytics.test.js`
   revalidado sobre o formato colunar.

> Nota operacional: o `release/iniciar.bat` serve via `python serve.py` (não mais
> `python -m http.server`). O `serve.py` é um `SimpleHTTPRequestHandler` que injeta os
> headers `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
> require-corp` — logo `crossOriginIsolated === true` e o SAB da Fase 2 **ativa** também
> no release local (a base deixa de ser clonada pro worker). Como todos os assets são
> bundlados na mesma origem, `require-corp` não bloqueia nada. O `build-release.yml`
> preserva `serve.py` junto do `iniciar.bat` ao recopiar o `dist/`. O dataset analítico
> da Fase 4 **não** depende de COI (usa `ArrayBuffer` transferível), então já valia
> mesmo antes; a mudança do `serve.py` beneficia a base colunar (Fase 2).

### M3 — Save/Load do Projeto: base64 + escrita em partes (schema 2.3)
Ver `docs/wiki/PERFORMANCE-ANALISE.md` (item M3, Fase B do backlog). Dois picos
que sobravam ao **salvar** um projeto com base grande:
1. **Arrays planos de números boxed.** `serializeColumns` fazia `Array.from(col.data)`
   — ~15MM de números *boxed* numa base diária. **Correção:** os bytes crus do typed
   array (`Float64Array`/`Int32Array`) viram uma **string base64**
   (`typedArrayToBase64`/`base64ToTypedArray`, `columnar.js`) — sem materializar array
   de números, JSON ~30% menor que a mesma sequência em dígitos decimais.
   `deserializeColumns` aceita os dois formatos (`encoding:'base64'` novo e o array
   plano antigo, schema ≤ 2.2) — retrocompatibilidade coberta em `tests/columnar.test.js`.
   **Dieta H2:** o envelope base64 de uma coluna dict ganhou o campo `dtype`
   (`'Uint8Array'|'Uint16Array'|'Int32Array'`) para reconstruir os `codes` no dtype
   certo. Retrocompatível com os **três formatos** aceitos: base64 **com** `dtype` (lê
   fiel), base64 **sem** `dtype` (schema 2.3 = sempre Int32, lido como Int32 e
   re-empacotado ao menor dtype) e array plano (schema ≤ 2.2, idem). Toda carga
   termina no menor dtype pela cardinalidade (`packCodes`).
2. **`JSON.stringify(payload)` monolítico.** Mesmo em base64, uma única chamada monta
   o projeto inteiro como uma string contígua antes de gravar. **Correção:**
   `buildProjectJSONChunks(payload)` (`App.jsx`) monta a "casca" do payload (tudo
   exceto `csvStore`) e, dentro de `csvStore`, cada **coluna de cada base
   individualmente** — a concatenação dos chunks é o mesmo JSON que
   `JSON.stringify(payload)` produziria, só que entregue em partes. `saveProject`
   escreve os chunks em sequência no `createWritable` (streaming real) e, no
   fallback `<a download>`, os mesmos chunks viram o `BlobPart[]` do `Blob` (aceito
   sem concatenação prévia).
- Schema bump: **`"2.2"` → `"2.3"`**. `loadProject`/`onProjectFileChange` não mudam
  (a leitura ainda é `FileReader.readAsText` + `JSON.parse` — o ganho é no *tamanho*
  do JSON, não numa leitura em streaming do lado do load).

### M15 — Dataset analítico: tradução código→código (em vez de re-hash por linha)
Ver `docs/wiki/PERFORMANCE-ANALISE.md` (item M15, Fase B do backlog). `computeAnalyticsDataset`
(worker) fazia, **por linha × por dimensão**, `cellStr(...)` → `Map.get(string)` para
recodificar valores que a base **já** tem codificados (dictionary encoding, Fase 1) —
~10MM lookups de hash de string por recompute numa base de 1MM linhas × 10 dimensões.
**Correção:** para cada `csv × dimensão` (e para as colunas de decisão, a partir do
overlay tipado do M2), constrói-se uma vez um `Int32Array` de tradução
`código de origem (dicionário da base) → código de destino (dicionário do dataset
largo)` — O(distintos), não O(linhas). No loop de linhas resta `codes[w] =
translate[srcCodes[r]]` (leitura de inteiro). Dimensão ausente numa base específica ⇒
código constante (resolvido uma vez, sem tradução por linha); coluna não dict-encoded
(caminho legado `rows: string[][]`, usado só em teste) cai no `cellStr` por linha de
antes — sem mudança de comportamento. GATE: `tests/analytics.test.js` (5B) revalidado
sem alteração de contrato/matemática.

### M1 — Import vetorizado direto para colunar (Fase D — mudança arquitetural)
Ver `docs/wiki/PERFORMANCE-ANALISE.md` (item M1/D1). Até aqui, o funil de import
mantinha a base em **3–5 formas simultâneas** na RAM (pico >2GB num CSV de 130MB —
o cenário de OOM mais provável): o texto cru (`wizard.rawText`, ~260MB), a matriz
`parsedRows: string[][]` (~15MM de strings) retida pelos 3 passos do wizard, e no
confirm mais **duas cópias integrais** (`normalizeDecimalSep` e o
`rows.map(r => [...r, mapped])` da derivação de `__DECISAO_ORIGINAL`) antes de o
`buildColumnar` vetorizar **no fim**. **Correção (tudo em `src/columnar.js`, UI do
wizard intocada):**
1. **`parseCSVToColumnarAsync(text, delimiter, hasHeader, onProgress)`** — o parse
   chunked (mesma varredura por índice da Fase 0, mesmo protocolo de progresso)
   alimenta os encoders colunares **linha a linha**; como os tipos de métrica só são
   conhecidos no passo 2, **todas** as colunas nascem dict-encoded. Devolve
   `{headers, columns, rowCount, previewRows}`; a matriz `string[][]` nunca existe e
   o texto cru é solto quando o parse resolve.
2. **Wizard sem `rawText`/`parsedRows`** — o estado guarda o `File` handle (`file`),
   `parsedHeaders`, `parsedColumns` (dict), `parsedRowCount` e `previewRows` (~100
   linhas para a tabela de prévia). Os dicionários já são os distintos que os passos
   2/3 precisam (sugestões `suggestVarType` por amostra das 1000 primeiras linhas via
   `dict[codes[r]]`; mapping AS IS lê `parsedColumns[asIsVar].dict`). Trocar
   delimitador/cabeçalho no passo 1 **relê o `File`** (`reparseWizardFile`).
3. **`finalizeImportedColumns(headers, columns, n, columnTypes, decimalSep)`** — no
   confirm, converte para `Float64Array` **só** as colunas marcadas como métrica
   (`parseFloat` O(distintos) via `numByCode` + loop O(n) de inteiros) e aplica a
   normalização de decimal (`,`→`.`) **sobre os dicionários** (O(distintos), com
   dedup+remap de códigos quando valores colidem — ex.: `"1,5"` e `"1.5"`). Colunas
   não tocadas são reusadas por referência. `normalizeDecimalSep` (cópia integral)
   deixou de existir.
4. **`deriveMappedDictColumn(srcCol, n, mapFn)`** — `__DECISAO_ORIGINAL` vira coluna
   dict **derivada**: translate `código AS IS → código de 'APROVADO'/'REPROVADO'/''`
   + loop O(n) sobre `codes`, sem tocar nas demais colunas, sem copiar linha. Usada
   nos dois caminhos do confirm (import novo e edição).
5. **`retypeColumn(col, toNum, n)`** — o modo de edição do wizard reclassifica
   colunas (métrica ↔ dimensão) coluna a coluna, **sem `materializeRows`** (que
   copiava a base inteira como `string[][]`); colunas de tipo inalterado são
   compartilhadas por referência.
Domínios da reconciliação de Cineminha no confirm saem de `distinctColValues`
(O(distintos)) em vez de varrer linhas. Nenhuma mudança de matemática nem de UX (3
passos, preview, progresso e validações idênticos). GATE:
`tests/importPipeline.test.js` — equivalência célula a célula contra o caminho
legado (parse `string[][]` → `normalizeDecimalSep` → append `__DECISAO_ORIGINAL` →
`buildColumnar`) reimplementado como controle, incl. aspas/CRLF/ragged/decimal
vírgula/colisão de normalização/`hasHeader=false`/`retypeColumn`.

## Decision Lens

### Propósito
Segmentar uma sub-população da base histórica e aplicar regras diferentes a ela. O Decision Lens não filtra o fluxo — ele **marca** quais linhas devem ser processadas pelo fluxo subsequente.

### Populações de lens (M10 — no worker)
Derivadas **no worker** a partir das regras dos shapes `decision_lens` (helper
`computeLensPopulations`, memoizado por `csvStoreVersion` + regras dos lens via
`getLensPopulations`), como `Uint8Array` por lens×csv (1 byte/linha):
```js
// worker: {populations: {[lensId]: {[csvId]: Uint8Array}}, counts: {[lensId]: {count, total}}}
// populations[lensId][csvId][rowIndex] === 1 se a linha passa pelas regras do lens
```
A main **não** computa nem mantém as populações por-linha (antes um `useMemo` que varria
~1MM linhas e clonava `Array<boolean>` pro worker a cada tick). Ela recebe só as `counts`
no `OVERLAY_RESULT` (estado `lensCounts`) para o rótulo do nó. As demais funções do worker
que roteiam por lens (`computeSimulatedDecisions`, `computeCinemaArrivals`,
`computeNodeArrivals`) avaliam `rowMatchesLensRules` sobre `node.rules` diretamente.

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
- Copia `dist/` → `release/` (preservando os artefatos de distribuição local que não vêm do
  build do Vite: `iniciar.bat`, `serve.py`, `sidecar.py` e toda a pasta `release/python/`)
- Passo de **wheels offline** do Motor Python documentado e **desativado** (contingência P1 —
  ativar só se outra máquina reportar falha real de instalação pelo índice)
- Commita com `[skip ci]` para evitar loop

### `test-sidecar.yml`
- Job **separado e opcional** (não bloqueia o build): `pytest tests_python/` sobre o
  `release/sidecar.py`. Dispara em `workflow_dispatch` e em push/PR que toquem os arquivos do
  sidecar. Roda sem numpy/scipy (os testes de tier manipulam o estado do warm-up).

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
`claude/hybrid-execution-sidecar-wwsbay`

## Roadmap futuro (não implementado)

- **Restrição de monotonicidade**: flag `ordinal` no wizard passo 2 → corte monotônico (Young diagram) no algoritmo Pareto — para variáveis como ratings R1–R20 (parcialmente implementado no Johnny via `badness`/`rowRank`/`colRank`)
- **Sliders adicionais**: margem, rentabilidade ajustada ao risco (RAR), restrição de volume mínimo por segmento
- **Fronteira Pareto multi-dimensional**: 3D (aprovação × inad.real × inad.inferida)
- **Decision Lens — modo incremental**: comparação visual linha a linha das decisões mudadas
- **Exportação**: JSON canônico da política ✅ (PolicyIR — ver seção "PolicyIR"; 3ª opção do modal Exportar Fluxo); falta exportação do canvas como PNG/SVG
- **Persistência**: export/import de projeto como `.credito.json` ✅ (ver "Salvar / Abrir Projeto") + auto-persistência em `sessionStorage` ✅ (ver "Auto-persistência de sessão"); falta auto-save durável em `localStorage` (sobrevive só à sessão do navegador)
- **Cálculo de delta marginal**: "adicionar esta célula muda aprovação em +X pp e inad em +Y pp"
