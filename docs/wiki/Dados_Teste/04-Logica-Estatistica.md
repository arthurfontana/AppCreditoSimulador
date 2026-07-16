# Lógica Estatística da Geração — a "verdade plantada"

> **Manutenção**: mudou a verdade plantada (segmento, correlação, multiplicador)?
> Documentar aqui **antes** de mexer no gerador — ver `README.md § Contrato de manutenção`.
> O CSV versionado só é regenerado a pedido do usuário.

Fonte única: `gerar_base_teste.mjs` (este documento descreve; o script manda).
Determinístico: PRNG mulberry32, seed padrão `20260716` — mesma seed ⇒ mesmo CSV byte a byte.

## Princípio

A base NÃO é aleatória: é amostrada de um **modelo causal sintético**. Cada linha nasce de
dimensões correlacionadas → um **risco verdadeiro** `p` (probabilidade de atraso >30d entre
as altas) → uma **decisão AS IS** com falhas deliberadas → métricas sumarizadas amostradas
de binomiais. Os motores analíticos do app devem conseguir **redescobrir** esse modelo.

## 1. Estrutura de correlação das dimensões

- **Porte → Score** (espinha dorsal dos clusters): score `R01–R10` ~ Normal discretizada,
  média por porte: MEI 3,1 · MICRO 3,6 · PEQUENA 5,0 · MEDIA 6,3 · GRANDE 7,6 (sd 1,8).
  MEI↔GRANDE ficam bem separados; PEQUENA↔MEDIA se sobrepõem de propósito.
- **Score → Faixa Bureau**: `B = ⌈score/2⌉` com 20% de ruído ±1 — multicolinearidade
  realista entre dois scores.
- **Score → Mix de Risco**: BAIXO (≤R03) / MEDIO (R04–R06) / ALTO (≥R07), 10% de ruído.
- **Porte → Faturamento**: lognormal com mediana por porte (8 mil → 2,5 mi) × fator
  setorial; sd log 0,85 (cauda pesada); 0,3% de outliers ×20.
- **Porte → Funcionários**: lognormal por porte; `MEI ⇒ 1` determinístico.
- **Porte → Tempo de atividade**: lognormal, mediana 30 (MEI) a 220 meses (GRANDE).
- **Faturamento × Score → Limite**: `limite = faturamento × 0,35 × (1,6 − 0,12·score) ×
  U(0,85–1,15)` — correlação forte positiva com faturamento, negativa com score.
- **Região → UF**: UF sorteada dentro da região (pesos realistas, SP dominante).
- **Dia da semana**: independente de tudo (variável-controle, IV ≈ 0).

## 2. Modelo de risco verdadeiro

```
p = 0,006 × 1,42^(score−1)                    # R01 ≈ 0,6% … R10 ≈ 14,3%
  × 2,2  se FLAG_RESTRITIVO = SIM   (×1,1 se vazio)
  × clamp(1,65 − 0,28·ln(1 + tempo/12), 0,75, 1,65)     # monotônico ↓ com o tempo
  × clamp(0,85 + 0,18·z², 0,85, 1,9),  z = (ln(fat) − ln 60000)/1,6   # risco em "U"
  × setor  (CONSTRUCAO 1,5 · AGRO 1,2 · MINERACAO 1,3 · TECNOLOGIA 0,85 · SAUDE 0,9)
  × região (NORTE 1,1 · SUL 0,92 — efeito fraco)
  × canal  (PARCEIRO 1,15 · TELEVENDAS 1,05 · LOJA 0,95)
```

**Overrides plantados** (o que os motores devem achar):

| Override | Efeito | Motor-alvo |
|---|---|---|
| MEI & DIGITAL & score ∈ {R07,R08} | risco ×0,35 + 12% das MEI+DIGITAL forçadas a R07/R08 (massa ~1,8% da base) | Descoberta: `approvable_low_risk` (2D) |
| CONSTRUCAO & NORTE | risco ×2,5 | Descoberta: `approved_high_risk` (2D) |
| UF = AC | risco ×4 | Descoberta: `anomaly` por valor |
| SAFRA = 202509 | risco ×1,45 | anomalia temporal / degrau no Dashboard |

