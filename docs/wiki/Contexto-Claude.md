# Consumo de Contexto do Claude Code — Diagnóstico e Plano (Épico CTX)

> **Data do diagnóstico**: 13/07/2026 · Medições feitas sobre o repositório real
> (branch de diagnóstico). Padrão do documento: mesmo formato dos "Prompts de Todas
> as Sessões" ([[Hibrido-Prompts-Sessoes]]) — sessões com 🏷️ tag de modelo e prompt
> pronto para colar.
>
> **TL;DR**: o sintoma ("10–15% da janela consumida antes de qualquer alteração")
> **não é leitura do repositório** — é o **CLAUDE.md de ~195KB (~45–55 mil tokens,
> ≈ 22–28% de uma janela de 200 mil) carregado automaticamente em TODA sessão**,
> antes da primeira palavra. A segunda causa é o monólito `src/App.jsx` (968KB,
> maior que a janela de contexto inteira), que encarece toda tarefa que toca a UI.
> Refatoração para OOP **não** é a resposta; re-camadar a documentação e continuar
> o padrão já existente de extração de módulos puros, sim.

---

## 1. Diagnóstico

### 1.1 Números medidos (13/07/2026)

| Artefato | Bytes | Linhas | Tokens (est.) | % de uma janela de 200k |
|---|---|---|---|---|
| `CLAUDE.md` | 194.882 | 2.244 | ~45–55 mil | **~22–28% — pago em TODA sessão, no boot** |
| `src/App.jsx` | 967.829 | 16.202 | ~230–260 mil | **>100% — impossível ler inteiro** |
| `src/simulation.worker.js` | 338.469 | 6.832 | ~80–90 mil | ~40–45% |
| `src/columnar.js` | 35.897 | 764 | ~9 mil | ~4,5% |
| `tests/` (soma) | ~330KB | — | ~85 mil | carregado só sob demanda |
| `docs/wiki/` | 556KB | — | — | carregado só sob demanda ✅ |
| `.claude/` (skills/agents/settings) | **inexistente** | — | — | — |
| `CLAUDE.md` em subpastas | **inexistente** | — | — | — |

### 1.2 Causa raiz, em ordem de contribuição

1. **(c) O CLAUDE.md virou um changelog/wiki, não um manual de operação.** Ele
   documenta *a história de cada feature* (M1–M15, Fases 0–4, H0–H8, GS1–GS6,
   Sessões 0–12 do Copiloto...) com nível de detalhe que já existe — normativamente
   — em `docs/wiki/`. O Claude Code injeta o CLAUDE.md inteiro no início de toda
   sessão; o usuário vê isso como "leitura e entendimento do repositório", mas o
   custo é fixo e acontece **mesmo em pedidos pontuais** (exatamente o sintoma
   observado). É a causa dominante, e a de correção mais barata.

2. **(a)+(b) O monólito `src/App.jsx`.** Com ~250 mil tokens, nenhum modelo
   consegue lê-lo inteiro; qualquer tarefa de UI vira uma sequência de
   Grep + Reads de trechos grandes, cada um consumindo janela. O ADR-001 (arquivo
   único) foi uma decisão consciente de protótipo — mas o repositório **já provou o
   antídoto certo**: os módulos puros extraídos (`columnar.js`, `goalSeek.js`,
   `policySimplify.js`, `clusterVar.js`, `computeRouter.js`) são exatamente o
   padrão a continuar. **OOP não resolveria nada aqui**: o custo de contexto vem de
   fronteira de arquivo e de documentação em camadas, não de paradigma. Uma
   reescrita orientada a objetos seria alto risco (16 GATEs numéricos protegem o
   motor) com ganho de contexto ~zero.

3. **(d) Fluxo de trabalho — secundário, mas real.** Sem `.claude/skills/` nem uso
   sistemático de subagents de pesquisa, toda busca exploratória roda dentro do
   contexto principal e cada resultado de Grep/Read fica retido na conversa. O
   padrão de "prompts de sessão" da wiki (escopo fechado + arquivos apontados) já é
   excelente — falta só a infraestrutura de carregamento sob demanda.

