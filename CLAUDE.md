# AppCreditoSimulador

## Stack
- React + Vite, arquivo único: `src/App.jsx` (~11150 linhas)
- Sem CSS externo — tudo inline styles
- SVG puro para o canvas; matrizes interativas via `foreignObject` (sem biblioteca de diagramas)
- **Recharts** para gráficos na aba Dashboard (exceção pontual ao ADR-003 — ver `DEC-AW-001`)
- Web Worker (`src/simulation.worker.js`, ~2430 linhas) para cálculos pesados fora da thread principal
- **`src/columnar.js`**: módulo de armazenamento colunar do `csvStore` (otimização de memória) + pipeline de importação vetorizado (parse direto para colunar, sem `string[][]`)
- **Vitest** para testes (`tests/*.test.js`, jsdom) — `npm test`

## O que é
Whiteboard interativo + simulador de regras de crédito. O usuário carrega um CSV sumarizado, classifica colunas, arrasta variáveis de decisão para o canvas como losangos ou matrizes cruzadas (Cineminha) e monta um fluxo de política de crédito. O painel de simulação exibe taxa de aprovação e indicadores de inadimplência em tempo real, comparando com a política atual (AS IS).

## Documentação em camadas — como usar este repositório

Este `CLAUDE.md` é um **índice enxuto**, carregado inteiro em toda sessão. Ele NÃO
contém o detalhe de cada feature — isso vive em `docs/claude/*.md` (detalhe de
implementação, não sincronizado com o Wiki público) e `docs/wiki/*.md` (documentação
normativa/arquitetural, sincronizada com o GitHub Wiki via `sync-wiki.yml`).
**Antes de mexer em qualquer domínio, leia o arquivo apontado na tabela "Onde vive o
quê" abaixo.** Não peça para "ler o projeto inteiro primeiro" — os ponteiros já
resolvem isso a um custo muito menor. `release/` é artefato de build (~1,4MB): nunca
leia/varra, exceto `serve.py`/`sidecar.py`/`release/python/` quando a tarefa for do
sidecar Python.

## Estrutura de arquivos (resumida)

```
AppCreditoSimulador/
├── src/
│   ├── App.jsx                   # Componente único — ~11150 linhas
│   ├── simulation.worker.js      # Web Worker: simulação, overlay, Pareto, Johnny, Goal Seek (~2430 linhas)
│   ├── columnar.js               # Armazenamento colunar do csvStore + import vetorizado
│   ├── goalSeek.js               # applyGoalSeekMoves (compartilhado worker/main)
│   ├── policySimplify.js         # applySimplifyCandidates (compartilhado worker/main)
│   ├── policyIR.js               # PolicyIR — buildPolicyIR/applyPolicyPatch/extractPolicyRequiredVars/applyPolicyVarMapping/diffPolicyIR (helpers puros, re-exportados por App.jsx)
│   ├── clusterVar.js             # Variável de Cluster (compartilhado main/worker/teste)
│   ├── computeRouter.js          # ComputeRouter — worker default / sidecar Python opt-in
│   ├── analytics.js              # Helpers puros do Analytics Workspace (pivot, filtros, agrupamentos, métricas, export CSV, KPI) + constantes da aba Dashboard
│   ├── policyDocRender.js        # Renderers puros da Documentação Automática — renderDocMarkdown/renderDocHTML sobre o docModel/PolicyIR já montado (re-exportados por App.jsx)
│   └── main.jsx                  # Entry point React
├── tests/                        # Vitest (jsdom) — ver tabela de GATEs abaixo
│   └── fixtures/, fixtures/golden/  # fixtures de teste + fixtures douradas cross-runtime
├── docs/
│   ├── HANDOFF.md                # Handoff para desenvolvimento corporativo
│   ├── claude/                   # Detalhe por domínio para o Claude Code (esta camada)
│   └── wiki/                     # Documentação normativa, sincronizada com o GitHub Wiki
├── release/                      # Artefato de build (NÃO ler/varrer, exceto sidecar)
│   ├── serve.py                  # Servidor local COOP/COEP + monta o sidecar em /api/compute/*
│   ├── sidecar.py                # Motor Python (stdlib) importado por serve.py
│   └── python/                   # Instalação do Motor Python (opt-in) + motores numpy
├── tests_python/                 # pytest: protocolo do sidecar + GATEs cross-runtime (segmentos/clusters)
├── .github/workflows/            # build-release.yml, test-sidecar.yml, sync-wiki.yml
├── vite.config.js                # Build config + injeção de metadados de build
├── vitest.config.js              # Config dos testes (jsdom)
├── Amostra_Fake.csv              # Amostra real usada por GATEs
└── index.html
```

