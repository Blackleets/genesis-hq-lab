// tradingAgentUtils — pure helpers for TradingAgent tier calculation and scoring.
// No I/O, no store access, safe to use in tests and SSR contexts.

import type { TradingPerformanceMetrics, TradingTier } from '@core/types/tradingAgent';

// ── Composite performance score (0–100) ──────────────────────────────────────

export function tradingPerformanceScore(m: TradingPerformanceMetrics): number {
  const winPart    = m.winRate * 30;                              // 0..30
  const pfPart     = Math.min(m.profitFactor, 3) / 3 * 25;       // 0..25
  const taskPart   = Math.min(m.completedTasks, 100) / 100 * 15; // 0..15
  const signalPart = Math.min(m.successfulSignals, 50) / 50 * 15; // 0..15
  const learnPart  = m.learningScore * 10;                        // 0..10
  const uptimePart = m.uptime * 5;                                // 0..5
  return Math.round(Math.max(0, winPart + pfPart + taskPart + signalPart + learnPart + uptimePart));
}

// ── Tier derivation ───────────────────────────────────────────────────────────

export function tierFromMetrics(m: TradingPerformanceMetrics): TradingTier {
  const score = tradingPerformanceScore(m);
  if (score >= 70) return 'elite';
  if (score >= 35) return 'professional';
  return 'rookie';
}

// ── Level derivation (1..60) ─────────────────────────────────────────────────

export function levelFromMetrics(m: TradingPerformanceMetrics): number {
  const base       = tradingPerformanceScore(m) * 0.5;
  const taskBonus  = Math.min(m.completedTasks * 0.05, 10);
  return Math.max(1, Math.min(60, Math.floor(base + taskBonus)));
}

// ── Display maps ──────────────────────────────────────────────────────────────

export const TIER_LABELS: Record<TradingTier, { es: string; en: string }> = {
  rookie:       { es: 'Novato',      en: 'Rookie'       },
  professional: { es: 'Profesional', en: 'Professional' },
  elite:        { es: 'Élite',       en: 'Elite'        },
};

export const TIER_COLORS: Record<TradingTier, string> = {
  rookie:       '#9ca3af',
  professional: '#3da9fc',
  elite:        '#ffd24a',
};

export const STATUS_COLORS: Record<string, string> = {
  active:  '#00ff9c',
  idle:    '#3da9fc',
  paused:  '#ffd24a',
  error:   '#ff4757',
  offline: '#6b7280',
};
