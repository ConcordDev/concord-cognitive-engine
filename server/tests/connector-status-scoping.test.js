/**
 * Unit A3 — contract tests for the read-only connector-status builder
 * (routes/connector-oauth.js#buildConnectorStatusList), the data source behind
 * ConKay's per-connector honesty badges.
 *
 * Pins the load-bearing honesty + safety properties:
 *   - per-user scoping: a user's status is derived ONLY from their own grant
 *     rows — one user's stored token never surfaces on another user's result.
 *   - the four honest states: connected / not-connected / needs-go-live / unknown,
 *     each from its real source (env presence vs per-user token row vs unreadable
 *     store) — never a fabricated "connected".
 *
 * Run: node --test server/tests/connector-status-scoping.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate331 } from "../migrations/331_connector_oauth_tokens.js";
import { persistConnectorToken } from "../lib/connector-tokens.js";
import { buildConnectorStatusList, MARQUEE_CONNECTORS } from "../routes/connector-oauth.js";

function freshDb() {
  const db = new Database(":memory:");
  migrate331(db);
  return db;
}

function byId(list) {
  const m = {};
  for (const c of list) m[c.id] = c;
  return m;
}

// Snapshot + set the operator OAuth client env for the marquee providers so the
// "configured" branch is exercised; restored in afterEach.
const ENV_KEYS = [
  "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
  "SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET",
  "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET",
  "NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET",
];
let saved;

function configureAllOperators() {
  for (const k of ENV_KEYS) process.env[k] = k.endsWith("_ID") ? "cid" : "secret";
}
function clearAllOperators() {
  for (const k of ENV_KEYS) delete process.env[k];
}

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

describe("buildConnectorStatusList — honest states", () => {
  it("covers all six marquee connectors", () => {
    configureAllOperators();
    const db = freshDb();
    const list = buildConnectorStatusList(db, "user-a");
    assert.equal(list.length, MARQUEE_CONNECTORS.length);
    assert.deepEqual(
      list.map((c) => c.id).sort(),
      ["github", "gmail", "google-calendar", "google-sheets", "notion", "slack"],
    );
  });

  it("operator NOT configured → 'needs-go-live' (deployment-wide gate, not per-user)", () => {
    clearAllOperators();
    const db = freshDb();
    // Even with a stored grant, an unconfigured operator can't have gone live.
    persistConnectorToken(db, "user-a", "google_gmail", { access_token: "tok", expires_in: 3600 });
    const list = byId(buildConnectorStatusList(db, "user-a"));
    assert.equal(list.gmail.status, "needs-go-live");
    assert.equal(list.gmail.operatorConfigured, false);
    assert.equal(list.slack.status, "needs-go-live");
  });

  it("configured + this user linked → 'connected'; configured + not linked → 'not-connected'", () => {
    configureAllOperators();
    const db = freshDb();
    persistConnectorToken(db, "user-a", "google_gmail", { access_token: "tok", expires_in: 3600 });
    const a = byId(buildConnectorStatusList(db, "user-a"));
    assert.equal(a.gmail.status, "connected");
    assert.equal(a.gmail.operatorConfigured, true);
    // No grant for the other five → configured-but-not-linked.
    assert.equal(a.slack.status, "not-connected");
    assert.equal(a.github.status, "not-connected");
    assert.equal(a.notion.status, "not-connected");
    assert.equal(a["google-calendar"].status, "not-connected");
    assert.equal(a["google-sheets"].status, "not-connected");
  });

  it("configured but token store unreadable → 'unknown' (never fabricated as connected)", () => {
    configureAllOperators();
    // db=null simulates a minimal build with no token store.
    const list = byId(buildConnectorStatusList(null, "user-a"));
    assert.equal(list.gmail.status, "unknown");
    assert.equal(list.github.status, "unknown");
  });
});

describe("buildConnectorStatusList — per-user scoping (no cross-user leak)", () => {
  it("one user's stored grant never surfaces on another user's result", () => {
    configureAllOperators();
    const db = freshDb();
    // Only user-a links Gmail + GitHub.
    persistConnectorToken(db, "user-a", "google_gmail", { access_token: "toka", expires_in: 3600 });
    persistConnectorToken(db, "user-a", "github", { access_token: "toka2" });

    const a = byId(buildConnectorStatusList(db, "user-a"));
    const b = byId(buildConnectorStatusList(db, "user-b"));

    // user-a sees their own grants as connected.
    assert.equal(a.gmail.status, "connected");
    assert.equal(a.github.status, "connected");

    // user-b, who linked nothing, sees NONE of user-a's grants — every marquee
    // connector reads not-connected for them.
    for (const c of Object.values(b)) {
      assert.equal(c.status, "not-connected", `${c.id} must not leak across users`);
    }
  });

  it("distinct users each see only their own linked connector", () => {
    configureAllOperators();
    const db = freshDb();
    persistConnectorToken(db, "user-a", "slack", { access_token: "sa" });
    persistConnectorToken(db, "user-b", "notion", { access_token: "nb" });

    const a = byId(buildConnectorStatusList(db, "user-a"));
    const b = byId(buildConnectorStatusList(db, "user-b"));

    assert.equal(a.slack.status, "connected");
    assert.equal(a.notion.status, "not-connected"); // user-b's Notion doesn't leak in
    assert.equal(b.notion.status, "connected");
    assert.equal(b.slack.status, "not-connected"); // user-a's Slack doesn't leak in
  });
});
