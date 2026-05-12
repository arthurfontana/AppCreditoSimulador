# AppCreditoSimulador

## Stack
- React + Vite, arquivo único: `src/App.jsx` (~4350 linhas)
- Sem CSS externo — tudo inline styles
- Sem bibliotecas de UI — SVG puro para o canvas; matrizes interativas via `foreignObject`

## O que é
Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos ou matrizes cruzadas (Cineminha) e monta um fluxo de política de crédito. O painel de simulação exibe taxa de aprovação e indicadores de inadimplência em tempo real.

## Estrutura de dados (src/App.jsx)

### Estado principal
- `shapes`: formas no canvas — tipos: `rect`, `circle`, `diamond`, `decision`, `port`, `approved`, `rejected`, `csv`, `simPanel`, `cineminha`
- `conns`: conexões/setas entre shapes — `{id, from, to, label?}`
- `csvStore`: `{[csvId]: {name, headers, rows, columnTypes: {[colName]: 'id'|'decision'|'qty'|'qtdAltas'|'inadReal'|'inadInferida'}}}`
- `wizard`: modal de importação em 2 passos — `{rawText, filename, delimiter, hasHeader, step: 1|2, columnTypes}`
- `vp`: viewport — `{x, y, s}` (posição + zoom)
- `axisModal`: modal de seleção de eixo do Cineminha — `null | {shapeId, col, csvId}`
- `optimModal`: modal de otimização do Cineminha — `null | {shapeId, cellMetrics, frontier, scenarios, activeCard, proposedCells, sliderApproval, sliderInadReal, sliderInadInf, maxInadReal, maxInadInf}`

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
  rowVar: null | {col, csvId},     // variável no eixo de linhas
  colVar: null | {col, csvId},     // variável no eixo de colunas
  rowDomain: string[],             // valores distintos ordenados do eixo linha
  colDomain: string[],             // valores distintos ordenados do eixo coluna
  cells: { [`${rowVal}|${colVal}`]: boolean },  // true = Elegível (default), false = Não Elegível
}
```
- Criado automaticamente com dois ports filhos: `"Elegível"` (verde) e `"Não Elegível"` (vermelho)
- Chave de célula 1D-linha: `"${rowVal}|*"` / 1D-coluna: `"*|${colVal}"`

### Funções-chave
- `createDecisionNode(col, csvId, wx, wy)`: cria losango de decisão + ports automáticos com setas rotuladas (valores distintos da coluna)
- `createCinemaNode(wx, wy)`: cria nó Cineminha vazio + ports "Elegível" e "Não Elegível"
- `assignCinemaVar(shapeId, col, csvId, axis)`: atribui variável ao eixo `'row'` ou `'col'`, recomputa domínio e reconstrói `cells`
- `toggleCinemaCell(shapeId, cellKey)`: alterna elegibilidade de uma célula
- `deleteShape(id)`: deleta shape + cascade (ports filhos de nós `decision` e `cineminha`)
- `startPanelDrag(e, col, csvId)`: inicia drag de variável do painel para o canvas
- `openOptimModal(shapeId)`: computa métricas + fronteira Pareto + cenários e abre `optimModal`
- `applyOptimResult(shapeId, proposedCells)`: escreve `proposedCells` de volta no Cineminha e fecha o modal
- `renderConn(conn)`: renderiza seta com label no ponto médio da bezier
- `renderCSVNode(shape)`: tabela interativa minimizável no canvas
- `renderCinemaNode(shape)`: matriz interativa — estado vazio (ícone), 1D ou 2D via `foreignObject`
- `renderSimPanel(shape)`: painel SVG com Taxa de Aprovação, Inad. Real, Inad. Inferida e (quando há simulação contrafactual ativa) delta incremental + seção de população impactada

### Componentes globais (fora do componente principal)
- `BuildBadge`: badge de versão/deploy exibido no header do painel direito — lê as constantes de build injetadas pelo Vite, exibe `#<número> · DD/MM HH:MM`, fica verde se o build tem menos de 5 min, e mostra tooltip com hash, branch e autor ao hover
- `SimIndicators`: cards de indicadores no sidebar — exibe estrutura tripla (simulado / delta / baseline) quando `incrementalResult` está disponível; caso contrário exibe resultado direto do `runSimulation`

