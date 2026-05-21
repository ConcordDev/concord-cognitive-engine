// Contract tests for server/domains/sync.js — the cross-device
// synchronization experience layer (sync.* macros). Every macro is
// exercised; each must return an { ok } envelope and never throw.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSyncActions from "../domains/sync.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`sync.${name}`);
  if (!fn) throw new Error(`sync.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerSyncActions(register); });

beforeEach(() => {
  // Fresh per-user in-memory state for each test.
  globalThis._concordSTATE = {};
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

const ctxA = { actor: { userId: "sync_user_a" }, userId: "sync_user_a" };

describe("sync — macro registration", () => {
  it("registers every backlog macro", () => {
    for (const m of [
      "register_device", "list_devices", "sync_now", "revoke_device",
      "set_auto_sync", "set_scopes", "available_scopes", "heartbeat",
      "sync_history", "report_conflict", "list_conflicts", "resolve_conflict",
      "sync_status", "set_quota", "syncthing_releases",
    ]) {
      assert.ok(ACTIONS.has(`sync.${m}`), `sync.${m} not registered`);
    }
  });
});

describe("sync.register_device + list_devices", () => {
  it("rejects an empty label", () => {
    const r = call("register_device", ctxA, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "missing_label");
  });

  it("registers a device and lists it", () => {
    const reg = call("register_device", ctxA, { deviceLabel: "MacBook Pro", autoSync: true });
    assert.equal(reg.ok, true);
    assert.ok(reg.result.device.id);
    assert.equal(reg.result.device.label, "MacBook Pro");

    const list = call("list_devices", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.devices[0].label, "MacBook Pro");
  });
});

describe("sync.sync_now", () => {
  it("rejects an unknown device", () => {
    const r = call("sync_now", ctxA, { deviceId: "nope" });
    assert.equal(r.ok, false);
  });

  it("runs a sync pass and writes a log entry", () => {
    const dev = call("register_device", ctxA, { deviceLabel: "iPhone" }).result.device;
    const r = call("sync_now", ctxA, { deviceId: dev.id });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.dtuCount, "number");
    assert.ok(["ok", "quota_exceeded"].includes(r.result.status));
    assert.ok(r.result.logEntry);
  });
});

describe("sync.set_auto_sync", () => {
  it("toggles the per-device flag", () => {
    const dev = call("register_device", ctxA, { deviceLabel: "iPad", autoSync: true }).result.device;
    const r = call("set_auto_sync", ctxA, { deviceId: dev.id, autoSync: false });
    assert.equal(r.ok, true);
    assert.equal(r.result.autoSync, false);
  });
});

describe("sync.set_scopes + available_scopes", () => {
  it("lists the scope catalog", () => {
    const r = call("available_scopes", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.scopes));
    assert.ok(r.result.scopes.length >= 3);
  });

  it("rejects an all-invalid scope set", () => {
    const dev = call("register_device", ctxA, { deviceLabel: "NAS" }).result.device;
    const r = call("set_scopes", ctxA, { deviceId: dev.id, scopes: ["bogus"] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_valid_scopes");
  });

  it("applies a valid scope subset", () => {
    const dev = call("register_device", ctxA, { deviceLabel: "NAS" }).result.device;
    const r = call("set_scopes", ctxA, { deviceId: dev.id, scopes: ["personal", "drafts"] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.scopes, ["personal", "drafts"]);
  });
});

describe("sync.heartbeat (presence)", () => {
  it("marks a device online", () => {
    const dev = call("register_device", ctxA, { deviceLabel: "Linux box" }).result.device;
    const r = call("heartbeat", ctxA, { deviceId: dev.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.online, true);
  });
});

describe("sync.set_quota", () => {
  it("rejects a non-positive quota", () => {
    const dev = call("register_device", ctxA, { deviceLabel: "Phone" }).result.device;
    const r = call("set_quota", ctxA, { deviceId: dev.id, quotaGb: -1 });
    assert.equal(r.ok, false);
  });

  it("sets an advisory quota in GB", () => {
    const dev = call("register_device", ctxA, { deviceLabel: "Phone" }).result.device;
    const r = call("set_quota", ctxA, { deviceId: dev.id, quotaGb: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.quotaBytes, 10 * 1024 * 1024 * 1024);
  });
});

describe("sync — conflict lifecycle", () => {
  it("reports, lists, and resolves a conflict", () => {
    const rep = call("report_conflict", ctxA, {
      dtuId: "dtu_123", title: "Notes",
      localDeviceLabel: "MacBook", remoteDeviceLabel: "iPhone",
    });
    assert.equal(rep.ok, true);
    const cid = rep.result.conflict.id;

    const open = call("list_conflicts", ctxA, {});
    assert.equal(open.ok, true);
    assert.equal(open.result.open, 1);

    const bad = call("resolve_conflict", ctxA, { conflictId: cid, choice: "xyz" });
    assert.equal(bad.ok, false);

    const res = call("resolve_conflict", ctxA, { conflictId: cid, choice: "keep_local" });
    assert.equal(res.ok, true);
    assert.equal(res.result.conflict.status, "resolved");

    const after = call("list_conflicts", ctxA, {});
    assert.equal(after.result.resolved, 1);
  });

  it("dedupes a second open conflict on the same DTU", () => {
    call("report_conflict", ctxA, { dtuId: "dtu_x" });
    const second = call("report_conflict", ctxA, { dtuId: "dtu_x" });
    assert.equal(second.ok, true);
    assert.equal(second.result.deduped, true);
  });
});

describe("sync.sync_history", () => {
  it("returns a timeline-shaped feed", () => {
    const dev = call("register_device", ctxA, { deviceLabel: "Watch" }).result.device;
    call("sync_now", ctxA, { deviceId: dev.id });
    const r = call("sync_history", ctxA, { limit: 20 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.timeline));
    assert.ok(r.result.timeline.length >= 1);
  });
});

describe("sync.sync_status", () => {
  it("aggregates device + conflict state", () => {
    call("register_device", ctxA, { deviceLabel: "A" });
    call("report_conflict", ctxA, { dtuId: "dtu_conf" });
    const r = call("sync_status", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.deviceCount, 1);
    assert.equal(r.result.openConflicts, 1);
    assert.equal(r.result.state, "needs_attention");
  });

  it("reports no_devices for a fresh user", () => {
    const r = call("sync_status", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.state, "no_devices");
  });
});

describe("sync.revoke_device", () => {
  it("removes the device from list_devices", () => {
    const dev = call("register_device", ctxA, { deviceLabel: "Old laptop" }).result.device;
    const r = call("revoke_device", ctxA, { deviceId: dev.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.revoked, true);
    const list = call("list_devices", ctxA, {});
    assert.equal(list.result.count, 0);
  });
});

describe("sync.syncthing_releases", () => {
  it("surfaces a network failure without throwing", async () => {
    const r = await call("syncthing_releases", ctxA, {});
    assert.equal(typeof r.ok, "boolean");
    if (!r.ok) assert.ok(r.error);
  });
});
