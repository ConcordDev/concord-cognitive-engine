import fs from "fs";
import path from "path";
import crypto from "crypto";
import zlib from "zlib";
import logger from '../logger.js';
import { transcodeImage, transcodeAudio, transcodeVideo, generateVideoDerivatives, isTranscodingAvailable } from './artifact-transcoder.js';
import { checkBudget, downgradePlan } from './artifact-budget.js';
import { ARTIFACT, FEEDBACK } from './artifact-constants.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
// Prefer network volume (/workspace/concord-data) over root disk for artifact storage.
// Network volume survives pod restarts and has far more space than the root overlay.
const ARTIFACT_ROOT = process.env.ARTIFACT_DIR
  || (fs.existsSync("/workspace/concord-data") ? "/workspace/concord-data/artifacts" : path.join(DATA_DIR, "artifacts"));
const MAX_ARTIFACT_SIZE = 100 * 1024 * 1024; // 100MB per artifact
const GZIP_LEVEL = 6; // balanced speed/ratio

// ---- LRU Preview Cache (200 items, 5 min TTL) ----
const PREVIEW_CACHE_MAX = 200;
const PREVIEW_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const _previewCache = new Map(); // key → { data, ts }

function previewCacheGet(key) {
  const entry = _previewCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > PREVIEW_CACHE_TTL) {
    _previewCache.delete(key);
    return null;
  }
  // LRU: move to end
  _previewCache.delete(key);
  _previewCache.set(key, entry);
  return entry.data;
}

function previewCacheSet(key, data) {
  if (_previewCache.size >= PREVIEW_CACHE_MAX) {
    // Evict oldest (first key)
    const oldest = _previewCache.keys().next().value;
    _previewCache.delete(oldest);
  }
  _previewCache.set(key, { data, ts: Date.now() });
}

export function previewCacheStats() {
  return { size: _previewCache.size, max: PREVIEW_CACHE_MAX, ttlMs: PREVIEW_CACHE_TTL };
}

const SUPPORTED_TYPES = Object.freeze({
  "audio/wav": { ext: "wav", compressible: true, previewable: true },
  "audio/mpeg": { ext: "mp3", compressible: false, previewable: true },
  "audio/ogg": { ext: "ogg", compressible: false, previewable: true },
  "audio/flac": { ext: "flac", compressible: false, previewable: true },
  "audio/midi": { ext: "mid", compressible: true, previewable: false },
  "image/png": { ext: "png", compressible: false, previewable: true },
  "image/jpeg": { ext: "jpg", compressible: false, previewable: true },
  "image/webp": { ext: "webp", compressible: false, previewable: true },
  "image/svg+xml": { ext: "svg", compressible: true, previewable: true },
  "video/mp4": { ext: "mp4", compressible: false, previewable: true },
  "video/webm": { ext: "webm", compressible: false, previewable: true },
  "application/pdf": { ext: "pdf", compressible: true, previewable: true },
  "text/plain": { ext: "txt", compressible: true, previewable: true },
  "text/markdown": { ext: "md", compressible: true, previewable: true },
  "text/html": { ext: "html", compressible: true, previewable: true },
  "text/csv": { ext: "csv", compressible: true, previewable: true },
  "text/calendar": { ext: "ics", compressible: true, previewable: false },
  "application/javascript": { ext: "js", compressible: true, previewable: true },
  "application/json": { ext: "json", compressible: true, previewable: true },
  "application/zip": { ext: "zip", compressible: false, previewable: false },
  "model/gltf+json": { ext: "gltf", compressible: true, previewable: false },
});

export function isSupportedType(mimeType) {
  return !!SUPPORTED_TYPES[mimeType];
}

