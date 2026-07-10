# -*- coding: utf-8 -*-
"""
GATE Execução Híbrida Sessão H5 — Sidecar Python v1.

docs/wiki/Arquitetura-Execucao-Hibrida.md (DEC-HX-003/004/006/008, §8–§9).

Cobre: health, token (gate de origem), capabilities durante E depois do warm-up
(tier `full` = numpy+scipy; sklearn nunca é gate), dataset round-trip por hash
(POST idempotente + HEAD), ciclo de job (echo_stats: rowCount + soma) e cancelamento.
Sem depender de numpy instalado — os testes de tier manipulam o estado do warm-up.
"""
import time

import conftest
import sidecar


# ── health ───────────────────────────────────────────────────────────────────

def test_health_sem_token(server):
    r = server.get("/api/compute/health", use_token=False)
    assert r.status == 200
    body = r.json()
    assert body["ok"] is True
    assert body["protocolVersion"] == sidecar.PROTOCOL_VERSION
    assert body["version"] == sidecar.SIDECAR_VERSION


# ── token (gate de origem — DEC-HX-008) ──────────────────────────────────────

def test_token_mesma_origem_ok(server):
    # Sem header Origin ⇒ tratado como mesma origem (GET same-origin no release).
    r = server.get("/api/compute/token", use_token=False)
    assert r.status == 200
    assert r.json()["token"] == sidecar.current_token()


def test_token_origem_liberada_dev(server):
    r = server.get("/api/compute/token", use_token=False,
                   headers={"Origin": conftest.VITE_ORIGIN})
    assert r.status == 200
    assert r.json()["token"] == sidecar.current_token()


def test_token_origem_estranha_403(server):
    r = server.get("/api/compute/token", use_token=False,
                   headers={"Origin": "http://evil.example"})
    assert r.status == 403


# ── autenticação por token ───────────────────────────────────────────────────

def test_capabilities_exige_token(server):
    r = server.get("/api/compute/capabilities", use_token=False)
    assert r.status == 401


def test_capabilities_com_token(server):
    r = server.get("/api/compute/capabilities")
    assert r.status == 200
    caps = r.json()
    assert caps["protocolVersion"] == sidecar.PROTOCOL_VERSION
    assert caps["tier"] in ("stdlib", "full")
    assert "numpy" in caps["packages"]
    assert caps["cores"] >= 1


# ── capabilities: tier via warm-up (unit, determinístico) ────────────────────

def _with_pkg_status(status):
    """Substitui o snapshot de pacotes e devolve o anterior (para restaurar)."""
    with sidecar._pkg_lock:
        saved = dict(sidecar._pkg_status)
        sidecar._pkg_status.clear()
        sidecar._pkg_status.update(status)
    return saved


def _restore_pkg_status(saved):
    with sidecar._pkg_lock:
        sidecar._pkg_status.clear()
        sidecar._pkg_status.update(saved)


def test_capabilities_durante_warmup_e_stdlib():
    saved = _with_pkg_status({"numpy": "loading", "scipy": "loading",
                              "sklearn": "loading", "duckdb": "loading"})
    try:
        caps = sidecar.get_capabilities()
        # Enquanto carrega, ainda não há tier full (nunca "presume" pacote).
        assert caps["tier"] == "stdlib"
        assert caps["packages"]["numpy"] == "loading"
        assert caps["protocolVersion"] == sidecar.PROTOCOL_VERSION
    finally:
        _restore_pkg_status(saved)


def test_capabilities_full_apos_warmup_sklearn_nao_e_gate():
    # numpy + scipy presentes ⇒ tier full. sklearn AUSENTE não rebaixa o tier.
    saved = _with_pkg_status({"numpy": "2.5.1", "scipy": "1.18.0",
                              "sklearn": None, "duckdb": "1.5.4"})
    try:
        caps = sidecar.get_capabilities()
        assert caps["tier"] == "full"
        assert caps["packages"]["sklearn"] is None
        assert caps["packages"]["duckdb"] == "1.5.4"
    finally:
        _restore_pkg_status(saved)


