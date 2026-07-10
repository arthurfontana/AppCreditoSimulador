import { describe, it, expect, vi } from 'vitest';
import {
  PROTOCOL_VERSION,
  TASK_CLASS,
  classOf,
  resultTypeFor,
  hashChunks,
  createWorkerProvider,
  createSidecarProvider,
  createComputeRouter,
} from '../src/computeRouter.js';

// ── GATE Execução Híbrida Sessão H4 (ComputeRouter + ComputeProvider) ────────────────
// docs/wiki/Arquitetura-Execucao-Hibrida.md (DEC-HX-002/004/006/007, §8–§10).
// SEM Python nesta sessão: o sidecar é exercido por um fetch MOCKADO (servidor fake em
// memória) que sabe simular indisponível / lento / versão errada / queda no meio do job.
// Provado:
//   1. Classe A JAMAIS roteia pro sidecar (regra de ouro — tick incluído), mesmo com o
//      sidecar ligado e disponível;
//   2. detecção no boot: indisponível, lento (timeout 1s) e protocolVersion errada ⇒
//      status indisponível e SILENCIOSO (detect nunca lança);
//   3. Classe B roteia pro sidecar quando disponível, com payload de resultado IDÊNTICO
//      ao `*_RESULT` do worker; dataset registrado por hash (HEAD antes de POST);
//   4. queda no meio do job ⇒ fallback TRANSPARENTE ao worker (result do worker, via:'worker');
//   5. WorkerProvider: payload postado intocado + correlação com a `*_RESULT` certa;
//      preferência desligada (default off) ⇒ tudo no worker.

