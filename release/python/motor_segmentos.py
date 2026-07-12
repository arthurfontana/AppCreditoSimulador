# -*- coding: utf-8 -*-
"""
motor_segmentos.py — Descoberta de Segmentos no Motor Python (Execução Híbrida H7).

Port NUMPY (tier full apenas) do pipeline da Descoberta de Segmentos do worker JS
(`src/simulation.worker.js`): estágios 1–3 (discoverSegments → explainSegment →
prioritizeFindings, incl. binomial exato/aproximado, Benjamini–Hochberg, shrinkage
SHRINK_K, dedup e diagnostics) + asis_divergence + anomaly + estabilidade temporal —
ou seja, o equivalente EXATO de `segBuildModelWithoutRecs`: o SegmentModel SEM as
recomendações. As recomendações (patch + delta validado por runSimulation REAL,
DEC-SD-003/DEC-IA-005) continuam single-sourced no worker JS — o front as anexa via
COMPUTE_SEGMENT_RECS depois que este motor devolve o modelo (duplicar o motor de
simulação em Python é a Sessão H9, não a H7).

CONTRATO DE PARIDADE (DEC-HX-005 — GATE cross-runtime bloqueante):
  · Mesma entrada ⇒ mesmo SegmentModel do worker, número a número (fixtures douradas
    em tests/fixtures/golden/, geradas pelo Vitest e consumidas pelo pytest de
    tests_python/test_segment_discovery.py; floats com tolerância RELATIVA 1e-9 —
    cobre 1-ulp de transcendentais log/exp/pow entre libm's —, contagens exatas).
  · Toda soma de ponto flutuante replica a ORDEM SEQUENCIAL do JS: acumuladores por
    linha em ordem crescente de linha. Em numpy isso é np.cumsum (sequencial por
    definição) e np.bincount (loop C em ordem de entrada) — NUNCA np.sum (pairwise,
    ordem diferente ⇒ bits diferentes).
  · Desempates de ordenação usam o MESMO comparador especificado do worker
    (`segStrCmp`, code units UTF-16) — aqui via chave `encode('utf-16-be')`.
  · Semântica de string do JS clonada onde o valor passa por ela: parseFloat
    (prefixo numérico), String(número) (fmt ECMA-262), trim (inclui U+FEFF),
    toLowerCase/anyUpperCase ASCII.

Só numpy (além da stdlib) — scipy/sklearn NÃO são usados (não são gate do tier).
"""
import base64
import math
import re
from functools import cmp_to_key

import numpy as np

# ── Constantes (espelho 1:1 de src/simulation.worker.js) ─────────────────────────
SEG_BEAM_WIDTH = 8
SEG_MAX_DEPTH_DEFAULT = 2
SEG_DEFAULT_ALPHA = 0.05
SEG_DEFAULT_MAX_FINDINGS = 20
SEG_CURRENT_DOMINANT = 0.8
SEG_HET_MIN_IV = 0.1
SEG_MIN_INCREMENTAL_DEV = 0.1
SEG_ACTION_DEPTH_PENALTY = 0.5
SEG_LOCKED_PENALTY = 0.2
SEG_BINOM_EXACT_MAX = 1000
SEG_ASIS_MIN_SHARE = 0.15
SEG_ANOMALY_Z = 3.5
SEG_ANOMALY_MIN_VALUES = 4
IV_EPS = 0.5
SEGMENT_LOW_RATIO = 0.8
SEGMENT_HIGH_RATIO = 1.2

METRIC_KEYS = ("qty", "qtdAltas", "qtdAltasInfer", "inadReal", "inadInferida")
METRIC_COL_TYPES = set(METRIC_KEYS)

CINEMINHA_TYPES = {
    "eligibility": ("Elegível", "Não Elegível"),
    "offer": ("Com Oferta", "Sem Oferta"),
}

TERMINAL_TYPES = ("approved", "rejected", "as_is")

_DTYPES = {"Uint8Array": np.uint8, "Uint16Array": np.uint16, "Int32Array": np.int32}


# ── Clones de semântica de string do JS ──────────────────────────────────────────

# String.prototype.trim inclui U+FEFF além do whitespace Unicode; str.strip() não.
_TRIM_RE = re.compile(r"^[\s﻿   ]+|[\s﻿   ]+$")


def js_trim(s):
    return _TRIM_RE.sub("", s)


# parseFloat: ignora espaço à esquerda, lê o maior prefixo numérico (incl. Infinity e
# expoente), NaN quando não há prefixo. float('10a') do Python lançaria — daí o clone.
_PARSEFLOAT_RE = re.compile(
    r"^[+-]?(?:Infinity|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)"
)


def js_parse_float(s):
    m = _PARSEFLOAT_RE.match(js_trim(str(s)))
    if not m:
        return float("nan")
    tok = m.group(0)
    if tok.endswith("Infinity"):
        return float("-inf") if tok.startswith("-") else float("inf")
    return float(tok)


def js_num_str(v):
    """String(número) do ECMA-262 (Number::toString radix 10) — shortest round-trip
    com as regras de expoente do JS (decimal entre 1e-6 e 1e21; 'e+21', não 'e+021')."""
    if math.isnan(v):
        return "NaN"
    if v == float("inf"):
        return "Infinity"
    if v == float("-inf"):
        return "-Infinity"
    if v == 0:
        return "0"
    sign = "-" if v < 0 else ""
    a = abs(v)
    # repr() do CPython já é o shortest round-trip (mesmo algoritmo de dígitos do JS).
    s = repr(a)
    if "e" in s:
        mant, exp = s.split("e")
        e10 = int(exp)
    else:
        mant, e10 = s, 0
    if "." in mant:
        ip, fp = mant.split(".")
    else:
        ip, fp = mant, ""
    digits = (ip + fp).lstrip("0")
    # n tal que valor = 0.digits × 10^n (convenção da spec); k = nº de dígitos signif.
    n = len(ip.lstrip("0")) + e10 if ip.strip("0") != "" else e10 - (len(fp) - len(fp.lstrip("0")))
    digits = digits.rstrip("0")
    k = len(digits)
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + digits
    else:
        mant_out = digits[0] + ("." + digits[1:] if k > 1 else "")
        e = n - 1
        out = "%se%s%d" % (mant_out, "+" if e >= 0 else "-", abs(e))
    return sign + out


def _u16key(s):
    """Chave de ordenação por code units UTF-16 — bytes big-endian comparam igual à
    sequência de code units (== segStrCmp do worker)."""
    return str(s).encode("utf-16-be", "surrogatepass")


def seg_str_cmp(a, b):
    ka, kb = _u16key(a), _u16key(b)
    return -1 if ka < kb else (1 if ka > kb else 0)


def js_round(x):
    return math.floor(x + 0.5)


def seq_sum(arr):
    """Soma SEQUENCIAL (ordem do array) — bit-idêntica ao `acc += x` do JS.
    np.sum usa pairwise (ordem diferente) e NÃO pode ser usada aqui."""
    if len(arr) == 0:
        return 0.0
    return float(np.cumsum(np.asarray(arr, dtype=np.float64))[-1])


def _bincount_seq(idx, weights, n_bins):
    """Acumulação por bin em ordem de entrada (loop C do bincount) — equivale aos
    acumuladores por-bin do JS alimentados em ordem crescente de linha."""
    return np.bincount(idx, weights=np.asarray(weights, dtype=np.float64), minlength=n_bins)


# ── Decodificação do store (formato serializeCsvStore/M3) ────────────────────────


class Column(object):
    __slots__ = ("kind", "data", "dict", "codes")

    def __init__(self, kind, data=None, dict_=None, codes=None):
        self.kind = kind
        self.data = data
        self.dict = dict_
        self.codes = codes


