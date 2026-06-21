// versioningMiddleware.mjs — API version detection and compatibility layer
// Handles Accept-Version header and path-based versioning

/**
 * Parse API version from request
 * Supports: Accept-Version header, URL path (/v2/...), query param (?api-version=2)
 */
export function parseApiVersion(req) {
  // Priority: explicit header > URL path > query param > default
  const acceptVersion = req.headers?.['accept-version'];
  if (acceptVersion) {
    return parseVersionString(acceptVersion);
  }

  const pathname = req.url?.split('?')[0] || '';
  const pathMatch = pathname.match(/\/v(\d+)/);
  if (pathMatch) {
    return parseInt(pathMatch[1], 10);
  }

  const queryVersion = req.query?.['api-version'];
  if (queryVersion) {
    return parseInt(queryVersion, 10);
  }

  return 2; // default to v2
}

/**
 * Parse semantic version string (e.g., "2.1.0" or "v2")
 */
function parseVersionString(versionStr) {
  if (!versionStr) return 2;

  // Extract major version number
  const match = versionStr.match(/v?(\d+)/);
  return match ? parseInt(match[1], 10) : 2;
}

/**
 * Get deprecation status for a feature in given API version
 */
export function getDeprecationStatus(featureName, apiVersion) {
  const deprecations = {
    'hardcoded_params': {
      deprecatedInVersion: 2,
      sunsetAt: new Date('2026-09-01'),
      replacement: 'Use POST /api/system/strategy',
    },
    'v1_capital_history': {
      deprecatedInVersion: 2,
      sunsetAt: new Date('2026-08-01'),
      replacement: 'Use bucket-aware capital endpoints',
    },
  };

  const deprecation = deprecations[featureName];
  if (!deprecation) {
    return { deprecated: false };
  }

  const isSunset = new Date() > deprecation.sunsetAt;
  const isDeprecated = apiVersion <= deprecation.deprecatedInVersion;

  return {
    deprecated: isDeprecated,
    sunset: isSunset,
    sunsetAt: deprecation.sunsetAt.toISOString(),
    replacement: deprecation.replacement,
    message: isSunset
      ? `${featureName} is no longer available. Use: ${deprecation.replacement}`
      : `${featureName} is deprecated. Migrate to: ${deprecation.replacement}`,
  };
}

/**
 * V1→V2 adapter for strategy params
 * Translates old API calls to new structure
 */
export function adaptStrategyParamsV1toV2(legacyParams) {
  return {
    venue: legacyParams.venue || 'kalshi',
    min_confidence: legacyParams.minConfidence || 0.65,
    max_entry_price: legacyParams.maxEntryPrice || 0.90,
    min_entry_price: legacyParams.minEntryPrice || 0.10,
    max_position_usd: legacyParams.maxPosition || 500,
    max_position_pct: legacyParams.maxRisk || 0.05,
    max_open_trades: legacyParams.maxOpenTrades || 5,
    stop_loss_pct: legacyParams.stopLoss || 0.20,
    take_profit_pct: legacyParams.takeProfit || 0.50,
    max_hold_days: legacyParams.daysToHold || 45,
    min_liquidity_usd: legacyParams.minLiquidity || 5000,
  };
}

/**
 * Format response with API version metadata
 */
export function formatVersionedResponse(data, apiVersion, opts = {}) {
  return {
    ok: data.ok !== false,
    apiVersion,
    buildDate: new Date().toISOString(),
    data,
    ...opts,
  };
}

/**
 * Log API usage by version
 */
export function logApiUsage(apiVersion, endpoint, statusCode) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    apiVersion,
    endpoint,
    statusCode,
  };

  // In production, this would go to monitoring/analytics
  if (process.env.API_USAGE_LOG === 'verbose') {
    console.log(`[api:v${apiVersion}] ${endpoint} ${statusCode}`);
  }

  return logEntry;
}
