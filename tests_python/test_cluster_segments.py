# -*- coding: utf-8 -*-
"""
GATE cross-runtime da Clusterização de Segmentos — Execução Híbrida H8 (DEC-HX-005).

Consome as MESMAS fixtures douradas geradas pelo Vitest
(tests/fixtures/golden/cluster_segments_*.json — entrada no formato do fio + o
ClusterModel esperado do worker JS, dentro dos tetos do browser) e executa cada
entrada no motor numpy do sidecar (release/python/motor_clusters.py, via a task
`cluster_segments` de release/sidecar.py), exigindo igualdade NÚMERO A NÚMERO:

  · contagens/inteiros/strings/bools/nulls: igualdade EXATA (tolerância 0);
  · floats: tolerância RELATIVA 1e-9 — folga DEFENSIVA, não necessidade conhecida
    (diferente da H7, toda a matemática do k-means é racional + sqrt, bit-exata:
    o motor Python replica a ordem sequencial de acumulação e o PRNG mulberry32).

Sem este GATE verde, a task não roteia (o front só oferece dims/k ampliados quando o
sidecar declara `cluster_segments` em capabilities — que só é embarcada junto deste
teste). Requer numpy (tier full): sem numpy os testes de paridade são PULADOS — e um
teste à parte prova que, nesse caso, a task NÃO é ofertada em capabilities. Os EXTRAS
sklearn (silhueta/k automático, hierárquico) ficam FORA do dourado: são testados só
por determinismo/contrato, e pulados sem sklearn (extra por pacote, DEC-HX-004).
"""
import glob
import json
import os

import pytest

import conftest  # noqa: F401  (garante release/ no sys.path)
import sidecar

_GOLDEN_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "tests", "fixtures", "golden",
)
_GOLDEN_FILES = sorted(glob.glob(os.path.join(_GOLDEN_DIR, "cluster_segments_*.json")))

REL_TOL = 1e-9
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
            # contagem/inteiro no JSON dourado ⇒ tolerância ZERO (igualdade de VALOR)
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
    result = sidecar.run_task("cluster_segments", fx["store"], {"params": params})
    return _strip_time(result["clusterModel"])


def test_golden_fixtures_exist():
    # O GATE não pode passar "vazio": as fixtures douradas do Vitest são obrigatórias.
    assert len(_GOLDEN_FILES) > 0, (
        "nenhuma fixture dourada em %s — rode `npx vitest run "
        "tests/clusterSegmentsGolden.test.js` antes" % _GOLDEN_DIR
    )


# ── Paridade número a número (DEC-HX-005) ────────────────────────────────────────

@pytest.mark.parametrize("path", _GOLDEN_FILES, ids=[os.path.basename(p) for p in _GOLDEN_FILES])
def test_paridade_com_dourado(path):
    pytest.importorskip("numpy")
    fx = _load(path)
    actual = _run_engine(fx)
    _assert_equal(fx["expected"], actual, fx["name"])


# ── Determinismo (mesma entrada ⇒ mesmo ClusterModel) ────────────────────────────

def test_determinismo_mesma_entrada():
    pytest.importorskip("numpy")
    fx = _load(_GOLDEN_FILES[0])
    assert _run_engine(fx) == _run_engine(fx)


def test_determinismo_sem_tetos():
    # k acima do teto browser (a carga Classe B que o sidecar destrava) não tem
    # dourado JS — o contrato aqui é DETERMINISMO: duas execuções idênticas, e o
    # k efetivo nunca excede o nº de pontos.
    pytest.importorskip("numpy")
    fx = None
    for p in _GOLDEN_FILES:
        if "planted_1d.json" in p:
            fx = _load(p)
            break
    assert fx is not None
    a = _run_engine(fx, {"k": 12, "maxPoints": None})
    b = _run_engine(fx, {"k": 12, "maxPoints": None})
    assert a == b
    assert a["params"]["k"] <= a["population"]["points"]


# ── Escopo por nó no modo profundo (DEC-FR-003) — máscara + validação de rowCount ─

def _scoped_fixture():
    for p in _GOLDEN_FILES:
        if "scoped_by_node.json" in p:
            return _load(p)
    return None


def test_escopo_por_node_com_rowmask():
    # A fixtura escopada carrega params.scope + params.rowMask (bitmask base64). O motor
    # filtra as linhas ANTES da agregação e reproduz o dourado do worker número a número
    # (o walk de política JAMAIS foi portado — o Python só recebeu a máscara). model.scope
    # é campo aditivo, presente SÓ no escopado.
    pytest.importorskip("numpy")
    fx = _scoped_fixture()
    assert fx is not None, "fixture escopada ausente — rode o Vitest do golden antes"
    assert "rowMask" in fx["params"] and "scope" in fx["params"]
    actual = _run_engine(fx)
    _assert_equal(fx["expected"], actual, fx["name"])
    assert actual["scope"] == fx["params"]["scope"]


