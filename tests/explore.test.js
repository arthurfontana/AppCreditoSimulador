import { describe, it, expect } from 'vitest';
import { buildDefaultExploreLayout, EXPLORE_TOP_N_VARS } from '../src/explore.js';

// ── GATE Explorar a Base — Sessão EB2 (layout default da aba — DEC-EB-005/006) ──
// buildDefaultExploreLayout(profile) é pura: monta os widgets reais do chassi (origin
// 'auto') nas 6 seções fixas da DEC-EB-006, cada uma abrindo com um card `insight`.

function makeProfile(nVars = 3, { temporal = false, asIs = true, nInsights = 2 } = {}) {
  const variables = Array.from({ length: nVars }, (_, i) => ({
    col: `VAR${i}`, varType: 'categorical', distinct: 3, coveragePct: 100,
    iv: 0.5 - i * 0.05, flags: [], profile: [{ value: 'A', qty: 10, share: 1, rate: 0.1 }],
    profileTruncated: false, psi: null, continuous: false,
  }));
  return {
    version: '1.0', generatedAt: '2026-01-01T00:00:00.000Z', csvId: 'X',
    metric: { id: 'inadReal', label: 'Inad. Real', direction: 'lower' },
    asIs: asIs ? { totalQty: 100, approvedQty: 80, rejectedQty: 20, otherQty: 0, approvalRate: 0.8, inadRealAprovados: 0.1, inadInferidaAprovados: 0.1 } : null,
    variables,
    temporal: temporal ? { col: 'MES', series: [{ bucket: '202401', qty: 10, approvalRate: 0.8, inadRate: 0.1 }] } : null,
    quality: variables.map(v => ({ col: v.col, coveragePct: 100, unparseablePct: 0, dominantValue: null })),
    insights: Array.from({ length: nInsights }, (_, i) => ({ code: 'high_iv', severity: 'good', facts: { col: `VAR${i}`, iv: 0.4 } })),
  };
}

describe('explore · buildDefaultExploreLayout', () => {
  it('base sem perfil válido (error) ⇒ layout vazio', () => {
    expect(buildDefaultExploreLayout(null)).toEqual([]);
    expect(buildDefaultExploreLayout({ error: 'no_base' })).toEqual([]);
  });

  it('6 seções, cada uma abrindo com um widget insight, na ordem da DEC-EB-006', () => {
    const layout = buildDefaultExploreLayout(makeProfile(3));
    const presets = layout.filter(w => w.type === 'insight').map(w => w.config.preset);
    expect(presets).toEqual(['asis', 'ranking', 'varprofile', 'quality', 'stability', 'warnings']);
  });

  it('teto de top-N: com mais variáveis que EXPLORE_TOP_N_VARS, só as N primeiras (ordem do ranking) ganham varprofile', () => {
    const layout = buildDefaultExploreLayout(makeProfile(EXPLORE_TOP_N_VARS + 3));
    const profileWidgets = layout.filter(w => w.type === 'varprofile');
    expect(profileWidgets.length).toBe(EXPLORE_TOP_N_VARS);
    expect(profileWidgets.map(w => w.config.col)).toEqual(['VAR0', 'VAR1', 'VAR2', 'VAR3', 'VAR4']);
  });

  it('com menos variáveis que o teto, um varprofile por variável (sem inventar)', () => {
    const layout = buildDefaultExploreLayout(makeProfile(2));
    expect(layout.filter(w => w.type === 'varprofile').length).toBe(2);
  });

  it('todo widget é origin:auto, com id único e dimensões positivas', () => {
    const layout = buildDefaultExploreLayout(makeProfile(4));
    const ids = new Set();
    for (const w of layout) {
      expect(w.origin).toBe('auto');
      expect(w.w).toBeGreaterThan(0);
      expect(w.h).toBeGreaterThan(0);
      expect(ids.has(w.id)).toBe(false);
      ids.add(w.id);
    }
  });

  it('inclui exatamente um ivrank, um quality e um stability', () => {
    const layout = buildDefaultExploreLayout(makeProfile(3));
    expect(layout.filter(w => w.type === 'ivrank').length).toBe(1);
    expect(layout.filter(w => w.type === 'quality').length).toBe(1);
    expect(layout.filter(w => w.type === 'stability').length).toBe(1);
  });

  it('determinismo: mesmo profile ⇒ mesmo layout, byte a byte', () => {
    const p = makeProfile(6, { temporal: true });
    const a = buildDefaultExploreLayout(p);
    const b = buildDefaultExploreLayout(p);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('sem AS IS / sem coluna temporal: layout continua completo (degradação fica no widget, não no layout)', () => {
    const layout = buildDefaultExploreLayout(makeProfile(2, { temporal: false, asIs: false }));
    expect(layout.filter(w => w.type === 'insight').length).toBe(6);
  });
});
