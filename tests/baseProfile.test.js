import { describe, it, expect } from 'vitest';
import {
  computeBaseProfile,
  computeVariableRanking,
  computeIV,
} from '../src/simulation.worker.js';
import { segVarDefaultReason, parseTemporalKey } from '../src/segVar.js';

// ── GATE Explorar a Base — Sessão EB1 (motor do perfil da base — DEC-EB-001..012) ──
// docs/wiki/Epicos-ExplorarBase.md. `computeBaseProfile(csvStore, {csvId, riskMetric})`
// devolve o BaseProfileModel: retrato AS IS, ranking/perfil de variáveis, qualidade,
// estabilidade temporal + PSI e insights (código + fatos crus, nunca prosa). Tudo de
// agregação EXATA e determinístico. Fixtures em base legada (`rows: string[][]`) — o motor
// cai no caminho por-linha (fallback do M8), mesma matemática do caminho colunar.
//
// O que cada bloco trava:
//  · agregados do perfil ≡ agregação manual linha a linha
//  · IV ≡ computeIV aplicado à mão
//  · ranking global ≡ ranking ancorado numa porta que recebe 100% da base (DEC-EB-008)
//  · PSI ≡ cálculo manual (caso ε e caso psi:null)
//  · immature_vintage / unstable_psi / dominant_value / low_coverage disparam nos plantados
//    e NÃO disparam nos limpos
//  · degradações no_temporal_column / no_asis declaradas
//  · determinismo byte a byte

const BASE_PSI_EPS = 1e-6;

// Oráculo manual do PSI (mesma fórmula normativa da DEC-EB-009 — Σ(p−q)ln(p/q), ε em ambas).
function manualPSI(perValue) {
  let refTot = 0, curTot = 0;
  for (const { ref, cur } of perValue) { refTot += ref; curTot += cur; }
  if (refTot <= 0 || curTot <= 0) return null;
  let psi = 0;
  for (const { ref, cur } of perValue) {
    const q = ref / refTot + BASE_PSI_EPS;
    const p = cur / curTot + BASE_PSI_EPS;
    psi += (p - q) * Math.log(p / q);
  }
  return psi;
}

const stripGen = (m) => { const { generatedAt, ...rest } = m; return JSON.stringify(rest); };

// ── Fixture A: núcleo (AS IS, IV, sem coluna temporal) ────────────────────────────
const csvA = {
  headers: ['SCORE', 'qty', 'qtdAltas', 'inadReal', 'qtdAltasInfer', 'inadInferida', '__DECISAO_ORIGINAL'],
  columnTypes: {
    SCORE: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal',
    qtdAltasInfer: 'qtdAltasInfer', inadInferida: 'inadInferida',
  },
  rows: [
    ['R1', '100', '100', '40', '100', '40', 'APROVADO'],   // aprov, inad real 40%
    ['R2', '100', '100', '5',  '100', '5',  'APROVADO'],   // aprov, inad real 5%
    ['R3', '100', '100', '20', '100', '20', 'REPROVADO'],  // reprov
  ],
};

