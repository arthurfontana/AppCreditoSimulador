# -*- coding: utf-8 -*-
"""
motor_clusters.py — Clusterização de Segmentos no Motor Python (Execução Híbrida H8).

Port NUMPY (tier full) do baseline de clusterização do worker JS
(`computeClusterSegments` em src/simulation.worker.js): agregação da base pelas
dimensões Filtro selecionadas (grupo = tupla de valores, em ordem de 1ª aparição),
features de taxa por grupo (aprovação AS IS, inad. real, inad. inferida) padronizadas
z-score, e k-means (Lloyd) com inicialização k-means++ sobre PRNG ESPECIFICADO
(mulberry32, seed derivada de dataset + params). É o MESMO algoritmo determinístico —
mesma seed ⇒ mesmo ClusterModel número a número — só que vetorizado e SEM os tetos
declarados do browser (dims/k/nº de pontos).

CONTRATO DE PARIDADE (DEC-HX-005 — GATE cross-runtime bloqueante):
  · fixtures douradas em tests/fixtures/golden/cluster_segments_*.json (geradas pelo
    Vitest de tests/clusterSegmentsGolden.test.js, consumidas pelo pytest de
    tests_python/test_cluster_segments.py);
  · toda soma de float replica a ORDEM SEQUENCIAL do JS (np.cumsum/np.bincount, nunca
    np.sum pairwise); TODA a matemática do k-means é racional + sqrt (IEEE, bit-exata
    nos dois runtimes) — nenhum transcendental no caminho do GATE;
  · desempates de ordenação por code units UTF-16 (segStrCmp ↔ encode('utf-16-be'));
  · mulberry32 replicado com máscara & 0xFFFFFFFF (≡ Math.imul / ops int32 do JS).

EXTRAS sklearn (DEC-HX-004 — declarados por pacote, nunca gate do tier, carregados
LAZY no primeiro job que os usa): silhueta para k automático (`params.autoK`) e
hierárquico (ward) como método alternativo (`params.method == 'hierarchical'`). Os
extras NUNCA entram no GATE dourado — sklearn ausente ⇒ o job degrada ao k-means
determinístico com nota declarada (`quality.note`), nunca erro.

Reusa a infraestrutura de decodificação/semântica JS do motor_segmentos.py (mesma
pasta): Csv (store M3 → colunas), views trimadas com merge, seq_sum/_bincount_seq,
chave UTF-16.
"""
import base64
import datetime
import importlib.util
import os
import sys

import numpy as np

# ── Reuso do motor_segmentos (Csv/seq_sum/etc.) — mesma pasta, carga idempotente ──
if "motor_segmentos" in sys.modules:
    _seg = sys.modules["motor_segmentos"]
else:
    _here = os.path.dirname(os.path.abspath(__file__))
    _spec = importlib.util.spec_from_file_location(
        "motor_segmentos", os.path.join(_here, "motor_segmentos.py"))
    _seg = importlib.util.module_from_spec(_spec)
    sys.modules["motor_segmentos"] = _seg
    _spec.loader.exec_module(_seg)

Csv = _seg.Csv
seq_sum = _seg.seq_sum
_bincount_seq = _seg._bincount_seq
_u16key = _seg._u16key

# ── Constantes (espelho 1:1 de src/simulation.worker.js) ─────────────────────────
CLUSTER_DEFAULT_K = 4
CLUSTER_MAX_ITER = 100
CLUSTER_METRIC_TYPES = {"qty", "qtdAltas", "qtdAltasInfer", "inadReal", "inadInferida"}

_M32 = 0xFFFFFFFF


def _fnv1a32_utf16(s):
    """FNV-1a 32-bit sobre CODE UNITS UTF-16 (≡ charCodeAt do JS)."""
    h = 0x811C9DC5
    for unit in memoryview(str(s).encode("utf-16-le", "surrogatepass")).cast("H"):
        h ^= unit
        h = (h * 0x01000193) & _M32
    return h


def cluster_seed_of(csv_id, dims, k, feature_ids, n_rows, scope_node_id=None):
    """Seed derivada do dataset + params (§16) — espelho de clusterSeedOf (worker).
    DEC-FR-001: o escopo por nó entra na seed APENAS quando presente (global = seed
    atual, fixtures douradas H8 intactas)."""
    parts = [
        str(csv_id), "\x1f".join(dims), str(k), "\x1f".join(feature_ids), str(n_rows),
    ]
    if scope_node_id is not None:
        parts.append("scope:" + str(scope_node_id))
    return _fnv1a32_utf16("\x1e".join(parts))


