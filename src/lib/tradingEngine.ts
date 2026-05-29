// Paper trading engine — evaluates market signals and opens/closes positions.
// Called from MarketsView after each data refresh so it always has live prices.

import { actions, getState } from '../state/genesisStore';
import type { MarketEventSnapshot } from './marketsClient';

const MAX_POSITION_FRACTION = 0.05;
const MAX_POSITION_USD = 500;
const MIN_CONFIDENCE = 0.55;
const BUY_THRESHOLD = 0.40;
const PASS_THRESHOLD = 0.75;
const MIN_LIQUIDITY = 100;
const MIN_VOLUME_24H = 10;
const MAX_SPREAD = 0.15;
const MIN_DAYS_TO_EXPIRY = 2;

export function evaluatePaperTrades(events: MarketEventSnapshot[]): void {
  const s = getState();

  // Build price map: marketSlug → YES price
  const priceMap: Record<string, number> = {};
  for (const event of events) {
    for (const market of event.markets) {
      if (!market.active || market.closed) continue;
      const yesOutcome = market.outcomes.find((o) => o.label === 'Yes' || o.label === 'YES');
      const price = yesOutcome?.price ?? market.lastTradePrice;
      if (price !== null && price !== undefined) {
        priceMap[market.slug] = price;
      }
    }
  }

  // Mark open positions to market
  if (Object.keys(priceMap).length > 0) {
    actions.markPositionsToMarket(priceMap);
  }

  // Auto-close positions that have resolved (price >= 0.99 or <= 0.01)
  const openPositions = Object.values(s.positions);
  for (const pos of openPositions) {
    const currentPrice = priceMap[pos.marketId];
    if (currentPrice === undefined) continue;
    const yesResolved = currentPrice >= 0.99;
    const noResolved = currentPrice <= 0.01;
    if (yesResolved || noResolved) {
      const exitPrice = pos.outcome === 'YES'
        ? (yesResolved ? 1.0 : 0.0)
        : (noResolved ? 1.0 : 0.0);
      actions.closePosition(pos.id, exitPrice);
    }
  }

  // Find agents with trading capability that are active (not suspended/fired/onboarding)
  const tradingAgents = Object.values(s.agents).filter(
    (a) =>
      (a.capabilities.includes('paper_trade') || a.capabilities.includes('signal_generation')) &&
      a.status !== 'suspended' &&
      a.status !== 'fired' &&
      a.status !== 'onboarding' &&
      a.learningScore >= MIN_CONFIDENCE
  );

  if (tradingAgents.length === 0) return;

  // Find markets suitable for trading
  const tradableMarkets: Array<{
    slug: string;
    question: string;
    yesPrice: number;
    endDate: string | null;
  }> = [];

  const nowMs = Date.now();
  for (const event of events) {
    for (const market of event.markets) {
      if (!market.active || market.closed || !market.acceptingOrders) continue;
      const yesPrice = priceMap[market.slug];
      if (yesPrice === undefined) continue;
      // Liquidity filter
      if ((market.liquidity ?? 0) < MIN_LIQUIDITY) continue;
      // Volume filter
      if ((market.volume24hr ?? 0) < MIN_VOLUME_24H) continue;
      // Spread filter
      if (market.spread !== null && market.spread > MAX_SPREAD) continue;
      // Expiry filter — skip if expires in < 2 days
      if (market.endDate) {
        const daysToExpiry = (Date.parse(market.endDate) - nowMs) / (1000 * 60 * 60 * 24);
        if (daysToExpiry < MIN_DAYS_TO_EXPIRY) continue;
      }
      // Skip markets already in open positions
      const alreadyOpen = Object.values(s.positions).some((p) => p.marketId === market.slug);
      if (alreadyOpen) continue;
      tradableMarkets.push({
        slug: market.slug,
        question: market.question,
        yesPrice,
        endDate: market.endDate,
      });
    }
  }

  if (tradableMarkets.length === 0) return;

  // Each agent evaluates one market signal; re-read state each iteration so
  // positions opened by prior agents are visible (prevents buying same market twice)
  for (const agent of tradingAgents) {
    const liveState = getState();

    // Skip if already has an open position
    const agentHasPosition = Object.values(liveState.positions).some(
      (p) => p.agentId === agent.id
    );
    if (agentHasPosition) continue;

    // Build set of markets already claimed by any open position
    const takenMarkets = new Set(Object.values(liveState.positions).map((p) => p.marketId));

    // Sort markets by agent archetype:
    // - signal_generation (Market Scanner): prefers underpriced YES (low price first)
    // - risk_review (Risk Guardian): prefers high-confidence shorts (high price first)
    const prefersNO = agent.capabilities.includes('risk_review') && !agent.capabilities.includes('signal_generation');
    const sorted = [...tradableMarkets]
      .filter((m) => !takenMarkets.has(m.slug))
      .sort((a, b) => prefersNO ? b.yesPrice - a.yesPrice : a.yesPrice - b.yesPrice);

    for (const market of sorted) {
      if (market.yesPrice > BUY_THRESHOLD) {
        // Above threshold — skip or look for NO
        if (market.yesPrice < PASS_THRESHOLD) continue;
        // High price — agent shorts (buys NO)
        const noPrice = 1 - market.yesPrice;
        if (noPrice < 0.05) continue;
        const cm = agent.learningScore > 0.8 ? 1.0 : agent.learningScore > 0.65 ? 0.7 : 0.5;
        const maxCapital = Math.min(liveState.capital * MAX_POSITION_FRACTION * cm, MAX_POSITION_USD);
        if (maxCapital < 10) continue;
        const shares = Math.floor(maxCapital / noPrice);
        if (shares < 1) continue;
        actions.openPosition(
          agent.id,
          market.slug,
          { es: market.question, en: market.question },
          'NO',
          noPrice,
          shares
        );
        break;
      } else {
        // Underpriced — agent buys YES
        const cm = agent.learningScore > 0.8 ? 1.0 : agent.learningScore > 0.65 ? 0.7 : 0.5;
        const maxCapital = Math.min(liveState.capital * MAX_POSITION_FRACTION * cm, MAX_POSITION_USD);
        if (maxCapital < 10) continue;
        const shares = Math.floor(maxCapital / market.yesPrice);
        if (shares < 1) continue;
        actions.openPosition(
          agent.id,
          market.slug,
          { es: market.question, en: market.question },
          'YES',
          market.yesPrice,
          shares
        );
        break;
      }
    }
  }
}
