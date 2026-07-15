// ── Armazenamento colunar do csvStore (Otimização de Memória — Fase 1) ──────────
//
// Substitui `string[][]` (um objeto string por célula, ~15MM de objetos numa base
// de 1MM×15) por representação colunar vetorizada:
//   - métricas (qty, qtdAltas, qtdAltasInfer, inadReal, inadInferida) → Float64Array
//     (números prontos, sem parseFloat por tick);
//   - dimensões / ID / decisão (incl. __DECISAO_ORIGINAL) → dictionary encoding
//     ({ dict: string[], codes }) — o dicionário JÁ é a lista de distintos; os códigos
//     usam o menor typed array pela cardinalidade (Uint8/Uint16/Int32 — dieta H2).
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

// Aloca um typed array (Float64/Int32/Uint16/Uint8) sobre SharedArrayBuffer quando
// compartilhável; senão sobre ArrayBuffer normal. Ambos têm a mesma semântica de
// leitura/escrita.
function alloc(Ctor, n) {
  return sharedBuffersAvailable()
    ? new Ctor(new SharedArrayBuffer(n * Ctor.BYTES_PER_ELEMENT))
    : new Ctor(n);
}
function allocF64(n) { return alloc(Float64Array, n); }
function allocI32(n) { return alloc(Int32Array, n); }

// ── Dieta de memória (Execução Híbrida H2, §2.2 Eixo 1) ─────────────────────────
// Os códigos do dictionary encoding escolhem o MENOR typed array que comporta a
// cardinalidade do dicionário: colunas de baixa cardinalidade (a maioria numa base
// dimensional) passam de 4 bytes/linha (Int32) para 1 (Uint8) ou 2 (Uint16) — ~2× a
// 4× menos RAM nas colunas de dimensão, sem mudar nenhum valor (é ganho de constante).
// Fronteiras por CAPACIDADE do tipo (maior código representável): Uint8 0..255,
// Uint16 0..65535, Int32 acima. Métricas seguem Float64Array (os GATEs de igualdade
// numérica exigem — não são afetadas). Os códigos são LIDOS por indexação
// (`codes[r]`) em todo consumidor (motor M8, M15, accessors), que é dtype-agnóstica:
// nenhum caminho de leitura assume Int32Array.
const CODES_CTOR_BY_NAME = { Uint8Array, Uint16Array, Int32Array };
export function codesCtorForDict(dictLen) {
  const maxCode = dictLen - 1;      // maior código a representar (dict é 0-based)
  if (maxCode <= 0xFF) return Uint8Array;      // ≤ 255  → 1 byte/linha
  if (maxCode <= 0xFFFF) return Uint16Array;   // ≤ 65535 → 2 bytes/linha
  return Int32Array;                            // acima  → 4 bytes/linha
}

