import { TradingDeskProvider } from './TradingDeskProvider';
import { GenesisPremiumApp } from './GenesisPremiumApp';

export function TradingWorkspace() {
  return <TradingDeskProvider><GenesisPremiumApp /></TradingDeskProvider>;
}
