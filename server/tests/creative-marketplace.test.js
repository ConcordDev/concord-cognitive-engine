/**
 * Creative Artifact Marketplace Test Suite — Federation v1.2
 *
 * Tests:
 *   - Constitutional invariants (creator retains IP, no ownership transfer)
 *   - Artifact publishing (original + derivative)
 *   - Derivative declaration with lineage validation
 *   - Purchase flow with royalty cascade
 *   - Fee calculations (5.46% total = 1.46% platform + 4% marketplace)
 *   - Cascade royalty math (21% halving each generation, 0.05% floor)
 *   - Usage license granting (not ownership)
 *   - Ratings (only buyers can rate)
 *   - Promotion eligibility checks
 *   - Creative XP and quest completion (no coin rewards)
 *   - Artist discovery
 *   - Artifact lifecycle (pause/resume/delist)
 *   - Quest reward policy (XP and badges only)
 *
 * Run: node --test server/tests/creative-marketplace.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  ARTIFACT_TYPES, CREATIVE_MARKETPLACE, CREATIVE_FEDERATION,
  CREATIVE_QUESTS, CREATIVE_LEADERBOARD, CREATOR_RIGHTS,
  LICENSE_TYPES, QUEST_REWARD_POLICY, DEFAULT_CREATIVE_FILTERS,
} from "../lib/creative-marketplace-constants.js";

import {
  publishArtifact,
  publishDerivativeArtifact,
  purchaseArtifact,
  getArtifact,
  searchArtifacts,
  discoverLocalArtists,
  getDerivativeTree,
  rateArtifact,
  checkArtifactPromotionEligibility,
  awardCreativeXP,
  completeCreativeQuest,
  getCreativeXP,
  getCreativeQuestCompletions,
  getArtifactLicenses,
  getUserLicenses,
  getArtifactCascadeEarnings,
  pauseArtifact,
  resumeArtifact,
  delistArtifact,
  updateArtifactPrice,
} from "../economy/creative-marketplace.js";

import { getBalance } from "../economy/balances.js";
import { PLATFORM_ACCOUNT_ID } from "../economy/fees.js";

// ── In-Memory SQLite Helper ─────────────────────────────────────────────────

let Database;
try {
  Database = (await import("better-sqlite3")).default;
} catch {
  // skip tests if sqlite not available
}

function createTestDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Users table
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_active INTEGER NOT NULL DEFAULT 1,
      declared_regional TEXT,
      declared_national TEXT
    );
  `);

  // Economy ledger (required by transfer/ledger modules)
  db.exec(`
    CREATE TABLE IF NOT EXISTS economy_ledger (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      from_user_id TEXT,
      to_user_id TEXT,
      amount REAL NOT NULL CHECK(amount > 0),
      fee REAL NOT NULL DEFAULT 0 CHECK(fee >= 0),
      net REAL NOT NULL CHECK(net > 0),
      status TEXT NOT NULL DEFAULT 'complete',
      ref_id TEXT,
      metadata_json TEXT DEFAULT '{}',
      request_id TEXT,
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK(from_user_id IS NOT NULL OR to_user_id IS NOT NULL)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_ref_id
      ON economy_ledger(ref_id) WHERE ref_id IS NOT NULL;
  `);

  // Fee distributions (required by fee-split)
  db.exec(`
    CREATE TABLE IF NOT EXISTS fee_distributions (
      id TEXT PRIMARY KEY,
      source_tx_id TEXT NOT NULL,
      total_fee REAL NOT NULL,
      reserves_amount REAL NOT NULL,
      operating_amount REAL NOT NULL,
      payroll_amount REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Audit log (required by economy/audit.js — uses audit_log table)
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT,
      category TEXT,
      action TEXT,
      user_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      request_id TEXT,
      path TEXT,
      method TEXT,
      status_code INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Creative marketplace tables (from migration 014)
  db.exec(`
    CREATE TABLE creative_artifacts (
      id TEXT PRIMARY KEY,
      dtu_id TEXT,
      creator_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      genre TEXT,
      medium TEXT,
      language TEXT,
      duration_seconds INTEGER,
      width INTEGER,
      height INTEGER,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_hash TEXT NOT NULL,
      preview_path TEXT,
      location_regional TEXT,
      location_national TEXT,
      federation_tier TEXT DEFAULT 'regional'
        CHECK (federation_tier IN ('local','regional','national','global')),
      license_type TEXT DEFAULT 'standard'
        CHECK (license_type IN ('standard','exclusive','custom')),
      license_json TEXT NOT NULL DEFAULT '{}',
      is_derivative INTEGER DEFAULT 0,
      lineage_depth INTEGER DEFAULT 0,
      marketplace_status TEXT DEFAULT 'draft'
        CHECK (marketplace_status IN ('draft','active','paused','rejected_duplicate','delisted')),
      price REAL,
      purchase_count INTEGER DEFAULT 0,
      derivative_count INTEGER DEFAULT 0,
      rating REAL DEFAULT 0,
      rating_count INTEGER DEFAULT 0,
      dedup_verified INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE creative_artifact_derivatives (
      id TEXT PRIMARY KEY,
      child_artifact_id TEXT NOT NULL,
      parent_artifact_id TEXT NOT NULL,
      derivative_type TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (child_artifact_id) REFERENCES creative_artifacts(id),
      FOREIGN KEY (parent_artifact_id) REFERENCES creative_artifacts(id),
      UNIQUE(child_artifact_id, parent_artifact_id)
    );

    CREATE TABLE creative_usage_licenses (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      licensee_id TEXT NOT NULL,
      license_type TEXT NOT NULL,
      status TEXT DEFAULT 'active'
        CHECK (status IN ('active','revoked','expired')),
      purchase_price REAL NOT NULL,
      purchase_id TEXT,
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      FOREIGN KEY (artifact_id) REFERENCES creative_artifacts(id)
    );

    CREATE TABLE creative_royalty_cascade_ledger (
      id TEXT PRIMARY KEY,
      triggering_purchase_id TEXT NOT NULL,
      triggering_artifact_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      recipient_artifact_id TEXT NOT NULL,
      generation INTEGER NOT NULL,
      rate REAL NOT NULL,
      amount REAL NOT NULL,
      federation_tier TEXT NOT NULL,
      regional TEXT,
      national TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE creative_artifact_ratings (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      rater_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      review TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(artifact_id, rater_id),
      FOREIGN KEY (artifact_id) REFERENCES creative_artifacts(id)
    );

    CREATE TABLE creative_xp (
      user_id TEXT NOT NULL,
      federation_tier TEXT NOT NULL,
      regional TEXT NOT NULL DEFAULT '',
      national TEXT NOT NULL DEFAULT '',
      total_xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      season TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, federation_tier, regional, national, season)
    );

    CREATE TABLE creative_quest_completions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      federation_tier TEXT NOT NULL,
      regional TEXT,
      national TEXT,
      xp_awarded INTEGER,
      badge_awarded TEXT,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, quest_id, federation_tier)
    );
  `);

  return db;
}

function seedUsers(db) {
  db.prepare(`INSERT INTO users (id, username, email, declared_regional, declared_national) VALUES (?, ?, ?, ?, ?)`).run("creator1", "lagos_artist", "artist@lagos.ng", "lagos", "nigeria");
  db.prepare(`INSERT INTO users (id, username, email, declared_regional, declared_national) VALUES (?, ?, ?, ?, ?)`).run("creator2", "nairobi_remixer", "remixer@nairobi.ke", "nairobi", "kenya");
  db.prepare(`INSERT INTO users (id, username, email, declared_regional, declared_national) VALUES (?, ?, ?, ?, ?)`).run("creator3", "london_producer", "producer@london.uk", "london", "uk");
  db.prepare(`INSERT INTO users (id, username, email, declared_regional, declared_national) VALUES (?, ?, ?, ?, ?)`).run("buyer1", "fan1", "fan1@test.com", "lagos", "nigeria");
  db.prepare(`INSERT INTO users (id, username, email, declared_regional, declared_national) VALUES (?, ?, ?, ?, ?)`).run("buyer2", "fan2", "fan2@test.com", "nairobi", "kenya");

  // Seed buyer balances so purchases work
  db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("seed_b1", "MINT", null, "buyer1", 10000, 0, 10000, "complete");
  db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("seed_b2", "MINT", null, "buyer2", 10000, 0, 10000, "complete");
  db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("seed_c2", "MINT", null, "creator2", 5000, 0, 5000, "complete");
  db.prepare(`INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("seed_c3", "MINT", null, "creator3", 5000, 0, 5000, "complete");
}

function publishTestBeat(db) {
  return publishArtifact(db, {
    creatorId: "creator1",
    type: "beat",
    title: "Lagos Sunset Beat",
    description: "An Afrobeats instrumental with heavy percussion and synth melodies. Perfect for rap or vocals.",
    filePath: "/uploads/beat_001.wav",
    fileSize: 50 * 1024 * 1024, // 50MB
    fileHash: "abc123hash456",
    price: 50,
    creative: { genre: "afrobeats", tags: ["afrobeats", "instrumental"] },
    license: { type: "standard" },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Creative Marketplace Constants", () => {
  it("CREATOR_RIGHTS forbids ownership transfer", () => {
    assert.equal(CREATOR_RIGHTS.ownershipTransfer, "FORBIDDEN");
    assert.equal(CREATOR_RIGHTS.saleType, "usage_license");
  });

  it("creator retains full IP", () => {
    assert.ok(CREATOR_RIGHTS.creatorRetains.includes("full_intellectual_property"));
    assert.ok(CREATOR_RIGHTS.creatorRetains.includes("right_to_resell"));
    assert.ok(CREATOR_RIGHTS.creatorRetains.includes("attribution_in_perpetuity"));
  });

  it("buyer does NOT receive ownership", () => {
    assert.ok(CREATOR_RIGHTS.buyerDoesNotReceive.includes("ownership"));
    assert.ok(CREATOR_RIGHTS.buyerDoesNotReceive.includes("right_to_claim_authorship"));
  });

  it("ARTIFACT_TYPES has all expected types", () => {
    const types = Object.keys(ARTIFACT_TYPES);
    assert.ok(types.includes("music_track"));
    assert.ok(types.includes("beat"));
    assert.ok(types.includes("image"));
    assert.ok(types.includes("video"));
    assert.ok(types.includes("code"));
    assert.ok(types.includes("dataset"));
    assert.ok(types.includes("condensed"));
  });

  it("beat max size is 200MB", () => {
    assert.equal(ARTIFACT_TYPES.beat.maxSizeMB, 200);
  });

  it("beat has expected derivative types", () => {
    assert.ok(ARTIFACT_TYPES.beat.derivativeTypes.includes("remix"));
    assert.ok(ARTIFACT_TYPES.beat.derivativeTypes.includes("song_over_beat"));
  });

  it("fee rates match spec", () => {
    assert.equal(CREATIVE_MARKETPLACE.PLATFORM_FEE_RATE, 0.0146);
    assert.equal(CREATIVE_MARKETPLACE.MARKETPLACE_FEE_RATE, 0.04);
    assert.equal(CREATIVE_MARKETPLACE.TOTAL_FEE_RATE, 0.0546);
  });

  it("royalty cascade starts at 21% and halves", () => {
    assert.equal(CREATIVE_MARKETPLACE.INITIAL_ROYALTY_RATE, 0.21);
    assert.equal(CREATIVE_MARKETPLACE.ROYALTY_HALVING, 2);
    assert.equal(CREATIVE_MARKETPLACE.ROYALTY_FLOOR, 0.0005);
  });

  it("QUEST_REWARD_POLICY forbids coins", () => {
    assert.ok(QUEST_REWARD_POLICY.forbidden.includes("concord_coin"));
    assert.ok(QUEST_REWARD_POLICY.allowed.includes("xp"));
    assert.ok(QUEST_REWARD_POLICY.allowed.includes("badges"));
  });

  it("creative quests have NO coinReward field", () => {
    for (const [tier, quests] of Object.entries(CREATIVE_QUESTS)) {
      for (const quest of quests) {
        assert.equal(quest.coinReward, undefined, `${tier}/${quest.id} still has coinReward`);
        assert.ok(quest.xpReward > 0, `${tier}/${quest.id} should have xpReward`);
        assert.ok(quest.badge, `${tier}/${quest.id} should have badge`);
      }
    }
  });

  it("regional has 5 creative quests, national has 4, global has 4", () => {
    assert.equal(CREATIVE_QUESTS.regional.length, 5);
    assert.equal(CREATIVE_QUESTS.national.length, 4);
    assert.equal(CREATIVE_QUESTS.global.length, 4);
  });

  it("CREATIVE_FEDERATION has all four tiers", () => {
    assert.ok(CREATIVE_FEDERATION.local);
    assert.ok(CREATIVE_FEDERATION.regional);
    assert.ok(CREATIVE_FEDERATION.national);
    assert.ok(CREATIVE_FEDERATION.global);
  });

  it("local tier has no marketplace", () => {
    assert.equal(CREATIVE_FEDERATION.local.marketplace, false);
  });

  it("regional requires 10 purchases for national promotion", () => {
    assert.equal(CREATIVE_FEDERATION.regional.promotionToNational.minPurchases, 10);
    assert.equal(CREATIVE_FEDERATION.regional.promotionToNational.minDerivatives, 2);
  });

  it("creative leaderboard has 10 categories", () => {
    assert.equal(CREATIVE_LEADERBOARD.categories.length, 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ARTIFACT PUBLISHING TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Artifact Publishing", () => {
  if (!Database) return;

  let db;
  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
  });

  it("publishes an original beat to regional marketplace", () => {
    const result = publishTestBeat(db);
    assert.equal(result.ok, true);
    assert.ok(result.artifact.id.startsWith("ca_"));
    assert.equal(result.artifact.type, "beat");
    assert.equal(result.artifact.federationTier, "regional");
    assert.equal(result.artifact.marketplaceStatus, "active");
    assert.equal(result.artifact.locationRegional, "lagos");
    assert.equal(result.artifact.locationNational, "nigeria");
  });

  it("rejects invalid artifact type", () => {
    const result = publishArtifact(db, {
      creatorId: "creator1", type: "invalid_type", title: "Test",
      filePath: "/test.bin", fileSize: 100, fileHash: "abc", price: 10,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_artifact_type");
  });

  it("rejects file exceeding max size", () => {
    const result = publishArtifact(db, {
      creatorId: "creator1", type: "beat", title: "Big File",
      description: "A very large beat file that exceeds the maximum allowed size for this type",
      filePath: "/test.wav", fileSize: 201 * 1024 * 1024, fileHash: "xyz", price: 10,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "file_too_large");
  });

  it("rejects duplicate content hash", () => {
    publishTestBeat(db);
    const dup = publishArtifact(db, {
      creatorId: "creator2", type: "beat", title: "Same Beat",
      description: "This is a duplicate file attempting to be listed on the marketplace again",
      filePath: "/dup.wav", fileSize: 50 * 1024 * 1024, fileHash: "abc123hash456", price: 25,
    });
    assert.equal(dup.ok, false);
    assert.equal(dup.error, "duplicate_content");
  });

  it("rejects missing fields", () => {
    assert.equal(publishArtifact(db, {}).ok, false);
    assert.equal(publishArtifact(db, { creatorId: "c1" }).ok, false);
  });

  it("artifact is retrievable after publish", () => {
    const { artifact } = publishTestBeat(db);
    const retrieved = getArtifact(db, artifact.id);
    assert.ok(retrieved);
    assert.equal(retrieved.title, "Lagos Sunset Beat");
    assert.equal(retrieved.type, "beat");
    assert.equal(retrieved.isDerivative, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DERIVATIVE PUBLISHING TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Derivative Artifact Publishing", () => {
  if (!Database) return;

  let db, beat;
  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
    beat = publishTestBeat(db);

    // Grant creator2 a license to the beat (simulate purchase)
    db.prepare(`INSERT INTO creative_usage_licenses (id, artifact_id, licensee_id, license_type, status, purchase_price)
      VALUES ('lic1', ?, 'creator2', 'standard', 'active', 50)`).run(beat.artifact.id);
  });

  it("publishes derivative with valid parent declaration", () => {
    const result = publishDerivativeArtifact(db, {
      creatorId: "creator2",
      artifact: {
        type: "music_track",
        title: "Nairobi Flow (over Lagos Beat)",
        description: "Rap track recorded over the Lagos Sunset Beat with Nairobi flavor and Swahili lyrics",
        filePath: "/uploads/track_001.mp3",
        fileSize: 30 * 1024 * 1024,
        fileHash: "deriv_hash_001",
        price: 100,
        creative: { genre: "hip-hop" },
      },
      parentDeclarations: [
        { artifactId: beat.artifact.id, derivativeType: "song_over_beat" },
      ],
    });

    assert.equal(result.ok, true);
    assert.equal(result.artifact.isDerivative, true);
    assert.equal(result.artifact.lineageDepth, 1);
  });

  it("rejects derivative without usage license", () => {
    const result = publishDerivativeArtifact(db, {
      creatorId: "creator3", // no license
      artifact: {
        type: "music_track", title: "Unlicensed Derivative",
        description: "This should fail because creator3 never purchased the beat they are trying to derive from",
        filePath: "/test.mp3", fileSize: 1024, fileHash: "no_lic_hash", price: 50,
      },
      parentDeclarations: [{ artifactId: beat.artifact.id, derivativeType: "song_over_beat" }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_usage_license");
  });

  it("allows creator to derive from own work without license", () => {
    const result = publishDerivativeArtifact(db, {
      creatorId: "creator1", // original creator
      artifact: {
        type: "music_track", title: "Self-Remix",
        description: "The original creator remixing their own beat, no license needed for own work",
        filePath: "/self_remix.mp3", fileSize: 1024, fileHash: "self_remix_hash", price: 60,
      },
      parentDeclarations: [{ artifactId: beat.artifact.id, derivativeType: "remix" }],
    });
    assert.equal(result.ok, true);
  });

  it("rejects invalid derivative type for parent artifact type", () => {
    const result = publishDerivativeArtifact(db, {
      creatorId: "creator2",
      artifact: {
        type: "music_track", title: "Wrong Type",
        description: "This should fail because 'fork' is not a valid derivative type for beats",
        filePath: "/wrong.mp3", fileSize: 1024, fileHash: "wrong_type_hash", price: 50,
      },
      parentDeclarations: [{ artifactId: beat.artifact.id, derivativeType: "fork" }], // fork is for code, not beat
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_derivative_type");
  });

  it("increments parent derivative count", () => {
    publishDerivativeArtifact(db, {
      creatorId: "creator2",
      artifact: {
        type: "music_track", title: "Derivative Track",
        description: "A derivative track that should increment the parent's derivative counter on publish",
        filePath: "/d.mp3", fileSize: 1024, fileHash: "d_hash", price: 50,
      },
      parentDeclarations: [{ artifactId: beat.artifact.id, derivativeType: "song_over_beat" }],
    });

    const parent = getArtifact(db, beat.artifact.id);
    assert.equal(parent.derivativeCount, 1);
  });

  it("rejects empty parent declarations", () => {
    const result = publishDerivativeArtifact(db, {
      creatorId: "creator2",
      artifact: { type: "beat", title: "No Parents", description: "This has no parents declared", filePath: "/x.mp3", fileSize: 1024, fileHash: "nph", price: 10 },
      parentDeclarations: [],
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "derivative_must_declare_parents");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PURCHASE + ROYALTY CASCADE TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Purchase and Royalty Cascade", () => {
  if (!Database) return;

  let db, beat;
  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
    beat = publishTestBeat(db);
  });

  it("purchases original artifact — creator gets 94.54%", () => {
    const result = purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });

    assert.equal(result.ok, true);
    assert.ok(result.purchaseId);
    assert.equal(result.price, 50);

    // Fee check: 50 * 0.0546 = 2.73
    assert.equal(result.fees, 2.73);
    // Creator gets: 50 - 2.73 = 47.27
    assert.equal(result.creatorEarnings, 47.27);
    // No cascade for original work
    assert.equal(result.cascade.total, 0);
  });

  it("grants usage license on purchase", () => {
    purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
    const licenses = getArtifactLicenses(db, beat.artifact.id);
    assert.equal(licenses.licenses.length, 1);
    assert.equal(licenses.licenses[0].licensee_id, "buyer1");
    assert.equal(licenses.licenses[0].status, "active");
  });

  it("prevents buying own artifact", () => {
    const result = purchaseArtifact(db, { buyerId: "creator1", artifactId: beat.artifact.id });
    assert.equal(result.ok, false);
    assert.equal(result.error, "cannot_buy_own_artifact");
  });

  it("prevents double purchase", () => {
    purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
    const dup = purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
    assert.equal(dup.ok, false);
    assert.equal(dup.error, "already_licensed");
  });

  it("increments purchase count", () => {
    purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
    const a = getArtifact(db, beat.artifact.id);
    assert.equal(a.purchaseCount, 1);
  });

  it("cascade pays original creator when derivative is purchased", () => {
    // buyer1 purchases beat, then creates derivative
    purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });

    // buyer1 (now licensed) creates a derivative
    // Give buyer1 a license explicitly for the derivative flow
    db.prepare(`INSERT INTO creative_usage_licenses (id, artifact_id, licensee_id, license_type, status, purchase_price)
      VALUES ('lic_deriv', ?, 'creator2', 'standard', 'active', 50)`).run(beat.artifact.id);

    const derivResult = publishDerivativeArtifact(db, {
      creatorId: "creator2",
      artifact: {
        type: "music_track",
        title: "Derivative Song",
        description: "A song built over the Lagos Sunset Beat that should trigger royalty cascade on purchase",
        filePath: "/deriv.mp3", fileSize: 1024, fileHash: "deriv_hash_cascade", price: 100,
      },
      parentDeclarations: [{ artifactId: beat.artifact.id, derivativeType: "song_over_beat" }],
    });
    assert.equal(derivResult.ok, true);

    // buyer2 purchases the derivative
    const purchaseResult = purchaseArtifact(db, { buyerId: "buyer2", artifactId: derivResult.artifact.id });
    assert.equal(purchaseResult.ok, true);

    // Check cascade
    assert.ok(purchaseResult.cascade.total > 0);
    assert.equal(purchaseResult.cascade.payments.length, 1); // one ancestor: beat creator

    const cascadePayment = purchaseResult.cascade.payments[0];
    assert.equal(cascadePayment.recipientId, "creator1"); // original beat maker
    assert.equal(cascadePayment.generation, 0);
    assert.equal(cascadePayment.rate, 0.21); // 21% first generation

    // Verify: (100 - 5.46) * 0.21 = 94.54 * 0.21 = 19.85 (rounded)
    const expectedAfterFees = Math.round((100 - 100 * 0.0546) * 100) / 100;
    const expectedCascade = Math.round(expectedAfterFees * 0.21 * 100) / 100;
    assert.equal(cascadePayment.amount, expectedCascade);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SEARCH & DISCOVERY TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Search and Discovery", () => {
  if (!Database) return;

  let db;
  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
    publishTestBeat(db);
    publishArtifact(db, {
      creatorId: "creator1", type: "image", title: "Lagos Skyline",
      description: "A stunning photograph of the Lagos skyline at sunset with beautiful orange and purple hues",
      filePath: "/img.jpg", fileSize: 5 * 1024 * 1024, fileHash: "img_hash_001", price: 25,
      creative: { genre: "photography", tags: ["landscape"] },
    });
  });

  it("searches by artifact type", () => {
    const result = searchArtifacts(db, { type: "beat" });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].type, "beat");
  });

  it("searches by creator", () => {
    const result = searchArtifacts(db, { creatorId: "creator1" });
    assert.equal(result.items.length, 2);
  });

  it("paginates results", () => {
    const result = searchArtifacts(db, { limit: 1, offset: 0 });
    assert.equal(result.items.length, 1);
    assert.equal(result.total, 2);
  });

  it("discovers local artists", () => {
    const result = discoverLocalArtists(db, { userId: "buyer1" });
    assert.equal(result.ok, true);
    assert.equal(result.region, "lagos");
    assert.ok(result.artists.length > 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RATING TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Artifact Ratings", () => {
  if (!Database) return;

  let db, beat;
  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
    beat = publishTestBeat(db);
    purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
  });

  it("allows buyer to rate after purchase", () => {
    const result = rateArtifact(db, { artifactId: beat.artifact.id, raterId: "buyer1", rating: 5, review: "Fire beat!" });
    assert.equal(result.ok, true);
    assert.equal(result.rating, 5);
  });

  it("rejects rating without purchase", () => {
    const result = rateArtifact(db, { artifactId: beat.artifact.id, raterId: "buyer2", rating: 4 });
    assert.equal(result.ok, false);
    assert.equal(result.error, "must_purchase_before_rating");
  });

  it("rejects duplicate rating", () => {
    rateArtifact(db, { artifactId: beat.artifact.id, raterId: "buyer1", rating: 5 });
    const dup = rateArtifact(db, { artifactId: beat.artifact.id, raterId: "buyer1", rating: 3 });
    assert.equal(dup.ok, false);
    assert.equal(dup.error, "already_rated");
  });

  it("rejects invalid rating value", () => {
    assert.equal(rateArtifact(db, { artifactId: beat.artifact.id, raterId: "buyer1", rating: 0 }).ok, false);
    assert.equal(rateArtifact(db, { artifactId: beat.artifact.id, raterId: "buyer1", rating: 6 }).ok, false);
  });

  it("updates aggregate rating on artifact", () => {
    rateArtifact(db, { artifactId: beat.artifact.id, raterId: "buyer1", rating: 4 });
    const a = getArtifact(db, beat.artifact.id);
    assert.equal(a.rating, 4);
    assert.equal(a.ratingCount, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PROMOTION ELIGIBILITY TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Promotion Eligibility", () => {
  if (!Database) return;

  let db, beat;
  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
    beat = publishTestBeat(db);
  });

  it("returns not eligible when requirements not met", () => {
    const result = checkArtifactPromotionEligibility(db, beat.artifact.id);
    assert.equal(result.ok, true);
    assert.equal(result.eligible, false);
    assert.equal(result.checks.minPurchases.met, false);
  });

  it("checks all promotion requirements", () => {
    const result = checkArtifactPromotionEligibility(db, beat.artifact.id);
    assert.ok(result.checks.minPurchases);
    assert.ok(result.checks.minDerivatives);
    assert.ok(result.checks.minRating);
    assert.ok(result.checks.minAgeHours);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATIVE XP & QUESTS TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Creative XP and Quests", () => {
  if (!Database) return;

  let db;
  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
  });

  it("awards creative XP", () => {
    const result = awardCreativeXP(db, { userId: "creator1", federationTier: "regional", xpAmount: 100 });
    assert.equal(result.ok, true);
    assert.equal(result.totalXP, 100);
    assert.equal(result.level, 2);
  });

  it("accumulates XP across awards", () => {
    awardCreativeXP(db, { userId: "creator1", federationTier: "regional", xpAmount: 100 });
    const result = awardCreativeXP(db, { userId: "creator1", federationTier: "regional", xpAmount: 200 });
    assert.equal(result.totalXP, 300);
  });

  it("levels up based on XP thresholds", () => {
    const result = awardCreativeXP(db, { userId: "creator1", federationTier: "regional", xpAmount: 5000 });
    assert.ok(result.level > 1);
  });

  it("completes creative quest — XP and badge only, no coins", () => {
    const result = completeCreativeQuest(db, {
      userId: "creator1", questId: "first_artifact", federationTier: "regional",
    });
    assert.equal(result.ok, true);
    assert.equal(result.xpAwarded, 75);
    assert.equal(result.badgeAwarded, "regional_artist");
    assert.equal(result.coinAwarded, undefined); // no coins!
  });

  it("rejects duplicate quest completion", () => {
    completeCreativeQuest(db, { userId: "creator1", questId: "first_artifact", federationTier: "regional" });
    const dup = completeCreativeQuest(db, { userId: "creator1", questId: "first_artifact", federationTier: "regional" });
    assert.equal(dup.ok, false);
    assert.equal(dup.error, "quest_already_completed");
  });

  it("gets creative XP", () => {
    awardCreativeXP(db, { userId: "creator1", federationTier: "regional", xpAmount: 500 });
    const result = getCreativeXP(db, { userId: "creator1", federationTier: "regional" });
    assert.equal(result.ok, true);
    assert.equal(result.totalXP, 500);
  });

  it("gets quest completions", () => {
    completeCreativeQuest(db, { userId: "creator1", questId: "first_artifact", federationTier: "regional" });
    const result = getCreativeQuestCompletions(db, { userId: "creator1" });
    assert.equal(result.ok, true);
    assert.equal(result.count, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ARTIFACT LIFECYCLE TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Artifact Lifecycle", () => {
  if (!Database) return;

  let db, beat;
  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
    beat = publishTestBeat(db);
  });

  it("pauses artifact listing", () => {
    const result = pauseArtifact(db, { artifactId: beat.artifact.id, creatorId: "creator1" });
    assert.equal(result.ok, true);
    assert.equal(result.status, "paused");
  });

  it("resumes paused artifact", () => {
    pauseArtifact(db, { artifactId: beat.artifact.id, creatorId: "creator1" });
    const result = resumeArtifact(db, { artifactId: beat.artifact.id, creatorId: "creator1" });
    assert.equal(result.ok, true);
    assert.equal(result.status, "active");
  });

  it("delists artifact", () => {
    const result = delistArtifact(db, { artifactId: beat.artifact.id, creatorId: "creator1" });
    assert.equal(result.ok, true);
    assert.equal(result.status, "delisted");
  });

  it("rejects purchase of paused artifact", () => {
    pauseArtifact(db, { artifactId: beat.artifact.id, creatorId: "creator1" });
    const result = purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
    assert.equal(result.ok, false);
    assert.equal(result.error, "artifact_not_found_or_inactive");
  });

  it("updates price", () => {
    const result = updateArtifactPrice(db, { artifactId: beat.artifact.id, creatorId: "creator1", newPrice: 75 });
    assert.equal(result.ok, true);
    assert.equal(result.oldPrice, 50);
    assert.equal(result.newPrice, 75);
  });

  it("rejects non-owner actions", () => {
    assert.equal(pauseArtifact(db, { artifactId: beat.artifact.id, creatorId: "buyer1" }).ok, false);
    assert.equal(delistArtifact(db, { artifactId: beat.artifact.id, creatorId: "buyer1" }).ok, false);
    assert.equal(updateArtifactPrice(db, { artifactId: beat.artifact.id, creatorId: "buyer1", newPrice: 10 }).ok, false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DERIVATIVE TREE TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Derivative Tree", () => {
  if (!Database) return;

  let db, beat;
  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
    beat = publishTestBeat(db);

    // Grant license for derivative
    db.prepare(`INSERT INTO creative_usage_licenses (id, artifact_id, licensee_id, license_type, status, purchase_price)
      VALUES ('lic_tree', ?, 'creator2', 'standard', 'active', 50)`).run(beat.artifact.id);
  });

  it("returns empty tree for original work", () => {
    const tree = getDerivativeTree(db, beat.artifact.id);
    assert.equal(tree.ok, true);
    assert.equal(tree.ancestors.length, 0);
    assert.equal(tree.descendants.length, 0);
  });

  it("shows ancestor and descendant relationships", () => {
    const deriv = publishDerivativeArtifact(db, {
      creatorId: "creator2",
      artifact: {
        type: "music_track", title: "Child Track",
        description: "A derivative track that should show up in the parent's descendant tree",
        filePath: "/child.mp3", fileSize: 1024, fileHash: "child_tree_hash", price: 50,
      },
      parentDeclarations: [{ artifactId: beat.artifact.id, derivativeType: "song_over_beat" }],
    });

    // Check parent's tree — should have 1 descendant
    const parentTree = getDerivativeTree(db, beat.artifact.id);
    assert.equal(parentTree.descendants.length, 1);
    assert.equal(parentTree.descendants[0].creatorId, "creator2");

    // Check child's tree — should have 1 ancestor
    const childTree = getDerivativeTree(db, deriv.artifact.id);
    assert.equal(childTree.ancestors.length, 1);
    assert.equal(childTree.ancestors[0].creatorId, "creator1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LICENSE MANAGEMENT TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("License Management", () => {
  if (!Database) return;

  let db, beat;
  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
    beat = publishTestBeat(db);
    purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
  });

  it("lists licenses for an artifact", () => {
    const result = getArtifactLicenses(db, beat.artifact.id);
    assert.equal(result.ok, true);
    assert.equal(result.licenses.length, 1);
  });

  it("lists licenses for a user", () => {
    const result = getUserLicenses(db, "buyer1");
    assert.equal(result.ok, true);
    assert.equal(result.licenses.length, 1);
    assert.equal(result.licenses[0].title, "Lagos Sunset Beat");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CASCADE EARNINGS TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Cascade Earnings", () => {
  if (!Database) return;

  let db, beat;
  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
    beat = publishTestBeat(db);

    // Setup derivative chain: beat -> song -> remix
    db.prepare(`INSERT INTO creative_usage_licenses (id, artifact_id, licensee_id, license_type, status, purchase_price)
      VALUES ('lic_earn', ?, 'creator2', 'standard', 'active', 50)`).run(beat.artifact.id);

    publishDerivativeArtifact(db, {
      creatorId: "creator2",
      artifact: {
        type: "music_track", title: "Song Over Beat",
        description: "A song built over the Lagos Sunset Beat that will trigger cascade earnings when purchased",
        filePath: "/song.mp3", fileSize: 1024, fileHash: "earn_song_hash", price: 100,
      },
      parentDeclarations: [{ artifactId: beat.artifact.id, derivativeType: "song_over_beat" }],
    });
  });

  it("tracks cascade earnings per artifact", () => {
    // Get the derivative
    const derivatives = searchArtifacts(db, { creatorId: "creator2" });
    const derivId = derivatives.items[0].id;

    // Purchase the derivative to trigger cascade
    purchaseArtifact(db, { buyerId: "buyer2", artifactId: derivId });

    // Check beat maker's cascade earnings
    const earnings = getArtifactCascadeEarnings(db, beat.artifact.id);
    assert.equal(earnings.ok, true);
    assert.ok(earnings.totalEarned > 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REVENUE BREAKDOWN VALIDATION (matches spec example)
// ═══════════════════════════════════════════════════════════════════════════

describe("Revenue Breakdown — Spec Validation", () => {
  it("fee math: 50 CC beat sale", () => {
    const price = 50;
    const platformFee = Math.round(price * 0.0146 * 100) / 100;
    const marketplaceFee = Math.round(price * 0.04 * 100) / 100;
    const totalFees = Math.round((platformFee + marketplaceFee) * 100) / 100;
    const toCreator = Math.round((price - totalFees) * 100) / 100;

    assert.equal(platformFee, 0.73);
    assert.equal(marketplaceFee, 2);
    assert.equal(totalFees, 2.73);
    assert.equal(toCreator, 47.27);
  });

  it("cascade math: gen0=21%, gen1=10.5%, gen2=5.25%", () => {
    const gen0 = 0.21;
    const gen1 = gen0 / 2;
    const gen2 = gen1 / 2;

    assert.equal(gen0, 0.21);
    assert.equal(gen1, 0.105);
    assert.equal(gen2, 0.0525);
  });

  it("royalty floor reached at generation ~8", () => {
    const floor = CREATIVE_MARKETPLACE.ROYALTY_FLOOR;
    let rate = CREATIVE_MARKETPLACE.INITIAL_ROYALTY_RATE;
    let generation = 0;

    while (rate / 2 > floor) {
      rate = rate / 2;
      generation++;
    }

    // At this generation, the next halving would go below floor
    assert.ok(generation >= 7);
    assert.ok(rate > floor);
    assert.ok(rate / 2 <= floor);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LEDGER CONSERVATION — purchaseArtifact (money-printing / peg guard)
// Pins the fix for the platform-intermediated topology bug: the creator's
// earnings must be VISIBLE in getBalance() (were excluded by
// CREDIT_ROW_PREDICATE because the credit row carried from=PLATFORM +
// type=MARKETPLACE_PURCHASE), and buyer's loss must equal the sum of every
// other party's gain to the penny (no CC minted or destroyed).
// ═══════════════════════════════════════════════════════════════════════════

describe("Ledger conservation — purchaseArtifact", () => {
  if (!Database) return;
  let db;
  const r2 = (n) => Math.round(n * 100) / 100;
  beforeEach(() => { db = createTestDb(); seedUsers(db); });

  it("a normal (non-derivative) sale conserves and pays the creator VISIBLY", () => {
    const beat = publishTestBeat(db); // creator1, price 50, standard license
    assert.ok(beat.ok, JSON.stringify(beat));

    const bal = () => ({
      buyer: getBalance(db, "buyer1").balance,
      creator: getBalance(db, "creator1").balance,
      platform: getBalance(db, PLATFORM_ACCOUNT_ID).balance,
    });
    const before = bal();
    const res = purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
    assert.ok(res.ok, JSON.stringify(res));
    const after = bal();

    // price 50 → fees 2.73 (1.46% platform + 4% marketplace), creatorEarnings 47.27
    assert.equal(r2(after.buyer - before.buyer), -50, "buyer pays exactly the price");
    assert.equal(r2(after.creator - before.creator), 47.27, "creator earnings VISIBLE in their balance");
    assert.equal(r2(after.platform - before.platform), 2.73, "platform nets exactly the 5.46% fee");
    // Conservation: buyer's loss == everyone else's gain, to the penny.
    assert.equal(
      r2(before.buyer - after.buyer),
      r2((after.creator - before.creator) + (after.platform - before.platform)),
      "no CC minted or destroyed"
    );
  });
});
