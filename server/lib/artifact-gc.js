// @sync-fs-ok: garbage collector reads/writes from a startup tick, never request-handler
/**
 * Artifact Garbage Collection
 *
 * Finds and deletes orphaned artifact files — those with zero DTU references.
 *
 * Scans the artifact root directory for files matching the hash pattern
 * ({64-char hex}.{ext}), then cross-references against all live DTUs in
 * STATE.dtus and archived DTUs in SQLite. Any file whose hash is not
 * referenced by any DTU is considered orphaned and eligible for deletion.
 *
 * Designed to run on a weekly timer, but can also be invoked on-demand
 * or in dry-run mode for dashboard reporting.
 */

import fs from "fs";
import path from "path";
import logger from "../logger.js";

// 64 hex chars followed by a dot and extension
const HASH_FILE_PATTERN = /^([a-f0-9]{64})\.(.+)$/;

// Weekly interval in milliseconds
const GC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Resolve the artifact root directory from environment or defaults.
 * Mirrors the logic in artifact-store.js.
 */
function resolveArtifactRoot() {
  if (process.env.ARTIFACT_DIR) return process.env.ARTIFACT_DIR;
  if (fs.existsSync("/workspace/concord-data")) return "/workspace/concord-data/artifacts";
  return path.join(process.cwd(), "data", "artifacts");
}

/**
 * Recursively walk a directory and return all file paths.
 * @param {string} dir
 * @returns {string[]}
 */
function walkDir(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkDir(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  } catch (err) {
    logger.warn("artifact-gc", `Failed to read directory ${dir}: ${err.message}`);
  }
  return results;
}

/**
 * Collect all artifact hashes referenced by live DTUs in STATE.dtus.
 * @param {Map} dtus - STATE.dtus Map
 * @returns {Set<string>}
 */
function collectLiveHashes(dtus) {
  const hashes = new Set();
  if (!dtus || typeof dtus.forEach !== "function") return hashes;

  dtus.forEach((dtu) => {
    try {
      // Primary artifact hash
      if (dtu.artifact?.hash) {
        hashes.add(dtu.artifact.hash);
      }
      // Absorbed artifacts (MEGA/HYPER tiers)
      if (Array.isArray(dtu.artifacts?.absorbed)) {
        for (const absorbed of dtu.artifacts.absorbed) {
          if (absorbed?.hash) {
            hashes.add(absorbed.hash);
          }
        }
      }
    } catch (err) {
      // Skip malformed DTU entries
    }
  });

  return hashes;
}

/**
 * Collect all artifact hashes from archived DTUs in SQLite.
 * @param {import("better-sqlite3").Database} db
 * @returns {Set<string>}
 */
function collectArchivedHashes(db) {
  const hashes = new Set();
  if (!db) return hashes;

  try {
    const rows = db.prepare("SELECT data FROM archived_dtus").all();
    for (const row of rows) {
      try {
        const dtu = JSON.parse(row.data);
        if (dtu.artifact?.hash) {
          hashes.add(dtu.artifact.hash);
        }
        if (Array.isArray(dtu.artifacts?.absorbed)) {
          for (const absorbed of dtu.artifacts.absorbed) {
            if (absorbed?.hash) {
              hashes.add(absorbed.hash);
            }
          }
        }
      } catch (parseErr) {
        // Skip unparseable archived DTU rows
      }
    }
  } catch (err) {
    logger.warn("artifact-gc", `Failed to query archived_dtus: ${err.message}`);
  }

  return hashes;
}

/**
 * Build the full set of referenced artifact hashes from all sources.
 * @param {object} STATE
 * @param {import("better-sqlite3").Database} db
 * @returns {Set<string>}
 */
function collectAllReferencedHashes(STATE, db) {
  const liveHashes = collectLiveHashes(STATE?.dtus);
  const archivedHashes = collectArchivedHashes(db);

  // Merge sets
  for (const h of archivedHashes) {
    liveHashes.add(h);
  }
  return liveHashes;
}

/**
 * Scan the artifact directory and identify files matching the hash pattern.
 * @param {string} artifactRoot
 * @returns {{ files: Array<{ path: string, hash: string, sizeBytes: number }>, errors: number }}
 */
