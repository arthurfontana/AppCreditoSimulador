# Ribbon UI — Prompts de Todas as Sessões

> **Objetivo**: migrar a UI de "ações espalhadas entre toolbar, painel direito e toolbar
> flutuante de contexto" para uma **Ribbon** (abas por intenção + abas contextuais que
> surgem conforme a seleção), um **Inspector/Assets** à direita, uma **Status Bar**
> configurável embaixo e um Ribbon **colapsável em 3 estados**. Sem adicionar features de
> domínio — é uma evolução de **arquitetura de experiência**.
>
> **Ordem de execução**: Sessão 1 → 2 → 3 → 4 → 5 → 6 (estritamente incremental — cada
> sessão termina com o app 100% funcional, testes verdes e nenhuma migração pela metade
> visível ao usuário).
>
> **Referência**: `CLAUDE.md` (seções *Reorganização Automática*, *Estado principal*,
> *Salvar / Abrir Projeto*, *Auto-persistência de sessão*, *Painel direito colapsável*) +
> este documento (as seções de design abaixo são normativas — leia antes de qualquer sessão).
>
> **🏷️ Tag de modelo**: cada sessão indica o modelo recomendado — `Opus 4.8`
> (`claude-opus-4-8`) para refatoração estrutural no monólito, threading de estado/refs e
> matemática de viewport; `Sonnet 5` (`claude-sonnet-5`) para trabalho aditivo, orientado a
> template, sobre padrões já consolidados.

---

## Visão e princípios de execução

Hoje os comandos vivem em **três lugares** (evidência no código):

- **Toolbar de topo** (`src/App.jsx` ~8588–8635): ferramentas, desfazer/refazer, ⊹ Reorganizar, cor, deletar, alinhamento.
- **Toolbar flutuante de contexto** (~8621–8864): aparece com a seleção — `⚙ Domínio`, `⚙ Otimizar Decisão`, `⚡ Otimização Johnny`, travar 🔒, terminais.
- **Seção "Fluxo" do painel direito** (~9339–9389): `📚 Políticas`, `🎯 Atingir Objetivo`, `🧹 Simplificar`, `📄 Documentar Política`, `🔍 Descobrir Segmentos`, ⬇⬆ Exportar/Importar Fluxo.

A migração converge tudo isso num **registro declarativo de comandos** (fonte única) que a
Ribbon, as abas contextuais e a Status Bar renderizam. Princípios:

1. **Incremental e reversível**: cada sessão é um PR fechado, com o app funcionando ao fim.
2. **Extrair antes de mover**: primeiro o registro (Sessão 1), depois a UI consome dele.
3. **Não-destrutivo com o motor**: nada de simulação/viewport/`autoLayout` muda de matemática.
4. **Persistência obrigatória**: todo estado configurável pelo usuário entra em
   `sessionStorage` + `.credito.json` (ver a ⚠️ regra do CLAUDE.md), com bump de `schemaVersion`.
5. **Sem features novas de domínio** durante a migração (ver *Regra de Congelamento*).

---

## ⚠️ Regra de Congelamento (Freeze) durante a migração

A migração depende de **extrair TODO comando para o registro**. Se um comando novo entrar
pelo padrão antigo (um `<button onClick>` inline solto) no meio da migração, ele **escapa
do registro** e reintroduz exatamente a fragmentação que estamos removendo.

Regra em vigor da Sessão 1 até a Sessão 6:

- ✅ **Correção de bug** pode.
- ⚠️ **Feature nova de domínio** só se for **inevitável** — e então **obrigatoriamente** adicionada como **descritor no registro** (o jeito novo), nunca como botão solto.
- 🚫 Fora isso, **segure** features novas até fechar a Sessão 6.

---

## 🏷️ Como escolher Opus vs Sonnet

