// skillLoader — loads an agent's deployed skill.md at runtime.
// Skills live in skills/<agent>/best_skill.md. Parses frontmatter + named sections.
// Caches by file mtime so edits are picked up next tick without a restart.
// If the file is missing/broken, returns null so callers fall back to their inline prompt.
// This guarantees the runtime NEVER breaks because of a skill file.

import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dir, '..', '..', 'skills');

const cache = new Map(); // agent -> { mtimeMs, skill }

// ─── Minimal frontmatter + section parser (no YAML dependency) ────────────────

function parseSkill(raw) {
  const skill = { frontmatter: {}, sections: {}, raw };

  // Frontmatter between leading --- ... ---
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const body = fmMatch ? fmMatch[2] : raw;
  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (m) skill.frontmatter[m[1]] = m[2].trim();
    }
  }

  // Sections by markdown H1 (# NAME)
  const parts = body.split(/^#\s+/m).filter(Boolean);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const name = (nl === -1 ? part : part.slice(0, nl)).trim().toUpperCase();
    const content = nl === -1 ? '' : part.slice(nl + 1).trim();
    skill.sections[name] = content;
  }

  skill.body = body.trim();
  return skill;
}

// ─── Public: load a deployed skill ────────────────────────────────────────────

/**
 * Load skills/<agent>/best_skill.md. Returns parsed skill or null on any failure.
 * @param {string} agent e.g. 'polymarket_agent'
 */
export function loadSkill(agent) {
  try {
    const path = join(SKILLS_DIR, agent, 'best_skill.md');
    if (!existsSync(path)) return null;

    const mtimeMs = statSync(path).mtimeMs;
    const hit = cache.get(agent);
    if (hit && hit.mtimeMs === mtimeMs) return hit.skill;

    const raw = readFileSync(path, 'utf8');
    const skill = parseSkill(raw);
    cache.set(agent, { mtimeMs, skill });
    return skill;
  } catch {
    return null;
  }
}

/**
 * Get the runtime prompt text for an agent: the full skill body if available,
 * else null (caller uses its own fallback). The body excludes nothing — the
 * agent sees ROLE + DECISION CRITERIA + EVIDENCE + HARD CONSTRAINTS.
 */
export function getSkillPrompt(agent) {
  const skill = loadSkill(agent);
  return skill?.body ?? null;
}

/** Extract the locked HARD CONSTRAINTS section (used by the validator). */
export function getHardConstraints(agent) {
  const skill = loadSkill(agent);
  return skill?.sections['HARD CONSTRAINTS (NEVER EDIT — LOCKED BY VALIDATOR)']
      ?? skill?.sections['HARD CONSTRAINTS']
      ?? null;
}

/** List agents that have a deployed skill. */
export function listSkilledAgents() {
  try {
    return readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => existsSync(join(SKILLS_DIR, name, 'best_skill.md')));
  } catch {
    return [];
  }
}

export { parseSkill, SKILLS_DIR };
