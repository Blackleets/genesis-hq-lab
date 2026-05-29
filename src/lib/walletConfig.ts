import { createConfig, http } from 'wagmi';
import { mainnet, polygon, base } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

const wcProjectId = typeof import.meta !== 'undefined'
  ? (import.meta.env.VITE_WC_PROJECT_ID as string | undefined)
  : undefined;

const connectors = wcProjectId && wcProjectId.length > 8
  ? [injected(), walletConnect({ projectId: wcProjectId })]
  : [injected()];

export const wagmiConfig = createConfig({
  chains: [polygon, mainnet, base],
  transports: {
    [polygon.id]: http('https://polygon-rpc.com'),
    [mainnet.id]: http(),
    [base.id]:    http(),
  },
  connectors,
});
