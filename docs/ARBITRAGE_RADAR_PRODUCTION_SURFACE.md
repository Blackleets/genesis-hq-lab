# Arbitrage Radar — production surface

## Visible placement

`Arbitrage Radar` is rendered directly in the Trading workspace immediately below the founder command bar, so mobile users do not need to navigate to the Board Room to find it.

## Vercel Hobby compatibility

The project already uses 12 Vercel serverless functions on the production branch. A standalone `api/mev/radar.js` created a 13th function and caused Vercel to reject the deployment with `exceeded_serverless_functions_per_deployment`.

The radar now reuses the existing `api/genesis/context.js` function through the read-only query view:

`GET /api/genesis/context?view=arbitrage-radar`

Only the allowlisted `mev_shadow_radar_public` `org_state` row is returned. No service key, RPC credential, wallet data, signing capability, or execution authority is exposed.

## Safety boundary

- product label: `Arbitrage Radar`
- mode: `SHADOW`
- execution authority: disabled
- no wallet or private key
- no signing or broadcast
- no LIVE unlock
- no changes to futures v9, ratchet, TP/SL, sizing, or execution scheduler

If the radar provider is not configured, the component renders `Provider not configured` rather than sample data.
