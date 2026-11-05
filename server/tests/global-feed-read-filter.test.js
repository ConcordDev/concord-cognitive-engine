// The global feed applies the same read filters as every other DTU read, for
// the requesting viewer, and only explicitly published DTUs appear in it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { selectGlobalFeed, isPublishedGlobal } from "../lib/global-feed.js";
import { privateDtuHiddenFrom } from "../lib/dtu-read-access.js";

const ALICE = "user-alice";
const BOB = "user-bob";

// Mirrors server.js _isHiddenSystemDtu's ownership boundary for these fixtures.
const isHidden = (d) => !d || d.scope === "system" || d.visibility === "internal";

const iso = (n) => new Date(1_700_000_000_000 + n * 1000).toISOString();
const dtu = (id, extra = {}) => ({ id, title: id, scope: "global", createdAt: iso(1), ...extra });

const FIXTURE = [
  dtu("public-global", { visibility: "public", ownerId: "system", createdAt: iso(5) }),
  dtu("alice-private-global", { visibility: "private", ownerId: ALICE, createdAt: iso(4) }),
  dtu("alice-user-scope", { scope: "user", isGlobal: true, ownerId: ALICE, createdAt: iso(3) }),
  dtu("internal-global", { visibility: "internal", createdAt: iso(2) }),
  dtu("system-scope", { scope: "system", isGlobal: true, createdAt: iso(2) }),
  dtu("unpublished-mega", { scope: "regional", tier: "mega", visibility: "public", createdAt: iso(2) }),
  dtu("unpublished-hyper", { scope: "regional", tier: "hyper", visibility: "public", createdAt: iso(2) }),
  dtu("published-mega", { tier: "mega", visibility: "public", createdAt: iso(6) }),
  dtu("quarantined", { visibility: "public", tags: ["quarantine:x"], source: "quarantine:x" }),
];

const run = (viewerId, extra = {}) =>
  selectGlobalFeed(FIXTURE, { viewerId, isHidden, isPrivateFrom: privateDtuHiddenFrom, ...extra }).map((d) => d.id);

describe("global feed read filtering", () => {
  it("a member does not receive another user's private or user-scoped DTUs", () => {
    const ids = run(BOB);
    assert.ok(!ids.includes("alice-private-global"));
    assert.ok(!ids.includes("alice-user-scope"));
    assert.ok(ids.includes("public-global"));
  });

  it("an anonymous viewer gets only public published rows", () => {
    const ids = run(null);
    assert.deepEqual(ids, ["published-mega", "public-global"]);
  });

  it("the owner still sees their own private published DTU", () => {
    const ids = run(ALICE);
    assert.ok(ids.includes("alice-private-global"));
    assert.ok(ids.includes("alice-user-scope"));
  });

  it("internal and system rows are not listed for anyone", () => {
    for (const v of [null, BOB, ALICE]) {
      const ids = run(v);
      assert.ok(!ids.includes("internal-global"), `internal row listed for ${v}`);
      assert.ok(!ids.includes("system-scope"), `system row listed for ${v}`);
    }
  });

  it("a mega/hyper tier does not publish a DTU by itself", () => {
    const ids = run(BOB);
    assert.ok(!ids.includes("unpublished-mega"));
    assert.ok(!ids.includes("unpublished-hyper"));
    assert.ok(ids.includes("published-mega"), "an explicitly global mega is still listed");
    assert.equal(isPublishedGlobal({ tier: "hyper" }), false);
    assert.equal(isPublishedGlobal({ isGlobal: true }), true);
    assert.equal(isPublishedGlobal({ scope: "global" }), true);
  });

  it("quarantined rows are never listed", () => {
    assert.ok(!run(BOB).includes("quarantined"));
    assert.ok(!run(ALICE).includes("quarantined"));
  });

  it("the tier filter narrows without widening", () => {
    assert.deepEqual(run(BOB, { tier: "mega" }), ["published-mega"]);
  });

  it("the lens feed applies the same filters and still matches by lens", () => {
    const lensRows = [
      dtu("lens-public", { visibility: "public", meta: { publishedFromLens: "art" }, createdAt: iso(2) }),
      dtu("lens-private", { visibility: "private", ownerId: ALICE, tags: ["art"], createdAt: iso(3) }),
      dtu("lens-internal", { visibility: "internal", meta: { domain: "art" } }),
      dtu("lens-other", { visibility: "public", meta: { publishedFromLens: "music" } }),
    ];
    const opts = { isHidden, isPrivateFrom: privateDtuHiddenFrom, lensId: "ART" };
    assert.deepEqual(selectGlobalFeed(lensRows, { ...opts, viewerId: BOB }).map((d) => d.id), ["lens-public"]);
    assert.deepEqual(selectGlobalFeed(lensRows, { ...opts, viewerId: ALICE }).map((d) => d.id), ["lens-private", "lens-public"]);
  });

  it("fails closed when the read filters are not supplied", () => {
    assert.deepEqual(selectGlobalFeed(FIXTURE, { viewerId: BOB }), []);
  });
});

describe("server.js routes use the shared selection", () => {
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server.js"), "utf8");
  it("both global feed routes go through selectGlobalFeed with the viewer", () => {
    for (const route of ['app.get("/api/global/feed",', 'app.get("/api/global/feed/:lensId",']) {
      const start = src.indexOf(route);
      assert.ok(start > 0, `${route} registered`);
      const body = src.slice(start, start + 1200);
      assert.match(body, /selectGlobalFeed\(/);
      assert.match(body, /viewerId: req\.user\?\.id \|\| null/);
      assert.match(body, /isPrivateFrom: privateDtuHiddenFrom/);
      assert.match(body, /isHidden: _isHiddenSystemDtu/);
    }
  });
});
