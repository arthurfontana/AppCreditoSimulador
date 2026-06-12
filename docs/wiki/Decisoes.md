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
