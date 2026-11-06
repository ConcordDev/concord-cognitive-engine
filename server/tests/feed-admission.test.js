// A13 — feed admission (register §3).
//
// The genus: the feed reader (lib/global-feed.js) admits only DTUs with
// scope "global" (or the isGlobal flag), while dtu.create's Scope
// Separation coercion lands EVERY create "local" — so a lens feed action's
// provenanced public ingests (Food's Open Food Facts pull is the filed
// instance) existed in STATE.dtus yet appeared in no feed list anywhere.
// Feed-manager's writes bypass dtu.create and carry scope "global"
// directly. The cure: dtu.create consults feedIngestScope — a create
// carrying the server-only feedIngest marker (stamped only while a wrapped
// lens feed action runs; stripped from request bodies) whose resolved
// visibility is open takes "global" + meta.publishedFromLens. Every other
// create keeps the coercion byte-identical.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { feedIngestScope } from "../lib/feed-ingest-provenance.js";
import { selectGlobalFeed, isPublishedGlobal } from "../lib/global-feed.js";
import { privateDtuHiddenFrom } from "../lib/dtu-read-access.js";

const MARKER = { domain: "food", action: "feed", source: "openfoodfacts-feed", at: "2026-11-06T00:00:00.000Z" };

// The route wiring (GET /api/global/feed[/:lensId]) passes the real
// privateDtuHiddenFrom as isPrivateFrom. isHidden is server.js's
// _isHiddenSystemDtu; the arm fixtures can exercise is reproduced here
// (system scope / internal visibility) — fixtures carry no system sources.
const isHidden = (d) => !d || d.scope === "system" || d.visibility === "internal";
const OPTS = { viewerId: null, isHidden, isPrivateFrom: privateDtuHiddenFrom };

const baseRow = {
  id: "dtu_off_1",
  title: "Food product: Test Bar",
  source: "openfoodfacts-feed",
  creatorType: "user",
  ownerId: "user_a",
  tier: "regular",
  tags: ["food", "feed", "product", "openfoodfacts"],
  createdAt: "2026-11-06T00:00:00.000Z",
};

// The row as dtu.create constructs it AFTER this slice: provenanced ingest,
// open visibility → global scope + lens attribution.
const postFixRow = {
  ...baseRow,
  visibility: "public",
  scope: "global",
  meta: { feedIngest: MARKER, publishedFromLens: "food", code: "123" },
};

// The same ingest BEFORE this slice: visibilityScope "global" fed only the
// federation tier; the scope field landed "local" and no surface admitted it.
const preFixRow = {
  ...baseRow,
  visibility: "public",
  scope: "local",
  meta: { feedIngest: MARKER, code: "123" },
};

// An ordinary user's public DTU that was never published: the coercion's
// standing output, and it must stay inadmissible (publish is the act).
const userRow = {
  ...baseRow,
  id: "dtu_user_1",
  source: "user",
  visibility: "public",
  scope: "local",
  tags: ["food"],
  meta: {},
};

const quarantinedRow = {
  ...postFixRow,
  id: "dtu_off_q",
  tags: [...baseRow.tags, "quarantine:injection-review"],
};

describe("feedIngestScope — the marker, never the request, is the key", () => {
  it("provenanced ingest with open visibility takes global", () => {
    assert.equal(feedIngestScope(MARKER, "public"), "global");
    assert.equal(feedIngestScope(MARKER, "published"), "global");
    assert.equal(feedIngestScope(MARKER, "marketplace"), "global");
  });

  it("provenanced ingest with closed visibility takes nothing", () => {
    assert.equal(feedIngestScope(MARKER, "private"), null);
    assert.equal(feedIngestScope(MARKER, "internal"), null);
    assert.equal(feedIngestScope(MARKER, null), null);
    assert.equal(feedIngestScope(MARKER, undefined), null);
  });

  it("no marker, no admission — however open the request", () => {
    assert.equal(feedIngestScope(null, "public"), null);
    assert.equal(feedIngestScope(undefined, "public"), null);
    assert.equal(feedIngestScope("food", "public"), null);
    assert.equal(feedIngestScope(0, "public"), null);
  });
});

describe("selectGlobalFeed — admission after the cure, exclusion before it", () => {
  it("the post-fix ingested row is admitted to the global feed and its lens feed", () => {
    assert.equal(isPublishedGlobal(postFixRow), true);
    assert.deepEqual(selectGlobalFeed([postFixRow], OPTS).map((d) => d.id), ["dtu_off_1"]);
    assert.deepEqual(selectGlobalFeed([postFixRow], { ...OPTS, lensId: "food" }).map((d) => d.id), ["dtu_off_1"]);
    assert.deepEqual(selectGlobalFeed([postFixRow], { ...OPTS, lensId: "hr" }), []);
  });

  it("the pre-fix row (scope local) is admitted nowhere — the filed defect, pinned as cured by contrast", () => {
    assert.equal(isPublishedGlobal(preFixRow), false);
    assert.deepEqual(selectGlobalFeed([preFixRow], OPTS), []);
    assert.deepEqual(selectGlobalFeed([preFixRow], { ...OPTS, lensId: "food" }), []);
  });

  it("an unpublished user DTU stays out: publish remains the deliberate act", () => {
    assert.deepEqual(selectGlobalFeed([userRow], OPTS), []);
    assert.deepEqual(selectGlobalFeed([userRow], { ...OPTS, lensId: "food" }), []);
  });

  it("a quarantined global row is still excluded for everyone but its owner", () => {
    assert.deepEqual(selectGlobalFeed([quarantinedRow], OPTS), []);
    assert.deepEqual(selectGlobalFeed([quarantinedRow], { ...OPTS, viewerId: "user_b" }), []);
    assert.deepEqual(selectGlobalFeed([quarantinedRow], { ...OPTS, viewerId: "user_a" }).map((d) => d.id), ["dtu_off_q"]);
  });
});

describe("dtu.create wiring (source pins)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const serverSrc = readFileSync(join(here, "..", "server.js"), "utf8");

  it("dtu.create consults the helper on the stamped marker + resolved visibility", () => {
    assert.ok(serverSrc.includes("feedIngestScope(meta.feedIngest, _defaultVisibility)"));
    assert.ok(serverSrc.includes('meta.publishedFromLens = String(meta.feedIngest.domain).toLowerCase()'));
    assert.ok(serverSrc.includes("feedIngestScope,") || serverSrc.includes("feedIngestScope }"));
  });

  it("the Scope Separation coercion stands as the fallthrough", () => {
    assert.ok(
      serverSrc.includes(
        '_fiScope === "global" ? "global" : (input.scope === "personal" || input.scope === "local") ? input.scope : "local"',
      ),
    );
  });
});
