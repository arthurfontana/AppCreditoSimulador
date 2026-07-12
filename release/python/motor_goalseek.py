# -*- coding: utf-8 -*-
"""
motor_goalseek.py — Goal Seek Profundo no Motor Python (Execução Híbrida, Sessão GS5).

Solver de otimização EXATA (MILP binário via scipy.optimize.milp/HiGHS) sobre o
CATÁLOGO de movimentos que o worker JS gera (DEC-GS-005: o catálogo nasce no worker;
o sidecar só otimiza — o dataset NUNCA sobe para o Python). O job é self-contained:
`params` = catálogo agregado (baselineRaw + candidatos, centenas de números) + objetivo
+ restrições. Nenhum conhecimento de shapes/conns/csvStore vaza para cá.

Referência normativa: docs/wiki/Hibrido-GoalSeek-Profundo.md
  · DEC-GS-001 — Paridade de CONTRATO, não de números: NÃO existe gêmeo JS do solver
    (um MILP não tem contraparte browser); o fallback é o greedy do worker, que pode
    (e deve) produzir um resultado pior. O que este motor garante é o FORMATO do result
    e o DETERMINISMO (mesma entrada ⇒ mesma saída).
  · DEC-GS-006 — Formulação (ESTA é a especificação implementada aqui):
      pool = candidatos com toApproved === (direction==='increase'); σ=+1(increase)/−1(decrease);
      binárias x_i em ordem canônica por `id` (code unit UTF-16).
      Precedência: x_i ≤ x_j para j ∈ requires(i) presente no pool.
      Agregados lineares pós-escolha:
        A  = approvedQty0      + σ·Σ x_i·qty_i
        D  = decidedQty0       + σ·Σ_{i∈lens} x_i·qty_i        (só candidatos lens_threshold mexem no denominador de aprovação)
        QA = qtdAltasSum0      + σ·Σ x_i·qtdAltas_i
        QI = qtdAltasInferSum0 + σ·Σ x_i·qtdAltasInfer_i
        IR = inadRealSum0      + σ·Σ x_i·inadRRaw_i
        II = inadInferidaSum0  + σ·Σ x_i·inadIRaw_i
      Tetos (invioláveis, linearizados por multiplicação cruzada):
        maxInadReal: IR ≤ maxInadReal·QA
        maxInadInf : II ≤ maxInadInf·QI  (se qtdAltasInferSum0>0, senão II ≤ maxInadInf·A — fallback de goalSeekRatios)
      Alvo como razão (approvalRate=A/D, inadReal=IR/QA, inadInferida=II/QI|II/A,
      approvedAltasInfer=QI já linear):
        magnitude declarada ⇒ alvo vira RESTRIÇÃO linearizada + objetivo = minimizar o
          colateral (Dinkelbach se o colateral for razão; linear se for quantidade);
        magnitude null ⇒ objetivo fracionário resolvido por ITERAÇÃO DE DINKELBACH,
          depois estágio 2 lexicográfico (fixa o alvo no ótimo, minimiza o colateral).
      Fronteira 2D: `frontierPoints` níveis equiespaçados baseline→ótimo, cada um
      "alvo ≥ nível (ou ≤, em decrease) + min colateral".
      Família de curvas ("3D"): quando o usuário NÃO declarou teto de inad inferida,
      repete a fronteira para uma grade de 4 tetos {base·1.0, ·1.1, ·1.25, ·1.5}.
      Solver HiGHS single-thread, mip_rel_gap=0, time_limit por subproblema.
  · DEC-GS-009 — Determinismo: HiGHS single-thread, ordem canônica de candidatos,
    tolerâncias fixas; GATE dourado só-Python em tests_python/test_goal_seek.py.

Só numpy + scipy (tier full, E scipy.optimize.milp importável — scipy < 1.9 não tem
`milp`; o gate está em sidecar.py). Carregado LAZY pelo sidecar no 1º job goal_seek_deep.
"""
import math

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp


# ── Constantes (espelho das decididas em DEC-GS-006/009) ─────────────────────────
DINKELBACH_MAX_ITER = 10
DINKELBACH_TOL = 1e-12
DEFAULT_FRONTIER_POINTS = 13
DEFAULT_TIME_LIMIT_SEC = 20.0
# Família de curvas "3D" (tetos de inad. inferida como múltiplos do baseline).
CURVE_INAD_FACTORS = (1.0, 1.1, 1.25, 1.5)

TARGETS = ("approvalRate", "inadReal", "inadInferida", "approvedAltasInfer")
MINIMIZE_FIELDS = ("inadInferida", "inadReal", "approval", "salesVolume")

# HiGHS via scipy.optimize.milp — status: 0 ótimo, 1 limite (tempo/iteração; pode ter
# incumbente), 2 infactível, 3 ilimitado, 4 outro.
_STATUS_OPTIMAL = 0
_STATUS_LIMIT = 1
_STATUS_INFEASIBLE = 2

_NEG_INF = -np.inf
_POS_INF = np.inf


# ── Semântica de string do JS: ordem canônica por code unit UTF-16 (segStrCmp) ──
def _u16key(s):
    return str(s).encode("utf-16-be", "surrogatepass")


def _num(v, default=0.0):
    try:
        if v is None:
            return default
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default


# ── Expressão linear: valor = coef·x + const ─────────────────────────────────────
class _Expr(object):
    __slots__ = ("coef", "const")

    def __init__(self, coef, const):
        self.coef = coef
        self.const = float(const)

    def value(self, x):
        return float(self.coef @ x + self.const)


