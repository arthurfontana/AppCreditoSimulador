# Web Worker — Protocolo de Mensagens

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia esta página ANTES de
> adicionar/alterar qualquer mensagem `COMPUTE_*`/`*_RESULT` em
> `src/simulation.worker.js`, e antes de mexer no cache do tick (`getTickResult`)
> ou no motor compilado (M8). Regra de ouro (Execução Híbrida, DEC-HX-007): o tick
> de edição e qualquer resposta síncrona a gesto **jamais** roteiam pro sidecar —
> ver `docs/wiki/Arquitetura-Execucao-Hibrida.md` para a tabela completa de
> classes de tarefa (Classe A vs. Classe B).

O arquivo `src/simulation.worker.js` recebe mensagens via `postMessage` e responde de forma assíncrona.

### Mensagens de entrada
| type | payload | O que faz |
|------|---------|-----------|
| `UPDATE_CSV_STORE` | `{csvStore}` | Atualiza o cache do csvStore no worker (evita re-serialização a cada tick) |
| `RUN_SIMULATION` | `{shapes, conns}` | Lê (ou computa) o tick via `getTickResult` (M6, ver abaixo) e responde com `SIMULATION_RESULT` |
| `COMPUTE_OVERLAY` | `{shapes, conns}` | Lê (ou computa) o mesmo tick via `getTickResult` (M6) e responde com `OVERLAY_RESULT` |
| `COMPUTE_ASIS_PREVIEW` | `{shapes, conns, targetIds, reqTokens}` | Prévia AS IS **contextualizada ao nó** (respeita filtros a montante). Roda `computeCinemaAsIsCells` sobre os cineminhas em `targetIds`; responde com `ASIS_PREVIEW_RESULT`. Disparada por `assignCinemaVar` — ver Prévia AS IS em `docs/claude/Estrutura-Dados.md` |
| `COMPUTE_OPTIM` | `{shape}` | Roda `computeCellMetrics` + `buildParetoFrontier` + `extractScenarios`; responde com `OPTIM_RESULT` |
| `COMPUTE_JOHNNY` | `{shapes, cinemaIds, conns, riskLevels?, hierarchyMode?, inadMetric?}` | Roda `computeCinemaArrivals` + `computeJohnnyData` com greedy+precedência; responde com `JOHNNY_RESULT` |
| `COMPUTE_ANALYTICS_DATASET` | `{canvases}` | `canvases: [{id, nome, shapes, conns}]` — abas marcadas (cenários, 5B). Populações de lens derivadas no worker (M10). Roda `computeAnalyticsDataset`; responde com `ANALYTICS_RESULT` |
| `COMPUTE_GOAL_SEEK` | `{shapes, conns, goal, constraints, locks}` | Copiloto Sessão 4 — roda `computeGoalSeek` (catálogo de movimentos + busca gulosa com precedência/shrinkage/restrições + validação por re-simulação); responde com `GOAL_SEEK_RESULT` |
| `COMPUTE_GOAL_SEEK_CONTEXT` | `{shapes, conns}` | **GS1 (DEC-GS-002)** — "Ponto de partida": roda `computeGoalSeekContext` (baseline escopado a `decidedQty` + AS IS no mesmo escopo); responde com `GOAL_SEEK_CONTEXT_RESULT`. Disparado ao abrir o `goalSeekModal`, antes do formulário |
| `COMPUTE_GOAL_SEEK_CATALOG` | `{shapes, conns, locks?, maxLensSteps?}` | **GS4 (DEC-GS-005/008)** — gera o catálogo agregado via `buildGoalSeekCatalog` (escadas de lens com até `maxLensSteps=12` passos via `selectDeepestLensSteps`; dataset **nunca** sobe para o sidecar); responde com `GOAL_SEEK_CATALOG_RESULT`. Classe A — sempre no worker |
| `COMPUTE_GOAL_SEEK_VALIDATE` | `{shapes, conns, goal, constraints, locks?, moveIds?, frontierIds?, maxLensSteps?}` | **GS4/GS6 (DEC-GS-007)** — recebe a solução do sidecar Python, materializa os movimentos (`selectDeepestLensSteps` + `applyGoalSeekMoves`), verifica invariantes e re-simula (`runSimulation`; pool H3 para extremos da fronteira); responde com `GOAL_SEEK_RESULT` (reutiliza o tipo existente). Classe A — sempre no worker |
| `COMPUTE_SIMPLIFY` | `{shapes, conns}` | Copiloto Sessão 5 — roda `computeSimplify` (detecção de candidatos + aceitação incremental validada por `computeSimplifyEquivalence` + prova de equivalência linha a linha); responde com `SIMPLIFY_RESULT` |
| `COMPUTE_POLICY_DOC` | `{shapes, conns, ir, canvases, options}` | Copiloto Sessão 6 — `ir` chega PRONTO (`buildPolicyIR` só existe em `App.jsx`); `canvases: [{id, nome, shapes, conns}]` para a comparação de cenários (mesmo formato de `COMPUTE_ANALYTICS_DATASET`); `options: {includeDomains, activeCanvasId?, activeCanvasName?, compare?:{shapes,conns}}`. Roda `computePolicyDoc`; responde com `POLICY_DOC_RESULT` |
| `COMPUTE_SEGMENT_DISCOVERY` | `{shapes, conns, scope, params}` | Copiloto Sessão 10/12 — descoberta de segmentos. `scope`: `null` (base inteira) ou `{nodeId}` (população que chega ao nó). `params: {riskMetric:'inadReal'\|'inadInferida', minQty?, maxDepth?, beamWidth?, alpha?, maxFindings?, excludedCols?}`. `excludedCols` = seletor de variáveis do modal (nomes de coluna Filtro fora da busca; heurística `segVarDefaultReason` em `App.jsx` pré-desmarca colunas temporais/vintage e de score). Roda `computeSegmentDiscovery` (achados + recomendações validadas + asis_divergence/anomaly + estabilidade); responde com `SEGMENT_DISCOVERY_RESULT` |
| `COMPUTE_SEGMENT_COMBINED` | `{shapes, conns, applies}` | Copiloto Sessão 12 — aplicação combinada de N recomendações. `applies: [{moves}]`. Aplica os patches EM SEQUÊNCIA sobre UM clone e valida por UMA re-simulação real (`computeSegmentCombined`) — nunca a soma dos deltas; responde com `SEGMENT_COMBINED_RESULT` |
| `POOL_JOB` | `{jobId, shapes, conns, moves}` | **Execução Híbrida H3** — shard do pool de workers aninhados. Chega SÓ nos pool-workers (o worker principal não posta a si mesmo): roda `segValidateMoves` (aplica moves + `runSimulation` + snapshot) sobre o `workerCsvStore` já semeado e responde com `POOL_JOB_RESULT`. Ver `docs/claude/Execucao-Hibrida-Pool.md` |
| `segment_discovery` | `{shapes, conns, scope, params}` | **Execução Híbrida H7** — alias de FALLBACK da Descoberta profunda (Classe B): mesmo payload de `COMPUTE_SEGMENT_DISCOVERY`, mas com os params CLAMPADOS aos tetos browser (`clampSegmentParamsForBrowser`: maxDepth ≤ 2, beamWidth ≤ 8). É o que o ComputeRouter posta quando o job do sidecar cai/está indisponível (paridade total, P4); responde com o MESMO `SEGMENT_DISCOVERY_RESULT` |
| `COMPUTE_SEGMENT_RECS` | `{shapes, conns, scope, params, segmentModel}` | **Execução Híbrida H7** — anexa recomendações (patch + delta re-simulado REAL, DEC-SD-003) ao `segmentModel` que o sidecar devolveu SEM elas: reconstrói o ctx barato (`discoverSegments` com maxDepth 1 — bins de nível 1/walk não dependem da profundidade) e roda `segPlanRecommendations`/validação (pool H3) sobre os findings recebidos. O motor de simulação segue single-sourced no worker (a dupla implementação dele é a H9); responde com `SEGMENT_RECS_RESULT` |
| `COMPUTE_CLUSTER_SEGMENTS` | `{params}` | **Execução Híbrida H8** — Clusterização de Segmentos (baseline browser, Classe B dentro dos tetos). `params: {csvId?, dims, k?, features?, seed?, maxPoints?}`. O handler CLAMPA aos tetos declarados (`clampClusterParamsForBrowser`: dims ≤ 3, k ≤ 8, maxPoints 2000, sem extras) e roda `computeClusterSegments`; responde com `CLUSTER_SEGMENTS_RESULT` |
| `cluster_segments` | `{params}` | **Execução Híbrida H8** — alias de FALLBACK da Clusterização (Classe B): mesma task do sidecar, params CLAMPADOS aos tetos browser. É o que o ComputeRouter posta quando o job do sidecar cai/está indisponível (paridade total, P4); responde com o MESMO `CLUSTER_SEGMENTS_RESULT` |