def test_capabilities_sem_scipy_nao_e_full():
    saved = _with_pkg_status({"numpy": "2.5.1", "scipy": None,
                              "sklearn": "1.9.0", "duckdb": None})
    try:
        assert sidecar.get_capabilities()["tier"] == "stdlib"
    finally:
        _restore_pkg_status(saved)


# ── dataset round-trip por hash (DEC-HX-006) ─────────────────────────────────

def test_dataset_post_head_idempotente(server):
    store = conftest.make_store([1.0, 2.0, 3.0, 4.0])
    h = "hashA"

    # HEAD antes de existir ⇒ 404.
    assert server.head("/api/compute/datasets/" + h).status == 404

    # POST ⇒ 200, reused False.
    r = server.post("/api/compute/datasets?hash=" + h, body=store)
    assert r.status == 200
    assert r.json() == {"datasetId": h, "reused": False}

    # HEAD depois ⇒ 200; hash desconhecido ⇒ 404.
    assert server.head("/api/compute/datasets/" + h).status == 200
    assert server.head("/api/compute/datasets/desconhecido").status == 404

    # POST de novo com o mesmo hash ⇒ idempotente (reused True).
    r2 = server.post("/api/compute/datasets?hash=" + h, body=store)
    assert r2.json() == {"datasetId": h, "reused": True}


def test_dataset_post_sem_hash_400(server):
    r = server.post("/api/compute/datasets", body={})
    assert r.status == 400


# ── ciclo de job (echo_stats) ────────────────────────────────────────────────

def _poll_job(server, job_id, timeout=10.0):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = server.get("/api/compute/jobs/" + job_id).json()
        if last["status"] in ("done", "error"):
            return last
        time.sleep(0.02)
    return last


def test_job_echo_stats_round_trip(server):
    values = [1.5, 2.5, 3.0, 10.0]  # soma = 17.0, rowCount = 4
    store = conftest.make_store(values)
    h = "hashJob"
    server.post("/api/compute/datasets?hash=" + h, body=store)

    created = server.post("/api/compute/jobs", body={
        "task": "echo_stats", "datasetId": h, "params": {"col": "m"},
        "protocolVersion": sidecar.PROTOCOL_VERSION,
    })
    assert created.status == 201
    job_id = created.json()["jobId"]

    final = _poll_job(server, job_id)
    assert final["status"] == "done", final
    res = final["result"]
    assert res["rowCount"] == 4
    assert res["counted"] is True
    assert abs(res["sum"] - 17.0) < 1e-9


def test_job_task_desconhecida_400(server):
    r = server.post("/api/compute/jobs", body={"task": "nao_existe"})
    assert r.status == 400


def test_job_inexistente_404(server):
    assert server.get("/api/compute/jobs/nao-existe").status == 404


# ── cancelamento ─────────────────────────────────────────────────────────────

def test_cancel_job_desconhecido_404(server):
    assert server.delete("/api/compute/jobs/nao-existe").status == 404


def test_cancel_job_real_best_effort(server):
    store = conftest.make_store([1.0, 2.0])
    h = "hashCancel"
    server.post("/api/compute/datasets?hash=" + h, body=store)
    created = server.post("/api/compute/jobs", body={
        "task": "echo_stats", "datasetId": h, "params": {"col": "m"},
    })
    job_id = created.json()["jobId"]
    r = server.delete("/api/compute/jobs/" + job_id)
    assert r.status == 200
    assert r.json()["cancelled"] is True
    # Após cancelar/concluir, um GET ainda responde um estado terminal coerente.
    snap = server.get("/api/compute/jobs/" + job_id).json()
    assert snap["status"] in ("done", "error")


# ── run_task síncrono (sem HTTP nem multiprocessing) ─────────────────────────

def test_run_task_echo_stats_direto():
    store = conftest.make_store([2.0, 2.0, 2.0])  # soma = 6.0
    res = sidecar.run_task("echo_stats", store, {"col": "m"})
    assert res["rowCount"] == 3
    assert abs(res["sum"] - 6.0) < 1e-9
    assert res["counted"] is True


def test_run_task_sem_coluna_metrica():
    store = conftest.make_store([1.0, 2.0])
    res = sidecar.run_task("echo_stats", store, {})  # sem 'col'
    assert res["rowCount"] == 2
    assert res["counted"] is False
    assert res["sum"] == 0.0
