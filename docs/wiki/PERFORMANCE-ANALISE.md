# Análise de Performance e Memória — Diagnóstico e Roadmap Técnico

Análise profunda do código (`src/App.jsx`, `src/simulation.worker.js`,
`src/columnar.js`) com foco nas **causas reais** dos problemas de performance,
consumo de memória e erros de *Out of Memory* (OOM) no navegador. Todas as
conclusões abaixo citam o trecho de código que as evidencia — nada é sugestão
genérica de "boas práticas".

> **Contexto**: as Fases 0–4 da [[Otimizacao-Memoria|Otimização de Memória]] já
> resolveram os maiores ofensores *permanentes* (csvStore colunar, overlay não
> clonado pra main, dataset analítico colunar transferido). Esta análise mapeia
> **o que restou**: picos transitórios que ainda estouram a memória em fluxos
> específicos (import, save/export, Dashboard multi-canvas) e o custo estrutural
> de CPU que faz a aplicação "engasgar" com bases de ~1MM de linhas.
>
> **Premissa de implantação respeitada**: nenhuma melhoria abaixo exige servidor,
> serviço adicional ou infraestrutura. Tudo é client-side; o máximo continua
> sendo o `serve.py` local que já existe no release.

Referências de linha correspondem ao estado do código em `main` na data desta
análise (jul/2026; `App.jsx` ~10.749 linhas, worker ~1.423 linhas). Os tamanhos
de memória citados são **estimativas de ordem de grandeza** para a base de
referência (~1MM linhas × ~15 colunas, arquivo de ~130MB), derivadas do custo
conhecido de objetos JS no V8 — não medições de profiler.

---

## 1. Resumo executivo — onde estão os problemas hoje

1. **O import de CSV grande é hoje o maior pico de memória da aplicação.**
   Durante o wizard, a base inteira vive em RAM **em três formas ao mesmo
   tempo**: o texto cru (`rawText`, ~260MB), a matriz `parsedRows`
   (`string[][]`, ~15 milhões de objetos string — facilmente 600MB–1,2GB) e,
   no confirm, mais **duas cópias integrais** (`normalizeDecimalSep` e a
   derivação de `__DECISAO_ORIGINAL`) antes da vetorização colunar. O formato
   colunar (Fase 1) só nasce **no fim** do funil — todo o caminho até lá ainda é
   o formato antigo.

2. **O cache de overlay do Dashboard retém ~1MM de objetos JS por aba marcada,
   permanentemente, no worker.** `analyticsOverlayCache` guarda `rowDecisions`
   (1 objeto de 6 campos por linha) por canvas — com 3–4 abas marcadas, o heap
   do worker carrega centenas de MB de objetos que poderiam ser um `Int8Array`
   de 1MB. A chave desse cache ainda faz `JSON.stringify` de arrays de 1MM de
   booleanos a cada tick.

3. **Salvar/exportar projeto com base grande cria picos de 3–5× a base.**
   `serializeCsvStore` converte typed arrays em arrays planos (15MM números
   *boxed*) e `JSON.stringify` monta uma string única gigante. O "Exportar
   Fluxo com dados" é pior: usa `JSON.stringify(payload, null, 2)`, que coloca
   **cada número em uma linha própria** — multiplica o tamanho do JSON ~5–10×
   e é OOM quase garantido com base diária.

4. **Cada tick de edição faz ~4 varreduras completas da base no worker**, todas
   operando **string a string** (trim, concat de chave, `headers.indexOf` por
   linha) e alocando milhões de objetos temporários (`Set`, arrays de path) por
   passada. A base é colunar, mas os hot paths ainda a percorrem como se fosse
   texto — o dictionary encoding não é explorado para decidir rotas.

5. **`lensPopulations` é computado na main thread** (bloqueia a UI numa
   varredura de 1MM linhas × regras) e clonado para o worker como
   `Array<boolean>` de 1MM posições a cada `COMPUTE_OVERLAY`; com a aba
   Dashboard aberta, `buildAnalyticsCanvasInputs` refaz essa varredura na main
   **a cada tick de 300ms**, por lens, por canvas marcado.

6. **A UI re-renderiza o canvas inteiro a cada mousemove** (pan, zoom, drag) —
   custo inerente ao componente único (ADR-001) sem memoização da cena — e o
   effect de persistência em `sessionStorage` roda `JSON.stringify` de todos os
   canvases **por frame de drag**.

---

## 2. Lista priorizada de melhorias

Prioridade: **P0** = elimina OOM · **P1** = latência/travamento com base grande ·
**P2** = fluidez de UI · **P3** = eficiência incremental.

Tags de complexidade: **Sonnet** (pequena e localizada) · **Opus** (refatoração
média) · **Fable 5** (mudança arquitetural / raciocínio avançado).

---

### M1 · P0 — Pipeline de importação retém 3–5 cópias integrais da base — `Fable 5`

**Problema.** Da leitura do arquivo até o confirm do wizard, a base existe em
múltiplas formas simultâneas na RAM. Para um CSV de 130MB o pico facilmente
passa de 2GB — é o cenário de OOM mais provável hoje.

