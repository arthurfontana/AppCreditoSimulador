# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## AppCreditoSimulador

Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos ou matrizes cruzadas (Cineminha) e monta um fluxo de política de crédito. O painel de simulação exibe taxa de aprovação e indicadores de inadimplência em tempo real.

## Stack
- React + Vite, **arquivo único**: `src/App.jsx` (~2900 linhas)
- Sem CSS externo — tudo inline styles
- Sem bibliotecas de UI — SVG puro para o canvas; matrizes interativas via `foreignObject`
- Sem testes automatizados

## Comandos

```bash
node_modules/.bin/vite          # dev server (npx vite falha se deps não instaladas)
node_modules/.bin/vite build    # build de produção → dist/
node_modules/.bin/vite preview  # preview do build
npm install                     # instalar dependências antes de qualquer comando vite
```

## Estrutura de dados (src/App.jsx)

### Estado principal
- `shapes`: formas no canvas — tipos: `rect`, `circle`, `diamond`, `decision`, `port`, `approved`, `rejected`, `csv`, `simPanel`, `cineminha`, `decision_lens`, `frame`
- `conns`: conexões/setas — `{id, from, to, label?}`
- `csvStore`: `{[csvId]: {name, headers, rows, columnTypes, varTypes, asIsConfig}}`
  - `asIsConfig`: `{col, mapping}` — coluna de decisão histórica + mapeamento para APROVADO/REPROVADO
  - Ao importar com `asIsConfig`, o sistema cria a coluna interna `__DECISAO_ORIGINAL` nas rows
- `vp`: viewport — `{x, y, s}` (posição + zoom)
- `lensModal`: `null | {shapeId, rules, population, varSearch}`
- `optimModal`: `null | {shapeId, cellMetrics, frontier, scenarios, activeCard, proposedCells, sliderApproval, sliderInadReal, sliderInadInf, maxInadReal, maxInadInf}`
- `axisModal`: `null | {shapeId, col, csvId}`

### Tipos de coluna (`COL_TYPES`)
| value          | icon | label              | uso                                              |
|----------------|------|--------------------|--------------------------------------------------|
| `id`           | 🔑   | ID                 | Identificador do registro                        |
| `decision`     | 🔀   | Filtro             | Variável de decisão arrastável ao canvas         |
| `qty`          | 📊   | Vol. Propostas     | Volume total de propostas do agrupamento         |
| `qtdAltas`     | 📈   | Qtd Altas/Vendas   | Volume convertido em vendas/ativações            |
| `inadReal`     | ⚠️   | Inad. Real         | Inadimplência histórica observada                |
| `inadInferida` | 🎯   | Inad. Inferida     | Inadimplência estimada para aprovados            |

### Shape: `decision_lens`
```js
{
  id, type:"decision_lens", x, y, w:182, h:86,
  label: "Decision Lens",
  rules: [{id, col, csvId, operator, value, logic: null|"AND"|"OR"}],
  color: "#fff",
}
```
Operadores disponíveis: `equal`, `notEqual`, `in`, `notIn`, `lt`, `lte`, `gt`, `gte`.  
O nó atua como **gateway de entrada** no fluxo: linhas que não passam nos filtros retornam `result:null` (não roteadas).

### Shape: `cineminha`
```js
{
  id, type:"cineminha", x, y, w, h,
  rowVar: null | {col, csvId},
  colVar: null | {col, csvId},
  rowDomain: string[],
  colDomain: string[],
  cells: { [`${rowVal}|${colVal}`]: boolean },  // true = Elegível (default)
}
```
Chave 1D-linha: `"${rowVal}|*"` / 1D-coluna: `"*|${colVal}"`.

### Padrão de refs
Toda variável de estado tem um ref espelho (`vpR`, `shapesR`, `csvStoreR`, `lensPopulationsR`, etc.) para uso em event listeners sem closure stale. O padrão é:
```js
const xR = useRef(x); useEffect(() => { xR.current = x; }, [x]);
```

## Engines de simulação (todas em `src/App.jsx`, fora do componente)

### `runSimulation(shapes, conns, csvStore)` — engine principal
- `useMemo` reativo a `[shapes, conns, csvStore]`
- `traverseRow` roteia cada linha pelo grafo: `decision` → match por label, `cineminha` → lookup em `cells`, `decision_lens` → `rowMatchesLensRules`, `port` → pass-through
- Retorna `{ totalQty, approvedQty, rejectedQty, approvalRate, inadReal, inadInferida, edgeStats }`
  - `inadReal = ∑ inadReal / ∑ qtdAltas` (null se zero)
  - `inadInferida = ∑ inadInferida / approvedQty` (null se zero)
  - `edgeStats`: `{[connId]: {qty, approvedQty, rejectedQty, qtdAltas, approvalRate, inadReal, inadInferida}}`

### `validateFlow(shapes, conns)`
- `useMemo` reativo a `[shapes, conns]`
- Valida por DFS — detecta loops e caminhos sem terminal
- Tipos de nó reconhecidos: `decision`, `port`, `approved`, `rejected`, `cineminha`, `decision_lens`

### `computeLensAffectedRows(lensShape, csvStore)` — Feature 4
- Retorna `{[csvId]: boolean[]}` — por índice de row, `true` = `FLAG_POPULACAO_ALVO`
- Usado para montar `lensPopulations` (useMemo reativo a `[shapes, csvStore]`)

