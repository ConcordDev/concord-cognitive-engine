import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  QUEST_REWARD_POLICY,
  CREATOR_RIGHTS,
  ARTIFACT_TYPES,
  CREATIVE_FEDERATION,
  CREATIVE_QUESTS,
  CREATIVE_LEADERBOARD,
  CREATIVE_MARKETPLACE,
  LICENSE_TYPES,
  DEFAULT_CREATIVE_FILTERS,
} from "../lib/creative-marketplace-constants.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function assertFrozen(obj, label) {
  assert.ok(Object.isFrozen(obj), `${label} should be frozen`);
}

function assertImmutable(obj, label) {
  assertFrozen(obj, label);
  assert.throws(() => { "use strict"; obj.__newProp = 1; }, TypeError, `${label}: cannot add`);
  const firstKey = Object.keys(obj)[0];
  if (firstKey !== undefined) {
    assert.throws(() => { "use strict"; delete obj[firstKey]; }, TypeError, `${label}: cannot delete`);
    const original = obj[firstKey];
    assert.throws(() => { "use strict"; obj[firstKey] = "__CHANGED__"; }, TypeError, `${label}: cannot modify`);
    assert.deepStrictEqual(obj[firstKey], original);
  }
}

// ── QUEST_REWARD_POLICY ──────────────────────────────────────────────────────

describe("QUEST_REWARD_POLICY", () => {
  it("is frozen and immutable", () => {
    assertImmutable(QUEST_REWARD_POLICY, "QUEST_REWARD_POLICY");
  });

  it("allowed contains xp and badges", () => {
    assert.ok(QUEST_REWARD_POLICY.allowed.includes("xp"));
    assert.ok(QUEST_REWARD_POLICY.allowed.includes("badges"));
  });

  it("forbidden contains concord_coin", () => {
    assert.ok(QUEST_REWARD_POLICY.forbidden.includes("concord_coin"));
    assert.ok(QUEST_REWARD_POLICY.forbidden.includes("direct_payments"));
  });

  it("allowed and forbidden have no overlap", () => {
    for (const item of QUEST_REWARD_POLICY.allowed) {
      assert.ok(!QUEST_REWARD_POLICY.forbidden.includes(item), `${item} should not be in both allowed and forbidden`);
    }
  });

  it("has a rule string", () => {
    assert.equal(typeof QUEST_REWARD_POLICY.rule, "string");
    assert.ok(QUEST_REWARD_POLICY.rule.length > 0);
  });
});

// ── CREATOR_RIGHTS ───────────────────────────────────────────────────────────

describe("CREATOR_RIGHTS", () => {
  it("is frozen and immutable", () => {
    assertImmutable(CREATOR_RIGHTS, "CREATOR_RIGHTS");
  });

  it("ownershipTransfer is FORBIDDEN", () => {
    assert.equal(CREATOR_RIGHTS.ownershipTransfer, "FORBIDDEN");
  });

  it("saleType is usage_license", () => {
    assert.equal(CREATOR_RIGHTS.saleType, "usage_license");
  });

  it("creatorRetains includes full_intellectual_property", () => {
    assert.ok(CREATOR_RIGHTS.creatorRetains.includes("full_intellectual_property"));
  });

  it("buyerReceives includes usage_rights_as_defined_in_license", () => {
    assert.ok(CREATOR_RIGHTS.buyerReceives.includes("usage_rights_as_defined_in_license"));
  });

  it("buyerDoesNotReceive includes ownership", () => {
    assert.ok(CREATOR_RIGHTS.buyerDoesNotReceive.includes("ownership"));
  });

  it("buyerReceives and buyerDoesNotReceive have no overlap", () => {
    for (const item of CREATOR_RIGHTS.buyerReceives) {
      assert.ok(!CREATOR_RIGHTS.buyerDoesNotReceive.includes(item),
        `${item} should not be in both buyerReceives and buyerDoesNotReceive`);
    }
  });
});

// ── ARTIFACT_TYPES ───────────────────────────────────────────────────────────

