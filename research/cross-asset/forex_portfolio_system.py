"""
FOREX PORTFOLIO SYSTEM — diversificación honesta de múltiples edges débiles
============================================================================
Premisa (real, no motivacional): un edge individual con Sharpe ~0.3-0.5
rara vez pasa gates institucionales por sí solo. Pero varios edges
correlacionados DÉBILMENTE entre sí, combinados con position sizing
por riesgo (no por capital igual), pueden elevar el Sharpe del
portafolio combinado — esto es el principio detrás de risk parity
(Bridgewater) y multi-strategy CTAs (AQR, Man AHL).

Este script NO garantiza que vayas a pasar los gates. Lo que hace es
darte la prueba honesta de si la diversificación ayuda en TU caso
concreto, con TUS datos reales — ni más ni menos.

Requiere: haber corrido forex_trend_system.py (o el loader de abajo)
sobre varios pares/activos y tener sus CSV de precios reales.

Uso:
  python3 forex_portfolio_system.py \
      --csv EURUSD.csv GBPUSD.csv USDJPY.csv AUDUSD.csv XAUUSD.csv \
      --names EURUSD GBPUSD USDJPY AUDUSD XAUUSD \
      --jpy-index 2
"""

from __future__ import annotations
import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

# reutiliza la lógica ya validada del sistema individual
from forex_trend_system import (
    load_price_csv, StrategyParams, build_signals, run_backtest,
    daily_pnl_to_trades, scorecard, monte_carlo, GATES,
)


def load_universe(paths: list[str], names: list[str], jpy_indices: set[int]) -> dict[str, pd.Series]:
    universe = {}
    for i, (path, name) in enumerate(zip(paths, names)):
        try:
            universe[name] = load_price_csv(path)
        except (FileNotFoundError, ValueError) as e:
            print(f"[AVISO] {name}: {e} — se excluye del portafolio.")
    if len(universe) < 2:
        raise ValueError(
            "Necesitas al menos 2 activos con datos reales válidos para "
            "que la diversificación tenga sentido. Descarga más pares."
        )
    return universe


def per_asset_daily_pnl(prices: pd.Series, p: StrategyParams) -> pd.Series:
    """PnL diario neto de UN activo, en % de retorno (no en 'trades' aún —
    eso se hace a nivel de portafolio combinado)."""
    df_sig = build_signals(prices, p)
    bt = run_backtest(df_sig, p)
    return bt["net_pnl"]


def combine_portfolio(pnl_by_asset: dict[str, pd.Series], vol_lookback: int = 60) -> pd.Series:
    """Combina los PnL diarios de cada activo con peso inverso a su
    volatilidad realizada (risk parity simple) — no capital igual por
    activo, sino riesgo igual. Esto es lo que hace que la diversificación
    realmente reduzca el drawdown combinado, no solo lo diluya."""
    df = pd.DataFrame(pnl_by_asset).dropna(how="all").fillna(0)
    vols = df.rolling(vol_lookback).std().shift(1)  # vol conocida AYER, sin look-ahead
    inv_vol = 1 / vols.replace(0, np.nan)
    weights = inv_vol.div(inv_vol.sum(axis=1), axis=0).fillna(1 / len(df.columns))
    portfolio_pnl = (df * weights).sum(axis=1)
    return portfolio_pnl.dropna()


def report_individual_vs_portfolio(pnl_by_asset: dict[str, pd.Series], p: StrategyParams,
                                     train_frac: float = 0.6) -> dict:
    results = {"individual": {}, "portfolio": None}

    for name, pnl in pnl_by_asset.items():
        split = int(len(pnl) * train_frac)
        test_pnl = pnl.iloc[split:]
        test_trades = daily_pnl_to_trades(test_pnl, p.rebalance_days)
        results["individual"][name] = scorecard(test_trades)

    portfolio_pnl = combine_portfolio(pnl_by_asset)
    split = int(len(portfolio_pnl) * train_frac)
    train_pnl, test_pnl = portfolio_pnl.iloc[:split], portfolio_pnl.iloc[split:]

    train_trades = daily_pnl_to_trades(train_pnl, p.rebalance_days)
    test_trades = daily_pnl_to_trades(test_pnl, p.rebalance_days)

    train_score = scorecard(train_trades)
    test_score = scorecard(test_trades)

    mid = len(test_trades) // 2
    h1, h2 = test_trades[:mid], test_trades[mid:]
    consistent = (h1.mean() > 0 if len(h1) else False) and (h2.mean() > 0 if len(h2) else False)
    mc = monte_carlo(test_trades)

    survived = test_score["verdict"] not in ("NO_GO", "INSUFFICIENT_DATA") and consistent

    results["portfolio"] = {
        "n_assets": len(pnl_by_asset),
        "train": train_score,
        "test": test_score,
        "temporal_consistency": {
            "h1_mean_pct": float(h1.mean() * 100) if len(h1) else None,
            "h2_mean_pct": float(h2.mean() * 100) if len(h2) else None,
            "consistent": consistent,
        },
        "monte_carlo_oos": mc,
        "final_verdict": "GO" if survived else (
            "INSUFFICIENT_DATA" if test_score["verdict"] == "INSUFFICIENT_DATA" else "NO_GO"
        ),
    }
    return results


