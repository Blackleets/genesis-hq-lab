# SkillOpt Integration — Genesis HQ Learning Engine

> SkillOpt (Microsoft): a text-space optimizer that trains reusable natural-language
> skills for **frozen** LLM agents via trajectory-driven edits, validation-gated updates,
> and deployable `best_skill.md` artifacts. We use it as the learning engine of Genesis HQ.
> No model fine-tuning. We optimize the **prompts/skills**, not the weights.

## The constraint that defines everything

SkillOpt validates skill edits against a **held-out set with ground truth**.
For prediction markets, ground truth = **resolved market outcome** — which arrives in
days/weeks, not minutes. So the bottleneck is **labeled trajectory accumulation**, not
the optimizer. This dictates the phasing:

- You cannot meaningfully optimize a skill until you have ~50+ resolved trades per agent.
- Until then, the system **collects trajectories** and uses the existing cheap learning
  loop (`learningEngine.mjs` lessons + `mistakePrevention.mjs` vetoes).
- SkillOpt is a **weekly offline job**, not a runtime dependency.

---

## 1. SYSTEM ARCHITECTURE

Two clocks. Runtime never blocks on learning.

```
┌──────────────────────────  RUNTIME (every 5 min, continuous)  ──────────────────────────┐
│                                                                                          │
│   agentRunner → workflow.mjs (SCAN→QUALIFY→DEBATE→SIZE→EXECUTE)                          │
│                      │                                                                   │
│                      ├── loads skills/<agent>/best_skill.md  ← deployed skill (frozen)   │
│                      ├── logs trajectory to SQLite (trades + debate + signals)           │
│                      └── learningEngine generates lessons (cheap, immediate)             │
│                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
                       │ trajectories accumulate in SQLite
                       ▼
┌────────────────────  LEARNING (weekly offline job: `npm run skillopt`)  ──────────────────┐
│                                                                                          │
│   1. EXPORT   exportTrajectories.mjs → data/skillopt/<agent>/{train,val,test}/items.json │
│   2. OPTIMIZE SkillOpt proposes edits to skill.md from failure trajectories              │
│   3. VALIDATE candidate skill replays val set → metrics (Brier, win-rate, calibration)   │
│   4. GATE     accept only if Δmetric ≥ threshold AND no regression on safety checks      │
│   5. SNAPSHOT skills/<agent>/skill_vNNNN.md  +  best_skill.md  (git-versioned)           │
│   6. APPROVE  auto-deploy if gate passed + founder-notified; else stays as candidate     │
│                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Where learning happens:** offline, on accumulated SQLite trajectories.
**When skills update:** only after passing the validation gate (weekly cadence).
**Rollback:** every version is a file (`skill_vNNNN.md`) in git + a row in `skill_versions`.
Revert = copy the previous version back to `best_skill.md` and log the reason.
**Approval:** automatic when the gate passes; **founder veto** via a pending-approval flag
for any skill touching risk limits (hard constraints never auto-relax).

---

## 2. AGENT SKILL SYSTEM

A "skill" = the **natural-language decision policy** an agent loads at runtime. Today these
are inline prompts in `debateRoom.mjs`, `decisionEngine.mjs`, `intentParser.mjs`. We extract
them to files so SkillOpt can optimize them.

```
skills/
├── polymarket_agent/
│   ├── best_skill.md          # deployed (runtime loads this)
│   ├── skill_v0001.md         # snapshots (immutable history)
│   ├── skill_v0002.md
│   └── meta.json              # { version, deployed_at, metrics, parent }
├── kalshi_agent/
├── risk_agent/
├── marketing_agent/
└── research_agent/
```

### skill.md structure (the format SkillOpt edits)

```markdown
---
agent: polymarket_agent
version: 7
parent: 6
created: 2026-06-15
metrics: { brier: 0.182, win_rate: 0.58, calibration: 0.71, n: 64 }
status: deployed
---

# ROLE
You are the prediction-market trader for Genesis HQ. Paper trading only.

