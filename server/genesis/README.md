# Genesis Quant Lab — Entregable

El "Genesis Terminal" más poderoso del repo: un laboratorio cuant que busca
edges en **datos reales de Binance**, los valida contra los **6 gates** y los
somete a **walk-forward anti-overfit**. PAPER ONLY por defecto.

## Archivos (server/genesis/)
| Archivo | Qué hace |
|---|---|
| `backtestCore.mjs` | Motor honesto: costos 0.10% RT, SMA/EMA/RSI/ATR/Bollinger/Donchian/ADX, métricas + 6-gate evaluator |
| `strategyLib.mjs` | Familias meanReversion (con filtro ADX de régimen), breakout, momentum |
| `evolutionLoops.mjs` | Búsqueda poblacional (`/prompt-evolution-loops`): seed → evaluar (backtest real) → mutar elites |
| `metaStrategyEvolve.mjs` | GENERATOR→CRITIC→MUTATOR a nivel agente (híbridos de elites) |
| `ccxtFeed.mjs` | Datos reales vía **ccxt** (librería #1 GitHub, 100+ exchanges). PAPER + real GATED |
| `genesisTerminal.mjs` | REPL + `--backtest/--evolve/--multi` |
| `oosValidator.mjs` | Walk-forward honesto (anti-overfit) |
| `fundingArbValidator.mjs` | Valida funding arbitrage delta-neutral en datos reales |
| `fundingScanner.mjs` | Escanea 53 pares buscando edge de funding real post-fees |

## Uso
```bash
node server/genesis/genesisTerminal.mjs --backtest COTIUSDT 1h 360 meanReversion '{"adxMax":25}'
node server/genesis/genesisTerminal.mjs --evolve BTCUSDT 1h 360 12
node server/genesis/genesisTerminal.mjs --multi BTCUSDT ETHUSDT SOLUSDT COTIUSDT XLMUSDT 1h 360 14
node server/genesis/oosValidator.mjs COTIUSDT meanReversion '<paramsJson>'
node server/genesis/fundingScanner.mjs
```

## Resultados REALES (verificados, datos Binance)
- Evolución 360d multi-par v1: COTIUSDT meanReversion encontró **GO=true en 180d** (PF 2.16, WR 62%) pero walk-forward lo **rechazó** (régimen cambió, folds tardíos <5 trades).
- **v2 (5 familias: +orderbookImbalance, +volumeProfile)**: `volumeProfile` (reversión a VWAP) es la más prometedora — ETHUSDT PF=1.28/WR=68%, BTCUSDT PF=1.42. Pero walk-forward de 360d **también lo rechaza** (deja de operar en régimen reciente).
- 3 familias clásicas en 1h/15m: ninguna pasa los 6 gates robustamente con >50 trades.
- Funding arbitrage (53 pares, 500 eventos reales c/u): **0 pares con edge positivo post-fees**. Régimen alcista actual → pagas funding.
- **Veredicto**: en el régimen de mercado actual no hay edge robusto y simple. El sistema está listo para detectarlo cuando cambie (cron fundingWatch + re-evolución).

## Conclusión honesta
El laboratorio funciona y es riguroso. La verdad empírica: **en el régimen de
mercado actual, no hay edge fácil** en estas estrategias. Eso es información
que te ahorra quemar capital real. El sistema está listo para cuando aparezca
un régimen con edge (bajista → funding negativo frecuente → el scanner lo
detectará solo).

## Seguridad (base no negociable)
- `REAL_TRADING=false` por defecto. Ejecución real requiere flag + `GENESIS_API_KEY`/`SECRET` + confirmación humana.
- `ccxtFeed.requestRealOrder` NUNCA firma sin aprobación manual.
- Cero datos falsos: todo sale de APIs/backtests reales.