### Mensagens de saída
| type | payload |
|------|---------|
| `SIMULATION_RESULT` | `{result: SimulationResult}` |
| `OVERLAY_RESULT` | `{incrementalResult, nodeArrivals, lensCounts}` — `nodeArrivals: {[nodeId]: {val\|row\|col: {[valor]: qty}}}` (ver `docs/claude/Dominio-Exibido.md`); `lensCounts: {[lensId]: {count, total}}` (M10). **Não** envia mais o `overlay` por-linha (Otimização de Memória Fase 4) nem as populações de lens por-linha |
| `ASIS_PREVIEW_RESULT` | `{cellsByShape, reqTokens}` — `cellsByShape: {[shapeId]: {[cellKey]: 0\|1} \| null}` (null = dataset sem AS IS); `reqTokens` ecoado para a main descartar respostas obsoletas (ver Prévia AS IS) |
| `OPTIM_RESULT` | `{shapeId, cellMetrics, frontier, scenarios, maxInadReal, maxInadInf}` |
| `JOHNNY_RESULT` | `{pooledMetrics, frontier, scenarios, mixCats, shapeMetas, baselineApprovalRate, maxInadReal, maxInadInf}` ou `{error: 'no_data'}` |
| `ANALYTICS_RESULT` | `{dataset: AnalyticsDataset \| null}` — formato largo **colunar** (DEC-AW-003 + Otimização de Memória Fase 4): `{rowCount, columns:{[nome]:ColDef}, dimensions, temporalColumns, metrics, scenarios}`. `ColDef` = `{kind:'dict', dict, codes:Int32Array}` \| `{kind:'num', data:Float64Array}`. Os `ArrayBuffer`s das colunas são **transferidos** (zero-cópia) no `postMessage` |
| `GOAL_SEEK_RESULT` | `{goal, baseline, frontier, moves, goalReached, bindingConstraint, result}` — ver `docs/claude/Copiloto-GoalSeek.md`. Também emitido por `COMPUTE_GOAL_SEEK_VALIDATE` (GS4/GS6); quando vindo do caminho profundo, carrega `curves` (família de curvas por teto de inad.inf) e `via:'sidecar'` |
| `GOAL_SEEK_CONTEXT_RESULT` | `{baseline, asis}` — baseline escopado a `decidedQty` + AS IS no mesmo escopo (`null` sem `__DECISAO_ORIGINAL`); alimenta os 3 cards "📍 Ponto de partida" (GS1, DEC-GS-002). Só exibido no `step:'form'` do `goalSeekModal` |
| `GOAL_SEEK_CATALOG_RESULT` | `{baselineRaw, candidates, token}` — catálogo de movimentos com agregados O(1) prontos para o solver Python (`goal_seek_deep`), baseline bruto e token de staleness para `COMPUTE_GOAL_SEEK_VALIDATE` (DEC-GS-005/007) |
| `SIMPLIFY_RESULT` | `{proposal, equivalence}` — ver `docs/claude/Copiloto-Simplificacao.md` |
| `POLICY_DOC_RESULT` | `{docModel}` — ver `docs/claude/Copiloto-Documentacao.md` |
| `SEGMENT_DISCOVERY_RESULT` | `{segmentModel}` — ver `docs/claude/Copiloto-Segmentos.md` |
| `SEGMENT_COMBINED_RESULT` | `{combined}` — `{baseline, combined, combinedApprovalDelta, combinedMovedQty, sumApprovalDelta, sumMovedQty, individual, interaction:{interacts, overlapQty, note}}` (Sessão 12) |
| `POOL_JOB_RESULT` | `{jobId, snapshot}` \| `{jobId, error}` — resposta do pool-worker a um `POOL_JOB` (H3). `snapshot` = resultado de `segValidateMoves`; `error` (candidato que estourou) vira delta null / recomputo inline no orquestrador |
| `SEGMENT_RECS_RESULT` | `{segmentModel}` — o modelo recebido em `COMPUTE_SEGMENT_RECS` com `recommendation` preenchida nos achados acionáveis (H7); em falha de anexo, o modelo volta como veio (cards sem delta validado, nunca erro silencioso) |
| `CLUSTER_SEGMENTS_RESULT` | `{clusterModel}` — ver `docs/wiki/Arquitetura-Execucao-Hibrida.md` (§7.3, §16) e `docs/claude/Copiloto-Clusterizacao.md` |

