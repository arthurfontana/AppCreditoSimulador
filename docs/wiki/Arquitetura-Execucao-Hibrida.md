# Execução Híbrida — ComputeProvider (Browser + Sidecar Python opcional)

> **Papel deste documento:** revisão arquitetural do modelo de dados e do motor de
> execução frente à evolução do produto (de simulador de políticas para **plataforma
> analítica**: clusterização, descoberta de agrupamentos, seleção de indicadores,
> estatística, feature engineering, bases menos sumarizadas), e especificação da
> arquitetura de **execução híbrida opt-in**: o navegador continua sendo o caminho
> padrão e completo; um **sidecar Python local** (extensão do `serve.py` que o release
> já embarca) passa a existir como camada opcional de aceleração e ampliação de
> limites — **que o usuário escolhe ligar ou não**.
>
> **Status:** planejamento. Nada aqui foi implementado. O plano de sessões executável
> por modelos mais baratos está em [[Hibrido-Prompts-Sessoes]].
>
> **Premissas validadas (09/07/2026):** as quatro premissas do §5 foram respondidas
> pelo usuário. P3 confirmada como estava; **P1, P2 e P4 mudaram** (pip liberado com
> sonda de ambiente; alvo de projeto ~7MM de linhas; paridade total — sem features
> exclusivas do Python — + recomendação proativa do motor no carregamento da base,
> DEC-HX-009). Este documento já reflete as respostas.
>
> **Análise-base:** leitura integral de [[PERFORMANCE-ANALISE]], [[Otimizacao-Memoria]],
> [[Roadmap]], [[Epicos-CopilotoIA]], [[SECURITY-AND-ENTERPRISE-READINESS]] e do código
> (`src/App.jsx` ~13.8k linhas, `src/simulation.worker.js` ~5.5k, `src/columnar.js`),
> em jul/2026.

---

## 1. Contexto — a mudança de natureza do produto

O produto mudou de perfil de carga três vezes:

1. **Editor/simulador de políticas** (origem): canvas + um passe de simulação por
   gesto de edição. Carga O(linhas) por tick, resolvida pelas Fases 0–4 da
   [[Otimizacao-Memoria]] e pelo motor compilado M8.
2. **Ferramenta de análise** (Analytics Workspace, Copiloto Sessões 0–6): dataset
   largo, pivots, comparação de cenários, documentação. Carga O(linhas × cenários),
   resolvida com dataset colunar transferido e overlays memoizados.
3. **Plataforma analítica** (agora, roadmap): Descoberta de Segmentos, Goal Seek com
   validação por re-simulação, aplicação combinada, Frente 5 (estratégias),
   clusterização, seleção automática de indicadores, feature engineering, bases menos
   sumarizadas. Carga **O(linhas × candidatos × cenários)** — multiplicativa — sobre
   bases que tendem a crescer em linhas E colunas ao mesmo tempo.

O receio que motivou esta revisão é legítimo: **não é o número de linhas isolado que
ameaça a arquitetura — é o crescimento simultâneo de linhas, colunas, cálculos
derivados, agrupamentos, indicadores, execuções repetidas durante a edição e
comparações entre simulações.**

## 2. Diagnóstico — o modelo atual suporta a evolução?

### 2.1 O que está resolvido (e não deve ser tocado)

O que existe hoje é, na prática, um mini motor OLAP colunar dentro do navegador:

| Componente | Evidência | Veredito |
|---|---|---|
| Armazenamento colunar + dict encoding (`columnar.js`) | 1MM×15 ≈ ~100MB (vs ~1GB em `string[][]`) | Correto; é a fundação de tudo |
| Motor compilado sobre códigos (M8) | tick fundido ~0,7s p/ 1MM linhas | Correto; simulação single-pass está resolvida |
| Passe único do tick (M6) + caches por versão | 1 varredura por gesto em vez de 4 | Correto |
| Zero-cópia (SAB Fase 2, transfer Fase 4) | base não é clonada pro worker | Correto |
| GATEs de equivalência numérica em tudo | `tests/*.test.js` | **O ativo que torna o híbrido viável** |
| Protocolo tipado `COMPUTE_* → *_RESULT` | worker isolado | **A costura pronta para trocar o executor** |

**Conclusão parcial:** para o que o produto faz hoje (simulação/roteamento sobre ~1MM
de linhas), o modelo atual suporta com folga, e ainda há gordura barata no backlog
([[PERFORMANCE-ANALISE]] M12/M13/M14).

### 2.2 Onde o modelo deixa de escalar, por eixo

**Eixo 1 — Linhas (memória): o limite duro.** O teto prático de heap de uma aba de
navegador é ~2–4GB, e nenhuma otimização de código muda isso.

| Base (colunar) | RAM estimada (typed arrays) | Viável no browser? |
|---|---|---|
| 1MM × 15 col | ~100MB | ✅ Hoje, com folga |
| 3MM × 20 col | ~350–500MB | ✅ Com a dieta de memória (Fase 0) |
| 5MM × 30 col | ~0,9–1,4GB | ⚠️ Limite — exige códigos `Int16/Uint8` e disciplina nos picos |
| **7MM × 30 col** (alvo de projeto — P2) | ~1,3–2GB | ⚠️/❌ No fio do teto da aba — abre só com dieta agressiva; conforto real é o sidecar (browser fica com amostragem declarada) |
| 10MM × 30 col | ~2–3GB | ❌ Acima do teto da aba — só com sidecar (ou amostragem declarada) |

Códigos `Int16`/`Uint8` para colunas de baixa cardinalidade (~metade das células de
uma base dimensional) compram ~2×; é ganho de constante, não de ordem.

