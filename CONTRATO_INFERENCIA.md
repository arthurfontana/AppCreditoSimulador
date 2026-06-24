# Contrato de Inferência de Negados — SAS → App Simulador

Este documento é a **interface** entre dois sistemas que vivem em repositórios
separados:

- **Geração (este repo, SAS)** — calcula as taxas de conversão e de FPD por
  célula a partir da base histórica observada. É onde mora toda a estatística
  validada (níveis hierárquicos, amostra mínima, fallback). **Não muda.**
- **Aplicação (App Simulador de Crédito, outro repo, JS)** — recebe a tabela
  de referência pronta e a "carimba" na base que o usuário sobe para um estudo
  de política, gerando a visão de inferência de negados junto da simulação que
  o app já faz hoje.

> **Princípio:** o SAS **não** exporta código, exporta um **artefato de dados**
> (um CSV) + este contrato. O app implementa apenas a *aplicação*, que é um
> lookup em cascata + duas multiplicações + uma soma. Nada de estatística é
> reimplementado no app.

---

## 1. O artefato: `inferencia_ref.csv`

Gerado no SAS por `%exportar_simulador` (em `inferencia_simplificada.sas`), a
partir da tabela de referência que o `%gerar_inferencia` produz.

- **Delimitador:** `;`
- **Decimal:** `.` (ponto)
- **Cabeçalho:** primeira linha, com os nomes das colunas abaixo
- **Encoding:** efetivamente ASCII (todos os valores são códigos como `R01`,
  `G1`, `DIGITAL`, `ALTA`), então não há problema de acentuação

### Colunas

| Coluna | Tipo | Significado |
|---|---|---|
| `nivel` | inteiro | Nível hierárquico da linha. `1` = mais granular (todas as variáveis). Vai colapsando até `GLOBAL`. Ver §2. |
| `confiabilidade` | texto | `ALTA` / `MEDIA` / `BAIXA` / `GLOBAL`. Qualidade da premissa (quanto mais granular, melhor). Use na UI / para filtrar. |
| `SCORE_HVI3` | texto | Faixa de score (`R01` melhor … `R20` pior). **Âncora: nunca fica em branco.** |
| `IDENTIFICA_GRUPO_MODELO` | texto | Grupo do cliente (`G1`, `G3`, `G5`, …). **Em branco** nos níveis colapsados. |
| `CANAL_PCO_AJUSTADO` | texto | Canal (`DIGITAL`, `PAP`, …). É o **primeiro a ser descartado** no fallback — **em branco** a partir do nível 2. |
| `taxa_conversao_ref` | decimal 0–1 | `P(converte dado aprovado)` observada na célula. |
| `taxa_fpd_ref` | decimal 0–1 | `P(inadimple dado converteu)` observada na célula. |
| `n_aprovados` | inteiro | Amostra de aprovados que embasa a célula (opcional, auditoria). |
| `n_convertidos` | inteiro | Amostra de convertidos (opcional). |
| `n_maus` | inteiro | Amostra de maus/FPD (opcional). |
| `vars_usadas` | texto | Lista das variáveis daquele nível (ex.: `SCORE_HVI3 IDENTIFICA_GRUPO_MODELO`). Apoio/auditoria. |

> As 3 colunas de chave (`SCORE_HVI3`, `IDENTIFICA_GRUPO_MODELO`,
> `CANAL_PCO_AJUSTADO`) são fixas hoje, mas a **ordem** delas em `var_seg`
> define o que colapsa primeiro, os nomes dessas variáveis e a quantidade pode alterar. Se um dia mudar a segmentação no SAS, o CSV
> ganha/perde colunas — o app deve ler as chaves a partir do cabeçalho, não
> assumir nomes fixos.

---

## 2. A hierarquia (por que existem vários níveis)

A tabela vem **empilhada em todos os níveis**, do mais granular ao GLOBAL.
Com as 3 variáveis atuais:

| `nivel` | Chaves preenchidas | `confiabilidade` |
|---|---|---|
| 1 | `SCORE_HVI3` + `IDENTIFICA_GRUPO_MODELO` + `CANAL_PCO_AJUSTADO` | ALTA |
| 2 | `SCORE_HVI3` + `IDENTIFICA_GRUPO_MODELO` | MEDIA |
| 3 | `SCORE_HVI3` | BAIXA |
| 4 (GLOBAL) | *(nenhuma — uma única linha)* | GLOBAL |

O **score é a âncora**: nunca é colapsado. O canal é o primeiro a cair. Cada
nível só contém as células que tiveram **amostra suficiente** (mínimos de
aprovados e de maus) na base histórica; por isso uma combinação pode existir
no nível 2 mas não no nível 1.

---

## 3. O algoritmo de aplicação (o que o app faz)

Para cada linha da base que o usuário sobe (que já vem **sumarizada**, com uma
coluna de contagem por célula):

### 3.1. Lookup em cascata

Procure a premissa indo do mais granular ao mais geral; **pare no primeiro que
casar**:

1. Linha do CSV com `nivel = 1` cujas 3 chaves batem exatamente
   (`SCORE_HVI3` **e** `IDENTIFICA_GRUPO_MODELO` **e** `CANAL_PCO_AJUSTADO`).
