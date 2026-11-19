// tests/depth/market-house-behavior.test.js
//
// The Auction House (Market lens) on the real server: lots are economy
// listings, sales move Concord Coin on economy_ledger, the showcase is a
// drawing anyone can redo, and the pay board holds rewards in escrow.
// Money is checked by balances read back from the ledger, never by what a
// macro says it did.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";
import { setLedgerBalance } from "../lib/ledger-fund.js";
import { getBalance } from "../../economy/balances.js";
import { calculateFee } from "../../economy/fees.js";
import { drawWinners, ensureDraw, hourKey, WINNERS_PER_HOUR } from "../../domains/market-showcase.js";
import { sweepExpired, ESCROW } from "../../domains/market-board.js";

let STATE, runMacro, db;
const bal = (id) => getBalance(db, id).balance;
const PLATFORM = "__PLATFORM__";
const r2 = (n) => Math.round(n * 100) / 100;

async function makeDtu(ctx, over = {}) {
  const r = await runMacro("dtu", "create", {
    title: over.title || `Field notes ${Math.random().toString(36).slice(2, 7)}`,
    content: over.content || "Shear walls carry lateral load to the foundation. Openings weaken them.",
    tags: over.tags || ["structures"],
    domain: over.domain || "engineering",
    ...(over.core ? { core: over.core } : {}),
  }, ctx);
  assert.equal(r?.ok, true, JSON.stringify(r).slice(0, 300));
  return r.dtu.id;
}
const house = (action, params, ctx) => lensRun("market", action, { params }, ctx);

before(async () => {
  ({ STATE, runMacro } = await load());
  db = STATE.db;
});

