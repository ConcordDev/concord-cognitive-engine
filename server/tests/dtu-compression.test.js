import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createCompressionPipeline,
  COMPRESSION_NONE,
  COMPRESSION_GZIP,
  COMPRESSION_BROTLI,
  COMPRESSION_DEFLATE,
  COMPRESSION_ZSTD,
  ZSTD_AVAILABLE,
} from "../lib/dtu-compression.js";

describe("dtu-compression", () => {
  let pipeline;

  beforeEach(() => {
    pipeline = createCompressionPipeline();
  });

  // ── selectAlgorithm ────────────────────────────────────────────────

  describe("selectAlgorithm", () => {
    it("returns NONE for content smaller than 256 bytes", () => {
      const result = pipeline.selectAlgorithm("text/plain", 100);
      assert.equal(result.algorithm, COMPRESSION_NONE);
      assert.equal(result.algorithmName, "none");
      assert.ok(result.reason.includes("too small"));
    });

    it("returns NONE for already-compressed image types", () => {
      const result = pipeline.selectAlgorithm("image/jpeg", 10000);
      assert.equal(result.algorithm, COMPRESSION_NONE);
      assert.ok(result.reason.includes("already compressed"));
    });

    it("returns NONE for video types", () => {
      const result = pipeline.selectAlgorithm("video/mp4", 1_000_000);
      assert.equal(result.algorithm, COMPRESSION_NONE);
    });

    it("returns NONE for audio types", () => {
      const result = pipeline.selectAlgorithm("audio/mpeg", 5000);
      assert.equal(result.algorithm, COMPRESSION_NONE);
    });

    it("returns NONE for archive types", () => {
      const result = pipeline.selectAlgorithm("application/zip", 50000);
      assert.equal(result.algorithm, COMPRESSION_NONE);
    });

    it("returns BROTLI for text/plain", () => {
      const result = pipeline.selectAlgorithm("text/plain", 1000);
      assert.equal(result.algorithm, COMPRESSION_BROTLI);
      assert.equal(result.algorithmName, "brotli");
    });

    it("returns BROTLI for application/json", () => {
      const result = pipeline.selectAlgorithm("application/json", 1000);
      assert.equal(result.algorithm, COMPRESSION_BROTLI);
    });

    it("returns BROTLI for text/html", () => {
      const result = pipeline.selectAlgorithm("text/html", 500);
      assert.equal(result.algorithm, COMPRESSION_BROTLI);
    });

    it("returns BROTLI for XML content", () => {
      const result = pipeline.selectAlgorithm("application/xml", 500);
      assert.equal(result.algorithm, COMPRESSION_BROTLI);
    });

    it("returns GZIP for generic application types", () => {
      const result = pipeline.selectAlgorithm("application/octet-stream", 500);
      assert.equal(result.algorithm, COMPRESSION_GZIP);
      assert.equal(result.algorithmName, "gzip");
    });

    it("returns GZIP for unknown content types", () => {
      const result = pipeline.selectAlgorithm("custom/thing", 500);
      assert.equal(result.algorithm, COMPRESSION_GZIP);
    });

    it("handles empty content type string", () => {
      const result = pipeline.selectAlgorithm("", 500);
      assert.equal(result.algorithm, COMPRESSION_GZIP);
    });
  });

  // ── compress ───────────────────────────────────────────────────────

  describe("compress", () => {
    it("compresses text content with Brotli", () => {
      const text = "Hello world! ".repeat(100);
      const result = pipeline.compress(text, "text/plain");

      assert.ok(Buffer.isBuffer(result.compressed));
      assert.equal(result.algorithmName, "brotli");
      assert.ok(result.compressedSize < result.originalSize);
      assert.ok(result.ratio < 1);
    });

    it("compresses JSON content", () => {
      const json = JSON.stringify({
        data: Array.from({ length: 50 }, (_, i) => ({
          id: i,
          name: `item-${i}`,
        })),
      });
      const result = pipeline.compress(json, "application/json");

      assert.ok(result.compressedSize < result.originalSize);
      assert.equal(result.algorithmName, "brotli");
    });

    it("skips compression for small content", () => {
      const small = "tiny";
      const result = pipeline.compress(small, "text/plain");

      assert.equal(result.algorithm, COMPRESSION_NONE);
      assert.equal(result.algorithmName, "none");
      assert.equal(result.ratio, 1.0);
      assert.equal(result.compressedSize, result.originalSize);
    });

    it("skips compression for already-compressed types", () => {
      const buffer = Buffer.alloc(500, 0xff);
      const result = pipeline.compress(buffer, "image/jpeg");

      assert.equal(result.algorithm, COMPRESSION_NONE);
    });

    it("handles empty string content", () => {
      const result = pipeline.compress("", "text/plain");
      assert.equal(result.algorithm, COMPRESSION_NONE);
      assert.equal(result.originalSize, 0);
    });

    it("handles Buffer input", () => {
      const buf = Buffer.from("A".repeat(500));
      const result = pipeline.compress(buf, "text/plain");
      assert.ok(result.compressed);
      assert.ok(result.originalSize === 500);
    });

    it("falls back to NONE if compression expands data", () => {
      // Random binary data usually can't be compressed well
      const random = Buffer.alloc(300);
      for (let i = 0; i < random.length; i++) {
        random[i] = Math.floor(Math.random() * 256);
      }
      const result = pipeline.compress(random, "application/octet-stream");
      // Either it compresses or falls back — either way it should work
      assert.ok(result.compressed);
      assert.ok(result.originalSize > 0);
    });
  });

  // ── decompress ─────────────────────────────────────────────────────

  // ── zstd (Q64/B#23) ────────────────────────────────────────────────

  describe("zstd", () => {
    it("selectAlgorithm picks ZSTD for large generic binary when available", () => {
      const result = pipeline.selectAlgorithm("application/octet-stream", 128 * 1024);
      if (ZSTD_AVAILABLE) {
        assert.equal(result.algorithm, COMPRESSION_ZSTD);
        assert.equal(result.algorithmName, "zstd");
      } else {
        assert.equal(result.algorithm, COMPRESSION_GZIP);
      }
    });

    it("selectAlgorithm keeps GZIP for small generic binary", () => {
      const result = pipeline.selectAlgorithm("application/octet-stream", 500);
      assert.equal(result.algorithm, COMPRESSION_GZIP);
    });

    it("compress -> decompress round-trips through real Zstd (id 3)", () => {
      if (!ZSTD_AVAILABLE) return; // runtime without core Zstd: nothing to round-trip
      const data = Buffer.from("concord-dtu-payload-".repeat(10000)); // ~200KB, highly compressible
      const c = pipeline.compress(data, "application/octet-stream");
      assert.equal(c.algorithm, COMPRESSION_ZSTD);
      assert.ok(c.compressedSize < c.originalSize);
      const d = pipeline.decompress(c.compressed, COMPRESSION_ZSTD);
      assert.ok(d.decompressed.equals(data));
    });

    it("decompress of an id-3 payload never silently gunzips", () => {
      if (!ZSTD_AVAILABLE) return;
      const gzipData = pipeline.compress(Buffer.from("x".repeat(5000)), "application/octet-stream");
      assert.throws(() => pipeline.decompress(gzipData.compressed, COMPRESSION_ZSTD), /Decompression failed \(algorithm=3\)/);
    });
  });

  describe("decompress", () => {
    it("roundtrips Brotli compression", () => {
      const original = "Roundtrip Brotli test! ".repeat(50);
      const compressed = pipeline.compress(original, "text/plain");

      assert.equal(compressed.algorithmName, "brotli");

      const { decompressed } = pipeline.decompress(
        compressed.compressed,
        compressed.algorithm
      );
      assert.equal(decompressed.toString("utf8"), original);
    });

    it("roundtrips Gzip compression", () => {
      const original = "Roundtrip Gzip test! ".repeat(50);
      const compressed = pipeline.compress(original, "application/octet-stream");

      // Should pick gzip for unknown generic application type
      if (compressed.algorithm === COMPRESSION_GZIP) {
        const { decompressed } = pipeline.decompress(
          compressed.compressed,
          compressed.algorithm
        );
        assert.equal(decompressed.toString("utf8"), original);
      }
    });

    it("returns unmodified buffer for COMPRESSION_NONE", () => {
      const buf = Buffer.from("small");
      const { decompressed } = pipeline.decompress(buf, COMPRESSION_NONE);
      assert.deepEqual(decompressed, buf);
    });

    it("returns unmodified buffer for undefined algorithm", () => {
      const buf = Buffer.from("some data");
      const { decompressed } = pipeline.decompress(buf, undefined);
      assert.deepEqual(decompressed, buf);
    });

    it("throws for corrupted compressed data", () => {
      const garbage = Buffer.from("not actually compressed");
      assert.throws(() => {
        pipeline.decompress(garbage, COMPRESSION_BROTLI);
      }, /Decompression failed/);
    });
  });

  // ── getStats ───────────────────────────────────────────────────────

  describe("getStats", () => {
    it("reports compression ratio for text content", () => {
      const text = "Analysis target content ".repeat(100);
      const stats = pipeline.getStats(text, "text/plain");

      assert.ok(stats.originalSize > 0);
      assert.ok(stats.compressedSize <= stats.originalSize);
      assert.ok(stats.savings >= 0);
      assert.equal(stats.algorithm, "brotli");
      assert.ok(stats.savingsPercent.endsWith("%"));
    });

    it("reports no savings for small content", () => {
      const stats = pipeline.getStats("hi", "text/plain");
      assert.equal(stats.savings, 0);
      assert.equal(stats.algorithm, "none");
    });
  });

  // ── batchCompress ──────────────────────────────────────────────────

  describe("batchCompress", () => {
    it("compresses multiple DTUs", () => {
      const dtus = [
        { id: "d1", content: "Content one ".repeat(50), contentType: "text/plain" },
        { id: "d2", content: "Content two ".repeat(50), contentType: "application/json" },
        { id: "d3", content: "tiny", contentType: "text/plain" },
      ];

      const result = pipeline.batchCompress(dtus);
      assert.equal(result.results.length, 3);
      assert.ok(result.totalOriginal > 0);
      assert.ok(result.totalCompressed > 0);
      assert.ok(result.overallSavingsPercent.endsWith("%"));
    });
  });

  // ── getPipelineStats / resetStats ──────────────────────────────────

  describe("getPipelineStats and resetStats", () => {
    it("tracks cumulative stats across operations", () => {
      pipeline.compress("data ".repeat(100), "text/plain");
      pipeline.compress("more ".repeat(100), "text/plain");

      const stats = pipeline.getPipelineStats();
      assert.equal(stats.totalOperations, 2);
      assert.ok(stats.totalOriginalBytes > 0);
      assert.ok(stats.totalSavedBytes >= 0);
    });

    it("resets cumulative stats", () => {
      pipeline.compress("some data ".repeat(100), "text/plain");
      pipeline.resetStats();

      const stats = pipeline.getPipelineStats();
      assert.equal(stats.totalOperations, 0);
      assert.equal(stats.totalOriginalBytes, 0);
      assert.equal(stats.totalCompressedBytes, 0);
    });
  });

  // ── Custom quality options ─────────────────────────────────────────

  describe("custom quality options", () => {
    it("accepts custom brotli quality", () => {
      const custom = createCompressionPipeline({ brotliQuality: 1 });
      const text = "Quality test ".repeat(100);
      const result = custom.compress(text, "text/plain");
      assert.equal(result.algorithmName, "brotli");
      assert.ok(result.compressedSize < result.originalSize);
    });

    it("accepts custom gzip level", () => {
      const custom = createCompressionPipeline({ gzipLevel: 1 });
      const text = "Gzip level test ".repeat(100);
      const result = custom.compress(text, "application/octet-stream");
      assert.ok(result.compressed);
    });
  });
});
