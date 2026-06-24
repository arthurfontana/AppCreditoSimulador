import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexInferenceRef } from '../src/App.jsx';
import {
  buildInferenceResolver,
  normalizeScoreKey,
  runSimulation,
} from '../src/simulation.worker.js';

// ── Parsers mínimos (delimitador ';', sem aspas) ─────────────────────────────
function parseSemicolon(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const split = l => l.split(';').map(c => c.trim());
  return { headers: split(lines[0]), rows: lines.slice(1).map(split) };
}

const REF_PATH  = join(process.cwd(), 'INFERENCIA_REF_202509_202603.CSV');
const BASE_PATH = join(process.cwd(), 'Amostra_Fake.csv');

const { headers: refHeaders, rows: refRows } = parseSemicolon(readFileSync(REF_PATH, 'utf8'));
const ref = indexInferenceRef(refHeaders, refRows, 'INFERENCIA_REF.CSV');

const { headers: baseHeaders, rows: baseRows } = parseSemicolon(readFileSync(BASE_PATH, 'utf8'));

// De-para base↔referência (FAIXA_SCORE é a âncora; a base usa SCORE_HVI3).
const KEY_MAP = {
  FAIXA_SCORE:             'SCORE_HVI3',
  OPERACAO:                'OPERACAO',
  IDENTIFICA_GRUPO_MODELO: 'IDENTIFICA_GRUPO_MODELO',
  CANAL_PCO_AJUSTADO:      'CANAL_PCO_AJUSTADO',
};
const WEIGHT_COL = 'QTD_PROPOSTA';

// columnTypes mínimos: só precisamos do peso (qty) para a inferência.
const columnTypes = { [WEIGHT_COL]: 'qty' };

function makeCsv(normalizeScore = true) {
  return {
    name: 'Amostra_Fake.csv',
    headers: baseHeaders,
    rows: baseRows,
    columnTypes,
    varTypes: {},
    asIsConfig: null,
    inferenceConfig: { source: 'ref', keyMap: KEY_MAP, weightCol: WEIGHT_COL, normalizeScore },
  };
}

// ── Controle independente: cascata reimplementada lendo as linhas CRUAS da ref ──
// (não usa indexInferenceRef nem buildInferenceResolver — é o "valor de controle").
function buildControlCascade(headers, rows) {
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });
  const KEYS = ['FAIXA_SCORE', 'OPERACAO', 'IDENTIFICA_GRUPO_MODELO', 'CANAL_PCO_AJUSTADO'];
  const ki = KEYS.map(k => idx[k]);
  const iConv = idx['taxa_conversao_ref'], iFpd = idx['taxa_fpd_ref'], iConf = idx['confiabilidade'];
  const maps = { 1: {}, 2: {}, 3: {}, 4: {} };
  let global = null;
  for (const r of rows) {
    const parts = ki.map(i => String(r[i] ?? '').trim());
    const conf = String(r[iConf] ?? '').trim().toUpperCase();
    const prem = { conv: parseFloat(r[iConv]) || 0, fpd: parseFloat(r[iFpd]) || 0 };
    if (conf === 'GLOBAL') { global = prem; continue; }
    // nº de chaves preenchidas (prefixo)
    let k = 0; for (const p of parts) { if (p) k++; else break; }
    if (k <= 0) { if (!global) global = prem; continue; }
    maps[k][parts.slice(0, k).join('|')] = prem;
  }
  return { maps, global };
}
const control = buildControlCascade(refHeaders, refRows);

// Agrega altas/maus físicos pelo controle independente (peso = QTD_PROPOSTA).
function controlAggregate(normalizeScore) {
  const bi = {};
  baseHeaders.forEach((h, i) => { bi[h] = i; });
  let altas = 0, maus = 0;
  for (const row of baseRows) {
    const peso = parseInt(row[bi[WEIGHT_COL]], 10) || 0;
    const sRaw = row[bi['SCORE_HVI3']];
    const s = normalizeScore ? normalizeScoreKey(sRaw) : String(sRaw ?? '').trim();
    const op = String(row[bi['OPERACAO']] ?? '').trim();
    const g  = String(row[bi['IDENTIFICA_GRUPO_MODELO']] ?? '').trim();
    const c  = String(row[bi['CANAL_PCO_AJUSTADO']] ?? '').trim();
    const p =
      control.maps[4][[s, op, g, c].join('|')] ??
      control.maps[3][[s, op, g].join('|')]    ??
      control.maps[2][[s, op].join('|')]       ??
      control.maps[1][s]                       ??
      control.global;
    altas += peso * p.conv;
    maus  += peso * p.conv * p.fpd;
  }
  return { altas, maus, fpd: altas > 0 ? maus / altas : null };
}

