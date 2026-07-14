# Domínio Exibido ("Configurar nó")

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer no
> domínio efetivo exibido por losango/Cineminha (`effectiveDomain`, `nodeArrivals`,
> `domainModal`).

## Problema
O distinto do domínio de uma variável era sempre feito sobre a **base completa**, então um losango/Cineminha exibia todos os valores mesmo quando o fluxo a montante (Decision Lens, ports, outro losango) filtra a população. Ex.: variável `Score` que muda por grupo trazia `R01–R24` + `Com/Sem Restritivo` juntos, mesmo chegando só um grupo ao nó.

## Solução
O domínio completo continua guardado no shape (`rowDomain`/`colDomain`, ports). O que muda é **o que se exibe**, controlado por nó e de forma **não-destrutiva** (nada é apagado; ports/células escondidos continuam roteando na simulação).

- **Contagem reativa**: `computeNodeArrivals` (worker, junto do `COMPUTE_OVERLAY`) devolve `nodeArrivals = {[nodeId]: {val|row|col: {[valor]: qty}}}` — quantos registros chegam a cada nó por valor, respeitando o roteamento a montante. Armazenado no estado `nodeArrivals` (sem ref; usado em render/memo/modal).
- **Domínio efetivo** (helper global `effectiveDomain(fullDomain, cfg, counts)`):
  - `cfg === null` → **automático** (default): exibe só valores com `qty > 0`; *fallback* para o domínio completo se nada chega (nó recém-criado/sem upstream), pra nunca renderizar vazio.
  - `cfg === string[]` → **manual**: exibe exatamente esses (na ordem do domínio); fallback p/ completo se vazio.
- **Campos no shape**: `decision.visibleVals`, `cineminha.visibleRow`/`visibleCol` (todos `null` por default = automático).
- **Render**: `renderCinemaNode` usa `effectiveDomain` em `rDom`/`cDom`; ports de losango fora do domínio efetivo entram em `hiddenPortIds` (useMemo) e são pulados em `renderShape`/`renderConn`.
- **Modal `domainModal`** (`null | {shapeId, draft:{val?|row?|col?: null|string[]}}`): aberto pelo botão **⚙ Domínio** na toolbar contextual do losango e do Cineminha. Lista com check + valor + qtd. que chegou (por valor), multi-seleção, e o toggle **"Mostrar apenas valores com volume"** (= modo automático). Mexer em qualquer check vira modo manual. `applyDomainConfig` grava os campos `visible*` no shape (com `pushHistory`).