describe("market — lots: consign, find, buy", () => {
  it("consigns an owned DTU and the catalogue finds it by search, domain, tag and price, with facets", async () => {
    const seller = await depthCtx("mh-seller-a");
    const id = await makeDtu(seller, { title: "Glulam beam sizing table", domain: "engineering", tags: ["timber", "beams"] });
    const c = await house("house-consign", { dtuId: id, price: 12.5, license: "nonexclusive", description: "Spans to 8 m." }, seller);
    assert.equal(c.ok, true, JSON.stringify(c));
    const lot = c.result.lot;
    assert.equal(lot.kind, "dtu");
    assert.equal(lot.price, 12.5);
    assert.equal(lot.domain, "engineering");
    assert.deepEqual(lot.tags, ["timber", "beams"]);
    assert.match(lot.excerpt, /Shear walls/);
    assert.equal(lot.cover, null);

    const find = async (p) => (await house("house-catalogue", p, seller)).result;
    assert.ok((await find({ q: "glulam" })).lots.some((l) => l.id === lot.id));
    assert.ok((await find({ domain: "engineering", tag: "timber" })).lots.some((l) => l.id === lot.id));
    assert.ok(!(await find({ priceMax: 10 })).lots.some((l) => l.id === lot.id));
    assert.ok((await find({ priceMin: 12, priceMax: 13 })).lots.some((l) => l.id === lot.id));
    const all = await find({ domain: "engineering" });
    assert.ok(all.facets.domain.some((f) => f.value === "engineering" && f.count >= 1));
    // a facet counts lots matching every OTHER filter, so the domain facet still lists other domains
    assert.ok(Array.isArray(all.facets.kind));
    const asc = (await find({ sort: "price_asc", pageSize: 60 })).lots.map((l) => l.price);
    assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
  });

  it("a sale debits the buyer, pays the seller net of the market fee, and opens the DTU only to them", async () => {
    const seller = await depthCtx("mh-seller-b");
    const buyer = await depthCtx("mh-buyer-b");
    const stranger = await depthCtx("mh-stranger-b");
    const id = await makeDtu(seller, { title: "Rebar lap lengths" });
    const lot = (await house("house-consign", { dtuId: id, price: 20, license: "nonexclusive" }, seller)).result.lot;
    setLedgerBalance(db, "mh-buyer-b", 100);
    const before = { buyer: bal("mh-buyer-b"), seller: bal("mh-seller-b"), platform: bal(PLATFORM) };

    assert.equal((await house("house-open", { lotId: lot.id }, buyer)).error, "not_purchased");
    const stale = await house("house-buy", { id: lot.id, expectPrice: 19 }, buyer);
    assert.equal(stale.error, "price_changed");
    assert.equal(bal("mh-buyer-b"), before.buyer, "a refused buy moves nothing");

    const r = await house("house-buy", { id: lot.id, expectPrice: 20 }, buyer);
    assert.equal(r.ok, true, JSON.stringify(r));
    const fee = calculateFee("MARKETPLACE_PURCHASE", 20);
    assert.equal(bal("mh-buyer-b"), r2(before.buyer - 20));
    assert.equal(bal("mh-seller-b"), r2(before.seller + fee.net));
    assert.equal(r2(bal(PLATFORM) - before.platform), fee.fee);
    assert.equal(r.result.balance, bal("mh-buyer-b"));

    const opened = await house("house-open", { lotId: lot.id }, buyer);
    assert.equal(opened.ok, true);
    assert.equal(opened.result.dtu.title, "Rebar lap lengths");
    assert.equal((await house("house-open", { lotId: lot.id }, stranger)).error, "not_purchased");
    assert.equal((await house("house-buy", { id: lot.id }, buyer)).error, "already_owned");
    assert.equal(bal("mh-buyer-b"), r2(before.buyer - 20), "a second buy does not charge again");

    const lib = await house("house-library", {}, buyer);
    assert.ok(lib.result.bought.some((b) => b.id === lot.id && b.paid === 20));
    const mine = await house("house-mine", {}, seller);
    assert.equal(mine.result.lots.find((l) => l.id === lot.id).sold, 1);
    const trend = await house("house-trending", { window: "24h" }, stranger);
    const t = trend.result.lots.find((l) => l.id === lot.id);
    assert.equal(t.windowSales, 1);
    assert.equal(t.windowRevenue, 20);
  });

  it("refuses what is not the seller's to sell, and what the buyer cannot pay for", async () => {
    const owner = await depthCtx("mh-owner-c");
    const thief = await depthCtx("mh-thief-c");
    const id = await makeDtu(owner, { title: "Truss joint catalogue" });
    assert.equal((await house("house-consign", { dtuId: id, price: 5 }, thief)).error, "not_owner");
    assert.equal((await house("house-consign", { dtuId: "dtu_does_not_exist", price: 5 }, owner)).error, "dtu_not_found");
    assert.equal((await house("house-consign", { dtuId: id, price: -1 }, owner)).error, "invalid_price");
    assert.equal((await house("house-consign", { dtuId: id, price: 0, license: "exclusive" }, owner)).error, "exclusive_needs_price");
    assert.equal((await house("house-consign", { dtuId: id, price: 5, license: "stolen" }, owner)).error, "invalid_license");

    // a bought copy carries meta.purchasedFrom: not the holder's to resell
    const copyId = await makeDtu(thief, { title: "Copied catalogue" });
    STATE.dtus.get(copyId).meta.purchasedFrom = id;
    assert.equal((await house("house-consign", { dtuId: copyId, price: 5 }, thief)).error, "bought_copy");

    // a cover must be an image the seller uploaded
    const textDtu = await makeDtu(owner, { title: "Not an image" });
    assert.equal((await house("house-consign", { dtuId: id, price: 5, coverArtifactId: textDtu }, owner)).error, "cover_not_image");
    const othersDtu = await makeDtu(thief, { title: "Someone else's" });
    assert.equal((await house("house-consign", { dtuId: id, price: 5, coverArtifactId: othersDtu }, owner)).error, "cover_not_found");

    const lot = (await house("house-consign", { dtuId: id, price: 5 }, owner)).result.lot;
    assert.equal((await house("house-consign", { dtuId: id, price: 7 }, owner)).error, "duplicate_content");
    assert.equal((await house("house-buy", { id: lot.id }, owner)).error, "cannot_buy_own_listing");

    setLedgerBalance(db, "mh-thief-c", 2);
    const poor = await house("house-buy", { id: lot.id }, thief);
    assert.equal(poor.error, "insufficient_balance");
    assert.equal(bal("mh-thief-c"), 2);
    assert.equal((await house("house-withdraw", { id: lot.id }, thief)).ok, false, "only the seller withdraws");
    assert.equal((await house("house-reprice", { id: lot.id, price: 1 }, thief)).ok, false, "only the seller reprices");
  });

  it("an exclusive lot sells once; withdrawn and repriced lots behave", async () => {
    const seller = await depthCtx("mh-seller-d");
    const a = await depthCtx("mh-buyer-d1");
    const b = await depthCtx("mh-buyer-d2");
    const id = await makeDtu(seller, { title: "One-off survey" });
    const lot = (await house("house-consign", { dtuId: id, price: 30, license: "exclusive" }, seller)).result.lot;
    setLedgerBalance(db, "mh-buyer-d1", 50);
    setLedgerBalance(db, "mh-buyer-d2", 50);
    const sold = await house("house-buy", { id: lot.id }, a);
    assert.equal(sold.result.lotStatus, "sold");
    assert.equal((await house("house-buy", { id: lot.id }, b)).error, "lot_not_found");
    assert.equal(bal("mh-buyer-d2"), 50);
    assert.ok(!(await house("house-catalogue", { q: "One-off survey" }, b)).result.lots.length);

    const id2 = await makeDtu(seller, { title: "Repriced notes" });
    const lot2 = (await house("house-consign", { dtuId: id2, price: 9 }, seller)).result.lot;
    assert.equal((await house("house-reprice", { id: lot2.id, price: 4.5 }, seller)).result.lot.price, 4.5);
    assert.equal((await house("house-buy", { id: lot2.id, expectPrice: 9 }, a)).error, "price_changed");
    assert.equal((await house("house-withdraw", { id: lot2.id }, seller)).ok, true);
    assert.equal((await house("house-buy", { id: lot2.id }, a)).error, "lot_not_found");
  });
});

