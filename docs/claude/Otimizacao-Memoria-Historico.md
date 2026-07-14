# Otimização de Memória — `src/columnar.js` (Fases 0–4 + M1/M3/M15)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer em
> qualquer parte do armazenamento colunar, do pipeline de import vetorizado ou
> da serialização do Projeto relacionada a typed arrays.

Para bases sumarizadas por dia (~1MM linhas / ~130MB), a arquitetura anterior
mantinha várias cópias completas em `string` na RAM. Ver o plano completo em
`docs/wiki/Otimizacao-Memoria.md` (Fases 0–4) e `docs/wiki/PERFORMANCE-ANALISE.md`
(backlog M1–M15, priorizado em Fases A–D). **Fases 0, 1, 2, 3, 4 entregues; do
backlog do `PERFORMANCE-ANALISE.md`, M3 e M15 (Fase B), M6 (Fase C) e M1 e M8 (Fase D)
entregues** (M2/M10 documentados nas seções do worker — ver
`docs/claude/Worker-Protocolo.md`; M8 no mesmo arquivo, "Motor compilado").

## Fase 0 — Parse sem cópia intermediária
O parse do import varre o texto por índice em vez de `split(/\r?\n/)`. Sem o array
intermediário de 1MM strings, o pico de RAM do parse cai de ~3× para ~1× o tamanho
da base. (A técnica vive hoje dentro de `parseCSVToColumnarAsync` — ver M1.)

## Fase 1 — Armazenamento colunar no `csvStore`
`src/columnar.js` define a estrutura vetorizada e os accessors:
- Colunas métricas (`METRIC_COL_TYPES = qty, qtdAltas, qtdAltasInfer, inadReal, inadInferida`) → `Float64Array` (números prontos, sem `parseFloat` por tick).
- Dimensões/decisão/ID → *dictionary encoding* `{dict: string[], codes}` — o dicionário já é a lista de distintos. Os `codes` usam o **menor typed array pela cardinalidade** (`codesCtorForDict`): `Uint8Array` (≤256 distintos), `Uint16Array` (≤65536), `Int32Array` acima — **dieta de memória H2** (Execução Híbrida §2.2 Eixo 1): colunas de baixa cardinalidade caem de 4 para 1–2 bytes/linha. Aplicado no import vetorizado (M1) e no `buildColumnar` legado; todo consumidor lê `codes[r]` por indexação (dtype-agnóstico — motor M8, M15, accessors). Métricas seguem `Float64Array` (GATEs de igualdade exigem).
- **Accessors** (uso obrigatório em hot paths — não acessar `csv.rows[r][c]` diretamente):
  - `rowCount(csv)` — número de linhas
  - `cellStr(csv, r, c)` — equivalente exato a `row[c]` no legado
  - `cellNum(csv, r, c)` — valor numérico (retorna `NaN`, não `0`; o call site aplica `|| 0`)
  - `getRow(csv, r)` — materializa uma linha como `string[]` (uso pontual)
  - `materializeRows(csv)` — materializa tudo (evitar em hot paths)
  - `distinctColValues(csv, c)` — distintos não-vazios (O(distintos) em modo colunar)
- **Persistência**: `serializeCsvStore(store)` / `deserializeCsvStore(store)` — typed arrays ↔ **base64** dos bytes crus para JSON (M3; era array plano de números boxed até o schema 2.2). `deserializeCsvStore` aceita os três formatos: base64 (atual), array plano (schema ≤ 2.2) e o legado `rows: string[][]` (migração transparente de projetos anteriores à Fase 1).
- **GATE**: `tests/columnar.test.js` verifica equivalência célula a célula com o legado, round-trip de projeto e runSimulation sobre base colunar (mesma FPD ≈ 40,06%).

