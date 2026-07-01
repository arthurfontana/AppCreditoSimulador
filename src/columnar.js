// ── Armazenamento colunar do csvStore (Otimização de Memória — Fase 1) ──────────
//
// Substitui `string[][]` (um objeto string por célula, ~15MM de objetos numa base
// de 1MM×15) por representação colunar vetorizada:
//   - métricas (qty, qtdAltas, qtdAltasInfer, inadReal, inadInferida) → Float64Array
//     (números prontos, sem parseFloat por tick);
//   - dimensões / ID / decisão (incl. __DECISAO_ORIGINAL) → dictionary encoding
//     ({ dict: string[], codes: Int32Array }) — o dicionário JÁ é a lista de distintos.
//
// Tudo é acessado por um accessor uniforme (cellStr/cellNum/rowCount/…) que funciona
// tanto sobre a base colunar (produção) quanto sobre o legado `string[][]` (usado nos
// testes e em previews transitórios do wizard). Isso mantém o GATE numérico
// (tests/inferenceCascade.test.js) passando inalterado: os hot paths do worker leem
// pelo accessor, e o legado reproduz exatamente `row[idx]`.
//
// A transferência sem cópia pro worker (ArrayBuffer transferível) é a Fase 2 — aqui
// o `postMessage` ainda faz structured clone (que preserva typed arrays).

// Tipos de coluna que viram Float64Array. Todo o resto vira dictionary encoding.
export const METRIC_COL_TYPES = new Set([
  'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida',
]);

// Um csv está em formato colunar quando tem `columns` (mapa por nome de coluna).
export function isColumnar(csv) {
  return !!(csv && csv.columns);
}

// Vetoriza headers + rows (string[][]) num payload colunar { columns, rowCount }.
// `rows` pode ser consumido e liberado depois desta chamada (é o ponto onde a base
// deixa de existir como string[][] na RAM).
export function buildColumnar(headers, rows, columnTypes) {
  const rowCount = rows.length;
  const columns = {};
  const types = columnTypes || {};
  for (let c = 0; c < headers.length; c++) {
    const name = headers[c];
    if (METRIC_COL_TYPES.has(types[name])) {
      const data = new Float64Array(rowCount);
      for (let r = 0; r < rowCount; r++) {
        // parseFloat sem `|| 0`: mantém NaN p/ célula vazia/inválida. Os call sites
        // aplicam `|| 0` / `|| 1` — NaN e 0 são ambos falsy, então o resultado é
        // idêntico ao legado `parseFloat(row[idx]) || 0` (não muda a matemática).
        data[r] = parseFloat(rows[r][c]);
      }
      columns[name] = { kind: 'num', data };
    } else {
      const dict = [];
      const dictIndex = new Map();
      const codes = new Int32Array(rowCount);
      for (let r = 0; r < rowCount; r++) {
        const v = rows[r][c] ?? '';
        let code = dictIndex.get(v);
        if (code === undefined) { code = dict.length; dict.push(v); dictIndex.set(v, code); }
        codes[r] = code;
      }
      columns[name] = { kind: 'dict', dict, codes };
    }
  }
  return { columns, rowCount };
}

// Nº de linhas — funciona sobre colunar (rowCount) e legado (rows.length).
export function rowCount(csv) {
  if (!csv) return 0;
  if (isColumnar(csv)) return csv.rowCount;
  return csv.rows ? csv.rows.length : 0;
}

// Valor de célula como string — equivalente exato a `row[colIdx]` no legado.
// Em colunar: dict → dict[codes[r]]; num → string do número (fallback defensivo,
// pois métricas não são lidas como dimensão na prática).
export function cellStr(csv, r, c) {
  if (!isColumnar(csv)) {
    const row = csv.rows[r];
    return row ? row[c] : undefined;
  }
  const col = csv.columns[csv.headers[c]];
  if (!col) return undefined;
  if (col.kind === 'dict') return col.dict[col.codes[r]];
  const v = col.data[r];
  return Number.isNaN(v) ? '' : String(v);
}

// Valor de célula como número. NÃO aplica `|| 0` — o call site preserva seu
// default (`|| 0` ou `|| 1`), exatamente como no legado `parseFloat(row[idx])`.
export function cellNum(csv, r, c) {
  if (!isColumnar(csv)) {
    const row = csv.rows[r];
    return row ? parseFloat(row[c]) : NaN;
  }
  const col = csv.columns[csv.headers[c]];
  if (!col) return NaN;
  if (col.kind === 'num') return col.data[r];
  return parseFloat(col.dict[col.codes[r]]);
}

