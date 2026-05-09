/**
 * DTU Integrity Verification
 *
 * Every DTU has a SHA-256 content hash stored at creation.
 * Verification checks:
 * 1. Content hash matches stored hash (no tampering)
 * 2. Layer checksums individually verify
 * 3. Header checksum validates structure
 * 4. Signature chain from canonical to derivatives is intact
 *
 * Uses Node.js built-in crypto module for all hashing and signing.
 */

import { createHash, createHmac, randomUUID } from "crypto";

// Platform signing key (in production, loaded from secure storage / HSM)
const PLATFORM_SIGNING_KEY = "concord-platform-integrity-key-v1";

function nowISO() {
  return new Date().toISOString();
}

/**
 * Initialize the dtu_integrity table in SQLite.
 * Called by migration 025, but safe to call again at boot.
 * @param {import("better-sqlite3").Database} db
 */
export function initIntegrityTable(db) {
  if (!db) return false;

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS dtu_integrity (
        dtu_id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        header_checksum TEXT,
        layer_checksums_json TEXT DEFAULT '{}',
        signature TEXT,
        signed_by TEXT,
        signed_at TEXT,
        verified_at TEXT,
        is_valid INTEGER DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_integrity_hash ON dtu_integrity(content_hash)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_integrity_valid ON dtu_integrity(is_valid)`);
    return true;
  } catch (e) {
    console.error("[DTUIntegrity] Failed to initialize table:", e.message);
    return false;
  }
}

/**
 * Create the integrity verification system.
 *
 * @param {import("better-sqlite3").Database} db - SQLite database
 * @param {object} [opts]
 * @param {function} [opts.log] - Structured logger function
 * @param {object} [opts.dtuStore] - DTU store for looking up DTUs during chain verification
 * @returns {object} Integrity system API
 */
export function createIntegritySystem(db, opts = {}) {
  const log = opts.log || (() => {});
  const dtuStore = opts.dtuStore || null;
  let _stmts = null;

  function stmts() {
    if (_stmts) return _stmts;
    if (!db) return null;
    try {
      _stmts = {
        get: db.prepare("SELECT * FROM dtu_integrity WHERE dtu_id = ?"),
        getByHash: db.prepare("SELECT * FROM dtu_integrity WHERE content_hash = ?"),
        upsert: db.prepare(`
          INSERT OR REPLACE INTO dtu_integrity
            (dtu_id, content_hash, header_checksum, layer_checksums_json, signature, signed_by, signed_at, verified_at, is_valid, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        updateVerification: db.prepare(
          "UPDATE dtu_integrity SET verified_at = ?, is_valid = ?, updated_at = ? WHERE dtu_id = ?"
        ),
        delete: db.prepare("DELETE FROM dtu_integrity WHERE dtu_id = ?"),
        invalidCount: db.prepare("SELECT COUNT(*) as count FROM dtu_integrity WHERE is_valid = 0"),
        allInvalid: db.prepare("SELECT * FROM dtu_integrity WHERE is_valid = 0"),
        count: db.prepare("SELECT COUNT(*) as count FROM dtu_integrity"),
      };
      return _stmts;
    } catch (e) {
      log("error", "integrity_prepare_failed", { error: e.message });
      return null;
    }
  }

  /**
   * Compute SHA-256 hash of content.
   * @param {string|Buffer|object} content
   * @returns {string} Hex-encoded SHA-256
   */
  function hashContent(content) {
    const data = typeof content === "object" && !Buffer.isBuffer(content)
      ? JSON.stringify(content)
      : content;
    return createHash("sha256").update(data).digest("hex");
  }

  /**
   * Compute per-layer checksums for a DTU.
   * @param {object} dtu
   * @returns {Record<string, string>}
   */
  function computeLayerChecksums(dtu) {
    const checksums = {};

    if (dtu.content) {
      checksums.content = hashContent(dtu.content);
    }
    if (dtu.summary) {
      checksums.summary = hashContent(dtu.summary);
    }
    if (dtu.humanLayer) {
      checksums.humanLayer = hashContent(
        typeof dtu.humanLayer === "object" ? JSON.stringify(dtu.humanLayer) : dtu.humanLayer
      );
    }
    if (dtu.coreLayer) {
      checksums.coreLayer = hashContent(
        typeof dtu.coreLayer === "object" ? JSON.stringify(dtu.coreLayer) : dtu.coreLayer
      );
    }
    if (dtu.machineLayer) {
      checksums.machineLayer = hashContent(
        typeof dtu.machineLayer === "object" ? JSON.stringify(dtu.machineLayer) : dtu.machineLayer
      );
    }
    if (dtu.metadata) {
      checksums.metadata = hashContent(JSON.stringify(dtu.metadata));
    }
    if (dtu.tags) {
      checksums.tags = hashContent(JSON.stringify(dtu.tags));
    }

    return checksums;
  }

  /**
   * Compute a header checksum from DTU structural fields.
   * @param {object} dtu
   * @returns {string}
   */
  function computeHeaderChecksum(dtu) {
    const headerData = JSON.stringify({
      id: dtu.id,
      tier: dtu.tier,
      scope: dtu.scope,
      createdAt: dtu.createdAt || dtu.timestamp,
    });
    return hashContent(headerData);
  }

  /**
   * Generate an HMAC signature for a DTU.
   * @param {string} contentHash
   * @param {string} [key]
   * @returns {string}
   */
  function generateSignature(contentHash, key) {
    const signingKey = key || PLATFORM_SIGNING_KEY;
    return createHmac("sha256", signingKey).update(contentHash).digest("hex");
  }

  const system = {
    /**
     * Generate a full integrity envelope for a DTU and store it.
     * Call this at DTU creation or update time.
     *
     * @param {object} dtu - The DTU object
     * @returns {object} The integrity envelope
     */
    generateIntegrity(dtu) {
      if (!dtu || !dtu.id) {
        return { ok: false, error: "missing_dtu_or_id" };
      }

      const contentHash = hashContent(dtu.content || "");
      const headerChecksum = computeHeaderChecksum(dtu);
      const layerChecksums = computeLayerChecksums(dtu);
      const signature = generateSignature(contentHash);
      const now = nowISO();

      const envelope = {
        dtuId: dtu.id,
        contentHash,
        headerChecksum,
        layerChecksums,
        signature,
        signedBy: "platform",
        signedAt: now,
        isValid: true,
        createdAt: now,
        updatedAt: now,
      };

      // Persist to database
      const s = stmts();
      if (s) {
        try {
          s.upsert.run(
            dtu.id,
            contentHash,
            headerChecksum,
            JSON.stringify(layerChecksums),
            signature,
            "platform",
            now,
            now,
            1,
            now,
            now
          );
        } catch (e) {
          log("error", "integrity_generate_persist_failed", { dtuId: dtu.id, error: e.message });
        }
      }

      log("info", "integrity_generated", { dtuId: dtu.id, contentHash });

      return { ok: true, envelope };
    },

    /**
     * Verify a DTU's integrity against stored integrity data.
     *
     * @param {object} dtu - The DTU to verify
     * @returns {object} Verification result
     */
    verify(dtu) {
      if (!dtu || !dtu.id) {
        return { ok: false, error: "missing_dtu_or_id", isValid: false };
      }

      const s = stmts();
      if (!s) {
        return { ok: false, error: "no_database", isValid: false };
      }

      try {
        const stored = s.get.get(dtu.id);
        if (!stored) {
          return {
            ok: true,
            isValid: false,
            reason: "no_integrity_record",
            dtuId: dtu.id,
          };
        }

        // Recompute current values
        const currentContentHash = hashContent(dtu.content || "");
        const currentHeaderChecksum = computeHeaderChecksum(dtu);
        const currentLayerChecksums = computeLayerChecksums(dtu);

        // Compare content hash
        const contentMatch = currentContentHash === stored.content_hash;

        // Compare header
        const headerMatch = currentHeaderChecksum === stored.header_checksum;

        // Compare layer checksums
        const storedLayerChecksums = JSON.parse(stored.layer_checksums_json || "{}");
        const layerResults = {};
        let allLayersMatch = true;

        for (const [layer, hash] of Object.entries(storedLayerChecksums)) {
          const currentHash = currentLayerChecksums[layer];
          const match = currentHash === hash;
          layerResults[layer] = { stored: hash, current: currentHash, match };
          if (!match) allLayersMatch = false;
        }

        // Verify signature
        const expectedSignature = generateSignature(stored.content_hash);
        const signatureValid = stored.signature === expectedSignature;

        // Overall validity
        const isValid = contentMatch && headerMatch && allLayersMatch && signatureValid;

        // Update verification status in DB
        const now = nowISO();
        s.updateVerification.run(now, isValid ? 1 : 0, now, dtu.id);

        const result = {
          ok: true,
          dtuId: dtu.id,
          isValid,
          contentHash: currentContentHash,
          contentMatch,
          headerMatch,
          layerResults,
          allLayersMatch,
          signatureValid,
          verifiedAt: now,
        };

        if (!isValid) {
          log("warn", "integrity_verification_failed", {
            dtuId: dtu.id,
            contentMatch,
            headerMatch,
            allLayersMatch,
            signatureValid,
          });
        } else {
          log("info", "integrity_verified", { dtuId: dtu.id });
        }

        return result;
      } catch (e) {
        log("error", "integrity_verify_failed", { dtuId: dtu.id, error: e.message });
        return { ok: false, error: e.message, isValid: false };
      }
    },

    /**
     * Verify an entire chain from canonical through derivatives.
     * Walks the DTU relationship tree and verifies each node.
     *
     * @param {string} dtuId - The root DTU ID to start verification from
     * @returns {object} Chain verification result
     */
    verifyChain(dtuId) {
      if (!dtuStore) {
        return { ok: false, error: "no_dtu_store_configured" };
      }

      const visited = new Set();
      const results = [];
      const queue = [dtuId];

      while (queue.length > 0) {
        const currentId = queue.shift();
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        const dtu = dtuStore.get(currentId);
        if (!dtu) {
          results.push({
            dtuId: currentId,
            isValid: false,
            reason: "dtu_not_found",
          });
          continue;
        }

        const verification = system.verify(dtu);
        results.push({
          dtuId: currentId,
          isValid: verification.isValid,
          contentHash: verification.contentHash,
          contentMatch: verification.contentMatch,
          signatureValid: verification.signatureValid,
        });

        // Add children/derivatives to the queue
        if (dtu.childIds && Array.isArray(dtu.childIds)) {
          for (const childId of dtu.childIds) {
            if (!visited.has(childId)) {
              queue.push(childId);
            }
          }
        }
        if (dtu.relatedIds && Array.isArray(dtu.relatedIds)) {
          for (const relatedId of dtu.relatedIds) {
            if (!visited.has(relatedId)) {
              queue.push(relatedId);
            }
          }
        }
      }

      const allValid = results.every(r => r.isValid);
      const invalidCount = results.filter(r => !r.isValid).length;

      log("info", "integrity_chain_verified", {
        rootDtuId: dtuId,
        nodesChecked: results.length,
        allValid,
        invalidCount,
      });

      return {
        ok: true,
        rootDtuId: dtuId,
        chainValid: allValid,
        nodesChecked: results.length,
        invalidCount,
        results,
      };
    },

    /**
     * Get a full integrity report for a DTU.
     *
     * @param {string} dtuId - DTU ID
     * @returns {object} Integrity report
     */
    getReport(dtuId) {
      const s = stmts();
      if (!s) return { ok: false, error: "no_database" };

      try {
        const stored = s.get.get(dtuId);
        if (!stored) {
          return {
            ok: true,
            dtuId,
            hasIntegrity: false,
            report: null,
          };
        }

        return {
          ok: true,
          dtuId,
          hasIntegrity: true,
          report: {
            contentHash: stored.content_hash,
            headerChecksum: stored.header_checksum,
            layerChecksums: JSON.parse(stored.layer_checksums_json || "{}"),
            signature: stored.signature,
            signedBy: stored.signed_by,
            signedAt: stored.signed_at,
            verifiedAt: stored.verified_at,
            isValid: !!stored.is_valid,
            createdAt: stored.created_at,
            updatedAt: stored.updated_at,
          },
        };
      } catch (e) {
        log("error", "integrity_report_failed", { dtuId, error: e.message });
        return { ok: false, error: e.message };
      }
    },

    /**
     * Sign a DTU with a specific key (for external or user signing).
     *
     * @param {object} dtu - The DTU to sign
     * @param {string} key - Signing key
     * @param {string} [signedBy] - Identity of the signer
     * @returns {object} Signed result
     */
    sign(dtu, key, signedBy = "external") {
      if (!dtu || !dtu.id) {
        return { ok: false, error: "missing_dtu_or_id" };
      }

      const contentHash = hashContent(dtu.content || "");
      const signature = generateSignature(contentHash, key);
      const now = nowISO();

      const s = stmts();
      if (s) {
        try {
          const existing = s.get.get(dtu.id);
          if (existing) {
            // Update existing record with new signature
            s.upsert.run(
              dtu.id,
              existing.content_hash,
              existing.header_checksum,
              existing.layer_checksums_json,
              signature,
              signedBy,
              now,
              existing.verified_at,
              existing.is_valid,
              existing.created_at,
              now
            );
          } else {
            // Generate full integrity and sign
            const headerChecksum = computeHeaderChecksum(dtu);
            const layerChecksums = computeLayerChecksums(dtu);
            s.upsert.run(
              dtu.id,
              contentHash,
              headerChecksum,
              JSON.stringify(layerChecksums),
              signature,
              signedBy,
              now,
              null,
              1,
              now,
              now
            );
          }
        } catch (e) {
          log("error", "integrity_sign_failed", { dtuId: dtu.id, error: e.message });
        }
      }

      return {
        ok: true,
        dtuId: dtu.id,
        contentHash,
        signature,
        signedBy,
        signedAt: now,
      };
    },

    /**
     * Batch verify multiple DTUs.
     *
     * @param {string[]} dtuIds - Array of DTU IDs to verify
     * @returns {object} Batch verification results
     */
    batchVerify(dtuIds) {
      if (!dtuStore) {
        return { ok: false, error: "no_dtu_store_configured" };
      }

      const results = [];
      let validCount = 0;
      let invalidCount = 0;
      let missingCount = 0;

      for (const dtuId of dtuIds) {
        const dtu = dtuStore.get(dtuId);
        if (!dtu) {
          results.push({ dtuId, isValid: false, reason: "dtu_not_found" });
          missingCount++;
          continue;
        }

        const verification = system.verify(dtu);
        results.push({
          dtuId,
          isValid: verification.isValid,
          contentHash: verification.contentHash,
        });

        if (verification.isValid) validCount++;
        else invalidCount++;
      }

      log("info", "integrity_batch_verified", {
        total: dtuIds.length,
        valid: validCount,
        invalid: invalidCount,
        missing: missingCount,
      });

      return {
        ok: true,
        total: dtuIds.length,
        validCount,
        invalidCount,
        missingCount,
        results,
      };
    },

    /**
     * Delete integrity record for a DTU.
     *
     * @param {string} dtuId
     * @returns {boolean}
     */
    deleteIntegrity(dtuId) {
      const s = stmts();
      if (!s) return false;
      try {
        const result = s.delete.run(dtuId);
        return result.changes > 0;
      } catch (e) {
        log("error", "integrity_delete_failed", { dtuId, error: e.message });
        return false;
      }
    },

    /**
     * Get summary statistics about integrity records.
     *
     * @returns {object} Stats
     */
    getStats() {
      const s = stmts();
      if (!s) return { total: 0, invalid: 0 };
      try {
        const total = s.count.get()?.count || 0;
        const invalid = s.invalidCount.get()?.count || 0;
        return { total, valid: total - invalid, invalid };
      } catch (e) {
        return { total: 0, invalid: 0 };
      }
    },

    // Expose utility
    hashContent,
    computeLayerChecksums,
  };

  return system;
}