def mulberry32(seed):
    """PRNG especificado (§16) — bit-idêntico ao clusterMulberry32 do worker:
    aritmética modular de 32 bits (máscara ≡ Math.imul / |0 / >>> do JS)."""
    state = {"a": seed & _M32}

    def rand():
        a = (state["a"] + 0x6D2B79F5) & _M32
        state["a"] = a
        t = ((a ^ (a >> 15)) * (a | 1)) & _M32
        t = (((t + (((t ^ (t >> 7)) * (t | 61)) & _M32)) & _M32) ^ t) & _M32
        return ((t ^ (t >> 14)) & _M32) / 4294967296.0

    return rand


# ── Helpers de dataset ────────────────────────────────────────────────────────────


def _decision_codes(csv):
    """Decisão AS IS por linha: 1 APROVADO · 2 REPROVADO · 0 outro — uppercase do
    valor CRU de __DECISAO_ORIGINAL (mesma semântica de runSimulation). None sem a
    coluna."""
    if "__DECISAO_ORIGINAL" not in csv.headers:
        return None
    idx = csv.headers.index("__DECISAO_ORIGINAL")
    col = csv.col_at(idx)
    if col is None:
        return None
    if col.kind == "dict":
        per = np.zeros(max(1, len(col.dict)), dtype=np.int8)
        for k, v in enumerate(col.dict):
            u = str(v if v is not None else "").upper()
            per[k] = 1 if u == "APROVADO" else 2 if u == "REPROVADO" else 0
        return per[col.codes] if len(col.dict) else np.zeros(csv.row_count, dtype=np.int8)
    # coluna numérica jamais formata 'APROVADO' — decisão 0 em toda linha (== JS).
    return np.zeros(csv.row_count, dtype=np.int8)


def _has_metric_col(csv, col_type):
    for name, t in csv.column_types.items():
        if t == col_type and name in csv.headers:
            return True
    return False


def _group_rows(csv, dims_idx, in_rows=None):
    """Grupo = tupla de valores TRIMADOS das dims, ids em ordem de 1ª aparição na
    base (≡ Map de inserção do JS). Devolve (gid_por_linha, tuplas_por_grupo).

    DEC-FR-003 — escopo por nó: `in_rows` (índices ASCENDENTES das linhas no escopo)
    restringe a formação e a ordenação dos grupos à subpopulação. Sem ele (global), o
    caminho é byte-idêntico ao anterior. `gid_row` fica na dimensão das linhas
    consideradas (n global ou len(in_rows) escopado)."""
    views = [csv.view(i, trim=True) for i in dims_idx]
    gid = views[0][1].astype(np.int64, copy=True)
    for d in range(1, len(views)):
        vals_d, codes_d = views[d]
        gid = gid * max(1, len(vals_d)) + codes_d
        _u, gid = np.unique(gid, return_inverse=True)  # densifica (evita overflow)
    if in_rows is not None:
        gid = gid[in_rows]  # só as linhas do escopo formam grupo (ordem preservada)
    uniq, first, inv = np.unique(gid, return_index=True, return_inverse=True)
    order = np.argsort(first, kind="stable")
    rank = np.empty(len(uniq), dtype=np.int64)
    rank[order] = np.arange(len(uniq))
    gid_row = rank[inv]
    first_rows = first[order]
    tuples = []
    for g in range(len(uniq)):
        # `first[g]` indexa a sequência considerada (subset do escopo quando in_rows);
        # mapeia de volta à linha real da base para ler o valor da tupla.
        r0 = int(in_rows[int(first_rows[g])]) if in_rows is not None else int(first_rows[g])
        tuples.append([views[d][0][int(views[d][1][r0])] for d in range(len(views))])
    return gid_row, tuples


def _dist2_to(X, c):
    """Distância² de todos os pontos ao centroide c — acumulada POR FEATURE na ordem
    canônica (≡ loop interno do JS, elemento a elemento)."""
    acc = np.zeros(len(X[0]), dtype=np.float64)
    for f in range(len(X)):
        diff = X[f] - c[f]
        acc = acc + diff * diff
    return acc