describe("market — the hourly showcase is a drawing anyone can redo", () => {
  it("the draw is deterministic, ignores entry order, and takes the six lowest scores", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `u${i}`);
    const a = drawWinners("2026-11-19T14", "genesis", ids);
    const b = drawWinners("2026-11-19T14", "genesis", [...ids].reverse());
    assert.deepEqual(a.winners, b.winners);
    assert.equal(a.seed, b.seed);
    assert.equal(a.winners.length, WINNERS_PER_HOUR);
    assert.notDeepEqual(drawWinners("2026-11-19T15", "genesis", ids).seed, a.seed);
    assert.deepEqual(drawWinners("2026-11-19T14", "genesis", ["x"]).winners, ["x"]);
    assert.deepEqual(drawWinners("2026-11-19T14", "genesis", []).winners, []);
  });

  it("entry needs an active lot, is final, and hides who entered until the draw", async () => {
    const lone = await depthCtx("mh-show-nolot");
    assert.equal((await house("house-showcase-enter", {}, lone)).error, "no_active_lot");
    const s = await depthCtx("mh-show-a");
    const id = await makeDtu(s, { title: "Showcase entry lot" });
    await house("house-consign", { dtuId: id, price: 3 }, s);
    const e = await house("house-showcase-enter", {}, s);
    assert.equal(e.ok, true, JSON.stringify(e));
    assert.equal(e.result.hour, hourKey(Date.now() + 3_600_000));
    assert.equal((await house("house-showcase-enter", {}, s)).error, "already_entered");
    const view = await house("house-showcase", {}, s);
    assert.equal(view.result.standing.entered, true);
    assert.equal(typeof view.result.next.entrants, "number");
    assert.equal(view.result.next.eligible, undefined, "entrant names are not published before the draw");
  });

  it("a past hour draws once from its frozen entrants, chains the seed, and enforces the 24-hour sit-out", async () => {
    const H = 3_600_000;
    const base = Math.floor(Date.now() / H) * H - 30 * H; // well in the past, clear of other tests
    const k1 = hourKey(base); const k2 = hourKey(base + H);
    const people = [];
    for (let i = 0; i < 9; i++) {
      const c = await depthCtx(`mh-draw-${i}`);
      const id = await makeDtu(c, { title: `Draw lot ${i}` });
      await house("house-consign", { dtuId: id, price: 1 + i }, c);
      people.push(`mh-draw-${i}`);
    }
    people.push("mh-draw-nolot");
    const ins = db.prepare("INSERT OR IGNORE INTO house_showcase_entries (hour_key, user_id) VALUES (?, ?)");
    for (const p of people) { ins.run(k1, p); ins.run(k2, p); }

    const d1 = ensureDraw(db, k1, base + 60_000);
    const w1 = JSON.parse(d1.winners_json);
    assert.equal(w1.length, 6);
    assert.ok(JSON.parse(d1.excluded_json).some((x) => x.id === "mh-draw-nolot" && x.reason === "no_active_lot"));
    const redo = drawWinners(k1, d1.prev_seed, JSON.parse(d1.entrants_json));
    assert.deepEqual(redo.winners, w1, "anyone can redo the draw from what is published");
    assert.equal(ensureDraw(db, k1, base + 2 * H).seed, d1.seed, "a draw runs once");

    const d2 = ensureDraw(db, k2, base + H + 60_000);
    assert.equal(d2.prev_seed, d1.seed, "each draw chains from the one before");
    const w2 = JSON.parse(d2.winners_json);
    assert.ok(w2.every((id) => !w1.includes(id)), "last hour's winners sit out");
    const ex2 = JSON.parse(d2.excluded_json);
    for (const id of w1) assert.ok(ex2.some((x) => x.id === id && x.reason === "won_recently"));
    assert.equal(w2.length, 3, "9 with lots − 6 sitting out = 3 eligible");
    assert.equal(ensureDraw(db, hourKey(Date.now() + 2 * H)), null, "an hour that has not begun cannot be drawn");
  });
});