### `computeSimulatedDecisions(shapes, conns, csvStore, lensPopulations)` — Feature 5
- Requer `__DECISAO_ORIGINAL` no CSV (criada pelo `asIsConfig`) e ao menos um Lens configurado
- Por linha: se `FLAG_MUTAVEL` (pertence a algum lens) → roda board; senão → `decisaoSimulada = decisaoOriginal`
- Retorna `{[csvId]: {rowDecisions, summaryStats}}` com `summaryStats: {totalQty, mutableQty, impactedQty, rToA, aToR}`
- `simulationOverlay` é um `useMemo` derivado; exibido no simPanel como "🔬 Impacto Marginal"

### `computeCellMetrics / buildParetoFrontier / extractScenarios` — Motor de Recomendação
- `computeCellMetrics(shape, csvStore)`: agrega métricas por célula do Cineminha
- `buildParetoFrontier(cellMetrics)`: fronteira greedy por `inadInferida` crescente
- `extractScenarios(frontier)`: extrai `{conservador, medio, maximo}` — médio via joelho (máx. distância perpendicular)

## Fluxo do simulador
1. Importar CSV → Passo 1 (delimitador) → Passo 2 (classificar colunas + opcional: definir Variável AS-IS)
2. Colunas **Filtro** aparecem como chips arrastáveis no painel direito
3. Arrastar chip para área vazia → losango de decisão com ports automáticos (até 10 valores distintos)
4. Arrastar chip sobre ⊞ Cineminha → modal "Linha ou Coluna?" → matriz cruzada
5. Decision Lens: filtra a população alvo antes de entrar no fluxo (e marca `FLAG_MUTAVEL`)
6. Conectar ports a outros nós ou a ✅ Aprovado / ❌ Reprovado
7. Painel de simulação atualiza métricas em tempo real; quando há asIsConfig + lens → exibe Impacto Marginal

## Funções-chave (callbacks dentro do componente)
- `createDecisionNode(col, csvId, wx, wy)`: cria losango + ports com setas rotuladas
- `createCinemaNode(wx, wy)`: cria Cineminha vazio + ports "Elegível"/"Não Elegível"
- `createLensNode(wx, wy)`: cria Decision Lens com `rules: []`
- `assignCinemaVar(shapeId, col, csvId, axis)`: atribui variável ao eixo, recomputa domínio e reconstrói `cells`
- `toggleCinemaCell(shapeId, cellKey)`: alterna elegibilidade de célula
- `openLensModal(shapeId)`: abre modal de configuração de filtros
- `applyLensRules(shapeId, rules)`: salva regras no shape e fecha modal
- `deleteShape(id)`: cascade — deleta ports filhos de nós `decision`, `cineminha` e `decision_lens`
- `openOptimModal(shapeId)`: computa métricas + fronteira + cenários → abre modal
- `applyOptimResult(shapeId, proposedCells)`: sobrescreve `cells` no Cineminha

## Helpers globais (fora do componente)
- `sortDomain(values)`: numérico crescente ou A-Z (locale pt-BR)
- `computeCinemaSize(rowDomain, colDomain)`: `{w, h}` com caps 540×420
- `fmtQty(n)`: inteiro, `k` ou `M`
- `fmtPct(v)`: `"XX.XX%"` ou `"N/A"` quando `v === null`
- `matchLensRule(cellVal, operator, ruleVal)`: avalia uma regra individual
- `rowMatchesLensRules(row, headers, rules)`: aplica lógica AND/OR sobre múltiplas regras
- `computeLensPopulation(rules, csvStore)`: conta `{count, total}` ponderado por qty (para exibição no modal)

## Componentes globais (fora do componente principal)
- `BuildBadge`: badge de versão no header do painel direito — lê constantes injetadas pelo Vite (`__BUILD_NUMBER__`, `__BUILD_TIME__`, `__BUILD_HASH__`, `__BUILD_BRANCH__`, `__BUILD_AUTHOR__`); fallback `"dev"` em modo dev

## Constantes relevantes
```js
// Cineminha
CINEMA_CELL_W=70, CINEMA_CELL_H=30, CINEMA_TITLE_H=38
CINEMA_HDR_H=32, CINEMA_LBL_W=84, CINEMA_MAX_W=540, CINEMA_MAX_H=420

// Decision Lens
LENS_W=182, LENS_H=86
```

## Regras de arquitetura
- **Arquivo único**: toda lógica, estado, helpers e renderização estão em `src/App.jsx`. Não criar novos arquivos sem necessidade explícita.
- **Sem CSS externo**: usar apenas `style={{...}}` inline.
- **Imutabilidade das decisões originais**: `__DECISAO_ORIGINAL` nunca é sobrescrita após criação — apenas `DECISAO_SIMULADA` (no overlay em memória) pode mudar.
- **Population boundary**: somente rows com `FLAG_MUTAVEL=true` (pertencentes a algum `lensPopulations`) podem ter decisão alterada pelo board.
- `simPanel` e `SimIndicators` (sidebar) derivam todos os valores de `simResult` e `simulationOverlay` — não há estado local de simulação.

## Branch de desenvolvimento atual
`claude/affected-population-engine-x9uzo`
