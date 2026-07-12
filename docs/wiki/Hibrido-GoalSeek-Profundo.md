# Goal Seek Profundo + UX — Plano de Execução (Épico GS)

> **Ordem de execução recomendada**: GS1 → GS2 → GS3 (browser puro, valor imediato com o
> motor desligado) → **GS4 → GS5 → GS6** (cadeia do Motor Python, nesta ordem) → GS7
> (documentação, último).
>
> Referência normativa: esta página (DEC-GS-001..010 — **leia inteira antes de qualquer
> sessão**) · [[Arquitetura-Execucao-Hibrida]] (DEC-HX-001..009) ·
> [[Copiloto-SugestoesMelhoria]] (Sessão 4 — Goal Seek atual) · CLAUDE.md (seção "Motor
> de Goal Seek").
>
> **🏷️ Tag de modelo por sessão**: `[OPUS]` para núcleo algorítmico/matemática sutil em
> runtime único; `[SONNET]` para UI sobre padrões consolidados e trabalho bem
> especificado; `[HAIKU]` para sincronização documental mecânica. **Este épico não tem
> sessão de paridade numérica cross-runtime** (ver DEC-GS-009 — o solver Python não tem
> gêmeo JS), então nenhuma sessão exige tier acima de Opus.
>
> **Regras transversais (valem para TODAS as sessões):**
> 1. `npm test` passa inalterado ao fim de cada sessão — o GATE existente
>    `tests/goalSeek.test.js` é contrato; sessões só ADICIONAM casos.
> 2. O caminho atual (`COMPUTE_GOAL_SEEK` → busca gulosa) **não muda de matemática**
>    (exceto a generalização do `minimize` na GS2, coberta por GATE novo). Ele é o modo
>    de operação com o motor desligado e o fallback do modo profundo.
> 3. Todo número exibido como resultado vem de **re-simulação real** no worker
>    (`applyGoalSeekMoves` + `runSimulation`) — DEC-IA-005 continua valendo palavra por
>    palavra. Pontos de fronteira exibidos em gráfico podem vir de agregados lineares
>    (mesmo status do gráfico de fronteira atual), mas o `result` do cenário escolhido
>    é sempre re-simulado.
> 4. O tick de edição JAMAIS roteia para o sidecar (DEC-HX-007, regra de ouro).
> 5. `goalSeekModal` continua efêmero (não persistido) — nada deste épico cria estado
>    que precise entrar em `buildProjectPayload` (a única exceção seria uma preferência
>    nova; não há nenhuma: o modo profundo é derivado de `computeSidecar.enabled` +
>    capabilities, já persistidos).
> 6. Nada de framework novo no front nem no Python (sidecar continua stdlib
>    `http.server`; scipy/numpy só dentro de `release/python/*.py`, tier full).

---

## Visão do épico

O Goal Seek atual (Copiloto Sessão 4) é uma **busca gulosa** com deltas O(1),
precedência ordinal e validação por re-simulação. Este épico entrega três coisas:

1. **UX de entrada melhor** (GS1): cards de "Ponto de partida" no topo do modal (AS IS
   vs. política atual, escopados à população decidida) — o usuário declara objetivo
   vendo de onde parte.
2. **Busca mais honesta estatisticamente** (GS2 + GS3): o campo "Minimizar
   colateralmente" generalizado (inadimplência, impacto em aprovação, volume de vendas
   impactado) e selos estatísticos por movimento (intervalo de confiança Wilson + teste
   binomial + piso amostral).
3. **Busca ótima com o Motor Python** (GS4–GS6): quando o sidecar está pareado, o
   problema vira **otimização exata (MILP via `scipy.optimize.milp`/HiGHS)** sobre o
   catálogo de movimentos — com escadas completas de limiar de lens, fronteira ótima
   por grade de níveis e fronteira "3D" (famílias de curvas por teto de inadimplência).
   Com o motor desligado/indisponível, **tudo se comporta exatamente como hoje**
   (greedy), com a degradação declarada (`ComputeCeilingNotice`/`fallbackNotice`, P4).

### Filosofia (decisão do produto, 12/07/2026)
Motor desligado = solução atual intocada. Motor ligado = **o máximo**: busca exata, sem
teto artificial. Não existe "modo intermediário".

---

## Decisões de arquitetura (DEC-GS)

| DEC | Decisão (resumo) |
|-----|------------------|
| DEC-GS-001 | Paridade de **contrato**, não de números: o fallback browser é o greedy atual; o resultado profundo pode (e deve) ser melhor. Sem GATE dourado cross-runtime |
| DEC-GS-002 | Cards "Ponto de partida" no modal: 3 cards (não 6), valor grande = política atual, linha pequena = AS IS + Δ; números do worker via `COMPUTE_GOAL_SEEK_CONTEXT`, escopados a `decidedQty` |
| DEC-GS-003 | `goal.minimize` generalizado por tabela de custo/ganho por candidato (razão colateral/alvo com shrinkage), 4 opções; chave e valores antigos preservados |
| DEC-GS-004 | Selos estatísticos por movimento (Wilson 95% + binomial two-sided vs. média do pool + piso de 30 altas) — Classe A, browser, determinístico |
| DEC-GS-005 | **O catálogo nasce no worker; o sidecar só otimiza.** O dataset NUNCA sobe para o sidecar no Goal Seek — o job leva o catálogo agregado (KBs), não a base |
| DEC-GS-006 | Solver: MILP binário com precedência + tetos linearizados por multiplicação cruzada; objetivos fracionários via iteração de Dinkelbach; lexicográfico em 2 estágios (alvo, depois colateral) |
| DEC-GS-007 | Validação single-sourced no worker: `COMPUTE_GOAL_SEEK_VALIDATE` materializa e re-simula (pool H3 para pontos extras); o sidecar nunca reporta número final |
| DEC-GS-008 | Escadas de lens: `buildGoalSeekCandidates` ganha `maxLensSteps` (browser/greedy = 1, profundo = 12), degraus encadeados por `requires` |
| DEC-GS-009 | Determinismo do solver: HiGHS single-thread, ordem canônica de candidatos (por `id`, comparação por code unit UTF-16), tolerâncias fixas; GATE dourado só do lado Python (pytest) + invariantes estruturais validadas em JS |
| DEC-GS-010 | Gating/UX: task `goal_seek_deep` em capabilities (tier full + scipy com `milp`); toggle automático no formulário; progresso/cancelamento/fallback com os helpers da H6 |

