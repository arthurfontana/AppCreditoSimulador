// ── Reorganização Automática do Canvas (Auto Layout) ─────────────────────────
// Layout em camadas estilo Sugiyama, sempre horizontal (esquerda → direita)
// porque as portas saem sempre pelo lado direito do nó. Ver docs/claude/Auto-Layout.md
// para o pipeline completo (camadas → redução de cruzamentos → X por camada →
// Y isotônico PAVA → portas → área de parking) e a consciência dos "balões" das arestas.
//
// computeAutoLayout é PURA: recebe shapes/conns + o estado relevante para medir os
// balões (edgeStats/showV/showR/showI) e devolve { starts, allTargets } — as posições
// de origem e destino de cada shape/porta. A animação via RAF (pushHistory + setShapes)
// vive em App.jsx (dependência de closure do componente: refs, setState, RAF).
//
// Dependência circular App.jsx ⇄ autoLayout.js: as funções abaixo só usam
// trunc/CONN_LABEL_MAX/CONN_LABEL_CW/estConnLabelW/fmtQty/fmtPct (importados de
// App.jsx) dentro de corpos de função, então resolvem em runtime (mesmo padrão de
// analytics.js/policyIR.js/policyDocRender.js). App.jsx importa computeAutoLayout daqui.
import { trunc, CONN_LABEL_MAX, CONN_LABEL_CW, estConnLabelW, fmtQty, fmtPct } from "./App.jsx";

