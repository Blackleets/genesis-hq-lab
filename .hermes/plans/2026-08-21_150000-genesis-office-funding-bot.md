# Genesis HQ Lab — Oficina Viva + Bot de Funding (Plan de Mejora)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Convertir Genesis HQ Lab en una oficina pixel-art VIVA (según VISION.md / DESIGN_DIRECTION.md, que son vinculantes) donde los agentes de trading son empleados reales sentados en escritorios, con burbujas de conversación alimentadas por datos REALES del bot de funding arb (Gist + Binance). Subir el volumen PAPER del bot para que se vea "ganando" de verdad. El Terminal Pro queda como una pantalla en la pared de la oficina, no como landing.

**Architecture:** React/Vite frontend + Node bot PAPER (ya existe en `server/crypto/backtest/fundingTrader.mjs`) que escribe a Gist. El frontend ya tiene un motor de oficina pixel-art (`HQView`, `PixelOfficeCanvas`, `GenesisOfficeWorld`, `tradingAgents.ts` con 5 agentes). Plan: (1) reactivar HQView como landing, (2) conectar el bot de funding al estado de los agentes (status working + burbujas reales), (3) subir volumen PAPER, (4) mostrar equity/funding en la oficina de forma legible en 3 segundos.

**Tech Stack:** React 18, Vite, TypeScript, Canvas 2D (pixel-art renderer ya hecho), Binance public API (CORS `*`), GitHub Gist (via `gh`), Vercel Hobby (12 fn limit — solo 1 fn en `/api`).

---

## Contexto / Estado Actual (verificado)

- Bot PAPER de funding arb FUNCIONA y cobra: Gist tiene FUNDING events reales (usando tasas Binance). Pero volumen minúsculo: 4 trades, 2 FUNDING, $0.0032 cobrado. Edge validado en 20 pares (PF 2–7000).
- Deploy #24 (Terminal Pro con equity=start+funded) en curso.
- Oficina pixel-art YA EXISTE en el repo (`HQView.tsx`, `PixelOfficeCanvas.tsx`, `GenesisOfficeWorld.tsx`, `tradingAgents.ts`) pero está oculta/desactivada como landing (pusimos Terminal Pro como landing por overriding en `genesisStore.ts`).
- AGENTS.md §5 prohíbe cronjobs persistentes sin aprobación — **YA RATIFICADO** por el usuario (clarify 2026-08-21).
- AGENTS.md §6: UI debe alinearse con DESIGN_DIRECTION.md (oficina top-down, no terminal). El Terminal Pro actual VA CONTRA esto.
- Vercel Hobby: máx 12 Serverless Functions. Ya movimos 17 a `api-disabled/`, solo queda `api/crypto/executions.js`.

## Decisiones del usuario (2026-08-21)
1. Volver a la oficina pixel-art viva (agentes sentados, burbujas reales) + meter bot de funding ahí.
2. Subir volumen PAPER (más pares + más notional) para verse "ganando" más.
3. Escribir plan completo y ejecutar paso a paso.

---

## Task 1: Reactivar HQView como landing (oficina viva)

**Objective:** Que al abrir `genesis-hq-lab.vercel.app` se vea la oficina pixel-art, no el Terminal Pro.

**Files:**
- Modify: `src/core/store/genesisStore.ts` — cambiar `default selectedModule` y quitar el override que forzaba 'terminal'.
- Modify: `src/core/data/moduleRegistry.ts` — asegurar 'hq'/'dashboard' estén disponibles.
- Modify: `src/ui/GenesisSidebar.tsx` — Workspace order: `['hq','dashboard','terminal','console', ...]`.

**Step 1:** En `genesisStore.ts`, cambiar `default selectedModule` de `'terminal'` a `'hq'` y eliminar el bloque de `hydrateState` que forzaba override a 'terminal' para módulos ruidosos.

**Step 2:** En `GenesisSidebar.tsx` Workspace, poner `'hq'` primero.

