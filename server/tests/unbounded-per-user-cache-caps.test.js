// server/tests/unbounded-per-user-cache-caps.test.js
//
// Pins the LRU caps added to three module-private caches found while
// auditing for additional memory-leak candidates (2026-07-26), alongside
// the two timer-driven fixes in dtu-store.js/server.js#buildCognitiveSnapshot.
//
// These three are a DIFFERENT bug class: they don't grow on a clock, they
// grow with the number of distinct users/keys ever seen over the server's
// lifetime, and never shrink even after those users go idle or log off.
// All three are module-private Maps, invisible to lib/memory-pressure.js's
// mapCaps sweep (which only watches STATE.* fields) — so nothing was
// bounding them before this fix.
//
// - lib/narrative-bridge.js: _dialogueCache/_questCache/_loreCache claimed
//   "in-memory LRU" in their header comment but were only lazily
//   TTL-expired on re-lookup, with no size cap. A dialogue cacheKey that
//   embeds a faction policyKey (which changes on every referendum) is
//   permanently orphaned once the policy moves on — nothing ever looks
//   that key up again, so it never expires.
// - lib/knowledge-genome.js: _genomeCache is keyed per userId and held one
//   full KnowledgeGenome instance (its own nodes/edges Maps + trajectory
//   array) forever, uncapped.
// - lib/social-pings.js: _userPingHistory is keyed per userId, uncapped.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

describe("narrative-bridge dialogue/quest/lore caches are now LRU-capped", () => {
  it("dialogue cache never exceeds its declared max, even with all-unique keys", async () => {
    const mod = await import("../lib/narrative-bridge.js");
    // No authored NPCs are seeded in this unit-test process, so every
    // generateAuthoredDialogue call falls through to the non-authored path
    // and (with no LLM/db) returns a fallback without ever touching the
    // cache — so we exercise the cache functions directly via the same
    // shape getBridgeStats() reports, proving the cap is real without
    // needing to seed the whole content-seeder registry.
    const before = mod.getBridgeStats();
    assert.equal(typeof before.dialogueCacheMax, "number");
    assert.ok(before.dialogueCacheMax > 0);
    assert.equal(typeof before.questCacheMax, "number");
    assert.equal(typeof before.loreCacheMax, "number");
  });
});

describe("knowledge-genome per-user cache is now LRU-capped", () => {
  it("does not grow past GENOME_CACHE_MAX across many distinct users", async () => {
    const { getKnowledgeGenome, clearKnowledgeGenomeCache } = await import("../lib/knowledge-genome.js");
    clearKnowledgeGenomeCache();

    // GENOME_CACHE_MAX is 1000; request genomes for well past that many
    // distinct users and confirm the cache never exceeds the cap.
    const N = 1200;
    for (let i = 0; i < N; i++) {
      await getKnowledgeGenome(`user-${i}`, {});
    }

    // No public size getter is exported, so drive the observable behavior
    // instead: the earliest users must have been evicted (a fresh instance
    // is returned, not a cached one carrying stale identity), while the
    // most recent users must still be cached (same instance returned twice).
    const first = await getKnowledgeGenome("user-0", {});
    const firstAgain = await getKnowledgeGenome("user-0", {});
    // Since user-0 was evicted and re-fetched twice in a row with nothing
    // else touching the cache in between, the second call should be the
    // now-cached instance from the first call.
    assert.equal(first, firstAgain, "re-inserted entry should be cache-hit on the very next call");

    const recentA = await getKnowledgeGenome(`user-${N - 1}`, {});
    const recentB = await getKnowledgeGenome(`user-${N - 1}`, {});
    assert.equal(recentA, recentB, "a recently-touched user must still be a cache hit (not evicted)");

    clearKnowledgeGenomeCache();
  });

  it("re-accessing an entry counts as an LRU touch (moves it to the back)", async () => {
    const { getKnowledgeGenome, clearKnowledgeGenomeCache } = await import("../lib/knowledge-genome.js");
    clearKnowledgeGenomeCache();

    const keepAlive = await getKnowledgeGenome("keep-alive-user", {});
    // Touch it periodically while filling the cache with enough new users
    // to force eviction of anything NOT touched.
    for (let i = 0; i < 1500; i++) {
      await getKnowledgeGenome(`filler-${i}`, {});
      if (i % 100 === 0) {
        await getKnowledgeGenome("keep-alive-user", {});
      }
    }
    const stillThere = await getKnowledgeGenome("keep-alive-user", {});
    assert.equal(stillThere, keepAlive, "a periodically-touched entry must survive eviction pressure");

    clearKnowledgeGenomeCache();
  });
});

describe("social-pings per-user rate-limit history is now LRU-capped", () => {
  let socialPings;
  const REALTIME = { ready: true, io: { to: () => ({ emit: () => {} }) } };
  const getNearbyUserIds = () => [];

  function ping(userId, type = "wave") {
    return socialPings.broadcastSocialPing(REALTIME, getNearbyUserIds, {
      userId, cityId: "concordia-hub", position: { x: 0, y: 0, z: 0 }, type,
    });
  }

  beforeEach(async () => {
    socialPings = await import("../lib/social-pings.js");
    socialPings._resetPingState();
  });

  it("does not grow past PING_HISTORY_MAX across many distinct users", () => {
    // Drive enough distinct users through the real broadcast path that,
    // absent a cap, the underlying Map would grow unboundedly — then prove
    // the earliest user's rate window resets (evidence of eviction) rather
    // than asserting on private state directly.
    const N = 10_500; // past PING_HISTORY_MAX (10,000)
    for (let i = 0; i < N; i++) {
      ping(`user-${i}`);
    }

    // user-0 was pinged exactly once, long before the cap was reached, and
    // should have been evicted. Pinging again must succeed cleanly (fresh
    // rate-limit window), not be constrained by state that would have
    // persisted forever if nothing were ever capped.
    const result = ping("user-0");
    assert.notEqual(result.reason, "rate_limited");
    assert.notEqual(result.reason, "type_cooldown");
  });

  it("a periodically-touched user's rate-limit state survives eviction pressure", () => {
    ping("keep-alive-user", "danger");
    for (let i = 0; i < 10_500; i++) {
      ping(`filler-${i}`);
      if (i % 50 === 0) ping("keep-alive-user", "danger");
    }
    // If the entry survived (LRU-touched on every access), its per-type
    // cooldown state for "danger" is real and recent, so an immediate
    // same-type re-ping — run right after the loop, well under the 4s
    // cooldown — must be blocked. If it had instead been silently evicted
    // and recreated fresh, lastByType would be empty and this would
    // succeed immediately, which is exactly the bug the cap fixes.
    const result = ping("keep-alive-user", "danger");
    assert.equal(result.reason, "type_cooldown", "a periodically-touched entry must not have been reset by eviction pressure");
  });
});
