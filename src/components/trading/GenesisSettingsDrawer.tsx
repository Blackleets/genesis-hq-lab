import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, LoaderCircle, LockKeyhole, Settings, X } from 'lucide-react';
import { useWalletAuth } from '@core/auth/WalletAuthProvider';
import './genesisSettings.css';

type SettingsSection = 'general' | 'telegram' | 'solana' | 'execution' | 'notifications';
type NotificationKey = 'important' | 'opportunities' | 'executions' | 'dailySummary' | 'debug';
type SolanaWalletBrowser = 'phantom' | 'solflare';

interface TelegramStatus {
  configured: boolean;
  connected: boolean;
  verifiedAt: string | null;
  chatIdMasked: string | null;
  notifications: Record<NotificationKey, boolean>;
}

const DEFAULT_NOTIFICATIONS: Record<NotificationKey, boolean> = {
  important: true,
  opportunities: true,
  executions: true,
  dailySummary: true,
  debug: false,
};

const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'general', label: 'GENERAL' },
  { id: 'telegram', label: 'TELEGRAM' },
  { id: 'solana', label: 'SOLANA' },
  { id: 'execution', label: 'EXECUTION' },
  { id: 'notifications', label: 'NOTIFICATIONS' },
];

const TELEGRAM_API = '/api/genesis/founder?view=telegram';
const GENESIS_PRODUCTION_URL = 'https://genesis-hq-lab.vercel.app';

function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isAndroidChrome(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Android/i.test(ua)
    && /Chrome\/[\d.]+/i.test(ua)
    && !/(EdgA|OPR|Opera|SamsungBrowser|Firefox|FxiOS)/i.test(ua);
}

function isIOSBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function hasInjectedSolanaWallet(): boolean {
  if (typeof window === 'undefined') return false;
  const candidate = window as Window & {
    phantom?: { solana?: unknown };
    solflare?: unknown;
    solana?: unknown;
  };
  return Boolean(candidate.phantom?.solana || candidate.solflare || candidate.solana);
}

function openSolanaWalletBrowser(wallet: SolanaWalletBrowser) {
  if (typeof window === 'undefined') return;
  const target = encodeURIComponent(GENESIS_PRODUCTION_URL);
  const ref = encodeURIComponent(window.location.origin);
  const deepLink = wallet === 'phantom'
    ? `https://phantom.app/ul/browse/${target}?ref=${ref}`
    : `https://solflare.com/ul/v1/browse/${target}?ref=${ref}`;
  window.location.assign(deepLink);
}

