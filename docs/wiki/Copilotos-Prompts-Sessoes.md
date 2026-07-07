# Copilotos IA — Prompts de Todas as Sessões

> **Ordem de execução**: Sessão 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
>
> Referência: [[Epicos-CopilotoIA|Épico Principal]] · [[Copiloto-ConstrucaoAssistida|Frente 1]] · [[Copiloto-SugestoesMelhoria|Frente 2]] · [[Copiloto-DocumentacaoAutomatica|Frente 3]]

---

## Sessão 0 — PolicyIR (Fundação)

**Documentação**: `docs/wiki/Epicos-CopilotoIA.md` (Nível 0)

**Pré-requisitos**: Nenhum (é a base de todas as outras)

**O que vai entregar**:
- `buildPolicyIR(shapes, conns, csvStore)` — helper global exportado
- Export "JSON canônico da política" na seção Fluxo
- `applyPolicyPatch(patch)` — aplicador de patches de IR → shapes/conns
- GATE: `tests/policyIR.test.js`

**Prompt**:
```
Vamos à Sessão 0 do Copiloto (PolicyIR), conforme docs/wiki/Epicos-CopilotoIA.md
(DEC-IA-002). Implemente buildPolicyIR(shapes, conns, csvStore) como helper global
exportado, o export "JSON canônico da política" na seção Fluxo, o aplicador
applyPolicyPatch (patch de IR → shapes/conns, IDs via contador _id existente) e o
GATE tests/policyIR.test.js: roteamento via IR ≡ motor compilado (M8) sobre as
fixtures de tests/compiledEngine.test.js, round-trip IR→canvas→IR estável, e IR sem
posições/dados. Releia o épico e o código antes de propor.
```

---

## Sessão 1 — Lint/Insights Estruturais

**Documentação**: `docs/wiki/Copiloto-ConstrucaoAssistida.md` (Frente 1, Nível 1)

**Pré-requisitos**: Sessão 0 (PolicyIR)

**O que vai entregar**:
- `COMPUTE_POLICY_INSIGHTS` no worker
- Painel Copiloto no painel direito com achados por severidade
- Quick-fixes não-destrutivos
- GATE: `tests/policyLint.test.js`

**Prompt**:
```
Vamos à Sessão 1 do Copiloto (lint estrutural), conforme
docs/wiki/Copiloto-ConstrucaoAssistida.md e docs/wiki/Epicos-CopilotoIA.md
(DEC-IA-006). Implemente COMPUTE_POLICY_INSIGHTS no worker (reusando
getTickResult/nodeArrivals/lensCounts), o painel Copiloto no painel direito com
achados por severidade + "ir até o nó" + quick-fixes não-destrutivos, e
tests/policyLint.test.js com 1 caso positivo e 1 negativo por regra. Releia o épico
e o código antes de propor.
```

---

## Sessão 2 — Biblioteca de Políticas

**Documentação**: `docs/wiki/Copiloto-ConstrucaoAssistida.md` (Frente 1, Nível 1)

**Pré-requisitos**: Sessão 0, 1

**O que vai entregar**:
- `policyLibrary` (array, persistida no `.credito.json`)
- Modal de aplicação com mapeamento de variáveis
- Pendências visíveis para não mapeadas
- GATE: `tests/policyTemplates.test.js`

**Prompt**:
```
Vamos à Sessão 2 do Copiloto (biblioteca de políticas), conforme
docs/wiki/Copiloto-ConstrucaoAssistida.md. A Sessão 0 entregou o PolicyIR e o
applyPolicyPatch. Implemente policyLibrary (padrão cinemaLibrary: salvar IR +
metadados, export/import JSON, persistência no .credito.json seguindo a regra do
CLAUDE.md), o modal de aplicação com mapeamento de variáveis (padrão
cinemaImportModal + normalizeColName, pendências visíveis para não mapeadas) e
tests/policyTemplates.test.js. Releia o épico e o código antes de propor.
```

---

## Sessão 3 — Sugestão de Próximo Nó

**Documentação**: `docs/wiki/Copiloto-ConstrucaoAssistida.md` (Frente 1, Nível 1)

**Pré-requisitos**: Sessão 0, 1, 2

**O que vai entregar**:
- `COMPUTE_VARIABLE_RANKING` no worker
- Botão "💡 Sugerir próximo passo" na toolbar contextual
- Ranking com IV/WoE + justificativa numérica
- Autocompletar de terminais por risco
- GATE: `tests/variableRanking.test.js`

**Prompt**:
```
Vamos à Sessão 3 do Copiloto (sugestão de próximo nó), conforme
docs/wiki/Copiloto-ConstrucaoAssistida.md. Implemente COMPUTE_VARIABLE_RANKING no
worker (população do anchor via roteamento compilado M8; IV/WoE + variância
ponderada por candidata, O(distintos) na agregação; detecção de interação para
sugerir Cineminha), o botão "💡 Sugerir próximo passo" na toolbar contextual de port
solto com ranking + justificativa numérica + criação em um clique, o autocompletar
de terminais por risco do segmento, e tests/variableRanking.test.js com valores de
controle manuais. Releia o épico e o código antes de propor.
```

