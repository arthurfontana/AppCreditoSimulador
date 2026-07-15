# AppCreditoSimulador

Whiteboard interativo para modelagem e simulação de políticas de crédito. O analista monta um fluxo visual de decisão arrastando variáveis para um canvas, e o simulador calcula em tempo real a taxa de aprovação e os indicadores de inadimplência.

## Como funciona em 60 segundos

1. **Importe um CSV** com dados históricos de propostas (volume, inadimplência, conversão)
2. **Classifique as colunas** — qual é filtro de decisão, qual é volume, qual é inadimplência
3. **Arraste variáveis** para o canvas como losangos de decisão ou matrizes cruzadas (Cineminha)
4. **Conecte os nós** a ✅ Aprovado ou ❌ Reprovado
5. **Leia os indicadores** no painel de simulação — Taxa de Aprovação, Inad. Real, Inad. Inferida

## Navegação desta Wiki

| Página | Conteúdo |
|--------|----------|
| [[Arquitetura]] | Stack, estrutura de dados, padrões de código |
| [[Epicos-Simulador]] | Engine de simulação e painel de indicadores |
| [[Epicos-Cineminha]] | Matriz cruzada e motor de otimização Pareto |
| [[Epicos-Importacao]] | Wizard de importação CSV e variável AS IS |
| [[Epicos-CopilotoIA]] | Copiloto de política (IA opcional, local-first) — arquitetura evolutiva |
| [[Roadmap]] | Funcionalidades planejadas e não implementadas |
| [[Epicos-Binning-Multivariado]] | Épico futuro (não iniciado): binning multivariado — árvore rasa → sugestão de Cineminha |
| [[Decisoes]] | Registros de decisão arquitetural (ADRs) |

## Stack resumida

- **Frontend**: React + Vite, arquivo único `src/App.jsx`
- **Estilos**: inline styles — sem CSS externo, sem biblioteca de UI
- **Canvas**: SVG puro; matrizes interativas via `foreignObject`
- **Build**: GitHub Actions → `release/` no repositório
