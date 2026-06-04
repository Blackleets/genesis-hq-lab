// CommandBar — cinematic command interface for Genesis.
// Triggered by Cmd/Ctrl+K or external open() call.
// Wires to /api/command/execute + /api/agents/:id/task.
// No fake states — submission drives real execution.

import {
  useCallback, useEffect, useRef, useState, createContext, useContext,
} from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import { actions } from '@core/store/genesisStore';

// ─── Context (global open/close) ─────────────────────────────────────────────

interface CommandBarCtx {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const Ctx = createContext<CommandBarCtx>({ open: () => {}, close: () => {}, isOpen: false });

export function useCommandBar() {
  return useContext(Ctx);
}

// ─── Suggestion catalogue ─────────────────────────────────────────────────────

interface Suggestion {
  id: string;
  label: { es: string; en: string };
  category: { es: string; en: string };
  value: { es: string; en: string };
  accent: string;
}

const SUGGESTIONS: Suggestion[] = [
  // Mercados
  { id: 'scan',       accent: '#3da9fc', category: { es: 'Mercados',   en: 'Markets'   }, label: { es: 'Escanear mercados',          en: 'Scan markets'            }, value: { es: 'Escanear señales de mercado en Polymarket',     en: 'Scan market signals on Polymarket'       } },
  { id: 'btc',        accent: '#3da9fc', category: { es: 'Mercados',   en: 'Markets'   }, label: { es: 'Analizar señal de BTC',      en: 'Analyze BTC signal'      }, value: { es: 'Analiza la señal actual del mercado de Bitcoin', en: 'Analyze the current Bitcoin market signal' } },
  { id: 'portfolio',  accent: '#3da9fc', category: { es: 'Mercados',   en: 'Markets'   }, label: { es: 'Revisar portafolio',         en: 'Review portfolio'        }, value: { es: 'Revisa el riesgo y exposición del portafolio',  en: 'Review portfolio risk and exposure'       } },
  // Agentes
  { id: 'atlas',      accent: '#22d3ee', category: { es: 'Agentes',    en: 'Agents'    }, label: { es: 'Tarea para Atlas',           en: 'Task for Atlas'          }, value: { es: 'Asigna a Atlas: ',                              en: 'Assign to Atlas: '                        } },
  { id: 'sentinel',   accent: '#ff4757', category: { es: 'Agentes',    en: 'Agents'    }, label: { es: 'Alerta a Sentinel',          en: 'Alert Sentinel'          }, value: { es: 'Sentinel: revisa amenazas actuales del sistema', en: 'Sentinel: review current system threats'  } },
  { id: 'pause',      accent: '#ffd24a', category: { es: 'Agentes',    en: 'Agents'    }, label: { es: 'Pausar todos los agentes',   en: 'Pause all agents'        }, value: { es: 'Pausa todos los agentes activos',               en: 'Pause all active agents'                  } },
  // Sistema
  { id: 'status',     accent: '#00ff9c', category: { es: 'Sistema',    en: 'System'    }, label: { es: 'Estado del sistema',         en: 'System status'           }, value: { es: 'Muestra el estado completo del sistema',         en: 'Show complete system status'              } },
  { id: 'lessons',    accent: '#1f6fb0', category: { es: 'Memoria',    en: 'Memory'    }, label: { es: 'Ver lecciones aprendidas',   en: 'View learned lessons'    }, value: { es: 'Muestra las últimas lecciones aprendidas',      en: 'Show latest learned lessons'              } },
  { id: 'risk',       accent: '#ff4757', category: { es: 'Riesgo',     en: 'Risk'      }, label: { es: 'Revisión de riesgo',         en: 'Risk review'             }, value: { es: 'Ejecuta revisión completa de riesgo del fondo', en: 'Run full fund risk review'                } },
  { id: 'strategy',   accent: '#7c5cff', category: { es: 'Estrategia', en: 'Strategy'  }, label: { es: 'Generar estrategia',         en: 'Generate strategy'       }, value: { es: 'Nova: genera estrategia de entrada para ',      en: 'Nova: generate entry strategy for '       } },
];

const PLACEHOLDERS = {
  es: [
    'Dile a Genesis qué hacer…',
    'Asigna una tarea a Atlas…',
    'Revisa el riesgo del portafolio…',
    'Genera estrategia de entrada…',
    'Escanea señales de mercado…',
    'Consulta a Sentinel sobre amenazas…',
  ],
  en: [
    'Tell Genesis what to do…',
    'Assign a task to Atlas…',
    'Review portfolio risk…',
    'Generate an entry strategy…',
    'Scan market signals…',
    'Ask Sentinel about threats…',
  ],
};

// ─── Execution ────────────────────────────────────────────────────────────────

async function executeCommand(text: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch('/api/command/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: text }),
    });
    const data = await res.json() as { ok: boolean; message?: string };
    return data;
  } catch {
    return { ok: false, message: 'Backend offline' };
  }
}

