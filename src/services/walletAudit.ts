// walletAudit — user-verifiable audit trail of every wallet interaction.
//
// Security you can check, not security you must trust: every action the app
// takes against a connected wallet (connect, portfolio read, disconnect, RPC
// error) is recorded locally with a timestamp, viewable in the UI and
// exportable as JSON. The log lives ONLY in the user's browser — it is never
// uploaded anywhere.

export type WalletAuditKind =
  | 'connect'
  | 'reconnect_trusted'
  | 'read_portfolio'
  | 'rpc_error'
  | 'disconnect';

export interface WalletAuditEvent {
  ts: string;
  kind: WalletAuditKind;
  detail: string;
}

const KEY = 'genesis.wallet.audit.v1';
const MAX_EVENTS = 200;

export function auditLog(kind: WalletAuditKind, detail: string) {
  try {
    const raw = localStorage.getItem(KEY);
    const events = raw ? (JSON.parse(raw) as WalletAuditEvent[]) : [];
    events.push({ ts: new Date().toISOString(), kind, detail });
    localStorage.setItem(KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  } catch { /* storage unavailable — never break the app for the log */ }
}

export function readAuditLog(): WalletAuditEvent[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WalletAuditEvent[]) : [];
  } catch {
    return [];
  }
}

export function exportAuditLog() {
  const events = readAuditLog();
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), events }, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `genesis-wallet-audit-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// The capability contract shown to users — what this app CAN and CANNOT do
// with a connected wallet. Rendered verbatim in the security panel.
export const WALLET_CAPABILITIES = {
  can: [
    { es: 'Leer tu dirección pública', en: 'Read your public address' },
    { es: 'Leer saldos y tokens on-chain (RPC público)', en: 'Read on-chain balances and tokens (public RPC)' },
    { es: 'Consultar precios en APIs públicas', en: 'Query prices from public APIs' },
  ],
  cannot: [
    { es: 'Construir o firmar transacciones', en: 'Build or sign transactions' },
    { es: 'Mover, gastar o aprobar fondos', en: 'Move, spend, or approve funds' },
    { es: 'Acceder a tu llave privada o frase semilla', en: 'Access your private key or seed phrase' },
    { es: 'Subir tu dirección o portfolio a servidores', en: 'Upload your address or portfolio to servers' },
  ],
};