**Onde / evidências.**
- `App.jsx:3996` — `setWizard({rawText: text, ..., parsedRows: rows, ...})`:
  o wizard guarda **o texto cru inteiro** e **a matriz `string[][]` completa**
  no estado React, e os retém pelos 3 passos do wizard (só são soltos no
  `setWizard(null)` do confirm, `App.jsx:4396`).
- `App.jsx:4246` — `normalizeDecimalSep(rawRows, decimalSep)`: quando o decimal
  é vírgula, `rows.map(row => row.map(...))` cria **mais uma cópia integral**
  da matriz.
- `App.jsx:4266` — derivação de `__DECISAO_ORIGINAL`:
  `finalRows = baseRows.map(r => [...r, mapped])` — **outra cópia integral**
  (todas as ~1MM linhas re-alocadas) só para anexar uma coluna.
- `App.jsx:4276` — só **aqui** `buildColumnar` vetoriza. Tudo antes é string.
- Pico simultâneo no confirm: `rawText` + `parsedRows` + cópia do
  `normalizeDecimalSep` + `finalRows` + colunas typed recém-alocadas.

**Solução recomendada.** Vetorizar **durante o parse** e nunca materializar
`string[][]`:
1. `parseCSVAsync` passa a alimentar diretamente os encoders colunares
   (dictionary encoding para dimensões, `Float64Array` para métricas) em chunks,
   como `buildColumnar` faz hoje, mas linha a linha. A conversão de decimal
   (`,`→`.`) e o `parseFloat` acontecem nesse passo — `normalizeDecimalSep`
   deixa de existir como cópia.
2. O wizard guarda apenas: um **preview** de N linhas (~100), os **headers** e
   os **dicionários** por coluna (que já são a lista de distintos que os passos
   2 e 3 precisam para sugestões e mapping AS IS). `rawText` é solto assim que
   o parse termina; mudar delimitador/cabeçalho no passo 1 relê o `File`
   original (o handle fica guardado, não o texto).
3. `__DECISAO_ORIGINAL` vira uma coluna dict **derivada** no confirm: um mapa
   `código do dict da coluna AS IS → código de 'APROVADO'/'REPROVADO'/''` e um
   loop O(n) sobre `codes` — sem tocar nas demais colunas, sem copiar linha.
4. Detalhe: as colunas métricas só são conhecidas no passo 2 (tipos). Para não
   depender disso, parseia-se tudo como dict no passo 1 e converte-se para
   `Float64Array` **só as colunas marcadas como métrica** no confirm (conversão
   O(n) por coluna a partir de `dict[codes[r]]` — barata e sem cópia da base).

**Por que Fable 5.** Muda o contrato do wizard (que hoje assume
`parsedRows`/`rawText` em vários pontos: preview memoizado `App.jsx:5443-5458`,
`reparseWizardFile` `App.jsx:4009`, confirm `App.jsx:4175`) e o fluxo de dados
do import inteiro, mantendo a matemática e os GATEs (`tests/columnar.test.js`)
intactos.

**Dependências.** Nenhuma. Recomendado fazer **depois** de M2/M4 (ganhos mais
baratos primeiro), mas é independente.

---

### M1a · P0 — Detectores de delimitador/decimal fazem `split` do arquivo inteiro — `Sonnet`

**Problema.** Antes mesmo do parse, o import materializa o array de ~1MM de
strings **duas vezes** só para olhar as primeiras linhas.

**Onde / evidências.**
- `App.jsx:271` — `detectDelimiter`: `text.split(/\r?\n/).slice(0, 12)` — o
  `split` roda sobre o texto **inteiro** antes do `slice`.
- `App.jsx:287` — `detectDecimalSep`: `text.split(/\r?\n/).slice(1, 60)` — idem.
- Isso contradiz a própria Fase 0 (`parseCSVAsync` foi reescrito justamente para
  não fazer esse split — `App.jsx:329-334`), mas os detectores ficaram de fora.

**Solução.** Extrair as primeiras N linhas por índice (`indexOf('\n')`, mesma
técnica do `nextLine` de `parseCSVAsync`) e passar só esse prefixo aos
detectores. ~15 linhas de mudança, zero mudança de comportamento.

**Dependências.** Nenhuma. Independente de M1 (e continua valendo depois dele).

---

### M2 · P0 — Overlay por-linha como objetos JS + cache retido por canvas no worker — `Opus`

**Problema.** `computeSimulatedDecisions` materializa `rowDecisions` como
**1 objeto de 6 campos por linha** (~100–150MB por 1MM linhas). Isso já não
cruza mais para a main (Fase 4), mas: (a) é um pico transitório a cada
`COMPUTE_OVERLAY`; e (b) o `analyticsOverlayCache` **retém** esse array
integralmente, **por canvas marcado no Dashboard** — 3 abas ⇒ ~300–450MB de
objetos vivos no heap do worker, permanentemente. É o candidato mais provável
para OOM "ao usar o Dashboard com várias abas".

**Onde / evidências.**
- `simulation.worker.js:462-503` — `rowDecisions[rowIdx] = { rowIdx,
  decisaoOriginal, decisaoSimulada, flagImpactado, componenteOrigem,
  flagMutavel }` para **cada** linha.
- `simulation.worker.js:1170-1177` — `cachedCanvasOverlay` guarda
  `{ key, overlay }` em `analyticsOverlayCache[canvasId]`, sem limite de
  tamanho além da poda por abas vivas (`worker:1199-1200`).
