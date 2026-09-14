// api/_lib/solanaAuth.js — minimal Solana owner-auth primitives.
// No SDK dependency is required: public keys are base58-decoded and Phantom/
// Solflare signatures are verified with Node's native Ed25519 implementation.
import { createPublicKey, verify as verifyDetached } from 'node:crypto';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_INDEX = new Map([...BASE58_ALPHABET].map((char, index) => [char, index]));
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function decodeBase58(value) {
  if (typeof value !== 'string' || !value.length) throw new Error('invalid_base58');
  let num = 0n;
  for (const char of value) {
    const digit = BASE58_INDEX.get(char);
    if (digit === undefined) throw new Error('invalid_base58');
    num = num * 58n + BigInt(digit);
  }

  const tail = [];
  while (num > 0n) {
    tail.push(Number(num & 0xffn));
    num >>= 8n;
  }
  tail.reverse();

  let leadingZeroes = 0;
  while (leadingZeroes < value.length && value[leadingZeroes] === '1') leadingZeroes += 1;
  return Uint8Array.from([...new Array(leadingZeroes).fill(0), ...tail]);
}

export function isValidSolanaPublicKey(address) {
  try {
    return decodeBase58(String(address || '').trim()).length === 32;
  } catch {
    return false;
  }
}

export function canonicalWalletAddress(address, chain = 'evm') {
  const value = String(address || '').trim();
  return chain === 'solana' ? value : value.toLowerCase();
}

export function verifySolanaMessageSignature({ address, message, signatureBase64 }) {
  try {
    const publicKeyBytes = Buffer.from(decodeBase58(address));
    const signature = Buffer.from(String(signatureBase64 || ''), 'base64');
    if (publicKeyBytes.length !== 32 || signature.length !== 64) return false;
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyBytes]),
      format: 'der',
      type: 'spki',
    });
    return verifyDetached(null, Buffer.from(String(message), 'utf8'), publicKey, signature);
  } catch {
    return false;
  }
}