### DEC-GS-001 — Paridade de contrato, não de números

Diferente da H7/H8 (DEC-HX-005), aqui **não existe gêmeo JS do solver** — um MILP não
tem contraparte browser, e o fallback (greedy) produz legitimamente um resultado
diferente (pior ou igual no alvo). O que substitui o GATE dourado cross-runtime:

1. **Invariantes estruturais validadas em JS** (no worker, ao receber a solução do
   sidecar, ANTES de exibir qualquer coisa): (a) todo movimento da solução existe no
   catálogo enviado; (b) nenhuma precedência (`requires`) violada; (c) nenhum candidato
   de nó travado; (d) a re-simulação real respeita os tetos (`maxInadReal`/`maxInadInf`).
   Violação de qualquer invariante ⇒ descarta a solução e cai no fallback greedy com
   aviso (nunca exibe solução inválida).
2. **Teste de dominância**: o alvo re-simulado da solução profunda deve ser ≥ (ou ≤, em
   `decrease`) o alvo re-simulado da solução greedy sobre o MESMO catálogo. Se o solver
   perder do greedy, algo está errado ⇒ mesmo tratamento do item 1. (Exceção declarada:
   empate é válido.)
3. **GATE dourado só-Python** (`tests_python/test_goal_seek.py`): fixtures de catálogo
   commitadas com solução esperada — protege regressão do solver sem exigir paridade JS.
4. Fallback e teto declarados na UI (`fallbackNotice` / `ComputeCeilingNotice`), padrão
   P4 — o usuário sempre sabe QUAL busca produziu o que está vendo.

### DEC-GS-002 — Cards "Ponto de partida" (nomes e forma)

**Problema de nomes**: "Taxa de Aprovação AS IS" × "Taxa de Aprovação do Fluxo" × 6
cards polui e repete o prefixo. **Decisão**: 3 cards (um por métrica), cada um com DOIS
números — o grande é a **política atual no canvas** (é nela que a busca vai mexer), o
pequeno é o AS IS como referência histórica, com o delta:

```
┌─ 📍 Ponto de partida ─ (população decidida pela política ⓘ) ──────────────┐
│ ┌ Taxa de Aprovação ┐  ┌ Inad. Inferida ┐  ┌ Inad. Real ┐                │
│ │      72,8%        │  │     4,31%      │  │   3,90%    │                │
│ │ AS IS 71,2 · Δ+1,6pp│ │ AS IS 4,55 · Δ−0,24pp│ │ AS IS 4,02 · Δ−0,12pp│ │
│ └───────────────────┘  └────────────────┘  └────────────┘                │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Rótulos**: título da seção `📍 Ponto de partida`; cards `Taxa de Aprovação`,
  `Inad. Inferida`, `Inad. Real` (sem sufixo — o contraste AS IS/atual está DENTRO do
  card). Linha pequena: `AS IS {valor} · Δ{±x.x}pp`, delta colorido pela direção da
  métrica (reusar `GOOD_WHEN_LOWER` do Analytics: inad menor = verde).
- **Sem AS IS configurado**: linha pequena vira `AS IS não configurado` (cinza), card
  continua mostrando a política atual — degradação declarada, nunca omissão.
- **Escopo dos números (sutileza importante)**: a taxa de aprovação do Goal Seek é
  **escopada à população decidida** (`approvedQty / decidedQty` — ver seção "Taxa de
  aprovação escopada" do CLAUDE.md), DIFERENTE do SimPanel (base inteira). Os cards
  usam o MESMO escopo do Goal Seek (senão o usuário vê 3,35% no card e 72,8% no
  resultado). O tooltip ⓘ do título explica: "medido sobre a população que a política
  decide (chega a um terminal), não sobre a base inteira — por isso pode diferir do
  painel de simulação".
- **Fonte dos números**: nova mensagem `COMPUTE_GOAL_SEEK_CONTEXT` (ver Protocolo).
  O AS IS é acumulado NO MESMO walk do baseline (`computeGoalSeekBaseline` estendido):
  para cada linha que chega a um terminal (`res != null`), além dos acumuladores
  simulados, acumular os agregados AS IS lendo `__DECISAO_ORIGINAL` (`APROVADO` ⇒ soma
  qty/qtdAltas/qtdAltasInfer/inadRRaw/inadIRaw nos acumuladores AS IS; `REPROVADO` ⇒ só
  denominador de decididos; vazio ⇒ fora do AS IS). Mesma população, mesmíssimo escopo
  ⇒ comparável por construção. Dataset sem `__DECISAO_ORIGINAL` ⇒ `asis: null`.
- **Quando**: `openGoalSeekModal` dispara a mensagem e o form mostra skeleton nos cards
  até `GOAL_SEEK_CONTEXT_RESULT` chegar (o form já é utilizável antes — os cards não
  bloqueiam). Os cards aparecem SÓ no `step:'form'` (no `step:'result'` a grade
  baseline→resultado existente já cumpre esse papel).

### DEC-GS-003 — "Minimizar colateralmente" generalizado

`goal.minimize` passa a aceitar 4 valores (os 2 atuais preservados — retrocompat de
payload):

| valor | rótulo na UI | quantidade colateral por candidato `collQty(c)` |
|---|---|---|
| `inadInferida` (default) | Inad. Inferida | `c.inadIRaw` |
| `inadReal` | Inad. Real | `c.inadRRaw` |
| `approval` | Impacto em Aprovação | `c.qty` |
| `salesVolume` | Vol. de Vendas impactado | `c.qtdAltasInfer` |

Quantidade de **ganho no alvo** por candidato `tgtQty(c)`, derivada de `goal.target`:
`approvalRate` ⇒ `c.qty` · `approvedAltasInfer` ⇒ `c.qtdAltasInfer` · `inadReal` ⇒
`c.inadRRaw` · `inadInferida` ⇒ `c.inadIRaw`.

**Critério de ordenação da busca gulosa** (substitui `smoothed()` de forma
generalizada, reduzindo-se ao comportamento atual quando alvo=aprovação e
minimize=inad):

```
score(c) = (collQty(c) + collPoolAvg·K) / (tgtQty(c) + tgtPoolAvg·K)
```

- `collPoolAvg` / `tgtPoolAvg` = média por candidato da respectiva quantidade sobre o
  pool (mesmo espírito do `poolAvg` atual); `K = SHRINK_K` com a MESMA fórmula de hoje
  (`max(1, (poolQty/max(1,pool.length))·0.1)`).
- Ordena por `score` **crescente** (menor custo colateral por unidade de ganho no
  alvo primeiro). Desempates: `qty` desc, depois `id` asc (comparação por code unit
  UTF-16 — `segStrCmp`, nunca `localeCompare`).
- **Redução ao comportamento atual**: com `target='approvalRate'` (tgtQty=qty) e
  `minimize='inadInferida'`, `score = (inadIRaw + avg·K)/(qty + avg·K)` — a MESMA
  família do `smoothed()` atual (taxa suavizada de inad por proposta movida; muda
  apenas o denominador de `qtdAltasInfer` para `qty`, que é o denominador correto do
  "por unidade de ganho"). Isso é **mudança de matemática deliberada e coberta por
  GATE novo** (única exceção autorizada à regra transversal 2; ver GATE da GS2).
- **UI**: o `<select>` esconde a opção cujo campo coincide com o alvo (minimizar a
  própria coisa que se quer mexer não faz sentido); se o usuário troca o alvo e o
  minimize atual colide, reseta para `inadInferida` (ou `approval` quando o alvo é uma
  inad).
- **Direção `decrease`**: nada muda estruturalmente — o pool já é filtrado por
  `toApproved === wantsApproved`; o score continua "custo colateral por unidade de
  ganho", onde o ganho agora é a quantidade REMOVIDA do agregado-alvo.
- O MILP (GS5) usa o MESMO conceito no estágio 2 (minimizar o colateral escolhido) —
  a semântica do campo é uma só nos dois modos.

### DEC-GS-004 — Selos estatísticos por movimento (browser, Classe A)

Anexados a cada `move` devolvido (`moves[i].stats`), computados no worker com
matemática já existente ou trivial (determinístico, sem bootstrap no browser):

```js
stats: {
  n,            // denominador da taxa do movimento: qtdAltas (inadReal) / qtdAltasInfer||qty (inadInferida)
  rate,         // taxa crua do segmento na métrica minimize (quando minimize é inad*; senão null)
  ci95: [lo, hi] | null,   // intervalo de Wilson 95% sobre rate (null quando rate null ou n=0)
  pValue: number | null,   // segBinomTwoSided(k, n, poolAvg) — desvio vs. média do pool
  fragile: boolean,        // n < GOAL_SEEK_MIN_SAMPLE (=30, mesmo piso de computeReliability)
}
```

- **Wilson 95%** (helper novo `wilsonCI(k, n, z=1.96)` no worker, exportado p/ teste):
  `p̂=k/n; den=1+z²/n; centro=(p̂+z²/2n)/den; delta=z·√(p̂(1−p̂)/n + z²/4n²)/den` ⇒
  `[centro−delta, centro+delta]`. Sem dependência nova.
- **Binomial**: reusa `segBinomTwoSided` (Descoberta de Segmentos) — já vive no worker.
- **UI (GS3)**: badge no card do movimento — `⚠ amostra frágil` (âmbar) quando
  `fragile`; caso contrário `IC95 3,1–5,2%` (cinza, discreto). Tooltip com n e p-value.
  NÃO bloqueia nem reordena a busca (o shrinkage já cuida da ordenação) — é informação
  de confiança, não filtro. Bootstrap/IC do resultado agregado: **extra futuro do
  sidecar** (fora deste épico, nunca no caminho browser).

### DEC-GS-005 — Catálogo no worker, solver no sidecar (SEM upload de dataset)

Este é o ponto arquitetural central do épico. A alternativa (portar
`buildGoalSeekCandidates`/walk para Python, como a H7 fez com a Descoberta) exigiria
paridade número a número de TODO o pipeline de agregação — semanas de trabalho tier
Fable. Desnecessário: o problema de otimização é inteiramente definido pelos
**agregados por candidato** (centenas de números), não pela base (milhões de linhas).

**Fluxo do modo profundo:**

```
main ──COMPUTE_GOAL_SEEK_CATALOG──▶ worker      (walk M8; catálogo + baselineRaw)
main ◀──GOAL_SEEK_CATALOG_RESULT─── worker
main ──router.run('goal_seek_deep', {catalog, goal, constraints, frontierPoints})──▶ sidecar
main ◀── job result {solution, frontier, status} ── sidecar   (só ids + previsões lineares)
main ──COMPUTE_GOAL_SEEK_VALIDATE──▶ worker      (materializa moves + runSimulation; invariantes DEC-GS-001)
main ◀──GOAL_SEEK_RESULT─────────── worker      (MESMO formato de hoje ⇒ UI de resultado reusada)
```

- `registerDataset`/hash (DEC-HX-006) **não se aplica** — o job é self-contained
  (`params` = catálogo + objetivo). Payload típico < 100KB.
- Queda/indisponibilidade em QUALQUER etapa ⇒ fallback transparente: `COMPUTE_GOAL_SEEK`
  clássico (greedy) + `fallbackNotice`. Abort do usuário NÃO dispara fallback (mesma
  semântica do `router.run` desde a H7).
- O sidecar fica **stateless e burro**: recebe números, devolve índices. Nenhum
  conhecimento de shapes/conns/csvStore vaza para o Python.

### DEC-GS-006 — Formulação do solver (normativa para a GS5)

Notação: pool = candidatos com `toApproved === (direction==='increase')`, indexados em
ordem canônica (sort por `id`, code unit UTF-16). Variáveis binárias `x_i`. Sinal
`σ = +1` (increase) / `−1` (decrease). Agregados baseline crus (`*0`) vêm de
`baselineRaw` do catálogo.

- **Precedência**: para cada `j ∈ requires(i)` presente no pool: `x_i ≤ x_j`.
  (Requires fora do pool = vácuo, igual ao greedy.)
- **Expressões lineares dos agregados pós-escolha**:
  `A = approvedQty0 + σ·Σ x_i·qty_i` · `D = decidedQty0 + σ·Σ_{i∈lens} x_i·qty_i` ·
  `QA = qtdAltasSum0 + σ·Σ x_i·qtdAltas_i` · `QI = qtdAltasInferSum0 + σ·Σ x_i·qtdAltasInfer_i` ·
  `IR = inadRealSum0 + σ·Σ x_i·inadRRaw_i` · `II = inadInferidaSum0 + σ·Σ x_i·inadIRaw_i`.
- **Tetos (invioláveis, linearizados por multiplicação cruzada)**:
  `maxInadReal`: `IR ≤ maxInadReal · QA`. `maxInadInf`: `II ≤ maxInadInf · QI` se
  `qtdAltasInferSum0 > 0`, senão `II ≤ maxInadInf · A` (mesma regra de fallback do
  `goalSeekRatios`).
- **Alvo como razão** (`approvalRate = A/D`, `inadReal = IR/QA`, `inadInferida = II/QI`
  com fallback `II/A`, `approvedAltasInfer = QI` — este último já é linear):
  - **Magnitude declarada** (`magnitude != null`): alvo vira RESTRIÇÃO linearizada
    (ex.: increase de approvalRate em m pp sobre baseline b: `A ≥ (b+m)/100 · D`) e o
    objetivo do MILP é **minimizar o colateral** (numerador colateral `collQty`,
    fracionário resolvido por Dinkelbach — abaixo). Infactível ⇒ relaxação: resolver o
    estágio "máximo possível" e reportar `goalReached:false` + `bindingConstraint`
    derivado (teto ativo na solução ótima, senão `no_more_moves`).
  - **Magnitude null (máximo/mínimo possível)**: objetivo fracionário
    `max σ'·(num/den)` resolvido por **iteração de Dinkelbach**: resolver
    `max σ'·(num − λ·den)` com `λ₀ = razão baseline`; atualizar `λ ← num(x*)/den(x*)`;
    repetir até `|Δλ| ≤ 1e-12` ou 10 iterações (determinístico; converge
    monotonicamente). Depois, **estágio 2 lexicográfico**: fixar
    `num − λ*·den ≥ (valor ótimo) − 1e-9·|valor ótimo|` e minimizar o colateral
    (novamente Dinkelbach se o colateral for razão; linear direto se for `approval`/
    `salesVolume` em quantidade).