# DECISION CRITERIA            ← SkillOpt edits THIS section from trajectories
- Trade only when confidence ≥ 0.65 and ≥ 2 independent signals agree.
- Prefer markets resolving in ≤ 30 days (learned: long-horizon = higher Brier).
- Down-weight volume spikes < 24h old (learned v5: pump-and-dump false signal).
- When research sentiment contradicts price by > 20pts, SKIP (learned v6).

# EVIDENCE CHECKLIST           ← evolves as agent learns what evidence works
1. Price vs implied probability edge
2. 24h volume relative to total (liquidity real, not wash)
3. News sentiment (newsFeed) agreement
4. No matching mistake_pattern in memory

# HARD CONSTRAINTS (NEVER EDIT — locked by validator)
- Max 5% capital per trade. Max 5 open. Paper only. Min confidence 0.65.
```

### Versioning & rollback
- **File-level:** each version is an immutable `skill_vNNNN.md`, committed to git.
- **DB-level:** new table `skill_versions` (agent_id, version, file_path, metrics_json,
  status, deployed_at, parent_version, reason). Single source of truth for "what's live."
- **Rollback:** `revertSkill(agentId, toVersion)` copies that file to `best_skill.md`,
  flips `status`, logs reason. Runtime picks it up next tick (skills are read fresh).
- **HARD CONSTRAINTS block** is fenced — the validator rejects any candidate that mutates
  it. Agents cannot loosen their own risk limits. Ever.

---

## 3. LEARNING LOOP

```
OBSERVE    market data + research signals (workflow stepScan/stepDebate)
   ↓
ACT        debate → decision → paper trade (logged with thesis, confidence, evidence)
   ↓
RESULT     market resolves → closeTrade → pnl, won/lost  (the GROUND TRUTH)
   ↓
REFLECT    learningEngine.analyzeClosedTrade → why_failed / signal_wrong / what_change
   ↓        (cheap, immediate — already built)
   │
   │  ……… trajectories accumulate until N ≥ 50 resolved per agent ………
   ▼
PROPOSE    SkillOpt reads failure trajectories → drafts edits to skill.md DECISION CRITERIA
   ↓
VALIDATE   replay candidate skill over held-out resolved markets (val split)
   ↓
BENCHMARK  Brier ↓?  win-rate ↑?  calibration ↑?  vs current best_skill.md
   ↓
GATE       accept iff (Brier improves ≥ 0.01) AND (no safety regression) AND (n_val ≥ 20)
   ↓
DEPLOY     best_skill.md ← candidate ; snapshot old ; notify founder
   or
REJECT     keep current ; log candidate + why it failed the gate
```

**Exact gate logic (cheap, deterministic):**
```
accept = (candidate.brier <= current.brier - 0.01)        # must improve calibration
       && (candidate.win_rate >= current.win_rate - 0.02) # may not crater win-rate
       && (candidate.hard_constraints == current.hard_constraints)  # immutable
       && (val_n >= 20)                                    # enough ground truth
       && (no_new_max_drawdown_breach)
