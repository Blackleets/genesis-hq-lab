import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import { useEvents } from '@core/store/genesisStore';
import type { EventKind } from '@core/types/event';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'warning' | 'error' | 'info';
  at: number;
}

const TOAST_KINDS: Partial<Record<EventKind, Toast['type']>> = {
  'trade.profit': 'success',
  'trade.loss': 'error',
  'agent.auto_fired': 'error',
  'agent.auto_suspended': 'warning',
  'agent.mentoring': 'info',
  'module.unlocked': 'success',
  'agent.promoted': 'success',
};

const TOAST_DURATION = 4000;

const TYPE_COLORS: Record<Toast['type'], string> = {
  success: '#00ff9c',
  warning: '#ffd24a',
  error: '#ff4757',
  info: '#3da9fc',
};

export default function ToastContainer() {
  const lang = useLanguage();
  const events = useEvents();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const recent = events.slice(-20);
    const newToasts: Toast[] = [];
    for (const ev of recent) {
      if (seenRef.current.has(ev.id)) continue;
      const type = TOAST_KINDS[ev.kind as EventKind];
      if (!type) continue;
      seenRef.current.add(ev.id);
      newToasts.push({
        id: ev.id,
        message: ev.message[lang],
        type,
        at: Date.now(),
      });
    }
    if (newToasts.length === 0) return;
    const handle = window.setTimeout(() => {
      setToasts((prev) => [...prev.slice(-3), ...newToasts]);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [events, lang]);

  // Auto-dismiss
  useEffect(() => {
    if (toasts.length === 0) return;
    const oldest = toasts[0];
    const remaining = TOAST_DURATION - (now - oldest.at);
    const id = window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== oldest.id));
    }, Math.max(200, remaining));
    return () => window.clearTimeout(id);
  }, [toasts, now]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const color = TYPE_COLORS[toast.type];
        const elapsed = Math.min(1, (now - toast.at) / TOAST_DURATION);
        return (
          <div
            key={toast.id}
            className="pointer-events-auto w-72 border bg-carbon-200 px-3 py-2.5 font-mono text-[11px] text-zinc-200 leading-snug shadow-xl"
            style={{ borderColor: `${color}60`, borderLeftWidth: 3, borderLeftColor: color }}
          >
            <div className="flex items-start gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full mt-0.5 shrink-0" style={{ background: color }} />
              <span className="flex-1">{toast.message}</span>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                className="text-zinc-600 hover:text-zinc-300 shrink-0 ml-1"
              >
                ✕
              </button>
            </div>
            {/* Progress bar */}
            <div className="mt-2 h-[2px] bg-carbon-300 w-full">
              <div
                className="h-full"
                style={{ width: `${(1 - elapsed) * 100}%`, background: color, opacity: 0.5 }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
