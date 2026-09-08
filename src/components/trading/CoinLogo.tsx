import type { TradingSymbol } from './tradingTypes';

const COINS: Record<TradingSymbol, { ticker: string; name: string }> = {
  BTCUSDT: { ticker: 'btc', name: 'Bitcoin' },
  ETHUSDT: { ticker: 'eth', name: 'Ethereum' },
  SOLUSDT: { ticker: 'sol', name: 'Solana' },
  BNBUSDT: { ticker: 'bnb', name: 'BNB' },
  XRPUSDT: { ticker: 'xrp', name: 'XRP' },
  DOGEUSDT: { ticker: 'doge', name: 'Dogecoin' },
};

export function CoinLogo({ symbol }: { symbol: TradingSymbol }) {
  const coin = COINS[symbol];
  return <img className="coin-logo" src={`/assets/coins/${coin.ticker}.svg`} alt={coin.name} width={32} height={32} decoding="async" />;
}