def _decode_column(col):
    kind = col.get("kind")
    if kind == "num":
        if col.get("encoding") == "base64":
            raw = base64.b64decode(col["data"])
            data = np.frombuffer(raw, dtype="<f8").copy()
        else:
            data = np.array([float(x) for x in (col.get("data") or [])], dtype=np.float64)
        return Column("num", data=data)
    dict_ = [str(x) if x is not None else "" for x in (col.get("dict") or [])]
    if col.get("encoding") == "base64":
        dt = _DTYPES.get(col.get("dtype"), np.int32)
        codes = np.frombuffer(base64.b64decode(col["codes"]), dtype=dt).astype(np.int64)
    else:
        codes = np.array([int(x) for x in (col.get("codes") or [])], dtype=np.int64)
    return Column("dict", dict_=dict_, codes=codes)


def _build_columnar(headers, rows, column_types):
    """Espelho do buildColumnar do columnar.js (formato legado rows: string[][])."""
    n = len(rows)
    columns = {}
    types = column_types or {}
    for c, name in enumerate(headers):
        if types.get(name) in METRIC_COL_TYPES:
            data = np.empty(n, dtype=np.float64)
            for r in range(n):
                data[r] = js_parse_float(rows[r][c] if c < len(rows[r]) else "")
            columns[name] = Column("num", data=data)
        else:
            dict_, index = [], {}
            codes = np.empty(n, dtype=np.int64)
            for r in range(n):
                v = rows[r][c] if c < len(rows[r]) else ""
                v = "" if v is None else str(v)
                code = index.get(v)
                if code is None:
                    code = len(dict_)
                    dict_.append(v)
                    index[v] = code
                codes[r] = code
            columns[name] = Column("dict", dict_=dict_, codes=codes)
    return columns, n


class Csv(object):
    __slots__ = ("headers", "column_types", "columns", "row_count", "_views")

    def __init__(self, raw):
        self.headers = list(raw.get("headers") or [])
        self.column_types = dict(raw.get("columnTypes") or {})
        if raw.get("columns"):
            self.columns = {k: _decode_column(v) for k, v in raw["columns"].items()}
            self.row_count = int(raw.get("rowCount") or 0)
        elif isinstance(raw.get("rows"), list):
            self.columns, self.row_count = _build_columnar(
                self.headers, raw["rows"], self.column_types
            )
        else:
            self.columns, self.row_count = {}, 0
        self._views = {}

    def col_at(self, idx):
        if idx < 0 or idx >= len(self.headers):
            return None
        return self.columns.get(self.headers[idx])

    def view(self, idx, trim=True):
        """Fatoração unificada de uma coluna: (values: list[str], codes: int64[n]).
        Coluna dict → dicionário (trimado quando trim=True, com MERGE de códigos cujo
        valor trimado colide — mesmo efeito do Map por string do JS, preservando a
        ordem de primeira aparição NO DICIONÁRIO); coluna num → distintos via
        String(número) do JS; ausente → None."""
        key = (idx, trim)
        if key in self._views:
            return self._views[key]
        col = self.col_at(idx)
        if col is None:
            self._views[key] = None
            return None
        if col.kind == "dict":
            vals = [js_trim(v) for v in col.dict] if trim else list(col.dict)
            remap = np.empty(len(vals), dtype=np.int64)
            out_vals, seen = [], {}
            for k, v in enumerate(vals):
                g = seen.get(v)
                if g is None:
                    g = len(out_vals)
                    out_vals.append(v)
                    seen[v] = g
                remap[k] = g
            codes = remap[col.codes] if len(vals) else col.codes
            view = (out_vals, codes)
        else:
            uniq, inv = np.unique(col.data, return_inverse=True)
            vals = []
            for u in uniq:
                s = "" if math.isnan(u) else js_num_str(float(u))
                vals.append(js_trim(s) if trim else s)
            # merge pós-formatação (NaN→'' pode colidir com string vazia — não há
            # como duas floats distintas formatarem igual, exceto NaN múltiplo, que
            # np.unique já colapsa numa entrada só nas versões atuais)
            remap = np.empty(len(vals), dtype=np.int64)
            out_vals, seen = [], {}
            for k, v in enumerate(vals):
                g = seen.get(v)
                if g is None:
                    g = len(out_vals)
                    out_vals.append(v)
                    seen[v] = g
                remap[k] = g
            view = (out_vals, remap[inv] if len(vals) else inv)
        self._views[key] = view
        return view

    def metric_array(self, col_type):
        """Array por-linha da 1ª coluna com columnTypes==col_type, com o `|| 0` dos
        call sites (NaN→0); qty ausente → 1 por linha; demais ausentes → 0."""
        name = None
        for cname, t in self.column_types.items():
            if t == col_type:
                name = cname
                break
        idx = self.headers.index(name) if (name is not None and name in self.headers) else -1
        col = self.col_at(idx) if idx >= 0 else None
        n = self.row_count
        if col is None:
            return np.ones(n, dtype=np.float64) if col_type == "qty" else np.zeros(n, dtype=np.float64)
        if col.kind == "num":
            data = col.data.astype(np.float64, copy=True)
        else:
            per_code = np.array([js_parse_float(v) for v in col.dict], dtype=np.float64)
            data = per_code[col.codes] if len(col.dict) else np.zeros(n, dtype=np.float64)
        data[np.isnan(data)] = 0.0
        return data


# ── matchLensRule / isCellEligible (ports fiéis) ─────────────────────────────────


def match_lens_rule(cell_val, operator, rule_val):
    cv = js_trim(str(cell_val if cell_val is not None else ""))
    rv = js_trim(str(rule_val if rule_val is not None else ""))
    cvn = js_parse_float(cv)
    rvn = js_parse_float(rv)
    num_ok = not (math.isnan(cvn) or math.isnan(rvn))
    if operator == "equal":
        return cv.lower() == rv.lower()
    if operator == "notEqual":
        return cv.lower() != rv.lower()
    if operator == "in":
        return cv.lower() in [js_trim(s).lower() for s in rv.split(",")]
    if operator == "notIn":
        return cv.lower() not in [js_trim(s).lower() for s in rv.split(",")]
    if operator == "lt":
        return cvn < rvn if num_ok else seg_str_cmp(cv, rv) < 0
    if operator == "lte":
        return cvn <= rvn if num_ok else seg_str_cmp(cv, rv) <= 0
    if operator == "gt":
        return cvn > rvn if num_ok else seg_str_cmp(cv, rv) > 0
    if operator == "gte":
        return cvn >= rvn if num_ok else seg_str_cmp(cv, rv) >= 0
    return True


def get_cell_value(cells, key):
    v = (cells or {}).get(key)
    if v is False:
        return 0
    if v is None or v is True:
        return 1
    return v if isinstance(v, (int, float)) else 1


def is_cell_eligible(cells, key):
    return get_cell_value(cells, key) > 0


# ── Estatística (ports fiéis) ────────────────────────────────────────────────────


def seg_erf(x):
    sign = -1.0 if x < 0 else 1.0
    x = abs(x)
    t = 1.0 / (1.0 + 0.3275911 * x)
    y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * math.exp(-x * x)
    return sign * y


def seg_binom_two_sided(k_raw, n_raw, p0_raw):
    n = js_round(n_raw)
    if n <= 0:
        return 1.0
    k = js_round(max(0.0, min(float(n), k_raw)))
    p0 = min(1 - 1e-12, max(1e-12, p0_raw))
    if n <= SEG_BINOM_EXACT_MAX:
        pmf = (1 - p0) ** n
        ratio = p0 / (1 - p0)
        cum_le = 0.0
        cum_lt = 0.0
        for j in range(0, n + 1):
            if j <= k:
                cum_le += pmf
            if j < k:
                cum_lt += pmf
            if j < n:
                pmf = pmf * ((n - j) / (j + 1)) * ratio
        lower = cum_le
        upper = 1 - cum_lt
        return min(1.0, 2 * min(lower, upper))
    mean = n * p0
    sd = math.sqrt(n * p0 * (1 - p0))
    if sd <= 0:
        return 1.0
    z = abs((k - mean) / sd)
    return min(1.0, 1 - seg_erf(z / math.sqrt(2)))


