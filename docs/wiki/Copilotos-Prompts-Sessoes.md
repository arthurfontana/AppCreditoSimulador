# Copilotos IA — Prompts de Todas as Sessões

> **Ordem de execução**: Sessão 0 → 1 → 2 → 3 → 4 → 5 → 6 → **10 → 11 → 12** → 7 → 8 → **13** → 9
> (as Sessões 10–12 são 100% locais e não dependem das Sessões 7–9; a 13 depende da 7.)
>
> Referência: [[Epicos-CopilotoIA|Épico Principal]] · [[Copiloto-ConstrucaoAssistida|Frente 1]] · [[Copiloto-SugestoesMelhoria|Frente 2]] · [[Copiloto-DocumentacaoAutomatica|Frente 3]] · [[Copiloto-DescobertaSegmentos|Frente 4]]
>
> **🏷️ Tag de modelo**: cada sessão indica o modelo recomendado para o desenvolvimento
> (`Opus 4.8` para núcleos algorítmicos/matemática sutil e integrações multi-módulo;
> `Sonnet 5` para UI sobre padrões consolidados e trabalho bem especificado). Sessões
> sem tag foram escritas antes da convenção.

---

## Sessão 0 — PolicyIR (Fundação)

**Documentação**: `docs/wiki/Epicos-CopilotoIA.md` (Nível 0)

**Pré-requisitos**: Nenhum (é a base de todas as outras)

**O que vai entregar**:
- `buildPolicyIR(shapes, conns, csvStore)` — helper global exportado
- Export "JSON canônico da política" na seção Fluxo
- `applyPolicyPatch(patch)` — aplicador de patches de IR → shapes/conns
- GATE: `tests/policyIR.test.js`

**Prompt**:
```
Vamos à Sessão 0 do Copiloto (PolicyIR), conforme docs/wiki/Epicos-CopilotoIA.md
(DEC-IA-002). Implemente buildPolicyIR(shapes, conns, csvStore) como helper global
exportado, o export "JSON canônico da política" na seção Fluxo, o aplicador
applyPolicyPatch (patch de IR → shapes/conns, IDs via contador _id existente) e o
GATE tests/policyIR.test.js: roteamento via IR ≡ motor compilado (M8) sobre as
fixtures de tests/compiledEngine.test.js, round-trip IR→canvas→IR estável, e IR sem
posições/dados. Releia o épico e o código antes de propor.
```

---

## Sessão 1 — Lint/Insights Estruturais

**Documentação**: `docs/wiki/Copiloto-ConstrucaoAssistida.md` (Frente 1, Nível 1)

**Pré-requisitos**: Sessão 0 (PolicyIR)

**O que vai entregar**:
- `COMPUTE_POLICY_INSIGHTS` no worker
- Painel Copiloto no painel direito com achados por severidade
- Quick-fixes não-destrutivos
- GATE: `tests/policyLint.test.js`

**Prompt**:
```
Vamos à Sessão 1 do Copiloto (lint estrutural), conforme
docs/wiki/Copiloto-ConstrucaoAssistida.md e docs/wiki/Epicos-CopilotoIA.md
(DEC-IA-006). Implemente COMPUTE_POLICY_INSIGHTS no worker (reusando
getTickResult/nodeArrivals/lensCounts), o painel Copiloto no painel direito com
achados por severidade + "ir até o nó" + quick-fixes não-destrutivos, e
tests/policyLint.test.js com 1 caso positivo e 1 negativo por regra. Releia o épico
e o código antes de propor.
```

---

## Sessão 2 — Biblioteca de Políticas

**Documentação**: `docs/wiki/Copiloto-ConstrucaoAssistida.md` (Frente 1, Nível 1)

**Pré-requisitos**: Sessão 0, 1

**O que vai entregar**:
- `policyLibrary` (array, persistida no `.credito.json`)
- Modal de aplicação com mapeamento de variáveis
- Pendências visíveis para não mapeadas
- GATE: `tests/policyTemplates.test.js`