**Step 3:** `npm run typecheck && npm run build` → esperado GREEN.

**Step 4:** Commit: `git commit -m "feat: reactivate pixel office (HQView) as landing per VISION.md"`

**Verification:** Deploy a Vercel, abrir URL, ver oficina pixel-art con agentes.

---

## Task 2: Conectar bot de funding al estado de agentes (burbujas reales)

**Objective:** Los 5 agentes (`tradingAgents.ts`) muestren status `working` + burbujas con datos REALES del Gist/Binance (no catalog phrases — AGENTS.md §5 anti-fake).

**Files:**
- Create: `src/services/useFundingBotState.ts` — hook que hace fetch del Gist (`/api/crypto/executions` o raw Gist) cada 9s, expone `{ equity, fundingPaid, openPairs, lastEvents, opps }`.
- Modify: `src/agents/data/tradingAgents.ts` — mapear cada agente a un rol del bot:
  - `scalping-hunter` → Orion (funding scanner) — burbuja: "escaneando N mercados, detecté M ops"
  - `risk-sentinel` → Vega (risk) — burbuja: "Δ-neutral OK, DD X%"
  - `market-analyst` → Atlas (regime) — burbuja: "régimen: CALM/VOLATIL"
  - `backtest-engineer` → Nova (validation) — burbuja: "edge validado PF 2-7000"
  - `capital-manager` → Maya (allocation) — burbuja: "asignando $X a Y pares"
- Modify: `src/animations/GenesisOfficeWorld.tsx` — pasar `botState` a los agentes para status + burbuja.

**Step 1:** Crear `useFundingBotState.ts`:
```ts
import { useEffect, useState } from 'react';
interface BotState { equity:number; fundingPaid:number; openPairs:string[]; last:any[]; opps:any[]; booted:boolean }
export function useFundingBotState() {
  const [s, setS] = useState<BotState>({equity:50,fundingPaid:0,openPairs:[],last:[],opps:[],booted:false});
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch('/api/crypto/executions');
        const j = await r.json();
        const trades:any[] = j.trades || [];
        const fp = trades.filter(t=>t.event==='FUNDING').reduce((a,t)=>a+(t.pnl||0),0);
        // openPairs = last event per pair is OPEN
        const lastByPair = new Map<string,string>();
        trades.forEach(t=>lastByPair.set(t.pair,t.event));
        const openPairs = [...lastByPair.entries()].filter(([,e])=>e==='OPEN').map(([p])=>p);
        if (alive) setS({equity:50+fp, fundingPaid:fp, openPairs, last:trades.slice(-5), opps:[], booted:true});
      } catch {}
    };
    tick();
    const id = setInterval(tick, 9000);
    return () => { alive=false; clearInterval(id); };
  }, []);
  return s;
}
```

**Step 2:** En `tradingAgents.ts` añadir campo `botRole` a cada agente (scanner/risk/regime/validation/allocation).

**Step 3:** En `GenesisOfficeWorld.tsx`, leer `useFundingBotState()` y setear `currentStatus='working'` + `currentTask` (burbuja) por agente según `botRole` y datos reales.

**Step 4:** `npm run typecheck && npm run build` → GREEN.

**Step 5:** Commit: `git commit -m "feat: wire funding bot real state into office agents (live bubbles)"`

**Verification:** Deploy, ver agentes `working` con burbujas que cambian cada 9s con datos del Gist.

---

## Task 3: Subir volumen PAPER del bot

**Objective:** Más pares + más notional para que se vea "ganando" más volumen.

**Files:**
- Modify: `server/crypto/backtest/fundingTrader.mjs` — `TOTAL_CAPITAL` de 50 → 500, `PAIRS` de 30 → usar las 20 validadas + ampliar a ~40 mejores.
- Modify: cronjob `funding-paper-bot` — pasar `FT_CAPITAL=500 FT_PAIRS=...` (o leer de env en el bot).

