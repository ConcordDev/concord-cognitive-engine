// Contract test for Wave 7 / Layer 4 — instinct engine + releaser table.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  releasersForSpecies,
  matchReleaser,
  _resetReleasersCache,
} from "../lib/ecosystem/releasers.js";
import { creatureIntent } from "../lib/ecosystem/creature-needs.js";

test("Wave 7 — instinct engine / releasers (Layer 4)", async (t) => {
  _resetReleasersCache();

  await t.test("releasersForSpecies is total + composes clade + species", () => {
    const deer = releasersForSpecies("deer");
    assert.ok(Array.isArray(deer) && deer.length > 0);
    // deer is a mammal → inherits clade mammal entries + its own
    assert.ok(deer.some((r) => r.fap === "freeze_then_bolt"), "species FAP present");
    assert.ok(deer.every((r) => Number.isFinite(r.gain) && r.drive && r.fap));
    // unknown species → total (clade fallback / empty)
    assert.ok(Array.isArray(releasersForSpecies("nonsense-xyz")));
    assert.ok(Array.isArray(releasersForSpecies(null)));
  });

  await t.test("deer + noise spike + elevated PANIC → freeze_then_bolt", () => {
    const deer = releasersForSpecies("deer");
    const won = matchReleaser(deer, { noise: 85 }, { PANIC: 0.8, FEAR: 0.3 });
    assert.ok(won, "a releaser fired");
    assert.equal(won.fap, "freeze_then_bolt");
    assert.equal(won.gain, 1.8);
    assert.equal(won.drive, "PANIC");
  });

  await t.test("PANIC suppressed → null (the drive gate is load-bearing)", () => {
    const deer = releasersForSpecies("deer");
    // same loud stimulus, but PANIC/FEAR are low → no bolt (calm animal ignores it)
    const won = matchReleaser(deer, { noise: 85 }, { PANIC: 0.2, FEAR: 0.1 });
    assert.equal(won, null, "stimulus alone does not fire without the gating drive");
  });

  await t.test("quiet world → no releaser fires (stimulus gate)", () => {
    const deer = releasersForSpecies("deer");
    const won = matchReleaser(deer, { noise: 40 }, { PANIC: 0.9 });
    assert.equal(won, null, "below threshold → null even with high drive");
  });

  await t.test("hawk + prey visible + SEEKING → stoop, gain 2.0", () => {
    const hawk = releasersForSpecies("hawk");
    const won = matchReleaser(hawk, { preyVisible: true }, { SEEKING: 0.8 });
    assert.ok(won);
    assert.equal(won.fap, "stoop");
    assert.equal(won.gain, 2.0);
  });

  await t.test("strongest instinct wins when multiple fire", () => {
    const deer = releasersForSpecies("deer");
    // both the noise FAP and the predator-scent FAP can fire; predator scent (bolt)
    // is gated on FEAR — give both drives high, the higher drive×gain wins.
    const won = matchReleaser(deer, { noise: 85, predatorNear: true },
      { PANIC: 0.6, FEAR: 0.95 });
    assert.ok(won);
    // FEAR 0.95 × 1.7 (bolt) = 1.615 vs PANIC 0.6 × 1.8 (freeze_then_bolt) = 1.08
    assert.equal(won.fap, "bolt");
  });

  await t.test("creatureIntent: released FAP overrides need-ranking, back-compat preserved", () => {
    const needs = { hunger: 0.9, thirst: 0.1, energy: 0.1, safety: 0.1, reproduction: 0.1 };
    // without a release → original need-ranking picks graze/hunt on hunger
    const baseline = creatureIntent(needs, { diet: "herbivore" }, {});
    assert.equal(baseline, "graze");
    // with a freeze_then_bolt release → flee overrides the hunger drive
    const released = creatureIntent(needs, { diet: "herbivore" }, {}, { fap: "freeze_then_bolt" });
    assert.equal(released, "flee", "instinct fires before need arbitration");
    // null release → unchanged (back-compat)
    assert.equal(creatureIntent(needs, { diet: "herbivore" }, {}, null), "graze");
  });
});