export async function storeArtifact(dtuId, buffer, mimeType, filename) {
  if (buffer.length > MAX_ARTIFACT_SIZE) {
    throw new Error(`Artifact exceeds max size: ${buffer.length} > ${MAX_ARTIFACT_SIZE}`);
  }
  const typeInfo = SUPPORTED_TYPES[mimeType];
  if (!typeInfo) throw new Error(`Unsupported artifact type: ${mimeType}`);

  // Content-addressed storage: hash determines file path for automatic dedup.
  // Two DTUs referencing the same audio file = one copy on disk.
  const hashHex = crypto.createHash("sha256").update(buffer).digest("hex");
  const hash = "sha256:" + hashHex;
  const contentFile = `${hashHex}.${typeInfo.ext}`;
  const diskPath = path.join(ARTIFACT_ROOT, contentFile);

  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });

  // Dedup: skip writing if this exact content already exists on disk
  const alreadyExists = fs.existsSync(diskPath);
  if (!alreadyExists) {
    fs.writeFileSync(diskPath, buffer);
  }

  // Compress compressible types (text, SVG, MIDI, etc.)
  let compressedPath = null;
  if (typeInfo.compressible) {
    compressedPath = diskPath + ".gz";
    if (!fs.existsSync(compressedPath)) {
      const compressed = zlib.gzipSync(buffer, { level: GZIP_LEVEL });
      fs.writeFileSync(compressedPath, compressed);
    }
  }

  // Also store in legacy DTU-based directory for backwards compat
  const dtuDir = path.join(ARTIFACT_ROOT, dtuId);
  fs.mkdirSync(dtuDir, { recursive: true });
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const legacyPath = path.join(dtuDir, sanitizedFilename);
  if (!fs.existsSync(legacyPath)) {
    try { fs.symlinkSync(diskPath, legacyPath); } catch { fs.copyFileSync(diskPath, legacyPath); }
  }

  const thumbnail = generateThumbnail(dtuDir, diskPath, mimeType);
  const preview = generatePreview(dtuDir, diskPath, mimeType);

  const result = {
    type: mimeType,
    filename: sanitizedFilename,
    diskPath,
    sizeBytes: buffer.length,
    hash,
    compressed: !!compressedPath,
    compressedPath,
    thumbnail,
    preview,
    multipart: false,
    parts: null,
    createdAt: new Date().toISOString(),
    lastAccessedAt: null,
    deduplicated: alreadyExists,
    derivatives: {},
    transcodedPath: null,
  };

  // Fire-and-forget background transcoding (non-blocking)
  if (!alreadyExists) {
    scheduleTranscoding(diskPath, hashHex, mimeType, result).catch(e =>
      logger.warn("artifact-store", "transcode-bg-error", { error: e?.message })
    );
  }

  return result;
}

/**
 * Background transcoding: convert to optimal format and generate derivatives.
 * Mutates the result object in-place so callers who keep a reference get updates.
 */
async function scheduleTranscoding(diskPath, hashHex, mimeType, result) {
  const available = await isTranscodingAvailable();
  if (!available) return;

  const derivDir = path.join(ARTIFACT_ROOT, "derivatives", hashHex);
  fs.mkdirSync(derivDir, { recursive: true });

  try {
    if (mimeType.startsWith("image/") && mimeType !== "image/webp" && mimeType !== "image/svg+xml") {
      const webp = await transcodeImage(diskPath, derivDir);
      if (webp) {
        result.transcodedPath = webp.path;
        result.derivatives.webp = webp.path;
      }
    } else if (mimeType.startsWith("audio/") && mimeType !== "audio/ogg") {
      const opus = await transcodeAudio(diskPath, derivDir);
      if (opus) {
        result.transcodedPath = opus.path;
        result.derivatives.opus = opus.path;
      }
    } else if (mimeType.startsWith("video/")) {
      const h265 = await transcodeVideo(diskPath, derivDir);
      if (h265) {
        result.transcodedPath = h265.path;
        result.derivatives.h265 = h265.path;
      }
      const vDerivs = await generateVideoDerivatives(diskPath, hashHex, derivDir);
      if (vDerivs?.derivatives) {
        Object.assign(result.derivatives, vDerivs.derivatives);
      }
    }
  } catch (e) {
    logger.warn("artifact-store", "transcode-failed", { hashHex, mimeType, error: e?.message });
  }
}

/**
 * Strip base64 artifact data from a DTU object in-place.
 * After calling storeArtifact, the file lives on disk — keeping the base64
 * blob in the DTU wastes ~1.3x the file size in the JS heap.
 * Call this after storeArtifact() returns successfully.
 */
export function stripArtifactData(dtu) {
  if (!dtu) return;
  if (dtu.artifact?.data) {
    delete dtu.artifact.data;
  }
  // Also strip from nested structures
  if (dtu.meta?.artifactData) delete dtu.meta.artifactData;
  if (dtu.core?.binaryData) delete dtu.core.binaryData;
}

