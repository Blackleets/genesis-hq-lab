# PumpFun (Solana Alpha) serverless end-to-end — design

Fecha: 2026-06-15
Estado: aprobado (diseño)

## Problema

El área PumpFun (Solana Alpha) está muerta en producción:

- El frontend (prod, `VITE_API_BASE` vacío) llama a `/api/solana/*` en Vercel.
- `api/solana.js` **solo** intenta Postgres directo. Vercel no tiene `POSTGRES_URL` →
  `solanaStatus()` devuelve `"Provider not configured"` y todo sale vacío / en 0.
- Aunque tuviera Postgres, **nada llena** las tablas `solana_tokens / solana_signals /
  solana_paper_trades / solana_equity_snapshots`. El proceso que las llenaba
  (`server/solana-alpha/`, Node persistente con WebSocket a PumpPortal) no corre en
  ningún lado — la arquitectura es serverless puro (no hay Railway/Render).

## Patrón existente que SÍ funciona (a replicar)

- **Lectura**: `api/crypto/overview.js` → `fetchRemoteFallback('crypto-overview')` →
  edge `genesis-fallback?route=crypto-overview` (lee Supabase con service role) →
  JSON. Postgres queda como secundario.
- **Escritura (feeder)**: edge cron `genesis-runner` trae datos de una API pública
  (Binance), corre paper trading del futures desk y escribe a Supabase. Stateless:
  cada tick lee su estado de la DB.

PumpFun necesita las dos mitades.

## Arquitectura — 3 piezas

### 1. Feeder (escritura): nuevo paso en `genesis-runner`

Archivo nuevo `supabase/functions/genesis-runner/solanaAlpha.ts`, invocado una vez por
tick del cron existente (no se añade un cron nuevo).

Fuente de datos: **API pública de pump.fun** (verificada respondiendo a fetch de
servidor):

```
GET https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=created_timestamp&order=DESC&includeNsfw=false
```

Header `accept: application/json` + un `user-agent` de navegador.

Por tick:

1. **Fetch + upsert tokens** → `solana_tokens` (PK `mint`):
   - `name`, `symbol`, `creator`, `created_ts` = `created_timestamp` (ms).
   - `market_cap_sol` = `market_cap` (ya viene en SOL).
   - `last_price_sol` = `virtual_sol_reserves / virtual_token_reserves` ajustado por
     decimales (fallback: `market_cap / (total_supply / 10^base_decimals)`).
   - `bonding_curve_pct` = progreso de la curva calculado desde
     `real_token_reserves` vs `total_supply` (graduación pump.fun), cap 0–100. Si
     `complete === true` → 100.
   - `trade_count` = `reply_count` (proxy; la API no expone trade count real).
   - `updated_at` = ahora.
   - Upsert idempotente (`ON CONFLICT (mint) DO UPDATE`).

2. **Generar señales** → `solana_signals` (idempotente por `(token_mint, signal_type)`
   reciente para no duplicar): regla v1 = lanzamiento fresco (edad < ~30 min) **y**
   `bonding_curve_pct` en banda de momentum (p.ej. 5–60%) **y** market cap subiendo
   respecto al valor previo guardado. `confidence` derivada de bonding pct +
   frescura. `signal_type = 'momentum_launch'`.

3. **Tick de paper trading** (mismo estilo que el futures desk, stateless):
   - Lee balance de `org_state` key `solana_paper_balance` (default 100 SOL).
   - Abre posición paper en señales BUY nuevas no `acted_on`, tamaño = fracción del
     balance (p.ej. 2 SOL o 5% del balance, lo menor), respetando un máximo de
     posiciones abiertas. Marca la señal `acted_on = 1`, enlaza `trade_id`.
   - Para cada posición abierta: actualiza `current_price_sol` desde el último
     `last_price_sol` del token; aplica SL / TP1-3 / trailing usando los pct ya
     definidos en la tabla; cierra (`status='closed'`, `pnl_sol`, `pnl_pct`,
     `closed_at`) cuando toca; acumula `realized_sol`.
   - Recalcula balance y escribe `org_state` `solana_paper_balance` +
     un snapshot en `solana_equity_snapshots` (`balance_sol`, `open_value_sol`,
     `total_sol`, `ts`).
   - Si un token de una posición abierta deja de aparecer en el feed por mucho
     tiempo, se mantiene su último precio (no se inventa); el trailing/SL lo cerrará
     con el último dato disponible.

