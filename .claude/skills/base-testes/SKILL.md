---
name: base-testes
description: Use SEMPRE que (a) criar ou ajustar uma funcionalidade da aplicação que mude o que a base de testes precisa cobrir (nova variável consumida, novo motor/copiloto, novo tipo de coluna do wizard, novo cenário estatístico, mudança de heurística que a base explora), (b) mexer em qualquer arquivo de docs/wiki/Dados_Teste/ (gerador, inventário, dicionário, matriz de cobertura, lógica estatística), ou (c) o usuário pedir para regenerar/evoluir a Base de Testes Oficial. Garante que docs + regras do gerador ficam em sincronia com a aplicação — e que o CSV versionado NUNCA é regenerado sem pedido explícito do usuário.
---

# Base de Testes Oficial — manutenção e evolução

A base `docs/wiki/Dados_Teste/Base_Teste_Oficial.csv` não é um CSV aleatório: é
amostrada de um **modelo causal sintético** ("verdade plantada") desenhado para
exercitar praticamente 100% das funcionalidades da aplicação com um único arquivo.
Cada coluna existe para alimentar funcionalidades específicas, e os motores
analíticos (Descoberta de Segmentos, Clusterização, Faixas por Risco) devem
conseguir **redescobrir** a estrutura plantada.

Esta skill é a versão acionável do contrato normativo em
`docs/wiki/Dados_Teste/README.md § Contrato de manutenção`.

## Regra número 1 — quem regenera o CSV é o usuário

**NUNCA regenere `Base_Teste_Oficial.csv` por conta própria.** O fluxo é
assíncrono de propósito:

- Sessões de feature mantêm **documentação + regras do gerador** em dia.
- O CSV versionado só é regenerado quando o **usuário pedir explicitamente**.
- Entre uma regeneração e outra, é esperado (e correto) que o gerador esteja
  "à frente" do CSV. Esse gap é registrado na seção **"Pendências de
  regeneração"** do `README.md` do diretório.

## Anatomia do diretório `docs/wiki/Dados_Teste/`

| Arquivo | Papel | Quando atualizar |
|---|---|---|
| `README.md` | Guia de importação, roteiro de demo, contrato de manutenção, pendências de regeneração | Nova pendência; mudança no fluxo de import/demo |
| `01-Inventario-Funcionalidades.md` | Toda funcionalidade da aplicação: o que faz + o que exige da base | **Toda feature nova/ajustada**, mesmo que a base atual já a cubra |
| `02-Dicionario-Colunas.md` | 24 colunas: tipo, valores, justificativa, consumidores | Coluna nova, valores novos, mudança de semântica |
| `03-Matriz-Cobertura.md` | Funcionalidade → colunas → cenário + lista honesta do que NÃO é coberto (com motivo) | Toda feature nova/ajustada (linha nova ou entrada em "não coberto") |
| `04-Logica-Estatistica.md` | A verdade plantada: modelo de risco, multiplicadores, segmentos, anomalias, números de referência da seed | **Antes** de mexer no gerador, se a verdade plantada mudar |
| `gerar_base_teste.mjs` | Gerador Node determinístico (o script manda; o doc 04 descreve) | Quando a cobertura pedir coluna/cenário/distribuição nova |
| `Base_Teste_Oficial.csv` | 20.000 linhas (~165 mil propostas), `;` + decimal `,` | **Só a pedido do usuário** |

## Checklist ao criar/ajustar uma feature (mesma sessão, nesta ordem)

1. **`01-Inventario-Funcionalidades.md`** — adicionar/ajustar a entrada
   (seção do domínio certo; convenção `[tipo]` = `COL_TYPES` do wizard).
2. **`02-Dicionario-Colunas.md`** — se precisar de coluna/valor/semântica nova.
3. **`03-Matriz-Cobertura.md`** — linha da matriz atualizada, OU entrada em
   "o que NÃO é coberto" com o motivo. Nunca deixe a matriz mentir por omissão.
4. **`04-Logica-Estatistica.md`** — se a verdade plantada mudar, documentar
   **antes** de tocar no gerador (o doc é o contrato; o script, a implementação).
5. **`gerar_base_teste.mjs`** — ajustar as regras do motor de geração
   respeitando os invariantes abaixo.
6. **Registrar a pendência** em `README.md § Pendências de regeneração`
   (uma linha: o que mudou no gerador e ainda não está no CSV versionado).
   Se a feature não exigiu mexer no gerador, não há pendência.

## Invariantes do gerador (quebrar qualquer um = bug)