// Calcula as posições de destino (targets) da reorganização automática.
//   shapes_ / conns_          — shapes e conexões do canvas ativo
//   { edgeStats, showV, showR, showI } — estado para medir os balões das arestas
// Retorna { starts, allTargets } — posições de origem (top-left atual) e destino de
// cada shape/porta, prontas para a animação por RAF em App.jsx.
export function computeAutoLayout(shapes_, conns_, { edgeStats, showV, showR, showI } = {}) {
    // ── Spacing constants ────────────────────────────────────────
    const ORIGIN_X = 80, ORIGIN_Y = 80;
    // Vão nó↔ports é adaptativo (depende do label da seta mais largo do nó):
    // piso confortável, teto para não explodir a largura, +respiro fixo.
    const PORT_GAP_X_MIN = 96;   // piso do vão (mesmo nós de label curto respiram)
    const PORT_GAP_X_MAX = 260;  // teto do vão (labels muito longos não estouram o layout)
    const PORT_LABEL_PAD = 44;   // respiro total ao redor do label da seta
    const PORT_GAP_Y = 16;   // vertical gap between stacked ports of the same node
    const GAP_X = 96;        // gap between the port column and the next layer
    const GAP_Y = 36;        // vertical gap between clusters in the same layer
    const PARK_GAP_X = 160;  // gap between the flow and the "parking" area
    const PARK_GAP_Y = 44;   // vertical gap between parked components
    // Cada aresta carrega um "balão" no meio: o label do domínio + (com a
    // simulação rodando) o chip de volume·inad.real·inad.inferida empilhado
    // logo abaixo. Esses balões ficam no ponto médio da seta; se os nós ficam
    // colados, os balões se sobrepõem. Medimos cada balão e inflamos os vãos.
    const BALLOON_VPAD = 6;  // respiro vertical entre balões empilhados
    const BALLOON_HPAD = 18; // respiro horizontal do balão dentro do vão

    // ── Balloon (edge label) measurement — espelha renderConn ────
    const edgeStats_ = edgeStats || {};
    const balloonOf = (conn) => {
      const labelText = conn.label ? trunc(conn.label, CONN_LABEL_MAX) : null;
      const labelBoxW = labelText ? Math.max(56, labelText.length * CONN_LABEL_CW + 16) : 0;
      const es = edgeStats_[conn.id];
      const analytics = es ? [
        showV && fmtQty(es.qty),
        showR && fmtPct(es.inadReal),
        showI && fmtPct(es.inadInferida),
      ].filter(Boolean).join(" · ") || null : null;
      const analyticsW = analytics ? analytics.length * 6.4 : 0;
      // altura: caixa do label (20) + chip de analytics (14), empilhados
      return { w: Math.max(labelBoxW, analyticsW), h: (labelText ? 20 : 0) + (analytics ? 14 : 0) };
    };
    const bMap = {};
    conns_.forEach(c => { bMap[c.id] = balloonOf(c); });
    const maxBalloonH = conns_.reduce((m, c) => Math.max(m, bMap[c.id].h), 0);
    const maxBalloonW = conns_.reduce((m, c) => Math.max(m, bMap[c.id].w), 0);
    // Vãos horizontais/verticais entre camadas crescem para caber o balão.
    const gapX = Math.max(GAP_X, maxBalloonW + BALLOON_HPAD);
    const gapY = Math.max(GAP_Y, maxBalloonH + BALLOON_VPAD);

    // ── Classify nodes ───────────────────────────────────────────
    // Components that are never part of the decision flow → always parked.
    const NON_FLOW = new Set(['csv', 'simPanel']);
    const isPort = s => s.type === 'port';
    const ports = shapes_.filter(isPort);
    const portIds = new Set(ports.map(s => s.id));
    const parents = shapes_.filter(s => !isPort(s));
    const pmap = Object.fromEntries(parents.map(p => [p.id, p]));

    // port → owner (the parent node that emits the port via a from→port conn)
    const portOwner = {};
    conns_.forEach(c => { if (portIds.has(c.to) && !portIds.has(c.from)) portOwner[c.to] = c.from; });
    const ownedPorts = {};
    parents.forEach(p => { ownedPorts[p.id] = []; });
    ports.forEach(pt => { const o = portOwner[pt.id]; if (o && ownedPorts[o]) ownedPorts[o].push(pt); });

    // Label da seta que chega em cada port — dimensiona o vão nó↔ports.
    // Guardamos também o id da conn dona e as conns que saem do port, para
    // medir os balões incidentes e reservar a distância vertical/horizontal.
    const portConnLabel = {}, portOwnerConnId = {}, portOutConnIds = {};
    ports.forEach(pt => { portOutConnIds[pt.id] = []; });
    conns_.forEach(c => {
      if (portIds.has(c.to) && portOwner[c.to] === c.from) { portConnLabel[c.to] = c.label ?? ''; portOwnerConnId[c.to] = c.id; }
      if (portIds.has(c.from) && portOutConnIds[c.from]) portOutConnIds[c.from].push(c.id);
    });

    // resolve a conn endpoint to its owning parent (ports → owner)
    const toParent = id => (portIds.has(id) ? portOwner[id] : id);

    // ── Cluster dimensions (a node + its port column to the right) ─
    const portsH = {}, clusterW = {}, clusterH = {}, portGapX = {}, portGapY = {};
    parents.forEach(p => {
      const pts = ownedPorts[p.id];
      const mpw = pts.length ? Math.max(...pts.map(pt => pt.w)) : 0;
      // Vão vertical adaptativo: os balões nó→port ficam no ponto médio da seta,
      // ou seja, a meio passo vertical entre eles. Para não sobreporem, o passo
      // (pt.h + gap) precisa ser ≥ 2× a altura do balão mais alto incidente.
      let reqH = 0;
      pts.forEach(pt => {
        const oc = portOwnerConnId[pt.id]; if (oc && bMap[oc]) reqH = Math.max(reqH, bMap[oc].h);
        (portOutConnIds[pt.id] || []).forEach(cid => { if (bMap[cid]) reqH = Math.max(reqH, bMap[cid].h); });
      });
      const minPH = pts.length ? Math.min(...pts.map(pt => pt.h)) : 0;
      portGapY[p.id] = reqH > 0 ? Math.max(PORT_GAP_Y, 2 * (reqH + BALLOON_VPAD) - minPH) : PORT_GAP_Y;
      const ph  = pts.length ? pts.reduce((a, pt) => a + pt.h, 0) + (pts.length - 1) * portGapY[p.id] : 0;
      // vão horizontal adaptativo: cresce com o balão mais largo do nó (label do
      // domínio ou chip de analytics), dentro de [MIN, MAX]
      const maxLW = pts.reduce((m, pt) => {
        const oc = portOwnerConnId[pt.id];
        return Math.max(m, oc && bMap[oc] ? bMap[oc].w : estConnLabelW(portConnLabel[pt.id] ?? pt.label));
      }, 0);
      portGapX[p.id] = pts.length
        ? Math.min(PORT_GAP_X_MAX, Math.max(PORT_GAP_X_MIN, maxLW + PORT_LABEL_PAD))
        : 0;
      portsH[p.id]   = ph;
      clusterW[p.id] = p.w + (pts.length ? portGapX[p.id] + mpw : 0);
      clusterH[p.id] = Math.max(p.h, ph);
    });

    // ── Parent-level flow graph (cross-parent edges only) ─────────
    const adj = {}, radj = {};
    parents.forEach(p => { adj[p.id] = new Set(); radj[p.id] = new Set(); });
    conns_.forEach(c => {
      const a = toParent(c.from), b = toParent(c.to);
      if (!a || !b || a === b || !adj[a] || !adj[b]) return;
      if (NON_FLOW.has(pmap[a].type) || NON_FLOW.has(pmap[b].type)) return;
      adj[a].add(b); radj[b].add(a);
    });

    // A node belongs to the flow only if it links to another parent.
    // Datasets/panels and isolated fragments are parked separately.
    const inFlow = new Set();
    parents.forEach(p => {
      if (NON_FLOW.has(p.type)) return;
      if (adj[p.id].size > 0 || radj[p.id].size > 0) inFlow.add(p.id);
    });
    const flowNodes = parents.filter(p => inFlow.has(p.id));
    const parkedNodes = parents.filter(p => !inFlow.has(p.id));
    const flowSet = new Set(flowNodes.map(p => p.id));

    const targets = {};      // shapeId → {x, y}  (top-left)
    const portTargets = {};  // portId  → {x, y}

    // ── Layered (Sugiyama-style) layout for the flow ──────────────
    if (flowNodes.length > 0) {
      // 1) Layer assignment via longest path from sources
      const indeg = {};
      flowNodes.forEach(p => { indeg[p.id] = [...radj[p.id]].filter(n => flowSet.has(n)).length; });
      const layer = {};
      const q = flowNodes.filter(p => indeg[p.id] === 0).map(p => p.id);
      q.forEach(id => { layer[id] = 0; });
      const indegW = { ...indeg };
      for (let qi = 0; qi < q.length; qi++) {
        const id = q[qi];
        adj[id].forEach(c => {
          if (!flowSet.has(c)) return;
          layer[c] = Math.max(layer[c] ?? 0, (layer[id] ?? 0) + 1);
          if (--indegW[c] === 0) q.push(c);
        });
      }
      flowNodes.forEach(p => { if (layer[p.id] === undefined) layer[p.id] = 0; }); // cycle fallback

      // Group into layers (columns), seed order by current Y
      const layers = [];
      flowNodes.forEach(p => { const d = layer[p.id]; (layers[d] ||= []).push(p.id); });
      for (let d = 0; d < layers.length; d++) { layers[d] ||= []; layers[d].sort((a, b) => pmap[a].y - pmap[b].y); }

      // 2) Crossing reduction — barycenter ordering sweeps
      const order = {};
      const reindex = () => layers.forEach(L => L.forEach((id, i) => { order[id] = i; }));
      reindex();
      const nbrs = (id, up) => [...(up ? radj[id] : adj[id])].filter(n => flowSet.has(n));
      for (let it = 0; it < 8; it++) {
        const down = it % 2 === 0;
        const ds = [...layers.keys()];
        if (!down) ds.reverse();
        for (const d of ds) {
          const withB = layers[d].map(id => {
            const ns = nbrs(id, down);
            return [id, ns.length ? ns.reduce((a, n) => a + order[n], 0) / ns.length : order[id]];
          });
          withB.sort((a, b) => a[1] - b[1]);
          layers[d] = withB.map(x => x[0]);
          reindex();
        }
      }

      // 3) X per layer (cumulative; width includes the port column)
      const colX = [];
      let cx = ORIGIN_X;
      for (let d = 0; d < layers.length; d++) {
        colX[d] = cx;
        const w = layers[d].length ? Math.max(...layers[d].map(id => clusterW[id])) : 0;
        cx += w + gapX;
      }

      // 4) Y per node — isotonic (PAVA) placement pulling each node toward
      //    its neighbours' barycenter while keeping order + min gap (no overlap).
      const cy = {};
      layers.forEach(L => {
        let y = ORIGIN_Y;
        L.forEach(id => { cy[id] = y + clusterH[id] / 2; y += clusterH[id] + gapY; });
      });
      const resolveLayer = (L, desired) => {
        const n = L.length;
        if (n === 0) return;
        const off = new Array(n).fill(0);
        for (let i = 1; i < n; i++) off[i] = off[i - 1] + clusterH[L[i - 1]] / 2 + gapY + clusterH[L[i]] / 2;
        const tgt = L.map((id, i) => desired[id] - off[i]);
        const blocks = []; // PAVA isotonic regression (non-decreasing)
        for (let i = 0; i < n; i++) {
          let b = { sum: tgt[i], cnt: 1, val: tgt[i] };
          while (blocks.length && blocks[blocks.length - 1].val > b.val) {
            const last = blocks.pop();
            b = { sum: b.sum + last.sum, cnt: b.cnt + last.cnt, val: (b.sum + last.sum) / (b.cnt + last.cnt) };
          }
          blocks.push(b);
        }
        let i = 0;
        for (const b of blocks) for (let k = 0; k < b.cnt; k++) { cy[L[i]] = b.val + off[i]; i++; }
      };
      for (let it = 0; it < 16; it++) {
        const down = it % 2 === 0;
        const ds = [...layers.keys()];
        if (!down) ds.reverse();
        for (const d of ds) {
          const desired = {};
          layers[d].forEach(id => {
            const ns = nbrs(id, down);
            desired[id] = ns.length ? ns.reduce((a, n) => a + cy[n], 0) / ns.length : cy[id];
          });
          resolveLayer(layers[d], desired);
        }
      }

      // Normalize so the topmost cluster sits at ORIGIN_Y
      let minTop = Infinity;
      flowNodes.forEach(p => { minTop = Math.min(minTop, cy[p.id] - clusterH[p.id] / 2); });
      const shiftY = isFinite(minTop) ? ORIGIN_Y - minTop : 0;

      // Parent positions (centered within their cluster band)
      flowNodes.forEach(p => {
        const band = cy[p.id] + shiftY;
        targets[p.id] = { x: colX[layer[p.id]], y: band - p.h / 2 };
      });

      // Port positions — always to the right of the node, stacked & centered,
      // ordered by their downstream target to keep arrows from crossing.
      flowNodes.forEach(p => {
        const pts = ownedPorts[p.id];
        if (!pts.length) return;
        const band = cy[p.id] + shiftY;
        const px = colX[layer[p.id]] + p.w + portGapX[p.id];
        const dyOf = pt => {
          const outs = conns_.map(c => (c.from === pt.id ? toParent(c.to) : null))
            .filter(t => t && targets[t]);
          if (!outs.length) return null;
          return outs.reduce((a, t) => a + targets[t].y + pmap[t].h / 2, 0) / outs.length;
        };
        const sorted = [...pts].sort((a, b) => {
          const ca = dyOf(a), cb = dyOf(b);
          if (ca == null && cb == null) return a.y - b.y;
          if (ca == null) return 1;
          if (cb == null) return -1;
          return ca - cb;
        });
        let y = band - portsH[p.id] / 2;
        sorted.forEach(pt => { portTargets[pt.id] = { x: px, y }; y += pt.h + portGapY[p.id]; });
      });
    }

    // ── Parking area — non-flow + disconnected, stacked vertically ─
    let flowRight = ORIGIN_X;
    flowNodes.forEach(p => { flowRight = Math.max(flowRight, targets[p.id].x + clusterW[p.id]); });
    const parkX = flowNodes.length ? flowRight + PARK_GAP_X : ORIGIN_X;

    let py = ORIGIN_Y;
    [...parkedNodes].sort((a, b) => a.y - b.y).forEach(p => {
      const clH = clusterH[p.id];
      targets[p.id] = { x: parkX, y: py + (clH - p.h) / 2 };
      const pts = ownedPorts[p.id];
      if (pts.length) {
        const px = parkX + p.w + portGapX[p.id];
        let y = py + (clH - portsH[p.id]) / 2;
        [...pts].sort((a, b) => a.y - b.y).forEach(pt => { portTargets[pt.id] = { x: px, y }; y += pt.h + portGapY[p.id]; });
      }
      py += clH + PARK_GAP_Y;
    });

    // Collect all start positions and target positions for animation
    const starts = {};
    shapes_.forEach(s => { starts[s.id] = { x: s.x, y: s.y }; });

    const allTargets = { ...targets, ...portTargets };

    return { starts, allTargets };
}
