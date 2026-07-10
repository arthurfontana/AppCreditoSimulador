# Execução Híbrida — Prompts de Todas as Sessões

> **Ordem de execução recomendada**: **HP (pode rodar já)** · H0 → H1 → H2 → H3 →
> **H4 → H5 → H6** → H7 → H8 → H9
> (HP = sonda do ambiente Python, ortogonal a tudo; Fase 0 = H0–H3, browser puro, valor
> independente do híbrido; Fase 1 = H4–H6, fundação; Fase 2 = H7–H8, cargas reais;
> Fase 3 = H9, opcional/último).
>
> Referência normativa: [[Arquitetura-Execucao-Hibrida]] (DEC-HX-001..009 — **leia antes
> de qualquer sessão**) · [[PERFORMANCE-ANALISE]] (backlog M) · [[Otimizacao-Memoria]].
>
> **Premissas validadas (09/07/2026)** — refletidas nestas sessões: `pip` liberado mas
> instável ⇒ sonda HP antes da Fase 1 + install índice-primeiro/wheels-fallback (P1);
> alvo de projeto ~7MM de linhas (P2); **paridade total** — toda análise nova tem
> baseline browser com tetos declarados, nada é exclusivo do Python (P4); recomendação
> proativa do motor no carregamento da base (DEC-HX-009).
>
> **✅ Sonda HP executada (09/07/2026, 2 rodadas na máquina corporativa alvo)** —
> resultado: **os 4 pacotes (numpy/scipy/scikit-learn/duckdb) instalam E importam do
> índice**; nenhuma wheel offline imprescindível; único desvio é a 1ª importação do
> sklearn lenta sob antivírus (38s frios / 3,6s quentes). Consequências já refletidas
> na H5: detecção de tier com **warm-up assíncrono** + capabilities por pacote, tier
> `full` definido por numpy(+scipy) sem depender de sklearn, e wheels do CI rebaixadas
> a contingência opcional. Detalhes em [[Arquitetura-Execucao-Hibrida]] (§5 P1,
> DEC-HX-004).
>
> **🏷️ Tag de modelo**: `[FABLE]` (Fable 5 — tier Mythos, acima do Opus) **reservado às
> sessões de paridade numérica cross-runtime** (H7/H8/H9), onde o mesmo algoritmo vive em
> dois runtimes e o GATE exige igualdade número a número — a classe de erro típica ali
> (ordem de acumulação de ponto flutuante ao vetorizar, semântica de borda divergente
> entre JS e numpy) é silenciosa em fixture pequena e cara de depurar depois, então o
> upgrade de modelo custa menos que UMA sessão de retrabalho; `[OPUS]` para núcleos
> algorítmicos, refatoração estrutural e matemática sutil **em runtime único**; `[SONNET]`
> para UI sobre padrões consolidados, instrumentação e trabalho bem especificado.
> Análise esforço × custo da atribuição de Fable 5 em 10/07/2026 (ver nota ao fim).
>
> **Regras transversais (valem para TODAS as sessões):**
> 1. `npm test` passa inalterado ao fim — nenhuma sessão muda matemática do motor.
> 2. Estado novo criado/configurado pelo usuário segue a ⚠️ regra de persistência do
>    CLAUDE.md (`buildProjectPayload`/`loadProject`).
> 3. O tick de edição JAMAIS roteia para o sidecar (DEC-HX-007, regra de ouro).
> 4. Nada de framework novo no front nem no Python (sidecar = stdlib `http.server`,
>    padrão do `serve.py` existente).

---

## Sessão H0 — Telemetria Local de Custo 🏷️ [SONNET]

**Documentação**: [[Arquitetura-Execucao-Hibrida]] (§17 Fase 0) + [[SECURITY-AND-ENTERPRISE-READINESS]] §5.15 (front)

**Pré-requisitos**: Nenhum. Executável isoladamente.

**O que vai entregar**:
- Wrapper fino do `postMessage` do worker medindo duração por `type` de mensagem
  (`COMPUTE_*` → `*_RESULT`) + `rowCount` da base — só timestamps, fora do hot path
- Registro em ring buffer local (últimas ~200 medições) + `performance.memory` quando disponível
- Painel dev oculto (ex.: `?debug=perf` ou toggle em preferências) exibindo a tabela
  de custo por tarefa — **é a base factual para decidir o que rotear pro sidecar**
- Zero telemetria externa (nada sai da máquina)

**Resultado esperado**: números reais de custo por tarefa/base, visíveis sob demanda.

**Prompt**:
```
Vamos à Sessão H0 da Execução Híbrida (telemetria local de custo), conforme
docs/wiki/Arquitetura-Execucao-Hibrida.md. Implemente um wrapper fino no canal
postMessage do worker (App.jsx) que mede a duração entre cada COMPUTE_* e seu
*_RESULT (par request/response por tipo; só timestamps, nunca payload), acumulando
num ring buffer local (~200 entradas) com rowCount da base e performance.memory
quando existir. Exiba num painel dev oculto (query param ?debug=perf) uma tabela
por tipo de mensagem: última duração, média, p95, nº de execuções. Nada é
persistido nem enviado a lugar nenhum. Não toque no worker nem em matemática.
Releia o documento e o código antes de propor.
```

---

## Sessão H1 — Fluidez Restante do Backlog M (M12 + M13 + M14) 🏷️ [OPUS]

**Documentação**: [[PERFORMANCE-ANALISE]] (M12, M13, M14 — especificação normativa lá)

**Pré-requisitos**: Nenhum. Executável isoladamente (H0 antes ajuda a medir o ganho).

**O que vai entregar**:
- **M12**: `shapesById` memoizado, cena em `React.memo` (pan/zoom sem re-render dos
  filhos), drag por transform via rAF com commit no mouseup, chave topológica para
  `flowErrors`/`hiddenPortIds`
- **M13**: `validateFlow` com DFS tricolor O(V+E), sem cópia de `Set` por aresta
- **M14**: pivôs/filtros do Dashboard comparando códigos do dicionário (não strings),
  acumulação num único passe por widget

**Resultado esperado**: canvas fluido com fluxos grandes; Dashboard sem travar a
interação com 1MM de linhas. GATE: `npm test` inalterado (em especial `analytics.test.js`).

