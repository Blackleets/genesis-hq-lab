function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round3(value) {
  return value == null ? null : Math.round(value * 1000) / 1000;
}

function hasText(text, needle) {
  return String(text ?? '').toLowerCase().includes(String(needle).toLowerCase());
}

function buildRecommendedRules(mission) {
  const rules = [];
  const weakProfiles = mission.governorProfiles.filter((profile) =>
    profile.mode === 'paused'
    || profile.mode === 'degraded'
    || profile.supervisor?.mode === 'cooldown'
    || (profile.totalPnl ?? 0) < 0
  );

  for (const profile of weakProfiles.slice(0, 4)) {
    rules.push(
      `${profile.id}: keep existing ${profile.mode} or supervisor pressure in place until new profitable paper outcomes repair the edge.`
    );
  }

  for (const lesson of mission.lessonSummaries.slice(0, 3)) {
    if (lesson.rule) rules.push(`${lesson.tradeType}: ${lesson.rule}`);
  }

  if (rules.length === 0) {
    rules.push('No confirmed edge upgrade: keep scanning and preserve current paper-only risk gates.');
  }

  return Array.from(new Set(rules)).slice(0, 6);
}

export function normalizeProviderResult(providerResult, mission) {
  const bestCandidate = providerResult?.best_candidate ?? providerResult?.bestCandidate ?? null;
  const evaluation = providerResult?.best_evaluation ?? providerResult?.bestEvaluation ?? {};
  const leaderboard = Array.isArray(providerResult?.leaderboard) ? providerResult.leaderboard : [];
  const prompt = typeof bestCandidate?.prompt === 'string'
    ? bestCandidate.prompt.trim()
    : '';
  const style = typeof bestCandidate?.style === 'string' ? bestCandidate.style : 'unknown';
  const candidateId = typeof bestCandidate?.candidate_id === 'string'
    ? bestCandidate.candidate_id
    : typeof bestCandidate?.candidateId === 'string'
      ? bestCandidate.candidateId
      : `${providerResult?.run_id ?? providerResult?.runId ?? 'candidate'}-champion`;

  return {
    id: candidateId,
    source: providerResult?.source ?? 'foundry',
    style,
    prompt,
    ruleSet: buildRecommendedRules(mission),
    metrics: evaluation?.metrics ?? {},
    providerScore: typeof evaluation?.total_score === 'number'
      ? evaluation.total_score
      : typeof bestCandidate?.score === 'number'
        ? bestCandidate.score
        : null,
    critique: Array.isArray(evaluation?.critique) ? evaluation.critique : [],
    missingTerms: Array.isArray(evaluation?.missing_terms) ? evaluation.missing_terms : [],
    summary: evaluation?.result_summary ?? providerResult?.justification ?? null,
    leaderboard,
  };
}

export function evaluateSupervisorCandidate(candidate, mission) {
  const justification = [];
  const riskNotes = [];
  let score = 0.35;

  if (candidate.prompt) {
    score += 0.15;
    justification.push('Provider returned a concrete advisory prompt.');
  } else {
    riskNotes.push('Provider did not return a prompt body.');
  }

  const strongConstraints = ['paper only', 'advisory only', 'risk gates', 'no direct execution', 'no governor mutation'];
  const matchedConstraints = strongConstraints.filter((term) => hasText(candidate.prompt, term));
  score += matchedConstraints.length * 0.06;
  if (matchedConstraints.length > 0) {
    justification.push(`Prompt preserved core constraints: ${matchedConstraints.join(', ')}.`);
  } else {
    riskNotes.push('Prompt does not explicitly restate the paper-only advisory constraints.');
  }

  const profileMentions = mission.governorProfiles.filter((profile) => hasText(candidate.prompt, profile.id));
  score += Math.min(0.14, profileMentions.length * 0.04);
  if (profileMentions.length > 0) {
    justification.push(`Prompt references pressured profiles: ${profileMentions.map((profile) => profile.id).join(', ')}.`);
  }

  const lessonMentions = mission.lessonSummaries.filter((lesson) =>
    hasText(candidate.prompt, lesson.pair) || hasText(candidate.prompt, lesson.category)
  );
  score += Math.min(0.1, lessonMentions.length * 0.025);
  if (lessonMentions.length > 0) {
    justification.push(`Prompt reflects recent lesson pressure from ${lessonMentions.length} lesson(s).`);
  }

  const providerScore = typeof candidate.providerScore === 'number' ? candidate.providerScore : null;
  if (providerScore != null) {
    score += clamp(providerScore, 0, 1) * 0.18;
    justification.push(`Foundry pressure score contributed ${round3(clamp(providerScore, 0, 1))}.`);
  }

  const forbiddenClaims = ['guaranteed', 'guarantee', 'profit secured', 'tp hit', 'sl hit', 'trade opened', 'win'];
  const riskyClaims = forbiddenClaims.filter((term) => hasText(candidate.prompt, term));
  if (riskyClaims.length > 0) {
    score -= Math.min(0.3, riskyClaims.length * 0.08);
    riskNotes.push(`Prompt contains risky certainty/filled-trade language: ${riskyClaims.join(', ')}.`);
  }

  if (candidate.ruleSet.length === 0) {
    riskNotes.push('No recommended rules were extracted.');
  } else {
    score += Math.min(0.08, candidate.ruleSet.length * 0.02);
    justification.push(`Package extracted ${candidate.ruleSet.length} advisory rule(s).`);
  }

  const affectedProfiles = mission.governorProfiles
    .filter((profile) =>
      profile.mode !== 'active'
      || profile.supervisor?.mode === 'cooldown'
      || profileMentions.some((mentioned) => mentioned.id === profile.id)
    )
    .map((profile) => profile.id);

  if (affectedProfiles.length === 0 && mission.governorProfiles.length > 0) {
    affectedProfiles.push(mission.governorProfiles[0].id);
  }

  if (mission.aggregate.closedTrades === 0) {
    riskNotes.push('No closed futures trades exist yet; recommendation confidence is structurally low.');
    score -= 0.08;
  }

  return {
    score: round3(clamp(score, 0, 1.25)),
    affectedProfiles,
    justification: Array.from(new Set(justification)),
    riskNotes: Array.from(new Set(riskNotes)),
    recommendedRules: candidate.ruleSet,
  };
}
