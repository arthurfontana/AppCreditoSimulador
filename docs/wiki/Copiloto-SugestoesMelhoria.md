# Copiloto — Frente 2: Sugestões Inteligentes de Melhoria (Goal Seek)

> Parte do épico [[Epicos-CopilotoIA|Copiloto de Política de Crédito]] (ler primeiro:
> arquitetura em camadas, PolicyIR, DEC-IA-001..006, contrato anti-alucinação).
>
> **Status:** Sessão 4 (Goal Seek) ✅ ENTREGUE — Sessão 5 (Simplificação) ✅ ENTREGUE —
> GS1–GS6 (Goal Seek Profundo: MILP via sidecar Python) ✅ ENTREGUE.

## Sessão 5 — como foi entregue

`COMPUTE_SIMPLIFY` (worker, `src/simulation.worker.js`) generaliza o padrão de detecção
estrutural da Sessão 1 (`computePolicyInsights`) para **propor** uma política reduzida —
não só apontar o achado, mas religar o roteamento e **provar** que a redução não muda
nenhuma decisão. Catálogo de candidatos (`detectSimplifyCandidates`), cada um com um
`apply` mínimo materializável por `applySimplifyCandidates` (**`src/policySimplify.js`**,
módulo compartilhado worker/main no mesmo padrão de `src/goalSeek.js`):

- **`collapsible_node`**: losango cujos valores TODOS roteiam pro mesmo destino final
  (via `resolveThroughPortsSimplify`, mesma semântica de `resolveThroughPorts` do
  PolicyIR); Cineminha cujos ports Elegível/Não Elegível vão pro mesmo destino; ou
  Decision Lens cuja regra deixa passar 100% do volume que chega (`lens_no_effect` usa o
  MESMO `apply` — colapsa pro próprio destino). Aplicação religa as arestas de ENTRADA
  direto pro destino e remove o nó + portas próprias.
- **`zero_arrival_node`**: losango/Cineminha/Decision Lens que nunca recebe volume na
  base atual (losango/Cineminha via `nodeArrivals` do tick; lens via `computeLensStats`,
  um walk dedicado — `nodeArrivals` não cobre lens). Poda o nó + descendentes
  EXCLUSIVOS (sem outra entrada externa sobrevivente, ponto fixo iterativo).
- **`redundant_variable`**: losango D2 que retesta a MESMA coluna+csv já decidida por um
  losango D1 a montante, alcançado por uma cadeia DIRETA de ports a partir de um valor
  fixo — quem chega aqui já tem coluna==valor, então D2 só pode discriminar o próprio
  ramo desse valor. Religa só a aresta específica (`reroute_edge`) pro destino que D2
  daria pra esse valor, sem remover D2 (outros caminhos podem alcançá-lo).

**Prova de equivalência** (`computeSimplifyEquivalence`): compara o **desfecho por linha**
de duas políticas via `computeRowOutcomes` (mesma classificação de `runSimulation`, incl.
fallback de AS IS) — `identical` só é `true` com `diffCount === 0` (agregados podem
empatar com decisões trocadas por baixo; só o diff linha a linha prova de verdade). Cada
candidato é validado **incrementalmente** (greedy, contra o estado já aceito); por
transitividade de igualdade linha a linha, a proposta final inteira é `diff = 0` contra a
política original **por construção**, mesmo que um detector individual não seja perfeito
(um candidato que quebra equivalência com o que já foi aceito é descartado, nunca
contamina a proposta). Quando não é possível zerar o diff, o delta reportado vem de
`runSimulation` antes/depois de verdade — nunca estimado (DEC-IA-005, mesmo contrato do
Goal Seek).

UI: `simplifyModal` (padrão do épico, mas sem etapa de formulário — não há objetivo a
declarar) — botão **🧹 Simplificar** na seção Fluxo do painel direito dispara
`COMPUTE_SIMPLIFY` direto; resultado lista as simplificações propostas (ícone + rótulo por
tipo) e a prova (✅ idêntica / ⚠ delta declarado); **✓ Aplicar como novo cenário**
materializa via `cloneCanvasWithNewIds` + `applySimplifyCandidates` (mesmo padrão
não-destrutivo do Goal Seek — a política de origem fica intocada).

