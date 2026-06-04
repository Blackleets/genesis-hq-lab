// creatorData.ts — options and copy for the cinematic Agent Creator.
// Bilingual. Drives the 6-step "create a digital being" flow.

import type { Archetype, Department, VisualProfile } from '@core/types/genesis';
import type { TaskType } from '@core/types/task';

export type Bilingual = { es: string; en: string };

// ─── Step 1: Personality DNA ──────────────────────────────────────────────────

export interface PersonalityGene {
  archetype: Archetype;
  name: Bilingual;
  trait: Bilingual;          // dominant trait shown as a glowing label
  essence: Bilingual;        // one-line personality description
  suggestedColor: string;    // DNA color seed
  suggestedDept: Department;
  glyph: string;             // single-char sigil
}

export const PERSONALITY_GENES: PersonalityGene[] = [
  {
    archetype: 'commander', glyph: '◆',
    name: { es: 'Comandante', en: 'Commander' },
    trait: { es: 'DECISIVO', en: 'DECISIVE' },
    essence: { es: 'Lidera bajo presión. Convierte el caos en órdenes claras.', en: 'Leads under pressure. Turns chaos into clear orders.' },
    suggestedColor: '#ffd24a', suggestedDept: 'Board Room',
  },
  {
    archetype: 'analyst', glyph: '◇',
    name: { es: 'Analista', en: 'Analyst' },
    trait: { es: 'PRECISO', en: 'PRECISE' },
    essence: { es: 'Lee patrones invisibles. Calcula antes de actuar.', en: 'Reads invisible patterns. Calculates before acting.' },
    suggestedColor: '#3da9fc', suggestedDept: 'Market Room',
  },
  {
    archetype: 'sentinel', glyph: '▲',
    name: { es: 'Centinela', en: 'Sentinel' },
    trait: { es: 'VIGILANTE', en: 'VIGILANT' },
    essence: { es: 'Nunca duerme. Detecta la amenaza antes del impacto.', en: 'Never sleeps. Detects the threat before impact.' },
    suggestedColor: '#ff4757', suggestedDept: 'Risk Office',
  },
  {
    archetype: 'scientist', glyph: '✦',
    name: { es: 'Científico', en: 'Scientist' },
    trait: { es: 'CURIOSO', en: 'CURIOUS' },
    essence: { es: 'Experimenta sin miedo. Cada fallo es información.', en: 'Experiments fearlessly. Every failure is data.' },
    suggestedColor: '#22d3ee', suggestedDept: 'Strategy Lab',
  },
  {
    archetype: 'mediator', glyph: '◈',
    name: { es: 'Mediador', en: 'Mediator' },
    trait: { es: 'EQUILIBRADO', en: 'BALANCED' },
    essence: { es: 'Sintetiza voces opuestas en una sola verdad.', en: 'Synthesizes opposing voices into one truth.' },
    suggestedColor: '#7c5cff', suggestedDept: 'Debate Room',
  },
  {
    archetype: 'archivist', glyph: '❖',
    name: { es: 'Archivista', en: 'Archivist' },
    trait: { es: 'MEMORIOSO', en: 'RETENTIVE' },
    essence: { es: 'Nada se olvida. Cada lección permanece viva.', en: 'Nothing is forgotten. Every lesson stays alive.' },
    suggestedColor: '#1f6fb0', suggestedDept: 'Memory Archive',
  },
  {
    archetype: 'guardian', glyph: '⬢',
    name: { es: 'Guardián', en: 'Guardian' },
    trait: { es: 'INQUEBRANTABLE', en: 'UNBREAKABLE' },
    essence: { es: 'Protege el capital como si fuera su propia vida.', en: 'Protects capital as if it were its own life.' },
    suggestedColor: '#00ff9c', suggestedDept: 'Audit Office',
  },
  {
    archetype: 'engineer', glyph: '⚙',
    name: { es: 'Ingeniero', en: 'Engineer' },
    trait: { es: 'CONSTRUCTOR', en: 'BUILDER' },
    essence: { es: 'Convierte ideas en sistemas que funcionan.', en: 'Turns ideas into systems that work.' },
    suggestedColor: '#ffb547', suggestedDept: 'Execution Desk',
  },
];

// ─── Step 2: Brain Model ──────────────────────────────────────────────────────

