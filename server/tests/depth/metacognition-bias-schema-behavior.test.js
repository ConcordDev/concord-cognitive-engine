// tests/depth/metacognition-bias-schema-behavior.test.js — REAL behavioral
// tests closing docs/WAVE4_INVENTORY.md line 248 / metacognition-capability-map.md
// ("biasDetection has no real data source — journal schema lacks per-option
// score/evidence fields").
//
// Three things are pinned:
//   1. journalLog's options field now accepts EITHER a flat string (legacy —
//      byte-identical persisted behavior to before this change) OR a richer
//      { name, score?, evidence?: [{supports, strength}] } object shape, plus
//      optional top-level chosen/initialAnchor/investedCost fields.
//   2. Malformed rich input (non-numeric score, non-boolean supports,
//      non-numeric strength, non-numeric anchor/investedCost) is honestly
//      REJECTED with a clear error — never silently coerced into a shape
//      that would poison the bias math with NaN.
//   3. journalBiasDetection (the new adapter macro) feeds a caller's real,
//      persisted journal entries into computeBiasReport/biasDetection's real
//      anchoring/confirmation/sunk-cost math and finds a real, data-grounded
//      pattern in a deliberately-constructed biased journal — not a canned
//      report.
//
// Isolated DB via a unique DB_PATH so this file never collides with a
// parallel test run (per the project's established depth-test convention).

import { randomUUID } from "node:crypto";
process.env.DB_PATH = process.env.DB_PATH || `/tmp/metacognition-bias-schema-${process.pid}-${Date.now()}.db`;

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("metacognition — journalLog backward compatibility (legacy flat-string options)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`metacog-bias-legacy-${randomUUID()}`); });

  it("a plain string options array still logs, lists, and resolves correctly", async () => {
    const log = await lensRun("metacognition", "journalLog", {
      params: {
        title: "Pick a vendor",
        confidence: 0.6,
        options: ["Keep the incumbent", "Switch to the new vendor", "  ", ""],
      },
    }, ctx);
    assert.equal(log.result.ok, undefined); // no { ok:false } — real success
    assert.equal(log.result.decision.title, "Pick a vendor");
    // Legacy strings normalize to the shape biasDetection can read without
    // crashing (name/score/evidence), blanks are dropped exactly as before.
    assert.deepEqual(log.result.decision.options, [
      { name: "Keep the incumbent", score: null, evidence: [] },
      { name: "Switch to the new vendor", score: null, evidence: [] },
    ]);
    // No chosen/initialAnchor/investedCost were supplied — keys must be
    // fully ABSENT (not null), so computeBiasReport's `!== undefined` gates
    // correctly exclude this decision from anchoring/sunk-cost analysis.
    assert.equal("chosen" in log.result.decision, false);
    assert.equal("initialAnchor" in log.result.decision, false);
    assert.equal("investedCost" in log.result.decision, false);

    const id = log.result.decision.id;
    const list = await lensRun("metacognition", "journalList", {}, ctx);
    const found = list.result.decisions.find((d) => d.id === id);
    assert.ok(found, "legacy-shaped decision lists back out");

    const resolved = await lensRun("metacognition", "journalResolve", {
      params: { id, actualOutcome: "Kept the incumbent", correct: true },
    }, ctx);
    assert.equal(resolved.result.decision.status, "resolved");
    assert.equal(resolved.result.decision.correct, true);
  });

  it("a decision logged with no options at all is unaffected (pre-existing fast path)", async () => {
    const log = await lensRun("metacognition", "journalLog", {
      params: { title: "Order lunch", confidence: 0.9 },
    }, ctx);
    assert.deepEqual(log.result.decision.options, []);
  });

  it("simulated pre-migration entry (raw string[] options, no rich fields at all) survives list + journalBiasDetection without crashing", async () => {
    // journalLog always normalizes going forward, so to genuinely exercise
    // "an entry that predates this change" we inject the OLD raw shape
    // directly into the same in-memory store journalLog/journalList read,
    // exactly as a real pre-upgrade decision would sit in STATE.
    const { load } = await import("./_harness.js");
    const { STATE } = await load();
    // Ensure the lazy per-user substrate exists via the normal code path
    // (getMetaState/mcDecisions) rather than hand-rolling its shape here.
    await lensRun("metacognition", "journalList", {}, ctx);
    const m = STATE.metacognitionLens;
    const userId = ctx.actor.userId;
    if (!m.decisions.has(userId)) m.decisions.set(userId, []);
    m.decisions.get(userId).push({
      id: "dec_legacy_premigration",
      title: "Old-shape entry",
      context: "",
      predictedOutcome: "",
      confidence: 0.5,
      domain: "general",
      options: ["Option A", "Option B"], // pre-migration: raw strings, not {name,score,evidence}
      biasChecks: [],
      status: "open",
      actualOutcome: null,
      correct: null,
      reflection: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      // no chosen / initialAnchor / investedCost keys at all
    });

    const list = await lensRun("metacognition", "journalList", {}, ctx);
    const legacy = list.result.decisions.find((d) => d.id === "dec_legacy_premigration");
    assert.ok(legacy, "raw pre-migration shape lists back out unchanged");
    assert.deepEqual(legacy.options, ["Option A", "Option B"]);

    // Must not throw, and must not fabricate a bias finding out of a
    // structurally-incomplete legacy entry.
    const bias = await lensRun("metacognition", "journalBiasDetection", {}, ctx);
    assert.equal(bias.result.ok, undefined);
    assert.ok(Array.isArray(bias.result.biases));
  });
});

