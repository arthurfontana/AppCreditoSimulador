---
name: worker-protocolo
description: Use SEMPRE que for adicionar, alterar ou depurar uma mensagem COMPUTE_*/*_RESULT em src/simulation.worker.js, mexer no cache do tick de edição (getTickResult), no UPDATE_CSV_STORE, ou decidir se um cálculo novo pode rodar no sidecar Python. Dá o passo a passo, as tabelas de mensagens de entrada/saída e a regra de ouro sobre o que jamais pode rotear pro sidecar.
---

# Web Worker — protocolo de mensagens (`src/simulation.worker.js`)

`src/simulation.worker.js` recebe mensagens via `postMessage` e responde de
forma assíncrona. Antes de adicionar/alterar qualquer mensagem
`COMPUTE_*`/`*_RESULT`, ou mexer no cache do tick (`getTickResult`) ou no
motor compilado (M8), leia esta skill inteira.

## Regra de ouro (Execução Híbrida, DEC-HX-007)

**O tick de edição e qualquer resposta síncrona a gesto do usuário jamais
roteiam pro sidecar Python.** `RUN_SIMULATION` e `COMPUTE_OVERLAY` (o "tick")
sempre rodam no worker local — são a Classe A da arquitetura híbrida. Só
tarefas pesadas e assíncronas (Classe B: Descoberta profunda, Clusterização,
Goal Seek profundo) são candidatas a sidecar, e mesmo essas têm fallback
transparente pro worker. Ver `docs/wiki/Arquitetura-Execucao-Hibrida.md` para
a tabela completa de classes de tarefa antes de decidir se algo novo pode
rotear.

## Passo a passo para adicionar uma mensagem `COMPUTE_X`

1. **Payload de entrada**: defina o shape do `postMessage` que a main thread
   envia (`{type: 'COMPUTE_X', ...campos}`). Se a função depende do
   `csvStore`, não o envie no payload — o worker mantém seu próprio cache
   local, atualizado via `UPDATE_CSV_STORE` (ver abaixo).
2. **Função pura no worker**: implemente `computeX(shapes, conns, csvStore, ...)`
   como função separada, testável isoladamente. Prefira reaproveitar as
   primitivas já compiladas (`compileRoutes`, `compileDecisionNode`,
   `compileCinemaNode`, `compileLensMatcher` — motor M8) em vez de percorrer
   linha a linha por string.
3. **Handler no listener** de `onmessage`: `case 'COMPUTE_X': ... postMessage({type: 'X_RESULT', ...})`.
4. **Mensagem de saída** `X_RESULT`: documente o payload de resposta (ver
   tabela "Mensagens de saída" abaixo para o padrão).
5. **Se a tarefa é candidata a sidecar (Classe B)**: adicione o alias de
   fallback (padrão `segment_discovery`/`cluster_segments`) com os params
   CLAMPADOS aos tetos do browser (`clampXParamsForBrowser`) — é o que o
   `ComputeRouter` posta quando o job do sidecar cai/está indisponível.
   Deve responder com o **mesmo** tipo de `*_RESULT` da via normal (paridade
   total). Ver `docs/wiki/Arquitetura-Execucao-Hibrida.md`.
6. **Atualize a tabela de protocolo** em `docs/claude/Worker-Protocolo.md`
   (entrada + saída) — é a fonte de referência do domínio.
7. **Teste**: se a mensagem tem contraparte "caminho legado" (string) vs.
   "motor compilado" (códigos do dicionário), ou uma composição de funções
   que existia antes, escreva um GATE de equivalência numérica exaustiva
   (padrão `tests/simulationTick.test.js`, `tests/compiledEngine.test.js`).

## `UPDATE_CSV_STORE`

Mensagem `{type: 'UPDATE_CSV_STORE', payload: {csvStore}}` atualiza o cache
do `csvStore` guardado no worker, evitando re-serialização a cada tick. É
enviada pela main thread sempre que o `csvStore` muda (import de CSV, load
de projeto). Qualquer `compute*` novo que precise da base deve ler do cache
do worker, não esperar recebê-la no payload da mensagem de cômputo.

## `getTickResult` / cache do tick (M6)

Cada gesto de edição no canvas dispara `RUN_SIMULATION` **e**
`COMPUTE_OVERLAY` (mesmas deps/debounce em `App.jsx`). Antes do M6, isso
percorria a base 4 vezes (`runSimulation` + `computeSimulatedDecisions` +
`computeIncrementalResult` + `computeNodeArrivals`). `computeSimulationTick`
funde as quatro passadas numa única iteração por csv×linha, e
`getTickResult` cacheia o resultado por tick (chave `csvStoreVersion +
shapes + conns`, single-slot): a primeira das duas mensagens do mesmo gesto
computa; a segunda só lê do cache. Se você adicionar uma nova mensagem que
também precisa do resultado do tick, **reuse `getTickResult`** em vez de
rodar uma varredura própria da base — é o ponto certo para evitar reintroduzir
a duplicação que o M6 eliminou.

`runSimulation`, `computeSimulatedDecisions`, `computeIncrementalResult` e
`computeNodeArrivals` continuam existindo e exportadas sem alteração — usadas
pelo `cachedCanvasOverlay` do Dashboard e pelos GATEs numéricos como
referência de controle. Nunca mude a matemática delas para "simplificar":
qualquer refactor estrutural deve manter equivalência numérica exaustiva com
o caminho anterior.

## Tabela de mensagens de entrada (resumo — ver `docs/claude/Worker-Protocolo.md` para a completa)

| type | payload | O que faz |
|------|---------|-----------|
| `UPDATE_CSV_STORE` | `{csvStore}` | Atualiza o cache do csvStore no worker |
| `RUN_SIMULATION` | `{shapes, conns}` | `getTickResult` → `SIMULATION_RESULT` |
| `COMPUTE_OVERLAY` | `{shapes, conns}` | `getTickResult` → `OVERLAY_RESULT` |
| `COMPUTE_ASIS_PREVIEW` | `{shapes, conns, targetIds, reqTokens}` | Prévia AS IS contextualizada ao nó → `ASIS_PREVIEW_RESULT` |
| `COMPUTE_OPTIM` | `{shape}` | Otimizador single-Cineminha → `OPTIM_RESULT` |
| `COMPUTE_JOHNNY` | `{shapes, cinemaIds, conns, ...}` | Otimizador multi-Cineminha → `JOHNNY_RESULT` |
| `COMPUTE_ANALYTICS_DATASET` | `{canvases}` | Dataset do Dashboard → `ANALYTICS_RESULT` |
| `COMPUTE_GOAL_SEEK` | `{shapes, conns, goal, constraints, locks}` | Goal Seek clássico → `GOAL_SEEK_RESULT` |
| `COMPUTE_GOAL_SEEK_CONTEXT/CATALOG/VALIDATE` | ver tabela completa | Goal Seek Profundo (GS1–GS6) |
| `COMPUTE_SIMPLIFY` | `{shapes, conns}` | Simplificação com prova → `SIMPLIFY_RESULT` |
| `COMPUTE_POLICY_DOC` | `{shapes, conns, ir, canvases, options}` | Documentação Automática → `POLICY_DOC_RESULT` |
| `COMPUTE_SEGMENT_DISCOVERY` / `segment_discovery` (fallback) | `{shapes, conns, scope, params}` | Descoberta de Segmentos → `SEGMENT_DISCOVERY_RESULT` |
| `COMPUTE_SEGMENT_RECS` | `{shapes, conns, scope, params, segmentModel}` | Anexa recomendações → `SEGMENT_RECS_RESULT` |
| `COMPUTE_SEGMENT_COMBINED` | `{shapes, conns, applies}` | Aplicação combinada → `SEGMENT_COMBINED_RESULT` |
| `COMPUTE_CLUSTER_SEGMENTS` / `cluster_segments` (fallback) | `{params}` | Clusterização → `CLUSTER_SEGMENTS_RESULT` |
| `POOL_JOB` | `{jobId, shapes, conns, moves}` | Shard do pool de workers (H3) → `POOL_JOB_RESULT` |

## Tabela de mensagens de saída (resumo)

| type | payload |
|------|---------|
| `SIMULATION_RESULT` | `{result: SimulationResult}` |
| `OVERLAY_RESULT` | `{incrementalResult, nodeArrivals, lensCounts}` |
| `ASIS_PREVIEW_RESULT` | `{cellsByShape, reqTokens}` |
| `OPTIM_RESULT` / `JOHNNY_RESULT` | métricas + fronteira Pareto + cenários |
| `ANALYTICS_RESULT` | `{dataset: AnalyticsDataset \| null}` (colunar, zero-cópia) |
| `GOAL_SEEK_RESULT` / `GOAL_SEEK_CONTEXT_RESULT` / `GOAL_SEEK_CATALOG_RESULT` | ver Copiloto-GoalSeek.md |
| `SIMPLIFY_RESULT` | `{proposal, equivalence}` |
| `POLICY_DOC_RESULT` | `{docModel}` |
| `SEGMENT_DISCOVERY_RESULT` / `SEGMENT_RECS_RESULT` / `SEGMENT_COMBINED_RESULT` | `{segmentModel}` / `{combined}` |
| `CLUSTER_SEGMENTS_RESULT` | `{clusterModel}` |
| `POOL_JOB_RESULT` | `{jobId, snapshot}` \| `{jobId, error}` |

## Onde ler mais

Tabela completa (todas as ~18 mensagens, com todos os campos) e a lista de
funções internas do worker (`computeSimulationTick`, `runSimulation`,
`compileRoutes` etc., M6/M8): `docs/claude/Worker-Protocolo.md`. Classes de
tarefa A/B e arquitetura do sidecar: `docs/wiki/Arquitetura-Execucao-Hibrida.md`.
