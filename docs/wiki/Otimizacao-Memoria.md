# Otimização de Memória — Datasets Grandes (base dia-a-dia)

Plano de engenharia para permitir carregar bases sumarizadas **por dia** com
~1MM de linhas / ~130MB sem estourar a memória da aba do Chrome
(erro *"Out of memory"*).

> **Status:** Fases 0, 1 e 2 **entregues**. Dividido em 3 fases independentes e
> incrementais. Cada fase é entregável sozinha e verificável contra a suíte de testes.

---

## Contexto

A aplicação foi desenhada para bases **sumarizadas** (uma linha por agrupamento,
coluna `qty` = volume). O caso de uso evoluiu para bases sumarizadas **mas com
granularidade diária** — o número de linhas explode (combinações de dimensões ×
dias), chegando a ~1MM de linhas. A granularidade diária é **necessária** para a
análise, então não dá para re-agregar no import.

O problema não é o tamanho lógico dos dados — é que a arquitetura mantém
**várias cópias completas da base, toda em `string`, na RAM ao mesmo tempo**.

### Diagnóstico — por onde a memória vai

Do maior ofensor ao menor:

1. **Parse cria 3–4 cópias do arquivo** (`parseCSVAsync`, `src/App.jsx`):
   `text` cru (~130MB no disco → ~260MB em RAM, pois string JS é UTF-16 2 bytes/char)
   + `text.split(/\r?\n/)` (~260MB) + `.filter(...)` (mais um array de ~1MM) — e o
   `text` original continua vivo na closure da Promise.
2. **`csvStore[csvId].rows` é `string[][]` — o maior ofensor persistente.** Cada
   célula é um objeto `string` isolado (header V8 ~16–40 bytes *além* dos chars).
   ~15 colunas × 1MM linhas = **~15 milhões de objetos string**, tudo texto (mesmo
   as métricas numéricas, re-parseadas com `parseFloat` a cada tick).
3. **O worker recebe um clone COMPLETO do `csvStore`** (`UPDATE_CSV_STORE`,
   *structured clone* do `postMessage`) → **duas** cópias de 1MM×N vivas ao mesmo
   tempo (main thread + worker).
4. **`__DECISAO_ORIGINAL`** adiciona +1 coluna a cada linha.
5. **Dataset analítico largo** (`computeAnalyticsDataset`) materializa **um objeto
   por linha** e volta pra main thread por outro clone (`ANALYTICS_RESULT`).

Somando: `raw text + split + rows(main) + rows(worker) + dataset largo(worker) +
dataset largo(main)` ≈ **6–8× o tamanho lógico** → uma base "de 130MB" facilmente
vira 2–3GB de heap vivo, acima do limite prático de uma aba (~2–4GB).

---

## A solução: armazenamento colunar (vetorização)

Como a base é **sumarizada por dia**, os dados são majoritariamente **numéricos**
e as **dimensões repetem** todo dia (baixa cardinalidade). Esse é exatamente o
cenário onde armazenamento colunar ganha mais.

| Aspecto | Hoje (`string[][]`) | Colunar / vetorizado |
|---|---|---|
| Métricas (qty, altas, inad…) | objeto string por célula, `parseFloat` por tick | `Float64Array` — plano, já numérico |
| Dimensões (grupo, canal, faixa…) | objeto string por célula | *dictionary encoding*: dicionário de distintos + `Int32Array` de índices |
| ~1MM × 15 col | ~700MB–1GB (×2 no worker) | **~80–100MB** |
| Ida pro worker | clone (2ª cópia) | `ArrayBuffer` **transferível** (sem cópia) |

Ganho esperado: **~10× menos memória**, fim do pico do clone, e simulação mais
rápida (números prontos, sem `parseFloat` por tick).

### Por que é de-riscado

- **Padrão de acesso uniforme:** ~134 pontos leem dados quase sempre via
  `headers.indexOf(col)` → `row[idx]`. Um *accessor* (ex.: `col.get(rowIdx)` /
  "row view") esconde a estrutura nova sem reescrever a lógica de cada lugar.
