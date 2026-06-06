# P1+P2 — Learning Loop Completo + Resiliencia de Red

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completar el loop de aprendizaje (contadores que nunca se incrementan, ranking incorrecto de lecciones) y añadir retry de red para evitar ciclos de 5 minutos perdidos por timeouts transitorios.

**Architecture:** 5 archivos modificados. Sin dependencias nuevas. Sin cambios de esquema (los contadores ya existen en SQLite). Todo backward-compatible.

**Tech Stack:** Node.js ES modules, better-sqlite3 (sync), raw fetch API.

---

## Contexto del código — qué está roto y dónde

### P1 — Loop de Aprendizaje

**Bug 1 — `times_retrieved` nunca se incrementa** ([server/memory/learningEngine.mjs:192-230](server/memory/learningEngine.mjs))

`getDecisionContext()` retorna lecciones a cada debate pero el campo `lessons.times_retrieved` en SQLite nunca se actualiza. La tabla `lessons` tiene la columna (schema.sql:97) pero siempre vale 0.

Además, el query actual no selecciona `id` de las lecciones, así que no puede hacer el UPDATE.

**Bug 2 — ORDER BY severity está roto** ([server/memory/learningEngine.mjs:197-201](server/memory/learningEngine.mjs))

`ORDER BY severity DESC` sobre strings: 'warning' > 'info' > 'critical' (alfabético). Lo correcto es 'critical' > 'warning' > 'info'. Se necesita un CASE expression.

**Bug 3 — `times_prevented_loss` nunca se incrementa** ([server/memory/mistakePrevention.mjs:22-39](server/memory/mistakePrevention.mjs))

Cuando un `mistake_pattern` veta un trade, `triggered_count` sí se incrementa. Pero el campo `lessons.times_prevented_loss` que mide la efectividad de la lección original nunca se toca. La tabla `mistake_patterns` tiene `lesson_id` como FK pero el SELECT actual no lo recupera.

**Mejora 4 — Endpoint de salud del aprendizaje**

No existe `/api/agent/learning-health`. Sin él es imposible saber si el sistema está aprendiendo.

### P2 — Resiliencia de Red

**Bug 5 — Sin retry en fetchPolymarket/fetchKalshi** ([server/marketScanner.mjs:10-107](server/marketScanner.mjs))

Un timeout de 8 segundos sin reintentos. Un fallo de red cancela todo el ciclo de 5 minutos y ese ciclo de mercado se pierde.

**Bug 6 — Research failures silenciosos** ([server/trading/workflow.mjs:76-82](server/trading/workflow.mjs))

`catch { /* silent */ }` — si `researchMarket()` falla, el debate ocurre con señales incompletas sin ningún log. Imposible detectar cuándo la investigación está fallando.

---

## Mapa de archivos

| Archivo | Cambio |
|---------|--------|
| `server/memory/learningEngine.mjs` | Fix Bug 1+2: SELECT id, increment times_retrieved, fix ORDER BY severity |
| `server/memory/mistakePrevention.mjs` | Fix Bug 3: SELECT lesson_id, increment times_prevented_loss |
| `server/marketScanner.mjs` | Fix Bug 5: add fetchWithRetry(), use en fetchPolymarket + fetchKalshi |
| `server/trading/workflow.mjs` | Fix Bug 6: log research failures explícitamente |
| `server/index.mjs` | Mejora 4: add GET /api/agent/learning-health endpoint |

---

## Task 1: Fix learningEngine.mjs — times_retrieved + ORDER BY severity

**Files:**
- Modify: `server/memory/learningEngine.mjs` (función `getDecisionContext`, líneas 192-230)

**Context:** `getDecisionContext()` es llamada por `stepDebate()` en workflow.mjs antes de cada debate. Recibe lessons y rules del contexto. Debe: (a) incluir `id` en el SELECT, (b) hacer UPDATE de `times_retrieved` en batch, (c) usar CASE para severity ordering.

- [ ] **Step 1: Leer las líneas 192-230 de learningEngine.mjs para confirmar el código actual**

Read `server/memory/learningEngine.mjs` lines 192-230.

- [ ] **Step 2: Reemplazar la función `getDecisionContext` completa**

Encuentra el bloque `export function getDecisionContext(category, priceMin, priceMax) {` y reemplázalo con:

```javascript
export function getDecisionContext(category, priceMin, priceMax) {
  // Recent relevant lessons — ordered by real effectiveness, not just severity string
  const lessons = db.prepare(`
    SELECT id, lesson_text, new_rule, category, severity,
           times_prevented_loss, times_retrieved
    FROM lessons
    WHERE deprecated = 0
      AND (category = ? OR category = 'all' OR ? = 'general')
    ORDER BY
      CASE severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 WHEN 'info' THEN 1 ELSE 0 END DESC,
      times_prevented_loss DESC,
      times_retrieved DESC,
      created_at DESC
    LIMIT 8
  `).all(category, category);

  // Track retrieval — agents learn which lessons are being applied
  if (lessons.length > 0) {
    const placeholders = lessons.map(() => '?').join(', ');
    db.prepare(
      `UPDATE lessons SET times_retrieved = times_retrieved + 1 WHERE id IN (${placeholders})`
    ).run(...lessons.map(l => l.id));
  }

  // Active hard rules
  const rules = db.prepare(`
    SELECT rule_text, rule_type, priority
    FROM operating_rules
    WHERE active = 1
      AND (scope = 'prediction_markets' OR scope = 'all')
    ORDER BY priority ASC, rule_type = 'hard_constraint' DESC
    LIMIT 10
  `).all();

  // Active mistake patterns for this category+price range
  const patterns = db.prepare(`
    SELECT pattern_desc, conditions, triggered_count
    FROM mistake_patterns
    WHERE active = 1 AND category = ?
    ORDER BY triggered_count DESC
    LIMIT 5
  `).all(category);

  // Agent skill level
  const agent = db.prepare(`
    SELECT level, skill_market_selection, skill_timing, skill_signal_reading,
           skill_pattern_recog, calibration_score, total_trades, wins, losses
    FROM agent_profiles WHERE id = 'market-agent-1'
  `).get();

  return { lessons, rules, patterns, agent };
}
```

- [ ] **Step 3: Verify el módulo carga sin error**

```
node --input-type=module -e "import('./server/memory/learningEngine.mjs').then(() => console.log('OK')).catch(e => console.error('FAIL', e.message))"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```
git add server/memory/learningEngine.mjs
git commit -m "fix(learning): track times_retrieved + fix severity ordering in getDecisionContext"
```

---

## Task 2: Fix mistakePrevention.mjs — times_prevented_loss

**Files:**
- Modify: `server/memory/mistakePrevention.mjs` (función `checkVeto`, líneas 9-40)

**Context:** Cuando un `mistake_pattern` hace match con un trade propuesto, queremos incrementar `times_prevented_loss` en la lección original que creó ese patrón. La tabla `mistake_patterns` tiene `lesson_id` como FK pero el SELECT actual no lo recupera.

- [ ] **Step 1: Leer las líneas 9-40 de mistakePrevention.mjs para confirmar el código actual**

Read `server/memory/mistakePrevention.mjs` lines 9-45.

- [ ] **Step 2: Modificar el SELECT de patrones para incluir lesson_id**

Encuentra este código:
```javascript
  const patterns = db.prepare(`
    SELECT id, pattern_desc, conditions, triggered_count
    FROM mistake_patterns
    WHERE active = 1 AND category = ?
  `).all(category ?? 'general');
```

Reemplázalo con:
```javascript
  const patterns = db.prepare(`
    SELECT id, pattern_desc, conditions, triggered_count, lesson_id
    FROM mistake_patterns
    WHERE active = 1 AND category = ?
  `).all(category ?? 'general');
```

- [ ] **Step 3: Modificar el bloque de match de patrón para incrementar times_prevented_loss**

Encuentra este bloque (dentro del `for (const pattern of patterns)` loop):
```javascript
    if (priceMatch) {
      vetoes.push({
        type: 'mistake_pattern',
        reason: `Pattern match: ${pattern.pattern_desc}`,
        pattern_id: pattern.id,
        severity: 'warning',
      });
      // Increment trigger count
      db.prepare('UPDATE mistake_patterns SET triggered_count = triggered_count + 1, last_triggered = datetime("now") WHERE id = ?')
        .run(pattern.id);
    }
