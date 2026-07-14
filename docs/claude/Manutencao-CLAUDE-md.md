# Manutenção do CLAUDE.md — contrato de tamanho (Sessão C5)

> Origem: `docs/wiki/Contexto-Claude.md`, Sessão C5. Este arquivo é o "lar" de
> domínio da regra citada em 1 linha no CLAUDE.md — não duplicar o diagnóstico
> completo aqui, só o contrato operacional.

## Regra

O CLAUDE.md é um **índice enxuto**, carregado inteiro em toda sessão. Nova feature
documenta no arquivo de domínio (`docs/claude/*.md` ou `docs/wiki/*.md`); no
CLAUDE.md entra **no máximo 1 linha** no mapa de ponteiros ("Onde vive o quê"). O
CLAUDE.md **não pode passar de ~450 linhas**.

## Fallback — quando o limite é atingido (ou seria estourado)

O contrato existe para o caso em que uma sessão precisa adicionar conteúdo e o
CLAUDE.md já está no teto. As duas saídas ingênuas — travar a sessão, ou deixar
passar do limite — perdem informação ou disciplina. O contrato certo:

1. **Nunca apagar para caber.** O teto de linhas rege o que fica no índice, não o
   que existe. Informação só sai do CLAUDE.md quando já tem um lar em
   `docs/claude/` ou `docs/wiki/` com o ponteiro correspondente.
2. **Poda antes de escrever.** Se adicionar a linha nova estouraria 450, a sessão
   que estourou varre o CLAUDE.md atual procurando qualquer trecho que regrediu de
   "ponteiro" (1–3 linhas) para "detalhe" (parágrafo duplicando conteúdo que já
   vive — ou deveria viver — em `docs/claude/`), move esse trecho para o arquivo
   de domínio certo (criando-o se não existir) e deixa o ponteiro de 1 linha no
   lugar — mesmo padrão da Sessão C1. Só então adiciona a linha nova.
3. **Spillover controlado, se a poda não abrir espaço.** Se o índice já está
   genuinamente enxuto (sem gordura para tirar), cria/atualiza
   `docs/claude/Onde-Vive-O-Que.md` com a tabela completa de ponteiros e resume, no
   CLAUDE.md, a seção "Onde vive o quê" para um link único a esse arquivo. Nunca
   silencioso — o CLAUDE.md sempre deixa 1 linha dizendo onde está o mapa completo.
4. **Poda/spillover é só documentação.** Nunca é motivo para pular `npm test` nem
   para mexer em código de produto.

## Guard mecânico

`npm run check:claude-md` (script `scripts/check-claude-md.js`) conta as linhas do
CLAUDE.md e falha (`exit 1`) se passar de 450. Rodado como step do workflow
`.github/workflows/build-release.yml` (push em `main`), logo após `npm ci` — pega o
estouro mecanicamente, sem depender de disciplina de prompt. Para checar localmente
antes de commitar: `npm run check:claude-md`.
