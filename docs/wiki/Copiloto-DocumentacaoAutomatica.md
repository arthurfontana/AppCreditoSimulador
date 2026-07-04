# Copiloto — Frente 3: Geração Automática de Documentação

> Parte do épico [[Epicos-CopilotoIA|Copiloto de Política de Crédito]] (ler primeiro:
> arquitetura em camadas, PolicyIR, DEC-IA-001..006, contrato de privacidade).

## Contexto

A política construída no canvas é, hoje, autodescritiva apenas para quem olha o
canvas. A documentação formal (para comitê de crédito, auditoria, handoff para o
motor de produção) é escrita à mão — e diverge da política real na primeira
alteração. O sistema já produz artefatos documentais parciais: o
`exportDiagnosticCSV` (funil de auditoria por nó+valor com aprovação/volume/inad), o
export de fluxo (shapes/conns em JSON), o export CSV do dataset analítico com
cenários lado a lado (5C), o `incrementalResult` (AS IS vs simulado com
rToA/aToR/deltas), o `edgeStats` (volume/inad por aresta, já exibido nos balões) e a
sinalização de confiabilidade da inferência (`InferenceSignal`). Falta o **documento
integrador**: a política inteira em linguagem legível, com os números da simulação,
em formato distribuível.

## Impacto no negócio

- **Documentação sempre fiel**: gerada da política viva a cada clique — elimina a divergência política implantada × política documentada (risco de auditoria).
- **Tempo de comitê**: material executivo (KPIs, deltas, populações impactadas) sai pronto do simulador.
- **Handoff para produção**: o anexo técnico (regras achatadas raiz→terminal + JSON canônico) é a especificação de implementação no motor de decisão real (item do [[Roadmap]]).
- **Rastreabilidade**: changelog estrutural entre versões/cenários documenta *o que mudou e com que impacto*.

## Objetivo

Gerar, a partir do canvas + resultados de simulação, um **documento de política**
com: sumário executivo (KPIs e deltas vs AS IS), descrição do fluxo em linguagem
natural templateada, tabelas de regras (losangos, Cineminhas, lens), funil por nó,
comparação de cenários, anexo de confiabilidade da inferência, glossário de
variáveis e changelog. Saídas: HTML imprimível (→ PDF via navegador) e Markdown.
Com IA (Nível 2+): reescrita em prosa executiva e Q&A sobre o documento.

---

## Primeira etapa — Análise de viabilidade sem IA generativa

**É possível implementá-la sem IA generativa?** **Sim — é a frente de maior
cobertura local.** Documentar uma estrutura formal (grafo tipado + regras
estruturadas + métricas numéricas) é um problema de **serialização + templates**,
não de geração criativa. A qualidade de *correção* é inclusive superior sem LLM:
zero risco de alucinação num documento de auditoria.

**Quais capacidades podem ser entregues?**
1. **Descrição do fluxo**: caminhada determinística no PolicyIR a partir das raízes
   (`entry`), emitindo cada nó com templates de frase pt-BR:
   - losango: "As propostas são segmentadas por **{variável}**: valores {v1, v2} seguem para {destino}; …";
   - Cineminha: tabela da matriz (linhas × colunas, ✅/✖ por célula) + resumo ("das {n} combinações, {k} são elegíveis");
   - lens: regras em condição legível ("**Score** entre R01 e R05 **E** **Canal** = Digital") — render textual de `LensRule[]`, mesmo vocabulário do `lensModal`;
   - terminal: "…são **Aprovadas**" / AS IS: "…mantêm a decisão histórica".
2. **Regras achatadas (paths)**: cada caminho raiz→terminal vira uma regra composta
   ("SE Canal=Digital E Score∈{R01..R07} E célula R05|Digital elegível ⇒ APROVADO")
   — formato de especificação para implantação e conferência de auditoria.
3. **Números da simulação em cada seção**: KPIs do `simResult` (aprovação, inad
   real/inferida), deltas do `incrementalResult` (incl. rToA/aToR e volumes), funil
   por nó+valor (mesma agregação do `exportDiagnosticCSV`), volume por aresta
   (`edgeStats`), % de confiança da inferência (`confiabVolume`) com o mesmo aviso
   textual do `InferenceSignal`.
4. **Comparação de cenários**: uma coluna por aba marcada (`includeInDashboard`),
   reaproveitando o pipeline N-cenários (5B) — tabela executiva "AS IS × Cenário A ×
   Cenário B".
