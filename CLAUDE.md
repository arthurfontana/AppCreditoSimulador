# AppCreditoSimulador

## Stack
- React + Vite, arquivo único: `src/App.jsx` (~1650 linhas)
- Sem CSS externo — tudo inline styles
- Sem bibliotecas de UI — SVG puro para o canvas; matrizes interativas via `foreignObject`

## O que é
Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos ou matrizes cruzadas (Cineminha) e monta um fluxo de política de crédito.

## Estrutura de dados (src/App.jsx)

### Estado principal
- `shapes`: formas no canvas — tipos: `rect`, `circle`, `diamond`, `decision`, `port`, `approved`, `rejected`, `csv`, `simPanel`, `cineminha`
- `conns`: conexões/setas entre shapes — `{id, from, to, label?}`
- `csvStore`: `{[csvId]: {name, headers, rows, columnTypes: {[colName]: 'id'|'decision'|'qty'}}}`
- `wizard`: modal de importação em 2 passos — `{rawText, filename, delimiter, hasHeader, step: 1|2, columnTypes}`
- `vp`: viewport — `{x, y, s}` (posição + zoom)
- `axisModal`: modal de seleção de eixo do Cineminha — `null | {shapeId, col, csvId}`

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
- `renderConn(conn)`: renderiza seta com label no ponto médio da bezier
- `renderCSVNode(shape)`: tabela interativa minimizável no canvas
- `renderCinemaNode(shape)`: matriz interativa — estado vazio (ícone), 1D ou 2D via `foreignObject`

### Helpers globais (fora do componente)
- `sortDomain(values)`: ordena domínio — numérico crescente ou A-Z (locale pt-BR)
- `computeCinemaSize(rowDomain, colDomain)`: calcula `{w, h}` do nó a partir dos domínios (caps: 540×420)

### Padrão de refs
Toda variável de estado tem um ref espelho (`vpR`, `shapesR`, `axisModalR`, etc.) para uso em event listeners sem closure stale.

## Fluxo do simulador
1. Importar CSV → Passo 1 (delimitador) → Passo 2 (classificar colunas)
2. Variáveis de decisão aparecem como chips arrastáveis no painel direito
3. Arrastar chip para área vazia do canvas → losango com ports automáticos (até 10 valores)
4. Arrastar chip sobre um ⊞ Cineminha → modal "Linha ou Coluna?" → matriz cruzada
5. Conectar ports a outros nós ou a ✅ Aprovado / ❌ Reprovado
6. Duplo-clique em seta → editar label

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
- Reconciliação de dataset (`onImportConfirm`): ao trocar CSV, o sistema faz match normalizado de variáveis em nós `cineminha`, recomputa domínios e preserva os estados de elegibilidade existentes

## Branch de desenvolvimento
`claude/add-decision-matrix-p49MR` — PR #7
