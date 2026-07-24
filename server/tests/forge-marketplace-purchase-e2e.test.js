// server/tests/forge-marketplace-purchase-e2e.test.js
//
// End-to-end proof for the forge-marketplace listing fix (2026-07
// grounding-audit continuation). Two things had to be true for a forge app
// to be genuinely purchasable, and this test proves BOTH against the real,
// booted macro runtime (no fakes/stubs):
//
//   1. A DTU minted via `mintForgeAppAsDtu`'s raw `INSERT INTO dtus` must be
//      resolvable by `marketplace.list` / `purchaseWithRoyalties` — the
//      sibling `resolveMarketplaceDtu` SQL-shadow-hydration fix (see
//      `server/tests/marketplace-sql-shadow-hydration.test.js`, which already
//      covers this half by calling `runMacro("marketplace","list", …)`
//      directly against a `mintForgeAppAsDtu` row).
//   2. `listForgeAppOnMarketplace` ITSELF — the function this test targets —
//      must actually call that real macro instead of writing into the dead
//      `creative_artifact_listings` (never created by any migration) /
//      unpurchasable `marketplace_listings` fallback it used before this fix.
//      Nothing in the existing test suite exercised
//      `listForgeAppOnMarketplace`'s own behavior end-to-end; this file
//      closes that gap.
//
// Money note: fee/royalty constants (platformFee 5%, creatorPool 95%) are
// constitutional invariants (CLAUDE.md) and are NOT touched by this fix or
// this test — the assertions below only prove the existing math applies
// correctly to a forge-minted DTU, same as it does to any other DTU.
//
// Run: node --test server/tests/forge-marketplace-purchase-e2e.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { macroRuntime, load } from "./depth/_harness.js";
import { mintForgeAppAsDtu, listForgeAppOnMarketplace } from "../lib/forge-marketplace.js";

function bal(STATE, userId) {
  return STATE.economic?.wallets?.get(userId)?.balance || 0;
}

