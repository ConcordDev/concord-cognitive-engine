// Source pins for the Metalearning build (S-META-1..7). These read the
// shipped FE sources and assert the shapes the slices require — the
// success-rate receipt on the strategy card, the curriculums counter
// key, the adaptation receipt reaching the Results panel, two-step
// deletes on every object type, the Analysis honesty renderings,
// computed goals, and the keep-mounted views. Behavioural proof for
// the server halves lives in the domain parity suite and the build's
// extraction harness.

import { describe, it } from 'vitest';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, "..", rel), "utf8");

const desk = read("components/metalearning/StrategiesDeskPanel.tsx");
const analysis = read("components/metalearning/AnalysisPanel.tsx");
const goals = read("components/metalearning/GoalTrackerPanel.tsx");
const plans = read("components/metalearning/LearningPlanPanel.tsx");
const spaced = read("components/metalearning/SpacedRepetitionPanel.tsx");
const experiments = read("components/metalearning/StrategyExperimentPanel.tsx");
const journal = read("components/metalearning/StudyJournalPanel.tsx");
const techniques = read("components/metalearning/TechniqueLibraryPanel.tsx");
const progress = read("components/metalearning/ProgressAnalyticsPanel.tsx");
const feed = read("components/metalearning/MetalearningFeed.tsx");
const page = read("app/lenses/metalearning/page.tsx");
const client = read("lib/api/client.ts");

describe("S-META-1 — performance from the record", () => {
  it("the card shows the success rate with its counts", () => {
    assert.ok(desk.includes("success rate · {s.successes ?? 0} of {s.uses || 0} outcomes"));
  });
  it("zero outcomes render the honest absence, not a figure", () => {
    assert.ok(desk.includes("No outcomes yet"));
  });
  it("the FE no longer sends the undisclosed score constants", () => {
    assert.ok(!desk.includes("0.85"));
    assert.ok(!desk.includes("success ? 0.85 : 0.25"));
    assert.ok(desk.includes("recordOutcome(strategyId, { success })"));
  });
  it("the header average is the success rate over rated strategies only", () => {
    assert.ok(desk.includes("Avg Success Rate"));
    assert.ok(desk.includes("st.avgPerformance != null"));
  });
});

describe("S-META-2 — curriculum as a real object", () => {
  it("both counters read the status field the server sends", () => {
    assert.ok(desk.includes("statusInfo.curriculums"));
    assert.ok(!desk.includes("statusInfo.curricula ||"));
  });
  it("results render as a plan, never as raw JSON", () => {
    assert.ok(!desk.includes("JSON.stringify(results"));
    assert.ok(desk.includes("c.provenance"));
    assert.ok(desk.includes("Saved curricula"));
  });
  it("the client can list saved curricula", () => {
    assert.ok(client.includes("curricula: () => api.get('/api/metalearning/curricula')"));
  });
});

describe("S-META-3 — adaptation made true", () => {
  it("adapt results reach the Results panel", () => {
    assert.ok(desk.includes("setResults(res.data)"));
  });
  it("the log's empty state states the firing rule the code runs", () => {
    assert.ok(desk.includes("healthy band"));
    assert.ok(desk.includes("success rate over 80%"));
  });
  it("the strategy card displays its tuned parameters", () => {
    assert.ok(desk.includes("Learning rate {s.parameters.learningRate.toFixed(2)}"));
  });
  it("the adaptation receipt renders outcomes counted and changes", () => {
    assert.ok(desk.includes("a.outcomesCounted"));
    assert.ok(desk.includes("r.outcomesCounted"));
  });
});

describe("S-META-4 — lifecycle completion", () => {
  it("strategies delete two-step from the desk", () => {
    assert.ok(desk.includes("deleteStrategyMut"));
    assert.ok(client.includes("deleteStrategy"));
  });
  it("plans, goals, experiments, and journal entries delete via their verbs", () => {
    assert.ok(plans.includes("'planDelete'"));
    assert.ok(goals.includes("'goalDelete'"));
    assert.ok(experiments.includes("'experimentDelete'"));
    assert.ok(journal.includes("'journalDelete'"));
  });
  it("spaced cards delete from the upcoming list too, behind a confirm", () => {
    assert.ok(spaced.includes("deleteControl(u.id, u.front)"));
    assert.ok(spaced.includes("Delete?"));
  });
});

describe("S-META-5 — analysis honesty", () => {
  it("confidence renders only as a number, with its basis", () => {
    assert.ok(!analysis.includes("String(actionResult.confidence)"));
    assert.ok(analysis.includes("confidenceBasis"));
  });
  it("the method copy states what runs from this form", () => {
    assert.ok(analysis.includes("runs the built-in"));
    assert.ok(analysis.includes("heuristic over the five features"));
  });
  it("transfer renders coefficients and shared skills", () => {
    assert.ok(analysis.includes("actionResult.similarity"));
    assert.ok(analysis.includes("Shared skills"));
  });
  it("the profile headline is labelled and the difficulty target renders", () => {
    assert.ok(analysis.includes("mean of your difficulty-adjusted skill scores"));
    assert.ok(analysis.includes("Zone of proximal development"));
  });
  it("the result panel clears on tab switch (F20)", () => {
    assert.ok(analysis.includes("setAnalysisTab(id); setActionResult(null);"));
  });
  it("technique strength is labelled an editorial rating (F5)", () => {
    assert.ok(techniques.includes("editorial"));
    assert.ok(!techniques.includes("% evidence"));
  });
});

describe("S-META-6 — one learning record", () => {
  it("best-strategy refreshes when outcomes land (F10)", () => {
    assert.ok(desk.includes("invalidateQueries({ queryKey: ['metalearning-best'] })"));
  });
  it("goals offer counted metrics and label self-reported ones (F9)", () => {
    assert.ok(goals.includes("COMPUTED_METRICS"));
    assert.ok(goals.includes("counted from your lens record"));
    assert.ok(goals.includes("self-reported"));
  });
  it("progress names what its counter counts and states the mastery rule (F8)", () => {
    assert.ok(progress.includes("Journal sessions"));
    assert.ok(progress.includes("3+ repetitions with ease ≥ 2.3"));
  });
});

describe("S-META-7 — fleet-pattern closures", () => {
  it("visited views stay mounted across switches (F18)", () => {
    assert.ok(page.includes("visited"));
    assert.ok(page.includes("hidden={active !== 'strategies'}"));
    assert.ok(!page.includes("<div key={active}>"));
  });
  it("the feed label says what the list is (F15)", () => {
    assert.ok(feed.includes("activeQuery.label"));
    assert.ok(feed.includes("ranked by relevance"));
  });
  it("journal stars are labelled effectiveness, not favourites (F13)", () => {
    assert.ok(journal.includes("Effectiveness ${n} of 5"));
    assert.ok(!journal.includes('aria-label="Favorite"'));
  });
});
