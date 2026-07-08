# Épico: Copiloto de Política de Crédito (IA opcional, local-first)

> **Status:** Sessão 0 (PolicyIR) ✅ ENTREGUE · Sessão 1 (Lint/Insights) ✅ ENTREGUE · Sessão 2 (Biblioteca de Políticas) ✅ ENTREGUE · Sessão 3 (Sugestão de próximo nó) ✅ ENTREGUE — demais sessões em planejamento.
> **Documentos das frentes:** [[Copiloto-ConstrucaoAssistida|1. Construção Assistida]] · [[Copiloto-SugestoesMelhoria|2. Sugestões de Melhoria]] · [[Copiloto-DocumentacaoAutomatica|3. Documentação Automática]]

## O que é

Um **copiloto contextual** que acompanha o analista durante a construção, análise e
documentação de políticas de crédito no simulador. Três frentes:

1. **Construção assistida** — templates, sugestão de próximo nó, autocompletar, validação estrutural.
2. **Sugestões inteligentes de melhoria** — o usuário declara um objetivo ("+2pp de aprovação com o menor aumento de inadimplência") e o sistema propõe mudanças concretas na política.
3. **Documentação automática** — a política do canvas vira documento executivo/técnico com os números da simulação.

O objetivo **não** é transformar o sistema em um chatbot. É um copiloto embutido na
jornada existente (canvas, otimizadores, dashboard). "Conversar com a política" é uma
capacidade avançada (Nível 3), possível apenas quando o usuário decidir conectar um
provedor de IA.

---

## Restrição central: privacidade

**Grande parte das políticas contém informação sensível** (regras de negócio,
segmentações, volumes, inadimplência por segmento). Por isso este épico é regido por
um princípio inegociável:

> **Toda funcionalidade deve operar 100% local, sem nenhuma chamada a API de IA.**
> A IA é uma camada opcional de **enriquecimento**, configurada pelo usuário em
> runtime, que **nunca substitui** o motor local e **nunca recebe dado linha a linha**.

A análise de viabilidade (abaixo) mostra que as três frentes são majoritariamente
entregáveis sem IA generativa — o simulador **já possui** os blocos fundamentais
(grafo de fluxo, motor de simulação, fronteira Pareto, otimizador Johnny, diagnóstico
de funil, biblioteca de componentes). O que falta é **orquestração e UX**, não
inteligência estatística.

---

## Impacto no negócio

- **Menor tempo de construção** de políticas: templates + sugestões contextuais reduzem o "canvas em branco".
- **Políticas melhores e defensáveis**: recomendações vêm com o número que as justifica (delta de aprovação/inad computado pelo simulador) — auditável, sem "caixa-preta".
- **Documentação sempre atualizada**: o documento é gerado da política viva, eliminando a divergência crônica entre política implantada e política documentada.
- **Zero exposição de dados por padrão**: viabiliza uso em ambientes regulados; a camada de IA é opt-in, com contrato explícito do que sai da máquina.
- **Independência de fornecedor**: arquitetura plugável — sem IA, Claude, OpenAI, Azure OpenAI, modelos locais ou outros, sem reescrita.

---

## Primeira etapa — Análise de viabilidade sem IA generativa (resumo executivo)

Análise detalhada em cada documento de frente. Conclusões:

| Frente | Viável sem IA generativa? | Qualidade esperada sem IA | O que só a IA acrescenta |
|---|---|---|---|
| 1. Construção assistida | **Sim — alta cobertura.** Templates, lint estrutural, ranking de variáveis por discriminância (IV/entropia), autocompletar de terminais, padrões minerados da biblioteca do próprio usuário | Alta para sugestões estruturais/estatísticas (determinísticas e explicáveis); sem interpretação de intenção em linguagem natural | Intenção em linguagem natural → esqueleto de política; leitura semântica de nomes de colunas; conversação |
| 2. Sugestões de melhoria | **Sim — o núcleo já existe.** `buildParetoFrontier` + `computeJohnnyData` (greedy com precedência + shrinkage bayesiano) já resolvem o problema para células de Cineminha; falta generalizar para a política inteira (Goal Seek) e para movimentos além de células | Alta e **superior à IA em precisão numérica**: todo delta é simulado, nunca estimado. Limitações: busca gulosa (ótimos locais), espaço de movimentos pré-definido | Interpretação do objetivo em linguagem natural; narrativa executiva do porquê; planos compostos multi-movimento; discussão de trade-offs |
| 3. Documentação automática | **Sim — quase integral.** A política é um grafo tipado com regras estruturadas; serialização determinística + templates de frase pt-BR + números do `simResult`/`incrementalResult` geram documento completo e correto | Alta em correção/completude; prosa mecânica e repetitiva (template), sem storytelling executivo | Reescrita em prosa natural e adaptada à audiência; sumários; Q&A sobre o documento |

