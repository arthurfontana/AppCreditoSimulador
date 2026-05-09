import { useState, useRef, useEffect, useCallback } from "react";

let _id = 1;
const uid = () => `e${_id++}`;

const SW = 144, SH = 82;
const COLORS = [
  "#ffffff","#dbeafe","#fef3c7","#dcfce7",
  "#fce7f3","#e0e7ff","#ffedd5","#fef9c3",
];
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
  return Math.sqrt(dx * dx + dy * dy);
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
  const [hint,    setHint]    = useState(null);

  const svgRef    = useRef(null);
  const dragR     = useRef(null);
  const pinchR    = useRef(null);
  const movedR    = useRef(false);
  const longTimer = useRef(null);

  const vpR     = useRef(vp);     useEffect(() => { vpR.current = vp; },      [vp]);
  const shapesR = useRef(shapes); useEffect(() => { shapesR.current = shapes; },[shapes]);
  const connsR  = useRef(conns);  useEffect(() => { connsR.current = conns; },  [conns]);
  const toolR   = useRef(tool);   useEffect(() => { toolR.current = tool; },    [tool]);
  const fromIdR = useRef(fromId); useEffect(() => { fromIdR.current = fromId; },[fromId]);
  const editR   = useRef(edit);   useEffect(() => { editR.current = edit; },    [edit]);

  const getBR   = () => svgRef.current.getBoundingClientRect();
  const svgPt   = (cx, cy) => { const r = getBR(); return [cx - r.left, cy - r.top]; };
  const toWorld = (sx, sy) => { const {x,y,s} = vpR.current; return [(sx-x)/s, (sy-y)/s]; };
  const ctr     = (s) => [s.x + s.w/2, s.y + s.h/2];

  const getSid = (el) => {
    while (el && el !== svgRef.current) {
      const v = el.getAttribute?.("data-sid");
      if (v) return v;
      el = el.parentElement;
    }
    return null;
  };

  const doZoom = useCallback((sx, sy, f) => {
    setVp(v => {
      const ns = Math.max(0.1, Math.min(5, v.s * f));
      const wx = (sx - v.x)/v.s, wy = (sy - v.y)/v.s;
      return { s:ns, x: sx - wx*ns, y: sy - wy*ns };
    });
  }, []);

  // ── Touch handlers ─────────────────────────────────────────────
  const onTouchStart = useCallback((e) => {
    e.preventDefault();
    clearTimeout(longTimer.current);
    movedR.current = false;
    const touches = e.touches;

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
        longTimer.current = setTimeout(() => {
          if (!movedR.current) { setHint(null); setEdit({ id:sid, val:shape.label||"" }); }
        }, 620);
        setTimeout(() => { if (!movedR.current) setHint("Segure para editar..."); }, 200);
      } else if (curTool === "connect") {
        dragR.current = { type:"tap-connect", id:sid };
      }
    } else {
      setSel(null); setFromId(null); setPalette(false);
      const { x:ox, y:oy } = vpR.current;
      dragR.current = { type:"pan", sx, sy, ox, oy };
    }
  }, []); // eslint-disable-line

  const onTouchMove = useCallback((e) => {
    e.preventDefault();
    const touches = e.touches;

    if (touches.length === 2 && pinchR.current) {
      const r   = getBR();
      const mx  = (touches[0].clientX + touches[1].clientX)/2 - r.left;
      const my  = (touches[0].clientY + touches[1].clientY)/2 - r.top;
      const scale = tDist(touches) / pinchR.current.dist;
      const { mx:pmx, my:pmy, vpSnap:{x:ox,y:oy,s:os} } = pinchR.current;
      const ns = Math.max(0.1, Math.min(5, os * scale));
      const wx = (pmx - ox)/os, wy = (pmy - oy)/os;
      setVp({ s:ns, x: pmx - wx*ns + (mx-pmx), y: pmy - wy*ns + (my-pmy) });
      return;
    }

    const dr = dragR.current;
    if (!dr) return;
    const t  = touches[0];
    const r  = getBR();
    const sx = t.clientX - r.left, sy = t.clientY - r.top;
    const dx = sx - dr.sx, dy = sy - dr.sy;

    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      movedR.current = true; setHint(null); clearTimeout(longTimer.current);
    }

    if (dr.type === "pan") {
      const ox = dr.ox, oy = dr.oy;
      setVp(v => ({ ...v, x: ox+dx, y: oy+dy }));
    } else if (dr.type === "shape") {
      const id = dr.id, offX = dr.offX, offY = dr.offY;
      const { x:vx, y:vy, s } = vpR.current;
      const wx = (sx-vx)/s, wy = (sy-vy)/s;
      setShapes(p => p.map(sh => sh.id === id ? { ...sh, x:wx-offX, y:wy-offY } : sh));
    }
  }, []); // eslint-disable-line

  const onTouchEnd = useCallback((e) => {
    e.preventDefault();
    clearTimeout(longTimer.current); setHint(null);
    const moved = movedR.current, dr = dragR.current;
    const curTool = toolR.current;

    if (!moved && dr) {
      if (dr.type === "tap-connect") {
        const sid = dr.id, fid = fromIdR.current;
        if (!fid) { setFromId(sid); }
        else if (fid !== sid) {
          if (!connsR.current.some(c => c.from===fid && c.to===sid))
            setConns(p => [...p, { id:uid(), from:fid, to:sid }]);
          setFromId(null);
        }
      }
      if (dr.type === "pan" && curTool!=="hand" && curTool!=="select" && curTool!=="connect") {
        const { x:vx, y:vy, s } = vpR.current;
        const wx = (dr.sx-vx)/s, wy = (dr.sy-vy)/s;
        const id = uid();
        setShapes(p => [...p, { id, type:curTool, x:wx-SW/2, y:wy-SH/2, w:SW, h:SH, label:"", color:"#ffffff" }]);
        setSel(id);
      }
    }
    dragR.current = null; pinchR.current = null; movedR.current = false;
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

  // ── Mouse handlers ─────────────────────────────────────────────
  const onCanvasDown = (e) => {
    if (e.button !== 0) return;
    movedR.current = false;
    const [sx, sy] = svgPt(e.clientX, e.clientY);
    setSel(null); setFromId(null); setPalette(false);
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
    } else if (tool === "select") { setSel(id); }
  };

  const onShapeDbl = (e, id) => {
    e.stopPropagation();
    const s = shapesR.current.find(s => s.id === id);
    if (s) setEdit({ id, val:s.label||"" });
  };

  const onMouseMove = (e) => {
    const dr = dragR.current;
    if (!dr) return;
    const [sx, sy] = svgPt(e.clientX, e.clientY);
    const dx = sx - dr.sx, dy = sy - dr.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) movedR.current = true;

    if (dr.type === "pan") {
      const ox = dr.ox, oy = dr.oy;
      setVp(v => ({ ...v, x: ox+dx, y: oy+dy }));
    } else if (dr.type === "shape") {
      const id = dr.id, offX = dr.offX, offY = dr.offY;
      const [wx, wy] = toWorld(sx, sy);
      setShapes(p => p.map(s => s.id === id ? { ...s, x:wx-offX, y:wy-offY } : s));
    }
  };

  const onMouseUp = () => { dragR.current = null; };

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

  const zoomCenter = (f) => { const r = getBR(); doZoom(r.width/2, r.height/2, f); };

  // ── Render ──────────────────────────────────────────────────────
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
          markerEnd="url(#arr)" style={{ pointerEvents:"none" }} />
      </g>
    );
  };

  const renderShape = (shape) => {
    const { id, type, x, y, w, h, label, color } = shape;
    const isSel  = sel    === id, isFrom = fromId === id;
    const stroke = isFrom ? "#f59e0b" : isSel ? "#3b82f6" : "#94a3b8";
    const sw     = isSel||isFrom ? 2 : 1.5;
    const fill   = color || "#ffffff";
    const flt    = isSel  ? "drop-shadow(0 0 0 2px rgba(59,130,246,.3)) drop-shadow(0 2px 8px rgba(59,130,246,.2))"
                 : isFrom ? "drop-shadow(0 0 0 2px rgba(245,158,11,.3)) drop-shadow(0 2px 8px rgba(245,158,11,.2))"
                 :          "drop-shadow(0 1px 4px rgba(0,0,0,.1))";
    const cur    = tool==="connect" ? "crosshair" : tool==="select" ? "grab" : "default";

    const txt = (
      <text data-sid={id} x={x+w/2} y={y+h/2}
        textAnchor="middle" dominantBaseline="middle"
        fontSize={12} fontFamily="'DM Sans', system-ui, sans-serif" fontWeight="500"
        fill="#1e293b" style={{ pointerEvents:"none", userSelect:"none" }}>
        {label}
      </text>
    );
    const gp = {
      "data-sid": id,
      onMouseDown:   (e) => onShapeDown(e, id),
      onClick:       (e) => onShapeClick(e, id),
      onDoubleClick: (e) => onShapeDbl(e, id),
      style: { cursor:cur, filter:flt },
    };

    if (type === "rect") return (
      <g key={id} {...gp}>
        <rect data-sid={id} x={x} y={y} width={w} height={h} rx={10}
          fill={fill} stroke={stroke} strokeWidth={sw}/>
        {txt}
      </g>
    );
    if (type === "circle") return (
      <g key={id} {...gp}>
        <ellipse data-sid={id} cx={x+w/2} cy={y+h/2} rx={w/2} ry={h/2}
          fill={fill} stroke={stroke} strokeWidth={sw}/>
        {txt}
      </g>
    );
    if (type === "diamond") {
      const pts = `${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}`;
      return (
        <g key={id} {...gp}>
          <polygon data-sid={id} points={pts} fill={fill} stroke={stroke} strokeWidth={sw}/>
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

  // ── JSX ─────────────────────────────────────────────────────────
  return (
    <div style={{ display:"flex", width:"100%", height:"100vh", overflow:"hidden",
      fontFamily:"'DM Sans', system-ui, sans-serif", background:"#f1f5f9" }}>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');
        * { box-sizing:border-box; margin:0; padding:0; }
        .wbt { transition: background .12s, color .12s; }
        .wbt:hover { background: #eff6ff !important; color: #2563eb !important; }
        .wbz:hover { background: #eff6ff !important; color: #2563eb !important; }
        .wbz:active { transform: scale(.93); }
        .pal-chip:hover { transform: scale(1.15); outline: 2px solid #3b82f6; }
        @media(max-width:560px){ .wbl{ display:none!important; } }
      `}</style>

      {/* ════════════════ CANVAS AREA ════════════════ */}
      <div style={{ flex:1, position:"relative", overflow:"hidden" }}>

        {/* ── Toolbar ── */}
        <div style={{
          position:"absolute", top:14, left:"50%", transform:"translateX(-50%)",
          zIndex:300, display:"flex", gap:2, alignItems:"center",
          background:"#ffffff",
          padding:"6px 8px", borderRadius:14,
          border:"1px solid #e2e8f0",
          boxShadow:"0 2px 12px rgba(0,0,0,.08), 0 1px 3px rgba(0,0,0,.06)",
          maxWidth:"calc(100% - 24px)", overflowX:"auto",
        }}>
          {TOOLS.map(t => (
            <button key={t.id} className="wbt"
              onClick={() => { setTool(t.id); setFromId(null); }}
              title={t.label}
              style={{
                display:"flex", alignItems:"center", gap:5,
                padding:"6px 11px", borderRadius:9, border:"none",
                background: tool===t.id ? "#2563eb" : "transparent",
                color:      tool===t.id ? "#ffffff" : "#475569",
                cursor:"pointer", fontSize:12.5, fontWeight:500,
                fontFamily:"inherit", whiteSpace:"nowrap",
              }}>
              <span style={{ fontSize:15, lineHeight:1 }}>{t.icon}</span>
              <span className="wbl">{t.label}</span>
            </button>
          ))}

          <div style={{ width:1, height:22, background:"#e2e8f0", margin:"0 3px", flexShrink:0 }}/>

          {/* Color swatch */}
          {selShape && (
            <button className="wbt"
              onClick={() => setPalette(v => !v)}
              title="Cor do elemento"
              style={{
                width:28, height:28, borderRadius:8, flexShrink:0,
                border:`2px solid ${palette ? "#3b82f6" : "#e2e8f0"}`,
                background:selShape.color||"#fff", cursor:"pointer",
                transition:"border-color .15s",
              }}/>
          )}

          {/* Delete */}
          <button className="wbt"
            onClick={() => {
              if (!sel) return;
              setShapes(p => p.filter(s => s.id!==sel));
              setConns(p  => p.filter(c => c.from!==sel && c.to!==sel));
              setSel(null); setPalette(false);
            }}
            disabled={!sel}
            style={{
              display:"flex", alignItems:"center", gap:4,
              padding:"6px 10px", borderRadius:9, border:"none",
              background: sel ? "#fff1f2" : "transparent",
              color:      sel ? "#e11d48" : "#cbd5e1",
              cursor:     sel ? "pointer" : "default",
              fontSize:12.5, fontWeight:500, fontFamily:"inherit", flexShrink:0,
            }}>
            🗑 <span className="wbl">Deletar</span>
          </button>
        </div>

        {/* ── Color palette dropdown ── */}
        {palette && selShape && (
          <div style={{
            position:"absolute", top:70, left:"50%", transform:"translateX(-50%)",
            zIndex:400, display:"flex", gap:6, padding:"10px 14px",
            background:"#ffffff", border:"1px solid #e2e8f0", borderRadius:12,
            boxShadow:"0 8px 24px rgba(0,0,0,.1)",
          }}>
            {COLORS.map(c => (
              <div key={c} className="pal-chip"
                onClick={() => {
                  setShapes(p => p.map(s => s.id===sel ? {...s,color:c} : s));
                  setPalette(false);
                }}
                style={{
                  width:26, height:26, borderRadius:7, background:c, cursor:"pointer",
                  border: selShape.color===c ? "2.5px solid #3b82f6" : "1.5px solid #e2e8f0",
                  transition:"transform .12s",
                }}/>
            ))}
          </div>
        )}

        {/* ── Zoom controls ── */}
        <div style={{
          position:"absolute", bottom:16, right:16, zIndex:200,
          display:"flex", flexDirection:"column", alignItems:"center", gap:3,
        }}>
          {[
            ["+", () => zoomCenter(1.2),   "Zoom in"],
            ["−", () => zoomCenter(1/1.2), "Zoom out"],
            ["⌂", () => setVp({x:20,y:40,s:1}), "Resetar"],
          ].map(([icon, fn, title]) => (
            <button key={icon} className="wbz" onClick={fn} title={title}
              style={{
                width:36, height:36, borderRadius:10,
                border:"1px solid #e2e8f0",
                background:"#ffffff",
                boxShadow:"0 1px 4px rgba(0,0,0,.08)",
                color:"#64748b", cursor:"pointer", fontSize:17,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontFamily:"inherit", transition:"all .15s",
              }}>{icon}</button>
          ))}
          <div style={{ color:"#94a3b8", fontSize:10, fontFamily:"inherit", marginTop:1 }}>
            {Math.round(vp.s * 100)}%
          </div>
        </div>

        {/* ── Floating hint (connect / long-press) ── */}
        {(fromId || hint) && (
          <div style={{
            position:"absolute", bottom:16, left:"50%", transform:"translateX(-50%)",
            zIndex:200, padding:"8px 18px", borderRadius:10,
            background: fromId ? "#fffbeb" : "#eff6ff",
            border:     fromId ? "1px solid #fde68a" : "1px solid #bfdbfe",
            color:      fromId ? "#92400e"            : "#1d4ed8",
            fontSize:12.5, fontFamily:"inherit", whiteSpace:"nowrap",
            boxShadow:"0 2px 8px rgba(0,0,0,.08)",
          }}>
            {fromId
              ? "⟶ Clique em outro elemento para conectar · Esc cancela"
              : hint}
          </div>
        )}

        {/* ── Tips badge ── */}
        <div style={{
          position:"absolute", bottom:16, left:16, zIndex:100,
          background:"#ffffff", border:"1px solid #e2e8f0",
          boxShadow:"0 1px 4px rgba(0,0,0,.06)",
          color:"#94a3b8", padding:"7px 11px", borderRadius:10,
          fontSize:10.5, fontFamily:"inherit", lineHeight:1.9,
        }}>
          <span style={{ color:"#64748b", fontWeight:600 }}>Dicas</span><br/>
          ✋ Mover → arrasta para navegar<br/>
          ↖ Selecionar → clica e arrasta elementos<br/>
          📱 Pinça → zoom · Segurar → editar texto<br/>
          Clique na seta → deletar conexão
        </div>

        {/* ── SVG Canvas ── */}
        <svg ref={svgRef} width="100%" height="100%"
          onMouseDown={onCanvasDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onClick={onCanvasClick}
          style={{ display:"block", cursor:canvasCursor, touchAction:"none" }}>

          <defs>
            {/* dot grid */}
            <pattern id="pg" width={28*vp.s} height={28*vp.s} patternUnits="userSpaceOnUse"
              x={vp.x%(28*vp.s)} y={vp.y%(28*vp.s)}>
              <circle cx={14*vp.s} cy={14*vp.s} r={1} fill="#c8d3de"/>
            </pattern>
            {/* arrowhead */}
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

        {/* ── Inline label editor ── */}
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
                left: ex + ew/2, top: ey + eh/2,
                transform:"translate(-50%,-50%)",
                width: ew * 0.8,
                background:"transparent", border:"none", outline:"none",
                textAlign:"center",
                fontSize: Math.max(11, 12*vp.s),
                fontFamily:"'DM Sans', system-ui, sans-serif",
                fontWeight:500, color:"#1e293b", zIndex:500,
              }}/>
          );
        })()}
      </div>

      {/* ════════════════ RIGHT PANEL ════════════════ */}
      <div style={{
        width:272, flexShrink:0,
        background:"#ffffff",
        borderLeft:"1px solid #e2e8f0",
        display:"flex", flexDirection:"column",
        overflow:"hidden",
      }}>
        {/* Panel header */}
        <div style={{
          padding:"16px 18px 14px",
          borderBottom:"1px solid #f1f5f9",
          display:"flex", alignItems:"center", gap:8,
        }}>
          <div style={{
            width:6, height:6, borderRadius:"50%", background:"#3b82f6",
            boxShadow:"0 0 0 3px #dbeafe",
          }}/>
          <span style={{ fontSize:13, fontWeight:600, color:"#1e293b", letterSpacing:.1 }}>
            Painel
          </span>
        </div>

        {/* Empty state */}
        <div style={{
          flex:1, display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"center",
          gap:10, padding:24, color:"#cbd5e1",
        }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect x="6" y="6" width="36" height="36" rx="8"
              stroke="#e2e8f0" strokeWidth="2" strokeDasharray="4 3"/>
            <circle cx="24" cy="22" r="5" stroke="#dde3ea" strokeWidth="1.5"/>
            <path d="M16 34 Q24 28 32 34" stroke="#dde3ea" strokeWidth="1.5"
              strokeLinecap="round" fill="none"/>
          </svg>
          <p style={{ fontSize:12, color:"#94a3b8", textAlign:"center", lineHeight:1.6 }}>
            Funcionalidades em breve
          </p>
        </div>
      </div>

    </div>
  );
}
