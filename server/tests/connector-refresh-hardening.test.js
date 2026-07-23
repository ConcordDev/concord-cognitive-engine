/**
 * Tier-2 contract tests for R1-3 (connector auth/refresh/failure-recovery
 * hardening). Covers three connectors on the shared `connectorFetch`
 * chokepoint (server/lib/connector-client.js) + its token layer
 * (server/lib/connector-tokens.js):
 *
 *   - Google Calendar — the pre-existing "refresh works" happy path, kept
 *     green under the provider-generalized refresh.
 *   - Slack — the connector this hardening pass actually FIXES: pre-fix,
 *     every connector's refresh was hardcoded to Google's token endpoint, so
 *     a Slack token-rotation refresh would have been silently routed to the
 *     wrong provider. Proven here against Slack's real oauth.v2.access shape
 *     (200-with-body-level-`ok:false` failures included).
 *   - GitHub — the honest "no refresh possible" path (classic OAuth-app
 *     tokens never carry a refresh_token), proving connectorFetch surfaces a
 *     structured, actionable failure rather than an opaque throw.
 *
 * Also covers the ConnectorStatusPanel data source fix in
 * server/domains/integrations.js: the gmail catalog-id -> token-key mapping,
 * and connectionList's live (not stale-snapshot) credentialStored.
 *
 * Run: node --test server/tests/connector-refresh-hardening.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate331 } from "../migrations/331_connector_oauth_tokens.js";
import {
  persistConnectorToken,
  getConnectorToken,
  getValidAccessToken,
  refreshConnectorToken,
} from "../lib/connector-tokens.js";
import { connectorFetch } from "../lib/connector-client.js";
import registerIntegrationsActions from "../domains/integrations.js";

function freshDb() {
  const db = new Database(":memory:");
  migrate331(db);
  return db;
}

const ORIG_ENV = {};
function setEnv(key, value) {
  if (!(key in ORIG_ENV)) ORIG_ENV[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
function restoreEnv() {
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(ORIG_ENV)) delete ORIG_ENV[k];
}

// ── Google Calendar: expired-token -> refresh-succeeds -> retry-succeeds ────
describe("connectorFetch — google_calendar: 401 -> refresh succeeds -> retry succeeds", () => {
  let db;
  beforeEach(() => {
    db = freshDb();
    setEnv("GOOGLE_CLIENT_ID", "cid");
    setEnv("GOOGLE_CLIENT_SECRET", "csec");
  });
  afterEach(() => { db.close(); restoreEnv(); });

  it("retries once with the refreshed token and returns ok:true", async () => {
    persistConnectorToken(db, "u1", "google_calendar", {
      access_token: "stale-at", refresh_token: "rt-1", expires_in: 3600, // not expired by TTL — 401 mid-flight
    });
    let call = 0;
    let refreshCalled = false;
    const fetchImpl = async (url, init) => {
      if (url === "https://oauth2.googleapis.com/token") {
        refreshCalled = true;
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("refresh_token"), "rt-1");
        assert.equal(body.get("client_id"), "cid");
        return { ok: true, json: async () => ({ access_token: "fresh-at", expires_in: 3600 }) };
      }
      call += 1;
      if (call === 1) {
        assert.equal(init.headers.Authorization, "Bearer stale-at");
        return { ok: false, status: 401, json: async () => ({ error: { message: "invalid credentials" } }) };
      }
      assert.equal(init.headers.Authorization, "Bearer fresh-at", "retry uses the refreshed token");
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    };
    const r = await connectorFetch(db, "u1", "google_calendar", "https://www.googleapis.com/calendar/v3/x", {}, { fetchImpl });
    assert.equal(refreshCalled, true, "refresh must have been attempted");
    assert.equal(r.ok, true);
    assert.equal(call, 2, "exactly one retry — never more");
    assert.equal(getConnectorToken(db, "u1", "google_calendar").access_token, "fresh-at", "refreshed token persisted");
  });

  it("refresh terminally rejected (invalid_grant) -> honest reauth_required, dead token dropped", async () => {
    persistConnectorToken(db, "u1", "google_calendar", { access_token: "stale-at", refresh_token: "rt-1", expires_in: 3600 });
    const fetchImpl = async (url) => {
      if (url === "https://oauth2.googleapis.com/token") {
        return { ok: false, status: 400, json: async () => ({ error: "invalid_grant" }) };
      }
      return { ok: false, status: 401, json: async () => ({ error: "unauthorized" }) };
    };
    const r = await connectorFetch(db, "u1", "google_calendar", "https://www.googleapis.com/calendar/v3/x", {}, { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "reauth_required", "specific reason, not a generic provider_error");
    assert.equal(getConnectorToken(db, "u1", "google_calendar"), null, "dead token removed so status flips honestly");
  });

  it("5xx from the provider (no auth problem) -> service_unavailable, not provider_error", async () => {
    persistConnectorToken(db, "u1", "google_calendar", { access_token: "at", refresh_token: "rt", expires_in: 3600 });
    const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({ error: "backend_error" }) });
    const r = await connectorFetch(db, "u1", "google_calendar", "https://www.googleapis.com/calendar/v3/x", {}, { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "service_unavailable");
    assert.equal(r.status, 503);
  });

  it("4xx business-logic error (not auth) is still the honest provider_error (regression)", async () => {
    persistConnectorToken(db, "u1", "google_calendar", { access_token: "at", refresh_token: "rt", expires_in: 3600 });
    const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({ error: "not_found" }) });
    const r = await connectorFetch(db, "u1", "google_calendar", "https://www.googleapis.com/calendar/v3/x", {}, { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "provider_error");
    assert.equal(r.status, 404);
  });
});

// ── Slack: the connector this pass actually fixes ───────────────────────────
describe("Slack — provider-correct refresh (was hardcoded to Google's endpoint pre-fix)", () => {
  let db;
  beforeEach(() => {
    db = freshDb();
    setEnv("SLACK_CLIENT_ID", "scid");
    setEnv("SLACK_CLIENT_SECRET", "ssec");
  });
  afterEach(() => { db.close(); restoreEnv(); });

  it("refreshConnectorToken hits Slack's oauth.v2.access endpoint, never Google's", async () => {
    persistConnectorToken(db, "u1", "slack", { access_token: "old", refresh_token: "srt-1", expires_in: -10 });
    let hitGoogle = false;
    const fetchImpl = async (url, init) => {
      if (url === "https://oauth2.googleapis.com/token") { hitGoogle = true; return { ok: false, status: 400, json: async () => ({ error: "invalid_request" }) }; }
      assert.equal(url, "https://slack.com/api/oauth.v2.access");
      const body = new URLSearchParams(init.body);
      assert.equal(body.get("refresh_token"), "srt-1");
      assert.equal(body.get("client_id"), "scid");
      assert.equal(body.get("client_secret"), "ssec");
      return { ok: true, json: async () => ({ ok: true, access_token: "fresh-slack-at", refresh_token: "srt-2", expires_in: 43200 }) };
    };
    const r = await refreshConnectorToken(db, "u1", "slack", { fetchImpl });
    assert.equal(hitGoogle, false, "must never route a Slack refresh through Google's token endpoint");
    assert.equal(r.ok, true);
    assert.equal(r.token.access_token, "fresh-slack-at");
    assert.equal(getConnectorToken(db, "u1", "slack").refresh_token, "srt-2", "rotated refresh token persisted");
  });

  it("getValidAccessToken proactively refreshes an expired Slack token via Slack's own endpoint", async () => {
    persistConnectorToken(db, "u1", "slack", { access_token: "old", refresh_token: "srt-1", expires_in: -10 });
    const fetchImpl = async (url) => {
      assert.equal(url, "https://slack.com/api/oauth.v2.access");
      return { ok: true, json: async () => ({ ok: true, access_token: "fresh", expires_in: 43200 }) };
    };
    const r = await getValidAccessToken(db, "u1", "slack", { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.accessToken, "fresh");
  });

  it("Slack's 200-with-body-ok:false invalid_refresh_token is terminal -> reauth_required, token dropped", async () => {
    persistConnectorToken(db, "u1", "slack", { access_token: "old", refresh_token: "srt-dead", expires_in: -10 });
    // Slack's Web API returns HTTP 200 even on logical failure — res.ok is true.
    const fetchImpl = async () => ({ ok: true, json: async () => ({ ok: false, error: "invalid_refresh_token" }) });
    const r = await refreshConnectorToken(db, "u1", "slack", { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "reauth_required");
    assert.equal(getConnectorToken(db, "u1", "slack"), null, "dead refresh token dropped");
  });

  it("a non-terminal Slack body error (e.g. rate limited) is honestly non-fatal, not treated as reauth", async () => {
    persistConnectorToken(db, "u1", "slack", { access_token: "old", refresh_token: "srt-1", expires_in: -10 });
    const fetchImpl = async () => ({ ok: true, json: async () => ({ ok: false, error: "ratelimited" }) });
    const r = await refreshConnectorToken(db, "u1", "slack", { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "ratelimited", "surfaces Slack's actual error, not a fabricated generic one");
    assert.ok(getConnectorToken(db, "u1", "slack"), "token kept — this wasn't a terminal rejection");
  });

  it("connectorFetch end-to-end: Slack transport-level 401 -> refresh via Slack's endpoint -> retry succeeds", async () => {
    persistConnectorToken(db, "u1", "slack", { access_token: "stale", refresh_token: "srt-1", expires_in: 3600 });
    let call = 0;
    const fetchImpl = async (url, init) => {
      if (url === "https://slack.com/api/oauth.v2.access") {
        return { ok: true, json: async () => ({ ok: true, access_token: "fresh-slack-at", expires_in: 43200 }) };
      }
      call += 1;
      if (call === 1) {
        assert.equal(init.headers.Authorization, "Bearer stale");
        return { ok: false, status: 401, json: async () => ({ ok: false, error: "token_expired" }) };
      }
      assert.equal(init.headers.Authorization, "Bearer fresh-slack-at", "retry uses the refreshed token");
      return { ok: true, status: 200, json: async () => ({ ok: true, channels: [] }) };
    };
    const r = await connectorFetch(db, "u1", "slack", "https://slack.com/api/conversations.list", { method: "GET" }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(call, 2, "exactly one retry");
  });
});

// ── GitHub: honest "no refresh possible" (classic tokens never expire/rotate) ─
describe("GitHub — no refresh_token on file: honest structured failure, never an opaque throw", () => {
  let db;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { db.close(); });

  it("connectorFetch 401 with no stored refresh_token -> auth_expired (not reauth_required, not a throw)", async () => {
    persistConnectorToken(db, "u1", "github", { access_token: "gh-at" }); // classic token: no refresh_token
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return { ok: false, status: 401, json: async () => ({ message: "Bad credentials" }) }; };
    const r = await connectorFetch(db, "u1", "github", "https://api.github.com/user/repos", { method: "GET" }, { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "auth_expired");
    assert.equal(calls, 1, "no refresh attempted (nothing to refresh with) and no infinite retry loop");
  });

  it("refreshConnectorToken never reaches any network call when no refresh_token is stored", async () => {
    persistConnectorToken(db, "u1", "github", { access_token: "gh-at" });
    let hit = false;
    const fetchImpl = async () => { hit = true; throw new Error("must not be called"); };
    const r = await refreshConnectorToken(db, "u1", "github", { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_refresh_token");
    assert.equal(hit, false);
  });

  it("connectorFetch never throws even on a hard network failure — returns request_failed", async () => {
    persistConnectorToken(db, "u1", "github", { access_token: "gh-at" });
    const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
    const r = await connectorFetch(db, "u1", "github", "https://api.github.com/user/repos", { method: "GET" }, { fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "request_failed");
    assert.ok(r.detail.includes("ECONNREFUSED"));
  });
});

// ── ConnectorStatusPanel data source (server/domains/integrations.js) ──────
describe("integrations.connectionList — live credentialStored (was a stale connect-time snapshot)", () => {
  let db;
  function harness() {
    globalThis._concordSTATE = {};
    const macros = new Map();
    registerIntegrationsActions((d, n, h) => macros.set(`${d}.${n}`, h));
    const ctx = { db, actor: { userId: "u1" } };
    const call = (name, params) => macros.get(name)(ctx, { data: params }, params);
    return { call };
  }
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { db.close(); delete globalThis._concordSTATE; });

  it("gmail catalog id maps to the real 'google_gmail' token key (was checking the wrong key)", () => {
    const { call } = harness();
    // A real Gmail OAuth grant, stored exactly as routes/connector-oauth.js's
    // callback would (connector_id = 'google_gmail', NOT the catalog id 'gmail').
    persistConnectorToken(db, "u1", "google_gmail", { access_token: "gmail-at" });
    const conn = call("integrations.connectApp", { connectorId: "gmail" });
    assert.equal(conn.ok, true);
    assert.equal(conn.result.connection.credentialStored, true, "must find the real token under its real key");
  });

  it("connectionList reflects a token that appears AFTER connectApp was called (not frozen at connect time)", () => {
    const { call } = harness();
    // Connect before any token exists -> credentialStored starts false.
    const conn = call("integrations.connectApp", { connectorId: "slack" });
    assert.equal(conn.result.connection.credentialStored, false);
    // A real OAuth flow completes afterwards.
    persistConnectorToken(db, "u1", "slack", { access_token: "slack-at" });
    const list = call("integrations.connectionList", {});
    const row = list.result.connections.find((c) => c.connectorId === "slack");
    assert.equal(row.credentialStored, true, "connectionList re-checks live, not the stale false snapshot");
    assert.equal(row.needsOauth, false);
  });

  it("connectionList flips to false when a refresh-failure drops the token (honest degraded state, not stuck 'Connected')", () => {
    const { call } = harness();
    persistConnectorToken(db, "u1", "github", { access_token: "gh-at" });
    const conn = call("integrations.connectApp", { connectorId: "github" });
    assert.equal(conn.result.connection.credentialStored, true);
    // Simulate refreshConnectorToken's reauth_required path dropping the dead token.
    db.prepare("DELETE FROM connector_oauth_tokens WHERE user_id = ? AND connector_id = ?").run("u1", "github");
    const list = call("integrations.connectionList", {});
    const row = list.result.connections.find((c) => c.connectorId === "github");
    assert.equal(row.credentialStored, false, "must not keep reporting a token that was dropped");
    assert.equal(row.needsOauth, true);
  });
});
