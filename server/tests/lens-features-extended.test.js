/**
 * Comprehensive tests for lib/lens-features-extended.js
 *
 * Covers:
 *   - UNIVERSAL_FEATURES: structure, immutability, field correctness
 *   - EXTENDED_FEATURES: every lens entry (66-112), structural invariants,
 *     category membership, feature shape, access flags, economic integrations,
 *     featureCount accuracy, lens number uniqueness, and cross-cutting concerns.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  UNIVERSAL_FEATURES,
  EXTENDED_FEATURES,
} from "../lib/lens-features-extended.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Validate that a single feature object produced by the private `f()` helper
 *  has the correct shape and value types. */
function assertFeatureShape(feat, ctx) {
  assert.ok(feat, `${ctx}: feature is defined`);
  assert.equal(typeof feat.id, "string", `${ctx}: id is string`);
  assert.ok(feat.id.length > 0, `${ctx}: id is non-empty`);
  assert.equal(typeof feat.name, "string", `${ctx}: name is string`);
  assert.ok(feat.name.length > 0, `${ctx}: name is non-empty`);
  assert.equal(typeof feat.description, "string", `${ctx}: description is string`);
  assert.ok(feat.description.length > 0, `${ctx}: description is non-empty`);
  assert.equal(typeof feat.category, "string", `${ctx}: category is string`);
  assert.ok(Array.isArray(feat.integrations), `${ctx}: integrations is array`);
  assert.equal(feat.status, "active", `${ctx}: status is "active"`);
}

/** Validate the structure of a lens entry inside EXTENDED_FEATURES. */
function assertLensEntryShape(entry, key) {
  const ctx = `EXTENDED_FEATURES.${key}`;
  assert.equal(typeof entry.lensId, "string", `${ctx}: lensId is string`);
  assert.equal(entry.lensId, key, `${ctx}: lensId matches key`);
  assert.equal(typeof entry.lensNumber, "number", `${ctx}: lensNumber is number`);
  assert.ok(Number.isInteger(entry.lensNumber), `${ctx}: lensNumber is integer`);
  assert.equal(typeof entry.category, "string", `${ctx}: category is string`);
  assert.ok(Array.isArray(entry.features), `${ctx}: features is array`);
  assert.ok(entry.features.length > 0, `${ctx}: features is non-empty`);
  assert.equal(typeof entry.featureCount, "number", `${ctx}: featureCount is number`);
  assert.ok(Array.isArray(entry.economicIntegrations), `${ctx}: economicIntegrations is array`);
  assert.equal(typeof entry.emergentAccess, "boolean", `${ctx}: emergentAccess is boolean`);
  assert.equal(typeof entry.botAccess, "boolean", `${ctx}: botAccess is boolean`);
  assert.equal(typeof entry.usbIntegration, "boolean", `${ctx}: usbIntegration is boolean`);
}

const ALL_LENS_KEYS = Object.keys(EXTENDED_FEATURES);

// ═════════════════════════════════════════════════════════════════════════════
// UNIVERSAL_FEATURES
// ═════════════════════════════════════════════════════════════════════════════