### Helpers globais (fora do componente)
- `sortDomain(values)`: ordena domínio — numérico crescente ou A-Z (locale pt-BR)
- `computeCinemaSize(rowDomain, colDomain)`: calcula `{w, h}` do nó a partir dos domínios (caps: 540×420)
- `fmtQty(n)`: formata número como inteiro, `k` ou `M`
- `fmtPct(v)`: formata ratio como `"XX.XX%"` ou `"N/A"` quando `v === null`
- `computeCellMetrics(shape, csvStore)`: agrega métricas do CSV por célula do Cineminha → `{[cellKey]: {qty, qtdAltas, inadRRaw, inadIRaw, inadReal, inadInferida}}`
- `buildParetoFrontier(cellMetrics)`: ordena células por `inadInferida` crescente e varre acumulando pontos da fronteira Pareto → `[{cells, approvalRate, inadReal, inadInferida, totalQty, approvedQty}]`
- `extractScenarios(frontier)`: extrai 3 pontos representativos → `{conservador, medio, maximo}` onde `medio` é o joelho da curva (máxima distância perpendicular à reta conservador–máximo)
- `computeSimulatedDecisions(shapes, conns, csvStore, lensPopulations)`: para cada linha de cada CSV com `__DECISAO_ORIGINAL`, executa traversal do board apenas para registros da população-alvo dos Lens; retorna `{[csvId]: {rowDecisions, summaryStats}}` ou `null`
- `computeIncrementalResult(overlay, csvStore)`: agrega KPIs híbridos a partir do overlay — registros não-impactados usam `DECISAO_ORIGINAL`, impactados usam `DECISAO_SIMULADA`; retorna `{baseline, simulated, impacted}` com aprovação, inadimplência real/inferida, volumes e métricas de população impactada

### Padrão de refs
Toda variável de estado tem um ref espelho (`vpR`, `shapesR`, `axisModalR`, etc.) para uso em event listeners sem closure stale.

## Fluxo do simulador
1. Importar CSV → Passo 1 (delimitador) → Passo 2 (classificar colunas)
2. Colunas **Filtro** aparecem como chips arrastáveis no painel direito
3. Arrastar chip para área vazia do canvas → losango com ports automáticos (até 10 valores)
4. Arrastar chip sobre um ⊞ Cineminha → modal "Linha ou Coluna?" → matriz cruzada
5. Conectar ports a outros nós ou a ✅ Aprovado / ❌ Reprovado
6. Duplo-clique em seta → editar label
7. Painel de simulação atualiza Taxa de Aprovação, Inad. Real e Inad. Inferida em tempo real

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
- `validateFlow`: inclui `cineminha` no conjunto de nós de fluxo válidos
- `runSimulation` / `traverseRow`: para nós `cineminha`, faz lookup em `cells` com a chave `${rowVal}|${colVal}` e roteia para o port `"Elegível"` ou `"Não Elegível"`
- Para cada linha aprovada, acumula `inadRealSum`, `qtdAltasSum` e `inadInferidaSum`
- Retorna `{ totalQty, approvedQty, rejectedQty, approvalRate, inadReal, inadInferida, edgeStats }`
  - `inadReal = ∑ inadReal / ∑ qtdAltas` (null se qtdAltasSum = 0)
  - `inadInferida = ∑ inadInferida / approvedQty` (null se approvedQty = 0)
- Reconciliação de dataset (`onImportConfirm`): ao trocar CSV, o sistema faz match normalizado de variáveis em nós `cineminha`, recomputa domínios e preserva os estados de elegibilidade existentes

## Engine Contrafactual Incremental (Features 6–8)

### Cadeia reativa
```
shapes + conns + csvStore
    ↓ computeLensAffectedRows
lensPopulations  {[lensId]: {[csvId]: boolean[]}}
    ↓ computeSimulatedDecisions
simulationOverlay  {[csvId]: {rowDecisions, summaryStats}} | null
    ↓ computeIncrementalResult
incrementalResult  {baseline, simulated, impacted} | null
```
Todos os três são `useMemo` — recalculam automaticamente a cada mudança no board.

