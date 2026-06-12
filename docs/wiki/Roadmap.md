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

## Exportação

- Exportar política de crédito como JSON estruturado
- Exportar resultado da simulação como CSV
- Exportar canvas como imagem (PNG/SVG)

---

## Persistência

- Salvar estado do canvas no localStorage (autosave)
- Exportar/importar sessão completa como arquivo `.credito.json`