**Prompt**:
```
Vamos à Sessão H1 da Execução Híbrida (fluidez browser), executando os itens M12,
M13 e M14 de docs/wiki/PERFORMANCE-ANALISE.md exatamente como especificados lá
(seções "Solução recomendada" de cada um): M12 — shapesById memoizado + cena em
React.memo + drag do shape arrastado por transform/rAF com setShapes só no mouseup
+ flowErrors/hiddenPortIds derivados de chave topológica; M13 — validateFlow com
DFS tricolor iterativo O(V+E); M14 — applyAnalyticsFilters/pivotWidget/
computeWidgetMetric resolvendo códigos do dicionário uma vez por widget e
comparando inteiros no loop, com acumulação [bucket][série] num único passe.
Nenhuma mudança de matemática — npm test inalterado é o GATE. Releia
PERFORMANCE-ANALISE.md, o CLAUDE.md e o código antes de propor.
```

---

## Sessão H2 — Dieta de Memória para 2–5MM de Linhas 🏷️ [OPUS]

**Documentação**: [[Arquitetura-Execucao-Hibrida]] §2.2 (Eixo 1) e §17 Fase 0

**Pré-requisitos**: Nenhum. Executável isoladamente.

**O que vai entregar**:
- Códigos por cardinalidade em `columnar.js`: `Uint8Array` (≤255 distintos) /
  `Int16Array`/`Uint16Array` (≤65k) / `Int32Array` (fallback) — escolhidos no
  `buildColumnar`/pipeline M1; **métricas continuam `Float64Array`** (os GATEs de
  igualdade numérica exigem)
- Todos os consumidores de `codes` (worker compilado M8, analytics M15, accessors)
  agnósticos ao tipo do array (já leem por índice — validar e ajustar onde houver
  suposição de `Int32Array`)
- Serialize/deserialize (M3) preservando o dtype (campo novo no envelope base64,
  retrocompatível com os formatos anteriores)
- **Orçamento de memória no wizard**: estimativa de RAM colunar no passo 2
  (linhas × colunas × dtypes) com aviso quando ultrapassar limiar (~1,2GB), citando
  o Motor Python como alternativa — é a fundação da recomendação proativa completa
  (DEC-HX-009), que a H6 liga ao estado real do sidecar

**Resultado esperado**: bases de 2–5MM de linhas abrem e simulam no browser (o alvo
de projeto de ~7MM — P2 — abre com aviso; conforto pleno em 7MM é papel do sidecar).
GATE: `tests/columnar.test.js` estendido (round-trip com os três dtypes de código;
equivalência célula a célula inalterada).

**Prompt**:
```
Vamos à Sessão H2 da Execução Híbrida (dieta de memória), conforme
docs/wiki/Arquitetura-Execucao-Hibrida.md (§2.2 Eixo 1). Em src/columnar.js, faça
os códigos de dictionary encoding escolherem o menor typed array pela cardinalidade
(Uint8Array ≤255, Uint16Array ≤65535, Int32Array acima), aplicado no pipeline de
import (M1) e no buildColumnar legado; métricas permanecem Float64Array (GATEs de
igualdade exigem). Varra os consumidores de codes (motor compilado M8 no worker,
computeAnalyticsDataset/M15, accessors, serialize/deserialize M3) e remova qualquer
suposição de Int32Array — a serialização base64 ganha um campo de dtype no envelope,
retrocompatível com os três formatos aceitos hoje. Adicione ao passo 2 do wizard uma
estimativa de RAM colunar (linhas × colunas × dtype) com aviso acima de ~1,2GB.
Estenda tests/columnar.test.js: round-trip dos três dtypes, equivalência célula a
célula e runSimulation inalterados. Releia o documento, o CLAUDE.md e o código
antes de propor.
```

---

## Sessão H3 — Pool de Workers para Cargas Paralelas 🏷️ [OPUS] — ✅ CONCLUÍDA

**Documentação**: [[Arquitetura-Execucao-Hibrida]] §7.2 e §14 (Fase 0)

**Status (10/07/2026)**: entregue. Pool de workers **aninhados** (`navigator.hardware
Concurrency − 1`, teto 4, criado lazy na 1ª tarefa paralela) em `src/simulation.worker.js`,
shardando POR CANDIDATO as duas cargas embaraçosamente paralelas existentes: a validação por
re-simulação dos top-N em `buildSegmentRecommendations` e as N re-simulações INDIVIDUAIS de
`computeSegmentCombined` (a re-simulação COMBINADA continua **uma só**, inline — nunca
shardada, DEC-SD-003). Unidade de shard = `segValidateMoves` (aplica moves + `runSimulation` +
snapshot), pura, rodada por um pool-worker via `POOL_JOB`/`POOL_JOB_RESULT`. Base semeada UMA
vez por versão via `buildCsvStoreMessage` (SAB compartilha sem cópia sob COI; senão clone único
por worker). Resultados colhidos fora de ordem num `Map` por id e consumidos por id
(determinístico). Entradas paralelas: `computeSegmentDiscoveryPooled`/`computeSegmentCombinedPooled`
(usadas pelos handlers), com **fallback transparente** para o caminho síncrono quando o pool
não sobe (`typeof Worker === 'undefined'` / erro de construção). Vite bundla o worker aninhado
como `new Worker(self.location.href, {type:'module'})` (auto-referência ao mesmo script). GATE
dedicado `tests/workerPool.test.js` (pool ≡ single-worker número a número + determinismo sob
ordens de conclusão diferentes + fallback). Os caminhos síncronos (`computeSegmentDiscovery`/
`computeSegmentCombined`/`buildSegmentRecommendations`) seguem inalterados em números
(referência/fallback/contrato dos testes).

**Pré-requisitos**: H0 (para medir o ganho). Recomendado após H1/H2, mas independente.

**O que vai entregar**:
- Pool de N workers (`navigator.hardwareConcurrency - 1`, teto 4) criado sob demanda
  para **cargas embaraçosamente paralelas**: validação por re-simulação dos top-N da
  Descoberta (Sessão 12), aplicação combinada e futuros lotes do Goal Seek
- Compartilhamento da base via SAB quando `crossOriginIsolated` (Fase 2 da Otimização
  já garante isso no release); fallback: clone único por worker do pool, criado uma
  vez e reusado (nunca por job)
