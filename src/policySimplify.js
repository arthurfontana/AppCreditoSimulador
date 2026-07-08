// Simplificação da política com prova de equivalência (Copiloto Sessão 5, DEC-IA-005/006).
// Módulo compartilhado entre o worker (que detecta candidatos e prova a equivalência via
// computeSimplifyEquivalence, mensagem COMPUTE_SIMPLIFY) e a main thread (que materializa
// os candidatos aceitos, DE VERDADE, ao "Aplicar como novo cenário") — mesmo motivo/padrão
// de src/goalSeek.js: os dois precisam da MESMA lógica de aplicação sem se importar um ao
// outro (worker roda em contexto de Worker; App.jsx só troca mensagens com ele).
//
// Cada candidato do catálogo (detectSimplifyCandidates, src/simulation.worker.js) carrega
// um `apply` mínimo — nunca referencia x/y/layout:
//   - {type:'collapse_node', nodeId, destId} — nó cujos ramos convergem pro MESMO destino
//     (losango com todos os valores no mesmo lugar, Cineminha com Elegível≡Não Elegível, ou
//     Decision Lens cuja regra não filtra nada) — religa as arestas de ENTRADA direto pro
//     destino e remove o nó + portas próprias (as únicas apontadas exclusivamente por ele).
//   - {type:'prune_node', nodeId} — nó (e descendentes exclusivos, sem outra entrada externa)
//     com chegada ZERO na base atual — nunca processa nenhuma linha, removível sem efeito.
//   - {type:'reroute_edge', connId, newTo} — religa UMA aresta específica (variável
//     re-testada: o valor que chega já era conhecido por um losango a montante, então o
//     segundo teste da mesma variável não discrimina nada — a aresta pula direto pro
//     destino que o segundo losango daria pra esse valor fixo).
//
// Aceita tanto candidatos completos (`{..., apply: {...}}`, o formato devolvido pelo
// catálogo) quanto patches `apply` isolados — útil para reaplicar só `moves.map(m=>m.apply)`
// no mesmo padrão de applyGoalSeekMoves.
export function applySimplifyCandidates(shapes, conns, candidates, idMap = null) {
  const mapId = (x) => (x == null ? x : (idMap ? (idMap[x] ?? x) : x));

  let curShapes = shapes.map(s => ({ ...s }));
  let curConns = conns.map(c => ({ ...c }));

  for (const cand of (candidates || [])) {
    const apply = cand && cand.apply ? cand.apply : cand;
    if (!apply || !apply.type) continue;

    if (apply.type === 'collapse_node') {
      const nodeId = mapId(apply.nodeId);
      const destId = mapId(apply.destId);
      // Religa toda aresta que hoje entra no nó direto pro destino final.
      curConns = curConns.map(c => (c.to === nodeId ? { ...c, to: destId } : c));
      // Portas próprias: shapes tipo `port` apontados EXCLUSIVAMENTE por este nó (idioma
      // padrão de createDecisionNode/createCinemaNode — nunca compartilhadas).
      const ownPorts = new Set(
        curShapes
          .filter(s => s.type === 'port' && curConns.some(c => c.from === nodeId && c.to === s.id))
          .map(s => s.id)
      );
      const removeIds = new Set([nodeId, ...ownPorts]);
      curConns = curConns.filter(c => !removeIds.has(c.from) && !removeIds.has(c.to));
      curShapes = curShapes.filter(s => !removeIds.has(s.id));
    } else if (apply.type === 'prune_node') {
      const nodeId = mapId(apply.nodeId);
      // Remove o nó + descendentes cuja ÚNICA entrada vem de dentro do conjunto já marcado
      // pra remoção (sem entrada externa sobrevivente) — cascata de poda, ponto fixo.
      const removeIds = new Set([nodeId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const c of curConns) {
          if (removeIds.has(c.from) && !removeIds.has(c.to)) {
            const hasExternalIn = curConns.some(cc => cc.to === c.to && !removeIds.has(cc.from));
            if (!hasExternalIn) { removeIds.add(c.to); changed = true; }
          }
        }
      }
      curConns = curConns.filter(c => !removeIds.has(c.from) && !removeIds.has(c.to));
      curShapes = curShapes.filter(s => !removeIds.has(s.id));
    } else if (apply.type === 'reroute_edge') {
      const connId = mapId(apply.connId);
      const newTo = mapId(apply.newTo);
      curConns = curConns.map(c => (c.id === connId ? { ...c, to: newTo } : c));
    }
  }

  return { shapes: curShapes, conns: curConns };
}
