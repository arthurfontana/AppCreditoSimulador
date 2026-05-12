# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm run dev       # servidor de desenvolvimento (Vite)
npm run build     # build de produção (gera dist/)
npm run preview   # pré-visualizar o build de produção
```

Não há linter, formatter ou testes automatizados configurados. Verificação de erros: `npm run build` — se compilar sem erro, o código está correto.

## Stack

- React 18 + Vite 5, **arquivo único**: `src/App.jsx` (~4500 linhas)
- Zero CSS externo — tudo `style={{...}}` inline
- Zero bibliotecas de UI — SVG puro para o canvas; HTML rico dentro do SVG via `<foreignObject>`
- Constantes de build injetadas pelo Vite em `vite.config.js` (`__BUILD_NUMBER__`, `__BUILD_TIME__`, `__BUILD_HASH__`, `__BUILD_BRANCH__`, `__BUILD_AUTHOR__`)

## Arquitetura

Todo o código vive em `src/App.jsx`. A estrutura de alto nível:

```
Helpers globais (fora do componente)
  sortDomain · computeCinemaSize · fmtQty · fmtPct
  computeCellMetrics · buildParetoFrontier · extractScenarios

Componentes globais (fora do componente App)
  BuildBadge      — badge de versão no header do painel direito
  SimIndicators   — card "Business Impact Panel" no painel direito

export default function App()
  ├── Estado principal (useState)
  ├── Refs espelho (useRef) — evitam closure stale em event listeners
  ├── useMemo: simResult, incrementalResult, edgeStats, ...
  ├── Funções de domínio: createDecisionNode, createCinemaNode,
  │   assignCinemaVar, toggleCinemaCell, deleteShape,
  │   openOptimModal, applyOptimResult, ...
  ├── Renderizadores de nó: renderConn, renderCSVNode,
  │   renderCinemaNode, renderSimPanel
  └── JSX: <svg> canvas + painel direito (HTML)
```

### Estado principal

| Estado | Tipo | Descrição |
|---|---|---|
| `shapes` | `Shape[]` | Todos os nós do canvas |
| `conns` | `{id,from,to,label?}[]` | Arestas/setas |
| `csvStore` | `{[csvId]: {name,headers,rows,columnTypes}}` | CSVs importados |
| `simResult` | objeto | Resultado global da simulação |
| `incrementalResult` | `null \| {baseline, simulated, impacted}` | Presente quando um Cineminha está selecionado com métricas |
| `wizard` | `null \| {rawText,filename,delimiter,hasHeader,step,columnTypes}` | Modal de importação |
| `optimModal` | `null \| {...}` | Modal de otimização Pareto do Cineminha |
| `axisModal` | `null \| {shapeId,col,csvId}` | Modal de seleção de eixo |
| `vp` | `{x,y,s}` | Viewport (pan + zoom) |

**Padrão de refs espelho:** cada estado tem um `useRef` correspondente (`shapesR`, `vpR`, `axisModalR`, etc.) atualizado via `useEffect`. Os event listeners globais (`mousemove`, `mouseup`, `keydown`) usam os refs, nunca o estado direto, para evitar closures stale.

### Tipos de shape

`rect` · `circle` · `diamond` · `decision` · `port` · `approved` · `rejected` · `csv` · `simPanel` · `cineminha`

- **`decision`**: losango com ports filhos criados automaticamente (até 10 valores distintos da coluna)
- **`cineminha`**: matriz cruzada com `rowVar`, `colVar`, `rowDomain`, `colDomain`, `cells: {[rowVal|colVal]: boolean}`
- **`port`**: filho de `decision` ou `cineminha`; tem `parentId` e `label`
- **`simPanel`**: único por canvas; tamanho padrão `w:300, h:440`; renderizado via SVG + `foreignObject`
- **`csv`**: tabela minimizável; renderizada via `foreignObject`

### Tipos de coluna (`COL_TYPES`)

| value | uso |
|---|---|
| `id` | Identificador — não aparece no painel |
| `decision` | Filtro arrastável ao canvas como losango ou eixo do Cineminha |
| `qty` | Volume total de propostas do agrupamento |
| `qtdAltas` | Volume convertido em vendas/ativações |
| `inadReal` | Inadimplência histórica observada |
| `inadInferida` | Inadimplência estimada para aprovados |

### Engine de simulação

`runSimulation` / `traverseRow` percorre o grafo recursivamente a partir dos nós sem entrada (exceto `port`/`csv`/`simPanel`). Para cada linha do CSV:
- nó `decision`: filtra pelo valor da coluna, rota pela aresta com label correspondente
- nó `cineminha`: lookup em `cells[rowVal|colVal]`, rota para port `"Elegível"` ou `"Não Elegível"`

Retorna `{ totalQty, approvedQty, rejectedQty, approvalRate, inadReal, inadInferida }`:
- `inadReal = ∑ inadRealAbsoluto / ∑ qtdAltas` (null se qtdAltasSum = 0)
- `inadInferida = ∑ inadInferidaAbsoluto / approvedQty` (null se approvedQty = 0)

`incrementalResult` é computado via `useMemo` quando um `cineminha` está selecionado: roda a simulação duas vezes (baseline com cells originais, simulated com cells atuais) e computa `impacted: {qty, pct, rToA, aToR}`.

### Business Impact Panel (`simPanel` + `SimIndicators`)

Ambos compartilham a mesma lógica de apresentação — dark theme executivo (`#0f172a → #1a1040`):

