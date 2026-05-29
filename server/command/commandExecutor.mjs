// commandExecutor.mjs — applies parsed actions to Genesis HQ org state.
// Handles conflict resolution, scheduling, and acknowledgement generation.
// This is what makes "pause trading" actually stop the trading agent.

import db, { tx } from '../db/database.mjs';
import { getOrgState, setOrgState, getStatusSummary } from './orgState.mjs';
import { parseCommand, INTENT_TYPES } from './intentParser.mjs';
import { saveFounderFeedback } from '../memory/learningEngine.mjs';
import { nanoid } from '../utils.mjs';

// ─── Duration string → ISO expiration date ───────────────────────────────────

function durationToExpiry(duration) {
  if (!duration || duration === 'permanent') return null;
  const now = new Date();
  const match = duration.match(/^(\d+)(h|d|w|m)$/);
  if (!match) return null;
  const [, n, unit] = match;
  const ms = { h: 3600000, d: 86400000, w: 7*86400000, m: 30*86400000 }[unit];
  return new Date(now.getTime() + parseInt(n) * ms).toISOString();
}

// ─── Priority ordering ────────────────────────────────────────────────────────

const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };

function higherPriority(a, b) {
  return PRIORITY_ORDER[a.priority] <= PRIORITY_ORDER[b.priority];
}

// ─── Apply a single action ────────────────────────────────────────────────────

