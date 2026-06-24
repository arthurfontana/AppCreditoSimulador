# Decisões Arquiteturais (ADRs)

Registro das principais decisões de design tomadas no projeto, com contexto e justificativa.

---

## ADR-001: Arquivo único (`src/App.jsx`)

**Decisão:** todo o código React vive em um único arquivo de ~3300 linhas.

**Contexto:** o projeto começou como um protótipo rápido de whiteboard. Componentizar prematuramente aumentaria a fricção para iterar.

**Justificativa:**
- O estado é profundamente compartilhado entre todas as partes da UI — extrair componentes exigiria prop drilling extenso ou context global de qualquer forma
- A superfície de estado (shapes, conns, csvStore, vp, wizard, axisModal, optimModal) é melhor gerenciada em um único lugar
- Facilita leitura contínua do fluxo sem saltar entre arquivos

**Tradeoff aceito:** arquivo longo. Mitigado com seções bem delimitadas e nomes de função descritivos.

---

## ADR-002: Inline styles — sem CSS externo

**Decisão:** todos os estilos são definidos como objetos JavaScript inline.

**Contexto:** a UI muda dinamicamente com base em estado (cores de células, tamanhos calculados de nós, estados de hover). CSS classes exigiriam muita lógica de className condicional.

**Justificativa:**
- Estilos dependentes de estado ficam junto ao JSX que os usa — fácil de rastrear
- Sem risco de colisão de classes ou especificidade CSS
- Sem dependência de preprocessador

**Tradeoff aceito:** verbosidade nos objetos de estilo; impossibilidade de usar media queries nativamente (não relevante para uma aplicação desktop).

---

## ADR-003: SVG puro para o canvas

**Decisão:** o canvas interativo (shapes, conexões, ports, nós) é renderizado em SVG, sem biblioteca de diagramação (ex: React Flow, D3).

**Contexto:** as bibliotecas de diagramação adicionam abstrações que conflitam com o modelo de dados customizado do simulador.

**Justificativa:**
- Controle total sobre como cada shape é renderizado e como o hit-testing funciona
- Suporte a `foreignObject` para embeber HTML (matrizes do Cineminha) dentro do SVG
- Sem overhead de biblioteca — o canvas é essencialmente SVG simples + estado React

**Tradeoff aceito:** mais código de infraestrutura (pan, zoom, drag, conexões bezier) escrito à mão.

---

## ADR-004: Refs espelho para event listeners

**Decisão:** toda variável de estado tem um `ref` paralelo (`shapesR`, `vpR`, etc.).

**Contexto:** event listeners adicionados via `addEventListener` capturam o valor do estado no momento em que são criados (closure stale). Sem refs, os handlers trabalhariam com dados desatualizados.

**Justificativa:**
- Padrão estabelecido no React para esse problema específico
- Mais explícito que `useCallback` com dependências complexas

**Tradeoff aceito:** redundância — cada `setShapes` precisa também atualizar `shapesR.current`.

---

## ADR-005: Build em `release/` no mesmo repositório

**Decisão:** o artefato de build (Vite) é commitado na pasta `release/` do próprio repositório via GitHub Actions.

**Contexto:** o público-alvo usa a aplicação localmente, abrindo o arquivo `release/index.html` diretamente no navegador, sem servidor.

**Justificativa:**
- Distribuição simplificada: clonar o repo ou baixar o zip já inclui a aplicação pronta para uso
- `iniciar.bat` na pasta `release/` abre o navegador automaticamente

**Tradeoff aceito:** o repositório cresce com os artefatos de build; histórico de git inclui binários.

---

## ADR-006 (DEC-IR-004): Inferência de Negados via Tabela de Referência — Toggle de Peso e refinamentos (Fase 4)

**Decisão:** consolidar a feature de **inferência de negados por tabela de referência**
(Fases 1–4) e, na Fase 4, (a) expor um **toggle de base de peso** `n_propostas` ↔
`n_aprovados`, (b) recalcular automaticamente a inferência quando a referência é
trocada/recarregada preservando o `inferenceConfig`, e (c) refinar o selo e o alerta de
confiabilidade.

**Contexto:** o SAS entrega um artefato de dados (`inferencia_ref.csv` + `CONTRATO_INFERENCIA.md`)
e o app apenas o **aplica** — lookup em cascata + 2 multiplicações + 1 soma — sem
reimplementar estatística. A fonte por referência é **alternativa** às colunas 🔮/🎯 da
base (retrocompatível, escolhida por dataset em `inferenceConfig.source`). O CONTRATO §3.2
define o peso padrão como `n_propostas` ("abrir para os reprovados") e prevê expressamente
um toggle opcional para `n_aprovados` ("FPD sobre aprovados"). A Proposta deixou em aberto
o comportamento de troca/recarga da referência (§9.4) e o formato visual do selo/alerta
(§9.5).

**Decisões da Fase 4:**
1. **Toggle de peso** — `inferenceConfig.weightMode: 'propostas'|'aprovados'` (default
   `'propostas'`). A coluna efetiva é resolvida no worker por `resolveWeightCol(cfg,
   headers, qtyCol)`: `weightCol` explícito **sempre vence** (override avançado); senão
   `aprovados` usa a coluna de aprovados via heurística `findApprovedCol` (`/aprov/i`,
   excluindo a 📊 `qty`) e `propostas` usa a 📊 `qty`. O wizard mostra um toggle segmentado
   (📋 Propostas / ✅ Aprovados) e pré-preenche `weightCol` ao trocar para aprovados.
   **Não altera a matemática** além da coluna de peso — as Regras de Ouro (CONTRATO §4)
   seguem satisfeitas por construção.
2. **Troca/recarga da referência (§9.4)** — os effects debounced de sim/overlay/analytics
   já incluem `inferenceRef` nas deps e o worker recebe `UPDATE_INFERENCE_REF` antes do
   recompute, então a troca **recalcula automaticamente**. O `inferenceConfig` vive no
   `csvStore` e é **preservado** (não tocado ao mexer na referência). Remover a referência
   degrada estudos em modo `ref` para colunas 🔮/🎯, mantendo o config salvo para retomar.
   O painel da Tabela de Inferência exibe quantos estudos a usam e avisa quando há estudos
   configurados sem referência carregada.
3. **Refinamento do selo/alerta (§9.5)** — `InferenceSignal` ganha um **selo de base de
   peso** (⚖️ Propostas/Aprovados/Misto, vindo de `runSimulation().inferenceWeightMode`),
   **legenda** das faixas de confiabilidade e alerta em **dois níveis** (⚡ atenção 50–80%
   / ⚠ alerta <50%), com a moldura do card colorida pelo nível.

**Justificativa:**
- O toggle dá as duas leituras de negócio (abertura para reprovados vs. FPD sobre
  aprovados) sem duplicar motor: muda apenas a coluna de peso.
- Recalcular na troca e preservar o config evita reconfiguração manual e perda de estudo.
- A sinalização refinada reduz o risco de o usuário ler como certo um número herdado de
  premissa colapsada (caso PAP, CONTRATO §7).

**Tradeoff aceito:** `weightMode` é uma camada semântica acima de `weightCol` (o worker
ainda resolve a coluna), e a heurística de coluna de aprovados (`/aprov/i`) é frágil para
nomes atípicos — mitigada pelo override explícito de `weightCol`. Validado em
`tests/inferenceCascade.test.js` (resolveWeightCol, aprovados ⊆ propostas, `inferenceWeightMode`).