### Funções no worker
- `computeSimulationTick(shapes, conns, csvStore, lensPopulations)` (M6 — passe único do tick de edição): funde, numa única iteração por csv×linha, o que antes eram 4 varreduras completas e independentes da base (`runSimulation` + `computeSimulatedDecisions` + `computeIncrementalResult` + `computeNodeArrivals`). Índices de coluna e mapas de aresta por nó são resolvidos uma vez por nó/csv (não por linha); o "visited" do walk é um array de época reutilizado (sem `new Set()` por linha); o buffer do caminho (edgeStats) é reaproveitado entre linhas. Preserva a diferença sutil entre as raízes usadas pela simulação/overlay (só a 1ª raiz por csv) e pelas chegadas por nó (todas as raízes, critério mais estrito — exclui nós logo abaixo de um Decision Lens). Retorna `{simResult, incrementalResult, nodeArrivals}`. Chamada por `getTickResult` (cache single-slot chaveado por `csvStoreVersion + shapes + conns`, mesmo padrão do `cachedCanvasOverlay`): a primeira das mensagens `RUN_SIMULATION`/`COMPUTE_OVERLAY` de um mesmo tick computa o passe único; a segunda só lê do cache. Equivalência numérica exaustiva com o caminho antigo em `tests/simulationTick.test.js`
- `runSimulation(shapes, conns, csvStore)`: percorre todas as linhas de todos os CSVs pelo grafo, acumula métricas e retorna `SimulationResult`. Continua existindo/exportada sem alteração (usada pelos GATEs numéricos e por quem precisar do resultado isolado) — o tick de edição passa a usar `computeSimulationTick`, não esta função diretamente
- `computeSimulatedDecisions(shapes, conns, csvStore, lensPopulations)`: compara decisão simulada vs. `__DECISAO_ORIGINAL` por linha. Usada pelo `cachedCanvasOverlay` do Dashboard (overlay por canvas, independente do tick de edição). Desde o M8 roteia por **códigos do dicionário** em base colunar (fallback por string no legado) — ver seção M8
- `computeIncrementalResult(overlay, csvStore)`: agrega `baseline`, `simulated` e `impacted` a partir do overlay. Continua existindo/exportada sem alteração
- `computeCellMetrics(shape, csvStore)`: agrega métricas por célula do Cineminha
- `buildParetoFrontier(cellMetrics)`: fronteira Pareto greedy (sort por `inadInferida` crescente)
- `extractScenarios(frontier)`: `{conservador, balanceado, melhorEficiencia, expansao}` — `melhorEficiencia` é o joelho da curva
- `computeCinemaArrivals(shapes, conns, csvStore, lensPopulations)`: percorre o grafo de fluxo linha a linha e retorna `{[shapeId]: {[cellKey]: {qty, qtdAltas, qtdAltasInfer, inadRRaw, inadIRaw, mix}}}` — métricas filtradas pelas linhas que efetivamente chegam a cada Cineminha via roteamento (respeita losangos, decision_lens e ports a montante). Desde o M8 roteia por códigos (chave de célula via `keyByPair`, sem concat por linha) e só lê as métricas da linha quando ela chega a algum Cineminha
- `computeCinemaAsIsCells(shapes, conns, csvStore, targetIds)`: prévia AS IS **contextualizada ao nó** — percorre o grafo de fluxo (mesmo walk compilado de `computeCinemaArrivals`) e agrega o volume APROVADO/REPROVADO (`__DECISAO_ORIGINAL`) por casela **só sobre a população que chega** a cada cineminha de `targetIds` (respeita losangos, Decision Lens e ports a montante). Deriva as caselas com a **mesma regra** de `computeAsIsCells` (elegível=1, 0 só quando 100% do volume decidido é REPROVADO; sem volume → 1). Retorna `{[shapeId]: {[cellKey]: 0\|1} \| null}` (null = dataset do alvo sem AS IS). Alimenta `COMPUTE_ASIS_PREVIEW`. GATE `tests/asIsPreview.test.js` (paridade com `computeAsIsCells` quando raiz; contraste com filtro a montante; legado × colunar)
- `computeNodeArrivals(shapes, conns, csvStore, lensPopulations)`: percorre o fluxo a partir das entradas reais (in-degree 0 sobre arestas de fluxo — exclui corretamente um cineminha logo abaixo de um Decision Lens) e retorna, por nó, a contagem de registros por valor de domínio: `decision → {val: {[valor]: qty}}`, `cineminha → {row, col}`. Base do "Configurar nó" — ver `docs/claude/Dominio-Exibido.md`. Continua existindo/exportada sem alteração — usada pelos testes; o tick de edição usa a mesma lógica de raízes fundida dentro de `computeSimulationTick`
- `computeJohnnyData(allShapes, cinemaIds, conns, csvStore, lensPopulations, riskLevels, hierarchyMode, inadMetric)`: greedy com restrição de precedência (DEC-JO-003/004) — constrói grafo de precedência com (a) monotonicidade interna por eixo ordinal e (b) aninhamento de cascata entre níveis de risco; a cada passo abre a célula liberada de menor inadimplência suavizada (shrinkage bayesiano); modo `independente` aplica só monotonicidade interna
- `computeAnalyticsDataset(canvasInputs, csvStore)`: recebe N abas marcadas (`[{id, nome, shapes, conns}]`; populações de lens derivadas no worker — M10), roda `computeSimulatedDecisions` por canvas (overlay memoizado via `cachedCanvasOverlay`), faz **join por `(csvId, rowIdx)`** e emite o dataset analítico **largo colunar** (Fase 4): dict encoding por dimensão + `__DECISAO_AS_IS` global + uma coluna dict `__DECISAO_<canvasId>` por cenário + `Float64Array` por métrica intrínseca. Os `ArrayBuffer`s são transferidos (zero-cópia) no `ANALYTICS_RESULT`; `scenarios` = AS IS + uma entrada por aba (nome = nome da aba) — ver `docs/claude/Analytics-Workspace.md`
- `cachedCanvasOverlay(canvasId, shapes, conns, csvStore)`: overlay por canvas memoizado por hash de `shapes`/`conns` + `csvStoreVersion` (não reprocessa canvases intocados ao editar um só); deriva as populações de lens localmente no cache miss (M10)
- `computeGoalSeek(shapes, conns, csvStore, goal, constraints, locks, lensPopulations)`: busca gulosa com precedência sobre o catálogo de movimentos (Copiloto Sessão 4) — ver `docs/claude/Copiloto-GoalSeek.md`
- `buildGoalSeekCandidates(shapes, conns, csvStore, lensPopulations, lockedIds)`: catálogo de candidatos a movimento (`cinema_cell`, `decision_terminal`, `lens_threshold`) com precedência entre eles
- `computeGoalSeekArrivals(shapes, conns, csvStore, lensPopulations, lensColByShape)`: walk compilado (M8) que agrega métricas por segmento `(nó de decisão, valor)` e, para lens elegíveis a `lens_threshold`, por valor bruto da coluna da regra
- `computeGoalSeekBaseline(shapes, conns, csvStore)`: agregador paralelo a `runSimulation` que também expõe os somatórios brutos (`qtdAltasSum`, `inadRealSum`, etc.) — necessários para os deltas O(1) da busca
- `computeGoalSeekContext(shapes, conns, csvStore)`: **GS1 (DEC-GS-002)** — computa o baseline escopado a `decidedQty` + AS IS no mesmo escopo para os 3 cards "Ponto de partida" do formulário; reutiliza `computeGoalSeekBaseline` internamente
- `buildGoalSeekCatalog(shapes, conns, csvStore, lensPopulations, lockedIds, maxLensSteps=GOAL_SEEK_DEEP_LENS_STEPS)`: **GS4 (DEC-GS-005/008)** — versão ampliada de `buildGoalSeekCandidates` que adiciona as **escadas de lens** (passos acumulados sobre um mesmo Decision Lens de regra `gte`/`gt`/`lte`/`lt`, via `selectDeepestLensSteps`); devolve `{baselineRaw, candidates, token}` para o `GOAL_SEEK_CATALOG_RESULT`
- `selectDeepestLensSteps(cands)`: **GS4 (DEC-GS-008)** — filtra o catálogo de candidatos `lens_threshold`, mantendo para cada lens SÓ os `maxLensSteps` passos mais extremos (maior impacto de qtd, mesma direção); elimina candidatos intermediários que o solver nunca escolheria
- `computeGoalSeekValidate(shapes, conns, csvStore, lensPopulations, req, pool=null)`: **async, GS4/GS6 (DEC-GS-007)** — recebe a proposta de movimentos do sidecar Python, verifica invariantes (DEC-GS-001: `moves` estão no catálogo, precedência respeitada, tetos não violados), materializa via `applyGoalSeekMoves` e valida por `runSimulation` real (pool H3 para os extremos da fronteira `frontierIds`); único lugar onde o GATE de paridade de contrato é checado. Responde com `GOAL_SEEK_RESULT`
- `wilsonCI(k, n, z=1.96)`: **GS3 (DEC-GS-003)** — intervalo de confiança de Wilson para proporção (`k` sucessos em `n` observações, `z=1.96` → IC 95%); retorna `{lower, upper}` ou `null` para `n=0`; usado por `stats.ci95` em cada movimento do catálogo
- `computeSimplify(shapes, conns, csvStore, nodeArrivals)`: ponto de entrada da Simplificação (Copiloto Sessão 5) — detecta candidatos, aceita-os incrementalmente (só os que preservam `diff=0`) e devolve `{proposal, equivalence}` — ver `docs/claude/Copiloto-Simplificacao.md`
- `detectSimplifyCandidates(shapes, conns, nodeArrivals, lensStats)`: catálogo de candidatos (`collapsible_node`, `zero_arrival_node`, `redundant_variable`; `lens_no_effect` reusa o `apply` de `collapsible_node`) — cada um com um patch `apply` materializável por `applySimplifyCandidates` (`src/policySimplify.js`)
- `computeLensStats(shapes, conns, csvStore)`: walk dedicado (padrão `computeNodeArrivals`, generalizado a Decision Lens) — `{[lensId]: {arrived, passed}}`, base dos candidatos `zero_arrival_node`/`lens_no_effect` sobre lens (`nodeArrivals` não cobre lens)
- `computeSimplifyEquivalence(origShapes, origConns, propShapes, propConns, csvStore)`: prova de equivalência — compara o desfecho **por linha** (`computeRowOutcomes`, mesma classificação de `runSimulation`) de duas políticas; `identical` só é `true` com `diffCount===0`; quando não, o `delta` vem de `runSimulation` antes/depois de verdade (nunca estimado)
- `computePolicyDoc(shapes, conns, csvStore, ir, canvasInputs, options)`: ponto de entrada da Documentação Automática (Copiloto Sessão 6) — monta o `docModel` inteiro numa única passada; ver `docs/claude/Copiloto-Documentacao.md`
- `computeSegmentDiscovery(shapes, conns, csvStore, scope, params)`: ponto de entrada da Descoberta de Segmentos (Copiloto Sessão 10) — orquestra `discoverSegments` → `explainSegment` → `prioritizeFindings` e devolve o `SegmentModel`; ver `docs/claude/Copiloto-Segmentos.md`
- `discoverSegments(shapes, conns, csvStore, scope, metricSpec, params)`: estágio 1 (beam search 1D→2D sobre os dicionários das colunas Filtro, escopo global ou por nó via walk compilado M8) — devolve os candidatos crus + o `ctx` compartilhado (agregados do escopo, dispersão por linha, bins, coders). `metricSpec` resolvido por `resolveRiskMetric` (DEC-SD-006 — nenhuma função interna assume inad)
- `explainSegment(candidate, ctx)`: estágio 2 — decomposição WoE por condição (reusa `computeIV`/bins da Sessão 3), lift vs. complemento, teste binomial (`segBinomTwoSided`) e `dispersion` (nós/terminais onde a política decide o segmento hoje), tudo do mesmo walk do escopo
- `prioritizeFindings(explained, ctx, params)`: estágio 3 — FDR Benjamini–Hochberg (`segBenjaminiHochberg`) sobre todos os candidatos testados, gate de significância/oportunidade, score impacto × confiança × acionabilidade (shrinkage `SHRINK_K`), dedup de segmentos aninhados sem ganho incremental e `diagnostics` com contadores de descarte
- `computeFunnelByNode(shapes, conns, csvStore)`: funil por nó+valor — mesma travessia/acumulação de `exportDiagnosticCSV` (`App.jsx`), reimplementada aqui (worker não importa `App.jsx`) e estendida para atravessar `decision_lens` (a versão original de `exportDiagnosticCSV` para no primeiro lens do caminho — ver `docs/claude/Copiloto-Documentacao.md`)
- `redactFunnel(funnel, includeDomains)`: Contrato de Privacidade aplicado ao funil — sem `includeDomains`, agrega as linhas por NÓ (perde a granularidade por valor, que é N2)
- `buildPolicyPaths(ir, maxPaths=500)`: regras achatadas raiz→terminal — DFS determinístico sobre o IR compondo as condições de cada nó no caminho (decisão enumera todas as rotas; Cineminha enumera os dois ramos); ciclo/destino ausente terminam o ramo com `terminal:null` + motivo, nunca inventam
- `buildFlowNodes(ir, includeDomains)`: descrição por nó do IR (mapeamento 1:1 sobre `ir.nodes` — garante completude por construção); domínios (`routes[].values`, `rowDomain`/`colDomain`, `blockedCells`, `rule.value`) só entram com `includeDomains`
- `computeReliability(funnelRows)`: substituto local do `InferenceSignal`/`confiabVolume` (feature removida — ver nota abaixo) — flags os segmentos do funil com menos de 30 altas (real ou inferida)
- `computeScenarioComparison(canvasInputs, csvStore, baseline, activeSimulated, activeId, activeName)`: comparação de cenários reaproveitando o par `computeSimulatedDecisions`/`computeIncrementalResult` do pipeline 5B (sem montar o dataset largo colunar, que existe para pivot de gráfico, não para uma tabela de poucas linhas); `null` sem baseline AS IS
- `buildGlossary(ir, csvStore, includeDomains)`: variáveis referenciadas no IR (mesma varredura de `extractPolicyRequiredVars`, reimplementada aqui) enriquecidas com metadados de `ir.datasets`; a lista de valores do domínio só é lida do `csvStore` com `includeDomains`

