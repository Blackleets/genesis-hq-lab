import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeMissionForProvider } from './missionBuilder.mjs';

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

export async function runFoundrySupervisorMission(mission) {
  const target = resolveFoundryTarget();
  if (!target) {
    return {
      ok: false,
      providerStatus: 'unavailable',
      error: 'Foundry source not configured or vendored source missing',
      source: 'foundry',
    };
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
    return {
      ok: false,
      providerStatus: 'failed',
      error: error instanceof Error ? error.message : String(error),
      source: 'foundry',
    };
  }
}
