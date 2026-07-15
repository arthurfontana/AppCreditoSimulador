# Clusterização Contextual + Faixas de Risco — Plano de Execução (Épico FR)

> **Ordem de execução recomendada**: as duas cadeias são independentes e podem ser
> intercaladas — **FR1 → FR2 → FR3** (escopo por nó da Clusterização) e
> **FR4 → FR5 → FR6** (Faixas de Risco de variáveis contínuas). **FR7**
> (sincronização documental) é sempre a última.
>
> Referência normativa: esta página (DEC-FR-001..010 — **leia inteira antes de
> qualquer sessão**) · [[Arquitetura-Execucao-Hibrida]] (DEC-HX-001..009, em especial
> H8/Clusterização) · [[Copiloto-DescobertaSegmentos]] (escopo por nó já existente) ·
> `docs/claude/Copiloto-Clusterizacao.md` (Variável de Cluster — o padrão de
> materialização que a FR5 espelha) · `docs/claude/Copiloto-Segmentos.md` (walk M8 de
> escopo) · `docs/claude/Worker-Protocolo.md` (mensagens `COMPUTE_*`).
>
> **🏷️ Tag de modelo por sessão**: `[OPUS]` para núcleo algorítmico/matemática sutil ou
> paridade cross-runtime; `[SONNET]` para UI/materialização sobre padrões consolidados e
> bem especificados; `[HAIKU]` para sincronização documental mecânica.
>
> **Regras transversais (valem para TODAS as sessões):**
> 1. `npm test` passa inalterado ao fim de cada sessão — os GATEs existentes
>    (`tests/clusterSegments.test.js`, `tests/clusterSegmentsGolden.test.js`,
>    `tests/clusterVar.test.js`, `tests/segmentDiscovery.test.js`) são contrato; sessões
>    só ADICIONAM casos/arquivos.
> 2. **`scope = null` (ou ausente) ⇒ comportamento byte-a-byte idêntico ao atual** em
>    todos os caminhos tocados. As fixtures douradas H8 NÃO são regeneradas neste épico
>    (se um GATE dourado falhar, pare e investigue — regra do CLAUDE.md).
> 3. O tick de edição JAMAIS roteia para o sidecar (DEC-HX-007, regra de ouro). As
>    Faixas de Risco são **Classe A** (DEC-FR-004): browser/worker sempre, sidecar nunca.
> 4. Todo número exibido vem de agregação exata sobre a base (nunca estimado); todo
>    algoritmo é determinístico (mesma entrada ⇒ mesmo modelo, incl. seeds derivadas).
> 5. Degradação/teto/aproximação sempre **declarada na UI**, nunca silenciosa (padrão P4
>    da Execução Híbrida) — vale para truncamento de pontos, faixas não monotônicas e
>    fallback do modo profundo.
> 6. **Regra inviolável do CLAUDE.md**: o que o usuário cria/ajusta PRECISA ser salvo.
>    `rangeDefs` (FR5) entra em `csvStore[csvId]` (contêiner já salvo), com round-trip
>    coberto por GATE e bump de `schemaVersion` (2.6 → 2.7). Os modais de análise
>    (`clusterModal`, `rangeModal`) continuam efêmeros — só a variável derivada persiste.
> 7. Nada de framework novo no front nem no Python; nenhum gráfico Recharts fora da aba
>    Dashboard (ADR-003 — o resultado do `rangeModal` usa SVG/HTML inline, como o
>    quadrante do `clusterModal`).

---

## Visão do épico

Duas dores levantadas na análise de produto de 15/07/2026, ambas sobre a ferramenta de
Clusterização (e uma delas transbordando para toda variável contínua):

1. **Clusterização Contextual (FR1–FR3)** — hoje o "🧩 Clusterizar Segmentos" só roda
   sobre a base inteira. A Descoberta de Segmentos já sabe rodar "a partir de um nó"
   (botão "🔍 Descobrir aqui" → walk compilado M8 filtra as linhas cujo roteamento REAL
   passa pelo nó), mas `computeClusterSegments` nem recebe `shapes`/`conns`. O usuário
   quer clusterizar **a população que efetivamente chega a um losango/Cineminha/Lens**
   — ex.: "agrupe por comportamento só as propostas que saem deste porte".

2. **Faixas de Risco (FR4–FR6)** — variável contínua (ex.: faturamento presumido) hoje
   não funciona como dimensão de análise: o agrupamento é por valor exato, e bucketizar
   manualmente (Agrupamentos do Dashboard, `autoBuckets`) corta por tamanho de grupo,
   **não por risco** — "por que cortar em 200 mil e não em 300 mil?" fica sem resposta.
   A ferramenta nova descobre os cortes que **maximizam a discriminação de
   inadimplência** (binning supervisionado por IV/WoE — técnica padrão de scorecard),
   monotônicos por padrão, e materializa o resultado como **variável derivada
   persistente** (mesmo padrão da Variável de Cluster): chip arrastável ao canvas,
   dimensão no Dashboard e dimensão discreta legítima para a própria Clusterização.

### Filosofia (decisões de produto, 15/07/2026)
- **Monotônico por padrão + toggle** (DEC-FR-005): faixas nascem defensáveis em comitê
  de crédito; o corte livre existe, mas é opt-in e declarado.
- **Ferramenta própria + integrada** (DEC-FR-008): "📐 Faixas de Risco" é um botão
  próprio do painel do Copiloto E um atalho dentro do form de Clusterização quando a
  dimensão escolhida é contínua. A variável derivada aparece na lista de Variáveis de
  Decisão (canvas e Dashboard) como qualquer coluna Filtro.
