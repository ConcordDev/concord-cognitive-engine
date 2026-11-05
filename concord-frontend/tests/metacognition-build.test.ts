/**
 * Source-pin suite for the Metacognition full-lens build
 * (build(metacognition), S-MC-1..7). The filed first pass (R3) found a
 * lens whose headline figures did not derive from the user's record:
 * the Confidence Map rendered a DTU-coverage statistic as competence,
 * the strategy selector was a 7-keyword matcher disjoint from the
 * 12-strategy library, the confidence adjuster never read recorded
 * accuracy, the introspection focus was discarded, evaluated-but-
 * cleared bias patterns vanished, analysis readouts dumped raw
 * objects, and view switches destroyed in-progress panel state.
 *
 * These pins hold the FE contracts of the build: every figure the
 * lens shows is either record-derived with its inputs visible, or
 * the surface says plainly that no record exists yet.
 *
 * Each pin is verified against the shipped source below.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, "..", rel), "utf8");

const desk = read("components/metacognition/useMetacognitionDesk.ts");
const awareness = read("components/metacognition/AwarenessPanel.tsx");
const learning = read("components/metacognition/LearningPanel.tsx");
const introspection = read("components/metacognition/IntrospectionPanel.tsx");
const predictions = read("components/metacognition/PredictionsPanel.tsx");
const journal = read("components/metacognition/DecisionJournal.tsx");
const reflection = read("components/metacognition/ReflectionPrompts.tsx");
const accuracy = read("components/metacognition/AccuracyTracker.tsx");
const toolkit = read("components/metacognition/ReasoningToolkit.tsx");
const page = read("app/lenses/metacognition/page.tsx");
const client = read("lib/api/client.ts");

describe("S-MC-1 — competence derives from the record, inputs visible", () => {
  it("the desk reads the domain record, not the coverage assessments", () => {
    assert.ok(desk.includes("queryKey: ['metacognition-domain-record']"));
    assert.ok(desk.includes("apiHelpers.metacognition.domainRecord()"));
    assert.ok(!desk.includes("queryKey: ['metacognition-assessments']"), "the assessments query is retired from the desk");
    assert.ok(client.includes("domainRecord: () => api.get('/api/metacognition/domain-record')"));
  });

  it("map rows carry their inputs and a no-record domain shows no invented bar", () => {
    assert.ok(awareness.includes("'no record yet'"));
    assert.ok(awareness.includes("resolved predictions correct"));
    assert.ok(awareness.includes("Predictions logged, none resolved yet"));
  });

  it("the assessment result renders with its counts, or its honest absence", () => {
    assert.ok(learning.includes("latestAssessment"));
    assert.ok(learning.includes("resolved predictions correct"));
    assert.ok(learning.includes("Competence by Domain — from your record"));
    assert.ok(!learning.includes("previous_confidence"), "no fabricated improvement deltas — the record keeps no such history");
  });

  it("recent events are the user's own resolutions, not templated recommendations", () => {
    assert.ok(learning.includes("Recent Resolutions"));
    assert.ok(desk.includes("Resolved \""));
  });

  it("blind spots name the record rule that produces them", () => {
    assert.ok(awareness.includes("at least half of its resolved predictions (2 or more) turn out wrong"));
  });
});

describe("S-MC-2/3 — toolkit and introspection contracts", () => {
  it("the toolkit documents the library and the record-derived adjuster", () => {
    assert.ok(toolkit.includes("twelve-strategy library"));
    assert.ok(toolkit.includes("at least 3 resolved"));
    assert.ok(toolkit.includes("resolvedCount?: number"));
    assert.ok(toolkit.includes("Based on {confResult.resolvedCount} resolved prediction"));
  });

  it("introspection counts patterns and runs as separate quantities (F13)", () => {
    assert.ok(introspection.includes("failure pattern(s) found across"));
    assert.ok(introspection.includes("introData.patternsFound"));
    assert.ok(introspection.includes("introData.runsCount"));
  });

  it("a focused run names its scope in the results (F10)", () => {
    assert.ok(introspection.includes("latestIntrospection.focus"));
    assert.ok(introspection.includes("resolved predictions in scope"));
  });
});

describe("S-MC-5/6 — readouts are labelled values, never object dumps", () => {
  it("calibration renders ECE/MCE/quality on the one stated scale", () => {
    assert.ok(predictions.includes("calObj.ece.toFixed(3)"));
    assert.ok(predictions.includes("the whole lens uses this one scale"));
    assert.ok(awareness.includes("excellent &lt; 0.05 · good &lt; 0.10 · moderate &lt; 0.20 · poor ≥ 0.20"));
  });

  it("reliability bins render as rows of labelled numbers", () => {
    assert.ok(predictions.includes("usedBins"));
    assert.ok(predictions.includes("· predicted"));
    assert.ok(predictions.includes("· actual"));
    assert.ok(predictions.includes("· gap"));
  });

  it("the learning-rate readout is labelled, and Brier skill names its baseline", () => {
    assert.ok(predictions.includes("Avg improvement / trial"));
    assert.ok(predictions.includes("Brier Skill Score"));
    assert.ok(predictions.includes("(below the base-rate baseline)"));
  });

  it("the forecast is a field: a trial number, or the reason there is none (F7)", () => {
    assert.ok(predictions.includes("actionResult.forecast"));
    assert.ok(predictions.includes("fc.masteryTrial"));
    assert.ok(predictions.includes("fc.note"));
    assert.ok(!predictions.includes("String(fitObj.predictedMasteryTrial)"), "the panel no longer scrapes the raw fit object");
  });
});

describe("S-MC-4/6 — journal: evidence content, honest filters, full evaluations", () => {
  it("evidence rows author content, and content alone keeps an item (F9)", () => {
    assert.ok(journal.includes('placeholder="The evidence itself — a note or a link"'));
    assert.ok(journal.includes("e.strength.trim() !== '' || e.text.trim() !== ''"));
    assert.ok(journal.includes("...(e.text.trim() !== '' ? { text: e.text.trim() } : {})"));
  });

  it("the journal loads whole and filters client-side, with filter-aware empty states (F20)", () => {
    assert.ok(journal.includes("lensRun('metacognition', 'journalList', {})"));
    assert.ok(journal.includes("visibleDecisions"));
    assert.ok(journal.includes("No open decisions — everything logged here is resolved."));
    assert.ok(journal.includes("No resolved decisions yet — resolve a decision and it will appear under this filter."));
  });

  it("every evaluated bias pattern renders, cleared ones included", () => {
    assert.ok(journal.includes("evaluations?: BiasEvaluation[]"));
    assert.ok(journal.includes("Every pattern, evaluated"));
    assert.ok(journal.includes("evaluated on {ev.decisionsAnalyzed} decision"));
  });

  it("mutations announce the record change other panels derive from (F8)", () => {
    assert.ok(journal.includes("window.dispatchEvent(new Event('metacognition:record-changed'))"));
    assert.ok(journal.includes("afterMutation"));
    assert.ok(reflection.includes("window.dispatchEvent(new Event('metacognition:record-changed'))"));
    assert.ok(accuracy.includes("window.addEventListener('metacognition:record-changed', onRecordChanged)"));
    assert.ok(accuracy.includes("window.removeEventListener('metacognition:record-changed', onRecordChanged)"));
  });
});

describe("deletes confirm in place; view switches keep panel state", () => {
  it("prediction delete is two-step and routes through the desk mutation (F15)", () => {
    assert.ok(desk.includes("lensRun('metacognition', 'prediction_delete', { predictionId: id })"));
    assert.ok(predictions.includes("confirmDeleteId"));
    assert.ok(predictions.includes("Delete?"));
    assert.ok(predictions.includes("deletePrediction.mutate(id"));
  });

  it("journal delete is two-step; the delete call fires only from the confirm (F16)", () => {
    assert.ok(journal.includes("confirmDeleteId"));
    assert.ok(journal.includes("Delete?"));
    assert.ok(journal.includes("onClick={() => remove(d.id)}"));
    assert.ok(!journal.includes("onClick={() => remove(d.id)}\n                        className=\"p-1 text-gray-400"), "no one-click delete remains on the row");
  });

  it("visited views stay mounted and hidden instead of unmounting (F17)", () => {
    assert.ok(page.includes("const [visited, setVisited] = useState<MetacogView[]>(['awareness'])"));
    assert.ok(page.includes("hidden={!on}"));
    assert.ok(page.includes("const goTo = (v: MetacogView) => {"));
    assert.ok(!page.includes("<section key={active}"), "the unmounting single-section render is gone");
  });
});
