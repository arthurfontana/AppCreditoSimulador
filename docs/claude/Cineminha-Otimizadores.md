# Otimizadores de Cineminha — Motor de Recomendação (`optimModal`) e Johnny (`johnnyModal`)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer nos
> otimizadores single/multi-Cineminha (fronteira Pareto, cenários, greedy com
> precedência).

## Motor de Recomendação — Cineminha (`optimModal`)

### Ativação
Selecionar um nó `cineminha` exibe toolbar contextual com botão **⚙ Otimizar Decisão** (único Cineminha selecionado) ou **⚡ Otimização Johnny** (2+ Cineminhas selecionados).

### Estado `optimModal` (single cineminha)
```js
{
  shapeId,           // id do cineminha sendo otimizado
  cellMetrics,       // {[cellKey]: {qty, qtdAltas, qtdAltasInfer, inadRRaw, inadIRaw, inadReal, inadInferida}}
  frontier,          // array de pontos Pareto ordenado por approvalRate crescente
  scenarios,         // {conservador, balanceado, melhorEficiencia, expansao}
  activeCard,        // 'conservador' | 'balanceado' | 'melhorEficiencia' | 'expansao' | 'personalizado'
  proposedCells,     // {[cellKey]: boolean} — estado em edição (não aplicado ao canvas)
  sliderApprovalIdx, // índice no array frontier (não ratio direto)
  sliderInadReal,    // ratio 0–1 (restrição de teto)
  sliderInadInf,     // ratio 0–1 (restrição de teto)
  maxInadReal,       // valor máximo observado nas células
  maxInadInf,        // valor máximo observado nas células
  matrixZoom,        // zoom da grade de células no modal
  matrixPanX,        // pan horizontal da grade
  matrixPanY,        // pan vertical da grade
}
```

### Cenários
| Card | Label | Fonte |
|------|-------|-------|
| 🛡 Conservador | pré-computado | `scenarios.conservador` (menor inad) |
| ⚖ Balanceado | pré-computado | `scenarios.balanceado` (1/4 da curva) |
| ⚡ Melhor Eficiência | pré-computado | `scenarios.melhorEficiencia` (joelho da curva) |
| 🚀 Expansão | pré-computado | `scenarios.expansao` (maior aprovação) |
| 🎛 Personalizado | manual | ativo ao mover slider ou clicar célula |

### Aplicar
`applyOptimResult(shapeId, proposedCells)` — sobrescreve `cells` do Cineminha via `setShapes` e fecha o modal. Não-destrutivo: nenhuma alteração no canvas até o clique em "Aplicar".

## Otimizador Multi-Cineminha — Johnny (`johnnyModal`)

### Ativação
Com 2 ou mais nós Cineminha selecionados, a toolbar contextual exibe **⚡ Otimização Johnny (N)**. Dispara `COMPUTE_JOHNNY` no worker com todos os shapes do canvas, os IDs dos cineminhas selecionados e as conexões (as populações de lens são derivadas no worker — M10).

### Algoritmo (Sessão C — DEC-JO-003/004)
1. **Pool de métricas**: agrega células de **todos** os Cineminhas selecionados via `computeCinemaArrivals` (populações filtradas pelo grafo de fluxo)
2. **Grafo de precedência**: (a) monotonicidade interna por eixo ordinal — `(i,j)` exige `(i-1,j)` e `(i,j-1)` no mesmo Cineminha; (b) aninhamento de cascata — `(i,j)` no nível L exige `(i,j)` no nível L−1 (mais seguro, `hierarchyMode='cascata'`); modo `independente` usa só (a)
3. **Greedy com precedência**: a cada passo, entre as células **liberadas** (precedências satisfeitas), abre a de menor inadimplência suavizada (`inadMetric`: inferida ou real); desempate por `qty` desc; suavização bayesiana (shrinkage em direção à média do pool) com `SHRINK_K = 10%` do volume médio — evita inversões por ruído amostral; fallback sem inad: rank hierárquico de nível + posição ordinal interna
4. **Mix de risco**: se coluna `mixRisco` presente, acumula distribuição por categoria por ponto da fronteira
5. **Scenarios**: `{conservador, melhorEficiencia, expansao}` via joelho da curva

### Estado `johnnyModal`
```js
{
  pooledMetrics,        // {[`${shapeId}|${cellKey}`]: CellMetricExtended}
  frontier,             // pontos Pareto globais
  scenarios,            // {conservador, melhorEficiencia, expansao}
  mixCats,              // categorias de mix de risco encontradas
  shapeMetas,           // [{id, label, rowVar, colVar, rowDomain, colDomain, originalCells}]
  baselineApprovalRate, // taxa de aprovação com células atuais
  activeCard,           // card ativo
  proposedByShape,      // {[shapeId]: {[cellKey]: boolean}} — estado em edição
  sliderApprovalIdx,    // índice no frontier
  sliderInadReal,
  sliderInadInf,
  maxInadReal,
  maxInadInf,
  activeShapePreview,   // id do cineminha selecionado no preview de células
  riskLevels,           // {[shapeId]: number} — nível de risco manual (DEC-JO-002); maior = mais restritivo; default = ordem dos selecionados (1,2,3...)
  hierarchyMode,        // 'cascata'|'independente' (DEC-JO-003); default 'cascata'
  inadMetric,           // 'inferida'|'real' (DEC-JO-004); default 'inferida'
}
```

### Resgatar AS IS
Botão **↺ Resgatar AS IS** no rodapé do `johnnyModal` (habilitado só quando algum
dataset dos cineminhas tem `__DECISAO_ORIGINAL`): preenche `proposedByShape` de todos
os cineminhas via `computeAsIsCells` (baseline da decisão histórica — caselas com
aprovação ficam elegíveis; só as 100% reprovadas ficam não elegíveis), recalcula o
índice de slider mais próximo e marca `activeCard='personalizado'`. É apenas proposta
até clicar em **⚡ Aplicar**.

### Aplicar
`applyJohnnyResult(proposedByShape)` — sobrescreve `cells` em múltiplos Cineminhas simultaneamente (grava `cellsUserEdited=true`).
