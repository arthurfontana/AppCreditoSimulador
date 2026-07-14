# Mapa de `src/App.jsx`

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Sessão C2 do plano
> `docs/wiki/Contexto-Claude.md`. `src/App.jsx` tem ~16200 linhas; as âncoras abaixo
> (comentários literais `// ═══ REGIÃO: <nome> ═══`, buscáveis com `grep "═══ REGIÃO"
> src/App.jsx`) demarcam as grandes regiões do arquivo para navegação rápida — não
> alteram nenhuma linha de código, só adicionam o comentário.

Este mapa é um **índice de navegação**, não documentação de domínio — para o
detalhe funcional de cada feature, use a tabela "Onde vive o quê" do
`CLAUDE.md`, que aponta para `docs/claude/*.md`/`docs/wiki/*.md` por domínio.

## Como as âncoras estão posicionadas

A maioria das âncoras é um comentário `//` comum em contexto JS (fora de JSX).
Seis âncoras (Modais de Configuração de Nó, Wizard de Importação, Cineminha —
Otimizadores, Bibliotecas — Cineminha, Modais do Copiloto, Bibliotecas —
Políticas) vivem **dentro do `return (...)` JSX** do componente `App`; para não
virar texto literal renderizado, foram colocadas na primeira posição ainda em
contexto JS de cada bloco — logo após o `(()=>{` de uma IIFE, ou logo após o
`(` de `{wizard && (` e antes do primeiro elemento JSX.

## Regiões (na ordem em que aparecem no arquivo)

