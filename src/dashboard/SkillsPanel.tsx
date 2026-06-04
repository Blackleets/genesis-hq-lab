// SkillsPanel — deployed agent skills (SkillOpt) from /api/agent/skills.
// Shows each agent's live skill version + metrics. Includes Run SkillOpt trigger.

import { useEffect, useRef, useState } from 'react';
import { useAgentData } from '@agents/hooks/useAgentData';
import { useLanguage } from '@core/i18n/languageStore';
import type { SkillVersion } from '@services/agentClient';

// Enrich the type with fields added by C2
interface EnrichedSkill extends SkillVersion {
  trajectory_count?: number;
  skillopt_ready?: boolean;
}

interface JobStatus {
  running: boolean;
  agent: string | null;
  startedAt: string | null;
  lastResult: { deployed: boolean; reason: string; completedAt: string } | null;
}

const AGENT_LABEL: Record<string, string> = {
  polymarket_agent: 'Polymarket',
  kalshi_agent:     'Kalshi',
  risk_agent:       'Risk',
  marketing_agent:  'Marketing',
  research_agent:   'Research',
  'market-scanner': 'Market Scanner',
  'risk-guardian':  'Risk Guardian',
};

const API = (import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE ?? '';

export default function SkillsPanel() {
  const lang = useLanguage();
  const { skills: rawSkills, online } = useAgentData();
  const skills = rawSkills as EnrichedSkill[];
  const [job, setJob] = useState<JobStatus>({ running: false, agent: null, startedAt: null, lastResult: null });
  const [triggering, setTriggering] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll job status while running
  useEffect(() => {
    if (!job.running) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/skillopt/status`);
        if (!res.ok) return;
        const data = await res.json() as JobStatus & { ok: boolean };
        setJob(prev => ({ ...prev, running: data.running, lastResult: data.lastResult }));
        if (!data.running && pollRef.current) clearInterval(pollRef.current);
      } catch { /* ignore */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [job.running]);

  const runSkillOpt = async () => {
    setTriggering(true);
    try {
      const res = await fetch(`${API}/api/skillopt/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: 'market-scanner' }),
      });
      const data = await res.json();
      if (data.ok) {
        setJob({ running: true, agent: data.agent, startedAt: data.startedAt, lastResult: null });
      }
    } catch { /* ignore */ }
    setTriggering(false);
  };

  if (!online || skills.length === 0) return null;

  const anyReady = skills.some(s => s.skillopt_ready);
  const totalTrajectories = skills[0]?.trajectory_count ?? 0;

  return (
    <div className="gx-card">
      <div className="px-4 py-2 border-b border-trim flex items-center justify-between gap-2">
        <span className="gx-overline">
          {lang === 'es' ? 'Skills · SkillOpt' : 'Skills · SkillOpt'}
        </span>
        <div className="flex items-center gap-2">
          {totalTrajectories > 0 && (
            <span className="font-mono text-[8px] text-zinc-600">
              {totalTrajectories} {lang === 'es' ? 'trades' : 'trades'}
            </span>
          )}
          {job.running ? (
            <span className="font-mono text-[8px] text-amber-400 animate-pulse">
              {lang === 'es' ? 'optimizando...' : 'optimizing...'}
            </span>
          ) : (
            <button
              type="button"
              onClick={runSkillOpt}
              disabled={triggering || !anyReady}
              className="font-mono text-[8px] px-2 py-0.5 border border-trim text-zinc-400 hover:text-emerald-400 hover:border-emerald-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={!anyReady ? (lang === 'es' ? 'Necesita 50+ trades resueltos' : 'Needs 50+ resolved trades') : 'Run SkillOpt'}
            >
              {lang === 'es' ? 'Optimizar' : 'Optimize'}
            </button>
          )}
        </div>
      </div>

      {/* Last result banner */}
      {job.lastResult && (
        <div className={`px-4 py-1.5 text-[8px] font-mono border-b border-trim ${job.lastResult.deployed ? 'text-emerald-400' : 'text-zinc-500'}`}>
          {job.lastResult.deployed
            ? (lang === 'es' ? '✓ Skill desplegado' : '✓ Skill deployed')
            : `${lang === 'es' ? 'Saltado' : 'Skipped'}: ${job.lastResult.reason}`
          }
        </div>
      )}

      <ul className="divide-y divide-trim">
        {skills.map((s) => (
          <li key={s.agent} className="px-4 py-2.5 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[11px] text-zinc-200">
                {AGENT_LABEL[s.agent] ?? s.agent}
              </div>
              <div className="font-mono text-[8px] text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
                <span>v{s.version} · {s.status}</span>
                {s.skillopt_ready ? (
                  <span className="text-emerald-600">● ready</span>
                ) : s.trajectory_count != null ? (
                  <span className="text-zinc-700">{s.trajectory_count}/50</span>
                ) : null}
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-3 font-mono text-[9px]">
              {s.brier != null ? (
                <span className="text-zinc-500">Brier <span className="text-zinc-300">{s.brier.toFixed(2)}</span></span>
              ) : (
                <span className="text-zinc-700">{lang === 'es' ? 'sin métricas' : 'no metrics'}</span>
              )}
              {s.win_rate != null && (
                <span className="text-zinc-500">WR <span className="text-emerald-400">{(s.win_rate * 100).toFixed(0)}%</span></span>
              )}
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: s.status === 'deployed' ? '#00ff9c' : '#4a5568' }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