**Prompt**:
```
Vamos à Sessão 2 do Copiloto (biblioteca de políticas), conforme
docs/wiki/Copiloto-ConstrucaoAssistida.md. A Sessão 0 entregou o PolicyIR e o
applyPolicyPatch. Implemente policyLibrary (padrão cinemaLibrary: salvar IR +
metadados, export/import JSON, persistência no .credito.json seguindo a regra do
CLAUDE.md), o modal de aplicação com mapeamento de variáveis (padrão
cinemaImportModal + normalizeColName, pendências visíveis para não mapeadas) e
tests/policyTemplates.test.js. Releia o épico e o código antes de propor.
```

---

## Sessão 3 — Sugestão de Próximo Nó

**Documentação**: `docs/wiki/Copiloto-ConstrucaoAssistida.md` (Frente 1, Nível 1)

**Pré-requisitos**: Sessão 0, 1, 2

**O que vai entregar**:
- `COMPUTE_VARIABLE_RANKING` no worker
- Botão "💡 Sugerir próximo passo" na toolbar contextual
- Ranking com IV/WoE + justificativa numérica
- Autocompletar de terminais por risco
- GATE: `tests/variableRanking.test.js`

**Prompt**:
```
Vamos à Sessão 3 do Copiloto (sugestão de próximo nó), conforme
docs/wiki/Copiloto-ConstrucaoAssistida.md. Implemente COMPUTE_VARIABLE_RANKING no
worker (população do anchor via roteamento compilado M8; IV/WoE + variância
ponderada por candidata, O(distintos) na agregação; detecção de interação para
sugerir Cineminha), o botão "💡 Sugerir próximo passo" na toolbar contextual de port
solto com ranking + justificativa numérica + criação em um clique, o autocompletar
de terminais por risco do segmento, e tests/variableRanking.test.js com valores de
controle manuais. Releia o épico e o código antes de propor.
```

---

## Sessão 4 — Goal Seek Estruturado

**Documentação**: `docs/wiki/Copiloto-SugestoesMelhoria.md` (Frente 2, Nível 1)

**Pré-requisitos**: Sessão 0, 1, 2, 3

**O que vai entregar**:
- `COMPUTE_GOAL_SEEK` no worker
- Modal `goalSeekModal` no padrão `johnnyModal`
- Objetivo estruturado + fronteira + movimentos
- Aplicação como novo cenário via `cloneCanvasWithNewIds`
- GATE: `tests/goalSeek.test.js`

**Prompt**:
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

---

## Sessão 5 — Simplificação com Prova de Equivalência

**Documentação**: `docs/wiki/Copiloto-SugestoesMelhoria.md` (Frente 2, Nível 1)

**Pré-requisitos**: Sessão 0, 1, 2, 3, 4

**O que vai entregar**:
- `COMPUTE_SIMPLIFY` no worker
- Detecção de nós colapsáveis, chegada zero, regras sem efeito
- Proposta como patch de IR
- Prova via `computeSimulatedDecisions` diff=0 ou delta declarado
- GATE: `tests/policySimplify.test.js`

**Prompt**:
```
Vamos à Sessão 5 do Copiloto (simplificação com prova de equivalência), conforme
docs/wiki/Copiloto-SugestoesMelhoria.md. Implemente COMPUTE_SIMPLIFY no worker
(detecção de nós colapsáveis, chegada zero, regras sem efeito, variável re-testada;
proposta como patch de IR; prova via computeSimulatedDecisions diff=0 ou delta
declarado), UI de revisão não-destrutiva e tests/policySimplify.test.js. Releia o
épico e o código antes de propor.
```

---

## Sessão 6 — DocGen Local (Documentação Automática)

**Documentação**: `docs/wiki/Copiloto-DocumentacaoAutomatica.md` (Frente 3, Nível 1)