// `dtus.owner_user_id` FKs to `users(id)` (ON DELETE SET NULL) — seed a real
// row so the raw-INSERT `mintForgeAppAsDtu` performs is byte-faithful to
// production, same convention as marketplace-sql-shadow-hydration.test.js.
function seedUser(db, id) {
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, email, password_hash, created_at)
    VALUES (?, ?, ?, 'x', datetime('now'))
  `).run(id, id, `${id}@example.test`);
}

describe("forge-marketplace listing e2e — mint -> list (real macro) -> purchase (real royalty cascade)", () => {
  let runMacro, STATE, ctx, db;

  before(async () => {
    ({ runMacro, STATE, ctx } = await macroRuntime("forge-marketplace-e2e"));
    ({ db } = await load());
    // Same economic-state shape as marketplace-sql-shadow-hydration.test.js —
    // purchaseWithRoyalties' wallet credit path touches `.transactions` via
    // logTransaction, so a partial stub would silently break the credit.
    STATE.economic = STATE.economic || {
      wallets: new Map(), listings: new Map(), transactions: [],
      treasury: 0, ingestTracking: new Map(),
    };
  });

  it("a forge app minted + listed via the FIXED listForgeAppOnMarketplace is genuinely purchasable, with the correct 95/5 split", async () => {
    const sellerId = ctx.actor.userId;
    seedUser(db, sellerId);

    // Step 1 — mint (unchanged code path; raw INSERT INTO dtus).
    const mint = await mintForgeAppAsDtu(db, {
      userId: sellerId,
      appName: "Todo Tracker E2E",
      sourceCode: "<html><body>a single-file todo app</body></html>",
      manifest: { language: "html", sections: ["ui"] },
      summary: "A single-file todo tracker, minted for the e2e purchase proof.",
    });
    assert.equal(mint.ok, true, `mint failed: ${mint.reason}`);
    const dtuId = mint.dtuId;

    // Precondition: the raw INSERT does not, by itself, appear in STATE.dtus
    // (this is the bug's premise the sibling hydration fix addresses).
    assert.equal(STATE.dtus.has(dtuId), false);

    // Step 2 — list via the FIXED function under test. Before this fix this
    // wrote into a table (`creative_artifact_listings`) that no migration
    // ever creates, or fell back to `marketplace_listings` (unpurchasable).
    const listed = await listForgeAppOnMarketplace(ctx, {
      dtuId,
      priceCents: 1000, // -> $10.00 / 10 CC
      currency: "USD",
      title: "Todo Tracker E2E (listing title)",
      description: "e2e listing",
    });
    assert.equal(listed.ok, true, `listForgeAppOnMarketplace failed: ${listed.reason}`);
    assert.equal(listed.dtuId, dtuId);
    assert.equal(listed.listing.price, 10); // 1000 cents -> 10 CC/USD units
    assert.equal(listed.listing.contentType, "forge_app");

    // The listing genuinely went through marketplace.list — the DTU is now
    // hydrated into STATE.dtus with dtu.marketplace.listed = true, exactly
    // like any other real listing (not a fabricated success).
    assert.equal(STATE.dtus.has(dtuId), true);
    const listedDtu = STATE.dtus.get(dtuId);
    assert.equal(listedDtu.marketplace?.listed, true);
    assert.equal(listedDtu.marketplace?.price, 10);
    assert.equal(listedDtu.sqlShadow, true, "resolved via the SQL-shadow hydration path, not a native STATE.dtus entry");
    assert.equal(listedDtu.ownerId, sellerId);

    // Step 3 — purchase via the real, unmodified purchaseWithRoyalties macro.
    const buyer = `buyer-forge-e2e-${crypto.randomUUID()}`;
    STATE.economic.wallets.set(buyer, { odId: buyer, balance: 100, tokensEarned: 0, tokensSpent: 0 });
    const buyerCtx = { ...ctx, actor: { ...ctx.actor, userId: buyer, id: buyer } };

    const sellerBefore = bal(STATE, sellerId);
    const purchase = await runMacro("marketplace", "purchaseWithRoyalties", { dtuId }, buyerCtx);
    assert.equal(purchase.ok, true, `purchase failed: ${purchase.error}`);
    assert.equal(purchase.price, 10);

    // Constitutional split: 95% creatorPool / 5% platformFee. This forge DTU
    // carries no `lineage.parents` in the STATE.dtus shape (the SQL-shadow
    // hydrator only populates lineage from the "body_json" write shape,
    // which mintForgeAppAsDtu's "data" shape doesn't use — see
    // dtu-shadow-hydrate.js's header comment) — so the ancestor-royalty walk
    // is correctly empty and the full 95% creator pool goes to the seller,
    // same as the sibling marketplace-sql-shadow-hydration.test.js assertion
    // for this exact DTU shape.
    assert.equal(purchase.breakdown.royaltiesPaid.length, 0);
    assert.equal(purchase.breakdown.platformFee, 0.5);   // 10 * 0.05
    assert.equal(purchase.breakdown.sellerReceived, 9.5); // 10 * 0.95
    assert.equal(bal(STATE, sellerId) - sellerBefore, 9.5, "seller wallet actually credited the 95% pool");
    assert.equal(bal(STATE, buyer), 100 - 10, "buyer wallet actually debited the full price");

    // The purchased clone is a real, independent STATE.dtus entry carrying
    // the forge app's real content forward (title/summary), not a
    // fabricated stand-in.
    const clone = STATE.dtus.get(purchase.purchasedDtuId);
    assert.ok(clone);
    assert.equal(clone.meta.purchasedFrom, dtuId);
    assert.equal(clone.title, "Todo Tracker E2E");
    assert.equal(clone.scope, "local");
  });

  it("listForgeAppOnMarketplace honestly refuses (no fabricated success) when the caller doesn't own the DTU", async () => {
    const ownerId = `forge-owner-${crypto.randomUUID()}`;
    seedUser(db, ownerId);
    const mint = await mintForgeAppAsDtu(db, {
      userId: ownerId,
      appName: "Not Yours",
      sourceCode: "<html></html>",
    });
    assert.equal(mint.ok, true);

    // ctx's actor is NOT ownerId — marketplace.list's existing ownership
    // gate must still apply; no special-cased bypass for forge apps.
    const r = await listForgeAppOnMarketplace(ctx, { dtuId: mint.dtuId, priceCents: 500 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_your_dtu");
  });
});