def test_rowmask_rowcount_mismatch_erro():
    # rowCount da máscara ≠ dataset ⇒ ERRO de job (o router faz fallback ao worker
    # clampado com o MESMO escopo, DEC-FR-003) — nunca um cluster silenciosamente errado.
    pytest.importorskip("numpy")
    fx = _scoped_fixture()
    assert fx is not None
    params = dict(fx["params"])
    params["rowMask"] = dict(params["rowMask"])
    params["rowMask"]["rowCount"] = int(params["rowMask"]["rowCount"]) + 1
    with pytest.raises(Exception):
        sidecar.run_task("cluster_segments", fx["store"], {"params": params})


def test_rowmask_csvid_mismatch_erro():
    # csvId da máscara ≠ csv eleito ⇒ ERRO de job (mesma semântica de fallback declarado).
    pytest.importorskip("numpy")
    fx = _scoped_fixture()
    assert fx is not None
    params = dict(fx["params"])
    params["rowMask"] = dict(params["rowMask"])
    params["rowMask"]["csvId"] = params["rowMask"]["csvId"] + "_x"
    with pytest.raises(Exception):
        sidecar.run_task("cluster_segments", fx["store"], {"params": params})


# ── Extras sklearn (silhueta/k automático, hierárquico) — nunca no dourado ───────

def test_autok_com_silhueta():
    pytest.importorskip("numpy")
    pytest.importorskip("sklearn")
    fx = None
    for p in _GOLDEN_FILES:
        if "planted_1d.json" in p:
            fx = _load(p)
            break
    a = _run_engine(fx, {"autoK": True, "k": 6})
    b = _run_engine(fx, {"autoK": True, "k": 6})
    assert a == b  # determinístico dado o mesmo ambiente sklearn
    assert a["params"]["autoK"] is True
    assert a["quality"]["silhouette"] is not None
    # 3 perfis plantados bem separados ⇒ a silhueta escolhe k=3.
    assert a["params"]["k"] == 3


def test_hierarquico():
    pytest.importorskip("numpy")
    pytest.importorskip("sklearn")
    fx = None
    for p in _GOLDEN_FILES:
        if "planted_1d.json" in p:
            fx = _load(p)
            break
    a = _run_engine(fx, {"method": "hierarchical"})
    assert a["quality"]["method"] == "hierarchical"
    assert len(a["clusters"]) == 3
    assert _run_engine(fx, {"method": "hierarchical"}) == a


def test_extra_sem_sklearn_degrada_declarado(monkeypatch):
    # sklearn indisponível ⇒ o job NÃO falha: roda o k-means determinístico e declara
    # a degradação em quality.note (paridade total — nunca um erro).
    np = pytest.importorskip("numpy")  # noqa: F841
    import importlib
    real_import = importlib.import_module

    engine = sidecar._load_cluster_engine()
    monkeypatch.setattr(engine, "_maybe_sklearn", lambda: False)
    fx = _load(_GOLDEN_FILES[0])
    a = _run_engine(fx, {"autoK": True})
    assert a["quality"]["note"] == "sklearn_unavailable"
    assert a["quality"]["method"] == "kmeans"
    assert a["params"]["autoK"] is False
    assert real_import is not None


# ── Gating por tier (a task NÃO aparece no stdlib — mesmo contrato da H7) ────────

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
        assert "cluster_segments" not in caps["tasks"]
    finally:
        _restore_pkg_status(saved)


def test_task_presente_no_tier_full():
    # sklearn ausente NÃO é gate: a task aparece mesmo assim (extras degradam).
    saved = _with_pkg_status({"numpy": "2.5.1", "scipy": "1.18.0", "sklearn": None, "duckdb": None})
    try:
        caps = sidecar.get_capabilities()
        assert caps["tier"] == "full"
        assert "cluster_segments" in caps["tasks"]
    finally:
        _restore_pkg_status(saved)


def test_job_recusado_no_tier_stdlib(server):
    saved = _with_pkg_status({"numpy": None, "scipy": None, "sklearn": None, "duckdb": None})
    try:
        resp = server.post("/api/compute/jobs", body={
            "task": "cluster_segments", "datasetId": "x", "params": {},
            "protocolVersion": sidecar.PROTOCOL_VERSION,
        })
        assert resp.status == 400
    finally:
        _restore_pkg_status(saved)