Use **`Opus 4.8`** quando a tarefa:
- mexe em **estado/refs compartilhados** no monólito (`src/App.jsx`, ~11k linhas) e precisa preservar condições exatas de enable/disable e contexto de seleção;
- toca **matemática de viewport/zoom/posicionamento** (`svgPt`/`toWorld`/`doZoom`/`autoLayout`);
- é a **primeira fiação** de um padrão novo (o registro, a aba contextual, o Inspector).

Use **`Sonnet 5`** quando a tarefa é **aditiva e orientada a template** sobre um padrão já
pronto e testado:
- adicionar **descritores de comando** ao registro;
- adicionar **campos ao Inspector** por tipo de shape;
- adicionar **indicadores à Status Bar**;
- limpeza de código morto e ajustes de estilo.

---

## 🧭 Invariante de posicionamento — LEIA ANTES DA SESSÃO 3

A conversão tela→mundo **lê `getBoundingClientRect()` ao vivo** a cada gesto — **não há
offset fixo do topo**:

```js
const getBR   = () => svgRef.current.getBoundingClientRect();       // ~4592
const svgPt   = (cx,cy) => { const r=getBR(); return [cx-r.left, cy-r.top]; };
const toWorld = (sx,sy) => { const {x,y,s}=vpR.current; return [(sx-x)/s,(sy-y)/s]; };
```

`autoLayout` e o "centralizar" leem `svgEl.clientWidth/clientHeight` ao vivo (~5661, ~6429).
Consequências **normativas** para o colapso do Ribbon:

- **Estados que empurram o canvas (reflow)** — `fixed` e `compact`: a conversão **se
  autocorrige sozinha**, porque `rect.top`/altura mudam junto. Seguros por construção.
- **Estado de revelação por hover** — o Ribbon revelado **NUNCA pode empurrar o canvas**.
  Deve ser um **overlay `position:absolute`** (z-index alto) por cima do canvas, aparecendo
  e sumindo **sem reflow**. Como não altera o `rect` do SVG, há **zero recálculo** de
  viewport/layout — atendendo à exigência de "não deve ter muitos recálculos".
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

- A **QAT** (ver abaixo) permanece visível nos **três** modos.
- Persistir `ribbonMode` em `sessionStorage` + `.credito.json` (bump de schema).
- A animação de aparecer/sumir do overlay é puramente CSS (opacity/transform) — não dispara
  recomputação de viewport.

---

## 🗺️ Mapa das abas do Ribbon (só comandos que já existem)

Desenhe pelo que existe hoje — **sem abas fantasma**. As abas crescem quando features novas chegarem.

| Aba | Grupos → comandos (todos já no código) |
|-----|------|
| **Início** | *Edição*: selecionar/mão · desfazer · refazer · deletar · duplicar · *Organizar*: alinhar · ⊹ Reorganizar · cor · *Ver*: zoom +/− · centralizar |
| **Inserir** | *Nós*: losango (decision) · Cineminha · Decision Lens · frame · *Terminais*: Aprovado · Reprovado · AS IS |
| **Dados** | Importar CSV · gerenciar bases · config AS IS · tipos de coluna |
| **Otimizar** | 🎯 Atingir Objetivo · 🧹 Simplificar · 🔍 Descobrir Segmentos · ⚡ Johnny (2+ Cineminhas) |
| **Política** | 📚 Biblioteca de Políticas · 📄 Documentar · ⬇⬆ Exportar/Importar Fluxo · JSON canônico (PolicyIR) |
| **Projeto** | 💾 Salvar Projeto · 📁 Abrir Projeto · alternar Dashboard/Canvas |
| *contextual* → **Matriz** | (Cineminha selecionado) ⚙ Domínio · ⚙ Otimizar Decisão · ⚡ Johnny · 🔒 Travar · biblioteca |
| *contextual* → **Decisão** | (losango selecionado) ⚙ Domínio · 🔒 Travar · sugerir próximo passo |
| *contextual* → **Lens** | (Decision Lens selecionado) editar regras · 🔒 Travar |

