# AppCreditoSimulador

## Stack
- React + Vite, arquivo único: `src/App.jsx` (~2300+ linhas)
- Sem CSS externo — tudo inline styles
- Sem bibliotecas de UI — SVG puro para o canvas; matrizes interativas via `foreignObject`

## O que é
Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos ou matrizes cruzadas (Cineminha) e monta um fluxo de política de crédito com analytics contextuais em tempo real.

## Estrutura de dados (src/App.jsx)

### Estado principal
- `shapes`: formas no canvas — tipos: `rect`, `circle`, `diamond`, `decision`, `port`, `approved`, `rejected`, `csv`, `simPanel`, `cineminha`
- `conns`: conexões/setas entre shapes — `{id, from, to, label?}`
- `csvStore`: `{[csvId]: {name, headers, rows, columnTypes: {[colName]: 'id'|'decision'|'qty'|'qtdAltas'|'inadReal'|'inadInferida'}}}`
- `wizard`: modal de importação em 2 passos — `{rawText, filename, delimiter, hasHeader, step: 1|2, columnTypes}`
- `vp`: viewport — `{x, y, s}` (posição + zoom)
- `axisModal`: modal de seleção de eixo do Cineminha — `null | {shapeId, col, csvId}`
- `hoveredConn`: `string | null` — id da conexão com hover ativo (exibe card analítico)
- `enableDynThickness`: `boolean` — feature flag para espessura dinâmica de arestas por volume
- `tooltip`: `null | {x, y, lines: string[]}` — tooltip contextual em coords de tela

### Shape: `cineminha`
```js
{
  id, type:"cineminha", x, y, w, h,
  label: string,                    // nome editável (default "Cineminha")
  minimized: boolean,               // modo compacto (false por padrão)
  rowVar: null | {col, csvId},      // variável no eixo de linhas
  colVar: null | {col, csvId},      // variável no eixo de colunas
  rowDomain: string[],              // valores distintos ordenados do eixo linha
  colDomain: string[],              // valores distintos ordenados do eixo coluna
  cells: { [`${rowVal}|${colVal}`]: boolean },  // true = Elegível (default), false = Não Elegível
}
```
- Criado automaticamente com dois ports filhos: `"Elegível"` (verde) e `"Não Elegível"` (vermelho)
- Chave de célula 1D-linha: `"${rowVal}|*"` / 1D-coluna: `"*|${colVal}"`
- Suporta resize pelas quinas/laterais quando selecionado (mesmo mecanismo dos frames)
- Suporta modo minimizado: exibe apenas barra de título + botão de maximizar

### Funções-chave
- `createDecisionNode(col, csvId, wx, wy)`: cria losango de decisão + ports automáticos com setas rotuladas (valores distintos da coluna)
- `createCinemaNode(wx, wy)`: cria nó Cineminha vazio + ports "Elegível" e "Não Elegível"
- `assignCinemaVar(shapeId, col, csvId, axis)`: atribui variável ao eixo `'row'` ou `'col'`, recomputa domínio e reconstrói `cells`
- `toggleCinemaCell(shapeId, cellKey)`: alterna elegibilidade de uma célula
- `deleteShape(id)`: deleta shape + cascade (ports filhos de nós `decision` e `cineminha`)
- `startPanelDrag(e, col, csvId)`: inicia drag de variável do painel para o canvas
- `applyAlign(dir)`: alinha/distribui shapes do `multiSel` — dirs: `'left'|'right'|'top'|'bottom'|'distH'|'distV'`
- `renderConn(conn)`: renderiza seta com analytics inline + colorização por inadimplência + hover card
- `renderCSVNode(shape)`: tabela interativa minimizável no canvas
- `renderCinemaNode(shape)`: matriz interativa — estado vazio, minimizado, 1D ou 2D via `foreignObject`

