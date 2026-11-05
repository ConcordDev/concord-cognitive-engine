/**
 * Seed and feed content scope.
 *
 * Founder seed content loads private to the founder account and is never
 * promoted to mega/hyper at load; with no founder account configured nothing
 * is seeded. Feed-manager content is system-owned and public. Custody writes
 * may set a scope from a short allowlist.
 *
 * Run: node --test server/tests/dtu-seed-scope.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assignDtuCustody,
  founderSeedCustody,
  stampFounderSeed,
  isNamedPublicSystemContent,
  isLegitimatePublicSystemDtu,
} from "../lib/dtu-ownership.js";
import { privateDtuHiddenFrom } from "../lib/dtu-read-access.js";
import { runBootstrapIngestion } from "../emergent/bootstrap-ingestion.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, "..", rel), "utf8");

const FOUNDER = "founder-user-1";

describe("founderSeedCustody", () => {
  it("is private, user-scoped and owned by FOUNDER_USER_ID", () => {
    assert.deepEqual(founderSeedCustody({ FOUNDER_USER_ID: FOUNDER }), {
      ownerId: FOUNDER, scope: "user", visibility: "private",
    });
  });

  it("is null when FOUNDER_USER_ID is unset, blank, anon or a system sentinel", () => {
    for (const v of [undefined, "", "   ", "anon", "system"]) {
      assert.equal(founderSeedCustody({ FOUNDER_USER_ID: v }), null, `value ${JSON.stringify(v)}`);
    }
    assert.equal(founderSeedCustody({}), null);
  });

  it("stamping makes a seed readable by the founder only", () => {
    const custody = founderSeedCustody({ FOUNDER_USER_ID: FOUNDER });
    const d = stampFounderSeed({ id: "seed1", scope: "global", visibility: "public" }, custody);
    assert.equal(d.scope, "user");
    assert.equal(d.visibility, "private");
    assert.equal(d.ownerId, FOUNDER);
    assert.equal(privateDtuHiddenFrom(d, FOUNDER), false);
    assert.equal(privateDtuHiddenFrom(d, "someone-else"), true);
    assert.equal(privateDtuHiddenFrom(d, null), true);
  });
});

describe("bootstrap ingestion with founder custody", () => {
  const seeds = () => [
    { id: "dtu_root_fixed_point", title: "Root", human: { summary: "root" }, core: { claims: ["a"] }, lineage: { parents: [] } },
    { id: "dtu_seed_two", title: "Two", human: { summary: "two" }, core: { claims: ["b"] }, lineage: { parents: ["dtu_root_fixed_point"] } },
  ];
  const state = () => ({ dtus: new Map() });

  it("loads seeds private, founder-owned, user-scoped and regular tier", () => {
    const STATE = state();
    const custody = founderSeedCustody({ FOUNDER_USER_ID: FOUNDER });
    const out = runBootstrapIngestion(STATE, seeds(), { seedCustody: custody });
    assert.equal(out.ok, true);
    assert.ok(STATE.dtus.size >= 2);
    for (const d of STATE.dtus.values()) {
      assert.equal(d.scope, "user", d.id);
      assert.equal(d.visibility, "private", d.id);
      assert.equal(d.ownerId, FOUNDER, d.id);
      assert.equal(d.tier, "regular", `${d.id} must not be promoted at load`);
      assert.equal(privateDtuHiddenFrom(d, "member-2"), true, d.id);
    }
  });

  it("without custody the existing global behavior is unchanged", () => {
    const STATE = state();
    runBootstrapIngestion(STATE, seeds(), {});
    for (const d of STATE.dtus.values()) assert.equal(d.scope, "global", d.id);
  });
});

describe("feed-manager content is system-owned and public", () => {
  const feedDtu = {
    id: "feed_1",
    title: "Headline",
    scope: "global",
    source: { via: "feed-manager", url: "https://example.com/a", name: "Example" },
    meta: { via: "feed-manager", feedId: "example-rss", sourceUrl: "https://example.com/a" },
  };

  it("is recognised as public system content", () => {
    assert.equal(isNamedPublicSystemContent(feedDtu), true);
    assert.equal(isLegitimatePublicSystemDtu({ ...feedDtu, visibility: "public", ownerId: "system" }), true);
  });

  it("recognises each marker on its own (meta.via, meta.feedId, object source)", () => {
    assert.equal(isNamedPublicSystemContent({ id: "a", meta: { via: "feed-manager" } }), true);
    assert.equal(isNamedPublicSystemContent({ id: "b", meta: { feedId: "hn" } }), true);
    assert.equal(isNamedPublicSystemContent({ id: "c", source: { url: "https://example.com" } }), true);
    assert.equal(isNamedPublicSystemContent({ id: "d", source: { via: "feed-manager" } }), true);
  });

  it("a user-owned DTU that cites a URL or sets feed markers is never system content", () => {
    assert.equal(isNamedPublicSystemContent({ id: "u1", ownerId: "member-1", source: { url: "https://example.com" } }), false);
    assert.equal(isNamedPublicSystemContent({ id: "u2", ownerId: "member-1", meta: { via: "feed-manager", feedId: "x" } }), false);
    assert.equal(isNamedPublicSystemContent({ id: "u3", author: "member-1", source: { via: "feed-manager" } }), false);
  });

  it("feed-manager stamps system ownership, public visibility and the feed creator type", () => {
    const src = read("lib/feed-manager.js");
    const i = src.indexOf('scope: "global", // Feed DTUs are public data');
    assert.ok(i > 0);
    const block = src.slice(i, i + 700);
    assert.match(block, /ownerId: "system"/);
    assert.match(block, /visibility: "public"/);
    assert.match(block, /creatorType: "feed_ingestion"/);
  });
});

describe("assignDtuCustody scope", () => {
  const admin = { actor: { userId: "admin-1", id: "admin-1", role: "admin" } };
  const mkStore = () => {
    const m = new Map([["d1", { id: "d1", scope: "global", visibility: "public", ownerId: "system" }]]);
    return m;
  };

  it("sets an allowlisted scope and reports before/after", () => {
    const store = mkStore();
    const out = assignDtuCustody(store, { ids: ["d1"], scope: "user", visibility: "private", owner: FOUNDER }, admin);
    assert.equal(out.ok, true);
    assert.equal(store.get("d1").scope, "user");
    assert.equal(out.results[0].before.scope, "global");
    assert.equal(out.results[0].after.scope, "user");
    assert.equal(out.scope, "user");
  });

  it("scope alone is a valid request, and a dry run leaves the store unchanged", () => {
    const store = mkStore();
    const out = assignDtuCustody(store, { ids: ["d1"], scope: "personal", dryRun: true }, admin);
    assert.equal(out.ok, true);
    assert.equal(store.get("d1").scope, "global");
    assert.equal(out.results[0].after.scope, "personal");
  });

  it("rejects a scope outside the allowlist", () => {
    for (const scope of ["system", "regional", "national", "GLOBAL ", "", 7]) {
      const out = assignDtuCustody(mkStore(), { ids: ["d1"], scope }, admin);
      assert.equal(out.ok, false, `scope ${JSON.stringify(scope)}`);
      assert.equal(out.status, 400);
    }
  });

  it("a non-admin cannot set a scope", () => {
    const store = mkStore();
    const out = assignDtuCustody(store, { ids: ["d1"], scope: "user" }, { actor: { userId: "m", id: "m", role: "member" } });
    assert.equal(out.ok, false);
    assert.equal(out.status, 403);
    assert.equal(store.get("d1").scope, "global");
  });
});

describe("seeding paths are wired to founder custody", () => {
  it("seedIfEmpty skips without a founder and stamps seeds private otherwise", () => {
    const src = read("server.js");
    const start = src.indexOf("async function seedIfEmpty()");
    assert.ok(start > 0);
    const body = src.slice(start, src.indexOf("await seedIfEmpty();", start));
    assert.match(body, /founderSeedCustody\(\)/);
    assert.match(body, /founder_user_id_unset/);
    assert.match(body, /seedCustody,\s*\n\s*log:/);
    assert.match(body, /stampFounderSeed\(toOptionADTU\(s\), seedCustody\)/);
    assert.doesNotMatch(body, /s\.scope = "global"/);
    assert.doesNotMatch(body, /scope: "global"/);
  });

  it("POST /api/reseed stamps founder custody and refuses without a founder", () => {
    const src = read("routes/operations.js");
    const start = src.indexOf('app.post("/api/reseed"');
    assert.ok(start > 0);
    const body = src.slice(start, start + 2200);
    assert.match(body, /founderSeedCustody\(\)/);
    assert.match(body, /FOUNDER_USER_ID is not set/);
    assert.match(body, /stampFounderSeed\(toOptionADTU\(s\), seedCustody\)/);
    assert.doesNotMatch(body, /s\.scope = "global"/);
  });
});