**Pré-requisitos**: Sessão 0, 1, 2, 3, 4, 5

**O que vai entregar**:
- `COMPUTE_POLICY_DOC` no worker
- `docModel` (seções com dados crus)
- Renderers: `renderDocMarkdown` / `renderDocHTML`
- Modal de composição com toggle de domínios
- `diffPolicyIR` para changelog
- GATE: `tests/policyDoc.test.js`

**Prompt**:
```
Vamos à Sessão 6 do Copiloto (documentação automática local), conforme
docs/wiki/Copiloto-DocumentacaoAutomatica.md e docs/wiki/Epicos-CopilotoIA.md
(DEC-IA-006). Implemente COMPUTE_POLICY_DOC no worker devolvendo um docModel
(seções com dados crus: KPIs/incrementalResult, fluxo via PolicyIR, paths achatados,
funil por nó+valor, cenários via pipeline 5B, confiabVolume, glossário), os
renderers puros renderDocMarkdown/renderDocHTML (inline styles, window.print), o
modal de composição com toggle de domínios e o diffPolicyIR para o changelog. GATE
tests/policyDoc.test.js (números ≡ motor, completude, determinismo, privacidade).
Releia o épico e o código antes de propor.
```

---

## Sessão 7 — Camada de Inteligência (Infra de IA)

**Documentação**: `docs/wiki/Epicos-CopilotoIA.md` (Infra, Nível 2)

**Pré-requisitos**: Sessão 0–6 (Nível 1 completo)

**O que vai entregar**:
- Interface `AIProvider` (null provider + registro de adapters)
- Modal de configuração em runtime (credencial nunca no `.credito.json`)
- `ContextBuilder` com níveis N0/N1/N2
- `Redactor` de pseudonimização
- `Validator` de patches de IR (schema + simulação)
- Auditoria local de payloads
- GATE: Testes de contratos (contexto nunca contém N3; patch inválido rejeitado)

**Prompt**:
```
Vamos à Sessão 7 do Copiloto (Camada de Inteligência), conforme
docs/wiki/Epicos-CopilotoIA.md (DEC-IA-003/004/005). Implemente a interface
AIProvider (null provider + registro de adapters, sem escolher provedor concreto),
o modal de configuração em runtime (credencial nunca no .credito.json), o
ContextBuilder com níveis N0/N1/N2 e Redactor de pseudonimização, o Validator de
patches de IR (schema + simulação antes de exibir) e a auditoria local de payloads.
Nenhuma feature nova de IA nesta sessão — só a infraestrutura com testes dos
contratos (contexto nunca contém N3; patch inválido rejeitado). Releia o épico e o
código antes de propor.
```

---

## Sessão 8 — Enriquecimentos de IA por Frente

**Documentação**: `docs/wiki/Epicos-CopilotoIA.md` (Nível 2)

**Pré-requisitos**: Sessão 0–7 (Nível 1 completo + Infra)

**O que vai entregar**:
- **Frente 1**: Descrição em NL → esqueleto de política; leitura semântica de nomes
- **Frente 2**: Objetivo em NL → objetivo estruturado; explicação narrativa de propostas
- **Frente 3**: Reescrita em prosa executiva; sumário; adaptação de tom/audiência
- Botões "✨ Refinar com IA" contextuais
- GATE: Números citados no output IA sempre existem na fonte local

**Prompt**:
```
Vamos à Sessão 8 do Copiloto (enriquecimentos de IA), conforme
docs/wiki/Epicos-CopilotoIA.md (Nível 2). Implemente, por frente, os adaptadores de
IA para as três capacidades:
  - Frente 1: NL→PolicyIR (esqueleto validado pelo Validator); leitura semântica de nomes.
  - Frente 2: NL→objetivo estruturado (parsing com confirmação); narrativa executiva de propostas.
  - Frente 3: reescrita docModel em prosa; sumário; adaptação de audiência.
Botões "✨ Refinar com IA" aparecem só com provedor configurado e capability compatível.
GATE: toda métrica citada no texto IA existe no docModel/resultados locais (Validator
rejeita divergências). Releia o épico, as frentes e o código antes de propor.
```