// ─── Inner bar ────────────────────────────────────────────────────────────────

interface BarProps {
  onClose: () => void;
}

function Bar({ onClose }: BarProps) {
  const lang = useLanguage();
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [placeholderVisible, setPlaceholderVisible] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Rotate placeholders when input is empty
  useEffect(() => {
    if (value) return;
    const id = setInterval(() => {
      setPlaceholderVisible(false);
      setTimeout(() => {
        setPlaceholderIdx((i) => (i + 1) % PLACEHOLDERS[lang].length);
        setPlaceholderVisible(true);
      }, 200);
    }, 3200);
    return () => clearInterval(id);
  }, [value, lang]);

  // Filter suggestions by input
  const filtered = value.trim().length > 0
    ? SUGGESTIONS.filter((s) =>
        s.label[lang].toLowerCase().includes(value.toLowerCase()) ||
        s.category[lang].toLowerCase().includes(value.toLowerCase()),
      ).slice(0, 5)
    : SUGGESTIONS.slice(0, 6);

  function applySuggestion(s: Suggestion) {
    setValue(s.value[lang]);
    inputRef.current?.focus();
  }

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const cmd = value.trim();
    if (!cmd || submitting) return;

    setSubmitting(true);
    setResult(null);

    // Optimistic: create a local task so HQ reacts immediately
    actions.createTask({
      title: { es: cmd.slice(0, 60), en: cmd.slice(0, 60) },
      description: { es: cmd, en: cmd },
      type: 'system_check',
      room: 'open-workspace',
      priority: 'high',
      sourceModule: 'console',
      assignedAgentIds: [],
      estimatedMs: 60_000,
      isReal: true,
      isVisualSeed: false,
    });

    const res = await executeCommand(cmd);
    setSubmitting(false);

    if (res.ok) {
      setResult({ ok: true, message: lang === 'es' ? 'Comando enviado a Génesis' : 'Command sent to Genesis' });
      setTimeout(() => { onClose(); }, 900);
    } else {
      setResult({ ok: false, message: res.message ?? (lang === 'es' ? 'Error al ejecutar' : 'Execution error') });
    }
  }

  const placeholder = PLACEHOLDERS[lang][placeholderIdx];
  const showGlow = focused && !submitting;

  return (
    <>
      {/* ── Backdrop ── */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(4,6,12,0.78)', backdropFilter: 'blur(6px)' }}
        onClick={onClose}
      />

      {/* ── Panel ── */}
      <div
        className="fixed z-50 left-1/2 font-mono"
        style={{
          top: '22vh',
          transform: 'translateX(-50%)',
          width: 'min(660px, calc(100vw - 32px))',
          animation: 'cmd-enter 0.22s cubic-bezier(0.22,1,0.36,1) both',
        }}
      >
        {/* Border glow layer */}
        <div
          className="absolute inset-0 rounded-sm pointer-events-none"
          style={{
            boxShadow: showGlow
              ? '0 0 0 1px #3da9fc55, 0 0 40px #3da9fc18, 0 24px 64px rgba(0,0,0,0.6)'
              : '0 0 0 1px #1e2838, 0 24px 64px rgba(0,0,0,0.6)',
            transition: 'box-shadow 0.25s ease',
          }}
        />

        <div
          className="relative overflow-hidden"
          style={{ background: '#0b0f1a', border: '1px solid #1e2838' }}
        >
          {/* ── Input row ── */}
          <form onSubmit={handleSubmit} className="flex items-center gap-0">
            {/* Genesis mark */}
            <div
              className="flex items-center justify-center shrink-0 w-12 h-14 border-r"
              style={{ borderColor: '#1e2838' }}
            >
              <div
                className="w-5 h-5 flex items-center justify-center font-black text-[11px] select-none"
                style={{
                  background: showGlow ? '#3da9fc18' : '#1a1d2a',
                  border: `1.5px solid ${showGlow ? '#3da9fc66' : '#2a2f3d'}`,
                  color: showGlow ? '#3da9fc' : '#4b5563',
                  transition: 'all 0.25s ease',
                  borderRadius: 3,
                }}
              >
                G
              </div>
            </div>

            {/* Text input with animated placeholder */}
            <div className="flex-1 relative h-14 flex items-center">
              {/* Animated placeholder (only when empty) */}
              {!value && (
                <span
                  className="absolute left-3 pointer-events-none text-[14px] tracking-wide select-none"
                  style={{
                    color: '#374151',
                    opacity: placeholderVisible ? 1 : 0,
                    transition: 'opacity 0.18s ease',
                  }}
                >
                  {placeholder}
                </span>
              )}
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => { setValue(e.target.value); setResult(null); }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') onClose();
                  if (e.key === 'Tab' && filtered.length > 0) {
                    e.preventDefault();
                    applySuggestion(filtered[0]);
                  }
                }}
                className="absolute inset-0 w-full h-full bg-transparent text-zinc-100 text-[14px] tracking-wide px-3 focus:outline-none"
                autoComplete="off"
                spellCheck={false}
                disabled={submitting}
              />
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={!value.trim() || submitting}
              className="shrink-0 w-12 h-14 flex items-center justify-center border-l transition-colors disabled:opacity-30"
              style={{
                borderColor: '#1e2838',
                color: value.trim() ? '#3da9fc' : '#374151',
              }}
            >
              {submitting ? (
                <span style={{ animation: 'cmd-spin 0.8s linear infinite', display: 'inline-block' }}>⟳</span>
              ) : (
                <span className="text-[18px]">↵</span>
              )}
            </button>
          </form>

          {/* ── Result banner ── */}
          {result && (
            <div
              className="px-4 py-2 text-[11px] uppercase tracking-wider border-t"
              style={{
                borderColor: '#1e2838',
                color: result.ok ? '#00ff9c' : '#ff4757',
                background: result.ok ? '#00ff9c08' : '#ff475708',
                animation: 'cmd-fadein 0.2s ease both',
              }}
            >
              {result.message}
            </div>
          )}

          {/* ── Suggestions ── */}
          {!result && (
            <div className="border-t" style={{ borderColor: '#1a1f2e' }}>
              {/* Category label */}
              <div
                className="px-4 pt-2.5 pb-1 text-[9px] uppercase tracking-[0.2em]"
                style={{ color: '#2d3748' }}
              >
                {value.trim()
                  ? (lang === 'es' ? 'Sugerencias' : 'Suggestions')
                  : (lang === 'es' ? 'Acciones rápidas' : 'Quick actions')}
              </div>

              <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                {filtered.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => applySuggestion(s)}
                    className="group flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] tracking-wide transition-all"
                    style={{
                      background: '#111827',
                      border: `1px solid #1e2838`,
                      color: '#6b7280',
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = `${s.accent}44`;
                      (e.currentTarget as HTMLButtonElement).style.color = s.accent;
                      (e.currentTarget as HTMLButtonElement).style.background = `${s.accent}0a`;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = '#1e2838';
                      (e.currentTarget as HTMLButtonElement).style.color = '#6b7280';
                      (e.currentTarget as HTMLButtonElement).style.background = '#111827';
                    }}
                  >
                    <span
                      className="inline-block w-1 h-1 rounded-full shrink-0"
                      style={{ background: s.accent, opacity: 0.7 }}
                    />
                    <span className="text-zinc-500 text-[9px] uppercase tracking-wider mr-0.5">
                      {s.category[lang]}
                    </span>
                    {s.label[lang]}
                  </button>
                ))}
              </div>

              {/* Keyboard hints */}
              <div
                className="px-4 py-2 border-t flex items-center gap-4 text-[9px] uppercase tracking-wider"
                style={{ borderColor: '#1a1f2e', color: '#1f2937' }}
              >
                <span><kbd className="opacity-60">↵</kbd> ejecutar</span>
                <span><kbd className="opacity-60">Tab</kbd> completar</span>
                <span><kbd className="opacity-60">Esc</kbd> cerrar</span>
                <span className="ml-auto opacity-40">⌘K</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{CMD_KEYFRAMES}</style>
    </>
  );
}

const CMD_KEYFRAMES = `
@keyframes cmd-enter {
  from { opacity: 0; transform: translateX(-50%) translateY(-12px) scale(0.97); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0)     scale(1);    }
}
@keyframes cmd-fadein {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes cmd-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
`;

// ─── Provider ─────────────────────────────────────────────────────────────────

export function CommandBarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open  = useCallback(() => setIsOpen(true),  []);
  const close = useCallback(() => setIsOpen(false), []);

  // Global Cmd/Ctrl+K shortcut
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <Ctx.Provider value={{ open, close, isOpen }}>
      {children}
      {isOpen && <Bar onClose={close} />}
    </Ctx.Provider>
  );
}