**Conclusão da primeira etapa:** não há dependência estrutural de LLM em nenhuma
frente. A IA generativa agrega em (a) entrada em linguagem natural, (b) prosa de
saída e (c) conversação — exatamente o que a arquitetura em camadas isola como
opcional.

---

## Arquitetura conceitual (evolutiva, em 3 camadas)

```
┌──────────────────────────────────────────────────────────────┐
│  UI (App.jsx) — painéis, modais, toolbar contextual          │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────┐
│  CAMADA DE INTELIGÊNCIA (orquestração — main thread)         │
│  • TaskRouter: toda tarefa tem executor LOCAL obrigatório    │
│    e enhancer de IA opcional                                 │
│  • ContextBuilder: monta o pacote de contexto (PolicyIR +    │
│    métricas agregadas) respeitando o Contrato de Privacidade │
│  • Validator: saída da IA = patch de PolicyIR → validado por │
│    schema → simulado pelo motor ANTES de exibir números      │
│  • Redactor: pseudonimização opcional (VAR_1, VAL_A…)        │
│  • Auditoria: log local de tudo que foi enviado ao provedor  │
└───────────┬──────────────────────────────┬───────────────────┘
            │                              │ (opcional, se configurado)
┌───────────▼───────────────┐  ┌───────────▼───────────────────┐
│  MOTOR LOCAL (worker)     │  │  PROVEDOR DE IA (plugável)    │
│  • PolicyIR (JSON canôn.) │  │  Interface AIProvider:        │
│  • Lint/Insights engine   │  │  { id, label, capabilities,   │
│  • Ranking de variáveis   │  │    configure(), complete() }  │
│  • Goal Seek (generaliza  │  │  Adapters: Claude / OpenAI /  │
│    Pareto/Johnny)         │  │  Azure / modelo local / …     │
│  • Simplificação/equival. │  │  Sem adapter = null provider  │
│  • DocGen (templates)     │  │  (toda a UI degrada p/ local) │
└───────────────────────────┘  └───────────────────────────────┘
```

### Papéis das camadas

- **Motor Local** (em `src/simulation.worker.js` + helpers globais, seguindo o
  protocolo de mensagens existente): computa **tudo que é número, estrutura e
  candidato**. É a única fonte de métricas. Funciona sozinho — é o produto completo
  do Nível 1.
- **Camada de Inteligência**: mediadora. Não computa métricas nem chama rede por
  conta própria. Decide *o que* mandar para o provedor (se houver), *valida* o que
  volta e *funde* com o resultado local. Se não há provedor configurado, ela é um
  passthrough do motor local — por isso nenhuma feature "sabe" se a IA existe.
- **Provedor de IA**: intercambiável. A aplicação conhece apenas a interface
  conceitual `AIProvider`; cada provedor concreto é um adapter. `capabilities`
  (ex.: `{chat, structuredOutput, longContext}`) habilitam/desabilitam affordances
  na UI — nada quebra quando uma capability falta.

### PolicyIR — a representação canônica (fundação de tudo)

As três frentes e a camada de IA convergem para um mesmo artefato: o **JSON canônico
da política** (já previsto no [[Roadmap]] como "Exportação → JSON canônico"). É a
*lingua franca* do épico:

- **Frente 1** aplica templates e sugestões como *patches* de IR.
- **Frente 2** expressa cada movimento candidato como um patch de IR (aplicável em nova aba de canvas).
- **Frente 3** serializa o IR + métricas em documento.
- **A IA** só lê IR + métricas agregadas, e só escreve patches de IR (nunca toca `shapes`/`conns` diretamente, nunca gera números).

Forma conceitual (detalhes na Sessão 0):

