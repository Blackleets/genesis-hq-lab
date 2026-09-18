# Adding a Read-Only Market Adapter

Genesis market adapters should make data **more observable**, not make execution easier by accident.

## Required boundary

A read-only adapter must not require or expose:

- private keys;
- seed phrases;
- withdrawal permissions;
- order-placement methods;
- signing callbacks.

Public API keys used only for read access should still remain in environment variables and must never be committed.

## Recommended output

Return a normalized object with enough information to prove provenance:

```js
{
  provider: 'example',
  instrument: 'BTC-USD',
  source: 'public_orderbook_v1',
  time: 1789732800000,
  // raw/minimally transformed market fields...
}
```

Then durable capture can add:

```js
{
  schemaVersion: 1,
  mode: 'RESEARCH_ONLY',
  capturedAt: new Date().toISOString(),
  sourceAgeMs: ...,
  provenance: ...,
  features: ...
}
```

See [EVIDENCE_SCHEMA.md](./EVIDENCE_SCHEMA.md).

## Network rules

Adapters should:

- use bounded timeouts;
- make HTTP/provider failures explicit;
- respect provider rate limits;
- reject malformed responses;
- preserve provider timestamps;
- avoid silently falling back to stale cached values unless the fallback is explicitly labeled.

## Freshness

Do not use request completion time as source time.

Correct:

```text
exchange timestamp -> source time
local observation -> capturedAt
capturedAt - source time -> sourceAgeMs
```

If the source timestamp is in the future relative to capture, fail closed.

## Numeric parsing

Do not rely on `Number(value)` alone for nullable evidence.

JavaScript examples:

```js
Number(null) // 0
Number('')   // 0
```

For market evidence, those conversions can manufacture fake zeros.

Reject null/undefined/empty strings before numeric coercion.

## Provenance

Include enough detail to distinguish materially different data definitions.

Examples:

- recent trades vs history trades;
- 60-second fixed window vs last N trades;
- consolidated book vs venue-native book;
- requested book depth;
- block/slot number;
- same-block quote identity.

## Tests

Use an injected `fetchImpl` or equivalent when practical so network behavior can be tested deterministically.

Minimum cases:

- valid response;
- HTTP failure;
- malformed payload;
- missing timestamp;
- stale/future timestamp at capture layer;
- null/empty numeric fields;
- provider-specific edge case.

## Keep adapters small

Prefer:

```text
network adapter
     ↓
normalization
     ↓
pure feature derivation
     ↓
durable capture
```

Do not combine network fetching, strategy decisions and execution in one function.

## Promotion boundary

Adding a new venue for **data** is not approval to add the same venue for **execution**.

Any future execution connector requires a separate explicit review of:

- authentication;
- signing;
- permissions;
- order lifecycle;
- reconciliation;
- risk limits;
- failure semantics.
