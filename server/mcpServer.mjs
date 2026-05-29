#!/usr/bin/env node
/**
 * Genesis HQ — MCP Server
 *
 * Exposes Genesis HQ as an MCP server so Claude Desktop and other
 * Claude clients can control agents, create tasks, and read metrics.
 *
 * Usage:
 *   node server/mcpServer.mjs
 *
 * Claude Desktop config (~/.config/claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "genesis-hq": {
 *         "command": "node",
 *         "args": ["C:/Users/Usuario/genesis-hq-lab/server/mcpServer.mjs"]
 *       }
 *     }
 *   }
 *
 * Requires the Genesis HQ backend to be running:
 *   npm run server  (http://127.0.0.1:8787)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BACKEND = 'http://127.0.0.1:8787';

const VALID_TASK_TYPES = [
  'market_scan', 'risk_review', 'memory_archive', 'hr_review', 'agent_onboarding',
  'agent_training', 'office_upgrade', 'module_unlock_review', 'decision_review',
  'maintenance', 'language_update', 'system_check', 'paper_trade', 'signal_generation',
  'peer_training', 'performance_review', 'campaign_launch', 'content_creation',
  'growth_analysis', 'seo_audit', 'ads_review', 'sprint_planning', 'code_review',
  'qa_testing', 'deployment', 'bug_fix',
];

const VALID_ROOMS = [
  'market-desk', 'risk-bunker', 'memory-archive', 'hr-pod', 'board-room',
  'debate-room', 'strategy-lab', 'execution-desk', 'open-workspace',
];

const VALID_PRIORITIES = ['low', 'normal', 'high', 'critical'];

async function callBackend(path, options = {}) {
  const res = await fetch(`${BACKEND}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    signal: AbortSignal.timeout(8000),
  });
  return res.json();
}

const server = new McpServer({
  name: 'genesis-hq',
  version: '1.0.0',
});

// ---------- tools ----------

server.tool(
  'check_health',
  'Check if Genesis HQ backend is running and available.',
  {},
  async () => {
    try {
      const data = await callBackend('/api/health');
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ status: 'online', ...data }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ status: 'offline', error: String(err) }),
        }],
        isError: true,
      };
    }
  },
);

server.tool(
  'get_metrics',
  'Get Genesis HQ system metrics and available endpoints.',
  {},
  async () => {
    try {
      const data = await callBackend('/api/metrics');
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(data, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'get_polymarket_events',
  'Fetch live Polymarket prediction markets that Genesis agents are monitoring.',
  {
    limit: z.number().min(1).max(20).default(5).describe('Number of markets to return (1-20)'),
  },
  async ({ limit }) => {
    try {
      const data = await callBackend(`/api/polymarket/events?limit=${limit}`);
      if (!data.ok) throw new Error(data.message || 'Polymarket unavailable');
      const events = data.events ?? [];
      const summary = events.map((e) => ({
        title: e.title,
        slug: e.slug,
        volume24hr: e.volume24hr,
        markets: (e.markets ?? []).map((m) => ({
          question: m.question,
          yesPrice: m.outcomes?.find((o) => o.label === 'Yes')?.price,
          noPrice: m.outcomes?.find((o) => o.label === 'No')?.price,
        })),
      }));
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(summary, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'create_plan',
  'Generate a task plan using Claude AI and return the proposed tasks. Does NOT execute them.',
  {
    goal: z.string().min(3).max(400).describe('The goal or objective in natural language'),
  },
  async ({ goal }) => {
    try {
      const data = await callBackend('/api/plan', {
        method: 'POST',
        body: JSON.stringify({ goal }),
      });
      if (!data.ok) {
        return {
          content: [{
            type: 'text',
            text: `Plan generation failed: ${data.message}. Fallback: use create_task directly.`,
          }],
          isError: true,
        };
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            goal,
            tasks: data.tasks,
            note: 'To execute this plan, call create_task for each task in the list.',
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  'create_task',
  'Create a task in Genesis HQ. Agents will pick it up and execute it.',
  {
    title_es: z.string().min(3).max(80).describe('Task title in Spanish'),
    title_en: z.string().min(3).max(80).describe('Task title in English'),
    type: z.enum(VALID_TASK_TYPES).describe(`Task type. Valid: ${VALID_TASK_TYPES.join(', ')}`),
    room: z.enum(VALID_ROOMS).describe(`Room where the task happens. Valid: ${VALID_ROOMS.join(', ')}`),
    priority: z.enum(VALID_PRIORITIES).default('normal').describe('Task priority'),
  },
  async ({ title_es, title_en, type, room, priority }) => {
    // The backend doesn't have direct state write access (state is client-side).
    // We return the task spec so the user/Claude can invoke it via the Command Console.
    const taskSpec = {
      title: { es: title_es, en: title_en },
      type,
      room,
      priority,
      sourceModule: 'mcp',
      note: 'Copy this spec into Genesis HQ Command Console or use the frontend to create this task directly.',
    };
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          action: 'task_spec_ready',
          spec: taskSpec,
          instructions: 'Go to Genesis HQ → Consola → paste your goal to auto-create tasks, or use the Agent Factory to create agents that will execute this task type.',
        }, null, 2),
      }],
    };
  },
);

server.tool(
  'get_task_types',
  'List all valid task types and rooms in Genesis HQ.',
  {},
  async () => {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          taskTypes: VALID_TASK_TYPES,
          rooms: VALID_ROOMS,
          priorities: VALID_PRIORITIES,
        }, null, 2),
      }],
    };
  },
);

// ---------- resources ----------

server.resource(
  'genesis-hq://docs',
  'Genesis HQ documentation and usage guide',
  async () => ({
    contents: [{
      uri: 'genesis-hq://docs',
      mimeType: 'text/plain',
      text: `# Genesis HQ — MCP Integration Guide

## What is Genesis HQ?
Genesis HQ is a real-time AI agent management platform with:
- Paper trading on Polymarket prediction markets
- Multi-department AI agent workforce (Trading, Marketing, Tech, HR)
- Command Console for natural language task delegation
- Live office visualization

## Available Tools
- check_health: Verify backend is online (http://127.0.0.1:8787)
- get_metrics: System status and endpoints
- get_polymarket_events: Live prediction markets (limit 1-20)
- create_plan: AI-generated task plans (requires ANTHROPIC_API_KEY in .env)
- create_task: Task specification generator
- get_task_types: Full list of task types and rooms

## Quick Start
1. Start Genesis HQ: \`npm start\` (starts both server and frontend)
2. Open http://localhost:5173 in browser
3. Use this MCP server to inspect markets and generate plans
4. Paste plan details into the Command Console (Consola module) to execute

## Architecture
- Frontend: React + Vite on :5173
- Backend: Node.js on :8787 (REST API)
- State: Zustand (client-side, persisted to localStorage)
- MCP: This server bridges external Claude clients to Genesis HQ

## Note on State
Genesis HQ's agent state (tasks, positions, agents) lives in the browser.
This MCP server provides read/write via the REST API for market data and planning.
For full agent control, use the Genesis HQ web interface.
`,
    }],
  }),
);

// ---------- start ----------

const transport = new StdioServerTransport();
await server.connect(transport);
