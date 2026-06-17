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

---

## Otimizador Multi-Cineminha — Johnny (`johnnyModal`)

### O que é

Quando o usuário seleciona **2 ou mais** nós Cineminha, a toolbar contextual troca **⚙ Otimizar Decisão** por **⚡ Otimização Johnny (N)**. O Johnny otimiza vários Cineminhas em conjunto, produzindo uma **fronteira de Pareto consolidada** sobre o pool de células de todos os selecionados.

### Ativação

Selecionar 2+ Cineminhas → **⚡ Otimização Johnny (N)** → dispara `COMPUTE_JOHNNY` no worker → abre `johnnyModal`.

### Caso de uso central (hierarquia de risco)

A política típica do usuário segmenta cada grupo de modelo (`IDENTIFICA_GRUPO_MODELO`, ~7 grupos) por **risco de cidade** (`RISCO_CIDADE_SERASA` → Alto / Neutro / Baixo). No canvas, um losango com a variável de risco abre 3 ports, e cada port pluga **um Cineminha** (mesmos eixos: `MOD_PRC` × `MOD_ADC`). O usuário então seleciona os 3 Cineminhas do grupo (ex.: G4-Alto, G4-Neutro, G4-Baixo) e quer otimizá-los **respeitando a hierarquia de risco**.

```
Losango RISCO_CIDADE
 ├─ Alto   → Cineminha G4-Alto   (MOD_PRC × MOD_ADC)
 ├─ Neutro → Cineminha G4-Neutro (MOD_PRC × MOD_ADC)
 └─ Baixo  → Cineminha G4-Baixo  (MOD_PRC × MOD_ADC)
```

### Problemas identificados na versão atual

**Problema 1 — população não filtrada.** `openJohnnyModal` envia apenas `{shapes}` ao worker; `computeJohnnyData` agrega métricas lendo `csv.rows` **inteiro** por Cineminha, sem percorrer o grafo de fluxo. Logo, o Cineminha "Alto" é calculado com **todas** as linhas (não só as de risco Alto). Quando 3 Cineminhas compartilham os mesmos eixos, suas métricas de entrada chegam quase idênticas.

**Problema 2 — sem inteligência de inadimplência nem hierarquia.** A ordenação primária é `badness = rowRank + colRank` (posição na grade), e a inadimplência real entra só como **desempate** dentro do mesmo `badness`. Resultado: configurações quase idênticas entre Cineminhas e pouca sensibilidade à inadimplência observada das células. Não há nenhum termo que diferencie um Cineminha "mais seguro" de um "mais arriscado".

### Decisões travadas

#### DEC-JO-001: Johnny opera sobre a população consolidada do fluxo

**Decisão:** o Johnny passa a receber `shapes + conns` (+ `lensPopulations`) e agrega as métricas de cada Cineminha **somente sobre as linhas que de fato chegam a ele percorrendo o grafo de fluxo** — não sobre o CSV inteiro. A fronteira de Pareto é construída sobre o **pool das populações filtradas** dos Cineminhas selecionados.

**Justificativa:** corrige o Problema 1 e materializa a semântica que o usuário espera — as entradas são tratadas **independentemente** (cada Cineminha vê só sua fatia de risco), mas a curva é uma **visão consolidada** dos selecionados (a aprovação total da curva = média ponderada das aprovações de cada Cineminha; 100% da curva ≡ os 3 Cineminhas totalmente abertos), **não** sobre a base completa.

#### DEC-JO-002: Hierarquia de risco explícita por nível manual

**Decisão:** no `johnnyModal`, cada Cineminha selecionado recebe um campo numérico de **nível de risco** (`riskLevel`). Convenção: **maior número = maior risco = mais restritivo**. O usuário atribui os níveis manualmente (ex.: Baixo=1, Neutro=2, Alto=3).

**Justificativa:** explícito, auditável e independente de heurística. (Auto-inferência por inadimplência agregada fica como evolução futura, não no escopo inicial.)

#### DEC-JO-003: Modos **Cascata** vs **Independente**

**Decisão:** um seletor segmentado no modal controla o comportamento entre Cineminhas:
- **Cascata (padrão):** aninhamento obrigatório — a região aprovada de um nível menos arriscado **contém** a de um nível mais arriscado. Para qualquer célula `(i,j)`: aprovar no nível L exige aprovar a mesma `(i,j)` no nível L−1 (mais seguro). Garante `nível1 ⊇ nível2 ⊇ … ⊇ nívelN`.
- **Independente:** sem restrição entre Cineminhas (só monotonicidade interna). Equivale ao comportamento de pool atual, porém reordenado por inadimplência real.

