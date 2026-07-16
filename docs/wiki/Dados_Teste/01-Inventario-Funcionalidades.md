# Inventário de Funcionalidades — análise do código-fonte

Levantamento feito sobre `src/App.jsx` (~14.600 linhas), `src/simulation.worker.js`
(~6.800 linhas), módulos compartilhados (`columnar.js`, `analytics.js`, `goalSeek.js`,
`policySimplify.js`, `policyIR.js`, `clusterVar.js`, `rangeVar.js`, `computeRouter.js`,
`autoLayout.js`, `policyDocRender.js`, `dashboardComponents.jsx`) e a documentação em
camadas (`docs/claude/*.md`, `docs/wiki/*.md`). Para cada funcionalidade: o que faz,
que dados consome e **o que a base de testes precisa conter** para exercitá-la.

Convenção: `[tipo]` refere-se ao tipo de coluna do wizard (`COL_TYPES`): `id`, `decision`
(Filtro), `qty`, `qtdAltas`, `qtdAltasInfer`, `inadReal`, `inadInferida`, `mixRisco`,
`temporal`; Tipo Var. = `categorical` | `ordinal`.

## 1. Importação e preparação de dados

### 1.1 Wizard de importação — Passo 1 (delimitador/decimal)
- **Faz**: detecção automática de delimitador (`detectDelimiter`) e separador decimal
  (`detectDecimalSep`) com badge de confiança; preview; toggle de cabeçalho; parse
  assíncrono vetorizado direto para colunar (M1) com modal de progresso.
- **Exige da base**: CSV com delimitador consistente (`;`), decimais com vírgula em volume
  suficiente para detecção confiante, cabeçalho na 1ª linha.

### 1.2 Wizard — Passo 2 (classificação de colunas)
- **Faz**: classificação em 9 tipos + Tipo Var. por coluna; sugestão automática
  (`suggestMetricColumns` por regex de nome; `suggestVarType` por padrão dos valores).
- **Exige**: nomes de métrica que casem os regexes; colunas ordinais com padrão `R##`/`B#`;
  categóricas puras; numéricas contínuas; pelo menos um caso em que a heurística **erra**
  (para testar a correção manual — na base: `CODIGO_VENDEDOR`, sugerido ordinal).

### 1.3 Wizard — Passo 3 (Variável de Decisão AS IS)
- **Faz**: mapeia os distinct values de uma coluna não-métrica para
  `APROVADO/REPROVADO/IGNORAR`; deriva `__DECISAO_ORIGINAL`; salva `asIsConfig`.
- **Exige**: coluna de decisão histórica com ≥3 valores distintos, incluindo um que deva
  ser **ignorado** (na base: `PENDENTE`, ~2%).

### 1.4 Armazenamento colunar (`csvStore`, `src/columnar.js`)
- **Faz**: dict encoding por coluna (Uint8/Uint16/Int32 conforme cardinalidade),
  `Float64Array` para métricas, SharedArrayBuffer quando disponível.
- **Exige**: colunas de baixa (<256 distintos) **e** alta (>256 distintos) cardinalidade
  para cobrir os dois caminhos de encoding (na base: `CODIGO_VENDEDOR` com 350 distintos).

## 2. Canvas e componentes de fluxo

### 2.1 Losango de decisão (`decision`)
- **Faz**: nó com até **10 ports automáticos** (um por valor distinto) roteando o fluxo.
- **Exige**: colunas Filtro com ≤10 distintos (usáveis direto) e com >10 (testa o teto:
  `UF` com 27, `CODIGO_VENDEDOR` com 350).

### 2.2 Cineminha (matriz cruzada, `eligibility`/`offer`)
- **Faz**: matriz 1D/2D de elegibilidade por interseção de duas variáveis; prévia AS IS
  contextualizada ao nó (worker, `computeCinemaAsIsCells`); reconciliação ao trocar base.
- **Exige**: pares de variáveis com domínios pequenos e ordenáveis (ex.:
  `SCORE_INTERNO` 10×`PORTE_EMPRESA` 5) e AS IS configurado com interseções 100% reprovadas
  (para a prévia marcar caselas não elegíveis).

### 2.3 Decision Lens
- **Faz**: filtra sub-população por regras AND/OR com operadores
  `equal/notEqual/in/notIn/lt/lte/gt/gte`; contagem ponderada por volume (M10).
- **Exige**: colunas categóricas para `in/notIn` e **numéricas contínuas** para
  `lt/gt` (`FATURAMENTO_MENSAL`, `TEMPO_ATIVIDADE_MESES`, `LIMITE_PRE_APROVADO`).

