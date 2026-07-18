// tests/depth/sync-export-pack-behavior.test.js — REAL behavioral tests for
// `sync.export_pack`, the Wave-4 gap-closure that wires the already-real
// portable-pack export engine (Phase 6b, `lib/dtu-portability.js#
// exportUserCorpus` — the same SHA-256-hashed `concord-dtu-pack/v1`
// envelope `dtu_sync.force_sync` / `dtu_portability.export` already
// produce) into the `sync` lens's device-scoped experience layer.
//
// Uses the real booted server + real sqlite `ctx.db` (via the depth
// harness) so the envelope assertions are against the genuine persisted
// `dtus` table, not a hand-rolled fake.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

const SHA256_HEX = /^[a-f0-9]{64}$/;

/** Insert a real row into the persisted `dtus` table for `userId`. */
function seedRealDtu(db, userId, opts = {}) {
  const id = opts.id || `depth-export-dtu-${randomUUID()}`;
  db.prepare(`
    INSERT INTO dtus (id, type, title, creator_id, data, skill_level, total_experience, created_at)
    VALUES (?, ?, ?, ?, ?, 1, 0, unixepoch())
  `).run(
    id,
    opts.kind || "knowledge",
    opts.title || `Export-pack test DTU ${id}`,
    userId,
    JSON.stringify(opts.meta || { note: "seeded for export_pack behavior test" }),
  );
  return id;
}

