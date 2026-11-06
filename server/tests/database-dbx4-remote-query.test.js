// DBX-4 — query-run wiring for remote Postgres connections.
//
// Workspace connections keep the synchronous engine (proven here by
// an un-awaited call). Remote connections take the async read-only
// path: the cases below refuse at the statement, guard, or
// credentials stage, so no test dials out — the dial and the
// transaction wrapper are proven in db-dial-query.test.js, and the
// live-server success leg is the flagged NEEDS-INFRA verification.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerDatabaseActions from "../domains/database.js";

const handlers = new Map();
registerDatabaseActions((domain, action, fn) => handlers.set(`${domain}.${action}`, fn));
const run = (action, ctx, params) => handlers.get(`database.${action}`)(ctx, null, params || {});
const CTX = { actor: { userId: "u-dbx4" } };

before(() => { globalThis._concordSTATE = { dtus: new Map() }; });

function remoteConn(extra = {}) {
  const created = run("connection-create", CTX, { name: "Remote", engine: "postgresql", host: "10.0.0.5", port: 5432, username: "svc", password: "pw", ...extra });
  assert.equal(created.ok, true, JSON.stringify(created));
  return created.result.connection.id;
}

describe("DBX-4: query-run wiring", () => {
  it("a workspace query still runs synchronously on the local engine", () => {
    const created = run("connection-create", CTX, { name: "WS", readOnly: false });
    const cid = created.result.connection.id;
    run("dataset-create", CTX, { connectionId: cid, name: "t", columns: [{ name: "id", type: "integer" }] });
    const r = run("query-run", CTX, { connectionId: cid, sql: "INSERT INTO t (id) VALUES (1)" });
    assert.equal(r instanceof Promise, false, "workspace query-run stays synchronous");
    const sel = run("query-run", CTX, { connectionId: cid, sql: "SELECT id FROM t" });
    assert.equal(sel.result.success, true, JSON.stringify(sel));
    assert.equal(sel.result.rows[0].id, 1);
  });

  it("a write against a remote connection is refused at the statement stage and lands in history", async () => {
    const cid = remoteConn();
    const r = await run("query-run", CTX, { connectionId: cid, sql: "DELETE FROM users" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.success, false);
    assert.equal(r.result.stage, "statement");
    assert.equal(r.result.scope, "remote");
    assert.match(r.result.error, /read-only/);
    const hist = run("query-history", CTX, { connectionId: cid });
    assert.equal(hist.result.count >= 1, true);
    assert.equal(hist.result.history[0].success, false);
    assert.match(hist.result.history[0].error, /statement/);
  });

  it("a read against a private remote is refused at the guard stage", async () => {
    const cid = remoteConn();
    const r = await run("query-run", CTX, { connectionId: cid, sql: "SELECT id FROM users" });
    assert.equal(r.result.success, false);
    assert.equal(r.result.stage, "guard");
    assert.equal(r.result.remoteContacted, false);
  });

  it("an unreadable stored password is a credentials-stage refusal", async () => {
    const cid = remoteConn({ host: "db.example.com" });
    const s = globalThis._concordSTATE;
    const store = s.databaseLens || s.database || {};
    const conn = [...(store.connections?.get?.("u-dbx4") || [])].find((c) => c.id === cid);
    conn.passwordEnc = Buffer.from("garbage").toString("base64");
    const r = await run("query-run", CTX, { connectionId: cid, sql: "SELECT 1" });
    assert.equal(r.result.success, false);
    assert.equal(r.result.stage, "credentials");
    assert.equal(r.result.remoteContacted, false);
  });

  it("multiple statements are refused before anything else", async () => {
    const cid = remoteConn();
    const r = await run("query-run", CTX, { connectionId: cid, sql: "SELECT 1; SELECT 2" });
    assert.equal(r.result.success, false);
    assert.equal(r.result.stage, "statement");
    assert.match(r.result.error, /one statement at a time/);
  });

  it("query-explain on a remote connection refuses honestly instead of planning the wrong database", async () => {
    const cid = remoteConn();
    const r = await run("query-explain", CTX, { connectionId: cid, sql: "SELECT id FROM users" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.result.error, /cannot plan a remote server's query/);
    assert.match(r.result.error, /Run EXPLAIN as a query/);
  });
});