5. **Changelog estrutural**: diff de dois PolicyIR (nós adicionados/removidos,
   células alteradas, regras mudadas) + diff de métricas — "o que mudou e qual o
   impacto".
6. **Glossário**: variáveis usadas, tipo (`columnTypes`/`varTypes`), papel na
   política, domínio (tamanho; valores completos apenas se o usuário incluir).
7. **Formatos**: HTML self-contained (inline styles — coerente com ADR-002) aberto
   em nova aba para imprimir/salvar PDF; download Markdown; o JSON canônico como
   anexo técnico. Diagrama: export do canvas como SVG (o canvas **já é** SVG —
   serializar o nó SVG com estilos inline; quita item do Roadmap).

**Quais seriam as limitações?**
- **Prosa mecânica**: frases corretas porém repetitivas; sem síntese ("esta política prioriza volume no digital aceitando mais risco em rating médio" é leitura interpretativa que template não faz).
- **Qualidade herdada dos nomes**: se as colunas se chamam `VAR_23`, o documento fica ilegível — mitigável com um mapa opcional de rótulos amigáveis (editável pelo usuário, persistido no projeto).
- Sem adaptação de audiência/tom; sem tradução; sem resumo seletivo ("uma página só").

**Qual seria a experiência do usuário?**
- Botão **"📄 Documentar política"** na seção Fluxo/Projeto → modal de composição:
  checkboxes de seções (executivo/técnico/funil/cenários/changelog/glossário),
  seletor de cenários a incluir, toggle "incluir domínios de valores" → **Prévia**
  renderizada → Imprimir/HTML/Markdown.
- O documento carimba metadados: data, nº do build (`BuildBadge`), nome do projeto, hash do IR (integridade/rastreabilidade).

**Qual seria a qualidade esperada?**
- **Correção e completude: totais** (determinístico; todo número tem origem no motor).
- Legibilidade: boa para técnico/auditoria; regular para executivo (mecânica) — exatamente a lacuna que o Nível 2 preenche.

**Quais técnicas poderiam ser utilizadas?** Serialização de grafo (travessia em
ordem topológica — reusar a lógica de camadas do `autoLayout`), templates de frase
parametrizados pt-BR, achatamento de caminhos (DFS raiz→terminal com composição de
condições), diff estrutural de árvores/IR, formatadores existentes (`fmtPct`,
`fmtQty`, `fmtMetricVal`).

**Como reutilizar a arquitetura existente?** Ver tabela abaixo — todos os números já
são computados hoje; o DocGen é 90% *apresentação*.

---

## Jornada funcional

### Nível 1 (local)
1. Usuário conclui (ou altera) a política → "📄 Documentar política".
2. Escolhe seções e cenários; vê a prévia; exporta HTML/PDF/Markdown.
3. Para mudança de política: seleciona "changelog vs. cenário X" → documento traz o diff estrutural e de métricas.
4. Anexo técnico (paths achatados + JSON canônico) segue para implantação/auditoria.

### Nível 2 (IA habilitada)
5. Botão "✨ Versão executiva": a IA recebe o documento templateado + métricas
   (N0+N1; domínios N2 só com opt-in) e reescreve em prosa natural — sumário,
   ênfases, transições. O Validator confere que **todo número citado existe no
   documento-fonte** (checagem literal de tokens numéricos); divergência ⇒ descarta
   e mantém a versão local.
6. Adaptação de audiência ("resuma em 1 página para diretoria", "detalhe para auditoria") e tradução.

### Nível 3
7. **Documentação viva**: Q&A sobre a política/documento ("qual o tratamento de proponente sem score?" → resposta com citação da regra e números); changelog comentado entre versões; geração periódica comparando safras.

## Comportamentos esperados

- Documento sempre gerado do estado atual (IR + última simulação); se a simulação está desatualizada/rodando, o modal aguarda o tick (mesmo debounce existente).
- Nenhuma seção inventa dado: sem AS IS configurado, a seção comparativa declara "baseline não configurada" (não omite silenciosamente).
- Domínios de valores só entram no documento com o toggle ligado (o documento pode circular — mesmo cuidado do contrato de privacidade, aplicado ao papel).
- A versão IA nunca substitui a local: são duas abas na prévia ("Estruturada" / "Executiva ✨"), e a estruturada é a fonte auditável.
- Determinismo: mesma política + mesma base ⇒ mesmo documento byte a byte (facilita diff externo e o GATE).

