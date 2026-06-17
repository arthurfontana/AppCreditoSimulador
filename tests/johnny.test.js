import { describe, it, expect } from 'vitest';
import {
  computeCinemaArrivals,
  computeJohnnyData,
} from '../src/simulation.worker.js';

// ── Fixture: losango RISCO (Alto/Neutro/Baixo) → 3 cineminhas G4 (mesmos eixos) ──
// Cada cineminha está plugado num port distinto do losango, então só deve agregar
// as linhas do seu risco. (DEC-JO-001, Sessão A)
const CSV_ID = 'csv1';

function makeCsvStore() {
  return {
    [CSV_ID]: {
      name: 'base',
      headers: ['RISCO', 'G4', 'VOL', 'ALTAS', 'INADR'],
      columnTypes: { RISCO: 'decision', G4: 'decision', VOL: 'qty', ALTAS: 'qtdAltas', INADR: 'inadReal' },
      varTypes: { RISCO: 'categorical', G4: 'categorical' },
      rows: [
        ['Alto',   'A', '100', '50', '10'],
        ['Alto',   'B', '100', '40', '8'],
        ['Neutro', 'A', '100', '30', '3'],
        ['Neutro', 'B', '100', '20', '2'],
        ['Baixo',  'A', '100', '10', '1'],
        ['Baixo',  'B', '100', '5',  '1'],
      ],
    },
  };
}

// Losango RISCO + 3 ports + 3 cineminhas G4.
function makeFlow() {
  const dec = { id: 'dec', type: 'decision', variableCol: 'RISCO', csvId: CSV_ID };
  const ports = ['Alto', 'Neutro', 'Baixo'].map(v => ({ id: `port_${v}`, type: 'port', label: v }));
  const cinemas = ['Alto', 'Neutro', 'Baixo'].map(v => ({
    id: `cine_${v}`, type: 'cineminha', cinemaType: 'eligibility',
    label: `G4-${v}`,
    rowVar: { col: 'G4', csvId: CSV_ID }, colVar: null,
    rowDomain: ['A', 'B'], colDomain: [],
    cells: {},
  }));
  const shapes = [dec, ...ports, ...cinemas];
  const conns = [
    { id: 'c1', from: 'dec', to: 'port_Alto',   label: 'Alto' },
    { id: 'c2', from: 'dec', to: 'port_Neutro', label: 'Neutro' },
    { id: 'c3', from: 'dec', to: 'port_Baixo',  label: 'Baixo' },
    { id: 'c4', from: 'port_Alto',   to: 'cine_Alto',   label: '' },
    { id: 'c5', from: 'port_Neutro', to: 'cine_Neutro', label: '' },
    { id: 'c6', from: 'port_Baixo',  to: 'cine_Baixo',  label: '' },
  ];
  return { shapes, conns };
}

describe('DEC-JO-001 · computeCinemaArrivals respeita o grafo de fluxo', () => {
  it('cada cineminha agrega só as linhas do seu risco a montante', () => {
    const { shapes, conns } = makeFlow();
    const arrivals = computeCinemaArrivals(shapes, conns, makeCsvStore(), {});

    // Alto só vê linhas Alto
    expect(arrivals.cine_Alto['A|*']).toMatchObject({ qty: 100, qtdAltas: 50, inadRRaw: 10 });
    expect(arrivals.cine_Alto['B|*']).toMatchObject({ qty: 100, qtdAltas: 40, inadRRaw: 8 });
    // Neutro só vê linhas Neutro
    expect(arrivals.cine_Neutro['A|*']).toMatchObject({ qty: 100, qtdAltas: 30, inadRRaw: 3 });
    expect(arrivals.cine_Neutro['B|*']).toMatchObject({ qty: 100, qtdAltas: 20, inadRRaw: 2 });
    // Baixo só vê linhas Baixo
    expect(arrivals.cine_Baixo['A|*']).toMatchObject({ qty: 100, qtdAltas: 10, inadRRaw: 1 });
    expect(arrivals.cine_Baixo['B|*']).toMatchObject({ qty: 100, qtdAltas: 5,  inadRRaw: 1 });

    // total = 600 (não 1800 — cada linha conta uma vez)
    const total = ['cine_Alto', 'cine_Neutro', 'cine_Baixo']
      .flatMap(id => Object.values(arrivals[id]))
      .reduce((s, c) => s + c.qty, 0);
    expect(total).toBe(600);
  });

  it('Johnny: as 3 cineminhas exibem inadReal por célula DIFERENTES entre si', () => {
    const { shapes, conns } = makeFlow();
    const result = computeJohnnyData(shapes, conns, makeCsvStore(), {}, ['cine_Alto', 'cine_Neutro', 'cine_Baixo']);
    const pm = result.pooledMetrics;

    // inadReal célula A|* por cineminha (inadRRaw/qtdAltas)
    expect(pm['cine_Alto|A|*'].inadReal).toBeCloseTo(10 / 50);  // 0.20
    expect(pm['cine_Neutro|A|*'].inadReal).toBeCloseTo(3 / 30); // 0.10
    expect(pm['cine_Baixo|A|*'].inadReal).toBeCloseTo(1 / 10);  // 0.10
    // métricas DIFERENTES: Alto distingue-se de Neutro/Baixo
    expect(pm['cine_Alto|A|*'].inadReal).not.toBeCloseTo(pm['cine_Neutro|A|*'].inadReal);
    // qty por célula é 100, não 600 (não a base inteira)
    expect(pm['cine_Alto|A|*'].qty).toBe(100);
  });
});
