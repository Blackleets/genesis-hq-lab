process.env.FUTURES_ONLY_MODE = 'true';
process.env.PREDICTION_AGENT_ENABLED = 'false';
process.env.LEGACY_CRYPTO_LOOP_ENABLED = 'false';
process.env.SCALP_ENGINE_ENABLED = 'false';
process.env.SWING_ENGINE_ENABLED = 'false';
process.env.EVENT_ALPHA_ENABLED = 'false';
process.env.BREAKOUT_ENGINE_ENABLED = 'false';
process.env.FUTURES_BREAKOUT_SHORT_ENABLED = process.env.FUTURES_BREAKOUT_SHORT_ENABLED ?? 'true';
process.env.FUTURES_BREAKOUT_LONG_ENABLED = process.env.FUTURES_BREAKOUT_LONG_ENABLED ?? 'false';

await import('../server/agentRunner.mjs');
