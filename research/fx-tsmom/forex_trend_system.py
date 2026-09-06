"""
FOREX TREND-FOLLOWING SYSTEM — validación institucional honesta
==================================================================
Estrategia: Time-Series Momentum (Moskowitz, Ooi & Pedersen, 2012,
"Time Series Momentum", Journal of Financial Economics).
Evidencia: 58 años de datos, 24+ mercados (incluye los pares de forex
mayores), Sharpe ~1.0 con rebalanceo mensual, documentado y replicado
por CTAs reales (AHL, Winton, Man Group) durante décadas.

REGLA DE ORO DE ESTE ARCHIVO:
Este script NUNCA inventa datos. Si no hay datos reales cargados,
se detiene y te dice exactamente qué hacer — no rellena con números
falsos ni simula un resultado "bonito".

Cómo conseguir datos reales (elige uno, gratis):
  1) yfinance (más fácil):
       pip install yfinance
       import yfinance as yf
       df = yf.download("EURUSD=X", start="2010-01-01", interval="1d")
       df[["Close"]].to_csv("EURUSD.csv")
  2) OANDA v20 API (cuenta demo gratis, datos de precio reales):
       https://developer.oanda.com/rest-live-v20/introduction/
  3) Dukascopy Historical Data Feed (tick data gratis, exportable a CSV):
       https://www.dukascopy.com/swiss/english/marketwatch/historical/

Uso:
  python forex_trend_system.py --csv EURUSD.csv --pair EURUSD
"""

from __future__ import annotations
import argparse
import sys
import math
import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

# ─────────────────────────────────────────────────────────────────
# 1. CARGA DE DATOS — solo reales, nunca sintéticos
# ─────────────────────────────────────────────────────────────────