### `simulationOverlay`
Requer CSV com coluna `__DECISAO_ORIGINAL` (gerada no wizard quando `asIsVar` é configurada) e ao menos um `decision_lens` ativo. Para cada linha da população-alvo executa traversal do board; linhas fora da população retornam `decisaoSimulada = decisaoOriginal`.

Campos de cada entrada em `rowDecisions`:
| Campo | Tipo | Descrição |
|---|---|---|
| `rowIdx` | number | índice na array `csv.rows` |
| `decisaoOriginal` | `"APROVADO"\|"REPROVADO"\|""` | baseline histórico |
| `decisaoSimulada` | `"APROVADO"\|"REPROVADO"\|""` | resultado do board simulado |
| `flagImpactado` | boolean | `decisaoOriginal !== decisaoSimulada` |
| `flagMutavel` | boolean | pertence à população-alvo de algum Lens |
| `componenteOrigem` | string\|null | label do terminador que gerou a decisão simulada |

### `incrementalResult`
Estrutura retornada por `computeIncrementalResult`:
```js
{
  baseline:  { approvedQty, rejectedQty, totalQty, approvalRate, inadReal, inadInferida },
  simulated: { approvedQty, rejectedQty, totalQty, approvalRate, inadReal, inadInferida },
  impacted:  { qty, totalQty, pct, rToA, aToR, approvalDelta },
}
```
- `baseline`: KPIs calculados exclusivamente com `DECISAO_ORIGINAL`
- `simulated`: KPIs híbridos — `DECISAO_ORIGINAL` para não-impactados, `DECISAO_SIMULADA` para impactados
- `impacted.approvalDelta`: `simulated.approvalRate − baseline.approvalRate` (em pontos percentuais absolutos)

### Exibição nos cards (Feature 7)
Quando `incrementalResult` está ativo, `SimIndicators` e `renderSimPanel` exibem:
- Linha 1 (principal): valor do cenário **simulado**
- Linha 2 (delta): diferença em **p.p** com cor verde (melhora) ou vermelho (piora)
- Linha 3 (terciária): `Baseline: XX.X%` em cinza
- Barra de progresso: marcador vertical indica posição do baseline

### Exibição de população impactada (Feature 8)
Seção "🔬 População Impactada" exibida quando `inc.impacted.qty > 0`:
- Volume alterado e % da base
- Cards lado a lado: R→A (novos aprovados) e A→R (novos reprovados)

## Wizard de importação (Passo 2)
- Modal alarga para 780px no passo 2 para acomodar 6 colunas de tipo
- Layout em CSS `grid` com `gridTemplateColumns: "1fr repeat(6, 68px)"` — alinhamento perfeito entre header e linhas
- Header sticky; lista de colunas com scroll interno (`maxHeight: 340px`)
- Header exibe ícone + label curto (`shortLabel`) de cada tipo

## Painel de Simulação (`simPanel`)
- Tamanho padrão: `w: 260, h: 280`
- Exibe três indicadores base:
  1. **Taxa de Aprovação** — número grande + barra de progresso + contadores ✅/❌
  2. **Inad. Real** — `∑ Inad.Real / ∑ Altas aprovadas`; cor vermelha > 5%, laranja ≤ 5%, cinza = N/A
  3. **Inad. Inferida** — `∑ Inad.Inferida / Vol. Aprovado`; mesma escala de cor
- **Modo contrafactual** (quando `incrementalResult` está ativo): cada indicador exibe estrutura tripla — valor simulado (principal) + delta em p.p (secundário, verde/vermelho) + baseline histórico (terciário, cinza); marcador visual na barra de progresso indica posição da baseline
- **Seção População Impactada** (Feature 8): exibida abaixo dos indicadores quando há simulação ativa — volume alterado, % da base, cards R→A e A→R
- Sidebar direita espelha todos os indicadores via componente `SimIndicators` com o mesmo comportamento contrafactual

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

### Roadmap futuro (não implementado)

- Flag `ordinal` por coluna de decisão (wizard passo 2) + restrição de corte monotônico no algoritmo Pareto (escada Young diagram) para variáveis como ratings R1–R20
- Sliders adicionais: margem, rentabilidade
- Fronteira Pareto multi-dimensional

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
`claude/incremental-indicator-reprocessing-ejlW2`