As abas contextuais aparecem **destacadas** só com o tipo correspondente selecionado
(padrão "Contextual Tabs" do Office) e são um **filtro** do registro por
`contextWhen(selection)`.

---

## ⚡ Barra de Acesso Rápido (QAT) e ergonomia

Ergonomia delegada e fechada assim (undo/redo/delete **sempre** a um clique):

- **QAT** — faixa fininha fixa num canto do Ribbon, **sobrevive aos 3 modos** de colapso
  (visível mesmo em `compact`/`auto`): **Desfazer**, **Refazer** e **Deletar** (Deletar
  aparece só com seleção). Não faz parte do conteúdo colapsável.
- **Mini-flutuante de seleção** — perto do shape selecionado, só **Deletar** e **Duplicar**
  (ergonomia de mão). Introduzido na Sessão 6.
- **Atalhos** existentes preservados: `Ctrl+Z`/`Ctrl+Y`/`Del`.

---

## Sessão 1 — Command Registry + casca do Ribbon (modo `fixed`)

**Modelo**: 🏷️ `Opus 4.8` — threading de estado/refs no monólito, preservar enable/disable e contexto exatos; matemática de reflow do canvas.

**Pré-requisitos**: Nenhum (é a base).

**O que vai entregar**:
- **Registro declarativo** `COMMANDS` — array de descritores `{id, label, icon, tab, group, contextWhen, enabledWhen, onRun}` (fonte única). `contextWhen(selection)` = `null` para comando global, ou predicado por tipo de shape.
- Componente **`Ribbon`** que renderiza abas *Início/Inserir/Dados/Otimizar/Política/Projeto* a partir do registro (só modo `fixed` nesta sessão).
- **Migração** dos comandos da toolbar de topo e da seção "Fluxo" do painel direito para a Ribbon (a seção "Fluxo" some do painel; a toolbar flutuante de contexto **fica como está** por ora — migra na Sessão 2).
- Reflow correto do canvas com o Ribbon ocupando altura (verificar `svgPt`/`toWorld`/`autoLayout` intactos — invariante acima).
- Persistir `ribbonActiveTab` (`sessionStorage` + `.credito.json`, bump de schema).

**Prompt**:
```
Vamos à Sessão 1 do redesenho de Ribbon, conforme docs/wiki/Ribbon-Prompts-Sessoes.md.
Releia esse documento (seções de design são normativas) e o CLAUDE.md antes de propor.
Implemente: (1) um registro declarativo COMMANDS em src/App.jsx — array de descritores
{id, label, icon, tab, group, contextWhen, enabledWhen, onRun} como FONTE ÚNICA dos
comandos, cobrindo exatamente os comandos que já existem na toolbar de topo (~8588–8635) e
na seção "Fluxo" do painel direito (~9339–9389: Políticas, Atingir Objetivo, Simplificar,
Documentar Política, Descobrir Segmentos, Exportar/Importar Fluxo); (2) um componente
Ribbon que renderiza as abas Início/Inserir/Dados/Otimizar/Política/Projeto a partir do
registro (só o modo fixed nesta sessão) seguindo o "Mapa das abas" do documento; (3)
mova esses comandos para a Ribbon e REMOVA a seção "Fluxo" do painel direito (a toolbar
flutuante de contexto fica intocada — migra na Sessão 2). Preserve enable/disable e o
contexto de seleção EXATOS de cada comando. Garanta o reflow correto do canvas com o
Ribbon ocupando altura — NÃO altere svgPt/toWorld/doZoom/autoLayout (a conversão já lê
getBoundingClientRect ao vivo; confirme). Persista ribbonActiveTab em sessionStorage
(nova chave) e no .credito.json (buildProjectPayload + loadProject com default defensivo +
bump de schemaVersion). Nenhuma feature de domínio nova. Ao fim, app 100% funcional e
npm test verde.
```

