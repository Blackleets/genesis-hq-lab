# Genesis Vercel Deployment Policy

## Canonical production project

- Project: `genesis-hq-lab`
- Vercel Project ID: `prj_oK22OIjmXpuwM6ma7FhQViFVfwOI`
- Repository: `Blackleets/genesis-hq-lab`
- Source of truth: `main`

## Deployment rule

Automatic Vercel Git deployment remains enabled for the canonical project. `vercel.json` uses `VERCEL_PROJECT_ID` in the Ignored Build Step so the legacy project `genesis-hq-lab-real` skips builds before consuming the normal build path.

The legacy Vercel project ID is `prj_Yp21E1BsjHf1Q3bcvbxtIE7DNoEP`. It is non-canonical and must not be used as a production deployment path.

`.github/workflows/genesis-vercel-prebuilt-prod.yml` is retained as a manual emergency/prebuilt deployment path for the canonical project only. It requires `VERCEL_TOKEN`; normal production deploys do not depend on that secret because Git integration is the active path.

The research branch `capture-tape` remains excluded from Vercel Git deployment.

## Trading boundary

Deployment policy does not alter trading state. Genesis remains PAPER-only and LIVE_LOCKED until separate economic and Founder promotion gates are satisfied.