## Cenários de uso

1. **Comitê**: analista gera o executivo do "Cenário Expansão Q3" com deltas vs AS IS e leva o PDF — 1 clique em vez de 2 dias de PowerPoint.
2. **Auditoria**: auditor recebe o anexo técnico com as regras achatadas e o funil por nó, e confere contra o motor de produção.
3. **Handoff**: time de engenharia implanta a política no motor real a partir do JSON canônico + paths.
4. **Governança de mudança**: toda alteração aprovada arquiva o changelog (o que mudou, quem impactou, delta de indicadores).

## Cenários de teste simplificados (GATEs)

- `tests/policyDoc.test.js`:
  - **Números do documento ≡ motor**: gerar doc de uma fixture e conferir que os valores impressos batem com `runSimulation`/`computeIncrementalResult` (parse dos números do Markdown, comparação com tolerância de formatação `fmtPct`);
  - **Completude**: todo nó/regra/célula do IR aparece exatamente uma vez na seção de fluxo; paths achatados cobrem todos os terminais;
  - **Determinismo**: duas gerações consecutivas idênticas;
  - **Degradação**: sem AS IS ⇒ seção comparativa com aviso; sem coluna temporal/cenários ⇒ seções omitidas declaradamente;
  - **Privacidade**: com toggle de domínios desligado, nenhum valor de domínio aparece no texto.
- Diff/changelog: fixture A vs A' (1 célula mudada) ⇒ changelog lista exatamente essa mudança + delta de métricas correto.

## Sugestões técnicas (para a IA implementadora)

- **Worker**: `COMPUTE_POLICY_DOC {shapes, conns, canvases?, options}` →
  `POLICY_DOC_RESULT {docModel}` — o worker devolve um **modelo de documento**
  (árvore de seções com dados numéricos crus), e a renderização (Markdown/HTML) é
  feita na main por funções puras de template. Separar dados de apresentação torna o
  Nível 2 trivial (a IA recebe o docModel, não HTML) e o GATE mais robusto.
- **Renderers**: `renderDocMarkdown(docModel)` / `renderDocHTML(docModel)` — helpers
  globais puros (testáveis em jsdom); HTML com inline styles (ADR-002), abrindo em
  nova janela para `window.print()`.
- **Estado**: `docModal` (opções de composição — pode persistir as preferências no
  projeto seguindo a ⚠️ regra do CLAUDE.md); mapa opcional de rótulos amigáveis
  `varLabels: {[col]: label}` por dataset (persistir no `csvStore[csvId]`, coberto
  pelo contêiner existente).
- **Diff de IR**: função pura `diffPolicyIR(a, b)` → `{added, removed, changed}` por
  tipo de elemento; reusável pelo chat (Nível 3) e pelo Goal Seek (exibir movimentos).
- **SVG export**: serializar o `<svg>` do canvas (estilos já inline) com o viewBox do
  bounding box dos shapes — sem biblioteca.

## Reutilização de código e padrões existentes

| Necessidade | Já existe |
|---|---|
| KPIs e deltas | `simResult`, `computeIncrementalResult`/`incrementalResult` (rToA/aToR) |
| Funil por nó+valor | agregação do `exportDiagnosticCSV` (mover/compartilhar com o worker) |
| Volume/inad por aresta | `edgeStats` |
| N cenários lado a lado | pipeline 5B (`computeAnalyticsDataset`, `scenarios`) e padrão do `buildAnalyticsCSV` (BOM, RFC 4180) |
| Confiabilidade da inferência | `confiabVolume`, textos do `InferenceSignal` |
| Regras legíveis de lens | vocabulário do `lensModal`/`LENS_OPERATORS` |
| Estrutura da política | PolicyIR (Sessão 0), `buildFlowGraph` |
| Ordem de leitura do fluxo | camadas do `autoLayout` (longest-path/baricentro) |
| Formatadores | `fmtPct`, `fmtQty`, `fmtMetricVal`, `parseTemporalKey` |
| Metadados de build | constantes do `BuildBadge` |
| Download/save de arquivo | padrão do `saveProject` (File System Access + fallback `<a download>` com revoke atrasado) |

## Prompt da sessão

**Sessão 6 — DocGen local:**
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