describe('normalizeScoreKey — chave transitória (§6)', () => {
  it('R99 / vazio / null → R20; demais inalterados', () => {
    expect(normalizeScoreKey('R99')).toBe('R20');
    expect(normalizeScoreKey('')).toBe('R20');
    expect(normalizeScoreKey(null)).toBe('R20');
    expect(normalizeScoreKey('  ')).toBe('R20');
    expect(normalizeScoreKey('R07')).toBe('R07');
    expect(normalizeScoreKey('R20')).toBe('R20');
  });
});

describe('buildInferenceResolver — cascata + físicos por linha', () => {
  const resolve = buildInferenceResolver(makeCsv(true), ref);

  it('está ativo só em modo ref', () => {
    expect(resolve).toBeTypeOf('function');
    const cols = buildInferenceResolver({ ...makeCsv(true), inferenceConfig: { source: 'columns' } }, ref);
    expect(cols).toBeNull();
    const noRef = buildInferenceResolver(makeCsv(true), null);
    expect(noRef).toBeNull();
  });

  it('físico de uma linha = peso × conv e peso × conv × fpd (premissa de controle)', () => {
    const bi = {}; baseHeaders.forEach((h, i) => { bi[h] = i; });
    const row = baseRows[0];
    const peso = parseInt(row[bi[WEIGHT_COL]], 10) || 0;
    const s = normalizeScoreKey(row[bi['SCORE_HVI3']]);
    const op = row[bi['OPERACAO']].trim();
    const g  = row[bi['IDENTIFICA_GRUPO_MODELO']].trim();
    const c  = row[bi['CANAL_PCO_AJUSTADO']].trim();
    const p =
      control.maps[4][[s, op, g, c].join('|')] ??
      control.maps[3][[s, op, g].join('|')]    ??
      control.maps[2][[s, op].join('|')]       ??
      control.maps[1][s]                       ?? control.global;
    const out = resolve(row);
    expect(out.altasInfer).toBeCloseTo(peso * p.conv, 9);
    expect(out.inadIRaw).toBeCloseTo(peso * p.conv * p.fpd, 9);
  });
});

describe('GATE — FPD inferida agregada vs. valor de controle independente', () => {
  const resolve = buildInferenceResolver(makeCsv(true), ref);

  it('o resolvedor agrega exatamente o mesmo ∑maus/∑altas que o controle', () => {
    let altas = 0, maus = 0;
    for (const row of baseRows) { const r = resolve(row); altas += r.altasInfer; maus += r.inadIRaw; }
    const ctl = controlAggregate(true);
    expect(altas).toBeCloseTo(ctl.altas, 4);
    expect(maus).toBeCloseTo(ctl.maus, 4);
    const fpd = maus / altas;
    expect(fpd).toBeCloseTo(ctl.fpd, 9);
    expect(fpd).toBeGreaterThan(0);
    expect(fpd).toBeLessThan(1);
    // Valor de controle documentado (ver PR): impresso para auditoria.
    // eslint-disable-next-line no-console
    console.log(`[GATE] altas=${altas.toFixed(2)} maus=${maus.toFixed(2)} FPD=${(fpd * 100).toFixed(4)}%`);
  });

  it('runSimulation (aprova tudo, modo ref) reproduz a FPD de controle', () => {
    // Flow: decision_lens sem regras (passa todas) → Aprovado. Aprova todas as linhas.
    const shapes = [
      { id: 'lens', type: 'decision_lens', rules: [] },
      { id: 'appr', type: 'approved' },
    ];
    const conns = [{ id: 'c1', from: 'lens', to: 'appr', label: '' }];
    const csvStore = { base: makeCsv(true) };
    const res = runSimulation(shapes, conns, csvStore, ref);

    const ctl = controlAggregate(true);
    expect(res.approvedQty).toBeGreaterThan(0);
    expect(res.inadInferida).toBeCloseTo(ctl.fpd, 9);
  });

  it('desligar a normalização de score muda só a chave (não o dado); base sem R99 ⇒ FPD idêntica', () => {
    // Nesta amostra não há score R99/vazio, então a FPD é igual com/sem normalização.
    const withNorm    = controlAggregate(true);
    const withoutNorm = controlAggregate(false);
    expect(withoutNorm.fpd).toBeCloseTo(withNorm.fpd, 9);
  });
});
