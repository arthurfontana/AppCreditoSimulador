# Documentação Automática (`docModal`, Copiloto Sessão 6)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer no
> `docModel`, nos renderers (`renderDocMarkdown`/`renderDocHTML`) ou no changelog
> estrutural (`diffPolicyIR`).

Gera, a partir da política viva (canvas + resultados de simulação), um documento
executivo/técnico com sumário, fluxo em linguagem natural templateada, regras achatadas,
funil por nó, comparação de cenários, confiabilidade amostral, glossário e changelog
estrutural — sem IA generativa (a documentação de uma estrutura formal é serialização +
templates, não geração criativa). Ver `docs/wiki/Copiloto-DocumentacaoAutomatica.md` e
`docs/wiki/Epicos-CopilotoIA.md` (DEC-IA-006).

## Separação dados/apresentação
`COMPUTE_POLICY_DOC` (worker) devolve um **docModel** — árvore de seções com dados
NUMÉRICOS CRUS, nunca prosa pronta. A apresentação (`renderDocMarkdown`/`renderDocHTML`,
`src/policyDocRender.js` — importados/re-exportados por `src/App.jsx`) é feita por funções
PURAS na main que só leem o docModel — separação que
torna o Nível 2 (reescrita em prosa por IA) trivial (a IA recebe o docModel, não HTML) e o
GATE mais robusto (determinismo/privacidade verificáveis só inspecionando string de saída).
`buildPolicyIR` só existe em `App.jsx` (Sessão 0) — a main monta o IR ANTES de disparar
`COMPUTE_POLICY_DOC` e ele viaja pronto no payload; o worker nunca importa `App.jsx` (mesmo
motivo de `buildFlowGraph`/`matchLensRule` estarem duplicados lá).

## `docModel`
```js
{
  version, generatedAt, options: {includeDomains},
  meta: {name, nodeCount, entryCount},
  ir,                          // PolicyIR pass-through (buildPolicyIR, construído na main)
  flowNodes,                   // 1 entrada por ir.nodes (bijeção — completude por construção)
  paths: {list, truncated},    // regras achatadas raiz→terminal (buildPolicyPaths)
  kpis: {simResult, incrementalResult},   // MESMO tick de edição (computeSimulationTick)
  funnel: {rows, totals},      // funil por nó+valor (computeFunnelByNode + redactFunnel)
  reliability: {minSample, lowSampleRows, hasLowSample},
  scenarios: null | {rows},    // AS IS + cenário atual + abas marcadas (5B) — null sem AS IS
  glossary,                    // variáveis referenciadas no IR + metadados de coluna
  changelog?,                  // só quando o usuário escolheu "comparar com" — ver abaixo
  compareKpis?,                // KPIs da política de comparação (worker) — insumo do changelog
}
```

## Contrato de Privacidade aplicado ao papel (`options.includeDomains`)
Domínios de valores (rótulos concretos: `R01`, `Digital`, chaves de célula do Cineminha,
`rule.value` do lens) são N2 (Contrato de Privacidade, DEC-IA-004) — só entram no
documento com o toggle ligado (desligado por padrão no `docModal`, já que o documento pode
circular fora do sistema). Nomes de coluna e CONTAGENS (N0/N1) aparecem sempre. A
redação acontece no worker, na montagem do docModel (não no renderer): `buildFlowNodes`
troca `values`/`rowDomain`/`colDomain`/`blockedCells`/`rule.value` por `null` (mantendo
`valueCount`/`totalCells`/`blockedCount`); `redactPathConditions` faz o mesmo nas condições
dos paths; `redactFunnel` AGREGA o funil por nó (perde a granularidade por valor, que é
domínio); `buildGlossary` só lê o dicionário do `csvStore` quando `includeDomains`. GATE:
`tests/policyDoc.test.js` varre o Markdown/HTML gerados por nenhum literal de domínio da
fixture.

## Regras achatadas (`buildPolicyPaths`)
DFS determinístico a partir de `ir.entry`, compondo as condições de cada nó no caminho:
decisão enumera TODAS as rotas (já achatadas pelo IR); Cineminha enumera OS DOIS ramos
(elegível/não elegível); lens segue a única saída. Ciclo (nó revisitado no mesmo caminho)
ou destino ausente/inexistente terminam o ramo com `terminal:null` + `reason` — nunca
lançam nem inventam um terminal. `maxPaths` (teto de segurança) sinaliza `truncated` em vez
de travar numa política patológica.

## Funil por nó+valor (`computeFunnelByNode`)
Mesma travessia/acumulação de `exportDiagnosticCSV` (`App.jsx`) reimplementada no worker
(que não importa `App.jsx`) — com uma diferença: `exportDiagnosticCSV` não tem um `case`
para `decision_lens` no walk (para no primeiro lens do caminho), o que nunca foi notado
porque o CSV de diagnóstico é sempre dominado por losangos/Cineminha em série;
`computeFunnelByNode` ATRAVESSA lens corretamente (mesma semântica de
`computeSimulationTick`/`runSimulation`: passa se a linha casa as regras, senão a linha não
é roteada por este fluxo) — necessário porque o docModel documenta políticas com Decision
Lens como raiz. `redactFunnel` agrega por nó quando os domínios estão desligados.