def seg_benjamini_hochberg(pvals):
    m = len(pvals)
    q = [1.0] * m
    if m == 0:
        return q
    order = sorted(range(m), key=lambda i: (pvals[i], i))
    prev = 1.0
    for rank in range(m - 1, -1, -1):
        i = order[rank]
        qi = (pvals[i] * m) / (rank + 1)
        prev = min(prev, qi)
        q[i] = min(1.0, prev)
    return q


def compute_iv(bins):
    total_good = 0.0
    total_bad = 0.0
    for b in bins:
        total_good += max(0.0, b["altas"] - b["maus"])
        total_bad += b["maus"]
    if total_good <= 0 or total_bad <= 0:
        return None
    iv = 0.0
    for b in bins:
        good = max(0.0, b["altas"] - b["maus"])
        bad = b["maus"]
        if good == 0 or bad == 0:
            good += IV_EPS
            bad += IV_EPS
        dist_good = good / total_good
        dist_bad = bad / total_bad
        iv += (dist_good - dist_bad) * math.log(dist_good / dist_bad)
    return iv


def seg_woe(num_v, den_v, total_num, total_den):
    total_good = total_den - total_num
    total_bad = total_num
    if total_good <= 0 or total_bad <= 0:
        return None
    good = max(0.0, den_v - num_v)
    bad = num_v
    if good == 0 or bad == 0:
        good += IV_EPS
        bad += IV_EPS
    dist_good = good / total_good
    dist_bad = bad / total_bad
    if dist_good <= 0 or dist_bad <= 0:
        return None
    return math.log(dist_good / dist_bad)


def resolve_risk_metric(risk_metric):
    if risk_metric == "inadInferida":
        return {"id": "inadInferida", "numColType": "inadInferida", "denColType": "qtdAltasInfer",
                "direction": "lower", "label": "Inad. Inferida"}
    return {"id": "inadReal", "numColType": "inadReal", "denColType": "qtdAltas",
            "direction": "lower", "label": "Inad. Real"}


# ── Agregados por segmento (bundle das 5 métricas) ───────────────────────────────


def _agg_of(sums):
    return {k: float(sums[k]) for k in METRIC_KEYS}


def seg_sub_agg(a, b):
    return {k: a[k] - b[k] for k in METRIC_KEYS}


def metric_num(agg, spec):
    return agg.get(spec["numColType"], 0.0) or 0.0


def metric_den(agg, spec):
    return agg.get(spec["denColType"], 0.0) or 0.0


def metric_rate(agg, spec):
    d = metric_den(agg, spec)
    return (metric_num(agg, spec) / d) if d > 0 else None


def inad_real(agg):
    return (agg["inadReal"] / agg["qtdAltas"]) if agg["qtdAltas"] > 0 else None


def inad_inferida(agg):
    return (agg["inadInferida"] / agg["qtdAltasInfer"]) if agg["qtdAltasInfer"] > 0 else None


# ── Walk vetorizado do grafo de fluxo (semântica de routeRow/traverseRow, M8) ────


class _Walk(object):
    __slots__ = ("terminal", "deciding", "hit_scope")


_TERM_CODE = {"approved": 1, "rejected": 2, "as_is": 3}


def _compile_routes(shapes, conns):
    out = {s["id"]: [] for s in shapes}
    for c in conns:
        if c.get("from") in out:
            out[c["from"]].append({"to": c.get("to"), "label": c.get("label") or ""})
    decision_routes = {}
    cinema_routes = {}
    single_edge = {}
    for s in shapes:
        t = s.get("type")
        if t == "decision":
            m = {}
            for e in out[s["id"]]:
                label = js_trim(e["label"])
                if label not in m:
                    m[label] = e["to"]
            decision_routes[s["id"]] = m
        elif t == "cineminha":
            labels = CINEMINHA_TYPES.get(s.get("cinemaType"), CINEMINHA_TYPES["eligibility"])
            def find_edge(lbl, edges=out[s["id"]]):
                for e in edges:
                    if e["label"] == lbl:
                        return e["to"]
                return None
            cinema_routes[s["id"]] = (find_edge(labels[0]), find_edge(labels[1]))
        elif t in ("decision_lens", "port"):
            edges = out[s["id"]]
            single_edge[s["id"]] = edges[0]["to"] if edges else None
    return decision_routes, cinema_routes, single_edge


def _lens_row_mask(csv, rules):
    """Máscara booleana por linha replicando rowMatchesLensRules/compileLensMatcher
    (fold sequencial AND/OR na ordem das regras)."""
    n = csv.row_count
    if not rules:
        return None  # sem regras = passa tudo
    result = None
    for rule in rules:
        col = rule.get("col")
        idx = csv.headers.index(col) if col in csv.headers else -1
        rule_val = rule.get("value") or ""
        if idx < 0:
            m = match_lens_rule("", rule.get("operator"), rule_val)
            matches = np.full(n, bool(m))
        else:
            view = csv.view(idx, trim=False)
            vals, codes = view
            pass_by_code = np.array(
                [match_lens_rule(v, rule.get("operator"), rule_val) for v in vals], dtype=bool
            )
            matches = pass_by_code[codes] if len(vals) else np.zeros(n, dtype=bool)
        if result is None:
            result = matches
        elif rule.get("logic") == "OR":
            result = result | matches
        else:
            result = result & matches
    return result if result is not None else None


