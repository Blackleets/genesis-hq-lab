import assert from 'node:assert/strict';
import { feesDominate } from '../fundingHold.mjs';

assert.equal(feesDominate({ realizedFundingUsdt: 0.87, feesUsdt: 6.25 }), true);
assert.equal(feesDominate({ realizedFundingUsdt: 10, feesUsdt: 6.25 }), false);
assert.equal(feesDominate({ realizedFundingUsdt: 5, feesUsdt: 5 }), false); // only when fees >
assert.equal(feesDominate({}), false);
console.log('feesDominate.smoke ok');
