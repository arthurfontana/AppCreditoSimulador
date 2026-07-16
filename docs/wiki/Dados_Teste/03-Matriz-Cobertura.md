# Matriz de Cobertura Funcional

> **Manutenção**: feature nova/ajustada ⇒ atualizar a linha da matriz (ou a lista de
> não-cobertos, com motivo) na mesma sessão — ver `README.md § Contrato de manutenção`.
> Não regenerar o CSV; a regeneração é decisão do usuário.

## Funcionalidade → Colunas → Cenário presente na base

| Funcionalidade | Colunas utilizadas | Cenário existente no dataset |
|---|---|---|
| Wizard P1 (delimitador/decimal) | todas | `;` + vírgula decimal em 2 colunas float ⇒ detecção com alta confiança |
| Wizard P2 (classificação) | todas | 5 métricas auto-sugeridas por regex (validado); ordinais `R##`/`B#` auto-detectadas; erro proposital em `CODIGO_VENDEDOR` p/ correção manual |
| Wizard P3 (AS IS) | `DECISAO_ANALISE` | 3 valores: Aprovado/Reprovado + `PENDENTE` (~2%) mapeado como Ignorar |
| Encoding colunar (Uint8/Uint16/num) | todas | dims <256 distintos (Uint8), `CODIGO_VENDEDOR` 350 (Uint16), 5 métricas + 4 contínuas (Float64) |
| Losango de decisão (≤10 ports) | `SCORE_INTERNO` (10 = teto exato), `PORTE_EMPRESA`, `SETOR`, `CANAL`, `REGIAO`, `MIX_RISCO`, `PRODUTO`, `FLAG_RESTRITIVO` | domínios de 2 a 10 valores; `UF` (27) prova o corte do teto |
| Cineminha 2D + prévia AS IS | `SCORE_INTERNO` × `PORTE_EMPRESA` (10×5), `FAIXA_BUREAU` × `SETOR` | interseções com 100% de reprovação AS IS (R09–R10 restritivo) ⇒ caselas nascem não elegíveis |
| Cineminha `offer` | `PRODUTO` × `CANAL` | domínios curtos p/ oferta |
| Decision Lens (operadores) | `FLAG_RESTRITIVO`, `SETOR` (`in/notIn`), `FATURAMENTO_MENSAL`, `TEMPO_ATIVIDADE_MESES`, `LIMITE_PRE_APROVADO` (`lt/lte/gt/gte`) | contínuas com ampla faixa dinâmica; vazios testam não-match |
| Terminal ⟳ AS IS / `incrementalResult` (rToA/aToR) | `DECISAO_ANALISE` + métricas | segmentos plantados geram promoções e rebaixamentos mensuráveis ao simular políticas por score |
| Indicadores (Taxa/Inad Real/Inad Inferida) | 5 métricas | inad. real global ~3–4% e blocos >5% ⇒ os dois estados de cor do painel |
| Otimizador single (Pareto/cenários) | Cineminha score×porte + métricas | gradiente monotônico de risco entre células ⇒ fronteira não-degenerada, joelho real |
| Johnny (precedência/cascata/mix) | idem + `MIX_RISCO` ordinais | eixos ordinais com risco de fato monotônico; `MIX_RISCO` alimenta a distribuição por ponto |
| Goal Seek (clássico e profundo) | política + métricas | blocos heterogêneos (R07; MEI+DIGITAL) dão movimentos com delta real; travas/restrições exercitáveis |
| Simplificação (prova de equivalência) | `SETOR` (`MINERACAO` ~0,4%), qualquer política | porta de chegada ~zero ⇒ regra sem efeito colapsável com `diff=0` |
| Documentação Automática | política + `SAFRA` + defs de cluster/faixas | glossário com variável de cluster e de faixas; funil ≡ motor; changelog entre canvases |
| Descoberta — `approvable_low_risk` | `PORTE_EMPRESA`+`CANAL` (2D) | **plantado**: MEI+DIGITAL (R07/R08), ~1,8% das linhas, 95% reprovado, inad. inferida ~4,4% vs ~11% do bloco |
| Descoberta — `approved_high_risk` | `SETOR`+`REGIAO` (2D) | **plantado**: CONSTRUCAO+NORTE, inad. inferida ~21% vs ~5,4% global, majoritariamente aprovado |
| Descoberta — `heterogeneous_block` | `TEMPO_ATIVIDADE_MESES`, `FLAG_RESTRITIVO` dentro de blocos de score | dentro de R07 (tratamento único) o risco varia ×2+ por tempo/restritivo ⇒ "quebra que falta" |
| Descoberta — `anomaly` | `UF`, `SAFRA` | **plantados**: UF=AC (risco ×4, volume pequeno) e safra 202509 (×1,45) |
| Descoberta — estabilidade temporal | `SAFRA` | 12 safras; segmentos plantados valem o ano todo ⇒ selo positivo; 202509 quebra série de achado espúrio |
| Descoberta — seletor de variáveis | `SAFRA`, `SCORE_INTERNO`, `FAIXA_BUREAU` | tokens `safra/score/bureau` nascem desmarcados (heurística observável) |
| Descoberta — FDR/shrinkage/dedup | `DIA_SEMANA`, `UF` | irrelevante com 7 valores + 27 UFs ruidosas = many-comparisons real; nicho pequeno (AC) sofre shrinkage |
| Clusterização k-means + quadrante | `PORTE_EMPRESA`, `SCORE_INTERNO`, `SETOR`, `CANAL` | 3 macro-grupos plantados (pequena/score bom/risco baixo ↔ grande/score ruim/risco alto) + sobreposição parcial em PEQUENA/MEDIA |
| Cluster — escopo por nó / aviso DEC-FR-008 | idem + `FATURAMENTO_MENSAL` | população de um nó difere da global (pós-losango de score); marcar faturamento como dim dispara o aviso + ponte p/ faixas |
| Variável de Cluster (salvar/editar/propagar) | dims acima | grupos nomeáveis; mover MICRO entre grupos re-roteia de verdade |
| Faixas por Risco — monotônica | `TEMPO_ATIVIDADE_MESES` | risco estritamente decrescente com tempo ⇒ cortes monotônicos ótimos; 1% vazios ⇒ banda "Sem valor" |
| Faixas por Risco — "U" (toggle livre) | `FATURAMENTO_MENSAL` | risco em U plantado ⇒ IV do corte livre > IV do monotônico (diferença observável) |
| Faixas — `minShare`/auto-k/outliers | `FATURAMENTO_MENSAL`, `QTD_FUNCIONARIOS` | cauda pesada + 0,3% outliers ×20 ⇒ piso de volume atua; auto-k para no ganho marginal |
| Variável de Faixas (ordinal derivada) | idem | faixas com ordem natural; rótulos pt-BR ("até 100 mil"…) |
| Dashboard — eixo temporal | `SAFRA` | `YYYYMM` ordena via `parseTemporalKey`; degrau visível em 202509 |
| Dashboard — série por dimensão / teto 12 | `UF` (27), `CODIGO_VENDEDOR` (350) | truncamento `MAX_SERIES=12` observável |
| Dashboard — Agrupamentos | `UF`, `CODIGO_VENDEDOR`, `SCORE_INTERNO` | alta cardinalidade colapsável em faixas (`autoBuckets`); R01–R05/R06–R10 |
| Dashboard — filtros básico/avançado | qualquer dim + contínuas | checkbox em dims curtas; `gt/lt` sobre faturamento/tempo |
| Dashboard — KPI A/B vs AS IS | métricas + `DECISAO_ANALISE` | AS IS ≠ simulado por construção (segmentos plantados) |
| Dashboard — export CSV/PDF | todas | dataset largo com dims + métricas + cenários |
| Bibliotecas (Cineminha/Políticas) | headers | reimportar com cabeçalhos renomeados exercita o mapeamento de variáveis (ver abaixo) |
| PolicyIR / export diagnóstico | política | qualquer política sobre a base |
| Projeto save/load (schema 2.7) | `clusterDefs`/`rangeDefs` | criar variável de cluster + de faixas e salvar/abrir ⇒ round-trip completo |
| Pool de workers / ComputeRouter / sidecar | volume | 20k linhas = caminho normal; `--rows 200000+` força clamps/roteamento Classe B |

