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
// A transferência sem cópia pro worker é a Fase 2 (abaixo): quando o contexto é
// cross-origin isolated, os typed arrays são alocados sobre SharedArrayBuffer e o
// `postMessage(UPDATE_CSV_STORE)` COMPARTILHA a memória (sem cópia) em vez de clonar.

// Tipos de coluna que viram Float64Array. Todo o resto vira dictionary encoding.
export const METRIC_COL_TYPES = new Set([
  'qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida',
]);

// ── Fase 2 — buffers compartilháveis com o worker (zero-cópia) ──────────────────
//
// A base é lida pelos DOIS lados (main renderiza preview/domínios/export em ~134
// call sites; o worker roda a simulação), então NÃO dá para transferir/neutralizar
// os buffers da base para o worker — a main perderia o acesso. A solução (recomendada
// na Proposta §Fase 2, "usar SharedArrayBuffer para leitura compartilhada") é alocar
// os typed arrays sobre `SharedArrayBuffer` quando o contexto é *cross-origin
// isolated* (headers COOP/COEP presentes). Nesse caso o structured clone do
// `postMessage` NÃO copia a memória — ele compartilha o SAB por referência —, então
// main e worker leem os mesmos bytes sem duplicar a base. O worker é read-only, então
// não há write race.
//
// Fora de COI (release aberto via file://, ambiente de teste Node/jsdom, ou browser
// sem os headers) `sharedBuffersAvailable()` é `false` e caímos em `ArrayBuffer`
// comum: o comportamento é o da Fase 1 (clone via structured clone) — correto, só sem
// o ganho de memória. Em NENHUM caso um buffer da base é transferido/neutralizado.
export function sharedBuffersAvailable() {
  return typeof SharedArrayBuffer !== 'undefined'
    && typeof globalThis !== 'undefined'
    && globalThis.crossOriginIsolated === true;
}

// Aloca um Float64Array/Int32Array sobre SharedArrayBuffer quando compartilhável;
// senão sobre ArrayBuffer normal. Ambos têm a mesma semântica de leitura/escrita.
function allocF64(n) {
  return sharedBuffersAvailable()
    ? new Float64Array(new SharedArrayBuffer(n * Float64Array.BYTES_PER_ELEMENT))
    : new Float64Array(n);
}
function allocI32(n) {
  return sharedBuffersAvailable()
    ? new Int32Array(new SharedArrayBuffer(n * Int32Array.BYTES_PER_ELEMENT))
    : new Int32Array(n);
}

// Um csv está sobre buffers compartilhados quando suas colunas são SAB-backed.
export function isSharedColumnar(csv) {
  if (typeof SharedArrayBuffer === 'undefined' || !isColumnar(csv)) return false;
  for (const col of Object.values(csv.columns)) {
    const buf = col.kind === 'num' ? col.data?.buffer : col.codes?.buffer;
    return buf instanceof SharedArrayBuffer; // política de alocação é uniforme no store
  }
  return false;
}

// Monta a mensagem UPDATE_CSV_STORE e a lista de *transferables* do `postMessage`.
//
// A lista de transfer é SEMPRE vazia — e é de propósito:
//   • Com buffers SAB, o structured clone compartilha a memória por referência; SAB
//     não pode (nem deve) ser transferido/neutralizado — é lido pelos dois lados.
//   • Sem SAB, a main ainda precisa dos buffers da base para render, então deixamos
//     o structured clone copiar (Fase 1). Transferi-los neutralizaria a main.
// Em ambos os casos os buffers da base seguem íntegros e legíveis na main após o
// envio (garantia "nada de acessar buffer neutralizado" dos critérios de aceite).
export function buildCsvStoreMessage(csvStore) {
  return { payload: { type: 'UPDATE_CSV_STORE', csvStore }, transfer: [] };
}

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
      const data = allocF64(rowCount);
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
      const codes = allocI32(rowCount);
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

// ── Persistência (Projeto .credito.json / Fluxo) — M3 (Otimização de Memória) ──
// Typed arrays não são JSON nativo. Até o schema 2.2, a serialização virava um
// array PLANO de números (`Array.from(col.data)`): para uma base diária isso é
// ~15MM de números *boxed* — o próprio pico de memória que o formato colunar
// deveria evitar. A partir do schema 2.3, os buffers viram uma STRING BASE64
// (bytes crus do typed array, sem materializar array de números): elimina os
// números boxed, produz um JSON ~30% menor que a mesma sequência em dígitos
// decimais, e serializa/parseia mais rápido.
// `deserializeColumns` aceita os DOIS formatos (base64 novo e array plano antigo)
// — retrocompatibilidade com projetos/exports salvos antes desta mudança. Round-trip
// (dos dois formatos) coberto em tests/columnar.test.js.

// Codifica bytes em base64 em chunks (evita `String.fromCharCode(...bytes)` com
// milhões de argumentos — estoura a pilha de chamada em arrays grandes).
const BASE64_CHUNK = 0x8000;
function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK));
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
}
function base64ToBytes(b64) {
  if (typeof atob === 'function') {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
// Base64 dos bytes crus de um typed array (respeita byteOffset/byteLength — nunca
// assume que a view cobre o buffer inteiro).
function typedArrayToBase64(ta) {
  return bytesToBase64(new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength));
}
// Reconstrói um typed array a partir do base64 dos seus bytes crus.
function base64ToTypedArray(b64, TypedArrayCtor) {
  const bytes = base64ToBytes(b64);
  return new TypedArrayCtor(bytes.buffer, 0, bytes.byteLength / TypedArrayCtor.BYTES_PER_ELEMENT);
}

function serializeColumns(columns) {
  const out = {};
  for (const [name, col] of Object.entries(columns || {})) {
    if (col.kind === 'num') {
      out[name] = { kind: 'num', encoding: 'base64', length: col.data.length, data: typedArrayToBase64(col.data) };
    } else {
      out[name] = { kind: 'dict', dict: col.dict, encoding: 'base64', length: col.codes.length, codes: typedArrayToBase64(col.codes) };
    }
  }
  return out;
}

function deserializeColumns(columns) {
  const out = {};
  for (const [name, col] of Object.entries(columns || {})) {
    if (col.kind === 'num') {
      let data;
      if (col.encoding === 'base64') {
        data = allocF64(col.length ?? 0);
        data.set(base64ToTypedArray(col.data, Float64Array));
      } else {
        const src = col.data || []; // formato legado (schema ≤ 2.2): array plano
        data = allocF64(src.length); data.set(src);
      }
      out[name] = { kind: 'num', data };
    } else {
      let codes;
      if (col.encoding === 'base64') {
        codes = allocI32(col.length ?? 0);
        codes.set(base64ToTypedArray(col.codes, Int32Array));
      } else {
        const src = col.codes || []; // formato legado (schema ≤ 2.2): array plano
        codes = allocI32(src.length); codes.set(src);
      }
      out[name] = { kind: 'dict', dict: col.dict || [], codes };
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