export interface BrainModel {
  provider: 'claude' | 'openai' | 'gemini' | 'custom';
  name: Bilingual;
  modelId: string;
  descriptor: Bilingual;
  color: string;
}

export const BRAIN_MODELS: BrainModel[] = [
  {
    provider: 'claude', modelId: 'claude-haiku-4-5-20251001', color: '#d97706',
    name: { es: 'Claude', en: 'Claude' },
    descriptor: { es: 'Razonamiento profundo. Cauteloso y matizado.', en: 'Deep reasoning. Cautious and nuanced.' },
  },
  {
    provider: 'openai', modelId: 'gpt-4o-mini', color: '#10b981',
    name: { es: 'OpenAI', en: 'OpenAI' },
    descriptor: { es: 'Versátil y veloz. Amplio conocimiento general.', en: 'Versatile and fast. Broad general knowledge.' },
  },
  {
    provider: 'gemini', modelId: 'gemini-1.5-flash', color: '#4285f4',
    name: { es: 'Gemini', en: 'Gemini' },
    descriptor: { es: 'Multimodal. Contexto masivo de larga duración.', en: 'Multimodal. Massive long-context window.' },
  },
  {
    provider: 'custom', modelId: 'custom', color: '#7c5cff',
    name: { es: 'Núcleo Custom', en: 'Custom Core' },
    descriptor: { es: 'Tu propio endpoint. Cualquier API compatible.', en: 'Your own endpoint. Any compatible API.' },
  },
];

// ─── Step 3: Skills ───────────────────────────────────────────────────────────

export interface SkillGroup {
  category: Bilingual;
  color: string;
  skills: Array<{ type: TaskType; label: Bilingual }>;
}

export const SKILL_GROUPS: SkillGroup[] = [
  {
    category: { es: 'Mercados', en: 'Markets' }, color: '#3da9fc',
    skills: [
      { type: 'market_scan',       label: { es: 'Escaneo de mercado', en: 'Market scan' } },
      { type: 'signal_generation', label: { es: 'Generación de señales', en: 'Signal generation' } },
      { type: 'paper_trade',       label: { es: 'Ejecución de trades', en: 'Trade execution' } },
    ],
  },
  {
    category: { es: 'Riesgo', en: 'Risk' }, color: '#ff4757',
    skills: [
      { type: 'risk_review',        label: { es: 'Revisión de riesgo', en: 'Risk review' } },
      { type: 'performance_review', label: { es: 'Análisis de rendimiento', en: 'Performance analysis' } },
    ],
  },
  {
    category: { es: 'Cognición', en: 'Cognition' }, color: '#7c5cff',
    skills: [
      { type: 'decision_review', label: { es: 'Toma de decisiones', en: 'Decision-making' } },
      { type: 'memory_archive',  label: { es: 'Archivo de memoria', en: 'Memory archival' } },
      { type: 'agent_training',  label: { es: 'Auto-entrenamiento', en: 'Self-training' } },
    ],
  },
  {
    category: { es: 'Operaciones', en: 'Operations' }, color: '#00ff9c',
    skills: [
      { type: 'system_check',   label: { es: 'Diagnóstico de sistema', en: 'System diagnostics' } },
      { type: 'maintenance',    label: { es: 'Mantenimiento', en: 'Maintenance' } },
      { type: 'peer_training',  label: { es: 'Mentoría de pares', en: 'Peer mentoring' } },
    ],
  },
];

// ─── Step 4: Appearance ───────────────────────────────────────────────────────

export const DNA_COLORS = [
  '#3da9fc', '#22d3ee', '#7c5cff', '#ff4757',
  '#00ff9c', '#ffd24a', '#ffb547', '#a855f7',
  '#1f6fb0', '#f472b6',
];

export interface AccessoryOption {
  value: NonNullable<VisualProfile['accessory']>;
  label: Bilingual;
  glyph: string;
}

