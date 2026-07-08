# Copiloto — Frente 4: Descoberta de Segmentos (Assistente de Descoberta)

> Parte do épico [[Epicos-CopilotoIA|Copiloto de Política de Crédito]] (ler primeiro:
> arquitetura em camadas, PolicyIR, DEC-IA-001..006, Contrato de Privacidade,
> contrato anti-alucinação).
>
> **Status:** planejamento — Sessões 10 a 13 (prompts em [[Copilotos-Prompts-Sessoes]]).

## O que é

Um assistente que ajuda o analista de crédito a **descobrir segmentos relevantes que a
política atual não expressa** — e a agir sobre eles. Enquanto as frentes 1–3 assistem a
construção (o que já se decidiu montar), a otimização (dentro da estrutura existente) e
a documentação (do que existe), a Frente 4 responde à pergunta anterior a todas elas:

> **"Onde, nos meus dados, existe um grupo de propostas que merece tratamento próprio —
> e a política de hoje não dá?"**

Não é "clusterização" como fim: é descoberta de **subgrupos acionáveis** (combinações de
valores de variáveis de decisão) onde a política atual está desalinhada com o
comportamento observado, com **explicação do porquê**, **priorização por impacto de
negócio** e **recomendação materializável** como patch de PolicyIR — no mesmo padrão
não-destrutivo de todo o ecossistema (proposta → simulação real → aplicar como novo
cenário).

---

## Contexto

O simulador já tem inteligência determinística madura, mas toda ela é **reativa à
estrutura que o usuário montou**:

- O **lint** (Sessão 1, `computePolicyInsights`) aponta defeitos estruturais do grafo.
- O **ranking de variáveis** (Sessão 3, `computeVariableRanking`, IV/WoE) responde "qual
  variável abrir NESTE port" — exige que o usuário já esteja parado no lugar certo.
- O **Johnny/Goal Seek** (Sessão 4) otimiza terminais/células/limiares **dentro da
  topologia existente** — não descobre que falta uma quebra nova (o movimento
  "adicionar quebra em folha" ficou explicitamente como pendência da Sessão 4).
- A **Simplificação** (Sessão 5) remove estrutura redundante — a direção oposta.
- O **Dashboard** permite investigar segmentos manualmente (pivot, filtros,
  agrupamentos) — mas a descoberta depende de o analista saber onde procurar.

O que falta é o passo que um **gerente sênior de políticas** faz antes de tudo: varrer a
base perguntando "onde estou reprovando gente boa? onde estou aprovando risco? onde um
grupo heterogêneo está recebendo tratamento único?" — hoje um trabalho manual de tabelas
dinâmicas que depende de intuição e tempo.

### Por que o domínio favorece métodos determinísticos

A base do simulador é **sumarizada e categórica/ordinal** (cada linha é um agrupamento
com `qty`, `qtdAltas`, `inadReal`, `inadInferida`; dimensões dict-encoded com poucos
distintos). Um "segmento" aqui é, por construção, uma **conjunção de condições sobre
colunas de decisão** — exatamente o formato de uma regra de Decision Lens (`LensRule[]`)
ou de um caminho da árvore. Isso significa que o segmento descoberto **já nasce
interpretável e materializável**: não há embedding, não há centróide para traduzir de
volta. O problema clássico correspondente é **subgroup discovery** (busca de subgrupos
com função de qualidade), não clusterização não supervisionada.

---

## Problemas reais de negócio que a frente resolve

| # | Problema | Como aparece hoje | O que a descoberta entrega |
|---|---|---|---|
| 1 | **Aprovação deixada na mesa** | Segmentos reprovados em bloco com inadimplência observada/inferida baixa (ex.: `R08 × Digital × Renda alta`) passam despercebidos | Lista ranqueada de "reprovados de baixo risco" com volume e delta simulado de aprovar |
| 2 | **Vazamento de risco** | Segmentos aprovados cuja inad é múltiplos da média conviveM diluídos dentro de um nó largo | "Aprovados de alto risco" com o custo (inad marginal) de mantê-los |
| 3 | **Tratamento único para população heterogênea** | Um terminal recebe um mix com inad interna variando 5× — a política não discrimina onde deveria | Detecção de heterogeneidade intra-segmento + a variável/conjunção que melhor separa (a "quebra que falta") |
| 4 | **Política desalinhada do AS IS sem ninguém notar** | A nova política promove/rebaixa sistematicamente um grupo específico (rToA/aToR concentrado) e o agregado esconde isso | Decomposição do `impacted` por segmento: ONDE a política muda decisões |
| 5 | **Anomalias de dados/safra** | Um valor de domínio com comportamento discrepante (erro de carga, mudança de mercado) contamina decisões | Sinalização de células/valores estatisticamente anômalos antes que virem regra |
| 6 | **Conhecimento preso nos seniores** | Só quem "já viu essa carteira" sabe onde olhar | A varredura sistemática democratiza a investigação; o julgamento continua humano |

---

## Impacto no negócio

