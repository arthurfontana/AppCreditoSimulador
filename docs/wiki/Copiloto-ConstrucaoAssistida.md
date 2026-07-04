# Copiloto — Frente 1: Construção Assistida de Políticas

> Parte do épico [[Epicos-CopilotoIA|Copiloto de Política de Crédito]] (ler primeiro:
> arquitetura em camadas, PolicyIR, DEC-IA-001..006, contrato de privacidade).

## Contexto

Hoje a construção de uma política parte do canvas em branco: o usuário importa a
base, recebe chips de variáveis e monta o fluxo nó a nó. O sistema já possui peças
de "assistência" pontuais — ports automáticos por valor distinto ao criar um losango,
sugestões de tipo no wizard (`suggestVarType`, `suggestMetricColumns`), reconciliação
de variáveis na troca de base (`normalizeColName`), a biblioteca de Cineminhas
(`cinemaLibrary`, com aplicação por mapeamento de variáveis via `cinemaImportModal`)
e a validação de ciclos (`validateFlow`). Mas não existe assistência **contextual e
contínua** durante a montagem: nada sugere qual variável abrir a seguir, nada aponta
ports soltos ou segmentos mortos, nada oferece uma política inteira como ponto de
partida.

## Impacto no negócio

- Reduz o tempo de montagem de uma política nova (template + autocompletar) de horas para minutos.
- Reduz erros estruturais silenciosos (port sem destino = população que "some" da simulação; nó que ninguém alcança; lens que não filtra ninguém).
- Democratiza: um analista júnior parte de padrões validados pelos seniores (biblioteca de políticas da própria equipe).
- Sugestões estatísticas apontam onde a política **deveria** discriminar risco e não discrimina — valor direto de negócio, sem IA.

## Objetivo

Assistir a construção com quatro capacidades locais: (a) **validação estrutural
contínua** (lint), (b) **templates/biblioteca de políticas** reutilizáveis,
(c) **sugestão de próximo nó** por poder discriminante, (d) **autocompletar**
(conexões e terminais). Com IA habilitada (Nível 2+), acrescentar entrada em
linguagem natural e leitura semântica.

---

## Primeira etapa — Análise de viabilidade sem IA generativa

**É possível implementá-la sem IA generativa?** **Sim, com alta cobertura.** A
política é um grafo tipado sobre dados agregados — o domínio é estruturado o
suficiente para heurísticas determinísticas cobrirem a maior parte da assistência.

**Quais capacidades podem ser entregues?**
1. **Lint estrutural** (análise de grafo, tudo já disponível): ports sem conexão de
   saída; nós inalcançáveis a partir das raízes; ciclos (existe em `validateFlow`);
   nós/valores com chegada zero (`nodeArrivals` já traz qty por valor por nó); lens
   cujas regras não casam ninguém (`lensCounts.count === 0`); mesma variável testada
   duas vezes no mesmo caminho (redundância); célula de Cineminha fora do domínio
   que chega; ausência de terminal em algum caminho; fluxo sem AS IS configurado
   quando há comparação.
2. **Biblioteca de políticas (templates)**: generalização do padrão já provado no
   `cinemaLibrary` — salvar o **PolicyIR** (não o canvas com posições) com metadados
   (nome, descrição, tags, variáveis requeridas); aplicar com o modal de mapeamento
   de variáveis (fuzzy via `normalizeColName`, override manual — mesmo fluxo do
   `cinemaImportModal`), materializando shapes/conns via aplicador de patches +
   `autoLayout()` para posicionar.
