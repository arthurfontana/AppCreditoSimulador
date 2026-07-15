# Clusterização de Segmentos, Escopo por Nó e Variáveis derivadas (Cluster + Faixas)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer no
> `clusterModal`/`rangeModal`, no algoritmo de k-means (worker/sidecar), no escopo por
> nó (Épico FR, FR1–FR3) ou nas variáveis derivadas — Cluster (`clusterDefs`,
> `src/clusterVar.js`) e Faixas (`rangeDefs`, `src/rangeVar.js`).

## Motor de clusterização (Execução Híbrida H8) — ponteiro

O motor k-means (worker `computeClusterSegments` + sidecar
`release/python/motor_clusters.py`, task `cluster_segments`), o `ClusterModel`, os
tetos declarados do browser (`clampClusterParamsForBrowser`) e o `clusterModal` de
resultado (quadrante Volume × Risco, `ClusterCard`, "👁 Ver no Dashboard") são
documentação normativa já coberta por `docs/wiki/Arquitetura-Execucao-Hibrida.md`
(§7.3, §16) e `docs/wiki/Hibrido-Prompts-Sessoes.md` (Sessão H8) — **não duplicada
aqui**. Leia a wiki antes de mexer no algoritmo, nos tetos ou na UI de resultado do
`clusterModal`. GATE duplo: `tests/clusterSegments.test.js` +
`tests/clusterSegmentsGolden.test.js` + `tests_python/test_cluster_segments.py`.

O que **este** arquivo documenta é (1) o escopo por nó da própria Clusterização e (2)
o que vem depois do resultado: transformar um achado efêmero (cluster ou faixa) numa
variável de fluxo persistente.

## Escopo por nó (Épico FR, DEC-FR-001..003 — entregue em FR1–FR3)

"🧩 Clusterizar Segmentos" pode rodar sobre a base inteira (painel lateral, como
sempre) OU só sobre a **população que efetivamente chega a um nó** (losango/Cineminha/
Decision Lens) — botão **"🧩 Clusterizar aqui"** nas toolbars de `decision`, `cineminha`
e `decision_lens` (`src/App.jsx`, mesmo padrão do "🔍 Descobrir aqui" da Descoberta de
Segmentos), `openClusterModal({nodeId: sel})`.

- **Walk single-sourced**: `resolveScopeRowMask(shapes, conns, csvStore, scopeNodeId)`
  (`src/simulation.worker.js`) devolve, por `csvId`, um `Uint8Array` de pertencimento
  (walk compilado M8) — o MESMO helper alimenta a Clusterização (FR1), o Criar Faixas
  por Risco (FR4, abaixo) e o job profundo do sidecar (FR3). Não duplica a matemática
  de `discoverSegments`.
- `computeClusterSegments(csvStore, params, scopeCtx = null)` — `scopeCtx =
  {shapes, conns, scope:{nodeId}}` filtra as linhas ANTES da agregação por tupla de
  dims; `model.scope = null | {nodeId, label}` é campo aditivo do `ClusterModel`;
  `scope=null` é byte-idêntico ao caminho global de antes (fixtures douradas H8
  intocadas). Escopo vazio ⇒ `model.error = 'no_rows'` com `scope` preenchido.
  `clusterModal` exibe o escopo como pílula ("🧩 População: chegando em "{label}"" vs.
  "🧩 População: base inteira") em todos os passos.
- **Modo profundo (sidecar H8) com escopo**: par de mensagens `COMPUTE_SCOPE_MASK` →
  `SCOPE_MASK_RESULT` (bitmask little-endian base64, produzida por
  `resolveScopeRowMask` no worker — o walk de política JAMAIS é portado ao Python);
  `runDeepClusterSegments` (`src/App.jsx`) inclui `scope`/`rowMask` nos `params` do job
  `cluster_segments`; teto `FR_MASK_MAX_ROWS = 20_000_000` linhas — acima disso o
  escopo cai declaradamente no worker clampado (aviso na UI). `motor_clusters.py`
  valida `rowCount`/`csvId` do `rowMask` contra o dataset registrado (mismatch ⇒ erro
  de job ⇒ fallback transparente) e filtra as linhas antes da agregação. Fallback de
  indisponibilidade do sidecar preserva o MESMO escopo já resolvido.
- Ver `docs/claude/Worker-Protocolo.md` para o payload exato das mensagens.