Árvore completa e anotada (comentário de cada arquivo/teste): `docs/claude/Estrutura-Arquivos.md`.

## Padrão de refs
Toda variável de estado crítica em `src/App.jsx` tem um ref espelho para uso em event
listeners sem closure stale. Em todo `setX(...)`, o ref correspondente é atualizado
imediatamente. Refs existentes: `vpR`, `shapesR`, `connsR`, `toolR`, `fromIdR`, `editR`,
`csvStoreR`, `activeCellR`, `panelDragR`, `editConnR`, `axisModalR`, `multiSelR`,
`selRectR`, `selR`, `undoStackR`, `redoStackR`, `lensModalR`, `johnnyModalR`,
`businessWidgetR`, `cinemaLibraryR`, `canvasesR`, `activeCanvasIdR`.

## ⚠️ Regra para novas features — o que o usuário cria/ajusta PRECISA ser salvo

Esta regra é **inviolável** — persistida aqui na íntegra (o resto da mecânica de
save/load está em `docs/claude/Persistencia-Projeto.md`).

**Toda vez que você adicionar um estado novo que representa algo criado ou
configurado pelo usuário** (uma nova aba/canvas, um novo tipo de shape e seus
campos, uma nova biblioteca, um novo painel/config do Dashboard, uma nova
preferência de visualização, um novo modal de configuração persistente, etc.),
inclua-o no salvamento do Projeto — senão ele se perde ao salvar/abrir. Passos:

1. **Incluir no `buildProjectPayload()`** o novo campo (ou garantir que ele já
   viaja dentro de um contêiner já salvo — ex.: um novo campo de um `shape` já é
   coberto por `canvases`; um novo campo do `csvStore[csvId]` já é coberto por
   `csvStore`). Só precisa de entrada própria estado que vive **fora** desses
   contêineres (um novo `useState` de topo).
2. **Restaurar em `loadProject(data)`** com default defensivo
   (`Array.isArray(...) ? ... : []`, `typeof x === '...' ? ... : default`), para
   arquivos antigos (sem o campo) não quebrarem nem zerarem o resto.
3. **Bump do `schemaVersion`** se a mudança for estrutural (ex.: `2.1` → `2.2`).
   Versão atual: **`"2.6"`** (bumped na Variável de Cluster — novo campo
   `csvStore[csvId].clusterDefs`, já coberto pelo contêiner `csvStore`).
4. Se o estado for um `Map`/`Set`/tipo não-JSON (ou typed arrays como `Float64Array`/`Int32Array`),
   adicionar serialize/deserialize dedicados (padrão de
   `serializeCsvStore`/`deserializeCsvStore`) e cobrir o round-trip em teste.
5. Se também deve sobreviver a reload na mesma sessão, adicionar à
   auto-persistência de `sessionStorage` (ver `docs/claude/Persistencia-Projeto.md`).

**Checklist do que hoje é salvo** (mantê-lo em dia): canvas e todos os shapes/conns
de **todas** as abas (losangos, Cineminhas, Decision Lens e suas `rules`, frames,
terminais, painéis) · `includeInDashboard`/nome por aba · bases de dados completas
(`csvStore`: headers, rows, columnTypes, varTypes, `asIsConfig`, `clusterDefs`) · Dashboard
(`analyticsLayout`, `analyticsGroupings`, `analyticsPageFilters`) · biblioteca de
Cineminhas (`cinemaLibrary`) · biblioteca de Políticas (`policyLibrary`) · widget de
negócio · preferências de aresta/espessura + Motor Python (`computeSidecar {enabled, url, token}`) ·
viewport · aba ativa · painel colapsado.

## Comandos de desenvolvimento

```bash
npm install       # instalar dependências
npm run dev       # servidor de desenvolvimento (Vite)
npm run build     # build de produção → dist/
npm run preview   # preview do build de produção
npm test          # roda a suíte Vitest (tests/*.test.js, jsdom) uma vez
```

## GATEs de teste (o que cada arquivo trava)

