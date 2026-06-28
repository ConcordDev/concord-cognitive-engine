// Phase-2 gate — creative lens calculator macros (component-exact shape).
//
// These four macros back CreativeActionPanel.tsx's producer bench (Shots /
// Assets / Budget / Delivery). The panel sends `{ artifact: { data: <inner> } }`
// which the /api/lens/run dispatch peels to `<inner>` via
// peelRedundantArtifactWrapper, then calls fn(ctx, { data: inner }, inner).
// This test replays that EXACT 3-arg dispatch and asserts the EXACT fields the
// component renders from r.result, with real computed values.
//
// Hermetic: no server boot, no network, no LLM. The four macros are pure
// deterministic compute.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerCreativeActions from "../domains/creative.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
before(() => { registerCreativeActions(register); });

// Replay the real /api/lens/run lens-action dispatch for a panel payload that
// wraps its inner data as `{ artifact: { data: <inner> } }`.
function dispatch(action, panelInput, ctx = { actor: { userId: "u" }, userId: "u" }) {
  const fn = ACTIONS.get(`creative.${action}`);
  assert.ok(fn, `creative.${action} not registered`);
  const rest = peelRedundantArtifactWrapper(panelInput);
  const virtualArtifact = { id: null, domain: "creative", type: "domain_action", data: rest, meta: {} };
  return fn(ctx, virtualArtifact, rest);
}

describe("creative.shotListGenerate (panel: Scenes JSON)", () => {
  it("computes the EXACT rendered fields from a scenes[] array", () => {
    const parsed = {
      type: "video",
      scenes: [
        { type: "wide", duration: 90, description: "Establishing", equipment: "tripod" },
        { type: "close", duration: 30, description: "Detail", equipment: "gimbal" },
      ],
    };
    const r = dispatch("shotListGenerate", { artifact: { data: parsed } });
    assert.equal(r.ok, true);
    // Exact fields the component renders: totalShots, estimatedRuntime, equipmentList, shots[].{shotNumber,type,duration}
    assert.equal(r.result.totalShots, 2);
    assert.equal(r.result.estimatedRuntime, 2); // (90+30)/60 = 2
    assert.deepEqual(r.result.equipmentList, ["tripod", "gimbal"]);
    assert.equal(r.result.shots[0].shotNumber, 1);
    assert.equal(r.result.shots[0].type, "wide");
    assert.equal(r.result.shots[0].duration, 90);
    assert.equal(r.result.shots[1].shotNumber, 2);
    assert.ok(r.result.shots.every((s) => Number.isFinite(s.duration)));
  });

  it("falls back to a type-based template with no scenes", () => {
    const r = dispatch("shotListGenerate", { artifact: { data: { type: "photo" } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalShots, 6);
    assert.ok(r.result.shots.every((s) => typeof s.shotNumber === "number" && typeof s.type === "string" && Number.isFinite(s.duration)));
    assert.ok(Array.isArray(r.result.equipmentList) && r.result.equipmentList.length > 0);
  });

  it("fails CLOSED on poisoned numeric duration (Number.isFinite holds)", () => {
    const parsed = { type: "video", scenes: [{ type: "x", duration: "1e999" }, { type: "y", duration: "NaN" }] };
    const r = dispatch("shotListGenerate", { artifact: { data: parsed } });
    assert.equal(r.ok, true);
    assert.ok(r.result.shots.every((s) => Number.isFinite(s.duration)));
    assert.ok(Number.isFinite(r.result.estimatedRuntime));
  });

  it("degrades gracefully on an empty artifact (no throw, finite output)", () => {
    const r = dispatch("shotListGenerate", { artifact: { data: {} } });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.estimatedRuntime));
    assert.ok(r.result.totalShots > 0);
  });
});

