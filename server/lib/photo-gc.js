// server/lib/photo-gc.js
//
// Storage audit fix (2026-07-27): data/photos/ (the PhotoMode blob store,
// server/lib/photo-gallery.js) had no orphan sweep at all — deletePhoto()
// correctly removes a blob when a user explicitly deletes their photo, but
// nothing ever cleaned up a blob left behind by a crashed/partial
// savePhoto() (the blob write happens BEFORE the DB insert; a process
// crash in that window strands the file with no user_photos row pointing
// at it forever). Mirrors artifact-gc.js's shape: scan disk, cross-
// reference against the DB, delete only what's unreferenced AND older
// than a grace period (so an in-flight write from the write-then-insert
// race is never touched).
//
// @sync-fs-ok: runs from a startup/heartbeat tick, never a request handler.

import fs from "node:fs";
import path from "node:path";
import logger from "../logger.js";
import { PHOTO_DIR } from "./photo-gallery.js";

// Weekly interval, matching artifact-gc.js's cadence.
const GC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// A blob younger than this is never touched, even if orphaned — protects
// the write-then-insert race window in savePhoto().
const GRACE_PERIOD_MS = 60 * 60 * 1000; // 1 hour

function scanPhotoFiles(photoDir) {
  const files = [];
  let errors = 0;
  if (!fs.existsSync(photoDir)) return { files, errors };
  try {
    for (const entry of fs.readdirSync(photoDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const full = path.join(photoDir, entry.name);
      try {
        const stat = fs.statSync(full);
        files.push({ path: full, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
      } catch { errors++; }
    }
  } catch (err) {
    logger.warn("photo-gc", `Failed to read photo dir ${photoDir}: ${err.message}`);
    errors++;
  }
  return { files, errors };
}

function collectReferencedBlobPaths(db) {
  const paths = new Set();
  if (!db) return paths;
  try {
    const rows = db.prepare("SELECT blob_path FROM user_photos WHERE blob_path IS NOT NULL").all();
    for (const row of rows) {
      if (row.blob_path) paths.add(path.resolve(row.blob_path));
    }
  } catch (err) {
    logger.warn("photo-gc", `Failed to query user_photos: ${err.message}`);
  }
  return paths;
}

/**
 * Find and delete orphaned photo blobs — files on disk with no
 * corresponding user_photos.blob_path row, aged past the grace period.
 *
 * @param {import("better-sqlite3").Database} db
 * @returns {Promise<{ collected: number, freedBytes: number, scanned: number, referenced: number, errors: number }>}
 */
export async function garbageCollectPhotos(db) {
  const result = { collected: 0, freedBytes: 0, scanned: 0, referenced: 0, errors: 0 };
  try {
    const { files, errors: scanErrors } = scanPhotoFiles(PHOTO_DIR);
    result.scanned = files.length;
    result.errors = scanErrors;
    if (files.length === 0) return result;

    const referenced = collectReferencedBlobPaths(db);
    result.referenced = referenced.size;

    const now = Date.now();
    for (const file of files) {
      if (referenced.has(path.resolve(file.path))) continue;
      if (now - file.mtimeMs < GRACE_PERIOD_MS) continue; // too young — might be mid-write

      try {
        fs.unlinkSync(file.path);
        result.collected++;
        result.freedBytes += file.sizeBytes;
      } catch (err) {
        logger.warn("photo-gc", `Failed to delete orphan ${file.path}: ${err.message}`);
        result.errors++;
      }
    }

    const freedMB = (result.freedBytes / (1024 * 1024)).toFixed(2);
    logger.info("photo-gc", `GC complete: ${result.collected} orphans collected, ${freedMB} MB freed`, {
      scanned: result.scanned,
      referenced: result.referenced,
      collected: result.collected,
      freedBytes: result.freedBytes,
      errors: result.errors,
    });
  } catch (err) {
    logger.error("photo-gc", `Garbage collection failed: ${err.message}`);
    result.errors++;
  }
  return result;
}

/** Total bytes currently used by data/photos/. */
export function getPhotoDiskUsage() {
  const { files } = scanPhotoFiles(PHOTO_DIR);
  return files.reduce((sum, f) => sum + f.sizeBytes, 0);
}

/**
 * Set up a weekly photo-GC timer, mirroring initGarbageCollectionTimer in
 * artifact-gc.js.
 *
 * @param {import("better-sqlite3").Database} db
 * @returns {NodeJS.Timeout}
 */
export function initPhotoGarbageCollectionTimer(db) {
  logger.info("photo-gc", `Scheduling photo GC every ${GC_INTERVAL_MS / (1000 * 60 * 60)} hours`);

  const intervalId = setInterval(async () => {
    try {
      await garbageCollectPhotos(db);
    } catch (err) {
      logger.error("photo-gc", `Scheduled GC failed: ${err.message}`);
    }
  }, GC_INTERVAL_MS);

  if (intervalId.unref) intervalId.unref();
  return intervalId;
}
