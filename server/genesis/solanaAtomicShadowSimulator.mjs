import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

export const SOLANA_ATOMIC_SIMULATION_POLICY = Object.freeze({
  version: 'solana-atomic-shadow-v1',
  executionAuthority: false,
  signs: false,
  broadcasts: false,
  liveLocked: true,
});

async function rpc({ config, fetchImpl, method, params }) {
  const response = await fetchImpl(config.solanaRpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method}_http_${response.status}`);
  const body = await response.json();
  if (body?.error) throw new Error(`${method}_${body.error.code ?? 'error'}:${String(body.error.message ?? '').slice(0, 120)}`);
  return body?.result;
}

function instructionFromJupiter(value) {
  if (!value?.programId || !Array.isArray(value.accounts) || typeof value.data !== 'string') {
    throw new Error('invalid_jupiter_instruction');
  }
  return new TransactionInstruction({
    programId: new PublicKey(value.programId),
    keys: value.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner === true,
      isWritable: account.isWritable === true,
    })),
    data: Buffer.from(value.data, 'base64'),
  });
}

function routeInstructions(body) {
  return [
    ...(body?.setupInstructions ?? []),
    ...(body?.otherInstructions ?? []),
    body?.swapInstruction,
  ].filter(Boolean).map(instructionFromJupiter);
}

function cleanupInstructions(first, second) {
  return [first?.cleanupInstruction, second?.cleanupInstruction].filter(Boolean).map(instructionFromJupiter);
}

function tokenAmountFromAccountData(data) {
  const encoded = Array.isArray(data) ? data[0] : null;
  if (typeof encoded !== 'string') throw new Error('token_account_data_missing');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 72) throw new Error('token_account_data_invalid');
  return bytes.readBigUInt64LE(64);
}

async function resolveLookupTables(addresses, { config, fetchImpl }) {
  const unique = [...new Set((addresses ?? []).filter(Boolean))];
  if (!unique.length) return [];
  const result = await rpc({
    config,
    fetchImpl,
    method: 'getMultipleAccounts',
    params: [unique, { encoding: 'base64', commitment: 'processed' }],
  });
  if (!Array.isArray(result?.value) || result.value.length !== unique.length) throw new Error('lookup_table_accounts_unavailable');
  return result.value.map((account, index) => {
    if (!account?.data) throw new Error('lookup_table_account_missing');
    return new AddressLookupTableAccount({
      key: new PublicKey(unique[index]),
      state: AddressLookupTableAccount.deserialize(Buffer.from(account.data[0], 'base64')),
    });
  });
}

async function findUsdcTokenAccount({ config, fetchImpl, usdcMint }) {
  const result = await rpc({
    config,
    fetchImpl,
    method: 'getTokenAccountsByOwner',
    params: [config.observerPublicKey, { mint: usdcMint }, { encoding: 'base64', commitment: 'processed' }],
  });
  const account = result?.value?.[0];
  if (!account?.pubkey || !account?.account?.data) throw new Error('observer_usdc_account_missing');
  return { pubkey: account.pubkey, amountRaw: tokenAmountFromAccountData(account.account.data) };
}

export async function buildUnsignedAtomicRoundTrip({
  firstLeg,
  secondLeg,
  instructionSets,
  config,
  fetchImpl = fetch,
  usdcMint,
}) {
  if (!config.observerPublicKey) throw new Error('observer_public_key_not_configured');
  if (!instructionSets?.first || !instructionSets?.second) throw new Error('jupiter_instruction_sets_missing');
  const tokenAccount = await findUsdcTokenAccount({ config, fetchImpl, usdcMint });
  const latest = await rpc({ config, fetchImpl, method: 'getLatestBlockhash', params: [{ commitment: 'processed' }] });
  if (!latest?.value?.blockhash) throw new Error('recent_blockhash_missing');
  const lookupTables = await resolveLookupTables([
    ...(instructionSets.first.addressLookupTableAddresses ?? []),
    ...(instructionSets.second.addressLookupTableAddresses ?? []),
  ], { config, fetchImpl });
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: config.computeUnitLimit }),
    ...routeInstructions(instructionSets.first),
    ...routeInstructions(instructionSets.second),
    ...cleanupInstructions(instructionSets.first, instructionSets.second),
  ];
  const message = new TransactionMessage({
    payerKey: new PublicKey(config.observerPublicKey),
    recentBlockhash: latest.value.blockhash,
    instructions,
  }).compileToV0Message(lookupTables);
  const transaction = new VersionedTransaction(message);
  const inputRaw = BigInt(firstLeg.quote.inAmount);
  const minOutRaw = BigInt(secondLeg.quote.otherAmountThreshold ?? secondLeg.quote.outAmount);
  if (tokenAccount.amountRaw < inputRaw) throw new Error('observer_usdc_balance_insufficient');
  return {
    transaction,
    usdcTokenAccount: tokenAccount.pubkey,
    preUsdcRaw: tokenAccount.amountRaw,
    minimumFinalUsdcRaw: tokenAccount.amountRaw - inputRaw + minOutRaw,
    minOut: Number(minOutRaw) / 1_000_000,
    policy: SOLANA_ATOMIC_SIMULATION_POLICY,
  };
}

export async function simulateUnsignedAtomicRoundTrip({ transaction, config, fetchImpl = fetch }) {
  if (!transaction?.transaction || !transaction?.usdcTokenAccount) {
    return { success: false, balancesVerified: false, minOutVerified: false, error: 'unsigned_atomic_transaction_missing' };
  }
  try {
    const serialized = Buffer.from(transaction.transaction.serialize()).toString('base64');
    const result = await rpc({
      config,
      fetchImpl,
      method: 'simulateTransaction',
      params: [serialized, {
        encoding: 'base64',
        commitment: 'processed',
        sigVerify: false,
        replaceRecentBlockhash: true,
        accounts: { encoding: 'base64', addresses: [transaction.usdcTokenAccount] },
      }],
    });
    const postAccount = result?.value?.accounts?.[0];
    const postUsdcRaw = postAccount?.data ? tokenAmountFromAccountData(postAccount.data) : null;
    const success = result?.value?.err == null;
    const minOutVerified = success && postUsdcRaw !== null && postUsdcRaw >= transaction.minimumFinalUsdcRaw;
    return {
      success: success && minOutVerified,
      balancesVerified: postUsdcRaw !== null,
      minOutVerified,
      unitsConsumed: Number.isFinite(Number(result?.value?.unitsConsumed)) ? Number(result.value.unitsConsumed) : null,
      preUsdcRaw: String(transaction.preUsdcRaw),
      postUsdcRaw: postUsdcRaw === null ? null : String(postUsdcRaw),
      minimumFinalUsdcRaw: String(transaction.minimumFinalUsdcRaw),
      error: success ? (minOutVerified ? null : 'minimum_final_usdc_not_met') : JSON.stringify(result?.value?.err ?? 'simulation_failed').slice(0, 240),
      logs: Array.isArray(result?.value?.logs) ? result.value.logs.slice(-10) : [],
      policy: SOLANA_ATOMIC_SIMULATION_POLICY,
    };
  } catch (error) {
    return { success: false, balancesVerified: false, minOutVerified: false, error: String(error?.message ?? error).slice(0, 240) };
  }
}
