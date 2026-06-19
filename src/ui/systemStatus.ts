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

  if (truth.execution?.startupReconciliation?.safeMode) {
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

  if (!truth.execution?.agentAlive) {
    return {
      tone: 'warn',
      label: {
        es: 'Backend online - runner estancado',
        en: 'Backend online - runner stalled',
      },
      detail: {
        es: 'La API responde, pero el runner no hace tick hace mas de 10 minutos.',
        en: 'The API responds, but the runner has not ticked in more than 10 minutes.',
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
