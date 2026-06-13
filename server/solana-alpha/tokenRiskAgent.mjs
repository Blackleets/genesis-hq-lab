// tokenRiskAgent.mjs — risk scoring for Pump.fun tokens.
// Scores 0-100: higher = more risky.

/**
 * @param {{ bondingCurvePct, marketCapSol, tradeCount, uniqueWallets, topWalletPct, createdTs }} token
 * @returns {{ score: number, flags: string[], label: string }}
 */
export function scoreTokenRisk(token) {
  const flags = [];
  let score = 0;

  const {
    bondingCurvePct = 0,
    marketCapSol = 0,
    tradeCount = 0,
    uniqueWallets = 0,
    topWalletPct = 0,
    createdTs = Date.now(),
  } = token;

  const ageMinutes = (Date.now() - createdTs) / 60_000;

  // Too new — minimal price history
  if (ageMinutes < 2) {
    score += 30;
    flags.push('too_new');
  } else if (ageMinutes < 5) {
    score += 15;
    flags.push('very_new');
  }

  // Very early bonding curve (rug likely if creator dumps)
  if (bondingCurvePct < 5) {
    score += 25;
    flags.push('bonding_too_early');
  } else if (bondingCurvePct < 20) {
    score += 10;
    flags.push('bonding_low');
  }

  // Very high market cap → late entry
  if (marketCapSol > 500) {
    score += 20;
    flags.push('high_mcap_late');
  } else if (marketCapSol > 100) {
    score += 8;
    flags.push('moderate_mcap');
  }

  // Very few traders → honeypot risk
  if (tradeCount < 5) {
    score += 25;
    flags.push('honeypot_risk');
  } else if (tradeCount < 15) {
    score += 10;
    flags.push('low_trade_count');
  }

  // Low unique wallets → wash trading
  if (uniqueWallets < 3) {
    score += 20;
    flags.push('wash_trading_risk');
  } else if (uniqueWallets < 10) {
    score += 8;
    flags.push('low_unique_wallets');
  }

  // Wallet concentration risk
  if (topWalletPct > 50) {
    score += 25;
    flags.push('whale_concentration');
  } else if (topWalletPct > 30) {
    score += 10;
    flags.push('moderate_concentration');
  }

  const clamped = Math.min(100, Math.max(0, score));

  const label = clamped >= 70 ? 'HIGH_RISK'
    : clamped >= 40 ? 'MODERATE_RISK'
    : clamped >= 20 ? 'LOW_RISK'
    : 'SAFE';

  return { score: clamped, flags, label };
}

export function isTokenTradeable(riskResult) {
  if (riskResult.score >= 70) return false;
  if (riskResult.flags.includes('honeypot_risk')) return false;
  if (riskResult.flags.includes('too_new')) return false;
  return true;
}