def _walk_csv(shapes, shape_by_id, node_index, routes, csv, root_id, scope_node_id):
    """Propaga TODAS as linhas do root pelo grafo (mesma semântica por-linha de
    routeRow: visited por linha, lastFlow = último nó decision/cinema/lens visitado,
    hitScope em QUALQUER tipo de nó). Devolve terminal/deciding/hitScope por linha."""
    n = csv.row_count
    w = _Walk()
    w.terminal = np.zeros(n, dtype=np.int8)
    w.deciding = np.full(n, -1, dtype=np.int64)
    w.hit_scope = np.zeros(n, dtype=bool)
    if root_id is None or n == 0:
        return w

    decision_routes, cinema_routes, single_edge = routes
    visited = {}
    compiled = {}

    def compile_node(node):
        nid = node["id"]
        if nid in compiled:
            return compiled[nid]
        t = node["type"]
        entry = None
        if t == "decision":
            idx = csv.headers.index(node.get("variableCol")) if node.get("variableCol") in csv.headers else -1
            view = csv.view(idx, trim=True)
            rmap = decision_routes.get(nid, {})
            if view is None:
                # coluna ausente: valor '' para todas as linhas
                target = rmap.get("")
                entry = ("decision-const", target)
            else:
                vals, codes = view
                # grupo de rota por código: -1 = sem rota (linha morre)
                targets = []
                tmap = {}
                route_group = np.full(len(vals), -1, dtype=np.int64)
                for k, v in enumerate(vals):
                    tgt = rmap.get(v)
                    if tgt is None:
                        continue
                    g = tmap.get(tgt)
                    if g is None:
                        g = len(targets)
                        targets.append(tgt)
                        tmap[tgt] = g
                    route_group[k] = g
                entry = ("decision", codes, route_group, targets)
        elif t == "cineminha":
            row_var, col_var = node.get("rowVar"), node.get("colVar")
            if not row_var and not col_var:
                entry = ("cinema-none",)
            else:
                def axis(var):
                    if not var:
                        return (["*"], None)
                    idx = csv.headers.index(var.get("col")) if var.get("col") in csv.headers else -1
                    if idx < 0:
                        return ([""], None)
                    view = csv.view(idx, trim=True)
                    if view is None:
                        return ([""], None)
                    return view
                r_vals, r_codes = axis(row_var)
                c_vals, c_codes = axis(col_var)
                n_c = len(c_vals)
                elig = np.zeros(len(r_vals) * n_c, dtype=bool)
                cells = node.get("cells") or {}
                for i, rv in enumerate(r_vals):
                    for j, cv in enumerate(c_vals):
                        elig[i * n_c + j] = is_cell_eligible(cells, "%s|%s" % (rv, cv))
                rc = r_codes if r_codes is not None else np.zeros(n, dtype=np.int64)
                cc = c_codes if c_codes is not None else np.zeros(n, dtype=np.int64)
                to_elig, to_not = cinema_routes.get(nid, (None, None))
                entry = ("cinema", elig[rc * n_c + cc], to_elig, to_not)
        elif t == "decision_lens":
            entry = ("lens", _lens_row_mask(csv, node.get("rules") or []), single_edge.get(nid))
        elif t == "port":
            entry = ("port", single_edge.get(nid))
        else:
            entry = ("dead",)
        compiled[nid] = entry
        return entry

    frontier = [(root_id, np.arange(n, dtype=np.int64))]
    while frontier:
        node_id, rows = frontier.pop(0)
        if rows.size == 0:
            continue
        node = shape_by_id.get(node_id)
        if node is None:
            continue
        vis = visited.get(node_id)
        if vis is None:
            vis = np.zeros(n, dtype=bool)
            visited[node_id] = vis
        alive = rows[~vis[rows]]
        vis[rows] = True
        rows = alive
        if rows.size == 0:
            continue
        if scope_node_id is not None and node_id == scope_node_id:
            w.hit_scope[rows] = True
        t = node["type"]
        if t in _TERM_CODE:
            w.terminal[rows] = _TERM_CODE[t]
            continue
        entry = compile_node(node)
        kind = entry[0]
        if kind == "decision":
            w.deciding[rows] = node_index[node_id]
            _, codes, route_group, targets = entry
            g = route_group[codes[rows]]
            for gi, tgt in enumerate(targets):
                sub = rows[g == gi]
                if sub.size:
                    frontier.append((tgt, sub))
        elif kind == "decision-const":
            w.deciding[rows] = node_index[node_id]
            tgt = entry[1]
            if tgt is not None:
                frontier.append((tgt, rows))
        elif kind == "cinema":
            w.deciding[rows] = node_index[node_id]
            _, elig_rows, to_elig, to_not = entry
            e = elig_rows[rows]
            if to_elig is not None:
                sub = rows[e]
                if sub.size:
                    frontier.append((to_elig, sub))
            if to_not is not None:
                sub = rows[~e]
                if sub.size:
                    frontier.append((to_not, sub))
        elif kind == "cinema-none":
            w.deciding[rows] = node_index[node_id]
            # sem eixos: linha morre aqui (break do JS)
        elif kind == "lens":
            w.deciding[rows] = node_index[node_id]
            _, mask, tgt = entry
            passing = rows if mask is None else rows[mask[rows]]
            if tgt is not None and passing.size:
                frontier.append((tgt, passing))
        elif kind == "port":
            tgt = entry[1]
            if tgt is not None:
                frontier.append((tgt, rows))
        # 'dead': linha morre
    return w


# ── Dispersão / segRowsOf ────────────────────────────────────────────────────────


def _dispersion(rows, row_ctx):
    terminal, res, deciding, qtyv = row_ctx
    t = terminal[rows]
    q = qtyv[rows]
    reached_mask = t > 0
    reached = seq_sum(q[reached_mask])
    # JS cria a chave do terminal quando ALGUMA linha chega nele (mesmo com qty 0);
    # o acumulador de cada terminal recebe só as próprias linhas, em ordem de linha.
    by_terminal = []
    for name, code in (("approved", 1), ("rejected", 2), ("as_is", 3)):
        mask = t == code
        if not np.any(mask):
            continue
        tq = seq_sum(q[mask])
        by_terminal.append({"terminal": name, "qty": tq,
                            "sharePct": (tq / reached) * 100 if reached > 0 else 0})
    dn = deciding[rows]
    nodes = np.unique(dn[reached_mask & (dn >= 0)])
    apr = seq_sum(q[res[rows] == 1])
    rej = seq_sum(q[res[rows] == 2])
    decided = apr + rej
    current = "undecided"
    if decided > 0:
        apr_share = apr / decided
        if apr_share >= SEG_CURRENT_DOMINANT:
            current = "approved"
        elif (1 - apr_share) >= SEG_CURRENT_DOMINANT:
            current = "rejected"
        else:
            current = "mixed"
    by_terminal.sort(key=lambda x: (-x["qty"], _u16key(x["terminal"])))
    return {"nodesCount": int(nodes.size), "terminals": by_terminal, "currentDecision": current,
            "decidedQty": decided, "approvedQty": apr, "rejectedQty": rej}


def _seg_rows_of(finding, ctx):
    conds = finding["segment"]["conditions"] or []
    if finding.get("_kind") == "het" or len(conds) == 0:
        return ctx["scopeRows"]
    rows = None
    for c in conds:
        ci = ctx["candCols"].index(c["col"]) if c["col"] in ctx["candCols"] else -1
        bin_ = ctx["binsByCand"][ci].get(c["value"]) if ci >= 0 else None
        rset = bin_["rows"] if bin_ else np.empty(0, dtype=np.int64)
        rows = rset if rows is None else np.intersect1d(rows, rset, assume_unique=True)
    return rows if rows is not None else np.empty(0, dtype=np.int64)


# ── Estágio 1 — discoverSegments ─────────────────────────────────────────────────


def _bins_for_rows(csv, view, rows, metric_rows):
    """Bins de uma coluna sobre `rows` (ordenados por 1ª aparição), com agregados
    sequenciais por métrica e as linhas de cada bin (ascendentes)."""
    vals, codes = view
    sub_codes = codes[rows]
    if sub_codes.size == 0:
        return {}
    uniq, first_idx = np.unique(sub_codes, return_index=True)
    order = np.argsort(first_idx, kind="stable")
    uniq_ordered = uniq[order]
    pos_of = np.full(len(vals), -1, dtype=np.int64)
    pos_of[uniq_ordered] = np.arange(uniq_ordered.size)
    binpos = pos_of[sub_codes]
    n_bins = uniq_ordered.size
    aggs = {k: _bincount_seq(binpos, metric_rows[k][rows], n_bins) for k in METRIC_KEYS}
    sorter = np.argsort(binpos, kind="stable")
    sorted_rows = rows[sorter]
    counts = np.bincount(binpos, minlength=n_bins)
    offsets = np.concatenate(([0], np.cumsum(counts)))
    bins = {}
    for b in range(n_bins):
        value = vals[uniq_ordered[b]]
        bins[value] = {
            "value": value,
            "agg": {k: float(aggs[k][b]) for k in METRIC_KEYS},
            "rows": sorted_rows[offsets[b]:offsets[b + 1]],
        }
    return bins


