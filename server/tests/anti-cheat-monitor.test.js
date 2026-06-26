// H3+ — per-user anomaly monitor. Anti-cheat rejections accumulate per user in a
// rolling window; a sustained offender crosses the threshold and the socket
// handler drops them. Pins the window, threshold, per-user isolation, and the
// act-once reset.
//
// Run: node --test tests/anti-cheat-monitor.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { noteRejection, clearUser, _reset } from "../lib/anti-cheat-monitor.js";

beforeEach(() => _reset());

test("accumulates rejections and trips the disconnect at the threshold", () => {
  const t0 = 1_000_000;
  let v;
  for (let i = 0; i < 11; i++) {
    v = noteRejection("cheater", t0 + i);
    assert.equal(v.shouldDisconnect, false, `hit ${i + 1} below threshold`);
  }
  v = noteRejection("cheater", t0 + 11); // 12th within window
  assert.equal(v.shouldDisconnect, true, "threshold reached → drop");
});

test("old hits age out of the window (no false positive for spread-out events)", () => {
  const t0 = 1_000_000;
  // 11 hits, then one 31s later — the early ones have aged past the 30s window.
  for (let i = 0; i < 11; i++) noteRejection("laggy", t0 + i);
  const v = noteRejection("laggy", t0 + 31_000);
  assert.equal(v.shouldDisconnect, false, "stale hits pruned, no drop");
  assert.ok(v.count <= 2, "only recent hits counted");
});

test("per-user isolation — one cheater doesn't trip another player", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 12; i++) noteRejection("cheater", t0 + i);
  const innocent = noteRejection("innocent", t0 + 13);
  assert.equal(innocent.shouldDisconnect, false);
  assert.equal(innocent.count, 1);
});

test("resets after acting (act once, not on every subsequent packet)", () => {
  const t0 = 1_000_000;
  for (let i = 0; i < 11; i++) noteRejection("cheater", t0 + i);
  assert.equal(noteRejection("cheater", t0 + 11).shouldDisconnect, true);
  // Immediately after the drop verdict the counter is cleared.
  const next = noteRejection("cheater", t0 + 12);
  assert.equal(next.count, 1, "history reset after the disconnect verdict");
  assert.equal(next.shouldDisconnect, false);
});

test("clearUser forgets a user's history; kill-switch disables tracking", () => {
  const t0 = 1_000_000;
  noteRejection("u", t0); noteRejection("u", t0 + 1);
  clearUser("u");
  assert.equal(noteRejection("u", t0 + 2).count, 1, "cleared");

  process.env.CONCORD_ANTICHEAT_MONITOR = "0";
  const off = noteRejection("anyone", t0 + 3);
  assert.equal(off.shouldDisconnect, false);
  assert.equal(off.count, 0);
  delete process.env.CONCORD_ANTICHEAT_MONITOR;
});