def _kmeans(X, w, k_eff, seed, max_iter):
    """k-means Lloyd + init k-means++ ponderado — espelho exato de cluKmeans (worker):
    empate de atribuição no MENOR índice; cluster vazio mantém o centroide anterior;
    peso total zero num cluster com pontos ⇒ média não ponderada."""
    n_f, n_p = len(X), len(w)
    rand = mulberry32(seed)
    chosen = set()
    centroids = []

    def pick_weighted(weights):
        total = seq_sum(weights)
        if total > 0:
            target = rand() * total
            cum = np.cumsum(np.asarray(weights, dtype=np.float64))
            idx = int(np.searchsorted(cum, target, side="right"))
            return min(idx, n_p - 1)
        for i in range(n_p):
            if i not in chosen:
                return i
        return 0

    first = pick_weighted(w)
    chosen.add(first)
    centroids.append(np.array([X[f][first] for f in range(n_f)], dtype=np.float64))
    d2 = _dist2_to(X, centroids[0])
    while len(centroids) < k_eff:
        idx = pick_weighted(w * d2)
        chosen.add(idx)
        c = np.array([X[f][idx] for f in range(n_f)], dtype=np.float64)
        centroids.append(c)
        d2 = np.minimum(d2, _dist2_to(X, c))

    C = np.stack(centroids)
    n_c = len(C)

    def assign_all():
        dmat = np.empty((n_p, n_c), dtype=np.float64)
        for c in range(n_c):
            dmat[:, c] = _dist2_to(X, C[c])
        return np.argmin(dmat, axis=1).astype(np.int64)  # 1ª ocorrência do mínimo (== JS `<`)

    def update(assign):
        wsum = _bincount_seq(assign, w, n_c)
        cnt = np.bincount(assign, minlength=n_c)
        # cluster vazio (cnt==0) mantém o centroide anterior — C[c] fica intocado
        for f in range(n_f):
            sums_f = _bincount_seq(assign, w * X[f], n_c)
            usums_f = _bincount_seq(assign, X[f], n_c)
            for c in range(n_c):
                if cnt[c] == 0:
                    continue
                C[c, f] = sums_f[c] / wsum[c] if wsum[c] > 0 else usums_f[c] / cnt[c]

    assign = assign_all()
    iterations, converged = 0, False
    for it in range(max_iter):
        iterations = it + 1
        update(assign)
        prev = assign
        assign = assign_all()
        if np.array_equal(assign, prev):
            converged = True
            break

    Cg = C[assign]
    acc = np.zeros(n_p, dtype=np.float64)
    for f in range(n_f):
        diff = X[f] - Cg[:, f]
        acc = acc + diff * diff
    inertia = seq_sum(w * acc)
    return assign, C, iterations, converged, inertia


def _maybe_sklearn():
    try:
        import sklearn  # noqa: F401
        return True
    except Exception:
        return False


def _silhouette(X, labels):
    """Silhueta média (extra sklearn) — None quando indefinida (1 cluster, cluster
    único ocupado, n<3…)."""
    try:
        from sklearn.metrics import silhouette_score
        mat = np.stack(X, axis=1)
        if len(set(int(v) for v in labels)) < 2 or mat.shape[0] < 3:
            return None
        return float(silhouette_score(mat, labels))
    except Exception:
        return None