2. Senão, `nivel = 2` casando `SCORE_HVI3` + `IDENTIFICA_GRUPO_MODELO`.
3. Senão, `nivel = 3` casando só `SCORE_HVI3`.
4. Senão, a linha `GLOBAL` (sempre existe).

Da linha escolhida, leia `taxa_conversao_ref`, `taxa_fpd_ref` e
`confiabilidade`.

> **Normalização do score:** score vazio / `R99` / sem score deve ser tratado
> como `R20` (pior faixa) **antes** do lookup — é assim que o SAS trata.

### 3.2. Físicos

Com `peso` = a contagem da célula na base do usuário:

```
fisico_altas = peso * taxa_conversao_ref
fisico_maus  = peso * taxa_conversao_ref * taxa_fpd_ref
```

**`peso` padrão = `n_propostas`** (a contagem de *todas* as propostas da
célula, incluindo reprovados). Essa é a semântica de **"simular abertura para
os reprovados"** — quanto de altas e de maus apareceria se a política passasse
a aprovar aquelas propostas. (Decisão de negócio confirmada; o app pode expor
um toggle para usar `n_aprovados` em vez disso, que dá "FPD sobre aprovados".)

### 3.3. Agregação do estudo

Somando sobre as células do recorte que o usuário está analisando:

```
Altas inferidas = SUM(fisico_altas)
Maus inferidos  = SUM(fisico_maus)
FPD inferida    = SUM(fisico_maus) / SUM(fisico_altas)
```

---

## 4. Regras de ouro (erros já cometidos — não repetir)

Estas duas proibições são a razão de o app **não** poder improvisar a conta:

1. **NUNCA** multiplique somas entre si. `FPD ≠ SUM(taxa_conversao) *
   SUM(taxa_fpd)` e `≠ mean(...)`. Sempre `SUM(fisico_maus) /
   SUM(fisico_altas)` — somando os físicos linha a linha primeiro.
2. **NUNCA** divida `SUM(fisico_maus)` por uma contagem de aprovados/propostas.
   Isso dá "perda sobre a carteira", **não** FPD. O denominador da FPD é
   sempre as **altas** inferidas.

E uma regra de modelagem que o SAS já garante na geração, mas que o app deve
respeitar ao escolher o `peso`: a `taxa_conversao_ref` é uma probabilidade *a
priori* distribuída entre **todos** da célula — por isso o físico de altas é
`peso * taxa_conversao`, e não um filtro de "quem converteu".

---

## 5. Pseudocódigo (referência para a sessão do app)

```js
// 1) Carregar o CSV uma vez e indexar por nível.
//    chave de nível 1 = `${score}|${grupo}|${canal}`
//    chave de nível 2 = `${score}|${grupo}`
//    chave de nível 3 = `${score}`
//    GLOBAL = uma única linha
const ref = carregarInferenciaRef("inferencia_ref.csv"); // { n1, n2, n3, global }

function normalizaScore(s) {
  return (!s || s === "R99") ? "R20" : s;
}

// 2) Resolver a premissa de uma célula da base do usuário (cascata).
function premissaDe(celula) {
  const score = normalizaScore(celula.SCORE_HVI3);
  const g     = celula.IDENTIFICA_GRUPO_MODELO;
  const canal = celula.CANAL_PCO_AJUSTADO;
  return ref.n1[`${score}|${g}|${canal}`]
      ?? ref.n2[`${score}|${g}`]
      ?? ref.n3[`${score}`]
      ?? ref.global;
}

// 3) Físicos + agregação (peso = n_propostas por padrão).
let altas = 0, maus = 0;
for (const c of baseDoUsuario) {
  const p    = premissaDe(c);
  const peso = c.n_propostas;                 // ou c.n_aprovados (toggle)
  altas += peso * p.taxa_conversao_ref;
  maus  += peso * p.taxa_conversao_ref * p.taxa_fpd_ref;
}
const fpdInferida = maus / altas;             // REGRA DE OURO: soma antes de dividir
```

---

## 6. Como gerar o CSV no SAS

Na mesma sessão SAS, depois de gerar a tabela de referência:

```sas
%gerar_inferencia(
    ds_base=INF.BASE_MODELAGEM_AM, var_seg=&VAR_SEG,
    col_aprovados=&COL_APROVADOS, col_convertidos=&COL_CONVERTIDOS,
    col_maus=&COL_MAUS, ds_ref=INF.TABELA_REF_MV);

%exportar_simulador(
    ds_ref      = INF.TABELA_REF_MV,
    caminho_csv = /caminho/inferencia_ref.csv,
    var_seg     = &VAR_SEG);
```

O `%exportar_simulador` está em `inferencia_simplificada.sas`. O CSV resultante
+ este documento são tudo o que a sessão do app precisa.

---

## 7. Ponto de atenção conhecido — canal PAP

A premissa do canal **PAP** é instável (ver `CONTEXTO.md §6`): boa parte do
volume cai num nível colapsado e herda conversão muito acima do real. Enquanto
isso não é tratado na geração, o app deveria **sinalizar visualmente** as
células cuja premissa veio de `confiabilidade` ≠ `ALTA` (e em especial
`PAP` colapsado), para o usuário não ler como certo um número herdado.