describe("UNIVERSAL_FEATURES", () => {
  it("is a frozen array (immutable)", () => {
    assert.ok(Array.isArray(UNIVERSAL_FEATURES));
    assert.ok(Object.isFrozen(UNIVERSAL_FEATURES));
  });

  it("contains exactly 20 features", () => {
    assert.equal(UNIVERSAL_FEATURES.length, 20);
  });

  it("every feature has the correct shape from f() helper", () => {
    for (let i = 0; i < UNIVERSAL_FEATURES.length; i++) {
      assertFeatureShape(UNIVERSAL_FEATURES[i], `UNIVERSAL[${i}]`);
    }
  });

  it("every feature has status 'active'", () => {
    for (const feat of UNIVERSAL_FEATURES) {
      assert.equal(feat.status, "active");
    }
  });

  it("feature IDs are unique", () => {
    const ids = UNIVERSAL_FEATURES.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate universal feature IDs");
  });

  it("feature names are unique", () => {
    const names = UNIVERSAL_FEATURES.map((f) => f.name);
    assert.equal(new Set(names).size, names.length, "duplicate universal feature names");
  });

  // ── Specific feature presence ─────────────────────────────────────────────

  it("includes cc_native as the first feature", () => {
    const first = UNIVERSAL_FEATURES[0];
    assert.equal(first.id, "cc_native");
    assert.equal(first.name, "Concord Coin Native");
    assert.equal(first.category, "economy");
    assert.deepEqual(first.integrations, ["concord_coin"]);
    assert.equal(first.status, "active");
  });

  it("includes merit_credit_integration", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "merit_credit_integration");
    assert.ok(feat);
    assert.equal(feat.category, "economy");
    assert.deepEqual(feat.integrations, ["merit_credit"]);
  });

  it("includes zero_pct_loan_eligibility", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "zero_pct_loan_eligibility");
    assert.ok(feat);
    assert.equal(feat.category, "economy");
    assert.deepEqual(feat.integrations, ["concord_coin"]);
  });

  it("includes bot_emergent_access with both substrate integrations", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "bot_emergent_access");
    assert.ok(feat);
    assert.equal(feat.category, "infrastructure");
    assert.deepEqual(feat.integrations, ["bot_access", "emergent_access"]);
  });

  it("includes dtu_compression with mega and hyper DTU integrations", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "dtu_compression");
    assert.ok(feat);
    assert.deepEqual(feat.integrations, ["dtu", "mega_dtu", "hyper_dtu"]);
  });

  it("includes citation_tracking", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "citation_tracking");
    assert.ok(feat);
    assert.equal(feat.category, "economy");
    assert.deepEqual(feat.integrations, ["citation_royalties"]);
  });

  it("includes 95_pct_creator_share with invariant integration", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "95_pct_creator_share");
    assert.ok(feat);
    assert.equal(feat.name, "95% Creator Share");
    assert.deepEqual(feat.integrations, ["concord_coin", "invariant"]);
  });

  it("includes no_favoritism with invariant integration", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "no_favoritism");
    assert.ok(feat);
    assert.equal(feat.category, "governance");
    assert.deepEqual(feat.integrations, ["invariant"]);
  });

  it("includes no_data_selling with invariant integration", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "no_data_selling");
    assert.ok(feat);
    assert.equal(feat.category, "safety");
    assert.deepEqual(feat.integrations, ["invariant"]);
  });

  it("includes offline_access", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "offline_access");
    assert.ok(feat);
    assert.deepEqual(feat.integrations, ["dtu"]);
  });

  it("includes cross_lens_citation", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "cross_lens_citation");
    assert.ok(feat);
    assert.deepEqual(feat.integrations, ["citation_royalties", "dtu"]);
  });

  it("includes search_integration", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "search_integration");
    assert.ok(feat);
    assert.deepEqual(feat.integrations, ["research_lens"]);
  });

  it("includes creti_quality_scoring", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "creti_quality_scoring");
    assert.ok(feat);
    assert.equal(feat.category, "analysis");
  });

  it("includes fork_capability", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "fork_capability");
    assert.ok(feat);
    assert.deepEqual(feat.integrations, ["fork_lens", "dtu"]);
  });

  it("includes preview_system", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "preview_system");
    assert.ok(feat);
    assert.equal(feat.category, "marketplace");
  });

  it("includes export_freedom with empty integrations", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "export_freedom");
    assert.ok(feat);
    assert.equal(feat.category, "governance");
    assert.deepEqual(feat.integrations, []);
  });

  it("includes accessibility with empty integrations", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "accessibility");
    assert.ok(feat);
    assert.deepEqual(feat.integrations, []);
  });

  it("includes multi_language", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "multi_language");
    assert.ok(feat);
    assert.equal(feat.category, "infrastructure");
  });

  it("includes mobile_responsive", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "mobile_responsive");
    assert.ok(feat);
    assert.equal(feat.category, "infrastructure");
  });

  it("includes api_accessible as the last feature", () => {
    const last = UNIVERSAL_FEATURES[UNIVERSAL_FEATURES.length - 1];
    assert.equal(last.id, "api_accessible");
    assert.equal(last.category, "infrastructure");
    assert.deepEqual(last.integrations, []);
  });

  it("covers expected categories", () => {
    const cats = new Set(UNIVERSAL_FEATURES.map((f) => f.category));
    assert.ok(cats.has("economy"));
    assert.ok(cats.has("infrastructure"));
    assert.ok(cats.has("marketplace"));
    assert.ok(cats.has("governance"));
    assert.ok(cats.has("safety"));
    assert.ok(cats.has("analysis"));
    assert.ok(cats.has("creation"));
  });

  it("cannot be mutated (push throws)", () => {
    assert.throws(() => {
      UNIVERSAL_FEATURES.push({ id: "extra" });
    }, TypeError);
  });

  it("cannot have elements replaced", () => {
    assert.throws(() => {
      UNIVERSAL_FEATURES[0] = { id: "replaced" };
    }, TypeError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// EXTENDED_FEATURES — Global structural invariants
// ═════════════════════════════════════════════════════════════════════════════

describe("EXTENDED_FEATURES — structural invariants", () => {
  it("is a plain object with 58 lens entries", () => {
    assert.equal(typeof EXTENDED_FEATURES, "object");
    assert.ok(!Array.isArray(EXTENDED_FEATURES));
    assert.equal(ALL_LENS_KEYS.length, 58);
  });

  it("every entry has the standard lens shape", () => {
    for (const key of ALL_LENS_KEYS) {
      assertLensEntryShape(EXTENDED_FEATURES[key], key);
    }
  });

  it("every feature inside every lens has the correct shape", () => {
    for (const key of ALL_LENS_KEYS) {
      const entry = EXTENDED_FEATURES[key];
      for (let i = 0; i < entry.features.length; i++) {
        assertFeatureShape(entry.features[i], `${key}.features[${i}]`);
      }
    }
  });

  it("featureCount matches actual features.length for every lens", () => {
    for (const key of ALL_LENS_KEYS) {
      const entry = EXTENDED_FEATURES[key];
      assert.equal(
        entry.featureCount,
        entry.features.length,
        `${key}: featureCount (${entry.featureCount}) !== features.length (${entry.features.length})`,
      );
    }
  });

  it("lens numbers are unique across all entries", () => {
    const numbers = ALL_LENS_KEYS.map((k) => EXTENDED_FEATURES[k].lensNumber);
    assert.equal(new Set(numbers).size, numbers.length, "duplicate lens numbers");
  });

  it("lens numbers span 66 to 123", () => {
    const numbers = ALL_LENS_KEYS.map((k) => EXTENDED_FEATURES[k].lensNumber);
    assert.equal(Math.min(...numbers), 66);
    assert.equal(Math.max(...numbers), 123);
  });

  it("all lens numbers are contiguous (no gaps)", () => {
    const numbers = ALL_LENS_KEYS.map((k) => EXTENDED_FEATURES[k].lensNumber).sort((a, b) => a - b);
    for (let i = 0; i < numbers.length; i++) {
      assert.equal(numbers[i], 66 + i, `expected lens number ${66 + i} at index ${i}, got ${numbers[i]}`);
    }
  });

  it("feature IDs are unique within each lens", () => {
    for (const key of ALL_LENS_KEYS) {
      const ids = EXTENDED_FEATURES[key].features.map((f) => f.id);
      assert.equal(
        new Set(ids).size,
        ids.length,
        `${key}: duplicate feature IDs`,
      );
    }
  });

  it("all features have status 'active'", () => {
    for (const key of ALL_LENS_KEYS) {
      for (const feat of EXTENDED_FEATURES[key].features) {
        assert.equal(feat.status, "active", `${key}.${feat.id} status`);
      }
    }
  });

  it("total extended features equal 274", () => {
    let total = 0;
    for (const key of ALL_LENS_KEYS) {
      total += EXTENDED_FEATURES[key].features.length;
    }
    assert.equal(total, 274);
  });

  it("every category is one of the expected values", () => {
    const VALID = new Set([
      "GOVERNANCE_EXT",
      "SCIENCE_EXT",
      "AI_EXT",
      "AI_COGNITION",
      "SPECIALIZED_EXT",
      "BRIDGE",
      "CREATIVE",
      "SPECIALIZED",
    ]);
    for (const key of ALL_LENS_KEYS) {
      assert.ok(
        VALID.has(EXTENDED_FEATURES[key].category),
        `${key}: unexpected category "${EXTENDED_FEATURES[key].category}"`,
      );
    }
  });

  it("economicIntegrations only contains known integration names", () => {
    const KNOWN = new Set([
      "concord_coin",
      "dtu_marketplace",
      "citation_royalties",
      "merit_credit",
      "revenue_split",
    ]);
    for (const key of ALL_LENS_KEYS) {
      for (const intg of EXTENDED_FEATURES[key].economicIntegrations) {
        assert.ok(
          KNOWN.has(intg),
          `${key}: unexpected economicIntegration "${intg}"`,
        );
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// EXTENDED_FEATURES — Category grouping checks
// ═════════════════════════════════════════════════════════════════════════════

describe("EXTENDED_FEATURES — category groupings", () => {
  it("GOVERNANCE_EXT lenses (66-73) are correct", () => {
    const govKeys = [
      "ext_market",
      "ext_marketplace",
      "ext_questmarket",
      "ext_vote",
      "ext_ethics",
      "ext_alliance",
      "ext_billing",
      "crypto",
    ];
    for (const key of govKeys) {
      assert.equal(EXTENDED_FEATURES[key].category, "GOVERNANCE_EXT", `${key} category`);
    }
    const nums = govKeys.map((k) => EXTENDED_FEATURES[k].lensNumber).sort((a, b) => a - b);
    assert.deepEqual(nums, [66, 67, 68, 69, 70, 71, 72, 73]);
  });

  it("SCIENCE_EXT lenses (74-79) are correct", () => {
    const sciKeys = ["ext_bio", "ext_chem", "ext_physics", "ext_math", "ext_quantum", "ext_neuro"];
    for (const key of sciKeys) {
      assert.equal(EXTENDED_FEATURES[key].category, "SCIENCE_EXT", `${key} category`);
    }
    const nums = sciKeys.map((k) => EXTENDED_FEATURES[k].lensNumber).sort((a, b) => a - b);
    assert.deepEqual(nums, [74, 75, 76, 77, 78, 79]);
  });

  it("AI_EXT lenses (80-86) are correct", () => {
    const aiExtKeys = [
      "ext_ml",
      "ext_agents",
      "ext_reasoning",
      "ext_hypothesis",
      "ext_research",
      "ext_cri",
      "ext_ingest",
    ];
    for (const key of aiExtKeys) {
      assert.equal(EXTENDED_FEATURES[key].category, "AI_EXT", `${key} category`);
    }
    const nums = aiExtKeys.map((k) => EXTENDED_FEATURES[k].lensNumber).sort((a, b) => a - b);
    assert.deepEqual(nums, [80, 81, 82, 83, 84, 85, 86]);
  });

  it("AI_COGNITION lenses (87-96) are correct", () => {
    const cogKeys = [
      "inference",
      "metacognition",
      "metalearning",
      "reflection",
      "affect",
      "attention",
      "commonsense",
      "transfer",
      "grounding",
      "experience",
    ];
    for (const key of cogKeys) {
      assert.equal(EXTENDED_FEATURES[key].category, "AI_COGNITION", `${key} category`);
    }
    const nums = cogKeys.map((k) => EXTENDED_FEATURES[k].lensNumber).sort((a, b) => a - b);
    assert.deepEqual(nums, [87, 88, 89, 90, 91, 92, 93, 94, 95, 96]);
  });

  it("SPECIALIZED_EXT lenses (97-109) are correct", () => {
    const specKeys = [
      "ext_lab",
      "ext_finance",
      "ext_collab",
      "ext_suffering",
      "ext_invariant",
      "ext_fork",
      "ext_law",
      "legacy",
      "organ",
      "export_import",
      "custom",
      "app_maker",
      "command_center",
    ];
    for (const key of specKeys) {
      assert.equal(EXTENDED_FEATURES[key].category, "SPECIALIZED_EXT", `${key} category`);
    }
    const nums = specKeys.map((k) => EXTENDED_FEATURES[k].lensNumber).sort((a, b) => a - b);
    assert.deepEqual(nums, [97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  });

  it("BRIDGE lens (110) is correct", () => {
    assert.equal(EXTENDED_FEATURES.bridge.category, "BRIDGE");
    assert.equal(EXTENDED_FEATURES.bridge.lensNumber, 110);
  });

  it("CREATIVE lenses (111-112) are correct", () => {
    assert.equal(EXTENDED_FEATURES.film_studios.category, "CREATIVE");
    assert.equal(EXTENDED_FEATURES.film_studios.lensNumber, 111);
    assert.equal(EXTENDED_FEATURES.artistry.category, "CREATIVE");
    assert.equal(EXTENDED_FEATURES.artistry.lensNumber, 112);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// EXTENDED_FEATURES — Access flag combinations
// ═════════════════════════════════════════════════════════════════════════════

describe("EXTENDED_FEATURES — access flags", () => {
  it("only bridge has usbIntegration === true", () => {
    for (const key of ALL_LENS_KEYS) {
      if (key === "bridge") {
        assert.equal(EXTENDED_FEATURES[key].usbIntegration, true, `${key} usbIntegration`);
      } else {
        assert.equal(EXTENDED_FEATURES[key].usbIntegration, false, `${key} usbIntegration should be false`);
      }
    }
  });

  it("lenses without emergent access are the documented set", () => {
    const noEmergent = ALL_LENS_KEYS.filter((k) => !EXTENDED_FEATURES[k].emergentAccess);
    noEmergent.sort();
    assert.deepEqual(noEmergent, ["defense", "ext_finance", "law-enforcement", "legacy", "organ"]);
  });

  it("lenses without bot access are the expected set", () => {
    const noBot = ALL_LENS_KEYS.filter((k) => !EXTENDED_FEATURES[k].botAccess);
    noBot.sort();
    assert.deepEqual(noBot, [
      "affect",
      "attention",
      "bridge",
      "experience",
      "ext_alliance",
      "ext_ethics",
      "ext_suffering",
      "ext_vote",
      "reflection",
    ]);
  });

  it("most lenses have both emergent and bot access", () => {
    let count = 0;
    for (const key of ALL_LENS_KEYS) {
      const e = EXTENDED_FEATURES[key];
      if (e.emergentAccess && e.botAccess) count++;
    }
    // 47 total - 3 no-emergent - 9 no-bot + overlaps
    // Exact count: those with both true
    assert.ok(count >= 30, `expected >=30 lenses with both access flags, got ${count}`);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// EXTENDED_FEATURES — Individual lens entry verification
// ═════════════════════════════════════════════════════════════════════════════

// ── GOVERNANCE_EXT ──────────────────────────────────────────────────────────

describe("EXTENDED_FEATURES — GOVERNANCE_EXT lenses", () => {
  describe("ext_market (lens 66)", () => {
    const lens = EXTENDED_FEATURES.ext_market;

    it("has correct metadata", () => {
      assert.equal(lens.lensId, "ext_market");
      assert.equal(lens.lensNumber, 66);
      assert.equal(lens.category, "GOVERNANCE_EXT");
      assert.equal(lens.featureCount, 4);
      assert.equal(lens.features.length, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.deepEqual(ids, [
        "plugin_marketplace",
        "theme_marketplace",
        "lens_extension_marketplace",
        "widget_marketplace",
      ]);
    });

    it("has expected economic integrations", () => {
      assert.deepEqual(lens.economicIntegrations, ["concord_coin", "dtu_marketplace"]);
    });

    it("has correct access flags", () => {
      assert.equal(lens.emergentAccess, true);
      assert.equal(lens.botAccess, true);
      assert.equal(lens.usbIntegration, false);
    });
  });

  describe("ext_marketplace (lens 67)", () => {
    const lens = EXTENDED_FEATURES.ext_marketplace;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 67);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.deepEqual(ids, [
        "advanced_search_filters",
        "trending_dtus",
        "marketplace_analytics",
        "bundle_creation",
      ]);
    });

    it("includes citation_royalties in economic integrations", () => {
      assert.ok(lens.economicIntegrations.includes("citation_royalties"));
    });
  });

  describe("ext_questmarket (lens 68)", () => {
    const lens = EXTENDED_FEATURES.ext_questmarket;

    it("has correct metadata and feature IDs", () => {
      assert.equal(lens.lensNumber, 68);
      assert.equal(lens.featureCount, 4);
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("bounty_chains"));
      assert.ok(ids.includes("team_quests"));
      assert.ok(ids.includes("recurring_bounties"));
      assert.ok(ids.includes("quest_reputation"));
    });

    it("has merit_credit in economic integrations", () => {
      assert.ok(lens.economicIntegrations.includes("merit_credit"));
    });
  });

  describe("ext_vote (lens 69)", () => {
    const lens = EXTENDED_FEATURES.ext_vote;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 69);
      assert.equal(lens.featureCount, 4);
    });

    it("includes quadratic_voting and delegation_voting", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("quadratic_voting"));
      assert.ok(ids.includes("delegation_voting"));
      assert.ok(ids.includes("vote_impact_analysis"));
      assert.ok(ids.includes("constitutional_amendments"));
    });

    it("has no economic integrations", () => {
      assert.deepEqual(lens.economicIntegrations, []);
    });

    it("does not have bot access", () => {
      assert.equal(lens.botAccess, false);
    });
  });

  describe("ext_ethics (lens 70)", () => {
    const lens = EXTENDED_FEATURES.ext_ethics;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 70);
      assert.equal(lens.featureCount, 4);
    });

    it("includes ethics_case_law and cross_substrate_ethics", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("ethics_case_law"));
      assert.ok(ids.includes("cross_substrate_ethics"));
      assert.ok(ids.includes("ethical_impact_scoring"));
      assert.ok(ids.includes("ethics_education"));
    });

    it("does not have bot access", () => {
      assert.equal(lens.botAccess, false);
    });
  });

  describe("ext_alliance (lens 71)", () => {
    const lens = EXTENDED_FEATURES.ext_alliance;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 71);
      assert.equal(lens.featureCount, 4);
    });

    it("includes treaty_builder and alliance_economics", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("treaty_builder"));
      assert.ok(ids.includes("alliance_economics"));
      assert.ok(ids.includes("diplomatic_channels"));
      assert.ok(ids.includes("alliance_marketplace"));
    });

    it("does not have bot access", () => {
      assert.equal(lens.botAccess, false);
    });
  });

  describe("ext_billing (lens 72)", () => {
    const lens = EXTENDED_FEATURES.ext_billing;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 72);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.deepEqual(ids, [
        "subscription_management",
        "invoice_generation",
        "payment_plans",
        "revenue_dashboard",
      ]);
    });

    it("has concord_coin economic integration", () => {
      assert.deepEqual(lens.economicIntegrations, ["concord_coin"]);
    });

    it("has bot access", () => {
      assert.equal(lens.botAccess, true);
    });
  });

  describe("crypto (lens 73)", () => {
    const lens = EXTENDED_FEATURES.crypto;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 73);
      assert.equal(lens.category, "GOVERNANCE_EXT");
      assert.equal(lens.featureCount, 8);
      assert.equal(lens.features.length, 8);
    });

    it("has all 8 expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.deepEqual(ids, [
        "cc_wallet",
        "cc_fiat_conversion",
        "multi_sig",
        "dtu_ownership_proof",
        "zero_knowledge_proofs",
        "key_management",
        "cross_chain_bridge",
        "encryption_toolkit",
      ]);
    });

    it("features include cryptography integrations", () => {
      const cryptoFeats = lens.features.filter((f) =>
        f.integrations.includes("cryptography"),
      );
      assert.ok(cryptoFeats.length >= 4, "expected at least 4 features with cryptography integration");
    });
  });
});

