# Wizard de importação (3 passos)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer no
> fluxo de import de CSV (wizard, parse assíncrono, `asIsConfig`).

## Passo 1 — Delimitador
- Modal 600px; detecção automática do delimitador com badge "detectado automaticamente" / "verifique abaixo"
- Detecção automática do separador decimal (`,` ou `.`) com badge de confiança
- Preview das 5 primeiras linhas
- Toggle "Tem cabeçalho?"

## Passo 2 — Classificar colunas
- Modal alarga para 900px para acomodar 7 colunas de tipo + coluna Tipo Var.
- Layout em CSS `grid` com `gridTemplateColumns: "1fr repeat(7, 60px) 100px"`
- Header sticky; lista de colunas com scroll interno (`maxHeight: 340px`)
- Seletor de varType por coluna: `categorical` | `ordinal`
- Sugestão automática via `suggestVarType` e `suggestMetricColumns`
- **Variáveis de Filtro — botão de tipo cicla `categorical → ordinal → temporal → ignore →
  categorical`.** `ignore` é um `columnTypes[col]` explícito (como `temporal`), não um
  `varType` — sobrescreve o default `decision` que `buildFinalTypes` (`onImportConfirm`,
  `App.jsx`) atribui a toda coluna sem tipo. Existe porque **todo** processo de
  inteligência do app (ranking de IV/`computeBaseProfile`, candidatos de Clusterização,
  candidatos de Descoberta de Segmentos, painel de variáveis do canvas/losango) já
  filtra estritamente por `columnTypes[col] === 'decision'` — marcar `ignore` basta para
  a coluna nunca mais aparecer em nenhum desses lugares, sem precisar tocar cada um
  (ex.: um contador de linha/ID de proposta, ou uma variável só apurada depois da
  decisão de crédito, como faturamento pós-venda). Editável a qualquer momento reabrindo
  o passo 2 (`onEditDataset`, que preserva `columnTypes` existente).

## Passo 3 — Variável de Decisão AS IS
- Modal 680px; etapa obrigatória para configurar a baseline histórica
- **Seletor de coluna**: lista apenas colunas não-métricas
- **Mapping de valores**: ao selecionar a coluna, exibe todos os distinct values com dropdown `✅ Aprovado / ❌ Reprovado / — Ignorar`
- **Validação em tempo real**: indicadores mostram se aprovado mapeado, reprovado mapeado, todos os valores atribuídos
- **On confirm**: deriva coluna `__DECISAO_ORIGINAL` (última posição em `headers`/`rows`) com valores `APROVADO` / `REPROVADO` / `''`; salva `asIsConfig` no csvStore
- **Edit mode**: restaura `asIsVar` e `asIsMapping` do `asIsConfig` salvo
- **Pular**: botão para ignorar o passo (sem AS IS)

## Variável de Decisão AS IS — Conceito

O simulador opera em modelo de **simulação incremental sobre comportamento observado**:
- A base histórica (`asIsConfig`) representa a realidade operacional
- `__DECISAO_ORIGINAL` é a coluna interna com a decisão normalizada de cada linha
- Usada para comparação contrafactual: o que mudaria se a nova política tivesse sido aplicada?

### Estrutura `asIsConfig`
```js
{
  col: string,     // nome da coluna original no CSV (ex: "DECISAO_FINAL")
  mapping: {       // valor encontrado → significado normalizado
    "A": "APROVADO",
    "R": "REPROVADO",
    "P": "IGNORAR",
  }
}
```

### `incrementalResult`
Gerado pelo worker (`COMPUTE_OVERLAY`) a partir de `computeIncrementalResult`:
```js
{
  baseline: { approvedQty, rejectedQty, totalQty, approvalRate, inadReal, inadInferida },
  simulated: { approvedQty, rejectedQty, totalQty, approvalRate, inadReal, inadInferida },
  impacted: { qty, totalQty, pct, rToA, aToR, approvalDelta, altasInferRtoA, altasRealAtoR }
}
```
- `rToA`: Reprovado → Aprovado (promoções da nova política)
- `aToR`: Aprovado → Reprovado (rejeições adicionais)
- Exibido no `SimIndicators` e no painel de simulação

## Carga de CSV assíncrona + modal de progresso (`importLoading`)

Bases grandes travavam a UI no parse síncrono. `parseCSVToColumnarAsync(text,
delimiter, hasHeader, onProgress)` (em `src/columnar.js`; substituiu o
`parseCSVAsync` no M1) fatia o CSV em lotes, cede a thread principal a cada lote
(`setTimeout 0`) e reporta progresso via `onProgress(posiçãoConsumida, total)`.

- Estado `importLoading`: `null | {phase:'reading'|'parsing', pct, filename}` —
  alimenta um modal de progresso. `reader.onprogress` cobre a leitura do arquivo
  (`reading`); `parseCSVToColumnarAsync` cobre o parse (`parsing`).
- Usado em `onFileChange` (import inicial) e `reparseWizardFile` (recarga no wizard —
  desde o M1 relê o `File` handle guardado no wizard) — ambos mostram o mesmo modal.
- **Fase 0 (otimização de memória)**: o parse NÃO materializa
  `text.split(/\r?\n/)` inteiro. Varre o texto por índice (`indexOf('\n')`) e fatia
  cada linha sob demanda — elimina o pico de RAM do parse (~260MB em bases grandes).
- **M1 (import vetorizado)**: cada linha alimenta os encoders colunares diretamente
  (dictionary encoding por coluna) — a matriz `string[][]` nunca existe. Ver detalhe
  completo em `docs/claude/Otimizacao-Memoria-Historico.md` § M1.
