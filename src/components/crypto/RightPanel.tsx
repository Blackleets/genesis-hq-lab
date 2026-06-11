// RightPanel.tsx - Tab wrapper for the right zone of Crypto Lab.
// Hosts INTEL, DEPTH, and PRO validation tabs.

import { useState } from 'react';
import { MarketIntelPanel } from './MarketIntelPanel';
import { LiquidityMatrix } from './LiquidityMatrix';
import { ProValidationPanel } from './ProValidationPanel';
import { CouncilPanel } from './CouncilPanel';

type Tab = 'COUNCIL' | 'INTEL' | 'DEPTH' | 'PRO';

const TAB_COLOR: Record<Tab, string> = {
  COUNCIL: '#22c55e',
  INTEL: '#f59e0b',
  DEPTH: '#a855f7',
  PRO: '#3da9fc',
};

interface Props {
  pair?: string;
  className?: string;
}

export function RightPanel({ pair, className = '' }: Props) {
  const [tab, setTab] = useState<Tab>('INTEL');

  return (
    <div className={className} style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#060810',
      border: '1px solid #1e2a3a',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid #1e2a3a' }}>
        {(['COUNCIL', 'INTEL', 'DEPTH', 'PRO'] as Tab[]).map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            style={{
              flex: 1,
              padding: '7px 4px',
              fontSize: 9,
              letterSpacing: 1,
              fontWeight: 700,
              textTransform: 'uppercase',
              fontFamily: 'monospace',
              border: 'none',
              cursor: 'pointer',
              background: 'transparent',
              color: tab === name ? TAB_COLOR[name] : '#374151',
              borderBottom: tab === name ? `2px solid ${TAB_COLOR[name]}` : '2px solid transparent',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {name}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {tab === 'COUNCIL' && <CouncilPanel />}
        {tab === 'INTEL' && <MarketIntelPanel />}
        {tab === 'DEPTH' && <LiquidityMatrix pair={pair} noBorder />}
        {tab === 'PRO' && <ProValidationPanel />}
      </div>
    </div>
  );
}