- `simulation.worker.js:1171` — a chave do cache é
  `JSON.stringify(shapes) + JSON.stringify(conns) +
  JSON.stringify(lensPopulations || {})`. `lensPopulations` contém
  `Array<boolean>` de 1MM posições por lens — o stringify gera **~5–6MB de
  string temporária por lens, por canvas, a cada tick de 300ms** do Dashboard,
  além do custo de CPU.
- Consumidores reais do overlay usam **só 3 informações por linha**:
  `computeIncrementalResult` lê `rowIdx`/`decisaoOriginal`/`decisaoSimulada`/
  `flagImpactado` (`worker:532-568`); `computeAnalyticsDataset` lê apenas
  `rd.decisaoSimulada` (`worker:1281`).

**Solução recomendada.**
1. Representar o overlay como **typed arrays**: um `Int8Array` por csv com o
   código da decisão simulada (0=vazio, 1=APROVADO, 2=REPROVADO) — a decisão
   original já existe na coluna dict `__DECISAO_ORIGINAL` e `flagImpactado` é
   derivável comparando os dois. 1MM linhas ⇒ **1MB** em vez de ~120MB.
2. Trocar a chave do cache: `csvStoreVersion` + `JSON.stringify(shapes/conns)`
   (pequeno) + uma **chave de regras de lens** (as regras, não as populações —
   o mesmo conceito do `lensRulesKey` que já existe na main, `App.jsx:3049`).
3. Aproveitar e remover o que ninguém lê (ver M7).

**Dependências.** Nenhuma técnica; sinergia forte com M10 (lens no worker).
Os GATEs `analytics.test.js`/`inferenceCascade.test.js` validam a equivalência.

---

### M3 · P0 — Salvar/abrir projeto: arrays planos + `JSON.stringify` monolítico — `Opus`

**Problema.** Salvar um projeto com base diária cria: (1) arrays planos com
~15MM números *boxed* (`Array.from` sobre cada `Float64Array`/`Int32Array`);
(2) uma string JSON única de centenas de MB; (3) o blob. Pico de ~3–5× a base.
O load tem o espelho: `JSON.parse` da string gigante + arrays planos + typed
arrays reconstruídos.

**Onde / evidências.**
- `columnar.js:198-208` — `serializeColumns`: `Array.from(col.data)` /
  `Array.from(col.codes)` para **todas** as colunas.
- `App.jsx:4601` — `json = JSON.stringify(buildProjectPayload())` — string única.
- `App.jsx:4620` — a escrita já usa `createWritable()` (File System Access), que
  **aceita múltiplos `write()`** — a infraestrutura para streaming já está lá,
  mas recebe a string inteira de uma vez.

**Solução recomendada.**
1. Codificar os buffers tipados em **base64** (ou array de strings base64 em
   chunks) em vez de arrays planos: elimina os 15MM de números boxed, reduz o
   JSON (~30% menor que dígitos decimais) e serializa muito mais rápido.
   `deserializeCsvStore` mantém compatibilidade com os dois formatos antigos
   (arrays planos e `rows: string[][]`) — bump de `schemaVersion` para `2.3`.
2. No `saveProject`, escrever o JSON **em partes** no `createWritable` (payload
   "casca" primeiro, colunas uma a uma), evitando a string única. No fallback
   `<a download>`, montar o `Blob` com um **array de partes** (Blob aceita
   `BlobPart[]` — o navegador não precisa de uma string contígua).
3. No load, o `JSON.parse` da casca fica pequeno; as colunas base64 são
   decodificadas direto para typed arrays.

**Dependências.** Nenhuma. Atualizar `tests/columnar.test.js` (round-trip) e a
regra do CLAUDE.md sobre persistência.

---

### M4 · P0 — "Exportar Fluxo com dados" usa `JSON.stringify(payload, null, 2)` — `Sonnet`

**Problema.** O pretty-print com indentação coloca **cada elemento de array em
uma linha própria**. Com a base serializada (15MM números), o JSON "bonito"
fica ~5–10× maior que o compacto — um export que já seria grande vira uma
string de GB e derruba a aba.

**Onde / evidências.** `App.jsx:4474` —
`new Blob([JSON.stringify(payload, null, 2)], ...)` em `doExport`, que inclui
`csvStore: serializeCsvStore(csvStore)` quando `includeData` (`App.jsx:4472`).
O mesmo padrão em `exportCinema` (`App.jsx:4727`) é inofensivo (payload pequeno).

**Solução.** Remover `null, 2` do export com dados (ou de ambos os modos —
ninguém lê 15MM de linhas no editor). Uma linha de mudança. O ganho estrutural
completo vem com M3 (mesma codificação base64 + partes).

**Dependências.** Nenhuma.

---

### M5 · P0 — Export CSV do dataset analítico monta string única de ~1MM de linhas — `Sonnet`

**Problema.** `buildAnalyticsCSV` cria um array de 1MM strings de linha e faz
`join("\n")` — para uma base diária isso é ~200–400MB de strings temporárias +
a string final, na main thread, de uma vez.

**Onde / evidências.** `App.jsx:894-903` — `const lines = new Array(N); ...
return [header, ...lines].join("\n")`; consumido por
`exportAnalyticsDatasetCSV` (`App.jsx:906`) que cria um único Blob.

