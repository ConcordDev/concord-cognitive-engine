/**
 * Idle-heap-leak audit (2026-07-25) follow-on.
 *
 * A read-only durability audit found ~20 STATE maps/arrays absent from
 * `_aggressiveEviction`'s cap list (`docs/HEAP_GROWTH_MEASUREMENT.md`). Each
 * candidate was individually verified against its writers in server.js before
 * deciding whether a cap is safe:
 *
 *   - STATE.dtus is NOT capped: post-boot it's replaced by the write-through
 *     `dtu-store.js` object whose `.delete(id)` calls `DELETE FROM dtu_store`
 *     — i.e. it is destructive of SQLite, not a cache-evict. Running the
 *     generic LRU-delete idiom against it would permanently destroy DTUs.
 *   - STATE.wrappers, .layers, .personas, .papers, .lensArtifacts,
 *     .userUniverses, .entities are real user-authored content with no DB
 *     table backing them (only the legacy full-state JSON snapshot) — eviction
 *     is permanent, uncoverable data loss.
 *   - STATE.users, .orgs, .apiKeys, .wallets are identity/auth/financial data
 *     — evicting any of them is a correctness or security bug worse than the
 *     leak.
 *   - STATE.assessments is a real student assessment/credential history
 *     store (server/routes/learning.js) with no DB backing — data loss.
 *   - STATE.councilVotes and STATE.globalIndex both gate a "no duplicates"
 *     correctness invariant (duplicate-vote prevention, duplicate-global-DTU
 *     rejection) that eviction would silently break.
 *   - STATE.debates (top-level, `/api/council/debate`) and
 *     STATE._sessionRecordings already self-cap in their own handlers (200
 *     and 50 respectively) — the audit's list was stale on these two.
 *   - STATE._costAccounting already has a dedicated periodic hard cap (500,
 *     kernelTick every 2000 ticks) — already handled, no change needed.
 *
 * Two maps were genuinely uncapped AND genuinely safe to cap — pure
 * request/job telemetry with no correctness dependency on surviving eviction
 * — plus one already-partially-handled cache that only had staleness
 * cleanup, not a hard ceiling:
 *
 *   - STATE.mlJobs   — synchronous ML request tracking records.
 *   - STATE.notifications — already had a ONE-TIME boot trim to 2000; this
 *     makes the same decision recurring.
 *   - STATE._rateLimits — already had periodic *stale-entry* cleanup but no
 *     cap on distinct-user cardinality.
 *
 * Run: node --test tests/integration/memory-watchdog-uncapped-maps.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("mlJobs is LRU-trimmed by the watchdog", () => {
  it("trims an oversized mlJobs Map down toward the cap (oldest first)", async () => {
    process.env.CONCORD_MAX_ML_JOBS = "100";
    const { _aggressiveEviction } = await import("../../lib/memory-pressure.js?mljobs1");
    const STATE = { sessions: new Map(), mlJobs: new Map() };
    for (let i = 0; i < 250; i++) STATE.mlJobs.set(`j${i}`, { id: `j${i}`, status: "completed" });
    assert.equal(STATE.mlJobs.size, 250);
    _aggressiveEviction(STATE);
    assert.equal(STATE.mlJobs.size, 80); // floor(cap * 0.8)
    assert.equal(STATE.mlJobs.has("j0"), false); // oldest evicted
    assert.equal(STATE.mlJobs.has("j249"), true); // newest survive
    delete process.env.CONCORD_MAX_ML_JOBS;
  });

  it("leaves a within-cap mlJobs Map untouched", async () => {
    process.env.CONCORD_MAX_ML_JOBS = "1000";
    const { _aggressiveEviction } = await import("../../lib/memory-pressure.js?mljobs2");
    const STATE = { sessions: new Map(), mlJobs: new Map() };
    for (let i = 0; i < 50; i++) STATE.mlJobs.set(`j${i}`, { id: `j${i}` });
    _aggressiveEviction(STATE);
    assert.equal(STATE.mlJobs.size, 50);
    delete process.env.CONCORD_MAX_ML_JOBS;
  });
});

describe("notifications is LRU-trimmed by the watchdog (recurring, not just at boot)", () => {
  it("trims an oversized notifications Map down toward the cap (oldest first)", async () => {
    process.env.CONCORD_MAX_NOTIFICATIONS = "100";
    const { _aggressiveEviction } = await import("../../lib/memory-pressure.js?notif1");
    const STATE = { sessions: new Map(), notifications: new Map() };
    for (let i = 0; i < 250; i++) STATE.notifications.set(`n${i}`, { id: `n${i}`, read: true });
    assert.equal(STATE.notifications.size, 250);
    _aggressiveEviction(STATE);
    assert.equal(STATE.notifications.size, 80); // floor(cap * 0.8)
    assert.equal(STATE.notifications.has("n0"), false);
    assert.equal(STATE.notifications.has("n249"), true);
    delete process.env.CONCORD_MAX_NOTIFICATIONS;
  });

  it("leaves a within-cap notifications Map untouched", async () => {
    process.env.CONCORD_MAX_NOTIFICATIONS = "1000";
    const { _aggressiveEviction } = await import("../../lib/memory-pressure.js?notif2");
    const STATE = { sessions: new Map(), notifications: new Map() };
    for (let i = 0; i < 50; i++) STATE.notifications.set(`n${i}`, { id: `n${i}` });
    _aggressiveEviction(STATE);
    assert.equal(STATE.notifications.size, 50);
    delete process.env.CONCORD_MAX_NOTIFICATIONS;
  });
});

describe("_rateLimits is LRU-trimmed by the watchdog (cardinality cap, not just staleness)", () => {
  it("trims an oversized _rateLimits Map down toward the cap (oldest first)", async () => {
    process.env.CONCORD_MAX_RATE_LIMIT_ENTRIES = "100";
    const { _aggressiveEviction } = await import("../../lib/memory-pressure.js?rl1");
    const STATE = { sessions: new Map(), _rateLimits: new Map() };
    for (let i = 0; i < 250; i++) STATE._rateLimits.set(`u${i}`, { calls: [Date.now()] });
    assert.equal(STATE._rateLimits.size, 250);
    _aggressiveEviction(STATE);
    assert.equal(STATE._rateLimits.size, 80); // floor(cap * 0.8)
    assert.equal(STATE._rateLimits.has("u0"), false);
    assert.equal(STATE._rateLimits.has("u249"), true);
    delete process.env.CONCORD_MAX_RATE_LIMIT_ENTRIES;
  });

  it("leaves a within-cap _rateLimits Map untouched", async () => {
    process.env.CONCORD_MAX_RATE_LIMIT_ENTRIES = "1000";
    const { _aggressiveEviction } = await import("../../lib/memory-pressure.js?rl2");
    const STATE = { sessions: new Map(), _rateLimits: new Map() };
    for (let i = 0; i < 50; i++) STATE._rateLimits.set(`u${i}`, { calls: [] });
    _aggressiveEviction(STATE);
    assert.equal(STATE._rateLimits.size, 50);
    delete process.env.CONCORD_MAX_RATE_LIMIT_ENTRIES;
  });
});

describe("deliberately-NOT-capped maps are untouched by _aggressiveEviction", () => {
  it("never calls .delete() on the write-through DTU store shape (no generic cap entry for 'dtus')", async () => {
    const { _aggressiveEviction } = await import("../../lib/memory-pressure.js?dtuguard");
    let deleteCalls = 0;
    // Mimic the write-through store: .delete() is destructive (drops the
    // SQLite row too, per server/lib/dtu-store.js), so this test would catch
    // a regression that adds "dtus" to the generic mapCaps LRU-delete list.
    const fakeDtuStore = {
      size: 999999,
      delete(id) { deleteCalls++; return true; },
      keys() { return [][Symbol.iterator](); },
    };
    const STATE = { sessions: new Map(), dtus: fakeDtuStore };
    _aggressiveEviction(STATE);
    assert.equal(deleteCalls, 0, "aggressive eviction must never call .delete() on STATE.dtus");
  });

  it("leaves identity/financial/governance maps alone regardless of size", async () => {
    const { _aggressiveEviction } = await import("../../lib/memory-pressure.js?identityguard");
    const STATE = {
      sessions: new Map(),
      users: new Map(),
      apiKeys: new Map(),
      wallets: new Map(),
      orgs: new Map(),
      assessments: new Map(),
      councilVotes: new Map(),
      globalIndex: { byHash: new Map(), byId: new Map() },
    };
    for (let i = 0; i < 10000; i++) {
      STATE.users.set(`u${i}`, { id: `u${i}` });
      STATE.apiKeys.set(`k${i}`, { id: `k${i}` });
      STATE.wallets.set(`w${i}`, { id: `w${i}`, balance: 100 });
      STATE.orgs.set(`o${i}`, { id: `o${i}` });
      STATE.assessments.set(`a${i}`, { id: `a${i}` });
      STATE.councilVotes.set(`d${i}`, [{ voterId: "x" }]);
    }
    _aggressiveEviction(STATE);
    assert.equal(STATE.users.size, 10000);
    assert.equal(STATE.apiKeys.size, 10000);
    assert.equal(STATE.wallets.size, 10000);
    assert.equal(STATE.orgs.size, 10000);
    assert.equal(STATE.assessments.size, 10000);
    assert.equal(STATE.councilVotes.size, 10000);
  });
});

describe("the watchdog cap list includes the three new fields", () => {
  it("source contains mlJobs, notifications, and _rateLimits cap entries", async () => {
    const src = await import("node:fs").then((m) =>
      m.readFileSync(new URL("../../lib/memory-pressure.js", import.meta.url), "utf8"));
    assert.match(src, /\["mlJobs", Number\(process\.env\.CONCORD_MAX_ML_JOBS\)/);
    assert.match(src, /\["notifications", Number\(process\.env\.CONCORD_MAX_NOTIFICATIONS\)/);
    assert.match(src, /\["_rateLimits", Number\(process\.env\.CONCORD_MAX_RATE_LIMIT_ENTRIES\)/);
  });
});