- **Mesmo épico, sessões separadas**: as duas cadeias não se bloqueiam; qualquer uma
  entrega valor sozinha.

---

## Decisões de arquitetura (DEC-FR)

| DEC | Decisão (resumo) |
|-----|------------------|
| DEC-FR-001 | Escopo por nó do cluster: `computeClusterSegments` ganha `(shapes, conns, scope)`; linhas do escopo saem de um walk compilado M8 **single-sourced no worker** (helper `resolveScopeRowMask` extraído do padrão de `discoverSegments`); `scope=null` ⇒ byte-idêntico a hoje |
| DEC-FR-002 | UI do escopo: botão "🧩 Clusterizar aqui" nas toolbars de losango/Cineminha/Lens (mesmo padrão do "🔍 Descobrir aqui"); o modal exibe o escopo em TODOS os passos; painel lateral continua = global |
| DEC-FR-003 | Modo profundo (sidecar H8) com escopo: a máscara de linhas (bitmask base64) viaja nos `params` do job `cluster_segments` — o walk de política NUNCA é portado ao Python; fallback ao worker clampado preserva o MESMO escopo |
| DEC-FR-004 | Motor de Faixas de Risco: pré-bins por quantis ponderados por volume (≤ 50) + **programação dinâmica exata** maximizando IV (`computeIV` existente); métrica-alvo via `resolveRiskMetric` (DEC-SD-006); piso de volume por faixa (`minShare` 5%); k manual (2–7) ou automático por ganho marginal de IV; **Classe A — nunca roteia ao sidecar** |
| DEC-FR-005 | Monotonicidade: default = taxas monotônicas ao longo das faixas (direção detectada automaticamente, testando as duas); toggle "permitir faixas não monotônicas" libera a DP sem restrição, com selo declarado no resultado |
| DEC-FR-006 | Valores não numéricos/vazios ⇒ banda "Sem valor" fora da otimização, sempre exibida (rótulo editável); parsing numérico com a MESMA semântica de `cellNum` do worker |
| DEC-FR-007 | Persistência: `csvStore[csvId].rangeDefs[col]` (RangeDef — faixas semiabertas `[min, max)`) + coluna derivada dict-encoded (`columnTypes='decision'`, `varTypes='ordinal'`); `schemaVersion` 2.6 → 2.7; regra inviolável do CLAUDE.md aplicada na íntegra |
| DEC-FR-008 | A Clusterização NUNCA binariza contínua silenciosamente: dimensão detectada como contínua exibe aviso + botão "📐 Gerar faixas" (abre o `rangeModal` pré-preenchido; ao salvar, a dim é substituída pela coluna derivada). Mantém o `ClusterModel` reprodutível e os GATEs H8 intocados |
| DEC-FR-009 | Edição e refs: `rangeVarModal` edita pontos de corte e rótulos; re-materializa e propaga por todas as abas **reusando** `renameClusterColumnRefs`/`renameClusterLabelRefs` (são genéricos por nome de coluna/rótulo) + `applyRefTransformAllCanvases` |
| DEC-FR-010 | Transparência estatística: o resultado exibe IV otimizado vs. IV de quantis uniformes com o mesmo k (o "quanto o corte por risco ganha do corte cego"), WoE/volume/share/taxa por faixa e o selo de monotonia — nunca só os números de corte |

### DEC-FR-001 — Escopo por nó da Clusterização (worker)

`computeClusterSegments(csvStore, params)` passa a `computeClusterSegments(csvStore,
params, scopeCtx = null)`, onde `scopeCtx = {shapes, conns, scope:{nodeId}}`:

- **Walk single-sourced**: novo helper `resolveScopeRowMask(shapes, conns, csvStore,
  scopeNodeId)` no worker devolve, por `csvId`, um `Uint8Array` de pertencimento
  (1 = a linha passa pelo nó no roteamento real) usando o MESMO caminho compilado M8 da
  raiz do motor que `discoverSegments` usa hoje (linhas cujo walk atinge `scopeNodeId`).
  O helper é **extraído sem alterar** a matemática de `discoverSegments` — se a extração
  exigir refactor do walk inline de lá, o GATE `tests/segmentDiscovery.test.js` prova a
  equivalência (mesmos achados, número a número).
- Dentro de `computeClusterSegments`, a máscara filtra as linhas ANTES da agregação por
  tupla de dims — todo o resto (features, z-score, k-means, seed, tetos) opera sobre a
  subpopulação sem NENHUMA outra mudança. `model.population` reflete o escopo;
  `model.scope = null | {nodeId, label}` é campo novo (aditivo) do `ClusterModel`.
- **Seed**: `clusterSeedOf` ganha o `scopeNodeId` como componente adicional APENAS
  quando escopo ≠ null (global permanece com a seed atual ⇒ fixtures douradas intactas).
- Escopo vazio (nenhuma linha chega ao nó) ⇒ `model.error = 'no_rows'` com o escopo
  preenchido — a UI declara "nenhuma proposta chega a este nó na simulação atual".
- Winner de csv: com escopo, o csv é o do fluxo que contém o nó (mesma resolução de
  `discoverSegments`); `params.csvId` explícito continua vencendo quando compatível.

### DEC-FR-002 — UI do escopo

- Toolbars de `decision`, `cineminha` e `decision_lens` (as MESMAS que hoje têm
  "🔍 Descobrir aqui", `src/App.jsx` ~6839/6887/6915) ganham "🧩 Clusterizar aqui" →
  `openClusterModal({nodeId: sel})`. Painel lateral (~7562) continua chamando
  `openClusterModal()` = global.