```

Reemplázalo con:
```javascript
    if (priceMatch) {
      vetoes.push({
        type: 'mistake_pattern',
        reason: `Pattern match: ${pattern.pattern_desc}`,
        pattern_id: pattern.id,
        severity: 'warning',
      });
      // Increment pattern trigger count
      db.prepare('UPDATE mistake_patterns SET triggered_count = triggered_count + 1, last_triggered = datetime("now") WHERE id = ?')
        .run(pattern.id);
      // Credit the source lesson — this veto prevented a potential repeat mistake
      if (pattern.lesson_id) {
        db.prepare('UPDATE lessons SET times_prevented_loss = times_prevented_loss + 1 WHERE id = ?')
          .run(pattern.lesson_id);
      }
    }
```

- [ ] **Step 4: Verify el módulo carga sin error**

```
node --input-type=module -e "import('./server/memory/mistakePrevention.mjs').then(() => console.log('OK')).catch(e => console.error('FAIL', e.message))"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```
git add server/memory/mistakePrevention.mjs
git commit -m "fix(learning): increment times_prevented_loss on lessons when veto pattern fires"
```

---

## Task 3: Add /api/agent/learning-health endpoint in index.mjs

**Files:**
- Modify: `server/index.mjs`

**Context:** No existe ningún endpoint que muestre la salud del loop de aprendizaje. Necesitamos uno para verificar que P1 está funcionando. Debe ir cerca de los otros endpoints `/api/agent/*`.

La respuesta debe incluir:
- Total lecciones generadas (por categoría)
- Las top 5 lecciones más efectivas (por `times_prevented_loss`)
- Estado de patrones de veto (activos, triggered_count, false_positive rate)
- Ratio de retrieval (lecciones que se usan vs las que nunca se recuperan)
- Win rate trend (últimas 10 trades cerradas vs. las anteriores 10)

- [ ] **Step 1: Leer index.mjs para encontrar dónde añadir el endpoint**

Lee `server/index.mjs` lines 270-360 para encontrar el bloque de rutas `/api/agent/*` (busca `'/api/agent/lessons'` o `'/api/agent/stats'`).

- [ ] **Step 2: Añadir el import de db al inicio si no existe**

Verifica si `db` ya está importado en index.mjs. Si no, añade al bloque de imports existente:
```javascript
import db from './db/database.mjs';
```

Si ya está importado, no lo toques.

- [ ] **Step 3: Añadir el handler del endpoint**

Encuentra un GET handler existente de `/api/agent/` (como `/api/agent/lessons`) y añade el nuevo endpoint ANTES de ese bloque. El endpoint debe llamarse `if (url.pathname === '/api/agent/learning-health' && req.method === 'GET')`.

Añade este bloque:

