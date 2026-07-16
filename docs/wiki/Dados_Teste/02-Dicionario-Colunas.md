# Dicionário de Colunas — Base_Teste_Oficial.csv

24 colunas, todas com finalidade funcional declarada. A base é **sumarizada**: cada linha
é um micro-grupo de propostas com o mesmo perfil (padrão da `Amostra_Fake.csv` e do motor
de simulação, que pondera tudo por `QTD_PROPOSTA`).

Formato: delimitador `;` · decimal `,` · cabeçalho · UTF-8 · vazio = nulo.

## Colunas de identificação, tempo e decisão

| Coluna | Tipo (wizard) | Tipo Var. | Valores | Exemplo | Obrig.¹ | Justificativa / quem usa |
|---|---|---|---|---|---|---|
| `ID_LINHA` | 🔑 ID | — | `L000001`…`L020000`, únicos | `L004217` | Opcional | Identificador do registro; auditoria/rastreio do export diagnóstico |
| `SAFRA` | ⏱ Data/Tempo | — | `202501`…`202512` (YYYYMM) | `202506` | **Obrigatória** | Eixo cronológico do Dashboard (`parseTemporalKey`); selo de estabilidade temporal e anomalia por safra da Descoberta; heurística do seletor de variáveis (token `safra` ⇒ pré-desmarcada) |
| `DECISAO_ANALISE` | 🔀 Filtro | categorical | `APROVADO` (77%) · `REPROVADO` (21%) · `PENDENTE` (2%) | `APROVADO` | **Obrigatória** | Variável AS IS (Passo 3): `PENDENTE` testa o mapeamento "Ignorar"; alimenta `__DECISAO_ORIGINAL`, terminal ⟳, `incrementalResult`, prévia AS IS do Cineminha, `asis_divergence`, KPI A/B vs AS IS |

## Variáveis de decisão (chips arrastáveis — colunas Filtro)

| Coluna | Tipo Var. | Valores | Exemplo | Obrig.¹ | Justificativa / quem usa |
|---|---|---|---|---|---|
| `SCORE_INTERNO` | ordinal | `R01`…`R10` (10 distintos = teto exato de ports do losango) | `R07` | **Obrigatória** | Preditor principal de risco (monotônico, plantado); losango de 10 portas; eixo ordinal do Cineminha (monotonia do Johnny); heurística do seletor da Descoberta (token `score`); base do `MIX_RISCO` |
| `FAIXA_BUREAU` | ordinal | `B1`…`B5` | `B3` | Opcional | Segundo score, **fortemente correlacionado** ao interno (multicolinearidade); segundo eixo ordinal; token `bureau` na heurística do seletor |
| `PORTE_EMPRESA` | categorical | `MEI, MICRO, PEQUENA, MEDIA, GRANDE` | `MEI` | **Obrigatória** | Dimensão dos clusters plantados (porte pequeno ⇒ score bom ⇒ risco baixo); eixo curto de Cineminha; condição do segmento plantado 1 |
| `SETOR` | categorical | 8 valores; `MINERACAO` é **categoria rara** (~0,4%) | `CONSTRUCAO` | **Obrigatória** | Impacto setorial no risco (construção ×1,5); condição do segmento plantado 2; categoria rara testa portas de chegada ~zero (Simplificação) e caudas de gráficos |
| `REGIAO` | categorical | 5 valores; `SUDESTE` muito frequente (~45%) | `NORTE` | **Obrigatória** | Relação **fraca** com risco (contraste com preditores fortes); condição do segmento plantado 2; categoria dominante testa desbalanceamento |
| `UF` | categorical | 27 valores, coerentes com `REGIAO` | `AC` | Opcional | **Alta cardinalidade** moderada: estoura o teto de 10 ports do losango, pede Agrupamentos no Dashboard, testa `MAX_SERIES=12`; `AC` carrega a **anomalia** plantada (risco ×4) |
| `CANAL` | categorical | `DIGITAL, LOJA, PARCEIRO, TELEVENDAS` | `DIGITAL` | **Obrigatória** | Efeito moderado em risco e conversão; condição do segmento plantado 1 |
| `PRODUTO` | categorical | `CARTAO, CAPITAL_GIRO, FINANCIAMENTO` | `CARTAO` | Opcional | Domínio curto para Cineminha tipo `offer` (Com/Sem Oferta); efeito em conversão |
| `MIX_RISCO` | 🎨 Mix de Risco | categorical | `BAIXO, MEDIO, ALTO` | `MEDIO` | Opcional² | Único consumidor do tipo `mixRisco`: distribuição de mix por ponto da fronteira no **Johnny** |
| `FLAG_RESTRITIVO` | categorical | `SIM, NAO` + **3% vazios** | `SIM` | **Obrigatória** | Binária altamente preditiva (risco ×2,2); vazios testam nulos em regra de Lens/filtros/ports; interage com a política AS IS |
| `CODIGO_VENDEDOR` | categorical³ | `V001`…`V350` (350 distintos, 30 concentram ~50%) | `V017` | Opcional | **Cardinalidade muito alta**: força dict encoding Uint16 (>256), Agrupamentos/`autoBuckets`, truncamento de séries; ³a heurística sugere ordinal (padrão `V###`) — erro proposital para testar a correção manual no Passo 2 |
| `DIA_SEMANA` | categorical | `SEG`…`DOM` | `QUA` | Opcional | **Irrelevante por construção** (IV ≈ 0): controle de falso-positivo da Descoberta, ranking de variáveis, contraste no glossário |