GATE `tests/policySimplify.test.js`: nó colapsável (losango e Cineminha) ⇒ proposta reduz
e `computeSimplifyEquivalence` prova diff = 0; nó com chegada zero ⇒ removível sem alterar
nenhuma decisão; regra de lens sem efeito e variável re-testada ⇒ detectados e colapsados
sem perda; prova de equivalência **lossy** (par de canvases deliberadamente diferente,
testando a primitiva direto) ⇒ diffCount e delta batem com o cálculo manual via
`runSimulation` antes/depois; determinismo (mesma entrada ⇒ mesma proposta).

## Sessões GS1–GS6 — Goal Seek Profundo (MILP via sidecar Python) — como foi entregue

Épico completo documentado em [[Hibrido-GoalSeek-Profundo]] (DEC-GS-001..010). Estende o
Goal Seek clássico (Sessão 4) com otimização MILP via sidecar Python (`scipy.optimize.milp`,
solver HiGHS), mantendo **paridade de contrato** (não numérica — DEC-GS-001): greedy e MILP
são escolhas distintas, sem GATE dourado cross-runtime. O modo profundo é transparente ao
usuário (ativado automaticamente quando `goal_seek_deep` aparece nas capabilities do sidecar)
e com fallback silencioso ao modo clássico em caso de queda.

### Fluxo de 3 passos (modo profundo)

```
COMPUTE_GOAL_SEEK_CATALOG         — worker, Classe A
      ↓ GOAL_SEEK_CATALOG_RESULT
  goal_seek_deep                  — sidecar Python (via sidecarProxyRef DIRETAMENTE,
      ↓ job result                  sem ComputeRouter — DEC-GS-001)
COMPUTE_GOAL_SEEK_VALIDATE        — worker, Classe A (valida + re-simula)
      ↓ GOAL_SEEK_RESULT          — mesmo tipo do modo clássico; carrega `via:'sidecar'`
                                    e `curves` (família de curvas)
```

O dataset **nunca** sai do browser (DEC-GS-005): só o catálogo de agregados (KBs) vai ao
sidecar. `goal_seek_deep` é chamado via `sidecarProxyRef.current.runJob()` diretamente —
não passa pelo `ComputeRouter` porque a task não tem gêmeo no worker (DEC-GS-001); o
fallback é explícito em código (`catch` → `runClassicGoalSeek()`).

### GS1 — Cards "Ponto de partida" (DEC-GS-002)

Ao abrir o `goalSeekModal`, `openGoalSeekModal` dispara `COMPUTE_GOAL_SEEK_CONTEXT`
assincronamente. O worker roda `computeGoalSeekContext` (reutiliza `computeGoalSeekBaseline`)
e responde com `GOAL_SEEK_CONTEXT_RESULT {baseline, asis}` — baseline escopado a
`decidedQty` + AS IS no mesmo escopo (`null` sem `__DECISAO_ORIGINAL`). A main armazena
em `goalSeekModal.context` e exibe 3 cards "📍 Ponto de partida" no formulário (só em
`step:'form'`). Elimina a ambiguidade de objetivos em políticas parciais (ex.: 72,8%
escopado vs. 3,35% na base inteira — ver seção "Taxa de aprovação escopada" no CLAUDE.md).

### GS2 — `goal.minimize` ampliado (DEC-GS-003)

`GOAL_SEEK_MINIMIZE_FIELDS` passa de 2 para 4 opções: `'inadInferida'|'inadReal'|'approval'|
'salesVolume'`. Fórmula de score do candidato:

```
score(c) = (collQty(c) + collPoolAvg · K) / (tgtQty(c) + tgtPoolAvg · K)
```

onde `collQty` é a quantidade colateral (ex.: `qtdAltas` para `minimize='inadReal'`) e
`tgtQty` é a quantidade alvo (ex.: `inadRealSum` para inad real, `qtdAltasSum` para
`salesVolume`). Usada tanto pelo greedy clássico quanto como função-objetivo colateral no
MILP do sidecar.

