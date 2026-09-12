// Legacy settings route retained only so old references fail safely.
// It is no longer mounted in the production navigation.

import { setLanguage, useLanguage } from '@core/i18n/languageStore';
import { actions } from '@core/store/genesisStore';

export default function SettingsView() {
  const lang = useLanguage();
  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-[#07090e] text-zinc-100 p-5 md:p-8">
      <div className="max-w-xl mx-auto border border-zinc-800 bg-[#0d1118] p-5">
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-zinc-600">Genesis HQ</div>
        <h1 className="text-xl font-semibold mt-2">{lang === 'es' ? 'Preferencias' : 'Preferences'}</h1>
        <p className="text-sm text-zinc-500 mt-2">
          {lang === 'es' ? 'La configuración técnica del laboratorio, MCP, resets y secretos ya no se expone en la interfaz operativa.' : 'Lab configuration, MCP, resets and secrets are no longer exposed in the operating interface.'}
        </p>
        <div className="mt-5 flex items-center gap-2">
          <button type="button" onClick={() => setLanguage('es')} className={`border px-3 py-2 text-xs ${lang === 'es' ? 'border-cyan-400/40 text-cyan-200' : 'border-zinc-700 text-zinc-500'}`}>Español</button>
          <button type="button" onClick={() => setLanguage('en')} className={`border px-3 py-2 text-xs ${lang === 'en' ? 'border-cyan-400/40 text-cyan-200' : 'border-zinc-700 text-zinc-500'}`}>English</button>
        </div>
        <button type="button" onClick={() => actions.setSelectedModule('hq')} className="mt-6 border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:border-cyan-400/40">← Command Center</button>
      </div>
    </main>
  );
}
