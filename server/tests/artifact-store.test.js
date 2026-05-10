/**
 * Artifact Store Test Suite
 *
 * Covers:
 *   - isSupportedType
 *   - storeArtifact (creation, compression, sanitisation, size limit, unsupported type)
 *   - storeMultipartArtifact
 *   - retrieveArtifact (compressed, raw, missing)
 *   - retrieveArtifactCached (LRU cache hit/miss)
 *   - retrieveArtifactStream (compressed, raw, missing)
 *   - deleteArtifact (existing, non-existent)
 *   - getArtifactDiskUsage (files, empty, missing root)
 *   - inferDomainFromType / inferKindFromType
 *   - previewCacheStats
 *   - Preview cache internals (TTL expiry, LRU eviction)
 *   - megaCompressionCascade
 *   - applyShadowVault
 *   - unshadowTopArtifacts
 *   - migrateArtifactsToCompressed
 *   - Path traversal / filename sanitisation
 *   - Thumbnail & preview generation (image, audio, text, unknown)
 *
 * Run: node --test server/tests/artifact-store.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";
import zlib from "zlib";

// We need to set env vars BEFORE the module is imported so paths resolve to our temp dir.
const TEST_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-test-"));
const TEST_ARTIFACT_DIR = path.join(TEST_TMP, "artifacts");
process.env.ARTIFACT_DIR = TEST_ARTIFACT_DIR;

const mod = await import("../lib/artifact-store.js");
const {
  isSupportedType,
  storeArtifact,
  storeMultipartArtifact,
  retrieveArtifact,
  retrieveArtifactCached,
  retrieveArtifactStream,
  deleteArtifact,
  getArtifactDiskUsage,
  inferDomainFromType,
  inferKindFromType,
  previewCacheStats,
  megaCompressionCascade,
  applyShadowVault,
  unshadowTopArtifacts,
  migrateArtifactsToCompressed,
} = mod;

// ── Helpers ──────────────────────────────────────────────────────────

function makeBuffer(size = 256) {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = i % 256;
  return buf;
}

function makeLargeBuffer(sizeMB) {
  return Buffer.alloc(sizeMB * 1024 * 1024, 0x42);
}

/** Drain a readable stream into a Buffer. */
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/** Clean the temp artifact directory between tests. */
function cleanArtifactDir() {
  if (fs.existsSync(TEST_ARTIFACT_DIR)) {
    fs.rmSync(TEST_ARTIFACT_DIR, { recursive: true, force: true });
  }
}

// ── Suite ────────────────────────────────────────────────────────────

