import { useState, useRef, useEffect, useCallback, useMemo } from "react";

let _id = 1;
const uid = () => `e${_id++}`;

// ── Constants ────────────────────────────────────────────────────────────────
const SW = 144, SH = 82;
const CSV_W = 500, CSV_H = 310, CSV_TH = 38; // title bar height
const CSV_MINI_W = 160, CSV_MINI_H = 64;
const MAX_ROWS = 200;
const MAX_DISTINCT = 10;

const COLORS = ["#ffffff","#dbeafe","#fef3c7","#dcfce7","#fce7f3","#e0e7ff","#ffedd5","#fef9c3"];
const TOOLS  = [
  { id:"hand",     icon:"✋", label:"Mover"      },
  { id:"select",   icon:"↖",  label:"Selecionar" },
  { id:"rect",     icon:"▭",  label:"Retângulo"  },
  { id:"circle",   icon:"◯",  label:"Círculo"    },
  { id:"diamond",  icon:"◇",  label:"Losango"    },
  { id:"connect",  icon:"⟶",  label:"Conectar"   },
  { id:"approved", icon:"✅", label:"Aprovado"   },
  { id:"rejected", icon:"❌", label:"Reprovado"  },
];

const COL_TYPES = [
  { value:"id",       icon:"🔑", label:"ID"      },
  { value:"decision", icon:"🔀", label:"Decisão" },
  { value:"qty",      icon:"📊", label:"Qtd"     },
];

const DELIMITERS = [
  { value:",",  label:'Vírgula  ","'  },
  { value:";",  label:'Ponto e vírgula  ";"' },
  { value:"|",  label:'Pipe  "|"'     },
  { value:"\t", label:"Tabulação"      },
];

// ── CSV helpers ──────────────────────────────────────────────────────────────
function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).slice(0, 12).filter(l => l.trim());
  if (!lines.length) return { delimiter:",", confident:true };
  const scores = {};
  for (const d of [",",";","|","\t"]) {
    const counts = lines.map(l => l.split(d).length - 1);
    const avg = counts.reduce((a,b)=>a+b,0) / counts.length;
    if (avg < 1) { scores[d] = 0; continue; }
    const variance = counts.reduce((a,b)=>a+Math.abs(b-avg),0) / counts.length;
    scores[d] = avg / (variance + 1);
  }
  const sorted = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  const confident = sorted[0][1] > 0 && sorted[0][1] / (sorted[1][1]+0.01) > 1.8;
  return { delimiter: sorted[0][1] > 0 ? sorted[0][0] : ",", confident };
}

function parseCSV(text, delimiter, hasHeader) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const split = (line) => {
    const res = []; let f = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === delimiter && !q) { res.push(f.trim()); f = ""; }
      else f += c;
    }
    res.push(f.trim());
    return res;
  };
  if (!lines.length) return { headers:[], rows:[] };
  const first = split(lines[0]);
  const headers = hasHeader ? first : first.map((_,i)=>`Coluna ${i+1}`);
  const rows = (hasHeader ? lines.slice(1) : lines).map(split);
  return { headers, rows };
}

