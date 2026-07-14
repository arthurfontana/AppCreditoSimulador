# Pool de Workers (Execução Híbrida H3)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Esta página é a fonte
> primária deste tópico (a wiki, `docs/wiki/Arquitetura-Execucao-Hibrida.md` §7.2
> e `docs/wiki/Hibrido-Prompts-Sessoes.md` Sessão H3, referencia este arquivo de
> volta — não o contrário). Leia antes de mexer no pool de workers aninhados ou
> nas cargas paralelas por candidato.

Ver `docs/wiki/Arquitetura-Execucao-Hibrida.md` (§7.2) e `docs/wiki/Hibrido-Prompts-Sessoes.md`
(Sessão H3). As duas cargas **embaraçosamente paralelas** existentes — a validação por
re-simulação dos top-N em `buildSegmentRecommendations` e as N re-simulações **individuais** de
`computeSegmentCombined` — são shardadas **por candidato** num pool de **workers aninhados**
dentro de `src/simulation.worker.js`. A re-simulação **combinada** de `computeSegmentCombined`
**permanece UMA só** (inline, nunca shardada — DEC-SD-003: aplicar A muda a população que chega a
B). Nenhuma matemática mudou: os caminhos síncronos (`computeSegmentDiscovery`/
`computeSegmentCombined`/`buildSegmentRecommendations`) seguem **inalterados** como referência,
fallback e contrato dos testes.

- **Unidade de shard**: `segValidateMoves(shapes, conns, csvStore, moves)` — aplica os moves
  (`applyGoalSeekMoves`) + `runSimulation` + `segSimSnapshot`. **Pura** em (shapes, conns,
  csvStore, moves), então o resultado independe de qual worker rodou e de quando terminou — base
  do determinismo. Envelope seguro `segValidateMovesSafe` → `{snapshot}` \| `{error}` (espelha o
  try/catch por candidato do caminho original).
- **Plano/preenchimento** (puros, compartilhados sync/pooled): `segPlanRecommendations` monta o
  esqueleto de `recommendation` em cada achado e devolve os JOBS `{id, moves}` (top-N acionáveis);
  `segFillRecommendationDeltas` grava `rec.delta` a partir de `Map(id → snapshot)` — consumido por
  id (independe da ordem de conclusão). `segAssembleCombined` monta o resultado da combinada a
  partir dos snapshots (fonte única do cálculo de somas/interação).
- **Entradas paralelas** (`async`, usadas pelos handlers): `computeSegmentDiscoveryPooled` e
  `computeSegmentCombinedPooled` (via `buildSegmentRecommendationsPooled`). `segBuildModelWithoutRecs`
  é a parte comum da descoberta (estágios 1–3 + asis/anomaly/estabilidade) sem as recomendações.
- **Pool** (`getSimPool`/`createSimPool`, lazy): `min(navigator.hardwareConcurrency − 1, 4)`
  workers aninhados (`new Worker(new URL('./simulation.worker.js', import.meta.url), {type:'module'})`
  — Vite bundla como `new Worker(self.location.href, …)`, auto-referência ao mesmo script). Base
  semeada **1×/versão** via `buildCsvStoreMessage` (SAB compartilha sem cópia sob
  `crossOriginIsolated` — Fase 2; senão structured clone copia uma vez por worker). Cada worker
  recebe só `UPDATE_CSV_STORE` + `POOL_JOB`, então **nunca cria pool próprio** (sem recursão) e é
  **stateless por job** (só a base é estado, referenciada por versão). Chamadas ao pool
  serializadas por `pool.tail` (não corrompe `slot.onDone` entre tarefas).
- **Fallback transparente** (`runValidationJobsVia`): pool null/indisponível (`typeof Worker ===
  'undefined'`, erro de construção, ou erro de orquestração) ⇒ roda os jobs **inline**, sequencial
  e determinístico — idêntico ao single-worker. Os handlers `COMPUTE_SEGMENT_*` ainda têm um
  `.catch` que recai no caminho síncrono.
- **Teste**: `tests/workerPool.test.js` — GATE H3: em Node/jsdom não há Worker real, então o GATE
  injeta um **pool mock** (roda cada job inline via `segValidateMoves` mas resolve **fora de
  ordem**) e prova (1) pool ≡ single-worker **número a número** (Descoberta e Combinada), (2)
  determinismo sob ordens de conclusão diferentes (reverse ≡ shuffle ≡ síncrono), (3) fallback
  (pool === null ≡ síncrono).
