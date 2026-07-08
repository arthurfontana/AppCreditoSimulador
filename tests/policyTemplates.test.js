import { describe, it, expect } from 'vitest';
import {
  buildPolicyIR,
  applyPolicyPatch,
  extractPolicyRequiredVars,
  applyPolicyVarMapping,
} from '../src/App.jsx';
import {
  computeSimulationTick,
  computeSimulatedDecisions,
  computeLensPopulations,
} from '../src/simulation.worker.js';
import { buildColumnar } from '../src/columnar.js';

// ── GATE Sessão 2 do Copiloto (Biblioteca de Políticas) ──────────────────────────
// A biblioteca salva o PolicyIR (Sessão 0) + metadados; aplicar um template mapeia
// as variáveis exigidas (extractPolicyRequiredVars) para colunas do dataset atual
// (applyPolicyVarMapping) ANTES de materializar via o único aplicador da DEC-IA-002
// (applyPolicyPatch). Este GATE confere:
//   1. Salvar → aplicar em base com colunas RENOMEADAS via mapeamento → o roteamento
//      resultante é equivalente ao original (mesmos agregados, mesma decisão por linha);
//   2. Variável sem mapeamento vira pendência (nó sem variável), nunca erro nem
//      aplicação parcial silenciosa de outra coluna.

function toColumnarStore(store) {
  const out = {};
  for (const [id, csv] of Object.entries(store)) {
    const { columns, rowCount } = buildColumnar(csv.headers, csv.rows, csv.columnTypes);
    const { rows, ...rest } = csv;
    out[id] = { ...rest, columns, rowCount };
  }
  return out;
}

function tickOf(shapes, conns, csvStore) {
  const { populations } = computeLensPopulations(shapes, csvStore);
  return { tick: computeSimulationTick(shapes, conns, csvStore, null, populations), populations };
}