`p` é truncado em [0,2%, 60%].

## 3. Política AS IS (decisão histórica com falhas deliberadas)

```
restritivo SIM & score ≥ R05  → REPROVADO (98%)
segmento MEI+DIGITAL+R07/R08  → REPROVADO (95%)   ← a falha que a Descoberta deve apontar
score ≤ R06                   → APROVADO (97%)
score = R07                   → APROVADO (55%)     ← bloco heterogêneo (quebra que falta)
score ≥ R08                   → APROVADO (8%)      ← exceções de mesa
2% de tudo                    → PENDENTE           ← mapeado como "Ignorar" no Passo 3
```

Consequências mensuráveis: CONSTRUCAO+NORTE entra aprovada pela régua de score (vaza risco);
MEI+DIGITAL bom pagador sai reprovado (aprovação deixada na mesa) — os dois lados do
`incrementalResult` (rToA / aToR) quando a política simulada diverge do AS IS.

## 4. Conversão e métricas sumarizadas

- **Conversão real** (seleção adversa: risco converte mais):
  `conv = 0,35 + 0,02·score + canal (DIGITAL +0,08 · TELEVENDAS −0,05) + produto (CARTAO +0,05 · FINANCIAMENTO −0,06)`, clamp [0,1–0,9].
- **Volume da linha**: `QTD_PROPOSTA` ~ mistura (55% → 1–2; 30% → 3–8; 12% → 9–30; 3% → 31–200).
- **`QTD_ALTAS`** = Binomial(qtd, conv) se aprovado; 0 senão.
- **`QTD_ATRS_OVER_30`** = Binomial(altas, p); vazio se altas = 0.
- **`QTD_INFER_CONV`** = `qtd × conv × U(0,92–1,08)` — o "modelo de inferência" com erro;
  presente em TODAS as linhas (inclusive reprovadas) — é o que torna o contrafactual possível.
- **`QTD_INFER_FL_ATRS`** = `infer_conv × p × U(0,85–1,2)` — inadimplência inferida
  correlacionada com a real, mas não idêntica (as duas métricas do painel divergem de forma plausível).

## 5. Nulos e sujeira controlada

Nulos NÃO são uniformes: `QTD_ATRS_OVER_30` é estruturalmente vazio sem altas;
`LIMITE_PRE_APROVADO` é vazio exatamente quando `FATURAMENTO_MENSAL` é (nulo correlacionado);
`FLAG_RESTRITIVO` 3%, faturamento 1,5% e tempo 1% são MCAR. Não há acentos, aspas nem
delimitadores embutidos — a sujeira testada é semântica (nulo/outlier/raro), não de parse.

## 6. Números de referência da base entregue (seed 20260716, 20.000 linhas)

- 165.425 propostas · decisão AS IS por linha: 15.165 APROVADO · 4.428 REPROVADO · 407 PENDENTE.
- Inad. real por score (∑atrs/∑altas): R01 1,4% → R05 3,4% → R07 6,8% → R10 15,5%
  (monotônica com ruído amostral realista na cauda R08–R10, onde há poucas altas).
- Inad. inferida global ~5,4%; segmento MEI+DIGITAL+R07/R08: 367 linhas, 95% reprovadas,
  inad. inferida 4,35%; CONSTRUCAO+NORTE: 202 linhas, 20,7%.
- Distintos: UF 27 · CODIGO_VENDEDOR 350 · TEMPO 476 · FATURAMENTO 19.687.

O gerador imprime esse sumário a cada execução — se os números divergirem muito após uma
mudança, a verdade plantada foi quebrada (pare e investigue, mesmo espírito do GATE de
fixtures douradas).
