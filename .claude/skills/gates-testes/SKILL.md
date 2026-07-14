---
name: gates-testes
description: Use SEMPRE antes de mudar código do motor de simulação, colunar, worker, Copilotos ou execução híbrida — para saber qual GATE (arquivo de teste) trava aquele domínio, rodar a suíte certa, e regenerar fixtures douradas com segurança. Também use se um GATE numérico falhar após uma mudança que deveria ser só estrutural/documentação: pare e investigue antes de regenerar.
---

# GATEs de teste — o que cada arquivo trava

O projeto usa **Vitest** (`tests/*.test.js`, jsdom, `npm test`) e **pytest**
(`tests_python/*.py`, protocolo do sidecar Python). Cada GATE trava uma
equivalência numérica ou estrutural específica — não são só "testes", são
provas de que um refactor/otimização não mudou a matemática do motor.

## Regra de ouro

**Nenhuma sessão de trabalho muda a matemática do motor.** Se um GATE
numérico falhar depois de uma mudança que deveria ser só estrutural ou de
documentação, **pare e investigue antes de regenerar fixtures**. Regenerar
"para fazer o teste passar" sem entender por que o número mudou é como se
introduz regressões silenciosas de cálculo (aprovação, inadimplência) que
só aparecem em produção.

## Tabela GATE → o que trava

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

## Comandos

```bash
npm test                    # roda toda a suíte Vitest (tests/*.test.js, jsdom) uma vez
UPDATE_GOLDEN=1 npm test    # regenera as fixtures douradas (golden), quando a mudança é legítima
pytest tests_python/        # roda os GATEs do sidecar Python
```

## Fixtures douradas — o que são e quando regenerar

`tests/segmentDiscoveryGolden.test.js` e `tests/clusterSegmentsGolden.test.js`
comparam a saída do worker (browser) contra fixtures pré-computadas em
`tests/fixtures/golden/` — são o GATE **cross-runtime** (DEC-HX-005): a
matemática precisa bater número a número entre o motor JS do worker e o
motor numpy do sidecar Python. Só regenere (`UPDATE_GOLDEN=1 npm test`)
quando a mudança nos parâmetros/algoritmo é **intencional e revisada** — nunca
como forma de "destravar" um GATE vermelho sem entender a causa.

## Fluxo recomendado antes de mexer num domínio

1. Consulte a tabela acima para achar o GATE do domínio que você vai tocar.
2. Rode `npm test` (ou o arquivo específico via `npx vitest run tests/<arquivo>`)
   **antes** de mudar código, para confirmar baseline verde.
3. Faça a mudança.
4. Rode o GATE de novo. Se ficou vermelho e a mudança pretendida era só
   estrutural/performance/documentação, **isso é sinal de regressão real** —
   pare, investigue o diff numérico, não regenere fixtures para calar o erro.
5. Só rode `UPDATE_GOLDEN=1 npm test` quando a mudança de output é esperada e
   você consegue explicar por quê.

## Onde ler mais

Tabela completa de GATEs também vive em `CLAUDE.md` § "GATEs de teste".
Detalhe de cada domínio (Goal Seek, Simplificação, Descoberta de Segmentos,
Clusterização, execução híbrida) tem seu próprio arquivo em `docs/claude/` ou
`docs/wiki/` — ver `CLAUDE.md` § "Onde vive o quê".
