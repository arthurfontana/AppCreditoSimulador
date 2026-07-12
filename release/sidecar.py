#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sidecar.py — Motor Python (sidecar de Execução Híbrida), v1.

Endpoints HTTP sob `/api/compute/*` que o `ComputeRouter` do front (H4,
`src/computeRouter.js`) consome como um `ComputeProvider` opcional. Só stdlib —
`http.server`/`ThreadingHTTPServer`, sem Flask/FastAPI — no mesmo espírito do
`serve.py`, que o importa e monta estes endpoints na MESMA porta/origem do app no
modo release (DEC-HX-003).

Referência normativa: docs/wiki/Arquitetura-Execucao-Hibrida.md
  · DEC-HX-003 — o sidecar é o `serve.py` estendido (mesmo processo/porta/origem no
    release; no dev roda à parte com allowlist de CORS para o origin do Vite).
  · DEC-HX-004 — capacidades declaradas, nunca presumidas. Detecção de tier por
    WARM-UP ASSÍNCRONO no boot (thread de fundo importa numpy/scipy/sklearn/duckdb):
    a sonda HP (09/07/2026) mediu 38s na 1ª importação do sklearn sob antivírus, então
    NUNCA importamos pacote inline no request de `capabilities`. A resposta é imediata
    com status POR PACOTE (`{numpy:'2.5.1', sklearn:'loading'|null, ...}`). Tier `full`
    = numpy(+scipy) presentes; sklearn/duckdb são extras, NUNCA gate do tier.
  · DEC-HX-006 — dados sobem UMA vez, referenciados por hash (POST idempotente; HEAD
    para checar existência). Formato = os chunks base64 do `serializeCsvStore`/M3
    (`src/columnar.js`); decodificados aqui com `base64` + `numpy.frombuffer` (tier
    full) ou o módulo `array` (stdlib). Dados SÓ em RAM, nunca em disco.
  · DEC-HX-008 — bind EXCLUSIVO em 127.0.0.1; token aleatório por boot no header
    `X-Compute-Token` (tudo exceto /health e /token); `/token` só responde à própria
    origem; NENHUM header CORS exceto a allowlist do origin do Vite sob `--dev`; zero
    rede externa.

Task inicial `echo_stats` (rowCount + soma de uma coluna métrica) — prova o
round-trip ponta a ponta contra o worker e serve de benchmark.

Uso:
  · Release (mesma origem): importado por `serve.py` (nada a fazer — o `iniciar.bat`
    sobe tudo junto).
  · Dev (à parte, com CORS p/ o Vite):  python sidecar.py --dev
      opções: --port N (default 8090), --vite-origin http://localhost:5173
