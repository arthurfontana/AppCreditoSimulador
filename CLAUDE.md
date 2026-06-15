# AppCreditoSimulador

## Stack
- React + Vite, arquivo único: `src/App.jsx` (~7550 linhas)
- Sem CSS externo — tudo inline styles
- Sem bibliotecas de UI — SVG puro para o canvas; matrizes interativas via `foreignObject`
- Web Worker (`src/simulation.worker.js`) para cálculos pesados fora da thread principal

## O que é
Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos ou matrizes cruzadas (Cineminha) e monta um fluxo de política de crédito. O painel de simulação exibe taxa de aprovação e indicadores de inadimplência em tempo real, comparando com a política atual (AS IS).

## Estrutura de arquivos

```
AppCreditoSimulador/
├── src/
│   ├── App.jsx                   # Componente único — ~7550 linhas
│   ├── simulation.worker.js      # Web Worker: simulação, overlay, Pareto, Johnny
│   └── main.jsx                  # Entry point React
├── docs/
│   ├── HANDOFF.md                # Documento de handoff para desenvolvimento corporativo
│   └── wiki/                     # Documentação sincronizada com GitHub Wiki
│       ├── Arquitetura.md
│       ├── Epicos-*.md
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
- `johnnyModal`: otimizador multi-cineminha — `null | {pooledMetrics, frontier, scenarios, mixCats, shapeMetas, baselineApprovalRate, activeCard, proposedByShape, sliderApprovalIdx, sliderInadReal, sliderInadInf, maxInadReal, maxInadInf}`
- `lensModal`: modal de edição do Decision Lens — `null | {shapeId, rules, population}`
- `incrementalResult`: resultado comparativo AS IS vs. simulado — `null | {baseline, simulated, impacted}`
- `simulationOverlay`: mapa de decisões por linha — `null | {[csvId]: {rowDecisions, summaryStats}}`
- `lensPopulations`: populações filtradas por cada lens — `{[lensId]: {[csvId]: boolean[]}}`
- `cinemaLibrary`: biblioteca de configurações de Cineminha salvas localmente — `array`
- `businessWidget`: widget de impacto de negócio flutuante — `{visible, x, y, w, h}`

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

### Shape: `decision` (losango)
```js
{
  id, type:"decision", x, y, w, h,
  label,                    // nome da variável
  variableCol: string,      // nome da coluna no CSV
  csvId: string,            // ID do csvStore associado
}
```
- Criado ao arrastar chip de variável para área vazia do canvas
- Gera ports automáticos (um por valor distinto, máx. 10) com setas rotuladas

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
  rows,          // string[][] — última coluna é '__DECISAO_ORIGINAL' se configurado
  columnTypes,   // {[colName]: COL_TYPE}
  varTypes,      // {[colName]: 'categorical'|'ordinal'}
  asIsConfig,    // null | { col: string, mapping: {[value]: 'APROVADO'|'REPROVADO'|'IGNORAR'} }
}
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

### Helpers globais (fora do componente)
- `sortDomain(values)`: ordena domínio — numérico crescente ou A-Z (locale pt-BR)
- `computeCinemaSize(rowDomain, colDomain)`: calcula `{w, h}` do nó a partir dos domínios (caps: 540×420)
- `fmtQty(n)`: formata número como inteiro, `k` ou `M`
- `fmtPct(v)`: formata ratio como `"XX.XX%"` ou `"N/A"` quando `v === null`
- `computeCellMetrics(shape, csvStore)`: agrega métricas do CSV por célula do Cineminha → `{[cellKey]: {qty, qtdAltas, qtdAltasInfer, inadRRaw, inadIRaw, inadReal, inadInferida}}`
- `buildParetoFrontier(cellMetrics)`: ordena células por `inadInferida` crescente e varre acumulando pontos da fronteira Pareto → array de pontos
- `extractScenarios(frontier)`: extrai 4 pontos representativos → `{conservador, balanceado, melhorEficiencia, expansao}` onde `melhorEficiencia` é o joelho da curva
- `isCellEligible(cells, key)`: retorna `true` se a célula está elegível (considera `null`/`true` como elegível, `false` como não elegível)
- `suggestVarType(colName, values)`: heurística para sugerir `ordinal` ou `categorical`
- `suggestMetricColumns(headers)`: heurística para mapear nomes de colunas aos tipos de métrica
- `detectDelimiter(text)`: detecta separador CSV com score de confiança
- `detectDecimalSep(text, delimiter)`: detecta separador decimal (`,` ou `.`)
- `matchLensRule(cellVal, operator, ruleVal)`: avalia uma regra de Decision Lens contra um valor de célula
- `normalizeColName(s)`: normaliza nome de coluna para comparação fuzzy

### Padrão de refs
Toda variável de estado crítica tem um ref espelho para uso em event listeners sem closure stale. Em todo `setX(...)`, o ref correspondente é atualizado imediatamente.

Refs existentes: `vpR`, `shapesR`, `connsR`, `toolR`, `fromIdR`, `editR`, `csvStoreR`, `activeCellR`, `panelDragR`, `editConnR`, `axisModalR`, `multiSelR`, `selRectR`, `selR`, `undoStackR`, `redoStackR`, `lensModalR`, `lensPopulationsR`, `businessWidgetR`, `cinemaLibraryR`.

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
| `RUN_SIMULATION` | `{shapes, conns}` | Roda `runSimulation` e responde com `SIMULATION_RESULT` |
| `COMPUTE_OVERLAY` | `{shapes, conns, lensPopulations}` | Roda `computeSimulatedDecisions` + `computeIncrementalResult`; responde com `OVERLAY_RESULT` |
| `COMPUTE_OPTIM` | `{shape}` | Roda `computeCellMetrics` + `buildParetoFrontier` + `extractScenarios`; responde com `OPTIM_RESULT` |
| `COMPUTE_JOHNNY` | `{shapes}` | Roda `computeJohnnyData`; responde com `JOHNNY_RESULT` |

### Mensagens de saída
| type | payload |
|------|---------|
| `SIMULATION_RESULT` | `{result: SimulationResult}` |
| `OVERLAY_RESULT` | `{overlay, incrementalResult}` |
| `OPTIM_RESULT` | `{shapeId, cellMetrics, frontier, scenarios, maxInadReal, maxInadInf}` |
| `JOHNNY_RESULT` | `{pooledMetrics, frontier, scenarios, mixCats, shapeMetas, baselineApprovalRate, maxInadReal, maxInadInf}` ou `{error: 'no_data'}` |

### Funções no worker
- `runSimulation(shapes, conns, csvStore)`: percorre todas as linhas de todos os CSVs pelo grafo, acumula métricas e retorna `SimulationResult`
- `computeSimulatedDecisions(shapes, conns, csvStore, lensPopulations)`: compara decisão simulada vs. `__DECISAO_ORIGINAL` por linha
- `computeIncrementalResult(overlay, csvStore)`: agrega `baseline`, `simulated` e `impacted` a partir do overlay
- `computeCellMetrics(shape, csvStore)`: agrega métricas por célula do Cineminha
- `buildParetoFrontier(cellMetrics)`: fronteira Pareto greedy (sort por `inadInferida` crescente)
- `extractScenarios(frontier)`: `{conservador, balanceado, melhorEficiencia, expansao}` — `melhorEficiencia` é o joelho da curva
- `computeJohnnyData(shapes, csvStore)`: agrupa métricas de **todos** os Cineminhas em pool único, gera fronteira Pareto global com suporte a ordinalidade

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
Com 2 ou mais nós Cineminha selecionados, a toolbar contextual exibe **⚡ Otimização Johnny (N)**. Dispara `COMPUTE_JOHNNY` no worker com os shapes selecionados.

### Algoritmo
1. **Pool de métricas**: agrega células de **todos** os Cineminhas selecionados em um único espaço
2. **Badness**: células de variáveis ordinais recebem `badness = rowRank + colRank` (0=melhor, 2=pior); variáveis categóricas têm `badness = 0.5 + 0.5`
3. **Fronteira Pareto**: sort por `badness` crescente + `inadInferida` crescente; greedy acumulando células; produz fronteira global
4. **Mix de risco**: se coluna `mixRisco` presente, acumula distribuição por categoria de risco por ponto da fronteira
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
| ADR-003 | SVG puro para o canvas | Controle total; suporte a `foreignObject` para HTML dentro do SVG |
| ADR-004 | Refs espelho para event listeners | Evita closure stale em `addEventListener` |
| ADR-005 | Build em `release/` no mesmo repo | Distribuição simplificada — abrir `index.html` sem servidor |

## Comandos de desenvolvimento

```bash
npm install       # instalar dependências
npm run dev       # servidor de desenvolvimento (Vite)
npm run build     # build de produção → dist/
npm run preview   # preview do build de produção
```

## Branch de desenvolvimento atual
`claude/claude-md-docs-oohkmq`

## Roadmap futuro (não implementado)

- **Restrição de monotonicidade**: flag `ordinal` no wizard passo 2 → corte monotônico (Young diagram) no algoritmo Pareto — para variáveis como ratings R1–R20 (parcialmente implementado no Johnny via `badness`/`rowRank`/`colRank`)
- **Sliders adicionais**: margem, rentabilidade ajustada ao risco (RAR), restrição de volume mínimo por segmento
- **Fronteira Pareto multi-dimensional**: 3D (aprovação × inad.real × inad.inferida)
- **Decision Lens — modo incremental**: comparação visual linha a linha das decisões mudadas
- **Exportação**: JSON canônico da política para importação em motor de decisão em produção; exportação do canvas como PNG/SVG
- **Persistência**: auto-save no `localStorage`; export/import de sessão como `.credito.json`
- **Cálculo de delta marginal**: "adicionar esta célula muda aprovação em +X pp e inad em +Y pp"