describe("ARTIFACT_TYPES", () => {
  it("is frozen and immutable", () => {
    assertImmutable(ARTIFACT_TYPES, "ARTIFACT_TYPES");
  });

  const expectedTypes = [
    "music_track", "beat", "sound_effect", "podcast_episode",
    "image", "animation", "threed_model",
    "video",
    "document", "code",
    "font", "template",
    "dataset",
    "condensed",
  ];

  it("has all expected artifact types", () => {
    for (const type of expectedTypes) {
      assert.ok(type in ARTIFACT_TYPES, `Missing artifact type: ${type}`);
    }
  });

  it("every artifact type has extensions, maxSizeMB, and derivativeTypes", () => {
    for (const [key, val] of Object.entries(ARTIFACT_TYPES)) {
      assert.ok(Array.isArray(val.extensions), `${key} should have extensions array`);
      assert.ok(val.extensions.length > 0, `${key} should have at least one extension`);
      assert.equal(typeof val.maxSizeMB, "number", `${key} should have numeric maxSizeMB`);
      assert.ok(val.maxSizeMB > 0, `${key} maxSizeMB should be positive`);
      assert.ok(Array.isArray(val.derivativeTypes), `${key} should have derivativeTypes array`);
      assert.ok(val.derivativeTypes.length > 0, `${key} should have at least one derivativeType`);
    }
  });

  it("all extensions start with a dot", () => {
    for (const [key, val] of Object.entries(ARTIFACT_TYPES)) {
      for (const ext of val.extensions) {
        assert.ok(ext.startsWith("."), `${key} extension ${ext} should start with .`);
      }
    }
  });

  it("video type has derivative types matching film remix types", () => {
    const videoDerivatives = ARTIFACT_TYPES.video.derivativeTypes;
    assert.ok(videoDerivatives.includes("remix"));
    assert.ok(videoDerivatives.includes("re-cut"));
    assert.ok(videoDerivatives.includes("commentary-overlay"));
  });
});

// ── CREATIVE_FEDERATION ──────────────────────────────────────────────────────

describe("CREATIVE_FEDERATION", () => {
  it("is frozen and immutable", () => {
    assertImmutable(CREATIVE_FEDERATION, "CREATIVE_FEDERATION");
  });

  it("has four tiers: local, regional, national, global", () => {
    assert.deepStrictEqual(
      Object.keys(CREATIVE_FEDERATION).sort(),
      ["global", "local", "national", "regional"],
    );
  });

  it("local marketplace is false", () => {
    assert.equal(CREATIVE_FEDERATION.local.marketplace, false);
  });

  it("regional, national, global marketplaces are true", () => {
    assert.equal(CREATIVE_FEDERATION.regional.marketplace, true);
    assert.equal(CREATIVE_FEDERATION.national.marketplace, true);
    assert.equal(CREATIVE_FEDERATION.global.marketplace, true);
  });

  it("heartbeatMs increases with tier", () => {
    assert.ok(CREATIVE_FEDERATION.local.heartbeatMs < CREATIVE_FEDERATION.regional.heartbeatMs);
    assert.ok(CREATIVE_FEDERATION.regional.heartbeatMs < CREATIVE_FEDERATION.national.heartbeatMs);
    assert.ok(CREATIVE_FEDERATION.national.heartbeatMs < CREATIVE_FEDERATION.global.heartbeatMs);
  });

  it("regional has promotionToNational criteria", () => {
    const promo = CREATIVE_FEDERATION.regional.promotionToNational;
    assert.ok(promo.minPurchases > 0);
    assert.ok(promo.minDerivatives > 0);
    assert.ok(promo.minRating > 0);
    assert.ok(promo.minAgeHours > 0);
  });

  it("national has promotionToGlobal criteria", () => {
    const promo = CREATIVE_FEDERATION.national.promotionToGlobal;
    assert.ok(promo.minPurchases > 0);
    assert.ok(promo.minDerivatives > 0);
    assert.ok(promo.minRating > 0);
  });

  it("global quality gate has highest council votes and rating", () => {
    assert.ok(CREATIVE_FEDERATION.global.qualityGate.councilVotes > CREATIVE_FEDERATION.national.qualityGate.councilVotes);
    assert.ok(CREATIVE_FEDERATION.global.qualityGate.minRating > CREATIVE_FEDERATION.national.promotionToGlobal.minRating);
  });

  it("each tier with marketplace has discoveryFeatures", () => {
    assert.ok(CREATIVE_FEDERATION.regional.discoveryFeatures);
    assert.ok(CREATIVE_FEDERATION.national.discoveryFeatures);
    assert.ok(CREATIVE_FEDERATION.global.discoveryFeatures);
  });
});

// ── CREATIVE_QUESTS ──────────────────────────────────────────────────────────

