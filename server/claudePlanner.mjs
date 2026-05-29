// Claude-powered plan generator for AutoView.
// Called from /api/plan in index.mjs.
// Requires ANTHROPIC_API_KEY in the environment.

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

const VALID_TYPES = [
  'market_scan', 'risk_review', 'memory_archive', 'hr_review', 'decision_review',
  'agent_training', 'system_check', 'peer_training', 'module_unlock_review',
  'signal_generation', 'performance_review', 'agent_onboarding',
];

const VALID_ROOMS = [
  'market-desk', 'risk-bunker', 'memory-archive', 'hr-pod', 'board-room',
  'debate-room', 'strategy-lab', 'execution-desk', 'open-workspace',
];

const SYSTEM_PROMPT = `You are the planning core of Genesis HQ, an autonomous AI organization.
Given a goal, produce a task plan. Respond ONLY with a valid JSON array — no markdown, no explanation.

Each task object must have exactly these keys:
- "type": one of ${JSON.stringify(VALID_TYPES)}
- "room": one of ${JSON.stringify(VALID_ROOMS)}
- "title": { "es": "<Spanish title>", "en": "<English title>" }

Rules:
- Maximum 5 tasks.
- Tasks must be logical steps toward the goal.
- Choose types and rooms that make sense for the goal.
- Titles must be concise (≤ 60 chars each) and specific to the goal.
- Return ONLY the JSON array. No markdown code fences.`;

export async function generateClaudePlan(goal) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const response = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `Goal: ${goal}` },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Anthropic API error ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '';

  let tasks;
  try {
    tasks = JSON.parse(text);
  } catch {
    throw new Error('Claude returned invalid JSON');
  }

  if (!Array.isArray(tasks)) throw new Error('Claude did not return an array');

  // Sanitize: keep only valid types/rooms, max 5 tasks
  const sanitized = tasks
    .filter((t) => t && typeof t === 'object' && VALID_TYPES.includes(t.type) && VALID_ROOMS.includes(t.room))
    .slice(0, 5)
    .map((t) => ({
      type: t.type,
      room: t.room,
      title: {
        es: typeof t.title?.es === 'string' ? t.title.es.slice(0, 80) : t.type,
        en: typeof t.title?.en === 'string' ? t.title.en.slice(0, 80) : t.type,
      },
    }));

  if (sanitized.length === 0) throw new Error('No valid tasks in Claude response');
  return sanitized;
}
