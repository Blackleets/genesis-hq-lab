// providerRouter.mjs — routes LLM requests to the right provider using native fetch.
// No SDK dependencies. Supports Claude, OpenAI, Gemini, and any OpenAI-compatible custom endpoint.
// States driven by actual HTTP execution — no timers, no simulation.

export const PROVIDERS = /** @type {const} */ (['claude', 'openai', 'gemini', 'groq', 'custom']);

/**
 * @typedef {Object} ProviderConfig
 * @property {'claude'|'openai'|'gemini'|'custom'} provider
 * @property {string} modelId
 * @property {string} [apiKey]         - overrides env var if provided
 * @property {string} [baseUrl]        - for custom provider only
 * @property {number} [maxTokens]
 * @property {number} [timeoutMs]
 */

/**
 * @typedef {Object} Message
 * @property {'user'|'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {Object} ProviderResult
 * @property {string} content
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {string} model
 * @property {string} provider
 */

const DEFAULT_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url, options, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// ─── Claude (Anthropic) ───────────────────────────────────────────────────────

async function callClaude(messages, systemPrompt, config) {
  const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const body = {
    model: config.modelId ?? 'claude-haiku-4-5-20251001',
    max_tokens: config.maxTokens ?? 1024,
    system: systemPrompt,
    messages,
  };

  const res = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    },
    config.timeoutMs,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Anthropic ${res.status}: ${text}`);
  }

  const data = await res.json();
  if (!data.content?.[0]?.text) throw new Error('Anthropic: empty response body');

  return {
    content: data.content[0].text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    model: data.model ?? body.model,
    provider: 'claude',
  };
}

// ─── OpenAI ───────────────────────────────────────────────────────────────────

async function callOpenAI(messages, systemPrompt, config) {
  const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const body = {
    model: config.modelId ?? 'gpt-4o-mini',
    max_tokens: config.maxTokens ?? 1024,
    messages: allMessages,
  };

  const res = await fetchWithTimeout(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    config.timeoutMs,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`OpenAI ${res.status}: ${text}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  if (!choice?.message?.content) throw new Error('OpenAI: empty response body');

  return {
    content: choice.message.content,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    model: data.model ?? body.model,
    provider: 'openai',
  };
}

// ─── Google Gemini ────────────────────────────────────────────────────────────

async function callGemini(messages, systemPrompt, config) {
  const apiKey = config.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const modelId = config.modelId ?? 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { maxOutputTokens: config.maxTokens ?? 1024 },
  };

  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    config.timeoutMs,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Gemini ${res.status}: ${text}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts?.[0]?.text) throw new Error('Gemini: empty response body');

  return {
    content: candidate.content.parts[0].text,
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    model: modelId,
    provider: 'gemini',
  };
}

// ─── Groq (OpenAI-compatible, free tier) ─────────────────────────────────────

async function callGroq(messages, systemPrompt, config) {
  const apiKey = config.apiKey ?? process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const body = {
    model: config.modelId ?? 'llama-3.3-70b-versatile',
    max_tokens: config.maxTokens ?? 1024,
    messages: allMessages,
  };

  const res = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    config.timeoutMs,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Groq ${res.status}: ${text}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  if (!choice?.message?.content) throw new Error('Groq: empty response body');

  return {
    content: choice.message.content,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    model: data.model ?? body.model,
    provider: 'groq',
  };
}

// ─── Custom (OpenAI-compatible endpoint) ─────────────────────────────────────

async function callCustom(messages, systemPrompt, config) {
  const apiKey = config.apiKey ?? process.env.CUSTOM_API_KEY;
  const baseUrl = (config.baseUrl ?? process.env.CUSTOM_API_URL ?? '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('Custom provider: baseUrl not configured (set CUSTOM_API_URL)');

  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const body = {
    model: config.modelId ?? 'default',
    max_tokens: config.maxTokens ?? 1024,
    messages: allMessages,
  };

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const res = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    { method: 'POST', headers, body: JSON.stringify(body) },
    config.timeoutMs,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Custom API ${res.status}: ${text}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  if (!choice?.message?.content) throw new Error('Custom API: empty response body');

  return {
    content: choice.message.content,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    model: data.model ?? config.modelId ?? 'custom',
    provider: 'custom',
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Route a completion request to the correct provider.
 * @param {Message[]} messages
 * @param {string} systemPrompt
 * @param {ProviderConfig} config
 * @returns {Promise<ProviderResult>}
 */
export async function routeToProvider(messages, systemPrompt, config) {
  switch (config.provider) {
    case 'claude':  return callClaude(messages, systemPrompt, config);
    case 'openai':  return callOpenAI(messages, systemPrompt, config);
    case 'gemini':  return callGemini(messages, systemPrompt, config);
    case 'groq':    return callGroq(messages, systemPrompt, config);
    case 'custom':  return callCustom(messages, systemPrompt, config);
    default: throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/** Returns true if the required API key/URL for the provider is present. */
export function isProviderConfigured(provider) {
  switch (provider) {
    case 'claude':  return Boolean(process.env.ANTHROPIC_API_KEY);
    case 'openai':  return Boolean(process.env.OPENAI_API_KEY);
    case 'gemini':  return Boolean(process.env.GEMINI_API_KEY);
    case 'groq':    return Boolean(process.env.GROQ_API_KEY);
    case 'custom':  return Boolean(process.env.CUSTOM_API_URL);
    default: return false;
  }
}

/** Returns the configured status of all providers. */
export function getProviderStatus() {
  return {
    claude:  { configured: isProviderConfigured('claude'),  defaultModel: 'claude-haiku-4-5-20251001' },
    openai:  { configured: isProviderConfigured('openai'),  defaultModel: 'gpt-4o-mini' },
    gemini:  { configured: isProviderConfigured('gemini'),  defaultModel: 'gemini-1.5-flash' },
    groq:    { configured: isProviderConfigured('groq'),    defaultModel: 'llama-3.3-70b-versatile' },
    custom:  { configured: isProviderConfigured('custom'),  defaultModel: process.env.CUSTOM_MODEL ?? 'default' },
  };
}
