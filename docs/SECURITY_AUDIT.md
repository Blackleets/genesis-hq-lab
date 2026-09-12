# Security Audit — Wallet-Connect Multi-Tenant Layer

**Fecha:** 2026-08-24
**Alcance:** Tasks 1-7 del plan `.hermes/plans/2026-08-23_230000-wallet-auth-multitenant-security.md`
**Entorno auditado:** producción `https://genesis-hq-lab-real.vercel.app` + código fuente
**Método:** checklist adversarial del plan, ejecutado contra el deploy real

## Resultados

| # | Prueba adversarial | Resultado |
|---|---|---|
| 1 | `GET /api/genesis/live` SIN token | ✅ 401 unauthorized |
| 2 | Flujo nonce: mensaje SIWES legible con leyenda "Esta firma NO autoriza transacciones ni transferencias" | ✅ Presente en cada challenge |
| 3 | `/api/auth/verify` con firma inválida (`0xdeadbeef`) | ✅ Rechazado (invalid signature) |
| 4 | Rate limit: 15 requests rápidas a nonce | ✅ 9×200 → luego 429 (bloqueo activo) |
| 5 | Grep adversarial de firmas peligrosas (`signTypedData`, `sendTransaction`, `writeContract`, `approve`) en todo `src/` | ✅ LIMPIO — cero ocurrencias funcionales; la única firma es `personal_sign` del mensaje backend |
| 6 | Reutilización de nonce ya consumido | ✅ Rechazado (one-shot verificado) |
| 7 | JWT manipulado (payload alterado sin refirmar) | ✅ 401 |

## Verificaciones estructurales

- **Sesión solo en sessionStorage** (muere con la pestaña). Cero localStorage. Verificado por grep.
- **Filtrado tenant centralizado**: `api/_lib/sessionAuth.js` → `tenantFilter()`. User ve únicamente bots con `ownerHash === sha256(addr).slice(0,16)`; operator ve todo en modo lectura.
- **Roles**: `OPERATOR_ADDRESSES` env var (case-insensitive). Sin env configurada, todos son 'user'.
- **Nonce store**: in-memory, TTL 5 min, un-solo-uso, consumido al verificar.
- **JWT**: HS256 vía `jose`, secreto de `AUTH_JWT_SECRET`; sin env → secreto efímero por proceso + WARNING logueado (dev-only; en prod Vercel configurar la env var).

## Hallazgos y recomendaciones

1. **[MEDIO] Nonce store in-memory se resetea en cold starts de Vercel** → impacto: usuario debe reintentar login tras un deploy. Mitigación futura: Upstash Redis (fase 2). No es explotable para escalar privilegios.
2. **[BAJO] AUTH_JWT_SECRET efímero en dev** → sesiones inválidas entre reinicios si no se configura. En producción Vercel definir la env var (acción del operador).
3. **[INFO] Datos legacy sin ownerHash** solo visibles para operator ✓ — los usuarios nuevos ven lista vacía honesta hasta tener bot propio.

## Declaración de no-custodia

El sistema NUNCA solicita ni maneja llaves privadas, seeds ni fondos. La única interacción criptográfica con la wallet del usuario es una firma EIP-191 `personal_sign` de un mensaje de texto generado por el backend para autenticar. No existen endpoints de transferencia, approve o escritura cross-tenant.

**Veredicto: APROBADO para uso con onboarding por whitelist.** Abrir onboarding público después de rotar `AUTH_JWT_SECRET` como env var de Vercel.
