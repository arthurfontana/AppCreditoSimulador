# AppCreditoSimulador

## Stack
- React + Vite, arquivo único: `src/App.jsx`
- Sem CSS externo — tudo inline styles
- Sem bibliotecas de UI — SVG puro para o canvas; matrizes interativas via `foreignObject`

## O que é
Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos ou matrizes cruzadas (Cineminha) e monta um fluxo de política de crédito. O painel de simulação exibe taxa de aprovação e indicadores de inadimplência em tempo real.

## Estrutura de dados (src/App.jsx)

### Estado principal
- `shapes`: formas no canvas — tipos: `rect`, `circle`, `diamond`, `decision`, `port`, `approved`, `rejected`, `as_is`, `csv`, `simPanel`, `cineminha`, `decision_lens`, `frame`
- `conns`: conexões/setas entre shapes — `{id, from, to, label?}`
- `csvStore`: `{[csvId]: {name, headers, rows, columnTypes, varTypes, asIsConfig}}`
- `wizard`: modal de importação em 3 passos — `{rawText, filename, delimiter, hasHeader, step: 1|2|3, columnTypes, varTypes, asIsVar, asIsMapping, editCsvId}`
- `vp`: viewport — `{x, y, s}` (posição + zoom)
- `axisModal`: modal de seleção de eixo do Cineminha — `null | {shapeId, col, csvId}`
- `optimModal`: modal de otimização do Cineminha — `null | {shapeId, cellMetrics, frontier, scenarios, activeCard, proposedCells, sliderApproval, sliderInadReal, sliderInadInf, maxInadReal, maxInadInf}`
- `multiSel`: `Set<id>` — IDs das shapes selecionadas em modo multi-seleção
- `selRect`: `null | {x1, y1, x2, y2}` — retângulo de seleção em coordenadas de mundo
- `hoveredConn` / `hoveredConnPos`: estado de hover em conexão + posição na tela
- `panelDrag` / `ghostPos`: drag de variável do painel + posição do ghost
- `undoStack` / `redoStack`: pilhas de histórico para Ctrl+Z / Ctrl+Y
- `editConn`: estado do modal de edição inline de label de conexão
- `enableDynThickness`: espessura dinâmica de arestas baseada em volume
- `showEdgeVol` / `showEdgeInadReal` / `showEdgeInadInf`: toggles de métricas nas arestas
- `cinemaLibrary`: array persistente de templates salvos de cineminha
- `cinemaLibraryModal`: estado do modal de browse/save da biblioteca
- `cinemaTypeModal`: modal de seleção de tipo ao criar novo cineminha
- `importTypeModal`: modal de escolha entre importação padrão e importação da biblioteca
- `resultVarModal`: modal de seleção de variável de resultado para nós cineminha
- `incrementalResult`: `null | {baseline, simulated, impacted}` — resultado da simulação incremental
- `businessWidget`: `{visible, x, y, w, h}` — painel flutuante de métricas de negócio

### Tipos de coluna (`COL_TYPES`)
| value          | icon | label              | uso                                              |
|----------------|------|--------------------|--------------------------------------------------|
| `id`           | 🔑   | ID                 | Identificador do registro                        |
| `decision`     | 🔀   | Filtro             | Variável de decisão arrastável ao canvas         |
| `qty`          | 📊   | Vol. Propostas     | Volume total de propostas do agrupamento         |
| `qtdAltas`     | 📈   | Qtd Altas/Vendas   | Volume convertido em vendas/ativações            |
| `inadReal`     | ⚠️   | Inad. Real         | Inadimplência histórica observada                |
| `inadInferida` | 🎯   | Inad. Inferida     | Inadimplência estimada para aprovados            |

### Shape: `cineminha`
```js
{
  id, type:"cineminha", x, y, w, h,
  label: "Cineminha",
  cinemaType: string,              // tipo do template (ex: 'eligibility', 'offer')
  rowVar: null | {col, csvId},     // variável no eixo de linhas
  colVar: null | {col, csvId},     // variável no eixo de colunas
  rowDomain: string[],             // valores distintos ordenados do eixo linha
  colDomain: string[],             // valores distintos ordenados do eixo coluna
  cells: { [`${rowVal}|${colVal}`]: boolean },  // true = Elegível (default), false = Não Elegível
  resultVar: null | {col, csvId},  // variável de resultado mapeada ao output
  minimized: boolean,              // modo compacto (oculta matriz)
  identifiers: {},                 // metadados adicionais
  dimensions: {rowVariable, columnVariable},
}
```
- Criado automaticamente com dois ports filhos: `"Elegível"` (verde) e `"Não Elegível"` (vermelho)
- Chave de célula 1D-linha: `"${rowVal}|*"` / 1D-coluna: `"*|${colVal}"`
- `CINEMINHA_TYPES`: objeto com templates predefinidos; `getCinemaType(cinemaType)` resolve o config do template

