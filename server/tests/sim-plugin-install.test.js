// POST /api/world/sim/plugins/install delegates to the injected gallery installer.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createWorldRoutes from "../routes/world.js";

async function boot(installGalleryPlugin) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.headers["x-user-id"];
    if (id) req.user = { id: String(id), role: "member" };
    next();
  });
  // world.js calls requireAuth(req, res, next) directly (middleware, not a factory).
  const requireAuth = (req, res, next) => (req.user ? next() : res.status(401).json({ ok: false, error: "auth_required" }));
  app.use("/api/world", createWorldRoutes({ requireAuth, installGalleryPlugin }));
  let server;
  const url = await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
  return { server, url };
}

describe("sim plugin install", () => {
  const calls = [];
  const results = {
    ok: { ok: true, loaded: true, freshLoad: true, pluginId: "loaded-ok" },
    again: { ok: true, alreadyInstalled: true, loaded: true, pluginId: "again" },
    nf: { ok: false, error: "plugin_not_found" },
    gone: { ok: false, error: "plugin_delisted", reason: "takedown" },
    bad: { ok: false, error: "install_failed", reason: "validation" },
  };
  let a, b;
  before(async () => {
    a = await boot(async (id, uid) => { calls.push([id, uid]); return results[id] || results.bad; });
    b = await boot(undefined);
  });
  after(async () => {
    await new Promise((r) => a.server.close(r));
    await new Promise((r) => b.server.close(r));
  });
  const post = async (base, body, user = "u1") => {
    const headers = { "content-type": "application/json" };
    if (user) headers["x-user-id"] = user;
    const res = await fetch(`${base.url}/api/world/sim/plugins/install`, { method: "POST", headers, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  it("success returns installer result", async () => {
    const r = await post(a, { pluginId: "ok" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, results.ok);
    assert.deepEqual(calls.at(-1), ["ok", "u1"]);
  });
  it("already installed", async () => {
    const r = await post(a, { pluginId: "again" });
    assert.equal(r.status, 200);
    assert.equal(r.body.alreadyInstalled, true);
  });
  it("not found 404, delisted 410, install_failed 400", async () => {
    assert.equal((await post(a, { pluginId: "nf" })).status, 404);
    assert.equal((await post(a, { pluginId: "gone" })).status, 410);
    assert.equal((await post(a, { pluginId: "bad" })).status, 400);
  });
  it("anon rejected 401", async () => {
    assert.equal((await post(a, { pluginId: "ok" }, null)).status, 401);
  });
  it("missing id 400", async () => {
    const r = await post(a, {});
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "plugin_id_required");
  });
  it("no installer wired -> honest 501", async () => {
    const r = await post(b, { pluginId: "ok" });
    assert.equal(r.status, 501);
    assert.equal(r.body.error, "not_wired");
    assert.ok(r.body.missing);
  });
  it("body source/manifest never reach the installer", async () => {
    const n = calls.length;
    await post(a, { pluginId: "ok", source: "evil()", manifest: { x: 1 } });
    assert.equal(calls.length, n + 1);
    assert.deepEqual(calls.at(-1), ["ok", "u1"]);
  });
});