- Shard **por candidato** (cada worker recebe candidatos inteiros — nenhuma
  paralelização intra-simulação)
- Fallback single-worker quando pool indisponível; resultados em ordem determinística
  (ordenação final por id de candidato, independente de qual worker terminou antes)

**Resultado esperado**: validação de N recomendações ÷ nº de cores.
GATE: pool ≡ single-worker número a número + determinismo (`segmentDiscovery.test.js`
estendido ou teste dedicado).

**Prompt**:
```
Vamos à Sessão H3 da Execução Híbrida (pool de workers), conforme
docs/wiki/Arquitetura-Execucao-Hibrida.md (§7.2). Implemente um pool de Web Workers
(hardwareConcurrency-1, teto 4, criado lazy) para as cargas embaraçosamente
paralelas existentes: a validação por re-simulação dos top-N em
buildSegmentRecommendations e a aplicação combinada (computeSegmentCombined
permanece UMA re-simulação — não paralelize dentro dela; paralelize entre
candidatos/validações independentes). Shard por candidato; base compartilhada via
SharedArrayBuffer quando crossOriginIsolated (reusar buildCsvStoreMessage da Fase
2), senão um clone único por worker criado uma vez. Resultados re-ordenados
deterministicamente por id ao final; fallback transparente para o caminho atual
quando o pool não puder subir. GATE: resultado do pool ≡ caminho single-worker
número a número, determinismo em execuções repetidas. Releia o documento, o
CLAUDE.md e o worker antes de propor.
```

---

## Sessão HP — Sonda do Ambiente Python Corporativo 🏷️ [SONNET] — ✅ CONCLUÍDA

**Documentação**: [[Arquitetura-Execucao-Hibrida]] (§5 P1, §12 riscos)

**Status (09/07/2026)**: script criado (`checar_ambiente.py`, na **raiz** do repo — não
em `release/python/`; mover para lá é passo da H5) e **rodado 2× na máquina corporativa
alvo** (Windows 11, Python 3.13.3, pip 25.0.1, sem proxy). Resultado: 4/4 pacotes
instalam e importam do índice (numpy 2.5.1, scipy 1.18.0, scikit-learn 1.9.0, duckdb
1.5.4); **nenhuma wheel offline imprescindível**; sklearn com 1ª carga lenta por
antivírus (38s frios / 3,6s quentes — a 1ª rodada, com timeout de 30s, classificou isso
erroneamente como falha; o script foi corrigido para 2 tentativas de import, fria +
cache quente, e conclusão em 4 categorias). Consequências aplicadas na H5 (abaixo) e
na DEC-HX-004.

**Pré-requisitos**: Nenhum. **Pode (e deve) rodar antes de qualquer outra sessão do
híbrido** — é a validação empírica da premissa P1 (`pip` liberado, mas pacotes podem
falhar) na máquina corporativa real, antes de investir nas Fases 1–2.

**O que vai entregar**:
- `release/python/checar_ambiente.py` — script **stdlib puro** (roda em qualquer
  Python 3.9+, sem dependências) que: reporta versão do Python/pip/venv disponíveis;
  cria um venv **descartável**; tenta `pip install` (do índice) de numpy, scipy,
  scikit-learn e duckdb, um a um, com timeout; tenta importar cada um e reporta
  versão; mede tempos; e grava um relatório legível (`relatorio_ambiente.txt` +
  `.json`) **sem nenhum dado do usuário** — só metadados de ambiente
- Instruções de uso no topo do script (duplo clique / `python checar_ambiente.py`)
  para o analista rodar sem ajuda
- O relatório alimenta as decisões da H5: quais pacotes entram no tier `full` desta
  instalação, e se as wheels offline são necessárias (e para quais pacotes)

**Resultado esperado**: resposta factual, por máquina, à pergunta "o que o pip
corporativo realmente instala?" — risco de ambiente fora do caminho crítico.

**Prompt**:
```
Vamos à Sessão HP da Execução Híbrida (sonda do ambiente Python corporativo),
conforme docs/wiki/Arquitetura-Execucao-Hibrida.md (§5 P1). Crie
release/python/checar_ambiente.py: script Python 3.9+ 100% stdlib que (1) reporta
versão de Python, pip e suporte a venv; (2) cria um venv descartável em diretório
temporário; (3) tenta pip install do índice de numpy, scipy, scikit-learn e duckdb,
um a um, com timeout por pacote e captura do erro quando falhar; (4) tenta importar
cada pacote instalado e reporta a versão; (5) mede o tempo de cada etapa; (6) grava
relatorio_ambiente.txt legível + relatorio_ambiente.json na pasta do script — SEM
nenhum dado de negócio, só metadados de ambiente; (7) limpa o venv ao final.
Instruções de uso em comentário no topo e print inicial amigável. Nada de rede além
do próprio pip; nenhuma dependência externa para rodar o script em si. Não toque em
nenhum outro arquivo do projeto.
```

---

## Sessão H4 — ComputeRouter + Contrato ComputeProvider (front) 🏷️ [OPUS]

**Documentação**: [[Arquitetura-Execucao-Hibrida]] (DEC-HX-002/004/007, §8–§10)

**Pré-requisitos**: Nenhum técnico (recomendado após Fase 0). **Sem Python nesta sessão** — o sidecar é mockado nos testes.

**O que vai entregar**:
- Módulo `src/computeRouter.js`: interface `ComputeProvider`
  (`health/capabilities/registerDataset/runJob/cancelJob`), provider `worker`
  (default, encapsula o postMessage atual) e provider `sidecar` (fetch `127.0.0.1`,
  token, polling de jobs) — **payloads de resultado idênticos aos `*_RESULT` do worker**
- Tabela de roteamento por classe de tarefa (A/B — DEC-HX-007, paridade total): Classe
  A nunca sai do worker; B tenta sidecar com fallback aos tetos declarados — **toda
  tarefa tem caminho browser**, nenhuma exige o sidecar
- Detecção no boot (health 1s de timeout, mesma origem no release / URL configurada
  no dev), `protocolVersion` checado (mismatch ⇒ indisponível)
- Preferência `computeSidecar: {enabled, url?}` dentro de `preferences`
  (persistida — coberta pelo contêiner existente, sem bump de schema)
