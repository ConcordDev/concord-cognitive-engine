/**
 * Tier-2 contract tests for DTU quality scoring math.
 *
 * Locks down the exact formula from server/domains/dtus.js:67-130:
 *   - Content score (0-25): dataFields cap 12.5 + contentLength cap 12.5
 *   - Metadata score  (0-25): tags 8 + status 8 + visibility 4 + tagCount cap 5
 *   - Citation score  (0-25): citationCount/10 capped at 25
 *   - Freshness score (0-25): tiers <1d=25, <7d=20, <30d=15, <90d=10, else=5
 *   - Grade thresholds: A≥90, B≥75, C≥60, D≥40, else F
 *
 * Run: node --test tests/dtu-quality-scoring.test.js
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import registerDtusActions from "../domains/dtus.js";

// Build a minimal fake registry so we can pull the qualityScore handler out
// of the domain module without booting all of server.js.
const handlers = {};
function registerLensAction(domain, name, handler) {
  handlers[`${domain}.${name}`] = handler;
}
before(() => {
  registerDtusActions(registerLensAction);
});

function score(artifact) {
  const fn = handlers["dtus.qualityScore"];
  return fn({}, artifact, {});
}

function withAge(daysAgo, base = {}) {
  const ts = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
  return { updatedAt: ts, ...base };
}

describe("dtus.qualityScore — content score boundaries", () => {
  it("empty data → content score 0", () => {
    const r = score({ id: "d1", data: {}, meta: {}, updatedAt: new Date().toISOString() });
    assert.equal(r.ok, true);
    assert.equal(r.result.breakdown.content, 0);
  });

  it("10 fields + 2000-char payload → content score 25 (cap hit)", () => {
    const data = {};
    for (let i = 0; i < 10; i++) data[`f${i}`] = "x".repeat(200); // ≈ 2000 chars total
    const r = score({ id: "d2", data, meta: {}, updatedAt: new Date().toISOString() });
    assert.equal(r.result.breakdown.content, 25);
  });

  it("3 fields + 600-char payload → content < 25 (sub-cap)", () => {
    const data = { a: "x".repeat(200), b: "x".repeat(200), c: "x".repeat(200) };
    const r = score({ id: "d3", data, meta: {}, updatedAt: new Date().toISOString() });
    assert.ok(r.result.breakdown.content < 25);
    assert.ok(r.result.breakdown.content > 0);
  });
});

describe("dtus.qualityScore — metadata score", () => {
  it("no metadata → 0", () => {
    const r = score({ id: "d4", data: {}, meta: {}, updatedAt: new Date().toISOString() });
    assert.equal(r.result.breakdown.metadata, 0);
  });

  it("tags + non-draft status + visibility + 5+ tags → 25 (cap)", () => {
    const r = score({
      id: "d5", data: {},
      meta: { tags: ["a","b","c","d","e"], status: "published", visibility: "public" },
      updatedAt: new Date().toISOString(),
    });
    assert.equal(r.result.breakdown.metadata, 25);
  });

  it("tags only → 8 + tag-count credit", () => {
    const r = score({
      id: "d6", data: {},
      meta: { tags: ["one"] },
      updatedAt: new Date().toISOString(),
    });
    // 8 (hasTags) + min(1/5, 1)*5 = 8 + 1 = 9
    assert.equal(r.result.breakdown.metadata, 9);
  });

  it("draft status does NOT credit", () => {
    const r = score({
      id: "d7", data: {},
      meta: { tags: ["a"], status: "draft", visibility: "public" },
      updatedAt: new Date().toISOString(),
    });
    // 8 (tags) + 0 (status=draft) + 4 (visibility) + 1 (tagCount/5)*5
    assert.equal(r.result.breakdown.metadata, 13);
  });
});

describe("dtus.qualityScore — citation score", () => {
  it("0 citations → 0", () => {
    const r = score({ id: "d8", data: {}, meta: {}, updatedAt: new Date().toISOString() });
    assert.equal(r.result.breakdown.citations, 0);
  });

  it("10 citations → 25 (cap)", () => {
    const r = score({ id: "d9", data: { citationCount: 10 }, meta: {}, updatedAt: new Date().toISOString() });
    assert.equal(r.result.breakdown.citations, 25);
  });

  it("100 citations → still 25 (caps at 25)", () => {
    const r = score({ id: "d10", data: { citationCount: 100 }, meta: {}, updatedAt: new Date().toISOString() });
    assert.equal(r.result.breakdown.citations, 25);
  });

  it("5 citations → ~13", () => {
    const r = score({ id: "d11", data: { citationCount: 5 }, meta: {}, updatedAt: new Date().toISOString() });
    // 5/10 * 25 = 12.5 → rounded to 13
    assert.equal(r.result.breakdown.citations, 13);
  });

  it("citationCount can come from meta as well", () => {
    const r = score({ id: "d12", data: {}, meta: { citationCount: 10 }, updatedAt: new Date().toISOString() });
    assert.equal(r.result.breakdown.citations, 25);
  });
});

describe("dtus.qualityScore — freshness tiers", () => {
  it("<1 day → 25", () => {
    const r = score({ id: "d13", data: {}, meta: {}, updatedAt: withAge(0).updatedAt });
    assert.equal(r.result.breakdown.freshness, 25);
  });

  it("3 days → 20", () => {
    const r = score({ id: "d14", data: {}, meta: {}, updatedAt: withAge(3).updatedAt });
    assert.equal(r.result.breakdown.freshness, 20);
  });

  it("15 days → 15", () => {
    const r = score({ id: "d15", data: {}, meta: {}, updatedAt: withAge(15).updatedAt });
    assert.equal(r.result.breakdown.freshness, 15);
  });

  it("60 days → 10", () => {
    const r = score({ id: "d16", data: {}, meta: {}, updatedAt: withAge(60).updatedAt });
    assert.equal(r.result.breakdown.freshness, 10);
  });

  it("180 days → 5", () => {
    const r = score({ id: "d17", data: {}, meta: {}, updatedAt: withAge(180).updatedAt });
    assert.equal(r.result.breakdown.freshness, 5);
  });

  it("missing updatedAt falls back to createdAt", () => {
    const r = score({ id: "d18", data: {}, meta: {}, createdAt: withAge(60).updatedAt });
    assert.equal(r.result.breakdown.freshness, 10);
  });

  it("missing both → defaults to Date.now() (fresh)", () => {
    const r = score({ id: "d19", data: {}, meta: {} });
    assert.equal(r.result.breakdown.freshness, 25);
  });
});

describe("dtus.qualityScore — grade thresholds", () => {
  // Build artifacts that hit specific totals to verify each grade boundary.
  function totalScore(opts) {
    return score({
      id: "g",
      data: { citationCount: opts.cit ?? 0 },
      meta: opts.meta ?? {},
      updatedAt: withAge(opts.daysAgo ?? 0).updatedAt,
    }).result.totalScore;
  }

  it("score ≥90 → A", () => {
    // 25 (content via 10 fields × 200 chars) + 25 (full metadata) + 25 (citations) + 25 (freshness)
    const data = {};
    for (let i = 0; i < 10; i++) data[`f${i}`] = "x".repeat(200);
    const r = score({
      id: "ga",
      data: { ...data, citationCount: 50 },
      meta: { tags: ["a","b","c","d","e"], status: "published", visibility: "public" },
      updatedAt: new Date().toISOString(),
    });
    assert.ok(r.result.totalScore >= 90, `expected ≥90, got ${r.result.totalScore}`);
    assert.equal(r.result.grade, "A");
  });

  it("score in [75,90) → B", () => {
    // Drop one component: no citations
    const data = {};
    for (let i = 0; i < 10; i++) data[`f${i}`] = "x".repeat(200);
    const r = score({
      id: "gb",
      data: { ...data },
      meta: { tags: ["a","b","c","d","e"], status: "published", visibility: "public" },
      updatedAt: new Date().toISOString(),
    });
    // 25 + 25 + 0 + 25 = 75 → B
    assert.equal(r.result.totalScore, 75);
    assert.equal(r.result.grade, "B");
  });

  it("score in [60,75) → C", () => {
    // Hit ~60-74: e.g., 25+25+0+15 (fresh 15 days)
    const data = {};
    for (let i = 0; i < 10; i++) data[`f${i}`] = "x".repeat(200);
    const r = score({
      id: "gc",
      data,
      meta: { tags: ["a","b","c","d","e"], status: "published", visibility: "public" },
      updatedAt: withAge(15).updatedAt,
    });
    assert.equal(r.result.totalScore, 65);
    assert.equal(r.result.grade, "C");
  });

  it("score in [40,60) → D", () => {
    // Aim for ~40-59. Build moderate fields + partial meta + small citations
    // + recent freshness. content≈3-12 + metadata=17 + citations=15 (6 cits/10*25)
    // + freshness=20 (3d) ≈ 55, lands in D-range.
    const r = score({
      id: "gd",
      data: { x: "y", citationCount: 6 },
      meta: { tags: ["a"], status: "published", visibility: "public" },
      updatedAt: withAge(3).updatedAt,
    });
    assert.ok(r.result.totalScore >= 40 && r.result.totalScore < 60,
      `expected D-range, got ${r.result.totalScore}`);
    assert.equal(r.result.grade, "D");
  });

  it("score < 40 → F", () => {
    const r = score({ id: "gf", data: {}, meta: {}, updatedAt: withAge(180).updatedAt });
    assert.ok(r.result.totalScore < 40, `expected <40, got ${r.result.totalScore}`);
    assert.equal(r.result.grade, "F");
  });
});

describe("dtus.qualityScore — envelope", () => {
  it("returns the standard {ok, result} envelope", () => {
    const r = score({ id: "e1", data: {}, meta: {}, updatedAt: new Date().toISOString() });
    assert.equal(r.ok, true);
    assert.ok(r.result);
    assert.equal(r.result.dtuId, "e1");
    assert.equal(typeof r.result.totalScore, "number");
    assert.equal(typeof r.result.grade, "string");
    assert.ok(r.result.breakdown);
    assert.equal(typeof r.result.breakdown.content, "number");
    assert.equal(typeof r.result.breakdown.metadata, "number");
    assert.equal(typeof r.result.breakdown.citations, "number");
    assert.equal(typeof r.result.breakdown.freshness, "number");
  });
});
