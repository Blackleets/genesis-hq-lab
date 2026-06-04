// Thin language facade over the central Genesis store.
// The source of truth lives in src/state/genesisStore.ts.

import { actions, getState, useSelectedLanguage } from '@core/store/genesisStore';
import { tr, type Lang, type TKey } from '@core/i18n/translations';

export function getLanguage(): Lang {
  return getState().selectedLanguage;
}

export function setLanguage(next: Lang): void {
  actions.setSelectedLanguage(next);
}

export function useLanguage(): Lang {
  return useSelectedLanguage();
}

/** React hook that returns a translator bound to the current language. */
export function useT(): (key: TKey) => string {
  const lang = useLanguage();
  return (key: TKey) => tr(key, lang);
}

export type { Lang, TKey };
