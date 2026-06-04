export interface PaperPosition {
  id: string;
  marketId: string;
  question: { es: string; en: string };
  outcome: 'YES' | 'NO';
  entryPrice: number;
  currentPrice: number;
  shares: number;
  capitalAllocated: number;
  openedAt: string;
  closedAt?: string;
  exitPrice?: number;
  pnl?: number;
  agentId: string;
  confidence: number;
  status: 'open' | 'closed' | 'resolved';
  isReal: boolean;
}

export interface TradingStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  openPositionsValue: number;
}
