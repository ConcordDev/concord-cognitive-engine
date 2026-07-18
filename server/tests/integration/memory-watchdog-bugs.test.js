/**
 * Sprint 1 — G2.2 + G2.3 watchdog bug fixes.
 *
 * G2.2: STATE.shadowDtus had a documented cap (CONCORD_MAX_SHADOWS) enforced
 *       only inside ShadowGraph, never on the raw Map → unbounded growth. The
 *       watchdog's _aggressiveEviction now LRU-trims it.
 * G2.3: the heap-limit default was 3584 (vs the documented 32768 deploy).
 *
 * Run: node --test tests/integration/memory-watchdog-bugs.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("G2.2 — shadowDtus is LRU-trimmed by the watchdog", () => {
  it("trims an oversized shadowDtus Map down toward the cap (oldest first)", async () => {
    process.env.CONCORD_MAX_SHADOWS = "100";
    const { _aggressiveEviction } = await import("../../lib/memory-pressure.js?g22");
    const STATE = { sessions: new Map(), shadowDtus: new Map() };
    for (let i = 0; i < 250; i++) STATE.shadowDtus.set(`s${i}`, { id: `s${i}`, n: i });
    assert.equal(STATE.shadowDtus.size, 250);
    _aggressiveEviction(STATE);
    // Trimmed to floor(cap * 0.8) = 80.
    assert.ok(STATE.shadowDtus.size <= 100, `expected <=100, got ${STATE.shadowDtus.size}`);
    assert.equal(STATE.shadowDtus.size, 80);
    // Oldest deleted (insertion order); newest survive.
    assert.equal(STATE.shadowDtus.has("s0"), false);
    assert.equal(STATE.shadowDtus.has("s249"), true);
    delete process.env.CONCORD_MAX_SHADOWS;
  });

  it("leaves a within-cap Map untouched", async () => {
    process.env.CONCORD_MAX_SHADOWS = "1000";
    const { _aggressiveEviction } = await import("../../lib/memory-pressure.js?g22b");
    const STATE = { sessions: new Map(), shadowDtus: new Map() };
    for (let i = 0; i < 50; i++) STATE.shadowDtus.set(`s${i}`, { id: `s${i}` });
    _aggressiveEviction(STATE);
    assert.equal(STATE.shadowDtus.size, 50);
    delete process.env.CONCORD_MAX_SHADOWS;
  });
});

describe("G2.3 — heap-limit default", () => {
  it("defaults to 32768 (the documented deploy), not 3584", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync(new URL("../../lib/memory-pressure.js", import.meta.url), "utf8"));
    assert.match(src, /MAX_OLD_SPACE_SIZE \|\| 32768/);
    assert.doesNotMatch(src, /MAX_OLD_SPACE_SIZE \|\| 3584/);
  });
});

// Emergent load-hardening — STATE.qualia (the QualiaEngine per-entity store) was
// the last unbounded Map in the watchdog list: per-state history capped
// (HISTORY_MAX=50) but the NUMBER of states uncapped. Under high-volume qualia
// hooks (a state per entity/DTU) it grows without bound → OOM. Now LRU-trimmed
// like shadowDtus. Eviction is safe: the engine returns entity_not_found/null
// for an evicted id and recreates on the next hook.
describe("emergent — qualia state Map is LRU-trimmed by the watchdog", () => {
  it("trims an oversized STATE.qualia Map toward the cap (oldest first)", async () => {
    process.env.CONCORD_MAX_QUALIA_STATES = "100";
    const { _aggressiveEviction } = await import("../../lib/memory-pressure.js?q1");
    const STATE = { sessions: new Map(), qualia: new Map() };
    for (let i = 0; i < 250; i++) STATE.qualia.set(`e${i}`, { entityId: `e${i}`, channels: {} });
    assert.equal(STATE.qualia.size, 250);
    _aggressiveEviction(STATE);
    assert.equal(STATE.qualia.size, 80); // floor(cap * 0.8)
    assert.equal(STATE.qualia.has("e0"), false); // oldest evicted
    assert.equal(STATE.qualia.has("e249"), true); // newest survive
    delete process.env.CONCORD_MAX_QUALIA_STATES;
  });

  it("leaves a within-cap qualia Map untouched", async () => {
    process.env.CONCORD_MAX_QUALIA_STATES = "1000";
    const { _aggressiveEviction } = await import("../../lib/memory-pressure.js?q2");
    const STATE = { sessions: new Map(), qualia: new Map() };
    for (let i = 0; i < 50; i++) STATE.qualia.set(`e${i}`, { entityId: `e${i}` });
    _aggressiveEviction(STATE);
    assert.equal(STATE.qualia.size, 50);
    delete process.env.CONCORD_MAX_QUALIA_STATES;
  });

  it("the watchdog cap list actually includes qualia", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync(new URL("../../lib/memory-pressure.js", import.meta.url), "utf8"));
    assert.match(src, /\["qualia", Number\(process\.env\.CONCORD_MAX_QUALIA_STATES\)/);
  });
});
