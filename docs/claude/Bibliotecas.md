# Bibliotecas (Cineminha e Políticas)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer em
> `cinemaLibrary` ou `policyLibrary`.

## Biblioteca de Cineminha (`cinemaLibrary`)

- Estado local (array) persistido em `localStorage` implicitamente (futuro)
- Cada entrada: `{id, name, description, tags, cinemaType, rowDomain, colDomain, cells, metadata, savedAt}`
- **Salvar**: toolbar contextual do Cineminha → "Salvar na Biblioteca"
- **Aplicar**: modal da biblioteca → selecionar entrada → modal de mapeamento de variáveis (`cinemaImportModal`) → aplica `cells` com remapeamento de domínio
- **Export/Import**: JSON e CSV de lote via `cinemaLibraryModal`

## Biblioteca de Políticas (`policyLibrary`, Copiloto Sessão 2)

Generalização do padrão do `cinemaLibrary` para políticas inteiras: salva o **PolicyIR**
(Copiloto Sessão 0 — nós/rotas/regras, sem posições nem dados linha a linha) + metadados,
em vez do canvas com posições. Ver `docs/wiki/Copiloto-ConstrucaoAssistida.md` (Sessão 2)
e `docs/claude/Copiloto-PolicyIR.md`.

- **Estado**: `policyLibrary: array` de `{id, name, description, tags, ir: PolicyIR, requiredVars, savedAt}`, persistido no `.credito.json` (`buildProjectPayload`/`loadProject`, schema **`"2.4"`**). `policyLibraryModal` (`null | {mode:'browse'|'save', search, saveMeta, overwriteId}`) e `policyApplyModal` (`null | {itemId, name, ir, requiredVars, mapping}`) são efêmeros (UI), não persistem.
- **`extractPolicyRequiredVars(ir)`** (helper global exportado): lista, uma vez por **nome distinto** de coluna referenciada no IR, `{col, csvId, csvName, kind}` — `kind:'decision'` para variável de losango/eixo de Cineminha (precisa ser coluna tipada como Filtro no dataset-alvo), `kind:'any'` para coluna de regra de Decision Lens (casa por nome contra qualquer coluna carregada, de qualquer tipo — mesma semântica de `rowMatchesLensRules`, sem `csvId` próprio). Mesmo nome nos dois papéis → prevalece `'decision'`.
- **`applyPolicyVarMapping(ir, mapping)`** (helper global exportado, puro): materializa `mapping: {[origCol]: {col,csvId}|null}` de volta no IR, reescrevendo `variable`/`rowVar`/`colVar`/`rules[].col` — **antes** de chamar o único aplicador da DEC-IA-002 (`applyPolicyPatch`), nunca um segundo caminho de materialização. Variável sem mapeamento (ausente ou `null`) vira `null`: o nó nasce **sem** variável — pendência visível, não erro nem aplicação parcial silenciosa de outra coluna. Como o nó fica sem tráfego (0 chegadas em todos os ports), o lint do Copiloto Sessão 1 (`zero_arrival`) já sinaliza isso automaticamente no painel — reaproveitado, não reinventado.
- **Salvar**: seção Fluxo → botão **📚 Políticas** → **💾 Salvar atual** (`savePolicyToLibrary`) — roda `buildPolicyIR` sobre o canvas ativo + `extractPolicyRequiredVars`.
- **Aplicar**: item da biblioteca → **▶ Aplicar** (`openPolicyApplyModal`) abre o modal de mapeamento (padrão `cinemaImportModal`): auto-match por `normalizeColName` contra as colunas do dataset atual (filtradas por `kind`), pendência (⚠) visível por variável não casada. **Aplicar** (`applyPolicyTemplate`) roda `applyPolicyVarMapping` → `applyPolicyPatch` (com `pushHistory()`), anexando ao canvas ativo; mostra aviso (`importWarn`) listando variáveis pendentes, se houver. O posicionamento em camadas do `applyPolicyPatch` já deixa o canvas legível — não dispara `autoLayout()` automaticamente (o usuário pode usar ⊹ Reorganizar).
- **Export/Import**: JSON da biblioteca inteira (`{schemaVersion, kind:'policy-library', items}`) via `exportPolicyLibrary`/`onPolicyLibFileChange` — itens importados recebem IDs novos (sem colisão).
- **Teste**: `tests/policyTemplates.test.js` — salvar → aplicar em base com colunas **renomeadas** via mapeamento → roteamento equivalente (agregados + decisão por linha); variável sem mapeamento → pendência (nó sem variável), nunca erro.