// Empacota códigos já preenchidos (num Int32Array/growable transitório, ou array
// plano do formato legado) no MENOR typed array SAB-aware que comporta `dictLen`
// valores distintos. Copia as `n` primeiras posições de `src`.
function packCodes(src, n, dictLen) {
  const codes = alloc(codesCtorForDict(dictLen), n);
  if (src.length === n) codes.set(src);
  else if (src.subarray) codes.set(src.subarray(0, n));
  else codes.set(src.slice(0, n));
  return codes;
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
      // tmp Int32 transitório: a cardinalidade final só é conhecida no fim do loop;
      // packCodes reduz ao menor dtype (dieta de memória) na cópia final SAB-aware.
      const tmp = new Int32Array(rowCount);
      for (let r = 0; r < rowCount; r++) {
        const v = rows[r][c] ?? '';
        let code = dictIndex.get(v);
        if (code === undefined) { code = dict.length; dict.push(v); dictIndex.set(v, code); }
        tmp[r] = code;
      }
      columns[name] = { kind: 'dict', dict, codes: packCodes(tmp, rowCount, dict.length) };
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

// ── M1 (PERFORMANCE-ANALISE, Fase D) — Pipeline de importação vetorizado ────────
//
// Até o M1, o funil de import mantinha a base em 3–5 formas simultâneas na RAM
// (texto cru no wizard + string[][] completo + cópia do normalizeDecimalSep +
// cópia da derivação de __DECISAO_ORIGINAL) e só vetorizava NO FIM (buildColumnar).
// Aqui o parse alimenta os encoders colunares DIRETAMENTE, linha a linha — a
// matriz string[][] nunca existe:
//   - parseCSVToColumnarAsync: parse chunked (mesma varredura por índice da Fase 0)
//     → todas as colunas como dict encoding (os tipos de métrica só são conhecidos
//     no passo 2 do wizard) + um preview de N linhas para a UI;
//   - finalizeImportedColumns: no confirm, converte para Float64Array SÓ as colunas
//     marcadas como métrica (O(distintos) de parseFloat + O(n) de inteiros) e aplica
//     a normalização de separador decimal (','→'.') sobre os DICIONÁRIOS
//     (O(distintos), com dedup+remap de códigos quando valores colidem) — o antigo
//     normalizeDecimalSep (cópia integral da matriz) deixa de existir;
//   - deriveMappedDictColumn: __DECISAO_ORIGINAL vira coluna dict DERIVADA — um
//     mapa código da coluna AS IS → código de 'APROVADO'/'REPROVADO'/'' e um loop
//     O(n) sobre codes, sem tocar nas demais colunas, sem copiar linha;
//   - retypeColumn: modo de edição do wizard reclassifica colunas (dict↔num) sem
//     materializar a base como string[][] (substitui o materializeRows do confirm).
// Nenhuma mudança de matemática: equivalência célula a célula com o caminho legado
// (parseCSV → normalizeDecimalSep → append __DECISAO_ORIGINAL → buildColumnar)
// coberta em tests/importPipeline.test.js.

// Mesma regra do normalizeDecimalSep legado: só converte células que são um
// número "puro" com vírgula decimal (ex.: "0,394"); "1.234,56" não casa e passa.
const DECIMAL_COMMA_RE = /^\-?\d+,\d+$/;
function normalizeDecimalCell(cell) {
  const v = (cell ?? '').trim();
  return DECIMAL_COMMA_RE.test(v) ? v.replace(',', '.') : cell;
}

// Parse assíncrono/chunked de CSV DIRETO para colunas dict-encoded.
// Substitui o parseCSVAsync (Fase 0) no import: mantém a varredura por índice
// (sem text.split — nenhum array de 1MM de strings) e elimina também a saída
// string[][] — cada célula entra no encoder da sua coluna e vira um inteiro.
// Cede a thread principal a cada lote (setTimeout 0) e reporta progresso via
// onProgress(posiçãoConsumida, total), como antes.
// Retorna { headers, columns, rowCount, previewRows }:
//   - columns: {[nome]: {kind:'dict', dict, codes}} — TODAS dict (a conversão de
//     métricas para Float64Array acontece só no confirm, via finalizeImportedColumns);
//   - previewRows: as primeiras PREVIEW_ROWS linhas como string[] cruas (amostra
//     para a tabela de prévia do wizard — a UI não precisa de mais nada por linha).
const PREVIEW_ROWS = 100;
export function parseCSVToColumnarAsync(text, delimiter, hasHeader, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const split = (line) => {
        const res = []; let f = "", q = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (c === '"') q = !q;
          else if (c === delimiter && !q) { res.push(f.trim()); f = ""; }
          else f += c;
        }
        res.push(f.trim());
        return res;
      };
      const len = text.length;
      let pos = 0;
      // Próxima linha não-vazia por índice (idêntico ao nextLine da Fase 0).
      const nextLine = () => {
        while (pos < len) {
          let nl = text.indexOf('\n', pos);
          if (nl === -1) nl = len;
          const start = pos;
          let end = nl;
          if (end > start && text.charCodeAt(end - 1) === 13) end--; // \r final
          pos = nl + 1;
          if (end > start) {
            const line = text.slice(start, end);
            if (line.trim()) return line;
          }
        }
        return null;
      };

      const firstLine = nextLine();
      if (firstLine === null) { resolve({ headers: [], columns: {}, rowCount: 0, previewRows: [] }); return; }
      const first = split(firstLine);
      const headers = hasHeader ? first : first.map((_, i) => `Coluna ${i + 1}`);
      const nCols = headers.length;

      // Encoders por coluna (por ÍNDICE — headers duplicados colidem só na
      // montagem final do mapa, com o mesmo last-wins do buildColumnar).
      const dicts = new Array(nCols);
      const dictIndexes = new Array(nCols);
      let codesBuf = new Array(nCols);
      let cap = 1024;
      for (let c = 0; c < nCols; c++) {
        dicts[c] = [];
        dictIndexes[c] = new Map();
        codesBuf[c] = new Int32Array(cap); // growable comum; a cópia final usa allocI32 (SAB-aware)
      }
      let n = 0;
      const previewRows = [];

      const pushRow = (cells) => {
        if (n === cap) {
          cap *= 2;
          for (let c = 0; c < nCols; c++) {
            const grown = new Int32Array(cap);
            grown.set(codesBuf[c]);
            codesBuf[c] = grown;
          }
        }
        for (let c = 0; c < nCols; c++) {
          const v = cells[c] ?? ''; // linha "ragged" → '' (mesma regra do buildColumnar)
          let code = dictIndexes[c].get(v);
          if (code === undefined) { code = dicts[c].length; dicts[c].push(v); dictIndexes[c].set(v, code); }
          codesBuf[c][n] = code;
        }
        if (previewRows.length < PREVIEW_ROWS) previewRows.push(cells);
        n++;
      };

      if (!hasHeader) pushRow(first); // sem cabeçalho, a 1ª linha também é dado

      const CHUNK = 3000;
      let finished = false;
      const finish = () => {
        const columns = {};
        for (let c = 0; c < nCols; c++) {
          // menor dtype pela cardinalidade + SAB-aware (Fase 2) — dieta de memória (H2).
          const codes = packCodes(codesBuf[c], n, dicts[c].length);
          codesBuf[c] = null;                 // solta o buffer growable
          columns[headers[c]] = { kind: 'dict', dict: dicts[c], codes };
        }
        resolve({ headers, columns, rowCount: n, previewRows });
      };
      const step = () => {
        try {
          let count = 0;
          while (count < CHUNK) {
            const line = nextLine();
            if (line === null) { finished = true; break; }
            pushRow(split(line));
            count++;
          }
          if (onProgress) onProgress(finished ? len : Math.min(pos, len), len);
          if (finished) finish();
          else setTimeout(step, 0);
        } catch (err) { reject(err); }
      };
      step();
    } catch (err) { reject(err); }
  });
}