---

## Sessão 9 — Chat com a Política (Copiloto Conversacional)

**Documentação**: `docs/wiki/Epicos-CopilotoIA.md` (Nível 3)

**Pré-requisitos**: Sessão 0–8

**O que vai entregar**:
- Interface de chat no painel
- Grounding em PolicyIR + métricas agregadas (nunca dados linha a linha)
- Fallback local: busca estruturada (sem prosa)
- Planos compostos: sequências de movimentos com narrativa
- Documentação viva: Q&A sobre documento gerado
- Changelog comentado entre versões

**Prompt**:
```
Vamos à Sessão 9 do Copiloto (chat contextual), conforme
docs/wiki/Epicos-CopilotoIA.md (Nível 3). Implemente a interface de chat no painel
(mensagens, histórico de sessão) com grounding em PolicyIR + métricas agregadas do
docModel (estrutura, valores, regras, números — nunca dados linha a linha). Cada
resposta é gerada pelo AIProvider com contexto N0/N1 e validada antes de exibir
(Validator existente). Fallback local: busca estruturada no IR sem prosa (quando
provedor ausente ou timeout). Suporte a: "por que o port X está sem saída?", "onde
uso a variável Score?", "compare cenários A e B" (com citação de artefatos do
motor). Planos compostos: sequências de Goal Seek com narrativa de trade-offs.
Documentação viva: Q&A sobre o docModel gerado; changelog comentado entre versões.
Releia o épico e o código antes de propor.
```

---

## Sessão 10 — Motor de Descoberta de Segmentos

**Documentação**: `docs/wiki/Copiloto-DescobertaSegmentos.md` (Frente 4, Nível 1 — MVP)

**Pré-requisitos**: Sessões 0–5 (usa `computeIV` da Sessão 3, walk compilado M8, padrões do worker). **Não** depende das Sessões 7–9.

**🏷️ Modelo recomendado**: `Opus 4.8` — núcleo algorítmico (beam search, testes estatísticos, FDR, dedup) com GATE numérico de valores de controle manuais.

**O que vai entregar**:
- `COMPUTE_SEGMENT_DISCOVERY` no worker → `SEGMENT_DISCOVERY_RESULT {segmentModel}`
- Pipeline em funções exportadas: `discoverSegments` (beam 1D/2D sobre dicionários, escopo global ou por nó via walk compilado), `explainSegment` (decomposição WoE, lift, teste binomial + Benjamini–Hochberg, **`dispersion`** — em quais nós/terminais a política atual decide o segmento hoje, computada no mesmo walk do escopo), `prioritizeFindings` (score impacto × confiança × acionabilidade + dedup de aninhados)
- Métrica-alvo como parâmetro estruturado `{col, denominator, direction}` (DEC-SD-006) — o MVP fecha em `inadReal`/`inadInferida`, mas nenhuma função interna do pipeline assume inad
- Achados do MVP: `approvable_low_risk`, `approved_high_risk`, `heterogeneous_block`
- Rigor estatístico: volume mínimo, shrinkage (`SHRINK_K`), FDR, teto de profundidade, `diagnostics` com contadores de descarte
- GATE: `tests/segmentDiscovery.test.js`

