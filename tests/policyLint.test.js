import { describe, it, expect } from 'vitest';
import { computePolicyInsights } from '../src/simulation.worker.js';

// ── GATE Sessão 1 do Copiloto (lint estrutural — DEC-IA-006) ─────────────────────
// docs/wiki/Copiloto-ConstrucaoAssistida.md / docs/wiki/Epicos-CopilotoIA.md.
// `computePolicyInsights(shapes, conns, nodeArrivals, lensCounts)` é uma função PURA
// sobre a topologia do canvas + os agregados que o tick já produz (nodeArrivals via
// COMPUTE_OVERLAY, lensCounts via M10) — por isso os testes passam fixtures literais
// pequenas de shapes/conns e, quando a regra depende de volume, um nodeArrivals/
// lensCounts também literal (não precisa subir um csvStore real).
//
// Uma regra por describe; cada uma com 1 caso positivo (achado presente) e 1 negativo
// (achado ausente), como pedido no épico.

function codesOf(findings) { return findings.map(f => f.code); }

describe('policyLint · porta solta (port_dangling)', () => {
  it('porta sem NENHUMA conexão de saída gera achado', () => {
    const shapes = [
      { id: 'D1', type: 'decision', label: 'Canal', variableCol: 'CANAL', csvId: 'base' },
      { id: 'pA', type: 'port', label: 'A' },
      { id: 'pB', type: 'port', label: 'B' },
      { id: 'AP', type: 'approved' },
    ];
    const conns = [
      { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
      { id: 'c2', from: 'D1', to: 'pB', label: 'B' },
      { id: 'c3', from: 'pA', to: 'AP' },
      // pB não tem nenhuma conexão de saída
    ];
    const findings = computePolicyInsights(shapes, conns, {}, {});
    const f = findings.find(x => x.code === 'port_dangling' && x.nodeId === 'pB');
    expect(f).toBeTruthy();
    expect(f.severity).toBe('error');
    expect(f.fix).toEqual({ kind: 'connect_terminal', nodeId: 'pB' });
  });

  it('todas as portas conectadas a um destino → sem achado', () => {
    const shapes = [
      { id: 'D1', type: 'decision', label: 'Canal', variableCol: 'CANAL', csvId: 'base' },
      { id: 'pA', type: 'port', label: 'A' },
      { id: 'pB', type: 'port', label: 'B' },
      { id: 'AP', type: 'approved' },
      { id: 'RJ', type: 'rejected' },
    ];
    const conns = [
      { id: 'c1', from: 'D1', to: 'pA', label: 'A' },
      { id: 'c2', from: 'D1', to: 'pB', label: 'B' },
      { id: 'c3', from: 'pA', to: 'AP' },
      { id: 'c4', from: 'pB', to: 'RJ' },
    ];
    const findings = computePolicyInsights(shapes, conns, {}, {});
    expect(codesOf(findings)).not.toContain('port_dangling');
  });
});

describe('policyLint · nó inalcançável (unreachable_node)', () => {
  it('par de losangos que só se referenciam mutuamente (sem raiz) fica inalcançável', () => {
    const shapes = [
      { id: 'A', type: 'decision', label: 'A', variableCol: 'VARA', csvId: 'base' },
      { id: 'pA', type: 'port', label: 'x' },
      { id: 'B', type: 'decision', label: 'B', variableCol: 'VARB', csvId: 'base' },
      { id: 'pB', type: 'port', label: 'y' },
    ];
    const conns = [
      { id: 'c1', from: 'A', to: 'pA', label: 'x' },
      { id: 'c2', from: 'pA', to: 'B' },
      { id: 'c3', from: 'B', to: 'pB', label: 'y' },
      { id: 'c4', from: 'pB', to: 'A' }, // fecha o par sem nenhuma raiz externa
    ];
    const findings = computePolicyInsights(shapes, conns, {}, {});
    const ids = findings.filter(f => f.code === 'unreachable_node').map(f => f.nodeId);
    expect(ids.sort()).toEqual(['A', 'B']);
  });

  it('mesmo fluxo alimentado por uma raiz real → alcançável, sem achado', () => {
    const shapes = [
      { id: 'R', type: 'decision', label: 'Raiz', variableCol: 'VARR', csvId: 'base' },
      { id: 'pR', type: 'port', label: 'x' },
      { id: 'A', type: 'decision', label: 'A', variableCol: 'VARA', csvId: 'base' },
      { id: 'pA', type: 'port', label: 'y' },
      { id: 'TERM', type: 'approved' },
    ];
    const conns = [
      { id: 'c1', from: 'R', to: 'pR', label: 'x' },
      { id: 'c2', from: 'pR', to: 'A' },
      { id: 'c3', from: 'A', to: 'pA', label: 'y' },
      { id: 'c4', from: 'pA', to: 'TERM' },
    ];
    const findings = computePolicyInsights(shapes, conns, {}, {});
    expect(codesOf(findings)).not.toContain('unreachable_node');
  });
});

describe('policyLint · ciclo (cycle)', () => {
  it('losango cuja porta volta para ele mesmo é um ciclo', () => {
    const shapes = [
      { id: 'A', type: 'decision', label: 'A', variableCol: 'VARA', csvId: 'base' },
      { id: 'pA', type: 'port', label: 'LOOP' },
    ];
    const conns = [
      { id: 'c1', from: 'A', to: 'pA', label: 'LOOP' },
      { id: 'c2', from: 'pA', to: 'A' },
    ];
    const findings = computePolicyInsights(shapes, conns, {}, {});
    const f = findings.find(x => x.code === 'cycle');
    expect(f).toBeTruthy();
    expect(f.severity).toBe('error');
    expect(['A', 'pA']).toContain(f.nodeId);
  });

  it('losango que termina em terminal sem voltar → sem ciclo', () => {
    const shapes = [
      { id: 'A', type: 'decision', label: 'A', variableCol: 'VARA', csvId: 'base' },
      { id: 'pA', type: 'port', label: 'x' },
      { id: 'TERM', type: 'approved' },
    ];
    const conns = [
      { id: 'c1', from: 'A', to: 'pA', label: 'x' },
      { id: 'c2', from: 'pA', to: 'TERM' },
    ];
    const findings = computePolicyInsights(shapes, conns, {}, {});
    expect(codesOf(findings)).not.toContain('cycle');
  });
});

describe('policyLint · chegada zero (zero_arrival)', () => {
  const shapes = [
    { id: 'D1', type: 'decision', label: 'Canal', variableCol: 'CANAL', csvId: 'base' },
    { id: 'pX', type: 'port', label: 'X' },
    { id: 'pY', type: 'port', label: 'Y' },
    { id: 'TERM', type: 'approved' },
  ];
  const conns = [
    { id: 'c1', from: 'D1', to: 'pX', label: 'X' },
    { id: 'c2', from: 'D1', to: 'pY', label: 'Y' },
    { id: 'c3', from: 'pX', to: 'TERM' },
    { id: 'c4', from: 'pY', to: 'TERM' },
  ];

  it('valor de porta sem NENHUMA linha chegando (0 propostas) gera achado', () => {
    const nodeArrivals = { D1: { val: { X: 100 } } }; // 'Y' nunca aparece
    const findings = computePolicyInsights(shapes, conns, nodeArrivals, {});
    const f = findings.find(x => x.code === 'zero_arrival' && x.nodeId === 'D1');
    expect(f).toBeTruthy();
    expect(f.msg).toContain('Y');
    expect(f.fix).toEqual({ kind: 'open_domain_modal', nodeId: 'D1' });
  });

  it('todos os valores com volume > 0 → sem achado', () => {
    const nodeArrivals = { D1: { val: { X: 100, Y: 40 } } };
    const findings = computePolicyInsights(shapes, conns, nodeArrivals, {});
    expect(codesOf(findings)).not.toContain('zero_arrival');
  });
});

describe('policyLint · lens vazio (lens_empty)', () => {
  const shapes = [
    { id: 'L1', type: 'decision_lens', label: 'Segmento Digital', rules: [{ col: 'CANAL', operator: 'equal', value: 'DIGITAL', logic: null }] },
  ];
  const conns = [];

  it('regras que não casam ninguém (mas há volume chegando) gera achado', () => {
    const lensCounts = { L1: { count: 0, total: 500 } };
    const findings = computePolicyInsights(shapes, conns, {}, lensCounts);
    const f = findings.find(x => x.code === 'lens_empty' && x.nodeId === 'L1');
    expect(f).toBeTruthy();
    expect(f.severity).toBe('warning');
  });

  it('regras que casam alguma linha → sem achado', () => {
    const lensCounts = { L1: { count: 120, total: 500 } };
    const findings = computePolicyInsights(shapes, conns, {}, lensCounts);
    expect(codesOf(findings)).not.toContain('lens_empty');
  });
});

describe('policyLint · variável repetida no caminho (duplicate_variable_path)', () => {
  it('mesma variável testada duas vezes no mesmo caminho gera achado', () => {
    const shapes = [
      { id: 'D1', type: 'decision', label: 'Score (1º corte)', variableCol: 'SCORE', csvId: 'base' },
      { id: 'p1', type: 'port', label: 'ALTO' },
      { id: 'D2', type: 'decision', label: 'Score (2º corte)', variableCol: 'SCORE', csvId: 'base' },
      { id: 'p2', type: 'port', label: 'BAIXO' },
      { id: 'TERM', type: 'approved' },
    ];
    const conns = [
      { id: 'c1', from: 'D1', to: 'p1', label: 'ALTO' },
      { id: 'c2', from: 'p1', to: 'D2' },
      { id: 'c3', from: 'D2', to: 'p2', label: 'BAIXO' },
      { id: 'c4', from: 'p2', to: 'TERM' },
    ];
    const findings = computePolicyInsights(shapes, conns, {}, {});
    const f = findings.find(x => x.code === 'duplicate_variable_path' && x.nodeId === 'D2');
    expect(f).toBeTruthy();
    expect(f.severity).toBe('warning');
  });

  it('variáveis diferentes em sequência → sem achado', () => {
    const shapes = [
      { id: 'D1', type: 'decision', label: 'Score', variableCol: 'SCORE', csvId: 'base' },
      { id: 'p1', type: 'port', label: 'ALTO' },
      { id: 'D2', type: 'decision', label: 'Canal', variableCol: 'CANAL', csvId: 'base' },
      { id: 'p2', type: 'port', label: 'DIGITAL' },
      { id: 'TERM', type: 'approved' },
    ];
    const conns = [
      { id: 'c1', from: 'D1', to: 'p1', label: 'ALTO' },
      { id: 'c2', from: 'p1', to: 'D2' },
      { id: 'c3', from: 'D2', to: 'p2', label: 'DIGITAL' },
      { id: 'c4', from: 'p2', to: 'TERM' },
    ];
    const findings = computePolicyInsights(shapes, conns, {}, {});
    expect(codesOf(findings)).not.toContain('duplicate_variable_path');
  });
});

describe('policyLint · caminho sem terminal (path_without_terminal)', () => {
  it('Decision Lens recém-criado, sem nenhuma saída conectada, gera achado', () => {
    const shapes = [
      { id: 'L1', type: 'decision_lens', label: 'Decision Lens', rules: [] },
    ];
    const findings = computePolicyInsights(shapes, [], {}, {});
    const f = findings.find(x => x.code === 'path_without_terminal' && x.nodeId === 'L1');
    expect(f).toBeTruthy();
    expect(f.severity).toBe('error');
    expect(f.fix).toEqual({ kind: 'connect_terminal', nodeId: 'L1' });
  });

  it('Decision Lens conectado a um terminal → sem achado', () => {
    const shapes = [
      { id: 'L1', type: 'decision_lens', label: 'Decision Lens', rules: [] },
      { id: 'TERM', type: 'approved' },
    ];
    const conns = [{ id: 'c1', from: 'L1', to: 'TERM' }];
    const findings = computePolicyInsights(shapes, conns, {}, {});
    expect(codesOf(findings)).not.toContain('path_without_terminal');
  });
});

describe('policyLint · achados ordenados por severidade', () => {
  it('erros (🔴) vêm antes de avisos (🟡)', () => {
    const shapes = [
      { id: 'D1', type: 'decision', label: 'D1', variableCol: 'V', csvId: 'base' },
      { id: 'pDangling', type: 'port', label: 'X' }, // 🔴 port_dangling
      { id: 'L1', type: 'decision_lens', label: 'L1', rules: [] }, // 🟡 lens_empty
    ];
    const conns = [{ id: 'c1', from: 'D1', to: 'pDangling', label: 'X' }];
    const lensCounts = { L1: { count: 0, total: 10 } };
    // L1 sem saída também dispararia path_without_terminal (error); dá um destino
    // qualquer só para isolar o lens_empty (warning) do path_without_terminal (error).
    const connsWithLensOut = [...conns, { id: 'c2', from: 'L1', to: 'D1' }];
    // nodeArrivals com volume p/ 'X' — só p/ não misturar um zero_arrival incidental
    // nesta checagem de ordenação (que quer isolar port_dangling × lens_empty).
    const nodeArrivals = { D1: { val: { X: 5 } } };
    const findings = computePolicyInsights(shapes, connsWithLensOut, nodeArrivals, lensCounts);
    const firstWarningIdx = findings.findIndex(f => f.severity === 'warning');
    const lastErrorIdx = findings.map(f => f.severity).lastIndexOf('error');
    expect(firstWarningIdx).toBeGreaterThan(lastErrorIdx);
  });
});
