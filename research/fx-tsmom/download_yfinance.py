from __future__ import annotations
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf

OUT = Path('research-output')
DATA = OUT / 'data'
OUT.mkdir(parents=True, exist_ok=True)
DATA.mkdir(parents=True, exist_ok=True)

INSTRUMENTS = [
    ('EURUSD', 'EURUSD=X'),
    ('GBPUSD', 'GBPUSD=X'),
    ('USDJPY', 'USDJPY=X'),
    ('AUDUSD', 'AUDUSD=X'),
    ('USDCAD', 'USDCAD=X'),
    ('USDCHF', 'USDCHF=X'),
    ('XAUUSD', 'XAUUSD=X'),
]
START = '2010-01-01'
END = (date.today() + timedelta(days=1)).isoformat()
MIN_YEARS = 10.0
MIN_ROWS = 2400


def extract_close(frame: pd.DataFrame, ticker: str) -> pd.Series:
    if frame is None or frame.empty:
        raise ValueError('empty_yfinance_frame')
    if isinstance(frame.columns, pd.MultiIndex):
        if 'Close' not in frame.columns.get_level_values(0):
            raise ValueError(f'close_missing_multiindex:{list(frame.columns)[:6]}')
        close = frame['Close']
        if isinstance(close, pd.DataFrame):
            if ticker in close.columns:
                close = close[ticker]
            elif close.shape[1] == 1:
                close = close.iloc[:, 0]
            else:
                raise ValueError(f'ambiguous_close_columns:{list(close.columns)}')
    else:
        if 'Close' not in frame.columns:
            raise ValueError(f'close_missing:{list(frame.columns)}')
        close = frame['Close']
    return pd.to_numeric(close, errors='coerce').dropna()


def download_one(pair: str, ticker: str) -> dict:
    print(f'YF_DOWNLOAD_BEGIN pair={pair} ticker={ticker} start={START} end={END}', flush=True)
    try:
        frame = yf.download(
            ticker,
            start=START,
            end=END,
            interval='1d',
            auto_adjust=False,
            progress=False,
            threads=False,
            actions=False,
        )
        close = extract_close(frame, ticker)
        if close.empty:
            raise ValueError('close_empty')
        idx = pd.to_datetime(close.index).tz_localize(None) if getattr(close.index, 'tz', None) is not None else pd.to_datetime(close.index)
        out = pd.DataFrame({'Date': idx, 'Close': close.to_numpy(dtype=float)})
        out = out.dropna().drop_duplicates('Date').sort_values('Date')
        first = pd.Timestamp(out['Date'].iloc[0])
        last = pd.Timestamp(out['Date'].iloc[-1])
        span_years = (last - first).days / 365.2425
        if len(out) < MIN_ROWS or span_years < MIN_YEARS:
            raise ValueError(f'insufficient_history rows={len(out)} span_years={span_years:.2f}')
        path = DATA / f'{pair}.csv'
        out.to_csv(path, index=False, date_format='%Y-%m-%d')
        result = {
            'pair': pair,
            'ticker': ticker,
            'status': 'OK',
            'rows': int(len(out)),
            'first_date': first.date().isoformat(),
            'last_date': last.date().isoformat(),
            'span_years': round(span_years, 3),
            'csv': str(path),
        }
        print('YF_DOWNLOAD_OK ' + json.dumps(result, sort_keys=True), flush=True)
        return result
    except Exception as exc:
        result = {'pair': pair, 'ticker': ticker, 'status': 'FAILED', 'error': f'{type(exc).__name__}: {exc}'}
        print('YF_DOWNLOAD_FAILED ' + json.dumps(result, sort_keys=True), file=sys.stderr, flush=True)
        return result


manifest = {
    'source': 'yfinance/Yahoo Finance',
    'yfinance_version': getattr(yf, '__version__', 'unknown'),
    'requested_start': START,
    'requested_end_exclusive': END,
    'minimum_years': MIN_YEARS,
    'minimum_rows': MIN_ROWS,
    'instruments': [download_one(pair, ticker) for pair, ticker in INSTRUMENTS],
}
(OUT / 'download_manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print('YF_MANIFEST ' + json.dumps(manifest, sort_keys=True), flush=True)
if not any(row['status'] == 'OK' for row in manifest['instruments']):
    raise SystemExit(2)
