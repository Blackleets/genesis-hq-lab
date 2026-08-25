// BotCreatorView.tsx — 'factory' module: user-facing bot creator.
// Form over the real POST /api/genesis/bots contract:
//   {pair, kind, params:{slMult, tpMult}}
//   -> 201 {ok:true, bot} | 400 pair_not_allowed|unknown_strategy|bot_limit_reached
//      | 409 bot_already_exists | 401 unauthorized
// Paper only ($1000 virtual). No simulated results: the created bot shows up
// live in Quant Lab ('quant-bot'), which reads the backend directly.

import { useState } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import { useWalletAuth } from '@core/auth/WalletAuthProvider';
import { actions } from '@core/store/genesisStore';

const ACCENT = '#22d3ee';

const PAIRS = ['COTIUSDT', 'XLMUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;
type Pair = (typeof PAIRS)[number];

interface StrategyOption {
  kind: 'meanReversion' | 'volumeProfile';
  labelEs: string;
  labelEn: string;
}

// Honest labels: meanReversion is the validated engine; volumeProfile is
// experimental. No invented performance claims.
const STRATEGIES: StrategyOption[] = [
  {
    kind: 'meanReversion',
    labelEs: 'Reversión a la media (validada, 6 gates)',
    labelEn: 'Mean reversion (validated, 6 gates)',
  },
  {
    kind: 'volumeProfile',
    labelEs: 'Perfil de volumen (experimental)',
    labelEn: 'Volume profile (experimental)',
  },
];

const SL_DEFAULT = 2.7;
const TP_DEFAULT = 2.5;

type Phase = 'idle' | 'creating' | 'success' | 'error';

/** Shape of the bot echoed back by POST /api/genesis/bots on 201. */
interface CreatedBot {
  pair: string;
  tf: string;
  kind: string;
  equity: number;
  params?: Record<string, number>;
}

function errorCopy(code: string, es: boolean): string {
  switch (code) {
    case 'pair_not_allowed':
      return es
        ? 'Ese par no está permitido por el backend. Elige uno de la lista.'
        : 'That pair is not allowed by the backend. Pick one from the list.';
    case 'unknown_strategy':
      return es
        ? 'El backend no reconoce esa estrategia.'
        : 'The backend does not recognize that strategy.';
    case 'bot_limit_reached':
      return es
        ? 'Alcanzaste el límite de bots activos para tu cuenta.'
        : 'You reached the active bot limit for your account.';
    case 'bot_already_exists':
      return es
        ? 'Ya tienes un bot con ese par y estrategia.'
        : 'You already have a bot with that pair and strategy.';
    case 'unauthorized':
      return es
        ? 'Sesión inválida o expirada. Conecta tu wallet de nuevo.'
        : 'Session invalid or expired. Connect your wallet again.';
    default:
      return es
        ? 'No se pudo crear el bot — backend offline o error inesperado.'
        : 'Could not create the bot — backend offline or unexpected error.';
  }
}

function Slider({
  label,
  value,
  onChange,
  es,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  es: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[11px] uppercase tracking-wide text-zinc-400 font-mono">{label}</label>
        <span className="font-mono text-[13px]" style={{ color: ACCENT }}>
          x{value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={1.5}
        max={3}
        step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[#22d3ee]"
        style={{ accentColor: ACCENT }}
        aria-label={label}
      />
      <div className="flex justify-between text-[10px] text-zinc-600 font-mono mt-0.5">
        <span>1.50</span>
        <span>{es ? 'riesgo' : 'risk'}</span>
        <span>3.00</span>
      </div>
    </div>
  );
}

export default function BotCreatorView() {
  const lang = useLanguage();
  const es = lang === 'es';
  const { session } = useWalletAuth();

  const [pair, setPair] = useState<Pair>('COTIUSDT');
  const [kind, setKind] = useState<StrategyOption['kind']>('meanReversion');
  const [slMult, setSlMult] = useState(SL_DEFAULT);
  const [tpMult, setTpMult] = useState(TP_DEFAULT);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [createdBot, setCreatedBot] = useState<CreatedBot | null>(null);

  const strategy = STRATEGIES.find((s) => s.kind === kind)!;
  const strategyLabel = es ? strategy.labelEs : strategy.labelEn;

  async function handleCreate() {
    if (!session || phase === 'creating') return;
    setPhase('creating');
    setErrorMsg(null);
    setErrorCode(null);
    try {
      const r = await fetch('/api/genesis/bots', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ pair, kind, params: { slMult, tpMult } }),
      });
      if (r.status === 201) {
        try {
          const j = (await r.json()) as { bot?: CreatedBot };
          setCreatedBot(j.bot ?? null);
        } catch {
          // 201 without a parseable body — still a success, just no summary.
          setCreatedBot(null);
        }
        setPhase('success');
        return;
      }
      let code = '';
      try {
        const j = (await r.json()) as { error?: string };
        code = j.error ?? '';
      } catch {
        // Non-JSON body — fall through to generic copy.
      }
      if (r.status === 401) {
        code = 'unauthorized';
      }
      setPhase('error');
      setErrorCode(code || null);
      setErrorMsg(errorCopy(code, es));
    } catch {
      setPhase('error');
      setErrorCode(null);
      setErrorMsg(errorCopy('', es));
    }
  }

  function goQuantBot() {
    actions.setSelectedModule('quant-bot');
  }

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-6 bg-[#0a0c12]">
      <div className="max-w-2xl mx-auto space-y-5">
        <header>
          <h1 className="text-xl font-bold text-[#e6edf3]">
            {es ? 'Crear Bot' : 'Create Bot'}
          </h1>
          <p className="text-[12px] text-zinc-500 mt-1">
            {es
              ? 'Configura y lanza un bot paper con $1000 virtuales. Sin dinero real.'
              : 'Configure and launch a paper bot with $1000 virtual. No real money.'}
          </p>
        </header>

        {!session ? (
          <section className="gx-card px-4 py-4 text-[13px] text-amber-400">
            {es
              ? 'Conecta tu wallet primero para crear un bot.'
              : 'Connect your wallet first to create a bot.'}
          </section>
        ) : phase === 'success' ? (
          <section
            className="rounded px-5 py-5 space-y-3 border"
            style={{ borderColor: '#34d39955', background: '#10b98114' }}
            role="status"
          >
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
              <div className="text-[15px] font-semibold text-emerald-400">
                {es ? 'Bot creado correctamente.' : 'Bot created successfully.'}
              </div>
            </div>
            {createdBot && (
              <dl className="text-[12px] text-zinc-300 space-y-1 font-mono">
                <div>
                  <span className="text-zinc-500">{es ? 'Par' : 'Pair'}: </span>
                  {createdBot.pair} · {createdBot.tf}
                </div>
                <div>
                  <span className="text-zinc-500">{es ? 'Estrategia' : 'Strategy'}: </span>
                  {createdBot.kind === 'meanReversion' ? strategyLabel : createdBot.kind}
                </div>
                {createdBot.params && (
                  <div>
                    <span className="text-zinc-500">SL / TP: </span>x{Number(createdBot.params.slMult).toFixed(2)} / x
                    {Number(createdBot.params.tpMult).toFixed(2)}
                  </div>
                )}
                <div>
                  <span className="text-zinc-500">Equity: </span>${Number(createdBot.equity ?? 1000).toFixed(2)}{' '}
                  <span className="text-zinc-500">(paper)</span>
                </div>
              </dl>
            )}
            <p className="text-[12px] text-zinc-400">
              {es
                ? 'Tu bot ya está operando en modo paper. Míralo en vivo en Quant Lab.'
                : 'Your bot is now trading in paper mode. Watch it live in Quant Lab.'}
            </p>
            <button
              type="button"
              onClick={goQuantBot}
              className="px-4 py-2 rounded text-[13px] font-semibold text-[#0a0c12] transition-opacity hover:opacity-90"
              style={{ background: ACCENT }}
            >
              {es ? 'Ir a Quant Lab' : 'Go to Quant Lab'}
            </button>
          </section>
        ) : (
          <>
            {/* Pair */}
            <section className="gx-card px-4 py-4">
              <label
                htmlFor="bot-pair"
                className="block text-[11px] uppercase tracking-wide text-zinc-400 font-mono mb-2"
              >
                {es ? 'Par' : 'Pair'}
              </label>
              <select
                id="bot-pair"
                value={pair}
                onChange={(e) => setPair(e.target.value as Pair)}
                disabled={phase === 'creating'}
                className="w-full bg-[#10131a] border border-carbon-100 rounded px-3 py-2 text-[13px] font-mono text-zinc-100 focus:border-cyan-400/60 focus:outline-none"
              >
                {PAIRS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </section>

            {/* Strategy */}
            <section className="gx-card px-4 py-4">
              <label
                htmlFor="bot-strategy"
                className="block text-[11px] uppercase tracking-wide text-zinc-400 font-mono mb-2"
              >
                {es ? 'Estrategia' : 'Strategy'}
              </label>
              <select
                id="bot-strategy"
                value={kind}
                onChange={(e) => setKind(e.target.value as StrategyOption['kind'])}
                disabled={phase === 'creating'}
                className="w-full bg-[#10131a] border border-carbon-100 rounded px-3 py-2 text-[13px] text-zinc-100 focus:border-cyan-400/60 focus:outline-none"
              >
                {STRATEGIES.map((s) => (
                  <option key={s.kind} value={s.kind}>
                    {es ? s.labelEs : s.labelEn}
                  </option>
                ))}
              </select>
            </section>

            {/* Risk sliders */}
            <section className="gx-card px-4 py-4 space-y-4">
              <Slider
                label={es ? 'Stop Loss (multiplicador ATR)' : 'Stop Loss (ATR multiplier)'}
                value={slMult}
                onChange={setSlMult}
                es={es}
              />
              <Slider
                label={es ? 'Take Profit (multiplicador ATR)' : 'Take Profit (ATR multiplier)'}
                value={tpMult}
                onChange={setTpMult}
                es={es}
              />
            </section>

            {/* Readable summary */}
            <section
              className="rounded px-4 py-3 text-[13px] text-[#e6edf3] border"
              style={{ borderColor: `${ACCENT}40`, background: `${ACCENT}0d` }}
            >
              {es
                ? `Tu bot operará ${pair} con ${strategyLabel} · SL x${slMult.toFixed(2)} TP x${tpMult.toFixed(2)} · Paper $1000 virtuales`
                : `Your bot will trade ${pair} with ${strategyLabel} · SL x${slMult.toFixed(2)} TP x${tpMult.toFixed(2)} · Paper $1000 virtual`}
            </section>

            {phase === 'error' && errorCode === 'storage_not_durable' && (
              <div
                className="rounded px-4 py-3 text-[12px] border"
                style={{ borderColor: '#fbbf2455', background: '#f59e0b14' }}
                role="alert"
              >
                <div className="text-amber-400 font-semibold mb-1">
                  {es
                    ? 'La creacion de bots requiere persistencia durable. Configura Upstash/Supabase en Vercel.'
                    : 'Bot creation requires durable persistence. Configure Upstash/Supabase on Vercel.'}
                </div>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-zinc-400">
                  <li>UPSTASH_REDIS_REST_URL</li>
                  <li>UPSTASH_REDIS_REST_TOKEN</li>
                  <li>SUPABASE_URL</li>
                  <li>SUPABASE_SERVICE_KEY</li>
                </ul>
              </div>
            )}

            {phase === 'error' && errorCode === 'bot_already_exists' && (
              <div className="gx-card px-4 py-3 space-y-2" role="alert">
                <div className="text-[12px] text-amber-400 font-semibold">
                  {es ? 'Ya tienes un bot en este par' : 'You already have a bot on this pair'}
                </div>
                <button
                  type="button"
                  onClick={goQuantBot}
                  className="px-3 py-1.5 rounded text-[12px] font-semibold border border-cyan-400/60 transition-colors hover:bg-cyan-400/10"
                  style={{ color: ACCENT }}
                >
                  {es ? 'Ver mis bots' : 'See my bots'}
                </button>
              </div>
            )}

            {phase === 'error' &&
              errorCode !== 'storage_not_durable' &&
              errorCode !== 'bot_already_exists' &&
              errorMsg && (
                <div className="gx-card px-4 py-3 text-[12px] text-red-400">{errorMsg}</div>
              )}

            <button
              type="button"
              onClick={handleCreate}
              disabled={phase === 'creating'}
              className="w-full py-2.5 rounded text-[14px] font-bold text-[#0a0c12] transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: ACCENT }}
            >
              {phase === 'creating'
                ? es
                  ? 'Creando…'
                  : 'Creating…'
                : es
                  ? 'CREAR BOT'
                  : 'CREATE BOT'}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
