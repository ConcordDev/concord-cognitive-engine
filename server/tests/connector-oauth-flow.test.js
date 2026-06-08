/**
 * Tier-2 contract tests for Track C — the connector AUTHORIZE flow
 * (routes/connector-oauth.js). Covers the consent-URL builder (offline +
 * consent + scopes + state), the code→token exchange (mocked provider), the
 * persist round-trip, the token-key mapping, and the honest failure paths.
 *
 * The provider network is mocked (fetchImpl injection) — no live Google call.
 *
 * Run: node --test server/tests/connector-oauth-flow.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate331 } from "../migrations/331_connector_oauth_tokens.js";
import { getConnectorToken } from "../lib/connector-tokens.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  resolveTokenKey,
  PROVIDERS,
  CONNECTOR_TOKEN_KEY,
} from "../routes/connector-oauth.js";

function freshDb() {
  const db = new Database(":memory:");
  migrate331(db);
  return db;
}

describe("connector authorize URL builder", () => {
  it("google: requests offline access + consent + the scope + state (best practices)", () => {
    const url = buildAuthorizeUrl({
      provider: "google",
      clientId: "cid.apps.googleusercontent.com",
      redirectUri: "https://app.example/api/oauth/google/authorize/callback",
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
      state: "st-123",
    });
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(u.searchParams.get("access_type"), "offline");
    assert.equal(u.searchParams.get("prompt"), "consent");
    assert.equal(u.searchParams.get("include_granted_scopes"), "true");
    assert.equal(u.searchParams.get("response_type"), "code");
    assert.equal(u.searchParams.get("state"), "st-123");
    assert.equal(u.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.events");
    assert.equal(u.searchParams.get("client_id"), "cid.apps.googleusercontent.com");
  });

  it("slack: joins scopes with commas and targets the slack authorize endpoint", () => {
    const url = buildAuthorizeUrl({
      provider: "slack", clientId: "scid", redirectUri: "https://app/cb",
      scopes: ["chat:write", "channels:read"], state: "st-9",
    });
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, "https://slack.com/oauth/v2/authorize");
    assert.equal(u.searchParams.get("scope"), "chat:write,channels:read");
  });
});

describe("resolveTokenKey", () => {
  it("explicit token_key wins", () => {
    assert.equal(resolveTokenKey({ tokenKey: "google_calendar", provider: "google" }), "google_calendar");
  });
  it("ingest connector id maps via the catalog table", () => {
    assert.equal(resolveTokenKey({ connectorId: "google-sheets", provider: "google" }), "google_sheets");
    assert.equal(resolveTokenKey({ connectorId: "gmail", provider: "google" }), "google_gmail");
    assert.equal(CONNECTOR_TOKEN_KEY["google-calendar"], "google_calendar");
  });
  it("falls back to the provider name when unmapped", () => {
    assert.equal(resolveTokenKey({ provider: "google" }), "google");
  });
});

describe("exchangeCodeForToken (mocked provider)", () => {
  const realId = process.env.GOOGLE_CLIENT_ID;
  const realSecret = process.env.GOOGLE_CLIENT_SECRET;
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = "cid";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
  });
  afterEach(() => {
    if (realId === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = realId;
    if (realSecret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = realSecret;
  });

  it("normalises a Google token response and round-trips through persistence", async () => {
    const fetchImpl = async (url, init) => {
      assert.equal(url, PROVIDERS.google.tokenUrl);
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("code"), "auth-code-1");
      assert.equal(body.get("client_secret"), "secret");
      return { ok: true, json: async () => ({ access_token: "AT", refresh_token: "RT", expires_in: 3600, scope: "x", token_type: "Bearer" }) };
    };
    const r = await exchangeCodeForToken("google", { code: "auth-code-1", redirectUri: "https://app/cb", fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.tokens.access_token, "AT");
    assert.equal(r.tokens.refresh_token, "RT");

    // The callback persists under the resolved token key; egress reads it back.
    const db = freshDb();
    const { persistConnectorToken } = await import("../lib/connector-tokens.js");
    persistConnectorToken(db, "u1", "google_calendar", { ...r.tokens });
    const stored = getConnectorToken(db, "u1", "google_calendar");
    assert.equal(stored.access_token, "AT");
    assert.equal(stored.refresh_token, "RT");
    db.close();
  });

  it("honest failure when client secret is absent", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const r = await exchangeCodeForToken("google", { code: "c", redirectUri: "https://app/cb", fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "connector_not_configured");
  });

  it("rejects a token response that carries no access_token", async () => {
    const r = await exchangeCodeForToken("google", {
      code: "c", redirectUri: "https://app/cb",
      fetchImpl: async () => ({ ok: true, json: async () => ({ scope: "x" }) }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_access_token");
  });

  it("slack: parses the user token out of authed_user", async () => {
    process.env.SLACK_CLIENT_ID = "scid";
    process.env.SLACK_CLIENT_SECRET = "ssecret";
    const r = await exchangeCodeForToken("slack", {
      code: "c", redirectUri: "https://app/cb",
      fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, access_token: "BOT", authed_user: { access_token: "USER", scope: "chat:write" } }) }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.tokens.access_token, "USER");
    delete process.env.SLACK_CLIENT_ID; delete process.env.SLACK_CLIENT_SECRET;
  });
});