### M6 — Tick de edição: passe único em vez de ~4 varreduras da base (entregue)
Ver `docs/wiki/PERFORMANCE-ANALISE.md` (item M6, Fase C do backlog). Cada gesto de edição
disparava `RUN_SIMULATION` e `COMPUTE_OVERLAY` (mesmos deps/debounce em `App.jsx`), que
juntos percorriam a base **4 vezes** (`runSimulation`, `computeSimulatedDecisions`,
`computeIncrementalResult`, `computeNodeArrivals`), cada uma recalculando
`headers.indexOf`/mapas de aresta por rótulo **por linha** e alocando `new Set()`/`path=[]`
por linha. **Correção:** `computeSimulationTick` funde as quatro passadas numa única
iteração por csv×linha (índices de coluna e arestas pré-resolvidos por nó/csv, "visited"
por época em vez de `new Set()`, buffer de caminho reaproveitado); `getTickResult` cacheia
o resultado por tick (chave `csvStoreVersion + shapes + conns`, mesmo padrão do
`cachedCanvasOverlay`) para que a segunda mensagem do mesmo gesto (`RUN_SIMULATION` ou
`COMPUTE_OVERLAY`, o que chegar depois) não repita o cômputo. `runSimulation`,
`computeSimulatedDecisions`, `computeIncrementalResult` e `computeNodeArrivals` continuam
existindo/exportadas (usadas pelo `cachedCanvasOverlay` do Dashboard e pelos GATEs) —
nenhuma mudança de matemática. GATE de equivalência exaustiva (todas as combinações de
raiz/AS IS/lens/multi-csv/inferência ref) em `tests/simulationTick.test.js`. O motor
"compilado" sobre códigos do dicionário veio depois, no M8 (ver seção seguinte).