- Testes com sidecar mockado: indisponível/lento/versão errada/queda no meio do job
  ⇒ fallback correto por classe; Classe A jamais roteada

**Resultado esperado**: costura pronta e testada; comportamento do app inalterado
com a preferência desligada (default off).

**Prompt**:
```
Vamos à Sessão H4 da Execução Híbrida (ComputeRouter), conforme
docs/wiki/Arquitetura-Execucao-Hibrida.md (DEC-HX-002/004/007, §8–§10). Crie
src/computeRouter.js com a interface ComputeProvider (health, capabilities,
registerDataset, runJob com progresso, cancelJob), o provider worker (adapter do
postMessage atual — payloads intocados) e o provider sidecar (fetch em
http://127.0.0.1, header X-Compute-Token, POST /api/compute/jobs + polling de
/api/compute/jobs/{id}, registro de dataset por hash com HEAD antes de POST,
chunks do serializeCsvStore/M3 como corpo). Tabela de roteamento por classe
(DEC-HX-007, paridade total): Classe A sempre worker (o tick de edição NUNCA
roteia); Classe B sidecar com fallback transparente ao worker nos tetos declarados —
nenhuma tarefa exige o sidecar.
Detecção no boot com timeout 1s e checagem de protocolVersion; ausência de sidecar
é estado normal e silencioso. Preferência computeSidecar {enabled, url} dentro de
preferences (persistência já coberta; default off). Nesta sessão NÃO há Python:
teste com sidecar mockado (fetch stub) cobrindo indisponível, lento, versão
errada, queda no meio do job e a garantia de que Classe A jamais roteia. Releia o
documento, o CLAUDE.md e o código antes de propor.
```

---

## Sessão H5 — Sidecar Python v1 (serve.py estendido) 🏷️ [OPUS]

**Documentação**: [[Arquitetura-Execucao-Hibrida]] (DEC-HX-003/004/006/008, §8–§9)

**Pré-requisitos**: H4 (o front que fala com ele). **Recomendado**: HP já rodada na
máquina corporativa alvo (o relatório da sonda decide quais pacotes precisam de
wheels offline).

**O que vai entregar**:
- `release/sidecar.py` (um arquivo, stdlib apenas) importado pelo `serve.py`:
  endpoints `/api/compute/health|token|capabilities|datasets|jobs` conforme §8;
  `ThreadingHTTPServer`; bind `127.0.0.1`; token aleatório por boot; **sem headers
  CORS** para outras origens (modo dev: allowlist do origin do Vite via flag `--dev`)
- Decodificação do formato M3 (base64 → `array`/`memoryview` no tier stdlib;
  `numpy.frombuffer` quando numpy presente); datasets **só em RAM**, por hash,
  idempotente
- Detecção de tier **calibrada pela sonda HP** (DEC-HX-004): imports em **warm-up
  assíncrono no boot** (thread de fundo — a 1ª importação do sklearn levou 38s sob
  antivírus na máquina alvo; nunca importar inline no request); `capabilities`
  responde imediato com status **por pacote** (`{numpy:'2.5.1', sklearn:'loading'|
  null, ...}`) + cores/protocolVersion; tier `full` = numpy(+scipy) presentes —
  **sklearn nunca é gate do tier** (é extra da H8, carregado lazy no primeiro job
  que o usar)
- Job runner: fila, execução em processo filho (`multiprocessing`) com progresso e
  cancelamento; task inicial `echo_stats` (conta linhas, soma uma métrica — prova o
  round-trip ponta a ponta e serve de benchmark)
- `release/python/` com `requirements.txt` + `instalar_motor.bat` em camadas (P1):
  cria venv e tenta `pip install` **do índice** primeiro (validado pela HP: os 4
  pacotes instalam do índice na máquina alvo); para o que falhar, cai para
  `pip install --no-index --find-links wheels/` — **camada de contingência**: o
  relatório da HP não apontou nenhuma wheel imprescindível, então embarcar wheels
  no CI é **opcional/adiável** (documentar o passo no workflow sem ativá-lo; ativar
  se alguma outra máquina reportar falha de instalação de verdade)
- Mover `checar_ambiente.py` da raiz para `release/python/` (junto do instalador,
  para o analista rodar a sonda na própria máquina antes de instalar o motor)
- `tests_python/` com pytest mínimo (health/token/capabilities/dataset round-trip/
  job lifecycle), rodável local; integração ao CI como job separado e opcional

**Resultado esperado**: `iniciar.bat` sobe app + sidecar juntos; badge do H6 (ou log)
mostra tier detectado; `echo_stats` bate com o valor computado no worker.

**Prompt**:
```
Vamos à Sessão H5 da Execução Híbrida (sidecar Python v1), conforme
docs/wiki/Arquitetura-Execucao-Hibrida.md (DEC-HX-003/004/006/008, §8–§9). Crie
release/sidecar.py (arquivo único, stdlib apenas — http.server/ThreadingHTTPServer,
sem Flask) importado por release/serve.py: endpoints /api/compute/health, /token
(só mesma origem), /capabilities (status POR PACOTE via warm-up ASSÍNCRONO no boot
— thread de fundo importa numpy/scipy/sklearn/duckdb; a sonda HP mediu 38s na 1ª
importação do sklearn sob antivírus, então NUNCA importe inline no request; a
resposta é imediata com {numpy:'2.5.1', sklearn:'loading'|null, ...}, cores,
protocolVersion=1; tier full = numpy+scipy presentes, sklearn NUNCA é gate do
tier), /datasets (POST idempotente
por hash com corpo nos chunks base64 do serializeCsvStore/M3, decodificado para
array/memoryview ou numpy.frombuffer; HEAD para checar existência; dados SÓ em
RAM), /jobs (POST cria, GET status/progress/result, DELETE cancela; execução em
multiprocessing). Bind exclusivo em 127.0.0.1, token aleatório por boot no header
X-Compute-Token, nenhum header CORS exceto allowlist do origin do Vite sob flag
--dev. Task inicial echo_stats (rowCount + soma de uma coluna métrica) para provar
o round-trip contra o worker. Crie release/python/requirements.txt +
instalar_motor.bat em camadas (P1): venv + pip install do índice primeiro e, para
cada pacote que falhar, fallback pip install --no-index --find-links wheels/ —
camada de CONTINGÊNCIA: o relatório da HP (09/07/2026) mostrou que os 4 pacotes
instalam do índice na máquina alvo, então documente o passo de wheels no
build-release.yml sem ativá-lo (ativar só se outra máquina reportar falha real de
instalação). Mova checar_ambiente.py da raiz para release/python/. Testes pytest
em tests_python/ (health, token, capabilities durante e após o warm-up, dataset
round-trip, ciclo de job,
cancelamento), como job separado e opcional no CI. Releia o documento, o serve.py
e o computeRouter (H4) antes de propor.
```

