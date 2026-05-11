# AppCreditoSimulador

## Stack
- React + Vite, arquivo único: `src/App.jsx` (~3123 linhas)
- Sem CSS externo — tudo inline styles
- Sem bibliotecas de UI — SVG puro para o canvas; matrizes interativas via `foreignObject`

## O que é
Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos ou matrizes cruzadas (Cineminha) e monta um fluxo de política de crédito. O painel de simulação exibe taxa de aprovação e indicadores de inadimplência em tempo real.

## Estrutura de dados (src/App.jsx)

### Estado principal
- `shapes`: formas no canvas — tipos: `rect`, `circle`, `diamond`, `decision`, `port`, `approved`, `rejected`, `csv`, `simPanel`, `cineminha`
- `conns`: conexões/setas entre shapes — `{id, from, to, label?}`
- `csvStore`: `{[csvId]: {name, headers, rows, columnTypes: {[colName]: 'id'|'decision'|'qty'|'qtdAltas'|'inadReal'|'inadInferida'}, varTypes: {[colName]: 'ordinal'|'categorical'}}}`
- `wizard`: modal de importação/edição em 2 passos — `{rawText, filename, delimiter, hasHeader, step: 1|2, columnTypes, varTypes, editCsvId: null|string}`
- `vp`: viewport — `{x, y, s}` (posição + zoom)
- `axisModal`: modal de seleção de eixo do Cineminha — `null | {shapeId, col, csvId}`

### Tipos de coluna (`COL_TYPES`)
| value          | icon | label              | uso                                              |
|----------------|------|--------------------|--------------------------------------------------|
| `id`           | 🔑   | ID                 | Identificador do registro                        |
| `decision`     | 🔀   | Filtro             | Variável de decisão arrastável ao canvas         |
| `qty`          | 📊   | Vol. Propostas     | Volume total de propostas do agrupamento         |
| `qtdAltas`     | 📈   | Qtd Altas/Vendas   | Volume convertido em vendas/ativações            |
| `inadReal`     | ⚠️   | Inad. Real         | Inadimplência histórica observada                |
| `inadInferida` | 🎯   | Inad. Inferida     | Inadimplência estimada para aprovados            |

### Tipos de variável (`VAR_TYPES`)
| value         | icon | label      | semântica                                                              |
|---------------|------|------------|------------------------------------------------------------------------|
| `ordinal`     | 📶   | Ordinal    | Hierarquia natural de risco; cortes devem respeitar monotonicidade     |
| `categorical` | 🏷️   | Categórica | Sem ordem natural; otimizador pode reorganizar categorias livremente   |

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
- `onEditDataset(csvId)`: reabre wizard no passo 2 para editar `columnTypes` e `varTypes` de um dataset já carregado (sem recarregar o arquivo)
- `renderConn(conn)`: renderiza seta com label no ponto médio da bezier
- `renderCSVNode(shape)`: tabela interativa minimizável no canvas
- `renderCinemaNode(shape)`: matriz interativa — estado vazio (ícone), 1D ou 2D via `foreignObject`
- `renderSimPanel(shape)`: painel SVG com Taxa de Aprovação, Inad. Real e Inad. Inferida

### Helpers globais (fora do componente)
- `sortDomain(values)`: ordena domínio — numérico crescente ou A-Z (locale pt-BR)
- `computeCinemaSize(rowDomain, colDomain)`: calcula `{w, h}` do nó a partir dos domínios (caps: 540×420)
- `suggestVarType(colName, values)`: heurística que infere `'ordinal'` ou `'categorical'`; padrões detectados: todos numéricos, sequências alfanuméricas (R1-R20), faixas bucket (0-10, >50), prefixo+número (Score_01), nome da coluna (score/rating/faixa/bucket…); default seguro = `'categorical'`
- `fmtQty(n)`: formata número como inteiro, `k` ou `M`
- `fmtPct(v)`: formata ratio como `"XX.XX%"` ou `"N/A"` quando `v === null`

### Padrão de refs
Toda variável de estado tem um ref espelho (`vpR`, `shapesR`, `axisModalR`, etc.) para uso em event listeners sem closure stale.

## Fluxo do simulador
1. Importar CSV → Passo 1 (delimitador) → Passo 2 (classificar colunas + tipo Ordinal/Categórica)
2. Colunas **Filtro** aparecem como chips arrastáveis no painel direito
3. Arrastar chip para área vazia do canvas → losango com ports automáticos (até 10 valores)
4. Arrastar chip sobre um ⊞ Cineminha → modal "Linha ou Coluna?" → matriz cruzada
5. Conectar ports a outros nós ou a ✅ Aprovado / ❌ Reprovado
6. Duplo-clique em seta → editar label
7. Painel de simulação atualiza Taxa de Aprovação, Inad. Real e Inad. Inferida em tempo real
8. Clicar ✏️ no card do arquivo carregado → reabrir Passo 2 para editar classificações sem recarregar

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
- Retorna `{ totalQty, approvedQty, rejectedQty, approvalRate, inadReal, inadInferida }`
  - `inadReal = ∑ inadReal / ∑ qtdAltas` (null se qtdAltasSum = 0)
  - `inadInferida = ∑ inadInferida / approvedQty` (null se approvedQty = 0)
- Reconciliação de dataset (`onImportConfirm`): ao trocar CSV, o sistema faz match normalizado de variáveis em nós `cineminha`, recomputa domínios e preserva os estados de elegibilidade existentes

## Wizard de importação / edição (Passo 2)
- Modal alarga para 900px no passo 2 para acomodar 6 colunas de tipo + coluna "Tipo Var."
- Layout em CSS `grid` com `gridTemplateColumns: "1fr repeat(6, 60px) 100px"` — 6 checkboxes de `COL_TYPES` + select de `VAR_TYPES`
- Header sticky; lista de colunas com scroll interno (`maxHeight: 340px`)
- Header exibe ícone + label curto (`shortLabel`) de cada tipo; coluna "Tipo Var." em roxo
- Sugestão automática via `suggestVarType` ao avançar do Passo 1 para o Passo 2
- **Modo edição** (`editCsvId != null`): wizard abre direto no Passo 2, sem step 1; título "Editar Dataset"; botão "Salvar →"; oculta "← Voltar" e indicador de progresso; ao confirmar, atualiza o `csvStore` in-place sem criar novos nós no canvas

## Painel de Simulação (`simPanel`)
- Tamanho padrão: `w: 260, h: 280`
- Exibe três indicadores:
  1. **Taxa de Aprovação** — número grande + barra de progresso + contadores ✅/❌
  2. **Inad. Real** — `∑ Inad.Real / ∑ Altas aprovadas`; cor vermelha > 5%, laranja ≤ 5%, cinza = N/A
  3. **Inad. Inferida** — `∑ Inad.Inferida / Vol. Aprovado`; mesma escala de cor
- Sidebar direita espelha os três indicadores com recalculo reativo

## Painel direito — Arquivos carregados
Cada card de dataset exibe: nome, contagem de linhas/colunas, botão ✏️ (editar) e botão ✕ (remover).
- ✏️ chama `onEditDataset(csvId)` — reabre Passo 2 preservando classificações existentes
- ✕ chama `deleteCsvDataset(csvId)` — remove dataset e limpa referências nos shapes

## Branch de desenvolvimento
`claude/variable-constraints-governance-XpY6i`
