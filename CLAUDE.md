# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## AppCreditoSimulador

## Comandos de desenvolvimento

```bash
node_modules/.bin/vite          # dev server (use este — "vite" não está no PATH global)
node_modules/.bin/vite build    # build de produção
node_modules/.bin/vite preview  # preview do build
```

> Não há testes automatizados nem linter configurado. Validação é feita via build (`vite build`).

## Stack

- React + Vite, **arquivo único**: `src/App.jsx` (~5350 linhas)
- Sem CSS externo — tudo inline styles
- Sem bibliotecas de UI — SVG puro para o canvas; matrizes interativas via `foreignObject`

## O que é

Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos ou matrizes cruzadas (Cineminha) e monta um fluxo de política de crédito. O painel de simulação exibe taxa de aprovação e indicadores de inadimplência em tempo real.

---

## Estrutura de dados (`src/App.jsx`)

### Estado principal

| Estado | Tipo | Descrição |
|--------|------|-----------|
| `shapes` | `Shape[]` | Formas no canvas — tipos: `rect`, `circle`, `diamond`, `decision`, `port`, `approved`, `rejected`, `csv`, `simPanel`, `cineminha`, `decision_lens` |
| `conns` | `{id, from, to, label?}[]` | Conexões/setas entre shapes |
| `csvStore` | `{[csvId]: CsvEntry}` | Datasets carregados |
| `vp` | `{x, y, s}` | Viewport (posição + zoom) |
| `wizard` | `null \| WizardObj` | Modal de importação em 3 passos |
| `axisModal` | `null \| {shapeId, col, csvId}` | Modal de eixo do Cineminha |
| `optimModal` | `null \| OptimObj` | Modal de otimização Pareto |
| `cinemaImportModal` | `null \| {shapeId, config, step, rowMapping, colMapping, availableVars}` | Modal de importação de config de Cineminha |
| `cinemaLibrary` | `LibraryItem[]` | Catálogo de Cineminhas salvos (em memória) |
| `cinemaLibraryModal` | `null \| {mode, shapeId, search, filterType, saveMeta, overwriteId}` | Modal da biblioteca (modo `'browse'` ou `'save'`) |
| `lensModal` | `null \| {shapeId, rules, population}` | Modal do Decision Lens |
| `cinemaTypeModal` | `null \| {wx, wy}` | Seletor de tipo ao criar Cineminha |

### Padrão de refs

Todo estado tem um ref espelho (`vpR`, `shapesR`, `axisModalR`, `cinemaLibraryR`, etc.) para uso em event listeners sem closure stale. Padrão: `const fooR = useRef(foo); useEffect(()=>{fooR.current=foo},[foo])`.

### Tipos de coluna (`COL_TYPES`)

| value | label | uso |
|-------|-------|-----|
| `id` | ID | Identificador do registro |
| `decision` | Filtro | Variável arrastável ao canvas |
| `qty` | Vol. Propostas | Volume total de propostas |
| `qtdAltas` | Qtd Altas/Vendas | Volume convertido em ativações |
| `inadReal` | Inad. Real | Inadimplência histórica observada |
| `inadInferida` | Inad. Inferida | Inadimplência estimada para aprovados |

### Shape: `cineminha`

```js
{
  id, type: "cineminha", x, y, w, h,
  label: "Cineminha",
  cinemaType: "eligibility" | "offer",  // define ports e cores
  rowVar: null | { col, csvId },
  colVar: null | { col, csvId },
  rowDomain: string[],   // valores distintos ordenados do eixo linha
  colDomain: string[],   // valores distintos ordenados do eixo coluna
  cells: { [`${rowVal}|${colVal}`]: number }, // 0 = não elegível, ≥1 = elegível / valor de oferta
  metadata: {
    type: string,                // espelha cinemaType
    identifiers: {},             // chave-valor livre (cluster, política, segmento…)
    dimensions: { rowVariable, columnVariable },
    variables: {},               // reservado
    source: "manual" | "library_import" | "template" | "duplicate",
    description: string,
    tags: string[],
    version: number,             // incrementado a cada substituição na biblioteca
  },
}
```

- Criado sempre com dois ports filhos conectados (labels e cores definidos por `CINEMINHA_TYPES`)
- Chave de célula 1D-linha: `"${rowVal}|*"` / 1D-coluna: `"*|${colVal}"`
- `isCellEligible(cells, key)` — helper que lê o valor numérico e retorna `>0`

### Tipos de Cineminha (`CINEMINHA_TYPES`)

```js
{
  eligibility: { label:"Elegibilidade", icon:"🎯", ports:[{label:"Elegível"},{label:"Não Elegível"}] },
  offer:       { label:"Oferta",        icon:"💼", ports:[{label:"Com Oferta"},{label:"Sem Oferta"}] },
}
```

`getCinemaType(cinemaType)` — retorna a config, com fallback para `eligibility`.

### `csvStore`: estrutura por dataset

