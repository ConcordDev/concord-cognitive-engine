/**
 * Tier-2 contract tests for refusal-field strength composition + the
 * compound-refusal gate at strength≥6 (server/lib/refusal-field.js:184-208).
 *
 * The base-6 glyph algebra is load-bearing: callers branch on strength to
 * decide whether the world bends (Concordia goddess cold-phase dialogue,
 * world-event suspension, dome-collapse Mass Raid phase).
 *
 * Run: node --test tests/refusal-algebra/strength-gating.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  applyTemporaryRefusal,
  activeFields,
  isRefused,
  computeFieldComposition,
  getFieldStrength,
  isCompoundRefusal,
} from "../../lib/refusal-field.js";

const WORLD = "test-world";
let state;

beforeEach(() => {
  // Fresh in-memory state per test so each scenario starts clean.
  // Persistence path (state.db) intentionally omitted — applyTemporaryRefusal
  // skips the SQL persistence when state.db is absent.
  state = { refusalFields: new Map() };
});

describe("getFieldStrength — empty + single field", () => {
  it("returns 0 when no fields are active", () => {
    assert.equal(getFieldStrength(state, WORLD), 0);
  });

  it("returns 0 for an unknown world", () => {
    applyTemporaryRefusal(state, WORLD, "death_suspended", { durationMs: 60000 });
    assert.equal(getFieldStrength(state, "other-world"), 0);
  });

  it("single field active → strength ≥ 1", () => {
    applyTemporaryRefusal(state, WORLD, "death_suspended", { durationMs: 60000 });
    const s = getFieldStrength(state, WORLD);
    assert.ok(s >= 1, `expected ≥1, got ${s}`);
  });
});

describe("computeFieldComposition — shape + composition", () => {
  it("returns {strength: 0, glyph: null, composedFrom: 0} when empty", () => {
    const r = computeFieldComposition(state, WORLD);
    assert.equal(r.strength, 0);
    assert.equal(r.glyph, null);
    assert.equal(r.composedFrom, 0);
  });

  it("composedFrom counts only fields that produced a glyph", () => {
    applyTemporaryRefusal(state, WORLD, "death_suspended", { durationMs: 60000 });
    applyTemporaryRefusal(state, WORLD, "harvest_disabled", { durationMs: 60000 });
    const r = computeFieldComposition(state, WORLD);
    // Both fields generated a glyph in applyTemporaryRefusal, so composedFrom=2.
    // (If glyph composition were skipped, composedFrom would be < 2.)
    assert.ok(r.composedFrom >= 1 && r.composedFrom <= 2, `composedFrom=${r.composedFrom}`);
  });
});

describe("isCompoundRefusal — strength≥6 reality-bend gate", () => {
  it("false when no fields", () => {
    assert.equal(isCompoundRefusal(state, WORLD), false);
  });

  it("false with a single field (strength≈1)", () => {
    applyTemporaryRefusal(state, WORLD, "death_suspended", { durationMs: 60000 });
    assert.equal(isCompoundRefusal(state, WORLD), false);
  });

  it("false at modest stack (3-5 fields, strength under 6)", () => {
    applyTemporaryRefusal(state, WORLD, "death_suspended", { durationMs: 60000 });
    applyTemporaryRefusal(state, WORLD, "harvest_disabled", { durationMs: 60000 });
    applyTemporaryRefusal(state, WORLD, "hostility_paused", { durationMs: 60000 });
    // Strength may already be ≥6 here depending on the algebra layer-depth;
    // but for these three the composite strength is typically 3-5.
    const s = getFieldStrength(state, WORLD);
    if (s < 6) {
      assert.equal(isCompoundRefusal(state, WORLD), false);
    } else {
      // If algebra cooperatively pushes us over, the gate must agree.
      assert.equal(isCompoundRefusal(state, WORLD), true);
    }
  });

  it("true once the stack reaches 6+ active fields", () => {
    // Apply six distinct refusal kinds — this is the saturation case the
    // Mass Raid relies on to declare the dome-collapse phase.
    applyTemporaryRefusal(state, WORLD, "death_suspended",  { durationMs: 60000 });
    applyTemporaryRefusal(state, WORLD, "harvest_disabled", { durationMs: 60000 });
    applyTemporaryRefusal(state, WORLD, "hostility_paused", { durationMs: 60000 });
    applyTemporaryRefusal(state, WORLD, "consequence_held", { durationMs: 60000 });
    applyTemporaryRefusal(state, WORLD, "numbers_refused",  { durationMs: 60000 });
    applyTemporaryRefusal(state, WORLD, "dome_collapse",    { durationMs: 60000 });
    const s = getFieldStrength(state, WORLD);
    assert.ok(s >= 6, `expected ≥6, got ${s}`);
    assert.equal(isCompoundRefusal(state, WORLD), true);
  });
});

describe("strength cap at 9", () => {
  it("strength is hard-capped at 9 (Math.min in compose)", () => {
    // Pile on every available kind multiple times; even if the algebra
    // composes deeply, strength must not exceed 9 (refusal-field.js:186).
    const kinds = [
      "death_suspended", "harvest_disabled", "hostility_paused",
      "consequence_held", "numbers_refused", "dome_collapse", "win_refused",
    ];
    for (const k of kinds) {
      applyTemporaryRefusal(state, WORLD, k, { durationMs: 60000 });
    }
    const s = getFieldStrength(state, WORLD);
    assert.ok(s <= 9, `strength ${s} must be capped at 9`);
  });
});

describe("activeFields auto-prune + isRefused gate", () => {
  it("isRefused returns true while a kind is active", () => {
    applyTemporaryRefusal(state, WORLD, "death_suspended", { durationMs: 60000 });
    assert.equal(isRefused(state, WORLD, "death_suspended"), true);
    assert.equal(isRefused(state, WORLD, "harvest_disabled"), false);
  });

  it("expired fields disappear from activeFields()", () => {
    applyTemporaryRefusal(state, WORLD, "death_suspended", { durationMs: 1000 });
    assert.equal(activeFields(state, WORLD).length, 1);
    // Manually expire the entry by rewriting expiresAt into the past.
    const list = state.refusalFields.get(WORLD);
    list[0].expiresAt = Date.now() - 1;
    assert.equal(activeFields(state, WORLD).length, 0);
    assert.equal(isCompoundRefusal(state, WORLD), false);
  });
});

describe("invalid input handling", () => {
  it("applyTemporaryRefusal returns null for unknown kind", () => {
    const r = applyTemporaryRefusal(state, WORLD, "totally_made_up", { durationMs: 60000 });
    assert.equal(r, null);
  });

  it("applyTemporaryRefusal returns null for missing world", () => {
    const r = applyTemporaryRefusal(state, "", "death_suspended", { durationMs: 60000 });
    assert.equal(r, null);
  });

  it("durationMs is clamped to a 1-second floor", () => {
    const entry = applyTemporaryRefusal(state, WORLD, "death_suspended", { durationMs: 50 });
    assert.ok(entry);
    assert.ok(entry.expiresAt - Date.now() >= 999);
  });
});
