# Proposta de Abordagem — Inferência de Negados via Tabela de Referência

> **Status:** rascunho para discussão (nenhum código alterado ainda)
> **Branch:** `claude/deployment-approach-proposal-fesn9o`
> **Artefatos de entrada:** `CONTRATO_INFERENCIA.md` + `inferencia_ref.csv` (amostra `INFERENCIA_REF_202509_202603.CSV`)
> **Decisão de origem (SAS):** congelada — o app **não** reimplementa estatística, apenas aplica.

Este documento descreve **como** a inferência de negados (gerada no SAS, entregue como
um CSV de referência) deve ser implantada no App Simulador de Crédito. Serve de base
para a Fase 0 (decisão) antes de qualquer implementação.

---

## 1. Resumo executivo

O SAS entrega uma **tabela de premissas** (`inferencia_ref.csv`): por célula de risco,
a probabilidade de conversão (`taxa_conversao_ref`) e de inadimplência dado que
converteu (`taxa_fpd_ref`), empilhada em vários níveis hierárquicos do mais granular
ao GLOBAL. O app, ao processar a base de estudo que o usuário sobe, faz para cada
célula um **lookup em cascata** (do nível mais granular ao GLOBAL, parando no primeiro
que casar), multiplica pela contagem da célula (`peso`) e agrega os "físicos":

```
fisico_altas = peso × taxa_conversao_ref
fisico_maus  = peso × taxa_conversao_ref × taxa_fpd_ref
FPD inferida = SUM(fisico_maus) / SUM(fisico_altas)   ← soma antes de dividir
```

**Descoberta central:** essa matemática **já existe** no motor de simulação atual
(`simulation.worker.js`). Hoje o motor lê duas colunas pré-calculadas do CSV do usuário
(`qtdAltasInfer` 🔮 e `inadInferida` 🎯) e as agrega exatamente como
`∑inadIRaw / ∑qtdAltasInfer`. Logo, a inferência por referência **não é um motor novo**:
é uma **fonte alternativa** que deriva esses dois mesmos números por linha, via lookup,
em vez de lê-los prontos do CSV. Todo o downstream (painel de simulação,
`incrementalResult`, otimizador Cineminha, Johnny, dashboard de analytics) funciona
**sem alteração**.

---

## 2. O artefato real diverge do contrato (e por que isso importa)

O contrato (§1) descreve 3 chaves com nomes fixos. O CSV real entregue tem **4 chaves**
e nomes diferentes. Isso **valida na prática** o aviso do próprio contrato: *"o app deve
ler as chaves a partir do cabeçalho, não assumir nomes fixos"*.

| Aspecto | Contrato §1 (exemplo) | CSV real entregue |
|---|---|---|
| Coluna âncora | `SCORE_HVI3` | **`FAIXA_SCORE`** |
| Nº de chaves | 3 | **4** |
| Chaves | score, grupo, canal | `FAIXA_SCORE`, `OPERACAO`, `IDENTIFICA_GRUPO_MODELO`, `CANAL_PCO_AJUSTADO` |
| Níveis | 4 | **5** |

Ordem de colapso real (lida de `vars_usadas`, **a última variável cai primeiro**):

| `nivel` | `confiabilidade` | Chaves preenchidas | Linhas |
|---|---|---|---|
| 1 | ALTA | `FAIXA_SCORE` · `OPERACAO` · `IDENTIFICA_GRUPO_MODELO` · `CANAL_PCO_AJUSTADO` | 1093 |
| 2 | MEDIA | `FAIXA_SCORE` · `OPERACAO` · `IDENTIFICA_GRUPO_MODELO` | 385 |
| 3 | MEDIA | `FAIXA_SCORE` · `OPERACAO` | 60 |
| 4 | BAIXA | `FAIXA_SCORE` (âncora) | 20 (R01..R20) |
| 5 | GLOBAL | *(linha única)* | 1 |

**Requisito de robustez nº 1:** a implementação **deve descobrir as chaves, a ordem e a
quantidade de níveis dinamicamente** a partir do cabeçalho e de `vars_usadas`. Nada de
nomes hardcoded. Um novo CSV do SAS com outra segmentação deve funcionar sem alteração
de código.

---

## 3. Decisões já tomadas (sessão de discussão)

| # | Pergunta | Decisão |
|---|---|---|
| D1 | Coexistência com colunas 🔮/🎯 atuais | **Fonte alternativa.** Os dois modos convivem; a origem da inferência é escolhida por dataset. Ambos alimentam os mesmos acumuladores do motor. Retrocompatível. |
| D2 | Onde carregar a tabela de referência | **Slot dedicado** ("Tabela de Inferência"), separado do import de base — é artefato de sistema, não base de estudo. |
| D3 | Registrar proposta no repo | **Sim** — este documento. |
| D4 | Reconciliação de score (`R99`/vazio→`R20`) | **Não alterar domínios de nada.** Ver §6. |
| D5 | Faseamento | **Aprovado** (ver §8). |