```js
PolicyIR = {
  version, name, generatedAt,
  datasets: [{ csvId, name, columns: [{name, colType, varType, domainSize}] }], // metadados, SEM dados
  nodes: [
    { id, kind: 'decision',      variable, routes: [{values: string[], to}] },
    { id, kind: 'cinema',        cinemaType, rowVar, colVar, cells /*bitmap por par*/, routes },
    { id, kind: 'lens',          rules: LensRule[], to },
    { id, kind: 'terminal',      terminal: 'approved'|'rejected'|'as_is' },
  ],
  entry: nodeId[],               // raízes do fluxo
  paths?: [...],                 // opcional: regras "achatadas" raiz→terminal (para doc e IA)
}
```

Regras do IR: **derivável de `shapes`/`conns` sem perda de roteamento** (GATE: simular
via IR ≡ simular via canvas); **serializável/versionável**; **livre de dados
linha a linha e de posições x/y** (layout não é política).

---

## Contrato de Privacidade (níveis de dados)

Todo envio ao provedor é classificado. O padrão de envio é o mínimo viável para a
tarefa; o usuário vê e pode restringir.

| Nível | Conteúdo | Sai da máquina? |
|---|---|---|
| **N0 — Estrutura** | PolicyIR sem domínios: nós, variáveis (nomes de colunas), regras, topologia | Sim, quando IA habilitada (com opção de pseudonimizar nomes) |
| **N1 — Métricas agregadas** | `simResult`, `incrementalResult`, deltas por movimento, funil por nó (`exportDiagnosticCSV`-like), fronteiras | Sim, quando IA habilitada |
| **N2 — Domínios de valores** | Valores distintos das colunas de decisão (ex.: `R01..R20`, `Digital/Loja`) | **Opt-in explícito** por estudo |
| **N3 — Dados linha a linha** | Qualquer conteúdo do `csvStore` | **Nunca.** Não existe caminho de código que envie N3 |

O **Redactor** (pseudonimização) troca nomes de colunas/valores por tokens estáveis
(`VAR_1`, `VAL_A`…) com dicionário reverso mantido apenas localmente — a resposta da
IA é des-pseudonimizada antes de exibir. Auditoria local registra cada payload enviado.

---

## Contrato anti-alucinação ("a IA não inventa")

1. **Números sempre do motor.** A IA nunca produz métricas; recebe métricas e as
   referencia. Qualquer proposta vinda da IA é um **patch de PolicyIR** que o motor
   aplica em cópia, **simula** e só então exibe — com os números do simulador.
2. **Vocabulário fechado.** A IA só pode referenciar variáveis/valores presentes no
   contexto enviado; o Validator rejeita patches com colunas/valores inexistentes.
3. **Proposta ≠ aplicação.** Nada muda no canvas sem ação explícita do usuário
   (mesmo padrão não-destrutivo do `optimModal`/`johnnyModal`: `proposedCells` →
   botão Aplicar). Propostas maiores materializam em **nova aba de canvas** (cenário),
   comparável via Dashboard/KPI A vs B.
4. **Fallback sempre disponível.** Timeout/erro/ausência de provedor ⇒ resposta do
   executor local, sem estado quebrado.

---

## Decisões travadas

### DEC-IA-001: Local-first — IA é enriquecimento, nunca dependência
Toda funcionalidade das três frentes tem executor local completo e utilizável. A
camada de IA apenas melhora entrada (linguagem natural) e saída (prosa/explicação).
Critério de aceite permanente: **desligar a IA não remove nenhuma funcionalidade,
só reduz sofisticação.**

### DEC-IA-002: PolicyIR como representação intermediária única
Templates, sugestões, movimentos do Goal Seek, documentação e trocas com a IA usam o
JSON canônico da política. `shapes`/`conns` continuam sendo a fonte de verdade do
canvas; o IR é **derivado** (com GATE de equivalência de roteamento) e patches de IR
são **materializados** de volta em shapes/conns por um único aplicador.

### DEC-IA-003: Provedor plugável, configurado em runtime, capability-based
Interface `AIProvider` conceitual (sem escolher tecnologia). O usuário configura o
provedor **no momento do uso** (modal de configuração); **nenhuma credencial é
persistida no `.credito.json`** (no máximo `sessionStorage`, opt-in). Sem provedor
configurado, o `null provider` mantém a UI 100% funcional em modo local.

### DEC-IA-004: Contrato de Privacidade em níveis (N0–N3)
Ver tabela acima. N3 (linha a linha) nunca sai; N2 é opt-in; pseudonimização
disponível para N0/N2; auditoria local de payloads.

### DEC-IA-005: Números sempre do motor; IA escreve apenas patches de IR validados e simulados
Ver Contrato anti-alucinação. Nenhum número exibido ao usuário pode ter origem no
texto de um modelo.