**Checklist**:
- [ ] `COMMANDS` cobre todos os comandos da toolbar de topo + seção "Fluxo"
- [ ] `Ribbon` renderiza as 6 abas a partir do registro
- [ ] Seção "Fluxo" removida do painel direito; nenhum comando perdido
- [ ] Toolbar flutuante de contexto **inalterada**
- [ ] Reflow do canvas correto; clique/drag/zoom sem desvio (invariante de posicionamento)
- [ ] `ribbonActiveTab` persistido (sessionStorage + `.credito.json` + bump de schema + restore defensivo)
- [ ] `npm test` verde; app funcional

---

## Sessão 2 — Abas contextuais (Matriz / Decisão / Lens)

**Modelo**: 🏷️ `Opus 4.8` — lógica de seleção→contexto (a primeira fiação); *adicionar* novas abas contextuais depois é `Sonnet 5`.

**Pré-requisitos**: Sessão 1 (registro + Ribbon).

**O que vai entregar**:
- Abas contextuais **Matriz/Decisão/Lens** que surgem destacadas conforme o tipo do shape selecionado (filtro do registro por `contextWhen(selection)`), com auto-ativação da aba ao selecionar.
- Migração do conteúdo da **toolbar flutuante de contexto** (~8621–8864) para essas abas: Domínio, Otimizar Decisão, Johnny, Travar 🔒, biblioteca, terminais.
- Aposentar a toolbar flutuante de contexto (o mini-flutuante ergonômico de Deletar/Duplicar vem só na Sessão 6).
- Multi-seleção: manter os comandos que hoje aparecem com 2+ Cineminhas (Johnny) e com múltiplos shapes (alinhar/deletar em massa).

**Prompt**:
```
Vamos à Sessão 2 do redesenho de Ribbon, conforme docs/wiki/Ribbon-Prompts-Sessoes.md.
A Sessão 1 entregou o registro COMMANDS e a Ribbon (modo fixed). Releia o documento e o
CLAUDE.md. Implemente as abas contextuais Matriz/Decisão/Lens: elas surgem destacadas
(padrão "Contextual Tabs") só quando um shape do tipo correspondente está selecionado,
via contextWhen(selection) do registro, com auto-ativação da aba contextual ao selecionar.
Migre TODO o conteúdo da toolbar flutuante de contexto (~8621–8864: ⚙ Domínio, ⚙ Otimizar
Decisão, ⚡ Johnny, travar 🔒, biblioteca de Cineminha, terminais) para as abas contextuais
e aposente a toolbar flutuante (o mini-flutuante de Deletar/Duplicar vem na Sessão 6).
Preserve o comportamento de multi-seleção (Johnny com 2+ Cineminhas; alinhar/deletar em
massa). Preserve enable/disable exatos. Nenhuma feature nova. Ao fim, app 100% funcional
e npm test verde.
```

**Checklist**:
- [ ] Abas contextuais aparecem/somem corretamente por tipo de shape
- [ ] Auto-ativação da aba contextual ao selecionar
- [ ] Todo comando da toolbar flutuante migrado; nenhum perdido
- [ ] Multi-seleção (Johnny 2+, alinhar/deletar) preservada
- [ ] Toolbar flutuante de contexto removida
- [ ] `npm test` verde; app funcional

---

## Sessão 3 — Colapso do Ribbon em 3 estados

**Modelo**: 🏷️ `Opus 4.8` — sensível a viewport/zoom; o overlay é invariante crítico.

**Pré-requisitos**: Sessões 1–2.

**O que vai entregar**:
- `ribbonMode: 'fixed' | 'compact' | 'auto'` conforme a *Especificação do colapso* deste documento.
- Botão de ciclo + duplo-clique na aba ativa para alternar.
- `fixed`/`compact` reflowam; `auto` e a revelação de `compact` são **overlay `position:absolute` sem reflow**.
- QAT visível nos 3 modos.
- Persistir `ribbonMode` (`sessionStorage` + `.credito.json`, bump de schema).
- Se houver cache de rect em algum lugar, invalidação via `ResizeObserver` no container do SVG.

