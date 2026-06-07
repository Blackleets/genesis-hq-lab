// RightPanel.tsx — Tab wrapper for the right zone of Crypto Lab.
// Hosts INTEL (MarketIntelPanel) and DEPTH (LiquidityMatrix) tabs.
// Default: INTEL tab. Owns tab state.

import { useState } from 'react';
import { MarketIntelPanel } from './MarketIntelPanel';
import { LiquidityMatrix }  from './LiquidityMatrix';

type Tab = 'INTEL' | 'DEPTH';

const TAB_COLOR: Record<Tab, string> = {
  INTEL: '#f59e0b',
  DEPTH: '#a855f7',
};

interface Props {
  pair?:      string;
  className?: string;
}

export function RightPanel({ pair, className = '' }: Props) {
  const [tab, setTab] = useState<Tab>('INTEL');

  return (
    <div className={className} style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#060810', border: '1px solid #1e2a3a',
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid #1e2a3a' }}>
        {(['INTEL', 'DEPTH'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '7px 4px',
              fontSize: 9, letterSpacing: 1, fontWeight: 700,
              textTransform: 'uppercase', fontFamily: 'monospace',
              border: 'none', cursor: 'pointer', background: 'transparent',
              color:        tab === t ? TAB_COLOR[t] : '#374151',
              borderBottom: tab === t ? `2px solid ${TAB_COLOR[t]}` : '2px solid transparent',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content — each child fills the remaining height */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {tab === 'INTEL'
          ? <MarketIntelPanel />
          : <LiquidityMatrix pair={pair} noBorder />}
      </div>
    </div>
  );
}
