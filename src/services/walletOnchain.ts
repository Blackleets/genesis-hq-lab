import { createPublicClient, http, formatUnits } from 'viem';
import { mainnet, polygon, base } from 'viem/chains';

// Multi-chain public clients
export const clients = {
  polygon: createPublicClient({ chain: polygon, transport: http('https://polygon-rpc.com') }),
  mainnet: createPublicClient({ chain: mainnet, transport: http() }),
  base:    createPublicClient({ chain: base,    transport: http() }),
};

// Keep the original for backwards compatibility
export const publicClient = clients.polygon;

// USDC contract addresses per chain
const USDC: Record<number, `0x${string}`> = {
  [polygon.id]: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  [mainnet.id]: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  [base.id]:    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
};

function clientForChain(chainId: number) {
  if (chainId === mainnet.id) return clients.mainnet;
  if (chainId === base.id)    return clients.base;
  return clients.polygon;
}

export async function getNativeBalance(address: `0x${string}`, chainId: number = polygon.id): Promise<string> {
  try {
    const client = clientForChain(chainId);
    const balance = await client.getBalance({ address });
    return parseFloat(formatUnits(balance, 18)).toFixed(4);
  } catch {
    return '—';
  }
}

export async function getUsdcBalance(address: `0x${string}`, chainId: number = polygon.id): Promise<string> {
  const usdcAddress = USDC[chainId];
  if (!usdcAddress) return '—';
  try {
    const client = clientForChain(chainId);
    const balance = await client.readContract({
      address: usdcAddress,
      abi: [{
        name: 'balanceOf',
        type: 'function',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
      }] as const,
      functionName: 'balanceOf',
      args: [address],
    });
    return parseFloat(formatUnits(balance as bigint, 6)).toFixed(2);
  } catch {
    return '—';
  }
}

// Backwards compat alias
export const getMaticBalance = (address: `0x${string}`) => getNativeBalance(address, polygon.id);

export function chainLabel(chainId: number): { name: string; color: string; symbol: string } {
  if (chainId === mainnet.id) return { name: 'Ethereum',  color: '#6b8de3', symbol: 'ETH' };
  if (chainId === base.id)    return { name: 'Base',      color: '#0052ff', symbol: 'ETH' };
  return                             { name: 'Polygon',   color: '#8247e5', symbol: 'MATIC' };
}