describe("market — the commission pay board holds the reward in escrow", () => {
  const escrowBefore = () => bal(ESCROW);

  it("posting holds the reward exactly; a passing DTU accepted pays the creator from escrow, net of the market fee", async () => {
    const poster = await depthCtx("mh-poster-a");
    const maker = await depthCtx("mh-maker-a");
    const rival = await depthCtx("mh-rival-a");
    setLedgerBalance(db, "mh-poster-a", 200);
    const e0 = escrowBefore(); const p0 = bal(PLATFORM); const m0 = bal("mh-maker-a");

    // made BEFORE the request: will fail the "made after posting" check
    const early = await makeDtu(maker, { title: "Old work", tags: ["bridges"], domain: "engineering" });
    await new Promise((r) => setTimeout(r, 1100));
    const posted = await house("board-post", {
      title: "Footbridge vibration checks", brief: "A DTU walking through pedestrian-induced vibration checks for a 30 m footbridge.",
      reward: 60, deadline: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      criteria: { domain: "engineering", tags: ["bridges"], minClaims: 0 },
    }, poster);
    assert.equal(posted.ok, true, JSON.stringify(posted));
    const cid = posted.result.commission.id;
    assert.equal(posted.result.commission.escrowHeld, 60);
    assert.equal(bal("mh-poster-a"), 140);
    assert.equal(r2(escrowBefore() - e0), 60);

    assert.equal((await house("board-submit", { commissionId: cid, dtuId: early }, poster)).error, "own_commission");
    const oldSub = await house("board-submit", { commissionId: cid, dtuId: early }, maker);
    assert.equal(oldSub.ok, true);
    assert.equal(oldSub.result.submission.passed, false);
    assert.equal(oldSub.result.submission.checks.find((c) => c.key === "madeAfterPost").pass, false);
    assert.equal((await house("board-accept", { submissionId: oldSub.result.submission.id }, poster)).error, "checks_failed");

    const wrongTag = await makeDtu(rival, { title: "Untagged", tags: ["roads"], domain: "engineering" });
    const rs = await house("board-submit", { commissionId: cid, dtuId: wrongTag }, rival);
    assert.deepEqual(rs.result.submission.checks.find((c) => c.key === "tags"), { key: "tags", label: "Tagged bridges", pass: false, detail: "missing bridges" });
    assert.equal((await house("board-submit", { commissionId: cid, dtuId: wrongTag }, maker)).error, "not_owner", "you cannot submit someone else's DTU");

    const good = await makeDtu(maker, { title: "Footbridge vibration DTU", tags: ["bridges", "dynamics"], domain: "engineering" });
    const gs = await house("board-submit", { commissionId: cid, dtuId: good }, maker);
    assert.equal(gs.result.submission.passed, true, JSON.stringify(gs.result.submission.checks));
    assert.equal((await house("board-submit", { commissionId: cid, dtuId: good }, maker)).error, "already_submitted");

    // the creator sees only their own submissions; the poster sees all; nobody reads the DTU before acceptance
    assert.equal((await house("board-get", { id: cid }, maker)).result.submissions.length, 2);
    assert.equal((await house("board-get", { id: cid }, poster)).result.submissions.length, 3);
    assert.equal((await house("house-open", { submissionId: gs.result.submission.id }, poster)).error, "not_delivered");

    const acc = await house("board-accept", { submissionId: gs.result.submission.id }, poster);
    assert.equal(acc.ok, true, JSON.stringify(acc));
    const fee = calculateFee("MARKETPLACE_PURCHASE", 60);
    assert.equal(acc.result.paid, fee.net);
    assert.equal(bal("mh-maker-a"), r2(m0 + fee.net));
    assert.equal(r2(escrowBefore() - e0), 0, "escrow is back where it started");
    assert.equal(r2(bal(PLATFORM) - p0), fee.fee, "the market fee is taken once, at release");
    assert.equal(bal("mh-poster-a"), 140);

    const opened = await house("house-open", { submissionId: gs.result.submission.id }, poster);
    assert.equal(opened.result.dtu.title, "Footbridge vibration DTU");
    const after = await house("board-get", { id: cid }, poster);
    assert.equal(after.result.commission.status, "awarded");
    assert.ok(after.result.submissions.filter((s) => s.id !== gs.result.submission.id).every((s) => s.status === "declined"));
    assert.equal((await house("board-accept", { submissionId: rs.result.submission.id }, poster)).error, "commission_closed");
    assert.equal(bal("mh-maker-a"), r2(m0 + fee.net), "a second accept pays nothing");
    const lib = await house("house-library", {}, poster);
    assert.ok(lib.result.commissioned.some((c) => c.submissionId === gs.result.submission.id));
  });

  it("cannot post more than the poster holds; cancelling and expiry return the escrow in full", async () => {
    const poster = await depthCtx("mh-poster-b");
    setLedgerBalance(db, "mh-poster-b", 30);
    const e0 = escrowBefore();
    const deadline = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const brief = "Any well-structured DTU about soil bearing capacity.";
    assert.equal((await house("board-post", { title: "Too rich", brief, reward: 31, deadline }, poster)).error, "insufficient_balance");
    assert.equal(bal("mh-poster-b"), 30);
    assert.equal((await house("board-post", { title: "Bad", brief, reward: 5, deadline: new Date(Date.now() + 60_000).toISOString() }, poster)).error, "invalid_deadline");
    assert.equal((await house("board-post", { title: "Bad", brief, reward: 0, deadline }, poster)).error, "invalid_reward");
    assert.equal((await house("board-post", { title: "Bad", brief, reward: 5, deadline, criteria: { kind: "giant" } }, poster)).error, "invalid_kind");
    assert.equal((await house("board-post", { title: "Bad", brief, reward: 5, deadline, criteria: { mustCite: "dtu_missing_x" } }, poster)).error, "cite_target_not_found");

    const a = await house("board-post", { title: "Bearing capacity", brief, reward: 10, deadline }, poster);
    const b = await house("board-post", { title: "Bearing capacity 2", brief, reward: 15, deadline }, poster);
    assert.equal(bal("mh-poster-b"), 5);
    const stranger = await depthCtx("mh-stranger-board");
    assert.equal((await house("board-cancel", { id: a.result.commission.id }, stranger)).error, "not_commissioner");
    const cancelled = await house("board-cancel", { id: a.result.commission.id }, poster);
    assert.equal(cancelled.result.refunded, 10);
    assert.equal(bal("mh-poster-b"), 15);
    assert.equal((await house("board-cancel", { id: a.result.commission.id }, poster)).error, "commission_closed");
    assert.equal(bal("mh-poster-b"), 15, "cancelling twice refunds once");

    // expiry: past the deadline plus the 7-day acceptance window
    db.prepare("UPDATE house_commissions SET deadline = ? WHERE id = ?").run(new Date(Date.now() - 8 * 86_400_000).toISOString(), b.result.commission.id);
    assert.ok(sweepExpired(db) >= 1);
    assert.equal(bal("mh-poster-b"), 30);
    assert.equal(r2(escrowBefore() - e0), 0);
    assert.equal(db.prepare("SELECT status, refunded FROM house_commissions WHERE id = ?").get(b.result.commission.id).status, "expired");
    sweepExpired(db);
    assert.equal(bal("mh-poster-b"), 30, "an expired request refunds once");
  });

  it("submissions close at the deadline; the poster can still accept within the grace window", async () => {
    const poster = await depthCtx("mh-poster-c");
    const maker = await depthCtx("mh-maker-c");
    setLedgerBalance(db, "mh-poster-c", 20);
    const c = await house("board-post", { title: "Late one", brief: "Any DTU in materials, tagged steel.", reward: 20, deadline: new Date(Date.now() + 2 * 3_600_000).toISOString(), criteria: { tags: ["steel"] } }, poster);
    const dtu = await makeDtu(maker, { tags: ["steel"], domain: "materials" });
    const s = await house("board-submit", { commissionId: c.result.commission.id, dtuId: dtu }, maker);
    assert.equal(s.result.submission.passed, true);
    db.prepare("UPDATE house_commissions SET deadline = ? WHERE id = ?").run(new Date(Date.now() - 3_600_000).toISOString(), c.result.commission.id);
    const late = await makeDtu(maker, { tags: ["steel"], title: "Too late" });
    assert.equal((await house("board-submit", { commissionId: c.result.commission.id, dtuId: late }, maker)).error, "submissions_closed");
    assert.equal((await house("board-accept", { submissionId: s.result.submission.id }, poster)).ok, true);
    assert.ok(!(await house("board-list", {}, maker)).result.commissions.some((x) => x.id === c.result.commission.id));
  });
});

