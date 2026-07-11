# -*- coding: utf-8 -*-
"""
GATE cross-runtime da Descoberta de Segmentos — Execução Híbrida H7 (DEC-HX-005).

Consome as MESMAS fixtures douradas geradas pelo Vitest
(tests/fixtures/golden/segment_discovery_*.json — entrada no formato do fio +
SegmentModel esperado do worker JS, sem recomendações) e executa cada entrada no
motor numpy do sidecar (release/python/motor_segmentos.py, via a task
`segment_discovery` de release/sidecar.py), exigindo igualdade NÚMERO A NÚMERO:

  · contagens/inteiros/strings/bools/nulls: igualdade EXATA (tolerância 0);
  · floats: tolerância RELATIVA 1e-9 (cobre 1 ulp de transcendentais log/exp/pow
    entre as libm de V8 e CPython; toda aritmética racional é bit-idêntica porque
    o motor Python replica a ORDEM SEQUENCIAL de acumulação do JS).

Sem este GATE verde, a task não roteia (o front só oferece depth 3–4 quando o
sidecar declara `segment_discovery` em capabilities — que só é embarcada junto
deste teste). Requer numpy (tier full): sem numpy o módulo é PULADO — e um teste
à parte prova que, nesse caso, a task NÃO é ofertada em capabilities (o contrato
"não aparece no tier stdlib").
"""
import glob
import json
import math
import os

import pytest

import conftest  # noqa: F401  (garante release/ no sys.path)
import sidecar

_GOLDEN_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "tests", "fixtures", "golden",
)
_GOLDEN_FILES = sorted(glob.glob(os.path.join(_GOLDEN_DIR, "segment_discovery_*.json")))

REL_TOL = 1e-9  # floats (transcendentais); contagens são exatas
ABS_TOL_AT_ZERO = 1e-12


def _load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _assert_equal(expected, actual, path):
    if isinstance(expected, dict):
        assert isinstance(actual, dict), "%s: esperado dict, veio %r" % (path, type(actual))
        assert set(expected.keys()) == set(actual.keys()), (
            "%s: chaves divergem: só no esperado %s · só no atual %s"
            % (path, set(expected) - set(actual), set(actual) - set(expected))
        )
        for k in expected:
            _assert_equal(expected[k], actual[k], "%s.%s" % (path, k))
    elif isinstance(expected, list):
        assert isinstance(actual, list), "%s: esperado list, veio %r" % (path, type(actual))
        assert len(expected) == len(actual), (
            "%s: tamanhos divergem (%d vs %d)" % (path, len(expected), len(actual))
        )
        for i, (e, a) in enumerate(zip(expected, actual)):
            _assert_equal(e, a, "%s[%d]" % (path, i))
    elif expected is None:
        assert actual is None, "%s: esperado null, veio %r" % (path, actual)
    elif isinstance(expected, bool):
        assert isinstance(actual, bool) and actual == expected, (
            "%s: esperado %r, veio %r" % (path, expected, actual)
        )
    elif _is_number(expected):
        assert _is_number(actual), "%s: esperado número, veio %r" % (path, actual)
        e, a = float(expected), float(actual)
        if isinstance(expected, int):
            # contagem/inteiro no JSON dourado ⇒ tolerância ZERO (o motor Python pode
            # devolver 4000.0 para 4000 — igualdade de VALOR, não de tipo)
            assert a == e, "%s: contagem diverge (esperado %r, veio %r)" % (path, expected, actual)
        elif e == 0.0:
            assert abs(a) <= ABS_TOL_AT_ZERO, "%s: esperado 0, veio %r" % (path, actual)
        else:
            rel = abs(a - e) / max(abs(e), abs(a))
            assert rel <= REL_TOL, (
                "%s: float diverge além de %g (esperado %.17g, veio %.17g, rel %.3g)"
                % (path, REL_TOL, e, a, rel)
            )
    else:
        assert actual == expected, "%s: esperado %r, veio %r" % (path, expected, actual)


def _strip_time(model):
    out = dict(model)
    out["generatedAt"] = None
    return out