### 2.4 Terminais (✅/❌/⟳ AS IS), frames, painel de simulação, multi-canvas, auto-layout, domínio exibido, export diagnóstico
- **Fazem**: acúmulo de decisão; terminal ⟳ roteia por `__DECISAO_ORIGINAL`; abas de canvas
  comparáveis; `computeAutoLayout`; "Configurar nó" esconde valores; `exportDiagnosticCSV`.
- **Exigem**: AS IS presente; qualquer política montada; nada além das colunas Filtro.

## 3. Motor de simulação

### 3.1 Simulação em tempo real (`runSimulation`, tick M6, motor compilado M8)
- **Faz**: Taxa de Aprovação, Inad. Real (`∑QTD_ATRS_OVER_30/∑QTD_ALTAS`), Inad. Inferida
  (`∑QTD_INFER_FL_ATRS/∑QTD_INFER_CONV`), `edgeStats`, `nodeArrivals`.
- **Exige**: as 5 métricas sumarizadas consistentes (`atrs ≤ altas ≤ qtd`), inad. real perto
  do limiar de cor de 5% para ver os dois estados visuais.

### 3.2 Comparativo incremental AS IS (`incrementalResult`, rToA/aToR)
- **Faz**: contrafactual da nova política vs decisão histórica; promoções (R→A) e
  rebaixamentos (A→R).
- **Exige**: AS IS com desalinhamentos plantados — segmentos reprovados que a nova política
  aprovaria e vice-versa (segmentos 1 e 2 da base).

## 4. Otimizadores

### 4.1 Otimizador single-Cineminha (`optimModal`)
- **Faz**: fronteira Pareto por célula, 4 cenários (conservador/balanceado/melhor
  eficiência/expansão), sliders de teto de inad.
- **Exige**: matriz com gradiente real de risco entre células (score × porte tem) e volume
  suficiente por célula.

### 4.2 Johnny (multi-Cineminha)
- **Faz**: pool de células de N Cineminhas, grafo de precedência (monotonia ordinal +
  cascata), greedy com shrinkage bayesiano, **distribuição de mix de risco** por ponto da
  fronteira (coluna `[mixRisco]`).
- **Exige**: eixos **ordinais** (`SCORE_INTERNO`, `FAIXA_BUREAU`) para a monotonia; coluna
  `MIX_RISCO` classificada como 🎨; risco monotônico de verdade (senão a precedência não faz sentido).

### 4.3 Goal Seek clássico (Sessão 4) e Profundo (MILP, sidecar)
- **Faz**: busca movimentos (troca de terminal, célula de Cineminha, `add_break`) para
  atingir meta de aprovação/inad com restrições e travas 🔒; delta O(1) por movimento.
- **Exige**: política com margem de manobra — blocos com risco heterogêneo onde mover
  segmentos muda os KPIs de forma mensurável (gradiente por score/porte/setor garante).

## 5. Copiloto analítico

### 5.1 Descoberta de Segmentos (beam search 1D→2D; profundidade 3–4 no sidecar)
- **Faz**: acha segmentos (conjunções de `LensRule` sobre colunas Filtro) desalinhados:
  `approvable_low_risk`, `approved_high_risk`, `heterogeneous_block`, `asis_divergence`,
  `anomaly`; teste binomial + FDR BH + shrinkage; selo de estabilidade temporal
  (`stabilitySeries` exige coluna temporal); recomendações materializáveis com delta
  re-simulado; aplicação combinada; escopo por nó; seletor de variáveis pré-desmarca
  colunas com tokens temporais (`safra`) e de score (`score`, `bureau`).
- **Exige**: segmentos plantados com massa ≥~1% e desvio de risco significativo nas duas
  direções; segmento **2D** (conjunção de 2 colunas) para o beam de profundidade 2;
  coluna temporal para estabilidade/anomalia por safra; valor anômalo (UF=AC); base
  majoritariamente homogênea fora dos plantados (controle de falso-positivo);
  nomes de coluna que disparem a heurística do seletor (`SAFRA`, `SCORE_INTERNO`,
  `FAIXA_BUREAU`).

### 5.2 Clusterização de Segmentos (k-means worker/sidecar) + Variável de Cluster
- **Faz**: agrega por tupla de dims categóricas, k-means sobre comportamento
  (aprovação/risco), quadrante Volume × Risco; escopo por nó (`resolveScopeRowMask`);
  salvar como **coluna Filtro derivada** (`clusterDefs`, `deriveClusterColumn`,
  first-match); edição/renomeio com propagação de refs; aviso para dimensão contínua
  (DEC-FR-008).
