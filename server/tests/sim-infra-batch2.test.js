// The plugin catalog reads the real plugin_gallery rows. Event bus and job
// queue status are covered by sim-infra-batch5.test.js.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createWorldRoutes from "../routes/world.js";

describe("sim plugin catalog", () => {
  let db;
  let server;
  let url;

  before(async () => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE plugin_gallery (
        plugin_id TEXT PRIMARY KEY, author_id TEXT NOT NULL, name TEXT NOT NULL,
        description TEXT, version TEXT NOT NULL, source TEXT NOT NULL, signature TEXT,
        hash TEXT NOT NULL, trusted INTEGER NOT NULL DEFAULT 0, installs INTEGER NOT NULL DEFAULT 0,
        upvotes INTEGER NOT NULL DEFAULT 0, downvotes INTEGER NOT NULL DEFAULT 0,
        published_at TEXT NOT NULL, delisted_at INTEGER
      );
    `);
    const ins = db.prepare(`INSERT INTO plugin_gallery
      (plugin_id, author_id, name, description, version, source, signature, hash, trusted, installs, published_at, delisted_at)
      VALUES (?, ?, ?, 'd', '1.0.0', 'SECRET_SOURCE', 'SECRET_SIG', 'SECRET_HASH', 1, ?, '2026-01-01', ?)`);
    ins.run("p-live", "author-1", "Live", 3, null);
    ins.run("p-gone", "author-2", "Gone", 9, 1700000000);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = req.headers["x-user-id"];
      if (id) req.user = { id: String(id), role: String(req.headers["x-role"] || "member") };
      next();
    });
    app.use("/api/world", createWorldRoutes({ db }));
    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        url = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    db?.close();
  });

  async function call(path, { user, role, method = "GET" } = {}) {
    const headers = {};
    if (user) headers["x-user-id"] = user;
    if (role) headers["x-role"] = role;
    const res = await fetch(`${url}${path}`, { method, headers });
    return { status: res.status, body: await res.json() };
  }

  it("plugin catalog hides delisted entries and never leaks source/signature/hash", async () => {
    const r = await call("/api/world/sim/plugins/catalog");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.plugins.map((p) => p.pluginId), ["p-live"]);
    const text = JSON.stringify(r.body);
    for (const leak of ["SECRET_SOURCE", "SECRET_SIG", "SECRET_HASH"]) assert.equal(text.includes(leak), false);
  });

  it("installed plugins: anon 401, other user 403, own user honest 501", async () => {
    assert.equal((await call("/api/world/sim/plugins/installed/u1")).status, 401);
    assert.equal((await call("/api/world/sim/plugins/installed/u1", { user: "u2" })).status, 403);
    const own = await call("/api/world/sim/plugins/installed/u1", { user: "u1" });
    assert.equal(own.status, 501);
    assert.equal(own.body.reason, "no_per_user_install_record");
  });
});