- `clusterModal` ganha `scope: null | {nodeId, label}` (label = `getNodeLabel` do nó no
  momento da abertura). O escopo aparece como pílula no header do modal em TODOS os
  passos (`form`/`loading`/`result`/`save`/`saved`): `🧩 População: chegando em
  "{label}"` vs. `🧩 População: base inteira`.
- `runClusterSegments` envia `shapes`/`conns`/`scope` na mensagem quando escopo ≠ null
  (ausentes ⇒ global, retrocompat total do handler).
- "👁 Ver no Dashboard" com escopo ativo: os FilterCards do cluster continuam sendo
  gerados normalmente (dimensões do cluster), MAS o aviso do Dashboard declara que o
  cluster foi calculado numa subpopulação (nota no toast/banner) — o filtro de página
  não reproduz o walk de política, e isso é DECLARADO, não escondido.
- "➕ Salvar como variável" com escopo: permitido — a definição (`clusterDefs`) já é por
  listas de valores; a materialização `deriveClusterColumn` é global por natureza
  (bounding box aplicado à base inteira) e o passo `save` declara: "os grupos foram
  aprendidos na população do nó; a variável classifica a base inteira por essas regras".

### DEC-FR-003 — Modo profundo (sidecar) com escopo

- O dataset registrado por hash (DEC-HX-006) **não muda** — a máscara vai nos `params`
  do job: `params.scope = {nodeId, label}` + `params.rowMask = {csvId, rowCount,
  maskB64}` (bitmask little-endian de `ceil(rowCount/8)` bytes, base64). 10M linhas ≈
  1,25MB de máscara ≈ 1,7MB base64 — aceitável no POST local; acima de
  `FR_MASK_MAX_ROWS = 20M` o modo profundo com escopo cai DECLARADAMENTE no worker
  clampado (aviso de teto, padrão `ComputeCeilingNotice`).
- A máscara é produzida pelo worker (`resolveScopeRowMask` da FR1, mensagem
  `COMPUTE_SCOPE_MASK` → `SCOPE_MASK_RESULT`) — **o walk de política jamais é portado ao
  Python** (mesmo espírito da DEC-GS-005: o sidecar recebe dados prontos, não
  conhecimento de shapes/conns).
- `motor_clusters.py` valida `rowCount` contra o dataset (mismatch ⇒ erro de job ⇒
  fallback transparente) e filtra as linhas antes da agregação — daí em diante o motor é
  o MESMO (paridade número a número com o worker escopado, GATE dourado novo).
- Fallback (motor indisponível/erro): o worker roda clampado com o MESMO escopo já
  resolvido — o usuário nunca recebe silenciosamente um cluster global quando pediu por
  nó.

### DEC-FR-004 — Motor de Faixas de Risco (`computeRiskBands`, worker)

Entrada: `{csvId, col, metric, k | autoK, monotonic, minShare, scope}`. Pipeline:

1. **Parse + agregação por valor distinto**: leitura via dicionário da coluna
   (O(distintos)); cada valor distinto vira `{x: número, qty, num, den}` com a métrica
   resolvida por `resolveRiskMetric` (DEC-SD-006 — nada assume inad; `inadReal`/
   `inadInferida` são as opções do form v1). Valores não parseáveis/vazios acumulam na
   banda "Sem valor" (DEC-FR-006), fora dos passos 2–4.
2. **Pré-bins**: valores ordenados por `x` e fatiados em até `RANGE_PREBINS = 50`
   quantis ponderados por `qty` (equal-frequency por volume). Menos de 50 distintos ⇒
   cada distinto é um pré-bin (exato).
3. **DP exata**: escolher `k−1` cortes entre fronteiras de pré-bins maximizando o IV
   (`computeIV` — o MESMO helper do worker, boas/más pela métrica resolvida) das faixas
   resultantes, sujeito a: (a) `share ≥ minShare` (default 0,05) por faixa; (b) taxas
   monotônicas quando `monotonic` (default true) — a direção é detectada testando as
   duas e ficando com o melhor IV. Complexidade O(prebins² · k) — trivial no worker.
   Empates de IV (diferença ≤ 1e-12) ⇒ vence o conjunto de cortes lexicograficamente
   menor (determinismo).
4. **Auto-k** (`autoK`): roda a DP para k = 2..`RANGE_MAX_K = 7` e escolhe o maior k
   cujo ganho relativo de IV sobre k−1 é ≥ `RANGE_AUTO_MIN_GAIN = 0.05`; o critério é
   declarado no card ("k=4 escolhido: k=5 adicionaria <5% de IV").
5. **Referência de honestidade (DEC-FR-010)**: computa também o IV do corte uniforme
   (quantis puros com o mesmo k) — `ivUniform` — exibido lado a lado.

Saída (`RangeModel`, padrão docModel — dados crus, nunca prosa):

```js
{
  version, generatedAt, error: null|'no_rows'|'not_numeric'|'no_contrast'|'infeasible',
  dataset: {csvId, name, rowCount}, col, metric: {id, label, direction},
  scope: null | {nodeId, label},
  params: {k, autoK, monotonic, minShare, prebins},
  bands: [{ id, label, min, max,            // [min, max) — null = ±infinito; label auto "até X" / "X a Y" / "acima de Y" (pt-BR compacto)
            qty, share, num, den, rate, woe }],
  unmatched: {qty, share, rate} | null,      // banda "Sem valor" (só quando existe)
  quality: {iv, ivUniform, monotonic: 'inc'|'dec'|null, autoKReason: string|null},
}
```

