// server/lib/ap-signature.js
//
// Phase 12 (Item 5) — HTTP Signatures for ActivityPub.
//
// Implements just enough of draft-cavage-http-signatures-10 (the
// version Mastodon, Pleroma, Misskey, and most of the Fediverse
// agree on) to:
//   - sign outbound inbox deliveries we POST to peers
//   - verify the signature on incoming POSTs to our inbox
//
// Why not pull `http-signature`?
//   - The npm package is CommonJS + uses request-style header dicts and
//     is awkward inside our ESM/Express world.
//   - The actual crypto is two `crypto.createSign`/`createVerify` calls
//     against a tiny canonicalised signing string. Doing it by hand
//     keeps the dependency surface honest and avoids the well-known
//     edge cases where http-signature silently passes malformed input.
//
// No fake "valid" path: verification rejects when the actor's public
// key can't be resolved, when the signed string doesn't match, or when
// a required header is missing. Callers can decide whether to soft-fail
// (development) or hard-fail (production, gate via
// CONCORD_AP_REQUIRE_SIGNATURE=true).

import crypto from "node:crypto";

/**
 * Parse the `Signature:` request header into an object.
 *
 * Mastodon-style header:
 *   keyId="https://peer/users/alice#main-key",
 *   algorithm="rsa-sha256",
 *   headers="(request-target) host date digest",
 *   signature="BASE64..."
 *
 * Returns null when the header is missing or unparseable.
 */
export function parseSignatureHeader(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return null;
  const out = {};
  // Match key="value" pairs allowing escaped quotes inside (rare but legal).
  const re = /([a-zA-Z]+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(headerValue)) !== null) {
    out[m[1]] = m[2].replace(/\\(.)/g, "$1");
  }
  if (!out.keyId || !out.signature) return null;
  out.algorithm = out.algorithm || "rsa-sha256";
  out.headers = out.headers || "(created)";
  return out;
}

/**
 * Build the canonicalised signing string for a set of header names.
 * Per RFC: each line is `name: value`; the special `(request-target)`
 * pseudo-header is `(request-target): {method} {path}`.
 */
export function buildSigningString({ headers, method, path: requestPath, headerNames }) {
  const lower = {};
  for (const [k, v] of Object.entries(headers || {})) lower[String(k).toLowerCase()] = v;
  const lines = [];
  for (const rawName of headerNames) {
    const name = rawName.toLowerCase().trim();
    if (name === "(request-target)") {
      lines.push(`(request-target): ${(method || "post").toLowerCase()} ${requestPath || "/"}`);
    } else {
      const value = lower[name];
      if (value == null) {
        throw new Error(`signing string missing header ${name}`);
      }
      lines.push(`${name}: ${value}`);
    }
  }
  return lines.join("\n");
}

/**
 * Compute the standard Digest header for a request body.
 * Format: `SHA-256=<base64-of-raw-sha256-bytes>` — matches Mastodon.
 */
export function digestForBody(body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body || {}), "utf8");
  const h = crypto.createHash("sha256").update(buf).digest("base64");
  return `SHA-256=${h}`;
}

/**
 * Sign an outbound POST.
 *
 * @returns {object} headers ready to spread into a fetch() init
 */
export function signRequest({
  privateKeyPem,
  keyId,
  method = "POST",
  url,
  body,
  extraHeaders = {},
  headerNames = ["(request-target)", "host", "date", "digest"],
}) {
  if (!privateKeyPem) throw new Error("signRequest: privateKeyPem required");
  if (!keyId) throw new Error("signRequest: keyId required");
  if (!url) throw new Error("signRequest: url required");
  const u = new URL(url);
  const path = u.pathname + (u.search || "");
  const host = u.host;
  const date = extraHeaders["Date"] || extraHeaders["date"] || new Date().toUTCString();
  const digest = digestForBody(body);

  const headers = {
    Host: host,
    Date: date,
    Digest: digest,
    "Content-Type": extraHeaders["Content-Type"] || extraHeaders["content-type"] || "application/activity+json",
    Accept: extraHeaders["Accept"] || extraHeaders["accept"] || "application/activity+json",
    ...extraHeaders,
  };

  const signingString = buildSigningString({ headers, method, path, headerNames });
  const signature = crypto.createSign("RSA-SHA256")
    .update(signingString, "utf8")
    .sign(privateKeyPem)
    .toString("base64");

  const signatureHeader =
    `keyId="${keyId}",algorithm="rsa-sha256",headers="${headerNames.join(" ")}",signature="${signature}"`;

  return {
    ...headers,
    Signature: signatureHeader,
  };
}

/**
 * Resolve the actor's public-key PEM by following the keyId URL.
 * Cached via the supplied cacheGet/cacheSet pair (the DB-backed cache
 * lives at the call site so this module stays storage-agnostic).
 *
 * @param {object} opts
 * @param {string} opts.keyId
 * @param {(keyId:string) => Promise<string|null>=} opts.cacheGet
 * @param {(keyId:string, pem:string, actorId:string) => Promise<void>=} opts.cacheSet
 * @param {(url:string, init?:object) => Promise<Response>=} opts.fetcher
 */
