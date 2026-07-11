import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildColumnar, serializeCsvStore } from '../src/columnar.js';
import { computeClusterSegments } from '../src/simulation.worker.js';
import { clusterGoldenFixtures } from './fixtures/clusterFixtures.js';

// ── GATE dourado cross-runtime — Execução Híbrida H8 (DEC-HX-005) ────────────────
// Gera (e depois VERIFICA) as fixtures douradas da Clusterização de Segmentos em
// tests/fixtures/golden/cluster_segments_*.json: entrada (store serializado no formato
// M3 + params da task) + o ClusterModel esperado — a saída de `computeClusterSegments`
// (baseline browser, dentro dos tetos). O pytest do sidecar
// (tests_python/test_cluster_segments.py) consome os MESMOS arquivos e exige igualdade
// número a número. Diferente da H7, aqui NÃO há tolerância a transcendental: toda a
// matemática do k-means é racional + sqrt (IEEE, bit-exata) — a tolerância 1e-9 do
// comparador pytest é folga defensiva, não necessidade conhecida.
//
// Regeneração: rodar com UPDATE_GOLDEN=1 (após mudança INTENCIONAL do motor JS — o
// diff dos .json materializa a mudança para revisão). Sem a env var, este teste FALHA
// se o motor divergir do dourado commitado — o alarme de drift do contrato. Sem o GATE
// verde (Vitest aqui + pytest no Python), a task não roteia (DEC-HX-005).

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

describe('clusterSegmentsGolden · fixtures douradas cross-runtime (H8, DEC-HX-005)', () => {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });

  for (const fx of clusterGoldenFixtures) {
    const file = path.join(GOLDEN_DIR, `cluster_segments_${fx.name}.json`);

    it(`fixture "${fx.name}": modelo determinístico, serializável e ≡ dourado commitado`, () => {
      const colStore = toColumnarStore(fx.store);
      const model = stripTime(computeClusterSegments(colStore, fx.params));

      // Determinismo (mesma entrada ⇒ mesmo modelo) — pré-condição de um dourado.
      const again = stripTime(computeClusterSegments(colStore, fx.params));
      expect(again).toEqual(model);

      // Round-trip JSON: o `expected` gravado é EXATAMENTE o que o pytest vai ler.
      const expected = JSON.parse(JSON.stringify(model));
      expect(expected).toEqual(model);

      // Paridade colunar × legado: o dourado é gerado do caminho colunar (o formato
      // que viaja ao sidecar) e o caminho legado string[][] produz o MESMO modelo.
      const legacyModel = stripTime(computeClusterSegments(fx.store, fx.params));
      expect(JSON.parse(JSON.stringify(legacyModel))).toEqual(expected);

      const golden = {
        name: fx.name,
        // Entrada no formato do fio (DEC-HX-006): store serializado M3 (base64 de
        // typed arrays) + params da task — o pytest re-hidrata e executa.
        store: serializeCsvStore(colStore),
        params: fx.params,
        expected,
      };

      if (UPDATE || !fs.existsSync(file)) {
        fs.writeFileSync(file, JSON.stringify(golden, null, 2) + '\n');
      }
      const committed = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(committed.expected).toEqual(expected);
      expect(committed.store).toEqual(JSON.parse(JSON.stringify(golden.store)));
      expect(committed.params).toEqual(JSON.parse(JSON.stringify(fx.params)));
    });
  }
});
