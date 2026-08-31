// ConnectWalletGate.tsx — carbon-styled entry screen shown while there is no
// wallet session. On successful connectAndSign it renders the app (children).
//
// Design: DESIGN_DIRECTION.md carbon palette (#0a0c12 background, #e6edf3
// text, Strategy Lab cyan #22d3ee accent). No neon glow.

import type { ReactNode } from 'react';
import { useWalletAuth, type AuthStatus } from '@core/auth/WalletAuthProvider';

const BUSY_LABELS: Partial<Record<AuthStatus, string>> = {
  connecting: 'Conectando wallet…',
  signing: 'Esperando tu firma en la wallet…',
  verifying: 'Verificando firma…',
};

export default function ConnectWalletGate({ children }: { children: ReactNode }) {
  const { session, status, error, connectAndSign } = useWalletAuth();

  // Authenticated → the app itself.
  if (session) return <>{children}</>;

  const busy = status === 'connecting' || status === 'signing' || status === 'verifying';
  const busyLabel = BUSY_LABELS[status];
  const failed = status === 'error';

  return (
    <div className="h-dvh w-full flex items-center justify-center bg-[#0a0c12] text-[#e6edf3]">
      <div className="w-full max-w-md px-8 py-10 flex flex-col items-center text-center">
        {/* Mark — simple geometric monogram on a carbon tile. */}
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded bg-[#10131a] border border-[#262d3d]">
          <span className="text-xl font-bold text-[#22d3ee] font-mono">G</span>
        </div>

        <h1 className="text-2xl font-bold tracking-tight">Genesis HQ Lab</h1>

        <p className="mt-4 text-[13px] leading-relaxed text-zinc-400 max-w-sm">
          Entra con tu wallet. Cada operador ve únicamente sus propios datos.
          Solo se te pedirá una firma de autenticación — NUNCA una transacción
          ni transferencia.
        </p>

        <button
          onClick={() => void connectAndSign()}
          disabled={busy}
          className={`mt-8 w-full rounded px-6 py-3 text-[15px] font-semibold transition-colors ${
            busy
              ? 'cursor-wait bg-[#10131a] text-zinc-500 border border-[#262d3d]'
              : 'bg-[#22d3ee] text-[#0a0c12] hover:bg-[#5fe3f5]'
          }`}
        >
          {busyLabel ?? 'Connect Wallet'}
        </button>

        {(busy || failed) && (
          <div
            role="status"
            className={`mt-4 text-[12px] ${failed ? 'text-red-400' : 'text-zinc-500'}`}
          >
            {failed ? error : busyLabel}
          </div>
        )}

        <p className="mt-10 text-[11px] text-zinc-600">
          Simulación paper · cero custodia · cero fondos reales
        </p>
      </div>
    </div>
  );
}
