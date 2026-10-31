// Admin heartbeat switch + the memory watchdog no longer persisting its pause (founder ruling GB-0344).

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRoleGate } from "../lib/role-gate.js";
import { mountAdminHeartbeatRoutes } from "../lib/admin-heartbeat.js";
import { _pauseBackgroundWork, _resumeBackgroundWork, persistableSettings, clearMemoryPause } from "../lib/memory-pressure.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FEATURES = ["autogenEnabled", "dreamEnabled", "evolutionEnabled", "synthEnabled", "heartbeatEnabled"];
const allOn = () => Object.fromEntries(FEATURES.map((f) => [f, true]));

// What a restart does: serialize the persisted view, parse it, merge over the defaults (server.js load path).
const reload = (STATE) => ({ ...allOn(), ...JSON.parse(JSON.stringify(persistableSettings(STATE))) });

describe("memory watchdog pause is runtime-only", () => {
  it("pause -> snapshot -> restart: the persisted/reloaded settings are still enabled, runtime is paused", () => {
    const STATE = { settings: { ...allOn(), heartbeatMs: 10000 } };
    _pauseBackgroundWork(STATE);
    for (const f of FEATURES) assert.equal(STATE.settings[f], false, `${f} paused at runtime`);
    const back = reload(STATE);
    for (const f of FEATURES) assert.equal(back[f], true, `${f} persisted as the owner's value`);
    assert.equal(back.heartbeatMs, 10000, "other settings untouched");
    // the live object is not mutated by persisting
    assert.equal(STATE.settings.heartbeatEnabled, false);
  });

  it("resume (pressure back to normal) restores the runtime values and clears the overlay", () => {
    const STATE = { settings: allOn() };
    _pauseBackgroundWork(STATE);
    _resumeBackgroundWork(STATE);
    for (const f of FEATURES) assert.equal(STATE.settings[f], true);
    assert.equal(STATE._memoryPausedFeatures, undefined);
    assert.equal(persistableSettings(STATE), STATE.settings);
  });

  it("a feature the owner had OFF is not turned on by the persisted view", () => {
    const STATE = { settings: { ...allOn(), dreamEnabled: false } };
    _pauseBackgroundWork(STATE);
    assert.equal(reload(STATE).dreamEnabled, false);
    assert.equal(reload(STATE).heartbeatEnabled, true);
  });

  it("an explicit write during a pause supersedes the pause record (owner turning a flag off is not undone)", () => {
    const STATE = { settings: allOn() };
    _pauseBackgroundWork(STATE);
    STATE.settings.synthEnabled = false;            // owner deliberately disables it mid-pause
    clearMemoryPause(STATE, ["synthEnabled"]);
    const back = reload(STATE);
    assert.equal(back.synthEnabled, false);
    assert.equal(back.heartbeatEnabled, true);
    _resumeBackgroundWork(STATE);
    assert.equal(STATE.settings.synthEnabled, false, "resume does not re-enable what the owner turned off");
  });

  it("server.js serializes persistableSettings(STATE), never STATE.settings directly; owner writers clear the pause", () => {
    const src = fs.readFileSync(path.join(here, "..", "server.js"), "utf8");
    assert.match(src, /settings: persistableSettings\(STATE\),/);
    assert.ok(!/^\s{4}settings: STATE\.settings,$/m.test(src), "the snapshot no longer writes STATE.settings raw");
    assert.match(src, /clearMemoryPause\(ctx\.state, Object\.keys\(s\)\)/);
    const sov = fs.readFileSync(path.join(here, "..", "routes", "sovereign.js"), "utf8");
    assert.equal((sov.match(/clearMemoryPause\(/g) || []).length, 4);
  });
});

describe("/api/admin/heartbeat", () => {
  let STATE, saves, logs, srv, port;
  const call = (method, role, body) => new Promise((resolve, reject) => {
    const headers = { "content-type": "application/json" };
    if (role) headers["x-test-role"] = role;
    const req = http.request({ hostname: "127.0.0.1", port, path: "/api/admin/heartbeat", method, headers }, (res) => {
      const c = []; res.on("data", (x) => c.push(x));
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(c).toString() || "{}") }));
    });
    req.on("error", reject); if (body !== undefined) req.write(JSON.stringify(body)); req.end();
  });
  const start = async () => {
    STATE = { settings: { ...allOn(), heartbeatEnabled: false } }; saves = 0; logs = [];
    const { requireRole } = createRoleGate(() => "hybrid");
    const app = express(); app.use(express.json());
    app.use((req, _r, next) => { const r = req.headers["x-test-role"]; if (r) req.user = { id: "u1", username: "tester", role: r }; next(); });
    mountAdminHeartbeatRoutes(app, { requireRole, getState: () => STATE, save: () => { saves++; }, clearMemoryPause, persistableSettings, log: (...a) => logs.push(a) });
    srv = await new Promise((r) => { const s = http.createServer(app); s.listen(0, "127.0.0.1", () => r(s)); });
    port = srv.address().port;
  };
  beforeEach(async () => { if (srv) srv.close(); await start(); });
  after(() => srv?.close());

  it("anonymous 401, member 403; nothing changes or saves", async () => {
    assert.equal((await call("POST", null, { enabled: true })).status, 401);
    assert.equal((await call("POST", "member", { enabled: true })).status, 403);
    assert.equal((await call("GET", "member")).status, 403);
    assert.equal(STATE.settings.heartbeatEnabled, false);
    assert.equal(saves, 0);
  });

  it("admin and owner can enable it (200); only heartbeatEnabled changes; saved immediately; audit line", async () => {
    const before = { ...STATE.settings };
    const r = await call("POST", "admin", { enabled: true });
    assert.equal(r.status, 200);
    assert.deepEqual({ previous: r.body.previous, current: r.body.current }, { previous: false, current: true });
    assert.equal(STATE.settings.heartbeatEnabled, true);
    for (const f of FEATURES.filter((x) => x !== "heartbeatEnabled")) assert.equal(STATE.settings[f], before[f], `${f} untouched`);
    assert.equal(saves, 1);
    const audit = logs.find((l) => l[1] === "admin_heartbeat_toggle");
    assert.equal(audit[0], "warn");
    assert.deepEqual({ by: audit[2].by, previous: audit[2].previous, current: audit[2].current }, { by: "tester", previous: false, current: true });
    assert.equal((await call("POST", "owner", { enabled: false })).status, 200);
    assert.equal(STATE.settings.heartbeatEnabled, false);
    assert.equal((await call("POST", "founder", { enabled: true })).status, 200);
  });

  it("non-boolean enabled -> 400, nothing changes", async () => {
    for (const body of [{}, { enabled: "true" }, { enabled: 1 }, { enabled: null }, { other: true }]) {
      assert.equal((await call("POST", "admin", body)).status, 400, JSON.stringify(body));
    }
    assert.equal(STATE.settings.heartbeatEnabled, false);
    assert.equal(saves, 0);
  });

  it("clears the watchdog pause record for heartbeat and reports what is still paused", async () => {
    STATE.settings = allOn();
    _pauseBackgroundWork(STATE);
    const g = await call("GET", "admin");
    assert.equal(g.status, 200);
    assert.deepEqual({ current: g.body.current, persisted: g.body.persisted }, { current: false, persisted: true });
    assert.ok(g.body.memoryPaused.includes("heartbeatEnabled"));
    const r = await call("POST", "admin", { enabled: true });
    assert.equal(STATE.settings.heartbeatEnabled, true);
    assert.ok(!r.body.memoryPaused.includes("heartbeatEnabled"));
    assert.ok(r.body.memoryPaused.includes("dreamEnabled"), "the other four stay paused");
    _resumeBackgroundWork(STATE); // later resume must not flip heartbeat back
    assert.equal(STATE.settings.heartbeatEnabled, true);
  });

  it("wiring: server.js mounts it behind owner/admin/founder in lib/admin-heartbeat.js", () => {
    const src = fs.readFileSync(path.join(here, "..", "server.js"), "utf8");
    assert.match(src, /mountAdminHeartbeatRoutes\(app, \{ requireRole, getState: \(\) => STATE, save: \(\) => saveStateSync\(\)/);
    const lib = fs.readFileSync(path.join(here, "..", "lib", "admin-heartbeat.js"), "utf8");
    assert.match(lib, /requireRole\("owner", "admin", "founder"\)/);
  });
});