- Converte a etapa mais cara do ciclo (investigação exploratória manual) em uma varredura
  sistemática de minutos, **com os mesmos números que o analista calcularia à mão**.
- Cada oportunidade vem com **delta simulado de verdade** (DEC-IA-005) — defensável em
  comitê: "aprovar este segmento adiciona +0,8pp de aprovação a +0,04pp de inad inferida,
  sobre 12,4k propostas/período".
- Fecha o ciclo do ecossistema: **Descobrir → (Frente 1) construir → (Frente 2) otimizar
  → (Frente 3) documentar** — a plataforma passa a cobrir a jornada completa do gestor de
  política, não só a execução.
- Diferencial competitivo honesto: copilotos de LLM puro *sugerem* segmentos plausíveis;
  aqui todo segmento exibido foi **verificado pelo motor de simulação** antes de aparecer.

---

## Objetivo

Entregar quatro capacidades encadeadas — **Descoberta, Explicação, Priorização e
Recomendação** — operando sobre a base inteira ou sobre a população de um nó selecionado,
100% locais (Nível 1), com enriquecimento opcional de IA (Nível 2+) restrito a rótulo,
narrativa e hipóteses, nunca a números.

---

## Primeira etapa — Análise de viabilidade sem IA generativa

**É possível implementá-la sem IA generativa?** **Sim — integralmente no núcleo.** A
descoberta é estatística sobre dados agregados; a explicação é decomposição aritmética; a
priorização é uma função de score; a recomendação é geração de patch de IR. A IA só
agrega linguagem (nomes, narrativa, hipóteses de causa) — exatamente o padrão DEC-IA-001.

### Mapa de técnicas — o que usar, quando, e o que NÃO usar

| Técnica | Adequação neste domínio | Quando usar | Situação no projeto |
|---|---|---|---|
| **Subgroup discovery** (beam search sobre conjunções com função de qualidade, estilo WRAcc adaptado) | **Núcleo da frente.** Segmento = conjunção de `LensRule` sobre colunas de decisão; qualidade = desvio de inad/aprovação × volume, com shrinkage | Descoberta global e por nó, 1D→2D→3D com beam width limitado | Novo (`computeSegmentDiscovery`), reusando agregação O(distintos) do M8 e `computeIV` da Sessão 3 |
| **Indução de árvore rasa (CART/CHAID-like)** | Boa para sugerir a "quebra que falta" num terminal heterogêneo — profundidade 1–2, critério = ganho de IV/impureza ponderada | Problema 3 (heterogeneidade): qual variável/par separa melhor a população deste nó | Já existe o essencial: `computeVariableRanking` (IV por candidata + interação para Cineminha) — a frente REUSA, não reimplementa |
| **Regras de associação (Apriori-like)** | Redundante com subgroup discovery aqui (mesmo espaço de conjunções, sem alvo). Usar apenas a noção de *support* (volume mínimo) e *lift* (razão vs. complemento) como métricas do relatório | Não como técnica separada — o vocabulário (support/lift) entra na explicação | Absorvida pela descoberta |
| **Clusterização (k-means/hierárquica)** | **Inadequada como entrega**: centróides sobre dummies categóricas não viram regra de política; o analista não consegue materializar "cluster 3" | Só como visão exploratória futura (mapa de similaridade entre segmentos), nunca como fonte de recomendação | Fora do MVP; reavaliar no longo prazo |
| **SHAP / atribuição de modelo** | Não há modelo caixa-preta a explicar — as "features" são as próprias condições do segmento. Uma **decomposição WoE aditiva** (contribuição de cada condição para o desvio de inad) dá o mesmo valor interpretativo, exata e sem dependência | Explicação: "o desvio deste segmento vem 70% de `Score=R08`, 30% de `Canal=Digital`" | Novo, derivado dos mesmos bins do `computeIV`. SHAP real só se um dia houver score de ML embarcado |
| **Testes estatísticos** (binomial/χ², intervalo de Wilson) + **correção de múltiplas comparações** (Benjamini–Hochberg) | **Obrigatórios**: a varredura testa centenas de segmentos — sem controle de FDR, o assistente vira gerador de falsos positivos | Filtro de significância de TODO achado antes de exibir | Novo; complementa o shrinkage bayesiano existente (`SHRINK_K`) |
| **Detecção de anomalias** | Simples e suficiente no agregado: desvio robusto (mediana/MAD) da inad ou do mix por valor de domínio, por safra quando há coluna `temporal` | Problema 5 (dados suspeitos); sinalizar, nunca decidir | Novo, barato (O(distintos)) |
| **Uplift / análise contrafactual** | O simulador JÁ TEM o contrafactual exato: `__DECISAO_ORIGINAL` vs. decisão simulada por linha (`computeSimulatedDecisions`). "Uplift" aqui = decompor rToA/aToR por segmento — determinístico, não estimado | Problema 4 (onde a política muda decisões) | Reusa o overlay existente; só falta a decomposição por segmento |
| **Estabilidade (split-half / bootstrap por safra)** | Barata quando há coluna temporal: o segmento mantém o sinal nas duas metades do período? | Selo de robustez exibido no card do achado | Novo, opcional por dataset |