---

## Sessão 4 — Goal Seek Estruturado

**Documentação**: `docs/wiki/Copiloto-SugestoesMelhoria.md` (Frente 2, Nível 1)

**Pré-requisitos**: Sessão 0, 1, 2, 3

**O que vai entregar**:
- `COMPUTE_GOAL_SEEK` no worker
- Modal `goalSeekModal` no padrão `johnnyModal`
- Objetivo estruturado + fronteira + movimentos
- Aplicação como novo cenário via `cloneCanvasWithNewIds`
- GATE: `tests/goalSeek.test.js`

**Prompt**:
```
Vamos à Sessão 4 do Copiloto (Goal Seek), conforme
docs/wiki/Copiloto-SugestoesMelhoria.md e docs/wiki/Epicos-CopilotoIA.md
(DEC-IA-005/006). Implemente COMPUTE_GOAL_SEEK no worker: agregados por segmento
(nó,valor) via walk compilado M8, catálogo de movimentos (célula, terminal de
segmento, corte ordinal com precedência, regra de lens), deltas incrementais O(1)
com GATE contra runSimulation, busca gulosa com restrições/travas 🔒 e shrinkage
(padrão computeJohnnyData), re-simulação de validação do resultado. UI: modal
goalSeekModal no padrão johnnyModal (objetivo estruturado + fronteira + movimentos +
aplicar como novo cenário via cloneCanvasWithNewIds). GATE tests/goalSeek.test.js.
Releia o épico e o código antes de propor.
```

---

## Sessão 5 — Simplificação com Prova de Equivalência

**Documentação**: `docs/wiki/Copiloto-SugestoesMelhoria.md` (Frente 2, Nível 1)

**Pré-requisitos**: Sessão 0, 1, 2, 3, 4

**O que vai entregar**:
- `COMPUTE_SIMPLIFY` no worker
- Detecção de nós colapsáveis, chegada zero, regras sem efeito
- Proposta como patch de IR
- Prova via `computeSimulatedDecisions` diff=0 ou delta declarado
- GATE: `tests/policySimplify.test.js`

**Prompt**:
```
Vamos à Sessão 5 do Copiloto (simplificação com prova de equivalência), conforme
docs/wiki/Copiloto-SugestoesMelhoria.md. Implemente COMPUTE_SIMPLIFY no worker
(detecção de nós colapsáveis, chegada zero, regras sem efeito, variável re-testada;
proposta como patch de IR; prova via computeSimulatedDecisions diff=0 ou delta
declarado), UI de revisão não-destrutiva e tests/policySimplify.test.js. Releia o
épico e o código antes de propor.
```

---

## Sessão 6 — DocGen Local (Documentação Automática)

**Documentação**: `docs/wiki/Copiloto-DocumentacaoAutomatica.md` (Frente 3, Nível 1)

**Pré-requisitos**: Sessão 0, 1, 2, 3, 4, 5

**O que vai entregar**:
- `COMPUTE_POLICY_DOC` no worker
- `docModel` (seções com dados crus)
- Renderers: `renderDocMarkdown` / `renderDocHTML`
- Modal de composição com toggle de domínios
- `diffPolicyIR` para changelog
- GATE: `tests/policyDoc.test.js`

**Prompt**:
```
Vamos à Sessão 6 do Copiloto (documentação automática local), conforme
docs/wiki/Copiloto-DocumentacaoAutomatica.md e docs/wiki/Epicos-CopilotoIA.md
(DEC-IA-006). Implemente COMPUTE_POLICY_DOC no worker devolvendo um docModel
(seções com dados crus: KPIs/incrementalResult, fluxo via PolicyIR, paths achatados,
funil por nó+valor, cenários via pipeline 5B, confiabVolume, glossário), os
renderers puros renderDocMarkdown/renderDocHTML (inline styles, window.print), o
modal de composição com toggle de domínios e o diffPolicyIR para o changelog. GATE
tests/policyDoc.test.js (números ≡ motor, completude, determinismo, privacidade).
Releia o épico e o código antes de propor.
```

---

## Sessão 7 — Camada de Inteligência (Infra de IA)

**Documentação**: `docs/wiki/Epicos-CopilotoIA.md` (Infra, Nível 2)

**Pré-requisitos**: Sessão 0–6 (Nível 1 completo)

**O que vai entregar**:
- Interface `AIProvider` (null provider + registro de adapters)
- Modal de configuração em runtime (credencial nunca no `.credito.json`)
- `ContextBuilder` com níveis N0/N1/N2
- `Redactor` de pseudonimização
- `Validator` de patches de IR (schema + simulação)
- Auditoria local de payloads
- GATE: Testes de contratos (contexto nunca contém N3; patch inválido rejeitado)

**Prompt**:
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

