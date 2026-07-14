# Decision Lens

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer no
> filtro de sub-população (`decision_lens`, `lensPopulations`, `computeLensPopulations`).

## Propósito
Segmentar uma sub-população da base histórica e aplicar regras diferentes a ela. O Decision Lens não filtra o fluxo — ele **marca** quais linhas devem ser processadas pelo fluxo subsequente.

## Populações de lens (M10 — no worker)
Derivadas **no worker** a partir das regras dos shapes `decision_lens` (helper
`computeLensPopulations`, memoizado por `csvStoreVersion` + regras dos lens via
`getLensPopulations`), como `Uint8Array` por lens×csv (1 byte/linha):
```js
// worker: {populations: {[lensId]: {[csvId]: Uint8Array}}, counts: {[lensId]: {count, total}}}
// populations[lensId][csvId][rowIndex] === 1 se a linha passa pelas regras do lens
```
A main **não** computa nem mantém as populações por-linha (antes um `useMemo` que varria
~1MM linhas e clonava `Array<boolean>` pro worker a cada tick). Ela recebe só as `counts`
no `OVERLAY_RESULT` (estado `lensCounts`) para o rótulo do nó. As demais funções do worker
que roteiam por lens (`computeSimulatedDecisions`, `computeCinemaArrivals`,
`computeNodeArrivals`) avaliam `rowMatchesLensRules` sobre `node.rules` diretamente.

## Fluxo no motor
Em `traverseRow`, quando o nó é `decision_lens`:
1. Avalia `rules` da linha via `rowMatchesLensRules`
2. Se **passa**: segue para a saída única do nó
3. Se **não passa**: retorna `null` (linha não processada por este fluxo)