- `error:'not_numeric'` quando < `RANGE_MIN_PARSE = 90%` do volume é parseável;
  `'no_contrast'` quando `computeIV` devolve null (sem bons ou sem maus — mesma regra do
  helper); `'infeasible'` quando `minShare`/monotonia não deixam solução com o k pedido
  (a UI sugere reduzir k ou o piso — nunca relaxa sozinha).
- **Detecção de contínua** (usada pela UI/DEC-FR-008, helper exportado
  `isContinuousColumn(csv, col)`): coluna Filtro (`columnTypes='decision'`) com ≥
  `RANGE_MIN_DISTINCT = 30` valores distintos e ≥ 90% do volume numérico-parseável.
- **Escopo por nó**: o form aceita o MESMO `scope` da FR1 (toolbar "📐 Faixas aqui") —
  as faixas são aprendidas na subpopulação via `resolveScopeRowMask`; a materialização
  (FR5) continua classificando a base inteira, com a mesma declaração da DEC-FR-002.
- Mensagens: `COMPUTE_RISK_BANDS` → `RISK_BANDS_RESULT` (fora do cache do tick, como as
  demais análises do Copiloto).

### DEC-FR-005 — Monotonicidade (default + toggle)

- Form nasce com `monotonic: true` (padrão de scorecard/governança). Toggle "permitir
  faixas não monotônicas" com tooltip explicando o trade-off (padrões em U genuínos vs.
  defensabilidade em comitê).
- Resultado sempre carrega o selo: `📈 monotônico crescente` / `📉 monotônico
  decrescente` / `⚠ não monotônico (permitido pelo usuário)` — o terceiro só existe com
  o toggle ligado; âmbar, nunca escondido.
- Com toggle ligado, o card mostra AMBOS os IVs (livre vs. melhor monotônico) — o
  usuário vê o preço da governança antes de escolher.

### DEC-FR-007 — RangeDef, materialização e persistência

```js
// csvStore[csvId].rangeDefs[col]
{ id, col, csvId, source: 'range', sourceCol,      // coluna contínua de origem
  metric: {id, label},
  bands: [{id, label, min, max}],                   // ordenadas; [min, max); null = ±∞
  unmatchedLabel,                                   // "Sem valor" default, editável
  meta: {k, monotonic, iv, ivUniform, minShare, prebins,
         scope: null|{nodeId,label}, generatedAt},
  createdAt }
```

- **`deriveRangeColumn(csv, def)`** (novo, `src/columnar.js`, ao lado de
  `deriveClusterColumn`): parse `cellNum`-consistente do valor da linha + busca binária
  nas fronteiras ⇒ rótulo da banda; não parseável ⇒ `unmatchedLabel`. Coluna
  dict-encoded materializada com `columnTypes[col]='decision'`,
  `varTypes[col]='ordinal'` (faixas têm ordem natural — beneficia precedência ordinal do
  Goal Seek e ordenação de eixos) — aparece em `decisionVars`, `createDecisionNode`,
  `assignCinemaVar`, Dashboard, tudo pela plumbing existente. **Nenhuma feature nova de
  fluxo.**
- **`src/rangeVar.js`** (puro, compartilhado main/worker/teste, espelho de
  `clusterVar.js`): `suggestRangeVarName`, `buildRangeDefFromModel`,
  `formatBandLabel` (pt-BR compacto: "até 100 mil", "100–300 mil", "acima de 300 mil"),
  `describeRangeRules` (para o glossário da Documentação Automática — mesma redação N2
  do cluster), `isRangeVar`, `editRangeCuts` (edição pura de cortes com validação de
  ordenação/sobreposição), `renameRangeBand`. Propagação de refs REUSA
  `renameClusterColumnRefs`/`renameClusterLabelRefs` de `clusterVar.js` (DEC-FR-009).
- **Persistência**: `rangeDefs` viaja dentro do contêiner `csvStore` (como
  `clusterDefs`) — `serializeCsvStore`/`deserializeCsvStore` preservam campos extras;
  `loadProject` com default defensivo; **bump `schemaVersion` 2.6 → 2.7**; chega ao
  worker via `UPDATE_CSV_STORE` (glossário da doc). Round-trip coberto por GATE.
- Checklist do CLAUDE.md atualizado na FR7 (linha de `clusterDefs` vira
  "`clusterDefs`, `rangeDefs`").

### DEC-FR-008 — Integração com a Clusterização (nunca silenciosa)

- No form do `clusterModal`, ao marcar uma dimensão em que `isContinuousColumn` é true:
  a dimensão NÃO é aceita; aparece inline o aviso "coluna contínua — o cluster agrupa
  por valor exato" + botão "📐 Gerar faixas desta coluna", que abre o `rangeModal`
  pré-preenchido (`csvId`, `col`, e o `scope` do cluster se houver).
- Ao salvar a variável de faixas, o fluxo VOLTA ao form do cluster com a coluna derivada
  marcada no lugar da contínua (estado do form preservado num campo `returnTo` do
  `rangeModal`).
- Justificativa: binning implícito dentro do k-means tornaria o `ClusterModel`
  irreprodutível (dependente de um passo escondido) e tocaria os GATEs dourados H8. A
  variável derivada explícita mantém o contrato: o cluster SÓ vê colunas discretas.

### DEC-FR-009 — Edição posterior (`rangeVarModal`)

- Chip da variável de faixas no painel (tom teal + 📐, análogo ao roxo + 🧩 do cluster)
  ganha ✏️ → `rangeVarModal`: renomear variável, renomear faixas, **editar pontos de
  corte** (inputs numéricos por fronteira, validação de ordenação estrita), editar
  `unmatchedLabel`, excluir variável. Mostra volume/taxa por faixa recalculados ao vivo
  (agregação O(distintos) na main — mesma leveza do `deriveRangeColumn`).
