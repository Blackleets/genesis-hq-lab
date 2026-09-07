import { TradingDeskProvider } from './TradingDeskProvider';
import { GenesisPremiumApp } from './GenesisPremiumApp';
import './genesisPremiumPolish.css';

export function TradingWorkspace() {
  return <TradingDeskProvider><GenesisPremiumApp /></TradingDeskProvider>;
}
