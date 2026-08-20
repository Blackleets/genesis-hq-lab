// api/system/version.js — API versioning and deprecation tracking

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  const apiVersion = '2.1.0';
  const buildDate = new Date('2026-06-21').toISOString();

  res.json({
    ok: true,
    api: {
      version: apiVersion,
      major: 2,
      minor: 1,
      patch: 0,
      buildDate,
      environment: process.env.VERCEL_ENV || 'development',
    },
    endpoints: {
      v1: {
        status: 'legacy',
        deprecatedAt: '2026-05-01',
        sunsetAt: '2026-08-01',
        baseUrl: '/api/v1',
        description: 'Original API - use v2 for new clients',
      },
      v2: {
        status: 'stable',
        releasedAt: '2026-01-15',
        baseUrl: '/api/v2',
        description: 'Stable API with strategy params, signals, skills',
        breaking: [
          'capital_buckets structure changed',
          'venue switching now requires explicit activation',
        ],
      },
    },
    features: {
      strategyParams: {
        since: '2.1.0',
        status: 'stable',
        description: 'Per-venue strategy configuration',
        endpoints: ['/api/system/strategy'],
      },
      signals: {
        since: '2.1.0',
        status: 'beta',
        description: 'Research signal registration and tracking',
        endpoints: ['/api/research/signals'],
      },
      skills: {
        since: '2.1.0',
        status: 'beta',
        description: 'Agent skill evolution and learning',
        endpoints: ['/api/learning/skills'],
      },
      reinvestment: {
        since: '2.1.0',
        status: 'stable',
        description: 'Automated capital reinvestment per Constitution',
        endpoints: ['/api/capital/reinvestment'],
      },
      kalshi: {
        since: '2.0.0',
        status: 'stable',
        description: 'Kalshi prediction market integration',
        endpoints: ['/api/kalshi/...'],
      },
    },
    deprecations: [
      {
        feature: 'hardcoded_strategy_params',
        since: '2.1.0',
        replacement: 'POST /api/system/strategy to configure per venue',
        sunsetAt: '2026-09-01',
      },
      {
        feature: 'v1_capital_history',
        since: '2.1.0',
        replacement: 'Use bucket-aware capital endpoints',
        sunsetAt: '2026-08-01',
      },
    ],
  });
}
