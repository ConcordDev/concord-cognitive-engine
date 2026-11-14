// HV-12 — the flag-off pin (Mega Plan v2 §6, written at port time).
//
// CONCORD_DB_REMOTE_DIAL gates connection-test's real dials and remote
// query-run. With the flag OFF (the default):
//   - connection-test on a remote PostgreSQL connection answers
//     honestly "not dialled" — remoteContacted false, no workspace
//     success claimed for a remote server, and NO socket is opened
//     (a net.Socket connect spy stays silent through every leg);
//   - workspace connections keep today's answer, word for word shape;
//   - query-run on a remote connection takes today's workspace path,
//     never the dial path;
//   - the SSRF guard refuses loopback / link-local / private targets
//     before any dial (testRemotePostgres, the composed entry the
//     domain calls when the flag is on).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import registerDatabaseActions from "../domains/database.js";
import { testRemotePostgres } from "../lib/db-dial.js";

const handlers = new Map();
registerDatabaseActions((domain, action, fn) => handlers.set(`${domain}.${action}`, fn));
const run = (action, ctx, params) => handlers.get(`database.${action}`)(ctx, null, params || {});
const CTX = { actor: { userId: "u-dbx-flag-off" } };

let connectCalls = 0;
const origConnect = net.Socket.prototype.connect;
before(() => {
  delete process.env.CONCORD_DB_REMOTE_DIAL; // the flag is OFF for this suite
  globalThis._concordSTATE = { dtus: new Map() };
  net.Socket.prototype.connect = function (...args) {
    connectCalls += 1;
    return origConnect.apply(this, args);
  };
});
after(() => { net.Socket.prototype.connect = origConnect; });

describe("HV-12: CONCORD_DB_REMOTE_DIAL off", () => {
  it("connection-test on a remote PostgreSQL host is honestly not dialled, and no socket opens", async () => {
    const created = run("connection-create", CTX, { name: "RemotePG", engine: "postgresql", host: "db.example.com", port: 5432, username: "svc", password: "pw" });
    const r = await run("connection-test", CTX, { id: created.result.connection.id });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.scope, "remote");
    assert.equal(r.result.connected, false);
    assert.equal(r.result.remoteContacted, false);
    assert.equal(r.result.remoteTest, "dial_disabled");
    assert.match(r.result.message, /not contacted/);
    assert.equal(connectCalls, 0, "no socket may open with the flag off");
  });

  it("a workspace connection keeps today's answer with the flag off", async () => {
    const created = run("connection-create", CTX, { name: "WS", engine: "postgresql" });
    const r = run("connection-test", CTX, { id: created.result.connection.id });
    assert.equal(r instanceof Promise, false, "workspace test stays synchronous");
    assert.equal(r.result.scope, "workspace");
    assert.equal(r.result.connected, true);
    assert.equal(r.result.remoteContacted, false);
    assert.equal(connectCalls, 0);
  });

  it("query-run on a remote connection takes the workspace path, never the dial path", async () => {
    const created = run("connection-create", CTX, { name: "RemotePG2", engine: "postgresql", host: "db.example.com", port: 5432, username: "svc", password: "pw" });
    const r = await run("query-run", CTX, { connectionId: created.result.connection.id, sql: "SELECT 1" });
    assert.notEqual(r?.result?.stage, "guard");
    assert.notEqual(r?.result?.stage, "dial");
    assert.equal(connectCalls, 0, "no socket may open with the flag off");
  });

  for (const host of ["127.0.0.1", "169.254.169.254", "10.0.0.5"]) {
    it(`the guard refuses ${host} before any dial`, async () => {
      const r = await testRemotePostgres({ host, port: 5432, user: "svc", password: "pw" });
      assert.equal(r.connected, false);
      assert.equal(r.stage, "guard");
      assert.equal(r.remoteContacted, false);
      assert.equal(connectCalls, 0, "a refused target is never dialed");
    });
  }
});