### Shape: `decision_lens`
```js
{
  id, type:"decision_lens", x, y, w, h,
  label: string,
  rules: [{col, operator, value}],  // regras do filtro
  color: string,
}
```
- Constantes: `LENS_W = 182`, `LENS_H = 86`
- Operadores definidos em `LENS_OPERATORS`
- Incluído no conjunto `FLOW` do validador; incluído no `traverseRow`

### Shape: `frame`
- Container visual para agrupamento no canvas; renderizado na camada inferior (SVG separado)
- Campos: `{id, type:"frame", x, y, w, label, color}`
- Não participa do grafo de fluxo

### Shape: `as_is`
- Nó terminal representando a decisão histórica baseline
- Incluído no conjunto `TERM` (como `approved`/`rejected`) e no conjunto `FLOW`

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

### Funções-chave
- `createDecisionNode(col, csvId, wx, wy)`: cria losango de decisão + ports automáticos com setas rotuladas (valores distintos da coluna)
- `createCinemaNode(wx, wy)`: cria nó Cineminha vazio + ports "Elegível" e "Não Elegível"
- `createLensNode(wx, wy)`: cria nó Decision Lens vazio
- `assignCinemaVar(shapeId, col, csvId, axis)`: atribui variável ao eixo `'row'` ou `'col'`, recomputa domínio e reconstrói `cells`
- `assignResultVar(shapeId, col, csvId)` / `clearResultVar(shapeId)`: gerencia variável de resultado do cineminha
- `toggleCinemaCell(shapeId, cellKey)`: alterna elegibilidade de uma célula
- `deleteShape(id)`: deleta shape + cascade (ports filhos de nós `decision` e `cineminha`)
- `startPanelDrag(e, col, csvId)`: inicia drag de variável do painel para o canvas
- `openOptimModal(shapeId)`: computa métricas + fronteira Pareto + cenários e abre `optimModal`
- `applyOptimResult(shapeId, proposedCells)`: escreve `proposedCells` de volta no Cineminha e fecha o modal
- `pushHistory()` / `undo()` / `redo()`: sistema de histórico (Ctrl+Z / Ctrl+Y)
- `startCinemaImport(shapeId)`: inicia fluxo de importação de template da biblioteca
- `renderConn(conn)`: renderiza seta com label no ponto médio da bezier
- `renderCSVNode(shape)`: tabela interativa minimizável no canvas
- `renderCinemaNode(shape)`: matriz interativa — estado vazio (ícone), 1D ou 2D via `foreignObject`
- `renderDecisionLensNode(shape)`: nó de filtro com regras inline
- `renderFrame(shape)`: container visual renderizado na camada inferior
- `renderSimPanel(shape)`: painel SVG com Taxa de Aprovação, Inad. Real e Inad. Inferida

### Componentes globais (fora do componente principal)
- `BuildBadge`: badge de versão/deploy exibido no header do painel direito — lê as constantes de build injetadas pelo Vite, exibe `#<número> · DD/MM HH:MM`, fica verde se o build tem menos de 5 min, e mostra tooltip com hash, branch e autor ao hover

### Helpers globais (fora do componente)
- `sortDomain(values)`: ordena domínio — numérico crescente ou A-Z (locale pt-BR)
- `computeCinemaSize(rowDomain, colDomain)`: calcula `{w, h}` do nó a partir dos domínios (caps: 540×420)
- `fmtQty(n)`: formata número como inteiro, `k` ou `M`
- `fmtPct(v)`: formata ratio como `"XX.XX%"` ou `"N/A"` quando `v === null`
- `computeCellMetrics(shape, csvStore)`: agrega métricas do CSV por célula do Cineminha → `{[cellKey]: {qty, qtdAltas, inadRRaw, inadIRaw, inadReal, inadInferida}}`
- `buildParetoFrontier(cellMetrics)`: ordena células por `inadInferida` crescente e varre acumulando pontos da fronteira Pareto → `[{cells, approvalRate, inadReal, inadInferida, totalQty, approvedQty}]`
- `extractScenarios(frontier)`: extrai 3 pontos representativos → `{conservador, medio, maximo}` onde `medio` é o joelho da curva (máxima distância perpendicular à reta conservador–máximo)
- `matchLensRule(cellVal, operator, ruleVal)`: avalia uma única regra do Decision Lens
- `rowMatchesLensRules(row, headers, rules)`: verifica se linha do CSV atende todas as regras
- `computeLensPopulation(rules, csvStore)` / `computeLensAffectedRows(lensShape, csvStore)`: agrega linhas afetadas pelo lens
- `getCellValue(cells, key)` / `isCellEligible(cells, key)`: helpers de lookup de elegibilidade
- `populateCellsFromResultVar(shape, csvStore)`: preenche `cells` automaticamente a partir de coluna do CSV