## Checklist dos cenários exigidos

| Cenário pedido | Onde está |
|---|---|
| Casos simples / complexos | losango 1 variável ↔ política score+cineminha+lens+cluster |
| Exceções | aprovados R08+ (8%, "exceção de mesa"); reprovados com score bom (3%) |
| Valores nulos | `FLAG_RESTRITIVO` 3%, `FATURAMENTO_MENSAL` 1,5%, `TEMPO_ATIVIDADE_MESES` 1%, `QTD_ATRS_OVER_30` estrutural, `LIMITE_PRE_APROVADO` correlacionado |
| Categoria rara / muito frequente | `MINERACAO` 0,4% / `SUDESTE` 45% |
| Alta / baixa cardinalidade | `CODIGO_VENDEDOR` 350, `UF` 27 / `FLAG_RESTRITIVO` 2 (+nulo), `PRODUTO` 3 |
| Contínuas / discretas | faturamento, tempo, limite / funcionários, qtds |
| Distribuição ~normal / assimétrica | score dentro de cada porte / faturamento lognormal cauda pesada |
| Outliers | 0,3% de faturamentos ×20 |
| Clientes excelentes / ruins / intermediários | R01–R03 restritivo NAO / R08–R10 ou restritivo SIM / R04–R07 |
| Segmentos separados / sobrepostos | MEI↔GRANDE bem separados; PEQUENA↔MEDIA sobrepostos (means 5,0 vs 6,3, sd 1,8) |
| Relações fortes / fracas / ausentes | score→inad, faturamento→limite / região→inad / `DIA_SEMANA`→nada |
| Correlações positivas / negativas | porte↔funcionários↔faturamento; tempo↔porte / score↔limite; tempo→risco |
| Variáveis muito preditivas / irrelevantes | `SCORE_INTERNO`, `FLAG_RESTRITIVO` / `DIA_SEMANA` (e `UF` fora de AC) |

