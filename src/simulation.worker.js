// Simulation Web Worker — heavy computation off the main thread.
// Receives csvStore once (UPDATE_CSV_STORE) and caches it to avoid
// re-serializing the full dataset on every simulation tick.

// Accessor colunar (Otimização de Memória — Fase 1). Os hot paths abaixo leem
// as células via cellStr/cellNum/rowCount, que funcionam tanto sobre a base
// colunar (produção) quanto sobre o legado string[][] (testes / GATE).
import { cellStr, cellNum, rowCount } from './columnar.js';

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

// ── Inferência de negados via Tabela de Referência — lookup em cascata (Fase 2) ──
// Fonte alternativa para 🔮 Conv. Inferida e 🎯 Inad. Inferida (Proposta §4 /
// CONTRATO §3). Em vez de ler colunas prontas, deriva conv/fpd por linha via lookup
// em cascata na inferenceRef e alimenta EXATAMENTE os acumuladores que já existem
// (qtdAltasInferSum, inadInferidaSum). Nenhuma agregação nova.

// Score vazio / R99 / sem score → R20 (pior faixa), APENAS como chave transitória
// de lookup (CONTRATO §3.1, Proposta §6). Nunca muta dado, domínio nem export.
function normalizeScoreKey(s) {
  const v = String(s ?? '').trim();
  return (!v || v.toUpperCase() === 'R99') ? 'R20' : v;
}

// Desce do nível mais granular (mais chaves) ao GLOBAL; para no primeiro que casar.
function cascadeLookupPremissa(ref, levelOrder, parts) {
  for (const niv of levelOrder) {
    const k = ref.levelKeyCount?.[niv] || 0;
    if (k <= 0) continue;
    const map = ref.levels?.[niv];
    if (!map) continue;
    const hit = map.get(parts.slice(0, k).join('|'));
    if (hit) return hit;
  }
  return ref.global || null;
}

// Heurística de coluna de aprovados (modo de peso 'aprovados', Fase 4) — usada como
// fallback quando não há `weightCol` explícito. Casa cabeçalhos como QTD_APROVADOS,
// n_aprovados, etc., excluindo a coluna de volume (📊 qty) para não colidir.
function findApprovedCol(headers, excludeCol) {
  return (headers || []).find(h => h !== excludeCol && /aprov/i.test(h)) || null;
}

// Resolve a coluna de peso (CONTRATO §3.2, toggle Fase 4):
//   - `weightCol` explícito sempre vence (override avançado);
//   - modo 'aprovados' ("FPD sobre aprovados") → coluna de aprovados (heurística);
//   - modo 'propostas' (default, "abrir para reprovados") → 📊 volume total (qty).
function resolveWeightCol(cfg, headers, qtyCol) {
  if (cfg?.weightCol) return cfg.weightCol;
  if (cfg?.weightMode === 'aprovados') return findApprovedCol(headers, qtyCol) || qtyCol;
  return qtyCol;
}