- **Fronteira ótima (2D)**: `frontierPoints` (default 13) níveis equiespaçados do alvo
  entre o baseline e o ótimo do estágio 1; para cada nível, resolver "alvo ≥ nível +
  min colateral". Cada ponto devolve `{level, ids, predicted:{approvalRate, inadReal,
  inadInferida, approvedQty, decidedQty}}` calculados das expressões lineares (exatos
  dado o catálogo — mesma classe de exatidão do delta O(1) do greedy).
- **Fronteira "3D"**: quando o usuário NÃO declarou teto de inad inferida, o solver
  repete a fronteira 2D para uma grade de 4 tetos de `inadInferida`
  (`{baseline·1.0, ·1.1, ·1.25, ·1.5}`) ⇒ família de curvas. **Renderização: séries num
  gráfico 2D Recharts** (aprovação × inad real, uma linha por teto de inad inferida) —
  decisão explícita: NADA de gráfico 3D real (Recharts não tem; um scatter 3D não é
  legível). Com teto declarado pelo usuário, só a curva dele é computada.
- **Solver**: `scipy.optimize.milp` (HiGHS). Opções fixas: single-thread,
  `mip_rel_gap=0`, `time_limit = params.timeLimitSec` (default 20s) **por subproblema**;
  estouro de tempo ⇒ melhor solução incumbente com `status:'time_limit'` (a UI declara
  "ótimo não provado"). Sem solução factível ⇒ `status:'infeasible'` (⇒ fallback
  greedy declara gargalo).

### DEC-GS-007 — Validação single-sourced no worker

`COMPUTE_GOAL_SEEK_VALIDATE` (worker) recebe `{shapes, conns, goal, constraints,
moveIds, catalogToken, frontier}`:

- O worker **regenera o catálogo** (`buildGoalSeekCandidates` com os MESMOS params do
  `COMPUTE_GOAL_SEEK_CATALOG` — `catalogToken` é um token opaco ecoado que a main
  guarda do passo 1; se shapes/conns mudaram no meio tempo, o token não bate e o worker
  responde `{error:'stale'}` ⇒ a main reinicia o fluxo). Isso evita mandar o catálogo
  inteiro de volta e garante que os `apply` materializados são os canônicos.
- Aplica as invariantes da DEC-GS-001 (existência, precedência, travas, tetos).
- Materializa `applyGoalSeekMoves` + `runSimulation` ⇒ monta `GOAL_SEEK_RESULT` no
  **formato exato de hoje** (`{goal, baseline, frontier, moves, goalReached,
  bindingConstraint, result}`), com `moves` na ordem do greedy-score (DEC-GS-003) para
  exibição, cada um com `deltaApprovalRate` derivado dos agregados e `stats`
  (DEC-GS-004). `frontier` = pontos preditos do sidecar (formato do frontier atual,
  campo extra `predicted:true`).
- **Pool H3**: além do cenário escolhido, valida por re-simulação os pontos EXTREMOS da
  fronteira (primeiro/último) em paralelo via `runValidationJobsVia` — barato e pega
  divergência grosseira entre predição linear e realidade (divergência > 0.1pp em
  qualquer um ⇒ trata como violação de invariante ⇒ fallback). Os pontos intermediários
  permanecem preditos (declarado no gráfico com legenda "fronteira prevista").

### DEC-GS-008 — Escadas de limiar de lens

`buildGoalSeekCandidates(shapes, conns, csvStore, lensPopulations, lockedIds,
maxLensSteps=1)`:

- `maxLensSteps=1` (default): comportamento IDÊNTICO ao atual (1 relax + 1 tighten).
  Todos os call sites existentes não passam o parâmetro ⇒ zero mudança.
- `maxLensSteps=N` (usado só pelo `COMPUTE_GOAL_SEEK_CATALOG`, N=12): gera até N
  candidatos `relax` encadeados (`lens:{id}:relax:1..N`, cada degrau `k` com
  `requires:[degrau k−1]` — abrir o degrau 3 exige os degraus 1 e 2 por
  transitividade) e simetricamente até N `tighten`. Agregados de cada degrau saem do
  MESMO `computeGoalSeekArrivals` por valor bruto já existente (`lensColArrivals`) — só
  muda o loop que hoje para no primeiro valor. `apply` de cada degrau =
  `{type:'lens_threshold', shapeId, ruleIndex:0, newValue}` com o limiar cumulativo do
  degrau (aplicar SÓ o movimento do degrau k já admite os valores dos degraus 1..k —
  por isso a validação materializa apenas o degrau MAIS PROFUNDO escolhido por lens:
  `applyGoalSeekMoves` recebe, dos movimentos de escada de um mesmo lens, somente o de
  maior k; a regra fica declarada no handler do VALIDATE).
- Ids retrocompat: com `maxLensSteps=1` os ids continuam `lens:{id}:relax` (sem sufixo
  numérico) — o GATE atual não muda.

### DEC-GS-009 — Determinismo e GATEs do solver

- HiGHS com opções fixas (DEC-GS-006); entrada canonicalizada (candidatos ordenados por
  `id` UTF-16; floats serializados como vieram do JS — JSON round-trip é exato para
  float64).
- **`tests_python/test_goal_seek.py`**: fixtures de catálogo pequenas e commitadas
  (JSON, geradas manualmente na sessão GS5, NÃO derivadas do motor JS) com solução
  ótima verificável à mão: (1) knapsack com precedência onde o greedy comprovadamente
  erra (o caso "movimento caro destrava dois baratos") ⇒ MILP acha o ótimo; (2) teto
  linearizado respeitado exatamente na borda; (3) Dinkelbach converge para a razão
  correta em fixture com lens (denominador variável); (4) fronteira monótona no alvo;
  (5) determinismo (duas execuções idênticas); (6) `infeasible`/`time_limit` reportados.
- **`tests/goalSeek.test.js` (adições, JS)**: escadas de lens (agregado do degrau k ≡
  re-simulação do limiar cumulativo; `requires` encadeado); invariantes do VALIDATE
  (solução com precedência violada/nó travado/teto estourado ⇒ `{error}` e nunca
  resultado); token stale; dominância (dado um "sidecar mock" que devolve uma solução
  válida melhor que o greedy, o resultado exibido bate com a re-simulação dela).
- **`tests/computeRouter.test.js` (adições)**: `goal_seek_deep` é Classe B; job sem
  datasetId; queda ⇒ fallback.

### DEC-GS-010 — Gating e UX do modo profundo

- `sidecar.py`: task `goal_seek_deep` entra em `capabilities.tasks` **somente** quando
  o warm-up confirma numpy+scipy E `scipy.optimize.milp` importa (guard explícito —
  scipy < 1.9 não tem `milp`). Tier stdlib/loading ⇒ task ausente ⇒ POST /jobs com ela
  = 400 (padrão H7).
- Formulário do Goal Seek ganha uma linha de modo (sem toggle manual — decisão: o modo
  é AUTOMÁTICO): badge `⚡ Busca ótima (Motor Python)` quando
  `router.canRouteToSidecar('goal_seek_deep')`, senão `ComputeCeilingNotice`
  ("Busca gulosa no navegador — ligue o Motor Python para a busca ótima e a fronteira
  completa") com o botão "🐍 Ligar Motor Python" (mesmo padrão DEC-HX-009 do wizard).
- `step:'loading'` do modo profundo usa `ComputeJobProgress` (fases: catálogo →
  otimização → validação) + cancelamento (AbortController). Greedy continua com o
  texto simples atual.
- Resultado profundo: mesma tela de resultado atual + gráfico da fronteira (Recharts,
  série única com teto declarado; família de curvas sem teto — DEC-GS-006) + rodapé
  declarando o executor (`⚡ ótimo (Motor Python)` / `⚙ guloso (navegador)` /
  `fallbackNotice` quando caiu no meio).

---

## Protocolo de mensagens (novas/estendidas)

| type (entrada worker) | payload | resposta |
|---|---|---|
| `COMPUTE_GOAL_SEEK_CONTEXT` | `{shapes, conns}` | `GOAL_SEEK_CONTEXT_RESULT` `{baseline, asis}` — ambos `{approvalRate, inadReal, inadInferida, approvedQty, decidedQty}` escopados; `asis: null` sem `__DECISAO_ORIGINAL` |
| `COMPUTE_GOAL_SEEK` | inalterado + `goal.minimize` aceita os 4 valores (DEC-GS-003) | `GOAL_SEEK_RESULT` inalterado + `moves[i].stats` (DEC-GS-004) |
| `COMPUTE_GOAL_SEEK_CATALOG` | `{shapes, conns, locks, maxLensSteps}` | `GOAL_SEEK_CATALOG_RESULT` `{catalogToken, baselineRaw, candidates}` (candidates = mesmos campos do pool interno: `{id, type, shapeId, label, toApproved, qty, qtdAltas, qtdAltasInfer, inadRRaw, inadIRaw, requires, apply}`) |
| `COMPUTE_GOAL_SEEK_VALIDATE` | `{shapes, conns, goal, constraints, locks, moveIds, catalogToken, frontier}` | `GOAL_SEEK_RESULT` (formato atual) ou `{error:'stale'\|'invalid_solution', detail}` |

Task do sidecar: `goal_seek_deep` — params `{catalog:{baselineRaw, candidates},
goal, constraints, frontierPoints=13, timeLimitSec=20}` ⇒ result `{solution:{ids,
predicted}, frontier:[{level, ids, predicted}], curves?:[{maxInadInf, frontier}],
status:'optimal'|'time_limit'|'infeasible'}`.

`catalogToken` = hash FNV-1a (reusar `hashChunks`-style, mas sobre a string
canônica `JSON.stringify` de `{shapes, conns, locks, maxLensSteps,
csvStoreVersion}`) — barato, detecta staleness, opaco para a main.

---

## Sessões

### Sessão GS1 — Cards "Ponto de partida" no modal 🏷️ [SONNET]

**Documentação**: esta página (DEC-GS-002) · CLAUDE.md ("Motor de Goal Seek", "Taxa de
aprovação escopada").

**Pré-requisitos**: nenhum. Executável isoladamente; funciona com o motor desligado.

**O que vai entregar**:
- `computeGoalSeekBaseline` estendido para acumular também os agregados AS IS no mesmo
  walk/escopo (sem passe extra pela base) — assinatura retrocompatível (os campos AS IS
  são adicionais no retorno; call sites atuais não mudam)
- Mensagens `COMPUTE_GOAL_SEEK_CONTEXT` / `GOAL_SEEK_CONTEXT_RESULT`
- Seção `📍 Ponto de partida` no `step:'form'` do `goalSeekModal`: 3 cards com valor
  grande (política atual) + linha AS IS/Δ, skeleton enquanto carrega, tooltip do
  escopo, degradação "AS IS não configurado"
- GATE: caso novo em `tests/goalSeek.test.js` — agregados AS IS do contexto ≡
  agregação manual via `__DECISAO_ORIGINAL` sobre as linhas decididas da fixture;
  fixture sem AS IS ⇒ `asis:null`

**Prompt**:
```
Vamos à Sessão GS1 do épico Goal Seek Profundo, conforme
docs/wiki/Hibrido-GoalSeek-Profundo.md (leia a página INTEIRA antes — em especial
DEC-GS-002, que é normativa: nomes, layout, escopo dos números e degradações estão
decididos lá; não redecida nada). Estenda computeGoalSeekBaseline
(src/simulation.worker.js) para acumular os agregados AS IS na mesma varredura
(linhas com res != null, lendo __DECISAO_ORIGINAL), adicione o par de mensagens
COMPUTE_GOAL_SEEK_CONTEXT/GOAL_SEEK_CONTEXT_RESULT e renderize a seção "📍 Ponto de
partida" no step 'form' do goalSeekModal (src/App.jsx, ~linha 14050) com 3 cards
conforme o mock da DEC-GS-002 (valor grande = política atual escopada a decidedQty;
linha pequena = AS IS + delta colorido por GOOD_WHEN_LOWER; skeleton até a resposta;
"AS IS não configurado" quando asis é null; tooltip ⓘ explicando o escopo).
openGoalSeekModal dispara a mensagem. Nenhuma outra matemática muda — npm test
inalterado + o caso novo de GATE descrito na sessão. Releia o CLAUDE.md e o código
antes de propor.
```

---

### Sessão GS2 — "Minimizar colateralmente" generalizado 🏷️ [OPUS]

**Documentação**: esta página (DEC-GS-003).

**Pré-requisitos**: nenhum (independe da GS1). Funciona com o motor desligado.

**O que vai entregar**:
- Score generalizado `(collQty + collPoolAvg·K)/(tgtQty + tgtPoolAvg·K)` substituindo
  `smoothed()` em `computeGoalSeek`, com as tabelas de `collQty`/`tgtQty` da
  DEC-GS-003, desempate por `qty` desc + `id` asc (code unit UTF-16)
- `goal.minimize` aceitando `'approval'`/`'salesVolume'` (payload retrocompatível)
- `<select>` do form com as 4 opções, escondendo a colisão com o alvo + reset
- GATE (casos novos em `tests/goalSeek.test.js`): (1) com `minimize:'approval'` e alvo
  de reduzir inad, a proposta move MENOS volume de propostas que com
  `minimize:'inadInferida'` para o mesmo alvo em fixture construída para isso; (2) com
  `minimize:'salesVolume'`, idem para qtdAltasInfer movida; (3) determinismo; (4) os
  casos EXISTENTES do GATE continuam passando (a redução ao comportamento atual da
  DEC-GS-003 é verificada — se algum caso existente quebrar por diferença de
  ordenação, o caso deve ser analisado à mão e o esperado atualizado SÓ se a nova
  ordenação for comprovadamente a semântica da DEC-GS-003, documentando no commit)

**Prompt**:
```
Vamos à Sessão GS2 do épico Goal Seek Profundo, conforme
docs/wiki/Hibrido-GoalSeek-Profundo.md (leia a página inteira; DEC-GS-003 é
normativa — as tabelas de collQty/tgtQty, a fórmula do score com shrinkage e as
regras de desempate estão decididas lá). Em src/simulation.worker.js, generalize o
critério de ordenação de computeGoalSeek substituindo smoothed() pelo score da
DEC-GS-003 (leia o código atual em ~linha 2426 antes); aceite
minimize ∈ {inadInferida, inadReal, approval, salesVolume} com retrocompat. Em
src/App.jsx, atualize o select "Minimizar colateralmente" (~linha 14085) com as 4
opções, escondendo a que colide com o alvo e resetando na colisão. Esta é a ÚNICA
sessão do épico autorizada a mudar matemática do greedy — cubra com os 4 casos de
GATE descritos na sessão GS2 da wiki e rode npm test completo. Releia o CLAUDE.md
e tests/goalSeek.test.js antes de propor.
```

---

### Sessão GS3 — Selos estatísticos por movimento 🏷️ [SONNET]

**Documentação**: esta página (DEC-GS-004).

**Pré-requisitos**: nenhum (independe de GS1/GS2). Funciona com o motor desligado.

**O que vai entregar**:
- `wilsonCI(k, n, z=1.96)` no worker (exportado para teste), campo `stats` em cada
  `move` do `GOAL_SEEK_RESULT` (fórmulas e campos exatos na DEC-GS-004; `pValue` reusa
  `segBinomTwoSided` já existente no worker; `GOAL_SEEK_MIN_SAMPLE = 30`)
- Badges nos cards de movimento do `step:'result'`: `⚠ amostra frágil` (âmbar) /
  `IC95 x–y%` (cinza discreto), tooltip com n e p-value
- GATE: `wilsonCI` contra 3 valores de referência calculados à mão (ex.: k=8,n=30 ⇒
  IC95 ≈ [0.142, 0.448]); `stats.fragile` liga exatamente em n<30; `stats` presente em
  todo move; nenhum número da busca muda (asserts existentes intactos)

**Prompt**:
```
Vamos à Sessão GS3 do épico Goal Seek Profundo, conforme
docs/wiki/Hibrido-GoalSeek-Profundo.md (DEC-GS-004 é normativa: campos, fórmula de
Wilson, piso de 30 e comportamento da UI estão decididos lá — os selos informam,
nunca reordenam nem filtram a busca). Adicione wilsonCI ao worker, anexe
moves[i].stats no retorno de computeGoalSeek reusando segBinomTwoSided, e renderize
os badges nos cards de movimento do step 'result' do goalSeekModal em src/App.jsx.
Nenhuma mudança de ordenação/matemática da busca — npm test inalterado + os casos
novos de GATE da sessão GS3 da wiki. Releia o CLAUDE.md e o código antes de propor.
```

---

### Sessão GS4 — Catálogo profundo + validação no worker 🏷️ [OPUS]

**Documentação**: esta página (DEC-GS-005/007/008) + CLAUDE.md ("Pool de Workers H3").

**Pré-requisitos**: GS2 (score generalizado é usado na ordenação de exibição do
VALIDATE). GS1/GS3 recomendadas antes, não obrigatórias.

**O que vai entregar** (100% worker/JS — nada de Python nesta sessão):
- `buildGoalSeekCandidates` com `maxLensSteps` (DEC-GS-008): escadas relax/tighten
  encadeadas por `requires`, ids retrocompatíveis no default 1
- Mensagens `COMPUTE_GOAL_SEEK_CATALOG` / `GOAL_SEEK_CATALOG_RESULT` (com
  `catalogToken`) e `COMPUTE_GOAL_SEEK_VALIDATE` / resposta (DEC-GS-007): regeneração
  por token, invariantes DEC-GS-001 (existência/precedência/travas/tetos), regra do
  "degrau mais profundo por lens" na materialização, re-simulação do cenário + extremos
  da fronteira via pool H3 (`runValidationJobsVia`), montagem do `GOAL_SEEK_RESULT` no
  formato atual
- GATE (casos novos em `tests/goalSeek.test.js`, listados na DEC-GS-009 bloco JS):
  escadas ≡ re-simulação; invariantes rejeitam solução inválida; token stale;
  dominância com sidecar mock

**Prompt**:
```
Vamos à Sessão GS4 do épico Goal Seek Profundo, conforme
docs/wiki/Hibrido-GoalSeek-Profundo.md (DEC-GS-005, DEC-GS-007 e DEC-GS-008 são
normativas — fluxo, payloads, token, invariantes e a regra do degrau mais profundo
estão decididos lá; o Protocolo de mensagens da página define os contratos exatos).
Trabalhe SÓ em src/simulation.worker.js (+ testes): maxLensSteps em
buildGoalSeekCandidates com retrocompat total no default 1; handlers
COMPUTE_GOAL_SEEK_CATALOG e COMPUTE_GOAL_SEEK_VALIDATE conforme especificado,
reusando applyGoalSeekMoves, runSimulation, runValidationJobsVia (pool H3) e o
score da GS2 para ordenar a exibição. Nenhuma mudança nos caminhos existentes —
npm test inalterado + os casos de GATE do bloco JS da DEC-GS-009. Releia o
CLAUDE.md (seções Goal Seek e Pool de Workers H3) e o código antes de propor.
```

---

### Sessão GS5 — Solver MILP no sidecar (`motor_goalseek.py`) 🏷️ [OPUS]

**Documentação**: esta página (DEC-GS-006/009) + CLAUDE.md ("Sidecar Python H5").

**Pré-requisitos**: GS4 (define o formato do catálogo que o solver consome). Sidecar
H5 entregue (já está).

**O que vai entregar** (100% Python — nada de front nesta sessão):
- `release/python/motor_goalseek.py`: task `goal_seek_deep` conforme DEC-GS-006 —
  MILP binário (scipy.optimize.milp/HiGHS, opções fixas), precedência, tetos
  linearizados, Dinkelbach para objetivos fracionários, lexicográfico em 2 estágios,
  fronteira por grade (`frontierPoints`) e família de curvas por teto de inad inferida
  quando o usuário não declarou teto; progresso reportado por subproblema resolvido
- `release/sidecar.py`: registro lazy da task, gate de capabilities por
  `scipy.optimize.milp` importável (tier full não basta — guard explícito), 400 fora
  do tier
- `tests_python/test_goal_seek.py`: os 6 grupos de teste da DEC-GS-009 (fixtures de
  catálogo commitadas com ótimo verificável à mão — inclua a fixture "greedy erra,
  MILP acerta")
- `.github/workflows/test-sidecar.yml`: incluir os paths novos no gatilho

**Prompt**:
```
Vamos à Sessão GS5 do épico Goal Seek Profundo, conforme
docs/wiki/Hibrido-GoalSeek-Profundo.md (DEC-GS-006 é a especificação normativa do
solver — formulação, linearizações, Dinkelbach, lexicográfico, grade da fronteira,
família de curvas e opções do HiGHS estão decididos lá; DEC-GS-009 define os
testes). Implemente release/python/motor_goalseek.py (task goal_seek_deep,
carregada lazy pelo sidecar.py como o motor_segmentos.py), o gate de capabilities
por scipy.optimize.milp importável, e tests_python/test_goal_seek.py com fixtures
de catálogo commitadas e ótimo verificável à mão — obrigatoriamente incluindo o
caso em que o greedy erra e o MILP acha o ótimo (movimento caro que destrava dois
baratos via requires). Nada de front nem de worker nesta sessão. Não há paridade
numérica com JS a garantir (DEC-GS-001) — o contrato é o formato do result e o
determinismo Python. Releia o CLAUDE.md (Sidecar H5, Descoberta Profunda H7 como
referência de estilo) e release/python/motor_segmentos.py antes de propor.
```

---

### Sessão GS6 — Costura do front: roteamento, fronteira e degradação declarada 🏷️ [SONNET]

**Documentação**: esta página (DEC-GS-001/005/010) + CLAUDE.md ("ComputeRouter H4",
"UX do Motor Python H6", "Descoberta Profunda H7" — o molde de costura é o da H7).

**Pré-requisitos**: GS4 + GS5.

**O que vai entregar**:
- `goal_seek_deep` na tabela `TASK_CLASS` (Classe B) do `src/computeRouter.js`; job
  SEM dataset (sem registerDataset — DEC-GS-005)
- `runGoalSeek` bifurcado: modo profundo automático quando
  `router.canRouteToSidecar('goal_seek_deep')` — fluxo
  CATALOG → router.run → VALIDATE da DEC-GS-005, com `ComputeJobProgress` (3 fases),
  AbortController (abort não dispara fallback) e fallback transparente para
  `COMPUTE_GOAL_SEEK` + `fallbackNotice` em qualquer queda/invariante violada/`stale`
- Form: badge `⚡ Busca ótima (Motor Python)` / `ComputeCeilingNotice` + botão "🐍
  Ligar Motor Python" (DEC-GS-010)
- Resultado: gráfico da fronteira (Recharts; série única ou família de curvas conforme
  DEC-GS-006), legenda "fronteira prevista", rodapé com o executor
- GATE: adições em `tests/computeRouter.test.js` (Classe B, job sem datasetId, queda ⇒
  fallback) — a lógica de invariantes já foi testada na GS4

**Prompt**:
```
Vamos à Sessão GS6 do épico Goal Seek Profundo, conforme
docs/wiki/Hibrido-GoalSeek-Profundo.md (DEC-GS-005 define o fluxo de 3 passos,
DEC-GS-010 a UX; o molde de costura é a Descoberta Profunda H7 — releia
runSegmentDiscovery em src/App.jsx e a seção H7 do CLAUDE.md antes). Adicione
goal_seek_deep como Classe B em src/computeRouter.js (job self-contained, SEM
registerDataset), bifurque runGoalSeek para o fluxo
COMPUTE_GOAL_SEEK_CATALOG → router.run('goal_seek_deep') → COMPUTE_GOAL_SEEK_VALIDATE
com progresso, cancelamento e fallback transparente ao greedy (fallbackNotice;
abort não dispara fallback), adicione o badge/ceiling notice no form e o gráfico
de fronteira Recharts no resultado (série única com teto declarado; família de
curvas por teto de inad inferida sem teto — nunca gráfico 3D). Reuse
ComputeJobProgress, ComputeCeilingNotice, fallbackNoticeText e o padrão dataviz
existente do Dashboard. GATE: casos novos em tests/computeRouter.test.js; npm test
inalterado. Releia o CLAUDE.md antes de propor.
```

---

### Sessão GS7 — Sincronização documental 🏷️ [HAIKU]

**Documentação**: CLAUDE.md · [[Copiloto-SugestoesMelhoria]] · [[Decisoes]] ·
[[Roadmap]] · [[_Sidebar]].

**Pré-requisitos**: GS1–GS6 entregues (ou o subconjunto que tiver sido entregue —
documentar só o que existe).

**O que vai entregar**:
- CLAUDE.md: atualizar a seção "Motor de Goal Seek" (mensagens novas, `minimize`
  generalizado, `stats`, modo profundo, tabela do protocolo do worker) e a tabela de
  mensagens do worker
- [[Copiloto-SugestoesMelhoria]]: marcar a pendência "add_break/busca melhor" e
  registrar o modo profundo
- [[Decisoes]]: registrar DEC-GS-001..010 (uma linha cada, apontando para esta página)
- [[Roadmap]]: marcar "Fronteira Pareto multi-dimensional" como entregue (via família
  de curvas)

**Prompt**:
```
Vamos à Sessão GS7 do épico Goal Seek Profundo (sincronização documental), conforme
docs/wiki/Hibrido-GoalSeek-Profundo.md. Compare o que foi ENTREGUE nas sessões
GS1–GS6 (leia o código atual — não documente o que não existe) e atualize: a seção
"Motor de Goal Seek" e a tabela de mensagens do worker no CLAUDE.md;
docs/wiki/Copiloto-SugestoesMelhoria.md; docs/wiki/Decisoes.md (DEC-GS-001..010, uma
linha cada com link); docs/wiki/Roadmap.md. Só documentação — nenhuma linha de
código. Seja fiel ao código, não a esta wiki, onde divergirem (e liste as
divergências encontradas no resumo).
```

---

## Fora de escopo deste épico (registrado para não redescobrir)

- **Bootstrap/IC do resultado agregado no sidecar** — extra futuro (nunca no browser).
- **Candidatos novos no catálogo além das escadas de lens** (lens multi-regra,
  segmentos que resolvem em AS IS, `add_break` gerado pela própria busca) — o desenho
  DEC-GS-005 já os comporta (qualquer candidato com agregados + `requires` + `apply`
  entra no MILP de graça); a geração deles é trabalho de catálogo (worker), sessão
  futura.
- **Alinhar o denominador do SimPanel ao escopo decidido** — follow-up já registrado na
  seção do Goal Seek do CLAUDE.md, não é deste épico.
- **Duplicar o motor de simulação em Python (H9)** — explicitamente evitado pela
  DEC-GS-005.