def _now_iso():
    now = datetime.datetime.now(datetime.timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (now.microsecond // 1000)


# ── Ponto de entrada ─────────────────────────────────────────────────────────────


def compute_cluster_model(store_raw, params, progress_cb=None):
    """Espelho de computeClusterSegments (worker JS) — SEM clamp de tetos (o clamp é
    papel do handler browser; aqui é o executor sem limites). Extras sklearn só
    quando explicitamente pedidos (autoK/method)."""
    params = params or {}

    def _progress(p):
        if progress_cb:
            progress_cb(p)

    model = {
        "version": "1.0", "generatedAt": _now_iso(), "error": None,
        "dataset": None, "params": None, "ceilings": None, "population": None,
        "features": [], "clusters": [], "quality": None,
    }

    # ── Escopo por nó no MODO PROFUNDO (DEC-FR-003) ────────────────────────────
    # O walk de política JAMAIS é portado ao Python: recebemos SÓ a máscara de linhas
    # (bitmask little-endian base64 em `params.rowMask`, resolvida no worker) + o
    # `params.scope` para o rótulo e o componente de seed. `model.scope` é campo aditivo
    # (só existe quando escopado — espelho do worker, fixtures douradas globais intactas).
    scope = params.get("scope")
    scope_node_id = scope.get("nodeId") if isinstance(scope, dict) and scope.get("nodeId") else None
    if scope_node_id is not None:
        model["scope"] = {"nodeId": scope_node_id, "label": scope.get("label")}

    store_raw = store_raw or {}
    csvs = {cid: Csv(raw or {}) for cid, raw in store_raw.items()}
    csv_id = params.get("csvId") if params.get("csvId") in csvs else None
    if csv_id is None:
        best = -1
        for cid, csv in csvs.items():
            if csv.row_count > best:
                best, csv_id = csv.row_count, cid
    csv = csvs.get(csv_id)
    n_rows = csv.row_count if csv else 0
    if not csv or n_rows == 0:
        model["error"] = "no_rows"
        return model
    model["dataset"] = {
        "csvId": csv_id,
        "name": (store_raw.get(csv_id) or {}).get("name") or csv_id,
        "rowCount": n_rows,
    }

    dims = [c for c in (params.get("dims") or [])
            if c in csv.headers and csv.column_types.get(c) not in CLUSTER_METRIC_TYPES]
    if not dims:
        model["error"] = "no_dims"
        return model

    # Máscara de escopo: valida o csvId (o walk elegeu o mesmo winner que o modal) e o
    # rowCount contra o dataset — mismatch ⇒ ERRO de job (o router faz fallback ao worker
    # clampado com o MESMO escopo, DEC-FR-003). `in_rows` = índices ascendentes das linhas
    # do escopo; escopo vazio ⇒ no_rows DECLARADO (com model.scope já preenchido).
    in_rows = None
    rm = params.get("rowMask")
    if rm is not None:
        if rm.get("csvId") != csv_id:
            raise ValueError(
                "rowMask csvId mismatch: %r vs %r" % (rm.get("csvId"), csv_id))
        rm_rows = rm.get("rowCount")
        if int(rm_rows if rm_rows is not None else -1) != n_rows:
            raise ValueError(
                "rowMask rowCount mismatch: %r vs %d" % (rm_rows, n_rows))
        bits = np.unpackbits(
            np.frombuffer(base64.b64decode(rm.get("maskB64") or ""), dtype=np.uint8),
            bitorder="little")
        row_mask = np.zeros(n_rows, dtype=bool)
        m = min(n_rows, len(bits))
        row_mask[:m] = bits[:m].astype(bool)
        in_rows = np.nonzero(row_mask)[0]
        if len(in_rows) == 0:
            model["error"] = "no_rows"
            return model

    _progress(0.1)

    # ── Agregação por grupo (ordem de 1ª aparição na base; escopo por nó filtra
    # ANTES da agregação — DEC-FR-003) ─────────────────────────────────────────
    gid_row, tuples = _group_rows(csv, [csv.headers.index(c) for c in dims], in_rows)
    n_g = len(tuples)
    qty = csv.metric_array("qty")
    altas = csv.metric_array("qtdAltas")
    altas_inf = csv.metric_array("qtdAltasInfer")
    inad_r = csv.metric_array("inadReal")
    inad_i = csv.metric_array("inadInferida")
    dec = _decision_codes(csv)
    if in_rows is not None:
        # Restringe todos os vetores por-linha à subpopulação (mesma ordem ascendente que
        # o JS percorre) — daí em diante o motor é o MESMO, sobre menos linhas.
        qty = qty[in_rows]
        altas = altas[in_rows]
        altas_inf = altas_inf[in_rows]
        inad_r = inad_r[in_rows]
        inad_i = inad_i[in_rows]
        if dec is not None:
            dec = dec[in_rows]

    g_qty = _bincount_seq(gid_row, qty, n_g)
    g_altas = _bincount_seq(gid_row, altas, n_g)
    g_altas_inf = _bincount_seq(gid_row, altas_inf, n_g)
    g_inad_r = _bincount_seq(gid_row, inad_r, n_g)
    g_inad_i = _bincount_seq(gid_row, inad_i, n_g)
    if dec is not None:
        g_appr = _bincount_seq(gid_row, qty * (dec == 1), n_g)
        g_dec = _bincount_seq(gid_row, qty * ((dec == 1) | (dec == 2)), n_g)
    else:
        g_appr = np.zeros(n_g)
        g_dec = np.zeros(n_g)
    pop_qty = seq_sum(g_qty)
    pop_dec = seq_sum(g_dec)

    # ── Teto de pontos (degradação declarada) — top-N por volume, ordem preservada ──
    max_points = params.get("maxPoints")
    if max_points is not None and n_g > max_points:
        order = sorted(range(n_g), key=lambda g: (-g_qty[g], g))
        keep = sorted(order[:max_points])
        kept_qty = seq_sum(g_qty[np.asarray(keep, dtype=np.int64)])
        model["ceilings"] = {
            "pointsTruncated": True, "totalGroups": n_g, "keptGroups": len(keep),
            "keptQtyShare": kept_qty / pop_qty if pop_qty > 0 else None,
        }
    else:
        keep = list(range(n_g))
    keep_arr = np.asarray(keep, dtype=np.int64)
    n_p = len(keep)
    k_qty = g_qty[keep_arr]
    k_altas = g_altas[keep_arr]
    k_altas_inf = g_altas_inf[keep_arr]
    k_inad_r = g_inad_r[keep_arr]
    k_inad_i = g_inad_i[keep_arr]
    k_appr = g_appr[keep_arr]
    k_dec = g_dec[keep_arr]
    gid_to_kept = np.full(n_g, -1, dtype=np.int64)
    gid_to_kept[keep_arr] = np.arange(n_p)

    # ── Features (ordem canônica fixa) — fallback para a taxa do escopo no den==0 ──
    feature_defs = [
        ("approvalRate", "Taxa de Aprovação (AS IS)", k_appr, k_dec, dec is not None),
        ("inadReal", "Inad. Real", k_inad_r, k_altas,
         _has_metric_col(csv, "inadReal") and _has_metric_col(csv, "qtdAltas")),
        ("inadInferida", "Inad. Inferida", k_inad_i, k_altas_inf,
         _has_metric_col(csv, "inadInferida") and _has_metric_col(csv, "qtdAltasInfer")),
    ]
    wanted = set(params["features"]) if params.get("features") else None
    feats = []
    for fid, label, num, den, present in feature_defs:
        if not present or (wanted is not None and fid not in wanted):
            continue
        scope_den = seq_sum(den)
        if scope_den <= 0:
            continue
        scope_rate = seq_sum(num) / scope_den
        raw = np.where(den > 0, num / np.where(den > 0, den, 1.0), scope_rate)
        feats.append({"id": fid, "label": label, "raw": raw, "scopeRate": scope_rate})
    if not feats:
        model["error"] = "no_features"
        return model
    feat_ids = [f["id"] for f in feats]

    X = []
    for ft in feats:
        mean = seq_sum(ft["raw"]) / n_p
        diff = ft["raw"] - mean
        std = float(np.sqrt(seq_sum(diff * diff) / n_p))
        ft["mean"], ft["std"] = mean, std
        X.append((ft["raw"] - mean) / std if std > 0 else np.zeros(n_p, dtype=np.float64))

    _progress(0.35)

    # ── k-means determinístico (+ extras sklearn quando pedidos) ────────────────
    k_req = params.get("k") if params.get("k") is not None else CLUSTER_DEFAULT_K
    k_req = int(k_req)
    max_iter = int(params.get("maxIter")) if params.get("maxIter") is not None else CLUSTER_MAX_ITER
    w = k_qty
    if seq_sum(w) <= 0:
        w = np.ones(n_p, dtype=np.float64)

    method = params.get("method") or "kmeans"
    auto_k = bool(params.get("autoK"))
    sk_ok = _maybe_sklearn() if (auto_k or method == "hierarchical") else False
    quality_note = None
    silhouette = None

    def _seed_for(k_val):
        if params.get("seed") is not None:
            return int(params["seed"]) & _M32
        return cluster_seed_of(csv_id, dims, k_val, feat_ids, n_rows, scope_node_id)

    if method == "hierarchical" and sk_ok:
        from sklearn.cluster import AgglomerativeClustering
        k_eff = max(1, min(k_req, n_p))
        if k_eff < 2 or n_p < 2:
            assign = np.zeros(n_p, dtype=np.int64)
        else:
            mat = np.stack(X, axis=1)
            assign = AgglomerativeClustering(n_clusters=k_eff, linkage="ward") \
                .fit_predict(mat).astype(np.int64)
        n_c = int(assign.max()) + 1 if n_p else 1
        C = np.zeros((n_c, len(X)), dtype=np.float64)
        wsum = _bincount_seq(assign, w, n_c)
        cnt = np.bincount(assign, minlength=n_c)
        for f in range(len(X)):
            sums_f = _bincount_seq(assign, w * X[f], n_c)
            usums_f = _bincount_seq(assign, X[f], n_c)
            for c in range(n_c):
                if cnt[c] > 0:
                    C[c, f] = sums_f[c] / wsum[c] if wsum[c] > 0 else usums_f[c] / cnt[c]
        Cg = C[assign]
        acc = np.zeros(n_p, dtype=np.float64)
        for f in range(len(X)):
            d = X[f] - Cg[:, f]
            acc = acc + d * d
        km = (assign, C, 0, True, seq_sum(w * acc))
        k_eff = n_c
        seed = _seed_for(k_req)
        silhouette = _silhouette(X, assign)
        method_used = "hierarchical"
    else:
        if method == "hierarchical" and not sk_ok:
            quality_note = "sklearn_unavailable"
        method_used = "kmeans"
        if auto_k and sk_ok and n_p >= 3:
            best = None  # (−silhouette, k) — maior silhueta, empate no menor k
            for k_cand in range(2, max(2, k_req) + 1):
                k_eff_cand = max(1, min(k_cand, n_p))
                km_cand = _kmeans(X, w, k_eff_cand, _seed_for(k_cand), max_iter)
                sil = _silhouette(X, km_cand[0])
                if sil is None:
                    continue
                if best is None or (-sil, k_cand) < best[0]:
                    best = ((-sil, k_cand), k_cand, km_cand, sil)
            if best is not None:
                _key, k_req_used, km, silhouette = best[0], best[1], best[2], best[3]
                k_req = k_req_used
                k_eff = max(1, min(k_req, n_p))
                seed = _seed_for(k_req)
            else:
                k_eff = max(1, min(k_req, n_p))
                seed = _seed_for(k_req)
                km = _kmeans(X, w, k_eff, seed, max_iter)
        else:
            if auto_k and not sk_ok:
                quality_note = "sklearn_unavailable"
            k_eff = max(1, min(k_req, n_p))
            seed = _seed_for(k_req)
            km = _kmeans(X, w, k_eff, seed, max_iter)

    assign, C, iterations, converged, inertia = km
    _progress(0.75)

    # Variância explicada — SS total ao centroide global ponderado (== worker).
    total_w = seq_sum(w)
    gc = np.array([seq_sum(w * X[f]) / total_w for f in range(len(X))], dtype=np.float64)
    acc = np.zeros(n_p, dtype=np.float64)
    for f in range(len(X)):
        d = X[f] - gc[f]
        acc = acc + d * d
    total_ss = seq_sum(w * acc)

    # ── Perfil por cluster ──────────────────────────────────────────────────────
    n_c = len(C)
    c_qty = _bincount_seq(assign, k_qty, n_c)
    c_altas = _bincount_seq(assign, k_altas, n_c)
    c_altas_inf = _bincount_seq(assign, k_altas_inf, n_c)
    c_inad_r = _bincount_seq(assign, k_inad_r, n_c)
    c_inad_i = _bincount_seq(assign, k_inad_i, n_c)
    c_appr = _bincount_seq(assign, k_appr, n_c)
    c_dec = _bincount_seq(assign, k_dec, n_c)
    c_size = np.bincount(assign, minlength=n_c)

    # Valores por dimensão em cada cluster — dict de inserção em ordem de grupo
    # (≡ Map do JS): soma acumulada na MESMA sequência.
    dim_val_qty = [[{} for _ in dims] for _ in range(n_c)]
    for i in range(n_p):
        c = int(assign[i])
        tup = tuples[keep[i]]
        for d in range(len(dims)):
            m = dim_val_qty[c][d]
            m[tup[d]] = m.get(tup[d], 0.0) + float(k_qty[i])

    # Mix de risco por cluster (linhas de grupos truncados ficam fora).
    mix_col = None
    for name, t in csv.column_types.items():
        if t == "mixRisco" and name in csv.headers:
            mix_col = name
            break
    mix_by_cluster = None
    if mix_col is not None:
        mvals, mcodes = csv.view(csv.headers.index(mix_col), trim=True)
        if in_rows is not None:
            mcodes = mcodes[in_rows]  # alinha ao gid_row/qty já restritos ao escopo
        ki = gid_to_kept[gid_row]
        mask = ki >= 0
        c_row = assign[ki[mask]]
        combined = c_row * max(1, len(mvals)) + mcodes[mask]
        msums = _bincount_seq(combined, qty[mask], n_c * max(1, len(mvals)))
        mcnts = np.bincount(combined, minlength=n_c * max(1, len(mvals)))
        mix_by_cluster = []
        for c in range(n_c):
            entries = {}
            base = c * max(1, len(mvals))
            for k in range(len(mvals)):
                if mcnts[base + k] > 0:
                    entries[mvals[k]] = float(msums[base + k])
            mix_by_cluster.append(entries)

    def _sorted_entries(m):
        return sorted(m.items(), key=lambda e: (-e[1], _u16key(e[0])))

    rank = sorted(range(n_c), key=lambda c: (-c_qty[c], c))
    clusters = []
    for pos, c in enumerate(rank):
        centroid = {}
        for f, ft in enumerate(feats):
            centroid[ft["id"]] = float(C[c, f]) * ft["std"] + ft["mean"]
        dims_out = []
        for d, col in enumerate(dims):
            dims_out.append({
                "col": col,
                "values": [{
                    "value": v, "qty": q,
                    "share": q / float(c_qty[c]) if c_qty[c] > 0 else None,
                } for v, q in _sorted_entries(dim_val_qty[c][d])],
            })
        clusters.append({
            "id": "c%d" % (pos + 1),
            "size": int(c_size[c]),
            "qty": float(c_qty[c]),
            "share": float(c_qty[c]) / pop_qty if pop_qty > 0 else None,
            "decidedQty": float(c_dec[c]),
            "approvalRate": float(c_appr[c]) / float(c_dec[c]) if c_dec[c] > 0 else None,
            "inadReal": float(c_inad_r[c]) / float(c_altas[c]) if c_altas[c] > 0 else None,
            "inadInferida": float(c_inad_i[c]) / float(c_altas_inf[c]) if c_altas_inf[c] > 0 else None,
            "centroid": centroid,
            "conditions": [{
                "col": dm["col"], "operator": "in",
                "value": ", ".join(v["value"] for v in dm["values"]), "logic": "AND",
            } for dm in dims_out],
            "dims": dims_out,
            "mix": ([{
                "value": v, "qty": q,
                "share": q / float(c_qty[c]) if c_qty[c] > 0 else None,
            } for v, q in _sorted_entries(mix_by_cluster[c])] if mix_by_cluster is not None else None),
        })

    model["population"] = {"qty": pop_qty, "decidedQty": pop_dec,
                           "groupCount": n_g, "points": n_p}
    model["features"] = [{"id": f["id"], "label": f["label"], "mean": f["mean"],
                          "std": f["std"], "scopeRate": f["scopeRate"]} for f in feats]
    model["params"] = {
        "csvId": csv_id, "dims": dims, "k": int(k_eff), "kRequested": int(k_req),
        "features": feat_ids, "seed": int(seed), "method": method_used,
        "autoK": bool(auto_k and sk_ok and method_used == "kmeans"),
        "maxPoints": int(max_points) if max_points is not None else None,
    }
    model["quality"] = {
        "method": method_used,
        "inertia": float(inertia),
        "totalSS": float(total_ss),
        "explainedVariance": (1 - float(inertia) / float(total_ss)) if total_ss > 0 else None,
        "iterations": int(iterations),
        "converged": bool(converged),
        "silhouette": silhouette,
    }
    if quality_note:
        model["quality"]["note"] = quality_note
    model["clusters"] = clusters
    _progress(0.95)
    return model
