import type { SystemTruth } from '@hooks/useTruthLayer';

export type SystemStatusTone = 'live' | 'warn' | 'error' | 'muted';

export interface SystemStatusSummary {
  tone: SystemStatusTone;
  label: { es: string; en: string };
  detail: { es: string; en: string };
}

export function describeSystemStatus(truth: SystemTruth | null): SystemStatusSummary {
  if (!truth) {
    return {
      tone: 'error',
      label: {
        es: 'API offline',
        en: 'API offline',
      },
      detail: {
        es: 'No hay conexion con /api. La UI local puede seguir viva, pero sin datos reales.',
        en: 'No connection to /api. The local UI can stay alive, but without real data.',
      },
    };
  }

  if (truth.execution.startupReconciliation?.safeMode) {
    return {
      tone: 'warn',
      label: {
        es: 'Backend online - safe mode',
        en: 'Backend online - safe mode',
      },
      detail: {
        es: 'El backend responde, pero la reconciliacion bloqueo nuevas operaciones.',
        en: 'The backend is responding, but reconciliation blocked new trades.',
      },
    };
  }

  if (truth.agentRunner.neverStarted) {
    return {
      tone: 'warn',
      label: {
        es: 'Backend online - runner sin iniciar',
        en: 'Backend online - runner not started',
      },
      detail: {
        es: 'La API esta viva, pero el runner aun no hizo su primer tick.',
        en: 'The API is live, but the runner has not produced its first tick yet.',
      },
    };
  }

  if (!truth.execution.agentAlive) {
    // The production runner is the Supabase edge function, driven by a
    // best-effort cron (target ~5 min, but GitHub Actions can lag to ~1h). The
    // edge's 10-min agentAlive flag is too aggressive for that cadence, so a
    // fresh-enough heartbeat is reported calmly as "low-frequency / cron-driven"
    // rather than alarming "stalled". Only a genuinely old heartbeat is a stall.
    const ms = truth.agentRunner?.msSinceLastTick ?? null;
    const mins = ms != null ? Math.round(ms / 60_000) : null;
    const STALL_MIN = 90;
    if (mins != null && mins < STALL_MIN) {
      return {
        tone: 'muted',
        label: {
          es: 'Backend online - runner por cron',
          en: 'Backend online - cron-driven runner',
        },
        detail: {
          es: `El runner corre por cron (no es continuo). Última señal hace ${mins} min — dentro de lo esperado.`,
          en: `The runner is cron-driven (not continuous). Last tick ${mins} min ago — within the expected window.`,
        },
      };
    }
    return {
      tone: 'warn',
      label: {
        es: 'Backend online - runner estancado',
        en: 'Backend online - runner stalled',
      },
      detail: {
        es: mins != null
          ? `La API responde, pero el runner no hace tick hace ${mins} min.`
          : 'La API responde, pero el runner no ha hecho su primer tick.',
        en: mins != null
          ? `The API responds, but the runner has not ticked in ${mins} min.`
          : 'The API responds, but the runner has not produced a tick yet.',
      },
    };
  }

  if (!truth.ok) {
    return {
      tone: 'warn',
      label: {
        es: 'Backend degradado',
        en: 'Backend degraded',
      },
      detail: {
        es: 'Hay subsistemas con advertencias, aunque la ruta principal sigue arriba.',
        en: 'Some subsystems are degraded even though the main path is still up.',
      },
    };
  }

  return {
    tone: 'live',
    label: {
      es: 'Backend y runner online',
      en: 'Backend and runner online',
    },
    detail: {
      es: 'La API responde y el runner esta ticando con datos reales del sistema.',
      en: 'The API responds and the runner is ticking with real system data.',
    },
  };
}
