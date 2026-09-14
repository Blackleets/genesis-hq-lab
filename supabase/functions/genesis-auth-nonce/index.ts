import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { getAddress, verifyMessage } from "npm:viem@2.55.19";
import bs58 from "npm:bs58@6.0.0";
import nacl from "npm:tweetnacl@1.0.3";

const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const NONCE_RE = /^[0-9a-f]{32}$/;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const AUTH_DISCLAIMER = "Solo autenticación. Esta firma NO autoriza transacciones ni transferencias.";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number) {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("");
}

function parseChain(value: unknown): "solana" | "evm" | null {
  return value === "solana" || value === "evm" ? value : null;
}

function canonicalAddress(address: string, chain: "solana" | "evm") {
  return chain === "solana" ? address.trim() : address.trim().toLowerCase();
}

function validAddress(address: string, chain: "solana" | "evm") {
  if (chain === "evm") return /^0x[0-9a-fA-F]{40}$/.test(address);
  try { return bs58.decode(address).length === 32; } catch { return false; }
}

function buildMessage(address: string, nonce: string, issuedAtIso: string) {
  return [
    "Genesis HQ Lab — login",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAtIso}`,
    AUTH_DISCLAIMER,
  ].join("\n");
}

function base64Bytes(value: string) {
  try {
    const raw = atob(value);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

async function validSignature(chain: "solana" | "evm", address: string, message: string, signature: string) {
  try {
    if (chain === "solana") {
      const publicKey = bs58.decode(address);
      const sig = base64Bytes(signature);
      if (publicKey.length !== 32 || sig.length !== 64) return false;
      return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, publicKey);
    }
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return false;
    return await verifyMessage({ address: getAddress(address), message, signature: signature as `0x${string}` });
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
  if (!url || !serviceKey) return json(503, { ok: false, error: "supabase_server_credentials_unavailable" });
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "invalid_json" }); }
  const action = typeof body.action === "string" ? body.action : "";
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  await db.from("genesis_auth_nonces").delete().lt("expires_at", nowIso);
  await db.from("genesis_auth_sessions").delete().lt("expires_at", nowIso);

  if (action === "issue") {
    const chain = parseChain(body.chain);
    const rawAddress = typeof body.address === "string" ? body.address.trim() : "";
    if (!chain || !validAddress(rawAddress, chain)) return json(400, { ok: false, error: "invalid_address" });
    const address = canonicalAddress(rawAddress, chain);
    const nonce = randomHex(16);
    const nonceHash = await sha256Hex(nonce);
    const issuedAtIso = new Date(now).toISOString();
    const expiresAt = now + NONCE_TTL_MS;
    const challengeMessage = buildMessage(address, nonce, issuedAtIso);
    const { error } = await db.from("genesis_auth_nonces").insert({
      nonce_hash: nonceHash,
      address,
      chain,
      issued_at: issuedAtIso,
      expires_at: new Date(expiresAt).toISOString(),
      challenge_message: challengeMessage,
    });
    if (error) {
      console.error("genesis_auth_issue", error.code);
      return json(503, { ok: false, error: "nonce_store_unavailable" });
    }
    return json(200, { ok: true, nonce, message: challengeMessage, chain });
  }

  if (action === "verify") {
    const nonce = typeof body.nonce === "string" ? body.nonce : "";
    const signature = typeof body.signature === "string" ? body.signature.trim() : "";
    const chain = parseChain(body.chain);
    const rawAddress = typeof body.address === "string" ? body.address.trim() : "";
    if (!NONCE_RE.test(nonce) || !signature || !chain || !validAddress(rawAddress, chain)) {
      return json(400, { ok: false, error: "invalid_request" });
    }
    const address = canonicalAddress(rawAddress, chain);
    const nonceHash = await sha256Hex(nonce);
    const { data: record, error } = await db
      .from("genesis_auth_nonces")
      .delete()
      .eq("nonce_hash", nonceHash)
      .gt("expires_at", nowIso)
      .select("address,chain,issued_at,expires_at,challenge_message")
      .maybeSingle();
    if (error) return json(503, { ok: false, error: "nonce_store_unavailable" });
    if (!record) return json(401, { ok: false, error: "invalid_or_expired_nonce" });
    if (record.chain !== chain || record.address !== address) return json(401, { ok: false, error: "nonce_binding_mismatch" });

    const exactMessage = typeof record.challenge_message === "string" && record.challenge_message.length > 0
      ? record.challenge_message
      : buildMessage(address, nonce, new Date(record.issued_at).toISOString());
    if (!(await validSignature(chain, address, exactMessage, signature))) {
      return json(401, { ok: false, error: "invalid_signature" });
    }

    const token = randomHex(32);
    const tokenHash = await sha256Hex(token);
    const issuedAt = now;
    const expiresAt = issuedAt + SESSION_TTL_MS;
    const role = "user";
    const { error: sessionError } = await db.from("genesis_auth_sessions").insert({
      token_hash: tokenHash,
      address,
      chain,
      role,
      issued_at: new Date(issuedAt).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
    });
    if (sessionError) return json(503, { ok: false, error: "session_store_unavailable" });

    return json(200, { ok: true, token, session: { address, chain, role, issuedAt, expiresAt } });
  }

  if (action === "session" || action === "logout") {
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!TOKEN_RE.test(token)) return json(401, { ok: false, error: "unauthorized" });
    const tokenHash = await sha256Hex(token);
    if (action === "logout") {
      await db.from("genesis_auth_sessions").delete().eq("token_hash", tokenHash);
      return json(200, { ok: true });
    }
    const { data, error } = await db
      .from("genesis_auth_sessions")
      .select("address,chain,role,issued_at,expires_at")
      .eq("token_hash", tokenHash)
      .gt("expires_at", nowIso)
      .maybeSingle();
    if (error) return json(503, { ok: false, error: "session_store_unavailable" });
    if (!data) return json(401, { ok: false, error: "unauthorized" });
    return json(200, {
      ok: true,
      session: {
        address: data.address,
        chain: data.chain,
        role: data.role === "operator" ? "operator" : "user",
        issuedAt: Date.parse(data.issued_at),
        expiresAt: Date.parse(data.expires_at),
      },
    });
  }

  return json(400, { ok: false, error: "invalid_action" });
});