describe("sync.export_pack — real portable-pack export wired into the sync lens", () => {
  let ctx, db, userId, deviceId, dtuId;

  before(async () => {
    ctx = await depthCtx("sync-export-pack-user-a");
    db = ctx.db;
    userId = ctx.actor.userId;
    assert.ok(db, "harness ctx has a real sqlite handle");

    dtuId = seedRealDtu(db, userId, { title: "My real exported thought" });

    const reg = await lensRun("sync", "register_device", { params: { deviceLabel: "Export Test Laptop" } }, ctx);
    assert.equal(reg.ok, true);
    deviceId = reg.result.device.id;
  });

  it("produces a real envelope with the documented SHA-256-hash structure", async () => {
    const r = await lensRun("sync", "export_pack", { params: { deviceId } }, ctx);
    assert.equal(r.ok, true);

    const { envelope } = r.result;
    // Real concord-dtu-pack/v1 shape — asserted structurally, not just "truthy".
    assert.equal(envelope.spec, "concord-dtu-pack/v1");
    assert.equal(envelope.creator_id, userId);
    assert.equal(typeof envelope.exported_at, "number");
    assert.ok(Array.isArray(envelope.dtus));
    assert.ok(Array.isArray(envelope.citations));

    // Real hashes, not placeholders — 64 lowercase hex chars (sha256 digest).
    assert.match(envelope.hashes.dtus_sha256, SHA256_HEX);
    assert.match(envelope.hashes.citations_sha256, SHA256_HEX);
    assert.match(envelope.instance_signature, /^[a-f0-9]{16}$/);

    // The seeded DTU is genuinely present — this is OUR corpus, not a stub.
    const found = envelope.dtus.find((d) => d.id === dtuId);
    assert.ok(found, "seeded DTU appears in the real exported envelope");
    assert.equal(found.creator_id, userId);

    // counts object matches the real array lengths.
    assert.equal(envelope.counts.dtus, envelope.dtus.length);
    assert.equal(envelope.counts.citations, envelope.citations.length);
  });

  it("requires a deviceId", async () => {
    const r = await lensRun("sync", "export_pack", { params: {} }, ctx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "missing_deviceId");
  });

  it("honestly rejects a bogus deviceId — no envelope fabricated", async () => {
    const r = await lensRun("sync", "export_pack", { params: { deviceId: "nope-does-not-exist" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "device_not_found");
  });

  it("rejects a revoked device the same way as a not-found one", async () => {
    const reg = await lensRun("sync", "register_device", { params: { deviceLabel: "Soon Revoked" } }, ctx);
    const revokedId = reg.result.device.id;
    await lensRun("sync", "revoke_device", { params: { deviceId: revokedId } }, ctx);
    const r = await lensRun("sync", "export_pack", { params: { deviceId: revokedId } }, ctx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "device_not_found");
  });

  it("records a real activity-log entry after export", async () => {
    await lensRun("sync", "export_pack", { params: { deviceId } }, ctx);
    const hist = await lensRun("sync", "sync_history", { params: { deviceId } }, ctx);
    assert.equal(hist.ok, true);
    const entry = hist.result.entries.find((e) => e.kind === "pack_exported" && e.deviceId === deviceId);
    assert.ok(entry, "a pack_exported log entry was recorded");
    assert.ok(entry.message.includes("Exported portable pack"));
  });

  it("stamps device presence (lastSyncAt/online) the same way sync_now does", async () => {
    const before2 = Date.now();
    const r = await lensRun("sync", "export_pack", { params: { deviceId } }, ctx);
    assert.equal(r.ok, true);
    const list = await lensRun("sync", "list_devices", {}, ctx);
    const dev = list.result.devices.find((d) => d.id === deviceId);
    assert.ok(dev.lastSyncAt >= before2);
    assert.equal(dev.online, true);
  });

  it("labels the response honestly as a FULL, unscoped export (not a fabricated device-scoped pack)", async () => {
    // Narrow this device's selective-sync scopes first, to prove the export
    // does NOT silently claim to respect them.
    await lensRun("sync", "set_scopes", { params: { deviceId, scopes: ["personal"] } }, ctx);
    const r = await lensRun("sync", "export_pack", { params: { deviceId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.scoped, false);
    assert.deepEqual(r.result.deviceScopes, ["personal"]);
    assert.ok(/not filtered|NOT filtered/i.test(r.result.note));
    // The seeded DTU is still present — a real full export, not silently
    // emptied by the narrowed scope it's honestly declining to honor.
    assert.ok(r.result.envelope.dtus.some((d) => d.id === dtuId));
  });
});

describe("sync.export_pack — per-user isolation", () => {
  it("cannot export another user's corpus via a device id that user doesn't own", async () => {
    const ctxA = await depthCtx("sync-export-pack-isolation-a");
    const ctxB = await depthCtx("sync-export-pack-isolation-b");

    // User A registers a device and has a real private DTU.
    const regA = await lensRun("sync", "register_device", { params: { deviceLabel: "A's Phone" } }, ctxA);
    const deviceIdA = regA.result.device.id;
    const dtuA = seedRealDtu(ctxA.db, ctxA.actor.userId, { title: "User A secret thought" });

    // User B tries to export using A's deviceId — B's own device map has no
    // such id, so the honest not-found path fires; no cross-user envelope
    // is ever produced.
    const crossAttempt = await lensRun("sync", "export_pack", { params: { deviceId: deviceIdA } }, ctxB);
    assert.equal(crossAttempt.result.ok, false);
    assert.equal(crossAttempt.result.error, "device_not_found");

    // Sanity: user B, exporting through their OWN device, never sees A's DTU
    // — exportUserCorpus scopes strictly by creator_id.
    const regB = await lensRun("sync", "register_device", { params: { deviceLabel: "B's Laptop" } }, ctxB);
    const dtuB = seedRealDtu(ctxB.db, ctxB.actor.userId, { title: "User B's own thought" });
    const exportB = await lensRun("sync", "export_pack", { params: { deviceId: regB.result.device.id } }, ctxB);
    assert.equal(exportB.ok, true);
    assert.ok(exportB.result.envelope.dtus.some((d) => d.id === dtuB));
    assert.ok(!exportB.result.envelope.dtus.some((d) => d.id === dtuA), "user B's export must never include user A's DTU");
    assert.equal(exportB.result.envelope.creator_id, ctxB.actor.userId);
  });
});
