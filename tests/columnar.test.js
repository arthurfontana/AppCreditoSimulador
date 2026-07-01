import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexInferenceRef } from '../src/App.jsx';
import { runSimulation } from '../src/simulation.worker.js';
import {
  buildColumnar,
  isColumnar,
  rowCount,
  cellStr,
  cellNum,
  getRow,
  materializeRows,
  distinctColValues,
  serializeCsvStore,
  deserializeCsvStore,
  sharedBuffersAvailable,
  isSharedColumnar,
  buildCsvStoreMessage,
} from '../src/columnar.js';

// ── Parser mínimo (delimitador ';', sem aspas) — igual ao GATE ──────────────────
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

const KEY_MAP = {
  FAIXA_SCORE:             'SCORE_HVI3',
  OPERACAO:                'OPERACAO',
  IDENTIFICA_GRUPO_MODELO: 'IDENTIFICA_GRUPO_MODELO',
  CANAL_PCO_AJUSTADO:      'CANAL_PCO_AJUSTADO',
};
const WEIGHT_COL = 'QTD_PROPOSTA';
const columnTypes = { [WEIGHT_COL]: 'qty' };
const inferenceConfig = { source: 'ref', keyMap: KEY_MAP, weightCol: WEIGHT_COL, normalizeScore: true };

// csv legado (string[][]) — o que os testes/o GATE sempre usaram.
function makeLegacyCsv() {
  return {
    name: 'Amostra_Fake.csv',
    headers: baseHeaders,
    rows: baseRows,
    columnTypes,
    varTypes: {},
    asIsConfig: null,
    inferenceConfig,
  };
}

// csv colunar (Float64Array + dictionary encoding) — o que a app passa a guardar.
function makeColumnarCsv() {
  const { columns, rowCount: rc } = buildColumnar(baseHeaders, baseRows, columnTypes);
  const { rows, ...rest } = makeLegacyCsv();
  return { ...rest, columns, rowCount: rc };
}

// Fluxo trivial: decision_lens sem regras (passa tudo) → Aprovado.
const SHAPES = [
  { id: 'lens', type: 'decision_lens', rules: [] },
  { id: 'appr', type: 'approved' },
];
const CONNS = [{ id: 'c1', from: 'lens', to: 'appr', label: '' }];

describe('buildColumnar — estrutura vetorizada', () => {
  it('métrica (qty) vira Float64Array; dimensões viram dictionary encoding', () => {
    const { columns, rowCount: rc } = buildColumnar(baseHeaders, baseRows, columnTypes);
    expect(rc).toBe(baseRows.length);

    const wcol = columns[WEIGHT_COL];
    expect(wcol.kind).toBe('num');
    expect(wcol.data).toBeInstanceOf(Float64Array);
    expect(wcol.data.length).toBe(baseRows.length);

    const scol = columns['OPERACAO'];
    expect(scol.kind).toBe('dict');
    expect(scol.codes).toBeInstanceOf(Int32Array);
    // dict = lista de distintos por construção
    const idx = baseHeaders.indexOf('OPERACAO');
    const legacyDistinct = new Set(baseRows.map(r => r[idx] ?? ''));
    expect(new Set(scol.dict)).toEqual(legacyDistinct);
  });
});

describe('accessor — equivalência com o legado string[][]', () => {
  const col = makeColumnarCsv();
  const legacy = makeLegacyCsv();

  it('rowCount / cellStr / cellNum reproduzem row[idx] célula a célula', () => {
    expect(rowCount(col)).toBe(rowCount(legacy));
    const wIdx = baseHeaders.indexOf(WEIGHT_COL);
    const opIdx = baseHeaders.indexOf('OPERACAO');
    const scoreIdx = baseHeaders.indexOf('SCORE_HVI3');
    const N = rowCount(col);
    // varre uma amostra ampla (todas as linhas — base pequena de teste)
    for (let r = 0; r < N; r++) {
      expect(cellStr(col, r, opIdx)).toBe(baseRows[r][opIdx]);
      expect(cellStr(col, r, scoreIdx)).toBe(baseRows[r][scoreIdx]);
      // num: mesmo valor de parseFloat(row[idx])
      const expected = parseFloat(baseRows[r][wIdx]);
      const got = cellNum(col, r, wIdx);
      if (Number.isNaN(expected)) expect(Number.isNaN(got)).toBe(true);
      else expect(got).toBe(expected);
    }
  });

  it('getRow / materializeRows reconstroem as linhas', () => {
    expect(getRow(col, 0)).toEqual(baseRows[0]);
    const mat = materializeRows(col);
    expect(mat.length).toBe(baseRows.length);
    expect(mat[0]).toEqual(baseRows[0]);
    expect(mat[mat.length - 1]).toEqual(baseRows[baseRows.length - 1]);
  });

  it('distinctColValues = distintos não-vazios (dicionário)', () => {
    const opIdx = baseHeaders.indexOf('OPERACAO');
    const got = new Set(distinctColValues(col, opIdx));
    const expected = new Set(baseRows.map(r => r[opIdx] ?? '').filter(v => v !== ''));
    expect(got).toEqual(expected);
  });
});

