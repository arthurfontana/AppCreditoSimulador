# AppCreditoSimulador — Documento de Handoff para Desenvolvimento

**Versão:** 1.0  
**Data:** 12/06/2026  
**Status:** Protótipo funcional validado → pronto para desenvolvimento corporativo  

---

## Índice

1. [Visão Geral do Produto](#1-visão-geral-do-produto)
2. [Contexto de Negócio](#2-contexto-de-negócio)
3. [Histórias de Usuário](#3-histórias-de-usuário)
4. [Requisitos Funcionais](#4-requisitos-funcionais)
5. [Requisitos Não Funcionais](#5-requisitos-não-funcionais)
6. [Arquitetura Técnica Atual (Protótipo)](#6-arquitetura-técnica-atual-protótipo)
7. [Modelo de Dados](#7-modelo-de-dados)
8. [Motor de Simulação](#8-motor-de-simulação)
9. [Fluxos Funcionais Detalhados](#9-fluxos-funcionais-detalhados)
10. [Especificações de Interface](#10-especificações-de-interface)
11. [Glossário de Negócio](#11-glossário-de-negócio)
12. [Roadmap e Funcionalidades Futuras](#12-roadmap-e-funcionalidades-futuras)
13. [Recomendações para Produção](#13-recomendações-para-produção)

---

## 1. Visão Geral do Produto

O **AppCreditoSimulador** é uma ferramenta visual e interativa para modelagem e simulação de políticas de crédito. Permite que analistas de crédito e gestores de risco construam, de forma visual, fluxos de decisão sobre concessão de crédito — sem escrever código — e simulem o impacto dessas decisões sobre uma base histórica de propostas.

### O que o produto resolve

Equipes de crédito frequentemente precisam testar novas políticas de aprovação antes de implementá-las em produção. O processo tradicional envolve planilhas complexas, scripts ad hoc e longos ciclos de análise. O AppCreditoSimulador centraliza esse processo num canvas visual que conecta dados reais às decisões de política, exibindo em tempo real o impacto em volume de aprovações e indicadores de inadimplência.

### Quem usa

- **Analista de Crédito / Risco:** constrói e testa políticas de aprovação
- **Gestor de Produto de Crédito:** avalia trade-offs entre volume e inadimplência
- **Cientista de Dados:** valida hipóteses sobre segmentação de clientes
- **Área de Tecnologia (implantação):** recebe a política modelada e a replica no sistema de decisão em produção

### Formato atual

Protótipo funcional (React + Vite, arquivo único `src/App.jsx`). Totalmente operacional para uso em sessões de análise e validação de hipóteses. Não está preparado para implantação corporativa sem a refatoração descrita neste documento.

---

## 2. Contexto de Negócio

### 2.1 Fluxo de decisão de crédito

Numa operação de crédito, cada proposta percorre um conjunto de regras que determinam se será aprovada ou reprovada. Essas regras geralmente envolvem:

- **Filtros de elegibilidade:** "Score ≥ 600", "Renda ≥ R$ 2.000", "Inadimplência anterior = Não"
- **Segmentação cruzada:** "Clientes com Score entre 600–700 E Renda entre R$ 2k–5k → aprovados com limite X"
- **Políticas de oferta:** "Clientes do segmento A recebem oferta Premium; do segmento B, oferta Standard"

O sistema modela essas regras visualmente e simula seu impacto numa base histórica de propostas.

### 2.2 Métricas de negócio centrais

| Métrica | Definição | Importância |
|---|---|---|
| **Taxa de Aprovação** | `aprovados / total de propostas` | Volume de negócio gerado |
| **Inadimplência Real** | `∑ inad_real / ∑ altas aprovadas` | Perda financeira realizada |
| **Inadimplência Inferida** | `∑ inad_inferida / vol. aprovado` | Estimativa de perda futura |

O trade-off fundamental: aumentar a taxa de aprovação tende a aumentar a inadimplência. A ferramenta torna esse trade-off visível e quantificado.

### 2.3 Conceito de "Simulação Incremental sobre Comportamento Observado"

A base histórica carregada representa o que *já aconteceu* — quais propostas foram aprovadas/reprovadas no sistema de produção. A ferramenta permite simular: "se eu tivesse usado *esta nova política* naquele período, qual teria sido o resultado?"

Isso é diferente de uma simulação sobre população sintética: os dados são reais, e os resultados são diretamente comparáveis com o que ocorreu.

### 2.4 Variável AS IS

Toda base importada pode ter uma coluna de "decisão original" mapeada — chamada internamente de `__DECISAO_ORIGINAL`. Ela registra, linha a linha, se aquela proposta foi aprovada ou reprovada na política atual (AS IS). Isso permite calcular:

- Quantas propostas seriam *aprovadas a mais* pela nova política
- Quantas propostas *mudariam de decisão* (aprovadas → reprovadas e vice-versa)
- O impacto incremental líquido em volume e inadimplência

---

## 3. Histórias de Usuário

### Épico 1 — Importação e configuração de dados

**US-01** — Como analista de crédito, quero importar uma base CSV sumarizada de propostas para que eu possa usar os dados como base para a simulação.

**Critérios de aceitação:**
- Suportar arquivos `.csv` com separadores `,`, `;` e `\t`
- Detectar automaticamente o separador com indicação visual de confiança
- Detectar separador decimal (`,` ou `.`) com indicação visual
- Suportar arquivos com e sem linha de cabeçalho
- Exibir preview das 5 primeiras linhas antes de confirmar

**US-02** — Como analista, quero classificar as colunas do CSV (volume, inadimplência, variável de decisão, etc.) para que o sistema saiba como interpretar cada campo.

**Critérios de aceitação:**
- Interface de classificação coluna a coluna com os tipos: ID, Filtro, Vol. Propostas, Altas Reais, Conv. Inferida, Inad. Real, Inad. Inferida
- Sugestão automática de tipo baseada em nome e conteúdo da coluna
- Indicação de tipo de variável: `categorical` (nominal) ou `ordinal` (ordenada)
- Sugestão automática de tipo de variável (ex.: "Score R1–R20" → ordinal)

**US-03** — Como analista, quero mapear a coluna de decisão histórica (AS IS) para que o sistema possa comparar a nova política com o resultado real.

**Critérios de aceitação:**
- Seleção da coluna que contém a decisão original
- Mapeamento de cada valor distinto para: Aprovado / Reprovado / Ignorar
- Validação em tempo real: pelo menos um valor mapeado como Aprovado e um como Reprovado
- Possibilidade de editar o mapeamento depois da importação

**US-04** — Como analista, quero importar múltiplos CSVs para comparar bases de dados diferentes ou combinar segmentos distintos.

---

### Épico 2 — Modelagem visual da política

**US-05** — Como analista, quero criar nós de decisão no canvas arrastando variáveis do painel lateral, para que cada variável de filtro vire um passo de decisão no fluxo.

**Critérios de aceitação:**
- Arrastar variável do painel → cria losango de decisão no canvas
- Ports de saída automáticos, um por valor distinto da variável (máx. 10)
- Setas rotuladas com o valor de cada port
- Nó deletável (com cascata de ports e conexões)

**US-06** — Como analista, quero criar matrizes de decisão cruzada (Cineminha) para modelar regras que dependem de duas variáveis simultaneamente.

**Critérios de aceitação:**
- Criar nó Cineminha vazio no canvas
- Atribuir variável ao eixo de linhas e outra ao eixo de colunas via drag-and-drop
- Exibir grade de células clicáveis (cada uma = interseção linha × coluna)
- Clique alterna elegibilidade da célula (Elegível / Não Elegível)
- Modo 1D: apenas linha ou apenas coluna configurada

**US-07** — Como analista, quero criar filtros de população (Decision Lens) baseados em regras lógicas (AND/OR), para segmentar um subconjunto de propostas e aplicar uma política diferente a elas.

**Critérios de aceitação:**
- Suportar operadores: igual, diferente, está em lista, menor que, maior que, menor/igual, maior/igual
- Combinar múltiplas regras com AND/OR
- Exibir contador de propostas afetadas em tempo real
- Propagação do filtro para o motor de simulação

**US-08** — Como analista, quero conectar nós do canvas com setas para definir o fluxo de decisão, terminando em nós de Aprovado, Reprovado ou AS IS.

**Critérios de aceitação:**
- Ferramenta de conexão: clicar em nó origem → clicar em nó destino
- Labels editáveis nas setas (duplo-clique)
- Validação de ciclos (impedimento de loops infinitos)
- Feedback visual de erro para fluxos incompletos

---

### Épico 3 — Simulação e análise

**US-09** — Como analista, quero que o resultado da simulação seja calculado automaticamente a cada mudança no fluxo, para ter feedback em tempo real.

**Critérios de aceitação:**
- Recalculo automático com debounce de 300ms
- Exibir: Taxa de Aprovação, Inad. Real, Inad. Inferida
- Contadores: total, aprovados, reprovados
- Resultados simultâneos: novo modelo vs. AS IS

**US-10** — Como analista, quero ver as métricas de cada conexão do fluxo (volume, inadimplência) para entender a distribuição das propostas em cada etapa.

**Critérios de aceitação:**
- Label nas setas mostrando volume e/ou inadimplência
- Espessura da seta proporcional ao volume (toggle on/off)
- Cor da seta indicando nível de inadimplência (gradiente verde→vermelho)
- Tooltip ao passar o mouse com métricas completas

**US-11** — Como analista, quero otimizar automaticamente as células de uma matriz Cineminha para encontrar a melhor configuração de aprovação dado um target de inadimplência.

**Critérios de aceitação:**
- Modal de otimização ativado por botão na barra de contexto do nó
- Fronteira Pareto entre taxa de aprovação e inadimplência inferida
- Três cenários pré-computados: Conservador, Melhor Eficiência, Máxima Aprovação
- Sliders interativos de aprovação e inadimplência
- Preview das células propostas sem aplicar ao canvas
- Botão "Aplicar" confirma a configuração

---

### Épico 4 — Persistência e colaboração

**US-12** — Como analista, quero exportar o fluxo modelado para um arquivo JSON para compartilhar ou salvar a configuração.

**US-13** — Como analista, quero importar um fluxo previamente exportado para continuar o trabalho ou revisar uma política anterior.

**US-14** — Como analista, quero salvar configurações de Cineminha em uma biblioteca local para reutilizá-las em outros projetos.

**Critérios de aceitação:**
- Biblioteca com nome, descrição, tags e metadados
- Export individual (JSON) e em lote (CSV com todas as configurações)
- Import com mapeamento de variáveis (caso os nomes de coluna sejam diferentes)

**US-15** — Como analista, quero exportar um CSV de diagnóstico com a taxa de aprovação e métricas de inadimplência por etapa do fluxo, para documentar e auditoria.

---

### Épico 5 — Experiência no canvas

**US-16** — Como analista, quero navegar no canvas com pan e zoom para trabalhar com fluxos complexos.

**Critérios de aceitação:**
- Pan: arrastar com mão ou botão do meio do mouse
- Zoom: scroll do mouse (0.1× a 5×)
- Suporte a pinch-zoom em dispositivos touch
- Tecla de atalho para resetar viewport

**US-17** — Como analista, quero desfazer e refazer ações no canvas.

**Critérios de aceitação:**
- Ctrl+Z / Cmd+Z para desfazer
- Ctrl+Y / Cmd+Y ou Ctrl+Shift+Z para refazer
- Histórico de 50 estados

**US-18** — Como analista, quero selecionar múltiplos nós e movê-los juntos, deletá-los em lote ou alinhá-los.

**Critérios de aceitação:**
- Ctrl+click para seleção individual múltipla
- Retângulo de seleção arrastando no canvas
- Mover todos os selecionados juntos
- Deletar todos os selecionados com Delete/Backspace
- Ferramentas de alinhamento: esquerda, centro, direita, topo, meio, base

---

## 4. Requisitos Funcionais

### RF-01 — Importação de CSV

| ID | Descrição |
|---|---|
| RF-01.1 | O sistema deve aceitar arquivos `.csv` com separadores `,`, `;` e `\t` |
| RF-01.2 | O sistema deve detectar automaticamente o separador mais provável e indicar o nível de confiança |
| RF-01.3 | O sistema deve detectar o separador decimal (`.` ou `,`) e normalizar os valores numéricos |
| RF-01.4 | O sistema deve suportar arquivos com e sem linha de cabeçalho |
| RF-01.5 | O sistema deve exibir preview das 5 primeiras linhas parseadas antes da confirmação |
| RF-01.6 | O sistema deve permitir importação de múltiplos CSVs e identificá-los individualmente |
| RF-01.7 | Ao editar um CSV já importado, o sistema deve preservar o mapeamento de variáveis em nós existentes |
| RF-01.8 | O sistema deve sugerir automaticamente os tipos de coluna com base em nome e conteúdo |
| RF-01.9 | O sistema deve sugerir `ordinal` ou `categorical` por variável com base em heurísticas |

### RF-02 — Configuração AS IS

| ID | Descrição |
|---|---|
| RF-02.1 | O sistema deve permitir mapear uma coluna do CSV para representar a decisão histórica |
| RF-02.2 | O mapeamento deve associar cada valor distinto a: Aprovado, Reprovado ou Ignorar |
| RF-02.3 | O sistema deve validar que pelo menos um valor está mapeado como Aprovado e um como Reprovado |
| RF-02.4 | O sistema deve derivar a coluna `__DECISAO_ORIGINAL` com valores `APROVADO` / `REPROVADO` / `` (vazio) |
| RF-02.5 | O mapeamento deve ser editável após a importação |

### RF-03 — Canvas e Nós

| ID | Descrição |
|---|---|
| RF-03.1 | O canvas deve suportar pan, zoom e scroll |
| RF-03.2 | O sistema deve permitir criar nós de decisão (losango) arrastando variáveis do painel |
| RF-03.3 | Nós de decisão devem gerar ports automáticos para cada valor distinto (máx. 10) |
| RF-03.4 | O sistema deve suportar nós do tipo: CSV, Decisão, Cineminha, Decision Lens, Aprovado, Reprovado, AS IS, Frame, Painel de Simulação |
| RF-03.5 | Nós devem ser movíveis, redimensionáveis (onde aplicável) e deletáveis |
| RF-03.6 | A deleção de um nó de decisão ou Cineminha deve excluir em cascata seus ports filhos e conexões |
| RF-03.7 | O canvas deve suportar undo/redo (50 estados) via Ctrl+Z / Ctrl+Y |
| RF-03.8 | O canvas deve suportar seleção múltipla (Ctrl+click e retângulo de seleção) |
| RF-03.9 | O sistema deve suportar frames visuais para agrupamento não-funcional de nós |
| RF-03.10 | O sistema deve suportar rótulo editável em cada nó |

### RF-04 — Conexões

| ID | Descrição |
|---|---|
| RF-04.1 | O usuário deve poder conectar dois nós com uma seta direcional |
| RF-04.2 | Setas devem ter label editável (duplo-clique na seta) |
| RF-04.3 | O sistema deve impedir a criação de conexões que formem ciclos |
| RF-04.4 | Setas devem exibir volume de propostas e métricas de inadimplência por segmento |
| RF-04.5 | A espessura das setas deve ser ajustável proporcionalmente ao volume (funcionalidade toggle) |
| RF-04.6 | A cor das setas deve refletir o nível de inadimplência (gradiente verde→vermelho) |

### RF-05 — Cineminha (Matriz de Decisão Cruzada)

| ID | Descrição |
|---|---|
| RF-05.1 | O usuário deve poder criar um nó Cineminha vazio e atribuir variáveis aos eixos linha e coluna |
| RF-05.2 | Cada célula da matriz representa a interseção de um valor de linha e um valor de coluna |
| RF-05.3 | O clique numa célula deve alternar seu estado entre Elegível e Não Elegível |
| RF-05.4 | O Cineminha deve suportar modo 1D (apenas linha ou apenas coluna configurada) |
| RF-05.5 | O Cineminha deve ter dois ports de saída: "Elegível" e "Não Elegível" (ou equivalentes por tipo) |
| RF-05.6 | O sistema deve suportar tipos de Cineminha: Elegibilidade e Oferta |
| RF-05.7 | O Cineminha deve exibir métricas por célula (volume, inadimplência) |
| RF-05.8 | O Cineminha deve suportar preenchimento automático de células a partir de coluna de resultado |
| RF-05.9 | Configurações de Cineminha devem ser salváveis numa biblioteca local |

### RF-06 — Decision Lens

| ID | Descrição |
|---|---|
| RF-06.1 | O usuário deve poder criar regras de filtro sobre colunas do CSV |
| RF-06.2 | Operadores suportados: igual, diferente, está em lista, não está em lista, menor que, menor ou igual, maior que, maior ou igual |
| RF-06.3 | Regras devem ser combináveis com AND/OR |
| RF-06.4 | O sistema deve exibir o número de propostas afetadas pelas regras em tempo real |
| RF-06.5 | O Decision Lens deve se conectar ao fluxo e sobrescrever a decisão das linhas afetadas |

### RF-07 — Simulação

| ID | Descrição |
|---|---|
| RF-07.1 | O motor de simulação deve percorrer o fluxo linha a linha sobre a base histórica |
| RF-07.2 | A simulação deve ser recalculada automaticamente a cada mudança no fluxo (debounce 300ms) |
| RF-07.3 | O resultado deve incluir: total, aprovados, reprovados, taxa de aprovação, Inad. Real, Inad. Inferida |
| RF-07.4 | O sistema deve calcular estatísticas por aresta (conexão) do fluxo |
| RF-07.5 | O sistema deve comparar os resultados da nova política com os resultados AS IS |
| RF-07.6 | O cálculo pesado deve ser executado em thread separada (Web Worker ou equivalente backend) |
| RF-07.7 | O sistema deve validar o fluxo antes de simular e indicar erros por nó |

### RF-08 — Otimização do Cineminha

| ID | Descrição |
|---|---|
| RF-08.1 | O sistema deve calcular a fronteira Pareto de configurações de células para um Cineminha |
| RF-08.2 | Deve apresentar três cenários pré-definidos: Conservador, Melhor Eficiência (joelho), Máxima Aprovação |
| RF-08.3 | Sliders de aprovação e inadimplência devem ser interligados e refletir pontos da fronteira |
| RF-08.4 | O usuário deve poder editar manualmente as células propostas antes de aplicar |
| RF-08.5 | A aplicação deve ser não-destrutiva — sem alterar o canvas até confirmação |

### RF-09 — Exportação e Importação

| ID | Descrição |
|---|---|
| RF-09.1 | O sistema deve exportar o fluxo completo (shapes + conexões) em formato JSON |
| RF-09.2 | O sistema deve importar um fluxo JSON exportado previamente |
| RF-09.3 | O sistema deve exportar um CSV de diagnóstico com métricas por etapa do fluxo |
| RF-09.4 | A biblioteca de Cineminha deve ser exportável/importável em JSON e em CSV |

---

## 5. Requisitos Não Funcionais

### RNF-01 — Desempenho

| ID | Descrição | Meta |
|---|---|---|
| RNF-01.1 | Tempo de resposta da simulação após mudança no fluxo | ≤ 1s para bases até 1M linhas |
| RNF-01.2 | Renderização do canvas (60fps) durante pan e zoom | ≤ 16ms por frame |
| RNF-01.3 | Importação de CSV até 50MB | ≤ 10s |
| RNF-01.4 | Cálculo da fronteira Pareto para Cineminha 10×10 | ≤ 5s |
| RNF-01.5 | Nenhum bloqueio da thread principal durante simulação | Processamento em thread separada |

### RNF-02 — Segurança

| ID | Descrição |
|---|---|
| RNF-02.1 | Autenticação obrigatória para acesso à ferramenta (SSO corporativo recomendado) |
| RNF-02.2 | Os dados CSV não devem trafegar para servidores externos — processamento exclusivamente client-side ou em backend privado |
| RNF-02.3 | Fluxos exportados em JSON não devem conter dados pessoais das linhas do CSV |
| RNF-02.4 | Todos os inputs de texto do usuário devem ter sanitização antes de renderização (prevenção de XSS) |
| RNF-02.5 | Em ambiente corporativo, logs de acesso e auditoria devem ser mantidos por 90 dias |

### RNF-03 — Confiabilidade

| ID | Descrição |
|---|---|
| RNF-03.1 | Disponibilidade mínima do serviço: 99,5% em horário comercial |
| RNF-03.2 | Auto-salvamento periódico do estado do canvas (a cada 60s) |
| RNF-03.3 | Recuperação de sessão após fechamento acidental do navegador |
| RNF-03.4 | Tratamento de erros de parsing de CSV com mensagens claras ao usuário |

### RNF-04 — Compatibilidade

| ID | Descrição |
|---|---|
| RNF-04.1 | Suporte a Chrome 110+, Edge 110+, Firefox 115+, Safari 16+ |
| RNF-04.2 | Resolução mínima: 1366×768 |
| RNF-04.3 | Suporte básico a dispositivos touch (tablets) para navegação no canvas |
| RNF-04.4 | Não requer plugin ou instalação local |

### RNF-05 — Manutenibilidade

| ID | Descrição |
|---|---|
| RNF-05.1 | Cobertura de testes unitários ≥ 80% no motor de simulação |
| RNF-05.2 | Cobertura de testes de integração nos fluxos críticos (import → configuração → simulação) |
| RNF-05.3 | Código organizado em módulos independentes (ver seção de arquitetura recomendada) |
| RNF-05.4 | Documentação de API interna (JSDoc ou equivalente) |
| RNF-05.5 | Build reproduzível e versionado via CI/CD |

### RNF-06 — Escalabilidade

| ID | Descrição |
|---|---|
| RNF-06.1 | A ferramenta deve suportar bases de até 5 milhões de linhas (com sumarização adequada) |
| RNF-06.2 | A simulação deve ser paralelizável para múltiplos CSVs carregados simultaneamente |
| RNF-06.3 | O canvas deve suportar fluxos com até 100 nós sem degradação visual |

### RNF-07 — Acessibilidade

| ID | Descrição |
|---|---|
| RNF-07.1 | Conformidade com WCAG 2.1 nível AA para componentes de formulário e modais |
| RNF-07.2 | Contraste mínimo 4.5:1 para textos sobre fundos coloridos |
| RNF-07.3 | Navegação por teclado nos wizards de importação |

---

## 6. Arquitetura Técnica Atual (Protótipo)

### 6.1 Stack do protótipo

```
Frontend: React 18.2 + Vite 5.0
Linguagem: JavaScript (JSX, ES2020+)
Estilo: Inline styles (sem CSS framework)
Renderização do canvas: SVG nativo (não Canvas API)
Processamento paralelo: Web Worker (simulation.worker.js)
Dependências externas: nenhuma (apenas React + ReactDOM)
```

### 6.2 Estrutura de arquivos atual

```
AppCreditoSimulador/
├── src/
│   ├── App.jsx                   # Componente único — ~3.400 linhas
│   ├── simulation.worker.js      # Web Worker para simulação pesada
│   └── main.jsx                  # Entry point React
├── public/
├── vite.config.js                # Build config + injeção de metadados de build
├── package.json
└── index.html
```

### 6.3 Problemas do protótipo para produção

| Problema | Impacto | Solução recomendada |
|---|---|---|
| Arquivo único de 3.400 linhas | Manutenção difícil, conflitos em equipe | Separar em módulos (ver seção 13) |
| Sem persistência de estado | Usuário perde trabalho ao fechar | Adicionar backend ou localStorage |
| Sem autenticação | Acesso irrestrito | SSO corporativo |
| Sem testes automatizados | Regressões difíceis de detectar | Vitest + React Testing Library |
| CSV processado inteiramente no browser | Limite de memória do browser | Processamento server-side para bases grandes |
| Sem auditoria | Sem rastreabilidade de mudanças | Log de ações no backend |

---

## 7. Modelo de Dados

### 7.1 Shape (Nó do Canvas)

```typescript
type ShapeType = 
  | "csv"            // nó de dados
  | "decision"       // losango de decisão
  | "port"           // saída de um nó de decisão ou cineminha
  | "cineminha"      // matriz de decisão cruzada
  | "decision_lens"  // filtro de população
  | "approved"       // terminal: aprovado
  | "rejected"       // terminal: reprovado
  | "as_is"          // terminal: manter decisão original
  | "simPanel"       // painel de métricas
  | "frame"          // agrupamento visual
  | "rect" | "circle" | "diamond";  // formas livres

interface Shape {
  id: string;              // identificador único (ex: "e123")
  type: ShapeType;
  x: number;               // posição X no canvas (coordenadas mundo)
  y: number;               // posição Y no canvas
  w: number;               // largura
  h: number;               // altura
  label: string;           // rótulo exibido
  color?: string;          // cor customizada (hex)
  parentId?: string;       // para ports: ID do nó pai

  // Campos específicos por tipo:

  // type: "decision"
  variableCol?: string;    // nome da coluna de decisão
  csvId?: string;          // ID do csvStore associado

  // type: "cineminha"
  cinemaType?: "eligibility" | "offer";
  rowVar?: { col: string; csvId: string } | null;
  colVar?: { col: string; csvId: string } | null;
  rowDomain?: string[];
  colDomain?: string[];
  cells?: Record<string, boolean>;  // key: "rowVal|colVal"
  resultVar?: { col: string; csvId: string } | null;
  metadata?: CinemaMetadata;

  // type: "decision_lens"
  rules?: LensRule[];

  // type: "csv"
  minimized?: boolean;

  // type: "port"
  portLabel?: string;      // valor do port (ex: "600-700")
}
```

### 7.2 Connection (Aresta)

```typescript
interface Connection {
  id: string;
  from: string;       // ID do nó de origem
  to: string;         // ID do nó de destino
  label?: string;     // rótulo editável
}
```

### 7.3 CSV Store

```typescript
interface CsvEntry {
  name: string;            // nome do arquivo
  headers: string[];       // nomes das colunas (última pode ser __DECISAO_ORIGINAL)
  rows: string[][];        // dados brutos (strings)
  columnTypes: Record<string, ColType>;
  varTypes: Record<string, VarType>;
  asIsConfig: AsIsConfig | null;
}

type ColType = "id" | "decision" | "qty" | "qtdAltas" | "qtdAltasInfer" | "inadReal" | "inadInferida";
type VarType = "categorical" | "ordinal";

interface AsIsConfig {
  col: string;                                      // coluna original no CSV
  mapping: Record<string, "APROVADO" | "REPROVADO" | "IGNORAR">;
}

type CsvStore = Record<string, CsvEntry>;  // chave: csvId único
```

### 7.4 Lens Rule

```typescript
type LensOperator = "equal" | "notEqual" | "in" | "notIn" | "lt" | "lte" | "gt" | "gte";
type LensLogic = "AND" | "OR";

interface LensRule {
  col: string;
  operator: LensOperator;
  value: string;           // valor único ou JSON array para "in"/"notIn"
  logic: LensLogic;        // combinator com a próxima regra
}
```

### 7.5 Simulation Result

```typescript
interface SimulationResult {
  totalQty: number;
  approvedQty: number;
  rejectedQty: number;
  asIsQty: number;             // propostas com decisão = AS IS (manter original)
  approvalRate: number;        // 0–100
  inadReal: number | null;     // ratio ou null se denominador zero
  inadInferida: number | null;
  edgeStats: Record<string, EdgeStats>;  // por ID de conexão
}

interface EdgeStats {
  qty: number;
  approvedQty: number;
  rejectedQty: number;
  asIsQty: number;
  approvalRate: number;
  inadReal: number | null;
  inadInferida: number | null;
}
```

### 7.6 Wizard State (Importação)

```typescript
interface WizardState {
  rawText: string;
  filename: string;
  delimiter: string;
  detected: string;
  confident: boolean;
  hasHeader: boolean;
  step: 1 | 2 | 3;
  columnTypes: Record<string, ColType>;
  varTypes: Record<string, VarType>;
  asIsVar: string | null;
  asIsMapping: Record<string, "APROVADO" | "REPROVADO" | "IGNORAR">;
  editCsvId: string | null;
  decimalSep: "." | ",";
  decimalSepConfident: boolean;
}
```

### 7.7 Optim Modal State

```typescript
interface OptimModalState {
  shapeId: string;
  cellMetrics: Record<string, CellMetric>;
  frontier: ParetoPoint[];
  scenarios: {
    conservador: ParetoPoint;
    medio: ParetoPoint;
    maximo: ParetoPoint;
  };
  activeCard: "conservador" | "medio" | "maximo" | "personalizado";
  proposedCells: Record<string, boolean>;
  sliderApproval: number;    // 0–1
  sliderInadReal: number;    // 0–1
  sliderInadInf: number;     // 0–1
  maxInadReal: number;
  maxInadInf: number;
}

interface CellMetric {
  qty: number;
  qtdAltas: number;
  inadRRaw: number;    // soma absoluta de inadReal
  inadIRaw: number;    // soma absoluta de inadInferida
  inadReal: number | null;
  inadInferida: number | null;
}

interface ParetoPoint {
  cells: Record<string, boolean>;
  approvalRate: number;
  inadReal: number | null;
  inadInferida: number | null;
  totalQty: number;
  approvedQty: number;
}
```

### 7.8 Cineminha Metadata

```typescript
interface CinemaMetadata {
  type: string;             // identificador de tipo de produto/política
  identifiers: string[];    // tags de identificação
  dimensions: string[];     // dimensões (ex: ["score", "renda"])
  variables: string[];      // variáveis usadas
  description?: string;
  version?: string;
  createdAt?: string;
}
```

---

## 8. Motor de Simulação

### 8.1 Visão Geral

O motor percorre cada linha do CSV sobre o grafo de fluxo e acumula métricas. Ele roda em thread separada (Web Worker no protótipo) e é acionado por mensagem após debounce de 300ms.

### 8.2 Estrutura do Grafo

```
Construção do grafo (buildFlowGraph):
- adj[from] = [to1, to2, ...]   (saídas)
- radj[to] = [from1, from2, ...] (entradas)
```

### 8.3 Algoritmo de Simulação

```
Para cada linha do CSV:
  1. Encontrar nó(s) raiz — nós sem entrada que não são ports
  2. traverseRow(row, nodeId):
     a. Se nó = "approved" → acumular como aprovado
     b. Se nó = "rejected" → acumular como reprovado
     c. Se nó = "as_is"    → olhar __DECISAO_ORIGINAL da linha
     d. Se nó = "decision" → ler valor da coluna variableCol na linha
                              → rotear para o port correspondente
                              → traverseRow(row, portId)
     e. Se nó = "cineminha" → ler valores de rowVar e colVar na linha
                               → montar key "rowVal|colVal"
                               → se isCellEligible(cells, key) → port "Elegível"
                               → senão → port "Não Elegível"
                               → traverseRow(row, portId)
     f. Se nó = "port"      → seguir aresta de saída
                              → traverseRow(row, nextNodeId)
     g. Se nó = "decision_lens" → verificar se linha passa pelas regras
                                  → se sim → seguir saída "matched"
                                  → senão  → seguir saída "unmatched"
  3. Acumular por aresta: qty, qtdAltas, inadRRaw, inadIRaw
```

### 8.4 Cálculo de Métricas Finais

```
inadReal      = ∑ inadRRaw / ∑ qtdAltas      (null se qtdAltas = 0)
inadInferida  = ∑ inadIRaw / approvedQty      (null se approvedQty = 0)
approvalRate  = approvedQty / totalQty * 100
```

### 8.5 Validação do Fluxo

Antes de simular, o sistema valida:
1. **Ciclos:** DFS buscando back-edges → erro por nó envolvido
2. **Caminhos não terminados:** nós com saídas desconectadas → aviso
3. **Nós sem dados:** decision/cineminha sem csvId atribuído → erro

### 8.6 Overlay de Decisão (Decision Lens)

O overlay representa a sobreposição da nova política sobre a base histórica:
1. Para cada Decision Lens no fluxo, identificar quais linhas do CSV ele afeta
2. Para essas linhas, substituir a decisão de base pelo resultado do fluxo simulado
3. Calcular o resultado incremental: delta de volume, delta de inadimplência vs. AS IS

### 8.7 Algoritmo Pareto (Otimização do Cineminha)

```
1. computeCellMetrics: para cada (rowVal, colVal), filtrar linhas do CSV e agregar
2. buildParetoFrontier:
   a. Ordenar células por inadInferida crescente (nulls ao final)
   b. Varrer em ordem, adicionando células ao conjunto "aprovado"
   c. A cada passo, calcular (approvalRate, inadInferida, inadReal) acumulados
   d. Produzir fronteira greedy ótima para variáveis categóricas
3. extractScenarios:
   a. Conservador = primeiro ponto da fronteira (menor inad)
   b. Máximo = último ponto (maior aprovação)
   c. Médio = ponto de máxima distância perpendicular à reta conservador–máximo (joelho)
```

---

## 9. Fluxos Funcionais Detalhados

### 9.1 Fluxo de Importação de CSV

```
Usuário clica "Importar CSV"
  ↓
Abre seletor de arquivo
  ↓
Lê texto bruto do arquivo
  ↓
detectDelimiter() → heurística de separador (conte ocorrências por linha)
detectDecimalSep() → heurística de separador decimal
  ↓
Abre Wizard Passo 1:
  - Exibe separador detectado + badge "detectado automaticamente" ou "verifique abaixo"
  - Exibe separador decimal detectado
  - Preview das 5 primeiras linhas parseadas
  - Toggle "Tem cabeçalho?"
  - Usuário pode ajustar separador manualmente
  ↓
[Confirmar Passo 1]
  ↓
Wizard Passo 2:
  - Lista todas as colunas parseadas
  - Para cada coluna: dropdown de tipo (ID / Filtro / Vol. Propostas / ...)
  - Para cada coluna: dropdown de tipo de var (Categórica / Ordinal)
  - Sugestão automática preenchida — usuário pode ajustar
  ↓
[Confirmar Passo 2]
  ↓
Wizard Passo 3:
  - Seletor da coluna de decisão histórica (AS IS)
  - Para cada valor distinto: dropdown Aprovado / Reprovado / Ignorar
  - Validação em tempo real: aprovado ✓, reprovado ✓, todos mapeados ✓
  - Opção "Pular" (sem AS IS)
  ↓
[Confirmar Passo 3]
  ↓
onImportConfirm():
  - parseCSV() → normalizeDecimalSep()
  - Derivar coluna __DECISAO_ORIGINAL
  - setCsvStore: salvar entrada
  - Criar nó CSV no canvas
  - Reconciliar nós existentes que usavam CSV anterior
  ↓
Motor de simulação é acionado (debounce 300ms)
```

### 9.2 Fluxo de Criação de Política

```
Painel direito exibe variáveis classificadas como "Filtro"
  ↓
Usuário arrasta variável para o canvas:
  CASO A: Solta sobre área vazia
    → createDecisionNode(col, csvId, x, y)
    → Cria losango + N ports (um por valor distinto, máx. 10)
    → Cria conexões losango → ports

  CASO B: Solta sobre nó Cineminha vazio
    → Abre modal "Eixo de linha ou coluna?"
    → assignCinemaVar(shapeId, col, csvId, 'row' | 'col')
    → Recomputa domínio e reconstrói grade de células
  ↓
Usuário conecta ports a outros nós ou a Aprovado/Reprovado/AS IS
  ↓
Sistema valida fluxo (DFS) → exibe erros nos nós
  ↓
Se fluxo válido → roda simulação → exibe resultados
```

### 9.3 Fluxo de Otimização do Cineminha

```
Usuário seleciona nó Cineminha
  ↓
Toolbar contextual exibe "⚙ Otimizar Decisão"
  ↓
Usuário clica no botão → openOptimModal(shapeId)
  ↓
Sistema envia COMPUTE_OPTIM ao Web Worker:
  1. computeCellMetrics: agrega métricas por célula
  2. buildParetoFrontier: fronteira greedy Pareto
  3. extractScenarios: conservador, médio, máximo
  ↓
Modal exibe:
  - Gráfico da fronteira Pareto
  - 3 cards de cenário (+ "Personalizado" + "Política Completa")
  - Sliders: Aprovação ↔ Inad. Real ↔ Inad. Inferida (interligados)
  - Grade de células do Cineminha com estado proposto
  ↓
Usuário ajusta via card ou sliders:
  - Slider Aprovação: busca ponto da fronteira com |approvalRate - target| mínimo
  - Slider Inad.: busca maior approvalRate com inad ≤ target
  - Card fixo: carrega células pré-definidas do cenário
  - Clique manual em célula: ativa card "Personalizado"
  ↓
[Aplicar]
  → applyOptimResult(shapeId, proposedCells)
  → setShapes: sobrescreve cells do Cineminha
  → fecha modal
  ↓
Motor de simulação recalcula automaticamente
```

---

## 10. Especificações de Interface

### 10.1 Layout Geral

```
┌──────────────────────────────────────────────────────────────────┐
│ Header: Logo | BuildBadge                                        │
├─────────────┬────────────────────────────────────┬──────────────┤
│ Toolbar     │                                    │ Painel       │
│ vertical    │  Canvas SVG                        │ direito      │
│ (ícones de  │  (pan + zoom)                      │ - Indicadores│
│  ferramen-  │  · Shapes                          │   de simulação│
│  tas)       │  · Conexões                        │ - Variáveis  │
│             │  · Seleção                         │   (chips     │
│             │                                    │   arrastáveis)│
│             │                                    │ - DataSets   │
└─────────────┴────────────────────────────────────┴──────────────┘
```

### 10.2 Ferramentas do Canvas

| Ferramenta | Ícone | Comportamento |
|---|---|---|
| Mão (Hand) | ✋ | Pan do canvas; drag de shapes |
| Selecionar | ↖ | Seleção individual e retangular |
| Frame | ⬚ | Criar agrupamento visual |
| Retângulo | ▭ | Criar forma livre retangular |
| Cineminha | ⊞ | Criar matriz de decisão cruzada |
| Decision Lens | 🔎 | Criar filtro de população |
| Conectar | ⟶ | Criar conexão entre nós |
| Aprovado | ✅ | Criar terminal de aprovação |
| Reprovado | ❌ | Criar terminal de reprovação |
| AS IS | ⟳ | Criar terminal de decisão original |

### 10.3 Tipos de Coluna no Wizard

| Tipo | Ícone | Uso no motor |
|---|---|---|
| ID | 🔑 | Identificador — ignorado na simulação |
| Filtro | 🔀 | Variável de decisão — aparece como chip arrastável |
| Vol. Propostas | 📊 | `qty` — denominador da taxa de aprovação |
| Altas Reais | 📈 | `qtdAltas` — denominador da Inad. Real |
| Conv. Inferida | 🔮 | `qtdAltasInfer` — conversão estimada |
| Inad. Real | ⚠️ | `inadReal` — componente da Inad. Real |
| Inad. Inferida | 🎯 | `inadInferida` — componente da Inad. Inferida |

### 10.4 Escala de Cores

**Setas (inadimplência inferida por aresta):**
- 0% → verde `#16a34a`
- 5% → amarelo-laranja `#d97706`
- 10%+ → vermelho `#dc2626`

**Células do Cineminha:**
- Elegível → fundo branco / verde suave
- Não Elegível → fundo cinza `#f5f5f5` / texto riscado

**Indicadores de simulação:**
- Inad. Real e Inferida > 5% → vermelho
- ≤ 5% → laranja
- N/A → cinza

### 10.5 Constantes Visuais do Cineminha

| Constante | Valor | Descrição |
|---|---|---|
| `CINEMA_CELL_W` | 70px | Largura de cada célula |
| `CINEMA_CELL_H` | 30px | Altura de cada célula |
| `CINEMA_TITLE_H` | 38px | Barra de título (drag handle) |
| `CINEMA_HDR_H` | 32px | Cabeçalho de colunas (modo 2D) |
| `CINEMA_LBL_W` | 84px | Coluna de rótulos de linha |
| `CINEMA_MAX_W` | 540px | Largura máxima |
| `CINEMA_MAX_H` | 420px | Altura máxima |

### 10.6 Wizard de Importação — Passo a Passo

**Passo 1 — Delimitador** (modal 600px)
- Preview das 5 primeiras linhas parseadas
- Badge de confiança do separador detectado
- Radio de separadores: `,` `;` `\t` `|` personalizado
- Badge de confiança do decimal detectado
- Toggle "Tem cabeçalho?"

**Passo 2 — Classificar colunas** (modal 900px)
- Grid 8 colunas: nome da coluna + 7 tipos + tipo de variável
- Header sticky
- Lista com scroll (máx. 340px de altura)
- Seletor de varType: `categórica` | `ordinal`

**Passo 3 — AS IS** (modal 680px)
- Dropdown de coluna de decisão original
- Para cada valor distinto: dropdown APROVADO / REPROVADO / IGNORAR
- Barra de validação com 3 indicadores (✓/✗)
- Botão "Pular" para ignorar etapa

---

## 11. Glossário de Negócio

| Termo | Definição |
|---|---|
| **Base Sumarizada** | CSV onde cada linha representa um *agrupamento* de propostas, não uma proposta individual. Ex: "score 600–700 + renda 2k–5k → 1.200 propostas" |
| **Taxa de Aprovação** | Percentual de propostas aprovadas em relação ao total |
| **Inad. Real** | Inadimplência histórica observada — calculada sobre propostas efetivamente ativadas |
| **Inad. Inferida** | Inadimplência estimada para clientes aprovados (mesmo os que não foram ativados) |
| **AS IS** | Configuração atual da política — o que está em produção hoje |
| **Cineminha** | Matriz de elegibilidade cruzando dois atributos do cliente (ex: Score × Renda) |
| **Decision Lens** | Filtro de sub-população baseado em regras lógicas |
| **Fronteira Pareto** | Conjunto de configurações não-dominadas: não é possível melhorar aprovação sem piorar inadimplência |
| **Port** | Saída de um nó de decisão, rotulada com o valor que direciona o fluxo para ela |
| **Altas / Conversão** | Propostas aprovadas que efetivamente resultaram em produto contratado/ativado |
| **Simulação incremental** | Comparação entre a nova política e o AS IS, isolando o delta de impacto |
| **Variável ordinal** | Variável com valores ordenados (ex: Score R1 < R2 < ... < R20) |
| **Variável categórica** | Variável sem ordem intrínseca (ex: UF, Canal de Venda) |

---

## 12. Roadmap e Funcionalidades Futuras

As funcionalidades abaixo estão projetadas e parcialmente especificadas no protótipo, mas ainda não implementadas:

### 12.1 Restrição de Monotonicidade no Cineminha (Variáveis Ordinais)

Quando o eixo usa uma variável ordinal (ex: Rating R1–R20), a configuração de células deve respeitar a regra do "Young diagram": se o score R10 é aprovado, todos os scores acima dele também devem ser. O algoritmo Pareto deve incluir essa restrição de corte monotônico.

### 12.2 Decision Lens — Modo Incrementa

Hoje o Decision Lens sobrescreve toda a população afetada. O modo incremental deve comparar o resultado para propostas que *mudaram* de decisão (antes: reprovado → depois: aprovado) vs. aquelas que permaneceram iguais.

### 12.3 Sliders Adicionais na Otimização

- Margem mínima por célula
- Rentabilidade ajustada ao risco (RAR)
- Restrição de volume mínimo por segmento

### 12.4 Fronteira Pareto Multidimensional

Hoje a fronteira Pareto é bivariada (aprovação × inad. inferida). A versão futura deve suportar 3 dimensões: aprovação × inad. real × inad. inferida.

### 12.5 Decision Lens — Comparação AS IS vs. Simulado

Comparação visual linha a linha das decisões: quantas propostas mudariam de resultado com a nova política, e qual o perfil dessas propostas.

### 12.6 Integração com Sistema de Regras em Produção

Exportar a política modelada num formato estruturado (JSON canônico ou PMML) que possa ser importado diretamente pelo motor de decisão em produção, eliminando a necessidade de reescrever as regras manualmente.

---

## 13. Recomendações para Produção

### 13.1 Arquitetura recomendada

```
Frontend (SPA)
  ├── /canvas        — Editor visual (pan/zoom/shapes/conns)
  ├── /simulation    — Motor de simulação + resultados
  ├── /csv-import    — Wizard de importação
  ├── /cineminha     — Componentes da matriz + otimização
  ├── /lens          — Decision Lens
  └── /shared        — Utilitários, formatação, tipos

Backend (API REST ou GraphQL)
  ├── POST /simulations      — Executar simulação (offload do browser)
  ├── POST /csv/upload       — Upload e parsing de CSV
  ├── GET/PUT /flows/{id}    — CRUD de fluxos
  ├── GET/PUT /library       — Biblioteca de Cineminha
  └── GET /auth              — Autenticação SSO

Banco de Dados
  ├── Fluxos (shapes + conns)  — PostgreSQL ou DynamoDB
  ├── CSV metadata             — S3 ou equivalente (dados brutos)
  └── Biblioteca de Cineminha  — PostgreSQL
```

### 13.2 Separação recomendada de módulos (Frontend)

| Módulo | Responsabilidade |
|---|---|
| `canvas/` | SVG rendering, pan/zoom, drag & drop, seleção |
| `shapes/` | Componentes por tipo de nó (decisão, cineminha, lens, etc.) |
| `wizard/` | Fluxo de importação CSV (3 passos) |
| `simulation/` | Motor de simulação + Web Worker + agregação de métricas |
| `optimization/` | Pareto frontier, extração de cenários, modal de otimização |
| `store/` | Estado global (Zustand, Redux Toolkit ou Context) |
| `api/` | Clientes HTTP para backend |
| `types/` | Interfaces TypeScript |
| `utils/` | fmtQty, fmtPct, sortDomain, detectDelimiter, etc. |

### 13.3 Migração de JavaScript para TypeScript

O protótipo está em JavaScript puro. Para produção, recomenda-se migrar para TypeScript com as interfaces definidas na Seção 7 deste documento. Isso elimina uma classe inteira de bugs de integração e facilita o onboarding de novos desenvolvedores.

### 13.4 Testes recomendados

| Camada | Ferramenta | O que testar |
|---|---|---|
| Unitário | Vitest | fmtQty, fmtPct, sortDomain, detectDelimiter, buildParetoFrontier, computeCellMetrics, validateFlow |
| Integração | Vitest + jsdom | CSV import wizard, cineminha assignment, simulation trigger |
| E2E | Playwright | Import CSV → criar política → verificar resultado de simulação |
| Visual | Chromatic/Storybook | Componentes do canvas, wizard, modais |

### 13.5 Decisões técnicas a tomar antes do desenvolvimento

1. **Processamento de CSV:** client-side (manter padrão atual) vs. server-side (recomendado para bases > 100MB)
2. **Persistência de fluxos:** localStorage (simples) vs. banco de dados com autenticação (produção)
3. **Motor de simulação:** Web Worker (atual) vs. backend dedicado (melhor para bases > 1M linhas)
4. **Autenticação:** SSO corporativo (SAML 2.0 ou OIDC)
5. **Deploy:** Container (Docker) vs. serverless vs. S3 + CloudFront (para frontend estático)
6. **Estado global:** React Context (atual, limitado) vs. Zustand vs. Redux Toolkit

### 13.6 Referência ao protótipo

O protótipo funcional pode ser executado localmente com:

```bash
npm install
npm run dev
```

Todo o comportamento descrito neste documento está implementado e pode ser observado ao vivo no protótipo. Recomenda-se que o time de desenvolvimento execute e navegue pelo protótipo antes de iniciar a implementação corporativa.

---

*Documento gerado em 12/06/2026. Protótipo disponível no repositório `arthurfontana/appcreditosimulador`.*