3. **Padrões recorrentes**: mineração das políticas salvas na biblioteca — n-gramas
   de sequências de variáveis nos caminhos do IR ("depois de `Canal`, 80% das suas
   políticas testam `Score`") — contagem determinística, sem modelo.
4. **Sugestão de próximo nó** (a peça de maior valor): dado um port solto (ou nó
   selecionado), ranquear as variáveis de decisão candidatas pelo **poder
   discriminante sobre a população que chega ali**. Métricas clássicas de crédito,
   todas computáveis em uma passada sobre a base colunar restrita à população do
   port (mesmo walk do `computeNodeArrivals`):
   - **Information Value (IV)** / Weight of Evidence da variável vs. inadimplência (real ou inferida) — padrão de mercado em modelagem de crédito, determinístico;
   - alternativa mais simples: variância ponderada (ou razão max/min) da inad entre os valores da variável, ponderada por volume;
   - **detecção de interação** para sugerir Cineminha: se `IV(A×B) >> IV(A)+IV(B)` na população local, sugerir matriz cruzada A×B em vez de losango.
5. **Autocompletar**: para cada port solto, sugerir terminal pelo risco do segmento
   (inad do segmento vs. média/threshold ⇒ ✅/❌; segmento sem sinal ⇒ ⟳ AS IS),
   com aplicação em um clique e sempre revisável.
6. **Preenchimento automático de Cineminha**: já existe parcialmente (`resultVar`,
   cenários do `optimModal`); o copiloto só o expõe no momento da criação.

**Quais seriam as limitações?**
- Sem compreensão semântica: `IDADE_CLIENTE` e `SCORE_BUREAU` são apenas colunas com estatísticas; o motor não sabe que "menores de 18" é uma regra obrigatória de compliance.
- Sem entrada em linguagem natural: a intenção é declarada por formulário/gesto, não por frase.
- Cold start da biblioteca: padrões recorrentes exigem políticas salvas antes.
- Sugestões univariadas/bivariadas: não propõe reestruturações profundas do fluxo.

**Qual seria a experiência do usuário?**
- Um **painel "Copiloto"** (nova seção do painel direito, colapsável como as demais) com a lista viva de achados do lint (com "ir até o nó" e quick-fix quando aplicável) e as sugestões contextuais da seleção atual.
- Ao selecionar um port solto: toolbar contextual ganha "💡 Sugerir próximo passo" → lista ranqueada de variáveis com a justificativa numérica ("Score separa 4,1× a inad neste segmento · IV 0,42") e botões "criar losango"/"criar Cineminha".
- Botão "📚 Políticas" na seção Fluxo: salvar política atual na biblioteca / aplicar template (com mapeamento de variáveis).
- Tudo não-destrutivo: sugestões criam shapes propostos apenas mediante clique; `pushHistory()` antes de aplicar.

**Qual seria a qualidade esperada?**
- Lint: precisão ~100% (fatos estruturais, não opinião).
- Ranking de variáveis: qualidade estatística alta e **explicável** — cada sugestão exibe o número que a motivou; é o mesmo tipo de análise que um analista faria manualmente com tabelas dinâmicas.
- Templates: qualidade igual à da melhor política salva pela equipe (o sistema não cria conhecimento, reutiliza).

**Quais técnicas poderiam ser utilizadas?** Análise de grafos (alcançabilidade,
in/out-degree sobre `buildFlowGraph`), IV/WoE e entropia/Gini ponderados por volume,
n-gramas sobre caminhos do IR, fuzzy matching de nomes (`normalizeColName`),
templates parametrizados (PolicyIR + mapeamento), heurísticas de threshold.

**Como reutilizar a arquitetura existente?** Ver seção "Reutilização" abaixo — quase
tudo tem precedente direto.

---

## Jornada funcional

### Nível 1 (local)
1. Usuário importa base e abre política nova → painel Copiloto oferece "Começar de um template?" (se biblioteca não vazia).
2. Durante a montagem, o lint roda a cada tick de edição (mesmo debounce da simulação) e lista achados por severidade (🔴 quebra simulação / 🟡 provável descuido / 🔵 informativo).
3. Usuário seleciona um port solto → "💡 Sugerir próximo passo" → escolhe variável do ranking → losango/Cineminha criado já conectado.
4. Ao final, "Completar terminais" fecha os ports restantes com a sugestão de terminal por risco (revisável um a um).
5. Usuário salva a política na biblioteca para reuso futuro.

### Nível 2 (IA habilitada)
6. Campo de texto no painel Copiloto: "descreva a política" → IA converte em patch de IR (esqueleto) → Validator confere vocabulário → motor materializa no canvas → lint aponta o que falta. A IA **não** escolhe cortes numéricos por conta própria: onde faltar decisão, deixa pendência explícita para o usuário/Goal Seek.
7. Sugestões do ranking ganham leitura semântica ("`DIAS_ATRASO_ANTERIOR` parece histórico interno; costuma vir antes do score de bureau") — texto da IA, número do motor.

### Nível 3
8. Chat: "por que este port está sem saída?" / "monte a mesma estrutura da política X trocando o eixo de canal" — sempre respondendo com ações propostas (patches) + achados do lint.

## Comportamentos esperados

- Lint nunca bloqueia: apenas informa (a simulação já tolera fluxos incompletos).
- Sugestões sempre exibem justificativa numérica e população-alvo ("sobre 48k propostas que chegam aqui").
- Aplicações passam por `pushHistory()` (undo funciona) e respeitam o padrão de IDs (`_id`).
- Ranking recomputado apenas para a seleção atual (on-demand, não a cada tick — é uma passada na base por pedido).
- Template aplicado a base incompatível: variáveis não mapeadas ficam como pendência visível (nó marcado), nunca aplicação silenciosa parcial.

## Cenários de uso

1. **Analista novo**: aplica template "Política de entrada PF", mapeia 5 variáveis, ajusta 2 células do Cineminha, publica cenário — 15 minutos.
2. **Port esquecido**: lint aponta "port `R08` do nó Score sem destino — 3,2k propostas/dia sem decisão"; quick-fix sugere ❌ (inad do segmento 2,3× a média).
3. **Descoberta de corte**: no segmento "Canal = Digital", ranking mostra que `Faixa_Renda` tem IV 0,38 (vs. 0,05 no geral) → usuário cria o losango que não teria pensado em criar.
4. **Interação**: motor detecta `IV(Score×Canal) >> IV(Score)+IV(Canal)` e sugere Cineminha em vez de dois losangos em série.

## Cenários de teste simplificados (GATEs)

- `tests/policyLint.test.js`: fixtures pequenas (shapes/conns literais) para cada regra do lint — port solto, nó inalcançável, ciclo, chegada zero, lens vazio, variável repetida no caminho, caminho sem terminal. Cada regra: 1 caso positivo + 1 negativo.
- `tests/variableRanking.test.js`: base sintética de ~20 linhas onde a variável A separa perfeitamente a inad e B não separa nada ⇒ ranking(A) > ranking(B); IV calculado bate com valor de controle feito à mão; população restrita ao port (linhas que não chegam não contam).
- `tests/policyTemplates.test.js`: salvar política → aplicar em base com colunas renomeadas via mapeamento → PolicyIR resultante equivalente (mesmo roteamento); variável sem mapeamento vira pendência, não erro.

## Sugestões técnicas (para a IA implementadora)

- **Worker**: nova mensagem `COMPUTE_POLICY_INSIGHTS {shapes, conns}` → `POLICY_INSIGHTS_RESULT {findings: [{severity, code, nodeId?, portId?, msg, fix?}]}` — computável junto do tick (reusar `getTickResult`, que já tem `nodeArrivals`); e `COMPUTE_VARIABLE_RANKING {shapes, conns, anchor:{nodeId|portId}}` → ranking IV/entropia sobre a população que chega ao anchor (reusar o walk compilado do M8 para marcar a população, depois agregação O(distintos) por candidata).
- **Estado novo** (seguir a ⚠️ regra de persistência do CLAUDE.md): `policyLibrary` (array, persistida no `.credito.json` — padrão `cinemaLibrary`), `copilotFindings` (efêmero, não persiste), `copilotPanel` (preferência de UI).
- **Templates**: entrada = `{id, name, description, tags, ir: PolicyIR, requiredVars, savedAt}`; aplicação = mapeamento → `applyPolicyPatch` (Sessão 0) → `autoLayout()`.
- **Não** criar biblioteca de diagramas nem CSS novo (ADR-002/003); painel segue o padrão das seções existentes do painel direito.

## Reutilização de código e padrões existentes

| Necessidade | Já existe |
|---|---|
| Grafo de fluxo / alcançabilidade | `buildFlowGraph`, `validateFlow` (ciclos) |
| População que chega a cada nó/valor | `computeNodeArrivals` / `nodeArrivals` (worker, já no tick) |
| Contagem de lens | `lensCounts` (M10) |
| Roteamento rápido por população | motor compilado M8 (`compileRoutes`, `compileDecisionNode`…) |
| Acesso colunar O(distintos) | `distinctColValues`, `cellStr`/`cellNum`, dicionários |
| Biblioteca + aplicar com mapeamento | `cinemaLibrary` + `cinemaImportModal` + `normalizeColName` |
| Materializar/posicionar | `createDecisionNode`, `createCinemaNode`, `autoLayout()`, contador `_id` |
| Proposta não-destrutiva | padrão `proposedCells` → Aplicar (`optimModal`) |
| Sugestão heurística (precedente) | `suggestVarType`, `suggestMetricColumns`, `detectDelimiter` |
| Persistência | `buildProjectPayload`/`loadProject` + checklist do CLAUDE.md |

## Prompts das sessões

**Sessão 1 — Lint/Insights:**
```
Vamos à Sessão 1 do Copiloto (lint estrutural), conforme
docs/wiki/Copiloto-ConstrucaoAssistida.md e docs/wiki/Epicos-CopilotoIA.md
(DEC-IA-006). Implemente COMPUTE_POLICY_INSIGHTS no worker (reusando
getTickResult/nodeArrivals/lensCounts), o painel Copiloto no painel direito com
achados por severidade + "ir até o nó" + quick-fixes não-destrutivos, e
tests/policyLint.test.js com 1 caso positivo e 1 negativo por regra. Releia o épico
e o código antes de propor.
```

**Sessão 2 — Biblioteca de políticas:**
```
Vamos à Sessão 2 do Copiloto (biblioteca de políticas), conforme
docs/wiki/Copiloto-ConstrucaoAssistida.md. A Sessão 0 entregou o PolicyIR e o
applyPolicyPatch. Implemente policyLibrary (padrão cinemaLibrary: salvar IR +
metadados, export/import JSON, persistência no .credito.json seguindo a regra do
CLAUDE.md), o modal de aplicação com mapeamento de variáveis (padrão
cinemaImportModal + normalizeColName, pendências visíveis para não mapeadas) e
tests/policyTemplates.test.js. Releia o épico e o código antes de propor.
```

**Sessão 3 — Sugestão de próximo nó:**
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