### GS3 — Selos estatísticos nos movimentos (DEC-GS-004)

Cada candidato do catálogo recebe:

```js
stats: {
  n: number,          // volume de altas (denominador da inad)
  rate: number,       // taxa observada
  ci95: {lower, upper} | null,  // IC 95% de Wilson via wilsonCI(k, n, z=1.96)
  pValue: number,     // teste binomial bilateral (segBinomTwoSided, padrão Descoberta)
  fragile: boolean,   // n < GOAL_SEEK_MIN_SAMPLE (30)
}
```

Exibido no card do movimento no `goalSeekModal`. `wilsonCI` (adicionada em
`simulation.worker.js`) retorna `null` para `n=0`.

### GS4 — Catálogo ampliado + escadas de lens + validação async (DEC-GS-005/007/008)

`buildGoalSeekCatalog` (substitui `buildGoalSeekCandidates` no caminho profundo) adiciona
**escadas de lens**: para cada Decision Lens de uma regra (`gte`/`gt`/`lte`/`lt`) elegível,
gera MÚLTIPLOS passos acumulados (até `GOAL_SEEK_DEEP_LENS_STEPS = 12` passos distintos
de maior impacto de qtd, via `selectDeepestLensSteps`). Isso permite ao solver MILP explorar
recortes de limiar que o greedy clássico não alcançaria em uma única busca.

`computeGoalSeekValidate` (async) recebe a proposta do sidecar e:
1. Verifica invariantes (DEC-GS-001): moves no catálogo, precedência, tetos não violados
2. Materializa via `selectDeepestLensSteps` + `applyGoalSeekMoves`
3. Re-simula com `runSimulation` (extremos da fronteira via pool H3 — mesmo padrão H3)
4. Responde com `GOAL_SEEK_RESULT` (reutiliza o tipo existente)

### GS5 — Task `goal_seek_deep` no sidecar Python (DEC-GS-006/009)

`release/sidecar.py` recebe o catálogo + goal + constraints e resolve via
`scipy.optimize.milp` (solver HiGHS):

- **Variáveis binárias**: uma por candidato (`x_i ∈ {0,1}`)
- **Restrições de precedência**: `x_i ≤ x_j` para `(i, j)` no grafo de precedência
- **Tetos linearizados**: `Σ inadIRaw_i · x_i ≤ maxInadInf · Σ (qtdAltasInfer_i · x_i)` (linearizado via big-M)
- **Objetivo lexicográfico em 2 etapas**: 1ª maximiza/minimiza o `target`; 2ª minimiza o `minimize` colateral
- **Família de curvas**: varre múltiplos valores de `maxInadInf` e devolve `curves: [{ceiling, frontier}]`

A task `goal_seek_deep` só aparece em `capabilities.tasks` no tier `full` (numpy+scipy
presentes); sem scipy o sidecar retorna 400 e o router cai no fallback. Sem GATE dourado
cross-runtime (paridade de contrato, não numérica — DEC-GS-001).

### GS6 — UX e roteamento automático (DEC-GS-001/010)

`goalSeekDeepOk()` (em `App.jsx`) retorna `true` quando:
- `computeSidecar.enabled`
- `computeSidecarStatus.available`
- `computeSidecarStatus.tasks.includes('goal_seek_deep')`

Sem toggle manual — o formulário apresenta o modo profundo de forma transparente. Quando
`GOAL_SEEK_RESULT` chega com `curves` preenchido, o `goalSeekModal` exibe o
`GoalSeekFrontierChart` (Recharts) como **família de curvas** por teto de inad.inf, em vez
da curva única do modo clássico. `fallbackNotice` (string) avisa discretamente quando houve
queda para o greedy. O campo `via:'sidecar'|'worker'` indica quem resolveu.

### O que NÃO mudou

