// @sync-fs-ok: DTU pack/unpack archive format requires byte-exact ordering for signature verification
/**
 * DTU Container Format (.dtu)
 *
 * Packs a DTU and its artifacts into a portable, self-contained archive.
 *
 * Container structure (tar-based):
 * ├── manifest.json        — knowledge layer (title, tags, CRETI, lineage, artifact refs)
 * ├── content.md.gz        — text content, gzip compressed
 * ├── artifacts/
 * │   ├── primary.*        — main artifact file if present
 * │   └── derivatives/     — thumbnails, waveforms, etc.
 * └── signature            — SHA256 of manifest + content for integrity verification
 *
 * Uses standard tar format for maximum portability across platforms.
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import logger from "../logger.js";

const execFileAsync = promisify(execFile);
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Extract manifest fields from a DTU object.
 *
 * Captures metadata, lineage, artifact references, and scoring —
 * but never binary data.
 *
 * @param {object} dtu
 * @returns {object} Manifest object
 */
export function buildManifest(dtu) {
  const manifest = {
    version: 1,
    id: dtu.id,
    title: dtu.title || dtu.human?.title || null,
    tier: dtu.tier || null,
    tags: dtu.tags || [],
    domain: dtu.domain || null,
    lineage: {
      parents: dtu.lineage?.parents || dtu.parents || [],
      children: dtu.lineage?.children || dtu.children || [],
    },
    artifacts: [],
    crpiScores: dtu.crpiScores || dtu.cretiScores || dtu.creti || null,
    createdAt: dtu.createdAt || null,
    updatedAt: dtu.updatedAt || null,
  };

  // Primary artifact reference (hash, mimeType, sizeBytes — NOT binary)
  if (dtu.artifact) {
    manifest.artifacts.push({
      role: "primary",
      hash: dtu.artifact.hash || null,
      mimeType: dtu.artifact.mimeType || dtu.artifact.mime || null,
      sizeBytes: dtu.artifact.sizeBytes || dtu.artifact.size || null,
    });
  }

  // Absorbed artifacts for MEGA/HYPER tiers
  if (Array.isArray(dtu.artifacts?.absorbed)) {
    for (const absorbed of dtu.artifacts.absorbed) {
      manifest.artifacts.push({
        role: "absorbed",
        hash: absorbed.hash || null,
        mimeType: absorbed.mimeType || absorbed.mime || null,
        sizeBytes: absorbed.sizeBytes || absorbed.size || null,
      });
    }
  }

  return manifest;
}

/**
 * Compute a SHA-256 signature from manifest and content buffers.
 * @param {Buffer} manifestBuf
 * @param {Buffer} contentBuf
 * @returns {string} Hex digest
 */
function computeSignature(manifestBuf, contentBuf) {
  const hash = crypto.createHash("sha256");
  hash.update(manifestBuf);
  hash.update(contentBuf);
  return hash.digest("hex");
}

/**
 * Build markdown content from DTU text layers.
 * @param {object} dtu
 * @returns {string}
 */
function buildContentMarkdown(dtu) {
  const parts = [];

  if (dtu.human?.summary) {
    parts.push(`# Summary\n\n${dtu.human.summary}`);
  }

  if (dtu.core) {
    const coreText = typeof dtu.core === "string" ? dtu.core : JSON.stringify(dtu.core, null, 2);
    parts.push(`# Core\n\n${coreText}`);
  }

  if (dtu.human?.detail) {
    parts.push(`# Detail\n\n${dtu.human.detail}`);
  }

  return parts.join("\n\n---\n\n") || "";
}

/**
 * Pack a DTU and its artifacts into a .dtu container file.
 *
 * @param {object} dtu - The DTU object
 * @param {string} artifactRootDir - Root directory where artifacts are stored on disk
 * @returns {Promise<{ containerPath: string, sizeBytes: number, signature: string, manifest: object } | { error: string }>}
 */
