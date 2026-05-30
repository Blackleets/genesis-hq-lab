// exportTrajectories — turns resolved trades into SkillOpt train/val/test datasets.
// Run: node server/skills/exportTrajectories.mjs [agent]
// Output: data/skillopt/<agent>/{train,val,test}/items.json
//
// Ground truth = resolved market outcome. Only CLOSED trades are exportable.
// 70/15/15 split, deterministic by trade id hash so splits are stable across runs.

import db from '../db/database.mjs';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = join(__dir, '..', '..', 'data', 'skillopt');

// Deterministic 0..1 bucket from an id (stable splits without storing assignment)
function hashUnit(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function tradeToItem(t) {
  let evidence = [];
  try { evidence = JSON.parse(t.evidence || '[]'); } catch { /* keep [] */ }

  // The lesson (if any) attached to this trade — the reflection signal SkillOpt uses
  const lesson = db.prepare(
    `SELECT lesson_text, why_failed, signal_wrong, what_change, new_rule
     FROM lessons WHERE trade_id = ? LIMIT 1`
  ).get(t.id);

  const correct = t.resolved_outcome === t.outcome;
  return {
    id: t.id,
    input: {
      question:     t.market_question,
      category:     t.market_category,
      yes_price:    t.entry_price,            // entry price for the side taken
      days_to_close: t.days_to_close,
      source:       t.market_source,
    },
    agent_action: {
      outcome:    t.outcome,
      confidence: t.confidence,
      reason:     t.reason,
      evidence,
    },
    ground_truth: {
      resolved: t.resolved_outcome,
      pnl:      t.pnl,
      correct,
    },
    reflection: lesson
      ? {
          lesson:       lesson.lesson_text,
          why_failed:   lesson.why_failed,
          signal_wrong: lesson.signal_wrong,
          what_change:  lesson.what_change,
          new_rule:     lesson.new_rule,
        }
      : null,
  };
}

function writeSplit(dir, split, items) {
  const target = join(dir, split);
  if (!existsSync(target)) mkdirSync(target, { recursive: true });
  writeFileSync(join(target, 'items.json'), JSON.stringify(items, null, 2), 'utf8');
}

export function exportAgent(agent = 'polymarket_agent') {
  // For now all prediction trades belong to polymarket_agent / kalshi_agent by source.
  const source = agent === 'kalshi_agent' ? 'kalshi' : 'polymarket';
  const trades = db.prepare(
    `SELECT * FROM trades
     WHERE status = 'closed' AND resolved_outcome IS NOT NULL AND market_source = ?
     ORDER BY closed_at ASC`
  ).all(source);

  const items = trades.map(tradeToItem);

  const train = [], val = [], test = [];
  for (const item of items) {
    const u = hashUnit(item.id);
    if (u < 0.70) train.push(item);
    else if (u < 0.85) val.push(item);
    else test.push(item);
  }

  const dir = join(OUT_ROOT, agent);
  writeSplit(dir, 'train', train);
  writeSplit(dir, 'val',   val);
  writeSplit(dir, 'test',  test);

  const summary = { agent, total: items.length, train: train.length, val: val.length, test: test.length, dir };
  return summary;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('exportTrajectories.mjs')) {
  const agent = process.argv[2] || 'polymarket_agent';
  const summary = exportAgent(agent);
  console.log(`[exportTrajectories] ${summary.agent}: ${summary.total} resolved trades ` +
    `→ train ${summary.train} / val ${summary.val} / test ${summary.test}`);
  console.log(`[exportTrajectories] written to ${summary.dir}`);
  if (summary.total < 50) {
    console.log(`[exportTrajectories] ⚠ Only ${summary.total} resolved trades. ` +
      `SkillOpt needs ~50+ for meaningful optimization. Keep collecting.`);
  }
}