| Arquivo | O que trava |
|---|---|
| `tests/columnar.test.js` | Accessors do armazenamento colunar; round-trip de projeto (base64/legado); SharedArrayBuffer |
| `tests/importPipeline.test.js` | Import vetorizado (M1) ≡ caminho legado (parse→normalize→append→buildColumnar) |
| `tests/compiledEngine.test.js` | Motor compilado sobre códigos do dicionário (M8) ≡ caminho por string (legado) |
| `tests/simulationTick.test.js` | Passe único do tick de edição (M6) ≡ composição das 4 funções originais |
| `tests/asIsPreview.test.js` | Prévia AS IS contextualizada ao nó (`computeCinemaAsIsCells`) vs. base completa (`computeAsIsCells`) |
| `tests/analytics.test.js` | `autoBuckets`, `distinctDimValues`, `applyGroupingsToDataset`, `pivotWidget` (Analytics Workspace) |
| `tests/projectSave.test.js` | `buildProjectJSONChunks` ≡ `JSON.stringify` (M3) |
| `tests/policyIR.test.js` | Roteamento via PolicyIR ≡ motor compilado (M8); round-trip IR→canvas→IR; IR sem posições/dados |
| `tests/policyTemplates.test.js` | Biblioteca de Políticas — mapeamento de variáveis em base renomeada ≡ roteamento original; variável sem mapeamento vira pendência |
| `tests/goalSeek.test.js` | Goal Seek — delta O(1) por movimento ≡ resimulação; precedência ordinal; restrições/travas; determinismo |
| `tests/policySimplify.test.js` | Simplificação — nó colapsável/chegada zero/regra sem efeito/variável re-testada ⇒ proposta prova `diff=0`; caso lossy ⇒ delta declarado bate com `runSimulation` |
| `tests/policyDoc.test.js` | Documentação Automática — `docModel` ≡ motor (KPIs/funil); completude; determinismo; degradação sem AS IS; privacidade; changelog via `diffPolicyIR` |
| `tests/segmentDiscovery.test.js` | Descoberta de Segmentos — subgrupo plantado, agregados, p-value, FDR, shrinkage, escopo por nó, dedup, determinismo |
| `tests/segmentDiscoveryGolden.test.js` | GATE cross-runtime (DEC-HX-005): fixtures douradas da Descoberta profunda (H7); costura sidecar→worker |
| `tests/clusterSegments.test.js` | Clusterização — clusters plantados, perfil ≡ agregação manual, determinismo, clamp/truncamento declarados |
| `tests/clusterSegmentsGolden.test.js` | GATE cross-runtime (DEC-HX-005): fixtures douradas do ClusterModel (H8) |
| `tests/clusterVar.test.js` | Variável de Cluster — materialização, sugestões, redação de regras, edição, propagação de refs, round-trip |
| `tests/workerPool.test.js` | Pool de Workers (H3) — pool ≡ single-worker número a número; determinismo; fallback |
| `tests/computeRouter.test.js` | ComputeRouter (H4) — Classe A jamais roteia; detecção silenciosa; fallback transparente Classe B |
| `tests_python/*.py` | Protocolo do sidecar (health/token/caps/dataset/job) + paridade número a número dos motores numpy (Descoberta H7, Clusterização H8) |

Regenerar fixtures douradas: `UPDATE_GOLDEN=1 npm test`. Nenhuma sessão de trabalho
muda a matemática do motor — se um GATE numérico falhar após uma mudança que deveria
ser só estrutural/documentação, pare e investigue antes de regenerar.

## Onde vive o quê (leia antes de mexer no domínio)

