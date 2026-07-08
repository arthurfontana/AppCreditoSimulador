import { describe, it, expect } from 'vitest';
import { buildPolicyIR, diffPolicyIR, renderDocMarkdown, renderDocHTML } from '../src/App.jsx';
import {
  computePolicyDoc,
  computeSimulationTick,
  computeLensPopulations,
  computeSimulatedDecisions,
  computeIncrementalResult,
} from '../src/simulation.worker.js';
import { buildColumnar } from '../src/columnar.js';

// ── GATE Sessão 6 do Copiloto (Documentação Automática — DEC-IA-006) ─────────────
// docModel = dados crus do motor (sem prosa) montados por computePolicyDoc (worker);
// renderDocMarkdown/renderDocHTML (App.jsx) são a apresentação, pura. Este GATE confere:
//   1. Números do documento ≡ motor (mesmo tick, mesma incrementalResult);
//   2. Completude: todo nó do IR aparece uma vez no fluxo; paths cobrem os terminais alcançáveis;
//   3. Determinismo: duas gerações idênticas (módulo generatedAt);
//   4. Degradação: sem AS IS ⇒ aviso explícito, nunca omissão silenciosa;
//   5. Privacidade: toggle de domínios desligado ⇒ nenhum valor de domínio no texto;
//   6. Changelog: diffPolicyIR entre A/A' (1 célula mudada) ⇒ exatamente essa mudança.

function toColumnarStore(store) {
  const out = {};
  for (const [id, csv] of Object.entries(store)) {
    const { columns, rowCount } = buildColumnar(csv.headers, csv.rows, csv.columnTypes);
    const { rows, ...rest } = csv;
    out[id] = { ...rest, columns, rowCount };
  }
  return out;
}

const fmtQty = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : Number.isInteger(n) ? String(n) : n.toFixed(1);
const fmtPct = (v) => v === null ? 'N/A' : `${(v * 100).toFixed(2)}%`;

// ── Fixture integrada: lens + losango + cineminha + AS IS (mesma base de tests/policyIR.test.js) ──
const STORE = {
  base: {
    name: 'base',
    headers: ['CANAL', 'GRUPO', 'FAIXA', 'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida', '__DECISAO_ORIGINAL'],
    rows: [
      ['LOJA', 'G1', 'F1', '100', '40', '38', '4', '3.5', 'APROVADO'],
      ['LOJA', 'G1', 'F2', '50', '20', '18', '2', '1.8', 'REPROVADO'],
      ['PAP', 'G2', 'F1', '80', '30', '28', '3', '2.5', 'APROVADO'],
      ['LOJA', 'G2', 'F2', '20', '5', '4', '1', '0.8', 'REPROVADO'],
      ['APP', 'G3', 'F1', '10', '2', '2', '0.5', '0.4', ''],
    ],
    columnTypes: {
      CANAL: 'decision', GRUPO: 'decision', FAIXA: 'decision',
      qty: 'qty', qtdAltas: 'qtdAltas', qtdAltasInfer: 'qtdAltasInfer',
      inadReal: 'inadReal', inadInferida: 'inadInferida',
    },
    varTypes: {},
    asIsConfig: { col: 'DECISAO_HIST', mapping: {} },
  },
};

// STORE sem NENHUM AS IS configurado (sem __DECISAO_ORIGINAL) — para o cenário de degradação.
const STORE_NO_ASIS = {
  base: {
    ...STORE.base,
    headers: STORE.base.headers.filter(h => h !== '__DECISAO_ORIGINAL'),
    rows: STORE.base.rows.map(r => r.slice(0, -1)),
  },
};