export async function packDTUContainer(dtu, artifactRootDir) {
  let stagingDir = null;

  try {
    if (!dtu || !dtu.id) {
      return { error: "DTU object must have an id" };
    }

    // Create a temp staging directory
    const tmpBase = process.env.TMPDIR || "/tmp";
    stagingDir = path.join(tmpBase, `dtu-container-${dtu.id}-${Date.now()}`);
    fs.mkdirSync(stagingDir, { recursive: true });

    // 1. Build and write manifest.json
    const manifest = buildManifest(dtu);
    const manifestJson = JSON.stringify(manifest, null, 2);
    const manifestBuf = Buffer.from(manifestJson, "utf-8");
    await fs.promises.writeFile(path.join(stagingDir, "manifest.json"), manifestBuf);

    // 2. Build and write content.md.gz
    const contentMd = buildContentMarkdown(dtu);
    const contentBuf = await gzip(Buffer.from(contentMd, "utf-8"));
    await fs.promises.writeFile(path.join(stagingDir, "content.md.gz"), contentBuf);

    // 3. Include primary artifact if it exists on disk
    const artifactsDir = path.join(stagingDir, "artifacts");
    fs.mkdirSync(artifactsDir, { recursive: true });

    if (dtu.artifact?.diskPath && fs.existsSync(dtu.artifact.diskPath)) {
      const ext = path.extname(dtu.artifact.diskPath) || ".bin";
      const destName = `primary${ext}`;
      fs.copyFileSync(dtu.artifact.diskPath, path.join(artifactsDir, destName));
    } else if (dtu.artifact?.hash && artifactRootDir) {
      // Try to find the artifact by hash pattern in the root directory
      const hashPrefix = dtu.artifact.hash;
      try {
        const candidates = fs.readdirSync(artifactRootDir).filter((f) => f.startsWith(hashPrefix));
        if (candidates.length > 0) {
          const srcPath = path.join(artifactRootDir, candidates[0]);
          const ext = path.extname(candidates[0]) || ".bin";
          fs.copyFileSync(srcPath, path.join(artifactsDir, `primary${ext}`));
        }
      } catch (err) {
        logger.debug("dtu-container", `Could not locate primary artifact by hash: ${err.message}`);
      }
    }

    // 4. Include derivative artifacts if present
    if (dtu.artifact?.derivatives && typeof dtu.artifact.derivatives === "object") {
      const derivDir = path.join(artifactsDir, "derivatives");
      fs.mkdirSync(derivDir, { recursive: true });

      for (const [key, deriv] of Object.entries(dtu.artifact.derivatives)) {
        const derivPath = deriv.diskPath || deriv.path;
        if (derivPath && fs.existsSync(derivPath)) {
          const ext = path.extname(derivPath) || ".bin";
          const destName = `${key}${ext}`;
          fs.copyFileSync(derivPath, path.join(derivDir, destName));
        }
      }
    }

    // 5. Compute and write signature
    const signature = computeSignature(manifestBuf, contentBuf);
    await fs.promises.writeFile(path.join(stagingDir, "signature"), signature, "utf-8");

    // 6. Create tar archive
    const containerPath = path.join(tmpBase, `${dtu.id}.dtu`);
    await execFileAsync("tar", [
      "cf", containerPath,
      "-C", stagingDir,
      "manifest.json", "content.md.gz", "artifacts", "signature",
    ]);

    // Get final container size
    const containerStat = await fs.promises.stat(containerPath);

    logger.info("dtu-container", `Packed container for DTU ${dtu.id} (${containerStat.size} bytes)`);

    return {
      containerPath,
      sizeBytes: containerStat.size,
      signature,
      manifest,
    };
  } catch (err) {
    logger.error("dtu-container", `Failed to pack DTU ${dtu?.id}: ${err.message}`);
    return { error: err.message };
  } finally {
    // Clean up staging directory
    if (stagingDir && fs.existsSync(stagingDir)) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        logger.debug("dtu-container", `Staging cleanup failed: ${cleanupErr.message}`);
      }
    }
  }
}

/**
 * Unpack a .dtu container file and reconstruct the DTU.
 *
 * @param {string} containerPath - Path to the .dtu file
 * @param {string} outputDir - Directory to extract artifacts into
 * @returns {Promise<{ dtu: object, artifacts: Array<{ path: string, mimeType: string }>, valid: boolean } | { error: string }>}
 */
