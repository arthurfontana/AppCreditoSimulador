# Roadmap

Funcionalidades planejadas, ainda não implementadas. Organizadas por área.

---

## Cineminha — Otimização

### Restrição de monotonicidade para variáveis ordinais
- Flag `ordinal` por coluna de decisão (já existe no wizard passo 2, falta usar)
- Algoritmo Pareto com restrição de corte monotônico (escada "Young diagram")
- Aplicável a variáveis como ratings R1–R20: se aprovo R5, devo aprovar R1–R4 também

### Sliders adicionais
- Margem de contribuição
- Rentabilidade por segmento

### Fronteira Pareto multi-dimensional
- Atualmente otimiza inadInferida como proxy; futuro: incluir inadReal e volume de altas como dimensões independentes

---

## Decision Lens

Comparação lado a lado entre a política AS IS (histórica) e a política simulada no canvas.

- Usa `__DECISAO_ORIGINAL` como baseline
- Mostra delta de aprovação, delta de inadimplência esperada
- Destaca quais segmentos foram promovidos ou rebaixados na nova política

---

## Motor de simulação incremental

Em vez de simular toda a base do zero, sobrescreve apenas o subconjunto afetado pela alteração:
- Identifica as linhas impactadas pela mudança de regra
- Recalcula apenas essas linhas
- Acumula ao resultado base — mais performático para datasets grandes

---

## Cálculo de delta e impacto marginal

- "Adicionar esta célula do Cineminha muda a aprovação em +X pp e a inad em +Y pp"
- Feedback inline em cada célula da matriz durante a edição manual
- Permite entender o custo marginal de cada decisão

---

## Copiloto de Política (IA opcional, local-first)

Épico planejado e documentado em [[Epicos-CopilotoIA]] (construção assistida,
sugestões de melhoria orientadas a objetivo/Goal Seek, documentação automática).
Princípio: tudo funciona 100% local; IA é camada opcional de enriquecimento
(ADR-007). O plano de sessões absorve dois itens deste Roadmap: **JSON canônico da
política** (PolicyIR, Sessão 0) e **cálculo de delta marginal** (deltas O(1) por
segmento no Goal Seek, Sessão 4).

### Frente 5 — Policy Strategy Assistant (visão de longo prazo, não é sessão)

Um nível acima da Descoberta de Segmentos (Frente 4): em vez de descobrir segmentos,
descobrir **estratégias** — "qual combinação de recomendações atinge a meta com o
melhor trade-off?", "vale flexibilizar o segmento A e endurecer o B?", "qual a
sequência ótima de mudanças?". Premissa de design inegociável: **deltas de mudanças
NÃO são aditivos** (aplicar A muda a população que chega ao ponto de B) — qualquer
ranking de combinações exige re-simulação real por combinação (busca greedy/beam
sobre achados, mesmo padrão Johnny/Goal Seek — nunca enumeração cega nem soma de
deltas). Pré-condições para virar épico: (a) MVP da Frente 4 validado com usuário
real; (b) colunas financeiras (margem/custo) no modelo de dados, sem as quais "ROI"
seria só um proxy que o Goal Seek já otimiza. A semente já está especificada: a
aplicação combinada de N achados com delta re-simulado (Sessão 12) responde "esses
três segmentos juntos atingem a meta?" sem motor de estratégia. Degrau **Planejar**
da pirâmide de maturidade ([[Epicos-CopilotoIA]]).

---

## Exportação

- Exportar política de crédito como JSON estruturado
- Exportar resultado da simulação como CSV
- Exportar canvas como imagem (PNG/SVG)

---

## Persistência

- Salvar estado do canvas no localStorage (autosave)
- Exportar/importar sessão completa como arquivo `.credito.json`
