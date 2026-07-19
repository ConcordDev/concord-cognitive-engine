// tests/depth/marketplace-plugin-license-behavior.test.js — Wave 6 pinning
// test: paid plugin marketplace installs are gated by the SAME rights/
// license-tier substrate every other content type (music/art/code/...)
// already uses. Owner's model (verbatim): "You got download rights to a
// DTU if someone pays for strictly download, but users can also purchase
// usage rights — that's how licensing works." Plugin "install" is the
// download-equivalent base right; commercial/resale/source are purchased
// usage rights on top, cumulative.
//
// Two describe blocks:
//   1. A fast, server-boot-free unit test of the new `plugin` tier ladder
//      added to server/economy/rights-enforcement.js — proves cumulativity
//      (a higher tier implies every lower tier's capabilities) against a
//      throwaway in-memory sqlite db, no macro dispatch involved.
//   2. A REAL end-to-end behavioral test through the actual registered
//      macros (`marketplace.submit` / `marketplace.purchasePlugin` /
//      `marketplace.install`) via the shared depth harness, which boots
//      the real server.js once and runs the genuine `purchaseArtifact()`
//      ledger path — the exact primitive `marketplace.purchasePlugin`
//      calls, no parallel payment code. Isolated DB via a unique DB_PATH
//      so this file never collides with a parallel run.
import { randomUUID } from "node:crypto";
process.env.DB_PATH = process.env.DB_PATH || `/tmp/marketplace-plugin-license-${process.pid}-${Date.now()}.db`;

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { checkAccess, ensureLicenseTables, grantLicense, TIER_HIERARCHY } from "../../economy/rights-enforcement.js";
import { CREATIVE_MARKETPLACE } from "../../lib/creative-marketplace-constants.js";
import { PLATFORM_ACCOUNT_ID } from "../../economy/fees.js";
import { getBalance } from "../../economy/balances.js";
import { load, depthCtx, macroRuntime } from "./_harness.js";