> **Entregue (Sessão H2):** o dictionary encoding de `src/columnar.js` escolhe o menor
> typed array pela cardinalidade (`codesCtorForDict`: `Uint8Array` ≤256 distintos,
> `Uint16Array` ≤65536, `Int32Array` acima), no import vetorizado (M1) e no
> `buildColumnar` legado. Métricas seguem `Float64Array` (GATEs de igualdade). Os
> consumidores (motor M8, `computeAnalyticsDataset`/M15, accessors) leem `codes[r]` por
> indexação (dtype-agnóstico); a serialização base64 (M3) ganhou um campo `dtype` no
> envelope, retrocompatível com os três formatos aceitos. O passo 2 do wizard estima a
> RAM colunar (linhas × Σ dtype por coluna) e avisa acima de ~1,2GB (semente da
> DEC-HX-009). GATE em `tests/columnar.test.js` (round-trip dos três dtypes,
> equivalência célula a célula e `runSimulation` inalterados).

**Eixo 2 — Colunas: menos grave do que parece.** O motor compilado só toca colunas
referenciadas pela política; quem sofre com largura é o **dataset analítico largo**
(materializa todas as dimensões) e o import. Mitigável com colunas lazy no dataset
largo (materializar só o que widgets usam) — sem mudança arquitetural.

**Eixo 3 — Cálculos multiplicativos: o gargalo real do roadmap.** Descoberta de
Segmentos (beam search × testes), validação por re-simulação (Goal Seek, Sessão 12,
Frente 5 — que exige re-simulação **por combinação**, nunca soma de deltas),
comparação de N cenários: tudo O(linhas × candidatos), rodando num **único worker,
single-thread, sem SIMD**. O navegador tem resposta parcial (pool de workers — os
candidatos são embaraçosamente paralelos), mas cada avanço custa engenharia JS cara.

**Eixo 4 — Bibliotecas: o argumento verdadeiro pró-Python.** "Python é mais rápido"
é o argumento **errado**: um loop bem escrito sobre `Float64Array` fica a 2–5× do
numpy, e o projeto já escreve esses loops. O argumento certo: o roadmap pede
k-means/hierárquico, testes estatísticos além do binomial, binning ótimo, seleção de
features, PSI/IV em escala — em Python isso é `numpy`/`scipy`/`scikit-learn`/`duckdb`
**maduros e validados**; em JS é reimplementar e re-validar cada algoritmo à mão
(como foi feito com o teste binomial e o Benjamini–Hochberg da Sessão 10 — funcionou,
mas cada um custou uma sessão de modelo caro). O Python compra **alavancagem de
biblioteca + multicore + memória fora da aba** — não "velocidade de linguagem".

### 2.3 Alternativas avaliadas antes do Python

| Alternativa | O que resolve | O que NÃO resolve | Decisão |
|---|---|---|---|
| Fechar backlog M (M12/M13/M14) | Fluidez de UI, pivots por código | Memória, bibliotecas | **Fazer (Fase 0)** — barato, sem dependência |
| Dieta de memória (códigos `Int16/Uint8`, orçamento no wizard) | ~2× em linhas (até ~5MM) | Teto da aba, bibliotecas | **Fazer (Fase 0)** |
| Pool de Web Workers (shard por candidato) | Paralelismo das validações em lote | Memória, bibliotecas | **Fazer (Fase 0)** — os candidatos são independentes |
| Simulação incremental ([[Roadmap]]) | Latência do tick em edições localizadas | Cargas analíticas de base inteira | Manter no Roadmap (independente deste doc) |
| **DuckDB-WASM** (SQL colunar multi-thread; COOP/COEP já configurado) | Agregação/join/group-by ad-hoc de verdade | O walk de grafo da simulação (continua custom); sklearn; +~35MB de asset | **Adiar** — M14 resolve os pivots por fração do custo; revisitar se o Dashboard evoluir para consultas ad-hoc |
| Apache Arrow como formato de troca | Interop eficiente browser⇄Python | Nada sozinho | Adiar — o formato base64 do M3 já existe e é suficiente no v1; Arrow é otimização futura do transporte |
| WebGPU/WASM SIMD para o motor | CPU do tick | Memória, bibliotecas; alto custo de manutenção | Descartar por ora — o tick não é o gargalo |

**Leitura honesta:** as medidas browser-first compram headroom até ~5MM de linhas,
mas **não resolvem biblioteca estatística nem o teto de memória** — e o alvo de
projeto declarado (P2) é **~7MM**, acima dessa zona de conforto. Com esse alvo, o
híbrido não é "se" nem "quando um épico puxar": é parte do caminho para o próprio
alvo. Este documento define o contrato.

### 2.4 O detalhe que muda o custo da decisão

**O release local já embarca e exige Python.** `release/serve.py` é um servidor
Python que o usuário já roda (`iniciar.bat`) para habilitar COOP/COEP/SAB. O "servidor
Python local" **não é uma dependência nova** — é acrescentar endpoints a um processo
que já existe no fluxo de implantação corporativa. O risco de distribuição cai de
"convencer o banco a instalar um runtime" para "estender um script já homologado".

## 3. Impactos de não agir

- Novos épicos analíticos (clusterização, indicadores) nascem **caros**: cada
  algoritmo reimplementado/validado à mão em JS, numa thread só.
- Bases menos sumarizadas simplesmente não abrem (OOM no import ou no dataset largo),
  reeditando a crise que originou a [[Otimizacao-Memoria]] — mas desta vez sem
  gordura de representação para cortar.
- A Frente 5 (estratégias — re-simulação por combinação) fica inviável em tempo de
  interação.
- Alternativa ruim: sumarizar mais a base e perder exatamente a granularidade que as
  novas análises pedem.

## 4. Objetivos e não-objetivos

**Objetivos**
1. O navegador continua sendo o caminho **padrão e completo** — quem nunca ligar o
   Python não perde nada do que existe hoje (mesmo princípio do ADR-007 para IA).
