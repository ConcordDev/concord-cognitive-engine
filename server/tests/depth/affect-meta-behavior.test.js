// tests/depth/affect-meta-behavior.test.js — REAL behavioral tests for affect.detect-patterns
// and meta.classify (lens-audit: both buttons hit no macro until these deterministic
// macros landed; affect returns the exact shape its patternResult panel renders).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

describe("affect.detect-patterns", () => {
  it("surfaces recurring themes, triggers, and cycles from journal entries", async () => {
    const r = await lensRun("affect", "detect-patterns", {
      data: {
        entries: [
          { text: "work stress again, tired", timestamp: "2026-01-01T09:00:00Z" },
          { text: "work deadline, anxious", timestamp: "2026-01-02T09:00:00Z" },
          { text: "family time, happy", timestamp: "2026-01-03T18:00:00Z" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.entryCount, 3);
    assert.ok(r.result.patterns.some((p) => p.theme === "work"), "'work' recurs → a pattern");
    assert.ok(r.result.triggers.some((t) => t.trigger === "work"), "'work' is a trigger");
    assert.ok(Array.isArray(r.result.cycles));
    assert.match(r.result.summary, /3 entries/);
  });
  it("degrades cleanly with no entries", async () => {
    const r = await lensRun("affect", "detect-patterns", { data: { entries: [] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.entryCount, 0);
    assert.deepEqual(r.result.patterns, []);
  });
});

describe("meta.classify", () => {
  it("routes code text to the code domain with confidence", async () => {
    const r = await lensRun("meta", "classify", { params: { text: "refactor this typescript git deploy bug api" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.domain, "code");
    assert.ok(r.result.confidence > 0);
    assert.equal(r.result.matched, true);
  });
  it("routes fitness text to the fitness domain", async () => {
    const r = await lensRun("meta", "classify", { params: { text: "workout at the gym, 5 sets of squats, cardio" } });
    assert.equal(r.result.domain, "fitness");
  });
  it("returns matched:false for unclassifiable text", async () => {
    const r = await lensRun("meta", "classify", { params: { text: "zzz qqq" } });
    assert.equal(r.result.matched, false);
    assert.equal(r.result.domain, null);
  });
  it("rejects empty text", async () => {
    const r = await lensRun("meta", "classify", { params: { text: "  " } });
    assert.equal(r.ok, false);
  });
});