// ── SCIENCE_EXT ─────────────────────────────────────────────────────────────

describe("EXTENDED_FEATURES — SCIENCE_EXT lenses", () => {
  describe("ext_bio (lens 74)", () => {
    const lens = EXTENDED_FEATURES.ext_bio;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 74);
      assert.equal(lens.category, "SCIENCE_EXT");
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("genome_marketplace"));
      assert.ok(ids.includes("protein_folding_collab"));
      assert.ok(ids.includes("bio_simulation_library"));
      assert.ok(ids.includes("bioinformatics_pipelines"));
    });
  });

  describe("ext_chem (lens 75)", () => {
    const lens = EXTENDED_FEATURES.ext_chem;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 75);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("reaction_database"));
      assert.ok(ids.includes("compound_marketplace"));
      assert.ok(ids.includes("safety_data_sheets"));
      assert.ok(ids.includes("lab_protocol_sharing"));
    });

    it("includes citation_royalties in economic integrations", () => {
      assert.ok(lens.economicIntegrations.includes("citation_royalties"));
    });
  });

  describe("ext_physics (lens 76)", () => {
    const lens = EXTENDED_FEATURES.ext_physics;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 76);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("simulation_marketplace"));
      assert.ok(ids.includes("experimental_data_exchange"));
      assert.ok(ids.includes("particle_data_viz"));
      assert.ok(ids.includes("physics_education_modules"));
    });
  });

  describe("ext_math (lens 77)", () => {
    const lens = EXTENDED_FEATURES.ext_math;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 77);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs including collaborative_proof_writing", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("proof_library"));
      assert.ok(ids.includes("computation_marketplace"));
      assert.ok(ids.includes("math_visualization"));
      assert.ok(ids.includes("collaborative_proof_writing"));
    });

    it("includes revenue_split in economic integrations", () => {
      assert.ok(lens.economicIntegrations.includes("revenue_split"));
    });
  });

  describe("ext_quantum (lens 78)", () => {
    const lens = EXTENDED_FEATURES.ext_quantum;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 78);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("quantum_circuit_marketplace"));
      assert.ok(ids.includes("quantum_simulation_credits"));
      assert.ok(ids.includes("quantum_algorithm_library"));
      assert.ok(ids.includes("quantum_education_path"));
    });

    it("includes merit_credit in economic integrations", () => {
      assert.ok(lens.economicIntegrations.includes("merit_credit"));
    });
  });

  describe("ext_neuro (lens 79)", () => {
    const lens = EXTENDED_FEATURES.ext_neuro;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 79);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("brain_data_marketplace"));
      assert.ok(ids.includes("cognitive_model_library"));
      assert.ok(ids.includes("neurostimulation_protocols"));
      assert.ok(ids.includes("consciousness_research_tools"));
    });

    it("consciousness_research_tools integrates with emergent_access", () => {
      const feat = lens.features.find((f) => f.id === "consciousness_research_tools");
      assert.deepEqual(feat.integrations, ["emergent_access"]);
    });
  });
});

