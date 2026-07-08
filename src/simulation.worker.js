// Simulation Web Worker — heavy computation off the main thread.
// Receives csvStore once (UPDATE_CSV_STORE) and caches it to avoid
// re-serializing the full dataset on every simulation tick.

// Accessor colunar (Otimização de Memória — Fase 1). Os hot paths abaixo leem
// as células via cellStr/cellNum/rowCount, que funcionam tanto sobre a base
// colunar (produção) quanto sobre o legado string[][] (testes / GATE).
import { cellStr, cellNum, rowCount, isColumnar } from './columnar.js';
import { applyGoalSeekMoves } from './goalSeek.js';
import { applySimplifyCandidates } from './policySimplify.js';

const CINEMINHA_TYPES = {
  eligibility: {
    id: 'eligibility',
    ports: [
      { label: 'Elegível' },
      { label: 'Não Elegível' },
    ],
  },
  offer: {
    id: 'offer',
    ports: [
      { label: 'Com Oferta' },
      { label: 'Sem Oferta' },
    ],
  },
};
const getCinemaType = (cinemaType) => CINEMINHA_TYPES[cinemaType] ?? CINEMINHA_TYPES.eligibility;

function getCellValue(cells, key) {
  const v = (cells ?? {})[key];
  if (v === false) return 0;
  if (v === undefined || v === null || v === true) return 1;
  return typeof v === 'number' ? v : 1;
}

function isCellEligible(cells, key) {
  return getCellValue(cells, key) > 0;
}

function matchLensRule(cellVal, operator, ruleVal) {
  const cv = String(cellVal ?? '').trim();
  const rv = String(ruleVal ?? '').trim();
  const cvN = parseFloat(cv), rvN = parseFloat(rv);
  const numOk = !isNaN(cvN) && !isNaN(rvN);
  switch (operator) {
    case 'equal':    return cv.toLowerCase() === rv.toLowerCase();
    case 'notEqual': return cv.toLowerCase() !== rv.toLowerCase();
    case 'in':       return rv.split(',').map(s => s.trim().toLowerCase()).includes(cv.toLowerCase());
    case 'notIn':    return !rv.split(',').map(s => s.trim().toLowerCase()).includes(cv.toLowerCase());
    case 'lt':       return numOk ? cvN < rvN  : cv < rv;
    case 'lte':      return numOk ? cvN <= rvN : cv <= rv;
    case 'gt':       return numOk ? cvN > rvN  : cv > rv;
    case 'gte':      return numOk ? cvN >= rvN : cv >= rv;
    default: return true;
  }
}

function rowMatchesLensRules(csv, r, rules) {
  if (!rules || rules.length === 0) return true;
  const headers = csv.headers;
  let result = null;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const colIdx = headers.indexOf(rule.col);
    const cellVal = colIdx >= 0 ? (cellStr(csv, r, colIdx) ?? '') : '';
    const matches = matchLensRule(cellVal, rule.operator, rule.value ?? '');
    if (result === null) { result = matches; }
    else if (rule.logic === 'OR') { result = result || matches; }
    else { result = result && matches; }
  }
  return result ?? true;
}

// ── M8 (D2) — Motor "compilado" sobre códigos do dicionário ──────────────────
// A base é colunar com dictionary encoding (Fase 1), mas o roteamento decidia a
// rota de CADA linha re-materializando strings: `(cellStr(...) ?? '').trim()` +
// lookup por rótulo nos losangos, `${rKey}|${cKey}` (concat + hash de string) no
// Cineminha e `matchLensRule` (parseFloat/toLowerCase/split(',')) por linha nos
// lens. Como a decisão depende só do VALOR — e o nº de distintos é pequeno
// (dicionário) — tudo é pré-resolvido UMA vez por nó×csv sobre o dicionário
// (O(distintos)); no loop de linhas resta ler `codes[r]` e seguir inteiros:
//   - decision:  routeByCode[code] → {to, cid} (trim + match de rótulo por distinto);
//   - cineminha: eligByPair[rowCode*nC+colCode] + keyByPair (chave de célula pronta);
//   - lens:      passByCode: Uint8Array por regra (matchLensRule por valor distinto).
// Colunas não dict-encoded (legado `string[][]` dos testes, ou eixo sobre coluna
// métrica) caem no caminho por-linha de antes — MESMA matemática nos dois caminhos.
// GATE de equivalência colunar×legado em tests/compiledEngine.test.js.

// Valores do dicionário com o MESMO trim do caminho por string, uma vez por distinto.
function trimmedDictVals(dict) {
  const out = new Array(dict.length);
  for (let k = 0; k < dict.length; k++) out[k] = String(dict[k] ?? '').trim();
  return out;
}

// Coluna dict de um csv colunar pelo índice do header (null → sem caminho compilado).
function dictColAt(csv, colIdx) {
  if (colIdx < 0 || !isColumnar(csv)) return null;
  const col = csv.columns[csv.headers[colIdx]];
  return col && col.kind === 'dict' ? col : null;
}

// Rotas por nó resolvidas uma vez sobre a topologia (independente de csv) — mesma
// semântica dos `find`s por linha que existiam: decision casa o rótulo TRIMADO com
// first-wins; cineminha casa o rótulo EXATO do port de saída; lens/port seguem a
// primeira aresta. `cid` (id da conexão) é usado só por quem acumula edgeStats.
function compileRoutes(shapes, conns, out) {
  const edgeLookup = {};
  for (const c of conns) {
    if (!edgeLookup[c.from]) edgeLookup[c.from] = {};
    edgeLookup[c.from][`${c.to}::${c.label ?? ''}`] = c.id;
  }
  const decisionRoutes = {}; // nodeId -> Map(label.trim() -> {to, cid})
  const cinemaRoutes   = {}; // nodeId -> {eligible, notEligible}
  const singleEdge     = {}; // nodeId -> {to, cid} | null  (decision_lens / port)
  for (const s of shapes) {
    if (s.type === 'decision') {
      const m = new Map();
      for (const e of (out[s.id] || [])) {
        const label = (e.label ?? '').trim();
        if (!m.has(label)) m.set(label, { to: e.to, cid: edgeLookup[s.id]?.[`${e.to}::${e.label ?? ''}`] });
      }
      decisionRoutes[s.id] = m;
    } else if (s.type === 'cineminha') {
      const typeCfg = getCinemaType(s.cinemaType);
      const findEdge = (label) => {
        const e = (out[s.id] || []).find(x => x.label === label);
        return e ? { to: e.to, cid: edgeLookup[s.id]?.[`${e.to}::${e.label ?? ''}`] } : null;
      };
      cinemaRoutes[s.id] = { eligible: findEdge(typeCfg.ports[0].label), notEligible: findEdge(typeCfg.ports[1].label) };
    } else if (s.type === 'decision_lens' || s.type === 'port') {
      const e = (out[s.id] || [])[0];
      singleEdge[s.id] = e ? { to: e.to, cid: edgeLookup[s.id]?.[`${e.to}::${e.label ?? ''}`] } : null;
    }
  }
  return { decisionRoutes, cinemaRoutes, singleEdge };
}

// decision → { colIdx, codes, valByCode, routeByCode }. `codes === null` ⇒ coluna
// não dict-encoded (ou ausente): o chamador usa o caminho por-linha com `colIdx`.
function compileDecisionNode(node, csv, routeMap) {
  const colIdx = csv.headers.indexOf(node.variableCol);
  const col = dictColAt(csv, colIdx);
  if (!col) return { colIdx, codes: null };
  const n = col.dict.length;
  const valByCode = new Array(n);
  const routeByCode = new Array(n);
  for (let k = 0; k < n; k++) {
    const val = String(col.dict[k] ?? '').trim();
    valByCode[k] = val;
    routeByCode[k] = (routeMap && routeMap.get(val)) || null;
  }
  return { colIdx, codes: col.codes, valByCode, routeByCode };
}

// Teto de pares (|dict linha| × |dict coluna|) para compilar um Cineminha; acima
// disso (eixo de altíssima cardinalidade — patológico) o nó fica no caminho por-linha.
const CINEMA_COMPILE_MAX_PAIRS = 1 << 16;

// cineminha → { mode:'code', none, rowCodes, colCodes, rowVals, colVals, nC,
// eligByPair, keyByPair } ou { mode:'row', rowIdx, colIdx } (caminho por-linha).
// eligByPair/keyByPair são indexados por `rowCode * nC + colCode`; a elegibilidade e a
// chave de célula (`${rKey}|${cKey}`) são resolvidas uma vez por PAR de códigos.
function compileCinemaNode(node, csv) {
  const rowIdx = node.rowVar ? csv.headers.indexOf(node.rowVar.col) : -1;
  const colIdx = node.colVar ? csv.headers.indexOf(node.colVar.col) : -1;
  const fallback = { mode: 'row', rowIdx, colIdx };
  if (!isColumnar(csv)) return fallback;
  if (!node.rowVar && !node.colVar) return { mode: 'code', none: true };

  let rowCodes = null, rowVals = null;
  if (node.rowVar && rowIdx >= 0) {
    const col = dictColAt(csv, rowIdx);
    if (!col) return fallback; // eixo sobre coluna num → caminho por linha
    rowCodes = col.codes;
    rowVals = trimmedDictVals(col.dict);
  }
  let colCodes = null, colVals = null;
  if (node.colVar && colIdx >= 0) {
    const col = dictColAt(csv, colIdx);
    if (!col) return fallback;
    colCodes = col.codes;
    colVals = trimmedDictVals(col.dict);
  }
  const nR = rowVals ? rowVals.length : 1;
  const nC = colVals ? colVals.length : 1;
  if (nR * nC > CINEMA_COMPILE_MAX_PAIRS) return fallback;

  // Mesmas chaves do caminho por string: eixo ausente no nó → '*'; eixo presente
  // mas com coluna ausente na base → '' (rv/cv vazios).
  const rKeyFixed = node.rowVar ? '' : '*';
  const cKeyFixed = node.colVar ? '' : '*';
  const eligByPair = new Uint8Array(nR * nC);
  const keyByPair = new Array(nR * nC);
  for (let i = 0; i < nR; i++) {
    const rKey = rowVals ? rowVals[i] : rKeyFixed;
    for (let j = 0; j < nC; j++) {
      const cKey = colVals ? colVals[j] : cKeyFixed;
      const key = `${rKey}|${cKey}`;
      keyByPair[i * nC + j] = key;
      eligByPair[i * nC + j] = isCellEligible(node.cells, key) ? 1 : 0;
    }
  }
  return { mode: 'code', none: false, rowCodes, colCodes, rowVals, colVals, nC, eligByPair, keyByPair, rowIdx, colIdx };
}

// decision_lens → matcher(r) que replica rowMatchesLensRules regra a regra, mas com
// matchLensRule avaliado UMA vez por valor distinto (passByCode) nas colunas dict.
// Retorna null quando não há regras (passa tudo — mesma semântica da lista vazia).
// Regras sobre coluna ausente viram constante; sobre coluna não-dict (num/legado)
// caem no matchLensRule por-linha de antes.
function compileLensMatcher(csv, rules) {
  if (!rules || rules.length === 0) return null;
  const headers = csv.headers;
  const compiled = new Array(rules.length);
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const colIdx = headers.indexOf(rule.col);
    const ruleVal = rule.value ?? '';
    if (colIdx < 0) {
      compiled[i] = { logic: rule.logic, kind: 'const', match: matchLensRule('', rule.operator, ruleVal) };
      continue;
    }
    const col = dictColAt(csv, colIdx);
    if (col) {
      const passByCode = new Uint8Array(col.dict.length);
      for (let k = 0; k < col.dict.length; k++) {
        passByCode[k] = matchLensRule(col.dict[k] ?? '', rule.operator, ruleVal) ? 1 : 0;
      }
      compiled[i] = { logic: rule.logic, kind: 'code', codes: col.codes, passByCode };
    } else {
      compiled[i] = { logic: rule.logic, kind: 'row', colIdx, operator: rule.operator, value: ruleVal };
    }
  }
  return (r) => {
    let result = null;
    for (let i = 0; i < compiled.length; i++) {
      const e = compiled[i];
      const matches = e.kind === 'code' ? e.passByCode[e.codes[r]] === 1
        : e.kind === 'const' ? e.match
        : matchLensRule(cellStr(csv, r, e.colIdx) ?? '', e.operator, e.value);
      if (result === null) { result = matches; }
      else if (e.logic === 'OR') { result = result || matches; }
      else { result = result && matches; }
    }
    return result ?? true;
  };
}

// Compila todos os nós roteáveis de um canvas para um csv (O(distintos) por nó).
function compileNodesForCsv(shapes, csv, routes) {
  const decision = {}, cinema = {}, lens = {};
  for (const s of shapes) {
    if (s.type === 'decision') decision[s.id] = compileDecisionNode(s, csv, routes.decisionRoutes[s.id]);
    else if (s.type === 'cineminha') cinema[s.id] = compileCinemaNode(s, csv);
    else if (s.type === 'decision_lens') lens[s.id] = compileLensMatcher(csv, s.rules || []);
  }
  return { decision, cinema, lens };
}

// ── Lens populations (M10) — derivadas no worker, tipadas e memoizadas ────────
// Antes eram computadas na main thread (varredura de ~1MM linhas × regras por lens,
// travando a UI) e clonadas pro worker como Array<boolean> por lens×csv a cada
// COMPUTE_OVERLAY (structured clone elemento a elemento). Agora o worker as deriva de
// `shape.rules` (já embutidas nos `shapes` que ele recebe), como Uint8Array (1 byte/linha
// em vez de um boolean boxed), e a main só recebe as contagens {[lensId]: {count, total}}
// (ponderadas pelo volume) para o rótulo do nó decision_lens.
function lensRulesKeyOf(shapes) {
  return JSON.stringify(
    shapes.filter(s => s.type === 'decision_lens').map(s => ({ id: s.id, rules: s.rules || [] }))
  );
}

// {populations: {[lensId]: {[csvId]: Uint8Array}}, counts: {[lensId]: {count, total}}}
// `populations[lensId][csvId][r] === 1` ⇔ a linha r casa as regras do lens.
function computeLensPopulations(shapes, csvStore) {
  const populations = {};
  const counts = {};
  const lenses = shapes.filter(s => s.type === 'decision_lens');
  for (const lens of lenses) {
    const rules = lens.rules || [];
    const perCsv = {};
    let count = 0, total = 0;
    for (const [csvId, csv] of Object.entries(csvStore)) {
      const n = rowCount(csv);
      const arr = new Uint8Array(n);
      const types = csv.columnTypes || {};
      const qtyCol = Object.entries(types).find(([, t]) => t === 'qty')?.[0];
      const qtyIdx = qtyCol ? csv.headers.indexOf(qtyCol) : -1;
      // (M8) regras avaliadas uma vez por valor distinto do dicionário (passByCode);
      // matcher null = sem regras = passa tudo (mesma semântica de rowMatchesLensRules).
      const matcher = compileLensMatcher(csv, rules);
      for (let r = 0; r < n; r++) {
        const qty = qtyIdx >= 0 ? (cellNum(csv, r, qtyIdx) || 1) : 1;
        total += qty;
        if (!matcher || matcher(r)) { arr[r] = 1; count += qty; }
      }
      perCsv[csvId] = arr;
    }
    populations[lens.id] = perCsv;
    counts[lens.id] = { count, total };
  }
  return { populations, counts };
}

// Cache single-slot pro caminho do COMPUTE_OVERLAY (canvas ativo): as regras dos lens não
// mudam durante um drag (só x/y), então isso evita re-varrer a base a cada tick debounced.
// Invalidado por csvStoreVersion (nova base) ou por mudança de regras (lensRulesKeyOf).
let lensPopCache = { key: null, value: null };
function getLensPopulations(shapes, csvStore) {
  const key = csvStoreVersion + '|' + lensRulesKeyOf(shapes);
  if (lensPopCache.key === key) return lensPopCache.value;
  const value = computeLensPopulations(shapes, csvStore);
  lensPopCache = { key, value };
  return value;
}

function buildFlowGraph(shapes, conns) {
  const out = {}, inc = {};
  for (const s of shapes) { out[s.id] = []; inc[s.id] = []; }
  for (const c of conns) {
    if (out[c.from]) out[c.from].push({ to: c.to, label: c.label ?? '' });
    if (inc[c.to])   inc[c.to].push({ from: c.from, label: c.label ?? '' });
  }
  return { out, inc };
}