### Padrão de refs
Toda variável de estado tem um ref espelho (`vpR`, `shapesR`, `axisModalR`, etc.) para uso em event listeners sem closure stale.

## Fluxo do simulador
1. Importar CSV → Passo 1 (delimitador) → Passo 2 (classificar colunas) → Passo 3 (variável AS IS)
2. Colunas **Filtro** aparecem como chips arrastáveis no painel direito
3. Arrastar chip para área vazia do canvas → losango com ports automáticos (até 10 valores)
4. Arrastar chip sobre um ⊞ Cineminha → modal "Linha ou Coluna?" → matriz cruzada
5. Conectar ports a outros nós ou a ✅ Aprovado / ❌ Reprovado / AS IS
6. Duplo-clique em seta → editar label
7. Ctrl+Z / Ctrl+Y → desfazer/refazer
8. Painel de simulação atualiza Taxa de Aprovação, Inad. Real e Inad. Inferida em tempo real

## Constantes do Cineminha
```js
CINEMA_CELL_W  = 70   // largura de cada célula da matriz
CINEMA_CELL_H  = 30   // altura de cada célula
CINEMA_TITLE_H = 38   // altura da barra de título (drag handle)
CINEMA_HDR_H   = 32   // altura do cabeçalho de colunas (modo 2D)
CINEMA_LBL_W   = 84   // largura da coluna de rótulos de linha
CINEMA_MAX_W   = 540  // largura máxima do nó
CINEMA_MAX_H   = 420  // altura máxima do nó
```

## Engine de simulação
- `validateFlow`: inclui `cineminha` e `decision_lens` no conjunto de nós de fluxo válidos; `as_is` no conjunto terminal
- `runSimulation` / `traverseRow`: para nós `cineminha`, faz lookup em `cells` com a chave `${rowVal}|${colVal}` e roteia para o port `"Elegível"` ou `"Não Elegível"`; para nós `decision_lens`, avalia regras via `rowMatchesLensRules`
- Para cada linha aprovada, acumula `inadRealSum`, `qtdAltasSum` e `inadInferidaSum`
- Retorna `{ totalQty, approvedQty, rejectedQty, approvalRate, inadReal, inadInferida }`
  - `inadReal = ∑ inadReal / ∑ qtdAltas` (null se qtdAltasSum = 0)
  - `inadInferida = ∑ inadInferida / approvedQty` (null se approvedQty = 0)
- **Simulação incremental**: `incrementalResult` armazena `{baseline, simulated, impacted}`; `SimIndicators` exibe cards de comparação quando ativo
- Reconciliação de dataset (`onImportConfirm`): ao trocar CSV, o sistema faz match normalizado de variáveis em nós `cineminha`, recomputa domínios e preserva os estados de elegibilidade existentes

## Wizard de importação (3 passos)

### Passo 1 — Delimitador
- Modal 600px; detecção automática do delimitador com badge "detectado automaticamente" / "verifique abaixo"
- Preview das 5 primeiras linhas

### Passo 2 — Classificar colunas
- Modal alarga para 900px para acomodar 6 colunas de tipo + coluna Tipo Var.
- Layout em CSS `grid` com `gridTemplateColumns: "1fr repeat(6, 60px) 100px"`
- Header sticky; lista de colunas com scroll interno (`maxHeight: 340px`)
- Seletor de varType por coluna: `categorical` | `ordinal`

### Passo 3 — Variável de Decisão AS IS
- Modal 680px; etapa obrigatória para configurar a baseline histórica
- **Seletor de coluna**: lista apenas colunas não-métricas (exclui `qty`, `qtdAltas`, `inadReal`, `inadInferida`)
- **Mapping de valores**: ao selecionar a coluna, exibe todos os distinct values com dropdown `✅ Aprovado / ❌ Reprovado / — Ignorar`
- **Validação em tempo real**: indicadores mostram se aprovado mapeado, reprovado mapeado, todos os valores atribuídos
- **On confirm**: deriva coluna `__DECISAO_ORIGINAL` (última posição em `headers`/`rows`) com valores `APROVADO` / `REPROVADO` / `''`; salva `asIsConfig` no csvStore
- **Edit mode**: restaura `asIsVar` e `asIsMapping` do `asIsConfig` salvo

## Variável de Decisão AS IS — Conceito