**Step 1:** En `fundingTrader.mjs`, cambiar `const TOTAL_CAPITAL = Number(process.env.FT_CAPITAL || 500);` y ampliar `BEST` a ~40 pares (las 20 validadas + 20 más con APR positivo del board).

**Step 2:** Actualizar cronjob para pasar `FT_CAPITAL=500`.

**Step 3:** Probar localmente: `FT_LOOP=false FT_CAPITAL=500 FT_PAIRS=COTIUSDT,ONGUSDT,RIFUSDT,... node server/crypto/backtest/fundingTrader.mjs` → verificar FUNDING events con pnl mayores.

**Step 4:** `node server/crypto/backtest/pushExecGist.mjs` → verificar Gist refleja.

**Step 5:** Commit: `git commit -m "feat: raise PAPER volume (capital 500, more pairs) for visible gains"`

**Verification:** Gist muestra más FUNDING events, fundingPaid suma más, equity crece más rápido.

---

## Task 4: Terminal Pro como pantalla en la pared de la oficina

**Objective:** El Terminal Pro (gráficas, scanner) queda como una "WorkScreen" en la oficina, no como landing.

**Files:**
- Modify: `src/workflows/WorkScreen.tsx` — añadir botón/tab para abrir Terminal Pro.
- Modify: `src/animations/GenesisOfficeWorld.tsx` — una pared "MARKET WATCH" muestra el Terminal Pro embebido o un link.

**Step 1:** En `WorkScreen.tsx`, añadir tab 'terminal' que monta `<TerminalView />`.

**Step 2:** En `GenesisOfficeWorld.tsx`, la pared MARKET WATCH abre WorkScreen en terminal.

**Step 3:** `npm run typecheck && npm run build` → GREEN.

**Step 4:** Commit: `git commit -m "feat: Terminal Pro as in-office WorkScreen (wall screen)"`

**Verification:** Desde la oficina, click en pantalla → Terminal Pro.

---

## Task 5: Honestidad y etiquetas PAPER

**Objective:** Cumplir AGENTS.md §4 (no inventar datos) y §8 (no theater).

**Files:**
- Modify: `src/animations/GenesisOfficeWorld.tsx` — badge "PAPER · NO REAL MONEY" visible en la oficina.
- Modify: `tradingAgents.ts` burbujas — solo datos reales del Gist/Binance, nada hardcoded.

**Step 1:** Añadir badge PAPER en esquina de la oficina.

**Step 2:** Verificar que ninguna burbuja tenga texto fijo no-sourced.

**Step 3:** Commit: `git commit -m "docs: PAPER badge + anti-fake bubbles in office"`

---

## Task 6: CHANGELOG + deploy final

**Objective:** Cumplir AGENTS.md §7.

**Files:**
- Modify: `docs/CHANGELOG_AI.md` — entrada con todos los cambios.

**Step 1:** Añadir entrada CHANGELOG.

**Step 2:** `git add -A && git commit -m "chore: CHANGELOG for office+funding bot plan"`

**Step 3:** `vercel deploy --prod` → READY.

**Verification:** URL muestra oficina viva con agentes working + burbujas reales + equity creciendo.

---

## Risks / Tradeoffs
- **Vercel Hobby 12-fn limit:** ya respetado (1 fn). No añadir fns.
- **CORS Binance:** verificado `*` para fapi/api.binance.com. El fetch del Gist raw puede cachear ~5min; usar la API de Vercel Function (`/api/crypto/executions`) que ya tiene fallback.
- **AGENTS.md §5 cronjob:** ratificado por usuario. Mantener.
- **Doble fuente de verdad:** el bot resetea estado cada launch; el frontend usa el array `trades` del Gist (acumulado) como fuente de equity. Ya validado en #24.

## Open questions
- ¿Los 5 agentes de `tradingAgents.ts` son suficientes o añadimos los 4 traders (Nova/Atlas/Orion/Vega) del Terminal como agentes extra en la oficina? → Por ahora mapeamos los 5 existentes a roles del bot.