**Ponto em aberto levantado por você (D2):** *o que o usuário indica no wizard, na
seleção da variável de inferência de altas e de inadimplência, para sinalizar que deve
usar a referência carregada?* — respondido na §5.

---

## 4. Arquitetura proposta

### 4.1. Novo store dedicado: `inferenceRef`

A tabela de referência **não** entra no `csvStore`, não vira nó no canvas e não gera
chips arrastáveis. Estado próprio, indexado **uma vez** na importação:

```js
inferenceRef: null | {
  name,                     // nome do arquivo
  importedAt,               // timestamp
  keyCols: string[],        // ['FAIXA_SCORE','OPERACAO','IDENTIFICA_GRUPO_MODELO','CANAL_PCO_AJUSTADO']
                            //   derivado de vars_usadas do nível 1 (ordem = ordem de colapso)
  anchorCol: string,        // keyCols[0] — a âncora (nunca colapsa)
  levels: {                 // índice por nível: Map(chaveConcatenada → premissa)
    [nivel]: Map<string, { conv, fpd, confiab, nAprov, nConv, nMaus }>
  },
  global: { conv, fpd, confiab:'GLOBAL', ... },  // a linha GLOBAL
  levelKeyCount: { [nivel]: number },            // quantas chaves cada nível usa (de vars_usadas)
}
```

- ~1.5k entradas em `Map`s → lookup O(níveis) por linha, trivial.
- Espelhado em ref (`inferenceRefR`) e enviado ao worker via nova mensagem
  `UPDATE_INFERENCE_REF` (análogo ao `UPDATE_CSV_STORE`).

### 4.2. Mapeamento de chaves base ↔ referência

A base do usuário pode ter colunas com nomes diferentes das chaves da referência
(`FAIXA_SCORE` vs `score`, etc.). Reaproveitar o helper existente `normalizeColName`
para **sugerir** o de-para automático, com override manual. Para cada `keyCol` da
referência, escolher a coluna correspondente da base (ou "ausente" → a cascata
naturalmente desce um nível).

### 4.3. Lookup em cascata no worker

No `traverseRow` (ou num passo de pré-cálculo por linha), para cada linha da base:

1. Montar os valores de chave a partir das colunas mapeadas.
2. Aplicar a normalização de score **apenas como chave transitória** (§6).
3. Descer do nível mais granular ao GLOBAL, parando no primeiro `Map` que casar.
4. Devolver `{ conv, fpd, confiab }` da premissa escolhida.

### 4.4. Injeção dos físicos (reuso dos acumuladores existentes)

Com `peso = qty` (coluna 📊 `n_propostas`, semântica "abrir para os reprovados"):

```
qtdAltasInfer_linha = peso × conv                 → alimenta qtdAltasInferSum
inadInferida_linha  = peso × conv × fpd           → alimenta inadInferidaSum
```

O motor já calcula `inadInferida = ∑inadIRaw / ∑qtdAltasInfer`
(`simulation.worker.js:217`), que é **exatamente** `SUM(fisico_maus)/SUM(fisico_altas)`.
As Regras de Ouro do contrato (§4: nunca multiplicar somas, nunca dividir por contagem
de aprovados) são satisfeitas **por construção**, porque somamos os físicos linha a
linha antes de dividir.

### 4.5. Confiabilidade propagada (contrato §7 — canal PAP)

O `confiab` da premissa usada por cada linha é acumulado por faixa
(ALTA/MEDIA/BAIXA/GLOBAL), ponderado por volume. Permite à UI sinalizar quando uma
fatia relevante do estudo herdou premissa colapsada (≠ `ALTA`) — em especial o caso PAP
descrito no contrato. Indicador proposto: *"% do volume inferido com confiabilidade
ALTA"* + alerta visual quando baixo.

---

## 5. O indicador no wizard (resposta ao ponto em aberto D2)

Hoje, no **Passo 2** do wizard, o usuário marca colunas como 🔮 Conv. Inferida e
🎯 Inad. Inferida — valores que **já existem** na base. No modo "referência" essas
colunas **não existem na base**; o usuário precisa, em vez disso, indicar que a
inferência virá da tabela de referência **e** apontar as chaves de lookup.

Proposta de UX (modo "fonte alternativa", sem quebrar o fluxo atual):

1. **Seletor de origem da inferência** (por dataset, no Passo 2 ou Passo 3):

   > **Origem da inferência de altas/inadimplência:**
   > ( ) Colunas da própria base  *(comportamento atual — mapear 🔮 e 🎯)*
   > ( ) **Tabela de referência** *(usa o `inferencia_ref.csv` carregado)*

