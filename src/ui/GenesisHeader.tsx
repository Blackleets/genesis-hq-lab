// Top header bar for Genesis HQ.

import { useState, useRef, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { useAccount } from 'wagmi';
import { setLanguage, useLanguage, useT } from '@core/i18n/languageStore';
import { MODULE_BY_ID, type ModuleId } from '@core/data/moduleRegistry';
import { useEvents } from '@core/store/genesisStore';
import { useAgentData } from '@agents/hooks/useAgentData';

interface Props {
  currentModule: ModuleId;
}

function NotificationDrawer({ events, onClose }: {
  events: ReturnType<typeof useEvents>;
  onClose: () => void;
}) {
  const lang = useLanguage();
  const criticalEvents = [...events]
    .filter((e) => e.severity === 'critical' || e.severity === 'warn')
    .reverse()
    .slice(0, 20);

  const severityColor = (sev: string) =>
    sev === 'critical' ? '#ff4757' : sev === 'warn' ? '#ffd24a' : '#3da9fc';

  function formatRelative(at: string) {
    const ms = Date.now() - Date.parse(at);
    const m = Math.floor(ms / 60_000);
    if (m < 1) return lang === 'es' ? 'ahora' : 'now';
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h`;
  }

  return (
    <div className="absolute right-0 top-full mt-1 w-80 gx-card shadow-xl z-50 font-mono">
      <div className="px-3 py-2.5 border-b border-trim flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-zinc-300">
          {lang === 'es' ? 'Alertas y eventos' : 'Alerts & events'}
        </span>
        <button type="button" onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-[12px]">✕</button>
      </div>
      {criticalEvents.length === 0 ? (
        <div className="px-3 py-4 text-[11px] text-zinc-500">
          {lang === 'es' ? 'Sin alertas recientes.' : 'No recent alerts.'}
        </div>
      ) : (
        <ul className="max-h-80 overflow-y-auto divide-y divide-trim">
          {criticalEvents.map((e) => (
            <li key={e.id} className="px-3 py-2.5 flex items-start gap-2">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0"
                style={{ background: severityColor(e.severity) }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-zinc-300 leading-snug">{e.message[lang]}</div>
                <div className="text-[9px] text-zinc-600 mt-0.5 uppercase tracking-wider">{e.kind}</div>
              </div>
              <span className="text-[9px] text-zinc-600 shrink-0">{formatRelative(e.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function truncAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function GenesisHeader({ currentModule, onNavigate, onOpenCommandBar }: Props & { onNavigate?: (m: import('@core/data/moduleRegistry').ModuleId) => void; onOpenCommandBar?: () => void }) {
  const lang = useLanguage();
  const t = useT();
  const entry = MODULE_BY_ID[currentModule];
  const events = useEvents();
  const { online, lastSync } = useAgentData();
  const { address, isConnected } = useAccount();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Count critical events in last 5 minutes
  const fiveMinAgo = now - 5 * 60 * 1000;
  const alertCount = events.filter(
    (e) => (e.severity === 'critical' || e.severity === 'warn') && Date.parse(e.at) >= fiveMinAgo
  ).length;

  // Close drawer on outside click
  useEffect(() => {
    if (!drawerOpen) return;
    function handler(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setDrawerOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [drawerOpen]);

  // Accent color by current division
  const divisionColor = (() => {
    if (['markets', 'decisions'].includes(currentModule)) return '#00ff9c';
    if (['marketing', 'tech'].includes(currentModule)) return '#f59e0b';
    if (['hr', 'factory', 'auto'].includes(currentModule)) return '#a855f7';
    if (['integrations', 'progress', 'settings', 'wallet'].includes(currentModule)) return '#6b7280';
    return '#3da9fc';
  })();

  return (
    <header className="h-12 shrink-0 bg-carbon-200 border-b border-trim flex items-center justify-between px-4">
      <div className="flex items-center gap-3 min-w-0">
        {/* Logo mark */}
        <div className="flex items-center gap-0 shrink-0">
          <div
            className="w-8 h-8 flex items-center justify-center border font-mono font-black text-[15px] tracking-tighter select-none"
            style={{ borderColor: `${divisionColor}60`, color: divisionColor, background: `${divisionColor}12` }}
          >
            G
          </div>
        </div>
        <div className="leading-tight min-w-0">
          <div className="font-mono text-[13px] font-semibold tracking-wide text-zinc-100 truncate flex items-center gap-1.5">
            <span style={{ color: divisionColor }}>GÉNESIS HQ</span>
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-300 font-normal">{t(entry.navKey)}</span>
          </div>
          <div className="font-mono text-[8px] uppercase tracking-[0.28em] text-zinc-600 truncate">
            {t('header.subtitle')} · GNSS
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="hidden sm:flex items-center gap-2 font-mono text-[10px] text-zinc-400 uppercase tracking-wider">
          <span className="inline-block w-2 h-2 bg-emerald-400" />
          {t('header.officeStatus')}
        </div>
        <div className="hidden md:flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider"
          style={{ color: online ? '#00ff9c' : '#ff4757' }}>
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
          {online
            ? (lang === 'es' ? `Agente live${lastSync ? ` · ${lastSync}` : ''}` : `Agent live${lastSync ? ` · ${lastSync}` : ''}`)
            : (lang === 'es' ? 'Backend offline' : 'Backend offline')}
        </div>

        {/* Wallet chip */}
        {isConnected && address ? (
          <button
            type="button"
            onClick={() => onNavigate?.('wallet')}
            className="hidden sm:flex items-center gap-1.5 font-mono text-[10px] border border-purple-500/40 px-2 py-1 text-purple-300 hover:bg-purple-500/10"
            title={address}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400" />
            {truncAddr(address)}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onNavigate?.('wallet')}
            className="hidden sm:flex items-center gap-1.5 font-mono text-[10px] border border-zinc-600 px-2 py-1 text-zinc-500 hover:text-zinc-300 hover:border-zinc-400"
          >
            {lang === 'es' ? 'Conectar wallet' : 'Connect wallet'}
          </button>
        )}

        {/* ⌘K trigger */}
        {onOpenCommandBar && (
          <button
            type="button"
            onClick={onOpenCommandBar}
            className="hidden md:flex items-center gap-2 font-mono text-[10px] border border-trim px-2.5 py-1 text-zinc-500 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            title="Cmd+K"
          >
            <span className="text-zinc-600">⌘</span>
            <span className="tracking-wide">K</span>
          </button>
        )}

        {/* Notification bell */}
        <div ref={bellRef} className="relative">
          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            className="relative flex items-center justify-center w-7 h-7 border border-trim hover:bg-white/5"
            aria-label={lang === 'es' ? 'Notificaciones' : 'Notifications'}
          >
            <Bell className="w-3.5 h-3.5 text-zinc-400" />
            {alertCount > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center w-3.5 h-3.5 bg-red-500 font-mono text-[8px] text-white rounded-full">
                {alertCount > 9 ? '9+' : alertCount}
              </span>
            )}
          </button>
          {drawerOpen && (
            <NotificationDrawer events={events} onClose={() => setDrawerOpen(false)} />
          )}
        </div>

        {/* language toggle */}
        <div className="flex gx-tile font-mono text-[10px] uppercase tracking-wider">
          <button
            type="button"
            onClick={() => setLanguage('es')}
            className={`px-2 py-1 ${lang === 'es' ? 'bg-emerald-500/20 text-emerald-200' : 'text-zinc-400 hover:text-zinc-200'}`}
            aria-pressed={lang === 'es'}
          >
            ES
          </button>
          <button
            type="button"
            onClick={() => setLanguage('en')}
            className={`px-2 py-1 border-l border-trim ${lang === 'en' ? 'bg-emerald-500/20 text-emerald-200' : 'text-zinc-400 hover:text-zinc-200'}`}
            aria-pressed={lang === 'en'}
          >
            EN
          </button>
        </div>
      </div>
    </header>
  );
}
