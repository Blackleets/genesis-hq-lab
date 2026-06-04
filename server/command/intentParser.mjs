// intentParser.mjs — translates founder natural language into structured actions.
// One Claude Haiku call per command (~$0.0003).
// Includes fallback regex patterns for common commands (works offline too).

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

// ─── Intent types ─────────────────────────────────────────────────────────────

export const INTENT_TYPES = {
  REST: 'REST',           // pause everything
  PAUSE_DEPT: 'PAUSE_DEPT',    // pause specific departments
  RESUME_DEPT: 'RESUME_DEPT',   // resume specific departments
  SET_FOCUS: 'SET_FOCUS',     // redirect resources
  SET_GOAL: 'SET_GOAL',      // set a target
  CHANGE_RISK: 'CHANGE_RISK',   // risk tolerance
  EMERGENCY: 'EMERGENCY',     // emergency mode
  BUDGET: 'BUDGET',        // change capital allocation
  SCHEDULE: 'SCHEDULE',      // time-bounded command
  RESET: 'RESET',         // clear state and restart
  STATUS: 'STATUS',        // founder asking for status
  UNKNOWN: 'UNKNOWN',
};

const SYSTEM_PROMPT = `You are the command interpreter for Genesis HQ, an autonomous AI company.
The founder issues commands in natural language. You convert them to structured JSON actions.

Genesis HQ has these departments:
- prediction_markets: prediction market trading on Polymarket and Kalshi (paper trading by default, real execution when enabled)
- research: market signals, news analysis, opportunity research
- marketing: content generation, social media
- sales: outreach, business development (currently inactive)
- operations: memory, learning, capital management (always active)

Risk tolerance levels: conservative | normal | aggressive

Parse the founder's command and respond with ONLY a valid JSON array of actions.
One command can produce multiple actions (e.g., "focus on marketing" = pause markets + set focus).
Always include a human-readable "summary" field explaining what will happen.`;

const USER_TEMPLATE = (command, currentState) => `FOUNDER COMMAND: "${command}"

CURRENT STATE:
- Mode: ${currentState.mode}
- Active depts: ${Object.entries(currentState.activeDepts).filter(([, v]) => v).map(([k]) => k).join(', ')}
- Risk: ${currentState.riskTolerance}
- Current focus: ${currentState.focus?.topic ?? 'none'}
- Current goal: ${currentState.goal?.description ?? 'none'}

Parse this into a JSON array of actions. Each action must have:
{
  "type": one of [REST, PAUSE_DEPT, RESUME_DEPT, SET_FOCUS, SET_GOAL, CHANGE_RISK, EMERGENCY, BUDGET, SCHEDULE, RESET, STATUS],
  "params": { ... relevant parameters ... },
  "priority": "critical" | "high" | "normal" | "low",
  "duration": "Xh" | "Xd" | "Xw" | "permanent" | null,
  "summary": "What this action does in plain English"
}

Examples:
- "Everyone rest today" → [{ type: "REST", params: {}, priority: "critical", duration: "1d", summary: "All agents pause for 24h" }]
- "Pause trading" → [{ type: "PAUSE_DEPT", params: { depts: ["prediction_markets"] }, priority: "high", duration: "permanent", summary: "Prediction markets department paused" }]
- "Goal $1000 this week" → [{ type: "SET_GOAL", params: { target: 1000, unit: "usd", period: "week" }, priority: "high", duration: "1w", summary: "Weekly goal: $1000 paper PnL" }]
- "Only security agent stays active" → [{ type: "REST", params: { except: ["operations"] }, priority: "critical", duration: null, summary: "Emergency sentinel mode: only operations active" }]
- "Focus on marketing" → [{ type: "SET_FOCUS", params: { dept: "marketing", topic: "marketing" }, priority: "high", duration: "1w", summary: "All resources redirect to marketing" }, { type: "PAUSE_DEPT", params: { depts: ["prediction_markets"] }, priority: "high", duration: "1w", summary: "Markets paused during marketing focus" }]
- "More aggressive growth" → [{ type: "CHANGE_RISK", params: { level: "aggressive" }, priority: "high", duration: null, summary: "Risk tolerance increased to aggressive" }]
- "Research dropshipping" → [{ type: "SET_FOCUS", params: { topic: "dropshipping", dept: "research" }, priority: "high", duration: "1w", summary: "Research agent focuses on dropshipping opportunities" }]
- "Reduce risk" → [{ type: "CHANGE_RISK", params: { level: "conservative" }, priority: "high", duration: null, summary: "Risk tolerance reduced to conservative" }]

Respond with ONLY the JSON array. No markdown, no explanation.`;

// ─── Claude Haiku parse ───────────────────────────────────────────────────────

async function parseWithClaude(command, currentState) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: USER_TEMPLATE(command, currentState) }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`Claude ${res.status}`);
    const data = await res.json();
    const raw = data.content?.[0]?.text ?? '';

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const actions = JSON.parse(match[0]);
    if (!Array.isArray(actions) || actions.length === 0) return null;
    return actions;
  } catch (err) {
    console.warn('[intentParser] Claude unavailable:', err.message);
    return null;
  }
}

// ─── Regex fallback — works without Claude ────────────────────────────────────