- O modo clássico (Sessão 4 original) segue **inalterado**: `COMPUTE_GOAL_SEEK` →
  `computeGoalSeek` → `GOAL_SEEK_RESULT`. Sem sidecar disponível ou com `goal_seek_deep`
  ausente nas capabilities, o comportamento é exatamente o anterior.
- `applyGoalSeekResult` (aplicar como novo cenário) é o mesmo — `cloneCanvasWithNewIds` +
  `applyGoalSeekMoves` — independente do modo que gerou os moves.
- `tests/goalSeek.test.js` cobre o catálogo ampliado e `wilsonCI` sem exigir sidecar.

---

## Sessão 4 — como foi entregue

`COMPUTE_GOAL_SEEK` (worker, `src/simulation.worker.js`) generaliza o Johnny (célula de
Cineminha) para um **catálogo heterogêneo de movimentos**, cada um com agregados de
segmento conhecidos (mesma técnica de `computeCinemaArrivals`):

- **`cinema_cell`**: reusa `computeCinemaArrivals` — mesma mecânica do Johnny.
- **`decision_terminal`**: um VALOR de losango cujo port resolve **diretamente** (seguindo
  cadeias de port, como `resolveThroughPorts` do PolicyIR) a um terminal Aprovado/Reprovado
  — trocar esse terminal move o segmento inteiro sem ambiguidade. Segmentos que resolvem em
  AS IS ficam fora (o terminal depende de `__DECISAO_ORIGINAL` por linha, não é um destino
  único) — limitação documentada da Sessão 4.
- **`lens_threshold`**: um Decision Lens de **uma** regra (`gte`/`gt`/`lte`/`lt`) cujo único
  port de saída resolve direto a **Aprovado** — relaxa (admite o próximo valor que hoje
  falha) ou aperta (remove o valor mais próximo da fronteira que hoje passa) por **um
  passo** por execução. Lens com saída para Reprovado/AS IS ou com mais de uma regra ficam
  fora — catálogo extensível por design, mesmo precedente do "adicionar quebra" citado
  acima para uma sessão futura.

Busca: greedy com precedência + shrinkage bayesiano (`SHRINK_K`, padrão `computeJohnnyData`),
generalizando o pool de "células" do Johnny para candidatos heterogêneos com direção
(`toApproved`). Travas 🔒 (`shape.locked`, alternável na toolbar contextual de losango/
Cineminha/Decision Lens; ou a lista `locks` da mensagem) excluem candidatos do nó inteiro
antes da busca. Restrições de teto (`maxInadReal`/`maxInadInf`) são invioláveis — um
movimento que estouraria o teto nunca entra na proposta. Ao final (sucesso ou parcial), os
movimentos aceitos são materializados de verdade (`applyGoalSeekMoves`, `src/goalSeek.js` —
módulo compartilhado entre worker e main, já que não se importam entre si) e
**re-simulados** (`runSimulation`) — nenhum número exibido tem origem só no delta
incremental interno da busca (DEC-IA-005).

UI: `goalSeekModal` (padrão `johnnyModal`) — formulário de objetivo estruturado (alvo:
`approvalRate`/`inadReal`/`inadInferida`/`approvedAltasInfer`; direção; magnitude; tetos)
→ fronteira (trajetória da taxa de aprovação) + lista de movimentos ranqueados → **Aplicar
como novo cenário** via `cloneCanvasWithNewIds` (que passou a expor também `idMap`,
usado para traduzir `shapeId`/`connId` dos movimentos para os IDs do canvas clonado) +
`applyGoalSeekMoves`. Botão **🎯 Atingir Objetivo** na seção Fluxo do painel direito.

GATE `tests/goalSeek.test.js`: delta O(1) por movimento ≡ re-simulação completa (para os
três tipos do catálogo), monotonicidade ordinal (precedência, inclusive quando o segmento
mais barato NÃO é o primeiro do domínio), nenhum ponto da fronteira viola teto/trava,
objetivo inatingível reporta o melhor parcial + a restrição-gargalo, e determinismo.

## Contexto

