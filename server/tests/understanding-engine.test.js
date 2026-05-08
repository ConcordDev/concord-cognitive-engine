/**
 * Tier-2 contract test for the Understanding engine.
 *
 * The understanding primitive composes DTU.machine layer → HLM topology
 * → HLR constraint reasoning into a typed Understanding artifact. This
 * is the substrate's first discrete `understand(x) → model` macro —
 * pinning its shape so future drift is caught at CI.
 *
 * Run: node --test tests/understanding-engine.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig120 from "../migrations/120_understandings.js";
import {
  parseUnderstanding,
  saveUnderstanding,
  getUnderstanding,
  listUnderstandings,
  recomposeUnderstanding,
  sweepExpiredUnderstandings,
  composeAndSave,
  SUBJECT_KINDS,
} from "../lib/understanding-engine.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  mig120.up(db);
});

afterEach(() => { try { db?.close(); } catch (_) { /* intentional */ } });

// ── Fixtures ──────────────────────────────────────────────────────────────

const dtuWithMachineLayer = {
  id: "dtu_recipe_stance_cold",
  human: { summary: "Stance Against the Cold — fighting style" },
  core: { claims: ["Author is Aria", "Element is frost", "Range is 4 meters"] },
  machine: {
    tags: ["combat", "frost", "stance"],
    claims: [
      { text: "Aria authored stance_cold", confidence: 0.95 },
      { text: "stance_cold has element frost", confidence: 0.95 },
      { text: "stance_cold must require windup before active", confidence: 0.9 },
    ],
  },
};

