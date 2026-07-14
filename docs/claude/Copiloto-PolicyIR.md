# PolicyIR — JSON canônico da política (Copiloto Sessão 0, DEC-IA-002)

> Ponteiro a partir de: `CLAUDE.md` § "Onde vive o quê". Leia antes de mexer em
> `buildPolicyIR`/`applyPolicyPatch` ou em qualquer feature do Copiloto que
> consome/produz PolicyIR (templates, Goal Seek, documentação).

Representação canônica da política de crédito — a *lingua franca* do épico do
Copiloto (`docs/wiki/Epicos-CopilotoIA.md`): templates, sugestões, Goal Seek,
documentação e trocas com IA leem/escrevem PolicyIR. `shapes`/`conns` seguem sendo a
fonte de verdade do canvas; o IR é **derivado** e patches de IR são materializados de
volta por um **único aplicador**. Ambos são helpers globais exportados de `src/App.jsx`.

- **`buildPolicyIR(shapes, conns, csvStore, opts?)`** → IR:
  ```js
  {
    kind: "policy-ir", version: "1.0", name, generatedAt,
    datasets: [{ csvId, name, columns: [{name, colType, varType, domainSize}] }], // metadados, SEM dados
    nodes: [  // na ordem de `shapes` (preserva a eleição de raiz do motor)
      { id, kind:'decision', label, variable:{col,csvId}, routes:[{values:[...], to}] },
      { id, kind:'cinema',   label, cinemaType, rowVar, colVar, rowDomain, colDomain,
        blockedCells:[...],  // SÓ as caselas não elegíveis, ordenadas (roteamento)
        routes:{eligible, notEligible} },
      { id, kind:'lens',     label, rules:[{col,operator,value,logic}], to },
      { id, kind:'terminal', label, terminal:'approved'|'rejected'|'as_is' },
    ],
    entry: [nodeId...],  // raízes — mesmo critério do motor (sem aresta de entrada vinda de port)
  }
  ```
  Regras: **sem perda de roteamento** (GATE), **JSON puro** (serializável/versionável),
  **sem posições x/y e sem dados linha a linha**. O achatamento resolve cadeias de
  ports (`decision→port→destino` vira `{values, to}`, com o mesmo trim/first-wins do
  motor); rota sem destino → `to: null` (linha morre, como port sem saída). Grades
  numéricas de casela (`setCinemaCellValue`) não entram — só elegibilidade
  (`isCellEligible` → `blockedCells`).
- **`applyPolicyPatch(patch, base = {shapes:[], conns:[]})`** → `{shapes, conns, idMap}`:
  materializa um IR (completo ou parcial `{nodes}`) **anexando** ao canvas base, sem
  mutá-lo. IDs novos via contador `_id` (`uid()`); `idMap` traduz id do IR → id criado;
  rota cujo `to` não está no patch resolve contra `base.shapes` (patch pode conectar a
  nós existentes). Recria ports no idioma padrão do canvas, marca `cellsUserEdited=true`
  no Cineminha (bloqueia a prévia AS IS) e posiciona por camadas simples (longest-path)
  — o usuário pode usar ⊹ Reorganizar.
- **Export**: 3ª opção do modal **Exportar Fluxo** (seção Fluxo) — "JSON Canônico da
  Política" (`doExportPolicyIR`, arquivo `politica_canonica_YYYY-MM-DD.policy.json`).
- **GATE `tests/policyIR.test.js`**: sobre as fixtures do `compiledEngine.test.js`,
  (1) roteamento via IR ≡ motor compilado M8 — agregados do tick, incremental,
  `nodeArrivals` via `idMap` e decisão simulada **por linha**; (2) round-trip
  IR→canvas→IR estável (igualdade estrutural módulo renomeação de IDs); (3) IR sem
  chaves de layout/dados e com estrutura canônica exata; (4) patch parcial sobre
  canvas existente sem colisão de IDs.
- **Limite documentado**: aresta rotulada de losango **direto** para outro nó de fluxo
  (sem port, fora do idioma da UI) volta materializada **com** port — preserva o
  caminho da linha, mas pode mudar qual nó o motor elege como raiz.
