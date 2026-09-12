# Genesis Quant Lab — Plan de Mejora (Fase 2)

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Convertir el Quant Lab paper ya integrado en la web de Genesis HQ Lab en un sistema multi-par orquestado con tesorería conectada al sizing real, dashboard completo (curva de equity + salud del cron) y camino testnet preparado — sin tocar dinero real hasta el veredicto del auditor.

**Architecture:** Todo vive en el mismo web app existente (`genesis-hq-lab-real`): backend Node puro (`server/index.mjs`, rutas estilo `if (url.pathname === ...)` + `sendJson`), módulos cuant en `server/genesis/*.mjs`, estado persistido en JSON bajo `data/`, frontend React/Vite con registro de módulos (`src/core/data/moduleRegistry.ts`) y vistas en `src/workflows/`. El runner paper corre por cron horario de Hermes (job `a3e793320c1c`), el auditor semanal es `804103ddc36a`.

**Tech Stack:** Node 22 ESM, ccxt 4.x, React 19 + Vite + TS (path alias `@workflows` etc.), Tailwind con paleta carbon de `docs/DESIGN_DIRECTION.md`, sin framework de rutas.

**Contexto actual (verificado):**
- `server/genesis/liveRunner.mjs` opera COTIUSDT 1h meanReversion (params validados 6 gates), estado en `data/genesis_live_state_COTIUSDT_1h.json`.
- `server/genesis/treasury.mjs` verificado end-to-end en paper ($150 balance, ledger append-only, whitelist gate).
- Ruta `/api/genesis/live` añadida a `server/index.mjs` (~línea 687) y verificada con curl en puerto 8787.
- `src/workflows/QuantBotView.tsx` creada y registrada en `App.tsx` (case `'quant-bot'`), `moduleRegistry.ts` (id `'quant-bot'`), `translations.ts` (`nav.quant-bot`), `GenesisSidebar.tsx` (icono Dna).
- `npm run typecheck` ✅ y `npm run build` ✅ con todo esto.
- **Pendiente inmediato:** hay un servidor de prueba corriendo en el puerto 8787 (PID 15856, node.exe) que hay que matar; los cambios actuales NO están commiteados.

---

### Task 0: Limpiar el servidor de prueba y commitear el trabajo actual

**Objective:** Dejar el árbol limpio y el progreso guardado antes de añadir más.

**Files:** ninguno nuevo; commit de los ya modificados.

**Step 1: Matar el servidor de prueba**
```bash
taskkill //PID 15856 //F
netstat -ano | grep ":8787"   # Expected: sin LISTENING
```

**Step 2: Commitear integración UI+API**
```bash
cd /c/Users/Usuario/OneDrive/Documentos/Playground/genesis-hq-lab-real
git add server/index.mjs src/workflows/QuantBotView.tsx src/App.tsx src/core/data/moduleRegistry.ts src/core/i18n/translations.ts src/ui/GenesisSidebar.tsx
git commit -m "feat: quant-bot view + /api/genesis/live endpoint in same web app"
```

**Step 3: Changelog** — añadir entrada en `docs/CHANGELOG_AI.md` (formato sección 7 de AGENTS.md) con Verification: typecheck ok, build ok, curl /api/genesis/live ok.

---

### Task 1: Conectar el sizing del bot a la Tesorería

**Objective:** Que `liveRunner.mjs` use el capital asignado por `treasury.mjs` (20% del balance) en vez del `$1000` hardcodeado, para que paper equity y tesorería sean un solo sistema.

**Files:**
- Modify: `server/genesis/liveRunner.mjs` (const CAPITAL ~línea 27 y lógica de pnl)

**Step 1: Leer asignación desde el estado de tesorería**

En `loadState()` de liveRunner, si existe `data/genesis_treasury_state.json`, usar:
```js
function workingCapital() {
  try {
    const t = JSON.parse(fs.readFileSync(
      path.join(__dirname, '../../data/genesis_treasury_state.json'), 'utf8'));
    const alloc = t.paperBalanceUSDT * 0.2;
    return alloc > 0 ? alloc : CAPITAL;
  } catch { return CAPITAL; }
}
```
Usar ese valor como base de equity inicial (solo si `state.trades.length === 0` para no reescalar historial).

**Step 2: Verificación manual**
```bash
node server/genesis/treasury.mjs status && node server/genesis/liveRunner.mjs | grep equity
# Expected: equity refleja balance*0.2 (ej. $30) sin borrar trades previos
```

**Step 3: Commit** — `feat: liveRunner sizes positions from treasury allocation`

---

### Task 2: Soporte multi-par en el runner (basket)

**Objective:** Correr el mismo motor sobre N pares configurables, cada uno con su archivo de estado (ya soportado por nombre de archivo por par+tf).

**Files:**
- Create: `scripts/genesis_live_runner.sh` → actualizar para iterar `GENESIS_PAIRS` (default `COTIUSDT XLMUSDT`)
- Modify: ruta `/api/genesis/live` en `server/index.mjs` para devolver un array `bots[]` leyendo todos los `data/genesis_live_state_*_*.json`

**Step 1:** En el script bash, cambiar la línea `OUT=$(node server/genesis/liveRunner.mjs)` por un loop:
```bash
for PAIR in ${GENESIS_PAIRS:-COTIUSDT}; do
  GENESIS_PAIR="$PAIR" OUT="$OUT$(GENESIS_PAIR="$PAIR" node server/genesis/liveRunner.mjs 2>&1)"
done
```
(mantener el filtrado de EVENTOS existente).

