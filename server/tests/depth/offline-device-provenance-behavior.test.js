// tests/depth/offline-device-provenance-behavior.test.js — REAL behavioral
// tests for the offline domain's new multi-device conflict provenance
// feature (WAVE4_INVENTORY row 255 / docs/lens-specs/offline-capability-map.md
// "Multi-device conflict provenance (which device wrote which revision) ...
// GENUINELY MISSING" gap-closure).
//
// Boots the real server (via ./_harness.js#lensRun) and drives the actual
// production dispatch path — the same real wiring the sibling filtered-
// replication behavioral file (offline-filtered-replication-behavior.test.js)
// exercises: registerLensAction("offline", ...) → LENS_ACTIONS → the
// "lens.run" macro → runMacro("lens","run", ...).
//
// `lens.run` unwraps a handler's `{ok:true, result:{...}}` return to
// `r.result = {...}` directly (dropping the inner `ok`), but does NOT unwrap
// an `{ok:false, error:...}` return — so error assertions check
// `r.result.ok === false` / `r.result.error`, matching the established idiom
// (see offline-filtered-replication-behavior.test.js / accounting-behavior.test.js).
//
// Scope: `params.deviceId` is a PER-PUSH identity (one push call = one
// physical device), distinct from `syncCheckpoint`'s `replicationId`
// (per-sync-stream). This suite proves: (1) replicationPush stamps deviceId
// onto stored docs, changes-feed entries, and BOTH sides of a conflict
// record; (2) replicationPull surfaces deviceId back in mapped changes;
// (3) mergeResolve records the resolving device; (4) omitting deviceId
// anywhere is fully backward compatible — no crash, field simply absent/null.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("offline device provenance — replicationPush stamps deviceId", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("depth:offline:deviceid:push"); });

  it("stamps deviceId onto the applied entry, the stored doc, and the changes feed", async () => {
    const pushed = await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "note:dev1", body: { title: "from phone" } }], deviceId: "device-phone-alpha" },
    }, ctx);
    assert.equal(pushed.ok, true);
    assert.equal(pushed.result.appliedCount, 1);
    assert.equal(pushed.result.applied[0].deviceId, "device-phone-alpha");

    // The stored doc carries the writer id (surfaced via replicationStatus).
    const status = await lensRun("offline", "replicationStatus", { params: {} }, ctx);
    const doc = status.result.docs.find((d) => d.id === "note:dev1");
    assert.ok(doc, "doc must be listed in status");
    assert.equal(doc.deviceId, "device-phone-alpha");

    // The changes-feed entry carries it too, surfaced via replicationPull.
    const pulled = await lensRun("offline", "replicationPull", { params: { since: 0 } }, ctx);
    const change = pulled.result.changes.find((c) => c.id === "note:dev1");
    assert.ok(change);
    assert.equal(change.deviceId, "device-phone-alpha");
  });

  it("a later push from a DIFFERENT device overwrites the stored writer id", async () => {
    const first = await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "note:dev2", body: { v: 1 } }], deviceId: "device-laptop" },
    }, ctx);
    assert.equal(first.result.applied[0].deviceId, "device-laptop");

    const second = await lensRun("offline", "replicationPush", {
      params: {
        docs: [{ id: "note:dev2", body: { v: 2 }, baseRev: first.result.applied[0].rev }],
        deviceId: "device-tablet",
      },
    }, ctx);
    assert.equal(second.result.conflictCount, 0);
    assert.equal(second.result.applied[0].deviceId, "device-tablet");

    const status = await lensRun("offline", "replicationStatus", { params: {} }, ctx);
    const doc = status.result.docs.find((d) => d.id === "note:dev2");
    assert.equal(doc.deviceId, "device-tablet");
  });

  it("omitting deviceId on push is fully backward compatible — no crash, field is simply null", async () => {
    const pushed = await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "note:nodev", body: { title: "anonymous" } }] },
    }, ctx);
    assert.equal(pushed.ok, true);
    assert.equal(pushed.result.appliedCount, 1);
    assert.equal(pushed.result.applied[0].deviceId, null);

    const status = await lensRun("offline", "replicationStatus", { params: {} }, ctx);
    const doc = status.result.docs.find((d) => d.id === "note:nodev");
    assert.equal(doc.deviceId, null);

    const pulled = await lensRun("offline", "replicationPull", { params: { since: 0 } }, ctx);
    const change = pulled.result.changes.find((c) => c.id === "note:nodev");
    assert.equal(change.deviceId, null);
  });

  it("an empty-string deviceId is treated the same as omitted (honest null, not a fabricated empty writer)", async () => {
    const pushed = await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "note:emptydev", body: { v: 1 } }], deviceId: "" },
    }, ctx);
    assert.equal(pushed.result.applied[0].deviceId, null);
  });
});

