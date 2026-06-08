# Next-session prompt (paste into a fresh Claude Code session)

Eres un principal quant + platform engineer en **Genesis HQ** (repo: `c:\Users\Usuario\genesis-hq-lab`,
branch de trabajo `feat/genesis-life-os`, también pusheas a `main`). Backend en Render
(`https://genesis-hq-backend.onrender.com`, auto-deploy desde GitHub, ~4 min). Frontend en Vercel.
Persistencia híbrida VIVA: SQLite local + Supabase Postgres (`DB_MODE=hybrid`, `DATABASE_URL` ya en
Render). NO la rompas.

## Estado honesto (sin humo)
El paper-trading es REAL (Binance real, señales reales, fills paper en SQLite). La infra es real
(persistencia durable, telemetría, regime bias, auto-veto). PERO: el edge del scalp es **no probado
y probablemente negativo** (histórico 34% WR, PF 0.26, EV −$0.42; calibración 43/100 =
sobreconfianza). Los 5 "agentes IA" (ATLAS/NOVA/SENTINEL/CURATOR/ARBITER) están **idle** (no hay loop
autónomo). El auto-veto está construido pero **dormant** (necesita ≥20 muestras/setup).

## Reglas (no negociables)
- Additive only. **NO toques**: execution engine, risk engine, safe mode, daily caps, Kelly, TP/SL,
  paper-trading, ni la API síncrona de better-sqlite3 (hot path).
- `logEvent({category,severity,subsystem,reason,metadata})` (forma objeto, nunca posicional).
- `npm run build` solo valida el frontend → corre `node --check <archivo>.mjs` en los server files que
  toques (hay `server/tests/serverSyntax.test.mjs` que valida todos). `npm test` debe quedar verde.
- Deploy: commit → push `feat/genesis-life-os` → `git checkout main && git merge feat/... --ff-only &&
  git push origin main && git checkout feat/...`. Verifica EN VIVO con curl a los endpoints.
- Después de cada fix: build + test + deploy + **verifica en producción con curl** + reporta números
  reales (sin afirmar éxito sin evidencia).

## Ataca 1 a 1, en este orden:

**1. BUG de reporte de PnL (lo primero — sin esto no se sabe si gana o pierde).**
`GET /api/crypto/overview` reporta 0 closed trades aunque hay trades cerrados reales (el autopsy ve
setups). Causa: el query de PnL filtra `trade_type='crypto_scalp'` (legacy) pero el motor vivo escribe
`scalp_v2` (y swing_v1). Busca el query en `server/crypto/cryptoAnalytics.mjs` (getCryptoOverview /
PnL) y amplíalo a `trade_type IN ('crypto_scalp','scalp_v2','swing_v1')`. Verifica:
`/api/crypto/overview` → `pnl.closed.total > 0` y coincide con `/api/crypto/diagnostics → autopsy.setups`.

**2. Medición real del edge.** Asegura que `/api/crypto/diagnostics → autopsy` y
`/api/crypto/regime-backtest` den WR/EV/PF/profit-factor reales sobre los trades acumulados. Si hace
falta, añade un resumen claro "scalp edge: positivo/negativo" al autopsy. Reporta los números actuales.

**3. Activación del auto-veto.** Está en `server/crypto/autoVeto.mjs`, dormant hasta ≥20 muestras/setup
(`VETO_MIN_SAMPLES`). Evalúa si bajar el umbral a ~12 durante training (env `VETO_MIN_SAMPLES`) para que
se active antes y veas si poda a los perdedores. NO fuerces vetos; solo ajusta el umbral con criterio y
documenta. Verifica `autopsy.vetoes` en producción.

**4. Claude créditos.** `claudeEnabled:true` solo significa que la key existe; los logs mostraban
"credit balance too low". Verifica si `debateRoom`/agentes realmente razonan o caen a fallback. Si no
hay créditos, NO inventes IA — déjalo determinístico y dilo claro. (Esto puede requerir acción del
operador: añadir créditos en Anthropic.)

**5. Solo si #1–#4 muestran que el core es sano: Phase 4 — agentes autónomos.** Sigue
`docs/codex-handoff.md` Task C: `server/agents/delegationOrchestrator.mjs` (loop lento 5–10 min en
`agentRunner.mjs`, gated por `isDeptActive('research')`) que pone a ATLAS/NOVA/CURATOR a escanear
mercado + `server/research/*` (news/HN/reddit) y alimentar `signals`/`lessons`. Persiste heartbeat +
`operator_events`. Endpoint `GET /api/agents/delegation`. NO antes de probar el edge.

## Verificación final
Cada fix: `npm test` verde, deploy, y curl en vivo:
`/api/db/health` (connected:true), `/api/crypto/overview` (PnL correcto),
`/api/crypto/diagnostics` (loops LIVE, autopsy, vetoes). Reporta la VERDAD numérica: ¿el scalp gana o
pierde tras N trades? Si pierde incluso con el veto, recomienda cambiar/apagar la estrategia — no más
features sobre un sistema perdedor.

Empieza por el #1. Lee `docs/codex-handoff.md` y `docs/superpowers/specs/` para contexto. Sé directo y
basado en evidencia.