**Prompt**:
```
Vamos à Sessão 3 do redesenho de Ribbon, conforme docs/wiki/Ribbon-Prompts-Sessoes.md.
Releia a seção "Invariante de posicionamento" e "Especificação do colapso em 3 estados" —
são normativas. Implemente ribbonMode com três valores: fixed (Ribbon inteiro, reflowa o
canvas), compact (só a faixa de abas fixa reflowa; clicar/hover numa aba abre os grupos
como OVERLAY temporário sem reflow) e auto (Ribbon oculto exceto uma hotzone de ~6px no
topo; hover faz o Ribbon inteiro surgir como OVERLAY sem reflow, sai → some). Alternância
por botão de ciclo e por duplo-clique na aba ativa. REGRA CRÍTICA: qualquer conteúdo
revelado por hover é position:absolute por cima do canvas, NUNCA empurra o SVG (zero
reflow/recalcs). Confirme que svgPt/toWorld continuam lendo getBoundingClientRect ao vivo;
se existir cache de rect, invalide via ResizeObserver no container do SVG a cada mudança de
ribbonMode. A QAT (Desfazer/Refazer/Deletar) permanece visível nos 3 modos. Persista
ribbonMode em sessionStorage + .credito.json (bump de schema, restore defensivo). Teste os
3 modos com base carregada: clique/drag/zoom sem desvio; o modo auto não dispara recomputo
de viewport ao revelar. Ao fim, app 100% funcional e npm test verde.
```

**Checklist**:
- [ ] 3 modos implementados e alternáveis (botão + duplo-clique)
- [ ] `fixed`/`compact` reflowam; revelação de `compact` e `auto` são overlay **sem reflow**
- [ ] Clique/drag/zoom sem desvio nos 3 modos (base grande carregada)
- [ ] `auto` não dispara recomputo de viewport ao revelar
- [ ] QAT visível nos 3 modos
- [ ] `ribbonMode` persistido (bump de schema, restore defensivo)
- [ ] `npm test` verde; app funcional

---

## Sessão 4 — Status Bar configurável (estilo Excel)

**Modelo**: 🏷️ `Sonnet 5` — aditivo/template sobre padrões prontos; `Opus 4.8` só para revisar o bump de schema/persistência.

**Pré-requisitos**: Sessões 1–3.

**O que vai entregar**:
- **Status Bar** inferior (faixa fina) exibindo indicadores simples da seleção/simulação — modelo "soma automática" do Excel.
- **Configuração pelo usuário**: engrenagem/clique-direito na barra → escolher **quais** indicadores aparecem (evita poluição de KPI).
- Migrar/espelhar os `SimIndicators` (Taxa de Aprovação, Inad. Real, Inad. Inferida) para lá; incluir indicadores de seleção (ex.: nº de shapes selecionados, soma de volume que chega ao nó selecionado via `nodeArrivals`).
- Persistir a lista escolhida `statusBarIndicators` (`sessionStorage` + `.credito.json`, bump de schema).

**Prompt**:
```
Vamos à Sessão 4 do redesenho de Ribbon, conforme docs/wiki/Ribbon-Prompts-Sessoes.md.
Releia o documento e o CLAUDE.md. Implemente uma Status Bar inferior (faixa fina) no
estilo "soma automática" do Excel: mostra indicadores simples da simulação e da seleção
atual. Migre/espelhe os SimIndicators (Taxa de Aprovação, Inad. Real, Inad. Inferida, do
incrementalResult/simResult) para lá e adicione indicadores de seleção (nº de shapes
selecionados; volume que chega ao nó selecionado via nodeArrivals). Adicione uma
engrenagem (e menu de clique-direito) na barra para o usuário ESCOLHER quais indicadores
aparecem — a lista fica enxuta e customizável. Persista statusBarIndicators em
sessionStorage (nova chave) e no .credito.json (buildProjectPayload + loadProject com
default defensivo + bump de schema). Respeite a matemática existente dos indicadores (sem
mudar denominadores/contratos de GATE). Ao fim, app 100% funcional e npm test verde.
```