function integratedFlow(blockedCells = { 'F2|LOJA': false, 'F1|PAP': false }) {
  return {
    shapes: [
      { id: 'L', type: 'decision_lens', label: 'Lens Canal', rules: [{ col: 'CANAL', operator: 'notEqual', value: 'APP', logic: null }] },
      { id: 'D', type: 'decision', label: 'Grupo', variableCol: 'GRUPO', csvId: 'base' },
      { id: 'pG1', type: 'port', label: 'G1' },
      { id: 'pG2', type: 'port', label: 'G2' },
      { id: 'CIN', type: 'cineminha', label: 'Matriz Faixa x Canal', cinemaType: 'eligibility',
        rowVar: { col: 'FAIXA', csvId: 'base' }, colVar: { col: 'CANAL', csvId: 'base' },
        rowDomain: ['F1', 'F2'], colDomain: ['LOJA', 'PAP'],
        cells: blockedCells },
      { id: 'pE', type: 'port', label: 'Elegível' },
      { id: 'pN', type: 'port', label: 'Não Elegível' },
      { id: 'AP', type: 'approved', label: 'Aprovado' },
      { id: 'AS', type: 'as_is', label: 'AS IS' },
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

function reachableTerminalIds(ir) {
  const byId = new Map(ir.nodes.map(n => [n.id, n]));
  const seen = new Set();
  const result = new Set();
  const stack = [...ir.entry];
  while (stack.length) {
    const id = stack.pop();
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (!node) continue;
    if (node.kind === 'terminal') { result.add(id); continue; }
    if (node.kind === 'decision') for (const r of node.routes) stack.push(r.to);
    else if (node.kind === 'cinema') { stack.push(node.routes.eligible); stack.push(node.routes.notEligible); }
    else if (node.kind === 'lens') stack.push(node.to);
  }
  return result;
}

describe('Documentação Automática · números do documento ≡ motor', () => {
  it('kpis do docModel batem exatamente com computeSimulationTick', () => {
    const csvStore = toColumnarStore(STORE);
    const { shapes, conns } = integratedFlow();
    const ir = buildPolicyIR(shapes, conns, csvStore, { name: 'Política de Teste' });

    const docModel = computePolicyDoc(shapes, conns, csvStore, ir, [], { includeDomains: true, activeCanvasId: 'c1', activeCanvasName: 'Canvas 1' });

    const { populations } = computeLensPopulations(shapes, csvStore);
    const tick = computeSimulationTick(shapes, conns, csvStore, populations);

    expect(docModel.kpis.simResult).toEqual(tick.simResult);
    expect(docModel.kpis.incrementalResult).toEqual(tick.incrementalResult);

    // O renderer exibe exatamente os números do docModel (nenhum recálculo/arredondamento
    // divergente) — checagem literal de tokens formatados no texto de saída.
    const md = renderDocMarkdown(docModel);
    expect(md).toContain(fmtPct(tick.simResult.inadReal));
    expect(md).toContain(fmtPct(tick.simResult.inadInferida));
    expect(md).toContain(fmtQty(tick.simResult.totalQty));
    expect(md).toContain(fmtQty(tick.simResult.approvedQty));

    const html = renderDocHTML(docModel);
    expect(html).toContain(fmtPct(tick.simResult.inadReal));
  });

  it('funil por nó+valor bate com a soma manual sobre a base (Grupo G1/G2 aprovados)', () => {
    const csvStore = toColumnarStore(STORE);
    const { shapes, conns } = integratedFlow();
    const ir = buildPolicyIR(shapes, conns, csvStore, {});
    const docModel = computePolicyDoc(shapes, conns, csvStore, ir, [], { includeDomains: true });

    const decisionRows = docModel.funnel.rows.filter(r => r.nodeId === 'D');
    const g1 = decisionRows.find(r => r.value === 'G1');
    const g2 = decisionRows.find(r => r.value === 'G2');
    // G1: 100 (F1, aprovado) + 50 (F2, reprovado) = 150; G2: 80 (F1, aprovado) + 20 (F2, reprovado) = 100
    expect(g1.qty).toBe(150);
    expect(g2.qty).toBe(100);
    expect(g1.approvedQty).toBe(100);
    expect(g2.approvedQty).toBe(80);
  });
});

describe('Documentação Automática · completude', () => {
  it('todo nó do IR aparece exatamente uma vez em flowNodes', () => {
    const csvStore = toColumnarStore(STORE);
    const { shapes, conns } = integratedFlow();
    const ir = buildPolicyIR(shapes, conns, csvStore, {});
    const docModel = computePolicyDoc(shapes, conns, csvStore, ir, [], { includeDomains: true });

    expect(docModel.flowNodes.length).toBe(ir.nodes.length);
    expect(docModel.flowNodes.map(n => n.id).sort()).toEqual(ir.nodes.map(n => n.id).sort());
  });

  it('paths achatados cobrem exatamente os terminais alcançáveis a partir das raízes', () => {
    const csvStore = toColumnarStore(STORE);
    const { shapes, conns } = integratedFlow();
    const ir = buildPolicyIR(shapes, conns, csvStore, {});
    const docModel = computePolicyDoc(shapes, conns, csvStore, ir, [], { includeDomains: true });

    const expected = reachableTerminalIds(ir);
    const covered = new Set(docModel.paths.list.filter(p => p.terminalId).map(p => p.terminalId));
    expect(covered).toEqual(expected);
    expect(docModel.paths.truncated).toBe(false);
    // Todo path resolve num terminal ou tem um motivo declarado de não-finalização.
    for (const p of docModel.paths.list) {
      expect(p.terminal != null || p.reason != null).toBe(true);
    }
  });
});

describe('Documentação Automática · determinismo', () => {
  it('duas gerações consecutivas com a mesma entrada são idênticas (módulo generatedAt)', () => {
    const csvStore = toColumnarStore(STORE);
    const { shapes, conns } = integratedFlow();
    const ir = buildPolicyIR(shapes, conns, csvStore, { name: 'X' });
    const options = { includeDomains: true, activeCanvasId: 'c1', activeCanvasName: 'Canvas 1' };

    const d1 = computePolicyDoc(shapes, conns, csvStore, ir, [], options);
    const d2 = computePolicyDoc(shapes, conns, csvStore, ir, [], options);

    const strip = (d) => { const { generatedAt, ir: dir, ...rest } = d; const { generatedAt: ga2, ...irRest } = dir; return { rest, irRest }; };
    expect(strip(d1)).toEqual(strip(d2));
  });
});

describe('Documentação Automática · degradação (sem AS IS)', () => {
  it('sem __DECISAO_ORIGINAL em nenhum dataset ⇒ aviso explícito, nunca omissão silenciosa', () => {
    const csvStore = toColumnarStore(STORE_NO_ASIS);
    const { shapes, conns } = integratedFlow();
    const ir = buildPolicyIR(shapes, conns, csvStore, {});
    const docModel = computePolicyDoc(shapes, conns, csvStore, ir, [], { includeDomains: true });

    expect(docModel.kpis.incrementalResult).toBeNull();
    expect(docModel.scenarios).toBeNull();

    const md = renderDocMarkdown(docModel);
    expect(md).toContain('Baseline AS IS não configurada');
    const html = renderDocHTML(docModel);
    expect(html).toContain('Baseline AS IS não configurada');
  });
});

describe('Documentação Automática · privacidade (toggle de domínios)', () => {
  it('com o toggle desligado, nenhum valor de domínio aparece no texto', () => {
    const csvStore = toColumnarStore(STORE);
    const { shapes, conns } = integratedFlow();
    const ir = buildPolicyIR(shapes, conns, csvStore, {});
    const docModel = computePolicyDoc(shapes, conns, csvStore, ir, [], { includeDomains: false });

    // docModel não carrega nenhum array de valores de domínio
    for (const fn of docModel.flowNodes) {
      if (fn.kind === 'decision') { expect(fn.routes.every(r => r.values === null)).toBe(true); }
      if (fn.kind === 'cinema') { expect(fn.rowDomain).toBeNull(); expect(fn.colDomain).toBeNull(); expect(fn.blockedCells).toBeNull(); }
      if (fn.kind === 'lens') { expect(fn.rules.every(r => r.value === null)).toBe(true); }
    }
    for (const p of docModel.paths.list) {
      for (const c of p.conditions) {
        if (c.kind === 'decision') expect(c.values).toBeNull();
        if (c.kind === 'lens') expect((c.rules || []).every(r => r.value === null)).toBe(true);
      }
    }
    for (const g of docModel.glossary) expect(g.values).toBeNull();

    const md = renderDocMarkdown(docModel);
    const html = renderDocHTML(docModel);
    // Valores de domínio conhecidos da fixture não podem aparecer em lugar nenhum do texto.
    for (const forbidden of ['G1', 'G2', 'G3', 'F1', 'F2', 'LOJA', 'PAP', 'APP']) {
      expect(md).not.toContain(forbidden);
      expect(html).not.toContain(forbidden);
    }
  });

  it('com o toggle ligado, os valores de domínio aparecem (contraste positivo)', () => {
    const csvStore = toColumnarStore(STORE);
    const { shapes, conns } = integratedFlow();
    const ir = buildPolicyIR(shapes, conns, csvStore, {});
    const docModel = computePolicyDoc(shapes, conns, csvStore, ir, [], { includeDomains: true });
    const md = renderDocMarkdown(docModel);
    expect(md).toContain('G1');
    expect(md).toContain('LOJA');
  });
});

describe('Documentação Automática · changelog (diffPolicyIR)', () => {
  it('fixture A vs A\' (1 célula do Cineminha mudada) ⇒ changelog lista exatamente essa mudança', () => {
    const csvStore = toColumnarStore(STORE);
    const flowA = integratedFlow({ 'F2|LOJA': false, 'F1|PAP': false });
    const flowB = integratedFlow({ 'F1|PAP': false }); // F2|LOJA volta a ser elegível

    const irA = buildPolicyIR(flowA.shapes, flowA.conns, csvStore, {});
    const irB = buildPolicyIR(flowB.shapes, flowB.conns, csvStore, {});

    const diff = diffPolicyIR(irA, irB);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.entryChanged).toBe(false);
    expect(diff.changed.length).toBe(1);
    expect(diff.changed[0].id).toBe('CIN');
    expect(diff.changed[0].fields.map(f => f.key)).toEqual(['blockedCells']);
    expect(diff.changed[0].fields[0].before).toEqual(['F1|PAP', 'F2|LOJA']);
    expect(diff.changed[0].fields[0].after).toEqual(['F1|PAP']);

    // Delta de métricas correto: A' libera a célula F2|LOJA para elegível — as DUAS linhas
    // que caem nessa interseção (G1/F2/LOJA qty=50 e G2/F2/LOJA qty=20, ambas hoje REPROVADO
    // no AS IS) passam a ser roteadas direto para Aprovado, um ganho de 70 unidades.
    const { populations: popA } = computeLensPopulations(flowA.shapes, csvStore);
    const tickA = computeSimulationTick(flowA.shapes, flowA.conns, csvStore, popA);
    const { populations: popB } = computeLensPopulations(flowB.shapes, csvStore);
    const tickB = computeSimulationTick(flowB.shapes, flowB.conns, csvStore, popB);
    expect(tickB.simResult.approvedQty).toBe(tickA.simResult.approvedQty + 70);
    expect(tickB.simResult.approvalRate).toBeGreaterThan(tickA.simResult.approvalRate);

    // O mesmo delta, quando materializado via computePolicyDoc (options.compare) — a main
    // monta o changelog combinando diffPolicyIR (estrutural) com compareKpis (numérico).
    const docModel = computePolicyDoc(flowB.shapes, flowB.conns, csvStore, irB, [], {
      includeDomains: true,
      compare: { shapes: flowA.shapes, conns: flowA.conns },
    });
    expect(docModel.compareKpis.simResult).toEqual(tickA.simResult);
    expect(docModel.kpis.simResult).toEqual(tickB.simResult);
  });
});
