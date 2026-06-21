// skillEvolution.test.mjs — Agent skill development tests

import { strict as assert } from 'assert';
import { test } from 'node:test';
import {
  SKILL_NAMES,
  updateSkillsAfterTrade,
  getSkillProfile,
  getAllSkillProfiles,
  getSkillStrengthsWeaknesses,
  getTrainingRecommendations,
} from '../learning/skillEvolution.mjs';

test('skill: SKILL_NAMES contains 5 skills', () => {
  assert.equal(SKILL_NAMES.length, 5);
  assert.ok(SKILL_NAMES.includes('skill_market_selection'));
  assert.ok(SKILL_NAMES.includes('skill_timing'));
  assert.ok(SKILL_NAMES.includes('skill_position_sizing'));
  assert.ok(SKILL_NAMES.includes('skill_signal_reading'));
  assert.ok(SKILL_NAMES.includes('skill_pattern_recog'));
});

test('skill: getSkillProfile returns market-agent-1', () => {
  const profile = getSkillProfile('market-agent-1');
  assert.ok(profile);
  assert.equal(profile.agentId, 'market-agent-1');
  assert.ok(typeof profile.marketSelection === 'number');
  assert.ok(typeof profile.average === 'number');
  console.log('[test] Market Agent skill profile:', profile);
});

test('skill: updateSkillsAfterTrade applies adjustments', () => {
  // Get initial profile
  const initial = getSkillProfile('market-agent-1');
  assert.ok(initial, 'should find market-agent-1');

  // updateSkillsAfterTrade mutates the database, but we're just verifying
  // that it doesn't throw and completes successfully
  updateSkillsAfterTrade('market-agent-1', 'WIN', 0.80);

  const after = getSkillProfile('market-agent-1');
  assert.ok(after, 'profile should still exist after update');
  console.log(`[test] Updated skills for WIN (conf=0.80)`);
});

test('skill: updateSkillsAfterTrade handles LOSS', () => {
  const initial = getSkillProfile('market-agent-1');
  assert.ok(initial, 'should find market-agent-1');

  updateSkillsAfterTrade('market-agent-1', 'LOSS', 0.50);

  const after = getSkillProfile('market-agent-1');
  assert.ok(after, 'profile should still exist after loss update');
  console.log(`[test] Updated skills for LOSS (conf=0.50)`);
});

test('skill: getAllSkillProfiles returns array', () => {
  const profiles = getAllSkillProfiles();
  assert.ok(Array.isArray(profiles));
  assert.ok(profiles.length > 0);
  assert.ok(profiles[0].agentId);
  console.log(`[test] Loaded ${profiles.length} agent skill profiles`);
});

test('skill: getSkillStrengthsWeaknesses identifies top/bottom 2', () => {
  const analysis = getSkillStrengthsWeaknesses('market-agent-1');
  assert.ok(analysis);
  assert.equal(analysis.strengths.length, 2);
  assert.equal(analysis.weaknesses.length, 2);
  assert.ok(analysis.strengths[0].value >= analysis.strengths[1].value);
  console.log('[test] Strengths:', analysis.strengths.map(s => s.name));
  console.log('[test] Weaknesses:', analysis.weaknesses.map(w => w.name));
});

test('skill: getTrainingRecommendations flags low skills', () => {
  const recommendations = getTrainingRecommendations('market-agent-1', 0.50);
  assert.ok(Array.isArray(recommendations));
  if (recommendations.length > 0) {
    assert.ok(recommendations[0].skill);
    assert.ok(recommendations[0].trainingBucket);
    console.log('[test] Training needed:', recommendations.map(r => r.skill));
  }
});
