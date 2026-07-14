---
name: persistencia-projeto
description: Use SEMPRE que adicionar ou alterar um estado que representa algo criado/configurado pelo usuário (nova aba/canvas, novo tipo de shape e seus campos, nova biblioteca, novo painel/config do Dashboard, nova preferência de visualização, novo modal de configuração persistente, novo campo em csvStore[csvId], etc.) em src/App.jsx. Garante que o estado é salvo em buildProjectPayload()/restaurado em loadProject() — senão ele se perde ao salvar/abrir o Projeto (.credito.json).
---

# Persistência do Projeto — regra inviolável

Toda vez que você adicionar um estado novo que representa algo criado ou
configurado pelo usuário, ele **precisa** entrar no salvamento do Projeto —
senão se perde ao salvar/abrir. Esta regra é inviolável (persistida na
íntegra em `CLAUDE.md`; esta skill é o mesmo checklist em formato acionável).

## Quando esta skill se aplica

Exemplos do que conta como "estado criado/configurado pelo usuário":
nova aba/canvas · novo tipo de shape e seus campos · nova biblioteca ·
novo painel/config do Dashboard · nova preferência de visualização ·
novo modal de configuração persistente · novo campo em `csvStore[csvId]`
(ex.: `asIsConfig`, `clusterDefs`) · qualquer novo `useState` de topo que
represente configuração/trabalho do usuário.

**Não** se aplica a estado transitório de UI (hover, drag em andamento,
seleção temporária) que não precisa sobreviver a um save/load.

## Checklist (siga nesta ordem)

1. **Incluir no `buildProjectPayload()`** (em `src/App.jsx`) o novo campo —
   OU garantir que ele já viaja dentro de um contêiner já salvo:
   - um novo campo de um `shape` já é coberto por `canvases`;
   - um novo campo de `csvStore[csvId]` já é coberto por `csvStore`.
   Só precisa de entrada própria um estado que vive **fora** desses
   contêineres (um novo `useState` de topo, ex.: `businessWidget`,
   `computeSidecar`).

2. **Restaurar em `loadProject(data)`** com default defensivo:
   `Array.isArray(...) ? ... : []`, `typeof x === '...' ? ... : default`.
   Arquivos antigos (sem o campo novo) não podem quebrar nem zerar o resto
   do projeto — cada seção deve ter fallback independente.

3. **Bump do `schemaVersion`** se a mudança for estrutural (ex.: `2.1` →
   `2.2`). Versão atual: ver `buildProjectPayload()` em `src/App.jsx`
   (era `"2.6"` na Variável de Cluster — novo campo
   `csvStore[csvId].clusterDefs`, já coberto pelo contêiner `csvStore`).
   Um novo campo dentro de um contêiner já salvo pode ou não justificar
   bump — julgue pelo impacto em compatibilidade com arquivos antigos.

4. **Serialização dedicada para tipos não-JSON.** Se o estado for um
   `Map`/`Set`/typed array (`Float64Array`/`Int32Array`), o `JSON.stringify`
   nativo não serve. Siga o padrão de `serializeCsvStore`/`deserializeCsvStore`
   (`src/columnar.js`): typed arrays → **base64 dos bytes crus** (não array
   plano de números boxed). `deserializeCsvStore` deve aceitar os formatos
   antigos também (migração transparente na carga). Cubra o round-trip
   (serialize → deserialize) em teste — ver `tests/columnar.test.js`.

5. **Auto-persistência de sessão**, se o estado também deve sobreviver a um
   reload **dentro da mesma sessão** do navegador (não só ao salvar/abrir
   arquivo explicitamente): adicionar a uma chave de `sessionStorage`
   (padrão `aw_canvases_v1`, `aw_layout_v1`, `aw_groupings_v1`,
   `aw_page_filters_v1` — ver `docs/claude/Persistencia-Projeto.md`).
   `csvStore` e `cinemaLibrary` são grandes demais para `sessionStorage` e
   ficam só no save/load explícito. Init/gravação devem ser defensivos
   (`try/catch`) — quota estourada ou JSON inválido nunca podem quebrar o boot.

## Checklist do que hoje é salvo (referência rápida)

Canvas e todos os shapes/conns de **todas** as abas (losangos, Cineminhas,
Decision Lens e suas `rules`, frames, terminais, painéis) ·
`includeInDashboard`/nome por aba · bases de dados completas (`csvStore`:
headers, rows, columnTypes, varTypes, `asIsConfig`, `clusterDefs`) ·
Dashboard (`analyticsLayout`, `analyticsGroupings`, `analyticsPageFilters`) ·
biblioteca de Cineminhas (`cinemaLibrary`) · biblioteca de Políticas
(`policyLibrary`) · widget de negócio · preferências de aresta/espessura +
Motor Python (`computeSidecar {enabled, url, token}`) · viewport · aba ativa ·
painel colapsado.

Se o que você está adicionando não está nesta lista, é um sinal de que o
checklist acima ainda não foi aplicado — pare e aplique antes de considerar
a feature completa.

## Onde ler mais

`docs/claude/Persistencia-Projeto.md` tem o detalhe mecânico completo
(`buildProjectPayload`/`saveProject`/`loadProject`/`buildProjectJSONChunks`,
streaming via File System Access API, formatos legados aceitos na carga,
painel colapsável). A regra em si (o "porquê" inviolável) mora na íntegra
em `CLAUDE.md`.
