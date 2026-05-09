# AppCreditoSimulador

## Stack
- React + Vite, arquivo único: `src/App.jsx` (~1050 linhas)
- Sem CSS externo — tudo inline styles
- Sem bibliotecas de UI — SVG puro para o canvas

## O que é
Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos e monta um fluxo de política de crédito.

## Estrutura de dados (src/App.jsx)

### Estado principal
- `shapes`: formas no canvas — tipos: `rect`, `circle`, `diamond`, `decision`, `port`, `approved`, `rejected`, `csv`
- `conns`: conexões/setas entre shapes — `{id, from, to, label?}`
- `csvStore`: `{[csvId]: {name, headers, rows, columnTypes: {[colName]: 'id'|'decision'|'qty'}}}`
- `wizard`: modal de importação em 2 passos — `{rawText, filename, delimiter, hasHeader, step: 1|2, columnTypes}`
- `vp`: viewport — `{x, y, s}` (posição + zoom)

### Funções-chave
- `createDecisionNode(col, csvId, wx, wy)`: cria losango de decisão + ports automáticos com setas rotuladas (valores distintos da coluna)
- `deleteShape(id)`: deleta shape + cascade (ports filhos de nós decision)
- `startPanelDrag(e, col, csvId)`: inicia drag de variável do painel para o canvas
- `renderConn(conn)`: renderiza seta com label no ponto médio da bezier
- `renderCSVNode(shape)`: tabela interativa minimizável no canvas

### Padrão de refs
Toda variável de estado tem um ref espelho (`vpR`, `shapesR`, etc.) para uso em event listeners sem closure stale.

## Fluxo do simulador
1. Importar CSV → Passo 1 (delimitador) → Passo 2 (classificar colunas)
2. Variáveis de decisão aparecem como chips arrastáveis no painel direito
3. Arrastar chip → losango criado com ports de saída automáticos (valores distintos, até 10)
4. Conectar ports a outros losangos ou a ✅ Aprovado / ❌ Reprovado
5. Duplo-clique em seta → editar label

### Multi-seleção (`dragR`)
- `multiSelR`: `Set` com ids das shapes selecionadas
- Drag de multi-seleção armazena `wx0`/`wy0` (posição inicial do mouse em coords de mundo) + `snaps` (posições iniciais de cada shape)
- Delta calculado como `wx - wx0` para mover todas as shapes preservando posições relativas

## Branch de desenvolvimento
`claude/fix-multi-select-movement-aFHYt`
