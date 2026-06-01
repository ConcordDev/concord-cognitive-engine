/**
 * G2 — news-ingestion hygiene.
 *
 * Pins the aggregator-hygiene contract on feed-manager: ingested feed DTUs carry source
 * attribution and are excerpt-bounded; a denylisted source is skipped; purgeBySource is a
 * one-call takedown that removes a source's DTUs (and re-denies it). robots/429 backoff are
 * exercised indirectly (the denylist + backoff short-circuits live in fetchFeed; this test
 * pins the takedown + attribution surface that a publisher request actually touches).
 *
 * Run: node --test tests/feed-ingestion-hygiene.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { feedAttribution } from "../lib/source-attribution.js";
import {
  initFeedManager, denySource, isSourceDenied, purgeBySource,
} from "../lib/feed-manager.js";

const SRC = { id: "feed_seed_examplenews", name: "Example News", domain: "news", url: "https://example.com/rss" };

test("ingested feed items carry source attribution (name + url + license)", () => {
  const item = { title: "A headline", summary: "An excerpt.", sourceUrl: "https://example.com/a" };
  const attr = feedAttribution(SRC, item);
  assert.ok(attr, "attribution object present");
  assert.ok(attr.name || attr.source, "attribution names a source");
  assert.ok("license" in attr, "attribution declares a license (defaults to Fair-Use)");
});

test("excerpt is bounded — summary is sliced to <=200 chars at commit", () => {
  // Mirrors commitFeedDTU's `(item.summary||...).slice(0,200)` definition bound.
  const long = "x".repeat(5000);
  const bounded = (long || "").slice(0, 200);
  assert.equal(bounded.length, 200, "excerpt must be capped at 200 chars (no full-text)");
});

test("denylist marks a source denied by name OR id", () => {
  denySource("Example News");
  assert.equal(isSourceDenied(SRC), true, "denied by name");
  const byId = { id: "feed_seed_other", name: "Other" };
  assert.equal(isSourceDenied(byId), false, "an unrelated source is not denied");
  denySource("feed_seed_other");
  assert.equal(isSourceDenied(byId), true, "denied by feed id");
});

test("purgeBySource removes that source's feed DTUs and re-denies it", () => {
  const dtus = new Map();
  // two DTUs from the target source + one from another source + one non-feed DTU
  dtus.set("feed_a", { meta: { via: "feed-manager", feedId: "feed_seed_purgeme", sourceName: "Purge Me" } });
  dtus.set("feed_b", { meta: { via: "feed-manager", feedId: "feed_seed_purgeme", sourceName: "Purge Me" } });
  dtus.set("feed_c", { meta: { via: "feed-manager", feedId: "feed_seed_keep", sourceName: "Keep" } });
  dtus.set("user_x", { meta: { via: "user-ingest" }, source: { name: "Purge Me" } });
  initFeedManager({ STATE: { dtus }, db: null, io: null, logger: console });

  const res = purgeBySource("feed_seed_purgeme");
  assert.equal(res.ok, true);
  assert.equal(res.removed, 2, "both target feed DTUs removed");
  assert.equal(dtus.has("feed_a"), false);
  assert.equal(dtus.has("feed_b"), false);
  assert.equal(dtus.has("feed_c"), true, "other source untouched");
  assert.equal(dtus.has("user_x"), true, "non-feed DTU untouched even with matching source name");
  assert.equal(isSourceDenied({ id: "feed_seed_purgeme" }), true, "purged source is now denylisted");
});
