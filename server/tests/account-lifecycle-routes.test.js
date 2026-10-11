// Mounted-path regression for the account lifecycle router.
//
// Production mounted this router at /api/account while the route strings
// themselves started with /account, so the live handlers were only reachable
// at /api/account/account/export (and delete / cancel-deletion). The canonical
// paths the UI calls — /api/account/export, /api/account/delete,
// /api/account/cancel-deletion — 404'd.
//
// The export also has to be the requesting user's records. `dtus.owner_user_id`
// alone misses creator_id-only rows and the dtu_store rows dtu.create actually
// persists, and it must never include another account's rows or ownerless /
// system rows.
//
// This file mounts the router the same way server.js does
// (`app.use("/api/account", createAccountLifecycleRouter(...))`) and requests
// the canonical paths through that app. A router-only dispatch of
// "/account/export" would stay green while production 404'd.
//
// Run: node --test server/tests/account-lifecycle-routes.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Database from "better-sqlite3";

import createAccountLifecycleRouter from "../routes/account-lifecycle.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL DEFAULT 'x',
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT,
      creator_id TEXT,
      title TEXT NOT NULL DEFAULT 'Untitled',
      body_json TEXT NOT NULL DEFAULT '{}',
      tags_json TEXT NOT NULL DEFAULT '[]',
      visibility TEXT NOT NULL DEFAULT 'private',
      tier TEXT NOT NULL DEFAULT 'regular',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE dtu_store (
      id TEXT PRIMARY KEY,
      title TEXT,
      tier TEXT,
      scope TEXT,
      tags TEXT,
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL,
      owner_user_id TEXT,
      visibility TEXT
    );

    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      from_user_id TEXT,
      to_user_id TEXT,
      amount REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      net REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete',
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE economy_withdrawals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      net REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE account_deletion_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'scheduled',
      balance_at_request REAL DEFAULT 0,
      forfeit_date TEXT,
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      user_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      request_id TEXT,
      path TEXT,
      method TEXT,
      status_code INTEGER,
      details TEXT
    );
  `);
  return db;
}

function seedUser(db, id) {
  db.prepare(
    "INSERT INTO users (id, username, email, password_hash, role, created_at) VALUES (?,?,?,?, 'member', datetime('now'))"
  ).run(id, `${id}_name`, `${id}@example.com`, "hash");
}

function seedWorld(db) {
  seedUser(db, "userA");
  seedUser(db, "userB");
  seedUser(db, "userC");

  const dtu = db.prepare(
    "INSERT INTO dtus (id, owner_user_id, creator_id, title, body_json) VALUES (?,?,?,?,?)"
  );
  dtu.run("a-owned", "userA", "userA", "A owned", "{\"note\":\"a\"}");
  dtu.run("a-creator-only", null, "userA", "A creator only", "{\"note\":\"creator\"}");
  dtu.run("b-owned", "userB", "userB", "B owned", "{\"note\":\"b\"}");
  dtu.run("b-created-by-a", "userB", "userA", "transferred to B", "{}");
  dtu.run("ownerless", null, null, "ownerless seed", "{}");
  dtu.run("system-actor", null, "system", "system seed", "{}");
  dtu.run("c-owned", "userC", "userC", "C owned", "{}");

  const store = db.prepare(
    "INSERT INTO dtu_store (id, title, tier, scope, tags, source, created_at, updated_at, data, owner_user_id, visibility) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
  );
  const now = "2026-10-01 00:00:00";
  store.run(
    "a-store", "A store", "regular", "local", "[]", "user", now, now,
    JSON.stringify({ id: "a-store", title: "A store", ownerId: "userA", body: "hello from A" }),
    "userA", "private",
  );
  store.run(
    "b-store", "B store", "regular", "local", "[]", "user", now, now,
    JSON.stringify({ id: "b-store", title: "B store", ownerId: "userB", body: "hello from B" }),
    "userB", "private",
  );
  store.run(
    "system-store", "heartbeat", "regular", "system", "[]", "heartbeat", now, now,
    JSON.stringify({ id: "system-store", title: "heartbeat", ownerId: "system" }),
    "system", "internal",
  );
  store.run(
    "ownerless-store", "no owner", "regular", "global", "[]", "migration", now, now,
    JSON.stringify({ id: "ownerless-store", title: "no owner" }),
    null, "public",
  );
}

function makeApp(db) {
  const app = express();
  app.use(express.json());
  // Stands in for the production JWT/cookie middleware: a Bearer token whose
  // value is the user id sets req.user. No token leaves req.user unset.
  app.use((req, _res, next) => {
    const header = req.get("authorization") || "";
    const match = header.match(/^Bearer\s+(\S+)/i);
    if (match) req.user = { id: match[1], role: "member" };
    next();
  });
  const requireAuth = () => (req, res, next) => {
    if (!req.user?.id) return res.status(401).json({ ok: false, error: "Unauthorized" });
    next();
  };
  // Same mount as server.js. The route strings are /export, /delete, …
  app.use("/api/account", createAccountLifecycleRouter({ db, requireAuth, adminOnly: (_req, res) => res.status(403).json({ ok: false, error: "forbidden" }) }));
  return app;
}

async function call(app, method, urlPath, { token, body } = {}) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, body: json, text };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("account lifecycle mounted paths", () => {
  it("production mounts the router at /api/account and the route strings are not doubled", () => {
    const serverSrc = readFileSync(path.join(HERE, "..", "server.js"), "utf8");
    const routeSrc = readFileSync(path.join(HERE, "..", "routes", "account-lifecycle.js"), "utf8");
    assert.match(serverSrc, /app\.use\("\/api\/account",\s*createAccountLifecycleRouter\(/);
    assert.match(routeSrc, /router\.get\("\/export"/);
    assert.match(routeSrc, /router\.post\("\/delete"/);
    assert.match(routeSrc, /router\.post\("\/cancel-deletion"/);
    assert.doesNotMatch(routeSrc, /router\.(get|post)\("\/account\/(export|delete|cancel-deletion|merge|merge-token)"/);
  });

  it("GET /api/account/export returns only the caller's DTUs", async () => {
    const db = createDb();
    seedWorld(db);
    const app = makeApp(db);
    const { status, body } = await call(app, "GET", "/api/account/export", { token: "userA" });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.user.id, "userA");
    const ids = (body.dtus || []).map((d) => d.id).sort();
    assert.deepEqual(ids, ["a-creator-only", "a-owned", "a-store"]);
    const blob = JSON.stringify(body.dtus);
    assert.equal(blob.includes("b-owned"), false);
    assert.equal(blob.includes("b-store"), false);
    assert.equal(blob.includes("b-created-by-a"), false);
    assert.equal(blob.includes("ownerless"), false);
    assert.equal(blob.includes("system-actor"), false);
    assert.equal(blob.includes("system-store"), false);
    assert.equal(blob.includes("c-owned"), false);
    const store = body.dtus.find((d) => d.id === "a-store");
    assert.equal(store.title, "A store");
    assert.match(store.body_json, /hello from A/);
  });

  it("the doubled /api/account/account/export path is not served", async () => {
    const db = createDb();
    seedWorld(db);
    const app = makeApp(db);
    const doubled = await call(app, "GET", "/api/account/account/export", { token: "userA" });
    assert.equal(doubled.status, 404);
    const canonical = await call(app, "GET", "/api/account/export", { token: "userA" });
    assert.equal(canonical.status, 200);
  });

  it("unauthenticated export, delete, and cancel-deletion are 401", async () => {
    const db = createDb();
    seedWorld(db);
    const app = makeApp(db);
    const exportRes = await call(app, "GET", "/api/account/export");
    const deleteRes = await call(app, "POST", "/api/account/delete", { body: { confirm: "DELETE_MY_ACCOUNT" } });
    const cancelRes = await call(app, "POST", "/api/account/cancel-deletion", { body: {} });
    assert.equal(exportRes.status, 401);
    assert.equal(deleteRes.status, 401);
    assert.equal(cancelRes.status, 401);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM users").get().c, 3);
  });

  it("POST /api/account/delete schedules when a balance remains, and cancel-deletion clears it", async () => {
    const db = createDb();
    seedWorld(db);
    db.prepare(
      "INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status) VALUES ('ledA', 'ROYALTY_PAYOUT', NULL, 'userA', 12.5, 0, 12.5, 'complete')"
    ).run();
    const app = makeApp(db);

    const scheduled = await call(app, "POST", "/api/account/delete", {
      token: "userA",
      body: { confirm: "DELETE_MY_ACCOUNT" },
    });
    assert.equal(scheduled.status, 200, JSON.stringify(scheduled.body));
    assert.equal(scheduled.body.ok, true);
    assert.equal(scheduled.body.scheduled, true);
    assert.equal(scheduled.body.deletedImmediately, undefined);
    assert.ok(scheduled.body.forfeitDate);
    assert.equal(db.prepare("SELECT id FROM users WHERE id = 'userA'").get().id, "userA");
    assert.equal(
      db.prepare("SELECT status FROM account_deletion_requests WHERE user_id = 'userA'").get().status,
      "scheduled",
    );
    assert.equal(db.prepare("SELECT id FROM dtus WHERE id = 'a-owned'").get().id, "a-owned");
    assert.equal(db.prepare("SELECT id FROM dtus WHERE id = 'b-owned'").get().id, "b-owned");

    const cancelled = await call(app, "POST", "/api/account/cancel-deletion", { token: "userA", body: {} });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.ok, true);
    assert.equal(cancelled.body.cancelled, true);
    assert.equal(
      db.prepare("SELECT status FROM account_deletion_requests WHERE user_id = 'userA'").get().status,
      "cancelled",
    );

    const again = await call(app, "POST", "/api/account/cancel-deletion", { token: "userA", body: {} });
    assert.equal(again.status, 400);
    assert.equal(again.body.error, "no_pending_deletion");
  });

  it("POST /api/account/delete with no balance removes that user and leaves the other account's DTUs", async () => {
    const db = createDb();
    seedWorld(db);
    const app = makeApp(db);
    const deleted = await call(app, "POST", "/api/account/delete", {
      token: "userC",
      body: { confirm: "DELETE_MY_ACCOUNT" },
    });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal(deleted.body.ok, true);
    assert.equal(deleted.body.deletedImmediately, true);
    assert.equal(db.prepare("SELECT id FROM users WHERE id = 'userC'").get(), undefined);
    assert.equal(db.prepare("SELECT id FROM dtus WHERE id = 'c-owned'").get(), undefined);
    assert.equal(db.prepare("SELECT id FROM dtus WHERE id = 'b-owned'").get().id, "b-owned");
    assert.equal(db.prepare("SELECT id FROM dtus WHERE id = 'a-owned'").get().id, "a-owned");
    assert.equal(db.prepare("SELECT owner_user_id FROM dtu_store WHERE id = 'b-store'").get().owner_user_id, "userB");
  });
});