export async function unpackDTUContainer(containerPath, outputDir) {
  let extractDir = null;

  try {
    if (!containerPath || !fs.existsSync(containerPath)) {
      return { error: `Container file not found: ${containerPath}` };
    }

    // Create extraction directory
    extractDir = path.join(outputDir, `dtu-extract-${Date.now()}`);
    fs.mkdirSync(extractDir, { recursive: true });

    // Extract tar
    await execFileAsync("tar", ["xf", containerPath, "-C", extractDir]);

    // Read manifest
    const manifestPath = path.join(extractDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      return { error: "Container missing manifest.json" };
    }
    const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf-8"));

    // Read and decompress content
    const contentGzPath = path.join(extractDir, "content.md.gz");
    let contentText = "";
    if (fs.existsSync(contentGzPath)) {
      const compressed = await fs.promises.readFile(contentGzPath);
      const decompressed = await gunzip(compressed);
      contentText = decompressed.toString("utf-8");
    }

    // Verify signature
    const signaturePath = path.join(extractDir, "signature");
    let valid = false;
    if (fs.existsSync(signaturePath)) {
      const storedSig = await fs.promises.readFile(signaturePath, "utf-8").trim();
      const manifestBuf = await fs.promises.readFile(manifestPath);
      const contentBuf = fs.existsSync(contentGzPath) ? await fs.promises.readFile(contentGzPath) : Buffer.alloc(0);
      const computedSig = computeSignature(manifestBuf, contentBuf);
      valid = storedSig === computedSig;
    }

    if (!valid) {
      logger.warn("dtu-container", `Signature verification failed for ${containerPath}`);
    }

    // Collect artifact files
    const artifacts = [];
    const artifactsExtractDir = path.join(extractDir, "artifacts");
    if (fs.existsSync(artifactsExtractDir)) {
      // Move artifacts to the output directory
      const artifactsOutputDir = path.join(outputDir, "artifacts");
      fs.mkdirSync(artifactsOutputDir, { recursive: true });

      const collectArtifactFiles = (dir, relPrefix) => {
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const srcPath = path.join(dir, entry.name);
            const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
              collectArtifactFiles(srcPath, relPath);
            } else if (entry.isFile()) {
              const destPath = path.join(artifactsOutputDir, relPath);
              fs.mkdirSync(path.dirname(destPath), { recursive: true });
              fs.copyFileSync(srcPath, destPath);
              artifacts.push({
                path: destPath,
                mimeType: guessMimeType(entry.name),
              });
            }
          }
        } catch (err) {
          logger.warn("dtu-container", `Error collecting artifacts from ${dir}: ${err.message}`);
        }
      };

      collectArtifactFiles(artifactsExtractDir, "");
    }

    // Reconstruct DTU object from manifest + content
    const dtu = {
      id: manifest.id,
      title: manifest.title,
      tier: manifest.tier,
      tags: manifest.tags || [],
      domain: manifest.domain,
      lineage: manifest.lineage || {},
      core: contentText,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
    };

    if (manifest.crpiScores) {
      dtu.crpiScores = manifest.crpiScores;
    }

    if (manifest.artifacts && manifest.artifacts.length > 0) {
      const primary = manifest.artifacts.find((a) => a.role === "primary");
      if (primary) {
        dtu.artifact = {
          hash: primary.hash,
          mimeType: primary.mimeType,
          sizeBytes: primary.sizeBytes,
        };
      }

      const absorbed = manifest.artifacts.filter((a) => a.role === "absorbed");
      if (absorbed.length > 0) {
        dtu.artifacts = {
          absorbed: absorbed.map((a) => ({
            hash: a.hash,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
          })),
        };
      }
    }

    logger.info("dtu-container", `Unpacked container ${path.basename(containerPath)} — valid=${valid}`);

    return { dtu, artifacts, valid };
  } catch (err) {
    logger.error("dtu-container", `Failed to unpack ${containerPath}: ${err.message}`);
    return { error: err.message };
  } finally {
    // Clean up extraction temp directory
    if (extractDir && fs.existsSync(extractDir)) {
      try {
        fs.rmSync(extractDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        logger.debug("dtu-container", `Extract cleanup failed: ${cleanupErr.message}`);
      }
    }
  }
}

/**
 * Verify the integrity of a .dtu container without fully unpacking.
 *
 * @param {string} containerPath
 * @returns {Promise<boolean>}
 */
export async function verifyContainerIntegrity(containerPath) {
  let extractDir = null;

  try {
    if (!containerPath || !fs.existsSync(containerPath)) {
      logger.warn("dtu-container", `Cannot verify — file not found: ${containerPath}`);
      return false;
    }

    const tmpBase = process.env.TMPDIR || "/tmp";
    extractDir = path.join(tmpBase, `dtu-verify-${Date.now()}`);
    fs.mkdirSync(extractDir, { recursive: true });

    // Extract only the files needed for verification
    await execFileAsync("tar", [
      "xf", containerPath,
      "-C", extractDir,
      "manifest.json", "content.md.gz", "signature",
    ]);

    const manifestPath = path.join(extractDir, "manifest.json");
    const contentGzPath = path.join(extractDir, "content.md.gz");
    const signaturePath = path.join(extractDir, "signature");

    if (!fs.existsSync(manifestPath) || !fs.existsSync(signaturePath)) {
      logger.warn("dtu-container", `Container missing required files: ${containerPath}`);
      return false;
    }

    const storedSig = await fs.promises.readFile(signaturePath, "utf-8").trim();
    const manifestBuf = await fs.promises.readFile(manifestPath);
    const contentBuf = fs.existsSync(contentGzPath) ? await fs.promises.readFile(contentGzPath) : Buffer.alloc(0);
    const computedSig = computeSignature(manifestBuf, contentBuf);

    const valid = storedSig === computedSig;

    if (!valid) {
      logger.warn("dtu-container", `Integrity check failed for ${containerPath}`);
    }

    return valid;
  } catch (err) {
    logger.error("dtu-container", `Integrity verification error for ${containerPath}: ${err.message}`);
    return false;
  } finally {
    if (extractDir && fs.existsSync(extractDir)) {
      try {
        fs.rmSync(extractDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        // Ignore cleanup errors during verification
      }
    }
  }
}

/**
 * Simple mime type guessing based on file extension.
 * @param {string} filename
 * @returns {string}
 */
function guessMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".gif": "image/gif",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".pdf": "application/pdf",
    ".json": "application/json",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".csv": "text/csv",
    ".zip": "application/zip",
    ".gltf": "model/gltf+json",
  };
  return map[ext] || "application/octet-stream";
}
