// Registry of Genesis modules. The sidebar reads this to render nav.
// Each module has:
//   - id (route key)
//   - state (drives badge color + placeholder copy)
//   - i18n keys for title, description, future actions, relation to HQ
//
// State enum is referenced by both the sidebar badge and the
// ModulePlaceholder copy.

import type { TKey } from '@core/i18n/translations';

export type ModuleId =
  | 'hq'
  | 'markets'
  | 'settings'
  | 'wallet'
  | 'console'
  | 'edge'
  | 'crypto'
  | 'system'
  | 'live-exec'
  | 'funding-bot'
  | 'quant-bot'
  | 'terminal'
  | 'factory';

export type ModuleState =
  | 'ready'
  | 'visual-only'
  | 'locked-backend'
  | 'locked-polymarket'
  | 'disabled-phase-8';

export interface ModuleEntry {
  id: ModuleId;
  navKey: TKey;
  state: ModuleState;
  /** description shown in the placeholder; bilingual via inline strings */
  description: { es: string; en: string };
  futureActions: { es: string; en: string }[];
  relation: { es: string; en: string };
}

const STATE_TO_TKEY: Record<ModuleState, TKey> = {
  'ready':              'state.ready',
  'visual-only':        'state.visualOnly',
  'locked-backend':     'state.lockedBackend',
  'locked-polymarket':  'state.lockedPolymarket',
  'disabled-phase-8':   'state.disabledPhase8',
};

export function stateTKey(s: ModuleState): TKey {
  return STATE_TO_TKEY[s];
}

