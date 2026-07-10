// src/computeRouter.js
// ─────────────────────────────────────────────────────────────────────────────
// Execução Híbrida — Sessão H4: ComputeRouter + contrato ComputeProvider.
//
// Referência normativa: docs/wiki/Arquitetura-Execucao-Hibrida.md
//   · DEC-HX-002 — fronteira única: o protocolo `COMPUTE_* → *_RESULT` do worker é a
//     fronteira; um ComputeRouter (main thread) decide, POR TAREFA, o executor
//     (`worker` default ou `sidecar`). A UI posta a mesma mensagem e recebe o MESMO
//     payload de resultado — quem computou é invisível. Nenhum segundo caminho de
//     aplicação/materialização é criado.
//   · DEC-HX-004 — capacidades declaradas, nunca presumidas (`/capabilities`).
//   · DEC-HX-006 — dados sobem UMA vez, referenciados por hash (HEAD antes de POST;
//     corpo = os mesmos chunks de `serializeCsvStore`/`buildProjectJSONChunks` do M3).
//   · DEC-HX-007 — classes de tarefa (contrato de degradação), PARIDADE TOTAL (P4):
//       Classe A — core; roda SEMPRE no worker (o tick de edição JAMAIS roteia).
//       Classe B — ampliada; tenta o sidecar com FALLBACK TRANSPARENTE ao worker nos
//                  tetos declarados. Nenhuma tarefa exige o sidecar.
//
// Este módulo é puro/independente de React e de `App.jsx` (evita ciclo de import): a
// main injeta o worker, o provider sidecar e um leitor da preferência; os chunks de
// dataset chegam por callback (`buildChunks`), então o router não precisa conhecer
// `columnar.js`. Sem Python nesta sessão — o sidecar é exercido por fetch mockado nos
// testes (tests/computeRouter.test.js).
// ─────────────────────────────────────────────────────────────────────────────

// Versão do protocolo Browser ⇄ Python (§8). Mismatch ⇒ sidecar tratado como
// indisponível (nunca "tenta mesmo assim").
export const PROTOCOL_VERSION = 1;

export const DEFAULT_SIDECAR_URL = 'http://127.0.0.1:8080';
export const DEFAULT_HEALTH_TIMEOUT_MS = 1000; // §9 boot: health com timeout de 1s
export const DEFAULT_POLL_INTERVAL_MS = 500;   // §8 jobs longos: polling a cada ~500ms

// ── Tabela de roteamento por classe (DEC-HX-007) ────────────────────────────────
// Toda tarefa que existe HOJE é Classe A (core, paridade total do baseline): roda
// sempre no worker. O tick de edição e qualquer resposta síncrona a gesto estão aqui
// e JAMAIS roteiam pro sidecar (regra de ouro). Classe B são as cargas ampliadas /
// análises novas que o sidecar acelera/destrava — nenhuma existe em produção ainda;
// `echo_stats` é a tarefa de benchmark ponta a ponta introduzida pela H5.
export const TASK_CLASS = {
  // Classe A — SEMPRE worker
  RUN_SIMULATION: 'A',
  COMPUTE_OVERLAY: 'A',
  COMPUTE_ASIS_PREVIEW: 'A',
  COMPUTE_OPTIM: 'A',
  COMPUTE_ANALYTICS_DATASET: 'A',
  COMPUTE_POLICY_INSIGHTS: 'A',
  COMPUTE_SIMPLIFY: 'A',
  COMPUTE_JOHNNY: 'A',
  COMPUTE_GOAL_SEEK: 'A',
  COMPUTE_VARIABLE_RANKING: 'A',
  COMPUTE_POLICY_DOC: 'A',
  COMPUTE_SEGMENT_DISCOVERY: 'A', // Descoberta depth ≤ 2 é Classe A (§7.2)
  COMPUTE_SEGMENT_COMBINED: 'A',
  // Classe B — sidecar com fallback transparente ao worker
  echo_stats: 'B',
};

// Default DEFENSIVO: tarefa desconhecida vira Classe A (worker — o caminho completo).
// Assim nada "vaza" pro sidecar por engano; uma Classe B nova precisa se declarar.
export function classOf(task) {
  return TASK_CLASS[task] === 'B' ? 'B' : 'A';
}

