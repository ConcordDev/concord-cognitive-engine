// DET-C batch 7 — contract test for the sovereign-manifestation-cycle
// heartbeat: wires draftSovereignManifestation() (already tested in
// sovereign-raid-archive.test.js) onto a schedule and broadcasts its real
// output to the raid's world room, closing the dead 'world:sovereign-
// manifest' listener finding without inventing any new combat/damage
// mechanic.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { runSovereignManifestationCycle } from "../emergent/sovereign-manifestation-cycle.js";
import { recordPlayerPowerForArchive } from "../lib/sovereign/refusal-archive.js";
import { openSovereignRaid, joinSovereignRaid, closeSovereignRaid } from "../lib/sovereign/raid-event.js";

function fakeIo() {
  const emitted = [];
  return {
    emitted,
    to(room) {
      return {
        emit(event, payload) {
          emitted.push({ room, event, payload });
        },
      };
    },
  };
}

describe("sovereign-manifestation-cycle", () => {
  test("no-op when no raid is open", async () => {
    const state = {};
    const io = fakeIo();
    const r = await runSovereignManifestationCycle({ state, io });
    assert.equal(r.ok, true);
    assert.equal(r.reason, "no_active_raid");
    assert.equal(io.emitted.length, 0);
  });

  test("no-op when raid has closed (closesAt in the past)", async () => {
    const state = {};
    openSovereignRaid(state, "concordia-hub");
    state.activeSovereignRaid.closesAt = Date.now() - 1000;
    const io = fakeIo();
    const r = await runSovereignManifestationCycle({ state, io });
    assert.equal(r.ok, true);
    assert.equal(r.reason, "raid_closed");
    assert.equal(io.emitted.length, 0);
  });

  test("broadcasts the engine's own honest 'empty archive' flavor manifestation when nothing has been recorded yet (never fabricates a fuller one)", async () => {
    const state = {};
    openSovereignRaid(state, "concordia-hub");
    const io = fakeIo();
    const r = await runSovereignManifestationCycle({ state, io });
    assert.equal(r.ok, true);
    assert.equal(r.manifest.name, "Refusal Manifestation: empty archive");
    assert.match(r.manifest.summary, /refuses to bother/);
    assert.equal(r.manifest.sources.length, 0);
    assert.equal(io.emitted.length, 1);
    assert.equal(io.emitted[0].event, "world:sovereign-manifest");
  });

  test("drafts a real manifestation and broadcasts it to the raid's world room", async () => {
    const state = {};
    openSovereignRaid(state, "concordia-hub");
    joinSovereignRaid(state, "playerA");
    for (let i = 0; i < 5; i++) {
      recordPlayerPowerForArchive(state, { id: `s_${i}`, title: `Power ${i}`, meta: { damageRange: [5, 20] } }, "playerA");
    }
    const io = fakeIo();
    const r = await runSovereignManifestationCycle({ state, io });
    assert.equal(r.ok, true);
    assert.ok(r.manifest?.name);
    assert.equal(io.emitted.length, 1);
    assert.equal(io.emitted[0].room, "world:concordia-hub");
    assert.equal(io.emitted[0].event, "world:sovereign-manifest");
    assert.deepEqual(io.emitted[0].payload, r.manifest);
  });

  test("cooldown: a second call within MIN_INTERVAL_MS does not re-broadcast", async () => {
    const state = {};
    openSovereignRaid(state, "concordia-hub");
    joinSovereignRaid(state, "playerA");
    for (let i = 0; i < 5; i++) {
      recordPlayerPowerForArchive(state, { id: `c_${i}`, title: `Power ${i}`, meta: { damageRange: [5, 20] } }, "playerA");
    }
    const io = fakeIo();
    const first = await runSovereignManifestationCycle({ state, io });
    assert.equal(first.ok, true);
    assert.ok(first.manifest);
    const second = await runSovereignManifestationCycle({ state, io });
    assert.equal(second.ok, true);
    assert.equal(second.reason, "cooldown");
    assert.equal(io.emitted.length, 1); // still just the first broadcast
  });

  test("never throws — closed raid roster edge case", async () => {
    const state = {};
    openSovereignRaid(state, "concordia-hub");
    closeSovereignRaid(state); // activeSovereignRaid is now null
    const io = fakeIo();
    const r = await runSovereignManifestationCycle({ state, io });
    assert.equal(r.ok, true);
    assert.equal(r.reason, "no_active_raid");
  });

  test("realtime emit failure never fails the cycle (best-effort)", async () => {
    const state = {};
    openSovereignRaid(state, "concordia-hub");
    joinSovereignRaid(state, "playerA");
    recordPlayerPowerForArchive(state, { id: "x1", title: "X", meta: { damageRange: [5, 20] } }, "playerA");
    const throwingIo = { to() { throw new Error("boom"); } };
    const r = await runSovereignManifestationCycle({ state, io: throwingIo });
    assert.equal(r.ok, true);
    assert.ok(r.manifest);
  });

  test("no io provided — still drafts, just skips the broadcast", async () => {
    const state = {};
    openSovereignRaid(state, "concordia-hub");
    joinSovereignRaid(state, "playerA");
    recordPlayerPowerForArchive(state, { id: "y1", title: "Y", meta: { damageRange: [5, 20] } }, "playerA");
    const r = await runSovereignManifestationCycle({ state });
    assert.equal(r.ok, true);
    assert.ok(r.manifest);
  });
});
