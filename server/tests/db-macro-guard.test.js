import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { actorMayRunDbMacro, dbMacroHttpGuard, installDbMacroGuards } from "../lib/db-macro-guard.js";

function macros() {
  const calls = [];
  const root = new Map();
  const db = new Map();
  for (const name of ["status", "query", "migrate", "syncToPostgres"]) {
    db.set(name, { fn: async () => { calls.push(name); return { ok: true, name }; }, spec: {} });
  }
  const jobs = new Map();
  jobs.set("enqueue", { fn: async (_ctx, input) => { calls.push(`enqueue:${input.kind}`); return { ok: true }; }, spec: {} });
  root.set("db", db);
  root.set("jobs", jobs);
  return { root, calls, db, jobs };
}

describe("db macro admin gate", () => {
  it("lets an admin and an internal owner through and stops a member", async () => {
    const { root, calls, db, jobs } = macros();
    installDbMacroGuards(root);
    const member = { actor: { userId: "u1", role: "member", scopes: [] } };
    const admin = { actor: { userId: "a1", role: "admin", scopes: [] } };
    const internal = { actor: { userId: "system", role: "owner", scopes: ["*"], internal: true } };
    const anon = {};

    assert.equal(actorMayRunDbMacro(member), false);
    assert.equal(actorMayRunDbMacro(anon), false);
    assert.equal(actorMayRunDbMacro(admin), true);
    assert.equal(actorMayRunDbMacro(internal), true);
    assert.equal(actorMayRunDbMacro({ actor: { role: "member", internal: true } }), false);

    const denied = await db.get("query").fn(member, { sql: "select 1" });
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 403);
    assert.match(denied.error, /forbidden: db.query/);
    assert.deepEqual(calls, []);

    assert.equal((await db.get("migrate").fn(member, {})).status, 403);
    assert.equal((await db.get("syncToPostgres").fn(member, {})).status, 403);
    assert.equal((await db.get("query").fn(admin, { sql: "select 1" })).ok, true);
    assert.equal((await db.get("migrate").fn(internal, {})).ok, true);
    assert.equal((await jobs.get("enqueue").fn(member, { kind: "db.query" })).status, 403);
    assert.equal((await jobs.get("enqueue").fn(admin, { kind: "db.query" })).ok, true);
    assert.equal((await jobs.get("enqueue").fn(member, { kind: "mail.send" })).ok, true);
    assert.deepEqual(calls, ["query", "migrate", "enqueue:db.query", "enqueue:mail.send"]);
  });

  let server;
  let base;
  let reached;

  before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const role = req.headers["x-role"];
      const id = req.headers["x-user-id"];
      if (id) req.user = { id: String(id), role: role ? String(role) : "member" };
      next();
    });
    app.use(dbMacroHttpGuard);
    app.post("/api/lens/run", (_req, res) => { reached.push("lens"); res.json({ ok: true, handler: "legacy" }); });
    app.post("/api/v1/lens/:domain/:action", (_req, res) => { reached.push("v1"); res.json({ ok: true, handler: "legacy" }); });
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  async function post(path, body, headers = {}) {
    reached = [];
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json(), reached: [...reached] };
  }

  it("answers 403 from the guard before the legacy lens handler", async () => {
    const member = { "x-user-id": "u1", "x-role": "member" };
    const query = await post("/api/lens/run", { domain: "db", action: "query", sql: "select 1" }, member);
    assert.equal(query.status, 403);
    assert.match(query.json.error, /forbidden: db.query/);
    assert.deepEqual(query.reached, []);

    const anon = await post("/api/lens/run", { domain: "db", name: "migrate" });
    assert.equal(anon.status, 403);
    assert.deepEqual(anon.reached, []);

    const sync = await post("/api/v1/lens/db/syncToPostgres", {}, member);
    assert.equal(sync.status, 403);
    assert.deepEqual(sync.reached, []);

    const job = await post("/api/lens/run", { domain: "jobs", action: "enqueue", input: { kind: "db.query" } }, member);
    assert.equal(job.status, 403);
    assert.match(job.json.error, /forbidden: db.query/);

    const status = await post("/api/lens/run", { domain: "db", action: "status" }, member);
    assert.equal(status.status, 200);
    assert.equal(status.json.handler, "legacy");

    const admin = await post("/api/lens/run", { domain: "db", action: "query" }, { "x-user-id": "a1", "x-role": "admin" });
    assert.equal(admin.status, 200);
    assert.equal(admin.json.handler, "legacy");
  });
});
