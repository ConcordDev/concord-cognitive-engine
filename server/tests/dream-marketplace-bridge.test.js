/**
 * Tier-2 contract tests for the dream -> marketplace promotion bridge
 * (server/lib/dream-marketplace-bridge.js).
 *
 * Pins two things:
 *   1. The dream path (promoteDreamDTU / scoreDreamCandidate / runPromotionPass)
 *      is byte-identical in shape/behavior to before the S4 generalization —
 *      it's now a thin wrapper over promoteCandidateAsDTU with dream-specific
 *      opts baked in, but the seller id, id prefix, promotionSource, price,
 *      and repair floor are unchanged.
 *   2. The new generic seam (promoteCandidateAsDTU) supports a NON-dream kind
 *      (a fake "recipe" candidate) with custom scoreFn / sellerLabel / idPrefix
 *      / dtuType / licenseTerms / userPrice, producing a listing that carries
 *      those fields — without touching STATE.marketplaceListings in any way
 *      other than the plain in-memory Map write the dream path already does,
 *      and without calling into server/economy/* at all.
 *
 * Run: node --test tests/dream-marketplace-bridge.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../migrate.js";
import { grantConsent, revokeConsent } from "../lib/consent.js";
import {
  scoreDreamCandidate,
  promoteDreamDTU,
  promoteCandidateAsDTU,
  runPromotionPass,
} from "../lib/dream-marketplace-bridge.js";

function makeDreamDtu(id) {
  return {
    id,
    title: "Consolidated insight on tidal harmonics",
    domain: "astronomy",
    human: { summary: "A synthesis of tide/moon-phase correlations." },
    meta: {
      tags: ["domain:astronomy", "domain:physics", "domain:oceanography"],
      novelty: 0.9,
    },
    lineage: {
      parents: ["dtu-a", "dtu-b", "dtu-c", "dtu-d", "dtu-e", "dtu-f", "dtu-g", "dtu-h", "dtu-i", "dtu-j"],
      citations: ["dtu-w", "dtu-x", "dtu-y", "dtu-z", "dtu-p", "dtu-q", "dtu-r", "dtu-s"],
    },
  };
}

function makeRecipeDtu(id) {
  return {
    id,
    title: "Grandmother's Sourdough Starter",
    domain: "cooking",
    human: { summary: "A patient, low-hydration starter method." },
    meta: { tags: ["domain:cooking"] },
  };
}

function freshState(dtuEntries) {
  return { dtus: new Map(dtuEntries) };
}

describe("dream-marketplace-bridge: dream path is unchanged", () => {
  let STATE;
  const dtuId = "dream-dtu-1";

  beforeEach(() => {
    STATE = freshState([[dtuId, makeDreamDtu(dtuId)]]);
  });

  it("promoteDreamDTU promotes a high-scoring candidate with dream-specific labels + price 0", async () => {
    const candidate = {
      dtuId,
      novelty: 0.8,
      domains: ["astronomy", "physics"],
      consolidatedFrom: ["dtu-a", "dtu-b", "dtu-c"],
      citations: ["dtu-x"],
    };

    const result = await promoteDreamDTU(STATE, candidate);

    assert.equal(result.promoted, true);
    assert.equal(typeof result.listingId, "string");
    assert.match(result.listingId, /^dream-listing-/);
    assert.equal(result.score, scoreDreamCandidate(candidate));

    const listing = STATE.marketplaceListings.get(result.listingId);
    assert.ok(listing, "listing was written into STATE.marketplaceListings");
    assert.equal(listing.sellerId, "system_dream_cycle");
    assert.equal(listing.price, 0);
    assert.equal(listing.currency, "concord_coin");
    assert.equal(listing.promotionSource, "dream_cycle");
    assert.equal(listing.sourceDtuId, dtuId);
    assert.equal(listing.status, "active");
    // No new metadata fields should leak onto the dream path's listing shape.
    assert.equal("dtuType" in listing, false);
    assert.equal("licenseTerms" in listing, false);
  });

  it("promoteDreamDTU rejects a below-floor candidate the same way as before", async () => {
    const candidate = {
      dtuId,
      novelty: 0,
      domains: [],
      consolidatedFrom: [],
      citations: [],
    };
    const result = await promoteDreamDTU(STATE, candidate);
    assert.equal(result.promoted, false);
    assert.equal(result.reason, "score_below_floor");
  });

  it("promoteDreamDTU reports dtu_not_found for a missing candidate, unchanged", async () => {
    const result = await promoteDreamDTU(STATE, { dtuId: "does-not-exist" });
    assert.equal(result.promoted, false);
    assert.equal(result.reason, "dtu_not_found");
  });

  it("runPromotionPass still drives promoteDreamDTU end-to-end from cycle phases", async () => {
    const cycle = {
      phases: {
        consolidate: {
          result: { consolidatedDtus: [dtuId] },
        },
      },
    };
    const result = await runPromotionPass(STATE, cycle);
    assert.equal(result.ok, true);
    assert.equal(result.candidates, 1);
    assert.equal(result.promoted, 1);
    assert.equal(result.results[0].dtuId, dtuId);
  });
});

describe("dream-marketplace-bridge: generic seam supports a non-dream kind", () => {
  let STATE;
  const dtuId = "recipe-dtu-1";

  beforeEach(() => {
    STATE = freshState([[dtuId, makeRecipeDtu(dtuId)]]);
  });

  it("promoteCandidateAsDTU promotes a 'recipe' candidate with custom labels, price, and license metadata", async () => {
    const candidate = { dtuId, householdRating: 0.9 };
    const db = new Database(":memory:");
    await runMigrations(db);
    STATE.db = db;
    grantConsent(db, "user-recipe", "allow_phenomenal_monetization");

    const result = await promoteCandidateAsDTU(STATE, candidate, {
      scoreFn: c => Math.round((c.householdRating ?? 0) * 100),
      scoreFloor: 10,
      sellerLabel: "system_recipe_promoter",
      idPrefix: "recipe-listing",
      promotionSource: "recipe_promoter",
      dtuType: "recipe",
      userPrice: 25,
      userId: "user-recipe",
      licenseTerms: { kind: "royalty_only", exclusive: false },
    });

    assert.equal(result.promoted, true);
    assert.match(result.listingId, /^recipe-listing-/);
    assert.equal(result.score, 90);

    const listing = STATE.marketplaceListings.get(result.listingId);
    assert.ok(listing);
    assert.equal(listing.sellerId, "system_recipe_promoter");
    assert.equal(listing.promotionSource, "recipe_promoter");
    assert.equal(listing.dtuType, "recipe");
    assert.equal(listing.price, 25);
    assert.deepEqual(listing.licenseTerms, { kind: "royalty_only", exclusive: false });
    assert.equal(listing.sourceDtuId, dtuId);
  });

  it("promoteCandidateAsDTU defaults price to 0 and omits optional metadata when not supplied (dream-compatible default)", async () => {
    const candidate = { dtuId, householdRating: 0.9 };
    const result = await promoteCandidateAsDTU(STATE, candidate, {
      scoreFn: c => Math.round((c.householdRating ?? 0) * 100),
      scoreFloor: 10,
    });
    assert.equal(result.promoted, true);
    const listing = STATE.marketplaceListings.get(result.listingId);
    assert.equal(listing.price, 0);
    assert.equal("dtuType" in listing, false);
    assert.equal("licenseTerms" in listing, false);
    // Falls back to the dream defaults when the caller doesn't override them.
    assert.equal(listing.sellerId, "system_dream_cycle");
    assert.match(listing.id, /^dream-listing-/);
  });

  it("promoteCandidateAsDTU respects a custom scoreFloor rejection independent of scoreDreamCandidate", async () => {
    const candidate = { dtuId, householdRating: 0.05 };
    const result = await promoteCandidateAsDTU(STATE, candidate, {
      scoreFn: c => Math.round((c.householdRating ?? 0) * 100),
      scoreFloor: 50,
    });
    assert.equal(result.promoted, false);
    assert.equal(result.reason, "score_below_floor");
    assert.equal(result.score, 5);
  });
});

describe("dream-marketplace-bridge: allow_phenomenal_monetization consent gate", () => {
  let STATE;
  let db;
  const dtuId = "dream-dtu-consent-1";
  const userId = "user-dreamer-1";

  function opts(extra = {}) {
    return {
      scoreFn: () => 100, // always clears the score floor
      scoreFloor: 10,
      userId,
      ...extra,
    };
  }

  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    STATE = { dtus: new Map([[dtuId, makeDreamDtu(dtuId)]]), db };
  });

  it("(a) a free/zero-price dream listing succeeds with NO consent required — regression for the existing P-B path", async () => {
    const result = await promoteCandidateAsDTU(STATE, { dtuId }, opts());
    assert.equal(result.promoted, true);
    const listing = STATE.marketplaceListings.get(result.listingId);
    assert.equal(listing.price, 0);

    // Explicit userPrice: 0 (not just omitted) must also require no consent.
    const result2 = await promoteCandidateAsDTU(STATE, { dtuId }, opts({ userPrice: 0 }));
    assert.equal(result2.promoted, true);
  });

  it("(b) a priced listing WITHOUT allow_phenomenal_monetization consent is honestly rejected, not silently allowed", async () => {
    const result = await promoteCandidateAsDTU(STATE, { dtuId }, opts({ userPrice: 25 }));
    assert.equal(result.promoted, false);
    assert.equal(result.reason, "consent_required");
    assert.equal(result.consentRequired.action, "allow_phenomenal_monetization");
    assert.equal(STATE.marketplaceListings, undefined, "no listing map should even be created");
  });

  it("(b2) a priced listing with no userId/db supplied at all is also honestly rejected (fail-closed, never fabricate consent)", async () => {
    const bareState = { dtus: new Map([[dtuId, makeDreamDtu(dtuId)]]) }; // no .db
    const result = await promoteCandidateAsDTU(bareState, { dtuId }, {
      scoreFn: () => 100,
      scoreFloor: 10,
      userPrice: 10,
    });
    assert.equal(result.promoted, false);
    assert.equal(result.reason, "consent_required");
  });

  it("(c) a priced listing WITH consent granted succeeds, carrying the real price + license terms unchanged", async () => {
    grantConsent(db, userId, "allow_phenomenal_monetization");

    const result = await promoteCandidateAsDTU(STATE, { dtuId }, opts({
      userPrice: 42,
      licenseTerms: { kind: "personal_use_only", exclusive: false },
    }));

    assert.equal(result.promoted, true);
    const listing = STATE.marketplaceListings.get(result.listingId);
    assert.equal(listing.price, 42);
    assert.deepEqual(listing.licenseTerms, { kind: "personal_use_only", exclusive: false });
    assert.equal(listing.sourceDtuId, dtuId);
  });

  it("(d) revoking consent blocks FUTURE priced listings but does not retroactively unlist an already-created listing", async () => {
    grantConsent(db, userId, "allow_phenomenal_monetization");

    const first = await promoteCandidateAsDTU(STATE, { dtuId }, opts({ userPrice: 15 }));
    assert.equal(first.promoted, true);
    const existingListing = STATE.marketplaceListings.get(first.listingId);
    assert.equal(existingListing.price, 15);

    const revoke = revokeConsent(db, userId, "allow_phenomenal_monetization");
    assert.equal(revoke.ok, true);
    assert.equal(revoke.revoked, true);

    // The already-created listing is untouched — promoteCandidateAsDTU only
    // gates the creation path, never re-checks consent on read.
    const stillThere = STATE.marketplaceListings.get(first.listingId);
    assert.deepEqual(stillThere, existingListing);
    assert.equal(stillThere.price, 15);
    assert.equal(stillThere.status, "active");

    // But a NEW priced listing attempt is now blocked.
    STATE.dtus.set("dream-dtu-consent-2", makeDreamDtu("dream-dtu-consent-2"));
    const secondRetry = await promoteCandidateAsDTU(STATE, { dtuId: "dream-dtu-consent-2" }, opts({ userPrice: 15 }));
    assert.equal(secondRetry.promoted, false);
    assert.equal(secondRetry.reason, "consent_required");

    // A free listing for the same user remains completely unaffected by revocation.
    const freeAfterRevoke = await promoteCandidateAsDTU(STATE, { dtuId }, opts());
    assert.equal(freeAfterRevoke.promoted, true);
  });
});
