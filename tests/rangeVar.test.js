import { describe, it, expect } from 'vitest';
import { buildColumnar, deriveRangeColumn, rowCount, serializeCsvStore, deserializeCsvStore } from '../src/columnar.js';
import { computeRiskBands } from '../src/simulation.worker.js';
import {
  suggestRangeVarName, formatBandLabel, buildRangeDefFromModel,
  isRangeVar, describeRangeRules, renameRangeBand, editRangeCuts,
} from '../src/rangeVar.js';

// ── GATE — Variável de Faixas (interpretação do Criar Faixas por Risco, Épico FR) ──
// A materialização (deriveRangeColumn) é busca binária pelas fronteiras [min,max),
// cellNum-consistente, com "Sem valor" fora dos parseáveis. Aqui: correção da
// materialização (fronteiras exatas, ±∞, unmatched, ordinal), rótulos pt-BR, edição de
// cortes com validação, round-trip de persistência e a integração computeRiskBands
// real → def → coluna.

const bd = (id, label, min, max) => ({ id, label, min, max });

describe('deriveRangeColumn · materialização', () => {
  const bands = [bd('b1', 'até 100', null, 100), bd('b2', '100 a 300', 100, 300), bd('b3', 'acima de 300', 300, null)];
  const def = { sourceCol: 'FAT', unmatchedLabel: 'Sem valor', bands };

  it('fronteiras exatas em [min,max) — extremos incluem/excluem corretamente', () => {
    const csv = { headers: ['FAT'], columnTypes: { FAT: 'decision' },
      ...buildColumnar(['FAT'], [['99.99'], ['100'], ['299.99'], ['300'], ['1000']], { FAT: 'decision' }) };
    const col = deriveRangeColumn(csv, def);
    const labels = Array.from(col.codes, c => col.dict[c]);
    expect(labels).toEqual(['até 100', '100 a 300', '100 a 300', 'acima de 300', 'acima de 300']);
  });

  it('±∞ nas pontas: valores muito abaixo/acima caem nas faixas abertas', () => {
    const csv = { headers: ['FAT'], columnTypes: { FAT: 'decision' },
      ...buildColumnar(['FAT'], [['-999999'], ['999999999']], { FAT: 'decision' }) };
    const col = deriveRangeColumn(csv, def);
    const labels = Array.from(col.codes, c => col.dict[c]);
    expect(labels).toEqual(['até 100', 'acima de 300']);
  });

  it('valor não parseável (ou vazio) ⇒ unmatchedLabel, fora das faixas', () => {
    const csv = { headers: ['FAT'], columnTypes: { FAT: 'decision' },
      ...buildColumnar(['FAT'], [['N/A'], [''], ['-'], ['150']], { FAT: 'decision' }) };
    const col = deriveRangeColumn(csv, def);
    const labels = Array.from(col.codes, c => col.dict[c]);
    expect(labels).toEqual(['Sem valor', 'Sem valor', 'Sem valor', '100 a 300']);
  });

  it('coluna de origem ausente na base ⇒ tudo unmatched (sem quebrar)', () => {
    const csv = { headers: ['OUTRA'], columnTypes: { OUTRA: 'decision' },
      ...buildColumnar(['OUTRA'], [['x'], ['y']], { OUTRA: 'decision' }) };
    const col = deriveRangeColumn(csv, def);
    expect(Array.from(col.codes, c => col.dict[c])).toEqual(['Sem valor', 'Sem valor']);
  });

  it('coluna materializada é ORDINAL/dict-encoded (kind dict)', () => {
    const csv = { headers: ['FAT'], columnTypes: { FAT: 'decision' },
      ...buildColumnar(['FAT'], [['50']], { FAT: 'decision' }) };
    const col = deriveRangeColumn(csv, def);
    expect(col.kind).toBe('dict');
  });
});

