# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm run dev      # servidor de desenvolvimento (Vite)
npm run build    # build de produção → dist/
npm run preview  # preview do build de produção
```

Não há testes automatizados nem linter configurado. Validação é feita via `npm run build` — se compilar sem erro, o código está sintaticamente correto.

## Stack

- React + Vite, **arquivo único**: `src/App.jsx` (~5700 linhas)
- Sem CSS externo — tudo inline styles
- Sem bibliotecas de UI — SVG puro para o canvas; matrizes interativas via `foreignObject`
- Sem roteamento, sem gerenciador de estado externo

## O que é

Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos ou matrizes cruzadas (Cineminha) e monta um fluxo de política de crédito. O painel de simulação exibe taxa de aprovação e indicadores de inadimplência em tempo real.

## Estrutura de dados (src/App.jsx)

### Estado principal
- `shapes`: formas no canvas — tipos: `rect`, `circle`, `diamond`, `decision`, `port`, `approved`, `rejected`, `csv`, `simPanel`, `cineminha`, `decision_lens`
- `conns`: conexões/setas entre shapes — `{id, from, to, label?}`
- `csvStore`: `{[csvId]: {name, headers, rows, columnTypes, varTypes, asIsConfig}}`
- `wizard`: modal de importação de CSV em 3 passos — `{rawText, filename, delimiter, hasHeader, step: 1|2|3, columnTypes, varTypes, asIsVar, asIsMapping, editCsvId}`
- `libWizard`: wizard de importação de biblioteca CSV em 3 passos — `{rawText, filename, delimiter, hasHeader, step: 1|2|3, columnRoles, agrupadorOrder}`
- `importTypeModal`: modal de seleção de tipo de importação — `null | {shapeId}`
- `vp`: viewport — `{x, y, s}` (posição + zoom)
- `axisModal`: modal de seleção de eixo do Cineminha — `null | {shapeId, col, csvId}`
- `optimModal`: modal de otimização do Cineminha — `null | {shapeId, cellMetrics, frontier, scenarios, activeCard, proposedCells, sliderApproval, sliderInadReal, sliderInadInf, maxInadReal, maxInadInf}`
- `cinemaLibrary`: array de itens salvos na biblioteca de Cineminhas
- `cinemaLibraryModal`: `null | {mode:'browse'|'save', shapeId, search, filterType, saveMeta, overwriteId}`

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
  cinemaType: 'eligibility' | 'offer',
  rowVar: null | {col, csvId},
  colVar: null | {col, csvId},
  rowDomain: string[],
  colDomain: string[],
  cells: { [`${rowVal}|${colVal}`]: boolean },  // true = Elegível (default)
  metadata: { type, identifiers, dimensions, variables, source, description, tags, version }
}
```
- Criado automaticamente com dois ports filhos de acordo com `cinemaType` (Elegível/Não Elegível ou Com Oferta/Sem Oferta)
- Chave de célula 1D-linha: `"${rowVal}|*"` / 1D-coluna: `"*|${colVal}"`

### csvStore: entrada por dataset
```js
{
  name,          // nome do arquivo
  headers,       // string[] — inclui '__DECISAO_ORIGINAL' se asIsConfig configurado
  rows,          // string[][] — última coluna é '__DECISAO_ORIGINAL' se configurado
  columnTypes,   // {[colName]: COL_TYPE}
  varTypes,      // {[colName]: 'categorical'|'ordinal'}
  asIsConfig,    // null | { col: string, mapping: {[value]: 'APROVADO'|'REPROVADO'|'IGNORAR'} }
}
```

### Biblioteca de Cineminhas (`cinemaLibrary`)
Cada item:
```js
{
  id, savedAt, name, cinemaType,
  rowVar: null | {col},
  colVar: null | {col},
  rowDomain: string[],
  colDomain: string[],
  cells: { [cellKey]: boolean },
  metadata: { type, identifiers, dimensions, variables, source, description, tags, version }
}
```
- `source`: `'manual'` (salvo da toolbar), `'library_import_csv'` (gerado pelo wizard de biblioteca)
- `metadata.identifiers`: `{[agrupadorCol]: value}` — valores dos agrupadores quando gerado via CSV

