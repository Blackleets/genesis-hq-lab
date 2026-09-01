// HQView — public root. Serious capture desk. No pixel office.

import { useLanguage } from '@core/i18n/languageStore';
import { CaptureDeskPanel } from '@components/crypto/CaptureDeskPanel';

export default function HQView() {
  const lang = useLanguage();
  const es = lang === 'es';

  return (
    <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#0a0c12] overflow-hidden">
      <CaptureDeskPanel es={es} />
    </main>
  );
}