describe("/api/admin/heartbeat drives the dispatcher live", () => {
  let STATE, started, stopped, timer, srv, port, logs;
  // A faithful stand-in for server.js: start is idempotent on an existing timer and honours the setting;
  // stop clears the interval. (The real functions are pinned by the source checks below.)
  const dispatcher = () => ({
    startDispatcher: () => {
      if (timer) return { ok: true, already: true };
      if (STATE.settings.heartbeatEnabled === false) return { ok: false, reason: "heartbeat_disabled" };
      timer = setInterval(() => {}, 1_000_000); timer.unref(); started++;
      return { ok: true, intervalMs: 15000 };
    },
    stopDispatcher: () => { if (!timer) return { ok: true, stopped: false }; clearInterval(timer); timer = null; stopped++; return { ok: true, stopped: true }; },
    dispatcherStatus: () => ({ running: !!timer, intervalMs: timer ? 15000 : null }),
  });
  const call = (method, role, body) => new Promise((resolve, reject) => {
    const headers = { "content-type": "application/json" }; if (role) headers["x-test-role"] = role;
    const req = http.request({ hostname: "127.0.0.1", port, path: "/api/admin/heartbeat", method, headers }, (res) => {
      const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(c).toString() || "{}") }));
    });
    req.on("error", reject); if (body !== undefined) req.write(JSON.stringify(body)); req.end();
  });
  beforeEach(async () => {
    if (srv) srv.close();
    if (timer) { clearInterval(timer); timer = null; }
    STATE = { settings: { ...allOn(), heartbeatEnabled: false } }; started = 0; stopped = 0; logs = [];
    const { requireRole } = createRoleGate(() => "hybrid");
    const app = express(); app.use(express.json());
    app.use((req, _r, next) => { const r = req.headers["x-test-role"]; if (r) req.user = { id: "u1", username: "tester", role: r }; next(); });
    mountAdminHeartbeatRoutes(app, { requireRole, getState: () => STATE, save: () => {}, clearMemoryPause, persistableSettings, log: (...a) => logs.push(a), ...dispatcher() });
    srv = await new Promise((r) => { const s = http.createServer(app); s.listen(0, "127.0.0.1", () => r(s)); });
    port = srv.address().port;
  });
  after(() => { srv?.close(); if (timer) clearInterval(timer); });

  it("false -> true starts exactly one dispatcher timer and reports it", async () => {
    assert.equal((await call("GET", "admin")).body.dispatcher.running, false);
    const r = await call("POST", "admin", { enabled: true });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.dispatcher, { running: true, intervalMs: 15000 });
    assert.equal(started, 1);
    assert.deepEqual((await call("GET", "admin")).body.dispatcher, { running: true, intervalMs: 15000 });
  });

  it("true -> true does not add a second timer", async () => {
    await call("POST", "admin", { enabled: true });
    await call("POST", "admin", { enabled: true });
    await call("POST", "owner", { enabled: true });
    assert.equal(started, 1, "idempotent: one timer, ever");
    assert.equal((await call("GET", "admin")).body.dispatcher.running, true);
  });

  it("true -> false clears the timer (the dispatcher really stops, not just skips)", async () => {
    await call("POST", "admin", { enabled: true });
    const r = await call("POST", "admin", { enabled: false });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.dispatcher, { running: false, intervalMs: null });
    assert.equal(stopped, 1);
    assert.equal(timer, null);
    // stopping again is a no-op
    await call("POST", "admin", { enabled: false });
    assert.equal(stopped, 1);
    // and it can be started again
    await call("POST", "admin", { enabled: true });
    assert.equal(started, 2);
  });

  it("explains why it is not running when the dispatcher refuses (e.g. replica / env kill-switch)", async () => {
    const { requireRole } = createRoleGate(() => "hybrid");
    const app = express(); app.use(express.json());
    app.use((req, _r, next) => { req.user = { id: "u1", username: "t", role: "admin" }; next(); });
    mountAdminHeartbeatRoutes(app, { requireRole, getState: () => STATE, save: () => {}, clearMemoryPause, persistableSettings,
      startDispatcher: () => ({ ok: false, reason: "read_replica" }), dispatcherStatus: () => ({ running: false, intervalMs: null }) });
    const s2 = await new Promise((r) => { const sv = http.createServer(app); sv.listen(0, "127.0.0.1", () => r(sv)); });
    const body = await new Promise((resolve) => {
      const req = http.request({ hostname: "127.0.0.1", port: s2.address().port, path: "/api/admin/heartbeat", method: "POST", headers: { "content-type": "application/json" } }, (res) => { const c = []; res.on("data", (x) => c.push(x)); res.on("end", () => resolve(JSON.parse(Buffer.concat(c).toString()))); });
      req.write(JSON.stringify({ enabled: true })); req.end();
    });
    s2.close();
    assert.equal(body.ok, true);
    assert.deepEqual(body.dispatcher, { running: false, intervalMs: null, reason: "read_replica" });
  });

  it("auth still holds: anon 401, member 403, no dispatcher change", async () => {
    assert.equal((await call("POST", null, { enabled: true })).status, 401);
    assert.equal((await call("POST", "member", { enabled: true })).status, 403);
    assert.equal(started, 0);
  });

  it("server.js: live start is idempotent and live stop clears the real interval; defaults untouched", () => {
    const src = fs.readFileSync(path.join(here, "..", "server.js"), "utf8");
    assert.match(src, /function _startGovernorHeartbeat\(\) \{\s*try \{\s*if \(__governorTimer\) return \{ ok:true, already:true \};/);
    const stop = src.slice(src.indexOf("function stopGovernorDispatcherLive()"), src.indexOf("function governorDispatcherStatus()"));
    assert.match(stop, /clearInterval\(__governorTimer\);\s*__governorTimer = null;/);
    assert.match(src, /function startGovernorDispatcherLive\(\) \{\s*if \(READ_REPLICA\) return \{ ok: false, reason: "read_replica" \};/);
    assert.match(src, /startDispatcher: \(\) => startGovernorDispatcherLive\(\), stopDispatcher: \(\) => stopGovernorDispatcherLive\(\), dispatcherStatus: \(\) => governorDispatcherStatus\(\)/);
    assert.match(src, /heartbeatEnabled: true,/, "the default is unchanged");
  });
});
