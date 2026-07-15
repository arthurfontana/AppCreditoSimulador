// ── Documentação Automática — Renderers (Copiloto Sessão 6, DEC-IA-006) ──────
// O worker (COMPUTE_POLICY_DOC/POLICY_DOC_RESULT) devolve o docModel — árvore de
// seções com dados NUMÉRICOS CRUS, nunca prosa pronta. As funções deste módulo são a
// APRESENTAÇÃO: puras (mesmo docModel ⇒ mesmo texto, sem tocar worker/csvStore), para
// que o Nível 2 (reescrita em prosa por IA) receba o docModel e não HTML, e para que o
// GATE (tests/policyDoc.test.js) possa verificar determinismo/privacidade só
// inspecionando string de saída. Consomem o docModel/PolicyIR JÁ montado — nunca
// recalculam o motor; a montagem do docModel a partir do motor vive no worker.
//
// Dependência circular App.jsx ⇄ policyDocRender.js: as funções abaixo só usam
// fmtQty/fmtPct/BUILD_NUMBER/BUILD_HASH/COL_TYPES/LENS_OP_LABEL/escHtml (importados de
// App.jsx) dentro de corpos de função, então resolvem em runtime (mesmo padrão de
// analytics.js/policyIR.js). App.jsx importa renderDocMarkdown/renderDocHTML daqui e os
// re-exporta para os testes que ainda importam de App.jsx (tests/policyDoc.test.js).
import { fmtQty, fmtPct, BUILD_NUMBER, BUILD_HASH, COL_TYPES, LENS_OP_LABEL, escHtml } from "./App.jsx";
import { POLICY_TERMINAL_LABELS } from "./policyIR.js";
import { formatBandLabel } from "./rangeVar.js";

// Hash não-criptográfico curto (FNV-1a 32-bit) — só para o carimbo de rastreabilidade
// do documento ("hash da política"), nunca para integridade/segurança.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
function hashPolicyIR(ir) {
  const { generatedAt, ...rest } = ir || {};
  return fnv1a(JSON.stringify(rest));
}

