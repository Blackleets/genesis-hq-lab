# Genesis HQ Lab

**Un desk de investigación cuantitativa autónomo que corre en tu navegador** —
con agentes que aprenden del mercado real, un laboratorio multi-estrategia con
validación de nivel institucional, wallet connect de solo lectura verificable,
y un modelo de negocio completamente a la vista.

> 🌐 Producción: [genesis-hq-lab.vercel.app](https://genesis-hq-lab.vercel.app)
> · Regla del proyecto: `live_mode = false` — todo es paper trading hasta que
> los gates den GO y un humano decida.

---

## Por qué es distinto

| Capacidad | Qué la hace rara |
|-----------|------------------|
| 🏭 **Laboratorio multi-estrategia** | 3 familias anti-correlacionadas (breakout Donchian, reversión z-score, momentum MA-cross) — ~360 configs barridas por fuerza bruta contra 1000 velas reales de Binance, en el navegador, sin servidor |
| 🛡️ **Validación honesta por construcción** | Costos en cada fill (0.10% round-trip), selección in-sample / veredicto out-of-sample, guard anti-sesgo de selección (t-stat ≥ 2), consistencia temporal (ambas mitades OOS positivas), Monte Carlo bootstrap (peor caso p5) |
| 🧭 **Detector de régimen en vivo** | Efficiency Ratio de Kaufman + volatilidad relativa clasifican el mercado de HOY y nombran qué familia favorece |
| 🏆 **Campeón forward** | La config adoptada se mide SOLO con velas nacidas después de su adopción — el número que ningún backtest puede falsificar |
| 🎯 **GO/NO-GO ganado, no regalado** | 6 gates cuantitativos deben pasar sobre datos reales para declarar "listo para capital real"; activarlo sigue siendo decisión humana manual |
| 🤖 **Agentes que viven** | Los agentes de trading cargan win rate, PnL y trades medidos, y comentan en la oficina pixel-art cuando el veredicto o la config cambian |
| 💼 **Wallet estilo exchange, solo lectura** | Phantom/Solflare + EVM (MetaMask): balance total USD y todos los tokens con precio — la app **jamás** construye, firma o envía transacciones |
| 🔒 **Seguridad auditable** | Contrato de capacidades a la vista (PUEDE/NO PUEDE) + registro local de cada interacción con la wallet, exportable como JSON, nunca subido |
| 💰 **Comisión transparente** | 10% de desempeño solo sobre ganancia neta positiva, tasa y tesorería visibles en código y UI (`src/services/feePolicy.ts`); en paper solo se devenga como display |
| 🌐 **Aprendizaje colectivo opt-in** | Cada trader que acepta comparte métricas de estrategia anónimas (nunca su wallet); todos ven el panorama de la red |

## Arquitectura

```
Navegador (Vercel · React 19 + Vite + TS + Tailwind)
├─ Motor quant local (src/services/localLearningEngine.ts)
│    datos reales Binance → 3 familias → sweep OOS → scorecard → agentes
├─ Wallet multi-cadena solo lectura (solanaWallet.ts · walletOnchain.ts)
├─ Modelo de negocio (feePolicy.ts) + auditoría (walletAudit.ts)
└─ Pool comunitario opt-in (communityLearning.ts → /api/community)

Serverless (Vercel /api) — lecturas Supabase + pool comunitario
Backend 24/7 (Railway/Render · server/) — runner (5 min ticks), optimizador
  walk-forward, lecciones con Claude, scorecard hosted   [claves: DEPLOY.md]
Edge functions (Supabase) — genesis-runner · genesis-fallback · genesis-alerts
```

## Quick start

```bash
npm install
npm run start     # server + agente + optimizador + web
npm run dev       # solo frontend (el motor local funciona igual sin backend)
npm run test      # suite completa del server
npm run build && npm run lint
```

Activación completa de producción (backend 24/7, Telegram, pool comunitario):
ver **[DEPLOY.md](./DEPLOY.md)** — son 3 claves a pegar.

## Los 6 gates para capital real

1. Muestra ≥ 50 trades · 2. Win rate ≥ 45% · 3. Profit factor ≥ 1.30 ·
4. Expectativa > 0.05%/trade · 5. Significancia t-stat ≥ 2.0 · 6. Drawdown ≤ 25%

Todos netos de costos, sobre datos reales out-of-sample. Mientras alguno falle:
**NO-GO**, y el sistema lo dice a la cara.

## Seguridad — verifica, no confíes

- La wallet conectada es **solo lectura**: la app pide la dirección pública y
  nada más. Sin firmas, sin approvals, sin acceso a llaves. Verifícalo en
  `src/services/solanaWallet.ts` — no existe código de firma en el repo.
- Registro de auditoría local y exportable en Wallet → Seguridad auditable.
- La comisión jamás se cobra desde la wallet del usuario: se liquidará en el
  settlement del backend cuando exista ejecución real; hoy solo se muestra.

## Estructura del proyecto

```text
genesis-hq-lab/
├── AGENTS.md              # Reglas para cualquier IA trabajando aquí — LECTURA OBLIGATORIA
├── DEPLOY.md              # Pasos de activación de producción
├── LICENSE                # BUSL-1.1
├── docs/                  # VISION, DESIGN_DIRECTION, SAFE_WORKFLOW, CHANGELOG_AI
├── src/                   # React app (motor quant en src/services/)
├── server/                # Backend Node: runner, optimizador, lecciones
├── api/                   # Funciones serverless de Vercel
├── supabase/              # Edge functions + migraciones
└── public/                # Sprites y assets estáticos
```

## Reglas (versión corta)

1. Nunca trabajar directo sobre la rama por defecto — branch primero.
2. Nunca inventar datos y presentarlos como reales.
3. `live_mode = false` siempre; capital real solo tras GO + decisión humana.
4. Leer `docs/VISION.md` y `docs/DESIGN_DIRECTION.md` antes de tocar UI.
5. Registrar cada tarea en `docs/CHANGELOG_AI.md`.

Reglas completas: `AGENTS.md`.

## Licencia

**Business Source License 1.1** (ver [LICENSE](./LICENSE)): uso personal,
educativo y de investigación libre — incluido tu deployment privado. Uso
comercial (cobrar por él u operarlo para terceros) requiere licencia del
autor. El 2030-07-02 pasa automáticamente a MIT.
