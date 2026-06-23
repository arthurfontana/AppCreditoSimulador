// Simulation Web Worker — heavy computation off the main thread.
// Receives csvStore once (UPDATE_CSV_STORE) and caches it to avoid
// re-serializing the full dataset on every simulation tick.

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

function rowMatchesLensRules(row, headers, rules) {
  if (!rules || rules.length === 0) return true;
  let result = null;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const colIdx = headers.indexOf(rule.col);
    const cellVal = colIdx >= 0 ? (row[colIdx] ?? '') : '';
    const matches = matchLensRule(cellVal, rule.operator, rule.value ?? '');
    if (result === null) { result = matches; }
    else if (rule.logic === 'OR') { result = result || matches; }
    else { result = result && matches; }
  }
  return result ?? true;
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

  function traverseRow(row, headers, startId) {
    let cur = startId; const visited = new Set(); const path = [];
    while (cur) {
      if (visited.has(cur)) return { result: null, path };
      visited.add(cur);
      const node = shapesMap[cur]; if (!node) return { result: null, path };
      if (TERM.has(node.type)) return { result: node.type, path };
      if (node.type === 'decision') {
        const colIdx = headers.indexOf(node.variableCol);
        const val = (colIdx >= 0 ? (row[colIdx] ?? '') : '').trim();
        const match = (out[cur] || []).find(e => (e.label ?? '').trim() === val);
        if (!match) return { result: null, path };
        const cid = edgeLookup[cur]?.[`${match.to}::${match.label ?? ''}`];
        if (cid) path.push(cid);
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const rowIdx = node.rowVar ? headers.indexOf(node.rowVar.col) : -1;
        const colIdx = node.colVar ? headers.indexOf(node.colVar.col) : -1;
        const rowVal = node.rowVar && rowIdx >= 0 ? (row[rowIdx] ?? '').trim() : '';
        const colVal = node.colVar && colIdx >= 0 ? (row[colIdx] ?? '').trim() : '';
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
        const passes = rowMatchesLensRules(row, headers, rules);
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

    for (const row of csv.rows) {
      const qty          = qtyIdx          >= 0 ? (parseFloat(row[qtyIdx])          || 0) : 1;
      const qtdAltas     = qtdAltasIdx     >= 0 ? (parseFloat(row[qtdAltasIdx])     || 0) : 0;
      const qtdAltasInfer= qtdAltasInferIdx>= 0 ? (parseFloat(row[qtdAltasInferIdx])|| 0) : 0;
      const inadR        = inadRealIdx     >= 0 ? (parseFloat(row[inadRealIdx])     || 0) : 0;
      const inadI        = inadInferidaIdx >= 0 ? (parseFloat(row[inadInferidaIdx]) || 0) : 0;
      totalQty += qty;
      const { result: res, path } = traverseRow(row, csv.headers, rootId);
      let isApproved = res === 'approved', isRejected = res === 'rejected';
      if (res === 'as_is') {
        const origDecision = dOrigIdx >= 0 ? String(row[dOrigIdx] ?? '').toUpperCase() : '';
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

  const edgeLookup = {};
  for (const c of conns) {
    if (!edgeLookup[c.from]) edgeLookup[c.from] = {};
    edgeLookup[c.from][`${c.to}::${c.label ?? ''}`] = c.id;
  }

  function traverseRow(row, headers, startId) {
    let cur = startId; const visited = new Set(); const path = [];
    while (cur) {
      if (visited.has(cur)) return { result: null, path };
      visited.add(cur);
      const node = shapesMap[cur]; if (!node) return { result: null, path };
      if (TERM.has(node.type)) return { result: node.type, path };
      if (node.type === 'decision') {
        const colIdx = headers.indexOf(node.variableCol);
        const val = (colIdx >= 0 ? (row[colIdx] ?? '') : '').trim();
        const match = (out[cur] || []).find(e => (e.label ?? '').trim() === val);
        if (!match) return { result: null, path };
        const cid = edgeLookup[cur]?.[`${match.to}::${match.label ?? ''}`];
        if (cid) path.push(cid);
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const rowI = node.rowVar ? headers.indexOf(node.rowVar.col) : -1;
        const colI = node.colVar ? headers.indexOf(node.colVar.col) : -1;
        const rowVal = node.rowVar && rowI >= 0 ? (row[rowI] ?? '').trim() : '';
        const colVal = node.colVar && colI >= 0 ? (row[colI] ?? '').trim() : '';
        if (!node.rowVar && !node.colVar) return { result: null, path };
        const rKey = node.rowVar ? rowVal : '*';
        const cKey = node.colVar ? colVal : '*';
        const isEligible = isCellEligible(node.cells, `${rKey}|${cKey}`);
        const typeCfg = getCinemaType(node.cinemaType);
        const match = (out[cur] || []).find(e => e.label === (isEligible ? typeCfg.ports[0].label : typeCfg.ports[1].label));
        if (!match) return { result: null, path };
        const cid = edgeLookup[cur]?.[`${match.to}::${match.label ?? ''}`];
        if (cid) path.push(cid);
        cur = match.to;
      } else if (node.type === 'decision_lens') {
        const passes = rowMatchesLensRules(row, headers, node.rules || []);
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

  const overlay = {};
  let hasAnyDecisaoCol = false;

  for (const [csvId, csv] of Object.entries(csvStore)) {
    const dOrigIdx = csv.headers.indexOf('__DECISAO_ORIGINAL');
    if (dOrigIdx < 0) continue;
    hasAnyDecisaoCol = true;

    const types = csv.columnTypes || {};
    const qtyCol = Object.entries(types).find(([, t]) => t === 'qty')?.[0];
    const qtyIdx = qtyCol ? csv.headers.indexOf(qtyCol) : -1;

    const csvRoots = rootNodes.filter(d => {
      if (d.type === 'decision') return d.csvId === csvId;
      if (d.type === 'cineminha') return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      if (d.type === 'decision_lens') return true;
      return false;
    });

    const summaryStats = { totalQty: 0, mutableQty: 0, impactedQty: 0, rToA: 0, aToR: 0 };

    const rowDecisions = csv.rows.map((row, rowIdx) => {
      const decisaoOriginal = row[dOrigIdx] ?? '';
      const qty = qtyIdx >= 0 ? (parseFloat(row[qtyIdx]) || 1) : 1;
      const isMutable = !hasLens || Object.values(lensPopulations).some(pop => pop[csvId]?.[rowIdx] === true);

      summaryStats.totalQty += qty;
      if (isMutable) summaryStats.mutableQty += qty;

      if (!isMutable || csvRoots.length === 0) {
        return { rowIdx, decisaoOriginal, decisaoSimulada: decisaoOriginal, flagImpactado: false, componenteOrigem: null, flagMutavel: false };
      }

      const { result: boardResult, path } = traverseRow(row, csv.headers, csvRoots[0].id);
      let decisaoSimulada = decisaoOriginal;
      let componenteOrigem = null;

      if (boardResult === 'approved') {
        decisaoSimulada = 'APROVADO';
        const lastConn = conns.find(c => c.id === path[path.length - 1]);
        componenteOrigem = lastConn ? (shapesMap[lastConn.to]?.label || 'Aprovado') : 'Aprovado';
      } else if (boardResult === 'rejected') {
        decisaoSimulada = 'REPROVADO';
        const lastConn = conns.find(c => c.id === path[path.length - 1]);
        componenteOrigem = lastConn ? (shapesMap[lastConn.to]?.label || 'Reprovado') : 'Reprovado';
      } else if (boardResult === 'as_is') {
        decisaoSimulada = decisaoOriginal;
        componenteOrigem = 'AS IS';
      }

      const flagImpactado = decisaoOriginal !== '' && decisaoSimulada !== decisaoOriginal;
      if (flagImpactado) {
        summaryStats.impactedQty += qty;
        if (decisaoOriginal === 'REPROVADO' && decisaoSimulada === 'APROVADO') summaryStats.rToA += qty;
        if (decisaoOriginal === 'APROVADO'  && decisaoSimulada === 'REPROVADO') summaryStats.aToR += qty;
      }

      return { rowIdx, decisaoOriginal, decisaoSimulada, flagImpactado, componenteOrigem, flagMutavel: true };
    });

    overlay[csvId] = { rowDecisions, summaryStats };
  }

  return hasAnyDecisaoCol ? overlay : null;
}

function computeIncrementalResult(overlay, csvStore) {
  if (!overlay) return null;

  const bl  = { approvedQty: 0, rejectedQty: 0, totalQty: 0, qtdAltasSum: 0, qtdAltasInferSum: 0, inadRRaw: 0, inadIRaw: 0 };
  const sim = { approvedQty: 0, rejectedQty: 0, totalQty: 0, qtdAltasSum: 0, qtdAltasInferSum: 0, inadRRaw: 0, inadIRaw: 0 };
  const imp = { qty: 0, rToA: 0, aToR: 0, qtdAltasSimSum: 0, inadRSimRaw: 0, inadISimRaw: 0, altasInferRtoA: 0, altasRealAtoR: 0 };

  for (const [csvId, { rowDecisions }] of Object.entries(overlay)) {
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

    for (const rd of rowDecisions) {
      const row = csv.rows[rd.rowIdx];
      if (!row) continue;
      const qty        = qtyIdx       >= 0 ? (parseFloat(row[qtyIdx])       || 1) : 1;
      const altas      = altasIdx     >= 0 ? (parseFloat(row[altasIdx])     || 0) : 0;
      const altasInfer = altasInferIdx>= 0 ? (parseFloat(row[altasInferIdx])|| 0) : 0;
      const inadR      = inadRIdx     >= 0 ? (parseFloat(row[inadRIdx])     || 0) : 0;
      const inadI      = inadIIdx     >= 0 ? (parseFloat(row[inadIIdx])     || 0) : 0;

      bl.totalQty += qty;
      if (rd.decisaoOriginal === 'APROVADO') {
        bl.approvedQty += qty; bl.qtdAltasSum += altas; bl.qtdAltasInferSum += altasInfer; bl.inadRRaw += inadR; bl.inadIRaw += inadI;
      } else if (rd.decisaoOriginal === 'REPROVADO') {
        bl.rejectedQty += qty;
      }

      sim.totalQty += qty;
      if (rd.decisaoSimulada === 'APROVADO') {
        sim.approvedQty += qty; sim.qtdAltasSum += altas; sim.qtdAltasInferSum += altasInfer; sim.inadRRaw += inadR; sim.inadIRaw += inadI;
      } else if (rd.decisaoSimulada === 'REPROVADO') {
        sim.rejectedQty += qty;
      }

      if (rd.flagImpactado) {
        imp.qty += qty;
        if (rd.decisaoOriginal === 'REPROVADO' && rd.decisaoSimulada === 'APROVADO') {
          imp.rToA += qty; imp.qtdAltasSimSum += altas; imp.inadRSimRaw += inadR; imp.inadISimRaw += inadI;
          imp.altasInferRtoA += altasInfer;
        } else if (rd.decisaoOriginal === 'APROVADO' && rd.decisaoSimulada === 'REPROVADO') {
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
  for (const row of csv.rows) {
    const rv = rowVar && rowCI >= 0 ? (row[rowCI] ?? '').toString().trim() : '*';
    const cv = colVar && colCI >= 0 ? (row[colCI] ?? '').toString().trim() : '*';
    const key = `${rv}|${cv}`;
    if (!acc[key]) continue;
    const qty        = qtyI       >= 0 ? (parseFloat(row[qtyI])       || 0) : 1;
    const altas      = altasI     >= 0 ? (parseFloat(row[altasI])     || 0) : 0;
    const altasInfer = altasInferI>= 0 ? (parseFloat(row[altasInferI])|| 0) : 0;
    const inadR      = inadRI     >= 0 ? (parseFloat(row[inadRI])     || 0) : 0;
    const inadI      = inadII     >= 0 ? (parseFloat(row[inadII])     || 0) : 0;
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

  function collectCinemaHits(row, headers, startId) {
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
        const val = (colIdx >= 0 ? (row[colIdx] ?? '') : '').trim();
        const match = (out[cur] || []).find(e => (e.label ?? '').trim() === val);
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const rIdx = node.rowVar ? headers.indexOf(node.rowVar.col) : -1;
        const cIdx = node.colVar ? headers.indexOf(node.colVar.col) : -1;
        const rv   = node.rowVar && rIdx >= 0 ? (row[rIdx] ?? '').trim() : '';
        const cv   = node.colVar && cIdx >= 0 ? (row[cIdx] ?? '').trim() : '';
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
        const passes = rowMatchesLensRules(row, headers, node.rules || []);
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

    const csvRoots = rootNodes.filter(d => {
      if (d.type === 'decision')      return d.csvId === csvId;
      if (d.type === 'cineminha')     return d.rowVar?.csvId === csvId || d.colVar?.csvId === csvId;
      if (d.type === 'decision_lens') return true;
      return false;
    });
    if (csvRoots.length === 0) continue;
    const rootId = csvRoots[0].id;

    for (const row of csv.rows) {
      const qty      = qtyIdx      >= 0 ? (parseFloat(row[qtyIdx])      || 0) : 1;
      const altas    = altasIdx    >= 0 ? (parseFloat(row[altasIdx])    || 0) : 0;
      const altasInf = altasInfIdx >= 0 ? (parseFloat(row[altasInfIdx]) || 0) : 0;
      const inadR    = inadRIdx    >= 0 ? (parseFloat(row[inadRIdx])    || 0) : 0;
      const inadI    = inadIIdx    >= 0 ? (parseFloat(row[inadIIdx])    || 0) : 0;
      const mixVal   = mixIdx      >= 0 ? (row[mixIdx] ?? '').toString().trim() : '';

      const hits = collectCinemaHits(row, csv.headers, rootId);
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

  function walk(row, headers, startId, qty) {
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
        const val = (colIdx >= 0 ? (row[colIdx] ?? '') : '').trim();
        if (result[cur] && val !== '') result[cur].val[val] = (result[cur].val[val] || 0) + qty;
        const match = (out[cur] || []).find(e => (e.label ?? '').trim() === val);
        if (!match) break;
        cur = match.to;
      } else if (node.type === 'cineminha') {
        const rIdx = node.rowVar ? headers.indexOf(node.rowVar.col) : -1;
        const cIdx = node.colVar ? headers.indexOf(node.colVar.col) : -1;
        const rv = node.rowVar && rIdx >= 0 ? (row[rIdx] ?? '').trim() : '';
        const cv = node.colVar && cIdx >= 0 ? (row[cIdx] ?? '').trim() : '';
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
        if (!rowMatchesLensRules(row, headers, node.rules || [])) break;
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
    for (const row of csv.rows) {
      const qty = qtyIdx >= 0 ? (parseFloat(row[qtyIdx]) || 0) : 1;
      for (const root of csvRoots) walk(row, csv.headers, root.id, qty);
    }
  }

  return result;
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

// ── Analytics dataset (Analytics Workspace) ───────────────────────────────────
// Emits the canonical wide dataset (DEC-AW-003): one row per CSV grouping, with
// the original dimensions + intrinsic metrics + one decision column per scenario.
const ANALYTICS_METRIC_TYPES = new Set(['qty', 'qtdAltas', 'qtdAltasInfer', 'inadReal', 'inadInferida', 'mixRisco']);

// Overlay (decisão simulada por csvId+rowIdx) de um canvas, memoizado por hash de
// shapes/conns/lensPopulations + versão do csvStore (5B — evita reprocessar canvases intocados).
function cachedCanvasOverlay(canvasId, shapes, conns, lensPopulations, csvStore) {
  const key = csvStoreVersion + '|' + JSON.stringify(shapes) + '|' + JSON.stringify(conns) + '|' + JSON.stringify(lensPopulations || {});
  const hit = analyticsOverlayCache[canvasId];
  if (hit && hit.key === key) return hit.overlay;
  const overlay = computeSimulatedDecisions(shapes, conns, csvStore, lensPopulations);
  analyticsOverlayCache[canvasId] = { key, overlay };
  return overlay;
}

// Dataset analítico largo (DEC-AW-003) com N cenários (DEC-AW-004/007).
// canvasInputs: [{id, nome, shapes, conns, lensPopulations}] — uma aba marcada por cenário.
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
    overlay: cachedCanvasOverlay(ci.id, ci.shapes, ci.conns, ci.lensPopulations, csvStore),
  }));

  const dimensionSet = new Set();
  const temporalSet = new Set();
  const rows = [];

  for (const [csvId, csv] of Object.entries(csvStore)) {
    const dOrigIdx = csv.headers.indexOf('__DECISAO_ORIGINAL');
    if (dOrigIdx < 0) continue; // só datasets com AS IS configurado são analíticos
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

    // Dimensions: every non-metric, non-internal column.
    const dimCols = csv.headers.filter(h =>
      h !== '__DECISAO_ORIGINAL' && !ANALYTICS_METRIC_TYPES.has(types[h] ?? '')
    );
    for (const h of dimCols) {
      dimensionSet.add(h);
      if ((types[h] ?? '') === 'temporal') temporalSet.add(h);
    }
    const dimIdx = dimCols.map(h => csv.headers.indexOf(h));

    csv.rows.forEach((row, rowIdx) => {
      const out = {};
      for (let i = 0; i < dimCols.length; i++) out[dimCols[i]] = row[dimIdx[i]] ?? '';
      out.qty           = qtyIdx        >= 0 ? (parseFloat(row[qtyIdx])        || 0) : 1;
      out.qtdAltas      = altasIdx      >= 0 ? (parseFloat(row[altasIdx])      || 0) : 0;
      out.qtdAltasInfer = altasInferIdx >= 0 ? (parseFloat(row[altasInferIdx]) || 0) : 0;
      out.inadRRaw      = inadRIdx      >= 0 ? (parseFloat(row[inadRIdx])      || 0) : 0;
      out.inadIRaw      = inadIIdx      >= 0 ? (parseFloat(row[inadIIdx])      || 0) : 0;
      const asIs = row[dOrigIdx] ?? '';
      out.__DECISAO_AS_IS = asIs; // AS IS único e global
      // Join por (csvId, rowIdx): cada canvas marcado contribui sua coluna de decisão.
      for (const cs of canvasScenarios) {
        const rd = cs.overlay?.[csvId]?.rowDecisions?.[rowIdx];
        out[cs.decisionCol] = rd ? rd.decisaoSimulada : asIs;
      }
      rows.push(out);
    });
  }

  if (rows.length === 0) return null;

  return {
    rows,
    dimensions: [...dimensionSet],
    temporalColumns: [...temporalSet],
    metrics: [
      { id: 'approvalRate', label: 'Taxa de Aprovação', unit: 'pct' },
      { id: 'inadReal',     label: 'Inad. Real',        unit: 'pct' },
      { id: 'inadInferida', label: 'Inad. Inferida',    unit: 'pct' },
      { id: 'qty',          label: 'Vol. Propostas',    unit: 'qty' },
      { id: 'approvedQty',  label: 'Vol. Aprovado',     unit: 'qty' },
    ],
    scenarios: [
      { id: 'as_is', nome: 'AS IS', decisionCol: '__DECISAO_AS_IS' },
      ...canvasScenarios.map(cs => ({ id: cs.id, nome: cs.nome, decisionCol: cs.decisionCol })),
    ],
  };
}

// ── Worker state ─────────────────────────────────────────────────────────────
let workerCsvStore = {};
let csvStoreVersion = 0;             // bump a cada UPDATE_CSV_STORE — invalida caches de overlay
const analyticsOverlayCache = {};    // {[canvasId]: {key, overlay}} — cache por canvas (5B)

function handleMessage(e) {
  const { type } = e.data;

  if (type === 'UPDATE_CSV_STORE') {
    workerCsvStore = e.data.csvStore;
    csvStoreVersion++;
    return;
  }

  if (type === 'RUN_SIMULATION') {
    const result = runSimulation(e.data.shapes, e.data.conns, workerCsvStore);
    self.postMessage({ type: 'SIMULATION_RESULT', result });
    return;
  }

  if (type === 'COMPUTE_OVERLAY') {
    const overlay = computeSimulatedDecisions(e.data.shapes, e.data.conns, workerCsvStore, e.data.lensPopulations);
    const incrementalResult = computeIncrementalResult(overlay, workerCsvStore);
    const nodeArrivals = computeNodeArrivals(e.data.shapes, e.data.conns, workerCsvStore, e.data.lensPopulations);
    self.postMessage({ type: 'OVERLAY_RESULT', overlay, incrementalResult, nodeArrivals });
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
    self.postMessage({ type: 'ANALYTICS_RESULT', dataset });
    return;
  }

  if (type === 'COMPUTE_JOHNNY') {
    const { shapes, cinemaIds, conns = [], lensPopulations = {}, riskLevels, hierarchyMode, inadMetric } = e.data;
    const result = computeJohnnyData(shapes, cinemaIds, conns, workerCsvStore, lensPopulations, riskLevels, hierarchyMode, inadMetric);
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

export {
  computeAnalyticsDataset,
  computeSimulatedDecisions,
  computeCinemaArrivals,
  computeNodeArrivals,
  buildFlowGraph,
  __setWorkerCsvStoreForTest,
};