function parseWithRules(command) {
  const cmd = command.toLowerCase().trim();
  const actions = [];

  // REST / PAUSE ALL
  if (/rest|descans|todos.*pausa|everyone.*rest|pause.*all|stop.*everything/i.test(cmd)) {
    const isToday = /today|hoy|día|dia/.test(cmd);
    actions.push({
      type: INTENT_TYPES.REST,
      params: {},
      priority: 'critical',
      duration: isToday ? '1d' : 'permanent',
      summary: `All agents pause${isToday ? ' for 24 hours' : ' until resumed'}`,
    });
  }

  // PAUSE specific dept
  if (/pause.*trad|stop.*trad|pausa.*mercad|pausa.*trading/i.test(cmd)) {
    actions.push({
      type: INTENT_TYPES.PAUSE_DEPT,
      params: { depts: ['prediction_markets'] },
      priority: 'high',
      duration: 'permanent',
      summary: 'Prediction markets department paused',
    });
  }

  // RESUME / ACTIVATE
  if (/resume|reactivat|reactive|reanud|wake up/i.test(cmd)) {
    actions.push({
      type: INTENT_TYPES.RESUME_DEPT,
      params: { depts: 'all' },
      priority: 'high',
      duration: null,
      summary: 'All departments resumed',
    });
  }

  // GOAL with dollar amount
  const goalMatch = cmd.match(/goal.*\$?([\d,]+)|objective.*\$?([\d,]+)|\$?([\d,]+).*(week|semana|month)/i);
  if (goalMatch) {
    const amount = parseInt((goalMatch[1] || goalMatch[2] || goalMatch[3] || '0').replace(/,/g, ''));
    const isWeek = /week|semana/.test(cmd);
    const isMo = /month|mes/.test(cmd);
    actions.push({
      type: INTENT_TYPES.SET_GOAL,
      params: { target: amount, unit: 'usd', period: isWeek ? 'week' : isMo ? 'month' : 'week' },
      priority: 'high',
      duration: isWeek ? '1w' : isMo ? '1m' : '1w',
      summary: `Goal set: $${amount} paper PnL${isWeek ? ' this week' : isMo ? ' this month' : ''}`,
    });
  }

  // RISK levels
  if (/aggressive|agresiv|more risk|más riesgo|high risk/i.test(cmd)) {
    actions.push({
      type: INTENT_TYPES.CHANGE_RISK,
      params: { level: 'aggressive' },
      priority: 'high',
      duration: null,
      summary: 'Risk tolerance raised to aggressive (8% per trade, min 60% confidence)',
    });
  } else if (/conservative|conservador|reduce risk|less risk|reduce.*risk/i.test(cmd)) {
    actions.push({
      type: INTENT_TYPES.CHANGE_RISK,
      params: { level: 'conservative' },
      priority: 'high',
      duration: null,
      summary: 'Risk tolerance reduced to conservative (2% per trade, min 72% confidence)',
    });
  } else if (/normal risk|reset risk|neutral/i.test(cmd)) {
    actions.push({
      type: INTENT_TYPES.CHANGE_RISK,
      params: { level: 'normal' },
      priority: 'normal',
      duration: null,
      summary: 'Risk tolerance reset to normal',
    });
  }

  // FOCUS commands
  const focusMatch = cmd.match(/focus.*on\s+(\w+)|focus:\s*(\w+)|enfoca.*en\s+(\w+)/i);
  const topicMatch = cmd.match(/(dropshipping|marketing|research|crypto|sports|politics|climate|tech)/i);
  const topic = focusMatch?.[1] || focusMatch?.[2] || focusMatch?.[3] || topicMatch?.[1];
  if (topic && !actions.find(a => a.type === INTENT_TYPES.REST)) {
    actions.push({
      type: INTENT_TYPES.SET_FOCUS,
      params: { topic: topic.toLowerCase(), dept: /dropship|opportun|negoc/.test(cmd) ? 'research' : topic.toLowerCase() },
      priority: 'high',
      duration: '1w',
      summary: `Focus redirected to ${topic} for 1 week`,
    });
  }

  // EMERGENCY / SENTINEL
  if (/emergency|emergencia|sentinel|only.*security|solo.*segur/i.test(cmd)) {
    actions.push({
      type: INTENT_TYPES.EMERGENCY,
      params: { type: 'sentinel', except: ['operations'] },
      priority: 'critical',
      duration: null,
      summary: 'Emergency sentinel mode: only operations/monitoring active',
    });
  }

  // STATUS
  if (/status|estado|how.*going|how are|qué.*pasando/i.test(cmd)) {
    actions.push({
      type: INTENT_TYPES.STATUS,
      params: {},
      priority: 'normal',
      duration: null,
      summary: 'Status report requested',
    });
  }

  // RESET
  if (/reset.*everything|restart|clear.*state|borrar.*estado|empezar de cero/i.test(cmd)) {
    actions.push({
      type: INTENT_TYPES.RESET,
      params: { keepCapital: true, keepLessons: true },
      priority: 'critical',
      duration: null,
      summary: 'Organization state reset (capital and lessons preserved)',
    });
  }

  return actions.length > 0 ? actions : null;
}

// ─── Main parse function ──────────────────────────────────────────────────────

export async function parseCommand(command, currentState) {
  // Try Claude first, fall back to rules
  const claudeActions = await parseWithClaude(command, currentState);
  const actions = claudeActions ?? parseWithRules(command);

  if (!actions || actions.length === 0) {
    return [{
      type: INTENT_TYPES.UNKNOWN,
      params: { rawCommand: command },
      priority: 'low',
      duration: null,
      summary: `Command not recognized: "${command.slice(0, 80)}". Try: pause trading / rest today / goal $500 this week / reduce risk / focus on marketing`,
    }];
  }

  return actions;
}