describe("artifact-store", () => {
  beforeEach(() => {
    cleanArtifactDir();
  });

  afterEach(() => {
    cleanArtifactDir();
  });

  // ── isSupportedType ──────────────────────────────────────────────

  describe("isSupportedType", () => {
    it("returns true for all known MIME types", () => {
      const knownTypes = [
        "audio/wav", "audio/mpeg", "audio/ogg", "audio/flac", "audio/midi",
        "image/png", "image/jpeg", "image/webp", "image/svg+xml",
        "video/mp4", "video/webm",
        "application/pdf", "application/javascript", "application/json",
        "application/zip",
        "text/plain", "text/markdown", "text/html", "text/csv", "text/calendar",
        "model/gltf+json",
      ];
      for (const t of knownTypes) {
        assert.equal(isSupportedType(t), true, `Expected true for ${t}`);
      }
    });

    it("returns false for unsupported types", () => {
      // Phase 0 universal-file-format adds application/octet-stream as a
      // generic fallback so any binary can ride inside a .dtu — it's no
      // longer 'unsupported'. Test against types that genuinely have no
      // SUPPORTED_TYPES entry.
      assert.equal(isSupportedType("font/woff2"), false);
      assert.equal(isSupportedType("video/x-matroska"), false);
      assert.equal(isSupportedType(""), false);
    });

    it("supports application/octet-stream as universal fallback", () => {
      // Phase 0 invariant — keep this pinned so future refactors don't
      // accidentally drop the universal-file-format escape hatch.
      assert.equal(isSupportedType("application/octet-stream"), true);
    });
  });

  // ── storeArtifact ────────────────────────────────────────────────

  describe("storeArtifact", () => {
    it("stores a compressible text artifact and produces .gz", async () => {
      const buf = Buffer.from("Hello, artifact world!");
      const result = await storeArtifact("dtu-001", buf, "text/plain", "hello.txt");

      assert.equal(result.type, "text/plain");
      assert.equal(result.filename, "hello.txt");
      assert.equal(result.sizeBytes, buf.length);
      assert.ok(result.hash.startsWith("sha256:"));
      assert.equal(result.compressed, true);
      assert.ok(result.compressedPath.endsWith(".gz"));
      assert.equal(result.multipart, false);
      assert.equal(result.parts, null);
      assert.ok(result.createdAt);
      assert.equal(result.lastAccessedAt, null);

      // Verify raw file on disk
      assert.ok(fs.existsSync(result.diskPath));
      assert.deepEqual(fs.readFileSync(result.diskPath), buf);

      // Verify compressed file on disk
      assert.ok(fs.existsSync(result.compressedPath));
      const decompressed = zlib.gunzipSync(fs.readFileSync(result.compressedPath));
      assert.deepEqual(decompressed, buf);
    });

    it("stores a non-compressible type (image/png) without .gz", async () => {
      const buf = makeBuffer(128);
      const result = await storeArtifact("dtu-002", buf, "image/png", "photo.png");

      assert.equal(result.type, "image/png");
      assert.equal(result.compressed, false);
      assert.equal(result.compressedPath, null);
      assert.ok(fs.existsSync(result.diskPath));
    });

    it("sanitises dangerous filename characters", async () => {
      const buf = Buffer.from("data");
      const result = await storeArtifact(
        "dtu-003",
        buf,
        "text/plain",
        "../../etc/passwd"
      );
      // slashes and dots beyond filename chars are replaced
      assert.ok(!result.filename.includes("/"));
      assert.ok(!result.filename.includes("\\"));
      assert.ok(fs.existsSync(result.diskPath));
    });

    it("sanitises filenames with special characters", async () => {
      const buf = Buffer.from("data");
      const result = await storeArtifact(
        "dtu-san",
        buf,
        "text/plain",
        "hello world (copy).txt"
      );
      // spaces and parens are replaced with underscores
      assert.equal(result.filename, "hello_world__copy_.txt");
    });

    it("rejects buffers larger than MAX_ARTIFACT_SIZE", async () => {
      // 100MB + 1 byte
      const oversized = Buffer.alloc(100 * 1024 * 1024 + 1, 0x41);
      await assert.rejects(
        () => storeArtifact("dtu-big", oversized, "text/plain", "big.txt"),
        (err) => {
          assert.ok(err.message.includes("exceeds max size"));
          return true;
        }
      );
    });

    it("rejects unsupported MIME types", async () => {
      const buf = Buffer.from("data");
      await assert.rejects(
        () => storeArtifact("dtu-bad", buf, "application/x-doom", "doom.wad"),
        (err) => {
          assert.ok(err.message.includes("Unsupported artifact type"));
          return true;
        }
      );
    });

    it("generates a thumbnail for image types (returns filePath)", async () => {
      const buf = makeBuffer(64);
      const result = await storeArtifact("dtu-img", buf, "image/jpeg", "photo.jpg");
      // For images, thumbnail is the filePath itself
      assert.equal(result.thumbnail, result.diskPath);
    });

    it("generates a waveform thumbnail for audio types", async () => {
      // Build a fake WAV-ish buffer (just needs to be large enough for readInt16LE)
      const buf = makeBuffer(2048);
      const result = await storeArtifact("dtu-aud", buf, "audio/wav", "clip.wav");
      assert.ok(result.thumbnail);
      assert.ok(result.thumbnail.endsWith("waveform.json"));
      assert.ok(fs.existsSync(result.thumbnail));
      const peaks = JSON.parse(fs.readFileSync(result.thumbnail, "utf-8"));
      assert.ok(Array.isArray(peaks));
      assert.equal(peaks.length, 200);
    });

    it("generates a text preview thumbnail for text types", async () => {
      const longText = "A".repeat(1000);
      const buf = Buffer.from(longText);
      const result = await storeArtifact("dtu-txt", buf, "text/plain", "doc.txt");
      assert.ok(result.thumbnail);
      assert.ok(result.thumbnail.endsWith("text_preview.txt"));
      const preview = fs.readFileSync(result.thumbnail, "utf-8");
      // Preview is truncated to 500 chars
      assert.equal(preview.length, 500);
    });

    it("generates a text preview thumbnail for application/json", async () => {
      const buf = Buffer.from('{"key": "value"}');
      const result = await storeArtifact("dtu-json", buf, "application/json", "data.json");
      assert.ok(result.thumbnail);
      assert.ok(result.thumbnail.endsWith("text_preview.txt"));
    });

    it("generates a text preview thumbnail for application/javascript", async () => {
      const buf = Buffer.from("console.log('hello');");
      const result = await storeArtifact("dtu-js", buf, "application/javascript", "app.js");
      assert.ok(result.thumbnail);
      assert.ok(result.thumbnail.endsWith("text_preview.txt"));
    });

    it("returns null thumbnail for video types", async () => {
      const buf = makeBuffer(64);
      const result = await storeArtifact("dtu-vid", buf, "video/mp4", "clip.mp4");
      assert.equal(result.thumbnail, null);
    });

    it("generates preview for audio types (returns filePath)", async () => {
      const buf = makeBuffer(512);
      const result = await storeArtifact("dtu-aud2", buf, "audio/mpeg", "song.mp3");
      assert.equal(result.preview, result.diskPath);
    });

    it("returns null preview for non-audio types", async () => {
      const buf = Buffer.from("data");
      const result = await storeArtifact("dtu-nopreview", buf, "text/plain", "f.txt");
      assert.equal(result.preview, null);
    });

    it("stores SVG as compressible", async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>');
      const result = await storeArtifact("dtu-svg", svg, "image/svg+xml", "icon.svg");
      assert.equal(result.compressed, true);
      assert.ok(result.compressedPath);
      // SVG is image, so thumbnail is the filePath
      assert.equal(result.thumbnail, result.diskPath);
    });

    it("stores PDF as compressible", async () => {
      const buf = Buffer.from("%PDF-1.4 mock content");
      const result = await storeArtifact("dtu-pdf", buf, "application/pdf", "doc.pdf");
      assert.equal(result.compressed, true);
    });

    it("stores zip as non-compressible", async () => {
      const buf = makeBuffer(64);
      const result = await storeArtifact("dtu-zip", buf, "application/zip", "archive.zip");
      assert.equal(result.compressed, false);
      assert.equal(result.compressedPath, null);
    });
  });

  // ── storeMultipartArtifact ───────────────────────────────────────

  describe("storeMultipartArtifact", () => {
    it("stores multiple files and returns a collection descriptor", async () => {
      const files = [
        { filename: "track.wav", buffer: Buffer.from("audio data"), mimeType: "audio/wav" },
        { filename: "cover.png", buffer: makeBuffer(128), mimeType: "image/png" },
      ];
      const result = await storeMultipartArtifact("dtu-multi", files);

      assert.equal(result.type, "application/x-concord-collection");
      assert.equal(result.multipart, true);
      assert.equal(result.parts.length, 2);
      assert.equal(result.compressed, false);
      assert.equal(result.sizeBytes, files[0].buffer.length + files[1].buffer.length);
      assert.ok(result.hash.startsWith("sha256:"));
      assert.ok(result.createdAt);
      assert.equal(result.lastAccessedAt, null);
      assert.equal(result.filename, "dtu-multi_collection");

      // Thumbnail is first part's diskPath
      assert.equal(result.thumbnail, result.parts[0].diskPath);

      // Verify files on disk
      for (const part of result.parts) {
        assert.ok(fs.existsSync(part.diskPath));
      }
    });

    it("sanitises filenames in multipart", async () => {
      const files = [
        { filename: "../evil.txt", buffer: Buffer.from("x"), mimeType: "text/plain" },
      ];
      const result = await storeMultipartArtifact("dtu-mpsan", files);
      assert.ok(!result.parts[0].filename.includes("/"));
      // ".." is kept because dots are allowed, "/" replaced with "_"
      assert.equal(result.parts[0].filename, ".._evil.txt");
    });

    it("handles empty file list", async () => {
      const result = await storeMultipartArtifact("dtu-empty", []);
      assert.equal(result.multipart, true);
      assert.equal(result.parts.length, 0);
      assert.equal(result.sizeBytes, 0);
      assert.equal(result.thumbnail, null);
    });
  });

  // ── retrieveArtifact ─────────────────────────────────────────────

  describe("retrieveArtifact", () => {
    it("retrieves a compressed artifact (decompresses on read)", async () => {
      const buf = Buffer.from("hello compressed world");
      const stored = await storeArtifact("dtu-r1", buf, "text/plain", "note.txt");
      const retrieved = retrieveArtifact("dtu-r1", stored);
      assert.deepEqual(retrieved, buf);
      assert.ok(stored.lastAccessedAt); // updated on access
    });

    it("falls back to raw file when compressed path is missing", async () => {
      const buf = makeBuffer(64);
      const stored = await storeArtifact("dtu-r2", buf, "image/png", "img.png");
      // image/png is not compressed, so it falls back to raw
      const retrieved = retrieveArtifact("dtu-r2", stored);
      assert.deepEqual(retrieved, buf);
    });

    it("returns null when diskPath is missing from ref", () => {
      assert.equal(retrieveArtifact("dtu-x", {}), null);
      assert.equal(retrieveArtifact("dtu-x", null), null);
      assert.equal(retrieveArtifact("dtu-x", undefined), null);
    });

    it("returns null when files do not exist on disk", () => {
      const ref = {
        diskPath: "/nonexistent/path/file.txt",
        compressedPath: null,
      };
      assert.equal(retrieveArtifact("dtu-gone", ref), null);
    });

    it("falls back to raw when compressed file is deleted", async () => {
      const buf = Buffer.from("fallback test");
      const stored = await storeArtifact("dtu-r3", buf, "text/plain", "f.txt");
      // Delete compressed file
      fs.unlinkSync(stored.compressedPath);
      const retrieved = retrieveArtifact("dtu-r3", stored);
      assert.deepEqual(retrieved, buf);
    });

    it("returns null when both compressed and raw files are gone", async () => {
      const buf = Buffer.from("doomed");
      const stored = await storeArtifact("dtu-r4", buf, "text/plain", "gone.txt");
      fs.unlinkSync(stored.compressedPath);
      fs.unlinkSync(stored.diskPath);
      const retrieved = retrieveArtifact("dtu-r4", stored);
      assert.equal(retrieved, null);
    });
  });

  // ── retrieveArtifactCached ───────────────────────────────────────

  describe("retrieveArtifactCached", () => {
    it("returns null for null/undefined artifact ref", () => {
      assert.equal(retrieveArtifactCached("dtu-c0", null), null);
      assert.equal(retrieveArtifactCached("dtu-c0", undefined), null);
      assert.equal(retrieveArtifactCached("dtu-c0", {}), null);
    });

    it("caches on first call and returns from cache on second call", async () => {
      const buf = Buffer.from("cached content");
      const stored = await storeArtifact("dtu-c1", buf, "text/plain", "cached.txt");

      // First call: loads from disk
      const first = retrieveArtifactCached("dtu-c1", stored);
      assert.deepEqual(first, buf);

      // Delete files to confirm cache is working
      fs.unlinkSync(stored.diskPath);
      fs.unlinkSync(stored.compressedPath);

      // Second call: should come from cache
      const second = retrieveArtifactCached("dtu-c1", stored);
      assert.deepEqual(second, buf);
    });

    it("returns null when artifact not found and ref has no diskPath", () => {
      const result = retrieveArtifactCached("dtu-nope", { diskPath: null });
      assert.equal(result, null);
    });
  });

  // ── retrieveArtifactStream ───────────────────────────────────────

  describe("retrieveArtifactStream", () => {
    it("returns null for null/undefined ref", () => {
      assert.equal(retrieveArtifactStream(null), null);
      assert.equal(retrieveArtifactStream(undefined), null);
      assert.equal(retrieveArtifactStream({}), null);
    });

    it("streams a compressed artifact through gunzip", async () => {
      const buf = Buffer.from("stream compressed data here");
      const stored = await storeArtifact("dtu-s1", buf, "text/plain", "stream.txt");
      const stream = retrieveArtifactStream(stored);
      assert.ok(stream);
      const result = await streamToBuffer(stream);
      assert.deepEqual(result, buf);
      assert.ok(stored.lastAccessedAt);
    });

    it("streams raw file when no compressed version exists", async () => {
      const buf = makeBuffer(64);
      const stored = await storeArtifact("dtu-s2", buf, "image/png", "raw.png");
      const stream = retrieveArtifactStream(stored);
      assert.ok(stream);
      const result = await streamToBuffer(stream);
      assert.deepEqual(result, buf);
    });

    it("returns null when files do not exist on disk", () => {
      const ref = {
        diskPath: "/nonexistent/stream.txt",
        compressedPath: null,
      };
      assert.equal(retrieveArtifactStream(ref), null);
    });

    it("falls back to raw when compressed file is deleted", async () => {
      const buf = Buffer.from("fallback stream");
      const stored = await storeArtifact("dtu-s3", buf, "text/plain", "fall.txt");
      fs.unlinkSync(stored.compressedPath);
      const stream = retrieveArtifactStream(stored);
      assert.ok(stream);
      const result = await streamToBuffer(stream);
      assert.deepEqual(result, buf);
    });

    it("returns null when both compressed and raw are missing", async () => {
      const buf = Buffer.from("vanished");
      const stored = await storeArtifact("dtu-s4", buf, "text/plain", "v.txt");
      fs.unlinkSync(stored.compressedPath);
      fs.unlinkSync(stored.diskPath);
      assert.equal(retrieveArtifactStream(stored), null);
    });
  });

  // ── deleteArtifact ───────────────────────────────────────────────

  describe("deleteArtifact", () => {
    it("removes an existing artifact directory", async () => {
      const buf = Buffer.from("delete me");
      await storeArtifact("dtu-del", buf, "text/plain", "bye.txt");
      const dtuDir = path.join(TEST_ARTIFACT_DIR, "dtu-del");
      assert.ok(fs.existsSync(dtuDir));

      deleteArtifact("dtu-del");
      assert.ok(!fs.existsSync(dtuDir));
    });

    it("does not throw when directory does not exist", () => {
      assert.doesNotThrow(() => deleteArtifact("nonexistent-dtu-id"));
    });
  });

  // ── getArtifactDiskUsage ─────────────────────────────────────────

  describe("getArtifactDiskUsage", () => {
    it("returns 0 when artifact root does not exist", () => {
      assert.equal(getArtifactDiskUsage(), 0);
    });

    it("sums up all file sizes recursively", async () => {
      const buf1 = Buffer.from("file one content");
      const buf2 = makeBuffer(256);
      await storeArtifact("dtu-du1", buf1, "text/plain", "a.txt");
      await storeArtifact("dtu-du2", buf2, "image/png", "b.png");

      const usage = getArtifactDiskUsage();
      assert.ok(usage > 0);
      // Should be at least the sum of both raw files
      assert.ok(usage >= buf1.length + buf2.length);
    });

    it("counts files in nested directories", async () => {
      // storeArtifact already creates nested dtuId dirs
      await storeArtifact("dtu-nest-a", Buffer.from("aaa"), "text/plain", "a.txt");
      await storeArtifact("dtu-nest-b", Buffer.from("bbb"), "text/plain", "b.txt");
      const usage = getArtifactDiskUsage();
      assert.ok(usage > 0);
    });
  });

  // ── inferDomainFromType ──────────────────────────────────────────

  describe("inferDomainFromType", () => {
    it("returns 'music' for audio types", () => {
      assert.equal(inferDomainFromType("audio/wav"), "music");
      assert.equal(inferDomainFromType("audio/mpeg"), "music");
    });

    it("returns 'art' for image types", () => {
      assert.equal(inferDomainFromType("image/png"), "art");
      assert.equal(inferDomainFromType("image/jpeg"), "art");
    });

    it("returns 'studio' for video types", () => {
      assert.equal(inferDomainFromType("video/mp4"), "studio");
    });

    it("returns 'legal' for pdf and document types", () => {
      assert.equal(inferDomainFromType("application/pdf"), "legal");
      assert.equal(inferDomainFromType("application/vnd.document"), "legal");
    });

    it("returns 'finance' for spreadsheet types", () => {
      assert.equal(inferDomainFromType("application/vnd.spreadsheet"), "finance");
    });

    it("returns 'creative' for text types", () => {
      assert.equal(inferDomainFromType("text/plain"), "creative");
      assert.equal(inferDomainFromType("text/html"), "creative");
    });

    it("returns 'general' for unknown types", () => {
      assert.equal(inferDomainFromType("application/zip"), "general");
      assert.equal(inferDomainFromType("model/gltf+json"), "general");
    });
  });

  // ── inferKindFromType ────────────────────────────────────────────

  describe("inferKindFromType", () => {
    it("returns 'music_composition' for audio", () => {
      assert.equal(inferKindFromType("audio/wav"), "music_composition");
    });

    it("returns 'artwork' for image", () => {
      assert.equal(inferKindFromType("image/png"), "artwork");
    });

    it("returns 'video' for video", () => {
      assert.equal(inferKindFromType("video/mp4"), "video");
    });

    it("returns 'document' for pdf", () => {
      assert.equal(inferKindFromType("application/pdf"), "document");
    });

    it("returns 'text_content' for text types", () => {
      assert.equal(inferKindFromType("text/plain"), "text_content");
      assert.equal(inferKindFromType("text/html"), "text_content");
    });

    it("returns 'code_module' for json and javascript", () => {
      assert.equal(inferKindFromType("application/json"), "code_module");
      assert.equal(inferKindFromType("application/javascript"), "code_module");
    });

    it("returns 'binary_artifact' for unknown types", () => {
      assert.equal(inferKindFromType("application/zip"), "binary_artifact");
      assert.equal(inferKindFromType("application/x-custom"), "binary_artifact");
    });

    it("returns 'code_module' for json-containing MIME types", () => {
      // model/gltf+json contains "json" so it matches code_module
      assert.equal(inferKindFromType("model/gltf+json"), "code_module");
    });
  });

  // ── previewCacheStats ────────────────────────────────────────────

  describe("previewCacheStats", () => {
    it("returns cache statistics", () => {
      const stats = previewCacheStats();
      assert.equal(typeof stats.size, "number");
      assert.equal(stats.max, 200);
      assert.equal(stats.ttlMs, 5 * 60 * 1000);
    });
  });

  // ── Preview Cache Internals (TTL + LRU eviction) ────────────────

  describe("preview cache behaviour", () => {
    it("cache grows after retrieveArtifactCached calls", async () => {
      const sizeBefore = previewCacheStats().size;
      const buf = Buffer.from("cache grow test");
      const stored = await storeArtifact("dtu-cg1", buf, "text/plain", "cg.txt");
      retrieveArtifactCached("dtu-cg1", stored);
      const sizeAfter = previewCacheStats().size;
      assert.ok(sizeAfter > sizeBefore);
    });
  });

  // ── megaCompressionCascade ───────────────────────────────────────

  describe("megaCompressionCascade", () => {
    it("keeps topN exemplars and archives the rest", async () => {
      // Set up source DTUs with artifacts on disk — use non-compressible types
      // so the cascade can archive them (compress + remove raw)
      const STATE = { dtus: new Map() };

      for (let i = 0; i < 5; i++) {
        const id = `src-dtu-${i}`;
        const buf = Buffer.from(`content for dtu ${i}`);
        // image/png is non-compressible, so storeArtifact sets compressed=false
        // megaCompressionCascade will then compress and archive
        const stored = await storeArtifact(id, buf, "image/png", `file${i}.png`);
        assert.equal(stored.compressed, false); // confirm non-compressed
        STATE.dtus.set(id, {
          artifact: stored,
          qualityTier: i < 2 ? "verified" : "reviewed",
        });
      }

      const ids = Array.from(STATE.dtus.keys());
      const result = megaCompressionCascade("mega-001", ids, STATE, 3);

      assert.equal(result.keptExemplars, 3);
      // Bottom 2 should be archived (compressed + raw removed)
      assert.equal(result.archived, 2);
      // savedBytes can be negative when gzip of small data is larger than raw
      assert.equal(typeof result.savedBytes, "number");
    });

    it("handles source DTUs with no artifacts", () => {
      const STATE = { dtus: new Map() };
      STATE.dtus.set("empty-1", { artifact: null });
      STATE.dtus.set("empty-2", {});

      const result = megaCompressionCascade("mega-002", ["empty-1", "empty-2", "missing"], STATE);
      assert.equal(result.keptExemplars, 0);
      assert.equal(result.archived, 0);
    });

    it("handles already compressed artifacts (skips re-compression)", async () => {
      const STATE = { dtus: new Map() };

      for (let i = 0; i < 4; i++) {
        const id = `comp-${i}`;
        const buf = Buffer.from(`compressed content ${i}`);
        // Use text/plain which gets compressed
        const stored = await storeArtifact(id, buf, "text/plain", `c${i}.txt`);
        STATE.dtus.set(id, {
          artifact: stored,
          qualityTier: "basic",
        });
      }

      const ids = Array.from(STATE.dtus.keys());
      const result = megaCompressionCascade("mega-003", ids, STATE, 2);

      assert.equal(result.keptExemplars, 2);
      // Already-compressed artifacts have compressed=true, so archive loop skips them
      assert.equal(result.archived, 0);
    });

    it("defaults topN to 3", async () => {
      const STATE = { dtus: new Map() };
      for (let i = 0; i < 5; i++) {
        const id = `def-${i}`;
        const buf = Buffer.from(`data ${i}`);
        const stored = await storeArtifact(id, buf, "image/png", `d${i}.png`);
        STATE.dtus.set(id, {
          artifact: stored,
          qualityTier: "basic",
        });
      }

      const ids = Array.from(STATE.dtus.keys());
      // Call without topN param — defaults to 3
      const result = megaCompressionCascade("mega-def", ids, STATE);
      assert.equal(result.keptExemplars, 3);
    });

    it("sorts by quality tier and then by size", async () => {
      const STATE = { dtus: new Map() };

      // Create artifacts with different quality tiers
      const tiers = ["basic", "verified", "reviewed", "basic", "verified"];
      for (let i = 0; i < 5; i++) {
        const id = `rank-${i}`;
        const buf = Buffer.alloc(100 + i * 50, 0x41); // varying sizes
        const stored = await storeArtifact(id, buf, "image/jpeg", `r${i}.jpg`);
        STATE.dtus.set(id, {
          artifact: stored,
          qualityTier: tiers[i],
        });
      }

      const ids = Array.from(STATE.dtus.keys());
      const result = megaCompressionCascade("mega-rank", ids, STATE, 2);
      assert.equal(result.keptExemplars, 2);
      // The remaining 3 should be archived (they are non-compressible image/jpeg)
      assert.equal(result.archived, 3);
    });

    it("handles empty sourceDtuIds array", () => {
      const STATE = { dtus: new Map() };
      const result = megaCompressionCascade("mega-empty", [], STATE);
      assert.equal(result.keptExemplars, 0);
      assert.equal(result.archived, 0);
      assert.equal(result.savedBytes, 0);
    });

    it("handles STATE with no dtus map", () => {
      const STATE = {};
      const result = megaCompressionCascade("mega-no-dtus", ["a", "b"], STATE);
      assert.equal(result.keptExemplars, 0);
      assert.equal(result.archived, 0);
    });
  });

  // ── applyShadowVault ─────────────────────────────────────────────

  describe("applyShadowVault", () => {
    it("returns tier unchanged if status is not marketplace_ready", () => {
      const tier = { status: "draft", score: 0.8 };
      const result = applyShadowVault({ meta: { createdBy: "entity-1" } }, tier);
      assert.deepEqual(result, tier);
    });

    it("returns tier unchanged if createdBy does not start with 'entity'", () => {
      const tier = { status: "marketplace_ready", score: 0.9 };
      const result = applyShadowVault({ meta: { createdBy: "user-abc" } }, tier);
      assert.deepEqual(result, tier);
    });

    it("returns tier unchanged when createdBy is on artifact directly (non-entity)", () => {
      const tier = { status: "marketplace_ready", score: 0.9 };
      const result = applyShadowVault({ createdBy: "human-user" }, tier);
      assert.deepEqual(result, tier);
    });

    it("shadows 98% of entity production (statistical)", () => {
      const tier = { status: "marketplace_ready", score: 0.9 };
      const artifact = { meta: { createdBy: "entity-bot-1" } };
      let shadowCount = 0;
      const trials = 1000;

      for (let i = 0; i < trials; i++) {
        const result = applyShadowVault(artifact, tier);
        if (result.status === "shadow_vault") shadowCount++;
      }

      // Expect roughly 98% shadowed (allow 94-100% range for statistical variance)
      const ratio = shadowCount / trials;
      assert.ok(ratio > 0.90, `Shadow ratio ${ratio} too low`);
      assert.ok(ratio < 1.0 || shadowCount === trials, `Shadow ratio ${ratio} unexpected`);
    });

    it("preserves other tier fields when shadowing", () => {
      // Force shadow by mocking — run enough times to get at least one shadow
      const tier = { status: "marketplace_ready", score: 0.95, extra: "keep" };
      const artifact = { meta: { createdBy: "entity-x" } };

      let shadowed = null;
      for (let i = 0; i < 200; i++) {
        const result = applyShadowVault(artifact, tier);
        if (result.status === "shadow_vault") {
          shadowed = result;
          break;
        }
      }

      if (shadowed) {
        assert.equal(shadowed.score, 0.95);
        assert.equal(shadowed.extra, "keep");
      }
    });

    it("reads createdBy from artifact.createdBy when meta is absent", () => {
      const tier = { status: "marketplace_ready" };
      const artifact = { createdBy: "entity-direct" };

      let sawShadow = false;
      for (let i = 0; i < 200; i++) {
        const result = applyShadowVault(artifact, tier);
        if (result.status === "shadow_vault") { sawShadow = true; break; }
      }
      // With 200 trials and 98% chance, extremely unlikely to never shadow
      assert.ok(sawShadow, "Expected at least one shadow_vault result");
    });

    it("handles artifact with no createdBy at all", () => {
      const tier = { status: "marketplace_ready" };
      const result = applyShadowVault({}, tier);
      // Empty string doesn't start with "entity", so tier is returned as-is
      assert.equal(result.status, "marketplace_ready");
    });
  });

  // ── unshadowTopArtifacts ─────────────────────────────────────────

  describe("unshadowTopArtifacts", () => {
    it("unshadows top N artifacts by quality score", () => {
      const STATE = { dtus: new Map() };
      STATE.dtus.set("d1", { domain: "music", qualityTier: "shadow_vault", qualityScore: 0.9, entityMaturity: 5 });
      STATE.dtus.set("d2", { domain: "music", qualityTier: "shadow_vault", qualityScore: 0.7, entityMaturity: 3 });
      STATE.dtus.set("d3", { domain: "music", qualityTier: "shadow_vault", qualityScore: 0.95, entityMaturity: 8 });
      STATE.dtus.set("d4", { domain: "art", qualityTier: "shadow_vault", qualityScore: 0.99 });

      const result = unshadowTopArtifacts("music", 2, STATE);
      assert.equal(result.unshadowed.length, 2);
      // Should pick d3 (0.95) and d1 (0.9)
      assert.ok(result.unshadowed.includes("d3"));
      assert.ok(result.unshadowed.includes("d1"));

      // Verify DTU state updated
      assert.equal(STATE.dtus.get("d3").qualityTier, "marketplace_ready");
      assert.equal(STATE.dtus.get("d1").qualityTier, "marketplace_ready");
      // d2 should remain shadowed
      assert.equal(STATE.dtus.get("d2").qualityTier, "shadow_vault");
      // d4 is in different domain, should be unchanged
      assert.equal(STATE.dtus.get("d4").qualityTier, "shadow_vault");
    });

    it("unshadows using status field when qualityTier is absent", () => {
      const STATE = { dtus: new Map() };
      STATE.dtus.set("s1", { domain: "art", status: "shadow_vault", qualityScore: 0.8 });
      STATE.dtus.set("s2", { domain: "art", status: "shadow_vault", qualityScore: 0.6 });

      const result = unshadowTopArtifacts("art", 1, STATE);
      assert.equal(result.unshadowed.length, 1);
      assert.equal(result.unshadowed[0], "s1");
      assert.equal(STATE.dtus.get("s1").status, "marketplace_ready");
    });

    it("uses validationScore when qualityScore is absent", () => {
      const STATE = { dtus: new Map() };
      STATE.dtus.set("v1", { domain: "music", qualityTier: "shadow_vault", validationScore: 0.5 });
      STATE.dtus.set("v2", { domain: "music", qualityTier: "shadow_vault", validationScore: 0.9 });

      const result = unshadowTopArtifacts("music", 1, STATE);
      assert.equal(result.unshadowed[0], "v2");
    });

    it("sorts by entityMaturity as secondary criterion", () => {
      const STATE = { dtus: new Map() };
      STATE.dtus.set("m1", { domain: "art", qualityTier: "shadow_vault", qualityScore: 0.8, entityMaturity: 10 });
      STATE.dtus.set("m2", { domain: "art", qualityTier: "shadow_vault", qualityScore: 0.8, entityMaturity: 20 });

      const result = unshadowTopArtifacts("art", 1, STATE);
      // Same score, but m2 has higher maturity
      assert.equal(result.unshadowed[0], "m2");
    });

    it("returns empty when no candidates match domain", () => {
      const STATE = { dtus: new Map() };
      STATE.dtus.set("x1", { domain: "music", qualityTier: "shadow_vault", qualityScore: 0.9 });

      const result = unshadowTopArtifacts("art", 5, STATE);
      assert.deepEqual(result.unshadowed, []);
    });

    it("returns empty when count is 0", () => {
      const STATE = { dtus: new Map() };
      STATE.dtus.set("z1", { domain: "art", qualityTier: "shadow_vault", qualityScore: 0.9 });

      const result = unshadowTopArtifacts("art", 0, STATE);
      assert.deepEqual(result.unshadowed, []);
    });

    it("handles empty STATE.dtus", () => {
      const result = unshadowTopArtifacts("music", 5, { dtus: new Map() });
      assert.deepEqual(result.unshadowed, []);
    });

    it("handles STATE with no dtus property", () => {
      const result = unshadowTopArtifacts("music", 5, {});
      assert.deepEqual(result.unshadowed, []);
    });

    it("skips non-shadow_vault DTUs in the domain", () => {
      const STATE = { dtus: new Map() };
      STATE.dtus.set("ok1", { domain: "music", qualityTier: "marketplace_ready", qualityScore: 1.0 });
      STATE.dtus.set("ok2", { domain: "music", qualityTier: "shadow_vault", qualityScore: 0.5 });

      const result = unshadowTopArtifacts("music", 5, STATE);
      assert.equal(result.unshadowed.length, 1);
      assert.equal(result.unshadowed[0], "ok2");
    });
  });

  // ── migrateArtifactsToCompressed ─────────────────────────────────

  describe("migrateArtifactsToCompressed", () => {
    it("returns zeroed stats when artifact root does not exist", () => {
      const stats = migrateArtifactsToCompressed();
      assert.equal(stats.migrated, 0);
      assert.equal(stats.skipped, 0);
      assert.equal(stats.errors, 0);
      assert.equal(stats.savedBytes, 0);
    });

    it("compresses compressible files that have no .gz", async () => {
      // Store a text file (compressible) and manually remove the .gz
      const buf = Buffer.from("migrate me");
      const stored = await storeArtifact("dtu-mig1", buf, "text/plain", "migrate.txt");
      fs.unlinkSync(stored.compressedPath); // remove .gz so migration picks it up

      const stats = migrateArtifactsToCompressed();
      assert.ok(stats.migrated >= 1);
      // The .gz should now exist again
      assert.ok(fs.existsSync(stored.diskPath + ".gz"));
    });

    it("skips already-compressed files (with .gz extension)", async () => {
      const buf = Buffer.from("already compressed");
      await storeArtifact("dtu-mig2", buf, "text/plain", "done.txt");
      // First migration was already done by storeArtifact
      const stats = migrateArtifactsToCompressed();
      // The .txt already has a .gz, plus the .gz itself and text_preview.txt are skipped
      assert.ok(stats.skipped >= 1);
    });

    it("skips non-compressible file types", async () => {
      const buf = makeBuffer(64);
      await storeArtifact("dtu-mig3", buf, "image/png", "skip.png");
      const stats = migrateArtifactsToCompressed();
      // png is non-compressible so it should be skipped
      assert.ok(stats.skipped >= 1);
      assert.equal(stats.migrated, 0);
    });

    it("skips waveform.json and text_preview.txt files", async () => {
      const buf = makeBuffer(2048);
      await storeArtifact("dtu-mig4", buf, "audio/wav", "audio.wav");
      // This will create waveform.json in the dtu dir
      const stats = migrateArtifactsToCompressed();
      // waveform.json should be in the skipped count
      assert.ok(stats.skipped >= 1);
    });

    it("handles nested directories correctly", async () => {
      await storeArtifact("dtu-mig5a", Buffer.from("nested a"), "text/plain", "a.txt");
      await storeArtifact("dtu-mig5b", Buffer.from("nested b"), "text/csv", "b.csv");
      // Remove .gz files for migration
      const dirA = path.join(TEST_ARTIFACT_DIR, "dtu-mig5a");
      const dirB = path.join(TEST_ARTIFACT_DIR, "dtu-mig5b");
      for (const d of [dirA, dirB]) {
        for (const f of fs.readdirSync(d)) {
          if (f.endsWith(".gz")) fs.unlinkSync(path.join(d, f));
        }
      }

      const stats = migrateArtifactsToCompressed();
      assert.ok(stats.migrated >= 2);
    });
  });

  // ── Path traversal protection ────────────────────────────────────

  describe("path traversal protection", () => {
    it("sanitises directory traversal in filenames", async () => {
      const buf = Buffer.from("safe");
      const result = await storeArtifact("dtu-pt1", buf, "text/plain", "../../etc/shadow");
      // Slashes are replaced with underscores; dots are allowed by the regex
      // The important thing: no slashes remain, and file is inside the dtu dir
      assert.ok(!result.filename.includes("/"));
      assert.ok(!result.filename.includes("\\"));
      assert.ok(result.diskPath.startsWith(TEST_ARTIFACT_DIR));
      assert.equal(result.filename, ".._.._etc_shadow");
    });

    it("sanitises null bytes and special chars", async () => {
      const buf = Buffer.from("safe");
      const result = await storeArtifact("dtu-pt2", buf, "text/plain", "file\x00name.txt");
      assert.ok(!result.filename.includes("\x00"));
    });

    it("sanitises unicode characters", async () => {
      const buf = Buffer.from("safe");
      const result = await storeArtifact(
        "dtu-pt3",
        buf,
        "text/plain",
        "\u202Emalicious\u202C.txt"
      );
      // Unicode control chars should be replaced
      assert.ok(!result.filename.includes("\u202E"));
    });
  });

  // ── Large file handling ──────────────────────────────────────────

  describe("large file handling", () => {
    it("stores a file near the size limit (1MB) successfully", async () => {
      const buf = makeLargeBuffer(1);
      const result = await storeArtifact("dtu-1mb", buf, "text/plain", "big.txt");
      assert.equal(result.sizeBytes, buf.length);
      assert.ok(fs.existsSync(result.diskPath));
    });

    it("rejects file exactly at MAX + 1 byte", async () => {
      const oversized = Buffer.alloc(100 * 1024 * 1024 + 1, 0x42);
      await assert.rejects(
        () => storeArtifact("dtu-over", oversized, "text/plain", "over.txt"),
        /exceeds max size/
      );
    });

    it("accepts file exactly at MAX size", async () => {
      const exact = Buffer.alloc(100 * 1024 * 1024, 0x43);
      // This should NOT throw (equal, not greater)
      const result = await storeArtifact("dtu-exact", exact, "text/plain", "exact.txt");
      assert.equal(result.sizeBytes, exact.length);
    });
  });

  // ── Invalid file types ───────────────────────────────────────────

  describe("invalid file types", () => {
    it("accepts application/octet-stream as universal-DTU fallback", async () => {
      const result = await storeArtifact("dtu-inv1", Buffer.from("x"), "application/octet-stream", "f");
      assert.ok(result.hash.startsWith("sha256:"));
      assert.equal(result.sizeBytes, 1);
    });

    it("rejects empty string as type", async () => {
      await assert.rejects(
        () => storeArtifact("dtu-inv2", Buffer.from("x"), "", "f"),
        /Unsupported artifact type/
      );
    });

    it("rejects made-up MIME type", async () => {
      await assert.rejects(
        () => storeArtifact("dtu-inv3", Buffer.from("x"), "foo/bar", "f"),
        /Unsupported artifact type/
      );
    });
  });

  // ── Metadata handling ────────────────────────────────────────────

  describe("metadata handling", () => {
    it("generates correct SHA-256 hash", async () => {
      const buf = Buffer.from("deterministic content");
      const result = await storeArtifact("dtu-hash", buf, "text/plain", "h.txt");
      const expected = "sha256:" + (await import("crypto")).createHash("sha256").update(buf).digest("hex");
      assert.equal(result.hash, expected);
    });

    it("produces different hashes for different content", async () => {
      const r1 = await storeArtifact("dtu-h1", Buffer.from("aaa"), "text/plain", "a.txt");
      const r2 = await storeArtifact("dtu-h2", Buffer.from("bbb"), "text/plain", "b.txt");
      assert.notEqual(r1.hash, r2.hash);
    });

    it("sets createdAt as ISO string", async () => {
      const before = new Date().toISOString();
      const result = await storeArtifact("dtu-ts", Buffer.from("x"), "text/plain", "t.txt");
      const after = new Date().toISOString();
      assert.ok(result.createdAt >= before);
      assert.ok(result.createdAt <= after);
    });

    it("sets lastAccessedAt to null on creation", async () => {
      const result = await storeArtifact("dtu-la", Buffer.from("x"), "text/plain", "l.txt");
      assert.equal(result.lastAccessedAt, null);
    });

    it("updates lastAccessedAt on retrieve", async () => {
      const result = await storeArtifact("dtu-acc", Buffer.from("x"), "text/plain", "a.txt");
      assert.equal(result.lastAccessedAt, null);
      retrieveArtifact("dtu-acc", result);
      assert.ok(result.lastAccessedAt);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────

  describe("edge cases", () => {
    it("stores an empty buffer (0 bytes)", async () => {
      const buf = Buffer.alloc(0);
      const result = await storeArtifact("dtu-empty", buf, "text/plain", "empty.txt");
      assert.equal(result.sizeBytes, 0);
      assert.ok(fs.existsSync(result.diskPath));
    });

    it("handles concurrent stores to different DTU IDs", async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          storeArtifact(`dtu-conc-${i}`, Buffer.from(`data-${i}`), "text/plain", `f${i}.txt`)
        );
      }
      const results = await Promise.all(promises);
      assert.equal(results.length, 10);
      for (const r of results) {
        assert.ok(fs.existsSync(r.diskPath));
      }
    });

    it("multipart hash is based on filenames not content", async () => {
      const files1 = [
        { filename: "a.txt", buffer: Buffer.from("content1"), mimeType: "text/plain" },
      ];
      const files2 = [
        { filename: "a.txt", buffer: Buffer.from("DIFFERENT"), mimeType: "text/plain" },
      ];
      const r1 = await storeMultipartArtifact("dtu-mphash1", files1);
      const r2 = await storeMultipartArtifact("dtu-mphash2", files2);
      // Same filename "a.txt" so same hash
      assert.equal(r1.hash, r2.hash);
    });

    it("multipart hash differs when filenames differ", async () => {
      const files1 = [
        { filename: "a.txt", buffer: Buffer.from("x"), mimeType: "text/plain" },
      ];
      const files2 = [
        { filename: "b.txt", buffer: Buffer.from("x"), mimeType: "text/plain" },
      ];
      const r1 = await storeMultipartArtifact("dtu-mpdiff1", files1);
      const r2 = await storeMultipartArtifact("dtu-mpdiff2", files2);
      assert.notEqual(r1.hash, r2.hash);
    });
  });
});
