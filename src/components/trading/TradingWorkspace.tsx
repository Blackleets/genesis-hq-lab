import { lazy, Suspense, useCallback, useState } from 'react';
import { TradingDeskProvider } from './TradingDeskProvider';
import { NativeMobileApp } from './NativeMobileApp';
import './tradingWorkspace.css';
import './nativeQuality.css';
import './mobileFirstV3.css';

const ControlDrawer = lazy(() => import('./ControlDrawer').then((module) => ({ default: module.ControlDrawer })));

function GenesisAppShell() {
  const [controlOpen, setControlOpen] = useState(false);
  const closeControl = useCallback(() => setControlOpen(false), []);
  const openControl = useCallback(() => setControlOpen(true), []);

  return (
    <>
      <NativeMobileApp onControl={openControl} />
      <Suspense fallback={null}><ControlDrawer open={controlOpen} onClose={closeControl} /></Suspense>
    </>
  );
}

export function TradingWorkspace() {
  return <TradingDeskProvider><GenesisAppShell /></TradingDeskProvider>;
}
