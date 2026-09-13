# Arbitrage Competition Observability

This layer measures how pre-capture-ready arbitrage opportunities behave across observations without pretending those measurements are execution or inclusion probabilities.

## What is measured

For routes that have already passed every gate except capture/inclusion evidence, Genesis tracks:

- whether the same route survives into the next observation/block
- how many consecutive observations it persists
- how much net edge decays while it survives
- how many pre-capture-ready routes are currently active

These are descriptive competition signals only.

## What is deliberately not inferred

Genesis does **not** convert opportunity persistence into:

- inclusion probability
- builder acceptance probability
- realized capture probability
- realized PnL

Those require execution-side evidence that SHADOW mode does not possess.

## Fail-closed capture boundary

The institutional evaluator creates three capture-related blockers when inclusion evidence is unknown:

- `inclusionProbabilityKnown`
- `inclusionProbability`
- `expectedNetPositive`

The readiness classifier treats those as the remaining capture boundary only after atomic simulation, liquidity, cost, freshness and stress gates have already passed.

Any other blocker keeps the route out of pre-capture readiness.

## Telemetry

The worker publishes compact competition telemetry through the existing heartbeat/public snapshot:

- `competitionTransitionsObserved`
- `nextObservationSurvivalRate`
- `medianSurvivingEdgeDecayBps`
- `activePreCaptureRoutes`

No new product version label is added. The dashboard remains **Arbitrage Radar**.

## Safety invariants

- `mode=SHADOW`
- `executionAuthority=false`
- no wallet/private key
- no signing
- no transaction broadcast
- no LIVE unlock
- no synthetic inclusion probability
- v9 / ratchet / TP/SL / sizing remain unchanged

## Interpretation

A route that survives several blocks with modest edge decay is potentially easier to capture than a one-observation spike, but that statement is a research hypothesis, not proof of execution success.

The next real evidence boundary is builder/executor-side capture data obtained under a separately reviewed micro-live protocol. Until then, the system remains SHADOW-only.
