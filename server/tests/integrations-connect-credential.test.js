// INC-SWEEP strategic-adds F2 — connectApp must refuse without a real
// credential, must not invent `${id}-account` / status "connected", and a
// real connect must survive integrationsLens serialize/hydrate (restart).

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migrate331 } from "../migrations/331_connector_oauth_tokens.js";
import { persistConnectorToken } from "../lib/connector-tokens.js";
import registerIntegrationsActions from "../domains/integrations.js";
import { serializeLensState, hydrateLensState } from "../lib/lens-state-persistence.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  return ACTIONS.get(`integrations.${name}`)(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerIntegrationsActions(register); });

let db;
beforeEach(() => {
  globalThis._concordSTATE = {};
  db = new Database(":memory:");
  migrate331(db);
});
afterEach(() => { db.close(); delete globalThis._concordSTATE; });

const ctxA = () => ({ actor: { userId: "user_a" }, userId: "user_a", db });

describe("strategic-adds F2 integrations.connectApp credential honesty + restart", () => {
  it("refuses api_key connect with no credential (no fabricated account/status)", () => {
    for (const connectorId of ["stripe", "airtable"]) {
      const r = call("connectApp", ctxA(), { connectorId });
      assert.equal(r.ok, false, connectorId);
      assert.match(r.error, /credential required/i);
      assert.equal(shapeLensRunHttp(r).status, 422);
      assert.equal(r.result, undefined);
    }
    const list = call("connectionList", ctxA(), {});
    assert.equal(list.result.count, 0);
  });

  it("refuses oauth2 connect when no token is stored", () => {
    const r = call("connectApp", ctxA(), { connectorId: "slack" });
    assert.equal(r.ok, false);
    assert.match(r.error, /oauth credential required/i);
    assert.equal(shapeLensRunHttp(r).status, 422);
  });

  it("connects with a real oauth token, no invented account, survives rehydrate", () => {
    persistConnectorToken(db, "user_a", "slack", { access_token: "slack-at" });
    const r = call("connectApp", ctxA(), { connectorId: "slack", label: "team" });
    assert.equal(r.ok, true, JSON.stringify(r));
    const id = r.result.connection.id;
    assert.equal(r.result.connection.status, "connected");
    assert.equal(r.result.connection.credentialStored, true);
    assert.equal(r.result.connection.account, null);
    assert.notEqual(r.result.connection.account, "slack-account");

    const snap = serializeLensState(globalThis._concordSTATE);
    const persisted = JSON.parse(JSON.stringify(snap));
    const next = {};
    hydrateLensState(next, persisted);
    globalThis._concordSTATE = next;

    const list = call("connectionList", ctxA(), {});
    assert.equal(list.ok, true);
    const row = list.result.connections.find((c) => c.id === id);
    assert.ok(row, "connection must survive rehydrate");
    assert.equal(row.connectorId, "slack");
    assert.equal(row.status, "connected");
    assert.equal(row.account, null);
    assert.equal(row.credentialStored, true);
  });

  it("internal Concord DTU connect is allowed without an external token", () => {
    const r = call("connectApp", ctxA(), { connectorId: "concord_dtu" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.connection.status, "connected");
    assert.equal(r.result.connection.credentialStored, true);
    assert.equal(r.result.connection.account, null);
  });
});
