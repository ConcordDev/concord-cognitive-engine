// Instrument 2 — the five axis playtest harnesses (pure cores). Each axis is a
// driver-injectable runner over a pure analyzer; these pin the analyzers (the
// live-server adapters supply real drivers). Catches the failure each axis exists
// to catch.
//
// Run: node --test tests/playtest-axes.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffViews, viewsAgree } from "../../scripts/playtest/shared-parity.mjs";
import { checkEconomicInvariants, economySound } from "../../scripts/playtest/adversarial-economy.mjs";
import { createNewbieTracker, stepWasLegible } from "../../scripts/playtest/clueless-newbie.mjs";
import { diffPreservation, creationsPreserved } from "../../scripts/playtest/world-snapshot-restore.mjs";
import { crowdScaleGate, frameBudgetOk } from "../../scripts/playtest/perf-scale.mjs";

describe("Axis A — shared-state parity", () => {
  it("catches when the observer doesn't see what the actor did", () => {
    const actor = [{ id: "pit1", x: 5, z: 5, kind: "hole" }];
    assert.equal(viewsAgree(actor, [{ id: "pit1", x: 5, z: 5, kind: "hole" }]), true);
    const d = diffViews(actor, []); // observer sees nothing — the dug pit didn't replicate
    assert.equal(d.parity, false);
    assert.equal(d.divergences[0].reason, "missing_for_observer");
  });
});

describe("Axis B — exploit gate", () => {
  it("flags negative balance, over-paid split, royalty-cap breach, dupe citation", () => {
    assert.equal(economySound({ wallets: [{ user_id: "u", balance: 10 }] }), true);
    const v = checkEconomicInvariants({
      wallets: [{ user_id: "bad", balance: -5 }],
      royaltySplits: [{ saleId: "s1", total: 100, parts: [60, 50] }], // 110 > 100 + ancestor 50 > 30
      citations: [{ child_id: "c", parent_id: "p" }, { child_id: "c", parent_id: "p" }],
    });
    const kinds = v.map((x) => x.kind).sort();
    assert.ok(kinds.includes("negative_balance"));
    assert.ok(kinds.includes("overpaid_split"));
    assert.ok(kinds.includes("royalty_cap_breached"));
    assert.ok(kinds.includes("dupe_citation"));
  });
});

describe("Axis C — naive newbie", () => {
  it("rage-quits after consecutive confusing steps; legibility heuristic", () => {
    assert.equal(stepWasLegible({ ok: true, options: ["a"] }), true);
    assert.equal(stepWasLegible({ ok: true }), false);     // bare ok = dead end
    assert.equal(stepWasLegible({ ok: false }), false);
    const t = createNewbieTracker({ rageQuitAt: 2 });
    t.step("open", false); t.step("next", false);
    assert.equal(t.rageQuit, true);
    assert.equal(t.confusionCount, 2);
  });
});

describe("Axis D — persistence", () => {
  it("catches a lost / owner-changed creation across a migration", () => {
    const before = [{ id: "d1", creator_id: "u1", title: "Spell" }, { id: "d2", creator_id: "u2" }];
    assert.equal(creationsPreserved(before, before), true);
    const r = diffPreservation(before, [{ id: "d1", creator_id: "u9" }]); // d2 lost, d1 owner stolen
    assert.equal(r.preserved, false);
    const reasons = r.losses.map((l) => l.reason).sort();
    assert.deepEqual(reasons, ["lost", "owner_changed"]);
  });
});

describe("Axis E — performance at scale", () => {
  it("passes at 60fps + tick budget, fails on overrun", () => {
    const ok = crowdScaleGate({ entities: 200, players: 10, fps: 60, tickMs: 8000 });
    assert.equal(ok.ok, true);
    assert.equal(ok.atScale, true);
    assert.equal(frameBudgetOk({ fps: 40, tickMs: 20000 }).ok, false);
  });
});
