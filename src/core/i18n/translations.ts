// Translation dictionary for Genesis HQ Lab.
// Language is one of 'es' (default) or 'en'. Keys are dot-separated paths.

export type Lang = 'es' | 'en';

export const TRANSLATIONS = {
  // ---------------- HEADER ----------------
  'header.title':            { es: 'GÉNESIS HQ',                  en: 'GENESIS HQ' },
  'header.subtitle':         { es: 'Agentes IA · Polymarket · Capital real', en: 'AI Agents · Polymarket · Real capital' },
  'header.officeStatus':     { es: 'Oficina: en línea',           en: 'Office: online' },
  'header.seedBadge':        { es: 'Datos semilla',                en: 'Seed data' },
  'header.lang.es':          { es: 'ES',                           en: 'ES' },
  'header.lang.en':          { es: 'EN',                           en: 'EN' },

  // ---------------- SIDEBAR / NAV ----------------
  'sidebar.workspace':       { es: 'Workspace',                    en: 'Workspace' },
  'sidebar.footer':          { es: 'v0.1.0 · Génesis local', en: 'v0.1.0 · Genesis local' },

  'nav.dashboard':           { es: 'Panel',                        en: 'Dashboard' },
  'nav.hq':                  { es: 'Sede central de Génesis',      en: 'Genesis HQ' },
  'nav.factory':             { es: 'Fábrica de agentes',           en: 'Agent Factory' },
  'nav.auto':                { es: 'Agente automático',            en: 'Auto-Agent Mode' },
  'nav.hr':                  { es: 'Génesis HR',                   en: 'Genesis HR' },
  'nav.markets':             { es: 'Mercados',                     en: 'Markets' },
  'nav.decisions':           { es: 'Decisiones',                   en: 'Decisions' },
  'nav.progress':            { es: 'Progreso',                     en: 'Progress' },
  'nav.settings':            { es: 'Ajustes',                      en: 'Settings' },
  'nav.wallet':              { es: 'Wallet',                        en: 'Wallet' },
  'nav.marketing':           { es: 'Marketing',                    en: 'Marketing' },
  'nav.tech':                { es: 'Tech Studio',                  en: 'Tech Studio' },
  'nav.console':             { es: 'Consola',                      en: 'Console' },
  'nav.integrations':        { es: 'Integraciones',                en: 'Integrations' },
  'nav.agents-live':         { es: 'Agentes IA',                   en: 'AI Agents' },
  'nav.edge':            { es: 'Edge Scorecard',               en: 'Edge Scorecard' },
  'nav.crypto':          { es: 'Crypto Lab',                    en: 'Crypto Lab' },
  'nav.system':          { es: 'System Health',                 en: 'System Health' },
  'nav.operator':        { es: 'Operador Timeline',            en: 'Operator Timeline' },
  'nav.alpha':           { es: 'Alpha Validation',             en: 'Alpha Validation' },
  'nav.pred-markets':    { es: 'Prediction Markets Lab',        en: 'Prediction Markets Lab' },

  // ---------------- MODULE STATES ----------------
  'state.ready':             { es: 'listo',                        en: 'ready' },
  'state.visualOnly':        { es: 'solo visual',                  en: 'visual only' },
  'state.lockedBackend':     { es: 'requiere backend',             en: 'needs backend' },
  'state.lockedPolymarket':  { es: 'requiere Polymarket',          en: 'needs Polymarket' },
  'state.disabledPhase8':    { es: 'deshabilitado hasta fase 8',   en: 'disabled until phase 8' },

  // ---------------- MODULES — common labels ----------------
  'module.statusLabel':      { es: 'Estado',                       en: 'Status' },
  'module.descriptionLabel': { es: 'Qué hará en Génesis real',     en: 'What it will do in real Genesis' },
  'module.relationLabel':    { es: 'Relación con Génesis HQ',      en: 'Relation to Genesis HQ' },
  'module.futureActions':    { es: 'Acciones futuras',             en: 'Future actions' },
  'module.backToHQ':         { es: 'Volver a la sede central',     en: 'Back to Genesis HQ' },
  'module.lockedNote':       { es: 'Esta pantalla es un placeholder visual. No hay backend, no hay datos reales.', en: 'This screen is a visual placeholder. No backend, no real data.' },

  // ---------------- DASHBOARD ----------------
  'dashboard.title':         { es: 'Panel de Génesis',             en: 'Genesis Dashboard' },
  'dashboard.intro':         { es: 'Empresa de IA: agentes que operan en Polymarket para ganar capital. Supervisa performance en tiempo real.', en: 'AI trading company: agents operate on Polymarket to grow capital. Monitor real-time performance here.' },
  'dashboard.jumpToHQ':      { es: 'Ir a la sede central',         en: 'Open Genesis HQ' },

  // ---------------- METRICS ----------------
  'metric.genesisAge':       { es: 'Edad de Génesis',              en: 'Genesis Age' },
  'metric.genesisAge.value': { es: 'Día 1',                        en: 'Day 1' },
  'metric.activeAgents':     { es: 'Agentes activos',              en: 'Active agents' },
  'metric.learningLevel':    { es: 'Nivel de aprendizaje',         en: 'Learning level' },
  'metric.companyHealth':    { es: 'Salud de la empresa',          en: 'Company health' },
  'metric.tasksCompleted':   { es: 'Tareas completadas',           en: 'Tasks completed' },
  'metric.agentsHired':      { es: 'Agentes contratados',          en: 'Agents hired' },
  'metric.agentsFired':      { es: 'Agentes despedidos',           en: 'Agents fired' },
  'metric.officeUpgrades':   { es: 'Mejoras de oficina',           en: 'Office upgrades' },
  'metric.modulesUnlocked':  { es: 'Módulos desbloqueados',        en: 'Modules unlocked' },
  'metric.hiringQueue':      { es: 'En cola de contratación',      en: 'In hiring queue' },
  'metric.tasksQueued':        { es: 'Tareas en cola',               en: 'Tasks queued' },
  'metric.tasksActive':        { es: 'Tareas activas',               en: 'Tasks active' },
  'metric.onboardingAgents':   { es: 'En onboarding',               en: 'Onboarding' },

  // ---------------- HR ----------------
  'hr.title':                { es: 'Génesis HR',                   en: 'Genesis HR' },
  'hr.intro':                { es: 'Recursos humanos de Génesis: agentes activos, cola de contratación y recomendaciones.', en: 'Genesis HR: active agents, hiring queue, and recommendations.' },
  'hr.active.title':         { es: 'Plantilla activa',             en: 'Active roster' },
  'hr.queue.title':          { es: 'Cola de contratación',         en: 'Hiring queue' },
  'hr.queue.condition':      { es: 'Se contratará cuando:',        en: 'Will be hired when:' },
  'hr.queue.empty':          { es: 'Sin candidatos en cola.',      en: 'No candidates in queue.' },
  'hr.recommendation.title': { es: 'Recomendaciones del evaluador', en: 'HR Evaluator recommendations' },

  // ---------------- HQ ----------------
  'hq.zone.market':          { es: 'Escritorio de mercado',        en: 'Market Desk' },
  'hq.zone.strategy':        { es: 'Laboratorio de estrategia',    en: 'Strategy Lab' },
  'hq.zone.risk':            { es: 'Búnker de riesgo',             en: 'Risk Bunker' },
  'hq.zone.memory':          { es: 'Archivo de memoria',           en: 'Memory Archive' },
  'hq.zone.open':            { es: 'Espacio abierto',              en: 'Open Workspace' },
  'hq.zone.debate':          { es: 'Sala de debate',               en: 'Debate Room' },
  'hq.zone.board':           { es: 'Sala de juntas',               en: 'Board Room' },
  'hq.zone.hr':              { es: 'Génesis HR',                   en: 'Genesis HR' },
  'hq.zone.execution':       { es: 'Mesa de ejecución',            en: 'Execution Desk' },

  // ---------------- LIVE ACTIVITY FEED ----------------
  'feed.title':              { es: 'Actividad en vivo',            en: 'Live activity' },
  'feed.labBadge':           { es: 'Lab visual',                   en: 'Visual lab' },
  'feed.footer':             { es: 'Eventos del sistema en tiempo real.', en: 'Live system events.' },
  'feed.kind.task':          { es: 'tarea',                        en: 'task' },
  'feed.kind.warning':       { es: 'aviso',                        en: 'warning' },
  'feed.kind.hr':            { es: 'hr',                           en: 'hr' },
  'feed.kind.memory':        { es: 'memoria',                      en: 'memory' },
  'feed.kind.debate':        { es: 'debate',                       en: 'debate' },
  'feed.kind.system':        { es: 'sistema',                      en: 'system' },
  'feed.kind.decision':      { es: 'decisión',                     en: 'decision' },
  'feed.kind.upgrade':       { es: 'mejora',                       en: 'upgrade' },
  'feed.timeJustNow':        { es: 'justo ahora',                  en: 'just now' },
  'feed.timeMinutesAgo':     { es: 'min',                          en: 'm ago' },
  'feed.timeHoursAgo':       { es: 'h',                            en: 'h ago' },

  // ---------------- INSPECTOR ----------------
  'inspector.visualSeed':    { es: 'Lab visual — agente semilla, no en vivo', en: 'Visual lab — seed agent, not live' },
  'inspector.dept':          { es: 'Depto',                        en: 'Dept' },
  'inspector.rank':          { es: 'Rango',                        en: 'Rank' },
  'inspector.status':        { es: 'Estado',                       en: 'Status' },
  'inspector.pose':          { es: 'Postura',                      en: 'Pose' },
  'inspector.currentTask':   { es: 'Tarea actual',                 en: 'Current task' },
  'inspector.trust':         { es: 'confianza',                    en: 'trust' },
  'inspector.learning':      { es: 'aprendizaje',                  en: 'learning' },
  'inspector.actionsTitle':  { es: 'Acciones',                     en: 'Actions' },
  'inspector.actionAssign':  { es: 'Asignar tarea',                en: 'Assign task' },
  'inspector.actionPromote': { es: 'Promover',                     en: 'Promote' },
  'inspector.actionRetrain': { es: 'Reentrenar',                   en: 'Retrain' },
  'inspector.actionSuspend': { es: 'Suspender',                    en: 'Suspend' },
  'inspector.actionFire':    { es: 'Despedir',                     en: 'Fire' },
  'inspector.note':          { es: "", en: "" },

  // ---------------- WALLET ----------------
  'wallet.title':            { es: 'Conexión de Wallet',            en: 'Wallet Connect' },
  'wallet.intro':            { es: 'Consulta saldo on-chain. El agente backend ejecuta trades en SQLite hasta integrar CLOB Polymarket.', en: 'View on-chain balance. Backend agent executes trades in SQLite until Polymarket CLOB is integrated.' },
  'wallet.connect.metamask': { es: 'Conectar MetaMask',             en: 'Connect MetaMask' },
  'wallet.connect.wc':       { es: 'WalletConnect',                 en: 'WalletConnect' },
  'wallet.disconnect':       { es: 'Desconectar',                   en: 'Disconnect' },
  'wallet.connected':        { es: 'Wallet conectada',              en: 'Wallet connected' },
  'wallet.disconnected':     { es: 'Sin wallet',                    en: 'Not connected' },
  'wallet.realMode':         { es: 'Modo real habilitado',          en: 'Real trading enabled' },
  'wallet.balance.matic':    { es: 'Balance MATIC',                 en: 'MATIC balance' },
  'wallet.balance.usdc':     { es: 'Balance USDC',                  en: 'USDC balance' },
  'wallet.network':          { es: 'Red',                           en: 'Network' },
  'wallet.note':             { es: 'Trading: datos reales del agente (npm run start). Wallet: solo lectura de MATIC/USDC.', en: 'Trading: real agent data (npm run start). Wallet: read-only MATIC/USDC balance.' },

  // ---------------- AGENT STATUSES ----------------
  'status.idle':             { es: 'inactivo',                     en: 'idle' },
  'status.working':          { es: 'trabajando',                   en: 'working' },
  'status.thinking':         { es: 'pensando',                     en: 'thinking' },
  'status.debating':         { es: 'debatiendo',                   en: 'debating' },
  'status.learning':         { es: 'aprendiendo',                  en: 'learning' },
  'status.warning':          { es: 'alerta',                       en: 'warning' },
  'status.failed':           { es: 'fallido',                      en: 'failed' },
  'status.suspended':        { es: 'suspendido',                   en: 'suspended' },
  'status.fired':            { es: 'despedido',                    en: 'fired' },
  'status.promoted':         { es: 'promovido',                    en: 'promoted' },
  'status.retraining':       { es: 'reentrenamiento',              en: 'retraining' },

  // ---------------- HIRING QUEUE ----------------
  'hiring.statusVisualSeed': { es: 'semilla visual',               en: 'visual seed' },
  'hiring.statusPending':    { es: 'pendiente',                    en: 'pending' },
  'hiring.statusUnlocked':   { es: 'desbloqueable',                en: 'unlockable' },

  // ---------------- OFFICE UPGRADES ----------------
  'upgrade.title':           { es: 'Mejoras de oficina',           en: 'Office upgrades' },
  'upgrade.intro':           { es: 'Cuando una zona necesita mejora, Génesis solicita un contratista virtual.', en: 'When a zone needs upgrading, Genesis dispatches a virtual contractor.' },

  // ---------------- ADDITIONS — Life OS ----------------
  'hiring.hireButton':       { es: 'Contratar',                    en: 'Hire' },
  'hiring.onboardingIn':     { es: 'Onboarding termina en',        en: 'Onboarding ends in' },
  'hiring.onboardingNow':    { es: 'Onboarding listo.',            en: 'Onboarding ready.' },
  'hiring.completeNow':      { es: 'Control lab · completar onboarding',   en: 'Lab control · complete onboarding' },
  'hiring.queueEmpty':       { es: 'Sin candidatos pendientes.',   en: 'No pending candidates.' },

  'onboarding.title':        { es: 'Onboarding en curso',          en: 'Onboarding in progress' },
  'onboarding.empty':        { es: 'Ningún agente está en onboarding.', en: 'No agent is currently onboarding.' },
  'onboarding.duration':     { es: 'Duración: 3 min (lab)',         en: 'Duration: 3 min (lab)' },
    'onboarding.hint':         { es: 'Los agentes nuevos no toman tareas críticas durante el onboarding.', en: 'New agents do not take critical tasks during onboarding.' },

  'dashboard.realtime':  { es: 'Métricas de trading desde el backend SQLite. Requiere npm run start.', en: 'Trading metrics from SQLite backend. Requires npm run start.' },
  'dashboard.section.activity': { es: 'Actividad reciente',        en: 'Recent activity' },
  'dashboard.section.tasks':    { es: 'Tareas en curso',           en: 'Active tasks' },
  'dashboard.section.upgrades': { es: 'Mejoras de oficina',        en: 'Office upgrades' },
  'dashboard.section.modules':  { es: 'Módulos',                   en: 'Modules' },
  'dashboard.noTasks':       { es: 'Sin tareas activas.',          en: 'No active tasks.' },
  'dashboard.nextHire':      { es: 'Próxima contratación',         en: 'Next recommended hire' },
  'dashboard.nextHire.none': { es: 'Sin recomendaciones.',         en: 'No recommendations.' },

  'work.title':              { es: 'Pantalla de trabajo',          en: 'Work screen' },
  'work.tasksHere':          { es: 'Tareas en esta sala',          en: 'Tasks in this room' },
  'work.agentsHere':         { es: 'Agentes en esta sala',         en: 'Agents in this room' },
  'work.noTasks':            { es: 'Sin tareas activas aquí.',     en: 'No active tasks here.' },
  'work.noAgents':           { es: 'Sin agentes en esta sala.',    en: 'No agents in this room.' },
  'work.execLocked':         { es: 'Ejecución bloqueada. Solo análisis/read-only en fases futuras.', en: 'Execution locked. Read-only only in future phases.' },
  'work.marketReadonly':     { es: 'Inteligencia de mercado read-only pendiente del backend.', en: 'Read-only market intelligence pending backend.' },
  'work.close':              { es: 'Cerrar',                       en: 'Close' },

  'task.status.queued':       { es: 'en cola',          en: 'queued' },
  'task.status.assigned':     { es: 'asignada',         en: 'assigned' },
  'task.status.moving':       { es: 'en camino',        en: 'moving' },
  'task.status.working':      { es: 'en curso',         en: 'working' },
  'task.status.blocked':      { es: 'bloqueada',        en: 'blocked' },
  'task.status.waiting_review':{ es: 'en revisión',     en: 'waiting review' },
  'task.status.completed':    { es: 'completada',       en: 'completed' },
  'task.status.failed':       { es: 'fallida',          en: 'failed' },
  'task.status.archived':     { es: 'archivada',        en: 'archived' },

  'status.onboarding':       { es: 'onboarding',                   en: 'onboarding' },
  'status.moving':           { es: 'en camino',                    en: 'moving' },
  'status.waiting_review':   { es: 'esperando revisión',           en: 'waiting review' },

  // ---------------- SETTINGS ----------------
  'settings.title':          { es: 'Ajustes',                      en: 'Settings' },
  'settings.intro':          { es: 'Configuración del laboratorio visual.', en: 'Visual lab settings.' },
  'settings.language':       { es: 'Idioma',                       en: 'Language' },
  'settings.language.es':    { es: 'Español',                      en: 'Spanish' },
  'settings.language.en':    { es: 'Inglés',                       en: 'English' },
  'settings.lockedSection':  { es: 'Otras opciones se habilitan al conectar el backend (fase 8+).', en: 'Other options become available when the backend is connected (phase 8+).' },
  'settings.devMode':        { es: 'Modo desarrollador',           en: 'Developer mode' },
  'settings.devMode.desc':   { es: 'Permite atajos como completar onboarding al instante.', en: 'Enables shortcuts like instant onboarding completion.' },
  'settings.reset':          { es: 'Reiniciar estado',             en: 'Reset state' },
  'settings.reset.confirm':  { es: '¿Borrar el estado guardado y reiniciar Génesis?', en: 'Erase saved state and reset Genesis?' },
  'onboarding.startedAt':    { es: 'Iniciado',                     en: 'Started at' },
  'onboarding.endsAt':       { es: 'Finaliza',                     en: 'Ends at' },

  // ---------------- FACTORY ----------------
  'factory.title':           { es: 'Fábrica de Agentes',           en: 'Agent Factory' },
  'factory.intro':           { es: 'Crea un agente personalizado y agrégalo a la oficina.',  en: 'Create a custom agent and add it to the office.' },
  'factory.form.name':       { es: 'Nombre del agente',            en: 'Agent name' },
  'factory.form.role':       { es: 'Rol (aparece en el perfil)',   en: 'Role (shown in profile)' },
  'factory.form.dept':       { es: 'Departamento',                 en: 'Department' },
  'factory.form.archetype':  { es: 'Arquetipo visual',             en: 'Visual archetype' },
  'factory.form.color':      { es: 'Color primario',               en: 'Primary color' },
  'factory.submit':          { es: 'Crear agente',                 en: 'Create agent' },
  'factory.success':         { es: 'Agente creado. Aparecerá en HR en onboarding.', en: 'Agent created. Will appear in HR in onboarding.' },

  // ---------------- DECISIONS ----------------
  'decisions.title':         { es: 'Decisiones',                   en: 'Decisions' },
  'decisions.intro':         { es: 'Registra decisiones para revisión por el equipo de Génesis.', en: 'Log decisions for review by the Genesis team.' },
  'decisions.new':           { es: 'Nueva decisión',               en: 'New decision' },
  'decisions.form.title':    { es: 'Título de la decisión',        en: 'Decision title' },
  'decisions.form.context':  { es: 'Contexto / razón',             en: 'Context / reason' },
  'decisions.form.optionA':  { es: 'Opción A',                     en: 'Option A' },
  'decisions.form.optionB':  { es: 'Opción B',                     en: 'Option B' },
  'decisions.submit':        { es: 'Registrar',                    en: 'Log decision' },
  'decisions.resolve':       { es: 'Resolver',                     en: 'Resolve' },
  'decisions.outcome':       { es: 'Resultado',                    en: 'Outcome' },
  'decisions.empty':         { es: 'Sin decisiones registradas.',  en: 'No decisions logged yet.' },
  'decisions.status.pending':{ es: 'pendiente',                    en: 'pending' },
  'decisions.status.resolved':{ es: 'resuelta',                   en: 'resolved' },
  'decisions.hint':          { es: 'Cada decisión crea una tarea de revisión en la Sala de Juntas.', en: 'Each decision creates a review task in the Board Room.' },

  // ---------------- AUTO ----------------
  'auto.title':              { es: 'Agente Automático',            en: 'Auto-Agent Mode' },
  'auto.intro':              { es: 'Define un objetivo y Génesis propondrá un plan de tareas para ejecutarlo.', en: 'Define a goal and Genesis will propose a task plan to execute it.' },
  'auto.form.goal':          { es: 'Objetivo (describe qué quieres lograr)',  en: 'Goal (describe what you want to achieve)' },
  'auto.form.agents':        { es: 'Agentes involucrados',         en: 'Agents involved' },
  'auto.propose':            { es: 'Proponer plan',                en: 'Propose plan' },
  'auto.execute':            { es: 'Ejecutar plan',                en: 'Execute plan' },
  'auto.plan.title':         { es: 'Plan propuesto',               en: 'Proposed plan' },
  'auto.plan.empty':         { es: 'Escribe un objetivo para generar el plan.', en: 'Enter a goal to generate the plan.' },
  'auto.success':            { es: 'Plan ejecutado. Las tareas aparecerán en la oficina.', en: 'Plan executed. Tasks will appear in the office.' },
} as const;

export type TKey = keyof typeof TRANSLATIONS;

export function tr(key: TKey, lang: Lang): string {
  const entry = TRANSLATIONS[key];
  if (!entry) return key;
  return entry[lang] ?? entry.es ?? key;
}