// tarefa (worker) → tipo da mensagem `*_RESULT` correspondente. Payloads intocados
// (DEC-HX-002): o WorkerProvider só correlaciona a resposta, não a reescreve.
export const RESULT_TYPE = {
  RUN_SIMULATION: 'SIMULATION_RESULT',
  COMPUTE_OVERLAY: 'OVERLAY_RESULT',
  COMPUTE_ASIS_PREVIEW: 'ASIS_PREVIEW_RESULT',
  COMPUTE_OPTIM: 'OPTIM_RESULT',
  COMPUTE_ANALYTICS_DATASET: 'ANALYTICS_RESULT',
  COMPUTE_POLICY_INSIGHTS: 'POLICY_INSIGHTS_RESULT',
  COMPUTE_SIMPLIFY: 'SIMPLIFY_RESULT',
  COMPUTE_JOHNNY: 'JOHNNY_RESULT',
  COMPUTE_GOAL_SEEK: 'GOAL_SEEK_RESULT',
  COMPUTE_VARIABLE_RANKING: 'VARIABLE_RANKING_RESULT',
  COMPUTE_POLICY_DOC: 'POLICY_DOC_RESULT',
  COMPUTE_SEGMENT_DISCOVERY: 'SEGMENT_DISCOVERY_RESULT',
  COMPUTE_SEGMENT_COMBINED: 'SEGMENT_COMBINED_RESULT',
};

export function resultTypeFor(task) {
  return RESULT_TYPE[task] || task + '_RESULT';
}

