// ── policyIRFingerprint — hash canônico e estável do PolicyIR (Jornada NB, DEC-NB-003) ──
// Módulo folha (ZERO imports) para poder ser usado pelo worker (que não pode importar
// policyIR.js, pois este importa App.jsx) E pelo main thread — o mesmo hash precisa ser
// computado nos dois lados para comparar "IR da última doc gerada" × "IR atual" (staleness
// da Documentação) e "IR quando o achado Tier 2 foi calculado" × "IR atual" (staleness da
// Descoberta/Simplificação no feed).
//
// A serialização canônica cobre EXATAMENTE os mesmos campos que `diffPolicyIR` (policyIR.js)
// considera ao decidir se um nó "mudou" — assim "fingerprint diferente" ⇔ "diffPolicyIR
// acusaria mudança". Ignora posições/dados (o IR já nasce sem x/y e sem dados linha a linha,
// DEC-IA-002); nós são ordenados por id para independer da ordem de construção.

function canonicalNode(n) {
  const base = { id: n.id, kind: n.kind, label: n.label ?? null };
  if (n.kind === 'decision') return { ...base, variable: n.variable ?? null, routes: n.routes ?? null };
  if (n.kind === 'cinema') return {
    ...base, cinemaType: n.cinemaType ?? null,
    rowVar: n.rowVar ?? null, colVar: n.colVar ?? null,
    rowDomain: n.rowDomain ?? null, colDomain: n.colDomain ?? null,
    blockedCells: n.blockedCells ?? null, routes: n.routes ?? null,
  };
  if (n.kind === 'lens') return { ...base, rules: n.rules ?? null, to: n.to ?? null };
  if (n.kind === 'terminal') return { ...base, terminal: n.terminal ?? null };
  return base;
}

// FNV-1a 32-bit → 8 hex chars. Determinístico e sem dependências.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('0000000' + h.toString(16)).slice(-8);
}

export function policyIRFingerprint(ir) {
  if (!ir || !Array.isArray(ir.nodes)) return '00000000';
  const nodes = [...ir.nodes]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(canonicalNode);
  const canon = JSON.stringify({ nodes, entry: ir.entry ?? [] });
  return fnv1a(canon);
}