def load_price_csv(path: str) -> pd.Series:
    """Carga un CSV con columnas Date/Close (acepta variantes de yfinance,
    OANDA export, o Dukascopy export). Lanza error explícito si el
    archivo no existe o no tiene datos suficientes — nunca simula."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(
            f"No encontré '{path}'. Este sistema NO opera con datos "
            f"inventados. Descarga precios reales primero (ver docstring "
            f"del archivo para 3 fuentes gratis) y vuelve a correr."
        )
    df = pd.read_csv(p)
    # normaliza nombres de columna comunes
    cols = {c.lower().strip(): c for c in df.columns}
    date_col = cols.get("date") or cols.get("time") or cols.get("datetime")
    close_col = cols.get("close") or cols.get("adj close") or cols.get("price")
    if date_col is None or close_col is None:
        raise ValueError(
            f"No pude identificar columnas Date/Close en {path}. "
            f"Columnas encontradas: {list(df.columns)}"
        )
    df[date_col] = pd.to_datetime(df[date_col])
    df = df[[date_col, close_col]].dropna()
    df = df.sort_values(date_col).drop_duplicates(subset=date_col)
    series = pd.Series(df[close_col].values, index=df[date_col].values, name="close")
    if len(series) < 500:
        raise ValueError(
            f"Solo {len(series)} velas diarias — insuficiente para una "
            f"lectura estadística seria (mínimo recomendado: ~5 años, "
            f"~1250 velas diarias)."
        )
    return series.astype(float)


# ─────────────────────────────────────────────────────────────────
# 2. ESTRATEGIA — Time-Series Momentum (12 meses, rebalanceo mensual)
# ─────────────────────────────────────────────────────────────────

@dataclass
class StrategyParams:
    lookback_days: int = 252      # ~12 meses de trading
    rebalance_days: int = 21      # ~1 mes
    vol_target_days: int = 60     # ventana para normalizar por volatilidad
    spread_pips: float = 1.0      # costo asumido por lado, pares mayores
    pip_size: float = 0.0001      # EURUSD/GBPUSD; usar 0.01 para pares con JPY


def build_signals(prices: pd.Series, p: StrategyParams) -> pd.DataFrame:
    """Señal de momentum de series de tiempo: LONG si el retorno de los
    últimos `lookback_days` es positivo, SHORT si es negativo. Solo se
    reevalúa cada `rebalance_days` (evita sobre-operar y refleja cómo
    los CTAs reales ejecutan esto). Position sizing normalizado por
    volatilidad realizada (target vol constante, técnica estándar de
    la industria, no inventada)."""
    ret = prices.pct_change()
    daily_vol = ret.rolling(p.vol_target_days).std()
    mom = prices.pct_change(p.lookback_days)

    df = pd.DataFrame({"close": prices, "ret": ret, "mom": mom, "vol": daily_vol})
    df["signal"] = np.sign(df["mom"])
    # solo rebalancea cada N días; el resto de los días mantiene la posición previa
    rebalance_mask = (np.arange(len(df)) % p.rebalance_days) == 0
    df["position"] = np.where(rebalance_mask, df["signal"], np.nan)
    df["position"] = df["position"].ffill().fillna(0)
    # tamaño inverso a la volatilidad (vol targeting simple, no apalancado más allá de 1x)
    target_vol = df["vol"].median()
    df["size"] = (target_vol / df["vol"]).clip(upper=2.0).fillna(0)
    df["exposure"] = df["position"] * df["size"]
    return df.dropna(subset=["mom", "vol"])


# ─────────────────────────────────────────────────────────────────
# 3. BACKTEST con costos reales
# ─────────────────────────────────────────────────────────────────

def run_backtest(df: pd.DataFrame, p: StrategyParams) -> pd.DataFrame:
    exposure = df["exposure"]
    ret = df["ret"]
    # PnL bruto: exposición de AYER aplicada al retorno de HOY (sin look-ahead)
    gross_pnl = exposure.shift(1).fillna(0) * ret
    # costo: se paga solo cuando la exposición cambia (rebalanceo real)
    exposure_change = exposure.diff().abs().fillna(0)
    cost_per_unit_change = (p.spread_pips * p.pip_size) / df["close"]
    costs = exposure_change * cost_per_unit_change
    net_pnl = gross_pnl - costs
    out = df.copy()
    out["gross_pnl"] = gross_pnl
    out["costs"] = costs
    out["net_pnl"] = net_pnl
    out["equity"] = (1 + out["net_pnl"]).cumprod()
    return out


# ─────────────────────────────────────────────────────────────────
# 4. VALIDACIÓN — walk-forward, gates, Monte Carlo (honesto, sin atajos)
# ─────────────────────────────────────────────────────────────────

GATES = dict(
    min_trades=50,
    min_win_rate=0.40,      # trend-following gana menos veces pero más grande
    min_profit_factor=1.30,
    min_expectancy_pct=0.05,
    min_tstat=2.0,
    max_drawdown_pct=25.0,
)


def daily_pnl_to_trades(net_pnl: pd.Series, rebalance_days: int) -> np.ndarray:
    """Agrupa el PnL diario en bloques de `rebalance_days` para tratar
    cada periodo de rebalanceo como un 'trade' — consistente con cómo
    se ejecuta la estrategia (no hay 'trade' diario real, hay posiciones
    que se mantienen semanas)."""
    n = len(net_pnl)
    n_blocks = n // rebalance_days
    trimmed = net_pnl.values[: n_blocks * rebalance_days]
    blocks = trimmed.reshape(n_blocks, rebalance_days)
    return blocks.sum(axis=1)


def sharpe_tstat(trade_returns: np.ndarray) -> tuple[float, float]:
    n = len(trade_returns)
    if n < 2:
        return 0.0, 0.0
    mean = trade_returns.mean()
    std = trade_returns.std(ddof=1)
    sharpe = mean / std if std > 0 else 0.0
    tstat = sharpe * math.sqrt(n)
    return sharpe, tstat


def max_drawdown_pct(trade_returns: np.ndarray) -> float:
    cum = np.cumsum(trade_returns)
    peak = np.maximum.accumulate(cum)
    dd = peak - cum
    return float(dd.max() * 100) if len(dd) else 0.0


def scorecard(trade_returns: np.ndarray) -> dict:
    n = len(trade_returns)
    wins = trade_returns[trade_returns > 0]
    losses = trade_returns[trade_returns < 0]
    win_rate = len(wins) / n if n else 0.0
    gross_win = wins.sum()
    gross_loss = abs(losses.sum())
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else (3.0 if gross_win > 0 else 0.0)
    expectancy_pct = trade_returns.mean() * 100 if n else 0.0
    _, tstat = sharpe_tstat(trade_returns)
    dd = max_drawdown_pct(trade_returns)

    checks = {
        "sample_size": (n, GATES["min_trades"], n >= GATES["min_trades"]),
        "win_rate": (round(win_rate * 100, 1), GATES["min_win_rate"] * 100, win_rate >= GATES["min_win_rate"]),
        "profit_factor": (round(profit_factor, 2), GATES["min_profit_factor"], profit_factor >= GATES["min_profit_factor"]),
        "expectancy_pct": (round(expectancy_pct, 4), GATES["min_expectancy_pct"], expectancy_pct > GATES["min_expectancy_pct"]),
        "tstat": (round(tstat, 2), GATES["min_tstat"], tstat >= GATES["min_tstat"]),
        "max_drawdown_pct": (round(dd, 1), GATES["max_drawdown_pct"], dd <= GATES["max_drawdown_pct"]),
    }
    verdict = "GO" if all(c[2] for c in checks.values()) else "NO_GO"
    if n < 30:
        verdict = "INSUFFICIENT_DATA"
    return {"n_trades": n, "win_rate": win_rate, "profit_factor": profit_factor,
            "expectancy_pct": expectancy_pct, "tstat": tstat, "max_dd_pct": dd,
            "checks": checks, "verdict": verdict}


def monte_carlo(trade_returns: np.ndarray, n_sims: int = 2000, seed: int = 7) -> dict:
    """Bootstrap: remuestrea la secuencia de trades para exponer el
    escenario de mala suerte (percentil 5), en vez de confiar en el
    único camino histórico realizado."""
    if len(trade_returns) < 10:
        return {}
    rng = np.random.default_rng(seed)
    n = len(trade_returns)
    totals = np.empty(n_sims)
    dds = np.empty(n_sims)
    for i in range(n_sims):
        sample = rng.choice(trade_returns, size=n, replace=True)
        totals[i] = sample.sum() * 100
        dds[i] = max_drawdown_pct(sample)
    return {
        "p5_total_return_pct": float(np.percentile(totals, 5)),
        "p50_total_return_pct": float(np.percentile(totals, 50)),
        "p95_drawdown_pct": float(np.percentile(dds, 95)),
    }


def walk_forward_report(prices: pd.Series, p: StrategyParams, train_frac: float = 0.6) -> dict:
    df_signals = build_signals(prices, p)
    bt = run_backtest(df_signals, p)

    split = int(len(bt) * train_frac)
    train, test = bt.iloc[:split], bt.iloc[split:]

    train_trades = daily_pnl_to_trades(train["net_pnl"], p.rebalance_days)
    test_trades = daily_pnl_to_trades(test["net_pnl"], p.rebalance_days)

    train_score = scorecard(train_trades)
    test_score = scorecard(test_trades)

    # consistencia temporal: ambas mitades del OOS deben ser positivas
    mid = len(test_trades) // 2
    h1, h2 = test_trades[:mid], test_trades[mid:]
    consistent = (h1.mean() > 0 if len(h1) else False) and (h2.mean() > 0 if len(h2) else False)

    mc = monte_carlo(test_trades)

    survived = (
        test_score["verdict"] not in ("NO_GO", "INSUFFICIENT_DATA")
        and consistent
    )

    return {
        "period": {"start": str(bt.index[0]), "end": str(bt.index[-1]), "n_days": len(bt)},
        "train": train_score,
        "test": test_score,
        "temporal_consistency": {"h1_mean_pct": float(h1.mean() * 100) if len(h1) else None,
                                   "h2_mean_pct": float(h2.mean() * 100) if len(h2) else None,
                                   "consistent": consistent},
        "monte_carlo_oos": mc,
        "final_verdict": "GO" if survived else test_score["verdict"] if test_score["verdict"] == "INSUFFICIENT_DATA" else "NO_GO",
        "equity_curve_test": bt["equity"].iloc[split:].tolist(),
    }


# ─────────────────────────────────────────────────────────────────
# 5. CLI
# ─────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Forex trend-following — validación honesta")
    ap.add_argument("--csv", required=True, help="Ruta a CSV con columnas Date,Close (precios reales)")
    ap.add_argument("--pair", default="PAIR")
    ap.add_argument("--lookback", type=int, default=252)
    ap.add_argument("--rebalance", type=int, default=21)
    ap.add_argument("--spread-pips", type=float, default=1.0)
    ap.add_argument("--jpy-pair", action="store_true", help="usa pip_size=0.01 (pares con JPY)")
    args = ap.parse_args()

    prices = load_price_csv(args.csv)
    params = StrategyParams(
        lookback_days=args.lookback,
        rebalance_days=args.rebalance,
        spread_pips=args.spread_pips,
        pip_size=0.01 if args.jpy_pair else 0.0001,
    )

    report = walk_forward_report(prices, params)

    print(f"\n{'='*60}")
    print(f"  GENESIS FX — {args.pair} — Time-Series Momentum")
    print(f"{'='*60}")
    print(f"Periodo: {report['period']['start']} → {report['period']['end']} "
          f"({report['period']['n_days']} velas)")

    def print_slice(name, s):
        print(f"\n[{name}]  n_trades={s['n_trades']}  "
              f"win_rate={s['win_rate']*100:.1f}%  "
              f"PF={s['profit_factor']:.2f}  "
              f"expectancy={s['expectancy_pct']:.4f}%  "
              f"t-stat={s['tstat']:.2f}  "
              f"maxDD={s['max_dd_pct']:.1f}%")

    print_slice("TRAIN (in-sample, 60%)", report["train"])
    print_slice("TEST  (out-of-sample, 40%)", report["test"])

    tc = report["temporal_consistency"]
    print(f"\nConsistencia temporal OOS: mitad1={tc['h1_mean_pct']:.4f}%  "
          f"mitad2={tc['h2_mean_pct']:.4f}%  → "
          f"{'CONSISTENTE' if tc['consistent'] else 'INCONSISTENTE (huele a racha)'}")

    if report["monte_carlo_oos"]:
        mc = report["monte_carlo_oos"]
        print(f"\nMonte Carlo (2000 remuestreos sobre OOS):")
        print(f"  Percentil 5 (mala suerte):  {mc['p5_total_return_pct']:.2f}%")
        print(f"  Mediana:                    {mc['p50_total_return_pct']:.2f}%")
        print(f"  Percentil 95 drawdown:      {mc['p95_drawdown_pct']:.1f}%")

    print(f"\n{'='*60}")
    print(f"  VEREDICTO FINAL: {report['final_verdict']}")
    print(f"{'='*60}")
    if report["final_verdict"] != "GO":
        failing = [k for k, v in report["test"]["checks"].items() if not v[2]]
        if failing:
            print(f"  Falló: {', '.join(failing)}")
        if not tc["consistent"]:
            print(f"  Falló: consistencia temporal (edge no sostenido en ambas mitades OOS)")
        print(f"  → NO se activa capital real. Esto es correcto, no un bug.")
    else:
        print(f"  → Pasa validación OOS. Aún así: mínimo 8-12 semanas de paper")
        print(f"    trading forward antes de considerar capital real.")

    out_path = Path(args.csv).with_suffix(".report.json")
    with open(out_path, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\nReporte completo guardado en: {out_path}")


if __name__ == "__main__":
    main()
