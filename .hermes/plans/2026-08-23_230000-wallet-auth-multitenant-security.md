# Wallet-Connect Multi-Tenant Security Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Cada usuario entra a la web con su propia wallet (connect wallet), ve SOLO sus datos, y el operador (nosotros) puede leer/auditar todo sin capacidad de transferir nada. La seguridad es la pieza clave: separación total por tenant, cero custodia, cero firmas de transferencia.

**Architecture:** Auth por firma de mensaje (Sign-In With Ethereum style): la wallet firma un nonce efímero, el backend verifica la firma criptográficamente y emite una sesión scoped al address. Cada bot paper corre POR WALLET (state files namespaced `genesis_live_state_<PAIR>_<tf>__<addrHash>.json`). El rol `operator` (whitelist de addresses controlada por env) obtiene vista de lectura global. NUNCA se pide ni existe ninguna firma de transferencia/approve — solo firmas de autenticación off-chain que no mueven fondos.

**Tech Stack:** viem + @wagmi/core (estándar de facto, MIT, sin UI impuesta), React 19/Vite existente, serverless Vercel functions + backend local Node, estado en JSON namespaced (fase 1) con camino claro a SQLite/Postgres (fase 2).

---

## Principios de seguridad NO NEGOCIABLES

1. **Cero custodia:** el sistema nunca toca llaves privadas, seeds ni fondos. Solo direcciones públicas.
2. **Cero transacciones:** la única firma que se pide es un mensaje de texto para autenticar (EIP-191 personal_sign). No hay approve, no hay transfer, no hay spending limit. Cualquier request de firma que NO sea el nonce de login = bug crítico.
3. **Aislamiento por tenant:** cada endpoint que devuelve datos de bot filtra por el address de la sesión. Un usuario jamás recibe bytes de otro usuario.
4. **Operador read-only:** nosotros vemos todo pero desde el MISMO código de lectura; no existen endpoints de escritura cross-tenant. Sin excepciones "temporales".
5. **Defensa en profundidad:** rate limiting por IP+address, nonces de un solo uso con expiración 5 min, sesiones JWT cortas (24h) firmadas con secreto del servidor, headers de seguridad.

## Estado actual (verificado)

- Frontend: React 19 + Vite + TS, store propio en localStorage (`src/core/store/persistence.ts`), SIN librería de wallet.
- Backend: dual — Node local (`server/index.mjs`, puerto 8787, auth opcional por API_SECRET) + serverless Vercel (`api/**/*.js`).
- Deploy vivo: `https://genesis-hq-lab-real.vercel.app`.
- Estado de bots: `data/genesis_live_state_<PAIR>_<TF>.json` (hoy sin namespace de usuario).
- Despliegue actual muestra datos del operador a cualquiera — ESTO ES LO QUE SE CORRIGE.

---

### Task 1: Dependencias wallet + tipos base

**Objective:** Instalar viem/wagmi y crear los tipos compartidos de identidad.

**Files:**
- Modify: `package.json` (deps)
- Create: `src/core/auth/walletTypes.ts`

**Step 1:** `npm install wagmi viem@^2 @tanstack/react-query` (wagmi v2 requiere react-query).

**Step 2:** Tipos:
```ts
// src/core/auth/walletTypes.ts
export type UserRole = 'user' | 'operator';
export interface WalletSession {
  address: string;        // checksummed
  role: UserRole;
  issuedAt: number;
  expiresAt: number;      // issuedAt + 24h
  token: string;          // JWT HS256 firmado por backend
}
```

**Step 3:** Commit `feat: wallet auth types and deps`.

---

### Task 2: Nonce + verificación de firma en backend (serverless)

**Objective:** Flujo SIWES completo: pedir nonce → firmar → verificar → JWT.

**Files:**
- Create: `api/auth/nonce.js`
- Create: `api/auth/verify.js`
- Create: `api/_lib/sessions.js`

