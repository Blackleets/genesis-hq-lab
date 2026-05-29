import type { Agent } from '../types/genesis';
import type { TaskType } from '../types/task';

export interface AgentTemplate {
  id: string;
  name: { es: string; en: string };
  role: { es: string; en: string };
  department: Agent['department'];
  archetype: Agent['visualProfile']['archetype'];
  primaryColor: string;
  accentColor: string;
  specialization: NonNullable<Agent['specialization']>;
  capabilities: TaskType[];
  startingLearningScore: number;
  description: { es: string; en: string };
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'quant-trader',
    name: { es: 'Quinn', en: 'Quinn' },
    role: { es: 'Quant Trader', en: 'Quant Trader' },
    department: 'Market Room',
    archetype: 'analyst',
    primaryColor: '#3da9fc',
    accentColor: '#00ff9c',
    specialization: 'quant',
    capabilities: ['paper_trade', 'signal_generation', 'market_scan'],
    startingLearningScore: 0.65,
    description: {
      es: 'Analiza precios de Polymarket y abre posiciones de paper trading basadas en señales estadísticas.',
      en: 'Analyzes Polymarket prices and opens paper trading positions based on statistical signals.',
    },
  },
  {
    id: 'risk-manager',
    name: { es: 'Rosa', en: 'Rosa' },
    role: { es: 'Risk Manager', en: 'Risk Manager' },
    department: 'Risk Office',
    archetype: 'guardian',
    primaryColor: '#ff4757',
    accentColor: '#ffd24a',
    specialization: 'risk',
    capabilities: ['risk_review', 'performance_review', 'paper_trade'],
    startingLearningScore: 0.70,
    description: {
      es: 'Monitorea el riesgo de posiciones abiertas y bloquea trades que excedan el límite del 5% de capital.',
      en: 'Monitors open position risk and blocks trades exceeding the 5% capital threshold.',
    },
  },
  {
    id: 'market-analyst',
    name: { es: 'Marco', en: 'Marco' },
    role: { es: 'Market Analyst', en: 'Market Analyst' },
    department: 'Strategy Lab',
    archetype: 'scientist',
    primaryColor: '#ffd24a',
    accentColor: '#3da9fc',
    specialization: 'analyst',
    capabilities: ['signal_generation', 'market_scan', 'peer_training'],
    startingLearningScore: 0.60,
    description: {
      es: 'Genera señales de compra/venta basadas en liquidez y volumen de mercados Polymarket.',
      en: 'Generates buy/sell signals based on liquidity and volume from Polymarket markets.',
    },
  },
  {
    id: 'learning-coach',
    name: { es: 'Leo', en: 'Leo' },
    role: { es: 'Learning Coach', en: 'Learning Coach' },
    department: 'Genesis HR',
    archetype: 'listener',
    primaryColor: '#22d3ee',
    accentColor: '#7c5cff',
    specialization: 'mentor',
    capabilities: ['peer_training', 'agent_training', 'performance_review'],
    startingLearningScore: 0.80,
    description: {
      es: 'Facilita sesiones de mentoría entre agentes senior y junior para acelerar el aprendizaje del equipo.',
      en: 'Facilitates mentoring sessions between senior and junior agents to accelerate team learning.',
    },
  },
  // --- Marketing & Growth division ---
  {
    id: 'cmo',
    name: { es: 'Alex', en: 'Alex' },
    role: { es: 'Chief Marketing Officer', en: 'Chief Marketing Officer' },
    department: 'Growth Room',
    archetype: 'commander',
    primaryColor: '#f59e0b',
    accentColor: '#fbbf24',
    specialization: 'analyst',
    capabilities: ['campaign_launch', 'growth_analysis', 'performance_review'],
    startingLearningScore: 0.75,
    description: {
      es: 'Lidera la estrategia de marketing. Lanza campañas y mide su impacto en el crecimiento de la empresa.',
      en: 'Leads marketing strategy. Launches campaigns and measures their impact on company growth.',
    },
  },
  {
    id: 'content-strategist',
    name: { es: 'Maya', en: 'Maya' },
    role: { es: 'Content Strategist', en: 'Content Strategist' },
    department: 'Design Studio',
    archetype: 'broadcaster',
    primaryColor: '#fb923c',
    accentColor: '#f59e0b',
    specialization: 'analyst',
    capabilities: ['content_creation', 'seo_audit', 'growth_analysis'],
    startingLearningScore: 0.70,
    description: {
      es: 'Crea y optimiza contenido para SEO. Genera informes de rendimiento de artículos y canales.',
      en: 'Creates and optimizes content for SEO. Generates performance reports for articles and channels.',
    },
  },
  {
    id: 'ads-analyst',
    name: { es: 'Omar', en: 'Omar' },
    role: { es: 'Ads & Growth Analyst', en: 'Ads & Growth Analyst' },
    department: 'Growth Room',
    archetype: 'analyst',
    primaryColor: '#fbbf24',
    accentColor: '#f59e0b',
    specialization: 'quant',
    capabilities: ['ads_review', 'growth_analysis', 'signal_generation'],
    startingLearningScore: 0.65,
    description: {
      es: 'Optimiza campañas de pago. Analiza ROI, CTR y coste por lead en canales digitales.',
      en: 'Optimizes paid campaigns. Analyzes ROI, CTR, and cost-per-lead across digital channels.',
    },
  },
  // --- Tech & Operations division ---
  {
    id: 'cto',
    name: { es: 'Sam', en: 'Sam' },
    role: { es: 'Chief Technology Officer', en: 'Chief Technology Officer' },
    department: 'Operations Room',
    archetype: 'engineer',
    primaryColor: '#3da9fc',
    accentColor: '#22d3ee',
    specialization: 'analyst',
    capabilities: ['sprint_planning', 'system_check', 'performance_review'],
    startingLearningScore: 0.80,
    description: {
      es: 'Dirige la ingeniería. Planifica sprints, supervisa deploys y define la arquitectura técnica.',
      en: 'Leads engineering. Plans sprints, supervises deployments, and defines technical architecture.',
    },
  },
  {
    id: 'senior-dev',
    name: { es: 'Kai', en: 'Kai' },
    role: { es: 'Senior Developer', en: 'Senior Developer' },
    department: 'Operations Room',
    archetype: 'operator',
    primaryColor: '#60a5fa',
    accentColor: '#3da9fc',
    specialization: 'analyst',
    capabilities: ['code_review', 'bug_fix', 'deployment'],
    startingLearningScore: 0.72,
    description: {
      es: 'Revisa código y corrige bugs críticos. Ejecuta deploys a producción y documenta cambios.',
      en: 'Reviews code and fixes critical bugs. Executes production deployments and documents changes.',
    },
  },
  {
    id: 'qa-engineer',
    name: { es: 'Nadia', en: 'Nadia' },
    role: { es: 'QA Engineer', en: 'QA Engineer' },
    department: 'Operations Room',
    archetype: 'reviewer',
    primaryColor: '#818cf8',
    accentColor: '#3da9fc',
    specialization: 'risk',
    capabilities: ['qa_testing', 'bug_fix', 'performance_review'],
    startingLearningScore: 0.68,
    description: {
      es: 'Asegura la calidad del software. Ejecuta suites de tests y bloquea releases con defectos críticos.',
      en: 'Ensures software quality. Runs test suites and blocks releases with critical defects.',
    },
  },
];
