// Second-chance / CLOCK-style grace window for the Selective Forgetting
// Engine (server/emergent/forgetting-engine.js#runForgettingCycle). Before
// this window existed, a DTU whose retentionScore dropped below `_threshold`
// was tombstoned in the SAME cycle it was first found low. Now an
// unprotected DTU gets GRACE_CYCLES real (non-dry-run) cycles to recover
// (e.g. via a fresh citation bumping its score back up) before it's
// actually forgotten via the existing, unmodified forgetDTU path.
//
// This is additive bookkeeping only — it never changes WHICH DTUs are
// eligible for forgetting or the definition of below-threshold, only WHEN
// an eligible DTU actually gets tombstoned. It composes independently of
// the SM-2-inspired review-scheduling section added later in the same file
// (that section tracks WHEN to re-score a DTU against the DB-backed
// dtu_review_schedule table; this one tracks the in-memory grace countdown
// after a low score is found — the two never read or write each other's
// state).
//
// Run: node --test tests/forgetting-engine-grace-window.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runForgettingCycle } from "../emergent/forgetting-engine.js";

// Default GRACE_CYCLES per forgetting-engine.js
// (parseInt(process.env.FORGETTING_GRACE_CYCLES || "3", 10)). Not exported —
// mirrored here the same way tests/dtu-review-schedule.test.js mirrors the
// SM-2 canonical constants rather than importing them.
const GRACE_CYCLES = 3;

// A DTU whose retentionScore is unambiguously ABOVE the default 0.15
// forgetting threshold: tier "mega" alone contributes 0.15 * 999 to the
// weighted sum, dwarfing every other term.
function strongDtu(id) {
  return {
    id,
    tier: "mega",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: [],
    authority: { score: 1 },
    lineage: { parents: [], children: [] },
  };
}

// A DTU whose retentionScore is unambiguously BELOW the default threshold:
// ancient (age decay -> ~0), never accessed since (recency -> ~0), lowest
// tier weight (shadow = 0.2), zero authority, no lineage/tag bonuses.
function weakDtu(id) {
  return {
    id,
    tier: "shadow",
    createdAt: new Date("2000-01-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2000-01-01T00:00:00Z").toISOString(),
    tags: [],
    authority: { score: 0 },
    lineage: { parents: [], children: [] },
  };
}

describe("forgetting-engine — second-chance grace window", () => {
  let STATE;

  beforeEach(() => {
    STATE = { dtus: new Map() };
    globalThis._concordSTATE = STATE;
  });

  afterEach(() => {
    delete globalThis._concordSTATE;
  });

  it("a DTU crossing below threshold is NOT immediately tombstoned — grace starts instead", async () => {
    const dtu = weakDtu("d-cross");
    STATE.dtus.set(dtu.id, dtu);

    const result = await runForgettingCycle(false);
    assert.equal(result.ok, true);

    assert.ok(STATE.dtus.has(dtu.id), "the DTU survives its first below-threshold cycle");
    assert.ok(!STATE.dtus.has(`tomb_${dtu.id}`), "no tombstone was created yet");
    assert.equal(result.forgottenCount, 0, "nothing was forgotten this cycle");
    assert.ok(typeof dtu._graceUntil === "number", "a grace window was started");
  });

  it("a DTU that recovers above threshold during its grace window survives and has _graceUntil cleared", async () => {
    const dtu = weakDtu("d-recover");
    STATE.dtus.set(dtu.id, dtu);

    // Cycle 1: crosses below threshold, grace window starts.
    await runForgettingCycle(false);
    assert.ok(typeof dtu._graceUntil === "number", "grace window started");

    // Simulate recovery (e.g. a fresh citation lifted its retentionScore).
    // Deliberately stays on tier "regular" (NOT "core"/"mega", which are
    // themselves PROTECTION_RULES — using one would make isProtected() true
    // and short-circuit the grace-clearing branch entirely, which would
    // pass for the wrong reason). Freshening age/recency + full authority
    // pushes retentionScore comfortably above the 0.15 threshold on its own:
    // 0.20*ageDecay(~1) + 0.20*recency(~1) + 0.10*authority(1) + 0.15*0.5(tier) ≈ 0.575.
    dtu.tier = "regular";
    dtu.createdAt = new Date().toISOString();
    dtu.updatedAt = new Date().toISOString();
    dtu.authority = { score: 1 };

    // Cycle 2: now scores above threshold.
    const result = await runForgettingCycle(false);
    assert.equal(result.ok, true);

    assert.ok(STATE.dtus.has(dtu.id), "the recovered DTU is not forgotten");
    assert.equal(dtu._graceUntil, undefined, "_graceUntil is cleared on recovery — clean slate");
  });

  it("a DTU that stays below threshold for GRACE_CYCLES consecutive cycles IS eventually tombstoned", async () => {
    const dtu = weakDtu("d-expire");
    STATE.dtus.set(dtu.id, dtu);

    // First GRACE_CYCLES real cycles: the DTU is below threshold every time
    // but must survive — it's within its grace window.
    for (let i = 0; i < GRACE_CYCLES; i++) {
      const result = await runForgettingCycle(false);
      assert.equal(result.ok, true);
      assert.ok(
        STATE.dtus.has(dtu.id),
        `the DTU must still be present after grace cycle ${i + 1}/${GRACE_CYCLES}`
      );
    }

    // One more cycle: grace has elapsed and the DTU is still below
    // threshold — it goes through the existing, unmodified forgetDTU path.
    const finalResult = await runForgettingCycle(false);
    assert.equal(finalResult.ok, true);
    assert.ok(!STATE.dtus.has(dtu.id), "the DTU is gone after its grace window elapses");
    assert.ok(STATE.dtus.has(`tomb_${dtu.id}`), "a tombstone was created via forgetDTU");
    assert.equal(finalResult.forgottenCount, 1);
  });

  it("a protected/pinned DTU never enters the grace mechanism at all", async () => {
    const dtu = weakDtu("d-pinned");
    dtu._pinned = true;
    STATE.dtus.set(dtu.id, dtu);

    // Run several cycles — enough to have expired a grace window if one had
    // (wrongly) started.
    for (let i = 0; i < GRACE_CYCLES + 2; i++) {
      const result = await runForgettingCycle(false);
      assert.equal(result.ok, true);
      assert.ok(STATE.dtus.has(dtu.id), `pinned DTU must survive cycle ${i + 1}`);
      assert.equal(dtu._graceUntil, undefined, "a pinned DTU never gets a grace countdown started");
    }

    assert.ok(!STATE.dtus.has(`tomb_${dtu.id}`), "a pinned DTU is never tombstoned");
  });

  it("dry runs never advance the grace-window bookkeeping", async () => {
    const dtu = weakDtu("d-dryrun");
    STATE.dtus.set(dtu.id, dtu);

    // Repeated dry-run previews must not start or advance a grace window —
    // only real cycles may mutate _graceUntil / the cycle counter.
    for (let i = 0; i < GRACE_CYCLES + 2; i++) {
      const preview = await runForgettingCycle(true);
      assert.equal(preview.ok, true);
      assert.equal(preview.dryRun, true);
    }

    assert.equal(dtu._graceUntil, undefined, "dry runs never start a grace window");
    assert.ok(STATE.dtus.has(dtu.id), "dry runs never mutate STATE.dtus");
  });
});