---

## Sessão H6 — UX do Motor Híbrido 🏷️ [SONNET] — ✅ CONCLUÍDA

**Status (10/07/2026)**: entregue. Preferência `computeSidecar {enabled, url, token}` ligada
a um `ComputeRouter` real (`sidecarProviderRef` recriado por debounce, `computeRouterRef`
único criado junto do worker via um proxy estável); `ComputeEngineBadge` (⚡/⚙/🐍 + tooltip)
ao lado do `BuildBadge` e repetido na seção de preferências "🐍 Motor Python" (toggle,
URL/token só em `IS_DEV_BUILD`, botão "Verificar conexão"); helpers puros reutilizáveis em
`src/computeRouter.js` (`describeComputeBadge`, `describeCapabilitiesDetail`, `ceilingNotice`,
`fallbackNoticeText`, GATE em `tests/computeRouter.test.js`); `ComputeCeilingNotice` (degradação
declarada) e `ComputeJobProgress`/`ComputeFallbackNotice` (padrão de progresso/cancelamento e
aviso de fallback, prontos para H7/H8 — nenhuma tarefa Classe B real ainda). Banners DEC-HX-009
no wizard passo 2 (limiar por linhas ALÉM do de bytes — `RAM_COMFORT_BYTES`/`ROW_COMFORT_COUNT`
em `src/columnar.js`, GATE em `tests/columnar.test.js`) e na abertura de projeto
(`projectLoadNotice`, sobre o csvStore inteiro, uma só passada). `SidecarTestPanel` — smoke test
ponta a ponta `echo_stats` (registro de dataset por hash + job com progresso/cancelamento),
falando direto com o sidecar (não pelo `ComputeRouter`, que faria fallback pro worker — que não
implementa `echo_stats`). Nenhum comportamento muda com o motor desligado (verificado: `npm
test` verde, build de produção ok, fluxo exercitado num browser real via Playwright).

**Documentação**: [[Arquitetura-Execucao-Hibrida]] (DEC-HX-001/007, §9, §13)

**Pré-requisitos**: H4, H5.

**O que vai entregar**:
- Seção de preferências "Motor Python" (toggle + URL no modo dev + campo de token) —
  persistida em `preferences`
- Badge de status ao lado do `BuildBadge`: ⚡ tier full / ⚙ tier stdlib / cinza
  ausente, com tooltip (cores, pacotes, protocolVersion)