- **Rede de segurança numérica:** o GATE `tests/inferenceCascade.test.js` fixa
  valores contra a amostra real (∑altas ≈ 418.775, FPD ≈ 40,06%) e
  `tests/analytics.test.js` pinga o pivot. Refatoração colunar é **verificável** —
  se o número bate, não quebrou.
- **Faseável:** sem big-bang (ver abaixo).

---

## Fase 0 — Cortar as cópias transitórias do parse

**Objetivo:** eliminar o pico de memória do parse. Isolado, baixíssimo risco,
sozinho já pode destravar o carregamento de 130MB.

**Escopo:** apenas `parseCSVAsync` (e `reader.onload`/`onprogress` associados) em
`src/App.jsx`. Nenhuma mudança na estrutura do `csvStore` nem no worker.

**O que fazer:**
- Não materializar `text.split(/\r?\n/).filter(...)` inteiro. Varrer o `text`
  buscando quebras de linha por índice (`indexOf('\n')`) e fatiar/parsear cada
  linha sob demanda, alimentando `rows` diretamente.
- Liberar a referência ao `text` cru assim que `rows` estiver montado (não segurar
  na closure da Promise além do necessário).
- Manter o batching cooperativo atual (ceder a thread a cada N linhas, reportar
  `onProgress`) e o modal `importLoading`.

**Critérios de aceite:**
- Base grande (centenas de MB) carrega sem `Out of memory`.
- Sem regressão no `tests/` existente (o parse continua produzindo os mesmos
  `headers`/`rows`).
- Comportamento visual do modal de progresso inalterado.

**Não faz parte:** mudar `rows` para colunar; mexer no worker.

---

## Fase 1 — Armazenamento colunar no `csvStore` + accessor

**Objetivo:** substituir `string[][]` por representação colunar (typed arrays +
dictionary encoding), atrás de um accessor que preserve o padrão de acesso atual.

**Escopo (core):** `src/App.jsx` (estrutura do `csvStore`, `parseCSVAsync`/import,
persistência do Projeto e `sessionStorage`) e `src/simulation.worker.js` (hot
paths). Migrar primeiro os *hot paths* do worker, que concentram os loops de 1MM e
o `parseFloat` por tick: `runSimulation`, `computeSimulatedDecisions`,
`computeCellMetrics`, `computeCinemaArrivals`, `computeAnalyticsDataset`.

**O que fazer:**
- Definir a estrutura colunar por coluna do `csvStore[csvId]`:
  - métricas (`qty`, `qtdAltas`, `qtdAltasInfer`, `inadReal`, `inadInferida`) →
    `Float64Array`;
  - dimensões / ID / decisão (incl. `__DECISAO_ORIGINAL`) → *dictionary encoding*
    (`{ dict: string[], codes: Int32Array }`).
- Introduzir um **accessor** (ex.: `getCell(csv, colIdx, rowIdx)` e/ou uma
  "row view" leve) para migrar os ~134 call sites mecanicamente, sem reescrever
  lógica de negócio.
- Adaptar a **persistência**: `buildProjectPayload`/`loadProject` e
  `serialize/deserialize` precisam lidar com typed arrays (não são JSON nativo —
  seguir o padrão de `serializeInferenceRef`) e cobrir o round-trip em teste. Ver
  regra em `CLAUDE.md` → "Salvar / Abrir Projeto".
- Reconciliação de dataset e domínios continuam funcionando (recomputar distintos
  a partir do dicionário, que já é a lista de distintos por construção).

**Critérios de aceite:**
- **GATE `tests/inferenceCascade.test.js` passa inalterado** (∑altas ≈ 418.775,
  FPD ≈ 40,06%) — prova numérica de que a refatoração não alterou resultados.
- `tests/analytics.test.js` e `tests/inferenceRef.test.js` passam.
- Round-trip de Projeto (`.credito.json`) preservando a base colunar coberto por
  teste novo.
- Memória de uma base de ~1MM linhas cai para a ordem de ~100MB (ver tabela).

**Não faz parte:** transferência sem clone pro worker (é a Fase 2).

---

## Fase 2 — Transferência sem cópia para o worker ✅ (entregue)

**Objetivo:** eliminar a segunda cópia da base (o clone do `postMessage`).