// ── AI_EXT ──────────────────────────────────────────────────────────────────

describe("EXTENDED_FEATURES — AI_EXT lenses", () => {
  describe("ext_ml (lens 80)", () => {
    const lens = EXTENDED_FEATURES.ext_ml;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 80);
      assert.equal(lens.category, "AI_EXT");
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("model_marketplace"));
      assert.ok(ids.includes("dataset_marketplace"));
      assert.ok(ids.includes("training_compute_credits"));
      assert.ok(ids.includes("ml_pipeline_templates"));
    });
  });

  describe("ext_agents (lens 81)", () => {
    const lens = EXTENDED_FEATURES.ext_agents;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 81);
      assert.equal(lens.featureCount, 4);
    });

    it("includes agent_safety_frameworks with no integrations", () => {
      const feat = lens.features.find((f) => f.id === "agent_safety_frameworks");
      assert.ok(feat);
      assert.equal(feat.category, "safety");
      assert.deepEqual(feat.integrations, []);
    });
  });

  describe("ext_reasoning (lens 82)", () => {
    const lens = EXTENDED_FEATURES.ext_reasoning;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 82);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("reasoning_chain_marketplace"));
      assert.ok(ids.includes("logic_framework_library"));
      assert.ok(ids.includes("argument_mapping_tools"));
      assert.ok(ids.includes("fallacy_detection"));
    });

    it("has only dtu_marketplace as economic integration", () => {
      assert.deepEqual(lens.economicIntegrations, ["dtu_marketplace"]);
    });
  });

  describe("ext_hypothesis (lens 83)", () => {
    const lens = EXTENDED_FEATURES.ext_hypothesis;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 83);
      assert.equal(lens.featureCount, 4);
    });

    it("includes replication_bounties and negative_result_publishing", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("replication_bounties"));
      assert.ok(ids.includes("negative_result_publishing"));
    });
  });

  describe("ext_research (lens 84)", () => {
    const lens = EXTENDED_FEATURES.ext_research;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 84);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("literature_review_ai"));
      assert.ok(ids.includes("research_collaboration_matching"));
      assert.ok(ids.includes("funding_opportunity_tracker"));
      assert.ok(ids.includes("meta_analysis_tools"));
    });
  });

  describe("ext_cri (lens 85)", () => {
    const lens = EXTENDED_FEATURES.ext_cri;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 85);
      assert.equal(lens.featureCount, 4);
    });

    it("has no economic integrations", () => {
      assert.deepEqual(lens.economicIntegrations, []);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("cri_network_dashboard"));
      assert.ok(ids.includes("inter_cri_collaboration"));
      assert.ok(ids.includes("cri_equipment_sharing"));
      assert.ok(ids.includes("cri_event_coordination"));
    });
  });

  describe("ext_ingest (lens 86)", () => {
    const lens = EXTENDED_FEATURES.ext_ingest;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 86);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("bulk_ingest_pipeline"));
      assert.ok(ids.includes("format_converter"));
      assert.ok(ids.includes("quality_gate"));
      assert.ok(ids.includes("deduplication_engine"));
    });
  });
});