export async function storeMultipartArtifact(dtuId, files) {
  const dtuDir = path.join(ARTIFACT_ROOT, dtuId);
  fs.mkdirSync(dtuDir, { recursive: true });

  const parts = [];
  let totalSize = 0;

  for (const file of files) {
    const sanitized = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = path.join(dtuDir, sanitized);
    fs.writeFileSync(filePath, file.buffer);
    totalSize += file.buffer.length;
    parts.push({
      filename: sanitized,
      type: file.mimeType,
      diskPath: filePath,
      sizeBytes: file.buffer.length,
    });
  }

  const hash = "sha256:" + crypto.createHash("sha256")
    .update(parts.map(p => p.filename).join("|")).digest("hex");

  return {
    type: "application/x-concord-collection",
    filename: `${dtuId}_collection`,
    diskPath: dtuDir,
    sizeBytes: totalSize,
    hash,
    compressed: false,
    compressedPath: null,
    thumbnail: parts[0]?.diskPath || null,
    preview: null,
    multipart: true,
    parts,
    createdAt: new Date().toISOString(),
    lastAccessedAt: null,
  };
}

/**
 * Read artifact bytes — tries compressed first, falls back to raw.
 * Backwards compatible: works whether artifact was stored before or after compression.
 */
export function retrieveArtifact(dtuId, artifactRef) {
  if (!artifactRef?.diskPath) return null;
  artifactRef.lastAccessedAt = new Date().toISOString();

  // Prefer compressed path (decompress on read)
  if (artifactRef.compressedPath && fs.existsSync(artifactRef.compressedPath)) {
    return zlib.gunzipSync(fs.readFileSync(artifactRef.compressedPath));
  }
  // Fallback: raw file (pre-compression artifacts)
  if (fs.existsSync(artifactRef.diskPath)) {
    return fs.readFileSync(artifactRef.diskPath);
  }
  return null;
}

/**
 * Read artifact bytes with LRU preview cache.
 * Used for preview/thumbnail endpoints that get hit repeatedly.
 */
export function retrieveArtifactCached(dtuId, artifactRef) {
  if (!artifactRef?.diskPath) return null;
  const cacheKey = `${dtuId}:${artifactRef.filename || path.basename(artifactRef.diskPath)}`;

  const cached = previewCacheGet(cacheKey);
  if (cached) return cached;

  const data = retrieveArtifact(dtuId, artifactRef);
  if (data) previewCacheSet(cacheKey, data);
  return data;
}

export function retrieveArtifactStream(artifactRef) {
  if (!artifactRef?.diskPath) return null;
  artifactRef.lastAccessedAt = new Date().toISOString();

  // Prefer compressed — create a decompress stream
  if (artifactRef.compressedPath && fs.existsSync(artifactRef.compressedPath)) {
    return fs.createReadStream(artifactRef.compressedPath).pipe(zlib.createGunzip());
  }
  // Fallback to raw
  if (fs.existsSync(artifactRef.diskPath)) {
    return fs.createReadStream(artifactRef.diskPath);
  }
  return null;
}

export function deleteArtifact(dtuId) {
  const dtuDir = path.join(ARTIFACT_ROOT, dtuId);
  if (fs.existsSync(dtuDir)) {
    fs.rmSync(dtuDir, { recursive: true, force: true });
  }
}

export function getArtifactDiskUsage() {
  let total = 0;
  if (!fs.existsSync(ARTIFACT_ROOT)) return 0;
  const walk = (dir) => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else try { total += fs.statSync(full).size; } catch (_e) { logger.debug('artifact-store', 'silent catch', { error: _e?.message }); }
      }
    } catch (_e) { logger.debug('artifact-store', 'silent catch', { error: _e?.message }); }
  };
  walk(ARTIFACT_ROOT);
  return total;
}

export function inferDomainFromType(mimeType) {
  if (mimeType.startsWith("audio/")) return "music";
  if (mimeType.startsWith("image/")) return "art";
  if (mimeType.startsWith("video/")) return "studio";
  if (mimeType.includes("pdf") || mimeType.includes("document")) return "legal";
  if (mimeType.includes("spreadsheet")) return "finance";
  if (mimeType.startsWith("text/")) return "creative";
  return "general";
}

export function inferKindFromType(mimeType) {
  if (mimeType.startsWith("audio/")) return "music_composition";
  if (mimeType.startsWith("image/")) return "artwork";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.includes("pdf")) return "document";
  if (mimeType.startsWith("text/")) return "text_content";
  if (mimeType.includes("json") || mimeType.includes("javascript")) return "code_module";
  return "binary_artifact";
}