// Converte um dict column em Float64Array: parseFloat UMA vez por valor distinto
// (com a normalização ','→'.' quando pedida) e lookup de inteiro por linha.
// parseFloat('') = NaN — mesma semântica do buildColumnar (call sites aplicam ||0).
function numFromDictColumn(col, n, normalizeDecimal) {
  const src = col.dict;
  const numByCode = new Float64Array(src.length);
  for (let k = 0; k < src.length; k++) {
    const cell = normalizeDecimal ? normalizeDecimalCell(src[k]) : src[k];
    numByCode[k] = parseFloat(cell);
  }
  const data = allocF64(n);
  for (let r = 0; r < n; r++) data[r] = numByCode[col.codes[r]];
  return { kind: 'num', data };
}

// Converte um num column em dict (NaN → '', senão String(v)) — mesma string que
// cellStr produz, e a mesma que o caminho legado obtinha ao materializar a linha.
function dictFromNumColumn(col, n) {
  const dict = []; const dictIndex = new Map();
  const tmp = new Int32Array(n); // transitório; menor dtype só no fim (cardinalidade final)
  for (let r = 0; r < n; r++) {
    const v = col.data[r];
    const s = Number.isNaN(v) ? '' : String(v);
    let code = dictIndex.get(s);
    if (code === undefined) { code = dict.length; dict.push(s); dictIndex.set(s, code); }
    tmp[r] = code;
  }
  return { kind: 'dict', dict, codes: packCodes(tmp, n, dict.length) };
}