### Limitações declaradas

- Espaço de busca fechado (conjunções sobre colunas de decisão até profundidade limitada)
  — não descobre padrões que exigem variável ausente da base.
- Sem noção de margem/custo enquanto a base não tiver colunas de valor financeiro (a
  priorização usa proxy: volume × delta de inad × conversão inferida; colunas de margem
  entram no roadmap).
- Correlação, não causa: o assistente diz ONDE o comportamento difere, nunca POR QUÊ no
  sentido causal — a hipótese de causa é do analista (ou da IA, claramente rotulada como
  hipótese).

---

## Conceitos centrais

### SegmentDef — o segmento como conjunção de regras (DEC-SD-001)

```js
SegmentDef = {
  conditions: LensRule[],   // MESMO formato do Decision Lens (col, operator, value, logic:'AND')
  scope: null | { nodeId }, // null = base inteira; nodeId = população que chega ao nó
}
```

Reusar `LensRule` é a decisão estrutural da frente: todo segmento descoberto é
**imediatamente materializável** (vira Decision Lens, losango ou Cineminha via
`applyPolicyPatch`), avaliável pelo motor existente (`matchLensRule`/
`compileLensMatcher`) e legível pelo analista sem tradução.

### SegmentModel — o artefato canônico da frente (padrão `docModel`)

Saída do worker: dados crus, nunca prosa (mesma separação dados/apresentação da Sessão 6).

```js
SegmentModel = {
  version, generatedAt, scope,            // global ou {nodeId, label}
  population: { qty, decidedQty },        // denominadores
  findings: [SegmentFinding],             // ordenados por prioridade
  diagnostics: { candidatesTested, discarded: {lowVolume, notSignificant, unstable, duplicate} },
}

SegmentFinding = {
  id, code,          // 'approvable_low_risk' | 'approved_high_risk' | 'heterogeneous_block'
                     // | 'asis_divergence' | 'anomaly'
  segment: SegmentDef,
  metrics: {         // sempre do motor/agregação — nunca estimados
    qty, share, qtdAltas, qtdAltasInfer,
    inadReal, inadInferida,               // do segmento
    refInadReal, refInadInferida,         // do complemento/população de referência
    lift,                                  // razão segmento/referência
    currentDecision,                       // 'approved'|'rejected'|'mixed' na política atual
  },
  explanation: {     // decomposição local, determinística
    contributions: [{col, value, sharePct}],   // decomposição WoE aditiva do desvio
    stability: null | {split:'temporal', holds: boolean},
    pValue, qValue,                            // teste + FDR
  },
  priority: { score, impact: {deltaApproval, deltaInadInf, movedQty} },  // ver Priorização
  recommendation: null | SegmentRecommendation,  // ver Recomendação
}
```

### Arquitetura conceitual — quatro estágios desacoplados

```
┌────────────────────────────────────────────────────────────────────┐
│ 1. DESCOBERTA (worker — COMPUTE_SEGMENT_DISCOVERY)                  │
│    beam search de conjunções (1D→2D→3D) sobre colunas de decisão,   │
│    escopo global ou população de um nó (walk compilado M8);         │
│    qualidade = |desvio| × volume com shrinkage (SHRINK_K)           │
└──────────────────────────────┬─────────────────────────────────────┘
┌──────────────────────────────▼─────────────────────────────────────┐
│ 2. EXPLICAÇÃO (worker, mesmo passe)                                 │
│    decomposição WoE por condição · lift vs. complemento ·           │
│    teste binomial + FDR (BH) · estabilidade temporal (split-half)   │
└──────────────────────────────┬─────────────────────────────────────┘
┌──────────────────────────────▼─────────────────────────────────────┐
│ 3. PRIORIZAÇÃO (worker)                                             │
│    score composto (volume × impacto × confiança × acionabilidade); │
│    dedup de segmentos aninhados; poda por relevância operacional    │
└──────────────────────────────┬─────────────────────────────────────┘
┌──────────────────────────────▼─────────────────────────────────────┐
│ 4. RECOMENDAÇÃO (worker gera o patch; main aplica)                  │
│    cada achado → patch de PolicyIR (lens/losango/célula/terminal)   │
│    validado por RE-SIMULAÇÃO REAL (runSimulation) antes de exibir;  │
│    aplicar = novo cenário (cloneCanvasWithNewIds + aplicador único) │
└─────────────────────────────────────────────────────────────────────┘
        (opcional, Nível 2)  ✨ IA: rótulo do segmento, narrativa,
        hipóteses de causa — via AIProvider (Sessão 7), contexto N0/N1
```

Os estágios são funções separadas no worker (testáveis isoladamente), compostas numa
única mensagem — mesmo padrão de `computeSimplify` (detecção → validação → proposta).

---

## Jornada funcional

### Nível 1 (local) — análise global