## Variáveis contínuas (Filtro numérico)

| Coluna | Valores | Exemplo | Obrig.¹ | Justificativa / quem usa |
|---|---|---|---|---|
| `TEMPO_ATIVIDADE_MESES` | inteiro 0–480, ~476 distintos, **1% vazios** | `37` | **Obrigatória** | Faixas por Risco com **monotonia verdadeira** (risco cai com a idade); regras `lt/gt` do Decision Lens; banda "Sem valor"; passa `isContinuousColumn` (≥30 distintos, ≥90% parseável) |
| `FATURAMENTO_MENSAL` | decimal com vírgula, lognormal, cauda pesada + 0,3% outliers ×20, **1,5% vazios** | `9741,31` | **Obrigatória** | Faixas por Risco com risco em **"U"** (toggle de monotonia muda o resultado); aviso DEC-FR-008 no form do cluster (dim contínua); distribuição fortemente assimétrica + outliers; correlação forte com `LIMITE_PRE_APROVADO` e `QTD_FUNCIONARIOS` |
| `QTD_FUNCIONARIOS` | inteiro 1–5000, log-espalhado por porte | `163` | Opcional | Correlação positiva porte↔funcionários↔faturamento; 3ª candidata a faixas; distribuição discreta assimétrica |
| `LIMITE_PRE_APROVADO` | inteiro (múltiplos de 100), vazio quando faturamento vazio | `161600` | Opcional | Derivada plantada `faturamento × f(score)` — correlação forte positiva com faturamento e negativa com score; regras numéricas de Lens; nulos correlacionados (não aleatórios) |

## Métricas sumarizadas (mapeadas automaticamente pelo wizard)

| Coluna | Tipo (wizard) | Valores | Exemplo | Obrig.¹ | Semântica |
|---|---|---|---|---|---|
| `QTD_PROPOSTA` | 📊 Vol. Propostas | inteiro 1–200 (55% das linhas = 1–2) | `5` | **Obrigatória** | Volume do micro-grupo; pondera TODAS as contagens do motor |
| `QTD_ALTAS` | 📈 Altas Reais | inteiro ≤ `QTD_PROPOSTA`; 0 quando reprovado | `2` | **Obrigatória** | Conversões reais (só linhas aprovadas convertem); denominador da Inad. Real |
| `QTD_ATRS_OVER_30` | ⚠️ Inad. Real | inteiro ≤ `QTD_ALTAS`; **vazio** quando não há altas | `0` | **Obrigatória** | Atrasos >30d observados; numerador da Inad. Real (`∑atrs/∑altas`) |
| `QTD_INFER_CONV` | 🔮 Conv. Inferida | decimal ≥ 0 (vírgula), presente em **todas** as linhas | `2,017127` | **Obrigatória** | Conversões estimadas pelo modelo (também para reprovados — viabiliza o contrafactual); denominador da Inad. Inferida |
| `QTD_INFER_FL_ATRS` | 🎯 Inad. Inferida | decimal ≥ 0 (vírgula), todas as linhas | `0,031917` | **Obrigatória** | Atrasos estimados; numerador da Inad. Inferida (`∑infer_atrs/∑infer_conv`) |

¹ "Obrigatória" = a funcionalidade-alvo dela não funciona sem a coluna. As opcionais
enriquecem cenários, mas o app importa a base sem elas.
² Sem `MIX_RISCO` o Johnny funciona, apenas sem a distribuição de mix.
³ Corrigir manualmente para Categórica no Passo 2 (ver README).

## Invariantes garantidos pelo gerador

- `QTD_ATRS_OVER_30 ≤ QTD_ALTAS ≤ QTD_PROPOSTA` em toda linha.
- `QTD_ALTAS = 0` e `QTD_ATRS_OVER_30` vazio em linhas não aprovadas no AS IS.
- `QTD_INFER_CONV ≤ QTD_PROPOSTA` (taxa inferida ≤ 95%).
- `UF` sempre pertence à `REGIAO` da linha; `MEI ⇒ QTD_FUNCIONARIOS = 1`.
- Nenhum valor com acento ou aspas — sem armadilha de encoding/escape no parse.
- Ordem dos cabeçalhos importa: `QTD_ATRS_OVER_30` vem antes das colunas `INFER_*` para o
  first-match dos regexes de `suggestMetricColumns` resolver como esperado (validado).
