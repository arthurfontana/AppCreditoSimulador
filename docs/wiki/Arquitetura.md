# Arquitetura

## Stack

| Camada | Tecnologia | Detalhe |
|--------|-----------|---------|
| Framework | React 18 | Hooks, sem class components |
| Build | Vite | Dev server + bundle de produção |
| Estilos | Inline styles | Sem CSS externo, sem biblioteca de UI |
| Canvas | SVG puro | Shapes, conexões e ports em SVG |
| Matrizes | `foreignObject` | Permite HTML dentro do SVG para as células |
| Dados | Estado local | `useState` + refs espelho — sem Redux/Zustand |

Todo o código vive em um único arquivo: **`src/App.jsx`** (~3300 linhas).

---

## Estado principal

```js
shapes    // formas no canvas
conns     // conexões/setas entre shapes
csvStore  // datasets importados
wizard    // modal de importação (3 passos)
vp        // viewport: { x, y, s } — posição + zoom
axisModal // modal de seleção de eixo do Cineminha
optimModal// modal de otimização Pareto do Cineminha
```

### Tipos de shape (`shapes`)

| Tipo | Descrição |
|------|-----------|
| `decision` | Losango de decisão — gerado ao arrastar variável Filtro para o canvas |
| `cineminha` | Matriz cruzada — cruza duas variáveis de decisão |
| `port` | Saída de um nó — filho de `decision` ou `cineminha` |
| `csv` | Tabela do dataset no canvas — minimizável |
| `simPanel` | Painel de simulação com indicadores em tempo real |
| `approved` | Nó terminal ✅ Aprovado |
| `rejected` | Nó terminal ❌ Reprovado |
| `rect` / `circle` / `diamond` | Formas genéricas de whiteboard |

### Tipos de coluna (`COL_TYPES`)

| Valor | Ícone | Uso |
|-------|-------|-----|
| `id` | 🔑 | Identificador do registro |
| `decision` | 🔀 | Variável de decisão arrastável ao canvas |
| `qty` | 📊 | Volume total de propostas do agrupamento |
| `qtdAltas` | 📈 | Volume convertido em vendas/ativações |
| `inadReal` | ⚠️ | Inadimplência histórica observada |
| `inadInferida` | 🎯 | Inadimplência estimada para aprovados |

---

## Funções-chave

| Função | O que faz |
|--------|-----------|
| `createDecisionNode(col, csvId, wx, wy)` | Cria losango + ports automáticos com setas rotuladas pelos valores distintos da coluna |
| `createCinemaNode(wx, wy)` | Cria nó Cineminha vazio + ports "Elegível" e "Não Elegível" |
| `assignCinemaVar(shapeId, col, csvId, axis)` | Atribui variável ao eixo `row` ou `col`, recomputa domínio e reconstrói `cells` |
| `toggleCinemaCell(shapeId, cellKey)` | Alterna elegibilidade de uma célula da matriz |
| `deleteShape(id)` | Deleta shape + cascade nos ports filhos |
| `startPanelDrag(e, col, csvId)` | Inicia drag de variável do painel lateral para o canvas |
| `openOptimModal(shapeId)` | Computa métricas + fronteira Pareto + cenários e abre o modal |
| `applyOptimResult(shapeId, proposedCells)` | Escreve resultado da otimização no Cineminha e fecha o modal |
| `renderConn(conn)` | Renderiza seta com label no ponto médio da bezier |
| `renderCSVNode(shape)` | Tabela interativa minimizável no canvas |
| `renderCinemaNode(shape)` | Matriz interativa — estado vazio, 1D ou 2D |
| `renderSimPanel(shape)` | Painel SVG com os três indicadores de simulação |

---

## Helpers globais

```js
sortDomain(values)              // ordena domínio: numérico crescente ou A-Z (pt-BR)
computeCinemaSize(rowD, colD)   // calcula {w, h} do nó (caps: 540×420)
fmtQty(n)                       // formata como inteiro, "k" ou "M"
fmtPct(v)                       // formata ratio como "XX.XX%" ou "N/A"
computeCellMetrics(shape, store) // agrega métricas do CSV por célula do Cineminha
buildParetoFrontier(cellMetrics) // fronteira Pareto greedy ordenada por inadInferida
extractScenarios(frontier)       // extrai pontos conservador, médio e máximo
```

---

## Padrão de refs espelho

Todo estado crítico tem um `ref` paralelo para uso em event listeners — evita o problema de closure stale onde um listener captura um valor antigo de estado.

```js
const [shapes, setShapes] = useState([])
const shapesR = useRef(shapes)
// em todo setShapes:
setShapes(s => { shapesR.current = s; return s })
```

Refs existentes: `vpR`, `shapesR`, `connsR`, `axisModalR`, `optimModalR`, `wizardR`.

---

## Constantes do Cineminha

```js
CINEMA_CELL_W  = 70   // largura de cada célula
CINEMA_CELL_H  = 30   // altura de cada célula
CINEMA_TITLE_H = 38   // altura da barra de título (drag handle)
CINEMA_HDR_H   = 32   // altura do cabeçalho de colunas (modo 2D)
CINEMA_LBL_W   = 84   // largura da coluna de rótulos de linha
CINEMA_MAX_W   = 540  // largura máxima do nó
CINEMA_MAX_H   = 420  // altura máxima do nó
```

---

## Indicador de Build (`BuildBadge`)

Componente no header do painel direito. Lê constantes injetadas pelo Vite no momento do build:

| Constante | Fonte |
|-----------|-------|
| `__BUILD_NUMBER__` | `git rev-list --count HEAD` |
| `__BUILD_TIME__` | `new Date().toISOString()` |
| `__BUILD_HASH__` | `git rev-parse --short HEAD` |
| `__BUILD_BRANCH__` | `git rev-parse --abbrev-ref HEAD` |
| `__BUILD_AUTHOR__` | `git log -1 --format="%an"` |

- Badge cinza: número e data do build
- Badge verde: build com menos de 5 minutos (sinaliza deploy recente)
- Tooltip: hash, branch e autor
