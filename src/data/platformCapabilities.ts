// platformCapabilities — maps task types to platforms and defines platform metadata.
// Used by IntegrationsView and connectorClient to route agent work to the right platform.

import type { TaskType } from '../types/task';

export type PlatformId =
  | 'slack' | 'github' | 'notion' | 'sheets'
  | 'facebook' | 'instagram' | 'linkedin' | 'twitter'
  | 'google_ads' | 'tiktok' | 'make' | 'webhook';

export type AuthMethod = 'apikey' | 'webhook' | 'make';

export type PlatformCategory = 'social' | 'ads' | 'productivity' | 'dev' | 'bridge';

export interface PlatformMeta {
  name: string;
  icon: string;
  color: string;
  category: PlatformCategory;
  authMethod: AuthMethod;
  description: { es: string; en: string };
  configFields: { key: string; label: string; placeholder: string; secret?: boolean }[];
  setupUrl?: string;
  makeScenarioHint?: { es: string; en: string };
}

export const PLATFORM_METADATA: Record<PlatformId, PlatformMeta> = {
  facebook: {
    name: 'Facebook',
    icon: '📘',
    color: '#1877F2',
    category: 'social',
    authMethod: 'make',
    description: {
      es: 'Publica posts, lanza anuncios y analiza métricas en páginas de Facebook.',
      en: 'Post content, run ads, and analyze metrics on Facebook pages.',
    },
    configFields: [
      { key: 'webhookUrl', label: 'Webhook URL (Make.com)', placeholder: 'https://hook.eu2.make.com/...' },
    ],
    makeScenarioHint: {
      es: 'Crea un escenario en Make.com: Webhook → Facebook Pages → Create a Post',
      en: 'Create a Make.com scenario: Webhook → Facebook Pages → Create a Post',
    },
  },
  instagram: {
    name: 'Instagram',
    icon: '📷',
    color: '#E1306C',
    category: 'social',
    authMethod: 'make',
    description: {
      es: 'Programa publicaciones, stories y reels en Instagram Business.',
      en: 'Schedule posts, stories, and reels on Instagram Business.',
    },
    configFields: [
      { key: 'webhookUrl', label: 'Webhook URL (Make.com)', placeholder: 'https://hook.eu2.make.com/...' },
    ],
    makeScenarioHint: {
      es: 'Crea un escenario en Make.com: Webhook → Instagram for Business → Create a Photo Post',
      en: 'Create a Make.com scenario: Webhook → Instagram for Business → Create a Photo Post',
    },
  },
  linkedin: {
    name: 'LinkedIn',
    icon: '💼',
    color: '#0A66C2',
    category: 'social',
    authMethod: 'make',
    description: {
      es: 'Publica actualizaciones, artículos y contenido en páginas de empresa LinkedIn.',
      en: 'Post updates, articles, and content on LinkedIn company pages.',
    },
    configFields: [
      { key: 'webhookUrl', label: 'Webhook URL (Make.com)', placeholder: 'https://hook.eu2.make.com/...' },
    ],
    makeScenarioHint: {
      es: 'Crea un escenario en Make.com: Webhook → LinkedIn → Create a Company Update',
      en: 'Create a Make.com scenario: Webhook → LinkedIn → Create a Company Update',
    },
  },
  twitter: {
    name: 'Twitter / X',
    icon: '🐦',
    color: '#1DA1F2',
    category: 'social',
    authMethod: 'make',
    description: {
      es: 'Publica tweets, responde menciones y monitorea tendencias.',
      en: 'Post tweets, reply to mentions, and monitor trends.',
    },
    configFields: [
      { key: 'webhookUrl', label: 'Webhook URL (Make.com)', placeholder: 'https://hook.eu2.make.com/...' },
    ],
    makeScenarioHint: {
      es: 'Crea un escenario en Make.com: Webhook → Twitter → Create a Tweet',
      en: 'Create a Make.com scenario: Webhook → Twitter → Create a Tweet',
    },
  },
  tiktok: {
    name: 'TikTok',
    icon: '🎵',
    color: '#FF0050',
    category: 'social',
    authMethod: 'make',
    description: {
      es: 'Gestiona contenido y analiza métricas de cuentas TikTok for Business.',
      en: 'Manage content and analyze metrics on TikTok for Business accounts.',
    },
    configFields: [
      { key: 'webhookUrl', label: 'Webhook URL (Make.com)', placeholder: 'https://hook.eu2.make.com/...' },
    ],
    makeScenarioHint: {
      es: 'Crea un escenario en Make.com: Webhook → TikTok for Business → Upload Video',
      en: 'Create a Make.com scenario: Webhook → TikTok for Business → Upload Video',
    },
  },
  google_ads: {
    name: 'Google Ads',
    icon: '📈',
    color: '#4285F4',
    category: 'ads',
    authMethod: 'make',
    description: {
      es: 'Crea campañas, analiza rendimiento y ajusta pujas en Google Ads.',
      en: 'Create campaigns, analyze performance, and adjust bids in Google Ads.',
    },
    configFields: [
      { key: 'webhookUrl', label: 'Webhook URL (Make.com)', placeholder: 'https://hook.eu2.make.com/...' },
    ],
    makeScenarioHint: {
      es: 'Crea un escenario en Make.com: Webhook → Google Ads → Create Campaign',
      en: 'Create a Make.com scenario: Webhook → Google Ads → Create Campaign',
    },
  },
  slack: {
    name: 'Slack',
    icon: '💬',
    color: '#4A154B',
    category: 'productivity',
    authMethod: 'webhook',
    description: {
      es: 'Envía notificaciones, reportes y alertas a canales de Slack.',
      en: 'Send notifications, reports, and alerts to Slack channels.',
    },
    configFields: [
      { key: 'webhookUrl', label: 'Incoming Webhook URL', placeholder: 'https://hooks.slack.com/services/...' },
      { key: 'channelId', label: 'Canal (opcional)', placeholder: '#general' },
    ],
    setupUrl: 'https://api.slack.com/apps',
  },
  github: {
    name: 'GitHub',
    icon: '🐙',
    color: '#6e40c9',
    category: 'dev',
    authMethod: 'apikey',
    description: {
      es: 'Crea issues, PRs y gestiona repositorios de código.',
      en: 'Create issues, PRs, and manage code repositories.',
    },
    configFields: [
      { key: 'token', label: 'Personal Access Token', placeholder: 'ghp_...', secret: true },
      { key: 'repoOwner', label: 'Owner / Org', placeholder: 'my-org' },
      { key: 'repoName', label: 'Repositorio', placeholder: 'my-repo' },
    ],
    setupUrl: 'https://github.com/settings/tokens/new',
  },
  notion: {
    name: 'Notion',
    icon: '📝',
    color: '#ffffff',
    category: 'productivity',
    authMethod: 'apikey',
    description: {
      es: 'Crea y actualiza páginas y bases de datos en Notion.',
      en: 'Create and update pages and databases in Notion.',
    },
    configFields: [
      { key: 'apiKey', label: 'Integration Secret', placeholder: 'secret_...', secret: true },
      { key: 'databaseId', label: 'Database ID (opcional)', placeholder: 'xxxxxxxx-xxxx-...' },
    ],
    setupUrl: 'https://www.notion.so/my-integrations',
  },
  sheets: {
    name: 'Google Sheets',
    icon: '📊',
    color: '#34A853',
    category: 'productivity',
    authMethod: 'webhook',
    description: {
      es: 'Registra métricas y resultados en hojas de cálculo de Google Sheets.',
      en: 'Log metrics and results to Google Sheets spreadsheets.',
    },
    configFields: [
      { key: 'webhookUrl', label: 'Apps Script Webhook URL', placeholder: 'https://script.google.com/macros/s/...' },
    ],
    setupUrl: 'https://script.google.com',
  },
  make: {
    name: 'Make.com',
    icon: '⚙️',
    color: '#6D00CC',
    category: 'bridge',
    authMethod: 'webhook',
    description: {
      es: 'Conecta Genesis HQ con más de 1,000 apps vía Make.com. Úsalo como puente universal.',
      en: 'Connect Genesis HQ to 1,000+ apps via Make.com. Use as a universal bridge.',
    },
    configFields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://hook.eu2.make.com/...' },
    ],
    setupUrl: 'https://www.make.com/en/register',
  },
  webhook: {
    name: 'Webhook',
    icon: '🔗',
    color: '#6b7280',
    category: 'bridge',
    authMethod: 'webhook',
    description: {
      es: 'Envía datos a cualquier endpoint HTTP cuando los agentes completan tareas.',
      en: 'Send data to any HTTP endpoint when agents complete tasks.',
    },
    configFields: [
      { key: 'url', label: 'URL del endpoint', placeholder: 'https://your-app.com/webhook' },
      { key: 'secret', label: 'Secret (opcional)', placeholder: 'my-secret', secret: true },
    ],
  },
};

