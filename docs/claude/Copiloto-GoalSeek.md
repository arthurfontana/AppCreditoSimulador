# Motor de Goal Seek (`goalSeekModal`, Copiloto Sessão 4)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer no
> Goal Seek clássico (catálogo de movimentos, busca gulosa, estado do modal) ou
> no roteamento para o modo profundo (sidecar).

Generaliza o Johnny (`docs/claude/Cineminha-Otimizadores.md`) da célula de Cineminha para a **política inteira**: o usuário
declara um objetivo estruturado e o motor busca uma sequência de movimentos concretos —
não só abrir/fechar célula, mas também trocar o terminal de um segmento de losango e
relaxar/apertar o limiar de uma regra de Decision Lens — que atinja o objetivo. Ver
`docs/wiki/Copiloto-SugestoesMelhoria.md` (Sessão 4) e `docs/wiki/Epicos-CopilotoIA.md`
(DEC-IA-005/006).

## Catálogo de movimentos
Cada candidato tem agregados de segmento conhecidos (mesma técnica de
`computeCinemaArrivals`/`exportDiagnosticCSV`) — trocar o destino de um segmento muda os
acumuladores globais por adição/subtração, sem re-simular a base a cada candidato:
- **`cinema_cell`**: reusa `computeCinemaArrivals` — mesma mecânica do Johnny.
- **`decision_terminal`**: um VALOR de losango cujo port resolve **diretamente** (seguindo
  cadeias de port, como o `resolveThroughPorts` do PolicyIR) a um terminal Aprovado/
  Reprovado — trocar esse terminal move o segmento inteiro sem ambiguidade. Segmentos que
  resolvem em AS IS ficam fora do catálogo (o terminal depende de `__DECISAO_ORIGINAL`
  por linha, não é um destino único).
- **`lens_threshold`**: um Decision Lens de **uma** regra (`gte`/`gt`/`lte`/`lt`) cujo
  único port de saída resolve direto a **Aprovado** — relaxa (admite o próximo valor que
  hoje falha) ou aperta (remove o valor mais próximo da fronteira que hoje passa) por
  **um passo** por execução. Lens com saída para Reprovado/AS IS ou com mais de uma regra
  ficam fora do catálogo (extensível por design).
- **`add_break`** (Sessão 12): a "quebra que falta" — INSERE um losango (1 condição) ou
  Cineminha (2 condições) ANTES de um nó âncora, roteando o sub-segmento acionável a um
  terminal e o resto de volta ao âncora. NÃO é gerado pela busca do Goal Seek (não tem
  agregado O(1) por candidato); é gerado pelo achado `heterogeneous_block`/exceção da
  **Descoberta de Segmentos** (`segBuildBreakMove`) e materializado pelo MESMO applier
  (`applyGoalSeekMoves`, `src/goalSeek.js`) — entregando a pendência declarada da Sessão 4.
  O "🎯 Enviar ao Goal Seek" da Descoberta pré-carrega o objetivo para o refino fino aqui.

## Busca
Greedy com precedência + shrinkage bayesiano (`SHRINK_K`, mesmo padrão do
`computeJohnnyData`), generalizando o pool de "células" do Johnny para candidatos
heterogêneos com direção (`toApproved`): candidatos que movem qty PARA o aprovado
("expandir", usados quando a direção do objetivo é `increase`) ou PARA fora dele
("contrair", usados em `decrease`). Precedência (`requires`) é construída por tipo:
monotonicidade em eixo ordinal do Cineminha (idêntica ao Johnny) e em variável ordinal do
losango (a ordem dos ports no canvas define a posição — não pula rank mesmo que um valor
mais distante seja individualmente mais barato). Travas 🔒 (`shape.locked`, alternável na
toolbar contextual de losango/Cineminha/Decision Lens; ou a lista `locks` da mensagem)
excluem candidatos do nó inteiro **antes** da busca. Restrições de teto
(`constraints.maxInadReal`/`maxInadInf`, ratio 0–1) são invioláveis — um movimento que
estouraria o teto nunca entra na proposta; se nenhum candidato liberado cabe, a busca para
e reporta `bindingConstraint` (`'maxInadReal'`\|`'maxInadInf'`\|`'no_more_moves'`).