export function GenesisSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const auth = useWalletAuth();
  const [section, setSection] = useState<SettingsSection>('general');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [notifications, setNotifications] = useState(DEFAULT_NOTIFICATIONS);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'saving' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const closeDrawer = useCallback(() => { setBotToken(''); setChatId(''); setMessage(''); onClose(); }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeDrawer(); };
    window.addEventListener('keydown', onKey);
    if (!auth.session) return () => window.removeEventListener('keydown', onKey);
    fetch(TELEGRAM_API, { cache: 'no-store', credentials: 'same-origin' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(response.status === 401 ? 'La sesión Solana del propietario expiró. Vuelve a autenticarte en GENERAL.' : (body.message || 'No se pudo leer la configuración.'));
        setStatus(body.telegram);
        setNotifications({ ...DEFAULT_NOTIFICATIONS, ...body.telegram?.notifications });
        setPhase('idle');
      })
      .catch((error: Error) => { setMessage(error.message); setPhase('error'); });
    return () => window.removeEventListener('keydown', onKey);
  }, [open, auth.session, closeDrawer]);

  if (!open) return null;

  const saveAndTest = async () => {
    setPhase('saving'); setMessage('');
    try {
      const response = await fetch(TELEGRAM_API, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ botToken, chatId, notifications }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Telegram no pudo conectarse.');
      setStatus(body.telegram); setBotToken(''); setChatId(''); setPhase('success');
      setMessage('Mensaje de prueba enviado. Telegram quedó conectado.');
    } catch (error) {
      setPhase('error'); setMessage(error instanceof Error ? error.message : 'Telegram no pudo conectarse.');
    }
  };

  const toggle = (key: NotificationKey) => setNotifications((current) => ({ ...current, [key]: !current[key] }));
  const authBusy = auth.status === 'connecting' || auth.status === 'signing' || auth.status === 'verifying';
  const injectedWallet = hasInjectedSolanaWallet();
  const androidChromeExternal = isAndroidChrome() && !injectedWallet;
  const iosExternal = isIOSBrowser() && !injectedWallet;
  const unsupportedMobileExternal = isMobileBrowser() && !injectedWallet && !androidChromeExternal && !iosExternal;
  const needsWalletBrowserFallback = iosExternal || unsupportedMobileExternal;
  const ownerLabel = auth.session
    ? `SOLANA OWNER SESSION ACTIVE · ${auth.session.address.slice(0, 6)}…${auth.session.address.slice(-4)}`
    : 'SOLANA OWNER SESSION REQUIRED';
  const ownerActionLabel = auth.status === 'awaiting_signature'
    ? 'SIGN OWNER ACCESS'
    : androidChromeExternal
      ? 'CONNECT INSTALLED SOLANA WALLET'
      : 'AUTHENTICATE SOLANA WALLET';

  return (
    <div className="genesis-settings" role="dialog" aria-modal="true" aria-label="Genesis settings">
      <button type="button" className="genesis-settings__backdrop" onClick={closeDrawer} aria-label="Close settings" />
      <aside className="genesis-settings__panel">
        <header><div><Settings size={16} /><span>SETTINGS</span></div><button type="button" onClick={closeDrawer} aria-label="Close settings"><X size={16} /></button></header>
        <nav aria-label="Settings sections">{SECTIONS.map((item) => <button key={item.id} type="button" className={section === item.id ? 'is-active' : ''} onClick={() => setSection(item.id)}>{item.label}</button>)}</nav>

        {section === 'general' ? <section className="genesis-settings__content">
          <div className="genesis-settings__title"><Settings size={16} /><div><strong>GENERAL</strong><span>Identidad Solana del propietario y estado operativo de Genesis HQ.</span></div></div>
          <div className={`genesis-settings__status ${auth.session ? 'is-connected' : ''}`}>
            {auth.session ? <Check size={14} /> : <LockKeyhole size={14} />}
            <span>{ownerLabel}</span>
          </div>
          {!auth.session ? <>
            <div className="genesis-settings__notice"><LockKeyhole size={12} />Genesis autentica al propietario con una firma Solana off-chain. No crea transacciones, no aprueba tokens y no mueve fondos.</div>

            {androidChromeExternal ? <>
              <div className="genesis-settings__notice"><LockKeyhole size={12} />Android Chrome detectado. Genesis usa Mobile Wallet Adapter: puedes quedarte en Chrome y elegir Phantom, Solflare u otra wallet compatible instalada.</div>
              {auth.status === 'awaiting_signature' ? <div className="genesis-settings__notice"><Check size={12} />Wallet conectada. Pulsa SIGN OWNER ACCESS para abrir la firma y volver automáticamente a Genesis.</div> : null}
              <button type="button" className="genesis-settings__save" onClick={() => void auth.connectAndSign()} disabled={authBusy}>{authBusy ? <LoaderCircle size={14} className="animate-spin" /> : <LockKeyhole size={14} />}{ownerActionLabel}</button>
            </> : needsWalletBrowserFallback ? <>
              <div className="genesis-settings__notice"><LockKeyhole size={12} />Este navegador móvil no soporta Mobile Wallet Adapter. Abre Genesis dentro de Phantom o Solflare para autenticar.</div>
              <button type="button" className="genesis-settings__save" onClick={() => openSolanaWalletBrowser('phantom')}>OPEN IN PHANTOM</button>
              <button type="button" className="genesis-settings__save" onClick={() => openSolanaWalletBrowser('solflare')}>OPEN IN SOLFLARE</button>
            </> : <button type="button" className="genesis-settings__save" onClick={() => void auth.connectAndSign()} disabled={authBusy}>{authBusy ? <LoaderCircle size={14} className="animate-spin" /> : <LockKeyhole size={14} />}{ownerActionLabel}</button>}

            {auth.error ? <p className="genesis-settings__message is-error">{auth.error}</p> : null}
          </> : null}
          <dl className="genesis-settings__facts"><div><dt>Futures</dt><dd>PAPER</dd></div><div><dt>Solana</dt><dd>SHADOW / PAPER</dd></div></dl>
        </section> : null}

        {section === 'telegram' ? <section className="genesis-settings__content">
          <div className="genesis-settings__title"><Bell size={16} /><div><strong>TELEGRAM</strong><span>Configura el bot y las notificaciones después de autenticar la wallet Solana del propietario.</span></div></div>
          <div className={`genesis-settings__status ${status?.connected ? 'is-connected' : ''}`}>
            {status?.connected ? <Check size={14} /> : <LockKeyhole size={14} />}
            <span>{status?.connected ? `TELEGRAM CONNECTED · ${status.chatIdMasked || ''}` : 'TELEGRAM NOT CONFIGURED'}</span>
          </div>
          {!auth.session ? <>
            <div className="genesis-settings__notice"><LockKeyhole size={12} />Telegram no se conecta a la wallet. La firma Solana solo protege los ajustes privados del propietario.</div>
            <button type="button" className="genesis-settings__save" onClick={() => setSection('general')}><LockKeyhole size={14} />OPEN SOLANA OWNER ACCESS</button>
          </> : null}
          <label><span>BOT TOKEN</span><input type="password" value={botToken} onChange={(event) => setBotToken(event.target.value)} autoComplete="new-password" placeholder={status?.configured ? 'Enter token again to replace' : '123456789:AA…'} disabled={!auth.session} /></label>
          <label><span>CHAT ID</span><input type="text" value={chatId} onChange={(event) => setChatId(event.target.value)} inputMode="text" placeholder={status?.chatIdMasked || '-100…'} disabled={!auth.session} /></label>
          <div className="genesis-settings__notice"><LockKeyhole size={12} />El token viaja solo al backend, se cifra antes de persistir y nunca vuelve al navegador.</div>
          <button type="button" className="genesis-settings__save" onClick={saveAndTest} disabled={!auth.session || phase === 'saving' || !botToken.trim() || !chatId.trim()}>{phase === 'saving' ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}SAVE & TEST TELEGRAM</button>
          {message ? <p className={`genesis-settings__message ${phase === 'error' ? 'is-error' : 'is-success'}`}>{message}</p> : null}
        </section> : null}

        {section === 'notifications' ? <section className="genesis-settings__content">
          <div className="genesis-settings__title"><Bell size={16} /><div><strong>NOTIFICATIONS</strong><span>Signal first. Scan noise stays hidden.</span></div></div>
          <div className="genesis-settings__toggles">
            {(Object.keys(notifications) as NotificationKey[]).map((key) => <button key={key} type="button" onClick={() => toggle(key)} aria-pressed={notifications[key]} disabled={!auth.session}><span>{key.replace(/([A-Z])/g, ' $1').toUpperCase()}</span><i className={notifications[key] ? 'is-on' : ''} /></button>)}
          </div>
          <p className="genesis-settings__hint">Los cambios se guardan junto con Telegram al pulsar SAVE & TEST TELEGRAM.</p>
        </section> : null}

        {section === 'solana' ? <section className="genesis-settings__content"><div className="genesis-settings__title"><Settings size={16} /><div><strong>SOLANA</strong><span>Economic qualification uses net edge after all modeled costs.</span></div></div><dl className="genesis-settings__facts"><div><dt>Route</dt><dd>USDC → SOL → USDC</dd></div><div><dt>Fresh quote gate</dt><dd>REQUIRED</dd></div><div><dt>Atomic simulation</dt><dd>REQUIRED</dd></div></dl></section> : null}
        {section === 'execution' ? <section className="genesis-settings__content"><div className="genesis-settings__title"><LockKeyhole size={16} /><div><strong>EXECUTION</strong><span>Deterministic gates own execution authority.</span></div></div><dl className="genesis-settings__facts"><div><dt>LIVE</dt><dd className="is-locked">LOCKED</dd></div><div><dt>Secrets in browser</dt><dd>NONE</dd></div><div><dt>Emergency stop</dt><dd>SERVER CONTROLLED</dd></div></dl></section> : null}
      </aside>
    </div>
  );
}
