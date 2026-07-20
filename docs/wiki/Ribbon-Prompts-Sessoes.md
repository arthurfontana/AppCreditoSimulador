# UX 2.0 — Ribbon, Configurações e Reorganização do App (Prompts das Sessões)

> **Objetivo**: migrar a UI de "ações espalhadas por toolbars flutuantes, painel direito e
> seções soltas" para uma **Ribbon** (abas por intenção + abas contextuais por seleção),
> um **Hub de Configurações** central (⚙ — hoje inexistente), uma **Busca de comandos**
> (Ctrl+K), um painel direito com **Ativos/Inspetor/Copiloto**, uma **Status Bar**
> configurável e um Ribbon **colapsável em 3 estados**. Sem adicionar features de domínio —
> é uma evolução de **arquitetura de experiência**.
>
> **Ordem de execução**: Sessão 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (estritamente incremental —
> cada sessão termina com o app 100% funcional, testes verdes e nenhuma migração pela
> metade visível ao usuário).
>
> **Referência**: `CLAUDE.md` + `docs/claude/Estrutura-Dados.md` +
> `docs/claude/Persistencia-Projeto.md` + este documento (as seções de design abaixo são
> **normativas** — leia antes de qualquer sessão).
>
> **🏷️ Tag de modelo**: cada sessão indica o modelo recomendado — `Opus 4.8`
> (`claude-opus-4-8`) para refatoração estrutural no monólito, threading de estado/refs e
> matemática de viewport; `Sonnet 5` (`claude-sonnet-5`) para trabalho aditivo, orientado a
> template, sobre padrões já consolidados.
>
> **Histórico**: a v1 deste documento (2026-07-09) foi escrita antes dos Épicos FR
> (Clusterização Contextual + Criar Faixas por Risco), GS (Goal Seek Profundo) e H4–H8
> (Motor Python). Nenhuma sessão da v1 chegou a ser executada. Esta v2 (2026-07-20)
> **substitui integralmente** a v1 — reavaliação crítica na seção seguinte.

---

## 🔎 Revisão crítica da v1 (por que esta v2 existe)

Uma auditoria de UX sobre o app atual (`src/App.jsx`, ~13.6k linhas, `schemaVersion 2.7`)
constatou que o problema **piorou** desde a v1 — e que a v1, se executada como escrita,
migraria só uma fração dos comandos:

1. **O inventário da v1 estava 3× subdimensionado.** Ela citava 3 superfícies de comando;
   hoje são **12** (inventário completo abaixo), com **~70 comandos/controles**. Cada
   feature nova (Descobrir/Clusterizar/Faixas "aqui", Motor Python, Business Impact)
   entrou pelo padrão antigo — botão solto na superfície mais próxima — exatamente a
   fragmentação que a Regra de Congelamento tentava evitar.
2. **A toolbar contextual do Cineminha é o sintoma terminal**: ~14 comandos numa única
   faixa flutuante (tipo ×3, Resultado, Domínio, Otimizar, Johnny, Exportar, Importar,
   Biblioteca, Salvar, Descobrir/Clusterizar/Faixas aqui, Travar) — já não cabe em telas
   comuns e não tem hierarquia visual nenhuma.
3. **Não existe área de Configurações** — e a v1 não previa uma. Hoje as preferências
   vivem em 4 lugares do painel direito: seção 🐍 Motor Python (toggle/URL/token/teste),
   seção Visualização (espessura dinâmica + 3 indicadores de aresta), card Business
   Impact e o próprio colapso do painel. Um usuário não tem onde "procurar as
   configurações do app". A v2 introduz o **Hub de Configurações** (Sessão 3).
4. **Comandos escopados por nó triplicados**: "🔍 Descobrir aqui", "🧩 Clusterizar aqui" e
   "📐 Faixas aqui" estão copiados-e-colados em 3 toolbars (losango/Cineminha/Lens) com
   3 estilos ligeiramente diferentes. No registro viram **1 descritor cada**, com
   `contextWhen` por tipo — a v2 torna esse dedup explícito e obrigatório.
5. **A aba "Otimizar" da v1 misturava diagnóstico com ação.** Com a chegada da
   Clusterização e das Faixas por Risco, a intenção "entender a base/população"
   (Descobrir, Clusterizar, Faixas, Copiloto) é distinta de "mexer na política"
   (Atingir Objetivo, Simplificar, Johnny). A v2 separa **Analisar** de **Otimizar** —
   espelha o fluxo mental real do analista de crédito: *olhar → decidir → mudar*.
6. **Descoberta de comandos não escala sem busca.** Com ~70 comandos em 13 abas
   (7 fixas + 6 contextuais), o usuário precisa de uma **Busca de comandos** (Ctrl+K,
   padrão "Diga-me" do Office / command palette do VS Code). É quase de graça uma vez
   que o registro existe — a v1 não a previa (Sessão 7).
7. **O destino das seções do painel direito estava indefinido.** A v1 mandava dividir em
   Assets/Inspector mas não dizia para onde iam "Arquivos carregados", "Variáveis de
   Decisão", "Segmentação", "Simulação" e o Copiloto (que nem existia como painel). A v2
   normatiza: painel com **3 abas** — Ativos / Inspetor / 🧭 Copiloto (Sessão 6).
8. **A Status Bar ganhou responsabilidades novas**: além dos KPIs, é o lar natural dos
   badges 🐍 Motor Python e Build (hoje espremidos no header do painel) e do indicador de
   zoom (hoje solto no canto do canvas).
9. **Referências staled**: line refs da v1 (~8588, ~9339, ~4592) não existem mais;
   `schemaVersion` citado era 2.5, o atual é **2.7**. Esta v2 atualiza tudo (e os prompts
   mandam re-localizar por âncora de texto, não por número de linha).

O que a v1 acertou e a v2 **preserva na íntegra**: o registro declarativo como fonte
única; a ordem "extrair antes de mover"; o invariante de posicionamento do canvas; a
especificação do colapso em 3 estados; a QAT; a Regra de Congelamento; a exigência de
persistência de todo estado configurável.

---

## 📋 Inventário atual das superfícies de comando (evidência, 2026-07-20)

Localize por âncora de texto (os números de linha derivam do commit atual e envelhecem):

| # | Superfície | Onde (`src/App.jsx`) | Conteúdo |
|---|-----------|----------------------|----------|
| 1 | Toolbar de topo | ~6993 (`{/* Toolbar */}`) | ferramentas (selecionar/mão/losango/Cineminha▾/Lens/frame/terminais), desfazer/refazer, ⊹ Reorganizar, cor, deletar |
| 2 | Toolbar de alinhamento | ~7100 (multi-seleção >1) | 8 comandos (esq/dir/topo/base/centros/distribuições) |
| 3 | Toolbar do Cineminha | ~7156 | tipo ×3 · ⊞ Resultado · ⚙ Domínio · ⚙ Otimizar Decisão · ⚡ Johnny · ⬇⬆ Exportar/Importar · 📚 Biblioteca · 💾 Salvar · 🔍/🧩/📐 "aqui" · 🔒 |
| 4 | Toolbar Johnny | ~7267 (2+ Cineminhas) | ⚡ Johnny (N) |
| 5 | Toolbar do losango | ~7285 | ⚙ Domínio · 🔍/🧩/📐 "aqui" · 🔒 |
| 6 | Toolbar do Lens | ~7328 | 🔎 Configurar · 🔍/🧩/📐 "aqui" · 🔒 |
| 7 | Toolbar de terminal | ~7372 | 🔍 Descobrir aqui |
| 8 | Toolbar de porta solta | ~7389 | 💡 Sugerir próximo passo |
| 9 | Painel direito (10 seções) | ~7765–8340 | Projeto (Salvar/Abrir) · 🐍 Motor Python (prefs) · Dados (Importar CSV) · **Fluxo** (10 botões: Exportar/Importar, Políticas, Atingir Objetivo, Simplificar, Documentar, Descobrir, Clusterizar, Faixas) · Arquivos carregados · Variáveis de Decisão (chips + ✏️ cluster/faixas) · Segmentação (add Lens) · 🧭 Copiloto (lint) · Simulação (Painel + Business Impact) · Visualização (4 toggles) |
| 10 | Cantos do canvas | ~7416 / ~7424 / ~7431 | zoom ± ⌂ + % · hint flutuante · card de Dicas |
| 11 | Barra de abas inferior | ~13541 | aba Dashboard · abas de canvas (renomear/📊 no Dashboard/⋮ menu) · + novo canvas |
| 12 | Header do painel | ~7786 | badges 🐍 ComputeEngine + Build, colapsar painel |

