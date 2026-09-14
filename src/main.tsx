import './bootReset'; // MUST be first — clears corrupt local state via ?reset before the store hydrates
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { apiUrl } from '@services/apiBase';
import { ErrorBoundary } from '@ui/ErrorBoundary';
import './index.css';
import App from './App.tsx';
import WalletAuthProvider from '@core/auth/WalletAuthProvider';

// Keep Render backend awake — ping every 4 min from the browser
// This fires as long as any user has the tab open
const _backendPing = () => fetch(apiUrl('/api/health'), { signal: AbortSignal.timeout(8000) }).catch(() => {});
_backendPing();
setInterval(_backendPing, 4 * 60 * 1000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <WalletAuthProvider><App /></WalletAuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);
