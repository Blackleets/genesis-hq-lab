from __future__ import annotations

import hashlib
from pathlib import Path

import pandas as pd
import yfinance as yf

OUT = Path(__file__).resolve().parent / "data"
OUT.mkdir(parents=True, exist_ok=True)
START = "2012-12-04"
END = "2022-03-05"  # yfinance end is exclusive; captures through 2022-03-04

FX_SCALES = {
    "EURUSD": 100000.0,
    "GBPUSD": 100000.0,
    "USDJPY": 1000.0,
    "AUDUSD": 100000.0,
    "USDCAD": 100000.0,
    "USDCHF": 100000.0,
    "XAUUSD": 100.0,
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save_date_close(name: str, dates, closes, source: str) -> Path:
    df = pd.DataFrame({"Date": pd.to_datetime(dates), "Close": pd.to_numeric(closes, errors="coerce")})
    df = df.dropna().sort_values("Date").drop_duplicates("Date")
    df = df[(df["Date"] >= pd.Timestamp(START)) & (df["Date"] < pd.Timestamp(END))]
    if len(df) < 500:
        raise RuntimeError(f"{name}: insufficient rows after formatting: {len(df)}")
    path = OUT / f"{name}.csv"
    df.to_csv(path, index=False, date_format="%Y-%m-%d")
    print(
        f"DATA_OK name={name} source={source} rows={len(df)} "
        f"start={df['Date'].iloc[0].date()} end={df['Date'].iloc[-1].date()} sha256={sha256(path)}"
    )
    return path


def download_ejtrader(name: str, scale: float) -> Path:
    url = f"https://raw.githubusercontent.com/ejtraderLabs/historical-data/main/{name}/{name}d1.csv"
    raw = pd.read_csv(url)
    cols = {str(c).strip().lower(): c for c in raw.columns}
    date_col = cols.get("date")
    close_col = cols.get("close")
    if date_col is None or close_col is None:
        raise RuntimeError(f"{name}: unexpected ejtrader columns {list(raw.columns)}")
    return save_date_close(name, raw[date_col], raw[close_col].astype(float) / scale, url)


def download_yahoo(name: str, ticker: str) -> Path:
    raw = yf.download(ticker, start=START, end=END, interval="1d", auto_adjust=False, progress=False)
    if raw is None or raw.empty:
        raise RuntimeError(f"{name}: empty yfinance response for {ticker}")
    close = raw["Close"]
    if isinstance(close, pd.DataFrame):
        if close.shape[1] != 1:
            raise RuntimeError(f"{name}: ambiguous Close columns for {ticker}: {list(close.columns)}")
        close = close.iloc[:, 0]
    return save_date_close(name, close.index, close.values, f"yfinance:{ticker}")


def main() -> None:
    print(f"DATA_WINDOW start={START} end_inclusive=2022-03-04")
    print(f"YFINANCE_VERSION {yf.__version__}")
    for name, scale in FX_SCALES.items():
        download_ejtrader(name, scale)

    download_yahoo("SP500", "^GSPC")
    download_yahoo("WTI", "CL=F")

    # Use the 10Y Treasury Note future because it is a tradable bond-price series,
    # unlike ^TNX which is a yield index. If ZN is unavailable, fail loudly rather
    # than silently changing the economic exposure.
    download_yahoo("UST10Y", "ZN=F")

    # Diagnostic only: preserve ^TNX because it was explicitly requested, but do
    # not put both TNX and ZN in the risk-parity portfolio (same rates factor twice).
    download_yahoo("TNX_DIAGNOSTIC", "^TNX")


if __name__ == "__main__":
    main()