## Fase 2 — Transferência sem cópia para o worker via `SharedArrayBuffer`
Quando o contexto é *cross-origin isolated* (`crossOriginIsolated === true`), os
typed arrays são alocados sobre `SharedArrayBuffer` — o structured clone do
`postMessage` compartilha a memória por referência em vez de copiar.
- `sharedBuffersAvailable()` — feature-detect (retorna `false` em `file://`, Node/jsdom, browser sem COI).
- `buildCsvStoreMessage(csvStore)` — monta `{payload, transfer:[]}`. A lista de transfer é **sempre vazia** (SAB nunca é transferido; `ArrayBuffer` sem COI deixa o clone copiar — a main ainda precisa dos buffers).
- `vite.config.js`: headers `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` em `server`/`preview` para habilitar COI.
- **Ownership**: nenhum buffer da base é neutralizado. Worker é read-only, sem write race.

## Fase 3 — `COMPUTE_ANALYTICS_DATASET` só na aba Dashboard
O effect que dispara `COMPUTE_ANALYTICS_DATASET` agora só posta a mensagem quando
`activeTab === 'analysis'`. Editar o canvas na aba Canvas não materializa mais o
dataset largo a cada tick.

## Fase 4 — cortar os picos transitórios que ainda causavam OOM
As Fases 0–3 enxugaram o **estado permanente** (`csvStore` colunar ~100MB), mas o
"Out of memory" persistia em dois **picos transitórios** por-linha que ninguém tocara:

1. **Overlay do Canvas.** `COMPUTE_OVERLAY` enviava o `overlay` inteiro
   (`rowDecisions`: 1 objeto por linha, ~1MM numa base diária) de volta pela
   `postMessage` → o structured clone materializava **outra** cópia de ~1MM objetos na
   main, guardada no estado morto `simulationOverlay` (nunca lido). Estourava ao editar
   o canvas com base grande. **Correção:** o worker computa o `incrementalResult`
   localmente e **descarta** o overlay; a main só recebe `{incrementalResult,
   nodeArrivals}`. Estado `simulationOverlay` removido. Zero mudança de matemática.
2. **Dataset analítico largo (Dashboard).** `computeAnalyticsDataset` materializava 1
   objeto por linha (~1MM), clonado pra main e recopiado por `applyGroupingsToDataset`.
   Estourava ao abrir a aba Dashboard. **Correção:** dataset **colunar** (dict encoding +
   `Float64Array`), `ArrayBuffer`s **transferidos** (zero-cópia) no `ANALYTICS_RESULT`;
   consumidores (`pivotWidget`, `computeWidgetMetric`, filtros, `distinctDimValues`,
   `applyGroupingsToDataset`, `buildAnalyticsCSV`) iteram por índice via `awColStr`/
   `awColNum`; agrupamentos adicionam 1 coluna dict; filtros viram máscara `activeRows`.
   Ver `docs/claude/Analytics-Workspace.md` § "Formato colunar do dataset largo". GATE
   `analytics.test.js` revalidado sobre o formato colunar.

> Nota operacional: o `release/iniciar.bat` serve via `python serve.py` (não mais
> `python -m http.server`). O `serve.py` é um `SimpleHTTPRequestHandler` que injeta os
> headers `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy:
> require-corp` — logo `crossOriginIsolated === true` e o SAB da Fase 2 **ativa** também
> no release local (a base deixa de ser clonada pro worker). Como todos os assets são
> bundlados na mesma origem, `require-corp` não bloqueia nada. O `build-release.yml`
> preserva `serve.py` junto do `iniciar.bat` ao recopiar o `dist/`. O dataset analítico
> da Fase 4 **não** depende de COI (usa `ArrayBuffer` transferível), então já valia
> mesmo antes; a mudança do `serve.py` beneficia a base colunar (Fase 2).