## Funcionalidades ainda não cobertas por esta base (e por quê)

| Funcionalidade | Motivo | Como cobrir |
|---|---|---|
| Mapeamento de variáveis da Biblioteca de Políticas em base **renomeada** | exige uma 2ª base com cabeçalhos diferentes — de propósito não incluída para não duplicar 2,7 MB | duplicar o CSV e renomear cabeçalhos (ex.: `SCORE_INTERNO`→`RATING_INTERNO`), ou gerar com `--seed` diferente e renomear |
| Motor Python / sidecar (H5–H8), Goal Seek Profundo (MILP) | dependem de **ambiente** (sidecar instalado), não de colunas — a base é compatível | instalar o Motor Python e usar a mesma base (idealmente `--rows 200000+`) |
| Clamps de volume do browser / pool sob carga | 20k linhas não estressam | gerar versão de performance com `--rows` (não versionar) |
| Métricas-alvo alternativas (margem/churn/CAC) | o motor é genérico (`resolveRiskMetric`), mas o wizard só oferece inad. real/inferida — coluna extra não seria consumível hoje | quando o wizard expor a métrica, adicionar coluna no gerador |
| Roadmap não implementado (export PNG/SVG, Lens incremental, auto-save localStorage, fronteira 3D) | funcionalidade inexistente no código | n/a |
| UI pura (touch, BuildBadge, undo/redo, frames, zoom) | não depende do conteúdo dos dados | teste manual/E2E, qualquer base |
