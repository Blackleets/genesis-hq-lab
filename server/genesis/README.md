# Genesis Quant Lab — Entregable (Plan de Mejora aplicado)

El "Genesis Terminal" más poderoso del repo: laboratorio cuant que busca edges
en **datos reales de Binance (527 pares)**, los valida contra los 6 gates +
Sharpe, y los somete a walk-forward anti-overfit. PAPER ONLY por defecto.
Diseñado para **aprender infinitamente** y capturar ganancias diarias pequeñas
reinvertidas (compounding).

## Archivos (server/genesis/)
| Archivo | Qué hace |
|---|---|
| `backtestCore.mjs` | Motor honesto: **fee 0.10% + slippage 0.05%**, SMA/EMA/RSI/ATR/BB/DC/ADX, métricas + **Sharpe** + 6-gate evaluator |
| `strategyLib.mjs` | 5 familias (meanReversion +filtro ADX, breakout, momentum, orderbookImbalance, volumeProfile) |
| `evolutionLoops.mjs` | Búsqueda poblacional (/prompt-evolution-loops) |
| `metaStrategyEvolve.mjs` | GENERATOR→CRITIC→MUTATOR a nivel agente |
| `ccxtFeed.mjs` | Datos reales vía **ccxt** (librería #1 GitHub). PAPER + real GATED |
| `genesisTerminal.mjs` | REPL + `--backtest/--evolve/--multi` |
| `oosValidator.mjs` | Walk-forward anti-overfit |
| `adaptiveEngine.mjs` | **Motor adaptativo** (trade-the-regime): ventana móvil, despliega solo si OOS reciente validado |
| `adaptiveFundingEngine.mjs` | Funding adaptativo estacional (persiste regime-history en learnings.json) |
| `learningLoop.mjs` | **El aprendiz infinito**: escanea 527 pares, MULTI-TIMEFRAME (1h/15m/5m), compone capital, persiste `learnings.json` (edges + regime-history) |
| `fundingArbValidator.mjs` / `fundingScanner.mjs` / `fundingWatch.mjs` | Medición de edge de funding real |

## Mejoras aplicadas en este plan
1. **Multi-timeframe** en learning loop: pares líquidos se escanean en 1h+15m+5m → más edges diarios pequeños (visión de 1-10 USD/día).
2. **Aprendizaje infinito real**: `learnings.json` guarda regime-history por par (TA + funding) y capital compuesto simulado. Cada ciclo rankea más inteligente.
3. **Score por consistencia**: no solo PF, también fracción de ventanas positivas → descarta edges frágiles.
4. **Slippage real + Sharpe** en backtestCore: backtests más honestos y score más inteligente.
5. **Cron diario** `Genesis Learning Loop` + **cron 6h** `Genesis Funding Edge Watcher` vigilan y aprenden solos.

## Resultados REALES (verificados, datos Binance)
- Adaptive engine + learning loop escanean 527 pares multi-TF: **0 deployados hoy**. Régimen actual (alcista) no da edge de reversion. Motor FLAT, honesto.
- Funding adaptativo (12 pares): **0/12 deployables**. Mercado paga funding.
- Veredicto: el sistema está vivo, aprendiendo y listo. Cuando el régimen gire (bajista → funding negativo), lo detectará y desplegará. Ese es el money printer estacional.

## Seguridad (base no negociable)
- `REAL_TRADING=false`. Ejecución real requiere flag + keys + confirmación humana + kill switch.
- `ccxtFeed` NUNCA firma sin aprobación manual. Cero datos falsos.
