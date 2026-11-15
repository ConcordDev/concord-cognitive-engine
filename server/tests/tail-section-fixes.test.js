// B6 Slice-B5 tail — server pins for FIX-mail-018, FIX-legacy-003,
// FIX-society-009, FIX-research-008, FIX-tick-003, FIX-ocean-009.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { sendMail, claimAttachments, deleteSentMail } from "../lib/player-mail.js";
import { selectGlobalFeed } from "../lib/global-feed.js";
import { lensRun, depthCtx } from "./depth/_harness.js";

// ── FIX-mail-018: claimed mail can leave the sender's Sent list ──────
function seedUser(db, id, cc = 0) {
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, created_at, concordia_credits)
     VALUES (?, ?, ?, 'x', unixepoch(), ?)`,
  ).run(id, `u_${id}`, `${id}@example.test`, cc);
}
function ccOf(db, userId) {
  return Number(db.prepare(`SELECT concordia_credits FROM users WHERE id = ?`).get(userId)?.concordia_credits) || 0;
}

describe("FIX-mail-018 — remove from Sent on claimed mail", () => {
  let db;
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    seedUser(db, "u1", 500);
    seedUser(db, "u2", 200);
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("a claimed mail leaves the sender's Sent list; the row and its claim record persist, nothing refunds", () => {
    const sent = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "gift", body: "hi", attachmentCc: 50 });
    assert.equal(sent.ok, true);
    const mailId = sent.id;
    const claim = claimAttachments(db, mailId, "u2");
    assert.equal(claim.ok, true);
    const u1Before = ccOf(db, "u1");
    const u2Before = ccOf(db, "u2");

    const del = deleteSentMail(db, mailId, "u1");
    assert.equal(del.ok, true, JSON.stringify(del));
    assert.equal(del.deleted, true);
    assert.equal(del.refundedCc, 0);

    const row = db.prepare(`SELECT status, attachment_cc AS acc, sender_deleted_at AS sda FROM player_mail WHERE id = ?`).get(mailId);
    assert.equal(row.status, "claimed");
    assert.equal(row.acc, 50, "the claim record (attachment_cc) is not zeroed by a view removal");
    assert.ok(row.sda, "sender_deleted_at is set");
    assert.equal(ccOf(db, "u1"), u1Before);
    assert.equal(ccOf(db, "u2"), u2Before);
    // The Sent list macro filters `sender_deleted_at IS NULL` — the row
    // no longer satisfies it, so it is gone from the sender's Sent list.
    const visible = db.prepare(`SELECT COUNT(*) AS n FROM player_mail WHERE id = ? AND from_user_id = 'u1' AND sender_deleted_at IS NULL`).get(mailId);
    assert.equal(visible.n, 0, "gone from the sender's Sent list");
  });

  it("an unclaimed mail still refunds its escrow on removal (pre-existing behaviour)", () => {
    const sent = sendMail(db, { fromUserId: "u1", toUserId: "u2", subject: "gift", body: "hi", attachmentCc: 30 });
    assert.equal(sent.ok, true);
    const before = ccOf(db, "u1");
    const del = deleteSentMail(db, sent.id, "u1");
    assert.equal(del.ok, true);
    assert.equal(del.refundedCc, 30);
    assert.equal(ccOf(db, "u1"), before + 30);
  });
});

// ── FIX-ocean-009: a lens feed never pulls another lens's publications ──
describe("FIX-ocean-009 — global feed lens scoping", () => {
  const base = { isGlobal: true, scope: "global", createdAt: "2026-11-01T00:00:00Z" };
  const rows = [
    { ...base, id: "cross-tagged", meta: { publishedFromLens: "health" }, tags: ["ocean"] },
    { ...base, id: "own", meta: { publishedFromLens: "ocean" }, tags: [] },
    { ...base, id: "originless-tag", meta: {}, tags: ["ocean"] },
    { ...base, id: "originless-domain", meta: { domain: "ocean" }, tags: [] },
    { ...base, id: "cross-domain", meta: { publishedFromLens: "health", domain: "ocean" }, tags: [] },
    { ...base, id: "other", meta: { publishedFromLens: "health" }, tags: ["health"] },
  ];
  const feed = selectGlobalFeed(rows, {
    viewerId: null,
    isHidden: () => false,
    isPrivateFrom: () => false,
    isShadow: () => false,
    lensId: "ocean",
  });
  const ids = feed.map((d) => d.id);
  it("excludes rows published from a different lens even when tag/domain match", () => {
    assert.equal(ids.includes("cross-tagged"), false);
    assert.equal(ids.includes("cross-domain"), false);
  });
  it("keeps the lens's own publications and origin-less tag/domain matches", () => {
    assert.equal(ids.includes("own"), true);
    assert.equal(ids.includes("originless-tag"), true);
    assert.equal(ids.includes("originless-domain"), true);
    assert.equal(ids.includes("other"), false);
  });
});

// ── FIX-legacy-003: extension-less snippets are sniffed ──────────────
describe("FIX-legacy-003 — language detection", () => {
  it("plain JS without a file header detects as JavaScript, not Unknown", async () => {
    const r = await lensRun("legacy", "scanCodebase", {
      params: { name: "snips", files: [{ path: "snippet", content: "var x = 1;\nconsole.log(x);" }] },
    }, await depthCtx("tail:legacy"));
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
    const langs = r.result.codebase?.languages || [];
    const js = langs.find((l) => l.language === "JavaScript");
    assert.ok(js, `expected JavaScript in ${JSON.stringify(langs)}`);
    assert.equal(js.pctOfCodebase, 100);
  });
  it("content with no known signature still reports Unknown", async () => {
    const r = await lensRun("legacy", "scanCodebase", {
      params: { name: "snips2", files: [{ path: "notes", content: "the quick brown fox jumps over" }] },
    }, await depthCtx("tail:legacy"));
    assert.equal(r.ok, true);
    const langs = r.result.codebase?.languages || [];
    assert.ok(langs.some((l) => l.language === "Unknown"), JSON.stringify(langs));
  });
});

// ── FIX-society-009 / FIX-research-008 ─────────────────────────────────
// These macros fetch through the SSRF-guarded public transport, which
// refuses this sandbox's DNS before any stub can run (the shipped
// society suite pins only pre-network branches for the same reason).
// The ranking / name logic therefore lives in pure libs the domains
// call, and is pinned here directly — the exact production functions.
import { searchIndicatorCatalog } from "../lib/wb-catalog-search.js";
import { crossrefAuthorName } from "../lib/crossref-authors.js";

describe("FIX-society-009 — catalog search ranking (pure lib)", () => {
  const catalog = [
    { id: "AG.LND.AGRI.ZS", name: "Agricultural land (% of land area)", source: { value: "WB" }, topics: [] },
    { id: "SP.POP.TOTL", name: "Population, total", source: { value: "WB" }, topics: [] },
    { id: "SP.POP.65UP.TO", name: "Population ages 65 and above, total", source: { value: "WB" }, topics: [] },
    { id: "EG.USE.ELEC.KH.PC", name: "Access to electricity (% of population)", source: { value: "WB" }, topics: [] },
  ];
  const fakeWb = async (url) => {
    if (url.includes("/indicator/SP.POP.TOTL")) return [{}, [catalog[1]]];
    if (url.includes("/indicator?")) return [{}, catalog];
    return [{}, []];
  };
  it("an exact code returns first and is not duplicated by the scan", async () => {
    const matches = await searchIndicatorCatalog(fakeWb, "https://api.worldbank.org/v2", "sp.pop.totl", 40);
    assert.equal(matches[0].code, "SP.POP.TOTL");
    assert.equal(matches.filter((m) => m.code === "SP.POP.TOTL").length, 1);
  });
  it("free-text ranks name-prefix above loose contains, whatever the catalog order", async () => {
    const matches = await searchIndicatorCatalog(fakeWb, "https://api.worldbank.org/v2", "population", 40);
    assert.equal(matches[0].code, "SP.POP.TOTL", "Population, total (name prefix) outranks Access to electricity (contains-only)");
    assert.equal(matches[matches.length - 1].code, "EG.USE.ELEC.KH.PC");
  });
  it("matches past an early limit are still found (collect-then-rank, no early stop)", async () => {
    const matches = await searchIndicatorCatalog(fakeWb, "https://api.worldbank.org/v2", "population", 2);
    assert.deepEqual(matches.map((m) => m.code), ["SP.POP.TOTL", "SP.POP.65UP.TO"]);
  });
});

describe("FIX-research-008 — CrossRef swapped author fields (pure lib)", () => {
  it("a surname sitting in the given slot is swapped back", () => {
    assert.equal(crossrefAuthorName({ given: "Liu", family: "Yuting" }), "Yuting Liu");
    assert.equal(crossrefAuthorName({ given: "Zhang", family: "Ming" }), "Ming Zhang");
  });
  it("correctly-recorded names are untouched, any origin", () => {
    assert.equal(crossrefAuthorName({ given: "Yuting", family: "Liu" }), "Yuting Liu");
    assert.equal(crossrefAuthorName({ given: "Ming", family: "Zhang" }), "Ming Zhang");
    assert.equal(crossrefAuthorName({ given: "Jane", family: "Smith" }), "Jane Smith");
    assert.equal(crossrefAuthorName({ given: "Wei", family: "Chen" }), "Wei Chen", "both tokens surnames → no swap");
    assert.equal(crossrefAuthorName({ name: "Consortium X" }), "Consortium X");
  });
});

// ── FIX-tick-003: the latency histogram reads real timings ───────────
describe("FIX-tick-003 — latency histogram fallback", () => {
  it("with no usable recorded durations and no timings, the honest empty state carries its source", async () => {
    const ctx = await depthCtx("tail:tick-a");
    await lensRun("tick", "recordSample", { params: { ticks: 5, tickDurationMs: 0 } }, ctx);
    const r = await lensRun("tick", "latencyHistogram", { params: {} }, ctx);
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
    assert.ok("source" in r.result, "result names its data source");
  });
  it("real heartbeat timings feed the percentiles when recorded samples carry none", async () => {
    const registry = await import("../emergent/heartbeat-registry.js");
    registry.registerHeartbeat("tail-test-module", {
      frequency: 1, scope: "global",
      handler: async () => { await new Promise((res) => setTimeout(res, 5)); },
    });
    await registry.tickAllRegistered({});
    const ctx = await depthCtx("tail:tick-b");
    const r = await lensRun("tick", "latencyHistogram", { params: {} }, ctx);
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
    assert.equal(r.result.source, "heartbeat-timing");
    assert.ok(r.result.sampleCount >= 1, `sampleCount ${r.result.sampleCount}`);
    assert.ok(r.result.percentiles.p95 > 0, "p95 computes from real measured durations");
  });
});
