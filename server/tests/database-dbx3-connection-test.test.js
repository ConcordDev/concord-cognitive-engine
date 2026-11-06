// DBX-3 — connection-test wiring: which connections get a real test.
//
// - Workspace connections (host "local", any engine) keep the original
//   honest answer, returned SYNCHRONOUSLY as before: scope "workspace",
//   remoteContacted false.
// - PostgreSQL + a real host → the guarded remote path (async). The
//   cases here refuse at the guard or the credentials stage, so no
//   test ever dials out; the dial itself is proven in db-dial.test.js.
// - MySQL + a real host → explicitly not wired yet, nothing contacted.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerDatabaseActions from "../domains/database.js";

const handlers = new Map();
registerDatabaseActions((domain, action, fn) => handlers.set(`${domain}.${action}`, fn));
const run = (action, ctx, params) => handlers.get(`database.${action}`)(ctx, null, params || {});
const CTX = { actor: { userId: "u-dbx3" } };

before(() => { globalThis._concordSTATE = { dtus: new Map() }; });

describe("DBX-3: connection-test wiring", () => {
  it("a workspace connection keeps the original synchronous honest answer", async () => {
    const created = run("connection-create", CTX, { name: "WS", engine: "postgresql" });
    const id = created.result.connection.id;
    const r = run("connection-test", CTX, { id });
    assert.equal(r instanceof Promise, false, "workspace test stays synchronous");
    assert.equal(r.ok, true);
    assert.equal(r.result.scope, "workspace");
    assert.equal(r.result.connected, true);
    assert.equal(r.result.remoteContacted, false);
  });

  it("a PostgreSQL connection at a private host is refused at the guard stage", async () => {
    const created = run("connection-create", CTX, { name: "Priv", engine: "postgresql", host: "10.0.0.5", port: 5432, username: "svc", password: "pw" });
    const r = await run("connection-test", CTX, { id: created.result.connection.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.scope, "remote");
    assert.equal(r.result.connected, false);
    assert.equal(r.result.stage, "guard");
    assert.equal(r.result.code, "private_address");
    assert.equal(r.result.remoteContacted, false);
  });

  it("a PostgreSQL connection at a non-database port is refused at the guard stage", async () => {
    const created = run("connection-create", CTX, { name: "BadPort", engine: "postgresql", host: "db.example.com", port: 22, username: "svc" });
    const r = await run("connection-test", CTX, { id: created.result.connection.id });
    assert.equal(r.result.stage, "guard");
    assert.equal(r.result.code, "port_not_allowed");
    assert.equal(r.result.remoteContacted, false);
  });

  it("an unreadable stored password is a credentials-stage refusal — nothing dialed", async () => {
    const created = run("connection-create", CTX, { name: "Corrupt", engine: "postgresql", host: "db.example.com", port: 5432, username: "svc", password: "pw" });
    const id = created.result.connection.id;
    const s = globalThis._concordSTATE;
    const store = s.databaseLens || s.database || {};
    const conn = [...(store.connections?.get?.("u-dbx3") || [])].find((c) => c.id === id);
    conn.passwordEnc = Buffer.from("not-a-real-ciphertext").toString("base64");
    const r = await run("connection-test", CTX, { id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.stage, "credentials");
    assert.equal(r.result.connected, false);
    assert.equal(r.result.remoteContacted, false);
  });

  it("a MySQL connection at a real host reports not-wired, honestly uncontacted", async () => {
    const created = run("connection-create", CTX, { name: "My", engine: "mysql", host: "db.example.com", port: 3306, username: "svc" });
    const r = await run("connection-test", CTX, { id: created.result.connection.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.scope, "remote");
    assert.equal(r.result.remoteTest, "not_wired_for_engine");
    assert.equal(r.result.connected, false);
    assert.equal(r.result.remoteContacted, false);
  });

  it("an unknown connection is still a plain not-found", async () => {
    const r = await run("connection-test", CTX, { id: "conn_missing" });
    assert.equal(r.ok, false);
    assert.match(r.error, /connection not found/);
  });
});