## M3 — Save/Load do Projeto: base64 + escrita em partes (schema 2.3)
Ver `docs/wiki/PERFORMANCE-ANALISE.md` (item M3, Fase B do backlog). Dois picos
que sobravam ao **salvar** um projeto com base grande:
1. **Arrays planos de números boxed.** `serializeColumns` fazia `Array.from(col.data)`
   — ~15MM de números *boxed* numa base diária. **Correção:** os bytes crus do typed
   array (`Float64Array`/`Int32Array`) viram uma **string base64**
   (`typedArrayToBase64`/`base64ToTypedArray`, `columnar.js`) — sem materializar array
   de números, JSON ~30% menor que a mesma sequência em dígitos decimais.
   `deserializeColumns` aceita os dois formatos (`encoding:'base64'` novo e o array
   plano antigo, schema ≤ 2.2) — retrocompatibilidade coberta em `tests/columnar.test.js`.
   **Dieta H2:** o envelope base64 de uma coluna dict ganhou o campo `dtype`
   (`'Uint8Array'|'Uint16Array'|'Int32Array'`) para reconstruir os `codes` no dtype
   certo. Retrocompatível com os **três formatos** aceitos: base64 **com** `dtype` (lê
   fiel), base64 **sem** `dtype` (schema 2.3 = sempre Int32, lido como Int32 e
   re-empacotado ao menor dtype) e array plano (schema ≤ 2.2, idem). Toda carga
   termina no menor dtype pela cardinalidade (`packCodes`).
2. **`JSON.stringify(payload)` monolítico.** Mesmo em base64, uma única chamada monta
   o projeto inteiro como uma string contígua antes de gravar. **Correção:**
   `buildProjectJSONChunks(payload)` (`App.jsx`) monta a "casca" do payload (tudo
   exceto `csvStore`) e, dentro de `csvStore`, cada **coluna de cada base
   individualmente** — a concatenação dos chunks é o mesmo JSON que
   `JSON.stringify(payload)` produziria, só que entregue em partes. `saveProject`
   escreve os chunks em sequência no `createWritable` (streaming real) e, no
   fallback `<a download>`, os mesmos chunks viram o `BlobPart[]` do `Blob` (aceito
   sem concatenação prévia).
- Schema bump: **`"2.2"` → `"2.3"`**. `loadProject`/`onProjectFileChange` não mudam
  (a leitura ainda é `FileReader.readAsText` + `JSON.parse` — o ganho é no *tamanho*
  do JSON, não numa leitura em streaming do lado do load).

## M15 — Dataset analítico: tradução código→código (em vez de re-hash por linha)
Ver `docs/wiki/PERFORMANCE-ANALISE.md` (item M15, Fase B do backlog). `computeAnalyticsDataset`
(worker) fazia, **por linha × por dimensão**, `cellStr(...)` → `Map.get(string)` para
recodificar valores que a base **já** tem codificados (dictionary encoding, Fase 1) —
~10MM lookups de hash de string por recompute numa base de 1MM linhas × 10 dimensões.
**Correção:** para cada `csv × dimensão` (e para as colunas de decisão, a partir do
overlay tipado do M2), constrói-se uma vez um `Int32Array` de tradução
`código de origem (dicionário da base) → código de destino (dicionário do dataset
largo)` — O(distintos), não O(linhas). No loop de linhas resta `codes[w] =
translate[srcCodes[r]]` (leitura de inteiro). Dimensão ausente numa base específica ⇒
código constante (resolvido uma vez, sem tradução por linha); coluna não dict-encoded
(caminho legado `rows: string[][]`, usado só em teste) cai no `cellStr` por linha de
antes — sem mudança de comportamento. GATE: `tests/analytics.test.js` (5B) revalidado
sem alteração de contrato/matemática.

