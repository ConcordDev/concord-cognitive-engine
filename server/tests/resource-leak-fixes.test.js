// Verification-audit fix — pinning tests for 3 real resource-leak findings:
// unbounded module-scope arrays growing for the life of the process.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("emergent/ghost-threads.js — dead unbounded _threadHistory removed", () => {
  it("no longer references _threadHistory anywhere (it was write-only, never read, growing forever)", () => {
    const src = readFileSync(path.resolve(__dirname, "..", "emergent", "ghost-threads.js"), "utf8");
    assert.doesNotMatch(src, /_threadHistory/, "the dead, unbounded, unread _threadHistory array must be fully removed, not just left unused");
  });

  it("getGhostThreadMetrics still works (rate limiting is really done via _lastRunAt, unaffected by the removal)", async () => {
    const { getGhostThreadMetrics } = await import("../emergent/ghost-threads.js");
    const metrics = getGhostThreadMetrics();
    assert.equal(typeof metrics.totalRuns, "number");
    assert.equal(typeof metrics.activeInsights, "number");
  });
});

describe("emergent/promotion-pipeline.js — _history capped at MAX_HISTORY", () => {
  let requestPromotion, getPromotionHistory;

  before(async () => {
    globalThis._concordSTATE = { dtus: new Map() };
    ({ requestPromotion, getPromotionHistory } = await import("../emergent/promotion-pipeline.js"));
    globalThis._concordApps = new Map();
    for (let i = 0; i < 600; i++) {
      globalThis._concordApps.set(`app-${i}`, { id: `app-${i}`, _promotionStage: "personal" });
    }
  });

  it("stays bounded after far more pushes than the cap, even when a huge limit is requested", () => {
    let lastProposalId;
    for (let i = 0; i < 600; i++) {
      const r = requestPromotion(`app-${i}`, "app", "sovereign");
      assert.equal(r.ok, true, `requestPromotion should succeed for app-${i}: ${r.error}`);
      lastProposalId = r.proposal.id;
    }
    const { history } = getPromotionHistory(999999);
    assert.ok(history.length <= 500, `expected _history capped at 500, got ${history.length}`);
    // Still returns the most RECENT entries (tail), not an arbitrary truncation.
    assert.equal(history[history.length - 1].proposalId, lastProposalId);
  });
});

describe("lib/world-organizations.js — recruitment board culled + capped", () => {
  let postRecruitment, getOrganizationStats, getRecruitmentBoard;

  before(async () => {
    ({ postRecruitment, getOrganizationStats, getRecruitmentBoard } = await import("../lib/world-organizations.js"));
  });

  it("stays bounded after far more postings than the cap", () => {
    for (let i = 0; i < 1200; i++) {
      const r = postRecruitment({ orgId: "org-leak-test", type: "looking_for_members", title: `Listing ${i}` });
      assert.equal(r.ok, true);
    }
    const stats = getOrganizationStats();
    assert.ok(stats.totalRecruitments <= 1000, `expected recruitment board capped at 1000, got ${stats.totalRecruitments}`);
  });

  it("culls listings older than the TTL instead of only ever growing", () => {
    const before = getOrganizationStats().totalRecruitments;
    const r = postRecruitment({ orgId: "org-ttl-test", type: "looking_for_members", title: "Stale post" });
    const board = getRecruitmentBoard({ limit: 99999 });
    const stale = board.find((l) => l.id === r.listingId);
    assert.ok(stale, "the fresh listing should be present immediately after posting");
    stale.postedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

    // Posting one more listing triggers the opportunistic cull.
    postRecruitment({ orgId: "org-ttl-test", type: "looking_for_members", title: "Trigger cull" });
    const after = getRecruitmentBoard({ limit: 99999 });
    assert.ok(!after.some((l) => l.id === r.listingId), "the 31-day-old listing should have been culled");
    assert.ok(before >= 0);
  });
});
