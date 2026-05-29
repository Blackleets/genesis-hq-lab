// connectorClient — routes completed task output to configured external platforms.
// Errors are swallowed — connector failures never break Genesis HQ flow.

import type { ConnectorConfig } from '../state/genesisStore';
import type { Task } from '../types/task';
import type { Agent } from '../types/genesis';

interface PlatformPayload {
  platform: string;
  action: string;
  content: string;
  agent: string;
  agentDepartment: string;
  taskType: string;
  taskId: string;
  timestamp: string;
  source: 'genesis-hq';
}

function buildPayload(task: Task, agent: Agent, lang: 'es' | 'en'): PlatformPayload {
  const ACTION_MAP: Partial<Record<string, string>> = {
    campaign_launch:    'publish_campaign',
    content_creation:   'create_content',
    growth_analysis:    'log_metrics',
    ads_review:         'update_ads',
    deployment:         'create_deployment',
    bug_fix:            'create_issue',
    code_review:        'create_review',
    performance_review: 'log_performance',
    market_scan:        'send_signal',
    signal_generation:  'send_signal',
    memory_archive:     'save_document',
    decision_review:    'log_decision',
    risk_review:        'log_risk',
    hr_review:          'log_hr',
    sprint_planning:    'create_sprint',
  };
  return {
    platform: '',
    action: ACTION_MAP[task.type] ?? 'notify',
    content: task.output?.[lang] ?? task.title[lang],
    agent: agent.name,
    agentDepartment: agent.department,
    taskType: task.type,
    taskId: task.id,
    timestamp: new Date().toISOString(),
    source: 'genesis-hq',
  };
}

async function postWebhook(url: string, payload: object): Promise<boolean> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  return res.ok;
}

async function postSlack(webhookUrl: string, payload: PlatformPayload): Promise<boolean> {
  const emoji = payload.action === 'create_issue' ? '🐛' : '✅';
  const text = `${emoji} *${payload.agent}* · ${payload.taskType.replace(/_/g, ' ')}\n> ${payload.content}`;
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(8000),
  });
  return res.ok;
}

async function postGitHubIssue(
  token: string,
  owner: string,
  repo: string,
  payload: PlatformPayload,
): Promise<boolean> {
  if (!owner || !repo) return false;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: `[Genesis HQ] ${payload.taskType.replace(/_/g, ' ')}`,
      body: `**Agent:** ${payload.agent} (${payload.agentDepartment})\n**Task:** ${payload.taskType}\n\n${payload.content}`,
      labels: ['genesis-hq'],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  return res.status === 201;
}

/** Fire all connected connectors whose capabilities match the task type. */
export async function triggerConnectors(
  task: Task,
  agent: Agent,
  connectors: ConnectorConfig[],
  lang: 'es' | 'en' = 'en',
): Promise<void> {
  const basePayload = buildPayload(task, agent, lang);

  await Promise.allSettled(
    connectors
      .filter((c) =>
        c.status === 'connected' &&
        (c.capabilities.length === 0 || c.capabilities.includes(task.type))
      )
      .map(async (connector) => {
        const payload: PlatformPayload = { ...basePayload, platform: connector.platform };
        try {
          switch (connector.platform) {
            case 'slack':
              await postSlack(connector.config.webhookUrl ?? '', payload);
              break;
            case 'github':
              await postGitHubIssue(
                connector.config.token ?? '',
                connector.config.repoOwner ?? '',
                connector.config.repoName ?? '',
                payload,
              );
              break;
            default:
              // facebook, instagram, linkedin, twitter, tiktok, google_ads,
              // notion, sheets, make, webhook — all via webhook URL
              {
                const url = connector.config.webhookUrl ?? connector.config.url;
                if (url) await postWebhook(url, payload);
              }
              break;
          }
          // Note: syncCount update happens in IntegrationsView via actions.updateConnector
        } catch {
          // Silent — external failures don't affect Genesis HQ
        }
      }),
  );
}

/** Send a test payload to verify the connector is reachable. */
export async function testConnector(connector: ConnectorConfig): Promise<boolean> {
  const testPayload: PlatformPayload = {
    platform: connector.platform,
    action: 'test',
    content: 'Connection test from Genesis HQ — if you see this, the integration is working.',
    agent: 'Genesis Core',
    agentDepartment: 'System',
    taskType: 'system_check',
    taskId: 'test',
    timestamp: new Date().toISOString(),
    source: 'genesis-hq',
  };

  try {
    switch (connector.platform) {
      case 'slack':
        return await postSlack(connector.config.webhookUrl ?? '', testPayload);
      case 'github':
        return await postGitHubIssue(
          connector.config.token ?? '',
          connector.config.repoOwner ?? '',
          connector.config.repoName ?? '',
          testPayload,
        );
      default: {
        const url = connector.config.webhookUrl ?? connector.config.url;
        if (!url) return false;
        return await postWebhook(url, testPayload);
      }
    }
  } catch {
    return false;
  }
}
