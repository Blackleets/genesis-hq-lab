// AgentCreator — cinematic 6-step flow to create a digital being.
// Intro → DNA → Brain → Skills → Appearance → Behavior → Mission → Genesis reveal.
// Premium transitions via framer-motion. Creates a real agent on completion.

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLanguage } from '@core/i18n/languageStore';
import { actions } from '@core/store/genesisStore';
import AgentDnaCore from '@creator/AgentDnaCore';
import {
  PERSONALITY_GENES, BRAIN_MODELS, SKILL_GROUPS, DNA_COLORS, ACCESSORIES,
  BEHAVIOR_AXES, DEPARTMENTS, STEPS, EMPTY_DRAFT,
  type AgentDraft,
} from '@creator/creatorData';

type Phase = 'intro' | 'steps' | 'reveal';

export default function AgentCreator() {
  const lang = useLanguage();
  const [phase, setPhase] = useState<Phase>('intro');
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT);
  const [direction, setDirection] = useState(1);

  const set = (patch: Partial<AgentDraft>) => setDraft((d) => ({ ...d, ...patch }));

  // Completion intensity (0..1) — drives the DNA core's energy
  const intensity = useMemo(() => {
    let filled = 0;
    if (draft.archetype) filled++;
    if (draft.provider) filled++;
    if (draft.skills.length) filled++;
    if (draft.primaryColor) filled++;
    filled++; // behavior always has defaults
    if (draft.name && draft.department) filled++;
    return filled / 6;
  }, [draft]);

  const canAdvance = useMemo(() => {
    switch (step) {
      case 0: return !!draft.archetype;
      case 1: return !!draft.provider;
      case 2: return draft.skills.length > 0;
      case 3: return !!draft.primaryColor;
      case 4: return true;
      case 5: return draft.name.trim().length > 0 && !!draft.department;
      default: return false;
    }
  }, [step, draft]);

  function next() {
    if (step < STEPS.length - 1) {
      setDirection(1);
      setStep((s) => s + 1);
    } else {
      setPhase('reveal');
    }
  }
  function back() {
    if (step > 0) { setDirection(-1); setStep((s) => s - 1); }
    else setPhase('intro');
  }

  function activate() {
    const gene = PERSONALITY_GENES.find((g) => g.archetype === draft.archetype);
    actions.createAgentFromFactory({
      name: draft.name.trim(),
      role: draft.role.trim() || (gene ? gene.name[lang] : 'Agent'),
      department: draft.department ?? 'Operations Room',
      archetype: draft.archetype ?? 'analyst',
      primaryColor: draft.primaryColor,
      accentColor: draft.accentColor,
      accessory: draft.accessory,
      capabilities: draft.skills,
    });
    // Reset for next creation
    setDraft(EMPTY_DRAFT);
    setStep(0);
    setPhase('intro');
  }

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-hidden bg-carbon-300 relative">
      {/* Ambient background grid */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.04]" style={{
        backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
        backgroundSize: '44px 44px',
      }} />

      <AnimatePresence mode="wait">
        {phase === 'intro' && (
          <IntroScreen key="intro" lang={lang} onStart={() => { setPhase('steps'); setStep(0); }} />
        )}

        {phase === 'steps' && (
          <motion.div
            key="steps"
            className="relative h-full flex flex-col"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <StepProgress step={step} lang={lang} />

            <div className="flex-1 min-h-0 flex">
              {/* Living DNA core — always visible */}
              <div className="w-[42%] shrink-0 hidden lg:flex flex-col items-center justify-center border-r border-trim relative">
                <motion.div
                  animate={{ scale: 1 + intensity * 0.08 }}
                  transition={{ type: 'spring', stiffness: 80, damping: 18 }}
                >
                  <AgentDnaCore draft={draft} intensity={intensity} size={260} />
                </motion.div>
                <DraftSummary draft={draft} lang={lang} intensity={intensity} />
              </div>

              {/* Step content */}
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
                  <AnimatePresence mode="wait" custom={direction}>
                    <motion.div
                      key={step}
                      custom={direction}
                      variants={STEP_VARIANTS}
                      initial="enter" animate="center" exit="exit"
                      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                    >
                      <StepHeader lang={lang} step={step} />
                      <div className="mt-6">
                        {step === 0 && <DnaStep draft={draft} set={set} lang={lang} />}
                        {step === 1 && <BrainStep draft={draft} set={set} lang={lang} />}
                        {step === 2 && <SkillsStep draft={draft} set={set} lang={lang} />}
                        {step === 3 && <AppearanceStep draft={draft} set={set} lang={lang} />}
                        {step === 4 && <BehaviorStep draft={draft} set={set} lang={lang} />}
                        {step === 5 && <MissionStep draft={draft} set={set} lang={lang} />}
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* Nav */}
                <div className="shrink-0 border-t border-trim px-8 py-4 flex items-center justify-between">
                  <button
                    type="button" onClick={back}
                    className="font-mono text-[11px] uppercase tracking-wider px-4 py-2 text-zinc-500 hover:text-zinc-200 transition-colors"
                  >
                    ← {lang === 'es' ? 'Atrás' : 'Back'}
                  </button>
                  <div className="font-mono text-[10px] text-zinc-600">
                    {step + 1} / {STEPS.length}
                  </div>
                  <button
                    type="button" onClick={next} disabled={!canAdvance}
                    className="font-mono text-[11px] uppercase tracking-wider px-5 py-2 border transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ borderColor: `${draft.primaryColor}66`, color: draft.primaryColor }}
                  >
                    {step === STEPS.length - 1
                      ? (lang === 'es' ? 'Génesis →' : 'Genesis →')
                      : (lang === 'es' ? 'Continuar →' : 'Continue →')}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {phase === 'reveal' && (
          <RevealScreen key="reveal" draft={draft} lang={lang} onActivate={activate} onBack={() => setPhase('steps')} />
        )}
      </AnimatePresence>
    </main>
  );
}