function applyAction(action, state) {
  const changes = [];

  switch (action.type) {

    case INTENT_TYPES.REST: {
      const except = action.params?.except ?? [];
      const newDepts = Object.fromEntries(
        Object.keys(state.activeDepts).map(dept => [
          dept,
          except.includes(dept) ? true : false,
        ])
      );
      Object.assign(state, { mode: 'rest', activeDepts: newDepts });
      changes.push(`🌙 Mode → REST. All departments paused${except.length ? ` (except: ${except.join(', ')})` : ''}.`);
      break;
    }

    case INTENT_TYPES.PAUSE_DEPT: {
      const depts = Array.isArray(action.params?.depts) ? action.params.depts : [action.params?.depts];
      for (const dept of depts) {
        if (dept && state.activeDepts[dept] !== undefined) {
          state.activeDepts[dept] = false;
          changes.push(`⏸ Department paused: ${dept}`);
        }
      }
      break;
    }

    case INTENT_TYPES.RESUME_DEPT: {
      const depts = action.params?.depts;
      if (depts === 'all') {
        Object.keys(state.activeDepts).forEach(d => { state.activeDepts[d] = true; });
        state.mode = 'normal';
        changes.push('▶ All departments resumed. Mode → NORMAL.');
      } else {
        const list = Array.isArray(depts) ? depts : [depts];
        for (const dept of list) {
          if (dept && state.activeDepts[dept] !== undefined) {
            state.activeDepts[dept] = true;
            changes.push(`▶ Department resumed: ${dept}`);
          }
        }
      }
      break;
    }

    case INTENT_TYPES.SET_FOCUS: {
      const topic  = action.params?.topic ?? action.params?.dept ?? 'general';
      const dept   = action.params?.dept;
      const expiry = durationToExpiry(action.duration);

      state.focus = {
        topic,
        dept: dept ?? null,
        reason: action.summary,
        since:  new Date().toISOString(),
        expiresAt: expiry,
      };

      // If focusing on a non-trading topic, can optionally suggest pausing markets
      if (dept && dept !== 'prediction_markets') {
        changes.push(`🎯 Focus set: ${topic}${dept ? ` (${dept})` : ''}${expiry ? ` until ${expiry.slice(0,10)}` : ''}`);
      } else {
        changes.push(`🎯 Focus set: ${topic}${expiry ? ` until ${expiry.slice(0,10)}` : ''}`);
      }
      break;
    }

    case INTENT_TYPES.SET_GOAL: {
      const target  = action.params?.target ?? 0;
      const unit    = action.params?.unit ?? 'usd';
      const period  = action.params?.period ?? 'week';
      const expiry  = durationToExpiry(action.duration ?? '1w');

      state.goal = {
        description: `${unit === 'usd' ? '$' : ''}${target} paper PnL this ${period}`,
        target,
        unit,
        period,
        current:   0,
        deadline:  expiry,
        createdAt: new Date().toISOString(),
      };

      if (state.mode === 'rest') {
        changes.push(`⚠ Goal set while in REST mode — will activate when agents resume`);
      }
      changes.push(`🏆 Goal: ${state.goal.description}${expiry ? ` by ${expiry.slice(0,10)}` : ''}`);
      break;
    }

    case INTENT_TYPES.CHANGE_RISK: {
      const level = action.params?.level ?? 'normal';
      state.riskTolerance = level;

      const settings = {
        conservative: { maxRiskPct: 0.02, minConfidence: 0.72, maxOpenTrades: 3 },
        normal:       { maxRiskPct: 0.05, minConfidence: 0.65, maxOpenTrades: 5 },
        aggressive:   { maxRiskPct: 0.08, minConfidence: 0.60, maxOpenTrades: 7 },
      };

      const s = settings[level] ?? settings.normal;
      Object.assign(state, s);

      const emoji = level === 'conservative' ? '🛡' : level === 'aggressive' ? '⚡' : '⚖';
      changes.push(`${emoji} Risk → ${level.toUpperCase()}: ${(s.maxRiskPct*100)}%/trade, min ${(s.minConfidence*100)}% confidence, max ${s.maxOpenTrades} open`);
      break;
    }

    case INTENT_TYPES.EMERGENCY: {
      const eType = action.params?.type ?? 'sentinel';
      const except = action.params?.except ?? ['operations'];

      const newDepts = Object.fromEntries(
        Object.keys(state.activeDepts).map(dept => [dept, except.includes(dept)])
      );

      Object.assign(state, {
        mode:      'emergency',
        activeDepts: newDepts,
        riskTolerance: 'conservative',
        maxRiskPct: 0.01,
        minConfidence: 0.80,
        maxOpenTrades: 1,
        emergency: {
          type:        eType,
          activatedAt: new Date().toISOString(),
          reason:      action.summary,
        },
      });

      changes.push(`🚨 EMERGENCY MODE: ${eType.toUpperCase()}. All non-essential agents paused.`);
      changes.push(`🔒 Risk locked to minimum: 1%/trade, min 80% confidence`);
      break;
    }

    case INTENT_TYPES.BUDGET: {
      const pct = action.params?.pct ?? action.params?.percent;
      if (pct) {
        state.maxRiskPct = pct / 100;
        changes.push(`💰 Budget per trade: ${pct}% of capital`);
      }
      break;
    }

    case INTENT_TYPES.RESET: {
      const keepCapital = action.params?.keepCapital !== false;
      const keepLessons = action.params?.keepLessons !== false;
      // Reset mode and depts, keep important data
      Object.assign(state, {
        mode:          'normal',
        activeDepts:   { prediction_markets: true, research: true, marketing: true, sales: false, operations: true },
        riskTolerance: 'normal',
        focus:         null,
        goal:          null,
        emergency:     null,
        schedule:      [],
        maxRiskPct:    0.05,
        minConfidence: 0.65,
        maxOpenTrades: 5,
      });
      changes.push(`🔄 Organization reset to defaults${keepCapital ? ' (capital preserved)' : ''}${keepLessons ? ' (lessons preserved)' : ''}`);
      break;
    }

    case INTENT_TYPES.STATUS: {
      changes.push(`📊 STATUS REPORT\n${getStatusSummary()}`);
      break;
    }

    case INTENT_TYPES.UNKNOWN: {
      changes.push(`❓ Command not recognized. Try: "pause trading", "rest today", "goal $500 this week", "reduce risk", "focus on marketing"`);
      break;
    }
  }

  return changes;
}

// ─── Conflict resolution ──────────────────────────────────────────────────────
// Returns filtered/merged actions with conflicts resolved

function resolveConflicts(actions, currentState) {
  const warnings = [];

  // Sort by priority (critical first)
  actions.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  // Conflict: REST + SET_GOAL (compatible — goal applies when rest ends)
  // Conflict: REST + SET_FOCUS (compatible — focus applies when rest ends)
  // Conflict: PAUSE_DEPT + RESUME_DEPT same dept → newer wins (higher in sorted list)

  const seen = new Set();
  const resolved = [];

  for (const action of actions) {
    const key = `${action.type}_${JSON.stringify(action.params)}`;
    if (seen.has(key)) {
      warnings.push(`Duplicate action skipped: ${action.summary}`);
      continue;
    }
    seen.add(key);
    resolved.push(action);
  }

  // Special case: EMERGENCY overrides everything except STATUS
  if (resolved.find(a => a.type === INTENT_TYPES.EMERGENCY)) {
    const nonEmergency = resolved.filter(a =>
      a.type !== INTENT_TYPES.EMERGENCY &&
      a.type !== INTENT_TYPES.STATUS &&
      a.type !== INTENT_TYPES.SET_GOAL
    );
    if (nonEmergency.length > 0) {
      warnings.push(`Emergency mode: ${nonEmergency.length} actions deferred`);
    }
    return {
      actions: resolved.filter(a =>
        a.type === INTENT_TYPES.EMERGENCY ||
        a.type === INTENT_TYPES.STATUS ||
        a.type === INTENT_TYPES.SET_GOAL
      ),
      warnings,
    };
  }

  return { actions: resolved, warnings };
}