export const MODULES: ModuleEntry[] = [
  {
    id: 'hq',
    navKey: 'nav.hq',
    state: 'ready',
    description: {
      es: 'La sede central donde viven los agentes activos. Mapa pixel art de una sola pantalla.',
      en: 'The headquarters where active agents live. Single-screen pixel-art map.',
    },
    futureActions: [
      { es: 'Click en agente abre su panel detallado.', en: 'Click an agent to open its detail panel.' },
      { es: 'Burbujas de conversación se actualizan en vivo.', en: 'Conversation bubbles update live.' },
      { es: 'Eventos de oficina (mejoras) aparecen como obras temporales.', en: 'Office events (upgrades) appear as temporary works.' },
    ],
    relation: {
      es: 'Es la propia oficina — esta pantalla es Génesis HQ.',
      en: 'This is the office itself — this screen is Genesis HQ.',
    },
  },
  {
    id: 'markets',
    navKey: 'nav.markets',
    state: 'ready',
    description: {
      es: 'Aquí se conectará Polymarket de solo lectura para listar mercados reales. Sin trading real.',
      en: 'Read-only snapshot of real Polymarket markets. No real trading.',
    },
    futureActions: [
      { es: 'Listar mercados activos por volumen/liquidez.', en: 'List active markets by volume/liquidity.' },
      { es: 'Mostrar precios, outcomes y fecha de cierre.', en: 'Show prices, outcomes, and end dates.' },
      { es: 'Si el proveedor falla, mostrar el error real.', en: 'If the provider fails, show the real error.' },
    ],
    relation: {
      es: 'El Escáner de mercado leerá estos datos desde su escritorio en HQ.',
      en: 'Market Scanner will read this data from its desk in HQ.',
    },
  },
  {
    id: 'factory',
    navKey: 'nav.create-bot',
    state: 'ready',
    description: {
      es: 'Creador de bots: elige par, estrategia y riesgo (SL/TP) y crea tu bot paper con $1000 virtuales. Requiere wallet conectada.',
      en: 'Bot creator: pick pair, strategy and risk (SL/TP) and launch your paper bot with $1000 virtual. Requires a connected wallet.',
    },
    futureActions: [
      { es: 'Elegir par (COTI, XLM, BTC, ETH, SOL).', en: 'Pick a pair (COTI, XLM, BTC, ETH, SOL).' },
      { es: 'Elegir estrategia validada del catálogo.', en: 'Choose a validated strategy from the catalog.' },
      { es: 'Ajustar multiplicadores SL/TP.', en: 'Tune SL/TP multipliers.' },
    ],
    relation: {
      es: 'El bot creado aparece vivo en Quant Lab (paper).',
      en: 'The created bot shows up live in Quant Lab (paper).',
    },
  },
  {
    id: 'edge',
    navKey: 'nav.edge',
    state: 'ready',
    description: {
      es: 'Scorecard GO/NO-GO: métricas de edge real para decidir cuándo pasar a capital real.',
      en: 'GO/NO-GO scorecard: real edge metrics to decide when to move to real capital.',
    },
    futureActions: [
      { es: 'Ver veredicto en tiempo real.', en: 'View real-time verdict.' },
      { es: 'Checklist de condiciones GO.', en: 'GO conditions checklist.' },
      { es: 'Historial de progreso hacia GO.', en: 'Progress history toward GO.' },
    ],
    relation: {
      es: 'GO exige revisión externa del fundador, gates y evidencia; nunca activa capital automáticamente.',
      en: "GO requires external founder review, gates and evidence; it never activates capital automatically.",
    },
  },
  {
    id: 'crypto',
    navKey: 'nav.crypto',
    state: 'ready',
    description: {
      es: 'Motor de scalping crypto: params en vivo, optimizador entrenando 24/7, PnL real con costos y posiciones abiertas.',
      en: 'Crypto scalping engine: live params, optimizer training 24/7, real cost-aware PnL, and open positions.',
    },
    futureActions: [
      { es: 'Ver al optimizador adoptar o rechazar configs (walk-forward).', en: 'Watch the optimizer adopt or reject configs (walk-forward).' },
      { es: 'PnL crypto separado del de Polymarket, con costos.', en: 'Crypto PnL separated from Polymarket, cost-aware.' },
      { es: 'Posiciones abiertas con target/stop en vivo.', en: 'Open positions with live target/stop.' },
    ],
    relation: {
      es: 'El scalper crypto opera desde su escritorio en HQ con el motor validado por backtest.',
      en: 'The crypto scalper trades from its HQ desk with the backtest-validated engine.',
    },
  },
  {
    id: 'system',
    navKey: 'nav.system',
    state: 'ready',
    description: {
      es: 'Diagnóstico granular de sistema: DB, WebSocket, agentes, Kalshi, learning loop, treasury.',
      en: 'Granular system diagnostics: DB, WebSocket, agents, Kalshi, learning loop, treasury.',
    },
    futureActions: [
      { es: 'Alertas en tiempo real de desincronización.', en: 'Real-time desync alerts.' },
      { es: 'Historial de issues detectados.', en: 'Detected issues history.' },
    ],
    relation: {
      es: 'Source of truth del sistema — datos reales de todos los subsistemas.',
      en: 'System source of truth — real data from all subsystems.',
    },
  },
  {
    id: 'settings',
    navKey: 'nav.settings',
    state: 'visual-only',
    description: {
      es: 'Ajustes del laboratorio visual. Por ahora: idioma. Otras opciones se habilitan con el backend.',
      en: 'Visual lab settings. For now: language. Others unlock with the backend.',
    },
    futureActions: [
      { es: 'Configurar proveedores LLM.',          en: 'Configure LLM providers.' },
      { es: 'Conectar Polymarket de solo lectura.', en: 'Connect Polymarket read-only.' },
      { es: 'Definir ruta de agency-agents.',       en: 'Define agency-agents path.' },
    ],
    relation: {
      es: 'No afecta la oficina visual. Afectará a Génesis real desde fase 8.',
      en: 'Doesn’t affect the visual office. Will affect real Genesis from phase 8.',
    },
  },
  {
    id: 'wallet',
    navKey: 'nav.wallet',
    state: 'ready',
    description: {
      es: 'Conecta una wallet para lectura on-chain y futura identidad por firma. No habilita trading real todavia.',
      en: 'Connect a wallet for on-chain read access and future signature-based identity. It does not enable live trading yet.',
    },
    futureActions: [
      { es: 'Ver balance MATIC y USDC en tiempo real.', en: 'View real-time MATIC and USDC balance.' },
      { es: 'Preparar login por firma de wallet.',       en: 'Prepare wallet-signature login.' },
      { es: 'Separar lectura, identidad y autorizacion de trading.',    en: 'Separate read access, identity, and trading authorization.' },
    ],
    relation: {
      es: 'Hoy solo expone saldo y direccion. La capa de ejecucion real sigue separada.',
      en: 'Today it only exposes address and balances. Real execution remains separate.',
    },
  },
  {
    id: 'console',
    navKey: 'nav.console',
    state: 'ready',
    description: {
      es: 'Consola de delegación. Escribe qué quieres lograr y los agentes lo ejecutan en tiempo real con seguimiento en vivo.',
      en: 'Delegation console. Write what you want to achieve and agents execute it in real time with live tracking.',
    },
    futureActions: [
      { es: 'Historial de comandos persistente.', en: 'Persistent command history.' },
      { es: 'Asignación automática por capacidades.', en: 'Auto-assignment by capabilities.' },
      { es: 'Feedback adaptativo con Claude.', en: 'Adaptive feedback with Claude.' },
    ],
    relation: {
      es: 'Los comandos de la consola crean tareas que los agentes ejecutan en Génesis HQ.',
      en: 'Console commands create tasks that agents execute in Genesis HQ.',
    },
  },
  {
    id: 'live-exec',
    navKey: 'nav.live-exec',
    state: 'ready',
    description: {
      es: 'Ejecuciones en vivo del edge mean-reversion validado. Poll cada 5s a /api/crypto/executions. Modo paper o testnet (sin dinero real).',
      en: 'Live executions of the validated mean-reversion edge. Polls /api/crypto/executions every 5s. Paper or testnet mode (no real money).',
    },
    futureActions: [
      { es: 'Ver señales OPEN/TP/SL en tiempo real.', en: 'View OPEN/TP/SL signals in real time.' },
      { es: 'Conmutar a testnet con claves de solo-trade.', en: 'Switch to testnet with trade-only keys.' },
    ],
    relation: {
      es: 'Lectura de la auditoría del bot liveTrader.mjs; no ejecuta órdenes por sí mismo.',
      en: 'Reads the liveTrader.mjs bot audit trail; does not place orders itself.',
    },
  },
  {
    id: 'funding-bot',
    navKey: 'nav.funding-bot',
    state: 'ready',
    description: {
      es: 'Bot de arbitraje de funding (delta-neutral) con datos reales de Binance. Paper, sin quemar. Ve equity, PnL y cobros de funding en vivo.',
      en: 'Funding-rate arbitrage bot (delta-neutral) on real Binance data. Paper, no burn. Live equity, PnL and funding collected.',
    },
    futureActions: [
      { es: 'Ver operaciones OPEN/FLAT/FUNDING en vivo.', en: 'View live OPEN/FLAT/FUNDING operations.' },
      { es: 'Conmutar a real con cuenta futures + retiro off.', en: 'Switch to real with futures account + withdraw off.' },
    ],
    relation: {
      es: 'Veredicto honesto medido: funding arbitrage PERDEDOR post-fees (scanner 53 pares x 500 eventos, 2026-08).',
      en: 'Honest measured verdict: funding arbitrage LOSER post-fees (scanner 53 pairs x 500 events, 2026-08).',
    },
  },
  {
    id: 'quant-bot',
    navKey: 'nav.quant-bot',
    state: 'ready',
    description: {
      es: 'Genesis Quant Lab: bot paper COTIUSDT con estrategia validada (6 gates), equity en vivo, historial de trades y tesorería. Cero dólares reales.',
      en: 'Genesis Quant Lab: paper bot COTIUSDT with validated strategy (6 gates), live equity, trade history and treasury. Zero real dollars.',
    },
    futureActions: [
      { es: 'Ver equity y trades del bot paper en vivo.', en: 'View live paper bot equity and trades.' },
      { es: 'Pasar a testnet tras veredicto del auditor semanal.', en: 'Move to testnet after weekly auditor verdict.' },
    ],
    relation: {
      es: 'Ejecución real requiere tu GO + llaves + veredicto EDGE CONFIRMADO.',
      en: 'Real execution requires your GO + keys + EDGE CONFIRMED verdict.',
    },
  },
  {
    id: 'terminal',
    navKey: 'nav.terminal',
    state: 'ready',
    description: {
      es: 'Terminal de trading profesional: board de funding en vivo, curva de equity, posiciones delta-neutral y feed de operaciones. Paper.',
      en: 'Professional trading terminal: live funding board, equity curve, delta-neutral positions, trade feed. Paper.',
    },
    futureActions: [
      { es: 'Ver datos de Binance en tiempo real.', en: 'View real-time Binance data.' },
      { es: 'Conmutar a real con cuenta futures + retiro off.', en: 'Switch to real with futures account + withdraw off.' },
    ],
    relation: {
      es: 'Pantalla principal del bot. Veredicto honesto: PERDEDOR post-fees (53 pares x 500 eventos, 2026-08).',
      en: 'Main bot screen. Honest verdict: LOSER post-fees (53 pairs x 500 events, 2026-08).',
    },
  },
];

export const MODULE_BY_ID: Record<ModuleId, ModuleEntry> =
  Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<ModuleId, ModuleEntry>;
