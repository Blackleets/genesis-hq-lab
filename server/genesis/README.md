# Genesis Quant Lab — Motor Cuant Incorruptible

> "Poderoso porque incorruptible, no porque tenga muchas luces."

Laboratorio cuant autocontenido dentro de genesis-hq-lab-real: busca edges en
datos reales de Binance, los valida con 6 gates institucionales + walk-forward
con warmup + lookahead guard, y ejecuta paper trading 24/7 automatizado.
**live_mode = false por diseño estructural.** Cero dólares reales en riesgo.

## Los 6 patrones Hummingbot (implementados y verificados)

| Patrón | Módulo | Nota |
|---|---|---|
| Order lifecycle (PARTIALLY_FILLED incl.) | `connectorCore.mjs` | InFlightOrder + ClientOrderTracker con snapshot/restore |
| Throttling compartido | `rateLimiter.mjs` | AsyncThrottler ponderado multi-limit_id; singleton getSharedThrottler() |
| Fee accounting | `feeAccountant.mjs` | maker/taker desde ccxt loadMarkets; fallback documentado |
| Balance validation | `treasury.mjs` | reserve/release/availableForTrading; ledger append-only |
| Lookahead guard | `backtestCore.mjs` | createCappedCtx bloquea el futuro; señales ejecutan en open[i+1]; violaciones = gate fallido |
| Lost-order detection | `scripts/genesis_paper_connector.py` | Referencia canónica Python (port JS pendiente) |

## Pipeline de validación (por este orden, sin atajos)

```
evalCandidate.mjs          # evaluador one-shot con caché de velas
  └─ backtestCore.mjs      # motor HONESTO: lookahead guard + signal shift
       └─ evaluateGates    # 6 gates institucionales
oosValidator.mjs           # walk-forward con warmup (GENESIS_WARMUP_CANDLES)
shadowCritic.mjs           # heurística anti-"demasiado perfecto"
auditor semanal (cron)     # veredicto sabatino: INSUFICIENTE/OBSERVACIÓN/EDGE/KILL
```

Un candidato solo merece paper capital si sobrevive toda la cadena.

## Optimización

- `evolutionLoops.mjs` — búsqueda genética multi-familia
- `../scripts/optuna_evolve.py` + `../scripts/genesis_losses.py` — Optuna TPE
  con loss registry plugable (--loss fitness|sharpe|calmar|profit_drawdown) y
  poda automática LOOKAHEAD
- Campaña honesta 2026-08-24: familias técnicas clásicas muestran valor marginal
  real (Calmar 1.44 top) una vez eliminado el sesgo — documentado, no maquillado.

## Datos vivos (gratis, sin API key)

- `derivativesContext.mjs` — Open Interest, long/short global, taker flow,
  Fear & Greed (cache 10 min)
- `liquidationStream.mjs` — WebSocket !forceOrder@arr (host
  stream.binancefuture.com; fstream entrega 0 frames en algunas redes)
- `ccxtFeed.mjs` — OHLCV real vía ccxt (presupuesto compartido del throttler)

## Ejecución paper 24/7

- `liveRunner.mjs` — runner por par+timeframe; sizing desde tesorería;
  namespacing opcional por wallet (`GENESIS_OWNER_ADDR` → data/bots/<hash>/)
- `treasury.mjs` — depósitos/retiros de 2 pasos, whitelist humana, cap de desk
- `testnetExecutor.mjs` — GATED: dry-run hasta llaves + TESTNET=true +
  GENESIS_LIVE_GO.txt creado POR EL HUMANO
- Cron horario (perfil Hermes aragan): escanea basket, reporta solo eventos
- Auditor semanal (sábados 20:00): tearsheet QuantStats + veredicto con kill switch

## Multi-usuario (en construcción)

- `../../api/auth/*` — SIWES login (nonce efímero + JWT), rate-limited
- `../../api/genesis/bots.js` — spawn/list/archive de bots por wallet;
  catálogo VALIDADO por nosotros, params editables clamped a nuestros límites,
  max 3 bots/user, $1000 virtuales, liveMode:false estructural
- Auditoría de seguridad: `../../docs/SECURITY_AUDIT.md` (7/7 aprobada)

## Veredictos medidos (honestidad como feature)

| Edge | Método | Resultado |
|---|---|---|
| Familias técnicas (MR/VP/OBI/momentum/breakout) | 340+ trials Optuna, motor honesto | Marginal (Calmar 1.44 top) — documentado |
| Funding arbitrage | Scanner 53 pares × 500 eventos | Perdedor post-fees |
| Market-making naive | Fill-test contra flujo real | Perdedor (adverse selection medida) |

No hay humo: cada veredicto tiene script reproducible y commit.

## Comandos rápidos

```bash
node server/genesis/liveRunner.mjs                    # scan único paper
node server/genesis/treasury.mjs status               # estado tesorería
node server/genesis/derivativesContext.mjs context COTIUSDT
python scripts/optuna_evolve.py --pair COTIUSDT --trials 50 --loss calmar
node server/genesis/shadowCritic.mjs '<reportJson>'   # ¿demasiado perfecto?
node server/genesis/connectorCore.mjs                 # self-test patrones HB
```

## Reglas (AGENTS.md resumidas para este módulo)

1. Nunca main; branch + conventional commits + entrada en docs/CHANGELOG_AI.md
2. Cambios de schema SIEMPRE aditivos (api/genesis/live.js y bots en producción)
3. Sin procesos persistentes sin aprobación humana explícita
4. live_mode=false no se discute; testnet exige GO humano archivado
