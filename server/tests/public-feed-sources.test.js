import { describe, it, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PUBLIC_FEED_SOURCES, PRIVATE_FEED_LABELS, isPublicFeedSource, isClosedPublicFeedItem,
  backfillPublicFeedItems, asPublicFeedMember,
} from "../lib/public-feed-sources.js";
import { consolidatedVisibility, backfillConsolidatedVisibility } from "../lib/consolidated-visibility.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const feedRow = (id, extra = {}) => ({
  id, tier: "regular", source: "crossref-feed", tags: ["paper", "feed", "crossref"],
  visibility: "private", scope: "local", federation_tier: "local", ownerId: "user_feed", ...extra,
});

test("every *-feed dtu.create source in server/domains is classified, and public ones are saved public", () => {
  const dir = path.join(root, "domains");
  const seen = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      const m = line.match(/^\s*source:\s*"([a-z0-9.-]+-feed)",\s*$/);
      if (!m) return;
      const src = m[1];
      const before = lines.slice(Math.max(0, i - 12), i).join("\n");
      const isCreate = before.includes('"dtu", "create"');
      if (!isCreate) return;
      seen.add(src);
      assert.ok(PUBLIC_FEED_SOURCES.has(src) || PRIVATE_FEED_LABELS.has(src), `${f}:${i + 1} ${src} is not classified in lib/public-feed-sources.js`);
      const next = lines.slice(i + 1, i + 3).join("\n");
      if (PUBLIC_FEED_SOURCES.has(src)) {
        assert.match(next, /visibility: "public", visibilityScope: "global"/, `${f}:${i + 1} ${src} must be created public/global`);
      } else {
        assert.doesNotMatch(next, /visibility: "public"/, `${f}:${i + 1} ${src} is private`);
      }
    });
  }
  assert.ok(seen.size >= 35, `expected the domain feeds, saw ${seen.size}`);
  assert.ok(seen.has("crossref-feed") && seen.has("poetrydb-feed") && seen.has("stack-exchange-feed") && seen.has("zenquotes-feed"));
});

test("user-connected or user-owned sources are never public feeds", () => {
  for (const s of ["wired-feed", "local", "user", "chat", "upload", "email", "gmail", "dm", "whiteboard", "notion-import", "poetrydb", "crossref", "", null, undefined, {}]) {
    assert.equal(isPublicFeedSource(s), false, String(s));
  }
});

test("only closed, feed-tagged regular rows from an allowlisted source are opened", () => {
  assert.equal(isClosedPublicFeedItem(feedRow("a")), true);
  assert.equal(isClosedPublicFeedItem(feedRow("b", { source: "local" })), false, "not a public feed");
  assert.equal(isClosedPublicFeedItem(feedRow("c", { tags: ["paper"] })), false, "no feed tag");
  assert.equal(isClosedPublicFeedItem(feedRow("d", { privacy: "private" })), false, "privacy private");
  assert.equal(isClosedPublicFeedItem(feedRow("e", { privacy: "followers-only" })), false);
  assert.equal(isClosedPublicFeedItem(feedRow("f", { scope: "user" })), false, "user scope");
  assert.equal(isClosedPublicFeedItem(feedRow("g", { visibility: "internal" })), false, "internal is a system decision");
  assert.equal(isClosedPublicFeedItem(feedRow("h", { visibility: "public" })), false, "already public");
  assert.equal(isClosedPublicFeedItem(feedRow("i", { tier: "mega" })), false);
});

test("backfill opens feed rows (public, federation global), counts by source, dry-run and idempotent", () => {
  const rows = [feedRow("a"), feedRow("b", { source: "poetrydb-feed", tags: ["poetry", "feed"] }), feedRow("c", { source: "local" }), feedRow("d", { privacy: "private" })];
  const dry = backfillPublicFeedItems({ nodes: rows });
  assert.deepEqual(dry, { opened: 2, bySource: { "crossref-feed": 1, "poetrydb-feed": 1 }, dryRun: true });
  assert.equal(rows[0].visibility, "private");
  const saved = [];
  const r = backfillPublicFeedItems({ nodes: rows, persist: (d) => saved.push(d.id) });
  assert.equal(r.opened, 2);
  assert.deepEqual(saved, ["a", "b"]);
  assert.equal(rows[0].visibility, "public");
  assert.equal(rows[0].federation_tier, "global");
  assert.equal(rows[0].ownerId, "user_feed", "owner unchanged");
  assert.equal(rows[0].meta.publicFeed.from, "private");
  assert.equal(rows[2].visibility, "private");
  assert.equal(rows[3].visibility, "private");
  assert.equal(backfillPublicFeedItems({ nodes: rows, persist: () => {} }).opened, 0);
});

