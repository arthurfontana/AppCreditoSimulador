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
| 10MM × 30 col | ~2–3GB | ❌ Acima do teto da aba — só com sidecar (ou amostragem declarada) |

Códigos `Int16`/`Uint8` para colunas de baixa cardinalidade (~metade das células de
uma base dimensional) compram ~2×; é ganho de constante, não de ordem.

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

**Leitura honesta:** as medidas browser-first compram 1–2 anos para linhas e
agregação, mas **não resolvem biblioteca estatística nem o teto de memória** para
10MM+. Se o roadmap analítico é para valer, o híbrido não é "se", é "quando e com
qual contrato". Este documento define o contrato.

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

## 5. Premissas assumidas (decisões tomadas nesta revisão — reversíveis)

> Estas quatro premissas foram assumidas na análise; se alguma estiver errada para o
> seu contexto, ela muda parâmetros do plano, não a arquitetura.

- **P1 — Python corporativo é heterogêneo.** Não assumimos `pip` liberado. O sidecar
  **declara capacidades em camadas** (DEC-HX-004): tier `stdlib` (só Python puro) e
  tier `full` (numpy/scipy/sklearn/duckdb via **wheels offline embarcadas no zip do
  release** — `pip install --no-index --find-links`). O app se adapta ao que
  encontrar.
- **P2 — Alvo de projeto: ~5MM de linhas no browser.** Até aí, a Fase 0 (dieta de
  memória) sustenta o modo browser-only. 10MM+ é território exclusivo do sidecar
  (com amostragem **declarada** como degradação no modo browser).
- **P3 — Escopo em fases: browser primeiro.** A Fase 0 (otimizações browser) precede
  o híbrido — é mais barata, beneficia todos os usuários e reduz a pressão sobre o
  sidecar.
- **P4 — Classificação por feature (ver §7.3).** O core existente é sempre Classe A
  (paridade total). Features novas declaram sua classe (A/B/C) pelo critério: custo
  de reimplementar em JS × valor de funcionar offline-browser.

## 6. Decisões arquiteturais (DEC-HX)

### DEC-HX-001 — Local-first inegociável; Python é aceleração, nunca requisito
Espelho do ADR-007: assim como a IA é camada opcional sobre um produto 100% local, o
sidecar é camada opcional sobre um produto 100% browser. Critério de aceite
permanente: **desligar/remover o sidecar não remove funcionalidade Classe A/B** (B
volta aos tetos declarados) e degrada Classe C de forma limpa e explicada.

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
habilita vetorização e as análises Classe C. **Honestidade técnica registrada:**
Python puro é 10–100× mais lento que o worker JS em loop por linha — o tier `stdlib`
é um degrau de instalação, não um destino; o valor real do híbrido está no tier
`full`.

### DEC-HX-005 — Paridade provada por GATEs cross-runtime
Toda função com dupla implementação (JS + Python) tem um GATE de **fixtures douradas**:
o Vitest gera `tests/fixtures/golden/*.json` (entrada + saída esperada, determinística)
a partir do motor JS; o `pytest` do sidecar consome as mesmas fixtures e exige
igualdade número a número (tolerância 0 para inteiros/contagens; `1e-9` relativa para
somas de ponto flutuante, documentada por fixture). Sem GATE verde, a tarefa não
roteia pro sidecar. É a extensão natural da cultura de GATEs da casa para dois
runtimes.

### DEC-HX-006 — Dados sobem uma vez, referenciados por hash
O dataset é registrado no sidecar **uma vez por versão** (`POST /api/compute/datasets`,
corpo = os mesmos chunks de `serializeCsvStore`/`buildProjectJSONChunks` do M3 —
reuso integral, base64 de typed arrays). A chave é um hash do conteúdo (papel do
`csvStoreVersion` que o worker já usa). Jobs referenciam `datasetId`; o sidecar mantém
os dados **somente em RAM** (nunca em disco sem opt-in explícito). Trocar a base
invalida e re-registra.

### DEC-HX-007 — Classes de tarefa (contrato de degradação)
- **Classe A — paridade total:** tudo que existe hoje (tick, overlay, otimizadores,
  Goal Seek, Descoberta depth≤2, DocGen...). Roda **sempre** no worker; o sidecar só
  entra, no futuro, como acelerador de lote (H9) com GATE de paridade.