O simulador **já contém um motor de recomendação orientado a objetivo**, mas restrito
a células de Cineminha: `computeCellMetrics` + `buildParetoFrontier` +
`extractScenarios` (single, `optimModal`) e `computeJohnnyData` (multi-cineminha,
greedy com grafo de precedência, cascata entre níveis de risco e suavização bayesiana
`SHRINK_K`). O usuário já navega uma fronteira aprovação × inadimplência com sliders
e cenários prontos (Conservador/Balanceado/Melhor Eficiência/Expansão) e aplica de
forma não-destrutiva. O que **não** existe: (a) otimização no nível da **política
inteira** (losangos, terminais, lens — não só células), (b) declaração de **objetivo
com restrições** ("+2pp de aprovação, inad inferida ≤ X"), (c) movimentos além de
abrir/fechar célula, (d) **simplificação** com prova de equivalência. O
`incrementalResult` (AS IS vs simulado, rToA/aToR) e o multi-canvas + KPI A vs B já
dão a régua de validação de qualquer proposta.

## Impacto no negócio

- Transforma a pergunta central do negócio ("como ganho X pp de aprovação pagando o mínimo de inad?") em operação de um clique, com resposta **simulada, não estimada**.
- Cada proposta vem com o delta exato (aprovação, inad real, inad inferida, volume impactado, rToA/aToR) — defensável em comitê de crédito.
- Simplificação reduz custo operacional (menos regras/consultas) com **prova** de que a política resultante decide idêntico (ou com delta declarado).
- Propostas materializam como **cenários** (abas de canvas) — o processo de aprovação interna já existente (Dashboard, KPI A vs B, export CSV) valida a mudança.

## Objetivo

Um **Goal Seek de política**: o usuário declara objetivo + restrições em formulário
estruturado; o motor local busca uma sequência de movimentos concretos sobre a
política atual que atinja o objetivo, apresenta a trajetória (fronteira) e os
movimentos ranqueados por custo marginal, e aplica em nova aba de canvas. Com IA
(Nível 2+): objetivo em linguagem natural e narrativa explicativa — números sempre
do motor.

---

## Primeira etapa — Análise de viabilidade sem IA generativa

**É possível implementá-la sem IA generativa?** **Sim — é a frente mais madura.** O
núcleo algorítmico já está entregue e testado (Pareto/Johnny); o trabalho é
generalizar espaço de busca, objetivo e UX. LLMs seriam inclusive **inadequados** ao
núcleo: o problema é otimização combinatória sobre métricas exatas, terreno de
algoritmo, não de linguagem.

**Quais capacidades podem ser entregues?**
1. **Objetivo estruturado**: formulário com alvo (`approvalRate` / `inadReal` /
   `inadInferida` / `approvedAltasInfer` / nº de nós), direção e magnitude
   (+2pp, −0,5pp, "mínimo"), e restrições-teto (mesmos sliders do
   `optimModal`/`johnnyModal`) + elementos travados 🔒 (nó/célula que não pode mudar
   — restrição de compliance declarada pelo usuário).
2. **Espaço de movimentos** (cada movimento = patch de PolicyIR com delta simulável):
   - abrir/fechar célula de Cineminha (**já existe** via Johnny);
   - trocar o terminal de um segmento `(nó, valor)` — mover o port de ✅→❌, ❌→✅ ou →⟳;
   - mover corte em variável ordinal (deslocar o limiar R07→R08), respeitando o grafo de precedência do Johnny (monotonicidade);
   - relaxar/apertar regra de Decision Lens (valor de comparação em regra `gte`/`lte`);
   - **adicionar** quebra em folha (usa o ranking de discriminância da Frente 1: onde um segmento aprovado/reprovado em bloco tem alta heterogeneidade de inad, quebrá-lo por outra variável libera aprovação barata);
   - **remover** nó/regra (simplificação — ver 4).
