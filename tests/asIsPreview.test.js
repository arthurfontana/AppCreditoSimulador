import { describe, it, expect } from 'vitest';
import { computeAsIsCells } from '../src/App.jsx';
import { computeCinemaAsIsCells } from '../src/simulation.worker.js';
import { buildColumnar } from '../src/columnar.js';

// ── GATE — Prévia AS IS contextualizada ao nó (respeita filtros a montante) ──────
// `computeAsIsCells` (main) deriva a prévia sobre a base COMPLETA da interseção.
// `computeCinemaAsIsCells` (worker) deriva a mesma regra, mas só sobre a população que
// chega ao cineminha pelo grafo de fluxo. Este arquivo confere:
//   1. Sem filtro a montante (cineminha é raiz), a versão do worker == computeAsIsCells;
//   2. Com filtro a montante (Decision Lens), a versão do worker DIFERE e reflete só a
//      sub-população;
//   3. Equivalência caminho legado (string[][]) × colunar (dict encoding).

function toColumnar(csv) {
  const { columns, rowCount } = buildColumnar(csv.headers, csv.rows, csv.columnTypes);
  const { rows, ...rest } = csv;
  return { ...rest, columns, rowCount };
}

// Base: eixo linha = GRUPO (G1/G2), eixo coluna = SCORE (R1/R2). AS IS aprova/reprova
// por interseção. Uma coluna SEGMENTO (X/Y) permite filtrar a montante via Decision Lens.
function makeBase() {
  return {
    name: 'base',
    headers: ['GRUPO', 'SCORE', 'SEGMENTO', 'qty', '__DECISAO_ORIGINAL'],
    rows: [
      // G1|R1: seg X aprova, seg Y reprova
      ['G1', 'R1', 'X', '100', 'APROVADO'],
      ['G1', 'R1', 'Y', '80',  'REPROVADO'],
      // G1|R2: 100% reprovado na base completa; mas em seg X é aprovado
      ['G1', 'R2', 'X', '60',  'APROVADO'],
      ['G1', 'R2', 'Y', '90',  'REPROVADO'],
      ['G1', 'R2', 'Y', '30',  'REPROVADO'],
      // G2|R1: só reprovado
      ['G2', 'R1', 'Y', '40',  'REPROVADO'],
      // G2|R2: aprovado
      ['G2', 'R2', 'X', '20',  'APROVADO'],
      // linha sem decisão (ignorada)
      ['G2', 'R1', 'X', '15',  ''],
    ],
    columnTypes: { GRUPO: 'decision', SCORE: 'decision', SEGMENTO: 'decision', qty: 'qty' },
    varTypes: {},
    asIsConfig: { col: 'DEC', mapping: {} },
  };
}

const cinema = {
  id: 'CIN', type: 'cineminha', x: 0, y: 0, w: 200, h: 200,
  cinemaType: 'eligibility',
  rowVar: { col: 'GRUPO', csvId: 'base' },
  colVar: { col: 'SCORE', csvId: 'base' },
  rowDomain: ['G1', 'G2'],
  colDomain: ['R1', 'R2'],
  cells: {},
};

describe('computeCinemaAsIsCells · sem filtro a montante == computeAsIsCells (base completa)', () => {
  for (const mode of ['legacy', 'columnar']) {
    it(`cineminha raiz reproduz a prévia completa (${mode})`, () => {
      const legacyStore = { base: makeBase() };
      const store = mode === 'columnar' ? { base: toColumnar(legacyStore.base) } : legacyStore;
      const shapes = [cinema, { id: 'AP', type: 'approved' }, { id: 'RJ', type: 'rejected' }];
      const conns = [
        { id: 'e1', from: 'CIN', to: 'AP', label: 'Elegível' },
        { id: 'e2', from: 'CIN', to: 'RJ', label: 'Não Elegível' },
      ];
      const full = computeAsIsCells(cinema, legacyStore);
      const ctx = computeCinemaAsIsCells(shapes, conns, store, ['CIN']);
      expect(ctx.CIN).toEqual(full);
      // Base completa: G2|R1 é 100% reprovado → não elegível (0); as demais têm alguma
      // aprovação (G1|R2 é aprovado via seg X) → elegíveis (1).
      expect(full).toEqual({ 'G1|R1': 1, 'G1|R2': 1, 'G2|R1': 0, 'G2|R2': 1 });
    });
  }
});

describe('computeCinemaAsIsCells · com Decision Lens a montante (contextualizado)', () => {
  for (const mode of ['legacy', 'columnar']) {
    it(`só a sub-população SEGMENTO=Y chega ao cineminha (${mode})`, () => {
      const legacyStore = { base: makeBase() };
      const store = mode === 'columnar' ? { base: toColumnar(legacyStore.base) } : legacyStore;
      const shapes = [
        { id: 'LENS', type: 'decision_lens', rules: [{ col: 'SEGMENTO', operator: 'equal', value: 'Y' }] },
        cinema,
        { id: 'AP', type: 'approved' }, { id: 'RJ', type: 'rejected' },
      ];
      const conns = [
        { id: 'e0', from: 'LENS', to: 'CIN' },
        { id: 'e1', from: 'CIN', to: 'AP', label: 'Elegível' },
        { id: 'e2', from: 'CIN', to: 'RJ', label: 'Não Elegível' },
      ];
      const ctx = computeCinemaAsIsCells(shapes, conns, store, ['CIN']);
      // Filtrando por SEGMENTO=Y só chegam linhas reprovadas em G1|R1, G1|R2 e G2|R1
      // (todas 100% reprovadas na sub-população → 0). G2|R2 não tem linha em Y → sem
      // volume decidido → elegível por default (1).
      expect(ctx.CIN).toEqual({ 'G1|R1': 0, 'G1|R2': 0, 'G2|R1': 0, 'G2|R2': 1 });
      // Contraste explícito com a base completa: G1|R1 e G1|R2 eram elegíveis (1) lá.
      const full = computeAsIsCells(cinema, legacyStore);
      expect(full['G1|R1']).toBe(1);
      expect(full['G1|R2']).toBe(1);
    });
  }
});

describe('computeCinemaAsIsCells · dataset sem AS IS → null', () => {
  it('retorna null quando não há __DECISAO_ORIGINAL', () => {
    const csv = makeBase();
    csv.headers = csv.headers.filter(h => h !== '__DECISAO_ORIGINAL');
    csv.rows = csv.rows.map(r => r.slice(0, 4));
    const store = { base: csv };
    const shapes = [cinema, { id: 'AP', type: 'approved' }, { id: 'RJ', type: 'rejected' }];
    const conns = [
      { id: 'e1', from: 'CIN', to: 'AP', label: 'Elegível' },
      { id: 'e2', from: 'CIN', to: 'RJ', label: 'Não Elegível' },
    ];
    const ctx = computeCinemaAsIsCells(shapes, conns, store, ['CIN']);
    expect(ctx.CIN).toBeNull();
  });
});
