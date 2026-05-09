import { useState, useRef, useEffect, useCallback } from "react";

let _id = 1;
const uid = () => `e${_id++}`;

const SW = 144, SH = 82;
const COLORS = ["#ffffff","#dbeafe","#fef3c7","#dcfce7","#fce7f3","#e0e7ff","#ffedd5","#fef9c3"];
const TOOLS = [
  { id:"hand",    icon:"✋", label:"Mover"      },
  { id:"select",  icon:"↖",  label:"Selecionar" },
  { id:"rect",    icon:"▭",  label:"Retângulo"  },
  { id:"circle",  icon:"◯",  label:"Círculo"    },
  { id:"diamond", icon:"◇",  label:"Losango"    },
  { id:"connect", icon:"⟶",  label:"Conectar"   },
];

const tDist = (t) => {
  const dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY;
  return Math.sqrt(dx*dx + dy*dy);
};

export default function App() {
  const [shapes, setShapes] = useState([
    { id:"s1", type:"rect",    x:50,  y:150, w:SW, h:SH, label:"Início",     color:"#dcfce7" },
    { id:"s2", type:"diamond", x:300, y:150, w:SW, h:SH, label:"Decisão?",   color:"#fef3c7" },
    { id:"s3", type:"circle",  x:550, y:85,  w:SW, h:SH, label:"Processo A", color:"#dbeafe" },
    { id:"s4", type:"rect",    x:550, y:240, w:SW, h:SH, label:"Processo B", color:"#fce7f3" },
    { id:"s5", type:"circle",  x:800, y:162, w:SW, h:SH, label:"Fim",        color:"#e0e7ff" },
  ]);
  const [conns,   setConns]   = useState([
    { id:"c1", from:"s1", to:"s2" }, { id:"c2", from:"s2", to:"s3" },
    { id:"c3", from:"s2", to:"s4" }, { id:"c4", from:"s3", to:"s5" },
    { id:"c5", from:"s4", to:"s5" },
  ]);
  const [tool,    setTool]    = useState("hand");
  const [sel,     setSel]     = useState(null);
  const [fromId,  setFromId]  = useState(null);
  const [vp,      setVp]      = useState({ x:20, y:40, s:1 });
  const [edit,    setEdit]    = useState(null);
  const [palette, setPalette] = useState(false);
  const [hint,    setHint]    = useState(null); // string | null

  const svgRef    = useRef(null);
  const dragR     = useRef(null);
  const pinchR    = useRef(null);
  const movedR    = useRef(false);
  const longTimer = useRef(null);

  // Mirror state into refs so native event listeners stay fresh
  const vpR      = useRef(vp);      useEffect(() => { vpR.current = vp; },      [vp]);
  const shapesR  = useRef(shapes);  useEffect(() => { shapesR.current = shapes; },[shapes]);
  const connsR   = useRef(conns);   useEffect(() => { connsR.current = conns; },  [conns]);
  const toolR    = useRef(tool);    useEffect(() => { toolR.current = tool; },    [tool]);
  const fromIdR  = useRef(fromId);  useEffect(() => { fromIdR.current = fromId; },[fromId]);
  const editR    = useRef(edit);    useEffect(() => { editR.current = edit; },    [edit]);

  // ── Helpers ────────────────────────────────────────────────────
  const getBR    = () => svgRef.current.getBoundingClientRect();
  const svgPt    = (cx, cy) => { const r = getBR(); return [cx-r.left, cy-r.top]; };
  // toWorld uses vpR ref so even a stale closure gets fresh values
  const toWorld  = (sx, sy) => { const {x,y,s} = vpR.current; return [(sx-x)/s, (sy-y)/s]; };
  const ctr      = (s) => [s.x+s.w/2, s.y+s.h/2];

  const getSid = (el) => {
    while (el && el !== svgRef.current) {
      const v = el.getAttribute?.("data-sid");
      if (v) return v;
      el = el.parentElement;
    }
    return null;
  };

  // ── Zoom ────────────────────────────────────────────────────────
  const doZoom = useCallback((sx, sy, f) => {
    setVp(v => {
      const ns = Math.max(0.1, Math.min(5, v.s*f));
      const wx = (sx-v.x)/v.s, wy = (sy-v.y)/v.s;
      return { s:ns, x:sx-wx*ns, y:sy-wy*ns };
    });
  }, []);

  // ══════════════════════════════════════════════════════════════
  //  TOUCH HANDLERS — registered as native listeners (passive:false)
  //  All mutable data is accessed via refs. Values needed inside
  //  setState callbacks are captured into local variables BEFORE
  //  the call (the null bug fix).
  // ══════════════════════════════════════════════════════════════
  const onTouchStart = useCallback((e) => {
    e.preventDefault();
    clearTimeout(longTimer.current);
    movedR.current = false;
    const touches = e.touches;

    // 2-finger: start pinch
    if (touches.length === 2) {
      dragR.current = null;
      const r = getBR();
      pinchR.current = {
        dist: tDist(touches),
        mx: (touches[0].clientX + touches[1].clientX)/2 - r.left,
        my: (touches[0].clientY + touches[1].clientY)/2 - r.top,
        vpSnap: { ...vpR.current },
      };
      return;
    }

    const t = touches[0];
    const [sx, sy] = svgPt(t.clientX, t.clientY);
    const sid = getSid(e.target);
    const curTool = toolR.current;

    if (sid && curTool !== "hand") {
      const shape = shapesR.current.find(s => s.id === sid);
      if (!shape) return;

      if (curTool === "select") {
        setSel(sid); setPalette(false);
        const [wx, wy] = toWorld(sx, sy);
        dragR.current = { type:"shape", id:sid, sx, sy, offX:wx-shape.x, offY:wy-shape.y };
        // long-press = edit label
        longTimer.current = setTimeout(() => {
          if (!movedR.current) {
            setHint(null);
            setEdit({ id:sid, val:shape.label||"" });
          }
        }, 620);
        setTimeout(() => { if (!movedR.current) setHint("Segure para editar..."); }, 200);

      } else if (curTool === "connect") {
        dragR.current = { type:"tap-connect", id:sid };
      }
      // for shape-placement tools: tapping an existing shape does nothing special

    } else {
      // background (or hand tool)
      setSel(null); setFromId(null); setPalette(false);
      const { x:ox, y:oy } = vpR.current;
      dragR.current = { type:"pan", sx, sy, ox, oy };
    }
  }, []); // eslint-disable-line

  const onTouchMove = useCallback((e) => {
    e.preventDefault();
    const touches = e.touches;

    // 2-finger pinch + pan
    if (touches.length === 2 && pinchR.current) {
      const r   = getBR();
      const mx  = (touches[0].clientX + touches[1].clientX)/2 - r.left;
      const my  = (touches[0].clientY + touches[1].clientY)/2 - r.top;
      const dist  = tDist(touches);
      const scale = dist / pinchR.current.dist;
      const { mx:pmx, my:pmy, vpSnap:{x:ox,y:oy,s:os} } = pinchR.current;
      const ns  = Math.max(0.1, Math.min(5, os * scale));
      const wx  = (pmx - ox)/os, wy = (pmy - oy)/os;
      // Capture all locals; no ref access inside setState callback
      const nx  = pmx - wx*ns + (mx - pmx);
      const ny  = pmy - wy*ns + (my - pmy);
      setVp({ s:ns, x:nx, y:ny });
      return;
    }

    const dr = dragR.current;
    if (!dr) return;

    const t  = touches[0];
    const r  = getBR();
    const sx = t.clientX - r.left;
    const sy = t.clientY - r.top;
    const dx = sx - dr.sx, dy = sy - dr.sy;

    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      movedR.current = true;
      setHint(null);
      clearTimeout(longTimer.current);
    }

    if (dr.type === "pan") {
      // ⚠️ capture BEFORE setState — dr may be null inside the callback
      const ox = dr.ox, oy = dr.oy;
      setVp(v => ({ ...v, x: ox+dx, y: oy+dy }));

    } else if (dr.type === "shape") {
      // ⚠️ capture BEFORE setState
      const id = dr.id, offX = dr.offX, offY = dr.offY;
      const { x:vx, y:vy, s } = vpR.current;
      const wx = (sx-vx)/s, wy = (sy-vy)/s;
      setShapes(p => p.map(sh => sh.id === id
        ? { ...sh, x: wx-offX, y: wy-offY }
        : sh
      ));
    }
  }, []); // eslint-disable-line

  const onTouchEnd = useCallback((e) => {
    e.preventDefault();
    clearTimeout(longTimer.current);
    setHint(null);
    const moved = movedR.current;
    const dr    = dragR.current;
    const curTool = toolR.current;

    if (!moved && dr) {
      if (dr.type === "tap-connect") {
        const sid = dr.id, fid = fromIdR.current;
        if (!fid) {
          setFromId(sid);
        } else if (fid !== sid) {
          if (!connsR.current.some(c => c.from===fid && c.to===sid))
            setConns(p => [...p, { id:uid(), from:fid, to:sid }]);
          setFromId(null);
        }
      }
      if (dr.type === "pan") {
        // tap on background → place shape?
        if (curTool!=="hand" && curTool!=="select" && curTool!=="connect") {
          const { x:vx, y:vy, s } = vpR.current;
          const wx = (dr.sx - vx)/s, wy = (dr.sy - vy)/s;
          const id = uid();
          setShapes(p => [...p, { id, type:curTool, x:wx-SW/2, y:wy-SH/2, w:SW, h:SH, label:"", color:"#ffffff" }]);
          setSel(id);
        }
      }
    }

    dragR.current  = null;
    pinchR.current = null;
    movedR.current = false;
  }, []); // eslint-disable-line

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const [sx, sy] = svgPt(e.clientX, e.clientY);
    doZoom(sx, sy, e.deltaY < 0 ? 1.12 : 0.9);
  }, [doZoom]);

  useEffect(() => {
    const el = svgRef.current, o = { passive:false };
    el.addEventListener("touchstart",  onTouchStart, o);
    el.addEventListener("touchmove",   onTouchMove,  o);
    el.addEventListener("touchend",    onTouchEnd,   o);
    el.addEventListener("touchcancel", onTouchEnd,   o);
    el.addEventListener("wheel",       onWheel,      o);
    return () => {
      el.removeEventListener("touchstart",  onTouchStart);
      el.removeEventListener("touchmove",   onTouchMove);
      el.removeEventListener("touchend",    onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel",       onWheel);
    };
  }, [onTouchStart, onTouchMove, onTouchEnd, onWheel]);

  // ══════════════════════════════════════════════════════════════
  //  MOUSE HANDLERS (React synthetic events — desktop)
  // ══════════════════════════════════════════════════════════════
  const onCanvasDown = (e) => {
    if (e.button !== 0) return;
    movedR.current = false;
    const [sx, sy] = svgPt(e.clientX, e.clientY);
    setSel(null); setFromId(null); setPalette(false);
    // Always allow pan from background regardless of tool
    dragR.current = { type:"pan", sx, sy, ox:vp.x, oy:vp.y };
  };

  const onCanvasClick = (e) => {
    if (movedR.current) return;
    if (tool !== "hand" && tool !== "select" && tool !== "connect") {
      const [sx, sy] = svgPt(e.clientX, e.clientY);
      const [wx, wy] = toWorld(sx, sy);
      const id = uid();
      setShapes(p => [...p, { id, type:tool, x:wx-SW/2, y:wy-SH/2, w:SW, h:SH, label:"", color:"#ffffff" }]);
      setSel(id);
    }
  };

  const onShapeDown = (e, id) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    movedR.current = false;
    if (tool === "select") {
      setSel(id); setPalette(false);
      const [sx, sy] = svgPt(e.clientX, e.clientY);
      const [wx, wy] = toWorld(sx, sy);
      const shape = shapesR.current.find(s => s.id === id);
      dragR.current = { type:"shape", id, sx, sy, offX:wx-shape.x, offY:wy-shape.y };
    }
  };

  const onShapeClick = (e, id) => {
    e.stopPropagation();
    if (movedR.current) return;
    if (tool === "connect") {
      if (!fromId) { setFromId(id); }
      else if (fromId !== id) {
        if (!conns.some(c => c.from===fromId && c.to===id))
          setConns(p => [...p, { id:uid(), from:fromId, to:id }]);
        setFromId(null);
      }
    } else if (tool === "select") {
      setSel(id);
    }
  };

  const onShapeDbl = (e, id) => {
    e.stopPropagation();
    const s = shapesR.current.find(s => s.id === id);
    if (s) setEdit({ id, val:s.label||"" });
  };

  const onMouseMove = (e) => {
    const dr = dragR.current; // capture ref value NOW
    if (!dr) return;

    const [sx, sy] = svgPt(e.clientX, e.clientY);
    const dx = sx - dr.sx, dy = sy - dr.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedR.current = true;

    if (dr.type === "pan") {
      // ⚠️ Capture ox/oy BEFORE setState — dr could be null inside callback
      const ox = dr.ox, oy = dr.oy;
      setVp(v => ({ ...v, x:ox+dx, y:oy+dy }));

    } else if (dr.type === "shape") {
      // ⚠️ Capture id/offsets BEFORE setState
      const id = dr.id, offX = dr.offX, offY = dr.offY;
      const [wx, wy] = toWorld(sx, sy);
      setShapes(p => p.map(s => s.id === id
        ? { ...s, x:wx-offX, y:wy-offY }
        : s
      ));
    }
  };

  const onMouseUp = () => { dragR.current = null; };

  // ── Keyboard ──────────────────────────────────────────────────
  useEffect(() => {
    const h = (e) => {
      if (editR.current) return;
      if ((e.key==="Delete"||e.key==="Backspace") && sel) {
        setShapes(p => p.filter(s => s.id !== sel));
        setConns(p  => p.filter(c => c.from !== sel && c.to !== sel));
        setSel(null); setPalette(false);
      }
      if (e.key === "Escape") { setFromId(null); setSel(null); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [sel]);

  const zoomCenter = (f) => {
    const r = getBR();
    doZoom(r.width/2, r.height/2, f);
  };

  // ══════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════
  const renderConn = (conn) => {
    const from = shapes.find(s => s.id===conn.from);
    const to   = shapes.find(s => s.id===conn.to);
    if (!from || !to) return null;

    const [fx,fy] = ctr(from), [tx,ty] = ctr(to);
    const dx = tx-fx, dy = ty-fy, len = Math.sqrt(dx*dx+dy*dy)||1;
    const so = Math.max(from.w,from.h)/2+4, eo = Math.max(to.w,to.h)/2+10;
    const sx = fx+(dx/len)*so, sy = fy+(dy/len)*so;
    const ex = tx-(dx/len)*eo, ey = ty-(dy/len)*eo;
    const mx = (sx+ex)/2, my = (sy+ey)/2;
    const cv = Math.min(40, len*0.15);
    const d  = `M ${sx} ${sy} Q ${mx+(-dy/len)*cv} ${my+(dx/len)*cv} ${ex} ${ey}`;

    return (
      <g key={conn.id}>
        <path d={d} fill="none" stroke="transparent" strokeWidth={18}
          style={{ cursor:"pointer" }}
          onClick={e => { e.stopPropagation(); setConns(p => p.filter(c => c.id!==conn.id)); }}
        />
        <path d={d} fill="none" stroke="#3b82f6" strokeWidth={2}
          markerEnd="url(#arr)" style={{ pointerEvents:"none" }}
        />
      </g>
    );
  };

  const renderShape = (shape) => {
    const { id, type, x, y, w, h, label, color } = shape;
    const isSel  = sel    === id, isFrom = fromId === id;
    const stroke = isFrom ? "#f59e0b" : isSel ? "#3b82f6" : "#64748b";
    const sw     = isSel||isFrom ? 2.5 : 1.5;
    const fill   = color||"#ffffff";
    const flt    = isSel  ? "drop-shadow(0 0 11px rgba(59,130,246,.75))"
                 : isFrom ? "drop-shadow(0 0 11px rgba(245,158,11,.75))"
                 :          "drop-shadow(0 2px 6px rgba(0,0,0,.3))";
    const cur    = tool==="connect" ? "crosshair" : tool==="select" ? "grab" : "default";

    const txt = (
      <text data-sid={id} x={x+w/2} y={y+h/2}
        textAnchor="middle" dominantBaseline="middle"
        fontSize={11.5} fontFamily="system-ui,sans-serif" fontWeight="500" fill="#1e293b"
        style={{ pointerEvents:"none", userSelect:"none" }}>
        {label}
      </text>
    );
    const gp = {
      "data-sid":    id,
      onMouseDown:   (e) => onShapeDown(e, id),
      onClick:       (e) => onShapeClick(e, id),
      onDoubleClick: (e) => onShapeDbl(e, id),
      style: { cursor:cur, filter:flt },
    };

    if (type==="rect")
      return (
        <g key={id} {...gp}>
          <rect data-sid={id} x={x} y={y} width={w} height={h} rx={9}
            fill={fill} stroke={stroke} strokeWidth={sw}/>
          {txt}
        </g>
      );
    if (type==="circle")
      return (
        <g key={id} {...gp}>
          <ellipse data-sid={id} cx={x+w/2} cy={y+h/2} rx={w/2} ry={h/2}
            fill={fill} stroke={stroke} strokeWidth={sw}/>
          {txt}
        </g>
      );
    if (type==="diamond") {
      const pts = `${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}`;
      return (
        <g key={id} {...gp}>
          <polygon data-sid={id} points={pts}
            fill={fill} stroke={stroke} strokeWidth={sw}/>
          {txt}
        </g>
      );
    }
    return null;
  };

  const editShape = edit ? shapes.find(s => s.id===edit.id) : null;
  const commitEdit = () => {
    if (!edit) return;
    setShapes(p => p.map(s => s.id===edit.id ? {...s, label:edit.val} : s));
    setEdit(null);
  };
  const selShape = sel ? shapes.find(s => s.id===sel) : null;
  const canvasCursor = tool==="hand" ? "grab" : tool==="select" ? "default" : "crosshair";

  // ── JSX ────────────────────────────────────────────────────────
  return (
    <div style={{ width:"100%", height:"100vh", overflow:"hidden", position:"relative", background:"#080f1e" }}>
      <style>{`
        .wbt { transition:background .12s,color .12s; }
        .wbt:hover { background:rgba(59,130,246,.15)!important; color:#93c5fd!important; }
        .wbz:hover { background:rgba(59,130,246,.18)!important; color:#93c5fd!important; }
        @media(max-width:520px){ .wbl{ display:none!important; } }
      `}</style>

      {/* ── Toolbar ── */}
      <div style={{
        position:"absolute", top:12, left:"50%", transform:"translateX(-50%)",
        zIndex:300, display:"flex", gap:2, alignItems:"center",
        background:"rgba(8,15,30,.97)", backdropFilter:"blur(20px)",
        padding:"6px 8px", borderRadius:14,
        border:"1px solid rgba(148,163,184,.1)",
        boxShadow:"0 8px 40px rgba(0,0,0,.7)",
        maxWidth:"calc(100vw - 20px)", overflowX:"auto",
      }}>
        {TOOLS.map(t => (
          <button key={t.id} className="wbt"
            onClick={() => { setTool(t.id); setFromId(null); }}
            title={t.label}
            style={{
              display:"flex", alignItems:"center", gap:4,
              padding:"6px 10px", borderRadius:9, border:"none",
              background: tool===t.id ? "#2563eb" : "transparent",
              color:      tool===t.id ? "#fff"    : "#64748b",
              cursor:"pointer", fontSize:12, fontWeight:500,
              fontFamily:"system-ui,sans-serif", whiteSpace:"nowrap",
            }}>
            <span style={{ fontSize:15 }}>{t.icon}</span>
            <span className="wbl">{t.label}</span>
          </button>
        ))}

        <div style={{ width:1, height:20, background:"rgba(148,163,184,.12)", margin:"0 2px", flexShrink:0 }}/>

        {selShape && (
          <button className="wbt"
            onClick={() => setPalette(v => !v)} title="Cor"
            style={{
              width:26, height:26, borderRadius:7, flexShrink:0,
              border:`2px solid ${palette?"#3b82f6":"rgba(148,163,184,.25)"}`,
              background:selShape.color||"#fff", cursor:"pointer",
            }}/>
        )}

        <button className="wbt"
          onClick={() => {
            if (!sel) return;
            setShapes(p => p.filter(s => s.id!==sel));
            setConns(p  => p.filter(c => c.from!==sel&&c.to!==sel));
            setSel(null); setPalette(false);
          }}
          disabled={!sel}
          style={{
            display:"flex", alignItems:"center", gap:3,
            padding:"6px 9px", borderRadius:9, border:"none",
            background:sel?"rgba(239,68,68,.1)":"transparent",
            color:sel?"#f87171":"#374151",
            cursor:sel?"pointer":"default",
            fontSize:12, fontWeight:500,
            fontFamily:"system-ui,sans-serif", flexShrink:0,
          }}>
          🗑 <span className="wbl">Deletar</span>
        </button>
      </div>

      {/* ── Palette ── */}
      {palette && selShape && (
        <div style={{
          position:"absolute", top:66, left:"50%", transform:"translateX(-50%)",
          zIndex:400, display:"flex", gap:5, padding:"8px 12px",
          background:"rgba(8,15,30,.97)", backdropFilter:"blur(20px)",
          border:"1px solid rgba(148,163,184,.1)", borderRadius:12,
          boxShadow:"0 8px 32px rgba(0,0,0,.6)",
        }}>
          {COLORS.map(c => (
            <div key={c}
              onClick={() => { setShapes(p=>p.map(s=>s.id===sel?{...s,color:c}:s)); setPalette(false); }}
              style={{
                width:24, height:24, borderRadius:6, background:c, cursor:"pointer",
                border:selShape.color===c?"2px solid #3b82f6":"2px solid rgba(148,163,184,.2)",
              }}/>
          ))}
        </div>
      )}

      {/* ── Zoom ── */}
      <div style={{ position:"absolute", bottom:16, right:16, zIndex:200,
        display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
        {[
          ["+", ()=>zoomCenter(1.2)],
          ["−", ()=>zoomCenter(1/1.2)],
          ["⌂", ()=>setVp({x:20,y:40,s:1})],
        ].map(([icon,fn]) => (
          <button key={icon} className="wbz" onClick={fn} style={{
            width:38, height:38, borderRadius:10,
            border:"1px solid rgba(148,163,184,.12)",
            background:"rgba(8,15,30,.92)", backdropFilter:"blur(10px)",
            color:"#64748b", cursor:"pointer", fontSize:17,
            display:"flex", alignItems:"center", justifyContent:"center",
            fontFamily:"system-ui,sans-serif", transition:"all .15s",
          }}>{icon}</button>
        ))}
        <div style={{ color:"#334155", fontSize:10, fontFamily:"system-ui,sans-serif", marginTop:2 }}>
          {Math.round(vp.s*100)}%
        </div>
      </div>

      {/* ── Floating hints (connect / long-press) ── */}
      {(fromId || hint) && (
        <div style={{
          position:"absolute", bottom:16, left:"50%", transform:"translateX(-50%)",
          zIndex:200, padding:"7px 16px", borderRadius:9,
          background: fromId ? "rgba(245,158,11,.1)" : "rgba(59,130,246,.1)",
          border: fromId ? "1px solid rgba(245,158,11,.25)" : "1px solid rgba(59,130,246,.25)",
          color: fromId ? "#fbbf24" : "#93c5fd",
          fontSize:12, fontFamily:"system-ui,sans-serif", whiteSpace:"nowrap",
        }}>
          {fromId ? "⟶ Toque em outro elemento para conectar · Esc cancela" : hint}
        </div>
      )}

      {/* ── Dicas ── */}
      <div style={{
        position:"absolute", bottom:16, left:16, zIndex:100,
        background:"rgba(8,15,30,.8)", backdropFilter:"blur(10px)",
        border:"1px solid rgba(148,163,184,.07)",
        color:"#2d3f52", padding:"6px 10px", borderRadius:9,
        fontSize:10, fontFamily:"system-ui,sans-serif", lineHeight:1.9,
      }}>
        <span style={{ color:"#475569", fontWeight:600 }}>Como usar</span><br/>
        ✋ Mover → arrasta o fundo para navegar<br/>
        ↖ Selecionar → clica/arrasta elementos<br/>
        📱 Pinça 2 dedos → zoom · Segurar → editar<br/>
        Clique na seta → deletar conexão
      </div>

      {/* ── SVG ── */}
      <svg ref={svgRef} width="100%" height="100%"
        onMouseDown={onCanvasDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onClick={onCanvasClick}
        style={{ display:"block", cursor:canvasCursor, touchAction:"none" }}>

        <defs>
          <pattern id="pg" width={28*vp.s} height={28*vp.s} patternUnits="userSpaceOnUse"
            x={vp.x%(28*vp.s)} y={vp.y%(28*vp.s)}>
            <circle cx={14*vp.s} cy={14*vp.s} r={.9} fill="#0f1e35"/>
          </pattern>
          <marker id="arr" markerWidth="7" markerHeight="7" refX="6.5" refY="3.5" orient="auto">
            <polygon points="0 0.8,6.5 3.5,0 6.2" fill="#3b82f6"/>
          </marker>
        </defs>

        <rect width="100%" height="100%" fill="url(#pg)"/>

        <g transform={`translate(${vp.x},${vp.y}) scale(${vp.s})`}>
          {conns.map(renderConn)}
          {shapes.map(renderShape)}
        </g>
      </svg>

      {/* ── Label editor overlay ── */}
      {edit && editShape && (() => {
        const ex = editShape.x*vp.s+vp.x, ey = editShape.y*vp.s+vp.y;
        const ew = editShape.w*vp.s,       eh = editShape.h*vp.s;
        return (
          <input autoFocus
            value={edit.val}
            onChange={e => setEdit(p => ({...p, val:e.target.value}))}
            onBlur={commitEdit}
            onKeyDown={e => { if(e.key==="Enter"||e.key==="Escape") commitEdit(); }}
            style={{
              position:"absolute",
              left:ex+ew/2, top:ey+eh/2,
              transform:"translate(-50%,-50%)",
              width:ew*0.8, background:"transparent",
              border:"none", outline:"none", textAlign:"center",
              fontSize:Math.max(11, 11.5*vp.s),
              fontFamily:"system-ui,sans-serif", fontWeight:500,
              color:"#1e293b", zIndex:500,
            }}/>
        );
      })()}
    </div>
  );
}