**Checklist**:
- [ ] Status Bar renderiza indicadores simples; atualiza com simulação/seleção
- [ ] Menu de configuração (engrenagem + clique-direito) escolhe quais indicadores aparecem
- [ ] `SimIndicators` migrados/espelhados; matemática inalterada
- [ ] `statusBarIndicators` persistido (bump de schema, restore defensivo)
- [ ] `npm test` verde; app funcional

---

## Sessão 5 — Inspector + Assets (split do painel direito)

**Modelo**: 🏷️ `Opus 4.8` para a fiação inicial (seleção→Inspector); depois *adicionar campos por tipo de shape* é `Sonnet 5`.

**Pré-requisitos**: Sessões 1–4. **Não** mover a posição do painel (fica à direita — decisão do usuário).

**O que vai entregar**:
- Painel direito com **duas abas**: **Assets** e **Inspector** (posição inalterada, à direita).
  - **Assets**: chips de variável arrastáveis (o que já existe) + acesso às bibliotecas (Cineminha/Políticas) — "recursos do projeto".
  - **Inspector**: **propriedades do objeto selecionado** (não comandos — comandos estão na Ribbon). Ex.: nome/label, tipo, variável/eixos, resumo de domínio, regras (lens), nº de chegadas. Campos read-only ou editáveis onde já havia edição.
- Sem seleção → Inspector mostra propriedades do canvas/estudo (ou fica vazio com dica).
- Persistir a aba ativa do painel `rightPanelMode: 'assets' | 'inspector'` (`sessionStorage` + `.credito.json`, bump de schema). Respeitar o `panelCollapsed` existente.

**Prompt**:
```
Vamos à Sessão 5 do redesenho de Ribbon, conforme docs/wiki/Ribbon-Prompts-Sessoes.md.
Releia o documento e o CLAUDE.md. NÃO mova a posição do painel — ele permanece à direita.
Divida o painel direito em duas abas: Assets e Inspector. Assets = os chips de variável
arrastáveis já existentes + atalho para as bibliotecas (Cineminha/Políticas), como
"recursos do projeto". Inspector = PROPRIEDADES do objeto selecionado (NÃO comandos — os
comandos estão na Ribbon): para losango (label, variável, resumo do domínio, nº de
chegadas via nodeArrivals), Cineminha (tipo, rowVar/colVar, tamanho da grade, células
bloqueadas), Decision Lens (regras, população que passa), terminais (tipo). Onde já havia
edição inline, mantenha editável; senão, read-only. Sem seleção, o Inspector mostra
propriedades do estudo/canvas ou um estado vazio com dica. Persista rightPanelMode
('assets'|'inspector') em sessionStorage + .credito.json (bump de schema, restore
defensivo) e respeite o panelCollapsed existente. Ao fim, app 100% funcional e npm test
verde.
```

**Checklist**:
- [ ] Painel direito com abas Assets/Inspector; posição inalterada
- [ ] Assets = chips de variável + bibliotecas
- [ ] Inspector = propriedades por tipo de shape (sem comandos)
- [ ] Estado sem seleção tratado
- [ ] `rightPanelMode` persistido; `panelCollapsed` respeitado
- [ ] `npm test` verde; app funcional

---

## Sessão 6 — Ergonomia, limpeza e touch

**Modelo**: 🏷️ `Sonnet 5` — aditivo e de limpeza sobre a arquitetura já pronta.

**Pré-requisitos**: Sessões 1–5.

**O que vai entregar**:
- **Mini-flutuante de seleção**: perto do shape selecionado, só **Deletar** e **Duplicar**.
- Auditoria de **atalhos** (Ctrl+Z/Y/Del preservados; documentar).
- **Remoção de código morto** das toolbars antigas e de quaisquer caminhos duplicados deixados pelas sessões anteriores.
- **Touch/mobile**: em tela estreita, o Ribbon assume um modo compacto/colapsado por padrão; a hotzone de `auto` funciona por toque; QAT acessível.
- Passada final de UX: fluidez de desfazer/refazer/deletar em qualquer modo do Ribbon.

