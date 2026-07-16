# Base de Testes Oficial — AppCreditoSimulador

Base de dados sintética projetada para exercitar **praticamente 100% das funcionalidades**
da aplicação com um único arquivo CSV. Não é um CSV aleatório: cada coluna existe para
alimentar funcionalidades específicas, e a base carrega **estrutura estatística plantada**
(correlações reais, clusters separáveis, segmentos desalinhados da política, anomalias,
nulos, outliers) que os motores analíticos devem conseguir redescobrir.

## Arquivos deste diretório

| Arquivo | Conteúdo |
|---|---|
| `Base_Teste_Oficial.csv` | A base (20.000 linhas sumarizadas, ~165 mil propostas) — pronta para importar |
| `gerar_base_teste.mjs` | Gerador determinístico (Node, seedado) — regenera a base e versões maiores |
| `01-Inventario-Funcionalidades.md` | Inventário completo das funcionalidades encontradas na análise do código |
| `02-Dicionario-Colunas.md` | Dicionário de dados: cada coluna, tipo, valores, justificativa e quem a consome |
| `03-Matriz-Cobertura.md` | Matriz Funcionalidade → Colunas → Cenários + lista do que NÃO é coberto e por quê |
| `04-Logica-Estatistica.md` | A "verdade plantada": modelo de risco, correlações, segmentos, anomalias, seeds |

## Como importar (2 minutos)

1. Abra a aplicação e importe `Base_Teste_Oficial.csv`.
2. **Passo 1 (Delimitador)**: `;` e decimal `,` são detectados automaticamente (mesmo formato
   da `Amostra_Fake.csv`). Cabeçalho: sim.
3. **Passo 2 (Classificar colunas)**: as 5 colunas de métrica são sugeridas automaticamente
   (`QTD_PROPOSTA` → Vol. Propostas, `QTD_ALTAS` → Altas Reais, `QTD_ATRS_OVER_30` → Inad. Real,
   `QTD_INFER_CONV` → Conv. Inferida, `QTD_INFER_FL_ATRS` → Inad. Inferida — validado contra os
   regexes de `suggestMetricColumns`). Ajustes manuais recomendados:
   - `ID_LINHA` → 🔑 ID
   - `SAFRA` → ⏱ Data/Tempo (temporal)
   - `MIX_RISCO` → 🎨 Mix de Risco (habilita a distribuição de mix no Johnny)
   - `CODIGO_VENDEDOR` → corrigir o Tipo Var. para **Categórica** (a heurística sugere ordinal
     pelo padrão `V###` — deixado assim de propósito, para testar a correção manual do wizard)
   - Demais colunas → 🔀 Filtro (default)
4. **Passo 3 (AS IS)**: coluna `DECISAO_ANALISE`, mapeamento
   `APROVADO → ✅ Aprovado`, `REPROVADO → ❌ Reprovado`, `PENDENTE → — Ignorar`.

## Roteiro de demonstração sugerido (redescobrindo a verdade plantada)

1. **Política inicial**: arraste `SCORE_INTERNO` ao canvas (losango de 10 portas), roteie
   R01–R06 → ✅, R08–R10 → ❌, R07 → um Cineminha `SCORE_INTERNO × PORTE_EMPRESA`.
2. **Descoberta de Segmentos**: deve encontrar `PORTE_EMPRESA=MEI & CANAL=DIGITAL` (scores
   R07/R08) como **reprovado de baixo risco** (inad. inferida ~4,4% vs ~5,4% global e ~11%
   do bloco R07/R08) e `SETOR=CONSTRUCAO & REGIAO=NORTE` como **aprovado de alto risco**
   (~21% de inad. inferida). `UF=AC` e a safra `202509` aparecem como **anomalias**.
3. **Criar Faixas por Risco**: `TEMPO_ATIVIDADE_MESES` produz faixas **monotônicas**
   (risco cai com a idade da empresa); `FATURAMENTO_MENSAL` tem risco em **"U"** — o toggle
   de monotonia ligado não acha o corte ótimo, desligado acha (cenário desenhado para isso).
4. **Clusterização**: dims `PORTE_EMPRESA + SCORE_INTERNO` (ou `+ SETOR`) separam os grupos
   plantados (pequenas/score bom/risco baixo ↔ grandes/score ruim/risco alto).
5. **Dashboard**: eixo temporal por `SAFRA` (o degrau de 202509 é visível), agrupamento de
   `UF`/`CODIGO_VENDEDOR` em faixas, filtros, KPIs A/B vs AS IS.
6. **Goal Seek / Otimizadores / Simplificação / Documentação**: operam sobre a política
   montada — a base fornece o gradiente de risco e o AS IS de que eles precisam.

## Versões maiores (performance)

O CSV entregue tem 20.000 linhas (~2,7 MB) — roda solto no browser e não pesa o repositório.
Para testes de performance (pool de workers H3, clamps do browser, Motor Python/sidecar):

```bash
node docs/wiki/Dados_Teste/gerar_base_teste.mjs --rows 200000 --out /tmp/Base_Teste_200k.csv
node docs/wiki/Dados_Teste/gerar_base_teste.mjs --rows 1000000 --out /tmp/Base_Teste_1M.csv
```

Mesma estrutura estatística em qualquer volume (a verdade plantada é proporcional).
**Não versionar** os arquivos grandes.

## Regeneração

```bash
node docs/wiki/Dados_Teste/gerar_base_teste.mjs   # regenera byte a byte (seed fixa 20260716)
```

Se alterar o gerador, mantenha `04-Logica-Estatistica.md` em sincronia e regenere o CSV.