describe('formatBandLabel · rótulos pt-BR compactos', () => {
  it('até / a / acima de, com sufixos mil/mi/bi', () => {
    expect(formatBandLabel(null, 100)).toBe('até 100');
    expect(formatBandLabel(100, 300)).toBe('100 a 300');
    expect(formatBandLabel(300, null)).toBe('acima de 300');
    expect(formatBandLabel(null, 100000)).toBe('até 100 mil');
    expect(formatBandLabel(1500000, null)).toBe('acima de 1,5 mi');
    expect(formatBandLabel(null, null)).toBe('Todos');
  });
});

describe('sugestão de nome', () => {
  it('suggestRangeVarName é única vs. headers e usa a coluna de origem', () => {
    const model = { col: 'FATURAMENTO' };
    expect(suggestRangeVarName(model, [])).toBe('Faixas de FATURAMENTO');
    expect(suggestRangeVarName(model, ['Faixas de FATURAMENTO'])).toBe('Faixas de FATURAMENTO 2');
  });
});

describe('buildRangeDefFromModel + describeRangeRules', () => {
  const model = {
    col: 'FAT', generatedAt: 't', metric: { id: 'inadReal', label: 'Inad. real' },
    scope: null,
    params: { k: 3, monotonic: true, minShare: 0.05, prebins: 12 },
    quality: { iv: 0.42, ivUniform: 0.2 },
    bands: [
      { min: null, max: 110, rate: 0.02 },
      { min: 110, max: 210, rate: 0.15 },
      { min: 210, max: null, rate: 0.4 },
    ],
  };
  let n = 0;
  const def = buildRangeDefFromModel(model, { col: 'FaixaFat', csvId: 'k', unmatchedLabel: 'Sem valor', genId: () => `id${n++}` });

  it('monta bands a partir do RangeModel com rótulos auto (formatBandLabel)', () => {
    expect(def.col).toBe('FaixaFat');
    expect(def.sourceCol).toBe('FAT');
    expect(def.metric).toEqual({ id: 'inadReal', label: 'Inad. real' });
    expect(def.bands.map(b => [b.label, b.min, b.max])).toEqual([
      ['até 110', null, 110], ['110 a 210', 110, 210], ['acima de 210', 210, null],
    ]);
    expect(def.meta.k).toBe(3);
    expect(def.meta.iv).toBe(0.42);
  });

  it('labels explícitos sobrepõem o rótulo auto', () => {
    let m = 0;
    const custom = buildRangeDefFromModel(model, { col: 'FaixaFat', csvId: 'k', labels: ['Baixo', 'Médio', 'Alto'], genId: () => `x${m++}` });
    expect(custom.bands.map(b => b.label)).toEqual(['Baixo', 'Médio', 'Alto']);
  });

  it('describeRangeRules redige os cortes concretos sem includeDomains', () => {
    const withVals = describeRangeRules(def, true);
    expect(withVals.bands[0]).toEqual({ label: 'até 110', min: null, max: 110 });
    const redacted = describeRangeRules(def, false);
    expect(redacted.bands[0]).toEqual({ label: 'até 110', min: null, max: null });
  });
});

describe('operações de edição puras', () => {
  const base = { col: 'FaixaFat', sourceCol: 'FAT', unmatchedLabel: 'Sem valor', bands: [
    bd('b1', 'Baixo', null, 100), bd('b2', 'Médio', 100, 300), bd('b3', 'Alto', 300, null) ] };

  it('renameRangeBand só troca o label da faixa alvo', () => {
    const nd = renameRangeBand(base, 'b2', 'Médio-alto');
    expect(nd.bands.map(b => b.label)).toEqual(['Baixo', 'Médio-alto', 'Alto']);
    expect(base.bands[1].label).toBe('Médio'); // imutável
  });

  it('editRangeCuts move as fronteiras internas preservando rótulos/contagem de faixas', () => {
    const { def, error } = editRangeCuts(base, [150, 350]);
    expect(error).toBe(null);
    expect(def.bands.map(b => [b.label, b.min, b.max])).toEqual([
      ['Baixo', null, 150], ['Médio', 150, 350], ['Alto', 350, null],
    ]);
  });

  it('rejeita cortes fora de ordem estritamente crescente', () => {
    const { def, error } = editRangeCuts(base, [300, 150]);
    expect(def).toBe(null);
    expect(error).toMatch(/crescente/);
  });

  it('rejeita corte não-numérico e contagem errada de cortes', () => {
    expect(editRangeCuts(base, [150, 'x']).error).toMatch(/número/);
    expect(editRangeCuts(base, [150]).error).toMatch(/2/);
  });
});