describe("creative.assetOrganize (panel: Assets JSON)", () => {
  it("computes the EXACT rendered fields from an assets[] array", () => {
    const parsed = {
      assets: [
        { name: "hero.psd", type: "graphic", status: "ready" },
        { name: "promo.mp4", type: "video", status: "pending" },
        { name: "cover.png", type: "graphic", status: "final" },
      ],
    };
    const r = dispatch("assetOrganize", { artifact: { data: parsed } });
    assert.equal(r.ok, true);
    // Exact fields rendered: ready, totalAssets, byType (Record), missing[].name
    assert.equal(r.result.totalAssets, 3);
    assert.equal(r.result.ready, 2); // ready + final
    assert.deepEqual(r.result.byType, { graphic: 2, video: 1 });
    assert.equal(r.result.missing.length, 1);
    assert.equal(r.result.missing[0].name, "promo.mp4");
  });

  it("degrades gracefully with no assets", () => {
    const r = dispatch("assetOrganize", { artifact: { data: {} } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalAssets, 0);
    assert.equal(r.result.ready, 0);
    assert.deepEqual(r.result.byType, {});
    assert.deepEqual(r.result.missing, []);
  });
});

describe("creative.budgetTrack (panel: Budget JSON)", () => {
  it("computes EXACT rendered fields from lines[]", () => {
    const parsed = {
      lines: [
        { category: "Talent", budgeted: 5000, actual: 4200 },
        { category: "Gear", budgeted: 2000, actual: 2600 },
      ],
    };
    const r = dispatch("budgetTrack", { artifact: { data: parsed } });
    assert.equal(r.ok, true);
    // Exact fields rendered: totalBudgeted, totalActual, totalVariance, overBudget, lines[].{category,budgeted,actual,status}
    assert.equal(r.result.totalBudgeted, 7000);
    assert.equal(r.result.totalActual, 6800);
    assert.equal(r.result.totalVariance, 200);
    assert.equal(r.result.overBudget, false);
    assert.equal(r.result.lines.length, 2);
    assert.equal(r.result.lines[0].category, "Talent");
    assert.equal(r.result.lines[1].status, "over"); // 2000 - 2600 < 0
  });

  it("flags overBudget and rolls up budget + expenses[]", () => {
    const parsed = { budget: 1000, expenses: [{ category: "A", amount: 800 }, { category: "B", amount: 700 }] };
    const r = dispatch("budgetTrack", { artifact: { data: parsed } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalActual, 1500);
    assert.equal(r.result.overBudget, true);
    assert.ok(r.result.totalVariance < 0);
    assert.equal(r.result.lines.length, 2);
  });

  it("fails CLOSED on poisoned numerics (every field Number.isFinite)", () => {
    const parsed = { lines: [{ category: "X", budgeted: "1e999", actual: "Infinity" }, { category: "Y", budgeted: 0, actual: "NaN" }] };
    const r = dispatch("budgetTrack", { artifact: { data: parsed } });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.totalBudgeted));
    assert.ok(Number.isFinite(r.result.totalActual));
    assert.ok(Number.isFinite(r.result.totalVariance));
    assert.ok(r.result.lines.every((l) => Number.isFinite(l.budgeted) && Number.isFinite(l.actual) && Number.isFinite(l.variance)));
  });

  it("degrades gracefully with no budget data", () => {
    const r = dispatch("budgetTrack", { artifact: { data: {} } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalBudgeted, 0);
    assert.equal(r.result.totalActual, 0);
    assert.equal(r.result.totalVariance, 0);
    assert.equal(r.result.overBudget, false);
    assert.deepEqual(r.result.lines, []);
  });
});

describe("creative.distributionChecklist (panel: Delivery JSON)", () => {
  it("computes EXACT rendered fields from a provided checklist[]", () => {
    const parsed = {
      platform: "YouTube",
      deliveryDate: "2026-07-01",
      checklist: [
        { item: "Render 4K master", ready: true },
        { item: "Upload caption file", ready: false },
        { item: "Thumbnail approved", ready: true },
        { item: "Publish schedule set", ready: false },
      ],
    };
    // Panel now sends single-wrap (platform lives inside data) — the dispatch peel succeeds.
    const r = dispatch("distributionChecklist", { artifact: { data: parsed } });
    assert.equal(r.ok, true);
    // Exact fields rendered: platform, percent, readyCount, total, deliveryDate, checklist[].{item,ready}
    assert.equal(r.result.platform, "YouTube");
    assert.equal(r.result.total, 4);
    assert.equal(r.result.readyCount, 2);
    assert.equal(r.result.percent, 50);
    assert.equal(r.result.deliveryDate, "2026-07-01");
    assert.equal(r.result.checklist[0].item, "Render 4K master");
    assert.equal(r.result.checklist[0].ready, true);
  });

  it("derives a default checklist by type when none provided", () => {
    const r = dispatch("distributionChecklist", { artifact: { data: { type: "podcast", platform: "Spotify" } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.platform, "Spotify");
    assert.ok(r.result.total >= 5);
    assert.equal(r.result.readyCount, 0);
    assert.equal(r.result.percent, 0);
    assert.ok(r.result.checklist.every((c) => typeof c.item === "string" && typeof c.ready === "boolean"));
  });

  it("degrades gracefully on an empty artifact (finite percent, no throw)", () => {
    const r = dispatch("distributionChecklist", { artifact: { data: {} } });
    assert.equal(r.ok, true);
    assert.equal(r.result.platform, "General");
    assert.ok(Number.isFinite(r.result.percent));
    assert.ok(r.result.total > 0);
    assert.equal(r.result.deliveryDate, "TBD");
  });
});