let Database;
try {
  Database = (await import("better-sqlite3")).default;
} catch {
  // skip the in-memory unit block if better-sqlite3 isn't resolvable
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Tier-ladder unit tests (no server boot — direct rights-enforcement.js)
// ═══════════════════════════════════════════════════════════════════════════

function makeUnitDb() {
  const db = new Database(":memory:");
  ensureLicenseTables(db);
  return db;
}

describe("rights-enforcement — plugin tier ladder (unit)", () => {
  if (!Database) return;

  it("TIER_HIERARCHY.plugin is the additive install→commercial→resale→source ladder", () => {
    assert.deepEqual(TIER_HIERARCHY.plugin, ["install", "commercial", "resale", "source"]);
    // Existing ladders untouched (additive-only change).
    assert.deepEqual(TIER_HIERARCHY.music, ["listen", "download", "remix", "commercial", "exclusive", "stems"]);
    assert.deepEqual(TIER_HIERARCHY.code, ["view", "personal", "commercial", "resale", "full_source"]);
  });

  it("no license → install action is denied with requiredTier 'install'", () => {
    const db = makeUnitDb();
    const access = checkAccess(db, { userId: "u1", dtuId: "plug1", contentType: "plugin", action: "install" });
    assert.equal(access.allowed, false);
    assert.equal(access.reason, "no_license");
    assert.equal(access.requiredTier, "install");
  });

  it("install-tier license grants install but NOT commercial", () => {
    const db = makeUnitDb();
    grantLicense(db, { dtuId: "plug1", userId: "u1", contentType: "plugin", licenseTier: "install", txId: "tx1" });
    const install = checkAccess(db, { userId: "u1", dtuId: "plug1", contentType: "plugin", action: "install" });
    assert.equal(install.allowed, true);
    assert.equal(install.tier, "install");
    const commercial = checkAccess(db, { userId: "u1", dtuId: "plug1", contentType: "plugin", action: "commercial_use" });
    assert.equal(commercial.allowed, false);
    assert.equal(commercial.reason, "insufficient_license");
    assert.equal(commercial.requiredTier, "commercial");
  });

  it("cumulativity: a 'resale' license implies install + commercial (every lower tier)", () => {
    const db = makeUnitDb();
    grantLicense(db, { dtuId: "plug2", userId: "u2", contentType: "plugin", licenseTier: "resale", txId: "tx2" });
    // Only ONE license was granted (resale) — checkAccess() finds it via
    // getUserLicenses() and returns which tier actually satisfied the
    // request (economy/rights-enforcement.js#checkAccess: `{ allowed: true,
    // reason: "licensed", tier: lic.license_tier }`). Asserting `.tier ===
    // "resale"` on every lower action is the real proof of cumulativity —
    // the SAME single grant backs install, commercial_use, AND resale, not
    // three separate (fabricated) licenses.
    const install = checkAccess(db, { userId: "u2", dtuId: "plug2", contentType: "plugin", action: "install" });
    assert.equal(install.allowed, true);
    assert.equal(install.tier, "resale");
    const commercial = checkAccess(db, { userId: "u2", dtuId: "plug2", contentType: "plugin", action: "commercial_use" });
    assert.equal(commercial.allowed, true);
    assert.equal(commercial.tier, "resale");
    const resale = checkAccess(db, { userId: "u2", dtuId: "plug2", contentType: "plugin", action: "resale" });
    assert.equal(resale.allowed, true);
    assert.equal(resale.tier, "resale");
    // Still doesn't imply the tier ABOVE it — a clean rejection, not a
    // silent allow, with the exact tier the caller would need to buy next.
    const source = checkAccess(db, { userId: "u2", dtuId: "plug2", contentType: "plugin", action: "access_source" });
    assert.equal(source.allowed, false);
    assert.equal(source.reason, "insufficient_license");
    assert.equal(source.requiredTier, "source");
  });

  it("cumulativity: 'source' (top tier) implies every capability below it", () => {
    const db = makeUnitDb();
    grantLicense(db, { dtuId: "plug3", userId: "u3", contentType: "plugin", licenseTier: "source", txId: "tx3" });
    for (const action of ["install", "commercial_use", "resale", "access_source"]) {
      const access = checkAccess(db, { userId: "u3", dtuId: "plug3", contentType: "plugin", action });
      assert.equal(access.allowed, true, `source tier should grant ${action}`);
      // The single top-tier grant is what backs every lower action directly
      // (not a coincidental "true" from some other path) — pin the exact
      // license tier checkAccess() attributes each allow to.
      assert.equal(access.tier, "source", `source tier should back ${action} directly`);
    }
  });

  it("creator always has full access regardless of license", () => {
    const db = makeUnitDb();
    const access = checkAccess(db, {
      userId: "creatorX", dtuId: "plug4", contentType: "plugin", action: "install", creatorId: "creatorX",
    });
    assert.equal(access.allowed, true);
    assert.equal(access.reason, "creator");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. End-to-end macro test — real server boot, real purchaseArtifact() ledger
// ═══════════════════════════════════════════════════════════════════════════

describe("marketplace plugin checkout — real macros (submit/purchase/install)", () => {
  let runMacro, creditWallet;
  let buyerCtx, creatorCtx, otherBuyerCtx;

  before(async () => {
    const rt = await macroRuntime("marketplace-plugin-license");
    runMacro = rt.runMacro;
    const t = await load();
    creditWallet = t.creditWallet;
    buyerCtx = await depthCtx(`plugin-buyer-${randomUUID()}`);
    creatorCtx = await depthCtx(`plugin-creator-${randomUUID()}`);
    otherBuyerCtx = await depthCtx(`plugin-buyer2-${randomUUID()}`);
    // Fund both buyers well above any plugin price used below.
    creditWallet(buyerCtx.actor.userId, 1000, "test_fund");
    creditWallet(otherBuyerCtx.actor.userId, 1000, "test_fund");
  });

  it("free (price 0) plugin installs directly — no purchase, no license needed", async () => {
    const submitted = await runMacro("marketplace", "submit", {
      name: "Free Widget", githubUrl: "https://github.com/acme/free-widget",
    }, creatorCtx);
    assert.equal(submitted.ok, true);
    assert.equal(submitted.listing.price, 0);
    assert.equal(submitted.listing.artifactBacked, undefined); // no DB backing for free listings

    const installed = await runMacro("marketplace", "install", { pluginId: submitted.listing.id }, buyerCtx);
    assert.equal(installed.ok, true);
    assert.equal(installed.plugin.id, submitted.listing.id);
  });

  it("paid plugin: install is blocked before purchase (honest license_required, not silent allow)", async () => {
    const submitted = await runMacro("marketplace", "submit", {
      name: "Pro Widget", githubUrl: "https://github.com/acme/pro-widget", price: 40,
    }, creatorCtx);
    assert.equal(submitted.ok, true);
    assert.equal(submitted.listing.price, 40);
    assert.equal(submitted.listing.artifactBacked, true);

    const blocked = await runMacro("marketplace", "install", { pluginId: submitted.listing.id }, buyerCtx);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, "license_required");
    assert.equal(blocked.requiredTier, "install");
    // No install was fabricated — nothing was recorded for this buyer.
    const installedList = await runMacro("marketplace", "installed", {}, buyerCtx);
    assert.ok(!installedList.plugins.some((p) => p.id === submitted.listing.id));
  });

  it("purchase (real purchaseArtifact ledger) grants the tier, then install succeeds — and re-purchase is idempotent", async () => {
    const submitted = await runMacro("marketplace", "submit", {
      name: "Checkout Widget", githubUrl: "https://github.com/acme/checkout-widget", price: 40,
    }, creatorCtx);
    const pluginId = submitted.listing.id;
    const creatorId = creatorCtx.actor.userId;
    const buyerId = buyerCtx.actor.userId;

    const buyerBalanceBefore = getBalanceForTest(buyerId);
    const creatorBalanceBefore = getBalanceForTest(creatorId);

    const purchase = await runMacro("marketplace", "purchasePlugin", { pluginId, tier: "install" }, buyerCtx);
    assert.equal(purchase.ok, true);
    assert.equal(purchase.price, 40);
    assert.ok(purchase.purchaseId);

    // ── Fee math — pinned against the SAME (untouched) constants every
    // other creative-artifact purchase uses. If this unit had introduced a
    // parallel fee/royalty constant, these would diverge.
    const expectedPlatformFee = Math.round(40 * CREATIVE_MARKETPLACE.PLATFORM_FEE_RATE * 100) / 100;
    const expectedMarketplaceFee = Math.round(40 * CREATIVE_MARKETPLACE.MARKETPLACE_FEE_RATE * 100) / 100;
    const expectedTotalFees = Math.round((expectedPlatformFee + expectedMarketplaceFee) * 100) / 100;
    const expectedCreatorEarnings = Math.round((40 - expectedTotalFees) * 100) / 100;
    assert.equal(CREATIVE_MARKETPLACE.PLATFORM_FEE_RATE, 0.0146);
    assert.equal(CREATIVE_MARKETPLACE.MARKETPLACE_FEE_RATE, 0.04);
    assert.equal(purchase.fees, expectedTotalFees);
    assert.equal(purchase.creatorEarnings, expectedCreatorEarnings);
    assert.equal(purchase.cascade.total, 0); // original (non-derivative) listing — no cascade

    // ── Independent ledger reconciliation — no double-credit, conserves.
    // Buyer's debit is unconditional (getBalance sums debits by
    // from_user_id with no type filter, so this IS trustworthy).
    const buyerBalanceAfter = getBalanceForTest(buyerId);
    assert.equal(round2(buyerBalanceBefore - buyerBalanceAfter), 40);
    // Creator's credit row is written by purchaseArtifact() as
    // `{from: PLATFORM_ACCOUNT_ID, to: creatorId, type: 'MARKETPLACE_PURCHASE'}`
    // (both from+to set) — economy/balances.js#CREDIT_ROW_PREDICATE treats
    // that shape as the redundant debit-half of the two-row TRANSFER/
    // MARKETPLACE_PURCHASE pattern and excludes it, so getBalance() alone
    // can't see creative-marketplace creator earnings (a pre-existing
    // characteristic of purchaseArtifact()'s row shape, unrelated to and
    // unmodified by this plugin-checkout wiring). Read the exact ledger
    // row purchaseArtifact wrote instead — the precise "no double-credit"
    // check for THIS purchase.
    const creatorRow = getLedgerRowForTest(`creative_seller:${purchase.purchaseId}`);
    assert.ok(creatorRow, "expected a creative_seller ledger row for this purchase");
    assert.equal(creatorRow.to_user_id, creatorId);
    assert.equal(creatorRow.net, expectedCreatorEarnings);
    assert.equal(creatorRow.fee, 0); // fees were already taken on the buyer-side row, not double-charged here
    const buyerDebitRow = getLedgerRowForTest(`creative:${purchase.purchaseId}`);
    assert.ok(buyerDebitRow, "expected a buyer debit ledger row for this purchase");
    assert.equal(buyerDebitRow.from_user_id, buyerId);
    assert.equal(buyerDebitRow.amount, 40);
    assert.equal(buyerDebitRow.net, expectedCreatorEarnings); // remainingAfterFees, no cascade on this listing
    void creatorBalanceBefore; // (kept above for readability; balance-diff isn't the right lens for this row shape)

    // ── Install now succeeds — the license the purchase granted.
    const installed = await runMacro("marketplace", "install", { pluginId }, buyerCtx);
    assert.equal(installed.ok, true);
    assert.equal(installed.plugin.id, pluginId);

    // ── Re-purchasing the SAME tier is idempotent — blocked, not double-charged.
    const balanceBeforeRepurchase = getBalanceForTest(buyerId);
    const dup = await runMacro("marketplace", "purchasePlugin", { pluginId, tier: "install" }, buyerCtx);
    assert.equal(dup.ok, false);
    assert.equal(dup.error, "already_licensed");
    assert.equal(getBalanceForTest(buyerId), balanceBeforeRepurchase); // not charged again
  });

  it("the creator can install their own paid plugin without purchasing", async () => {
    const submitted = await runMacro("marketplace", "submit", {
      name: "Creator's Own Widget", githubUrl: "https://github.com/acme/own-widget", price: 25,
    }, creatorCtx);
    const creatorId = creatorCtx.actor.userId;
    // creatorCtx is never funded anywhere in this file (only buyerCtx/
    // otherBuyerCtx get `creditWallet`) — if `marketplace.install`'s rights
    // gate mistakenly routed the creator through a real purchase debit
    // instead of the `checkAccess` creator-bypass (`{allowed:true,
    // reason:"creator"}` for `creatorId === userId`, server.js:37490's
    // `creatorId: listing.creatorId` on the checkAccess call), the install
    // would either fail (insufficient balance) or leave the balance
    // negative. getBalance sums debits unconditionally (see the ledger-
    // reconciliation comment below), so this is a trustworthy "no charge
    // occurred" signal, not just an ok-flag.
    const creatorBalanceBefore = getBalanceForTest(creatorId);

    const installed = await runMacro("marketplace", "install", { pluginId: submitted.listing.id }, creatorCtx);
    assert.equal(installed.ok, true);
    assert.equal(installed.plugin.id, submitted.listing.id);
    assert.equal(getBalanceForTest(creatorId), creatorBalanceBefore);

    // Round-trip: the install is genuinely recorded for the creator, not
    // just a truthy top-level ok.
    const installedList = await runMacro("marketplace", "installed", {}, creatorCtx);
    assert.ok(installedList.plugins.some((p) => p.id === submitted.listing.id));
  });

  it("a higher purchased tier (resale) implies the base install right end-to-end", async () => {
    const submitted = await runMacro("marketplace", "submit", {
      name: "Resale-Tier Widget", githubUrl: "https://github.com/acme/resale-widget", price: 15,
    }, creatorCtx);
    const pluginId = submitted.listing.id;
    const otherBuyerId = otherBuyerCtx.actor.userId;

    const purchase = await runMacro("marketplace", "purchasePlugin", { pluginId, tier: "resale" }, otherBuyerCtx);
    assert.equal(purchase.ok, true);

    // purchaseArtifact() mirrors the purchased tier into dtu_licenses via
    // grantDtuLicense (economy/creative-marketplace.js step 5, licenseTier:
    // resolvedTier="resale") — check the SAME production checkAccess() that
    // `marketplace.install`'s rights gate calls, directly against the real
    // on-disk DB, proving the resale purchase genuinely implies the lower
    // "install" capability end-to-end (not merely that the install macro
    // happens to return ok for an unrelated reason).
    const rightsDb = getRightsDbForTest();
    const installAccess = checkAccess(rightsDb, {
      userId: otherBuyerId, dtuId: pluginId, contentType: "plugin", action: "install",
    });
    assert.equal(installAccess.allowed, true);
    assert.equal(installAccess.tier, "resale");

    const installed = await runMacro("marketplace", "install", { pluginId }, otherBuyerCtx);
    assert.equal(installed.ok, true);

    // Round-trip: the base right actually shows up as an installed plugin
    // for this buyer.
    const installedList = await runMacro("marketplace", "installed", {}, otherBuyerCtx);
    assert.ok(installedList.plugins.some((p) => p.id === pluginId));
  });

  it("purchasing a free listing is rejected — no phantom checkout on a 0-price item", async () => {
    const submitted = await runMacro("marketplace", "submit", {
      name: "Another Free Widget", githubUrl: "https://github.com/acme/another-free-widget",
    }, creatorCtx);
    const purchase = await runMacro("marketplace", "purchasePlugin", { pluginId: submitted.listing.id }, buyerCtx);
    assert.equal(purchase.ok, false);
    assert.equal(purchase.error, "listing_is_free");
  });
});

// ── Independent balance reader — opens its OWN connection to the same
// DB_PATH file the booted server writes to, so the reconciliation check
// above doesn't trust the server's own in-process bookkeeping.
let _reconcileDb = null;
function getBalanceForTest(userId) {
  if (!_reconcileDb) {
    _reconcileDb = new Database(process.env.DB_PATH);
  }
  return getBalance(_reconcileDb, userId).balance;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function getLedgerRowForTest(refId) {
  if (!_reconcileDb) {
    _reconcileDb = new Database(process.env.DB_PATH);
  }
  return _reconcileDb.prepare("SELECT * FROM economy_ledger WHERE ref_id = ?").get(refId);
}
// Same lazily-opened connection as the two helpers above, exposed directly
// for callers that need to run a real checkAccess()/rights-enforcement
// query against the actual on-disk DB the booted server writes to (not a
// throwaway :memory: db — proves the production dtu_licenses row is really
// there).
function getRightsDbForTest() {
  if (!_reconcileDb) {
    _reconcileDb = new Database(process.env.DB_PATH);
  }
  return _reconcileDb;
}

after(() => {
  try { _reconcileDb?.close?.(); } catch { /* best-effort */ }
});

// Sanity: PLATFORM_ACCOUNT_ID is the real platform account every other
// creative-marketplace purchase pays fees into — confirms the plugin
// purchase path didn't invent a different fee sink.
describe("plugin purchase fee sink", () => {
  it("PLATFORM_ACCOUNT_ID is the canonical platform account", async () => {
    assert.equal(PLATFORM_ACCOUNT_ID, "__PLATFORM__");

    // Round-trip beyond the bare constant: run one more real plugin
    // purchase and confirm the platform-fee ledger row purchaseArtifact()
    // actually writes (economy/creative-marketplace.js "2b. Platform fee
    // credit" entry: `to: PLATFORM_ACCOUNT_ID`, refId `creative_fee:
    // ${purchaseId}`) is attributed to THIS exact exported id — proving the
    // plugin-checkout path didn't invent a different/hardcoded fee sink
    // that happens to share the same string.
    const rt = await macroRuntime("marketplace-plugin-license-fee-sink");
    const { creditWallet } = await load();
    const feeCreatorCtx = await depthCtx(`plugin-fee-creator-${randomUUID()}`);
    const feeBuyerCtx = await depthCtx(`plugin-fee-buyer-${randomUUID()}`);
    creditWallet(feeBuyerCtx.actor.userId, 1000, "test_fund");

    const submitted = await rt.runMacro("marketplace", "submit", {
      name: "Fee Sink Widget", githubUrl: "https://github.com/acme/fee-sink-widget", price: 20,
    }, feeCreatorCtx);
    const purchase = await rt.runMacro(
      "marketplace", "purchasePlugin", { pluginId: submitted.listing.id, tier: "install" }, feeBuyerCtx,
    );
    assert.equal(purchase.ok, true);

    const feeRow = getLedgerRowForTest(`creative_fee:${purchase.purchaseId}`);
    assert.ok(feeRow, "expected a platform-fee ledger row for this purchase");
    assert.equal(feeRow.to_user_id, PLATFORM_ACCOUNT_ID);
  });
});