**Prompt**:
```
Vamos à Sessão 10 do Copiloto (motor de Descoberta de Segmentos), conforme
docs/wiki/Copiloto-DescobertaSegmentos.md (DEC-SD-001/002) e
docs/wiki/Epicos-CopilotoIA.md. Implemente COMPUTE_SEGMENT_DISCOVERY no worker
devolvendo o SegmentModel (dados crus, padrão docModel): discoverSegments com beam
search de conjunções LensRule 1D/2D sobre as colunas de decisão (agregação
O(distintos) sobre os dicionários, NUNCA produto cartesiano cego; escopo global ou
população de um nó via walk compilado M8, mesmo padrão de computeVariableRanking),
explainSegment (decomposição WoE por condição reusando computeIV/bins da Sessão 3,
lift vs. complemento, teste binomial + correção Benjamini–Hochberg, e dispersion —
em quais nós/terminais a política ATUAL decide o segmento hoje, com share por
terminal, computada no MESMO walk que resolve o escopo, sem passe extra) e
prioritizeFindings (score impacto × confiança × acionabilidade, shrinkage SHRINK_K,
dedup de segmentos aninhados sem ganho incremental, diagnostics com contadores de
descarte). A métrica-alvo entra no pipeline como parâmetro estruturado
{col, denominator, direction} (DEC-SD-006) — o formulário só oferece
inadReal/inadInferida por ora, mas NENHUMA função interna deve hardcodar inad.
Achados desta sessão: approvable_low_risk, approved_high_risk,
heterogeneous_block. Sem UI nesta sessão (só o motor + GATE). GATE
tests/segmentDiscovery.test.js: subgrupo plantado em fixture sintética é encontrado
com as condições exatas e fixture homogênea devolve zero achados; agregados de cada
achado ≡ agregação manual via matchLensRule; dispersion ≡ contagem manual por
terminal em fixture com segmento espalhado por 2+ nós; p-value bate com valor de
controle manual; FDR descarta o ruído da fixture de múltiplas comparações; shrinkage
rebaixa nicho minúsculo; escopo por nó ≡ sub-base filtrada manualmente; dedup;
determinismo. Releia o épico, a frente e o código antes de propor.
```

---

## Sessão 11 — Painel de Oportunidades (UI da Descoberta)

**Documentação**: `docs/wiki/Copiloto-DescobertaSegmentos.md` (Frente 4, Nível 1 — MVP)

**Pré-requisitos**: Sessão 10

**🏷️ Modelo recomendado**: `Sonnet 5` — UI sobre padrões consolidados (`goalSeekModal`/`simplifyModal`, Recharts do Dashboard), motor já pronto e testado.

**O que vai entregar**:
- Botão **🔍 Descobrir Segmentos** na seção Fluxo (escopo global) e **🔍 Descobrir aqui** na toolbar contextual de nó (escopo = população do nó)
- `segmentDiscoveryModal` (efêmero, padrão `goalSeekModal`): formulário mínimo com defaults → loading → cards de oportunidade ranqueados (regra + métricas com referência + barra de contribuições + frase de dispersão "hoje decidido em N nós" quando `dispersion.nodesCount > 1` + selos de confiança + diagnostics)
- **Filtro por variável** no modal (facet sobre `conditions[].col` — navegação centrada na variável, client-side sobre o `SegmentModel` pronto)
- Quadrante volume × risco (Recharts, dentro do modal — exceção DEC-AW-001)
- **👁 Ver no Dashboard** (converte `SegmentDef.conditions` em `FilterCard[]` de página) e **ver no fluxo** (highlight reusando o "ir até o nó" do lint)
- Achado informativo 🔵 no painel Copiloto apontando para a Descoberta (link, não segunda lista)

