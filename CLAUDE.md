# AppCreditoSimulador

## Stack
- React + Vite, arquivo único: `src/App.jsx` (~1400 linhas)
- Sem CSS externo — tudo inline styles
- Sem bibliotecas de UI — SVG puro para o canvas

## O que é
Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos e monta um fluxo de política de crédito.

## Estrutura de dados (src/App.jsx)

### Estado principal
- `shapes`: formas no canvas — tipos: `rect`, `circle`, `diamond`, `decision`, `port`, `approved`, `rejected`, `csv`, `simPanel`
- `conns`: conexões/setas entre shapes — `{id, from, to, label?}`
- `csvStore`: `{[csvId]: {name, headers, rows, columnTypes: {[colName]: 'id'|'decision'|'qty'}}}`
- `wizard`: modal de importação em 2 passos — `{rawText, filename, delimiter, hasHeader, step: 1|2, columnTypes}`
- `vp`: viewport — `{x, y, s}` (posição + zoom)
- `exportModal`: boolean — modal de escolha de modo de exportação
- `importWarn`: string | null — aviso pós-importação (variáveis ausentes, sem dataset)
- `importError`: string | null — erro de importação de fluxo

### Funções-chave
- `createDecisionNode(col, csvId, wx, wy)`: cria losango de decisão + ports automáticos com setas rotuladas (valores distintos da coluna)
- `deleteShape(id)`: deleta shape + cascade (ports filhos de nós decision)
- `deleteCsvDataset(csvId)`: remove dataset do csvStore + remove nó CSV do canvas; preserva todo o fluxo (decision nodes, ports, conexões, finalizadores, simPanel)
- `startPanelDrag(e, col, csvId)`: inicia drag de variável do painel para o canvas
- `exportFlow()`: abre modal de exportação
- `doExport(includeData)`: executa export — modo `false` = somente política, `true` = política + dataset
- `validateAndImportFlow(data)`: importa fluxo JSON com validação de integridade; detecta fluxos sem dataset
- `renderConn(conn)`: renderiza seta com label no ponto médio da bezier
- `renderCSVNode(shape)`: tabela interativa minimizável no canvas
- `renderSimPanel(shape)`: painel de indicadores da simulação no canvas

### Padrão de refs
Toda variável de estado tem um ref espelho (`vpR`, `shapesR`, etc.) para uso em event listeners sem closure stale.

### Helpers puros
- `normalizeColName(s)`: normaliza nome de coluna para reconciliação — lowercase, remove espaços/underscores/hífens/pontos
- `buildFlowGraph(shapes, conns)`: monta grafo de adjacência `{out, inc}`
- `validateFlow(shapes, conns)`: detecta loops e caminhos sem finalização — retorna `{[shapeId]: mensagem}`
- `runSimulation(shapes, conns, csvStore)`: percorre cada linha do CSV pelo fluxo e retorna `{totalQty, approvedQty, rejectedQty, approvalRate}`

## Fluxo do simulador
1. Importar CSV → Passo 1 (delimitador) → Passo 2 (classificar colunas)
2. Variáveis de decisão aparecem como chips arrastáveis no painel direito
3. Arrastar chip → losango criado com ports de saída automáticos (valores distintos, até 10)
4. Conectar ports a outros losangos ou a ✅ Aprovado / ❌ Reprovado
5. Duplo-clique em seta → editar label
6. Painel de Simulação exibe Taxa de Aprovação, aprovados e reprovados em tempo real

## Gerenciamento de datasets

### Exclusão de dataset
- Botão ✕ em cada item de "Arquivos carregados" no painel direito
- Remove apenas o dataset (csvStore) e o nó CSV do canvas
- **Preserva**: nós de decisão, ports, conexões, regras, finalizadores, simPanel, posicionamento visual
- Indicadores resetam para estado vazio ("Sem dados carregados") automaticamente via useMemo

### Estado sem dataset
- O fluxo permanece 100% editável (nós, conexões, regras)
- Simulação retorna zeros naturalmente (sem dados para processar)
- simPanel exibe `—` na taxa e "Sem dados carregados"
- Painel de simulação fica sempre visível no painel lateral

### Reconciliação inteligente ao importar novo CSV
Quando um novo CSV é importado, `onImportConfirm` verifica nós de decisão órfãos (csvId ausente do store) e tenta rebindá-los automaticamente ao novo dataset por nome de coluna normalizado. Equivalências consideradas: case-insensitive, ignora espaços, underscores, hífens e pontos (`Receita_Federal` = `receita federal` = `RECEITA FEDERAL`).

## Exportação de fluxo

### Dois modos (modal de escolha)
- **Somente a Política**: exporta shapes, conns, viewport, metadata — sem dados CSV
- **Política + Dataset**: exporta tudo acima + csvStore completo com metadados de relacionamento

### Importação
- Suporta fluxos exportados com ou sem dataset
- Sem dataset → aviso "Aguardando dataset", fluxo editável normalmente
- Com dataset parcial → lista variáveis ausentes, simulação bloqueada até CSV compatível

## Branch de desenvolvimento
`claude/dataset-management-feature-36lqz`