### 1.3 A nuance que importa (por que não é só "apagar o CLAUDE.md")

O CLAUDE.md gigante hoje **funciona como substituto de exploração**: o modelo acha
`computeCinemaAsIsCells` sem varrer o código porque o arquivo conta onde tudo vive.
Emagrecê-lo ingenuamente trocaria custo fixo por custo variável (mais Greps/Reads).
A correção certa é **re-camadar**: um índice enxuto sempre carregado (mapa de
arquivos, regras invioláveis, ponteiros) + o detalhe por domínio em arquivos que o
modelo lê **só quando a tarefa é daquele domínio**.

### 1.4 Comparação com boas práticas

| Prática recomendada | Estado atual |
|---|---|
| CLAUDE.md enxuto (~200–400 linhas), em camadas | ❌ 2.244 linhas, camada única |
| Detalhe por domínio carregado sob demanda | ⚠️ existe (`docs/wiki/`), mas o CLAUDE.md duplica em vez de apontar |
| Skills de projeto (`.claude/skills/`) | ❌ inexistente |
| Subagents para pesquisa (Explore) | ❌ não usado sistematicamente |
| Tarefas com escopo fechado e arquivos apontados | ✅ os prompts de sessão da wiki já fazem isso muito bem |
| Módulos puros extraídos do monólito | ⚠️ padrão existe e funciona; App.jsx segue crescendo mais rápido que as extrações |

---

## 2. Plano de ação (sessões priorizadas por impacto ÷ esforço)

> **Regras transversais (valem para TODAS as sessões):**
> 1. `npm test` passa inalterado ao fim — nenhuma sessão muda matemática.
> 2. Conteúdo de documentação é **movido, nunca perdido**: toda seção retirada do
>    CLAUDE.md deixa um ponteiro de 1–2 linhas com o caminho do arquivo destino.
> 3. Onde já existe doc normativa equivalente em `docs/wiki/`, o ponteiro aponta
>    para ela — **não** criar uma terceira cópia.
> 4. Nada de framework novo; extrações seguem o padrão dos módulos puros existentes.

### Sessão C1 — Emagrecer o CLAUDE.md para um índice em camadas 🏷️ [SONNET]

**Impacto**: elimina ~80% do sintoma reportado, sozinha. **Esforço**: 1 sessão.

**O que vai entregar**:
- `CLAUDE.md` reduzido a **≤ 30KB / ~400 linhas** (~7 mil tokens, de ~50 mil):
  stack, estrutura de arquivos, comandos, ⚠️ regra de persistência do Projeto,
  padrão de refs espelho, tabela dos GATEs (teste → o que trava), e um **mapa
  "onde vive o quê"** com ponteiros por domínio.
- Conteúdo detalhado movido para `docs/claude/*.md` (pasta nova, **fora** de
  `docs/wiki/` para não sincronizar com o Wiki público): ex.
  `docs/claude/Worker-Protocolo.md`, `docs/claude/Analytics-Workspace.md`,
  `docs/claude/Copiloto.md`, `docs/claude/Persistencia-Projeto.md`,
  `docs/claude/Otimizacao-Memoria-Historico.md`. Seções que só repetem a wiki
  (Execução Híbrida, Goal Seek Profundo) viram ponteiro à wiki, sem arquivo novo.

**Resultado esperado**: boot de sessão cai de ~50 mil para ~7 mil tokens; pedidos
pontuais passam a custar o que custam, e nada mais.