- Salvar ⇒ re-materializa (`deriveRangeColumn`) + propaga renames por TODAS as abas
  (`applyRefTransformAllCanvases` + `renameClusterColumnRefs`/`renameClusterLabelRefs`).
  Mover cortes SEM renomear rótulos reflete sozinho (as linhas re-roteiam pelas mesmas
  portas por rótulo — mesmo comportamento documentado da Variável de Cluster).
- Edição manual de cortes pode quebrar a monotonia original: o modal recalcula o selo e
  o exibe (âmbar se deixou de ser monotônico) — declarado, nunca bloqueado.

---

## Protocolo de mensagens (novas/estendidas)

| Mensagem | Direção | Payload | Observação |
|---|---|---|---|
| `COMPUTE_CLUSTER_SEGMENTS` | main → worker | `{params}` **+ `shapes?, conns?, scope?`** | Campos novos opcionais — ausentes ⇒ global (retrocompat total) |
| `CLUSTER_SEGMENTS_RESULT` | worker → main | `{clusterModel}` | `clusterModel.scope` novo (aditivo) |
| `COMPUTE_SCOPE_MASK` | main → worker | `{shapes, conns, scope:{nodeId}}` | FR3 — máscara p/ o job profundo |
| `SCOPE_MASK_RESULT` | worker → main | `{csvId, rowCount, maskB64}` | bitmask little-endian |
| `COMPUTE_RISK_BANDS` | main → worker | `{csvId, col, metric, k?, autoK?, monotonic, minShare?, shapes?, conns?, scope?}` | FR4 — Classe A, fora do cache do tick |
| `RISK_BANDS_RESULT` | worker → main | `{rangeModel}` | formato na DEC-FR-004 |
| task `cluster_segments` (sidecar) | router → sidecar | `params` **+ `scope?, rowMask?`** | FR3 — dataset por hash inalterado |

---

## Sessões

### Sessão FR1 — Escopo por nó no motor de Clusterização (worker) 🏷️ [OPUS]

**Documentação**: esta página (DEC-FR-001) · `docs/claude/Copiloto-Segmentos.md` (walk
de escopo) · `docs/claude/Worker-Protocolo.md`.

**Pré-requisitos**: nenhum.

**O que vai entregar**:
- Helper `resolveScopeRowMask(shapes, conns, csvStore, scopeNodeId)` no worker
  (exportado para teste), walk compilado M8 — extraído SEM mudar a matemática de
  `discoverSegments`
- `computeClusterSegments` com `scopeCtx` opcional (filtro pré-agregação, `model.scope`,
  seed com componente de escopo SÓ quando escopado, `no_rows` declarado)
- Handler `COMPUTE_CLUSTER_SEGMENTS` aceitando `shapes/conns/scope` opcionais
- GATE (casos novos em `tests/clusterSegments.test.js`): (1) **escopo por nó ≡
  sub-base** — cluster escopado número a número igual a `computeClusterSegments` sobre
  um csvStore filtrado manualmente às linhas que chegam ao nó; (2) `scope=null` ⇒
  resultado byte-idêntico ao atual (incl. seed); (3) escopo vazio ⇒ `no_rows` com
  scope preenchido; (4) determinismo escopado; (5) `tests/segmentDiscovery.test.js`
  inalterado após a extração do helper

**Prompt**:
```
Vamos à Sessão FR1 do épico Clusterização Contextual + Faixas de Risco, conforme
docs/wiki/Copiloto-ClusterContextual-FaixasRisco.md (leia a página INTEIRA antes —
DEC-FR-001 é normativa: helper, filtro pré-agregação, regra da seed e degradações
estão decididos lá; não redecida nada). Antes de codar, leia
docs/claude/Copiloto-Segmentos.md, docs/claude/Worker-Protocolo.md e o skill
gates-testes. Em src/simulation.worker.js: extraia resolveScopeRowMask do padrão de
walk de discoverSegments (sem mudar a matemática dele — tests/segmentDiscovery.test.js
precisa passar inalterado), aplique o escopo em computeClusterSegments conforme a
DEC-FR-001 e estenda o handler COMPUTE_CLUSTER_SEGMENTS com shapes/conns/scope
opcionais. scope=null tem que ser byte-a-byte idêntico a hoje — as fixtures douradas
H8 NÃO podem mudar. Cubra os 5 casos de GATE listados na sessão FR1 da wiki e rode
npm test completo. Releia o CLAUDE.md antes de propor.
```

---

### Sessão FR2 — UI "Clusterizar aqui" + escopo no modal 🏷️ [SONNET]

**Documentação**: esta página (DEC-FR-002) · `docs/claude/Copiloto-Clusterizacao.md`.

**Pré-requisitos**: FR1.

**O que vai entregar**:
- Botão "🧩 Clusterizar aqui" nas 3 toolbars (decision/cineminha/decision_lens), ao lado
  do "🔍 Descobrir aqui" existente; `openClusterModal({nodeId})` com label resolvido
- Pílula de escopo no header do `clusterModal` em todos os passos; `runClusterSegments`
  enviando `shapes/conns/scope` quando escopado
- Declarações da DEC-FR-002 no "👁 Ver no Dashboard" e no passo `save` quando escopado
- GATE: sem novos testes de motor (UI); `npm test` inalterado

