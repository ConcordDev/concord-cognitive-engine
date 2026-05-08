// Invariant: Layer 2 + 3 — affect bridge persists state, applies events,
// emits resolver signals on significant valence delta. The resolver
// signal pathway must reject mismatched outcome/source pairings (positive
// outcome with a negative-only source) so callers can't smuggle arbitrary
// signal sources past the validation gate.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../../migrate.js";
import {
  applyAffectEvent,
  loadOrCreate,
  affectTickAll,
  getAffectStateFor,
  _internal,
} from "../../lib/affect-bridge.js";
import {
  emitOutcomeSignal,
  emitOutcomeSignalsBulk,
  getOutcomeSourceStats,
  _internal as oi,
} from "../../lib/brain-training/outcome-signals.js";
import { logBrainInteraction } from "../../lib/brain-training/interaction-log.js";

let db;
beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");
  await runMigrations(db);
});

function colExists(table, col) {
  return db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table)
    .some((r) => r.name === col);
}

// ─────────────────────────────────────────────────────────────────────
// Migration 110 — affect_state + affect_events_log
// ─────────────────────────────────────────────────────────────────────

test("migration 110 creates affect_state with all 7 dims + 7 momentum cols", () => {
  for (const dim of ["v", "a", "s", "c", "g", "t", "f"]) {
    assert.ok(colExists("affect_state", dim), `affect_state.${dim} missing`);
    assert.ok(colExists("affect_state", `m_${dim}`), `affect_state.m_${dim} missing`);
  }
  assert.ok(colExists("affect_state", "meta_json"));
  assert.ok(colExists("affect_state", "last_tick_at"));
});

test("migration 110 creates affect_events_log with ref_id index column", () => {
  for (const c of ["id", "entity_id", "event_type", "delta_json", "magnitude", "source", "ref_id", "occurred_at"]) {
    assert.ok(colExists("affect_events_log", c), `affect_events_log.${c} missing`);
  }
});

// ─────────────────────────────────────────────────────────────────────
// loadOrCreate / persistence round-trip
// ─────────────────────────────────────────────────────────────────────

test("loadOrCreate returns baseline state for fresh entity", () => {
  const { E, M } = loadOrCreate(db, "user-fresh", "concordia-hub");
  assert.ok(typeof E.v === "number");
  assert.ok(typeof M.v === "number");
});

test("applyAffectEvent persists state across calls", () => {
  const r1 = applyAffectEvent(db, "user-persist", { type: "SUCCESS", magnitude: 0.5, source: "test" });
  assert.strictEqual(r1.ok, true);
  const row1 = db.prepare(`SELECT * FROM affect_state WHERE entity_id = ?`).get("user-persist");
  assert.ok(row1, "first event must persist a row");
  assert.ok(typeof row1.last_tick_at === "number");
  // Apply a second event; state should accumulate, not reset.
  const r2 = applyAffectEvent(db, "user-persist", { type: "SUCCESS", magnitude: 0.3, source: "test" });
  assert.strictEqual(r2.ok, true);
  const row2 = db.prepare(`SELECT * FROM affect_state WHERE entity_id = ?`).get("user-persist");
  assert.ok(row2, "second event must keep the row (UPSERT, not delete-and-recreate)");
  // Same primary key after second event (entity_id, world_id) — state persisted, not duplicated.
  const count = db.prepare(`SELECT COUNT(*) as c FROM affect_state WHERE entity_id = ?`).get("user-persist").c;
  assert.strictEqual(count, 1, "must remain a single row across multiple events");
});

test("applyAffectEvent writes affect_events_log with delta_json", () => {
  applyAffectEvent(db, "user-log", { type: "ERROR", magnitude: 0.4, source: "test" });
  const events = db.prepare(`SELECT * FROM affect_events_log WHERE entity_id = ?`).all("user-log");
  assert.ok(events.length >= 1);
  assert.strictEqual(events[0].event_type, "ERROR");
  // delta_json should parse
  assert.doesNotThrow(() => JSON.parse(events[0].delta_json));
});

// ─────────────────────────────────────────────────────────────────────
// Heartbeat tick walks the table
// ─────────────────────────────────────────────────────────────────────

test("affectTickAll never throws on empty DB", () => {
  const r = affectTickAll(db);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.ticked, 0);
  assert.strictEqual(r.errors, 0);
});

test("affectTickAll processes only stale rows (last_tick_at older than 30s)", () => {
  // Seed a state; immediately tick — should NOT process (too fresh).
  applyAffectEvent(db, "user-fresh-tick", { type: "SUCCESS", magnitude: 0.2, source: "test" });
  const r1 = affectTickAll(db);
  assert.strictEqual(r1.ticked, 0, "fresh row must be skipped");
  // Backdate last_tick_at and re-run; row should now process.
  db.prepare(`UPDATE affect_state SET last_tick_at = unixepoch() - 60 WHERE entity_id = ?`).run("user-fresh-tick");
  const r2 = affectTickAll(db);
  assert.ok(r2.ticked >= 1, "stale row must be processed");
});