O simulador opera em modelo de **simulação incremental sobre comportamento observado**:
- A base histórica (`asIsConfig`) representa a realidade operacional
- `__DECISAO_ORIGINAL` é a coluna interna com a decisão normalizada de cada linha
- Usada por: simulação incremental (`incrementalResult`), nó terminal `as_is`, Decision Lens, cálculo de delta

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

## Painel de Simulação (`simPanel`)
- Tamanho padrão: `w: 260, h: 280`
- Exibe três indicadores:
  1. **Taxa de Aprovação** — número grande + barra de progresso + contadores ✅/❌
  2. **Inad. Real** — `∑ Inad.Real / ∑ Altas aprovadas`; cor vermelha > 5%, laranja ≤ 5%, cinza = N/A
  3. **Inad. Inferida** — `∑ Inad.Inferida / Vol. Aprovado`; mesma escala de cor
- Sidebar direita espelha os três indicadores com recalculo reativo
- Quando `incrementalResult` ativo: exibe cards comparativos baseline vs simulado

## Motor de Recomendação — Cineminha (`optimModal`)

### Ativação
Selecionar um nó `cineminha` exibe toolbar contextual com botão **⚙ Otimizar Decisão** (mesmo padrão visual da toolbar de alinhamento).

### Estado `optimModal`
```js
{
  shapeId,          // id do cineminha sendo otimizado
  cellMetrics,      // {[cellKey]: {qty, qtdAltas, inadRRaw, inadIRaw, inadReal, inadInferida}}
  frontier,         // array de pontos Pareto ordenado por approvalRate crescente
  scenarios,        // {conservador, medio, maximo} — pontos extraídos da fronteira
  activeCard,       // 'conservador' | 'medio' | 'maximo' | 'personalizado'
  proposedCells,    // {[cellKey]: boolean} — estado em edição (não aplicado ao canvas)
  sliderApproval,   // ratio 0–1 (driver primário)
  sliderInadReal,   // ratio 0–1 (restrição de teto)
  sliderInadInf,    // ratio 0–1 (restrição de teto)
  maxInadReal,      // valor máximo observado nas células (para range do slider)
  maxInadInf,       // valor máximo observado nas células (para range do slider)
}
```

### Algoritmo Pareto (fase 1 — sem restrição de monotonicidade)
1. `computeCellMetrics`: para cada `(rowVal, colVal)` do domínio, filtra linhas do CSV e agrega `qty`, `qtdAltas`, `inadRRaw` (soma de inadReal absolutas), `inadIRaw` (soma de inadInferida absolutas); computa taxas finais ponderadas
2. `buildParetoFrontier`: sort por `inadInferida` crescente (nulls ao final); varre acumulando `approvedQty / totalQty` e inad ponderadas — produz fronteira greedy ótima para variáveis categóricas
3. `extractScenarios`: conservador = primeiro ponto (menor inad), máximo = último (maior aprovação), médio = joelho da curva via distância perpendicular máxima à reta entre conservador e máximo

### Sliders interligados
- **Aprovação** (driver): encontra o ponto da fronteira com `|approvalRate - target|` mínimo; atualiza inad sliders como reflexo
- **Inad. Real / Inad. Inferida** (restrições): encontra maior `approvalRate` na fronteira onde `inad ≤ valor`; recalcula aprovação e o outro slider

### Cinco cards
| Card | Comportamento |
|------|--------------|
| 🛡 Conservador | pré-computado; clique aplica ao estado e sincroniza sliders |
| ⚖ Melhor Eficiência | pré-computado (joelho) |
| 🚀 Máxima Aprovação | pré-computado |
| 🎛 Personalizado | ativo quando usuário move slider ou clica célula manualmente |
| 📊 Política Completa | roda `validateFlow` + `runSimulation` com `proposedCells` em modo override; mostra "Fluxo incompleto" se `validateFlow` retornar erros |

### Aplicar
`applyOptimResult(shapeId, proposedCells)` — sobrescreve `cells` do Cineminha via `setShapes` e fecha o modal. Não-destrutivo: nenhuma alteração no canvas até o clique em "Aplicar".

## Biblioteca de Cineminha (`cinemaLibrary`)

- Array persistente de templates salvos localmente
- Cada item: `{name, cinemaType, rowVar, colVar, cells, metadata: {version, author, date}}`
- `cinemaLibraryModal`: modal para navegar, salvar e carregar templates
- `importTypeModal`: modal que aparece ao criar novo cineminha — escolhe entre "do zero" ou "da biblioteca"
- `startCinemaImport(shapeId)`: inicia fluxo de importação de template para um nó existente

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

## Branch de desenvolvimento
`claude/amazing-newton-oHOEt`