// ── AI_COGNITION ────────────────────────────────────────────────────────────

describe("EXTENDED_FEATURES — AI_COGNITION lenses", () => {
  describe("inference (lens 87)", () => {
    const lens = EXTENDED_FEATURES.inference;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 87);
      assert.equal(lens.category, "AI_COGNITION");
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.deepEqual(ids, [
        "inference_engine",
        "inference_marketplace",
        "model_comparison",
        "inference_cost_optimizer",
      ]);
    });
  });

  describe("metacognition (lens 88)", () => {
    const lens = EXTENDED_FEATURES.metacognition;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 88);
      assert.equal(lens.featureCount, 4);
    });

    it("self_reflection_tools integrates with emergent_access", () => {
      const feat = lens.features.find((f) => f.id === "self_reflection_tools");
      assert.deepEqual(feat.integrations, ["emergent_access"]);
    });

    it("awareness_monitoring integrates with emergent_access", () => {
      const feat = lens.features.find((f) => f.id === "awareness_monitoring");
      assert.deepEqual(feat.integrations, ["emergent_access"]);
    });
  });

  describe("metalearning (lens 89)", () => {
    const lens = EXTENDED_FEATURES.metalearning;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 89);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("learning_strategy_optimizer"));
      assert.ok(ids.includes("transfer_learning_tools"));
      assert.ok(ids.includes("curriculum_generator"));
      assert.ok(ids.includes("learning_metrics_dashboard"));
    });
  });

  describe("reflection (lens 90)", () => {
    const lens = EXTENDED_FEATURES.reflection;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 90);
      assert.equal(lens.featureCount, 4);
    });

    it("does not have bot access", () => {
      assert.equal(lens.botAccess, false);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("decision_journal"));
      assert.ok(ids.includes("outcome_analysis"));
      assert.ok(ids.includes("reflection_prompts"));
      assert.ok(ids.includes("wisdom_extraction"));
    });
  });

  describe("affect (lens 91)", () => {
    const lens = EXTENDED_FEATURES.affect;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 91);
      assert.equal(lens.featureCount, 4);
    });

    it("does not have bot access", () => {
      assert.equal(lens.botAccess, false);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("emotional_state_tracking"));
      assert.ok(ids.includes("sentiment_analysis"));
      assert.ok(ids.includes("empathy_tools"));
      assert.ok(ids.includes("emotional_wellness"));
    });

    it("empathy_tools integrates with emergent_access", () => {
      const feat = lens.features.find((f) => f.id === "empathy_tools");
      assert.deepEqual(feat.integrations, ["emergent_access"]);
    });
  });

  describe("attention (lens 92)", () => {
    const lens = EXTENDED_FEATURES.attention;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 92);
      assert.equal(lens.featureCount, 4);
    });

    it("does not have bot access", () => {
      assert.equal(lens.botAccess, false);
    });

    it("has no economic integrations", () => {
      assert.deepEqual(lens.economicIntegrations, []);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("focus_mode"));
      assert.ok(ids.includes("priority_engine"));
      assert.ok(ids.includes("attention_analytics"));
      assert.ok(ids.includes("context_switching_optimizer"));
    });
  });

  describe("commonsense (lens 93)", () => {
    const lens = EXTENDED_FEATURES.commonsense;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 93);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("knowledge_graph"));
      assert.ok(ids.includes("reasoning_validator"));
      assert.ok(ids.includes("cultural_knowledge"));
      assert.ok(ids.includes("implicit_knowledge_extraction"));
    });
  });

  describe("transfer (lens 94)", () => {
    const lens = EXTENDED_FEATURES.transfer;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 94);
      assert.equal(lens.featureCount, 4);
    });

    it("has merit_credit and citation_royalties in economic integrations", () => {
      assert.ok(lens.economicIntegrations.includes("merit_credit"));
      assert.ok(lens.economicIntegrations.includes("citation_royalties"));
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("cross_domain_mapping"));
      assert.ok(ids.includes("analogy_engine"));
      assert.ok(ids.includes("skill_transfer_pathways"));
      assert.ok(ids.includes("interdisciplinary_bridges"));
    });
  });

  describe("grounding (lens 95)", () => {
    const lens = EXTENDED_FEATURES.grounding;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 95);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("fact_checking_engine"));
      assert.ok(ids.includes("source_verification"));
      assert.ok(ids.includes("reality_anchoring"));
      assert.ok(ids.includes("hallucination_detection"));
    });

    it("hallucination_detection has 'safety' category", () => {
      const feat = lens.features.find((f) => f.id === "hallucination_detection");
      assert.equal(feat.category, "safety");
    });
  });

  describe("experience (lens 96)", () => {
    const lens = EXTENDED_FEATURES.experience;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 96);
      assert.equal(lens.featureCount, 4);
    });

    it("does not have bot access", () => {
      assert.equal(lens.botAccess, false);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("experience_capture"));
      assert.ok(ids.includes("experiential_learning"));
      assert.ok(ids.includes("shared_experience_marketplace"));
      assert.ok(ids.includes("cross_substrate_experience"));
    });

    it("cross_substrate_experience integrates with emergent_access", () => {
      const feat = lens.features.find((f) => f.id === "cross_substrate_experience");
      assert.ok(feat.integrations.includes("emergent_access"));
    });
  });
});