describe('baseProfile · núcleo — AS IS + IV + agregados exatos', () => {
  const m = computeBaseProfile({ A: csvA }, { csvId: 'A', riskMetric: 'inadReal' });

  it('metadados: version, csvId, métrica resolvida', () => {
    expect(m.csvId).toBe('A');
    expect(m.metric).toEqual({ id: 'inadReal', label: 'Inad. Real', direction: 'lower' });
    expect(m.error).toBeUndefined();
  });

  it('retrato AS IS ≡ agregação manual de __DECISAO_ORIGINAL', () => {
    expect(m.asIs).toBeTruthy();
    expect(m.asIs.totalQty).toBe(300);
    expect(m.asIs.approvedQty).toBe(200);
    expect(m.asIs.rejectedQty).toBe(100);
    expect(m.asIs.otherQty).toBe(0);
    expect(m.asIs.approvalRate).toBeCloseTo(200 / 300, 12);
    // inad real dos aprovados = (40+5)/(100+100)
    expect(m.asIs.inadRealAprovados).toBeCloseTo(45 / 200, 12);
    expect(m.asIs.inadInferidaAprovados).toBeCloseTo(45 / 200, 12);
  });

  it('IV da variável ≡ computeIV aplicado à mão', () => {
    const v = m.variables.find(x => x.col === 'SCORE');
    expect(v).toBeTruthy();
    expect(v.distinct).toBe(3);
    expect(v.coveragePct).toBeCloseTo(100, 12);
    const ivHand = computeIV([
      { altas: 100, maus: 40 }, { altas: 100, maus: 5 }, { altas: 100, maus: 20 },
    ]);
    expect(v.iv).toBeCloseTo(ivHand, 12);
  });

  it('profile por valor ≡ volumes/taxas manuais (soma de share = 1)', () => {
    const v = m.variables.find(x => x.col === 'SCORE');
    const byVal = Object.fromEntries(v.profile.map(p => [p.value, p]));
    expect(byVal.R1.qty).toBe(100);
    expect(byVal.R1.rate).toBeCloseTo(0.40, 12);
    expect(byVal.R2.rate).toBeCloseTo(0.05, 12);
    expect(byVal.R3.rate).toBeCloseTo(0.20, 12);
    expect(v.profile.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1, 12);
  });

  it('sem coluna temporal ⇒ temporal null, psi null e degradação declarada', () => {
    expect(m.temporal).toBeNull();
    expect(m.variables.every(v => v.psi === null)).toBe(true);
    expect(m.insights.some(i => i.code === 'no_temporal_column')).toBe(true);
  });

  it('determinismo byte a byte (à parte de generatedAt)', () => {
    const m2 = computeBaseProfile({ A: csvA }, { csvId: 'A', riskMetric: 'inadReal' });
    expect(stripGen(m2)).toBe(stripGen(m));
  });
});