function runSimulation(shapes, conns, csvStore) {
  const { out } = buildFlowGraph(shapes, conns);
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const TERM = new Set(['approved', 'rejected', 'as_is']);
  const portIds = new Set(shapes.filter(s => s.type === 'port').map(s => s.id));
  const decWithPortInc = new Set(conns.filter(c => portIds.has(c.from)).map(c => c.to));
  const rootNodes = shapes.filter(s =>
    (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') && !decWithPortInc.has(s.id)
  );
  if (rootNodes.length === 0) return { totalQty: 0, approvedQty: 0, rejectedQty: 0, asIsQty: 0, approvalRate: 0, inadReal: null, inadInferida: null, edgeStats: {} };

  const edgeLookup = {};
  for (const c of conns) {
    if (!edgeLookup[c.from]) edgeLookup[c.from] = {};
    edgeLookup[c.from][`${c.to}::${c.label ?? ''}`] = c.id;
  }

  const edgeAcc = {};
  const initEdge = (cid) => {
    if (!edgeAcc[cid]) edgeAcc[cid] = { qty: 0, approvedQty: 0, rejectedQty: 0, asIsQty: 0, inadRealSum: 0, inadInferidaSum: 0, qtdAltasSum: 0, qtdAltasInferSum: 0 };
  };

  function traverseRow(csv, r, startId) {
    const headers = csv.headers;
    let cur = startId; const visited = new Set(); const path = [];
    while (cur) {
      if (visited.has(cur)) return { result: null, path };
      visited.add(cur);
      const node = shapesMap[cur]; if (!node) return { result: null, path };
      if (TERM.has(node.type)) return { result: node.type, path };
      if (node.type === 'decision') {
        const colIdx = headers.indexOf(node.variableCol);
        const val = (colIdx >= 0 ? (cellStr(csv, r, colIdx) ?? '') : '').trim();
        const match = (out[cur] || []).find(e => (e.label ?? '').trim() === val);
        if (!match) return { result: null, path };
        const cid = edgeLookup[cur]?.[`${match.to}::${match.label ?? ''}`];
        if (cid) path.push(cid);
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const rowIdx = node.rowVar ? headers.indexOf(node.rowVar.col) : -1;
        const colIdx = node.colVar ? headers.indexOf(node.colVar.col) : -1;
        const rowVal = node.rowVar && rowIdx >= 0 ? (cellStr(csv, r, rowIdx) ?? '').trim() : '';
        const colVal = node.colVar && colIdx >= 0 ? (cellStr(csv, r, colIdx) ?? '').trim() : '';
        if (!node.rowVar && !node.colVar) return { result: null, path };
        const rKey = node.rowVar ? rowVal : '*';
        const cKey = node.colVar ? colVal : '*';
        const cellKey = `${rKey}|${cKey}`;
        const isEligible = isCellEligible(node.cells, cellKey);
        const typeCfg = getCinemaType(node.cinemaType);
        const targetLabel = isEligible ? typeCfg.ports[0].label : typeCfg.ports[1].label;
        const match = (out[cur] || []).find(e => e.label === targetLabel);
        if (!match) return { result: null, path };
        const cid = edgeLookup[cur]?.[`${match.to}::${match.label ?? ''}`];
        if (cid) path.push(cid);
        cur = match.to;
      } else if (node.type === 'decision_lens') {
        const rules = node.rules || [];
        const passes = rowMatchesLensRules(csv, r, rules);
        if (!passes) return { result: null, path };
        const edges = out[cur] || []; if (edges.length === 0) return { result: null, path };
        const match = edges[0];
        const cid = edgeLookup[cur]?.[`${match.to}::${match.label ?? ''}`];
        if (cid) path.push(cid);
        cur = match.to;
      } else if (node.type === 'port') {
        const edges = out[cur] || []; if (edges.length === 0) return { result: null, path };
        const match = edges[0];
        const cid = edgeLookup[cur]?.[`${match.to}::${match.label ?? ''}`];
        if (cid) path.push(cid);
        cur = match.to;
      } else return { result: null, path };
    }
    return { result: null, path };
  }

  let totalQty = 0, approvedQty = 0, rejectedQty = 0, asIsQty = 0;
  let inadRealSum = 0, qtdAltasSum = 0, inadInferidaSum = 0, qtdAltasInferSum = 0;

  for (const [csvId, csv] of Object.entries(csvStore)) {
    const types = csv.columnTypes || {};
    const colIdx = (type) => {
      const col = Object.entries(types).find(([, t]) => t === type)?.[0];
      return col ? csv.headers.indexOf(col) : -1;
    };
    const qtyIdx           = colIdx('qty');
    const qtdAltasIdx      = colIdx('qtdAltas');
    const qtdAltasInferIdx = colIdx('qtdAltasInfer');
    const inadRealIdx      = colIdx('inadReal');
    const inadInferidaIdx  = colIdx('inadInferida');
    const dOrigIdx         = csv.headers.indexOf('__DECISAO_ORIGINAL');
    const csvRoots = rootNodes.filter(d => {
      if (d.type === 'decision') return d.csvId === csvId;
      if (d.type === 'cineminha') return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      if (d.type === 'decision_lens') return true;
      return false;
    });
    if (csvRoots.length === 0) continue;
    const rootId = csvRoots[0].id;

    const nRows = rowCount(csv);
    for (let r = 0; r < nRows; r++) {
      const qty          = qtyIdx          >= 0 ? (cellNum(csv, r, qtyIdx)          || 0) : 1;
      const qtdAltas     = qtdAltasIdx     >= 0 ? (cellNum(csv, r, qtdAltasIdx)     || 0) : 0;
      const inadR        = inadRealIdx     >= 0 ? (cellNum(csv, r, inadRealIdx)     || 0) : 0;
      const qtdAltasInfer = qtdAltasInferIdx >= 0 ? (cellNum(csv, r, qtdAltasInferIdx) || 0) : 0;
      const inadI         = inadInferidaIdx  >= 0 ? (cellNum(csv, r, inadInferidaIdx)  || 0) : 0;
      totalQty += qty;
      const { result: res, path } = traverseRow(csv, r, rootId);
      let isApproved = res === 'approved', isRejected = res === 'rejected';
      if (res === 'as_is') {
        const origDecision = dOrigIdx >= 0 ? String(cellStr(csv, r, dOrigIdx) ?? '').toUpperCase() : '';
        if (origDecision === 'APROVADO') isApproved = true;
        else if (origDecision === 'REPROVADO') isRejected = true;
        else asIsQty += qty;
      }
      if (isApproved) {
        approvedQty      += qty;
        qtdAltasSum      += qtdAltas;
        qtdAltasInferSum += qtdAltasInfer;
        inadRealSum      += inadR;
        inadInferidaSum  += inadI;
      } else if (isRejected) rejectedQty += qty;

      for (const cid of path) {
        initEdge(cid);
        edgeAcc[cid].qty += qty;
        if (isApproved) {
          edgeAcc[cid].approvedQty      += qty;
          edgeAcc[cid].qtdAltasSum      += qtdAltas;
          edgeAcc[cid].qtdAltasInferSum += qtdAltasInfer;
          edgeAcc[cid].inadRealSum      += inadR;
          edgeAcc[cid].inadInferidaSum  += inadI;
        } else if (isRejected) {
          edgeAcc[cid].rejectedQty += qty;
        } else if (res === 'as_is') {
          edgeAcc[cid].asIsQty += qty;
        }
      }
    }
  }

  const inadReal     = qtdAltasSum > 0 ? inadRealSum / qtdAltasSum : null;
  const inadInferida = qtdAltasInferSum > 0 ? inadInferidaSum / qtdAltasInferSum
                     : approvedQty      > 0 ? inadInferidaSum / approvedQty : null;

  const edgeStats = {};
  for (const [cid, acc] of Object.entries(edgeAcc)) {
    edgeStats[cid] = {
      qty: acc.qty,
      approvedQty: acc.approvedQty,
      rejectedQty: acc.rejectedQty,
      asIsQty: acc.asIsQty,
      qtdAltas: acc.qtdAltasSum,
      approvalRate: acc.qty > 0 ? acc.approvedQty / acc.qty : null,
      inadReal: acc.qtdAltasSum > 0 ? acc.inadRealSum / acc.qtdAltasSum : null,
      inadInferida: acc.qtdAltasInferSum > 0 ? acc.inadInferidaSum / acc.qtdAltasInferSum
                  : acc.approvedQty      > 0 ? acc.inadInferidaSum / acc.approvedQty : null,
    };
  }

  return {
    totalQty, approvedQty, rejectedQty, asIsQty,
    approvalRate: totalQty > 0 ? (approvedQty / totalQty) * 100 : 0,
    inadReal, inadInferida,
    edgeStats,
  };
}

// Overlay tipado (Otimização de Performance M2) — códigos da decisão SIMULADA por linha.
// Em vez de 1 objeto de 4 campos por linha (~120MB/1MM linhas, retido no cache do Dashboard
// por canvas), o overlay é um Int8Array de 1 byte/linha (~1MB/1MM). A decisão ORIGINAL já
// vive na coluna dict __DECISAO_ORIGINAL, então os consumidores a releem de lá; o "impactado"
// é derivado comparando simulada vs. original no ponto de consumo.
//   DEC_SAME (0)     → decisão simulada == original (não roteou, as_is, imutável ou sem raiz);
//                      o decode devolve a própria string original — cobre '', 'IGNORAR', etc.,
//                      sem hardcode e sem perda.
//   DEC_APROVADO (1) → roteou para terminal 'approved'.
//   DEC_REPROVADO(2) → roteou para terminal 'rejected'.
// Int8Array já zera (DEC_SAME por default): só gravamos 1/2 quando a linha muda de decisão.
const DEC_SAME = 0, DEC_APROVADO = 1, DEC_REPROVADO = 2;
function decodeSimDecision(code, origStr) {
  return code === DEC_APROVADO ? 'APROVADO' : code === DEC_REPROVADO ? 'REPROVADO' : origStr;
}

function computeSimulatedDecisions(shapes, conns, csvStore, lensPopulations) {
  const hasLens = lensPopulations && Object.keys(lensPopulations).length > 0;
  const hasAsIs = Object.values(csvStore).some(csv => csv.headers.indexOf('__DECISAO_ORIGINAL') >= 0);
  if (!hasLens && !hasAsIs) return null;

  const { out } = buildFlowGraph(shapes, conns);
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const TERM = new Set(['approved', 'rejected']);
  const portIds = new Set(shapes.filter(s => s.type === 'port').map(s => s.id));
  const decWithPortInc = new Set(conns.filter(c => portIds.has(c.from)).map(c => c.to));
  const rootNodes = shapes.filter(s =>
    (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') && !decWithPortInc.has(s.id)
  );

  // (M8) rotas resolvidas uma vez sobre a topologia + nós compilados por csv: o
  // traverseRow deixa de tocar strings nas colunas dict — lê codes[r] e segue rotas.
  // "visited" por época em vez de `new Set()` por linha (mesma técnica do M6).
  const routes = compileRoutes(shapes, conns, out);
  const { decisionRoutes, cinemaRoutes, singleEdge } = routes;
  const nodeIdx = new Map(shapes.map((s, i) => [s.id, i]));
  const lastVisit = new Int32Array(shapes.length);
  let epoch = 0;

  function traverseRow(csv, r, startId, compiled) {
    epoch++;
    let cur = startId;
    while (cur) {
      const idx = nodeIdx.get(cur);
      if (idx === undefined || lastVisit[idx] === epoch) return null;
      lastVisit[idx] = epoch;
      const node = shapesMap[cur]; if (!node) return null;
      if (TERM.has(node.type)) return node.type;
      if (node.type === 'decision') {
        const cd = compiled.decision[cur];
        let match;
        if (cd.codes) match = cd.routeByCode[cd.codes[r]];
        else {
          const val = (cd.colIdx >= 0 ? (cellStr(csv, r, cd.colIdx) ?? '') : '').trim();
          match = decisionRoutes[cur]?.get(val);
        }
        if (!match) return null;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const cc = compiled.cinema[cur];
        let isEligible;
        if (cc.mode === 'code') {
          if (cc.none) return null;
          const ri = cc.rowCodes ? cc.rowCodes[r] : 0;
          const ci = cc.colCodes ? cc.colCodes[r] : 0;
          isEligible = cc.eligByPair[ri * cc.nC + ci] === 1;
        } else {
          const rowVal = node.rowVar && cc.rowIdx >= 0 ? (cellStr(csv, r, cc.rowIdx) ?? '').trim() : '';
          const colVal = node.colVar && cc.colIdx >= 0 ? (cellStr(csv, r, cc.colIdx) ?? '').trim() : '';
          if (!node.rowVar && !node.colVar) return null;
          const rKey = node.rowVar ? rowVal : '*';
          const cKey = node.colVar ? colVal : '*';
          isEligible = isCellEligible(node.cells, `${rKey}|${cKey}`);
        }
        const rt = cinemaRoutes[cur];
        const match = isEligible ? rt?.eligible : rt?.notEligible;
        if (!match) return null;
        cur = match.to;
      } else if (node.type === 'decision_lens') {
        const m = compiled.lens[cur];
        if (m && !m(r)) return null;
        const match = singleEdge[cur];
        if (!match) return null;
        cur = match.to;
      } else if (node.type === 'port') {
        const match = singleEdge[cur];
        if (!match) return null;
        cur = match.to;
      } else return null;
    }
    return null;
  }

  const overlay = {};
  let hasAnyDecisaoCol = false;

  for (const [csvId, csv] of Object.entries(csvStore)) {
    const dOrigIdx = csv.headers.indexOf('__DECISAO_ORIGINAL');
    if (dOrigIdx < 0) continue;
    hasAnyDecisaoCol = true;

    const csvRoots = rootNodes.filter(d => {
      if (d.type === 'decision') return d.csvId === csvId;
      if (d.type === 'cineminha') return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      if (d.type === 'decision_lens') return true;
      return false;
    });

    const nRows = rowCount(csv);
    const sim = new Int8Array(nRows); // DEC_SAME (0) por default — só mudamos linhas roteadas
    if (csvRoots.length > 0) {
      const compiled = compileNodesForCsv(shapes, csv, routes);
      const rootId = csvRoots[0].id;
      // Populações de lens deste csv resolvidas UMA vez — não Object.values(...).some
      // (alocação + closure) por linha.
      const csvLensPops = hasLens
        ? Object.values(lensPopulations).map(pop => pop[csvId]).filter(Boolean)
        : null;
      for (let rowIdx = 0; rowIdx < nRows; rowIdx++) {
        let isMutable = !hasLens;
        if (!isMutable) {
          for (let i = 0; i < csvLensPops.length; i++) {
            if (csvLensPops[i][rowIdx] === 1) { isMutable = true; break; }
          }
        }
        if (!isMutable) continue; // mantém original (DEC_SAME)

        const boardResult = traverseRow(csv, rowIdx, rootId, compiled);
        if (boardResult === 'approved') sim[rowIdx] = DEC_APROVADO;
        else if (boardResult === 'rejected') sim[rowIdx] = DEC_REPROVADO;
        // 'as_is' ou null (não roteou) → mantém a decisão original (DEC_SAME, já é 0)
      }
    }

    overlay[csvId] = { sim };
  }

  return hasAnyDecisaoCol ? overlay : null;
}

function computeIncrementalResult(overlay, csvStore) {
  if (!overlay) return null;

  const bl  = { approvedQty: 0, rejectedQty: 0, totalQty: 0, qtdAltasSum: 0, qtdAltasInferSum: 0, inadRRaw: 0, inadIRaw: 0 };
  const sim = { approvedQty: 0, rejectedQty: 0, totalQty: 0, qtdAltasSum: 0, qtdAltasInferSum: 0, inadRRaw: 0, inadIRaw: 0 };
  const imp = { qty: 0, rToA: 0, aToR: 0, qtdAltasSimSum: 0, inadRSimRaw: 0, inadISimRaw: 0, altasInferRtoA: 0, altasRealAtoR: 0 };

  for (const [csvId, { sim: simCodes }] of Object.entries(overlay)) {
    const csv = csvStore[csvId];
    if (!csv) continue;
    const types = csv.columnTypes || {};
    const getIdx = (type) => {
      const col = Object.entries(types).find(([, t]) => t === type)?.[0];
      return col != null ? csv.headers.indexOf(col) : -1;
    };
    const qtyIdx        = getIdx('qty');
    const altasIdx      = getIdx('qtdAltas');
    const altasInferIdx = getIdx('qtdAltasInfer');
    const inadRIdx      = getIdx('inadReal');
    const inadIIdx      = getIdx('inadInferida');
    const dOrigIdx      = csv.headers.indexOf('__DECISAO_ORIGINAL');

    const nRows = Math.min(simCodes.length, rowCount(csv));
    for (let ri = 0; ri < nRows; ri++) {
      // Decisão original vem da coluna dict (o overlay tipado guarda só a simulada);
      // decodeSimDecision devolve a própria original quando a linha não mudou (DEC_SAME).
      const decisaoOriginal = dOrigIdx >= 0 ? (cellStr(csv, ri, dOrigIdx) ?? '') : '';
      const decisaoSimulada = decodeSimDecision(simCodes[ri], decisaoOriginal);
      const flagImpactado   = decisaoOriginal !== '' && decisaoSimulada !== decisaoOriginal;
      const qty        = qtyIdx       >= 0 ? (cellNum(csv, ri, qtyIdx)       || 1) : 1;
      const altas      = altasIdx     >= 0 ? (cellNum(csv, ri, altasIdx)     || 0) : 0;
      const inadR      = inadRIdx     >= 0 ? (cellNum(csv, ri, inadRIdx)     || 0) : 0;
      const altasInfer = altasInferIdx >= 0 ? (cellNum(csv, ri, altasInferIdx) || 0) : 0;
      const inadI      = inadIIdx      >= 0 ? (cellNum(csv, ri, inadIIdx)      || 0) : 0;

      bl.totalQty += qty;
      if (decisaoOriginal === 'APROVADO') {
        bl.approvedQty += qty; bl.qtdAltasSum += altas; bl.qtdAltasInferSum += altasInfer; bl.inadRRaw += inadR; bl.inadIRaw += inadI;
      } else if (decisaoOriginal === 'REPROVADO') {
        bl.rejectedQty += qty;
      }

      sim.totalQty += qty;
      if (decisaoSimulada === 'APROVADO') {
        sim.approvedQty += qty; sim.qtdAltasSum += altas; sim.qtdAltasInferSum += altasInfer; sim.inadRRaw += inadR; sim.inadIRaw += inadI;
      } else if (decisaoSimulada === 'REPROVADO') {
        sim.rejectedQty += qty;
      }

      if (flagImpactado) {
        imp.qty += qty;
        if (decisaoOriginal === 'REPROVADO' && decisaoSimulada === 'APROVADO') {
          imp.rToA += qty; imp.qtdAltasSimSum += altas; imp.inadRSimRaw += inadR; imp.inadISimRaw += inadI;
          imp.altasInferRtoA += altasInfer;
        } else if (decisaoOriginal === 'APROVADO' && decisaoSimulada === 'REPROVADO') {
          imp.aToR += qty;
          imp.altasRealAtoR += altas;
        }
      }
    }
  }

  const blRate  = bl.totalQty  > 0 ? (bl.approvedQty  / bl.totalQty)  * 100 : 0;
  const simRate = sim.totalQty > 0 ? (sim.approvedQty / sim.totalQty) * 100 : 0;
  return {
    baseline: {
      approvedQty: bl.approvedQty, rejectedQty: bl.rejectedQty, totalQty: bl.totalQty,
      approvalRate: blRate,
      inadReal:     bl.qtdAltasSum      > 0 ? bl.inadRRaw / bl.qtdAltasSum      : null,
      inadInferida: bl.qtdAltasInferSum > 0 ? bl.inadIRaw / bl.qtdAltasInferSum
                  : bl.approvedQty      > 0 ? bl.inadIRaw / bl.approvedQty      : null,
    },
    simulated: {
      approvedQty: sim.approvedQty, rejectedQty: sim.rejectedQty, totalQty: sim.totalQty,
      approvalRate: simRate,
      inadReal:     sim.qtdAltasSum      > 0 ? sim.inadRRaw / sim.qtdAltasSum      : null,
      inadInferida: sim.qtdAltasInferSum > 0 ? sim.inadIRaw / sim.qtdAltasInferSum
                  : sim.approvedQty      > 0 ? sim.inadIRaw / sim.approvedQty      : null,
    },
    impacted: {
      qty: imp.qty, totalQty: bl.totalQty,
      pct: bl.totalQty > 0 ? (imp.qty / bl.totalQty) * 100 : 0,
      rToA: imp.rToA, aToR: imp.aToR,
      approvalDelta: simRate - blRate,
      altasInferRtoA: imp.altasInferRtoA,
      altasRealAtoR: imp.altasRealAtoR,
    },
  };
}

function computeCellMetrics(shape, csvStore) {
  if (!shape || shape.type !== 'cineminha') return {};
  const { rowVar, colVar, rowDomain, colDomain } = shape;
  const csvId = rowVar?.csvId || colVar?.csvId;
  if (!csvId) return {};
  const csv = csvStore[csvId];
  if (!csv) return {};
  const types = csv.columnTypes || {};
  const getIdx = (type) => {
    const col = Object.entries(types).find(([, t]) => t === type)?.[0];
    return col != null ? csv.headers.indexOf(col) : -1;
  };
  const rowCI = rowVar ? csv.headers.indexOf(rowVar.col) : -1;
  const colCI = colVar ? csv.headers.indexOf(colVar.col) : -1;
  const qtyI = getIdx('qty'), altasI = getIdx('qtdAltas'), altasInferI = getIdx('qtdAltasInfer');
  const inadRI = getIdx('inadReal'), inadII = getIdx('inadInferida');
  const rDom = rowDomain?.length > 0 ? rowDomain : ['*'];
  const cDom = colDomain?.length > 0 ? colDomain : ['*'];
  const acc = {};
  for (const rv of rDom)
    for (const cv of cDom)
      acc[`${rv}|${cv}`] = { qty: 0, qtdAltas: 0, qtdAltasInfer: 0, inadRRaw: 0, inadIRaw: 0 };
  const nRows = rowCount(csv);
  for (let r = 0; r < nRows; r++) {
    const rv = rowVar && rowCI >= 0 ? (cellStr(csv, r, rowCI) ?? '').toString().trim() : '*';
    const cv = colVar && colCI >= 0 ? (cellStr(csv, r, colCI) ?? '').toString().trim() : '*';
    const key = `${rv}|${cv}`;
    if (!acc[key]) continue;
    const qty        = qtyI       >= 0 ? (cellNum(csv, r, qtyI)       || 0) : 1;
    const altas      = altasI     >= 0 ? (cellNum(csv, r, altasI)     || 0) : 0;
    const inadR      = inadRI     >= 0 ? (cellNum(csv, r, inadRI)     || 0) : 0;
    const altasInfer = altasInferI >= 0 ? (cellNum(csv, r, altasInferI) || 0) : 0;
    const inadI      = inadII      >= 0 ? (cellNum(csv, r, inadII)      || 0) : 0;
    acc[key].qty          += qty;
    acc[key].qtdAltas     += altas;
    acc[key].qtdAltasInfer+= altasInfer;
    acc[key].inadRRaw     += inadR;
    acc[key].inadIRaw     += inadI;
  }
  const result = {};
  for (const [key, m] of Object.entries(acc)) {
    result[key] = {
      qty: m.qty, qtdAltas: m.qtdAltas, qtdAltasInfer: m.qtdAltasInfer,
      inadRRaw: m.inadRRaw, inadIRaw: m.inadIRaw,
      inadReal:     m.qtdAltas      > 0 ? m.inadRRaw / m.qtdAltas      : null,
      inadInferida: m.qtdAltasInfer > 0 ? m.inadIRaw / m.qtdAltasInfer
                  : m.qty           > 0 ? m.inadIRaw / m.qty            : null,
    };
  }
  return result;
}

function buildParetoFrontier(cellMetrics) {
  const cells = Object.entries(cellMetrics)
    .map(([key, m]) => ({ key, ...m }))
    .filter(c => c.qty > 0);
  const totalQty = cells.reduce((s, c) => s + c.qty, 0);
  if (totalQty === 0) return [];
  cells.sort((a, b) => {
    const ai = a.inadInferida ?? Infinity, bi = b.inadInferida ?? Infinity;
    return ai !== bi ? ai - bi : b.qty - a.qty;
  });
  const frontier = [{ cells: {}, approvalRate: 0, inadReal: null, inadInferida: null, totalQty, approvedQty: 0 }];
  let approvedQty = 0, altasSum = 0, inadRSum = 0, inadISum = 0;
  const approved = {};
  for (const c of cells) {
    approvedQty += c.qty; altasSum += c.qtdAltas;
    inadRSum += c.inadRRaw; inadISum += c.inadIRaw;
    approved[c.key] = 1;
    frontier.push({
      cells: { ...approved },
      approvalRate: approvedQty / totalQty,
      inadReal:     altasSum    > 0 ? inadRSum / altasSum    : null,
      inadInferida: approvedQty > 0 ? inadISum / approvedQty : null,
      totalQty, approvedQty,
    });
  }
  return frontier;
}

function extractScenarios(frontier) {
  const pts = frontier.filter(p => p.approvalRate > 0);
  if (pts.length === 0) return { conservador: null, balanceado: null, melhorEficiencia: null, expansao: null };
  const conservador = pts[0];
  const expansao    = pts[pts.length - 1];
  let melhorEficiencia = pts[Math.floor(pts.length / 2)];
  if (pts.length >= 3) {
    const x0 = conservador.approvalRate, y0 = conservador.inadInferida ?? 0;
    const x1 = expansao.approvalRate,    y1 = expansao.inadInferida    ?? 0;
    const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx * dx + dy * dy);
    let maxD = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const px = pts[i].approvalRate, py = pts[i].inadInferida ?? 0;
      const d = len > 0
        ? Math.abs(dy * px - dx * py + x1 * y0 - y1 * x0) / len
        : Math.abs(px - x0) + Math.abs(py - y0);
      if (d > maxD) { maxD = d; melhorEficiencia = pts[i]; }
    }
  }
  const efIdx = pts.indexOf(melhorEficiencia);
  const balanceado = pts[Math.max(0, Math.floor(efIdx / 2))];
  return { conservador, balanceado, melhorEficiencia, expansao };
}

// ── Johnny optimizer ─────────────────────────────────────────────────────────

