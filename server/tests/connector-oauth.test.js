/**
 * Tier-2 contract tests for Track C — real external connectors.
 *
 * Covers the token-persistence + refresh foundation (migration 331 +
 * connector-tokens.js), the honest-failure contract of the guarded client
 * (connector-client.js), and the calendar push direction gate. The provider
 * network is mocked (fetchImpl injection) — no live Google call.
 *
 * Run: node --test server/tests/connector-oauth.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate331 } from "../migrations/331_connector_oauth_tokens.js";
import {
  persistConnectorToken,
  getConnectorToken,
  getValidAccessToken,
  refreshGoogleToken,
  deleteConnectorToken,
} from "../lib/connector-tokens.js";
import { connectorFetch } from "../lib/connector-client.js";
import registerCalendarActions from "../domains/calendar.js";

function freshDb() {
  const db = new Database(":memory:");
  migrate331(db);
  return db;
}

describe("migration 331 + connector-tokens persistence", () => {
  let db;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { db.close(); });

  it("creates the connector_oauth_tokens table", () => {
    const t = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='connector_oauth_tokens'").get();
    assert.ok(t, "table exists after migration");
  });

  it("persists + reads back a token (round-trip, scopes parsed)", () => {
    persistConnectorToken(db, "u1", "google_calendar", {
      access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "openid calendar",
    });
    const row = getConnectorToken(db, "u1", "google_calendar");
    assert.equal(row.access_token, "at-1");
    assert.equal(row.refresh_token, "rt-1");
    assert.deepEqual(row.scopes, ["openid", "calendar"]);
    assert.ok(row.expires_at > Math.floor(Date.now() / 1000));
  });

  it("upsert keeps the existing refresh_token when a new one isn't supplied", () => {
    persistConnectorToken(db, "u1", "google_calendar", { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 });
    persistConnectorToken(db, "u1", "google_calendar", { access_token: "at-2", expires_in: 3600 }); // no refresh_token
    const row = getConnectorToken(db, "u1", "google_calendar");
    assert.equal(row.access_token, "at-2");
    assert.equal(row.refresh_token, "rt-1", "old refresh token retained");
  });

  it("rejects persisting without an access_token", () => {
    assert.throws(() => persistConnectorToken(db, "u1", "google_calendar", { refresh_token: "rt" }));
  });

  it("deleteConnectorToken removes the row", () => {
    persistConnectorToken(db, "u1", "google_calendar", { access_token: "at" });
    assert.equal(deleteConnectorToken(db, "u1", "google_calendar"), true);
    assert.equal(getConnectorToken(db, "u1", "google_calendar"), null);
  });
});

describe("getValidAccessToken + refresh rotation", () => {
  let db;
  const ORIG = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
  beforeEach(() => { db = freshDb(); });
  afterEach(() => {
    db.close();
    process.env.GOOGLE_CLIENT_ID = ORIG.id; process.env.GOOGLE_CLIENT_SECRET = ORIG.secret;
    if (ORIG.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
    if (ORIG.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it("returns the stored token unchanged when not expired", async () => {
    persistConnectorToken(db, "u1", "google_calendar", { access_token: "at-1", refresh_token: "rt", expires_in: 3600 });
    const r = await getValidAccessToken(db, "u1", "google_calendar");
    assert.equal(r.ok, true);
    assert.equal(r.accessToken, "at-1");
  });

  it("auto-refreshes an expired token via the (mocked) provider + persists the new one", async () => {
    process.env.GOOGLE_CLIENT_ID = "cid"; process.env.GOOGLE_CLIENT_SECRET = "csec";
    persistConnectorToken(db, "u1", "google_calendar", { access_token: "old", refresh_token: "rt", expires_in: -10 }); // already expired
    const fetchImpl = async () => ({ ok: true, json: async () => ({ access_token: "fresh", expires_in: 3600 }) });
    const r = await getValidAccessToken(db, "u1", "google_calendar", { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.accessToken, "fresh");
    assert.equal(getConnectorToken(db, "u1", "google_calendar").access_token, "fresh", "new token persisted");
  });

  it("honest reasons: no_token / no_refresh_token / connector_not_configured", async () => {
    assert.equal((await refreshGoogleToken(db, "u1", "google_calendar")).reason, "no_token");
    persistConnectorToken(db, "u2", "google_calendar", { access_token: "at" }); // no refresh_token
    assert.equal((await refreshGoogleToken(db, "u2", "google_calendar")).reason, "no_refresh_token");
    delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
    persistConnectorToken(db, "u3", "google_calendar", { access_token: "at", refresh_token: "rt" });
    assert.equal((await refreshGoogleToken(db, "u3", "google_calendar")).reason, "connector_not_configured");
  });
});

describe("connector-client honest failure (no network when no token)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { db.close(); });

  it("connectorFetch returns no_token before any network call", async () => {
    const r = await connectorFetch(db, "u1", "google_calendar", "https://www.googleapis.com/calendar/v3/x");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_token");
  });
});

describe("calendar push direction gate", () => {
  let db;
  function harness() {
    // The calendar domain reads/lazily-creates its lens state off globalThis._concordSTATE.
    globalThis._concordSTATE = {};
    const macros = new Map();
    registerCalendarActions((d, n, h) => macros.set(`${d}.${n}`, h));
    const ctx = { db, actor: { userId: "u1" } };
    const call = (name, params) => macros.get(name)(ctx, { data: params }, params);
    return { macros, call };
  }
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { db.close(); });

  it("refuses to push to a pull-only account", async () => {
    const h = harness();
    const conn = h.call("calendar.accounts-connect", { provider: "google", label: "Work", icsUrl: "https://example.com/c.ics", direction: "pull" });
    assert.equal(conn.ok, true);
    const r = await h.call("calendar.accounts-push-event", { accountId: conn.result.account.id, event: { title: "Sync me" } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "direction_pull_no_push");
  });

  it("on a two-way account, attempts the push and surfaces the honest no_token reason", async () => {
    const h = harness();
    const conn = h.call("calendar.accounts-connect", { provider: "google", label: "Work", icsUrl: "https://example.com/c.ics", direction: "two-way" });
    const r = await h.call("calendar.accounts-push-event", { accountId: conn.result.account.id, event: { title: "Sync me" } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_token", "no fabricated success — needs a real stored credential");
  });
});