// ─── Transitions ──────────────────────────────────────────────────────────────

const STEP_VARIANTS = {
  enter:  (dir: number) => ({ opacity: 0, x: dir > 0 ? 40 : -40 }),
  center: { opacity: 1, x: 0 },
  exit:   (dir: number) => ({ opacity: 0, x: dir > 0 ? -40 : 40 }),
};

// ─── Intro ────────────────────────────────────────────────────────────────────

function IntroScreen({ lang, onStart }: { lang: 'es' | 'en'; onStart: () => void }) {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center text-center px-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.5 }}
    >
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 90, damping: 14, delay: 0.1 }}
      >
        <AgentDnaCore draft={EMPTY_DRAFT} intensity={0.15} size={180} />
      </motion.div>
      <motion.div
        initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="mt-6"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.4em] text-zinc-600 mb-3">
          Genesis Factory
        </div>
        <h1 className="font-mono text-3xl text-zinc-100 mb-3">
          {lang === 'es' ? 'Crea un ser digital' : 'Create a digital being'}
        </h1>
        <p className="font-mono text-[12px] text-zinc-500 max-w-md mx-auto leading-relaxed mb-8">
          {lang === 'es'
            ? 'No es un formulario. Vas a diseñar la personalidad, la mente, las habilidades y la misión de un agente que vivirá en Génesis.'
            : 'This is not a form. You will design the personality, mind, skills, and mission of an agent that will live in Genesis.'}
        </p>
        <motion.button
          type="button" onClick={onStart}
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
          className="font-mono text-[12px] uppercase tracking-[0.2em] px-8 py-3 border border-[#3da9fc]/50 text-[#3da9fc] hover:bg-[#3da9fc]/10 transition-colors"
        >
          {lang === 'es' ? 'Iniciar génesis' : 'Begin genesis'}
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

// ─── Progress ─────────────────────────────────────────────────────────────────