**Solução.** Montar o Blob com **partes em chunks** (ex.: a cada 50k linhas,
empurra uma string para um array de `BlobPart` e zera o buffer). `Blob` aceita
o array de partes sem concatenar em RAM. Opcional: ceder a thread entre chunks
(mesmo padrão do `parseCSVAsync`) para não congelar a UI durante o export.

**Dependências.** Nenhuma.

---

### M6 · P1 — Cada tick de edição = ~4 varreduras completas da base no worker — `Opus`

**Problema.** Um único gesto de edição (debounced em 300ms) dispara
`RUN_SIMULATION` **e** `COMPUTE_OVERLAY`; juntos eles percorrem toda a base
**quatro vezes**: `runSimulation`, `computeSimulatedDecisions`,
`computeIncrementalResult` (re-lê métricas linha a linha) e
`computeNodeArrivals` (que ainda anda **uma vez por root** por linha). Com o
Dashboard aberto soma-se `computeAnalyticsDataset`. Cada passada aloca por
linha: `visited = new Set()`, `path = []`, objeto `{result, path}`
(`worker:203`, `392`, `733`, `857`) — milhões de alocações por tick ⇒ GC churn
e latência de segundos entre o gesto e o painel atualizar.

**Onde / evidências.**
- `App.jsx:3038-3044` e `App.jsx:3093-3099` — os dois effects postam mensagens
  separadas com os mesmos inputs e o mesmo debounce.
- `simulation.worker.js:287-335` (runSimulation), `463-501`
  (computeSimulatedDecisions), `531-569` (computeIncrementalResult),
  `915-919` (computeNodeArrivals — `for (const root of csvRoots) walk(...)`
  dentro do loop de linhas).
- `headers.indexOf(node.variableCol)` roda **por linha, por nó** dentro de
  `traverseRow` (`worker:210`, `218-219`, `399`, etc.) — O(colunas) × nós ×
  1MM, quando podia ser resolvido uma vez antes do loop.
- Chave de aresta por concat de string por linha:
  `edgeLookup[cur]?.[`${match.to}::${match.label}`]` (`worker:214` etc.).

**Solução recomendada.**
1. **Um único passe**: uma mensagem `COMPUTE_TICK` (ou o próprio
   `COMPUTE_OVERLAY`) que, numa única iteração por linha, acumula
   simulação (totais + edgeStats), decisões simuladas (overlay tipado do M2),
   incremental e nodeArrivals. As quatro funções compartilham o mesmo
   `traverseRow` — a fusão é natural.
2. **Pré-resolver por nó, fora do loop de linhas**: índice de coluna, mapa
   `label→(edgeId, nextNode)` (dispensa `find` + concat por linha).
3. **Reutilizar estruturas**: `visited` como array de época
   (`lastVisit[nodeIdx] === epoch`) em vez de `new Set()` por linha; path como
   buffer reutilizado.

**Dependências.** Facilita e é potencializado por M8 (fluxo compilado sobre
códigos); pode ser feito antes, de forma incremental.

---

### M7 · P1 — Trabalho morto por linha: `componenteOrigem`, `path` e `summaryStats` que ninguém lê — `Sonnet`

**Problema.** Desde a Fase 4 o overlay não vai mais para a main — mas
`computeSimulatedDecisions` continua calculando, **por linha aprovada/
reprovada**, o `componenteOrigem` com `conns.find(c => c.id === path[...])` —
uma busca **O(conns)** por linha (com 40 conexões e 1MM linhas ⇒ ~40M
comparações por tick) — e mantendo o `path` (array + pushes por nó). Nenhum
consumidor lê `componenteOrigem`, `flagMutavel` nem `summaryStats`
(`computeIncrementalResult` usa só 4 campos; `computeAnalyticsDataset` usa só
`decisaoSimulada`).

**Onde / evidências.** `simulation.worker.js:482-487` (os dois `conns.find`),
`worker:459` e `503` (`summaryStats` calculado e guardado; nenhuma leitura no
worker — confirmável por grep), `worker:390-438` (path tracking do
`traverseRow` local).

**Solução.** Remover `componenteOrigem`, `flagMutavel`, `summaryStats` e o
rastreio de `path` do `computeSimulatedDecisions` (o `traverseRow` dele passa a
retornar só o resultado terminal). Se alguma feature futura precisar do
componente de origem, ela nasce como agregado (contagem por nó terminal), não
como string por linha.

**Dependências.** Nenhuma; é absorvido por M2/M6 se feitos juntos.

---

### M8 · P1 — Roteamento avaliado por string, linha a linha, ignorando o dictionary encoding — `Fable 5`

**Problema.** A base é colunar com dicionário (Fase 1), mas o motor decide a
rota de **cada linha** re-materializando strings e comparando texto:
`(cellStr(csv,r,colIdx) ?? '').trim()` + `find(e => e.label.trim() === val)`
nos losangos; `` `${rKey}|${cKey}` `` (concat + lookup em objeto por string) no
Cineminha; `matchLensRule` com `parseFloat`/`toLowerCase`/`split(',')` **por
linha** nos lenses e filtros. Para 1MM de linhas isso é o custo dominante do
tick — e é todo evitável, porque **o número de valores distintos é pequeno**
(dicionário) e as decisões dependem só do código.

