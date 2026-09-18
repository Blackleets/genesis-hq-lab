# Security Policy

## Supported branch

Security fixes should target the current default development branch through a dedicated feature/fix branch. Do not work directly on the default branch.

## Reporting a vulnerability

For vulnerabilities involving secrets, authentication, signing, wallet access, execution authority or sensitive infrastructure, do **not** post active exploit details or credentials in a public issue.

Contact the repository owner privately through their GitHub profile / established private project channel and include:

- affected component;
- impact;
- reproduction steps;
- whether credentials or signing authority are involved;
- suggested mitigation if known.

## Never include

- seed phrases;
- private keys;
- exchange API secrets;
- Supabase service keys;
- bot tokens;
- `.env` contents;
- active bearer tokens.

If a secret is found in repository history, follow `AGENTS.md`: do not rewrite history or force-push without explicit owner approval.

## Trading safety

A security report should treat accidental expansion of execution authority as a security issue.

Examples:

- a read-only adapter can sign;
- a paper path reaches a real order endpoint;
- missing auth permits state-changing actions;
- a fail-open condition converts unknown risk/cost data into a candidate;
- UI reports a paper fill as a confirmed external fill.

Genesis prefers fail-closed behavior.