const tDist = (t) => { const dx=t[0].clientX-t[1].clientX,dy=t[0].clientY-t[1].clientY; return Math.sqrt(dx*dx+dy*dy); };
const trunc = (s, n) => s && s.length > n ? s.slice(0,n-1)+"…" : s;
const fmtQty = (n) => n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}k` : Number.isInteger(n) ? String(n) : n.toFixed(1);

// ── Flow engine ──────────────────────────────────────────────────────────────
function buildFlowGraph(shapes, conns) {
  const out = {}, inc = {};
  for (const s of shapes) { out[s.id] = []; inc[s.id] = []; }
  for (const c of conns) {
    if (out[c.from]) out[c.from].push({to: c.to, label: c.label ?? ''});
    if (inc[c.to])   inc[c.to].push({from: c.from, label: c.label ?? ''});
  }
  return {out, inc};
}

function validateFlow(shapes, conns) {
  const errors = {};
  const FLOW = new Set(['decision','port','approved','rejected']);
  const TERM = new Set(['approved','rejected']);
  const flowShapes = shapes.filter(s => FLOW.has(s.type));
  if (flowShapes.length === 0) return errors;
  const {out} = buildFlowGraph(shapes, conns);

  function dfs(nodeId, path) {
    if (path.has(nodeId)) { errors[nodeId] = 'Loop infinito detectado'; return false; }
    const node = shapes.find(s => s.id === nodeId);
    if (!node) return false;
    if (TERM.has(node.type)) return true;
    const edges = out[nodeId] || [];
    if (edges.length === 0) { errors[nodeId] = 'Caminho sem finalização'; return false; }
    path.add(nodeId);
    let ok = true;
    for (const e of edges) { if (!dfs(e.to, new Set(path))) ok = false; }
    if (!ok && !errors[nodeId]) errors[nodeId] = 'Possui caminhos sem finalização';
    return ok;
  }
  shapes.filter(s => s.type === 'decision').forEach(d => dfs(d.id, new Set()));
  return errors;
}

function runSimulation(shapes, conns, csvStore) {
  const {out} = buildFlowGraph(shapes, conns);
  const shapesMap = Object.fromEntries(shapes.map(s => [s.id, s]));
  const TERM = new Set(['approved','rejected']);
  const portIds = new Set(shapes.filter(s => s.type === 'port').map(s => s.id));
  const decWithPortInc = new Set(conns.filter(c => portIds.has(c.from)).map(c => c.to));
  const rootDecisions = shapes.filter(s => s.type === 'decision' && !decWithPortInc.has(s.id));
  if (rootDecisions.length === 0) return {totalQty:0, approvedQty:0, rejectedQty:0, approvalRate:0};

  function traverseRow(row, headers, startId) {
    let cur = startId; const visited = new Set();
    while (cur) {
      if (visited.has(cur)) return null;
      visited.add(cur);
      const node = shapesMap[cur]; if (!node) return null;
      if (TERM.has(node.type)) return node.type;
      if (node.type === 'decision') {
        const colIdx = headers.indexOf(node.variableCol);
        const val = (colIdx >= 0 ? (row[colIdx] ?? '') : '').trim();
        const match = (out[cur] || []).find(e => (e.label ?? '').trim() === val);
        if (!match) return null;
        cur = match.to;
      } else if (node.type === 'port') {
        const edges = out[cur] || []; if (edges.length === 0) return null;
        cur = edges[0].to;
      } else return null;
    }
    return null;
  }

  let totalQty = 0, approvedQty = 0, rejectedQty = 0;
  for (const [csvId, csv] of Object.entries(csvStore)) {
    const qtyColName = Object.entries(csv.columnTypes || {}).find(([,t]) => t === 'qty')?.[0];
    const qtyIdx = qtyColName ? csv.headers.indexOf(qtyColName) : -1;
    const csvRoots = rootDecisions.filter(d => d.csvId === csvId);
    if (csvRoots.length === 0) continue;
    const rootId = csvRoots[0].id;
    for (const row of csv.rows) {
      const qty = qtyIdx >= 0 ? (parseFloat(row[qtyIdx]) || 0) : 1;
      totalQty += qty;
      const res = traverseRow(row, csv.headers, rootId);
      if (res === 'approved') approvedQty += qty;
      else if (res === 'rejected') rejectedQty += qty;
    }
  }
  return {totalQty, approvedQty, rejectedQty, approvalRate: totalQty > 0 ? (approvedQty / totalQty) * 100 : 0};
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [shapes, setShapes] = useState([
    {id:"s1",type:"rect",   x:50, y:150,w:SW,h:SH,label:"Início",    color:"#dcfce7"},
    {id:"s2",type:"diamond",x:300,y:150,w:SW,h:SH,label:"Decisão?",  color:"#fef3c7"},
    {id:"s3",type:"circle", x:550,y:85, w:SW,h:SH,label:"Processo A",color:"#dbeafe"},
    {id:"s4",type:"rect",   x:550,y:240,w:SW,h:SH,label:"Processo B",color:"#fce7f3"},
    {id:"s5",type:"circle", x:800,y:162,w:SW,h:SH,label:"Fim",       color:"#e0e7ff"},
  ]);
  const [conns,   setConns]   = useState([
    {id:"c1",from:"s1",to:"s2"},{id:"c2",from:"s2",to:"s3"},
    {id:"c3",from:"s2",to:"s4"},{id:"c4",from:"s3",to:"s5"},
    {id:"c5",from:"s4",to:"s5"},
  ]);
  const [tool,       setTool]       = useState("hand");
  const [sel,        setSel]        = useState(null);
  const [fromId,     setFromId]     = useState(null);
  const [vp,         setVp]         = useState({x:20,y:40,s:1});
  const [edit,       setEdit]       = useState(null);
  const [palette,    setPalette]    = useState(false);
  const [hint,       setHint]       = useState(null);
  // CSV state
  const [csvStore,   setCsvStore]   = useState({});     // {[csvId]: {name,headers,rows,columnTypes}}
  const [wizard,     setWizard]     = useState(null);   // null | wizard obj
  const [activeCell, setActiveCell] = useState(null);   // {shapeId,csvId,ri,ci}
  // Credit simulator state
  const [editConn,   setEditConn]   = useState(null);   // {id, val} — edição de label de conexão
  const [panelDrag,  setPanelDrag]  = useState(null);   // {col, csvId} — drag em andamento
  const [ghostPos,   setGhostPos]   = useState(null);   // {x, y} — posição do ghost element
  const [importError,setImportError]= useState(null);   // string | null — erro de importação de fluxo
  const [importWarn, setImportWarn] = useState(null);   // string | null — aviso pós-importação

  // ── Refs ──────────────────────────────────────────────────────
  const svgRef        = useRef(null);
  const fileInputRef  = useRef(null);
  const dragR         = useRef(null);
  const pinchR        = useRef(null);
  const movedR        = useRef(false);
  const longTimer     = useRef(null);
  const connClickTimer= useRef(null);

  const vpR         = useRef(vp);         useEffect(()=>{vpR.current=vp},         [vp]);
  const shapesR     = useRef(shapes);     useEffect(()=>{shapesR.current=shapes},  [shapes]);
  const connsR      = useRef(conns);      useEffect(()=>{connsR.current=conns},    [conns]);
  const toolR       = useRef(tool);       useEffect(()=>{toolR.current=tool},      [tool]);
  const fromIdR     = useRef(fromId);     useEffect(()=>{fromIdR.current=fromId},  [fromId]);
  const editR       = useRef(edit);       useEffect(()=>{editR.current=edit},      [edit]);
  const csvStoreR   = useRef(csvStore);   useEffect(()=>{csvStoreR.current=csvStore},  [csvStore]);
  const activeCellR = useRef(activeCell); useEffect(()=>{activeCellR.current=activeCell},[activeCell]);
  const panelDragR  = useRef(panelDrag);  useEffect(()=>{panelDragR.current=panelDrag}, [panelDrag]);
  const editConnR   = useRef(editConn);   useEffect(()=>{editConnR.current=editConn},   [editConn]);
  const flowImportRef = useRef(null);

  // ── Simulation engine (reactive) ──────────────────────────────
  const flowErrors = useMemo(() => validateFlow(shapes, conns), [shapes, conns]);
  const simResult  = useMemo(() => runSimulation(shapes, conns, csvStore), [shapes, conns, csvStore]);

  // ── Geometry ──────────────────────────────────────────────────
  const getBR   = () => svgRef.current.getBoundingClientRect();
  const svgPt   = (cx,cy) => { const r=getBR(); return [cx-r.left,cy-r.top]; };
  const toWorld = (sx,sy) => { const {x,y,s}=vpR.current; return [(sx-x)/s,(sy-y)/s]; };
  const ctr     = (s) => [s.x+s.w/2, s.y+s.h/2];
  const getSid  = (el) => {
    while (el && el!==svgRef.current) {
      const v = el.getAttribute?.("data-sid"); if (v) return v;
      el = el.parentElement;
    }
    return null;
  };

  // ── Zoom ──────────────────────────────────────────────────────
  const doZoom = useCallback((sx,sy,f) => {
    setVp(v => { const ns=Math.max(0.1,Math.min(5,v.s*f)), wx=(sx-v.x)/v.s, wy=(sy-v.y)/v.s; return {s:ns,x:sx-wx*ns,y:sy-wy*ns}; });
  },[]);

  // ── Touch handlers ────────────────────────────────────────────
  const onTouchStart = useCallback((e) => {
    e.preventDefault(); clearTimeout(longTimer.current); movedR.current=false;
    const touches=e.touches;
    if (touches.length===2) {
      dragR.current=null;
      const r=getBR();
      pinchR.current={dist:tDist(touches),mx:(touches[0].clientX+touches[1].clientX)/2-r.left,my:(touches[0].clientY+touches[1].clientY)/2-r.top,vpSnap:{...vpR.current}};
      return;
    }
    const t=touches[0], [sx,sy]=svgPt(t.clientX,t.clientY), sid=getSid(e.target), curTool=toolR.current;
    if (sid && curTool!=="hand") {
      const shape=shapesR.current.find(s=>s.id===sid);
      if (!shape) return;
      if (curTool==="select") {
        const [wx,wy]=toWorld(sx,sy);
        if (shape.type==="csv" && !shape.minimized && wy>shape.y+CSV_TH) return;
        setSel(sid); setPalette(false);
        dragR.current={type:"shape",id:sid,sx,sy,offX:wx-shape.x,offY:wy-shape.y};
        longTimer.current=setTimeout(()=>{ if(!movedR.current){setHint(null);setEdit({id:sid,val:shape.label||""});}},620);
        setTimeout(()=>{ if(!movedR.current) setHint("Segure para editar..."); },200);
      } else if (curTool==="connect") {
        dragR.current={type:"tap-connect",id:sid};
      }
    } else {
      setSel(null); setFromId(null); setPalette(false); setActiveCell(null);
      const {x:ox,y:oy}=vpR.current;
      dragR.current={type:"pan",sx,sy,ox,oy};
    }
  },[]); // eslint-disable-line

  const onTouchMove = useCallback((e) => {
    e.preventDefault(); const touches=e.touches;
    if (touches.length===2 && pinchR.current) {
      const r=getBR(),mx=(touches[0].clientX+touches[1].clientX)/2-r.left,my=(touches[0].clientY+touches[1].clientY)/2-r.top;
      const scale=tDist(touches)/pinchR.current.dist;
      const {mx:pmx,my:pmy,vpSnap:{x:ox,y:oy,s:os}}=pinchR.current;
      const ns=Math.max(0.1,Math.min(5,os*scale)),wx=(pmx-ox)/os,wy=(pmy-oy)/os;
      setVp({s:ns,x:pmx-wx*ns+(mx-pmx),y:pmy-wy*ns+(my-pmy)}); return;
    }
    const dr=dragR.current; if (!dr) return;
    const t=touches[0],r=getBR(),sx=t.clientX-r.left,sy=t.clientY-r.top,dx=sx-dr.sx,dy=sy-dr.sy;
    if (Math.abs(dx)>5||Math.abs(dy)>5){movedR.current=true;setHint(null);clearTimeout(longTimer.current);}
    if (dr.type==="pan"){const ox=dr.ox,oy=dr.oy;setVp(v=>({...v,x:ox+dx,y:oy+dy}));}
    else if(dr.type==="shape"){const id=dr.id,offX=dr.offX,offY=dr.offY,{x:vx,y:vy,s}=vpR.current,wx=(sx-vx)/s,wy=(sy-vy)/s;setShapes(p=>p.map(sh=>sh.id===id?{...sh,x:wx-offX,y:wy-offY}:sh));}
  },[]); // eslint-disable-line

  const onTouchEnd = useCallback((e) => {
    e.preventDefault(); clearTimeout(longTimer.current); setHint(null);
    const moved=movedR.current,dr=dragR.current,curTool=toolR.current;
    if (!moved && dr) {
      if (dr.type==="tap-connect"){const sid=dr.id,fid=fromIdR.current;if(!fid){setFromId(sid);}else if(fid!==sid){if(!connsR.current.some(c=>c.from===fid&&c.to===sid))setConns(p=>[...p,{id:uid(),from:fid,to:sid}]);setFromId(null);}}
      if (dr.type==="pan"&&curTool!=="hand"&&curTool!=="select"&&curTool!=="connect"){const{x:vx,y:vy,s}=vpR.current,wx=(dr.sx-vx)/s,wy=(dr.sy-vy)/s,id=uid();const isTerminal=curTool==="approved"||curTool==="rejected";const nw=isTerminal?120:SW,nh=isTerminal?44:SH;const lbl=curTool==="approved"?"Aprovado":curTool==="rejected"?"Reprovado":"";setShapes(p=>[...p,{id,type:curTool,x:wx-nw/2,y:wy-nh/2,w:nw,h:nh,label:lbl,color:"#ffffff"}]);setSel(id);}
    }
    dragR.current=null; pinchR.current=null; movedR.current=false;
  },[]); // eslint-disable-line

  const onWheel = useCallback((e)=>{e.preventDefault();const[sx,sy]=svgPt(e.clientX,e.clientY);doZoom(sx,sy,e.deltaY<0?1.12:0.9);},[doZoom]);

  useEffect(()=>{
    const el=svgRef.current,o={passive:false};
    el.addEventListener("touchstart",onTouchStart,o); el.addEventListener("touchmove",onTouchMove,o);
    el.addEventListener("touchend",onTouchEnd,o);     el.addEventListener("touchcancel",onTouchEnd,o);
    el.addEventListener("wheel",onWheel,o);
    return()=>{el.removeEventListener("touchstart",onTouchStart);el.removeEventListener("touchmove",onTouchMove);el.removeEventListener("touchend",onTouchEnd);el.removeEventListener("touchcancel",onTouchEnd);el.removeEventListener("wheel",onWheel);};
  },[onTouchStart,onTouchMove,onTouchEnd,onWheel]);

  // ── Mouse handlers ────────────────────────────────────────────
  const onCanvasDown = (e) => {
    if (panelDragR.current) return;
    if (e.button!==0) return;
    movedR.current=false; setSel(null); setFromId(null); setPalette(false); setActiveCell(null);
    const [sx,sy]=svgPt(e.clientX,e.clientY);
    dragR.current={type:"pan",sx,sy,ox:vp.x,oy:vp.y};
  };
  const onCanvasClick = (e) => {
    if (movedR.current) return;
    if (tool!=="hand"&&tool!=="select"&&tool!=="connect") {
      const [sx,sy]=svgPt(e.clientX,e.clientY),[wx,wy]=toWorld(sx,sy),id=uid();
      const isTerminal=tool==="approved"||tool==="rejected";
      const nw=isTerminal?120:SW, nh=isTerminal?44:SH;
      const lbl=tool==="approved"?"Aprovado":tool==="rejected"?"Reprovado":"";
      setShapes(p=>[...p,{id,type:tool,x:wx-nw/2,y:wy-nh/2,w:nw,h:nh,label:lbl,color:"#ffffff"}]);
      setSel(id);
    }
  };
  const onShapeDown = (e, id) => {
    e.stopPropagation(); if (e.button!==0) return;
    movedR.current=false;
    const shape=shapesR.current.find(s=>s.id===id);
    if (tool==="select") {
      if (shape?.type==="csv"&&!shape.minimized) {
        const [sx,sy]=svgPt(e.clientX,e.clientY),[,wy]=toWorld(sx,sy);
        if (wy>shape.y+CSV_TH) return; // inside table area — don't drag
      }
      setSel(id); setPalette(false);
      const [sx,sy]=svgPt(e.clientX,e.clientY),[wx,wy]=toWorld(sx,sy);
      dragR.current={type:"shape",id,sx,sy,offX:wx-shape.x,offY:wy-shape.y};
    }
  };
  const onShapeClick = (e, id) => {
    e.stopPropagation(); if (movedR.current) return;
    if (tool==="connect"){
      const s=shapes.find(sh=>sh.id===id);
      if (s?.type==="simPanel") return; // simPanel cannot be connected
      if(!fromId){setFromId(id);}
      else if(fromId!==id){
        const fromShape=shapes.find(sh=>sh.id===fromId);
        if (fromShape?.type!=="simPanel") {
          if(!conns.some(c=>c.from===fromId&&c.to===id)) setConns(p=>[...p,{id:uid(),from:fromId,to:id}]);
        }
        setFromId(null);
      }
    }
    else if(tool==="select") setSel(id);
  };
  const onShapeDbl = (e, id) => {
    e.stopPropagation();
    const s=shapesR.current.find(s=>s.id===id);
    if (s&&s.type!=="csv") setEdit({id,val:s.label||""});
  };
  const onMouseMove = (e) => {
    const dr=dragR.current; if (!dr) return;
    const [sx,sy]=svgPt(e.clientX,e.clientY),dx=sx-dr.sx,dy=sy-dr.sy;
    if (Math.abs(dx)>3||Math.abs(dy)>3) movedR.current=true;
    if (dr.type==="pan"){const ox=dr.ox,oy=dr.oy;setVp(v=>({...v,x:ox+dx,y:oy+dy}));}
    else if(dr.type==="shape"){const id=dr.id,offX=dr.offX,offY=dr.offY,[wx,wy]=toWorld(sx,sy);setShapes(p=>p.map(s=>s.id===id?{...s,x:wx-offX,y:wy-offY}:s));}
  };
  const onMouseUp = () => { dragR.current=null; };

  // ── Keyboard ──────────────────────────────────────────────────
  useEffect(()=>{
    const h=(e)=>{
      if (editR.current) return;
      const ac=activeCellR.current;
      if (ac) {
        const arrows=["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"];
        if (e.key==="Escape"){setActiveCell(null);return;}
        if (arrows.includes(e.key)) {
          e.preventDefault(); e.stopPropagation();
          const csv=csvStoreR.current[ac.csvId]; if(!csv) return;
          let {ri,ci}=ac;
          const maxR=Math.min(csv.rows.length,MAX_ROWS)-1, maxC=csv.headers.length-1;
          if (e.key==="ArrowUp")    ri=Math.max(0,ri-1);
          if (e.key==="ArrowDown")  ri=Math.min(maxR,ri+1);
          if (e.key==="ArrowLeft")  ci=Math.max(0,ci-1);
          if (e.key==="ArrowRight") ci=Math.min(maxC,ci+1);
          setActiveCell({...ac,ri,ci});
          return;
        }
      }
      if ((e.key==="Delete"||e.key==="Backspace")&&sel){
        deleteShape(sel);
      }
      if (e.key==="Escape"){setFromId(null);setSel(null);}
    };
    window.addEventListener("keydown",h); return()=>window.removeEventListener("keydown",h);
  },[sel]);

  const zoomCenter=(f)=>{const r=getBR();doZoom(r.width/2,r.height/2,f);};

  // ── CSV import ────────────────────────────────────────────────
  const onFileChange = (e) => {
    const file=e.target.files[0]; if (!file) return;
    const reader=new FileReader();
    reader.onload=(ev)=>{
      const text=ev.target.result;
      const {delimiter,confident}=detectDelimiter(text);
      setWizard({rawText:text,filename:file.name,delimiter,detected:delimiter,confident,hasHeader:true,step:1,columnTypes:{}});
    };
    reader.readAsText(file);
    e.target.value="";
  };

  const onImportConfirm = () => {
    if (!wizard) return;
    const {rawText,filename,delimiter,hasHeader,columnTypes}=wizard;
    const {headers,rows}=parseCSV(rawText,delimiter,hasHeader);
    const csvId=uid();
    setCsvStore(prev=>({...prev,[csvId]:{name:filename,headers,rows,columnTypes:columnTypes||{}}}));
    const svgEl=svgRef.current;
    const cx=(svgEl.clientWidth/2-vp.x)/vp.s, cy=(svgEl.clientHeight/2-vp.y)/vp.s;
    const nodeId=uid();
    setShapes(p=>{
      const csvNode={id:nodeId,type:"csv",x:cx-CSV_W/2,y:cy-CSV_H/2,w:CSV_W,h:CSV_H,label:filename,csvId,minimized:false};
      const hasPanel=p.some(s=>s.type==="simPanel");
      const panelNodes=hasPanel?[]:[{id:uid(),type:"simPanel",x:cx+CSV_W/2+50,y:cy-80,w:260,h:190,label:"Simulação",color:"#fff"}];
      return [...p,csvNode,...panelNodes];
    });
    setSel(nodeId); setWizard(null);
  };

  // ── deleteShape (com cascade de ports filhos) ─────────────────
  const deleteShape = (id) => {
    const shape = shapesR.current.find(s=>s.id===id);
    const portIds = shape?.type==="decision"
      ? connsR.current.filter(c=>c.from===id).map(c=>c.to).filter(toId=>shapesR.current.find(s=>s.id===toId&&s.type==="port"))
      : [];
    const removeIds = [id,...portIds];
    setShapes(p=>p.filter(s=>!removeIds.includes(s.id)));
    setConns(p=>p.filter(c=>!removeIds.includes(c.from)&&!removeIds.includes(c.to)));
    setSel(null); setPalette(false);
  };

  // ── exportFlow ────────────────────────────────────────────
  const exportFlow = () => {
    const payload = {
      schemaVersion: "1.0",
      generatedAt: new Date().toISOString(),
      flowId: uid(),
      viewport: vp,
      shapes,
      conns,
      csvStore,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fluxo_credito_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── validateAndImportFlow ─────────────────────────────────
  const validateAndImportFlow = (data) => {
    // Schema integrity
    if (!data.schemaVersion || !Array.isArray(data.shapes) || !Array.isArray(data.conns)) {
      setImportError("Arquivo inválido: estrutura do fluxo não reconhecida. Verifique se é um arquivo exportado por este sistema.");
      return;
    }
    // Connection integrity
    const shapeIds = new Set(data.shapes.map(s => s.id));
    const badConns = data.conns.filter(c => !shapeIds.has(c.from) || !shapeIds.has(c.to));
    if (badConns.length > 0) {
      setImportError(`Integridade comprometida: ${badConns.length} conexão(ões) referenciam elementos inexistentes.`);
      return;
    }
    // Bump _id counter to avoid ID collisions with new elements
    const allIds = [...data.shapes.map(s => s.id), ...data.conns.map(c => c.id)];
    const maxNum = Math.max(0, ...allIds.map(id => parseInt(id.replace(/\D/g,''))).filter(n => !isNaN(n)));
    if (maxNum >= _id) _id = maxNum + 1;
    // Detect missing variables (decision nodes whose column doesn't exist in the stored CSV)
    const importedCsvStore = data.csvStore || {};
    const missingVars = data.shapes
      .filter(s => s.type === 'decision' && s.csvId && s.variableCol)
      .filter(s => {
        const csv = importedCsvStore[s.csvId];
        return !csv || !csv.headers.includes(s.variableCol);
      })
      .map(s => s.variableCol);
    // Restore state
    setShapes(data.shapes);
    setConns(data.conns);
    setCsvStore(importedCsvStore);
    if (data.viewport) setVp(data.viewport);
    setSel(null); setFromId(null); setPalette(false); setActiveCell(null);
    setImportError(null);
    if (missingVars.length > 0) {
      setImportWarn(`Fluxo importado. Variáveis ausentes na base: ${[...new Set(missingVars)].join(", ")}. Importe um CSV compatível para reativar a simulação.`);
    } else {
      setImportWarn(null);
    }
  };

  const onFlowFileChange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        validateAndImportFlow(data);
      } catch {
        setImportError("Arquivo inválido: não foi possível ler o JSON. Verifique se o arquivo não está corrompido.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── createDecisionNode ────────────────────────────────────────
  const createDecisionNode = (variableCol, csvId, wx, wy) => {
    const csv = csvStoreR.current[csvId];
    if (!csv) return;
    const colIdx = csv.headers.indexOf(variableCol);
    if (colIdx === -1) return;
    const allVals = [...new Set(csv.rows.map(r=>r[colIdx]??"").filter(v=>v!==""))];
    const distinctVals = allVals.slice(0, MAX_DISTINCT);
    const decId = uid();
    const decisionShape = {id:decId,type:"decision",x:wx-SW/2,y:wy-SH/2,w:SW,h:SH,label:variableCol,color:"#fef3c7",variableCol,csvId};
    const PORT_W=80, PORT_H=32, DIST=200;
    const n = distinctVals.length;
    const ports = distinctVals.map((val,i)=>{
      let angle;
      if (n===1)      angle=0;
      else if (n===2) angle=i===0?-Math.PI/4:Math.PI/4;
      else { const span=Math.min(Math.PI*0.75,(n-1)*0.4); angle=-span/2+(span/(n-1))*i; }
      const px=wx+Math.cos(angle)*DIST-PORT_W/2;
      const py=wy+Math.sin(angle)*DIST-PORT_H/2;
      return {id:uid(),type:"port",x:px,y:py,w:PORT_W,h:PORT_H,label:val,color:"#f0fdf4"};
    });
    const newConns = ports.map(p=>({id:uid(),from:decId,to:p.id,label:p.label}));
    setShapes(prev=>[...prev,decisionShape,...ports]);
    setConns(prev=>[...prev,...newConns]);
    setSel(decId);
  };

  // ── startPanelDrag ────────────────────────────────────────────
  const startPanelDrag = (e, col, csvId) => {
    e.preventDefault();
    setPanelDrag({col,csvId});
    setGhostPos({x:e.clientX,y:e.clientY});
  };

  // ── Global mouse listeners for panel→canvas drag ──────────────
  useEffect(()=>{
    const onMove=(e)=>{
      if (!panelDragR.current) return;
      setGhostPos({x:e.clientX,y:e.clientY});
    };
    const onUp=(e)=>{
      const drag=panelDragR.current;
      if (!drag) return;
      const svgEl=svgRef.current;
      if (svgEl) {
        const rect=svgEl.getBoundingClientRect();
        if (e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom) {
          const sx=e.clientX-rect.left,sy=e.clientY-rect.top;
          const {x:vx,y:vy,s}=vpR.current;
          createDecisionNode(drag.col,drag.csvId,(sx-vx)/s,(sy-vy)/s);
        }
      }
      setPanelDrag(null); setGhostPos(null);
    };
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
    return()=>{ window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); };
  },[]); // eslint-disable-line

  // ── Wizard preview ────────────────────────────────────────────
  const wizardPreview = wizard ? parseCSV(wizard.rawText, wizard.delimiter, wizard.hasHeader) : null;

  // ── Render: connection ─────────────────────────────────────────
  const renderConn = (conn) => {
    const from=shapes.find(s=>s.id===conn.from), to=shapes.find(s=>s.id===conn.to);
    if (!from||!to) return null;
    const [fx,fy]=ctr(from),[tx,ty]=ctr(to),dx=tx-fx,dy=ty-fy,len=Math.sqrt(dx*dx+dy*dy)||1;
    const so=Math.max(from.w,from.h)/2+4, eo=Math.max(to.w,to.h)/2+10;
    const sx=fx+(dx/len)*so,sy=fy+(dy/len)*so,ex=tx-(dx/len)*eo,ey=ty-(dy/len)*eo;
    const mx=(sx+ex)/2,my=(sy+ey)/2,cv=Math.min(40,len*0.15);
    const cpx=mx+(-dy/len)*cv, cpy=my+(dx/len)*cv;
    const lx=0.25*sx+0.5*cpx+0.25*ex, ly=0.25*sy+0.5*cpy+0.25*ey;
    const d=`M ${sx} ${sy} Q ${cpx} ${cpy} ${ex} ${ey}`;
    const labelText=conn.label?trunc(conn.label,12):null;
    return (
      <g key={conn.id}>
        <path d={d} fill="none" stroke="transparent" strokeWidth={18} style={{cursor:"pointer"}}
          onClick={e=>{e.stopPropagation();connClickTimer.current=setTimeout(()=>{setConns(p=>p.filter(c=>c.id!==conn.id));},220);}}
          onDoubleClick={e=>{e.stopPropagation();clearTimeout(connClickTimer.current);setEditConn({id:conn.id,val:conn.label||""});}}/>
        <path d={d} fill="none" stroke="#3b82f6" strokeWidth={2} markerEnd="url(#arr)" style={{pointerEvents:"none"}}/>
        {labelText&&(
          <>
            <rect x={lx-28} y={ly-10} width={56} height={20} rx={5}
              fill="#fff" stroke="#e2e8f0" strokeWidth={1} style={{pointerEvents:"none"}}/>
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              fontSize={11} fontFamily="'DM Sans',system-ui,sans-serif" fill="#475569"
              style={{pointerEvents:"none",userSelect:"none"}}>{labelText}</text>
          </>
        )}
      </g>
    );
  };

  // ── Render: CSV node ──────────────────────────────────────────
  const renderCSVNode = (shape) => {
    const {id,x,y,label,csvId,minimized}=shape;
    const csv=csvStore[csvId];
    const isSel=sel===id, isFrom=fromId===id;
    const stroke=isFrom?"#f59e0b":isSel?"#3b82f6":"#e2e8f0";
    const sw=isSel||isFrom?2:1;
    const gp={
      "data-sid":id,
      onMouseDown:(e)=>onShapeDown(e,id),
      onClick:(e)=>onShapeClick(e,id),
      style:{cursor:tool==="connect"?"crosshair":"default"},
    };

    // ── Minimized ──
    if (minimized) {
      return (
        <g key={id} {...gp} style={{cursor:tool==="select"?"grab":tool==="connect"?"crosshair":"default", filter:"drop-shadow(0 1px 4px rgba(0,0,0,.1))"}}>
          <rect x={x} y={y} width={CSV_MINI_W} height={CSV_MINI_H} rx={10}
            fill="#fff" stroke={stroke} strokeWidth={sw}/>
          <text x={x+14} y={y+36} fontSize={22} style={{pointerEvents:"none"}}>📊</text>
          <text x={x+44} y={y+26} fontSize={11} fontWeight="600" fill="#1e293b"
            fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none"}}>
            {trunc(label.replace(/\.csv$/i,""),20)}
          </text>
          <text x={x+44} y={y+42} fontSize={10} fill="#94a3b8"
            fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none"}}>
            {csv?`${csv.rows.length} linhas · ${csv.headers.length} colunas`:"CSV"}
          </text>
          {/* Maximize btn */}
          <g onClick={e=>{e.stopPropagation();setShapes(p=>p.map(s=>s.id===id?{...s,minimized:false,w:CSV_W,h:CSV_H}:s));}} style={{cursor:"pointer"}}>
            <rect x={x+CSV_MINI_W-30} y={y+8} width={22} height={22} rx={6} fill="#f1f5f9"/>
            <text x={x+CSV_MINI_W-19} y={y+23} fontSize={13} textAnchor="middle" fill="#475569">⤢</text>
          </g>
        </g>
      );
    }

    // ── Maximized ──
    const w=CSV_W, h=CSV_H;
    const displayRows = csv ? csv.rows.slice(0,MAX_ROWS) : [];
    const truncated = csv && csv.rows.length > MAX_ROWS;

    return (
      <g key={id} data-sid={id} style={{filter:"drop-shadow(0 4px 16px rgba(0,0,0,.1))"}}>
        {/* Frame */}
        <rect x={x} y={y} width={w} height={h} rx={10} fill="#fff" stroke={stroke} strokeWidth={sw}/>

        {/* Title bar — drag handle */}
        <rect data-sid={id} x={x} y={y} width={w} height={CSV_TH} rx={10} fill="#f8fafc"
          onMouseDown={e=>onShapeDown(e,id)} onClick={e=>onShapeClick(e,id)} style={{cursor:"grab"}}/>
        <rect x={x} y={y+CSV_TH-8} width={w} height={8} fill="#f8fafc"/>
        <line x1={x+1} y1={y+CSV_TH} x2={x+w-1} y2={y+CSV_TH} stroke="#e2e8f0"/>

        {/* Icon + filename */}
        <text x={x+12} y={y+25} fontSize={16} style={{pointerEvents:"none"}}>📊</text>
        <text x={x+34} y={y+25} fontSize={12.5} fontWeight="600" fill="#1e293b"
          fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none"}}>
          {trunc(label.replace(/\.csv$/i,""), 42)}
        </text>

        {/* Row/col count */}
        {csv && (
          <text x={x+w-100} y={y+25} fontSize={10} fill="#94a3b8" textAnchor="end"
            fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none"}}>
            {truncated?`${MAX_ROWS}/${csv.rows.length} linhas`:(`${csv.rows.length} linhas`)} · {csv?.headers.length} colunas
          </text>
        )}

        {/* Minimize btn */}
        <g onClick={e=>{e.stopPropagation();setShapes(p=>p.map(s=>s.id===id?{...s,minimized:true,w:CSV_MINI_W,h:CSV_MINI_H}:s));setActiveCell(null);}} style={{cursor:"pointer"}}>
          <rect x={x+w-32} y={y+8} width={24} height={22} rx={6} fill="#f1f5f9"/>
          <text x={x+w-20} y={y+23} fontSize={14} textAnchor="middle" fill="#475569">⊟</text>
        </g>

        {/* Table via foreignObject */}
        {csv && (
          <foreignObject x={x+1} y={y+CSV_TH+1} width={w-2} height={h-CSV_TH-2}>
            <div
              xmlns="http://www.w3.org/1999/xhtml"
              style={{width:"100%",height:"100%",overflow:"auto",background:"#fff",
                borderBottomLeftRadius:9,borderBottomRightRadius:9}}
              onMouseDown={e=>e.stopPropagation()}
              onWheel={e=>e.stopPropagation()}
              onClick={e=>e.stopPropagation()}
              onTouchStart={e=>e.stopPropagation()}>
              <table style={{borderCollapse:"collapse",fontSize:11.5,
                fontFamily:"'DM Sans',system-ui,sans-serif",width:"max-content",minWidth:"100%"}}>
                <thead>
                  <tr>
                    <th style={{position:"sticky",top:0,left:0,zIndex:3,
                      width:36,background:"#f8fafc",border:"1px solid #e2e8f0",
                      padding:"4px 6px",color:"#94a3b8",fontSize:10,fontWeight:500,userSelect:"none"}}>#</th>
                    {csv.headers.map((h,ci)=>(
                      <th key={ci} style={{position:"sticky",top:0,zIndex:2,
                        background:"#f8fafc",border:"1px solid #e2e8f0",
                        padding:"5px 12px",color:"#475569",fontWeight:600,
                        whiteSpace:"nowrap",minWidth:90,maxWidth:220,
                        overflow:"hidden",textOverflow:"ellipsis",userSelect:"none"}}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row,ri)=>(
                    <tr key={ri}>
                      <td style={{position:"sticky",left:0,zIndex:1,
                        background:"#f8fafc",border:"1px solid #f1f5f9",
                        padding:"3px 6px",color:"#cbd5e1",fontSize:10,
                        textAlign:"center",userSelect:"none"}}>{ri+1}</td>
                      {csv.headers.map((_,ci)=>{
                        const isAc=activeCell?.shapeId===id&&activeCell?.ri===ri&&activeCell?.ci===ci;
                        return (
                          <td key={ci}
                            onClick={()=>setActiveCell({shapeId:id,csvId,ri,ci})}
                            style={{
                              border:isAc?"2px solid #3b82f6":"1px solid #f1f5f9",
                              padding:isAc?"2px 11px":"3px 12px",
                              background:isAc?"#eff6ff":ri%2===0?"#fff":"#fafafa",
                              color:"#1e293b",whiteSpace:"nowrap",
                              maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",
                              cursor:"cell",userSelect:"none",
                            }}>{row[ci]??""}</td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {truncated&&(
                <div style={{padding:"6px 12px",fontSize:10.5,color:"#94a3b8",
                  background:"#fafafa",borderTop:"1px solid #f1f5f9",textAlign:"center"}}>
                  Exibindo {MAX_ROWS} de {csv.rows.length} linhas
                </div>
              )}
            </div>
          </foreignObject>
        )}

        {/* Invisible border overlay — keeps shape selectable/connectable */}
        <rect data-sid={id} x={x} y={y} width={w} height={h} rx={10}
          fill="transparent" stroke="none" style={{pointerEvents:"none"}}/>
      </g>
    );
  };

  // ── Render: regular shape ─────────────────────────────────────
  const renderShape = (shape) => {
    if (shape.type==="csv") return renderCSVNode(shape);
    if (shape.type==="simPanel") return renderSimPanel(shape);
    const {id,type,x,y,w,h,label,color}=shape;
    const isSel=sel===id, isFrom=fromId===id;
    const hasErr=!!flowErrors[id];
    const stroke=isFrom?"#f59e0b":isSel?"#3b82f6":hasErr?"#dc2626":"#94a3b8";
    const sw=isSel||isFrom?2:hasErr?2.5:1.5;
    const fill=color||"#fff";
    const flt=hasErr?"drop-shadow(0 0 6px rgba(220,38,38,.5))":
               isSel?"drop-shadow(0 0 0 2px rgba(59,130,246,.25)) drop-shadow(0 2px 8px rgba(59,130,246,.18))":
               isFrom?"drop-shadow(0 0 0 2px rgba(245,158,11,.25)) drop-shadow(0 2px 8px rgba(245,158,11,.18))":
               "drop-shadow(0 1px 4px rgba(0,0,0,.1))";
    const cur=tool==="connect"?"crosshair":tool==="select"?"grab":"default";
    const errBadge=hasErr&&(<>
      <circle cx={x+w} cy={y} r={9} fill="#dc2626" style={{pointerEvents:"none"}}/>
      <text x={x+w} y={y+4} textAnchor="middle" fontSize={11} fontWeight="700" fill="#fff"
        style={{pointerEvents:"none",userSelect:"none"}}>!</text>
    </>);
    const txt=(<text data-sid={id} x={x+w/2} y={y+h/2} textAnchor="middle" dominantBaseline="middle"
      fontSize={12} fontFamily="'DM Sans',system-ui,sans-serif" fontWeight="500" fill="#1e293b"
      style={{pointerEvents:"none",userSelect:"none"}}>{label}</text>);
    const gp={"data-sid":id,onMouseDown:(e)=>onShapeDown(e,id),onClick:(e)=>onShapeClick(e,id),onDoubleClick:(e)=>onShapeDbl(e,id),style:{cursor:cur,filter:flt}};
    if (type==="rect")    return <g key={id} {...gp}><rect data-sid={id} x={x} y={y} width={w} height={h} rx={10} fill={fill} stroke={stroke} strokeWidth={sw}/>{txt}{errBadge}</g>;
    if (type==="circle")  return <g key={id} {...gp}><ellipse data-sid={id} cx={x+w/2} cy={y+h/2} rx={w/2} ry={h/2} fill={fill} stroke={stroke} strokeWidth={sw}/>{txt}{errBadge}</g>;
    if (type==="diamond"){const pts=`${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}`;return <g key={id} {...gp}><polygon data-sid={id} points={pts} fill={fill} stroke={stroke} strokeWidth={sw}/>{txt}{errBadge}</g>;}
    if (type==="decision") {
      const pts=`${x+w/2},${y} ${x+w},${y+h/2} ${x+w/2},${y+h} ${x},${y+h/2}`;
      const decStroke=isFrom?"#f59e0b":isSel?"#3b82f6":hasErr?"#dc2626":"#d97706";
      return (
        <g key={id} {...gp}>
          <polygon data-sid={id} points={pts} fill={hasErr?"#fff1f2":"#fef3c7"} stroke={decStroke} strokeWidth={sw}/>
          <text x={x+w/2} y={y+h/2-9} textAnchor="middle" fontSize={9} fill={hasErr?"#dc2626":"#92400e"}
            fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>decisão</text>
          <text x={x+w/2} y={y+h/2+7} textAnchor="middle" fontSize={12} fontWeight="600" fill="#1e293b"
            fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>{trunc(label,14)}</text>
          {errBadge}
        </g>
      );
    }
    if (type==="port") {
      const portStroke=isFrom?"#f59e0b":isSel?"#3b82f6":hasErr?"#dc2626":"#86efac";
      return (
        <g key={id} {...gp}>
          <rect data-sid={id} x={x} y={y} width={w} height={h} rx={h/2}
            fill={hasErr?"#fff1f2":"#f0fdf4"} stroke={portStroke} strokeWidth={sw}/>
          <text x={x+w/2} y={y+h/2} textAnchor="middle" dominantBaseline="middle"
            fontSize={11} fontFamily="'DM Sans',system-ui,sans-serif" fontWeight="500" fill={hasErr?"#dc2626":"#166534"}
            style={{pointerEvents:"none",userSelect:"none"}}>{trunc(label,10)}</text>
          {errBadge}
        </g>
      );
    }
    if (type==="approved") {
      return (
        <g key={id} {...gp}>
          <rect data-sid={id} x={x} y={y} width={w} height={h} rx={22}
            fill="#dcfce7" stroke={isSel?"#3b82f6":"#16a34a"} strokeWidth={sw}/>
          <text x={x+w/2} y={y+h/2} textAnchor="middle" dominantBaseline="middle"
            fontSize={12} fontFamily="'DM Sans',system-ui,sans-serif" fontWeight="600" fill="#15803d"
            style={{pointerEvents:"none",userSelect:"none"}}>✅ {label||"Aprovado"}</text>
        </g>
      );
    }
    if (type==="rejected") {
      return (
        <g key={id} {...gp}>
          <rect data-sid={id} x={x} y={y} width={w} height={h} rx={22}
            fill="#fee2e2" stroke={isSel?"#3b82f6":"#dc2626"} strokeWidth={sw}/>
          <text x={x+w/2} y={y+h/2} textAnchor="middle" dominantBaseline="middle"
            fontSize={12} fontFamily="'DM Sans',system-ui,sans-serif" fontWeight="600" fill="#dc2626"
            style={{pointerEvents:"none",userSelect:"none"}}>❌ {label||"Reprovado"}</text>
        </g>
      );
    }
    return null;
  };

  // ── Render: simulation panel ──────────────────────────────────
  const renderSimPanel = (shape) => {
    const {id,x,y,w,h}=shape;
    const isSel=sel===id;
    const rate=simResult.approvalRate;
    const rateColor=rate>=70?"#16a34a":rate>=40?"#d97706":"#dc2626";
    const barW=Math.max(0,(w-32)*rate/100);
    const hasData=simResult.totalQty>0;
    return (
      <g key={id} data-sid={id}
        onMouseDown={e=>onShapeDown(e,id)} onClick={e=>onShapeClick(e,id)}
        style={{cursor:tool==="select"?"grab":"default",
          filter:isSel?"drop-shadow(0 0 0 2px rgba(99,102,241,.3)) drop-shadow(0 4px 20px rgba(99,102,241,.2))":"drop-shadow(0 4px 20px rgba(0,0,0,.13))"}}>
        {/* Frame */}
        <rect x={x} y={y} width={w} height={h} rx={14} fill="#fff" stroke={isSel?"#6366f1":"#c7d2fe"} strokeWidth={isSel?2:1.5}/>
        {/* Header bar */}
        <rect x={x} y={y} width={w} height={46} rx={14} fill="#6366f1"/>
        <rect x={x} y={y+32} width={w} height={14} fill="#6366f1"/>
        <text x={x+14} y={y+29} fontSize={13} fontWeight="700" fill="#fff"
          fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>📊 Painel de Simulação</text>
        {/* Rate big number */}
        <text x={x+w/2} y={y+94} textAnchor="middle" fontSize={38} fontWeight="800" fill={hasData?rateColor:"#cbd5e1"}
          fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>
          {hasData?`${rate.toFixed(1)}%`:"0%"}
        </text>
        <text x={x+w/2} y={y+112} textAnchor="middle" fontSize={11} fill="#94a3b8"
          fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>Taxa de Aprovação</text>
        {/* Progress bar */}
        <rect x={x+16} y={y+122} width={w-32} height={8} rx={4} fill="#f1f5f9"/>
        {hasData&&<rect x={x+16} y={y+122} width={barW} height={8} rx={4} fill={rateColor}/>}
        {/* Stats */}
        <text x={x+w/2-56} y={y+150} textAnchor="middle" fontSize={11} fontWeight="600" fill="#16a34a"
          fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>
          ✅ {fmtQty(simResult.approvedQty)}
        </text>
        <text x={x+w/2} y={y+150} textAnchor="middle" fontSize={11} fill="#cbd5e1"
          fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>/</text>
        <text x={x+w/2+56} y={y+150} textAnchor="middle" fontSize={11} fontWeight="600" fill="#dc2626"
          fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>
          ❌ {fmtQty(simResult.rejectedQty)}
        </text>
        {/* Total */}
        <text x={x+w/2} y={y+170} textAnchor="middle" fontSize={10} fill="#94a3b8"
          fontFamily="'DM Sans',system-ui,sans-serif" style={{pointerEvents:"none",userSelect:"none"}}>
          {hasData?`Total: ${fmtQty(simResult.totalQty)} registros`:"Importe um CSV e monte o fluxo"}
        </text>
      </g>
    );
  };

  // ── Edit & helpers ────────────────────────────────────────────
  const editShape=edit?shapes.find(s=>s.id===edit.id):null;
  const commitEdit=()=>{if(!edit)return;setShapes(p=>p.map(s=>s.id===edit.id?{...s,label:edit.val}:s));setEdit(null);};
  const selShape=sel?shapes.find(s=>s.id===sel):null;
  const canvasCursor=tool==="hand"?"grab":tool==="select"?"default":"crosshair";

  // ── Decision variables computed for right panel ───────────────
  const decisionVars = Object.entries(csvStore).flatMap(([csvId,csv])=>
    Object.entries(csv.columnTypes||{})
      .filter(([,type])=>type==="decision")
      .map(([col])=>({col,csvId}))
  );

  // ────────────────────────────────────────────────────────────────────────────
  // JSX
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{display:"flex",width:"100%",height:"100vh",overflow:"hidden",fontFamily:"'DM Sans',system-ui,sans-serif",background:"#f1f5f9"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        .wbt{transition:background .12s,color .12s;}
        .wbt:hover{background:#eff6ff!important;color:#2563eb!important;}
        .wbz:hover{background:#eff6ff!important;color:#2563eb!important;}
        .wbz:active{transform:scale(.93);}
        @media(max-width:560px){.wbl{display:none!important;}}
      `}</style>

      {/* ═══════════════ CANVAS AREA ═══════════════ */}
      <div style={{flex:1,position:"relative",overflow:"hidden"}}>

        {/* Toolbar */}
        <div style={{position:"absolute",top:14,left:"50%",transform:"translateX(-50%)",zIndex:300,
          display:"flex",gap:2,alignItems:"center",background:"#fff",padding:"6px 8px",borderRadius:14,
          border:"1px solid #e2e8f0",boxShadow:"0 2px 12px rgba(0,0,0,.08)",maxWidth:"calc(100% - 24px)",overflowX:"auto"}}>
          {TOOLS.map(t=>(
            <button key={t.id} className="wbt" onClick={()=>{setTool(t.id);setFromId(null);}} title={t.label}
              style={{display:"flex",alignItems:"center",gap:5,padding:"6px 11px",borderRadius:9,border:"none",
                background:tool===t.id?"#2563eb":"transparent",color:tool===t.id?"#fff":"#475569",
                cursor:"pointer",fontSize:12.5,fontWeight:500,fontFamily:"inherit",whiteSpace:"nowrap"}}>
              <span style={{fontSize:15,lineHeight:1}}>{t.icon}</span>
              <span className="wbl">{t.label}</span>
            </button>
          ))}
          <div style={{width:1,height:22,background:"#e2e8f0",margin:"0 3px",flexShrink:0}}/>
          {selShape&&selShape.type!=="csv"&&(
            <button className="wbt" onClick={()=>setPalette(v=>!v)} title="Cor"
              style={{width:28,height:28,borderRadius:8,flexShrink:0,
                border:`2px solid ${palette?"#3b82f6":"#e2e8f0"}`,
                background:selShape.color||"#fff",cursor:"pointer",transition:"border-color .15s"}}/>
          )}
          <button className="wbt" onClick={()=>{if(!sel)return;deleteShape(sel);}}
            disabled={!sel}
            style={{display:"flex",alignItems:"center",gap:4,padding:"6px 10px",borderRadius:9,border:"none",
              background:sel?"#fff1f2":"transparent",color:sel?"#e11d48":"#cbd5e1",
              cursor:sel?"pointer":"default",fontSize:12.5,fontWeight:500,fontFamily:"inherit",flexShrink:0}}>
            🗑 <span className="wbl">Deletar</span>
          </button>
        </div>

        {/* Color palette */}
        {palette&&selShape&&(
          <div style={{position:"absolute",top:70,left:"50%",transform:"translateX(-50%)",zIndex:400,
            display:"flex",gap:6,padding:"10px 14px",background:"#fff",border:"1px solid #e2e8f0",
            borderRadius:12,boxShadow:"0 8px 24px rgba(0,0,0,.1)"}}>
            {COLORS.map(c=>(
              <div key={c} onClick={()=>{setShapes(p=>p.map(s=>s.id===sel?{...s,color:c}:s));setPalette(false);}}
                style={{width:26,height:26,borderRadius:7,background:c,cursor:"pointer",transition:"transform .12s",
                  border:selShape.color===c?"2.5px solid #3b82f6":"1.5px solid #e2e8f0"}}/>
            ))}
          </div>
        )}

        {/* Zoom controls */}
        <div style={{position:"absolute",bottom:16,right:16,zIndex:200,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
          {[["+",()=>zoomCenter(1.2)],["−",()=>zoomCenter(1/1.2)],["⌂",()=>setVp({x:20,y:40,s:1})]].map(([icon,fn])=>(
            <button key={icon} className="wbz" onClick={fn} style={{width:36,height:36,borderRadius:10,border:"1px solid #e2e8f0",background:"#fff",boxShadow:"0 1px 4px rgba(0,0,0,.08)",color:"#64748b",cursor:"pointer",fontSize:17,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit",transition:"all .15s"}}>{icon}</button>
          ))}
          <div style={{color:"#94a3b8",fontSize:10,fontFamily:"inherit",marginTop:1}}>{Math.round(vp.s*100)}%</div>
        </div>

        {/* Floating hint */}
        {(fromId||hint)&&(
          <div style={{position:"absolute",bottom:16,left:"50%",transform:"translateX(-50%)",zIndex:200,padding:"8px 18px",borderRadius:10,background:fromId?"#fffbeb":"#eff6ff",border:fromId?"1px solid #fde68a":"1px solid #bfdbfe",color:fromId?"#92400e":"#1d4ed8",fontSize:12.5,fontFamily:"inherit",whiteSpace:"nowrap",boxShadow:"0 2px 8px rgba(0,0,0,.08)"}}>
            {fromId?"⟶ Clique em outro elemento para conectar · Esc cancela":hint}
          </div>
        )}

        {/* Tips */}
        <div style={{position:"absolute",bottom:16,left:16,zIndex:100,background:"#fff",border:"1px solid #e2e8f0",boxShadow:"0 1px 4px rgba(0,0,0,.06)",color:"#94a3b8",padding:"7px 11px",borderRadius:10,fontSize:10.5,fontFamily:"inherit",lineHeight:1.9}}>
          <span style={{color:"#64748b",fontWeight:600}}>Dicas</span><br/>
          ✋ Mover · ↖ Selecionar e arrastar<br/>
          📱 Pinça → zoom · Segurar → editar<br/>
          Clique na seta → deletar conexão
        </div>

        {/* SVG Canvas */}
        <svg ref={svgRef} width="100%" height="100%" onMouseDown={onCanvasDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onClick={onCanvasClick} style={{display:"block",cursor:canvasCursor,touchAction:"none"}}>
          <defs>
            <pattern id="pg" width={28*vp.s} height={28*vp.s} patternUnits="userSpaceOnUse" x={vp.x%(28*vp.s)} y={vp.y%(28*vp.s)}>
              <circle cx={14*vp.s} cy={14*vp.s} r={1} fill="#c8d3de"/>
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

        {/* Inline label editor — shapes */}
        {edit&&editShape&&(()=>{
          const ex=editShape.x*vp.s+vp.x,ey=editShape.y*vp.s+vp.y,ew=editShape.w*vp.s,eh=editShape.h*vp.s;
          return <input autoFocus value={edit.val} onChange={e=>setEdit(p=>({...p,val:e.target.value}))} onBlur={commitEdit} onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape")commitEdit();}} style={{position:"absolute",left:ex+ew/2,top:ey+eh/2,transform:"translate(-50%,-50%)",width:ew*0.8,background:"transparent",border:"none",outline:"none",textAlign:"center",fontSize:Math.max(11,12*vp.s),fontFamily:"'DM Sans',system-ui,sans-serif",fontWeight:500,color:"#1e293b",zIndex:500}}/>;
        })()}
        {/* Inline label editor — connections */}
        {editConn&&(()=>{
          const conn=conns.find(c=>c.id===editConn.id);
          if(!conn) return null;
          const from=shapes.find(s=>s.id===conn.from),to=shapes.find(s=>s.id===conn.to);
          if(!from||!to) return null;
          const [fx,fy]=ctr(from),[tx,ty]=ctr(to);
          const mx=(fx+tx)/2*vp.s+vp.x, my=(fy+ty)/2*vp.s+vp.y;
          return <input autoFocus value={editConn.val}
            onChange={e=>setEditConn(p=>({...p,val:e.target.value}))}
            onBlur={()=>{setConns(p=>p.map(c=>c.id===editConn.id?{...c,label:editConn.val}:c));setEditConn(null);}}
            onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape"){setConns(p=>p.map(c=>c.id===editConn.id?{...c,label:editConn.val}:c));setEditConn(null);}}}
            style={{position:"absolute",left:mx,top:my,transform:"translate(-50%,-50%)",
              width:90,background:"#fff",border:"1.5px solid #3b82f6",borderRadius:6,
              outline:"none",textAlign:"center",fontSize:11,
              fontFamily:"'DM Sans',system-ui,sans-serif",color:"#475569",padding:"3px 8px",zIndex:500}}/>;
        })()}
      </div>

      {/* ═══════════════ RIGHT PANEL ═══════════════ */}
      <div style={{width:272,flexShrink:0,background:"#fff",borderLeft:"1px solid #e2e8f0",display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {/* Header */}
        <div style={{padding:"16px 18px 14px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:"#3b82f6",boxShadow:"0 0 0 3px #dbeafe"}}/>
          <span style={{fontSize:13,fontWeight:600,color:"#1e293b",letterSpacing:.1}}>Painel</span>
        </div>

        {/* Importar CSV button */}
        <div style={{padding:"14px 16px",borderBottom:"1px solid #f1f5f9"}}>
          <p style={{fontSize:11,color:"#94a3b8",marginBottom:10,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Dados</p>
          <button onClick={()=>fileInputRef.current?.click()}
            style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px 14px",borderRadius:10,border:"1.5px dashed #cbd5e1",background:"#fafafa",color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit",transition:"all .15s"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="#3b82f6";e.currentTarget.style.color="#2563eb";e.currentTarget.style.background="#eff6ff";}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="#cbd5e1";e.currentTarget.style.color="#475569";e.currentTarget.style.background="#fafafa";}}>
            <span style={{fontSize:18}}>📂</span> Importar CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={onFileChange}/>
        </div>

        {/* Exportar / Importar Fluxo */}
        <div style={{padding:"14px 16px",borderBottom:"1px solid #f1f5f9"}}>
          <p style={{fontSize:11,color:"#94a3b8",marginBottom:10,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Fluxo</p>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            <button onClick={exportFlow}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"9px 14px",borderRadius:10,border:"1.5px solid #a5b4fc",background:"#eef2ff",color:"#4f46e5",cursor:"pointer",fontSize:12.5,fontWeight:500,fontFamily:"inherit",transition:"all .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.background="#e0e7ff";e.currentTarget.style.borderColor="#818cf8";}}
              onMouseLeave={e=>{e.currentTarget.style.background="#eef2ff";e.currentTarget.style.borderColor="#a5b4fc";}}>
              <span style={{fontSize:16}}>⬇</span> Exportar Fluxo
            </button>
            <button onClick={()=>flowImportRef.current?.click()}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"9px 14px",borderRadius:10,border:"1.5px dashed #a5b4fc",background:"#fafafa",color:"#4f46e5",cursor:"pointer",fontSize:12.5,fontWeight:500,fontFamily:"inherit",transition:"all .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="#6366f1";e.currentTarget.style.background="#eef2ff";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="#a5b4fc";e.currentTarget.style.background="#fafafa";}}>
              <span style={{fontSize:16}}>⬆</span> Importar Fluxo
            </button>
            <input ref={flowImportRef} type="file" accept=".json,application/json" style={{display:"none"}} onChange={onFlowFileChange}/>
          </div>
          {importWarn&&(
            <div style={{marginTop:8,padding:"8px 10px",borderRadius:8,background:"#fffbeb",border:"1px solid #fde68a",fontSize:11,color:"#92400e",lineHeight:1.5,display:"flex",gap:6,alignItems:"flex-start"}}>
              <span style={{flexShrink:0}}>⚠</span>
              <span>{importWarn}</span>
            </div>
          )}
        </div>

        {/* Loaded CSVs list */}
        {Object.keys(csvStore).length > 0 && (
          <div style={{padding:"12px 16px",borderBottom:"1px solid #f1f5f9"}}>
            <p style={{fontSize:11,color:"#94a3b8",marginBottom:8,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Arquivos carregados</p>
            {Object.entries(csvStore).map(([cid,csv])=>(
              <div key={cid} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:8,background:"#f8fafc",marginBottom:4}}>
                <span>📊</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:500,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{csv.name}</div>
                  <div style={{fontSize:10.5,color:"#94a3b8"}}>{csv.rows.length} linhas · {csv.headers.length} colunas</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Decision Variables */}
        {decisionVars.length > 0 && (
          <div style={{padding:"12px 16px",borderBottom:"1px solid #f1f5f9"}}>
            <p style={{fontSize:11,color:"#94a3b8",marginBottom:8,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Variáveis de Decisão</p>
            <p style={{fontSize:10.5,color:"#cbd5e1",marginBottom:8,lineHeight:1.5}}>Arraste para o canvas para criar um nó de decisão</p>
            {decisionVars.map(({col,csvId})=>(
              <div key={`${csvId}-${col}`}
                onMouseDown={(e)=>startPanelDrag(e,col,csvId)}
                style={{display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:8,
                  border:"1.5px solid #fde68a",background:"#fef9c3",marginBottom:4,
                  cursor:"grab",userSelect:"none",fontSize:12,fontWeight:500,color:"#92400e",transition:"all .12s"}}
                onMouseEnter={e=>{e.currentTarget.style.background="#fef3c7";e.currentTarget.style.borderColor="#f59e0b";}}
                onMouseLeave={e=>{e.currentTarget.style.background="#fef9c3";e.currentTarget.style.borderColor="#fde68a";}}>
                <span>◇</span>
                <span style={{flex:1}}>{col}</span>
                <span style={{fontSize:14,opacity:.5}}>⠿</span>
              </div>
            ))}
          </div>
        )}

        {/* Simulation panel button */}
        {Object.keys(csvStore).length > 0 && (
          <div style={{padding:"12px 16px",borderBottom:"1px solid #f1f5f9"}}>
            <p style={{fontSize:11,color:"#94a3b8",marginBottom:8,fontWeight:500,textTransform:"uppercase",letterSpacing:.6}}>Simulação</p>
            <button
              onClick={()=>{
                if (shapes.some(s=>s.type==="simPanel")) return;
                const svgEl=svgRef.current;
                const cx=(svgEl.clientWidth/2-vp.x)/vp.s, cy=(svgEl.clientHeight/2-vp.y)/vp.s;
                setShapes(p=>[...p,{id:uid(),type:"simPanel",x:cx-130,y:cy-95,w:260,h:190,label:"Simulação",color:"#fff"}]);
              }}
              disabled={shapes.some(s=>s.type==="simPanel")}
              style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"10px 14px",borderRadius:10,
                border:"1.5px solid",borderColor:shapes.some(s=>s.type==="simPanel")?"#c7d2fe":"#a5b4fc",
                background:shapes.some(s=>s.type==="simPanel")?"#f5f3ff":"#eef2ff",
                color:shapes.some(s=>s.type==="simPanel")?"#a78bfa":"#4f46e5",
                cursor:shapes.some(s=>s.type==="simPanel")?"default":"pointer",
                fontSize:13,fontWeight:500,fontFamily:"inherit",transition:"all .15s"}}
              onMouseEnter={e=>{if(!shapes.some(s=>s.type==="simPanel")){e.currentTarget.style.background="#e0e7ff";e.currentTarget.style.borderColor="#818cf8";}}}
              onMouseLeave={e=>{e.currentTarget.style.background=shapes.some(s=>s.type==="simPanel")?"#f5f3ff":"#eef2ff";e.currentTarget.style.borderColor=shapes.some(s=>s.type==="simPanel")?"#c7d2fe":"#a5b4fc";}}>
              <span style={{fontSize:16}}>📊</span>
              {shapes.some(s=>s.type==="simPanel")?"Painel ativo no canvas":"Adicionar Painel"}
            </button>
            <div style={{marginTop:10,padding:"8px 10px",borderRadius:8,background:"#f8fafc",border:"1px solid #f1f5f9"}}>
              <div style={{fontSize:11,color:"#94a3b8",marginBottom:4,fontWeight:500}}>Taxa de Aprovação</div>
              <div style={{fontSize:22,fontWeight:800,color:simResult.approvalRate>=70?"#16a34a":simResult.approvalRate>=40?"#d97706":"#dc2626"}}>
                {simResult.approvalRate.toFixed(1)}%
              </div>
              {simResult.totalQty>0&&(
                <div style={{fontSize:10.5,color:"#94a3b8",marginTop:2}}>
                  ✅ {fmtQty(simResult.approvedQty)} · ❌ {fmtQty(simResult.rejectedQty)} · Total {fmtQty(simResult.totalQty)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {Object.keys(csvStore).length === 0 && (
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,padding:24,color:"#cbd5e1"}}>
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
              <rect x="6" y="6" width="32" height="32" rx="7" stroke="#e2e8f0" strokeWidth="1.5" strokeDasharray="4 3"/>
              <path d="M14 22h16M22 14v16" stroke="#e2e8f0" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <p style={{fontSize:12,color:"#94a3b8",textAlign:"center",lineHeight:1.6}}>
              Importe um CSV para<br/>adicioná-lo ao fluxo
            </p>
          </div>
        )}
      </div>

      {/* ═══════════════ GHOST ELEMENT (panel drag) ═══════════════ */}
      {ghostPos&&panelDrag&&(
        <div style={{position:"fixed",left:ghostPos.x,top:ghostPos.y,transform:"translate(-50%,-50%)",
          background:"#fef3c7",border:"1.5px solid #f59e0b",borderRadius:8,
          padding:"5px 12px",fontSize:12,fontWeight:600,color:"#92400e",
          pointerEvents:"none",zIndex:2000,boxShadow:"0 4px 16px rgba(0,0,0,.15)",
          display:"flex",alignItems:"center",gap:6}}>
          ◇ {panelDrag.col}
        </div>
      )}

      {/* ═══════════════ IMPORT FLOW ERROR MODAL ═══════════ */}
      {importError&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.45)",backdropFilter:"blur(4px)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"#fff",borderRadius:16,width:"100%",maxWidth:440,boxShadow:"0 24px 80px rgba(0,0,0,.2)",padding:"28px 32px",display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:40,height:40,borderRadius:12,background:"#fee2e2",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>⚠</div>
              <div>
                <h3 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:2}}>Erro ao Importar Fluxo</h3>
                <p style={{fontSize:12.5,color:"#64748b",lineHeight:1.5}}>{importError}</p>
              </div>
            </div>
            <button onClick={()=>setImportError(null)}
              style={{alignSelf:"flex-end",padding:"9px 22px",borderRadius:9,border:"none",background:"#2563eb",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* ═══════════════ IMPORT WIZARD MODAL ═══════════════ */}
      {wizard && (
        <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.4)",backdropFilter:"blur(4px)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div style={{background:"#fff",borderRadius:18,width:"100%",maxWidth:600,maxHeight:"90vh",display:"flex",flexDirection:"column",boxShadow:"0 24px 80px rgba(0,0,0,.2)"}}>

            {/* Wizard header */}
            <div style={{padding:"22px 28px 18px",borderBottom:"1px solid #f1f5f9"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <h2 style={{fontSize:17,fontWeight:700,color:"#1e293b",marginBottom:3}}>Importar CSV</h2>
                  <p style={{fontSize:12.5,color:"#64748b"}}>{wizard.filename}</p>
                  {/* Progress indicator */}
                  <div style={{display:"flex",alignItems:"center",gap:4,marginTop:8}}>
                    <div style={{width:24,height:4,borderRadius:2,background:"#3b82f6"}}/>
                    <div style={{width:24,height:4,borderRadius:2,background:wizard.step>=2?"#3b82f6":"#e2e8f0"}}/>
                    <span style={{fontSize:10.5,color:"#94a3b8",marginLeft:4}}>Passo {wizard.step} de 2</span>
                  </div>
                </div>
                <button onClick={()=>setWizard(null)} style={{width:32,height:32,borderRadius:8,border:"1px solid #e2e8f0",background:"#f8fafc",cursor:"pointer",fontSize:16,color:"#64748b",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>
            </div>

            <div style={{padding:"20px 28px",overflowY:"auto",flex:1}}>
              {wizard.step===1 ? (
                <>
                  {/* Delimiter detection */}
                  <div style={{marginBottom:20}}>
                    <p style={{fontSize:12,fontWeight:600,color:"#475569",marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>
                      Delimitador
                      {wizard.confident && <span style={{marginLeft:8,fontSize:11,color:"#16a34a",background:"#f0fdf4",border:"1px solid #bbf7d0",padding:"1px 8px",borderRadius:20}}>detectado automaticamente</span>}
                      {!wizard.confident && <span style={{marginLeft:8,fontSize:11,color:"#d97706",background:"#fffbeb",border:"1px solid #fde68a",padding:"1px 8px",borderRadius:20}}>verifique abaixo</span>}
                    </p>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                      {DELIMITERS.map(d=>(
                        <label key={d.value} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",borderRadius:9,border:`1.5px solid ${wizard.delimiter===d.value?"#3b82f6":"#e2e8f0"}`,background:wizard.delimiter===d.value?"#eff6ff":"#fafafa",cursor:"pointer",fontSize:13,color:wizard.delimiter===d.value?"#1d4ed8":"#475569",fontWeight:wizard.delimiter===d.value?600:400,transition:"all .12s"}}>
                          <input type="radio" name="delim" value={d.value} checked={wizard.delimiter===d.value} onChange={()=>setWizard(w=>({...w,delimiter:d.value}))} style={{accentColor:"#3b82f6"}}/>
                          {d.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  {/* Header row */}
                  <div style={{marginBottom:20}}>
                    <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                      <input type="checkbox" checked={wizard.hasHeader} onChange={e=>setWizard(w=>({...w,hasHeader:e.target.checked}))} style={{width:16,height:16,accentColor:"#3b82f6"}}/>
                      <span style={{fontSize:13,color:"#1e293b",fontWeight:500}}>Primeira linha como cabeçalho</span>
                    </label>
                  </div>
                  {/* Preview */}
                  <div>
                    <p style={{fontSize:12,fontWeight:600,color:"#475569",marginBottom:10,textTransform:"uppercase",letterSpacing:.5}}>Prévia (5 primeiras linhas)</p>
                    <div style={{border:"1px solid #e2e8f0",borderRadius:10,overflow:"auto",maxHeight:200}}>
                      {wizardPreview && wizardPreview.headers.length > 0 ? (
                        <table style={{borderCollapse:"collapse",fontSize:12,fontFamily:"inherit",width:"max-content",minWidth:"100%"}}>
                          <thead>
                            <tr>
                              {wizardPreview.headers.map((h,i)=>(<th key={i} style={{background:"#f8fafc",border:"1px solid #e2e8f0",padding:"6px 12px",color:"#475569",fontWeight:600,whiteSpace:"nowrap",minWidth:80}}>{h}</th>))}
                            </tr>
                          </thead>
                          <tbody>
                            {wizardPreview.rows.slice(0,5).map((row,ri)=>(
                              <tr key={ri} style={{background:ri%2===0?"#fff":"#fafafa"}}>
                                {wizardPreview.headers.map((_,ci)=>(<td key={ci} style={{border:"1px solid #f1f5f9",padding:"5px 12px",color:"#334155",whiteSpace:"nowrap"}}>{row[ci]??""}</td>))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div style={{padding:20,textAlign:"center",color:"#94a3b8",fontSize:13}}>Nenhum dado detectado com este delimitador</div>
                      )}
                    </div>
                    {wizardPreview && <p style={{fontSize:11,color:"#94a3b8",marginTop:6}}>{wizardPreview.rows.length} linhas · {wizardPreview.headers.length} colunas encontradas</p>}
                  </div>
                </>
              ) : (
                <>
                  {/* Step 2: Column classification */}
                  <p style={{fontSize:13,color:"#475569",marginBottom:16,lineHeight:1.6}}>
                    Classifique cada coluna para habilitar o simulador de crédito.
                  </p>
                  <div style={{border:"1px solid #e2e8f0",borderRadius:10,overflow:"hidden"}}>
                    {/* Header row */}
                    <div style={{display:"flex",alignItems:"center",padding:"8px 14px",background:"#f8fafc",borderBottom:"1px solid #e2e8f0"}}>
                      <span style={{flex:1,fontSize:11,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.5}}>Coluna</span>
                      <div style={{display:"flex",gap:6}}>
                        {COL_TYPES.map(ct=>(
                          <span key={ct.value} style={{width:86,textAlign:"center",fontSize:11,fontWeight:600,color:"#94a3b8",textTransform:"uppercase",letterSpacing:.5}}>{ct.icon} {ct.label}</span>
                        ))}
                      </div>
                    </div>
                    {(wizardPreview?.headers||[]).map((colName,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",padding:"10px 14px",borderBottom:i<(wizardPreview.headers.length-1)?"1px solid #f1f5f9":"none",background:i%2===0?"#fff":"#fafafa"}}>
                        <span style={{flex:1,fontSize:13,fontWeight:500,color:"#1e293b",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:180}}>{colName}</span>
                        <div style={{display:"flex",gap:6}}>
                          {COL_TYPES.map(ct=>{
                            const isSelected=wizard.columnTypes[colName]===ct.value;
                            return (
                              <label key={ct.value} style={{width:86,display:"flex",justifyContent:"center",cursor:"pointer"}}>
                                <input type="radio" name={`col-${i}`} value={ct.value}
                                  checked={isSelected}
                                  onChange={()=>setWizard(w=>({...w,columnTypes:{...w.columnTypes,[colName]:ct.value}}))}
                                  style={{display:"none"}}/>
                                <div style={{width:22,height:22,borderRadius:6,
                                  border:`2px solid ${isSelected?"#3b82f6":"#e2e8f0"}`,
                                  background:isSelected?"#3b82f6":"#fff",
                                  display:"flex",alignItems:"center",justifyContent:"center",
                                  transition:"all .12s"}}>
                                  {isSelected&&<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p style={{fontSize:11,color:"#94a3b8",marginTop:10,lineHeight:1.6}}>
                    As colunas marcadas como <strong>Decisão</strong> estarão disponíveis para arrastar ao canvas.
                  </p>
                </>
              )}
            </div>

            {/* Wizard footer */}
            <div style={{padding:"16px 28px",borderTop:"1px solid #f1f5f9",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
              <div>
                {wizard.step===2&&(
                  <button onClick={()=>setWizard(w=>({...w,step:1}))}
                    style={{padding:"9px 16px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>
                    ← Voltar
                  </button>
                )}
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setWizard(null)} style={{padding:"9px 20px",borderRadius:9,border:"1px solid #e2e8f0",background:"#fff",color:"#475569",cursor:"pointer",fontSize:13,fontWeight:500,fontFamily:"inherit"}}>Cancelar</button>
                {wizard.step===1 ? (
                  <button onClick={()=>setWizard(w=>({...w,step:2}))}
                    disabled={!wizardPreview||wizardPreview.headers.length===0}
                    style={{padding:"9px 22px",borderRadius:9,border:"none",background:(!wizardPreview||wizardPreview.headers.length===0)?"#cbd5e1":"#2563eb",color:"#fff",cursor:(!wizardPreview||wizardPreview.headers.length===0)?"not-allowed":"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>
                    Próximo →
                  </button>
                ) : (
                  <button onClick={onImportConfirm}
                    disabled={!wizardPreview||wizardPreview.headers.length===0}
                    style={{padding:"9px 22px",borderRadius:9,border:"none",background:(!wizardPreview||wizardPreview.headers.length===0)?"#cbd5e1":"#2563eb",color:"#fff",cursor:(!wizardPreview||wizardPreview.headers.length===0)?"not-allowed":"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>
                    Importar →
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