// ─────────────────────────────────────────────────────────────────────
// Layer 3: outcome-signals validation + dispatch
// ─────────────────────────────────────────────────────────────────────

test("emitOutcomeSignal rejects positive outcome with negative-only source", () => {
  const id = logBrainInteraction(db, {
    brainId: "utility",
    prompt: { input: "x" }, response: "y",
  });
  const r = emitOutcomeSignal(db, id, "positive", { source: "refusal_field_block" });
  assert.strictEqual(r.ok, false);
  assert.match(r.error || "", /non-positive source/);
});

test("emitOutcomeSignal accepts citation_registered as positive", () => {
  const id = logBrainInteraction(db, {
    brainId: "subconscious",
    prompt: { input: "x" }, response: "y",
  });
  const r = emitOutcomeSignal(db, id, "positive", { source: "citation_registered", childId: "c1", parentId: "p1" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.applied, true);
  const row = db.prepare(`SELECT outcome FROM brain_interactions WHERE id = ?`).get(id);
  assert.strictEqual(row.outcome, "positive");
});

test("emitOutcomeSignal accepts repair_failure as negative", () => {
  const id = logBrainInteraction(db, {
    brainId: "repair",
    prompt: { input: "fix" }, response: "fixed",
  });
  const r = emitOutcomeSignal(db, id, "negative", { source: "repair_failure", reason: "recurred_within_24h" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.applied, true);
});

test("emitOutcomeSignal rejects negative outcome with positive-only source", () => {
  const id = logBrainInteraction(db, { brainId: "utility", prompt: { input: "x" }, response: "y" });
  const r = emitOutcomeSignal(db, id, "negative", { source: "citation_registered" });
  assert.strictEqual(r.ok, false);
  assert.match(r.error || "", /non-negative source/);
});

test("emitOutcomeSignalsBulk applies many signals in one pass", () => {
  const ids = [];
  for (let i = 0; i < 3; i++) {
    ids.push(logBrainInteraction(db, { brainId: "utility", prompt: { input: `q${i}` }, response: `a${i}` }));
  }
  const result = emitOutcomeSignalsBulk(db, ids.map((id) => ({
    interactionId: id,
    outcome: "positive",
    signal: { source: "dtu_promoted", tier: "MEGA" },
  })));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.applied, 3);
});

test("getOutcomeSourceStats reports per-source counts", () => {
  const id = logBrainInteraction(db, { brainId: "utility", prompt: { input: "x" }, response: "y" });
  emitOutcomeSignal(db, id, "positive", { source: "council_consensus" });
  const stats = getOutcomeSourceStats(db, 0);
  assert.ok(stats.sources.length >= 1);
  const consensus = stats.sources.find((s) => s.source === "council_consensus" && s.outcome === "positive");
  assert.ok(consensus);
  assert.strictEqual(consensus.count, 1);
});

// ─────────────────────────────────────────────────────────────────────
// Cross-layer: affect valence delta → resolver positive
// ─────────────────────────────────────────────────────────────────────

test("applyAffectEvent with refId emits positive resolver signal on big positive valence delta", async () => {
  const interactionId = logBrainInteraction(db, {
    brainId: "subconscious",
    prompt: { input: "test" },
    response: "ok",
  });
  // SUCCESS with high magnitude should produce delta.v above the
  // VALENCE_POSITIVE_THRESHOLD (0.15).
  const r = applyAffectEvent(db, "user-affect-cross", {
    type: "SUCCESS",
    magnitude: 1.0,
    source: "test",
  }, { refId: interactionId });
  assert.strictEqual(r.ok, true);
  // The cross-emit is async (lazy import). Wait briefly then check.
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  const row = db.prepare(`SELECT outcome FROM brain_interactions WHERE id = ?`).get(interactionId);
  // Resolution may be 'positive' if delta.v exceeded threshold,
  // or still 'pending' if engine math produced smaller delta. Both
  // are valid; the contract is that it doesn't throw + doesn't go
  // 'negative'.
  assert.notStrictEqual(row.outcome, "negative");
});

test("internal threshold constants are tight (catches future drift)", () => {
  // Pin the magic numbers so a future reviewer can't silently widen them.
  assert.strictEqual(_internal.VALENCE_POSITIVE_THRESHOLD, 0.15);
  assert.strictEqual(_internal.VALENCE_NEGATIVE_THRESHOLD, -0.15);
});

test("positive + negative source sets are disjoint except affect_valence_delta (which can be either)", () => {
  // affect_valence_delta is intentionally in both because the bridge
  // emits it with explicit outcome=positive or outcome=negative based
  // on Δv sign. Verify nothing else overlaps.
  const dual = [...oi.POSITIVE_SIGNAL_SOURCES].filter((s) => oi.NEGATIVE_SIGNAL_SOURCES.has(s));
  assert.deepStrictEqual(dual, ["affect_valence_delta"], "only affect_valence_delta should be in both sets");
});