describe("CREATIVE_QUESTS", () => {
  it("is frozen and immutable", () => {
    assertImmutable(CREATIVE_QUESTS, "CREATIVE_QUESTS");
  });

  it("has regional, national, global tiers", () => {
    assert.deepStrictEqual(Object.keys(CREATIVE_QUESTS).sort(), ["global", "national", "regional"]);
  });

  it("each tier is a non-empty array", () => {
    for (const [tier, quests] of Object.entries(CREATIVE_QUESTS)) {
      assert.ok(Array.isArray(quests), `${tier} should be an array`);
      assert.ok(quests.length > 0, `${tier} should have at least one quest`);
    }
  });

  it("every quest has id, name, description, xpReward, badge", () => {
    for (const [tier, quests] of Object.entries(CREATIVE_QUESTS)) {
      for (const q of quests) {
        assert.equal(typeof q.id, "string", `${tier} quest missing id`);
        assert.equal(typeof q.name, "string", `${tier} quest missing name`);
        assert.equal(typeof q.description, "string", `${tier} quest missing description`);
        assert.equal(typeof q.xpReward, "number", `${tier} quest missing xpReward`);
        assert.ok(q.xpReward > 0, `${tier} quest xpReward should be positive`);
        assert.equal(typeof q.badge, "string", `${tier} quest missing badge`);
      }
    }
  });

  it("quest IDs are unique across all tiers", () => {
    const allIds = [];
    for (const quests of Object.values(CREATIVE_QUESTS)) {
      for (const q of quests) {
        allIds.push(q.id);
      }
    }
    assert.equal(allIds.length, new Set(allIds).size, "Quest IDs must be unique");
  });

  it("no quest has coin rewards (constitutional invariant)", () => {
    for (const quests of Object.values(CREATIVE_QUESTS)) {
      for (const q of quests) {
        assert.equal(q.coinReward, undefined, `Quest ${q.id} should not have coin reward`);
      }
    }
  });

  it("xpReward generally increases from regional to global", () => {
    const regionalMax = Math.max(...CREATIVE_QUESTS.regional.map(q => q.xpReward));
    const globalMin = Math.min(...CREATIVE_QUESTS.global.map(q => q.xpReward));
    assert.ok(globalMin >= regionalMax, "global min XP should be >= regional max XP");
  });
});

// ── CREATIVE_LEADERBOARD ─────────────────────────────────────────────────────

describe("CREATIVE_LEADERBOARD", () => {
  it("is frozen and immutable", () => {
    assertImmutable(CREATIVE_LEADERBOARD, "CREATIVE_LEADERBOARD");
  });

  it("has categories array with at least 5 entries", () => {
    assert.ok(Array.isArray(CREATIVE_LEADERBOARD.categories));
    assert.ok(CREATIVE_LEADERBOARD.categories.length >= 5);
  });

  it("has charts for regional, national, global", () => {
    assert.ok(CREATIVE_LEADERBOARD.charts.regional);
    assert.ok(CREATIVE_LEADERBOARD.charts.national);
    assert.ok(CREATIVE_LEADERBOARD.charts.global);
  });

  it("topArtists increases with tier", () => {
    assert.ok(CREATIVE_LEADERBOARD.charts.regional.topArtists < CREATIVE_LEADERBOARD.charts.national.topArtists);
    assert.ok(CREATIVE_LEADERBOARD.charts.national.topArtists < CREATIVE_LEADERBOARD.charts.global.topArtists);
  });
});

// ── CREATIVE_MARKETPLACE ─────────────────────────────────────────────────────

