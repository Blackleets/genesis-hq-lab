# Pro Candle Chart — drawing tools, auto-analysis & full indicator suite

Date: 2026-06-14
Area: `src/dashboard/charts/CandleChart.tsx` (Crypto Lab chart, lightweight-charts v5)

## Goal

Turn the existing candlestick chart into a professional trading terminal:
bigger, with a full indicator suite, a crosshair OHLCV tooltip, manual drawing
tools (trend line, horizontal level, rectangle) that persist, and an **AUTO**
mode that detects and draws support/resistance + trend lines on its own and
keeps them updated as new candles arrive ("alive").

## Modules

- **`chartAnalysis.ts`** (new) — pure functions over candles: swing-high/low
  pivot detection (window N), support/resistance clustering + touch-count
  ranking, and trend-line fitting from recent swing highs/lows. No IO, no React.
- **`chartDrawings.ts`** (new) — figure types (`TrendLine`, `HLevel`, `Rect`)
  and a lightweight-charts **series primitive** that renders both manual and
  auto figures onto the chart canvas (price/time → pixel via the series & time
  scale). Auto figures: dotted/dim. Manual: solid/vivid.
- **`useChartDrawings.ts`** (new) — React hook: active tool, click/drag capture
  to create figures, select + delete, clear-all, and localStorage persistence
  keyed per pair (`gx:drawings:<PAIR>`). Only manual figures persist.
- **`chartIndicators.ts`** (new) — pure indicator math: EMA (any period),
  Bollinger Bands (20, 2σ), VWAP, RSI(14), MACD(12,26,9).
- **`ChartDrawToolbar.tsx`** (new) — floating vertical toolbar: cursor, trend,
  horizontal, rect, delete, clear, and the **AUTO** on/off toggle.
- **`CandleChart.tsx`** (modify) — wire in the primitive, toolbar, crosshair
  tooltip, the indicator toggles, RSI/MACD sub-panes, expand-to-fullscreen
  button, and taller default height.

## Features

| Feature | Notes |
|---|---|
| Bigger chart | Raise min height; add a maximize button → fullscreen overlay. |
| Indicators | Toggles: EMA 9/21/50/200, Bollinger, VWAP (main pane); RSI, MACD (sub-panes via v5 panes). Volume stays. |
| Crosshair tooltip | `subscribeCrosshairMove` → floating box with O/H/L/C, %chg, volume. |
| Manual draw | Trend line (2 clicks), H-level (1 click), rectangle (2 clicks). Click a figure to select; delete/clear. Persisted per pair. |
| AUTO draw | Pivot-based S/R levels (ranked by touches) + diagonal trend lines from recent swing highs/lows. Recomputed on candle reload/tick. Dotted/dim. Toggle AUTO. |

## Out of scope

Fibonacci, dragging/editing existing figures (create + delete only), MACD
histogram coloring nuance beyond up/down, drawing sync across devices.

## Coexistence

AUTO and manual layers render together; the AUTO toggle only shows/hides the
auto layer. Both go through the same primitive renderer so they share one draw
pass.

## Verification

`npm run typecheck` + `npm run build` after each module; manual smoke on
`genesis-hq-lab.vercel.app` Crypto Lab after deploy (draw a line, toggle AUTO,
toggle each indicator, expand).