test("archived feed members count as public; a user's private member still closes the mega", () => {
  assert.equal(consolidatedVisibility([asPublicFeedMember(feedRow("a")), asPublicFeedMember(feedRow("b"))]).visibility, "public");
  const userNote = { id: "n", tier: "regular", source: "local", tags: ["note"], visibility: "private", ownerId: "user_feed" };
  assert.equal(consolidatedVisibility([asPublicFeedMember(feedRow("a")), asPublicFeedMember(userNote)]).visibility, "private");
});

test("consolidated backfill opens a gap-promotion mega that inherited a user owner, never a chat mega", () => {
  const store = new Map();
  [feedRow("a"), feedRow("b")].forEach((d) => store.set(d.id, d));
  const today = "2026-10-27T19:10:00.000Z";
  const gap = { id: "gap", tier: "mega", visibility: "private", ownerId: "user_feed", createdAt: today, lineage: { parents: ["a", "b"], kind: "gap_promotion" } };
  const chat = { id: "mega_chat_1", tier: "mega", visibility: "private", ownerId: "user_feed", createdAt: today, lineage: { parents: ["a", "b"] } };
  const r = backfillConsolidatedVisibility({
    nodes: [gap, chat],
    loadMember: (id) => { const m = store.get(id); return m ? asPublicFeedMember(m) : null; },
    since: "2026-10-27T04:00:00.000Z",
    persist: () => {},
  });
  assert.deepEqual(r.openedIds, ["gap"]);
  assert.equal(gap.visibility, "public");
  assert.equal(chat.visibility, "private");
});

test("server.js gives public feed items the personal-save bar at both council gates and runs the backfill with an off switch", () => {
  const src = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.ok(src.includes('const _publicFeedItem = isPublicFeedSource(source) && dtu.visibility === "public";'));
  assert.equal(src.split("...(_publicFeedItem ? { minScore: 1 } : {})").length - 1, 2, "dtu.create gate and pipelineCommitDTU");
  assert.ok(src.includes('process.env.PUBLIC_FEED_BACKFILL'));
  assert.ok(src.includes('structuredLog("info", "public_feed_backfill", fb);'));
  assert.ok(src.indexOf('"public_feed_backfill"') < src.indexOf('"consolidated_visibility_backfill"'), "feed rows open before megas are re-evaluated");
});

describe("dtu.create through the macro runtime", () => {
  let runMacro, makeCtx, STATE;
  const req = (user) => ({ user, ip: "127.0.0.1", method: "POST", path: "/api/dtus", headers: {}, query: {}, get: () => "" });
  const userCtx = (id) => makeCtx(req({ id, role: "member" }));
  before(async () => {
    const { load } = await import("./depth/_harness.js");
    ({ runMacro, makeCtx, STATE } = await load());
  });

  it("a public feed item is saved public/global and another user can read and list it", async () => {
    const r = await runMacro("dtu", "create", {
      title: "A public Crossref work for the feed rule test",
      creti: "A public Crossref work\n\nAuthors: A. Author\nVenue: Journal\nDOI: 10.0000/feedrule",
      tags: ["paper", "feed", "crossref"],
      source: "crossref-feed",
      visibility: "public", visibilityScope: "global",
      meta: { doi: "10.0000/feedrule" },
    }, userCtx("user_feed_runner"));
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    const d = STATE.dtus.get(r.dtu.id);
    assert.equal(d.visibility, "public");
    assert.equal(d.federation_tier, "global");
    const other = await runMacro("dtu", "get", { id: d.id }, userCtx("someone_else"));
    assert.equal(other.ok, true, "another user can open it");
    const list = await runMacro("dtu", "list", { limit: 5000 }, userCtx("someone_else"));
    const rows = list.dtus || list.items || list.result?.dtus || [];
    assert.ok(rows.some((x) => x.id === d.id), "another user can list it");
  });

  it("a private note with no visibility stays private and hidden from other users", async () => {
    const r = await runMacro("dtu", "create", {
      title: "My private note for the feed rule test",
      creti: "My private note body",
      tags: ["note"],
    }, userCtx("user_note_owner"));
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    const d = STATE.dtus.get(r.dtu.id);
    assert.equal(d.visibility, "private");
    const other = await runMacro("dtu", "get", { id: d.id }, userCtx("someone_else"));
    assert.notEqual(other.ok, true, "hidden from another user");
  });

  it("the feed bar does not apply to a public non-feed save", async () => {
    const r = await runMacro("dtu", "create", {
      title: "A public note without substance",
      creti: "x",
      tags: ["note"],
      source: "local",
      visibility: "public",
    }, userCtx("user_note_owner"));
    if (r.ok) assert.notEqual(r.dtu?.source, "crossref-feed");
    else assert.equal(r.error, "Council rejected DTU", "public bar still applies to authored content");
  });
});
