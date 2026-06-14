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

function computeJohnnyData(shapes, csvStore) {
  const cinemas = shapes.filter(s => s.type === 'cineminha');
  if (cinemas.length === 0) return null;

  const pooledMetrics = {};
  const mixCatsSet = new Set();
  let totalQty = 0;

  for (const shape of cinemas) {
    const { rowVar, colVar, rowDomain, colDomain } = shape;
    const csvId = rowVar?.csvId || colVar?.csvId;
    if (!csvId) continue;
    const csv = csvStore[csvId];
    if (!csv) continue;

    const varTypes  = csv.varTypes      || {};
    const colTypes  = csv.columnTypes   || {};
    const rowIsOrd  = rowVar ? varTypes[rowVar.col] === 'ordinal' : false;
    const colIsOrd  = colVar ? varTypes[colVar.col] === 'ordinal' : false;
    const rDom      = rowDomain?.length > 0 ? rowDomain : ['*'];
    const cDom      = colDomain?.length > 0 ? colDomain : ['*'];

    const getIdx = (type) => {
      const col = Object.entries(colTypes).find(([, t]) => t === type)?.[0];
      return col != null ? csv.headers.indexOf(col) : -1;
    };
    const rowCI      = rowVar ? csv.headers.indexOf(rowVar.col) : -1;
    const colCI      = colVar ? csv.headers.indexOf(colVar.col) : -1;
    const qtyI       = getIdx('qty');
    const altasI     = getIdx('qtdAltas');
    const altasInfI  = getIdx('qtdAltasInfer');
    const inadRI     = getIdx('inadReal');
    const inadII     = getIdx('inadInferida');
    const mixI       = getIdx('mixRisco');

    // Accumulate per cell
    const acc = {};
    for (const rv of rDom)
      for (const cv of cDom)
        acc[`${rv}|${cv}`] = { qty:0, qtdAltas:0, qtdAltasInfer:0, inadRRaw:0, inadIRaw:0, mix:{} };

    for (const row of csv.rows) {
      const rv  = rowVar && rowCI >= 0 ? (row[rowCI] ?? '').toString().trim() : '*';
      const cv  = colVar && colCI >= 0 ? (row[colCI] ?? '').toString().trim() : '*';
      const key = `${rv}|${cv}`;
      if (!acc[key]) continue;
      const qty       = qtyI      >= 0 ? (parseFloat(row[qtyI])      || 0) : 1;
      const altas     = altasI    >= 0 ? (parseFloat(row[altasI])    || 0) : 0;
      const altasInf  = altasInfI >= 0 ? (parseFloat(row[altasInfI]) || 0) : 0;
      const inadR     = inadRI    >= 0 ? (parseFloat(row[inadRI])    || 0) : 0;
      const inadI     = inadII    >= 0 ? (parseFloat(row[inadII])    || 0) : 0;
      acc[key].qty          += qty;
      acc[key].qtdAltas     += altas;
      acc[key].qtdAltasInfer+= altasInf;
      acc[key].inadRRaw     += inadR;
      acc[key].inadIRaw     += inadI;
      if (mixI >= 0) {
        const mv = (row[mixI] ?? '').toString().trim();
        if (mv) { acc[key].mix[mv] = (acc[key].mix[mv] || 0) + qty; mixCatsSet.add(mv); }
      }
    }

    for (const rv of rDom) {
      for (const cv of cDom) {
        const cellKey = `${rv}|${cv}`;
        const m = acc[cellKey];
        if (!m || m.qty === 0) continue;
        const rowRank = rowIsOrd && rDom.length > 1 ? rDom.indexOf(rv) / (rDom.length - 1) : 0.5;
        const colRank = colIsOrd && cDom.length > 1 ? cDom.indexOf(cv) / (cDom.length - 1) : 0.5;
        const badness = (rowIsOrd ? rowRank : 0.5) + (colIsOrd ? colRank : 0.5);
        const pk = `${shape.id}|${cellKey}`;
        pooledMetrics[pk] = {
          shapeId: shape.id, cellKey, rowVal: rv, colVal: cv,
          qty: m.qty, qtdAltas: m.qtdAltas, qtdAltasInfer: m.qtdAltasInfer,
          inadRRaw: m.inadRRaw, inadIRaw: m.inadIRaw,
          inadReal:     m.qtdAltas      > 0 ? m.inadRRaw / m.qtdAltas      : null,
          inadInferida: m.qtdAltasInfer > 0 ? m.inadIRaw / m.qtdAltasInfer
                      : m.qty           > 0 ? m.inadIRaw / m.qty            : null,
          badness, rowRank, colRank,
          mixBreakdown: m.mix,
        };
        totalQty += m.qty;
      }
    }
  }

  if (totalQty === 0) return null;

  // Sort: badness asc, then inadInferida asc, then qty desc
  const sorted = Object.entries(pooledMetrics)
    .map(([pk, m]) => ({ pk, ...m }))
    .filter(c => c.qty > 0)
    .sort((a, b) => {
      const bd = a.badness - b.badness;
      if (Math.abs(bd) > 1e-9) return bd;
      const ai = a.inadInferida ?? Infinity, bi = b.inadInferida ?? Infinity;
      const id = ai - bi;
      if (Math.abs(id) > 1e-9) return id;
      return b.qty - a.qty;
    });

  // Build frontier (greedy from best → worst badness)
  const frontier = [{
    cells: {}, approvalRate: 0, inadReal: null, inadInferida: null,
    totalQty, approvedQty: 0, mixBreakdown: {},
  }];
  let approvedQty = 0, altasSum = 0, inadRSum = 0, inadISum = 0;
  const curCells = {}, curMix = {};
  for (const c of sorted) {
    approvedQty += c.qty; altasSum += c.qtdAltas;
    inadRSum += c.inadRRaw; inadISum += c.inadIRaw;
    curCells[c.pk] = true;
    for (const [mv, mq] of Object.entries(c.mixBreakdown || {}))
      curMix[mv] = (curMix[mv] || 0) + mq;
    frontier.push({
      cells: { ...curCells },
      approvalRate: approvedQty / totalQty,
      inadReal:     altasSum    > 0 ? inadRSum / altasSum    : null,
      inadInferida: approvedQty > 0 ? inadISum / approvedQty : null,
      totalQty, approvedQty,
      mixBreakdown: { ...curMix },
    });
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

// ── Worker state ─────────────────────────────────────────────────────────────
let workerCsvStore = {};

self.onmessage = (e) => {
  const { type } = e.data;

  if (type === 'UPDATE_CSV_STORE') {
    workerCsvStore = e.data.csvStore;
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
    self.postMessage({ type: 'OVERLAY_RESULT', overlay, incrementalResult });
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

  if (type === 'COMPUTE_JOHNNY') {
    const result = computeJohnnyData(e.data.shapes, workerCsvStore);
    if (!result) { self.postMessage({ type: 'JOHNNY_RESULT', error: 'no_data' }); return; }
    self.postMessage({ type: 'JOHNNY_RESULT', ...result });
    return;
  }
};