function generateThumbnail(dtuDir, filePath, mimeType) {
  if (mimeType.startsWith("image/")) return filePath;
  if (mimeType.startsWith("audio/")) {
    try {
      const buffer = fs.readFileSync(filePath);
      const peaks = extractWaveformPeaks(buffer, 200);
      const waveformPath = path.join(dtuDir, "waveform.json");
      fs.writeFileSync(waveformPath, JSON.stringify(peaks));
      return waveformPath;
    } catch (err) { console.warn('[artifact-store] waveform extraction failed', err?.message); return null; }
  }
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/javascript") {
    try {
      const text = fs.readFileSync(filePath, "utf-8").slice(0, 500);
      const previewPath = path.join(dtuDir, "text_preview.txt");
      fs.writeFileSync(previewPath, text);
      return previewPath;
    } catch (err) { console.warn('[artifact-store] text preview generation failed', err?.message); return null; }
  }
  return null;
}

function generatePreview(dtuDir, filePath, mimeType) {
  if (mimeType.startsWith("audio/")) return filePath;
  return null;
}

function extractWaveformPeaks(buffer, numPoints) {
  const peaks = [];
  const step = Math.max(1, Math.floor(buffer.length / numPoints));
  for (let i = 0; i < numPoints; i++) {
    const offset = Math.min(i * step + 44, buffer.length - 2);
    if (offset < 0 || offset >= buffer.length - 1) { peaks.push(0); continue; }
    try {
      const val = Math.abs(buffer.readInt16LE(offset));
      peaks.push(val / 32768);
    } catch { peaks.push(0); }
  }
  return peaks;
}

// ---- MEGA Compression Cascade ----
// When DTUs consolidate into a MEGA, keep only top 3 exemplar files.
// Compress the rest into a single archive. Frees disk but retains access.

/**
 * Compress source DTU artifacts after MEGA consolidation.
 * Keeps topN exemplar files uncompressed, archives the rest.
 *
 * @param {string} megaId - The MEGA DTU id
 * @param {string[]} sourceDtuIds - Source DTU ids being consolidated
 * @param {object} STATE - Server state (needs STATE.dtus)
 * @param {number} [topN=3] - Number of exemplar files to keep
 * @returns {{ archived: number, keptExemplars: number, savedBytes: number }}
 */
