// Goal Seek (Copiloto Sessão 4, DEC-IA-005/006) — módulo compartilhado entre o worker
// (que computa a busca gulosa e valida por re-simulação, COMPUTE_GOAL_SEEK) e a main
// thread (que materializa os movimentos aceitos, de verdade, ao "Aplicar como novo
// cenário"). Fica fora de src/App.jsx e de src/simulation.worker.js porque os dois
// precisam da MESMA lógica de aplicação sem se importar um ao outro (worker roda em
// contexto de Worker; App.jsx não importa nada do worker — só troca mensagens).
//
// Cada `move` é o campo `apply` de um candidato do catálogo (ver buildGoalSeekCandidates
// em simulation.worker.js): {type, shapeId|connId, ...} — deliberadamente mínimo, sem
// nenhuma referência a posição/layout. `idMap` (opcional) traduz IDs do canvas original
// para um canvas CLONADO (cloneCanvasWithNewIds) — quando ausente, aplica nos MESMOS
// IDs (usado internamente pelo worker para a validação por re-simulação, DEC-IA-005).
//
// Tipos de movimento:
//   - cinema_cell      — abre/fecha uma casela de Cineminha existente.
//   - decision_terminal — troca o terminal de um segmento de losango existente.
//   - lens_threshold    — relaxa/aperta o limiar de uma regra de Decision Lens.
//   - add_break         — "adicionar quebra" (pendência declarada da Sessão 4, entregue na
//                         Sessão 12): INSERE uma nova estrutura de decisão (losango ou
//                         Cineminha) ANTES de um nó âncora, roteando o sub-segmento
//                         acionável a um terminal e o resto pro nó âncora (a política que
//                         já existia). É o gerador do achado heterogeneous_block e das
//                         exceções de segmento com estrutura NOVA da Descoberta de Segmentos.
//                         Mesma mecânica de materialização usada tanto na validação por
//                         re-simulação (worker) quanto no "Aplicar como novo cenário" (main)
//                         — nenhum aplicador novo (DEC-IA-002): a quebra é só mais um move
//                         do catálogo do Goal Seek.

// `genId` cria IDs para os shapes/portas novos da quebra. A main passa `uid` (contador
// global do canvas); sem ele, um contador local por CHAMADA — determinístico dentro da
// invocação e suficiente para a re-simulação interna (o motor não lê o valor do id, só a
// estrutura). Os IDs gerados NÃO aparecem no descritor do move (que é puro/serializável),
// só na materialização — o SegmentModel/GOAL_SEEK_RESULT continua determinístico.
export function applyGoalSeekMoves(shapes, conns, moves, idMap = null, genId = null) {
  const mapId = (x) => (x == null ? x : (idMap ? (idMap[x] ?? x) : x));
  let _c = 0;
  const gid = genId || (() => `_gsb${_c++}`);

  let curShapes = shapes.map(s => ({ ...s }));
  let curConns = conns.map(c => ({ ...c }));
  let shapesById = new Map(curShapes.map(s => [s.id, s]));
  let connsById = new Map(curConns.map(c => [c.id, c]));

  for (const mv of (moves || [])) {
    if (!mv) continue;
    if (mv.type === 'cinema_cell') {
      const s = shapesById.get(mapId(mv.shapeId));
      if (!s) continue;
      s.cells = { ...(s.cells || {}), [mv.cellKey]: mv.newValue };
      s.cellsUserEdited = true;
    } else if (mv.type === 'decision_terminal') {
      const c = connsById.get(mapId(mv.connId));
      if (!c) continue;
      c.to = mapId(mv.newTo);
    } else if (mv.type === 'lens_threshold') {
      const s = shapesById.get(mapId(mv.shapeId));
      if (!s) continue;
      const rules = (s.rules || []).map((r, i) => i === mv.ruleIndex ? { ...r, value: mv.newValue } : r);
      s.rules = rules;
    } else if (mv.type === 'add_break') {
      ({ curShapes, curConns } = applyAddBreak(curShapes, curConns, mv, mapId, gid));
      shapesById = new Map(curShapes.map(s => [s.id, s]));
      connsById = new Map(curConns.map(c => [c.id, c]));
    }
  }

  return { shapes: curShapes, conns: curConns };
}