### Helpers globais (fora do componente)
- `sortDomain(values)`: ordena domínio — numérico crescente ou A-Z (locale pt-BR)
- `computeCinemaSize(rowDomain, colDomain)`: calcula `{w, h}` do nó a partir dos domínios (caps: 540×420)
- `lerpColor(a, b, t)`: interpola linearmente entre duas cores hex
- `inadColor(t)`: mapeia `t ∈ [0,1]` → cor suave (verde → amarelo → vermelho)

### Padrão de refs
Toda variável de estado tem um ref espelho (`vpR`, `shapesR`, `axisModalR`, etc.) para uso em event listeners sem closure stale.
- `prevToolR`: armazena a ferramenta ativa antes do pan por botão do meio do mouse
- `tooltipTimerR`: ref do timer de delay do tooltip (400ms)

## Fluxo do simulador
1. Importar CSV → Passo 1 (delimitador) → Passo 2 (classificar colunas)
2. Variáveis de decisão aparecem como chips arrastáveis no painel direito
3. Arrastar chip para área vazia do canvas → losango com ports automáticos (até 10 valores)
4. Arrastar chip sobre um ⊞ Cineminha → modal "Linha ou Coluna?" → matriz cruzada
5. Conectar ports a outros nós ou a ✅ Aprovado / ❌ Reprovado
6. Duplo-clique em seta → editar label
7. Hover sobre qualquer conexão → exibe card analítico contextual com 8 métricas

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
- `runSimulation` retorna:
  ```js
  {
    totalQty, approvedQty, rejectedQty, approvalRate,
    inadReal, inadInferida,
    edgeStats: {
      [connId]: { qty, approvedQty, rejectedQty, inadRealSum, inadInferidaSum, qtdAltasSum }
    }
  }
  ```
- `traverseRow`: rastreia o caminho de cada linha por `edgePath[]`, acumulando stats por `connId`
- Reconciliação de dataset (`onImportConfirm`): ao trocar CSV, o sistema faz match normalizado de variáveis em nós `cineminha`, recomputa domínios e preserva os estados de elegibilidade existentes

## Analytics de arestas (Feature 1)
- `edgeColorScale`: memoizado — normaliza `inadInferida` de todas as arestas em [0,1] para colorização relativa
- `edgeQtyScale`: memoizado — normaliza volume das arestas para espessura dinâmica
- Inline label por aresta: `"12.4k | 3.2% | 4.3%"` (vol | inadReal | inadInferida)
- Hover card via `foreignObject` em SVG: Volume, Aprovado, Reprovado, Taxa Aprovação, Inad. Real, Inad. Inferida, Qtd Altas, Participação %
- Feature flag **"Espessura Dinâmica"** no painel direito (seção "Visualização"): strokeWidth 1.5–4 proporcional ao volume

## Ferramentas de Alinhamento (Feature 2)
- Toolbar flutuante aparece automaticamente quando `multiSel.size > 1`
- Comandos: Alinhar Esq · Dir · Topo · Base · Dist. Horiz · Dist. Vert
- `applyAlign(dir)` reposiciona shapes preservando conexões

## Navegação por Middle Mouse (Feature 3)
- Botão do meio do mouse ativa pan temporário sem mudar a ferramenta ativa
- Ao soltar, restaura a ferramenta anterior via `prevToolR`

## Cineminha Avançado (Feature 4)
- **Resize**: 8 handles (quinas + laterais) quando `isSel && hasVars` — mesmo mecanismo de `type:"resize"` dos frames
- **Minimizar**: botão `−` na barra de título; modo compacto mostra apenas título + botão de maximizar
- **Renomear**: duplo-clique na barra de título → edit modal (via `onShapeDbl` → `setEdit`)

## Tooltips Contextuais (Feature 5)
- Delay de 400ms no hover antes de exibir
- Renderizado como `<div position:fixed>` fora do SVG (sem overflow)
- Decision nodes: nome completo da variável + coluna + contagem de valores distintos
- Port nodes: label completo sem truncagem
- Outros shapes: label completo

## Branch de desenvolvimento
`claude/add-analytics-policy-flow-fG2ZN`
