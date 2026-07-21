# Explorar a Base (Épico EB, EB1+EB2 — DEC-EB-001..012)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer na aba
> **Explorar** (3ª aba da barra inferior), no `BaseProfileModel` (worker) ou no layout
> automático. Referência normativa completa (DEC-EB-001..012, filosofia, sessões
> planejadas EB3–EB5): `docs/wiki/Epicos-ExplorarBase.md`.

Terceira aba da aplicação (`activeTab:'explore'`, label "Explorar", leftmost na barra —
"conhecer a matéria-prima" abre a jornada Explorar → Canvas → Dashboard). Não depende de
shapes/conns: funciona com o canvas vazio, a partir do momento em que uma base é
carregada. Responde "o que esta base tem a me dizer" (perfil da base observada),
diferente do Dashboard (que responde "como minha política está se saindo" sobre a
**simulação**).

## Pipeline (EB1, motor no worker — sem UI)

`COMPUTE_BASE_PROFILE` → `BASE_PROFILE_RESULT` (mensagens documentadas em
`docs/claude/Worker-Protocolo.md`). `computeBaseProfile(csvStore, {csvId, riskMetric})`
monta o `BaseProfileModel` numa passada dedicada, **Classe A absoluta** (só agregação
O(distintos) local, JAMAIS roteia ao sidecar — DEC-HX-007), fora do cache do tick de
edição. Padrão `docModel`/`SegmentModel`: **dados crus + códigos de achado, nunca
prosa** (DEC-EB-003).

```js
// BaseProfileModel (ver DEC-EB-003 para o esboço completo e tests/baseProfile.test.js
// para o contrato travado por GATE — motor entregue na EB1, sem mudança na EB2)
{
  version, generatedAt, csvId,
  metric: {id, label, direction},              // resolveRiskMetric (DEC-SD-006)
  asIs: null | {totalQty, approvedQty, rejectedQty, otherQty, approvalRate, inadRealAprovados, inadInferidaAprovados},
  variables: [{col, varType, distinct, coveragePct, iv, flags, profile, profileTruncated, psi, continuous}],
  temporal: null | {col, series:[{bucket, qty, approvalRate, inadRate}]},
  quality: [{col, coveragePct, unparseablePct, dominantValue}],
  insights: [{code, severity, facts}],
}
```

`variables[]` já vem **ordenado por IV desc** (mesmo motor do ranking global,
`computeVariableRanking` com âncora nula — DEC-EB-008) — a EB2 reusa essa ordem
diretamente para "top-N variáveis mais discriminantes", sem reordenar.

## Aba Explorar (EB2 — `src/dashboardComponents.jsx`, `ExploreTab`)

- **Header**: seletor de base (`csvStore` carregados) + seletor de métrica-alvo
  (Inad. Real/Inferida) + **↻ Regenerar análise** + **📄 Exportar PDF** (mesmo padrão de
  `exportDashboardPDF`, captura genérica via `[data-explore-capture]` no corpo de cada
  widget — sem branch por tipo).
- **Estado em `App.jsx`**: `exploreCsvId` (base selecionada; `null` até o worker ecoar o
  winner por população), `exploreRiskMetric` (default `'inadReal'`), `baseProfileResult`
  (o `BaseProfileModel` corrente — **DERIVADO, não persiste**), `exploreLayouts`
  (`{[csvId]: WidgetConfig[]}` — **criação do usuário, persiste**, ver
  `docs/claude/Persistencia-Projeto.md`).
- **Dispatch do worker**: `useEffect` dedicado (`COMPUTE_BASE_PROFILE`, debounced
  300ms), depende só de `[csvStore, exploreCsvId, exploreRiskMetric, activeTab]` — NUNCA
  de `shapes`/`conns` (DEC-EB-002: não é o tick de edição). Só computa enquanto
  `activeTab==='explore'` (mesmo racional de custo de `COMPUTE_ANALYTICS_DATASET`).

## Layout automático (DEC-EB-005/006 — `src/explore.js`)

