// FIX-integrations-003 — the encrypted per-user connector key store.
// Airtable/Stripe (api_key connectors) refused every connect with
// "credential required" because no stored-key path existed. The store
// (migration 509 + lib/connector-api-keys.js, AES-256-GCM via the
// platform's connector-tokens scheme) is that path. Pins cover the
// round trip, at-rest encryption, cross-user isolation, the no-leak
// rule (the full key appears in NO action result), tamper fail-closed,
// rotation, and revocation — including revocation riding disconnect.
// Hermetic: node:sqlite supplies the db surface the code uses.
import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { up as up331 } from "../migrations/331_connector_oauth_tokens.js";
import { up as up509 } from "../migrations/509_connector_api_keys.js";
import { getConnectorApiKey } from "../lib/connector-api-keys.js";
import registerIntegrationsActions from "../domains/integrations.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`integrations.${name}`);
  assert.ok(fn, `integrations.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const KEY_A = "pat_test_airtable_KEY_aaa1111";
const KEY_A2 = "pat_test_airtable_KEY_bbb2222";

let db;
before(() => {
  process.env.CONCORD_CONNECTOR_TOKEN_KEY = "gb1539-test-secret";
  registerIntegrationsActions(register);
});
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  up331(db); up509(db);
  globalThis._concordSTATE = {};
});
afterEach(() => { db.close(); delete globalThis._concordSTATE; });

const ctxA = () => ({ actor: { userId: "user_a" }, userId: "user_a", db });
const ctxB = () => ({ actor: { userId: "user_b" }, userId: "user_b", db });

describe("FIX-integrations-003 encrypted per-user API-key store", () => {
  it("still refuses an api_key connect with no stored key", () => {
    const r = call("connectApp", ctxA(), { connectorId: "airtable" });
    assert.equal(r.ok, false);
    assert.match(r.error, /credential required/i);
  });

  it("setApiKey validates: unknown connector, oauth connector, empty key, overlong key", () => {
    assert.equal(call("setApiKey", ctxA(), { connectorId: "nope", apiKey: KEY_A }).ok, false);
    const oauth = call("setApiKey", ctxA(), { connectorId: "slack", apiKey: KEY_A });
    assert.equal(oauth.ok, false);
    assert.match(oauth.error, /does not use an API key/i);
    assert.equal(call("setApiKey", ctxA(), { connectorId: "airtable", apiKey: "   " }).ok, false);
    assert.equal(call("setApiKey", ctxA(), { connectorId: "airtable", apiKey: "x".repeat(513) }).ok, false);
  });

  it("stores encrypted at rest, returns only the hint, and connects", () => {
    const set = call("setApiKey", ctxA(), { connectorId: "airtable", apiKey: KEY_A });
    assert.equal(set.ok, true, JSON.stringify(set));
    assert.equal(set.result.stored, true);
    assert.equal(set.result.hint, "1111");
    assert.ok(!JSON.stringify(set).includes(KEY_A), "set result must not contain the key");

    const row = db.prepare("SELECT * FROM connector_api_keys WHERE user_id = 'user_a'").get();
    assert.ok(row.encrypted_key.startsWith("enc:v1:"), "ciphertext carries the enc:v1 format");
    assert.ok(!row.encrypted_key.includes(KEY_A), "the key is not present in the stored row");

    const status = call("apiKeyStatus", ctxA(), { connectorId: "airtable" });
    assert.equal(status.result.stored, true);
    assert.equal(status.result.hint, "1111");
    assert.ok(!JSON.stringify(status).includes(KEY_A));

    const conn = call("connectApp", ctxA(), { connectorId: "airtable" });
    assert.equal(conn.ok, true, JSON.stringify(conn));
    assert.equal(conn.result.connection.credentialStored, true);
    assert.ok(!JSON.stringify(conn).includes(KEY_A));

    // server-side egress read is the only place the key comes back
    assert.equal(getConnectorApiKey(db, "user_a", "airtable"), KEY_A);
  });

  it("cross-user isolation: B has no key status and cannot connect on A's key", () => {
    call("setApiKey", ctxA(), { connectorId: "airtable", apiKey: KEY_A });
    assert.equal(call("apiKeyStatus", ctxB(), { connectorId: "airtable" }).result.stored, false);
    assert.equal(call("connectApp", ctxB(), { connectorId: "airtable" }).ok, false);
    assert.equal(getConnectorApiKey(db, "user_b", "airtable"), null);
  });

  it("tampered ciphertext fails closed", () => {
    call("setApiKey", ctxA(), { connectorId: "airtable", apiKey: KEY_A });
    db.prepare("UPDATE connector_api_keys SET encrypted_key = 'enc:v1:00:00:00' WHERE user_id = 'user_a'").run();
    assert.equal(call("apiKeyStatus", ctxA(), { connectorId: "airtable" }).result.stored, false);
    assert.equal(call("connectApp", ctxA(), { connectorId: "airtable" }).ok, false);
  });

  it("rotation replaces the key (new hint, new stored value, no history)", () => {
    call("setApiKey", ctxA(), { connectorId: "airtable", apiKey: KEY_A });
    const set2 = call("setApiKey", ctxA(), { connectorId: "airtable", apiKey: KEY_A2 });
    assert.equal(set2.result.hint, "2222");
    assert.equal(getConnectorApiKey(db, "user_a", "airtable"), KEY_A2);
    const rows = db.prepare("SELECT COUNT(*) AS n FROM connector_api_keys WHERE user_id = 'user_a'").get();
    assert.equal(rows.n, 1);
  });

  it("removeApiKey revokes: connect refuses again; connectionList stops reading Connected", () => {
    call("setApiKey", ctxA(), { connectorId: "stripe", apiKey: "sk_test_1234567890wxyz" });
    const conn = call("connectApp", ctxA(), { connectorId: "stripe" });
    assert.equal(conn.ok, true);
    const rm = call("removeApiKey", ctxA(), { connectorId: "stripe" });
    assert.equal(rm.result.removed, true);
    assert.equal(call("connectApp", ctxA(), { connectorId: "stripe" }).ok, false);
    const list = call("connectionList", ctxA(), {});
    const row = list.result.connections.find((c) => c.connectorId === "stripe");
    assert.equal(row.credentialStored, false);
  });

  it("disconnect revokes the stored key with the connection", () => {
    call("setApiKey", ctxA(), { connectorId: "airtable", apiKey: KEY_A });
    const conn = call("connectApp", ctxA(), { connectorId: "airtable" });
    const id = conn.result.connection.id;
    const disc = call("disconnectApp", ctxA(), { connectionId: id });
    assert.equal(disc.ok, true);
    assert.equal(call("apiKeyStatus", ctxA(), { connectorId: "airtable" }).result.stored, false);
    assert.equal(call("connectApp", ctxA(), { connectorId: "airtable" }).ok, false);
  });

  it("oauth2 and internal paths are untouched", () => {
    assert.equal(call("connectApp", ctxA(), { connectorId: "slack" }).ok, false); // still needs a real OAuth token
    assert.equal(call("connectApp", ctxA(), { connectorId: "concord_dtu" }).ok, true);
  });
});
