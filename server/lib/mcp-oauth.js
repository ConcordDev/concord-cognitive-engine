// server/lib/mcp-oauth.js
//
// MCP OAuth 2.1 authorization server (the auth side of the RFC 9728 Protected
// Resource Metadata in mcp-server-host.js). Implements the authorization-code +
// PKCE (S256) flow the MCP spec mandates for remote servers, issuing short-lived
// Bearer tokens scoped to a Concord user. Tokens are signed JWTs (jsonwebtoken,
// already a dependency) so /mcp can validate them statelessly.
//
// The token-issuance + PKCE + validation logic here is pure and unit-tested; the
// authorization endpoint (user consent) reuses Concord's existing web session,
// and a real end-to-end handshake is proven against a live MCP client.

import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const CODE_TTL_MS = 5 * 60 * 1000; // authorization codes are short-lived
const TOKEN_TTL_S = 3600;
const AUDIENCE = "concord:mcp";

// Authorization codes (single-use, in-memory; a code lives ~5 min between
// authorize and token).
const _codes = new Map();

function secret() {
  return process.env.MCP_TOKEN_SECRET || process.env.JWT_SECRET || "dev-mcp-oauth-secret-change-me";
}

/** PKCE S256: base64url( SHA-256( verifier ) ). */
export function pkceChallengeFromVerifier(verifier) {
  return crypto.createHash("sha256").update(String(verifier || "")).digest("base64url");
}

/** Constant-time PKCE check (length-guarded so timingSafeEqual never throws). */
export function verifyPkce(codeVerifier, codeChallenge) {
  if (!codeVerifier || !codeChallenge) return false;
  const computed = pkceChallengeFromVerifier(codeVerifier);
  if (computed.length !== String(codeChallenge).length) return false;
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(String(codeChallenge)));
}

/** Issue an authorization code bound to the user + PKCE challenge. */
export function issueAuthCode({ userId, clientId = null, redirectUri = null, codeChallenge, scope = "concord:read" } = {}) {
  if (!userId || !codeChallenge) return null;
  const code = crypto.randomBytes(24).toString("base64url");
  _codes.set(code, { userId, clientId, redirectUri, codeChallenge, scope, exp: Date.now() + CODE_TTL_MS });
  return code;
}

/** Exchange an authorization code + PKCE verifier for an access token. */
export function exchangeCode({ code, codeVerifier, redirectUri } = {}) {
  const rec = _codes.get(code);
  if (!rec) return { ok: false, error: "invalid_grant" };
  _codes.delete(code); // single-use
  if (rec.exp < Date.now()) return { ok: false, error: "expired_code" };
  if (rec.redirectUri && redirectUri && rec.redirectUri !== redirectUri) return { ok: false, error: "redirect_mismatch" };
  if (!verifyPkce(codeVerifier, rec.codeChallenge)) return { ok: false, error: "invalid_pkce" };
  const access_token = jwt.sign({ sub: rec.userId, scope: rec.scope }, secret(), { expiresIn: TOKEN_TTL_S, audience: AUDIENCE });
  return { ok: true, access_token, token_type: "Bearer", expires_in: TOKEN_TTL_S, scope: rec.scope };
}

/** Validate a Bearer token → { actor } or null. */
export function validateMcpToken(authorization) {
  if (!authorization) return null;
  try {
    const token = String(authorization).replace(/^Bearer\s+/i, "").trim();
    const payload = jwt.verify(token, secret(), { audience: AUDIENCE });
    return { actor: { userId: payload.sub, scopes: String(payload.scope || "").split(/\s+/).filter(Boolean), is_agent: false, via: "mcp_oauth" } };
  } catch {
    return null;
  }
}

/** RFC 8414 Authorization Server Metadata. */
export function authServerMetadata(baseUrl) {
  const origin = String(baseUrl || process.env.CONCORD_PUBLIC_URL || "").replace(/\/$/, "");
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/mcp/authorize`,
    token_endpoint: `${origin}/mcp/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["concord:read", "concord:write"],
  };
}

/** Test seam. */
export function _clearCodes() { _codes.clear(); }
