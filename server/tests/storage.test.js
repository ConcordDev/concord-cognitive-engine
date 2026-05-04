/**
 * Single-Origin Storage Model Test Suite — v1.0
 *
 * Tests:
 *   - Storage invariant constants
 *   - Artifact vault (store, dedup, reference counting, cleanup)
 *   - Download tracking (record, history, redownload)
 *   - CRI cache (cache, serve, evict, stats)
 *   - Regional download stats
 *   - Storage economics (savings calculation)
 *   - Constitutional invariants (one copy, no user copies, linear growth)
 *
 * Run: node --test server/tests/storage.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  STORAGE_INVARIANT, ARTIFACT_STORAGE, DOWNLOAD_FLOW,
  STORAGE_ECONOMICS, VAULT_REFERENCE_SYSTEM, BANDWIDTH_MANAGEMENT,
  CRI_CACHE, STORAGE_CONSTANTS,
} from "../lib/storage-constants.js";

import {
  storeInVault, getVaultEntry, incrementVaultRef, decrementVaultRef,
  cleanupUnreferencedArtifacts, getVaultStats,
  recordDownload, getUserDownloads, getArtifactDownloadCount, hasUserDownloaded,
  cacheInCRI, recordCRIServe, evictFromCRI, getCRICacheContents,
  getCRICacheStats, evictExpiredCRIEntries,
  getRegionalStats, getTopRegionalArtifacts,
  calculateStorageSavings,
} from "../economy/storage.js";

// ── In-Memory SQLite Helper ─────────────────────────────────────────

let Database;
try {
  Database = (await import("better-sqlite3")).default;
} catch {
  // skip DB tests if sqlite not available
}

function createTestDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE artifact_vault (
      hash TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      original_size INTEGER NOT NULL,
      compressed_size INTEGER NOT NULL,
      compression_type TEXT NOT NULL DEFAULT 'zstd',
      mime_type TEXT NOT NULL,
      reference_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_referenced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_vault_refcount ON artifact_vault(reference_count);
    CREATE INDEX idx_vault_last_ref ON artifact_vault(last_referenced_at);

    CREATE TABLE download_log (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      vault_hash TEXT,
      downloaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      file_size INTEGER,
      transfer_time_ms INTEGER
    );

    CREATE INDEX idx_downloads_artifact ON download_log(artifact_id);
    CREATE INDEX idx_downloads_user ON download_log(user_id);
    CREATE INDEX idx_downloads_time ON download_log(downloaded_at);

    CREATE TABLE cri_cache (
      cri_id TEXT NOT NULL,
      vault_hash TEXT NOT NULL,
      cached_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_served TEXT,
      serve_count INTEGER DEFAULT 0,
      PRIMARY KEY (cri_id, vault_hash)
    );

    CREATE INDEX idx_cri_cache_served ON cri_cache(last_served);

    CREATE TABLE regional_download_stats (
      artifact_id TEXT NOT NULL,
      regional TEXT NOT NULL,
      download_count INTEGER DEFAULT 0,
      last_downloaded TEXT,
      PRIMARY KEY (artifact_id, regional)
    );
  `);

  return db;
}

// ═════════════════════════════════════════════════════════════════════
// 1. Storage Invariant Constants
// ═════════════════════════════════════════════════════════════════════

describe("Storage Invariant Constants", () => {
  it("growth model is linear with creators not buyers", () => {
    assert.equal(STORAGE_INVARIANT.growthModel, "linear_with_creators_not_buyers");
  });

  it("concord stores original artifacts, not per-user copies", () => {
    assert.ok(STORAGE_INVARIANT.concordStores.includes("one_original_artifact_per_upload"));
    assert.ok(STORAGE_INVARIANT.concordNeverStores.includes("per_user_copies"));
    assert.ok(STORAGE_INVARIANT.concordNeverStores.includes("cached_duplicates"));
    assert.ok(STORAGE_INVARIANT.concordNeverStores.includes("cdn_edge_copies"));
  });

  it("vault is flat hash-addressed", () => {
    assert.equal(ARTIFACT_STORAGE.vault.structure.keyType, "sha256_hash");
    assert.equal(ARTIFACT_STORAGE.vault.structure.organization, "flat_hash_addressed");
  });

  it("vault is reference counted", () => {
    assert.equal(ARTIFACT_STORAGE.vault.retention.policy, "reference_counted");
  });

  it("vault has 2 total copies (primary + backup)", () => {
    assert.equal(ARTIFACT_STORAGE.vault.redundancy.totalCopies, 2);
  });

  it("upload dedup uses sha256", () => {
    assert.equal(ARTIFACT_STORAGE.upload.dedup.method, "sha256_content_hash");
    assert.equal(ARTIFACT_STORAGE.upload.dedup.onDuplicate, "reference_existing_artifact");
  });

  it("redownload has no limits — bandwidth only", () => {
    assert.equal(DOWNLOAD_FLOW.redownload.limits, null);
    assert.equal(DOWNLOAD_FLOW.redownload.cost, "bandwidth_only");
    assert.equal(DOWNLOAD_FLOW.redownload.storageCost, "zero");
  });

  it("concord saves 87% over traditional storage", () => {
    assert.equal(STORAGE_ECONOMICS.concord.savings, "87% less storage than traditional model");
  });

  it("bandwidth: break-even at 2 listens, 90% savings", () => {
    assert.equal(BANDWIDTH_MANAGEMENT.costStructure.breakEvenListens, 2);
    assert.equal(BANDWIDTH_MANAGEMENT.costStructure.bandwidthSavingsPercent, 90);
  });

  it("CRI cache is disposable and not backed up", () => {
    assert.equal(CRI_CACHE.cachePolicy.disposable, true);
    assert.equal(CRI_CACHE.backup, false);
    assert.equal(CRI_CACHE.purpose, "local_serving_speed_only");
  });

  it("CRI cache excluded from storage metrics", () => {
    assert.equal(CRI_CACHE.metricsExclusion, true);
  });

  it("download model is one-time transfer, not streaming", () => {
    assert.equal(BANDWIDTH_MANAGEMENT.downloadModel.type, "one_time_transfer");
    assert.equal(BANDWIDTH_MANAGEMENT.downloadModel.persistentConnection, false);
  });

  it("has correct storage constants (32GB-heap deployment)", () => {
    assert.equal(STORAGE_CONSTANTS.VAULT_HASH_ALGORITHM, "sha256");
    assert.equal(STORAGE_CONSTANTS.VAULT_CLEANUP_TICK, 1000);
    assert.equal(STORAGE_CONSTANTS.VAULT_GRACE_PERIOD_DAYS, 30);
    // Concurrent downloads cap was bumped 5 → 25 for multi-tenant deployments.
    // Override via CONCORD_DOWNLOADS_PER_USER.
    assert.equal(STORAGE_CONSTANTS.MAX_CONCURRENT_DOWNLOADS_PER_USER, 25);
    assert.equal(STORAGE_CONSTANTS.UPLOAD_MAX_SIZE_MB, 5000);
    assert.equal(STORAGE_CONSTANTS.LICENSE_RECORD_BYTES, 200);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 2. Artifact Vault
// ═════════════════════════════════════════════════════════════════════

describe("Artifact Vault", () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("stores an artifact and gets hash-addressed path", () => {
    const fileBuffer = Buffer.from("test audio content for vault storage");
    const result = storeInVault(db, { fileBuffer, mimeType: "audio/mp3" });

    assert.equal(result.ok, true);
    assert.ok(result.hash);
    assert.ok(result.path.startsWith(STORAGE_CONSTANTS.VAULT_DIR));
    assert.equal(result.deduplicated, false);
    assert.ok(result.compressedSize > 0);
    assert.ok(result.additionalStorageBytes > 0);
  });

  it("deduplicates identical content", () => {
    const fileBuffer = Buffer.from("duplicate content for dedup test");
    const first = storeInVault(db, { fileBuffer, mimeType: "audio/mp3" });
    const second = storeInVault(db, { fileBuffer, mimeType: "audio/mp3" });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.hash, second.hash);
    assert.equal(second.deduplicated, true);
    assert.equal(second.additionalStorageBytes, 0);
  });

  it("increments reference count on dedup", () => {
    const fileBuffer = Buffer.from("ref count test content");
    storeInVault(db, { fileBuffer, mimeType: "audio/mp3" });
    storeInVault(db, { fileBuffer, mimeType: "audio/mp3" });

    const entry = getVaultEntry(db, storeInVault(db, { fileBuffer, mimeType: "audio/mp3" }).hash);
    assert.equal(entry.referenceCount, 3);
  });

  it("retrieves vault entry by hash", () => {
    const fileBuffer = Buffer.from("vault lookup test content");
    const stored = storeInVault(db, { fileBuffer, mimeType: "image/png" });
    const entry = getVaultEntry(db, stored.hash);

    assert.ok(entry);
    assert.equal(entry.hash, stored.hash);
    assert.equal(entry.mimeType, "image/png");
    assert.equal(entry.referenceCount, 1);
    assert.equal(entry.originalSize, fileBuffer.length);
  });

  it("returns null for unknown hash", () => {
    const entry = getVaultEntry(db, "nonexistent_hash");
    assert.equal(entry, null);
  });

  it("increments and decrements reference counts", () => {
    const fileBuffer = Buffer.from("ref test");
    const stored = storeInVault(db, { fileBuffer, mimeType: "text/plain" });

    incrementVaultRef(db, stored.hash);
    let entry = getVaultEntry(db, stored.hash);
    assert.equal(entry.referenceCount, 2);

    decrementVaultRef(db, stored.hash);
    entry = getVaultEntry(db, stored.hash);
    assert.equal(entry.referenceCount, 1);
  });

  it("rejects missing file buffer", () => {
    const result = storeInVault(db, { mimeType: "audio/mp3" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_required_fields");
  });

  it("rejects missing mime type", () => {
    const result = storeInVault(db, { fileBuffer: Buffer.from("data") });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_required_fields");
  });

  it("gets vault statistics", () => {
    storeInVault(db, { fileBuffer: Buffer.from("stats test 1"), mimeType: "audio/mp3" });
    storeInVault(db, { fileBuffer: Buffer.from("stats test 2"), mimeType: "image/png" });

    const stats = getVaultStats(db);
    assert.equal(stats.ok, true);
    assert.equal(stats.totalArtifacts, 2);
    assert.ok(stats.totalOriginalBytes > 0);
    assert.ok(stats.totalCompressedBytes > 0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 3. Vault Cleanup
// ═════════════════════════════════════════════════════════════════════

describe("Vault Cleanup", () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("cleans up unreferenced artifacts past grace period", () => {
    const fileBuffer = Buffer.from("cleanup test content");
    const stored = storeInVault(db, { fileBuffer, mimeType: "audio/mp3" });

    // Decrement to 0 and backdate
    decrementVaultRef(db, stored.hash);
    db.prepare(
      "UPDATE artifact_vault SET last_referenced_at = datetime('now', '-60 days') WHERE hash = ?"
    ).run(stored.hash);

    const result = cleanupUnreferencedArtifacts(db);
    assert.equal(result.ok, true);
    assert.equal(result.cleaned, 1);

    const entry = getVaultEntry(db, stored.hash);
    assert.equal(entry, null);
  });

  it("does NOT clean up recently unreferenced artifacts (grace period)", () => {
    const fileBuffer = Buffer.from("grace period test");
    const stored = storeInVault(db, { fileBuffer, mimeType: "audio/mp3" });

    // Decrement to 0 but DON'T backdate
    decrementVaultRef(db, stored.hash);

    const result = cleanupUnreferencedArtifacts(db);
    assert.equal(result.cleaned, 0);

    const entry = getVaultEntry(db, stored.hash);
    assert.ok(entry); // still exists
  });

  it("does NOT clean up referenced artifacts", () => {
    const fileBuffer = Buffer.from("referenced artifact test");
    storeInVault(db, { fileBuffer, mimeType: "audio/mp3" });

    const result = cleanupUnreferencedArtifacts(db);
    assert.equal(result.cleaned, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 4. Download Tracking
// ═════════════════════════════════════════════════════════════════════

describe("Download Tracking", () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("records a download", () => {
    const result = recordDownload(db, {
      artifactId: "art_001",
      userId: "user1",
      vaultHash: "abc123",
      fileSize: 1000000,
      transferTimeMs: 500,
    });

    assert.equal(result.ok, true);
    assert.ok(result.downloadId);
    assert.ok(result.downloadedAt);
  });

  it("gets user download history", () => {
    recordDownload(db, { artifactId: "art_001", userId: "user1" });
    recordDownload(db, { artifactId: "art_002", userId: "user1" });

    const history = getUserDownloads(db, "user1");
    assert.equal(history.ok, true);
    assert.equal(history.downloads.length, 2);
  });

  it("gets artifact download count", () => {
    recordDownload(db, { artifactId: "art_001", userId: "user1" });
    recordDownload(db, { artifactId: "art_001", userId: "user2" });
    recordDownload(db, { artifactId: "art_001", userId: "user3" });

    const count = getArtifactDownloadCount(db, "art_001");
    assert.equal(count, 3);
  });

  it("checks if user has downloaded", () => {
    recordDownload(db, { artifactId: "art_001", userId: "user1" });

    assert.equal(hasUserDownloaded(db, "art_001", "user1"), true);
    assert.equal(hasUserDownloaded(db, "art_001", "user2"), false);
  });

  it("redownload is unlimited", () => {
    recordDownload(db, { artifactId: "art_001", userId: "user1" });
    recordDownload(db, { artifactId: "art_001", userId: "user1" });
    recordDownload(db, { artifactId: "art_001", userId: "user1" });

    // No limit — all three recorded
    const history = getUserDownloads(db, "user1");
    assert.equal(history.downloads.length, 3);
  });

  it("rejects missing required fields", () => {
    const result = recordDownload(db, {});
    assert.equal(result.ok, false);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 5. CRI Cache
// ═════════════════════════════════════════════════════════════════════

describe("CRI Cache", () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("caches an artifact in a CRI", () => {
    const result = cacheInCRI(db, { criId: "cri_west", vaultHash: "abc123" });
    assert.equal(result.ok, true);
    assert.equal(result.criId, "cri_west");
  });

  it("records CRI serves", () => {
    cacheInCRI(db, { criId: "cri_west", vaultHash: "abc123" });
    recordCRIServe(db, { criId: "cri_west", vaultHash: "abc123" });
    recordCRIServe(db, { criId: "cri_west", vaultHash: "abc123" });

    const contents = getCRICacheContents(db, "cri_west");
    assert.equal(contents.entries[0].serveCount, 2);
  });

  it("evicts an entry from CRI", () => {
    cacheInCRI(db, { criId: "cri_west", vaultHash: "abc123" });
    const result = evictFromCRI(db, { criId: "cri_west", vaultHash: "abc123" });
    assert.equal(result.ok, true);
    assert.equal(result.evicted, true);

    const contents = getCRICacheContents(db, "cri_west");
    assert.equal(contents.entries.length, 0);
  });

  it("gets CRI cache stats", () => {
    cacheInCRI(db, { criId: "cri_west", vaultHash: "abc123" });
    cacheInCRI(db, { criId: "cri_west", vaultHash: "def456" });
    recordCRIServe(db, { criId: "cri_west", vaultHash: "abc123" });

    const stats = getCRICacheStats(db, "cri_west");
    assert.equal(stats.ok, true);
    assert.equal(stats.entries, 2);
    assert.equal(stats.totalServes, 1);
    assert.equal(stats.maxSizeGB, 100);
    assert.equal(stats.evictionPolicy, "lru");
    assert.equal(stats.ttlHours, 168);
  });

  it("evicts expired entries", () => {
    cacheInCRI(db, { criId: "cri_west", vaultHash: "abc123" });

    // Backdate the cache entry beyond TTL
    db.prepare(
      "UPDATE cri_cache SET cached_at = datetime('now', '-200 hours') WHERE cri_id = ? AND vault_hash = ?"
    ).run("cri_west", "abc123");

    const result = evictExpiredCRIEntries(db, "cri_west");
    assert.equal(result.ok, true);
    assert.equal(result.evicted, 1);
  });

  it("CRI cache is disposable — eviction doesn't affect vault", () => {
    // Store in vault
    const fileBuffer = Buffer.from("cri disposable test");
    const stored = storeInVault(db, { fileBuffer, mimeType: "audio/mp3" });

    // Cache in CRI then evict
    cacheInCRI(db, { criId: "cri_west", vaultHash: stored.hash });
    evictFromCRI(db, { criId: "cri_west", vaultHash: stored.hash });

    // Vault entry still exists
    const entry = getVaultEntry(db, stored.hash);
    assert.ok(entry);
    assert.equal(entry.referenceCount, 1);
  });

  it("rejects missing fields", () => {
    const result = cacheInCRI(db, {});
    assert.equal(result.ok, false);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 6. Regional Download Stats
// ═════════════════════════════════════════════════════════════════════

describe("Regional Download Stats", () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("tracks regional downloads", () => {
    recordDownload(db, { artifactId: "art_001", userId: "user1", vaultHash: "abc" });
    recordDownload(db, { artifactId: "art_001", userId: "user2", vaultHash: "abc" });

    const stats = getRegionalStats(db, "art_001");
    assert.equal(stats.ok, true);
    assert.ok(stats.regions.length >= 1);
    assert.ok(stats.regions[0].downloadCount >= 1);
  });

  it("gets top artifacts for a region", () => {
    recordDownload(db, { artifactId: "art_001", userId: "user1", vaultHash: "abc" });
    recordDownload(db, { artifactId: "art_001", userId: "user2", vaultHash: "abc" });
    recordDownload(db, { artifactId: "art_002", userId: "user1", vaultHash: "def" });

    const top = getTopRegionalArtifacts(db, "global");
    assert.equal(top.ok, true);
    assert.ok(top.artifacts.length >= 1);
    // art_001 has 2 downloads, should be first
    assert.equal(top.artifacts[0].artifactId, "art_001");
    assert.equal(top.artifacts[0].downloadCount, 2);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 7. Storage Economics
// ═════════════════════════════════════════════════════════════════════

describe("Storage Economics", () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("calculates savings with stored artifacts", () => {
    storeInVault(db, { fileBuffer: Buffer.from("a".repeat(10000)), mimeType: "audio/mp3" });

    const savings = calculateStorageSavings(db);
    assert.equal(savings.ok, true);
    assert.ok(savings.concordBytes > 0);
    assert.ok(savings.totalArtifacts > 0);
  });

  it("savings increase with more references (dedup)", () => {
    const fileBuffer = Buffer.from("b".repeat(10000));
    const stored = storeInVault(db, { fileBuffer, mimeType: "audio/mp3" });

    // Simulate 100 buyers — just increment refs
    for (let i = 0; i < 99; i++) {
      incrementVaultRef(db, stored.hash);
    }

    const savings = calculateStorageSavings(db);
    assert.equal(savings.ok, true);
    assert.equal(savings.totalReferences, 100);
    // Traditional would store 100 copies; Concord stores 1 compressed
    assert.ok(savings.traditionalBytes > savings.concordBytes);
  });

  it("returns zero savings with no artifacts", () => {
    const savings = calculateStorageSavings(db);
    assert.equal(savings.savings, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// 8. Constitutional Invariants
// ═════════════════════════════════════════════════════════════════════

describe("Constitutional Storage Invariants", () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("one copy per artifact — storing same content twice only stores once", () => {
    const content = Buffer.from("constitutional invariant: single copy");
    storeInVault(db, { fileBuffer: content, mimeType: "audio/mp3" });
    storeInVault(db, { fileBuffer: content, mimeType: "audio/mp3" });
    storeInVault(db, { fileBuffer: content, mimeType: "audio/mp3" });

    const stats = getVaultStats(db);
    assert.equal(stats.totalArtifacts, 1); // ONE copy, not three
    assert.equal(stats.totalReferences, 3); // three references
  });

  it("downloads create log entries, NOT file copies", () => {
    const fileBuffer = Buffer.from("download invariant test");
    const stored = storeInVault(db, { fileBuffer, mimeType: "audio/mp3" });

    // 5 different users download
    for (let i = 0; i < 5; i++) {
      recordDownload(db, { artifactId: "art_001", userId: `user_${i}`, vaultHash: stored.hash });
    }

    // Vault still has exactly 1 artifact
    const stats = getVaultStats(db);
    assert.equal(stats.totalArtifacts, 1);

    // Download log has 5 entries (~200 bytes each, not 5 file copies)
    const count = getArtifactDownloadCount(db, "art_001");
    assert.equal(count, 5);
  });

  it("storage grows linearly with creators, not buyers", () => {
    // 3 different creators upload 3 different files
    storeInVault(db, { fileBuffer: Buffer.from("creator 1 content"), mimeType: "audio/mp3" });
    storeInVault(db, { fileBuffer: Buffer.from("creator 2 content"), mimeType: "image/png" });
    storeInVault(db, { fileBuffer: Buffer.from("creator 3 content"), mimeType: "video/mp4" });

    let stats = getVaultStats(db);
    assert.equal(stats.totalArtifacts, 3); // 3 creators = 3 artifacts

    // Now simulate 1000 buyers per artifact (just refs, no storage growth)
    const allEntries = db.prepare("SELECT hash FROM artifact_vault").all();
    for (const entry of allEntries) {
      for (let i = 0; i < 999; i++) {
        incrementVaultRef(db, entry.hash);
      }
    }

    stats = getVaultStats(db);
    assert.equal(stats.totalArtifacts, 3); // STILL 3 artifacts
    assert.equal(stats.totalReferences, 3000); // 3000 refs but 3 stored files
  });

  it("CRI cache does not count as stored copies", () => {
    assert.equal(CRI_CACHE.metricsExclusion, true);
    assert.equal(CRI_CACHE.cachePolicy.disposable, true);
    assert.equal(CRI_CACHE.backup, false);
  });

  it("cleanup respects grace period and reference count", () => {
    const file1 = storeInVault(db, { fileBuffer: Buffer.from("cleanup test 1"), mimeType: "audio/mp3" });
    const file2 = storeInVault(db, { fileBuffer: Buffer.from("cleanup test 2"), mimeType: "audio/mp3" });

    // file1: still referenced (count=1) — should NOT be cleaned
    // file2: zero refs, backdated — should be cleaned
    decrementVaultRef(db, file2.hash);
    db.prepare(
      "UPDATE artifact_vault SET last_referenced_at = datetime('now', '-60 days') WHERE hash = ?"
    ).run(file2.hash);

    const result = cleanupUnreferencedArtifacts(db);
    assert.equal(result.cleaned, 1);

    assert.ok(getVaultEntry(db, file1.hash)); // still exists
    assert.equal(getVaultEntry(db, file2.hash), null); // cleaned up
  });
});
