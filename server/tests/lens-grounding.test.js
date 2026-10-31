/**
 * Lens grounding (server seam) — Review 4 Analytics R1 (A19/A20).
 *
 * The chat assembly composes its system prompt server-side and never reads
 * a client-supplied systemPrompt, so the analyst's grounded-or-decline
 * contract (founder-ratified, analytics.md §8 Q2) is enforced by
 * server/lib/lens-grounding.js at the assembly. These tests pin the
 * collector's behaviour with the surface's stores stubbed at the exact
 * shapes the real sources return:
 *   GROUNDED — dtu.list's total (the /api/dtus/mine substrate), the social
 *              view's overview, the followers total, the profile stats.
 *   MIRROR — the DTU total derives exactly as the Overview card derives it
 *              (`total || dtus.length` off the limit-100 page).
 *   ZERO IS A FACT — the A20 case: reach 0 is returned as 0, not a decline.
 *   PARTIAL FAILURE NAMES ITSELF — a failing source is named, never filled.
 *   TOTAL FAILURE DECLINES — no facts ⇒ the decline block, with the
 *              context-count disqualification present in every variant.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  collectAnalyticsFacts,
  formatGroundingBlock,
  buildAnalyticsGroundingBlock,
  groundingUserId,
} from "../lib/lens-grounding.js";

function happyDeps(overrides = {}) {
  return {
    runMacro: async (domain, name, input) => {
      assert.equal(domain, "dtu");
      assert.equal(name, "list");
      // The REST route's own argument set (routes/dtus.js /api/dtus/mine).
      assert.equal(input.mine, true);
      assert.equal(input.limit, 100);
      return { ok: true, total: 33, dtus: new Array(33).fill({}) };
    },
    ctx: { actor: { userId: "qa-user" } },
    STATE: {},
    userId: "qa-user",
    sources: {
      getProfile: () => ({ stats: { citationCount: 5, followerCount: 7 } }),
      getFollowers: () => ({ ok: true, followers: [{}, {}], total: 7 }),
      getCreatorAnalyticsView: () => ({
        ok: true,
        overview: { totalReach: 0, engagementRate: 0, followerCount: 7 },
        totalPosts: 0,
      }),
    },
    ...overrides,
  };
}

test("collects the account facts from the surface's own stores, DTUs leading", async () => {
  const { facts, unreadable } = await collectAnalyticsFacts(happyDeps());
  assert.deepEqual(unreadable, []);
  const byLabel = Object.fromEntries(facts.map((f) => [f.label, f.value]));
  assert.equal(byLabel["Total DTUs"], "33");
  assert.equal(byLabel["Citations"], "5");
  assert.equal(byLabel["Followers"], "7");
  assert.equal(byLabel["Total CC moved"], "0");
  assert.equal(byLabel["Total Reach"], "0");
  assert.equal(byLabel["Engagement Rate"], "0.0%");
  assert.equal(facts[0].label, "Total DTUs");
});

test("renders a present zero as a fact — the A20 reach case", async () => {
  const block = await buildAnalyticsGroundingBlock(happyDeps());
  assert.match(block, /Total Reach: 0 \(source: Analytics Overview "Total Reach" card/);
  assert.doesNotMatch(block, /Not readable/);
});

test("derives the DTU total exactly as the card does: total || dtus.length", async () => {
  const deps = happyDeps({
    runMacro: async () => ({ ok: true, total: 0, dtus: [{}, {}, {}] }),
  });
  const { facts } = await collectAnalyticsFacts(deps);
  assert.equal(facts.find((f) => f.label === "Total DTUs").value, "3");
});

test("a failing source is named as unreadable — never zero-filled", async () => {
  const deps = happyDeps({
    runMacro: async () => { throw new Error("macro down"); },
  });
  const { facts, unreadable } = await collectAnalyticsFacts(deps);
  assert.equal(facts.find((f) => f.label === "Total DTUs"), undefined);
  assert.deepEqual(unreadable, ["Total DTUs (GET /api/dtus/mine)"]);
  const block = formatGroundingBlock(facts, unreadable);
  assert.match(block, /Not readable just now: Total DTUs \(GET \/api\/dtus\/mine\)/);
  assert.doesNotMatch(block, /Total DTUs:/);
});

test("a creator-view failure names reach and rate together", async () => {
  const deps = happyDeps();
  deps.sources = {
    ...deps.sources,
    getCreatorAnalyticsView: () => { throw new Error("view down"); },
  };
  const { facts, unreadable } = await collectAnalyticsFacts(deps);
  assert.equal(facts.find((f) => f.label === "Total Reach"), undefined);
  assert.ok(unreadable.includes("Total Reach (GET /api/social/analytics/creator)"));
  assert.ok(unreadable.includes("Engagement Rate (GET /api/social/analytics/creator)"));
});

test("when every readable source fails, the failures are named — never filled", async () => {
  const deps = happyDeps({
    runMacro: async () => { throw new Error("down"); },
  });
  deps.sources = {
    getProfile: () => null,
    getFollowers: () => { throw new Error("down"); },
    getCreatorAnalyticsView: () => { throw new Error("down"); },
  };
  const block = await buildAnalyticsGroundingBlock(deps);
  // Total CC's 0 is structural (the endpoint returns no summary; the card
  // defaults it) — it stays grounded. Everything else is named, not filled.
  assert.match(block, /Total CC moved: 0/);
  assert.match(block, /Not readable just now: Total DTUs \(GET \/api\/dtus\/mine\)/);
  assert.match(block, /Citations \(GET \/api\/social\/profile\)/);
  assert.match(block, /Total Reach \(GET \/api\/social\/analytics\/creator\)/);
  assert.doesNotMatch(block, /Total DTUs: \d/);
  assert.match(block, /harvested as conversation context are NOT account totals/);
});

test("the zero-facts form is the decline block, context-count rule included", () => {
  const block = formatGroundingBlock([], ["the lens account data"]);
  assert.match(block, /could not be read just now/);
  assert.match(block, /never estimate or invent a number/);
  assert.match(block, /harvested as conversation context are NOT account totals/);
});

test("the facts block carries the decline rule and disqualifies context counts", async () => {
  const block = await buildAnalyticsGroundingBlock(happyDeps());
  assert.match(block, /answer questions about this account ONLY from the facts above/);
  assert.match(block, /Counts of DTUs retrieved or harvested as conversation context are NOT account totals/);
  assert.match(block, /the only citable figure is the Total DTUs fact above/);
});

test("the rule covers tool results: a tool total never overrides the grounded facts (A19 successor)", async () => {
  const block = await buildAnalyticsGroundingBlock(happyDeps());
  assert.match(block, /Tool results never override these facts/);
  assert.match(block, /a dtu_search result count above all/);
  assert.match(block, /counts search hits across the corpus, not this account's inventory/);
});

test("no signed-in user → empty block (anonymous chat unchanged)", async () => {
  const block = await buildAnalyticsGroundingBlock(happyDeps({ userId: null }));
  assert.equal(block, "");
});

test("grounding identity is the server-side actor only: a forged input.userId is ignored", async () => {
  assert.equal(groundingUserId({ actor: { userId: "u_real" } }), "u_real");
  assert.equal(groundingUserId({}), null);
  assert.equal(groundingUserId({ actor: {} }), null);
  assert.equal(groundingUserId(undefined), null);
  // A forged input.userId has no way in: the helper takes only ctx, and with no actor the block is empty.
  const block = await buildAnalyticsGroundingBlock(happyDeps({ userId: groundingUserId({ input: { userId: "victim" } }) }));
  assert.equal(block, "");
  // The chat assembly must call the helper, not fall back to input.userId.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  assert.match(src, /buildAnalyticsGroundingBlock\(\{\s*runMacro, ctx, STATE,\s*userId: groundingUserId\(ctx\)/);
});
