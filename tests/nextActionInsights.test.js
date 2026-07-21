import { describe, it, expect } from 'vitest';
import { describeAction, describeWhyItMatters, severityLabel, ctaLabel, formatActionDelta } from '../src/nextActionInsights.js';

// ── GATE Jornada NB — Sessão NB2 (feed: templates de prosa, DEC-NB-007) ──────────────
// docs/wiki/Jornada-Prompts-Sessoes.md. `src/nextActionInsights.js` é módulo FOLHA e
// determinístico (nunca LLM): traduz `{kind, title:{facts}}` do NextActionsModel (NB1,
// `computeNextActions`) em prosa pt-BR — mesmo contrato de src/exploreInsights.js.
//
// O que este GATE trava:
//  · cobertura total kind→template (TODOS os kinds do catálogo v1, docs/wiki/
//    Jornada-Prompts-Sessoes.md) para describeAction E describeWhyItMatters
//  · nenhum placeholder vazado (undefined/NaN/[object Object]) mesmo com `facts`
//    ausente ou incompleto — degradação sempre DECLARADA (nunca some, nunca quebra)
//  · determinismo byte a byte (mesma entrada ⇒ mesma prosa)
//  · describeWhyItMatters não depende de `facts` (texto fixo por kind)

// Catálogo de `kind` v1 (docs/wiki/Jornada-Prompts-Sessoes.md, "Catálogo de kind do v1" +
// journey_next, o fallback do feed nunca vazio) — mesmo conjunto emitido por
// `computeNextActions` em src/simulation.worker.js.
const ACTION_KINDS = [
  'connect_port',
  'fix_lint_dead_branch', 'fix_lint_unreachable_node', 'fix_lint_cycle',
  'fix_lint_zero_arrival', 'fix_lint_lens_empty', 'fix_lint_duplicate_variable_path',
  'fix_lint_path_without_terminal',
  'first_branch', 'explore_base', 'map_pending_var', 'configure_asis',
  'document', 'save_library', 'journey_next',
  'apply_opportunity', 'add_break', 'simplify',
];

// `facts` completos plausíveis por kind — usados para checar a leitura no "caso feliz"
// (mesmos formatos que `computeNextActions` de fato produz, ver simulation.worker.js).
const FULL_FACTS = {
  connect_port: { nodeId: 'pY', label: 'B', arrivals: 250, top3: [{ col: 'SCORE', csvId: 'base', iv: 0.3 }], rankingError: null },
  fix_lint_dead_branch: { nodeId: 'pB', code: 'dead_branch', arrivals: 0, coversDerived: 1, value: 'B' },
  fix_lint_unreachable_node: { nodeId: 'D2', code: 'unreachable_node', arrivals: null, coversDerived: 0, value: null },
  fix_lint_cycle: { nodeId: 'D1', code: 'cycle', arrivals: null, coversDerived: 0, value: null },
  fix_lint_zero_arrival: { nodeId: 'D1', code: 'zero_arrival', arrivals: 0, coversDerived: 2, value: 'Z' },
  fix_lint_lens_empty: { nodeId: 'L1', code: 'lens_empty', arrivals: null, coversDerived: 0, value: null },
  fix_lint_duplicate_variable_path: { nodeId: 'D3', code: 'duplicate_variable_path', arrivals: null, coversDerived: 0, value: null },
  fix_lint_path_without_terminal: { nodeId: 'D4', code: 'path_without_terminal', arrivals: 40, coversDerived: 0, value: null },
  first_branch: { top: { col: 'SCORE', csvId: 'base', iv: 0.31 }, rankingError: null },
  explore_base: { baseLoaded: true },
  map_pending_var: { name: 'RENDA' },
  configure_asis: {},
  document: { state: 'outdated', lastDocFingerprint: 'abc', currentFingerprint: 'def' },
  save_library: {},
  journey_next: { policyEmpty: false },
  apply_opportunity: { findingId: 's1', findingCode: 'deviation', segment: { conditions: [] } },
  add_break: { findingId: 's2', findingCode: 'heterogeneous_block', segment: { conditions: [] } },
  simplify: { removedNodeCount: 3, candidateCount: 2, identical: true },
};

function assertNoLeakedPlaceholder(text) {
  expect(typeof text).toBe('string');
  expect(text.length).toBeGreaterThan(0);
  expect(text).not.toMatch(/undefined/);
  expect(text).not.toMatch(/\bNaN\b/);
  expect(text).not.toMatch(/\[object Object\]/);
  expect(text).not.toMatch(/null(?!\w)/);
}