Deep-links que a migração **não pode quebrar**: `setSidecarPrefsOpen(true)` é chamado de
5 pontos (aviso `projectLoadNotice` + `onOpenPrefs` dos `UnlockHint` nos modais de Goal
Seek, Descoberta e Clusterização) — na Sessão 3 esses pontos passam a abrir o Hub de
Configurações na seção Motor Python.

---

## Visão e princípios de execução

A migração converge tudo num **registro declarativo de comandos** (fonte única) que a
Ribbon, as abas contextuais, a Busca de comandos e a Status Bar renderizam. Princípios:

1. **Incremental e reversível**: cada sessão é um PR fechado, com o app funcionando ao fim.
2. **Extrair antes de mover**: primeiro o registro (Sessão 1), depois a UI consome dele.
3. **Não-destrutivo com o motor**: nada de simulação/viewport/`autoLayout` muda de matemática.
4. **Persistência obrigatória**: todo estado configurável pelo usuário entra em
   `sessionStorage` + `.credito.json` (ver a ⚠️ regra do CLAUDE.md), com bump de `schemaVersion`.
5. **Sem features novas de domínio** durante a migração (ver *Regra de Congelamento*).
6. **Um comando = um descritor** — nada de copiar-e-colar o mesmo botão em N superfícies
   (aprendizado do "Descobrir/Clusterizar/Faixas aqui").
7. **Preferência tem endereço**: qualquer configuração nova nasce no Hub de Configurações
   (a partir da Sessão 3), nunca como seção solta de painel.

---

## ⚠️ Regra de Congelamento (Freeze) durante a migração

A migração depende de **extrair TODO comando para o registro**. Se um comando novo entrar
pelo padrão antigo (um `<button onClick>` inline solto) no meio da migração, ele **escapa
do registro** e reintroduz exatamente a fragmentação que estamos removendo — foi
literalmente o que aconteceu entre a v1 e esta v2 (FR, GS, H4–H8).

Regra em vigor da Sessão 1 até a Sessão 8:

- ✅ **Correção de bug** pode.
- ⚠️ **Feature nova de domínio** só se for **inevitável** — e então **obrigatoriamente**
  adicionada como **descritor no registro** (o jeito novo), nunca como botão solto; se
  for preferência, nasce no Hub de Configurações.
- 🚫 Fora isso, **segure** features novas até fechar a Sessão 8.

---

## 🏷️ Como escolher Opus vs Sonnet

Use **`Opus 4.8`** quando a tarefa:
- mexe em **estado/refs compartilhados** no monólito (`src/App.jsx`, ~13.6k linhas) e
  precisa preservar condições exatas de enable/disable e contexto de seleção;
- toca **matemática de viewport/zoom/posicionamento** (`svgPt`/`toWorld`/`doZoom`/`autoLayout`);
- **realoca fluxos com deep-links** (ex.: mover a seção Motor Python preservando os 5
  call-sites de `setSidecarPrefsOpen`);
- é a **primeira fiação** de um padrão novo (o registro, a aba contextual, o Hub, o Inspetor).

Use **`Sonnet 5`** quando a tarefa é **aditiva e orientada a template** sobre um padrão já
pronto e testado:
- adicionar **descritores de comando** ao registro;
- adicionar **campos ao Inspetor** por tipo de shape ou **seções ao Hub** já fiado;
- adicionar **indicadores à Status Bar**;
- a **Busca de comandos** (consome o registro pronto);
- limpeza de código morto, atalhos, touch e ajustes de estilo.

---

## 🧭 Invariante de posicionamento — LEIA ANTES DA SESSÃO 4

A conversão tela→mundo **lê `getBoundingClientRect()` ao vivo** a cada gesto — **não há
offset fixo do topo** (âncora: `const getBR`, hoje ~2481):

```js
const getBR   = () => svgRef.current.getBoundingClientRect();
const svgPt   = (cx,cy) => { const r=getBR(); return [cx-r.left, cy-r.top]; };
const toWorld = (sx,sy) => { const {x,y,s}=vpR.current; return [(sx-x)/s,(sy-y)/s]; };
```

`autoLayout` e o "centralizar" leem `svgEl.clientWidth/clientHeight` ao vivo.
Consequências **normativas** para o colapso do Ribbon:

- **Estados que empurram o canvas (reflow)** — `fixed` e `compact`: a conversão **se
  autocorrige sozinha**, porque `rect.top`/altura mudam junto. Seguros por construção.
- **Estado de revelação por hover** — o Ribbon revelado **NUNCA pode empurrar o canvas**.
  Deve ser um **overlay `position:absolute`** (z-index alto) por cima do canvas, aparecendo
  e sumindo **sem reflow**. Como não altera o `rect` do SVG, há **zero recálculo** de
  viewport/layout.
- 🚫 **Proibido** cachear `getBoundingClientRect` num estado/ref e usar em `toWorld`/drag.
  Se alguma otimização introduzir cache do rect, **invalide-o** em qualquer mudança de
  `ribbonMode` (via `ResizeObserver` no container do SVG).

---

## 🗔 Especificação do colapso em 3 estados (`ribbonMode`)

Estado novo `ribbonMode: 'fixed' | 'compact' | 'auto'` (persistido). Alternado por um botão
no canto do Ribbon (ciclo) e/ou duplo-clique na aba ativa (padrão Office).

| Modo | Descrição | Reflow do canvas? | Revelação |
|------|-----------|-------------------|-----------|
| `fixed` | Ribbon inteiro visível e fixo (abas + grupos de comandos) | **Sim** (canvas mais baixo) | — |
| `compact` | Só a **faixa de abas** fica fixa; os grupos ficam ocultos | **Sim** (só a faixa ocupa altura) | Clicar/hover numa aba abre os grupos como **overlay** temporário; sai → recolhe. **Sem reflow.** |
| `auto` | Ribbon **oculto**, só uma **hotzone** fina de ~6px no topo | **Não** | Hover na hotzone faz o Ribbon inteiro **surgir como overlay**; pega a ferramenta, tira o mouse, **some**. **Sem reflow.** |

- A **QAT** (ver abaixo) e o **⚙ do Hub de Configurações** permanecem visíveis nos **três** modos.
- Persistir `ribbonMode` em `sessionStorage` + `.credito.json` (bump de schema).
- A animação de aparecer/sumir do overlay é puramente CSS (opacity/transform) — não dispara
  recomputação de viewport.

---

## 🗺️ Mapa das abas do Ribbon (só comandos que já existem — atualizado 2026-07-20)

Desenhe pelo que existe hoje — **sem abas fantasma**. As abas crescem quando features
novas chegarem (via descritor, nunca botão solto).

