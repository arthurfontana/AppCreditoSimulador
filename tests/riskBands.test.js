import { describe, it, expect } from 'vitest';
import { buildColumnar } from '../src/columnar.js';
import {
  computeRiskBands,
  isContinuousColumn,
  computeIV,
  resolveScopeRowMask,
} from '../src/simulation.worker.js';

// ── GATE — Criar Faixas por Risco (Épico FR, Sessão FR4, DEC-FR-004/005/006/010) ──
// Binning SUPERVISIONADO por IV/WoE sobre uma coluna contínua: agregação por distinto →
// pré-bins por quantis ponderados → DP EXATA maximizando IV (monotonia default/minShare)
// → auto-k por ganho marginal → ivUniform de referência; banda "Sem valor"; erros
// declarados; escopo por nó ≡ sub-base; determinismo. Reusa computeIV/resolveRiskMetric.

const HEADERS = ['FAT', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'];
const TYPES = {
  FAT: 'decision', qty: 'qty', qtdAltas: 'qtdAltas',
  qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida',
};

// Uma linha por (valor contínuo): qty/altas dados, inferida = espelho da real.
const row = (fat, qty, altas, inadR) =>
  [String(fat), String(qty), String(altas), String(altas), String(inadR), String(inadR)];

const columnarCsv = (headers, rows, columnTypes) => ({
  name: 'db', headers, columnTypes, ...buildColumnar(headers, rows, columnTypes),
});
const storeOf = (rows, headers = HEADERS, types = TYPES) => ({ db: columnarCsv(headers, rows, types) });
const stripTime = (m) => JSON.stringify({ ...m, generatedAt: null });

// ── Fixtura planted3: 3 níveis de risco bem separados, corte natural em 110 e 210 ──
// low  (10..90):  inad ~2%   · mid (110..190): inad ~15%  · high (210..290): inad ~40%
// Jitter minúsculo por nível (rates quase idênticas dentro do nível) ⇒ separar DENTRO de
// um nível quase não adiciona IV (usado pelo GATE de auto-k).
const LOW = [[10, 18], [30, 20], [50, 22], [70, 19], [90, 21]];
const MID = [[110, 140], [130, 150], [150, 160], [170, 145], [190, 155]];
const HIGH = [[210, 380], [230, 400], [250, 420], [270, 390], [290, 410]];
const planted3Rows = [...LOW, ...MID, ...HIGH].map(([fat, inadR]) => row(fat, 1000, 1000, inadR));

describe('riskBands · DP encontra os cortes plantados', () => {
  it('GATE 1 — dois cortes plantados de inadimplência (k=3) caem exatamente em 110 e 210', () => {
    const model = computeRiskBands(storeOf(planted3Rows), { csvId: 'db', col: 'FAT', metric: 'inadReal', k: 3 });
    expect(model.error).toBe(null);
    expect(model.bands).toHaveLength(3);
    expect(model.bands.map(b => [b.min, b.max])).toEqual([[null, 110], [110, 210], [210, null]]);
    // taxas por faixa: ~2% / ~15% / ~40% (monotônico crescente por padrão)
    expect(model.quality.monotonic).toBe('inc');
    const rates = model.bands.map(b => b.rate);
    expect(rates[0]).toBeLessThan(rates[1]);
    expect(rates[1]).toBeLessThan(rates[2]);
  });

  it('GATE 2 — IV das faixas ≡ computeIV aplicado à mão nos MESMOS bins', () => {
    const model = computeRiskBands(storeOf(planted3Rows), { csvId: 'db', col: 'FAT', metric: 'inadReal', k: 3 });
    // Reconstrói os bins {altas, maus} à mão a partir dos níveis plantados.
    const sum = (arr) => arr.reduce((s, [, inadR]) => s + inadR, 0);
    const expected = computeIV([
      { altas: 5000, maus: sum(LOW) },   // 100
      { altas: 5000, maus: sum(MID) },   // 750
      { altas: 5000, maus: sum(HIGH) },  // 2000
    ]);
    expect(model.quality.iv).toBeCloseTo(expected, 12);
    // E cada banda carrega num/den corretos (agregação exata, nunca estimada).
    expect(model.bands.map(b => [b.den, b.num])).toEqual([
      [5000, sum(LOW)], [5000, sum(MID)], [5000, sum(HIGH)],
    ]);
  });
});

describe('riskBands · monotonia', () => {
  it('GATE 3 — direção decrescente detectada automaticamente em fixture decrescente', () => {
    // Espelho de planted3: valores baixos = alto risco; valores altos = baixo risco.
    const descRows = [
      ...LOW.map(([fat]) => row(fat, 1000, 1000, 400)),
      ...MID.map(([fat]) => row(fat, 1000, 1000, 150)),
      ...HIGH.map(([fat]) => row(fat, 1000, 1000, 20)),
    ];
    const model = computeRiskBands(storeOf(descRows), { csvId: 'db', col: 'FAT', metric: 'inadReal', k: 3 });
    expect(model.error).toBe(null);
    expect(model.quality.monotonic).toBe('dec');
    const rates = model.bands.map(b => b.rate);
    expect(rates[0]).toBeGreaterThan(rates[1]);
    expect(rates[1]).toBeGreaterThan(rates[2]);
    expect(model.bands.map(b => [b.min, b.max])).toEqual([[null, 110], [110, 210], [210, null]]);
  });

  it('GATE 4 — toggle livre acha o "U" que o monotônico não pode, com IV maior', () => {
    // U plantado: extremos de alto risco, meio de baixo risco (não-monotônico).
    const uRows = [
      row(10, 1000, 1000, 400), row(30, 1000, 1000, 410), row(50, 1000, 1000, 390),
      row(110, 1000, 1000, 40), row(130, 1000, 1000, 45), row(150, 1000, 1000, 38),
      row(210, 1000, 1000, 405), row(230, 1000, 1000, 395), row(250, 1000, 1000, 415),
    ];
    const mono = computeRiskBands(storeOf(uRows), { csvId: 'db', col: 'FAT', metric: 'inadReal', k: 3, monotonic: true });
    const free = computeRiskBands(storeOf(uRows), { csvId: 'db', col: 'FAT', metric: 'inadReal', k: 3, monotonic: false });
    expect(mono.error).toBe(null);
    expect(free.error).toBe(null);
    // O livre separa o U (baixo no meio) — não-monotônico e com IV estritamente maior.
    expect(free.bands.map(b => [b.min, b.max])).toEqual([[null, 110], [110, 210], [210, null]]);
    expect(free.quality.monotonic).toBe(null);
    expect(free.quality.iv).toBeGreaterThan(mono.quality.iv + 1e-9);
    // O monotônico continua viável (selo declarado, nunca erro) — ambos os IVs existem.
    expect(mono.quality.monotonic === 'inc' || mono.quality.monotonic === 'dec').toBe(true);
    expect(typeof mono.quality.iv).toBe('number');
  });
});

describe('riskBands · piso de volume e banda "Sem valor"', () => {
  it('GATE 5 — minShare bloqueia faixa anã ⇒ infeasible no k impossível', () => {
    // 3 faixas com piso 40% cada seria 120% do volume — sem solução.
    const model = computeRiskBands(storeOf(planted3Rows), { csvId: 'db', col: 'FAT', metric: 'inadReal', k: 3, minShare: 0.4 });
    expect(model.error).toBe('infeasible');
    expect(model.bands).toHaveLength(0);
    expect(model.params.k).toBe(3);
  });

  it('GATE 6 — "Sem valor" agrega EXATAMENTE os não parseáveis, fora da otimização', () => {
    const rows = [
      ...planted3Rows,
      row('N/A', 200, 200, 50),
      row('', 300, 300, 30),
      row('-', 100, 100, 10),
    ];
    const model = computeRiskBands(storeOf(rows), { csvId: 'db', col: 'FAT', metric: 'inadReal', k: 3 });
    expect(model.error).toBe(null);
    expect(model.unmatched).not.toBe(null);
    expect(model.unmatched.qty).toBe(600);           // 200+300+100
    expect(model.unmatched.rate).toBeCloseTo(90 / 600, 12); // (50+30+10)/(200+300+100)
    expect(model.unmatched.share).toBeCloseTo(600 / 15600, 12);
    // As faixas seguem sobre APENAS o volume parseável (15000), não os 15600.
    const bandQty = model.bands.reduce((s, b) => s + b.qty, 0);
    expect(bandQty).toBe(15000);
    expect(model.bands.map(b => [b.min, b.max])).toEqual([[null, 110], [110, 210], [210, null]]);
  });
});

describe('riskBands · auto-k', () => {
  it('GATE 7 — auto-k para na regra de ganho marginal (3 níveis ⇒ k=3)', () => {
    const model = computeRiskBands(storeOf(planted3Rows), { csvId: 'db', col: 'FAT', metric: 'inadReal', autoK: true });
    expect(model.error).toBe(null);
    expect(model.params.k).toBe(3);
    expect(model.params.autoK).toBe(true);
    // Critério DECLARADO (nunca silencioso): a razão menciona o k rejeitado.
    expect(model.quality.autoKReason).toMatch(/k=4/);
  });
});

describe('riskBands · escopo por nó ≡ sub-base', () => {
  // Política D1(GRP): A → pA → ❌ ; B → pB → ✅. Escopo pA ⇒ só as linhas GRP=A. As linhas
  // GRP=B carregam um FAT de risco achatado que, se vazasse, mudaria os cortes.
  const SCOPE_HEADERS = ['GRP', 'FAT', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida'];
  const SCOPE_TYPES = {
    GRP: 'decision', FAT: 'decision', qty: 'qty', qtdAltas: 'qtdAltas',
    qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida',
  };
  const srow = (grp, fat, inadR) => [grp, String(fat), '1000', '1000', '1000', String(inadR), String(inadR)];
  const aRows = [
    srow('A', 10, 18), srow('A', 30, 20), srow('A', 50, 22),
    srow('A', 110, 140), srow('A', 130, 150), srow('A', 150, 160),
    srow('A', 210, 380), srow('A', 230, 400), srow('A', 250, 420),
  ];
  const bRows = [srow('B', 60, 300), srow('B', 160, 300), srow('B', 260, 300)];
  const shapes = [
    { id: 'D1', type: 'decision', label: 'Grupo', variableCol: 'GRP', csvId: 'db' },
    { id: 'pA', type: 'port', label: 'Porte A' },
    { id: 'pB', type: 'port', label: 'Porte B' },
    { id: 'REJ', type: 'rejected', label: 'Reprovado' },
    { id: 'AP', type: 'approved', label: 'Aprovado' },
  ];
  const conns = [
    { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
    { id: 'c2', from: 'pA', to: 'REJ' },
    { id: 'c3', from: 'D1', to: 'pB', label: 'B' },
    { id: 'c4', from: 'pB', to: 'AP' },
  ];

  it('GATE 8 — faixas escopadas ao nó ≡ faixas sobre a sub-base filtrada à mão', () => {
    const fullStore = { db: columnarCsv(SCOPE_HEADERS, [...aRows, ...bRows], SCOPE_TYPES) };
    const subStore = { db: columnarCsv(SCOPE_HEADERS, aRows, SCOPE_TYPES) };
    const scoped = computeRiskBands(fullStore, { csvId: 'db', col: 'FAT', metric: 'inadReal', k: 3 },
      { shapes, conns, scope: { nodeId: 'pA', label: 'Porte A' } });
    const sub = computeRiskBands(subStore, { csvId: 'db', col: 'FAT', metric: 'inadReal', k: 3 });
    expect(scoped.error).toBe(null);
    expect(scoped.scope).toEqual({ nodeId: 'pA', label: 'Porte A' });
    // Número a número: faixas, IV/ivUniform/monotonia idênticos aos da sub-base.
    expect(scoped.bands).toEqual(sub.bands);
    expect(scoped.quality).toEqual(sub.quality);
    // Prova que a máscara filtra ANTES de agregar: com B vazando, o corte mudaria.
    const leaked = computeRiskBands(fullStore, { csvId: 'db', col: 'FAT', metric: 'inadReal', k: 3 });
    expect(leaked.bands).not.toEqual(sub.bands);
    // Coerência do próprio walk (FR1): a máscara de pA marca exatamente as 9 linhas A.
    const masks = resolveScopeRowMask(shapes, conns, fullStore, 'pA');
    expect(Array.from(masks.db).reduce((s, v) => s + v, 0)).toBe(aRows.length);
  });
});

describe('riskBands · determinismo', () => {
  it('GATE 9 — duas execuções são byte-idênticas (mesma entrada ⇒ mesmo RangeModel)', () => {
    const a = computeRiskBands(storeOf(planted3Rows), { csvId: 'db', col: 'FAT', metric: 'inadReal', autoK: true });
    const b = computeRiskBands(storeOf(planted3Rows), { csvId: 'db', col: 'FAT', metric: 'inadReal', autoK: true });
    expect(stripTime(a)).toBe(stripTime(b));
  });
});

describe('riskBands · isContinuousColumn (DEC-FR-004, gating da UI)', () => {
  // 40 linhas: FATC (40 distintos numéricos, 100% parseável) ⇒ contínua; REG (categórica,
  // 5 distintos) ⇒ não; FEW (10 distintos numéricos) ⇒ não (< 30); MIX (33 distintos, 20%
  // do volume não parseável) ⇒ não (< 90%). qty por 'coluna' via a coluna qty comum.
  const cHeaders = ['FATC', 'REG', 'FEW', 'MIX', 'qty'];
  const cTypes = { FATC: 'decision', REG: 'decision', FEW: 'decision', MIX: 'decision', qty: 'qty' };
  const cRows = [];
  for (let i = 0; i < 40; i++) {
    cRows.push([
      String(1000 + i),          // FATC — 40 distintos numéricos
      'R' + (i % 5),             // REG — 5 categorias
      String(i % 10),            // FEW — 10 distintos numéricos
      i < 8 ? 'N/A' : String(i), // MIX — 8 linhas (20% do volume) não parseáveis
      '100',
    ]);
  }
  const csv = columnarCsv(cHeaders, cRows, cTypes);

  it('contínua só quando Filtro + ≥30 distintos + ≥90% do volume parseável', () => {
    expect(isContinuousColumn(csv, 'FATC')).toBe(true);
    expect(isContinuousColumn(csv, 'REG')).toBe(false);  // categórica / poucos distintos
    expect(isContinuousColumn(csv, 'FEW')).toBe(false);  // < 30 distintos
    expect(isContinuousColumn(csv, 'MIX')).toBe(false);  // < 90% parseável
    expect(isContinuousColumn(csv, 'qty')).toBe(false);  // não é coluna Filtro ('decision')
    expect(isContinuousColumn(csv, 'INEXISTENTE')).toBe(false);
  });
});
