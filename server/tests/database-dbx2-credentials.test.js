// DBX-2 — the credential vault on the Database connection record.
//
// Database §8 (allowed-with-safeguards): a connection may carry a real
// password, stored ONLY as a byo-crypto v2 ciphertext (AES-GCM with a
// per-user derived key — the same module that wraps BYO provider keys),
// never returned by any macro. Summaries expose hasPassword and
// nothing else. These tests prove: encryption at rest (a raw state
// scan finds no plaintext), round-trip through the canonical
// decryptKey, per-user binding (another user's key cannot open the
// blob), replace/preserve/clear semantics on update, port validation,
// and owner scoping.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerDatabaseActions from "../domains/database.js";
import { decryptKey, encryptKey, decryptKeySync } from "../lib/byo-crypto.js";

const handlers = new Map();
registerDatabaseActions((domain, action, fn) => handlers.set(`${domain}.${action}`, fn));
const run = (action, ctx, params) => handlers.get(`database.${action}`)(ctx, null, params || {});
const CTX = { actor: { userId: "u-dbx2" } };
const OTHER = { actor: { userId: "u-other" } };
const ANON = {};
const SECRET = "correct horse battery staple";

before(() => { globalThis._concordSTATE = { dtus: new Map() }; });

function storedConn(uid, id) {
  const s = globalThis._concordSTATE;
  const store = s.databaseLens || s.database || {};
  const conns = store.connections?.get?.(uid) || [];
  return conns.find((c) => c.id === id);
}

describe("DBX-2: credential vault", () => {
  it("create stores only ciphertext — a raw state scan finds no plaintext", async () => {
    const r = await run("connection-create", CTX, { name: "Vault", engine: "postgresql", host: "db.example.com", port: 5432, username: "svc", password: SECRET });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.connection.hasPassword, true);
    assert.equal(r.result.connection.port, 5432);
    assert.equal("password" in r.result.connection, false);
    assert.equal("passwordEnc" in r.result.connection, false);
    const raw = JSON.stringify(globalThis._concordSTATE, (k, v) => (v instanceof Map ? [...v] : v));
    assert.equal(raw.includes(SECRET), false, "plaintext password found in state");
    const stored = storedConn("u-dbx2", r.result.connection.id);
    assert.ok(stored.passwordEnc, "ciphertext stored");
    // The canonical decryptor opens it — and only for the owning user.
    const opened = await decryptKey("u-dbx2", Buffer.from(stored.passwordEnc, "base64"));
    assert.equal(opened, SECRET);
    const wrongUser = await decryptKey("u-other", Buffer.from(stored.passwordEnc, "base64"));
    assert.equal(wrongUser, null);
  });

  it("the sync-written blob and the canonical async format are interchangeable", async () => {
    // The vault writes with byo-crypto's sync twin (the domain's macros
    // are synchronous); the canonical async decryptor must open those
    // blobs (proven in the first test), and the sync decryptor must
    // open canonical async-written blobs — one format, two paths.
    const asyncBlob = await encryptKey("u-dbx2", "async-written secret");
    assert.equal(decryptKeySync("u-dbx2", asyncBlob), "async-written secret");
    assert.equal(decryptKeySync("u-other", asyncBlob), null);
    const tampered = Buffer.from(asyncBlob);
    tampered[tampered.length - 1] ^= 0xff;
    assert.equal(decryptKeySync("u-dbx2", tampered), null);
  });

  it("create without a password stores none and reports hasPassword false", async () => {
    const r = await run("connection-create", CTX, { name: "NoPass", engine: "postgresql", host: "db.example.com" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.connection.hasPassword, false);
    assert.equal(r.result.connection.port, null);
    assert.equal(storedConn("u-dbx2", r.result.connection.id).passwordEnc, null);
  });

  it("connection-list summaries never carry a secret field", async () => {
    const r = await run("connection-list", CTX, {});
    assert.equal(r.ok, true);
    for (const c of r.result.connections) {
      assert.equal("password" in c, false);
      assert.equal("passwordEnc" in c, false);
      assert.equal(typeof c.hasPassword, "boolean");
    }
  });

  it("update replaces the password when one is given, preserves it when absent, clears it on request", async () => {
    const created = await run("connection-create", CTX, { name: "Rotate", engine: "postgresql", host: "db.example.com", password: "first-secret" });
    const id = created.result.connection.id;
    const untouched = await run("connection-update", CTX, { id, host: "db2.example.com" });
    assert.equal(untouched.ok, true, JSON.stringify(untouched));
    assert.equal(untouched.result.connection.hasPassword, true);
    assert.equal(await decryptKey("u-dbx2", Buffer.from(storedConn("u-dbx2", id).passwordEnc, "base64")), "first-secret");
    const rotated = await run("connection-update", CTX, { id, password: "second-secret" });
    assert.equal(rotated.ok, true);
    assert.equal(await decryptKey("u-dbx2", Buffer.from(storedConn("u-dbx2", id).passwordEnc, "base64")), "second-secret");
    const cleared = await run("connection-update", CTX, { id, clearPassword: true });
    assert.equal(cleared.ok, true);
    assert.equal(cleared.result.connection.hasPassword, false);
    assert.equal(storedConn("u-dbx2", id).passwordEnc, null);
  });

  it("port is validated on create and update", async () => {
    for (const port of [0, 65536, -1, "abc", 5432.5]) {
      const r = await run("connection-create", CTX, { name: "BadPort", port });
      assert.equal(r.ok, false, `port ${JSON.stringify(port)}`);
      assert.match(r.error, /port must be an integer/);
    }
    const ok = await run("connection-create", CTX, { name: "GoodPort", port: "5433" });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.result.connection.port, 5433);
    const badUpdate = await run("connection-update", CTX, { id: ok.result.connection.id, port: 99999 });
    assert.equal(badUpdate.ok, false);
  });

  it("connections stay owner-scoped: another user sees none of them", async () => {
    const mine = await run("connection-list", CTX, {});
    assert.ok(mine.result.count >= 1);
    const theirs = await run("connection-list", OTHER, {});
    assert.equal(theirs.result.count, 0);
    const firstId = mine.result.connections[0].id;
    const foreign = await run("connection-update", OTHER, { id: firstId, password: "pwned" });
    assert.equal(foreign.ok, false);
  });

  it("anonymous callers cannot create connections (write guard intact)", async () => {
    const r = await run("connection-create", ANON, { name: "Anon", password: "x" });
    assert.equal(r.ok, false);
  });
});
