# Roadmap

Funcionalidades planejadas, ainda não implementadas. Organizadas por área.

---

## Copiloto — Clusterização Contextual + Faixas de Risco (Épico FR — planejado)

Plano de execução completo (DEC-FR-001..010, sessões FR1–FR7 com prompts prontos):
[[Copiloto-ClusterContextual-FaixasRisco]].

- **Escopo por nó da Clusterização** (FR1–FR3): "🧩 Clusterizar aqui" nas toolbars de
  losango/Cineminha/Lens — clusteriza só a população que efetivamente chega ao nó
  (walk M8, mesmo padrão do "🔍 Descobrir aqui"), incl. modo profundo via rowMask.
- **Faixas de Risco** (FR4–FR6): binning supervisionado de variáveis contínuas (ex.:
  faturamento presumido) — cortes que maximizam IV/WoE de inadimplência, monotônicos
  por padrão, materializados como variável derivada persistente (`rangeDefs`) usável
  no canvas, no Dashboard e na própria Clusterização.

---

## Cineminha — Otimização

### Restrição de monotonicidade para variáveis ordinais
- Flag `ordinal` por coluna de decisão (já existe no wizard passo 2, falta usar)
- Algoritmo Pareto com restrição de corte monotônico (escada "Young diagram")
- Aplicável a variáveis como ratings R1–R20: se aprovo R5, devo aprovar R1–R4 também

### Sliders adicionais
- Margem de contribuição
- Rentabilidade por segmento

### Fronteira Pareto multi-dimensional ✅ ENTREGUE (GS5/GS6)
- O sidecar Python (`goal_seek_deep`, GS5) gera `curves: [{ceiling, frontier}]` — uma curva Pareto por teto de inad.inf (família de curvas). `GoalSeekFrontierChart` exibe as curvas sobrepostas. O modo browser (greedy clássico, Sessão 4) continua com curva única.

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

## Execução Híbrida — Motor Python local opcional (planejado)

Épico planejado e documentado em [[Arquitetura-Execucao-Hibrida]] (ADR-008), com
plano de sessões em [[Hibrido-Prompts-Sessoes]]. Motivação: a evolução para
plataforma analítica (clusterização, seleção de indicadores, bases menos
sumarizadas, Frente 5) traz carga multiplicativa e teto de memória que o navegador
sozinho não sustenta acima de ~5MM de linhas — e o **alvo de projeto validado é
~7MM** (1–2 anos), o que dá ao épico gatilho de produto próprio. Princípio (espelho
do ADR-007): o browser continua o caminho padrão e completo; um sidecar Python local
(extensão do `serve.py` do release), **opt-in**, amplia limites e acelera —
**paridade total** (premissa validada): toda análise nova tem baseline browser com
tetos declarados, nada é exclusivo do Python; paridade numérica provada por GATEs
cross-runtime; e o app **recomenda proativamente** ligar o motor ao carregar uma
base que o browser não sustentará (DEC-HX-009). A Fase 0 do plano (telemetria,
fluidez M12–M14, dieta de memória, pool de workers) é browser-pura e tem valor
independente do híbrido; a sonda de ambiente (Sessão HP) pode rodar desde já.

---

## Exportação

- ~~Exportar política de crédito como JSON estruturado~~ ✅ ENTREGUE (PolicyIR — Copiloto Sessão 0; opção "JSON Canônico da Política" no modal Exportar Fluxo)
- Exportar resultado da simulação como CSV
- Exportar canvas como imagem (PNG/SVG)

---

## Persistência

- Salvar estado do canvas no localStorage (autosave)
- ~~Exportar/importar sessão completa como arquivo `.credito.json`~~ ✅ ENTREGUE (Salvar/Abrir Projeto — schema 2.6; auto-persistência em `sessionStorage`)
