#!/usr/bin/env node
/**
 * Gerador da Base de Testes Oficial do AppCreditoSimulador.
 *
 * Gera um CSV sumarizado (1 linha = 1 micro-grupo de propostas) compatível com o
 * wizard de importação (delimitador `;`, decimal `,`, cabeçalho, UTF-8 sem BOM),
 * com estrutura estatística PLANTADA para exercitar todos os motores da aplicação:
 * correlações reais, clusters separáveis, segmentos desalinhados da política AS IS,
 * anomalias, nulos, outliers, alta/baixa cardinalidade e variáveis irrelevantes.
 *
 * Uso:
 *   node docs/wiki/Dados_Teste/gerar_base_teste.mjs                 # 20.000 linhas (padrão)
 *   node docs/wiki/Dados_Teste/gerar_base_teste.mjs --rows 100000   # versão de performance
 *   node docs/wiki/Dados_Teste/gerar_base_teste.mjs --out caminho.csv --seed 123
 *
 * Determinístico: mesma seed ⇒ mesmo arquivo, byte a byte.
 * A "verdade plantada" (multiplicadores, segmentos, anomalias) está documentada em
 * docs/wiki/Dados_Teste/04-Logica-Estatistica.md — mantenha os dois em sincronia.
 *
 * CONTRATO DE MANUTENÇÃO (ver README.md § Contrato de manutenção): toda funcionalidade
 * nova/ajustada na aplicação que mude o que a base precisa cobrir exige atualizar as
 * regras deste gerador + os docs 01–04 na mesma sessão. NÃO regenerar o CSV versionado
 * automaticamente — a regeneração é decisão do usuário (registrar o gap na seção
 * "Pendências de regeneração" do README).
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : def;
}
const N_ROWS = parseInt(argVal('--rows', '20000'), 10);
const SEED = parseInt(argVal('--seed', '20260716'), 10);
const OUT = argVal('--out', join(dirname(fileURLToPath(import.meta.url)), 'Base_Teste_Oficial.csv'));

// ── PRNG determinístico (mulberry32) ────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const randIn = (lo, hi) => lo + rand() * (hi - lo);
function normal(mean = 0, sd = 1) { // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function weighted(pairs) { // [[valor, peso], ...]
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rand() * total;
  for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
  return pairs[pairs.length - 1][0];
}
function binomial(n, p) {
  let k = 0;
  for (let i = 0; i < n; i++) if (rand() < p) k++;
  return k;
}
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ── Domínios ────────────────────────────────────────────────────────────────
const SAFRAS = Array.from({ length: 12 }, (_, i) => String(202501 + i)); // 202501..202512
const PORTES = [['MEI', 30], ['MICRO', 25], ['PEQUENA', 22], ['MEDIA', 15], ['GRANDE', 8]];
const SETORES = [
  ['COMERCIO', 28], ['SERVICOS', 26], ['INDUSTRIA', 12], ['CONSTRUCAO', 10],
  ['AGRO', 8], ['TECNOLOGIA', 8], ['SAUDE', 7.6], ['MINERACAO', 0.4], // MINERACAO = categoria rara (~0,4%)
];
const REGIOES = [['SUDESTE', 45], ['NORDESTE', 20], ['SUL', 15], ['CENTRO-OESTE', 10], ['NORTE', 10]];
const UFS_POR_REGIAO = {
  SUDESTE: [['SP', 55], ['MG', 22], ['RJ', 18], ['ES', 5]],
  NORDESTE: [['BA', 28], ['PE', 20], ['CE', 18], ['MA', 8], ['RN', 7], ['PB', 7], ['AL', 5], ['SE', 4], ['PI', 3]],
  SUL: [['PR', 38], ['RS', 36], ['SC', 26]],
  'CENTRO-OESTE': [['GO', 40], ['MT', 25], ['MS', 20], ['DF', 15]],
  NORTE: [['PA', 33], ['AM', 25], ['RO', 12], ['TO', 12], ['AC', 8], ['AP', 6], ['RR', 4]],
};
const CANAIS = [['DIGITAL', 40], ['LOJA', 28], ['PARCEIRO', 20], ['TELEVENDAS', 12]];
const PRODUTOS = [['CARTAO', 45], ['CAPITAL_GIRO', 35], ['FINANCIAMENTO', 20]];
const DIAS = [['SEG', 18], ['TER', 18], ['QUA', 17], ['QUI', 17], ['SEX', 16], ['SAB', 9], ['DOM', 5]];

// Distribuição de score por porte (estrutura de clusters: porte pequeno = score bom,
// porte grande = score ruim — grupos separáveis para k-means / descoberta)
const SCORE_MEAN_BY_PORTE = { MEI: 3.1, MICRO: 3.6, PEQUENA: 5.0, MEDIA: 6.3, GRANDE: 7.6 };

// Faturamento mensal mediano por porte (lognormal, cauda pesada)
const FAT_MEDIAN_BY_PORTE = { MEI: 8000, MICRO: 25000, PEQUENA: 90000, MEDIA: 400000, GRANDE: 2500000 };
const FAT_SETOR_MULT = {
  COMERCIO: 1.0, SERVICOS: 0.9, INDUSTRIA: 1.25, CONSTRUCAO: 1.1,
  AGRO: 1.2, TECNOLOGIA: 1.1, SAUDE: 0.95, MINERACAO: 1.6,
};

// Multiplicadores de risco (verdade plantada — ver 04-Logica-Estatistica.md)
const RISCO_SETOR = {
  COMERCIO: 1.0, SERVICOS: 1.0, INDUSTRIA: 1.05, CONSTRUCAO: 1.5,
  AGRO: 1.2, TECNOLOGIA: 0.85, SAUDE: 0.9, MINERACAO: 1.3,
};
const RISCO_REGIAO = { SUDESTE: 1.0, NORDESTE: 1.05, SUL: 0.92, 'CENTRO-OESTE': 1.0, NORTE: 1.1 }; // relação fraca
const RISCO_CANAL = { DIGITAL: 1.0, LOJA: 0.95, PARCEIRO: 1.15, TELEVENDAS: 1.05 };

// Vendedores: 350 códigos, 30 "pesados" concentram ~50% do volume (alta cardinalidade > 256 ⇒ dict Uint16)
const VENDEDORES_PESADOS = Array.from({ length: 30 }, (_, i) => `V${String(i + 1).padStart(3, '0')}`);
const VENDEDORES_CAUDA = Array.from({ length: 320 }, (_, i) => `V${String(i + 31).padStart(3, '0')}`);

// ── Formatação pt-BR ────────────────────────────────────────────────────────
const dec = (x, places = 6) => x.toFixed(places).replace('.', ','); // vírgula decimal
const dec2 = (x) => x.toFixed(2).replace('.', ',');

// ── Geração de uma linha ────────────────────────────────────────────────────
function makeRow(i) {
  // Dimensões básicas
  const safra = weighted(SAFRAS.map((s, k) => [s, 1 + k * 0.05])); // leve crescimento ao longo do ano
  const regiao = weighted(REGIOES);
  const uf = weighted(UFS_POR_REGIAO[regiao]);
  const porte = weighted(PORTES);
  const setor = weighted(SETORES);
  const canal = weighted(CANAIS);
  const produto = weighted(PRODUTOS);
  const dia = weighted(DIAS); // irrelevante por construção (IV ≈ 0)
  const vendedor = rand() < 0.5
    ? VENDEDORES_PESADOS[Math.floor(rand() * VENDEDORES_PESADOS.length)]
    : VENDEDORES_CAUDA[Math.floor(rand() * VENDEDORES_CAUDA.length)];

  // Score interno R01..R10 correlacionado com o porte (clusters separáveis).
  // Reforço do segmento plantado 1: 12% das MEI+DIGITAL recebem score R07/R08 à força,
  // para o segmento ter massa suficiente (~1,5% da base) e passar o gate de volume
  // mínimo da Descoberta de Segmentos.
  let scoreIdx = clamp(Math.round(normal(SCORE_MEAN_BY_PORTE[porte], 1.8)), 1, 10);
  if (porte === 'MEI' && canal === 'DIGITAL' && rand() < 0.12) scoreIdx = rand() < 0.6 ? 7 : 8;
  const score = `R${String(scoreIdx).padStart(2, '0')}`;

  // Faixa bureau B1..B5 fortemente correlacionada com o score (multicolinearidade)
  let bureauIdx = Math.ceil(scoreIdx / 2);
  if (rand() < 0.2) bureauIdx = clamp(bureauIdx + (rand() < 0.5 ? -1 : 1), 1, 5);
  const bureau = `B${bureauIdx}`;

  // Mix de risco derivado do score com 10% de ruído
  let mix = scoreIdx <= 3 ? 'BAIXO' : scoreIdx <= 6 ? 'MEDIO' : 'ALTO';
  if (rand() < 0.1) mix = weighted([['BAIXO', 1], ['MEDIO', 1], ['ALTO', 1]]);

  // Flag restritivo: probabilidade cresce com o score; ~3% nulos
  const flagNull = rand() < 0.03;
  const restritivo = flagNull ? '' : (rand() < 0.02 + 0.025 * scoreIdx ? 'SIM' : 'NAO');

  // Tempo de atividade (meses): empresas maiores são mais antigas; ~1% nulos
  const tempoNull = rand() < 0.01;
  const tempoMedio = { MEI: 30, MICRO: 48, PEQUENA: 90, MEDIA: 150, GRANDE: 220 }[porte];
  const tempoMeses = tempoNull ? null
    : clamp(Math.round(Math.exp(normal(Math.log(tempoMedio), 0.75))), 0, 480);

  // Faturamento mensal: lognormal por porte × setor, cauda pesada + 0,3% de outliers extremos; ~1,5% nulos
  const fatNull = rand() < 0.015;
  let faturamento = null;
  if (!fatNull) {
    faturamento = Math.exp(normal(Math.log(FAT_MEDIAN_BY_PORTE[porte] * FAT_SETOR_MULT[setor]), 0.85));
    if (rand() < 0.003) faturamento *= 20; // outlier extremo
    faturamento = Math.round(faturamento * 100) / 100;
  }

  // Funcionários: correlação positiva com porte e faturamento
  const funcBase = { MEI: 1, MICRO: 5, PEQUENA: 25, MEDIA: 120, GRANDE: 800 }[porte];
  const qtdFunc = porte === 'MEI' ? 1
    : clamp(Math.round(Math.exp(normal(Math.log(funcBase), 0.5))), 2, 5000);

  // Limite pré-aprovado: função do faturamento × score (correlação forte plantada)
  let limite = null;
  if (faturamento != null) {
    const fator = 0.35 * (1.6 - 0.12 * scoreIdx) * randIn(0.85, 1.15);
    limite = Math.max(500, Math.round((faturamento * fator) / 100) * 100);
  }

  // ── Risco verdadeiro (probabilidade de atraso >30d entre as altas) ────────
  let p = 0.006 * Math.pow(1.42, scoreIdx - 1);                       // R01 ≈ 0,6% … R10 ≈ 14,3%
  if (restritivo === 'SIM') p *= 2.2;
  else if (restritivo === '') p *= 1.1;
  p *= tempoMeses == null ? 1.15                                       // tempo: monotônico decrescente
    : clamp(1.65 - 0.28 * Math.log(1 + tempoMeses / 12), 0.75, 1.65);
  if (faturamento != null) {                                           // faturamento: risco em "U"
    const z = (Math.log(faturamento) - Math.log(60000)) / 1.6;
    p *= clamp(0.85 + 0.18 * z * z, 0.85, 1.9);
  }
  p *= RISCO_SETOR[setor] * RISCO_REGIAO[regiao] * RISCO_CANAL[canal];

  // Segmentos plantados (verdade que a Descoberta de Segmentos deve encontrar)
  const flaw1 = porte === 'MEI' && canal === 'DIGITAL' && (scoreIdx === 7 || scoreIdx === 8);
  if (flaw1) p *= 0.35;                                                // bom pagador com score ruim
  const flaw2 = setor === 'CONSTRUCAO' && regiao === 'NORTE';
  if (flaw2) p *= 2.5;                                                 // risco escondido aprovado
  if (uf === 'AC') p *= 4.0;                                           // anomalia de qualidade de dado
  if (safra === '202509') p *= 1.45;                                   // anomalia temporal (safra ruim)
  p = clamp(p, 0.002, 0.6);

  // ── Política AS IS (decisão histórica, com as falhas plantadas) ───────────
  let decisao;
  if (restritivo === 'SIM' && scoreIdx >= 5) decisao = rand() < 0.98 ? 'REPROVADO' : 'APROVADO';
  else if (flaw1) decisao = rand() < 0.95 ? 'REPROVADO' : 'APROVADO';  // a política atual perde este público
  else if (scoreIdx <= 6) decisao = rand() < 0.97 ? 'APROVADO' : 'REPROVADO';
  else if (scoreIdx === 7) decisao = rand() < 0.55 ? 'APROVADO' : 'REPROVADO';
  else decisao = rand() < 0.08 ? 'APROVADO' : 'REPROVADO';             // exceções de mesa em R08+
  if (rand() < 0.02) decisao = 'PENDENTE';                             // ~2% para mapear como “Ignorar”

  // ── Conversão e métricas sumarizadas ──────────────────────────────────────
  let conv = 0.35 + 0.02 * scoreIdx;                                   // seleção adversa: risco converte mais
  conv += { DIGITAL: 0.08, LOJA: 0, PARCEIRO: 0.02, TELEVENDAS: -0.05 }[canal];
  conv += { CARTAO: 0.05, CAPITAL_GIRO: 0, FINANCIAMENTO: -0.06 }[produto];
  conv = clamp(conv, 0.1, 0.9);
  const convInfer = clamp(conv * randIn(0.92, 1.08), 0.05, 0.95);      // estimativa do modelo (com erro)
  const pInfer = clamp(p * randIn(0.85, 1.2), 0.001, 0.7);             // inadimplência inferida (com erro)

  const r = rand();
  const qty = r < 0.55 ? 1 + Math.floor(rand() * 2)
    : r < 0.85 ? 3 + Math.floor(rand() * 6)
    : r < 0.97 ? 9 + Math.floor(rand() * 22)
    : 31 + Math.floor(rand() * 170);

  const aprovado = decisao === 'APROVADO';
  const altas = aprovado ? binomial(qty, conv) : 0;
  const atrs = altas > 0 ? binomial(altas, p) : null;                  // vazio quando não há altas
  const inferConv = qty * convInfer;
  const inferAtrs = inferConv * pInfer;

  return [
    `L${String(i + 1).padStart(6, '0')}`,   // ID_LINHA
    safra,                                   // SAFRA
    score,                                   // SCORE_INTERNO
    bureau,                                  // FAIXA_BUREAU
    porte,                                   // PORTE_EMPRESA
    setor,                                   // SETOR
    regiao,                                  // REGIAO
    uf,                                      // UF
    canal,                                   // CANAL
    produto,                                 // PRODUTO
    mix,                                     // MIX_RISCO
    restritivo,                              // FLAG_RESTRITIVO ('' = nulo)
    vendedor,                                // CODIGO_VENDEDOR
    dia,                                     // DIA_SEMANA (irrelevante)
    tempoMeses == null ? '' : String(tempoMeses),        // TEMPO_ATIVIDADE_MESES
    faturamento == null ? '' : dec2(faturamento),        // FATURAMENTO_MENSAL
    String(qtdFunc),                                     // QTD_FUNCIONARIOS
    limite == null ? '' : String(limite),                // LIMITE_PRE_APROVADO
    decisao,                                 // DECISAO_ANALISE
    String(qty),                             // QTD_PROPOSTA
    String(altas),                           // QTD_ALTAS
    atrs == null ? '' : String(atrs),        // QTD_ATRS_OVER_30
    dec(inferConv),                          // QTD_INFER_CONV
    dec(inferAtrs),                          // QTD_INFER_FL_ATRS
  ];
}

// ── Escrita ─────────────────────────────────────────────────────────────────
const HEADERS = [
  'ID_LINHA', 'SAFRA', 'SCORE_INTERNO', 'FAIXA_BUREAU', 'PORTE_EMPRESA', 'SETOR',
  'REGIAO', 'UF', 'CANAL', 'PRODUTO', 'MIX_RISCO', 'FLAG_RESTRITIVO',
  'CODIGO_VENDEDOR', 'DIA_SEMANA', 'TEMPO_ATIVIDADE_MESES', 'FATURAMENTO_MENSAL',
  'QTD_FUNCIONARIOS', 'LIMITE_PRE_APROVADO', 'DECISAO_ANALISE',
  'QTD_PROPOSTA', 'QTD_ALTAS', 'QTD_ATRS_OVER_30', 'QTD_INFER_CONV', 'QTD_INFER_FL_ATRS',
];

const lines = [HEADERS.join(';')];
for (let i = 0; i < N_ROWS; i++) lines.push(makeRow(i).join(';'));
writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');

// ── Sumário de validação (imprime no stdout) ────────────────────────────────
const rows = lines.slice(1).map((l) => l.split(';'));
const col = (name) => HEADERS.indexOf(name);
const num = (s) => (s === '' ? null : parseFloat(s.replace(',', '.')));
const sumBy = (pred, colName) => rows.reduce((s, r) => s + (pred(r) ? (num(r[col(colName)]) ?? 0) : 0), 0);

console.log(`Base gerada: ${OUT}`);
console.log(`Linhas: ${rows.length} · Propostas totais: ${sumBy(() => true, 'QTD_PROPOSTA')}`);
const nAprov = rows.filter((r) => r[col('DECISAO_ANALISE')] === 'APROVADO').length;
const nRepro = rows.filter((r) => r[col('DECISAO_ANALISE')] === 'REPROVADO').length;
const nPend = rows.length - nAprov - nRepro;
console.log(`Decisão AS IS (linhas): APROVADO ${nAprov} · REPROVADO ${nRepro} · PENDENTE ${nPend}`);
console.log('\nInad. real por score (∑atrs/∑altas, só aprovados) — deve ser monotônica crescente:');
for (let s = 1; s <= 10; s++) {
  const sc = `R${String(s).padStart(2, '0')}`;
  const pred = (r) => r[col('SCORE_INTERNO')] === sc;
  const altas = sumBy(pred, 'QTD_ALTAS');
  const atrs = sumBy(pred, 'QTD_ATRS_OVER_30');
  console.log(`  ${sc}: altas=${altas} inad=${altas ? ((100 * atrs) / altas).toFixed(2) : 'N/A'}%`);
}
const segPred = (r) => r[col('PORTE_EMPRESA')] === 'MEI' && r[col('CANAL')] === 'DIGITAL'
  && ['R07', 'R08'].includes(r[col('SCORE_INTERNO')]);
const segRows = rows.filter(segPred);
const segInadInf = sumBy(segPred, 'QTD_INFER_FL_ATRS') / sumBy(segPred, 'QTD_INFER_CONV');
console.log(`\nSegmento plantado 1 (MEI+DIGITAL+R07/R08): ${segRows.length} linhas, ` +
  `${segRows.filter((r) => r[col('DECISAO_ANALISE')] === 'REPROVADO').length} reprovadas, inad.inferida=${(100 * segInadInf).toFixed(2)}%`);
const seg2 = (r) => r[col('SETOR')] === 'CONSTRUCAO' && r[col('REGIAO')] === 'NORTE';
const seg2InadInf = sumBy(seg2, 'QTD_INFER_FL_ATRS') / sumBy(seg2, 'QTD_INFER_CONV');
console.log(`Segmento plantado 2 (CONSTRUCAO+NORTE): ${rows.filter(seg2).length} linhas, inad.inferida=${(100 * seg2InadInf).toFixed(2)}%`);
const globalInadInf = sumBy(() => true, 'QTD_INFER_FL_ATRS') / sumBy(() => true, 'QTD_INFER_CONV');
console.log(`Inad. inferida global: ${(100 * globalInadInf).toFixed(2)}%`);
for (const c of ['FLAG_RESTRITIVO', 'TEMPO_ATIVIDADE_MESES', 'FATURAMENTO_MENSAL']) {
  const nulos = rows.filter((r) => r[col(c)] === '').length;
  console.log(`Nulos em ${c}: ${nulos} (${((100 * nulos) / rows.length).toFixed(2)}%)`);
}
for (const c of ['UF', 'CODIGO_VENDEDOR', 'TEMPO_ATIVIDADE_MESES', 'FATURAMENTO_MENSAL']) {
  console.log(`Distintos em ${c}: ${new Set(rows.map((r) => r[col(c)]).filter(Boolean)).size}`);
}
