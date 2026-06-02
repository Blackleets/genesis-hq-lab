// runSkillOpt — weekly skill optimizer for Genesis HQ agents.
// Pipeline: export -> analyze failures -> propose -> validate -> benchmark -> deploy
// Run: npm run skillopt [agent]
// Cost: ~$0.01-0.03 per run (Haiku)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportAgent } from './exportTrajectories.mjs';
import { validateCandidate } from './validateSkill.mjs';
import { benchmarkReplay } from './benchmarkReplay.mjs';
import { loadSkill, getSkillPrompt, SKILLS_DIR, parseSkill } from './skillLoader.mjs';
import { getDeployed, syncDeployedSkills } from './skillRegistry.mjs';
import db from '../db/database.mjs';
import { nanoid } from '../utils.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const DATA_ROOT = join(__dir, '..', '..', 'data', 'skillopt');
const CHANGELOG = join(__dir, '..', '..', 'docs', 'CHANGELOG_AI.md');
const MIN_TRAIN_FOR_OPT = 10;  // minimum closed trades to attempt optimization

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
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

function appendChangelog(entry) {
  const today = new Date().toISOString().slice(0, 10);
  const line = `\n## ${today} — SkillOpt\n${entry}\n`;
  try {
    const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf8') : '';
    writeFileSync(CHANGELOG, existing + line, 'utf8');
  } catch { /* changelog is nice-to-have, don't fail */ }
}

/**
 * Run full SkillOpt loop for one agent.
 * @returns {{ deployed, reason, metrics }} or { deployed: false, reason, metrics: null }
 */
