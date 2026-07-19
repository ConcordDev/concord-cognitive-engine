// tests/depth/mesh-send-behavior.test.js
//
// REAL behavioral tests for the inline `mesh.send` macro (server.js), the
// substrate-level "send an actual DTU through the 7-transport routing layer"
// capability (server/lib/concord-mesh.js#sendDTU) — distinct from the
// domain-file `mesh.sendMessage` text-chat macro covered by
// depth/mesh-behavior.test.js and mesh-domain-macros.test.js.
//
// This is the macro Wave 4 gap-closure wired a real frontend UI onto (the
// mesh lens's namesake capability, per docs/lens-specs/mesh-capability-map.md).
// While wiring it, this pass found `mesh.send` resolved `input.dtuId` against
// the SHARED `STATE.dtus` store with no ownership/visibility check — any
// authenticated caller could exfiltrate another user's private DTU over the
// mesh just by guessing/knowing its id, violating the personal_dtus_never_leak
// invariant (CLAUDE.md). Fixed inline (mirrors the dtu.create lineage-consent
// gate: owner, system/founder-authored, or public/global-scope all pass).
// These tests pin BOTH the fix and the real routing behavior.
//
// Boots the real server once via the depth harness (server.js is where
// `mesh.send` is registered — it is NOT extracted to a lib). Internet channel
// is marked available at boot (detectChannels()), so a direct/fragmented send
// is exercised deterministically with no network egress.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";
import { TOTAL_OVERHEAD } from "../../lib/concord-mesh.js";

let runMacro, owner, other;

before(async () => {
  ({ runMacro, ctx: owner } = await macroRuntime("mesh-send-owner"));
  ({ ctx: other } = await macroRuntime("mesh-send-other"));
});

async function makePrivateDtu(actorCtx, n) {
  const r = await runMacro("dtu", "create", {
    title: `mesh-send private probe ${n}`,
    source: "user",
    core: { definitions: [`probe ${n}`], claims: ["a real claim body"] },
    human: { summary: `probe ${n}` },
  }, actorCtx);
  assert.equal(r.ok, true, `dtu.create should succeed: ${JSON.stringify(r)}`);
  assert.equal(r.dtu.visibility, "private", "default visibility is private (no lens override supplied)");
  return r.dtu;
}

test("mesh.send transmits the owner's own DTU (direct/fragmented mode, real channel)", async () => {
  const dtu = await makePrivateDtu(owner, "own");
  const r = await runMacro("mesh", "send", { dtuId: dtu.id, destination: "broadcast" }, owner);
  assert.equal(r.ok, true, `send should succeed for the owner: ${JSON.stringify(r)}`);
  assert.ok(["direct", "fragmented", "store_forward"].includes(r.mode), `mode is one of the real substrate modes: ${r.mode}`);
  if (r.mode !== "store_forward") {
    assert.equal(r.channel, "internet", "internet is the only channel detectChannels() marks available at boot");
    assert.ok(r.transmissionId, "a real transmissionId is returned for a live send");
    assert.ok(Number.isFinite(r.totalBytes) && r.totalBytes > 0, "totalBytes reflects the actual packet size");
  }
});

test("mesh.send rejects sending another user's private DTU by id (personal_dtus_never_leak)", async () => {
  const dtu = await makePrivateDtu(owner, "not-mine");
  const r = await runMacro("mesh", "send", { dtuId: dtu.id, destination: "broadcast" }, other);
  assert.equal(r.ok, false, `a non-owner must not be able to send someone else's private DTU: ${JSON.stringify(r)}`);
  assert.equal(r.error, "not_your_dtu");
});

test("mesh.send allows sending a public/global-scope DTU regardless of caller", async () => {
  const r0 = await runMacro("dtu", "create", {
    title: "mesh-send public probe",
    source: "user",
    visibility: "public",
    core: { definitions: ["public probe"], claims: ["a real claim body"] },
    human: { summary: "public probe" },
  }, owner);
  assert.equal(r0.ok, true, `public dtu.create should succeed: ${JSON.stringify(r0)}`);

  const r = await runMacro("mesh", "send", { dtuId: r0.dtu.id, destination: "broadcast" }, other);
  assert.equal(r.ok, true, `a public DTU should be sendable by any caller: ${JSON.stringify(r)}`);
  assert.ok(["direct", "fragmented", "store_forward"].includes(r.mode), `mode is one of the real substrate modes: ${r.mode}`);
  if (r.mode !== "store_forward") {
    assert.ok(r.transmissionId, "a real transmissionId is returned for a live send");
    // Round-trip: the send must actually be recorded in the mesh transmission
    // log, not just report ok:true — read it back via mesh.stats.
    const stats = await runMacro("mesh", "stats", {}, other);
    assert.equal(stats.ok, true);
    assert.ok(
      stats.recentTransmissions.some((t) => t.id === r.transmissionId),
      `sent transmission ${r.transmissionId} must appear in the mesh transmission log: ${JSON.stringify(stats.recentTransmissions.map((t) => t.id))}`
    );
  }
});

test("mesh.send still requires a DTU (dtu or dtuId) — honest failure, not a silent no-op", async () => {
  const r = await runMacro("mesh", "send", { destination: "broadcast" }, owner);
  assert.equal(r.ok, false);
  assert.match(r.error, /No DTU specified/);
});

test("mesh.send rejects an id for a DTU that doesn't exist (honest failure, not a fabricated success)", async () => {
  const r = await runMacro("mesh", "send", { dtuId: "does-not-exist", destination: "broadcast" }, owner);
  assert.equal(r.ok, false);
  assert.match(r.error, /No DTU specified/);
});

test("mesh.send accepts a caller-supplied inline DTU object without an ownership check (no store lookup, no leak risk)", async () => {
  const inlineDtu = { id: "inline-1", title: "inline", content: "hello mesh" };
  const r = await runMacro("mesh", "send", {
    dtu: inlineDtu,
    destination: "broadcast",
  }, other);
  assert.equal(r.ok, true, `an inline-object send should not be gated by ownership: ${JSON.stringify(r)}`);
  assert.ok(["direct", "fragmented", "store_forward"].includes(r.mode), `mode is one of the real substrate modes: ${r.mode}`);
  if (r.mode !== "store_forward") {
    assert.ok(r.transmissionId, "a real transmissionId is returned for a live send");
    // Round-trip: the inline object was actually serialized and packetized,
    // not merely dispatch-accepted — check its recorded byte size against the
    // substrate's own exact contract (createMeshPacket: contentBytes +
    // TOTAL_OVERHEAD) for a single, unfragmented packet.
    const contentBytes = Buffer.byteLength(JSON.stringify(inlineDtu), "utf8");
    if (r.mode === "direct") {
      assert.equal(r.totalBytes, contentBytes + TOTAL_OVERHEAD,
        `totalBytes must exactly equal the serialized payload (${contentBytes}) plus mesh packet overhead (${TOTAL_OVERHEAD}): got ${r.totalBytes}`);
    } else {
      assert.ok(Number.isFinite(r.totalBytes) && r.totalBytes >= contentBytes,
        `totalBytes (${r.totalBytes}) must reflect the actual serialized inline payload (>= ${contentBytes} raw bytes across fragments)`);
    }
    const stats = await runMacro("mesh", "stats", {}, other);
    assert.equal(stats.ok, true);
    assert.ok(
      stats.recentTransmissions.some((t) => t.id === r.transmissionId),
      `sent transmission ${r.transmissionId} must appear in the mesh transmission log: ${JSON.stringify(stats.recentTransmissions.map((t) => t.id))}`
    );
  }
});
