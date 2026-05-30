// skillRegistry — seeds deployed skills into the skill_versions ledger and
// exposes the current deployed version per agent. Idempotent.

import db from '../db/database.mjs';
import { loadSkill, listSkilledAgents } from './skillLoader.mjs';
import { nanoid } from '../utils.mjs';

/** Register the current best_skill.md of every agent as a 'deployed' version (once). */
export function syncDeployedSkills() {
  const agents = listSkilledAgents();
  const synced = [];

  for (const agent of agents) {
    const skill = loadSkill(agent);
    if (!skill) continue;
    const version = parseInt(skill.frontmatter.version ?? '1', 10);

    const exists = db.prepare(
      `SELECT id FROM skill_versions WHERE agent = ? AND version = ?`
    ).get(agent, version);
    if (exists) continue;

    db.prepare(`
      INSERT INTO skill_versions
        (id, agent, version, parent_version, file_path, status, created_at, deployed_at)
      VALUES (?, ?, ?, ?, ?, 'deployed', datetime('now'), datetime('now'))
    `).run(
      `skill-${nanoid()}`,
      agent,
      version,
      parseInt(skill.frontmatter.parent ?? '0', 10),
      `skills/${agent}/best_skill.md`,
    );
    synced.push(`${agent} v${version}`);
  }
  return synced;
}

/** Current deployed version row for an agent. */
export function getDeployed(agent) {
  return db.prepare(
    `SELECT * FROM skill_versions WHERE agent = ? AND status = 'deployed'
     ORDER BY version DESC LIMIT 1`
  ).get(agent);
}

/** Full version history for the dashboard. */
export function getSkillHistory(agent) {
  return db.prepare(
    `SELECT agent, version, status, brier, win_rate, calibration, val_n,
            gate_passed, created_at, deployed_at, reason
     FROM skill_versions WHERE agent = ? ORDER BY version DESC`
  ).all(agent);
}

/** All agents' current deployed skill summary. */
export function getAllDeployed() {
  syncDeployedSkills();
  return db.prepare(
    `SELECT agent, version, status, brier, win_rate, calibration, deployed_at
     FROM skill_versions WHERE status = 'deployed' ORDER BY agent`
  ).all();
}

// CLI: seed deployed skills
if (process.argv[1]?.endsWith('skillRegistry.mjs')) {
  const synced = syncDeployedSkills();
  console.log(synced.length > 0
    ? `[skillRegistry] Registered: ${synced.join(', ')}`
    : '[skillRegistry] All deployed skills already registered.');
}