| Domínio | Ler antes de mexer |
|---|---|
| Estado do componente, shapes, `csvStore`, componentes/helpers globais, engine de simulação | `docs/claude/Estrutura-Dados.md` |
| Estrutura de arquivos completa e anotada | `docs/claude/Estrutura-Arquivos.md` |
| Auto Layout (`autoLayout`, reorganização do canvas) | `docs/claude/Auto-Layout.md` |
| Web Worker — protocolo de mensagens `COMPUTE_*`/`*_RESULT`, cache do tick (M6), motor compilado (M8) | `docs/claude/Worker-Protocolo.md` |
| Analytics Workspace / aba Dashboard, Agrupamentos, Filtros | `docs/claude/Analytics-Workspace.md` |
| Wizard de importação (3 passos), AS IS, carga assíncrona de CSV | `docs/claude/Wizard-Importacao.md` |
| Otimizadores de Cineminha — single (`optimModal`) e multi (Johnny) | `docs/claude/Cineminha-Otimizadores.md` |
| Goal Seek clássico (catálogo, busca, estado do modal) | `docs/claude/Copiloto-GoalSeek.md` |
| Goal Seek Profundo (GS1–GS6, MILP no sidecar) | `docs/wiki/Hibrido-GoalSeek-Profundo.md` |
| Simplificação com Prova de Equivalência (Copiloto Sessão 5) | `docs/claude/Copiloto-Simplificacao.md` |
| Documentação Automática (`docModal`, Copiloto Sessão 6) | `docs/claude/Copiloto-Documentacao.md` |
| Descoberta de Segmentos (Copiloto Sessão 10/11/12) | `docs/claude/Copiloto-Segmentos.md` |
| PolicyIR — JSON canônico da política (Copiloto Sessão 0) | `docs/claude/Copiloto-PolicyIR.md` |
| Clusterização de Segmentos + Variável de Cluster | `docs/claude/Copiloto-Clusterizacao.md` |
| Bibliotecas (Cineminha e Políticas) | `docs/claude/Bibliotecas.md` |
| Domínio Exibido ("Configurar nó") | `docs/claude/Dominio-Exibido.md` |
| Decision Lens (populações M10, fluxo no motor) | `docs/claude/Decision-Lens.md` |
| Salvar/Abrir Projeto (mecânica completa), auto-persistência de sessão, painel colapsável | `docs/claude/Persistencia-Projeto.md` |
| Otimização de Memória — histórico completo (Fases 0–4, M1/M3/M15) | `docs/claude/Otimizacao-Memoria-Historico.md` |
| Pool de Workers (Execução Híbrida H3) | `docs/claude/Execucao-Hibrida-Pool.md` |
| Execução Híbrida H4–H8 — ComputeRouter, Sidecar Python, UX do Motor Python, Descoberta profunda no sidecar, Clusterização no sidecar | `docs/wiki/Arquitetura-Execucao-Hibrida.md` + `docs/wiki/Hibrido-Prompts-Sessoes.md` |
| Widget de negócio, `BuildBadge`, CI/CD, suporte a touch/mobile | `docs/claude/UI-Complementar-CI.md` |
| Epics/decisões/roadmap de produto (histórico completo) | `docs/wiki/Decisoes.md`, `docs/wiki/Roadmap.md`, `docs/wiki/Epicos-*.md` |
| Diagnóstico de consumo de contexto e plano de emagrecimento deste CLAUDE.md | `docs/wiki/Contexto-Claude.md` |

## Decisões arquiteturais (resumo dos ADRs)

| ADR | Decisão | Justificativa |
|-----|---------|---------------|
| ADR-001 | Arquivo único `src/App.jsx` | Estado profundamente compartilhado; protótipo em iteração rápida |
| ADR-002 | Inline styles | Estilos dependentes de estado junto ao JSX; sem colisão de classes |
| ADR-003 | SVG puro para o canvas | Controle total; suporte a `foreignObject` para HTML dentro do SVG. **Exceção**: Recharts (`DEC-AW-001`) para gráficos na aba Dashboard |
| ADR-004 | Refs espelho para event listeners | Evita closure stale em `addEventListener` |
| ADR-005 | Build em `release/` no mesmo repo | Distribuição simplificada — abrir `index.html` sem servidor |

## Branch de desenvolvimento atual
`claude/hybrid-execution-segment-clustering-rka9qg`

## Roadmap futuro (não implementado)

- **Restrição de monotonicidade**: flag `ordinal` no wizard passo 2 → corte monotônico (Young diagram) no algoritmo Pareto — para variáveis como ratings R1–R20 (parcialmente implementado no Johnny via `badness`/`rowRank`/`colRank`)
- **Sliders adicionais**: margem, rentabilidade ajustada ao risco (RAR), restrição de volume mínimo por segmento
- **Fronteira Pareto multi-dimensional**: 3D (aprovação × inad.real × inad.inferida)
- **Decision Lens — modo incremental**: comparação visual linha a linha das decisões mudadas
- **Exportação**: JSON canônico da política ✅ (PolicyIR — ver `docs/claude/Copiloto-PolicyIR.md`; 3ª opção do modal Exportar Fluxo); falta exportação do canvas como PNG/SVG
- **Persistência**: export/import de projeto como `.credito.json` ✅ + auto-persistência em `sessionStorage` ✅ (ver `docs/claude/Persistencia-Projeto.md`); falta auto-save durável em `localStorage` (sobrevive só à sessão do navegador)
- **Cálculo de delta marginal**: "adicionar esta célula muda aprovação em +X pp e inad em +Y pp"
