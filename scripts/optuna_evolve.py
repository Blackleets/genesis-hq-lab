#!/usr/bin/env python
"""optuna_evolve.py — Bayesian hyperparameter search over the Genesis backtest core.

Bridges Optuna (Python, TPE sampler) with our honest Node backtest evaluator.
Every trial spawns: node evalCandidate.mjs <pair> <tf> <days> <kind> '<params>'
Candles are cached by evalCandidate so trials are fast after the first.

Usage:
  python scripts/optuna_evolve.py --pair COTIUSDT --tf 1h --days 360 \
      --kinds meanReversion volumeProfile --trials 60

Requires: pip install optuna (project-local venv recommended).
Output: top-5 candidates as JSON to stdout; full study saved to
data/optuna_studies/<pair>_<tf>_<days>d.db (sqlite, resumable).

HONESTY: in-sample optimization only. Any candidate that looks good MUST then
pass oosValidator.mjs walk-forward before being trusted.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import optuna

from genesis_losses import LOSS_REGISTRY

ROOT = Path(__file__).resolve().parents[1]
EVAL = ROOT / "server" / "genesis" / "evalCandidate.mjs"
STUDY_DIR = ROOT / "data" / "optuna_studies"


def evaluate(pair: str, tf: str, days: int, kind: str, params: dict) -> dict:
    proc = subprocess.run(
        ["node", str(EVAL), pair, tf, str(days), kind, json.dumps(params)],
        capture_output=True, text=True, timeout=120,
    )
    out = proc.stdout.strip().splitlines()
    if not out:
        raise RuntimeError(proc.stderr.strip()[:300] or "evaluator produced no output")
    return json.loads(out[-1])


def suggest_params(trial: optuna.Trial, kind: str) -> dict:
    if kind == "meanReversion":
        return {
            "rsiPeriod": trial.suggest_int("rsiPeriod", 8, 21),
            "rsiLow": trial.suggest_int("rsiLow", 20, 35),
            "rsiHigh": trial.suggest_int("rsiHigh", 65, 85),
            "bbPeriod": trial.suggest_int("bbPeriod", 12, 40),
            # bbMult kept at evolution's winning regime (wide bands); small sweep
            "bbMult": trial.suggest_float("bbMult", 2.0, 10.0, step=0.5),
            "slMult": trial.suggest_float("slMult", 1.2, 3.0, step=0.05),
            "tpMult": trial.suggest_float("tpMult", 1.5, 3.0, step=0.05),
            "atrMinPct": trial.suggest_float("atrMinPct", 0.0005, 0.006, step=0.0005),
            "adxMax": trial.suggest_int("adxMax", 18, 40),
        }
    if kind == "volumeProfile":
        return {
            "vwapLookback": trial.suggest_int("vwapLookback", 10, 60),
            "devPct": trial.suggest_float("devPct", 0.003, 0.012, step=0.0005),
            "slMult": trial.suggest_float("slMult", 1.2, 3.0, step=0.05),
            "tpMult": trial.suggest_float("tpMult", 1.5, 3.0, step=0.05),
            "atrMinPct": trial.suggest_float("atrMinPct", 0.0005, 0.004, step=0.0005),
            "adxMax": trial.suggest_int("adxMax", 18, 40),
        }
    if kind == "orderbookImbalance":
        return {
            "volLookback": trial.suggest_int("volLookback", 10, 40),
            "volMult": trial.suggest_float("volMult", 1.3, 2.9, step=0.1),
            "slMult": trial.suggest_float("slMult", 1.2, 3.0, step=0.05),
            "tpMult": trial.suggest_float("tpMult", 1.5, 3.0, step=0.05),
            "atrMinPct": trial.suggest_float("atrMinPct", 0.0005, 0.004, step=0.0005),
            "adxMax": trial.suggest_int("adxMax", 18, 40),
        }
    # momentum / breakout
    p = {
        "slMult": trial.suggest_float("slMult", 1.2, 3.0, step=0.05),
        "tpMult": trial.suggest_float("tpMult", 1.2, 3.0, step=0.05),
        "atrMinPct": trial.suggest_float("atrMinPct", 0.001, 0.006, step=0.0005),
    }
    if kind == "momentum":
        p["fast"] = trial.suggest_int("fast", 3, 15)
        p["slow"] = trial.suggest_int("slow", 16, 60)
    elif kind == "breakout":
        p["donchianPeriod"] = trial.suggest_int("donchianPeriod", 10, 60)
    return p


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", default="COTIUSDT")
    ap.add_argument("--tf", default="1h")
    ap.add_argument("--days", type=int, default=360)
    ap.add_argument("--kinds", nargs="+", default=["meanReversion", "volumeProfile"])
    ap.add_argument("--trials", type=int, default=60)
    ap.add_argument("--seed", type=int, default=42)
    # P3: pluggable loss — which scalar the sampler maximizes. Gates stay as
    # user_attrs either way, so honesty filtering is loss-independent.
    ap.add_argument(
        "--loss",
        choices=sorted(LOSS_REGISTRY),
        default="fitness",
        help="Objective function from LOSS_REGISTRY (default: fitness)",
    )
    args = ap.parse_args()

    STUDY_DIR.mkdir(parents=True, exist_ok=True)
    # Study name includes the family set: Optuna's CategoricalDistribution is
    # fixed per study, so different --kinds sets need distinct studies.
    # The loss suffix keeps objectives separate: mixing fitness trials with
    # calmar trials in one study would corrupt TPE's comparisons.
    fam_tag = "-".join(sorted(args.kinds))[:40]
    study_name = f"{args.pair}_{args.tf}_{args.days}d_{fam_tag}_{args.loss}"
    storage = f"sqlite:///{STUDY_DIR / study_name}.db"

    study = optuna.create_study(
        study_name=study_name,
        storage=storage,
        load_if_exists=True,
        sampler=optuna.samplers.TPESampler(seed=args.seed),
        direction="maximize",
    )

    kinds_seen: set[str] = set()

    def objective(trial: optuna.Trial) -> float:
        kind = trial.suggest_categorical("kind", args.kinds)
        kinds_seen.add(kind)
        params = {k: v for k, v in suggest_params(trial, kind).items()}
        try:
            result = evaluate(args.pair, args.tf, args.days, kind, params)
        except Exception as exc:  # noqa: BLE001 - any eval failure prunes the trial
            print(f"[trial {trial.number}] FAILED: {exc}", file=sys.stderr)
            raise optuna.TrialPruned(str(exc)) from exc
        # P0 lookahead guard: evalCandidate now reports the violation count.
        if result.get("lookaheadViolations", 0) > 0:
            print(f"[trial {trial.number}] LOOKAHEAD violations={result['lookaheadViolations']}", file=sys.stderr)
            raise optuna.TrialPruned("LOOKAHEAD")
        loss_fn = LOSS_REGISTRY[args.loss]
        loss_value = float(loss_fn(result))
        trial.set_user_attr("go", result["go"])
        trial.set_user_attr("gates", result["gates"])
        trial.set_user_attr("trades", result["metrics"].get("trades", 0))
        print(
            f"[trial {trial.number}] {kind} fit={result['fitness']} "
            f"loss[{args.loss}]={loss_value:.4f} "
            f"trades={result['metrics'].get('trades')} gates={result['gates']}",
            flush=True,
        )
        return loss_value

    study.optimize(objective, n_trials=args.trials)

    # Top-5 completed trials by the selected loss
    done = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]
    done.sort(key=lambda t: t.value or float("-inf"), reverse=True)
    top = []
    for t in done[:5]:
        top.append({
            "loss_value": t.value,
            "kind": t.params.get("kind"),
            "params": {k: v for k, v in t.params.items() if k != "kind"},
            "go": t.user_attrs.get("go"),
            "gates": t.user_attrs.get("gates"),
            "trades": t.user_attrs.get("trades"),
        })
    print(json.dumps({"study": study_name, "loss": args.loss, "n_trials": len(done), "top": top}, indent=2))


if __name__ == "__main__":
    main()