**Escopo:** protocolo de mensagens entre `src/App.jsx` e
`src/simulation.worker.js` (`UPDATE_CSV_STORE`), a alocação colunar em
`src/columnar.js` e os headers de isolamento em `vite.config.js`.

**Decisão de design — `SharedArrayBuffer`, não transferables.** A base é lida pelos
**dois lados** (a main renderiza preview/domínios/export/reconciliação em ~134 call
sites via accessor; o worker roda a simulação). Um `ArrayBuffer` **transferido** fica
**neutralizado** no remetente — então transferir a base para o worker tiraria o acesso
da main. Por isso seguimos a alternativa recomendada aqui: **leitura compartilhada via
`SharedArrayBuffer`**. Quando o contexto é *cross-origin isolated*, os typed arrays
colunares são alocados sobre `SharedArrayBuffer`; o structured clone do `postMessage`
**compartilha** essa memória por referência (não copia SAB), então main e worker leem
os mesmos bytes sem duplicar a base. O worker é **read-only** → sem write race.

**O que foi feito:**
- `src/columnar.js`: `sharedBuffersAvailable()` (feature-detect por
  `crossOriginIsolated`), alocadores `allocF64`/`allocI32` (SAB quando disponível,
  senão `ArrayBuffer` comum) usados em `buildColumnar` e `deserializeColumns`,
  `isSharedColumnar(csv)` e `buildCsvStoreMessage(csvStore)` — **fonte única** do
  payload/transfer do `UPDATE_CSV_STORE`.
- **Ownership:** a lista de *transferables* do `postMessage` é **sempre vazia**, de
  propósito. Com SAB, compartilha-se (SAB nunca é transferido/neutralizado); sem SAB,
  deixa-se o clone copiar (a main ainda precisa dos buffers). Em **nenhum** caso um
  buffer da base é neutralizado — a garantia "nada de acessar buffer neutralizado" vale
  por construção.
- `src/App.jsx`: o effect de `UPDATE_CSV_STORE` usa `buildCsvStoreMessage` +
  `postMessage(payload, transfer)`.
- `vite.config.js`: headers `Cross-Origin-Opener-Policy: same-origin` +
  `Cross-Origin-Embedder-Policy: require-corp` em `server`/`preview` para habilitar
  `crossOriginIsolated` no app servido (todos os assets são bundlados/same-origin, então
  require-corp não bloqueia nada).
- **`ANALYTICS_RESULT`:** o dataset largo é um array de **objetos simples** (sem typed
  arrays), então não há buffer a transferir — vetorizá-lo é otimização futura, fora do
  escopo desta fase.

**Degradação graciosa.** Fora de COI (release aberto via `file://`, browser sem os
headers, ambiente de teste Node/jsdom) `sharedBuffersAvailable()` é `false`: cai em
`ArrayBuffer` comum e o comportamento é o da Fase 1 (clone via structured clone) —
correto, só sem o ganho de memória.

**Critérios de aceite (atendidos):**
- Pico de memória durante `UPDATE_CSV_STORE` não duplica a base (com SAB, memória
  compartilhada por referência). ✅
- Simulação/overlay/analytics continuam corretos — GATE (`inferenceCascade`) +
  `analytics` + `columnar` passam, incluindo `runSimulation` sobre colunas SAB-backed. ✅
- Sem *race*: nenhum buffer da base é transferido/neutralizado; worker é read-only. ✅

**Testes:** `tests/columnar.test.js` cobre `sharedBuffersAvailable`/alocação condizente,
`runSimulation` sobre colunas SAB-backed (mesma FPD ≈ 40,06%) e
`buildCsvStoreMessage` (transfer vazio + base íntegra/legível após montar a mensagem).

**Pré-requisito:** Fase 1 concluída (base já em typed arrays).

---

## Ordem recomendada e independência

- **Fase 0** pode (e deve) ir **primeiro e sozinha** — alívio imediato, risco
  mínimo, não bloqueia nada.
- **Fase 1** é o compromisso maior (mexe no core) — vale um plano dedicado.
- **Fase 2** depende da Fase 1.

Cada fase deve ser desenvolvida na branch designada da sessão, com `npm test`
verde antes do push. O GATE numérico é a garantia de que a matemática da
inferência/simulação não mudou.
