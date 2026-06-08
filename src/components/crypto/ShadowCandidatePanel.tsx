import type { ShadowCandidateDiagnostics } from '@services/cryptoClient';

const PANEL_BG = '#08101b';
const PANEL_BORDER = '#172033';

function ago(iso?: string | null) {
  if (!iso) return '—';
  const deltaMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(deltaMs)) return '—';
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function Stat({
  label,
  value,
  color = '#e5e7eb',
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="rounded bg-[#0b1320] px-2 py-1.5">
      <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">{label}</div>
      <div className="font-mono text-[11px] font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

export function ShadowCandidatePanel({
  shadow,
  es,
}: {
  shadow: ShadowCandidateDiagnostics | null;
  es: boolean;
}) {
  if (!shadow) {
    return (
      <div style={{ background: PANEL_BG, border: `1px solid ${PANEL_BORDER}`, borderRadius: 8, padding: 10 }}>
        <div className="font-mono text-[9px] uppercase tracking-wider text-cyan-400">
          {es ? 'Candidato en sombra' : 'Shadow candidate'}
        </div>
        <div className="mt-2 font-mono text-[10px] text-zinc-600">
          {es ? 'Sin respuesta del backend.' : 'Backend did not return shadow diagnostics.'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: PANEL_BG, border: `1px solid ${PANEL_BORDER}`, borderRadius: 8, padding: 10 }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-cyan-400">
            {es ? 'Candidato en sombra' : 'Shadow candidate'}
          </div>
          <div className="mt-1 font-mono text-[11px] font-bold text-zinc-100">
            {shadow.candidateId ?? (es ? 'No habilitado' : 'Not enabled')}
          </div>
        </div>
        <span
          className="rounded border px-2 py-1 font-mono text-[8px] uppercase tracking-[0.18em]"
          style={{
            color: shadow.running ? '#22c55e' : '#6b7280',
            borderColor: shadow.running ? '#14532d' : '#27272a',
            background: shadow.running ? '#052e16' : '#0f172a',
          }}
        >
          {shadow.running ? 'running' : 'idle'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label={es ? 'señales' : 'signals'} value={shadow.signalsSeen} />
        <Stat label="would trade" value={shadow.wouldTradeCount} color="#22c55e" />
        <Stat label="blocked" value={shadow.blockedCount} color="#f59e0b" />
        <Stat label={es ? 'pares' : 'pairs'} value={shadow.pairSet.length > 0 ? shadow.pairSet.join(', ') : '—'} color="#cbd5e1" />
      </div>

      {!shadow.running ? (
        <div className="mt-3 rounded bg-[#0b1320] px-3 py-2 font-mono text-[10px] text-zinc-500">
          {es
            ? 'Activa SHADOW_CANDIDATE_ENABLED=true y un SHADOW_CANDIDATE_ID para ver señales en sombra.'
            : 'Enable SHADOW_CANDIDATE_ENABLED=true and a SHADOW_CANDIDATE_ID to see shadow signals.'}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
              {es ? 'Por par' : 'By pair'}
            </div>
            <div className="space-y-1">
              {shadow.byPair.length === 0 ? (
                <div className="font-mono text-[10px] text-zinc-600">—</div>
              ) : shadow.byPair.map((row) => (
                <div key={row.pair} className="flex items-center justify-between gap-3 font-mono text-[10px]">
                  <span className="text-zinc-300">{row.pair}</span>
                  <span className="text-zinc-500">{row.signalsSeen} sig</span>
                  <span className="text-green-400">{row.wouldTradeCount} ok</span>
                  <span className="text-amber-400">{row.blockedCount} blk</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
              {es ? 'Por hora UTC' : 'By UTC hour'}
            </div>
            <div className="space-y-1">
              {shadow.byHour.length === 0 ? (
                <div className="font-mono text-[10px] text-zinc-600">—</div>
              ) : shadow.byHour.map((row) => (
                <div key={row.hour} className="flex items-center justify-between gap-3 font-mono text-[10px]">
                  <span className="text-zinc-300">{row.hour}:00</span>
                  <span className="text-zinc-500">{row.signalsSeen} sig</span>
                  <span className="text-green-400">{row.wouldTradeCount} ok</span>
                  <span className="text-amber-400">{row.blockedCount} blk</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
              {es ? 'Recientes' : 'Recent'}
            </div>
            <div className="space-y-1">
              {shadow.recent.length === 0 ? (
                <div className="font-mono text-[10px] text-zinc-600">
                  {es ? 'Aún sin eventos.' : 'No events yet.'}
                </div>
              ) : shadow.recent.slice(0, 5).map((row) => (
                <div key={`${row.ts}-${row.pair}-${row.side}`} className="rounded bg-[#0b1320] px-2 py-1.5">
                  <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
                    <span className="text-zinc-200">{row.pair} {row.side ?? '—'}</span>
                    <span style={{ color: row.blocked ? '#f59e0b' : '#22c55e' }}>
                      {row.blocked ? 'blocked' : 'would trade'}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[9px] text-zinc-500">
                    <span>{row.confidence != null ? `${Math.round(row.confidence * 100)}%` : '—'}</span>
                    <span>{ago(row.ts)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
