# Genesis Vercel Deployment Policy

## Canonical production project

- Project: `genesis-hq-lab`
- Vercel Project ID: `prj_oK22OIjmXpuwM6ma7FhQViFVfwOI`
- Repository: `Blackleets/genesis-hq-lab`
- Source of truth: `main`

## Deployment rule

Automatic Vercel Git deployments are disabled at repository configuration level to prevent duplicate builds from multiple Vercel projects linked to the same repository.

Production deployment is performed only by `.github/workflows/genesis-vercel-prebuilt-prod.yml`, which targets the canonical project ID above, validates quant/economic safety checks, builds the application, creates a Vercel prebuilt artifact, and deploys it to production.

`genesis-hq-lab-real` is legacy/non-canonical and must not be used as a production deployment path. Its existence does not grant LIVE trading authority.

## Trading boundary

Deployment policy does not alter trading state. Genesis remains PAPER-only and LIVE_LOCKED until separate economic and Founder promotion gates are satisfied.