**Step 1:** `api/auth/nonce.js` — genera nonce aleatorio de 32 hex, lo guarda en un store efímero (Map en memoria + expiración 5min; en fase 2 Upstash Redis para multi-instancia). Devuelve `{ nonce, message }` donde message es el formato SIWES legible:
```
Genesis HQ Lab — login
Address: 0x...
Nonce: <nonce>
Issued: <ISO>
Solo autenticación. Esta firma NO autoriza transacciones ni transferencias.
```
La frase explícita es parte de la seguridad UX.

**Step 2:** `api/auth/verify.js` — recibe `{address, signature, nonce}`:
- valida nonce existente/no usado/no expirado → lo marca consumido
- verifica con `viem.verifyMessage(message, signature, address)` 
- calcula rol: `OPERATOR_ADDRESSES` (env, coma-separada, lowercase) contiene address → 'operator', si no 'user'
- emite JWT HS256 (`jsonwebtoken` o jose) con payload `{sub: address.toLowerCase(), role, iat, exp}` firmado con `AUTH_JWT_SECRET` (env)
- responde `{ ok: true, session: {address, role, token, expiresAt} }`

**Step 3:** Test manual curl: nonce → verify (firma falsa debe dar 401).

**Step 4:** Commit `feat: SIWES nonce+verify with JWT sessions`.

---

### Task 3: Rate limiting y hardening de endpoints auth

**Objective:** Que nadie pueda fuerza-bruta el flujo.

**Files:**
- Create: `api/_lib/rateLimit.js`

**Step 1:** Rate limiter in-memory por IP+ruta: `/auth/nonce` max 10/min, `/auth/verify` max 10/min (fallos consecutivos → bloqueo 15min). En fase 2 migrar a Upstash.

**Step 2:** Aplicar en ambas rutas. Commit `feat: rate limiting on auth endpoints`.

---

### Task 4: Middleware de sesión para endpoints de datos

**Objective:** Todos los endpoints de datos del Quant Lab exigen sesión válida y filtran por tenant.