## M1 — Import vetorizado direto para colunar (Fase D — mudança arquitetural)
Ver `docs/wiki/PERFORMANCE-ANALISE.md` (item M1/D1). Até aqui, o funil de import
mantinha a base em **3–5 formas simultâneas** na RAM (pico >2GB num CSV de 130MB —
o cenário de OOM mais provável): o texto cru (`wizard.rawText`, ~260MB), a matriz
`parsedRows: string[][]` (~15MM de strings) retida pelos 3 passos do wizard, e no
confirm mais **duas cópias integrais** (`normalizeDecimalSep` e o
`rows.map(r => [...r, mapped])` da derivação de `__DECISAO_ORIGINAL`) antes de o
`buildColumnar` vetorizar **no fim**. **Correção (tudo em `src/columnar.js`, UI do
wizard intocada):**
1. **`parseCSVToColumnarAsync(text, delimiter, hasHeader, onProgress)`** — o parse
   chunked (mesma varredura por índice da Fase 0, mesmo protocolo de progresso)
   alimenta os encoders colunares **linha a linha**; como os tipos de métrica só são
   conhecidos no passo 2, **todas** as colunas nascem dict-encoded. Devolve
   `{headers, columns, rowCount, previewRows}`; a matriz `string[][]` nunca existe e
   o texto cru é solto quando o parse resolve.
2. **Wizard sem `rawText`/`parsedRows`** — o estado guarda o `File` handle (`file`),
   `parsedHeaders`, `parsedColumns` (dict), `parsedRowCount` e `previewRows` (~100
   linhas para a tabela de prévia). Os dicionários já são os distintos que os passos
   2/3 precisam (sugestões `suggestVarType` por amostra das 1000 primeiras linhas via
   `dict[codes[r]]`; mapping AS IS lê `parsedColumns[asIsVar].dict`). Trocar
   delimitador/cabeçalho no passo 1 **relê o `File`** (`reparseWizardFile`).
3. **`finalizeImportedColumns(headers, columns, n, columnTypes, decimalSep)`** — no
   confirm, converte para `Float64Array` **só** as colunas marcadas como métrica
   (`parseFloat` O(distintos) via `numByCode` + loop O(n) de inteiros) e aplica a
   normalização de decimal (`,`→`.`) **sobre os dicionários** (O(distintos), com
   dedup+remap de códigos quando valores colidem — ex.: `"1,5"` e `"1.5"`). Colunas
   não tocadas são reusadas por referência. `normalizeDecimalSep` (cópia integral)
   deixou de existir.
4. **`deriveMappedDictColumn(srcCol, n, mapFn)`** — `__DECISAO_ORIGINAL` vira coluna
   dict **derivada**: translate `código AS IS → código de 'APROVADO'/'REPROVADO'/''`
   + loop O(n) sobre `codes`, sem tocar nas demais colunas, sem copiar linha. Usada
   nos dois caminhos do confirm (import novo e edição).
5. **`retypeColumn(col, toNum, n)`** — o modo de edição do wizard reclassifica
   colunas (métrica ↔ dimensão) coluna a coluna, **sem `materializeRows`** (que
   copiava a base inteira como `string[][]`); colunas de tipo inalterado são
   compartilhadas por referência.
6. **`deriveClusterColumn(csv, def)`** — coluna dict de uma **Variável de Cluster**:
   first-match-wins por listas de valor por dimensão (bounding box), máscara `Uint8Array`
   por (grupo, dim) sobre o dicionário (O(distintos)) + loop O(linhas × grupos × dims) com
   early-break. Ver `docs/claude/Copiloto-Clusterizacao.md`.
Domínios da reconciliação de Cineminha no confirm saem de `distinctColValues`
(O(distintos)) em vez de varrer linhas. Nenhuma mudança de matemática nem de UX (3
passos, preview, progresso e validações idênticos). GATE:
`tests/importPipeline.test.js` — equivalência célula a célula contra o caminho
legado (parse `string[][]` → `normalizeDecimalSep` → append `__DECISAO_ORIGINAL` →
`buildColumnar`) reimplementado como controle, incl. aspas/CRLF/ragged/decimal
vírgula/colisão de normalização/`hasHeader=false`/`retypeColumn`.
