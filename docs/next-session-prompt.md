# Next-session prompt (paste into a fresh Claude Code session)

Eres un principal quant + platform engineer en **Genesis HQ** (repo: `c:\Users\Usuario\genesis-hq-lab`,
branch de trabajo `feat/genesis-life-os`, tambien pusheas a `main`). Backend en Render
(`https://genesis-hq-backend.onrender.com`, auto-deploy desde GitHub, ~4 min). Frontend en Vercel.
Persistencia hibrida VIVA: SQLite local + Supabase Postgres (`DB_MODE=hybrid`, `DATABASE_URL` ya en
Render). NO la rompas.

## Estado honesto (sin humo)

El paper-trading es REAL (Binance real, senales reales, fills paper en SQLite). La infra es real
(persistencia durable, telemetria, regime bias, auto-veto). PERO: el edge del scalp live es
claramente negativo incluso despues de filtros aditivos.

Estado live verificado en Render el 2026-06-08:

- `closedTrades`: 103
- `wins`: 19
- `winRate`: 18.4%
- `totalPnl`: -68.58
- `expectancy`: -0.67
- `profitFactor`: 0.10
- `recommendation`: `pause_or_redesign_strategy`

Filtros aditivos activos hoy:

- `SHORT_BEAR`
- hora `16:00-16:59 UTC`
- banda de confianza `80-89`

Los 5 "agentes IA" (ATLAS/NOVA/SENTINEL/CURATOR/ARBITER) siguen idle. NO abrir Phase 4 sobre este
core. El auto-veto ya esta activo y diagnostics ya expone la verdad operativa.

## Reglas (no negociables)

- Additive only. NO tocar: execution engine, risk engine, safe mode, daily caps, Kelly, TP/SL,
  paper-trading, ni la API sincronica de better-sqlite3.
- `logEvent({category,severity,subsystem,reason,metadata})` siempre en forma objeto.
- `node --check` en server files tocados. `npm test` verde. `npm run build` verde si tocas frontend.
- Deploy: push `feat/genesis-life-os` -> `main` via fast-forward -> push `main`.
- Verifica siempre en vivo con curl a:
  - `/api/db/health`
  - `/api/crypto/overview`
  - `/api/crypto/diagnostics`
  - `/api/crypto/regime-backtest`
- No afirmar mejora sin evidencia numerica real.

## Orden real de trabajo

**1. No volver a arreglar lo ya arreglado.**

Ya estan resueltos y verificados:

- `overview` ya cuenta `crypto_scalp`, `scalp_v2`, `swing_v1`
- `diagnostics`, `overview` y `regime-backtest` ya comparten universo canonico
- Claude/fallback ya expone verdad operativa
- auto-veto y filtros manuales ya estan activos

**2. Seguir `docs/CRYPTO_CORE_RECOVERY_PLAN.md`.**

Ese documento es la fuente de verdad para el siguiente ciclo.

Objetivo inmediato:

- ejecutar Fase 1 completa
- decidir si `scalp_v2` se apaga como estrategia principal
- no abrir trabajo de agentes autonomos ni nuevas features hasta que el edge vuelva a no-negativo

**3. Si se necesita un ultimo corte aditivo, solo uno mas.**

El siguiente slice toxico live es:

- `BNBUSDT`: `EV -0.77`, `PF 0.04`

Solo tocarlo si el operador decide dar una ultima ventana de observacion. No encadenar mas filtros sin
tomar la decision de pausa/rediseno.

**4. Si se entra a rediseno, no meter "mas IA".**

Redisena una sola hipotesis por vez:

- trend continuation puro
- mean reversion puro
- especializacion por par

No mezclar modelos ni abrir agentes autonomos sobre un sistema perdedor.

## Verificacion final

Cada cambio: `npm test` verde, deploy, y curl en vivo. Reporta la verdad numerica:

- el scalp gana o pierde tras N trades
- si `EV < 0` y `PF < 1`, dilo explicitamente
- si sigue negativo, recomienda pausa o rediseno, no mas features

Empieza por `docs/CRYPTO_CORE_RECOVERY_PLAN.md`, luego `docs/codex-handoff.md`. Se directo y basado en
evidencia.
