// EngineTelemetry.tsx — live execution telemetry + premium "why no trade" explainer.
// Teaches the operator how Genesis thinks: per-asset reason + missing confluences.
// Accepts diagnostics from a parent (no double-poll); falls back to self-poll.

import { useEffect, useState, useCallback } from 'react';
import { loadDiagnostics, type BreakdownStat, type CandidateAction, type ExecutionDiagnostics, type LoopStatus, type ScanAsset } from '@services/cryptoClient';

const POLL_MS = 10_000;

const REASON_LABEL: Record<string, string> = {
  LOW_CONFIDENCE:  'Low confidence',
  REGIME_MISMATCH: 'Regime mismatch',
  LOW_VOLATILITY:  'Market too quiet',
  HIGH_VOLATILITY: 'Too volatile (gap risk)',
  NO_EDGE:         'No confluence edge',
  POSITION_OPEN:   'Position already open',
  ACCEPTED:        'Accepted',
};

const REGIME_COLOR: Record<string, string> = {
  STRONG_BULL: '#22c55e', BULL: '#4ade80', RANGE: '#6b7280',
  BEAR: '#f87171', STRONG_BEAR: '#ef4444', HIGH_VOLATILITY: '#f59e0b',
};

function LoopRow({ label, s }: { label: string; s: LoopStatus }) {
  const color = s.running ? '#22c55e' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ color: '#9ca3af', fontSize: 10, width: 72 }}>{label}</span>
      <span style={{ color, fontSize: 9, fontWeight: 700, width: 78 }}>{s.running ? 'RUNNING' : 'NOT RUNNING'}</span>
      <span style={{ color: '#4b5563', fontSize: 9, marginLeft: 'auto' }}>
        {s.ticks} ticks{s.errors > 0 ? ` · ${s.errors} err` : ''}
      </span>
    </div>
  );
}

