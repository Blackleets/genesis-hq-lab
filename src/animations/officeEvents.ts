// Office Maintenance / Virtual Contractor events.
// When a zone needs improvement, Genesis Core requests an upgrade and a
// temporary "virtual contractor" appears to install it. This file is the
// seed catalogue of those events. In Phase 11+ they'll be triggered by
// real metrics; here they're a fixed visual-seed list shown in the HQ
// upgrade banner / Operations module.

export interface OfficeUpgradeEvent {
  id: string;
  zone: { es: string; en: string };
  request: { es: string; en: string };
  contractorLine: { es: string; en: string };
  hrLine: { es: string; en: string };
  state: 'requested' | 'in-progress' | 'done';
  /** zone color hint for the badge */
  color: string;
}

export const OFFICE_UPGRADES: OfficeUpgradeEvent[] = [
  {
    id: 'upg-1',
    zone: { es: 'Laboratorio de Estrategia', en: 'Strategy Lab' },
    request: {
      es: 'Génesis Core: «Necesitamos ampliar el Laboratorio de Estrategia.»',
      en: 'Genesis Core: “We need to expand Strategy Lab.”',
    },
    contractorLine: {
      es: 'Contratista virtual: «Instalando nueva estación.»',
      en: 'Virtual Contractor: “Installing a new station.”',
    },
    hrLine: {
      es: 'HR Evaluator: «Mejora registrada.»',
      en: 'HR Evaluator: “Upgrade recorded.”',
    },
    state: 'in-progress',
    color: '#22d3ee',
  },
  {
    id: 'upg-2',
    zone: { es: 'Búnker de Riesgo', en: 'Risk Bunker' },
    request: {
      es: 'Génesis Core: «Reforzar el Búnker de Riesgo.»',
      en: 'Genesis Core: “Reinforce the Risk Bunker.”',
    },
    contractorLine: {
      es: 'Contratista virtual: «Añadiendo segundo monitor de alerta.»',
      en: 'Virtual Contractor: “Adding a second alert monitor.”',
    },
    hrLine: {
      es: 'HR Evaluator: «Solicitud pendiente.»',
      en: 'HR Evaluator: “Request pending.”',
    },
    state: 'requested',
    color: '#ff4757',
  },
  {
    id: 'upg-3',
    zone: { es: 'Archivo de Memoria', en: 'Memory Archive' },
    request: {
      es: 'Memory Curator: «Necesito una estantería adicional.»',
      en: 'Memory Curator: “I need an extra bookshelf.”',
    },
    contractorLine: {
      es: 'Contratista virtual: «Instalación completada.»',
      en: 'Virtual Contractor: “Installation complete.”',
    },
    hrLine: {
      es: 'HR Evaluator: «Mejora registrada en historial.»',
      en: 'HR Evaluator: “Upgrade logged in history.”',
    },
    state: 'done',
    color: '#1f6fb0',
  },
];

/** Static visual-seed growth metrics shown in Dashboard + Progress. */
export interface GrowthMetrics {
  genesisAge: string;   // localised by caller via TKey, this is a fixed display number
  activeAgents: number;
  hiringQueue: number;
  learningLevel: number; // 0..1
  companyHealth: number; // 0..1
  tasksCompleted: number;
  agentsHired: number;
  agentsFired: number;
  officeUpgrades: number;
  modulesUnlocked: number;
}

export const SEED_METRICS: GrowthMetrics = {
  genesisAge: 'Day 1',
  activeAgents: 5,
  hiringQueue: 9,
  learningLevel: 0.12,
  companyHealth: 0.65,
  tasksCompleted: 7,
  agentsHired: 5,
  agentsFired: 0,
  officeUpgrades: 1,
  modulesUnlocked: 1, // only HQ is ready right now
};