- **Classe B — ampliada com degradação declarada:** versões estendidas de motores
  existentes (Descoberta profunda depth 3–4, lote maior de validações, base >5MM).
  Browser executa com **tetos declarados na UI** ("profundidade limitada a 2 sem o
  Motor Python"); sidecar remove os tetos.
- **Classe C — exclusiva do sidecar:** análises novas cuja reimplementação JS não se
  paga (clusterização, estatística sklearn). Sem sidecar, o botão aparece
  **desabilitado com motivo** (mesmo padrão dos botões ✨ do Copiloto sem provedor).

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
│  │  /api/compute/{health,capabilities,token,  │  Classe C (tier full)      │
│  │   datasets,jobs}                           │                            │
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
| **Web Worker (JS)** | Tick, overlays, otimizadores, Goal Seek, Descoberta depth≤2, DocGen, dataset largo — **tudo Classe A** + Classe B dentro dos tetos | Tarefas Classe C |
| **Pool de workers (H3)** | Shards de validação em lote (candidatos independentes) | Estado próprio (stateless por job) |
| **Sidecar Python** | Classe B sem tetos; Classe C (clusterização, stats); futuramente lote de re-simulação (H9, pós-GATE) | Tick de edição; persistência de dados; rede externa |

### 7.3 Como um épico novo declara sua classe

Critério (P4): **custo de reimplementar/validar em JS × valor de funcionar sem
sidecar**. Exemplos aplicados:

| Feature futura | Classe | Racional |
|---|---|---|
| Descoberta de Segmentos depth 3–4 | B | Motor JS já existe (depth 2); ampliar é só teto |
| Clusterização de segmentos (k-means/hierárquico) | C | Reimplementar+validar sklearn em JS não se paga; valor offline baixo |
| Seleção automática de indicadores (IV/PSI em massa) | B | `computeIV` já existe; o sidecar amplia o nº de colunas×bins |
| Frente 5 (busca de estratégias, re-simulação por combinação) | B (pós-H9) | Exige motor de simulação em Python com GATE de paridade — investimento da Sessão H9 |
| Bases 10MM+ linhas | B | Browser abre amostra declarada; sidecar processa a íntegra |

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
sidecar: cria job + polling; **erro/timeout/queda no meio** ⇒ Classe B re-executa no
worker com os tetos (aviso discreto "concluído no modo browser"), Classe C falha
declarada com motivo. Resultado entregue à UI **no mesmo formato do worker**.

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
| Clusterização | inexistente | inexistente | sklearn nativo |
| Base 10MM | OOM | amostra declarada | íntegra (RAM do processo, fora da aba) |

**Não esperar:** ganho do sidecar em tarefas curtas (<200ms — o roundtrip HTTP+
registro come o ganho); ganho do tier `stdlib` em loops por linha (Python puro é
mais lento que o worker JS — ver DEC-HX-004).

## 12. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| **Drift numérico entre motores** (o pior risco) | DEC-HX-005: fixtures douradas cross-runtime como GATE bloqueante; sem GATE, não roteia. Dupla implementação restrita ao mínimo (Classe A só no worker até H9) |
| Ambiente sem pip/internet | Wheels offline no zip (`release/python/wheels/`); falha na instalação ⇒ tier stdlib ⇒ falha ⇒ modo browser. Nunca um estado quebrado |
| Antivírus/política corporativa bloqueia o processo Python | Já é risco do `serve.py` atual (mesmo processo); documentar no manual; modo browser é o fallback universal |
| Porta ocupada / múltiplas instâncias | Porta configurável; token por instância; health-check identifica a versão |
| Complexidade de manter dois runtimes | Classes A/B/C limitam o que é duplicado; protocolo versionado; pytest no CI ao lado do Vitest |
| UX confusa ("por que o resultado demorou/mudou?") | Badge de executor sempre visível; resultados **idênticos por contrato** (GATE); degradações sempre declaradas em texto |
| Segurança do endpoint local | DEC-HX-008 (loopback + token + sem CORS + RAM-only); revisão na frente de segurança |

## 13. Casos de uso

1. **Analista sem permissão de nada:** usa o app como hoje (browser puro). Nada muda.
2. **Analista com o release padrão:** `iniciar.bat` já sobe o `serve.py` estendido —
   tier stdlib disponível sem passo extra; validações em lote ganham paralelismo.
3. **Analista power-user:** roda `instalar_motor.bat` uma vez (venv + wheels
   offline) → tier full → Descoberta profunda, clusterização, bases grandes.
4. **Base 10MM:** wizard detecta o tamanho, oferece "abrir amostra no navegador" ou
   "processar íntegra no Motor Python" (se disponível).

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
  clusterização).

## 15. Reutilização de componentes existentes

| Existente | Papel no híbrido |
|---|---|
| `serve.py` + `iniciar.bat` | Host do sidecar (mesmo processo/origem) |
| Protocolo `COMPUTE_*`/`*_RESULT` | Contrato de tarefa/resultado (payloads idênticos) |
| `serializeCsvStore` + `buildProjectJSONChunks` (M3) | Formato de upload do dataset — zero formato novo |
| `csvStoreVersion` (worker) | Chave de identidade/hash do dataset |
| Padrão `AIProvider`/ADR-007 | Molde do `ComputeProvider` (opt-in, degradação limpa, capability-gated) |
| Padrão botões ✨ desabilitados com motivo | UX da Classe C sem sidecar |
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
- Clusterização: sempre com `random_state` fixo derivado do hash do dataset + params
  (determinismo é contrato da casa).
- Futuro (não v1): Apache Arrow IPC como transporte alternativo negociado via
  `capabilities` (elimina base64 quando ambos os lados suportarem).

## 17. Roadmap de migração

| Fase | Sessões ([[Hibrido-Prompts-Sessoes]]) | Entrega |
|---|---|---|
| **Fase 0 — Browser primeiro** | H0 (telemetria), H1 (fluidez M12–M14), H2 (dieta de memória), H3 (pool de workers) | Headroom até ~5MM linhas; validações paralelas; números reais de custo por tarefa |
| **Fase 1 — Fundação híbrida** | H4 (ComputeRouter), H5 (sidecar v1), H6 (UX do motor) | Sidecar opt-in funcionando ponta a ponta com uma tarefa de eco/benchmark |
| **Fase 2 — Cargas reais** | H7 (Descoberta profunda, Classe B), H8 (clusterização/stats, Classe C) | Primeiro valor de usuário do híbrido |
| **Fase 3 — Paridade do motor (opcional)** | H9 (motor de simulação em Python + GATE) | Habilita Frente 5 e bases 10MM+ de ponta a ponta |

A Fase 0 tem valor independente: se o híbrido for adiado, nada dela é desperdiçado.
As Fases 1–2 só começam quando um épico Classe B/C for priorizado de fato.

---

*Documento gerado a partir de leitura integral da wiki e do código em jul/2026.
Plano de execução por sessões (com prompts e tags de modelo) em
[[Hibrido-Prompts-Sessoes]].*