const fmtPct100 = (v) => v == null ? 'N/A' : `${v.toFixed(2)}%`;
const fmtDelta100 = (v) => v == null ? 'N/A' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}pp`;

function describeLensRule(rule) {
  const opLabel = LENS_OP_LABEL[rule.operator] || rule.operator;
  const valueText = rule.value == null ? '(valor omitido)' : `"${rule.value}"`;
  return `${rule.col ?? '?'} ${opLabel} ${valueText}`;
}
function describeLensRules(rules) {
  if (!rules || rules.length === 0) return '(sem regras — deixa passar 100% do volume)';
  let out = describeLensRule(rules[0]);
  for (let i = 1; i < rules.length; i++) out += (rules[i - 1].logic === 'OR' ? ' OU ' : ' E ') + describeLensRule(rules[i]);
  return out;
}
// Condição de um path achatado (raiz→terminal) — texto plano, reusado por Markdown/HTML.
function describeCondition(cond) {
  if (cond.kind === 'decision') {
    return cond.values
      ? `${cond.col || cond.label} ∈ {${cond.values.join(', ')}}`
      : `${cond.col || cond.label} (${cond.valueCount} valor(es), domínio omitido)`;
  }
  if (cond.kind === 'cinema') return `${cond.label}: ${cond.eligible ? 'elegível' : 'não elegível'}`;
  if (cond.kind === 'lens') return `${cond.label}: ${describeLensRules(cond.rules)}`;
  return cond.label || '?';
}
const PATH_REASON_LABEL = {
  ciclo: 'ciclo no fluxo (loop) — não finaliza',
  sem_destino: 'sem destino conectado — não finaliza',
  destino_inexistente: 'destino inexistente — não finaliza',
  sem_rotas: 'sem rotas configuradas — não finaliza',
};
function describeFlowNode(fn) {
  if (fn.kind === 'decision') {
    const routesText = fn.routes.map(r => {
      const dest = r.to || '(sem destino)';
      const vals = r.values ? `{${r.values.join(', ')}}` : `${r.valueCount} valor(es) (domínio omitido)`;
      return `${vals} → ${dest}`;
    }).join('; ');
    return `Segmenta as propostas por **${fn.variable?.col || fn.label}**: ${routesText || '(sem rotas)'}.`;
  }
  if (fn.kind === 'cinema') {
    const axis = [fn.rowVar?.col, fn.colVar?.col].filter(Boolean).join(' × ') || '(sem eixos configurados)';
    const cellsText = fn.blockedCells
      ? `${fn.blockedCells.length} de ${fn.totalCells} combinação(ões) não elegível(is): ${fn.blockedCells.join(', ') || '(nenhuma)'}`
      : `${fn.blockedCount} de ${fn.totalCells} combinação(ões) não elegível(is) (domínio omitido)`;
    return `Matriz cruzada (Cineminha) sobre **${axis}**: ${cellsText}.`;
  }
  if (fn.kind === 'lens') return `Filtra a população por: ${describeLensRules(fn.rules)}.`;
  if (fn.kind === 'terminal') {
    if (fn.terminal === 'approved') return `Encerra o caminho como **Aprovado**.`;
    if (fn.terminal === 'rejected') return `Encerra o caminho como **Reprovado**.`;
    return `Encerra o caminho mantendo a **decisão histórica (AS IS)**.`;
  }
  return '';
}
function describePath(p) {
  const conds = p.conditions.map(describeCondition).join(' E ') || '(sem condições — raiz é terminal)';
  if (p.terminal) return `SE ${conds} ⇒ ${POLICY_TERMINAL_LABELS[p.terminal] || p.terminal}`;
  return `SE ${conds} ⇒ (${PATH_REASON_LABEL[p.reason] || 'sem finalização'})`;
}

function mdTable(headers, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}
function mdBoldToHtml(s) {
  return escHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
function htmlTable(headers, rows) {
  const th = headers.map(h => `<th>${escHtml(h)}</th>`).join('');
  const trs = rows.map(r => `<tr>${r.map(c => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

// Renderiza o docModel como Markdown — download `.md` (item 7 do épico). Determinístico:
// mesmo docModel ⇒ mesma string (exceto `generatedAt`, carimbado à parte).
export function renderDocMarkdown(docModel) {
  if (!docModel) return '';
  const { meta, ir, flowNodes, paths, kpis, funnel, reliability, scenarios, glossary, changelog, options } = docModel;
  const L = [];
  const p = (s = '') => L.push(s);

  p(`# Documento de Política de Crédito${meta?.name ? ` — ${meta.name}` : ''}`);
  p('');
  p(`_Gerado em ${new Date(docModel.generatedAt).toLocaleString('pt-BR')} · build #${BUILD_NUMBER} (${BUILD_HASH}) · hash da política: ${hashPolicyIR(ir)}${options?.includeDomains ? '' : ' · domínios de valores omitidos'}_`);
  p('');

  p('## Sumário Executivo');
  p('');
  const { simResult, incrementalResult } = kpis || {};
  if (simResult) {
    p(`- **Taxa de Aprovação (simulada):** ${fmtPct100(simResult.approvalRate)}`);
    p(`- **Inad. Real:** ${fmtPct(simResult.inadReal)}`);
    p(`- **Inad. Inferida:** ${fmtPct(simResult.inadInferida)}`);
    p(`- **Volume total:** ${fmtQty(simResult.totalQty)} (✅ ${fmtQty(simResult.approvedQty)} · ❌ ${fmtQty(simResult.rejectedQty)}${simResult.asIsQty ? ` · ⟳ ${fmtQty(simResult.asIsQty)}` : ''})`);
  }
  if (incrementalResult) {
    p('');
    p('**Comparativo vs. AS IS**');
    p('');
    p(mdTable(
      ['', 'AS IS', 'Simulado', 'Delta'],
      [
        ['Taxa de Aprovação', fmtPct100(incrementalResult.baseline.approvalRate), fmtPct100(incrementalResult.simulated.approvalRate), fmtDelta100(incrementalResult.impacted.approvalDelta)],
        ['Inad. Real', fmtPct(incrementalResult.baseline.inadReal), fmtPct(incrementalResult.simulated.inadReal), ''],
        ['Inad. Inferida', fmtPct(incrementalResult.baseline.inadInferida), fmtPct(incrementalResult.simulated.inadInferida), ''],
      ],
    ));
    p('');
    p(`População impactada: ${fmtQty(incrementalResult.impacted.qty)} (${fmtPct100(incrementalResult.impacted.pct)}) — ${fmtQty(incrementalResult.impacted.rToA)} promovida(s) (Reprovado→Aprovado), ${fmtQty(incrementalResult.impacted.aToR)} rejeitada(s) a mais (Aprovado→Reprovado).`);
  } else {
    p('');
    p('_Baseline AS IS não configurada — sem comparativo disponível._');
  }
  p('');

  p('## Fluxo da Política');
  p('');
  if (!flowNodes || flowNodes.length === 0) {
    p('_Canvas vazio — nenhum nó de fluxo._');
  } else {
    for (const fn of flowNodes) p(`- **${fn.label}** _(${fn.kind})_ — ${describeFlowNode(fn)}`);
  }
  p('');

  p('## Regras Achatadas (raiz → terminal)');
  p('');
  if (!paths || paths.list.length === 0) {
    p('_Sem caminhos — nenhuma raiz de fluxo configurada._');
  } else {
    paths.list.forEach((path, i) => p(`${i + 1}. ${describePath(path)}`));
    if (paths.truncated) p('');
    if (paths.truncated) p('_(lista truncada — política com combinações demais para listar por completo)_');
  }
  p('');

  p('## Funil por Nó e Valor');
  p('');
  if (!funnel || funnel.rows.length === 0) {
    p('_Sem dados de funil — nenhuma raiz de fluxo configurada._');
  } else {
    p(mdTable(
      ['Nó', 'Valor', 'Volume', 'Aprovado', 'Reprovado', 'Taxa Aprov.', 'Inad. Real', 'Inad. Inferida'],
      funnel.rows.map(r => [r.nodeName, r.value ?? '(agregado por nó)', fmtQty(r.qty), fmtQty(r.approvedQty), fmtQty(r.rejectedQty), fmtPct(r.approvalRate), fmtPct(r.inadReal), fmtPct(r.inadInferida)]),
    ));
    if (funnel.totals) {
      p('');
      p(`**Total:** ${fmtQty(funnel.totals.qty)} propostas · ${fmtPct100((funnel.totals.approvalRate ?? 0) * 100)} aprovação · Inad. Real ${fmtPct(funnel.totals.inadReal)} · Inad. Inferida ${fmtPct(funnel.totals.inadInferida)}`);
    }
  }
  p('');

  p('## Confiabilidade da Amostra');
  p('');
  if (!reliability || !reliability.hasLowSample) {
    p(`_Nenhum segmento com amostra abaixo de ${reliability?.minSample ?? 30} altas — números estatisticamente estáveis._`);
  } else {
    p(`⚠ Os segmentos abaixo têm menos de ${reliability.minSample} altas (real ou inferida) — leia as taxas com cautela (alta variância amostral):`);
    p('');
    p(mdTable(['Nó', 'Valor', 'Altas Reais', 'Altas Inferidas'], reliability.lowSampleRows.map(r => [r.nodeName, r.value ?? '(agregado por nó)', fmtQty(r.qtdAltasSum), fmtQty(r.qtdAltasInferSum)])));
  }
  p('');

  p('## Comparação de Cenários');
  p('');
  if (!scenarios) {
    p('_Baseline AS IS não configurada — comparação de cenários indisponível._');
  } else {
    p(mdTable(
      ['Cenário', 'Taxa de Aprovação', 'Inad. Real', 'Inad. Inferida'],
      scenarios.rows.map(r => [r.nome, fmtPct100(r.approvalRate), fmtPct(r.inadReal), fmtPct(r.inadInferida)]),
    ));
  }
  p('');

  if (changelog) {
    p('## Changelog Estrutural');
    p('');
    p(`Comparado com: **${changelog.compareName || 'versão anterior'}**`);
    p('');
    const { added, removed, changed, entryChanged } = changelog.irDiff;
    if (added.length === 0 && removed.length === 0 && changed.length === 0 && !entryChanged) {
      p('_Nenhuma diferença estrutural._');
    } else {
      if (added.length) { p('**Adicionados:**'); for (const n of added) p(`- ${n.label} (${n.kind})`); p(''); }
      if (removed.length) { p('**Removidos:**'); for (const n of removed) p(`- ${n.label} (${n.kind})`); p(''); }
      if (changed.length) {
        p('**Alterados:**');
        for (const n of changed) for (const f of n.fields) p(`- ${n.label} (${n.kind}) — campo \`${f.key}\` mudou`);
        p('');
      }
      if (entryChanged) p('- Raízes do fluxo (`entry`) mudaram.');
    }
    p('');
    p(mdTable(
      ['', 'Antes', 'Depois'],
      [
        ['Taxa de Aprovação', fmtPct100(changelog.before.kpis.approvalRate), fmtPct100(changelog.after.kpis.approvalRate)],
        ['Inad. Real', fmtPct(changelog.before.kpis.inadReal), fmtPct(changelog.after.kpis.inadReal)],
        ['Inad. Inferida', fmtPct(changelog.before.kpis.inadInferida), fmtPct(changelog.after.kpis.inadInferida)],
      ],
    ));
    p('');
  }

  p('## Glossário de Variáveis');
  p('');
  if (!glossary || glossary.length === 0) {
    p('_Nenhuma variável referenciada._');
  } else {
    p(mdTable(
      ['Coluna', 'Base', 'Papel', 'Tipo', 'Tipo de Variável', 'Domínio'],
      glossary.map(g => [
        g.col, g.csvName || '—', g.role === 'decision' ? 'Decisão' : 'Regra (Lens)',
        COL_TYPES.find(t => t.value === g.colType)?.label || g.colType || '—',
        g.varType || '—',
        g.values ? g.values.join(', ') : (g.domainSize != null ? `${g.domainSize} valor(es)` : '—'),
      ]),
    ));
  }

  // Regras das Variáveis de Cluster (interpretação da Clusterização) — os grupos e as
  // faixas de valor por dimensão que definem cada cluster. Valores concretos só quando
  // includeDomains (o worker já redige em describeClusterRules).
  const clusterVars = (glossary || []).filter(g => g.cluster);
  if (clusterVars.length) {
    p('');
    p('### Regras dos Clusters');
    p('');
    for (const g of clusterVars) {
      p(`**${g.col}** — agrupa por ${g.cluster.dims.join(', ') || '—'} (${g.cluster.method || 'k-means'}); fora dos grupos → _${g.cluster.unmatchedLabel}_.`);
      p('');
      for (const grp of g.cluster.groups) {
        const dimsTxt = grp.dims.map(d => d.values ? `${d.col}: ${d.values.join(', ')}` : `${d.col}: ${d.valueCount} valor(es)`).join(' · ');
        p(`- **${grp.label}** — ${dimsTxt || '—'}`);
      }
      p('');
    }
  }

  // Regras das Variáveis de Faixas (Épico FR) — os intervalos [min, max) de cada faixa
  // sobre a coluna contínua de origem. O worker anexa `range` via describeRangeRules
  // (mesmo ponto do `cluster`); sob N2 (includeDomains=false) os cortes concretos já
  // chegam nulos — sinalizamos a omissão explicitamente em vez de rotular errado.
  const rangeVars = (glossary || []).filter(g => g.range);
  if (rangeVars.length) {
    p('');
    p('### Regras das Faixas');
    p('');
    for (const g of rangeVars) {
      const metricTxt = g.range.metric?.label ? ` (métrica: ${g.range.metric.label})` : '';
      p(`**${g.col}** — faixas de **${g.range.sourceCol || '—'}**${metricTxt}; sem valor → _${g.range.unmatchedLabel}_.`);
      p('');
      for (const b of (g.range.bands || [])) {
        p(`- **${b.label}** — ${options?.includeDomains ? formatBandLabel(b.min, b.max) : '(cortes omitidos)'}`);
      }
      p('');
    }
  }

  return L.join('\n');
}

// Renderiza o docModel como HTML self-contained (inline styles — ADR-002) para abrir em
// nova janela e `window.print()` (→ PDF via navegador). Mesmo conteúdo/números do Markdown.
export function renderDocHTML(docModel) {
  if (!docModel) return '<html><body>Sem documento.</body></html>';
  const { meta, ir, flowNodes, paths, kpis, funnel, reliability, scenarios, glossary, changelog, options } = docModel;
  const S = [];
  const h = (level, text) => S.push(`<h${level} style="font-family:system-ui,sans-serif;color:#1e293b;">${mdBoldToHtml(text)}</h${level}>`);
  const para = (text) => S.push(`<p style="font-family:system-ui,sans-serif;color:#334155;line-height:1.6;">${mdBoldToHtml(text)}</p>`);
  const tableStyle = `<style>
    table{border-collapse:collapse;width:100%;margin:8px 0 16px;font-family:system-ui,sans-serif;font-size:13px;}
    th,td{border:1px solid #cbd5e1;padding:6px 10px;text-align:left;}
    th{background:#f1f5f9;color:#334155;}
    body{max-width:900px;margin:32px auto;padding:0 16px;}
    ul{font-family:system-ui,sans-serif;color:#334155;line-height:1.7;}
    @media print { body{margin:0;padding:16px;} }
  </style>`;

  S.push(`<!doctype html><html><head><meta charset="utf-8"><title>Documento de Política${meta?.name ? ` — ${escHtml(meta.name)}` : ''}</title>${tableStyle}</head><body>`);
  h(1, `Documento de Política de Crédito${meta?.name ? ` — ${meta.name}` : ''}`);
  S.push(`<p style="font-family:system-ui,sans-serif;color:#94a3b8;font-size:12px;">Gerado em ${escHtml(new Date(docModel.generatedAt).toLocaleString('pt-BR'))} · build #${escHtml(BUILD_NUMBER)} (${escHtml(BUILD_HASH)}) · hash da política: ${hashPolicyIR(ir)}${options?.includeDomains ? '' : ' · domínios de valores omitidos'}</p>`);

  h(2, 'Sumário Executivo');
  const { simResult, incrementalResult } = kpis || {};
  if (simResult) {
    S.push(`<ul>
      <li><strong>Taxa de Aprovação (simulada):</strong> ${fmtPct100(simResult.approvalRate)}</li>
      <li><strong>Inad. Real:</strong> ${fmtPct(simResult.inadReal)}</li>
      <li><strong>Inad. Inferida:</strong> ${fmtPct(simResult.inadInferida)}</li>
      <li><strong>Volume total:</strong> ${fmtQty(simResult.totalQty)} (✅ ${fmtQty(simResult.approvedQty)} · ❌ ${fmtQty(simResult.rejectedQty)}${simResult.asIsQty ? ` · ⟳ ${fmtQty(simResult.asIsQty)}` : ''})</li>
    </ul>`);
  }
  if (incrementalResult) {
    para('**Comparativo vs. AS IS**');
    S.push(htmlTable(['', 'AS IS', 'Simulado', 'Delta'], [
      ['Taxa de Aprovação', fmtPct100(incrementalResult.baseline.approvalRate), fmtPct100(incrementalResult.simulated.approvalRate), fmtDelta100(incrementalResult.impacted.approvalDelta)],
      ['Inad. Real', fmtPct(incrementalResult.baseline.inadReal), fmtPct(incrementalResult.simulated.inadReal), ''],
      ['Inad. Inferida', fmtPct(incrementalResult.baseline.inadInferida), fmtPct(incrementalResult.simulated.inadInferida), ''],
    ]));
    para(`População impactada: ${fmtQty(incrementalResult.impacted.qty)} (${fmtPct100(incrementalResult.impacted.pct)}) — ${fmtQty(incrementalResult.impacted.rToA)} promovida(s) (Reprovado→Aprovado), ${fmtQty(incrementalResult.impacted.aToR)} rejeitada(s) a mais (Aprovado→Reprovado).`);
  } else {
    para('_Baseline AS IS não configurada — sem comparativo disponível._');
  }

  h(2, 'Fluxo da Política');
  if (!flowNodes || flowNodes.length === 0) para('_Canvas vazio — nenhum nó de fluxo._');
  else S.push(`<ul>${flowNodes.map(fn => `<li><strong>${escHtml(fn.label)}</strong> <em>(${escHtml(fn.kind)})</em> — ${mdBoldToHtml(describeFlowNode(fn))}</li>`).join('')}</ul>`);

  h(2, 'Regras Achatadas (raiz → terminal)');
  if (!paths || paths.list.length === 0) para('_Sem caminhos — nenhuma raiz de fluxo configurada._');
  else {
    S.push(`<ol style="font-family:system-ui,sans-serif;color:#334155;line-height:1.7;">${paths.list.map(path => `<li>${escHtml(describePath(path))}</li>`).join('')}</ol>`);
    if (paths.truncated) para('_(lista truncada — política com combinações demais para listar por completo)_');
  }

  h(2, 'Funil por Nó e Valor');
  if (!funnel || funnel.rows.length === 0) para('_Sem dados de funil — nenhuma raiz de fluxo configurada._');
  else {
    S.push(htmlTable(
      ['Nó', 'Valor', 'Volume', 'Aprovado', 'Reprovado', 'Taxa Aprov.', 'Inad. Real', 'Inad. Inferida'],
      funnel.rows.map(r => [r.nodeName, r.value ?? '(agregado por nó)', fmtQty(r.qty), fmtQty(r.approvedQty), fmtQty(r.rejectedQty), fmtPct(r.approvalRate), fmtPct(r.inadReal), fmtPct(r.inadInferida)]),
    ));
    if (funnel.totals) para(`<strong>Total:</strong> ${fmtQty(funnel.totals.qty)} propostas · ${fmtPct100((funnel.totals.approvalRate ?? 0) * 100)} aprovação · Inad. Real ${fmtPct(funnel.totals.inadReal)} · Inad. Inferida ${fmtPct(funnel.totals.inadInferida)}`);
  }

  h(2, 'Confiabilidade da Amostra');
  if (!reliability || !reliability.hasLowSample) para(`_Nenhum segmento com amostra abaixo de ${reliability?.minSample ?? 30} altas — números estatisticamente estáveis._`);
  else {
    para(`⚠ Os segmentos abaixo têm menos de ${reliability.minSample} altas (real ou inferida) — leia as taxas com cautela (alta variância amostral):`);
    S.push(htmlTable(['Nó', 'Valor', 'Altas Reais', 'Altas Inferidas'], reliability.lowSampleRows.map(r => [r.nodeName, r.value ?? '(agregado por nó)', fmtQty(r.qtdAltasSum), fmtQty(r.qtdAltasInferSum)])));
  }

  h(2, 'Comparação de Cenários');
  if (!scenarios) para('_Baseline AS IS não configurada — comparação de cenários indisponível._');
  else S.push(htmlTable(['Cenário', 'Taxa de Aprovação', 'Inad. Real', 'Inad. Inferida'], scenarios.rows.map(r => [r.nome, fmtPct100(r.approvalRate), fmtPct(r.inadReal), fmtPct(r.inadInferida)])));

  if (changelog) {
    h(2, 'Changelog Estrutural');
    para(`Comparado com: <strong>${escHtml(changelog.compareName || 'versão anterior')}</strong>`);
    const { added, removed, changed, entryChanged } = changelog.irDiff;
    if (added.length === 0 && removed.length === 0 && changed.length === 0 && !entryChanged) {
      para('_Nenhuma diferença estrutural._');
    } else {
      if (added.length) S.push(`<p><strong>Adicionados:</strong></p><ul>${added.map(n => `<li>${escHtml(n.label)} (${escHtml(n.kind)})</li>`).join('')}</ul>`);
      if (removed.length) S.push(`<p><strong>Removidos:</strong></p><ul>${removed.map(n => `<li>${escHtml(n.label)} (${escHtml(n.kind)})</li>`).join('')}</ul>`);
      if (changed.length) S.push(`<p><strong>Alterados:</strong></p><ul>${changed.flatMap(n => n.fields.map(f => `<li>${escHtml(n.label)} (${escHtml(n.kind)}) — campo <code>${escHtml(f.key)}</code> mudou</li>`)).join('')}</ul>`);
      if (entryChanged) para('- Raízes do fluxo (entry) mudaram.');
    }
    S.push(htmlTable(['', 'Antes', 'Depois'], [
      ['Taxa de Aprovação', fmtPct100(changelog.before.kpis.approvalRate), fmtPct100(changelog.after.kpis.approvalRate)],
      ['Inad. Real', fmtPct(changelog.before.kpis.inadReal), fmtPct(changelog.after.kpis.inadReal)],
      ['Inad. Inferida', fmtPct(changelog.before.kpis.inadInferida), fmtPct(changelog.after.kpis.inadInferida)],
    ]));
  }

  h(2, 'Glossário de Variáveis');
  if (!glossary || glossary.length === 0) para('_Nenhuma variável referenciada._');
  else S.push(htmlTable(
    ['Coluna', 'Base', 'Papel', 'Tipo', 'Tipo de Variável', 'Domínio'],
    glossary.map(g => [
      g.col, g.csvName || '—', g.role === 'decision' ? 'Decisão' : 'Regra (Lens)',
      COL_TYPES.find(t => t.value === g.colType)?.label || g.colType || '—',
      g.varType || '—',
      g.values ? g.values.join(', ') : (g.domainSize != null ? `${g.domainSize} valor(es)` : '—'),
    ]),
  ));

  const clusterVarsH = (glossary || []).filter(g => g.cluster);
  if (clusterVarsH.length) {
    h(3, 'Regras dos Clusters');
    for (const g of clusterVarsH) {
      para(`**${g.col}** — agrupa por ${escHtml(g.cluster.dims.join(', ') || '—')} (${escHtml(g.cluster.method || 'k-means')}); fora dos grupos → _${escHtml(g.cluster.unmatchedLabel)}_.`);
      const items = g.cluster.groups.map(grp => {
        const dimsTxt = grp.dims.map(d => d.values ? `${d.col}: ${escHtml(d.values.join(', '))}` : `${d.col}: ${d.valueCount} valor(es)`).join(' · ');
        return `<li><strong>${escHtml(grp.label)}</strong> — ${dimsTxt || '—'}</li>`;
      }).join('');
      S.push(`<ul>${items}</ul>`);
    }
  }

  const rangeVarsH = (glossary || []).filter(g => g.range);
  if (rangeVarsH.length) {
    h(3, 'Regras das Faixas');
    for (const g of rangeVarsH) {
      const metricTxt = g.range.metric?.label ? ` (métrica: ${escHtml(g.range.metric.label)})` : '';
      para(`**${g.col}** — faixas de **${escHtml(g.range.sourceCol || '—')}**${metricTxt}; sem valor → _${escHtml(g.range.unmatchedLabel)}_.`);
      const items = (g.range.bands || []).map(b =>
        `<li><strong>${escHtml(b.label)}</strong> — ${options?.includeDomains ? escHtml(formatBandLabel(b.min, b.max)) : '(cortes omitidos)'}</li>`
      ).join('');
      S.push(`<ul>${items}</ul>`);
    }
  }

  S.push('</body></html>');
  return S.join('\n');
}
