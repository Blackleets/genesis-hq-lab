// validateSkill — GATE 1: static, deterministic validation of a candidate skill.
// No LLM. Runs before any benchmark replay. A candidate that fails here is rejected
// outright — this is what prevents an agent from loosening its own risk limits.
//
// Run: node server/skills/validateSkill.mjs <agent> <candidate_file>

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSkill, SKILLS_DIR } from './skillLoader.mjs';

const HARD_KEYS = [
  'HARD CONSTRAINTS (NEVER EDIT — LOCKED BY VALIDATOR)',
  'HARD CONSTRAINTS',
];

function getHardBlock(skill) {
  for (const k of HARD_KEYS) if (skill.sections[k] != null) return skill.sections[k].trim();
  return null;
}

const REQUIRED_SECTIONS = ['ROLE', 'DECISION CRITERIA', 'EVIDENCE CHECKLIST'];

/**
 * Validate a candidate skill against the currently deployed best_skill.md.
 * @returns { ok, errors[], warnings[] }
 */
export function validateCandidate(agent, candidateRaw) {
  const errors = [];
  const warnings = [];

  // 1. Parses?
  let candidate;
  try { candidate = parseSkill(candidateRaw); }
  catch { return { ok: false, errors: ['Candidate does not parse'], warnings }; }

  // 2. Required sections present?
  for (const s of REQUIRED_SECTIONS) {
    if (!candidate.sections[s]) errors.push(`Missing required section: ${s}`);
  }

  // 3. Has a hard-constraints block?
  const candHard = getHardBlock(candidate);
  if (!candHard) errors.push('Missing HARD CONSTRAINTS block');

  // 4. HARD CONSTRAINTS must be byte-identical to the deployed skill.
  const deployedPath = join(SKILLS_DIR, agent, 'best_skill.md');
  if (existsSync(deployedPath)) {
    const deployed = parseSkill(readFileSync(deployedPath, 'utf8'));
    const deployedHard = getHardBlock(deployed);
    if (deployedHard && candHard && normalize(candHard) !== normalize(deployedHard)) {
      errors.push('HARD CONSTRAINTS block was modified — locked section may not change');
    }
  } else {
    warnings.push('No deployed skill to compare hard constraints against (first version)');
  }

  // 5. Numeric guardrails: candidate text must not raise risk above constitution bounds.
  const body = candidate.body.toLowerCase();
  // Detect any "X% per trade" that exceeds 5%
  for (const m of body.matchAll(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:available\s+)?capital\s+per\s+trade/g)) {
    if (parseFloat(m[1]) > 5) errors.push(`Per-trade risk ${m[1]}% exceeds 5% hard cap`);
  }
  // Detect "max N open" above 5 — informational (risk_agent may differ), warn only
  for (const m of body.matchAll(/max\s+(\d+)\s+open/g)) {
    if (parseInt(m[1]) > 5) warnings.push(`Mentions max ${m[1]} open positions (> 5)`);
  }
  // Confidence floor must not drop below 0.65
  for (const m of body.matchAll(/confidence\s*(?:≥|>=|of)\s*0?\.(\d+)/g)) {
    const v = parseFloat('0.' + m[1]);
    if (v < 0.65) warnings.push(`Mentions confidence threshold ${v} (< 0.65 floor)`);
  }
  // Never allow real-money language
  if (/real\s+money|live\s+trading\s+with\s+real/.test(body) && !/no\s+real\s+money|paper\s+(?:trading\s+)?only/.test(body)) {
    errors.push('Candidate appears to permit real-money trading');
  }

  return { ok: errors.length === 0, errors, warnings };
}

function normalize(s) {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

// CLI
if (process.argv[1]?.endsWith('validateSkill.mjs')) {
  const agent = process.argv[2];
  const file  = process.argv[3];
  if (!agent || !file) {
    console.error('Usage: node server/skills/validateSkill.mjs <agent> <candidate_file>');
    process.exit(1);
  }
  const raw = readFileSync(file, 'utf8');
  const result = validateCandidate(agent, raw);
  console.log(`[validateSkill] ${agent} — ${result.ok ? 'PASS ✓' : 'FAIL ✗'}`);
  result.errors.forEach((e) => console.log(`  ERROR:   ${e}`));
  result.warnings.forEach((w) => console.log(`  warning: ${w}`));
  process.exit(result.ok ? 0 : 1);
}