function StepProgress({ step, lang }: { step: number; lang: 'es' | 'en' }) {
  return (
    <div className="shrink-0 border-b border-trim px-8 py-3 flex items-center gap-1">
      {STEPS.map((s, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={s.id} className="flex items-center gap-1 flex-1 last:flex-none">
            <div className="flex items-center gap-2 shrink-0">
              <div
                className="w-6 h-6 flex items-center justify-center font-mono text-[10px] border transition-all"
                style={{
                  borderColor: active ? '#3da9fc' : done ? '#3da9fc55' : '#262d3d',
                  color: active ? '#3da9fc' : done ? '#3da9fc88' : '#4b5563',
                  background: active ? '#3da9fc14' : undefined,
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <span
                className="font-mono text-[10px] uppercase tracking-wider hidden xl:inline transition-colors"
                style={{ color: active ? '#e6edf3' : '#4b5563' }}
              >
                {s.title[lang]}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="flex-1 h-px mx-1" style={{ background: done ? '#3da9fc44' : '#262d3d' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StepHeader({ lang, step }: { lang: 'es' | 'en'; step: number }) {
  const s = STEPS[step];
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-zinc-600 mb-1">
        {lang === 'es' ? `Paso ${step + 1}` : `Step ${step + 1}`}
      </div>
      <h2 className="font-mono text-2xl text-zinc-100">{s.title[lang]}</h2>
      <p className="font-mono text-[12px] text-zinc-500 mt-1">{s.subtitle[lang]}</p>
    </div>
  );
}

// ─── Draft summary (under the core) ───────────────────────────────────────────

function DraftSummary({ draft, lang, intensity }: { draft: AgentDraft; lang: 'es' | 'en'; intensity: number }) {
  const gene = PERSONALITY_GENES.find((g) => g.archetype === draft.archetype);
  return (
    <div className="mt-6 text-center px-6">
      <div className="font-mono text-[14px] text-zinc-100 h-5">
        {draft.name || (lang === 'es' ? 'Sin nombre' : 'Unnamed')}
      </div>
      <div className="font-mono text-[11px] mt-1 h-4" style={{ color: gene ? draft.primaryColor : '#4b5563' }}>
        {gene ? gene.trait[lang] : '—'}
      </div>
      <div className="mt-4 mx-auto w-40 h-1 bg-carbon-200 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: draft.primaryColor }}
          animate={{ width: `${intensity * 100}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>
      <div className="font-mono text-[9px] text-zinc-600 mt-1.5 uppercase tracking-wider">
        {Math.round(intensity * 100)}% {lang === 'es' ? 'formado' : 'formed'}
      </div>
    </div>
  );
}

// ─── Step 1: DNA ──────────────────────────────────────────────────────────────

function DnaStep({ draft, set, lang }: StepProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {PERSONALITY_GENES.map((g) => {
        const active = draft.archetype === g.archetype;
        return (
          <motion.button
            key={g.archetype} type="button"
            whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.99 }}
            onClick={() => set({
              archetype: g.archetype,
              primaryColor: draft.archetype ? draft.primaryColor : g.suggestedColor,
              department: draft.department ?? g.suggestedDept,
            })}
            className="text-left p-3.5 border transition-all"
            style={{
              borderColor: active ? g.suggestedColor : '#262d3d',
              background: active ? `${g.suggestedColor}0e` : undefined,
              boxShadow: active ? `0 0 20px ${g.suggestedColor}22` : undefined,
            }}
          >
            <div className="flex items-center gap-3 mb-1.5">
              <span className="text-xl" style={{ color: g.suggestedColor }}>{g.glyph}</span>
              <span className="font-mono text-[13px] font-semibold text-zinc-100">{g.name[lang]}</span>
              <span className="ml-auto font-mono text-[8px] uppercase tracking-[0.2em] px-1.5 py-0.5 border"
                style={{ borderColor: `${g.suggestedColor}44`, color: g.suggestedColor }}>
                {g.trait[lang]}
              </span>
            </div>
            <p className="font-mono text-[11px] text-zinc-500 leading-snug">{g.essence[lang]}</p>
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── Step 2: Brain ────────────────────────────────────────────────────────────

function BrainStep({ draft, set, lang }: StepProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {BRAIN_MODELS.map((m) => {
        const active = draft.provider === m.provider;
        return (
          <motion.button
            key={m.provider} type="button"
            whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.99 }}
            onClick={() => set({ provider: m.provider, modelId: m.modelId })}
            className="text-left p-4 border transition-all"
            style={{
              borderColor: active ? m.color : '#262d3d',
              background: active ? `${m.color}0e` : undefined,
              boxShadow: active ? `0 0 20px ${m.color}22` : undefined,
            }}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: m.color, boxShadow: `0 0 8px ${m.color}` }} />
              <span className="font-mono text-[14px] font-semibold text-zinc-100">{m.name[lang]}</span>
            </div>
            <p className="font-mono text-[11px] text-zinc-500 leading-snug mb-2">{m.descriptor[lang]}</p>
            <div className="font-mono text-[9px] text-zinc-700">{m.modelId}</div>
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── Step 3: Skills ───────────────────────────────────────────────────────────

function SkillsStep({ draft, set, lang }: StepProps) {
  function toggle(type: AgentDraft['skills'][number]) {
    const has = draft.skills.includes(type);
    set({ skills: has ? draft.skills.filter((s) => s !== type) : [...draft.skills, type] });
  }
  return (
    <div className="space-y-5">
      {SKILL_GROUPS.map((group) => (
        <div key={group.category.en}>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] mb-2" style={{ color: group.color }}>
            {group.category[lang]}
          </div>
          <div className="flex flex-wrap gap-2">
            {group.skills.map((sk) => {
              const active = draft.skills.includes(sk.type);
              return (
                <motion.button
                  key={sk.type} type="button"
                  whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                  onClick={() => toggle(sk.type)}
                  className="font-mono text-[11px] px-3 py-1.5 border transition-all"
                  style={{
                    borderColor: active ? group.color : '#262d3d',
                    color: active ? group.color : '#9ca3af',
                    background: active ? `${group.color}12` : undefined,
                    boxShadow: active ? `0 0 12px ${group.color}33` : undefined,
                  }}
                >
                  {active ? '◆ ' : '◇ '}{sk.label[lang]}
                </motion.button>
              );
            })}
          </div>
        </div>
      ))}
      <div className="font-mono text-[10px] text-zinc-600">
        {draft.skills.length} {lang === 'es' ? 'habilidades seleccionadas' : 'skills selected'}
      </div>
    </div>
  );
}

// ─── Step 4: Appearance ───────────────────────────────────────────────────────

function AppearanceStep({ draft, set, lang }: StepProps) {
  return (
    <div className="space-y-6">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2.5">
          {lang === 'es' ? 'Color de ADN (primario)' : 'DNA color (primary)'}
        </div>
        <div className="flex flex-wrap gap-2">
          {DNA_COLORS.map((c) => (
            <motion.button
              key={c} type="button" whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.95 }}
              onClick={() => set({ primaryColor: c })}
              className="w-9 h-9 border-2 transition-all"
              style={{
                background: c,
                borderColor: draft.primaryColor === c ? '#fff' : 'transparent',
                boxShadow: draft.primaryColor === c ? `0 0 14px ${c}` : undefined,
              }}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2.5">
          {lang === 'es' ? 'Color de energía (acento)' : 'Energy color (accent)'}
        </div>
        <div className="flex flex-wrap gap-2">
          {DNA_COLORS.map((c) => (
            <motion.button
              key={c} type="button" whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.95 }}
              onClick={() => set({ accentColor: c })}
              className="w-9 h-9 border-2 transition-all"
              style={{
                background: c,
                borderColor: draft.accentColor === c ? '#fff' : 'transparent',
                boxShadow: draft.accentColor === c ? `0 0 14px ${c}` : undefined,
              }}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2.5">
          {lang === 'es' ? 'Distintivo' : 'Accessory'}
        </div>
        <div className="flex flex-wrap gap-2">
          {ACCESSORIES.map((a) => {
            const active = draft.accessory === a.value;
            return (
              <motion.button
                key={a.value} type="button" whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.96 }}
                onClick={() => set({ accessory: a.value })}
                className="flex items-center gap-2 font-mono text-[11px] px-3 py-1.5 border transition-all"
                style={{
                  borderColor: active ? draft.accentColor : '#262d3d',
                  color: active ? draft.accentColor : '#9ca3af',
                  background: active ? `${draft.accentColor}12` : undefined,
                }}
              >
                <span>{a.glyph}</span>{a.label[lang]}
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Step 5: Behavior ─────────────────────────────────────────────────────────

function BehaviorStep({ draft, set, lang }: StepProps) {
  return (
    <div className="space-y-7 max-w-lg">
      {BEHAVIOR_AXES.map((axis) => {
        const val = draft.behavior[axis.key];
        return (
          <div key={axis.key}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[12px] text-zinc-200">{axis.label[lang]}</span>
              <span className="font-mono text-[12px] tabular-nums" style={{ color: axis.color }}>{val}</span>
            </div>
            <input
              type="range" min={0} max={100} value={val}
              aria-label={axis.label[lang]}
              onChange={(e) => set({ behavior: { ...draft.behavior, [axis.key]: Number(e.target.value) } })}
              className="w-full genesis-range"
              style={{ accentColor: axis.color }}
            />
            <div className="flex items-center justify-between mt-1 font-mono text-[9px] text-zinc-600 uppercase tracking-wider">
              <span>{axis.lowLabel[lang]}</span>
              <span>{axis.highLabel[lang]}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 6: Mission ──────────────────────────────────────────────────────────

function MissionStep({ draft, set, lang }: StepProps) {
  return (
    <div className="space-y-4 max-w-lg">
      <Field label={lang === 'es' ? 'Nombre del agente' : 'Agent name'}>
        <input
          type="text" value={draft.name} maxLength={32}
          onChange={(e) => set({ name: e.target.value })}
          placeholder={lang === 'es' ? 'ej. Orion' : 'e.g. Orion'}
          className="w-full gx-tile font-mono text-[14px] text-zinc-100 px-3 py-2.5 focus:outline-none focus:border-zinc-400"
        />
      </Field>
      <Field label={lang === 'es' ? 'Título / Rol' : 'Title / Role'}>
        <input
          type="text" value={draft.role} maxLength={48}
          onChange={(e) => set({ role: e.target.value })}
          placeholder={lang === 'es' ? 'ej. Analista Senior de Mercados' : 'e.g. Senior Market Analyst'}
          className="w-full gx-tile font-mono text-[13px] text-zinc-100 px-3 py-2.5 focus:outline-none focus:border-zinc-400"
        />
      </Field>
      <Field label={lang === 'es' ? 'Departamento' : 'Department'}>
        <select
          value={draft.department ?? ''}
          aria-label={lang === 'es' ? 'Departamento' : 'Department'}
          onChange={(e) => set({ department: e.target.value as AgentDraft['department'] })}
          className="w-full gx-tile font-mono text-[13px] text-zinc-100 px-3 py-2.5 focus:outline-none focus:border-zinc-400"
        >
          <option value="" disabled>{lang === 'es' ? 'Selecciona…' : 'Select…'}</option>
          {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </Field>
      <Field label={lang === 'es' ? 'Declaración de misión' : 'Mission statement'}>
        <textarea
          value={draft.mission} maxLength={240} rows={3}
          onChange={(e) => set({ mission: e.target.value })}
          placeholder={lang === 'es' ? 'ej. Maximizar oportunidades en mercados de predicción con riesgo controlado.' : 'e.g. Maximize prediction-market opportunities with controlled risk.'}
          className="w-full gx-tile font-mono text-[12px] text-zinc-100 px-3 py-2.5 focus:outline-none focus:border-zinc-400 resize-none"
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

// ─── Reveal ───────────────────────────────────────────────────────────────────

function RevealScreen({
  draft, lang, onActivate, onBack,
}: { draft: AgentDraft; lang: 'es' | 'en'; onActivate: () => void; onBack: () => void }) {
  const gene = PERSONALITY_GENES.find((g) => g.archetype === draft.archetype);
  const brain = BRAIN_MODELS.find((b) => b.provider === draft.provider);

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center text-center px-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      {/* Birth animation */}
      <motion.div
        initial={{ scale: 0.3, opacity: 0, rotate: -20 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 70, damping: 12 }}
      >
        <AgentDnaCore draft={draft} intensity={1} size={280} />
      </motion.div>

      <motion.div
        initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }}
        className="mt-4"
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.4em] text-zinc-600 mb-2">
          {lang === 'es' ? 'Génesis completa' : 'Genesis complete'}
        </div>
        <h1 className="font-mono text-4xl text-zinc-100 mb-1">{draft.name || 'Agent'}</h1>
        <div className="font-mono text-[13px] mb-5" style={{ color: draft.primaryColor }}>
          {gene?.trait[lang]} · {draft.role || gene?.name[lang]}
        </div>

        {/* Spec chips */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-7 max-w-md mx-auto">
          <RevealChip label={brain?.name[lang] ?? '—'} color={brain?.color ?? '#6b7280'} />
          <RevealChip label={draft.department ?? '—'} color={draft.accentColor} />
          <RevealChip label={`${draft.skills.length} ${lang === 'es' ? 'skills' : 'skills'}`} color={draft.primaryColor} />
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button" onClick={onBack}
            className="font-mono text-[11px] uppercase tracking-wider px-5 py-2.5 text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            ← {lang === 'es' ? 'Ajustar' : 'Adjust'}
          </button>
          <motion.button
            type="button" onClick={onActivate}
            whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
            className="font-mono text-[12px] uppercase tracking-[0.2em] px-8 py-3 border transition-colors"
            style={{ borderColor: draft.primaryColor, color: draft.primaryColor, background: `${draft.primaryColor}10` }}
          >
            {lang === 'es' ? 'Activar agente' : 'Activate agent'}
          </motion.button>
        </div>
        <p className="font-mono text-[10px] text-zinc-600 mt-4">
          {lang === 'es' ? 'Aparecerá en Génesis HQ tras la incorporación.' : 'Will appear in Genesis HQ after onboarding.'}
        </p>
      </motion.div>
    </motion.div>
  );
}

function RevealChip({ label, color }: { label: string; color: string }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-wider px-2.5 py-1 border"
      style={{ borderColor: `${color}44`, color }}>
      {label}
    </span>
  );
}

// ─── Shared props ─────────────────────────────────────────────────────────────

interface StepProps {
  draft: AgentDraft;
  set: (patch: Partial<AgentDraft>) => void;
  lang: 'es' | 'en';
}