2. Um sidecar Python local, **opt-in**, amplia limites (linhas, profundidade de
   busca, lote de validações) e destrava análises novas (clusterização, estatística
   scikit-learn) sem reescrever o motor JS.
3. Fronteira única e testável: a UI **nunca sabe** quem computou; o roteamento
   acontece atrás de uma interface (`ComputeProvider`), espelhando o `AIProvider`.
4. Paridade numérica **provada** onde houver dupla implementação (GATEs
   cross-runtime), nunca presumida.
5. Funcionar no ambiente corporativo real: sem internet, sem admin, sem cloud —
   no máximo o Python local que o release já usa.

**Não-objetivos**
- Migrar o tick de edição ou qualquer resposta a gesto do usuário para o sidecar
  (latência/fragilidade de HTTP vs. worker; o motor JS compilado é rápido o
  suficiente e continua sendo o coração do produto).
- Reescrever `App.jsx`/worker ou abandonar ADR-001..005.
- Servidor remoto/cloud (coberto como visão separada em
  [[SECURITY-AND-ENTERPRISE-READINESS]] §7.4 — este documento é sobre a máquina do
  usuário).
- Escolher framework web Python pesado: o sidecar v1 é stdlib (`http.server`, como o
  `serve.py` atual), sem Flask/FastAPI.

## 5. Premissas validadas (respostas do usuário em 09/07/2026)

> Estas quatro premissas foram assumidas na primeira versão da análise e depois
> **validadas com o usuário**. P3 foi confirmada; P1, P2 e P4 mudaram de conteúdo —
> os parâmetros do plano abaixo já refletem as respostas.

- **P1 — `pip` é liberado, mas pacotes individuais podem falhar** (proxy, política de
  pacotes, ausência de compilador). Estratégia em camadas, na ordem: (1) **sonda de
  ambiente ANTES de investir** (Sessão HP de [[Hibrido-Prompts-Sessoes]] — script
  stdlib `checar_ambiente.py` que testa install+import de numpy/scipy/sklearn/duckdb
  na máquina corporativa real e gera relatório; pode rodar hoje, antes de qualquer
  código do híbrido); (2) `instalar_motor` tenta `pip install` **do índice** primeiro;
  (3) **wheels offline embarcadas no zip do release** como fallback
  (`pip install --no-index --find-links`) só para o que falhar. O desenho de
  capacidades declaradas (DEC-HX-004) permanece intacto: o app se adapta ao que
  encontrar — tier `stdlib` (só Python puro) e tier `full` (pacotes científicos).

  **✅ P1 VALIDADA EMPIRICAMENTE (sonda HP rodada 2× em 09/07/2026 na máquina
  corporativa alvo — Windows 11, Python 3.13.3, pip 25.0.1, sem proxy configurado):**
  os 4 pacotes **instalam E importam do índice** (numpy 2.5.1, scipy 1.18.0,
  scikit-learn 1.9.0, duckdb 1.5.4). Único desvio: a **1ª importação do sklearn é
  lenta** (38s frios vs. 3,6s com cache quente — antivírus escaneando as DLLs na
  primeira carga; a 1ª rodada da sonda, com timeout de 30s, chegou a classificá-la
  erroneamente como falha). Consequências no plano: **(a)** as wheels offline ficam
  rebaixadas a **contingência** — nenhuma é imprescindível nesta máquina; o passo de
  embarcar wheels no CI (H5) torna-se opcional/adiável, mantendo o `instalar_motor`
  em camadas como está (o fallback é barato); **(b)** a detecção de tier do sidecar
  (H5) **não pode importar pacotes inline** no request de `capabilities` — warm-up
  assíncrono no boot (ver DEC-HX-004); **(c)** o tier `full` é definido por
  numpy(+scipy) — sklearn é extra por pacote, nunca gate do tier.
- **P2 — Alvo de projeto: ~7MM de linhas no horizonte de 1–2 anos.** Isso fica ACIMA
  da zona de conforto do browser (ver tabela do §2.2): browser-only cobre com folga
  até ~3MM e, com a dieta de memória (H2), até ~5MM; em 7MM o modo browser é
  **degradação declarada** (amostragem) e a íntegra é território do sidecar.
  Consequências: a Fase 0/H2 deixa de ser opcional (é pré-requisito do alvo) e as
  Fases 1–2 do híbrido têm gatilho de produto próprio — não esperam um épico
  analítico ser priorizado.
- **P3 — Escopo em fases: browser primeiro, híbrido em seguida** (**confirmada**).
  A Fase 0 (otimizações browser) precede o híbrido — é mais barata, beneficia todos
  os usuários e reduz a pressão sobre o sidecar.
- **P4 — Paridade total (substitui a classificação com classe exclusiva).** TODA
  feature analítica nova (clusterização, estatísticas avançadas, feature engineering)
  funciona no browser com **limites declarados** (amostragem, teto de candidatos,
  profundidade, dimensões) e o Python **remove os limites e acelera** — não existem
  features exclusivas do modo Python. Custo aceito conscientemente: GATEs duplos
  onde houver dupla implementação (DEC-HX-005). Complemento decidido junto: ao
  **carregar um dataset**, o app estima a capacidade e **recomenda proativamente**
  ligar o motor Python quando entender que o browser não dará conta (DEC-HX-009).

## 6. Decisões arquiteturais (DEC-HX)

### DEC-HX-001 — Local-first inegociável; Python é aceleração, nunca requisito
Espelho do ADR-007: assim como a IA é camada opcional sobre um produto 100% local, o
sidecar é camada opcional sobre um produto 100% browser. Critério de aceite
permanente: **desligar/remover o sidecar não remove funcionalidade nenhuma** — com a
paridade total (P4), toda tarefa volta ao baseline browser com seus tetos declarados.

