import test from 'node:test'; import assert from 'node:assert/strict'; import { readFile } from 'node:fs/promises';
test('futures governor risk escalation is opt-in and disabled by default',async()=>{
 const s=await readFile(new URL('../crypto/futuresGovernor.mjs',import.meta.url),'utf8');
 assert.match(s,/FUTURES_GOV_RISK_ESCALATION_ENABLED/);
 assert.match(s,/\?\? 'false'/);
 assert.match(s,/RISK_ESCALATION_ENABLED\s*\n\s*&& trades >= ATTACK_MIN_SAMPLES/);
 assert.match(s,/RISK_ESCALATION_ENABLED\s*\n\s*&& trades >= PROMOTE_MIN_SAMPLES/);
});