| # | Âncora | Linha (Sessão C2) | Principais estados/funções/componentes | O que a região faz |
|---|--------|-------------|------------------------------------------|---------------------|
| 1 | `Constantes e Helpers Globais` | 17 | `BuildBadge`, `ComputeEngineBadge`, `ComputeCeilingNotice`, `ComputeFallbackNotice`, `ComputeJobProgress`, `SidecarTestPanel`, `PerfDebugPanel`, `SW`/`SH`, `COLORS`, `DELIMITERS`, `parseCSV`, `detectDelimiter`/`detectDecimalSep`, `suggestVarType`, `suggestMetricColumns`, `buildFlowGraph`, `validateFlow`, `exportDiagnosticCSV`, `exportAnalyticsDatasetCSV`, `computeAsIsCells`, `SimIndicators`, `newFilterCard` | Badges/telemetria do Motor Python, parsing de CSV bruto, grafo de fluxo/validação, export diagnóstico, cálculo AS IS e indicadores de simulação. **Os helpers puros do Analytics Workspace** (`pivotWidget`, `computeWidgetMetric`, `applyAnalyticsFilters`/`applyFiltersToDataset`, `describeFilterCards`, `distinctDimValues`, `autoBuckets`, `applyGroupingsToDataset`, `resolveKpiScenarios`, `buildAnalyticsCSV`) + constantes da aba Dashboard (`CHART_TYPES`, `GOOD_WHEN_LOWER`, `MAX_SERIES`, `SERIE_*`, `XDIM_CENARIO`, `GROUPING_OTHER_DEFAULT`) foram extraídos para **`src/analytics.js`** (lote C4) e importados no topo do `App.jsx`, que os re-exporta para os testes (`tests/analytics.test.js`) |
| 2 | `AnalysisTab e Widgets do Dashboard` | 2092 | `getContrastColor`, `ChartBarLabel`/`ChartLineLabel`, `SeriesStylePanel`, `FieldPanel`/`FieldWell`, `FilterCardRow`/`FilterCardsEditor`, `SegmentFindingCard`/`SegmentInfoCard`/`SegmentOpportunityCard`, `SegmentQuadrant`/`ClusterQuadrant`, `GoalSeekFrontierChart`, `ClusterCard`, `KpiCard`, `AnalyticsWidget`, `TextWidget`, `GroupingModal`, `AnalysisTab` | Todos os componentes de UI da aba Dashboard (gráficos Recharts, cartões de Segmentos/Clusters, KPI, agrupamentos) e o componente-página `AnalysisTab` que os orquestra |
| 3 | `Canvases Múltiplos (init/clone)` | 3964 | `_initCanvasStore`, `cloneCanvasWithNewIds` | Inicialização (uma vez, cacheada) do estado de múltiplas abas/canvas a partir do `sessionStorage`, e clonagem de um canvas com novos ids |
| 4 | `PolicyIR` | 4030 | `LENS_OP_LABEL` (rótulo por operador de Lens, também usado por `analytics.js`) | **Os renderizadores de Documentação Automática** (`renderDocMarkdown`/`renderDocHTML` + helpers puros `hashPolicyIR`/`fnv1a`, `describeLensRule(s)`/`describeCondition`/`describeFlowNode`/`describePath`, `mdTable`/`htmlTable`/`mdBoldToHtml`, formatação `fmtPct100`/`fmtDelta100`) foram extraídos para **`src/policyDocRender.js`** (lote C4) e importados no topo do `App.jsx`, que os re-exporta para os testes (`tests/policyDoc.test.js`) — camada de apresentação PURA sobre o docModel/PolicyIR já montado, contrato em `docs/claude/Copiloto-Documentacao.md`. **Os helpers puros do PolicyIR** (`buildPolicyIR`, `applyPolicyPatch`, `extractPolicyRequiredVars`, `applyPolicyVarMapping`, `diffPolicyIR` + `POLICY_TERMINAL_LABELS`) foram extraídos para **`src/policyIR.js`** (lote C4) e importados no topo do `App.jsx`, que os re-exporta para os testes (`tests/policyIR.test.js`, `tests/policyTemplates.test.js`, `tests/policyDoc.test.js`) — contrato em `docs/claude/Copiloto-PolicyIR.md` |
| 5 | `Estado Principal do Componente` | 4853 | `export default function App()`, todos os `useState` (shapes, conns, tool, vp, csvStore, wizard, canvases, modais efêmeros, `computeSidecar`, etc.), refs espelho (`vpR`, `shapesR`, `connsR`, ... — ver lista no `CLAUDE.md`), bootstrap do Web Worker | Declaração de todo o estado React do whiteboard e seus refs espelho (padrão anti-closure-stale), além da criação/lifecycle do Web Worker de simulação |
| 6 | `Handlers de Canvas (mouse/touch)` | 5568 | `startBwDrag`, `svgPt`/`toWorld`/`ctr`/`getSid`, `doZoom`, `onTouchStart`/`onTouchMove`/`onTouchEnd`, `onWheel`, `onCanvasDown`/`onCanvasClick`, `onShapeDown`/`onShapeClick`/`onShapeDbl`, `pushHistory`/`undo`/`redo`, `switchCanvas`/`createCanvas`/`duplicateCanvas`/`deleteCanvas`/`renameCanvas`/`toggleCanvasInDashboard`, `deleteSelected`, `autoLayout`, atalhos de teclado | Toda a interação de baixo nível com o canvas SVG: pan/zoom, drag de shapes e do widget de negócio, seleção (clique/retângulo/multi), touch mobile, undo/redo, gestão de abas de canvas e Auto Layout |
| 7 | `Persistência (Projeto / sessionStorage)` | 6965 | `buildProjectPayload`, `loadProject`, auto-persistência em `sessionStorage` | Mecânica de Salvar/Abrir Projeto (`.credito.json`) — fonte única da verdade do snapshot salvo — e o auto-save de sessão; ver checklist obrigatório no `CLAUDE.md` para todo estado novo |
| 8 | `Cineminha, Decision Lens e Handlers de Nó (helpers)` | 7746 | `toggleCinemaCell`/`setCinemaCellValue`, `createCinemaNode`/`changeCinemaType`, `createLensNode`/`openLensModal`/`applyLensRules`, `openDomainModal`/`applyDomainConfig`, `goToCopilotNode`/`applyCopilotConnectTerminal`, `assignCinemaVar`/`assignResultVar`/`clearResultVar`, `wizardPreview`/`libWizardPreview`, `edgeColorScale`/`edgeQtyScale` | Handlers de edição de Cineminha (matriz cruzada) e Decision Lens, "Configurar nó" (Domínio Exibido), navegação do Copiloto até um nó, e as escalas de cor/espessura de aresta usadas no render |
| 9 | `Render de Shapes (inclui Cineminha)` | 8110 | `renderConn`, `renderCSVNode`, `renderCinemaNode`, `renderDecisionLensNode`, `renderShape` (dispatcher por `shape.type`), `renderSimPanel`, `renderFrame` | Toda a renderização SVG dos nós do canvas — losangos de decisão, matriz de Cineminha (`renderCinemaNode`), Decision Lens, painel de simulação, frames — e das conexões adaptativas entre eles |
| 10 | `Ranking de Variáveis (Copiloto de Porta)` | 9955 | `openVariableRanking`, `applyRankingCreateDecision`, `applyRankingCreateCinema` | Copiloto Sessão 3 — sugestão on-demand do próximo nó/variável a partir de uma porta selecionada, e criação do losango/Cineminha resultante |
| 11 | `Cena e Overlay de Arraste` | 10041 | `sceneEl`, `dragOverlayEl` | Memoização da cena SVG completa (M12) excluindo viewport, e a camada leve de overlay recomputada por frame só durante o arraste de shapes |
| 12 | `JSX — Shell da Aplicação (toolbar, abas, canvas)` | 10085 | `return (...)` do `App`, abas (`activeTab`), embed de `<AnalysisTab>`, toolbar, host do `<svg>` do canvas, Business Widget | Início da árvore JSX principal: layout de alto nível (abas Canvas/Análise, toolbar, painel direito, host do canvas SVG) antes de entrar nos modais |
| 13 | `Modais de Configuração de Nó` | 11411 (dentro da IIFE de `domainModal`) | `domainModal`, `variableRankingModal`, `lensModal`, `axisModal`, `resultVarModal`, `cinemaImportModal`, `policyApplyModal`, `exportModal` | Cluster de modais de configuração pontual de um nó/porta: Domínio Exibido, resultado do Ranking, regras do Decision Lens, seleção de eixo/variável de resultado, import de Cineminha, aplicar item da Biblioteca de Políticas, e o modal de exportação do fluxo |
| 14 | `Wizard de Importação` | 12900 (dentro de `{wizard && (`) | `wizard` (estado), 3 passos do wizard, `importLoading`/`csvImportError` | Wizard de importação de CSV em 3 passos (mapeamento de colunas, tipos, AS IS) — ver `docs/claude/Wizard-Importacao.md` |
| 15 | `Cineminha — Otimizadores (single + Johnny)` | 13297 (dentro da IIFE de `optimModal`) | `optimModal`, `johnnyModal` | Otimizador single-node (`optimModal`, fronteira Pareto de uma Cineminha) e o otimizador multi-node "Johnny" — ver `docs/claude/Cineminha-Otimizadores.md` |
| 16 | `Bibliotecas — Cineminha` | 14387 (dentro da IIFE de `cinemaLibraryModal`) | `cinemaLibrary`, `cinemaLibraryModal` | Modal de biblioteca de Cineminhas (salvar/aplicar/buscar) — ver `docs/claude/Bibliotecas.md` |
| 17 | `Modais do Copiloto (Goal Seek, Simplificação, Documentação, Segmentos, Clusterização)` | 14650 (dentro da IIFE de `goalSeekModal`) | `goalSeekModal`, `simplifyModal`, `docModal`, `segmentDiscoveryModal`, `clusterModal`, `clusterVarModal` | Cluster contíguo dos modais do Copiloto: Goal Seek clássico (Sessão 4), Simplificação com Prova de Equivalência (Sessão 5), Documentação Automática (Sessão 6), Descoberta de Segmentos (Sessão 10–12), Clusterização e Variável de Cluster |
| 18 | `Bibliotecas — Políticas` | 15930 (dentro da IIFE de `policyLibraryModal`) | `policyLibrary`, `policyLibraryModal` | Modal de biblioteca de Políticas (templates de `PolicyIR`, salvar/aplicar) — ver `docs/claude/Bibliotecas.md` |

## Buscar rapidamente

```bash
grep -n "═══ REGIÃO" src/App.jsx
```

Lista as 18 âncoras acima com seus números de linha atuais (podem deslocar com
edições futuras — este mapa registra a posição no momento da Sessão C2; use o
grep acima para a posição exata a qualquer momento).
