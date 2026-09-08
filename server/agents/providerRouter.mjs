// providerRouter.mjs — native-fetch LLM routing for Genesis agents.
// No SDK dependencies. Provider availability is driven only by real credentials.

export const PROVIDERS = /** @type {const} */ (['claude', 'openai', 'nvidia', 'gemini', 'groq', 'custom']);

const DEFAULT_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url, options, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function openAiMessages(messages, systemPrompt) {
  return [{ role: 'system', content: systemPrompt }, ...messages];
}

async function callOpenAiCompatible({ provider, url, apiKey, model, messages, systemPrompt, maxTokens, timeoutMs }) {
  if (!apiKey) throw new Error(`${provider}: API key not configured`);
  const body = {
    model,
    max_tokens: maxTokens ?? 1024,
    messages: openAiMessages(messages, systemPrompt),
  };
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`${provider} ${res.status}: ${text}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${provider}: empty response body`);
  return {
    content,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    model: data.model ?? model,
    provider,
  };
}

async function callClaude(messages, systemPrompt, config) {
  const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const body = {
    model: config.modelId ?? 'claude-haiku-4-5-20251001',
    max_tokens: config.maxTokens ?? 1024,
    system: systemPrompt,
    messages,
  };
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
  }, config.timeoutMs);
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

async function callOpenAI(messages, systemPrompt, config) {
  return callOpenAiCompatible({
    provider: 'openai',
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
    model: config.modelId ?? process.env.OPENAI_MODEL ?? 'gpt-5',
    messages,
    systemPrompt,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
  });
}

async function callNvidia(messages, systemPrompt, config) {
  return callOpenAiCompatible({
    provider: 'nvidia',
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
    apiKey: config.apiKey ?? process.env.NVIDIA_API_KEY,
    model: config.modelId ?? process.env.NVIDIA_MODEL ?? 'meta/llama-3.3-70b-instruct',
    messages,
    systemPrompt,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
  });
}

async function callGemini(messages, systemPrompt, config) {
  const apiKey = config.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
  const modelId = config.modelId ?? 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { maxOutputTokens: config.maxTokens ?? 1024 },
  };
  const res = await fetchWithTimeout(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, config.timeoutMs);
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`Gemini ${res.status}: ${text}`);
  }
  const data = await res.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('Gemini: empty response body');
  return {
    content,
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    model: modelId,
    provider: 'gemini',
  };
}

async function callGroq(messages, systemPrompt, config) {
  return callOpenAiCompatible({
    provider: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    apiKey: config.apiKey ?? process.env.GROQ_API_KEY,
    model: config.modelId ?? 'llama-3.3-70b-versatile',
    messages,
    systemPrompt,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
  });
}

async function callCustom(messages, systemPrompt, config) {
  const baseUrl = (config.baseUrl ?? process.env.CUSTOM_API_URL ?? '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('Custom provider: baseUrl not configured (set CUSTOM_API_URL)');
  return callOpenAiCompatible({
    provider: 'custom',
    url: `${baseUrl}/chat/completions`,
    apiKey: config.apiKey ?? process.env.CUSTOM_API_KEY ?? 'no-key',
    model: config.modelId ?? process.env.CUSTOM_MODEL ?? 'default',
    messages,
    systemPrompt,
    maxTokens: config.maxTokens,
    timeoutMs: config.timeoutMs,
  });
}

export async function routeToProvider(messages, systemPrompt, config) {
  switch (config.provider) {
    case 'claude': return callClaude(messages, systemPrompt, config);
    case 'openai': return callOpenAI(messages, systemPrompt, config);
    case 'nvidia': return callNvidia(messages, systemPrompt, config);
    case 'gemini': return callGemini(messages, systemPrompt, config);
    case 'groq': return callGroq(messages, systemPrompt, config);
    case 'custom': return callCustom(messages, systemPrompt, config);
    default: throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export function isProviderConfigured(provider) {
  switch (provider) {
    case 'claude': return Boolean(process.env.ANTHROPIC_API_KEY);
    case 'openai': return Boolean(process.env.OPENAI_API_KEY);
    case 'nvidia': return Boolean(process.env.NVIDIA_API_KEY);
    case 'gemini': return Boolean(process.env.GEMINI_API_KEY);
    case 'groq': return Boolean(process.env.GROQ_API_KEY);
    case 'custom': return Boolean(process.env.CUSTOM_API_URL);
    default: return false;
  }
}

export function getProviderStatus() {
  return {
    claude: { configured: isProviderConfigured('claude'), defaultModel: 'claude-haiku-4-5-20251001' },
    openai: { configured: isProviderConfigured('openai'), defaultModel: process.env.OPENAI_MODEL ?? 'gpt-5' },
    nvidia: { configured: isProviderConfigured('nvidia'), defaultModel: process.env.NVIDIA_MODEL ?? 'meta/llama-3.3-70b-instruct' },
    gemini: { configured: isProviderConfigured('gemini'), defaultModel: 'gemini-1.5-flash' },
    groq: { configured: isProviderConfigured('groq'), defaultModel: 'llama-3.3-70b-versatile' },
    custom: { configured: isProviderConfigured('custom'), defaultModel: process.env.CUSTOM_MODEL ?? 'default' },
  };
}
