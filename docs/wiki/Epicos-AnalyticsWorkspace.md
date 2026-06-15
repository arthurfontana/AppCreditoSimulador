# Épico: Analytics Workspace

## O que é

Uma segunda aba da aplicação — **Análise** — onde o usuário monta dashboards personalizados sobre os resultados das simulações, sem depender de relatórios fixos pré-desenvolvidos.

O paradigma é o de um builder estilo Power BI/Looker Studio, especializado em simulação de políticas de crédito: o usuário arrasta componentes visuais para a página, configura dimensões e métricas, e visualiza os resultados da simulação de forma livre.

Isso substitui a estratégia de "criar relatório X, relatório Y, relatório Z" — que escala mal — por um **motor analítico + construtor visual** que os próprios usuários operam.

---

## Motivação

Hoje o simulador cobre bem a construção e execução de políticas. O gargalo é a análise de resultados: cada nova pergunta de negócio ("aprovação por dia", "mix de score dos aprovados", "impacto por safra") exigiria um relatório dedicado. Com múltiplos cenários futuros (A/B/C), isso se torna inviável.

A Analytics Workspace resolve isso estruturalmente.

---

## Navegação

A aplicação passa a ter duas abas (estilo Excel), persistindo o estado de cada uma:

```
[ Análise ] [ Canvas ]
```

A aba **Análise** é a primeira (padrão ao abrir). O **Canvas** existente é a segunda — sem nenhuma mudança em seu comportamento.

---

## Decisões técnicas (travadas)

### DEC-AW-001: Recharts como exceção ao ADR-003