**Step 2:** En `index.mjs`, reemplazar la lectura del único archivo por:
```js
import { readdirSync } from 'node:fs';
const files = readdirSync(join(__dir, '../data')).filter(f => f.startsWith('genesis_live_state_'));
const bots = files.map(f => ({ pair: f.replace('genesis_live_state_', '').replace('.json', ''), state: readJson(`../data/${f}`) }));
```
Mantener compatibilidad: seguir exponiendo `bot` (primer bot) además de `bots`.

**Step 3:** Verificar: crear segundo estado corriendo `GENESIS_PAIR=XLMUSDT node server/genesis/liveRunner.mjs`, luego `curl localhost:8787/api/genesis/live` → `bots.length >= 2`.

**Step 4:** Commit — `feat: multi-pair basket support in runner + aggregated API`

---

### Task 3: Curva de equity + salud del cron en QuantBotView

**Objective:** El dashboard muestra la evolución (no solo snapshot) y si el cron horario está vivo.

**Files:**
- Modify: `src/workflows/QuantBotView.tsx`
- Modify: `server/genesis/liveRunner.mjs` — push de cada equity post-trade a `state.equityCurve: number[]` (cap 500 puntos)

**Step 1:** En liveRunner, tras cada cierre de posición: `state.equityCurve = [...(state.equityCurve||[]), +state.equity.toFixed(2)].slice(-500);`

**Step 2:** En QuantBotView, añadir sección "Equity curve": SVG polyline simple (sin librería nueva — YAGNI), puntos normalizados al min/max, línea accent cyan `#22d3ee` sobre fondo `gx-card`. Respetar DESIGN_DIRECTION (sin neón, texto `#e6edf3`).

**Step 3:** Salud del cron: comparar `updatedAt` del estado con ahora; si > 2h mostrar badge ámbar "cron retrasado", si > 24h badge rojo "cron caído". Sin datos inventados.

**Step 4:** `npm run typecheck && npm run build` → expected OK. Commit — `feat: equity curve and cron-health indicators in QuantBotView`

---

### Task 4: Executor testnet preparado (gated, SIN llaves)

**Objective:** Dejar escrito y probado-en-seco el executor que firmará órdenes en Bybit/Binance **testnet** cuando el usuario ponga llaves — hoy debe ejecutarse en modo dry-run sin llaves y fallar de forma clara.

**Files:**
- Create: `server/genesis/testnetExecutor.mjs`

**Step 1: Implementación mínima**
```js
// Dry-run by default. Only signs if GENESIS_TESTNET_KEY/SECRET set AND TESTNET=true AND human GO file exists.
export async function placeTestnetOrder({ pair, side, amount }) {
  const keys = process.env.GENESIS_TESTNET_KEY && process.env.GENESIS_TESTNET_SECRET;
  const go = fs.existsSync(path.join(__dirname, '../../data/GENESIS_LIVE_GO.txt')); // created BY HUMAN
  if (!keys || !go || process.env.TESTNET !== 'true') {
    return { executed: false, reason: 'dry-run: missing keys / GO file / TESTNET=true', intent: { pair, side, amount } };
  }
  // ccxt sandbox mode here when unlocked
}
```

**Step 2:** Probar dry-run: `node -e "import('./server/genesis/testnetExecutor.mjs').then(m=>m.placeTestnetOrder({pair:'COTIUSDT',side:'buy',amount:10}).then(console.log))"` → expected `{executed:false, reason:'dry-run...'}`.

**Step 3:** Conectarlo a liveRunner detrás de flag `GENESIS_EXECUTION=testnet` (default off). Commit — `feat: gated testnet executor (dry-run until human GO)`

---

### Task 5: Push + PR de la rama completa

**Objective:** Subir `feat/genesis-improvement-plan` (lab + scanner + fill tester + runner + treasury + integración web) para revisión del humano.

**Step 1:**
```bash
git push -u origin feat/genesis-improvement-plan
gh pr create --title "Genesis Quant Lab: validated paper bot, treasury, web integration" --body "...resumen honesto de veredictos medidos..."
```
**Step 2:** Verificar CI/build del PR verde.

---

## Tests / Validation (global)

```bash
npm run typecheck        # expected: sin errores
npm run build            # expected: built OK
curl localhost:8787/api/genesis/live   # expected: {ok:true, bots|bot..., treasury...}
node server/genesis/liveRunner.mjs     # scan único OK
node server/genesis/treasury.mjs status
```

## Risks / Tradeoffs / Open Questions

- **Riesgo:** multi-par multiplica exposición a estrategias NO validadas fuera de COTIUSDT (XLM fue GO=false). Mitigación: basket arranca solo con pares cuyo veredicto semanal sea OBSERVACIÓN o mejor; el resto queda en watch-only.
- **Tradeoff:** leer tesorería para sizing acopla dos sistemas; si alguien deposita/retira a mitad de trade el equity base cambia. Mitigación: solo se relee al abrir trade nuevo, nunca a mitad.
- **AGENTS.md:** nada persistente sin GO; Task 4 exige archivo `GENESIS_LIVE_GO.txt` creado por el humano (nunca por el agente).
- **Abierto:** ¿conectar delivery de los crons a Telegram? (requiere decisión explícita del usuario).
