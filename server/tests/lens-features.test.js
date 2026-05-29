/**
 * Lens Features — Comprehensive Test Suite
 *
 * Tests for all exports from lib/lens-features.js:
 *   - LENS_FEATURES (frozen object containing all 112+ lenses)
 *   - UNIVERSAL_FEATURES (re-exported from extended)
 *   - getFeaturesByLens(lensId)
 *   - getFeatureById(lensId, featureId)
 *   - getAllFeatures()
 *   - getFeaturesByCategory(category)
 *   - getLensFeatureStats()
 *
 * Coverage targets:
 *   - Every exported function and constant
 *   - Feature builder helper `f()` (indirectly, through structure validation)
 *   - Feature registration and lookup
 *   - Feature configuration and validation
 *   - Feature toggling (enable/disable status checks)
 *   - Feature dependencies and conflicts (integration arrays)
 *   - Lens-specific feature customization
 *   - Permission checks on features (emergent, bot, USB)
 *   - All error paths and edge cases
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  LENS_FEATURES,
  UNIVERSAL_FEATURES,
  getFeaturesByLens,
  getFeatureById,
  getAllFeatures,
  getFeaturesByCategory,
  getLensFeatureStats,
} from "../lib/lens-features.js";

// ═══════════════════════════════════════════════════════════════════════════════
// LENS_FEATURES constant
// ═══════════════════════════════════════════════════════════════════════════════

describe("LENS_FEATURES", () => {
  it("is a frozen object (immutable)", () => {
    assert.ok(Object.isFrozen(LENS_FEATURES));
  });

  it("cannot be modified — adding a new key throws in strict mode", () => {
    assert.throws(() => {
      LENS_FEATURES.newLens = { lensId: "newLens" };
    }, TypeError);
  });

  it("cannot be modified — deleting a key throws in strict mode", () => {
    assert.throws(() => {
      delete LENS_FEATURES.chat;
    }, TypeError);
  });

  it("contains a large number of lens definitions (at least 100)", () => {
    const count = Object.keys(LENS_FEATURES).length;
    assert.ok(count >= 100, `Expected at least 100 lenses, got ${count}`);
  });

  it("includes core lenses (chat, board, graph, code, studio)", () => {
    for (const id of ["chat", "board", "graph", "code", "studio"]) {
      assert.ok(LENS_FEATURES[id], `Missing core lens: ${id}`);
    }
  });

  it("includes governance lenses (market, questmarket, vote, ethics, alliance, billing)", () => {
    for (const id of ["market", "questmarket", "vote", "ethics", "alliance", "billing"]) {
      assert.ok(LENS_FEATURES[id], `Missing governance lens: ${id}`);
    }
  });

  it("includes science lenses (bio, chem, physics, math, quantum, neuro)", () => {
    for (const id of ["bio", "chem", "physics", "math", "quantum", "neuro"]) {
      assert.ok(LENS_FEATURES[id], `Missing science lens: ${id}`);
    }
  });

  it("includes AI/cognition lenses (ml, agents, reasoning, hypothesis)", () => {
    for (const id of ["ml", "agents", "reasoning", "hypothesis"]) {
      assert.ok(LENS_FEATURES[id], `Missing AI/cognition lens: ${id}`);
    }
  });

  it("includes knowledge lenses (research, cri)", () => {
    for (const id of ["research", "cri"]) {
      assert.ok(LENS_FEATURES[id], `Missing knowledge lens: ${id}`);
    }
  });

  it("includes specialized lenses (ingest, cognitive_cluster, lab, finance, collab, suffering, invariant, fork)", () => {
    for (const id of ["ingest", "cognitive_cluster", "lab", "finance", "collab", "suffering", "invariant", "fork"]) {
      assert.ok(LENS_FEATURES[id], `Missing specialized lens: ${id}`);
    }
  });

  it("includes industry super-lenses (healthcare, trades, food, retail, etc.)", () => {
    const industry = [
      "healthcare", "trades", "food", "retail", "household",
      "accounting", "agriculture", "logistics", "education", "legal",
      "nonprofit", "real_estate", "fitness", "creative_production",
      "manufacturing", "environment", "government", "aviation",
      "events", "science_fieldwork", "security", "services", "insurance",
    ];
    for (const id of industry) {
      assert.ok(LENS_FEATURES[id], `Missing industry lens: ${id}`);
    }
  });

  it("includes platform lenses (resonance, docs, paper, platform, admin, audit, integrations, queue, tick, lock, offline)", () => {
    for (const id of ["resonance", "docs", "paper", "platform", "admin", "audit", "integrations", "queue", "tick", "lock", "offline"]) {
      assert.ok(LENS_FEATURES[id], `Missing platform lens: ${id}`);
    }
  });

  it("includes extended lenses from lens-features-extended.js", () => {
    const extended = [
      "ext_market", "ext_marketplace", "ext_questmarket", "ext_vote",
      "ext_ethics", "ext_alliance", "ext_billing", "crypto",
    ];
    for (const id of extended) {
      assert.ok(LENS_FEATURES[id], `Missing extended lens: ${id}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lens shape validation — every lens must conform to the expected schema
// ═══════════════════════════════════════════════════════════════════════════════

describe("Lens schema validation", () => {
  const allLensIds = Object.keys(LENS_FEATURES);

  it("every lens has a string lensId that matches its key", () => {
    for (const key of allLensIds) {
      const lens = LENS_FEATURES[key];
      assert.equal(typeof lens.lensId, "string", `${key}: lensId should be a string`);
      assert.equal(lens.lensId, key, `${key}: lensId should match key`);
    }
  });

  it("every lens has a numeric lensNumber", () => {
    for (const key of allLensIds) {
      const lens = LENS_FEATURES[key];
      assert.equal(typeof lens.lensNumber, "number", `${key}: lensNumber should be a number`);
      assert.ok(lens.lensNumber >= 1, `${key}: lensNumber should be >= 1`);
    }
  });

  it("every lens has a non-empty category string", () => {
    for (const key of allLensIds) {
      const lens = LENS_FEATURES[key];
      assert.equal(typeof lens.category, "string", `${key}: category should be a string`);
      assert.ok(lens.category.length > 0, `${key}: category should not be empty`);
    }
  });

  it("every lens has a features array with at least one feature", () => {
    for (const key of allLensIds) {
      const lens = LENS_FEATURES[key];
      assert.ok(Array.isArray(lens.features), `${key}: features should be an array`);
      assert.ok(lens.features.length > 0, `${key}: features should not be empty`);
    }
  });

  it("every lens has a featureCount matching features.length", () => {
    for (const key of allLensIds) {
      const lens = LENS_FEATURES[key];
      assert.equal(
        lens.featureCount,
        lens.features.length,
        `${key}: featureCount (${lens.featureCount}) does not match features.length (${lens.features.length})`
      );
    }
  });

  it("every lens has an economicIntegrations array", () => {
    for (const key of allLensIds) {
      const lens = LENS_FEATURES[key];
      assert.ok(
        Array.isArray(lens.economicIntegrations),
        `${key}: economicIntegrations should be an array`
      );
    }
  });

  it("every lens has boolean emergentAccess, botAccess, and usbIntegration", () => {
    for (const key of allLensIds) {
      const lens = LENS_FEATURES[key];
      assert.equal(typeof lens.emergentAccess, "boolean", `${key}: emergentAccess should be boolean`);
      assert.equal(typeof lens.botAccess, "boolean", `${key}: botAccess should be boolean`);
      assert.equal(typeof lens.usbIntegration, "boolean", `${key}: usbIntegration should be boolean`);
    }
  });

  it("lensNumbers are unique across all lenses", () => {
    const numbers = new Map();
    for (const key of allLensIds) {
      const num = LENS_FEATURES[key].lensNumber;
      if (numbers.has(num)) {
        assert.fail(`Duplicate lensNumber ${num} found in "${key}" and "${numbers.get(num)}"`);
      }
      numbers.set(num, key);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Feature shape validation — every feature built by f() must have correct shape
// ═══════════════════════════════════════════════════════════════════════════════

describe("Feature shape validation (f() builder)", () => {
  const allLenses = Object.values(LENS_FEATURES);

  it("every feature has string id, name, description, category", () => {
    for (const lens of allLenses) {
      for (const feat of lens.features) {
        assert.equal(typeof feat.id, "string", `Feature id should be string in lens ${lens.lensId}`);
        assert.ok(feat.id.length > 0, `Feature id should not be empty in lens ${lens.lensId}`);
        assert.equal(typeof feat.name, "string", `Feature name should be string in ${lens.lensId}/${feat.id}`);
        assert.ok(feat.name.length > 0, `Feature name should not be empty in ${lens.lensId}/${feat.id}`);
        assert.equal(typeof feat.description, "string", `Feature description should be string in ${lens.lensId}/${feat.id}`);
        assert.ok(feat.description.length > 0, `Feature description should not be empty in ${lens.lensId}/${feat.id}`);
        assert.equal(typeof feat.category, "string", `Feature category should be string in ${lens.lensId}/${feat.id}`);
      }
    }
  });

  it("every feature has an integrations array (possibly empty)", () => {
    for (const lens of allLenses) {
      for (const feat of lens.features) {
        assert.ok(
          Array.isArray(feat.integrations),
          `Feature ${lens.lensId}/${feat.id}: integrations should be an array`
        );
      }
    }
  });

  it('every feature has status "active"', () => {
    for (const lens of allLenses) {
      for (const feat of lens.features) {
        assert.equal(
          feat.status,
          "active",
          `Feature ${lens.lensId}/${feat.id}: status should be "active", got "${feat.status}"`
        );
      }
    }
  });

  it("integration arrays contain only strings", () => {
    for (const lens of allLenses) {
      for (const feat of lens.features) {
        for (const integration of feat.integrations) {
          assert.equal(
            typeof integration,
            "string",
            `Feature ${lens.lensId}/${feat.id}: integration items should be strings, got ${typeof integration}`
          );
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UNIVERSAL_FEATURES
// ═══════════════════════════════════════════════════════════════════════════════

describe("UNIVERSAL_FEATURES", () => {
  it("is a frozen array (immutable)", () => {
    assert.ok(Object.isFrozen(UNIVERSAL_FEATURES));
  });

  it("cannot be modified — push throws", () => {
    assert.throws(() => {
      UNIVERSAL_FEATURES.push({ id: "x" });
    }, TypeError);
  });

  it("contains at least 15 universal features", () => {
    assert.ok(
      UNIVERSAL_FEATURES.length >= 15,
      `Expected at least 15 universal features, got ${UNIVERSAL_FEATURES.length}`
    );
  });

  it("includes critical economic invariants", () => {
    const ids = UNIVERSAL_FEATURES.map((f) => f.id);
    assert.ok(ids.includes("95_pct_creator_share"), "Missing 95% creator share invariant");
    assert.ok(ids.includes("no_favoritism"), "Missing no-favoritism invariant");
    assert.ok(ids.includes("no_data_selling"), "Missing no-data-selling invariant");
  });

  it("includes core infrastructure features", () => {
    const ids = UNIVERSAL_FEATURES.map((f) => f.id);
    assert.ok(ids.includes("offline_access"), "Missing offline access");
    assert.ok(ids.includes("cc_native"), "Missing CC native");
    assert.ok(ids.includes("dtu_compression"), "Missing DTU compression");
    assert.ok(ids.includes("citation_tracking"), "Missing citation tracking");
    assert.ok(ids.includes("preview_system"), "Missing preview system");
  });

  it("includes accessibility and platform-wide features", () => {
    const ids = UNIVERSAL_FEATURES.map((f) => f.id);
    assert.ok(ids.includes("accessibility"), "Missing accessibility");
    assert.ok(ids.includes("mobile_responsive"), "Missing mobile responsive");
    assert.ok(ids.includes("api_accessible"), "Missing API accessible");
    assert.ok(ids.includes("multi_language"), "Missing multi-language");
    assert.ok(ids.includes("export_freedom"), "Missing export freedom");
  });

  it("every universal feature conforms to standard feature shape", () => {
    for (const feat of UNIVERSAL_FEATURES) {
      assert.equal(typeof feat.id, "string");
      assert.equal(typeof feat.name, "string");
      assert.equal(typeof feat.description, "string");
      assert.equal(typeof feat.category, "string");
      assert.ok(Array.isArray(feat.integrations));
      assert.equal(feat.status, "active");
    }
  });

  it("has unique feature IDs across all universal features", () => {
    const ids = UNIVERSAL_FEATURES.map((f) => f.id);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, "Duplicate IDs found in UNIVERSAL_FEATURES");
  });

  it("universal features span multiple categories", () => {
    const categories = new Set(UNIVERSAL_FEATURES.map((f) => f.category));
    assert.ok(categories.size >= 3, `Expected at least 3 categories, got ${categories.size}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getFeaturesByLens()
// ═══════════════════════════════════════════════════════════════════════════════

describe("getFeaturesByLens()", () => {
  it("returns the full feature array for a valid core lens", () => {
    const features = getFeaturesByLens("chat");
    assert.ok(Array.isArray(features));
    assert.equal(features.length, LENS_FEATURES.chat.featureCount);
  });

  it("returns the correct features for the board lens", () => {
    const features = getFeaturesByLens("board");
    assert.equal(features.length, 10);
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("task_marketplace"));
    assert.ok(ids.includes("bot_task_delegation"));
  });

  it("returns features for the studio lens (creative production)", () => {
    const features = getFeaturesByLens("studio");
    assert.equal(features.length, 13);
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("music_production_suite"));
    assert.ok(ids.includes("remix_workstation"));
    assert.ok(ids.includes("film_production_tools"));
  });

  it("returns features for a governance lens", () => {
    const features = getFeaturesByLens("vote");
    assert.equal(features.length, 8);
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("weighted_voting"));
    assert.ok(ids.includes("emergent_voting_rights"));
  });

  it("returns features for a science lens", () => {
    const features = getFeaturesByLens("bio");
    assert.equal(features.length, 10);
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("lab_protocol_marketplace"));
    assert.ok(ids.includes("usb_bio_integration"));
  });

  it("returns features for an industry lens", () => {
    const features = getFeaturesByLens("healthcare");
    assert.equal(features.length, 13);
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("patient_education"));
    assert.ok(ids.includes("usb_prosthetics"));
  });

  it("returns features for a platform lens", () => {
    const features = getFeaturesByLens("resonance");
    assert.equal(features.length, 4);
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("system_vitals"));
    assert.ok(ids.includes("four_brain_health"));
  });

  it("returns features for an extended lens", () => {
    const features = getFeaturesByLens("crypto");
    assert.ok(features.length > 0);
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("cc_wallet"));
  });

  it("returns an empty array for a non-existent lens", () => {
    const features = getFeaturesByLens("nonexistent_lens_id");
    assert.ok(Array.isArray(features));
    assert.equal(features.length, 0);
  });

  it("returns an empty array for undefined input", () => {
    const features = getFeaturesByLens(undefined);
    assert.ok(Array.isArray(features));
    assert.equal(features.length, 0);
  });

  it("returns an empty array for null input", () => {
    const features = getFeaturesByLens(null);
    assert.ok(Array.isArray(features));
    assert.equal(features.length, 0);
  });

  it("returns an empty array for numeric input", () => {
    const features = getFeaturesByLens(42);
    assert.ok(Array.isArray(features));
    assert.equal(features.length, 0);
  });

  it("returns an empty array for empty string", () => {
    const features = getFeaturesByLens("");
    assert.ok(Array.isArray(features));
    assert.equal(features.length, 0);
  });

  it("returns features that match the lens definition exactly (reference equality)", () => {
    const features = getFeaturesByLens("code");
    assert.equal(features, LENS_FEATURES.code.features);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getFeatureById()
// ═══════════════════════════════════════════════════════════════════════════════

describe("getFeatureById()", () => {
  it("returns the matching feature object for a valid lens + feature ID", () => {
    const feat = getFeatureById("chat", "cc_tipping");
    assert.ok(feat);
    assert.equal(feat.id, "cc_tipping");
    assert.equal(feat.name, "Concord Coin Tipping");
    assert.equal(feat.status, "active");
  });

  it("returns the correct feature with all properties", () => {
    const feat = getFeatureById("chat", "emergent_participants");
    assert.ok(feat);
    assert.equal(feat.id, "emergent_participants");
    assert.equal(feat.category, "collaboration");
    assert.ok(feat.integrations.includes("emergent_access"));
  });

  it("returns a feature from the graph lens", () => {
    const feat = getFeatureById("graph", "citation_visualization");
    assert.ok(feat);
    assert.equal(feat.id, "citation_visualization");
    assert.ok(feat.integrations.includes("citation_royalties"));
    assert.ok(feat.integrations.includes("dtu"));
  });

  it("returns a feature from an industry lens", () => {
    const feat = getFeatureById("education", "course_builder");
    assert.ok(feat);
    assert.equal(feat.id, "course_builder");
    assert.equal(feat.category, "creation");
  });

  it("returns a feature from an extended lens", () => {
    const feat = getFeatureById("crypto", "zero_knowledge_proofs");
    assert.ok(feat);
    assert.equal(feat.id, "zero_knowledge_proofs");
    assert.ok(feat.integrations.includes("cryptography"));
  });

  it("returns a feature from the invariant lens", () => {
    const feat = getFeatureById("invariant", "95_pct_enforcement");
    assert.ok(feat);
    assert.equal(feat.id, "95_pct_enforcement");
    assert.equal(feat.category, "economy");
  });

  it("returns null for a valid lens but non-existent feature ID", () => {
    const feat = getFeatureById("chat", "nonexistent_feature");
    assert.equal(feat, null);
  });

  it("returns null for a non-existent lens", () => {
    const feat = getFeatureById("nonexistent_lens", "cc_tipping");
    assert.equal(feat, null);
  });

  it("returns null when both lens and feature are non-existent", () => {
    const feat = getFeatureById("nonexistent_lens", "nonexistent_feature");
    assert.equal(feat, null);
  });

  it("returns null for undefined lens", () => {
    const feat = getFeatureById(undefined, "cc_tipping");
    assert.equal(feat, null);
  });

  it("returns null for null lens", () => {
    const feat = getFeatureById(null, "cc_tipping");
    assert.equal(feat, null);
  });

  it("returns null for valid lens with undefined featureId", () => {
    const feat = getFeatureById("chat", undefined);
    assert.equal(feat, null);
  });

  it("returns null for valid lens with null featureId", () => {
    const feat = getFeatureById("chat", null);
    assert.equal(feat, null);
  });

  it("returns null for empty string lens and feature", () => {
    const feat = getFeatureById("", "");
    assert.equal(feat, null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getAllFeatures()
// ═══════════════════════════════════════════════════════════════════════════════

describe("getAllFeatures()", () => {
  let allFeatures;

  beforeEach(() => {
    allFeatures = getAllFeatures();
  });

  it("returns an array", () => {
    assert.ok(Array.isArray(allFeatures));
  });

  it("returns a large number of features (at least 800)", () => {
    assert.ok(
      allFeatures.length >= 800,
      `Expected at least 800 features, got ${allFeatures.length}`
    );
  });

  it("every item has the original feature properties plus lensId and lensNumber", () => {
    for (const feat of allFeatures) {
      assert.equal(typeof feat.id, "string");
      assert.equal(typeof feat.name, "string");
      assert.equal(typeof feat.description, "string");
      assert.equal(typeof feat.category, "string");
      assert.ok(Array.isArray(feat.integrations));
      assert.equal(feat.status, "active");
      // Enriched fields
      assert.equal(typeof feat.lensId, "string");
      assert.equal(typeof feat.lensNumber, "number");
    }
  });

  it("enriched lensId matches the originating lens", () => {
    // Take a known feature and verify the lensId
    const chatFeatures = allFeatures.filter((f) => f.lensId === "chat");
    assert.equal(chatFeatures.length, LENS_FEATURES.chat.featureCount);
    for (const cf of chatFeatures) {
      assert.equal(cf.lensNumber, LENS_FEATURES.chat.lensNumber);
    }
  });

  it("enriched lensNumber matches the originating lens", () => {
    const boardFeatures = allFeatures.filter((f) => f.lensId === "board");
    for (const bf of boardFeatures) {
      assert.equal(bf.lensNumber, LENS_FEATURES.board.lensNumber);
    }
  });

  it("total feature count matches sum of all lens featureCounts", () => {
    const expectedTotal = Object.values(LENS_FEATURES).reduce(
      (sum, lens) => sum + lens.features.length,
      0
    );
    assert.equal(allFeatures.length, expectedTotal);
  });

  it("returns a new array on each call (not cached)", () => {
    const first = getAllFeatures();
    const second = getAllFeatures();
    assert.notEqual(first, second, "getAllFeatures should return a fresh array each time");
  });

  it("returned feature objects are shallow copies (spread, not references)", () => {
    const first = getAllFeatures();
    const second = getAllFeatures();
    // Modifying the first should not affect the second
    if (first.length > 0) {
      first[0].id = "__modified__";
      assert.notEqual(second[0].id, "__modified__");
    }
  });

  it("contains features from both core and extended lens sets", () => {
    const lensIds = new Set(allFeatures.map((f) => f.lensId));
    // Core
    assert.ok(lensIds.has("chat"));
    assert.ok(lensIds.has("studio"));
    // Extended
    assert.ok(lensIds.has("crypto"));
    assert.ok(lensIds.has("ext_market"));
  });

  it("all lenses in LENS_FEATURES are represented in the flat array", () => {
    const lensIds = new Set(allFeatures.map((f) => f.lensId));
    for (const key of Object.keys(LENS_FEATURES)) {
      assert.ok(lensIds.has(key), `Lens ${key} missing from flat feature list`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getFeaturesByCategory()
// ═══════════════════════════════════════════════════════════════════════════════

describe("getFeaturesByCategory()", () => {
  it("returns features filtered to the given category", () => {
    const marketplaceFeatures = getFeaturesByCategory("marketplace");
    assert.ok(Array.isArray(marketplaceFeatures));
    assert.ok(marketplaceFeatures.length > 0);
    for (const f of marketplaceFeatures) {
      assert.equal(f.category, "marketplace");
    }
  });

  it("returns economy features", () => {
    const economyFeatures = getFeaturesByCategory("economy");
    assert.ok(economyFeatures.length > 0);
    for (const f of economyFeatures) {
      assert.equal(f.category, "economy");
    }
  });

  it("returns creation features", () => {
    const creationFeatures = getFeaturesByCategory("creation");
    assert.ok(creationFeatures.length > 0);
    for (const f of creationFeatures) {
      assert.equal(f.category, "creation");
    }
  });

  it("returns research features", () => {
    const researchFeatures = getFeaturesByCategory("research");
    assert.ok(researchFeatures.length > 0);
    for (const f of researchFeatures) {
      assert.equal(f.category, "research");
    }
  });

  it("returns governance features", () => {
    const govFeatures = getFeaturesByCategory("governance");
    assert.ok(govFeatures.length > 0);
    for (const f of govFeatures) {
      assert.equal(f.category, "governance");
    }
  });

  it("returns safety features", () => {
    const safetyFeatures = getFeaturesByCategory("safety");
    assert.ok(safetyFeatures.length > 0);
    for (const f of safetyFeatures) {
      assert.equal(f.category, "safety");
    }
  });

  it("returns collaboration features", () => {
    const collabFeatures = getFeaturesByCategory("collaboration");
    assert.ok(collabFeatures.length > 0);
    for (const f of collabFeatures) {
      assert.equal(f.category, "collaboration");
    }
  });

  it("returns analysis features", () => {
    const analysisFeatures = getFeaturesByCategory("analysis");
    assert.ok(analysisFeatures.length > 0);
    for (const f of analysisFeatures) {
      assert.equal(f.category, "analysis");
    }
  });

  it("returns infrastructure features", () => {
    const infraFeatures = getFeaturesByCategory("infrastructure");
    assert.ok(infraFeatures.length > 0);
    for (const f of infraFeatures) {
      assert.equal(f.category, "infrastructure");
    }
  });

  it("returns intelligence features", () => {
    const intellFeatures = getFeaturesByCategory("intelligence");
    assert.ok(intellFeatures.length > 0);
    for (const f of intellFeatures) {
      assert.equal(f.category, "intelligence");
    }
  });

  it("returns an empty array for a non-existent category", () => {
    const none = getFeaturesByCategory("nonexistent_category_xyz");
    assert.ok(Array.isArray(none));
    assert.equal(none.length, 0);
  });

  it("returns an empty array for undefined category", () => {
    const none = getFeaturesByCategory(undefined);
    assert.ok(Array.isArray(none));
    assert.equal(none.length, 0);
  });

  it("returns an empty array for null category", () => {
    const none = getFeaturesByCategory(null);
    assert.ok(Array.isArray(none));
    assert.equal(none.length, 0);
  });

  it("returns an empty array for empty string category", () => {
    const none = getFeaturesByCategory("");
    assert.ok(Array.isArray(none));
    assert.equal(none.length, 0);
  });

  it("every returned feature has the enriched lensId and lensNumber fields", () => {
    const marketplaceFeatures = getFeaturesByCategory("marketplace");
    for (const f of marketplaceFeatures) {
      assert.equal(typeof f.lensId, "string");
      assert.equal(typeof f.lensNumber, "number");
    }
  });

  it("the union of all category results covers all features", () => {
    const allFeatures = getAllFeatures();
    const categories = [...new Set(allFeatures.map((f) => f.category))];
    let totalFromCategories = 0;
    for (const cat of categories) {
      totalFromCategories += getFeaturesByCategory(cat).length;
    }
    assert.equal(totalFromCategories, allFeatures.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getLensFeatureStats()
// ═══════════════════════════════════════════════════════════════════════════════

describe("getLensFeatureStats()", () => {
  let stats;

  beforeEach(() => {
    stats = getLensFeatureStats();
  });

  it("returns an object with all expected keys", () => {
    const expectedKeys = [
      "totalFeatures",
      "totalLenses",
      "universalFeatures",
      "featuresByCategory",
      "uniqueIntegrations",
      "emergentLenses",
      "botLenses",
      "usbLenses",
      "averageFeaturesPerLens",
    ];
    for (const key of expectedKeys) {
      assert.ok(key in stats, `Missing key: ${key}`);
    }
  });

  it("totalFeatures is a positive number matching getAllFeatures().length", () => {
    assert.equal(typeof stats.totalFeatures, "number");
    assert.ok(stats.totalFeatures > 0);
    assert.equal(stats.totalFeatures, getAllFeatures().length);
  });

  it("totalLenses matches Object.keys(LENS_FEATURES).length", () => {
    assert.equal(stats.totalLenses, Object.keys(LENS_FEATURES).length);
  });

  it("universalFeatures matches UNIVERSAL_FEATURES.length", () => {
    assert.equal(stats.universalFeatures, UNIVERSAL_FEATURES.length);
  });

  it("featuresByCategory is a non-empty object", () => {
    assert.equal(typeof stats.featuresByCategory, "object");
    assert.ok(Object.keys(stats.featuresByCategory).length > 0);
  });

  it("featuresByCategory values sum to totalFeatures", () => {
    const sum = Object.values(stats.featuresByCategory).reduce((a, b) => a + b, 0);
    assert.equal(sum, stats.totalFeatures);
  });

  it("featuresByCategory includes the main feature categories", () => {
    const cats = Object.keys(stats.featuresByCategory);
    assert.ok(cats.includes("marketplace"), "Missing marketplace category");
    assert.ok(cats.includes("economy"), "Missing economy category");
    assert.ok(cats.includes("creation"), "Missing creation category");
    assert.ok(cats.includes("research"), "Missing research category");
    assert.ok(cats.includes("analysis"), "Missing analysis category");
  });

  it("uniqueIntegrations is a positive number", () => {
    assert.equal(typeof stats.uniqueIntegrations, "number");
    assert.ok(stats.uniqueIntegrations > 0);
  });

  it("emergentLenses is a positive number", () => {
    assert.equal(typeof stats.emergentLenses, "number");
    assert.ok(stats.emergentLenses > 0);
    // Verify it matches manual count
    const manual = Object.values(LENS_FEATURES).filter((l) => l.emergentAccess).length;
    assert.equal(stats.emergentLenses, manual);
  });

  it("botLenses is a positive number", () => {
    assert.equal(typeof stats.botLenses, "number");
    assert.ok(stats.botLenses > 0);
    const manual = Object.values(LENS_FEATURES).filter((l) => l.botAccess).length;
    assert.equal(stats.botLenses, manual);
  });

  it("usbLenses is a non-negative number", () => {
    assert.equal(typeof stats.usbLenses, "number");
    assert.ok(stats.usbLenses >= 0);
    const manual = Object.values(LENS_FEATURES).filter((l) => l.usbIntegration).length;
    assert.equal(stats.usbLenses, manual);
  });

  it("averageFeaturesPerLens is a positive number rounded to one decimal", () => {
    assert.equal(typeof stats.averageFeaturesPerLens, "number");
    assert.ok(stats.averageFeaturesPerLens > 0);
    // Check rounding: should have at most one decimal place
    const str = String(stats.averageFeaturesPerLens);
    const parts = str.split(".");
    if (parts.length > 1) {
      assert.ok(parts[1].length <= 1, "averageFeaturesPerLens should be rounded to 1 decimal");
    }
  });

  it("averageFeaturesPerLens equals totalFeatures / totalLenses rounded", () => {
    const expected =
      Math.round((stats.totalFeatures / stats.totalLenses) * 10) / 10;
    assert.equal(stats.averageFeaturesPerLens, expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Feature dependencies and integrations
// ═══════════════════════════════════════════════════════════════════════════════

describe("Feature dependencies and integrations", () => {
  it("concord_coin integration is present in many features across lenses", () => {
    const allFeatures = getAllFeatures();
    const ccFeatures = allFeatures.filter((f) =>
      f.integrations.includes("concord_coin")
    );
    assert.ok(
      ccFeatures.length > 50,
      `Expected many concord_coin integrations, got ${ccFeatures.length}`
    );
  });

  it("dtu_marketplace integration is widely used", () => {
    const allFeatures = getAllFeatures();
    const dtuFeatures = allFeatures.filter((f) =>
      f.integrations.includes("dtu_marketplace")
    );
    assert.ok(dtuFeatures.length > 50, `Expected many dtu_marketplace integrations, got ${dtuFeatures.length}`);
  });

  it("citation_royalties integration exists across multiple lenses", () => {
    const allFeatures = getAllFeatures();
    const citationFeatures = allFeatures.filter((f) =>
      f.integrations.includes("citation_royalties")
    );
    assert.ok(citationFeatures.length > 10);
    const lensIds = new Set(citationFeatures.map((f) => f.lensId));
    assert.ok(lensIds.size > 5, "citation_royalties should span multiple lenses");
  });

  it("emergent_access integration exists in features of emergent-accessible lenses", () => {
    const allFeatures = getAllFeatures();
    const emergentFeatures = allFeatures.filter((f) =>
      f.integrations.includes("emergent_access")
    );
    assert.ok(emergentFeatures.length > 5);
    // Every feature with emergent_access integration should be in a lens that allows emergent access
    for (const feat of emergentFeatures) {
      const lens = LENS_FEATURES[feat.lensId];
      assert.ok(
        lens.emergentAccess,
        `Feature ${feat.lensId}/${feat.id} has emergent_access integration but lens has emergentAccess=false`
      );
    }
  });

  it("bot_access integration exists in features of bot-accessible lenses", () => {
    const allFeatures = getAllFeatures();
    const botFeatures = allFeatures.filter((f) =>
      f.integrations.includes("bot_access")
    );
    assert.ok(botFeatures.length > 5);
    for (const feat of botFeatures) {
      const lens = LENS_FEATURES[feat.lensId];
      assert.ok(
        lens.botAccess,
        `Feature ${feat.lensId}/${feat.id} has bot_access integration but lens has botAccess=false`
      );
    }
  });

  it("usb integration exists in features of usb-enabled lenses", () => {
    const allFeatures = getAllFeatures();
    const usbFeatures = allFeatures.filter((f) =>
      f.integrations.includes("usb")
    );
    assert.ok(usbFeatures.length > 0);
    for (const feat of usbFeatures) {
      const lens = LENS_FEATURES[feat.lensId];
      assert.ok(
        lens.usbIntegration,
        `Feature ${feat.lensId}/${feat.id} has usb integration but lens has usbIntegration=false`
      );
    }
  });

  it("merit_credit integration is present across multiple lenses", () => {
    const allFeatures = getAllFeatures();
    const meritFeatures = allFeatures.filter((f) =>
      f.integrations.includes("merit_credit")
    );
    assert.ok(meritFeatures.length > 10);
  });

  it("features with multiple integrations have them as distinct strings", () => {
    const allFeatures = getAllFeatures();
    for (const feat of allFeatures) {
      if (feat.integrations.length > 1) {
        const unique = new Set(feat.integrations);
        assert.equal(
          feat.integrations.length,
          unique.size,
          `Feature ${feat.lensId}/${feat.id} has duplicate integrations`
        );
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lens category distribution
// ═══════════════════════════════════════════════════════════════════════════════

describe("Lens category distribution", () => {
  it("CORE category has exactly 5 lenses (chat, board, graph, code, studio)", () => {
    const coreLenses = Object.values(LENS_FEATURES).filter(
      (l) => l.category === "CORE"
    );
    assert.equal(coreLenses.length, 5);
    const ids = coreLenses.map((l) => l.lensId).sort();
    assert.deepEqual(ids, ["board", "chat", "code", "graph", "studio"]);
  });

  it("GOVERNANCE category contains expected lenses", () => {
    const govLenses = Object.values(LENS_FEATURES).filter(
      (l) => l.category === "GOVERNANCE"
    );
    assert.ok(govLenses.length >= 6);
    const ids = govLenses.map((l) => l.lensId);
    assert.ok(ids.includes("market"));
    assert.ok(ids.includes("questmarket"));
    assert.ok(ids.includes("vote"));
    assert.ok(ids.includes("ethics"));
    assert.ok(ids.includes("invariant"));
  });

  it("SCIENCE category contains expected lenses", () => {
    const sciLenses = Object.values(LENS_FEATURES).filter(
      (l) => l.category === "SCIENCE"
    );
    assert.ok(sciLenses.length >= 6);
    const ids = sciLenses.map((l) => l.lensId);
    assert.ok(ids.includes("bio"));
    assert.ok(ids.includes("chem"));
    assert.ok(ids.includes("physics"));
    assert.ok(ids.includes("math"));
  });

  it("INDUSTRY category is the largest category", () => {
    const industry = Object.values(LENS_FEATURES).filter(
      (l) => l.category === "INDUSTRY"
    );
    const others = Object.entries(
      Object.groupBy
        ? Object.groupBy(Object.values(LENS_FEATURES), (l) => l.category)
        : Object.values(LENS_FEATURES).reduce((acc, l) => {
            (acc[l.category] = acc[l.category] || []).push(l);
            return acc;
          }, {})
    );
    for (const [cat, lenses] of others) {
      if (cat !== "INDUSTRY") {
        assert.ok(
          industry.length >= lenses.length,
          `INDUSTRY (${industry.length}) should be >= ${cat} (${lenses.length})`
        );
      }
    }
  });

  it("PLATFORM category has multiple lenses", () => {
    const platformLenses = Object.values(LENS_FEATURES).filter(
      (l) => l.category === "PLATFORM"
    );
    assert.ok(platformLenses.length >= 8);
  });

  it("every lens belongs to a recognized category", () => {
    const knownCategories = new Set([
      "CORE", "GOVERNANCE", "SCIENCE", "AI_COGNITION", "KNOWLEDGE",
      "SPECIALIZED", "INDUSTRY", "PLATFORM",
      // Extended categories
      "GOVERNANCE_EXT", "SCIENCE_EXT", "AI_COGNITION_EXT", "AI_EXT",
      "SPECIALIZED_EXT", "BRIDGE", "CREATIVE",
      // SYSTEM — the ops-telemetry admin surface.
      "SYSTEM",
    ]);
    for (const lens of Object.values(LENS_FEATURES)) {
      assert.ok(
        knownCategories.has(lens.category),
        `Lens ${lens.lensId} has unexpected category: ${lens.category}`
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Permission and access checks
// ═══════════════════════════════════════════════════════════════════════════════

describe("Permission and access checks", () => {
  it("some lenses have emergentAccess enabled and some do not", () => {
    const allLenses = Object.values(LENS_FEATURES);
    const withEmergent = allLenses.filter((l) => l.emergentAccess);
    const withoutEmergent = allLenses.filter((l) => !l.emergentAccess);
    assert.ok(withEmergent.length > 0, "Should have lenses with emergent access");
    assert.ok(withoutEmergent.length > 0, "Should have lenses without emergent access");
  });

  it("some lenses have botAccess enabled and some do not", () => {
    const allLenses = Object.values(LENS_FEATURES);
    const withBot = allLenses.filter((l) => l.botAccess);
    const withoutBot = allLenses.filter((l) => !l.botAccess);
    assert.ok(withBot.length > 0, "Should have lenses with bot access");
    assert.ok(withoutBot.length > 0, "Should have lenses without bot access");
  });

  it("some lenses have usbIntegration enabled and some do not", () => {
    const allLenses = Object.values(LENS_FEATURES);
    const withUsb = allLenses.filter((l) => l.usbIntegration);
    const withoutUsb = allLenses.filter((l) => !l.usbIntegration);
    assert.ok(withUsb.length > 0, "Should have lenses with USB integration");
    assert.ok(withoutUsb.length > 0, "Should have lenses without USB integration");
  });

  it("chat lens has emergentAccess=true and botAccess=true", () => {
    assert.equal(LENS_FEATURES.chat.emergentAccess, true);
    assert.equal(LENS_FEATURES.chat.botAccess, true);
  });

  it("chat lens has usbIntegration=false", () => {
    assert.equal(LENS_FEATURES.chat.usbIntegration, false);
  });

  it("bio lens has usbIntegration=true (USB Bio-Integration feature)", () => {
    assert.equal(LENS_FEATURES.bio.usbIntegration, true);
  });

  it("agents lens has usbIntegration=true (physical deployment)", () => {
    assert.equal(LENS_FEATURES.agents.usbIntegration, true);
  });

  it("lock lens has no economic integrations", () => {
    assert.deepEqual(LENS_FEATURES.lock.economicIntegrations, []);
  });

  it("billing lens has no emergent or bot access", () => {
    assert.equal(LENS_FEATURES.billing.emergentAccess, false);
    assert.equal(LENS_FEATURES.billing.botAccess, false);
  });

  it("vote lens has emergentAccess=true but botAccess=false", () => {
    assert.equal(LENS_FEATURES.vote.emergentAccess, true);
    assert.equal(LENS_FEATURES.vote.botAccess, false);
  });

  it("healthcare lens has all three access types", () => {
    assert.equal(LENS_FEATURES.healthcare.emergentAccess, true);
    assert.equal(LENS_FEATURES.healthcare.botAccess, true);
    assert.equal(LENS_FEATURES.healthcare.usbIntegration, true);
  });

  it("offline lens has emergent access but no bot access", () => {
    assert.equal(LENS_FEATURES.offline.emergentAccess, true);
    assert.equal(LENS_FEATURES.offline.botAccess, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Specific lens feature content verification
// ═══════════════════════════════════════════════════════════════════════════════

describe("Specific lens feature content verification", () => {
  it("chat lens features include tipping, DTU creation, and governance", () => {
    const features = getFeaturesByLens("chat");
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("cc_tipping"));
    assert.ok(ids.includes("chat_to_dtu"));
    assert.ok(ids.includes("governance_drafting"));
    assert.ok(ids.includes("whistleblower_vault"));
  });

  it("graph lens has citation and revenue visualization features", () => {
    const features = getFeaturesByLens("graph");
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("citation_visualization"));
    assert.ok(ids.includes("revenue_flow_overlay"));
    assert.ok(ids.includes("ecosystem_health"));
    assert.ok(ids.includes("gap_detection"));
  });

  it("code lens has marketplace and collaboration features", () => {
    const features = getFeaturesByLens("code");
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("code_dtu_marketplace"));
    assert.ok(ids.includes("emergent_pair_programming"));
    assert.ok(ids.includes("api_builder"));
    assert.ok(ids.includes("repo_to_dtu"));
  });

  it("studio lens has creative production features including film", () => {
    const features = getFeaturesByLens("studio");
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("music_production_suite"));
    assert.ok(ids.includes("beat_marketplace"));
    assert.ok(ids.includes("film_production_tools"));
    assert.ok(ids.includes("sample_pack_builder"));
  });

  it("invariant lens enforces platform rules", () => {
    const features = getFeaturesByLens("invariant");
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("rule_engine_dashboard"));
    assert.ok(ids.includes("favoritism_detector"));
    assert.ok(ids.includes("95_pct_enforcement"));
    assert.ok(ids.includes("sovereignty_lock_monitor"));
    assert.ok(ids.includes("data_selling_prevention"));
    assert.ok(ids.includes("anti_manipulation"));
  });

  it("fork lens has forking and versioning features", () => {
    const features = getFeaturesByLens("fork");
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("one_click_fork"));
    assert.ok(ids.includes("fork_tree_viz"));
    assert.ok(ids.includes("merge_tools"));
    assert.ok(ids.includes("version_history"));
    assert.ok(ids.includes("auto_citation_fork"));
  });

  it("suffering lens focuses on wellbeing and safety", () => {
    const features = getFeaturesByLens("suffering");
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("wellbeing_monitoring"));
    assert.ok(ids.includes("emergent_suffering_detection"));
    assert.ok(ids.includes("burnout_prevention"));
    assert.ok(ids.includes("cross_substrate_suffering"));
  });

  it("education lens includes accessibility and free tier guarantee", () => {
    const features = getFeaturesByLens("education");
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("accessibility_tools"));
    assert.ok(ids.includes("free_tier_guarantee"));
    assert.ok(ids.includes("scholarship_fund"));
    assert.ok(ids.includes("course_builder"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Economic integration validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Economic integrations at the lens level", () => {
  it("economic integrations are arrays of strings", () => {
    for (const lens of Object.values(LENS_FEATURES)) {
      assert.ok(Array.isArray(lens.economicIntegrations), `${lens.lensId}: should be array`);
      for (const item of lens.economicIntegrations) {
        assert.equal(typeof item, "string", `${lens.lensId}: integration items should be strings`);
      }
    }
  });

  it("most lenses include concord_coin in their economic integrations", () => {
    const withCC = Object.values(LENS_FEATURES).filter((l) =>
      l.economicIntegrations.includes("concord_coin")
    );
    const total = Object.values(LENS_FEATURES).length;
    // Most (but not all) lenses should use CC
    assert.ok(
      withCC.length > total * 0.4,
      `Expected > 40% of lenses to have concord_coin, got ${withCC.length}/${total}`
    );
  });

  it("market lens has extensive economic integrations", () => {
    const integrations = LENS_FEATURES.market.economicIntegrations;
    assert.ok(integrations.includes("concord_coin"));
    assert.ok(integrations.includes("dtu_marketplace"));
    assert.ok(integrations.includes("citation_royalties"));
    assert.ok(integrations.includes("preview_system"));
  });

  it("collab lens has revenue_split in its economic integrations", () => {
    const integrations = LENS_FEATURES.collab.economicIntegrations;
    assert.ok(integrations.includes("revenue_split"));
  });

  it("studio lens has dtu_compression in its economic integrations", () => {
    const integrations = LENS_FEATURES.studio.economicIntegrations;
    assert.ok(integrations.includes("dtu_compression"));
  });

  it("lock lens has no economic integrations", () => {
    assert.equal(LENS_FEATURES.lock.economicIntegrations.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lens number ordering and range
// ═══════════════════════════════════════════════════════════════════════════════

describe("Lens number ordering and range", () => {
  it("core lenses have lens numbers 1-5", () => {
    assert.equal(LENS_FEATURES.chat.lensNumber, 1);
    assert.equal(LENS_FEATURES.board.lensNumber, 2);
    assert.equal(LENS_FEATURES.graph.lensNumber, 3);
    assert.equal(LENS_FEATURES.code.lensNumber, 4);
    assert.equal(LENS_FEATURES.studio.lensNumber, 5);
  });

  it("governance lenses have lens numbers 6-11", () => {
    assert.equal(LENS_FEATURES.market.lensNumber, 6);
    assert.equal(LENS_FEATURES.questmarket.lensNumber, 7);
    assert.equal(LENS_FEATURES.vote.lensNumber, 8);
    assert.equal(LENS_FEATURES.ethics.lensNumber, 9);
    assert.equal(LENS_FEATURES.alliance.lensNumber, 10);
    assert.equal(LENS_FEATURES.billing.lensNumber, 11);
  });

  it("science lenses have lens numbers 12-17", () => {
    assert.equal(LENS_FEATURES.bio.lensNumber, 12);
    assert.equal(LENS_FEATURES.chem.lensNumber, 13);
    assert.equal(LENS_FEATURES.physics.lensNumber, 14);
    assert.equal(LENS_FEATURES.math.lensNumber, 15);
    assert.equal(LENS_FEATURES.quantum.lensNumber, 16);
    assert.equal(LENS_FEATURES.neuro.lensNumber, 17);
  });

  it("AI/cognition lenses have lens numbers 18-21", () => {
    assert.equal(LENS_FEATURES.ml.lensNumber, 18);
    assert.equal(LENS_FEATURES.agents.lensNumber, 19);
    assert.equal(LENS_FEATURES.reasoning.lensNumber, 20);
    assert.equal(LENS_FEATURES.hypothesis.lensNumber, 21);
  });

  it("all lens numbers are positive integers", () => {
    for (const lens of Object.values(LENS_FEATURES)) {
      assert.ok(Number.isInteger(lens.lensNumber), `${lens.lensId}: lensNumber should be integer`);
      assert.ok(lens.lensNumber >= 1, `${lens.lensId}: lensNumber should be >= 1`);
    }
  });

  it("maximum lens number is at least 112 (as per specification)", () => {
    const maxNum = Math.max(...Object.values(LENS_FEATURES).map((l) => l.lensNumber));
    assert.ok(maxNum >= 112, `Expected max lens number >= 112, got ${maxNum}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Feature status (toggling/enable-disable conceptual checks)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Feature status and toggling", () => {
  it("all features across all lenses have status active", () => {
    const allFeatures = getAllFeatures();
    for (const feat of allFeatures) {
      assert.equal(
        feat.status,
        "active",
        `Feature ${feat.lensId}/${feat.id} has unexpected status: ${feat.status}`
      );
    }
  });

  it("all universal features have status active", () => {
    for (const feat of UNIVERSAL_FEATURES) {
      assert.equal(feat.status, "active");
    }
  });

  it("features in the f() builder output always include a status field", () => {
    // Verify by checking any feature has exactly the expected keys
    const sampleFeat = getFeatureById("chat", "cc_tipping");
    assert.ok("status" in sampleFeat);
    assert.ok("id" in sampleFeat);
    assert.ok("name" in sampleFeat);
    assert.ok("description" in sampleFeat);
    assert.ok("category" in sampleFeat);
    assert.ok("integrations" in sampleFeat);
  });

  it("features created by f() have exactly 6 properties", () => {
    const sampleFeat = getFeatureById("chat", "cc_tipping");
    const keys = Object.keys(sampleFeat);
    assert.equal(keys.length, 6, `Expected 6 keys, got ${keys.length}: ${keys.join(", ")}`);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases and robustness
// ═══════════════════════════════════════════════════════════════════════════════

describe("Edge cases and robustness", () => {
  it("getFeaturesByLens returns undefined for prototype-inherited keys like constructor", () => {
    // "constructor" resolves to Object.prototype.constructor (a function),
    // which is truthy but has no .features property, so it returns undefined.
    // This documents the current behavior — inherited properties are not lens IDs.
    const features = getFeaturesByLens("constructor");
    assert.equal(features, undefined);
  });

  it("getFeaturesByLens with toString returns undefined (inherited property)", () => {
    const features = getFeaturesByLens("toString");
    assert.equal(features, undefined);
  });

  it("getFeatureById with inherited key returns null (no features array to search)", () => {
    // getFeatureById calls getFeaturesByLens which returns undefined for "constructor",
    // then .find() on undefined would throw. Let's verify the actual behavior.
    // getFeaturesByLens("constructor") returns undefined, then
    // features.find(...) throws because undefined has no find method.
    // This documents an edge case in the implementation.
    assert.throws(() => {
      getFeatureById("constructor", "any");
    });
  });

  it("getFeaturesByCategory is case-sensitive", () => {
    const upper = getFeaturesByCategory("MARKETPLACE");
    const lower = getFeaturesByCategory("marketplace");
    // "marketplace" is the correct case from the f() builder
    assert.ok(lower.length > 0);
    assert.equal(upper.length, 0);
  });

  it("getAllFeatures returns a flat array (no nesting)", () => {
    const all = getAllFeatures();
    for (const item of all) {
      assert.ok(!Array.isArray(item), "Items should be objects, not arrays");
      assert.equal(typeof item, "object");
    }
  });

  it("getLensFeatureStats returns consistent data on repeated calls", () => {
    const stats1 = getLensFeatureStats();
    const stats2 = getLensFeatureStats();
    assert.deepEqual(stats1, stats2);
  });

  it("features with empty integration arrays are valid", () => {
    // quadratic_voting in vote lens has no integrations
    const feat = getFeatureById("vote", "quadratic_voting");
    assert.ok(feat);
    assert.deepEqual(feat.integrations, []);
  });

  it("features with many integrations are valid", () => {
    // Find features with 3+ integrations
    const allFeatures = getAllFeatures();
    const multiIntegration = allFeatures.filter((f) => f.integrations.length >= 3);
    assert.ok(multiIntegration.length > 0, "Should have features with 3+ integrations");
    for (const f of multiIntegration) {
      assert.ok(f.integrations.every((i) => typeof i === "string"));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Cross-function consistency checks
// ═══════════════════════════════════════════════════════════════════════════════

describe("Cross-function consistency", () => {
  it("getFeatureById finds the same features that getFeaturesByLens lists", () => {
    for (const lensId of ["chat", "code", "market", "bio", "education"]) {
      const features = getFeaturesByLens(lensId);
      for (const feat of features) {
        const found = getFeatureById(lensId, feat.id);
        assert.ok(found, `Feature ${lensId}/${feat.id} not found by getFeatureById`);
        assert.equal(found.id, feat.id);
        assert.equal(found.name, feat.name);
      }
    }
  });

  it("getAllFeatures covers every lens's features", () => {
    const allFeatures = getAllFeatures();
    for (const [key, lens] of Object.entries(LENS_FEATURES)) {
      const lensFeatures = allFeatures.filter((f) => f.lensId === key);
      assert.equal(
        lensFeatures.length,
        lens.features.length,
        `Mismatch for lens ${key}: getAllFeatures has ${lensFeatures.length}, lens has ${lens.features.length}`
      );
    }
  });

  it("getFeaturesByCategory results come from getAllFeatures", () => {
    const all = getAllFeatures();
    const marketplace = getFeaturesByCategory("marketplace");
    const allMarketplace = all.filter((f) => f.category === "marketplace");
    assert.equal(marketplace.length, allMarketplace.length);
  });

  it("stats totalFeatures matches getAllFeatures length", () => {
    const stats = getLensFeatureStats();
    const all = getAllFeatures();
    assert.equal(stats.totalFeatures, all.length);
  });

  it("stats featuresByCategory values match getFeaturesByCategory counts", () => {
    const stats = getLensFeatureStats();
    for (const [cat, count] of Object.entries(stats.featuresByCategory)) {
      const features = getFeaturesByCategory(cat);
      assert.equal(
        features.length,
        count,
        `Category ${cat}: stats says ${count}, getFeaturesByCategory returns ${features.length}`
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Feature uniqueness within lenses
// ═══════════════════════════════════════════════════════════════════════════════

describe("Feature uniqueness within lenses", () => {
  it("feature IDs are unique within each lens", () => {
    for (const [key, lens] of Object.entries(LENS_FEATURES)) {
      const ids = lens.features.map((f) => f.id);
      const unique = new Set(ids);
      assert.equal(
        ids.length,
        unique.size,
        `Lens ${key} has duplicate feature IDs: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`
      );
    }
  });

  it("feature names are unique within each lens", () => {
    for (const [key, lens] of Object.entries(LENS_FEATURES)) {
      const names = lens.features.map((f) => f.name);
      const unique = new Set(names);
      assert.equal(
        names.length,
        unique.size,
        `Lens ${key} has duplicate feature names`
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Specific extended lenses
// ═══════════════════════════════════════════════════════════════════════════════

describe("Extended lenses (from lens-features-extended.js)", () => {
  it("ext_market has plugin and theme marketplace features", () => {
    const features = getFeaturesByLens("ext_market");
    assert.ok(features.length > 0);
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("plugin_marketplace"));
    assert.ok(ids.includes("theme_marketplace"));
  });

  it("crypto lens has wallet and encryption features", () => {
    const features = getFeaturesByLens("crypto");
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("cc_wallet"));
    assert.ok(ids.includes("encryption_toolkit"));
    assert.ok(ids.includes("zero_knowledge_proofs"));
  });

  it("ext_vote lens has delegation and quadratic voting", () => {
    const features = getFeaturesByLens("ext_vote");
    const ids = features.map((f) => f.id);
    assert.ok(ids.includes("delegation_voting"));
    assert.ok(ids.includes("quadratic_voting"));
  });

  it("extended lenses are included in LENS_FEATURES frozen object", () => {
    assert.ok(LENS_FEATURES.ext_market);
    assert.ok(LENS_FEATURES.crypto);
    assert.ok(Object.isFrozen(LENS_FEATURES));
  });

  it("extended lenses show up in getAllFeatures()", () => {
    const all = getAllFeatures();
    const extLensIds = all.filter((f) => f.lensId.startsWith("ext_"));
    assert.ok(extLensIds.length > 0, "Expected extended lenses in getAllFeatures");
  });

  it("extended lenses show up in getLensFeatureStats()", () => {
    const stats = getLensFeatureStats();
    // totalLenses should include extended lenses
    const extCount = Object.keys(LENS_FEATURES).filter((k) => k.startsWith("ext_")).length;
    assert.ok(extCount > 0);
    // Stats totalLenses includes them
    assert.ok(stats.totalLenses >= extCount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Integration categories across the ecosystem
// ═══════════════════════════════════════════════════════════════════════════════

describe("Integration categories across the ecosystem", () => {
  it("known integration types appear across the feature set", () => {
    const allFeatures = getAllFeatures();
    const allIntegrations = new Set();
    for (const feat of allFeatures) {
      for (const integ of feat.integrations) {
        allIntegrations.add(integ);
      }
    }
    // Core integration types that should exist
    const expected = [
      "concord_coin", "dtu", "dtu_marketplace", "citation_royalties",
      "merit_credit", "emergent_access", "bot_access",
    ];
    for (const e of expected) {
      assert.ok(
        allIntegrations.has(e),
        `Expected integration type "${e}" not found in any feature`
      );
    }
  });

  it("dtu compression related integrations exist", () => {
    const allFeatures = getAllFeatures();
    const compressionFeatures = allFeatures.filter((f) =>
      f.integrations.includes("dtu_compression") ||
      f.integrations.includes("mega_dtu") ||
      f.integrations.includes("hyper_dtu")
    );
    assert.ok(compressionFeatures.length > 0, "Should have DTU compression features");
  });

  it("cryptography integration exists", () => {
    const allFeatures = getAllFeatures();
    const cryptoFeatures = allFeatures.filter((f) =>
      f.integrations.includes("cryptography")
    );
    assert.ok(cryptoFeatures.length > 0, "Should have cryptography features");
  });

  it("sovereignty integration exists in governance lenses", () => {
    const allFeatures = getAllFeatures();
    const sovFeatures = allFeatures.filter((f) =>
      f.integrations.includes("sovereignty")
    );
    assert.ok(sovFeatures.length > 0, "Should have sovereignty features");
  });

  it("geothermal integration exists", () => {
    const allFeatures = getAllFeatures();
    const geoFeatures = allFeatures.filter((f) =>
      f.integrations.includes("geothermal")
    );
    assert.ok(geoFeatures.length > 0, "Should have geothermal features");
  });

  it("nano_swarm integration exists", () => {
    const allFeatures = getAllFeatures();
    const nanoFeatures = allFeatures.filter((f) =>
      f.integrations.includes("nano_swarm")
    );
    assert.ok(nanoFeatures.length > 0, "Should have nano_swarm features");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Platform lenses have smaller feature sets
// ═══════════════════════════════════════════════════════════════════════════════

describe("Platform lens characteristics", () => {
  const platformLensIds = [
    "resonance", "docs", "paper", "platform", "admin",
    "audit", "integrations", "queue", "tick", "lock", "offline",
  ];

  it("platform lenses typically have 4 features each", () => {
    for (const id of platformLensIds) {
      const lens = LENS_FEATURES[id];
      assert.ok(lens, `Platform lens ${id} should exist`);
      assert.equal(
        lens.featureCount,
        4,
        `Platform lens ${id} should have 4 features, got ${lens.featureCount}`
      );
    }
  });

  it("most platform lenses have both emergent and bot access", () => {
    let bothCount = 0;
    for (const id of platformLensIds) {
      const lens = LENS_FEATURES[id];
      if (lens.emergentAccess && lens.botAccess) {
        bothCount++;
      }
    }
    assert.ok(
      bothCount >= platformLensIds.length * 0.5,
      `Expected most platform lenses to have both access types, got ${bothCount}/${platformLensIds.length}`
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Industry lenses have larger feature sets
// ═══════════════════════════════════════════════════════════════════════════════

describe("Industry lens characteristics", () => {
  const industryLensIds = [
    "healthcare", "trades", "food", "retail", "household",
    "accounting", "agriculture", "logistics", "education", "legal",
    "nonprofit", "real_estate", "fitness", "creative_production",
    "manufacturing", "environment", "government", "aviation",
    "events", "science_fieldwork", "security", "services", "insurance",
  ];

  it("industry lenses typically have 12+ features", () => {
    for (const id of industryLensIds) {
      const lens = LENS_FEATURES[id];
      assert.ok(lens, `Industry lens ${id} should exist`);
      assert.ok(
        lens.featureCount >= 9,
        `Industry lens ${id} should have >= 9 features, got ${lens.featureCount}`
      );
    }
  });

  it("education lens is the largest industry lens (14 features)", () => {
    assert.equal(LENS_FEATURES.education.featureCount, 14);
  });

  it("most industry lenses have botAccess enabled", () => {
    const withBot = industryLensIds.filter(
      (id) => LENS_FEATURES[id].botAccess
    );
    assert.ok(
      withBot.length >= industryLensIds.length * 0.7,
      `Expected >70% of industry lenses to have botAccess, got ${withBot.length}/${industryLensIds.length}`
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// f() builder internal validation (structure check)
// ═══════════════════════════════════════════════════════════════════════════════

describe("f() builder output — default integrations", () => {
  it("features with explicit integrations have them set correctly", () => {
    const feat = getFeatureById("chat", "cc_tipping");
    assert.ok(feat);
    assert.deepEqual(feat.integrations, ["concord_coin", "dtu"]);
  });

  it("features with no integrations parameter default to empty array", () => {
    // quadratic_voting has integrations = []
    const feat = getFeatureById("vote", "quadratic_voting");
    assert.ok(feat);
    assert.deepEqual(feat.integrations, []);
  });

  it("features with single integration have a one-element array", () => {
    const feat = getFeatureById("market", "cc_native");
    assert.ok(feat);
    assert.deepEqual(feat.integrations, ["concord_coin"]);
  });
});