```js
{
  name,          // nome do arquivo
  headers,       // string[] — inclui '__DECISAO_ORIGINAL' se asIsConfig configurado
  rows,          // string[][] — última coluna é '__DECISAO_ORIGINAL' se configurado
  columnTypes,   // {[colName]: COL_TYPE}
  varTypes,      // {[colName]: 'categorical'|'ordinal'}
  asIsConfig,    // null | { col, mapping: {[value]: 'APROVADO'|'REPROVADO'|'IGNORAR'} }
}
```

### `cinemaLibrary`: estrutura de item

```js
{
  id, savedAt,   // uid() e ISO timestamp
  name,          // label do modelo na biblioteca
  cinemaType,    // "eligibility" | "offer"
  rowVar,        // null | { col }  — sem csvId (independente de dataset)
  colVar,        // null | { col }
  rowDomain, colDomain, cells,  // snapshot do estado ao salvar
  metadata,      // mesmo objeto do shape
}
```

---

## Funções-chave

### Canvas / shapes

- `createDecisionNode(col, csvId, wx, wy)` — losango + ports automáticos (até 10 valores distintos)
- `createCinemaNode(wx, wy, cinemaType)` — Cineminha vazio + ports + `metadata` inicial; abre `cinemaTypeModal` se o tipo não for passado
- `changeCinemaType(shapeId, newType)` — troca tipo e renomeia ports + conns
- `assignCinemaVar(shapeId, col, csvId, axis)` — atribui variável ao eixo `'row'` ou `'col'`, recomputa domínio e reconstrói `cells`
- `toggleCinemaCell(shapeId, cellKey)` — alterna elegibilidade (0↔1)
- `setCinemaCellValue(shapeId, cellKey, value)` — define valor numérico (modo Oferta)
- `deleteShape(id)` — delete + cascade de ports filhos de `decision` e `cineminha`
- `startPanelDrag(e, col, csvId)` — drag de variável do painel para o canvas

### Exportação / importação

- `exportFlow()` / `doExport(includeData)` — serializa shapes + conns + csvStore; schema versionado
- `validateAndImportFlow()` — valida integridade e importa fluxo completo
- `exportCinema(shapeId)` — exporta config individual com `metadata`
- `startCinemaImport(shapeId)` / `applyCinemaImport()` — importa config com mapeamento de variáveis

### Biblioteca de Cineminhas

- `openCinemaLibrary(shapeId, mode)` — abre `cinemaLibraryModal` em modo `'browse'` ou `'save'`
- `saveToLibrary()` — persiste snapshot do Cineminha em `cinemaLibrary`, atualiza `metadata` no shape
- `loadFromLibrary(item)` — cria novo nó no canvas a partir de item da biblioteca (source: `'library_import'`)
- `deleteFromLibrary(itemId)` — remove item de `cinemaLibrary`

### Otimização

- `openOptimModal(shapeId)` — computa `cellMetrics` + fronteira Pareto + cenários; abre `optimModal`
- `applyOptimResult(shapeId, proposedCells)` — escreve `proposedCells` no Cineminha e fecha o modal

### Renderização

- `renderConn(conn)` — seta com label no ponto médio da bezier
- `renderCSVNode(shape)` — tabela interativa minimizável no canvas
- `renderCinemaNode(shape)` — matriz via `foreignObject`; estado vazio / 1D / 2D
- `renderSimPanel(shape)` — painel SVG com indicadores de simulação

### Componentes globais (fora do componente principal)

- `BuildBadge` — badge de versão/build no header do painel direito

### Helpers globais (fora do componente)

- `sortDomain(values)` — numérico crescente ou A-Z (locale pt-BR)
- `computeCinemaSize(rowDomain, colDomain)` — `{w, h}` com caps 540×420
- `fmtQty(n)` — inteiro, `k` ou `M`
- `fmtPct(v)` — `"XX.XX%"` ou `"N/A"`
- `computeCellMetrics(shape, csvStore)` — agrega métricas do CSV por célula
- `buildParetoFrontier(cellMetrics)` — fronteira greedy ordenada por `inadInferida`
- `extractScenarios(frontier)` — extrai conservador / médio (joelho) / máximo
- `isCellEligible(cells, key)` — `cells[key] > 0`
- `getCellValue(cells, key)` — lê valor numérico de célula (default 1)

---

## Fluxo do simulador

1. Importar CSV → Passo 1 (delimitador) → Passo 2 (classificar colunas) → Passo 3 (variável AS IS)
2. Colunas **Filtro** aparecem como chips arrastáveis no painel direito
3. Arrastar chip para área vazia → losango com ports automáticos
4. Arrastar chip sobre ⊞ Cineminha → `axisModal` ("Linha ou Coluna?") → matriz cruzada
5. Conectar ports a ✅ Aprovado / ❌ Reprovado
6. Duplo-clique em seta → editar label
7. Painel de simulação atualiza indicadores em tempo real

### Engine de simulação

