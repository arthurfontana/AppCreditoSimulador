# -*- coding: utf-8 -*-
"""
GATE do Goal Seek Profundo — Execução Híbrida, Sessão GS5 (DEC-GS-006/009).

Diferente da H7/H8, aqui NÃO há paridade cross-runtime (DEC-GS-001: um MILP não tem
gêmeo JS). O contrato é o FORMATO do result + o DETERMINISMO do solver. As fixtures de
catálogo (tests_python/fixtures/goalseek/*.json) foram construídas À MÃO nesta sessão
(NÃO derivadas do motor JS), com ótimo verificável manualmente — inclusive o caso
obrigatório em que o greedy comprovadamente ERRA e o MILP acha o ótimo (movimento caro
que destrava dois baratos via `requires`).

Os 6 grupos da DEC-GS-009:
  (1) knapsack com precedência onde o greedy erra ⇒ MILP acha o ótimo;
  (2) teto linearizado respeitado exatamente na borda;
  (3) Dinkelbach converge para a razão correta com lens (denominador variável);
  (4) fronteira monótona no alvo;
  (5) determinismo (duas execuções idênticas);
  (6) infeasible/time_limit reportados.

Requer numpy+scipy com `scipy.optimize.milp` (tier full + gate DEC-GS-010): sem eles o
módulo é PULADO — e um teste à parte prova que, nesse caso, a task NÃO é ofertada em
capabilities.
"""
import glob
import json
import math
import os
import sys

import pytest

import conftest  # noqa: F401  (garante release/ no sys.path)
import sidecar

# O motor vive em release/python/ (carregado LAZY por importlib no sidecar). Aqui o
# importamos direto para exercitar solve_goal_seek/milp (monkeypatch do time_limit).
_PYTHON_DIR = os.path.join(os.path.dirname(sidecar.__file__), "python")
if _PYTHON_DIR not in sys.path:
    sys.path.insert(0, _PYTHON_DIR)

# Gate do próprio módulo: sem scipy.optimize.milp, todo o GATE é pulado.
pytest.importorskip("numpy")
pytest.importorskip("scipy")
try:
    from scipy.optimize import milp as _milp  # noqa: F401
except Exception:  # pragma: no cover
    pytest.skip("scipy.optimize.milp indisponível (scipy < 1.9)", allow_module_level=True)

import motor_goalseek as mg  # noqa: E402  (após o gate)

_FIX_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "goalseek")
_FIX_FILES = sorted(glob.glob(os.path.join(_FIX_DIR, "*.json")))

REL_TOL = 1e-9
ABS_TOL = 1e-9


def _load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _close(a, b):
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(a, b, rel_tol=REL_TOL, abs_tol=ABS_TOL)


# ── Greedy de referência (espelho do critério de computeGoalSeek/DEC-GS-003) ──────
# Reproduz a busca gulosa do worker o suficiente para PROVAR que ela erra na fixture de
# knapsack (grupo 1). Score = (collQty + collAvg·K)/(tgtQty + tgtAvg·K), crescente;
# desempate qty desc, id asc. Respeita precedência (`requires`) e tetos.
def _greedy(catalog, goal, constraints):
    base = catalog["baselineRaw"]
    direction = goal.get("direction", "increase")
    wants = direction == "increase"
    target = goal.get("target", "approvalRate")
    minimize = goal.get("minimize", "inadInferida")
    max_ir = constraints.get("maxInadReal")
    max_ii = constraints.get("maxInadInf")
    pool = [c for c in catalog["candidates"] if bool(c.get("toApproved")) == wants]
    byid = {c["id"]: c for c in pool}

    def collq(c):
        return {"inadReal": c["inadRRaw"], "inadInferida": c["inadIRaw"],
                "approval": c["qty"], "salesVolume": c["qtdAltasInfer"]}[minimize]

    def tgtq(c):
        return {"approvalRate": c["qty"], "approvedAltasInfer": c["qtdAltasInfer"],
                "inadReal": c["inadRRaw"], "inadInferida": c["inadIRaw"]}[target]

    n = max(1, len(pool))
    coll_avg = sum(collq(c) for c in pool) / n
    tgt_avg = sum(tgtq(c) for c in pool) / n
    K = max(1.0, (sum(c["qty"] for c in pool) / n) * 0.1)

    def score(c):
        return (collq(c) + coll_avg * K) / (tgtq(c) + tgt_avg * K)

    rem = {c["id"]: 0 for c in pool}
    dep = {c["id"]: [] for c in pool}
    for c in pool:
        for r in c["requires"]:
            if r in byid:
                rem[c["id"]] += 1
                dep[r].append(c["id"])
    lib = set(c["id"] for c in pool if rem[c["id"]] == 0)
    run = {k: base.get(k, 0) for k in ("approvedQty", "decidedQty", "qtdAltasSum",
                                       "qtdAltasInferSum", "inadRealSum", "inadInferidaSum")}
    sign = 1 if wants else -1
    chosen = []
    while True:
        order = sorted((byid[i] for i in lib),
                       key=lambda c: (score(c), -c["qty"], c["id"]))
        pick = None
        for c in order:
            nx = dict(run)
            nx["approvedQty"] += sign * c["qty"]
            nx["decidedQty"] += sign * (c["qty"] if c["type"] == "lens_threshold" else 0)
            nx["qtdAltasSum"] += sign * c["qtdAltas"]
            nx["qtdAltasInferSum"] += sign * c["qtdAltasInfer"]
            nx["inadRealSum"] += sign * c["inadRRaw"]
            nx["inadInferidaSum"] += sign * c["inadIRaw"]
            ir = nx["inadRealSum"] / nx["qtdAltasSum"] if nx["qtdAltasSum"] > 0 else None
            ii = (nx["inadInferidaSum"] / nx["qtdAltasInferSum"] if nx["qtdAltasInferSum"] > 0
                  else (nx["inadInferidaSum"] / nx["approvedQty"] if nx["approvedQty"] > 0 else None))
            if max_ir is not None and ir is not None and ir > max_ir:
                continue
            if max_ii is not None and ii is not None and ii > max_ii:
                continue
            pick = c
            run = nx
            break
        if not pick:
            break
        chosen.append(pick["id"])
        lib.discard(pick["id"])
        for d in dep[pick["id"]]:
            rem[d] -= 1
            if rem[d] == 0:
                lib.add(d)
    return chosen, run