| Aba | Grupos → comandos (todos já no código) |
|-----|------|
| **Início** | *Edição*: selecionar/mão · desfazer · refazer · deletar · duplicar · *Organizar*: alinhar/distribuir (8) · ⊹ Reorganizar · cor · *Ver*: zoom +/− · centralizar |
| **Inserir** | *Nós*: losango · Cineminha (inserir ▾ / da biblioteca) · Decision Lens · frame · *Terminais*: Aprovado · Reprovado · AS IS · *Painéis*: 📊 Painel de Simulação · ⬡ Business Impact |
| **Dados** | Importar CSV · bases carregadas (editar ✏️ / remover — reusa o gerenciador) · *Variáveis derivadas*: editar 🧩 Cluster · editar 📐 Faixas |
| **Analisar** | 🔍 Descobrir Segmentos · 🧩 Clusterizar Segmentos · 📐 Criar Faixas por Risco · 🧭 Copiloto (foca a aba Copiloto do painel) |
| **Otimizar** | 🎯 Atingir Objetivo (inclui o modo Profundo/MILP) · 🧹 Simplificar · ⚡ Johnny (habilita com 2+ Cineminhas) |
| **Política** | 📚 Biblioteca de Políticas · 📄 Documentar Política · ⬇ Exportar Fluxo (inclui PolicyIR) · ⬆ Importar Fluxo |
| **Projeto** | 💾 Salvar Projeto · 📁 Abrir Projeto · ⚙ Configurações (abre o Hub) |
| *contextual* → **Matriz** | (Cineminha) tipo ×3 · ⊞ Resultado · ⚙ Domínio · ⚙ Otimizar Decisão · ⚡ Johnny · ⬇⬆ Exportar/Importar · 📚 Biblioteca · 💾 Salvar na biblioteca · *Analisar aqui*: 🔍 · 🧩 · 📐 · 🔒 Travar |
| *contextual* → **Decisão** | (losango) ⚙ Domínio · *Analisar aqui*: 🔍 · 🧩 · 📐 · 🔒 Travar |
| *contextual* → **Lens** | (Decision Lens) 🔎 Configurar regras · *Analisar aqui*: 🔍 · 🧩 · 📐 · 🔒 Travar |
| *contextual* → **Terminal** | (Aprovado/Reprovado/AS IS) 🔍 Descobrir aqui |
| *contextual* → **Porta** | (porta sem saída) 💡 Sugerir próximo passo |
| *contextual* → **Seleção** | (multi-seleção) alinhar/distribuir (8) · ⚡ Johnny (N) se todos Cineminhas · 🗑 Deletar (N) |

Regras:
- As abas contextuais aparecem **destacadas** só com o tipo correspondente selecionado
  (padrão "Contextual Tabs" do Office) e são um **filtro** do registro por
  `contextWhen(selection)`, com auto-ativação ao selecionar.
- O grupo **"Analisar aqui"** é definido **uma única vez** no registro (3 descritores com
  `contextWhen` aceitando losango/Cineminha/Lens; o 🔍 aceita também terminais) — fim da
  triplicação atual.
- Duplicidade intencional e permitida: um mesmo descritor pode aparecer numa aba fixa
  (escopo global) e numa contextual (escopo do nó) — ex.: 🔍 Descobrir Segmentos
  (global) vs 🔍 Descobrir aqui (`scope={nodeId}`). São **dois descritores** que chamam o
  mesmo modal com parâmetros diferentes, nunca dois botões soltos.

---

## ⚙ Hub de Configurações — especificação (Sessão 3)

Hoje **não existe** área de configurações; preferências estão pulverizadas no painel
direito. O Hub é um **modal** (mesmo padrão visual dos modais existentes) com navegação
lateral por seções — o endereço único de toda preferência do app:

| Seção | Conteúdo (tudo já existe — só muda de casa) |
|-------|---------------------------------------------|
| 🐍 **Motor Python** | Toggle ligar · URL/token (só `IS_DEV_BUILD`) · 🔄 Verificar conexão · painel de teste `echo_stats` · textos de instalação/tier. Migração integral da seção do painel (âncora `sidecarPrefsOpen`). |
| 🎨 **Visualização** | Espessura Dinâmica · Indicadores nas arestas (Volume, Inad. Real, Inad. Inferida) — os 4 toggles da seção "Visualização" atual |
| 🗔 **Interface** | `ribbonMode` (3 estados, mesmo estado da Sessão 4) · indicadores da Status Bar (mesmo estado da Sessão 5) · colapso do painel direito |
| ℹ️ **Sobre** | Build (reusa `BuildBadge`) · versão do schema · atalhos de teclado (referência) |

Contratos normativos:
- **API interna**: `openSettings(sectionId?)` — abre o Hub direto numa seção. Os 5
  call-sites de `setSidecarPrefsOpen(true)` (aviso de projeto grande + `onOpenPrefs` dos
  `UnlockHint` de Goal Seek/Descoberta/Clusterização) passam a chamar
  `openSettings('motor-python')`. **Nenhum deep-link pode quebrar.**
- **Pontos de entrada**: botão ⚙ na extremidade direita da faixa de abas do Ribbon
  (visível nos 3 modos de colapso, como a QAT) + comando "⚙ Configurações" na aba
  Projeto + atalho `Ctrl+,`.
- **Estado**: o Hub em si é efêmero (`settingsModal`); as preferências que ele edita já
  são/continuam persistidas (`computeSidecar`, toggles de aresta etc. — ver checklist do
  CLAUDE.md). A seção aberta por último **não** persiste.
- Preferência nova no futuro ⇒ nasce como item de uma seção do Hub (ou uma seção nova),
  nunca como seção do painel direito.

---

## 🔍 Busca de comandos — especificação (Sessão 7)

Padrão "Diga-me" (Office) / command palette (VS Code), consumindo o registro:

- **Atalho `Ctrl+K`** (e um campo compacto "Pesquisar comando…" na faixa de abas, à
  esquerda do ⚙): abre um popover com input + lista.