describe('integração ponta-a-ponta: RangeModel real → def → coluna materializada', () => {
  it('volumes por faixa da coluna materializada batem com o RangeModel', () => {
    const HEADERS = ['FAT', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'];
    const TYPES = { FAT: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' };
    const row = (fat, inadR) => [String(fat), '1000', '1000', '1000', String(inadR), String(inadR)];
    const LOW = [10, 30, 50, 70, 90].map(fat => row(fat, 18));
    const MID = [110, 130, 150, 170, 190].map(fat => row(fat, 150));
    const HIGH = [210, 230, 250, 270, 290].map(fat => row(fat, 400));
    const rows = [...LOW, ...MID, ...HIGH];
    const csv = { name: 'base', headers: HEADERS, columnTypes: TYPES, varTypes: {}, ...buildColumnar(HEADERS, rows, TYPES) };
    const store = { base: csv };

    const model = computeRiskBands(store, { csvId: 'base', col: 'FAT', metric: 'inadReal', k: 3 });
    expect(model.error).toBe(null);
    expect(model.bands).toHaveLength(3);

    let n = 0;
    const def = buildRangeDefFromModel(model, { col: 'FaixaFat', csvId: 'base', genId: () => `g${n++}` });
    const colData = deriveRangeColumn(csv, def);

    const cnt = {};
    for (let r = 0; r < rowCount(csv); r++) { const v = colData.dict[colData.codes[r]]; cnt[v] = (cnt[v] || 0) + 1; }
    expect(cnt['Sem valor'] || 0).toBe(0); // cobertura total (dados 100% parseáveis)
    for (const band of model.bands) {
      // Cada faixa tem 5 valores distintos × 1000 (qty) de linhas... na verdade aqui
      // são LINHAS (uma por valor distinto), não qty — a coluna materializada conta
      // LINHAS que casam a faixa (5 por nível), que é o que deriveRangeColumn produz.
      expect(cnt[band.label]).toBe(5);
    }
    expect(Object.values(cnt).reduce((a, b) => a + b, 0)).toBe(rows.length);
  });
});

describe('persistência (round-trip de rangeDefs + coluna materializada)', () => {
  it('serializeCsvStore/deserializeCsvStore preservam a definição e a coluna', () => {
    const csv = { name: 'x', headers: ['FAT', 'qty'], columnTypes: { FAT: 'decision', qty: 'qty' }, varTypes: {},
      ...buildColumnar(['FAT', 'qty'], [['50', '1'], ['250', '1']], { FAT: 'decision', qty: 'qty' }) };
    const def = { id: 'i', col: 'Faixa', csvId: 'k', sourceCol: 'FAT', unmatchedLabel: 'Sem valor',
      bands: [bd('b1', 'Baixo', null, 100), bd('b2', 'Alto', 100, null)], source: 'range' };
    const colData = deriveRangeColumn(csv, def);
    const store = { k: { ...csv, headers: [...csv.headers, 'Faixa'],
      columns: { ...csv.columns, Faixa: colData }, columnTypes: { ...csv.columnTypes, Faixa: 'decision' },
      varTypes: { ...csv.varTypes, Faixa: 'ordinal' }, rangeDefs: { Faixa: def } } };
    const round = deserializeCsvStore(JSON.parse(JSON.stringify(serializeCsvStore(store))));
    expect(isRangeVar(round, 'k', 'Faixa')).toBe(true);
    expect(round.k.rangeDefs.Faixa.bands[0].max).toBe(100);
    expect(Array.from(round.k.columns.Faixa.codes, c => round.k.columns.Faixa.dict[c])).toEqual(['Baixo', 'Alto']);
    expect(round.k.varTypes.Faixa).toBe('ordinal');
  });
});