function WhyNoTrade({ asset }: { asset: ScanAsset }) {
  const sym = asset.symbol;
  const accepted = asset.reason === 'ACCEPTED';
  const color = accepted ? '#22c55e' : asset.reason === 'LOW_CONFIDENCE' ? '#f59e0b' : '#6b7280';

  return (
    <div style={{
      padding: '6px 8px', borderRadius: 4, background: '#0a0e1a',
      border: '1px solid #161b26', marginBottom: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#e5e7eb', fontSize: 10, fontWeight: 700 }}>{sym}</span>
        <span style={{ color, fontSize: 8, fontWeight: 700, letterSpacing: 0.5 }}>
          {accepted ? '✓ TRADED' : 'REJECTED'}
        </span>
        {asset.side && !accepted && (
          <span style={{ color: '#4b5563', fontSize: 8 }}>({asset.side} candidate)</span>
        )}
        {asset.regime && (
          <span style={{ marginLeft: 'auto', color: REGIME_COLOR[asset.regime] ?? '#6b7280', fontSize: 7, fontWeight: 700 }}>
            {asset.regime}
          </span>
        )}
      </div>
      <div style={{ color: '#9ca3af', fontSize: 9, marginTop: 2 }}>
        Reason: <span style={{ color }}>
          {asset.reason === 'REGIME_MISMATCH'
            ? `${asset.side === 'SHORT' ? 'bullish' : 'bearish'} regime mismatch`
            : (REASON_LABEL[asset.reason] ?? asset.reason)}
        </span>
      </div>
      {asset.reason === 'REGIME_MISMATCH' && asset.regime && (
        <div style={{ color: '#78716c', fontSize: 9 }}>
          {asset.regime} · {asset.side?.toLowerCase()} penalty {asset.bias}
          {asset.rawConfidence != null && ` (conf ${asset.rawConfidence} → ${asset.confidence})`}
        </div>
      )}
      {asset.reason === 'LOW_CONFIDENCE' && (
        <div style={{ color: '#78716c', fontSize: 9 }}>
          {asset.confidence} &lt; required {asset.gate}
        </div>
      )}
      {!accepted && asset.missing.length > 0 && (
        <div style={{ marginTop: 2 }}>
          <span style={{ color: '#4b5563', fontSize: 8 }}>Missing confluences:</span>
          {asset.missing.map((m, i) => (
            <div key={i} style={{ color: '#6b7280', fontSize: 9, display: 'flex', gap: 4 }}>
              <span style={{ color: '#ef4444' }}>·</span><span>{m}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ToxicLine({ label, stat, colorHint }: { label: string; stat: BreakdownStat; colorHint: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: 8,
      fontSize: 9,
      padding: '3px 0',
      borderBottom: '1px solid #111827',
    }}>
      <span style={{ color: '#9ca3af' }}>
        {label} <span style={{ color: '#6b7280' }}>({stat.samples}t)</span>
      </span>
      <span style={{ color: colorHint, fontWeight: 700 }}>
        EV ${stat.expectancy} · PF {stat.profitFactor === null ? 'N/A' : stat.profitFactor}
      </span>
    </div>
  );
}

function CandidateActionLine({ action }: { action: CandidateAction }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      gap: 8,
      fontSize: 9,
      padding: '3px 0',
      borderBottom: '1px solid #111827',
    }}>
      <span style={{ color: '#9ca3af' }}>
        {action.type}
      </span>
      <span style={{ color: '#60a5fa', fontWeight: 700, textAlign: 'right' }}>
        {action.target}
      </span>
    </div>
  );
}

interface Props {
  diagnostics?: ExecutionDiagnostics | null;
}

export function EngineTelemetry({ diagnostics: ext }: Props) {
  const [self, setSelf] = useState<ExecutionDiagnostics | null>(null);

  const poll = useCallback(async () => {
    const data = await loadDiagnostics();
    if (data) setSelf(data);
  }, []);

  // Only self-poll when no diagnostics are supplied by the parent.
  useEffect(() => {
    if (ext !== undefined) return;
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll, ext]);

  const d = ext ?? self;
  if (!d) return <div style={{ color: '#374151', fontSize: 10, fontFamily: 'monospace' }}>Loading telemetry…</div>;

  const t = d.training;
  const assets = d.scanSnapshot?.assets ?? [];
  const toxic = d.autopsy?.breakdown;

  return (
    <div style={{ fontFamily: 'monospace' }}>
      <div className="font-mono text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#a855f7' }}>
        Engine loops {d.mode ? `· ${d.mode}` : ''}
      </div>

      <LoopRow label="SCALPING" s={d.loops.scalping} />
      <LoopRow label="EVENT"    s={d.loops.event} />
      <LoopRow label="SWING"    s={d.loops.swing} />

      <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 9, color: '#4b5563' }}>
        <span>scalp ≥ <span style={{ color: '#9ca3af' }}>{Math.round(d.gates.scalp.minConfidence * 100)}%</span></span>
        <span>swing ≥ <span style={{ color: '#9ca3af' }}>{Math.round(d.gates.swing.minConfidence * 100)}%</span></span>
        <span>EV ≥ <span style={{ color: '#9ca3af' }}>{(d.gates.event.evThreshold * 100).toFixed(0)}%</span></span>
      </div>

      {t && (
        <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 9, color: '#4b5563' }}>
          <span>open <span style={{ color: '#f59e0b' }}>{t.open}</span></span>
          <span>closed <span style={{ color: '#9ca3af' }}>{t.closed}</span></span>
          <span>win <span style={{ color: '#9ca3af' }}>{t.winRate != null ? `${Math.round(t.winRate * 100)}%` : '—'}</span></span>
          <span>pnl <span style={{ color: t.totalPnl >= 0 ? '#22c55e' : '#ef4444' }}>${t.totalPnl.toFixed(2)}</span></span>
        </div>
      )}

      {toxic && (
        <div style={{ marginTop: 8 }}>
          <div style={{ color: '#4b5563', fontSize: 8, letterSpacing: 0.6, marginBottom: 4 }}>
            TOXIC SEGMENTS · where pnl is leaking
          </div>
          {toxic.byPair[0] && <ToxicLine label={`pair ${toxic.byPair[0].pair}`} stat={toxic.byPair[0]} colorHint="#ef4444" />}
          {toxic.byRegime[0] && <ToxicLine label={`regime ${toxic.byRegime[0].regime}`} stat={toxic.byRegime[0]} colorHint="#f97316" />}
          {toxic.byHour[0] && <ToxicLine label={`hour ${toxic.byHour[0].hour} UTC`} stat={toxic.byHour[0]} colorHint="#f59e0b" />}
          {toxic.byConfidenceBand[0] && <ToxicLine label={`conf ${toxic.byConfidenceBand[0].confidenceBand}`} stat={toxic.byConfidenceBand[0]} colorHint="#a855f7" />}
        </div>
      )}

      {(d.autopsy?.candidateActions?.length ?? 0) > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ color: '#4b5563', fontSize: 8, letterSpacing: 0.6, marginBottom: 4 }}>
            NEXT FILTERS · apply additively
          </div>
          {d.autopsy?.candidateActions.slice(0, 3).map((action) => (
            <CandidateActionLine key={`${action.type}-${action.target}`} action={action} />
          ))}
        </div>
      )}

      {/* Premium WHY NO TRADE — per-asset, teaches confluences */}
      {assets.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ color: '#4b5563', fontSize: 8, letterSpacing: 0.6, marginBottom: 3 }}>
            WHY NO TRADE · how Genesis thinks
          </div>
          {assets.map(a => <WhyNoTrade key={a.symbol} asset={a} />)}
        </div>
      )}
    </div>
  );
}