**Prompt**:
```
Vamos executar a Sessão C1 do plano docs/wiki/Contexto-Claude.md (emagrecer o
CLAUDE.md). O CLAUDE.md atual tem ~2.240 linhas e é carregado inteiro em toda
sessão. Reestruture-o em camadas:

1. Crie a pasta docs/claude/ e mova para arquivos por domínio TODO o conteúdo
   detalhado de: protocolo de mensagens do worker (tabelas de entrada/saída e
   funções), Analytics Workspace/agrupamentos/filtros, Copiloto (PolicyIR, Goal
   Seek, Simplificação, Documentação, Descoberta de Segmentos, Clusterização),
   Otimização de Memória (Fases 0–4 e itens M), Wizard de importação, Auto Layout,
   Johnny/optimModal, Bibliotecas (Cineminha/Políticas), Domínio Exibido e
   Decision Lens. Seções que apenas duplicam docs normativas já existentes em
   docs/wiki/ (Execução Híbrida H4–H8, Goal Seek Profundo GS1–GS6) NÃO ganham
   arquivo novo: viram só ponteiro para a doc da wiki.
2. O CLAUDE.md final deve ter NO MÁXIMO ~400 linhas e conter apenas: stack,
   estrutura de arquivos (árvore resumida), comandos de desenvolvimento, a ⚠️
   regra de persistência do Projeto (na íntegra — é inviolável), o padrão de refs
   espelho, uma tabela dos GATEs de teste (arquivo → o que ele trava), e um mapa
   "onde vive o quê": uma linha por domínio com o ponteiro para o arquivo em
   docs/claude/ ou docs/wiki/ que o modelo deve ler ANTES de mexer naquele domínio.
3. NENHUMA informação pode ser perdida — só movida. Cada seção movida deixa no
   CLAUDE.md uma linha "→ ver docs/claude/X.md". Confira ao final que a soma dos
   arquivos novos + CLAUDE.md cobre todo o conteúdo original (diff de cobertura,
   não literal).
4. Não toque em nenhum arquivo de código. npm test deve passar inalterado.
```

### Sessão C2 — Âncoras de navegação no App.jsx + mapa de regiões 🏷️ [HAIKU ou SONNET]

**Impacto**: reduz o custo *variável* de toda tarefa de UI (menos Reads às cegas).
**Esforço**: baixo; risco ~zero (só comentários).

**O que vai entregar**:
- Comentários-âncora padronizados no `App.jsx` demarcando as grandes regiões
  (`// ═══ REGIÃO: Estado principal`, `… Wizard de importação`, `… Canvas/render`,
  `… Cineminha`, `… Modais do Copiloto`, `… AnalysisTab/Dashboard`,
  `… Persistência`, etc.) — âncoras **grep-áveis e estáveis** (números de linha
  não são).
- `docs/claude/Mapa-App.md`: lista região → âncora → principais funções/estados,
  com a instrução "para achar a região X, `grep 'REGIÃO: X'`".

**Prompt**:
```
Sessão C2 do plano docs/wiki/Contexto-Claude.md. Insira comentários-âncora no
src/App.jsx demarcando as grandes regiões do arquivo, no formato exato
"// ═══ REGIÃO: <nome> ═══" (uma linha, sem quebrar nenhum código; apenas
comentários novos). Regiões mínimas: constantes/helpers globais, estado principal
do componente, wizard de importação, handlers de canvas (mouse/touch), render de
shapes, Cineminha (render + otimizadores), modais do Copiloto (goalSeek/simplify/
doc/segment/cluster), AnalysisTab e widgets do Dashboard, persistência
(Projeto/sessionStorage), PolicyIR. Depois crie docs/claude/Mapa-App.md listando,
por região: a âncora, os principais estados/funções/componentes que vivem nela e
1 linha do que ela faz. Não altere nenhuma linha existente — só adicione
comentários. npm test passa inalterado.
```

### Sessão C3 — Fundação `.claude/`: skills de projeto 🏷️ [SONNET]

**Impacto**: carrega regras críticas **só quando a tarefa precisa** (targeted
inclusion). **Esforço**: baixo. Detalhe do que é uma skill: ver §5.

**O que vai entregar** — `.claude/skills/<nome>/SKILL.md` para:
- `persistencia-projeto`: a ⚠️ regra + checklist `buildProjectPayload`/
  `loadProject`/`schemaVersion`/`sessionStorage` (dispara ao criar estado novo).