- **Hero KPI**: taxa de aprovação (sem incremental) ou Δ aprovação (com incremental)
- **Grid 2×2**: Aprovação, Inad. Real, Inad. Inferida, Vol. Aprovado — com deltas semânticos
- **Sistema de cores semântico**: `positiveWhenHigher` (aprovação/volume) vs `positiveWhenLower` (inadimplência)
- **Barra de equilíbrio**: Risco ◄──●──► Crescimento, posição = `approvalRate * 0.6 + (1 - inadReal/0.12) * 0.4`
- **Seção "Efeito da Mudança"**: visível apenas quando `incrementalResult` existe

`renderSimPanel` usa `<foreignObject>` para embutir HTML rico dentro do SVG do canvas (mesmo padrão do Cineminha).

### Motor de Recomendação — `optimModal`

Ativado pelo botão **⚙ Otimizar Decisão** na toolbar contextual do Cineminha.

1. `computeCellMetrics(shape, csvStore)`: agrega por célula → `{qty, qtdAltas, inadRRaw, inadIRaw, inadReal, inadInferida}`
2. `buildParetoFrontier(cellMetrics)`: ordena células por `inadInferida` crescente; varre acumulando métricas → fronteira greedy
3. `extractScenarios(frontier)`: conservador (primeiro), expansão (último), melhorEficiência (joelho por distância perpendicular), balanceado (meio entre conservador e joelho)

Sliders interligados: **Aprovação** é driver primário; **Inad. Real** e **Inad. Inferida** são restrições de teto. `applyOptimResult` sobrescreve `cells` do Cineminha — não-destrutivo até o clique em "Aplicar".

### `foreignObject` — padrão de uso no canvas

Usado em `renderCSVNode`, `renderCinemaNode` e `renderSimPanel`. Estrutura padrão:

```jsx
<foreignObject x={x} y={y+HEADER_H} width={w} height={h-HEADER_H}>
  <div xmlns="http://www.w3.org/1999/xhtml"
    style={{width:"100%",height:"100%",overflow:"hidden",...}}
    onMouseDown={e=>e.stopPropagation()}>
    {/* HTML rico aqui */}
  </div>
</foreignObject>
```

O `onMouseDown` com `stopPropagation` é obrigatório para que interações dentro do foreignObject não disparem drag do nó.

## Branch de desenvolvimento atual

`claude/redesign-result-card-UKOAX`
