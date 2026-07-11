import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildColumnar, serializeCsvStore } from '../src/columnar.js';
import {
  segBuildModelWithoutRecs,
  attachSegmentRecommendations,
  clampSegmentParamsForBrowser,
  computeSegmentDiscovery,
} from '../src/simulation.worker.js';
import { goldenFixtures } from './fixtures/segmentFixtures.js';

// ── GATE dourado cross-runtime — Execução Híbrida H7 (DEC-HX-005) ────────────────
// Gera (e depois VERIFICA) as fixtures douradas da Descoberta de Segmentos em
// tests/fixtures/golden/segment_discovery_*.json: entrada (store serializado no
// formato M3 + shapes/conns/scope/params) + o SegmentModel esperado — a saída de
// `segBuildModelWithoutRecs` (estágios 1–3 + asis/anomaly/estabilidade, SEM as
// recomendações, que continuam single-sourced no worker/runSimulation e são anexadas
// via COMPUTE_SEGMENT_RECS). O pytest do sidecar
// (tests_python/test_segment_discovery.py) consome os MESMOS arquivos e exige
// igualdade número a número (contagens exatas; floats com tolerância RELATIVA 1e-9 —
// só transcendentais log/exp/pow podem divergir por 1 ulp entre libm's).
//
// Regeneração: rodar com UPDATE_GOLDEN=1 (ex.: após uma mudança INTENCIONAL do motor
// JS — o diff dos .json materializa a mudança para revisão). Sem a env var, este teste
// FALHA se o motor divergir do dourado commitado — é o alarme de drift do contrato.
// Sem o GATE verde (Vitest aqui + pytest no Python), a task não roteia (DEC-HX-005).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(HERE, 'fixtures', 'golden');
const UPDATE = !!process.env.UPDATE_GOLDEN;

const toColumnarStore = (store) => Object.fromEntries(
  Object.entries(store).map(([id, csv]) => [id, {
    name: id,
    headers: csv.headers,
    columnTypes: csv.columnTypes,
    ...buildColumnar(csv.headers, csv.rows, csv.columnTypes),
  }])
);

const stripTime = (m) => ({ ...m, generatedAt: null });

describe('segmentDiscoveryGolden · fixtures douradas cross-runtime (H7, DEC-HX-005)', () => {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });

  for (const fx of goldenFixtures) {
    const file = path.join(GOLDEN_DIR, `segment_discovery_${fx.name}.json`);

    it(`fixture "${fx.name}": modelo determinístico, serializável e ≡ dourado commitado`, () => {
      const colStore = toColumnarStore(fx.store);
      const built = segBuildModelWithoutRecs(fx.shapes, fx.conns, colStore, fx.scope, fx.params);
      const model = stripTime(built.model);

      // O contrato com o sidecar: o modelo-sem-recomendações tem recommendation null
      // em TODOS os achados (o worker as anexa depois, via COMPUTE_SEGMENT_RECS).
      for (const f of built.model.findings) expect(f.recommendation).toBe(null);

      // Determinismo (mesma entrada ⇒ mesmo modelo) — pré-condição de um dourado.
      const again = stripTime(segBuildModelWithoutRecs(fx.shapes, fx.conns, colStore, fx.scope, fx.params).model);
      expect(again).toEqual(model);

      // Round-trip JSON: o `expected` gravado é EXATAMENTE o que o pytest vai ler
      // (JSON.stringify de doubles round-tripa sem perda).
      const expected = JSON.parse(JSON.stringify(model));
      expect(expected).toEqual(model);

      // Paridade colunar × legado (mesma garantia do M8 aplicada à Descoberta): o
      // dourado é gerado do caminho colunar (o formato que viaja ao sidecar), e o
      // caminho legado string[][] produz o MESMO modelo.
      const legacyModel = stripTime(segBuildModelWithoutRecs(fx.shapes, fx.conns, fx.store, fx.scope, fx.params).model);
      expect(JSON.parse(JSON.stringify(legacyModel))).toEqual(expected);

      const golden = {
        name: fx.name,
        // Entrada no formato do fio (DEC-HX-006): store serializado M3 (base64 de
        // typed arrays) + payload da task — o pytest re-hidrata e executa.
        store: serializeCsvStore(colStore),
        shapes: fx.shapes,
        conns: fx.conns,
        scope: fx.scope,
        params: fx.params,
        expected,
      };

      if (UPDATE || !fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(golden, null, 2) + '\n');
      }
      const committed = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(committed.expected).toEqual(expected);
      expect(committed.store).toEqual(JSON.parse(JSON.stringify(golden.store)));
      expect({ shapes: committed.shapes, conns: committed.conns, scope: committed.scope, params: committed.params })
        .toEqual(JSON.parse(JSON.stringify({ shapes: fx.shapes, conns: fx.conns, scope: fx.scope, params: fx.params })));
    });
  }
});

// ── H7 — costura sidecar→worker: o modelo SEM recomendações que volta do sidecar
// (viajando como JSON puro pelo fio) + attachSegmentRecommendations no worker produz
// EXATAMENTE o mesmo SegmentModel do caminho single-worker (computeSegmentDiscovery).
// É a prova de que a divisão de trabalho da H7 (descoberta no Python, re-simulação
// das recomendações single-sourced no worker) não muda nenhum número exibido.
describe('segmentDiscoveryGolden · attachSegmentRecommendations ≡ caminho single-worker', () => {
  const names = ['planted_2d', 'het_block', 'asis_divergence', 'locked_node', 'node_scope'];
  for (const name of names) {
    const fx = goldenFixtures.find(f => f.name === name);
    it(`fixture "${name}": modelo do fio + recs no worker ≡ computeSegmentDiscovery`, async () => {
      const colStore = toColumnarStore(fx.store);
      // o que o sidecar devolve: JSON puro, sem recomendações
      const wire = JSON.parse(JSON.stringify(
        stripTime(segBuildModelWithoutRecs(fx.shapes, fx.conns, colStore, fx.scope, fx.params).model)));
      const attached = await attachSegmentRecommendations(
        fx.shapes, fx.conns, colStore, fx.scope, fx.params, wire, null);
      const direct = stripTime(computeSegmentDiscovery(fx.shapes, fx.conns, colStore, fx.scope, fx.params));
      expect(JSON.parse(JSON.stringify(attached))).toEqual(JSON.parse(JSON.stringify(direct)));
    });
  }
});

// ── H7 — clamp do fallback browser (paridade total P4): a task Classe B que cai do
// sidecar roda no worker com os tetos DECLARADOS, nunca com depth/beam ampliados.
describe('segmentDiscoveryGolden · clampSegmentParamsForBrowser', () => {
  it('depth 3–4 / beam ampliado voltam aos tetos; dentro dos tetos fica intocado', () => {
    expect(clampSegmentParamsForBrowser({ maxDepth: 4, beamWidth: 32, minQty: 5 }))
      .toEqual({ maxDepth: 2, beamWidth: 8, minQty: 5 });
    expect(clampSegmentParamsForBrowser({ maxDepth: 2, beamWidth: 8 }))
      .toEqual({ maxDepth: 2, beamWidth: 8 });
    expect(clampSegmentParamsForBrowser({ riskMetric: 'inadReal' }))
      .toEqual({ riskMetric: 'inadReal' });
  });
});