# ── (1)–(2) fixtures de catálogo commitadas com ótimo verificável à mão ──────────
def test_fixtures_exist():
    assert _FIX_FILES, "nenhuma fixture de catálogo em %s" % _FIX_DIR


@pytest.mark.parametrize("path", _FIX_FILES, ids=[os.path.basename(p) for p in _FIX_FILES])
def test_fixture_optimum(path):
    fx = _load(path)
    exp = fx["expect"]
    res = mg.solve_goal_seek(fx["params"])

    assert res["status"] == exp["status"], "%s: status" % fx["name"]

    if exp.get("solutionNull"):
        assert res["solution"] is None
    if exp.get("frontierEmpty"):
        assert res["frontier"] == []
    if "solutionIds" in exp:
        assert res["solution"] is not None
        assert res["solution"]["ids"] == exp["solutionIds"], (
            "%s: ids %r != %r" % (fx["name"], res["solution"]["ids"], exp["solutionIds"])
        )
    if "predicted" in exp:
        pred = res["solution"]["predicted"]
        for k, v in exp["predicted"].items():
            assert _close(pred[k], v), "%s: predicted.%s %r != %r" % (fx["name"], k, pred[k], v)


# ── (1) grupo obrigatório: o greedy ERRA, o MILP acha o ótimo ────────────────────
def test_greedy_erra_milp_acerta():
    fx = _load(os.path.join(_FIX_DIR, "greedy_errs_knapsack.json"))
    p = fx["params"]
    res = mg.solve_goal_seek(p)
    base_qi = p["catalog"]["baselineRaw"]["qtdAltasInferSum"]

    # MILP: valor do alvo (QI ganho) = Σ qtdAltasInfer das ids selecionadas.
    sel = set(res["solution"]["ids"])
    gained = sum(c["qtdAltasInfer"] for c in p["catalog"]["candidates"] if c["id"] in sel)
    assert gained == fx["expect"]["targetValue"], "MILP alvo %r != %r" % (gained, fx["expect"]["targetValue"])
    # Nenhum lens na fixture ⇒ o denominador de aprovação (decidedQty) não muda.
    assert res["solution"]["predicted"]["decidedQty"] == 2000.0

    # Greedy: comprovadamente pior (enche a capacidade com os decoys, não destrava B/C).
    gids, grun = _greedy(p["catalog"], p["goal"], p["constraints"])
    greedy_gained = grun["qtdAltasInferSum"] - base_qi
    assert greedy_gained == fx["expect"]["greedyValue"], "greedy %r != %r" % (greedy_gained, fx["expect"]["greedyValue"])
    assert gained > greedy_gained, "o MILP deve superar o greedy (%r vs %r)" % (gained, greedy_gained)


