/**
 * P-D pinning tests — Dream Commerce purchase conservation + royalty cascade.
 *
 * Boots the real server (macroRuntime harness — server/tests/depth/_harness.js)
 * so this exercises the ACTUAL purchase path end-to-end, not a mock:
 *
 *   promoteCandidateAsDTU (lib/dream-marketplace-bridge.js)
 *     -> writes a priced dream onto dtu.marketplace (the real store —
 *        NOT the dead STATE.marketplaceListings map, see finding #3 in
 *        docs/lens-specs/creator-capability-map.md for the identical
 *        defect pattern this mirrors)
 *   marketplace.purchaseWithRoyalties (server.js)
 *     -> the ONLY macro that actually reads dtu.marketplace and sells it
 *   creditWallet() / debitWallet() (server.js)
 *     -> bridge every wallet mutation into economy_ledger
 *   getBalance() (economy/balances.js)
 *     -> the honest, CREDIT_ROW_PREDICATE-correct read of what an account
 *        actually has — never a raw ledger sum
 *
 * Money claims PROVEN here, not asserted:
 *   1. Conservation — a priced purchase debits the buyer exactly `price`,
 *      and the sum of every other account's gain (seller + royalties +
 *      platform fee) equals `price` to the penny. Nothing is minted.
 *   2. Balance visibility — the seller's and each cited source author's
 *      getBalance() reflects what they actually earned.
 *   3. Cascade — a dream stitched from N source fragment DTUs registers a
 *      royalty_lineage row per CONSENTED source (registerCitation, gated),
 *      pays each of those sources on purchase (via dtu.lineage.parents ->
 *      computeRoyaltyCascade -> creditWallet, unchanged money math),
 *      respects the constitutional 30% royalty cap, and — the money/audit
 *      consistency check — a source whose author never consented to
 *      citation is neither registered NOR paid.
 *   4. Regression — a FREE (price 0) dream promotion is byte-identical to
 *      before this fix: no dtu.marketplace, no economy_ledger writes, no
 *      citations registered.
 *   5. Qualia Bazaar — a qualia-state snapshot promotes as a free,
 *      citation-only listing through the same seam, no consent required,
 *      no payment path built.
 *
 * IMPORTANT — isolated DB_PATH. This boots the real server, which opens
 * `process.env.DB_PATH` (defaults to server/data/concord.db, the real dev
 * DB, if unset — server.js does NOT auto-isolate this for NODE_ENV=test).
 * Always set DB_PATH explicitly:
 *
 *   DB_PATH=/tmp/dream-commerce-test.db node --test \
 *     tests/economy/dream-commerce-purchase-conservation.test.js
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import { macroRuntime, load } from "../depth/_harness.js";
import { getBalance } from "../../economy/balances.js";
import { PLATFORM_ACCOUNT_ID } from "../../economy/fees.js";
import { grantConsent } from "../../lib/consent.js";
import {
  promoteCandidateAsDTU,
  promoteQualiaSnapshot,
} from "../../lib/dream-marketplace-bridge.js";

const r2 = (n) => Math.round(n * 100) / 100;

describe("Dream Commerce — purchase conservation + cascade (P-D)", () => {
  let runMacro, STATE, ctx, getWallet;

  before(async () => {
    ({ runMacro, STATE, ctx } = await macroRuntime("dream-commerce-pd"));
    ({ getWallet } = await load());
  });

  function seedFragment(id, creatorId, { visibility = "public" } = {}) {
    STATE.dtus.set(id, {
      id,
      title: `Fragment ${id}`,
      domain: "astronomy",
      ownerId: creatorId,
      meta: { createdBy: creatorId, tags: ["domain:astronomy"] },
      human: { summary: `fragment summary ${id}` },
      visibility,
      lineage: { parents: [] },
    });
  }

  function seedDream(id) {
    STATE.dtus.set(id, {
      id,
      title: `Dream ${id}`,
      domain: "astronomy",
      meta: { createdBy: "system_dream_cycle", tags: ["domain:astronomy"] },
      human: { summary: `dream summary ${id}` },
      lineage: { parents: [] },
    });
  }

  function fundBuyer(buyerId, amount) {
    // purchaseWithRoyalties reads STATE.economic wallets directly for its
    // balance-sufficiency gate — this seeds spendable in-memory balance
    // WITHOUT writing an economy_ledger row, so getBalance() baselines at
    // 0 and every subsequent ledger row this test observes is one this
    // purchase itself produced (a clean before/after delta).
    getWallet(buyerId).balance = amount;
  }

  it("conservation: a priced dream purchased end-to-end — buyer -price, sellers/royalties/platform sum to +price, nothing minted", async () => {
    const sellerId = "dream-seller-conservation";
    const buyerId = ctx.actor.userId;
    const dreamId = "dream-conservation-1";

    seedDream(dreamId);
    grantConsent(STATE.db, sellerId, "allow_phenomenal_monetization");
    fundBuyer(buyerId, 1000);

    const promote = await promoteCandidateAsDTU(
      STATE,
      { dtuId: dreamId, consolidatedFrom: [], citations: [] },
      { scoreFn: () => 100, scoreFloor: 10, userPrice: 100, userId: sellerId, promotionSource: "dream_cycle" },
    );
    assert.equal(promote.promoted, true);
    assert.equal(STATE.dtus.get(dreamId).marketplace.listed, true);
    assert.equal(STATE.dtus.get(dreamId).marketplace.price, 100);

    const buyerBefore = getBalance(STATE.db, buyerId).balance;
    const sellerBefore = getBalance(STATE.db, sellerId).balance;
    const platformBefore = getBalance(STATE.db, PLATFORM_ACCOUNT_ID).balance;

    const purchase = await runMacro("marketplace", "purchaseWithRoyalties", { dtuId: dreamId }, ctx);
    assert.equal(purchase.ok, true);
    assert.equal(purchase.price, 100);
    assert.equal(purchase.breakdown.platformFee, 5);
    assert.equal(purchase.breakdown.sellerReceived, 95);
    assert.deepEqual(purchase.breakdown.royaltiesPaid, []); // no sources on this one

    const buyerAfter = getBalance(STATE.db, buyerId).balance;
    const sellerAfter = getBalance(STATE.db, sellerId).balance;
    const platformAfter = getBalance(STATE.db, PLATFORM_ACCOUNT_ID).balance;

    const buyerDelta = r2(buyerAfter - buyerBefore);
    const sellerDelta = r2(sellerAfter - sellerBefore);
    const platformDelta = r2(platformAfter - platformBefore);

    assert.equal(buyerDelta, -100);
    assert.equal(sellerDelta, 95);
    assert.equal(platformDelta, 5);
    // Conservation: buyer's loss exactly equals everyone else's gain.
    assert.equal(-buyerDelta, r2(sellerDelta + platformDelta));
  });

  it("balance visibility: the seller's getBalance() reflects the earned amount exactly (the CREDIT_ROW_PREDICATE bug class)", async () => {
    const sellerId = "dream-seller-visibility";
    const buyerId = ctx.actor.userId;
    const dreamId = "dream-visibility-1";

    seedDream(dreamId);
    grantConsent(STATE.db, sellerId, "allow_phenomenal_monetization");
    fundBuyer(buyerId, 1000);

    await promoteCandidateAsDTU(
      STATE,
      { dtuId: dreamId, consolidatedFrom: [], citations: [] },
      { scoreFn: () => 100, scoreFloor: 10, userPrice: 50, userId: sellerId },
    );

    const before = getBalance(STATE.db, sellerId).balance;
    const purchase = await runMacro("marketplace", "purchaseWithRoyalties", { dtuId: dreamId }, ctx);
    assert.equal(purchase.ok, true);

    const after = getBalance(STATE.db, sellerId);
    // 50 * 0.95 = 47.5 — exactly once, not double-counted.
    assert.equal(r2(after.balance - before), 47.5);
    assert.equal(after.totalCredits >= 47.5, true);
  });

  it("cascade: a dream stitched from 2 CONSENTED sources pays both authors, registers 2 royalty_lineage rows, respects the 30% cap; a 3rd NON-consented source is neither registered nor paid", async () => {
    const sellerId = "dream-seller-cascade";
    const buyerId = ctx.actor.userId;
    const dreamId = "dream-cascade-1";
    const fragA = "fragment-cascade-a";
    const fragB = "fragment-cascade-b";
    const fragC = "fragment-cascade-c-noconsent";
    const authorA = "fragment-author-a";
    const authorB = "fragment-author-b";
    const authorC = "fragment-author-c-noconsent";

    seedFragment(fragA, authorA, { visibility: "public" });
    seedFragment(fragB, authorB, { visibility: "public" });
    seedFragment(fragC, authorC, { visibility: "private" }); // no allow_citation consent either
    seedDream(dreamId);
    grantConsent(STATE.db, sellerId, "allow_phenomenal_monetization");
    fundBuyer(buyerId, 1000);
    // purchaseWithRoyalties pays a royalty recipient directly only if they
    // already have a wallet — otherwise it escrows (a separate, correct
    // honest-failure behavior this test isn't about). Pre-create real
    // wallets for the two consented authors so their payout is observable.
    getWallet(authorA);
    getWallet(authorB);

    const beforeA = getBalance(STATE.db, authorA).balance;
    const beforeB = getBalance(STATE.db, authorB).balance;
    const beforeC = getBalance(STATE.db, authorC).balance;
    const beforeSeller = getBalance(STATE.db, sellerId).balance;

    const promote = await promoteCandidateAsDTU(
      STATE,
      { dtuId: dreamId, consolidatedFrom: [fragA, fragB, fragC], citations: [] },
      { scoreFn: () => 100, scoreFloor: 10, userPrice: 200, userId: sellerId },
    );
    assert.equal(promote.promoted, true);
    assert.equal(promote.citations.registered, 2, "only the 2 public/consented sources register");
    assert.equal(promote.citations.skipped, 1, "the non-consented source is skipped, not force-cited");

    // SQL royalty_lineage: exactly 2 rows, for A and B only.
    const lineageRows = STATE.db.prepare(`SELECT parent_id FROM royalty_lineage WHERE child_id = ?`).all(dreamId);
    assert.equal(lineageRows.length, 2);
    const lineageParents = lineageRows.map(r => r.parent_id).sort();
    assert.deepEqual(lineageParents, [fragA, fragB].sort());

    // dtu.lineage.parents (what computeRoyaltyCascade actually pays) also
    // excludes the non-consented source — money/audit consistency.
    const dreamDtu = STATE.dtus.get(dreamId);
    assert.ok(dreamDtu.lineage.parents.includes(fragA));
    assert.ok(dreamDtu.lineage.parents.includes(fragB));
    assert.equal(dreamDtu.lineage.parents.includes(fragC), false);

    const purchase = await runMacro("marketplace", "purchaseWithRoyalties", { dtuId: dreamId }, ctx);
    assert.equal(purchase.ok, true);
    assert.equal(purchase.price, 200);
    assert.equal(purchase.breakdown.royaltiesPaid.length, 2);

    const paidRecipients = purchase.breakdown.royaltiesPaid.map(p => p.recipient).sort();
    assert.deepEqual(paidRecipients, [authorA, authorB].sort());

    const creatorPool = 200 * 0.95; // 190
    const totalRoyalty = purchase.breakdown.royaltiesPaid.reduce((s, p) => s + p.amount, 0);
    // Constitutional cap: total royalty never exceeds 30% of the sale price.
    assert.ok(totalRoyalty <= r2(200 * 0.30) + 0.01, `totalRoyalty ${totalRoyalty} exceeds the 30% cap`);

    const afterA = getBalance(STATE.db, authorA).balance;
    const afterB = getBalance(STATE.db, authorB).balance;
    const afterC = getBalance(STATE.db, authorC).balance;
    const afterSeller = getBalance(STATE.db, sellerId).balance;

    const gainA = r2(afterA - beforeA);
    const gainB = r2(afterB - beforeB);
    const gainC = r2(afterC - beforeC);
    const gainSeller = r2(afterSeller - beforeSeller);

    assert.ok(gainA > 0, "consented source A got paid");
    assert.ok(gainB > 0, "consented source B got paid");
    assert.equal(gainC, 0, "non-consented source C got nothing");

    // remixer (seller) + ancestors sum to remainingAfterFees (95% of price).
    assert.equal(r2(gainSeller + gainA + gainB), r2(creatorPool));
  });

  it("regression: a FREE (price 0) dream promotion is byte-identical — no dtu.marketplace, no ledger writes, no citations registered", async () => {
    const dreamId = "dream-free-regression-1";
    const fragA = "fragment-free-regression-a";
    const authorA = "fragment-author-free-regression";

    seedFragment(fragA, authorA, { visibility: "public" });
    seedDream(dreamId);

    const authorBefore = getBalance(STATE.db, authorA).balance;
    const lineageBefore = STATE.db.prepare(`SELECT COUNT(*) c FROM royalty_lineage WHERE child_id = ?`).get(dreamId).c;

    // No userId, no userPrice — the exact promoteDreamDTU-style call shape.
    const promote = await promoteCandidateAsDTU(
      STATE,
      { dtuId: dreamId, consolidatedFrom: [fragA], citations: [] },
      { scoreFn: () => 100, scoreFloor: 10, sellerLabel: "system_dream_cycle", idPrefix: "dream-listing", promotionSource: "dream_cycle" },
    );

    assert.equal(promote.promoted, true);
    assert.match(promote.listingId, /^dream-listing-/);
    const listing = STATE.marketplaceListings.get(promote.listingId);
    assert.ok(listing);
    assert.equal(listing.price, 0);

    // The DTU itself was never touched with a marketplace field or lineage
    // rewrite — free promotions don't wire dtu.marketplace or dtu.lineage.
    const dtu = STATE.dtus.get(dreamId);
    assert.equal(dtu.marketplace, undefined);
    assert.deepEqual(dtu.lineage.parents, []);

    // No royalty_lineage rows were registered for the free path.
    const lineageAfter = STATE.db.prepare(`SELECT COUNT(*) c FROM royalty_lineage WHERE child_id = ?`).get(dreamId).c;
    assert.equal(lineageAfter, lineageBefore);

    // No wallet/ledger movement for the source author.
    const authorAfter = getBalance(STATE.db, authorA).balance;
    assert.equal(authorAfter, authorBefore);

    // And it genuinely cannot be purchased — purchaseWithRoyalties only
    // reads dtu.marketplace, which the free path never sets.
    const attemptedPurchase = await runMacro("marketplace", "purchaseWithRoyalties", { dtuId: dreamId }, ctx);
    assert.equal(attemptedPurchase.ok, false);
    assert.match(attemptedPurchase.error, /not_listed/);
  });

  it("Qualia Bazaar: a qualia-state snapshot promotes free/citation-only through the same seam, no consent required, no payment path built", async () => {
    const snapshotId = "qualia-snapshot-1";
    STATE.dtus.set(snapshotId, {
      id: snapshotId,
      title: "Qualia snapshot — entity-7 affect trace",
      domain: "philosophy",
      meta: { createdBy: "system_qualia_bazaar", tags: ["domain:philosophy"] },
      human: { summary: "A momentary qualia-state snapshot." },
      lineage: { parents: [] },
    });

    const result = await promoteQualiaSnapshot(
      STATE,
      { dtuId: snapshotId, novelty: 0.9, domains: ["philosophy"], consolidatedFrom: [], citations: [] },
      { scoreFloor: 10 },
    );

    assert.equal(result.promoted, true);
    assert.match(result.listingId, /^qualia-listing-/);

    const listing = STATE.marketplaceListings.get(result.listingId);
    assert.ok(listing);
    assert.equal(listing.price, 0);
    assert.equal(listing.sellerId, "system_qualia_bazaar");
    assert.equal(listing.promotionSource, "qualia_bazaar");
    assert.equal(listing.dtuType, "qualia_snapshot");

    // No dtu.marketplace was ever written — no payment path exists for this.
    assert.equal(STATE.dtus.get(snapshotId).marketplace, undefined);
  });
});