```

---

## 4. PAPER TRADING INTEGRATION → TRAJECTORIES

Already logged per trade (in `trades` table): thesis (`reason`), `confidence`, `evidence`,
`outcome`, `resolved_outcome`, `pnl`, plus `lessons` rows (`why_failed`, `signal_wrong`,
`what_change`, `new_rule`). This **is** the trajectory. We export it to SkillOpt format:

```
data/skillopt/polymarket_agent/
├── train/items.json    # 70% of resolved trades — used to propose edits
├── val/items.json      # 15% — used to gate (accept/reject)
└── test/items.json     # 15% — final unbiased report (never used for selection)
```

Each item (one resolved trade = one labeled example):
```json
{
  "id": "trade-794b3f9d",
  "input": {
    "question": "Will PSG win the 2025–26 Champions League?",
    "yes_price": 0.575, "volume_24h": 1028657, "days_to_close": 27,
    "signals": ["BULLISH PSG (0.95)"],
    "category": "soccer"
  },
  "agent_action": { "outcome": "YES", "confidence": 0.62,
                    "evidence": ["volume>threshold","price in edge range"] },
  "ground_truth": { "resolved": "YES", "pnl": 36.9, "correct": true },
  "reflection": "Volume signal aligned with resolution; confidence was well-calibrated."
}
```

**What SkillOpt decides to improve:** it reads the **losing** trajectories, finds patterns
the current skill missed (e.g., "all losses were markets with <$10k liquidity that looked
high-volume"), and proposes a new line in DECISION CRITERIA. The val split confirms it
actually helps before deploy.

**Anti-gambling is structural, not optional:** the optimizer's objective is **Brier score
(calibration) first, win-rate second** — never raw PnL. A skill that "wins big but is
overconfident" scores worse than one that's accurate and disciplined. Hard constraints
(max 5% per trade, max 5 open, daily limit) live in the locked block and are never subject
to optimization.

---

## 5. VALIDATION SYSTEM

Agents **cannot** rewrite themselves blindly. Three independent gates:

```
SkillOpt proposes candidate skill_vNNNN.md
        ↓
[GATE 1] STATIC VALIDATOR  (validateSkill.mjs — no LLM, deterministic)
        • HARD CONSTRAINTS block byte-identical to current?  else REJECT
        • All numeric limits within constitution bounds?     else REJECT
        • Skill parses (frontmatter + required sections)?    else REJECT
        ↓
[GATE 2] BENCHMARK REPLAY  (replay val split with candidate vs current)
        • Brier, win-rate, calibration on held-out resolved markets
        • Candidate must beat current by threshold (section 3)
        ↓
[GATE 3] VALIDATOR AGENT   (1 cheap Claude call — optional, sanity)
        • "Does this edit contradict any active lesson or founder order?" → veto
        ↓
   APPROVE → deploy + snapshot      REJECT → keep current + log
```

**Regression prevention:** the **test split** is replayed after deploy as an unbiased
report. If live metrics over the next week regress vs the deployed prediction, an
auto-rollback trigger fires (`liveMetric.brier > deployed.brier + 0.03 over n≥15` → revert
to parent version). **No self-destruction loop:** a candidate that fails the gate is logged
and discarded; the agent keeps running the last-good skill. Optimization can fail safely
forever and the agent never degrades below its last validated version.

---

## 6. MEMORY INTEGRATION

SkillOpt does not replace the memory engine — it **consumes** it.

| Memory source (existing)            | Feeds SkillOpt as…                          |
|-------------------------------------|---------------------------------------------|
| `trades` (resolved)                 | Labeled trajectories (train/val/test)       |
| `lessons` (why_failed, new_rule)    | Edit hints — what the skill should address  |
| `mistake_patterns`                  | Negative constraints baked into skill.md    |
| `signals` (proved_correct)          | Which evidence types to up/down-weight      |
| `founder_orders`                    | Hard guardrails the validator enforces      |
| `team_memory` (debates)             | Bull/Bear arguments that preceded losses    |

**Avoiding repeated mistakes:** when SkillOpt proposes a skill edit, it must cite the
`lesson_id`s it resolves. After deploy, those lessons are marked `validated=1`. If the same
mistake recurs post-deploy, `times_prevented_loss` doesn't increment → flags the edit as
ineffective → eligible for rollback. The loop closes: a mistake either becomes a skill rule
that demonstrably prevents recurrence, or it's surfaced as still-unsolved.

---

## 7. ECONOMIC EVOLUTION

Reuses the existing `agentScoring.mjs` engine (levels, budget_pct, promotion/demotion) and
binds it to skill quality.

```
PROMOTE  (every 10 resolved trades)
  win_rate ≥ 55% AND calibration ≥ 0.60
    → level +1, budget_pct +1% (cap 15%)
    → unlock "specialization": clone the skill into a sub-skill for its best category
      e.g. polymarket_agent → polymarket_sports_agent (best_skill.md forked)

DEMOTE
  3 consecutive losses           → budget_pct ×0.8 (soft)
  win_rate < 30% after 20 trades → status='retrained', level −1
    → revert skill to last version with win_rate ≥ 45% (rollback as retraining)