def main():
    ap = argparse.ArgumentParser(description="Portafolio diversificado — ¿ayuda combinar edges débiles?")
    ap.add_argument("--csv", nargs="+", required=True, help="CSVs de precios reales, uno por activo")
    ap.add_argument("--names", nargs="+", required=True, help="Nombres correspondientes a cada CSV")
    ap.add_argument("--jpy-index", type=int, nargs="*", default=[],
                     help="Índices (0-based) de los activos que son pares con JPY (pip_size=0.01)")
    ap.add_argument("--lookback", type=int, default=252)
    ap.add_argument("--rebalance", type=int, default=21)
    ap.add_argument("--spread-pips", type=float, default=1.0)
    args = ap.parse_args()

    if len(args.csv) != len(args.names):
        raise SystemExit("Debes dar el mismo número de --csv y --names")

    jpy_set = set(args.jpy_index)
    universe = load_universe(args.csv, args.names, jpy_set)

    pnl_by_asset = {}
    for i, (name, prices) in enumerate(universe.items()):
        p = StrategyParams(
            lookback_days=args.lookback,
            rebalance_days=args.rebalance,
            spread_pips=args.spread_pips,
            pip_size=0.01 if i in jpy_set else 0.0001,
        )
        pnl_by_asset[name] = per_asset_daily_pnl(prices, p)

    common_p = StrategyParams(lookback_days=args.lookback, rebalance_days=args.rebalance)
    results = report_individual_vs_portfolio(pnl_by_asset, common_p)

    print(f"\n{'='*70}")
    print(f"  EDGES INDIVIDUALES (out-of-sample) — antes de combinar")
    print(f"{'='*70}")
    for name, s in results["individual"].items():
        print(f"  {name:10s}  n={s['n_trades']:3d}  WR={s['win_rate']*100:5.1f}%  "
              f"PF={s['profit_factor']:5.2f}  t-stat={s['tstat']:5.2f}  "
              f"maxDD={s['max_dd_pct']:5.1f}%  → {s['verdict']}")

    port = results["portfolio"]
    print(f"\n{'='*70}")
    print(f"  PORTAFOLIO COMBINADO ({port['n_assets']} activos, risk-parity)")
    print(f"{'='*70}")
    t = port["test"]
    print(f"  n_trades={t['n_trades']}  WR={t['win_rate']*100:.1f}%  "
          f"PF={t['profit_factor']:.2f}  expectancy={t['expectancy_pct']:.4f}%  "
          f"t-stat={t['tstat']:.2f}  maxDD={t['max_dd_pct']:.1f}%")

    tc = port["temporal_consistency"]
    print(f"  Consistencia temporal: mitad1={tc['h1_mean_pct']:.4f}%  "
          f"mitad2={tc['h2_mean_pct']:.4f}%  → "
          f"{'CONSISTENTE' if tc['consistent'] else 'INCONSISTENTE'}")

    if port["monte_carlo_oos"]:
        mc = port["monte_carlo_oos"]
        print(f"  Monte Carlo p5={mc['p5_total_return_pct']:.2f}%  "
              f"mediana={mc['p50_total_return_pct']:.2f}%  "
              f"p95_DD={mc['p95_drawdown_pct']:.1f}%")

    print(f"\n{'='*70}")
    print(f"  VEREDICTO PORTAFOLIO: {port['final_verdict']}")
    print(f"{'='*70}")

    n_individual_go = sum(1 for s in results["individual"].values() if s["verdict"] == "GO")
    if port["final_verdict"] == "GO" and n_individual_go < port["n_assets"]:
        print(f"  → La diversificación SÍ ayudó: {n_individual_go}/{port['n_assets']} activos")
        print(f"    pasaban solos, pero el portafolio combinado sí pasa. Esto es")
        print(f"    evidencia real de beneficio de diversificación, no casualidad")
        print(f"    (ver consistencia temporal + Monte Carlo arriba).")
    elif port["final_verdict"] != "GO":
        print(f"  → Ni combinado supera los gates todavía. Opciones honestas:")
        print(f"    1) Agregar más activos NO correlacionados (no más pares de forex,")
        print(f"       sino clases de activo distintas: índices, materias primas)")
        print(f"    2) Probar otra estrategia base (carry trade) combinada con esta")
        print(f"    3) Aceptar que con esta receta específica no hay edge suficiente")
        print(f"       — información real, no fracaso personal.")

    out = Path("portfolio_report.json")
    with open(out, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nReporte completo: {out}")


if __name__ == "__main__":
    main()