## Estado `goal`/`constraints` (payload de `COMPUTE_GOAL_SEEK` e `COMPUTE_GOAL_SEEK_VALIDATE`)
```js
goal = {
  target: 'approvalRate'|'inadReal'|'inadInferida'|'approvedAltasInfer',
  direction: 'increase'|'decrease',
  magnitude: number|null,  // null = "mínimo"/"máximo" possível dentro das restrições
  minimize: 'inadReal'|'inadInferida'|'approval'|'salesVolume', // GS2 (DEC-GS-003) — objetivo colateral; orienta o scoring no greedy clássico e no MILP do sidecar
}
constraints = { maxInadReal: number|null, maxInadInf: number|null } // tetos, ratio 0–1
```

## Validação por re-simulação (DEC-IA-005)
Ao final da busca (sucesso ou parcial), os movimentos aceitos são materializados de
verdade — `applyGoalSeekMoves(shapes, conns, moves, idMap?)` em **`src/goalSeek.js`**
(módulo compartilhado entre o worker e a main thread, que não se importam entre si: o
worker usa para a validação interna, `idMap` omitido; a main usa para aplicar de verdade
no clone do canvas, `idMap` de `cloneCanvasWithNewIds`) — e **re-simulados**
(`runSimulation`). Nenhum número exibido no `goalSeekModal` tem origem só no delta
incremental interno da busca — o campo `result` de `GOAL_SEEK_RESULT` vem sempre dessa
re-simulação real.

## Taxa de aprovação escopada à política (denominador = população decidida)
A **taxa de aprovação** do Goal Seek (baseline, fronteira e `result`) é medida sobre a
**população que a política de fato decide** — as linhas que chegam a QUALQUER terminal
(Aprovado/Reprovado/AS IS) — e **não** sobre a base inteira. Numa política **parcial**
(atrás de um Decision Lens que restringe a sub-população, ex.: só certas safras/ADABAS),
a base inteira dilui a taxa a ponto de torná-la ininteligível: aprovar 72,8% do que a
política decide aparecia como "3,35%" porque ~95% das linhas ficavam fora do escopo mas
no denominador. `computeGoalSeekBaseline` acumula `decidedQty` (soma de `qty` das linhas
com `res != null`); `goalSeekRatios` divide `approvedQty / decidedQty` (fallback
`totalQty` p/ retrocompat); o delta O(1) só mexe em `decidedQty` para movimentos
`lens_threshold` (que admitem/removem linhas do escopo) — `cinema_cell`/`decision_terminal`
mantêm o denominador fixo (a linha já estava no escopo, só troca de terminal). O
`result.approvalRate` é reescopado a partir da re-simulação (`approvedQty /
(approvedQty+rejectedQty+asIsQty)`). Sem filtro a montante `decidedQty == totalQty` e a
taxa coincide com a de `runSimulation` (o GATE `tests/goalSeek.test.js` é invariante).
**Nota:** o SimPanel/`incrementalResult` e o gráfico do Dashboard continuam com denominador
de base inteira (contrato de vários GATEs) — daí a mesma política aparecer como ~3% no
painel e ~73% escopada no Goal Seek. Alinhar o SimPanel a esse escopo é um follow-up.

## Estado `goalSeekModal`
```js
{
  step: 'form'|'loading'|'result',
  goal, constraints,                 // objetivo em edição
  context: null | {baseline, asis},  // GS1 (DEC-GS-002) — cards "Ponto de partida", populado por GOAL_SEEK_CONTEXT_RESULT ao abrir o formulário
  baseline, frontier, moves,         // devolvidos por GOAL_SEEK_RESULT (step==='result')
  goalReached, bindingConstraint, result,
  via: null|'worker'|'sidecar',      // GS6 (DEC-GS-001) — qual executor resolveu; 'worker' = greedy clássico
  curves: null | [{ceiling, frontier}], // GS6 (DEC-GS-006) — família de curvas Pareto por teto de inad.inf; null = modo clássico sem curvas
  deepRun: null | {catalogToken, moveIds, frontierIds}, // GS6 — detalhes da rodada profunda para debug
  fallbackNotice: null | string,     // GS6 — aviso "concluído no modo browser" quando o sidecar cai
}
```
`moves[i]`: `{id, type, shapeId, label, qty, qtdAltas, qtdAltasInfer, inadRRaw, inadIRaw, deltaApprovalRate, apply, stats}` — `apply` é o patch mínimo que `applyGoalSeekMoves` materializa (`{type:'cinema_cell', shapeId, cellKey, newValue}` \| `{type:'decision_terminal', connId, newTo}` \| `{type:'lens_threshold', shapeId, ruleIndex, newValue}`). `stats` (GS3, DEC-GS-003): `{n, rate, ci95:{lower,upper}|null, pValue, fragile}` — `n` = volume de altas (denominador de inad.), `ci95` via `wilsonCI`, `fragile` = `n < GOAL_SEEK_MIN_SAMPLE` (30).