// Maps task types to the platforms that can handle them
export const TASK_TO_PLATFORMS: Partial<Record<TaskType, PlatformId[]>> = {
  campaign_launch:    ['facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'make'],
  content_creation:   ['notion', 'sheets', 'facebook', 'linkedin', 'instagram'],
  growth_analysis:    ['google_ads', 'sheets', 'notion'],
  ads_review:         ['facebook', 'google_ads'],
  seo_audit:          ['sheets', 'notion'],
  code_review:        ['github', 'slack'],
  deployment:         ['github', 'slack'],
  bug_fix:            ['github', 'slack'],
  sprint_planning:    ['notion', 'slack'],
  performance_review: ['sheets', 'notion', 'slack'],
  memory_archive:     ['notion', 'sheets'],
  risk_review:        ['slack', 'notion'],
  decision_review:    ['slack', 'notion'],
  market_scan:        ['slack', 'sheets'],
  signal_generation:  ['slack'],
};

export const ALL_PLATFORMS: PlatformId[] = [
  'facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'google_ads',
  'slack', 'github', 'notion', 'sheets', 'make', 'webhook',
];

export const PLATFORM_GROUPS: { labelEs: string; labelEn: string; platforms: PlatformId[] }[] = [
  {
    labelEs: 'Redes Sociales & Publicidad',
    labelEn: 'Social Media & Ads',
    platforms: ['facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'google_ads'],
  },
  {
    labelEs: 'Productividad & Desarrollo',
    labelEn: 'Productivity & Dev',
    platforms: ['slack', 'github', 'notion', 'sheets'],
  },
  {
    labelEs: 'Conectores Universales',
    labelEn: 'Universal Connectors',
    platforms: ['make', 'webhook'],
  },
];