export async function resolveActorKey({ keyId, cacheGet, cacheSet, fetcher = globalThis.fetch }) {
  if (!keyId) return { ok: false, error: "missing_keyId" };
  if (cacheGet) {
    try {
      const cached = await cacheGet(keyId);
      if (cached) return { ok: true, publicKeyPem: cached };
    } catch { /* fall through to network */ }
  }
  if (!fetcher) return { ok: false, error: "no_fetcher" };
  // Strip the fragment to get the actor URL.
  const actorUrl = keyId.split("#")[0];
  try {
    const res = await fetcher(actorUrl, { headers: { Accept: "application/activity+json" } });
    if (!res.ok) return { ok: false, error: `actor_fetch_${res.status}` };
    const json = await res.json();
    const pem = json?.publicKey?.publicKeyPem;
    if (!pem || typeof pem !== "string") return { ok: false, error: "no_public_key" };
    if (cacheSet) { try { await cacheSet(keyId, pem, json.id || actorUrl); } catch { /* ok */ } }
    return { ok: true, publicKeyPem: pem, actorId: json.id || actorUrl };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * Verify the incoming request's Signature header.
 *
 * @param {object} opts
 * @param {object} opts.headers — Express req.headers
 * @param {string} opts.method
 * @param {string} opts.path
 * @param {Buffer|string} opts.body — raw body bytes (needed for digest)
 * @param {(keyId:string) => Promise<string|null>=} opts.cacheGet
 * @param {(keyId:string, pem:string, actorId:string) => Promise<void>=} opts.cacheSet
 * @param {(url:string, init?:object) => Promise<Response>=} opts.fetcher
 * @returns {Promise<{ok:boolean, actorId?:string, error?:string}>}
 */
export async function verifySignature({ headers, method, path: requestPath, body, cacheGet, cacheSet, fetcher = globalThis.fetch }) {
  const lower = {};
  for (const [k, v] of Object.entries(headers || {})) lower[String(k).toLowerCase()] = v;
  const sigHeader = lower["signature"];
  if (!sigHeader) return { ok: false, error: "no_signature" };
  const parsed = parseSignatureHeader(sigHeader);
  if (!parsed) return { ok: false, error: "malformed_signature" };

  // Digest check — if the signed headers include digest, the supplied
  // body must hash to it. Defense against body tampering in transit.
  const signedHeaderList = parsed.headers.split(/\s+/).filter(Boolean);
  if (signedHeaderList.includes("digest")) {
    const expectedDigest = lower["digest"];
    if (!expectedDigest) return { ok: false, error: "digest_header_missing" };
    const recomputed = digestForBody(body);
    if (recomputed !== expectedDigest) return { ok: false, error: "digest_mismatch" };
  }

  // Time-window check — reject signatures whose Date is more than 5 minutes
  // off our clock to limit replay attack windows.
  if (signedHeaderList.includes("date")) {
    const dateStr = lower["date"];
    if (dateStr) {
      const dateMs = Date.parse(dateStr);
      if (!Number.isNaN(dateMs)) {
        const skew = Math.abs(Date.now() - dateMs);
        if (skew > 5 * 60 * 1000) return { ok: false, error: "date_skew_exceeded" };
      }
    }
  }

  // Pull the actor's key. If unresolvable, treat as verification failure.
  const key = await resolveActorKey({ keyId: parsed.keyId, cacheGet, cacheSet, fetcher });
  if (!key.ok) return { ok: false, error: `key_resolve_failed:${key.error}` };

  // Rebuild signing string and verify.
  let signingString;
  try {
    signingString = buildSigningString({
      headers: lower, method, path: requestPath, headerNames: signedHeaderList,
    });
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(signingString, "utf8");
    const sigBytes = Buffer.from(parsed.signature, "base64");
    const verified = verifier.verify(key.publicKeyPem, sigBytes);
    if (!verified) return { ok: false, error: "signature_invalid" };
    return { ok: true, actorId: key.actorId, keyId: parsed.keyId };
  } catch (err) {
    return { ok: false, error: `verify_threw:${err?.message || err}` };
  }
}

/**
 * Convenience: small in-memory cache for actor public keys. Use this
 * by passing `inMemoryKeyCache.get` / `.set` to resolveActorKey when no
 * DB-backed cache is available.
 */
export function makeInMemoryKeyCache({ maxEntries = 500, ttlMs = 60 * 60 * 1000 } = {}) {
  const map = new Map(); // keyId → { pem, actorId, ts }
  return {
    async get(keyId) {
      const e = map.get(keyId);
      if (!e) return null;
      if (Date.now() - e.ts > ttlMs) { map.delete(keyId); return null; }
      return e.pem;
    },
    async set(keyId, pem, actorId) {
      if (map.size >= maxEntries) {
        const oldest = map.keys().next().value;
        if (oldest) map.delete(oldest);
      }
      map.set(keyId, { pem, actorId, ts: Date.now() });
    },
    _internal: map,
  };
}