### DEC-HX-002 — Fronteira única: `ComputeProvider` atrás do protocolo existente
O protocolo `COMPUTE_* → *_RESULT` do worker é a fronteira. Um **ComputeRouter** (na
main thread) decide, por tarefa, o executor: `worker` (default) ou `sidecar`. A UI
posta a mesma mensagem de sempre e recebe o mesmo payload de resultado — quem
computou é invisível (exceto pelo badge de status). Nenhum segundo caminho de
aplicação/materialização é criado (mesma disciplina da DEC-IA-002).

### DEC-HX-003 — O sidecar é o `serve.py` estendido
Mesmo processo, mesma porta, mesma origem do app no modo release — o que elimina
CORS e simplifica o pareamento. Endpoints sob `/api/compute/*`. No modo dev (Vite),
o sidecar roda à parte com allowlist de CORS para `localhost:5173` + token. Bind
**exclusivamente** em `127.0.0.1`.

### DEC-HX-004 — Capacidades declaradas, nunca presumidas
`GET /api/compute/capabilities` → `{tier, packages, cores, protocolVersion}`. O
ComputeRouter habilita tarefas pelo que o sidecar declara. Tier `stdlib` habilita só
paralelismo (multiprocessing) para cargas embaraçosamente paralelas; tier `full`
habilita vetorização e a remoção de tetos das análises Classe B (clusterização,
stats). **Honestidade técnica registrada:**
Python puro é 10–100× mais lento que o worker JS em loop por linha — o tier `stdlib`
é um degrau de instalação, não um destino; o valor real do híbrido está no tier
`full`.

**Detecção de tier (calibrada pela sonda HP, 09/07/2026):** a 1ª importação de um
pacote grande pode levar dezenas de segundos sob antivírus corporativo (sklearn:
38s frios vs. 3,6s quentes na máquina alvo). Por isso os imports de detecção rodam
em **warm-up assíncrono no boot do sidecar** (thread de fundo), nunca inline no
request — `capabilities` responde imediato com status **por pacote**
(`packages: {numpy:'2.5.1', sklearn:'loading'|null, ...}`) e o cliente pode
re-consultar. O tier `full` é definido pela presença de **numpy(+scipy)**; sklearn
e duckdb são declarados por pacote e habilitam extras (silhueta/hierárquico da H8,
SQL ad-hoc futuro), sem nunca serem gate do tier.

### DEC-HX-005 — Paridade provada por GATEs cross-runtime
Toda função com dupla implementação (JS + Python) tem um GATE de **fixtures douradas**:
o Vitest gera `tests/fixtures/golden/*.json` (entrada + saída esperada, determinística)
a partir do motor JS; o `pytest` do sidecar consome as mesmas fixtures e exige
igualdade número a número (tolerância 0 para inteiros/contagens; `1e-9` relativa para
somas de ponto flutuante, documentada por fixture). Sem GATE verde, a tarefa não
roteia pro sidecar. É a extensão natural da cultura de GATEs da casa para dois
runtimes.

> **Entregue (Sessão H7 — primeira aplicação da DEC):** GATE dourado da Descoberta de
> Segmentos — `tests/segmentDiscoveryGolden.test.js` (gera/trava 16 fixtures em
> `tests/fixtures/golden/`; drift do motor JS falha o teste) +
> `tests_python/test_segment_discovery.py` (mesmas entradas no motor numpy
> `release/python/motor_segmentos.py`; contagens exatas, floats rel 1e-9; medido na
> entrega: 704/710 números bit-idênticos, pior desvio 4e-16 — só transcendentais).
> Duas lições viram padrão para H8/H9: (1) toda soma de float replica a ORDEM
> SEQUENCIAL do JS (np.cumsum/np.bincount, nunca np.sum pairwise); (2) desempates de
> ordenação usam comparador ESPECIFICADO (`segStrCmp`, code units UTF-16) — nunca
> `localeCompare`, que depende do ICU/locale do runtime.

> **Entregue (Sessão H8 — segunda aplicação da DEC, primeira feature NASCIDA dupla):**
> GATE dourado da Clusterização de Segmentos — `tests/clusterSegmentsGolden.test.js`
> (gera/trava 4 fixtures `cluster_segments_*.json` em `tests/fixtures/golden/`) +
> `tests_python/test_cluster_segments.py` (mesmas entradas no motor numpy
> `release/python/motor_clusters.py`). Diferente da H7, aqui NÃO há transcendental no
> caminho do GATE: toda a matemática do k-means (agregação, z-score, distâncias,
> centroides, mulberry32) é racional + sqrt (IEEE, bit-exata nos dois runtimes) — a
> tolerância 1e-9 do comparador é folga defensiva. Os extras sklearn (silhueta/k
> automático, hierárquico) ficam FORA do dourado por construção: só rodam quando
> explicitamente pedidos, e o form só os oferece com o sidecar declarando sklearn.

### DEC-HX-006 — Dados sobem uma vez, referenciados por hash
O dataset é registrado no sidecar **uma vez por versão** (`POST /api/compute/datasets`,
corpo = os mesmos chunks de `serializeCsvStore`/`buildProjectJSONChunks` do M3 —
reuso integral, base64 de typed arrays). A chave é um hash do conteúdo (papel do
`csvStoreVersion` que o worker já usa). Jobs referenciam `datasetId`; o sidecar mantém
os dados **somente em RAM** (nunca em disco sem opt-in explícito). Trocar a base
invalida e re-registra.

### DEC-HX-007 — Classes de tarefa (contrato de degradação) — paridade total (P4)
- **Classe A — paridade total do core:** tudo que existe hoje (tick, overlay,
  otimizadores, Goal Seek, Descoberta depth≤2, DocGen...). Roda **sempre** no worker;
  o sidecar só entra, no futuro, como acelerador de lote (H9) com GATE de paridade.