# ── Problema: baseline + coeficientes do pool + restrições base (precedência/tetos) ──
class _Problem(object):
    """Encapsula a formulação DEC-GS-006 para um pool fixo (direção já filtrada)."""

    def __init__(self, baseline_raw, pool, sigma, max_inad_real, max_inad_inf):
        self.sigma = sigma
        self.m = len(pool)
        self.pool = pool
        self.ids = [c["id"] for c in pool]
        self.is_lens = np.array(
            [1.0 if c.get("type") == "lens_threshold" else 0.0 for c in pool], dtype=np.float64
        )

        # Coeficientes por candidato (defaults 0 — DEC-GS-005: campos ausentes = 0).
        self.qty = np.array([_num(c.get("qty")) for c in pool], dtype=np.float64)
        self.qtd_altas = np.array([_num(c.get("qtdAltas")) for c in pool], dtype=np.float64)
        self.qtd_altas_inf = np.array([_num(c.get("qtdAltasInfer")) for c in pool], dtype=np.float64)
        self.inad_r = np.array([_num(c.get("inadRRaw")) for c in pool], dtype=np.float64)
        self.inad_i = np.array([_num(c.get("inadIRaw")) for c in pool], dtype=np.float64)

        # Baseline cru (agregados *0).
        self.A0 = _num(baseline_raw.get("approvedQty"))
        self.D0 = _num(baseline_raw.get("decidedQty"), _num(baseline_raw.get("totalQty")))
        self.QA0 = _num(baseline_raw.get("qtdAltasSum"))
        self.QI0 = _num(baseline_raw.get("qtdAltasInferSum"))
        self.IR0 = _num(baseline_raw.get("inadRealSum"))
        self.II0 = _num(baseline_raw.get("inadInferidaSum"))

        s = float(sigma)
        self.expr_A = _Expr(s * self.qty, self.A0)
        self.expr_D = _Expr(s * (self.is_lens * self.qty), self.D0)
        self.expr_QA = _Expr(s * self.qtd_altas, self.QA0)
        self.expr_QI = _Expr(s * self.qtd_altas_inf, self.QI0)
        self.expr_IR = _Expr(s * self.inad_r, self.IR0)
        self.expr_II = _Expr(s * self.inad_i, self.II0)

        self.max_inad_real = max_inad_real
        self.max_inad_inf = max_inad_inf

        self.integrality = np.ones(self.m)
        self.bounds = Bounds(np.zeros(self.m), np.ones(self.m))
        self._base_rows = self._build_base_constraints()

    # ── restrições base: precedência (x_i ≤ x_j) + tetos linearizados ───────────
    def _build_base_constraints(self):
        rows = []  # (coef, lb, ub)
        id_to_i = {cid: i for i, cid in enumerate(self.ids)}
        for i, c in enumerate(self.pool):
            for req in (c.get("requires") or []):
                j = id_to_i.get(req)
                if j is None:
                    continue  # requires fora do pool = vácuo (idêntico ao greedy)
                coef = np.zeros(self.m)
                coef[i] = 1.0
                coef[j] = -1.0
                rows.append((coef, _NEG_INF, 0.0))  # x_i - x_j ≤ 0
        rows.extend(self._ceiling_rows())
        return rows

    def _ceiling_rows(self):
        rows = []
        if self.max_inad_real is not None:
            # IR ≤ mR·QA ⟺ (IR.coef - mR·QA.coef)·x ≤ mR·QA0 - IR0
            mr = float(self.max_inad_real)
            coef = self.expr_IR.coef - mr * self.expr_QA.coef
            ub = mr * self.expr_QA.const - self.expr_IR.const
            rows.append((coef, _NEG_INF, ub))
        if self.max_inad_inf is not None:
            mi = float(self.max_inad_inf)
            den = self.expr_QI if self.QI0 > 0 else self.expr_A
            coef = self.expr_II.coef - mi * den.coef
            ub = mi * den.const - self.expr_II.const
            rows.append((coef, _NEG_INF, ub))
        return rows

    def _constraints(self, extra_rows):
        cons = []
        all_rows = list(self._base_rows) + list(extra_rows)
        if all_rows:
            A = np.array([r[0] for r in all_rows], dtype=np.float64)
            lb = np.array([r[1] for r in all_rows], dtype=np.float64)
            ub = np.array([r[2] for r in all_rows], dtype=np.float64)
            cons.append(LinearConstraint(A, lb, ub))
        return cons

    def solve(self, obj_coef, extra_rows, time_limit):
        """Minimiza obj_coef·x sobre as binárias, com as restrições base + extra.
        Devolve (x|None, status_str)."""
        options = {"disp": False, "mip_rel_gap": 0.0}
        if time_limit and time_limit > 0:
            options["time_limit"] = float(time_limit)
        res = milp(
            c=np.asarray(obj_coef, dtype=np.float64),
            constraints=self._constraints(extra_rows),
            integrality=self.integrality,
            bounds=self.bounds,
            options=options,
        )
        if res.x is None:
            if res.status == _STATUS_INFEASIBLE:
                return None, "infeasible"
            if res.status == _STATUS_LIMIT:
                return None, "time_limit"
            return None, "infeasible"
        x = np.rint(np.asarray(res.x, dtype=np.float64))
        status = "time_limit" if res.status == _STATUS_LIMIT else "optimal"
        return x, status

    # ── Dinkelbach: otimiza a razão num/den (ambos lineares em x) ────────────────
    def dinkelbach(self, num, den, sense, extra_rows, time_limit, lam0):
        """sense='max' ⇒ maximiza num/den; 'min' ⇒ minimiza. Determinístico: λ₀ dado,
        atualiza λ ← num(x*)/den(x*) até |Δλ|≤1e-12 ou 10 iterações. Devolve
        (x|None, lam|None, status)."""
        lam = float(lam0) if lam0 is not None and math.isfinite(lam0) else 0.0
        x = None
        status = "optimal"
        for _ in range(DINKELBACH_MAX_ITER):
            # F(λ) = extremo de (num - λ·den). 'max' ⇒ minimizar -(num-λden); 'min' ⇒ minimizar (num-λden).
            expr = num.coef - lam * den.coef
            obj = -expr if sense == "max" else expr
            xk, st = self.solve(obj, extra_rows, time_limit)
            if xk is None:
                return None, None, st
            if st == "time_limit":
                status = "time_limit"
            den_v = den.value(xk)
            num_v = num.value(xk)
            if den_v <= 0:
                # Denominador degenerado (sem população no ramo) — encerra com o incumbente.
                return xk, (num_v / den_v if den_v != 0 else None), status
            new_lam = num_v / den_v
            x = xk
            if abs(new_lam - lam) <= DINKELBACH_TOL:
                lam = new_lam
                break
            lam = new_lam
        return x, lam, status

    # ── Predição dos agregados a partir de x (mesma semântica de goalSeekRatios) ──
    def predict(self, x):
        A = self.expr_A.value(x)
        D = self.expr_D.value(x)
        QA = self.expr_QA.value(x)
        QI = self.expr_QI.value(x)
        IR = self.expr_IR.value(x)
        II = self.expr_II.value(x)
        approval_rate = (A / D) * 100 if D > 0 else 0.0
        inad_real = (IR / QA) if QA > 0 else None
        if QI > 0:
            inad_inf = II / QI
        elif A > 0:
            inad_inf = II / A
        else:
            inad_inf = None
        return {
            "approvalRate": approval_rate,
            "inadReal": inad_real,
            "inadInferida": inad_inf,
            "approvedQty": A,
            "decidedQty": D,
        }

    def ids_of(self, x):
        if x is None:
            return []
        return [self.ids[i] for i in range(self.m) if x[i] >= 0.5]