**Prompt**:
```
Vamos à Sessão 6 do redesenho de Ribbon (ergonomia + limpeza + touch), conforme
docs/wiki/Ribbon-Prompts-Sessoes.md. Releia o documento e o CLAUDE.md. Implemente o
mini-flutuante de seleção (só Deletar e Duplicar, perto do shape selecionado). Audite e
documente os atalhos (Ctrl+Z/Y/Del preservados). Remova código morto das toolbars antigas
e quaisquer caminhos duplicados deixados pelas sessões anteriores (sem alterar
comportamento). Trate touch/mobile: em tela estreita o Ribbon assume modo compacto por
padrão, a hotzone do modo auto responde a toque, e a QAT fica acessível. Faça uma passada
final de fluidez: Desfazer/Refazer/Deletar a um toque em qualquer ribbonMode. Nenhuma
feature de domínio nova. Ao fim, app 100% funcional, npm test verde e sem código morto.
```

**Checklist**:
- [ ] Mini-flutuante de Deletar/Duplicar na seleção
- [ ] Atalhos auditados e documentados
- [ ] Código morto das toolbars antigas removido
- [ ] Touch/mobile: Ribbon compacto por padrão em tela estreita; hotzone por toque; QAT acessível
- [ ] Fluidez de desfazer/refazer/deletar em todos os modos
- [ ] `npm test` verde; app funcional e sem código morto

---

## Checklist de Execução

- [ ] **Sessão 1** — Command Registry + casca do Ribbon (fixed) 🏷️ `Opus 4.8`
- [ ] **Sessão 2** — Abas contextuais (Matriz/Decisão/Lens) 🏷️ `Opus 4.8`
- [ ] **Sessão 3** — Colapso em 3 estados 🏷️ `Opus 4.8`
- [ ] **Sessão 4** — Status Bar configurável 🏷️ `Sonnet 5`
- [ ] **Sessão 5** — Inspector + Assets 🏷️ `Opus 4.8` → `Sonnet 5`
- [ ] **Sessão 6** — Ergonomia + limpeza + touch 🏷️ `Sonnet 5`

---

## Resumo das Dependências

```
Sessão 1 (Registro + Ribbon fixed)
    ↓
Sessão 2 (Abas contextuais) ← consome contextWhen do registro
    ↓
Sessão 3 (Colapso 3 estados) ← precisa da Ribbon estável
    ↓
Sessão 4 (Status Bar) ← independente da 3, mas ordenada aqui por segurança
    ↓
Sessão 5 (Inspector/Assets) ← seleção já bem definida pelas 1–2
    ↓
Sessão 6 (Ergonomia + limpeza) ← remove o que as anteriores tornaram morto
```

---

## Padrões Gerais

Cada sessão segue o mesmo template:

1. **Leia** este documento (seções de design são normativas) e o `CLAUDE.md`.
2. **Reutilize** o que já existe (registro, padrões de modal, `sessionStorage`, `buildProjectPayload`).
3. **Não** altere a matemática do motor de simulação, viewport ou `autoLayout`.
4. **Persistência**: todo estado configurável entra em `sessionStorage` + `.credito.json`
   (⚠️ regra do CLAUDE.md: `buildProjectPayload` + `loadProject` com default defensivo +
   bump de `schemaVersion` — atual **`"2.5"`**, subir 0.1 por sessão que adicionar campo persistido).
5. **Teste**: `npm test` verde ao fim; app 100% funcional, sem migração visível pela metade.
6. **Freeze**: nenhuma feature de domínio nova (ver *Regra de Congelamento*).

---

**Última atualização**: 2026-07-09 (plano criado — Sessões 1–6 aguardando desenvolvimento)
