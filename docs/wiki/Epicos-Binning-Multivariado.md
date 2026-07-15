# Épico futuro — Binning Multivariado (árvore rasa → sugestão de Cineminha)

> **Status: NÃO INICIADO — escopo registrado para execução futura.** Nascido como item
> "fora de escopo" do Épico FR ([[Copiloto-ClusterContextual-FaixasRisco]], § Fora de
> escopo). Este capítulo detalha o escopo para que o épico possa ser executado quando a
> demanda aparecer, sem redescobrir as decisões. Nenhuma linha de código deste épico
> existe hoje.

## O problema que ele resolve

O Criar Faixas por Risco (FR4–FR6) é **univariado**: encontra os cortes ótimos de UMA
coluna contínua isoladamente. Quando duas variáveis contínuas interagem fortemente
(ex.: o corte "certo" de faturamento presumido muda conforme o score), os cortes
univariados podem ser enganosos — cada um é ótimo sozinho, mas a combinação não captura
a interação.

O que o app já cobre hoje, **sem** este épico (por composição):

1. **Cineminha** — cruzamento 2D de duas variáveis binadas + otimizadores (single/Johnny)
   escolhendo células: já entrega decisão 2D otimizada sobre faixas univariadas.
2. **Escopo por nó** (FR1–FR3) — "Criar faixas aqui" dentro de um nó/segmento do fluxo:
   já permite cortes de X **diferentes por população**, que é a interação mais comum na
   prática.

O que só o multivariado nativo agrega: descobrir a interação quando o usuário **não sabe
de antemão** quais variáveis cruzar nem onde segmentar — os cortes de X condicionais a Y
saem do algoritmo, não da curadoria manual.

## Forma escolhida: árvore de decisão rasa, NÃO grade MILP 2D

Duas formas clássicas foram avaliadas ao registrar o escopo:

- **Grade 2D simultânea** (cortes globais em X e Y ao mesmo tempo, monotonia como ordem
  parcial / "Young diagram") — descartada como forma principal: o espaço de busca explode
  (combinações k₁×k₂ de cortes), a monotonia 2D é bem mais cara de garantir, e o
  resultado é essencialmente o que Cineminha + otimizador já produzem.
- **Árvore de decisão rasa** (estilo CART, profundidade ≤ 2–3) — **escolhida**: captura
  interação de verdade (corte de X condicional ao valor de Y), tem restrições naturais
  de volume mínimo por folha (análogo ao `minShare` da DP univariada, DEC-FR-005) e de
  monotonia por ramo, e o resultado mapeia direto para o paradigma do produto.

## Decisão de produto central: o resultado é uma SUGESTÃO DE CINEMINHA

O maior custo do multivariado não é o algoritmo — é a superfície de produto que um tipo
novo de artefato exigiria (regiões 2D não cabem no `rangeDefs` por coluna; precisariam
de novo modelo de materialização, UX de edição de regiões, persistência com bump de
schema, seção própria na Documentação, representação no PolicyIR).

Para não pagar esse custo, o épico entrega o resultado **reaproveitando a infraestrutura
existente**: a árvore rasa é convertida em

1. **duas variáveis de faixas univariadas** (`rangeDefs` — os cortes que a árvore usou em
   cada eixo, união dos cortes condicionais), e
2. **uma Cineminha sugerida** cruzando as duas, com as células pré-marcadas conforme as
   folhas da árvore (elegível/não elegível ou oferta),

que o usuário cura como qualquer Cineminha. Zero tipo novo de shape, zero schema novo
além do que `rangeDefs` + `cinemaLibrary` já cobrem, Documentação/PolicyIR/persistência
funcionam de graça.

## Onde roda: sidecar Python (Classe B)

- A busca de árvore com restrições (min share por folha, monotonia por ramo, poda por
  ganho de IV) é cara e naturalmente vetorizável — candidata a motor numpy no sidecar,
  como Descoberta profunda (H7) e Clusterização (H8).
- **Classe B** no ComputeRouter (fallback transparente): sem sidecar, ou o recurso não é
  oferecido, ou roda uma versão browser reduzida (profundidade 2, pré-bins de 50 quantis
  por eixo — a decidir na especificação das sessões).
- Paridade cross-runtime obrigatória se houver versão browser: fixtures douradas
  número a número (padrão DEC-HX-005), como `tests/segmentDiscoveryGolden.test.js` /
  `tests/clusterSegmentsGolden.test.js`.

## Esboço de escopo por sessão (a refinar quando o épico abrir)

| Sessão | Entrega |
|---|---|
| BM1 | Motor: árvore rasa supervisionada (IV/WoE via `resolveRiskMetric`), min share, monotonia por ramo, determinismo; pré-binning por quantis reutilizado do `computeRiskBands` |
| BM2 | Conversão árvore → (2× `rangeDefs` + Cineminha sugerida com células pré-marcadas); prova de fidelidade: roteamento da Cineminha gerada ≡ folhas da árvore |
| BM3 | Sidecar: motor numpy + fixtures douradas cross-runtime (se BM1 tiver versão browser); roteamento Classe B |
| BM4 | UI: entrada pelo mesmo menu do "Criar Faixas por Risco" (par de colunas contínuas), preview com qualidade (IV vs. univariado ×2), escopo por nó via `COMPUTE_SCOPE_MASK` (FR3) |
| BM5 | Sincronização documental (padrão FR7) |

## Critérios para abrir o épico (gatilhos de demanda)

- Usuário pedindo explicitamente cortes condicionais ("o corte de faturamento deveria
  ser outro para score alto") que o escopo por nó não resolve com curadoria razoável; ou
- Casos reais em que o IV da melhor Cineminha curada manualmente fica materialmente
  abaixo do IV de uma árvore rasa exploratória (vale medir antes de construir).

## Fora de escopo DESTE épico (já decidido)

- Grade MILP 2D exata (ver acima — descartada como forma principal).
- Mais de 2 variáveis por cruzamento (profundidade > 3): explode a legibilidade da
  política; contra a filosofia do produto (política legível e curável).
- Faixas profundas no sidecar para o caso univariado (MILP estilo `optbinning`) — item
  separado, também fora de escopo: a DP browser já é exata dado o pré-binning de 50
  quantis; volume de dados NÃO é justificativa (a DP roda sobre ≤50 pré-bins,
  independente do nº de linhas; se o pré-binning O(n) pesar um dia, rotea-se o
  pré-binning para o sidecar, não se troca o solver).