def _run_engine(fx, params_override=None):
    params = dict(fx["params"] or {})
    if params_override:
        params.update(params_override)
    result = sidecar.run_task("segment_discovery", fx["store"], {
        "shapes": fx["shapes"], "conns": fx["conns"],
        "scope": fx["scope"], "params": params,
    })
    return _strip_time(result["segmentModel"])


def test_golden_fixtures_exist():
    # O GATE não pode passar "vazio": as fixtures douradas do Vitest são obrigatórias.
    assert len(_GOLDEN_FILES) > 0, (
        "nenhuma fixture dourada em %s — rode `npx vitest run "
        "tests/segmentDiscoveryGolden.test.js` antes" % _GOLDEN_DIR
    )


# ── Paridade número a número (DEC-HX-005) ────────────────────────────────────────

@pytest.mark.parametrize("path", _GOLDEN_FILES, ids=[os.path.basename(p) for p in _GOLDEN_FILES])
def test_paridade_com_dourado(path):
    pytest.importorskip("numpy")
    fx = _load(path)
    actual = _run_engine(fx)
    _assert_equal(fx["expected"], actual, fx["name"])


# ── Determinismo (mesma entrada ⇒ mesmo SegmentModel) ────────────────────────────

def test_determinismo_mesma_entrada():
    pytest.importorskip("numpy")
    fx = _load(_GOLDEN_FILES[0])
    a = _run_engine(fx)
    b = _run_engine(fx)
    assert a == b


def test_determinismo_depth_profundo():
    # depth 3–4 (a carga Classe B que o sidecar destrava) não tem dourado JS (o worker
    # clampa em 2) — o contrato aqui é DETERMINISMO: duas execuções idênticas.
    pytest.importorskip("numpy")
    fx = None
    for p in _GOLDEN_FILES:
        if "planted_2d.json" in p:
            fx = _load(p)
            break
    assert fx is not None
    a = _run_engine(fx, {"maxDepth": 4, "beamWidth": 16})
    b = _run_engine(fx, {"maxDepth": 4, "beamWidth": 16})
    assert a == b
    # profundidade maior nunca REMOVE os achados 1D/2D já significativos da fixture
    ids_shallow = {f["id"] for f in _run_engine(fx)["findings"]}
    ids_deep = {f["id"] for f in a["findings"]}
    assert ids_shallow <= ids_deep


# ── Gating por tier (a task NÃO aparece no stdlib — contrato do épico H7) ────────

def _with_pkg_status(status):
    saved = dict(sidecar._pkg_status)
    with sidecar._pkg_lock:
        sidecar._pkg_status.clear()
        sidecar._pkg_status.update(status)
    return saved


def _restore_pkg_status(saved):
    with sidecar._pkg_lock:
        sidecar._pkg_status.clear()
        sidecar._pkg_status.update(saved)


def test_task_ausente_no_tier_stdlib():
    saved = _with_pkg_status({"numpy": None, "scipy": None, "sklearn": None, "duckdb": None})
    try:
        caps = sidecar.get_capabilities()
        assert caps["tier"] == "stdlib"
        assert "segment_discovery" not in caps["tasks"]
        assert "echo_stats" in caps["tasks"]
    finally:
        _restore_pkg_status(saved)


def test_task_presente_no_tier_full():
    saved = _with_pkg_status({"numpy": "2.5.1", "scipy": "1.18.0", "sklearn": None, "duckdb": None})
    try:
        caps = sidecar.get_capabilities()
        assert caps["tier"] == "full"
        assert "segment_discovery" in caps["tasks"]
    finally:
        _restore_pkg_status(saved)


def test_job_recusado_no_tier_stdlib(server):
    # POST /jobs com a task de tier full num sidecar stdlib ⇒ 400 (o router então cai
    # no fallback browser — a task nunca "meio-roda" sem numpy).
    saved = _with_pkg_status({"numpy": None, "scipy": None, "sklearn": None, "duckdb": None})
    try:
        resp = server.post("/api/compute/jobs", body={
            "task": "segment_discovery", "datasetId": "x", "params": {},
            "protocolVersion": sidecar.PROTOCOL_VERSION,
        })
        assert resp.status == 400
    finally:
        _restore_pkg_status(saved)