**Prompt**:
```
Vamos à Sessão 11 do Copiloto (UI da Descoberta de Segmentos), conforme
docs/wiki/Copiloto-DescobertaSegmentos.md. A Sessão 10 entregou
COMPUTE_SEGMENT_DISCOVERY e o SegmentModel. Implemente o segmentDiscoveryModal
(efêmero, padrão goalSeekModal: form mínimo com defaults → loading → resultado),
os dois pontos de entrada (🔍 Descobrir Segmentos na seção Fluxo, escopo global;
🔍 Descobrir aqui na toolbar contextual de losango/Cineminha/lens/terminal, escopo =
população do nó), os cards de oportunidade (condições em linguagem de regra, métricas
sempre com referência e lift, barra de decomposição das contribuições, frase de
dispersão via template determinístico quando dispersion.nodesCount > 1 — "hoje este
segmento está diluído em N nós da política: X% decidido em A, Y% em B" — e, quando o
escopo é um nó, o contexto condicional declarado, selos de confiança, contadores de
diagnostics visíveis), o filtro de achados por variável (facet client-side sobre
conditions[].col — navegação centrada na variável), o quadrante volume × risco em
Recharts dentro do modal (clique no ponto foca o card), a ação "👁 Ver no Dashboard"
(SegmentDef.conditions → FilterCard[] de filtro de página — mesmo formato LensRule) e
o "ver no fluxo" reusando o highlight do lint. Adicione o achado informativo 🔵 no
painel Copiloto linkando para a Descoberta (sem duplicar a lista). Nenhuma
persistência nova (modal efêmero). Sem IA. Releia a frente e o código antes de propor.
```

---

## Sessão 12 — Recomendações Acionáveis + Integração Goal Seek

**Documentação**: `docs/wiki/Copiloto-DescobertaSegmentos.md` (Frente 4, fase intermediária)

**Pré-requisitos**: Sessões 10, 11 (e 4 — Goal Seek)

**🏷️ Modelo recomendado**: `Opus 4.8` — integra PolicyIR/applyPolicyPatch/applyGoalSeekMoves e exige GATE de delta re-simulado (matemática de validação sutil).

**O que vai entregar**:
- `buildSegmentRecommendations` no worker: cada achado → patch (lens de exceção via `applyPolicyPatch`; movimento do catálogo do Goal Seek via `applyGoalSeekMoves` quando o segmento coincide com célula/valor/limiar existente; quebra via fluxo da Sessão 3 para `heterogeneous_block`)
- Delta de cada recomendação validado por **re-simulação real** (top-N apenas), exibido no card
- **✓ Aplicar como novo cenário** (`cloneCanvasWithNewIds`, política de origem intocada) e **🎯 Enviar ao Goal Seek** (objetivo pré-carregado)
- **Aplicação combinada**: seleção de N achados → um único cenário com todos os patches em sequência sobre o mesmo clone, delta combinado por **uma re-simulação real** (deltas de achados NÃO são aditivos — aplicar A muda a população de B); interação relevante entre achados é declarada, nunca escondida
- Movimento **"adicionar quebra"** no catálogo do Goal Seek (pendência da Sessão 4, gerada pelo achado `heterogeneous_block`)
- Achados `asis_divergence` (decomposição rToA/aToR por segmento sobre o overlay existente) e `anomaly` (desvio robusto por valor/safra) — sem patch, só navegação
- Selo de estabilidade temporal (split-half quando há coluna `temporal`) + sparkline no card
- Travas 🔒 respeitadas (ação desabilitada com motivo)
- GATE estendido: `tests/segmentDiscovery.test.js`

