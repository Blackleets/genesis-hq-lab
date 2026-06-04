// Genesis HQ conversation script (visual lab, bilingual).
// Plays in a loop. Only the 5 active agents speak.
// Lines are written from the perspective of an early-stage Genesis that
// is just starting, hasn't hired the future agents yet, and is mostly
// running on seed data.

export interface ConversationEvent {
  agentId: string;
  text: { es: string; en: string };
  /** ms the bubble stays visible */
  duration?: number;
}

export const CONVERSATION_SCRIPT: ConversationEvent[] = [
  {
    agentId: 'visual-genesis-core',
    text: {
      es: 'Escáner de mercado, revisa oportunidades visuales.',
      en: 'Market Scanner, review visual opportunities.',
    },
    duration: 5000,
  },
  {
    agentId: 'visual-market-scanner',
    text: {
      es: 'Entendido. Estoy observando datos semilla.',
      en: 'Understood. I’m reading seed data.',
    },
    duration: 5000,
  },
  {
    agentId: 'visual-risk-guardian',
    text: {
      es: 'Bloquearé cualquier acción sin evidencia.',
      en: 'I will block any action without evidence.',
    },
    duration: 5000,
  },
  {
    agentId: 'visual-memory-curator',
    text: {
      es: 'Archivando aprendizaje visual.',
      en: 'Archiving visual learning.',
    },
    duration: 4500,
  },
  {
    agentId: 'visual-hr-evaluator',
    text: {
      es: 'Recomiendo contratar al Agente de Debate más adelante.',
      en: 'I recommend hiring the Debate Agent later.',
    },
    duration: 5000,
  },
  {
    agentId: 'visual-genesis-core',
    text: {
      es: 'Por ahora trabajamos con cinco agentes.',
      en: 'For now we operate with five agents.',
    },
    duration: 4500,
  },
  {
    agentId: 'visual-risk-guardian',
    text: {
      es: 'Detectada exposición elevada en datos semilla.',
      en: 'Elevated exposure detected in seed data.',
    },
    duration: 4500,
  },
  {
    agentId: 'visual-memory-curator',
    text: {
      es: 'Guardando regla nueva en archivo.',
      en: 'Storing a new rule in the archive.',
    },
    duration: 4500,
  },
  {
    agentId: 'visual-hr-evaluator',
    text: {
      es: 'La pasante puede esperar hasta fase 11.',
      en: 'The intern can wait until phase 11.',
    },
    duration: 4500,
  },
];
