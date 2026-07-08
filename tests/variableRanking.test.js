import { describe, it, expect } from 'vitest';
import { computeVariableRanking } from '../src/simulation.worker.js';

// ── GATE Sessão 3 do Copiloto (sugestão de próximo nó — ranking por discriminância) ──
// docs/wiki/Copiloto-ConstrucaoAssistida.md. `computeVariableRanking(shapes, conns,
// csvStore, anchorNodeId)` é uma função PURA: dado um anchor (porta
// solta), ranqueia as colunas Filtro candidatas pelo IV/WoE (+ variância ponderada e
// razão max/min) sobre a população que efetivamente chega ao anchor, detecta
// interação entre as top candidatas e sugere um terminal por risco do segmento.
//
// Fixtures em base legada (`rows: string[][]`) — o motor cai no caminho por-linha
// (fallback do M8), mesma matemática do caminho colunar.

describe('variableRanking · IV bate com controle manual + população restrita ao port', () => {
  // D0 (variável SEGMENT) → pIn ("IN", nosso anchor — solta, sem saída) e pOut ("OUT"
  // → Aprovado). A variável A separa perfeitamente a inad. (V1 = 50%, V2 = 10%); a
  // variável B não separa nada (K1 = K2 = 30%). As 4 linhas "IN" formam a população do
  // anchor; a linha "OUT" (qty/altas/maus = 999) fica de fora — se a restrição de
  // população estivesse quebrada (contasse a base inteira), os números abaixo NÃO bateriam.
  const shapes = [
    { id: 'D0', type: 'decision', label: 'Segmento', variableCol: 'SEGMENT', csvId: 'base' },
    { id: 'pIn', type: 'port', label: 'IN' },
    { id: 'pOut', type: 'port', label: 'OUT' },
    { id: 'AP', type: 'approved', label: 'Aprovado' },
  ];
  const conns = [
    { id: 'c1', from: 'D0', to: 'pIn', label: 'IN' },
    { id: 'c2', from: 'D0', to: 'pOut', label: 'OUT' },
    { id: 'c3', from: 'pOut', to: 'AP' },
    // pIn não tem NENHUMA conexão de saída — porta solta, nosso anchor.
  ];
  const csv = {
    headers: ['SEGMENT', 'A', 'B', 'qty', 'qtdAltas', 'inadReal'],
    columnTypes: { SEGMENT: 'decision', A: 'decision', B: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
    rows: [
      ['IN', 'V1', 'K1', '100', '100', '50'],
      ['IN', 'V1', 'K2', '100', '100', '50'],
      ['IN', 'V2', 'K1', '100', '100', '10'],
      ['IN', 'V2', 'K2', '100', '100', '10'],
      ['OUT', 'V1', 'K1', '999', '999', '999'],
    ],
  };
  const csvStore = { base: csv };

  it('restringe a população ao anchor (exclui a linha OUT) e usa métrica real', () => {
    const result = computeVariableRanking(shapes, conns, csvStore, 'pIn', null);
    expect(result.error).toBeUndefined();
    expect(result.csvId).toBe('base');
    expect(result.metric).toBe('real');
    expect(result.population.qty).toBe(400);
    expect(result.population.altas).toBe(400);
    expect(result.population.maus).toBe(120);
    expect(result.population.rate).toBeCloseTo(0.3, 10);
  });

  it('exclui SEGMENT (já testado no ancestral D0) dos candidatos', () => {
    const result = computeVariableRanking(shapes, conns, csvStore, 'pIn', null);
    const cols = result.ranking.map(r => r.col);
    expect(cols).not.toContain('SEGMENT');
    expect(cols.sort()).toEqual(['A', 'B']);
  });

  it('IV(A) bate com o valor de controle calculado à mão (~1,0463); IV(B) = 0', () => {
    const result = computeVariableRanking(shapes, conns, csvStore, 'pIn', null);
    const a = result.ranking.find(r => r.col === 'A');
    const b = result.ranking.find(r => r.col === 'B');
    // Controle manual (WoE clássico, sem bins zerados — sem smoothing):
    //   totalGood=280, totalBad=120; V1: good=100,bad=100; V2: good=180,bad=20
    //   IV = (100/280-100/120)*ln(...) + (180/280-20/120)*ln(...) ≈ 1.0463
    expect(a.iv).toBeCloseTo(1.0463, 3);
    expect(b.iv).toBeCloseTo(0, 10);
  });

  it('variância ponderada e razão max/min também batem com o controle manual', () => {
    const result = computeVariableRanking(shapes, conns, csvStore, 'pIn', null);
    const a = result.ranking.find(r => r.col === 'A');
    const b = result.ranking.find(r => r.col === 'B');
    expect(a.variance).toBeCloseTo(0.04, 10);
    expect(a.maxMinRatio).toBeCloseTo(5, 10);
    expect(b.variance).toBeCloseTo(0, 10);
    expect(b.maxMinRatio).toBeCloseTo(1, 10);
  });

  it('ranking vem ordenado por IV decrescente (A antes de B)', () => {
    const result = computeVariableRanking(shapes, conns, csvStore, 'pIn', null);
    expect(result.ranking.map(r => r.col)).toEqual(['A', 'B']);
  });

  it('bins de A trazem os dois valores distintos com taxa por valor', () => {
    const result = computeVariableRanking(shapes, conns, csvStore, 'pIn', null);
    const a = result.ranking.find(r => r.col === 'A');
    expect(a.bins.map(b => b.value)).toEqual(['V1', 'V2']);
    expect(a.bins.find(b => b.value === 'V1').rate).toBeCloseTo(0.5, 10);
    expect(a.bins.find(b => b.value === 'V2').rate).toBeCloseTo(0.1, 10);
  });

  it('autocompletar: segmento (30%) bem melhor que a média do dataset inteiro (~80%) → sugere Aprovado', () => {
    const result = computeVariableRanking(shapes, conns, csvStore, 'pIn', null);
    // Baseline = base INTEIRA (incl. a linha OUT): maus=1119, altas=1399 → ~0,7999
    expect(result.population.baselineRate).toBeCloseTo(1119 / 1399, 10);
    expect(result.population.ratio).toBeCloseTo(0.3 / (1119 / 1399), 6);
    expect(result.population.suggestedTerminal).toBe('approved');
  });
});

describe('variableRanking · detecção de interação sugere Cineminha', () => {
  // A e B, isoladamente, não separam nada (IV = 0 cada — padrão XOR clássico), mas a
  // combinação A×B separa perfeitamente (rate 100% em duas caselas, 0% nas outras
  // duas) — IV conjunto >> IV(A)+IV(B).
  const shapes = [
    { id: 'D0', type: 'decision', label: 'Gate', variableCol: 'GATE', csvId: 'base2' },
    { id: 'pAnchor', type: 'port', label: 'ALL' },
  ];
  const conns = [
    { id: 'c1', from: 'D0', to: 'pAnchor', label: 'ALL' },
  ];
  const csv = {
    headers: ['GATE', 'A', 'B', 'qty', 'qtdAltas', 'inadReal'],
    columnTypes: { GATE: 'decision', A: 'decision', B: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
    rows: [
      ['ALL', 'a1', 'b1', '100', '100', '100'], // rate 1.0
      ['ALL', 'a1', 'b2', '100', '100', '0'],   // rate 0.0
      ['ALL', 'a2', 'b1', '100', '100', '0'],   // rate 0.0
      ['ALL', 'a2', 'b2', '100', '100', '100'], // rate 1.0
    ],
  };
  const csvStore = { base2: csv };

  it('IV(A) e IV(B) marginais são zero (nenhuma separação isolada)', () => {
    const result = computeVariableRanking(shapes, conns, csvStore, 'pAnchor', null);
    expect(result.ranking.find(r => r.col === 'A').iv).toBeCloseTo(0, 10);
    expect(result.ranking.find(r => r.col === 'B').iv).toBeCloseTo(0, 10);
  });

  it('IV conjunto(A×B) ≈ 10,6066 (controle manual com smoothing nos 4 bins) e sugere Cineminha', () => {
    const result = computeVariableRanking(shapes, conns, csvStore, 'pAnchor', null);
    const inter = result.interactions.find(i =>
      (i.colA === 'A' && i.colB === 'B') || (i.colA === 'B' && i.colB === 'A')
    );
    expect(inter).toBeTruthy();
    expect(inter.ivJoint).toBeCloseTo(10.6066, 3);
    expect(inter.suggestCinema).toBe(true);
  });
});

describe('variableRanking · autocompletar de terminal por risco do segmento', () => {
  it('segmento com inad. bem acima da média (~1,88×) → sugere Reprovado', () => {
    const shapes = [
      { id: 'D0', type: 'decision', label: 'Seg', variableCol: 'SEG', csvId: 'baseR' },
      { id: 'pBad', type: 'port', label: 'BAD' },
      { id: 'pGood', type: 'port', label: 'GOOD' },
      { id: 'AP', type: 'approved' },
    ];
    const conns = [
      { id: 'c1', from: 'D0', to: 'pBad', label: 'BAD' },
      { id: 'c2', from: 'D0', to: 'pGood', label: 'GOOD' },
      { id: 'c3', from: 'pGood', to: 'AP' },
      // pBad solta — nosso anchor.
    ];
    const csv = {
      headers: ['SEG', 'qty', 'qtdAltas', 'inadReal'],
      columnTypes: { SEG: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
      rows: [
        ['BAD', '100', '100', '80'],
        ['GOOD', '100', '100', '5'],
      ],
    };
    const result = computeVariableRanking(shapes, conns, { baseR: csv }, 'pBad', null);
    expect(result.population.rate).toBeCloseTo(0.8, 10);
    expect(result.population.baselineRate).toBeCloseTo(85 / 200, 10);
    expect(result.population.ratio).toBeGreaterThan(1.2);
    expect(result.population.suggestedTerminal).toBe('rejected');
  });

  it('segmento sem sinal (0 altas) → sugere AS IS', () => {
    const shapes = [
      { id: 'D0', type: 'decision', label: 'Seg', variableCol: 'SEG', csvId: 'baseN' },
      { id: 'pNew', type: 'port', label: 'NEW' },
      { id: 'pOld', type: 'port', label: 'OLD' },
      { id: 'AP', type: 'approved' },
    ];
    const conns = [
      { id: 'c1', from: 'D0', to: 'pNew', label: 'NEW' },
      { id: 'c2', from: 'D0', to: 'pOld', label: 'OLD' },
      { id: 'c3', from: 'pOld', to: 'AP' },
      // pNew solta — nosso anchor: propostas novas, sem histórico de conversão.
    ];
    const csv = {
      headers: ['SEG', 'qty', 'qtdAltas', 'inadReal'],
      columnTypes: { SEG: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
      rows: [
        ['NEW', '50', '0', '0'],
        ['OLD', '100', '100', '20'],
      ],
    };
    const result = computeVariableRanking(shapes, conns, { baseN: csv }, 'pNew', null);
    expect(result.population.rate).toBeNull();
    expect(result.population.suggestedTerminal).toBe('as_is');
  });
});

describe('variableRanking · erros', () => {
  it('anchor inexistente → error anchor_not_found', () => {
    const result = computeVariableRanking([], [], {}, 'nope', null);
    expect(result.error).toBe('anchor_not_found');
  });

  it('anchor inalcançável a partir de qualquer raiz → error no_population', () => {
    const shapes = [
      { id: 'D0', type: 'decision', label: 'X', variableCol: 'X', csvId: 'base' },
      { id: 'pX', type: 'port', label: 'x' },
      { id: 'pIsolated', type: 'port', label: 'isolado' }, // sem conexão de entrada
    ];
    const conns = [
      { id: 'c1', from: 'D0', to: 'pX', label: 'x' },
    ];
    const csv = {
      headers: ['X', 'qty'],
      columnTypes: { X: 'decision', qty: 'qty' },
      rows: [['x', '100']],
    };
    const result = computeVariableRanking(shapes, conns, { base: csv }, 'pIsolated', null);
    expect(result.error).toBe('no_population');
  });
});
