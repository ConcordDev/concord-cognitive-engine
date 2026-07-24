/**
 * Institutional (org-scoped) licensing — minimal version, owner-approved.
 *
 * Ground truth (server/economy/creative-marketplace.js + migration 381):
 *   - creative_usage_licenses gains licensee_type ('user'|'org') +
 *     licensee_org_id. Existing rows default licensee_type='user' with no
 *     data migration needed (licensee_id already holds the user id).
 *   - purchaseArtifact() accepts an OPTIONAL { licenseeType:'org',
 *     licenseeOrgId } — the WALLET DEBIT is unchanged (buyerId's own real
 *     wallet still pays, exactly like a normal purchase); the purchasing
 *     user must be a REAL, CURRENT leader/officer of that org (verified
 *     live against server/lib/world-organizations.js); the resulting
 *     license row grants to the org, not just the purchaser.
 *   - hasArtifactAccess() is the extended "does user X have access to
 *     artifact Y" check: true for a direct personal license OR for any
 *     CURRENT member of an org holding an org-scoped license.
 *
 * Run: node --test server/tests/economy/creative-marketplace-org-licensing.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  publishArtifact,
  purchaseArtifact,
  hasArtifactAccess,
  getArtifactLicenses,
  getUserLicenses,
} from "../../economy/creative-marketplace.js";
import { getBalance } from "../../economy/balances.js";
import { PLATFORM_ACCOUNT_ID } from "../../economy/fees.js";
import { createOrganization, joinOrganization, setMemberRole } from "../../lib/world-organizations.js";

// ── In-Memory SQLite Helper (mirrors tests/creative-marketplace.test.js) ────

function createTestDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

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

    CREATE TABLE IF NOT EXISTS fee_distributions (
      id TEXT PRIMARY KEY,
      source_tx_id TEXT NOT NULL,
      total_fee REAL NOT NULL,
      reserves_amount REAL NOT NULL,
      operating_amount REAL NOT NULL,
      payroll_amount REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

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

    -- creative_usage_licenses AS IT EXISTS POST-migration-381 (licensee_type
    -- + licensee_org_id already present, matching a fresh install).
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
      licensee_type TEXT NOT NULL DEFAULT 'user' CHECK (licensee_type IN ('user','org')),
      licensee_org_id TEXT,
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
  `);

  return db;
}

function seedUsers(db, extra = []) {
  const base = [
    ["creator1", "lagos_artist", "artist@lagos.ng"],
    ["buyer1", "fan1", "fan1@test.com"],
    ["buyer2", "fan2", "fan2@test.com"],
    ["officer1", "officer_one", "officer1@test.com"],
    ["member1", "member_one", "member1@test.com"],
    ["outsider1", "outsider_one", "outsider1@test.com"],
  ];
  for (const [id, username, email] of [...base, ...extra]) {
    db.prepare(
      `INSERT INTO users (id, username, email, declared_regional, declared_national) VALUES (?, ?, ?, ?, ?)`
    ).run(id, username, email, "lagos", "nigeria");
  }
  for (const [id] of [...base, ...extra]) {
    db.prepare(
      `INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(`seed_${id}`, "MINT", null, id, 10000, 0, 10000, "complete");
  }
}

function publishTestBeat(db, opts = {}) {
  return publishArtifact(db, {
    creatorId: "creator1",
    type: "beat",
    title: "Lagos Sunset Beat",
    description: "An Afrobeats instrumental with heavy percussion and synth melodies. Perfect for rap or vocals.",
    filePath: "/uploads/beat_org_001.wav",
    fileSize: 50 * 1024 * 1024,
    fileHash: `org_licensing_hash_${Math.random()}`,
    price: 50,
    creative: { genre: "afrobeats", tags: ["afrobeats", "instrumental"] },
    license: { type: "standard" },
    ...opts,
  });
}

/** Build a real org (leader=officer1) with member1 joined as plain 'member'. */
function buildTestOrg() {
  const created = createOrganization({ name: "Test Studio Org", type: "studio", leaderId: "officer1" });
  assert.ok(created.ok, JSON.stringify(created));
  const orgId = created.organization.id;
  const joined = joinOrganization(orgId, "member1", "member");
  assert.ok(joined.ok, JSON.stringify(joined));
  return orgId;
}

