// testScalpingEngine.js - Test that the scalping engine can be imported and basic functions work
import { scalpConfig, getScalpState, evaluateScalpSignal, runScalpingCycle } from './server/strategies/scalpingEngine.mjs';

console.log('Testing scalping engine imports...');

try {
  const config = scalpConfig();
  console.log('scalpConfig:', config);
  
  const state = getScalpState();
  console.log('getScalpState:', { activeCount: state.activeCount, configEnabled: state.config.enabled });
  
  console.log('Scalping engine loaded successfully');
  process.exit(0);
} catch (e) {
  console.error('Failed to load scalping engine:', e.message);
  process.exit(1);
}