describe("metacognition — journalLog rich option validation (honest rejection)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`metacog-bias-validate-${randomUUID()}`); });

  it("a rich option round-trips score + evidence exactly", async () => {
    const log = await lensRun("metacognition", "journalLog", {
      params: {
        title: "Approve the redesign",
        confidence: 0.5,
        chosen: "Redesign",
        initialAnchor: 7,
        investedCost: 1200,
        options: [
          { name: "Redesign", score: 8, evidence: [{ supports: true, strength: 6 }, { supports: false, strength: 2 }] },
          { name: "Keep current", score: 9 },
        ],
      },
    }, ctx);
    assert.equal(log.result.ok, undefined);
    const d = log.result.decision;
    assert.equal(d.chosen, "Redesign");
    assert.equal(d.initialAnchor, 7);
    assert.equal(d.investedCost, 1200);
    assert.deepEqual(d.options, [
      { name: "Redesign", score: 8, evidence: [{ supports: true, strength: 6 }, { supports: false, strength: 2 }] },
      { name: "Keep current", score: 9, evidence: [] },
    ]);
  });

  it("rejects a non-numeric option score instead of coercing it", async () => {
    const bad = await lensRun("metacognition", "journalLog", {
      params: { title: "Bad score", options: [{ name: "X", score: "high" }] },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /score must be a finite number/);
  });

  it("rejects evidence.supports that isn't a boolean", async () => {
    const bad = await lensRun("metacognition", "journalLog", {
      params: { title: "Bad evidence", options: [{ name: "X", evidence: [{ supports: "yes", strength: 3 }] }] },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /supports must be a boolean/);
  });

  it("rejects a non-numeric evidence.strength", async () => {
    const bad = await lensRun("metacognition", "journalLog", {
      params: { title: "Bad strength", options: [{ name: "X", evidence: [{ supports: true, strength: "lots" }] }] },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /strength must be a finite number/);
  });

  it("rejects an option with no name", async () => {
    const bad = await lensRun("metacognition", "journalLog", {
      params: { title: "No name", options: [{ score: 5 }] },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /requires a non-empty name/);
  });

  it("rejects a non-numeric initialAnchor", async () => {
    const bad = await lensRun("metacognition", "journalLog", {
      params: { title: "Bad anchor", initialAnchor: "who knows" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /initialAnchor must be a finite number/);
  });

  it("rejects a non-numeric investedCost", async () => {
    const bad = await lensRun("metacognition", "journalLog", {
      params: { title: "Bad cost", investedCost: {} },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /investedCost must be a finite number/);
  });

  it("evidence must be an array, not a bare object", async () => {
    const bad = await lensRun("metacognition", "journalLog", {
      params: { title: "Bad evidence shape", options: [{ name: "X", evidence: { supports: true, strength: 1 } }] },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /evidence must be an array/);
  });
});

describe("metacognition — journalBiasDetection: real bias math over a deliberately-biased journal", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`metacog-bias-detect-${randomUUID()}`); });

  it("empty journal returns the honest no-data message, not a fabricated report", async () => {
    const r = await lensRun("metacognition", "journalBiasDetection", {}, ctx);
    assert.equal(r.result.ok, undefined);
    assert.match(r.result.message, /No decision data/);
  });

  it("a two-decision journal deliberately engineered for anchoring + confirmation + sunk-cost bias is actually detected", async () => {
    // Decision 1: chosen option scores far below the best option, its score
    // sits right on top of the stated anchor, its supporting evidence is
    // vastly stronger-weighted than its contradicting evidence, and it was
    // chosen despite heavy prior investment.
    await lensRun("metacognition", "journalLog", {
      params: {
        title: "Continue the legacy vendor contract",
        confidence: 0.55,
        chosen: "Renew legacy vendor",
        initialAnchor: 3,
        investedCost: 500,
        options: [
          { name: "Switch to new vendor", score: 9, evidence: [] },
          {
            name: "Renew legacy vendor", score: 3,
            evidence: [{ supports: true, strength: 9 }, { supports: false, strength: 1 }],
          },
        ],
      },
    }, ctx);

    // Decision 2: same pattern — chosen option anchored, one-sided evidence
    // (no contradicting evidence at all), chosen despite high sunk cost.
    await lensRun("metacognition", "journalLog", {
      params: {
        title: "Keep funding the failing project",
        confidence: 0.6,
        chosen: "Keep funding it",
        initialAnchor: 2,
        investedCost: 400,
        options: [
          { name: "Cut losses now", score: 9, evidence: [] },
          { name: "Keep funding it", score: 2, evidence: [{ supports: true, strength: 7 }] },
        ],
      },
    }, ctx);

    const r = await lensRun("metacognition", "journalBiasDetection", {}, ctx);
    assert.equal(r.result.ok, undefined); // real success, not an { ok:false } error envelope
    assert.equal(r.result.decisionsAnalyzed, 2);
    assert.equal(r.result.biasesDetected, 3);

    const anchoring = r.result.biases.find((b) => b.type === "anchoring");
    assert.ok(anchoring, "anchoring bias detected from real journal data");
    assert.equal(anchoring.anchoringRate, 1); // both decisions' chosen score sat on the anchor
    assert.equal(anchoring.severity, "high");

    const confirmation = r.result.biases.find((b) => b.type === "confirmation_bias");
    assert.ok(confirmation, "confirmation bias detected from real journal data");
    assert.equal(confirmation.biasRate, 0.75); // (0.5 + 1) / 2, per computeBiasReport's own math
    assert.equal(confirmation.severity, "high");

    const sunkCost = r.result.biases.find((b) => b.type === "sunk_cost");
    assert.ok(sunkCost, "sunk-cost bias detected from real journal data");
    assert.equal(sunkCost.sunkCostRate, 1); // both chosen options were worse AND heavily invested
    assert.equal(sunkCost.severity, "high");

    // Overall bias index: 3 biases, all severity "high" (weight 3) → 9/9 = 1.
    assert.equal(r.result.biasIndex, 1);
    assert.equal(r.result.riskLevel, "high");
    assert.ok(r.result.recommendations.length === 3);
    assert.ok(r.result.recommendations.some((x) => x.includes("anchor")));
    assert.ok(r.result.recommendations.some((x) => x.includes("disconfirming")));
    assert.ok(r.result.recommendations.some((x) => x.includes("expected value")));
  });

  it("the raw biasDetection macro (caller-supplied decisions) produces byte-identical math to the adapter", async () => {
    // Confirms computeBiasReport is genuinely shared, not two divergent copies.
    const viaAdapter = await lensRun("metacognition", "journalBiasDetection", {}, ctx);
    const { load } = await import("./_harness.js");
    const { STATE } = await load();
    const m = STATE.metacognitionLens;
    const decisions = m.decisions.get(ctx.actor.userId);
    const viaRaw = await lensRun("metacognition", "biasDetection", { data: { decisions } });
    assert.deepEqual(viaRaw.result, viaAdapter.result);
  });
});