// Normalização de separador decimal sobre um dict column: transforma os VALORES
// DO DICIONÁRIO (O(distintos)) em vez de copiar a matriz. Se a normalização faz
// dois valores colidirem (ex.: "1,5" e "1.5"), deduplica e remapeia os códigos
// (O(n) de inteiros) — preservando a ordem de primeira aparição, que é a mesma
// que o normalizeDecimalSep legado + buildColumnar produziriam.
function normalizeDictDecimal(col, n) {
  const src = col.dict;
  let changed = false;
  const normed = new Array(src.length);
  for (let k = 0; k < src.length; k++) {
    normed[k] = normalizeDecimalCell(src[k]);
    if (normed[k] !== src[k]) changed = true;
  }
  if (!changed) return col;
  const dict = []; const dictIndex = new Map();
  const translate = new Int32Array(src.length);
  for (let k = 0; k < src.length; k++) {
    let code = dictIndex.get(normed[k]);
    if (code === undefined) { code = dict.length; dict.push(normed[k]); dictIndex.set(normed[k], code); }
    translate[k] = code;
  }
  if (dict.length === src.length) {
    // nenhum merge — translate é identidade; reusa os codes sem cópia (já no dtype certo)
    return { kind: 'dict', dict, codes: col.codes };
  }
  // merge encolhe o dicionário: dtype pode reduzir. dict.length já é conhecido aqui.
  const codes = alloc(codesCtorForDict(dict.length), n);
  for (let r = 0; r < n; r++) codes[r] = translate[col.codes[r]];
  return { kind: 'dict', dict, codes };
}

// Confirm do wizard (import novo): aplica os tipos do passo 2 sobre as colunas
// all-dict do parse — métricas viram Float64Array, dimensões ganham a normalização
// decimal — e devolve { columns, rowCount } no formato final do csvStore.
// Colunas não tocadas são REUSADAS por referência (zero cópia).
export function finalizeImportedColumns(headers, columns, n, columnTypes, decimalSep) {
  const types = columnTypes || {};
  const normalize = (decimalSep || '.') !== '.';
  const out = {};
  for (const name of headers) {
    const col = columns[name];
    if (METRIC_COL_TYPES.has(types[name])) {
      out[name] = !col ? { kind: 'num', data: allocF64(n).fill(NaN) }
        : col.kind === 'num' ? col
        : numFromDictColumn(col, n, normalize);
    } else {
      out[name] = !col ? { kind: 'dict', dict: [''], codes: alloc(codesCtorForDict(1), n) }
        : col.kind === 'dict' ? (normalize ? normalizeDictDecimal(col, n) : col)
        : dictFromNumColumn(col, n);
    }
  }
  return { columns: out, rowCount: n };
}