def discover_segments(shapes, conns, store, scope, spec, params):
    # `params.x != null ? x : default` do JS: chave presente com None também cai no default
    md = params.get("maxDepth")
    max_depth = md if md is not None else SEG_MAX_DEPTH_DEFAULT
    bw = params.get("beamWidth")
    beam_width = bw if bw is not None else SEG_BEAM_WIDTH
    scope_node_id = scope.get("nodeId") if scope else None

    shape_by_id = {s["id"]: s for s in shapes}
    node_index = {s["id"]: i for i, s in enumerate(shapes)}
    routes = _compile_routes(shapes, conns)

    port_ids = {s["id"] for s in shapes if s.get("type") == "port"}
    with_port_inc = {c.get("to") for c in conns if c.get("from") in port_ids}
    root_nodes = [s for s in shapes
                  if s.get("type") in ("decision", "cineminha", "decision_lens")
                  and s["id"] not in with_port_inc]

    def build_csv_scope(csv_id, csv):
        csv_roots = []
        for d in root_nodes:
            t = d.get("type")
            if t == "decision" and d.get("csvId") == csv_id:
                csv_roots.append(d)
            elif t == "cineminha" and ((d.get("rowVar") or {}).get("csvId") == csv_id or
                                       (d.get("colVar") or {}).get("csvId") == csv_id):
                csv_roots.append(d)
            elif t == "decision_lens":
                csv_roots.append(d)
        root_id = csv_roots[0]["id"] if csv_roots else None
        w = _walk_csv(shapes, shape_by_id, node_index, routes, csv, root_id, scope_node_id)

        n = csv.row_count
        in_scope = w.hit_scope if scope_node_id else np.ones(n, dtype=bool)
        scope_rows = np.flatnonzero(in_scope).astype(np.int64)

        # res por linha: approved/rejected direto do terminal; as_is resolve por
        # __DECISAO_ORIGINAL (uppercase do valor CRU, sem trim — semântica do JS).
        res = np.zeros(n, dtype=np.int8)  # 0 undecided, 1 approved, 2 rejected, 3 ignored
        res[w.terminal == 1] = 1
        res[w.terminal == 2] = 2
        d_orig_idx = csv.headers.index("__DECISAO_ORIGINAL") if "__DECISAO_ORIGINAL" in csv.headers else -1
        asis_mask = w.terminal == 3
        if np.any(asis_mask):
            if d_orig_idx >= 0:
                view = csv.view(d_orig_idx, trim=False)
                vals, codes = view
                per_code = np.zeros(len(vals), dtype=np.int8)
                for k, v in enumerate(vals):
                    u = str(v).upper()
                    per_code[k] = 1 if u == "APROVADO" else 2 if u == "REPROVADO" else 3
                res[asis_mask] = per_code[codes[asis_mask]]
            else:
                res[asis_mask] = 3
        metric_rows = {k: csv.metric_array(k) for k in METRIC_KEYS}
        scope_agg = _agg_of({k: seq_sum(metric_rows[k][scope_rows]) for k in METRIC_KEYS})
        return {
            "csvId": csv_id, "csv": csv, "dOrigIdx": d_orig_idx,
            "scopeAgg": scope_agg, "scopeRows": scope_rows,
            "rowCtx": (w.terminal, res, w.deciding, metric_rows["qty"]),
            "metricRows": metric_rows, "rootId": root_id, "walk": w,
        }

    winner = None
    for csv_id, csv in store.items():
        sc = build_csv_scope(csv_id, csv)
        if winner is None or sc["scopeAgg"]["qty"] > winner["scopeAgg"]["qty"]:
            winner = sc

    scope_label = None
    if scope_node_id:
        node = shape_by_id.get(scope_node_id)
        label = node.get("label") if node else None
        scope_label = {"nodeId": scope_node_id,
                       "label": label if label is not None else scope_node_id}

    if winner is None or winner["scopeRows"].size == 0:
        return {"scope": scope_label, "empty": True,
                "population": {"qty": 0, "decidedQty": 0}}

    csv = winner["csv"]
    scope_rows = winner["scopeRows"]
    scope_agg = winner["scopeAgg"]
    metric_rows = winner["metricRows"]
    row_ctx = winner["rowCtx"]

    excluded_cols = set(params.get("excludedCols") or [])
    cand_cols = [c for c, t in csv.column_types.items() if t == "decision" and c not in excluded_cols]
    cand_views = []
    for col in cand_cols:
        idx = csv.headers.index(col) if col in csv.headers else -1
        view = csv.view(idx, trim=True)
        cand_views.append(view if view is not None else ([""], np.zeros(csv.row_count, dtype=np.int64)))

    bins_by_cand = [_bins_for_rows(csv, cand_views[ci], scope_rows, metric_rows)
                    for ci in range(len(cand_cols))]

    scope_den = metric_den(scope_agg, spec)
    global_rate = metric_rate(scope_agg, spec)
    shrink_k = max(1.0, scope_den * 0.02)
    min_qty = params.get("minQty")
    if min_qty is None:
        min_qty = max(200, js_round(scope_agg["qty"] * 0.001))
    diagnostics = {"candidatesTested": 0,
                   "discarded": {"lowVolume": 0, "notSignificant": 0, "unstable": 0,
                                 "duplicate": 0, "noOpportunity": 0}}

    def quality(agg):
        den = metric_den(agg, spec)
        if den <= 0 or global_rate is None:
            return 0.0
        shrunk = (metric_num(agg, spec) + global_rate * shrink_k) / (den + shrink_k)
        share = den / scope_den if scope_den > 0 else 0.0
        return share * abs(shrunk - global_rate)

    def sig_of(conds):
        return " & ".join(sorted(("%s=%s" % (c["col"], c["value"]) for c in conds), key=_u16key))

    candidates = []
    seen_sig = set()
    beam = []
    for ci in range(len(cand_cols)):
        for bin_ in bins_by_cand[ci].values():
            if bin_["agg"]["qty"] < min_qty:
                diagnostics["discarded"]["lowVolume"] += 1
                continue
            conds = [{"col": cand_cols[ci], "ci": ci, "value": bin_["value"]}]
            seg = {"conds": conds, "usedCi": {ci}, "agg": bin_["agg"], "rows": bin_["rows"]}
            sig = sig_of(conds)
            if sig not in seen_sig:
                seen_sig.add(sig)
                candidates.append(dict(kind="deviation", **seg))
            beam.append(dict(q=quality(bin_["agg"]), **seg))
    beam.sort(key=lambda b: (-b["q"], _u16key(sig_of(b["conds"]))))
    beam = beam[:beam_width]

    depth = 2
    while depth <= max_depth:
        nxt = []
        for parent in beam:
            for ci in range(len(cand_cols)):
                if ci in parent["usedCi"]:
                    continue
                sub = _bins_for_rows(csv, cand_views[ci], parent["rows"], metric_rows)
                for b in sub.values():
                    if b["agg"]["qty"] < min_qty:
                        diagnostics["discarded"]["lowVolume"] += 1
                        continue
                    conds = parent["conds"] + [{"col": cand_cols[ci], "ci": ci, "value": b["value"]}]
                    sig = sig_of(conds)
                    seg = {"conds": conds, "usedCi": set(parent["usedCi"]) | {ci},
                           "agg": b["agg"], "rows": b["rows"]}
                    if sig not in seen_sig:
                        seen_sig.add(sig)
                        candidates.append(dict(kind="deviation", **seg))
                    nxt.append(dict(q=quality(b["agg"]), **seg))
        nxt.sort(key=lambda b: (-b["q"], _u16key(sig_of(b["conds"]))))
        beam = nxt[:beam_width]
        depth += 1

    scope_disp = _dispersion(scope_rows, row_ctx)

    if scope_disp["currentDecision"] not in ("mixed", "undecided"):
        het_cols = []
        for ci, col in enumerate(cand_cols):
            bins = [{"altas": metric_den(b["agg"], spec), "maus": metric_num(b["agg"], spec)}
                    for b in bins_by_cand[ci].values()]
            bins = [b for b in bins if b["altas"] > 0]
            iv = compute_iv(bins) if len(bins) >= 2 else None
            if iv is not None and math.isfinite(iv):
                het_cols.append({"col": col, "iv": iv})
        het_cols.sort(key=lambda h: (-h["iv"], _u16key(h["col"])))
        if het_cols and het_cols[0]["iv"] >= SEG_HET_MIN_IV:
            candidates.append({"kind": "het", "conds": [], "agg": scope_agg,
                               "rows": scope_rows, "hetCols": het_cols})

    return {
        "scope": scope_label, "empty": False,
        "population": {"qty": scope_agg["qty"], "decidedQty": scope_disp["decidedQty"]},
        "candidates": candidates,
        "ctx": {
            "spec": spec, "csv": csv, "csvId": winner["csvId"],
            "scopeAgg": scope_agg, "scopeRows": scope_rows, "rowCtx": row_ctx,
            "candCols": cand_cols, "candViews": cand_views, "binsByCand": bins_by_cand,
            "globalRate": global_rate, "scopeDen": scope_den, "SHRINK_K": shrink_k,
            "minQty": min_qty, "shapeById": shape_by_id, "nodeIndex": node_index,
            "scopeDisp": scope_disp, "diagnostics": diagnostics,
            "rootId": winner["rootId"], "scopeNodeId": scope_node_id,
            "dOrigIdx": winner["dOrigIdx"], "metricRows": metric_rows,
        },
    }