- **Determinismo**: PRNG mulberry32, seed padrão `20260716`. Mesma seed ⇒ mesmo
  arquivo **byte a byte**. Cuidado com `Object.keys`/`Map` em ordem não
  determinística e com `toFixed`/locale na formatação.
- **Proporcionalidade por `--rows`**: a verdade plantada (shares de segmentos,
  multiplicadores, taxas) deve valer em qualquer volume — 20k, 200k, 1M linhas.
  Nunca hardcode contagens absolutas; use frações do total.
- **Formato do wizard**: delimitador `;`, decimal `,`, cabeçalho, UTF-8 sem BOM.
  Nomes de métricas devem casar os regexes de `suggestMetricColumns`
  (`QTD_PROPOSTA`, `QTD_ALTAS`, `QTD_ATRS_OVER_30`, `QTD_INFER_CONV`,
  `QTD_INFER_FL_ATRS`).
- **Estrutura sumarizada**: 1 linha = 1 micro-grupo de propostas com o mesmo
  perfil, ponderado por `QTD_PROPOSTA` (padrão da `Amostra_Fake.csv`).
- **Não versionar bases grandes**: `--rows` acima do padrão sai para fora do
  repo (ex.: `/tmp`).

## Verdade plantada — o que já existe (não destruir ao evoluir)

Cenários que os motores devem continuar redescobrindo (detalhe e números de
referência em `04-Logica-Estatistica.md`):

- **Gradiente de risco monotônico** por `SCORE_INTERNO` R01→R10 (inad. real
  ~1,4% → ~15%) — alimenta otimizadores/Pareto/Johnny.
- **Segmento reprovado de baixo risco**: `PORTE_EMPRESA=MEI & CANAL=DIGITAL`
  em R07/R08 (~1,8% das linhas, inad. inferida ~4,4% vs ~11% do bloco).
- **Segmento aprovado de alto risco**: `SETOR=CONSTRUCAO & REGIAO=NORTE`
  (inad. inferida ~21% vs ~5,4% global).
- **Anomalias**: `UF=AC` (risco ×4, volume pequeno — sofre shrinkage) e safra
  `202509` (degrau ×1,45 — visível no Dashboard, quebra achado espúrio).
- **Risco monotônico** em `TEMPO_ATIVIDADE_MESES` e **em "U"** em
  `FATURAMENTO_MENSAL` (o toggle de monotonia das Faixas por Risco só acha o
  ótimo desligado — cenário desenhado).
- **3 macro-clusters separáveis** (porte/score/risco) com sobreposição parcial.
- **Cardinalidade**: baixa (<256, Uint8) e alta (`CODIGO_VENDEDOR` 350, Uint16;
  `UF` 27 — prova o teto de 10 ports do losango).
- **Sujeira proposital**: nulos (~1–3% em 3 colunas), outliers (0,3% ×20),
  `PENDENTE` (~2%) no AS IS, erro proposital de heurística em
  `CODIGO_VENDEDOR` (sugerido ordinal, é categórica), variáveis irrelevantes
  (`DIA_SEMANA`) para FDR.

Ao adicionar cenário novo, verifique que ele não colide com esses (ex.: um novo
segmento plantado dentro de MEI+DIGITAL contaminaria o teste da Descoberta).

## Quando o usuário pedir a regeneração

1. `node docs/wiki/Dados_Teste/gerar_base_teste.mjs` (seed fixa; escreve o CSV
   no lugar). O stdout imprime os números de verificação (monotonia por score,
   segmentos plantados, nulos, distintos) — confira contra o esperado.
2. Atualizar os **números de referência** de `04-Logica-Estatistica.md` e do
   `README.md`/`03-Matriz-Cobertura.md` que tiverem mudado.
3. **Limpar as entradas atendidas** de `README.md § Pendências de regeneração`
   (voltar a "_Nenhuma_" se tudo foi absorvido).
4. Validar a importação: os passos do `README.md § Como importar` continuam
   valendo? (métricas auto-sugeridas, erro proposital do `CODIGO_VENDEDOR`,
   mapeamento AS IS com `PENDENTE`).
5. Se só documentação/comentários mudaram desde a última regeneração, uma
   checagem barata é gerar para um caminho temporário e comparar com `cmp` —
   byte-idêntico prova que não há pendência real.

## Onde ler mais

Contrato normativo completo: `docs/wiki/Dados_Teste/README.md § Contrato de
manutenção`. Ponteiro no `CLAUDE.md` (tabela "Onde vive o quê"). O inventário
`01` também serve como mapa reverso: dado um motor, quais exigências ele impõe
à base.