export function megaCompressionCascade(megaId, sourceDtuIds, STATE, topN = 3) {
  let archived = 0;
  let savedBytes = 0;
  const exemplars = [];

  // Rank source artifacts by quality/size
  const ranked = sourceDtuIds
    .map(id => {
      const dtu = STATE.dtus?.get(id);
      if (!dtu?.artifact) return null;
      return {
        id,
        artifact: dtu.artifact,
        score: (dtu.qualityTier === "verified" ? 3 : dtu.qualityTier === "reviewed" ? 2 : 1),
        size: dtu.artifact.sizeBytes || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.size - a.size);

  // Keep top N as exemplars
  for (let i = 0; i < ranked.length; i++) {
    if (i < topN) {
      exemplars.push(ranked[i].id);
      continue;
    }

    // Archive the rest: ensure compressed, remove raw file
    const art = ranked[i].artifact;
    if (!art.compressed && art.diskPath && fs.existsSync(art.diskPath)) {
      try {
        const raw = fs.readFileSync(art.diskPath);
        const compressed = zlib.gzipSync(raw, { level: GZIP_LEVEL });
        const gzPath = art.diskPath + ".gz";
        fs.writeFileSync(gzPath, compressed);
        art.compressedPath = gzPath;
        art.compressed = true;
        // Remove raw file to save disk
        fs.unlinkSync(art.diskPath);
        savedBytes += raw.length - compressed.length;
        archived++;
      } catch {
        // If compression fails, leave as-is
      }
    }
  }

  return { archived, keptExemplars: exemplars.length, savedBytes };
}

// ---- Shadow Vault ----
// Entity-produced artifacts pass quality gate but get tagged "shadow_vault"
// instead of "marketplace_ready". Only top 2% surface to users.

/**
 * Apply shadow vault logic to an entity-produced artifact after quality tier assignment.
 * 98% of entity artifacts go to shadow_vault; 2% surface as marketplace_ready.
 *
 * @param {object} artifact - The artifact/DTU object
 * @param {object} tier - The quality tier result { status, score, ... }
 * @returns {object} Modified tier with shadow_vault applied if needed
 */
export function applyShadowVault(artifact, tier) {
  if (tier.status !== "marketplace_ready") return tier;

  const createdBy = artifact.meta?.createdBy || artifact.createdBy || "";
  if (!createdBy.startsWith("entity")) return tier;

  // Shadow 98% of entity production
  if (Math.random() > 0.02) {
    return { ...tier, status: "shadow_vault" };
  }
  return tier;
}

/**
 * Unshadow the top N artifacts in a domain from the shadow vault.
 * Used by admin to curate marketplace visibility.
 *
 * @param {string} domain - Domain to unshadow from
 * @param {number} count - Number of artifacts to unshadow
 * @param {object} STATE - Server state
 * @returns {{ unshadowed: string[] }}
 */
export function unshadowTopArtifacts(domain, count, STATE) {
  const candidates = [];

  for (const [id, dtu] of STATE.dtus || []) {
    if (dtu.domain !== domain) continue;
    if (dtu.qualityTier !== "shadow_vault" && dtu.status !== "shadow_vault") continue;
    candidates.push({
      id,
      dtu,
      score: dtu.qualityScore || dtu.validationScore || 0,
      maturity: dtu.entityMaturity || 0,
    });
  }

  // Sort by quality score descending, then entity maturity
  candidates.sort((a, b) => b.score - a.score || b.maturity - a.maturity);
  const toUnshadow = candidates.slice(0, count);

  const unshadowed = [];
  for (const c of toUnshadow) {
    if (c.dtu.qualityTier) c.dtu.qualityTier = "marketplace_ready";
    if (c.dtu.status === "shadow_vault") c.dtu.status = "marketplace_ready";
    unshadowed.push(c.id);
  }

  return { unshadowed };
}

// ---- Migration: Compress Existing Artifacts ----

/**
 * One-time migration: compress all existing uncompressed compressible artifacts.
 * Safe to run multiple times — skips already-compressed files.
 *
 * @returns {{ migrated: number, skipped: number, errors: number, savedBytes: number }}
 */
export function migrateArtifactsToCompressed() {
  const stats = { migrated: 0, skipped: 0, errors: 0, savedBytes: 0 };
  if (!fs.existsSync(ARTIFACT_ROOT)) return stats;

  const walk = (dir) => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        // Skip already-compressed files, thumbnails, previews, metadata
        if (entry.name.endsWith(".gz") || entry.name === "waveform.json" ||
            entry.name === "text_preview.txt") {
          stats.skipped++;
          continue;
        }
        // Check if a .gz version already exists
        if (fs.existsSync(full + ".gz")) {
          stats.skipped++;
          continue;
        }
        // Check if this file type is compressible
        const ext = path.extname(entry.name).slice(1);
        const isCompressible = Object.values(SUPPORTED_TYPES).some(
          t => t.ext === ext && t.compressible
        );
        if (!isCompressible) {
          stats.skipped++;
          continue;
        }
        try {
          const raw = fs.readFileSync(full);
          const compressed = zlib.gzipSync(raw, { level: GZIP_LEVEL });
          fs.writeFileSync(full + ".gz", compressed);
          stats.savedBytes += raw.length - compressed.length;
          stats.migrated++;
        } catch {
          stats.errors++;
        }
      }
    } catch {
      stats.errors++;
    }
  };

  walk(ARTIFACT_ROOT);
  return stats;
}

// ---- MEGA/HYPER Artifact Reference-Linking ----
// When DTUs consolidate, artifacts are reference-linked (not duplicated).
// The MEGA/HYPER carries an absorbed_artifacts array pointing to content-addressed files.

/**
 * Collect artifact references from source DTUs for MEGA consolidation.
 * Returns absorbed_artifacts array + primary_artifact selection.
 *
 * @param {string[]} sourceDtuIds - IDs of DTUs being consolidated
 * @param {object} STATE - Server state with STATE.dtus Map
 * @returns {{ absorbed: Array<{hash,ref,mimeType,sizeBytes,sourceId}>, primary: string|null }}
 */
export function collectArtifactRefs(sourceDtuIds, STATE) {
  const absorbed = [];
  let primaryHash = null;
  let primaryScore = -1;

  for (const id of sourceDtuIds) {
    const dtu = STATE.dtus?.get(id);
    if (!dtu?.artifact?.hash) continue;

    const art = dtu.artifact;
    absorbed.push({
      hash: art.hash,
      ref: art.diskPath || path.join(ARTIFACT_ROOT, art.hash.replace("sha256:", "") + "." + (SUPPORTED_TYPES[art.type]?.ext || "bin")),
      mimeType: art.type,
      sizeBytes: art.sizeBytes || 0,
      sourceId: id,
    });

    // Pick primary: highest quality score or largest file
    const score = (dtu.qualityTier === "verified" ? 3 : dtu.qualityTier === "reviewed" ? 2 : 1);
    if (score > primaryScore || (score === primaryScore && (art.sizeBytes || 0) > 0)) {
      primaryHash = art.hash;
      primaryScore = score;
    }
  }

  return { absorbed, primary: primaryHash };
}

