// api/community — opt-in, anonymized collective learning.
//
// Every trader who opts in shares ONLY strategy performance aggregates
// (family, interval, win rate, PF, verdict). No wallet addresses, no user
// identifiers beyond a random install id used for deduping. The network
// effect: each browser's learning feeds everyone's.
//
// POST { installId, family, interval, verdict, trades, winRate, profitFactor, pnlUsd, tStat }
// GET  → { ok, contributions, byFamily: { family: { runs, avgWinRate, avgPf, goCount } } }

import { hasPostgres, query } from './_lib/postgres.js';

const KEY = 'community_learning_v1';
const MAX_ROWS = 500;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.end(JSON.stringify(body));
}

async function readRows() {
  const r = await query(`SELECT value FROM org_state WHERE key = $1 LIMIT 1`, [KEY]);
  if (!r?.rows?.length) return [];
  try {
    const parsed = JSON.parse(r.rows[0].value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRows(rows) {
  await query(
    `INSERT INTO org_state (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [KEY, JSON.stringify(rows.slice(-MAX_ROWS))],
  );
}

function sanitize(body) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  const family = str(body.family, 20);
  if (!['donchian', 'meanRevert', 'maCross'].includes(family)) return null;
  return {
    ts: new Date().toISOString(),
    installId: str(body.installId, 40) ?? 'anon',
    family,
    interval: str(body.interval, 6) ?? '1h',
    verdict: ['GO', 'NO_GO', 'INSUFFICIENT_DATA'].includes(body.verdict) ? body.verdict : 'NO_GO',
    trades: num(body.trades) ?? 0,
    winRate: Math.max(0, Math.min(1, num(body.winRate) ?? 0)),
    profitFactor: Math.max(0, Math.min(10, num(body.profitFactor) ?? 0)),
    pnlUsd: Math.max(-1e6, Math.min(1e6, num(body.pnlUsd) ?? 0)),
    tStat: Math.max(-50, Math.min(50, num(body.tStat) ?? 0)),
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true });

  if (!hasPostgres()) {
    return send(res, 200, { ok: false, reason: 'community_store_not_configured' });
  }

  try {
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
      const row = body ? sanitize(body) : null;
      if (!row) return send(res, 400, { ok: false, reason: 'invalid_payload' });
      const rows = await readRows();
      // One live entry per install+family+interval — updates replace, so the
      // pool reflects current state, not an ever-growing duplicate history.
      const filtered = rows.filter(
        (r) => !(r.installId === row.installId && r.family === row.family && r.interval === row.interval),
      );
      filtered.push(row);
      await writeRows(filtered);
      return send(res, 200, { ok: true, contributions: filtered.length });
    }

    // GET — aggregated, anonymous community picture.
    const rows = await readRows();
    const byFamily = {};
    for (const r of rows) {
      const f = (byFamily[r.family] ??= { runs: 0, sumWr: 0, sumPf: 0, goCount: 0 });
      f.runs += 1;
      f.sumWr += r.winRate ?? 0;
      f.sumPf += r.profitFactor ?? 0;
      if (r.verdict === 'GO') f.goCount += 1;
    }
    const out = {};
    for (const [fam, f] of Object.entries(byFamily)) {
      out[fam] = {
        runs: f.runs,
        avgWinRate: Math.round((f.sumWr / f.runs) * 1000) / 1000,
        avgPf: Math.round((f.sumPf / f.runs) * 100) / 100,
        goCount: f.goCount,
      };
    }
    return send(res, 200, { ok: true, contributions: rows.length, byFamily: out });
  } catch (e) {
    return send(res, 500, { ok: false, reason: e?.message ?? 'community_failed' });
  }
}
