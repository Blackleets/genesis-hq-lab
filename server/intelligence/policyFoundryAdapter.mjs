import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeMissionForProvider } from './missionBuilder.mjs';
import { routeToProvider, isProviderConfigured } from '../agents/providerRouter.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getTimeoutMs() {
  const parsed = parseInt(process.env.FRACTAL_FOUNDRY_TIMEOUT_MS ?? '30000', 10);
  return Number.isFinite(parsed) ? parsed : 30000;
}

function resolveFoundryTarget() {
  const configured = process.env.FRACTAL_FOUNDRY_PATH?.trim();
  const candidates = [
    configured,
    resolve(__dirname, 'foundry'),
    resolve(__dirname, 'foundry', 'fractal_prompt_foundry.py'),
    resolve(__dirname, '..', '..', 'vendor', 'fractal-prompt-foundry'),
    resolve(__dirname, '..', '..', 'vendor', 'fractal-prompt-foundry', 'fractal_prompt_foundry.py'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const absolute = resolve(candidate);
    if (!existsSync(absolute)) continue;
    const moduleDir = absolute.endsWith('.py') ? dirname(absolute) : absolute;
    return { absolute, moduleDir };
  }
  return null;
}

function getPythonCandidates() {
  const configured = process.env.PYTHON_BIN?.trim();
  if (configured) return [configured];
  return process.platform === 'win32'
    ? ['python', 'py']
    : ['python3', 'python'];
}

function runPythonFoundry(mission, target) {
  const providerMission = summarizeMissionForProvider(mission);
  const pythonScript = `
import json
import sys
from pathlib import Path

payload = json.loads(sys.stdin.read())
module_dir = Path(payload["module_dir"])
if str(module_dir) not in sys.path:
    sys.path.insert(0, str(module_dir))

from fractal_prompt_foundry import Mission, FractalPromptFoundry

mission_data = payload["mission"]
foundry_mission = Mission(
    name=mission_data["missionId"],
    goal=mission_data["goal"],
    constraints=mission_data["constraints"],
    success_criteria=mission_data["successCriteria"],
    deliverables=mission_data["deliverables"],
    domain_terms=mission_data["domainTerms"],
)
foundry = FractalPromptFoundry(foundry_mission, population_size=5)
result = foundry.run(rounds=3)
result["run_id"] = mission_data["missionId"]
result["source"] = "foundry"
print(json.dumps(result))
`.trim();

  return new Promise((resolvePromise, rejectPromise) => {
    const timeoutMs = getTimeoutMs();
    let child = null;
    let launchError = null;
    for (const pythonBin of getPythonCandidates()) {
      try {
        child = spawn(pythonBin, ['-c', pythonScript], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: process.env,
        });
        launchError = null;
        break;
      } catch (error) {
        launchError = error;
      }
    }
    if (!child) {
      rejectPromise(launchError instanceof Error ? launchError : new Error('No Python runtime available for Foundry'));
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectPromise(new Error(`Foundry adapter timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      rejectPromise(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (code !== 0) {
        rejectPromise(new Error(stderr.trim() || `Foundry process exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolvePromise(parsed);
      } catch (error) {
        rejectPromise(new Error(`Invalid Foundry JSON output: ${error instanceof Error ? error.message : String(error)}`));
      }
    });

    child.stdin.write(JSON.stringify({
      module_dir: target.moduleDir,
      mission: providerMission,
    }));
    child.stdin.end();
  });
}

// ── LLM fallback — used when Python Foundry is unavailable (e.g. Render) ──
// Priority: Groq (free, fast) → Gemini (free) → Claude (paid)

async function runLlmSupervisorMission(mission) {
  const useGroq   = isProviderConfigured('groq');
  const useGemini = isProviderConfigured('gemini');
  const useClaude = isProviderConfigured('claude');

  if (!useGroq && !useGemini && !useClaude) {
    return {
      ok: false,
      providerStatus: 'unavailable',
      error: 'No LLM API key configured (set GROQ_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY)',
      source: 'none',
    };
  }

  // Priority: Groq (free, fast) → Gemini (free) → Claude (paid)
  const provider  = useGroq ? 'groq' : useGemini ? 'gemini' : 'claude';
  const modelId   = useGroq ? 'llama-3.3-70b-versatile' : useGemini ? 'gemini-2.0-flash' : 'claude-haiku-4-5-20251001';
  const summary   = summarizeMissionForProvider(mission);

  const systemPrompt = `You are the intelligence supervisor for a crypto futures paper-trading desk.
Analyze the performance data and produce a concise advisory in JSON.
Rules: paper-only, advisory-only, never suggest turning off risk gates, never invent metrics.
Respond ONLY with valid JSON — no markdown, no prose outside JSON.`;

  const userMsg = `Futures desk data:
${JSON.stringify(summary.context, null, 2)}

Respond with JSON matching this schema exactly:
{
  "best_candidate": {
    "candidate_id": "llm-advisory",
    "prompt": "<1-3 sentence advisory for the desk operator>",
    "style": "${provider}-advisory"
  },
  "best_evaluation": {
    "total_score": <0.0-1.0 based on data quality and edge clarity>,
    "critique": ["<observation 1>", "<observation 2>"],
    "result_summary": "<one sentence summary>"
  },
  "justification": "<why these recommendations>",
  "source": "${provider}"
}`;

  try {
    const llmResult = await routeToProvider(
      [{ role: 'user', content: userMsg }],
      systemPrompt,
      { provider, modelId, maxTokens: 600, timeoutMs: 30000 },
    );
    const result = JSON.parse(llmResult.content);
    return { ok: true, providerStatus: 'ok', source: provider, result };
  } catch (err) {
    // Cascade through remaining providers on failure
    const fallbackChain = [
      useGroq   && provider !== 'groq'   && { provider: 'groq',   modelId: 'llama-3.3-70b-versatile' },
      useGemini && provider !== 'gemini' && { provider: 'gemini', modelId: 'gemini-2.0-flash' },
      useClaude && provider !== 'claude' && { provider: 'claude', modelId: 'claude-haiku-4-5-20251001' },
    ].filter(Boolean);

    for (const fb of fallbackChain) {
      try {
        const fallback = await routeToProvider(
          [{ role: 'user', content: userMsg }],
          systemPrompt,
          { provider: fb.provider, modelId: fb.modelId, maxTokens: 600, timeoutMs: 30000 },
        );
        const result = JSON.parse(fallback.content);
        return { ok: true, providerStatus: 'ok', source: fb.provider, result };
      } catch { /* try next */ }
    }

    return {
      ok: false,
      providerStatus: 'failed',
      error: err instanceof Error ? err.message : String(err),
      source: provider,
    };
  }
}

export async function runFoundrySupervisorMission(mission) {
  const target = resolveFoundryTarget();
  if (!target) {
    // Python Foundry not available — fall back to LLM (Gemini preferred, then Claude)
    return runLlmSupervisorMission(mission);
  }

  try {
    const result = await runPythonFoundry(mission, target);
    return {
      ok: true,
      providerStatus: 'ok',
      source: 'foundry',
      result,
    };
  } catch (error) {
    // Python ran but failed — fall back to LLM
    console.warn('[policyFoundryAdapter] Python Foundry failed, trying LLM fallback:', error?.message);
    return runLlmSupervisorMission(mission);
  }
}