**Decisão:** usar a biblioteca [Recharts](https://recharts.org) para renderização dos gráficos na aba Análise.

**Justificativa:** a aba Análise é DOM/layout — paradigma diferente do Canvas SVG. Recharts é SVG-based, React-first, treeshakeable e elimina semanas de trabalho de eixos, tooltips, legendas e responsividade na mão. Bundle estimado: ~150KB gzipped (aceitável para distribuição local).

**Requisito de build:** Recharts deve estar em `dependencies` no `package.json` (não `devDependencies`). O `build-release.yml` empacota tudo em `release/assets/` — nenhum passo adicional de exportação é necessário.

---

### DEC-AW-002: Pipeline de dados em dois estágios

**Estágio 1 — Worker (1x, assíncrono):** ao terminar cada simulação, o worker emite um **dataset analítico canônico** via nova mensagem `COMPUTE_ANALYTICS_DATASET`. Esse dataset é cacheado no estado principal. Recomputa apenas quando a simulação muda.

**Estágio 2 — Client-side (N×, síncrono):** cada componente de gráfico executa seu próprio **pivot** sobre o dataset cacheado, memoizado por configuração. Trocar dimensão/métrica/filtro re-executa o pivot localmente, sem `postMessage` — latência imperceptível.

**Justificativa:** o dado é pré-sumarizado → pequeno. O gargalo não é a computação do pivot, é a latência de comunicação com o worker para interações de arraste. Worker para a transformação pesada única; client para a reconfiguração leve e frequente.

---

### DEC-AW-003: Formato de armazenamento largo (wide)

O dataset analítico é armazenado em **formato largo**: uma linha por agrupamento do CSV original, com uma coluna de decisão por cenário.

```
// Exemplo de linha no dataset analítico (wide)
{
  // dimensões do CSV original (todas as colunas não-métricas)
  data: "2024-01-15",
  canal: "digital",
  score: "R3",

  // métricas intrínsecas do agrupamento (não mudam por cenário)
  qty: 120,
  qtdAltas: 45,
  inadRRaw: 3.2,

  // decisão por cenário (uma coluna por cenário registrado)
  __DECISAO_AS_IS: "APROVADO",
  __DECISAO_SIMULADO: "APROVADO",
  // futuro: __DECISAO_CENARIO_A, __DECISAO_CENARIO_B, ...
}
```

**Justificativa:** métricas intrínsecas são propriedade do agrupamento, não do cenário — armazena uma vez sem duplicar. Formato ideal para export (original + simulações lado a lado, abrível no Excel).

**Registro de cenários:** um array separado `analyticsScenarios: [{id, nome, decisionCol}]` mantém a fonte de verdade sobre quais colunas de decisão existem. Evita depender de parsing de nomes de coluna.

---

### DEC-AW-004: Cenário como dimensão (na consulta, não no armazenamento)

O armazenamento é largo (wide). Mas na **consulta** para renderização de gráficos, o pivot lê as colunas de cenário e emite tuplas tidy `{x, série, valor}`, onde `série` é o nome do cenário.

Resultado: qualquer componente de gráfico que aceite uma "série" automaticamente suporta N cenários sem código adicional. "Cenário como dimensão" é uma propriedade do pivot, não do storage.

---

### DEC-AW-005: Tipo de coluna `temporal`

O wizard de importação (Passo 2) ganha um novo tipo de coluna: **`temporal`** (`⏱ Data/Tempo`).

Colunas marcadas como `temporal` recebem:
- parsing de data no wizard (formato detectado automaticamente ou selecionado)
- ordenação cronológica correta no eixo X dos gráficos
- eixo contínuo (não categórico) no Recharts

Sem esse tipo, "aprovação por dia" não tem semântica — seria ordenado alfabeticamente. Colunas temporais são de primeira classe no builder, não jogadas no balaio de dimensões categóricas.

---

### DEC-AW-006: Primeiro incremento — AS IS vs Simulado (não N cenários)

O motor de N cenários é um épico futuro. O incremento inicial entrega **2 cenários implícitos** que já existem:
- **AS IS**: decisões históricas (`__DECISAO_ORIGINAL`)
- **Simulado**: decisões da política atual no canvas (`simulationOverlay`)

O `incrementalResult` e o `simulationOverlay` já carregam esses dados. A Sessão 1 constrói o pipeline ponta a ponta com esses dois — AS IS e Simulado viram o "Cenário Base" e "Cenário Simulado" implícitos. O motor de N cenários depois é uma generalização de 2 colunas fixas para N colunas registradas.

---

### DEC-AW-007: Cenário = aba de canvas viva (não snapshot)

**Decisão:** o "Cenário" da Sessão 5 é uma **aba de canvas viva e editável**, não um snapshot congelado. O usuário duplica a aba do Canvas (cada aba é uma política independente), renomeia, e edita livremente. O Dashboard centraliza os resultados de todas as abas marcadas, usando o **nome da aba** como nome do cenário.

**Modelo de estado (não-invasivo):** `shapes`/`conns` continuam sendo o **working copy do canvas ativo** — todo o código atual do canvas (refs espelho, undo/redo, autoLayout, drag) permanece intacto. Um novo store `canvases: {[id]: {id, name, shapes, conns, includeInDashboard}}` + `activeCanvasId` guarda as demais abas. Ao trocar de aba: persiste `shapes`/`conns` no canvas atual e carrega os do alvo. Undo/redo são escopados por canvas.

**Compartilhamento:** `csvStore` (datasets) e `cinemaLibrary` permanecem estado único no topo do `App` — **compartilhados por todas as abas**. Duplicar uma aba não duplica dados nem biblioteca. A reconciliação de dataset (`onImportConfirm`) passa a fazer fan-out para **todos** os canvases.

**Opt-in por aba:** cada canvas tem `includeInDashboard` (toggle na aba). Só as abas marcadas viram cenário no Dashboard. O canvas primário nasce incluído (não quebra o fluxo atual de cenário único); abas de rascunho podem ficar de fora.

**Justificativa:** o modelo vivo entrega "Cenário A vs B vs C" como abas editáveis lado a lado — muito mais útil que snapshots frozen para iteração de política. O working-copy do ativo evita reescrever as ~7900 linhas do canvas.

---

### DEC-AW-008: KPI compara dois cenários selecionáveis (A vs B)

**Decisão:** com N cenários, o KPI card deixa de ter baseline fixa AS IS vs Simulado. Ganha dois seletores — **Baseline (A)** e **Comparação (B)** — que aceitam qualquer cenário registrado, incluindo AS IS. O número grande é B; o delta é `B − A`, colorido por `GOOD_WHEN_LOWER`.

**Default:** A = AS IS, B = primeiro cenário de canvas (preserva a leitura atual "Simulado vs AS IS").

**Justificativa:** "Cenário A vs Cenário B" é o caso de uso executivo central de múltiplos cenários; amarrar em AS IS vs Simulado perderia a comparação entre políticas alternativas.

---

## Tipos de gráfico (escopo das 5 sessões)

| Tipo | Sessão | Caso de uso principal |
|------|--------|----------------------|
| Linha | 1 | Evolução temporal de métricas |
| Barras normais | 3 | Comparação entre categorias |
| Barras 100% empilhadas | 3 | Mix de risco / composição |
| KPI card | 3 | Indicadores executivos pontuais |

Fora de escopo por ora: scatter, heatmap (Cineminha já serve esse papel), pizza.

---

## Schema do dataset analítico (saída do worker)

```js
// Mensagem worker → main
{
  type: "ANALYTICS_RESULT",
  payload: {
    rows: AnalyticsRow[],       // formato largo, uma linha por agrupamento
    dimensions: string[],        // colunas disponíveis como dimensão (não-métricas)
    temporalColumns: string[],   // subconjunto de dimensions com tipo temporal
    metrics: MetricDef[],        // métricas disponíveis para eixo Y
    scenarios: ScenarioDef[],    // [{id, nome, decisionCol}]
  }
}

// MetricDef
{ id: string, label: string, unit: "pct" | "qty" | "ratio" }

// ScenarioDef
{ id: string, nome: string, decisionCol: string }
```

Métricas iniciais disponíveis (derivadas no pivot para o subconjunto de linhas aprovadas):
- `approvalRate` — taxa de aprovação (aprovados / total)
- `inadReal` — inadimplência real ponderada (∑ inadRRaw / ∑ qtdAltas)
- `inadInferida` — inadimplência inferida ponderada
- `qty` — volume total de propostas
- `approvedQty` — volume aprovado

---

## Estrutura de estado (novo estado principal)

```js
// Novo estado em App.jsx
analyticsDataset: null | AnalyticsDataset    // resultado cacheado do worker
analyticsLayout: WidgetConfig[]              // layout do dashboard (persistido)
activeTab: "analysis" | "canvas"            // aba ativa

// WidgetConfig
{
  id: string,
  type: "line" | "bar" | "bar100" | "kpi",
  x, y, w, h,                    // posição e tamanho na página de análise
  config: {
    xDimension: string | null,   // coluna para eixo X
    metric: string | null,       // métrica para eixo Y
    serieBy: string | null,      // dimensão de quebra (ex: "cenário", "canal")
    filters: FilterDef[],
    title: string,
  }
}
```

---

## Plano de sessões

### Sessão 1 — Pipeline ponta a ponta

**Entrega:**
- Aba "Análise" + aba "Canvas" (tabs no topo da aplicação)
- Tipo `temporal` no wizard de importação (Passo 2), com parsing e ordenação cronológica
- Nova mensagem `COMPUTE_ANALYTICS_DATASET` no worker → estado `analyticsDataset`
- 1 gráfico de linha fixo na aba Análise: **AS IS vs Simulado ao longo do tempo**, com eixo X = primeira coluna temporal disponível e métrica = taxa de aprovação

**Destrava:** prova o pipeline ponta a ponta (wizard → worker → dataset → gráfico). Risco mais alto; reduz para as sessões seguintes.

**Dependências:** simulação deve ter rodado e `simulationOverlay` estar disponível para o pipeline ter dados.

---

### Sessão 2 — Builder configurável ✅ ENTREGUE

**Entrega:**
- Painel lateral de campos (dimensões e métricas) na aba Análise, estilo Power BI — `FieldPanel`, chips arrastáveis (HTML5 drag, MIME `application/aw-field`); dimensões temporais ⏱ primeiro
- Gráfico de linha torna-se **configurável**: arrasta campo para eixo X (drop zone) ou série; seleciona métrica e dimensão de série via `FieldWell` (drop zone + select) — componente `AnalyticsWidget`
- Suporte a múltiplos componentes na página (botão "+ Adicionar gráfico"), cada um com título editável e botão remover; estado em `analyticsLayout: WidgetConfig[]`
- Pivot client-side memoizado por config do componente — `pivotWidget(ds, config)` + `computeWidgetMetric(rows, metricId, decisionCol)`, memo por `[analyticsDataset, xDimension, metric, serieBy]`
- `serieBy`: cenário (AS IS vs Simulado), nenhuma (linha única), ou quebra por dimensão categórica (teto 12 séries, cenário Simulado implícito)

**Destrava:** usuário passa a construir suas próprias análises sem código novo.

---

### Sessão 3 — Tipos de gráfico: barras e KPI ✅ ENTREGUE

**Entrega:**
- `WidgetConfig.type` passa a ser `"line" | "bar" | "bar100" | "kpi"`; seletor segmentado de tipo no header de cada `AnalyticsWidget` (📈/📊/🧱/🔢) — handler `changeType(id, type)` em `AnalysisTab`
- Componente **barra normal** (`bar`) — comparação entre categorias; reusa `pivotWidget`, renderiza `<Bar>` agrupado por série (Recharts `BarChart`)
- Componente **barra 100% empilhada** (`bar100`) — composição / mix de risco; normaliza cada bucket do eixo X para somar 100% (memo `stacked100` derivado do pivot), `<Bar stackId>`, eixo Y `[0,100]%`
- Componente **KPI card** (`kpi`) — indicador pontual: ignora Eixo X/Série, usa só a Métrica; computa AS IS vs Simulado sobre todas as linhas via `computeWidgetMetric`; exibe valor grande (Simulado) + baseline AS IS + delta (pp/qty) colorido pela direção da métrica (`GOOD_WHEN_LOWER` = `inadReal`/`inadInferida`) — componente `KpiCard`
- Cada tipo configurável pelo mesmo painel de campos da Sessão 2; KPI mostra apenas o poço "Métrica"; em `bar100` o poço de série é rotulado "Composição"

**Destrava:** caso de uso "mix de score dos aprovados ao longo do tempo" (barra 100%) e indicadores executivos (KPI).

---

### Sessão 4 — Layout livre e persistência

**Entrega:**
- Arrastar, redimensionar e reposicionar componentes na página de análise
- Persistência do layout em `localStorage` (sobrevive a reload)
- Reutiliza o padrão do `businessWidget` (arrastável por handle) como base

**Destrava:** o dashboard vira um artefato salvo, não reconstruído a cada sessão.

---

### Sessão 5 — Motor de N cenários (multi-canvas)

> **Reformulação (ver DEC-AW-007):** o conceito original era salvar snapshots do canvas como Cenário A/B/C. A reformulação entrega **abas de canvas vivas e editáveis** — cada aba é uma política independente, o Dashboard centraliza as abas marcadas (opt-in) usando o nome da aba como nome do cenário. Datasets e biblioteca de Cineminha são compartilhados entre todas as abas.

Pelo porte da refatoração multi-canvas, a Sessão 5 é **fatiada em 3 sub-sessões**. A Sub-sessão 5A é a "Entrega 1" (infraestrutura, sem tocar no Dashboard); 5B + 5C compõem a "Entrega 2" (pipeline N-cenários + KPI/export), entregues como dois prompts para manter os diffs revisáveis.

---

#### Sub-sessão 5A — Infraestrutura multi-canvas (Entrega 1) ✅ ENTREGUE

**Escopo:** somente o Canvas e a barra de abas. **Não toca no Dashboard** — o pipeline analítico continua usando só o canvas ativo (comportamento atual preservado).

**Entrega:**
- Estado `canvases: {[id]: {id, name, shapes, conns, includeInDashboard}}` + `activeCanvasId`. `shapes`/`conns` permanecem como working copy do canvas ativo (DEC-AW-007). Ref espelho `canvasesR`/`activeCanvasIdR`.
- Troca de aba: ao sair, persiste `shapes`/`conns` no canvas; ao entrar, carrega os do alvo. Undo/redo (`undoStackR`/`redoStackR`) resetam/escopam por canvas.
- Barra de abas (rodapé esquerdo): aba **Dashboard** fixa + N abas de canvas. Ações: **novo canvas** (vazio), **duplicar** (clona shapes/conns com IDs regenerados), **renomear** (duplo-clique), **excluir** (com guarda do último canvas).
- Toggle **opt-in `includeInDashboard`** por aba (ex.: ícone 📊 na aba).
- Reconciliação de dataset (`onImportConfirm`) faz fan-out para **todos** os canvases, não só o ativo.
- Persistência em `localStorage` (`aw_canvases_v1`): canvases, nomes, flags e `activeCanvasId`.

**Destrava:** o usuário monta e mantém múltiplas versões de política lado a lado.

**Riscos:** regeneração de IDs na duplicação (evitar colisão); escopo de undo/redo; migração do estado antigo (canvas único → primeiro canvas do store).

---

#### Sub-sessão 5B — Pipeline N-cenários no worker (Entrega 2, parte 1) ✅ ENTREGUE

**Escopo:** worker + dataset analítico. Os componentes de gráfico **não mudam** (DEC-AW-004 — cenário já é série no `pivotWidget`).

**Entrega:**
- `COMPUTE_ANALYTICS_DATASET` passa a receber **todos os canvases marcados** (`includeInDashboard`) via `{canvases: [{id, nome, shapes, conns, lensPopulations}]}`, não `{shapes, conns}` de um só. O dispatch (`buildAnalyticsCanvasInputs`) usa a working copy para o canvas ativo e o store para os demais, e re-emite quando `canvases`/`activeCanvasId` mudam (toggle/rename/switch).
- `computeAnalyticsDataset(canvasInputs, csvStore)` roda `computeSimulatedDecisions` por canvas e faz **join por `(csvId, rowIdx)`** (datasets compartilhados ⇒ agrupamentos idênticos). Emite uma coluna `__DECISAO_<canvasId>` por canvas + `__DECISAO_AS_IS` **única e global** (substitui o antigo par fixo AS IS/Simulado).
- `scenarios` = `[{id:'as_is', nome:'AS IS', ...}]` + um `{id, nome:<nome da aba>, decisionCol}` por canvas marcado.
- `lensPopulations` por canvas: computado por canvas na main thread (`computeLensAffectedRows` sobre os shapes de cada canvas) e enviado no payload — cada canvas pode ter lenses próprios.
- Validado (sem código novo) que line/bar/bar100 listam todos os cenários como série e ciclam `SCENARIO_COLORS` — `pivotWidget` já mapeia `scenarios → seriesDefs`. `KpiCard`/quebra por dimensão usam fallback `scenarios[length-1]` (último canvas) quando não há mais id `'simulado'`.
- Otimização: cache de overlay por canvas (`cachedCanvasOverlay`) via hash de `shapes/conns/lensPopulations` + `csvStoreVersion` — não reprocessa canvases intocados ao editar um só; entradas de canvases removidos são podadas.

**Destrava:** "Cenário A vs B vs C no mesmo gráfico".

**Riscos:** custo de recomputar M canvases por edição (mitigado pelo cache); lens populations por canvas; auto-init do layout (`analyticsLayout`) com >2 cenários.

---

#### Sub-sessão 5C — KPI A vs B + Export (Entrega 2, parte 2) ✅ ENTREGUE

**Entrega:**
- `KpiCard` (DEC-AW-008): seletores **Baseline (A)** e **Comparação (B)** (dois `<select>` no topo do card) aceitando qualquer cenário registrado, incl. AS IS; número grande = B, baseline = A, delta = `B − A` colorido por `GOOD_WHEN_LOWER`. Default A=AS IS, B=primeiro canvas via `resolveKpiScenarios(scenarios, kpiA, kpiB)`. A/B persistidos em `WidgetConfig.config.kpiA`/`kpiB` (gravados via `onChange`/`changeConfig`).
- **Retrocompat (risco resolvido):** KPIs antigos sem `kpiA`/`kpiB` resolvem o default em tempo de render — `resolveKpiScenarios` faz fallback quando o id salvo não existe mais (cenário removido). Não há migração no load.
- Export: botão **⬇ Exportar CSV** no header da aba → `exportAnalyticsDatasetCSV(ds)` → `buildAnalyticsCSV(ds)` serializa o dataset largo (dimensões + métricas intrínsecas + **todas** as colunas de decisão por cenário, incl. AS IS) como CSV com BOM, abrível no Excel com cenários lado a lado (escape RFC 4180).

**Testes (5A→5C):** suíte `tests/analytics.test.js` (Vitest + jsdom) cobrindo `cloneCanvasWithNewIds` (5A), `computeAnalyticsDataset` join/cenários/AS IS global (5B), `computeWidgetMetric`/`pivotWidget` (2/3), `resolveKpiScenarios` e `buildAnalyticsCSV` (5C). Rodar com `npm test`.

**Destrava:** indicador executivo comparando duas políticas quaisquer + exportação completa para análise externa.

---

## Como iniciar cada sessão

Abra a sessão com uma linha de contexto + a referência a este documento:

```
Vamos à Sessão [N] do Analytics Workspace, conforme o épico
docs/wiki/Epicos-AnalyticsWorkspace.md. A sessão anterior entregou
[descreva brevemente o que foi feito]. Releia o épico e o código
relevante antes de propor.
```

O CLAUDE.md e este arquivo são carregados automaticamente no início de cada sessão — o contexto de decisões e schema estará disponível sem precisar colar a conversa.

### Propostas de prompt — Sessão 5 (multi-canvas)

**Sub-sessão 5A — Infraestrutura multi-canvas:**

```
Vamos à Sub-sessão 5A do Analytics Workspace (infraestrutura multi-canvas),
conforme docs/wiki/Epicos-AnalyticsWorkspace.md (DEC-AW-007). Implemente o
store `canvases` + `activeCanvasId` mantendo `shapes`/`conns` como working copy
do canvas ativo, a barra de abas com novo/duplicar/renomear/excluir, o toggle
opt-in `includeInDashboard`, undo/redo escopado por canvas, fan-out da
reconciliação de CSV e persistência em localStorage (`aw_canvases_v1`).
NÃO toque no Dashboard nesta sub-sessão. Releia o épico e o código antes de propor.
```

**Sub-sessão 5B — Pipeline N-cenários no worker:**

```
Vamos à Sub-sessão 5B do Analytics Workspace (pipeline N-cenários),
conforme docs/wiki/Epicos-AnalyticsWorkspace.md (DEC-AW-003/004/007). A 5A já
entregou o multi-canvas. Faça `COMPUTE_ANALYTICS_DATASET` receber todos os
canvases marcados, computar overlay por canvas, fazer join por (csvId,rowIdx),
emitir uma coluna de decisão por canvas + AS IS global, e registrar `scenarios`
com o nome de cada aba. Resolva lensPopulations por canvas e valide que os
gráficos listam todos os cenários como série sem código novo. Releia o épico e
o código antes de propor.
```

**Sub-sessão 5C — KPI A vs B + Export:**

```
Vamos à Sub-sessão 5C do Analytics Workspace (KPI A vs B + export),
conforme docs/wiki/Epicos-AnalyticsWorkspace.md (DEC-AW-008). A 5B já entregou o
pipeline N-cenários. Dê ao KpiCard os seletores Baseline (A) e Comparação (B)
aceitando qualquer cenário (incl. AS IS), persistidos no WidgetConfig, e
implemente o export do dataset largo (dimensões + métricas + todas as colunas de
cenário) como CSV. Releia o épico e o código antes de propor.
```