- `worker-protocolo`: como adicionar mensagem `COMPUTE_*`/`*_RESULT`, cache de
  tick, regra de ouro Classe A/B (dispara ao mexer no worker).
- `gates-testes`: qual GATE cobre o quê, quando rodar `UPDATE_GOLDEN=1`, o que
  JAMAIS pode divergir (dispara ao tocar motor/fixtures).

**Prompt**:
```
Sessão C3 do plano docs/wiki/Contexto-Claude.md. Crie .claude/skills/ com três
skills de projeto, cada uma em .claude/skills/<nome>/SKILL.md com frontmatter
YAML (name + description; a description diz QUANDO usar, pois é o gatilho de
carregamento): (1) persistencia-projeto — a regra ⚠️ do CLAUDE.md sobre salvar
estado criado pelo usuário, com o checklist completo de buildProjectPayload/
loadProject/bump de schemaVersion/serialização de tipos não-JSON/sessionStorage;
(2) worker-protocolo — passo a passo para adicionar uma mensagem COMPUTE_*/
*_RESULT no simulation.worker.js (tabelas de protocolo, getTickResult/cache,
UPDATE_CSV_STORE, e a regra de ouro: tick de edição jamais roteia pro sidecar);
(3) gates-testes — tabela GATE → o que trava, como regenerar fixtures douradas
(UPDATE_GOLDEN=1), e a regra de que nenhuma sessão muda matemática do motor.
Extraia o conteúdo do CLAUDE.md/docs sem inventar nada. Cada SKILL.md ≤ ~150
linhas.
```

### Sessão C4 — Extração incremental de módulos puros do App.jsx 🏷️ [OPUS]

**Só depois de C1–C3.** A refatoração é **justificada, mas incremental** — nunca
uma reescrita. Critério de elegibilidade: funções/componentes **que já vivem fora
do componente principal** (puros ou quase), com GATE existente cobrindo.