// ═══════════════════════════════════════════════════════════════════════════
// (a) Org-scoped purchase debits the purchasing user's real wallet exactly
//     as a normal purchase would — no double-charge, no org wallet invented.
// ═══════════════════════════════════════════════════════════════════════════

describe("Org-scoped purchase — wallet debit is unchanged", () => {
  let db, beat, orgId;
  const r2 = (n) => Math.round(n * 100) / 100;

  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
    beat = publishTestBeat(db);
    orgId = buildTestOrg();
  });

  it("debits officer1's own wallet the exact price, same as a personal purchase", () => {
    const bal = () => ({
      officer: getBalance(db, "officer1").balance,
      creator: getBalance(db, "creator1").balance,
      platform: getBalance(db, PLATFORM_ACCOUNT_ID).balance,
    });
    const before = bal();

    const res = purchaseArtifact(db, {
      buyerId: "officer1", artifactId: beat.artifact.id,
      licenseeType: "org", licenseeOrgId: orgId,
    });
    assert.ok(res.ok, JSON.stringify(res));
    assert.equal(res.licenseeType, "org");
    assert.equal(res.licenseeOrgId, orgId);

    const after = bal();
    // Identical fee math to the plain-purchase test in creative-marketplace.test.js
    assert.equal(r2(after.officer - before.officer), -50, "officer pays exactly the price, once");
    assert.equal(r2(after.creator - before.creator), 47.27, "creator earnings unchanged");
    assert.equal(r2(after.platform - before.platform), 2.73, "platform fee unchanged");

    // Conservation: no CC minted or destroyed, no third wallet involved.
    assert.equal(
      r2(before.officer - after.officer),
      r2((after.creator - before.creator) + (after.platform - before.platform)),
      "no CC minted/destroyed; no org wallet in the loop",
    );
  });

  it("never touches any balance keyed by the org id itself (no org wallet exists)", () => {
    const orgBalanceBefore = getBalance(db, orgId).balance;
    const res = purchaseArtifact(db, {
      buyerId: "officer1", artifactId: beat.artifact.id,
      licenseeType: "org", licenseeOrgId: orgId,
    });
    assert.ok(res.ok, JSON.stringify(res));
    const orgBalanceAfter = getBalance(db, orgId).balance;
    assert.equal(orgBalanceAfter, orgBalanceBefore, "org id has no wallet — balance is untouched (0 before and after)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (b) The resulting license grants access to EVERY real member of the org,
//     not just the purchaser.
// ═══════════════════════════════════════════════════════════════════════════

describe("Org-scoped license — access widens to every real member", () => {
  let db, beat, orgId;

  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
    beat = publishTestBeat(db);
    orgId = buildTestOrg(); // leader/officer1 = leader, member1 = member
  });

  it("grants access to the purchasing officer (leader)", () => {
    purchaseArtifact(db, { buyerId: "officer1", artifactId: beat.artifact.id, licenseeType: "org", licenseeOrgId: orgId });
    const access = hasArtifactAccess(db, { userId: "officer1", artifactId: beat.artifact.id });
    assert.equal(access.hasAccess, true);
  });

  it("grants access to a DIFFERENT plain member who never paid anything", () => {
    purchaseArtifact(db, { buyerId: "officer1", artifactId: beat.artifact.id, licenseeType: "org", licenseeOrgId: orgId });
    const access = hasArtifactAccess(db, { userId: "member1", artifactId: beat.artifact.id });
    assert.equal(access.hasAccess, true, "member1 never paid, but is a real org member");
    assert.equal(access.via, "org");
    assert.equal(access.orgId, orgId);
  });

  it("grants access to a member who joins the org AFTER the purchase (live membership, not a snapshot)", () => {
    purchaseArtifact(db, { buyerId: "officer1", artifactId: beat.artifact.id, licenseeType: "org", licenseeOrgId: orgId });
    joinOrganization(orgId, "buyer2", "member");
    const access = hasArtifactAccess(db, { userId: "buyer2", artifactId: beat.artifact.id });
    assert.equal(access.hasAccess, true, "membership is checked live, not replicated at grant time");
  });

  it("does NOT grant access to someone outside the org entirely", () => {
    purchaseArtifact(db, { buyerId: "officer1", artifactId: beat.artifact.id, licenseeType: "org", licenseeOrgId: orgId });
    const access = hasArtifactAccess(db, { userId: "outsider1", artifactId: beat.artifact.id });
    assert.equal(access.hasAccess, false);
  });

  it("surfaces via getUserLicenses for a member who never purchased anything, tagged accessVia:'org'", () => {
    purchaseArtifact(db, { buyerId: "officer1", artifactId: beat.artifact.id, licenseeType: "org", licenseeOrgId: orgId });
    const result = getUserLicenses(db, "member1");
    assert.equal(result.ok, true);
    assert.equal(result.licenses.length, 1);
    assert.equal(result.licenses[0].accessVia, "org");
    assert.equal(result.licenses[0].orgId, orgId);
    assert.equal(result.licenses[0].purchasedByUserId, "officer1");
  });

  it("creator-side sales view (getArtifactLicenses) honestly labels the org purchase", () => {
    purchaseArtifact(db, { buyerId: "officer1", artifactId: beat.artifact.id, licenseeType: "org", licenseeOrgId: orgId });
    const result = getArtifactLicenses(db, beat.artifact.id);
    assert.equal(result.ok, true);
    assert.equal(result.licenses.length, 1);
    const lic = result.licenses[0];
    assert.equal(lic.licensee_id, "officer1", "the row still records WHO paid");
    assert.equal(lic.licensee_type, "org");
    assert.ok(lic.purchasedOnBehalfOf, "org sale must be distinguishable from a plain individual sale");
    assert.equal(lic.purchasedOnBehalfOf.orgId, orgId);
    assert.equal(lic.purchasedOnBehalfOf.orgName, "Test Studio Org");
    assert.equal(lic.purchasedOnBehalfOf.purchasedByUserId, "officer1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (c) A user who is NOT a (sufficiently-ranked) member of the claimed org
//     cannot make an org-scoped purchase for it — security-relevant.
// ═══════════════════════════════════════════════════════════════════════════

describe("Org-scoped purchase — membership/role is enforced, never trusted from the caller", () => {
  let db, beat, orgId;

  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
    beat = publishTestBeat(db);
    orgId = buildTestOrg();
  });

  it("rejects a purchase claiming an org the buyer is not a member of at all", () => {
    const res = purchaseArtifact(db, {
      buyerId: "outsider1", artifactId: beat.artifact.id,
      licenseeType: "org", licenseeOrgId: orgId,
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, "not_org_member");
  });

  it("rejects a purchase from a real member who only holds the plain 'member' role (not officer/leader)", () => {
    const res = purchaseArtifact(db, {
      buyerId: "member1", artifactId: beat.artifact.id,
      licenseeType: "org", licenseeOrgId: orgId,
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, "insufficient_org_role");
  });

  it("allows the purchase once that same member is promoted to officer", () => {
    const promoted = setMemberRole(orgId, "member1", "officer", "officer1");
    assert.ok(promoted.ok, JSON.stringify(promoted));
    const res = purchaseArtifact(db, {
      buyerId: "member1", artifactId: beat.artifact.id,
      licenseeType: "org", licenseeOrgId: orgId,
    });
    assert.equal(res.ok, true, JSON.stringify(res));
  });

  it("rejects a non-existent org id outright", () => {
    const res = purchaseArtifact(db, {
      buyerId: "officer1", artifactId: beat.artifact.id,
      licenseeType: "org", licenseeOrgId: "org_does_not_exist",
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, "org_not_found");
  });

  it("does NOT debit any wallet or write any license row when membership verification fails", () => {
    const before = getBalance(db, "outsider1").balance;
    purchaseArtifact(db, {
      buyerId: "outsider1", artifactId: beat.artifact.id,
      licenseeType: "org", licenseeOrgId: orgId,
    });
    const after = getBalance(db, "outsider1").balance;
    assert.equal(after, before, "rejected org purchase must not touch the wallet");

    const licenses = getArtifactLicenses(db, beat.artifact.id);
    assert.equal(licenses.licenses.length, 0, "rejected org purchase must not write a license row");
  });

  it("blocks a duplicate org-scoped license at the same tier even from a different officer", () => {
    setMemberRole(orgId, "member1", "officer", "officer1");
    const first = purchaseArtifact(db, {
      buyerId: "officer1", artifactId: beat.artifact.id,
      licenseeType: "org", licenseeOrgId: orgId,
    });
    assert.ok(first.ok, JSON.stringify(first));

    const second = purchaseArtifact(db, {
      buyerId: "member1", artifactId: beat.artifact.id,
      licenseeType: "org", licenseeOrgId: orgId,
    });
    assert.equal(second.ok, false);
    assert.equal(second.error, "org_already_licensed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (d) An existing plain per-user license/purchase is completely unaffected
//     — backward compatibility.
// ═══════════════════════════════════════════════════════════════════════════

describe("Backward compatibility — plain per-user purchases are unaffected", () => {
  let db, beat;
  const r2 = (n) => Math.round(n * 100) / 100;

  beforeEach(() => {
    db = createTestDb();
    seedUsers(db);
    beat = publishTestBeat(db);
  });

  it("a normal purchase (no licenseeType) behaves exactly as before", () => {
    const bal = () => ({
      buyer: getBalance(db, "buyer1").balance,
      creator: getBalance(db, "creator1").balance,
      platform: getBalance(db, PLATFORM_ACCOUNT_ID).balance,
    });
    const before = bal();
    const res = purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
    assert.ok(res.ok, JSON.stringify(res));
    assert.equal(res.licenseeType, "user");
    assert.equal(res.licenseeOrgId, null);

    const after = bal();
    assert.equal(r2(after.buyer - before.buyer), -50);
    assert.equal(r2(after.creator - before.creator), 47.27);
    assert.equal(r2(after.platform - before.platform), 2.73);
  });

  it("the license row defaults licensee_type='user' with licensee_org_id NULL", () => {
    purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
    const result = getArtifactLicenses(db, beat.artifact.id);
    assert.equal(result.licenses.length, 1);
    assert.equal(result.licenses[0].licensee_type, "user");
    assert.equal(result.licenses[0].licensee_org_id, null);
    assert.equal(result.licenses[0].purchasedOnBehalfOf, null, "a plain sale is never rendered as an org sale");
  });

  it("getUserLicenses still returns exactly the buyer's own personal license (shape preserved)", () => {
    purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
    const result = getUserLicenses(db, "buyer1");
    assert.equal(result.ok, true);
    assert.equal(result.licenses.length, 1);
    assert.equal(result.licenses[0].accessVia, "personal");
    assert.equal(result.licenses[0].title, "Lagos Sunset Beat");
  });

  it("hasArtifactAccess is true for the direct buyer via the personal path", () => {
    purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
    const access = hasArtifactAccess(db, { userId: "buyer1", artifactId: beat.artifact.id });
    assert.equal(access.hasAccess, true);
    assert.equal(access.via, "personal");
  });

  it("hasArtifactAccess is false for an unrelated user with no license and no org grant", () => {
    purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
    const access = hasArtifactAccess(db, { userId: "buyer2", artifactId: beat.artifact.id });
    assert.equal(access.hasAccess, false);
  });

  it("double purchase by the same user is still rejected exactly as before", () => {
    purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
    const dup = purchaseArtifact(db, { buyerId: "buyer1", artifactId: beat.artifact.id });
    assert.equal(dup.ok, false);
    assert.equal(dup.error, "already_licensed");
  });
});
