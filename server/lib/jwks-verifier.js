// @env-config-ok: intentional external URL references
/**
 * Minimal JWKS verifier for OAuth id_tokens.
 *
 * The id_tokens we consume come from Google and Apple via a server-to-server
 * HTTPS POST to their token endpoint, so the TLS channel already provides
 * integrity. This module adds defense-in-depth by cryptographically
 * verifying the signature, expiry, issuer, and audience before we trust
 * any claim from the payload.
 *
 * We don't pull in `jwks-rsa` or `jose` to keep the dependency surface
 * small. A JWK is converted to a Node KeyObject via the built-in
 * `crypto.createPublicKey({ format: "jwk", key })` and passed to
 * `jsonwebtoken.verify`.
 *
 * Keys are cached per issuer for 1 hour to avoid hammering the JWKS
 * endpoint on every login.
 */

import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const JWKS_FETCH_TIMEOUT_MS = 5000;

// Map<jwksUri, { fetchedAt, keys: Map<kid, KeyObject> }>
const _cache = new Map();

async function fetchJwks(jwksUri) {
  const cached = _cache.get(jwksUri);
  if (cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
    return cached.keys;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JWKS_FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(jwksUri, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new Error(`JWKS fetch failed (${res.status}) for ${jwksUri}`);
  }
  const body = await res.json();
  if (!body || !Array.isArray(body.keys)) {
    throw new Error(`JWKS response malformed for ${jwksUri}`);
  }

  const keys = new Map();
  for (const jwk of body.keys) {
    if (!jwk.kid) continue;
    try {
      // Built-in JWK → PEM conversion. Works for RS256 / ES256 keys.
      const key = crypto.createPublicKey({ format: "jwk", key: jwk });
      keys.set(jwk.kid, key);
    } catch {
      // Skip keys we can't parse; other keys may still work
    }
  }

  _cache.set(jwksUri, { fetchedAt: Date.now(), keys });
  return keys;
}

/**
 * Verify a JWT issued by an OAuth provider.
 *
 * @param {string} token - The raw JWT (id_token)
 * @param {object} opts
 * @param {string} opts.jwksUri - URL to the provider's JWKS endpoint
 * @param {string|string[]} opts.issuer - Expected `iss` value(s)
 * @param {string|string[]} opts.audience - Expected `aud` value(s) (client id)
 * @param {string[]} [opts.algorithms=["RS256", "ES256"]] - Allowed sig algos
 * @returns {Promise<object>} Verified payload
 * @throws If signature, iss, aud, or expiry fail to validate
 */
export async function verifyProviderJwt(token, opts) {
  if (!token || typeof token !== "string") {
    throw new Error("verifyProviderJwt: token is required");
  }
  const { jwksUri, issuer, audience } = opts || {};
  if (!jwksUri) throw new Error("verifyProviderJwt: jwksUri is required");
  if (!issuer) throw new Error("verifyProviderJwt: issuer is required");
  if (!audience) throw new Error("verifyProviderJwt: audience is required");
  const algorithms = opts.algorithms || ["RS256", "ES256"];

  // Decode header to find the kid — we don't trust the payload yet.
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT");
  let header;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf-8"));
  } catch {
    throw new Error("Malformed JWT header");
  }
  if (!header.kid) throw new Error("JWT missing kid in header");
  if (!algorithms.includes(header.alg)) {
    throw new Error(`JWT uses disallowed algorithm: ${header.alg}`);
  }

  // Fetch the key set (cached)
  let keys = await fetchJwks(jwksUri);
  let key = keys.get(header.kid);
  if (!key) {
    // Possible key rotation: bust the cache and retry once.
    _cache.delete(jwksUri);
    keys = await fetchJwks(jwksUri);
    key = keys.get(header.kid);
  }
  if (!key) {
    throw new Error(`JWT kid ${header.kid} not found in JWKS ${jwksUri}`);
  }

  // Node's KeyObject exposes its PEM encoding for jsonwebtoken.
  const pem = key.export({ type: "spki", format: "pem" });

  // jsonwebtoken verifies signature + exp + nbf + iss + aud.
  return jwt.verify(token, pem, {
    algorithms,
    issuer,
    audience,
  });
}

/**
 * Clear the JWKS cache (mainly for tests).
 */
export function clearJwksCache() {
  _cache.clear();
}

// Issuer config shortcuts ----------------------------------------------------
export const GOOGLE_JWKS = {
  jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
  issuer: ["https://accounts.google.com", "accounts.google.com"],
};

export const APPLE_JWKS = {
  jwksUri: "https://appleid.apple.com/auth/keys",
  issuer: "https://appleid.apple.com",
};
