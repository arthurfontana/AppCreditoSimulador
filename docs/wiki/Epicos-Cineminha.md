# Épico: Cineminha (Matriz Cruzada)

## O que é

O Cineminha é um nó especial do canvas que cruza duas variáveis de decisão em uma matriz. Cada célula da matriz representa uma combinação de valores e pode ser marcada como **Elegível** ou **Não Elegível**.

É o equivalente visual de uma tabela de decisão bidimensional — "para clientes com score entre R1–R5 e renda na faixa X, aprovamos?"

---

## Estrutura de dados

```js
{
  id,
  type: "cineminha",
  x, y, w, h,
  label: "Cineminha",
  rowVar: null | { col, csvId },   // variável no eixo de linhas
  colVar: null | { col, csvId },   // variável no eixo de colunas
  rowDomain: string[],             // valores distintos ordenados do eixo linha
  colDomain: string[],             // valores distintos ordenados do eixo coluna
  cells: {
    [`${rowVal}|${colVal}`]: boolean  // true = Elegível, false = Não Elegível
  }
}
```

- Chave 1D (apenas linha): `"${rowVal}|*"`
- Chave 1D (apenas coluna): `"*|${colVal}"`
- Criado automaticamente com dois ports filhos: `"Elegível"` (verde) e `"Não Elegível"` (vermelho)

---

## Estados visuais

| Estado | Condição | Visual |
|--------|----------|--------|
| Vazio | `rowVar = null` e `colVar = null` | Ícone ⊞ + instrução de drag |
| 1D linha | Só `rowVar` definida | Coluna única de células |
| 1D coluna | Só `colVar` definida | Linha única de células |
| 2D | Ambas definidas | Matriz completa |

---

## Como usar

1. Arrastar um chip de variável do painel direito **sobre** o nó Cineminha
2. Modal pergunta: **Linha ou Coluna?**
3. A função `assignCinemaVar` atribui a variável, recomputa o domínio e reconstrói `cells`
4. Clicar em uma célula alterna entre Elegível (verde) e Não Elegível (vermelho)
5. Conectar os ports de saída ao fluxo normalmente

---

## Motor de Otimização (`optimModal`)

### Ativação

Selecionar um nó Cineminha exibe na toolbar contextual o botão **⚙ Otimizar Decisão**.

### O que ele resolve

Dado o tradeoff entre aprovar mais (volume) e manter inadimplência baixa (risco), o motor encontra automaticamente as melhores combinações de células a aprovar usando a **fronteira de Pareto**.

### Algoritmo (fase 1 — variáveis categóricas)

**Passo 1 — `computeCellMetrics`**

Para cada célula `(rowVal, colVal)` do domínio:
- Filtra as linhas do CSV que correspondem à célula
- Agrega: `qty`, `qtdAltas`, soma de `inadReal` ponderada, soma de `inadInferida` ponderada
- Calcula taxas finais: `inadReal = inadRRaw / qtdAltas`, `inadInferida = inadIRaw / qty`

**Passo 2 — `buildParetoFrontier`**

1. Ordena células por `inadInferida` crescente (nulls ao final)
2. Varre acumulando: a cada passo adiciona a célula de menor inadimplência ao conjunto aprovado
3. Calcula `approvalRate`, `inadReal` e `inadInferida` acumuladas em cada passo
4. Retorna array de pontos da fronteira, ordenado por `approvalRate` crescente

**Passo 3 — `extractScenarios`**

Extrai 3 pontos representativos da fronteira:
- **Conservador**: primeiro ponto (menor inadimplência, menor aprovação)
- **Máximo**: último ponto (maior aprovação, maior inadimplência)
- **Médio (joelho)**: ponto de máxima distância perpendicular à reta conservador–máximo — o "cotovelo" da curva, onde o ganho de aprovação começa a custar muito em inadimplência

### Estado do modal

```js
{
  shapeId,
  cellMetrics,     // métricas por célula
  frontier,        // array de pontos Pareto
  scenarios,       // { conservador, medio, maximo }
  activeCard,      // card selecionado
  proposedCells,   // células em edição (não aplicadas ao canvas ainda)
  sliderApproval,  // 0–1
  sliderInadReal,  // 0–1
  sliderInadInf,   // 0–1
  maxInadReal,     // máximo observado (define range do slider)
  maxInadInf,
}
```

### Cards de cenário

| Card | Comportamento |
|------|--------------|
| 🛡 Conservador | Menor inadimplência; clique aplica ao `proposedCells` e sincroniza sliders |
| ⚖ Melhor Eficiência | Joelho da curva — melhor equilíbrio risco/aprovação |
| 🚀 Máxima Aprovação | Aprovação máxima do dataset |
| 🎛 Personalizado | Ativado ao mover sliders ou clicar células manualmente |
| 📊 Política Completa | Roda `validateFlow + runSimulation` com `proposedCells` como override; mostra "Fluxo incompleto" se o grafo não estiver fechado |

### Sliders interligados

- **Aprovação** (driver principal): encontra o ponto da fronteira mais próximo do target; atualiza os sliders de inad como reflexo
- **Inad. Real / Inad. Inferida** (restrições): encontra o maior `approvalRate` na fronteira onde `inad ≤ valor`; recalcula aprovação e o outro slider

### Aplicar

`applyOptimResult(shapeId, proposedCells)` — sobrescreve `cells` do Cineminha via `setShapes` e fecha o modal.

**Não-destrutivo**: nenhuma alteração no canvas até o clique em "Aplicar". O usuário pode explorar cenários livremente e cancelar.