`buildDefaultExploreLayout(profile)` — **puro, testável, determinístico** (ids derivados
do nome da coluna via `colSlug`, nunca `uid()`/timestamp). Gera as 6 seções fixas, cada
uma abrindo com um card `insight`:

1. Retrato da operação AS IS (`insight` preset `asis`)
2. Ranking de variáveis (`insight` preset `ranking` + 1× `ivrank`)
3. Perfis das top-N variáveis (`insight` preset `varprofile` + até `EXPLORE_TOP_N_VARS=5`
   × `varprofile`, uma por variável de maior IV — mesma ordem de `profile.variables`)
4. Qualidade dos dados (`insight` preset `quality` + 1× `quality`)
5. Estabilidade temporal (`insight` preset `stability` + 1× `stability`)
6. Avisos/leituras (`insight` preset `warnings` — lista **todos** os `insights[]`)

Todo widget nasce com `origin:'auto'`. Auto-init: `ExploreTab` (`useEffect` sobre
`profile`) chama `buildDefaultExploreLayout` só quando `exploreLayouts[csvId]` está
vazio — nunca sobrescreve um layout já existente.

### ↻ Regenerar análise (DEC-EB-005 — `regenerateExploreLayout` em `App.jsx`)

Ação **explícita** (confirmação via `window.confirm`, único precedente desse padrão no
código — não há modal de confirmação dedicado no resto da app). Recria só os widgets
`origin:'auto'`, preservando os `origin:'user'`:

```js
const kept = prev.filter(w => w.origin === 'user');
const keptIds = new Set(kept.map(w => w.id));
return [...kept, ...buildDefaultExploreLayout(profile).filter(w => !keptIds.has(w.id))];
```

**Ponto sutil**: os ids de `buildDefaultExploreLayout` são **slots estáveis** (ex.:
`auto_insight_asis`, `auto_varprofile_<col>`) — o mesmo id sempre nomeia "o card
automático daquela seção/variável". Um slot promovido a `user` (qualquer edição de
`config`, incl. o título — ver `changeConfig` em `ExploreTab`) precisa ser **excluído**
da nova leva automática, senão dois widgets acabam com o mesmo `id` (React key
duplicada + `changeConfig`/`removeWidget` por id passam a afetar os dois). Coberto
manualmente via teste E2E nesta sessão (edita título → regenera → confere 1 widget só,
sem o AUTO badge, e a contagem total NÃO duplica o slot editado).

## Widgets novos (`src/dashboardComponents.jsx`)

Todos compartilham a casca `ExploreWidgetShell` (título editável + badge `AUTO` +
duplicar/remover/arrastar/redimensionar — mesmo mecanismo de posicionamento livre do
Dashboard, sem `FieldPanel`/filtros/agrupamentos, que ficam para o builder livre da EB4,
DEC-EB-011). Editar qualquer `config` promove `origin` para `'user'`
(`ExploreTab.changeConfig`).

| Tipo | Corpo | Fonte |
|---|---|---|
| `insight` | Leitura mínima (1–2 frases) por seção (`preset`) ou lista de TODOS os achados (`preset:'warnings'`) | `src/exploreInsights.js` |
| `ivrank` | Barra horizontal **div-based** (não Recharts — controle total sobre os badges de flag) do ranking global, com ícones por `flags[]` (🎯 score, 🕐 temporal, ⚠️ baixa cobertura, 🏔 dominante, 🔀 alta cardinalidade, 📉 PSI instável) | `profile.variables` |
| `varprofile` | Volume (barras) + taxa da métrica-alvo (linha), eixo duplo, Recharts `ComposedChart` (exceção DEC-AW-001 estendida à aba Explorar, DEC-EB-011 §7) | `profile.variables[].profile` |
| `quality` | Tabela: cobertura, % não numérico, categoria dominante | `profile.quality` |
| `stability` | Série por safra (volume/aprovação/inadimplência) + selos de PSI top-8 por variável, coloridos pelos limiares da DEC-EB-009 (< 0,1 verde · 0,1–0,25 âmbar · > 0,25 vermelho) | `profile.temporal` + `profile.variables[].psi` |