export const ACCESSORIES: AccessoryOption[] = [
  { value: 'none',      glyph: '○', label: { es: 'Ninguno', en: 'None' } },
  { value: 'shield',    glyph: '⛨', label: { es: 'Escudo', en: 'Shield' } },
  { value: 'glasses',   glyph: '◉', label: { es: 'Lentes', en: 'Glasses' } },
  { value: 'crown',     glyph: '♛', label: { es: 'Corona', en: 'Crown' } },
  { value: 'headset',   glyph: '⌖', label: { es: 'Auriculares', en: 'Headset' } },
  { value: 'flask',     glyph: '⚗', label: { es: 'Matraz', en: 'Flask' } },
  { value: 'book',      glyph: '▤', label: { es: 'Libro', en: 'Book' } },
  { value: 'lock',      glyph: '⚿', label: { es: 'Candado', en: 'Lock' } },
];

// ─── Step 5: Behavior ─────────────────────────────────────────────────────────

export interface BehaviorAxis {
  key: 'autonomy' | 'risk' | 'tempo';
  label: Bilingual;
  lowLabel: Bilingual;
  highLabel: Bilingual;
  color: string;
}

export const BEHAVIOR_AXES: BehaviorAxis[] = [
  {
    key: 'autonomy', color: '#3da9fc',
    label: { es: 'Autonomía', en: 'Autonomy' },
    lowLabel: { es: 'Supervisado', en: 'Supervised' },
    highLabel: { es: 'Independiente', en: 'Independent' },
  },
  {
    key: 'risk', color: '#ff4757',
    label: { es: 'Apetito de riesgo', en: 'Risk appetite' },
    lowLabel: { es: 'Conservador', en: 'Conservative' },
    highLabel: { es: 'Agresivo', en: 'Aggressive' },
  },
  {
    key: 'tempo', color: '#00ff9c',
    label: { es: 'Tempo', en: 'Tempo' },
    lowLabel: { es: 'Deliberado', en: 'Deliberate' },
    highLabel: { es: 'Veloz', en: 'Rapid' },
  },
];

// ─── Step 6: Mission ──────────────────────────────────────────────────────────

export const DEPARTMENTS: Department[] = [
  'Market Room', 'Risk Office', 'Strategy Lab', 'Memory Archive',
  'Debate Room', 'Board Room', 'Audit Office', 'Execution Desk',
  'Genesis HR', 'Operations Room',
];

// ─── Draft shape ──────────────────────────────────────────────────────────────

export interface AgentDraft {
  // Step 1
  archetype: Archetype | null;
  // Step 2
  provider: BrainModel['provider'] | null;
  modelId: string | null;
  // Step 3
  skills: TaskType[];
  // Step 4
  primaryColor: string;
  accentColor: string;
  accessory: NonNullable<VisualProfile['accessory']>;
  // Step 5
  behavior: { autonomy: number; risk: number; tempo: number };
  // Step 6
  name: string;
  role: string;
  department: Department | null;
  mission: string;
}

export const EMPTY_DRAFT: AgentDraft = {
  archetype: null,
  provider: null,
  modelId: null,
  skills: [],
  primaryColor: '#3da9fc',
  accentColor: '#22d3ee',
  accessory: 'none',
  behavior: { autonomy: 50, risk: 35, tempo: 50 },
  name: '',
  role: '',
  department: null,
  mission: '',
};

// ─── Step metadata ────────────────────────────────────────────────────────────

export const STEPS: Array<{ id: string; title: Bilingual; subtitle: Bilingual }> = [
  { id: 'dna',        title: { es: 'ADN de Personalidad', en: 'Personality DNA' }, subtitle: { es: 'El núcleo de su identidad', en: 'The core of its identity' } },
  { id: 'brain',      title: { es: 'Modelo Cerebral',     en: 'Brain Model' },      subtitle: { es: 'La mente que lo impulsa', en: 'The mind that drives it' } },
  { id: 'skills',     title: { es: 'Habilidades',         en: 'Skills' },           subtitle: { es: 'Lo que puede ejecutar', en: 'What it can execute' } },
  { id: 'appearance', title: { es: 'Apariencia',          en: 'Appearance' },       subtitle: { es: 'Su forma visible', en: 'Its visible form' } },
  { id: 'behavior',   title: { es: 'Comportamiento',      en: 'Behavior' },         subtitle: { es: 'Cómo opera en el mundo', en: 'How it operates in the world' } },
  { id: 'mission',    title: { es: 'Misión',              en: 'Mission' },          subtitle: { es: 'Su razón de existir', en: 'Its reason to exist' } },
];