# ── Estágio 2 — explainSegment ───────────────────────────────────────────────────


def explain_segment(cand, ctx):
    spec = ctx["spec"]
    scope_agg = ctx["scopeAgg"]
    seg_agg = cand["agg"]
    compl_agg = seg_sub_agg(scope_agg, seg_agg)
    seg_rate = metric_rate(seg_agg, spec)
    ref_rate = metric_rate(compl_agg, spec)
    lift = (seg_rate / ref_rate) if (seg_rate is not None and ref_rate is not None and ref_rate > 0) else None
    dispersion = _dispersion(cand["rows"], ctx["rowCtx"])

    metrics = {
        "qty": seg_agg["qty"],
        "share": seg_agg["qty"] / scope_agg["qty"] if scope_agg["qty"] > 0 else 0,
        "qtdAltas": seg_agg["qtdAltas"], "qtdAltasInfer": seg_agg["qtdAltasInfer"],
        "inadReal": inad_real(seg_agg), "inadInferida": inad_inferida(seg_agg),
        "refInadReal": inad_real(compl_agg), "refInadInferida": inad_inferida(compl_agg),
        "lift": lift, "currentDecision": dispersion["currentDecision"],
    }

    conditions = [{"col": c["col"], "operator": "equal", "value": c["value"],
                   "logic": "AND", "csvId": ctx["csvId"]} for c in cand["conds"]]
    joined = "&".join("%s=%s" % (c["col"], c["value"]) for c in conditions)
    fid = "%s:%s" % ("het" if cand["kind"] == "het" else "seg", joined or "(escopo)")

    if cand["kind"] == "het":
        total_iv = sum(abs(h["iv"]) for h in cand["hetCols"]) or 1
        contributions = [{"col": h["col"], "value": None,
                          "sharePct": (abs(h["iv"]) / total_iv) * 100}
                         for h in cand["hetCols"][:4]]
        return {
            "id": fid, "code": "heterogeneous_block", "_kind": "het",
            "segment": {"conditions": conditions, "scope": ctx.get("scope")},
            "metrics": metrics,
            "explanation": {"contributions": contributions, "dispersion": dispersion,
                            "stability": None, "pValue": None, "qValue": None},
            "_raw": {"deviation": cand["hetCols"][0]["iv"],
                     "segDen": metric_den(seg_agg, spec), "splitCol": cand["hetCols"][0]["col"]},
        }

    p0 = ref_rate if (ref_rate is not None and 0 < ref_rate < 1) else ctx["globalRate"]
    seg_num = metric_num(seg_agg, spec)
    seg_den = metric_den(seg_agg, spec)
    p_value = seg_binom_two_sided(seg_num, seg_den, p0) if (seg_den > 0 and p0 is not None) else 1

    total_num = metric_num(scope_agg, spec)
    total_den = metric_den(scope_agg, spec)
    woes = []
    for c in cand["conds"]:
        bin_ = ctx["binsByCand"][c["ci"]].get(c["value"])
        w = seg_woe(metric_num(bin_["agg"], spec), metric_den(bin_["agg"], spec),
                    total_num, total_den) if bin_ else None
        woes.append({"col": c["col"], "value": c["value"],
                     "woe": 0 if (w is None or not math.isfinite(w)) else w})
    sum_abs = sum(abs(w["woe"]) for w in woes)
    contributions = [{"col": w["col"], "value": w["value"],
                      "sharePct": (abs(w["woe"]) / sum_abs) * 100 if sum_abs > 0 else 100 / len(woes)}
                     for w in woes]

    direction = spec["direction"]
    ratio_good = SEGMENT_LOW_RATIO if direction == "lower" else SEGMENT_HIGH_RATIO
    ratio_bad = SEGMENT_HIGH_RATIO if direction == "lower" else SEGMENT_LOW_RATIO
    strong_good = lift is not None and (lift <= ratio_good if direction == "lower" else lift >= ratio_good)
    strong_bad = lift is not None and (lift >= ratio_bad if direction == "lower" else lift <= ratio_bad)
    code = None
    if dispersion["currentDecision"] == "rejected" and strong_good:
        code = "approvable_low_risk"
    elif dispersion["currentDecision"] == "approved" and strong_bad:
        code = "approved_high_risk"

    return {
        "id": fid, "code": code, "_kind": "deviation",
        "segment": {"conditions": conditions, "scope": ctx.get("scope")},
        "metrics": metrics,
        "explanation": {"contributions": contributions, "dispersion": dispersion,
                        "stability": None, "pValue": p_value, "qValue": None},
        "_raw": {"deviation": (seg_rate - ref_rate) if (seg_rate is not None and ref_rate is not None) else 0,
                 "segRate": seg_rate, "refRate": ref_rate, "segDen": seg_den,
                 "segNum": seg_num, "share": metrics["share"]},
    }


# ── Estágio 3 — prioritizeFindings ───────────────────────────────────────────────


