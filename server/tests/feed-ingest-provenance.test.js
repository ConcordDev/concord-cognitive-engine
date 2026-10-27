// Security follow-up to #1610: public-feed provenance, quarantine visibility,
// user-sourced default-private. node --test tests/feed-ingest-provenance.test.js
import { describe, it, before, after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runAsFeedIngest, currentFeedIngest, wrapFeedIngestHandler, stripFeedIngestMarker, feedIngestMarkerFor,
  hasFeedIngestProvenance, isQuarantined, revertUnprovenPublicFeedItems, hideQuarantinedRows,
  privatizeUserSourcedRows, recloseConsolidatedNodes,
} from "../lib/feed-ingest-provenance.js";
import { isClosedPublicFeedItem, backfillPublicFeedItems, asPublicFeedMember } from "../lib/public-feed-sources.js";
import { consolidatedVisibility, memberVisibilityClass, backfillConsolidatedVisibility } from "../lib/consolidated-visibility.js";
import { privateDtuHiddenFrom } from "../lib/dtu-read-access.js";
import { createThreatDTU } from "../lib/concord-shield.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const marker = (source = "crossref-feed") => ({ domain: "paper", action: "feed", source, at: "2026-10-27T20:00:00.000Z" });
// A row the #1610 backfill opened (meta.publicFeed.from === "private").
const opened = (id, extra = {}) => ({
  id, tier: "regular", source: "crossref-feed", tags: ["paper", "feed"], visibility: "public",
  federation_tier: "global", ownerId: "user_x",
  meta: { publicFeed: { source: "crossref-feed", openedAt: "2026-10-27T19:25:00.000Z", from: "private" }, ...(extra.meta || {}) },
  ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "meta")),
});

test("the marker exists only inside a feed ingest, and caller copies are stripped", async () => {
  assert.equal(currentFeedIngest(), null);
  assert.equal(feedIngestMarkerFor("crossref-feed"), null);
  const inside = await runAsFeedIngest({ domain: "paper", action: "feed" }, async () => {
    await new Promise((r) => setTimeout(r, 1));
    return feedIngestMarkerFor("crossref-feed");
  });
  assert.equal(inside.domain, "paper"); assert.equal(inside.action, "feed"); assert.equal(inside.source, "crossref-feed");
  assert.equal(currentFeedIngest(), null, "does not leak out of the run");
  const w = wrapFeedIngestHandler("paper", "feed", async () => currentFeedIngest());
  assert.equal((await w()).domain, "paper");
  assert.deepEqual(stripFeedIngestMarker({ feedIngest: marker(), doi: "x" }), { doi: "x" });
  assert.deepEqual(stripFeedIngestMarker(null), {});
});

test("provenance needs the marker for the row's own allowlisted source", () => {
  assert.equal(hasFeedIngestProvenance({ source: "crossref-feed", meta: { feedIngest: marker() } }), true);
  assert.equal(hasFeedIngestProvenance({ source: "crossref-feed", meta: {} }), false);
  assert.equal(hasFeedIngestProvenance({ source: "poetrydb-feed", meta: { feedIngest: marker() } }), false, "marker for another source");
  assert.equal(hasFeedIngestProvenance({ source: "local", meta: { feedIngest: marker("local") } }), false, "not a public feed");
  assert.equal(hasFeedIngestProvenance({ source: "crossref-feed", meta: { feedIngest: { ...marker(), action: "create" } } }), false);
});

test("the #1610 backfill and member rule ignore rows without the marker", () => {
  const forged = { id: "f", tier: "regular", source: "crossref-feed", tags: ["feed"], visibility: "private", ownerId: "user_x" };
  assert.equal(isClosedPublicFeedItem(forged), false);
  assert.equal(backfillPublicFeedItems({ nodes: [forged], persist: () => {} }).opened, 0);
  assert.equal(forged.visibility, "private");
  assert.equal(asPublicFeedMember(forged).visibility, "private");
  const real = { ...forged, id: "r", meta: { feedIngest: marker() } };
  assert.equal(isClosedPublicFeedItem(real), true);
  assert.equal(isClosedPublicFeedItem({ ...real, tags: ["feed", "quarantine:injection-review"] }), false, "quarantined never opens");
});

