# Descoberta de Segmentos (Copiloto Sessão 10/11/12, motor + UI — DEC-SD-001..006)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer no
> motor de subgroup discovery, nos achados/recomendações ou na aplicação
> combinada. A profundidade 3–4 no sidecar (Classe B, H7) é ponteiro só para a
> wiki — ver nota no fim deste arquivo.

Motor de **subgroup discovery** que varre a base (ou a população de um nó) procurando
segmentos acionáveis onde a política atual está desalinhada com o comportamento observado.
Ver `docs/wiki/Copiloto-DescobertaSegmentos.md`. **Sessão 10 = motor de descoberta/explicação/
priorização + GATE; Sessão 11 = UI (modal, cards, quadrante); Sessão 12 = recomendações
materializáveis (patch + re-simulação real), aplicação combinada, achados `asis_divergence`/
`anomaly`, selo de estabilidade temporal e o movimento "adicionar quebra" do Goal Seek.**

## SegmentModel (padrão `docModel` — dados crus, nunca prosa)
`COMPUTE_SEGMENT_DISCOVERY` (worker) devolve:
```js
{
  version, generatedAt, scope,            // null (global) | {nodeId, label}
  metric: {id, label, direction},         // métrica-alvo resolvida (DEC-SD-006)
  population: {qty, decidedQty},
  findings: [SegmentFinding],             // ordenados por prioridade
  diagnostics: {candidatesTested, discarded:{lowVolume, notSignificant, unstable, duplicate, noOpportunity}},
}
  asIsTotals: {rToA, aToR},               // totais de promoções/rebaixamentos (Sessão 12)
}
// SegmentFinding = { id, code, segment:{conditions:LensRule[], scope}, metrics, explanation, priority, recommendation }
//   code: 'approvable_low_risk' | 'approved_high_risk' | 'heterogeneous_block' | 'asis_divergence' | 'anomaly'
//   metrics: {qty, share, qtdAltas, qtdAltasInfer, inadReal, inadInferida, refInadReal, refInadInferida, lift, currentDecision}
//     asis_divergence: {qty, share, rToA, aToR, rToAShare, aToRShare} · anomaly: {qty, share, rate, median, mad, z, temporal}
//   explanation: {contributions:[{col,value,sharePct}], dispersion:{...}, stability:null|{split:'temporal',holds}, stabilitySeries?:[{bucket,rate}], pValue, qValue}
//   priority: {score, impact:{deltaApproval, deltaInadInf, movedQty}, confidence, actionability}
//   recommendation: null | { kind:'goal_seek_move'|'add_break', targetTerminal, actionable, reason,
//                            apply:{moves:[...]}, goalSeek:{target,direction,magnitude,minimize}, delta }  (ver Sessão 12)
```
Segmento = **conjunção de `LensRule`** sobre colunas Filtro (DEC-SD-001) — imediatamente
interpretável e materializável (vira losango/Cineminha/movimento de Goal Seek na Sessão 12).

## Seletor de variáveis (checklist do modal, `params.excludedCols`)
Colunas Filtro de cohort/vintage (mês/safra de referência) e de score custam mais do que
ajudam como candidatas ao beam search: a primeira reflete quando a proposta entrou, não
quem ela é (achado "mês X é mais arriscado" não é acionável e pode ser leakage de safra
imatura), a segunda costuma já ser o próprio risco (circular) ou já estar em uso em outro
nó da política. `openSegmentDiscoveryModal` (`App.jsx`) lista a união das colunas
`'decision'` de todas as bases carregadas e pré-desmarca as que batem com
`segVarDefaultReason(colName)` (heurística por tokens do nome — `mes/mês/ano/safra/
vintage/periodo/competencia/data` ⇒ `'temporal'`; `score/rating/bureau` ⇒ `'score'`);
demais nascem marcadas. O checklist ("Variáveis incluídas na busca", com badge 🕐/🎯 na
razão do default) é só o estado INICIAL — o usuário marca/desmarca livremente antes de
buscar. `runSegmentDiscovery` envia `params.excludedCols` (nomes de coluna) só quando não
vazio; `discoverSegments` (worker, `simulation.worker.js`) filtra `candCols` por ele antes
do beam search — mesmo filtro replicado em `release/python/motor_segmentos.py`
(`excluded_cols`) para o caminho profundo (H7, Classe B) não divergir do browser.