# ── (3) Dinkelbach converge para a razão correta (denominador variável via lens) ─
def test_dinkelbach_razao_correta():
    fx = _load(os.path.join(_FIX_DIR, "dinkelbach_lens.json"))
    p = fx["params"]
    cat = p["catalog"]
    base = cat["baselineRaw"]
    cands = cat["candidates"]

    # Enumera TODOS os 2^n subconjuntos e acha o max A/D à mão (denominador varia com lens).
    best_ratio, best_ids = -1.0, None
    n = len(cands)
    for mask in range(1 << n):
        A, D = base["approvedQty"], base["decidedQty"]
        ids = []
        for i in range(n):
            if mask & (1 << i):
                c = cands[i]
                A += c["qty"]
                if c["type"] == "lens_threshold":
                    D += c["qty"]
                ids.append(c["id"])
        ratio = A / D if D > 0 else -1.0
        if ratio > best_ratio + 1e-12:
            best_ratio, best_ids = ratio, sorted(ids)

    res = mg.solve_goal_seek(p)
    assert _close(res["solution"]["predicted"]["approvalRate"], best_ratio * 100.0)
    assert sorted(res["solution"]["ids"]) == best_ids


# ── (4) fronteira monótona no alvo ───────────────────────────────────────────────
def test_frontier_monotona():
    fx = _load(os.path.join(_FIX_DIR, "greedy_errs_knapsack.json"))
    res = mg.solve_goal_seek(fx["params"])
    pts = res["frontier"]
    assert len(pts) >= 2
    # Alvo (approvedAltasInfer ⇒ QI ≡ decidedQty? não: aqui QI = qtdAltasInfer). Usamos a
    # aprovação prevista (cresce ao subir o alvo) e o colateral inadReal (não decresce).
    approved = [pt["predicted"]["approvedQty"] for pt in pts]
    inad = [pt["predicted"]["inadReal"] for pt in pts]
    levels = [pt["level"] for pt in pts]
    for a, b in zip(levels, levels[1:]):
        assert b >= a - 1e-9, "níveis não monótonos: %r" % levels
    for a, b in zip(approved, approved[1:]):
        assert b >= a - 1e-9, "aprovação não monótona: %r" % approved
    for a, b in zip(inad, inad[1:]):
        assert b >= a - 1e-9, "colateral (inadReal) não monótono: %r" % inad


# ── Família de curvas "3D" (tetos de inad inferida, DEC-GS-006) ──────────────────
def test_familia_de_curvas():
    catalog = {
        "baselineRaw": {"approvedQty": 1000, "decidedQty": 2000, "totalQty": 2000,
                        "qtdAltasSum": 1000, "qtdAltasInferSum": 1000,
                        "inadRealSum": 30, "inadInferidaSum": 40},
        "candidates": [
            {"id": "c1", "type": "cinema_cell", "toApproved": True, "qty": 200, "qtdAltas": 200,
             "qtdAltasInfer": 200, "inadRRaw": 6, "inadIRaw": 16, "requires": []},
            {"id": "c2", "type": "cinema_cell", "toApproved": True, "qty": 150, "qtdAltas": 150,
             "qtdAltasInfer": 150, "inadRRaw": 3, "inadIRaw": 3, "requires": []},
            {"id": "c3", "type": "cinema_cell", "toApproved": True, "qty": 100, "qtdAltas": 100,
             "qtdAltasInfer": 100, "inadRRaw": 2, "inadIRaw": 2, "requires": []},
        ],
    }
    p = {"catalog": catalog,
         "goal": {"target": "approvalRate", "direction": "increase", "magnitude": None,
                  "minimize": "inadInferida"},
         "constraints": {"maxInadReal": None, "maxInadInf": None},
         "frontierPoints": 5}
    res = mg.solve_goal_seek(p)
    assert "curves" in res
    curves = res["curves"]
    base_inad_inf = 40.0 / 1000.0
    assert [c["maxInadInf"] for c in curves] == pytest.approx(
        [base_inad_inf * f for f in (1.0, 1.1, 1.25, 1.5)]
    )
    # Tetos crescentes ⇒ fronteiras não-piores (aprovação máxima não decresce).
    tops = [max((pt["predicted"]["approvalRate"] for pt in c["frontier"]), default=0.0) for c in curves]
    for a, b in zip(tops, tops[1:]):
        assert b >= a - 1e-9, "curvas não monótonas no teto: %r" % tops
    # Teto declarado pelo usuário ⇒ SEM família (só a curva dele).
    p2 = dict(p, constraints={"maxInadReal": None, "maxInadInf": 0.05})
    res2 = mg.solve_goal_seek(p2)
    assert "curves" not in res2


# ── (5) determinismo ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize("path", _FIX_FILES, ids=[os.path.basename(p) for p in _FIX_FILES])
def test_determinismo(path):
    fx = _load(path)
    a = json.dumps(mg.solve_goal_seek(fx["params"]), sort_keys=True)
    b = json.dumps(mg.solve_goal_seek(fx["params"]), sort_keys=True)
    assert a == b