function scanArtifactFiles(artifactRoot) {
  const files = [];
  let errors = 0;

  if (!fs.existsSync(artifactRoot)) {
    logger.info("artifact-gc", `Artifact root does not exist: ${artifactRoot}`);
    return { files, errors };
  }

  const allPaths = walkDir(artifactRoot);

  for (const filePath of allPaths) {
    const basename = path.basename(filePath);
    const match = basename.match(HASH_FILE_PATTERN);
    if (!match) continue;

    try {
      const stat = fs.statSync(filePath);
      files.push({
        path: filePath,
        hash: match[1],
        sizeBytes: stat.size,
      });
    } catch (err) {
      errors++;
    }
  }

  return { files, errors };
}

/**
 * Run garbage collection: find and delete orphaned artifact files.
 *
 * @param {object} STATE - Server state containing dtus Map
 * @param {import("better-sqlite3").Database} db - SQLite database
 * @returns {Promise<{ collected: number, freedBytes: number, scanned: number, referenced: number, errors: number }>}
 */
export async function garbageCollectArtifacts(STATE, db) {
  const result = { collected: 0, freedBytes: 0, scanned: 0, referenced: 0, errors: 0 };

  try {
    const artifactRoot = resolveArtifactRoot();
    logger.info("artifact-gc", `Starting garbage collection in ${artifactRoot}`);

    // 1. Scan disk for artifact files
    const { files, errors: scanErrors } = scanArtifactFiles(artifactRoot);
    result.scanned = files.length;
    result.errors = scanErrors;

    if (files.length === 0) {
      logger.info("artifact-gc", "No artifact files found on disk — nothing to collect");
      return result;
    }

    // 2. Collect all referenced hashes
    const referencedHashes = collectAllReferencedHashes(STATE, db);
    result.referenced = referencedHashes.size;

    // 3. Identify and delete orphans
    for (const file of files) {
      if (referencedHashes.has(file.hash)) continue;

      // Orphaned file — delete it
      try {
        fs.unlinkSync(file.path);
        result.collected++;
        result.freedBytes += file.sizeBytes;
      } catch (err) {
        logger.warn("artifact-gc", `Failed to delete orphan ${file.path}: ${err.message}`);
        result.errors++;
      }
    }

    const freedMB = (result.freedBytes / (1024 * 1024)).toFixed(2);
    logger.info("artifact-gc", `GC complete: ${result.collected} orphans collected, ${freedMB} MB freed`, {
      scanned: result.scanned,
      referenced: result.referenced,
      collected: result.collected,
      freedBytes: result.freedBytes,
      errors: result.errors,
    });
  } catch (err) {
    logger.error("artifact-gc", `Garbage collection failed: ${err.message}`);
    result.errors++;
  }

  return result;
}

/**
 * Dry-run version of GC — counts orphans without deleting.
 * Useful for dashboards and monitoring.
 *
 * @param {object} STATE
 * @param {import("better-sqlite3").Database} db
 * @returns {Promise<number>} Number of orphaned artifact files
 */
export async function getOrphanCount(STATE, db) {
  try {
    const artifactRoot = resolveArtifactRoot();
    const { files } = scanArtifactFiles(artifactRoot);

    if (files.length === 0) return 0;

    const referencedHashes = collectAllReferencedHashes(STATE, db);
    let orphanCount = 0;

    for (const file of files) {
      if (!referencedHashes.has(file.hash)) {
        orphanCount++;
      }
    }

    return orphanCount;
  } catch (err) {
    logger.error("artifact-gc", `Orphan count failed: ${err.message}`);
    return 0;
  }
}

/**
 * Set up a weekly garbage collection timer.
 *
 * @param {object} STATE
 * @param {import("better-sqlite3").Database} db
 * @returns {NodeJS.Timeout} Interval ID (can be cleared with clearInterval)
 */
export function initGarbageCollectionTimer(STATE, db) {
  logger.info("artifact-gc", `Scheduling artifact GC every ${GC_INTERVAL_MS / (1000 * 60 * 60)} hours`);

  const intervalId = setInterval(async () => {
    try {
      await garbageCollectArtifacts(STATE, db);
    } catch (err) {
      logger.error("artifact-gc", `Scheduled GC failed: ${err.message}`);
    }
  }, GC_INTERVAL_MS);

  // Unref so the timer doesn't keep the process alive during shutdown
  if (intervalId.unref) intervalId.unref();

  return intervalId;
}