## Sessão 8 — Enriquecimentos de IA por Frente

**Documentação**: `docs/wiki/Epicos-CopilotoIA.md` (Nível 2)

**Pré-requisitos**: Sessão 0–7 (Nível 1 completo + Infra)

**O que vai entregar**:
- **Frente 1**: Descrição em NL → esqueleto de política; leitura semântica de nomes
- **Frente 2**: Objetivo em NL → objetivo estruturado; explicação narrativa de propostas
- **Frente 3**: Reescrita em prosa executiva; sumário; adaptação de tom/audiência
- Botões "✨ Refinar com IA" contextuais
- GATE: Números citados no output IA sempre existem na fonte local

**Prompt**:
```
Vamos à Sessão 8 do Copiloto (enriquecimentos de IA), conforme
docs/wiki/Epicos-CopilotoIA.md (Nível 2). Implemente, por frente, os adaptadores de
IA para as três capacidades:
  - Frente 1: NL→PolicyIR (esqueleto validado pelo Validator); leitura semântica de nomes.
  - Frente 2: NL→objetivo estruturado (parsing com confirmação); narrativa executiva de propostas.
  - Frente 3: reescrita docModel em prosa; sumário; adaptação de audiência.
Botões "✨ Refinar com IA" aparecem só com provedor configurado e capability compatível.
GATE: toda métrica citada no texto IA existe no docModel/resultados locais (Validator
rejeita divergências). Releia o épico, as frentes e o código antes de propor.
```

---

## Sessão 9 — Chat com a Política (Copiloto Conversacional)

**Documentação**: `docs/wiki/Epicos-CopilotoIA.md` (Nível 3)

**Pré-requisitos**: Sessão 0–8

**O que vai entregar**:
- Interface de chat no painel
- Grounding em PolicyIR + métricas agregadas (nunca dados linha a linha)
- Fallback local: busca estruturada (sem prosa)
- Planos compostos: sequências de movimentos com narrativa
- Documentação viva: Q&A sobre documento gerado
- Changelog comentado entre versões

**Prompt**:
```
Vamos à Sessão 9 do Copiloto (chat contextual), conforme
docs/wiki/Epicos-CopilotoIA.md (Nível 3). Implemente a interface de chat no painel
(mensagens, histórico de sessão) com grounding em PolicyIR + métricas agregadas do
docModel (estrutura, valores, regras, números — nunca dados linha a linha). Cada
resposta é gerada pelo AIProvider com contexto N0/N1 e validada antes de exibir
(Validator existente). Fallback local: busca estruturada no IR sem prosa (quando
provedor ausente ou timeout). Suporte a: "por que o port X está sem saída?", "onde
uso a variável Score?", "compare cenários A e B" (com citação de artefatos do
motor). Planos compostos: sequências de Goal Seek com narrativa de trade-offs.
Documentação viva: Q&A sobre o docModel gerado; changelog comentado entre versões.
Releia o épico e o código antes de propor.
```

---

## Checklist de Execução

- [ ] **Sessão 0** — PolicyIR ✅
- [ ] **Sessão 1** — Lint/Insights
- [ ] **Sessão 2** — Biblioteca de políticas
- [ ] **Sessão 3** — Sugestão de próximo nó
- [ ] **Sessão 4** — Goal Seek
- [ ] **Sessão 5** — Simplificação
- [ ] **Sessão 6** — DocGen
- [ ] **Sessão 7** — Camada de IA
- [ ] **Sessão 8** — Enriquecimentos IA
- [ ] **Sessão 9** — Chat

---

## Resumo das Dependências

```
Sessão 0 (PolicyIR)
    ↓
Sessão 1 (Lint) ← reusa IR + nodeArrivals
    ↓
Sessão 2 (Templates) ← reusa Lint + IR
    ↓
Sessão 3 (Ranking) ← reusa Lint + Templates
    ↓
Sessão 4 (Goal Seek) ← reusa Ranking + computeJohnnyData
    ↓
Sessão 5 (Simplify) ← reusa Goal Seek + IR
    ↓
Sessão 6 (DocGen) ← reusa tudo acima (IR + agregados)
    ↓
Sessão 7 (Infra IA) ← nenhuma dependência funcional, só estrutural
    ↓
Sessão 8 (Enriquecimentos IA) ← reusa Sessões 1–6 + Infra 7
    ↓
Sessão 9 (Chat) ← reusa tudo
```

---

## Padrões Gerais

Cada sessão segue o mesmo template:

1. **Leia** o documento da frente (referência no início do prompt)
2. **Releia** o épico principal e o CLAUDE.md
3. **Reutilize** código existente (tabelas "Reutilização" em cada frente listam o que já existe)
4. **Implemente** o worker + UI + GATE (teste)
5. **Persistência**: seguir a ⚠️ regra do CLAUDE.md (`buildProjectPayload` + `loadProject`)
6. **Teste**: rodar o GATE e verificar equivalência/determinismo

---

**Última atualização**: 2026-07-07