**Onde / evidências.**
- `simulation.worker.js:209-233` (decision/cineminha em `traverseRow`),
  `worker:135-167` (`matchLensRule`/`rowMatchesLensRules` — parse e lowercase
  por linha), `App.jsx:593-607` (cópia na main).
- `worker:753-756` — chave de célula por template string por linha.
- O dicionário já é usado para *listar* distintos (`columnar.js:179-191`), mas
  nunca para *pré-resolver* decisões.

**Solução recomendada — "compilar" o fluxo sobre códigos.** Antes do loop de
linhas, para cada nó e cada CSV:
- **decision**: vetor `nextByCode[code] → (edgeId, nextNodeIdx)` construído uma
  vez sobre o dicionário da coluna (O(distintos));
- **cineminha**: matriz `cellIdx = rowCodeMap[code] * nCols + colCodeMap[code]`
  e vetor `eligibleByCellIdx` — o roteamento vira aritmética de inteiros;
- **lens/filtros**: avaliar as regras **uma vez por valor do dicionário**
  gerando `passByCode: Uint8Array` — por linha resta um lookup de inteiro.

O `traverseRow` deixa de tocar strings: lê `codes[r]` e segue ponteiros. A
matemática não muda (mesmos acumuladores); o GATE
(`tests/inferenceCascade.test.js`, FPD ≈ 40,06%) valida a equivalência.

**Por que Fable 5.** É a mudança estrutural do motor: exige desenhar a
representação compilada, cobrir os 5 tipos de nó e manter o modo legado
(`string[][]`, usado nos testes) funcionando pelo caminho atual.

**Dependências.** Idealmente após M6 (um passe só) para compilar uma vez por
tick; beneficia M10 (lens por código) e M14 (filtros do Dashboard por código).

---

### M10 · P1 — `lensPopulations`: varredura na main thread + clone de 1MM booleanos por tick — `Opus`

**Problema.** Três custos encadeados:
1. O `useMemo` de `lensPopulations` roda `computeLensAffectedRows` na **main
   thread** — varredura de todas as linhas de todos os CSVs, com
   `headers.indexOf(rule.col)` **por linha por regra** — travando a UI quando
   regras de lens ou a base mudam.
2. O resultado (`Array<boolean>` de 1MM posições por lens×csv) é **clonado**
   para o worker a cada `COMPUTE_OVERLAY` (structured clone de array JS
   genérico, elemento a elemento).
3. Com o Dashboard aberto, `buildAnalyticsCanvasInputs` **recomputa** as
   populações de lens de todos os canvases marcados, sincronamente na main,
   dentro do effect debounced — a cada 300ms de edição.

**Onde / evidências.** `App.jsx:3057-3065` (useMemo na main),
`App.jsx:627-637` (`computeLensAffectedRows` — loop de 1MM com
`rowMatchesLensRules`, que faz `headers.indexOf` por linha em `App.jsx:599`),
`App.jsx:3096` (post com `lensPopulations`), `App.jsx:3113-3119`
(recompute por canvas no `buildAnalyticsCanvasInputs`).

**Solução recomendada.** O worker já tem o `csvStore` e uma cópia de
`rowMatchesLensRules` (`worker:153-167`) — **mover a computação para lá**:
- `COMPUTE_OVERLAY`/`COMPUTE_ANALYTICS_DATASET` passam a receber apenas os
  shapes (que já contêm as `rules`); o worker deriva as populações localmente
  (memoizadas por `lensRulesKey` + `csvStoreVersion`).
- A main precisa só da **contagem** por lens para o nó `decision_lens` — o
  worker devolve `{[lensId]: {count, total}}` no `OVERLAY_RESULT`.
- Formato interno: `Uint8Array` (ou avaliação por código do dicionário, se M8
  já existir — aí o custo cai para O(distintos)).

**Dependências.** M2 (a chave do cache de overlay deixa de depender das
populações). Compatível com M8.

---

### M11 · P2 — `sessionStorage` serializado a cada frame de drag — `Sonnet`

**Problema.** O effect de persistência multi-canvas roda a cada mudança de
`shapes`/`conns` — e durante um drag `setShapes` é chamado **por mousemove**
(`App.jsx:3417-3439`). Cada frame paga `JSON.stringify` de **todos os
canvases** + `sessionStorage.setItem` (API síncrona). Com fluxos grandes /
várias abas, isso é jank visível durante o arraste.

**Onde / evidências.** `App.jsx:3143-3154` (deps `[shapes, conns, canvases,
activeCanvasId]`, sem debounce), `App.jsx:3412+` (setShapes no mousemove).

**Solução.** Debounce de ~500ms (mesmo padrão dos effects de simulação) +
flush em `beforeunload`/`visibilitychange` para não perder o último estado. Os
irmãos menores (`aw_layout_v1` etc., `App.jsx:3138-3140`) podem entrar no mesmo
util, embora raramente mudem em rajada.

**Dependências.** Nenhuma.

---

### M12 · P2 — Re-render integral do canvas a cada mousemove (pan/zoom/drag) — `Opus` — **entregue (H1)**