test("rows opened without provenance revert to private; proven rows stay; counts and dry run", () => {
  const rows = [opened("a"), opened("b", { meta: { feedIngest: marker() } }), opened("c", { source: "poetrydb-feed" }),
    { id: "n", source: "crossref-feed", visibility: "public", tags: ["feed"] } /* created public, not by the backfill */];
  const dry = revertUnprovenPublicFeedItems({ nodes: rows });
  assert.equal(dry.reverted, 2); assert.equal(dry.kept, 1); assert.equal(rows[0].visibility, "public");
  const saved = [];
  const r = revertUnprovenPublicFeedItems({ nodes: rows, persist: (d) => saved.push(d.id) });
  assert.deepEqual(saved, ["a", "c"]);
  assert.deepEqual(r.revertedBySource, { "crossref-feed": 1, "poetrydb-feed": 1 });
  assert.deepEqual(r.keptBySource, { "crossref-feed": 1 });
  assert.equal(rows[0].visibility, "private"); assert.equal(rows[0].federation_tier, "local");
  assert.equal(rows[0].meta.publicFeed.revertReason, "no_feed_ingest_provenance");
  assert.equal(rows[1].visibility, "public");
  assert.equal(rows[3].visibility, "public", "only backfill-opened rows are touched");
  assert.equal(revertUnprovenPublicFeedItems({ nodes: rows, persist: () => {} }).reverted, 0, "idempotent");
  assert.equal(backfillPublicFeedItems({ nodes: rows, persist: () => {} }).opened, 0, "the backfill does not reopen them");
});

test("quarantine:* is never public: hidden at boot, never a public member, never opened, never listed", () => {
  assert.equal(isQuarantined({ tags: ["x", "quarantine:injection-review"] }), true);
  assert.equal(isQuarantined({ tags: ["quarantined"] }), false);
  const sysMega = { id: "dtu_093f", tier: "mega", visibility: "public", ownerId: "system", tags: ["quarantine:injection-review"] };
  const userRow = { id: "u", tier: "regular", visibility: "public", ownerId: "user_x", tags: ["quarantine:injection-review"] };
  const clean = { id: "c", visibility: "public", tags: ["note"] };
  const r = hideQuarantinedRows({ nodes: [sysMega, userRow, clean], persist: () => {} });
  assert.deepEqual(r.hiddenIds, ["dtu_093f", "u"]);
  assert.equal(sysMega.visibility, "internal");
  assert.equal(userRow.visibility, "private", "a user's own quarantined row stays readable by them");
  assert.equal(clean.visibility, "public");
  assert.equal(memberVisibilityClass({ visibility: "public", tags: ["quarantine:x"] }), "private");
  assert.equal(consolidatedVisibility([clean, { visibility: "public", tags: ["quarantine:x"] }]).visibility, "private");
  const qMega = { id: "q", tier: "mega", visibility: "internal", createdAt: "2026-10-27T19:00:00.000Z", tags: ["quarantine:x"], lineage: { parents: ["c"] } };
  assert.equal(backfillConsolidatedVisibility({ nodes: [qMega], loadMember: () => clean, since: "2026-10-27T04:00:00.000Z", persist: () => {} }).opened, 0);
  assert.equal(privateDtuHiddenFrom({ visibility: "public", tags: ["quarantine:x"], ownerId: "user_x" }, "someone"), true);
  assert.equal(privateDtuHiddenFrom({ visibility: "public", tags: ["quarantine:x"], ownerId: "user_x" }, "user_x"), false);
  assert.equal(privateDtuHiddenFrom({ visibility: "public", tags: ["quarantine:x"], ownerId: "system" }, null), true);
});

test("a user-sourced row with no visibility is private (threat reports)", () => {
  const t = createThreatDTU({ subtype: "exploit", severity: 5, hash: { sha256: "a".repeat(64) }, source: "user:u1", tags: ["user_reported"] });
  assert.equal(t.visibility, "private");
  assert.equal(createThreatDTU({ subtype: "exploit", severity: 5, hash: { sha256: "b".repeat(64) }, source: "shield" }).visibility, undefined, "shield detections unchanged");
  const legacy = { id: "threat_5517c8e7", source: "user:u1", scope: "global", ownerId: "system" };
  assert.equal(privateDtuHiddenFrom(legacy, "someone"), true);
  const r = privatizeUserSourcedRows({ nodes: [legacy, { id: "s", source: "shield", scope: "global" }, { id: "v", source: "user:u2", visibility: "public" }], persist: () => {} });
  assert.deepEqual(r.ids, ["threat_5517c8e7"]);
  assert.equal(legacy.visibility, "private");
});

test("megas/hypers opened by the #1599 rule re-close when a member is no longer public; all-public ones stay", () => {
  const rule = { visibilityRule: { rule: "consolidated_members_v1", reason: "all_public" } };
  const store = new Map();
  const pub = { id: "p", visibility: "public", tags: [] };
  const reverted = { id: "rv", visibility: "private", ownerId: null, tags: ["feed"] };
  [pub, reverted].forEach((d) => store.set(d.id, d));
  const megaBad = { id: "m1", tier: "mega", visibility: "public", scope: "global", meta: { ...rule }, lineage: { parents: ["p", "rv"] } };
  const megaOk = { id: "m2", tier: "mega", visibility: "public", scope: "global", meta: { ...rule }, lineage: { parents: ["p"] } };
  const hyper = { id: "h", tier: "hyper", visibility: "public", scope: "global", meta: { ...rule }, lineage: { parents: ["m1", "m2"] } };
  const untouched = { id: "m3", tier: "mega", visibility: "public", lineage: { parents: ["rv"] } };
  [megaBad, megaOk, hyper, untouched].forEach((d) => store.set(d.id, d));
  const r = recloseConsolidatedNodes({ nodes: [hyper, megaBad, megaOk, untouched], loadMember: (id) => store.get(id), persist: () => {} });
  assert.deepEqual(r.closedIds, ["m1", "h"], "mega first, then the hyper sees it");
  assert.equal(megaBad.visibility, "private");
  assert.equal(megaOk.visibility, "public");
  assert.equal(hyper.visibility, "private");
  assert.equal(untouched.visibility, "public", "only rule-set nodes are re-checked");
});

