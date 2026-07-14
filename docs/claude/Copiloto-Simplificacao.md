# Simplificação com Prova de Equivalência (`simplifyModal`, Copiloto Sessão 5)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer nos
> detectores de simplificação ou na prova de equivalência linha a linha.

Generaliza o padrão de detecção estrutural da Sessão 1 (`computePolicyInsights`) para
**propor** uma política reduzida — não só apontar o achado, mas religar o roteamento e
**provar** que a redução não muda nenhuma decisão. Ver `docs/wiki/Copiloto-SugestoesMelhoria.md`
(Sessão 5) e `docs/wiki/Epicos-CopilotoIA.md` (DEC-IA-005/006).

## Catálogo de candidatos (`detectSimplifyCandidates`, worker)
Cada candidato carrega um `apply` mínimo (nunca referencia x/y/layout), materializável por
`applySimplifyCandidates` (**`src/policySimplify.js`** — módulo compartilhado worker/main,
mesmo motivo de `src/goalSeek.js`: os dois precisam da MESMA lógica de aplicação sem se
importar um ao outro):
- **`collapsible_node`**: losango cujos valores TODOS roteiam pro mesmo destino final (via
  `resolveThroughPortsSimplify`, mesma semântica de `resolveThroughPorts` do PolicyIR);
  Cineminha cujos ports Elegível/Não Elegível vão pro mesmo destino; ou Decision Lens cuja
  regra deixa passar 100% do volume que chega (**`lens_no_effect`** — mesmo código de
  achado distinto, mas reusa o `apply` de `collapsible_node`, já que a operação é idêntica:
  colapsar o nó pro próprio destino). `apply: {type:'collapse_node', nodeId, destId}` —
  religa as arestas de ENTRADA do nó direto pro destino e remove o nó + portas próprias
  (as únicas apontadas exclusivamente por ele).
- **`zero_arrival_node`**: losango/Cineminha (via `nodeArrivals` do tick — `totalArrivalOf`
  soma os valores/eixo) ou Decision Lens (via `computeLensStats`, um walk DEDICADO — o
  `nodeArrivals` do tick não cobre lens) que nunca recebe volume na base atual. `apply:
  {type:'prune_node', nodeId}` — remove o nó + descendentes EXCLUSIVOS (sem outra entrada
  externa sobrevivente, cascata por ponto fixo).
- **`redundant_variable`**: losango D2 que retesta a MESMA coluna+csv já decidida por um
  losango D1 a montante, alcançado por uma cadeia DIRETA de ports a partir de um valor
  FIXO v — quem chega aqui já tem coluna==v (garantido por D1), então D2 só pode
  discriminar o próprio ramo de v; os demais nunca chegam. `apply: {type:'reroute_edge',
  connId, newTo}` — religa só a aresta específica (a que liga o último port da cadeia a
  D2) pro destino que D2 daria pra esse v; D2 em si não é removido (pode ser alcançado por
  outros caminhos).

**Limitação importante**: um nó que é ele mesmo a ÚNICA raiz do fluxo (sem nó a montante)
não pode virar candidato `collapsible_node`/`lens_no_effect` de forma útil — o motor exige
pelo menos um nó decision/cineminha/lens como raiz pra sequer começar a andar pela base
(`runSimulation`: `rootNodes.length===0` ⇒ nenhuma linha é processada); colapsar a raiz
única pra um terminal quebraria a política inteira. Os detectores não têm essa
restrição explícita — quem barra esse caso é a validação incremental abaixo (o candidato
é descartado por falhar a prova, nunca aplicado incorretamente).

## Prova de equivalência (`computeSimplifyEquivalence`, worker)
Compara o **desfecho por linha** de duas políticas via `computeRowOutcomes` (mesma
classificação de `runSimulation`, incl. fallback de AS IS via `__DECISAO_ORIGINAL`) — não
só os agregados, já que dois canvases podem empatar na taxa de aprovação com decisões
trocadas por baixo (troca quem é aprovado, sem mudar a soma). `identical` só é `true` com
`diffCount===0` (TODAS as linhas de TODOS os csvs decidem igual). Quando não é idêntico,
o `delta` reportado vem de `runSimulation` antes/depois de VERDADE — nunca estimado
(DEC-IA-005, mesmo contrato de validação do Goal Seek).

## Aceitação incremental (`computeSimplify`, worker)
Cada candidato do catálogo é validado um de cada vez, GREEDY, contra o estado JÁ ACEITO
(não contra o canvas original): só entra na proposta final se preservar `diff=0` sobre
esse estado intermediário. Por transitividade de igualdade linha a linha, a proposta final
inteira é `diff=0` contra a política ORIGINAL — a prova real do épico — **sem depender de
os detectores serem perfeitos**: um candidato que não é seguro (por interação com outro já
aceito, ou por ser a raiz única do fluxo — ver limitação acima) é descartado
silenciosamente, nunca contamina a proposta. Retorna:
```js
{
  proposal: {
    candidates,          // SimplifyCandidate[] aceitos — {id, code, nodeId, label, apply}
    consideredCount,     // total de candidatos detectados (incl. os rejeitados)
    totalNodeCount,       // shapes.length original
    removedNodeCount,     // quantos shapes a proposta remove
  },
  equivalence: { identical, diffCount, totalRows, delta },
}
```

## Estado `simplifyModal`
```js
null | {
  step: 'loading' | 'result',
  proposal,      // devolvido por SIMPLIFY_RESULT
  equivalence,   // devolvido por SIMPLIFY_RESULT
}
```
Sem etapa de formulário (ao contrário do `goalSeekModal`) — não há objetivo a declarar, só
a política atual a reduzir; **🧹 Simplificar** dispara `COMPUTE_SIMPLIFY` direto.

## Ativação e aplicação
Botão **🧹 Simplificar** na seção Fluxo do painel direito (`openSimplifyModal`) dispara
`COMPUTE_SIMPLIFY` direto (sem formulário); o resultado lista as simplificações propostas
(ícone + rótulo por tipo, `SIMPLIFY_CODE_META`) e a prova (✅ idêntica / ⚠ delta
declarado); **✓ Aplicar como novo cenário** (`applySimplifyResult`) materializa os
candidatos aceitos numa aba de canvas **nova** (`cloneCanvasWithNewIds` +
`applySimplifyCandidates`, mesmo padrão não-destrutivo do Goal Seek/Sub-sessão 5A) — a
política de origem fica intocada, comparável imediatamente no Dashboard/KPI A vs B.

## Teste
`tests/policySimplify.test.js` — GATE: nó colapsável (losango e Cineminha) ⇒ proposta
reduz e `computeSimplifyEquivalence` prova `diff=0`; nó com chegada zero (losango/Cineminha
via `nodeArrivals`, Decision Lens via `computeLensStats`) ⇒ removível sem alterar nenhuma
decisão; regra de lens sem efeito e variável re-testada ⇒ detectados e colapsados/religados
sem perda; prova de equivalência **lossy** (par de canvases deliberadamente diferente,
testando a primitiva `computeSimplifyEquivalence` direto, sem passar pelo detector) ⇒
`diffCount` e `delta` batem com o cálculo manual via `runSimulation` antes/depois;
determinismo (mesma entrada ⇒ mesma proposta).