// Deriva uma coluna dict aplicando mapFn(valor) sobre outra coluna — usada para
// __DECISAO_ORIGINAL (mapFn = valor AS IS → 'APROVADO'/'REPROVADO'/''). Sobre um
// dict column, mapFn roda UMA vez por valor distinto (translate código→código) e
// o loop de linhas só copia inteiros. A ordem do dicionário derivado é a de
// primeira aparição nas linhas — idêntica à do caminho legado (append + build).
export function deriveMappedDictColumn(srcCol, n, mapFn) {
  const dict = []; const dictIndex = new Map();
  const tmp = new Int32Array(n); // transitório; menor dtype só no fim (dict derivado costuma ser minúsculo)
  const putCode = (mapped) => {
    let code = dictIndex.get(mapped);
    if (code === undefined) { code = dict.length; dict.push(mapped); dictIndex.set(mapped, code); }
    return code;
  };
  if (srcCol && srcCol.kind === 'dict') {
    const translate = new Int32Array(srcCol.dict.length).fill(-1);
    for (let r = 0; r < n; r++) {
      const sc = srcCol.codes[r];
      let dc = translate[sc];
      if (dc === -1) { dc = putCode(mapFn(srcCol.dict[sc])); translate[sc] = dc; }
      tmp[r] = dc;
    }
  } else if (srcCol && srcCol.kind === 'num') {
    for (let r = 0; r < n; r++) {
      const v = srcCol.data[r];
      tmp[r] = putCode(mapFn(Number.isNaN(v) ? '' : String(v)));
    }
  } else {
    tmp.fill(putCode(mapFn('')));
  }
  return { kind: 'dict', dict, codes: packCodes(tmp, n, dict.length) };
}

// ── Coluna derivada de Variável de Cluster (interpretação da clusterização) ──────
// Materializa uma coluna dict a partir de uma DEFINIÇÃO de cluster: cada grupo é um
// conjunto de listas de valores por dimensão (bounding box), e a linha recebe o
// rótulo do PRIMEIRO grupo cujas listas contêm o valor da linha em TODAS as dimensões
// (first-match-wins — os grupos vêm ordenados por volume desc). Linha que não casa
// nenhum grupo recebe `unmatchedLabel`. Semântica de valor idêntica à agregação da
// clusterização (`cluDimValue`): valor TRIMADO; dimensão ausente/sem lista = curinga.
// Exato para 1 dimensão; aproximação editável por faixas para 2+ (mesma técnica do
// "Ver no Dashboard"). Precompila, por dimensão dict, uma máscara Uint8Array por
// grupo sobre o dicionário (O(distintos)); no loop de linhas resta ler `codes[r]`.
//
// def = { dims:[col...], unmatchedLabel, groups:[{label, members:{[col]:[val...]}}...] }
export function deriveClusterColumn(csv, def) {
  const n = rowCount(csv);
  const dims = (def && def.dims) || [];
  const groups = (def && def.groups) || [];
  const unmatchedLabel = (def && def.unmatchedLabel != null) ? def.unmatchedLabel : '';
  const columnar = isColumnar(csv);

  // Leitor por dimensão: dict → {codes, trimmed[]}; senão → {rowIdx} (trim por linha);
  // dimensão ausente na base → null (curinga em todos os grupos).
  const readers = dims.map((dc) => {
    const ci = csv.headers.indexOf(dc);
    if (ci < 0) return null;
    if (columnar) {
      const col = csv.columns[dc];
      if (col && col.kind === 'dict') {
        return { kind: 'dict', codes: col.codes, trimmed: col.dict.map(v => (v ?? '').toString().trim()) };
      }
    }
    return { kind: 'row', ci };
  });

  // Por grupo × dimensão: máscara/set de membros trimados (ou curinga).
  const masks = groups.map(g => dims.map((dc, di) => {
    const rdr = readers[di];
    const members = g && g.members ? g.members[dc] : null;
    if (rdr == null || members == null) return { wildcard: true };
    const set = new Set(members.map(v => (v ?? '').toString().trim()));
    if (rdr.kind === 'dict') {
      const mask = new Uint8Array(rdr.trimmed.length);
      for (let c = 0; c < rdr.trimmed.length; c++) mask[c] = set.has(rdr.trimmed[c]) ? 1 : 0;
      return { mask };
    }
    return { set };
  }));

  const G = groups.length;
  const grpOfRow = new Int32Array(n).fill(-1);
  for (let r = 0; r < n; r++) {
    for (let gi = 0; gi < G; gi++) {
      const mg = masks[gi];
      let ok = true;
      for (let di = 0; di < dims.length; di++) {
        const m = mg[di];
        if (m.wildcard) continue;
        const rdr = readers[di];
        if (m.mask) { if (m.mask[rdr.codes[r]] !== 1) { ok = false; break; } }
        else { const v = (cellStr(csv, r, rdr.ci) ?? '').toString().trim(); if (!m.set.has(v)) { ok = false; break; } }
      }
      if (ok) { grpOfRow[r] = gi; break; }
    }
  }

  // Dicionário na ordem dos grupos que ocorrem, depois o rótulo "fora" se houver.
  let anyUnmatched = false;
  const occurs = new Uint8Array(G);
  for (let r = 0; r < n; r++) { const gi = grpOfRow[r]; if (gi < 0) anyUnmatched = true; else occurs[gi] = 1; }
  const dict = []; const labelCode = new Map();
  const codeForLabel = (label) => {
    let c = labelCode.get(label);
    if (c === undefined) { c = dict.length; dict.push(label); labelCode.set(label, c); }
    return c;
  };
  const groupCode = new Int32Array(G).fill(-1);
  for (let gi = 0; gi < G; gi++) if (occurs[gi]) groupCode[gi] = codeForLabel(groups[gi].label ?? '');
  const unmatchedCode = anyUnmatched ? codeForLabel(unmatchedLabel) : -1;
  if (dict.length === 0) dict.push(unmatchedLabel); // base vazia → dict não-degenerado

  const tmp = new Int32Array(n);
  for (let r = 0; r < n; r++) { const gi = grpOfRow[r]; tmp[r] = gi < 0 ? unmatchedCode : groupCode[gi]; }
  return { kind: 'dict', dict, codes: packCodes(tmp, n, dict.length) };
}