// ── DEC-EB-008: ranking global ≡ ranking ancorado numa porta que recebe 100% da base ──
describe('baseProfile · DEC-EB-008 — computeVariableRanking âncora nula ≡ porta 100%', () => {
  const csv = {
    headers: ['SCORE', 'CANAL', 'qty', 'qtdAltas', 'inadReal'],
    columnTypes: { SCORE: 'decision', CANAL: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
    rows: [
      ['R08', 'Digital', '1000', '1000', '20'],
      ['R08', 'Fisico',  '1000', '1000', '380'],
      ['R05', 'Digital', '1000', '1000', '380'],
      ['R05', 'Fisico',  '1000', '1000', '20'],
    ],
  };
  const store = { seg: csv };
  // Política: lens sem regras (passa 100%) → porta P → reprova. A porta recebe TODA a base.
  const shapes = [
    { id: 'L', type: 'decision_lens', label: 'Todos', rules: [] },
    { id: 'P', type: 'port', label: 'Porta' },
    { id: 'REJ', type: 'rejected', label: 'Reprovado' },
  ];
  const conns = [{ id: 'c1', from: 'L', to: 'P' }, { id: 'c2', from: 'P', to: 'REJ' }];

  it('ranking/interactions/population idênticos (só nodeId difere)', () => {
    const anchored = computeVariableRanking(shapes, conns, store, 'P');
    const global = computeVariableRanking([], [], store, null, {});
    expect(anchored.error).toBeUndefined();
    // nodeId difere de propósito (porta vs. base inteira) — o resto é byte-idêntico.
    const norm = ({ nodeId, ...rest }) => JSON.stringify(rest);
    expect(norm(global)).toBe(norm(anchored));
  });

  it('caminho ancorado permanece byte-idêntico ao antigo (sem options)', () => {
    const a = computeVariableRanking(shapes, conns, store, 'P');
    const b = computeVariableRanking(shapes, conns, store, 'P', {});
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ── PSI + immature_vintage (plantados) ────────────────────────────────────────────
describe('baseProfile · PSI ε + immature_vintage plantados', () => {
  // SEG migra de X (1ª metade) para Y (2ª metade) → PSI alto. Última safra com inad muito
  // abaixo da média → maturação incompleta.
  const csv = {
    headers: ['SEG', 'MES', 'qty', 'qtdAltas', 'inadReal'],
    columnTypes: { SEG: 'decision', MES: 'temporal', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
    rows: [
      ['X', '202401', '100', '100', '30'],
      ['X', '202402', '100', '100', '30'],
      ['Y', '202403', '100', '100', '30'],
      ['Y', '202404', '100', '100', '3'],   // safra imatura (3% << média)
    ],
  };
  const m = computeBaseProfile({ T: csv }, { csvId: 'T', riskMetric: 'inadReal' });

  it('PSI de SEG ≡ cálculo manual com ε e janelas declaradas', () => {
    const v = m.variables.find(x => x.col === 'SEG');
    expect(v.psi).toBeTruthy();
    // ref = {202401,202402}: X=200,Y=0 ; cur = {202403,202404}: X=0,Y=200
    const expected = manualPSI([{ ref: 200, cur: 0 }, { ref: 0, cur: 200 }]);
    expect(v.psi.value).toBeCloseTo(expected, 12);
    expect(v.psi.refWindow).toEqual({ from: '202401', to: '202402', buckets: 2 });
    expect(v.psi.curWindow).toEqual({ from: '202403', to: '202404', buckets: 2 });
    expect(v.psi.value).toBeGreaterThan(0.25);       // > limiar instável
    expect(v.flags).toContain('unstable_psi');
    expect(m.insights.some(i => i.code === 'unstable_psi' && i.facts.col === 'SEG')).toBe(true);
  });

  it('série temporal ordenada cronologicamente por parseTemporalKey', () => {
    expect(m.temporal.col).toBe('MES');
    expect(m.temporal.series.map(s => s.bucket)).toEqual(['202401', '202402', '202403', '202404']);
    const last = m.temporal.series[3];
    expect(last.inadRate).toBeCloseTo(0.03, 12);
  });

  it('immature_vintage dispara (última safra << média)', () => {
    const f = m.insights.find(i => i.code === 'immature_vintage');
    expect(f).toBeTruthy();
    expect(f.facts.lastBucket).toBe('202404');
    // média = (30+30+30+3)/400
    expect(f.facts.overallRate).toBeCloseTo(93 / 400, 12);
  });
});

// ── dominant_value + low_coverage (plantados) ─────────────────────────────────────
describe('baseProfile · dominant_value + low_coverage plantados', () => {
  const csv = {
    headers: ['CANAL', 'DOC', 'qty', 'qtdAltas', 'inadReal', '__DECISAO_ORIGINAL'],
    columnTypes: { CANAL: 'decision', DOC: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
    rows: [
      ['DIG', 'D1', '100', '100', '10', 'APROVADO'],
      ['DIG', '',   '800', '800', '80', 'APROVADO'],   // DOC vazio (grande volume)
      ['FIS', 'D2', '100', '100', '10', 'REPROVADO'],
    ],
  };
  const m = computeBaseProfile({ Q: csv }, { csvId: 'Q', riskMetric: 'inadReal' });

  it('CANAL (90% DIG) ⇒ dominant_value; DOC não', () => {
    const canal = m.variables.find(v => v.col === 'CANAL');
    expect(canal.flags).toContain('dominant_value');
    const q = m.quality.find(x => x.col === 'CANAL');
    expect(q.dominantValue.value).toBe('DIG');
    expect(q.dominantValue.sharePct).toBeCloseTo(90, 12);
    expect(m.variables.find(v => v.col === 'DOC').flags).not.toContain('dominant_value');
  });

  it('DOC (20% de cobertura) ⇒ low_coverage; CANAL não', () => {
    const doc = m.variables.find(v => v.col === 'DOC');
    expect(doc.coveragePct).toBeCloseTo(20, 12);
    expect(doc.flags).toContain('low_coverage');
    expect(m.variables.find(v => v.col === 'CANAL').flags).not.toContain('low_coverage');
    expect(m.insights.some(i => i.code === 'low_coverage' && i.facts.col === 'DOC')).toBe(true);
  });
});

// ── Fixture limpa: nada de qualidade/estabilidade dispara ──────────────────────────
describe('baseProfile · fixture limpa NÃO dispara achados + no_asis', () => {
  const csv = {
    headers: ['SEG', 'MES', 'qty', 'qtdAltas', 'inadReal'],
    columnTypes: { SEG: 'decision', MES: 'temporal', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
    rows: [
      ['X', '202401', '100', '100', '25'],
      ['Y', '202401', '100', '100', '25'],
      ['X', '202402', '100', '100', '25'],
      ['Y', '202402', '100', '100', '25'],
    ],
  };
  const m = computeBaseProfile({ C: csv }, { csvId: 'C', riskMetric: 'inadReal' });

  it('distribuição estável ⇒ sem unstable_psi; inad constante ⇒ sem immature_vintage', () => {
    const v = m.variables.find(x => x.col === 'SEG');
    expect(v.psi.value).toBeLessThan(0.25);
    expect(v.flags).not.toContain('unstable_psi');
    expect(m.insights.some(i => i.code === 'immature_vintage')).toBe(false);
    expect(m.insights.some(i => i.code === 'unstable_psi')).toBe(false);
  });

  it('cobertura cheia + sem categoria dominante ⇒ sem low_coverage/dominant_value', () => {
    const v = m.variables.find(x => x.col === 'SEG');
    expect(v.flags).not.toContain('low_coverage');
    expect(v.flags).not.toContain('dominant_value');
  });

  it('sem __DECISAO_ORIGINAL ⇒ asIs null + degradação no_asis', () => {
    expect(m.asIs).toBeNull();
    expect(m.insights.some(i => i.code === 'no_asis')).toBe(true);
  });
});

// ── Helper compartilhado segVarDefaultReason (tokens inalterados) ──────────────────
describe('baseProfile · flags suspect_* via segVarDefaultReason (helper compartilhado)', () => {
  it('tokens preservados na extração para src/segVar.js', () => {
    expect(segVarDefaultReason('SAFRA_REF')).toBe('temporal');
    expect(segVarDefaultReason('MES_CONTRATACAO')).toBe('temporal');
    expect(segVarDefaultReason('SCORE_BUREAU')).toBe('score');
    expect(segVarDefaultReason('RATING')).toBe('score');
    expect(segVarDefaultReason('RENDA')).toBeNull();
  });

  it('parseTemporalKey continua ordenando safras', () => {
    expect(parseTemporalKey('202401')).toBeLessThan(parseTemporalKey('202402'));
  });

  const csv = {
    headers: ['SCORE', 'SAFRA', 'qty', 'qtdAltas', 'inadReal'],
    columnTypes: { SCORE: 'decision', SAFRA: 'decision', qty: 'qty', qtdAltas: 'qtdAltas', inadReal: 'inadReal' },
    rows: [
      ['700', '202401', '100', '100', '10'],
      ['800', '202402', '100', '100', '40'],
    ],
  };
  const m = computeBaseProfile({ F: csv }, { csvId: 'F', riskMetric: 'inadReal' });

  it('SCORE ⇒ suspect_score; SAFRA ⇒ suspect_temporal nos flags e insights', () => {
    expect(m.variables.find(v => v.col === 'SCORE').flags).toContain('suspect_score');
    expect(m.variables.find(v => v.col === 'SAFRA').flags).toContain('suspect_temporal');
    expect(m.insights.some(i => i.code === 'suspect_score' && i.facts.col === 'SCORE')).toBe(true);
    expect(m.insights.some(i => i.code === 'suspect_temporal' && i.facts.col === 'SAFRA')).toBe(true);
  });
});