**Problema.** O App é um componente único (ADR-001): qualquer `setVp`
(pan/zoom) ou `setShapes` (drag) re-executa o corpo inteiro — incluindo
`conns.map(renderConn)` + `shapes.map(renderShape)` com todos os
`foreignObject` de Cineminha (uma matriz 20×24 = ~480 divs re-criados por
frame). Agravantes medíveis:
- `renderConn` faz `shapes.find(...)` **duas vezes por conexão** por render —
  O(conns × shapes) por frame (`App.jsx:5487`).
- Os memos `flowErrors` (`validateFlow`, DFS com cópia de `Set` por aresta —
  `App.jsx:658-671`), `hiddenPortIds` (`App.jsx:3080-3090`, loop
  conns×decisions) e `lensRulesKey` (stringify) re-rodam a cada mudança de
  `shapes` — isto é, por frame de drag.

**Onde / evidências.** `App.jsx:6886-6887` (render da cena),
`App.jsx:3416` (`setVp` por mousemove no pan), `App.jsx:3417+` (drag).

**Solução recomendada (incremental, sem quebrar o ADR-001).**
1. `shapesById = useMemo(() => Map(...), [shapes])` e uso em
   `renderConn`/handlers — remove o O(n²) imediato.
2. Extrair a cena para um componente `React.memo` que recebe
   `shapes/conns/sel/simResult/...` — **pan e zoom** deixam de re-renderizar os
   filhos (o `transform` do `<g>` raiz muda sozinho; hoje é o caso de re-render
   mais frequente e mais barato de eliminar).
3. Durante **drag**, mover apenas o shape arrastado: manter a posição
   transitória num ref + `transform` aplicado via rAF, comitando `setShapes` só
   no mouseup (o snapshot de undo já é feito no up — `App.jsx:3456-3462`).
4. `flowErrors`/`hiddenPortIds` só dependem de topologia (ids/labels/conns),
   não de x/y — derivar de uma chave topológica (mesmo padrão do
   `lensRulesKey`) para não recomputar por frame de drag.

**Dependências.** Nenhuma. Item 3 é o mais invasivo; 1–2 já eliminam a maior
parte do custo de pan/zoom.

> **Entregue (H1).** (1) `shapesById` (useMemo Map) em `renderConn`/handlers;
> (4) `flowErrors`/`hiddenPortIds` derivados de `topoKey` (chave topológica, sem
> x/y). (2) A cena (frames + conexões + shapes) é um elemento **memoizado**
> (`sceneEl = useMemo(...)`, deps = os insumos reativos do render EXCLUINDO `vp`);
> o `transform` de pan/zoom mora no `<g>` raiz fora do memo, então pan/zoom reusam
> o mesmo elemento e o React pula a reconciliação da subárvore. As funções de
> render não leem `vp` (o tooltip passou a usar `vpR.current`; código morto de
> hover card removido de `renderConn`). (3) O **arraste não chama `setShapes` por
> frame**: os ids arrastados saem da cena (`dragIds`, muda só ao iniciar/encerrar)
> e são desenhados numa **camada de overlay leve** transladada por `dragDelta`
> (atualizado via rAF); as arestas incidentes são recomputadas com o extremo
> arrastado deslocado (`renderConn(conn, effById)`); `setShapes` roda **uma vez no
> mouseup** (undo inalterado, ainda com o snapshot pré-arraste). Verificado em
> navegador (criação/arraste/undo, arraste com conexão seguindo, sem duplicação de
> shape/aresta, pan/zoom sem erro). GATE `npm test` inalterado.

---

### M13 · P2 — `validateFlow` copia o `Set` do caminho a cada aresta — `Sonnet` — **entregue (H1)**

**Problema.** O DFS de validação cria `new Set(path)` **por aresta visitada**
(`App.jsx:667`) e re-visita subgrafos compartilhados por múltiplos caminhos —
custo que explode combinatorialmente em fluxos com losangos encadeados
(diamond DAGs). Hoje os fluxos são pequenos; com políticas maiores isso vira
travamento por frame (roda no memo `flowErrors` a cada mudança de shapes).

**Onde / evidências.** `App.jsx:658-671`.

**Solução.** DFS iterativo clássico com marcação tricolor (em
processamento/finalizado) + memoização do resultado por nó — O(V+E) exato, sem
cópias. ~30 linhas.

**Dependências.** Nenhuma (independente de M12, que só muda *quando* roda).

> **Entregue (H1).** `validateFlow` é um DFS iterativo com estado tricolor
> (`IN_PROGRESS`/`DONE`) e resultado memoizado por nó (`okOf`) — cada nó é
> expandido uma vez, back-edge para `IN_PROGRESS` sinaliza ciclo sem reconstruir
> ancestrais. Sem `new Set(path)` por aresta. Combinado com M12 item 4, roda no
> memo `flowErrors` só quando a topologia muda (`topoKey`), não por frame de drag.

---

### M14 · P3 — Pivôs e filtros do Dashboard comparam strings por linha na main thread — `Opus` — **entregue (H1)**