## Travas (`shape.locked`)
Novo campo booleano em qualquer shape de fluxo (`decision`/`cineminha`/`decision_lens`),
alternável pelo botão 🔒/🔓 na toolbar contextual de cada um. Persiste via `canvases` (não
precisa de entrada própria no Projeto — é só mais um campo de shape, já coberto). Também
respeitado pelos otimizadores futuros que quiserem checar `shape.locked`.

## Ativação e aplicação
Botão **🎯 Atingir Objetivo** na seção Fluxo do painel direito (`openGoalSeekModal`) abre
o formulário e dispara `COMPUTE_GOAL_SEEK_CONTEXT` (populando os 3 cards "Ponto de partida"
assincronamente — GS1). **🔎 Buscar** (`runGoalSeek`) detecta automaticamente (`goalSeekDeepOk()`)
se o sidecar Python está disponível e anuncia `goal_seek_deep` em capabilities (DEC-GS-010):
- **Modo clássico** (sem sidecar, ou sidecar sem `goal_seek_deep`): dispara `COMPUTE_GOAL_SEEK` direto
  ao worker — comportamento original do Copiloto Sessão 4; `via:'worker'`.
- **Modo profundo** (GS1–GS6, sidecar disponível): fluxo em 3 passos: ① `COMPUTE_GOAL_SEEK_CATALOG`
  (worker, Classe A) → ② `goal_seek_deep` chamado **diretamente** em `sidecarProxyRef` (SEM
  `ComputeRouter`, pois o task não tem gêmeo no worker — DEC-GS-001) → ③
  `COMPUTE_GOAL_SEEK_VALIDATE` (worker, Classe A) que produz `GOAL_SEEK_RESULT`. Queda do
  sidecar em qualquer etapa ⇒ fallback para `runClassicGoalSeek()` + `fallbackNotice`.

**✓ Aplicar como novo cenário** (`applyGoalSeekResult`) materializa os movimentos numa aba
de canvas **nova** (`cloneCanvasWithNewIds` + `applyGoalSeekMoves`, mesmo padrão não-destrutivo
do `duplicateCanvas` da Sub-sessão 5A) — a política de origem fica intocada, comparável
imediatamente no Dashboard/KPI A vs B.

## Goal Seek Deep (GS1–GS6)

Documentação normativa completa (motivação, DEC-GS-001..010, algoritmo MILP do sidecar,
UX de roteamento automático) já vive em **`docs/wiki/Hibrido-GoalSeek-Profundo.md`** —
este arquivo não duplica: leia a wiki antes de mexer em qualquer parte do modo profundo
(GS1–GS6). Resumo de 1 linha por sessão, só para orientação rápida:

- **GS1 (DEC-GS-002)** — cards "Ponto de partida" no formulário (`COMPUTE_GOAL_SEEK_CONTEXT`).
- **GS2 (DEC-GS-003)** — `goal.minimize` ampliado para 4 opções (score de candidato).
- **GS3 (DEC-GS-004)** — selos estatísticos (`stats.ci95`/`pValue`/`fragile`) por movimento.
- **GS4 (DEC-GS-005/008)** — catálogo ampliado com escadas de lens para o sidecar.
- **GS5 (DEC-GS-006/009)** — task `goal_seek_deep` (MILP/HiGHS) no `release/sidecar.py`.
- **GS6 (DEC-GS-001/010)** — roteamento automático transparente + família de curvas na UI.

## Teste
`tests/goalSeek.test.js` — GATE: delta O(1) por movimento (dos três tipos do catálogo) ≡
re-simulação completa via `runSimulation`; monotonicidade ordinal preservada mesmo quando
o segmento mais barato não é o primeiro do domínio; nenhum ponto da fronteira viola
teto/trava; objetivo inatingível reporta o melhor parcial + a restrição-gargalo;
determinismo (mesma entrada ⇒ mesma proposta). Os testes do catálogo ampliado e de
`wilsonCI` estão incorporados na mesma suíte.