1. Botão **🔍 Descobrir Segmentos** na seção Fluxo do painel direito (ao lado de
   🎯 Atingir Objetivo e 🧹 Simplificar) → dispara `COMPUTE_SEGMENT_DISCOVERY` com
   escopo global (formulário mínimo: métrica de risco `inadReal`/`inadInferida`, volume
   mínimo, profundidade máx. da conjunção — defaults sensatos, zero configuração
   obrigatória).
2. Worker devolve o `SegmentModel`; o modal (`segmentDiscoveryModal`, padrão
   `goalSeekModal`) lista **cards de oportunidade** ranqueados, agrupados por tipo de
   achado (💰 aprovável de baixo risco · 🔥 aprovado de alto risco · 🪓 bloco heterogêneo
   · 🔀 divergência vs. AS IS · ⚠️ anomalia).
3. Cada card mostra: condições do segmento em linguagem de regra ("Score em R07–R08 **e**
   Canal = Digital"), volume e share, inad vs. referência (com lift), decomposição do
   porquê, selo de confiança (significância + estabilidade) e **impacto simulado** da
   recomendação.
4. Ações por card: **👁 Ver no Dashboard** (cria filtro de página com as condições —
   reusa `FilterCard`), **🎯 Enviar ao Goal Seek** (pré-carrega o objetivo/trava
   correspondente) e **✓ Aplicar como novo cenário** (materializa o patch numa aba nova —
   nunca toca a política de origem).

### Nível 1 — análise de um nó específico

5. Com um nó selecionado (losango, Cineminha, lens, terminal), a toolbar contextual ganha
   **🔍 Descobrir aqui**: mesma varredura, restrita à **população que efetivamente chega
   ao nó** (mesmo walk compilado do `computeVariableRanking`/`computeCinemaAsIsCells`).
   É o modo de trabalho do analista investigando "por que este terminal tem inad alta?" —
   e a resposta natural do achado `heterogeneous_block` é exatamente a "quebra que falta"
   naquele ponto (losango ou Cineminha sugerido, um clique para criar já conectado —
   reusa o fluxo de aplicação da Sessão 3).

### Nível 2 (IA habilitada — Sessão 7 como pré-requisito)

6. **✨ Nomear segmentos**: a IA recebe as condições + métricas (N0/N1, com pseudonimização
   opcional) e devolve um rótulo executivo curto ("Jovens digitais de score médio") —
   exibido SEMPRE ao lado da regra formal, nunca no lugar dela.
7. **✨ Narrativa do achado**: parágrafo executivo sobre números já computados (mesmo
   contrato da Frente 2: a IA explica, o motor calcula).
8. **✨ Hipóteses de causa**: sugestões claramente rotuladas como hipótese ("pode refletir
   política de canal anterior a 2025 — verifique a safra"), nunca afirmadas como fato.

### Nível 3

9. Chat: "quais segmentos descobertos ainda não tratei?", "compare os achados antes e
   depois do cenário B" — grounding no `SegmentModel` + PolicyIR, mesmo padrão da Sessão 9.

---

## Priorização de oportunidades (estágio 3)

Score composto, transparente e exibido decomposto no card (nunca um número mágico):

```
priority = impact × confidence × actionability
```

- **impact** — o ganho simulado da recomendação associada, na moeda do negócio:
  `movedQty × |Δinad vs. referência|` para risco, `movedQty × taxa de conversão inferida`
  para receita proxy (quando houver colunas de margem no futuro, entram aqui —
  DEC-SD-005). Volume grande com desvio pequeno e nicho minúsculo com desvio gigante
  ficam comparáveis na mesma régua.
- **confidence** — combinação do q-value (pós-FDR), do shrinkage (segmentos pequenos são
  puxados para a média — herda `SHRINK_K` do Johnny) e do selo de estabilidade temporal.
- **actionability** — penaliza o que o analista não consegue operar: conjunções com mais
  de 3 condições, segmentos que cruzam datasets, segmentos já 100% tratados por nó
  dedicado na política atual, e segmentos travados (🔒 `shape.locked` na região do fluxo
  que os decide).

O modal permite reordenar por qualquer eixo (impacto, volume, risco, confiança) — a
priorização default é uma opinião, não uma imposição.

---

## Como evitar segmentos estatisticamente irrelevantes ou sem valor operacional

Defesas em camadas, todas no motor (estágios 1–3), com contadores expostos em
`diagnostics` (o analista vê QUANTO foi descartado e por quê — confiança por transparência):

1. **Volume mínimo** (`minQty`, default proporcional à base — ex.: max(200, 0,1% da
   população do escopo)): nada abaixo entra na busca.
2. **Shrinkage bayesiano** (`SHRINK_K`, existente): o desvio de segmentos pequenos é
   atenuado antes do ranking — mata o "nicho de 40 propostas com inad 0%".
3. **Significância + FDR**: teste binomial do desvio vs. referência; Benjamini–Hochberg
   sobre TODOS os candidatos testados na varredura; só `qValue ≤ 0,05` (configurável)
   vira achado.
4. **Estabilidade temporal** (quando há coluna `temporal`): split-half por período; sinal
   que não se mantém ganha selo ⚠ "instável" e cai na priorização (não é ocultado —
   pode ser mudança de mercado genuína).
5. **Dedup estrutural**: um segmento aninhado em outro já reportado (ex.: `R08×Digital`
   dentro de `R08`) só aparece se adicionar desvio incremental relevante sobre o pai
   (ganho de qualidade mínimo por condição extra — princípio de parcimônia do beam).
6. **Filtro de acionabilidade**: segmento cuja recomendação simulada gera delta desprezível
   (< limiar em pp e em qty) é reportado apenas no diagnóstico, não como card.
7. **Teto de profundidade** (default 3 condições): regra que o analista não consegue
   defender em comitê não é oportunidade, é overfitting.

---

## Da estatística à recomendação compreensível

Regras de tradução fixas (templates determinísticos, pt-BR — mesmo princípio do DocGen):

- **Toda métrica com referência**: nunca "inad 2,1%", sempre "inad 2,1% vs. 4,8% do
  restante do segmento-pai (2,3× menor)".
- **Toda condição em vocabulário do dado**: as regras usam os nomes de coluna e valores
  reais da base (com o Contrato de Privacidade aplicado quando o modal for exportado —
  domínios são N2, mesmo toggle da Sessão 6).
- **Todo achado com verbo de ação**: o card não termina em estatística, termina em
  proposta ("Criar exceção de aprovação para este segmento — impacto simulado: +0,6pp
  aprovação, +0,03pp inad inferida").
- **Toda proposta com número simulado de verdade** (DEC-IA-005): o delta do card vem de
  `runSimulation` sobre o canvas clonado com o patch aplicado — nunca do agregado interno
  da busca.
- **Incerteza visível**: selos (✅ estável/significativo · ⚠ instável · 🔎 amostra
  pequena) no card, com tooltip explicando o critério em uma frase.

### SegmentRecommendation — catálogo (estágio 4)

Cada tipo de achado mapeia para um gerador de patch, TODOS materializados pelo aplicador
único da DEC-IA-002 (`applyPolicyPatch`) ou pelos apliers já existentes:

| Achado | Recomendação | Materialização (reuso) |
|---|---|---|
| `approvable_low_risk` | Exceção de aprovação: Decision Lens com as condições → Aprovado, inserido antes do ponto que hoje reprova o segmento | patch de IR (`applyPolicyPatch`); alternativa: movimentos `cinema_cell`/`decision_terminal` do Goal Seek quando o segmento coincide com célula/valor existente (`applyGoalSeekMoves`) |
| `approved_high_risk` | Simétrico: restrição/rebaixamento do segmento | idem |
| `heterogeneous_block` | "Quebra que falta": losango ou Cineminha (se interação, mesmo critério `IV(A×B) >> IV(A)+IV(B)` da Sessão 3) no nó heterogêneo | fluxo de criação da Sessão 3 (um clique, já conectado) — **entrega o movimento "adicionar quebra" pendente da Sessão 4** |
| `asis_divergence` | Nenhum patch — encaminha para inspeção (filtro no Dashboard + destaque no canvas) | `FilterCard` + navegação |
| `anomaly` | Nenhum patch — sinalização de qualidade de dado | card informativo |

---

## Visualizações

Dentro do vocabulário visual existente (SVG/`foreignObject` no canvas; Recharts apenas na
aba Dashboard — exceção DEC-AW-001 já aberta):

1. **Cards de oportunidade** (modal) — a visualização primária: regra + métricas com
   referência + barra de decomposição das contribuições + selos. É o formato que o
   público-alvo (especialista de crédito, não cientista de dados) lê sem treinamento.
2. **Quadrante volume × risco** (scatter Recharts no modal): cada achado é um ponto
   (x = volume, y = lift de inad, cor = tipo de achado, tamanho = impacto). Quadrante
   "alto volume + baixo risco reprovado" é o ouro visível de relance. Clique no ponto =
   foco no card.
3. **Destaque no canvas** ("ver no fluxo"): realce dos nós/arestas por onde o segmento
   trafega (mesma mecânica de highlight do "ir até o nó" do lint), com o volume do
   segmento anotado por aresta — mostra ONDE na política o segmento é decidido hoje.
4. **Mini-matriz de calor** para achados 2D (par de variáveis): reusa a grade visual do
   Cineminha (células coloridas por inad, marcando as células do segmento) — vocabulário
   que o usuário já domina.
5. **Faixa temporal de estabilidade** (sparkline no card, quando há coluna temporal):
   o desvio do segmento por período — instabilidade fica visível sem estatística.

---

## Integração sem aumentar a complexidade da interface

- **Dois pontos de entrada, ambos em lugares que já existem**: botão na seção Fluxo
  (global) e botão na toolbar contextual (por nó). Nenhum painel novo permanente, nenhuma
  aba nova.
- **Um modal** no padrão consolidado (`goalSeekModal`/`simplifyModal`): formulário mínimo
  → loading → resultado com cards → ações não-destrutivas.
- **Saídas convergem para fluxos existentes**: Dashboard (filtro), Goal Seek (objetivo
  pré-carregado), canvas (novo cenário via aba). A frente não cria um "quinto lugar para
  olhar" — ela alimenta os quatro que já existem.
- **Achados de alto impacto podem ecoar no painel Copiloto** (Sessão 1) como um achado
  informativo 🔵 ("3 oportunidades de segmento detectadas — abrir Descoberta"), sem
  duplicar a lista: o painel aponta, o modal detalha.

---

## IA no controle do usuário (Nível 2)

- A IA **nunca dispara descoberta, nunca gera segmento, nunca produz número**. Ela opera
  sobre o `SegmentModel` pronto: rotula, narra, levanta hipóteses.
- Toda saída de IA é visualmente distinta (✨ + tom) e acompanha a fonte formal (a regra e
  os números do motor ficam sempre visíveis).
- Propor divisões novas continua sendo função do MOTOR (achado `heterogeneous_block`); se
  um dia a IA sugerir divisões (Nível 3), a sugestão entra como **candidato a validar
  pelo mesmo pipeline estatístico** — reprovada nos filtros dos estágios 2–3, não aparece.
- Aplicação sempre explícita, sempre como novo cenário, sempre com undo — o padrão
  não-destrutivo do ecossistema é a garantia estrutural de controle.

### Matriz de capacidades × dependência de IA × custo

| Capacidade | Só estatística | Híbrido | Só IA | Modelo mínimo recomendado (runtime) |
|---|---|---|---|---|
| Descoberta de subgrupos (beam + qualidade) | ✅ integral | — | — | nenhum |
| Explicação numérica (WoE, lift, testes, FDR, estabilidade) | ✅ integral | — | — | nenhum |
| Priorização (score composto) | ✅ integral | — | — | nenhum |
| Geração de patch + simulação de validação | ✅ integral | — | — | nenhum |
| Rótulo executivo do segmento | fallback: a própria regra formatada | ✅ (IA nomeia, regra permanece) | — | **Haiku 4.5** (tarefa curta e estruturada; batch de N achados em 1 chamada) |
| Narrativa executiva do achado/proposta | fallback: template de frases | ✅ | — | **Haiku 4.5**; **Sonnet 5** se o usuário pedir tom para comitê |
| Hipóteses de causa | — | ✅ (só sobre N0/N1; rotulado como hipótese) | — | **Sonnet 5** (exige raciocínio de domínio) |
| Q&A sobre achados (Nível 3, chat) | fallback: busca estruturada no SegmentModel | ✅ | — | **Sonnet 5** |

**Arquitetura de custo mínimo** (regras para a Sessão 13):

- **Estatística primeiro, sempre**: a IA recebe o `SegmentModel` já filtrado/priorizado —
  nunca a base, nunca candidatos crus. O payload típico é < 4KB por achado.
- **Batch**: rotular/narrar os top-N achados numa única chamada estruturada (JSON in/out),
  não N chamadas.
- **Cache local por hash do achado** (condições + métricas arredondadas): reabrir o modal
  não re-chama a IA.
- **Escalonamento por tarefa, não por feature**: rótulos no menor modelo; narrativa longa
  só sob demanda ("✨ Explicar" por card, lazy); nada de chamada automática na abertura
  do modal sem opt-in.
- **Degradação limpa** (DEC-IA-001): sem provedor, os cards usam a regra formal e os
  templates de frase — nenhuma funcionalidade some.

---

## Comportamentos esperados

- Nenhum número exibido sem validação: métricas descritivas vêm da agregação exata da
  base; deltas de recomendação vêm de re-simulação real (`runSimulation`) do patch.
- Determinismo: mesma base + mesmos parâmetros ⇒ mesmo `SegmentModel` (ordem inclusive).
- Escopo por nó ≡ população real: a varredura de um nó usa exatamente as linhas que o
  roteamento leva até ele (mesma semântica de `computeCinemaArrivals`/prévia AS IS).
- Nada de auto-aplicação: todo patch exige clique; aplicar = novo cenário
  (`cloneCanvasWithNewIds`), política de origem intocada; `pushHistory()` quando tocar o
  canvas ativo (criação de quebra da Sessão 3).
- Travas 🔒 respeitadas: recomendações que alterariam nós travados são exibidas como
  achado, mas com a ação desabilitada e o motivo declarado.
- Segmentos descartados são contabilizados (`diagnostics`) — o assistente nunca "some"
  com candidatos silenciosamente.
- Sem coluna temporal: selo de estabilidade omitido com aviso ("estabilidade não
  avaliável"), nunca inventado.
- Privacidade: o modal em si é local; export do relatório de achados aplica o toggle de
  domínios (N2) da Sessão 6; IA recebe N0/N1 (+N2 só com opt-in), via ContextBuilder da
  Sessão 7.

## Cenários de uso

1. **Varredura de carteira (global)**: analista roda 🔍 na base do mês → 7 achados → o
   top-1 é `approvable_low_risk` (Score R07–R08 × Digital, 12,4k propostas, inad inferida
   1,9% vs. 4,6%) → "Aplicar como novo cenário" → compara no Dashboard KPI A vs B →
   apresenta ao comitê com o número simulado.
2. **Investigação de nó (local)**: terminal ❌ Reprovado com volume alto → 🔍 Descobrir
   aqui → achado `heterogeneous_block`: dentro dos reprovados, `Tempo_Relacionamento ≥ 5a`
   tem inad inferida 3× menor → um clique cria o losango sugerido já conectado → Goal Seek
   fecha o ajuste fino dos terminais.
3. **Auditoria de mudança**: antes de publicar um cenário, analista roda a descoberta com
   foco em `asis_divergence` → vê que 80% do rToA se concentra num único segmento regional
   → decide validar com a área de negócio antes de aplicar.
4. **Anomalia de dados**: valor `Regiao = "??"` com 2k propostas e inad 0% → card ⚠️
   anomalia sugere inspecionar a carga — evita que o Goal Seek "otimize" sobre lixo.
5. **Nada relevante**: base homogênea → modal informa "nenhum segmento passou os filtros
   de relevância" + diagnóstico (X candidatos testados, descartes por motivo) — resposta
   honesta, não achado inventado.

## Cenários de teste simplificados (GATEs)

- `tests/segmentDiscovery.test.js` (GATE numérico, padrão dos existentes):
  - **Plantar e achar**: fixture sintética com um subgrupo 2D de inad deliberadamente
    deslocada ⇒ a descoberta o encontra com as condições exatas; fixture homogênea ⇒
    zero achados (controle negativo).
  - **Agregados exatos**: `qty`/`inadReal`/`inadInferida` de cada achado ≡ agregação
    manual das linhas que casam as condições (via `matchLensRule` de controle).
  - **Escopo por nó**: achado sobre população de um nó ≡ mesma descoberta rodada sobre a
    sub-base filtrada manualmente pelo roteamento.
  - **Estatística**: p-value binomial bate com valor de controle calculado à mão; FDR
    descarta o segmento-ruído da fixture de múltiplas comparações; shrinkage rebaixa o
    nicho minúsculo abaixo do achado real.
  - **Dedup**: filho aninhado sem ganho incremental não aparece quando o pai é reportado.
  - **Recomendação ≡ simulação**: o delta exibido de cada recomendação ≡ `runSimulation`
    antes/depois do patch aplicado (mesma técnica do GATE do Goal Seek).
  - **Determinismo**: mesma entrada ⇒ mesmo `SegmentModel`.
  - **Travas**: nó 🔒 ⇒ recomendação correspondente marcada não-acionável.
- Sessão 13 (IA): GATE de contrato — payload enviado nunca contém N3; rótulo/narrativa
  citando número inexistente no `SegmentModel` é rejeitado pelo Validator (Sessão 7).

## Sugestões técnicas (para a IA implementadora)

- **Worker**: `COMPUTE_SEGMENT_DISCOVERY {shapes, conns, scope, params}` →
  `SEGMENT_DISCOVERY_RESULT {segmentModel}`; params = `{riskMetric, minQty, maxDepth,
  maxFindings, alpha}` com defaults. Pipeline interno em funções separadas e exportadas
  (testáveis): `discoverSegments` (beam sobre dicionários — O(distintos^profundidade)
  PODADO, nunca produto cartesiano cego), `explainSegment`, `prioritizeFindings`,
  `buildSegmentRecommendations`. População de escopo via walk compilado M8 (mesmo padrão
  `computeVariableRanking`); bins/IV reusam `computeIV` existente.
- **Validação dos deltas**: gerar o patch, aplicar num clone em memória
  (`applyPolicyPatch`/`applyGoalSeekMoves` conforme o tipo) e `runSimulation` — só para os
  top-N achados (não para todo candidato; o card exibe delta só quando validado).
- **Estado**: `segmentDiscoveryModal` efêmero (padrão `goalSeekModal`/`simplifyModal` —
  não persiste, ⚠️ regra do CLAUDE.md não se aplica por não haver criação do usuário).
  Se/quando houver "achados salvos/dispensados" (fase 2), aí sim entra no
  `buildProjectPayload` + bump de schema.
- **UI**: modal com cards + quadrante Recharts; "ver no fluxo" reusa o highlight do lint;
  "ver no Dashboard" monta `FilterCard[]` a partir de `SegmentDef.conditions` (mesmo
  formato de regra — conversão trivial).
- **Não** criar segundo aplicador de patches (DEC-IA-002), **não** criar biblioteca de
  gráficos nova (DEC-AW-001), **não** enviar nada à IA fora do ContextBuilder (Sessão 7).

## Decisões da frente

### DEC-SD-001: Segmento = conjunção de `LensRule` sobre colunas de decisão
Formato único do segmento em toda a frente (busca, explicação, recomendação, filtro de
Dashboard). Garante interpretabilidade e materialização direta; exclui por design
representações não-acionáveis (centróides, embeddings).

### DEC-SD-002: Subgroup discovery com controle estatístico obrigatório
A técnica-núcleo é busca de subgrupos (beam) com função de qualidade; NENHUM achado é
exibido sem passar volume mínimo → shrinkage → teste + FDR → dedup. Os descartes são
contabilizados e visíveis (`diagnostics`).

### DEC-SD-003: Recomendação = patch de PolicyIR pelo aplicador único, delta sempre re-simulado
Nenhum caminho novo de materialização; nenhum delta exibido sem `runSimulation` real
(herda DEC-IA-002/005). Achados sem ação segura (divergência AS IS, anomalia) não geram
patch — geram navegação.

### DEC-SD-004: IA restrita a linguagem sobre o `SegmentModel` pronto
Rótulo, narrativa e hipóteses; batch + cache + menor modelo que resolve; payload máximo
N0/N1 (+N2 opt-in). Divisões sugeridas por IA (futuro) entram como candidatos do pipeline
estatístico, nunca como achados diretos.

### DEC-SD-005: Priorização multi-eixo com margem como extensão declarada
Score = impacto × confiança × acionabilidade, decomposto no card. Colunas financeiras
(margem/custo), quando existirem na base, entram no eixo de impacto sem mudança
estrutural — o score é uma soma de termos, não um modelo fechado.

---

## Relação com o ecossistema de copilotos (análise de consolidação)

### O que já existe e é potencializado

| Ativo existente | Como a Frente 4 o potencializa |
|---|---|
| `computeVariableRanking` + `computeIV` (Sessão 3) | Vira a primitiva estatística da descoberta (bins/IV/interação) — a frente REUSA e generaliza de "1 variável neste port" para "conjunção em qualquer escopo" |
| Goal Seek (Sessão 4) | Ganha o **movimento "adicionar quebra"** deixado como pendência: o achado `heterogeneous_block` é exatamente esse gerador; "Enviar ao Goal Seek" pré-carrega objetivo/escopo |
| Lint/painel Copiloto (Sessão 1) | Ganha um achado informativo 🔵 apontando para a Descoberta — o painel continua sendo o hub de "coisas que merecem atenção" |
| `applyPolicyPatch` (Sessão 0) / `applyGoalSeekMoves` (Sessão 4) | Únicos caminhos de materialização das recomendações — zero código de aplicação novo |
| Overlay AS IS (`computeSimulatedDecisions`/`incrementalResult`) | Base pronta do achado `asis_divergence` (decomposição do rToA/aToR por segmento) |
| Dashboard (filtros/`FilterCard`, KPI A vs B, multi-canvas 5A) | Destino natural de inspeção e comparação de cenários gerados |
| Sessões 7–9 (infra IA, enriquecimentos, chat) | O `SegmentModel` entra como mais um artefato groundável — nenhuma infra de IA própria da frente |
| DocGen (Sessão 6) | Extensão futura: seção "Oportunidades identificadas" no docModel (mesmo Contrato de Privacidade) |

### Sobreposições a consolidar (anti-duplicação)

- **Frente 4 × Sessão 3**: mesma matemática de discriminância. Regra: `computeIV`/bins
  ficam como primitivas compartilhadas no worker; a Sessão 3 permanece dona da UX "no
  port durante a construção"; a Frente 4 é dona da varredura. Nenhuma reimplementação de
  IV/WoE.
- **Frente 4 × Sessão 4**: quando o segmento coincide com estrutura existente
  (célula/valor/limiar), a recomendação É um movimento do catálogo do Goal Seek — mesmo
  formato, mesmo applier. A Frente 4 só gera patches próprios para estrutura NOVA (lens
  de exceção, quebra).
- **Frente 4 × Sessão 1**: o lint continua estrutural (fatos do grafo); a Descoberta é
  estatística (fatos dos dados). O painel não ganha uma segunda lista — só o link.

### O que permanece independente

- **Simplificação (Sessão 5)**: direção oposta (remover estrutura) com contrato próprio
  (prova de equivalência). Compartilham apenas padrões de UX.
- **DocGen (Sessão 6)**: consome, não é consumida.
- **Biblioteca de Políticas (Sessão 2)**: ortogonal (reuso de conhecimento entre bases).

---

## Roadmap em fases

| Fase | Entrega | Sessões |
|---|---|---|
| **MVP** | Motor de descoberta 1D/2D global + por nó (achados `approvable_low_risk`, `approved_high_risk`, `heterogeneous_block`), rigor estatístico completo (volume/shrinkage/FDR/dedup), modal com cards + GATE | 10, 11 |
| **Intermediária** | Recomendações materializáveis (patches + re-simulação + novo cenário), integração Goal Seek ("adicionar quebra" + envio de objetivo), achados `asis_divergence` e `anomaly`, quadrante + estabilidade temporal, filtro de Dashboard a partir do achado | 12 |
| **Longo prazo** | Enriquecimento de IA (rótulos/narrativa/hipóteses via Sessão 7), seção no DocGen, achados salvos/dispensados persistidos, colunas de margem no impacto, monitoramento de drift de segmentos entre safras, grounding no chat (Sessão 9) | 13+ |

---

## Prompts das sessões

Ver [[Copilotos-Prompts-Sessoes]] (Sessões 10–13), com o modelo recomendado por sessão.