describe("economy/commission-service — escrow pays out what it holds", () => {
  it("hold then approve leaves the shared escrow account where it started", async () => {
    const cs = await import("../../economy/commission-service.js");
    cs.ensureCommissionTables?.(db);
    setLedgerBalance(db, "cs-client", 100);
    // other people's coin already sitting in escrow must not be touched
    const e0 = bal(ESCROW);
    const req = cs.requestCommission(db, { clientId: "cs-client", creatorId: "cs-creator", brief: "A portrait DTU", proposedPrice: 50 });
    assert.equal(req.ok, true, JSON.stringify(req));
    const id = req.requestId || req.id || req.request?.id;
    assert.equal(cs.respondToCommission(db, { requestId: id, creatorId: "cs-creator", action: "accept" }).ok, true);
    assert.equal(cs.holdEscrow(db, { requestId: id, clientId: "cs-client", amount: 50 }).ok, true);
    const held = r2(bal(ESCROW) - e0);
    assert.equal(held, calculateFee("TRANSFER", 50).net, "the hold puts agreed price minus the transfer fee in escrow");
    assert.equal(cs.deliverCommission(db, { requestId: id, creatorId: "cs-creator", dtuId: "dtu_portrait" }).ok, true);
    const c0 = bal("cs-creator");
    const ap = cs.approveDelivery(db, { requestId: id, clientId: "cs-client" });
    assert.equal(ap.ok, true, JSON.stringify(ap));
    assert.equal(r2(bal(ESCROW) - e0), 0, "release pays out exactly what was held, nothing from anyone else's escrow");
    assert.equal(bal("cs-creator"), r2(c0 + calculateFee("MARKETPLACE_PURCHASE", held).net));
    assert.equal(ap.released, calculateFee("MARKETPLACE_PURCHASE", held).net);
  });
});