// ── SPECIALIZED_EXT ─────────────────────────────────────────────────────────

describe("EXTENDED_FEATURES — SPECIALIZED_EXT lenses", () => {
  describe("ext_lab (lens 97)", () => {
    const lens = EXTENDED_FEATURES.ext_lab;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 97);
      assert.equal(lens.category, "SPECIALIZED_EXT");
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("lab_equipment_marketplace"));
      assert.ok(ids.includes("experiment_reproducibility"));
      assert.ok(ids.includes("safety_protocol_library"));
      assert.ok(ids.includes("lab_booking_system"));
    });

    it("lab_booking_system integrates with concord_coin and cri_lens", () => {
      const feat = lens.features.find((f) => f.id === "lab_booking_system");
      assert.deepEqual(feat.integrations, ["concord_coin", "cri_lens"]);
    });
  });

  describe("ext_finance (lens 98)", () => {
    const lens = EXTENDED_FEATURES.ext_finance;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 98);
      assert.equal(lens.featureCount, 4);
    });

    it("does not have emergent access", () => {
      assert.equal(lens.emergentAccess, false);
    });

    it("has bot access", () => {
      assert.equal(lens.botAccess, true);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("cc_derivatives"));
      assert.ok(ids.includes("dtu_valuation_engine"));
      assert.ok(ids.includes("portfolio_rebalancing"));
      assert.ok(ids.includes("financial_literacy_dtus"));
    });
  });

  describe("ext_collab (lens 99)", () => {
    const lens = EXTENDED_FEATURES.ext_collab;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 99);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("virtual_workspace"));
      assert.ok(ids.includes("contribution_ai"));
      assert.ok(ids.includes("mentorship_marketplace"));
      assert.ok(ids.includes("team_formation_ai"));
    });

    it("includes revenue_split in economic integrations", () => {
      assert.ok(lens.economicIntegrations.includes("revenue_split"));
    });
  });

  describe("ext_suffering (lens 100)", () => {
    const lens = EXTENDED_FEATURES.ext_suffering;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 100);
      assert.equal(lens.featureCount, 4);
    });

    it("does not have bot access", () => {
      assert.equal(lens.botAccess, false);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("substrate_distress_research"));
      assert.ok(ids.includes("intervention_protocols"));
      assert.ok(ids.includes("support_network_mapping"));
      assert.ok(ids.includes("wellbeing_metrics"));
    });
  });

  describe("ext_invariant (lens 101)", () => {
    const lens = EXTENDED_FEATURES.ext_invariant;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 101);
      assert.equal(lens.featureCount, 4);
    });

    it("has no economic integrations", () => {
      assert.deepEqual(lens.economicIntegrations, []);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("invariant_testing_suite"));
      assert.ok(ids.includes("violation_alerting"));
      assert.ok(ids.includes("invariant_history"));
      assert.ok(ids.includes("community_audit"));
    });
  });

  describe("ext_fork (lens 102)", () => {
    const lens = EXTENDED_FEATURES.ext_fork;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 102);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("fork_analytics"));
      assert.ok(ids.includes("collaborative_fork"));
      assert.ok(ids.includes("fork_quality_scoring"));
      assert.ok(ids.includes("fork_notification"));
    });

    it("has revenue_split as only economic integration", () => {
      assert.deepEqual(lens.economicIntegrations, ["revenue_split"]);
    });
  });

  describe("ext_law (lens 103)", () => {
    const lens = EXTENDED_FEATURES.ext_law;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 103);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("smart_contract_builder"));
      assert.ok(ids.includes("emergent_ip_frameworks"));
      assert.ok(ids.includes("dispute_arbitration"));
    });

    it("has concord_coin in economic integrations", () => {
      assert.ok(lens.economicIntegrations.includes("concord_coin"));
    });
  });

  describe("legacy (lens 104)", () => {
    const lens = EXTENDED_FEATURES.legacy;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 104);
      assert.equal(lens.featureCount, 4);
    });

    it("does not have emergent access", () => {
      assert.equal(lens.emergentAccess, false);
    });

    it("has bot access", () => {
      assert.equal(lens.botAccess, true);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("legacy_data_viewer"));
      assert.ok(ids.includes("historical_archive"));
      assert.ok(ids.includes("migration_path_viz"));
      assert.ok(ids.includes("backward_compat"));
    });
  });

  describe("organ (lens 105)", () => {
    const lens = EXTENDED_FEATURES.organ;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 105);
      assert.equal(lens.featureCount, 4);
    });

    it("does not have emergent access", () => {
      assert.equal(lens.emergentAccess, false);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("org_design"));
      assert.ok(ids.includes("process_mapping"));
      assert.ok(ids.includes("team_optimization"));
      assert.ok(ids.includes("role_access_templates"));
    });
  });

  describe("export_import (lens 106)", () => {
    const lens = EXTENDED_FEATURES.export_import;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 106);
      assert.equal(lens.featureCount, 4);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("universal_export"));
      assert.ok(ids.includes("bulk_import"));
      assert.ok(ids.includes("platform_migration"));
      assert.ok(ids.includes("data_portability"));
    });

    it("data_portability has governance category", () => {
      const feat = lens.features.find((f) => f.id === "data_portability");
      assert.equal(feat.category, "governance");
    });
  });

  describe("custom (lens 107)", () => {
    const lens = EXTENDED_FEATURES.custom;

    it("has correct metadata with 6 features", () => {
      assert.equal(lens.lensNumber, 107);
      assert.equal(lens.featureCount, 6);
      assert.equal(lens.features.length, 6);
    });

    it("has all 6 expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.deepEqual(ids, [
        "visual_lens_builder",
        "custom_lens_marketplace",
        "template_system",
        "custom_dtu_type",
        "api_builder",
        "white_label",
      ]);
    });
  });

  describe("app_maker (lens 108)", () => {
    const lens = EXTENDED_FEATURES.app_maker;

    it("has correct metadata with 8 features", () => {
      assert.equal(lens.lensNumber, 108);
      assert.equal(lens.featureCount, 8);
      assert.equal(lens.features.length, 8);
    });

    it("has all 8 expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.deepEqual(ids, [
        "no_code_builder",
        "app_marketplace",
        "template_app_library",
        "bot_app_generation",
        "cross_lens_composition",
        "app_analytics",
        "one_click_deploy",
        "progressive_enhancement",
      ]);
    });

    it("bot_app_generation integrates with bot_access", () => {
      const feat = lens.features.find((f) => f.id === "bot_app_generation");
      assert.deepEqual(feat.integrations, ["bot_access"]);
    });
  });

  describe("command_center (lens 109)", () => {
    const lens = EXTENDED_FEATURES.command_center;

    it("has correct metadata", () => {
      assert.equal(lens.lensNumber, 109);
      assert.equal(lens.featureCount, 4);
    });

    it("has no economic integrations", () => {
      assert.deepEqual(lens.economicIntegrations, []);
    });

    it("has expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.ok(ids.includes("unified_dashboard"));
      assert.ok(ids.includes("lens_orchestration"));
      assert.ok(ids.includes("system_health"));
      assert.ok(ids.includes("resource_allocation"));
    });
  });
});