**Prompt**:
```
Vamos à Sessão FR2 do épico Clusterização Contextual + Faixas de Risco, conforme
docs/wiki/Copiloto-ClusterContextual-FaixasRisco.md (DEC-FR-002 é normativa — textos,
posicionamento e declarações estão decididos lá). Pré-requisito: FR1 já entregue
(handler aceita shapes/conns/scope). Em src/App.jsx: adicione "🧩 Clusterizar aqui"
nas três toolbars que já têm "🔍 Descobrir aqui" (~linhas 6839/6887/6915, mesmo
estilo visual do botão de cluster do painel), estenda clusterModal com
scope:{nodeId,label}, renderize a pílula de escopo em todos os passos do modal
(~linha 11960) e faça runClusterSegments enviar shapes/conns/scope quando escopado.
Adicione as declarações de escopo do "Ver no Dashboard" e do passo save conforme a
DEC-FR-002. Nenhuma mudança de motor — npm test inalterado. Releia o CLAUDE.md
(padrão de refs) e docs/claude/Copiloto-Clusterizacao.md antes de propor.
```

---

### Sessão FR3 — Escopo no modo profundo (sidecar H8) 🏷️ [OPUS]

**Documentação**: esta página (DEC-FR-003) · [[Arquitetura-Execucao-Hibrida]] (§7.3,
§16, DEC-HX-005/006/007) · `docs/claude/Worker-Protocolo.md`.

**Pré-requisitos**: FR1 + FR2.

**O que vai entregar**:
- Mensagens `COMPUTE_SCOPE_MASK`/`SCOPE_MASK_RESULT` (worker) — bitmask little-endian
  base64 a partir de `resolveScopeRowMask`
- `runDeepClusterSegments` incluindo `scope` + `rowMask` nos `params` do job (dataset
  por hash inalterado); teto `FR_MASK_MAX_ROWS` com fallback declarado; fallback de
  indisponibilidade preservando o escopo no worker clampado
- `release/python/motor_clusters.py`: filtro por `rowMask` (validação de `rowCount` ⇒
  erro de job em mismatch) antes da agregação
- GATE: fixture dourada NOVA escopada em `tests/clusterSegmentsGolden.test.js` (as
  existentes intocadas) + caso novo em `tests_python/test_cluster_segments.py`
  (paridade número a número worker escopado ≡ motor Python com a mesma máscara;
  mismatch de rowCount ⇒ erro)

**Prompt**:
```
Vamos à Sessão FR3 do épico Clusterização Contextual + Faixas de Risco, conforme
docs/wiki/Copiloto-ClusterContextual-FaixasRisco.md (DEC-FR-003 é normativa — formato
da máscara, teto, validação e semântica de fallback estão decididos lá; o walk de
política JAMAIS vai para o Python). Leia antes:
docs/wiki/Arquitetura-Execucao-Hibrida.md (DEC-HX-005/006/007),
docs/claude/Worker-Protocolo.md e o skill gates-testes. Entregue: o par
COMPUTE_SCOPE_MASK/SCOPE_MASK_RESULT no worker; scope+rowMask nos params do job em
runDeepClusterSegments (src/App.jsx) com o teto FR_MASK_MAX_ROWS e fallbacks
declarados preservando o escopo; e o filtro por rowMask em
release/python/motor_clusters.py com validação de rowCount. GATEs: fixture dourada
nova escopada (as existentes NÃO mudam — se alguma falhar, pare e investigue) +
paridade pytest. Rode npm test e os tests_python. Releia o CLAUDE.md antes de propor.
```

---

### Sessão FR4 — Motor de Faixas de Risco (`computeRiskBands`) 🏷️ [OPUS]

**Documentação**: esta página (DEC-FR-004/005/006/010) ·
`docs/claude/Copiloto-Segmentos.md` (`resolveRiskMetric`, `computeIV`) ·
`docs/claude/Worker-Protocolo.md`.

**Pré-requisitos**: nenhum (independe de FR1–FR3; o suporte a `scope` reusa o helper da
FR1 SE ela já existir — senão, entregue `resolveScopeRowMask` aqui e a FR1 o reusa).

**O que vai entregar**:
- `computeRiskBands` no worker: agregação por distinto → pré-bins por quantis ponderados
  → DP exata maximizando IV com monotonia default/minShare → auto-k por ganho marginal →
  `ivUniform` de referência; banda "Sem valor"; erros declarados
  (`not_numeric`/`no_contrast`/`infeasible`); determinismo com desempate lexicográfico
- Helper `isContinuousColumn` exportado; constantes `RANGE_*` da DEC-FR-004
- Mensagens `COMPUTE_RISK_BANDS`/`RISK_BANDS_RESULT`; suporte a `scope`
- GATE NOVO `tests/riskBands.test.js`: (1) fixture com dois cortes plantados de
  inadimplência ⇒ a DP encontra exatamente os cortes plantados; (2) IV das faixas ≡
  `computeIV` aplicado à mão nos mesmos bins; (3) monotonia default respeitada e
  direção correta em fixture decrescente; (4) toggle livre acha o "U" plantado que o
  monotônico não pode achar, com ambos os IVs reportados; (5) `minShare` bloqueia faixa
  anã ⇒ `infeasible` no k impossível; (6) "Sem valor" agrega exatamente os não
  parseáveis; (7) auto-k para na regra de ganho marginal; (8) escopo por nó ≡ sub-base;
  (9) determinismo (duas execuções byte-idênticas)

