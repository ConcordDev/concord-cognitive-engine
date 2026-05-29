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
