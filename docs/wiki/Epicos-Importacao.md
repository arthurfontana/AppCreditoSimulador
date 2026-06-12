# Épico: Importação de CSV e Variável AS IS

## Wizard de importação (3 passos)

O wizard é aberto ao clicar em "Importar CSV" ou ao editar um dataset já importado.

---

### Passo 1 — Delimitador

- Modal com 600px de largura
- Detecta automaticamente o delimitador (`,` `;` `\t`) e exibe badge "detectado automaticamente" ou "verifique abaixo"
- Preview das primeiras 5 linhas para validação visual
- Opção de toggle "Primeira linha é cabeçalho"

---

### Passo 2 — Classificar colunas

- Modal alarga para 900px
- Layout em grid: `1fr` (nome da coluna) + 6 colunas de 60px (tipos) + 100px (tipo var.)
- Header sticky; lista de colunas com scroll interno (`maxHeight: 340px`)

**Para cada coluna, o analista define:**

| Campo | Opções |
|-------|--------|
| Tipo de coluna | ID / Filtro / Vol. Propostas / Qtd Altas / Inad. Real / Inad. Inferida |
| Tipo de variável | `categorical` (padrão) ou `ordinal` |

**Tipos de coluna:**

| Valor | Ícone | Significado |
|-------|-------|-------------|
| `id` | 🔑 | Identificador do registro |
| `decision` | 🔀 | Variável de decisão — aparecerá como chip arrastável no painel |
| `qty` | 📊 | Volume total de propostas do agrupamento |
| `qtdAltas` | 📈 | Volume convertido em vendas/ativações |
| `inadReal` | ⚠️ | Inadimplência histórica observada |
| `inadInferida` | 🎯 | Inadimplência estimada para aprovados |

---

### Passo 3 — Variável de Decisão AS IS

Configura a baseline histórica — como era a política de crédito real no momento da coleta dos dados.

**Fluxo:**

1. Selecionar qual coluna do CSV contém a decisão original (exclui colunas métricas)
2. Para cada valor distinto dessa coluna, mapear para: `✅ Aprovado` / `❌ Reprovado` / `— Ignorar`
3. Indicadores de validação em tempo real: aprovado mapeado? reprovado mapeado? todos os valores atribuídos?
4. Confirmar → sistema deriva a coluna interna `__DECISAO_ORIGINAL`

**Ao confirmar:**
- Última posição de `headers` recebe `'__DECISAO_ORIGINAL'`
- Última coluna de cada `row` recebe `'APROVADO'`, `'REPROVADO'` ou `''`
- `asIsConfig` é salvo no `csvStore`

**Edit mode:** ao reabrir o wizard para o mesmo dataset, restaura `asIsVar` e `asIsMapping` do `asIsConfig` salvo.

---

## Conceito: Variável AS IS

O simulador opera em modelo de **simulação incremental sobre comportamento observado**:

- A base histórica representa a realidade operacional — como as decisões foram de fato tomadas
- `__DECISAO_ORIGINAL` é a decisão normalizada de cada linha
- Permite comparar a política simulada com o que realmente aconteceu

### Estrutura `asIsConfig`

```js
{
  col: string,     // nome da coluna original no CSV (ex: "DECISAO_FINAL")
  mapping: {
    "A": "APROVADO",
    "R": "REPROVADO",
    "P": "IGNORAR",
  }
}
```

### Uso futuro de `__DECISAO_ORIGINAL`

- **Decision Lens**: comparação AS IS vs. política simulada
- **Motor incremental**: sobrescrever apenas o subconjunto da base histórica afetado pela nova política
- **Cálculo de delta**: impacto marginal de cada alteração de regra
- **Comparação contrafactual**: "se tivéssemos aprovado X, qual seria a inadimplência real?"

---

## csvStore — estrutura por dataset

```js
{
  name,          // nome do arquivo importado
  headers,       // string[] — inclui '__DECISAO_ORIGINAL' se asIsConfig configurado
  rows,          // string[][] — última coluna é '__DECISAO_ORIGINAL' se configurado
  columnTypes,   // { [colName]: COL_TYPE }
  varTypes,      // { [colName]: 'categorical' | 'ordinal' }
  asIsConfig,    // null | { col, mapping }
}
```

Múltiplos datasets podem coexistir no `csvStore`. Cada nó de decisão ou Cineminha referencia seu dataset pelo `csvId`.