### DEC-IA-006: Motores no worker, UI não-destrutiva nos padrões existentes
Novas computações pesadas entram como mensagens do worker (padrão
`COMPUTE_* → *_RESULT`, cache single-slot como `getTickResult`). Novas propostas
seguem o padrão `proposed* → Aplicar` dos otimizadores. Novo estado criado pelo
usuário entra no `buildProjectPayload()`/`loadProject` (⚠️ regra do CLAUDE.md) e,
quando fizer sentido, na auto-persistência de `sessionStorage`.

---

## Níveis de maturidade

### Nível 0 — Fundação (pré-requisito técnico) — ✅ ENTREGUE (Sessão 0)
- **PolicyIR**: `buildPolicyIR(shapes, conns, csvStore)` + serialização + aplicador de patches + GATE de equivalência de roteamento com o motor compilado (M8).
- Sem UI nova visível (além do export do JSON canônico, que já quita um item do Roadmap).
- **Como foi entregue**: `buildPolicyIR(shapes, conns, csvStore, opts?)` e
  `applyPolicyPatch(patch, base?)` como helpers globais exportados em `src/App.jsx`
  (IDs novos via o contador `_id`/`uid()` existente; retorna `{shapes, conns, idMap}`).
  O IR achata as cadeias de ports (`decision→port→destino` vira `{values, to}`),
  captura a elegibilidade do Cineminha em `blockedCells` (só roteamento — grades
  numéricas de oferta não entram) e carrega `entry` (raízes, mesmo critério do motor)
  e metadados de dataset SEM dados (N0). Export "JSON Canônico da Política" como 3ª
  opção do modal Exportar Fluxo (`doExportPolicyIR`, arquivo `.policy.json`). GATE
  `tests/policyIR.test.js`: roteamento via IR ≡ motor compilado (M8) sobre as fixtures
  de `tests/compiledEngine.test.js` (incl. decisão simulada por linha), round-trip
  IR→canvas→IR estável (módulo renomeação de IDs) e IR sem posições/dados.

### Nível 1 — Sistema totalmente local (produto completo sem IA)
- **Frente 1**: lint/insights estruturais; biblioteca de políticas/templates com mapeamento de variáveis; sugestão de próximo nó por discriminância; autocompletar terminais.
- **Frente 2**: Goal Seek estruturado (formulário de objetivo + restrições) sobre a política inteira; deltas marginais por movimento; simplificação com prova de equivalência; aplicação em nova aba de canvas.
- **Frente 3**: documento executivo/técnico gerado por templates (Markdown/HTML imprimível), com números do simulador, funil, comparação de cenários e changelog estrutural.
- **Experiência**: painéis e modais nativos; toda sugestão exibe a justificativa numérica; nada de chat.

### Nível 2 — Camada opcional de IA (enriquecimento)
- Infra: `AIProvider` + adapters + modal de configuração + ContextBuilder/Validator/Redactor/Auditoria.
- **Frente 1**: descrição em linguagem natural → esqueleto de política (patch de IR validado); leitura semântica de nomes de colunas para melhores sugestões.
- **Frente 2**: objetivo em linguagem natural → objetivo estruturado do Goal Seek local ("aumente 2pp a aprovação com o menor aumento de inad" → `{target:'approvalRate', delta:+0.02, minimize:'inadInferida'}`); explicação narrativa das propostas do motor.
- **Frente 3**: reescrita do documento templateado em prosa executiva; sumário; adaptação de tom/audiência.
- **Experiência**: mesmos painéis, com botões "✨ Refinar com IA" que aparecem só com provedor configurado e capability compatível.

### Nível 3 — Copiloto contextual avançado
- **Chat com a política**: perguntas em linguagem natural respondidas com grounding no PolicyIR + métricas agregadas ("por que a inad sobe no cenário B?", "onde uso a variável Score?"). Fallback local: busca estruturada no IR (sem prosa).
- **Planos compostos**: sequências de movimentos do Goal Seek com narrativa de trade-off; comparação multi-cenário comentada.
- **Documentação viva**: Q&A sobre o documento gerado; changelog comentado entre versões da política.
- Tudo permanece regido por DEC-IA-004/005 — o chat não vê dados, vê política + agregados.

---

## Plano de sessões

Cada sessão é independente, implementável por um modelo mais simples, com prompt
pronto (padrão do épico Analytics Workspace). Ordem recomendada; 1–6 não dependem de
IA em nada.