// ── Servidor sidecar FAKE (fetch stub) ──────────────────────────────────────────────
// Roteia por método+path; cada opção configura falhas específicas. Retorna objetos com
// a mesma forma da Response usada pelo provider (`ok`, `status`, `json()`).
function makeFakeSidecar(opts = {}) {
  const {
    protocolVersion = PROTOCOL_VERSION,
    tier = 'full',
    datasetExists = false,       // HEAD → 200 (pula upload) quando true
    healthNeverResolves = false, // simula sidecar LENTO (força timeout)
    healthDown = false,          // simula sidecar INDISPONÍVEL (rede recusa)
    dropOnPoll = 0,              // nº do poll em que a rede "cai" (rejeita); 0 = nunca
    doneAfter = 2,               // nº de polls até status 'done'
  } = opts;

  const calls = [];              // registro de todas as chamadas (método path)
  let pollCount = 0;
  const jobs = new Map();

  const jsonRes = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  });

  const fetchImpl = (u, options = {}) => {
    const url = new URL(u, 'http://127.0.0.1:8080');
    const method = (options.method || 'GET').toUpperCase();
    const path = url.pathname;
    calls.push(method + ' ' + path);

    // rede recusa a conexão ⇒ fetch REJEITA (indisponível)
    if (healthDown) return Promise.reject(new TypeError('Failed to fetch'));

    // sidecar lento: /health nunca resolve; respeita o AbortController (timeout)
    if (healthNeverResolves && path.endsWith('/health')) {
      return new Promise((_resolve, reject) => {
        const sig = options.signal;
        if (sig) sig.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
    }

    if (path.endsWith('/api/compute/health')) {
      return Promise.resolve(jsonRes(200, { ok: true, version: '1.0.0', protocolVersion }));
    }
    if (path.endsWith('/api/compute/token')) {
      return Promise.resolve(jsonRes(200, { token: 'tok-123' }));
    }
    if (path.endsWith('/api/compute/capabilities')) {
      return Promise.resolve(jsonRes(200, { tier, packages: { numpy: '2.5.1' }, cores: 8, protocolVersion }));
    }
    // HEAD /datasets/{hash}
    if (method === 'HEAD' && path.includes('/api/compute/datasets/')) {
      return Promise.resolve({ ok: datasetExists, status: datasetExists ? 200 : 404, async json() { return {}; } });
    }
    // POST /datasets?hash=
    if (method === 'POST' && path.endsWith('/api/compute/datasets')) {
      const hash = url.searchParams.get('hash');
      return Promise.resolve(jsonRes(200, { datasetId: hash }));
    }
    // POST /jobs
    if (method === 'POST' && path.endsWith('/api/compute/jobs')) {
      const jobId = 'job-1';
      jobs.set(jobId, JSON.parse(options.body));
      return Promise.resolve(jsonRes(201, { jobId }));
    }
    // DELETE /jobs/{id}
    if (method === 'DELETE' && path.includes('/api/compute/jobs/')) {
      return Promise.resolve(jsonRes(200, { cancelled: true }));
    }
    // GET /jobs/{id}
    if (method === 'GET' && path.includes('/api/compute/jobs/')) {
      pollCount++;
      if (dropOnPoll && pollCount === dropOnPoll) {
        return Promise.reject(new TypeError('connection reset')); // queda no meio do job
      }
      if (pollCount >= doneAfter) {
        const req = jobs.get('job-1') || {};
        // Resultado no MESMO formato do `*_RESULT` do worker correspondente à task.
        return Promise.resolve(jsonRes(200, {
          status: 'done', progress: 1,
          result: { via: 'sidecar-server', echoTask: req.task, echoParams: req.params },
        }));
      }
      return Promise.resolve(jsonRes(200, { status: 'running', progress: pollCount / doneAfter }));
    }
    return Promise.resolve(jsonRes(404, {}));
  };

  return { fetchImpl, calls, sidecar: () => createSidecarProvider({ fetchImpl, pollIntervalMs: 1, healthTimeoutMs: 20 }) };
}

// Worker provider ESPIÃO: resolve na mesma hora e conta chamadas por task.
function makeSpyWorker() {
  const runs = [];
  return {
    runs,
    provider: {
      id: 'worker',
      async health() { return { ok: true, protocolVersion: PROTOCOL_VERSION, local: true }; },
      async capabilities() { return { tier: 'worker', cores: 1, protocolVersion: PROTOCOL_VERSION }; },
      async registerDataset() { return { datasetId: 'worker-local', reused: true }; },
      async runJob(task, params) { runs.push({ task, params }); return { via: 'worker-server', task, params }; },
      cancelJob() {},
    },
  };
}

describe('H4 — tabela de roteamento / metadados', () => {
  it('o tick de edição e o core são Classe A; echo_stats é Classe B', () => {
    expect(classOf('RUN_SIMULATION')).toBe('A');
    expect(classOf('COMPUTE_OVERLAY')).toBe('A');
    expect(classOf('COMPUTE_ASIS_PREVIEW')).toBe('A');
    expect(classOf('COMPUTE_SEGMENT_DISCOVERY')).toBe('A'); // depth ≤ 2 é Classe A
    expect(classOf('echo_stats')).toBe('B');
    // default defensivo: tarefa desconhecida NUNCA vaza pro sidecar
    expect(classOf('TAREFA_INEXISTENTE')).toBe('A');
  });

  it('resultTypeFor mapeia cada task ao seu *_RESULT', () => {
    expect(resultTypeFor('RUN_SIMULATION')).toBe('SIMULATION_RESULT');
    expect(resultTypeFor('COMPUTE_SEGMENT_COMBINED')).toBe('SEGMENT_COMBINED_RESULT');
    expect(resultTypeFor('echo_stats')).toBe('echo_stats_RESULT');
  });

  it('hashChunks é determinístico e sensível ao conteúdo e à fronteira dos chunks', () => {
    expect(hashChunks(['a', 'b'])).toBe(hashChunks(['a', 'b']));
    expect(hashChunks(['a', 'b'])).not.toBe(hashChunks(['ab']));  // fronteira importa
    expect(hashChunks(['a', 'b'])).not.toBe(hashChunks(['a', 'c']));
  });
});

describe('H4 — Classe A jamais roteia pro sidecar (regra de ouro)', () => {
  it('mesmo com sidecar ligado e disponível, RUN_SIMULATION vai ao worker', async () => {
    const fake = makeFakeSidecar();
    const spy = makeSpyWorker();
    const router = createComputeRouter({
      worker: spy.provider,
      sidecar: fake.sidecar(),
      getPreference: () => ({ enabled: true, url: 'http://127.0.0.1:8080' }),
      dataset: { hash: 'h1', buildChunks: () => ['x'] },
    });
    await router.detect();
    expect(router.getStatus().available).toBe(true); // sidecar de fato disponível

    const out = await router.run('RUN_SIMULATION', { shapes: [], conns: [] });
    expect(out.via).toBe('worker');
    expect(spy.runs).toHaveLength(1);
    // nenhuma chamada de job foi ao servidor sidecar
    expect(fake.calls.some((c) => c.includes('/jobs'))).toBe(false);
    expect(router.canRouteToSidecar('RUN_SIMULATION')).toBe(false);
  });
});

describe('H4 — detecção no boot (silenciosa)', () => {
  it('preferência desligada (default off) ⇒ nem tenta, status indisponível', async () => {
    const fake = makeFakeSidecar();
    const router = createComputeRouter({
      worker: makeSpyWorker().provider,
      sidecar: fake.sidecar(),
      getPreference: () => ({ enabled: false }),
    });
    const st = await router.detect();
    expect(st.available).toBe(false);
    expect(st.reason).toBe('disabled');
    expect(fake.calls).toHaveLength(0); // nem chegou a bater no /health
  });

  it('sidecar indisponível ⇒ status unreachable, detect não lança', async () => {
    const fake = makeFakeSidecar({ healthDown: true });
    const router = createComputeRouter({
      worker: makeSpyWorker().provider,
      sidecar: fake.sidecar(),
      getPreference: () => ({ enabled: true }),
    });
    const st = await router.detect();
    expect(st.available).toBe(false);
    expect(st.reason).toBe('unreachable');
  });

  it('sidecar LENTO (health estoura o timeout de 1s) ⇒ unreachable', async () => {
    const fake = makeFakeSidecar({ healthNeverResolves: true });
    const router = createComputeRouter({
      worker: makeSpyWorker().provider,
      sidecar: fake.sidecar(), // healthTimeoutMs: 20 no stub
      getPreference: () => ({ enabled: true }),
    });
    const st = await router.detect();
    expect(st.available).toBe(false);
    expect(st.reason).toBe('unreachable');
  });

  it('protocolVersion errada ⇒ protocol_mismatch (nunca "tenta mesmo assim")', async () => {
    const fake = makeFakeSidecar({ protocolVersion: 999 });
    const router = createComputeRouter({
      worker: makeSpyWorker().provider,
      sidecar: fake.sidecar(),
      getPreference: () => ({ enabled: true }),
    });
    const st = await router.detect();
    expect(st.available).toBe(false);
    expect(st.reason).toBe('protocol_mismatch');
    expect(router.canRouteToSidecar('echo_stats')).toBe(false);
  });
});

describe('H4 — Classe B: sidecar com registro de dataset e fallback', () => {
  it('roteia pro sidecar quando disponível; registra dataset (HEAD 404 → POST); result idêntico ao contrato', async () => {
    const fake = makeFakeSidecar({ datasetExists: false });
    const spy = makeSpyWorker();
    const onProgress = vi.fn();
    const router = createComputeRouter({
      worker: spy.provider,
      sidecar: fake.sidecar(),
      getPreference: () => ({ enabled: true }),
      dataset: { hash: 'abc123', buildChunks: () => ['chunk-a', 'chunk-b'] },
    });
    await router.detect();
    const out = await router.run('echo_stats', { col: 'qty' }, { onProgress });

    expect(out.via).toBe('sidecar');
    expect(out.result).toEqual({ via: 'sidecar-server', echoTask: 'echo_stats', echoParams: { col: 'qty' } });
    expect(spy.runs).toHaveLength(0);                       // worker NÃO foi acionado
    expect(fake.calls).toContain('HEAD /api/compute/datasets/abc123'); // HEAD antes de POST
    expect(fake.calls).toContain('POST /api/compute/datasets');        // upload (404 ⇒ envia)
    expect(onProgress).toHaveBeenCalled();                 // progresso reportado no polling
  });

  it('dataset já existente (HEAD 200) ⇒ pula o POST de upload', async () => {
    const fake = makeFakeSidecar({ datasetExists: true });
    const router = createComputeRouter({
      worker: makeSpyWorker().provider,
      sidecar: fake.sidecar(),
      getPreference: () => ({ enabled: true }),
      dataset: { hash: 'reuse-me', buildChunks: () => ['x'] },
    });
    await router.detect();
    await router.run('echo_stats', {});
    expect(fake.calls).toContain('HEAD /api/compute/datasets/reuse-me');
    expect(fake.calls.some((c) => c === 'POST /api/compute/datasets')).toBe(false);
  });

  it('queda no meio do job (poll rejeita) ⇒ fallback TRANSPARENTE ao worker', async () => {
    const fake = makeFakeSidecar({ dropOnPoll: 1 }); // 1º poll cai
    const spy = makeSpyWorker();
    const router = createComputeRouter({
      worker: spy.provider,
      sidecar: fake.sidecar(),
      getPreference: () => ({ enabled: true }),
      dataset: { hash: 'h', buildChunks: () => ['x'] },
    });
    await router.detect();
    const out = await router.run('echo_stats', { p: 1 });

    expect(out.via).toBe('worker');
    expect(out.fellBack).toBe(true);
    expect(out.error).toBeTruthy();
    expect(out.result).toEqual({ via: 'worker-server', task: 'echo_stats', params: { p: 1 } });
    expect(spy.runs).toHaveLength(1); // o worker de fato executou a tarefa
  });

  it('Classe B com preferência desligada ⇒ vai ao worker sem tocar no sidecar', async () => {
    const fake = makeFakeSidecar();
    const spy = makeSpyWorker();
    const router = createComputeRouter({
      worker: spy.provider,
      sidecar: fake.sidecar(),
      getPreference: () => ({ enabled: false }),
    });
    await router.detect();
    const out = await router.run('echo_stats', {});
    expect(out.via).toBe('worker');
    expect(fake.calls).toHaveLength(0);
    expect(spy.runs).toHaveLength(1);
  });
});

describe('H4 — WorkerProvider (adapter do postMessage, payloads intocados)', () => {
  it('posta {type: task, ...params} intocado e resolve com a *_RESULT correspondente', async () => {
    const listeners = [];
    const posted = [];
    const fakeWorker = {
      addEventListener: (_ev, fn) => listeners.push(fn),
      removeEventListener: () => {},
      postMessage: (msg) => {
        posted.push(msg);
        // simula o worker respondendo assíncrono com a *_RESULT certa
        queueMicrotask(() => listeners.forEach((fn) => fn({ data: { type: resultTypeFor(msg.type), result: { ok: 1 } } })));
      },
    };
    const wp = createWorkerProvider(fakeWorker);
    const res = await wp.runJob('RUN_SIMULATION', { shapes: [1], conns: [2] });

    expect(posted[0]).toEqual({ type: 'RUN_SIMULATION', shapes: [1], conns: [2] }); // payload intocado
    expect(res).toEqual({ type: 'SIMULATION_RESULT', result: { ok: 1 } });
  });

  it('mensagens sem promessa pendente são ignoradas (coexiste com outros listeners)', async () => {
    const listeners = [];
    const fakeWorker = {
      addEventListener: (_ev, fn) => listeners.push(fn),
      removeEventListener: () => {},
      postMessage: () => {},
    };
    const wp = createWorkerProvider(fakeWorker);
    // dispara uma mensagem qualquer sem runJob pendente — não deve lançar
    expect(() => listeners.forEach((fn) => fn({ data: { type: 'OVERLAY_RESULT' } }))).not.toThrow();
    expect(wp.id).toBe('worker');
  });
});
