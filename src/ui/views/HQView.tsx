// HQView — public root. Exchange-grade command center, not visual theater.

import { useLanguage } from '@core/i18n/languageStore';
import { GenesisCommandCenter } from '@components/crypto/GenesisCommandCenter';

export default function HQView() {
  const lang = useLanguage();
  const es = lang === 'es';

  return (
    <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#03050a] overflow-hidden">
      <GenesisCommandCenter es={es} />
    </main>
  );
}
