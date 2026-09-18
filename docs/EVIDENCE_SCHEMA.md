# Durable Evidence Schema

Genesis treats evidence as a first-class research artifact.

A durable observation should be sufficient to answer:

- **what** was observed;
- **where** it came from;
- **when** the source said it existed;
- **when** Genesis captured it;
- **how old** the source data was;
- **whether** the observation was complete and admissible;
- **which version** of the schema produced it;
- **which features** were derived from it.

Missing evidence is not equivalent to zero.

## Minimum durable shape

Different research lanes may add fields, but a durable observation should preserve this structure or an equivalent one:

```json
{
  "schemaVersion": 1,
  "mode": "RESEARCH_ONLY",
  "provider": "example_exchange",
  "symbol": "BTC-USD",
  "capturedAt": "2026-09-18T12:00:00.500Z",
  "sourceAsOf": "2026-09-18T12:00:00.000Z",
  "sourceAgeMs": 500,
  "provenance": {
    "endpoint": "public/read-only",
    "definition": "EXAMPLE_FIXED_WINDOW_V1"
  },
  "integrity": {
    "safeForResearch": true,
    "missingFields": [],
    "staleFields": [],
    "futureFields": []
  },
  "features": {
    "exampleFeature": 0.42
  }
}
```

> The example above is **synthetic documentation data**, not market evidence.

## Required concepts

### `schemaVersion`

Integer version for the durable record shape.

A change that alters interpretation of stored evidence should bump the schema version or preserve backward-compatible parsing explicitly.

Do not silently reinterpret historical rows.

### `mode`

Use an explicit research/execution state such as:

- `RESEARCH_ONLY`
- `SHADOW`
- `PAPER`

Do not label a hypothetical or simulated record as live execution.

### Provider and instrument identity

Persist enough identity to distinguish:

- venue/provider;
- instrument;
- market type if ambiguous;
- network/chain where relevant.

### `capturedAt`

Wall-clock time when Genesis created the durable observation.

Use an ISO-8601 UTC timestamp where practical.

### Source timestamp

The source timestamp may appear as `sourceAsOf`, a provider-specific timestamp, or a structured map of timestamps.

It must represent when the external data existed, not when Genesis finished processing it.

### `sourceAgeMs`

Where a single source age is meaningful:

```text
sourceAgeMs = capturedAt - sourceAsOf
```

For multi-source observations, persist age per source.

A future source timestamp is an integrity error, not a negative age to clamp away.

### `provenance`

Provenance should make a feature reproducible.

Useful fields include:

- endpoint or source family;
- aggregation/window definition;
- requested depth;
- fixed-window size;
- coverage ratio;
- pagination policy;
- provider-native identifiers.

### `integrity`

Integrity fields should describe why a row is or is not admissible.

Typical checks:

- missing sources;
- stale sources;
- future timestamps;
- malformed values;
- incomplete coverage;
- provider mismatch;
- incompatible schema;
- contradictory identity.

### `features`

Features should be derived only from information available at the observation timestamp.

If a feature is unknown, use `null` or omit it according to the schema contract.

Do **not** encode unknown numeric evidence as `0`.

## Multi-source example

A synchronized observation may need per-source timestamps:

```json
{
  "schemaVersion": 6,
  "mode": "RESEARCH_ONLY",
  "provider": "example",
  "symbol": "BTCUSDT",
  "capturedAt": "2026-09-18T12:00:05.000Z",
  "sourceAsOf": {
    "taker": 1789732804000,
    "funding": 1789732800000,
    "reference": 1789732803000
  },
  "sourceAgeMs": {
    "taker": 1000,
    "funding": 5000,
    "reference": 2000
  },
  "provenance": {
    "takerDefinition": "EXAMPLE_FIXED_60S_V1",
    "fixedWindowTakerFlow": true,
    "takerWindowMs": 60000,
    "takerWindowCoverageMs": 59000
  },
  "integrity": {
    "missingSources": [],
    "futureSources": [],
    "staleSources": [],
    "noFutureData": true,
    "allSourcesFresh": true
  },
  "features": {
    "takerBias": 1.21,
    "premiumNowBps": -1.4
  }
}
```

This example is also synthetic.

## JSONL tapes

For append-only research evidence, Genesis commonly uses JSON Lines:

```text
one JSON object
one JSON object
one JSON object
```

Rules:

1. one complete object per line;
2. append rather than rewrite when the tape represents chronological evidence;
3. preserve timestamps and schema version;
4. parsing failures should be visible in validation/reporting when material;
5. do not mutate historical rows to make a later strategy look better.

## Evidence admissibility

A durable row can exist but still be inadmissible for a specific study.

A study may require:

- minimum schema version;
- a specific provenance definition;
- fixed-window coverage;
- freshness limits;
- synchronized sources;
- minimum book depth;
- no future data.

This is intentional.

**Storage eligibility is not the same as research eligibility.**

## Forward outcomes

Forward returns, markouts or later labels should be stored or computed separately from the decision-time feature set.

The decision record must not gain future fields retroactively.

Conceptually:

```text
decision-time evidence
        +
later matured observation
        ↓
forward outcome
```

not:

```text
decision-time row containing future result
```

## Null policy

Use this mental model:

| Value | Meaning |
|---|---|
| `0` | measured zero |
| `null` | unknown / unavailable / inadmissible |
| missing field | unsupported or absent under that schema |
| negative value | only valid when the domain permits it |

Genesis has already caught a real JavaScript failure mode where `Number(null)` becomes `0`. New parsers should explicitly reject null/empty numeric evidence before coercion.

## Contributor checklist

When adding a durable evidence source:

- [ ] schema version is explicit;
- [ ] provider/instrument identity is explicit;
- [ ] source timestamp is preserved;
- [ ] capture timestamp is preserved;
- [ ] freshness can be calculated;
- [ ] provenance can reproduce the feature definition;
- [ ] unknown values remain unknown;
- [ ] future timestamps fail closed;
- [ ] tests include malformed and stale evidence;
- [ ] no real-money execution authority is introduced.

See also [RESEARCH_PRINCIPLES.md](./RESEARCH_PRINCIPLES.md).
