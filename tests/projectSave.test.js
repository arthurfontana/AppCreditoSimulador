import { describe, it, expect } from 'vitest';
import { buildProjectJSONChunks } from '../src/App.jsx';
import { buildColumnar, serializeCsvStore, deserializeCsvStore } from '../src/columnar.js';

// ── M3 (Otimização de Memória) — escrita do Projeto em partes ────────────────
// `buildProjectJSONChunks` substitui `JSON.stringify(buildProjectPayload())` por um
// array de chunks (casca do payload + uma entrada por coluna de cada base), consumido
// tanto pelo `createWritable` (streaming) quanto pelo `Blob` (BlobPart[]) do fallback de
// download. O contrato central: concatenar os chunks tem que produzir EXATAMENTE o
// mesmo conteúdo (via JSON.parse) que `JSON.stringify(payload)` produziria de uma vez.
describe('M3 · buildProjectJSONChunks', () => {
  function makeCsvStore() {
    const headers = ['mes', 'score', 'volume'];
    const rows = [
      ['2024-01', 'R1', '100'],
      ['2024-01', 'R2', '50'],
      ['2024-02', 'R1', '80'],
    ];
    const { columns, rowCount } = buildColumnar(headers, rows, { volume: 'qty' });
    return {
      base: { name: 'base.csv', headers, columns, rowCount, columnTypes: { volume: 'qty' }, varTypes: {}, asIsConfig: null },
    };
  }

  function makePayload() {
    return {
      schemaVersion: '2.3',
      kind: 'credito-project',
      generatedAt: '2026-01-01T00:00:00.000Z',
      activeTab: 'canvas',
      viewport: { x: 0, y: 0, s: 1 },
      panelCollapsed: false,
      canvases: { c1: { id: 'c1', name: 'Canvas 1', shapes: [{ id: 's1', type: 'approved' }], conns: [] } },
      activeCanvasId: 'c1',
      csvStore: serializeCsvStore(makeCsvStore()),
      analyticsLayout: [],
      analyticsGroupings: [],
      analyticsPageFilters: [],
      // Explorar a Base (Épico EB, EB2) — layout por base, schema 3.2.
      exploreLayouts: { base: [{ id: 'auto_insight_asis', type: 'insight', origin: 'auto', x: 24, y: 24, w: 1100, h: 130, config: { title: 'Retrato da Operação (AS IS)', preset: 'asis' } }] },
      cinemaLibrary: [],
      businessWidget: { visible: false, x: 0, y: 0, w: 0, h: 0 },
      preferences: { enableDynThickness: true, showEdgeVol: false, showEdgeInadReal: false, showEdgeInadInf: false },
    };
  }

  it('a concatenação dos chunks é um JSON válido, equivalente a JSON.stringify(payload)', () => {
    const payload = makePayload();
    const chunks = buildProjectJSONChunks(payload);
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBeGreaterThan(1); // prova que realmente fatiou (não 1 chunk só)
    const joined = chunks.join('');
    const parsed = JSON.parse(joined); // lança se o JSON produzido for inválido
    expect(parsed).toEqual(JSON.parse(JSON.stringify(payload)));
  });

  it('exploreLayouts (Épico EB, EB2) sobrevive ao round-trip via chunks, byte a byte', () => {
    const payload = makePayload();
    const chunks = buildProjectJSONChunks(payload);
    const parsed = JSON.parse(chunks.join(''));
    expect(parsed.exploreLayouts).toEqual(payload.exploreLayouts);
  });

  it('cada chunk de coluna é individualmente pequeno (não monta o csvStore inteiro de uma vez)', () => {
    const payload = makePayload();
    const chunks = buildProjectJSONChunks(payload);
    const wholeJsonLen = JSON.stringify(payload).length;
    // Nenhum chunk isolado deveria se aproximar do tamanho do JSON inteiro — é exatamente
    // isso que evita a string única monolítica na escrita.
    for (const c of chunks) expect(c.length).toBeLessThan(wholeJsonLen);
  });

  it('round-trip: chunks → JSON.parse → deserializeCsvStore reconstrói a base colunar', () => {
    const payload = makePayload();
    const chunks = buildProjectJSONChunks(payload);
    const parsed = JSON.parse(chunks.join(''));
    const restored = deserializeCsvStore(parsed.csvStore);
    expect(restored.base.columns.volume.data).toBeInstanceOf(Float64Array);
    expect(Array.from(restored.base.columns.volume.data)).toEqual([100, 50, 80]);
    expect(restored.base.columns.score.dict).toEqual(expect.arrayContaining(['R1', 'R2']));
  });

  it('omite campos com valor undefined, igual a JSON.stringify (sem quebrar o JSON)', () => {
    const payload = { ...makePayload(), extraUndefined: undefined };
    const chunks = buildProjectJSONChunks(payload);
    const joined = chunks.join('');
    expect(() => JSON.parse(joined)).not.toThrow();
    expect('extraUndefined' in JSON.parse(joined)).toBe(false);
  });

  it('lida com csvStore vazio e com entradas legadas (sem `columns`)', () => {
    const payload = { ...makePayload(), csvStore: {} };
    expect(() => JSON.parse(buildProjectJSONChunks(payload).join(''))).not.toThrow();

    const legacyPayload = {
      ...makePayload(),
      csvStore: { legacy: { name: 'old.csv', headers: ['a'], rows: [['1'], ['2']], columnTypes: {}, varTypes: {} } },
    };
    const joined = buildProjectJSONChunks(legacyPayload).join('');
    const parsed = JSON.parse(joined);
    expect(parsed.csvStore.legacy.rows).toEqual([['1'], ['2']]);
  });
});