// Materializa uma quebra. Insere `break` ANTES de `attachNodeId`: as arestas que hoje
// entram no nó âncora passam a entrar na quebra, e o ramo "resto" da quebra volta pro nó
// âncora — de modo que, se o âncora era a raiz (sem aresta de entrada), a quebra vira a
// nova raiz (o âncora ganha entrada por porta e sai do critério de raiz do motor).
function applyAddBreak(shapes, conns, mv, mapId, gid) {
  const attachId = mapId(mv.attachNodeId);
  const target = mv.targetTerminal === 'rejected' ? 'rejected' : 'approved';

  const curShapes = shapes.map(s => ({ ...s }));
  const curConns = conns.map(c => ({ ...c }));

  // Terminal de destino: reusa um já existente do tipo certo; senão cria um.
  let termShape = curShapes.find(s => s.type === target);
  if (!termShape) {
    termShape = { id: gid(), type: target, x: 0, y: 0, w: 120, h: 44,
      label: target === 'approved' ? 'Aprovado' : 'Reprovado', color: '#ffffff' };
    curShapes.push(termShape);
  }
  const termId = termShape.id;

  const anchor = curShapes.find(s => s.id === attachId);
  const baseX = anchor ? (anchor.x || 0) - 220 : 0;
  const baseY = anchor ? (anchor.y || 0) : 0;

  const breakId = gid();
  const PORT_W = 100, PORT_H = 32, PORT_GAP_Y = 10, PORT_GAP_X = 96;
  const addPort = (parent, label, slot, nSlots, dest) => {
    const totalH = nSlots * PORT_H + (nSlots - 1) * PORT_GAP_Y;
    const p = { id: gid(), type: 'port', label,
      x: parent.x + parent.w + PORT_GAP_X,
      y: parent.y + parent.h / 2 - totalH / 2 + slot * (PORT_H + PORT_GAP_Y),
      w: PORT_W, h: PORT_H, color: '#f0fdf4' };
    curShapes.push(p);
    curConns.push({ id: gid(), from: parent.id, to: p.id, label });
    if (dest != null) curConns.push({ id: gid(), from: p.id, to: dest });
    return p;
  };

  if (mv.breakKind === 'cinema') {
    const rowDomain = [...(mv.rowDomain || [])];
    const colDomain = [...(mv.colDomain || [])];
    const eligible = new Set(mv.eligibleCells || []);
    // cells: só as NÃO elegíveis precisam ser marcadas (isCellEligible trata ausente
    // como elegível). Todas as caselas fora de `eligibleCells` viram não elegíveis.
    const cells = {};
    for (const rv of rowDomain) for (const cv of colDomain) {
      const key = `${rv}|${cv}`;
      if (!eligible.has(key)) cells[key] = false;
    }
    const w = 200, h = 120;
    const shape = { id: breakId, type: 'cineminha', x: baseX, y: baseY, w, h,
      label: mv.label || 'Quebra', color: '#fff', cinemaType: 'eligibility',
      rowVar: mv.rowVar ? { col: mv.rowVar.col, csvId: mv.rowVar.csvId } : null,
      colVar: mv.colVar ? { col: mv.colVar.col, csvId: mv.colVar.csvId } : null,
      rowDomain, colDomain, cells, resultVar: null, metadata: null,
      visibleRow: null, visibleCol: null, cellsUserEdited: true };
    curShapes.push(shape);
    // Elegível → terminal alvo; Não elegível → nó âncora (resto da política).
    addPort(shape, 'Elegível', 0, 2, termId);
    addPort(shape, 'Não Elegível', 1, 2, attachId);
  } else {
    // Losango: um port por valor. `splitValues` → terminal alvo; demais → âncora.
    const splitVals = mv.splitValues || [];
    const restVals = mv.restValues || [];
    const allVals = [...splitVals, ...restVals];
    const w = 144, h = 82;
    const shape = { id: breakId, type: 'decision', x: baseX, y: baseY, w, h,
      label: mv.label || 'Quebra', color: '#fef3c7',
      variableCol: mv.variableCol, csvId: mv.csvId, visibleVals: null };
    curShapes.push(shape);
    const n = allVals.length;
    let slot = 0;
    for (const v of splitVals) addPort(shape, v, slot++, n, termId);
    for (const v of restVals) addPort(shape, v, slot++, n, attachId);
  }

  // Insere a quebra ANTES do âncora: redireciona toda aresta que HOJE entra no âncora pra
  // quebra — exceto a aresta "resto → âncora" que a própria quebra acabou de criar (essa
  // sai de uma porta da quebra). Portas da quebra = ports apontados por breakId.
  const breakPortIds = new Set(curShapes.filter(s => s.type === 'port' &&
    curConns.some(c => c.from === breakId && c.to === s.id)).map(s => s.id));
  for (const c of curConns) {
    if (c.to === attachId && c.from !== breakId && !breakPortIds.has(c.from)) c.to = breakId;
  }

  return { curShapes, curConns };
}