**Prompt**:
```
Vamos à Sessão FR4 do épico Clusterização Contextual + Faixas de Risco, conforme
docs/wiki/Copiloto-ClusterContextual-FaixasRisco.md (leia a página INTEIRA;
DEC-FR-004, 005, 006 e 010 são normativas — pipeline, RangeModel, constantes,
regras de erro e desempate estão decididos lá; não redecida nada). Leia antes
docs/claude/Copiloto-Segmentos.md (resolveRiskMetric e computeIV — REUSE ambos, não
duplique matemática), docs/claude/Worker-Protocolo.md e o skill gates-testes.
Trabalhe SÓ em src/simulation.worker.js (+ teste novo): computeRiskBands com o
pipeline da DEC-FR-004 (agregação O(distintos) → 50 quantis ponderados → DP exata
com monotonia/minShare → auto-k → ivUniform), isContinuousColumn, e o par
COMPUTE_RISK_BANDS/RISK_BANDS_RESULT fora do cache do tick. Crie
tests/riskBands.test.js com os 9 casos de GATE da sessão FR4 da wiki. npm test
completo inalterado nos demais arquivos. Releia o CLAUDE.md antes de propor.
```

---

### Sessão FR5 — Variável de Faixas: materialização + persistência 🏷️ [SONNET]

**Documentação**: esta página (DEC-FR-007/009) · `docs/claude/Copiloto-Clusterizacao.md`
(o espelho: Variável de Cluster) · `docs/claude/Persistencia-Projeto.md` · skill
`persistencia-projeto`.

**Pré-requisitos**: FR4 (o RangeModel é a entrada de `buildRangeDefFromModel`).

**O que vai entregar**:
- `src/rangeVar.js` (puro): `suggestRangeVarName`, `buildRangeDefFromModel`,
  `formatBandLabel`, `describeRangeRules`, `isRangeVar`, `editRangeCuts`,
  `renameRangeBand` — propagação de refs delega a `renameClusterColumnRefs`/
  `renameClusterLabelRefs` (reuso, DEC-FR-009)
- `deriveRangeColumn` em `src/columnar.js` (busca binária, `cellNum`-consistente,
  ordinal)
- Persistência: `rangeDefs` no contêiner `csvStore` de ponta a ponta
  (`serializeCsvStore` já preserva extras — confirmar), `loadProject` defensivo, bump
  `schemaVersion` 2.6 → 2.7, `UPDATE_CSV_STORE` levando o campo ao worker; glossário da
  Documentação Automática anexando `range` via `describeRangeRules` (mesmo ponto onde o
  cluster anexa)
- GATE NOVO `tests/rangeVar.test.js`: materialização (fronteiras exatas em [min,max),
  ±∞, não parseável ⇒ unmatched, ordinal), labels pt-BR, edição de cortes com validação,
  round-trip completo de persistência (payload → load ⇒ def + coluna intactas),
  integração `computeRiskBands` real → def → coluna (volumes por faixa batem com o
  RangeModel)

**Prompt**:
```
Vamos à Sessão FR5 do épico Clusterização Contextual + Faixas de Risco, conforme
docs/wiki/Copiloto-ClusterContextual-FaixasRisco.md (DEC-FR-007 e DEC-FR-009 são
normativas — RangeDef, semântica [min,max), ordinal, bump de schemaVersion e o reuso
dos propagadores de refs estão decididos lá). Use os skills persistencia-projeto e
gates-testes ANTES de codar, e leia docs/claude/Copiloto-Clusterizacao.md — a
Variável de Cluster é o espelho exato do que você vai construir (mesma plumbing,
zero feature nova de fluxo). Entregue: src/rangeVar.js puro conforme a lista da
sessão FR5; deriveRangeColumn em src/columnar.js; rangeDefs persistido de ponta a
ponta com bump 2.6→2.7 (buildProjectPayload/loadProject defensivo/UPDATE_CSV_STORE);
e o glossário da doc anexando describeRangeRules. Crie tests/rangeVar.test.js com os
casos de GATE da sessão. npm test completo. Releia o CLAUDE.md (regra inviolável de
persistência) antes de propor.
```

---

### Sessão FR6 — UI das Faixas de Risco + integração com o cluster 🏷️ [SONNET]

**Documentação**: esta página (DEC-FR-005/008/009/010) ·
`docs/claude/Copiloto-Clusterizacao.md` (UI do clusterModal — o padrão visual).

**Pré-requisitos**: FR4 + FR5. (A integração com escopo por nó exige FR1; sem ela, o
botão de toolbar fica de fora e entra quando FR1 chegar.)

**O que vai entregar**:
- Botão "📐 Faixas de Risco" no painel do Copiloto (ao lado de "🧩 Clusterizar
  Segmentos") + "📐 Faixas aqui" nas 3 toolbars (se FR1 entregue); `rangeModal`
  (`step:'form'|'loading'|'result'|'save'|'saved'`, ref espelho `rangeModalR`):
  - **form**: base, coluna (só as que passam em `isContinuousColumn`, com aviso
    explicando por quê), métrica (`inadReal`/`inadInferida`), k manual 2–7 ou auto,
    toggle de monotonia (DEC-FR-005), minShare avançado
  - **result**: tabela de faixas (rótulo, intervalo, volume, share, taxa, WoE) +
    mini-barras SVG inline (SEM Recharts — ADR-003), selo de monotonia, IV vs.
    `ivUniform` (DEC-FR-010), banda "Sem valor" quando houver, erros declarados com
    sugestão de ação
  - **save**: nome da variável + rótulos editáveis pré-preenchidos por
    `formatBandLabel`; salvar ⇒ `deriveRangeColumn` + `rangeDefs` no csvStore +
    re-seed do worker (mesmo fluxo do `saveClusterVariable`)
- Chip teal + 📐 no painel de variáveis com ✏️ → `rangeVarModal` (DEC-FR-009): editar
  cortes/rótulos/unmatched, excluir, re-materializar, propagar refs por todas as abas,
  selo de monotonia recalculado
- Integração DEC-FR-008 no form do cluster: contínua rejeitada com aviso + "📐 Gerar
  faixas desta coluna" (rangeModal pré-preenchido com `returnTo`; ao salvar, volta ao
  cluster com a derivada marcada)
