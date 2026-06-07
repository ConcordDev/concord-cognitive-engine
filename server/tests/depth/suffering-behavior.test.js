// tests/depth/suffering-behavior.test.js
//
// REAL behavioral tests for the `suffering` lens-action domain — pain-point
// mapping, root-cause (fault-tree / Ishikawa), intervention design, and the
// parity-sprint CRUD board (pains / themes / interventions / snapshots).
// Each `lensRun("suffering", …)` is a literal behavioral invocation: calc
// actions assert COMPUTED values (Pareto, OR-gate probability, priority/ROI);
// CRUD actions assert a write persists + reads back (round-trip) on a shared
// owner-scoped ctx. No network/LLM.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("suffering — calc actions (exact computed values)", () => {
  it("painPointMapping: pareto ranks by frequency-weighted severity×impact, cumulative hits 100%", async () => {
    const r = await lensRun("suffering", "painPointMapping", {
      data: {
        feedback: [
          { text: "crash on save", category: "stability", severity: 9, impact: 8 },
          { text: "crash on open", category: "stability", severity: 8, impact: 7 },
          { text: "crash again", category: "stability", severity: 9, impact: 9 },
          { text: "slow load", category: "performance", severity: 4, impact: 3 },
          { text: "ugly button", category: "cosmetic", severity: 2, impact: 1 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalFeedbackItems, 5);
    assert.equal(r.result.uniqueCategories, 3);
    // stability has 3 items, highest sev+impact → must be the top pain point.
    assert.equal(r.result.painPoints[0].category, "stability");
    assert.equal(r.result.topPainPoint.category, "stability");
    // pareto cumulative percent of the LAST entry is the full 100%.
    const last = r.result.painPoints[r.result.painPoints.length - 1];
    assert.equal(last.cumulativePercent, 100);
    // stability covers the majority of pain → it's in the vital few.
    assert.ok(r.result.vitalFew.categories.includes("stability"));
  });

  it("painPointMapping: frequency = count/total exactly; empty feedback short-circuits", async () => {
    const r = await lensRun("suffering", "painPointMapping", {
      data: {
        feedback: [
          { text: "a", category: "x", severity: 6, impact: 6 },
          { text: "b", category: "x", severity: 6, impact: 6 },
          { text: "c", category: "y", severity: 6, impact: 6 },
          { text: "d", category: "y", severity: 6, impact: 6 },
        ],
      },
    });
    // 2/4 in each category → frequency 0.5 each.
    assert.ok(r.result.painPoints.every((p) => p.frequency === 0.5),
      "each of two equal categories has frequency 0.5");

    const empty = await lensRun("suffering", "painPointMapping", { data: { feedback: [] } });
    assert.equal(empty.ok, true);
    assert.match(empty.result.message, /No feedback data/i);
  });

  it("rootCause: OR-gate parent probability = 1 - prod(1-p_child); requires a problem", async () => {
    const r = await lensRun("suffering", "rootCause", {
      data: {
        problem: { description: "Service outage", effects: ["downtime"] },
        causes: [
          { id: "root", description: "outage", category: "technology" },
          { id: "a", description: "db down", parentId: "root", category: "technology", probability: 0.5 },
          { id: "b", description: "cache cold", parentId: "root", category: "process", probability: 0.5 },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.problem, "Service outage");
    assert.equal(r.result.totalCauses, 3);
    assert.equal(r.result.treeDepth, 1);
    // OR gate over two 0.5 children: 1 - (0.5 * 0.5) = 0.75.
    assert.equal(r.result.causeTree[0].probability, 0.75);
    // two leaf causes (a, b); root is internal.
    assert.equal(r.result.rootCauseCount, 2);
  });

  it("rootCause: missing problem is rejected; empty causes returns a message", async () => {
    const rej = await lensRun("suffering", "rootCause", { data: { causes: [{ id: "x", description: "y" }] } });
    assert.equal(rej.result.ok, false);
    assert.match(String(rej.result.error), /Problem description required/i);

    const noCauses = await lensRun("suffering", "rootCause", {
      data: { problem: { description: "P" }, causes: [] },
    });
    assert.equal(noCauses.ok, true);
    assert.match(noCauses.result.message, /No causes/i);
  });

  it("rootCause: dominant Ishikawa category is the one with highest summed probability", async () => {
    const r = await lensRun("suffering", "rootCause", {
      data: {
        problem: { description: "Defect" },
        causes: [
          { id: "p1", description: "untrained", category: "people", probability: 0.9 },
          { id: "p2", description: "fatigue", category: "people", probability: 0.8 },
          { id: "m1", description: "bad gauge", category: "measurement", probability: 0.2 },
        ],
      },
    });
    assert.equal(r.result.dominantCategory.category, "people");
    assert.ok(r.result.dominantCategory.probability >= 1.7, "people summed prob ~1.7");
  });

  it("interventionDesign: expectedImpact = Σ severity×probability×effectiveness; ranks by priority", async () => {
    const r = await lensRun("suffering", "interventionDesign", {
      data: {
        causes: [
          { id: "c1", description: "leak", severity: 8, probability: 0.5 },
          { id: "c2", description: "noise", severity: 4, probability: 0.5 },
        ],
        interventions: [
          { id: "fix1", description: "seal leak", targetCauseIds: ["c1"], cost: 10, effort: 2, expectedEffectiveness: 1.0, timeToImplement: 4 },
          { id: "fix2", description: "muffle", targetCauseIds: ["c2"], cost: 100, effort: 8, expectedEffectiveness: 0.5, timeToImplement: 30 },
        ],
      },
    });
    assert.equal(r.ok, true);
    const fix1 = r.result.rankedInterventions.find((i) => i.id === "fix1");
    // 8 × 0.5 × 1.0 = 4.0
    assert.equal(fix1.expectedImpact, 4);
    // cheap, high-impact intervention ranks first.
    assert.equal(r.result.rankedInterventions[0].id, "fix1");
    assert.equal(r.result.topRecommendations[0].id, "fix1");
    // every cause is covered by some intervention.
    assert.equal(r.result.coverageGap, 0);
    assert.equal(r.result.overallCoverage, 1);
  });

  it("interventionDesign: uncovered causes are reported; rejects empty inputs", async () => {
    const r = await lensRun("suffering", "interventionDesign", {
      data: {
        causes: [
          { id: "c1", description: "a", severity: 5 },
          { id: "c2", description: "b", severity: 5 },
        ],
        interventions: [{ id: "i1", description: "only c1", targetCauseIds: ["c1"], cost: 20 }],
      },
    });
    assert.equal(r.result.coverageGap, 1);
    assert.ok(r.result.uncoveredCauses.some((c) => c.id === "c2"), "c2 left uncovered");

    const rej = await lensRun("suffering", "interventionDesign", { data: { causes: [], interventions: [] } });
    assert.equal(rej.result.ok, false);
    assert.match(String(rej.result.error), /No causes/i);
  });
});

describe("suffering — CRUD lifecycle (write persists + reads back)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("suffering-crud"); });

  it("pain-create → pain-list: created pain reads back with clamped fields", async () => {
    const created = await lensRun("suffering", "pain-create", {
      params: { title: "Onboarding too slow", severity: 99, frequency: 7, impact: 6, effort: 3 },
    }, ctx);
    assert.equal(created.ok, true);
    const id = created.result.pain.id;
    assert.equal(created.result.pain.severity, 10, "severity clamped 99 → 10");
    assert.equal(created.result.pain.status, "open");

    const list = await lensRun("suffering", "pain-list", {}, ctx);
    assert.ok(list.result.pains.some((p) => p.id === id), "created pain appears in list");
    // priorityScore = sev×freq×impact / effort = 10×7×6 / 3 = 140.
    const found = list.result.pains.find((p) => p.id === id);
    assert.equal(found.priorityScore, 140);
  });

  it("pain-create rejects a blank title", async () => {
    const rej = await lensRun("suffering", "pain-create", { params: { title: "   " } }, ctx);
    assert.equal(rej.result.ok, false);
    assert.match(String(rej.result.error), /title required/i);
  });

  it("pain-update: status → resolved moves it from openCount to resolvedCount", async () => {
    const c = await lensRun("suffering", "pain-create", { params: { title: "Flaky export" } }, ctx);
    const id = c.result.pain.id;
    const before = await lensRun("suffering", "pain-list", {}, ctx);
    const openBefore = before.result.openCount;

    const upd = await lensRun("suffering", "pain-update", { params: { id, status: "resolved" } }, ctx);
    assert.equal(upd.result.pain.status, "resolved");

    const after = await lensRun("suffering", "pain-list", {}, ctx);
    assert.equal(after.result.openCount, openBefore - 1, "one fewer open pain");
    assert.ok(after.result.resolvedCount >= 1);

    const missing = await lensRun("suffering", "pain-update", { params: { id: "nope" } }, ctx);
    assert.equal(missing.result.ok, false);
    assert.match(String(missing.result.error), /not found/i);
  });

  it("priority-matrix: a high-impact low-effort pain lands in quick_wins", async () => {
    const c = await lensRun("suffering", "pain-create", {
      params: { title: "Quick win pain", severity: 10, frequency: 10, impact: 10, effort: 2 },
    }, ctx);
    const id = c.result.pain.id;
    const m = await lensRun("suffering", "priority-matrix", {}, ctx);
    // rawImpact = 10×10×10/100 = 10 (≥5) and effort 2 (≤5) → quick_wins.
    assert.ok(m.result.quadrants.quick_wins.some((pt) => pt.id === id), "landed in quick_wins");
    assert.ok(m.result.summary.quickWins >= 1);
  });

  it("theme-create + pain themeId → theme-list aggregates member impact; delete orphans pains", async () => {
    const t = await lensRun("suffering", "theme-create", { params: { name: "Performance" } }, ctx);
    const themeId = t.result.theme.id;
    const p = await lensRun("suffering", "pain-create", {
      params: { title: "Slow query", severity: 8, frequency: 5, impact: 6, effort: 4, themeId },
    }, ctx);
    const painId = p.result.pain.id;

    const list = await lensRun("suffering", "theme-list", {}, ctx);
    const theme = list.result.themes.find((x) => x.id === themeId);
    assert.ok(theme, "theme present");
    assert.ok(theme.painCount >= 1, "theme has at least one member pain");

    const del = await lensRun("suffering", "theme-delete", { params: { id: themeId } }, ctx);
    assert.equal(del.result.deleted, themeId);
    // member pain is orphaned (themeId nulled), not deleted.
    const pl = await lensRun("suffering", "pain-list", {}, ctx);
    const orphan = pl.result.pains.find((x) => x.id === painId);
    assert.equal(orphan.themeId, null, "deleted theme orphans its pains");
  });

  it("intervention-track → intervention-update: completing logs history + bumps progress to 100", async () => {
    const t = await lensRun("suffering", "intervention-track", { params: { title: "Add caching" } }, ctx);
    const id = t.result.intervention.id;
    assert.equal(t.result.intervention.status, "proposed");

    const upd = await lensRun("suffering", "intervention-update", {
      params: { id, status: "completed", note: "shipped" },
    }, ctx);
    assert.equal(upd.result.intervention.status, "completed");
    assert.equal(upd.result.intervention.progress, 100, "completed → progress 100");
    assert.ok(upd.result.intervention.history.some((h) => h.status === "completed"),
      "history records the completion");

    const ilist = await lensRun("suffering", "intervention-list", {}, ctx);
    assert.ok(ilist.result.interventions.some((i) => i.id === id));
    assert.ok(ilist.result.byStatus.completed >= 1);
  });

  it("snapshot-record → trend-view: two rising snapshots report a worsening direction", async () => {
    // First snapshot captures current open pain.
    const s1 = await lensRun("suffering", "snapshot-record", {}, ctx);
    assert.equal(s1.ok, true);
    // Add a heavy new pain so total impact rises before the second snapshot.
    await lensRun("suffering", "pain-create", {
      params: { title: "Severe regression", severity: 10, frequency: 10, impact: 10, effort: 1 },
    }, ctx);
    const s2 = await lensRun("suffering", "snapshot-record", {}, ctx);
    assert.ok(s2.result.snapshot.totalImpact > s1.result.snapshot.totalImpact,
      "second snapshot has higher total impact");

    const tv = await lensRun("suffering", "trend-view", {}, ctx);
    assert.ok(tv.result.count >= 2);
    assert.equal(tv.result.direction, "worsening");
    assert.ok(tv.result.deltaImpact > 0);
  });

  it("root-cause-tree: persists causes on a pain; OR-leaf probabilities and fishbone group by category", async () => {
    const p = await lensRun("suffering", "pain-create", { params: { title: "Bug rate high" } }, ctx);
    const painId = p.result.pain.id;
    const rct = await lensRun("suffering", "root-cause-tree", {
      params: {
        painId,
        causes: [
          { id: "r", description: "root", category: "process" },
          { id: "l1", description: "no review", parentId: "r", category: "process", probability: 0.8 },
          { id: "l2", description: "bad tooling", parentId: "r", category: "technology", probability: 0.2 },
        ],
      },
    }, ctx);
    assert.equal(rct.ok, true);
    assert.equal(rct.result.causeCount, 3);
    // leaves sorted by probability desc → highest-prob leaf first.
    assert.equal(rct.result.rootCauses[0].id, "l1");
    assert.equal(rct.result.rootCauses[0].probability, 0.8);
    // fishbone groups l2 under technology.
    assert.ok(rct.result.fishbone.technology.some((c) => c.id === "l2"));

    // Re-running without causes reads the persisted set back.
    const again = await lensRun("suffering", "root-cause-tree", { params: { painId } }, ctx);
    assert.equal(again.result.causeCount, 3, "causes persisted on the pain");

    const missing = await lensRun("suffering", "root-cause-tree", { params: { painId: "nope" } }, ctx);
    assert.equal(missing.result.ok, false);
    assert.match(String(missing.result.error), /not found/i);
  });

  it("export-report: markdown format embeds prioritized pain titles", async () => {
    const json = await lensRun("suffering", "export-report", { params: { format: "json" } }, ctx);
    assert.equal(json.result.format, "json");
    assert.ok(Array.isArray(json.result.report.pains));

    const md = await lensRun("suffering", "export-report", { params: { format: "markdown" } }, ctx);
    assert.equal(md.result.format, "markdown");
    assert.ok(md.result.markdown.includes("# Pain-Point Analysis Report"));
    assert.ok(md.result.markdown.includes("Prioritized Pain Points"));
  });
});