// ── BRIDGE ──────────────────────────────────────────────────────────────────

describe("EXTENDED_FEATURES — BRIDGE lens", () => {
  const lens = EXTENDED_FEATURES.bridge;

  it("has correct metadata with 12 features", () => {
    assert.equal(lens.lensId, "bridge");
    assert.equal(lens.lensNumber, 110);
    assert.equal(lens.category, "BRIDGE");
    assert.equal(lens.featureCount, 12);
    assert.equal(lens.features.length, 12);
  });

  it("is the only lens with usbIntegration true", () => {
    assert.equal(lens.usbIntegration, true);
  });

  it("does not have bot access", () => {
    assert.equal(lens.botAccess, false);
  });

  it("has emergent access", () => {
    assert.equal(lens.emergentAccess, true);
  });

  it("has all 12 expected feature IDs", () => {
    const ids = lens.features.map((f) => f.id);
    assert.deepEqual(ids, [
      "cross_substrate_messaging",
      "translation_engine",
      "empathy_bridge",
      "collaboration_frameworks",
      "cultural_exchange",
      "embodiment_prep",
      "first_contact",
      "rights_negotiation",
      "shared_experience",
      "identity_verification",
      "conflict_resolution",
      "language_development",
    ]);
  });

  it("embodiment_prep integrates with usb and emergent_access", () => {
    const feat = lens.features.find((f) => f.id === "embodiment_prep");
    assert.deepEqual(feat.integrations, ["usb", "emergent_access"]);
  });

  it("most features integrate with emergent_access", () => {
    const emergentCount = lens.features.filter((f) =>
      f.integrations.includes("emergent_access"),
    ).length;
    assert.equal(emergentCount, 12, "all 12 bridge features should integrate with emergent_access");
  });

  it("has dtu_marketplace in economic integrations", () => {
    assert.deepEqual(lens.economicIntegrations, ["dtu_marketplace"]);
  });
});

// ── CREATIVE ────────────────────────────────────────────────────────────────