test("server.js wires the wrapper, the create strip, the edit guard and the boot steps", () => {
  const src = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.ok(src.includes('if (action === "feed") handler = wrapFeedIngestHandler(domain, action, handler);'));
  assert.ok(src.includes("const meta = stripFeedIngestMarker("));
  assert.ok(src.includes("...stripFeedIngestMarker(sourceDtu.meta || {}),"), "fork drops the marker");
  for (const ev of ["public_feed_provenance_revert", "quarantine_visibility_hide", "user_sourced_visibility_default", "consolidated_visibility_reclose"]) {
    assert.ok(src.includes(`"${ev}"`), ev);
  }
  assert.ok(src.indexOf('"public_feed_provenance_revert"') < src.indexOf('"public_feed_backfill"'));
  assert.ok(src.indexOf('"consolidated_visibility_reclose"') < src.indexOf('"consolidated_visibility_backfill"'));
});

describe("through the macro runtime", () => {
  let runMacro, makeCtx, STATE;
  const created = [];
  const req = (user) => ({ user, ip: "127.0.0.1", method: "POST", path: "/api/dtus", headers: {}, query: {}, get: () => "" });
  const userCtx = (id) => makeCtx(req({ id, role: "member" }));
  before(async () => {
    const { load } = await import("./depth/_harness.js");
    ({ runMacro, makeCtx, STATE } = await load());
  });
  after(() => { for (const id of created) { try { STATE.dtus.delete(id); } catch { /* test cleanup */ } } });

  it("a user cannot set meta.feedIngest on create", async () => {
    const r = await runMacro("dtu", "create", {
      title: "Forged feed provenance attempt", creti: "Forged body\n\nDOI: 10.0000/forged",
      tags: ["paper", "feed"], source: "crossref-feed",
      meta: { feedIngest: marker(), doi: "10.0000/forged" },
    }, userCtx("user_forger"));
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    created.push(r.dtu.id);
    {
      const d = STATE.dtus.get(r.dtu.id);
      assert.equal(d.meta.feedIngest, undefined, "stripped");
      assert.equal(d.visibility, "private");
      assert.equal(isClosedPublicFeedItem(d), false, "the backfill will not open it");
    }
  });

  it("the registered poetry.feed action stamps the marker on what it ingests", async () => {
    const handler = globalThis.__concordLensActions.get("poetry.feed");
    assert.equal(handler.__feedIngest, true, "registerLensAction wrapped the feed action");
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [
      { title: "Provenance Test Poem " + Date.now(), author: "Test Author", lines: ["one line of verse", "two lines of verse", "three lines"] },
    ] });
    try {
      const r = await handler(userCtx("user_feed_runner2"), { data: {} }, { limit: 1 });
      assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
      const ids = r.result.dtuIds || [];
      assert.ok(ids.length >= 1, "ingested one poem: " + JSON.stringify(r.result));
      created.push(...ids);
      if (ids.length) {
        const d = STATE.dtus.get(ids[0]);
        assert.equal(d.meta.feedIngest.domain, "poetry");
        assert.equal(d.meta.feedIngest.source, "poetrydb-feed");
        assert.equal(hasFeedIngestProvenance(d), true);
        assert.equal(d.visibility, "public");
      }
    } finally { globalThis.fetch = realFetch; }
  });

  it("a member edit cannot drop a quarantine tag", async () => {
    const r = await runMacro("dtu", "create", { title: "Quarantine edit test note", creti: "Some note body for the edit test", tags: ["note"] }, userCtx("user_q"));
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    created.push(r.dtu.id);
    const d = STATE.dtus.get(r.dtu.id);
    d.tags = [...d.tags, "quarantine:injection-review"]; STATE.dtus.set(d.id, d);
    const u = await runMacro("dtu", "update", { id: d.id, tags: ["note"] }, userCtx("user_q"));
    assert.equal(u.ok, true, JSON.stringify(u).slice(0, 300));
    assert.ok(STATE.dtus.get(d.id).tags.includes("quarantine:injection-review"));
  });
});