## Comparação de cenários (`computeScenarioComparison`)
Reaproveita o MESMO par de primitivas do pipeline 5B (`computeSimulatedDecisions` +
`computeIncrementalResult`) em vez do dataset largo colunar inteiro (que existe para pivot
de gráfico, não para uma tabela de poucas linhas): 1 overlay + 1 agregado por cenário
incluído (`buildAnalyticsCanvasInputs()`, mesma função do Dashboard). `baseline` (AS IS) é
o mesmo para todos os cenários — computado uma vez junto dos KPIs e reaproveitado. Sem AS
IS configurado em nenhum dataset, `scenarios` é `null` e o documento declara "Baseline AS
IS não configurada" (nunca omite a seção silenciosamente).

## Confiabilidade da amostra (`computeReliability`)
O épico documenta esta seção como um `InferenceSignal`/`confiabVolume` — sinalização que
dependia da **Tabela de Inferência de Referência, removida do produto** (ver bump de
schema 2.5). `computeReliability` mantém o ESPÍRITO da seção com o volume de altas já
presente no funil: sinaliza segmentos com menos de 30 altas (real ou inferida) — piso de
bom-senso estatístico para uma taxa não ser pura oscilação de amostra.

## Changelog estrutural (`diffPolicyIR`, `App.jsx`)
Função PURA que compara dois PolicyIR por `id` de nó — correto quando os dois IR vêm da
MESMA linhagem de canvas (edição in-place, comparação com outra aba do mesmo estudo: os
ids são estáveis). Comparar com um canvas clonado via `cloneCanvasWithNewIds` (ids todos
novos) degrada para "tudo removido + tudo adicionado" — limitação documentada, mesmo
padrão do "Limite documentado" do PolicyIR (ver `docs/claude/Copiloto-PolicyIR.md`). Retorna `{added, removed, changed,
entryChanged}` — `changed[].fields` lista só os campos que mudaram (`{key, before,
after}`). Reusável pelo chat (Nível 3) e pelo Goal Seek (exibir movimentos como "mudanças
de IR"), como sugerido no épico.

O CHANGELOG em si é montado na MAIN (não no worker): ao escolher "Comparar com" no
`docModal`, `runPolicyDoc` constrói `compareIr` (via `buildPolicyIR` sobre o outro canvas)
e envia `options.compare: {shapes, conns}` (só os dados, não o IR) — o worker roda o MESMO
`computeSimulationTick` sobre essa segunda política e devolve `compareKpis` no
`POLICY_DOC_RESULT`. O handler da main combina `diffPolicyIR(docModel.ir, compareIr)`
(estrutural, síncrono) com `compareKpis` (numérico, do worker) em `docModel.changelog` —
`diffPolicyIR` fica single-sourced em `App.jsx`, o worker só varre a base.

## Estado `docModal`
```js
null | {
  step: 'form' | 'loading' | 'result',
  includeDomains,       // toggle de privacidade (default false)
  compareCanvasId,      // id do canvas a comparar no changelog, ou null
  compareIr?, compareName?,  // guardados ao disparar, para o handler montar o changelog
  docModel?,             // devolvido por POLICY_DOC_RESULT
}
```
Efêmero, **não persistido** — mesmo padrão não-persistido de `goalSeekModal`/
`simplifyModal` (⚠️ regra do CLAUDE.md: não há nada CRIADO pelo usuário aqui, só uma
composição transitória de exibição).

## Ativação e exportação
Botão **📄 Documentar Política** na seção Fluxo do painel direito (`openDocModal`) abre o
formulário (toggle de domínios + seletor de comparação); **📄 Gerar Documento**
(`runPolicyDoc`) dispara `COMPUTE_POLICY_DOC`; o resultado mostra uma prévia (`<iframe
srcDoc>` do HTML renderizado) com **⬇ Markdown** (`downloadDocMarkdown`, padrão
`doExportPolicyIR`: Blob + `<a download>`) e **🖨 Imprimir / PDF** (`printDocHTML`: abre o
HTML numa nova janela e chama `window.print()` — o usuário salva como PDF pelo diálogo
nativo do navegador).

## Teste
`tests/policyDoc.test.js` — GATE: números do docModel ≡ `computeSimulationTick` (e o
renderer exibe os MESMOS tokens formatados, checagem literal de string); completude (todo
nó do IR aparece uma vez em `flowNodes`; paths cobrem exatamente os terminais alcançáveis a
partir das raízes); determinismo (duas gerações com a mesma entrada são idênticas, módulo
`generatedAt`); degradação (sem AS IS ⇒ aviso explícito no texto, nunca omissão
silenciosa); privacidade (toggle desligado ⇒ nenhum valor de domínio da fixture aparece no
Markdown/HTML — contraste positivo com o toggle ligado); changelog (`diffPolicyIR` entre
fixture A/A' com 1 célula de Cineminha mudada ⇒ exatamente essa mudança, delta de métricas
batendo com `computeSimulationTick` antes/depois, e o mesmo delta reproduzido via
`computePolicyDoc({..., options:{compare}})`).