```javascript
  if (url.pathname === '/api/agent/learning-health' && req.method === 'GET') {
    try {
      // Lesson generation totals by category
      const byCategory = db.prepare(`
        SELECT category,
               COUNT(*) AS total,
               SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical,
               SUM(CASE WHEN severity = 'warning'  THEN 1 ELSE 0 END) AS warnings,
               SUM(times_retrieved)     AS total_retrieved,
               SUM(times_prevented_loss) AS total_prevented
        FROM lessons WHERE deprecated = 0
        GROUP BY category ORDER BY total DESC
      `).all();

      // Top lessons by effectiveness
      const topLessons = db.prepare(`
        SELECT id, lesson_text, category, severity,
               times_retrieved, times_prevented_loss,
               created_at
        FROM lessons
        WHERE deprecated = 0
        ORDER BY times_prevented_loss DESC, times_retrieved DESC
        LIMIT 5
      `).all();

      // Lessons that have never been retrieved (dead weight)
      const unreadCount = db.prepare(`
        SELECT COUNT(*) AS cnt FROM lessons WHERE deprecated = 0 AND times_retrieved = 0
      `).get()?.cnt ?? 0;

      // Veto pattern effectiveness
      const patterns = db.prepare(`
        SELECT pattern_desc, triggered_count, true_positive, false_positive, active,
               lesson_id
        FROM mistake_patterns
        ORDER BY triggered_count DESC LIMIT 10
      `).all();

      const activePatterns  = patterns.filter(p => p.active).length;
      const totalTriggered  = patterns.reduce((s, p) => s + (p.triggered_count ?? 0), 0);
      const totalFp         = patterns.reduce((s, p) => s + (p.false_positive ?? 0), 0);

      // Win rate trend: last 10 closed vs prior 10
      const recentWins = db.prepare(`
        SELECT
          SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
          COUNT(*) AS total
        FROM (
          SELECT pnl FROM trades
          WHERE status = 'closed' AND COALESCE(trade_type,'prediction') <> 'crypto_scalp'
          ORDER BY closed_at DESC LIMIT 10
        )
      `).get();

      const olderWins = db.prepare(`
        SELECT
          SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
          COUNT(*) AS total
        FROM (
          SELECT pnl FROM trades
          WHERE status = 'closed' AND COALESCE(trade_type,'prediction') <> 'crypto_scalp'
          ORDER BY closed_at DESC LIMIT 20
        ) EXCEPT
        SELECT
          SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END),
          COUNT(*)
        FROM (
          SELECT pnl FROM trades
          WHERE status = 'closed' AND COALESCE(trade_type,'prediction') <> 'crypto_scalp'
          ORDER BY closed_at DESC LIMIT 10
        )
      `).get();

      const recentWinRate = recentWins?.total > 0 ? recentWins.wins / recentWins.total : null;
      const olderWinRate  = olderWins?.total  > 0 ? olderWins.wins  / olderWins.total  : null;
      const winRateTrend  = recentWinRate != null && olderWinRate != null
        ? recentWinRate > olderWinRate ? 'improving' : recentWinRate < olderWinRate ? 'declining' : 'stable'
        : 'insufficient_data';

      return sendJson(res, 200, {
        ok: true,
        learning: {
          totalLessons:    byCategory.reduce((s, c) => s + c.total, 0),
          unreadLessons:   unreadCount,
          byCategory,
          topLessons,
        },
        vetoPrevention: {
          activePatterns,
          totalTriggered,
          falsePositiveRate: totalTriggered > 0 ? (totalFp / totalTriggered) : 0,
          patterns: patterns.slice(0, 5),
        },
        winRateTrend: {
          recent10:  recentWinRate,
          prior10:   olderWinRate,
          direction: winRateTrend,
        },
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      return sendJson(res, 500, { ok: false, error: err.message });
    }
  }
```

- [ ] **Step 4: Verify el server arranca sin error de sintaxis**

```
node --check server/index.mjs
```
Expected: no output (success)

- [ ] **Step 5: Verify el endpoint responde (el server debe estar parado, esto solo verifica sintaxis)**

Si el server está corriendo localmente, prueba con:
```
curl http://localhost:8787/api/agent/learning-health
```
Si no está corriendo, el `node --check` es suficiente.

- [ ] **Step 6: Commit**

```
git add server/index.mjs
git commit -m "feat(api): add /api/agent/learning-health endpoint with lesson effectiveness metrics"
```

---

## Task 4: Fix workflow.mjs — log research failures

**Files:**
- Modify: `server/trading/workflow.mjs` (función `stepDebate`, líneas 76-82)

**Context:** Un `catch {}` silencioso impide saber cuándo `researchMarket()` falla. Cambio mínimo: 1 línea de log.

- [ ] **Step 1: Confirmar el bloque actual**

Lee `server/trading/workflow.mjs` lines 74-85.

- [ ] **Step 2: Reemplazar el catch silencioso**

Encuentra:
```javascript
  } catch { /* research is best-effort, never blocks a trade */ }
```

Reemplaza con:
```javascript
  } catch (err) {
    console.warn(`[workflow] Research unavailable for "${market.question?.slice(0, 40)}": ${err.message}`);
  }
```

- [ ] **Step 3: Verify el módulo carga sin error**

```
node --input-type=module -e "import('./server/trading/workflow.mjs').then(() => console.log('OK')).catch(e => console.error('FAIL', e.message))"
```
Expected: `OK`

- [ ] **Step 4: Commit**

```
git add server/trading/workflow.mjs
git commit -m "fix(workflow): log research failures instead of silently swallowing them"
```

---

## Task 5: Add fetchWithRetry to marketScanner.mjs

**Files:**
- Modify: `server/marketScanner.mjs`

**Context:** `fetchPolymarket()` y `fetchKalshi()` no tienen retry. Un timeout de red cancela el ciclo de 5 minutos. Añadimos un helper `fetchWithRetry(url, options, maxAttempts=3)` con backoff exponencial: 1s → 2s → 4s.

Reglas del retry:
- Reintentar en errores de red (fetch throws) y en respuestas 5xx del servidor
- NO reintentar en respuestas 4xx (errores del cliente — son definitivos)
- Timeout de AbortSignal se mantiene por intento individual

