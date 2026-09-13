# Arbitrage Radar production cutover boundary

This cutover is UI + SHADOW evidence only.

Allowed:
- render Arbitrage Radar on the Trading workspace
- read the allowlisted SHADOW snapshot through an existing Vercel function
- deploy the frontend and read-only evidence surface

Not allowed:
- wallet/private key integration
- transaction signing or broadcast
- builder/relay submission
- LIVE unlock
- modifying futures v9, ratchet, TP/SL, sizing, or execution scheduler

The merge is acceptable only if CI/build passes and Vercel preview deploys within the Hobby 12-function limit.