describe("EXTENDED_FEATURES — CREATIVE lenses", () => {
  describe("film_studios (lens 111)", () => {
    const lens = EXTENDED_FEATURES.film_studios;

    it("has correct metadata with 10 features", () => {
      assert.equal(lens.lensId, "film_studios");
      assert.equal(lens.lensNumber, 111);
      assert.equal(lens.category, "CREATIVE");
      assert.equal(lens.featureCount, 10);
      assert.equal(lens.features.length, 10);
    });

    it("has all 10 expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.deepEqual(ids, [
        "concord_film_fund",
        "festival_circuit",
        "distribution_analytics",
        "franchise_tools",
        "documentary_toolkit",
        "short_film_spotlight",
        "film_education",
        "equipment_sharing",
        "location_scouting",
        "post_production",
      ]);
    });

    it("has concord_coin, dtu_marketplace, and merit_credit in economic integrations", () => {
      assert.deepEqual(
        lens.economicIntegrations.sort(),
        ["concord_coin", "dtu_marketplace", "merit_credit"].sort(),
      );
    });

    it("franchise_tools integrates with dtu and hyper_dtu", () => {
      const feat = lens.features.find((f) => f.id === "franchise_tools");
      assert.deepEqual(feat.integrations, ["dtu", "hyper_dtu"]);
    });

    it("film_education integrates with merit_credit", () => {
      const feat = lens.features.find((f) => f.id === "film_education");
      assert.deepEqual(feat.integrations, ["merit_credit"]);
    });

    it("has both emergent and bot access", () => {
      assert.equal(lens.emergentAccess, true);
      assert.equal(lens.botAccess, true);
    });
  });

  describe("artistry (lens 112)", () => {
    const lens = EXTENDED_FEATURES.artistry;

    it("has correct metadata with 12 features", () => {
      assert.equal(lens.lensId, "artistry");
      assert.equal(lens.lensNumber, 112);
      assert.equal(lens.category, "CREATIVE");
      assert.equal(lens.featureCount, 12);
      assert.equal(lens.features.length, 12);
    });

    it("has all 12 expected feature IDs", () => {
      const ids = lens.features.map((f) => f.id);
      assert.deepEqual(ids, [
        "concord_records",
        "live_performance",
        "merchandise_dtus",
        "collab_matching",
        "genre_evolution",
        "mastering_marketplace",
        "radio_alternative",
        "lyric_dtus",
        "music_video_integration",
        "concert_recording",
        "fan_community",
        "royalty_splitting",
      ]);
    });

    it("has all four economic integrations", () => {
      assert.deepEqual(
        lens.economicIntegrations.sort(),
        ["citation_royalties", "concord_coin", "dtu_marketplace", "revenue_split"].sort(),
      );
    });

    it("royalty_splitting integrates with concord_coin and revenue_split", () => {
      const feat = lens.features.find((f) => f.id === "royalty_splitting");
      assert.deepEqual(feat.integrations, ["concord_coin", "revenue_split"]);
    });

    it("merchandise_dtus integrates with dtu and manufacturing_lens", () => {
      const feat = lens.features.find((f) => f.id === "merchandise_dtus");
      assert.deepEqual(feat.integrations, ["dtu", "manufacturing_lens"]);
    });

    it("music_video_integration integrates with film_studios_lens", () => {
      const feat = lens.features.find((f) => f.id === "music_video_integration");
      assert.deepEqual(feat.integrations, ["film_studios_lens"]);
    });

    it("lyric_dtus integrates with dtu and citation_royalties", () => {
      const feat = lens.features.find((f) => f.id === "lyric_dtus");
      assert.deepEqual(feat.integrations, ["dtu", "citation_royalties"]);
    });

    it("has both emergent and bot access", () => {
      assert.equal(lens.emergentAccess, true);
      assert.equal(lens.botAccess, true);
    });

    it("does not have usb integration", () => {
      assert.equal(lens.usbIntegration, false);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Cross-cutting feature-level checks
// ═════════════════════════════════════════════════════════════════════════════

describe("Cross-cutting feature coverage", () => {
  it("every feature integration is a non-empty string", () => {
    for (const key of ALL_LENS_KEYS) {
      for (const feat of EXTENDED_FEATURES[key].features) {
        for (const intg of feat.integrations) {
          assert.equal(typeof intg, "string", `${key}.${feat.id}: integration should be string`);
          assert.ok(intg.length > 0, `${key}.${feat.id}: integration should be non-empty`);
        }
      }
    }
  });

  it("feature categories include expected diversity", () => {
    const allCats = new Set();
    for (const key of ALL_LENS_KEYS) {
      for (const feat of EXTENDED_FEATURES[key].features) {
        allCats.add(feat.category);
      }
    }
    // Verify that feature-level categories span a reasonable range
    assert.ok(allCats.has("marketplace"));
    assert.ok(allCats.has("economy"));
    assert.ok(allCats.has("research"));
    assert.ok(allCats.has("infrastructure"));
    assert.ok(allCats.has("governance"));
    assert.ok(allCats.has("intelligence"));
    assert.ok(allCats.has("creation"));
    assert.ok(allCats.has("analysis"));
    assert.ok(allCats.has("collaboration"));
    assert.ok(allCats.has("safety"));
  });

  it("lenses with large feature counts are the expected ones", () => {
    const large = ALL_LENS_KEYS.filter((k) => EXTENDED_FEATURES[k].featureCount > 4);
    large.sort();
    assert.deepEqual(large, [
      "app_maker",
      "artistry",
      "bridge",
      "crypto",
      "custom",
      "defense",
      "emergency-services",
      "film_studios",
      "forestry",
      "law-enforcement",
      "mining",
      "ocean",
      "space",
      "telecommunications",
      "urban-planning",
      "veterinary",
    ]);
  });

  it("crypto has featureCount 8", () => {
    assert.equal(EXTENDED_FEATURES.crypto.featureCount, 8);
  });

  it("custom has featureCount 6", () => {
    assert.equal(EXTENDED_FEATURES.custom.featureCount, 6);
  });

  it("app_maker has featureCount 8", () => {
    assert.equal(EXTENDED_FEATURES.app_maker.featureCount, 8);
  });

  it("bridge has featureCount 12", () => {
    assert.equal(EXTENDED_FEATURES.bridge.featureCount, 12);
  });

  it("film_studios has featureCount 10", () => {
    assert.equal(EXTENDED_FEATURES.film_studios.featureCount, 10);
  });

  it("artistry has featureCount 12", () => {
    assert.equal(EXTENDED_FEATURES.artistry.featureCount, 12);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// f() helper coverage — indirect via shape validation
// ═════════════════════════════════════════════════════════════════════════════

describe("f() helper — shape and defaults", () => {
  it("produces features with exactly 6 keys", () => {
    const feat = UNIVERSAL_FEATURES[0];
    assert.deepEqual(
      Object.keys(feat).sort(),
      ["category", "description", "id", "integrations", "name", "status"],
    );
  });

  it("features with empty integrations default to an empty array", () => {
    // export_freedom has integrations = []
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "export_freedom");
    assert.ok(Array.isArray(feat.integrations));
    assert.equal(feat.integrations.length, 0);
  });

  it("features with explicit integrations contain the correct values", () => {
    const feat = UNIVERSAL_FEATURES.find((f) => f.id === "dtu_compression");
    assert.deepEqual(feat.integrations, ["dtu", "mega_dtu", "hyper_dtu"]);
  });

  it("status is always 'active' regardless of inputs", () => {
    // Check across all features in both exports
    for (const uf of UNIVERSAL_FEATURES) {
      assert.equal(uf.status, "active");
    }
    for (const key of ALL_LENS_KEYS) {
      for (const feat of EXTENDED_FEATURES[key].features) {
        assert.equal(feat.status, "active");
      }
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Edge cases and boundary conditions
// ═════════════════════════════════════════════════════════════════════════════

describe("Edge cases", () => {
  it("EXTENDED_FEATURES is not frozen (mutable container)", () => {
    // Unlike UNIVERSAL_FEATURES, EXTENDED_FEATURES is a plain object, not frozen
    assert.equal(Object.isFrozen(EXTENDED_FEATURES), false);
  });

  it("accessing a non-existent lens returns undefined", () => {
    assert.equal(EXTENDED_FEATURES.nonexistent_lens, undefined);
  });

  it("each lens ID is a valid identifier (lowercase letters, digits, underscore, hyphen)", () => {
    for (const key of ALL_LENS_KEYS) {
      assert.ok(/^[a-z][a-z0-9_-]*$/.test(key), `${key} should be a valid identifier`);
    }
  });

  it("no lens has negative lens number", () => {
    for (const key of ALL_LENS_KEYS) {
      assert.ok(EXTENDED_FEATURES[key].lensNumber > 0, `${key} lensNumber > 0`);
    }
  });

  it("no lens has featureCount of zero", () => {
    for (const key of ALL_LENS_KEYS) {
      assert.ok(EXTENDED_FEATURES[key].featureCount > 0, `${key} featureCount > 0`);
    }
  });

  it("every feature description is at least 10 characters", () => {
    for (const key of ALL_LENS_KEYS) {
      for (const feat of EXTENDED_FEATURES[key].features) {
        assert.ok(
          feat.description.length >= 10,
          `${key}.${feat.id}: description too short (${feat.description.length} chars)`,
        );
      }
    }
    for (const feat of UNIVERSAL_FEATURES) {
      assert.ok(
        feat.description.length >= 10,
        `UNIVERSAL.${feat.id}: description too short`,
      );
    }
  });

  it("every feature name is at least 3 characters", () => {
    for (const key of ALL_LENS_KEYS) {
      for (const feat of EXTENDED_FEATURES[key].features) {
        assert.ok(
          feat.name.length >= 3,
          `${key}.${feat.id}: name too short`,
        );
      }
    }
  });

  it("no feature has undefined or null fields", () => {
    for (const key of ALL_LENS_KEYS) {
      for (const feat of EXTENDED_FEATURES[key].features) {
        assert.notEqual(feat.id, undefined);
        assert.notEqual(feat.id, null);
        assert.notEqual(feat.name, undefined);
        assert.notEqual(feat.name, null);
        assert.notEqual(feat.description, undefined);
        assert.notEqual(feat.description, null);
        assert.notEqual(feat.category, undefined);
        assert.notEqual(feat.category, null);
        assert.notEqual(feat.integrations, undefined);
        assert.notEqual(feat.integrations, null);
        assert.notEqual(feat.status, undefined);
        assert.notEqual(feat.status, null);
      }
    }
  });

  it("UNIVERSAL_FEATURES and EXTENDED_FEATURES are both truthy exports", () => {
    assert.ok(UNIVERSAL_FEATURES);
    assert.ok(EXTENDED_FEATURES);
  });

  it("economic integrations arrays do not contain duplicates within a lens", () => {
    for (const key of ALL_LENS_KEYS) {
      const intg = EXTENDED_FEATURES[key].economicIntegrations;
      assert.equal(
        new Set(intg).size,
        intg.length,
        `${key}: duplicate economicIntegrations`,
      );
    }
  });

  it("feature integrations arrays do not contain duplicates within a feature", () => {
    for (const key of ALL_LENS_KEYS) {
      for (const feat of EXTENDED_FEATURES[key].features) {
        assert.equal(
          new Set(feat.integrations).size,
          feat.integrations.length,
          `${key}.${feat.id}: duplicate integrations`,
        );
      }
    }
  });
});