describe("offline device provenance — conflict records carry BOTH sides' deviceId", () => {
  it("a rev-mismatch conflict reports the writer of the current server revision AND the conflicting client push", async () => {
    const ctx = await depthCtx("depth:offline:deviceid:conflict");
    const first = await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "doc:conflict1", body: { v: 1 } }], deviceId: "device-server-writer" },
    }, ctx);
    assert.equal(first.result.applied[0].deviceId, "device-server-writer");

    // A second push with a STALE baseRev, from a different device, must conflict
    // and carry BOTH devices' ids — never silently drop one side.
    const conflict = await lensRun("offline", "replicationPush", {
      params: {
        docs: [{ id: "doc:conflict1", body: { v: 99 }, baseRev: "1-deadbeef" }],
        deviceId: "device-conflicting-client",
      },
    }, ctx);
    assert.equal(conflict.ok, true);
    assert.equal(conflict.result.conflictCount, 1);
    const c = conflict.result.conflicts[0];
    assert.equal(c.id, "doc:conflict1");
    assert.equal(c.serverDeviceId, "device-server-writer");
    assert.equal(c.clientDeviceId, "device-conflicting-client");
    assert.equal(c.reason, "rev_mismatch");
    // Real assertion the conflict retained the actual bodies too (not just ids).
    assert.deepEqual(c.serverBody, { v: 1 });
    assert.deepEqual(c.clientBody, { v: 99 });
  });

  it("a conflict where the original write had no deviceId reports serverDeviceId null, not fabricated", async () => {
    const ctx = await depthCtx("depth:offline:deviceid:conflict-nodev");
    const first = await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "doc:conflict2", body: { v: 1 } }] }, // no deviceId
    }, ctx);
    const conflict = await lensRun("offline", "replicationPush", {
      params: {
        docs: [{ id: "doc:conflict2", body: { v: 2 }, baseRev: "1-bogus" }],
        deviceId: "device-b",
      },
    }, ctx);
    assert.equal(conflict.result.conflictCount, 1);
    assert.equal(conflict.result.conflicts[0].serverDeviceId, null);
    assert.equal(conflict.result.conflicts[0].clientDeviceId, "device-b");
    assert.equal(first.ok, true); // sanity: setup push succeeded
  });

  it("a conflicting push that itself omits deviceId reports clientDeviceId null on both sides honestly", async () => {
    const ctx = await depthCtx("depth:offline:deviceid:conflict-anon-client");
    await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "doc:conflict3", body: { v: 1 } }], deviceId: "device-owner" },
    }, ctx);
    const conflict = await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "doc:conflict3", body: { v: 2 }, baseRev: "1-bogus" }] }, // no deviceId
    }, ctx);
    assert.equal(conflict.result.conflicts[0].serverDeviceId, "device-owner");
    assert.equal(conflict.result.conflicts[0].clientDeviceId, null);
  });
});

describe("offline device provenance — mergeResolve records the resolving device", () => {
  it("stamps the resolver's deviceId onto the new revision and its changes-feed entry", async () => {
    const ctx = await depthCtx("depth:offline:deviceid:resolve");
    await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "m:dev1", body: { side: "server" } }], deviceId: "device-original-writer" },
    }, ctx);
    const resolved = await lensRun("offline", "mergeResolve", {
      params: { id: "m:dev1", winner: "merged", mergedBody: { side: "merged" }, deviceId: "device-resolver" },
    }, ctx);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.result.deviceId, "device-resolver");
    assert.deepEqual(resolved.result.resolvedBody, { side: "merged" });

    // The resolution is itself a new revision — the resolver, not the
    // original writer, is now on record as having authored it.
    const status = await lensRun("offline", "replicationStatus", { params: {} }, ctx);
    const doc = status.result.docs.find((d) => d.id === "m:dev1");
    assert.equal(doc.deviceId, "device-resolver");

    const pulled = await lensRun("offline", "replicationPull", { params: { since: 0 } }, ctx);
    const lastChange = pulled.result.changes.filter((c) => c.id === "m:dev1").pop();
    assert.equal(lastChange.deviceId, "device-resolver");
  });

  it("omitting deviceId on mergeResolve is backward compatible — resolution still succeeds, field is null", async () => {
    const ctx = await depthCtx("depth:offline:deviceid:resolve-nodev");
    await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "m:dev2", body: { keep: "server" } }] },
    }, ctx);
    const resolved = await lensRun("offline", "mergeResolve", {
      params: { id: "m:dev2", winner: "server" },
    }, ctx);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.result.deviceId, null);
    assert.deepEqual(resolved.result.resolvedBody, { keep: "server" });
  });
});

describe("offline device provenance — regression: unrelated fields/behavior are unchanged", () => {
  it("replicationPush/Pull/Status core contract is byte-identical when deviceId is never used", async () => {
    const ctx = await depthCtx("depth:offline:deviceid:regression");
    const push = await lensRun("offline", "replicationPush", {
      params: { docs: [{ id: "note:reg1", body: { title: "first" } }, { id: "note:reg2", body: { title: "second" } }] },
    }, ctx);
    assert.equal(push.result.appliedCount, 2);
    assert.equal(push.result.conflictCount, 0);
    assert.equal(push.result.updateSeq, 2);

    const status = await lensRun("offline", "replicationStatus", { params: {} }, ctx);
    assert.equal(status.result.docCount, 2);
    assert.equal(status.result.updateSeq, 2);

    const pull = await lensRun("offline", "replicationPull", { params: { since: 0 } }, ctx);
    assert.equal(pull.result.changes.length, 2);
    assert.equal(pull.result.lastSeq, 2);
    assert.deepEqual(pull.result.changes[0].doc, { title: "first" });
  });
});