2. Ao escolher **Tabela de referência**:
   - Os slots de 🔮/🎯 são substituídos por uma instrução clara: *"As taxas serão
     buscadas na tabela de referência por cascata — informe as colunas-chave abaixo."*
   - Aparece o **mapeamento de chaves** (§4.2): para cada `keyCol` da referência, um
     `select` com as colunas da base (pré-preenchido por `normalizeColName`).
   - O usuário confirma qual coluna é o **peso** (default: a coluna já marcada como
     📊 `qty`).
   - Pré-condição: exige que a referência já tenha sido carregada no slot dedicado
     (§4.1). Se não houver referência carregada, a opção fica desabilitada com dica
     *"carregue a Tabela de Inferência primeiro"*.

3. **Persistência:** gravar no `csvStore[csvId]` um bloco
   `inferenceConfig: { source: 'ref'|'columns', keyMap: {...}, weightCol }`. Quando
   `source === 'ref'`, o motor ignora colunas 🔮/🎯 e usa o lookup.

4. **Sinalização fora do wizard:** o painel de simulação / sidebar mostra um selo
   discreto *"Inferência: Tabela de referência"* para o usuário não confundir a origem
   do número.

> Em aberto para refinar na Fase 1: se o seletor de origem deve viver no Passo 2 (junto
> da classificação) ou ganhar um Passo 4 dedicado. Recomendação: Passo 3/4, depois do
> AS IS, porque depende da referência já carregada e é conceitualmente "configuração do
> estudo", não "classificação de coluna".

---

## 6. Score: não alterar domínios (decisão D4)

O contrato (§3.1) manda tratar score vazio / `R99` / sem score como `R20` **antes** do
lookup. A decisão D4 é clara: **o app não altera o domínio de nada**.

Reconciliação proposta:

- A normalização **nunca** muta a base do usuário, não reescreve células, não muda o
  domínio exibido em losangos/Cineminha, não aparece em export.
- Ela é, no máximo, uma **chave transitória de lookup**: se o valor de score de uma
  linha não casar em nenhum nível, a cascata simplesmente desce até onde casar
  (incluindo GLOBAL) — comportamento idêntico a qualquer chave ausente.
- **Marcado como ponto a confirmar:** aplicar ou não o mapeamento `R99`/vazio→`R20` como
  chave de lookup (fiel ao SAS) **sem** tocar no dado exibido. Default sugerido:
  aplicar apenas como fallback de chave, configurável; nunca persistir. Decidir na
  Fase 2.

---

## 7. O que **não** muda

- Motor de simulação (`runSimulation`/`traverseRow`): só ganha uma fonte para dois
  acumuladores que já existem.
- Painel de simulação, `SimIndicators`, `incrementalResult`.
- Otimizador Cineminha (`optimModal`), Johnny (`johnnyModal`).
- Dashboard / Analytics Workspace.
- Domínios, ports, células, AS IS, Decision Lens.

Toda a regra de ouro estatística continua no SAS. O app faz lookup + 2 multiplicações +
1 soma.

---

## 8. Faseamento (aprovado — D5)

| Fase | Entrega | Toca código? |
|---|---|---|
| **0** | Este documento + ADR na wiki + atualização do CLAUDE.md congelando o contrato real (4 chaves, nomes dinâmicos, 5 níveis) | Só docs |
| **1** | Slot dedicado de import + indexação da `inferenceRef` + modal de mapeamento de chaves + seletor de origem no wizard (§5) | Sim |
| **2** | Lookup em cascata no worker + injeção dos físicos (reuso dos acumuladores) + normalização de score como chave transitória (§6) | Sim |
| **3** | Sinalização de confiabilidade na UI (§4.5 / contrato §7 — PAP) | Sim |
| **4** | Toggle de `peso` (`n_propostas` ↔ `n_aprovados`) e refinamentos | Sim |

**Validação numérica recomendada antes da Fase 2:** rodar a cascata sobre uma amostra
da base e conferir a FPD agregada contra um valor de controle, para provar a matemática
isolada do app.

---

## 9. Pontos abertos para a próxima rodada

1. Posição exata do seletor de origem no wizard (Passo 2 vs novo passo) — §5.
2. Aplicar ou não a normalização de score como chave de lookup — §6.
3. Incluir o toggle de `peso` já na v1 ou deixar para a Fase 4.
4. Comportamento quando a referência for trocada/recarregada com um estudo já montado
   (re-disparar overlay; preservar `inferenceConfig`).
5. Formato visual do selo "Inferência: referência" e do alerta de confiabilidade baixa.
