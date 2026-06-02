// benchmarkReplay — GATE 2: replay val split against candidate skill.
// For each item, call Claude Haiku with the candidate DECISION CRITERIA + market data.
// Compute Brier score and win-rate. Gate: brier improves >= 0.01 from current.
// Returns { passed, brier, winRate, n, currentBrier, currentWinRate, notes }

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MIN_VAL_N = 20;   // minimum val items to run benchmark
const BRIER_IMPROVE = 0.01;
const WIN_RATE_FLOOR_DELTA = -0.02;

async function callClaude(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 128,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

function extractDecision(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// Brier score for a single prediction (lower = better)
// outcome: 1 if prediction was correct, 0 if wrong
// confidence: stated confidence (0-1) in the chosen side
function brierScore(confidence, correct) {
  const p = Math.min(0.99, Math.max(0.01, confidence));
  return (p - (correct ? 1 : 0)) ** 2;
}

/**
 * Replay val split against candidate decision criteria.
 * @param {string} agent - agent name
 * @param {string} candidateDecisionCriteria - the DECISION CRITERIA section text from candidate
 * @param {object} currentMetrics - { brier, win_rate } from deployed skill (or { brier: 0.25, win_rate: 0 } if none)
 * @returns {{ passed, brier, winRate, n, currentBrier, currentWinRate, notes }}
 */
export async function benchmarkReplay(agent, candidateDecisionCriteria, currentMetrics = {}) {
  const valPath = join(__dir, '..', '..', 'data', 'skillopt', agent, 'val', 'items.json');
  if (!existsSync(valPath)) {
    return { passed: false, brier: null, winRate: null, n: 0, notes: 'No val split found — run export-trajectories first' };
  }

  let items;
  try { items = JSON.parse(readFileSync(valPath, 'utf8')); }
  catch { return { passed: false, brier: null, winRate: null, n: 0, notes: 'Failed to parse val split' }; }

  if (items.length < MIN_VAL_N) {
    return { passed: false, brier: null, winRate: null, n: items.length, notes: `Only ${items.length} val items (need ${MIN_VAL_N}+)` };
  }

  const systemPrompt = `You are evaluating prediction market decisions based on these criteria:\n\n${candidateDecisionCriteria}\n\nFor each market, respond ONLY with JSON: {"action":"BUY"|"SKIP","outcome":"YES"|"NO","confidence":0.XX}`;

  let totalBrier = 0, wins = 0, evaluated = 0;
  const errors = [];

  // Process in small batches to avoid rate limits (sequential for correctness)
  for (const item of items.slice(0, 50)) {  // cap at 50 to limit cost
    const userPrompt = `Market: ${item.input.question}\nCategory: ${item.input.category}\nYES price: ${item.input.yes_price}\nDays to close: ${item.input.days_to_close}\nSource: ${item.input.source}\n\nWould you trade this? Respond with JSON only.`;
    try {
      const raw = await callClaude(systemPrompt, userPrompt);
      const dec = extractDecision(raw);
      if (!dec || dec.action === 'SKIP') continue;  // SKIPs excluded from Brier

      const correct = dec.outcome?.toUpperCase() === item.ground_truth.resolved;
      const conf = Math.min(0.99, Math.max(0.01, dec.confidence ?? 0.5));
      totalBrier += brierScore(conf, correct);
      if (correct) wins++;
      evaluated++;
    } catch (e) {
      errors.push(e.message);
    }
  }

  if (evaluated < 10) {
    return { passed: false, brier: null, winRate: null, n: evaluated, notes: `Only ${evaluated} evaluable items (too few non-SKIP decisions)` };
  }

  const brier = Math.round((totalBrier / evaluated) * 10000) / 10000;
  const winRate = Math.round((wins / evaluated) * 10000) / 10000;
  const currentBrier = currentMetrics.brier ?? 0.25;
  const currentWinRate = currentMetrics.win_rate ?? 0;

  const brierImproves = brier <= currentBrier - BRIER_IMPROVE;
  const winRateOk = winRate >= currentWinRate + WIN_RATE_FLOOR_DELTA;
  const passed = brierImproves && winRateOk;

  const notes = [
    `brier: ${brier} vs current ${currentBrier} (need <= ${(currentBrier - BRIER_IMPROVE).toFixed(4)}) -> ${brierImproves ? 'PASS' : 'FAIL'}`,
    `win_rate: ${winRate} vs current ${currentWinRate} (need >= ${(currentWinRate + WIN_RATE_FLOOR_DELTA).toFixed(4)}) -> ${winRateOk ? 'PASS' : 'FAIL'}`,
    errors.length > 0 ? `${errors.length} API errors skipped` : '',
  ].filter(Boolean).join(' | ');

  return { passed, brier, winRate, n: evaluated, currentBrier, currentWinRate, notes };
}

// CLI: standalone benchmark for testing
if (process.argv[1]?.endsWith('benchmarkReplay.mjs')) {
  const agent = process.argv[2] || 'market-scanner';
  const { getSkillPrompt, SKILLS_DIR } = await import('./skillLoader.mjs');
  const criteria = getSkillPrompt(agent) ?? 'No skill found — pass a skill file as second argument.';
  console.log(`[benchmark] Running replay for "${agent}" against val split...`);
  const result = await benchmarkReplay(
    agent === 'market-scanner' ? 'polymarket_agent' : agent,
    criteria,
    {}
  );
  console.log(`[benchmark] Result: ${result.passed ? 'PASS' : 'FAIL'} — ${result.notes}`);
  console.log(`[benchmark] n=${result.n}, brier=${result.brier}, winRate=${result.winRate}`);
}