**Candidatos concretos, em ordem de segurança** (todos já são "helpers globais
exportados" segundo o próprio CLAUDE.md):
1. **Analytics** (~novo `src/analytics.js`): `pivotWidget`, `applyGroupingsToDataset`,
   `applyAnalyticsFilters`, `applyFiltersToDataset`, `distinctDimValues`,
   `autoBuckets`, `computeWidgetMetric`, `describeFilterCards`, `resolveKpiScenarios`,
   `buildAnalyticsCSV` — GATE: `tests/analytics.test.js`.
2. **PolicyIR** (~novo `src/policyIR.js`): `buildPolicyIR`, `applyPolicyPatch`,
   `extractPolicyRequiredVars`, `applyPolicyVarMapping`, `diffPolicyIR` — GATE:
   `tests/policyIR.test.js`, `tests/policyTemplates.test.js`.
3. **Renderers de documentação** (~novo `src/policyDocRender.js`):
   `renderDocMarkdown`, `renderDocHTML` — GATE: `tests/policyDoc.test.js`.
4. **autoLayout** (~novo `src/autoLayout.js`) — sem GATE próprio; validação visual.

**Resultado esperado**: `App.jsx` cai de ~16 mil para ~11–12 mil linhas em 2–4
sessões; tarefas desses domínios passam a carregar um arquivo de 20–40KB em vez de
pescar num de 968KB. O ADR-001 continua válido para o que é de fato acoplado ao
estado do componente.

**Status dos lotes**:
- ✅ **Lote 1 — Analytics** (`src/analytics.js`) — executado (PR #195,
  `0a6e4e8`).
- ⬜ Lote 2 — PolicyIR (`src/policyIR.js`)
- ⬜ Lote 3 — Renderers de documentação (`src/policyDocRender.js`)
- ⬜ Lote 4 — autoLayout (`src/autoLayout.js`)

**Prompt do lote 1 (já executado, mantido como referência)**:
```
Sessão C4 (lote 1 — Analytics) do plano docs/wiki/Contexto-Claude.md. Extraia de
src/App.jsx para um novo src/analytics.js os helpers globais puros do Analytics
Workspace: pivotWidget, applyGroupingsToDataset, applyAnalyticsFilters,
applyFiltersToDataset, distinctDimValues, autoBuckets, computeWidgetMetric,
describeFilterCards, resolveKpiScenarios, buildAnalyticsCSV, e as constantes que
só eles usam (CHART_TYPES, GOOD_WHEN_LOWER, MAX_SERIES etc.). Regras: (1)
movimentação literal — zero mudança de lógica/matemática; (2) App.jsx importa do
módulo novo e re-exporta o que os testes importam de App.jsx hoje, OU os testes
passam a importar do módulo novo — escolha o que der o menor diff; (3) nenhuma
função que leia estado/refs do componente pode ser movida — se algum candidato
tiver dependência de closure, deixe-o e reporte; (4) npm test passa inalterado,
em especial tests/analytics.test.js. Atualize o mapa de arquivos do CLAUDE.md
(1 linha) e docs/claude/Mapa-App.md.
```

**Prompt do lote 2 — PolicyIR**:
```
Sessão C4 (lote 2 — PolicyIR) do plano docs/wiki/Contexto-Claude.md. Extraia de
src/App.jsx para um novo src/policyIR.js os helpers globais puros do PolicyIR:
buildPolicyIR, applyPolicyPatch, extractPolicyRequiredVars, applyPolicyVarMapping,
diffPolicyIR, e quaisquer helpers internos usados só por eles (ex.: achatamento de
rotas/ports, geração de idMap). Leia docs/claude/Copiloto-PolicyIR.md antes de
mexer — ele documenta o contrato do formato IR e as regras de "sem perda de
roteamento" que o GATE trava. Regras: (1) movimentação literal — zero mudança de
lógica; (2) App.jsx importa do módulo novo e re-exporta o que os testes importam
de App.jsx hoje, OU os testes passam a importar do módulo novo — escolha o menor
diff; (3) nenhuma função com dependência de closure em estado/refs do componente
pode ser movida — se achar um candidato assim, deixe-o e reporte; (4) npm test
passa inalterado, em especial tests/policyIR.test.js e tests/policyTemplates.test.js.
Atualize o mapa de arquivos do CLAUDE.md (1 linha) e docs/claude/Mapa-App.md.
```

**Prompt do lote 3 — Renderers de documentação**:
```
Sessão C4 (lote 3 — Renderers de documentação) do plano
docs/wiki/Contexto-Claude.md. Extraia de src/App.jsx para um novo
src/policyDocRender.js os helpers globais puros de renderização do docModel:
renderDocMarkdown, renderDocHTML, e helpers internos usados só por eles (formatação
de KPIs/funil, tabelas, changelog via diffPolicyIR). Leia
docs/claude/Copiloto-Documentacao.md antes de mexer. Note que estas funções
consomem o docModel/PolicyIR já montado (não recalculam o motor) — só a camada de
apresentação deve mover; se alguma função também calcular o docModel a partir do
motor, deixe-a em App.jsx e reporte. Regras: (1) movimentação literal — zero
mudança de lógica; (2) App.jsx importa do módulo novo e re-exporta o que os testes
importam hoje, OU os testes passam a importar do módulo novo — escolha o menor
diff; (3) nenhuma função com dependência de closure em estado/refs do componente
pode ser movida; (4) npm test passa inalterado, em especial
tests/policyDoc.test.js. Atualize o mapa de arquivos do CLAUDE.md (1 linha) e
docs/claude/Mapa-App.md.
```

**Prompt do lote 4 — autoLayout**:
```
Sessão C4 (lote 4 — autoLayout) do plano docs/wiki/Contexto-Claude.md. Extraia de
src/App.jsx para um novo src/autoLayout.js a função de reorganização automática do
canvas (autoLayout) e helpers internos usados só por ela. Leia
docs/claude/Auto-Layout.md antes de mexer. Este lote NÃO tem GATE numérico
dedicado — a validação é visual: depois de mover, rode `npm run dev`, abra um
projeto com Cineminhas/losangos conectados e confirme visualmente que "Auto Layout"
produz o mesmo resultado de antes (posições e ordem inalteradas). Regras: (1)
movimentação literal — zero mudança de lógica; (2) App.jsx importa do módulo novo;
(3) se autoLayout ler estado/refs do componente diretamente (em vez de receber
shapes/conns por parâmetro), isso é uma dependência de closure — extraia só depois
de parametrizar a chamada, ou deixe e reporte; (4) npm test passa inalterado.
Atualize o mapa de arquivos do CLAUDE.md (1 linha) e docs/claude/Mapa-App.md.
```

### Sessão C5 — Contrato de manutenção da documentação 🏷️ [SONNET] (opcional,
mas recomendada — é a única sessão do lote que evita a regressão voltar)