// Hash de conteúdo dos chunks do dataset (FNV-1a 32-bit hex) — papel do
// `csvStoreVersion` (DEC-HX-006), computável na main sem depender do contador privado
// do worker. Determinístico: os mesmos chunks ⇒ o mesmo hash ⇒ o sidecar reusa o
// dataset (HEAD 200) sem re-upload. Só o caller de Classe B paga esse custo.
export function hashChunks(chunks) {
  const parts = Array.isArray(chunks) ? chunks : [String(chunks == null ? '' : chunks)];
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    // separador entre chunks para evitar colisão por concatenação
    h ^= 0x1f;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ── ComputeProvider: worker (default) ───────────────────────────────────────────
// Adapter fino do `postMessage` atual (payloads intocados). Correlaciona cada
// `runJob(task, params)` com a `*_RESULT` correspondente por FIFO (cada tipo de
// tarefa é singular por gesto — não há ambiguidade prática). Coexiste com qualquer
// outro `onmessage`/listener do worker (usa `addEventListener`, aditivo): resolve só
// as promessas que ele mesmo criou; mensagens sem promessa pendente são ignoradas.
export function createWorkerProvider(worker) {
  const pending = new Map(); // resultType -> [{resolve, reject}]

  const onMessage = (e) => {
    const data = e && e.data;
    if (!data || !data.type) return;
    const q = pending.get(data.type);
    if (q && q.length) q.shift().resolve(data);
  };
  if (worker && typeof worker.addEventListener === 'function') {
    worker.addEventListener('message', onMessage);
  } else if (worker) {
    worker.onmessage = onMessage;
  }

  return {
    id: 'worker',
    // O worker é o caminho local: sempre "disponível", protocolo local.
    async health() { return { ok: true, protocolVersion: PROTOCOL_VERSION, local: true }; },
    async capabilities() {
      return { tier: 'worker', packages: {}, cores: 1, protocolVersion: PROTOCOL_VERSION };
    },
    // A base já vive no worker (via UPDATE_CSV_STORE) — registro é no-op.
    async registerDataset() { return { datasetId: 'worker-local', reused: true }; },
    runJob(task, params = {}) {
      const rt = resultTypeFor(task);
      return new Promise((resolve, reject) => {
        let arr = pending.get(rt);
        if (!arr) { arr = []; pending.set(rt, arr); }
        const entry = { resolve, reject };
        arr.push(entry);
        try {
          worker.postMessage({ type: task, ...params });
        } catch (err) {
          const i = arr.indexOf(entry);
          if (i >= 0) arr.splice(i, 1);
          reject(err);
        }
      });
    },
    // Jobs do worker não são canceláveis individualmente hoje — no-op explícito.
    cancelJob() {},
    dispose() {
      if (worker && typeof worker.removeEventListener === 'function') {
        worker.removeEventListener('message', onMessage);
      }
    },
  };
}

// ── ComputeProvider: sidecar Python (opcional) ──────────────────────────────────
// fetch em http://127.0.0.1 (mesma origem no release, URL configurada no dev), header
// X-Compute-Token em tudo exceto /health. Registro de dataset por hash com HEAD antes
// de POST (DEC-HX-006). Jobs assíncronos: POST /jobs → polling /jobs/{id} com
// progresso + cancelamento (§8). `fetchImpl`/`sleep` são injetáveis para teste.
export function createSidecarProvider(config = {}) {
  const {
    url = DEFAULT_SIDECAR_URL,
    token = '',
    fetchImpl,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = config;

  const _fetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
  // URL vazia ⇒ mesma origem (release): prefixo relativo `/api/compute/...`.
  const base = String(url || '').replace(/\/+$/, '');
  const api = (p) => base + '/api/compute' + p;
  let _token = token;

  function headers(extra) {
    const h = { ...(extra || {}) };
    if (_token) h['X-Compute-Token'] = _token;
    return h;
  }

  async function fetchTimeout(u, options = {}, timeoutMs) {
    if (!_fetch) throw new Error('fetch unavailable');
    const ctrl = new AbortController();
    // Encadeia um signal externo (cancelamento do modal) com o timeout interno.
    const outer = options.signal;
    if (outer) {
      if (outer.aborted) ctrl.abort();
      else outer.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    const t = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      return await _fetch(u, { ...options, signal: ctrl.signal });
    } finally {
      if (t) clearTimeout(t);
    }
  }

  return {
    id: 'sidecar',
    setToken(t) { _token = t || ''; },
    getToken() { return _token; },

    async health() {
      const res = await fetchTimeout(api('/health'), { method: 'GET' }, healthTimeoutMs);
      if (!res.ok) throw new Error('health ' + res.status);
      return await res.json(); // {ok, version, protocolVersion}
    },

    async token_() {
      const res = await fetchTimeout(api('/token'), { method: 'GET' }, healthTimeoutMs);
      if (!res.ok) throw new Error('token ' + res.status);
      const b = await res.json();
      if (b && b.token) _token = b.token;
      return b;
    },

    async capabilities() {
      const res = await fetchTimeout(
        api('/capabilities'), { method: 'GET', headers: headers() }, healthTimeoutMs);
      if (!res.ok) throw new Error('capabilities ' + res.status);
      return await res.json(); // {tier, packages, cores, protocolVersion}
    },

    // HEAD /datasets/{hash} → 200 pula re-upload; 404 ⇒ POST /datasets?hash= com os
    // chunks M3 como corpo (idempotente por hash).
    async registerDataset(dataset = {}) {
      const hash = dataset.hash;
      if (!hash) throw new Error('dataset hash required');
      const head = await fetchTimeout(
        api('/datasets/' + encodeURIComponent(hash)), { method: 'HEAD', headers: headers() });
      if (head && head.ok) return { datasetId: hash, reused: true };
      const chunks = typeof dataset.buildChunks === 'function'
        ? dataset.buildChunks()
        : (dataset.chunks || []);
      const body = Array.isArray(chunks) ? chunks.join('') : chunks;
      const res = await fetchTimeout(api('/datasets?hash=' + encodeURIComponent(hash)), {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body,
      });
      if (!res.ok) throw new Error('register dataset ' + res.status);
      const b = await res.json().catch(() => ({}));
      return { datasetId: (b && b.datasetId) || hash, reused: false };
    },

    async runJob(task, params = {}, opts = {}) {
      const { onProgress, signal, datasetId } = opts;
      const created = await fetchTimeout(api('/jobs'), {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ task, datasetId, params, protocolVersion: PROTOCOL_VERSION }),
        signal,
      });
      if (!created.ok) throw new Error('create job ' + created.status);
      const { jobId } = await created.json();
      if (!jobId) throw new Error('no jobId');

      for (;;) {
        if (signal && signal.aborted) {
          this.cancelJob(jobId);
          throw new DOMException('aborted', 'AbortError');
        }
        // Erro de rede/queda no meio ⇒ este await REJEITA ⇒ o router faz fallback.
        const pr = await fetchTimeout(
          api('/jobs/' + encodeURIComponent(jobId)), { method: 'GET', headers: headers(), signal });
        if (!pr.ok) throw new Error('poll ' + pr.status);
        const st = await pr.json();
        if (st && typeof st.progress === 'number' && typeof onProgress === 'function') {
          try { onProgress(st.progress); } catch { /* observador não pode derrubar o job */ }
        }
        if (!st || st.status === 'error') throw new Error((st && st.error) || 'job error');
        if (st.status === 'done') return st.result; // payload IDÊNTICO ao `*_RESULT` do worker
        await sleep(pollIntervalMs);
      }
    },

    cancelJob(jobId) {
      if (!jobId) return Promise.resolve();
      return fetchTimeout(
        api('/jobs/' + encodeURIComponent(jobId)), { method: 'DELETE', headers: headers() })
        .then(() => {}, () => {}); // cancelamento é best-effort
    },
  };
}

