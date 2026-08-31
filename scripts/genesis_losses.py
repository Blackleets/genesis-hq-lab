#!/usr/bin/env python
"""genesis_losses.py — Pluggable loss registry for Optuna evolution (Plan P3).

Each loss takes the raw evalCandidate.mjs result dict and returns a single
float that Optuna maximizes. Keeping losses here decouples the optimization
objective from the gate system: gates (go/gates/trades) are recorded as trial
user_attrs either way, so switching a loss never touches honesty filters.

Registry keys match the --loss flag of optuna_evolve.py:
  fitness          — legacy compat: result['fitness'] verbatim (default)
  sharpe           — metrics.sharpe, floored when the sample is thin
  calmar           — returnPct / |maxDrawdown|, floored when the sample is thin
  profit_drawdown  — net expectancy minus an exponential drawdown penalty

All numeric fields come from backtestCore.mjs fullReport().metrics:
  sharpe                 float (mean/std of per-trade returns)
  returnPct              fraction (e.g. 0.12 == +12%)
  maxDrawdown            fraction >= 0
  expectancyPctPerTrade  percent per trade (e.g. 0.08 == 0.08%/trade)
  trades                 int
"""

import math

# Minimum completed trades before ratio-based losses trust the sample.
MIN_TRADES = 50
# Thin-sample floor: far below any realistic loss value so TPE avoids it.
THIN_SAMPLE_FLOOR = -100.0
# Epsilon guarding the Calmar denominator against zero drawdown.
_EPS = 1e-9


def loss_fitness(r: dict) -> float:
    """Compat default: the legacy evolutionLoops-style score, verbatim."""
    return float(r["fitness"])


def _thin_sample(r: dict) -> bool:
    return int(r.get("metrics", {}).get("trades", 0)) < MIN_TRADES


def loss_sharpe(r: dict) -> float:
    """Risk-adjusted return quality: Sharpe ratio of per-trade returns."""
    if _thin_sample(r):
        return THIN_SAMPLE_FLOOR
    sharpe = float(r.get("metrics", {}).get("sharpe", 0.0))
    return sharpe if math.isfinite(sharpe) else THIN_SAMPLE_FLOOR


def loss_calmar(r: dict) -> float:
    """Return over worst drawdown: returnPct / max(|maxDrawdown|, eps)."""
    if _thin_sample(r):
        return THIN_SAMPLE_FLOOR
    m = r.get("metrics", {})
    dd = abs(float(m.get("maxDrawdown", 0.0)))
    calmar = float(m.get("returnPct", 0.0)) / max(dd, _EPS)
    return calmar if math.isfinite(calmar) else THIN_SAMPLE_FLOOR


def loss_profit_drawdown(r: dict) -> float:
    """Net expectancy minus an exponential penalty on max drawdown.

    penalty = SCALE * (exp(K * maxDrawdown) - 1): flat at small DD, brutal
    once drawdown compounds past a few percent. Expectancy is in percent per
    trade, so the scale keeps both terms on comparable magnitudes.
    Thin samples (< MIN_TRADES trades) are floored like sharpe/calmar.
    """
    if _thin_sample(r):
        return THIN_SAMPLE_FLOOR
    m = r.get("metrics", {})
    expectancy = float(m.get("expectancyPctPerTrade", 0.0))
    dd = abs(float(m.get("maxDrawdown", 0.0)))
    penalty = _PENALTY_SCALE * (math.exp(_PENALTY_K * dd) - 1.0)
    val = expectancy - penalty
    return val if math.isfinite(val) else THIN_SAMPLE_FLOOR


# Exponential-drawdown-penalty shape constants:
#   K      — how fast the penalty ramps with drawdown fraction
#   SCALE  — magnitude matching expectancyPctPerTrade units
_PENALTY_K = 20.0
_PENALTY_SCALE = 5.0


LOSS_REGISTRY = {
    "fitness": loss_fitness,
    "sharpe": loss_sharpe,
    "calmar": loss_calmar,
    "profit_drawdown": loss_profit_drawdown,
}
