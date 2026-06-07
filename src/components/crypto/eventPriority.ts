// eventPriority.ts — operator event priority system.
// Shared by LiveActivityStrip (display lock) and TradeNotifier (which events toast).
//
// RULE: HIGH/CRITICAL events must remain visible 5–8s minimum; a LOW event cannot
// instantly replace them.

import type { CommentaryItem } from '@services/cryptoClient';

export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export const PRIORITY_RANK: Record<Priority, number> = {
  CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0,
};

// How long a HIGH/CRITICAL event holds the activity strip (ms).
export const HOLD_MS: Record<Priority, number> = {
  CRITICAL: 8000, HIGH: 6000, MEDIUM: 2500, LOW: 0,
};

// Commentary type → priority.
const TYPE_PRIORITY: Record<string, Priority> = {
  SAFE_MODE:       'CRITICAL',
  TRADE_OPENED:    'HIGH',
  TP_HIT:          'HIGH',
  SL_HIT:          'HIGH',
  EARLY_EXIT:      'HIGH',
  SIGNAL_FOUND:    'MEDIUM',
  TRADE_REJECTED:  'MEDIUM',
  LEARNING_UPDATE: 'MEDIUM',
  DESK_SUMMARY:    'MEDIUM',
  ANALYZING:       'LOW',
  SCANNING:        'LOW',
};

export function priorityOf(item: Pick<CommentaryItem, 'type' | 'severity'>): Priority {
  // Severity escalates to CRITICAL regardless of type (engine/execution failure).
  if (item.severity === 'CRITICAL') return 'CRITICAL';
  return TYPE_PRIORITY[item.type] ?? 'LOW';
}

// Priority → accent color for the strip dot / notification edge.
export const PRIORITY_COLOR: Record<Priority, string> = {
  CRITICAL: '#ef4444', HIGH: '#22c55e', MEDIUM: '#f59e0b', LOW: '#6b7280',
};

// Lifecycle types that deserve a toast notification (anti-spam: never LOW).
export const NOTIFY_TYPES = new Set([
  'TRADE_OPENED', 'TP_HIT', 'SL_HIT', 'EARLY_EXIT', 'SAFE_MODE',
]);
