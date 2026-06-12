// clobSigner.mjs — EIP-712 order signing for Polymarket CLOB API.
// Uses viem's privateKeyToAccount().signTypedData() — no new dependencies.
// Exact schema confirmed from @polymarket/order-utils@3.0.1 source.
// This module only signs; it never submits orders to any network.

import { privateKeyToAccount } from 'viem/accounts';

// CTFExchange on Polygon Mainnet — confirmed from @polymarket/order-utils source
const CLOB_DOMAIN = {
  name: 'Polymarket CTF Exchange',
  version: '1',
  chainId: 137,
  verifyingContract: '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
};

// Exact field order from @polymarket/order-utils@3.0.1
const ORDER_TYPES = {
  Order: [
    { name: 'salt',          type: 'uint256' },
    { name: 'maker',         type: 'address' },
    { name: 'signer',        type: 'address' },
    { name: 'taker',         type: 'address' },
    { name: 'tokenId',       type: 'uint256' },
    { name: 'makerAmount',   type: 'uint256' },
    { name: 'takerAmount',   type: 'uint256' },
    { name: 'expiration',    type: 'uint256' },
    { name: 'nonce',         type: 'uint256' },
    { name: 'feeRateBps',    type: 'uint256' },
    { name: 'side',          type: 'uint8'   },
    { name: 'signatureType', type: 'uint8'   },
  ],
};

// SignatureType.EOA = 0 (standard EOA signing)
const SIGNATURE_TYPE_EOA = 0;
// Taker = zero address (open order, anyone can fill)
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
// 6 decimal precision for all amounts
const USDC_DECIMALS = 1e6;

/**
 * Compute makerAmount and takerAmount for a BUY or SELL.
 * Both values are BigInt with 6 decimal precision (USDC).
 *
 * BUY: spending makerAmount USDC to receive takerAmount tokens
 * SELL: spending makerAmount tokens to receive takerAmount USDC
 */
export function computeOrderAmounts(side, price, sizeUsd) {
  if (price <= 0 || price >= 1) throw new Error(`price must be in (0,1), got ${price}`);
  if (sizeUsd <= 0) throw new Error(`sizeUsd must be positive, got ${sizeUsd}`);

  if (side === 'BUY') {
    // makerAmount = USDC in, takerAmount = outcome tokens received
    const makerAmount = BigInt(Math.round(price * sizeUsd * USDC_DECIMALS));
    const takerAmount = BigInt(Math.round(sizeUsd * USDC_DECIMALS));
    return { makerAmount, takerAmount };
  } else {
    // SELL: makerAmount = outcome tokens in, takerAmount = USDC received
    const makerAmount = BigInt(Math.round(sizeUsd * USDC_DECIMALS));
    const takerAmount = BigInt(Math.round(price * sizeUsd * USDC_DECIMALS));
    return { makerAmount, takerAmount };
  }
}

/**
 * Build and sign an EIP-712 order struct for the Polymarket CLOB API.
 *
 * @param {object} params
 * @param {string} params.tokenId       - ERC-1155 condition token ID (outcome token address)
 * @param {'BUY'|'SELL'} params.side    - order direction
 * @param {number} params.price         - probability price in (0, 1)
 * @param {number} params.sizeUsd       - notional size in USD
 * @param {number} [params.feeRateBps]  - fee rate in basis points (default 0)
 * @param {number} [params.expiration]  - unix timestamp (0 = no expiry, GTC)
 * @param {string} privateKey           - 0x-prefixed hex private key
 * @returns {Promise<{ orderStruct: object, signature: string, signerAddress: string }>}
 */
export async function buildSignedOrder(
  { tokenId, side, price, sizeUsd, feeRateBps = 0, expiration = 0 },
  privateKey,
) {
  if (!privateKey || !privateKey.startsWith('0x')) {
    throw new Error('privateKey must be a 0x-prefixed hex string');
  }

  const account = privateKeyToAccount(/** @type {`0x${string}`} */ (privateKey));
  const signerAddress = account.address;

  const { makerAmount, takerAmount } = computeOrderAmounts(side, price, sizeUsd);

  // Unique per order — prevents replay
  const salt = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

  const orderStruct = {
    salt,
    maker:         signerAddress,
    signer:        signerAddress,
    taker:         ZERO_ADDRESS,
    tokenId:       BigInt(tokenId),
    makerAmount,
    takerAmount,
    expiration:    BigInt(expiration),
    nonce:         0n,
    feeRateBps:    BigInt(feeRateBps),
    side:          side === 'BUY' ? 0 : 1,
    signatureType: SIGNATURE_TYPE_EOA,
  };

  const signature = await account.signTypedData({
    domain:      CLOB_DOMAIN,
    types:       ORDER_TYPES,
    primaryType: 'Order',
    message:     orderStruct,
  });

  return { orderStruct, signature, signerAddress };
}

/**
 * Serialize an orderStruct to the JSON wire format expected by POST /order.
 * BigInt fields are serialized to decimal strings.
 */
export function serializeOrder(orderStruct, signature, signerAddress) {
  return {
    salt:          orderStruct.salt.toString(),
    maker:         orderStruct.maker,
    signer:        orderStruct.signer,
    taker:         orderStruct.taker,
    tokenId:       orderStruct.tokenId.toString(),
    makerAmount:   orderStruct.makerAmount.toString(),
    takerAmount:   orderStruct.takerAmount.toString(),
    expiration:    orderStruct.expiration.toString(),
    nonce:         orderStruct.nonce.toString(),
    feeRateBps:    orderStruct.feeRateBps.toString(),
    side:          orderStruct.side,
    signatureType: orderStruct.signatureType,
    signature,
    maker_address: signerAddress,
  };
}