**Problema.** Cada `analyticsDataset` novo (a cada 300ms com o Dashboard
aberto) faz **todos os widgets** recomputarem: `applyFiltersToDataset`
(varredura O(linhas × cartões) com `awColStr(...).trim()` por linha),
`pivotWidget` (bucketização por string + `filter` por série dentro de cada
bucket ⇒ O(linhas × séries)) e `computeWidgetMetric`
(`awColStr(decC, r) === "APROVADO"` — comparação de string por linha, quando o
código do dict resolveria com um inteiro). Com 4–6 widgets × 1MM linhas são
dezenas de milhões de operações de string por tick, na main thread — o
Dashboard "respira" mas trava a interação.

**Onde / evidências.** `App.jsx:1508-1524` (`applyAnalyticsFilters`),
`App.jsx:1433-1469` (bucketização e `bucketRows.filter` por série),
`App.jsx:1303-1313` (`computeWidgetMetric` — comparação por string),
`App.jsx:2126-2130` (recompute por widget a cada dataset).

**Solução recomendada.**
1. Resolver **códigos** uma vez por widget: `aprovadoCode =
   dict.indexOf('APROVADO')`, códigos dos valores de série/filtro — e comparar
   `codes[r] === code` no loop (inteiros, sem `.trim()`).
2. Bucketizar por `codes[r]` (o eixo X dict tem o bucket implícito no código) e
   acumular métricas **num único passe** por widget (matriz
   `[bucket][série] → acumuladores`) em vez de `filter` + re-varredura por
   série.
3. Se ainda pesar (muitos widgets), mover o pivô para o worker — mas 1–2
   provavelmente tornam isso desnecessário (mantém a simplicidade).

**Dependências.** Nenhuma; consistente com M8 (mesma filosofia).

> **Entregue (H1).** (1) `computeWidgetMetric` resolve o código de `"APROVADO"`
> uma vez (coluna de decisão dict) e compara inteiros por linha;
> `applyAnalyticsFilters` avalia cada cartão UMA vez por valor do dicionário
> (máscara `passByCode`), restando um lookup de inteiro por linha. (2) `pivotWidget`
> bucketiza por **código** do eixo X e acumula os 6 componentes da métrica numa
> matriz `[bucket][série]` num **único passe** pela base — sem `filter` +
> re-varredura por série (`O(linhas × séries)`). Dois modos: quebra por dimensão
> (uma linha cai em ≤1 série, via código da coluna de quebra) e cenário (a linha
> soma em todas as séries, cada uma com sua coluna de decisão). Fórmulas idênticas
> às de `computeWidgetMetric` (mesmas semânticas de `null`). O item 3 (mover ao
> worker) ficou desnecessário. Colunas não-dict mantêm o caminho por string. GATE
> `tests/analytics.test.js` e suíte completa inalterados.

---

### M15 · P3 — `computeAnalyticsDataset` re-codifica dimensões string a string — `Opus`

**Problema.** O join largo faz, **por linha × por dimensão**,
`cellStr(...)` → `Map.get(string)` (`putCode`) para re-codificar valores que
**já estão codificados** no dicionário da base. Com 10 dimensões × 1MM linhas
são ~10MM lookups de hash de string por recompute — quando bastaria uma
**tabela de tradução código→código** por coluna (O(distintos)) e cópia de
inteiros por linha.

**Onde / evidências.** `simulation.worker.js:1241-1266` (`putCode` no loop de
linhas; `enc[name].dictIndex.get(val)` por célula).

**Solução.** Para cada csv × dimensão, construir `translate: Int32Array` do
dicionário de origem para o dicionário de destino (registrando valores novos
uma vez); no loop de linhas, `codes[w] = translate[srcCodes[r]]`. As colunas de
decisão fazem o mesmo a partir do overlay tipado (M2).

**Dependências.** M2 (para a parte das decisões); o resto é independente.

---

## 3. Mudanças arquiteturais necessárias — e por que são indispensáveis

Nenhuma proposta adiciona infraestrutura: **tudo continua sendo um app estático
+ (opcional) o `serve.py` local**. As três mudanças "de arquitetura" são
internas ao runtime do navegador:

### 3.1 Import direto para colunar (M1)
**Por quê é indispensável:** o formato colunar (Fase 1) só existe *depois* do
funil de import — o pico de OOM foi empurrado para o wizard, não eliminado. Não
há como carregar uma base de 130MB sem OOM enquanto `rawText` + `string[][]` +
2 cópias coexistirem. **Alternativa mais simples possível:** manter o wizard e
seus 3 passos exatamente como estão na UI; mudar só o que o estado guarda
(preview + dicionários em vez da matriz integral) e onde a vetorização acontece
(durante o parse). Nada muda para o usuário.

### 3.2 Estado derivado por-linha vive só no worker, sempre tipado (M2 + M10)
**Por quê é indispensável:** os dois maiores consumidores de heap restantes são
estados derivados por-linha (overlay de decisões, populações de lens)
materializados como objetos/arrays JS genéricos e/ou trafegados entre threads.
A regra arquitetural que fecha essa classe de problema: *nenhuma estrutura
por-linha cruza o `postMessage`, e toda estrutura por-linha derivada é typed
array*. A main thread só recebe agregados (o que, aliás, já é a direção da
Fase 4). **Alternativa mais simples:** nenhuma — é a continuação natural do
que a Fase 4 começou.