### Funções-chave
- `createDecisionNode(col, csvId, wx, wy)`: cria losango de decisão + ports automáticos com setas rotuladas
- `createCinemaNode(wx, wy)`: cria nó Cineminha vazio + ports filhos
- `assignCinemaVar(shapeId, col, csvId, axis)`: atribui variável ao eixo `'row'` ou `'col'`, recomputa domínio e reconstrói `cells`
- `toggleCinemaCell(shapeId, cellKey)`: alterna elegibilidade de uma célula
- `deleteShape(id)`: deleta shape + cascade (ports filhos de nós `decision` e `cineminha`)
- `startPanelDrag(e, col, csvId)`: inicia drag de variável do painel para o canvas
- `openOptimModal(shapeId)`: computa métricas + fronteira Pareto + cenários e abre `optimModal`
- `applyOptimResult(shapeId, proposedCells)`: escreve `proposedCells` de volta no Cineminha e fecha o modal
- `startCinemaImport(shapeId)`: dispara file picker para importar JSON de configuração em um Cineminha existente
- `onLibFileChange(e)`: lê CSV, detecta delimitador, inicializa `libWizard` (passo 1)
- `onLibWizardConfirm()`: processa a tabela do `libWizard`, gera itens e os adiciona a `cinemaLibrary`
- `saveToLibrary()`: persiste Cineminha selecionado em `cinemaLibrary` com metadata
- `loadFromLibrary(item)`: cria novo nó Cineminha no canvas a partir de um item da biblioteca
- `renderConn(conn)`: renderiza seta com label no ponto médio da bezier
- `renderCSVNode(shape)`: tabela interativa minimizável no canvas
- `renderCinemaNode(shape)`: matriz interativa — estado vazio (ícone), 1D ou 2D via `foreignObject`
- `renderSimPanel(shape)`: painel SVG com Taxa de Aprovação, Inad. Real e Inad. Inferida

### Valores computados (render body)
- `wizardPreview`: `parseCSV(wizard.rawText, wizard.delimiter, wizard.hasHeader)` — rederivado a cada render; usado em todos os 3 passos do wizard de CSV
- `libWizardPreview`: `parseCSV(libWizard.rawText, libWizard.delimiter, libWizard.hasHeader)` — análogo para o wizard de biblioteca

### Componentes globais (fora do componente principal)
- `BuildBadge`: badge de versão/deploy no header do painel direito — lê constantes de build injetadas pelo Vite

### Helpers globais (fora do componente)
- `sortDomain(values)`: ordena domínio — numérico crescente ou A-Z (locale pt-BR)
- `computeCinemaSize(rowDomain, colDomain)`: calcula `{w, h}` do nó a partir dos domínios (caps: 540×420)
- `fmtQty(n)`: formata número como inteiro, `k` ou `M`
- `fmtPct(v)`: formata ratio como `"XX.XX%"` ou `"N/A"` quando `v === null`
- `computeCellMetrics(shape, csvStore)`: agrega métricas do CSV por célula do Cineminha
- `buildParetoFrontier(cellMetrics)`: produz fronteira greedy Pareto ordenada por `inadInferida`
- `extractScenarios(frontier)`: extrai 3 pontos representativos (conservador, médio, máximo)
- `parseCSV(text, delimiter, hasHeader)`: parser CSV puro — retorna `{headers, rows}`
- `detectDelimiter(text)`: heurística de detecção de delimitador — retorna `{delimiter, confident}`

### Padrão de refs
Toda variável de estado relevante tem um ref espelho (`vpR`, `shapesR`, `axisModalR`, `cinemaLibraryR`, etc.) para uso em event listeners sem closure stale. Adicionados com `useEffect(()=>{xR.current=x},[x])`.

## Fluxo do simulador

