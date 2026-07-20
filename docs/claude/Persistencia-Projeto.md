# Salvar / Abrir Projeto (`.credito.json`)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". A ⚠️ regra inviolável
> sobre o que precisa ser salvo mora **na íntegra no próprio `CLAUDE.md`** (não
> repetida aqui) — esta página é o detalhe mecânico de como o save/load
> funciona por baixo.

Botões **💾 Salvar Projeto** e **📁 Abrir Projeto** na seção **Projeto** (topo do
painel direito). Persistência completa do estudo num único arquivo
`.credito.json` (local, sem servidor), para o usuário retomar exatamente de onde
parou.

- **`buildProjectPayload()`** — **FONTE ÚNICA DA VERDADE do que é persistido.**
  Monta o snapshot `{schemaVersion:"3.1", kind:"credito-project", generatedAt,
  activeTab, ribbonActiveTab, ribbonMode, statusBarIndicators, rightPanelMode, viewport, panelCollapsed,
  canvases, activeCanvasId, csvStore,
  analyticsLayout, analyticsGroupings, analyticsPageFilters,
  cinemaLibrary, policyLibrary, businessWidget, preferences}`.
  (`ribbonActiveTab` desde 2.8; `ribbonMode` — colapso do Ribbon em 3 estados — desde 2.9;
  `statusBarIndicators` — quais indicadores aparecem na Status Bar, UX 2.0 Sessão 5 — desde 3.0;
  `rightPanelMode` — aba interna do painel direito Ativos/Inspetor/Copiloto, UX 2.0 Sessão 6 — desde 3.1.)
  `preferences` = `{enableDynThickness, showEdgeVol, showEdgeInadReal, showEdgeInadInf}`.
  Mescla a working copy do canvas ativo (`shapes`/`conns`) de volta em `canvases`
  (igual ao effect da `sessionStorage`) — **sem isso, edições no canvas ativo (ex.:
  um Decision Lens recém-criado) não entram no arquivo.**
  O `csvStore` é serializado via `serializeCsvStore()` (typed arrays → **base64**, ver
  `docs/claude/Otimizacao-Memoria-Historico.md` § M3) e restaurado via `deserializeCsvStore()` (base64 → typed
  arrays; também aceita os formatos antigos: arrays planos de números — schema ≤ 2.2 —
  e `rows: string[][]` de projetos anteriores à Fase 1, migrando-os transparentemente).
- **`saveProject()`** (async): monta `buildProjectJSONChunks(buildProjectPayload())`
  (helper global em `App.jsx`, M3) — a "casca" do payload (tudo exceto `csvStore`) mais
  as colunas de cada base **uma por vez**, em vez de um único
  `JSON.stringify(payload)` monolítico — e usa o **"Salvar como" nativo** (File System
  Access API `window.showSaveFilePicker`) quando disponível — o usuário escolhe pasta e
  nome, e os *chunks* são escritos em sequência no `createWritable` (streaming real:
  nenhuma string única do projeto inteiro chega a existir em RAM). `AbortError` = usuário
  cancelou (no-op). *Fallback* para download via `<a download>` (browsers sem a API): os
  mesmos *chunks* viram o array de `BlobPart[]` do `Blob` (aceito sem concatenação) e o
  `<a>` é anexado ao DOM, só revogando o blob URL após `setTimeout(…, 2000)` — **revogar
  imediatamente após `click()` pode truncar projetos grandes** (bug histórico: base de
  dados sumindo do arquivo salvo). Dá feedback via `projectSaveNotice`
  (`{kind:'ok'|'err', msg}`) renderizado sob o botão.
- **`loadProject(data)`** / **`onProjectFileChange`**: valida `kind:"credito-project"`,
  sobe o contador `_id` (varre shapes/conns/ids de todos os canvas) p/ evitar colisão,
  restaura todo o estado (cada seção com default defensivo — seções ausentes não zeram
  o resto), reseta seleção/edição e os stacks de undo/redo (que são por canvas e
  ficariam inconsistentes após trocar todos os canvas). O effect de `csvStore`
  reenvia `UPDATE_CSV_STORE` ao worker.
  A leitura do arquivo (`onProjectFileChange`) continua via `FileReader.readAsText` +
  `JSON.parse` — o ganho de memória do M3 é no *tamanho* do JSON (base64, sem números
  boxed), não numa leitura streaming do lado do load.
- **`serializeCsvStore` / `deserializeCsvStore`** (em `src/columnar.js`, importados em `App.jsx`):
  Typed arrays (`Float64Array`, `Int32Array`) não são JSON nativo. Desde a M3 (Otimização
  de Memória), `serializeCsvStore` converte-os para **base64 dos bytes crus** (em vez de
  array plano de números boxed — schema ≤ 2.2) e `deserializeCsvStore` reconstrói os
  typed arrays a partir do base64. Aceita os três formatos na carga: base64 (atual), array
  plano (projetos/exports salvos com schema ≤ 2.2) e `rows: string[][]` (legado pré-Fase 1,
  vetorizado on-the-fly). Round-trip (dos três formatos) coberto em `tests/columnar.test.js`.
- **`buildProjectJSONChunks(payload)`** (helper global em `App.jsx`, M3): serializa o
  payload do Projeto como um **array de strings JSON** em vez de uma string única — a
  "casca" (todo campo exceto `csvStore`) primeiro, depois `csvStore` com cada coluna de
  cada base serializada (`JSON.stringify`) individualmente. A concatenação dos chunks é
  sempre um JSON válido idêntico, em conteúdo, ao de `JSON.stringify(payload)` — só a
  forma de entrega muda (partes em vez de string monolítica), o que permite ao
  `createWritable`/`Blob` consumi-las sem montar o projeto inteiro como uma string
  contígua em memória.

