/**
 * DTU Compression Pipeline
 *
 * Applies intelligent compression based on content type:
 * - Text/JSON: Brotli (best ratio for text)
 * - Binary artifacts: Gzip (widely supported, good speed/ratio)
 * - Already compressed (images, video): Store raw
 * - Small content (<256 bytes): No compression (overhead > savings)
 *
 * Achieves ~10-50x compression on text content,
 * combined with dedup achieves massive storage savings.
 *
 * Uses Node.js built-in zlib module for Brotli and Gzip.
 */

import {
  brotliCompressSync,
  brotliDecompressSync,
  gzipSync,
  gunzipSync,
  deflateSync,
  inflateSync,
  zstdCompressSync,
  zstdDecompressSync,
  constants as zlibConstants,
} from "zlib";

// Zstd lives in Node's core zlib since v22.15 (stable in v24). Feature-
// detect so an older runtime degrades honestly: id 3 is never selected
// and never silently substituted (see compress/decompress below).
export const ZSTD_AVAILABLE = typeof zstdCompressSync === "function" && typeof zstdDecompressSync === "function";

// ── Algorithm identifiers (match DTU_FORMAT_CONSTANTS) ────────────────
export const COMPRESSION_NONE = 0;
export const COMPRESSION_GZIP = 1;
export const COMPRESSION_BROTLI = 2;
export const COMPRESSION_ZSTD = 3;  // Zstd via core zlib (Node >= 22.15); see ZSTD_AVAILABLE
export const COMPRESSION_DEFLATE = 4;

// Algorithm name mapping
const ALGORITHM_NAMES = {
  [COMPRESSION_NONE]: "none",
  [COMPRESSION_GZIP]: "gzip",
  [COMPRESSION_BROTLI]: "brotli",
  [COMPRESSION_ZSTD]: "zstd",
  [COMPRESSION_DEFLATE]: "deflate",
};

// Minimum size to bother compressing (bytes)
const MIN_COMPRESS_SIZE = 256;

// Minimum size for Zstd selection on generic binary content (bytes)
const ZSTD_MIN_SIZE = 64 * 1024;

// Content types that are already compressed (compression would increase size)
const PRECOMPRESSED_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
  "image/avif", "image/heic", "image/heif",
  "video/mp4", "video/webm", "video/mpeg", "video/quicktime",
  "audio/mp3", "audio/mpeg", "audio/aac", "audio/ogg", "audio/opus",
  "audio/flac", "audio/wav",
  "application/zip", "application/gzip", "application/x-brotli",
  "application/x-7z-compressed", "application/x-rar-compressed",
  "application/x-tar", "application/x-xz",
]);

// Content types best served by Brotli (text-heavy)
const TEXT_TYPES = new Set([
  "text/plain", "text/html", "text/css", "text/csv",
  "text/markdown", "text/xml", "text/javascript",
  "application/json", "application/xml", "application/javascript",
  "application/typescript", "application/x-yaml",
  "application/ld+json", "application/graphql",
]);

/**
 * Create the compression pipeline.
 *
 * @param {object} [opts]
 * @param {function} [opts.log] - Structured logger function
 * @param {number} [opts.brotliQuality] - Brotli quality (0-11, default 6)
 * @param {number} [opts.gzipLevel] - Gzip level (1-9, default 6)
 * @returns {object} Compression pipeline API
 */