- Padrão de degradação declarada (paridade total, P4): helper de UI reutilizável para
  **tetos declarados** de tarefas Classe B ("profundidade limitada a 2 sem o Motor
  Python — saiba como ligar", mesmo padrão dos ✨ do Copiloto) e aviso discreto quando
  um job concluiu em fallback browser
- **Recomendação proativa no carregamento (DEC-HX-009)**: banner no passo 2 do wizard
  e na abertura de projeto quando a estimativa de RAM da H2 excede a zona de conforto
  (~5MM linhas / ~1,2GB) — recomenda ligar o Motor Python, mostra o que muda
  com/sem ele e nunca bloqueia o import
- Progresso/cancelamento de jobs do sidecar nos modais existentes (padrão
  `goalSeekModal step:'loading'`)
- Upload de dataset com progresso ("enviando base ao Motor Python — só na primeira vez")

**Resultado esperado**: usuário liga/desliga o motor com clareza total de estado;
nenhuma feature muda de comportamento com o motor desligado.

**Prompt**:
```
Vamos à Sessão H6 da Execução Híbrida (UX do motor), conforme
docs/wiki/Arquitetura-Execucao-Hibrida.md (DEC-HX-001/007/009, §9, §13). Com H4/H5
prontos, implemente: a seção de preferências "Motor Python" (toggle enabled, URL e
token visíveis só no modo dev; persistidos em preferences); o badge de status ao
lado do BuildBadge (⚡ full / ⚙ stdlib / ausente, tooltip com cores, pacotes e
protocolVersion, re-checagem no clique); um helper reutilizável de degradação
declarada (paridade total — tetos declarados de tarefas Classe B com "saiba como
ligar o Motor Python", padrão dos botões ✨ do Copiloto) e o aviso discreto
"concluído no modo browser" quando um job cair em fallback; a recomendação proativa
do motor no carregamento da base (DEC-HX-009): banner no passo 2 do wizard e na
abertura de projeto quando a estimativa de RAM da H2 exceder ~5MM linhas/~1,2GB,
recomendando ligar o motor, explicando a degradação sem ele e NUNCA bloqueando o
import; progresso e cancelamento de jobs do sidecar nos modais de loading
existentes (padrão goalSeekModal) e progresso do upload único de dataset. Nenhum
comportamento muda com o motor desligado. Releia o documento e o código antes de
propor.
```

---

## Sessão H7 — Primeira Carga Real: Descoberta Profunda (Classe B) 🏷️ [FABLE]

> **Por que Fable 5**: primeiro port cross-runtime do projeto — vetorizar em numpy um
> pipeline estatisticamente sutil (binomial exato/aproximado, Benjamini–Hochberg,
> shrinkage, dedup, beam search com poda) mantendo igualdade número a número com o JS.
> A ordem de operações da vetorização muda somas de ponto flutuante e a poda do beam;
> um desvio passa nas fixtures pequenas e explode só em base real. Esta sessão também
> **estabelece o padrão de GATE dourado** que H8/H9 herdam — errar aqui contamina as
> seguintes.

**Documentação**: [[Arquitetura-Execucao-Hibrida]] (DEC-HX-005/007, §7.3, §14) + [[Copiloto-DescobertaSegmentos]]

**Pré-requisitos**: H4, H5, H6 (e Sessões 10–12 do Copiloto, já entregues).

**O que vai entregar**:
- Task `segment_discovery` no sidecar: mesmo pipeline
  `discoverSegments → explainSegment → prioritizeFindings` portado para Python
  (vetorizado com numpy no tier full; no tier stdlib a task não é ofertada —
  `capabilities` decide), devolvendo um `SegmentModel` **byte-idêntico em estrutura**
  ao do worker
- No browser, o formulário da Descoberta ganha `maxDepth` 3–4 e teto maior de
  candidatos **apenas quando o sidecar está disponível** (Classe B: sem ele, os
  controles mostram o teto atual com o motivo)
- **GATE cross-runtime (DEC-HX-005)**: exportador de fixtures douradas no Vitest
  (entradas + `SegmentModel` esperado de `tests/segmentDiscovery.test.js` em
  `tests/fixtures/golden/`) e pytest que roda as mesmas fixtures em depth≤2 exigindo
  igualdade número a número (tolerância documentada para floats)

**Resultado esperado**: com o motor ligado, Descoberta em depth 3–4 sobre 1MM de
linhas em segundos; sem ele, comportamento atual intocado.

**Prompt**:
```
Vamos à Sessão H7 da Execução Híbrida (Descoberta profunda no sidecar), conforme
docs/wiki/Arquitetura-Execucao-Hibrida.md (DEC-HX-005/007) e
docs/wiki/Copiloto-DescobertaSegmentos.md. Porte o pipeline da Descoberta de
Segmentos (discoverSegments/explainSegment/prioritizeFindings, incl. binomial,
Benjamini–Hochberg, shrinkage SHRINK_K, dedup e diagnostics) para uma task
segment_discovery no sidecar, vetorizada com numpy (tier full apenas — a task não
aparece em capabilities no tier stdlib), devolvendo SegmentModel estruturalmente
idêntico ao do worker (a UI não distingue o executor). No front, o formulário
ganha maxDepth 3–4 e teto maior de candidatos somente com o sidecar disponível
(Classe B — sem ele, teto atual com motivo declarado, helper do H6). GATE
cross-runtime obrigatório (DEC-HX-005): gere fixtures douradas
(tests/fixtures/golden/*.json) a partir das fixtures de
tests/segmentDiscovery.test.js via Vitest, e um pytest que executa as mesmas
entradas em depth≤2 no motor Python exigindo igualdade número a número (tolerância
relativa 1e-9 para floats, 0 para contagens); sem o GATE verde a task não roteia.
Determinismo: mesma entrada ⇒ mesmo SegmentModel nos dois motores. Releia o
documento, a frente e o código antes de propor.
```

---

## Sessão H8 — Clusterização e Estatísticas Avançadas (paridade total: baseline browser + sidecar) 🏷️ [FABLE]

> **Por que Fable 5**: dupla implementação NASCENDO junta (JS loop + numpy vetorizado)
> com contrato de resultado idêntico via PRNG especificado (mulberry32) — a parte
> difícil não é o k-means, é garantir que init k-means++, desempates e acumulação de
> centroides produzam o MESMO resultado nos dois runtimes (soma vetorizada ≠ soma
> sequencial em float). Se o custo pesar, o fallback razoável é [OPUS] com revisão
> dedicada do GATE — mas o baseline browser + o GATE duplo na mesma sessão elevam o
> risco de sutileza cruzada.

**Documentação**: [[Arquitetura-Execucao-Hibrida]] (DEC-HX-005/007 — paridade total P4, §16)

**Pré-requisitos**: H5 (tier full), H6 (degradação declarada). Independente de H7.

**O que vai entregar**:
- **Baseline browser (worker)**: clusterização k-means (Lloyd) com inicialização
  k-means++ sobre PRNG **especificado** (ex.: mulberry32, seed derivada do hash do
  dataset + params) rodando sobre a base **agregada** pelas dimensões selecionadas —
  pós-agregação o nº de pontos é pequeno, viável em JS — com **tetos declarados**
  (nº de dimensões/valores distintos, k máximo)
- Task `cluster_segments` no sidecar (tier full): o **MESMO algoritmo determinístico**
  vetorizado em numpy (mesma init, mesma seed ⇒ mesmo resultado — é o que torna o
  GATE cross-runtime possível); sklearn entra como extra (silhueta para k automático,
  hierárquico como alternativa), sem tetos e mais rápido — **carregado lazy** no
  primeiro job que o usar (a HP confirmou sklearn 1.9.0 disponível na máquina alvo,
  mas com 1ª carga lenta sob antivírus; a UI tolera `sklearn: null|'loading'` nas
  capabilities sem esconder a feature — o baseline determinístico cobre tudo)
- `ClusterModel` no padrão da casa (dados crus, nunca prosa — irmão do
  `SegmentModel`/`docModel`), **idêntico nos dois executores**
- Modal efêmero no padrão `segmentDiscoveryModal` (form mínimo → loading → cards de
  cluster + quadrante Recharts) com **👁 Ver no Dashboard** (cluster → `FilterCard[]`)
- Botão de entrada **sempre habilitado** (paridade total): sem sidecar, o formulário
  mostra os tetos declarados com o motivo (helper do H6); com sidecar, os tetos somem
- GATE duplo (DEC-HX-005): Vitest com fixture sintética de clusters plantados
  (baseline browser recupera os grupos; determinismo; perfil por cluster ≡ agregação
  manual) + pytest sobre as MESMAS fixtures douradas exigindo `ClusterModel` idêntico
  número a número dentro dos tetos do browser

**Resultado esperado**: primeira análise inédita do épico — funcionando para TODOS os
usuários (com limites no browser), acelerada e sem limites com o motor ligado.

**Prompt**:
```
Vamos à Sessão H8 da Execução Híbrida (clusterização com paridade total), conforme
docs/wiki/Arquitetura-Execucao-Hibrida.md (DEC-HX-005/007 — paridade total P4, §16).
Implemente a clusterização de segmentos nos DOIS executores: (1) baseline no worker
JS — agregação da base pelas dimensões Filtro selecionadas no formulário, k-means
Lloyd com init k-means++ sobre PRNG especificado (mulberry32, seed derivada do hash
do dataset + params), tetos declarados de dimensões/valores/k; (2) task
cluster_segments no sidecar (tier full) com o MESMO algoritmo determinístico
vetorizado em numpy (mesma seed ⇒ mesmo resultado), sklearn só como extra (silhueta
para k automático, hierárquico como alternativa), sem tetos. Ambos devolvem um
ClusterModel no padrão da casa (dados crus: clusters com condições/centroides
interpretáveis, volume, aprovação, inadReal/inadInferida, mix e qualidade do
agrupamento — nunca prosa), estruturalmente idêntico. No front: botão SEMPRE
habilitado (paridade total — sem sidecar o formulário declara os tetos com motivo,
helper do H6), modal efêmero no padrão segmentDiscoveryModal (form → loading com
progresso → cards por cluster + quadrante volume × risco em Recharts) e ação
👁 Ver no Dashboard convertendo o cluster em FilterCard[] de página (mesmo formato
LensRule). GATE duplo (DEC-HX-005): Vitest com fixture sintética de clusters
plantados (baseline recupera os grupos, perfil por cluster ≡ agregação manual,
determinismo) e pytest sobre as MESMAS fixtures douradas exigindo ClusterModel
idêntico número a número dentro dos tetos do browser. Releia o documento e o
código antes de propor.
```

---

## Sessão H9 — Motor de Simulação em Python + Paridade Total (opcional) 🏷️ [FABLE]

> **Por que Fable 5**: o GATE mais rígido do projeto — desfecho POR LINHA idêntico entre
> o motor compilado M8 e um port numpy, replicando toda a semântica de borda
> (trim/first-wins, teto de pares do cineminha, AND/OR do lens, fallback AS IS,
> colunas não-dict). Vetorizar um walk de grafo por linha sem trair nenhum caso de borda
> é a tarefa mais difícil de todo o plano; um drift aqui invalida a Frente 5 inteira.
> É a sessão onde a diferença de modelo tem o maior valor esperado.

**Documentação**: [[Arquitetura-Execucao-Hibrida]] (§7.3, §17 Fase 3) + [[Roadmap]] (Frente 5)

**Pré-requisitos**: H5, H7 (padrão de GATE cross-runtime consolidado). **Última da fila —
só executar quando a Frente 5 (estratégias) ou o processamento da íntegra de bases
acima do conforto do browser (alvo P2 = 7MM+) forem priorizados.**

**O que vai entregar**:
- Port vetorizado (numpy) de `computeRowOutcomes`/`runSimulation` (roteamento
  compilado por códigos, mesma semântica do M8: trim/first-wins, cineminha por par
  de códigos, lens por passByCode, AS IS por `__DECISAO_ORIGINAL`)
- Task `batch_simulate`: N variantes de política (patches de PolicyIR/movimentos de
  Goal Seek) re-simuladas em paralelo — o bloco de construção da Frente 5
- **GATE de paridade do motor** (o mais rígido do projeto): fixtures douradas
  geradas das fixtures de `compiledEngine.test.js`/`simulationTick.test.js` —
  agregados E desfecho por linha idênticos entre worker e Python
- Roteamento Classe B: lotes grandes vão ao sidecar; lotes pequenos continuam no
  worker/pool (H3) — decisão por custo medido (H0)

**Resultado esperado**: re-simulação em lote ÷ (cores × vetorização); pré-requisito
técnico da Frente 5 cumprido.

**Prompt**:
```
Vamos à Sessão H9 da Execução Híbrida (motor de simulação em Python), conforme
docs/wiki/Arquitetura-Execucao-Hibrida.md (§17 Fase 3) e o item Frente 5 do
docs/wiki/Roadmap.md. Porte para o sidecar (tier full, numpy) o motor de
simulação: computeRowOutcomes/runSimulation com a MESMA semântica do motor
compilado M8 (rotas resolvidas por código sobre o dicionário, trim/first-wins nos
losangos, cineminha por par de códigos com teto de pares, lens por passByCode com
AND/OR, terminais approved/rejected/as_is via __DECISAO_ORIGINAL, acumuladores
inadRRaw/inadIRaw/qtdAltas/qtdAltasInfer idênticos). Exponha a task batch_simulate
(N variantes de política como movimentos applyGoalSeekMoves/patches de IR,
re-simuladas em paralelo, resultado por variante no formato de runSimulation).
GATE de paridade máxima (DEC-HX-005): fixtures douradas geradas das fixtures de
tests/compiledEngine.test.js e tests/simulationTick.test.js — agregados E desfecho
POR LINHA idênticos entre worker e Python em todas as combinações (decision/
cineminha/lens/AS IS/multi-csv); sem o GATE verde, batch_simulate não roteia.
Roteamento Classe B: lote pequeno fica no worker/pool (H3); lote grande vai ao
sidecar (limiar informado pela telemetria do H0). Releia o documento, o worker e
os GATEs antes de propor.
```

---

## Checklist de Execução

- [x] **Sessão HP** — Sonda do ambiente Python corporativo 🏷️ `[SONNET]` ✅ *(concluída 09/07/2026 — 4/4 pacotes OK via índice; sklearn com cold start de antivírus; wheels offline dispensáveis)*
- [x] **Sessão H0** — Telemetria local de custo 🏷️ `[SONNET]` ✅ *(concluída 10/07/2026 — wrapper fino + painel `?debug=perf`; revisão pós-sessão trocou o pareamento request/response de slot único por FILA FIFO por tipo: o debounce de 300ms não impede sobreposição de requests do mesmo tipo em base grande (tick ~0,7s), e o slot único subestimava justamente os ticks pesados)*
- [ ] **Sessão H1** — Fluidez (M12+M13+M14) 🏷️ `[OPUS]`
- [ ] **Sessão H2** — Dieta de memória (2–5MM linhas; alvo P2 = 7MM) 🏷️ `[OPUS]`
- [ ] **Sessão H3** — Pool de workers 🏷️ `[OPUS]`
- [ ] **Sessão H4** — ComputeRouter (front) 🏷️ `[OPUS]`
- [ ] **Sessão H5** — Sidecar Python v1 🏷️ `[OPUS]`
- [ ] **Sessão H6** — UX do motor híbrido + recomendação DEC-HX-009 🏷️ `[SONNET]`
- [ ] **Sessão H7** — Descoberta profunda (Classe B) 🏷️ `[FABLE]`
- [ ] **Sessão H8** — Clusterização (paridade total: baseline browser + sidecar) 🏷️ `[FABLE]`
- [ ] **Sessão H9** — Motor em Python / batch_simulate 🏷️ `[FABLE]` *(só quando a Frente 5 ou bases 7–10MM+ forem priorizadas)*

### 🏷️ Nota — análise esforço × custo da atribuição de Fable 5 (10/07/2026)

Critério aplicado: Fable 5 custa sensivelmente mais por sessão que Opus, então só entra
onde o **valor esperado do erro evitado** supera o sobrepreço — e a classe de erro mais
cara deste plano é **drift numérico entre runtimes** (DEC-HX-005 lista como "o pior
risco"): passa em fixture pequena, aparece semanas depois em base real, e o retrabalho
consome uma sessão inteira de modelo caro + a confiança no GATE.

| Sessão | Tag | Racional |
|---|---|---|
| H0, H6 | `[SONNET]` | Instrumentação e UI sobre padrões prontos — inalteradas |
| H1, H2 | `[OPUS]` | A parte difícil (a especificação normativa em PERFORMANCE-ANALISE / §2.2) **já está escrita**; execução em runtime único com GATEs existentes como rede — Fable seria custo sem redução de risco proporcional |
| H3, H4, H5 | `[OPUS]` | Engenharia sólida mas convencional (pool com re-ordenação determinística por id; router com contrato definido em §8; stdlib http.server no molde do serve.py) — o determinismo do H3 vem de arquitetura (shard por candidato + sort final), não de matemática sutil |
| H7, H8, H9 | `[FABLE]` | Paridade numérica cross-runtime: dupla implementação com igualdade número a número, onde vetorizar muda ordem de acumulação de float e cada semântica de borda do M8 precisa ser traída em NENHUM caso. H7 ainda estabelece o padrão de fixtures douradas que H8/H9 herdam |

Regra prática daqui pra frente: **`[FABLE]` quando (e só quando) a sessão cria ou
estende uma dupla implementação sob GATE cross-runtime**; runtime único, mesmo
algorítmico, fica em `[OPUS]`.

---

## Resumo das Dependências

```
Sonda (✅ concluída 09/07/2026)
  HP (sonda de ambiente)   ← RODADA: P1 validada (4/4 pacotes via índice);
                             wheels da H5 rebaixadas a contingência;
                             warm-up assíncrono na detecção de tier

Fase 0 (browser puro — valor independente do híbrido)
  H0 (telemetria)          ← isolada; base factual das decisões de roteamento
  H1 (fluidez M12–M14)     ← isolada
  H2 (dieta de memória)    ← isolada
  H3 (pool de workers)     ← isolada (H0 antes ajuda a medir)

Fase 1 (fundação híbrida)
  H4 (ComputeRouter)       ← isolada tecnicamente; recomendada após Fase 0
      ↓
  H5 (sidecar v1)          ← H4 (+ relatório da HP, recomendado)
      ↓
  H6 (UX do motor + DEC-HX-009) ← H4 + H5 (+ estimativa de RAM da H2)

Fase 2 (cargas reais)
  H7 (Descoberta profunda) ← H4–H6 (+ Copiloto S10–12, já entregues)
  H8 (clusterização, paridade total) ← H5 tier full + H6 (independente de H7)

Fase 3 (opcional)
  H9 (motor em Python)     ← H5 + H7 (padrão de GATE consolidado)
```

**Quando cada sessão pode rodar isolada:** HP — sempre, inclusive antes de tudo (é
um script avulso). H0, H1, H2 e H3 — sempre (não dependem do híbrido nem entre si).
H4 — isolada (sidecar mockado). H5+ — em cadeia.

**Ordem ideal para minimizar retrabalho:** ~~HP o quanto antes~~ ✅ HP concluída
(risco de ambiente fora do caminho); agora a numeração (H0→H9). A Fase 0 melhora o produto para
todos os usuários mesmo que o híbrido nunca seja ligado. Com o alvo de projeto de
~7MM de linhas (P2), as Fases 1–2 têm gatilho de produto próprio — o próprio alvo
as justifica, sem esperar um épico analítico; a Fase 3 continua puxada por demanda
real (Frente 5, bases na íntegra acima do conforto do browser).

---

## Padrões Gerais

1. **Leia** [[Arquitetura-Execucao-Hibrida]] (DECs) antes de qualquer sessão.
2. **Releia** o CLAUDE.md e o código citado no prompt.
3. **Reutilize**: serve.py, protocolo do worker, serializeCsvStore/M3, padrão
   AIProvider, modais de loading, padrão ✨ de degradação — nada de camada nova onde
   já existe costura.
4. **GATE sempre**: `npm test` inalterado + os GATEs novos da sessão (pytest quando
   houver Python). Paridade cross-runtime é bloqueante (DEC-HX-005).
5. **Persistência**: ⚠️ regra do CLAUDE.md para todo estado configurável novo.
6. Ao concluir uma sessão, **atualizar o Checklist acima** e o CLAUDE.md (seções
   novas seguem o padrão das existentes).

---

**Última atualização**: 2026-07-10 (revisão de tags de modelo: H7/H8/H9 promovidas de
`[OPUS]` para `[FABLE]` — Fable 5, tier acima do Opus — com análise esforço × custo
registrada na Nota do Checklist; demais sessões inalteradas: a especificação normativa
já escrita é o que torna Opus suficiente nelas). Histórico anterior:
2026-07-09 (planejamento; revisado no mesmo dia com as
premissas validadas pelo usuário: sonda HP nova, paridade total na H8, recomendação
DEC-HX-009 na H6, install em camadas na H5, alvo de projeto 7MM. **Sessão HP
executada e concluída no mesmo dia** — 2 rodadas na máquina corporativa: 4/4 pacotes
instalam/importam do índice, sklearn com cold start de antivírus (38s→3,6s), nenhuma
wheel offline imprescindível; H5 ajustada: warm-up assíncrono na detecção de tier,
tier full sem depender de sklearn, wheels do CI como contingência opcional)