- **Classe B — ampliada com degradação declarada:** com a decisão de paridade total
  (P4), esta classe passa a cobrir **todas as features analíticas novas**, além das
  versões estendidas de motores existentes. Toda feature nasce com implementação
  browser de **tetos declarados na UI** ("profundidade limitada a 2 sem o Motor
  Python", "clusterização sobre até N dimensões/valores", amostragem em base grande);
  o sidecar remove os tetos e acelera. Exemplos: Descoberta profunda depth 3–4, lote
  maior de validações, base >5MM, **clusterização, estatísticas avançadas, feature
  engineering**.
- **~~Classe C — exclusiva do sidecar~~ — eliminada** pela decisão de paridade total
  (09/07/2026): **nenhuma feature é exclusiva do modo Python** — ninguém fica travado
  sem ele. O padrão "botão desabilitado com motivo" (que era o contrato da Classe C)
  fica reservado apenas ao estado **transitório** de desenvolvimento em que o baseline
  browser de uma feature nova ainda não foi entregue — nunca como estado final.

**Regra de ouro:** o tick de edição e qualquer resposta síncrona a gesto **jamais**
roteiam pro sidecar. Sidecar é só para tarefas assíncronas com modal de
loading/progresso (padrão `goalSeekModal step:'loading'`).

### DEC-HX-008 — Segurança e privacidade do sidecar
Bind `127.0.0.1` apenas; token de pareamento gerado no boot (mesma origem no release:
`GET /api/compute/token` só responde a requisições da própria origem; no dev, o token
impresso no console é colado na UI); **nenhum header CORS** para outras origens
(páginas de terceiros não conseguem ler respostas); dados só em RAM; sem qualquer
chamada de rede externa; log local opcional. Alinhado com
[[SECURITY-AND-ENTERPRISE-READINESS]] (o sidecar não altera a postura "dado nunca sai
da máquina" — ele a preserva).

### DEC-HX-009 — Recomendação proativa do motor no carregamento da base
Decorrência direta da P4/P2: **ao carregar um dataset** (wizard de import — linhas ×
colunas conhecidas no passo 2 — e abertura de projeto `.credito.json`), o app estima a
capacidade do modo browser (RAM colunar projetada por dtype — mesma conta do orçamento
de memória da H2 — mais, quando existir, o custo por tarefa medido pela telemetria H0)
e, se a base provavelmente exceder a zona de conforto (~5MM de linhas ou ~1,2GB
estimados), exibe uma **recomendação explícita e acionável** de ligar o Motor Python:
o que acontece sem ele (amostragem/tetos declarados), o que muda com ele (íntegra, sem
tetos) e o caminho para ligar (preferências / `instalar_motor`). **Nunca bloqueia** —
é recomendação, não trava; o usuário pode seguir no browser com a degradação declarada.
Sem sidecar detectável e sem instalação disponível, a recomendação degrada para o aviso
informativo da H2.

> **Entregue (Sessão H6):** limiar por LINHAS (`ROW_COMFORT_COUNT`, ~5MM) somado ao de bytes
> (`RAM_COMFORT_BYTES`, ~1,2GB — `src/columnar.js`, mesma conta nos dois pontos de
> carregamento) porque uma base larga e rasa pode passar de 5MM linhas sem estourar 1,2GB. O
> banner do wizard passo 2 (H2) ganhou o `ComputeCeilingNotice` (texto do teto/desbloqueio
> conforme `computeSidecarStatus`) + botão "🐍 Ligar Motor Python" (liga a preferência com um
> clique, sem sair do wizard); `loadProject` ganhou o mesmo aviso (`projectLoadNotice`,
> dismissível) sobre o csvStore inteiro do projeto carregado. Nenhum dos dois bloqueia.

## 7. Arquitetura proposta

### 7.1 Topologia

```
┌──────────────────────────── Máquina do usuário ────────────────────────────┐
│  Browser                                                                    │
│  ┌──────────────┐  postMessage   ┌─────────────────────────┐               │
│  │ App.jsx      │◄──────────────►│ simulation.worker.js     │  Classe A     │
│  │  UI + estado │   (inalterado) │ motor compilado M8       │  (sempre)     │
│  │  ┌─────────┐ │                │ + pool de workers (H3)   │  Classe B     │
│  │  │Compute  │ │                └─────────────────────────┘  (com teto)   │
│  │  │Router   │ │  fetch 127.0.0.1 (token, jobs assíncronos)               │
│  │  └────┬────┘ │                                                          │
│  └───────┼──────┘                                                          │
│          ▼                                                                 │
│  ┌────────────────────────────────────────────┐                            │
│  │ serve.py estendido (sidecar opcional)      │  Classe B sem teto         │
│  │  /api/compute/{health,capabilities,token,  │  (análises novas: browser  │
│  │   datasets,jobs}                           │   com teto ⇄ aqui íntegra) │
│  │  tier stdlib: multiprocessing              │  dados SÓ em RAM           │
│  │  tier full:   numpy/scipy/sklearn/duckdb   │  zero rede externa         │
│  │               (wheels offline do release)  │                            │
│  └────────────────────────────────────────────┘                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Responsabilidades por camada

| Camada | Continua responsável por | Nunca faz |
|---|---|---|
| **Main thread (UI)** | Edição, drag/drop, render SVG, filtros de widget, preview, modais; ComputeRouter | Varredura de base (regra vigente desde M10) |
| **Web Worker (JS)** | Tick, overlays, otimizadores, Goal Seek, Descoberta depth≤2, DocGen, dataset largo — **tudo Classe A** + o baseline Classe B de toda análise nova, dentro dos tetos declarados (paridade total, P4) | Cargas acima dos tetos declarados (essas vão ao sidecar quando disponível) |
| **Pool de workers (H3)** | Shards de validação em lote (candidatos independentes) | Estado próprio (stateless por job) |
| **Sidecar Python** | Classe B sem tetos (incl. clusterização/stats em escala); futuramente lote de re-simulação (H9, pós-GATE) | Tick de edição; persistência de dados; rede externa |

> **Entregue (Sessão H3):** pool de workers **aninhados** em `src/simulation.worker.js`
> (`navigator.hardwareConcurrency − 1`, teto 4, lazy). Sharda POR CANDIDATO a validação por
> re-simulação dos top-N de `buildSegmentRecommendations` e as N re-simulações INDIVIDUAIS de
> `computeSegmentCombined` (a COMBINADA permanece uma só re-simulação inline — DEC-SD-003).
> Unidade de shard `segValidateMoves` (pura) rodada por `POOL_JOB`/`POOL_JOB_RESULT`; base
> semeada 1×/versão via `buildCsvStoreMessage` (SAB sob COI, senão clone único por worker);
> resultados colhidos fora de ordem e consumidos por id (determinístico). Entradas paralelas
> `computeSegmentDiscoveryPooled`/`computeSegmentCombinedPooled` com **fallback transparente**
> ao caminho síncrono quando o pool não sobe. Os caminhos síncronos seguem inalterados em
> números. GATE `tests/workerPool.test.js` (pool ≡ single-worker + determinismo + fallback).

### 7.3 Como um épico novo declara seus tetos

Com a paridade total (P4), a pergunta por feature deixou de ser "qual classe?" e
passou a ser: **quais são os tetos declarados do baseline browser, e o que o sidecar
remove?** Exemplos aplicados:

| Feature futura | Classe | Baseline browser (tetos declarados) → sidecar |
|---|---|---|
| Descoberta de Segmentos depth 3–4 | B | Motor JS já existe (depth 2); sidecar libera depth 3–4 e teto maior de candidatos |
| Clusterização de segmentos (k-means/hierárquico) — **✅ entregue (H8)** | B | Baseline JS sobre a base **agregada** pelas dimensões (pós-agregação o nº de pontos é pequeno), com tetos declarados (3 dims, k ≤ 8, 2.000 pontos); sidecar remove os tetos, acelera (numpy) e ganha extras sklearn (silhueta/k automático, hierárquico) |
| Seleção automática de indicadores (IV/PSI em massa) | B | `computeIV` já existe; browser limita nº de colunas×bins; sidecar amplia |
| Frente 5 (busca de estratégias, re-simulação por combinação) | B (pós-H9) | Browser: lotes pequenos via pool H3; lotes grandes exigem o motor Python com GATE de paridade — investimento da Sessão H9 |
| Bases acima da zona de conforto (~5MM; alvo P2 = 7MM) | B | Browser abre amostra declarada (com a recomendação DEC-HX-009); sidecar processa a íntegra |

## 8. Comunicação Browser ⇄ Python (protocolo v1)

```
GET    /api/compute/health         → {ok, version, protocolVersion}
GET    /api/compute/token          → {token}            (só mesma origem / release)
GET    /api/compute/capabilities   → {tier:'stdlib'|'full', packages:{numpy?...},
                                      cores, protocolVersion}
POST   /api/compute/datasets?hash= → corpo: chunks M3 (serializeCsvStore)
                                   → {datasetId}        (idempotente por hash)
HEAD   /api/compute/datasets/{id}  → 200 | 404          (pula re-upload)
POST   /api/compute/jobs           → {task, datasetId, params, protocolVersion}
                                   → {jobId}
GET    /api/compute/jobs/{id}      → {status:'running'|'done'|'error',
                                      progress: 0..1, result?, error?}
DELETE /api/compute/jobs/{id}      → cancela
```

- **Autenticação:** header `X-Compute-Token` em tudo exceto `health`.
- **Formato de dados:** o base64-de-typed-arrays do M3, decodificado no Python com
  `base64` + `numpy.frombuffer` (tier full) ou `array` (stdlib). **Nenhum formato
  novo é inventado** — round-trip já coberto por `tests/columnar.test.js` do lado JS.
- **Resultados:** o payload de `result` de cada `task` é **idêntico** ao payload da
  mensagem `*_RESULT` correspondente do worker (ex.: `segmentModel`) — é isso que
  torna o executor invisível para a UI.
- **Versionamento:** `protocolVersion` inteiro; mismatch ⇒ o router trata o sidecar
  como indisponível (nunca "tenta mesmo assim") e a UI explica ("Motor Python
  desatualizado — atualize o release").
- **Jobs longos:** polling de progresso a cada ~500ms alimenta o mesmo modal de
  loading; cancelamento no fechamento do modal.

## 9. Fluxos

**Boot/pareamento:** app carrega → ComputeRouter tenta `GET /health` (timeout 1s) na
mesma origem (release) ou na URL configurada (dev) → se ok, busca `token` +
`capabilities` → badge ⚡ "Motor Python: tier full (8 cores)". Falha em qualquer
passo ⇒ modo browser silencioso (sem erro — ausência é o estado normal).

**Registro de dataset:** primeira tarefa roteada → `HEAD /datasets/{hash}` → 404 ⇒
upload em chunks com progresso ("Enviando base ao Motor Python — só na primeira
vez") → jobs seguintes reusam o `datasetId`.

**Job com fallback:** UI posta tarefa → router consulta classe/capacidades →
sidecar: cria job + polling; **erro/timeout/queda no meio** ⇒ re-executa no worker
com os tetos declarados (aviso discreto "concluído no modo browser"). Com a paridade
total (P4) **sempre existe um caminho browser** — nenhuma tarefa falha por ausência
do sidecar. Resultado entregue à UI **no mesmo formato do worker**.

**Recomendação no carregamento (DEC-HX-009):** wizard passo 2 (linhas × colunas ×
dtypes conhecidos) ou abertura de projeto → estimativa de RAM colunar (mesma conta do
orçamento da H2) acima da zona de conforto (~5MM linhas / ~1,2GB) → banner
recomendando ligar o Motor Python, com as opções "continuar no browser (amostragem/
tetos declarados)" e "como ligar o motor" (preferências / `instalar_motor`). Nunca
bloqueia o import.

**Desligar:** preferência off ⇒ router nem tenta; tudo volta ao comportamento atual.
Não há estado a migrar (dados do sidecar são efêmeros em RAM).

## 10. Compatibilidade

- **Projetos `.credito.json`:** nenhuma mudança de schema estrutural. A preferência
  `computeSidecar: {enabled, url?}` entra no contêiner `preferences` já persistido
  (coberto pela ⚠️ regra do CLAUDE.md; sem bump).
- **Modo dev (Vite):** sidecar à parte (`python sidecar.py --dev`), CORS allowlist
  para o origin do Vite, token colado na UI. Modo release: mesma origem, zero config.
- **Sem Python / Python antigo:** detecção falha ⇒ modo browser. Suporte mínimo:
  Python 3.9+ (o que o `serve.py` já assume implicitamente).
- **GATEs existentes:** intocados — nenhuma matemática do worker muda em nenhuma fase.

## 11. Performance — o que esperar (e o que não esperar)

| Carga | Hoje (worker) | Fase 0 (browser) | Sidecar tier full |
|---|---|---|---|
| Tick de edição 1MM | ~0,7s | ~0,7s (inalterado — não roteia) | inalterado |
| Validação de N recomendações | N × re-simulação sequencial | ÷ cores (pool H3) | ÷ cores + vetorização |
| Descoberta depth 3–4, 1MM | inviável (teto) | inviável (teto declarado) | segundos (numpy + multicore) |
| Clusterização | inexistente | baseline JS sobre agregados, tetos declarados (P4) | sem tetos, vetorizada |
| Base 7MM (alvo P2) | OOM | abre com dieta agressiva ou amostra declarada + recomendação DEC-HX-009 | íntegra (RAM do processo, fora da aba) |
| Base 10MM | OOM | amostra declarada | íntegra (RAM do processo, fora da aba) |

**Não esperar:** ganho do sidecar em tarefas curtas (<200ms — o roundtrip HTTP+
registro come o ganho); ganho do tier `stdlib` em loops por linha (Python puro é
mais lento que o worker JS — ver DEC-HX-004).

## 12. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| **Drift numérico entre motores** (o pior risco) | DEC-HX-005: fixtures douradas cross-runtime como GATE bloqueante; sem GATE, não roteia. Dupla implementação restrita ao mínimo (Classe A só no worker até H9) |
| `pip` liberado mas pacote específico falha (P1) | **✅ Medido pela sonda HP (09/07/2026): os 4 pacotes instalam e importam do índice — risco não se materializou nesta máquina.** `instalar_motor` mantém as camadas (índice primeiro, wheels offline `release/python/wheels/` como contingência; embarcar wheels no CI é opcional/adiável); falha total ⇒ tier stdlib ⇒ modo browser. Nunca um estado quebrado |
| Antivírus atrasa a 1ª importação de pacote grande (medido: sklearn 38s frios / 3,6s quentes) | Warm-up assíncrono dos imports no boot do sidecar (DEC-HX-004); `capabilities` responde imediato com status por pacote; tier `full` não depende de sklearn |
| Custo de manter GATEs duplos (paridade total, P4) | Aceito conscientemente na validação das premissas; mitigado pelas MESMAS fixtures douradas alimentando Vitest e pytest (uma fonte, dois consumidores) e por baselines browser que compartilham primitivas já testadas do worker |
| Antivírus/política corporativa bloqueia o processo Python | Já é risco do `serve.py` atual (mesmo processo); documentar no manual; modo browser é o fallback universal |
| Porta ocupada / múltiplas instâncias | Porta configurável; token por instância; health-check identifica a versão |
| Complexidade de manter dois runtimes | Classes A/B limitam o que é duplicado; protocolo versionado; pytest no CI ao lado do Vitest |
| UX confusa ("por que o resultado demorou/mudou?") | Badge de executor sempre visível; resultados **idênticos por contrato** (GATE); degradações sempre declaradas em texto |
| Segurança do endpoint local | DEC-HX-008 (loopback + token + sem CORS + RAM-only); revisão na frente de segurança |

## 13. Casos de uso

1. **Analista sem permissão de nada:** usa o app como hoje (browser puro). Nada muda.
2. **Analista com o release padrão:** `iniciar.bat` já sobe o `serve.py` estendido —
   tier stdlib disponível sem passo extra; validações em lote ganham paralelismo.
3. **Analista power-user:** roda `instalar_motor.bat` uma vez (venv + wheels
   offline) → tier full → Descoberta profunda, clusterização, bases grandes.
4. **Base acima da zona de conforto (5MM+; alvo P2 = 7MM):** o wizard detecta o
   tamanho no carregamento e **recomenda proativamente** ligar o Motor Python
   (DEC-HX-009), oferecendo "abrir amostra no navegador (limites declarados)" ou
   "processar íntegra no Motor Python" (se disponível/instalável). Nunca bloqueia.

## 14. Cenários de teste (GATEs por fase)

- **Fase 0:** todos os GATEs atuais inalterados; H2 estende `columnar.test.js`
  (round-trip com códigos `Int16/Uint8`); H3 prova pool ≡ single-worker
  (determinismo e igualdade número a número).
- **Fase 1:** router com sidecar mockado (indisponível/lento/versão errada ⇒
  fallback correto por classe); round-trip de dataset por hash; jobs
  (progresso/cancelamento/erro).
- **Fase 2:** fixtures douradas por tarefa portada (DEC-HX-005); Descoberta depth 2
  idêntica nos dois motores sobre as fixtures de `segmentDiscovery.test.js`;
  determinismo do sidecar (mesma entrada ⇒ mesmo resultado, incl. seeds fixas em
  clusterização). **Paridade total (P4):** toda análise nova tem GATE browser
  (Vitest, baseline com tetos) E GATE Python (pytest) sobre as **mesmas** fixtures
  douradas — dentro dos tetos do browser, os dois motores produzem o mesmo resultado
  número a número.

## 15. Reutilização de componentes existentes

| Existente | Papel no híbrido |
|---|---|
| `serve.py` + `iniciar.bat` | Host do sidecar (mesmo processo/origem) |
| Protocolo `COMPUTE_*`/`*_RESULT` | Contrato de tarefa/resultado (payloads idênticos) |
| `serializeCsvStore` + `buildProjectJSONChunks` (M3) | Formato de upload do dataset — zero formato novo |
| `csvStoreVersion` (worker) | Chave de identidade/hash do dataset |
| Padrão `AIProvider`/ADR-007 | Molde do `ComputeProvider` (opt-in, degradação limpa, capability-gated) |
| Padrão botões ✨ desabilitados com motivo | UX do estado transitório "baseline browser ainda não entregue" (DEC-HX-007) e dos avisos de teto declarado |
| Modais `goalSeekModal`/`segmentDiscoveryModal` (loading/progresso) | UX de jobs longos |
| GATEs/fixtures do Vitest | Fonte das fixtures douradas cross-runtime |
| COOP/COEP (Fase 2 da Otimização) | Pré-requisito do pool de workers com SAB (H3) |

## 16. Sugestões técnicas (não obrigatórias)

- Sidecar em **um único arquivo** `sidecar.py` importado pelo `serve.py` (mantém o
  release simples de auditar); stdlib `http.server` + `ThreadingHTTPServer`.
- Hash do dataset: SHA-256 dos chunks concatenados, calculado incrementalmente
  durante o upload (streaming), ecoado pelo cliente para verificação.
- No tier full, converter colunas dict para `pandas.Categorical`/arrays numpy uma vez
  no registro do dataset — os jobs subsequentes operam vetorizado.
- Clusterização: sempre com seed fixa derivada do hash do dataset + params
  (determinismo é contrato da casa). Com a paridade total (P4), o algoritmo-base
  (Lloyd + inicialização k-means++ com PRNG **especificado**, ex.: mulberry32) é o
  MESMO nos dois runtimes — é isso que torna o GATE cross-runtime possível; sklearn
  entra como acelerador/extra (silhueta, hierárquico), não como definição do
  resultado.
- Futuro (não v1): Apache Arrow IPC como transporte alternativo negociado via
  `capabilities` (elimina base64 quando ambos os lados suportarem).

## 17. Roadmap de migração

| Fase | Sessões ([[Hibrido-Prompts-Sessoes]]) | Entrega |
|---|---|---|
| **Sonda (✅ concluída 09/07/2026)** | HP (sonda do ambiente Python — `checar_ambiente.py`, rodada 2× na máquina corporativa) | Relatório entregue: os 4 pacotes instalam/importam do índice; **nenhuma wheel offline imprescindível**; sklearn com 1ª carga lenta (antivírus) ⇒ warm-up assíncrono na detecção de tier da H5 |
| **Fase 0 — Browser primeiro** | H0 (telemetria), H1 (fluidez M12–M14), H2 (dieta de memória), H3 (pool de workers) | Headroom até ~5MM linhas; validações paralelas; números reais de custo por tarefa |
| **Fase 1 — Fundação híbrida (✅ concluída 10/07/2026)** | H4 (ComputeRouter), H5 (sidecar v1), H6 (UX do motor + recomendação DEC-HX-009) | Sidecar opt-in funcionando ponta a ponta com uma tarefa de eco/benchmark |
| **Fase 2 — Cargas reais (✅ concluída 11/07/2026)** | **H7 ✅ (Descoberta profunda)**, **H8 ✅ (Clusterização de Segmentos — baseline browser + sidecar, paridade total)** | Primeiro valor de usuário do híbrido: Descoberta depth 3–4/beam ampliado no sidecar (numpy) + primeira análise INÉDITA nascida dupla (k-means determinístico sobre mulberry32, mesmo ClusterModel nos dois motores sob GATE dourado; sklearn como extra: silhueta/k automático, hierárquico) |
| **Fase 3 — Paridade do motor (opcional)** | H9 (motor de simulação em Python + GATE) | Habilita Frente 5 e bases 7–10MM+ de ponta a ponta |

A Fase 0 tem valor independente: se o híbrido for adiado, nada dela é desperdiçado.
Com o alvo de projeto de ~7MM de linhas (P2), as Fases 1–2 têm gatilho de produto
próprio — o próprio alvo as justifica, sem esperar um épico analítico ser priorizado.
A sonda HP é ortogonal e barata: rodá-la cedo tira o risco de ambiente do caminho.

---

*Documento gerado a partir de leitura integral da wiki e do código em jul/2026;
premissas P1–P4 validadas com o usuário em 09/07/2026 (pip com sonda, alvo 7MM,
browser-first confirmado, paridade total + recomendação proativa). **P1 validada
empiricamente no mesmo dia pela sonda HP** (2 rodadas na máquina corporativa alvo:
4/4 pacotes OK via índice; sklearn com cold start de antivírus ⇒ warm-up assíncrono
na DEC-HX-004; wheels offline rebaixadas a contingência). Plano de execução
por sessões (com prompts e tags de modelo) em [[Hibrido-Prompts-Sessoes]].*
