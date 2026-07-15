# Estrutura de arquivos (árvore detalhada)

> Ponteiro a partir de: `CLAUDE.md` § Estrutura de arquivos (versão resumida). Esta
> página tem a árvore completa, com o comentário de cada arquivo — em especial a
> lista de `tests/*.test.js` com o que cada GATE trava (a mesma informação também
> aparece resumida na tabela de GATEs do `CLAUDE.md`).

```
AppCreditoSimulador/
├── src/
│   ├── App.jsx                   # Componente único — ~14600 linhas
│   ├── simulation.worker.js      # Web Worker: simulação, overlay, Pareto, Johnny, Goal Seek (~6800 linhas)
│   ├── columnar.js               # Armazenamento colunar do csvStore (typed arrays + dictionary encoding)
│   ├── goalSeek.js                # applyGoalSeekMoves — materialização de movimentos do Goal Seek (compartilhado worker/main)
│   ├── policySimplify.js          # applySimplifyCandidates — materialização de candidatos de Simplificação (compartilhado worker/main)
│   ├── clusterVar.js              # Variável de Cluster — sugestões de nome, def a partir do ClusterModel, descrição das regras (docs) e edição (compartilhado main/worker/teste; materialização em columnar.js)
│   ├── rangeVar.js                # Variável de Faixas (Épico FR) — espelho de clusterVar.js: sugestões de nome, def a partir do RangeModel, rótulos pt-BR canônicos, descrição das regras (docs) e edição de cortes/rótulos (compartilhado main/worker/teste; materialização deriveRangeColumn em columnar.js; propagação de refs reusa clusterVar.js)
│   ├── computeRouter.js           # Execução Híbrida H4 — ComputeRouter + contrato ComputeProvider (worker default / sidecar Python opt-in)
│   └── main.jsx                  # Entry point React
├── tests/                        # Vitest (jsdom)
│   ├── analytics.test.js         # autoBuckets, distinctDimValues, applyGroupingsToDataset, pivotWidget
│   ├── asIsPreview.test.js       # GATE: prévia AS IS contextualizada (computeCinemaAsIsCells) vs. base completa (computeAsIsCells)
│   ├── columnar.test.js          # GATE colunar: accessor, round-trip projeto, SharedArrayBuffer
│   ├── compiledEngine.test.js    # GATE M8: motor compilado (colunar) equivale ao caminho por string (legado)
│   ├── goalSeek.test.js          # GATE Copiloto Sessão 4: delta O(1) por movimento ≡ resimulação, precedência ordinal, restrições/travas, determinismo
│   ├── importPipeline.test.js    # GATE M1: import vetorizado equivale ao caminho legado (parse→normalize→append→buildColumnar)
│   ├── policyDoc.test.js         # GATE Copiloto Sessão 6: docModel ≡ motor (KPIs/funil), completude (todo nó/path), determinismo, degradação sem AS IS, privacidade (toggle de domínios), changelog via diffPolicyIR
│   ├── policyIR.test.js          # GATE Copiloto Sessão 0: roteamento via PolicyIR ≡ motor compilado (M8), round-trip IR→canvas→IR, IR sem posições/dados
│   ├── policySimplify.test.js    # GATE Copiloto Sessão 5: nó colapsável/chegada zero/regra sem efeito/variável re-testada ⇒ proposta prova diff=0; caso lossy ⇒ delta declarado bate com runSimulation
│   ├── policyTemplates.test.js   # GATE Copiloto Sessão 2: biblioteca de políticas — mapeamento de variáveis em base renomeada ≡ roteamento original; variável sem mapeamento vira pendência
│   ├── projectSave.test.js       # buildProjectJSONChunks ≡ JSON.stringify (M3)
│   ├── segmentDiscovery.test.js  # GATE Copiloto Sessão 10: subgrupo plantado achado com condições exatas; homogênea ⇒ zero; agregados ≡ matchLensRule; dispersion ≡ contagem por terminal; p-value binomial ≡ controle; FDR (BH); shrinkage rebaixa nicho; escopo por nó ≡ sub-base; dedup; determinismo
│   ├── segmentDiscoveryGolden.test.js # GATE Execução Híbrida H7 (DEC-HX-005): gera/verifica as fixtures douradas (SegmentModel sem recomendações ≡ segBuildModelWithoutRecs; colunar ≡ legado; determinismo); costura sidecar→worker (attachSegmentRecommendations ≡ computeSegmentDiscovery); clamp dos tetos browser
│   ├── clusterSegments.test.js   # GATE Execução Híbrida H8 (baseline browser): clusters plantados recuperados; perfil ≡ agregação manual; determinismo; colunar ≡ legado; clamp/truncamento declarados; degradação de features; mulberry32 especificado
│   ├── clusterSegmentsGolden.test.js  # GATE Execução Híbrida H8 (DEC-HX-005): gera/verifica as fixtures douradas do ClusterModel (determinismo; colunar ≡ legado; ≡ dourado commitado)
│   ├── clusterVar.test.js        # GATE Variável de Cluster: materialização (1D exata / 2D first-match-overlap / trim / fora dos grupos / dim ausente); sugestões de nome únicas; redação de regras (docs); edição (rename/toggle/move); propagação de refs (coluna/rótulo → losango/porta/Cineminha/lens); round-trip de persistência; integração ClusterModel real → def → coluna
│   ├── riskBands.test.js         # GATE Épico FR (motor computeRiskBands, FR4): cortes plantados ≡ DP exata maximizando IV; IV ≡ computeIV aplicado à mão; monotonia default/direção correta; toggle livre acha o "U" que o monotônico não pode (ambos os IVs); minShare bloqueia faixa anã ⇒ infeasible; banda "Sem valor" exata; auto-k para no ganho marginal; escopo por nó ≡ sub-base; determinismo
│   ├── rangeVar.test.js          # GATE Variável de Faixas (Épico FR, FR5): materialização (deriveRangeColumn — fronteiras exatas [min,max), ±∞, não parseável ⇒ unmatched, ordinal); rótulos pt-BR (formatBandLabel); edição de cortes com validação de ordenação estrita; round-trip de persistência; integração computeRiskBands real → def → coluna
│   ├── fixtures/segmentFixtures.js    # entradas do GATE dourado H7 (espelham as fixtures de segmentDiscovery.test.js)
│   ├── fixtures/clusterFixtures.js    # entradas dos GATEs H8 (clusters plantados 1D/2D+mix, truncamento, sem AS IS)
│   ├── fixtures/golden/               # fixtures douradas cross-runtime (entrada serializada M3 + SegmentModel/ClusterModel esperado; regenerar com UPDATE_GOLDEN=1)
│   └── workerPool.test.js         # GATE Execução Híbrida H3: pool ≡ single-worker número a número (Descoberta + Combinada) via pool mock (jobs fora de ordem); determinismo sob ordens de conclusão diferentes; fallback (pool null ≡ síncrono)
│   └── simulationTick.test.js    # GATE M6: passe único do tick ≡ composição das 4 funções originais
│   └── computeRouter.test.js      # GATE Execução Híbrida H4: Classe A jamais roteia; detecção (indisponível/lento/versão errada) silenciosa; Classe B sidecar (dataset por hash HEAD→POST, progresso) com fallback transparente na queda do job
├── docs/
│   ├── HANDOFF.md                # Documento de handoff para desenvolvimento corporativo
│   ├── claude/                   # Documentação em camadas para o Claude Code (esta pasta) — NÃO sincroniza com o GitHub Wiki
│   └── wiki/                     # Documentação sincronizada com GitHub Wiki
│       ├── Arquitetura.md
│       ├── Arquitetura-Execucao-Hibrida.md   # DEC-HX-001..009 — arquitetura do ComputeProvider (H0-H8)
│       ├── Hibrido-GoalSeek-Profundo.md      # DEC-GS-001..010 — Goal Seek Deep (GS1-GS6)
│       ├── Hibrido-Prompts-Sessoes.md        # prompts + resultado de cada sessão H0-H8
│       ├── Epicos-*.md
│       ├── Copiloto-*.md
│       ├── Otimizacao-Memoria.md # Plano de otimização de memória para datasets grandes
│       ├── PERFORMANCE-ANALISE.md # Backlog de performance M1–M15 (Fases A–D)
│       ├── SECURITY-AND-ENTERPRISE-READINESS.md
│       ├── Contexto-Claude.md    # Diagnóstico + plano de emagrecimento do CLAUDE.md (este épico, CTX)
│       ├── Roadmap.md
│       ├── Decisoes.md
│       └── _Sidebar.md
├── release/                      # Artefato de build (commitado via CI) — NÃO ler/varrer, exceto quando a tarefa é do sidecar
│   ├── index.html
│   ├── assets/
│   ├── iniciar.bat               # Abre a aplicação no navegador (Windows)
│   ├── serve.py                  # Servidor local COOP/COEP + monta o sidecar em /api/compute/*
│   ├── sidecar.py                # Execução Híbrida H5 — Motor Python (stdlib) importado por serve.py
│   ├── python/                   # Instalação do Motor Python (opt-in)
│   │   ├── requirements.txt      #   tier full (numpy/scipy) + extras (sklearn/duckdb)
│   │   ├── instalar_motor.bat    #   venv + pip do índice; wheels/ como contingência (P1)
│   │   ├── checar_ambiente.py    #   sonda HP (movida da raiz) — testa install/import na máquina
│   │   ├── motor_segmentos.py    #   H7 — Descoberta de Segmentos vetorizada em numpy (task segment_discovery, tier full)
│   │   ├── motor_clusters.py     #   H8 — Clusterização de Segmentos em numpy (task cluster_segments, tier full; sklearn como extra)
│   │   └── wheels/               #   wheels offline de CONTINGÊNCIA (vazia por padrão; só LEIAME)
│   └── ...
├── tests_python/                 # GATE H5 (pytest): protocolo do sidecar (health/token/caps/dataset/job)
│                                 # + GATE H7 (test_segment_discovery.py) e GATE H8 (test_cluster_segments.py): fixtures douradas número a número no motor Python
├── .github/workflows/
│   ├── build-release.yml         # Build automático em push para main → commit em release/
│   ├── test-sidecar.yml          # Job SEPARADO e OPCIONAL: pytest do sidecar (não bloqueia o build)
│   └── sync-wiki.yml             # Sincroniza docs/wiki/ com o GitHub Wiki
├── vite.config.js                # Build config + injeção de metadados de build
├── vitest.config.js              # Config dos testes (jsdom)
├── Amostra_Fake.csv              # Amostra real usada por GATEs (ex.: tests/compiledEngine.test.js)
├── package.json
└── index.html
```