3. **Delta marginal O(1) por movimento**: como cada segmento tem agregados
   conhecidos (qty, qtdAltas, inadRRaw, inadIRaw, qtdAltasInfer — exatamente o que
   `computeCinemaArrivals`/`exportDiagnosticCSV` já agregam por nó+valor), trocar o
   destino de um segmento muda os acumuladores globais por adição/subtração — sem
   re-simular a base. Re-simulação completa só na validação final da proposta
   (números exibidos = simulação real, DEC-IA-005). Isso implementa também o item
   "Cálculo de delta e impacto marginal" do [[Roadmap]] (feedback inline por célula).
4. **Busca**: greedy com precedência (padrão Johnny) — a cada passo, o movimento
   liberado de melhor razão `Δobjetivo / Δcusto` com shrinkage bayesiano para
   segmentos de baixo volume; parar ao atingir o alvo ou esgotar movimentos que
   respeitem as restrições. Evolução opcional: beam search com largura pequena
   (mitiga ótimo local sem explodir custo).
5. **Simplificação com prova de equivalência**: detectar (a) nós cujos valores
   roteiam todos para o mesmo destino (colapsáveis), (b) nós com chegada zero
   (`nodeArrivals`), (c) regras de lens sem efeito, (d) variável re-testada sem
   ganho; propor a política reduzida e **provar**: rodar `computeSimulatedDecisions`
   nos dois canvases e exigir diff = 0 (ou reportar o delta exato quando a
   simplificação for lossy).
