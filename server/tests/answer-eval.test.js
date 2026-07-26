/**
 * answer-eval — RAGAS-shaped answer evaluation harness (V1.1 R3).
 *
 * Deterministic-only: no brain/Ollama reachable in this environment, so every
 * assertion below exercises the DETERMINISTIC floor (keyword-overlap
 * entailment + citation-resolution floor). The opt-in LLM paths
 * (useLLMDecompose / useLLMEntailment) are exercised live with brains up —
 * not pinned here, same convention as reason-verify.test.js's council layer.
 *
 * Fixed micro-corpus, three honesty-critical scenarios:
 *   (a) fully-grounded answer + supporting retrieved DTUs -> high faithfulness
 *   (b) fabricated/contradicted answer vs the SAME retrieved DTUs -> flagged
 *   (c) zero retrieved context -> honest "unverified", never fake-grounded
 *
 * Run: node --test server/tests/answer-eval.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  decomposeIntoClaims,
  scoreEntailment,
  computeFaithfulness,
  computeAnswerRelevancy,
  computeContextPrecision,
  evaluateAnswer,
  toCapabilityVerdict,
} from "../lib/research/answer-eval.js";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT, data TEXT, lens_id TEXT, created_at TEXT);`);
  const ins = db.prepare(`INSERT INTO dtus (id, type, title, creator_id, data) VALUES (?, ?, ?, ?, ?)`);
  ins.run("dtu_photo_1", "note", "Photosynthesis basics", "u1", "Photosynthesis converts light energy into chemical energy stored in glucose. Chlorophyll absorbs light in the chloroplast.");
  ins.run("dtu_photo_2", "note", "Oxygen byproduct", "u1", "The process of photosynthesis releases oxygen as a byproduct from splitting water molecules.");
  ins.run("dtu_unrelated", "note", "Unrelated topic", "u1", "The stock market closed higher today amid trade talk optimism.");
  ins.run("dtu_personal", "note", "Private", "u1", '{"scope":"personal"}');
  return db;
}

// Retrieved-context corpus shared by the grounded/contradicted scenarios —
// same context, different answer, so the CONTRAST is the test.
const RETRIEVED_CONTEXT = [
  { id: "dtu_photo_1", title: "Photosynthesis basics", data: "Photosynthesis converts light energy into chemical energy stored in glucose. Chlorophyll absorbs light in the chloroplast." },
  { id: "dtu_photo_2", title: "Oxygen byproduct", data: "The process of photosynthesis releases oxygen as a byproduct from splitting water molecules." },
];

describe("decomposeIntoClaims — deterministic sentence/clause split", () => {
  it("splits multi-sentence answers into atomic claims", () => {
    const claims = decomposeIntoClaims("Photosynthesis converts light into chemical energy. It also releases oxygen as a byproduct.");
    assert.ok(claims.length >= 2, "expected at least 2 atomic claims");
    assert.ok(claims.some((c) => /light into chemical energy/i.test(c)));
    assert.ok(claims.some((c) => /oxygen/i.test(c)));
  });

  it("splits compound clauses joined by conjunctions", () => {
    const claims = decomposeIntoClaims("Chlorophyll absorbs light, and the plant uses that energy to build glucose.");
    assert.ok(claims.length >= 2);
  });

  it("returns the original text as a single claim when nothing splits", () => {
    const claims = decomposeIntoClaims("Photosynthesis");
    assert.deepEqual(claims, ["Photosynthesis"]);
  });

  it("returns an empty array for empty input — never fabricates a claim", () => {
    assert.deepEqual(decomposeIntoClaims(""), []);
    assert.deepEqual(decomposeIntoClaims(null), []);
  });
});

describe("scoreEntailment — deterministic keyword-overlap floor", () => {
  it("entails a claim genuinely supported by the retrieved context", async () => {
    const r = await scoreEntailment(
      "Photosynthesis converts light energy into chemical energy stored in glucose.",
      RETRIEVED_CONTEXT
    );
    assert.equal(r.label, "entailed");
    assert.equal(r.method, "keyword-overlap");
    assert.equal(typeof r.matchedIndex, "number");
  });

  it("flags a negation-mismatched claim against strongly-overlapping context as contradicted", async () => {
    const r = await scoreEntailment(
      "Photosynthesis does not convert light energy into chemical energy stored in glucose.",
      RETRIEVED_CONTEXT
    );
    assert.equal(r.label, "contradicted");
  });

  it("returns neutral for an off-topic claim with low overlap", async () => {
    const r = await scoreEntailment("The stock market rallied on trade optimism.", [RETRIEVED_CONTEXT[0]]);
    assert.equal(r.label, "neutral");
  });

  it("never fabricates entailment with zero retrieved context — honest neutral/unverified", async () => {
    const r = await scoreEntailment("Any claim at all.", []);
    assert.equal(r.label, "neutral");
    assert.equal(r.method, "unverified");
    assert.equal(r.matchedIndex, null);
  });
});

describe("computeFaithfulness — RAGAS aggregate", () => {
  it("scores >0.9 fraction-entailed as grounded", () => {
    const r = computeFaithfulness([{ label: "entailed" }, { label: "entailed" }, { label: "entailed" }, { label: "entailed" }]);
    assert.equal(r.faithfulness, 1);
    assert.equal(r.verdict, "grounded");
  });

  it("any contradicted claim drives the verdict to contradicted regardless of ratio", () => {
    const r = computeFaithfulness([{ label: "entailed" }, { label: "entailed" }, { label: "entailed" }, { label: "contradicted" }]);
    assert.equal(r.verdict, "contradicted");
  });

  it("empty claim list is honestly unverified, not grounded", () => {
    const r = computeFaithfulness([]);
    assert.equal(r.faithfulness, null);
    assert.equal(r.verdict, "unverified");
  });
});

describe("computeAnswerRelevancy / computeContextPrecision", () => {
  it("relevancy is null (not fabricated) with no question", () => {
    const r = computeAnswerRelevancy("", "some answer");
    assert.equal(r.score, null);
    assert.equal(r.method, "unverified");
  });

  it("relevancy scores overlap between question and answer", () => {
    const r = computeAnswerRelevancy("How does photosynthesis work?", "Photosynthesis converts light energy into chemical energy.");
    assert.ok(r.score > 0);
  });

  it("context precision is null with no retrieved context", () => {
    const r = computeContextPrecision([{ label: "entailed", matchedIndex: 0 }], []);
    assert.equal(r.score, null);
  });

  it("context precision counts only chunks actually used by an entailed claim", () => {
    const r = computeContextPrecision(
      [{ label: "entailed", matchedIndex: 0 }, { label: "neutral", matchedIndex: 1 }],
      RETRIEVED_CONTEXT
    );
    assert.equal(r.usedCount, 1);
    assert.equal(r.totalCount, 2);
    assert.equal(r.score, 0.5);
  });
});

describe("evaluateAnswer — full orchestration (deterministic, brains off)", () => {
  let db;
  beforeEach(() => { db = createDb(); });

  it("(a) fully-grounded answer + supporting retrieved DTUs -> high faithfulness / grounded verdict", async () => {
    const answer = "Photosynthesis converts light energy into chemical energy stored in glucose. The process releases oxygen as a byproduct from splitting water molecules.";
    const r = await evaluateAnswer(answer, "How does photosynthesis work?", RETRIEVED_CONTEXT, { db });
    assert.equal(r.ok, true);
    assert.ok(r.faithfulness > 0.9, `expected high faithfulness, got ${r.faithfulness}`);
    assert.equal(r.verdict, "grounded");
    assert.equal(r.faithfulnessBreakdown.contradictedCount, 0);
    assert.equal(r.mode, "deterministic");

    const badge = toCapabilityVerdict(r);
    assert.equal(badge.ok, true);
    assert.equal(badge.verdict, "grounded");
  });

  it("(b) fabricated/contradicted answer vs the SAME retrieved DTUs -> low faithfulness, flagged verdict", async () => {
    const answer = "Photosynthesis does not convert light energy into chemical energy, and it consumes oxygen rather than releasing it.";
    const r = await evaluateAnswer(answer, "How does photosynthesis work?", RETRIEVED_CONTEXT, { db });
    assert.equal(r.ok, true);
    assert.ok(r.faithfulness < 0.9, `expected low faithfulness, got ${r.faithfulness}`);
    assert.equal(r.verdict, "contradicted");
    assert.ok(r.faithfulnessBreakdown.contradictedCount > 0);

    const badge = toCapabilityVerdict(r);
    assert.equal(badge.ok, true);
    // Contradicted maps onto CapabilityBadge's 'refuted' string -> the same
    // red "flagged" tier as a Z3-refuted claim (capabilityTierFor's
    // FLAGGED_VERDICTS set) — never softened into the amber "reasoned" tier.
    assert.equal(badge.verdict, "refuted");
  });

  it("(c) zero retrieved context -> honest 'unverified', never fake-grounded", async () => {
    const answer = "Photosynthesis converts light energy into chemical energy stored in glucose.";
    const r = await evaluateAnswer(answer, "How does photosynthesis work?", [], { db });
    assert.equal(r.ok, true);
    assert.equal(r.verdict, "unverified");
    assert.notEqual(r.verdict, "grounded");
    // Every claim honestly reports it couldn't be checked, not a fabricated entailment.
    assert.ok(r.claims.every((c) => c.label === "neutral" && c.method === "unverified"));
    assert.equal(r.contextPrecision, null);

    const badge = toCapabilityVerdict(r);
    assert.equal(badge.verdict, "unverified");
  });

  it("folds in reason-verify.js's citation-resolution floor — fabricated citation overrides faithfulness verdict", async () => {
    const answer = "Photosynthesis converts light energy into chemical energy stored in glucose.";
    const r = await evaluateAnswer(answer, "How does photosynthesis work?", RETRIEVED_CONTEXT, {
      db,
      citationIds: ["dtu_photo_1", "dtu_DOES_NOT_EXIST"],
      requesterId: "u1",
    });
    assert.equal(r.ok, true);
    assert.ok(r.citation, "expected citation-resolution result to be present");
    assert.equal(r.citation.verdict, "fabricated_citation");
    // Even though the prose itself is well-grounded, a fabricated citation
    // is the strongest honesty signal and overrides the verdict.
    assert.equal(r.verdict, "fabricated_citation");

    const badge = toCapabilityVerdict(r);
    assert.equal(badge.verdict, "fabricated_citation");
    assert.equal(badge.citationsTotal, 2);
    assert.equal(badge.citationsResolved, 1);
    assert.deepEqual(badge.unresolvedIds, ["dtu_DOES_NOT_EXIST"]);
  });

  it("real citations that resolve do not override a grounded verdict", async () => {
    const answer = "Photosynthesis converts light energy into chemical energy stored in glucose.";
    const r = await evaluateAnswer(answer, "How does photosynthesis work?", RETRIEVED_CONTEXT, {
      db,
      citationIds: ["dtu_photo_1", "dtu_photo_2"],
      requesterId: "u1",
    });
    assert.equal(r.citation.verdict, "citations_resolve");
    assert.equal(r.verdict, "grounded");
  });

  it("never throws on empty answer — honest no_answer reason", async () => {
    const r = await evaluateAnswer("", "question", RETRIEVED_CONTEXT, { db });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_answer");
  });

  it("never throws with no db and no citations", async () => {
    const r = await evaluateAnswer("Photosynthesis makes energy from light.", "q?", RETRIEVED_CONTEXT, {});
    assert.equal(r.ok, true);
    assert.equal(r.citation, null);
  });
});

describe("toCapabilityVerdict — adapter honesty", () => {
  it("returns ok:false passthrough for a failed evaluation, never a fake verdict", () => {
    assert.deepEqual(toCapabilityVerdict({ ok: false, reason: "no_answer" }), { ok: false });
    assert.deepEqual(toCapabilityVerdict(null), { ok: false });
  });
});