**Prompt**:
```
Vamos à Sessão 12 do Copiloto (recomendações acionáveis da Descoberta), conforme
docs/wiki/Copiloto-DescobertaSegmentos.md (DEC-SD-003) e
docs/wiki/Copiloto-SugestoesMelhoria.md. Implemente buildSegmentRecommendations no
worker: para cada achado, gere o patch correspondente SEM criar segundo aplicador
(DEC-IA-002) — lens de exceção materializada por applyPolicyPatch; quando o segmento
coincide com célula/valor/limiar existente, use o formato de movimento do Goal Seek e
applyGoalSeekMoves; heterogeneous_block vira criação de losango/Cineminha no padrão
da Sessão 3. Valide o delta dos top-N achados por re-simulação real (runSimulation
sobre clone com o patch — mesmo contrato DEC-IA-005 do Goal Seek) e exiba só deltas
validados. UI: "✓ Aplicar como novo cenário" via cloneCanvasWithNewIds e "🎯 Enviar
ao Goal Seek" com objetivo pré-carregado. Implemente também a APLICAÇÃO COMBINADA:
seleção de N achados no modal → um único cenário novo com os patches aplicados em
sequência sobre o MESMO clone, com delta combinado validado por UMA re-simulação real
— NUNCA a soma dos deltas individuais (aplicar o achado A muda a população que chega
ao ponto do achado B); quando o combinado diverge relevantemente da soma, declare a
interação no modal em vez de esconder. Adicione ao catálogo do Goal Seek o
movimento "adicionar quebra" (pendência declarada da Sessão 4), gerado pelo achado
heterogeneous_block. Acrescente os achados asis_divergence (decomposição do
rToA/aToR por segmento, reusando computeSimulatedDecisions/incrementalResult) e
anomaly (desvio robusto mediana/MAD por valor e por safra quando há coluna temporal)
— ambos sem patch, com navegação (filtro de Dashboard/highlight). Selo de
estabilidade split-half temporal + sparkline no card; travas 🔒 desabilitam a ação
com motivo declarado. Estenda tests/segmentDiscovery.test.js: delta exibido ≡
runSimulation antes/depois para cada tipo de recomendação; delta COMBINADO ≡
runSimulation do clone com os N patches, e difere da soma dos individuais em fixture
com achados que interagem; movimento "adicionar quebra" ≡ criação manual equivalente;
asis_divergence bate com o incrementalResult agregado; nó travado ⇒ não-acionável;
determinismo. Releia a frente, o épico e o código antes de propor.
```

---

## Sessão 13 — Enriquecimento de IA da Descoberta

**Documentação**: `docs/wiki/Copiloto-DescobertaSegmentos.md` (Frente 4, Nível 2 — DEC-SD-004)

**Pré-requisitos**: Sessões 10–12 **e Sessão 7** (AIProvider/ContextBuilder/Validator/Redactor)

**🏷️ Modelo recomendado**: `Sonnet 5` para o desenvolvimento (adapters sobre infra pronta). Em runtime: `Haiku 4.5` para rótulos/narrativas curtas (batch), `Sonnet 5` para hipóteses de causa e tom de comitê.

**O que vai entregar**:
- **✨ Nomear segmentos** (batch: top-N achados numa chamada estruturada JSON in/out; rótulo exibido AO LADO da regra formal, nunca no lugar)
- **✨ Explicar achado** (narrativa executiva sob demanda, por card — lazy, nunca automática)
- **✨ Hipóteses de causa** (claramente rotuladas como hipótese)
- Cache local por hash do achado (condições + métricas arredondadas) — reabrir o modal não re-chama a IA
- Contexto via ContextBuilder (N0/N1; N2 só com opt-in); Validator rejeita texto citando número inexistente no SegmentModel
- Degradação limpa: sem provedor, cards usam regra formal + templates de frase
- GATE de contrato (payload nunca contém N3; divergência numérica rejeitada)

**Prompt**:
```
Vamos à Sessão 13 do Copiloto (IA da Descoberta de Segmentos), conforme
docs/wiki/Copiloto-DescobertaSegmentos.md (DEC-SD-004) e docs/wiki/Epicos-CopilotoIA.md
(DEC-IA-003/004/005). A Sessão 7 entregou AIProvider/ContextBuilder/Validator/
Redactor. Implemente os três enriquecimentos do segmentDiscoveryModal: ✨ Nomear
segmentos (batch dos top-N achados em UMA chamada estruturada JSON in/out — otimização
de custo; rótulo sempre exibido ao lado da regra formal), ✨ Explicar achado (narrativa
executiva por card, sob demanda/lazy, nunca automática na abertura do modal) e
✨ Hipóteses de causa (rotuladas visualmente como hipótese, nunca afirmadas como fato).
Contexto montado exclusivamente pelo ContextBuilder (N0/N1, N2 só com o opt-in
existente; payload por achado < 4KB); cache local por hash do achado (condições +
métricas arredondadas); botões ✨ só aparecem com provedor configurado e capability
compatível; degradação limpa para regra formal + templates sem provedor. GATE de
contrato: payload enviado nunca contém N3 nem linhas do csvStore; texto citando
métrica inexistente no SegmentModel é rejeitado pelo Validator antes de exibir.
Releia a frente, o épico e o código antes de propor.
```

