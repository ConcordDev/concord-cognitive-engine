// /api/user-memory over real HTTP + account deletion/export integration + server.js wiring pins.
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Database from "better-sqlite3";

import { up } from "../migrations/495_user_memory.js";
import createUserMemoryRouter from "../routes/user-memory.js";
import * as M from "../lib/user-memory.js";
import { executeAccountDeletion, exportUserData } from "../lib/account-lifecycle.js";

const A = "user-a";
const B = "user-b";
let db, server, base;

// Test auth: the x-test-user header stands in for a verified session. No header => 401 like requireAuth.
const requireAuth = () => (req, res, next) => {
  const id = req.get("x-test-user");
  if (!id) return res.status(401).json({ ok: false, error: "auth_required" });
  req.user = { id };
  next();
};
const call = async (method, p, { user, body } = {}) => {
  const r = await fetch(`${base}${p}`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: body === undefined || method === "GET" ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const pref = (value) => ({ kind: "preference", subject: "response_length", predicate: "preference", value, explicit: true });

before(async () => {
  process.env.CONCORD_USER_MEMORY = "1";
  db = new Database(":memory:");
  up(db);
  const app = express();
  app.use(express.json());
  app.use("/api/user-memory", createUserMemoryRouter({ db, requireAuth }));
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}/api/user-memory`;
});
after(() => { delete process.env.CONCORD_USER_MEMORY; server?.close(); });
beforeEach(() => {
  for (const t of ["user_memory_uses", "user_memory_links", "user_memory_facts", "user_memory_projects_off", "user_memory_settings"]) db.exec(`DELETE FROM ${t}`);
  M.setEnabled(db, A, true);
  M.setEnabled(db, B, true);
});

describe("auth", () => {
  for (const [m, p] of [["GET", "/settings"], ["PUT", "/settings"], ["GET", "/facts"], ["PATCH", "/facts/x"], ["DELETE", "/facts/x"], ["DELETE", "/all"], ["GET", "/export"], ["GET", "/used?sessionId=s&msgId=m"], ["PUT", "/projects/p/off"], ["DELETE", "/projects/p"]]) {
    it(`${m} ${p} without a session: 401`, async () => {
      assert.equal((await call(m, p, { body: {} })).status, 401);
    });
  }
});

describe("settings", () => {
  it("default off for a new user; opt in and out round-trips", async () => {
    assert.equal((await call("GET", "/settings", { user: "fresh" })).body.enabled, false);
    assert.equal((await call("PUT", "/settings", { user: "fresh", body: { enabled: true } })).status, 200);
    assert.equal((await call("GET", "/settings", { user: "fresh" })).body.enabled, true);
    await call("PUT", "/settings", { user: "fresh", body: { enabled: false } });
    assert.equal((await call("GET", "/settings", { user: "fresh" })).body.enabled, false);
  });

  it("refuses to enable while the operator master flag is off", async () => {
    delete process.env.CONCORD_USER_MEMORY;
    try {
      const r = await call("PUT", "/settings", { user: "fresh2", body: { enabled: true } });
      assert.equal(r.status, 409);
      assert.equal(r.body.error, "memory_unavailable");
      assert.equal((await call("GET", "/settings", { user: "fresh2" })).body.available, false);
    } finally { process.env.CONCORD_USER_MEMORY = "1"; }
  });
});

describe("control + isolation over HTTP", () => {
  it("list / why / history / edit / delete work for the owner", async () => {
    const f1 = M.remember(db, A, pref("I prefer short answers"), { sessionId: "s1", msgId: "m1", now: 1 });
    const f2 = M.remember(db, A, pref("I prefer detailed answers"), { sessionId: "s1", msgId: "m2", now: 2 });
    const list = await call("GET", "/facts", { user: A });
    assert.deepEqual(list.body.facts.map((f) => f.id), [f2.id]);
    assert.equal((await call("GET", `/facts/${f2.id}/why`, { user: A })).body.why.sessionId, "s1");
    assert.equal((await call("GET", `/facts/${f2.id}/history`, { user: A })).body.history.length, 2);
    assert.equal((await call("PATCH", `/facts/${f2.id}`, { user: A, body: { value: "I prefer thorough answers" } })).status, 200);
    assert.equal((await call("DELETE", `/facts/${f2.id}`, { user: A })).status, 200);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM user_memory_facts WHERE id IN (?, ?)").get(f1.id, f2.id).c, 0);
  });

  it("B gets 404 / empty / no effect on every one of A's facts", async () => {
    const f = M.remember(db, A, pref("I prefer short answers"), { sessionId: "s1", msgId: "m1" });
    assert.deepEqual((await call("GET", "/facts", { user: B })).body.facts, []);
    assert.equal((await call("GET", `/facts/${f.id}/why`, { user: B })).status, 404);
    assert.equal((await call("GET", `/facts/${f.id}/history`, { user: B })).status, 404);
    assert.equal((await call("PATCH", `/facts/${f.id}`, { user: B, body: { value: "hijack" } })).status, 404);
    assert.equal((await call("DELETE", `/facts/${f.id}`, { user: B })).status, 404);
    assert.equal((await call("DELETE", "/all", { user: B })).body.deleted, 0);
    assert.deepEqual((await call("GET", "/export", { user: B })).body.memory.facts, []);
    assert.deepEqual((await call("GET", "/used?sessionId=s1&msgId=m1", { user: B })).body.facts, []);
    // a body/query userId is ignored: the session decides
    assert.deepEqual((await call("GET", `/facts?userId=${A}`, { user: B })).body.facts, []);
    assert.equal(M.listFacts(db, A).length, 1);
  });

  it("delete-all and per-project forget remove only the caller's data", async () => {
    M.remember(db, A, pref("I prefer short answers"), { projectId: "p1" });
    M.remember(db, A, { kind: "fact", subject: "note", predicate: "n", value: "keep", explicit: true });
    M.remember(db, B, pref("bob pref"));
    assert.equal((await call("DELETE", "/projects/p1", { user: A })).body.deleted, 1);
    assert.equal(M.listFacts(db, A).length, 1);
    assert.equal((await call("DELETE", "/all", { user: A })).body.deleted, 1);
    assert.equal(M.listFacts(db, B).length, 1);
  });

  it("per-project off switch and export", async () => {
    assert.equal((await call("PUT", "/projects/p9/off", { user: A, body: { off: true } })).status, 200);
    assert.equal(M.remember(db, A, pref("x"), { projectId: "p9" }).error, "project_off");
    M.remember(db, A, pref("I prefer short answers"));
    const e = (await call("GET", "/export", { user: A })).body.memory;
    assert.deepEqual(e.projectsOff, ["p9"]);
    assert.equal(e.facts.length, 1);
  });

  it("a pending contradiction can be resolved by the user", async () => {
    const f = M.remember(db, A, pref("I prefer short answers"));
    await call("PATCH", `/facts/${f.id}`, { user: A, body: { value: "I prefer terse answers" } });
    const p = M.remember(db, A, pref("I prefer detailed answers"));
    assert.equal(p.pending, true);
    assert.equal((await call("POST", `/facts/${p.id}/resolve`, { user: A })).status, 200);
    assert.match((await call("GET", "/facts", { user: A })).body.facts[0].value, /detailed/);
  });
});

describe("account deletion + export include user memory", () => {
  function accountDb() {
    const d = new Database(":memory:");
    d.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL DEFAULT 'x', role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login_at TEXT, is_active INTEGER NOT NULL DEFAULT 1);`);
    up(d);
    for (const [id, n] of [[A, "alice"], [B, "bob"]]) {
      d.prepare("INSERT INTO users (id, username, email) VALUES (?, ?, ?)").run(id, n, `${n}@example.com`);
      M.setEnabled(d, id, true);
    }
    M.remember(d, A, pref("I prefer short answers"), { projectId: "p1", embedding: [1, 2], dtuIds: ["dtu_1"] });
    M.remember(d, A, pref("I prefer detailed answers"), { projectId: "p1" });
    M.remember(d, B, pref("bob keeps this"));
    return d;
  }

  it("deleting A purges every user_memory table for A and leaves B whole", () => {
    const d = accountDb();
    assert.equal(executeAccountDeletion(d, A).ok, true);
    for (const t of ["user_memory_facts", "user_memory_links", "user_memory_uses", "user_memory_projects_off", "user_memory_settings"]) {
      assert.equal(d.prepare(`SELECT COUNT(*) c FROM ${t} WHERE user_id = ?`).get(A).c, 0, t);
    }
    assert.equal(M.listFacts(d, B).length, 1);
    assert.equal(M.isEnabled(d, B), true);
  });

  it("export for A has A's memory with history and none of B's", () => {
    const d = accountDb();
    const r = exportUserData(d, A);
    const data = r.data ?? r;
    assert.equal(data.userMemory.facts.length, 2);
    assert.ok(data.userMemory.facts.every((f) => !("embedding" in f)));
    assert.ok(!JSON.stringify(data).includes("bob keeps this"));
  });

  it("a DB without the tables still deletes and exports", () => {
    const d = new Database(":memory:");
    d.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL DEFAULT 'x', role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login_at TEXT, is_active INTEGER NOT NULL DEFAULT 1);`);
    d.prepare("INSERT INTO users (id, username, email) VALUES (?, ?, ?)").run(A, "alice", "a@example.com");
    assert.equal(exportUserData(d, A).ok !== false, true);
    assert.equal(executeAccountDeletion(d, A).ok, true);
  });
});

describe("server.js wiring pins", () => {
  const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../server.js"), "utf8");
  it("mounts the router behind requireAuth", () => {
    assert.match(src, /app\.use\("\/api\/user-memory", createUserMemoryRouter\(\{ db, requireAuth \}\)\)/);
  });
  it("chat.respond captures then retrieves, guarded by try/catch, via the flag-gated helpers", () => {
    assert.match(src, /_captureUserMemory\(_umDb, _umUid, prompt/);
    assert.match(src, /_buildUserMemoryBlock\(_umDb, _umUid/);
    assert.match(src, /memory must never block chat/);
  });
});
