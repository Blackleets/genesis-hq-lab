import { saveTrade } from '../memory/tradingMemory.mjs';
import { computePaperFillCosts } from './costs.mjs';

const KALSHI_BASE = 'https://trading-api.kalshi.com/trade-api/v2';

export const REAL_TRADING_ENABLED = ['1', 'true', 'yes'].includes(
    (process.env.REAL_TRADING ?? '').toLowerCase()
);

export async function executeTrade(tradeProposal) {
    if (!REAL_TRADING_ENABLED) {
        const costs = computePaperFillCosts({
            entryPrice: tradeProposal.entryPrice,
            shares:     tradeProposal.shares,
            capitalUsed: tradeProposal.capitalUsed,
            volume24h:  tradeProposal.volume24hUsd ?? 5000,
        });
        const tradeId = saveTrade({
            ...tradeProposal,
            entryPrice:  costs.effectivePrice,
            shares:      costs.effectiveShares,
            capitalUsed: costs.effectiveCapital,
            reason: `${tradeProposal.reason ?? ''} | ${costs.costNote}`.trim().replace(/^\| /, ''),
        });
        console.log(`[execution] paper fill costs: ${costs.costNote}`);
        return { executed: true, tradeId, mode: 'paper', costs };
    }

    if (tradeProposal.marketSource === 'kalshi') {
        const orderResult = await placeKalshiOrder(tradeProposal);
        if (!orderResult.ok) {
            console.warn('[execution] Kalshi order failed:', orderResult.error);
            const fallbackId = saveTrade({
                ...tradeProposal,
                reason: `${tradeProposal.reason} | REAL ORDER FAILED: ${orderResult.error}`,
            });
            return { executed: true, tradeId: fallbackId, mode: 'paper', fallback: true, error: orderResult.error };
        }

        const tradeId = saveTrade(tradeProposal);
        return { executed: true, tradeId, mode: 'real', orderId: orderResult.orderId };
    }

    const reason = `Real trading is not yet supported for source ${tradeProposal.marketSource}`;
    console.warn('[execution] Unsupported real trading source:', tradeProposal.marketSource);
    return { executed: false, reason };
}

async function placeKalshiOrder(tradeProposal) {
    const apiKey = process.env.KALSHI_API_KEY;
    if (!apiKey) {
        return { ok: false, error: 'KALSHI_API_KEY not configured' };
    }

    if (!tradeProposal.shares || tradeProposal.shares <= 0) {
        return { ok: false, error: 'Invalid Kalshi order size' };
    }

    const side = (tradeProposal.outcome ?? 'YES').toString().toLowerCase();
    if (side !== 'yes' && side !== 'no') {
        return { ok: false, error: `Unknown Kalshi side: ${tradeProposal.outcome}` };
    }

    const price = Number(tradeProposal.entryPrice);
    const orderCandidates = [
        {
            market: tradeProposal.marketId,
            side,
            order_type: 'limit',
            price,
            quantity: tradeProposal.shares,
            time_in_force: 'day',
        },
        {
            market: tradeProposal.marketId,
            side,
            type: 'limit',
            price,
            quantity: tradeProposal.shares,
            time_in_force: 'day',
        },
        {
            market: tradeProposal.marketId,
            side,
            order_type: 'limit',
            price,
            qty: tradeProposal.shares,
            time_in_force: 'day',
        },
        {
            market: tradeProposal.marketId,
            side,
            type: 'limit',
            price,
            qty: tradeProposal.shares,
            time_in_force: 'day',
        },
    ];

    const endpoints = [
        `${KALSHI_BASE}/orders`,
        `${KALSHI_BASE}/portfolio/orders`,
    ];

    for (const endpoint of endpoints) {
        for (const orderPayload of orderCandidates) {
            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(orderPayload),
                    signal: AbortSignal.timeout(10000),
                });

                const responseBody = await res.text();
                let data;
                try {
                    data = responseBody ? JSON.parse(responseBody) : {};
                } catch {
                    data = { raw: responseBody };
                }

                if (res.ok) {
                    const orderId = data?.order?.id || data?.order_id || data?.id || null;
                    if (!orderId) {
                        return { ok: false, error: 'Kalshi order placed but response did not include an order ID' };
                    }
                    return { ok: true, orderId, order: data };
                }

                if (res.status === 404 || res.status === 405) {
                    // Try the next candidate endpoint if the path is not supported.
                    break;
                }

                const errorMessage = data?.error || data?.message || `HTTP ${res.status}`;
                return { ok: false, error: `Kalshi order rejected: ${errorMessage}` };
            } catch (err) {
                if (endpoint === endpoints[endpoints.length - 1] && orderPayload === orderCandidates[orderCandidates.length - 1]) {
                    return { ok: false, error: `Kalshi order failed: ${err.message}` };
                }
                // Otherwise, attempt the next payload variation.
            }
        }
    }

    return { ok: false, error: 'Kalshi order endpoint not found' };
}
