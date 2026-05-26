// Helpers for displaying agent fields in i18n-aware UI.

import type { Lang } from '../i18n/translations';
import type { Agent } from '../types/genesis';

export function pickRole(role: Agent['role'], lang: Lang): string {
  if (!role) return '';
  if (typeof role === 'string') return role;
  return role[lang];
}
