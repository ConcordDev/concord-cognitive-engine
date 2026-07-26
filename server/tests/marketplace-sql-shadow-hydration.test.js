// server/tests/marketplace-sql-shadow-hydration.test.js
//
// Regression test for the "SQL-only DTU is invisible to the marketplace"
// bug (grounding audit, 2026-07). Three parallel, non-interoperating
// marketplace substrates exist; this test is about the gap between (a) the
// legacy in-memory `STATE.dtus` + `marketplace.list`/`purchaseWithRoyalties`
// macros in server.js and content types that mint a DTU via a raw SQL
// `INSERT INTO dtus` instead of the `dtu.create` macro. Two confirmed
// victims: `server/domains/gamedesign.js`'s `building-publish` macro and
// `server/lib/forge-marketplace.js`'s `mintForgeAppAsDtu`. Both write a
// real, durable row into the SQL `dtus` table — but `dtu.create` is the
// ONLY writer that also populates `STATE.dtus`, which `marketplace.list`
// and `purchaseWithRoyalties` read/write exclusively. Before the fix, a
// listing/purchase attempt against either row's id returned
// `dtu_not_found` / `not_listed` even though the row genuinely exists.
//
// The fix: `resolveMarketplaceDtu` (server.js) checks STATE.dtus first,
// then falls back to `readAndHydrateDtu` (server/lib/dtu-shadow-hydrate.js)
// which reads the real SQL row and reconstructs the equivalent STATE.dtus
// shape, caching it so subsequent lookups are fast. See
// server/tests/dtu-shadow-hydrate.test.js for isolated unit coverage of the
// pure hydration mapping.
//
// This test seeds rows using the EXACT column list + JSON shape each real
// call site uses (mirroring the depth-harness money-path tests in
// server/tests/depth/marketplace-behavior.test.js), proves the row is
// absent from STATE.dtus immediately after the raw INSERT (the bug's
// precondition), then proves marketplace.list / purchaseWithRoyalties now
// resolve + transact against it — including the royalty cascade + wallet
// settlement — via the SAME macros and SAME fee/royalty math as any other
// DTU (no special-cased shortcut). Money note: fee/royalty constants
// (platformFee 5%, creatorPool 95%) are constitutional invariants and are
// NOT touched by this fix or this test.
//
// Run: node --test server/tests/marketplace-sql-shadow-hydration.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { macroRuntime, load } from "./depth/_harness.js";

function bal(STATE, userId) {
  return STATE.economic?.wallets?.get(userId)?.balance || 0;
}

