# Reorganização Automática (Auto Layout)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer em
> `autoLayout()` ou nas heurísticas de posicionamento do canvas.

`autoLayout()` (botão **⊹ Reorganizar** na toolbar) é um layout em camadas estilo Sugiyama, sempre **horizontal (esquerda → direita)** porque as portas saem sempre pelo lado direito do nó.

### Classificação dos nós
- **Portas** (`type:'port'`): nunca entram no grafo de camadas; são posicionadas como filhas do nó dono.
- **Nós de fluxo**: parents que possuem ao menos uma aresta (via porta) para **outro** parent.
- **Parqueados** (área lateral): `csv` e `simPanel` (sempre, definidos em `NON_FLOW`) + fragmentos isolados (sem nenhuma conexão a outro parent). Um nó alcançado por uma porta do fluxo deixa de ser isolado e entra no fluxo.

### Conceito de *cluster*
Cada parent + sua coluna de portas forma um cluster:
- `clusterW = w + (PORT_GAP_X + maxPortW)` → a largura da coluna inclui as portas, então a próxima camada nunca sobrepõe as portas.
- `clusterH = max(h, somatório das alturas das portas + gaps)` → o empilhamento vertical reserva espaço para a pilha de portas.

### Pipeline
1. **Camadas**: longest-path a partir das fontes (Kahn). Ciclos → fallback camada 0.
2. **Redução de cruzamentos**: ordenação por baricentro (8 sweeps alternando ↓/↑).
3. **X por camada**: cumulativo, somando `clusterW` + `GAP_X`.
4. **Y por nó**: regressão isotônica (PAVA) puxando cada nó para o baricentro dos vizinhos, mantendo ordem e gap mínimo (16 sweeps alternando ↓ usa predecessores / ↑ usa sucessores). Garante alinhamento lógico filho↔pai sem sobreposição.

### Portas
Sempre à **direita** do nó (`x = parent.x + w + PORT_GAP_X`), empilhadas e centradas verticalmente no nó, ordenadas pelo Y do destino downstream (reduz cruzamento das setas).

### Área de parking
À direita de todo o fluxo (`flowRight + PARK_GAP_X`), empilhada **verticalmente** com gaps uniformes (`PARK_GAP_Y`), alinhada à esquerda. Portas de nós parqueados também ficam à direita deles.

### Consciência dos "balões" das arestas (edge labels)
Cada aresta renderiza, no ponto médio da bezier, um **balão**: a caixa do label do domínio (altura 20) + (com a simulação rodando) o chip de `volume · inad.real · inad.inferida` empilhado logo abaixo (altura 14). Como o balão fica no **ponto médio**, arestas que saem de um mesmo nó têm seus balões a **meio passo vertical** de distância — se os nós ficam colados, os balões se sobrepõem.

`autoLayout` mede cada balão (`balloonOf` espelha a lógica de `renderConn`, respeitando os toggles `showEdgeVol/InadReal/InadInf` e o `simResult.edgeStats` atuais via refs) e infla os vãos:
- **`portGapY[node]` (vertical, por nó)**: o passo entre portas empilhadas (`pt.h + portGapY`) é forçado a ≥ `2 × (maiorBalãoIncidente + BALLOON_VPAD)`, porque o balão nó→port fica a meio passo. Cobre o leque saindo do losango e o funil entrando em Aprovado/Reprovado.
- **`portGapX[node]` (horizontal, por nó)**: agora dimensionado pela **largura do balão** (label OU chip de analytics, o que for mais largo), não só pelo label.
- **`gapX` (entre camadas)**: `max(GAP_X, maiorBalãoW + BALLOON_HPAD)` — o balão port→nó cabe no vão entre camadas.
- **`gapY` (entre clusters)**: `max(GAP_Y, maiorBalãoH + BALLOON_VPAD)`.

Sem labels/simulação (`balloonH = 0`), tudo recai nos valores-piso e o comportamento é o de antes.

### Constantes (locais em `autoLayout`)
`ORIGIN_X/Y=80`, `PORT_GAP_X_MIN=96`, `PORT_GAP_X_MAX=260`, `PORT_GAP_Y=16` (piso), `GAP_X=96` (piso), `GAP_Y=36` (piso), `PARK_GAP_X=160`, `PARK_GAP_Y=44`, `BALLOON_VPAD=6`, `BALLOON_HPAD=18`. `PORT_GAP_Y`/`GAP_X`/`GAP_Y` viram pisos; os valores efetivos (`portGapY`/`gapX`/`gapY`) crescem com os balões. Animação via RAF (`DURATION=600`, easeInOut), com `pushHistory()` antes de aplicar.
