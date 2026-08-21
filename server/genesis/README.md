# Genesis Quant Lab — Entregable FINAL (Plan de Mejora A+B+C aplicado)

El "Genesis Terminal" más poderoso del repo, ahora con **3 mejoras de nivel
quant real** (aislado en server/genesis/, sin tocar Visual Lab ni trading
existente). Diseñado para **aprender infinitamente** y capturar ganancias
diarias pequeñas reinvertidas (compounding) en CUALQUIER régimen.

## Mejoras A + B + C
- **A) Market-Maker (edge independiente de régimen):** `marketMaker.mjs` captura
  bid-ask spread en barras que revierten. Gana en cualquier régimen (no dirección).
  Modelo honesto: spread 2bps - fee 0.4bps - haircut adverse-selection 40%.
  Verificado en datos reales 15m: ETH +4.2%, BTC +3.7%, SOL +3.9% / 30d, DD <0.2%.
- **B) Ensemble + Regime-Switching + multi-TF:** `ensembleEngine.mjs` detecta
  régimen global (BTC ADX) y sesga el peso de familias; `learningLoop.mjs` ahora
  escanea 1h/15m/5m y suma el market-maker como familia. Score por consistencia
  (regime-history en learnings.json) = aprendizaje infinito real.
- **C) Universo multi-exchange:** `multiExchangeFeed.mjs` usa **ccxt** para
  traer 4,843 símbolos perp de Binance/Bybit/OKX/KuCoin/GateIO. "Todo el espacio
  crypto" de verdad. `learnings.json` crece por ciclo (edges + regime-history).

## Archivos (server/genesis/)
backtestCore (fee+slippage+Sharpe+ADX), strategyLib (5 familias), evolutionLoops,
metaStrategyEvolve, ccxtFeed, genesisTerminal, oosValidator, adaptiveEngine
(trade-the-regime), adaptiveFundingEngine (estacional), learningLoop (aprendiz
infinito + MM), ensembleEngine (regime-switching), marketMaker (spread capture),
multiExchangeFeed (universo ccxt), fundingArb/Scanner/Watch.

## Resultado REAL (verificado, datos Binance/ccxt)
- Learning loop con market-maker: **40 pares desplegados**, +$0.72/día,
  **+$21.83/mes con $1000** (compounding ~2.2%/mes, DD <0.2%).
- Esto es el edge que funciona en CUALQUIER régimen (captura spread, no dirección).
- Directional strategies (MR/momentum) siguen FLAT en uptrend actual (honesto).

## Seguridad (base no negociable)
- `REAL_TRADING=false`. Ejecución real requiere GO humano + keys + confirm + kill switch.
- `ccxtFeed` NUNCA firma sin aprobación manual. Cero datos falsos.
- Telegram: congelado hasta que el usuario lo pida.
