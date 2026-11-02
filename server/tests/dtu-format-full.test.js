/**
 * Comprehensive tests for economy/dtu-format.js
 * Targeting 100% line, branch, and function coverage.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "crypto";

// The .dtu signing key comes from the environment; configure a test-only key.
process.env.CONCORD_DTU_SIGNING_KEY = "dtu-format-full-test-only-key";

// ── Inline stubs for constants so we can import the module ──────────────

// We need to stub the constants module before importing dtu-format.
// Since dtu-format.js imports from "../lib/dtu-format-constants.js",
// and those are frozen objects, we import both directly.

import {
  determinePrimaryType,
  calculateLayersBitfield,
  buildHeader,
  parseHeader,
  encodeDTU,
  decodeDTU,
  verifyDTU,
  registerDTUExport,
  lookupDTUByHash,
  getDTUExports,
  reimportDTU,
  getReimports,
  DTU_FORMAT_CONSTANTS,
  DTU_BINARY_LAYOUT,
} from "../economy/dtu-format.js";

// ── Mock database factory ─────────────────────────────────────────────

function createMockDb() {
  const tables = {
    dtu_file_registry: [],
    dtu_reimports: [],
  };

  return {
    prepare(sql) {
      return {
        run(...params) {
          if (sql.includes("INSERT INTO dtu_file_registry")) {
            tables.dtu_file_registry.push({
              id: params[0], dtu_id: params[1], export_id: params[2],
              file_hash: params[3], signature: params[4], format_version: params[5],
              primary_type: params[6], artifact_type: params[7], artifact_size: params[8],
              total_size: params[9], compression_type: params[10], layers_present: params[11],
              exported_by: params[12], exported_at: params[13],
            });
            return { changes: 1 };
          }
          if (sql.includes("INSERT INTO dtu_reimports")) {
            tables.dtu_reimports.push({
              id: params[0], original_dtu_id: params[1], file_hash: params[2],
              signature_verified: params[3], imported_by: params[4],
              imported_at: params[5], source: params[6],
            });
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        get(...params) {
          if (sql.includes("FROM dtu_file_registry WHERE file_hash")) {
            const hash = params[0];
            const match = [...tables.dtu_file_registry].reverse().find(r => r.file_hash === hash);
            return match || undefined;
          }
          return undefined;
        },
        all(...params) {
          if (sql.includes("FROM dtu_file_registry WHERE dtu_id")) {
            return tables.dtu_file_registry
              .filter(r => r.dtu_id === params[0])
              .reverse();
          }
          if (sql.includes("FROM dtu_reimports")) {
            let rows = [...tables.dtu_reimports];
            if (sql.includes("WHERE imported_by")) {
              rows = rows.filter(r => r.imported_by === params[0]);
              return rows.reverse().slice(0, params[1] || 50);
            }
            const limit = params[0] || 50;
            return rows.reverse().slice(0, limit);
          }
          return [];
        },
      };
    },
    _tables: tables,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("dtu-format: determinePrimaryType", () => {
  it("returns CONDENSED when both args are falsy", () => {
    assert.equal(determinePrimaryType(null, null), DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED);
    assert.equal(determinePrimaryType(undefined, undefined), DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED);
    assert.equal(determinePrimaryType("", ""), DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED);
  });

  it("maps audio artifact types", () => {
    for (const t of ["beat", "song", "remix", "cover", "sample_pack", "album"]) {
      assert.equal(determinePrimaryType(t, null), DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_AUDIO);
    }
  });

  it("maps image artifact types", () => {
    for (const t of ["illustration", "photography", "graphic_design"]) {
      assert.equal(determinePrimaryType(t, null), DTU_FORMAT_CONSTANTS.PRIMARY_DISPLAY_IMAGE);
    }
  });

  it("maps 3d_model", () => {
    assert.equal(determinePrimaryType("3d_model", null), DTU_FORMAT_CONSTANTS.PRIMARY_DISPLAY_3D);
  });

  it("maps video artifact types", () => {
    for (const t of ["animation", "short_film", "music_video", "documentary", "tutorial", "film", "episode", "series"]) {
      assert.equal(determinePrimaryType(t, null), DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_VIDEO);
    }
  });

  it("maps document artifact types", () => {
    for (const t of ["novel", "poetry", "essay", "screenplay", "article"]) {
      assert.equal(determinePrimaryType(t, null), DTU_FORMAT_CONSTANTS.PRIMARY_RENDER_DOCUMENT);
    }
  });

  it("maps code artifact types", () => {
    for (const t of ["library", "application", "script", "plugin", "template"]) {
      assert.equal(determinePrimaryType(t, null), DTU_FORMAT_CONSTANTS.PRIMARY_RENDER_CODE);
    }
  });

  it("maps dataset", () => {
    assert.equal(determinePrimaryType("dataset", null), DTU_FORMAT_CONSTANTS.PRIMARY_DISPLAY_DATASET);
  });

  it("maps research artifact types", () => {
    for (const t of ["paper", "analysis", "report"]) {
      assert.equal(determinePrimaryType(t, null), DTU_FORMAT_CONSTANTS.PRIMARY_DISPLAY_RESEARCH);
    }
  });

  it("falls through to contentType mapping for text", () => {
    assert.equal(determinePrimaryType(null, "text"), DTU_FORMAT_CONSTANTS.PRIMARY_CULTURE);
  });

  it("falls through to contentType mapping for image", () => {
    assert.equal(determinePrimaryType(null, "image"), DTU_FORMAT_CONSTANTS.PRIMARY_DISPLAY_IMAGE);
  });

  it("falls through to contentType mapping for audio", () => {
    assert.equal(determinePrimaryType(null, "audio"), DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_AUDIO);
  });

  it("falls through to contentType mapping for video", () => {
    assert.equal(determinePrimaryType(null, "video"), DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_VIDEO);
  });

  it("falls through to contentType mapping for mixed", () => {
    assert.equal(determinePrimaryType(null, "mixed"), DTU_FORMAT_CONSTANTS.PRIMARY_MIXED);
  });

  it("returns CONDENSED for unknown contentType", () => {
    assert.equal(determinePrimaryType(null, "unknown_type"), DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED);
  });

  it("returns CONDENSED for unknown artifact type with no content type", () => {
    assert.equal(determinePrimaryType("unknown_artifact", null), DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED);
  });

  it("artifactType in typeMap takes precedence over contentType", () => {
    assert.equal(determinePrimaryType("beat", "video"), DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_AUDIO);
  });
});

describe("dtu-format: calculateLayersBitfield", () => {
  it("returns 0 when no layers present", () => {
    assert.equal(calculateLayersBitfield({}), 0);
  });

  it("sets LAYER_HUMAN", () => {
    const bits = calculateLayersBitfield({ humanLayer: true });
    assert.equal(bits & DTU_FORMAT_CONSTANTS.LAYER_HUMAN, DTU_FORMAT_CONSTANTS.LAYER_HUMAN);
  });

  it("sets LAYER_CORE", () => {
    const bits = calculateLayersBitfield({ coreLayer: { data: 1 } });
    assert.equal(bits & DTU_FORMAT_CONSTANTS.LAYER_CORE, DTU_FORMAT_CONSTANTS.LAYER_CORE);
  });

  it("sets LAYER_MACHINE", () => {
    const bits = calculateLayersBitfield({ machineLayer: { hash: "x" } });
    assert.equal(bits & DTU_FORMAT_CONSTANTS.LAYER_MACHINE, DTU_FORMAT_CONSTANTS.LAYER_MACHINE);
  });

  it("sets LAYER_ARTIFACT", () => {
    const bits = calculateLayersBitfield({ artifactLayer: Buffer.from("data") });
    assert.equal(bits & DTU_FORMAT_CONSTANTS.LAYER_ARTIFACT, DTU_FORMAT_CONSTANTS.LAYER_ARTIFACT);
  });

  it("combines all layers", () => {
    const bits = calculateLayersBitfield({
      humanLayer: true, coreLayer: true, machineLayer: true, artifactLayer: true,
    });
    assert.equal(bits, 0b1111);
  });
});

describe("dtu-format: buildHeader and parseHeader", () => {
  it("builds and parses a valid header round-trip", () => {
    const header = buildHeader({
      formatType: DTU_FORMAT_CONSTANTS.TYPE_DTU,
      totalSize: 1024,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_AUDIO,
      artifactPresent: true,
      artifactType: "audio/mp3",
      artifactSize: 500,
      layersPresent: 0b1111,
      compressionType: DTU_FORMAT_CONSTANTS.COMPRESSION_GZIP,
    });

    assert.equal(header.length, DTU_FORMAT_CONSTANTS.HEADER_SIZE);

    const result = parseHeader(header);
    assert.equal(result.ok, true);
    assert.equal(result.header.magic, "CDTU");
    assert.equal(result.header.version, DTU_FORMAT_CONSTANTS.FORMAT_VERSION);
    assert.equal(result.header.formatType, DTU_FORMAT_CONSTANTS.TYPE_DTU);
    assert.equal(result.header.formatTypeName, "dtu");
    assert.equal(result.header.totalSize, 1024);
    assert.equal(result.header.primaryType, DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_AUDIO);
    assert.equal(result.header.primaryTypeName, "play_audio");
    assert.equal(result.header.artifactPresent, true);
    assert.equal(result.header.artifactType, "audio/mp3");
    assert.equal(result.header.artifactSize, 500);
    assert.equal(result.header.layersPresent, 0b1111);
    assert.equal(result.header.layers.human, true);
    assert.equal(result.header.layers.core, true);
    assert.equal(result.header.layers.machine, true);
    assert.equal(result.header.layers.artifact, true);
    assert.equal(result.header.compressionType, DTU_FORMAT_CONSTANTS.COMPRESSION_GZIP);
    assert.equal(result.header.headerValid, true);
  });

  it("returns error for null buffer", () => {
    const result = parseHeader(null);
    assert.equal(result.ok, false);
    assert.equal(result.error, "buffer_too_small");
  });

  it("returns error for buffer too small", () => {
    const result = parseHeader(Buffer.alloc(10));
    assert.equal(result.ok, false);
    assert.equal(result.error, "buffer_too_small");
  });

  it("returns error for invalid magic bytes", () => {
    const buf = Buffer.alloc(48);
    buf.write("XXXX", 0, 4, "ascii");
    const result = parseHeader(buf);
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_magic");
    assert.equal(result.got, "XXXX");
  });

  it("handles MEGA format type name", () => {
    const header = buildHeader({
      formatType: DTU_FORMAT_CONSTANTS.TYPE_MEGA,
      totalSize: 2000,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED,
    });
    const result = parseHeader(header);
    assert.equal(result.ok, true);
    assert.equal(result.header.formatTypeName, "mega");
  });

  it("handles HYPER format type name", () => {
    const header = buildHeader({
      formatType: DTU_FORMAT_CONSTANTS.TYPE_HYPER,
      totalSize: 3000,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED,
    });
    const result = parseHeader(header);
    assert.equal(result.ok, true);
    assert.equal(result.header.formatTypeName, "hyper");
  });

  it("handles unknown format type name", () => {
    const header = buildHeader({
      formatType: 99,
      totalSize: 100,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED,
    });
    const result = parseHeader(header);
    assert.equal(result.ok, true);
    assert.equal(result.header.formatTypeName, "unknown");
  });

  it("handles unknown primary type name", () => {
    const header = buildHeader({
      totalSize: 100,
      primaryType: 0xFF,
    });
    const result = parseHeader(header);
    assert.equal(result.ok, true);
    assert.equal(result.header.primaryTypeName, "unknown");
  });

  it("handles artifactPresent false", () => {
    const header = buildHeader({
      totalSize: 100,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED,
      artifactPresent: false,
    });
    const result = parseHeader(header);
    assert.equal(result.ok, true);
    assert.equal(result.header.artifactPresent, false);
  });

  it("returns null artifactType when empty string", () => {
    const header = buildHeader({
      totalSize: 100,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED,
      artifactType: "",
    });
    const result = parseHeader(header);
    assert.equal(result.ok, true);
    assert.equal(result.header.artifactType, null);
  });

  it("detects tampered header (headerValid = false)", () => {
    const header = buildHeader({
      totalSize: 100,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED,
    });
    // Tamper with a byte in the middle
    header[10] = header[10] ^ 0xFF;
    const result = parseHeader(header);
    assert.equal(result.ok, true);
    assert.equal(result.header.headerValid, false);
  });

  it("handles large totalSize (uint64)", () => {
    const header = buildHeader({
      totalSize: 0x100000001,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED,
    });
    const result = parseHeader(header);
    assert.equal(result.ok, true);
    assert.equal(result.header.totalSize, 0x100000001);
  });

  it("handles large artifactSize (uint64)", () => {
    const header = buildHeader({
      totalSize: 200,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED,
      artifactSize: 0x200000002,
    });
    const result = parseHeader(header);
    assert.equal(result.ok, true);
    assert.equal(result.header.artifactSize, 0x200000002);
  });

  it("uses default parameter values in buildHeader", () => {
    const header = buildHeader({
      totalSize: 48,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED,
    });
    assert.equal(header.length, 48);
    const parsed = parseHeader(header);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.header.formatType, DTU_FORMAT_CONSTANTS.TYPE_DTU);
    assert.equal(parsed.header.compressionType, DTU_FORMAT_CONSTANTS.COMPRESSION_GZIP);
  });
});

describe("dtu-format: encodeDTU", () => {
  it("returns error when missing id", () => {
    const result = encodeDTU({ humanLayer: { text: "hi" } });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_id");
  });

  it("returns error when missing humanLayer", () => {
    const result = encodeDTU({ id: "dtu_test" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_human_layer");
  });

  it("encodes a minimal DTU successfully", () => {
    const result = encodeDTU({
      id: "dtu_test123",
      humanLayer: { summary: "Test DTU" },
    });
    assert.equal(result.ok, true);
    assert.ok(Buffer.isBuffer(result.buffer));
    assert.ok(result.contentHash);
    assert.ok(result.signature);
    assert.ok(result.totalSize > DTU_FORMAT_CONSTANTS.HEADER_SIZE);
    assert.equal(result.compressionType, DTU_FORMAT_CONSTANTS.COMPRESSION_GZIP);
  });

  it("encodes with all layers and artifact", () => {
    const artifactData = Buffer.from("binary artifact data");
    const result = encodeDTU({
      id: "dtu_full",
      creatorId: "user1",
      createdAt: "2024-01-01 00:00:00",
      regional: "r1",
      national: "n1",
      federationTier: "global",
      artifactType: "beat",
      contentType: "audio",
      lineage: { parent: "p1" },
      economics: { price: 10 },
      license: { type: "standard" },
      humanLayer: { summary: "Full DTU" },
      coreLayer: { structured: "data" },
      machineLayer: { hash: "abc123" },
      artifactData,
      artifactMimeType: "audio/mp3",
      formatType: DTU_FORMAT_CONSTANTS.TYPE_DTU,
    });

    assert.equal(result.ok, true);
    assert.equal(result.primaryType, DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_AUDIO);
    assert.ok(result.layersPresent & DTU_FORMAT_CONSTANTS.LAYER_HUMAN);
    assert.ok(result.layersPresent & DTU_FORMAT_CONSTANTS.LAYER_CORE);
    assert.ok(result.layersPresent & DTU_FORMAT_CONSTANTS.LAYER_MACHINE);
    assert.ok(result.layersPresent & DTU_FORMAT_CONSTANTS.LAYER_ARTIFACT);
  });

  it("encodes without optional layers (core, machine, artifact)", () => {
    const result = encodeDTU({
      id: "dtu_minimal",
      humanLayer: { summary: "Minimal" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.layersPresent & DTU_FORMAT_CONSTANTS.LAYER_CORE, 0);
    assert.equal(result.layersPresent & DTU_FORMAT_CONSTANTS.LAYER_MACHINE, 0);
    assert.equal(result.layersPresent & DTU_FORMAT_CONSTANTS.LAYER_ARTIFACT, 0);
  });

  it("returns unknown primaryTypeName for unrecognized type", () => {
    const result = encodeDTU({
      id: "dtu_x",
      humanLayer: { summary: "Test" },
      artifactType: "some_unknown_type_xyz",
      contentType: "some_unknown_content",
    });
    assert.equal(result.ok, true);
  });
});

describe("dtu-format: decodeDTU", () => {
  it("returns error for null buffer", () => {
    const result = decodeDTU(null);
    assert.equal(result.ok, false);
    assert.equal(result.error, "buffer_too_small");
  });

  it("returns error for too-small buffer", () => {
    const result = decodeDTU(Buffer.alloc(50));
    assert.equal(result.ok, false);
  });

  it("round-trips encode → decode with all layers", () => {
    const artifactData = Buffer.from("my artifact content here");
    const encoded = encodeDTU({
      id: "dtu_roundtrip",
      creatorId: "creator1",
      humanLayer: { summary: "Round trip" },
      coreLayer: { key: "value" },
      machineLayer: { integrity: true },
      artifactData,
      artifactMimeType: "application/octet-stream",
    });
    assert.equal(encoded.ok, true);

    const decoded = decodeDTU(encoded.buffer);
    assert.equal(decoded.ok, true);
    assert.equal(decoded.metadata.id, "dtu_roundtrip");
    assert.equal(decoded.metadata.creatorId, "creator1");
    assert.deepEqual(decoded.humanLayer, { summary: "Round trip" });
    assert.deepEqual(decoded.coreLayer, { key: "value" });
    assert.deepEqual(decoded.machineLayer, { integrity: true });
    assert.ok(Buffer.isBuffer(decoded.artifactData));
    assert.deepEqual(decoded.artifactData, artifactData);
  });

  it("round-trips with no core, machine, or artifact layers", () => {
    const encoded = encodeDTU({
      id: "dtu_minimal_rt",
      humanLayer: { text: "just human" },
    });
    assert.equal(encoded.ok, true);

    const decoded = decodeDTU(encoded.buffer);
    assert.equal(decoded.ok, true);
    assert.deepEqual(decoded.humanLayer, { text: "just human" });
    assert.equal(decoded.coreLayer, null);
    assert.equal(decoded.machineLayer, null);
    assert.equal(decoded.artifactData, null);
  });

  it("returns error for header checksum mismatch", () => {
    const encoded = encodeDTU({
      id: "dtu_tamper",
      humanLayer: { text: "tamper test" },
    });
    assert.equal(encoded.ok, true);

    // Tamper with header area (byte 10 which is in the totalSize region)
    encoded.buffer[10] = encoded.buffer[10] ^ 0xFF;
    const decoded = decodeDTU(encoded.buffer);
    assert.equal(decoded.ok, false);
    assert.equal(decoded.error, "header_checksum_mismatch");
  });

  it("returns error for invalid magic bytes in decode", () => {
    const encoded = encodeDTU({
      id: "dtu_bad_magic",
      humanLayer: { text: "x" },
    });
    assert.equal(encoded.ok, true);

    // Overwrite magic bytes but also fix checksum... actually easier: just create bad buffer
    const buf = Buffer.alloc(encoded.buffer.length);
    encoded.buffer.copy(buf);
    buf.write("XXXX", 0, 4, "ascii");
    const decoded = decodeDTU(buf);
    assert.equal(decoded.ok, false);
    assert.equal(decoded.error, "invalid_magic");
  });
});

describe("dtu-format: verifyDTU", () => {
  it("returns error for missing buffer", () => {
    const result = verifyDTU(null);
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_buffer");
  });

  it("returns error for invalid header", () => {
    const buf = Buffer.alloc(48);
    buf.write("XXXX", 0, 4, "ascii");
    const result = verifyDTU(buf);
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_header");
    assert.equal(result.detail, "invalid_magic");
  });

  it("returns tampered=true for header checksum mismatch", () => {
    const encoded = encodeDTU({
      id: "dtu_verify_tamper",
      humanLayer: { text: "verify" },
    });
    // Tamper with a non-magic, non-checksum byte
    encoded.buffer[10] = encoded.buffer[10] ^ 0xFF;
    const result = verifyDTU(encoded.buffer);
    assert.equal(result.ok, false);
    assert.equal(result.error, "header_checksum_mismatch");
    assert.equal(result.tampered, true);
  });

  it("verifies a valid buffer with no expected hash/signature", () => {
    const encoded = encodeDTU({
      id: "dtu_verify_ok",
      humanLayer: { text: "valid" },
    });
    const result = verifyDTU(encoded.buffer);
    assert.equal(result.ok, true);
    assert.equal(result.headerValid, true);
    assert.equal(result.hashMatch, true);
    assert.equal(result.signatureValid, true);
    assert.equal(result.tampered, false);
    assert.ok(result.contentHash);
  });

  it("verifies matching expected hash", () => {
    const encoded = encodeDTU({
      id: "dtu_hash_match",
      humanLayer: { text: "hash" },
    });
    const result = verifyDTU(encoded.buffer, { expectedHash: encoded.contentHash });
    assert.equal(result.ok, true);
    assert.equal(result.hashMatch, true);
    assert.equal(result.tampered, false);
  });

  it("detects mismatched expected hash", () => {
    const encoded = encodeDTU({
      id: "dtu_hash_mismatch",
      humanLayer: { text: "mismatch" },
    });
    const result = verifyDTU(encoded.buffer, { expectedHash: "wrong_hash" });
    assert.equal(result.ok, true);
    assert.equal(result.hashMatch, false);
    assert.equal(result.tampered, true);
  });

  it("verifies matching expected signature", () => {
    const encoded = encodeDTU({
      id: "dtu_sig_match",
      humanLayer: { text: "sig" },
    });
    const result = verifyDTU(encoded.buffer, { expectedSignature: encoded.signature });
    assert.equal(result.ok, true);
    assert.equal(result.signatureValid, true);
    assert.equal(result.tampered, false);
  });

  it("detects mismatched expected signature", () => {
    const encoded = encodeDTU({
      id: "dtu_sig_mismatch",
      humanLayer: { text: "badsig" },
    });
    const result = verifyDTU(encoded.buffer, { expectedSignature: "wrong_sig" });
    assert.equal(result.ok, true);
    assert.equal(result.signatureValid, false);
    assert.equal(result.tampered, true);
  });
});

describe("dtu-format: registerDTUExport", () => {
  let db;
  beforeEach(() => { db = createMockDb(); });

  it("returns error for missing required fields", () => {
    const result = registerDTUExport(db, { dtuId: "d1" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_required_fields");
  });

  it("returns error when dtuId missing", () => {
    const result = registerDTUExport(db, { exportId: "e1", fileHash: "h", signature: "s", exportedBy: "u" });
    assert.equal(result.ok, false);
  });

  it("registers export successfully", () => {
    const result = registerDTUExport(db, {
      dtuId: "dtu_1", exportId: "exp_1", fileHash: "hash1", signature: "sig1",
      formatVersion: 1, primaryType: 1, artifactType: "audio", artifactSize: 1000,
      totalSize: 2000, compressionType: 1, layersPresent: 3, exportedBy: "user1",
    });
    assert.equal(result.ok, true);
    assert.ok(result.fileRecord.id.startsWith("dtuf_"));
    assert.equal(result.fileRecord.dtuId, "dtu_1");
    assert.equal(result.fileRecord.exportId, "exp_1");
  });

  it("uses default values when optional fields missing", () => {
    const result = registerDTUExport(db, {
      dtuId: "dtu_2", exportId: "exp_2", fileHash: "hash2", signature: "sig2",
      exportedBy: "user2",
    });
    assert.equal(result.ok, true);
  });

  it("returns error on DB insert failure", () => {
    const badDb = {
      prepare() {
        return {
          run() { throw new Error("DB error"); },
        };
      },
    };
    const result = registerDTUExport(badDb, {
      dtuId: "d", exportId: "e", fileHash: "h", signature: "s", exportedBy: "u",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "registration_failed");
  });
});

describe("dtu-format: lookupDTUByHash", () => {
  let db;
  beforeEach(() => { db = createMockDb(); });

  it("returns null when no record found", () => {
    const result = lookupDTUByHash(db, "nonexistent_hash");
    assert.equal(result, null);
  });

  it("returns formatted record when found", () => {
    registerDTUExport(db, {
      dtuId: "dtu_lookup", exportId: "exp_1", fileHash: "lookup_hash",
      signature: "sig", exportedBy: "user",
    });
    const result = lookupDTUByHash(db, "lookup_hash");
    assert.ok(result);
    assert.equal(result.dtuId, "dtu_lookup");
    assert.equal(result.fileHash, "lookup_hash");
  });
});

describe("dtu-format: getDTUExports", () => {
  let db;
  beforeEach(() => { db = createMockDb(); });

  it("returns empty exports when no records", () => {
    const result = getDTUExports(db, "nonexistent");
    assert.equal(result.ok, true);
    assert.equal(result.exports.length, 0);
  });

  it("returns exports for a dtu", () => {
    registerDTUExport(db, {
      dtuId: "dtu_exports", exportId: "e1", fileHash: "h1", signature: "s", exportedBy: "u",
    });
    registerDTUExport(db, {
      dtuId: "dtu_exports", exportId: "e2", fileHash: "h2", signature: "s", exportedBy: "u",
    });
    const result = getDTUExports(db, "dtu_exports");
    assert.equal(result.ok, true);
    assert.equal(result.exports.length, 2);
    assert.ok(result.exports[0].dtuId);
  });
});

describe("dtu-format: reimportDTU", () => {
  let db;
  beforeEach(() => { db = createMockDb(); });

  it("returns error for missing required fields", () => {
    const result = reimportDTU(db, { buffer: null, importedBy: "user" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_required_fields");
  });

  it("returns error when importedBy missing", () => {
    const result = reimportDTU(db, { buffer: Buffer.alloc(100) });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_required_fields");
  });

  it("returns error for invalid DTU file (bad header)", () => {
    const buf = Buffer.alloc(100);
    buf.write("XXXX", 0, 4, "ascii");
    const result = reimportDTU(db, { buffer: buf, importedBy: "user1" });
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_dtu_file");
  });

  it("returns error for decode failure", () => {
    // Buffer with valid header but invalid body
    const header = buildHeader({
      totalSize: 100,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED,
    });
    const body = Buffer.alloc(10); // too small for section table
    const buf = Buffer.concat([header, body]);
    const result = reimportDTU(db, { buffer: buf, importedBy: "user1" });
    // The buffer is smaller than header + 20 so decodeDTU will fail
    assert.equal(result.ok, false);
  });

  it("reimports a valid DTU successfully (not from platform)", () => {
    const encoded = encodeDTU({
      id: "dtu_reimport",
      humanLayer: { text: "reimport test" },
    });
    assert.equal(encoded.ok, true);

    const result = reimportDTU(db, {
      buffer: encoded.buffer, importedBy: "user1", source: "external",
    });
    assert.equal(result.ok, true);
    assert.equal(result.reimport.signatureVerified, false); // not in registry
    assert.equal(result.reimport.importedBy, "user1");
    assert.equal(result.reimport.source, "external");
    assert.ok(result.dtu);
  });

  it("reimports a DTU from platform (signature verified)", () => {
    const encoded = encodeDTU({
      id: "dtu_platform",
      humanLayer: { text: "platform" },
    });
    const hash = createHash("sha256").update(encoded.buffer).digest("hex");

    // Register the export first
    registerDTUExport(db, {
      dtuId: "dtu_platform", exportId: "e1", fileHash: hash,
      signature: "sig", exportedBy: "original_user",
    });

    const result = reimportDTU(db, {
      buffer: encoded.buffer, importedBy: "user2",
    });
    assert.equal(result.ok, true);
    assert.equal(result.reimport.signatureVerified, true);
  });

  it("handles source as null when not provided", () => {
    const encoded = encodeDTU({
      id: "dtu_nosource",
      humanLayer: { text: "no source" },
    });
    const result = reimportDTU(db, {
      buffer: encoded.buffer, importedBy: "user1",
    });
    assert.equal(result.ok, true);
  });

  it("returns error on DB failure during reimport", () => {
    const encoded = encodeDTU({
      id: "dtu_dbfail",
      humanLayer: { text: "fail" },
    });

    const badDb = {
      prepare(sql) {
        return {
          run() { throw new Error("DB error"); },
          get() {
            if (sql.includes("dtu_file_registry")) return undefined;
            return undefined;
          },
          all() { return []; },
        };
      },
    };

    const result = reimportDTU(badDb, {
      buffer: encoded.buffer, importedBy: "user1",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "reimport_failed");
  });
});

describe("dtu-format: getReimports", () => {
  let db;
  beforeEach(() => { db = createMockDb(); });

  it("returns empty reimports with no arguments", () => {
    const result = getReimports(db);
    assert.equal(result.ok, true);
    assert.equal(result.reimports.length, 0);
  });

  it("returns reimports filtered by importedBy", () => {
    const encoded = encodeDTU({
      id: "dtu_reimp",
      humanLayer: { text: "reimp" },
    });
    reimportDTU(db, { buffer: encoded.buffer, importedBy: "user_a" });
    reimportDTU(db, { buffer: encoded.buffer, importedBy: "user_b" });

    const result = getReimports(db, { importedBy: "user_a", limit: 10 });
    assert.equal(result.ok, true);
    assert.ok(result.reimports.length >= 1);
    for (const r of result.reimports) {
      assert.equal(r.importedBy, "user_a");
    }
  });

  it("respects limit", () => {
    const encoded = encodeDTU({
      id: "dtu_lim",
      humanLayer: { text: "limit" },
    });
    reimportDTU(db, { buffer: encoded.buffer, importedBy: "u" });
    reimportDTU(db, { buffer: encoded.buffer, importedBy: "u" });

    const result = getReimports(db, { limit: 1 });
    assert.equal(result.ok, true);
    assert.ok(result.reimports.length <= 1);
  });

  it("uses default limit of 50", () => {
    const result = getReimports(db, {});
    assert.equal(result.ok, true);
  });
});
