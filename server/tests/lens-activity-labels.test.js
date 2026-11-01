/**
 * Unit tests for the Activity labelling layer (lib/lens-activity-labels.js).
 *
 * The #1906 re-sitting on PR #1910 failed 8 of 12 legs in the
 * label/object layer, not the recorder: camelCase actions rendered as
 * raw tool names, objects sat under leg-specific keys the generic
 * probe never looked at, and read dispatches flooded the feed until
 * real rows rotated out of the panel. These tests pin the table's
 * answers for exactly those legs. Run:
 *   node --test tests/lens-activity-labels.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  humanizeLensAction,
  isQuietLensAction,
  lensActivityLabel,
  lensActivityObject,
} from "../lib/lens-activity-labels.js";

describe("humanizeLensAction — no raw tool names", () => {
  it("splits camelCase", () => {
    assert.equal(humanizeLensAction("registerMonitor"), "register monitor");
    assert.equal(humanizeLensAction("sessionLog"), "session log");
    assert.equal(humanizeLensAction("distractionLog"), "distraction log");
    assert.equal(humanizeLensAction("deleteComputation"), "delete computation");
    assert.equal(humanizeLensAction("journalPrompts"), "journal prompts");
  });
  it("keeps the already-passing hyphenated forms identical", () => {
    assert.equal(humanizeLensAction("dataset-register"), "dataset register");
    assert.equal(humanizeLensAction("map-create"), "map create");
    assert.equal(humanizeLensAction("connector-upsert"), "connector upsert");
    assert.equal(humanizeLensAction("pain-create"), "pain create");
    assert.equal(humanizeLensAction("checkin"), "checkin");
  });
});

describe("lensActivityLabel — overrides where the tool name is not the action", () => {
  it("cognition's create is its exportTrace dispatch", () => {
    assert.equal(lensActivityLabel("cognition", "exportTrace"), "trace create");
  });
  it("root rows name the computation", () => {
    assert.equal(lensActivityLabel("root", "save"), "computation save");
    assert.equal(lensActivityLabel("root", "deleteComputation"), "computation delete");
  });
  it("everything else humanizes", () => {
    assert.equal(lensActivityLabel("invariant", "registerMonitor"), "register monitor");
    assert.equal(lensActivityLabel("meditation", "sessionLog"), "session log");
  });
});

describe("lensActivityObject — the re-sitting's failing legs", () => {
  it("Attention: the distraction text is input.source", () => {
    assert.equal(
      lensActivityObject("attention", "distractionLog", { source: "PR3 distraction", kind: "Person" }, {}),
      "PR3 distraction",
    );
  });
  it("Commonsense: ask names the question; a finding names its question", () => {
    assert.equal(
      lensActivityObject("commonsense", "check-ask", { question: "Can it appear?" }, {}),
      "Can it appear?",
    );
    assert.equal(
      lensActivityObject("commonsense", "check-finding", { id: "ck1", finding: "Obvious" }, { check: { question: "Can it appear?" } }),
      "Can it appear?",
    );
  });
  it("Inference: adds compose the fact, from either call shape", () => {
    assert.equal(
      lensActivityObject("inference", "kb-add", { subject: "tok", predicate: "is", object: "a token" }, {}),
      "tok is a token",
    );
    assert.equal(
      lensActivityObject("inference", "kb-add", { text: "parent(tom, bob)\nparent(bob, ann)" }, {}),
      "parent(tom, bob)",
    );
  });
  it("Inference: a remove names the removed fact", () => {
    assert.equal(
      lensActivityObject("inference", "kb-remove", { id: "f1" }, { removedEntry: { subject: "tok", predicate: "is", object: "a token" } }),
      "tok is a token",
    );
    assert.equal(
      lensActivityObject("inference", "kb-remove", { id: "f1" }, { removedEntry: { predicate: "is", args: ["tok", "a token"] } }),
      "tok is a token",
    );
  });
  it("Root: save and delete name the computation by its label", () => {
    assert.equal(
      lensActivityObject("root", "save", {}, { computation: { label: "47 + 0" } }),
      "47 + 0",
    );
    assert.equal(
      lensActivityObject("root", "deleteComputation", { id: "rc1" }, { computation: { label: "47 + 0" } }),
      "47 + 0",
    );
  });
  it("Meditation: the object is goal and length, never the track", () => {
    const withGoal = lensActivityObject(
      "meditation", "sessionLog",
      { trackId: "med-focus-3-0", title: "Single-pointed attention", goal: "focus", minutes: 3 },
      { entry: { goal: "focus", durationMin: 3, title: "Single-pointed attention" } },
    );
    assert.equal(withGoal, "Focus · 3 min");
    const noGoal = lensActivityObject(
      "meditation", "sessionLog",
      { title: "Single-pointed attention", minutes: 5 },
      { entry: { durationMin: 5, title: "Single-pointed attention" } },
    );
    assert.equal(noGoal, "5 min");
  });
  it("UX Suite: prop rows name the component", () => {
    assert.equal(
      lensActivityObject("ux-suite", "save-props", { component: "AccessibilityPanel", props: {} }, {}),
      "AccessibilityPanel",
    );
    assert.equal(
      lensActivityObject("ux-suite", "reset-props", { component: "AccessibilityPanel" }, {}),
      "AccessibilityPanel",
    );
  });
  it("Reasoning: a map delete names the removed map", () => {
    assert.equal(
      lensActivityObject("reasoning", "map-delete", { mapId: "m1" }, { map: { title: "PR3 map" } }),
      "PR3 map",
    );
  });
  it("Cognition: a trace names its title", () => {
    assert.equal(
      lensActivityObject("cognition", "exportTrace", { title: "PR3 trace" }, {}),
      "PR3 trace",
    );
  });
  it("a spec that finds nothing stays action-only (no generic override)", () => {
    // The generic probe would find the track title here; the
    // meditation spec must not let it.
    const v = lensActivityObject(
      "meditation", "sessionLog",
      { title: "Single-pointed attention" },
      { entry: { title: "Single-pointed attention" } },
    );
    assert.equal(v, "");
  });
  it("unspec'd actions keep the generic probe", () => {
    assert.equal(
      lensActivityObject("ml", "experiment-start", { name: "DiagExp" }, {}),
      "DiagExp",
    );
  });
});

describe("isQuietLensAction — read traffic writes no rows", () => {
  it("quiets the observed floods", () => {
    for (const [d, a] of [
      ["commonsense", "check-detail"], ["commonsense", "check-list"],
      ["cognition", "getExport"], ["cognition", "listExports"],
      ["inference", "kb-list"], ["attention", "peakHours"],
      ["invariant", "listMonitors"], ["meditation", "pickTrack"],
      ["ux-suite", "catalog"], ["ml", "dataset-list"],
      ["reasoning", "map-list"], ["affect", "checkinHistory"],
      ["suffering", "pain-list"], ["transfer", "connector-list"],
      ["root", "history"],
    ]) {
      assert.equal(isQuietLensAction(d, a), true, `${d}/${a} should be quiet`);
    }
  });
  it("never quiets a write", () => {
    for (const [d, a] of [
      ["commonsense", "check-ask"], ["commonsense", "check-finding"],
      ["inference", "kb-add"], ["inference", "kb-remove"],
      ["attention", "distractionLog"], ["meditation", "sessionLog"],
      ["ux-suite", "save-props"], ["ml", "dataset-register"],
      ["reasoning", "map-delete"], ["affect", "checkin"],
      ["suffering", "pain-create"], ["root", "save"],
    ]) {
      assert.equal(isQuietLensAction(d, a), false, `${d}/${a} must record`);
    }
  });
});