def prioritize_findings(explained, ctx, params):
    a = params.get("alpha")
    alpha = a if a is not None else SEG_DEFAULT_ALPHA
    mf = params.get("maxFindings")
    max_findings = mf if mf is not None else SEG_DEFAULT_MAX_FINDINGS
    diagnostics = ctx["diagnostics"]
    shrink_k = ctx["SHRINK_K"]

    deviation = [f for f in explained if f["_kind"] == "deviation"]
    het = [f for f in explained if f["_kind"] == "het"]
    diagnostics["candidatesTested"] = len(deviation)

    qvals = seg_benjamini_hochberg([f["explanation"]["pValue"] for f in deviation])
    for f, q in zip(deviation, qvals):
        f["explanation"]["qValue"] = q

    kept = []
    for f in deviation:
        if f["explanation"]["qValue"] > alpha:
            diagnostics["discarded"]["notSignificant"] += 1
            continue
        if not f["code"]:
            diagnostics["discarded"]["noOpportunity"] += 1
            continue
        kept.append(f)
    kept.extend(het)

    locked_nodes = set(ctx.get("lockedIds") or [])
    locked_idx = {ctx["nodeIndex"][nid] for nid in locked_nodes if nid in ctx["nodeIndex"]}
    terminal, res, deciding, qtyv = ctx["rowCtx"]

    def is_locked(f):
        if not locked_idx:
            return False
        rows = _seg_rows_of(f, ctx)
        dn = deciding[rows]
        return bool(np.any(np.isin(dn, list(locked_idx))))

    for f in kept:
        seg_den = f["_raw"].get("segDen") or 0
        moved_qty = f["metrics"]["qty"]
        dev = abs(f["_raw"].get("deviation") or 0)
        impact_scalar = moved_qty * dev
        shrink_factor = seg_den / (seg_den + shrink_k)
        if f["_kind"] == "het":
            confidence = shrink_factor * min(1, f["_raw"].get("deviation") or 0)
        else:
            confidence = (1 - (f["explanation"]["qValue"] if f["explanation"]["qValue"] is not None else 1)) * shrink_factor
        n_conds = len(f["segment"]["conditions"])
        depth_penalty = 1 / (1 + max(0, n_conds - 1) * SEG_ACTION_DEPTH_PENALTY)
        locked = is_locked(f)
        actionability = depth_penalty * (SEG_LOCKED_PENALTY if locked else 1)
        f["locked"] = locked
        f["priority"] = {
            "score": impact_scalar * confidence * actionability,
            "impact": {"deltaApproval": None,
                       "deltaInadInf": f["_raw"].get("deviation"), "movedQty": moved_qty},
            "confidence": confidence, "actionability": actionability,
        }
        f["recommendation"] = None

    kept.sort(key=lambda f: (-f["priority"]["score"], _u16key(f["id"])))

    final = []
    for f in kept:
        f_set = {"%s=%s" % (c["col"], c["value"]) for c in f["segment"]["conditions"]}
        dup = False
        if f["_kind"] == "deviation":
            for p in final:
                if p["_kind"] != "deviation":
                    continue
                p_set = {"%s=%s" % (c["col"], c["value"]) for c in p["segment"]["conditions"]}
                if len(p_set) == 0 or len(p_set) >= len(f_set):
                    continue
                if p_set.issubset(f_set) and abs(f["_raw"].get("deviation") or 0) <= abs(p["_raw"].get("deviation") or 0) * (1 + SEG_MIN_INCREMENTAL_DEV):
                    dup = True
                    break
        if dup:
            diagnostics["discarded"]["duplicate"] += 1
            continue
        final.append(f)

    findings = []
    for f in final[:max_findings]:
        pub = {k: v for k, v in f.items() if k not in ("_raw", "_kind")}
        pub["_kind"] = f["_kind"]  # interno; removido na saída do modelo
        findings.append(pub)
    return findings, diagnostics


# ── asis_divergence / anomaly / estabilidade ─────────────────────────────────────


def detect_asis_divergence(ctx):
    csv = ctx["csv"]
    d_orig_idx = ctx["dOrigIdx"]
    if d_orig_idx < 0:
        return [], {"rToA": 0, "aToR": 0}
    terminal, res, deciding, qtyv = ctx["rowCtx"]
    scope_rows = ctx["scopeRows"]
    view = csv.view(d_orig_idx, trim=False)
    vals, codes = view
    per_code = np.zeros(len(vals), dtype=np.int8)  # 1 APROVADO, 2 REPROVADO
    for k, v in enumerate(vals):
        u = str(v).upper()
        per_code[k] = 1 if u == "APROVADO" else 2 if u == "REPROVADO" else 0
    orig = per_code[codes[scope_rows]] if len(vals) else np.zeros(scope_rows.size, dtype=np.int8)
    res_s = res[scope_rows]
    q_s = qtyv[scope_rows]
    is_r2a = (orig == 2) & (res_s == 1)
    is_a2r = (orig == 1) & (res_s == 2)
    tot_r2a = seq_sum(q_s[is_r2a])
    tot_a2r = seq_sum(q_s[is_a2r])
    total_impacted = tot_r2a + tot_a2r
    findings = []
    if total_impacted > 0:
        impacted = is_r2a | is_a2r
        imp_rows_pos = np.flatnonzero(impacted)
        for ci, col in enumerate(ctx["candCols"]):
            vals_c, codes_c = ctx["candViews"][ci]
            sub_codes = codes_c[scope_rows[imp_rows_pos]]
            if sub_codes.size == 0:
                continue
            uniq, first_idx = np.unique(sub_codes, return_index=True)
            order = np.argsort(first_idx, kind="stable")
            uniq_ordered = uniq[order]
            for code_v in uniq_ordered:
                value = vals_c[code_v]
                sel = imp_rows_pos[sub_codes == code_v]
                b_r2a = seq_sum(q_s[sel[is_r2a[sel]]])
                b_a2r = seq_sum(q_s[sel[is_a2r[sel]]])
                b_qty = seq_sum(q_s[sel])
                share = (b_r2a + b_a2r) / total_impacted
                if share < SEG_ASIS_MIN_SHARE or b_qty < ctx["minQty"]:
                    continue
                conditions = [{"col": col, "operator": "equal", "value": value,
                               "logic": "AND", "csvId": ctx["csvId"]}]
                findings.append({
                    "id": "asis:%s=%s" % (col, value), "code": "asis_divergence",
                    "segment": {"conditions": conditions, "scope": ctx.get("scope")},
                    "metrics": {
                        "qty": b_qty,
                        "share": b_qty / ctx["scopeAgg"]["qty"] if ctx["scopeAgg"]["qty"] > 0 else 0,
                        "rToA": b_r2a, "aToR": b_a2r,
                        "rToAShare": b_r2a / tot_r2a if tot_r2a > 0 else 0,
                        "aToRShare": b_a2r / tot_a2r if tot_a2r > 0 else 0,
                        "currentDecision": None, "lift": None,
                        "inadReal": None, "inadInferida": None,
                    },
                    "explanation": {"contributions": [], "dispersion": None,
                                    "stability": None, "pValue": None, "qValue": None},
                    "priority": {"score": b_r2a + b_a2r,
                                 "impact": {"movedQty": b_r2a + b_a2r},
                                 "confidence": 1, "actionability": 1},
                    "recommendation": None,
                    "_sortKey": b_r2a + b_a2r,
                })
        findings.sort(key=lambda f: (-f["_sortKey"], _u16key(f["id"])))
        for f in findings:
            del f["_sortKey"]
    return findings, {"rToA": tot_r2a, "aToR": tot_a2r}


def _median(arr):
    if not arr:
        return None
    s = sorted(arr)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def detect_anomalies(ctx):
    csv = ctx["csv"]
    spec = ctx["spec"]
    min_qty = ctx["minQty"]
    findings = []

    def scan_bins(col, entries, temporal):
        rated = []
        for value, agg in entries:
            rate = metric_rate(agg, spec)
            if rate is None or agg["qty"] < min_qty:
                continue
            rated.append({"value": value, "rate": rate, "qty": agg["qty"]})
        if len(rated) < SEG_ANOMALY_MIN_VALUES:
            return
        rates = [o["rate"] for o in rated]
        med = _median(rates)
        mad = _median([abs(o["rate"] - med) for o in rated])
        if mad is None or mad <= 0:
            return
        for o in rated:
            z = 0.6745 * (o["rate"] - med) / mad
            if abs(z) < SEG_ANOMALY_Z:
                continue
            conditions = [{"col": col, "operator": "equal", "value": o["value"],
                           "logic": "AND", "csvId": ctx["csvId"]}]
            findings.append({
                "id": "anomaly:%s%s=%s" % ("safra:" if temporal else "", col, o["value"]),
                "code": "anomaly",
                "segment": {"conditions": conditions, "scope": ctx.get("scope")},
                "metrics": {
                    "qty": o["qty"],
                    "share": o["qty"] / ctx["scopeAgg"]["qty"] if ctx["scopeAgg"]["qty"] > 0 else 0,
                    "rate": o["rate"], "median": med, "mad": mad, "z": z,
                    "temporal": bool(temporal),
                    "currentDecision": None, "lift": None,
                    "inadReal": None, "inadInferida": None,
                },
                "explanation": {"contributions": [], "dispersion": None,
                                "stability": None, "pValue": None, "qValue": None},
                "priority": {"score": abs(z) * o["qty"], "impact": {"movedQty": o["qty"]},
                             "confidence": 1, "actionability": 0},
                "recommendation": None,
                "_sortKey": abs(z) * o["qty"],
            })

    for ci, col in enumerate(ctx["candCols"]):
        scan_bins(col, [(v, b["agg"]) for v, b in ctx["binsByCand"][ci].items()], False)

    temporal_col = None
    for cname, t in csv.column_types.items():
        if t == "temporal":
            temporal_col = cname
            break
    if temporal_col:
        t_idx = csv.headers.index(temporal_col) if temporal_col in csv.headers else -1
        view = csv.view(t_idx, trim=True)
        if view is not None:
            bins = _bins_for_rows(csv, view, ctx["scopeRows"], ctx["metricRows"])
            scan_bins(temporal_col, [(v, b["agg"]) for v, b in bins.items()], True)

    findings.sort(key=lambda f: (-f["_sortKey"], _u16key(f["id"])))
    for f in findings:
        del f["_sortKey"]
    return findings