CLONE  (high performer, level ≥ 4)
  fork best_skill.md → specialized variant trained only on that category's trajectories
  → two agents now compete; the lower-Brier one keeps the budget next quarter
```

Measurable rules, all backed by columns that already exist (`agent_profiles`: level,
budget_pct, win/loss, calibration_score). Skill quality **is** the economic signal — a more
profitable, better-calibrated skill earns more capital and the right to specialize.

---

## 8. MVP IMPLEMENTATION PLAN

### Phase 1 — Days 1–7 · "Make skills first-class, start logging"
Goal: extract prompts to skill.md and accumulate clean trajectories. **No SkillOpt yet.**
```
1. skills/ folder + 5 skill.md files (extract inline prompts from debateRoom etc.)
2. skillLoader.mjs — runtime loads skills/<agent>/best_skill.md (with fallback to current)
3. skill_versions table in schema.sql
4. exportTrajectories.mjs — trades+lessons → data/skillopt/<agent>/items.json
5. validateSkill.mjs — GATE 1 (static, no LLM): hard-constraints + parse checks
```
Deliverable: agents run from skill.md files; trajectories export cleanly. Zero new cost.

### Phase 2 — Days 8–30 · "First optimization loop"
Goal: run SkillOpt offline once enough trades resolve (~50+).
```
6. npm run skillopt — wraps python scripts/train.py per agent
   - optimizer_model: cheapest capable (Claude Haiku or local Ollama for edit drafting)
   - target_model: Claude Haiku (already the runtime model)
7. benchmarkReplay.mjs — GATE 2: replay val split, compute Brier/win-rate/calibration
8. Auto-deploy on gate pass + founder notification (pending-approval for risk edits)
9. Wire skill_versions into /api/agent/skills for the dashboard
```
Deliverable: first validated skill upgrade deployed for polymarket_agent. Cost: one weekly
optimizer run (~$1–3 if Claude; ~$0 if local Ollama for the edit step).

### Phase 3 — Days 31–90 · "Multi-agent evolution"
Goal: all 5 agents on the loop; economic evolution active.
```
10. Roll loop out to kalshi, risk, marketing, research agents
11. Auto-rollback trigger on live-metric regression (GATE 3 + drift watch)
12. Specialization/cloning for level ≥ 4 agents (category-forked skills)
13. Cross-agent skill sharing: a lesson learned by polymarket_agent that applies to
    kalshi_agent is offered as a candidate edit (validated independently)
```
Deliverable: agents measurably improve week-over-week (Brier trending down), best performers
specialize, poor skills auto-roll-back. Continuous improvement without fine-tuning.

---

## Cost reality (founder budget)

| Component                | Cost                                             |
|--------------------------|--------------------------------------------------|
| Runtime (Haiku debates)  | ~$2–3/mo (already in budget)                      |
| SkillOpt optimizer       | weekly job; Haiku ~$1–3/run, or **$0 with Ollama**|
| Trajectory storage       | SQLite, $0                                        |
| Validation replay        | reuses logged data + Haiku target, ~$0.50/run     |
| **Total added**          | **~$4–12/mo**, or near-$0 if optimizer runs local |

SkillOpt defaults to Azure OpenAI / gpt-5.5 — **we override** `--optimizer_model` to Haiku
or a local Ollama model. The target model stays Haiku (what runtime already uses). The
expensive part of SkillOpt (large-scale epochs) is unnecessary here: we run small batches
weekly on real trajectories, not big synthetic datasets.

## What NOT to build
- ❌ Real-time skill updates (offline weekly is correct — ground truth is slow)
- ❌ GPU / fine-tuning anything (the entire point is frozen models)
- ❌ Optimizing hard constraints (locked block, never)
- ❌ SkillOpt for agents without ground truth yet (marketing has no "resolved outcome" —
      use engagement metrics as a weaker label only in Phase 3)
- ❌ Auto-deploy of risk-touching edits without founder approval
