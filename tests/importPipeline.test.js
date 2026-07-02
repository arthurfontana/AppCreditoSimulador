import { describe, it, expect } from 'vitest';
import {
  buildColumnar,
  rowCount,
  cellStr,
  cellNum,
  parseCSVToColumnarAsync,
  finalizeImportedColumns,
  deriveMappedDictColumn,
  retypeColumn,
} from '../src/columnar.js';

// ── GATE do M1 (pipeline de importação vetorizado) ───────────────────────────────
// Controle: o caminho LEGADO do import, reimplementado do zero aqui —
// parseCSV (string[][]) → normalizeDecimalSep (cópia) → append __DECISAO_ORIGINAL
// (cópia) → buildColumnar — exatamente como App.jsx fazia antes do M1. O novo
// pipeline (parse direto para dict + finalize + coluna derivada) tem que produzir
// o MESMO csv colunar, célula a célula.

function legacyParseCSV(text, delimiter, hasHeader) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const split = (line) => {
    const res = []; let f = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === delimiter && !q) { res.push(f.trim()); f = ""; }
      else f += c;
    }
    res.push(f.trim());
    return res;
  };
  if (!lines.length) return { headers: [], rows: [] };
  const first = split(lines[0]);
  const headers = hasHeader ? first : first.map((_, i) => `Coluna ${i + 1}`);
  const rows = (hasHeader ? lines.slice(1) : lines).map(split);
  return { headers, rows };
}

function legacyNormalizeDecimalSep(rows, sep) {
  if (sep === '.') return rows;
  return rows.map(row => row.map(cell => {
    const v = cell.trim();
    if (/^\-?\d+,\d+$/.test(v)) return v.replace(',', '.');
    return cell;
  }));
}

// Caminho legado completo do confirm (import novo).
function legacyImport(text, delimiter, hasHeader, columnTypes, decimalSep, asIsVar, asIsMapping) {
  const { headers, rows: rawRows } = legacyParseCSV(text, delimiter, hasHeader);
  const rows = legacyNormalizeDecimalSep(rawRows, decimalSep || '.');
  let finalHeaders = headers;
  let finalRows = rows;
  if (asIsVar && headers.includes(asIsVar)) {
    const asIsIdx = headers.indexOf(asIsVar);
    finalHeaders = [...headers, '__DECISAO_ORIGINAL'];
    finalRows = rows.map(r => {
      const val = String(r[asIsIdx] ?? '');
      return [...r, (asIsMapping || {})[val] || ''];
    });
  }
  const { columns, rowCount: n } = buildColumnar(finalHeaders, finalRows, columnTypes);
  return { headers: finalHeaders, columns, rowCount: n };
}

// Caminho novo completo do confirm (import novo).
async function m1Import(text, delimiter, hasHeader, columnTypes, decimalSep, asIsVar, asIsMapping) {
  const parsed = await parseCSVToColumnarAsync(text, delimiter, hasHeader, null);
  const { columns: typed } = finalizeImportedColumns(parsed.headers, parsed.columns, parsed.rowCount, columnTypes, decimalSep || '.');
  let finalHeaders = parsed.headers;
  let columns = typed;
  if (asIsVar && parsed.headers.includes(asIsVar)) {
    const mapping = asIsMapping || {};
    finalHeaders = [...parsed.headers, '__DECISAO_ORIGINAL'];
    columns = { ...typed, __DECISAO_ORIGINAL: deriveMappedDictColumn(typed[asIsVar], parsed.rowCount, v => mapping[String(v ?? '')] || '') };
  }
  return { headers: finalHeaders, columns, rowCount: parsed.rowCount, previewRows: parsed.previewRows };
}

// Equivalência célula a célula entre dois csvs colunares (via accessors).
function expectCsvEquivalence(a, b) {
  expect(b.headers).toEqual(a.headers);
  expect(rowCount(b)).toBe(rowCount(a));
  for (let r = 0; r < rowCount(a); r++) {
    for (let c = 0; c < a.headers.length; c++) {
      expect(cellStr(b, r, c)).toBe(cellStr(a, r, c));
      // Object.is: NaN === NaN nas células vazias de métrica
      expect(Object.is(cellNum(b, r, c), cellNum(a, r, c))).toBe(true);
    }
  }
}

const CSV_QUIRKS = [
  'ID;GRUPO;SCORE;VOLUME;TAXA;DECISAO',
  '1;"A;com delim";R01;10;0,394;A',
  '2;B  espaços  ;R02;20;1.234,56;R',
  '',
  '3;C;R01;5;2,5;A',
  '4;;R03;;0,001;P',
  '5;C;R02;7',                          // linha ragged (menos células)
  '6;"A;com delim";R01;10;0,394;A',     // repete valores (dedup do dicionário)
].join('\r\n');