export async function runSkillOpt(agent = 'market-scanner') {
  console.log(`\n[skillopt] == Starting SkillOpt for "${agent}" ==`);

  // -- Step 1: Export trajectories --
  console.log('[skillopt] Step 1: exporting trajectories...');
  const summary = exportAgent(agent === 'market-scanner' ? 'polymarket_agent' : agent);
  console.log(`[skillopt] ${summary.total} resolved trades (train: ${summary.train}, val: ${summary.val}, test: ${summary.test})`);

  if (summary.train < MIN_TRAIN_FOR_OPT) {
    const reason = `Not enough training data (${summary.train} < ${MIN_TRAIN_FOR_OPT} required)`;
    console.log(`[skillopt] Skipping: ${reason}`);
    return { deployed: false, reason, metrics: null };
  }

  // -- Step 2: Load current skill --
  const currentSkillBody = getSkillPrompt(agent);
  const currentSkill = loadSkill(agent);
  const currentVersion = parseInt(currentSkill?.frontmatter?.version ?? '0', 10);
  const nextVersion = currentVersion + 1;
  const deployedRow = getDeployed(agent);
  const currentMetrics = {
    brier:    deployedRow?.brier    ?? null,
    win_rate: deployedRow?.win_rate ?? null,
  };

  // -- Step 3: Analyze failures --
  console.log('[skillopt] Step 2: analyzing failure patterns...');
  const normalizedAgent = agent === 'market-scanner' ? 'polymarket_agent' : agent;
  const trainPath = join(DATA_ROOT, normalizedAgent, 'train', 'items.json');
  if (!existsSync(trainPath)) {
    return { deployed: false, reason: 'Train split not found after export', metrics: null };
  }

  let trainItems;
  try { trainItems = JSON.parse(readFileSync(trainPath, 'utf8')); }
  catch { return { deployed: false, reason: 'Failed to parse train split', metrics: null }; }

  // Focus analysis on failures (wrong predictions, big losses)
  const failures = trainItems
    .filter(item => !item.ground_truth.correct || (item.ground_truth.pnl ?? 0) < -1)
    .slice(0, 15);  // top 15 failures for analysis

  const failureSummary = failures.length > 0
    ? failures.map((f, i) =>
        `${i+1}. Q: "${f.input.question.slice(0, 80)}"\n   Action: ${f.agent_action.outcome} @${f.input.yes_price} conf:${f.agent_action.confidence}\n   Result: ${f.ground_truth.resolved} (pnl: ${f.ground_truth.pnl?.toFixed(2) ?? 'N/A'})\n   Lesson: ${f.reflection?.lesson ?? 'none'}`
      ).join('\n')
    : 'No failures found in training data.';

  const optimizerSystem = `You are a trading strategy optimizer for an AI prediction market agent.
Your job: analyze trading failures and propose improvements to the DECISION CRITERIA section only.
Return ONLY the updated DECISION CRITERIA section text (no frontmatter, no other sections).
Rules that may NEVER be changed (hard limits): max 5% per trade, confidence >= 0.65, paper trading only.`;

  const currentCriteria = currentSkill?.sections?.['DECISION CRITERIA']
    ?? currentSkillBody
    ?? 'No current DECISION CRITERIA found.';

  const optimizerPrompt = `CURRENT DECISION CRITERIA:\n${currentCriteria}\n\nRECENT FAILURES TO LEARN FROM:\n${failureSummary}\n\nPropose an improved DECISION CRITERIA section. Be specific. Keep it under 400 words. Return only the section text, starting with "# DECISION CRITERIA".`;

  let newCriteria;
  try {
    console.log('[skillopt] Step 3: calling Claude to propose improvements...');
    newCriteria = await callClaude(optimizerSystem, optimizerPrompt);
  } catch (e) {
    return { deployed: false, reason: `Claude call failed: ${e.message}`, metrics: null };
  }

  // -- Step 4: Assemble candidate skill file --
  const candidateRaw = currentSkillBody
    ? currentSkillBody.replace(
        /^# DECISION CRITERIA[\s\S]*?(?=^# [A-Z]|\s*$)/m,
        newCriteria.trim() + '\n\n'
      )
    : `---\nversion: ${nextVersion}\nstatus: candidate\nparent: ${currentVersion}\n---\n\n${newCriteria}`;

  // -- Step 5: Gate 1 — Static validation --
  console.log('[skillopt] Step 4: Gate 1 — static validation...');
  const v1 = validateCandidate(agent, candidateRaw);
  console.log(`[skillopt] Gate 1: ${v1.ok ? 'PASS' : 'FAIL'}`);
  if (!v1.ok) {
    const reason = `Gate 1 failed: ${v1.errors.join('; ')}`;
    console.log(`[skillopt] ${reason}`);
    appendChangelog(`- Agent: ${agent} v${nextVersion} — REJECTED (Gate 1): ${v1.errors[0]}`);
    return { deployed: false, reason, metrics: null };
  }

  // -- Step 6: Gate 2 — Benchmark replay --
  console.log('[skillopt] Step 5: Gate 2 — benchmark replay...');
  const candidateSkill = parseSkill(candidateRaw);
  const candidateCriteria = candidateSkill.sections['DECISION CRITERIA'] ?? newCriteria;
  const benchResult = await benchmarkReplay(agent === 'market-scanner' ? 'polymarket_agent' : agent, candidateCriteria, currentMetrics);
  console.log(`[skillopt] Gate 2: ${benchResult.passed ? 'PASS' : 'FAIL'} — ${benchResult.notes}`);

  if (!benchResult.passed) {
    const reason = `Gate 2 failed: ${benchResult.notes}`;
    // Record in DB as rejected candidate
    db.prepare(`INSERT INTO skill_versions (id, agent, version, parent_version, file_path, status, brier, win_rate, val_n, gate_passed, gate_notes, created_at, reason)
      VALUES (?, ?, ?, ?, ?, 'rejected', ?, ?, ?, 0, ?, datetime('now'), ?)`)
      .run(`skill-${nanoid()}`, agent, nextVersion, currentVersion, `skills/${agent}/skill_v${nextVersion}.md`,
           benchResult.brier, benchResult.winRate, benchResult.n, benchResult.notes, `Gate 2 failed: ${benchResult.notes}`);
    appendChangelog(`- Agent: ${agent} v${nextVersion} — REJECTED (Gate 2): ${benchResult.notes}`);
    return { deployed: false, reason, metrics: benchResult };
  }

  // -- Step 7: Deploy --
  console.log('[skillopt] Step 6: deploying new skill...');
  const agentSkillDir = join(SKILLS_DIR, agent);
  if (!existsSync(agentSkillDir)) mkdirSync(agentSkillDir, { recursive: true });

  // Write versioned copy
  const versionedPath = join(agentSkillDir, `skill_v${nextVersion}.md`);
  const finalRaw = candidateRaw.replace(/^version: \d+/m, `version: ${nextVersion}`)
                               .replace(/^status: \w+/m, 'status: deployed');
  writeFileSync(versionedPath, finalRaw, 'utf8');

  // Replace best_skill.md
  writeFileSync(join(agentSkillDir, 'best_skill.md'), finalRaw, 'utf8');

  // Record in DB
  db.prepare(`INSERT INTO skill_versions (id, agent, version, parent_version, file_path, status, brier, win_rate, val_n, gate_passed, gate_notes, created_at, deployed_at, reason)
    VALUES (?, ?, ?, ?, ?, 'deployed', ?, ?, ?, 1, ?, datetime('now'), datetime('now'), ?)`)
    .run(`skill-${nanoid()}`, agent, nextVersion, currentVersion, `skills/${agent}/best_skill.md`,
         benchResult.brier, benchResult.winRate, benchResult.n, benchResult.notes,
         `Auto-deployed via SkillOpt. Brier: ${benchResult.brier}, WinRate: ${benchResult.winRate}`);

  const deployMsg = `- Agent: ${agent} v${nextVersion} DEPLOYED. Brier: ${benchResult.brier} (was ${currentMetrics.brier ?? 'N/A'}), WinRate: ${benchResult.winRate}`;
  console.log(`[skillopt] ${deployMsg}`);
  appendChangelog(deployMsg);

  return { deployed: true, reason: 'Deployed successfully', metrics: benchResult };
}

// CLI
if (process.argv[1]?.endsWith('runSkillOpt.mjs')) {
  const agent = process.argv[2] || 'market-scanner';
  runSkillOpt(agent)
    .then(result => {
      console.log(`\n[skillopt] Result: ${result.deployed ? 'DEPLOYED' : 'NOT DEPLOYED'} — ${result.reason}`);
      process.exit(result.deployed ? 0 : 1);
    })
    .catch(e => { console.error('[skillopt] Fatal:', e); process.exit(1); });
}