Difere do **Exportar/Importar Fluxo** (seção Fluxo), que salva só o canvas ativo
(shapes/conns + opcionalmente csvStore) — o Projeto salva *tudo* (todas as abas,
bases, inferência, dashboard, biblioteca e preferências).

## Checklist do que hoje é salvo
(mantê-lo em dia — companheiro da ⚠️ regra em `CLAUDE.md`): canvas e todos os shapes/conns
de **todas** as abas (losangos, Cineminhas, Decision Lens e suas `rules`, frames,
terminais, painéis) · `includeInDashboard`/nome por aba · bases de dados completas
(`csvStore`: headers, rows, columnTypes, varTypes, `asIsConfig`, `clusterDefs`) · Dashboard
(`analyticsLayout`, `analyticsGroupings`, `analyticsPageFilters`) · biblioteca de
Cineminhas (`cinemaLibrary`) · biblioteca de Políticas (`policyLibrary`) · widget de
negócio · preferências de aresta/espessura + Motor Python (`computeSidecar {enabled, url, token}`, H4/H6) ·
viewport · aba ativa · indicadores da Status Bar (`statusBarIndicators`) · painel colapsado.

## Auto-persistência de sessão (`sessionStorage`)

Além do save/load explícito, parte do estado é persistida automaticamente em
`sessionStorage` para sobreviver a reloads **dentro da mesma sessão** do navegador
(não é durável — some ao fechar a aba). Chaves:

- **`aw_canvases_v1`** (`CANVAS_STORAGE_KEY`): store multi-canvas. O effect grava
  `{canvases, activeCanvasId}` a cada mudança de `shapes`/`conns`/`canvases`/
  `activeCanvasId`, sempre mesclando a working copy do canvas ativo de volta em
  `canvases[activeCanvasId]`. Init cacheado via `_initCanvasStore()` (parseia uma vez,
  compartilhado pelos initializers de `canvases`/`activeCanvasId`/`shapes`/`conns`).
- **`aw_layout_v1`**: `analyticsLayout` (gráficos do dashboard).
- **`aw_groupings_v1`**: `analyticsGroupings` (dimensões derivadas).
- **`aw_page_filters_v1`**: `analyticsPageFilters` (filtro de página do Dashboard).
- **`ribbon_active_tab_v1`** / **`ribbon_mode_v1`**: aba ativa e colapso do Ribbon.
- **`status_bar_indicators_v1`**: `statusBarIndicators` (indicadores da Status Bar, UX 2.0
  Sessão 5) — array de ids filtrado contra `STATUS_BAR_INDICATORS_META` na carga (id
  desconhecido de uma versão futura nunca quebra a barra).
- **`right_panel_mode_v1`**: `rightPanelMode` (aba interna do painel direito —
  `'assets'`|`'inspector'`|`'copilot'`, UX 2.0 Sessão 6) — valor desconhecido cai no
  default defensivo `'assets'`.

`csvStore` e `cinemaLibrary` **não** vão para `sessionStorage`
(muito grandes / precisam do Projeto `.credito.json`). Init/gravação são
defensivos (`try/catch`), então quota estourada ou JSON inválido nunca quebram o boot.

## Painel direito colapsável (`panelCollapsed`)

O painel lateral direito pode ser colapsado para uma faixa fina de 28px, liberando espaço
de canvas. Estado `panelCollapsed` (boolean, default `false`); largura anima entre `272px`
e `28px`. Quando colapsado, o conteúdo é escondido (`display:none`) e só a faixa com o
botão de reabrir fica visível.

Desde a UX 2.0 Sessão 6, o corpo do painel tem **3 abas internas** (`rightPanelMode`,
persistido — ver acima), abaixo do header e do mesmo botão de colapsar:

- **Ativos** (`'assets'`, default): bases carregadas (lista + ✏️/✕), Variáveis de Decisão
  (busca + chips arrastáveis via `startPanelDrag` + ✏️ de cluster/faixas) e atalhos às
  bibliotecas de Cineminha/Políticas. "Recursos do estudo."
- **Inspetor** (`'inspector'`): **propriedades** do objeto selecionado (não comandos —
  comandos vivem na Ribbon), via `renderInspector()`. Por tipo: losango (rótulo editável,
  variável, resumo do domínio, chegadas via `nodeArrivals`/`totalNodeArrival`), Cineminha
  (tipo, rowVar/colVar, grade, resultado, trava, chegadas), Decision Lens (regras,
  população via `computeLensPopulation`), terminal (tipo + volume somado do `edgeStats` das
  arestas de entrada), frame (rótulo, dimensões). Rótulo editável reusa `setShapes`+
  `pushHistory` (mesmo caminho do `commitEdit` do duplo-clique); o resto é read-only. Sem
  seleção → propriedades do estudo (aba ativa, nº de objetos, bases vinculadas) + dica;
  multi-seleção → sumário + dica apontando à aba Seleção do Ribbon.
- **🧭 Copiloto** (`'copilot'`): o lint estrutural (achados por severidade, "ir até o nó",
  quick-fixes) + o card informativo da Descoberta de Segmentos. Um **badge** com o nº de
  achados (`copilotFindings.length`) aparece no título da aba. O comando "🧭 Copiloto" da
  aba Analisar do Ribbon foca esta aba (`setRightPanelMode('copilot')`).

Os avisos de Projeto/Fluxo (`projectSaveNotice`/`projectLoadNotice`/`importWarn`) e os
inputs de arquivo ocultos ficam **fora** das abas (sempre montados/visíveis no topo do
corpo).