export function createCompressionPipeline(opts = {}) {
  const log = opts.log || (() => {});
  const brotliQuality = opts.brotliQuality ?? 6;
  const gzipLevel = opts.gzipLevel ?? 6;
  const zstdLevel = opts.zstdLevel ?? 3;

  // Track cumulative stats
  let totalOriginalBytes = 0;
  let totalCompressedBytes = 0;
  let totalOperations = 0;

  /**
   * Determine the best compression algorithm for a given content type and size.
   *
   * @param {string} contentType - MIME type or generic type hint
   * @param {number} size - Content size in bytes
   * @returns {{ algorithm: number, algorithmName: string, reason: string }}
   */
  function selectAlgorithm(contentType, size) {
    // Too small to compress — overhead exceeds savings
    if (size < MIN_COMPRESS_SIZE) {
      return {
        algorithm: COMPRESSION_NONE,
        algorithmName: "none",
        reason: `Content too small (${size} < ${MIN_COMPRESS_SIZE} bytes)`,
      };
    }

    const ct = (contentType || "").toLowerCase();

    // Already compressed media — no benefit
    if (PRECOMPRESSED_TYPES.has(ct)) {
      return {
        algorithm: COMPRESSION_NONE,
        algorithmName: "none",
        reason: `Content type "${ct}" is already compressed`,
      };
    }

    // Text content — Brotli gives best ratio
    if (TEXT_TYPES.has(ct) || ct.startsWith("text/")) {
      return {
        algorithm: COMPRESSION_BROTLI,
        algorithmName: "brotli",
        reason: `Text content "${ct}" — Brotli optimal`,
      };
    }

    // JSON-like structured data (even without explicit type)
    if (ct.includes("json") || ct.includes("xml") || ct.includes("yaml")) {
      return {
        algorithm: COMPRESSION_BROTLI,
        algorithmName: "brotli",
        reason: `Structured data "${ct}" — Brotli optimal`,
      };
    }

    // Large binary artifacts — Zstd (core zlib) beats Gzip on both speed
    // and ratio at this size; below the threshold Gzip's lower overhead
    // wins. Only when the runtime actually has Zstd (ZSTD_AVAILABLE).
    if ((ct.startsWith("application/") || ct.startsWith("model/")) && ZSTD_AVAILABLE && size >= ZSTD_MIN_SIZE) {
      return {
        algorithm: COMPRESSION_ZSTD,
        algorithmName: "zstd",
        reason: `Large binary content "${ct}" (${size} bytes) — Zstd optimal`,
      };
    }

    // Binary artifacts — Gzip is good balance of speed and ratio
    if (ct.startsWith("application/") || ct.startsWith("model/")) {
      return {
        algorithm: COMPRESSION_GZIP,
        algorithmName: "gzip",
        reason: `Binary content "${ct}" — Gzip balanced`,
      };
    }

    // Default to Gzip for unknown types
    return {
      algorithm: COMPRESSION_GZIP,
      algorithmName: "gzip",
      reason: `Unknown type "${ct}" — defaulting to Gzip`,
    };
  }

  /**
   * Compress content using the optimal algorithm.
   *
   * @param {string|Buffer} content - Content to compress
   * @param {string} [contentType] - MIME type or content type hint
   * @returns {{ compressed: Buffer, algorithm: number, algorithmName: string, originalSize: number, compressedSize: number, ratio: number, reason: string }}
   */
  function compress(content, contentType) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const originalSize = buffer.length;

    const selection = selectAlgorithm(contentType || "", originalSize);

    if (selection.algorithm === COMPRESSION_NONE) {
      totalOriginalBytes += originalSize;
      totalCompressedBytes += originalSize;
      totalOperations++;

      return {
        compressed: buffer,
        algorithm: COMPRESSION_NONE,
        algorithmName: "none",
        originalSize,
        compressedSize: originalSize,
        ratio: 1.0,
        reason: selection.reason,
      };
    }

    let compressed;
    try {
      if (selection.algorithm === COMPRESSION_BROTLI) {
        compressed = brotliCompressSync(buffer, {
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: brotliQuality,
          },
        });
      } else if (selection.algorithm === COMPRESSION_GZIP) {
        compressed = gzipSync(buffer, { level: gzipLevel });
      } else if (selection.algorithm === COMPRESSION_DEFLATE) {
        compressed = deflateSync(buffer, { level: gzipLevel });
      } else if (selection.algorithm === COMPRESSION_ZSTD) {
        // selectAlgorithm only picks Zstd when ZSTD_AVAILABLE, so this
        // never silently substitutes another codec for id 3.
        compressed = zstdCompressSync(buffer, { level: zstdLevel });
      } else {
        // Fallback to gzip
        compressed = gzipSync(buffer, { level: gzipLevel });
      }
    } catch (e) {
      log("error", "compression_failed", {
        algorithm: selection.algorithmName,
        originalSize,
        error: e.message,
      });
      // On failure, return uncompressed
      return {
        compressed: buffer,
        algorithm: COMPRESSION_NONE,
        algorithmName: "none",
        originalSize,
        compressedSize: originalSize,
        ratio: 1.0,
        reason: `Compression failed: ${e.message}`,
      };
    }

    const compressedSize = compressed.length;

    // If compression didn't actually help, store raw
    if (compressedSize >= originalSize) {
      totalOriginalBytes += originalSize;
      totalCompressedBytes += originalSize;
      totalOperations++;

      return {
        compressed: buffer,
        algorithm: COMPRESSION_NONE,
        algorithmName: "none",
        originalSize,
        compressedSize: originalSize,
        ratio: 1.0,
        reason: `Compression expanded data (${compressedSize} >= ${originalSize}), storing raw`,
      };
    }

    const ratio = compressedSize / originalSize;
    totalOriginalBytes += originalSize;
    totalCompressedBytes += compressedSize;
    totalOperations++;

    log("info", "compression_complete", {
      algorithm: selection.algorithmName,
      originalSize,
      compressedSize,
      ratio: ratio.toFixed(4),
      savings: `${((1 - ratio) * 100).toFixed(1)}%`,
    });

    return {
      compressed,
      algorithm: selection.algorithm,
      algorithmName: selection.algorithmName,
      originalSize,
      compressedSize,
      ratio,
      reason: selection.reason,
    };
  }

  /**
   * Decompress content.
   *
   * @param {Buffer} compressed - Compressed content
   * @param {number} algorithm - Algorithm code used for compression
   * @returns {{ decompressed: Buffer, originalSize: number }}
   */
  function decompress(compressed, algorithm) {
    const buffer = Buffer.isBuffer(compressed) ? compressed : Buffer.from(compressed);

    if (algorithm === COMPRESSION_NONE || algorithm === undefined || algorithm === null) {
      return { decompressed: buffer, originalSize: buffer.length };
    }

    let decompressed;
    try {
      if (algorithm === COMPRESSION_BROTLI) {
        decompressed = brotliDecompressSync(buffer);
      } else if (algorithm === COMPRESSION_GZIP) {
        decompressed = gunzipSync(buffer);
      } else if (algorithm === COMPRESSION_DEFLATE) {
        decompressed = inflateSync(buffer);
      } else if (algorithm === COMPRESSION_ZSTD) {
        if (!ZSTD_AVAILABLE) {
          throw new Error("Zstd payload (algorithm=3) cannot be decoded: this Node runtime lacks zlib Zstd support (needs >= 22.15)");
        }
        decompressed = zstdDecompressSync(buffer);
      } else {
        // Try gzip as fallback
        decompressed = gunzipSync(buffer);
      }
    } catch (e) {
      log("error", "decompression_failed", { algorithm, error: e.message });
      throw new Error(`Decompression failed (algorithm=${algorithm}): ${e.message}`);
    }

    return { decompressed, originalSize: decompressed.length };
  }

  /**
   * Get compression analysis for content without actually compressing.
   *
   * @param {string|Buffer} content - Content to analyze
   * @param {string} [contentType] - MIME type hint
   * @returns {object} Analysis report
   */
  function getStats(content, contentType) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const originalSize = buffer.length;
    const selection = selectAlgorithm(contentType || "", originalSize);

    // Actually compress to get real ratio
    const result = compress(content, contentType);

    return {
      originalSize,
      compressedSize: result.compressedSize,
      ratio: result.ratio,
      savings: originalSize - result.compressedSize,
      savingsPercent: ((1 - result.ratio) * 100).toFixed(1) + "%",
      algorithm: result.algorithmName,
      reason: result.reason,
    };
  }

  /**
   * Batch compress multiple DTUs.
   *
   * @param {object[]} dtus - Array of DTU objects with .content and optional .contentType
   * @returns {{ results: object[], totalOriginal: number, totalCompressed: number, overallRatio: number }}
   */
  function batchCompress(dtus) {
    const results = [];
    let totalOriginal = 0;
    let totalCompressed = 0;

    for (const dtu of dtus) {
      const content = dtu.content || "";
      const contentType = dtu.contentType || "application/json";
      const result = compress(content, contentType);

      results.push({
        dtuId: dtu.id,
        algorithm: result.algorithmName,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
        ratio: result.ratio,
      });

      totalOriginal += result.originalSize;
      totalCompressed += result.compressedSize;
    }

    const overallRatio = totalOriginal > 0 ? totalCompressed / totalOriginal : 1.0;

    return {
      results,
      totalOriginal,
      totalCompressed,
      overallRatio,
      overallSavings: totalOriginal - totalCompressed,
      overallSavingsPercent: ((1 - overallRatio) * 100).toFixed(1) + "%",
    };
  }

  /**
   * Get cumulative pipeline statistics.
   *
   * @returns {object} Pipeline stats
   */
  function getPipelineStats() {
    const overallRatio = totalOriginalBytes > 0
      ? totalCompressedBytes / totalOriginalBytes
      : 1.0;

    return {
      totalOperations,
      totalOriginalBytes,
      totalCompressedBytes,
      totalSavedBytes: totalOriginalBytes - totalCompressedBytes,
      overallRatio,
      overallSavingsPercent: ((1 - overallRatio) * 100).toFixed(1) + "%",
    };
  }

  /**
   * Reset cumulative stats.
   */
  function resetStats() {
    totalOriginalBytes = 0;
    totalCompressedBytes = 0;
    totalOperations = 0;
  }

  return {
    compress,
    decompress,
    getStats,
    selectAlgorithm,
    batchCompress,
    getPipelineStats,
    resetStats,

    // Constants for external use
    COMPRESSION_NONE,
    COMPRESSION_GZIP,
    COMPRESSION_BROTLI,
    COMPRESSION_ZSTD,
    COMPRESSION_DEFLATE,
    ALGORITHM_NAMES,
  };
}