const TYPES = { VOLUME: 'qty', TAXA: 'inadReal', ID: 'id', GRUPO: 'decision', SCORE: 'decision', DECISAO: 'decision' };
const AS_IS_MAP = { A: 'APROVADO', R: 'REPROVADO', P: 'IGNORAR' };

describe('M1 — parseCSVToColumnarAsync equivale ao parse legado', () => {
  it('CSV com aspas, CRLF, linhas vazias, ragged e valores repetidos', async () => {
    const legacy = legacyImport(CSV_QUIRKS, ';', true, TYPES, '.', null, null);
    const novo = await m1Import(CSV_QUIRKS, ';', true, TYPES, '.', null, null);
    expectCsvEquivalence(legacy, novo);
  });

  it('hasHeader=false gera "Coluna N" e trata a 1ª linha como dado', async () => {
    const text = 'a,b,c\n1,2,3\n4,5,6';
    const legacy = legacyImport(text, ',', false, {}, '.', null, null);
    const novo = await m1Import(text, ',', false, {}, '.', null, null);
    expect(novo.headers).toEqual(['Coluna 1', 'Coluna 2', 'Coluna 3']);
    expectCsvEquivalence(legacy, novo);
  });

  it('texto vazio resolve sem linhas nem colunas', async () => {
    const parsed = await parseCSVToColumnarAsync('  \n \r\n ', ',', true, null);
    expect(parsed.headers).toEqual([]);
    expect(parsed.rowCount).toBe(0);
    expect(parsed.previewRows).toEqual([]);
  });

  it('previewRows traz as primeiras linhas cruas (célula a célula) e é limitado', async () => {
    const many = ['h1,h2', ...Array.from({ length: 250 }, (_, i) => `v${i},w${i}`)].join('\n');
    const parsed = await parseCSVToColumnarAsync(many, ',', true, null);
    expect(parsed.rowCount).toBe(250);
    expect(parsed.previewRows.length).toBe(100);
    expect(parsed.previewRows[0]).toEqual(['v0', 'w0']);
    expect(parsed.previewRows[99]).toEqual(['v99', 'w99']);
  });

  it('reporta progresso monotônico até o total', async () => {
    const calls = [];
    await parseCSVToColumnarAsync(CSV_QUIRKS, ';', true, (done, total) => calls.push([done, total]));
    expect(calls.length).toBeGreaterThan(0);
    const [doneLast, totalLast] = calls[calls.length - 1];
    expect(doneLast).toBe(totalLast);
  });
});

describe('M1 — finalizeImportedColumns (métricas + separador decimal)', () => {
  it('decimal vírgula: métricas parseiam como o legado; dimensões são normalizadas com dedup', async () => {
    const legacy = legacyImport(CSV_QUIRKS, ';', true, TYPES, ',', null, null);
    const novo = await m1Import(CSV_QUIRKS, ';', true, TYPES, ',', null, null);
    expectCsvEquivalence(legacy, novo);
  });

  it('normalização com colisão de valores ("1,5" e "1.5") mescla códigos como o legado', async () => {
    const text = 'DIM,V\n"1,5",10\nx,20\n1.5,30'; // DIM: "1,5" · x · 1.5
    const legacy = legacyImport(text, ',', true, { V: 'qty' }, ',', null, null);
    const novo = await m1Import(text, ',', true, { V: 'qty' }, ',', null, null);
    expectCsvEquivalence(legacy, novo);
    // dict da dimensão pós-merge: "1,5" virou "1.5" e colide com o "1.5" literal
    const dim = novo.columns.DIM;
    expect(dim.dict).toEqual(['1.5', 'x']);
  });

  it('célula vazia em métrica preserva NaN (semântica do buildColumnar)', async () => {
    const novo = await m1Import(CSV_QUIRKS, ';', true, TYPES, '.', null, null);
    // linha 4 (idx 3): VOLUME vazio → NaN; linha 5 (idx 4): TAXA ausente (ragged) → NaN
    expect(Number.isNaN(novo.columns.VOLUME.data[3])).toBe(true);
    expect(Number.isNaN(novo.columns.TAXA.data[4])).toBe(true);
  });

  it('colunas não tocadas são reusadas por referência (zero cópia)', async () => {
    const parsed = await parseCSVToColumnarAsync(CSV_QUIRKS, ';', true, null);
    const { columns } = finalizeImportedColumns(parsed.headers, parsed.columns, parsed.rowCount, TYPES, '.');
    expect(columns.GRUPO).toBe(parsed.columns.GRUPO); // dimensão sem normalização
  });
});