| Sessão | Entrega | Frente | Nível |
|---|---|---|---|
| 0 | PolicyIR + export JSON canônico + GATE — ✅ ENTREGUE | fundação | 0 |
| 1 | Lint/Insights estruturais (painel + `COMPUTE_POLICY_INSIGHTS`) — ✅ ENTREGUE | 1 | 1 |
| 2 | Biblioteca de políticas/templates (salvar/aplicar com mapeamento) — ✅ ENTREGUE | 1 | 1 |
| 3 | Sugestão de próximo nó (ranking por discriminância) — ✅ ENTREGUE | 1 | 1 |
| 4 | Goal Seek estruturado (`COMPUTE_GOAL_SEEK` + modal de objetivo) | 2 | 1 |
| 5 | Simplificação + prova de equivalência | 2 | 1 |
| 6 | DocGen local (`COMPUTE_POLICY_DOC` + preview/print/download) | 3 | 1 |
| 7 | Camada de Inteligência + `AIProvider` + configuração + Redactor/Auditoria | infra | 2 |
| 8 | Enriquecimentos de IA por frente (NL→objetivo, NL→esqueleto, prosa executiva) | 1–3 | 2 |
| 9 | Chat com a política (grounded) + planos compostos | 1–3 | 3 |

Prompts de abertura de cada sessão estão no documento da frente correspondente
(Sessões 0 e 7, abaixo).

**Prompt — Sessão 0 (PolicyIR):**
```
Vamos à Sessão 0 do Copiloto (PolicyIR), conforme docs/wiki/Epicos-CopilotoIA.md
(DEC-IA-002). Implemente buildPolicyIR(shapes, conns, csvStore) como helper global
exportado, o export "JSON canônico da política" na seção Fluxo, o aplicador
applyPolicyPatch (patch de IR → shapes/conns, IDs via contador _id existente) e o
GATE tests/policyIR.test.js: roteamento via IR ≡ motor compilado (M8) sobre as
fixtures de tests/compiledEngine.test.js, round-trip IR→canvas→IR estável, e IR sem
posições/dados. Releia o épico e o código antes de propor.
```

**Prompt — Sessão 7 (Camada de Inteligência):**
```
Vamos à Sessão 7 do Copiloto (Camada de Inteligência), conforme
docs/wiki/Epicos-CopilotoIA.md (DEC-IA-003/004/005). Implemente a interface
AIProvider (null provider + registro de adapters, sem escolher provedor concreto),
o modal de configuração em runtime (credencial nunca no .credito.json), o
ContextBuilder com níveis N0/N1/N2 e Redactor de pseudonimização, o Validator de
patches de IR (schema + simulação antes de exibir) e a auditoria local de payloads.
Nenhuma feature nova de IA nesta sessão — só a infraestrutura com testes dos
contratos (contexto nunca contém N3; patch inválido rejeitado). Releia o épico e o
código antes de propor.
```

---

## Riscos globais e mitigação

| Risco | Mitigação |
|---|---|
| IR divergir do motor (roteamento diferente) | GATE permanente de equivalência com o motor compilado (M8), mesmo padrão de `tests/compiledEngine.test.js` |
| Explosão combinatória no Goal Seek | Espaço de movimentos fechado + deltas O(1) por agregados de segmento + greedy/beam com orçamento (padrão Johnny) |
| Vazamento de dado sensível na camada de IA | DEC-IA-004: N3 estruturalmente impossível (ContextBuilder não tem acesso ao `csvStore` bruto), N2 opt-in, Redactor, auditoria, testes de contrato |
| Lock-in de provedor | DEC-IA-003: adapter + capabilities; toda UI funciona com null provider |
| Sugestão estatística sem sentido de negócio | Toda sugestão carrega a justificativa numérica e é não-destrutiva; usuário pode travar nós/células (🔒) como restrição do Goal Seek |
| Crescimento do `App.jsx` | Motores no worker/módulos (`policyIR.js` pode seguir o precedente de `columnar.js`); UI segue ADR-001/002 |

---

## Como iniciar cada sessão

Mesmo padrão do Analytics Workspace: uma linha de contexto + referência a este épico
e ao documento da frente. O CLAUDE.md e a wiki dão o contexto de decisões — releia o
código antes de propor. Sessões marcam ✅ ENTREGUE neste documento ao concluir.