### Teste
`tests/clusterSegments.test.js` (escopo por nó ≡ sub-base filtrada manualmente,
`scope=null` byte-idêntico, `no_rows` declarado, determinismo escopado) +
`tests/clusterSegmentsGolden.test.js` (fixture dourada NOVA escopada, além das
globais já existentes) + `tests_python/test_cluster_segments.py` (paridade número a
número worker escopado ≡ `motor_clusters.py` com o mesmo `rowMask`; mismatch de
`rowCount`/`csvId` ⇒ erro de job).

## Variável de Cluster (`csvStore[csvId].clusterDefs`, `src/clusterVar.js`)

Transforma o resultado da Clusterização (que é uma ANÁLISE efêmera — o `ClusterModel`
não persiste, não vira coluna) numa **variável de fluxo reutilizável**: uma **coluna
Filtro derivada** na base, cujos valores são os clusters. O usuário arrasta o chip ao
canvas (losango/Cineminha) e segue com aberturas/políticas — como qualquer variável de
decisão. O k-means é o PONTO DE PARTIDA; o usuário cura os grupos depois (renomear, mover
um público de um cluster para outro) — padrão proposta→refino do app.

### Representação (coluna real + definição editável)
- A variável é uma **coluna dict-encoded** materializada no `csvStore[csvId]`
  (`headers`/`columns`/`columnTypes[col]='decision'`/`varTypes[col]='categorical'`) — por
  isso aparece automaticamente em `decisionVars` (chip arrastável), funciona em
  `createDecisionNode`/`assignCinemaVar`, alimenta o glossário da doc e persiste, tudo pela
  plumbing existente. **Nenhuma feature nova de fluxo** — é uma coluna Filtro comum.
- A **definição editável** vive em `csvStore[csvId].clusterDefs[col]` (viaja com a base,
  auto-persiste via `serializeCsvStore`/`deserializeCsvStore` que preservam campos extras,
  e chega ao worker no `UPDATE_CSV_STORE` — usada pela doc):
  ```js
  { id, col, csvId, source:'cluster', dims:[dimCol...],
    groups:[{ id, label, clusterId, members:{[dimCol]:[valTrimado...]} }],  // ordem first-match (volume desc)
    unmatchedLabel, meta:{k,seed,features,explainedVariance,silhouette,method,generatedAt}, createdAt }
  ```

### Regras (bounding box, first-match-wins) — `deriveClusterColumn` (`src/columnar.js`)
Cada cluster = listas de valores por dimensão (bounding box do que o k-means agrupou); a
linha recebe o rótulo do **PRIMEIRO grupo** cujas listas contêm o valor da linha (TRIMADO,
mesma semântica de `cluDimValue`) em **todas** as dimensões; sem casar nenhum ⇒
`unmatchedLabel`. **Exato para 1 dimensão**; aproximação editável por faixas para 2+
(mesma técnica do "👁 Ver no Dashboard"). Materialização O(linhas × grupos × dims) com
máscara `Uint8Array` por (grupo, dim) sobre o dicionário (O(distintos)) + early-break —
roda na main no salvar/editar. Dimensão ausente na base = curinga (não fragmenta).

### `src/clusterVar.js` (puro, compartilhado main/worker/teste)
`suggestClusterVarName`/`suggestClusterLabels` (sugestões únicas por comportamento —
aprovação/risco), `buildClusterDefFromModel` (def a partir do `ClusterModel` +
`cluster.dims[].values`), `describeClusterRules` (descrição CRUA das regras p/ docs, redige
os valores concretos N2 sem `includeDomains`), `isClusterVar`, e as edições PURAS:
`renameClusterGroup`, `toggleValueInGroup` (checkbox — mantém sobreposição),
`moveValueToGroup` (posse exclusiva), `clusterMembershipTable`, `renameClusterColumnRefs`
(propaga rename de coluna a losango/Cineminha/lens) e `renameClusterLabelRefs` (propaga
rename de rótulo a portas/arestas + domínio/células de Cineminha).

### UI (`App.jsx`)
- **Salvar como variável**: botão **➕ Salvar como variável** no resultado do `clusterModal`
  → passo `step:'save'` com nome da variável + rótulos por cluster (sugestões editáveis) +
  rótulo "fora dos clusters"; `saveClusterVariable` valida, materializa (`deriveClusterColumn`)
  e insere a coluna + `clusterDefs[col]` no `csvStore` (`step:'saved'` confirma). A mudança
  de `csvStore` re-semeia o worker e re-simula.