// Traverses the flow graph and collects, per cineminha, the metrics of rows
// that actually arrive at each cell via routing (respecting upstream decisions,
// ports and decision_lens nodes). Designed to be reused by Session C.
// Returns: { [shapeId]: { [cellKey]: {qty, qtdAltas, qtdAltasInfer, inadRRaw, inadIRaw, mix} } }
function computeCinemaArrivals(shapes, conns, csvStore, lensPopulations) {
  const { out } = buildFlowGraph(shapes, conns);
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const TERM = new Set(['approved', 'rejected', 'as_is']);
  const portIds = new Set(shapes.filter(s => s.type === 'port').map(s => s.id));
  const decWithPortInc = new Set(conns.filter(c => portIds.has(c.from)).map(c => c.to));
  const rootNodes = shapes.filter(s =>
    (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') && !decWithPortInc.has(s.id)
  );

  const arrivals = {};
  for (const s of shapes) {
    if (s.type === 'cineminha') arrivals[s.id] = {};
  }

  // (M8) rotas compiladas + "visited" por época + buffers de hit reutilizados entre
  // linhas (o walk é síncrono e single-thread) — sem `new Set()`/array por linha.
  const routes = compileRoutes(shapes, conns, out);
  const { decisionRoutes, cinemaRoutes, singleEdge } = routes;
  const nodeIdx = new Map(shapes.map((s, i) => [s.id, i]));
  const lastVisit = new Int32Array(shapes.length);
  let epoch = 0;
  const hitShapeBuf = [], hitKeyBuf = [];

  function collectCinemaHits(csv, r, startId, compiled) {
    epoch++;
    let cur = startId;
    let hitLen = 0;
    while (cur) {
      const idx = nodeIdx.get(cur);
      if (idx === undefined || lastVisit[idx] === epoch) break;
      lastVisit[idx] = epoch;
      const node = shapesMap[cur];
      if (!node) break;
      if (TERM.has(node.type)) break;
      if (node.type === 'decision') {
        const cd = compiled.decision[cur];
        let match;
        if (cd.codes) match = cd.routeByCode[cd.codes[r]];
        else {
          const val = (cd.colIdx >= 0 ? (cellStr(csv, r, cd.colIdx) ?? '') : '').trim();
          match = decisionRoutes[cur]?.get(val);
        }
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const cc = compiled.cinema[cur];
        let cellKey, isEligible;
        if (cc.mode === 'code') {
          if (cc.none) break;
          const ri = cc.rowCodes ? cc.rowCodes[r] : 0;
          const ci = cc.colCodes ? cc.colCodes[r] : 0;
          const p = ri * cc.nC + ci;
          cellKey = cc.keyByPair[p];
          isEligible = cc.eligByPair[p] === 1;
        } else {
          const rv = node.rowVar && cc.rowIdx >= 0 ? (cellStr(csv, r, cc.rowIdx) ?? '').trim() : '';
          const cv = node.colVar && cc.colIdx >= 0 ? (cellStr(csv, r, cc.colIdx) ?? '').trim() : '';
          if (!node.rowVar && !node.colVar) break;
          const rKey = node.rowVar ? rv : '*';
          const cKey = node.colVar ? cv : '*';
          cellKey = `${rKey}|${cKey}`;
          isEligible = isCellEligible(node.cells, cellKey);
        }
        if (arrivals[node.id] !== undefined) { hitShapeBuf[hitLen] = node.id; hitKeyBuf[hitLen] = cellKey; hitLen++; }
        const rt = cinemaRoutes[cur];
        const match = isEligible ? rt?.eligible : rt?.notEligible;
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'decision_lens') {
        const m = compiled.lens[cur];
        if (m && !m(r)) break;
        const match = singleEdge[cur];
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'port') {
        const match = singleEdge[cur];
        if (!match) break;
        cur = match.to;
      } else break;
    }
    return hitLen;
  }

  for (const [csvId, csv] of Object.entries(csvStore)) {
    const types = csv.columnTypes || {};
    const getColIdx = (type) => {
      const col = Object.entries(types).find(([, t]) => t === type)?.[0];
      return col ? csv.headers.indexOf(col) : -1;
    };
    const qtyIdx      = getColIdx('qty');
    const altasIdx    = getColIdx('qtdAltas');
    const altasInfIdx = getColIdx('qtdAltasInfer');
    const inadRIdx    = getColIdx('inadReal');
    const inadIIdx    = getColIdx('inadInferida');
    const mixIdx      = getColIdx('mixRisco');

    const csvRoots = rootNodes.filter(d => {
      if (d.type === 'decision')      return d.csvId === csvId;
      if (d.type === 'cineminha')     return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      if (d.type === 'decision_lens') return true;
      return false;
    });
    if (csvRoots.length === 0) continue;
    const rootId = csvRoots[0].id;
    const compiled = compileNodesForCsv(shapes, csv, routes); // (M8) uma vez por csv

    // (M8) valores de mixRisco por código (trim por distinto, não por linha).
    const mixDictCol = mixIdx >= 0 ? dictColAt(csv, mixIdx) : null;
    const mixVals = mixDictCol ? trimmedDictVals(mixDictCol.dict) : null;

    const nRows = rowCount(csv);
    for (let r = 0; r < nRows; r++) {
      const hitLen = collectCinemaHits(csv, r, rootId, compiled);
      if (hitLen === 0) continue; // linha não chega a nenhum cineminha — não lê métricas

      const qty      = qtyIdx      >= 0 ? (cellNum(csv, r, qtyIdx)      || 0) : 1;
      const altas    = altasIdx    >= 0 ? (cellNum(csv, r, altasIdx)    || 0) : 0;
      const inadR    = inadRIdx    >= 0 ? (cellNum(csv, r, inadRIdx)    || 0) : 0;
      const altasInf = altasInfIdx >= 0 ? (cellNum(csv, r, altasInfIdx) || 0) : 0;
      const inadI    = inadIIdx    >= 0 ? (cellNum(csv, r, inadIIdx)    || 0) : 0;
      const mixVal = mixVals ? mixVals[mixDictCol.codes[r]]
        : mixIdx >= 0 ? (cellStr(csv, r, mixIdx) ?? '').toString().trim() : '';

      for (let h = 0; h < hitLen; h++) {
        const acc = arrivals[hitShapeBuf[h]];
        if (!acc) continue;
        const cellKey = hitKeyBuf[h];
        if (!acc[cellKey]) acc[cellKey] = { qty: 0, qtdAltas: 0, qtdAltasInfer: 0, inadRRaw: 0, inadIRaw: 0, mix: {} };
        acc[cellKey].qty           += qty;
        acc[cellKey].qtdAltas      += altas;
        acc[cellKey].qtdAltasInfer += altasInf;
        acc[cellKey].inadRRaw      += inadR;
        acc[cellKey].inadIRaw      += inadI;
        if (mixVal) acc[cellKey].mix[mixVal] = (acc[cellKey].mix[mixVal] || 0) + qty;
      }
    }
  }

  return arrivals;
}

// ── Prévia AS IS contextualizada ao nó (respeita filtros a montante) ─────────────
// `computeAsIsCells` (main, App.jsx) deriva a prévia de elegibilidade das caselas
// sobre a base COMPLETA da interseção dos eixos — não vê os filtros a montante do
// fluxo. Aqui a MESMA regra é aplicada, mas só sobre a população que EFETIVAMENTE
// chega a cada cineminha-alvo pelo grafo de fluxo (losangos, Decision Lens e ports a
// montante) — a prévia fica contextualizada ao nó. Percorre o fluxo com o mesmo walk
// compilado de `computeCinemaArrivals`, acumulando volume APROVADO/REPROVADO
// (`__DECISAO_ORIGINAL`) por casela dos alvos; casela = 1 (elegível), 0 só quando
// 100% do volume decidido da interseção é REPROVADO (nenhuma aprovação). Retorna
// `{[shapeId]: {[cellKey]: 0|1} | null}` — `null` quando o dataset do alvo não tem AS IS.
function computeCinemaAsIsCells(shapes, conns, csvStore, targetIds) {
  const targetSet = new Set(targetIds || []);
  const acc = {}; // {[shapeId]: {[cellKey]: {ap, rp}}}
  for (const s of shapes) {
    if (s.type === 'cineminha' && targetSet.has(s.id)) acc[s.id] = {};
  }
  const result = {};
  for (const id of targetIds || []) result[id] = null;
  if (Object.keys(acc).length === 0) return result;

  const { out } = buildFlowGraph(shapes, conns);
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const TERM = new Set(['approved', 'rejected', 'as_is']);
  const portIds = new Set(shapes.filter(s => s.type === 'port').map(s => s.id));
  const decWithPortInc = new Set(conns.filter(c => portIds.has(c.from)).map(c => c.to));
  const rootNodes = shapes.filter(s =>
    (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') && !decWithPortInc.has(s.id)
  );

  // (M8) rotas compiladas + "visited" por época + buffers de hit reutilizados — mesmo
  // esquema do computeCinemaArrivals, só que coletando hits apenas nos cineminhas-alvo.
  const routes = compileRoutes(shapes, conns, out);
  const { decisionRoutes, cinemaRoutes, singleEdge } = routes;
  const nodeIdx = new Map(shapes.map((s, i) => [s.id, i]));
  const lastVisit = new Int32Array(shapes.length);
  let epoch = 0;
  const hitShapeBuf = [], hitKeyBuf = [];

  function collectCinemaHits(csv, r, startId, compiled) {
    epoch++;
    let cur = startId;
    let hitLen = 0;
    while (cur) {
      const idx = nodeIdx.get(cur);
      if (idx === undefined || lastVisit[idx] === epoch) break;
      lastVisit[idx] = epoch;
      const node = shapesMap[cur];
      if (!node) break;
      if (TERM.has(node.type)) break;
      if (node.type === 'decision') {
        const cd = compiled.decision[cur];
        let match;
        if (cd.codes) match = cd.routeByCode[cd.codes[r]];
        else {
          const val = (cd.colIdx >= 0 ? (cellStr(csv, r, cd.colIdx) ?? '') : '').trim();
          match = decisionRoutes[cur]?.get(val);
        }
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const cc = compiled.cinema[cur];
        let cellKey, isEligible;
        if (cc.mode === 'code') {
          if (cc.none) break;
          const ri = cc.rowCodes ? cc.rowCodes[r] : 0;
          const ci = cc.colCodes ? cc.colCodes[r] : 0;
          const p = ri * cc.nC + ci;
          cellKey = cc.keyByPair[p];
          isEligible = cc.eligByPair[p] === 1;
        } else {
          const rv = node.rowVar && cc.rowIdx >= 0 ? (cellStr(csv, r, cc.rowIdx) ?? '').trim() : '';
          const cv = node.colVar && cc.colIdx >= 0 ? (cellStr(csv, r, cc.colIdx) ?? '').trim() : '';
          if (!node.rowVar && !node.colVar) break;
          const rKey = node.rowVar ? rv : '*';
          const cKey = node.colVar ? cv : '*';
          cellKey = `${rKey}|${cKey}`;
          isEligible = isCellEligible(node.cells, cellKey);
        }
        if (acc[node.id] !== undefined) { hitShapeBuf[hitLen] = node.id; hitKeyBuf[hitLen] = cellKey; hitLen++; }
        const rt = cinemaRoutes[cur];
        const match = isEligible ? rt?.eligible : rt?.notEligible;
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'decision_lens') {
        const m = compiled.lens[cur];
        if (m && !m(r)) break;
        const match = singleEdge[cur];
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'port') {
        const match = singleEdge[cur];
        if (!match) break;
        cur = match.to;
      } else break;
    }
    return hitLen;
  }

  for (const [csvId, csv] of Object.entries(csvStore)) {
    const decIdx = csv.headers.indexOf('__DECISAO_ORIGINAL');
    if (decIdx === -1) continue; // base sem AS IS — os hits nela não contribuem
    const csvRoots = rootNodes.filter(d => {
      if (d.type === 'decision')      return d.csvId === csvId;
      if (d.type === 'cineminha')     return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      if (d.type === 'decision_lens') return true;
      return false;
    });
    if (csvRoots.length === 0) continue;
    const rootId = csvRoots[0].id;
    const compiled = compileNodesForCsv(shapes, csv, routes);

    const types = csv.columnTypes || {};
    const qtyCol = Object.entries(types).find(([, t]) => t === 'qty')?.[0];
    const qtyIdx = qtyCol ? csv.headers.indexOf(qtyCol) : -1;

    // AS IS por código do dicionário (O(distintos)) quando dict-encoded; senão leitura
    // por linha (base legada string[][]). 1 = APROVADO, -1 = REPROVADO, 0 = ignora.
    const decDictCol = dictColAt(csv, decIdx);
    let decByCode = null;
    if (decDictCol) {
      decByCode = new Int8Array(decDictCol.dict.length);
      for (let k = 0; k < decDictCol.dict.length; k++) {
        const d = String(decDictCol.dict[k] ?? '').trim().toUpperCase();
        decByCode[k] = d === 'APROVADO' ? 1 : d === 'REPROVADO' ? -1 : 0;
      }
    }

    const nRows = rowCount(csv);
    for (let r = 0; r < nRows; r++) {
      let dec;
      if (decByCode) dec = decByCode[decDictCol.codes[r]];
      else {
        const d = (cellStr(csv, r, decIdx) ?? '').toString().trim().toUpperCase();
        dec = d === 'APROVADO' ? 1 : d === 'REPROVADO' ? -1 : 0;
      }
      if (dec === 0) continue; // linha sem decisão AS IS não pesa na prévia
      const hitLen = collectCinemaHits(csv, r, rootId, compiled);
      if (hitLen === 0) continue;
      const qty = qtyIdx >= 0 ? (cellNum(csv, r, qtyIdx) || 0) : 1;
      for (let h = 0; h < hitLen; h++) {
        const a = acc[hitShapeBuf[h]];
        if (!a) continue;
        const key = hitKeyBuf[h];
        let cell = a[key];
        if (!cell) cell = a[key] = { ap: 0, rp: 0 };
        if (dec === 1) cell.ap += qty; else cell.rp += qty;
      }
    }
  }

  // Deriva as caselas sobre o domínio de cada alvo (mesma regra do computeAsIsCells):
  // casela = 1 (elegível), 0 só quando 100% do volume decidido é REPROVADO. Caselas sem
  // volume/decisão ficam elegíveis (1).
  for (const id of targetIds) {
    const shape = shapesMap[id];
    if (!shape || shape.type !== 'cineminha') { result[id] = null; continue; }
    const csvId = shape.rowVar?.csvId || shape.colVar?.csvId;
    const csv = csvId ? csvStore[csvId] : null;
    if (!csv || csv.headers.indexOf('__DECISAO_ORIGINAL') === -1) { result[id] = null; continue; }
    const rDom = shape.rowDomain?.length > 0 ? shape.rowDomain : ['*'];
    const cDom = shape.colDomain?.length > 0 ? shape.colDomain : ['*'];
    const a = acc[id] || {};
    const cells = {};
    for (const rv of rDom) for (const cv of cDom) {
      // chave de LOOKUP = como o walk montou a chave (valores trimados / '*' no eixo
      // ausente); chave de SAÍDA = `${rv}|${cv}` (formato das caselas do shape).
      const rKey = shape.rowVar ? String(rv).trim() : '*';
      const cKey = shape.colVar ? String(cv).trim() : '*';
      const c = a[`${rKey}|${cKey}`];
      const ap = c ? c.ap : 0, rp = c ? c.rp : 0;
      cells[`${rv}|${cv}`] = (rp > 0 && ap === 0) ? 0 : 1;
    }
    result[id] = cells;
  }
  return result;
}

// Para cada nó de fluxo (decision/cineminha), contabiliza quantos registros chegam
// a ele por valor de domínio da(s) sua(s) variável(is), respeitando o roteamento a
// montante (losangos, Decision Lens e ports). Usado para o "Configurar nó" do canvas:
// decisão → { val: {[valor]: qty} }; cineminha → { row: {...}, col: {...} }.
function computeNodeArrivals(shapes, conns, csvStore, lensPopulations) {
  const { out } = buildFlowGraph(shapes, conns);
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const TERM = new Set(['approved', 'rejected', 'as_is']);
  // Entradas reais do fluxo: nós sem aresta de entrada vinda de outro emissor de
  // fluxo (port, decision_lens, decision, cineminha). Isso exclui corretamente um
  // cineminha logo abaixo de um Decision Lens (que conecta direto, sem port).
  const EMIT = new Set(['port', 'decision_lens', 'decision', 'cineminha']);
  const nonRoot = new Set(conns.filter(c => EMIT.has(shapesMap[c.from]?.type)).map(c => c.to));
  const rootNodes = shapes.filter(s =>
    (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') && !nonRoot.has(s.id)
  );

  const result = {};
  for (const s of shapes) {
    if (s.type === 'decision')      result[s.id] = { val: {} };
    else if (s.type === 'cineminha') result[s.id] = { row: {}, col: {} };
  }

  function walk(csv, r, startId, qty) {
    const headers = csv.headers;
    let cur = startId;
    const visited = new Set();
    while (cur) {
      if (visited.has(cur)) break;
      visited.add(cur);
      const node = shapesMap[cur];
      if (!node) break;
      if (TERM.has(node.type)) break;
      if (node.type === 'decision') {
        const colIdx = headers.indexOf(node.variableCol);
        const val = (colIdx >= 0 ? (cellStr(csv, r, colIdx) ?? '') : '').trim();
        if (result[cur] && val !== '') result[cur].val[val] = (result[cur].val[val] || 0) + qty;
        const match = (out[cur] || []).find(e => (e.label ?? '').trim() === val);
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const rIdx = node.rowVar ? headers.indexOf(node.rowVar.col) : -1;
        const cIdx = node.colVar ? headers.indexOf(node.colVar.col) : -1;
        const rv = node.rowVar && rIdx >= 0 ? (cellStr(csv, r, rIdx) ?? '').trim() : '';
        const cv = node.colVar && cIdx >= 0 ? (cellStr(csv, r, cIdx) ?? '').trim() : '';
        if (result[cur]) {
          if (node.rowVar && rv !== '') result[cur].row[rv] = (result[cur].row[rv] || 0) + qty;
          if (node.colVar && cv !== '') result[cur].col[cv] = (result[cur].col[cv] || 0) + qty;
        }
        if (!node.rowVar && !node.colVar) break;
        const rKey = node.rowVar ? rv : '*';
        const cKey = node.colVar ? cv : '*';
        const cellKey = `${rKey}|${cKey}`;
        const isEligible = isCellEligible(node.cells, cellKey);
        const typeCfg = getCinemaType(node.cinemaType);
        const targetLabel = isEligible ? typeCfg.ports[0].label : typeCfg.ports[1].label;
        const match = (out[cur] || []).find(e => e.label === targetLabel);
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'decision_lens') {
        if (!rowMatchesLensRules(csv, r, node.rules || [])) break;
        const edges = out[cur] || [];
        if (edges.length === 0) break;
        cur = edges[0].to;
      } else if (node.type === 'port') {
        const edges = out[cur] || [];
        if (edges.length === 0) break;
        cur = edges[0].to;
      } else break;
    }
  }

  for (const [csvId, csv] of Object.entries(csvStore)) {
    const types = csv.columnTypes || {};
    const qtyCol = Object.entries(types).find(([, t]) => t === 'qty')?.[0];
    const qtyIdx = qtyCol ? csv.headers.indexOf(qtyCol) : -1;
    const csvRoots = rootNodes.filter(d => {
      if (d.type === 'decision')      return d.csvId === csvId;
      if (d.type === 'cineminha')     return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      if (d.type === 'decision_lens') return true;
      return false;
    });
    if (csvRoots.length === 0) continue;
    const nRows = rowCount(csv);
    for (let r = 0; r < nRows; r++) {
      const qty = qtyIdx >= 0 ? (cellNum(csv, r, qtyIdx) || 0) : 1;
      for (const root of csvRoots) walk(csv, r, root.id, qty);
    }
  }

  return result;
}

// ── Tick de edição — passe único (Otimização de Performance M6) ──────────────
// Cada gesto de edição disparava, até aqui, 4 varreduras COMPLETAS e independentes da
// base — runSimulation, computeSimulatedDecisions (só para o overlay do COMPUTE_OVERLAY),
// computeIncrementalResult (relia o overlay linha a linha de novo) e computeNodeArrivals
// (mais uma varredura, com um walk por raiz) — cada uma recalculando `headers.indexOf` e
// os mapas de aresta por rótulo POR LINHA, e alocando `new Set()`/`path=[]` por linha.
//
// `computeSimulationTick` funde essas quatro passadas numa única iteração por csv×linha:
// os índices de coluna e os mapas de aresta por nó são resolvidos UMA VEZ por nó/csv (não
// por linha, item 2 do M6), o "visited" do walk vira um array de época reutilizado em vez
// de `new Set()` por linha, e o buffer do caminho (edgeStats) é reaproveitado entre linhas
// (item 3). A leitura das colunas de métrica (qty/altas/inadReal/inadInferida/inferência)
// acontece uma vez por linha e alimenta tanto a simulação quanto o incremental — antes eram
// lidas duas vezes (uma em runSimulation, outra em computeIncrementalResult).
//
// Preserva EXATAMENTE a matemática e as semânticas existentes — incluindo a diferença
// sutil entre o conjunto de "raízes" da simulação/overlay (só a 1ª raiz por csv, como
// runSimulation/computeSimulatedDecisions) e o das chegadas por nó (TODAS as raízes, com
// critério mais estrito — exclui nós logo abaixo de um Decision Lens — como
// computeNodeArrivals). `runSimulation`, `computeSimulatedDecisions`, `computeIncrementalResult`
// e `computeNodeArrivals` continuam existindo/exportadas sem NENHUMA alteração (usadas pelo
// `cachedCanvasOverlay` do Dashboard e pelos testes/GATEs) — esta função é só o caminho
// fundido usado pelo tick de edição (RUN_SIMULATION + COMPUTE_OVERLAY). Equivalência
// numérica coberta em `tests/simulationTick.test.js`.
function computeSimulationTick(shapes, conns, csvStore, lensPopulations) {
  const { out } = buildFlowGraph(shapes, conns);
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const TERM = new Set(['approved', 'rejected', 'as_is']);
  const portIds = new Set(shapes.filter(s => s.type === 'port').map(s => s.id));

  // Raízes da simulação/overlay (mesmo critério de runSimulation/computeSimulatedDecisions):
  // só exclui nós com entrada vinda de um port.
  const decWithPortInc = new Set(conns.filter(c => portIds.has(c.from)).map(c => c.to));
  const simRootNodes = shapes.filter(s =>
    (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') && !decWithPortInc.has(s.id)
  );

  // Raízes de chegada por nó (mesmo critério de computeNodeArrivals): mais estrito —
  // exclui nós com entrada vinda de QUALQUER emissor de fluxo (port/lens/decision/cineminha).
  // Por construção, arrivalsRootNodes ⊆ simRootNodes (EMIT ⊇ {port}).
  const EMIT = new Set(['port', 'decision_lens', 'decision', 'cineminha']);
  const nonRoot = new Set(conns.filter(c => EMIT.has(shapesMap[c.from]?.type)).map(c => c.to));
  const arrivalsRootNodes = shapes.filter(s =>
    (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') && !nonRoot.has(s.id)
  );

  const nodeArrivals = {};
  for (const s of shapes) {
    if (s.type === 'decision')       nodeArrivals[s.id] = { val: {} };
    else if (s.type === 'cineminha') nodeArrivals[s.id] = { row: {}, col: {} };
  }

  const hasLens = lensPopulations && Object.keys(lensPopulations).length > 0;

  // ── Pré-resolução das arestas por nó — uma vez, fora do loop de linhas ───────
  const routes = compileRoutes(shapes, conns, out);
  const { decisionRoutes, cinemaRoutes, singleEdge } = routes;

  // ── "visited" por época — evita `new Set()` por linha ────────────────────────
  const nodeIdx = new Map(shapes.map((s, i) => [s.id, i]));
  const lastVisit = new Int32Array(shapes.length);
  let epoch = 0;
  const pathBuf = []; // reaproveitado entre chamadas — só o walk principal (wantPath) escreve

  // Anda pelo fluxo a partir de `startId`. `wantPath` também recolhe os edge ids (edgeStats,
  // via pathBuf/pathLen); `wantArrivals` também acumula as chegadas por nó (val/row/col).
  // (M8) `compiled` = nós compilados por csv (compileNodesForCsv): nas colunas dict o
  // roteamento lê `codes[r]` e segue rotas pré-resolvidas; colunas não-dict/legado caem
  // no caminho por-linha (string) de antes.
  function walk(csv, r, startId, qty, compiled, wantPath, wantArrivals) {
    epoch++;
    let cur = startId;
    let pathLen = 0;
    while (cur) {
      const idx = nodeIdx.get(cur);
      if (idx === undefined || lastVisit[idx] === epoch) return { result: null, pathLen };
      lastVisit[idx] = epoch;
      const node = shapesMap[cur];
      if (!node) return { result: null, pathLen };
      if (TERM.has(node.type)) return { result: node.type, pathLen };

      if (node.type === 'decision') {
        const cd = compiled.decision[cur];
        let match;
        if (cd.codes) {
          const code = cd.codes[r];
          match = cd.routeByCode[code];
          if (wantArrivals && nodeArrivals[cur]) {
            const val = cd.valByCode[code];
            if (val !== '') nodeArrivals[cur].val[val] = (nodeArrivals[cur].val[val] || 0) + qty;
          }
        } else {
          const val = (cd.colIdx >= 0 ? (cellStr(csv, r, cd.colIdx) ?? '') : '').trim();
          if (wantArrivals && nodeArrivals[cur] && val !== '') {
            nodeArrivals[cur].val[val] = (nodeArrivals[cur].val[val] || 0) + qty;
          }
          match = decisionRoutes[cur]?.get(val);
        }
        if (!match) return { result: null, pathLen };
        if (wantPath && match.cid) pathBuf[pathLen++] = match.cid;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const cc = compiled.cinema[cur];
        let isEligible;
        if (cc.mode === 'code') {
          if (cc.none) return { result: null, pathLen }; // sem eixos — nada a acumular
          const ri = cc.rowCodes ? cc.rowCodes[r] : 0;
          const ci = cc.colCodes ? cc.colCodes[r] : 0;
          if (wantArrivals && nodeArrivals[cur]) {
            const rv = cc.rowVals ? cc.rowVals[ri] : '';
            const cv = cc.colVals ? cc.colVals[ci] : '';
            if (node.rowVar && rv !== '') nodeArrivals[cur].row[rv] = (nodeArrivals[cur].row[rv] || 0) + qty;
            if (node.colVar && cv !== '') nodeArrivals[cur].col[cv] = (nodeArrivals[cur].col[cv] || 0) + qty;
          }
          isEligible = cc.eligByPair[ri * cc.nC + ci] === 1;
        } else {
          const rv = node.rowVar && cc.rowIdx >= 0 ? (cellStr(csv, r, cc.rowIdx) ?? '').trim() : '';
          const cv = node.colVar && cc.colIdx >= 0 ? (cellStr(csv, r, cc.colIdx) ?? '').trim() : '';
          if (wantArrivals && nodeArrivals[cur]) {
            if (node.rowVar && rv !== '') nodeArrivals[cur].row[rv] = (nodeArrivals[cur].row[rv] || 0) + qty;
            if (node.colVar && cv !== '') nodeArrivals[cur].col[cv] = (nodeArrivals[cur].col[cv] || 0) + qty;
          }
          if (!node.rowVar && !node.colVar) return { result: null, pathLen };
          const rKey = node.rowVar ? rv : '*';
          const cKey = node.colVar ? cv : '*';
          isEligible = isCellEligible(node.cells, `${rKey}|${cKey}`);
        }
        const rt = cinemaRoutes[cur];
        const match = isEligible ? rt?.eligible : rt?.notEligible;
        if (!match) return { result: null, pathLen };
        if (wantPath && match.cid) pathBuf[pathLen++] = match.cid;
        cur = match.to;
      } else if (node.type === 'decision_lens') {
        const m = compiled.lens[cur];
        if (m && !m(r)) return { result: null, pathLen };
        const match = singleEdge[cur];
        if (!match) return { result: null, pathLen };
        if (wantPath && match.cid) pathBuf[pathLen++] = match.cid;
        cur = match.to;
      } else if (node.type === 'port') {
        const match = singleEdge[cur];
        if (!match) return { result: null, pathLen };
        if (wantPath && match.cid) pathBuf[pathLen++] = match.cid;
        cur = match.to;
      } else return { result: null, pathLen };
    }
    return { result: null, pathLen };
  }

  // Espelha o early-return de runSimulation quando não há NENHUMA raiz de simulação no
  // canvas inteiro: o simResult final fica sem os campos de inferência (mesmo formato).
  const globalSimRoots = simRootNodes.length > 0;

  let totalQty = 0, approvedQty = 0, rejectedQty = 0, asIsQty = 0;
  let inadRealSum = 0, qtdAltasSum = 0, inadInferidaSum = 0, qtdAltasInferSum = 0;
  const edgeAcc = {};
  const initEdge = (cid) => {
    if (!edgeAcc[cid]) edgeAcc[cid] = { qty: 0, approvedQty: 0, rejectedQty: 0, asIsQty: 0, inadRealSum: 0, inadInferidaSum: 0, qtdAltasSum: 0, qtdAltasInferSum: 0 };
  };

  const bl  = { approvedQty: 0, rejectedQty: 0, totalQty: 0, qtdAltasSum: 0, qtdAltasInferSum: 0, inadRRaw: 0, inadIRaw: 0 };
  const sim = { approvedQty: 0, rejectedQty: 0, totalQty: 0, qtdAltasSum: 0, qtdAltasInferSum: 0, inadRRaw: 0, inadIRaw: 0 };
  const imp = { qty: 0, rToA: 0, aToR: 0, qtdAltasSimSum: 0, inadRSimRaw: 0, inadISimRaw: 0, altasInferRtoA: 0, altasRealAtoR: 0 };
  let hasAnyDecisaoCol = false;

  for (const [csvId, csv] of Object.entries(csvStore)) {
    const types = csv.columnTypes || {};
    const colIdxOf = (type) => {
      const col = Object.entries(types).find(([, t]) => t === type)?.[0];
      return col ? csv.headers.indexOf(col) : -1;
    };
    const qtyIdx           = colIdxOf('qty');
    const qtdAltasIdx      = colIdxOf('qtdAltas');
    const qtdAltasInferIdx = colIdxOf('qtdAltasInfer');
    const inadRealIdx      = colIdxOf('inadReal');
    const inadInferidaIdx  = colIdxOf('inadInferida');
    const dOrigIdx         = csv.headers.indexOf('__DECISAO_ORIGINAL');
    const hasAsIsCol       = dOrigIdx >= 0;
    if (hasAsIsCol) hasAnyDecisaoCol = true;

    const csvMatch = (d) => {
      if (d.type === 'decision')      return d.csvId === csvId;
      if (d.type === 'cineminha')     return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      if (d.type === 'decision_lens') return true;
      return false;
    };
    const simCsvRoots      = globalSimRoots ? simRootNodes.filter(csvMatch) : [];
    const arrivalsCsvRoots = arrivalsRootNodes.filter(csvMatch);
    const doSim      = globalSimRoots && simCsvRoots.length > 0;
    const doArrivals = arrivalsCsvRoots.length > 0;

    if (!doSim && !hasAsIsCol) continue; // nada a contribuir deste csv

    const rootId = doSim ? simCsvRoots[0].id : null;
    const compiled = (doSim || doArrivals) ? compileNodesForCsv(shapes, csv, routes) : null; // (M8)
    // Caso comum: a única raiz de chegadas é a mesma raiz da simulação (mesmo csv/row, walk
    // determinístico) — dobra a chegada dentro do walk principal em vez de andar 2x por linha.
    const arrivalsFoldedIntoPrimary = doSim && doArrivals && arrivalsCsvRoots.length === 1 && arrivalsCsvRoots[0].id === rootId;
    // Populações de lens deste csv resolvidas UMA vez — não Object.values(...).some
    // (alocação + closure) por linha.
    const csvLensPops = (hasLens && hasAsIsCol)
      ? Object.values(lensPopulations).map(pop => pop[csvId]).filter(Boolean)
      : null;

    const nRows = rowCount(csv);
    for (let r = 0; r < nRows; r++) {
      const qty      = qtyIdx      >= 0 ? (cellNum(csv, r, qtyIdx)      || 0) : 1;
      const qtdAltas = qtdAltasIdx >= 0 ? (cellNum(csv, r, qtdAltasIdx) || 0) : 0;
      const inadR    = inadRealIdx >= 0 ? (cellNum(csv, r, inadRealIdx) || 0) : 0;
      const qtdAltasInfer = qtdAltasInferIdx >= 0 ? (cellNum(csv, r, qtdAltasInferIdx) || 0) : 0;
      const inadI         = inadInferidaIdx  >= 0 ? (cellNum(csv, r, inadInferidaIdx)  || 0) : 0;

      let res = null;
      if (doSim) {
        totalQty += qty;
        const walked = walk(csv, r, rootId, qty, compiled, true, arrivalsFoldedIntoPrimary);
        res = walked.result;
        const pathLen = walked.pathLen;

        let isApproved = res === 'approved', isRejected = res === 'rejected';
        if (res === 'as_is') {
          const origDecision = dOrigIdx >= 0 ? String(cellStr(csv, r, dOrigIdx) ?? '').toUpperCase() : '';
          if (origDecision === 'APROVADO') isApproved = true;
          else if (origDecision === 'REPROVADO') isRejected = true;
          else asIsQty += qty;
        }
        if (isApproved) {
          approvedQty      += qty;
          qtdAltasSum      += qtdAltas;
          qtdAltasInferSum += qtdAltasInfer;
          inadRealSum      += inadR;
          inadInferidaSum  += inadI;
        } else if (isRejected) rejectedQty += qty;

        for (let i = 0; i < pathLen; i++) {
          const cid = pathBuf[i];
          initEdge(cid);
          edgeAcc[cid].qty += qty;
          if (isApproved) {
            edgeAcc[cid].approvedQty      += qty;
            edgeAcc[cid].qtdAltasSum      += qtdAltas;
            edgeAcc[cid].qtdAltasInferSum += qtdAltasInfer;
            edgeAcc[cid].inadRealSum      += inadR;
            edgeAcc[cid].inadInferidaSum  += inadI;
          } else if (isRejected) {
            edgeAcc[cid].rejectedQty += qty;
          } else if (res === 'as_is') {
            edgeAcc[cid].asIsQty += qty;
          }
        }
      }

      if (hasAsIsCol) {
        const decisaoOriginal = cellStr(csv, r, dOrigIdx) ?? '';
        let isMutable = !hasLens;
        if (!isMutable) {
          for (let i = 0; i < csvLensPops.length; i++) {
            if (csvLensPops[i][r] === 1) { isMutable = true; break; }
          }
        }
        const decisaoSimulada = (doSim && isMutable)
          ? (res === 'approved' ? 'APROVADO' : res === 'rejected' ? 'REPROVADO' : decisaoOriginal)
          : decisaoOriginal;
        const flagImpactado = decisaoOriginal !== '' && decisaoSimulada !== decisaoOriginal;

        bl.totalQty += qty;
        if (decisaoOriginal === 'APROVADO') {
          bl.approvedQty += qty; bl.qtdAltasSum += qtdAltas; bl.qtdAltasInferSum += qtdAltasInfer; bl.inadRRaw += inadR; bl.inadIRaw += inadI;
        } else if (decisaoOriginal === 'REPROVADO') {
          bl.rejectedQty += qty;
        }

        sim.totalQty += qty;
        if (decisaoSimulada === 'APROVADO') {
          sim.approvedQty += qty; sim.qtdAltasSum += qtdAltas; sim.qtdAltasInferSum += qtdAltasInfer; sim.inadRRaw += inadR; sim.inadIRaw += inadI;
        } else if (decisaoSimulada === 'REPROVADO') {
          sim.rejectedQty += qty;
        }

        if (flagImpactado) {
          imp.qty += qty;
          if (decisaoOriginal === 'REPROVADO' && decisaoSimulada === 'APROVADO') {
            imp.rToA += qty; imp.qtdAltasSimSum += qtdAltas; imp.inadRSimRaw += inadR; imp.inadISimRaw += inadI;
            imp.altasInferRtoA += qtdAltasInfer;
          } else if (decisaoOriginal === 'APROVADO' && decisaoSimulada === 'REPROVADO') {
            imp.aToR += qty;
            imp.altasRealAtoR += qtdAltas;
          }
        }
      }

      if (doArrivals && !arrivalsFoldedIntoPrimary) {
        for (const root of arrivalsCsvRoots) walk(csv, r, root.id, qty, compiled, false, true);
      }
    }
  }

  const simResult = !globalSimRoots
    ? { totalQty: 0, approvedQty: 0, rejectedQty: 0, asIsQty: 0, approvalRate: 0, inadReal: null, inadInferida: null, edgeStats: {} }
    : (() => {
        const inadReal     = qtdAltasSum > 0 ? inadRealSum / qtdAltasSum : null;
        const inadInferida = qtdAltasInferSum > 0 ? inadInferidaSum / qtdAltasInferSum
                           : approvedQty      > 0 ? inadInferidaSum / approvedQty : null;
        const edgeStats = {};
        for (const [cid, acc] of Object.entries(edgeAcc)) {
          edgeStats[cid] = {
            qty: acc.qty,
            approvedQty: acc.approvedQty,
            rejectedQty: acc.rejectedQty,
            asIsQty: acc.asIsQty,
            qtdAltas: acc.qtdAltasSum,
            approvalRate: acc.qty > 0 ? acc.approvedQty / acc.qty : null,
            inadReal: acc.qtdAltasSum > 0 ? acc.inadRealSum / acc.qtdAltasSum : null,
            inadInferida: acc.qtdAltasInferSum > 0 ? acc.inadInferidaSum / acc.qtdAltasInferSum
                        : acc.approvedQty      > 0 ? acc.inadInferidaSum / acc.approvedQty : null,
          };
        }
        return {
          totalQty, approvedQty, rejectedQty, asIsQty,
          approvalRate: totalQty > 0 ? (approvedQty / totalQty) * 100 : 0,
          inadReal, inadInferida, edgeStats,
        };
      })();

  let incrementalResult = null;
  if (hasAnyDecisaoCol) {
    const blRate  = bl.totalQty  > 0 ? (bl.approvedQty  / bl.totalQty)  * 100 : 0;
    const simRate = sim.totalQty > 0 ? (sim.approvedQty / sim.totalQty) * 100 : 0;
    incrementalResult = {
      baseline: {
        approvedQty: bl.approvedQty, rejectedQty: bl.rejectedQty, totalQty: bl.totalQty,
        approvalRate: blRate,
        inadReal:     bl.qtdAltasSum      > 0 ? bl.inadRRaw / bl.qtdAltasSum      : null,
        inadInferida: bl.qtdAltasInferSum > 0 ? bl.inadIRaw / bl.qtdAltasInferSum
                    : bl.approvedQty      > 0 ? bl.inadIRaw / bl.approvedQty      : null,
      },
      simulated: {
        approvedQty: sim.approvedQty, rejectedQty: sim.rejectedQty, totalQty: sim.totalQty,
        approvalRate: simRate,
        inadReal:     sim.qtdAltasSum      > 0 ? sim.inadRRaw / sim.qtdAltasSum      : null,
        inadInferida: sim.qtdAltasInferSum > 0 ? sim.inadIRaw / sim.qtdAltasInferSum
                    : sim.approvedQty      > 0 ? sim.inadIRaw / sim.approvedQty      : null,
      },
      impacted: {
        qty: imp.qty, totalQty: bl.totalQty,
        pct: bl.totalQty > 0 ? (imp.qty / bl.totalQty) * 100 : 0,
        rToA: imp.rToA, aToR: imp.aToR,
        approvalDelta: simRate - blRate,
        altasInferRtoA: imp.altasInferRtoA,
        altasRealAtoR: imp.altasRealAtoR,
      },
    };
  }

  return { simResult, incrementalResult, nodeArrivals };
}

// DEC-JO-004: greedy com restrição de precedência (Sessão C).
// riskLevels: {[shapeId]: number} — maior = mais restritivo (DEC-JO-002)
// hierarchyMode: 'cascata'|'independente' (DEC-JO-003)
// inadMetric: 'inferida'|'real' (DEC-JO-004)
function computeJohnnyData(allShapes, cinemaIds, conns, csvStore, lensPopulations, riskLevels, hierarchyMode, inadMetric) {
  const cinemaIdSet = new Set(cinemaIds);
  const cinemas = allShapes.filter(s => cinemaIdSet.has(s.id) && s.type === 'cineminha');
  if (cinemas.length === 0) return null;

  const arrivals = computeCinemaArrivals(allShapes, conns, csvStore, lensPopulations);

  // Collect ordinal info per cineminha (needed for precedence and fallback rank)
  const cinemaOrdInfo = {};
  for (const shape of cinemas) {
    const csvId = shape.rowVar?.csvId || shape.colVar?.csvId;
    const csv = csvStore[csvId || ''] || {};
    const varTypes = csv.varTypes || {};
    cinemaOrdInfo[shape.id] = {
      rowIsOrd: shape.rowVar ? varTypes[shape.rowVar.col] === 'ordinal' : false,
      colIsOrd: shape.colVar ? varTypes[shape.colVar.col] === 'ordinal' : false,
      rDom: shape.rowDomain?.length > 0 ? shape.rowDomain : ['*'],
      cDom: shape.colDomain?.length > 0 ? shape.colDomain : ['*'],
    };
  }

  const pooledMetrics = {};
  const mixCatsSet = new Set();
  let totalQty = 0;

  for (const shape of cinemas) {
    const { rowVar, colVar } = shape;
    const csvId = rowVar?.csvId || colVar?.csvId;
    if (!csvId) continue;
    const csv = csvStore[csvId];
    if (!csv) continue;

    const { rDom, cDom } = cinemaOrdInfo[shape.id];
    const shapeArrivals = arrivals[shape.id] || {};

    for (const rv of rDom) {
      for (const cv of cDom) {
        const cellKey = `${rv}|${cv}`;
        const m = shapeArrivals[cellKey];
        if (!m || m.qty === 0) continue;
        for (const mv of Object.keys(m.mix || {})) if (mv) mixCatsSet.add(mv);
        const pk = `${shape.id}|${cellKey}`;
        pooledMetrics[pk] = {
          shapeId: shape.id, cellKey, rowVal: rv, colVal: cv,
          qty: m.qty, qtdAltas: m.qtdAltas, qtdAltasInfer: m.qtdAltasInfer,
          inadRRaw: m.inadRRaw, inadIRaw: m.inadIRaw,
          inadReal:     m.qtdAltas      > 0 ? m.inadRRaw / m.qtdAltas      : null,
          inadInferida: m.qtdAltasInfer > 0 ? m.inadIRaw / m.qtdAltasInfer
                      : m.qty           > 0 ? m.inadIRaw / m.qty            : null,
          mixBreakdown: m.mix || {},
        };
        totalQty += m.qty;
      }
    }
  }

  if (totalQty === 0) return null;

  // ── Greedy com precedência (DEC-JO-003, DEC-JO-004) ─────────────────────────
  const _inadMetric    = inadMetric    || 'inferida';
  const _hierarchyMode = hierarchyMode || 'cascata';
  const _riskLevels    = riskLevels    || Object.fromEntries(cinemas.map((s, i) => [s.id, i + 1]));

  const allCells = Object.entries(pooledMetrics).map(([pk, m]) => ({ pk, ...m }));
  const cellByPk = Object.fromEntries(allCells.map(c => [c.pk, c]));

  // Suavização bayesiana: shrinkage em direção à média do pool — evita que células de
  // baixo volume (ruído amostral) furem a fila por inadimplência aparentemente baixa.
  let poolInadRaw = 0, poolDen = 0;
  for (const c of allCells) {
    if (_inadMetric === 'real') { poolInadRaw += c.inadRRaw || 0; poolDen += c.qtdAltas || 0; }
    else { poolInadRaw += c.inadIRaw || 0; poolDen += (c.qtdAltasInfer > 0 ? c.qtdAltasInfer : c.qty) || 0; }
  }
  const poolAvgInad = poolDen > 0 ? poolInadRaw / poolDen : 0;
  const SHRINK_K = Math.max(1, (totalQty / Math.max(1, allCells.length)) * 0.1);

  const smoothedInad = (c) => {
    if (_inadMetric === 'real') {
      return ((c.inadRRaw || 0) + poolAvgInad * SHRINK_K) / ((c.qtdAltas || 0) + SHRINK_K);
    }
    const den = c.qtdAltasInfer > 0 ? c.qtdAltasInfer : c.qty;
    return ((c.inadIRaw || 0) + poolAvgInad * SHRINK_K) / ((den || 0) + SHRINK_K);
  };

  const hasAnyInad = allCells.some(c =>
    _inadMetric === 'real' ? c.inadReal !== null : c.inadInferida !== null
  );

  // Fallback (sem inadimplência): rank hierárquico + posição ordinal interna
  const fallbackRank = (c) => {
    const level = (_riskLevels[c.shapeId] ?? 1) * 1e6;
    const { rDom, cDom } = cinemaOrdInfo[c.shapeId] || { rDom: ['*'], cDom: ['*'] };
    const ri = rDom.indexOf(c.rowVal), ci2 = cDom.indexOf(c.colVal);
    return level + (ri >= 0 ? ri : 0) * 1000 + (ci2 >= 0 ? ci2 : 0);
  };

  // ── Grafo de precedência ────────────────────────────────────────────────────
  // requires[pk] = Set de pks que devem ser abertos antes de pk
  const requires   = Object.fromEntries(allCells.map(c => [c.pk, new Set()]));
  const dependents = Object.fromEntries(allCells.map(c => [c.pk, []]));

  // (a) Monotonicidade interna por eixo ordinal: (i,j) exige (i-1,j) e (i,j-1)
  for (const shape of cinemas) {
    const { rowIsOrd, colIsOrd, rDom, cDom } = cinemaOrdInfo[shape.id];
    for (let ri = 0; ri < rDom.length; ri++) {
      for (let ci = 0; ci < cDom.length; ci++) {
        const pk = `${shape.id}|${rDom[ri]}|${cDom[ci]}`;
        if (!requires[pk]) continue;
        if (rowIsOrd && ri > 0) {
          const predPk = `${shape.id}|${rDom[ri - 1]}|${cDom[ci]}`;
          if (requires[predPk]) { requires[pk].add(predPk); dependents[predPk].push(pk); }
        }
        if (colIsOrd && ci > 0) {
          const predPk = `${shape.id}|${rDom[ri]}|${cDom[ci - 1]}`;
          if (requires[predPk]) { requires[pk].add(predPk); dependents[predPk].push(pk); }
        }
      }
    }
  }

  // (b) Aninhamento entre níveis (modo Cascata): (i,j) no nível L exige (i,j) no nível L-1
  if (_hierarchyMode === 'cascata') {
    const sortedByLevel = [...cinemas].sort((a, b) => (_riskLevels[a.id] ?? 1) - (_riskLevels[b.id] ?? 1));
    // Lookup: shapeId → cellKey → pk
    const bySId = {};
    for (const c of allCells) {
      if (!bySId[c.shapeId]) bySId[c.shapeId] = {};
      bySId[c.shapeId][c.cellKey] = c.pk;
    }
    for (let k = 1; k < sortedByLevel.length; k++) {
      const prevMap = bySId[sortedByLevel[k - 1].id] || {};
      const curMap  = bySId[sortedByLevel[k].id]     || {};
      for (const [cellKey, pk] of Object.entries(curMap)) {
        const predPk = prevMap[cellKey];
        if (predPk && requires[pk] && requires[predPk] !== undefined && !requires[pk].has(predPk)) {
          requires[pk].add(predPk);
          dependents[predPk].push(pk);
        }
      }
    }
  }

  // ── Greedy: a cada passo, entre as células LIBERADAS abre a de menor inad ───
  const remaining    = Object.fromEntries(allCells.map(c => [c.pk, requires[c.pk].size]));
  const liberatedSet = new Set(allCells.filter(c => remaining[c.pk] === 0).map(c => c.pk));

  const frontier = [{
    cells: {}, approvalRate: 0, inadReal: null, inadInferida: null,
    totalQty, approvedQty: 0, mixBreakdown: {},
  }];
  let approvedQty = 0, altasSum = 0, inadRSum = 0, inadISum = 0;
  const curCells = {}, curMix = {};

  while (liberatedSet.size > 0) {
    // Encontra a célula liberada de menor inadimplência (desempate: maior qty)
    let best = null, bestScore = Infinity, bestQty = -1;
    for (const pk of liberatedSet) {
      const c = cellByPk[pk];
      const score = hasAnyInad ? smoothedInad(c) : fallbackRank(c);
      if (score < bestScore || (score === bestScore && c.qty > bestQty)) {
        best = c; bestScore = score; bestQty = c.qty;
      }
    }
    if (!best) break;

    liberatedSet.delete(best.pk);
    approvedQty += best.qty; altasSum += best.qtdAltas;
    inadRSum += best.inadRRaw; inadISum += best.inadIRaw;
    curCells[best.pk] = true;
    for (const [mv, mq] of Object.entries(best.mixBreakdown || {}))
      curMix[mv] = (curMix[mv] || 0) + mq;

    frontier.push({
      cells: { ...curCells },
      approvalRate: approvedQty / totalQty,
      inadReal:     altasSum    > 0 ? inadRSum / altasSum    : null,
      inadInferida: approvedQty > 0 ? inadISum / approvedQty : null,
      totalQty, approvedQty,
      mixBreakdown: { ...curMix },
    });

    // Libera dependentes cujas precedências estão agora satisfeitas
    for (const depPk of (dependents[best.pk] || [])) {
      remaining[depPk]--;
      if (remaining[depPk] === 0) liberatedSet.add(depPk);
    }
  }

  // Scenarios (knee algorithm)
  const pts = frontier.filter(p => p.approvalRate > 0);
  let conservador = pts[0] || null;
  const expansao  = pts[pts.length - 1] || null;
  let melhorEficiencia = conservador;
  if (pts.length >= 3) {
    const x0 = conservador.approvalRate,   y0 = conservador.inadInferida   ?? 0;
    const x1 = expansao.approvalRate,      y1 = expansao.inadInferida      ?? 0;
    const dx = x1-x0, dy = y1-y0, len = Math.sqrt(dx*dx+dy*dy);
    let maxD = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const px = pts[i].approvalRate, py = pts[i].inadInferida ?? 0;
      const d = len > 0 ? Math.abs(dy*px - dx*py + x1*y0 - y1*x0) / len
                        : Math.abs(px-x0) + Math.abs(py-y0);
      if (d > maxD) { maxD = d; melhorEficiencia = pts[i]; }
    }
  }

  // Baseline: current cells state in each cineminha
  let baselineApprQty = 0;
  for (const shape of cinemas) {
    for (const [pk, m] of Object.entries(pooledMetrics)) {
      if (m.shapeId !== shape.id) continue;
      if (isCellEligible(shape.cells || {}, m.cellKey)) baselineApprQty += m.qty;
    }
  }
  const baselineApprovalRate = totalQty > 0 ? baselineApprQty / totalQty : 0;

  const shapeMetas = cinemas.map(s => ({
    id: s.id, label: s.label || 'Cineminha',
    rowVar: s.rowVar, colVar: s.colVar,
    rowDomain: s.rowDomain || [], colDomain: s.colDomain || [],
    originalCells: { ...(s.cells || {}) },
  }));

  const maxInadReal = Math.max(0, ...Object.values(pooledMetrics).map(m => m.inadReal     ?? 0));
  const maxInadInf  = Math.max(0, ...Object.values(pooledMetrics).map(m => m.inadInferida ?? 0));

  return {
    pooledMetrics, frontier,
    scenarios: { conservador, melhorEficiencia, expansao },
    mixCats: [...mixCatsSet],
    shapeMetas, baselineApprovalRate, maxInadReal, maxInadInf,
  };
}

// ── Goal Seek (Copiloto Sessão 4, DEC-IA-005/006) ────────────────────────────────
// Generaliza o Johnny (acima) da célula de Cineminha para a política INTEIRA: o
// usuário declara um objetivo estruturado (alvo + direção + magnitude, restrições-teto,
// travas 🔒) e o motor busca uma sequência de MOVIMENTOS concretos — não só abrir/fechar
// célula, mas também trocar o terminal de um segmento (nó de decisão, valor) e
// relaxar/apertar o limiar de uma regra de Decision Lens — que atinja o objetivo.
//
// Catálogo de movimentos (cada um = um segmento com agregados conhecidos, na mesma
// veia de computeCinemaArrivals/exportDiagnosticCSV — "trocar o destino de um segmento
// muda os acumuladores globais por adição/subtração, sem re-simular a base"):
//   - cinema_cell:       reusa computeCinemaArrivals (mesma mecânica do Johnny acima).
//   - decision_terminal: um VALOR de um losango cujo port (seguindo cadeias de port,
//                        como buildPolicyIR/resolveThroughPorts) resolve DIRETAMENTE a
//                        um terminal Aprovado/Reprovado — trocar esse terminal move o
//                        segmento inteiro de um lado para o outro, sem ambiguidade (a
//                        segmentação por valor já garante que 100% da linha segue o
//                        mesmo caminho). Segmentos que resolvem em AS IS ficam de fora
//                        (o terminal AS IS depende de __DECISAO_ORIGINAL por linha —
//                        não é um destino único), documentado como limitação da Sessão 4.
//   - lens_threshold:    um Decision Lens de UMA regra (operador gte/gt/lte/lt) cujo
//                        único port de saída resolve diretamente a Aprovado — relaxar
//                        (admite o próximo valor que hoje falha) ou apertar (remove o
//                        valor mais próximo da fronteira que hoje passa) por UM passo.
//                        Lens cujo port leva a Reprovado/AS IS, ou com mais de uma
//                        regra, ficam fora (catálogo extensível por design — mesmo
//                        precedente do "adicionar quebra" no épico).
//
// Busca: greedy com precedência (padrão Johnny/DEC-JO-003/004) + shrinkage bayesiano —
// generaliza o pool de "células" do Johnny para um pool heterogêneo de movimentos, cada
// um com direção (`toApproved`) e magnitude (qty/qtdAltas/qtdAltasInfer/inadRRaw/inadIRaw).
// Travas 🔒 (`shape.locked` ou a lista `locks` da mensagem) excluem candidatos do nó
// inteiro ANTES da busca. Restrições de teto (`maxInadReal`/`maxInadInf`) são invioláveis:
// um movimento que estouraria o teto nunca é aplicado (nem contabilizado no resultado).
// Ao final (sucesso ou parcial), os movimentos aceitos são materializados de verdade
// (applyGoalSeekMoves, src/goalSeek.js) e RE-SIMULADOS (runSimulation) — nenhum número
// exibido tem origem só no delta incremental interno da busca (DEC-IA-005). GATE de
// equivalência delta×resimulação em tests/goalSeek.test.js.

const LENS_ORDINAL_OPS = new Set(['gte', 'gt', 'lte', 'lt']);
const GOAL_SEEK_TERMINAL_LABEL = { approved: 'Aprovado', rejected: 'Reprovado' };

// Segue cadeias de ports "puros" (única saída) a partir de um destino `startTo`,
// devolvendo o TERMINAL (approved/rejected/as_is) em que a cadeia resolve, e o id da
// ÚLTIMA conexão percorrida (cuja `to` é o próprio terminal) — é essa conexão que um
// movimento decision_terminal/lens_threshold reaponta para trocar o destino do segmento.
// `null` quando a cadeia não resolve num terminal direto (vai para outro nó de fluxo,
// ciclo de ports ou destino inexistente) — esses segmentos ficam fora do catálogo.
function resolveDirectTerminalConn(shapesMap, connFromMap, startTo, startConnId) {
  let curTo = startTo, curConnId = startConnId;
  const seen = new Set();
  while (curTo != null) {
    const node = shapesMap[curTo];
    if (!node) return null;
    if (node.type === 'approved' || node.type === 'rejected' || node.type === 'as_is') {
      return { terminal: node.type, terminalId: curTo, connId: curConnId };
    }
    if (node.type !== 'port') return null;
    if (seen.has(curTo)) return null;
    seen.add(curTo);
    const next = (connFromMap[curTo] || [])[0];
    if (!next) return null;
    curConnId = next.id;
    curTo = next.to;
  }
  return null;
}

// Walk único (mesmo esquema compilado M8 de computeCinemaArrivals) que coleta, além dos
// hits de Cineminha (já cobertos por computeCinemaArrivals — reusado à parte), os
// agregados por SEGMENTO de:
//   - decisionArrivals: {[nodeId]: {[valor]: {qty, qtdAltas, qtdAltasInfer, inadRRaw, inadIRaw}}}
//     — métricas das linhas que chegam ao losango COM aquele valor (respeitando o
//     roteamento a montante), independente de a rota existir ou não.
//   - lensColArrivals: {[lensId]: {[valorBruto]: {...}}} — para os Decision Lens
//     elegíveis a lens_threshold (`lensColByShape`), métricas por valor BRUTO da coluna
//     da regra, entre as linhas que chegam ao lens (passando ou não as regras hoje).
function computeGoalSeekArrivals(shapes, conns, csvStore, lensPopulations, lensColByShape) {
  const { out } = buildFlowGraph(shapes, conns);
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const TERM = new Set(['approved', 'rejected', 'as_is']);
  const portIds = new Set(shapes.filter(s => s.type === 'port').map(s => s.id));
  const decWithPortInc = new Set(conns.filter(c => portIds.has(c.from)).map(c => c.to));
  const rootNodes = shapes.filter(s =>
    (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') && !decWithPortInc.has(s.id)
  );

  const decisionArrivals = {};
  const lensColArrivals = {};
  for (const s of shapes) {
    if (s.type === 'decision') decisionArrivals[s.id] = {};
    if (s.type === 'decision_lens' && lensColByShape[s.id]) lensColArrivals[s.id] = {};
  }
  if (Object.keys(decisionArrivals).length === 0 && Object.keys(lensColArrivals).length === 0) {
    return { decisionArrivals, lensColArrivals };
  }

  const routes = compileRoutes(shapes, conns, out);
  const { decisionRoutes, cinemaRoutes, singleEdge } = routes;
  const nodeIdx = new Map(shapes.map((s, i) => [s.id, i]));
  const lastVisit = new Int32Array(shapes.length);
  let epoch = 0;
  const decHitShapeBuf = [], decHitValBuf = [];
  const lensHitShapeBuf = [], lensHitValBuf = [];

  function walkRow(csv, r, startId, compiled, lensColIdxMap) {
    epoch++;
    let cur = startId;
    let decLen = 0, lensLen = 0;
    while (cur) {
      const idx = nodeIdx.get(cur);
      if (idx === undefined || lastVisit[idx] === epoch) break;
      lastVisit[idx] = epoch;
      const node = shapesMap[cur];
      if (!node) break;
      if (TERM.has(node.type)) break;
      if (node.type === 'decision') {
        const cd = compiled.decision[cur];
        let val, match;
        if (cd.codes) { const code = cd.codes[r]; val = cd.valByCode[code]; match = cd.routeByCode[code]; }
        else {
          val = (cd.colIdx >= 0 ? (cellStr(csv, r, cd.colIdx) ?? '') : '').trim();
          match = decisionRoutes[cur]?.get(val);
        }
        if (decisionArrivals[cur]) { decHitShapeBuf[decLen] = cur; decHitValBuf[decLen] = val; decLen++; }
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const cc = compiled.cinema[cur];
        let isEligible;
        if (cc.mode === 'code') {
          if (cc.none) break;
          const ri = cc.rowCodes ? cc.rowCodes[r] : 0;
          const ci = cc.colCodes ? cc.colCodes[r] : 0;
          isEligible = cc.eligByPair[ri * cc.nC + ci] === 1;
        } else {
          const rv = node.rowVar && cc.rowIdx >= 0 ? (cellStr(csv, r, cc.rowIdx) ?? '').trim() : '';
          const cv = node.colVar && cc.colIdx >= 0 ? (cellStr(csv, r, cc.colIdx) ?? '').trim() : '';
          if (!node.rowVar && !node.colVar) break;
          const rKey = node.rowVar ? rv : '*';
          const cKey = node.colVar ? cv : '*';
          isEligible = isCellEligible(node.cells, `${rKey}|${cKey}`);
        }
        const rt = cinemaRoutes[cur];
        const match = isEligible ? rt?.eligible : rt?.notEligible;
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'decision_lens') {
        const lensColIdx = lensColIdxMap ? lensColIdxMap[cur] : undefined;
        if (lensColIdx !== undefined && lensColIdx >= 0) {
          const rawVal = cellStr(csv, r, lensColIdx) ?? '';
          lensHitShapeBuf[lensLen] = cur; lensHitValBuf[lensLen] = rawVal; lensLen++;
        }
        const m = compiled.lens[cur];
        if (m && !m(r)) break;
        const match = singleEdge[cur];
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'port') {
        const match = singleEdge[cur];
        if (!match) break;
        cur = match.to;
      } else break;
    }
    return { decLen, lensLen };
  }

  for (const [csvId, csv] of Object.entries(csvStore)) {
    const types = csv.columnTypes || {};
    const getColIdx = (type) => {
      const col = Object.entries(types).find(([, t]) => t === type)?.[0];
      return col ? csv.headers.indexOf(col) : -1;
    };
    const qtyIdx = getColIdx('qty'), altasIdx = getColIdx('qtdAltas'), altasInfIdx = getColIdx('qtdAltasInfer'),
      inadRIdx = getColIdx('inadReal'), inadIIdx = getColIdx('inadInferida');

    const csvRoots = rootNodes.filter(d => {
      if (d.type === 'decision')      return d.csvId === csvId;
      if (d.type === 'cineminha')     return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      if (d.type === 'decision_lens') return true;
      return false;
    });
    if (csvRoots.length === 0) continue;
    const rootId = csvRoots[0].id;
    const compiled = compileNodesForCsv(shapes, csv, routes);
    const lensColIdxMap = {};
    for (const [lensId, colName] of Object.entries(lensColByShape)) {
      lensColIdxMap[lensId] = csv.headers.indexOf(colName);
    }

    const nRows = rowCount(csv);
    for (let r = 0; r < nRows; r++) {
      const { decLen, lensLen } = walkRow(csv, r, rootId, compiled, lensColIdxMap);
      if (decLen === 0 && lensLen === 0) continue;
      const qty      = qtyIdx      >= 0 ? (cellNum(csv, r, qtyIdx)      || 0) : 1;
      const altas    = altasIdx    >= 0 ? (cellNum(csv, r, altasIdx)    || 0) : 0;
      const inadR    = inadRIdx    >= 0 ? (cellNum(csv, r, inadRIdx)    || 0) : 0;
      const altasInf = altasInfIdx >= 0 ? (cellNum(csv, r, altasInfIdx) || 0) : 0;
      const inadI    = inadIIdx    >= 0 ? (cellNum(csv, r, inadIIdx)    || 0) : 0;
      for (let h = 0; h < decLen; h++) {
        const acc = decisionArrivals[decHitShapeBuf[h]];
        const val = decHitValBuf[h];
        if (!acc[val]) acc[val] = { qty: 0, qtdAltas: 0, qtdAltasInfer: 0, inadRRaw: 0, inadIRaw: 0 };
        acc[val].qty += qty; acc[val].qtdAltas += altas; acc[val].qtdAltasInfer += altasInf;
        acc[val].inadRRaw += inadR; acc[val].inadIRaw += inadI;
      }
      for (let h = 0; h < lensLen; h++) {
        const acc = lensColArrivals[lensHitShapeBuf[h]];
        const val = lensHitValBuf[h];
        if (!acc[val]) acc[val] = { qty: 0, qtdAltas: 0, qtdAltasInfer: 0, inadRRaw: 0, inadIRaw: 0 };
        acc[val].qty += qty; acc[val].qtdAltas += altas; acc[val].qtdAltasInfer += altasInf;
        acc[val].inadRRaw += inadR; acc[val].inadIRaw += inadI;
      }
    }
  }

  return { decisionArrivals, lensColArrivals };
}

// Novo limiar de uma regra gte/gt/lte/lt para incluir ('relax') ou excluir ('tighten')
// exatamente `distinct[idx]` do conjunto que passa, mantendo o vizinho mais próximo do
// lado oposto no estado atual (gte/lte usam o próprio valor — inclusivos; gt/lt usam o
// PONTO MÉDIO entre os dois distintos vizinhos — exclusivos, evita reabrir/fechar mais
// de um valor por movimento quando os distintos não são uniformemente espaçados).
function computeNewLensThreshold(operator, distinct, idx, kind) {
  const isUpperPass = operator === 'gte' || operator === 'gt';
  const inclusive = operator === 'gte' || operator === 'lte';
  const v = distinct[idx].n;
  if (kind === 'relax') {
    if (isUpperPass) {
      if (inclusive) return v;
      const lo = idx > 0 ? distinct[idx - 1].n : v - 1;
      return (lo + v) / 2;
    }
    if (inclusive) return v;
    const hi = idx < distinct.length - 1 ? distinct[idx + 1].n : v + 1;
    return (v + hi) / 2;
  }
  // tighten
  if (isUpperPass) {
    if (inclusive) {
      const hi = idx < distinct.length - 1 ? distinct[idx + 1].n : v + 1;
      return hi;
    }
    return v;
  }
  if (inclusive) {
    const lo = idx > 0 ? distinct[idx - 1].n : v - 1;
    return lo;
  }
  return v;
}

// Catálogo de candidatos a movimento (ver comentário de topo). `lockedIds` = union de
// `shape.locked` persistido + a lista `locks` da mensagem COMPUTE_GOAL_SEEK.
function buildGoalSeekCandidates(shapes, conns, csvStore, lensPopulations, lockedIds) {
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const { out } = buildFlowGraph(shapes, conns);
  const connFromMap = {};
  for (const c of conns) {
    if (!connFromMap[c.from]) connFromMap[c.from] = [];
    connFromMap[c.from].push({ to: c.to, id: c.id, label: c.label ?? '' });
  }
  const locked = new Set([
    ...(lockedIds || []),
    ...shapes.filter(s => s.locked).map(s => s.id),
  ]);

  const candidates = [];

  // ── 1) Cineminha cells — reusa computeCinemaArrivals (mesma mecânica do Johnny) ──
  const cinemaArrivals = computeCinemaArrivals(shapes, conns, csvStore, lensPopulations);
  for (const shape of shapes) {
    if (shape.type !== 'cineminha' || locked.has(shape.id)) continue;
    const csvId = shape.rowVar?.csvId || shape.colVar?.csvId;
    const csv = csvId ? csvStore[csvId] : null;
    const varTypes = csv?.varTypes || {};
    const rowIsOrd = shape.rowVar ? varTypes[shape.rowVar.col] === 'ordinal' : false;
    const colIsOrd = shape.colVar ? varTypes[shape.colVar.col] === 'ordinal' : false;
    const rDom = shape.rowDomain?.length > 0 ? shape.rowDomain : ['*'];
    const cDom = shape.colDomain?.length > 0 ? shape.colDomain : ['*'];
    const arr = cinemaArrivals[shape.id] || {};
    const byPos = {};
    for (let ri = 0; ri < rDom.length; ri++) {
      for (let ci = 0; ci < cDom.length; ci++) {
        const cellKey = `${rDom[ri]}|${cDom[ci]}`;
        const m = arr[cellKey];
        if (!m || m.qty === 0) continue;
        const curElig = isCellEligible(shape.cells, cellKey);
        const id = `cinema:${shape.id}:${cellKey}`;
        const cand = {
          id, type: 'cinema_cell', shapeId: shape.id,
          label: `${curElig ? 'Fechar' : 'Abrir'} célula "${cellKey.replace('|', ' × ')}" em ${shape.label || 'Cineminha'}`,
          toApproved: !curElig,
          qty: m.qty, qtdAltas: m.qtdAltas, qtdAltasInfer: m.qtdAltasInfer, inadRRaw: m.inadRRaw, inadIRaw: m.inadIRaw,
          requires: [],
          apply: { type: 'cinema_cell', shapeId: shape.id, cellKey, newValue: curElig ? 0 : 1 },
        };
        candidates.push(cand);
        byPos[`${ri}|${ci}`] = cand;
      }
    }
    if (rowIsOrd || colIsOrd) {
      for (let ri = 0; ri < rDom.length; ri++) {
        for (let ci = 0; ci < cDom.length; ci++) {
          const cand = byPos[`${ri}|${ci}`];
          if (!cand) continue;
          const neighborPos = cand.toApproved
            ? [rowIsOrd ? `${ri - 1}|${ci}` : null, colIsOrd ? `${ri}|${ci - 1}` : null]
            : [rowIsOrd ? `${ri + 1}|${ci}` : null, colIsOrd ? `${ri}|${ci + 1}` : null];
          for (const np of neighborPos) {
            if (!np) continue;
            const neighbor = byPos[np];
            if (neighbor && neighbor.toApproved === cand.toApproved) cand.requires.push(neighbor.id);
          }
        }
      }
    }
  }

  // ── 2) Decision-node terminal swaps (valor cujo port resolve DIRETO a um terminal) ──
  const routes = compileRoutes(shapes, conns, out);

  // ── 3) Lens threshold — determina estruturalmente (sem dados) quais lens qualificam ──
  const lensColByShape = {};
  for (const shape of shapes) {
    if (shape.type !== 'decision_lens' || locked.has(shape.id)) continue;
    const rules = shape.rules || [];
    if (rules.length !== 1) continue;
    const rule = rules[0];
    if (!LENS_ORDINAL_OPS.has(rule.operator)) continue;
    const edge = (connFromMap[shape.id] || [])[0];
    if (!edge) continue;
    const info = resolveDirectTerminalConn(shapesMap, connFromMap, edge.to, edge.id);
    if (!info || info.terminal !== 'approved') continue; // v1: só quando o "passa" leva a Aprovado (ver comentário de topo)
    lensColByShape[shape.id] = rule.col;
  }

  const { decisionArrivals, lensColArrivals } = computeGoalSeekArrivals(shapes, conns, csvStore, lensPopulations, lensColByShape);

  for (const shape of shapes) {
    if (shape.type !== 'decision' || locked.has(shape.id)) continue;
    const csv = shape.csvId ? csvStore[shape.csvId] : null;
    if (!csv) continue;
    const isOrdinal = csv.varTypes?.[shape.variableCol] === 'ordinal';
    const routeMap = routes.decisionRoutes[shape.id];
    if (!routeMap) continue;
    const arr = decisionArrivals[shape.id] || {};
    const byIdx = {};
    let i = 0;
    for (const [val, route] of routeMap.entries()) {
      const idxHere = i++;
      if (!route || route.to == null) continue;
      const m = arr[val];
      if (!m || m.qty === 0) continue;
      const info = resolveDirectTerminalConn(shapesMap, connFromMap, route.to, route.cid);
      if (!info || info.terminal === 'as_is') continue;
      const targetTerminal = info.terminal === 'approved' ? 'rejected' : 'approved';
      const targetShape = shapes.find(s => s.type === targetTerminal);
      if (!targetShape) continue;
      const cand = {
        id: `decision:${shape.id}:${val}`, type: 'decision_terminal', shapeId: shape.id, value: val,
        label: `${shape.label || shape.variableCol} = "${val}": mover de ${GOAL_SEEK_TERMINAL_LABEL[info.terminal]} para ${GOAL_SEEK_TERMINAL_LABEL[targetTerminal]}`,
        toApproved: targetTerminal === 'approved',
        qty: m.qty, qtdAltas: m.qtdAltas, qtdAltasInfer: m.qtdAltasInfer, inadRRaw: m.inadRRaw, inadIRaw: m.inadIRaw,
        requires: [],
        apply: { type: 'decision_terminal', connId: info.connId, newTo: targetShape.id },
      };
      candidates.push(cand);
      byIdx[idxHere] = cand;
    }
    if (isOrdinal) {
      const idxs = Object.keys(byIdx).map(Number).sort((a, b) => a - b);
      for (const idx of idxs) {
        const cand = byIdx[idx];
        const neighbor = byIdx[cand.toApproved ? idx - 1 : idx + 1];
        if (neighbor && neighbor.toApproved === cand.toApproved) cand.requires.push(neighbor.id);
      }
    }
  }

  // ── Lens threshold candidates (1 passo de relax + 1 de tighten por lens elegível) ──
  for (const [lensId, colName] of Object.entries(lensColByShape)) {
    const shape = shapesMap[lensId];
    const rule = (shape.rules || [])[0];
    if (!rule) continue;
    const arr = lensColArrivals[lensId] || {};
    const distinct = Object.keys(arr)
      .map(raw => ({ raw, n: parseFloat(raw) }))
      .filter(o => !isNaN(o.n) && arr[o.raw].qty > 0)
      .sort((a, b) => a.n - b.n);
    if (distinct.length === 0) continue;
    const isUpperPass = rule.operator === 'gte' || rule.operator === 'gt';
    const passFlags = distinct.map(o => matchLensRule(String(o.n), rule.operator, rule.value));
    let relaxIdx = -1, tightenIdx = -1;
    if (isUpperPass) {
      for (let k = distinct.length - 1; k >= 0; k--) if (!passFlags[k]) { relaxIdx = k; break; }
      for (let k = 0; k < distinct.length; k++) if (passFlags[k]) { tightenIdx = k; break; }
    } else {
      for (let k = 0; k < distinct.length; k++) if (!passFlags[k]) { relaxIdx = k; break; }
      for (let k = distinct.length - 1; k >= 0; k--) if (passFlags[k]) { tightenIdx = k; break; }
    }
    const mk = (kind, idx) => {
      if (idx < 0) return null;
      const m = arr[distinct[idx].raw];
      if (!m || m.qty === 0) return null;
      const newRuleValue = computeNewLensThreshold(rule.operator, distinct, idx, kind);
      return {
        id: `lens:${lensId}:${kind}`, type: 'lens_threshold', shapeId: lensId, kind,
        label: `${kind === 'relax' ? 'Relaxar' : 'Apertar'} regra de "${shape.label || 'Decision Lens'}" (${colName} ${rule.operator} ${newRuleValue})`,
        toApproved: kind === 'relax',
        qty: m.qty, qtdAltas: m.qtdAltas, qtdAltasInfer: m.qtdAltasInfer, inadRRaw: m.inadRRaw, inadIRaw: m.inadIRaw,
        requires: [],
        apply: { type: 'lens_threshold', shapeId: lensId, ruleIndex: 0, newValue: String(newRuleValue) },
      };
    };
    const relaxCand = mk('relax', relaxIdx);
    const tightenCand = mk('tighten', tightenIdx);
    if (relaxCand) candidates.push(relaxCand);
    if (tightenCand) candidates.push(tightenCand);
  }

  return candidates;
}

// Mesma agregação de runSimulation (approvedQty/qtdAltasSum/.../inadInferidaSum), mas
// expõe os SOMATÓRIOS BRUTOS (não só as razões finais) — necessários para atualizar os
// totais incrementalmente (O(1) por movimento) durante a busca gulosa. `runSimulation`
// não expõe esses brutos e seu formato de retorno é um contrato de GATE usado por vários
// testes (compiledEngine/simulationTick/policyIR) — em vez de arriscar essa superfície,
// este é um agregador PARALELO e menor, mesmo padrão de duplicação já usado neste
// arquivo (computeCinemaArrivals/computeNodeArrivals/computeCinemaAsIsCells também
// reimplementam o walk em vez de estender uma função existente).
function computeGoalSeekBaseline(shapes, conns, csvStore) {
  const { out } = buildFlowGraph(shapes, conns);
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const TERM = new Set(['approved', 'rejected', 'as_is']);
  const portIds = new Set(shapes.filter(s => s.type === 'port').map(s => s.id));
  const decWithPortInc = new Set(conns.filter(c => portIds.has(c.from)).map(c => c.to));
  const rootNodes = shapes.filter(s =>
    (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') && !decWithPortInc.has(s.id)
  );
  const routes = compileRoutes(shapes, conns, out);
  const nodeIdx = new Map(shapes.map((s, i) => [s.id, i]));
  const lastVisit = new Int32Array(shapes.length);
  let epoch = 0;

  function resolveRow(csv, r, startId, compiled) {
    epoch++;
    let cur = startId;
    while (cur) {
      const idx = nodeIdx.get(cur);
      if (idx === undefined || lastVisit[idx] === epoch) return null;
      lastVisit[idx] = epoch;
      const node = shapesMap[cur]; if (!node) return null;
      if (TERM.has(node.type)) return node.type;
      if (node.type === 'decision') {
        const cd = compiled.decision[cur];
        let match;
        if (cd.codes) match = cd.routeByCode[cd.codes[r]];
        else {
          const val = (cd.colIdx >= 0 ? (cellStr(csv, r, cd.colIdx) ?? '') : '').trim();
          match = routes.decisionRoutes[cur]?.get(val);
        }
        if (!match) return null;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const cc = compiled.cinema[cur];
        let isEligible;
        if (cc.mode === 'code') {
          if (cc.none) return null;
          const ri = cc.rowCodes ? cc.rowCodes[r] : 0, ci = cc.colCodes ? cc.colCodes[r] : 0;
          isEligible = cc.eligByPair[ri * cc.nC + ci] === 1;
        } else {
          const rv = node.rowVar && cc.rowIdx >= 0 ? (cellStr(csv, r, cc.rowIdx) ?? '').trim() : '';
          const cv = node.colVar && cc.colIdx >= 0 ? (cellStr(csv, r, cc.colIdx) ?? '').trim() : '';
          if (!node.rowVar && !node.colVar) return null;
          isEligible = isCellEligible(node.cells, `${node.rowVar ? rv : '*'}|${node.colVar ? cv : '*'}`);
        }
        const rt = routes.cinemaRoutes[cur];
        const match = isEligible ? rt?.eligible : rt?.notEligible;
        if (!match) return null;
        cur = match.to;
      } else if (node.type === 'decision_lens') {
        const m = compiled.lens[cur]; if (m && !m(r)) return null;
        const match = routes.singleEdge[cur]; if (!match) return null; cur = match.to;
      } else if (node.type === 'port') {
        const match = routes.singleEdge[cur]; if (!match) return null; cur = match.to;
      } else return null;
    }
    return null;
  }

  let totalQty = 0, approvedQty = 0, decidedQty = 0;
  let inadRealSum = 0, qtdAltasSum = 0, inadInferidaSum = 0, qtdAltasInferSum = 0;

  for (const [csvId, csv] of Object.entries(csvStore)) {
    const types = csv.columnTypes || {};
    const colIdx = (type) => {
      const col = Object.entries(types).find(([, t]) => t === type)?.[0];
      return col ? csv.headers.indexOf(col) : -1;
    };
    const qtyIdx = colIdx('qty'), altasIdx = colIdx('qtdAltas'), altasInfIdx = colIdx('qtdAltasInfer'),
      inadRIdx = colIdx('inadReal'), inadIIdx = colIdx('inadInferida');
    const dOrigIdx = csv.headers.indexOf('__DECISAO_ORIGINAL');
    const csvRoots = rootNodes.filter(d => {
      if (d.type === 'decision')      return d.csvId === csvId;
      if (d.type === 'cineminha')     return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      if (d.type === 'decision_lens') return true;
      return false;
    });
    if (csvRoots.length === 0) continue;
    const rootId = csvRoots[0].id;
    const compiled = compileNodesForCsv(shapes, csv, routes);
    const nRows = rowCount(csv);
    for (let r = 0; r < nRows; r++) {
      const qty = qtyIdx >= 0 ? (cellNum(csv, r, qtyIdx) || 0) : 1;
      totalQty += qty;
      const res = resolveRow(csv, r, rootId, compiled);
      // "Decidido" = a linha chegou a QUALQUER terminal (approved/rejected/as_is) — i.e.
      // está DENTRO do escopo da política. Linhas que retornam null (filtradas por um
      // Decision Lens a montante, ou valor sem rota) NÃO são decididas por esta política.
      // Esse é o denominador correto da taxa de aprovação do Goal Seek: aprovados sobre a
      // população que a política de fato decide, não sobre a base inteira (ver goalSeekRatios).
      if (res != null) decidedQty += qty;
      let isApproved = res === 'approved', isRejected = res === 'rejected';
      if (res === 'as_is') {
        const orig = dOrigIdx >= 0 ? String(cellStr(csv, r, dOrigIdx) ?? '').toUpperCase() : '';
        if (orig === 'APROVADO') isApproved = true; else if (orig === 'REPROVADO') isRejected = true;
      }
      if (isApproved) {
        approvedQty += qty;
        qtdAltasSum      += altasIdx    >= 0 ? (cellNum(csv, r, altasIdx)    || 0) : 0;
        qtdAltasInferSum += altasInfIdx >= 0 ? (cellNum(csv, r, altasInfIdx) || 0) : 0;
        inadRealSum      += inadRIdx    >= 0 ? (cellNum(csv, r, inadRIdx)    || 0) : 0;
        inadInferidaSum  += inadIIdx    >= 0 ? (cellNum(csv, r, inadIIdx)    || 0) : 0;
      }
    }
  }

  return { totalQty, approvedQty, decidedQty, qtdAltasSum, qtdAltasInferSum, inadRealSum, inadInferidaSum };
}

function goalSeekRatios(raw) {
  // Denominador da taxa de aprovação = população DECIDIDA pela política (dentro do escopo),
  // não a base inteira. Numa política parcial (atrás de um Decision Lens que restringe a
  // sub-população — ex.: só certas safras/ADABAS), a base inteira dilui a taxa a ponto de
  // torná-la ininteligível (ex.: 3,35% quando a política aprova 72,8% do que decide). Fallback
  // para totalQty quando decidedQty não foi computado (mantém retrocompat de qualquer chamador).
  const decided = (typeof raw.decidedQty === 'number') ? raw.decidedQty : raw.totalQty;
  return {
    approvalRate: decided > 0 ? (raw.approvedQty / decided) * 100 : 0,
    inadReal:     raw.qtdAltasSum      > 0 ? raw.inadRealSum     / raw.qtdAltasSum      : null,
    inadInferida: raw.qtdAltasInferSum > 0 ? raw.inadInferidaSum / raw.qtdAltasInferSum
                : raw.approvedQty      > 0 ? raw.inadInferidaSum / raw.approvedQty      : null,
    approvedAltasInfer: raw.qtdAltasInferSum,
  };
}

const GOAL_SEEK_TARGETS = new Set(['approvalRate', 'inadReal', 'inadInferida', 'approvedAltasInfer']);

// COMPUTE_GOAL_SEEK — busca gulosa com precedência sobre o catálogo de movimentos.
// goal: {target, direction:'increase'|'decrease', magnitude:number|null, minimize?}
// constraints: {maxInadReal?:number, maxInadInf?:number} (tetos, ratio 0–1; null/ausente = sem teto)
// locks: string[] (shapeIds travados, além de shape.locked persistido no canvas)
function computeGoalSeek(shapes, conns, csvStore, goal, constraints, locks, lensPopulations) {
  const g = goal || {};
  const target = GOAL_SEEK_TARGETS.has(g.target) ? g.target : 'approvalRate';
  const direction = g.direction === 'decrease' ? 'decrease' : 'increase';
  const magnitude = (typeof g.magnitude === 'number' && isFinite(g.magnitude)) ? g.magnitude : null;
  const minimizeField = g.minimize === 'inadReal' ? 'inadReal' : 'inadInferida';
  const cons = constraints || {};
  const maxInadReal = (typeof cons.maxInadReal === 'number') ? cons.maxInadReal : null;
  const maxInadInf  = (typeof cons.maxInadInf  === 'number') ? cons.maxInadInf  : null;

  const rawBaseline = computeGoalSeekBaseline(shapes, conns, csvStore);
  const baseline = goalSeekRatios(rawBaseline);

  const wantsApproved = direction === 'increase';
  const allCandidates = buildGoalSeekCandidates(shapes, conns, csvStore, lensPopulations, locks);
  const pool = allCandidates.filter(c => c.toApproved === wantsApproved);
  const candById = Object.fromEntries(pool.map(c => [c.id, c]));

  // Suavização bayesiana (padrão Johnny/SHRINK_K): evita que um movimento de baixo
  // volume (ruído amostral) fure a fila por inadimplência aparentemente extrema.
  let poolRaw = 0, poolDen = 0, poolQty = 0;
  for (const c of pool) {
    poolQty += c.qty;
    if (minimizeField === 'inadReal') { poolRaw += c.inadRRaw; poolDen += c.qtdAltas; }
    else { poolRaw += c.inadIRaw; poolDen += (c.qtdAltasInfer > 0 ? c.qtdAltasInfer : c.qty); }
  }
  const poolAvg = poolDen > 0 ? poolRaw / poolDen : 0;
  const SHRINK_K = Math.max(1, (poolQty / Math.max(1, pool.length)) * 0.1);
  const smoothed = (c) => minimizeField === 'inadReal'
    ? ((c.inadRRaw || 0) + poolAvg * SHRINK_K) / ((c.qtdAltas || 0) + SHRINK_K)
    : ((c.inadIRaw || 0) + poolAvg * SHRINK_K) / ((c.qtdAltasInfer > 0 ? c.qtdAltasInfer : c.qty || 0) + SHRINK_K);

  const remaining = {}, dependents = {};
  for (const c of pool) { remaining[c.id] = 0; dependents[c.id] = []; }
  for (const c of pool) {
    for (const reqId of c.requires) {
      if (!candById[reqId]) continue; // não está neste pool (já satisfeito/direção oposta) — vácuo
      remaining[c.id]++;
      dependents[reqId].push(c.id);
    }
  }
  const liberated = new Set(pool.filter(c => remaining[c.id] === 0).map(c => c.id));

  let running = { ...rawBaseline };
  const frontier = [{ ...goalSeekRatios(running), approvedQty: running.approvedQty, totalQty: running.totalQty, move: null }];
  const moves = [];
  let bindingConstraint = null;

  const initialTargetVal = goalSeekRatios(running)[target];
  const isReached = () => {
    if (magnitude === null) return false;
    const cur = goalSeekRatios(running)[target];
    if (cur === null || initialTargetVal === null) return false;
    const goalAbs = direction === 'increase' ? initialTargetVal + magnitude : initialTargetVal - magnitude;
    return direction === 'increase' ? cur >= goalAbs : cur <= goalAbs;
  };

  const sign = wantsApproved ? 1 : -1;
  const applyDelta = (c) => ({
    totalQty: running.totalQty,
    // Abrir/fechar célula de Cineminha ou trocar terminal de um segmento de losango NÃO
    // muda o tamanho da população decidida (a linha já estava no escopo — só troca de
    // aprovado↔reprovado). Já relaxar/apertar um Decision Lens ADMITE/REMOVE linhas do
    // escopo (a saída do lens vai direto pra Aprovado — ver buildGoalSeekCandidates), então
    // o denominador (decididos) acompanha o numerador (aprovados) no mesmo sinal.
    decidedQty: running.decidedQty + (c.type === 'lens_threshold' ? sign * c.qty : 0),
    approvedQty: running.approvedQty + sign * c.qty,
    qtdAltasSum: running.qtdAltasSum + sign * c.qtdAltas,
    qtdAltasInferSum: running.qtdAltasInferSum + sign * c.qtdAltasInfer,
    inadRealSum: running.inadRealSum + sign * c.inadRRaw,
    inadInferidaSum: running.inadInferidaSum + sign * c.inadIRaw,
  });

  while (!isReached()) {
    const ordered = [...liberated].map(id => candById[id]).sort((a, b) => {
      const sa = smoothed(a), sb = smoothed(b);
      const diff = wantsApproved ? sa - sb : sb - sa;
      if (diff !== 0) return diff;
      if (b.qty !== a.qty) return b.qty - a.qty;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    let chosen = null, rejectedReason = null;
    for (const c of ordered) {
      const nextRaw = applyDelta(c);
      const nextRatios = goalSeekRatios(nextRaw);
      const breachReal = maxInadReal != null && nextRatios.inadReal != null && nextRatios.inadReal > maxInadReal;
      const breachInf  = maxInadInf  != null && nextRatios.inadInferida != null && nextRatios.inadInferida > maxInadInf;
      if (breachReal || breachInf) {
        if (!rejectedReason) rejectedReason = breachReal ? 'maxInadReal' : 'maxInadInf';
        continue;
      }
      chosen = { cand: c, nextRaw };
      break;
    }
    if (!chosen) {
      bindingConstraint = ordered.length === 0 ? 'no_more_moves' : (rejectedReason || 'no_more_moves');
      break;
    }
    const { cand, nextRaw } = chosen;
    const prevRatios = goalSeekRatios(running);
    running = nextRaw;
    liberated.delete(cand.id);
    for (const depId of dependents[cand.id]) { remaining[depId]--; if (remaining[depId] === 0) liberated.add(depId); }
    moves.push({
      id: cand.id, type: cand.type, shapeId: cand.shapeId, label: cand.label,
      qty: cand.qty, qtdAltas: cand.qtdAltas, qtdAltasInfer: cand.qtdAltasInfer,
      inadRRaw: cand.inadRRaw, inadIRaw: cand.inadIRaw,
      deltaApprovalRate: goalSeekRatios(running).approvalRate - prevRatios.approvalRate,
      apply: cand.apply,
    });
    frontier.push({ ...goalSeekRatios(running), approvedQty: running.approvedQty, totalQty: running.totalQty, move: cand.id });
  }

  const goalReached = magnitude === null ? moves.length > 0 : isReached();

  // ── Validação final por re-simulação (DEC-IA-005) ──────────────────────────────
  const { shapes: patchedShapes, conns: patchedConns } = applyGoalSeekMoves(shapes, conns, moves.map(m => m.apply));
  const validated = runSimulation(patchedShapes, patchedConns, csvStore);

  // Taxa de aprovação do resultado no MESMO escopo do baseline (aprovados sobre a população
  // decidida = approved + rejected + as_is residual), não sobre a base inteira que
  // `runSimulation` usa. Sem escopo, políticas parciais reportam taxas diluídas (ex.: 3,5%)
  // que não conversam com o baseline (3,35%) nem com o Dashboard (~73%). Os demais campos
  // (inadReal/inadInferida) já são intrinsecamente escopados à população aprovada.
  const validatedDecided = validated.approvedQty + validated.rejectedQty + validated.asIsQty;

  return {
    goal: { target, direction, magnitude, minimize: minimizeField },
    baseline,
    frontier,
    moves,
    goalReached,
    bindingConstraint,
    result: {
      approvalRate: validatedDecided > 0 ? (validated.approvedQty / validatedDecided) * 100 : 0,
      inadReal: validated.inadReal,
      inadInferida: validated.inadInferida,
      approvedQty: validated.approvedQty,
      totalQty: validated.totalQty,
      approvedAltasInfer: running.qtdAltasInferSum,
    },
  };
}

// ── Analytics dataset (Analytics Workspace) ───────────────────────────────────
// Emits the canonical wide dataset (DEC-AW-003): one row per CSV grouping, with
// the original dimensions + intrinsic metrics + one decision column per scenario.
const ANALYTICS_METRIC_TYPES = new Set(['qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida', 'mixRisco']);

// Overlay (decisão simulada por csvId+rowIdx) de um canvas, memoizado por hash de
// shapes/conns + versão do csvStore (5B — evita reprocessar canvases intocados).
function cachedCanvasOverlay(canvasId, shapes, conns, csvStore) {
  // Chave barata (M2): NÃO stringifica populações de lens (Array<boolean> de ~1MM posições
  // por lens → ~5-6MB de string temporária por lens, por canvas, a cada tick do Dashboard).
  // As populações são 100% derivadas das regras dos shapes decision_lens (já embutidas em
  // `shapes`) + a base (versionada por `csvStoreVersion`), então shapes + conns + versão já
  // determinam o overlay unicamente — incluir as populações na chave era redundante e caro.
  const key = csvStoreVersion + '|' + JSON.stringify(shapes) + '|' + JSON.stringify(conns);
  const hit = analyticsOverlayCache[canvasId];
  if (hit && hit.key === key) return hit.overlay;
  // M10: as populações de lens vêm das regras dos shapes (não mais da main). Só derivadas
  // aqui no cache miss (canvas de fato editado), evitando a varredura em canvases intocados.
  const { populations } = computeLensPopulations(shapes, csvStore);
  const overlay = computeSimulatedDecisions(shapes, conns, csvStore, populations);
  analyticsOverlayCache[canvasId] = { key, overlay };
  return overlay;
}

// Campos numéricos (métricas intrínsecas) do dataset largo — viram Float64Array.
const ANALYTICS_NUM_FIELDS = ['qty', 'qtdAltas', 'inadRRaw', 'qtdAltasInfer', 'inadIRaw'];

// Dataset analítico largo (DEC-AW-003) com N cenários (DEC-AW-004/007), em formato
// COLUNAR (otimização de memória — Fase 4). Em vez de materializar 1 objeto por linha
// (~1MM numa base diária, clonado inteiro pra main thread e re-copiado a cada
// agrupamento — fonte de OOM ao abrir a aba Dashboard), emite:
//   { rowCount, columns: {[nome]: ColDef}, dimensions, temporalColumns, metrics, scenarios }
// ColDef: dimensões/decisões → dictionary encoding { kind:'dict', dict, codes:Int32Array };
//         métricas → { kind:'num', data:Float64Array }. Os ArrayBuffers das colunas são
// TRANSFERIDOS pra main (zero-cópia, sem depender de crossOriginIsolated) — ver o handler
// de COMPUTE_ANALYTICS_DATASET. A main lê tudo por accessor (awColStr/awColNum), sem nunca
// reconstruir objetos por-linha.
// canvasInputs: [{id, nome, shapes, conns}] — uma aba marcada por cenário. As populações
// de lens são derivadas no worker a partir das regras dos shapes (M10), não vêm da main.
// Métricas intrínsecas vêm do agrupamento (uma vez); cada canvas emite sua coluna de decisão,
// unidas por (csvId, rowIdx) — datasets compartilhados ⇒ agrupamentos idênticos entre cenários.
function computeAnalyticsDataset(canvasInputs, csvStore) {
  const inputs = Array.isArray(canvasInputs) ? canvasInputs : [];

  // Poda entradas de canvases que não estão mais marcados (evita crescimento do cache).
  const liveIds = new Set(inputs.map(ci => ci.id));
  for (const k of Object.keys(analyticsOverlayCache)) if (!liveIds.has(k)) delete analyticsOverlayCache[k];

  const canvasScenarios = inputs.map(ci => ({
    id: ci.id,
    nome: ci.nome,
    decisionCol: `__DECISAO_${ci.id}`,
    overlay: cachedCanvasOverlay(ci.id, ci.shapes, ci.conns, csvStore),
  }));

  // ── Passo 1: união de dimensões + total de linhas (barato — só headers/tipos) ──
  const dimensionSet = new Set();
  const temporalSet = new Set();
  const csvList = [];
  let totalN = 0;
  for (const [csvId, csv] of Object.entries(csvStore)) {
    const dOrigIdx = csv.headers.indexOf('__DECISAO_ORIGINAL');
    if (dOrigIdx < 0) continue; // só datasets com AS IS configurado são analíticos
    const types = csv.columnTypes || {};
    const dimCols = csv.headers.filter(h =>
      h !== '__DECISAO_ORIGINAL' && !ANALYTICS_METRIC_TYPES.has(types[h] ?? '')
    );
    for (const h of dimCols) {
      dimensionSet.add(h);
      if ((types[h] ?? '') === 'temporal') temporalSet.add(h);
    }
    const n = rowCount(csv);
    csvList.push({ csvId, csv, dOrigIdx, types, dimCols, n });
    totalN += n;
  }
  if (totalN === 0) return null;

  const dimNames = [...dimensionSet];
  const decisionColNames = ['__DECISAO_AS_IS', ...canvasScenarios.map(cs => cs.decisionCol)];

  // ── Passo 2: aloca colunas e preenche por índice global ──
  const numData = {};
  for (const f of ANALYTICS_NUM_FIELDS) numData[f] = new Float64Array(totalN);
  const enc = {}; // dict encoders: nome → {dict, dictIndex:Map, codes:Int32Array}
  for (const name of [...dimNames, ...decisionColNames]) {
    enc[name] = { dict: [], dictIndex: new Map(), codes: new Int32Array(totalN) };
  }
  // codeFor: resolve (e registra, se novo) o código de destino de um valor no
  // dicionário de uma coluna do dataset largo — O(distintos), nunca por linha.
  const codeFor = (name, val) => {
    const e = enc[name];
    let c = e.dictIndex.get(val);
    if (c === undefined) { c = e.dict.length; e.dict.push(val); e.dictIndex.set(val, c); }
    return c;
  };
  const putCode = (name, w, val) => { enc[name].codes[w] = codeFor(name, val); };

  let w = 0;
  for (const { csvId, csv, dOrigIdx, types, dimCols, n } of csvList) {
    const getIdx = (type) => {
      const col = Object.entries(types).find(([, t]) => t === type)?.[0];
      return col != null ? csv.headers.indexOf(col) : -1;
    };
    const qtyIdx        = getIdx('qty');
    const altasIdx      = getIdx('qtdAltas');
    const altasInferIdx = getIdx('qtdAltasInfer');
    const inadRIdx      = getIdx('inadReal');
    const inadIIdx      = getIdx('inadInferida');
    const dimIdxMap = {};
    for (const h of dimCols) dimIdxMap[h] = csv.headers.indexOf(h);

    // M15 — tradução código→código: a base já é dict-encoded (Fase 1), então
    // re-hashear `cellStr(...)` por linha por dimensão é redundante — o número de
    // valores distintos é pequeno. Pré-resolve, uma vez por csv×dimensão (O(distintos)),
    // um `Int32Array` que traduz o código de origem (dicionário da própria base) para o
    // código de destino (dicionário do dataset largo); no loop de linhas resta uma leitura
    // de inteiro. Dimensão ausente nesta base ⇒ mesmo código constante em todas as linhas.
    // `Object.create(null)`: sem protótipo, então `h in dimConst` nunca confunde uma
    // dimensão chamada 'constructor'/'toString'/etc. com uma entrada herdada de Object.prototype.
    const dimTranslate = Object.create(null);
    const dimConst = Object.create(null);
    for (const h of dimNames) {
      const ci = dimIdxMap[h]; // undefined ⇒ dimensão ausente nesta base (não é -1: só existe se h ∈ dimCols)
      const srcCol = (ci !== undefined && isColumnar(csv)) ? csv.columns[h] : null;
      if (srcCol && srcCol.kind === 'dict') {
        const t = new Int32Array(srcCol.dict.length);
        for (let sc = 0; sc < srcCol.dict.length; sc++) t[sc] = codeFor(h, srcCol.dict[sc]);
        dimTranslate[h] = t;
      } else if (ci === undefined) {
        dimConst[h] = codeFor(h, '');
      }
      // senão: coluna existe mas não é dict-encoded (legado `rows: string[][]`) →
      // cai no fallback `cellStr` por linha, mais abaixo.
    }

    // Mesma ideia para as colunas de decisão: __DECISAO_ORIGINAL já é dict-encoded,
    // então a tradução AS IS e a de cada cenário (a partir do overlay tipado — M2)
    // também viram Int32Array resolvidos uma vez, não por linha.
    const asIsCol = isColumnar(csv) ? csv.columns['__DECISAO_ORIGINAL'] : null;
    let asIsTranslate = null;
    const csScenarios = canvasScenarios.map(cs => ({ ...cs, aprovadoCode: null, reprovadoCode: null, decTranslate: null }));
    if (asIsCol && asIsCol.kind === 'dict') {
      asIsTranslate = new Int32Array(asIsCol.dict.length);
      for (let sc = 0; sc < asIsCol.dict.length; sc++) asIsTranslate[sc] = codeFor('__DECISAO_AS_IS', asIsCol.dict[sc]);
      for (const cs of csScenarios) {
        cs.aprovadoCode = codeFor(cs.decisionCol, 'APROVADO');
        cs.reprovadoCode = codeFor(cs.decisionCol, 'REPROVADO');
        cs.decTranslate = new Int32Array(asIsCol.dict.length);
        for (let sc = 0; sc < asIsCol.dict.length; sc++) cs.decTranslate[sc] = codeFor(cs.decisionCol, asIsCol.dict[sc]);
      }
    }

    for (let rowIdx = 0; rowIdx < n; rowIdx++, w++) {
      for (const h of dimNames) {
        const t = dimTranslate[h];
        if (t) enc[h].codes[w] = t[csv.columns[h].codes[rowIdx]];
        else if (h in dimConst) enc[h].codes[w] = dimConst[h];
        else putCode(h, w, cellStr(csv, rowIdx, dimIdxMap[h]) ?? '');
      }
      numData.qty[w]      = qtyIdx   >= 0 ? (cellNum(csv, rowIdx, qtyIdx)   || 0) : 1;
      numData.qtdAltas[w] = altasIdx >= 0 ? (cellNum(csv, rowIdx, altasIdx) || 0) : 0;
      numData.inadRRaw[w] = inadRIdx >= 0 ? (cellNum(csv, rowIdx, inadRIdx) || 0) : 0;
      numData.qtdAltasInfer[w] = altasInferIdx >= 0 ? (cellNum(csv, rowIdx, altasInferIdx) || 0) : 0;
      numData.inadIRaw[w]      = inadIIdx      >= 0 ? (cellNum(csv, rowIdx, inadIIdx)      || 0) : 0;
      // Join por (csvId, rowIdx): cada canvas marcado contribui sua coluna de decisão.
      // Overlay tipado (M2): lê o código da linha e decodifica (DEC_SAME → própria AS IS).
      if (asIsTranslate) {
        const dOrigCode = asIsCol.codes[rowIdx];
        enc['__DECISAO_AS_IS'].codes[w] = asIsTranslate[dOrigCode];
        for (const cs of csScenarios) {
          const simCodes = cs.overlay?.[csvId]?.sim;
          const sc = simCodes ? simCodes[rowIdx] : DEC_SAME;
          enc[cs.decisionCol].codes[w] = sc === DEC_APROVADO ? cs.aprovadoCode
            : sc === DEC_REPROVADO ? cs.reprovadoCode
            : cs.decTranslate[dOrigCode];
        }
      } else {
        // Legado (`rows: string[][]`, sem dict-encoding) — mesma semântica, por linha.
        const asIs = cellStr(csv, rowIdx, dOrigIdx) ?? '';
        putCode('__DECISAO_AS_IS', w, asIs);
        for (const cs of canvasScenarios) {
          const simCodes = cs.overlay?.[csvId]?.sim;
          putCode(cs.decisionCol, w, simCodes ? decodeSimDecision(simCodes[rowIdx], asIs) : asIs);
        }
      }
    }
  }

  const columns = {};
  for (const name of [...dimNames, ...decisionColNames]) {
    columns[name] = { kind: 'dict', dict: enc[name].dict, codes: enc[name].codes };
  }
  for (const f of ANALYTICS_NUM_FIELDS) columns[f] = { kind: 'num', data: numData[f] };

  return {
    rowCount: totalN,
    columns,
    dimensions: dimNames,
    temporalColumns: [...temporalSet],
    metrics: [
      { id: 'approvalRate', label: 'Taxa de Aprovação', unit: 'pct' },
      { id: 'inadReal',     label: 'Inad. Real',        unit: 'pct' },
      { id: 'inadInferida', label: 'Inad. Inferida',    unit: 'pct' },
      { id: 'qty',          label: 'Vol. Propostas',    unit: 'qty' },
      { id: 'approvedQty',  label: 'Vol. Aprovado',     unit: 'qty' },
      { id: 'approvedAltasInfer', label: 'Vol. Vendas Inferidas', unit: 'qty' },
    ],
    scenarios: [
      { id: 'as_is', nome: 'AS IS', decisionCol: '__DECISAO_AS_IS' },
      ...canvasScenarios.map(cs => ({ id: cs.id, nome: cs.nome, decisionCol: cs.decisionCol })),
    ],
  };
}

// ── COMPUTE_VARIABLE_RANKING — Copiloto Sessão 3 (sugestão de próximo nó) ────────
// Dado um "anchor" (tipicamente uma porta solta selecionada pelo usuário), ranqueia as
// variáveis candidatas (colunas tipadas Filtro) pelo poder discriminante sobre a
// população que EFETIVAMENTE chega ao anchor — mesmo walk compilado do M8 usado por
// computeNodeArrivals/computeCinemaArrivals (roteamento por código do dicionário),
// generalizado para detectar a chegada a UM nó qualquer (não só cineminha).
//
// Métricas por candidata: Information Value (IV/WoE) contra inadimplência (real, com
// fallback pra inferida quando a base não tem altas reais na população) + variância
// ponderada (sempre calculável, usada quando o IV não pode ser — sem bads ou sem goods
// na população) + razão max/min entre as taxas dos valores.
//
// Detecção de interação: para os top candidatos por IV, compara o IV conjunto (bins =
// par de valores) contra a soma dos IVs individuais — IV(A×B) >> IV(A)+IV(B) sugere
// Cineminha em vez de dois losangos em série.
//
// Autocompletar de terminal: taxa de inad. do segmento (população do anchor) vs. a
// taxa média do dataset inteiro sugere ✅ Aprovado / ❌ Reprovado / ⟳ AS IS (sem sinal).
//
// Candidatos EXCLUEM variáveis já testadas em algum ancestral do anchor (losango ou
// eixo de Cineminha) — mesmo espírito da regra de redundância do lint (Sessão 1,
// duplicate_variable_path). Ranking é on-demand (1 mensagem por seleção), não a cada
// tick — não entra no cache do getTickResult.

const IV_EPS = 0.5;              // Laplace smoothing só no bin com good OU bad zerado
const INTERACTION_RATIO = 1.25;      // IV conjunto precisa ser >= 1.25× a soma dos IVs
const INTERACTION_MIN_GAP = 0.01;    // ...E o ganho absoluto precisa ser relevante
const INTERACTION_MIN_ABS_IV = 0.05; // quando a soma dos IVs é ~0, usa piso absoluto
const SEGMENT_LOW_RATIO = 0.8;       // segmento com inad. <= 80% da média → Aprovado
const SEGMENT_HIGH_RATIO = 1.2;      // segmento com inad. >= 120% da média → Reprovado
const MAX_INTERACTION_CANDIDATES = 4;
const MAX_INTERACTION_PAIR_BINS = 4096;

// IV clássico de crédito: bins = [{altas, maus}] (altas = convertidos/denominador,
// maus = inadimplentes/numerador). good = altas-maus (clamp >= 0), bad = maus. Retorna
// null quando não há bads OU não há goods na população inteira (sem separação
// possível — nenhuma fórmula de IV se aplica). Épsilon de Laplace só no bin cujo good
// OU bad é zero: não distorce o cálculo quando não há bins zerados (valor de controle
// do GATE bate exato com a fórmula "de livro").
function computeIV(bins) {
  let totalGood = 0, totalBad = 0;
  for (const b of bins) { totalGood += Math.max(0, b.altas - b.maus); totalBad += b.maus; }
  if (totalGood <= 0 || totalBad <= 0) return null;
  let iv = 0;
  for (const b of bins) {
    let good = Math.max(0, b.altas - b.maus), bad = b.maus;
    if (good === 0 || bad === 0) { good += IV_EPS; bad += IV_EPS; }
    const distGood = good / totalGood, distBad = bad / totalBad;
    iv += (distGood - distBad) * Math.log(distGood / distBad);
  }
  return iv;
}

// Variância ponderada (peso = altas) da taxa de inad. entre os bins — alternativa mais
// simples ao IV (Proposta/épico), sempre calculável mesmo quando o IV não pode ser
// (ex.: população 100% boa ou 100% má, sem contraste bom/mau para a fórmula de WoE).
function weightedVariance(bins) {
  let totalAltas = 0, totalMaus = 0;
  for (const b of bins) { totalAltas += b.altas; totalMaus += b.maus; }
  if (totalAltas <= 0) return null;
  const mean = totalMaus / totalAltas;
  let acc = 0;
  for (const b of bins) {
    if (b.altas <= 0) continue;
    const rate = b.maus / b.altas;
    acc += b.altas * (rate - mean) * (rate - mean);
  }
  return acc / totalAltas;
}

// Razão entre a maior e a menor taxa de inad. entre os bins com volume — a alternativa
// "mais simples" citada no épico (variância ou razão max/min).
function maxMinRatio(bins) {
  const rates = bins.filter(b => b.altas > 0).map(b => b.maus / b.altas);
  if (rates.length < 2) return null;
  const min = Math.min(...rates), max = Math.max(...rates);
  if (min <= 0) return max > 0 ? Infinity : null;
  return max / min;
}

// Lê qty/altas/maus (real) + altasInfer/inadIRaw (inferida, via colunas) de UMA linha —
// mesma leitura usada em runSimulation/computeCinemaArrivals.
function readRowNums(csv, r, idxs) {
  const { qtyIdx, altasIdx, altasInferIdx, inadRIdx, inadIIdx } = idxs;
  const qty   = qtyIdx   >= 0 ? (cellNum(csv, r, qtyIdx)   || 0) : 1;
  const altas = altasIdx >= 0 ? (cellNum(csv, r, altasIdx) || 0) : 0;
  const maus  = inadRIdx >= 0 ? (cellNum(csv, r, inadRIdx) || 0) : 0;
  const altasInfer = altasInferIdx >= 0 ? (cellNum(csv, r, altasInferIdx) || 0) : 0;
  const inadIRaw   = inadIIdx      >= 0 ? (cellNum(csv, r, inadIIdx)      || 0) : 0;
  return { qty, altas, maus, altasInfer, inadIRaw };
}

// Coder de uma coluna candidata: 'code' (dict-encoded, O(distintos) na agregação —
// caminho de produção) ou 'row' (base legada string[][]/coluna não dict-encoded —
// caminho por-linha, mesmo fallback do M8 em compileDecisionNode/compileCinemaNode).
function candidateCoder(csv, colIdx) {
  const col = dictColAt(csv, colIdx);
  if (col) return { mode: 'code', codes: col.codes, dict: trimmedDictVals(col.dict) };
  return { mode: 'row', colIdx };
}

function candidateKeyOf(coder, csv, r) {
  return coder.mode === 'code' ? coder.codes[r] : (cellStr(csv, r, coder.colIdx) ?? '').toString().trim();
}

function computeVariableRanking(shapes, conns, csvStore, anchorNodeId) {
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const anchor = shapesMap[anchorNodeId];
  if (!anchor) return { nodeId: anchorNodeId, error: 'anchor_not_found' };

  const { out, inc } = buildFlowGraph(shapes, conns);

  // Variáveis já testadas em algum ancestral do anchor (losango/eixo de Cineminha) —
  // excluídas dos candidatos (mesmo espírito da regra 6 do lint, duplicate_variable_path).
  const usedCols = new Set();
  {
    const seen = new Set([anchorNodeId]);
    const stack = (inc[anchorNodeId] || []).map(e => e.from);
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const node = shapesMap[id];
      if (node) {
        if (node.type === 'decision' && node.variableCol) usedCols.add(`${node.csvId}::${node.variableCol}`);
        if (node.type === 'cineminha') {
          if (node.rowVar) usedCols.add(`${node.rowVar.csvId}::${node.rowVar.col}`);
          if (node.colVar) usedCols.add(`${node.colVar.csvId}::${node.colVar.col}`);
        }
      }
      for (const e of (inc[id] || [])) if (!seen.has(e.from)) stack.push(e.from);
    }
  }

  // Raízes por csv — MESMO critério de computeNodeArrivals (TODAS as raízes; exclui
  // nós logo abaixo de um Decision Lens), porque o que importa aqui é "quem chega ao
  // anchor", não a aproximação de raiz única usada pelo funil de runSimulation.
  const EMIT = new Set(['port', 'decision_lens', 'decision', 'cineminha']);
  const nonRoot = new Set(conns.filter(c => EMIT.has(shapesMap[c.from]?.type)).map(c => c.to));
  const rootNodes = shapes.filter(s =>
    (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') && !nonRoot.has(s.id)
  );

  const routes = compileRoutes(shapes, conns, out);
  const { decisionRoutes, cinemaRoutes, singleEdge } = routes;
  const nodeIdx = new Map(shapes.map((s, i) => [s.id, i]));
  const TERM = new Set(['approved', 'rejected', 'as_is']);

  // Walk compilado (M8) generalizado: em vez de coletar hits só em cineminhas-alvo
  // (computeCinemaArrivals/computeCinemaAsIsCells), devolve se a linha passa por UM
  // nó qualquer (o anchor, tipicamente uma porta) — mesma técnica de "visited" por
  // época reutilizado entre linhas/raízes.
  function reachesAnchor(csv, r, startId, compiled, lastVisit, epoch) {
    let cur = startId;
    while (cur) {
      const idx = nodeIdx.get(cur);
      if (idx === undefined || lastVisit[idx] === epoch) break;
      lastVisit[idx] = epoch;
      if (cur === anchorNodeId) return true;
      const node = shapesMap[cur];
      if (!node) break;
      if (TERM.has(node.type)) break;
      if (node.type === 'decision') {
        const cd = compiled.decision[cur];
        let match;
        if (cd.codes) match = cd.routeByCode[cd.codes[r]];
        else {
          const val = (cd.colIdx >= 0 ? (cellStr(csv, r, cd.colIdx) ?? '') : '').trim();
          match = decisionRoutes[cur]?.get(val);
        }
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const cc = compiled.cinema[cur];
        let isEligible;
        if (cc.mode === 'code') {
          if (cc.none) break;
          const ri = cc.rowCodes ? cc.rowCodes[r] : 0;
          const ci = cc.colCodes ? cc.colCodes[r] : 0;
          isEligible = cc.eligByPair[ri * cc.nC + ci] === 1;
        } else {
          const rv = node.rowVar && cc.rowIdx >= 0 ? (cellStr(csv, r, cc.rowIdx) ?? '').trim() : '';
          const cv = node.colVar && cc.colIdx >= 0 ? (cellStr(csv, r, cc.colIdx) ?? '').trim() : '';
          if (!node.rowVar && !node.colVar) break;
          const rKey = node.rowVar ? rv : '*';
          const cKey = node.colVar ? cv : '*';
          isEligible = isCellEligible(node.cells, `${rKey}|${cKey}`);
        }
        const rt = cinemaRoutes[cur];
        const match = isEligible ? rt?.eligible : rt?.notEligible;
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'decision_lens') {
        const m = compiled.lens[cur];
        if (m && !m(r)) break;
        const match = singleEdge[cur];
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'port') {
        const match = singleEdge[cur];
        if (!match) break;
        cur = match.to;
      } else break;
    }
    return false;
  }

  let winner = null;
  const perCsv = {};

  for (const [csvId, csv] of Object.entries(csvStore)) {
    const types = csv.columnTypes || {};
    const getColIdx = (type) => {
      const col = Object.entries(types).find(([, t]) => t === type)?.[0];
      return col ? csv.headers.indexOf(col) : -1;
    };
    const idxs = {
      qtyIdx: getColIdx('qty'), altasIdx: getColIdx('qtdAltas'), altasInferIdx: getColIdx('qtdAltasInfer'),
      inadRIdx: getColIdx('inadReal'), inadIIdx: getColIdx('inadInferida'),
    };

    const candidateCols = Object.entries(types)
      .filter(([col, t]) => t === 'decision' && !usedCols.has(`${csvId}::${col}`))
      .map(([col]) => col);
    const candidateCoders = candidateCols.map(col => candidateCoder(csv, csv.headers.indexOf(col)));

    const csvRoots = rootNodes.filter(d => {
      if (d.type === 'decision')      return d.csvId === csvId;
      if (d.type === 'cineminha')     return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      if (d.type === 'decision_lens') return true;
      return false;
    });

    const baseReal  = { altas: 0, maus: 0 };
    const baseInfer = { altasInfer: 0, inadIRaw: 0 };
    const segReal   = { qty: 0, altas: 0, maus: 0 };
    const segInfer  = { altasInfer: 0, inadIRaw: 0 };
    const candBins  = candidateCols.map(() => new Map()); // key(código|string) -> {qty,altas,maus,altasInfer,inadIRaw}
    const hitRows   = [];

    const nRows = rowCount(csv);
    let lastVisit = null, compiled = null;
    if (csvRoots.length > 0) {
      lastVisit = new Int32Array(shapes.length);
      compiled = compileNodesForCsv(shapes, csv, routes);
    }
    let epoch = 0;

    for (let r = 0; r < nRows; r++) {
      const nums = readRowNums(csv, r, idxs);
      baseReal.altas += nums.altas; baseReal.maus += nums.maus;
      baseInfer.altasInfer += nums.altasInfer; baseInfer.inadIRaw += nums.inadIRaw;

      if (!compiled) continue; // csv sem raiz alcançando este anchor
      let hit = false;
      for (const root of csvRoots) {
        epoch++;
        if (reachesAnchor(csv, r, root.id, compiled, lastVisit, epoch)) { hit = true; break; }
      }
      if (!hit) continue;

      hitRows.push(r);
      segReal.qty += nums.qty; segReal.altas += nums.altas; segReal.maus += nums.maus;
      segInfer.altasInfer += nums.altasInfer; segInfer.inadIRaw += nums.inadIRaw;

      for (let ci = 0; ci < candidateCoders.length; ci++) {
        const key = candidateKeyOf(candidateCoders[ci], csv, r);
        const map = candBins[ci];
        let bin = map.get(key);
        if (!bin) { bin = { qty: 0, altas: 0, maus: 0, altasInfer: 0, inadIRaw: 0 }; map.set(key, bin); }
        bin.qty += nums.qty; bin.altas += nums.altas; bin.maus += nums.maus;
        bin.altasInfer += nums.altasInfer; bin.inadIRaw += nums.inadIRaw;
      }
    }

    const entry = {
      csvId, csv, idxs, candidateCols, candidateCoders, candBins,
      baseReal, baseInfer, segReal, segInfer, hitRows,
    };
    perCsv[csvId] = entry;
    if (!winner || entry.segReal.qty > winner.segReal.qty) winner = entry;
  }

  if (!winner || winner.hitRows.length === 0) {
    return { nodeId: anchorNodeId, error: 'no_population' };
  }

  const metric = winner.segReal.altas > 0 ? 'real' : (winner.segInfer.altasInfer > 0 ? 'inferida' : null);

  const ranking = winner.candidateCols.map((col, ci) => {
    const coder = winner.candidateCoders[ci];
    const bins = [...winner.candBins[ci].entries()].map(([key, b]) => {
      const value = coder.mode === 'code' ? coder.dict[key] : key;
      const altas = metric === 'inferida' ? b.altasInfer : b.altas;
      const maus  = metric === 'inferida' ? b.inadIRaw   : b.maus;
      return { value, qty: b.qty, altas, maus, rate: altas > 0 ? maus / altas : null };
    }).filter(b => b.qty > 0)
      .sort((a, b) => String(a.value).localeCompare(String(b.value), 'pt-BR'));

    const iv = metric ? computeIV(bins) : null;
    const variance = weightedVariance(bins);
    const ratio = maxMinRatio(bins);
    const ratioFinite = ratio != null && isFinite(ratio) ? ratio : null;

    let justification;
    if (iv != null) {
      const ratioTxt = ratioFinite != null ? `separa ${ratioFinite.toFixed(1)}× a inad. entre os valores · ` : '';
      justification = `${ratioTxt}IV ${iv.toFixed(3)} sobre ${bins.length} valores distintos.`;
    } else if (variance != null) {
      justification = `Sem contraste bom/mau suficiente para IV nesta população — variância ponderada da inad.: ${variance.toFixed(4)}.`;
    } else {
      justification = `Sem volume de conversão suficiente para avaliar esta variável na população do port.`;
    }

    return { col, csvId: winner.csvId, iv, variance, maxMinRatio: ratioFinite, qty: winner.segReal.qty, bins, justification };
  }).sort((a, b) => {
    if (a.iv != null && b.iv != null) return b.iv - a.iv;
    if (a.iv != null) return -1;
    if (b.iv != null) return 1;
    return (b.variance ?? -1) - (a.variance ?? -1);
  });

  // Detecção de interação (top candidatos por IV): IV conjunto vs. soma dos IVs
  // individuais. Custo O(popRows × pares) — limitado a MAX_INTERACTION_CANDIDATES.
  const topForInteraction = ranking.filter(r => r.iv != null).slice(0, MAX_INTERACTION_CANDIDATES);
  const interactions = [];
  for (let i = 0; i < topForInteraction.length; i++) {
    for (let j = i + 1; j < topForInteraction.length; j++) {
      const a = topForInteraction[i], b = topForInteraction[j];
      const ciA = winner.candidateCols.indexOf(a.col);
      const ciB = winner.candidateCols.indexOf(b.col);
      const coderA = winner.candidateCoders[ciA], coderB = winner.candidateCoders[ciB];
      const nDomA = coderA.mode === 'code' ? coderA.dict.length : null;
      const nDomB = coderB.mode === 'code' ? coderB.dict.length : null;
      if (nDomA != null && nDomB != null && nDomA * nDomB > MAX_INTERACTION_PAIR_BINS) continue;

      const jointMap = new Map();
      for (const r of winner.hitRows) {
        const keyA = candidateKeyOf(coderA, winner.csv, r);
        const keyB = candidateKeyOf(coderB, winner.csv, r);
        const key = `${keyA}|${keyB}`;
        let bin = jointMap.get(key);
        if (!bin) { bin = { altas: 0, maus: 0 }; jointMap.set(key, bin); }
        const nums = readRowNums(winner.csv, r, winner.idxs);
        bin.altas += metric === 'inferida' ? nums.altasInfer : nums.altas;
        bin.maus  += metric === 'inferida' ? nums.inadIRaw   : nums.maus;
      }
      const ivJoint = computeIV([...jointMap.values()]);
      if (ivJoint == null) continue;
      const ivSum = a.iv + b.iv;
      const gap = ivJoint - ivSum;
      const suggestCinema = ivSum <= INTERACTION_MIN_ABS_IV
        ? ivJoint >= INTERACTION_MIN_ABS_IV
        : (ivJoint >= ivSum * INTERACTION_RATIO && gap >= INTERACTION_MIN_GAP);
      interactions.push({
        colA: a.col, colB: b.col, ivA: a.iv, ivB: b.iv, ivJoint, suggestCinema,
        justification: `IV(${a.col}×${b.col}) ${ivJoint.toFixed(3)} vs. IV(${a.col})+IV(${b.col}) ${ivSum.toFixed(3)}`
          + (suggestCinema ? ' — interação forte: considere um Cineminha cruzando as duas variáveis.' : '.'),
      });
    }
  }
  interactions.sort((x, y) => (y.ivJoint - (y.ivA + y.ivB)) - (x.ivJoint - (x.ivA + x.ivB)));

  // Autocompletar de terminal (épico, "Autocompletar"): taxa de inad. do segmento
  // (população do anchor) vs. a taxa média do dataset INTEIRO (baseline, sem filtro de
  // roteamento) — segmento sem sinal (sem altas/altasInfer) cai em AS IS.
  const segRate = metric === 'inferida'
    ? (winner.segInfer.altasInfer > 0 ? winner.segInfer.inadIRaw / winner.segInfer.altasInfer : null)
    : (winner.segReal.altas > 0 ? winner.segReal.maus / winner.segReal.altas : null);
  const baseRate = metric === 'inferida'
    ? (winner.baseInfer.altasInfer > 0 ? winner.baseInfer.inadIRaw / winner.baseInfer.altasInfer : null)
    : (winner.baseReal.altas > 0 ? winner.baseReal.maus / winner.baseReal.altas : null);

  let suggestedTerminal = 'as_is', ratioToBase = null, segJustification;
  if (segRate == null || baseRate == null || baseRate <= 0) {
    segJustification = 'Sem sinal de inadimplência suficiente nesta população — mantenha como AS IS até haver dado histórico.';
  } else {
    ratioToBase = segRate / baseRate;
    if (ratioToBase <= SEGMENT_LOW_RATIO) {
      suggestedTerminal = 'approved';
      segJustification = `Inad. do segmento ${(segRate * 100).toFixed(2)}% vs. média ${(baseRate * 100).toFixed(2)}% (${ratioToBase.toFixed(2)}×) — risco baixo, sugestão Aprovado.`;
    } else if (ratioToBase >= SEGMENT_HIGH_RATIO) {
      suggestedTerminal = 'rejected';
      segJustification = `Inad. do segmento ${(segRate * 100).toFixed(2)}% vs. média ${(baseRate * 100).toFixed(2)}% (${ratioToBase.toFixed(2)}×) — risco alto, sugestão Reprovado.`;
    } else {
      segJustification = `Inad. do segmento ${(segRate * 100).toFixed(2)}% próxima da média ${(baseRate * 100).toFixed(2)}% (${ratioToBase.toFixed(2)}×) — sem sinal claro, sugestão AS IS.`;
    }
  }

  return {
    nodeId: anchorNodeId,
    csvId: winner.csvId,
    metric,
    population: {
      qty: winner.segReal.qty, altas: winner.segReal.altas, maus: winner.segReal.maus,
      altasInfer: winner.segInfer.altasInfer, inadIRaw: winner.segInfer.inadIRaw,
      rate: segRate, baselineRate: baseRate, ratio: ratioToBase,
      suggestedTerminal, justification: segJustification,
    },
    ranking,
    interactions,
  };
}

// ── COMPUTE_POLICY_INSIGHTS — Copiloto Sessão 1 (lint estrutural, DEC-IA-006) ────
// Achados são FATOS estruturais sobre o grafo do canvas ativo — nunca bloqueiam a
// simulação (só informam). Reaproveita o `nodeArrivals`/`lensCounts` que o tick já
// produz (via getTickResult, chamado pelo handler da mensagem) em vez de varrer a
// base de novo: as sete regras abaixo dependem só de `shapes`/`conns` (topologia) +
// os agregados já computados, nenhuma leitura adicional de csvStore. Cada achado:
// `{severity:'error'|'warning'|'info', code, nodeId, msg, fix?}` — `fix` é só um
// descritor (ex.: `{kind:'connect_terminal', nodeId}`); quem MATERIALIZA a correção
// no canvas é a UI (padrão não-destrutivo dos otimizadores: proposta → botão aplica).
const FLOW_TYPES = new Set(['decision', 'port', 'approved', 'rejected', 'as_is', 'cineminha', 'decision_lens']);
const DECISION_LIKE_TYPES = new Set(['decision', 'cineminha', 'decision_lens']);

function computePolicyInsights(shapes, conns, nodeArrivals = {}, lensCounts = {}) {
  const findings = [];
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const { out, inc } = buildFlowGraph(shapes, conns);
  const portIds = new Set(shapes.filter(s => s.type === 'port').map(s => s.id));

  // Regra 1 — porta solta: sem NENHUMA conexão de saída, a população daquele valor
  // não é roteada — "some" silenciosamente da simulação (traverseRow retorna null).
  for (const s of shapes) {
    if (s.type !== 'port') continue;
    if ((out[s.id] || []).length > 0) continue;
    findings.push({
      severity: 'error', code: 'port_dangling', nodeId: s.id,
      msg: `Porta "${s.label || '?'}" sem conexão de saída — a população que chega aqui não é roteada (some da simulação).`,
      fix: { kind: 'connect_terminal', nodeId: s.id },
    });
  }

  // Regra 2 — nós inalcançáveis a partir das raízes (MESMO critério de entrada do
  // PolicyIR/motor: nó decision/cineminha/lens sem aresta de entrada vinda de um port).
  // BFS a partir das raízes sobre TODO o grafo (incl. ports/terminais, como pass-through).
  const roots = shapes.filter(s =>
    DECISION_LIKE_TYPES.has(s.type) && !(inc[s.id] || []).some(e => portIds.has(e.from))
  );
  const reachable = new Set();
  const stack = roots.map(s => s.id);
  while (stack.length) {
    const id = stack.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const e of (out[id] || [])) if (!reachable.has(e.to)) stack.push(e.to);
  }
  for (const s of shapes) {
    if (DECISION_LIKE_TYPES.has(s.type) && !reachable.has(s.id)) {
      findings.push({
        severity: 'warning', code: 'unreachable_node', nodeId: s.id,
        msg: `"${s.label || s.type}" não é alcançado a partir de nenhuma raiz do fluxo — provável fragmento desconectado.`,
      });
    }
  }

  // Regra 3 — ciclos: DFS tricolor sobre os nós de fluxo; back-edge para um nó
  // IN_PROGRESS = ciclo (mesmo padrão de detecção de `validateFlow`, reimplementado
  // aqui porque o worker não importa App.jsx). Canvas é pequeno (dezenas de shapes),
  // então DFS recursivo simples é suficiente — sem a otimização iterativa de M13.
  {
    const state = new Map(); // ausente | 1 (in progress) | 2 (done)
    const cycleNodes = new Set();
    const dfs = (id) => {
      state.set(id, 1);
      for (const e of (out[id] || [])) {
        const to = e.to;
        const toShape = shapesMap[to];
        if (!toShape || !FLOW_TYPES.has(toShape.type)) continue;
        const st = state.get(to);
        if (st === 1) { cycleNodes.add(to); cycleNodes.add(id); }
        else if (st === undefined) dfs(to);
      }
      state.set(id, 2);
    };
    for (const s of shapes) {
      if (FLOW_TYPES.has(s.type) && state.get(s.id) === undefined) dfs(s.id);
    }
    for (const id of cycleNodes) {
      const s = shapesMap[id];
      findings.push({
        severity: 'error', code: 'cycle', nodeId: id,
        msg: `"${s.label || s.type}" participa de um ciclo no fluxo (loop infinito) — a simulação nunca decide essas linhas.`,
      });
    }
  }

  // Regra 4 — chegada zero: valor de um losango (ou linha/coluna de um Cineminha) que
  // nunca aparece na base (nodeArrivals já traz qty por valor, só sobre a população que
  // efetivamente chega). Só avalia nós alcançáveis (regra 2 já cobre o caso contrário).
  for (const s of shapes) {
    if (s.type === 'decision') {
      if (!reachable.has(s.id)) continue;
      const arr = nodeArrivals[s.id]?.val || {};
      const seen = new Set();
      for (const e of (out[s.id] || [])) {
        const val = (e.label ?? '').trim();
        if (!val || seen.has(val)) continue;
        seen.add(val);
        if (!arr[val]) {
          findings.push({
            severity: 'warning', code: 'zero_arrival', nodeId: s.id,
            msg: `"${s.label || s.variableCol || 'Decisão'}" — valor "${val}" nunca chega a este nó (0 propostas).`,
            fix: { kind: 'open_domain_modal', nodeId: s.id },
          });
        }
      }
    } else if (s.type === 'cineminha') {
      if (!reachable.has(s.id)) continue;
      const arr = nodeArrivals[s.id] || { row: {}, col: {} };
      if (s.rowVar) for (const v of (s.rowDomain || [])) {
        if (!arr.row?.[v]) findings.push({
          severity: 'warning', code: 'zero_arrival', nodeId: s.id,
          msg: `"${s.label || 'Cineminha'}" — linha "${v}" (${s.rowVar.col}) nunca chega a este nó (0 propostas).`,
          fix: { kind: 'open_domain_modal', nodeId: s.id },
        });
      }
      if (s.colVar) for (const v of (s.colDomain || [])) {
        if (!arr.col?.[v]) findings.push({
          severity: 'warning', code: 'zero_arrival', nodeId: s.id,
          msg: `"${s.label || 'Cineminha'}" — coluna "${v}" (${s.colVar.col}) nunca chega a este nó (0 propostas).`,
          fix: { kind: 'open_domain_modal', nodeId: s.id },
        });
      }
    }
  }

  // Regra 5 — lens vazio: as regras do Decision Lens não casam ninguém, mas há volume
  // chegando (total > 0) — provável engano na configuração das regras.
  for (const s of shapes) {
    if (s.type !== 'decision_lens') continue;
    const c = lensCounts[s.id];
    if (c && c.total > 0 && c.count === 0) {
      findings.push({
        severity: 'warning', code: 'lens_empty', nodeId: s.id,
        msg: `"${s.label || 'Decision Lens'}" — as regras não casam nenhuma linha da base (0 de ${c.total}).`,
      });
    }
  }

  // Regra 6 — mesma variável testada duas vezes no mesmo caminho: a partir de cada
  // losango D, anda a jusante (BFS sobre `out`) até achar outro losango sobre a MESMA
  // coluna/base — sinal de redundância (o corte já foi decidido lá atrás).
  for (const d of shapes) {
    if (d.type !== 'decision' || !d.variableCol) continue;
    const seen = new Set([d.id]);
    const bfsStack = (out[d.id] || []).map(e => e.to);
    let hit = null;
    while (bfsStack.length && !hit) {
      const id = bfsStack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const node = shapesMap[id];
      if (!node) continue;
      if (node.type === 'decision' && node.variableCol === d.variableCol && node.csvId === d.csvId) { hit = node; break; }
      for (const e of (out[id] || [])) if (!seen.has(e.to)) bfsStack.push(e.to);
    }
    if (hit) {
      findings.push({
        severity: 'warning', code: 'duplicate_variable_path', nodeId: hit.id,
        msg: `"${hit.variableCol}" é testado de novo em "${hit.label || hit.variableCol}", depois de já decidido em "${d.label || d.variableCol}" — possível redundância.`,
      });
    }
  }

  // Regra 7 — caminho sem terminal: losango/Cineminha/lens sem NENHUMA saída conectada
  // (diferente da regra 1 — aqui é o nó inteiro, não uma porta específica solta).
  for (const s of shapes) {
    if (!DECISION_LIKE_TYPES.has(s.type)) continue;
    if ((out[s.id] || []).length > 0) continue;
    findings.push({
      severity: 'error', code: 'path_without_terminal', nodeId: s.id,
      msg: `"${s.label || s.type}" não tem nenhuma saída conectada — todo o volume que chega aqui é perdido.`,
      fix: { kind: 'connect_terminal', nodeId: s.id },
    });
  }

  const SEV_ORDER = { error: 0, warning: 1, info: 2 };
  findings.sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3));
  return findings;
}

// ── COMPUTE_SIMPLIFY — Copiloto Sessão 5 (simplificação com prova de equivalência) ──
// Generaliza o padrão de detecção estrutural da Sessão 1 (computePolicyInsights) para
// PROPOR uma política reduzida — não só apontar o achado, mas religar o roteamento e
// PROVAR que a redução não muda nenhuma decisão (diff = 0 linha a linha), ou declarar o
// delta exato quando não for possível (DEC-IA-005: números sempre do motor, nunca estimados).
//
// Catálogo de candidatos (mesmo padrão do catálogo de movimentos do Goal Seek —
// buildGoalSeekCandidates — cada um com um `apply` mínimo materializável por
// applySimplifyCandidates, src/policySimplify.js, compartilhado com a main):
//   - collapsible_node:   losango cujos valores TODOS roteiam pro mesmo destino, Cineminha
//                         cujo Elegível/Não Elegível vão pro mesmo destino, OU Decision Lens
//                         cuja regra deixa passar 100% do volume que chega (filtro redundante
//                         — mesmo apply que os outros dois, "colapsa pro próprio destino");
//   - zero_arrival_node:  nó (losango/Cineminha/Decision Lens) que nunca recebe volume na
//                         base atual (nodeArrivals/lensStats) — remoção não tem NENHUM
//                         efeito porque nenhuma linha jamais o visita;
//   - redundant_variable: losango que retesta a MESMA variável (mesma coluna+csv) já
//                         decidida por um losango a montante, alcançado por uma cadeia
//                         DIRETA de ports a partir de um valor fixo — o retest nunca
//                         discrimina nada (o valor da coluna já é conhecido para quem chega).
//
// `shape.locked` (🔒, mesmo campo/toolbar do Goal Seek) exclui o nó do catálogo ANTES da
// busca — os três primeiros detectores pulam nó travado; redundant_variable pula quando o
// losango retestado (D2) está travado.
//
// Cada candidato é validado INCREMENTALMENTE (greedy, um de cada vez, contra o estado já
// aceito) via computeSimplifyEquivalence — só entra na proposta final se preservar diff = 0
// sobre o estado anterior; por transitividade de igualdade linha a linha, a proposta final
// inteira é diff = 0 contra a política ORIGINAL (a prova real do épico), sem depender de os
// detectores serem perfeitos — se um candidato pontual não for seguro (interação com outro
// já aceito, base de dados atípica, ou por ser a raiz única do fluxo — colapsar a raiz pra
// um terminal quebraria a política inteira), ele é descartado silenciosamente em vez de contaminar
// a proposta.
function resolveThroughPortsSimplify(shapesMap, out, id) {
  let cur = id;
  const seen = new Set();
  while (cur != null) {
    const node = shapesMap[cur];
    if (!node) return null;
    if (node.type !== 'port') return cur;
    if (seen.has(cur)) return null;
    seen.add(cur);
    cur = out[cur]?.[0] ? out[cur][0].to : null;
  }
  return null;
}

// Estatísticas por Decision Lens (mesmo padrão de walk de computeNodeArrivals, generalizado
// pra lens): `arrived` = qty total que chega ao lens (respeitando o roteamento a montante);
// `passed` = qty, dentre essa, que a regra do PRÓPRIO lens deixa passar. `passed === arrived
// > 0` ⇒ a regra não filtra nada (candidato lens_no_effect); `arrived === 0` ⇒ nó morto
// (candidato zero_arrival_node).
function computeLensStats(shapes, conns, csvStore) {
  const { out } = buildFlowGraph(shapes, conns);
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const TERM = new Set(['approved', 'rejected', 'as_is']);
  const EMIT = new Set(['port', 'decision_lens', 'decision', 'cineminha']);
  const nonRoot = new Set(conns.filter(c => EMIT.has(shapesMap[c.from]?.type)).map(c => c.to));
  const rootNodes = shapes.filter(s =>
    (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') && !nonRoot.has(s.id)
  );

  const stats = {};
  for (const s of shapes) if (s.type === 'decision_lens') stats[s.id] = { arrived: 0, passed: 0 };
  if (Object.keys(stats).length === 0) return stats;

  function walk(csv, r, startId, qty) {
    const headers = csv.headers;
    let cur = startId;
    const visited = new Set();
    while (cur) {
      if (visited.has(cur)) break;
      visited.add(cur);
      const node = shapesMap[cur];
      if (!node) break;
      if (TERM.has(node.type)) break;
      if (node.type === 'decision') {
        const colIdx = headers.indexOf(node.variableCol);
        const val = (colIdx >= 0 ? (cellStr(csv, r, colIdx) ?? '') : '').trim();
        const match = (out[cur] || []).find(e => (e.label ?? '').trim() === val);
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const rIdx = node.rowVar ? headers.indexOf(node.rowVar.col) : -1;
        const cIdx = node.colVar ? headers.indexOf(node.colVar.col) : -1;
        const rv = node.rowVar && rIdx >= 0 ? (cellStr(csv, r, rIdx) ?? '').trim() : '';
        const cv = node.colVar && cIdx >= 0 ? (cellStr(csv, r, cIdx) ?? '').trim() : '';
        if (!node.rowVar && !node.colVar) break;
        const rKey = node.rowVar ? rv : '*';
        const cKey = node.colVar ? cv : '*';
        const isEligible = isCellEligible(node.cells, `${rKey}|${cKey}`);
        const typeCfg = getCinemaType(node.cinemaType);
        const targetLabel = isEligible ? typeCfg.ports[0].label : typeCfg.ports[1].label;
        const match = (out[cur] || []).find(e => e.label === targetLabel);
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'decision_lens') {
        if (stats[cur]) stats[cur].arrived += qty;
        const passes = rowMatchesLensRules(csv, r, node.rules || []);
        if (!passes) break;
        if (stats[cur]) stats[cur].passed += qty;
        const edges = out[cur] || [];
        if (edges.length === 0) break;
        cur = edges[0].to;
      } else if (node.type === 'port') {
        const edges = out[cur] || [];
        if (edges.length === 0) break;
        cur = edges[0].to;
      } else break;
    }
  }

  for (const [csvId, csv] of Object.entries(csvStore)) {
    const types = csv.columnTypes || {};
    const qtyCol = Object.entries(types).find(([, t]) => t === 'qty')?.[0];
    const qtyIdx = qtyCol ? csv.headers.indexOf(qtyCol) : -1;
    const csvRoots = rootNodes.filter(d => {
      if (d.type === 'decision')      return d.csvId === csvId;
      if (d.type === 'cineminha')     return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      if (d.type === 'decision_lens') return true;
      return false;
    });
    if (csvRoots.length === 0) continue;
    const nRows = rowCount(csv);
    for (let r = 0; r < nRows; r++) {
      const qty = qtyIdx >= 0 ? (cellNum(csv, r, qtyIdx) || 0) : 1;
      for (const root of csvRoots) walk(csv, r, root.id, qty);
    }
  }
  return stats;
}

// Total de volume que chega a um losango/Cineminha, a partir do `nodeArrivals` já computado
// pelo tick (val/row/col) — 0 ⇒ candidato zero_arrival_node. Losango: soma de todos os
// valores. Cineminha: soma do eixo configurado (linha e/ou coluna — usa o maior quando os
// dois eixos estão configurados, já que descrevem a MESMA população vista por ângulos
// diferentes; podem divergir só por valor vazio num dos dois lados).
function totalArrivalOf(node, arr) {
  if (!arr) return 0;
  if (node.type === 'decision') return Object.values(arr.val || {}).reduce((a, b) => a + b, 0);
  if (node.type === 'cineminha') {
    const rowSum = Object.values(arr.row || {}).reduce((a, b) => a + b, 0);
    const colSum = Object.values(arr.col || {}).reduce((a, b) => a + b, 0);
    if (node.rowVar && node.colVar) return Math.max(rowSum, colSum);
    if (node.rowVar) return rowSum;
    if (node.colVar) return colSum;
    return 0;
  }
  return 0;
}

function detectSimplifyCandidates(shapes, conns, nodeArrivals, lensStats) {
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const out = {};
  for (const s of shapes) out[s.id] = [];
  for (const c of conns) if (out[c.from]) out[c.from].push(c);

  const candidates = [];
  const handled = new Set(); // nodeId já com candidato de remoção/colapso — evita conflito
  let seq = 0;
  const nextId = (prefix) => `${prefix}${seq++}`;

  // (a) losango colapsável — todos os valores roteiam pro MESMO destino final.
  for (const s of shapes) {
    if (s.type !== 'decision' || handled.has(s.id) || s.locked) continue;
    const seen = new Set();
    const dests = new Set();
    let anyValue = false;
    for (const e of (out[s.id] || [])) {
      const value = (e.label ?? '').trim();
      if (seen.has(value)) continue;
      seen.add(value);
      anyValue = true;
      dests.add(resolveThroughPortsSimplify(shapesMap, out, e.to));
    }
    if (anyValue && dests.size === 1) {
      const destId = [...dests][0];
      if (destId != null && destId !== s.id) {
        candidates.push({
          id: nextId('collapse_d_'), code: 'collapsible_node', nodeId: s.id,
          label: `"${s.label || s.variableCol || 'Decisão'}" — todos os valores roteiam para "${shapesMap[destId]?.label || shapesMap[destId]?.type || destId}".`,
          apply: { type: 'collapse_node', nodeId: s.id, destId },
        });
        handled.add(s.id);
      }
    }
  }

  // (a) Cineminha colapsável — Elegível e Não Elegível pro MESMO destino.
  for (const s of shapes) {
    if (s.type !== 'cineminha' || handled.has(s.id) || s.locked) continue;
    const cfg = getCinemaType(s.cinemaType);
    const eEdge = (out[s.id] || []).find(e => e.label === cfg.ports[0].label);
    const nEdge = (out[s.id] || []).find(e => e.label === cfg.ports[1].label);
    const eTo = eEdge ? resolveThroughPortsSimplify(shapesMap, out, eEdge.to) : null;
    const nTo = nEdge ? resolveThroughPortsSimplify(shapesMap, out, nEdge.to) : null;
    if (eTo != null && eTo === nTo) {
      candidates.push({
        id: nextId('collapse_c_'), code: 'collapsible_node', nodeId: s.id,
        label: `"${s.label || 'Cineminha'}" — Elegível e Não Elegível roteiam para "${shapesMap[eTo]?.label || shapesMap[eTo]?.type || eTo}".`,
        apply: { type: 'collapse_node', nodeId: s.id, destId: eTo },
      });
      handled.add(s.id);
    }
  }

  // (b) chegada zero — nó decision/cineminha/lens que nunca recebe volume na base atual.
  for (const s of shapes) {
    if (handled.has(s.id) || s.locked) continue;
    if (s.type === 'decision' || s.type === 'cineminha') {
      const total = totalArrivalOf(s, nodeArrivals[s.id]);
      if (total === 0) {
        candidates.push({
          id: nextId('prune_'), code: 'zero_arrival_node', nodeId: s.id,
          label: `"${s.label || s.variableCol || (s.type === 'cineminha' ? 'Cineminha' : s.type)}" nunca recebe volume (0 propostas) — removível sem efeito.`,
          apply: { type: 'prune_node', nodeId: s.id },
        });
        handled.add(s.id);
      }
    } else if (s.type === 'decision_lens') {
      const st = lensStats[s.id] || { arrived: 0, passed: 0 };
      if (st.arrived === 0) {
        candidates.push({
          id: nextId('prune_'), code: 'zero_arrival_node', nodeId: s.id,
          label: `"${s.label || 'Decision Lens'}" nunca recebe volume (0 propostas) — removível sem efeito.`,
          apply: { type: 'prune_node', nodeId: s.id },
        });
        handled.add(s.id);
      }
    }
  }

  // (c) regra de lens sem efeito — passa 100% do volume que chega (filtro redundante).
  for (const s of shapes) {
    if (s.type !== 'decision_lens' || handled.has(s.id) || s.locked) continue;
    const st = lensStats[s.id];
    if (!st || st.arrived === 0 || st.passed !== st.arrived) continue;
    const edge = (out[s.id] || [])[0];
    const destId = edge ? resolveThroughPortsSimplify(shapesMap, out, edge.to) : null;
    if (destId != null && destId !== s.id) {
      candidates.push({
        id: nextId('bypass_'), code: 'lens_no_effect', nodeId: s.id,
        label: `"${s.label || 'Decision Lens'}" — a regra não filtra ninguém (100% do volume que chega passa) — removível sem efeito.`,
        apply: { type: 'collapse_node', nodeId: s.id, destId },
      });
      handled.add(s.id);
    }
  }

  // (d) variável re-testada sem ganho — losango D2 (mesma coluna+csv de D1) alcançado por
  // uma cadeia DIRETA de ports a partir de um valor fixo v de D1: qualquer linha que chega
  // aqui já tem coluna==v (garantido por D1), então D2 só pode discriminar o ramo próprio de
  // v — os demais nunca chegam. Colapsa a aresta pro destino que D2 daria pra esse v.
  for (const d of shapes) {
    if (d.type !== 'decision' || !d.variableCol || handled.has(d.id)) continue;
    for (const e of (out[d.id] || [])) {
      const value = (e.label ?? '').trim();
      let cur = e.to;
      let lastPortId = null;
      const seenPorts = new Set();
      while (shapesMap[cur]?.type === 'port') {
        if (seenPorts.has(cur)) { cur = null; break; }
        seenPorts.add(cur);
        lastPortId = cur;
        const nxt = (out[cur] || [])[0];
        cur = nxt ? nxt.to : null;
      }
      if (cur == null || lastPortId == null) continue;
      const d2 = shapesMap[cur];
      if (!d2 || d2.type !== 'decision' || d2.id === d.id || handled.has(d2.id) || d2.locked) continue;
      if (d2.variableCol !== d.variableCol || d2.csvId !== d.csvId) continue;
      const connToD2 = conns.find(c => c.from === lastPortId && c.to === d2.id);
      if (!connToD2) continue;
      const d2Edge = (out[d2.id] || []).find(e2 => (e2.label ?? '').trim() === value);
      const destId = d2Edge ? resolveThroughPortsSimplify(shapesMap, out, d2Edge.to) : null;
      if (destId == null) continue;
      candidates.push({
        id: nextId('reroute_'), code: 'redundant_variable', nodeId: d2.id,
        label: `"${d2.variableCol}" é retestado em "${d2.label || d2.variableCol}" (valor "${value}" já decidido em "${d.label || d.variableCol}") — o retest não discrimina nada.`,
        apply: { type: 'reroute_edge', connId: connToD2.id, newTo: destId },
      });
    }
  }

  return candidates;
}

// Desfecho terminal por linha — MESMA classificação de runSimulation (incl. fallback de AS
// IS via __DECISAO_ORIGINAL), mas devolvendo o CÓDIGO por linha em vez de só os agregados.
// Base da prova de equivalência: duas políticas só são "iguais" se decidirem TODAS as linhas
// exatamente igual — dois canvases podem empatar no agregado (approvalRate) e ainda assim
// decidir linhas diferentes (trocam quem é aprovado, sem mudar a soma).
const ROW_NONE = 0, ROW_APROVADO = 1, ROW_REPROVADO = 2;
function computeRowOutcomes(shapes, conns, csvStore) {
  const { out } = buildFlowGraph(shapes, conns);
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const TERM = new Set(['approved', 'rejected', 'as_is']);
  const portIds = new Set(shapes.filter(s => s.type === 'port').map(s => s.id));
  const decWithPortInc = new Set(conns.filter(c => portIds.has(c.from)).map(c => c.to));
  const rootNodes = shapes.filter(s =>
    (s.type === 'decision' || s.type === 'cineminha' || s.type === 'decision_lens') && !decWithPortInc.has(s.id)
  );

  function traverseRow(csv, r, startId) {
    let cur = startId;
    const visited = new Set();
    while (cur) {
      if (visited.has(cur)) return null;
      visited.add(cur);
      const node = shapesMap[cur];
      if (!node) return null;
      if (TERM.has(node.type)) return node.type;
      if (node.type === 'decision') {
        const colIdx = csv.headers.indexOf(node.variableCol);
        const val = (colIdx >= 0 ? (cellStr(csv, r, colIdx) ?? '') : '').trim();
        const match = (out[cur] || []).find(e => (e.label ?? '').trim() === val);
        if (!match) return null;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const rowIdx = node.rowVar ? csv.headers.indexOf(node.rowVar.col) : -1;
        const colIdx = node.colVar ? csv.headers.indexOf(node.colVar.col) : -1;
        const rowVal = node.rowVar && rowIdx >= 0 ? (cellStr(csv, r, rowIdx) ?? '').trim() : '';
        const colVal = node.colVar && colIdx >= 0 ? (cellStr(csv, r, colIdx) ?? '').trim() : '';
        if (!node.rowVar && !node.colVar) return null;
        const rKey = node.rowVar ? rowVal : '*';
        const cKey = node.colVar ? colVal : '*';
        const isEligible = isCellEligible(node.cells, `${rKey}|${cKey}`);
        const typeCfg = getCinemaType(node.cinemaType);
        const targetLabel = isEligible ? typeCfg.ports[0].label : typeCfg.ports[1].label;
        const match = (out[cur] || []).find(e => e.label === targetLabel);
        if (!match) return null;
        cur = match.to;
      } else if (node.type === 'decision_lens') {
        if (!rowMatchesLensRules(csv, r, node.rules || [])) return null;
        const edges = out[cur] || [];
        if (edges.length === 0) return null;
        cur = edges[0].to;
      } else if (node.type === 'port') {
        const edges = out[cur] || [];
        if (edges.length === 0) return null;
        cur = edges[0].to;
      } else return null;
    }
    return null;
  }

  const result = {};
  for (const [csvId, csv] of Object.entries(csvStore)) {
    const dOrigIdx = csv.headers.indexOf('__DECISAO_ORIGINAL');
    const csvRoots = rootNodes.filter(d => {
      if (d.type === 'decision')      return d.csvId === csvId;
      if (d.type === 'cineminha')     return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      if (d.type === 'decision_lens') return true;
      return false;
    });
    const n = rowCount(csv);
    const codes = new Int8Array(n);
    if (csvRoots.length > 0) {
      const rootId = csvRoots[0].id;
      for (let r = 0; r < n; r++) {
        const res = traverseRow(csv, r, rootId);
        if (res === 'approved') codes[r] = ROW_APROVADO;
        else if (res === 'rejected') codes[r] = ROW_REPROVADO;
        else if (res === 'as_is') {
          const orig = dOrigIdx >= 0 ? String(cellStr(csv, r, dOrigIdx) ?? '').trim().toUpperCase() : '';
          codes[r] = orig === 'APROVADO' ? ROW_APROVADO : orig === 'REPROVADO' ? ROW_REPROVADO : ROW_NONE;
        } else codes[r] = ROW_NONE;
      }
    }
    result[csvId] = codes;
  }
  return result;
}

// Prova de equivalência (Copiloto Sessão 5, DEC-IA-005): compara o DESFECHO POR LINHA de
// duas políticas — `identical` só é true com diffCount === 0 (TODAS as linhas de TODOS os
// csvs decidem igual). Quando não é idêntico, o delta reportado vem de runSimulation
// ANTES/DEPOIS de verdade — nunca estimado (mesmo contrato de validação do Goal Seek).
function computeSimplifyEquivalence(origShapes, origConns, propShapes, propConns, csvStore) {
  const codesA = computeRowOutcomes(origShapes, origConns, csvStore);
  const codesB = computeRowOutcomes(propShapes, propConns, csvStore);
  let diffCount = 0, totalRows = 0;
  for (const [csvId, csv] of Object.entries(csvStore)) {
    const a = codesA[csvId], b = codesB[csvId];
    const n = rowCount(csv);
    totalRows += n;
    if (!a || !b) { diffCount += n; continue; }
    for (let r = 0; r < n; r++) if (a[r] !== b[r]) diffCount++;
  }
  const identical = diffCount === 0;
  let delta = null;
  if (!identical) {
    const before = runSimulation(origShapes, origConns, csvStore);
    const after  = runSimulation(propShapes, propConns, csvStore);
    const d = (a, b) => (a != null && b != null) ? b - a : null;
    delta = {
      approvalRate: { before: before.approvalRate, after: after.approvalRate, delta: d(before.approvalRate, after.approvalRate) },
      inadReal:     { before: before.inadReal,     after: after.inadReal,     delta: d(before.inadReal, after.inadReal) },
      inadInferida: { before: before.inadInferida, after: after.inadInferida, delta: d(before.inadInferida, after.inadInferida) },
      approvedQty:  { before: before.approvedQty,  after: after.approvedQty,  delta: after.approvedQty - before.approvedQty },
      rejectedQty:  { before: before.rejectedQty,  after: after.rejectedQty,  delta: after.rejectedQty - before.rejectedQty },
    };
  }
  return { identical, diffCount, totalRows, delta };
}

// Ponto de entrada do COMPUTE_SIMPLIFY: detecta candidatos, aceita-os INCREMENTALMENTE (só
// os que preservam diff = 0 sobre o estado já aceito — ver comentário do catálogo acima) e
// devolve a proposta final + a prova de equivalência contra a política ORIGINAL.
function computeSimplify(shapes, conns, csvStore, nodeArrivals) {
  const lensStats = computeLensStats(shapes, conns, csvStore);
  const candidates = detectSimplifyCandidates(shapes, conns, nodeArrivals || {}, lensStats);

  let curShapes = shapes, curConns = conns;
  const accepted = [];
  for (const cand of candidates) {
    const { shapes: tryShapes, conns: tryConns } = applySimplifyCandidates(curShapes, curConns, [cand]);
    const eq = computeSimplifyEquivalence(curShapes, curConns, tryShapes, tryConns, csvStore);
    if (eq.identical) {
      curShapes = tryShapes; curConns = tryConns;
      accepted.push(cand);
    }
  }

  const equivalence = computeSimplifyEquivalence(shapes, conns, curShapes, curConns, csvStore);

  return {
    proposal: {
      candidates: accepted,
      consideredCount: candidates.length,
      totalNodeCount: shapes.length,
      removedNodeCount: shapes.length - curShapes.length,
    },
    equivalence,
  };
}

// Lista de ArrayBuffers das colunas do dataset largo — transferíveis (zero-cópia) no
// postMessage de ANALYTICS_RESULT. Cada coluna tem seu próprio buffer (nunca compartilhado),
// então a lista é livre de duplicatas. Após a transferência os typed arrays do worker ficam
// neutralizados — sem problema, o dataset é descartado (não é retido no worker).
function analyticsDatasetTransfer(dataset) {
  if (!dataset || !dataset.columns) return [];
  const transfer = [];
  for (const col of Object.values(dataset.columns)) {
    const buf = col.kind === 'num' ? col.data?.buffer : col.codes?.buffer;
    if (buf) transfer.push(buf);
  }
  return transfer;
}

// ── Worker state ─────────────────────────────────────────────────────────────
let workerCsvStore = {};
let csvStoreVersion = 0;             // bump a cada UPDATE_CSV_STORE — invalida caches de overlay
const analyticsOverlayCache = {};    // {[canvasId]: {key, overlay}} — cache por canvas (5B)

// Cache single-slot do tick de edição (M6): RUN_SIMULATION e COMPUTE_OVERLAY chegam do
// mesmo gesto de edição (mesmos deps/debounce em App.jsx), então o worker computa o passe
// único (`computeSimulationTick`) na PRIMEIRA das duas mensagens e a segunda só lê do
// cache — nenhuma re-varredura da base. Chave barata (mesmo padrão do `cachedCanvasOverlay`,
// M2): shapes/conns são pequenos comparados às linhas da base.
let tickCache = { key: null, value: null };
function getTickResult(shapes, conns) {
  const key = csvStoreVersion + '|' + JSON.stringify(shapes) + '|' + JSON.stringify(conns);
  if (tickCache.key === key) return tickCache.value;
  const { populations, counts } = getLensPopulations(shapes, workerCsvStore);
  const { simResult, incrementalResult, nodeArrivals } =
    computeSimulationTick(shapes, conns, workerCsvStore, populations);
  const value = { simResult, incrementalResult, nodeArrivals, lensCounts: counts };
  tickCache = { key, value };
  return value;
}

function handleMessage(e) {
  const { type } = e.data;

  if (type === 'UPDATE_CSV_STORE') {
    workerCsvStore = e.data.csvStore;
    csvStoreVersion++;
    return;
  }

  if (type === 'RUN_SIMULATION') {
    const { simResult } = getTickResult(e.data.shapes, e.data.conns);
    self.postMessage({ type: 'SIMULATION_RESULT', result: simResult });
    return;
  }

  if (type === 'COMPUTE_OVERLAY') {
    // M6: computado junto de RUN_SIMULATION no mesmo passe (`computeSimulationTick`, via
    // `getTickResult`) — não é mais uma varredura própria da base. O overlay tipado
    // (Int8Array por csv, M2) segue interno à função, descartado ao final: a main só
    // recebe `incrementalResult` (agregados) e `nodeArrivals`. O caminho do Dashboard tem
    // seu próprio overlay memoizado (cachedCanvasOverlay), independente deste.
    const { incrementalResult, nodeArrivals, lensCounts } = getTickResult(e.data.shapes, e.data.conns);
    self.postMessage({ type: 'OVERLAY_RESULT', incrementalResult, nodeArrivals, lensCounts });
    return;
  }

  // Prévia AS IS contextualizada ao nó (disparada ao atribuir variável de eixo a um
  // cineminha, quando as caselas ainda não foram editadas manualmente). Diferente do
  // computeAsIsCells síncrono da main (base completa), respeita os filtros a montante.
  if (type === 'COMPUTE_ASIS_PREVIEW') {
    const { shapes, conns = [], targetIds = [], reqTokens = {} } = e.data;
    const cellsByShape = computeCinemaAsIsCells(shapes, conns, workerCsvStore, targetIds);
    self.postMessage({ type: 'ASIS_PREVIEW_RESULT', cellsByShape, reqTokens });
    return;
  }

  if (type === 'COMPUTE_OPTIM') {
    const { shape } = e.data;
    const cellMetrics = computeCellMetrics(shape, workerCsvStore);
    const frontier    = buildParetoFrontier(cellMetrics);
    const scenarios   = extractScenarios(frontier);
    const maxInadReal = Math.max(0, ...Object.values(cellMetrics).map(m => m.inadReal     ?? 0));
    const maxInadInf  = Math.max(0, ...Object.values(cellMetrics).map(m => m.inadInferida ?? 0));
    self.postMessage({ type: 'OPTIM_RESULT', shapeId: shape.id, cellMetrics, frontier, scenarios, maxInadReal, maxInadInf });
    return;
  }

  if (type === 'COMPUTE_ANALYTICS_DATASET') {
    const dataset = computeAnalyticsDataset(e.data.canvases, workerCsvStore);
    // Transfere os ArrayBuffers das colunas (zero-cópia) — o dataset largo não é retido
    // no worker, então neutralizá-los aqui é seguro e evita a cópia do structured clone.
    self.postMessage({ type: 'ANALYTICS_RESULT', dataset }, analyticsDatasetTransfer(dataset));
    return;
  }

  if (type === 'COMPUTE_POLICY_INSIGHTS') {
    // Reusa o tick (getTickResult) — mesma chave de cache do RUN_SIMULATION/COMPUTE_OVERLAY
    // do mesmo gesto de edição, então isto normalmente é uma leitura de cache, não uma
    // nova varredura da base.
    const { nodeArrivals, lensCounts } = getTickResult(e.data.shapes, e.data.conns);
    const findings = computePolicyInsights(e.data.shapes, e.data.conns, nodeArrivals, lensCounts);
    self.postMessage({ type: 'POLICY_INSIGHTS_RESULT', findings });
    return;
  }

  // Simplificação com prova de equivalência (Copiloto Sessão 5) — busca on-demand, como o
  // Goal Seek; reusa o `nodeArrivals` do tick (normalmente uma leitura de cache) para os
  // candidatos de chegada zero de losango/Cineminha.
  if (type === 'COMPUTE_SIMPLIFY') {
    const { shapes, conns = [] } = e.data;
    const { nodeArrivals } = getTickResult(shapes, conns);
    const result = computeSimplify(shapes, conns, workerCsvStore, nodeArrivals);
    self.postMessage({ type: 'SIMPLIFY_RESULT', ...result });
    return;
  }

  if (type === 'COMPUTE_JOHNNY') {
    const { shapes, cinemaIds, conns = [], lensPopulations = {}, riskLevels, hierarchyMode, inadMetric } = e.data;
    const result = computeJohnnyData(shapes, cinemaIds, conns, workerCsvStore, lensPopulations, riskLevels, hierarchyMode, inadMetric);
    if (!result) { self.postMessage({ type: 'JOHNNY_RESULT', error: 'no_data' }); return; }
    self.postMessage({ type: 'JOHNNY_RESULT', ...result });
    return;
  }

  // Goal Seek (Copiloto Sessão 4) — busca on-demand para o objetivo declarado no
  // goalSeekModal; não entra no cache do tick (não é um gesto de edição recorrente).
  if (type === 'COMPUTE_GOAL_SEEK') {
    const { shapes, conns = [], goal, constraints = {}, locks = [] } = e.data;
    const { populations } = getLensPopulations(shapes, workerCsvStore);
    const result = computeGoalSeek(shapes, conns, workerCsvStore, goal, constraints, locks, populations);
    self.postMessage({ type: 'GOAL_SEEK_RESULT', ...result });
    return;
  }

  // Sugestão de próximo nó (Copiloto Sessão 3) — ranking on-demand para a seleção
  // atual (porta solta), não entra no cache do tick.
  if (type === 'COMPUTE_VARIABLE_RANKING') {
    const { shapes, conns = [], anchor } = e.data;
    const result = computeVariableRanking(shapes, conns, workerCsvStore, anchor?.nodeId);
    self.postMessage({ type: 'VARIABLE_RANKING_RESULT', ...result });
    return;
  }
}

// Só registra o handler em contexto de worker real; permite importar as funções
// puras em testes (Node/jsdom) sem disparar o protocolo de mensagens.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = handleMessage;
}

// Permite que o csvStore do worker seja semeado em testes (em produção vem de UPDATE_CSV_STORE).
function __setWorkerCsvStoreForTest(store) { workerCsvStore = store || {}; csvStoreVersion++; }

export {
  runSimulation,
  computeIncrementalResult,
  computeCellMetrics,
  computeAnalyticsDataset,
  computeSimulatedDecisions,
  computeCinemaArrivals,
  computeCinemaAsIsCells,
  computeNodeArrivals,
  computeSimulationTick,
  computeLensPopulations,
  computePolicyInsights,
  computeVariableRanking,
  computeJohnnyData,
  buildFlowGraph,
  computeGoalSeek,
  buildGoalSeekCandidates,
  computeGoalSeekArrivals,
  computeGoalSeekBaseline,
  computeNewLensThreshold,
  resolveDirectTerminalConn,
  computeSimplify,
  detectSimplifyCandidates,
  computeSimplifyEquivalence,
  computeLensStats,
  __setWorkerCsvStoreForTest,
};
