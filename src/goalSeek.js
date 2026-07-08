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

export function applyGoalSeekMoves(shapes, conns, moves, idMap = null) {
  const mapId = (x) => (x == null ? x : (idMap ? (idMap[x] ?? x) : x));

  const newShapes = shapes.map(s => ({ ...s }));
  const shapesById = new Map(newShapes.map(s => [s.id, s]));
  const newConns = conns.map(c => ({ ...c }));
  const connsById = new Map(newConns.map(c => [c.id, c]));

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
    }
  }

  return { shapes: newShapes, conns: newConns };
}