---

## Checklist de Execução

- [x] **Sessão 0** — PolicyIR ✅
- [x] **Sessão 1** — Lint/Insights ✅
- [x] **Sessão 2** — Biblioteca de políticas ✅
- [x] **Sessão 3** — Sugestão de próximo nó ✅
- [x] **Sessão 4** — Goal Seek ✅
- [x] **Sessão 5** — Simplificação ✅
- [x] **Sessão 6** — DocGen ✅
- [ ] **Sessão 10** — Motor de Descoberta de Segmentos 🏷️ `Opus 4.8`
- [ ] **Sessão 11** — Painel de Oportunidades (UI) 🏷️ `Sonnet 5`
- [ ] **Sessão 12** — Recomendações Acionáveis + Goal Seek 🏷️ `Opus 4.8`
- [ ] **Sessão 7** — Camada de IA 🏷️ `Opus 4.8`
- [ ] **Sessão 8** — Enriquecimentos IA 🏷️ `Sonnet 5`
- [ ] **Sessão 13** — IA da Descoberta 🏷️ `Sonnet 5`
- [ ] **Sessão 9** — Chat 🏷️ `Opus 4.8`

---

## Resumo das Dependências

```
Sessão 0 (PolicyIR)
    ↓
Sessão 1 (Lint) ← reusa IR + nodeArrivals
    ↓
Sessão 2 (Templates) ← reusa Lint + IR
    ↓
Sessão 3 (Ranking) ← reusa Lint + Templates
    ↓
Sessão 4 (Goal Seek) ← reusa Ranking + computeJohnnyData
    ↓
Sessão 5 (Simplify) ← reusa Goal Seek + IR
    ↓
Sessão 6 (DocGen) ← reusa tudo acima (IR + agregados)
    ↓
Sessão 10 (Descoberta: motor) ← reusa computeIV (S3), walk M8, SHRINK_K (Johnny)
    ↓
Sessão 11 (Descoberta: UI) ← reusa goalSeekModal/lint-highlight/FilterCard
    ↓
Sessão 12 (Descoberta: recomendações) ← reusa applyPolicyPatch (S0),
    │                                    applyGoalSeekMoves (S4), overlay AS IS
    ↓
Sessão 7 (Infra IA) ← nenhuma dependência funcional, só estrutural
    ↓
Sessão 8 (Enriquecimentos IA) ← reusa Sessões 1–6 + Infra 7
    ↓
Sessão 13 (IA da Descoberta) ← reusa SegmentModel (S10–12) + Infra 7
    ↓
Sessão 9 (Chat) ← reusa tudo (incl. SegmentModel como artefato groundável)
```

---

## Padrões Gerais

Cada sessão segue o mesmo template:

1. **Leia** o documento da frente (referência no início do prompt)
2. **Releia** o épico principal e o CLAUDE.md
3. **Reutilize** código existente (tabelas "Reutilização" em cada frente listam o que já existe)
4. **Implemente** o worker + UI + GATE (teste)
5. **Persistência**: seguir a ⚠️ regra do CLAUDE.md (`buildProjectPayload` + `loadProject`)
6. **Teste**: rodar o GATE e verificar equivalência/determinismo

---

**Última atualização**: 2026-07-08 (Sessões 10–13 — Frente 4: Descoberta de Segmentos, com tags de modelo)