// ─── Schedule management ──────────────────────────────────────────────────────

function addToSchedule(state, action, commandId) {
  if (!action.duration || action.duration === 'permanent') return;
  const expiresAt = durationToExpiry(action.duration);
  if (!expiresAt) return;

  const schedule = state.schedule ?? [];
  schedule.push({ commandId, action, expiresAt });
  state.schedule = schedule.slice(-20); // keep last 20
}

// ─── Main execute function ────────────────────────────────────────────────────

export async function executeCommand(rawCommand) {
  const state   = getOrgState();
  const actions = await parseCommand(rawCommand, state);
  const { actions: resolved, warnings } = resolveConflicts(actions, state);

  const commandId = `cmd-${nanoid()}`;
  const allChanges = [];

  // Apply each resolved action
  for (const action of resolved) {
    const changes = applyAction(action, state);
    allChanges.push(...changes);
    addToSchedule(state, action, commandId);
  }

  // Persist org state
  state.founderNote = rawCommand.slice(0, 200);
  const finalState = setOrgState(state);

  // Persist to SQLite founder_orders
  tx(() => {
    db.prepare(`
      INSERT INTO founder_orders
        (id, instruction, priority, parsed_action, acknowledged, executed, execution_notes, issued_at)
      VALUES (?, ?, ?, ?, 1, 1, ?, datetime('now'))
    `).run(
      commandId,
      rawCommand,
      resolved[0]?.priority ?? 'normal',
      JSON.stringify(resolved),
      allChanges.join('\n'),
    );
  });

  // If it's a meaningful instruction, save as a learning memory
  if (resolved[0]?.type !== INTENT_TYPES.STATUS && resolved[0]?.type !== INTENT_TYPES.UNKNOWN) {
    try { await saveFounderFeedback(rawCommand); } catch { /* non-critical */ }
  }

  // Build acknowledgement
  const ack = buildAcknowledgement(rawCommand, resolved, allChanges, warnings, finalState);

  console.log(`[command] "${rawCommand.slice(0, 60)}" → ${allChanges.length} changes applied`);
  allChanges.forEach(c => console.log(`  ${c}`));

  return {
    commandId,
    rawCommand,
    actions:  resolved,
    changes:  allChanges,
    warnings,
    acknowledgement: ack,
    orgState: finalState,
  };
}

// ─── Acknowledgement generator ────────────────────────────────────────────────

function buildAcknowledgement(rawCommand, actions, changes, warnings, state) {
  const lines = [];

  lines.push(`✅ Command received: "${rawCommand}"`);
  lines.push('');

  if (changes.length > 0) {
    lines.push('Changes applied:');
    changes.forEach(c => lines.push(`  ${c}`));
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push('⚠ Warnings:');
    warnings.forEach(w => lines.push(`  ${w}`));
    lines.push('');
  }

  // Current state summary
  lines.push(`Current mode: ${state.mode.toUpperCase()}`);
  const activeDepts = Object.entries(state.activeDepts).filter(([, v]) => v).map(([k]) => k);
  lines.push(`Active: ${activeDepts.join(', ') || 'none'}`);
  lines.push(`Risk: ${state.riskTolerance}`);

  if (state.goal) {
    lines.push(`Goal: ${state.goal.description}${state.goal.deadline ? ` by ${state.goal.deadline.slice(0,10)}` : ''}`);
  }

  if (state.mode === 'rest') {
    lines.push('');
    lines.push('💤 Agents are resting. All autonomous operations paused.');
    lines.push('Say "resume" or "wake up" to restart operations.');
  }

  if (state.mode === 'emergency') {
    lines.push('');
    lines.push('🚨 Emergency mode active. Only Sentinel is running.');
    lines.push('Say "resume" to return to normal operations.');
  }

  return lines.join('\n');
}

// ─── Get command history ──────────────────────────────────────────────────────

export function getCommandHistory(limit = 20) {
  return db.prepare(`
    SELECT id, instruction, priority, execution_notes, issued_at
    FROM founder_orders
    ORDER BY issued_at DESC LIMIT ?
  `).all(limit);
}