/**
 * Cascade artifact references from constituent MEGAs for HYPER consolidation.
 * Collects all absorbed_artifacts from MEGAs + their own primary artifacts.
 *
 * @param {object[]} megaDtus - MEGA DTU objects
 * @param {number} [hotCount=3] - Number of representative artifacts to keep "hot"
 * @returns {{ absorbed: Array, primary: string|null, hotArtifacts: string[] }}
 */
export function cascadeArtifactRefs(megaDtus, hotCount = 3) {
  const allAbsorbed = [];
  const seen = new Set();

  for (const mega of megaDtus) {
    // Collect from MEGA's absorbed artifacts
    if (mega.artifacts?.absorbed) {
      for (const ref of mega.artifacts.absorbed) {
        if (!seen.has(ref.hash)) {
          seen.add(ref.hash);
          allAbsorbed.push(ref);
        }
      }
    }
    // Also include MEGA's own primary if it has one
    if (mega.artifact?.hash && !seen.has(mega.artifact.hash)) {
      seen.add(mega.artifact.hash);
      allAbsorbed.push({
        hash: mega.artifact.hash,
        ref: mega.artifact.diskPath,
        mimeType: mega.artifact.type,
        sizeBytes: mega.artifact.sizeBytes || 0,
        sourceId: mega.id,
      });
    }
  }

  // Pick top N by size as "hot" (representative) artifacts
  const ranked = [...allAbsorbed].sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
  const hotArtifacts = ranked.slice(0, hotCount).map(r => r.hash);
  const primary = hotArtifacts[0] || null;

  return { absorbed: allAbsorbed, primary, hotArtifacts };
}

/**
 * Build the artifacts block for a MEGA or HYPER DTU.
 * Call this from _makeMegaFromCluster / _makeHyperFromMegas and attach to the DTU object.
 *
 * @param {"mega"|"hyper"} tier
 * @param {string[]|object[]} sources - source DTU IDs (mega) or MEGA objects (hyper)
 * @param {object} STATE
 * @returns {{ absorbed: Array, primary: string|null, hotArtifacts?: string[], derivatives: {} }}
 */
export function buildConsolidatedArtifacts(tier, sources, STATE) {
  if (tier === "mega") {
    const { absorbed, primary } = collectArtifactRefs(sources, STATE);
    return { absorbed, primary, derivatives: {} };
  }
  // hyper — sources are MEGA DTU objects
  const { absorbed, primary, hotArtifacts } = cascadeArtifactRefs(sources);
  return { absorbed, primary, hotArtifacts, derivatives: {} };
}

/**
 * Budget-aware artifact creation for emergent entities.
 * Checks daily budget before storing, downgrades gracefully when over budget.
 *
 * @param {object} STATE - Server state (needs STATE.dailyArtifactBytes)
 * @param {string} dtuId
 * @param {Buffer} buffer
 * @param {string} mimeType
 * @param {string} filename
 * @param {string} domain - The lens domain (music, art, studio, etc.)
 * @param {string} action - The action being performed
 * @returns {Promise<object|null>} - storeArtifact result, or null if budget rejected
 */
export async function budgetAwareStore(STATE, dtuId, buffer, mimeType, filename, domain, action) {
  const budget = checkBudget(STATE);
  if (!budget.allowed) {
    const downgrade = downgradePlan(domain, action, budget.remainingBytes);
    if (downgrade?.textOnly) {
      logger.info("artifact-store", "budget-rejected-text-only", { domain, action, remainingBytes: budget.remainingBytes });
      return null; // Caller should fall back to text-only DTU
    }
    // Downgrade plan modifies params but we still store something smaller
    logger.info("artifact-store", "budget-downgrade", { domain, action, downgrade });
  }

  const result = await storeArtifact(dtuId, buffer, mimeType, filename);

  // Track daily usage
  STATE.dailyArtifactBytes = (STATE.dailyArtifactBytes || 0) + (result?.sizeBytes || 0);

  return result;
}

// Re-export ARTIFACT_ROOT for use by other modules
export { ARTIFACT_ROOT };