// Constrói um resolvedor por-linha para um csv. Retorna null quando o dataset NÃO está
// em modo 'ref' (o chamador então lê as colunas 🔮/🎯 como hoje — retrocompatível).
// Em modo 'ref', (row) => { altasInfer, inadIRaw } com os físicos do CONTRATO §3.2:
//   altasInfer = peso × conv ;  inadIRaw = peso × conv × fpd     (peso = coluna de volume)
// As Regras de Ouro (CONTRATO §4) são satisfeitas POR CONSTRUÇÃO: somam-se os físicos
// linha a linha; o agregador existente faz ∑inadIRaw / ∑qtdAltasInfer (nunca divide
// maus por contagem de aprovados, nunca multiplica somas).
function buildInferenceResolver(csv, inferenceRef) {
  const cfg = csv?.inferenceConfig;
  if (!cfg || cfg.source !== 'ref' || !inferenceRef || !inferenceRef.keyCols) return null;
  const ref = inferenceRef;
  const types = csv.columnTypes || {};
  const qtyCol = Object.entries(types).find(([, t]) => t === 'qty')?.[0];
  const weightCol = resolveWeightCol(cfg, csv.headers, qtyCol);
  const weightIdx = weightCol ? csv.headers.indexOf(weightCol) : -1;
  const keyMap = cfg.keyMap || {};
  // Índice na base de cada keyCol da referência (na ordem de colapso). -1 = ausente
  // → a cascata naturalmente desce de nível (chave vazia não casa nos níveis granulares).
  const keyBaseIdx = ref.keyCols.map(rk => {
    const baseCol = keyMap[rk];
    return baseCol ? csv.headers.indexOf(baseCol) : -1;
  });
  // Níveis ordenados do mais granular (mais chaves) ao mais geral.
  const levelOrder = Object.keys(ref.levels || {})
    .map(Number)
    .sort((a, b) => (ref.levelKeyCount?.[b] || 0) - (ref.levelKeyCount?.[a] || 0));
  const normScore = cfg.normalizeScore !== false; // default: aplicar (fiel ao SAS)
  // Resolvedor dual-mode (Fase 1 — accessor colunar):
  //   - legado (GATE / testes): resolve(row) — `a` é a linha string[], `r` undefined;
  //   - produção: resolve(csv, r) — `a` é o csv colunar, `r` o índice da linha.
  // Ambos leem os MESMOS índices de coluna; o legado usa `a[idx]`, a produção lê pelo
  // accessor (cellStr/cellNum). Físicos e cascata inalterados.
  return (a, r) => {
    const legacy = r === undefined;
    let peso = 0;
    if (weightIdx >= 0) peso = legacy ? (parseFloat(a[weightIdx]) || 0) : (cellNum(a, r, weightIdx) || 0);
    const parts = new Array(keyBaseIdx.length);
    for (let j = 0; j < keyBaseIdx.length; j++) {
      const bi = keyBaseIdx[j];
      let v = '';
      if (bi >= 0) v = legacy ? String(a[bi] ?? '').trim() : String(cellStr(a, r, bi) ?? '').trim();
      if (j === 0 && normScore) v = normalizeScoreKey(v); // keyCols[0] = âncora = score
      parts[j] = v;
    }
    const p = cascadeLookupPremissa(ref, levelOrder, parts);
    const conv = p?.conv || 0, fpd = p?.fpd || 0;
    // confiab propagado da premissa usada (Fase 3 / Proposta §4.5, CONTRATO §7):
    // sinaliza quando uma fatia do estudo herdou premissa colapsada (≠ ALTA).
    const confiab = (p?.confiab ? String(p.confiab).trim().toUpperCase() : 'GLOBAL') || 'GLOBAL';
    return { altasInfer: peso * conv, inadIRaw: peso * conv * fpd, confiab };
  };
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
      for (let r = 0; r < n; r++) {
        const qty = qtyIdx >= 0 ? (cellNum(csv, r, qtyIdx) || 1) : 1;
        total += qty;
        if (rowMatchesLensRules(csv, r, rules)) { arr[r] = 1; count += qty; }
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

function runSimulation(shapes, conns, csvStore, inferenceRef) {
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
  // Confiabilidade da inferência por referência (Fase 3): volume inferido (altas)
  // acumulado por faixa de confiab da premissa usada. Só quando algum dataset está
  // em modo 'ref'; alimenta o indicador "% do volume inferido com confiab ALTA".
  let anyRefSource = false;
  const refWeightModes = new Set(); // modos de peso dos datasets em modo 'ref' (Fase 4)
  const confiabVolume = { ALTA: 0, MEDIA: 0, BAIXA: 0, GLOBAL: 0 };

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
    const infResolve       = buildInferenceResolver(csv, inferenceRef);
    if (infResolve) { anyRefSource = true; refWeightModes.add(csv.inferenceConfig?.weightMode === 'aprovados' ? 'aprovados' : 'propostas'); }
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
      // 🔮/🎯: das colunas (modo 'columns') ou derivados do lookup em cascata (modo 'ref').
      let qtdAltasInfer, inadI, rowConfiab = null;
      if (infResolve) { const rr = infResolve(csv, r); qtdAltasInfer = rr.altasInfer; inadI = rr.inadIRaw; rowConfiab = rr.confiab; }
      else {
        qtdAltasInfer = qtdAltasInferIdx >= 0 ? (cellNum(csv, r, qtdAltasInferIdx) || 0) : 0;
        inadI         = inadInferidaIdx  >= 0 ? (cellNum(csv, r, inadInferidaIdx)  || 0) : 0;
      }
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
        // Pondera a confiab pela mesma grandeza do "volume inferido" (altas inferidas).
        if (rowConfiab !== null && qtdAltasInfer > 0) {
          if (rowConfiab in confiabVolume) confiabVolume[rowConfiab] += qtdAltasInfer;
          else confiabVolume.GLOBAL += qtdAltasInfer; // faixa desconhecida → mais conservador
        }
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
    // Sinalização de origem/confiabilidade da inferência (Fase 3).
    inferenceSource: anyRefSource ? 'ref' : null,
    confiabVolume: anyRefSource ? confiabVolume : null,
    // Base de peso usada na inferência (Fase 4): 'propostas' | 'aprovados' | 'misto'.
    inferenceWeightMode: anyRefSource ? (refWeightModes.size === 1 ? [...refWeightModes][0] : 'misto') : null,
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

  function traverseRow(csv, r, startId) {
    const headers = csv.headers;
    let cur = startId; const visited = new Set();
    while (cur) {
      if (visited.has(cur)) return null;
      visited.add(cur);
      const node = shapesMap[cur]; if (!node) return null;
      if (TERM.has(node.type)) return node.type;
      if (node.type === 'decision') {
        const colIdx = headers.indexOf(node.variableCol);
        const val = (colIdx >= 0 ? (cellStr(csv, r, colIdx) ?? '') : '').trim();
        const match = (out[cur] || []).find(e => (e.label ?? '').trim() === val);
        if (!match) return null;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const rowI = node.rowVar ? headers.indexOf(node.rowVar.col) : -1;
        const colI = node.colVar ? headers.indexOf(node.colVar.col) : -1;
        const rowVal = node.rowVar && rowI >= 0 ? (cellStr(csv, r, rowI) ?? '').trim() : '';
        const colVal = node.colVar && colI >= 0 ? (cellStr(csv, r, colI) ?? '').trim() : '';
        if (!node.rowVar && !node.colVar) return null;
        const rKey = node.rowVar ? rowVal : '*';
        const cKey = node.colVar ? colVal : '*';
        const isEligible = isCellEligible(node.cells, `${rKey}|${cKey}`);
        const typeCfg = getCinemaType(node.cinemaType);
        const match = (out[cur] || []).find(e => e.label === (isEligible ? typeCfg.ports[0].label : typeCfg.ports[1].label));
        if (!match) return null;
        cur = match.to;
      } else if (node.type === 'decision_lens') {
        const passes = rowMatchesLensRules(csv, r, node.rules || []);
        if (!passes) return null;
        const edges = out[cur] || []; if (edges.length === 0) return null;
        cur = edges[0].to;
      } else if (node.type === 'port') {
        const edges = out[cur] || []; if (edges.length === 0) return null;
        cur = edges[0].to;
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
    for (let rowIdx = 0; rowIdx < nRows; rowIdx++) {
      const isMutable = !hasLens || Object.values(lensPopulations).some(pop => pop[csvId]?.[rowIdx] === 1);
      if (!isMutable || csvRoots.length === 0) continue; // mantém original (DEC_SAME)

      const boardResult = traverseRow(csv, rowIdx, csvRoots[0].id);
      if (boardResult === 'approved') sim[rowIdx] = DEC_APROVADO;
      else if (boardResult === 'rejected') sim[rowIdx] = DEC_REPROVADO;
      // 'as_is' ou null (não roteou) → mantém a decisão original (DEC_SAME, já é 0)
    }

    overlay[csvId] = { sim };
  }

  return hasAnyDecisaoCol ? overlay : null;
}

function computeIncrementalResult(overlay, csvStore, inferenceRef) {
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
    const infResolve    = buildInferenceResolver(csv, inferenceRef);

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
      let altasInfer, inadI;
      if (infResolve) { const r = infResolve(csv, ri); altasInfer = r.altasInfer; inadI = r.inadIRaw; }
      else {
        altasInfer = altasInferIdx >= 0 ? (cellNum(csv, ri, altasInferIdx) || 0) : 0;
        inadI      = inadIIdx      >= 0 ? (cellNum(csv, ri, inadIIdx)      || 0) : 0;
      }

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

function computeCellMetrics(shape, csvStore, inferenceRef) {
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
  const infResolve = buildInferenceResolver(csv, inferenceRef);
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
    let altasInfer, inadI;
    if (infResolve) { const rr = infResolve(csv, r); altasInfer = rr.altasInfer; inadI = rr.inadIRaw; }
    else {
      altasInfer = altasInferI >= 0 ? (cellNum(csv, r, altasInferI) || 0) : 0;
      inadI      = inadII      >= 0 ? (cellNum(csv, r, inadII)      || 0) : 0;
    }
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
function computeCinemaArrivals(shapes, conns, csvStore, lensPopulations, inferenceRef) {
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

  function collectCinemaHits(csv, r, startId) {
    const headers = csv.headers;
    let cur = startId;
    const visited = new Set();
    const hits = [];
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
        const rv   = node.rowVar && rIdx >= 0 ? (cellStr(csv, r, rIdx) ?? '').trim() : '';
        const cv   = node.colVar && cIdx >= 0 ? (cellStr(csv, r, cIdx) ?? '').trim() : '';
        if (!node.rowVar && !node.colVar) break;
        const rKey = node.rowVar ? rv : '*';
        const cKey = node.colVar ? cv : '*';
        const cellKey = `${rKey}|${cKey}`;
        if (arrivals[node.id] !== undefined) hits.push({ shapeId: node.id, cellKey });
        const isEligible = isCellEligible(node.cells, cellKey);
        const typeCfg = getCinemaType(node.cinemaType);
        const targetLabel = isEligible ? typeCfg.ports[0].label : typeCfg.ports[1].label;
        const match = (out[cur] || []).find(e => e.label === targetLabel);
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'decision_lens') {
        const passes = rowMatchesLensRules(csv, r, node.rules || []);
        if (!passes) break;
        const edges = out[cur] || [];
        if (edges.length === 0) break;
        cur = edges[0].to;
      } else if (node.type === 'port') {
        const edges = out[cur] || [];
        if (edges.length === 0) break;
        cur = edges[0].to;
      } else break;
    }
    return hits;
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
    const infResolve  = buildInferenceResolver(csv, inferenceRef);

    const csvRoots = rootNodes.filter(d => {
      if (d.type === 'decision')      return d.csvId === csvId;
      if (d.type === 'cineminha')     return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      if (d.type === 'decision_lens') return true;
      return false;
    });
    if (csvRoots.length === 0) continue;
    const rootId = csvRoots[0].id;

    const nRows = rowCount(csv);
    for (let r = 0; r < nRows; r++) {
      const qty      = qtyIdx      >= 0 ? (cellNum(csv, r, qtyIdx)      || 0) : 1;
      const altas    = altasIdx    >= 0 ? (cellNum(csv, r, altasIdx)    || 0) : 0;
      const inadR    = inadRIdx    >= 0 ? (cellNum(csv, r, inadRIdx)    || 0) : 0;
      let altasInf, inadI;
      if (infResolve) { const rr = infResolve(csv, r); altasInf = rr.altasInfer; inadI = rr.inadIRaw; }
      else {
        altasInf = altasInfIdx >= 0 ? (cellNum(csv, r, altasInfIdx) || 0) : 0;
        inadI    = inadIIdx    >= 0 ? (cellNum(csv, r, inadIIdx)    || 0) : 0;
      }
      const mixVal   = mixIdx      >= 0 ? (cellStr(csv, r, mixIdx) ?? '').toString().trim() : '';

      const hits = collectCinemaHits(csv, r, rootId);
      for (const { shapeId, cellKey } of hits) {
        const acc = arrivals[shapeId];
        if (!acc) continue;
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

// DEC-JO-004: greedy com restrição de precedência (Sessão C).
// riskLevels: {[shapeId]: number} — maior = mais restritivo (DEC-JO-002)
// hierarchyMode: 'cascata'|'independente' (DEC-JO-003)
// inadMetric: 'inferida'|'real' (DEC-JO-004)
function computeJohnnyData(allShapes, cinemaIds, conns, csvStore, lensPopulations, riskLevels, hierarchyMode, inadMetric, inferenceRef) {
  const cinemaIdSet = new Set(cinemaIds);
  const cinemas = allShapes.filter(s => cinemaIdSet.has(s.id) && s.type === 'cineminha');
  if (cinemas.length === 0) return null;

  const arrivals = computeCinemaArrivals(allShapes, conns, csvStore, lensPopulations, inferenceRef);

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
function computeAnalyticsDataset(canvasInputs, csvStore, inferenceRef) {
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
  const putCode = (name, w, val) => {
    const e = enc[name];
    let c = e.dictIndex.get(val);
    if (c === undefined) { c = e.dict.length; e.dict.push(val); e.dictIndex.set(val, c); }
    e.codes[w] = c;
  };

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
    const infResolve    = buildInferenceResolver(csv, inferenceRef);
    const dimIdxMap = {};
    for (const h of dimCols) dimIdxMap[h] = csv.headers.indexOf(h);

    for (let rowIdx = 0; rowIdx < n; rowIdx++, w++) {
      for (const h of dimNames) {
        const ci = dimIdxMap[h];
        putCode(h, w, (ci != null && ci >= 0) ? (cellStr(csv, rowIdx, ci) ?? '') : '');
      }
      numData.qty[w]      = qtyIdx   >= 0 ? (cellNum(csv, rowIdx, qtyIdx)   || 0) : 1;
      numData.qtdAltas[w] = altasIdx >= 0 ? (cellNum(csv, rowIdx, altasIdx) || 0) : 0;
      numData.inadRRaw[w] = inadRIdx >= 0 ? (cellNum(csv, rowIdx, inadRIdx) || 0) : 0;
      if (infResolve) { const r = infResolve(csv, rowIdx); numData.qtdAltasInfer[w] = r.altasInfer; numData.inadIRaw[w] = r.inadIRaw; }
      else {
        numData.qtdAltasInfer[w] = altasInferIdx >= 0 ? (cellNum(csv, rowIdx, altasInferIdx) || 0) : 0;
        numData.inadIRaw[w]      = inadIIdx      >= 0 ? (cellNum(csv, rowIdx, inadIIdx)      || 0) : 0;
      }
      const asIs = cellStr(csv, rowIdx, dOrigIdx) ?? '';
      putCode('__DECISAO_AS_IS', w, asIs); // AS IS único e global
      // Join por (csvId, rowIdx): cada canvas marcado contribui sua coluna de decisão.
      // Overlay tipado (M2): lê o código da linha e decodifica (DEC_SAME → própria AS IS).
      for (const cs of canvasScenarios) {
        const simCodes = cs.overlay?.[csvId]?.sim;
        putCode(cs.decisionCol, w, simCodes ? decodeSimDecision(simCodes[rowIdx], asIs) : asIs);
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
let workerInferenceRef = null;       // índice da Tabela de Inferência (UPDATE_INFERENCE_REF)
const analyticsOverlayCache = {};    // {[canvasId]: {key, overlay}} — cache por canvas (5B)

function handleMessage(e) {
  const { type } = e.data;

  if (type === 'UPDATE_CSV_STORE') {
    workerCsvStore = e.data.csvStore;
    csvStoreVersion++;
    return;
  }

  // Tabela de Inferência (Fase 2) — análogo a UPDATE_CSV_STORE. O structured clone
  // do postMessage preserva os Maps de `levels`, então o índice chega íntegro.
  if (type === 'UPDATE_INFERENCE_REF') {
    workerInferenceRef = e.data.inferenceRef || null;
    return;
  }

  if (type === 'RUN_SIMULATION') {
    const result = runSimulation(e.data.shapes, e.data.conns, workerCsvStore, workerInferenceRef);
    self.postMessage({ type: 'SIMULATION_RESULT', result });
    return;
  }

  if (type === 'COMPUTE_OVERLAY') {
    // `overlay` é tipado (M2): 1 Int8Array/csv (~1MB/1MM linhas) com o código da decisão
    // simulada por linha. É usado só aqui dentro por computeIncrementalResult e descartado
    // em seguida — NÃO é enviado à main thread: a main só consome `incrementalResult`
    // (agregados) e `nodeArrivals`. Antes o overlay ia no postMessage (structured clone =
    // +1MM objetos na main) e era guardado num estado que ninguém lia — fonte de OOM ao
    // editar o canvas com base grande. O caminho do Dashboard tem seu próprio overlay
    // memoizado (cachedCanvasOverlay), independente deste.
    // M10: populações de lens derivadas aqui (memoizadas) — não chegam mais da main.
    // computeNodeArrivals roteia pelas próprias regras dos lens, então não precisa delas.
    const { populations, counts } = getLensPopulations(e.data.shapes, workerCsvStore);
    const overlay = computeSimulatedDecisions(e.data.shapes, e.data.conns, workerCsvStore, populations);
    const incrementalResult = computeIncrementalResult(overlay, workerCsvStore, workerInferenceRef);
    const nodeArrivals = computeNodeArrivals(e.data.shapes, e.data.conns, workerCsvStore, null);
    self.postMessage({ type: 'OVERLAY_RESULT', incrementalResult, nodeArrivals, lensCounts: counts });
    return;
  }

  if (type === 'COMPUTE_OPTIM') {
    const { shape } = e.data;
    const cellMetrics = computeCellMetrics(shape, workerCsvStore, workerInferenceRef);
    const frontier    = buildParetoFrontier(cellMetrics);
    const scenarios   = extractScenarios(frontier);
    const maxInadReal = Math.max(0, ...Object.values(cellMetrics).map(m => m.inadReal     ?? 0));
    const maxInadInf  = Math.max(0, ...Object.values(cellMetrics).map(m => m.inadInferida ?? 0));
    self.postMessage({ type: 'OPTIM_RESULT', shapeId: shape.id, cellMetrics, frontier, scenarios, maxInadReal, maxInadInf });
    return;
  }

  if (type === 'COMPUTE_ANALYTICS_DATASET') {
    const dataset = computeAnalyticsDataset(e.data.canvases, workerCsvStore, workerInferenceRef);
    // Transfere os ArrayBuffers das colunas (zero-cópia) — o dataset largo não é retido
    // no worker, então neutralizá-los aqui é seguro e evita a cópia do structured clone.
    self.postMessage({ type: 'ANALYTICS_RESULT', dataset }, analyticsDatasetTransfer(dataset));
    return;
  }

  if (type === 'COMPUTE_JOHNNY') {
    const { shapes, cinemaIds, conns = [], lensPopulations = {}, riskLevels, hierarchyMode, inadMetric } = e.data;
    const result = computeJohnnyData(shapes, cinemaIds, conns, workerCsvStore, lensPopulations, riskLevels, hierarchyMode, inadMetric, workerInferenceRef);
    if (!result) { self.postMessage({ type: 'JOHNNY_RESULT', error: 'no_data' }); return; }
    self.postMessage({ type: 'JOHNNY_RESULT', ...result });
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
function __setWorkerInferenceRefForTest(ref) { workerInferenceRef = ref || null; }

export {
  runSimulation,
  computeIncrementalResult,
  computeCellMetrics,
  computeAnalyticsDataset,
  computeSimulatedDecisions,
  computeCinemaArrivals,
  computeNodeArrivals,
  buildFlowGraph,
  buildInferenceResolver,
  resolveWeightCol,
  findApprovedCol,
  normalizeScoreKey,
  __setWorkerCsvStoreForTest,
  __setWorkerInferenceRefForTest,
};