- Busca fuzzy simples (normalização de acentos, como a busca de variáveis do painel) sobre
  `label` + `keywords` dos descritores; **respeita `enabledWhen`/`contextWhen`** — comando
  desabilitado aparece acinzentado com o motivo (ex.: "requer 2+ Cineminhas
  selecionados"), comando fora de contexto não aparece.
- Enter executa `onRun` e fecha; Esc fecha. Mostra o atalho de teclado do comando quando
  houver.
- Zero dependência nova — é um filtro sobre `COMMANDS` renderizado num portal.

---

## ⚡ Barra de Acesso Rápido (QAT) e ergonomia

Ergonomia delegada e fechada assim (undo/redo/delete **sempre** a um clique):

- **QAT** — faixa fininha fixa num canto do Ribbon, **sobrevive aos 3 modos** de colapso
  (visível mesmo em `compact`/`auto`): **Desfazer**, **Refazer**, **Deletar** (só com
  seleção) e **💾 Salvar Projeto**. Não faz parte do conteúdo colapsável.
- **Mini-flutuante de seleção** — perto do shape selecionado, só **Deletar** e **Duplicar**
  (ergonomia de mão). Introduzido na Sessão 8.
- **Atalhos** existentes preservados: `Ctrl+Z`/`Ctrl+Y`/`Del`; novos: `Ctrl+K` (busca),
  `Ctrl+,` (Configurações). Auditoria e documentação na Sessão 8.

---

## 📏 Status Bar — especificação (Sessão 5)

Faixa fina inferior, estilo "soma automática" do Excel, **acima** da barra de abas de
canvas (que permanece onde está):

- **Zona esquerda (configurável)**: indicadores escolhidos pelo usuário — Taxa de
  Aprovação, Inad. Real, Inad. Inferida (espelham `SimIndicators`/`incrementalResult`),
  nº de shapes selecionados, volume que chega ao nó selecionado (`nodeArrivals`), linhas
  da base ativa. Engrenagem/clique-direito na barra → escolher quais aparecem
  (`statusBarIndicators`, persistido).
- **Zona direita (fixa)**: badge 🐍 Motor Python (clique → `openSettings('motor-python')`),
  `BuildBadge` e zoom % (clique → centralizar) — **saem** do header do painel e do canto
  do canvas, ganhando lar permanente.
- Matemática dos indicadores **inalterada** (mesmos denominadores/contratos de GATE).

---

## 🗂 Painel direito — Ativos / Inspetor / Copiloto (Sessão 6)

O painel **permanece à direita** (decisão do usuário), com o `panelCollapsed` existente, e
ganha 3 abas internas:

| Aba | Conteúdo |
|-----|----------|
| **Ativos** | Bases carregadas (lista + ✏️/✕ atuais) · Variáveis de Decisão (busca + chips arrastáveis + ✏️ de cluster/faixas) · atalhos às bibliotecas (Cineminha/Políticas). "Recursos do estudo." |
| **Inspetor** | **Propriedades do objeto selecionado** (não comandos — comandos estão na Ribbon): losango (label, variável, resumo do domínio, chegadas via `nodeArrivals`), Cineminha (tipo, rowVar/colVar, grade, células travadas), Lens (regras, população), terminal (tipo, volume), frame. Editável onde já havia edição inline; senão read-only. Sem seleção → propriedades do canvas/estudo (nome da aba, nº de shapes, base vinculada) com dica. |
| **🧭 Copiloto** | Lint estrutural atual (achados por severidade, "ir até o nó", quick-fixes) + o card informativo da Descoberta. Badge com nº de achados no título da aba. |

O que **sai** do painel na migração: Projeto/Fluxo/Dados/Segmentação/Simulação (→ Ribbon,
Sessões 1–2), Motor Python/Visualização (→ Hub, Sessão 3), badges (→ Status Bar, Sessão
5). Persistir `rightPanelMode: 'assets' | 'inspector' | 'copilot'`.

---

## Sessão 1 — Registro de Comandos + casca do Ribbon (modo `fixed`)

**Modelo**: 🏷️ `Opus 4.8` — threading de estado/refs no monólito, preservar enable/disable e contexto exatos; matemática de reflow do canvas.

**Pré-requisitos**: Nenhum (é a base).

**O que vai entregar**:
- **Registro declarativo** `COMMANDS` — array de descritores
  `{id, label, icon, tab, group, keywords, shortcut, contextWhen, enabledWhen, onRun}`
  (fonte única). `contextWhen(selection)` = `null` para comando global, ou predicado por
  tipo de shape. Cobre **TODAS as 12 superfícies do inventário** (incluindo as toolbars
  contextuais e as seções do painel — mesmo as que só migram de UI nas Sessões 2–3; o
  descritor nasce agora, a superfície antiga passa a renderizar a partir dele quando
  possível sem mudança visual).
- Componente **`Ribbon`** renderizando as abas
  *Início/Inserir/Dados/Analisar/Otimizar/Política/Projeto* a partir do registro (só modo
  `fixed` nesta sessão), conforme o "Mapa das abas".
- **Migração** dos comandos da toolbar de topo e das seções **Projeto, Dados, Fluxo,
  Segmentação e Simulação** do painel direito para a Ribbon (essas seções somem do
  painel; as toolbars flutuantes de contexto **ficam como estão** — migram na Sessão 2;
  Motor Python e Visualização ficam — migram na Sessão 3).
- **QAT** (Desfazer/Refazer/Deletar/Salvar) no canto do Ribbon.
- Reflow correto do canvas com o Ribbon ocupando altura (invariante acima intacto).
- Persistir `ribbonActiveTab` (`sessionStorage` + `.credito.json`, bump de schema).

**Prompt**:
```
Vamos à Sessão 1 da evolução de UX (Ribbon), conforme docs/wiki/Ribbon-Prompts-Sessoes.md
(v2). Releia esse documento (seções de design são normativas — em especial o Inventário
de superfícies e o Mapa das abas) e o CLAUDE.md antes de propor. Localize as superfícies
por âncora de texto (comentários JSX como {/* Toolbar */}, sidecarPrefsOpen, seção
"Fluxo"), não por número de linha. Implemente: (1) um registro declarativo COMMANDS em
src/App.jsx — descritores {id, label, icon, tab, group, keywords, shortcut, contextWhen,
enabledWhen, onRun} como FONTE ÚNICA, cobrindo TODAS as 12 superfícies do inventário
(inclusive os comandos que só mudam de UI nas próximas sessões — os escopados "Descobrir/
Clusterizar/Faixas aqui" viram 1 descritor cada com contextWhen por tipo, nunca 3
cópias); (2) o componente Ribbon com as abas Início/Inserir/Dados/Analisar/Otimizar/
Política/Projeto (só modo fixed) + a QAT (Desfazer/Refazer/Deletar com seleção/Salvar
Projeto); (3) migre para a Ribbon os comandos da toolbar de topo e das seções Projeto,
Dados, Fluxo, Segmentação e Simulação do painel direito, REMOVENDO essas seções do
painel (as toolbars flutuantes de contexto ficam intocadas — Sessão 2; Motor Python e
Visualização ficam no painel — Sessão 3). Preserve enable/disable e contexto de seleção
EXATOS (ex.: Painel de Simulação desabilita se já existe; Business Impact liga o widget).
Garanta reflow correto do canvas — NÃO altere svgPt/toWorld/doZoom/autoLayout (a
conversão lê getBoundingClientRect ao vivo; confirme). Persista ribbonActiveTab em
sessionStorage (nova chave) e no .credito.json (buildProjectPayload + loadProject com
default defensivo + bump de schemaVersion a partir do 2.7 atual). Nenhuma feature de
domínio nova. Ao fim, app 100% funcional e npm test verde.
```

**Checklist**:
- [ ] `COMMANDS` cobre as 12 superfícies do inventário; comandos escopados sem duplicação
- [ ] `Ribbon` renderiza as 7 abas fixas a partir do registro; QAT presente
- [ ] Seções Projeto/Dados/Fluxo/Segmentação/Simulação removidas do painel; nenhum comando perdido
- [ ] Toolbars flutuantes de contexto **inalteradas**; Motor Python/Visualização **inalteradas**
- [ ] Reflow do canvas correto; clique/drag/zoom sem desvio (invariante de posicionamento)
- [ ] `ribbonActiveTab` persistido (sessionStorage + `.credito.json` + bump de schema + restore defensivo)
- [ ] `npm test` verde; app funcional

---

## Sessão 2 — Abas contextuais + aposentadoria das toolbars flutuantes

**Modelo**: 🏷️ `Opus 4.8` — lógica de seleção→contexto (a primeira fiação); *adicionar* novas abas contextuais depois é `Sonnet 5`.

**Pré-requisitos**: Sessão 1 (registro + Ribbon).

**O que vai entregar**:
- Abas contextuais **Matriz/Decisão/Lens/Terminal/Porta/Seleção** conforme o Mapa das
  abas, surgindo destacadas por `contextWhen(selection)`, com auto-ativação ao selecionar
  e retorno à aba anterior ao desselecionar.
- Migração do conteúdo das **6 toolbars flutuantes** (Cineminha, Johnny, losango, Lens,
  terminal, porta) e da **toolbar de alinhamento** para essas abas — incluindo o seletor
  de tipo do Cineminha (3 tipos), ⊞ Resultado e o grupo "Analisar aqui" dedupado.
- Aposentar as toolbars flutuantes (o mini-flutuante ergonômico de Deletar/Duplicar vem
  só na Sessão 8).
- Multi-seleção: aba **Seleção** com alinhar/distribuir, Johnny (todos Cineminhas) e
  deletar em massa.

**Prompt**:
```
Vamos à Sessão 2 da evolução de UX (Ribbon), conforme docs/wiki/Ribbon-Prompts-Sessoes.md
(v2). A Sessão 1 entregou o registro COMMANDS e a Ribbon (modo fixed). Releia o documento
e o CLAUDE.md. Implemente as abas contextuais Matriz/Decisão/Lens/Terminal/Porta/Seleção
do Mapa das abas: surgem destacadas (padrão "Contextual Tabs") só com o tipo
correspondente selecionado, via contextWhen(selection), com auto-ativação ao selecionar e
retorno à aba anterior ao desselecionar. Migre TODO o conteúdo das 6 toolbars flutuantes
de contexto (Cineminha: tipo ×3, ⊞ Resultado, ⚙ Domínio, ⚙ Otimizar Decisão, ⚡ Johnny,
⬇⬆ Exportar/Importar, 📚 Biblioteca, 💾 Salvar, Descobrir/Clusterizar/Faixas aqui, 🔒;
losango; Lens; terminal; porta solta: 💡 Sugerir próximo passo; Johnny multi) e da
toolbar de alinhamento para essas abas, usando os descritores já existentes no registro
(o grupo "Analisar aqui" é UM conjunto de descritores com contextWhen — não recrie por
tipo). Aposente as toolbars flutuantes (o mini-flutuante de Deletar/Duplicar vem na
Sessão 8). Preserve multi-seleção (Johnny 2+, alinhar/deletar em massa) e enable/disable
exatos. Nenhuma feature nova. Ao fim, app 100% funcional e npm test verde.
```

**Checklist**:
- [x] 6 abas contextuais aparecem/somem corretamente por tipo/estado de seleção
- [x] Auto-ativação ao selecionar; retorno ao desselecionar
- [x] Todo comando das toolbars flutuantes + alinhamento migrado; nenhum perdido
- [x] Grupo "Analisar aqui" sem código triplicado
- [x] Toolbars flutuantes removidas
- [x] `npm test` verde; app funcional

> **Entregue (2026-07-20).** A aba contextual é derivada da seleção em `App` via
> `activeContextTab` (single shape → Matriz/Decisão/Lens/Terminal/Porta; multi → Seleção) e
> renderizada pelo `Ribbon` a partir de `contextCommands = COMMANDS.filter(c =>
> c.contextWhen(sel))` — o `tab: 'ctx-*'` dos descritores deixou de gate a renderização.
> Auto-ativação/retorno via `ctxTabShown` (efêmero) + `useEffect` sobre `activeContextTab`.
> As 6 toolbars flutuantes + a de alinhamento foram removidas do JSX do canvas (só a paleta
> de cor, acionada por `org.color`, permanece). Seleção ganhou `ctx.sel.johnny` (habilita só
> com todos Cineminhas) e `ctx.sel.delete`. Sem estado persistido novo → sem bump de schema.

---

## Sessão 3 — ⚙ Hub de Configurações

**Modelo**: 🏷️ `Opus 4.8` — realoca a seção Motor Python preservando 5 deep-links (`setSidecarPrefsOpen`) e estados persistidos; *adicionar seções novas* depois é `Sonnet 5`.

**Pré-requisitos**: Sessões 1–2 (aba Projeto existe; painel já esvaziado de comandos).

**O que vai entregar**:
- Modal **Hub de Configurações** com navegação lateral: seções 🐍 Motor Python,
  🎨 Visualização, 🗔 Interface, ℹ️ Sobre — conforme a especificação do Hub acima.
- Migração integral da seção 🐍 Motor Python do painel (toggle, URL/token dev, verificar
  conexão, `SidecarTestPanel`, textos) e da seção Visualização (4 toggles).
- API `openSettings(sectionId?)`; os 5 call-sites de `setSidecarPrefsOpen(true)`
  (`projectLoadNotice` + 4 `onOpenPrefs` de `UnlockHint`) passam a
  `openSettings('motor-python')`.
- Pontos de entrada: ⚙ na faixa de abas (visível nos 3 modos futuros), comando na aba
  Projeto, atalho `Ctrl+,`.
- Seção Interface ainda enxuta (colapso do painel); ganha `ribbonMode` na Sessão 4 e
  Status Bar na Sessão 5.

**Prompt**:
```
Vamos à Sessão 3 da evolução de UX (⚙ Hub de Configurações), conforme
docs/wiki/Ribbon-Prompts-Sessoes.md (v2) — a seção "Hub de Configurações" é normativa.
Releia o documento e o CLAUDE.md. Hoje não existe área de configurações: as preferências
estão em seções do painel direito. Implemente o modal Hub de Configurações (padrão visual
dos modais existentes) com navegação lateral e as seções: 🐍 Motor Python (migração
INTEGRAL da seção atual do painel — âncora sidecarPrefsOpen: toggle ligar, URL/token só
em IS_DEV_BUILD, verificar conexão, SidecarTestPanel, textos de instalação/tier);
🎨 Visualização (Espessura Dinâmica + 3 indicadores de aresta); 🗔 Interface (colapso do
painel direito, por ora); ℹ️ Sobre (BuildBadge + versão do schema + tabela de atalhos).
Crie openSettings(sectionId?) e troque os 5 call-sites de setSidecarPrefsOpen(true)
(projectLoadNotice e os onOpenPrefs dos UnlockHint de Goal Seek/Descoberta/Clusterização)
por openSettings('motor-python') — NENHUM deep-link pode quebrar: teste cada um. Pontos
de entrada: botão ⚙ na extremidade direita da faixa de abas do Ribbon, comando
"⚙ Configurações" na aba Projeto e atalho Ctrl+,. Remova as seções migradas do painel.
Os estados editados já são persistidos (computeSidecar, toggles de aresta) — não mude
formato de persistência; o Hub em si é efêmero. Nenhuma feature de domínio nova. Ao fim,
app 100% funcional e npm test verde.
```

**Checklist**:
- [x] Hub com 4 seções e navegação lateral; visual consistente com os modais atuais
- [x] Seções Motor Python e Visualização removidas do painel; funcionalidade idêntica
- [x] 5 deep-links testados um a um (aviso de projeto grande + 4 UnlockHint)
- [x] ⚙ na faixa de abas + comando na aba Projeto + `Ctrl+,`
- [x] Persistência dos estados inalterada (sem bump — nenhum campo novo)
- [x] `npm test` verde; app funcional

> **Entregue (2026-07-20).** Estado efêmero `settingsModal` (`null | {section}`) +
> `openSettings(sectionId?)` (useCallback estável). O modal segue o padrão visual dos modais
> existentes (overlay `fixed`, `z-index` 4200) com sidebar de 4 seções: 🐍 Motor Python
> (migração integral — toggle, URL/token só em `IS_DEV_BUILD`, 🔄 Verificar conexão,
> `SidecarTestPanel`, textos de instalação/tier), 🎨 Visualização (Espessura Dinâmica + 3
> indicadores de aresta), 🗔 Interface (colapso do painel direito), ℹ️ Sobre (`BuildBadge` +
> schema `2.8` + tabela de atalhos). As seções Motor Python e Visualização foram REMOVIDAS
> do painel direito. Os 5 `setSidecarPrefsOpen(true)` (aviso `projectLoadNotice` + 4
> `onOpenPrefs` dos `UnlockHint`) agora chamam `openSettings('motor-python')`; o estado
> `sidecarPrefsOpen` foi eliminado. Entradas: ⚙ na extremidade direita da faixa de abas do
> Ribbon (prop `onOpenSettings`), comando `project.settings` na aba Projeto e atalho `Ctrl+,`.
> Sem estado persistido novo → sem bump de schema.

---

## Sessão 4 — Colapso do Ribbon em 3 estados

**Modelo**: 🏷️ `Opus 4.8` — sensível a viewport/zoom; o overlay é invariante crítico.

**Pré-requisitos**: Sessões 1–3.

**O que vai entregar**:
- `ribbonMode: 'fixed' | 'compact' | 'auto'` conforme a *Especificação do colapso* deste documento.
- Botão de ciclo + duplo-clique na aba ativa para alternar; controle também na seção
  Interface do Hub.
- `fixed`/`compact` reflowam; `auto` e a revelação de `compact` são **overlay `position:absolute` sem reflow**.
- QAT e ⚙ visíveis nos 3 modos.
- Persistir `ribbonMode` (`sessionStorage` + `.credito.json`, bump de schema).
- Se houver cache de rect em algum lugar, invalidação via `ResizeObserver` no container do SVG.

**Prompt**:
```
Vamos à Sessão 4 da evolução de UX (colapso do Ribbon), conforme
docs/wiki/Ribbon-Prompts-Sessoes.md (v2). Releia "Invariante de posicionamento" e
"Especificação do colapso em 3 estados" — são normativas. Implemente ribbonMode com três
valores: fixed (Ribbon inteiro, reflowa o canvas), compact (só a faixa de abas fixa
reflowa; clicar/hover numa aba abre os grupos como OVERLAY temporário sem reflow) e auto
(Ribbon oculto exceto hotzone de ~6px no topo; hover revela o Ribbon inteiro como OVERLAY
sem reflow, sai → some). Alternância por botão de ciclo, duplo-clique na aba ativa e pela
seção Interface do Hub de Configurações. REGRA CRÍTICA: conteúdo revelado por hover é
position:absolute por cima do canvas, NUNCA empurra o SVG (zero reflow/recalcs). Confirme
que svgPt/toWorld continuam lendo getBoundingClientRect ao vivo; se existir cache de
rect, invalide via ResizeObserver no container do SVG a cada mudança de ribbonMode. QAT e
⚙ permanecem visíveis nos 3 modos. Persista ribbonMode em sessionStorage + .credito.json
(bump de schema, restore defensivo). Teste os 3 modos com base carregada: clique/drag/
zoom sem desvio; o modo auto não dispara recomputo de viewport ao revelar. Ao fim, app
100% funcional e npm test verde.
```

**Checklist**:
- [x] 3 modos implementados e alternáveis (botão + duplo-clique + Hub)
- [x] `fixed`/`compact` reflowam; revelação de `compact` e `auto` são overlay **sem reflow**
- [x] Clique/drag/zoom sem desvio nos 3 modos (base grande carregada)
- [x] `auto` não dispara recomputo de viewport ao revelar
- [x] QAT + ⚙ visíveis nos 3 modos
- [x] `ribbonMode` persistido (bump de schema, restore defensivo)
- [x] `npm test` verde; app funcional

> **Entregue (2026-07-20).** Estado de topo `ribbonMode: 'fixed' | 'compact' | 'auto'`
> (init de `sessionStorage['ribbon_mode_v1']`, default `'fixed'`) + `cycleRibbonMode`
> (fixed→compact→auto→fixed). O componente `Ribbon` recebe `mode`/`onCycleMode` e ramifica:
> **fixed** = flex child (tab strip + grupos) → canvas reflowa; **compact** = só a faixa de
> abas ocupa altura, hover/clique numa aba abre os grupos como overlay `position:absolute`
> (`top:100%`, sem reflow); **auto** = wrapper `position:relative` de 6px (hotzone) ocupa a
> única altura constante, hover revela o Ribbon inteiro como overlay `position:absolute`
> (`top:0`), e um cluster flutuante mantém QAT+ciclo+⚙ visíveis quando recolhido. Revelação
> com fecho atrasado (160 ms) para o mouse transitar faixa→overlay. Overlays em `z-index`
> 450+ (vencem a paleta de cor em 400). QAT e ⚙ visíveis nos 3 modos. Alternância por botão
> de ciclo na faixa de abas, duplo-clique na aba ativa e cartões na seção 🗔 Interface do
> Hub. **Invariante de posicionamento**: `getBR` já lê `getBoundingClientRect()` ao vivo a
> cada gesto (não há cache de rect a invalidar — confirmado); os overlays de revelação não
> alteram o `rect` do SVG → zero recomputo de viewport ao revelar (modo `auto` inclusive).
> Persistido em `sessionStorage` + `.credito.json` com bump `schemaVersion 2.8 → 2.9` e
> restore defensivo.

---

## Sessão 5 — Status Bar configurável + realocação dos badges

**Modelo**: 🏷️ `Sonnet 5` — aditivo/template sobre padrões prontos; `Opus 4.8` só para revisar o bump de schema/persistência.

**Pré-requisitos**: Sessões 1–4.

**O que vai entregar**:
- **Status Bar** inferior conforme a especificação acima: zona esquerda configurável
  (KPIs de `SimIndicators`/`incrementalResult` + indicadores de seleção via
  `nodeArrivals` + linhas da base), zona direita fixa (badge 🐍 → abre o Hub, `BuildBadge`,
  zoom %).
- Configuração por engrenagem/clique-direito na barra (e espelho na seção Interface do Hub).
- Remoção dos badges do header do painel e do indicador de zoom solto do canvas.
- Persistir `statusBarIndicators` (`sessionStorage` + `.credito.json`, bump de schema).

**Prompt**:
```
Vamos à Sessão 5 da evolução de UX (Status Bar), conforme
docs/wiki/Ribbon-Prompts-Sessoes.md (v2) — a seção "Status Bar" é normativa. Releia o
documento e o CLAUDE.md. Implemente a Status Bar inferior (faixa fina, acima da barra de
abas de canvas) no estilo "soma automática" do Excel: zona esquerda com indicadores
configuráveis (Taxa de Aprovação, Inad. Real, Inad. Inferida — espelhando SimIndicators/
incrementalResult sem mudar matemática/denominadores —, nº de shapes selecionados, volume
que chega ao nó selecionado via nodeArrivals, linhas da base ativa); zona direita fixa
com o badge 🐍 Motor Python (clique → openSettings('motor-python')), o BuildBadge e o
zoom % (clique → centralizar) — removendo esses badges do header do painel e o indicador
de zoom solto do canto do canvas. Engrenagem + clique-direito na barra para escolher os
indicadores (espelhar a escolha na seção Interface do Hub). Persista statusBarIndicators
em sessionStorage (nova chave) e no .credito.json (buildProjectPayload + loadProject com
default defensivo + bump de schema). Ao fim, app 100% funcional e npm test verde.
```

**Checklist**:
- [x] Status Bar renderiza e atualiza com simulação/seleção; matemática inalterada
- [x] Zona direita: 🐍 (→ Hub) + BuildBadge + zoom %; removidos das casas antigas
- [x] Menu de configuração (engrenagem + clique-direito + Hub) funciona
- [x] `statusBarIndicators` persistido (bump de schema, restore defensivo)
- [x] `npm test` verde; app funcional

> **Entregue (2026-07-20).** `StatusBar` (novo componente, junto do `Ribbon`) renderizado
> entre o fim do CANVAS PANE e a barra de abas de canvas — faixa fina (`height:26`) sempre
> visível (Dashboard e Canvas), fora do fluxo condicionado a `activeTab`. Registro
> `STATUS_BAR_INDICATORS_META` (fonte única, 6 ids: `approvalRate`, `inadReal`,
> `inadInferida`, `selectionCount`, `nodeArrival`, `baseRows`) consumido tanto pela zona
> esquerda configurável quanto pela seção 🗔 Interface do Hub — mesmo estado
> `statusBarIndicators`, dois pontos de entrada. Valores computados em `statusBarValues`
> (useMemo): `approvalRate`/`inadReal`/`inadInferida` leem a mesma
> `incrementalResult ?? simResult` que o Business Impact/SimIndicators (nenhum
> denominador novo); `selectionCount` = `multiSel.size` ou `sel?1:0`;
> `nodeArrival` = novo helper `totalNodeArrival(shape, arr)` (leitura pura de
> `nodeArrivals[selShape.id]`, mesma regra de `totalArrivalOf` do worker — soma o(s)
> eixo(s) configurado(s), maior dos dois quando losango de linha+coluna) — `null`
> (mostra "—") em multi-seleção ou tipo sem domínio; `baseRows` = soma de `rowCount(csv)`
> sobre todo o `csvStore` carregado. Zona direita fixa: `ComputeEngineBadge` (generalizado
> com prop `onClick`/`title` opcionais — o badge do header/Hub continua com `onRecheck`
> inalterado) clicando para `openSettings('motor-python')`; `BuildBadge` reaproveitado
> sem mudança; zoom % clicável → `setVp({x:20,y:40,s:1})` (mesmo centralizar do ⌂).
> Engrenagem na zona esquerda + `onContextMenu` na barra inteira abrem o mesmo popover
> (`createPortal`, ancorado para cima — a barra fica perto do rodapé) com checkboxes por
> indicador. **Removido**: `ComputeEngineBadge`/`BuildBadge` do header do painel direito;
> o texto de `%` solto do canto do canvas (os botões `+`/`−`/`⌂` permanecem). Persistido em
> `sessionStorage` (`status_bar_indicators_v1`) + `.credito.json` com bump
> `schemaVersion 2.9 → 3.0` e restore defensivo (filtra ids desconhecidos contra o
> registro, para uma versão futura nunca quebrar a barra de um projeto antigo).

---

## Sessão 6 — Painel direito: Ativos / Inspetor / Copiloto

**Modelo**: 🏷️ `Opus 4.8` para a fiação (seleção→Inspetor + realocação das seções restantes); depois *adicionar campos por tipo de shape* é `Sonnet 5`.

**Pré-requisitos**: Sessões 1–5 (o painel já só contém: Arquivos carregados, Variáveis de Decisão, Copiloto). **Não** mover a posição do painel (fica à direita — decisão do usuário).

**O que vai entregar**:
- Painel com **3 abas** conforme a especificação: **Ativos** (bases + variáveis + atalhos
  às bibliotecas), **Inspetor** (propriedades por tipo de shape; sem comandos), **🧭
  Copiloto** (lint atual + card da Descoberta; badge com nº de achados).
- Sem seleção → Inspetor mostra propriedades do canvas/estudo com dica.
- Comando "🧭 Copiloto" da aba Analisar foca a aba Copiloto do painel.
- Persistir `rightPanelMode: 'assets' | 'inspector' | 'copilot'`; respeitar `panelCollapsed`.

**Prompt**:
```
Vamos à Sessão 6 da evolução de UX (painel direito), conforme
docs/wiki/Ribbon-Prompts-Sessoes.md (v2) — a seção "Painel direito" é normativa. NÃO mova
a posição do painel — permanece à direita, com o panelCollapsed existente. Divida o
painel em 3 abas: Ativos (lista de bases carregadas com ✏️/✕ atuais + Variáveis de
Decisão com busca, chips arrastáveis e ✏️ de cluster/faixas + atalhos às bibliotecas de
Cineminha e Políticas), Inspetor (PROPRIEDADES do objeto selecionado, NÃO comandos:
losango — label, variável, resumo do domínio, chegadas via nodeArrivals; Cineminha —
tipo, rowVar/colVar, grade, células travadas; Lens — regras e população; terminal — tipo
e volume; frame — label; editável onde já havia edição inline, senão read-only; sem
seleção → propriedades do canvas/estudo com dica) e 🧭 Copiloto (o lint estrutural atual
com achados/ir-até-o-nó/quick-fixes + o card da Descoberta; badge com nº de achados no
título da aba). O comando "🧭 Copiloto" da aba Analisar do Ribbon foca essa aba. O drag
de chips para o canvas continua funcionando idêntico (startPanelDrag). Persista
rightPanelMode ('assets'|'inspector'|'copilot') em sessionStorage + .credito.json (bump
de schema, restore defensivo). Ao fim, app 100% funcional e npm test verde.
```

**Checklist**:
- [x] 3 abas; posição e colapso inalterados; drag de chips intacto
- [x] Ativos = bases + variáveis (com editores ✏️) + bibliotecas
- [x] Inspetor = propriedades por tipo (sem comandos); estado sem seleção tratado
- [x] Copiloto = lint + Descoberta, com badge; comando do Ribbon foca a aba
- [x] `rightPanelMode` persistido; `panelCollapsed` respeitado
- [x] `npm test` verde; app funcional

> **Entregue (2026-07-20).** Estado de topo `rightPanelMode: 'assets' | 'inspector' |
> 'copilot'` (init de `sessionStorage['right_panel_mode_v1']`, default `'assets'`) +
> persistência no `.credito.json` (bump `schemaVersion 3.0 → 3.1`, restore defensivo). O
> painel **não mudou de posição** (segue à direita, mesmo `panelCollapsed`); ganhou uma
> faixa de 3 abas internas abaixo do header. **Ativos** = bases carregadas (✏️/✕) +
> Variáveis de Decisão (busca + chips arrastáveis via `startPanelDrag` intacto + ✏️ de
> cluster/faixas) + atalhos às bibliotecas de Cineminha/Políticas. **Inspetor** =
> `renderInspector()`, propriedades read-only por tipo (losango/Cineminha/Lens/terminal/
> frame/multi/estudo), com o rótulo editável reusando `setShapes`+`pushHistory`; terminal
> soma o volume de entrada do `edgeStats`; sem seleção mostra propriedades do estudo com
> dica. **🧭 Copiloto** = o lint estrutural + card da Descoberta migrados como estavam,
> com badge de `copilotFindings.length` no título da aba; o comando `analyze.copilot` da
> aba Analisar agora faz `setRightPanelMode('copilot')` além de reabrir o painel. Avisos de
> Projeto/Fluxo e inputs de arquivo ficaram fora das abas (sempre montados no topo do
> corpo). Sem mudança de matemática/motor → GATEs numéricos intocados.

---

## Sessão 7 — Busca de comandos (Ctrl+K / "Diga-me")

**Modelo**: 🏷️ `Sonnet 5` — consome o registro pronto; zero dependência nova.

**Pré-requisitos**: Sessões 1–2 (registro completo com contextuais). Pode rodar em paralelo com 5–6.

**O que vai entregar**:
- Popover de busca conforme a especificação: `Ctrl+K` + campo "Pesquisar comando…" na
  faixa de abas; busca fuzzy com normalização de acentos sobre `label`+`keywords`;
  respeita `enabledWhen` (desabilitado = acinzentado com motivo) e `contextWhen` (fora de
  contexto não aparece); Enter executa, Esc fecha; mostra atalhos.

**Prompt**:
```
Vamos à Sessão 7 da evolução de UX (Busca de comandos), conforme
docs/wiki/Ribbon-Prompts-Sessoes.md (v2) — a seção "Busca de comandos" é normativa.
Implemente o popover de busca consumindo o registro COMMANDS: atalho Ctrl+K e campo
compacto "Pesquisar comando…" na faixa de abas do Ribbon (à esquerda do ⚙). Busca fuzzy
simples com normalização de acentos (reuse o padrão da busca de variáveis do painel)
sobre label + keywords. Comando cujo contextWhen não bate com a seleção atual NÃO
aparece; comando com enabledWhen falso aparece acinzentado com o motivo curto (ex.:
"requer 2+ Cineminhas selecionados"). Enter executa onRun e fecha; Esc fecha; setas
navegam; exiba o shortcut quando houver. Renderize num portal (padrão dos dropdowns
existentes). Popule keywords dos descritores existentes com sinônimos pt-BR úteis (ex.:
"binning" → Criar Faixas por Risco; "político/regra" → Políticas). Estado efêmero — nada
a persistir. Ao fim, app 100% funcional e npm test verde.
```

**Checklist**:
- [x] `Ctrl+K` + campo na faixa de abas abrem o popover
- [x] Fuzzy com acentos; keywords pt-BR nos descritores
- [x] Respeita contextWhen/enabledWhen (com motivo)
- [x] Teclado completo (setas/Enter/Esc); atalhos exibidos
- [x] `npm test` verde; app funcional

> **Entregue (2026-07-20).** Estado efêmero `cmdPalette` (`null | {query, activeIndex}`) +
> ref espelho `cmdPaletteR` (padrão de refs do CLAUDE.md — o listener global de teclado usa
> a ref pra ignorar Delete/Backspace/Escape do canvas enquanto o popover está aberto).
> `Ctrl+K` (global, em qualquer aba do app) e o campo compacto "Pesquisar comando… Ctrl+K"
> na faixa de abas do Ribbon (à esquerda do ⚙, some em telas estreitas junto dos outros
> rótulos) chamam `openCmdPalette()`. Componente `CommandPalette` (novo, ao lado de
> `Ribbon`/`StatusBar`) renderizado num portal (`createPortal` sobre `document.body`, mesmo
> padrão dos dropdowns existentes) com backdrop + input autofocado + lista. `cmdPaletteResults`
> filtra `COMMANDS` por completo (fixas + `ctx-*`) pelo mesmo `contextWhen(_ctxSelArg)` já
> usado por `contextCommands` (Sessão 2) — comando fora de contexto nunca aparece. Fuzzy
> simples: mesma normalização de acentos da busca de Variáveis de Decisão do painel
> (`normalize("NFD").replace(...).toLowerCase()`) + substring sobre `label`+`keywords`,
> ranqueado (match exato > prefixo > contém > só keyword). Novo campo `disabledReason`
> (string ou função) nos descritores que têm `enabledWhen` — a Busca mostra o comando
> acinzentado com o motivo curto (ex.: "requer 2+ Cineminhas selecionadas", "nada para
> desfazer"); a Ribbon continua só desabilitando o botão (sem motivo, como antes). Setas
> navegam, Enter executa `onRun` e fecha, Esc fecha, `Ctrl+K` com o popover focado também
> fecha — tudo com `stopPropagation` no próprio input pra nunca vazar pro listener global.
> Keywords ampliadas com sinônimos pt-BR nos descritores existentes (ex.: "binning" já
> apontava pra Criar Faixas por Risco; "político"/"regra" adicionados às 4 entradas da aba
> Política; "diamante", "planilha", "assistente" etc. em outras). Tabela de atalhos do Hub
> (seção ℹ️ Sobre) ganhou a linha `Ctrl+K`. Estado 100% efêmero — nada novo em
> `buildProjectPayload`/`loadProject`, sem bump de schema. Validado ponta a ponta com
> Playwright: abrir via clique e via `Ctrl+K`, busca por keyword sinônimo, navegação/Enter/
> Esc, filtragem por seleção (Cineminha único → "Domínio" aparece, Johnny global aparece
> desabilitado com motivo enquanto o Johnny contextual do nó aparece habilitado).

---

## Sessão 8 — Ergonomia, atalhos, touch e limpeza final

**Modelo**: 🏷️ `Sonnet 5` — aditivo e de limpeza sobre a arquitetura já pronta.

**Pré-requisitos**: Sessões 1–7.

**O que vai entregar**:
- **Mini-flutuante de seleção**: perto do shape selecionado, só **Deletar** e **Duplicar**.
- Auditoria de **atalhos** (Ctrl+Z/Y/Del preservados; Ctrl+K/Ctrl+, novos; documentar na
  seção Sobre do Hub).
- **Remoção de código morto** das toolbars antigas, seções antigas do painel e caminhos
  duplicados deixados pelas sessões anteriores.
- **Touch/mobile**: em tela estreita, o Ribbon assume `compact` por padrão; a hotzone de
  `auto` funciona por toque; QAT e ⚙ acessíveis; card de "Dicas" do canto vira item da
  seção Sobre (ou tooltip do ⚙) para liberar espaço em tela pequena.
- Passada final de UX: fluidez de desfazer/refazer/deletar em qualquer modo do Ribbon.

**Prompt**:
```
Vamos à Sessão 8 da evolução de UX (ergonomia + limpeza + touch), conforme
docs/wiki/Ribbon-Prompts-Sessoes.md (v2). Releia o documento e o CLAUDE.md. Implemente o
mini-flutuante de seleção (só Deletar e Duplicar, perto do shape selecionado). Audite e
documente os atalhos na seção Sobre do Hub (Ctrl+Z/Y/Del preservados; Ctrl+K busca;
Ctrl+, Configurações). Remova código morto das toolbars antigas, das seções antigas do
painel e de quaisquer caminhos duplicados deixados pelas sessões anteriores (sem alterar
comportamento). Trate touch/mobile: em tela estreita o Ribbon assume compact por padrão,
a hotzone do modo auto responde a toque, QAT e ⚙ ficam acessíveis, e o card de Dicas do
canto do canvas migra para a seção Sobre do Hub em telas pequenas. Faça uma passada final
de fluidez: Desfazer/Refazer/Deletar a um toque em qualquer ribbonMode. Nenhuma feature
de domínio nova. Ao fim, app 100% funcional, npm test verde e sem código morto.
```

**Checklist**:
- [ ] Mini-flutuante de Deletar/Duplicar na seleção
- [ ] Atalhos auditados e documentados no Hub (Sobre)
- [ ] Código morto das toolbars/seções antigas removido
- [ ] Touch/mobile: `compact` por padrão em tela estreita; hotzone por toque; QAT + ⚙ acessíveis
- [ ] Fluidez de desfazer/refazer/deletar em todos os modos
- [ ] `npm test` verde; app funcional e sem código morto

---

## Checklist de Execução

- [x] **Sessão 1** — Registro de Comandos + casca do Ribbon (fixed) 🏷️ `Opus 4.8`
- [x] **Sessão 2** — Abas contextuais + fim das toolbars flutuantes 🏷️ `Opus 4.8`
- [x] **Sessão 3** — ⚙ Hub de Configurações 🏷️ `Opus 4.8`
- [x] **Sessão 4** — Colapso em 3 estados 🏷️ `Opus 4.8`
- [x] **Sessão 5** — Status Bar + realocação de badges 🏷️ `Sonnet 5`
- [x] **Sessão 6** — Painel: Ativos/Inspetor/Copiloto 🏷️ `Opus 4.8` → `Sonnet 5`
- [x] **Sessão 7** — Busca de comandos (Ctrl+K) 🏷️ `Sonnet 5`
- [ ] **Sessão 8** — Ergonomia + atalhos + touch + limpeza 🏷️ `Sonnet 5`

---

## Resumo das Dependências

```
Sessão 1 (Registro + Ribbon fixed)
    ↓
Sessão 2 (Abas contextuais) ← consome contextWhen do registro
    ↓
Sessão 3 (⚙ Hub de Configurações) ← aba Projeto existe; painel esvaziado de comandos
    ↓
Sessão 4 (Colapso 3 estados) ← Ribbon estável; controle espelhado no Hub
    ↓
Sessão 5 (Status Bar) ← badge 🐍 abre o Hub (S3); zona fixa precisa do Hub
    ↓
Sessão 6 (Ativos/Inspetor/Copiloto) ← painel já só tem o que resta após S1/S3
    ↓
Sessão 7 (Busca Ctrl+K) ← registro completo (S1–S2); paralelizável com S5–S6
    ↓
Sessão 8 (Ergonomia + limpeza) ← remove o que as anteriores tornaram morto
```

---

## Padrões Gerais

Cada sessão segue o mesmo template:

1. **Leia** este documento (seções de design são normativas) e o `CLAUDE.md`; localize
   código por **âncora de texto**, não por número de linha.
2. **Reutilize** o que já existe (registro, padrões de modal/portal, `sessionStorage`,
   `buildProjectPayload`).
3. **Não** altere a matemática do motor de simulação, viewport ou `autoLayout` — se um
   GATE numérico falhar, pare e investigue (skill `gates-testes`).
4. **Persistência**: todo estado configurável entra em `sessionStorage` + `.credito.json`
   (⚠️ regra do CLAUDE.md: `buildProjectPayload` + `loadProject` com default defensivo +
   bump de `schemaVersion` — base atual **`"2.7"`**, subir 0.1 por sessão que adicionar
   campo persistido).
5. **Teste**: `npm test` verde ao fim; app 100% funcional, sem migração visível pela metade.
6. **Freeze**: nenhuma feature de domínio nova (ver *Regra de Congelamento*); preferência
   nova nasce no Hub; comando novo nasce como descritor.

---

**Última atualização**: 2026-07-20 (v2 — reavaliação completa pós-Épicos FR/GS/H4–H8:
inventário de 12 superfícies, abas Analisar/Otimizar separadas, Hub de Configurações,
Busca de comandos e painel Ativos/Inspetor/Copiloto. **Sessões 1–7 entregues**
(registro `COMMANDS` + Ribbon fixed; abas contextuais + aposentadoria das 6 toolbars
flutuantes; ⚙ Hub de Configurações; colapso do Ribbon em 3 estados — `ribbonMode`,
schema 2.9; Status Bar configurável + realocação de badges — `statusBarIndicators`,
schema 3.0; painel direito em 3 abas Ativos/Inspetor/Copiloto — `rightPanelMode`,
schema 3.1; Busca de comandos Ctrl+K — `cmdPalette` efêmero, sem bump de schema);
Sessão 8 aguardando desenvolvimento. A v1, de 2026-07-09, nunca foi executada e está
substituída por esta.)