**Files:**
- Create: `api/_lib/sessionAuth.js`
- Modify: `api/genesis/live.js`, `api/genesis/candles.js`, `api/genesis/context.js`
- Modify (local): `server/index.mjs` (rutas /api/genesis/* aceptan Bearer token además del API_SECRET legacy)

**Step 1:** `sessionAuth.js`: extrae `Authorization: Bearer <jwt>` → verifica firma/exp → adjunta `req.session = {address, role}`. 401 si falta/inválido.

**Step 2:** REGLA DE FILTRADO central:
```js
function tenantFilter(session) {
  return session.role === 'operator' ? null : session.address.toLowerCase(); // null = ver todo
}
```
`live.js`: cada bot state lleva campo interno `owner` (hash sha256 del address, nunca el address plano en disco público). Filtrar bots cuyo owner coincida; operator ve todos.

**Step 3:** `/api/genesis/candles` y `/context` son datos PÚBLICOS de mercado (Binance/F&G) — requieren sesión activa (evita scraping) pero no filtrado tenant. Documentarlo en comentario.

**Step 4:** Commit `feat: session middleware + tenant filtering on data endpoints`.

---

### Task 5: Namespacing de bots por wallet (backend local)

**Objective:** Cada wallet nueva puede iniciar SU PROPIO bot paper sin tocar datos ajenos.

**Files:**
- Modify: `server/genesis/liveRunner.mjs`
- Modify: `scripts` cron wrapper (perfil aragan) para pasar `GENESIS_OWNER`

**Step 1:** liveRunner acepta `GENESIS_OWNER_ADDR` (env). El STATE_FILE pasa a:
`data/bots/<sha256(addr).slice(0,16)>/<PAIR>_<TF>.json` cuando hay owner; sin owner mantiene el layout legacy (tus bots actuales, owner=operator).
El hash evita exponer addresses planos en el filesystem.

**Step 2:** Endpoint nuevo `POST api/auth/spawnBot` (solo sesión user/operator): crea registro de bot para esa wallet con capital inicial paper ($1000 virtual, cero real) usando workingCapital()=default para usuarios.

**Step 3:** Verificación: dos wallets distintas generan dos directorios distintos y ningún endpoint cruza datos. Commit `feat: per-wallet bot namespaces`.

---

### Task 6: Frontend — Connect Wallet + sesión

**Objective:** UX de entrada: botón "Connect Wallet" → firma → sesión persistida.

**Files:**
- Create: `src/core/auth/WalletAuthProvider.tsx`
- Create: `src/ui/views/ConnectWalletGate.tsx`
- Modify: `src/App.tsx` (gate global)
- Modify: `src/workflows/QuantBotView.tsx` (usa sesión para fetch con Bearer)

**Step 1:** Provider wagmi con connector injected (MetaMask/Rabbit/etc) — sin wallet-connect remote en fase 1 (YAGNI).

**Step 2:** Flujo en `WalletAuthProvider`: connect → requestNonce → personal_sign (mostrando SIEMPRE el mensaje con la leyenda "NO autoriza transacciones") → verify → guardar WalletSession en memoria + sessionStorage (NO localStorage: muere con la pestaña, menos superficie).

**Step 3:** `ConnectWalletGate`: si no hay sesión, renderiza pantalla de conexión limpia (carbon palette); si hay, renderiza el app. Badge visible del address truncado + rol + botón disconnect.

**Step 4:** Todos los fetch de datos añaden `headers: {Authorization: Bearer token}`. Si 401 → logout limpio + volver al gate.

**Step 5:** Commit `feat: connect-wallet gate and authenticated data fetching`.

---

### Task 7: Vista operator (lectura global)

**Objective:** Nosotros vemos todos los bots de todos los usuarios en modo lectura.

**Files:**
- Modify: `src/workflows/QuantBotView.tsx` (si role=operator: selector/lista de tenants)

**Step 1:** Si `session.role === 'operator'`, el backend `live.js` ya devuelve todos los bots con `ownerHash`. La vista agrupa por ownerHash con etiqueta `user #ab12cd` (nunca address plano en UI).

**Step 2:** Commit `feat: operator read-only fleet view`.

---

### Task 8: Auditoría de seguridad antes de merge

**Objective:** Checklist adversarial ejecutado y documentado.

**Steps:**
1. Intentar acceder a /api/genesis/live sin token → 401 ✓
2. Con token user A → ver solo bots A ✓
3. Forzar token manipulado (cambiar payload sin refirmar) → 401 ✓
4. Verificar que NINGÚN flujo pide firma distinta al nonce de login ✓ (grep de personal_sign/signTypedData en src/)
5. Verificar que no existe ningún endpoint de escritura cross-tenant ✓
6. Rate limits disparando 20 req rápidas → 429 ✓
7. Documentar resultado en docs/SECURITY_AUDIT.md con fecha y hallazgos.
8. Commit `docs: security audit checklist results`.

---

## Tests / Validation

```bash
npm run typecheck          # 0 errores
npm run build              # verde
# curl flows: nonce->verify->data con y sin token
curl -X POST https://genesis-hq-lab-real.vercel.app/api/auth/nonce -H "Content-Type: application/json" -d '{"address":"0x..."}'
# deploy preview + prueba E2E con MetaMask real
vercel deploy --prod --yes
```

## Riesgos / Tradeoffs / Open Questions

- **Nonce store in-memory** se resetea con cada cold start de Vercel → aceptable fase 1 (el usuario reintenta), fase 2 Upstash Redis (~$0 free tier).
- **JWT secret**: generar y subir como env var de Vercel + .env local (NUNCA en git).
- **Un bot por wallet vs muchos**: fase 1 = 1 bot default por wallet (COTIUSDT strategy clone). Multiplicidad después.
- **Legal/UX**: dejar claro en el gate que esto es simulación paper; ninguna wallet firma nada que mueva fondos.
- **Abierto:** ¿quieres onboarding automático (cualquier wallet puede crear bot) o whitelist de acceso primero? Recomiendo whitelist por env durante las primeras semanas (control anti-abuso), abriendo después.