- **Editar/renomear**: chip de cluster no painel (tom roxo + 🧩) ganha **✏️** →
  `clusterVarModal` (`openClusterVarEdit`): renomeia a variável, renomeia os clusters e
  **move públicos** (matriz valor × cluster com checkbox por dimensão) + excluir.
  `saveClusterVarEdit` re-materializa e propaga referências por **todas as abas**
  (`applyRefTransformAllCanvases` + os dois `rename*Refs`). **Mover públicos reflete
  sozinho** (a coluna muda e as linhas re-roteiam pelas mesmas portas por rótulo); só o
  rename de rótulo/coluna precisa da propagação.
- **Documentação**: `buildGlossary` (worker) anexa `cluster` (via `describeClusterRules`)
  às variáveis de cluster referenciadas; `renderDocMarkdown`/`renderDocHTML` imprimem a
  seção **"Regras dos Clusters"** (grupos × faixas por dimensão; valores redigidos sem o
  toggle de domínios — Contrato de Privacidade N2).

### Teste
`tests/clusterVar.test.js` — materialização (1D exata, 2D first-match/overlap, trim, fora
dos grupos, dim ausente), sugestões únicas, redação de regras, edições, propagação de refs
(coluna/rótulo → losango/porta/Cineminha/lens), round-trip de persistência e a integração
`computeClusterSegments` real → def → coluna (volumes por cluster batem com o modelo).

## Criar Faixas por Risco + Variável de Faixas (Épico FR, DEC-FR-004..010 — entregue em FR4–FR6)

Binning **supervisionado** de uma coluna contínua (ex.: faturamento presumido): descobre
os cortes que maximizam a discriminação de inadimplência (IV/WoE, técnica de scorecard) e
materializa o resultado como **variável de fluxo persistente** — o mesmo padrão
proposta→refino da Variável de Cluster acima (esta seção é o espelho dela; leia-a primeiro
se ainda não leu).

### Motor (`computeRiskBands`, `src/simulation.worker.js`) — Classe A, nunca roteia ao sidecar
Pipeline (`~5448` em diante): agregação por valor distinto (O(distintos), métrica via
`resolveRiskMetric`) → não parseável/vazio vira banda **"Sem valor"** → pré-bins por
quantis ponderados por volume (`RANGE_PREBINS = 50`) → **DP exata** (`dpRiskBands`)
maximizando IV com piso de volume por faixa (`RANGE_MIN_SHARE_DEFAULT = 0.05`) e
monotonicidade opcional (default `true` — testa as duas direções e fica com o melhor IV;
desempate por `RANGE_IV_TIE = 1e-12` + cortes lexicograficamente menores) → auto-k
(`chooseRiskAutoK`, `RANGE_MAX_K = 7`, ganho marginal `RANGE_AUTO_MIN_GAIN = 0.05`) → IV de
referência do corte cego (`computeUniformIV`, mesmo k, quantis uniformes). Erros
declarados: `not_numeric` (< `RANGE_MIN_PARSE = 0.90` do volume parseável), `no_contrast`
(`computeIV` sem bons/maus), `infeasible` (piso/monotonia inviabilizam o k pedido — a UI
nunca relaxa sozinha). `isContinuousColumn(csv, col)` (mesmos tetos, `RANGE_MIN_DISTINCT =
30` distintos) detecta coluna Filtro contínua p/ a UI (form do `rangeModal` e aviso da
DEC-FR-008 no `clusterModal`). Escopo por nó **opcional**: `scopeCtx = {shapes, conns,
scope:{nodeId,label}}` — REUSA `resolveScopeRowMask` (a mesma função da Clusterização,
seção acima). Mensagens `COMPUTE_RISK_BANDS` → `RISK_BANDS_RESULT` — fora do cache do
tick, como as demais análises do Copiloto. Ver `docs/claude/Worker-Protocolo.md`.

### Variável de Faixas (`csvStore[csvId].rangeDefs`, `src/rangeVar.js`)
Mesma representação da Variável de Cluster: **coluna dict-encoded** materializada
(`columnTypes[col]='decision'`, `varTypes[col]='ordinal'` — as faixas têm ordem natural,
diferente do cluster que é `'categorical'`) + **definição editável** em
`csvStore[csvId].rangeDefs[col]`:
```js
{ id, col, csvId, source:'range', sourceCol,
  metric:{id,label}, bands:[{id,label,min,max}],   // ordenadas; [min,max); null=±∞
  unmatchedLabel, meta:{k,monotonic,iv,ivUniform,minShare,prebins,scope,generatedAt},
  createdAt }
```
- **`deriveRangeColumn(csv, def)`** (`src/columnar.js`, ao lado de `deriveClusterColumn`):
  busca binária `cellNum`-consistente nas fronteiras das faixas; não parseável ⇒
  `unmatchedLabel`.
