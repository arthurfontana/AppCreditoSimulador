import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexInferenceRef } from '../src/App.jsx';

// Parser mínimo para o artefato real (delimitador ';', sem campos com aspas).
function parseSemicolon(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const split = l => l.split(';').map(c => c.trim());
  const headers = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { headers, rows };
}

const CSV_PATH = join(process.cwd(), 'INFERENCIA_REF_202509_202603.CSV');

describe('indexInferenceRef — artefato real (4 chaves, 5 níveis)', () => {
  const { headers, rows } = parseSemicolon(readFileSync(CSV_PATH, 'utf8'));
  const ref = indexInferenceRef(headers, rows, 'INFERENCIA_REF.CSV');

  it('deriva as 4 chaves dinamicamente de vars_usadas, na ordem de colapso', () => {
    expect(ref.keyCols).toEqual([
      'FAIXA_SCORE', 'OPERACAO', 'IDENTIFICA_GRUPO_MODELO', 'CANAL_PCO_AJUSTADO',
    ]);
  });

  it('âncora = primeira chave', () => {
    expect(ref.anchorCol).toBe('FAIXA_SCORE');
  });

  it('indexa os níveis 1..4 + GLOBAL com a contagem de chaves correta', () => {
    expect(ref.levelKeyCount).toEqual({ 1: 4, 2: 3, 3: 2, 4: 1 });
    expect(Object.keys(ref.levels).map(Number).sort()).toEqual([1, 2, 3, 4]);
    expect(ref.global).not.toBeNull();
    expect(ref.global.confiab).toBe('GLOBAL');
  });

  it('a chave de nível usa exatamente o prefixo de keyCols', () => {
    // nível 4 (só FAIXA_SCORE): R20 existe
    expect(ref.levels[4].has('R20')).toBe(true);
    // nível 1: chave concatenada das 4 dimensões
    const sample = ref.levels[1].get('R01|FIXA|G1 - CLIENTE RELACION BOM|DIGITAL');
    expect(sample).toBeTruthy();
    expect(sample.conv).toBeCloseTo(0.6765769194, 6);
    expect(sample.fpd).toBeCloseTo(0.0262251283, 6);
    expect(sample.confiab).toBe('ALTA');
  });

  it('premissas carregam conv/fpd numéricos e contagens de auditoria', () => {
    const g = ref.global;
    expect(typeof g.conv).toBe('number');
    expect(typeof g.fpd).toBe('number');
    expect(g.conv).toBeGreaterThan(0);
    expect(g.nAprov).toBeGreaterThan(0);
  });
});