describe("CREATIVE_MARKETPLACE", () => {
  it("is frozen and immutable", () => {
    assertImmutable(CREATIVE_MARKETPLACE, "CREATIVE_MARKETPLACE");
  });

  it("TOTAL_FEE_RATE equals PLATFORM_FEE_RATE + MARKETPLACE_FEE_RATE", () => {
    const sum = CREATIVE_MARKETPLACE.PLATFORM_FEE_RATE + CREATIVE_MARKETPLACE.MARKETPLACE_FEE_RATE;
    assert.ok(Math.abs(sum - CREATIVE_MARKETPLACE.TOTAL_FEE_RATE) < 1e-10);
  });

  it("INITIAL_ROYALTY_RATE is 0.21 (21%)", () => {
    assert.equal(CREATIVE_MARKETPLACE.INITIAL_ROYALTY_RATE, 0.21);
  });

  it("ROYALTY_HALVING is 2", () => {
    assert.equal(CREATIVE_MARKETPLACE.ROYALTY_HALVING, 2);
  });

  it("ROYALTY_FLOOR is a small positive number", () => {
    assert.ok(CREATIVE_MARKETPLACE.ROYALTY_FLOOR > 0);
    assert.ok(CREATIVE_MARKETPLACE.ROYALTY_FLOOR < 0.01);
  });

  it("MAX_CASCADE_DEPTH is 50", () => {
    assert.equal(CREATIVE_MARKETPLACE.MAX_CASCADE_DEPTH, 50);
  });

  it("SIMILARITY_THRESHOLD is 0.90", () => {
    assert.equal(CREATIVE_MARKETPLACE.SIMILARITY_THRESHOLD, 0.90);
  });

  it("promotion thresholds are consistent with federation", () => {
    assert.equal(
      CREATIVE_MARKETPLACE.REGIONAL_TO_NATIONAL_MIN_SALES,
      CREATIVE_FEDERATION.regional.promotionToNational.minPurchases,
    );
    assert.equal(
      CREATIVE_MARKETPLACE.NATIONAL_TO_GLOBAL_MIN_SALES,
      CREATIVE_FEDERATION.national.promotionToGlobal.minPurchases,
    );
  });

  it("refresh intervals are positive numbers", () => {
    assert.ok(CREATIVE_MARKETPLACE.TRENDING_REFRESH_MS > 0);
    assert.ok(CREATIVE_MARKETPLACE.SPOTLIGHT_REFRESH_MS > 0);
    assert.ok(CREATIVE_MARKETPLACE.CHARTS_REFRESH_MS > 0);
  });
});

// ── LICENSE_TYPES ────────────────────────────────────────────────────────────

describe("LICENSE_TYPES", () => {
  it("is frozen and immutable", () => {
    assertImmutable(LICENSE_TYPES, "LICENSE_TYPES");
  });

  it("has standard, exclusive, custom, and personal-use", () => {
    // personal-use was added when the recipe substrate adopted scope='personal'
    // by default (see CLAUDE.md "personal_dtus_never_leak" invariant).
    assert.deepStrictEqual(Object.keys(LICENSE_TYPES).sort(), ["custom", "exclusive", "personal-use", "standard"]);
  });

  it("standard license allows commercial use and derivatives", () => {
    assert.equal(LICENSE_TYPES.standard.commercialUse, true);
    assert.equal(LICENSE_TYPES.standard.derivativesAllowed, true);
    assert.equal(LICENSE_TYPES.standard.attributionRequired, true);
  });

  it("exclusive license has exclusiveHolder flag", () => {
    assert.equal(LICENSE_TYPES.exclusive.exclusiveHolder, true);
  });

  it("custom license has null values for customization", () => {
    assert.equal(LICENSE_TYPES.custom.commercialUse, null);
    assert.equal(LICENSE_TYPES.custom.derivativesAllowed, null);
    assert.equal(LICENSE_TYPES.custom.attributionRequired, null);
  });
});

// ── DEFAULT_CREATIVE_FILTERS ────────────────────────────────────────────────

describe("DEFAULT_CREATIVE_FILTERS", () => {
  it("is frozen and immutable", () => {
    assertImmutable(DEFAULT_CREATIVE_FILTERS, "DEFAULT_CREATIVE_FILTERS");
  });

  it("has expected default values", () => {
    assert.deepStrictEqual(DEFAULT_CREATIVE_FILTERS.artifactTypes, []);
    assert.deepStrictEqual(DEFAULT_CREATIVE_FILTERS.genres, []);
    assert.deepStrictEqual(DEFAULT_CREATIVE_FILTERS.priceRange, { min: null, max: null });
    assert.equal(DEFAULT_CREATIVE_FILTERS.minRating, null);
    assert.equal(DEFAULT_CREATIVE_FILTERS.derivativesAllowed, true);
    assert.equal(DEFAULT_CREATIVE_FILTERS.discoveryMode, "browse");
    assert.equal(DEFAULT_CREATIVE_FILTERS.showDerivativeTree, false);
    assert.equal(DEFAULT_CREATIVE_FILTERS.showCascadeEarnings, false);
    assert.equal(DEFAULT_CREATIVE_FILTERS.showEmergentCreated, true);
    assert.equal(DEFAULT_CREATIVE_FILTERS.emergentOnly, false);
  });
});