1. **Importar CSV** → wizard 3 passos (delimitador → classificar colunas → AS IS)
2. Colunas **Filtro** aparecem como chips arrastáveis no painel direito
3. Arrastar chip para área vazia → losango com ports automáticos (até 10 valores)
4. Arrastar chip sobre um ⊞ Cineminha → modal "Linha ou Coluna?" → matriz cruzada
5. Conectar ports a outros nós ou a ✅ Aprovado / ❌ Reprovado
6. Duplo-clique em seta → editar label
7. Painel de simulação atualiza indicadores em tempo real

## Jornada de Importação de Biblioteca (Cineminha)

O botão **⬆ Importar** na toolbar contextual do Cineminha abre `importTypeModal` com duas opções:

### JSON
Chama `startCinemaImport(shapeId)` — fluxo original de importar um `.json` exportado para sobrescrever a configuração de um Cineminha existente no canvas.

### Biblioteca (CSV)
Abre `libWizard` via `libFileInputRef`. Wizard de 3 passos:

**Passo 1 — Delimitador + Preview**
- Mesmo padrão visual do wizard de CSV: radio buttons `DELIMITERS`, checkbox cabeçalho, preview das 5 primeiras linhas
- `libWizardPreview` computado reativamente

**Passo 2 — Configuração de Estrutura**
- Grid: coluna → seletor de papel (`— Ignorar` / `⚙ Agrupador` / `→ Linha` / `↓ Coluna` / `✓ Resultado`)
- Papéis Linha, Coluna e Resultado: single-select automático (selecionar um remove do anterior)
- Agrupadores: multi-select; botões ▲/▼ reordenam `agrupadorOrder` (ordem afeta nome e `identifiers`)
- Avanço bloqueado até ao menos uma coluna ter papel `'linha'`

**Passo 3 — Preview de Grupos + Geração**
- Computa grupos inline via IIFE: `agrupadorOrder` → combinações únicas → `groupList`
- Exibe `N Cineminhas serão criados` + lista dos primeiros 10 grupos
- `onLibWizardConfirm()`: para cada grupo, constrói `rowDomain`/`colDomain` via `sortDomain`, popula `cells` a partir da coluna Resultado (valores negativos: `REPROVADO`, `N`, `FALSE`, `0`, `NE`, `NEGADO`, etc.), cria item de biblioteca com `metadata.source = 'library_import_csv'`
- Itens adicionados via `setCinemaLibrary(prev => [...prev, ...newItems])`

Os Cineminhas gerados ficam disponíveis na **📚 Biblioteca** de qualquer nó Cineminha para inserção no canvas.

## Wizard de importação de CSV (3 passos)

### Passo 1 — Delimitador
- Modal 600px; badge "detectado automaticamente" / "verifique abaixo"
- Preview das 5 primeiras linhas via `wizardPreview`

### Passo 2 — Classificar colunas
- Modal alarga para 900px
- Layout `grid` com `gridTemplateColumns: "1fr repeat(6, 60px) 100px"`
- Seletor de varType por coluna: `categorical` | `ordinal`

### Passo 3 — Variável de Decisão AS IS
- Modal 680px
- Seletor de coluna (exclui métricas); mapping de valores → `APROVADO / REPROVADO / IGNORAR`
- On confirm: deriva coluna `__DECISAO_ORIGINAL` em `headers`/`rows`; salva `asIsConfig`
- Edit mode: restaura `asIsVar` e `asIsMapping` do `asIsConfig` salvo

## Engine de simulação
- `validateFlow`: verifica conectividade do grafo, inclui `cineminha` e `decision_lens` no conjunto válido
- `runSimulation` / `traverseRow`: para nós `cineminha`, lookup em `cells` com `${rowVal}|${colVal}` e roteia para port `"Elegível"` ou `"Não Elegível"`
- Retorna `{ totalQty, approvedQty, rejectedQty, approvalRate, inadReal, inadInferida }`
  - `inadReal = ∑ inadReal / ∑ qtdAltas` (null se qtdAltasSum = 0)
  - `inadInferida = ∑ inadInferida / approvedQty` (null se approvedQty = 0)