**Por que não é dispensável na prática**: C1–C4 emagrecem o CLAUDE.md uma vez, mas
nada impede que ele volte a crescer ~linearmente como descrito em §4 — cada
sessão H/GS/Copiloto futura tende a colar mais uma seção de detalhe direto no
índice, do jeito mais rápido. C5 não é uma refatoração; é a trava de processo que
faz o ganho de C1 durar. Sem ela, o diagnóstico deste documento se repete em
6–12 meses.

**O que vai entregar**:
- Uma regra nova, curta, na própria estrutura do CLAUDE.md (perto do topo, junto
  com a explicação de "Documentação em camadas"): *"Nova feature documenta no
  arquivo de domínio (`docs/claude/` ou `docs/wiki/`); no CLAUDE.md entra no
  máximo 1 linha no mapa de ponteiros. O CLAUDE.md não pode passar de ~450
  linhas."*
- **O fallback para quando o limite é atingido** (o ponto em aberto: o que
  acontece quando uma sessão precisa adicionar 1 linha e o CLAUDE.md já está em
  450): a regra não pode ser "trava a sessão" nem "deixa passar do limite
  silenciosamente" — as duas perdem informação (a primeira bloqueia trabalho
  real; a segunda deixa o arquivo crescer sem controle de novo). O contrato é:
  1. **Nunca apagar para caber** — o teto de linhas rege o que fica no índice,
     não o que existe. Informação só sai do CLAUDE.md quando já tem um lar em
     `docs/claude/` ou `docs/wiki/` com o ponteiro correspondente.
  2. Se adicionar a linha nova estouraria 450, a sessão que estourou faz uma
     **poda antes de escrever**: varre o CLAUDE.md atual procurando qualquer
     trecho que já regrediu de "ponteiro" para "detalhe" (parágrafo duplicando
     conteúdo que já vive em `docs/claude/`, ou uma seção que cresceu além de
     1–3 linhas), move esse trecho para o arquivo de domínio (criando-o se não
     existir) e deixa o ponteiro de 1 linha no lugar — exatamente o padrão de
     C1. Só então adiciona a linha nova.
  3. Se a poda não abrir espaço suficiente (índice já está genuinamente enxuto,
     sem gordura para tirar), a sessão cria/atualiza um arquivo
     `docs/claude/Onde-Vive-O-Que.md` só com a tabela de ponteiros e resume, no
     CLAUDE.md, a seção "Onde vive o quê" para um link único a esse arquivo —
     spillover controlado, não silencioso, e ainda documentado no próprio
     CLAUDE.md (1 linha: "mapa completo de ponteiros → ver
     docs/claude/Onde-Vive-O-Que.md").
  4. Toda poda/spillover é uma alteração **só de documentação**: nunca é
     motivo para pular o `npm test` de checagem nem para mexer em código.
- Um **guard mecânico**, não só disciplina: um passo no workflow de CI existente
  (`.github/workflows/`) — ou um script `npm run check:claude-md` chamado a partir
  de um `pre-commit`/CI — que roda `wc -l CLAUDE.md` e falha (ou avisa, conforme
  preferência do time) se passar de 450 linhas. Isso pega o estouro mesmo se uma
  sessão futura esquecer a regra escrita — não depende só do modelo lembrar.

**Prompt**:
```
Sessão C5 do plano docs/wiki/Contexto-Claude.md (contrato de manutenção da
documentação). Objetivo: garantir que o CLAUDE.md não volte a crescer sem
controle depois do emagrecimento das Sessões C1–C4.

1. No CLAUDE.md, logo após a seção "Documentação em camadas — como usar este
   repositório", adicione uma regra curta e explícita: "Nova feature documenta
   no arquivo de domínio (docs/claude/ ou docs/wiki/); no CLAUDE.md entra no
   máximo 1 linha no mapa de ponteiros ('Onde vive o quê'). O CLAUDE.md não pode
   passar de ~450 linhas."

2. Documente também o fallback para quando uma sessão precisar adicionar
   conteúdo e o CLAUDE.md já estiver no teto (ou passaria dele): (a) NUNCA
   apagar informação para caber — só mover, e só depois de ela já ter um lar em
   docs/claude/ ou docs/wiki/ com ponteiro correspondente; (b) antes de escrever
   a linha nova, a sessão faz uma poda: procura no CLAUDE.md qualquer trecho que
   regrediu de "ponteiro" (1–3 linhas) para "detalhe" (parágrafo duplicando
   conteúdo já normativo em outro arquivo), move esse trecho para o arquivo de
   domínio certo (criando-o se preciso) e deixa o ponteiro no lugar — mesmo
   padrão da Sessão C1; (c) se a poda não abrir espaço suficiente, crie/atualize
   docs/claude/Onde-Vive-O-Que.md com a tabela completa de ponteiros e resuma a
   seção "Onde vive o quê" do CLAUDE.md para um link a esse arquivo (spillover
   controlado e documentado, nunca silencioso); (d) poda/spillover é sempre uma
   mudança só de documentação — não pula npm test, não mexe em código.

3. Crie um guard mecânico: um script simples (ex. package.json script
   "check:claude-md" rodando `wc -l CLAUDE.md` ou equivalente em Node) que falha
   (exit code != 0) se CLAUDE.md passar de 450 linhas, e plugue esse script em
   um step do CI existente em .github/workflows/ (ou documente explicitamente,
   se não houver hook de pre-commit no projeto, que a checagem roda via CI). O
   objetivo é o estouro ser pego mecanicamente, não só por disciplina de prompt.

4. npm test passa inalterado — esta sessão não toca em código de produto, só em
   CLAUDE.md, docs/ e o guard de CI/scripts.
```

---

## 3. Ajustes de fluxo de trabalho (independem de qualquer refatoração)

1. **Pesquisa via subagent, não no contexto principal.** Para perguntas tipo
   "onde/como é feito X", peça explicitamente: *"use um subagent (Explore) para
   localizar e me devolva só as conclusões com file:line"*. O subagent queima o
   contexto **dele**, descartável; a conversa principal recebe 20 linhas.
2. **Continuar apontando arquivo/função no prompt** — os prompts de sessão da wiki
   já fazem isso; a regra é não regredir em pedidos avulsos ("no App.jsx, região
   Cineminha, função toggleCinemaCell..." em vez de "no app...").
3. **Sessão nova por tarefa; `/compact` quando for continuar.** Sessões longas
   acumulam Reads mortos. `/context` (no CLI) mostra a decomposição real da janela
   — use antes/depois da C1 para verificar o ganho.
4. **Nunca pedir "leia o projeto primeiro".** Com o CLAUDE.md-índice, isso é
   redundante e caro; o modelo carrega o domínio certo pelos ponteiros.
5. **`release/` é artefato de build (1,4MB)** — nunca deve ser lido/varrido, exceto
   `serve.py`/`sidecar.py`/`python/` quando a tarefa é do sidecar. Deixar isso
   explícito no CLAUDE.md enxuto.
6. **Modelo por tipo de tarefa** — manter o sistema de tags 🏷️ da wiki. Com C1–C3
   feitas, Sonnet volta a ser suficiente para a maioria das sessões (hoje o boot
   de ~50 mil tokens come exatamente a folga que o Sonnet precisaria).

---

## 4. Riscos e timeline se nada for feito

O CLAUDE.md cresce de forma ~linear por épico entregue (cada sessão H/GS/Copiloto
adicionou seções). Projeção mantendo o ritmo:

| Horizonte | CLAUDE.md | Custo fixo por sessão | Efeito prático |
|---|---|---|---|
| Hoje | ~195KB | ~25% da janela | Sintoma atual: 10–15%+ percebidos antes de qualquer edição |
| +3–6 meses | ~250–300KB | ~30–38% | Compactação no meio de tarefas médias; instruções críticas (⚠️ persistência, regras de GATE) começam a ser resumidas/perdidas pelo compactador → regressões caras nos GATEs dourados |
| +12 meses | ~400KB | ~50% | Sonnet inviável; até Opus/Fable trabalham com metade da janela; qualidade de resposta cai (regras enterradas no meio do prompt têm pior recall); cada tarefa custa 2–3× em tokens |

Riscos qualitativos além da janela: (1) **deriva entre CLAUDE.md e wiki** — duas
fontes normativas divergindo silenciosamente; (2) **App.jsx a >20 mil linhas**
torna cada extração futura mais cara (mais dependências de closure acumuladas);
(3) custo financeiro direto — o prefixo gigante é reprocessado/cacheado a cada
sessão nova.

---

## 5. Skills ajudariam? Sim — e como construir

**O que é**: uma skill de projeto é uma pasta `.claude/skills/<nome>/` com um
`SKILL.md` (frontmatter YAML `name` + `description`, corpo em Markdown). O Claude
Code lê **só as descriptions** no boot (custo de ~1 linha cada) e carrega o corpo
**apenas quando a tarefa casa com a description** — é o mecanismo nativo de
*targeted inclusion*, o oposto exato do CLAUDE.md (que é sempre-carregado).

**Regra de bolso**: o que TODA sessão precisa (mapa de arquivos, regra de
persistência, comandos) → CLAUDE.md; o que só ALGUMAS sessões precisam (protocolo
do worker, checklist de GATEs, como mexer no sidecar) → skill ou doc de domínio
apontada. Skills também podem carregar arquivos auxiliares na própria pasta
(referenciados pelo corpo), então um checklist longo não polui nem o CLAUDE.md
nem a description.

**Esqueleto (exemplo real — `persistencia-projeto`)**:

```markdown
---
name: persistencia-projeto
description: Use SEMPRE que criar ou alterar estado persistente do app — novo useState de topo, novo campo de shape/csvStore, nova preferência, nova biblioteca — para aplicar o checklist de buildProjectPayload/loadProject/schemaVersion/sessionStorage.
---

# Checklist de persistência (regra ⚠️ do projeto)

1. O estado novo vive dentro de um contêiner já salvo (shape→canvases,
   campo de csvStore→csvStore)? Então nada a fazer além do teste de round-trip.
2. Senão: adicionar em buildProjectPayload() E restaurar em loadProject(data)
   com default defensivo.
3. Mudança estrutural ⇒ bump do schemaVersion (atual: "2.6").
4. Tipo não-JSON (Map/Set/typed array) ⇒ serialize/deserialize dedicados
   (padrão serializeCsvStore) + teste de round-trip.
5. Deve sobreviver a reload na sessão? ⇒ adicionar à auto-persistência de
   sessionStorage (aw_*_v1).
```

As três skills da Sessão C3 (§2) cobrem os três domínios onde erro é mais caro:
persistência, protocolo do worker e GATEs. Uma quarta candidata futura:
`sidecar-python` (como adicionar task no `sidecar.py` + paridade DEC-HX-005),
carregada só em sessões H.