Degradação sempre declarada: sem AS IS ⇒ `insight` preset `asis` lê o achado
`no_asis`; sem coluna ⏱ ⇒ `stability` mostra o estado vazio dedicado (nunca inventa
série) e o `insight` preset `stability` lê `no_temporal_column`.

## Camada interpretativa — STUB da EB2 (`src/exploreInsights.js`)

Módulo **folha** (não importa `App.jsx` nem o worker — mesmo padrão de `src/segVar.js`),
com dois exports:

- `describeFinding({code, facts})` — 1 frase por código de achado do v1 (`high_iv`,
  `suspect_score`, `suspect_temporal`, `low_coverage`, `dominant_value`,
  `high_cardinality`, `immature_vintage`, `unstable_psi`, `no_temporal_column`,
  `no_asis`). Código sem template conhecido degrada declaradamente (nunca `undefined`
  solto na tela).
- `describeSection(preset, profile)` — 1–2 frases por seção do layout default (`asis`,
  `ranking`, `varprofile`, `quality`, `stability`, `warnings`), lendo o
  `BaseProfileModel` inteiro.

**É um stub deliberado** (DEC-EB-004 in fine): só a "Leitura" (1ª altura de texto) —
sem "ⓘ Como ler" pedagógico, sem GATE de cobertura exaustiva. A EB3 expande este MESMO
módulo (mantém as duas assinaturas) para as 3 alturas completas + `tests/exploreInsights.test.js`.
Nunca LLM, sempre determinístico (mesma entrada ⇒ mesma prosa, byte a byte).

## Persistência (DEC-EB-007, schema 3.2)

`exploreLayouts: {[csvId]: WidgetConfig[]}` é **criação do usuário** ⇒ regra inviolável
do `CLAUDE.md`: entra em `buildProjectPayload()`/`loadProject()` (default defensivo
`{}` para projetos < 3.2) + `sessionStorage` (`explore_layouts_v1`). O
`BaseProfileModel` (`baseProfileResult`) é **derivado** (recomputável da base) e NÃO
persiste — mesmo contrato de `analyticsDataset`. Round-trip coberto em
`tests/projectSave.test.js`. `exploreCsvId`/`exploreRiskMetric` são estado de UI
efêmero (não persistem — reabrir o projeto reseleciona o winner por população).

## Comandos (registro declarativo, `App.jsx` § COMMANDS)

`data.openExplore` ("Abrir Explorar", `setActiveTab('explore')`) e
`data.regenerateExplore` ("Regenerar análise da base", chama a MESMA
`regenerateExploreLayout` do botão do header — sem duplicação de lógica), ambos sob a
aba `dados`/grupo "Explorar". Aparecem automaticamente na Busca Ctrl+K (não filtrada por
aba ativa) e na Ribbon (só quando `activeTab==='canvas'`, já que a Ribbon só monta
nesse caso — mesma limitação estrutural que já existia para qualquer comando de aba
fixa antes desta sessão).

## Testes

- `tests/explore.test.js` — `buildDefaultExploreLayout`: 6 seções na ordem certa, teto
  de top-N (`EXPLORE_TOP_N_VARS`), ids únicos, `origin:'auto'`, determinismo byte a
  byte, layout vazio sem perfil válido.
- `tests/projectSave.test.js` — round-trip de `exploreLayouts` via
  `buildProjectJSONChunks`.
- `tests/baseProfile.test.js` (EB1, sem mudança) — GATE do `BaseProfileModel`.

## Fora de escopo desta sessão (EB2)

- Templates completos de `exploreInsights.js` + "ⓘ Como ler" + GATE dedicado (EB3).
- Pontes para o fluxo ("➕ Usar como 1º galho", "📐 Criar faixas", "🧩 Clusterizar") e
  builder livre (`FieldPanel`/filtros/agrupamentos) sobre o dataset largo (EB4).
- Convite pós-import (toast "🔎 Análise da base pronta") e card de Dicas do canvas vazio
  apontando para Explorar (EB4, DEC-EB-012).