- **`src/rangeVar.js`** (puro, compartilhado main/worker/teste, espelho de
  `clusterVar.js`): `suggestRangeVarName`, `formatBandLabel` (pt-BR compacto: "até 100
  mil", "100 mil a 300 mil", "acima de 300 mil" — CANÔNICO, o worker usa a mesma função
  para o rótulo provisório do `RangeModel`), `buildRangeDefFromModel`, `isRangeVar`,
  `describeRangeRules` (redação CRUA p/ docs — N2 omite `min`/`max` sem `includeDomains`),
  `renameRangeBand`, `editRangeCuts` (edição pura das `k−1` fronteiras internas, validação
  de ordenação estrita). Propagação de refs (rename de coluna/rótulo) **REUSA**
  `renameClusterColumnRefs`/`renameClusterLabelRefs` de `clusterVar.js` sem duplicação —
  são genéricos por nome de coluna/rótulo.
- **Persistência**: `rangeDefs` viaja dentro do contêiner `csvStore` (mesmo mecanismo de
  `clusterDefs` — `serializeCsvStore`/`deserializeCsvStore` preservam campos extras);
  `schemaVersion` **`"2.7"`** (bump da FR5); chega ao worker via `UPDATE_CSV_STORE`.

### UI (`App.jsx`)
- Botão **"📐 Criar Faixas por Risco"** no painel do Copiloto (ao lado de "🧩 Clusterizar
  Segmentos") + **"📐 Faixas aqui"** nas 3 toolbars (mesmo escopo por nó da Clusterização,
  reusa `openRangeModal({scope:{nodeId}})`).
- `rangeModal` (`step:'form'|'loading'|'result'|'save'|'saved'`, ref espelho
  `rangeModalR`): **form** (base, coluna — só as que passam em `isContinuousColumnUI`,
  métrica, k manual 2–7 ou auto, toggle de monotonia, `minShare` avançado); **result**
  (tabela de faixas + selo de monotonia + IV vs. `ivUniform`, SVG inline — sem Recharts,
  ADR-003); **save** (nome + rótulos editáveis pré-preenchidos por `formatBandLabel`) →
  `saveRangeVariable` materializa e insere `rangeDefs[col]` no `csvStore` (re-semeia o
  worker).
- Chip **teal + 📐** no painel de variáveis (ao lado do chip roxo + 🧩 do cluster) ganha
  **✏️** → `rangeVarModal` (ref espelho `rangeVarModalR`, `openRangeVarEdit`): renomear
  variável/faixas, **editar pontos de corte** (validação de ordenação estrita), editar
  `unmatchedLabel`, excluir — recalcula o selo de monotonia ao vivo e propaga refs por
  todas as abas (mesmos `renameClusterColumnRefs`/`renameClusterLabelRefs` reusados).
- **Integração com o cluster (DEC-FR-008, nunca silenciosa)**: no form do `clusterModal`,
  marcar uma dimensão contínua (`isContinuousColumnUI`) não a adiciona — exibe o aviso +
  botão **"📐 Gerar faixas desta coluna"**, que abre o `rangeModal` pré-preenchido
  (`csvId`, `col`, `scope` do cluster, `returnTo` = snapshot do form do cluster). Ao salvar
  a variável, o fluxo volta ao `clusterModal` com a coluna derivada já marcada na lista de
  dims (`returnTo.dims`).
- **Documentação Automática — pendência conhecida**: `buildGlossary` (worker) já anexa
  `range` (via `describeRangeRules`) às variáveis de faixas referenciadas, no MESMO ponto
  onde anexa `cluster` — mas, diferente do cluster, `renderDocMarkdown`/`renderDocHTML`
  (`src/policyDocRender.js`) **ainda não têm** uma seção "Regras das Faixas" que imprima
  esse dado (só filtram `g.cluster`, não `g.range`); `tests/policyDoc.test.js` não cobre o
  caso. O dado chega pronto ao glossário — falta só o render + o teste.

### Teste
`tests/riskBands.test.js` (motor `computeRiskBands`: cortes plantados ≡ DP exata, IV ≡
`computeIV` aplicado à mão, monotonia default/direção correta, toggle livre acha o "U" que
o monotônico não pode, `minShare` bloqueia faixa anã ⇒ `infeasible`, "Sem valor" exato,
auto-k para no ganho marginal, escopo por nó ≡ sub-base, determinismo) +
`tests/rangeVar.test.js` (materialização em fronteiras exatas `[min,max)`/±∞/unmatched/
ordinal, rótulos pt-BR, edição de cortes com validação, round-trip de persistência,
integração `computeRiskBands` real → def → coluna).