## Pipeline (três estágios desacoplados, testáveis)
- **`discoverSegments`** — beam search 1D→`maxDepth` (default 2) sobre os **dicionários** das
  colunas Filtro (`candidateCoder`/agregação O(distintos), PODADO — nunca produto cartesiano
  cego). Escopo global (`scope==null`) ou por nó (`scope.nodeId`): as linhas do escopo saem
  de um **walk compilado M8** (raiz do motor, como `runSimulation`) que também registra, por
  linha, o **terminal** e o **nó decisor** — base da `dispersion` (sem passe extra). Winner =
  csv de maior população no escopo (mesmo critério de `computeVariableRanking`; multi-csv é
  extensão). Devolve os candidatos crus + `ctx` compartilhado.
- **`explainSegment`** — decomposição **WoE aditiva** por condição (reusa a matemática
  good/bad de `computeIV`), **lift** vs. complemento, **teste binomial** de proporção
  (`segBinomTwoSided`: exato até `n≤1000`, aproximação normal acima) e **`dispersion`** ("por
  que nunca vi isso antes": em quantos nós/terminais a política decide o segmento hoje).
- **`prioritizeFindings`** — **FDR Benjamini–Hochberg** (`segBenjaminiHochberg`) sobre TODOS
  os candidatos de desvio testados; gate de significância (`qValue ≤ alpha`) + de oportunidade
  (código atribuído); **score = impacto × confiança × acionabilidade** (shrinkage `SHRINK_K`
  proporcional ao volume do escopo, penalidade por profundidade e por nó 🔒 travado); **dedup**
  de filho aninhado sem ganho incremental de |desvio| sobre o pai (parcimônia); `diagnostics`
  com contadores de descarte.

## Métrica-alvo estruturada (DEC-SD-006)
`resolveRiskMetric(riskMetric)` → `{numColType, denColType, direction, ...}`. O formulário só
oferece `inadReal`/`inadInferida` por ora, mas **nenhuma função interna assume inad** — todas
leem `numColType`/`denColType` genericamente (margem/churn/CAC são extensão do wizard, não do
motor).

## Achados desta sessão
- **`approvable_low_risk`**: segmento hoje **reprovado** com risco significativamente MENOR que
  a referência (aprovação deixada na mesa).
- **`approved_high_risk`**: simétrico — hoje **aprovado** com risco maior (vazamento de risco).
- **`heterogeneous_block`**: bloco de **tratamento único** (não `mixed`) internamente
  heterogêneo (IV ≥ `SEG_HET_MIN_IV` numa coluna candidata) — a "quebra que falta". Emitido no
  nível do escopo (depth-0); `contributions` = colunas discriminantes por share de IV.

## Recomendações materializáveis (Sessão 12 — estágio 4, DEC-SD-003)
`buildSegmentRecommendations(shapes, conns, csvStore, findings, ctx)` anexa a cada achado
acionável (deviation com código, `heterogeneous_block`) uma `recommendation` com **patch +
delta VALIDADO por re-simulação real** (`runSimulation` antes/depois — só top-N `SEG_MAX_VALIDATE`;
o card só exibe delta validado). **Nenhum aplicador novo** (DEC-IA-002): os patches são
movimentos do catálogo do Goal Seek (`applyGoalSeekMoves`):
- **`segCoincidenceMove`** — quando o segmento 1D coincide com um valor decidido DIRETO por um
  losango (port → terminal, via `resolveDirectTerminalConn`), a recomendação é um movimento
  `decision_terminal` (troca só aquele terminal).
- **`segBuildBreakMove`** — senão, o movimento NOVO **`add_break`** (a "quebra que falta"
  pendente da Sessão 4): insere um losango (1 condição / het) ou Cineminha (2 condições)
  ANTES do nó âncora (root do escopo ou nó de escopo), roteando o sub-segmento acionável ao
  terminal alvo e o resto de volta ao âncora. Materializado por `applyGoalSeekMoves` (em
  `src/goalSeek.js`, `genId` opcional) — mesma função/validador usado pela main no "Aplicar
  como novo cenário" (`applySegmentRecommendation` → `cloneCanvasWithNewIds` + `applyGoalSeekMoves`).
- `recommendation.goalSeek` pré-carrega o objetivo estruturado para **🎯 Enviar ao Goal Seek**
  (`sendSegmentToGoalSeek` abre o `goalSeekModal`); nó 🔒 travado ⇒ `actionable:false` + `reason`
  declarado, sem delta.

## Aplicação combinada (`computeSegmentCombined`, `COMPUTE_SEGMENT_COMBINED`)
Aplica N recomendações selecionadas **em sequência sobre UM clone** e valida por **UMA
re-simulação real** — **nunca a soma dos deltas individuais** (aplicar A muda a população que
chega ao ponto de B). Devolve `combinedApprovalDelta`/`combinedMovedQty` (união, re-simulada) +
`sumApprovalDelta`/`sumMovedQty` (soma dos isolados) + `interaction:{interacts, overlapQty, note}`
— o modal DECLARA a sobreposição em vez de escondê-la. Main: `runSegmentCombined` (seleção via
checkbox "combinar" no card) e `applySegmentCombinedAsScenario`.

## asis_divergence e anomaly (Sessão 12 — sem patch, só navegação)
- **`asis_divergence`** (`detectAsIsDivergence`): decompõe o rToA/aToR (promoções/rebaixamentos
  vs. AS IS) por valor de segmento, reusando o desfecho por linha do escopo + `__DECISAO_ORIGINAL`.
  A soma ≡ `incrementalResult.impacted` (GATE). `metrics: {rToA, aToR, rToAShare, aToRShare}`.
- **`anomaly`** (`detectAnomalies`): desvio robusto **mediana/MAD** (modified z-score ≥
  `SEG_ANOMALY_Z`) por valor e por **safra** (quando há coluna temporal). Sinalização de
  qualidade de dado. `metrics: {rate, median, mad, z, temporal}`.
- Ambos: `recommendation: null`; ação = **👁 Ver no Dashboard** (`FilterCard`) / **🎯 Ver no fluxo** (highlight).

## Estabilidade temporal (`attachStability`)
Selo split-half por período (`stability:{split:'temporal', holds}`) + `stabilitySeries` (sparkline
no card, `SegmentSparkline`) quando há coluna temporal; sem ela ⇒ `stability:null` (nunca inventado).

## Comportamento
Determinístico (mesma entrada ⇒ mesmo `SegmentModel`, incl. recomendações/deltas); agregados e
deltas sempre da agregação/re-simulação exata (nunca estimados); `segmentDiscoveryModal` efêmero
(não persiste — sem criação do usuário; ⚠️ regra do CLAUDE.md não se aplica).

## Teste
`tests/segmentDiscovery.test.js` — GATE: subgrupo plantado achado com condições exatas;
homogênea ⇒ zero achados; agregados ≡ `matchLensRule`; `dispersion` ≡ contagem manual por
terminal; p-value ≡ controle binomial manual; BH monótono; shrinkage rebaixa nicho; escopo por
nó ≡ sub-base; dedup; **delta exibido ≡ `runSimulation` antes/depois por tipo de recomendação
(add_break 1D/2D, movimento)**; **movimento `add_break` ≡ criação manual equivalente**; **delta
COMBINADO ≡ re-simulação dos N patches, e difere da soma dos individuais em fixture que interage**;
**`asis_divergence` ≡ `incrementalResult.impacted` agregado**; **anomaly (mediana/MAD)**; **selo de
estabilidade temporal**; **nó travado ⇒ recomendação não acionável**; determinismo.

## Descoberta profunda no sidecar (Execução Híbrida H7)
A extensão de profundidade 3–4 / beam ampliado, rodando no sidecar Python (Classe B), é
documentação normativa já coberta por `docs/wiki/Arquitetura-Execucao-Hibrida.md`
(DEC-HX-005/007) e `docs/wiki/Hibrido-Prompts-Sessoes.md` (Sessão H7) — não duplicada
aqui. Ponto local relevante: as recomendações continuam **single-sourced no worker**
mesmo quando a descoberta roda no sidecar (mensagem `COMPUTE_SEGMENT_RECS`, ver
`docs/claude/Worker-Protocolo.md`).