- [ ] **Step 1: Confirmar las primeras 15 líneas de marketScanner.mjs**

Lee `server/marketScanner.mjs` lines 1-15.

- [ ] **Step 2: Añadir el helper fetchWithRetry después de las constantes de URL**

Después de las líneas `const POLYMARKET_BASE = ...` y `const KALSHI_BASE = ...`, añade:

```javascript
// ─── Fetch with exponential backoff retry ─────────────────────────────────────
// Retries on network errors and 5xx server errors. Never retries 4xx (client errors).

async function fetchWithRetry(url, options = {}, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      // 4xx = client error (bad API key, invalid params) — no point retrying
      if (res.status >= 400 && res.status < 500) return res;
      // 5xx = server error — worth retrying
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err; // network error, timeout, DNS failure
    }
    if (attempt < maxAttempts) {
      const delay = Math.pow(2, attempt - 1) * 1000; // 1000ms, 2000ms, 4000ms
      console.warn(`[marketScanner] Attempt ${attempt}/${maxAttempts} failed (${lastErr?.message}). Retrying in ${delay}ms…`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
```

- [ ] **Step 3: Reemplazar el fetch en fetchPolymarket**

Encuentra dentro de `fetchPolymarket`:
```javascript
    const res = await fetch(
      `${POLYMARKET_BASE}/events?limit=${limit}&active=true&archived=false&order=volume24hr&ascending=false`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
```

Reemplaza con:
```javascript
    const res = await fetchWithRetry(
      `${POLYMARKET_BASE}/events?limit=${limit}&active=true&archived=false&order=volume24hr&ascending=false`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
```

- [ ] **Step 4: Reemplazar el fetch en fetchKalshi**

Encuentra dentro de `fetchKalshi`:
```javascript
    const res = await fetch(
      `${KALSHI_BASE}/markets?limit=${limit}&status=open`,
      {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return [];
```

Reemplaza con:
```javascript
    const res = await fetchWithRetry(
      `${KALSHI_BASE}/markets?limit=${limit}&status=open`,
      {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return [];
```

**NOTA IMPORTANTE:** El AbortSignal.timeout(8000) se aplica POR INTENTO. Con 3 intentos y delays de 1s+2s, el caso peor es ~8s×3 + 3s delay = ~27s total por fuente. Esto es aceptable dentro del ciclo de 5 minutos.

- [ ] **Step 5: Verify el módulo carga sin error**

```
node --input-type=module -e "import('./server/marketScanner.mjs').then(() => console.log('OK')).catch(e => console.error('FAIL', e.message))"
```
Expected: `OK`

- [ ] **Step 6: Commit**

```
git add server/marketScanner.mjs
git commit -m "feat(network): add fetchWithRetry with 3-attempt exponential backoff to marketScanner"
```

---

## Verificación Final

Después de todos los tasks:

- [ ] **Run all module imports en secuencia:**

```
node --input-type=module -e "
Promise.all([
  import('./server/memory/learningEngine.mjs'),
  import('./server/memory/mistakePrevention.mjs'),
  import('./server/marketScanner.mjs'),
  import('./server/trading/workflow.mjs'),
]).then(() => console.log('ALL MODULES OK')).catch(e => console.error('FAIL', e.message))
"
```
Expected: `ALL MODULES OK`

- [ ] **Verify git log muestra los 5 commits:**

```
git log --oneline -6
```

- [ ] **Confirm el endpoint existe:**

```
node --check server/index.mjs
```

---

## Spec Coverage Self-Check

| Requisito P1 | Implementado en |
|-------------|----------------|
| `times_retrieved` incrementa cuando lesson se usa en debate | Task 1 |
| ORDER BY severity correcto (critical > warning > info) | Task 1 |
| `times_prevented_loss` incrementa cuando patrón veta | Task 2 |
| SELECT lesson_id en patterns query | Task 2 |
| Endpoint `/api/agent/learning-health` | Task 3 |
| Win rate trend últimas 10 vs previas 10 | Task 3 |

| Requisito P2 | Implementado en |
|-------------|----------------|
| Retry backoff en fetchPolymarket | Task 5 |
| Retry backoff en fetchKalshi | Task 5 |
| No retry en 4xx errors | Task 5 |
| Log explícito cuando research falla | Task 4 |
