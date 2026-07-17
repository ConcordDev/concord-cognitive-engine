/**
 * asset-license-tiers.test.js — pins the additive `blueprint` / `asset`
 * tier ladder added to server/economy/rights-enforcement.js.
 *
 * Owner's model (verbatim, this session): a creative asset (song / DTU /
 * building blueprint) is sold with tiered rights. Download rights = consume
 * only (play/use, cannot remix or relist). Usage rights = may remix the
 * asset and relist the remix on the marketplace. Remixing is gated by
 * economy/royalty-cascade.js#registerCitation's `hasPurchasedLicense` consent
 * check — the caller is expected to compute that boolean via checkAccess()
 * with action "remix" / "create_derivative", so the "usage" tier granting
 * the "remix"+"derivative" capabilities IS the gate a remix's consent check
 * requires.
 *
 * Pure unit test against a throwaway in-memory sqlite db — no server boot,
 * no macro dispatch, no money/fee constants involved (additive-only change).
 *
 * Run: node --test server/tests/economy/asset-license-tiers.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  checkAccess,
  ensureLicenseTables,
  grantLicense,
  TIER_HIERARCHY,
} from "../../economy/rights-enforcement.js";

function makeDb() {
  const db = new Database(":memory:");
  ensureLicenseTables(db);
  return db;
}

for (const contentType of ["blueprint", "asset"]) {
  describe(`rights-enforcement — ${contentType} tier ladder`, () => {
    it(`TIER_HIERARCHY.${contentType} is the additive download→usage→commercial→resale ladder`, () => {
      assert.deepEqual(TIER_HIERARCHY[contentType], ["download", "usage", "commercial", "resale"]);
    });

    it("existing ladders are untouched (additive-only change)", () => {
      assert.deepEqual(TIER_HIERARCHY.music, ["listen", "download", "remix", "commercial", "exclusive", "stems"]);
      assert.deepEqual(TIER_HIERARCHY.art, ["view", "download", "print", "commercial", "exclusive", "source_file"]);
      assert.deepEqual(TIER_HIERARCHY.code, ["view", "personal", "commercial", "resale", "full_source"]);
      assert.deepEqual(TIER_HIERARCHY.document, ["read", "download", "citation", "commercial"]);
      assert.deepEqual(TIER_HIERARCHY["3d_asset"], ["view", "use_in_concord", "download", "commercial"]);
      assert.deepEqual(TIER_HIERARCHY.film, ["view", "download", "commercial", "exclusive", "stems"]);
      assert.deepEqual(TIER_HIERARCHY.plugin, ["install", "commercial", "resale", "source"]);
    });

    it("no license → remix action is denied with requiredTier 'usage' (computed from checkAccess)", () => {
      const db = makeDb();
      const access = checkAccess(db, { userId: "u1", dtuId: "d1", contentType, action: "remix" });
      assert.equal(access.allowed, false);
      assert.equal(access.reason, "no_license");
      assert.equal(access.requiredTier, "usage");
    });

    it("download-tier holder is DENIED remix (consume only — cannot remix or relist)", () => {
      const db = makeDb();
      grantLicense(db, { dtuId: "d1", userId: "downloader", contentType, licenseTier: "download", txId: "tx1" });

      // Consume-only capabilities are granted.
      const view = checkAccess(db, { userId: "downloader", dtuId: "d1", contentType, action: "view" });
      assert.equal(view.allowed, true);
      const download = checkAccess(db, { userId: "downloader", dtuId: "d1", contentType, action: "download" });
      assert.equal(download.allowed, true);
      assert.equal(download.tier, "download");

      // Remix + relist (create_derivative) are both denied.
      const remix = checkAccess(db, { userId: "downloader", dtuId: "d1", contentType, action: "remix" });
      assert.equal(remix.allowed, false);
      assert.equal(remix.reason, "insufficient_license");
      assert.equal(remix.requiredTier, "usage");
      assert.equal(remix.currentTier, "download");

      const derivative = checkAccess(db, { userId: "downloader", dtuId: "d1", contentType, action: "create_derivative" });
      assert.equal(derivative.allowed, false);
      assert.equal(derivative.requiredTier, "usage");
    });

    it("usage-tier holder is ALLOWED remix and create_derivative (the remix consent gate)", () => {
      const db = makeDb();
      grantLicense(db, { dtuId: "d2", userId: "remixer", contentType, licenseTier: "usage", txId: "tx2" });

      const remix = checkAccess(db, { userId: "remixer", dtuId: "d2", contentType, action: "remix" });
      assert.equal(remix.allowed, true);
      assert.equal(remix.tier, "usage");

      const derivative = checkAccess(db, { userId: "remixer", dtuId: "d2", contentType, action: "create_derivative" });
      assert.equal(derivative.allowed, true);
      assert.equal(derivative.tier, "usage");

      // A "usage" holder is exactly the case registerCitation's
      // hasPurchasedLicense=true consent path exists for: a caller that
      // holds this license should compute hasPurchasedLicense from this
      // very allowed=true result before calling registerCitation.
      assert.equal(remix.allowed && derivative.allowed, true);
    });

    it("cumulativity: 'commercial' tier implies download + usage (every lower tier's capabilities)", () => {
      const db = makeDb();
      grantLicense(db, { dtuId: "d3", userId: "commercial-buyer", contentType, licenseTier: "commercial", txId: "tx3" });
      for (const action of ["view", "download", "remix", "create_derivative", "commercial_use"]) {
        assert.equal(
          checkAccess(db, { userId: "commercial-buyer", dtuId: "d3", contentType, action }).allowed,
          true,
          `commercial tier should grant ${action}`,
        );
      }
      // Still doesn't imply the tier ABOVE it.
      const resale = checkAccess(db, { userId: "commercial-buyer", dtuId: "d3", contentType, action: "resale" });
      assert.equal(resale.allowed, false);
      assert.equal(resale.requiredTier, "resale");
    });

    it("cumulativity: 'resale' (top tier) implies every capability below it", () => {
      const db = makeDb();
      grantLicense(db, { dtuId: "d4", userId: "reseller", contentType, licenseTier: "resale", txId: "tx4" });
      for (const action of ["view", "download", "remix", "create_derivative", "commercial_use", "resale"]) {
        assert.equal(
          checkAccess(db, { userId: "reseller", dtuId: "d4", contentType, action }).allowed,
          true,
          `resale tier should grant ${action}`,
        );
      }
    });

    it("creator always has full access regardless of license (including remix/relist)", () => {
      const db = makeDb();
      for (const action of ["view", "download", "remix", "create_derivative", "commercial_use", "resale"]) {
        const access = checkAccess(db, {
          userId: "creatorX", dtuId: "d5", contentType, action, creatorId: "creatorX",
        });
        assert.equal(access.allowed, true, `creator should always pass ${action}`);
        assert.equal(access.reason, "creator");
      }
    });

    it("getHighestTier reports 'usage' after an upgrade purchase on top of 'download'", () => {
      const db = makeDb();
      grantLicense(db, { dtuId: "d6", userId: "upgrader", contentType, licenseTier: "download", txId: "tx6a" });
      grantLicense(db, { dtuId: "d6", userId: "upgrader", contentType, licenseTier: "usage", txId: "tx6b" });
      const remix = checkAccess(db, { userId: "upgrader", dtuId: "d6", contentType, action: "remix" });
      assert.equal(remix.allowed, true);
      assert.equal(remix.tier, "usage");
    });
  });
}