// ── Fixture: lens(CANAL) → decisão(GRUPO) → cineminha(FAIXA × CANAL) → AP/AS ─────
// Mesmo desenho do fluxo integrado de tests/policyIR.test.js — três variáveis
// exigidas (CANAL aparece tanto na regra do lens quanto no eixo de coluna do
// Cineminha; GRUPO e FAIXA vêm de losango/eixo de linha).
const ROWS = [
  ['LOJA', 'G1', 'F1', '100', '40', '38', '4', '3.5', 'APROVADO'],
  ['LOJA', 'G1', 'F2', '50', '20', '18', '2', '1.8', 'REPROVADO'],
  ['PAP', 'G2', 'F1', '80', '30', '28', '3', '2.5', 'APROVADO'],
  ['LOJA', 'G2', 'F2', '20', '5', '4', '1', '0.8', 'REPROVADO'],
  ['APP', 'G3', 'F1', '10', '2', '2', '0.5', '0.4', ''],
];
const METRIC_HEADERS = ['qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida', '__DECISAO_ORIGINAL'];
const METRIC_TYPES = { qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer', inadReal: 'inadReal', inadInferida: 'inadInferida' };

const SRC_STORE = {
  base: {
    name: 'base',
    headers: ['CANAL', 'GRUPO', 'FAIXA', ...METRIC_HEADERS],
    rows: ROWS,
    columnTypes: { CANAL: 'decision', GRUPO: 'decision', FAIXA: 'decision', ...METRIC_TYPES },
    varTypes: {},
    asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
  },
};

// Mesma base, colunas de decisão RENOMEADAS (dataset "de outro cliente/mês") —
// mesmos valores, mesma ordem de linhas.
const TGT_STORE = {
  base2: {
    name: 'base2',
    headers: ['CANAL_NOVO', 'GRUPO_2', 'FAIXA_X', ...METRIC_HEADERS],
    rows: ROWS,
    columnTypes: { CANAL_NOVO: 'decision', GRUPO_2: 'decision', FAIXA_X: 'decision', ...METRIC_TYPES },
    varTypes: {},
    asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
  },
};

function integratedFlow(csvId) {
  return {
    shapes: [
      { id: 'L', type: 'decision_lens', rules: [{ col: 'CANAL', operator: 'notEqual', value: 'APP', logic: null }] },
      { id: 'D', type: 'decision', variableCol: 'GRUPO', csvId },
      { id: 'pG1', type: 'port', label: 'G1' },
      { id: 'pG2', type: 'port', label: 'G2' },
      { id: 'CIN', type: 'cineminha', cinemaType: 'eligibility',
        rowVar: { col: 'FAIXA', csvId }, colVar: { col: 'CANAL', csvId },
        rowDomain: ['F1', 'F2'], colDomain: ['LOJA', 'PAP'],
        cells: { 'F2|LOJA': false, 'F1|PAP': false } },
      { id: 'pE', type: 'port', label: 'Elegível' },
      { id: 'pN', type: 'port', label: 'Não Elegível' },
      { id: 'AP', type: 'approved' },
      { id: 'AS', type: 'as_is' },
    ],
    conns: [
      { id: 'c0', from: 'L', to: 'D' },
      { id: 'c1', from: 'D', to: 'pG1', label: 'G1' },
      { id: 'c2', from: 'D', to: 'pG2', label: 'G2' },
      { id: 'c3', from: 'pG1', to: 'CIN' },
      { id: 'c4', from: 'pG2', to: 'CIN' },
      { id: 'c5', from: 'CIN', to: 'pE', label: 'Elegível' },
      { id: 'c6', from: 'CIN', to: 'pN', label: 'Não Elegível' },
      { id: 'c7', from: 'pE', to: 'AP' },
      { id: 'c8', from: 'pN', to: 'AS' },
    ],
  };
}

describe('extractPolicyRequiredVars', () => {
  it('lista uma entrada por NOME distinto; kind decision prevalece sobre any', () => {
    const { shapes, conns } = integratedFlow('base');
    const csvStore = toColumnarStore(SRC_STORE);
    const ir = buildPolicyIR(shapes, conns, csvStore);
    const req = extractPolicyRequiredVars(ir);
    const byCol = Object.fromEntries(req.map(r => [r.col, r]));

    expect(Object.keys(byCol).sort()).toEqual(['CANAL', 'FAIXA', 'GRUPO']);
    // CANAL aparece na regra do lens (any) E no eixo de coluna do Cineminha
    // (decision) — o resultado precisa ser 'decision' (mais restritivo), não 'any'.
    expect(byCol.CANAL.kind).toBe('decision');
    expect(byCol.GRUPO.kind).toBe('decision');
    expect(byCol.FAIXA.kind).toBe('decision');
    // Cada entrada aparece exatamente uma vez (dedupe por nome, não por nó).
    expect(req.length).toBe(3);
  });

  it('coluna de regra de lens que NÃO aparece em nenhum losango/eixo fica kind "any"', () => {
    const ir = buildPolicyIR(
      [
        { id: 'L', type: 'decision_lens', rules: [{ col: 'SCORE_NUM', operator: 'gte', value: '500', logic: null }] },
        { id: 'AP', type: 'approved' },
      ],
      [{ id: 'c0', from: 'L', to: 'AP' }],
      {},
    );
    const req = extractPolicyRequiredVars(ir);
    expect(req).toEqual([{ col: 'SCORE_NUM', csvId: null, csvName: null, kind: 'any' }]);
  });

  it('IR sem nós referenciando coluna nenhuma → lista vazia', () => {
    const ir = buildPolicyIR([{ id: 'AP', type: 'approved' }], [], {});
    expect(extractPolicyRequiredVars(ir)).toEqual([]);
  });
});

describe('applyPolicyVarMapping', () => {
  it('remapeia variable/rowVar/colVar/rules[].col conforme o mapping', () => {
    const ir = {
      nodes: [
        { id: 'D', kind: 'decision', variable: { col: 'GRUPO', csvId: 'base' }, routes: [] },
        { id: 'CIN', kind: 'cinema', rowVar: { col: 'FAIXA', csvId: 'base' }, colVar: { col: 'CANAL', csvId: 'base' } },
        { id: 'L', kind: 'lens', rules: [{ col: 'CANAL', operator: 'equal', value: 'LOJA', logic: null }] },
      ],
    };
    const mapping = {
      GRUPO: { col: 'GRUPO_2', csvId: 'base2' },
      FAIXA: { col: 'FAIXA_X', csvId: 'base2' },
      CANAL: { col: 'CANAL_NOVO', csvId: 'base2' },
    };
    const out = applyPolicyVarMapping(ir, mapping);
    expect(out.nodes[0].variable).toEqual({ col: 'GRUPO_2', csvId: 'base2' });
    expect(out.nodes[1].rowVar).toEqual({ col: 'FAIXA_X', csvId: 'base2' });
    expect(out.nodes[1].colVar).toEqual({ col: 'CANAL_NOVO', csvId: 'base2' });
    // Lens rule só recebe o nome da coluna (sem csvId — casa por nome em runtime).
    expect(out.nodes[2].rules[0].col).toBe('CANAL_NOVO');
    expect(out.nodes[2].rules[0].operator).toBe('equal'); // resto da regra intocado
  });

  it('variável sem entrada no mapping (ou null) vira pendência: null, não erro', () => {
    const ir = {
      nodes: [
        { id: 'D', kind: 'decision', variable: { col: 'GRUPO', csvId: 'base' }, routes: [] },
        { id: 'CIN', kind: 'cinema', rowVar: { col: 'FAIXA', csvId: 'base' }, colVar: null },
        { id: 'L', kind: 'lens', rules: [{ col: 'CANAL', operator: 'equal', value: 'LOJA', logic: null }] },
      ],
    };
    expect(() => applyPolicyVarMapping(ir, { GRUPO: null })).not.toThrow();
    const out = applyPolicyVarMapping(ir, { GRUPO: null });
    expect(out.nodes[0].variable).toBeNull();
    expect(out.nodes[1].rowVar).toBeNull(); // não mapeado (ausente do mapping)
    expect(out.nodes[1].colVar).toBeNull(); // já era null no IR original
    expect(out.nodes[2].rules[0].col).toBeNull();
  });
});

describe('Biblioteca de Políticas · salvar → aplicar em base com colunas renomeadas', () => {
  it('mapeamento completo: roteamento resultante equivalente (agregados + decisão por linha)', () => {
    const { shapes: srcShapes, conns: srcConns } = integratedFlow('base');
    const srcColumnar = toColumnarStore(SRC_STORE);
    const ir = buildPolicyIR(srcShapes, srcConns, srcColumnar, { name: 'Template Teste' });
    const requiredVars = extractPolicyRequiredVars(ir);
    expect(requiredVars.map(r => r.col).sort()).toEqual(['CANAL', 'FAIXA', 'GRUPO']);

    // "Modal de mapeamento" simulado: usuário mapeou cada variável para a coluna
    // renomeada correspondente no dataset atual (base2).
    const mapping = {
      CANAL: { col: 'CANAL_NOVO', csvId: 'base2' },
      GRUPO: { col: 'GRUPO_2', csvId: 'base2' },
      FAIXA: { col: 'FAIXA_X', csvId: 'base2' },
    };
    const remapped = applyPolicyVarMapping(ir, mapping);
    const { shapes: appliedShapes, conns: appliedConns } = applyPolicyPatch(remapped);

    // Nós materializados apontam para o dataset/colunas NOVAS, não para as originais.
    const decNode = appliedShapes.find(s => s.type === 'decision');
    expect(decNode.variableCol).toBe('GRUPO_2');
    expect(decNode.csvId).toBe('base2');
    const cinNode = appliedShapes.find(s => s.type === 'cineminha');
    expect(cinNode.rowVar).toEqual({ col: 'FAIXA_X', csvId: 'base2' });
    expect(cinNode.colVar).toEqual({ col: 'CANAL_NOVO', csvId: 'base2' });

    const tgtColumnar = toColumnarStore(TGT_STORE);
    const orig = tickOf(srcShapes, srcConns, srcColumnar);
    const mat = tickOf(appliedShapes, appliedConns, tgtColumnar);

    // Mesmos dados (só renomeados) → mesmos agregados (edgeStats fica de fora: é
    // chaveado por IDs de conexão, que são novos por construção no canvas aplicado).
    const { edgeStats: _a, ...aggOrig } = orig.tick.simResult;
    const { edgeStats: _b, ...aggMat } = mat.tick.simResult;
    expect(aggMat).toEqual(aggOrig);
    expect(mat.tick.incrementalResult).toEqual(orig.tick.incrementalResult);
    expect(mat.tick.simResult.approvedQty).toBeGreaterThan(0);

    // Decisão por linha idêntica (mesma ordem de linhas nos dois datasets) — a
    // prova mais forte de "mesmo roteamento".
    const ovOrig = computeSimulatedDecisions(srcShapes, srcConns, srcColumnar, orig.populations);
    const ovMat = computeSimulatedDecisions(appliedShapes, appliedConns, tgtColumnar, mat.populations);
    expect(Array.from(ovMat.base2.sim)).toEqual(Array.from(ovOrig.base.sim));
  });

  it('variável sem mapeamento (pendência): aplica sem erro, nó fica sem variável, demais nós ok', () => {
    const { shapes: srcShapes, conns: srcConns } = integratedFlow('base');
    const srcColumnar = toColumnarStore(SRC_STORE);
    const ir = buildPolicyIR(srcShapes, srcConns, srcColumnar);

    // GRUPO fica sem mapeamento (usuário não encontrou correspondente na base atual).
    const mapping = {
      CANAL: { col: 'CANAL_NOVO', csvId: 'base2' },
      GRUPO: null,
      FAIXA: { col: 'FAIXA_X', csvId: 'base2' },
    };
    const remapped = applyPolicyVarMapping(ir, mapping);
    let appliedShapes, appliedConns;
    expect(() => {
      ({ shapes: appliedShapes, conns: appliedConns } = applyPolicyPatch(remapped));
    }).not.toThrow();

    const decNode = appliedShapes.find(s => s.type === 'decision');
    expect(decNode.variableCol).toBeNull();
    expect(decNode.csvId).toBeNull();
    // Os demais nós, mapeados, continuam corretos — não é um "tudo ou nada".
    const cinNode = appliedShapes.find(s => s.type === 'cineminha');
    expect(cinNode.rowVar).toEqual({ col: 'FAIXA_X', csvId: 'base2' });
    expect(cinNode.colVar).toEqual({ col: 'CANAL_NOVO', csvId: 'base2' });
    // Ports/rotas do losango pendente sobrevivem intactos (mesmos valores/portas),
    // só não há coluna viva alimentando o roteamento — não é erro, é pendência.
    const decPortLabels = appliedConns
      .filter(c => c.from === decNode.id)
      .map(c => c.to)
      .map(pid => appliedShapes.find(s => s.id === pid)?.label)
      .sort();
    expect(decPortLabels).toEqual(['G1', 'G2']);

    // A simulação sobre a base atual não lança exceção — a linha some no nó
    // pendente (sem coluna, sem match), o resto do fluxo segue normal.
    const tgtColumnar = toColumnarStore(TGT_STORE);
    expect(() => tickOf(appliedShapes, appliedConns, tgtColumnar)).not.toThrow();
    const { tick } = tickOf(appliedShapes, appliedConns, tgtColumnar);
    expect(tick.simResult.approvedQty).toBe(0); // nada passa pelo losango sem variável
  });
});