### 3.3 Motor "compilado" sobre códigos do dicionário (M8)
**Por quê:** é o que destrava a próxima ordem de grandeza (bases maiores,
mais cenários) sem mudar nada da implantação. Estritamente falando não é
*indispensável* para eliminar os OOMs (M1–M5 resolvem isso) — é a mudança que
converte o custo de CPU do tick de "segundos" para "centenas de ms". Se o
roadmap priorizar só estabilidade, pode ficar por último ou ser adiada.

---

## 4. Plano de execução (ordem de implementação)

Cada item é uma conversa/PR independente. A ordem minimiza risco (quick wins
primeiro, mudanças estruturais depois) e respeita as dependências.

### Fase A — Quick wins (todos `Sonnet`, sem dependências, ~1 PR cada)
| # | Item | Efeito |
|---|------|--------|
| A1 | **M4** — remover pretty-print do export com dados | elimina o OOM mais barato de corrigir |
| A2 | **M1a** — detectores de delimitador/decimal por índice | corta 2 cópias integrais no início do import |
| A3 | **M7** — remover `componenteOrigem`/`path`/`summaryStats` mortos | ~O(conns)×1MM a menos por tick |
| A4 | **M11** — debounce da persistência em `sessionStorage` | drag sem stringify por frame |
| A5 | **M13** — `validateFlow` sem cópia de Set | robustez para fluxos grandes |
| A6 | **M5** — export CSV analítico em Blob por partes | export de 1MM linhas sem string única |

### Fase B — Memória estrutural (`Opus`, ordem importa)
| # | Item | Depende de |
|---|------|-----------|
| B1 | **M2** — overlay tipado (`Int8Array`) + chave de cache barata | A3 (código já limpo) |
| B2 | **M10** — lens populations no worker (main recebe só contagens) | B1 (chave de cache) |
| B3 | **M3** — save/load com base64 + escrita em partes (schema 2.3) | — |
| B4 | **M15** — join analítico por tradução código→código | B1 |

### Fase C — CPU / fluidez (`Opus`)
| # | Item | Depende de |
|---|------|-----------|
| C1 | **M6** — passe único do worker por tick + pré-resolução por nó | B1/B2 (mesmo traverseRow) |
| C2 | **M12** — memoização da cena (shapesById → Scene memo → drag por transform) | — |
| C3 | **M14** — pivôs do Dashboard por códigos, um passe por widget | — |

### Fase D — Arquitetural (`Fable 5`)
| # | Item | Depende de |
|---|------|-----------|
| D1 | **M1** — import vetorizado direto (wizard sem `rawText`/`parsedRows`) | A2 (detectores) |
| D2 | **M8** — motor compilado sobre códigos do dicionário | C1 (passe único) |

**Critério de aceite transversal** (vale para todas as fases): a suíte
`npm test` passa inalterada — em especial os GATEs numéricos
(`tests/inferenceCascade.test.js`, FPD ≈ 40,06%; `tests/columnar.test.js`,
equivalência célula a célula; `tests/analytics.test.js`). Nenhum item acima
altera matemática — só representação, momento e local do cômputo.

---

## 5. Tabela-resumo

| ID | Prioridade | Problema (curto) | Local principal | Complexidade |
|----|-----------|------------------|-----------------|--------------|
| M1 | P0 | Import retém 3–5 cópias integrais da base | `App.jsx:3996,4246,4266` | Fable 5 |
| M1a| P0 | Detectores fazem `split` do arquivo inteiro | `App.jsx:271,287` | Sonnet |
| M2 | P0 | Overlay como 1MM objetos + cache retido por canvas + stringify de booleanos na chave | `worker:462-503,1170-1177` | Opus |
| M3 | P0 | Save/load: arrays planos + JSON monolítico | `columnar.js:198-224`, `App.jsx:4601` | Opus |
| M4 | P0 | Export de fluxo com `JSON.stringify(…, null, 2)` | `App.jsx:4474` | Sonnet |
| M5 | P0 | Export CSV analítico em string única | `App.jsx:894-903` | Sonnet |
| M6 | P1 | ~4 varreduras da base por tick + alocações por linha | `worker` (4 funções) | Opus |
| M7 | P1 | Trabalho morto por linha (`componenteOrigem`, `path`, `summaryStats`) | `worker:459-503` | Sonnet |
| M8 | P1 | Roteamento por string ignora o dicionário | `worker:135-233` | Fable 5 |
| M10| P1 | Lens na main thread + clone de 1MM booleanos por tick | `App.jsx:3057,3113,627` | Opus |
| M11| P2 | `sessionStorage` por frame de drag | `App.jsx:3143-3154` | Sonnet |
| M12| P2 | Re-render integral do canvas por mousemove | `App.jsx:6886`, `renderConn` | Opus |
| M13| P2 | `validateFlow` com cópia de Set por aresta | `App.jsx:658-671` | Sonnet |
| M14| P3 | Pivôs/filtros do Dashboard por string na main | `App.jsx:1295-1471` | Opus |
| M15| P3 | Join analítico re-codifica strings por linha | `worker:1241-1266` | Opus |

---

*Documento gerado a partir de leitura integral do worker e do módulo colunar e
leitura dirigida do `App.jsx` (import, persistência, engines reativas, render e
Analytics Workspace). Serve como backlog técnico: cada M-item foi escrito para
ser implementável isoladamente em uma conversa futura.*