// Materializa UMA linha como string[] (para preview do CSV node, export, etc.).
export function getRow(csv, r) {
  if (!isColumnar(csv)) return csv.rows[r];
  const out = new Array(csv.headers.length);
  for (let c = 0; c < csv.headers.length; c++) out[c] = cellStr(csv, r, c) ?? '';
  return out;
}

// Materializa a base inteira como string[][]. Uso pontual/raro (ex.: modo de edição
// do wizard, que reconstrói/re-deriva colunas). Cria um pico transitório de memória
// que é liberado logo em seguida — evite em hot paths.
export function materializeRows(csv) {
  if (!isColumnar(csv)) return csv.rows || [];
  const n = csv.rowCount;
  const out = new Array(n);
  for (let r = 0; r < n; r++) out[r] = getRow(csv, r);
  return out;
}

// Valores distintos (não-vazios) de uma coluna, em ordem de primeira aparição.
// Em colunar dict, é simplesmente o dicionário (já é a lista de distintos) —
// O(distintos) em vez de varrer 1MM de linhas.
export function distinctColValues(csv, c) {
  if (isColumnar(csv)) {
    const col = csv.columns[csv.headers[c]];
    if (col && col.kind === 'dict') return col.dict.filter(v => v !== '' && v != null);
    // num column → distintos pelos valores numéricos formatados
    const set = new Set();
    if (col) for (let r = 0; r < csv.rowCount; r++) { const v = cellStr(csv, r, c); if (v !== '' && v != null) set.add(v); }
    return [...set];
  }
  const set = new Set();
  for (const row of (csv.rows || [])) { const v = row[c] ?? ''; if (v !== '') set.add(v); }
  return [...set];
}

// ── Persistência (Projeto .credito.json / Fluxo) ────────────────────────────────
// Typed arrays não são JSON nativo; convertemos para arrays planos na serialização
// e reconstruímos os typed arrays na carga (mesmo padrão de serializeInferenceRef).
// Round-trip coberto em tests/columnar.test.js.

function serializeColumns(columns) {
  const out = {};
  for (const [name, col] of Object.entries(columns || {})) {
    if (col.kind === 'num') {
      out[name] = { kind: 'num', data: Array.from(col.data) };
    } else {
      out[name] = { kind: 'dict', dict: col.dict, codes: Array.from(col.codes) };
    }
  }
  return out;
}

function deserializeColumns(columns) {
  const out = {};
  for (const [name, col] of Object.entries(columns || {})) {
    if (col.kind === 'num') {
      out[name] = { kind: 'num', data: new Float64Array(col.data || []) };
    } else {
      out[name] = { kind: 'dict', dict: col.dict || [], codes: new Int32Array(col.codes || []) };
    }
  }
  return out;
}

// Serializa um csvStore inteiro para JSON. Entradas colunares viram arrays planos;
// entradas legadas (com `rows`) passam direto (retrocompatível com arquivos antigos).
export function serializeCsvStore(store) {
  const out = {};
  for (const [id, csv] of Object.entries(store || {})) {
    if (isColumnar(csv)) {
      out[id] = { ...csv, columns: serializeColumns(csv.columns) };
    } else {
      out[id] = csv;
    }
  }
  return out;
}

// Reconstrói typed arrays na carga. Aceita:
//   - formato colunar novo ({ columns, rowCount });
//   - formato legado antigo ({ rows: string[][] }) → vetoriza on-the-fly (migração
//     transparente de projetos salvos antes da Fase 1).
export function deserializeCsvStore(store) {
  const out = {};
  for (const [id, csv] of Object.entries(store || {})) {
    if (csv && csv.columns) {
      out[id] = { ...csv, columns: deserializeColumns(csv.columns) };
    } else if (csv && Array.isArray(csv.rows)) {
      const { columns, rowCount: n } = buildColumnar(csv.headers || [], csv.rows, csv.columnTypes);
      const { rows, ...rest } = csv;
      out[id] = { ...rest, columns, rowCount: n };
    } else {
      out[id] = csv;
    }
  }
  return out;
}
