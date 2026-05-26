// Small language store: external state + useSyncExternalStore hook.
// Persists choice to localStorage. Default = 'es'.

import { useSyncExternalStore } from 'react';
import { tr, type Lang, type TKey } from './translations';

const STORAGE_KEY = 'genesis.hq.lang';

function readInitial(): Lang {
  if (typeof window === 'undefined') return 'es';
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'en' ? 'en' : 'es';
}

let current: Lang = readInitial();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

export function getLanguage(): Lang {
  return current;
}

export function setLanguage(next: Lang): void {
  if (next === current) return;
  current = next;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, next);
  }
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Lang {
  return current;
}

export function useLanguage(): Lang {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** React hook that returns a translator bound to the current language. */
export function useT(): (key: TKey) => string {
  const lang = useLanguage();
  return (key: TKey) => tr(key, lang);
}

export type { Lang, TKey };