- **Exige**: dims categóricas cujo cruzamento separa grupos de comportamento distintos
  (porte × score × setor); uma coluna **contínua** marcada como Filtro para disparar o
  aviso DEC-FR-008 (`FATURAMENTO_MENSAL`).

### 5.3 Criar Faixas por Risco + Variável de Faixas (Épico FR)
- **Faz**: binning supervisionado IV/WoE por DP exata sobre coluna contínua; monotonia
  opcional; piso de volume (`minShare`); banda "Sem valor"; auto-k; comparação com corte
  cego (`ivUniform`); materialização como coluna ordinal (`rangeDefs`).
- **Exige**: ≥2 colunas contínuas com ≥30 distintos e ≥90% do volume parseável — uma com
  risco **monotônico** (`TEMPO_ATIVIDADE_MESES`) e uma com risco em **"U"**
  (`FATURAMENTO_MENSAL`, para provar que o toggle de monotonia muda o resultado); valores
  vazios para a banda "Sem valor"; outliers na cauda.

### 5.4 Simplificação com Prova de Equivalência
- **Faz**: propõe colapsos de nós/regras sem efeito com prova `diff=0` ou delta declarado.
- **Exige**: possibilidade de montar políticas com redundância (qualquer coluna Filtro serve;
  portas de baixo volume — categoria rara `MINERACAO` — geram regras de chegada ~zero).

### 5.5 Documentação Automática
- **Faz**: `docModel` ≡ motor (KPIs/funil), glossário de variáveis (incl. regras de
  Cluster e de Faixas), changelog via `diffPolicyIR`, contrato de privacidade N2.
- **Exige**: nada além do que as demais já exigem (opera sobre política + `csvStore`).

### 5.6 Ranking de variáveis (`computeVariableRanking`) e prévia AS IS
- **Exigem**: variáveis com poder discriminante variado — inclusive uma **irrelevante**
  (`DIA_SEMANA`, IV ≈ 0) para o contraste.

## 6. Analytics Workspace (aba Dashboard)

- **Widgets**: linha, barras, barras 100%, KPI A/B (cenários incl. AS IS), caixa de texto;
  métricas `approvalRate/inadReal/inadInferida/qty/approvedQty/approvedAltasInfer`;
  série por dimensão com teto `MAX_SERIES=12` (dimensão com >12 valores testa o truncamento).
- **Eixo temporal** (DEC-AW-005): coluna `[temporal]` ordenada por `parseTemporalKey`
  (formato `YYYYMM` suportado).
- **Agrupamentos**: colapsar dimensão de alta cardinalidade em faixas (`autoBuckets`) —
  pede colunas como `UF` (27) e `CODIGO_VENDEDOR` (350).
- **Filtros página/visual**: modo básico (checkbox) e avançado (operadores do Lens, incl.
  `lt/gt` sobre contínuas).
- **Exports**: CSV do dataset largo, PDF do dashboard com detalhamento de filtros.

## 7. Bibliotecas e interoperabilidade

- **Biblioteca de Cineminhas**: salvar/reaplicar configurações de matriz.
- **Biblioteca de Políticas (PolicyIR)**: template exige **mapeamento de variáveis** ao
  aplicar em base renomeada; variável sem mapeamento vira pendência. *Teste*: importar a
  base uma 2ª vez com cabeçalhos renomeados (ver `03-Matriz-Cobertura.md`).
- **Exportar Fluxo**: JSON canônico (PolicyIR) + CSV diagnóstico.
- **Salvar/Abrir Projeto** (`.credito.json`, schema 2.7) + auto-persistência de sessão:
  round-trip com `clusterDefs`/`rangeDefs` criados a partir desta base.

## 8. Execução híbrida

- **Pool de workers (H3)**, **ComputeRouter (H4)**, **Motor Python/sidecar (H5–H8)**:
  mesma base serve; o que muda é ambiente (sidecar instalado) e volume (usar
  `--rows 200000+` do gerador para forçar os clamps declarados do browser e o roteamento
  Classe B).

## 9. Fora do escopo de dados

UI pura (touch/mobile, BuildBadge, undo/redo, zoom/pan, frames, temas de aresta),
CI/CD, servidor `serve.py` — não dependem do conteúdo da base. Ver a lista de não-cobertos
em `03-Matriz-Cobertura.md`.
