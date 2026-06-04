// Helpers for displaying agent fields in i18n-aware UI.

import type { Lang } from '@core/i18n/translations';
import type { Agent } from '@core/types/genesis';

export function pickRole(role: Agent['role'], lang: Lang): string {
  if (!role) return '';
  if (typeof role === 'string') return role;
  return role[lang];
}