- `validateFlow` — valida que todos os caminhos terminam em `approved`/`rejected`
- `runSimulation` / `traverseRow` — para `cineminha`, lookup em `cells[${rowVal}|${colVal}]` e roteamento
- `inadReal = ∑ inadReal / ∑ qtdAltas` (null se qtdAltasSum = 0)
- `inadInferida = ∑ inadInferida / approvedQty` (null se approvedQty = 0)
- Reconciliação de dataset (`onImportConfirm`): match normalizado de variáveis, recomputa domínios, preserva elegibilidade

---

## Toolbar contextual do Cineminha

Aparece quando um único `cineminha` está selecionado (`selShape?.type==='cineminha' && multiSel.size<=1`):

| Botão | Ação |
|-------|------|
| 🎯 Elegibilidade / 💼 Oferta | `changeCinemaType` |
| ⚙ Otimizar Decisão | `openOptimModal` |
| ⬇ Exportar | `exportCinema` |
| ⬆ Importar | `startCinemaImport` |
| 📚 Biblioteca | `openCinemaLibrary(sel, 'browse')` |
| 💾 Salvar | `openCinemaLibrary(sel, 'save')` |

---

## Biblioteca de Cineminhas — modal

**Modo browse** (`mode: 'browse'`):
- Busca full-text em nome, descrição, tags e valores de `identifiers`
- Filtro por tipo (Elegibilidade / Oferta)
- "Salvar atual" aparece quando `shapeId` está definido (abrindo de um Cineminha)
- "+ Adicionar ao Board" chama `loadFromLibrary` — cria novo nó no centro aproximado do viewport

**Modo save** (`mode: 'save'`):
- Campos: Nome (obrigatório), Descrição, Tags (vírgula), Identificadores (JSON livre)
- Seletor de sobrescrita: ao escolher item existente, incrementa `metadata.version`
- `saveToLibrary()` atualiza também o `metadata` do shape original no canvas

---

## Motor de Recomendação — `optimModal`

### Estado

```js
{
  shapeId, cellMetrics, frontier, scenarios,
  activeCard: 'conservador' | 'medio' | 'maximo' | 'personalizado',
  proposedCells,         // estado em edição — não aplicado ao canvas até "Aplicar"
  sliderApprovalIdx,     // índice na fronteira (não ratio direto)
  sliderInadReal, sliderInadInf,
  maxInadReal, maxInadInf,
  matrixZoom, matrixPanX, matrixPanY,
}
```

### Algoritmo Pareto

1. `computeCellMetrics` — agrega por célula: `qty`, `qtdAltas`, `inadRRaw`, `inadIRaw`
2. `buildParetoFrontier` — sort por `inadInferida` crescente; varre acumulando — fronteira greedy ótima para categóricas
3. `extractScenarios` — conservador = mínima inad; máximo = máxima aprovação; médio = joelho (máxima distância perpendicular)

### Sliders interligados

- **Aprovação** (driver): `|approvalRate - target|` mínimo na fronteira
- **Inad. Real / Inferida** (restrições): maior `approvalRate` onde `inad ≤ valor`

---

## Wizard de importação (3 passos)

| Passo | Largura | Função |
|-------|---------|--------|
| 1 — Delimitador | 600px | Detecção automática + preview 5 linhas |
| 2 — Classificar colunas | 900px | Grid `"1fr repeat(6, 60px) 100px"`, header sticky, scroll interno 340px |
| 3 — AS IS | 680px | Mapeamento de decisão histórica → `__DECISAO_ORIGINAL` |

---

## Constantes do Cineminha

```js
CINEMA_CELL_W = 70 · CINEMA_CELL_H = 30 · CINEMA_TITLE_H = 38
CINEMA_HDR_H  = 32 · CINEMA_LBL_W  = 84 · CINEMA_PAD = 12
CINEMA_MAX_W  = 540 · CINEMA_MAX_H = 420
```

---

## Indicador de Build (`BuildBadge`)

Vite injeta em build: `__BUILD_NUMBER__`, `__BUILD_TIME__`, `__BUILD_HASH__`, `__BUILD_BRANCH__`, `__BUILD_AUTHOR__`. Em dev, todos os fallbacks são `"dev"` / `new Date()`. Badge fica verde se build < 5 min.

---

## Variável AS IS — conceito

- `asIsConfig.col` + `asIsConfig.mapping` definem a decisão histórica baseline
- `__DECISAO_ORIGINAL` é derivada em `onImportConfirm` como última coluna de `headers`/`rows`
- Base para: Decision Lens, simulação incremental, delta, comparação contrafactual

---

## Roadmap futuro (não implementado)

- Flag `ordinal` + restrição de corte monotônico no Pareto (Young diagram) para variáveis como R1–R20
- Sliders de margem e rentabilidade no `optimModal`
- Fronteira Pareto multi-dimensional
- Decision Lens: comparação AS IS vs simulado com `__DECISAO_ORIGINAL`
- Motor de simulação incremental (subconjunto da base histórica)
- Persistência da `cinemaLibrary` (localStorage ou backend)
- Versionamento, compartilhamento e templates globais de biblioteca

## Branch de desenvolvimento

`claude/metadata-context-menu-U7eSs`