def attach_stability(findings, ctx):
    csv = ctx["csv"]
    spec = ctx["spec"]
    temporal_col = None
    for cname, t in csv.column_types.items():
        if t == "temporal":
            temporal_col = cname
            break
    if not temporal_col:
        return
    t_idx = csv.headers.index(temporal_col) if temporal_col in csv.headers else -1
    view = csv.view(t_idx, trim=True)
    if view is None:
        return
    t_vals, t_codes = view
    scope_rows = ctx["scopeRows"]
    scope_tcodes = t_codes[scope_rows]

    # buckets = distintos entre as linhas do escopo NA ORDEM DE 1ª APARIÇÃO (o Set do
    # JS preserva inserção), ordenados pelo comparador do JS (numérico quando ambos
    # parseiam; senão segStrCmp). Comparador misto é documentadamente não transitivo
    # com chaves heterogêneas — Timsort dos dois lados sobre a MESMA ordem inicial.
    uniq, first_idx = np.unique(scope_tcodes, return_index=True)
    keys = [t_vals[c] for c in uniq[np.argsort(first_idx, kind="stable")]]

    def _cmp(a, b):
        na, nb = js_parse_float(a), js_parse_float(b)
        if not (math.isnan(na) or math.isnan(nb)):
            return -1 if na < nb else (1 if na > nb else 0)
        return seg_str_cmp(a, b)

    buckets = sorted(keys, key=cmp_to_key(_cmp))
    if len(buckets) < 2:
        return
    half = math.ceil(len(buckets) / 2)
    first_half = set(buckets[:half])
    bucket_pos = {b: i for i, b in enumerate(buckets)}
    row_bucket = np.array([bucket_pos.get(t_vals[c], -1) for c in range(len(t_vals))], dtype=np.int64)
    scope_bucket = row_bucket[scope_tcodes]
    first_mask = np.array([t_vals[c] in first_half for c in range(len(t_vals))], dtype=bool)[scope_tcodes]

    metric_rows = ctx["metricRows"]
    for f in findings:
        if f.get("code") in ("anomaly", "asis_divergence", "heterogeneous_block"):
            continue
        if not (f["segment"]["conditions"] or []):
            continue
        rows = _seg_rows_of(f, ctx)
        if rows.size == 0:
            continue
        in_seg = np.isin(scope_rows, rows, assume_unique=True)
        agg = {}
        for name, mask in (("aggA", in_seg & first_mask), ("aggB", in_seg & ~first_mask),
                           ("complA", ~in_seg & first_mask), ("complB", ~in_seg & ~first_mask)):
            agg[name] = {k: seq_sum(metric_rows[k][scope_rows[mask]]) for k in METRIC_KEYS}
        n_buckets = len(buckets)
        series = {}
        seg_bucket = scope_bucket[in_seg]
        seg_scope_rows = scope_rows[in_seg]
        for k in METRIC_KEYS:
            series[k] = _bincount_seq(seg_bucket, metric_rows[k][seg_scope_rows], n_buckets)
        seg_has = np.bincount(seg_bucket, minlength=n_buckets) > 0

        def dev_of(seg_agg, compl_agg):
            sr = metric_rate(seg_agg, spec)
            rr = metric_rate(compl_agg, spec)
            return (sr - rr) if (sr is not None and rr is not None) else None

        d_a = dev_of(agg["aggA"], agg["complA"])
        d_b = dev_of(agg["aggB"], agg["complB"])

        def sign(x):
            return (x > 0) - (x < 0)

        holds = d_a is not None and d_b is not None and sign(d_a) == sign(d_b) and d_a != 0
        f["explanation"]["stability"] = {"split": "temporal", "holds": bool(holds)}
        s_list = []
        for i, bk in enumerate(buckets):
            if seg_has[i]:
                b_agg = {k: float(series[k][i]) for k in METRIC_KEYS}
                s_list.append({"bucket": bk, "rate": metric_rate(b_agg, spec)})
            else:
                s_list.append({"bucket": bk, "rate": None})
        f["explanation"]["stabilitySeries"] = s_list


# ── Ponto de entrada — segBuildModelWithoutRecs em Python ────────────────────────


def _now_iso():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + \
        "%03dZ" % (datetime.datetime.now(datetime.timezone.utc).microsecond // 1000)


def compute_segment_model(store_raw, shapes, conns, scope, params, progress_cb=None):
    """SegmentModel SEM recomendações (≡ segBuildModelWithoutRecs do worker JS).
    `store_raw` é o JSON do serializeCsvStore (M3); `shapes`/`conns`/`scope`/`params`
    são os mesmos payloads de COMPUTE_SEGMENT_DISCOVERY."""
    params = params or {}
    shapes = shapes or []
    conns = conns or []
    if progress_cb:
        progress_cb(0.1)
    store = {csv_id: Csv(raw or {}) for csv_id, raw in (store_raw or {}).items()}
    spec = resolve_risk_metric(params.get("riskMetric") or "inadReal")
    disc = discover_segments(shapes, conns, store, scope, spec, params)
    if progress_cb:
        progress_cb(0.55)
    if disc["empty"]:
        return {
            "version": "1.0", "generatedAt": _now_iso(),
            "scope": disc["scope"], "population": disc["population"], "findings": [],
            "diagnostics": {"candidatesTested": 0,
                            "discarded": {"lowVolume": 0, "notSignificant": 0, "unstable": 0,
                                          "duplicate": 0, "noOpportunity": 0}},
        }
    ctx = disc["ctx"]
    ctx["scope"] = disc["scope"]
    ctx["lockedIds"] = [s["id"] for s in shapes if s.get("locked")]
    explained = [explain_segment(c, ctx) for c in disc["candidates"]]
    findings, diagnostics = prioritize_findings(explained, ctx, params)
    if progress_cb:
        progress_cb(0.75)

    asis_findings, asis_totals = detect_asis_divergence(ctx)
    anomalies = detect_anomalies(ctx)
    all_findings = findings + asis_findings + anomalies
    attach_stability(all_findings, ctx)
    for f in all_findings:
        f.pop("_kind", None)
    if progress_cb:
        progress_cb(0.95)

    return {
        "version": "1.0", "generatedAt": _now_iso(),
        "scope": disc["scope"], "population": disc["population"],
        "metric": {"id": spec["id"], "label": spec["label"], "direction": spec["direction"]},
        "findings": all_findings, "diagnostics": diagnostics,
        "asIsTotals": asis_totals,
    }