### M8 (D2) — Motor "compilado" sobre códigos do dicionário (entregue)
Ver `docs/wiki/PERFORMANCE-ANALISE.md` (item M8, Fase D do backlog). A base era colunar
com dictionary encoding (Fase 1), mas o motor decidia a rota de **cada linha**
re-materializando strings: `(cellStr(...) ?? '').trim()` + match de rótulo nos losangos,
`` `${rKey}|${cKey}` `` (concat + hash de string) no Cineminha e `matchLensRule`
(`parseFloat`/`toLowerCase`/`split(',')`) por linha nos lens. **Correção:** como a decisão
depende só do valor — e o nº de distintos é pequeno — tudo é pré-resolvido **uma vez por
nó×csv sobre o dicionário** (O(distintos)); no loop de linhas resta ler `codes[r]` e
seguir inteiros. Primitivas (em `simulation.worker.js`):
- `compileRoutes(shapes, conns, out)`: rotas por nó resolvidas uma vez sobre a topologia
  (`decisionRoutes` Map rótulo-trimado→{to,cid} first-wins, `cinemaRoutes`
  eligible/notEligible por rótulo exato, `singleEdge` p/ lens/port) — mesma semântica
  dos `find`s por linha que existiam.
- `compileDecisionNode`: `routeByCode[code]` + `valByCode[code]` (trim por distinto).
- `compileCinemaNode`: `eligByPair[rowCode*nC+colCode]` (`Uint8Array`) + `keyByPair`
  (chave de célula pronta) — teto `CINEMA_COMPILE_MAX_PAIRS = 2^16` pares; acima disso
  (eixo patológico de altíssima cardinalidade) o nó fica no caminho por-linha.
- `compileLensMatcher`: `passByCode: Uint8Array` por regra (matchLensRule avaliado uma
  vez por valor distinto; regra sobre coluna ausente vira constante; coluna não-dict cai
  no matchLensRule por-linha), combinadas com o mesmo AND/OR de `rowMatchesLensRules`.
Consumidores compilados: `computeSimulationTick` (tick de edição), `computeSimulatedDecisions`
(overlay do Dashboard), `computeCinemaArrivals` (Johnny) e `computeLensPopulations`.
Colunas não dict-encoded (legado `string[][]` dos testes, eixo sobre coluna métrica) caem
no caminho por-linha de antes — mesma matemática nos dois caminhos. `runSimulation`,
`computeNodeArrivals` e `computeIncrementalResult` seguem **sem alteração** como
referências de controle dos GATEs. GATE de equivalência colunar×legado (decision com
trim/duplicata/ciclo, cineminha 2D/1D/offer/fora-de-domínio/eixo-métrico, lens com
todos os operadores, AS IS e multi-csv) em `tests/compiledEngine.test.js`. Ordem de
grandeza (1MM linhas, bench local): tick fundido compilado ~0,7s contra ~1,4s de
**um único** passe por string; overlay do Dashboard ~0,2s.
