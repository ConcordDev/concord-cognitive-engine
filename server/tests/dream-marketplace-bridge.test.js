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

    const result = await promoteCandidateAsDTU(STATE, candidate, {
      scoreFn: c => Math.round((c.householdRating ?? 0) * 100),
      scoreFloor: 10,
      sellerLabel: "system_recipe_promoter",
      idPrefix: "recipe-listing",
      promotionSource: "recipe_promoter",
      dtuType: "recipe",
      userPrice: 25,
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