"""
import argparse
import array
import base64
import json
import os
import queue
import secrets
import struct
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import multiprocessing as mp
except Exception:  # pragma: no cover - multiprocessing é stdlib, mas defensivo
    mp = None

# Versão do protocolo Browser ⇄ Python (§8 do documento). Precisa bater com o
# PROTOCOL_VERSION do src/computeRouter.js — mismatch ⇒ o router trata o sidecar como
# indisponível (nunca "tenta mesmo assim").
PROTOCOL_VERSION = 1
SIDECAR_VERSION = "1.0.0"
API_PREFIX = "/api/compute"

# Pacotes sondados no warm-up (nome pip, nome do módulo de import). Mesma lista da
# sonda HP (`checar_ambiente.py`).
WARMUP_PACKAGES = [
    ("numpy", "numpy"),
    ("scipy", "scipy"),
    ("scikit-learn", "sklearn"),
    ("duckdb", "duckdb"),
]

# Tasks que o sidecar sabe executar (informativo em /capabilities; o roteamento por
# classe vive no front — DEC-HX-007). `segment_discovery` (Execução Híbrida H7 —
# Descoberta profunda, motor numpy em release/python/motor_segmentos.py) é declarada
# SÓ no tier full: no tier stdlib ela não aparece em capabilities e um POST /jobs com
# ela é recusado — o front então nem oferece depth 3–4 (teto declarado, DEC-HX-007) e
# qualquer tentativa cai no fallback browser. GATE cross-runtime (DEC-HX-005):
# tests_python/test_segment_discovery.py sobre as fixtures douradas do Vitest — sem o
# GATE verde a task não é embarcada/ofertada.
# `cluster_segments` (Execução Híbrida H8 — Clusterização de Segmentos, motor numpy em
# release/python/motor_clusters.py) segue o mesmo contrato da H7: tier full apenas,
# GATE dourado cross-runtime (tests_python/test_cluster_segments.py sobre as fixtures
# geradas por tests/clusterSegmentsGolden.test.js) — sem GATE verde a task não é
# embarcada/ofertada. sklearn é EXTRA da task (silhueta p/ k automático, hierárquico),
# nunca gate do tier (DEC-HX-004).
# `goal_seek_deep` (Goal Seek Profundo, Sessão GS5 — solver MILP em
# release/python/motor_goalseek.py) tem um gate EXTRA além do tier full: exige
# `scipy.optimize.milp` importável (scipy < 1.9 não tem `milp` — DEC-GS-010). Por isso
# NÃO entra em FULL_TIER_TASKS (gate = numpy+scipy só); é ofertada por available_tasks()
# apenas quando o warm-up confirma o `milp`. GATE dourado só-Python (sem gêmeo JS —
# DEC-GS-001): tests_python/test_goal_seek.py com fixtures de catálogo commitadas.
KNOWN_TASKS = ("echo_stats",)
FULL_TIER_TASKS = ("segment_discovery", "cluster_segments")
GOAL_SEEK_TASK = "goal_seek_deep"

# ─────────────────────────────────────────────────────────────────────────────
# Estado global (protegido por locks; RAM apenas)
# ─────────────────────────────────────────────────────────────────────────────

_TOKEN = secrets.token_urlsafe(32)

_pkg_lock = threading.Lock()
# módulo -> 'loading' | versão(str) | None(ausente/falhou)
_pkg_status = {mod: "loading" for (_pip, mod) in WARMUP_PACKAGES}
# Gate EXTRA do goal_seek_deep (DEC-GS-010): `scipy.optimize.milp` importável.
# 'loading' até o warm-up terminar; True/False depois. `scipy.optimize` NÃO é importado
# por `import scipy` (é submódulo), então isto é sondado no warm-up (nunca inline num
# request — mesma regra da detecção de tier, DEC-HX-004).
_scipy_milp = "loading"
_warmup_started = False

_config_lock = threading.Lock()
_config = {"dev": False, "allowed_origins": set()}

_datasets_lock = threading.Lock()
_datasets = {}  # hash -> store dict (JSON parseado do serializeCsvStore; RAM apenas)

_jobs_lock = threading.Lock()
_jobs = {}  # jobId -> _Job


def current_token():
    return _TOKEN


def configure(dev=False, allowed_origins=None):
    """Configura o modo (release/dev) e a allowlist de CORS. Chamado pelo serve.py
    (dev=False) e pelo main() standalone (dev=True + origin do Vite)."""
    with _config_lock:
        _config["dev"] = bool(dev)
        _config["allowed_origins"] = set(allowed_origins or [])


def _get_config():
    with _config_lock:
        return _config["dev"], set(_config["allowed_origins"])


# ─────────────────────────────────────────────────────────────────────────────
# Warm-up assíncrono da detecção de tier (DEC-HX-004)
# ─────────────────────────────────────────────────────────────────────────────

def _warmup():
    # Importa um pacote de cada vez; a 1ª carga do sklearn pode levar dezenas de
    # segundos sob antivírus — por isso isto NUNCA roda inline num request.
    for _pip, mod in WARMUP_PACKAGES:
        version, ok = None, False
        try:
            imported = __import__(mod)
            version = getattr(imported, "__version__", "unknown")
            ok = True
        except Exception:
            ok = False
        with _pkg_lock:
            _pkg_status[mod] = version if ok else None
    # Gate extra do goal_seek_deep: sonda `scipy.optimize.milp` (submódulo — não vem
    # de `import scipy`). Feito ao fim do warm-up para não pesar o boot.
    global _scipy_milp
    milp_ok = False
    try:
        from scipy.optimize import milp  # noqa: F401
        milp_ok = True
    except Exception:
        milp_ok = False
    with _pkg_lock:
        _scipy_milp = milp_ok


def start_warmup():
    """Dispara a sonda de pacotes numa thread de fundo (idempotente)."""
    global _warmup_started
    with _pkg_lock:
        if _warmup_started:
            return
        _warmup_started = True
    t = threading.Thread(target=_warmup, name="sidecar-warmup", daemon=True)
    t.start()


def _package_snapshot():
    with _pkg_lock:
        return dict(_pkg_status)


def _present(pkgs, name):
    v = pkgs.get(name)
    return bool(v) and v != "loading"


def _has_milp():
    with _pkg_lock:
        return _scipy_milp is True


def available_tasks():
    """Tasks ofertadas AGORA: as de base sempre; as de tier full só com numpy+scipy
    presentes (warm-up concluído) — capacidades declaradas, nunca presumidas.
    `goal_seek_deep` exige, ALÉM do tier full, `scipy.optimize.milp` importável
    (DEC-GS-010) — gate à parte de FULL_TIER_TASKS."""
    pkgs = _package_snapshot()
    tier_full = _present(pkgs, "numpy") and _present(pkgs, "scipy")
    tasks = list(KNOWN_TASKS)
    if tier_full:
        tasks.extend(FULL_TIER_TASKS)
        if _has_milp():
            tasks.append(GOAL_SEEK_TASK)
    return tasks


def get_capabilities():
    """Payload de /capabilities. Tier `full` = numpy(+scipy) presentes; sklearn e
    duckdb são extras declarados por pacote, nunca gate do tier."""
    pkgs = _package_snapshot()
    tier = "full" if (_present(pkgs, "numpy") and _present(pkgs, "scipy")) else "stdlib"
    return {
        "tier": tier,
        "packages": pkgs,
        "cores": os.cpu_count() or 1,
        "tasks": available_tasks(),
        "protocolVersion": PROTOCOL_VERSION,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Decodificação do formato M3 (base64 de typed arrays) + tasks
# ─────────────────────────────────────────────────────────────────────────────

def _decode_num_column(col):
    """Coluna métrica `{kind:'num', encoding:'base64', data}` → sequência de floats.
    numpy.frombuffer no tier full, senão o módulo `array` (stdlib). Os bytes são
    little-endian (typed arrays do browser); tratamos os dois caminhos como LE."""
    if col.get("encoding") == "base64":
        raw = base64.b64decode(col["data"])
        try:
            import numpy as _np  # lazy: só quando há de fato uma coluna a decodificar
            return _np.frombuffer(raw, dtype="<f8")
        except Exception:
            n = len(raw) // 8
            return array.array("d", struct.unpack("<%dd" % n, raw[: n * 8]))
    # Formato legado (schema ≤ 2.2): array plano de números boxed.
    return array.array("d", [float(x) for x in (col.get("data") or [])])


def _sum_num(seq):
    try:
        return float(seq.sum())  # numpy
    except AttributeError:
        return float(math_fsum(seq))


def math_fsum(seq):
    # fsum reduz erro de acúmulo; import local para não pesar o boot.
    import math
    return math.fsum(seq)


_seg_engine = None
_cluster_engine = None
_goalseek_engine = None


def _load_engine_module(filename):
    """Import LAZY de um motor de release/python/ (padrão DEC-HX-004: nada de import
    pesado inline no boot; a pasta é preservada pelo build-release.yml)."""
    import importlib.util
    name = filename[:-3]  # sem o .py
    if name in sys.modules:
        return sys.modules[name]
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "python", filename)
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_segment_engine():
    """Motor da Descoberta (H7) — só no primeiro job que o usa."""
    global _seg_engine
    if _seg_engine is None:
        _seg_engine = _load_engine_module("motor_segmentos.py")
    return _seg_engine


def _load_cluster_engine():
    """Motor da Clusterização (H8) — só no primeiro job que o usa."""
    global _cluster_engine
    if _cluster_engine is None:
        _cluster_engine = _load_engine_module("motor_clusters.py")
    return _cluster_engine


def _load_goalseek_engine():
    """Solver do Goal Seek Profundo (GS5) — só no primeiro job que o usa."""
    global _goalseek_engine
    if _goalseek_engine is None:
        _goalseek_engine = _load_engine_module("motor_goalseek.py")
    return _goalseek_engine


def run_task(task, store, params, progress_cb=None):
    """Executa uma task de forma SÍNCRONA sobre um `store` já parseado (JSON do
    serializeCsvStore). Usada tanto pelo processo filho (jobs) quanto direto nos
    testes. `progress_cb(p)` (0..1) é opcional."""
    if progress_cb:
        progress_cb(0.05)
    if task == "echo_stats":
        result = _task_echo_stats(store, params or {}, progress_cb)
        if progress_cb:
            progress_cb(1.0)
        return result
    if task == "segment_discovery":
        # Execução Híbrida H7 — Descoberta profunda (tier full apenas; numpy). O
        # `result` tem o MESMO formato do payload SEGMENT_DISCOVERY_RESULT do worker
        # ({segmentModel}), SEM as recomendações (o front as anexa via
        # COMPUTE_SEGMENT_RECS no worker — runSimulation continua single-sourced lá).
        p = params or {}
        engine = _load_segment_engine()
        model = engine.compute_segment_model(
            store, p.get("shapes") or [], p.get("conns") or [],
            p.get("scope"), p.get("params") or {}, progress_cb,
        )
        if progress_cb:
            progress_cb(1.0)
        return {"segmentModel": model}
    if task == "cluster_segments":
        # Execução Híbrida H8 — Clusterização de Segmentos (tier full apenas; numpy;
        # sklearn como extra opcional). O `result` tem o MESMO formato do payload
        # CLUSTER_SEGMENTS_RESULT do worker ({clusterModel}) — executor invisível
        # (DEC-HX-002); aqui SEM os tetos declarados do baseline browser.
        p = params or {}
        engine = _load_cluster_engine()
        model = engine.compute_cluster_model(store, p.get("params") or {}, progress_cb)
        if progress_cb:
            progress_cb(1.0)
        return {"clusterModel": model}
    if task == "goal_seek_deep":
        # Goal Seek Profundo (GS5, DEC-GS-005/006) — solver MILP self-contained: o
        # catálogo agregado vem em `params` (o dataset NUNCA sobe; `store` é ignorado).
        # O `result` são só ids + previsões lineares; o worker JS materializa e
        # re-simula (DEC-GS-007) — nenhum número final tem origem aqui.
        engine = _load_goalseek_engine()
        result = engine.solve_goal_seek(params or {}, progress_cb)
        if progress_cb:
            progress_cb(1.0)
        return result
    raise ValueError("unknown task: %r" % (task,))


def _task_echo_stats(store, params, progress_cb):
    """rowCount + soma de uma coluna métrica. Prova o round-trip contra o worker."""
    if not store:
        raise ValueError("empty dataset")
    csv_id = params.get("csvId")
    if csv_id is None or csv_id not in store:
        csv_id = next(iter(store))
    csv = store[csv_id] or {}
    row_count = int(csv.get("rowCount") or 0)
    columns = csv.get("columns") or {}
    col = params.get("col")
    total = 0.0
    counted = False
    if col and col in columns and (columns[col] or {}).get("kind") == "num":
        total = _sum_num(_decode_num_column(columns[col]))
        counted = True
    if progress_cb:
        progress_cb(0.9)
    return {
        "task": "echo_stats",
        "csvId": csv_id,
        "col": col,
        "rowCount": row_count,
        "sum": total,
        "counted": counted,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Job runner (multiprocessing + progresso + cancelamento)
# ─────────────────────────────────────────────────────────────────────────────

class _Job:
    __slots__ = ("id", "task", "status", "progress", "result", "error",
                 "process", "pq", "rq", "monitor")

    def __init__(self, job_id, task):
        self.id = job_id
        self.task = task
        self.status = "running"   # running | done | error
        self.progress = 0.0
        self.result = None
        self.error = None
        self.process = None
        self.pq = None
        self.rq = None
        self.monitor = None

    def snapshot(self):
        out = {"status": self.status, "progress": self.progress}
        if self.status == "done":
            out["result"] = self.result
        elif self.status == "error":
            out["error"] = self.error or "job error"
        return out


def _job_entry(task, store, params, pq, rq):
    """Ponto de entrada no processo filho (top-level p/ ser picklável sob spawn)."""
    try:
        def _progress(p):
            try:
                pq.put(float(p))
            except Exception:
                pass
        result = run_task(task, store, params, _progress)
        rq.put(("done", result))
    except Exception as e:  # pragma: no cover - caminho de erro exercido nos testes
        rq.put(("error", "%s: %s" % (type(e).__name__, e)))


def _run_task_inline(job, store, params):
    """Fallback sem multiprocessing (ex.: ambiente que não permite Process)."""
    try:
        def _progress(p):
            job.progress = float(p)
        job.result = run_task(job.task, store, params, _progress)
        job.status = "done"
        job.progress = 1.0
    except Exception as e:
        job.status = "error"
        job.error = "%s: %s" % (type(e).__name__, e)


def _monitor_job(job):
    while True:
        # Drena o progresso disponível.
        try:
            while True:
                job.progress = float(job.pq.get_nowait())
        except queue.Empty:
            pass
        # Aguarda um resultado por um instante curto.
        try:
            kind, payload = job.rq.get(timeout=0.1)
            if kind == "done":
                job.result = payload
                job.progress = 1.0
                job.status = "done"
            else:
                job.error = payload
                job.status = "error"
            break
        except queue.Empty:
            if job.process is not None and not job.process.is_alive():
                # Processo morreu sem entregar resultado (crash/terminate).
                if job.status == "running":
                    job.status = "error"
                    job.error = "job process exited unexpectedly"
                break
    if job.process is not None:
        try:
            job.process.join(timeout=1)
        except Exception:
            pass


def submit_job(task, store, params):
    job_id = uuid.uuid4().hex
    job = _Job(job_id, task)
    with _jobs_lock:
        _jobs[job_id] = job

    can_fork = mp is not None
    if can_fork:
        try:
            job.pq = mp.Queue()
            job.rq = mp.Queue()
            job.process = mp.Process(
                target=_job_entry, args=(task, store, params, job.pq, job.rq),
                daemon=True,
            )
            job.process.start()
            job.monitor = threading.Thread(target=_monitor_job, args=(job,), daemon=True)
            job.monitor.start()
            return job_id
        except Exception:
            # Não conseguiu subir o processo — cai pro inline (mesma matemática).
            job.process = None
    _run_task_inline(job, store, params)
    return job_id


def get_job(job_id):
    with _jobs_lock:
        return _jobs.get(job_id)


def cancel_job(job_id):
    job = get_job(job_id)
    if not job:
        return False
    if job.process is not None and job.process.is_alive():
        try:
            job.process.terminate()
        except Exception:
            pass
    if job.status == "running":
        job.status = "error"
        job.error = "cancelled"
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Camada HTTP — dispatcher chamado tanto pelo serve.py quanto pelo handler dev
# ─────────────────────────────────────────────────────────────────────────────

def _origin_allowed(handler):
    """`/token` só responde à própria origem. Um GET same-origin não manda header
    `Origin`; uma página de terceiros mandaria (e cai fora da allowlist)."""
    origin = handler.headers.get("Origin")
    if not origin:
        return True  # same-origin (release) / navegação
    _dev, allowed = _get_config()
    return origin in allowed


def _cors_headers_for(handler):
    """Devolve os headers CORS a acrescentar (só no dev, e só p/ origin na allowlist).
    No release NENHUM header CORS é emitido (mesma origem não precisa)."""
    origin = handler.headers.get("Origin")
    if not origin:
        return {}
    _dev, allowed = _get_config()
    if origin in allowed:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "X-Compute-Token, Content-Type",
            "Access-Control-Allow-Methods": "GET, POST, HEAD, DELETE, OPTIONS",
            "Vary": "Origin",
        }
    return {}


def _send(handler, status, obj=None, is_head=False):
    body = b"" if obj is None else json.dumps(obj).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    for k, v in _cors_headers_for(handler).items():
        handler.send_header(k, v)
    handler.end_headers()
    if not is_head and body:
        handler.wfile.write(body)


def _read_body(handler):
    try:
        length = int(handler.headers.get("Content-Length") or 0)
    except (TypeError, ValueError):
        length = 0
    if length <= 0:
        return b""
    return handler.rfile.read(length)


def _authenticated(handler):
    return handler.headers.get("X-Compute-Token") == _TOKEN


def handle_api(handler, method):
    """Tenta responder um request `/api/compute/*`. Retorna True se tratou (resposta
    já enviada), False para o chamador seguir com o comportamento padrão (estáticos).

    `handler` é um BaseHTTPRequestHandler (do serve.py ou do handler dev); usamos
    apenas a interface pública dele (path, headers, rfile/wfile, send_*)."""
    path = handler.path.split("?", 1)[0]
    if not (path == API_PREFIX or path.startswith(API_PREFIX + "/")):
        return False

    method = method.upper()

    # Preflight CORS (só ocorre no dev, cross-origin com header custom X-Compute-Token).
    if method == "OPTIONS":
        cors = _cors_headers_for(handler)
        handler.send_response(204 if cors else 403)
        handler.send_header("Content-Length", "0")
        for k, v in cors.items():
            handler.send_header(k, v)
        handler.end_headers()
        return True

    sub = path[len(API_PREFIX):]  # ex.: '/health', '/jobs/abc'

    # /health — sem token, sem CORS gate (sinaliza só existência/versão).
    if sub == "/health" and method == "GET":
        _send(handler, 200, {"ok": True, "version": SIDECAR_VERSION,
                             "protocolVersion": PROTOCOL_VERSION})
        return True

    # /token — sem token (chicken-egg), mas SÓ para a própria origem (DEC-HX-008).
    if sub == "/token" and method == "GET":
        if not _origin_allowed(handler):
            _send(handler, 403, {"error": "forbidden origin"})
            return True
        _send(handler, 200, {"token": _TOKEN})
        return True

    # Tudo abaixo exige o token de pareamento.
    if not _authenticated(handler):
        _send(handler, 401, {"error": "missing or invalid X-Compute-Token"}, is_head=(method == "HEAD"))
        return True

    if sub == "/capabilities" and method == "GET":
        _send(handler, 200, get_capabilities())
        return True

    # ── datasets ──────────────────────────────────────────────────────────────
    if sub == "/datasets" and method == "POST":
        qs = handler.path.split("?", 1)
        hash_ = ""
        if len(qs) == 2:
            for kv in qs[1].split("&"):
                if kv.startswith("hash="):
                    from urllib.parse import unquote
                    hash_ = unquote(kv[len("hash="):])
                    break
        if not hash_:
            _send(handler, 400, {"error": "missing ?hash="})
            return True
        with _datasets_lock:
            exists = hash_ in _datasets
        if exists:
            # Idempotente: mesmo hash ⇒ não re-parseia o corpo.
            _drain_body(handler)
            _send(handler, 200, {"datasetId": hash_, "reused": True})
            return True
        body = _read_body(handler)
        try:
            store = json.loads(body.decode("utf-8")) if body else {}
        except Exception as e:
            _send(handler, 400, {"error": "invalid dataset body: %s" % e})
            return True
        with _datasets_lock:
            _datasets[hash_] = store
        _send(handler, 200, {"datasetId": hash_, "reused": False})
        return True

    if sub.startswith("/datasets/") and method == "HEAD":
        hash_ = sub[len("/datasets/"):]
        from urllib.parse import unquote
        hash_ = unquote(hash_)
        with _datasets_lock:
            exists = hash_ in _datasets
        # HEAD nunca tem corpo.
        handler.send_response(200 if exists else 404)
        handler.send_header("Content-Length", "0")
        for k, v in _cors_headers_for(handler).items():
            handler.send_header(k, v)
        handler.end_headers()
        return True

    # ── jobs ──────────────────────────────────────────────────────────────────
    if sub == "/jobs" and method == "POST":
        body = _read_body(handler)
        try:
            req = json.loads(body.decode("utf-8")) if body else {}
        except Exception as e:
            _send(handler, 400, {"error": "invalid job body: %s" % e})
            return True
        if req.get("protocolVersion") not in (None, PROTOCOL_VERSION):
            _send(handler, 409, {"error": "protocol mismatch"})
            return True
        task = req.get("task")
        if task not in available_tasks():
            # inclui task de tier full pedida no tier stdlib — o router faz fallback
            _send(handler, 400, {"error": "unknown or unavailable task: %r" % (task,)})
            return True
        dataset_id = req.get("datasetId")
        with _datasets_lock:
            store = _datasets.get(dataset_id, {})
        job_id = submit_job(task, store, req.get("params") or {})
        _send(handler, 201, {"jobId": job_id})
        return True

    if sub.startswith("/jobs/"):
        job_id = sub[len("/jobs/"):]
        if method == "GET":
            job = get_job(job_id)
            if not job:
                _send(handler, 404, {"status": "error", "error": "no such job"})
                return True
            _send(handler, 200, job.snapshot())
            return True
        if method == "DELETE":
            ok = cancel_job(job_id)
            _send(handler, 200 if ok else 404, {"cancelled": ok})
            return True

    _send(handler, 404, {"error": "no such endpoint"}, is_head=(method == "HEAD"))
    return True


def _drain_body(handler):
    """Consome (e descarta) o corpo do request — evita deixar bytes no socket em
    respostas keep-alive quando o corpo não é usado."""
    try:
        _read_body(handler)
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────────────────────
# Modo standalone (dev): sobe SÓ a API, com CORS p/ o origin do Vite (--dev)
# ─────────────────────────────────────────────────────────────────────────────

class _SidecarDevHandler(BaseHTTPRequestHandler):
    server_version = "AppCreditoSidecar/" + SIDECAR_VERSION

    def _api_or_404(self, method):
        if not handle_api(self, method):
            _send(self, 404, {"error": "not an API endpoint (dev sidecar serves only /api/compute/*)"},
                  is_head=(method == "HEAD"))

    def do_GET(self):
        self._api_or_404("GET")

    def do_HEAD(self):
        self._api_or_404("HEAD")

    def do_POST(self):
        self._api_or_404("POST")

    def do_DELETE(self):
        self._api_or_404("DELETE")

    def do_OPTIONS(self):
        self._api_or_404("OPTIONS")

    def log_message(self, fmt, *args):  # silencia o log ruidoso por request
        pass


def main(argv=None):
    parser = argparse.ArgumentParser(description="Motor Python (sidecar) — modo dev")
    parser.add_argument("--dev", action="store_true",
                        help="modo dev: sobe a API à parte com CORS p/ o Vite")
    parser.add_argument("--port", type=int, default=8090,
                        help="porta do sidecar no modo dev (default 8090)")
    parser.add_argument("--vite-origin", default="http://localhost:5173",
                        help="origin do Vite liberado no CORS (default http://localhost:5173)")
    args = parser.parse_args(argv)

    allowed = []
    if args.dev:
        # Libera o origin do Vite (e a variante 127.0.0.1) no CORS.
        allowed = [args.vite_origin]
        if "localhost" in args.vite_origin:
            allowed.append(args.vite_origin.replace("localhost", "127.0.0.1"))
    configure(dev=args.dev, allowed_origins=allowed)
    start_warmup()

    # Bind EXCLUSIVO em 127.0.0.1 (nunca 0.0.0.0) — DEC-HX-008.
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), _SidecarDevHandler)
    print("Motor Python (sidecar) v%s — DEV" % SIDECAR_VERSION)
    print("Escutando em http://127.0.0.1:%d%s" % (args.port, API_PREFIX))
    print("Token desta sessao (cole na UI no modo dev):")
    print("  %s" % _TOKEN)
    if allowed:
        print("CORS liberado para: %s" % ", ".join(allowed))
    print("Ctrl+C para encerrar.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando sidecar.")
        httpd.server_close()


if __name__ == "__main__":
    # No Windows, multiprocessing usa 'spawn' e re-importa este módulo no filho —
    # o guard __main__ garante que subir o servidor não recursa.
    if mp is not None:
        try:
            mp.freeze_support()
        except Exception:
            pass
    main()
