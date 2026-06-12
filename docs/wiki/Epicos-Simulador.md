# Épico: Simulador de Políticas de Crédito

## Visão geral

O simulador percorre cada linha do dataset histórico pelo fluxo de decisão montado no canvas e calcula indicadores agregados de aprovação e inadimplência.

---

## Fluxo completo do usuário

```
1. Importar CSV (wizard 3 passos)
        ↓
2. Colunas "Filtro" aparecem como chips arrastáveis no painel direito
        ↓
3. Arrastar chip → área vazia do canvas
   → Cria losango de decisão com ports automáticos (até 10 valores distintos)
        ↓
4. Arrastar chip → ⊞ Cineminha
   → Modal "Linha ou Coluna?" → matriz cruzada
        ↓
5. Conectar ports a outros nós, ✅ Aprovado ou ❌ Reprovado
        ↓
6. Duplo-clique em seta → editar label
        ↓
7. Painel de simulação atualiza em tempo real
```

---

## Engine de simulação

### `validateFlow`

Verifica se o fluxo está completo antes de rodar a simulação:
- Todos os ports de saída devem estar conectados
- O grafo deve ter pelo menos um nó terminal (Aprovado ou Reprovado)
- Inclui `cineminha` no conjunto de nós válidos

### `runSimulation` / `traverseRow`

Para cada linha do CSV:
1. Começa pelo primeiro nó do fluxo
2. Lê o valor da linha na coluna do nó
3. Segue a conexão correspondente ao valor
4. Para nós `cineminha`: faz lookup na chave `${rowVal}|${colVal}` e roteia para "Elegível" ou "Não Elegível"
5. Repete até atingir `approved` ou `rejected`

### Métricas acumuladas

Para cada linha que chega em `approved`:
- `approvedQty += qty`
- `qtdAltasSum += qtdAltas`
- `inadRealSum += inadReal * qtdAltas`
- `inadInferidaSum += inadInferida * qty`

### Saída da simulação

```js
{
  totalQty,      // total de propostas no dataset
  approvedQty,   // propostas aprovadas pelo fluxo
  rejectedQty,   // propostas reprovadas pelo fluxo
  approvalRate,  // approvedQty / totalQty
  inadReal,      // inadRealSum / qtdAltasSum  (null se qtdAltasSum = 0)
  inadInferida,  // inadInferidaSum / approvedQty  (null se approvedQty = 0)
}
```

---

## Painel de Simulação (`simPanel`)

Shape no canvas, tamanho padrão `260 × 280`.

| Indicador | Fórmula | Cor de alerta |
|-----------|---------|---------------|
| Taxa de Aprovação | `approvedQty / totalQty` | — |
| Inad. Real | `∑ inadReal × qtdAltas / ∑ qtdAltas` | Vermelho > 5%, laranja ≤ 5% |
| Inad. Inferida | `∑ inadInferida × qty / ∑ qty` | Vermelho > 5%, laranja ≤ 5% |

- Taxa de aprovação: número grande + barra de progresso + contadores ✅/❌
- Inad.: exibe `N/A` quando denominador = 0
- A sidebar direita espelha os três indicadores com recálculo reativo

---

## Reconciliação de dataset

Ao trocar o CSV (reimportar), o sistema:
1. Faz match normalizado das variáveis nos nós `cineminha` do canvas
2. Recomputa os domínios de linha e coluna
3. Preserva os estados de elegibilidade (`cells`) onde o valor existe no novo dataset
4. Descarta apenas células cujos valores não existem mais

Isso evita perder configurações manuais ao atualizar a base de dados.