# ── Descritor do alvo: razão (num/den) ou linear (QI) + baseline ─────────────────
def _target_descriptor(problem, target):
    """Devolve dict {kind:'ratio'|'linear', num, den?, expr?, base, magScale}.
    `base` é o valor do alvo no baseline nas unidades de LINEARIZAÇÃO (razão ou qty).
    `magScale` converte a magnitude declarada (unidades nativas da UI) para essas
    unidades: approvalRate é pp (÷100 → razão); inad/qty são as próprias."""
    p = problem
    if target == "approvalRate":
        base = (p.A0 / p.D0) if p.D0 > 0 else None
        return {"kind": "ratio", "num": p.expr_A, "den": p.expr_D, "base": base, "magScale": 1.0 / 100.0}
    if target == "inadReal":
        base = (p.IR0 / p.QA0) if p.QA0 > 0 else None
        return {"kind": "ratio", "num": p.expr_IR, "den": p.expr_QA, "base": base, "magScale": 1.0}
    if target == "inadInferida":
        if p.QI0 > 0:
            den, base = p.expr_QI, p.II0 / p.QI0
        elif p.A0 > 0:
            den, base = p.expr_A, p.II0 / p.A0
        else:
            den, base = p.expr_QI, None
        return {"kind": "ratio", "num": p.expr_II, "den": den, "base": base, "magScale": 1.0}
    # approvedAltasInfer — linear (QI)
    return {"kind": "linear", "expr": problem.expr_QI, "base": problem.QI0, "magScale": 1.0}


def _target_constraint_row(td, level, direction):
    """Restrição linearizada 'alvo {≥|≤} level' (level em unidades de linearização)."""
    if td["kind"] == "ratio":
        num, den = td["num"], td["den"]
        coef = num.coef - level * den.coef
        rhs = -(num.const - level * den.const)  # coef·x {≥|≤} rhs
        if direction == "increase":
            return (coef, rhs, _POS_INF)  # num - level·den ≥ 0
        return (coef, _NEG_INF, rhs)      # num - level·den ≤ 0
    expr = td["expr"]
    rhs = level - expr.const
    if direction == "increase":
        return (expr.coef, rhs, _POS_INF)
    return (expr.coef, _NEG_INF, rhs)


