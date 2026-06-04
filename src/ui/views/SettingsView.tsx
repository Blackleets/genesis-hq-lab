// SettingsView — language, dev mode, reset, MCP connectors.

import { setLanguage, useLanguage, useT } from '@core/i18n/languageStore';
import { actions, useDevMode } from '@core/store/genesisStore';
import ConnectorsPanel from '@ui/ConnectorsPanel';

export default function SettingsView() {
  const t = useT();
  const lang = useLanguage();
  const devMode = useDevMode();
  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">
            {t('header.title')}
          </div>
          <h1 className="font-mono text-2xl text-zinc-100">{t('settings.title')}</h1>
          <p className="font-mono text-[12px] text-zinc-500 mt-1">{t('settings.intro')}</p>
        </header>
        <section className="gx-card p-4">
          <div className="gx-label mb-2">
            {t('settings.language')}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setLanguage('es')}
              className={`font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border ${lang === 'es' ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200' : 'border-trim text-zinc-300 hover:bg-white/5'}`}>
              {t('settings.language.es')}
            </button>
            <button type="button" onClick={() => setLanguage('en')}
              className={`font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border ${lang === 'en' ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200' : 'border-trim text-zinc-300 hover:bg-white/5'}`}>
              {t('settings.language.en')}
            </button>
          </div>
        </section>
        <section className="gx-card p-4">
          <div className="gx-label mb-2">
            {t('settings.devMode')}
          </div>
          <p className="font-mono text-[11px] text-zinc-500 mb-3">{t('settings.devMode.desc')}</p>
          <button type="button" onClick={() => actions.setDevMode(!devMode)}
            className={`font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border ${devMode ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200' : 'border-trim text-zinc-300 hover:bg-white/5'}`}>
            {devMode ? 'on' : 'off'}
          </button>
        </section>
        <section className="border border-red-400/40 bg-red-500/5 p-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-red-300 mb-2">
            {t('settings.reset')}
          </div>
          <p className="font-mono text-[11px] text-red-200/80 mb-3">{t('settings.reset.confirm')}</p>
          <button type="button" onClick={() => { if (window.confirm(t('settings.reset.confirm'))) actions.reset(); }}
            className="font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border border-red-400/60 text-red-300 hover:bg-red-400/10">
            {t('settings.reset')}
          </button>
        </section>
        <section className="gx-card p-4">
          <p className="font-mono text-[11px] text-zinc-500 leading-snug">
            {t('settings.lockedSection')}
          </p>
        </section>

        {/* MCP Connectors */}
        <div>
          <div className="gx-card-title mb-3">
            {lang === 'es' ? 'Conectores MCP' : 'MCP Connectors'}
          </div>
          <ConnectorsPanel />
        </div>
      </div>
    </main>
  );
}