- Reconciliação (`onImportConfirm`): ao trocar CSV, faz match normalizado de variáveis em nós `cineminha`, recomputa domínios e preserva elegibilidades existentes

## Constantes do Cineminha
```js
CINEMA_CELL_W   = 70    // largura de cada célula
CINEMA_CELL_H   = 30    // altura de cada célula
CINEMA_TITLE_H  = 38    // altura da barra de título (drag handle)
CINEMA_HDR_H    = 32    // altura do cabeçalho de colunas (modo 2D)
CINEMA_LBL_W    = 84    // largura da coluna de rótulos de linha
CINEMA_MAX_W    = 540   // largura máxima do nó
CINEMA_MAX_H    = 420   // altura máxima do nó
```

## Painel de Simulação (`simPanel`)
- Tamanho padrão: `w: 260, h: 280`
- Indicadores: Taxa de Aprovação, Inad. Real (`∑ inadReal / ∑ qtdAltas`), Inad. Inferida (`∑ inadInferida / approvedQty`)
- Cor vermelha > 5%, laranja ≤ 5%, cinza = N/A
- Sidebar direita espelha os três indicadores reativamente

## Motor de Recomendação — Cineminha (`optimModal`)

### Estado `optimModal`
```js
{
  shapeId,          // id do cineminha sendo otimizado
  cellMetrics,      // {[cellKey]: {qty, qtdAltas, inadRRaw, inadIRaw, inadReal, inadInferida}}
  frontier,         // array de pontos Pareto ordenado por approvalRate crescente
  scenarios,        // {conservador, medio, maximo}
  activeCard,       // 'conservador' | 'medio' | 'maximo' | 'personalizado'
  proposedCells,    // {[cellKey]: boolean} — estado em edição (não aplicado até "Aplicar")
  sliderApproval, sliderInadReal, sliderInadInf,
  maxInadReal, maxInadInf,
}
```

### Algoritmo Pareto
1. `computeCellMetrics`: agrega por célula — `qty`, `qtdAltas`, `inadRRaw`, `inadIRaw`, taxas ponderadas
2. `buildParetoFrontier`: sort por `inadInferida` crescente; varre acumulando `approvedQty/totalQty`
3. `extractScenarios`: conservador = menor inad, máximo = maior aprovação, médio = joelho (máxima distância perpendicular)

### Sliders interligados
- **Aprovação** (driver): snap ao ponto da fronteira com `|approvalRate - target|` mínimo
- **Inad. Real / Inad. Inferida** (restrições): maior `approvalRate` onde `inad ≤ valor`

## Indicador de Versão/Build (`BuildBadge`)

Constantes injetadas pelo Vite em `vite.config.js`:

| Constante | Fonte |
|---|---|
| `__BUILD_NUMBER__` | `git rev-list --count HEAD` |
| `__BUILD_TIME__` | `new Date().toISOString()` no momento do build |
| `__BUILD_HASH__` | `git rev-parse --short HEAD` |
| `__BUILD_BRANCH__` | `git rev-parse --abbrev-ref HEAD` |
| `__BUILD_AUTHOR__` | `git log -1 --format="%an"` |

Em `dev`, as constantes são `undefined` — o componente usa `"dev"` e `new Date()` como fallback.

## Variável de Decisão AS IS — Conceito

O simulador opera em **simulação incremental sobre comportamento observado**:
- `asIsConfig` representa a realidade operacional histórica
- `__DECISAO_ORIGINAL` é a coluna interna com a decisão normalizada por linha
- Usada futuramente por: Decision Lens, motor incremental, cálculo de delta, comparação contrafactual

## Roadmap futuro (não implementado)

- Restrição de corte monotônico no Pareto (Young diagram) para variáveis ordinais
- Decision Lens: comparação AS IS vs simulado usando `__DECISAO_ORIGINAL`
- Motor de simulação incremental e cálculo de delta
- Importação de biblioteca via XLSX nativo (atualmente apenas CSV)
- Novos conectores de importação: API, Google Sheets, templates corporativos

## Branch de desenvolvimento
`claude/refactor-import-wizard-uHASk`