def _target_lock_row(td, opt_val, direction):
    """Fixa o alvo no ótimo do estágio 1 (± tolerância escalada) para o estágio 2
    lexicográfico. `opt_val` em unidades de linearização."""
    if td["kind"] == "ratio":
        num, den = td["num"], td["den"]
        tol = 1e-6 * (abs(num.const) + abs(den.const) + 1.0)
        coef = num.coef - opt_val * den.coef
        rhs = -(num.const - opt_val * den.const)
        if direction == "increase":
            return (coef, rhs - tol, _POS_INF)  # num - opt·den ≥ -tol
        return (coef, _NEG_INF, rhs + tol)      # ≤ +tol
    expr = td["expr"]
    tol = 1e-6 * (abs(expr.const) + abs(opt_val) + 1.0)
    rhs = opt_val - expr.const
    if direction == "increase":
        return (expr.coef, rhs - tol, _POS_INF)
    return (expr.coef, _NEG_INF, rhs + tol)


# ── Colateral (DEC-GS-003) ───────────────────────────────────────────────────────
def _collateral(problem, minimize_field):
    """Devolve dict {kind:'linear', coef} ou {kind:'ratio', num, den, base}."""
    p = problem
    if minimize_field == "approval":
        return {"kind": "linear", "coef": p.qty.copy()}
    if minimize_field == "salesVolume":
        return {"kind": "linear", "coef": p.qtd_altas_inf.copy()}
    if minimize_field == "inadReal":
        base = (p.IR0 / p.QA0) if p.QA0 > 0 else 0.0
        return {"kind": "ratio", "num": p.expr_IR, "den": p.expr_QA, "base": base}
    # inadInferida (default)
    if p.QI0 > 0:
        den, base = p.expr_QI, p.II0 / p.QI0
    elif p.A0 > 0:
        den, base = p.expr_A, p.II0 / p.A0
    else:
        den, base = p.expr_QI, 0.0
    return {"kind": "ratio", "num": p.expr_II, "den": den, "base": base}


def _minimize_collateral(problem, coll, extra_rows, time_limit):
    """Minimiza o colateral (linear ou razão via Dinkelbach) sob as restrições dadas.
    Devolve (x|None, status)."""
    if coll["kind"] == "linear":
        return problem.solve(coll["coef"], extra_rows, time_limit)
    x, _lam, st = problem.dinkelbach(coll["num"], coll["den"], "min", extra_rows, time_limit, coll["base"])
    return x, st


# ── Estágio 1 — ótimo do alvo (magnitude null: max/min do alvo) ──────────────────
def _optimize_target(problem, td, direction, extra_rows, time_limit):
    """Devolve (x|None, opt_val|None, status). opt_val em unidades de linearização."""
    sense = "max" if direction == "increase" else "min"
    if td["kind"] == "ratio":
        x, lam, st = problem.dinkelbach(td["num"], td["den"], sense, extra_rows, time_limit, td["base"])
        return x, lam, st
    expr = td["expr"]
    obj = -expr.coef if direction == "increase" else expr.coef
    x, st = problem.solve(obj, extra_rows, time_limit)
    return x, (expr.value(x) if x is not None else None), st


def _to_native(td, target, val):
    """Converte um valor em unidades de linearização para a unidade nativa da UI
    (percent para approvalRate; razão/qty nos demais) — usado só no campo `level`."""
    if val is None:
        return None
    if target == "approvalRate":
        return val * 100.0
    return val


def _worse(status_a, status_b):
    """Combina status de subproblemas: infeasible > time_limit > optimal (na ordem de
    'pior primeiro' — mas infeasible de um subproblema de fronteira não zera o todo)."""
    order = {"optimal": 0, "time_limit": 1, "infeasible": 2}
    return status_a if order.get(status_a, 0) >= order.get(status_b, 0) else status_b