describe('GATE colunar — runSimulation sobre base vetorizada bate o legado', () => {
  it('mesma FPD inferida (∑maus/∑altas) e mesmos agregados que a base string[][]', () => {
    const legacyRes = runSimulation(SHAPES, CONNS, { base: makeLegacyCsv() }, ref);
    const colRes    = runSimulation(SHAPES, CONNS, { base: makeColumnarCsv() }, ref);

    expect(colRes.approvedQty).toBeGreaterThan(0);
    expect(colRes.approvedQty).toBeCloseTo(legacyRes.approvedQty, 6);
    expect(colRes.totalQty).toBeCloseTo(legacyRes.totalQty, 6);
    expect(colRes.inadInferida).toBeCloseTo(legacyRes.inadInferida, 12);
    // Valor de controle documentado no GATE: FPD inferida ≈ 40,06%.
    expect(colRes.inadInferida).toBeGreaterThan(0.40);
    expect(colRes.inadInferida).toBeLessThan(0.41);
    // Confiab e origem preservados.
    expect(colRes.inferenceSource).toBe('ref');
    for (const k of ['ALTA', 'MEDIA', 'BAIXA', 'GLOBAL']) {
      expect(colRes.confiabVolume[k]).toBeCloseTo(legacyRes.confiabVolume[k], 4);
    }
  });
});

describe('Round-trip do Projeto (.credito.json) preservando a base colunar', () => {
  it('serialize → JSON → deserialize reconstrói typed arrays e mantém os resultados', () => {
    const store = { base: makeColumnarCsv() };

    // Serializa (typed arrays → arrays planos), passa por JSON e volta.
    const json = JSON.stringify(serializeCsvStore(store));
    const restored = deserializeCsvStore(JSON.parse(json));

    const rcsv = restored.base;
    expect(isColumnar(rcsv)).toBe(true);
    expect(rcsv.columns[WEIGHT_COL].data).toBeInstanceOf(Float64Array);
    expect(rcsv.columns['OPERACAO'].codes).toBeInstanceOf(Int32Array);
    expect(rcsv.rowCount).toBe(baseRows.length);
    // inferenceConfig e metadados sobrevivem intactos.
    expect(rcsv.inferenceConfig).toEqual(inferenceConfig);
    expect(rcsv.headers).toEqual(baseHeaders);

    // Célula a célula = base original.
    const opIdx = baseHeaders.indexOf('OPERACAO');
    expect(cellStr(rcsv, 0, opIdx)).toBe(baseRows[0][opIdx]);

    // E o simulador reproduz a mesma FPD após o round-trip.
    const before = runSimulation(SHAPES, CONNS, store, ref);
    const after  = runSimulation(SHAPES, CONNS, restored, ref);
    expect(after.inadInferida).toBeCloseTo(before.inadInferida, 12);
    expect(after.approvedQty).toBeCloseTo(before.approvedQty, 6);
  });

  it('deserialize aceita o formato legado antigo (rows string[][]) e vetoriza', () => {
    // Projeto salvo ANTES da Fase 1: csvStore com `rows` em vez de `columns`.
    const legacyStore = { base: makeLegacyCsv() };
    const restored = deserializeCsvStore(JSON.parse(JSON.stringify(legacyStore)));
    const rcsv = restored.base;
    expect(isColumnar(rcsv)).toBe(true);
    expect(rcsv.rows).toBeUndefined();
    expect(rcsv.columns[WEIGHT_COL].data).toBeInstanceOf(Float64Array);

    const res = runSimulation(SHAPES, CONNS, restored, ref);
    expect(res.inadInferida).toBeGreaterThan(0.40);
    expect(res.inadInferida).toBeLessThan(0.41);
  });
});

