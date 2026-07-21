import { describe, it, expect } from 'vitest';
import { describeFinding, describeSection, describeHowToRead, howToReadTopic } from '../src/exploreInsights.js';

// ── GATE Explorar a Base — Sessão EB3 (camada interpretativa completa, DEC-EB-004) ──
// docs/wiki/Epicos-ExplorarBase.md. `src/exploreInsights.js` é módulo FOLHA e
// determinístico (nunca LLM): traduz {code, facts} do BaseProfileModel e presets de
// seção em prosa pt-BR, e resolve o tópico pedagógico ("ⓘ Como ler") de cada widget.
//
// O que este GATE trava:
//  · cobertura total código→template (todo `insights[].code` do v1, DEC-EB-003) e
//    preset→template (as 6 seções do layout default, DEC-EB-006)
//  · nenhum placeholder vazado (undefined/NaN/[object Object]/{code} cru) mesmo com
//    `facts` ausente ou incompleto — degradação sempre DECLARADA (nunca some, nunca quebra)
//  · determinismo byte a byte (mesma entrada ⇒ mesma prosa)
//  · "ⓘ Como ler": cobertura de todos os tópicos usados pelos widgets da aba
//    (insight/ivrank/varprofile/quality/stability) e resolução widget→tópico

// Códigos de achado do v1 (`insights[].code`, DEC-EB-003 — mesmo contrato travado em
// tests/baseProfile.test.js do lado do motor).
const FINDING_CODES = [
  'high_iv', 'suspect_score', 'suspect_temporal', 'low_coverage', 'dominant_value',
  'high_cardinality', 'immature_vintage', 'unstable_psi', 'no_temporal_column', 'no_asis',
];

// Presets de seção do layout default (DEC-EB-006, mesma ordem de buildDefaultExploreLayout).
const SECTION_PRESETS = ['asis', 'ranking', 'varprofile', 'quality', 'stability', 'warnings'];

// Tópicos de "ⓘ Como ler" — um por preset de seção (o card `insight` usa o preset
// diretamente como tópico) + os 4 tipos de widget dedicado.
const HOWTOREAD_TOPICS = SECTION_PRESETS;

// `facts` completos plausíveis por código — usados para checar a leitura "no caso feliz".
const FULL_FACTS = {
  high_iv: { col: 'RATING', iv: 0.42 },
  suspect_score: { col: 'SCORE_BUREAU', iv: 0.55 },
  suspect_temporal: { col: 'SAFRA' },
  low_coverage: { col: 'RENDA', coveragePct: 42.3 },
  dominant_value: { col: 'UF', value: 'SP', sharePct: 91.2 },
  high_cardinality: { col: 'CEP', distinct: 812, continuous: false },
  immature_vintage: { col: 'SAFRA', lastBucket: '2026-06', lastRate: 0.01, overallRate: 0.08, ratio: 0.125 },
  unstable_psi: { col: 'RATING', psi: 0.31, refWindow: { from: '2025-01', to: '2025-06' }, curWindow: { from: '2025-07', to: '2025-12' } },
  no_temporal_column: {},
  no_asis: {},
};

function assertNoLeakedPlaceholder(text) {
  expect(typeof text).toBe('string');
  expect(text.length).toBeGreaterThan(0);
  expect(text).not.toMatch(/undefined/);
  expect(text).not.toMatch(/\bNaN\b/);
  expect(text).not.toMatch(/\[object Object\]/);
  expect(text).not.toMatch(/null(?!\w)/); // "null" cru (fora de palavras como "nulo")
}

describe('exploreInsights — describeFinding (Leitura de achados)', () => {
  it('tem template para TODOS os códigos do v1, sem placeholder vazado (facts completos)', () => {
    for (const code of FINDING_CODES) {
      const text = describeFinding({ code, severity: 'info', facts: FULL_FACTS[code] });
      assertNoLeakedPlaceholder(text);
      // template real, não a degradação genérica "leitura ainda não disponível"
      expect(text).not.toMatch(/leitura ainda não disponível/);
    }
  });

  it('degrada declaradamente com facts ausente/incompleto — nunca undefined solto na tela', () => {
    for (const code of FINDING_CODES) {
      const text = describeFinding({ code, severity: 'info', facts: {} });
      assertNoLeakedPlaceholder(text);
    }
  });

  it('degrada declaradamente para finding nulo/indefinido', () => {
    expect(describeFinding(null)).toBe('');
    expect(describeFinding(undefined)).toBe('');
  });

  it('degrada declaradamente para código desconhecido (nunca lança, nunca undefined)', () => {
    const text = describeFinding({ code: 'codigo_inexistente_xyz', severity: 'info', facts: {} });
    assertNoLeakedPlaceholder(text);
    expect(text).toMatch(/codigo_inexistente_xyz/);
  });

  it('é determinístico byte a byte (mesma entrada ⇒ mesma prosa)', () => {
    for (const code of FINDING_CODES) {
      const a = describeFinding({ code, severity: 'info', facts: FULL_FACTS[code] });
      const b = describeFinding({ code, severity: 'info', facts: FULL_FACTS[code] });
      expect(a).toBe(b);
    }
  });
});