**Justificativa:** a nomenclatura "duro/mole" foi descartada por clareza. Cascata é o comportamento desejado na maioria dos casos (política auditável: o que aprova no Alto tem de aprovar no Baixo), mas o modo Independente permanece para testes A/B e para validar o ganho da restrição. Decisão de fixar um único modo no futuro fica em aberto, pós-testes.

#### DEC-JO-004: Greedy por inadimplência com precedência; métrica selecionável + fallback

**Decisão:** a fronteira deixa de ser ordenada por `badness` e passa a ser um **greedy com restrição de precedência**:
- **Grafo de precedência:** (a) monotonicidade interna por eixo ordinal — `(i,j)` exige `(i−1,j)` e `(i,j−1)` no mesmo Cineminha; (b) aninhamento entre níveis (modo Cascata) — `(i,j)` no nível L exige `(i,j)` no nível L−1.
- **Ordem de abertura:** a cada passo, entre as células **liberadas** (precedências satisfeitas), abre a de **menor inadimplência**. Empate por `qty` desc.
- **Métrica selecionável:** toggle **Inad. Inferida (padrão) / Inad. Real** define qual inadimplência guia o greedy.
- **Robustez amostral:** células de volume muito baixo recebem suavização (piso de volume / *shrinkage* à média do pool) para evitar que ruído gere inversões espúrias.
- **Fallback:** sem nenhuma inadimplência disponível, a ordem recai sobre a precedência + rank interno/de nível (lógica puramente hierárquica).

**Justificativa:** corrige o Problema 2 — a inadimplência observada vira o **driver** da abertura (não desempate), enquanto a precedência garante monotonicidade interna e a coerência da hierarquia. Inversões reais são absorvidas: uma célula entra na fila assim que a estrutura permite, e entre as permitidas a mais segura sempre vem primeiro.

### Plano de implementação (sessões)

| Sessão | Escopo | Cobre | Status |
|--------|--------|-------|--------|
| **A** | População consolidada do fluxo | DEC-JO-001 (Problema 1) | ✅ Entregue |
| **B** | UI do modal: nível de risco, toggle de métrica, seletor de modo | DEC-JO-002, parte de DEC-JO-003/004 | ✅ Entregue |
| **C** | Algoritmo greedy com precedência (Cascata/Independente) | DEC-JO-003, DEC-JO-004 (Problema 2) | ✅ Entregue |

### Estado do modal (alvo)

```js
johnnyModal = {
  // ... estado atual (pooledMetrics, frontier, scenarios, shapeMetas, etc.)
  riskLevels,    // {[shapeId]: number} — nível de risco manual (DEC-JO-002)
  hierarchyMode, // 'cascata' | 'independente' (DEC-JO-003), default 'cascata'
  inadMetric,    // 'inferida' | 'real' (DEC-JO-004), default 'inferida'
}
```

**Pré-condição do aninhamento (Cascata):** os Cineminhas de níveis adjacentes devem compartilhar eixos/domínios para que o casamento de células `(i,j)` seja bem definido. Quando os domínios divergem, as arestas de aninhamento valem apenas para os `cellKey` coincidentes.

### Implementação Sessão C

`computeJohnnyData` aceita agora `riskLevels`, `hierarchyMode` e `inadMetric` como parâmetros. O algoritmo de fronteira foi substituído:

**Grafo de precedência (`requires[pk]`):**
- **(a) Monotonicidade interna** por eixo ordinal: `(i,j)` ∈ Cineminha K exige `(i-1,j)` e `(i,j-1)` no mesmo K.
- **(b) Aninhamento Cascata** (quando `hierarchyMode === 'cascata'`): `(i,j)` no nível L exige `(i,j)` no nível L−1 (riskLevel menor = mais seguro). Casamento por `cellKey` — domínios não precisam ser idênticos, só as células coincidentes criam aresta.

**Greedy:**
- Células sem predecessores pendentes formam o conjunto `liberatedSet`.
- A cada passo, elege a célula liberada de menor **inadimplência suavizada** (`inadMetric` selecionável); desempate por `qty` desc.
- Suavização bayesiana com `SHRINK_K = 10%` do volume médio do pool — impede que ruído amostral de células pequenas antecedam células seguras reais.
- Fallback (sem dados de inad): rank por nível (`riskLevel * 1e6`) + posição ordinal interna.
- Abre a célula eleita, atualiza acumuladores, libera dependentes cujo contador de predecessores pendentes chega a zero.

**Recomputo automático da curva:**
- Toggles `hierarchyMode`/`inadMetric` chamam `recomputeJohnny({...override})` imediatamente (auto-recompute).
- Input `riskLevel` dispara `recomputeJohnny()` via `onBlur`, usando o padrão de updater funcional do React para garantir que o valor recém-digitado já esteja na state antes do envio ao worker.
- Ref `johnnyModalR` adicionado para acesso sem closure stale nas funções fora do ciclo de render.