// ── Fase 2 — transferência sem cópia para o worker ──────────────────────────────
describe('Fase 2 — buffers compartilhados (SharedArrayBuffer)', () => {
  // Constrói uma variante SAB-backed manualmente (Node expõe SharedArrayBuffer,
  // mesmo sem crossOriginIsolated) para provar que os accessors e o simulador operam
  // idêntico sobre memória compartilhada.
  function makeSharedCsv() {
    const legacy = makeColumnarCsv();
    const columns = {};
    for (const [name, col] of Object.entries(legacy.columns)) {
      if (col.kind === 'num') {
        const d = new Float64Array(new SharedArrayBuffer(col.data.length * 8));
        d.set(col.data);
        columns[name] = { kind: 'num', data: d };
      } else {
        const c = new Int32Array(new SharedArrayBuffer(col.codes.length * 4));
        c.set(col.codes);
        columns[name] = { kind: 'dict', dict: col.dict, codes: c };
      }
    }
    return { ...legacy, columns };
  }

  it('sharedBuffersAvailable reflete crossOriginIsolated; buildColumnar aloca o buffer condizente', () => {
    const shared = sharedBuffersAvailable();
    expect(typeof shared).toBe('boolean');
    const { columns } = buildColumnar(baseHeaders, baseRows, columnTypes);
    const buf = columns[WEIGHT_COL].data.buffer;
    if (shared) expect(buf).toBeInstanceOf(SharedArrayBuffer);
    else        expect(buf).toBeInstanceOf(ArrayBuffer); // sem COI (ambiente de teste) → cópia via clone
  });

  it('accessors + runSimulation batem o legado sobre colunas SAB-backed', () => {
    const sharedCsv = makeSharedCsv();
    expect(sharedCsv.columns[WEIGHT_COL].data.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(isSharedColumnar(sharedCsv)).toBe(true);

    // Célula a célula = base original.
    const opIdx = baseHeaders.indexOf('OPERACAO');
    const wIdx  = baseHeaders.indexOf(WEIGHT_COL);
    for (let r = 0; r < rowCount(sharedCsv); r++) {
      expect(cellStr(sharedCsv, r, opIdx)).toBe(baseRows[r][opIdx]);
    }

    const legacyRes = runSimulation(SHAPES, CONNS, { base: makeLegacyCsv() }, ref);
    const sharedRes = runSimulation(SHAPES, CONNS, { base: sharedCsv }, ref);
    expect(sharedRes.approvedQty).toBeCloseTo(legacyRes.approvedQty, 6);
    expect(sharedRes.inadInferida).toBeCloseTo(legacyRes.inadInferida, 12);
    expect(sharedRes.inadInferida).toBeGreaterThan(0.40);
    expect(sharedRes.inadInferida).toBeLessThan(0.41);
    // não-SAB report
    expect(isSharedColumnar(makeColumnarCsv())).toBe(false);
  });

  it('buildCsvStoreMessage não neutraliza os buffers da base (main mantém acesso)', () => {
    const store = { base: makeSharedCsv() };
    const { payload, transfer } = buildCsvStoreMessage(store);

    // SAB é COMPARTILHADO, nunca transferido → lista de transfer vazia.
    expect(transfer).toEqual([]);
    expect(payload.type).toBe('UPDATE_CSV_STORE');
    expect(payload.csvStore).toBe(store); // mesmo objeto, sem cópia prévia

    // Após montar a mensagem, os buffers seguem íntegros e legíveis na "main".
    const wIdx = baseHeaders.indexOf(WEIGHT_COL);
    expect(store.base.columns[WEIGHT_COL].data.buffer.byteLength).toBeGreaterThan(0);
    expect(Number.isNaN(cellNum(store.base, 0, wIdx))).toBe(false);
    expect(rowCount(store.base)).toBe(baseRows.length);

    // E o simulador ainda roda sobre o mesmo store (nada foi neutralizado).
    const res = runSimulation(SHAPES, CONNS, store, ref);
    expect(res.inadInferida).toBeGreaterThan(0.40);
  });
});