describe('exploreInsights — describeSection (Leitura de seções do layout default)', () => {
  const fullProfile = {
    metric: { id: 'inadReal', label: 'Inad. Real', direction: 'lower_is_better' },
    asIs: { totalQty: 10000, approvedQty: 7000, rejectedQty: 2500, otherQty: 500, approvalRate: 0.7368, inadRealAprovados: 0.045, inadInferidaAprovados: 0.052 },
    variables: [
      { col: 'RATING', varType: 'ordinal', distinct: 5, coveragePct: 98, iv: 0.42, flags: ['high_iv'], profile: [], profileTruncated: false, psi: { value: 0.31, refWindow: { from: '2025-01', to: '2025-06' }, curWindow: { from: '2025-07', to: '2025-12' } }, continuous: false },
    ],
    temporal: { col: 'SAFRA', series: [{ bucket: '2025-01', qty: 100, approvalRate: 0.7, inadRate: 0.05 }] },
    quality: [{ col: 'RATING', coveragePct: 98, unparseablePct: 0, dominantValue: null }],
    insights: [{ code: 'high_iv', severity: 'good', facts: { col: 'RATING', iv: 0.42 } }],
  };

  it('tem template para TODOS os presets do layout default, sem placeholder vazado', () => {
    for (const preset of SECTION_PRESETS) {
      const text = describeSection(preset, fullProfile);
      assertNoLeakedPlaceholder(text);
    }
  });

  it('degrada declaradamente sem AS IS (preset asis) — lê o achado no_asis', () => {
    const text = describeSection('asis', { ...fullProfile, asIs: null });
    assertNoLeakedPlaceholder(text);
    expect(text).toMatch(/AS IS/);
  });

  it('degrada declaradamente sem coluna temporal (preset stability) — lê o achado no_temporal_column', () => {
    const text = describeSection('stability', { ...fullProfile, temporal: null });
    assertNoLeakedPlaceholder(text);
  });

  it('degrada declaradamente sem variáveis (preset ranking)', () => {
    const text = describeSection('ranking', { ...fullProfile, variables: [] });
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  it('devolve string vazia (nunca undefined) para profile nulo ou preset desconhecido', () => {
    expect(describeSection('asis', null)).toBe('');
    expect(describeSection('preset_inexistente_xyz', fullProfile)).toBe('');
  });

  it('é determinístico byte a byte', () => {
    for (const preset of SECTION_PRESETS) {
      const a = describeSection(preset, fullProfile);
      const b = describeSection(preset, fullProfile);
      expect(a).toBe(b);
    }
  });
});

describe('exploreInsights — describeHowToRead ("ⓘ Como ler", 2ª altura de texto)', () => {
  it('tem template pedagógico para TODOS os tópicos usados pelos widgets da aba', () => {
    for (const topic of HOWTOREAD_TOPICS) {
      const text = describeHowToRead(topic);
      assertNoLeakedPlaceholder(text);
      expect(text).not.toMatch(/ainda não disponível/);
    }
  });

  it('degrada declaradamente para tópico desconhecido/nulo — nunca undefined solto na tela', () => {
    for (const topic of [null, undefined, 'topico_inexistente_xyz']) {
      const text = describeHowToRead(topic);
      assertNoLeakedPlaceholder(text);
    }
  });

  it('é determinístico byte a byte e não depende de dados (texto fixo por tópico)', () => {
    for (const topic of HOWTOREAD_TOPICS) {
      expect(describeHowToRead(topic)).toBe(describeHowToRead(topic));
    }
  });
});

describe('exploreInsights — howToReadTopic (widget → tópico pedagógico)', () => {
  it('resolve o card insight pelo próprio preset (mesmo vocabulário de describeSection)', () => {
    for (const preset of SECTION_PRESETS) {
      expect(howToReadTopic({ type: 'insight', config: { preset } })).toBe(preset);
    }
  });

  it('resolve os widgets dedicados para o tópico do conceito que ilustram', () => {
    expect(howToReadTopic({ type: 'ivrank', config: {} })).toBe('ranking');
    expect(howToReadTopic({ type: 'varprofile', config: { col: 'RATING' } })).toBe('varprofile');
    expect(howToReadTopic({ type: 'quality', config: {} })).toBe('quality');
    expect(howToReadTopic({ type: 'stability', config: {} })).toBe('stability');
  });

  it('cada tópico resolvido por um widget real tem template completo em describeHowToRead', () => {
    const widgets = [
      { type: 'insight', config: { preset: 'asis' } },
      { type: 'insight', config: { preset: 'ranking' } },
      { type: 'insight', config: { preset: 'varprofile' } },
      { type: 'insight', config: { preset: 'quality' } },
      { type: 'insight', config: { preset: 'stability' } },
      { type: 'insight', config: { preset: 'warnings' } },
      { type: 'ivrank', config: {} },
      { type: 'varprofile', config: { col: 'RATING' } },
      { type: 'quality', config: {} },
      { type: 'stability', config: {} },
    ];
    for (const w of widgets) {
      const text = describeHowToRead(howToReadTopic(w));
      assertNoLeakedPlaceholder(text);
      expect(text).not.toMatch(/ainda não disponível/);
    }
  });

  it('degrada declaradamente para widget nulo, sem type, ou de tipo desconhecido', () => {
    expect(howToReadTopic(null)).toBe(null);
    expect(howToReadTopic({ config: {} })).toBe(null);
    expect(howToReadTopic({ type: 'tipo_inexistente_xyz', config: {} })).toBe(null);
    // topic nulo ainda produz leitura declarada (nunca quebra a UI)
    assertNoLeakedPlaceholder(describeHowToRead(howToReadTopic(null)));
  });

  it('card insight sem preset configurado degrada declaradamente (nunca undefined)', () => {
    const topic = howToReadTopic({ type: 'insight', config: {} });
    assertNoLeakedPlaceholder(describeHowToRead(topic));
  });
});
