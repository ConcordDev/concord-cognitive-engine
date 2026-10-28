// /api/db/* — admin-only routes, read-only query console.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { createRoleGate } from "../lib/role-gate.js";
import { registerDbConsoleRoutes, runReadOnlyQuery, dbMacroDenied } from "../lib/db-console.js";

let server, base, db;
const macroCalls = [];

before(async () => {
  db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('a'),('b');");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.get("x-test-role");
    if (role) req.user = { id: "u1", role };
    next();
  });
  const { requireRole } = createRoleGate(() => "hybrid");
  registerDbConsoleRoutes(app, {
    requireRole,
    getDb: () => db,
    runMacro: async (d, n) => { macroCalls.push(`${d}.${n}`); return { ok: true, macro: `${d}.${n}` }; },
    makeCtx: (req) => ({ actor: { role: req.user?.role } }),
  });
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); db?.close(); });

const req = (method, path, { role, body } = {}) => fetch(base + path, {
  method,
  headers: { "content-type": "application/json", ...(role ? { "x-test-role": role } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const ROUTES = [
  ["POST", "/api/db/query", { query: "SELECT 1" }],
  ["GET", "/api/db/tables"],
  ["GET", "/api/db/indexes"],
  ["GET", "/api/db/status"],
  ["POST", "/api/db/migrate", {}],
  ["POST", "/api/db/sync", {}],
];

describe("/api/db/* admin gate", () => {
  it("anonymous callers get 401 on every route", async () => {
    for (const [m, p, body] of ROUTES) assert.equal((await req(m, p, { body })).status, 401, `${m} ${p}`);
  });
  it("non-admin (member/viewer) callers get 403 and nothing executes", async () => {
    for (const role of ["member", "viewer"]) {
      for (const [m, p, body] of ROUTES) {
        const r = await req(m, p, { role, body });
        assert.equal(r.status, 403, `${role} ${m} ${p}`);
        assert.equal(r.body.ok, false);
      }
    }
    assert.deepEqual(macroCalls, []);
  });
  it("admin/owner/founder/sovereign can read", async () => {
    for (const role of ["admin", "owner", "founder", "sovereign"]) {
      const q = await req("POST", "/api/db/query", { role, body: { query: "SELECT id, v FROM t ORDER BY id" } });
      assert.equal(q.status, 200, role);
      assert.deepEqual(q.body.rows, [{ id: 1, v: "a" }, { id: 2, v: "b" }]);
      assert.deepEqual(q.body.columns, ["id", "v"]);
      const t = await req("GET", "/api/db/tables", { role });
      assert.equal(t.status, 200);
      assert.ok(t.body.tables.some((x) => x.name === "t"));
      assert.equal((await req("GET", "/api/db/indexes", { role })).status, 200);
      assert.equal((await req("GET", "/api/db/status", { role })).status, 200);
    }
  });
});

describe("/api/db/query read-only enforcement (even for admin)", () => {
  const WRITES = [
    "DELETE FROM t",
    "UPDATE t SET v='x'",
    "INSERT INTO t (v) VALUES ('z')",
    "DROP TABLE t",
    "CREATE TABLE evil (x)",
    "WITH c AS (SELECT 1) DELETE FROM t",
    "ATTACH DATABASE ':memory:' AS other",
    "BEGIN",
    "PRAGMA user_version = 7",
    "VACUUM",
  ];
  it("rejects writes and non-reader statements", async () => {
    for (const query of WRITES) {
      const r = await req("POST", "/api/db/query", { role: "admin", body: { query } });
      assert.ok(r.status === 403 || r.status === 400, `${query} -> ${r.status}`);
      assert.equal(r.body.ok, false, query);
    }
    assert.equal(db.prepare("SELECT count(*) n FROM t").get().n, 2);
    assert.equal(db.prepare("SELECT v FROM t WHERE id=1").get().v, "a");
    assert.equal(db.pragma("user_version", { simple: true }), 0);
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='evil'").get().n, 0);
  });
  it("rejects multiple statements, including SELECT-prefixed smuggling", async () => {
    for (const query of ["SELECT 1; DELETE FROM t", "SELECT 1; SELECT 2"]) {
      const r = await req("POST", "/api/db/query", { role: "admin", body: { query } });
      assert.equal(r.status, 400, query);
      assert.equal(r.body.error, "multiple_statements_not_allowed");
    }
    assert.equal(db.prepare("SELECT count(*) n FROM t").get().n, 2);
  });
  it("empty query is 400; no db degrades gracefully", () => {
    assert.equal(runReadOnlyQuery(db, "  ").status, 400);
    const none = runReadOnlyQuery(null, "SELECT 1");
    assert.equal(none.status, 200);
    assert.deepEqual(none.body.rows, []);
  });
});

describe("db.* macro guard", () => {
  it("denies non-admin actors, allows admins and internal callers", () => {
    assert.ok(dbMacroDenied({ actor: { role: "member" } }));
    assert.ok(dbMacroDenied({}));
    assert.equal(dbMacroDenied({ actor: { role: "admin" } }), null);
    assert.equal(dbMacroDenied({ actor: { role: "sovereign" } }), null);
    assert.equal(dbMacroDenied({ internal: true }), null);
  });
});