Manejo de errores: si el fetch a pump.fun falla (timeout / Cloudflare 1016/503), el
paso solana **se salta silenciosamente** ese tick y deja el resto del runner intacto
(no rompe el futures desk). Se loguea y se reintenta el próximo tick.

### 2. Lectura: rutas solana en `genesis-fallback` + fallback en Vercel

- En `supabase/functions/genesis-fallback/index.ts`, agregar al `switch (route)`:
  `solana-status`, `solana-tokens`, `solana-signals`, `solana-paper-stats`,
  `solana-paper-positions`, `solana-paper-trades`, `solana-paper-equity`. Cada una
  lee las tablas Supabase con el cliente service-role ya inicializado y devuelve el
  mismo shape que hoy produce `api/_lib/solanaFallback.js`.
- Reescribir `api/solana.js`: por cada GET, intentar primero
  `fetchRemoteFallback('solana-<x>', { limit })`; si lanza, caer a la versión
  Postgres existente (`solanaFallback.js`); si ambas fallan, error JSON. Esto elimina
  el `"Provider not configured"` en prod sin tocar el frontend.
- `paper/reset` sigue devolviendo 409 (read-only snapshot) como ahora.

### 3. Tablas en Supabase: migración SQL

Nueva migración `supabase/migrations/20260615_solana_alpha_tables.sql` que porta el
DDL de `server/solana-alpha/migrations.mjs` a Postgres:

- `solana_tokens`, `solana_paper_trades`, `solana_signals`, `solana_equity_snapshots`.
- `created_ts` → `bigint`; timestamps `text`/`datetime('now')` → `timestamptz default now()`;
  `id` autoincrement → `bigserial` / `text` según la tabla; booleans-como-int se
  mantienen `int` para no romper el shape que el frontend ya consume.
- Seed: un snapshot inicial de equity (100 SOL) si la tabla está vacía.

El usuario aplica esta migración en el SQL Editor de Supabase (igual que la de
pg_cron pendiente). Se entrega lista para copiar/pegar.

## Fuera de alcance (YAGNI v1)

- **`solana_wallets` / smart-money**: requiere tracking on-chain que la API pública de
  pump.fun no provee. La sección de wallets queda vacía/oculta hasta tener fuente. El
  endpoint `wallets` puede seguir devolviendo lista vacía.
- Trading real: se mantiene **paper trading** (regla 2 de la constitución).
- Trade count / unique wallets reales: se usan proxies (`reply_count`), no se hace
  scraping de trades on-chain.

## Criterio de éxito

Tras desplegar y correr 1–2 ticks del cron:

- `GET /api/solana/status` → `connected: true`, `wsStatus` con N launches.
- `GET /api/solana/tokens` → monedas reales recientes de pump.fun.
- `GET /api/solana/signals` → al menos algunas señales `momentum_launch`.
- `GET /api/solana/paper/stats` → balance que evoluciona; `solana_equity_snapshots`
  con puntos en el tiempo.
- El área PumpFun del frontend se ve viva (tokens + señales + P&L paper) sin tocar el
  frontend.

## Componentes y límites

| Unidad | Hace | Depende de |
|---|---|---|
| `solanaAlpha.ts` (feeder) | fetch pump.fun → upsert tokens, señales, paper tick, equity | API pump.fun, cliente Supabase del runner |
| rutas `solana-*` en genesis-fallback | leer tablas y devolver shape del cliente | Supabase service-role |
| `api/solana.js` | remote-first, Postgres-fallback | `remoteFallback.js`, `solanaFallback.js` |
| migración SQL | crear tablas Postgres | SQL Editor Supabase (acción del usuario) |
