# Clusterização de Segmentos e Variável de Cluster

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer no
> `clusterModal`, no algoritmo de k-means (worker/sidecar) ou na Variável de
> Cluster (`clusterDefs`, `src/clusterVar.js`).

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

O que **este** arquivo documenta é o que vem depois do resultado: transformar um
cluster (achado efêmero) numa variável de fluxo persistente.

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