6. **Apresentação como fronteira**: reusar o formato do `johnnyModal` — curva
   aprovação × inad com cenários e slider; cada ponto é uma sequência de movimentos
   listável ("Movimento 3: abrir célula `R07|Digital` → +0,4pp aprovação, +0,05pp
   inad inferida, 2,1k propostas").

**Quais seriam as limitações?**
- **Ótimos locais**: greedy não garante o ótimo global; mitigado por beam search e por expor a fronteira inteira (o usuário escolhe o ponto).
- **Espaço fechado**: só movimentos do catálogo; não inventa reestruturação profunda ("troque a ordem dos três primeiros nós") — isso fica para o Nível 3 (planos compostos) ou para o usuário.
- **Só otimiza o mensurável no dataset**: sem noção de custo de consulta a bureau, margem, compliance — a menos que o usuário declare (colunas de custo futuras, travas 🔒).
- **Risco estatístico em segmentos pequenos**: já mitigado pelo shrinkage (padrão Johnny) + sinalização de confiabilidade da inferência (`confiabVolume`/`InferenceSignal`) exibida junto da proposta.

**Qual seria a experiência do usuário?**
- Botão **"🎯 Atingir objetivo"** na seção Fluxo (ou toolbar) → modal Goal Seek: alvo, magnitude, restrições, travas → "Buscar" → fronteira + lista de movimentos + preview dos indicadores (mesmo vocabulário visual do `johnnyModal`).
- "Aplicar como novo cenário" cria aba de canvas duplicada com os movimentos aplicados (nome sugerido: "Cenário +2pp") — comparável imediatamente no Dashboard/KPI A vs B.
- Exemplo canônico do produto: *"a partir da política AS IS e das variáveis disponíveis, aumente 2pp a taxa de aprovação buscando o menor aumento de inadimplência possível"* → objetivo `{target: approvalRate, delta: +2pp, minimize: inadInferida}` — resolvido inteiramente pelo motor local.

**Qual seria a qualidade esperada?**
- **Precisão numérica: total** (deltas simulados). É a diferença competitiva vs. copilotos de LLM puro: aqui a recomendação é verificada antes de ser mostrada.
- Qualidade da recomendação: comparável ao Johnny atual (bem aceito) sobre um espaço maior; explicabilidade completa (cada passo tem número e população).

**Quais técnicas poderiam ser utilizadas?** Otimização combinatória gulosa com
restrições de precedência (existente), shrinkage bayesiano (existente), fronteira de
Pareto (existente), deltas incrementais por agregados de segmento, beam search,
detecção de equivalência por simulação diferencial, detecção de heterogeneidade
intra-segmento (variância ponderada/IV — compartilhado com a Frente 1).

**Como reutilizar a arquitetura existente?** Ver tabela abaixo — esta frente é
majoritariamente **generalização de código existente**, não código novo.

---

## Jornada funcional

### Nível 1 (local)
1. Usuário abre "🎯 Atingir objetivo", declara alvo + restrições + travas.
2. Worker (`COMPUTE_GOAL_SEEK`) devolve fronteira + sequência de movimentos + indicadores por ponto.
3. Usuário navega a fronteira (slider/cards, padrão Johnny), inspeciona movimentos individuais (com "ver no canvas" destacando o nó/célula).
4. "Aplicar como novo cenário" → nova aba → Dashboard compara.
5. Alternativa: objetivo "Simplificar" roda o detector de equivalência e propõe a política reduzida com a prova (diff de decisões = 0) ou o delta declarado.

### Nível 2 (IA habilitada)
6. Campo de texto no modal: a frase do usuário vira o objetivo estruturado (IA faz *parsing*, formulário mostra o resultado para confirmação — a IA nunca dispara a busca sozinha).
7. Resultado ganha "✨ Explicar proposta": narrativa executiva gerada sobre os movimentos e deltas computados (contexto N0+N1), ex.: "O ganho vem 70% da abertura de `R06–R07` no canal Digital, onde a inadimplência histórica é 40% menor que a média do rating...".

### Nível 3
8. Planos compostos e comparação comentada de cenários ("B ganha de C em aprovação, mas concentra risco no segmento X — veja a barra 100% do Dashboard"); chat sobre trade-offs, sempre grounded nos artefatos do motor.

## Comportamentos esperados

- Nenhum número exibido sem simulação de validação (deltas incrementais são internos à busca; o resultado final re-simula — DEC-IA-005).
- Restrições são invioláveis: movimento que estoura teto de inad ou toca elemento 🔒 nunca entra na proposta.
- Monotonicidade ordinal respeitada por construção (grafo de precedência — DEC-JO-003).
- Propostas não-destrutivas; aplicar = nova aba (nunca sobrescrever a política de origem sem escolha explícita).
- Sem alvo atingível: reportar o melhor ponto alcançado e qual restrição limitou ("teto de inad real atinge o limite em +1,3pp").
- Sinalização de confiabilidade da inferência (`InferenceSignal`) acompanha a proposta quando `inferenceSource==='ref'`.

## Cenários de uso

1. **Expansão controlada**: "+2pp aprovação, minimize inad inferida" → 6 movimentos, +2,02pp, +0,11pp inad → aplicado como "Cenário Expansão Q3".
2. **Corte de risco**: "reduza inad real em 0,5pp, perdendo o mínimo de aprovação" → fecha 3 células e rebaixa 1 segmento → −0,52pp inad, −0,9pp aprovação.
3. **Simplificação**: política herdada com 14 nós → detector prova que 4 são colapsáveis sem mudar nenhuma decisão → política de 10 nós, documentada.
4. **Objetivo inviável**: "+5pp com inad estável" → melhor ponto +2,8pp; restrição-gargalo apontada; usuário decide relaxar o teto ou aceitar o parcial.

## Cenários de teste simplificados (GATEs)

- `tests/goalSeek.test.js` (GATE numérico, padrão dos GATEs existentes):
  - **Delta incremental ≡ re-simulação**: para cada tipo de movimento sobre uma fixture pequena, o delta O(1) por agregados bate com `runSimulation` antes/depois — mesma técnica do GATE `simulationTick.test.js`;
  - restrições: nenhum ponto da fronteira viola teto/travas; monotonicidade preservada em eixo ordinal;
  - objetivo inatingível reporta melhor ponto + gargalo;
  - determinismo: mesma entrada ⇒ mesma proposta.
- `tests/policySimplify.test.js`: fixture com nó colapsável ⇒ proposta reduz e `computeSimulatedDecisions` diff = 0; fixture com simplificação lossy ⇒ delta reportado corretamente; nó com chegada zero removível.

## Sugestões técnicas (para a IA implementadora)

- **Worker**: `COMPUTE_GOAL_SEEK {shapes, conns, goal, constraints, locks}` →
  `GOAL_SEEK_RESULT {frontier, moves, scenarios, bestPartial?, bindingConstraint?}`;
  `COMPUTE_SIMPLIFY {shapes, conns}` → `SIMPLIFY_RESULT {proposal, equivalence:{identical, diffCount, delta}}`.
  Agregados por segmento: derivar do mesmo walk compilado (M8) de
  `computeCinemaArrivals` estendido a `(nó, valor)` de losangos e lens — os dados já
  são computados de forma equivalente em `exportDiagnosticCSV` (main) e `edgeStats`.
- **Estado**: `goalSeekModal` (padrão `johnnyModal`: fronteira, cards, slider,
  proposta em edição, aplicar). Travas 🔒 vivem no shape (`locked: true` — entra no
  Projeto via `canvases`, sem trabalho extra de persistência) e são respeitadas
  também pelos otimizadores existentes.
- **Aplicação**: reusar a duplicação de canvas da Sub-sessão 5A (`cloneCanvasWithNewIds`) + `applyPolicyPatch` (Sessão 0) + `autoLayout()`.
- **Movimento "adicionar quebra"** depende do ranking da Frente 1 (Sessão 3); se
  implementado antes, entregar o catálogo sem esse movimento (o catálogo é extensível
  por design — lista de geradores de movimento).

## Reutilização de código e padrões existentes

| Necessidade | Já existe |
|---|---|
| Fronteira objetivo × risco | `buildParetoFrontier`, `extractScenarios` |
| Busca gulosa com precedência + shrinkage | `computeJohnnyData` (DEC-JO-003/004, `SHRINK_K`) |
| Agregados por segmento (base dos deltas O(1)) | `computeCinemaArrivals`, `edgeStats`, `exportDiagnosticCSV` |
| Roteamento rápido | motor compilado M8 |
| Régua de comparação AS IS vs proposta | `computeIncrementalResult` / `incrementalResult` (rToA/aToR) |
| Diff de decisões (prova de equivalência) | `computeSimulatedDecisions` + `cachedCanvasOverlay` |
| Materializar proposta como cenário | multi-canvas 5A (`cloneCanvasWithNewIds`, `includeInDashboard`), KPI A vs B (DEC-AW-008) |
| UX de fronteira/cards/slider/aplicar | `optimModal` / `johnnyModal` |
| Confiabilidade estatística | shrinkage Johnny + `confiabVolume`/`InferenceSignal` |
| Protocolo/cache do worker | `COMPUTE_* → *_RESULT`, `getTickResult` |

## Prompts das sessões

**Sessão 4 — Goal Seek:**
```
Vamos à Sessão 4 do Copiloto (Goal Seek), conforme
docs/wiki/Copiloto-SugestoesMelhoria.md e docs/wiki/Epicos-CopilotoIA.md
(DEC-IA-005/006). Implemente COMPUTE_GOAL_SEEK no worker: agregados por segmento
(nó,valor) via walk compilado M8, catálogo de movimentos (célula, terminal de
segmento, corte ordinal com precedência, regra de lens), deltas incrementais O(1)
com GATE contra runSimulation, busca gulosa com restrições/travas 🔒 e shrinkage
(padrão computeJohnnyData), re-simulação de validação do resultado. UI: modal
goalSeekModal no padrão johnnyModal (objetivo estruturado + fronteira + movimentos +
aplicar como novo cenário via cloneCanvasWithNewIds). GATE tests/goalSeek.test.js.
Releia o épico e o código antes de propor.
```

**Sessão 5 — Simplificação:**
```
Vamos à Sessão 5 do Copiloto (simplificação com prova de equivalência), conforme
docs/wiki/Copiloto-SugestoesMelhoria.md. Implemente COMPUTE_SIMPLIFY no worker
(detecção de nós colapsáveis, chegada zero, regras sem efeito, variável re-testada;
proposta como patch de IR; prova via computeSimulatedDecisions diff=0 ou delta
declarado), UI de revisão não-destrutiva e tests/policySimplify.test.js. Releia o
épico e o código antes de propor.
```
