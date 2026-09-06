// HQView — trading cockpit first, institutional control below.

import { useLanguage } from '@core/i18n/languageStore';
import { AutonomousTradingTerminal } from '@components/crypto/AutonomousTradingTerminal';
import { GenesisCommandCenter } from '@components/crypto/GenesisCommandCenter';

export default function HQView() {
  const lang = useLanguage();
  const es = lang === 'es';

  return (
    <main className="gx-scroll flex-1 min-w-0 min-h-0 bg-[#03050a] overflow-y-auto">
      <AutonomousTradingTerminal es={es} />
      <GenesisCommandCenter es={es} />
    </main>
  );
}