# ── Fronteira 2D — níveis equiespaçados baseline→ótimo, min colateral por nível ──
def _build_frontier(problem, td, target, direction, coll, opt_val, extra_rows,
                    frontier_points, time_limit, progress):
    base_val = td["base"]
    points = []
    status = "optimal"
    if base_val is None or opt_val is None:
        return points, status
    n = max(2, int(frontier_points))
    levels = np.linspace(base_val, opt_val, n)
    for k, level in enumerate(levels):
        rows = list(extra_rows) + [_target_constraint_row(td, float(level), direction)]
        x, st = _minimize_collateral(problem, coll, rows, time_limit)
        status = _worse(status, st) if st != "infeasible" else status
        if x is None:
            # Nível infactível (não deveria ocorrer entre baseline e ótimo) — pula.
            if progress:
                progress(k, n)
            continue
        points.append({
            "level": _to_native(td, target, float(level)),
            "ids": problem.ids_of(x),
            "predicted": problem.predict(x),
        })
        if progress:
            progress(k + 1, n)
    return points, status


# ── Ponto de entrada da task goal_seek_deep ──────────────────────────────────────
def solve_goal_seek(params, progress_cb=None):
    """Resolve o problema de Goal Seek profundo. `params` = {catalog:{baselineRaw,
    candidates}, goal, constraints, frontierPoints, timeLimitSec}. Devolve o dict do
    contrato `result` (DEC-GS-005): {solution:{ids,predicted}, frontier:[...],
    curves?:[...], status}."""
    params = params or {}
    catalog = params.get("catalog") or {}
    baseline_raw = catalog.get("baselineRaw") or {}
    candidates = catalog.get("candidates") or []
    goal = params.get("goal") or {}
    constraints = params.get("constraints") or {}
    frontier_points = params.get("frontierPoints")
    frontier_points = DEFAULT_FRONTIER_POINTS if frontier_points is None else int(frontier_points)
    time_limit = params.get("timeLimitSec")
    time_limit = DEFAULT_TIME_LIMIT_SEC if time_limit is None else float(time_limit)

    target = goal.get("target") if goal.get("target") in TARGETS else "approvalRate"
    direction = "decrease" if goal.get("direction") == "decrease" else "increase"
    mag = goal.get("magnitude")
    magnitude = float(mag) if isinstance(mag, (int, float)) and math.isfinite(mag) else None
    minimize_field = goal.get("minimize") if goal.get("minimize") in MINIMIZE_FIELDS else "inadInferida"
    wants_approved = direction == "increase"
    sigma = 1.0 if wants_approved else -1.0

    mr = constraints.get("maxInadReal")
    max_inad_real = float(mr) if isinstance(mr, (int, float)) and math.isfinite(mr) else None
    mi = constraints.get("maxInadInf")
    max_inad_inf = float(mi) if isinstance(mi, (int, float)) and math.isfinite(mi) else None

    # Pool: candidatos na direção do objetivo, ORDENADOS canonicamente por id (UTF-16).
    pool = [c for c in candidates if bool(c.get("toApproved")) == wants_approved]
    pool.sort(key=lambda c: _u16key(c.get("id")))

    problem = _Problem(baseline_raw, pool, sigma, max_inad_real, max_inad_inf)
    td = _target_descriptor(problem, target)
    coll = _collateral(problem, minimize_field)

    if progress_cb:
        progress_cb(0.1)

    # Pool vazio (ou sem melhoria possível) ⇒ solução = baseline.
    if problem.m == 0:
        x0 = np.zeros(0)
        base_pred = problem.predict(x0)
        base_point = {"level": _to_native(td, target, td["base"]), "ids": [], "predicted": base_pred}
        out = {
            "status": "optimal",
            "solution": {"ids": [], "predicted": base_pred},
            "frontier": [base_point],
        }
        if max_inad_inf is None:
            out["curves"] = [{"maxInadInf": None, "frontier": [base_point]}]
        if progress_cb:
            progress_cb(1.0)
        return out

    overall_status = "optimal"

    # ── Estágio 1: ótimo do alvo (sempre computado — define a extensão da fronteira).
    x_opt, opt_val, st1 = _optimize_target(problem, td, direction, [], time_limit)
    overall_status = _worse(overall_status, st1)
    if x_opt is None:
        # Sem solução factível para o alvo (ex.: teto torna qualquer melhora infactível).
        if progress_cb:
            progress_cb(1.0)
        return {"status": "infeasible", "solution": None, "frontier": []}

    if progress_cb:
        progress_cb(0.3)

    # ── Solução escolhida.
    if magnitude is None:
        # Estágio 2 lexicográfico: fixa o alvo no ótimo, minimiza o colateral.
        lock = [_target_lock_row(td, opt_val, direction)]
        x_sol, st2 = _minimize_collateral(problem, coll, lock, time_limit)
        if x_sol is None:
            x_sol = x_opt  # colateral infactível na trava (não esperado) — usa o ótimo do alvo
        else:
            overall_status = _worse(overall_status, st2)
    else:
        # Magnitude declarada: alvo vira restrição; objetivo = minimizar o colateral.
        base_val = td["base"]
        if base_val is None:
            goal_abs = None
        elif direction == "increase":
            goal_abs = base_val + magnitude * td["magScale"]
        else:
            goal_abs = base_val - magnitude * td["magScale"]
        x_sol = None
        if goal_abs is not None:
            rows = [_target_constraint_row(td, float(goal_abs), direction)]
            x_sol, st2 = _minimize_collateral(problem, coll, rows, time_limit)
            if x_sol is not None:
                overall_status = _worse(overall_status, st2)
        if x_sol is None:
            # Infactível (não dá para atingir a magnitude) ⇒ melhor parcial = ótimo do alvo.
            # O worker deriva goalReached=false + bindingConstraint da re-simulação real.
            x_sol = x_opt

    solution = {"ids": problem.ids_of(x_sol), "predicted": problem.predict(x_sol)}

    if progress_cb:
        progress_cb(0.45)

    def _frontier_progress(done, total):
        if progress_cb:
            progress_cb(0.45 + 0.5 * (done / max(1, total)))

    # ── Fronteira 2D principal (sob os tetos declarados pelo usuário).
    frontier, fstatus = _build_frontier(
        problem, td, target, direction, coll, opt_val, [],
        frontier_points, time_limit, _frontier_progress,
    )
    overall_status = _worse(overall_status, fstatus)

    out = {"status": overall_status, "solution": solution, "frontier": frontier}

    # ── Família de curvas "3D": só quando o usuário NÃO declarou teto de inad inferida.
    if max_inad_inf is None:
        base_inad_inf = (problem.II0 / problem.QI0) if problem.QI0 > 0 else (
            (problem.II0 / problem.A0) if problem.A0 > 0 else None
        )
        curves = []
        if base_inad_inf is not None and base_inad_inf > 0:
            for f in CURVE_INAD_FACTORS:
                ceil = base_inad_inf * f
                # Teto extra de inad inferida: II ≤ ceil·(QI|A).
                den = problem.expr_QI if problem.QI0 > 0 else problem.expr_A
                coef = problem.expr_II.coef - ceil * den.coef
                ub = ceil * den.const - problem.expr_II.const
                extra = [(coef, _NEG_INF, ub)]
                # Reotimiza o alvo sob o teto extra (a extensão da curva muda por teto).
                xo, ov, sto = _optimize_target(problem, td, direction, extra, time_limit)
                overall_status = _worse(overall_status, sto)
                if xo is None:
                    curves.append({"maxInadInf": ceil, "frontier": []})
                    continue
                cf, cst = _build_frontier(
                    problem, td, target, direction, coll, ov, extra,
                    frontier_points, time_limit, None,
                )
                overall_status = _worse(overall_status, cst)
                curves.append({"maxInadInf": ceil, "frontier": cf})
        out["curves"] = curves
        out["status"] = overall_status

    if progress_cb:
        progress_cb(1.0)
    return out
