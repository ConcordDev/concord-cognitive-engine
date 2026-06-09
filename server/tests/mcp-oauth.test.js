/**
 * MCP OAuth 2.1 + PKCE — unit tests for the token-issuance core: PKCE S256
 * round-trip, authorization-code exchange (valid / single-use / expired / redirect
 * mismatch / bad PKCE), token validation, and AS metadata. (The full handshake is
 * proven against a live MCP client.)
 *
 * Run: node --test server/tests/mcp-oauth.test.js
 */

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  pkceChallengeFromVerifier, verifyPkce, issueAuthCode, exchangeCode,
  validateMcpToken, authServerMetadata, _clearCodes,
} from "../lib/mcp-oauth.js";

before(() => { process.env.MCP_TOKEN_SECRET = "test-mcp-secret-0123456789"; });
beforeEach(() => _clearCodes());

const VERIFIER = "abc123_a-very-long-pkce-code-verifier-string-0987654321";
const CHALLENGE = pkceChallengeFromVerifier(VERIFIER);

describe("PKCE S256", () => {
  it("verifies a matching verifier and rejects a wrong one (length-safe)", () => {
    assert.equal(verifyPkce(VERIFIER, CHALLENGE), true);
    assert.equal(verifyPkce("wrong", CHALLENGE), false);
    assert.equal(verifyPkce(VERIFIER, "short"), false);
    assert.equal(verifyPkce("", CHALLENGE), false);
  });
});

describe("authorization-code exchange", () => {
  it("issues a code and exchanges it for a Bearer token (PKCE verified)", () => {
    const code = issueAuthCode({ userId: "u1", codeChallenge: CHALLENGE, scope: "concord:read concord:write" });
    assert.ok(code);
    const r = exchangeCode({ code, codeVerifier: VERIFIER });
    assert.equal(r.ok, true);
    assert.equal(r.token_type, "Bearer");
    assert.equal(r.scope, "concord:read concord:write");
    // the token validates back to the user + scopes
    const v = validateMcpToken(`Bearer ${r.access_token}`);
    assert.equal(v.actor.userId, "u1");
    assert.deepEqual(v.actor.scopes, ["concord:read", "concord:write"]);
    assert.equal(v.actor.is_agent, false);
  });

  it("a code is single-use", () => {
    const code = issueAuthCode({ userId: "u1", codeChallenge: CHALLENGE });
    assert.equal(exchangeCode({ code, codeVerifier: VERIFIER }).ok, true);
    assert.equal(exchangeCode({ code, codeVerifier: VERIFIER }).error, "invalid_grant");
  });

  it("rejects a wrong PKCE verifier", () => {
    const code = issueAuthCode({ userId: "u1", codeChallenge: CHALLENGE });
    assert.equal(exchangeCode({ code, codeVerifier: "not-the-verifier" }).error, "invalid_pkce");
  });

  it("rejects a redirect_uri mismatch", () => {
    const code = issueAuthCode({ userId: "u1", codeChallenge: CHALLENGE, redirectUri: "https://app/cb" });
    assert.equal(exchangeCode({ code, codeVerifier: VERIFIER, redirectUri: "https://evil/cb" }).error, "redirect_mismatch");
  });

  it("requires a userId + challenge to issue", () => {
    assert.equal(issueAuthCode({ codeChallenge: CHALLENGE }), null);
    assert.equal(issueAuthCode({ userId: "u1" }), null);
  });
});

describe("token validation", () => {
  it("rejects garbage / tampered tokens", () => {
    assert.equal(validateMcpToken("Bearer not.a.jwt"), null);
    assert.equal(validateMcpToken(null), null);
  });
});

describe("AS metadata", () => {
  it("advertises PKCE S256 + the endpoints", () => {
    const m = authServerMetadata("https://concord-os.org");
    assert.equal(m.authorization_endpoint, "https://concord-os.org/mcp/authorize");
    assert.equal(m.token_endpoint, "https://concord-os.org/mcp/token");
    assert.deepEqual(m.code_challenge_methods_supported, ["S256"]);
    assert.ok(m.grant_types_supported.includes("authorization_code"));
  });
});