describe('M1 — deriveMappedDictColumn (__DECISAO_ORIGINAL por códigos)', () => {
  it('coluna derivada equivale ao append legado (valores e ordem de 1ª aparição do dict)', async () => {
    const legacy = legacyImport(CSV_QUIRKS, ';', true, TYPES, ',', 'DECISAO', AS_IS_MAP);
    const novo = await m1Import(CSV_QUIRKS, ';', true, TYPES, ',', 'DECISAO', AS_IS_MAP);
    expectCsvEquivalence(legacy, novo);
    expect(novo.columns.__DECISAO_ORIGINAL.dict).toEqual(legacy.columns.__DECISAO_ORIGINAL.dict);
  });

  it('valores fora do mapping (e IGNORAR não mapeado p/ decisão) caem em vazio', async () => {
    const novo = await m1Import(CSV_QUIRKS, ';', true, TYPES, '.', 'DECISAO', { A: 'APROVADO' });
    const dor = novo.columns.__DECISAO_ORIGINAL;
    const vals = Array.from(dor.codes).map(k => dor.dict[k]);
    expect(vals).toEqual(['APROVADO', '', 'APROVADO', '', '', 'APROVADO']);
  });

  it('fonte num (defensivo) usa a mesma string do cellStr', () => {
    const src = { kind: 'num', data: Float64Array.from([1.5, NaN, 2]) };
    const out = deriveMappedDictColumn(src, 3, v => (v === '' ? 'VAZIO' : `N${v}`));
    const vals = Array.from(out.codes).map(k => out.dict[k]);
    expect(vals).toEqual(['N1.5', 'VAZIO', 'N2']);
  });
});

describe('M1 — retypeColumn (modo de edição sem materializar a base)', () => {
  const dictCol = { kind: 'dict', dict: ['10', '0,5', '', 'x'], codes: Int32Array.from([0, 1, 2, 3, 0]) };
  const numCol = { kind: 'num', data: Float64Array.from([1.5, NaN, 42]) };

  it('tipo inalterado compartilha a coluna por referência', () => {
    expect(retypeColumn(dictCol, false, 5)).toBe(dictCol);
    expect(retypeColumn(numCol, true, 3)).toBe(numCol);
  });

  it('dict → num replica parseFloat por linha do legado (sem normalização decimal)', () => {
    const out = retypeColumn(dictCol, true, 5);
    expect(out.kind).toBe('num');
    expect(Array.from(out.data.subarray(0, 1))).toEqual([10]);
    expect(out.data[1]).toBe(0); // parseFloat('0,5') === 0 (igual ao legado sem normalize)
    expect(Number.isNaN(out.data[2])).toBe(true); // ''
    expect(Number.isNaN(out.data[3])).toBe(true); // 'x'
    expect(out.data[4]).toBe(10);
  });

  it('num → dict replica a materialização legada (NaN → vazio, senão String(v))', () => {
    const out = retypeColumn(numCol, false, 3);
    const vals = Array.from(out.codes).map(k => out.dict[k]);
    expect(vals).toEqual(['1.5', '', '42']);
    // round-trip com o legado: buildColumnar sobre as strings materializadas
    const { columns } = buildColumnar(['C'], [['1.5'], [''], ['42']], {});
    expect(out.dict).toEqual(columns.C.dict);
    expect(Array.from(out.codes)).toEqual(Array.from(columns.C.codes));
  });

  it('coluna ausente cai nos defaults do legado (NaN / vazio)', () => {
    const asNum = retypeColumn(undefined, true, 2);
    expect(Number.isNaN(asNum.data[0]) && Number.isNaN(asNum.data[1])).toBe(true);
    const asDict = retypeColumn(undefined, false, 2);
    expect(asDict.dict[asDict.codes[0]]).toBe('');
  });
});

describe('M1 — base grande sintética (crescimento dos buffers além da capacidade inicial)', () => {
  it('5.000 linhas: equivalência célula a célula e dicionários idênticos', async () => {
    const N = 5000;
    const lines = ['SEG,SCORE,VOL,TAXA'];
    for (let i = 0; i < N; i++) {
      lines.push(`S${i % 7},R${(i % 20) + 1},${i},${i % 100}`);
    }
    const text = lines.join('\n');
    const types = { VOL: 'qty', TAXA: 'inadReal' };
    const legacy = legacyImport(text, ',', true, types, '.', null, null);
    const novo = await m1Import(text, ',', true, types, '.', null, null);
    expect(novo.rowCount).toBe(N);
    expectCsvEquivalence(legacy, novo);
    expect(novo.columns.SEG.dict).toEqual(legacy.columns.SEG.dict);
    expect(novo.columns.SCORE.dict).toEqual(legacy.columns.SCORE.dict);
  });
});