const dtuWithContradiction = {
  id: "dtu_temp_room",
  machine: {
    claims: [
      { text: "Room is hot", confidence: 0.8 },
      { text: "Room is cold", confidence: 0.7 },
    ],
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("parseUnderstanding — claim ingestion from the DTU template", () => {
  it("extracts machine-layer claims as the dominant source", () => {
    const u = parseUnderstanding({ subjectId: dtuWithMachineLayer.id, dtu: dtuWithMachineLayer });
    assert.equal(u.subjectKind, "dtu");
    const machineSourced = u.claims.filter((c) => c.source === "machine");
    assert.ok(machineSourced.length >= 3, `expected ≥3 machine claims, got ${machineSourced.length}`);
    assert.ok(u.claims.some((c) => /Aria authored stance_cold/.test(c.text)));
  });

  it("falls back to human summary when no core/machine claims present", () => {
    const minimal = { id: "dtu_min", human: { summary: "An empty thought." } };
    const u = parseUnderstanding({ subjectId: minimal.id, dtu: minimal });
    assert.ok(u.claims.length >= 1);
    assert.equal(u.claims[0].source, "human");
  });

  it("accepts raw claim arrays when no DTU is present (subjectKind='claims')", () => {
    const u = parseUnderstanding({
      claims: ["Frost is the dominant element", "Aria authored the stance"],
    });
    assert.equal(u.subjectKind, "claims");
    assert.equal(u.claims.length, 2);
    assert.equal(u.claims[0].source, "raw");
  });

  it("returns an empty-but-valid model for empty input", () => {
    const u = parseUnderstanding({});
    assert.equal(u.consistency, "unknown");
    assert.equal(u.claims.length, 0);
    assert.equal(u.entities.length, 0);
    assert.equal(u.confidence, 0);
  });
});

describe("parseUnderstanding — entity / constraint / relation extraction", () => {
  it("detects entities from capitalised tokens", () => {
    const u = parseUnderstanding({ dtu: dtuWithMachineLayer });
    const labels = u.entities.map((e) => e.label);
    // "Aria" should be detected; sentence-initial tokens like "stance_cold" only when re-mentioned
    assert.ok(labels.includes("Aria"), `entities: ${labels.join(",")}`);
  });

  it("flags 'must' / 'cannot' / 'should' as constraints", () => {
    const u = parseUnderstanding({
      claims: [
        "stance_cold must require windup before active",
        "Players cannot one-shot from cross-map",
        "DTUs should preserve provenance",
      ],
    });
    assert.equal(u.constraints.length, 3);
    const kinds = u.constraints.map((c) => c.kind).sort();
    assert.deepEqual(kinds, ["must", "must-not", "should"]);
  });

  it("extracts simple subject-verb-object relations", () => {
    const u = parseUnderstanding({
      claims: ["Aria authored Stance_Cold"],
    });
    assert.ok(u.relations.length >= 1);
    const rel = u.relations[0];
    assert.equal(rel.from, "Aria");
    assert.equal(rel.to, "Stance_Cold");
  });
});

describe("parseUnderstanding — contradiction + gap + consistency", () => {
  it("flags antonym pairs as contradictions", () => {
    const u = parseUnderstanding({ dtu: dtuWithContradiction });
    assert.ok(u.contradictions.length >= 1, "antonym hot/cold must conflict");
    assert.equal(u.consistency, "inconsistent");
  });

  it("flags direct negations of the same content", () => {
    const u = parseUnderstanding({
      claims: ["The dome is breached", "The dome is not breached"],
    });
    assert.ok(u.contradictions.length >= 1);
    assert.equal(u.consistency, "inconsistent");
  });

  it("surfaces unsatisfied 'must' constraints as gaps", () => {
    const u = parseUnderstanding({
      claims: [
        "The artifact must include a signature",
        // No claim that asserts the artifact has a signature
      ],
    });
    assert.ok(u.gaps.length >= 1);
    assert.equal(u.consistency, "partial");
  });

  it("returns 'consistent' when every claim coheres and every constraint is met", () => {
    const u = parseUnderstanding({
      claims: [
        "Aria authored stance_cold",
        "stance_cold has element frost",
      ],
    });
    assert.equal(u.consistency, "consistent");
    assert.equal(u.contradictions.length, 0);
    assert.equal(u.gaps.length, 0);
  });

  it("confidence drops with contradictions and gaps", () => {
    const baseline = parseUnderstanding({
      claims: ["Aria authored stance_cold", "stance_cold has element frost"],
    });
    const conflicted = parseUnderstanding({
      claims: ["The room is hot", "The room is cold"],
    });
    assert.ok(baseline.confidence > conflicted.confidence);
  });
});

describe("save / get / list — persistence round-trip", () => {
  it("saveUnderstanding satisfies all CHECK constraints on insert", () => {
    const u = parseUnderstanding({ dtu: dtuWithMachineLayer, subjectId: dtuWithMachineLayer.id });
    const r = saveUnderstanding(db, u);
    assert.equal(r.ok, true);
    assert.equal(r.id, u.id);

    const row = db.prepare(`SELECT * FROM understandings WHERE id = ?`).get(u.id);
    assert.ok(row);
    assert.equal(row.subject_id, dtuWithMachineLayer.id);
    assert.equal(row.subject_kind, "dtu");
    assert.ok(["consistent", "inconsistent", "partial", "unknown"].includes(row.consistency));
  });

  it("getUnderstanding rehydrates the full model from JSON columns", () => {
    const u = parseUnderstanding({ claims: ["Aria authored Stance_Cold"] });
    saveUnderstanding(db, u);
    const back = getUnderstanding(db, u.id);
    assert.ok(back);
    assert.equal(back.id, u.id);
    assert.equal(back.subjectKind, "claims");
    assert.deepEqual(back.relations, u.relations);
  });

  it("listUnderstandings returns rows in composed_at desc order", async () => {
    const u1 = parseUnderstanding({ claims: ["First insight"] });
    saveUnderstanding(db, u1);
    // Force a clock tick — composed_at has datetime('now') resolution.
    await new Promise((r) => setTimeout(r, 1100));
    const u2 = parseUnderstanding({ claims: ["Second insight"] });
    saveUnderstanding(db, u2);

    const rows = listUnderstandings(db, { subjectKind: "claims" });
    assert.equal(rows.length, 2);
    // Ordered desc — newest first.
    assert.ok(rows[0].composed_at >= rows[1].composed_at);
  });

  it("rejects an unknown subject_kind via the CHECK constraint", () => {
    const u = parseUnderstanding({ claims: ["test"] });
    u.subjectKind = "bogus";
    const r = saveUnderstanding(db, u);
    assert.equal(r.ok, false);
  });
});

describe("recomposeUnderstanding — re-running the pipeline", () => {
  it("inserts a new understanding and stamps recomposed_at on the prior", () => {
    const u = parseUnderstanding({ subjectId: "dtu_x", claims: ["A is true"] });
    saveUnderstanding(db, u);

    const r = recomposeUnderstanding(db, u.id, { claims: ["A is true", "B follows"] });
    assert.equal(r.ok, true);
    assert.notEqual(r.id, u.id);
    assert.equal(r.supersedes, u.id);

    const prior = db.prepare(`SELECT recomposed_at FROM understandings WHERE id = ?`).get(u.id);
    assert.ok(prior.recomposed_at, "prior row must be stamped");
  });

  it("returns not_found for an unknown id", () => {
    const r = recomposeUnderstanding(db, "und_nonexistent", {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_found");
  });
});

describe("sweepExpiredUnderstandings — TTL cleanup", () => {
  it("deletes rows past their expires_at and leaves fresh rows alone", () => {
    const u = parseUnderstanding({ claims: ["alpha"] });
    saveUnderstanding(db, u, { ttlDays: 30 });
    // Backdate a separate row to be already-expired.
    const oldId = "und_old";
    db.prepare(`
      INSERT INTO understandings (id, subject_kind, model_json, expires_at)
      VALUES (?, 'claims', '{}', datetime('now', '-1 day'))
    `).run(oldId);

    const r = sweepExpiredUnderstandings(db);
    assert.equal(r.ok, true);
    assert.equal(r.deleted, 1);

    const stillThere = db.prepare(`SELECT id FROM understandings WHERE id = ?`).get(u.id);
    assert.ok(stillThere);
  });
});

describe("composeAndSave — single-call convenience", () => {
  it("parses + saves in one call and returns the artifact", () => {
    const r = composeAndSave(db, { subjectId: "dtu_q", claims: ["alpha", "beta"] });
    assert.equal(r.ok, true);
    assert.equal(r.understanding.subjectKind, "claims");
    const back = getUnderstanding(db, r.understanding.id);
    assert.ok(back);
  });

  it("works with no db (returns the artifact, skips persistence)", () => {
    const r = composeAndSave(null, { claims: ["alpha"] });
    assert.equal(r.ok, true);
    assert.ok(r.understanding);
  });
});

describe("SUBJECT_KINDS export — pinned for downstream lens UIs", () => {
  it("exposes the canonical subject-kind list", () => {
    assert.deepEqual(SUBJECT_KINDS, ["dtu", "claims", "raw", "entity", "world", "faction"]);
  });
});
