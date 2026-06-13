// bootReset — MUST be imported before any module that reads localStorage
// (the store hydrates at import time). Provides a no-DevTools escape hatch:
// visiting `?reset=1` (or `#reset`) wipes persisted local state so a corrupt
// or incompatible saved session can never trap the user on a blank screen.
try {
  const hasReset =
    new URLSearchParams(window.location.search).has('reset') ||
    window.location.hash.includes('reset');
  if (hasReset) {
    window.localStorage.clear();
    // Drop the param so a later refresh doesn't wipe again.
    window.history.replaceState({}, '', window.location.pathname);
    // eslint-disable-next-line no-console
    console.warn('[bootReset] Local state cleared via ?reset');
  }
} catch {
  /* SSR / storage disabled — ignore */
}