- GATE: `npm test` inalterado (motor coberto em FR4/FR5); casos de UI puros que
  existirem em helpers (ex.: validação de cortes) já estão em `tests/rangeVar.test.js`

**Prompt**:
```
Vamos à Sessão FR6 do épico Clusterização Contextual + Faixas de Risco, conforme
docs/wiki/Copiloto-ClusterContextual-FaixasRisco.md (DEC-FR-005, 008, 009 e 010 são
normativas — passos do modal, textos de declaração, selo de monotonia, IV vs.
ivUniform e o fluxo returnTo do cluster estão decididos lá; não redecida nada).
Pré-requisitos FR4+FR5 entregues. Leia docs/claude/Copiloto-Clusterizacao.md antes —
o clusterModal (src/App.jsx ~linha 11960) e o fluxo saveClusterVariable/
openClusterVarEdit são o padrão visual e de estado a espelhar (incl. ref espelho
rangeModalR no padrão de refs do CLAUDE.md). Entregue o rangeModal completo
(form/result/save), o chip 📐 com edição (rangeVarModal), o botão do painel + os
"📐 Faixas aqui" das toolbars se FR1 existir, e a integração DEC-FR-008 no form do
cluster. Mini-barras em SVG inline, nada de Recharts fora do Dashboard (ADR-003).
Estado novo criado pelo usuário já persiste via rangeDefs (FR5) — confira com o
skill persistencia-projeto que nada novo de topo ficou de fora. npm test inalterado.
```

---

### Sessão FR7 — Sincronização documental 🏷️ [HAIKU]

**Documentação**: `docs/claude/Manutencao-CLAUDE-md.md` (regra de tamanho/poda).

**Pré-requisitos**: todas as sessões entregues (ou as que forem entrar no release).

**O que vai entregar**:
- `CLAUDE.md`: linha do checklist de persistência (`clusterDefs` → "`clusterDefs`,
  `rangeDefs`"), `schemaVersion` atualizado para 2.7 na regra inviolável, linha da
  tabela de GATEs para `tests/riskBands.test.js` e `tests/rangeVar.test.js`, ref
  `rangeModalR` no padrão de refs — respeitando o teto de ~450 linhas
  (`npm run check:claude-md`)
- `docs/claude/Copiloto-Clusterizacao.md`: seções novas (escopo por nó; ponteiro para a
  Variável de Faixas) · novo `docs/claude/Copiloto-FaixasRisco.md` se o conteúdo não
  couber lá · `docs/claude/Worker-Protocolo.md`: mensagens novas ·
  `docs/claude/Estrutura-Arquivos.md`: `src/rangeVar.js` + testes novos
- Wiki: [[Decisoes]] ganha o bloco ADR-FR (tabela DEC-FR-001..010, resumo — como o
  ADR-GS) · [[Roadmap]] atualizado (itens entregues saem do "futuro") · [[Home]] e
  `_Sidebar.md` já apontam para esta página (feito na criação do épico)

**Prompt**:
```
Vamos à Sessão FR7 (final) do épico Clusterização Contextual + Faixas de Risco,
conforme docs/wiki/Copiloto-ClusterContextual-FaixasRisco.md. Sincronização
documental mecânica — NADA de código. Atualize: CLAUDE.md (checklist de persistência
com rangeDefs, schemaVersion 2.7, tabela de GATEs com riskBands/rangeVar, ref
rangeModalR — rode npm run check:claude-md e pode se necessário conforme
docs/claude/Manutencao-CLAUDE-md.md, sem apagar informação);
docs/claude/Copiloto-Clusterizacao.md (escopo por nó + ponteiro de faixas);
docs/claude/Worker-Protocolo.md (COMPUTE_SCOPE_MASK, COMPUTE_RISK_BANDS e a extensão
do COMPUTE_CLUSTER_SEGMENTS); docs/claude/Estrutura-Arquivos.md (src/rangeVar.js e
testes novos); docs/wiki/Decisoes.md (bloco ADR-FR no padrão do ADR-GS);
docs/wiki/Roadmap.md. Confira o que foi REALMENTE entregue no código antes de
escrever — documente o estado real, não o plano.
```

---

## Fora de escopo deste épico (registrado para não redescobrir)

- **Binning multivariado** (cortes 2D simultâneos, árvore de decisão rasa) — a versão 1
  é univariada; interações contínuas ficam para um épico próprio se a demanda aparecer.
- **Faixas profundas no sidecar** (optimal binning exato com solver MILP, estilo
  `optbinning`) — a DP browser já é exata dado o pré-binning de 50 quantis; um modo
  profundo só faria sentido para pré-bins na casa dos milhares, sem demanda hoje.
- **Outras métricas-alvo nas faixas** (margem, churn, RAR) — o motor já é genérico via
  `resolveRiskMetric` (DEC-SD-006); é extensão do formulário, não do motor.
- **Escopo por nó na Descoberta profunda H7 via rowMask** — a H7 tem seu próprio
  mecanismo; unificar com o `COMPUTE_SCOPE_MASK` da FR3 é refactor futuro opcional.
- **Re-aprendizado automático das faixas** quando a base é substituída — as faixas são
  regras persistidas (como o cluster); um botão "recalcular cortes" no `rangeVarModal`
  pode entrar depois.
