# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm install        # instalar dependências
npm run dev        # servidor de desenvolvimento (http://localhost:5173)
npm run build      # build de produção em dist/
npm run preview    # visualizar o build de produção
```

Não há testes automatizados nem linter configurado.

## Stack

- React 18 + Vite — arquivo único: `src/App.jsx` (~1200 linhas)
- Zero CSS externo — tudo inline styles
- Zero bibliotecas de UI — SVG puro para o canvas
- Zero backend — toda a lógica roda no cliente

## O que é

Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos e monta um fluxo de política de crédito. O motor de decisão executa todas as linhas do CSV pelo fluxo e exibe taxa de aprovação em tempo real.

## Estrutura de dados (src/App.jsx)

### Estado principal
- `shapes`: formas no canvas — tipos: `rect`, `circle`, `diamond`, `decision`, `port`, `approved`, `rejected`, `csv`, `simPanel`
- `conns`: conexões/setas — `{id, from, to, label?}`
- `csvStore`: `{[csvId]: {name, headers, rows, columnTypes: {[colName]: 'id'|'decision'|'qty'}}}`
- `wizard`: modal de importação CSV em 2 passos — `{rawText, filename, delimiter, hasHeader, step: 1|2, columnTypes}`
- `vp`: viewport — `{x, y, s}` (posição + escala/zoom)

### Padrão de refs espelho
Todo estado que é lido dentro de event listeners tem um ref espelho (`vpR`, `shapesR`, `connsR`, `toolR`, etc.) sincronizado via `useEffect`. Isso evita closures stale sem usar dependências nos handlers.

### Funções-chave
- `createDecisionNode(col, csvId, wx, wy)`: cria losango de decisão + ports automáticos com setas rotuladas (valores distintos da coluna, até `MAX_DISTINCT=10`)
- `deleteShape(id)`: deleta shape + cascade (ports filhos de nós `decision`)
- `startPanelDrag(e, col, csvId)`: inicia drag de variável do painel para o canvas
- `exportFlow()`: serializa `shapes`, `conns`, `csvStore`, `vp` em JSON versionado e dispara download
- `validateAndImportFlow(data)`: valida integridade e restaura estado completo a partir do JSON exportado
- `renderConn(conn)`: seta bezier com label no ponto 25% da curva
- `renderCSVNode(shape)`: tabela interativa minimizável via `<foreignObject>`
- `renderSimPanel(shape)`: painel de indicadores de simulação no canvas

### Motor de simulação (funções puras, fora do componente)
- `buildFlowGraph(shapes, conns)`: monta mapas `out` e `inc` de adjacência
- `validateFlow(shapes, conns)`: DFS detectando loops e caminhos sem finalização; retorna `{[shapeId]: mensagem}`
- `runSimulation(shapes, conns, csvStore)`: percorre cada linha do CSV pelo grafo a partir do primeiro nó `decision` sem predecessores de decisão; retorna `{totalQty, approvedQty, rejectedQty, approvalRate}`

Ambos são chamados via `useMemo` e reagem automaticamente a qualquer mudança em `shapes`, `conns` ou `csvStore`.

## Fluxo do simulador

1. Importar CSV → Passo 1 (detectar/confirmar delimitador) → Passo 2 (classificar colunas: `id` / `decision` / `qty`)
2. Variáveis `decision` aparecem como chips arrastáveis no painel direito
3. Arrastar chip → `createDecisionNode` → losango + ports de saída automáticos (um por valor distinto)
4. Conectar ports a outros losangos ou a ✅ Aprovado / ❌ Reprovado
5. `runSimulation` recalcula automaticamente; `validateFlow` marca nós com erro em vermelho

## Exportação / Importação de fluxo

O JSON exportado segue o schema:
```json
{
  "schemaVersion": "1.0",
  "generatedAt": "<ISO date>",
  "flowId": "<uid>",
  "viewport": { "x": 0, "y": 0, "s": 1 },
  "shapes": [...],
  "conns": [...],
  "csvStore": { "<csvId>": { "name", "headers", "rows", "columnTypes" } }
}
```
Na importação, `_id` (contador de IDs, módulo-level) é avançado para além do maior ID numérico encontrado no arquivo, evitando colisões.

## Branch de desenvolvimento
`claude/flow-export-import-kApHk`