// ── ComputeRouter ───────────────────────────────────────────────────────────────
// Decide o executor por tarefa. Classe A (e todo default) SEMPRE no worker; Classe B
// tenta o sidecar (quando ligado + detectado + protocolo compatível) e cai de volta ao
// worker de forma transparente em qualquer erro/timeout/queda. Ausência de sidecar é
// estado NORMAL e SILENCIOSO — `detect` nunca lança.
export function createComputeRouter(config = {}) {
  const {
    worker,                                  // ComputeProvider worker (obrigatório)
    sidecar = null,                          // ComputeProvider sidecar (opcional)
    getPreference = () => ({ enabled: false, url: '' }),
    dataset = null,                          // {hash, buildChunks} — insumo padrão do registro B
    protocolVersion = PROTOCOL_VERSION,
  } = config;

  let status = { available: false, tier: null, capabilities: null, reason: 'not_detected' };

  function enabled() {
    const pref = getPreference() || {};
    return !!pref.enabled && !!sidecar;
  }

  // Pareamento no boot (§9): health (timeout 1s) → checa protocolVersion → token +
  // capabilities. Falha em qualquer passo ⇒ modo browser silencioso. Só tenta quando a
  // preferência está ligada (default off ⇒ nem tenta).
  async function detect() {
    if (!enabled()) {
      status = { available: false, tier: null, capabilities: null, reason: sidecar ? 'disabled' : 'no_sidecar' };
      return status;
    }
    try {
      const h = await sidecar.health();
      if (!h || h.protocolVersion !== protocolVersion) {
        status = { available: false, tier: null, capabilities: null, reason: 'protocol_mismatch' };
        return status;
      }
      // Token: mesma origem no release; no dev a UI pode ter colado um token (config).
      if (typeof sidecar.token_ === 'function') {
        try { await sidecar.token_(); } catch { /* token opcional; capabilities dirá se falta */ }
      }
      let caps = null;
      try { caps = await sidecar.capabilities(); } catch { /* sem caps ainda ⇒ tier desconhecido */ }
      status = { available: true, tier: (caps && caps.tier) || 'stdlib', capabilities: caps, reason: 'ok' };
    } catch {
      // ausência/timeout/erro de rede ⇒ silêncio (o estado normal é "sem sidecar")
      status = { available: false, tier: null, capabilities: null, reason: 'unreachable' };
    }
    return status;
  }

  function getStatus() { return status; }

  function canRouteToSidecar(task) {
    if (classOf(task) !== 'B') return false; // Classe A jamais roteia (tick incluído)
    if (!enabled()) return false;
    return !!status.available;
  }

  // Executa a tarefa. Retorna `{ via:'worker'|'sidecar', result, fellBack?, error? }`.
  // `result` é SEMPRE o payload no formato `*_RESULT` do worker — a UI não sabe quem
  // computou (DEC-HX-002).
  async function run(task, params = {}, opts = {}) {
    if (!canRouteToSidecar(task)) {
      const result = await worker.runJob(task, params, opts);
      return { via: 'worker', result };
    }
    try {
      let datasetId;
      const ds = opts.dataset || dataset;
      if (ds) {
        const reg = await sidecar.registerDataset(ds);
        datasetId = reg.datasetId;
      }
      const result = await sidecar.runJob(task, params, { ...opts, datasetId });
      return { via: 'sidecar', result };
    } catch (error) {
      // Fallback TRANSPARENTE ao worker (tetos declarados) — nenhuma tarefa exige o
      // sidecar (P4). O erro é anexado só para telemetria/badge, não propagado.
      const result = await worker.runJob(task, params, opts);
      return { via: 'worker', result, fellBack: true, error };
    }
  }

  return {
    detect,
    getStatus,
    run,
    classOf,
    canRouteToSidecar,
    get status() { return status; },
  };
}