describe('nextActionInsights — describeAction (leitura do card)', () => {
  it('tem template para TODOS os kinds do v1, sem placeholder vazado (facts completos)', () => {
    for (const kind of ACTION_KINDS) {
      const text = describeAction({ kind, title: { code: kind, facts: FULL_FACTS[kind] } });
      assertNoLeakedPlaceholder(text);
      expect(text).not.toMatch(/leitura ainda não disponível/);
    }
  });

  it('degrada declaradamente com facts ausente/incompleto — nunca undefined solto na tela', () => {
    for (const kind of ACTION_KINDS) {
      const text = describeAction({ kind, title: { code: kind, facts: {} } });
      assertNoLeakedPlaceholder(text);
    }
  });

  it('degrada declaradamente para action nula/indefinida', () => {
    expect(describeAction(null)).toBe('');
    expect(describeAction(undefined)).toBe('');
  });

  it('degrada declaradamente para kind desconhecido (nunca lança, nunca undefined)', () => {
    const text = describeAction({ kind: 'kind_inexistente_xyz', title: { facts: {} } });
    assertNoLeakedPlaceholder(text);
    expect(text).toMatch(/kind_inexistente_xyz/);
  });

  it('é determinístico byte a byte (mesma entrada ⇒ mesma prosa)', () => {
    for (const kind of ACTION_KINDS) {
      const a = describeAction({ kind, title: { facts: FULL_FACTS[kind] } });
      const b = describeAction({ kind, title: { facts: FULL_FACTS[kind] } });
      expect(a).toBe(b);
    }
  });
});

describe('nextActionInsights — describeWhyItMatters ("ⓘ Por que isso importa")', () => {
  it('tem template pedagógico para TODOS os kinds do v1', () => {
    for (const kind of ACTION_KINDS) {
      const text = describeWhyItMatters({ kind, title: { facts: FULL_FACTS[kind] } });
      assertNoLeakedPlaceholder(text);
      expect(text).not.toMatch(/ainda não disponível/);
    }
  });

  it('NÃO depende de `facts` — mesmo texto com facts vazio ou completo', () => {
    for (const kind of ACTION_KINDS) {
      const withFacts = describeWhyItMatters({ kind, title: { facts: FULL_FACTS[kind] } });
      const withoutFacts = describeWhyItMatters({ kind, title: { facts: {} } });
      expect(withFacts).toBe(withoutFacts);
    }
  });

  it('degrada declaradamente para action nula/kind desconhecido — nunca undefined solto', () => {
    assertNoLeakedPlaceholder(describeWhyItMatters(null));
    assertNoLeakedPlaceholder(describeWhyItMatters({ kind: 'kind_inexistente_xyz' }));
  });

  it('é determinístico byte a byte', () => {
    for (const kind of ACTION_KINDS) {
      const a = describeWhyItMatters({ kind });
      const b = describeWhyItMatters({ kind });
      expect(a).toBe(b);
    }
  });
});

describe('nextActionInsights — severityLabel / ctaLabel / formatActionDelta', () => {
  it('severityLabel cobre as 4 classes de severidade do modelo (DEC-NB-004)', () => {
    for (const sev of ['blocker', 'opportunity', 'hygiene', 'journey']) {
      assertNoLeakedPlaceholder(severityLabel(sev));
    }
    assertNoLeakedPlaceholder(severityLabel('sev_inexistente'));
  });

  it('ctaLabel cobre todos os labelCode emitidos por computeNextActions', () => {
    const labelCodes = [
      'connect_terminal', 'open_domain', 'remove_from_domain', 'first_branch',
      'explore_base', 'map_pending_var', 'configure_asis', 'document',
      'save_library', 'apply_opportunity', 'add_break', 'simplify',
    ];
    for (const lc of labelCodes) assertNoLeakedPlaceholder(ctaLabel(lc));
    assertNoLeakedPlaceholder(ctaLabel('label_inexistente'));
  });

  it('formatActionDelta: string vazia para delta nulo (card sem delta validado não exibe delta)', () => {
    expect(formatActionDelta(null)).toBe('');
    expect(formatActionDelta(undefined)).toBe('');
  });

  it('formatActionDelta: formato da Descoberta (approvalDelta/inadRealDelta/inadInfDelta/movedQty)', () => {
    const text = formatActionDelta({ approvalDelta: 0.02, inadRealDelta: -0.01, inadInfDelta: null, movedQty: 10 });
    assertNoLeakedPlaceholder(text);
    expect(text).toContain('+2.0 p.p.');
    expect(text).toContain('-1.0 p.p.');
    expect(text).not.toMatch(/inad\. inferida/); // inadInfDelta null → não entra no texto
  });

  it('formatActionDelta: formato da Simplificação (proven true/false)', () => {
    assertNoLeakedPlaceholder(formatActionDelta({ proven: true, approvalDelta: 0 }));
    assertNoLeakedPlaceholder(formatActionDelta({ proven: false, approvalDelta: 0.01 }));
  });
});
