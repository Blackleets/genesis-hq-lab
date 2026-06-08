# Hybrid DB Persistence — Design Spec

> Date: 2026-06-08. Approved. SQLite stays the execution DB; Supabase Postgres is durable memory.

## Principle
Hot path stays **better-sqlite3 (sync), zero query rewrites**. Durability is a background
**diff-based replicator** (better-sqlite3 has no update hook, so we poll changed rows and upsert
to Postgres). Trading never blocks on Postgres. Graceful degradation: Postgres down → warn +
keep trading.

## Modes (`DB_MODE`, default `hybrid`)
- `sqlite`  — no replication, no restore (today's behaviour).
- `hybrid`  — SQLite hot path + async replication to Postgres + restore-if-empty on boot.
- `postgres`— hybrid + authoritative restore on boot (always pull PG first). Hot path still SQLite
  (full PG-primary would require async everywhere = a rewrite, out of scope).

Replication is a no-op unless mode ≠ sqlite AND `DATABASE_URL` is set.

## Files
| Action | File | Responsibility |
|--------|------|----------------|
| CREATE | `server/persistence/dbReplicator.mjs` | PG pool, schema mirror, diff replicate loop, restore, health |
| CREATE | `server/persistence/restore.mjs` | pre-start CLI: restore SQLite from PG if empty/stale |
| CREATE | `server/tests/dbReplicator.test.mjs` | pure-logic tests (config, type map, cursor SQL, no-op) |
| MODIFY | `server/index.mjs` | `GET /api/db/health` + start replication loop |
| MODIFY | `server/truthLayer.mjs` | `probeDurablePersistence()` |
| MODIFY | `package.json` | `start:render` runs restore.mjs first; add `pg` dep |

## Durable tables (Part 8)
`trades`, `operator_events` (timeline/telemetry), `capital_history`, `lessons`, `signals`,
`mistake_patterns`, `agent_profiles`, `skill_versions`, `org_state`. (reconciliation/confidence
state live in these + are derivable.) Postgres schema is **auto-mirrored** from SQLite
`PRAGMA table_info` (INTEGER→BIGINT, REAL→DOUBLE PRECISION, TEXT→TEXT, BLOB→BYTEA), PK preserved.

## Replication (async, idempotent — Parts 1,2,4)
Every ~5s, per table:
- `cursor` tables (trades: `COALESCE(closed_at,opened_at)`; operator_events: `ts`): SELECT rows
  where cursorExpr > watermark.
- `rowid` tables (capital_history, lessons, signals): SELECT where rowid > watermark.
- `full` tables (agent_profiles, skill_versions, org_state, mistake_patterns — small/mutable):
  SELECT all.
- Upsert to PG `INSERT ... ON CONFLICT (<pk>) DO UPDATE SET ...` (idempotent, no dupes), batched.
- Advance watermark, persisted in SQLite `_repl_cursors`.
- All PG ops in try/catch → failure increments `failedSyncs`, keeps watermark, retries next cycle.
  SQLite/trading never blocked.

## Restore (Part 5)
`restore.mjs` (pre-start): opens SQLite (migrate), ensures PG schema, and if SQLite is empty/stale
(`SELECT COUNT(*) FROM trades = 0` while PG has trades, or mode=postgres) → pulls every durable
table from PG → `INSERT OR IGNORE` into SQLite. Exits; then server+agent open the populated file.

## Diagnostics (Part 7) — `GET /api/db/health`
`{ mode, sqlite: { ok, trades, events }, postgres: { ok, connected }, replication: { rowsSynced,
failedSyncs, lastSyncAt, syncLagMs, queue (pending est.), perTable } }`.

## Safety (Parts 3,9)
Untouched: execution, paper, risk, safe mode, confidence/learning logic, UI, and the entire
synchronous better-sqlite3 API. Replication is additive and isolated. Postgres failure is a
warning surfaced in truthLayer (`probeDurablePersistence`), never an execution failure.

## Validation
`npm run build` clean; `npm test` all pass + new replicator pure-logic tests (no live PG needed —
they assert config/type-map/cursor-SQL and that everything no-ops without DATABASE_URL).

## Deploy steps
1. `npm install pg`. 2. Render env already has `DATABASE_URL` + `DB_MODE=hybrid`. 3. `start:render`
runs `restore.mjs` then the processes. 4. On boot the replicator mirrors the schema to Supabase and
begins replicating; after a deploy, restore repopulates SQLite from Supabase.