// `dtus.owner_user_id` carries a real FK to `users(id)` (ON DELETE SET
// NULL) — a raw INSERT INTO dtus for an owner that isn't a genuine `users`
// row throws SQLITE_CONSTRAINT_FOREIGNKEY, same as the real call sites this
// test mirrors would if the actor weren't a real account. Seed a minimal
// real user row so the raw-INSERT shape is byte-faithful to production.
function seedUser(db, id) {
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, email, password_hash, created_at)
    VALUES (?, ?, ?, 'x', datetime('now'))
  `).run(id, id, `${id}@example.test`);
}

describe("marketplace SQL-shadow hydration — raw INSERT INTO dtus victims", () => {
  let runMacro, STATE, ctx, db, resolveMarketplaceDtu;

  before(async () => {
    ({ runMacro, STATE, ctx } = await macroRuntime("marketplace-sql-shadow"));
    ({ db, resolveMarketplaceDtu } = await load());
    // Match `ensureEconomicState()`'s real shape exactly (not just
    // `{ wallets }`) — `purchaseWithRoyalties`'s wallet credit/debit path
    // also touches `.transactions` via `logTransaction`. A partial stub
    // here would leave `.transactions` undefined and this test running in
    // isolation would be the FIRST thing to ever set `STATE.economic`
    // (so `ensureEconomicState`'s own `if (!STATE.economic)` guard would
    // never fire to fill in the rest), silently swallowing a throw inside
    // the try/catch around the wallet credit.
    STATE.economic = STATE.economic || {
      wallets: new Map(), listings: new Map(), transactions: [],
      treasury: 0, ingestTracking: new Map(),
    };
  });

  it("gamedesign.js#building-publish shape: absent from STATE.dtus right after the raw INSERT, then becomes listable + purchasable with the real royalty cascade", async () => {
    const dtuId = `dtu_bp_${crypto.randomUUID()}`;
    const sellerId = ctx.actor.userId;
    const now = new Date().toISOString();
    const body = {
      title: "Riverside Watchtower",
      meta: { type: "blueprint", kind: "building", archetype: "tower" },
      human: { summary: "Riverside Watchtower — an authored tower building." },
    };
    seedUser(db, sellerId);
    // Exact column list + literal shape server/domains/gamedesign.js's
    // building-publish macro uses for its `INSERT INTO dtus`.
    db.prepare(`
      INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, tier, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'public', 'regular', ?, ?)
    `).run(dtuId, sellerId, body.title, JSON.stringify(body), JSON.stringify(["building", "blueprint", "tower"]), now, now);

    // Precondition: proves the bug's premise — a raw SQL INSERT does NOT
    // appear in STATE.dtus on its own.
    assert.equal(STATE.dtus.has(dtuId), false, "a raw SQL INSERT must not appear in STATE.dtus by itself");

    const listed = await runMacro("marketplace", "list", { dtuId, price: 15, currency: "USD", contentType: "blueprint" }, ctx);
    assert.equal(listed.ok, true, `listing failed: ${listed.error}`);
    assert.equal(listed.listing.price, 15);
    // marketplace.list defaults the LISTING title to dtu.human.summary when
    // no explicit title param is given — existing, untouched behavior.
    assert.equal(listed.listing.title, body.human.summary);
    assert.equal(STATE.dtus.get(dtuId).title, body.title);

    // hydration cached a real STATE.dtus entry with the right shape
    assert.equal(STATE.dtus.has(dtuId), true);
    const hydrated = STATE.dtus.get(dtuId);
    assert.equal(hydrated.ownerId, sellerId);
    assert.equal(hydrated.sqlShadow, true);
    assert.equal(hydrated.human.summary, body.human.summary);

    const buyer = `buyer-bp-${crypto.randomUUID()}`;
    STATE.economic.wallets.set(buyer, { odId: buyer, balance: 1000, tokensEarned: 0, tokensSpent: 0 });
    const buyerCtx = { ...ctx, actor: { ...ctx.actor, userId: buyer, id: buyer } };

    const sellerBefore = bal(STATE, sellerId);
    const purchase = await runMacro("marketplace", "purchaseWithRoyalties", { dtuId }, buyerCtx);
    assert.equal(purchase.ok, true, `purchase failed: ${purchase.error}`);
    assert.equal(purchase.price, 15);
    // no lineage.parents on this row → empty royalty cascade, exactly the
    // same math as any native STATE.dtus DTU with no lineage: seller keeps
    // the full 95% creator pool, platform takes 5% — both constitutional
    // constants, unchanged.
    assert.equal(purchase.breakdown.royaltiesPaid.length, 0);
    assert.equal(purchase.breakdown.platformFee, 0.75);     // 15 * 0.05
    assert.equal(purchase.breakdown.sellerReceived, 14.25); // 15 * 0.95
    assert.equal(bal(STATE, sellerId) - sellerBefore, 14.25, "seller wallet actually credited");
    assert.equal(bal(STATE, buyer), 1000 - 15, "buyer wallet actually debited");

    // the purchased clone is a real, independent STATE.dtus entry carrying
    // the hydrated content forward (not a fabricated/empty stand-in)
    const clone = STATE.dtus.get(purchase.purchasedDtuId);
    assert.ok(clone);
    assert.equal(clone.meta.purchasedFrom, dtuId);
    assert.equal(clone.human.summary, body.human.summary);
    assert.equal(clone.scope, "local");
  });

  it("forge-marketplace.js#mintForgeAppAsDtu shape: the real mint helper's raw-INSERT row is listable + purchasable", async () => {
    const { mintForgeAppAsDtu } = await import("../lib/forge-marketplace.js");
    const sellerId = ctx.actor.userId;
    seedUser(db, sellerId);
    const mint = await mintForgeAppAsDtu(db, {
      userId: sellerId,
      appName: "Todo Tracker",
      sourceCode: "<html><body>a single-file app</body></html>",
      manifest: { language: "html", sections: ["ui"] },
      summary: "A single-file todo tracker.",
    });
    assert.equal(mint.ok, true, `mintForgeAppAsDtu failed: ${mint.reason}`);
    const dtuId = mint.dtuId;

    assert.equal(STATE.dtus.has(dtuId), false, "mintForgeAppAsDtu's raw INSERT must not appear in STATE.dtus by itself");

    const listed = await runMacro("marketplace", "list", { dtuId, price: 8, currency: "USD", contentType: "forge_app" }, ctx);
    assert.equal(listed.ok, true, `listing failed: ${listed.error}`);
    // marketplace.list defaults the LISTING title to dtu.human.summary when
    // no explicit title param is given (see server.js's `title ||
    // dtu.human?.summary`) — that's existing, untouched behavior, so assert
    // the DTU's own title separately from the listing's derived title.
    assert.equal(STATE.dtus.get(dtuId).title, "Todo Tracker");
    // no body_json on this write shape → human.summary honestly falls back
    // to the real meta.summary the caller supplied, never a fabricated one
    assert.equal(STATE.dtus.get(dtuId).human.summary, "A single-file todo tracker.");
    assert.equal(listed.listing.title, "A single-file todo tracker.");
    assert.equal(STATE.dtus.get(dtuId).ownerId, sellerId);

    const buyer2 = `buyer-forge-${crypto.randomUUID()}`;
    STATE.economic.wallets.set(buyer2, { odId: buyer2, balance: 500, tokensEarned: 0, tokensSpent: 0 });
    const buyerCtx2 = { ...ctx, actor: { ...ctx.actor, userId: buyer2, id: buyer2 } };

    const purchase = await runMacro("marketplace", "purchaseWithRoyalties", { dtuId }, buyerCtx2);
    assert.equal(purchase.ok, true, `purchase failed: ${purchase.error}`);
    assert.equal(purchase.price, 8);
    assert.equal(purchase.breakdown.sellerReceived, 7.6); // 8 * 0.95
    assert.equal(purchase.breakdown.platformFee, 0.4);    // 8 * 0.05
    assert.equal(bal(STATE, buyer2), 500 - 8);
  });

  it("resolveMarketplaceDtu returns null (an honest miss, not a fabricated object) for a truly nonexistent id", () => {
    assert.equal(resolveMarketplaceDtu(`dtu_does_not_exist_${crypto.randomUUID()}`), null);
  });

  it("marketplace.list still enforces ownership on a hydrated SQL-only DTU (no special-cased bypass of the existing gate)", async () => {
    const dtuId = `dtu_bp_owner_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const body = { title: "Someone Else's Tower", meta: {}, human: { summary: "not yours" } };
    seedUser(db, "someone-else");
    db.prepare(`
      INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, tier, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'public', 'regular', ?, ?)
    `).run(dtuId, "someone-else", body.title, JSON.stringify(body), JSON.stringify([]), now, now);

    const r = await runMacro("marketplace", "list", { dtuId, price: 10 }, ctx); // ctx's actor is NOT "someone-else"
    assert.equal(r.ok, false);
    assert.match(r.error, /not_your_dtu/);
  });
});