// ── Coluna derivada de Variável de Faixas (Criar Faixas por Risco, Épico FR) ─────
// Materializa uma coluna dict ORDINAL a partir de uma DEFINIÇÃO de faixas: cada linha
// recebe o rótulo da faixa [min, max) que contém o valor NUMÉRICO da coluna de
// origem (`def.sourceCol`), parseado com a MESMA semântica de `cellNum` (parseFloat).
// Fronteiras localizadas por busca binária (as faixas são contíguas e ordenadas —
// `def.bands[i].max` é não-decrescente); ponta null = ±infinito. Valor não parseável
// (ou coluna ausente na base) ⇒ `unmatchedLabel`. Sobre coluna dict, resolve a faixa
// UMA vez por valor distinto (O(distintos)); sobre coluna num, lê direto. Ordinal
// (faixas têm ordem natural) — `columnTypes[col]='decision'`, `varTypes[col]='ordinal'`
// no call site (App.jsx), como a materialização entra pela plumbing existente
// (decisionVars, createDecisionNode, assignCinemaVar, Dashboard).
//
// def = { sourceCol, unmatchedLabel, bands: [{ label, min, max }...] } — bands já
// ORDENADAS por min crescente (garantia de buildRangeDefFromModel/editRangeCuts em
// src/rangeVar.js).
export function deriveRangeColumn(csv, def) {
  const n = rowCount(csv);
  const bands = (def && def.bands) || [];
  const unmatchedLabel = (def && def.unmatchedLabel != null) ? def.unmatchedLabel : '';
  const B = bands.length;
  const dict = bands.map(b => b.label);
  let unmCode = dict.indexOf(unmatchedLabel);
  const codeForUnmatched = () => {
    if (unmCode === -1) { unmCode = dict.length; dict.push(unmatchedLabel); }
    return unmCode;
  };
  if (dict.length === 0) dict.push(unmatchedLabel); // sem faixas ⇒ tudo unmatched

  // Busca binária pela fronteira superior (bands[i].max, [min,max) — não-decrescente,
  // última faixa max=null=+∞): menor i tal que x < bands[i].max (ou a última faixa).
  const bandForX = (x) => {
    if (B === 0 || !Number.isFinite(x)) return -1;
    let lo = 0, hi = B - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const max = bands[mid].max;
      if (max != null && x >= max) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  const srcCol = def && def.sourceCol;
  const ci = (csv.headers || []).indexOf(srcCol);
  const tmp = new Int32Array(n);
  if (ci < 0) {
    tmp.fill(codeForUnmatched());
  } else if (isColumnar(csv)) {
    const col = csv.columns[srcCol];
    if (col && col.kind === 'num') {
      for (let r = 0; r < n; r++) {
        const bi = bandForX(col.data[r]);
        tmp[r] = bi >= 0 ? bi : codeForUnmatched();
      }
    } else if (col && col.kind === 'dict') {
      // Resolve UMA vez por distinto (cellNum-consistente: parseFloat do valor do dict).
      const codeByDictCode = new Int32Array(col.dict.length).fill(-2); // -2 = não resolvido ainda
      for (let r = 0; r < n; r++) {
        const dc = col.codes[r];
        let bc = codeByDictCode[dc];
        if (bc === -2) {
          const bi = bandForX(parseFloat(col.dict[dc]));
          bc = bi >= 0 ? bi : codeForUnmatched();
          codeByDictCode[dc] = bc;
        }
        tmp[r] = bc;
      }
    } else {
      tmp.fill(codeForUnmatched());
    }
  } else {
    for (let r = 0; r < n; r++) {
      const bi = bandForX(cellNum(csv, r, ci));
      tmp[r] = bi >= 0 ? bi : codeForUnmatched();
    }
  }
  return { kind: 'dict', dict, codes: packCodes(tmp, n, dict.length) };
}

// Modo de edição do wizard: reclassificar uma coluna (métrica ↔ dimensão) sem
// materializar a base. Se o tipo não mudou, devolve a própria coluna (as colunas
// nunca são mutadas, então compartilhar a referência com a entrada anterior do
// store é seguro). Coluna ausente → defaults do caminho legado (parseFloat('')
// = NaN para métrica; '' para dimensão).
export function retypeColumn(col, toNum, n) {
  if (toNum) {
    if (!col) return { kind: 'num', data: allocF64(n).fill(NaN) };
    if (col.kind === 'num') return col;
    return numFromDictColumn(col, n, false);
  }
  if (!col) return { kind: 'dict', dict: [''], codes: alloc(codesCtorForDict(1), n) };
  if (col.kind === 'dict') return col;
  return dictFromNumColumn(col, n);
}

// ── Persistência (Projeto .credito.json / Fluxo) — M3 (Otimização de Memória) ──
// Typed arrays não são JSON nativo. Até o schema 2.2, a serialização virava um
// array PLANO de números (`Array.from(col.data)`): para uma base diária isso é
// ~15MM de números *boxed* — o próprio pico de memória que o formato colunar
// deveria evitar. A partir do schema 2.3, os buffers viram uma STRING BASE64
// (bytes crus do typed array, sem materializar array de números): elimina os
// números boxed, produz um JSON ~30% menor que a mesma sequência em dígitos
// decimais, e serializa/parseia mais rápido.
// `deserializeColumns` aceita os TRÊS formatos aceitos hoje — retrocompatibilidade
// com projetos/exports salvos antes de cada mudança; round-trip coberto em
// tests/columnar.test.js:
//   (a) base64 COM `dtype` (dieta de memória H2): os códigos são lidos com o ctor
//       gravado (Uint8Array/Uint16Array/Int32Array);
//   (b) base64 SEM `dtype` (schema 2.3): os códigos eram sempre Int32 — lidos como
//       Int32Array e re-empacotados ao menor dtype na carga (packCodes);
//   (c) array plano (schema ≤ 2.2): idem — re-empacotado ao menor dtype.
// Em todos os casos os códigos carregados ficam no MENOR typed array pela
// cardinalidade do dicionário (packCodes), SAB-aware. Métricas seguem Float64Array.

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
      // `dtype` no envelope: sem ele, o leitor legado supõe Int32 (formato base64
      // pré-dieta). Com ele, o menor dtype (Uint8/Uint16/Int32) é reconstruído fiel.
      out[name] = { kind: 'dict', dict: col.dict, encoding: 'base64', dtype: col.codes.constructor.name, length: col.codes.length, codes: typedArrayToBase64(col.codes) };
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
      const dict = col.dict || [];
      let raw;
      if (col.encoding === 'base64') {
        // dtype gravado (dieta H2) → ctor fiel; ausente (base64 pré-dieta) → Int32.
        const Ctor = CODES_CTOR_BY_NAME[col.dtype] || Int32Array;
        raw = base64ToTypedArray(col.codes, Ctor);
      } else {
        raw = col.codes || []; // formato legado (schema ≤ 2.2): array plano
      }
      const length = col.length ?? raw.length;
      // Re-empacota ao menor dtype pela cardinalidade — carga sempre na dieta.
      out[name] = { kind: 'dict', dict, codes: packCodes(raw, length, dict.length) };
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

// ── Estimativa de RAM colunar (Execução Híbrida H2/H6, DEC-HX-009) ──────────────
// Mesma conta em dois lugares (wizard passo 2 — pré-import, e abertura de projeto —
// pós-import): linhas × Σ bytes/coluna (Float64 pras métricas, o menor dtype de código
// pela cardinalidade pras dimensões/decisão — `codesCtorForDict`, dieta H2). Acima da
// zona de conforto (~5MM linhas OU ~1,2GB) o app recomenda proativamente ligar o Motor
// Python (nunca bloqueia — DEC-HX-009).
export const RAM_COMFORT_BYTES = 1.2 * (1 << 30); // ~1,2GB
export const ROW_COMFORT_COUNT = 5_000_000;       // ~5MM linhas

// Estima os bytes de UM dataset já em formato colunar (`{columns, rowCount}` — a forma
// de `csvStore[csvId]` depois de importado/deserializado). Para o wizard, ANTES do
// import (passo 2, onde métricas ainda não viraram Float64 — ver M1), o cálculo é feito
// inline em App.jsx sobre `wizard.columnTypes`/`parsedColumns`, que ainda não tem o
// `kind` final; esta função cobre o caso pós-import (csvStore real, `loadProject`).
export function estimateColumnarRamBytes(csv) {
  if (!csv || !csv.columns) return 0;
  const n = csv.rowCount || 0;
  let bytes = 0;
  for (const col of Object.values(csv.columns)) {
    if (!col) continue;
    if (col.kind === 'num') bytes += n * 8;
    else if (col.kind === 'dict') bytes += n * codesCtorForDict((col.dict || []).length).BYTES_PER_ELEMENT;
  }
  return bytes;
}

// Soma a estimativa de todos os datasets de um csvStore inteiro (abertura de projeto —
// DEC-HX-009 avalia o estudo completo, não só a base ativa).
export function estimateCsvStoreRamBytes(store) {
  let total = 0;
  for (const csv of Object.values(store || {})) total += estimateColumnarRamBytes(csv);
  return total;
}

// Soma de linhas do csvStore inteiro — par do limiar de ~5MM linhas do DEC-HX-009
// (independente do teto de bytes: uma base larga e rasa pode passar de 5MM linhas sem
// estourar 1,2GB, mas ainda vale o aviso).
export function estimateCsvStoreRowCount(store) {
  let total = 0;
  for (const csv of Object.values(store || {})) total += (csv && csv.rowCount) || 0;
  return total;
}

// Formata bytes como GB/MB/KB (pt-BR) — usado nos banners H2/H6 e no wizard.
export function formatRamBytes(b) {
  if (b >= (1 << 30)) return (b / (1 << 30)).toFixed(2) + ' GB';
  if (b >= (1 << 20)) return Math.round(b / (1 << 20)) + ' MB';
  return Math.max(1, Math.round(b / (1 << 10))) + ' KB';
}
