// ResearchSignalsPanel — live research signals from the backend (/api/agent/signals).
// Free news + Hacker News sentiment that feeds the trading debate. Read-only.

import { useAgentData } from '@agents/hooks/useAgentData';
import { useLanguage } from '@core/i18n/languageStore';

function sentimentColor(text: string): string {
  if (/bullish/i.test(text)) return '#00ff9c';
  if (/bearish/i.test(text)) return '#ff4757';
  return '#9ca3af';
}

export default function ResearchSignalsPanel() {
  const lang = useLanguage();
  const { signals, signalAccuracy, online } = useAgentData();

  if (!online) return null;          // Dashboard/Markets already show the offline banner
  if (signals.length === 0) {
    return (
      <div className="gx-card px-4 py-3">
        <div className="gx-overline mb-1">
          {lang === 'es' ? 'Research · Señales' : 'Research · Signals'}
        </div>
        <div className="font-mono text-[10px] text-zinc-700">
          {lang === 'es' ? 'Aún sin señales — se generan al evaluar mercados.' : 'No signals yet — generated as markets are evaluated.'}
        </div>
      </div>
    );
  }

  return (
    <div className="gx-card">
      <div className="px-4 py-2 border-b border-trim flex items-center justify-between">
        <span className="gx-overline">
          {lang === 'es' ? 'Research · Señales en vivo' : 'Research · Live Signals'}
        </span>
        {signalAccuracy && signalAccuracy.rate != null && (
          <span className="font-mono text-[9px] text-zinc-600">
            {lang === 'es' ? 'Precisión' : 'Accuracy'}:{' '}
            <span className="text-emerald-400">{(signalAccuracy.rate * 100).toFixed(0)}%</span>
            {' '}({signalAccuracy.correct}/{signalAccuracy.total})
          </span>
        )}
      </div>
      <ul className="divide-y divide-trim max-h-[280px] overflow-y-auto">
        {signals.slice(0, 12).map((s) => {
          const color = sentimentColor(s.signal_text);
          return (
            <li key={s.id} className="px-4 py-2 flex items-start gap-2.5">
              <span className="mt-1 inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[10px] text-zinc-300 leading-snug">{s.signal_text}</div>
                <div className="flex items-center gap-2 mt-0.5 font-mono text-[8px] text-zinc-600 uppercase tracking-wider">
                  <span>{s.source}</span>
                  <span>·</span>
                  <span>{s.category}</span>
                  <span>·</span>
                  <span style={{ color }}>conf {(s.confidence * 100).toFixed(0)}%</span>
                  {s.proved_correct != null && (
                    <>
                      <span>·</span>
                      <span style={{ color: s.proved_correct ? '#00ff9c' : '#ff4757' }}>
                        {s.proved_correct ? '✓' : '✗'}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
