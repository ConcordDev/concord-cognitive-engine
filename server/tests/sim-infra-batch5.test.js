// /api/world/sim/eventbus/status and /sim/jobs/queue-status read the existing
// in-process bus and worker pools, and are admin-only.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createWorldRoutes from "../routes/world.js";
import { readEventBusStatus, readJobQueueStatus } from "../lib/sim-infra.js";
import { publish, _reset } from "../lib/runtime/event-bus.js";

describe("sim infra batch 5: gate and live routes", () => {
  let db;
  let server;
  let url;
  let clients = 3;

  before(async () => {
    _reset();
    db = new Database(":memory:");
    db.exec(`CREATE TABLE event_timeline_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT NOT NULL, world_id TEXT,
      actor_kind TEXT, actor_id TEXT, payload_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`);
    const ins = db.prepare("INSERT INTO event_timeline_log (channel) VALUES (?)");
    ins.run("npc:activity");
    ins.run("npc:activity");
    ins.run("combat:hit");
    db.prepare("INSERT INTO event_timeline_log (channel, created_at) VALUES ('old:event', 1000)").run();

    publish("batch5.alpha", { a: 1 });
    publish("batch5.alpha", { a: 2 });
    publish("batch5.beta", {});

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = req.headers["x-user-id"];
      if (id) req.user = { id: String(id), role: String(req.headers["x-role"] || "member") };
      next();
    });
    app.use("/api/world", createWorldRoutes({ db, getRealtimeClients: () => clients }));
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
    _reset();
  });

  async function call(path, { user, role } = {}) {
    const headers = {};
    if (user) headers["x-user-id"] = user;
    if (role) headers["x-role"] = role;
    const res = await fetch(`${url}${path}`, { headers });
    return { status: res.status, body: await res.json() };
  }

  for (const path of ["/api/world/sim/eventbus/status", "/api/world/sim/jobs/queue-status"]) {
    it(`${path}: signed out 401, member 403, admin roles 200`, async () => {
      assert.equal((await call(path)).status, 401);
      assert.equal((await call(path, { user: "u1", role: "member" })).status, 403);
      for (const role of ["owner", "admin", "sovereign", "founder"]) {
        assert.equal((await call(path, { user: "a1", role })).status, 200, role);
      }
    });
  }

  it("eventbus status: shape, windows, counts, nulls with reasons", async () => {
    const r = await call("/api/world/sim/eventbus/status", { user: "a1", role: "admin" });
    const b = r.body;
    assert.equal(b.ok, true);
    assert.equal(b.provider, "in-process");
    assert.equal(b.runtimeBus.window, "recent_ring");
    assert.equal(b.runtimeBus.ringCapacity, 500);
    assert.equal(b.runtimeBus.eventsInRing, 3);
    const alpha = b.runtimeBus.channels.find((c) => c.name === "batch5.alpha");
    assert.equal(alpha.count, 2);
    assert.equal(b.runtimeBus.channels[0].name, "batch5.alpha");
    assert.equal(b.runtimeBus.unregisteredWindow, "since_start");
    assert.deepEqual(b.runtimeBus.unregisteredEvents.find((e) => e.name === "batch5.alpha"), { name: "batch5.alpha", count: 2 });
    assert.equal(b.timeline.available, true);
    assert.equal(b.timeline.window, "last_24h");
    assert.equal(b.timeline.total, 3); // the 1970 row is outside the window
    assert.deepEqual(b.timeline.channels.map((c) => [c.channel, c.count]), [["npc:activity", 2], ["combat:hit", 1]]);
    assert.equal(b.connectedClients, 3);
    assert.equal(b.connectedClientsReason, null);
    for (const k of ["consumers", "lagMs", "deadLetter"]) {
      assert.equal(b[k], null);
      assert.equal(typeof b[`${k}Reason`], "string");
    }
  });

  it("eventbus status: connectedClients null with a reason when the socket server is absent", () => {
    clients = null;
    const none = readEventBusStatus({ getRealtimeClients: () => clients });
    assert.equal(none.connectedClients, null);
    assert.equal(none.connectedClientsReason, "socket_server_not_started");
    assert.equal(readEventBusStatus().connectedClientsReason, "realtime_not_attached");
    assert.deepEqual(readEventBusStatus().timeline, { available: false, reason: "no_database" });
    clients = 3;
  });

  it("queue status: pools not started report null-ish sections with a reason", async () => {
    const r = await call("/api/world/sim/jobs/queue-status", { user: "a1", role: "owner" });
    assert.equal(r.body.ok, true);
    assert.equal(r.body.provider, "in-process");
    assert.deepEqual(r.body.macroPool, { initialised: false, reason: "pool_not_started" });
    assert.deepEqual(r.body.heartbeatPool, { initialised: false, reason: "pool_not_started" });
    assert.equal(r.body.podJobs.enabled, false);
    assert.equal(typeof r.body.podJobs.reason, "string");
  });

  it("queue status: started pools and enabled pod-jobs are labelled since_start", () => {
    const fakePool = { poolSize: 2, ready: true, busy: 1, idle: 1, queueLength: 0, metrics: { completed: 5, errors: 1 } };
    const out = readJobQueueStatus({
      macroStats: () => fakePool,
      heartbeatStats: () => { throw new Error("boom"); },
      podEnabled: () => true,
      podStats: () => ({ queued: 1, leased: 0, completed: 4, failed: 2, timedOut: 0, workers: [] }),
    });
    assert.equal(out.macroPool.initialised, true);
    assert.equal(out.macroPool.window, "since_start");
    assert.equal(out.macroPool.metrics.completed, 5);
    assert.deepEqual(out.heartbeatPool, { initialised: false, reason: "stats_unreadable" });
    assert.equal(out.podJobs.enabled, true);
    assert.equal(out.podJobs.window, "since_start");
    assert.equal(out.podJobs.failed, 2);
  });
});