# ── (6) infeasible / time_limit reportados ───────────────────────────────────────
def test_infeasible_reportado():
    fx = _load(os.path.join(_FIX_DIR, "infeasible_baseline_breaches.json"))
    res = mg.solve_goal_seek(fx["params"])
    assert res["status"] == "infeasible"
    assert res["solution"] is None
    assert res["frontier"] == []


def test_time_limit_reportado(monkeypatch):
    """O status 'time_limit' do HiGHS (status 1, com incumbente) propaga para o result.
    Determinístico: monkeypatcha `milp` para devolver um incumbente com status=1."""
    class _FakeRes:
        def __init__(self, x, status):
            self.x = x
            self.status = status

    import numpy as np
    calls = {"n": 0}
    real_milp = mg.milp

    def fake_milp(*args, **kwargs):
        calls["n"] += 1
        res = real_milp(*args, **kwargs)
        if res.x is None:
            return res
        # Marca como limite de tempo (status 1) mantendo o incumbente real.
        return _FakeRes(np.asarray(res.x), 1)

    monkeypatch.setattr(mg, "milp", fake_milp)
    fx = _load(os.path.join(_FIX_DIR, "dinkelbach_lens.json"))
    res = mg.solve_goal_seek(fx["params"])
    assert res["status"] == "time_limit"
    assert res["solution"] is not None  # incumbente ainda exibível


def test_pool_vazio_devolve_baseline():
    p = {"catalog": {"baselineRaw": {"approvedQty": 300, "decidedQty": 1000, "totalQty": 1000,
                                     "qtdAltasSum": 0, "qtdAltasInferSum": 0,
                                     "inadRealSum": 0, "inadInferidaSum": 0},
                     "candidates": []},
         "goal": {"target": "approvalRate", "direction": "increase", "magnitude": None,
                  "minimize": "inadInferida"},
         "constraints": {"maxInadReal": None, "maxInadInf": None}}
    res = mg.solve_goal_seek(p)
    assert res["status"] == "optimal"
    assert res["solution"]["ids"] == []
    assert _close(res["solution"]["predicted"]["approvalRate"], 30.0)


# ── Integração via sidecar.run_task (executor invisível, DEC-HX-002) ─────────────
def test_run_task_goal_seek_deep():
    fx = _load(os.path.join(_FIX_DIR, "ceiling_border.json"))
    result = sidecar.run_task("goal_seek_deep", {}, fx["params"])
    assert result["status"] == "optimal"
    assert result["solution"]["ids"] == ["X"]


# ── Gating (DEC-GS-010): task só no tier full E com scipy.optimize.milp ───────────
def _set_state(pkgs, milp_ok):
    saved_pkgs = dict(sidecar._pkg_status)
    with sidecar._pkg_lock:
        saved_milp = sidecar._scipy_milp
        sidecar._pkg_status.clear()
        sidecar._pkg_status.update(pkgs)
        sidecar._scipy_milp = milp_ok
    return saved_pkgs, saved_milp


def _restore_state(saved):
    saved_pkgs, saved_milp = saved
    with sidecar._pkg_lock:
        sidecar._pkg_status.clear()
        sidecar._pkg_status.update(saved_pkgs)
        sidecar._scipy_milp = saved_milp


def test_task_presente_com_milp():
    saved = _set_state({"numpy": "2.4.6", "scipy": "1.18.0", "sklearn": None, "duckdb": None}, True)
    try:
        caps = sidecar.get_capabilities()
        assert caps["tier"] == "full"
        assert "goal_seek_deep" in caps["tasks"]
    finally:
        _restore_state(saved)


def test_task_ausente_sem_milp():
    # Tier full, mas scipy < 1.9 (sem milp): a task NÃO é ofertada (DEC-GS-010).
    saved = _set_state({"numpy": "2.4.6", "scipy": "1.8.0", "sklearn": None, "duckdb": None}, False)
    try:
        caps = sidecar.get_capabilities()
        assert caps["tier"] == "full"
        assert "goal_seek_deep" not in caps["tasks"]
    finally:
        _restore_state(saved)


def test_task_ausente_no_tier_stdlib():
    saved = _set_state({"numpy": None, "scipy": None, "sklearn": None, "duckdb": None}, False)
    try:
        caps = sidecar.get_capabilities()
        assert caps["tier"] == "stdlib"
        assert "goal_seek_deep" not in caps["tasks"]
    finally:
        _restore_state(saved)


def test_job_recusado_sem_milp(server):
    saved = _set_state({"numpy": "2.4.6", "scipy": "1.8.0", "sklearn": None, "duckdb": None}, False)
    try:
        resp = server.post("/api/compute/jobs", body={
            "task": "goal_seek_deep", "datasetId": None, "params": {},
            "protocolVersion": sidecar.PROTOCOL_VERSION,
        })
        assert resp.status == 400
    finally:
        _restore_state(saved)
