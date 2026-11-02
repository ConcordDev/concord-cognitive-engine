/**
 * DTU File Format Test Suite — v1.0
 *
 * Tests:
 *   - DTU format constants (magic bytes, type codes, layer bitfields)
 *   - Header building and parsing (48-byte binary header)
 *   - Full DTU encoding (human + core + machine + artifact layers)
 *   - DTU decoding (round-trip integrity)
 *   - Verification (hash, signature, tamper detection)
 *   - Primary type determination (artifact → correct handler)
 *   - Layer bitfield calculation
 *   - MEGA and HYPER format types
 *   - File registry (export tracking in DB)
 *   - Reimport with signature verification
 *   - DTU sharing invariants (verification survives sharing)
 *   - Viewer and codec constants
 *   - Platform registration specs
 *
 * Run: node --test server/tests/dtu-format.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// The .dtu signing key comes from the environment; configure a test-only key.
process.env.CONCORD_DTU_SIGNING_KEY = "dtu-format-test-only-key";

import {
  DTU_FILE_FORMAT, DTU_BINARY_LAYOUT, DTU_OS_ACTIONS,
  DTU_VIEWER, DTU_CODEC, DTU_SMART_OPEN, DTU_SHARING,
  DTU_PLATFORM_REGISTRATION, DTU_IANA_REGISTRATION,
  DTU_FORMAT_CONSTANTS,
} from "../lib/dtu-format-constants.js";

import {
  determinePrimaryType, calculateLayersBitfield,
  buildHeader, parseHeader,
  encodeDTU, decodeDTU, verifyDTU,
  registerDTUExport, lookupDTUByHash, getDTUExports,
  reimportDTU, getReimports,
} from "../economy/dtu-format.js";

import { createHash } from "crypto";

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
    CREATE TABLE dtu_file_registry (
      id TEXT PRIMARY KEY,
      dtu_id TEXT NOT NULL,
      export_id TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      signature TEXT NOT NULL,
      format_version INTEGER NOT NULL DEFAULT 1,
      primary_type INTEGER NOT NULL,
      artifact_type TEXT,
      artifact_size INTEGER,
      total_size INTEGER NOT NULL,
      compression_type INTEGER NOT NULL DEFAULT 1,
      layers_present INTEGER NOT NULL DEFAULT 1,
      exported_by TEXT NOT NULL,
      exported_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE dtu_reimports (
      id TEXT PRIMARY KEY,
      original_dtu_id TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      signature_verified INTEGER NOT NULL DEFAULT 0,
      imported_by TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT
    );
  `);

  return db;
}

// ═════════════════════════════════════════════════════════════════════
// FORMAT CONSTANTS
// ═════════════════════════════════════════════════════════════════════

describe("DTU Format Constants", () => {
  it("file extension is .dtu", () => {
    assert.equal(DTU_FILE_FORMAT.extension, ".dtu");
    assert.equal(DTU_FILE_FORMAT.mimeType, "application/vnd.concord.dtu");
  });

  it("has magic bytes CDTU", () => {
    assert.equal(DTU_FORMAT_CONSTANTS.MAGIC, "CDTU");
    assert.equal(DTU_FORMAT_CONSTANTS.FORMAT_VERSION, 1);
  });

  it("has 3 format types: DTU, MEGA, HYPER", () => {
    assert.equal(DTU_FORMAT_CONSTANTS.TYPE_DTU, 0);
    assert.equal(DTU_FORMAT_CONSTANTS.TYPE_MEGA, 1);
    assert.equal(DTU_FORMAT_CONSTANTS.TYPE_HYPER, 2);
  });

  it("has 11 primary type codes", () => {
    assert.equal(DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_AUDIO, 0x01);
    assert.equal(DTU_FORMAT_CONSTANTS.PRIMARY_DISPLAY_IMAGE, 0x02);
    assert.equal(DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_VIDEO, 0x03);
    assert.equal(DTU_FORMAT_CONSTANTS.PRIMARY_RENDER_CODE, 0x05);
    assert.equal(DTU_FORMAT_CONSTANTS.PRIMARY_CULTURE, 0x0B);
  });

  it("has 4 compression codes", () => {
    assert.equal(DTU_FORMAT_CONSTANTS.COMPRESSION_NONE, 0);
    assert.equal(DTU_FORMAT_CONSTANTS.COMPRESSION_GZIP, 1);
    assert.equal(DTU_FORMAT_CONSTANTS.COMPRESSION_BROTLI, 2);
    assert.equal(DTU_FORMAT_CONSTANTS.COMPRESSION_ZSTD, 3);
  });

  it("has 4 layer bitfield values", () => {
    assert.equal(DTU_FORMAT_CONSTANTS.LAYER_HUMAN, 0b0001);
    assert.equal(DTU_FORMAT_CONSTANTS.LAYER_CORE, 0b0010);
    assert.equal(DTU_FORMAT_CONSTANTS.LAYER_MACHINE, 0b0100);
    assert.equal(DTU_FORMAT_CONSTANTS.LAYER_ARTIFACT, 0b1000);
  });

  it("header is 48 bytes", () => {
    assert.equal(DTU_FORMAT_CONSTANTS.HEADER_SIZE, 48);
  });

  it("has 3 file extensions (single, mega, hyper)", () => {
    assert.equal(DTU_FILE_FORMAT.extensions.single, ".dtu");
    assert.equal(DTU_FILE_FORMAT.extensions.mega, ".mega.dtu");
    assert.equal(DTU_FILE_FORMAT.extensions.hyper, ".hyper.dtu");
  });

  it("codec is MIT licensed open source", () => {
    assert.equal(DTU_CODEC.license, "MIT");
    assert.equal(DTU_CODEC.name, "libdtu");
    assert.ok(DTU_CODEC.languages.includes("javascript"));
    assert.ok(DTU_CODEC.languages.includes("rust"));
    assert.ok(DTU_CODEC.languages.includes("python"));
  });

  it("viewer requires no account and no internet", () => {
    assert.equal(DTU_VIEWER.requiresAccount, false);
    assert.equal(DTU_VIEWER.requiresInternet, false);
    assert.equal(DTU_VIEWER.limitations.createDTUs, false);
    assert.equal(DTU_VIEWER.limitations.modifyDTUs, false);
  });

  it("IANA registration has 3 MIME types", () => {
    assert.equal(DTU_IANA_REGISTRATION.primary.subtype, "vnd.concord.dtu");
    assert.equal(DTU_IANA_REGISTRATION.mega.subtype, "vnd.concord.mega-dtu");
    assert.equal(DTU_IANA_REGISTRATION.hyper.subtype, "vnd.concord.hyper-dtu");
  });

  it("platform registration covers all major OS", () => {
    assert.ok(DTU_PLATFORM_REGISTRATION.windows);
    assert.ok(DTU_PLATFORM_REGISTRATION.macos);
    assert.ok(DTU_PLATFORM_REGISTRATION.linux);
    assert.ok(DTU_PLATFORM_REGISTRATION.ios);
    assert.ok(DTU_PLATFORM_REGISTRATION.android);
  });

  it("verification survives all sharing channels", () => {
    assert.equal(DTU_SHARING.verificationPersistence.survivesCopyPaste, true);
    assert.equal(DTU_SHARING.verificationPersistence.survivesCloudUpload, true);
    assert.equal(DTU_SHARING.verificationPersistence.survivesEmailAttachment, true);
    assert.equal(DTU_SHARING.verificationPersistence.survivesCompression, true);
  });

  it("OS actions has context menu with 7 entries", () => {
    assert.equal(DTU_OS_ACTIONS.contextMenu.length, 7);
    assert.equal(DTU_OS_ACTIONS.contextMenu[0].label, "Open");
    assert.equal(DTU_OS_ACTIONS.contextMenu[5].label, "Verify Authenticity");
    assert.equal(DTU_OS_ACTIONS.contextMenu[6].label, "Import to Concord");
  });
});

// ═════════════════════════════════════════════════════════════════════
// PRIMARY TYPE DETERMINATION
// ═════════════════════════════════════════════════════════════════════

describe("Primary Type Determination", () => {
  it("maps beat to play_audio", () => {
    assert.equal(determinePrimaryType("beat"), DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_AUDIO);
  });

  it("maps song to play_audio", () => {
    assert.equal(determinePrimaryType("song"), DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_AUDIO);
  });

  it("maps illustration to display_image", () => {
    assert.equal(determinePrimaryType("illustration"), DTU_FORMAT_CONSTANTS.PRIMARY_DISPLAY_IMAGE);
  });

  it("maps short_film to play_video", () => {
    assert.equal(determinePrimaryType("short_film"), DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_VIDEO);
  });

  it("maps library to render_code", () => {
    assert.equal(determinePrimaryType("library"), DTU_FORMAT_CONSTANTS.PRIMARY_RENDER_CODE);
  });

  it("maps novel to render_document", () => {
    assert.equal(determinePrimaryType("novel"), DTU_FORMAT_CONSTANTS.PRIMARY_RENDER_DOCUMENT);
  });

  it("maps dataset to display_dataset", () => {
    assert.equal(determinePrimaryType("dataset"), DTU_FORMAT_CONSTANTS.PRIMARY_DISPLAY_DATASET);
  });

  it("maps paper to display_research", () => {
    assert.equal(determinePrimaryType("paper"), DTU_FORMAT_CONSTANTS.PRIMARY_DISPLAY_RESEARCH);
  });

  it("maps 3d_model to display_3d", () => {
    assert.equal(determinePrimaryType("3d_model"), DTU_FORMAT_CONSTANTS.PRIMARY_DISPLAY_3D);
  });

  it("falls back to culture for text contentType", () => {
    assert.equal(determinePrimaryType(null, "text"), DTU_FORMAT_CONSTANTS.PRIMARY_CULTURE);
  });

  it("falls back to condensed for unknown types", () => {
    assert.equal(determinePrimaryType(null, null), DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED);
  });
});

describe("Domain Type Determination", () => {
  it("maps sensor_reading contentType to DOMAIN_SENSOR_READING", () => {
    assert.equal(determinePrimaryType(null, "sensor_reading"), DTU_FORMAT_CONSTANTS.DOMAIN_SENSOR_READING);
  });

  it("maps sensor shorthand to DOMAIN_SENSOR_READING", () => {
    assert.equal(determinePrimaryType(null, "sensor"), DTU_FORMAT_CONSTANTS.DOMAIN_SENSOR_READING);
  });

  it("maps shield_threat contentType to DOMAIN_SHIELD_THREAT", () => {
    assert.equal(determinePrimaryType(null, "shield_threat"), DTU_FORMAT_CONSTANTS.DOMAIN_SHIELD_THREAT);
  });

  it("maps threat shorthand to DOMAIN_SHIELD_THREAT", () => {
    assert.equal(determinePrimaryType(null, "threat"), DTU_FORMAT_CONSTANTS.DOMAIN_SHIELD_THREAT);
  });

  it("maps economy_transaction contentType to DOMAIN_ECONOMY_TRANSACTION", () => {
    assert.equal(determinePrimaryType(null, "economy_transaction"), DTU_FORMAT_CONSTANTS.DOMAIN_ECONOMY_TRANSACTION);
  });

  it("maps transaction shorthand to DOMAIN_ECONOMY_TRANSACTION", () => {
    assert.equal(determinePrimaryType(null, "transaction"), DTU_FORMAT_CONSTANTS.DOMAIN_ECONOMY_TRANSACTION);
  });

  it("maps identity_assertion to DOMAIN_IDENTITY_ASSERTION", () => {
    assert.equal(determinePrimaryType(null, "identity_assertion"), DTU_FORMAT_CONSTANTS.DOMAIN_IDENTITY_ASSERTION);
  });

  it("maps identity shorthand to DOMAIN_IDENTITY_ASSERTION", () => {
    assert.equal(determinePrimaryType(null, "identity"), DTU_FORMAT_CONSTANTS.DOMAIN_IDENTITY_ASSERTION);
  });

  it("maps mesh_control to DOMAIN_MESH_CONTROL", () => {
    assert.equal(determinePrimaryType(null, "mesh_control"), DTU_FORMAT_CONSTANTS.DOMAIN_MESH_CONTROL);
  });

  it("maps emergency_alert to DOMAIN_EMERGENCY_ALERT", () => {
    assert.equal(determinePrimaryType(null, "emergency_alert"), DTU_FORMAT_CONSTANTS.DOMAIN_EMERGENCY_ALERT);
  });

  it("maps emergency shorthand to DOMAIN_EMERGENCY_ALERT", () => {
    assert.equal(determinePrimaryType(null, "emergency"), DTU_FORMAT_CONSTANTS.DOMAIN_EMERGENCY_ALERT);
  });

  it("maps broadcast_relay to DOMAIN_BROADCAST_RELAY", () => {
    assert.equal(determinePrimaryType(null, "broadcast_relay"), DTU_FORMAT_CONSTANTS.DOMAIN_BROADCAST_RELAY);
  });

  it("maps broadcast shorthand to DOMAIN_BROADCAST_RELAY", () => {
    assert.equal(determinePrimaryType(null, "broadcast"), DTU_FORMAT_CONSTANTS.DOMAIN_BROADCAST_RELAY);
  });

  it("maps atlas_signal to DOMAIN_ATLAS_SIGNAL", () => {
    assert.equal(determinePrimaryType(null, "atlas_signal"), DTU_FORMAT_CONSTANTS.DOMAIN_ATLAS_SIGNAL);
  });

  it("maps lineage_ref to DOMAIN_LINEAGE_REF", () => {
    assert.equal(determinePrimaryType(null, "lineage_ref"), DTU_FORMAT_CONSTANTS.DOMAIN_LINEAGE_REF);
  });

  it("maps geospatial to DOMAIN_GEOSPATIAL", () => {
    assert.equal(determinePrimaryType(null, "geospatial"), DTU_FORMAT_CONSTANTS.DOMAIN_GEOSPATIAL);
  });

  it("maps time_series to DOMAIN_TIME_SERIES", () => {
    assert.equal(determinePrimaryType(null, "time_series"), DTU_FORMAT_CONSTANTS.DOMAIN_TIME_SERIES);
  });

  it("maps structured_knowledge to DOMAIN_STRUCTURED_KNOWLEDGE", () => {
    assert.equal(determinePrimaryType(null, "structured_knowledge"), DTU_FORMAT_CONSTANTS.DOMAIN_STRUCTURED_KNOWLEDGE);
  });

  it("domain types take precedence over generic text fallback", () => {
    // When contentType is a domain type, it should match domain map before generic text/image/audio/video
    assert.equal(determinePrimaryType(null, "sensor"), DTU_FORMAT_CONSTANTS.DOMAIN_SENSOR_READING);
    assert.notEqual(determinePrimaryType(null, "sensor"), DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED);
  });

  it("artifact type still takes precedence over domain contentType", () => {
    // If an artifact type is known, it wins over contentType domain mapping
    assert.equal(determinePrimaryType("beat", "sensor"), DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_AUDIO);
  });
});

// ═════════════════════════════════════════════════════════════════════
// LAYER BITFIELD
// ═════════════════════════════════════════════════════════════════════

describe("Layer Bitfield Calculation", () => {
  it("human only = 0001", () => {
    assert.equal(calculateLayersBitfield({ humanLayer: true }), 0b0001);
  });

  it("human + core = 0011", () => {
    assert.equal(calculateLayersBitfield({ humanLayer: true, coreLayer: true }), 0b0011);
  });

  it("all four layers = 1111", () => {
    assert.equal(
      calculateLayersBitfield({ humanLayer: true, coreLayer: true, machineLayer: true, artifactLayer: true }),
      0b1111,
    );
  });

  it("no layers = 0000", () => {
    assert.equal(calculateLayersBitfield({}), 0b0000);
  });
});

// ═════════════════════════════════════════════════════════════════════
// HEADER BUILD & PARSE
// ═════════════════════════════════════════════════════════════════════

describe("DTU Header", () => {
  it("builds a 48-byte header", () => {
    const header = buildHeader({
      totalSize: 1024,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_AUDIO,
      artifactPresent: true,
      artifactType: "audio/mpeg",
      artifactSize: 512,
      layersPresent: 0b1011,
      compressionType: DTU_FORMAT_CONSTANTS.COMPRESSION_GZIP,
    });
    assert.equal(header.length, 48);
    assert.equal(header.toString("ascii", 0, 4), "CDTU");
  });

  it("parses a header round-trip", () => {
    const header = buildHeader({
      totalSize: 2048,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_DISPLAY_IMAGE,
      artifactPresent: true,
      artifactType: "image/png",
      artifactSize: 1500,
      layersPresent: 0b1001,
      compressionType: DTU_FORMAT_CONSTANTS.COMPRESSION_GZIP,
    });

    const parsed = parseHeader(header);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.header.magic, "CDTU");
    assert.equal(parsed.header.version, 1);
    assert.equal(parsed.header.primaryType, DTU_FORMAT_CONSTANTS.PRIMARY_DISPLAY_IMAGE);
    assert.equal(parsed.header.primaryTypeName, "display_image");
    assert.equal(parsed.header.artifactPresent, true);
    assert.equal(parsed.header.artifactType, "image/png");
    assert.equal(parsed.header.artifactSize, 1500);
    assert.equal(parsed.header.totalSize, 2048);
    assert.equal(parsed.header.layers.human, true);
    assert.equal(parsed.header.layers.core, false);
    assert.equal(parsed.header.layers.artifact, true);
    assert.equal(parsed.header.headerValid, true);
  });

  it("rejects buffer too small", () => {
    const result = parseHeader(Buffer.alloc(10));
    assert.equal(result.ok, false);
    assert.equal(result.error, "buffer_too_small");
  });

  it("rejects invalid magic bytes", () => {
    const buf = Buffer.alloc(48);
    buf.write("NOPE", 0, 4, "ascii");
    const result = parseHeader(buf);
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_magic");
  });

  it("detects header tampering via checksum", () => {
    const header = buildHeader({
      totalSize: 1024,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_AUDIO,
      layersPresent: 0b0001,
    });
    // Tamper with a byte
    header[10] = 0xFF;
    const parsed = parseHeader(header);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.header.headerValid, false);
  });

  it("handles large file sizes (> 4GB)", () => {
    const header = buildHeader({
      totalSize: 5 * 1024 * 1024 * 1024, // 5GB
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_VIDEO,
      artifactPresent: true,
      artifactSize: 4.9 * 1024 * 1024 * 1024,
      layersPresent: 0b1001,
    });
    const parsed = parseHeader(header);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.header.totalSize > 4 * 1024 * 1024 * 1024);
  });
});

// ═════════════════════════════════════════════════════════════════════
// FULL ENCODE / DECODE
// ═════════════════════════════════════════════════════════════════════

describe("DTU Encode/Decode", () => {
  it("encodes a DTU with human layer only", () => {
    const result = encodeDTU({
      id: "dtu_test_001",
      creatorId: "user1",
      humanLayer: { summary: "A test knowledge unit", title: "Test DTU" },
    });
    assert.equal(result.ok, true);
    assert.ok(result.buffer.length > DTU_FORMAT_CONSTANTS.HEADER_SIZE);
    assert.ok(result.contentHash);
    assert.ok(result.signature);
    assert.equal(result.primaryTypeName, "condensed_knowledge");
  });

  it("encodes a DTU with all four layers", () => {
    const artifactData = Buffer.from("fake audio data for testing");
    const result = encodeDTU({
      id: "dtu_music_001",
      creatorId: "artist1",
      artifactType: "beat",
      artifactMimeType: "audio/wav",
      humanLayer: { summary: "Lagos Sunset Beat", title: "Lagos Sunset Beat" },
      coreLayer: { definitions: ["afrobeats instrumental"], invariants: [] },
      machineLayer: { kind: "audio", verifier: "waveform_analysis" },
      artifactData,
      regional: "lagos",
      national: "nigeria",
      federationTier: "regional",
    });
    assert.equal(result.ok, true);
    assert.equal(result.primaryTypeName, "play_audio");
    assert.equal(result.layersPresent, 0b1111); // all four
    assert.ok(result.totalSize > artifactData.length); // larger due to compression overhead + metadata
  });

  it("round-trips a DTU through encode → decode", () => {
    const originalHuman = { summary: "Round trip test", title: "Test", tags: ["test", "roundtrip"] };
    const originalCore = { definitions: ["test definition"], invariants: ["x > 0"] };

    const encoded = encodeDTU({
      id: "dtu_rt_001",
      creatorId: "user1",
      regional: "lagos",
      national: "nigeria",
      humanLayer: originalHuman,
      coreLayer: originalCore,
    });
    assert.equal(encoded.ok, true);

    const decoded = decodeDTU(encoded.buffer);
    assert.equal(decoded.ok, true);
    assert.deepEqual(decoded.humanLayer, originalHuman);
    assert.deepEqual(decoded.coreLayer, originalCore);
    assert.equal(decoded.metadata.id, "dtu_rt_001");
    assert.equal(decoded.metadata.creatorId, "user1");
    assert.equal(decoded.metadata.regional, "lagos");
    assert.equal(decoded.artifactData, null); // no artifact in this one
  });

  it("round-trips a DTU with binary artifact", () => {
    const originalArtifact = Buffer.from("This is a test artifact payload with binary content \x00\x01\x02");
    const encoded = encodeDTU({
      id: "dtu_art_001",
      creatorId: "artist1",
      artifactType: "illustration",
      artifactMimeType: "image/png",
      humanLayer: { summary: "A beautiful painting" },
      artifactData: originalArtifact,
    });
    assert.equal(encoded.ok, true);

    const decoded = decodeDTU(encoded.buffer);
    assert.equal(decoded.ok, true);
    assert.ok(decoded.artifactData);
    assert.equal(Buffer.compare(decoded.artifactData, originalArtifact), 0);
  });

  it("encodes MEGA format type", () => {
    const result = encodeDTU({
      id: "mega_001",
      creatorId: "system",
      humanLayer: { summary: "Consolidated knowledge" },
      formatType: DTU_FORMAT_CONSTANTS.TYPE_MEGA,
    });
    assert.equal(result.ok, true);

    const decoded = decodeDTU(result.buffer);
    assert.equal(decoded.header.formatType, DTU_FORMAT_CONSTANTS.TYPE_MEGA);
    assert.equal(decoded.header.formatTypeName, "mega");
  });

  it("encodes HYPER format type", () => {
    const result = encodeDTU({
      id: "hyper_001",
      creatorId: "system",
      humanLayer: { summary: "Hyper-compressed knowledge" },
      formatType: DTU_FORMAT_CONSTANTS.TYPE_HYPER,
    });
    assert.equal(result.ok, true);

    const decoded = decodeDTU(result.buffer);
    assert.equal(decoded.header.formatType, DTU_FORMAT_CONSTANTS.TYPE_HYPER);
    assert.equal(decoded.header.formatTypeName, "hyper");
  });

  it("rejects encoding without id", () => {
    const result = encodeDTU({ humanLayer: { summary: "no id" } });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_id");
  });

  it("rejects encoding without human layer", () => {
    const result = encodeDTU({ id: "test", coreLayer: {} });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_human_layer");
  });

  it("rejects decoding buffer too small", () => {
    const result = decodeDTU(Buffer.alloc(20));
    assert.equal(result.ok, false);
    assert.equal(result.error, "buffer_too_small");
  });

  it("preserves lineage and economics in metadata", () => {
    const encoded = encodeDTU({
      id: "dtu_lineage_001",
      creatorId: "artist1",
      humanLayer: { summary: "Derivative work" },
      lineage: { parentIds: ["dtu_parent_001"], generation: 1, derivativeType: "remix" },
      economics: { authorityScore: 0.85, citationCount: 12, tier: "regular", scope: "regional" },
      license: { type: "standard", licenseId: "lic_123" },
    });
    assert.equal(encoded.ok, true);

    const decoded = decodeDTU(encoded.buffer);
    assert.equal(decoded.metadata.lineage.parentIds[0], "dtu_parent_001");
    assert.equal(decoded.metadata.lineage.generation, 1);
    assert.equal(decoded.metadata.economics.authorityScore, 0.85);
    assert.equal(decoded.metadata.license.type, "standard");
  });
});

// ═════════════════════════════════════════════════════════════════════
// VERIFICATION
// ═════════════════════════════════════════════════════════════════════

describe("DTU Verification", () => {
  it("verifies untampered DTU", () => {
    const encoded = encodeDTU({
      id: "dtu_verify_001",
      creatorId: "user1",
      humanLayer: { summary: "Verify me" },
    });

    const result = verifyDTU(encoded.buffer, {
      expectedHash: encoded.contentHash,
      expectedSignature: encoded.signature,
    });
    assert.equal(result.ok, true);
    assert.equal(result.headerValid, true);
    assert.equal(result.hashMatch, true);
    assert.equal(result.signatureValid, true);
    assert.equal(result.tampered, false);
  });

  it("detects tampered content (wrong hash)", () => {
    const encoded = encodeDTU({
      id: "dtu_tamper_001",
      creatorId: "user1",
      humanLayer: { summary: "Don't touch me" },
    });

    const result = verifyDTU(encoded.buffer, { expectedHash: "wrong_hash" });
    assert.equal(result.ok, true);
    assert.equal(result.hashMatch, false);
    assert.equal(result.tampered, true);
  });

  it("detects tampered content (wrong signature)", () => {
    const encoded = encodeDTU({
      id: "dtu_sig_001",
      creatorId: "user1",
      humanLayer: { summary: "Signed content" },
    });

    const result = verifyDTU(encoded.buffer, { expectedSignature: "forged_signature" });
    assert.equal(result.ok, true);
    assert.equal(result.signatureValid, false);
    assert.equal(result.tampered, true);
  });

  it("passes verification without expected values (no comparison)", () => {
    const encoded = encodeDTU({
      id: "dtu_basic_verify",
      creatorId: "user1",
      humanLayer: { summary: "Basic verify" },
    });

    const result = verifyDTU(encoded.buffer);
    assert.equal(result.ok, true);
    assert.equal(result.tampered, false);
    assert.ok(result.contentHash);
  });

  it("rejects null buffer", () => {
    const result = verifyDTU(null);
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_buffer");
  });
});

// ═════════════════════════════════════════════════════════════════════
// FILE REGISTRY (DB)
// ═════════════════════════════════════════════════════════════════════

describe("DTU File Registry", { skip: !Database && "better-sqlite3 not available" }, () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("registers a DTU export", () => {
    const result = registerDTUExport(db, {
      dtuId: "dtu_001",
      exportId: "exp_001",
      fileHash: "abc123",
      signature: "sig456",
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_PLAY_AUDIO,
      artifactType: "audio/mpeg",
      artifactSize: 5000000,
      totalSize: 5100000,
      exportedBy: "user1",
    });
    assert.equal(result.ok, true);
    assert.ok(result.fileRecord.id.startsWith("dtuf_"));
    assert.equal(result.fileRecord.dtuId, "dtu_001");
  });

  it("looks up DTU by hash", () => {
    registerDTUExport(db, {
      dtuId: "dtu_002",
      exportId: "exp_002",
      fileHash: "hash_xyz",
      signature: "sig_xyz",
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_DISPLAY_IMAGE,
      totalSize: 1000,
      exportedBy: "user1",
    });

    const found = lookupDTUByHash(db, "hash_xyz");
    assert.ok(found);
    assert.equal(found.dtuId, "dtu_002");
    assert.equal(found.fileHash, "hash_xyz");
  });

  it("returns null for unknown hash", () => {
    const found = lookupDTUByHash(db, "nonexistent");
    assert.equal(found, null);
  });

  it("gets all exports for a DTU", () => {
    registerDTUExport(db, {
      dtuId: "dtu_multi", exportId: "exp_a", fileHash: "h1", signature: "s1",
      primaryType: 1, totalSize: 100, exportedBy: "user1",
    });
    registerDTUExport(db, {
      dtuId: "dtu_multi", exportId: "exp_b", fileHash: "h2", signature: "s2",
      primaryType: 1, totalSize: 100, exportedBy: "user2",
    });

    const result = getDTUExports(db, "dtu_multi");
    assert.equal(result.ok, true);
    assert.equal(result.exports.length, 2);
  });
});

// ═════════════════════════════════════════════════════════════════════
// REIMPORT
// ═════════════════════════════════════════════════════════════════════

describe("DTU Reimport", { skip: !Database && "better-sqlite3 not available" }, () => {
  let db;
  beforeEach(() => { db = createTestDb(); });

  it("reimports a valid DTU file", () => {
    const encoded = encodeDTU({
      id: "dtu_reimport_001",
      creatorId: "artist1",
      humanLayer: { summary: "Importable knowledge" },
    });

    const result = reimportDTU(db, {
      buffer: encoded.buffer,
      importedBy: "user2",
      source: "email",
    });
    assert.equal(result.ok, true);
    assert.ok(result.reimport.id.startsWith("ri_"));
    assert.equal(result.reimport.originalDtuId, "dtu_reimport_001");
    assert.equal(result.reimport.source, "email");
    assert.equal(result.reimport.signatureVerified, false); // not in our registry
  });

  it("verifies signature when DTU was exported from platform", () => {
    const encoded = encodeDTU({
      id: "dtu_known_001",
      creatorId: "artist1",
      humanLayer: { summary: "Known DTU" },
    });

    // Register the export first
    const fileHash = createHash("sha256").update(encoded.buffer).digest("hex");
    registerDTUExport(db, {
      dtuId: "dtu_known_001",
      exportId: "exp_known",
      fileHash,
      signature: encoded.signature,
      primaryType: DTU_FORMAT_CONSTANTS.PRIMARY_CONDENSED,
      totalSize: encoded.totalSize,
      exportedBy: "artist1",
    });

    // Now reimport — should verify signature
    const result = reimportDTU(db, {
      buffer: encoded.buffer,
      importedBy: "user3",
      source: "airdrop",
    });
    assert.equal(result.ok, true);
    assert.equal(result.reimport.signatureVerified, true);
  });

  it("gets reimport history", () => {
    const encoded = encodeDTU({
      id: "dtu_hist_001",
      creatorId: "artist1",
      humanLayer: { summary: "History test" },
    });

    reimportDTU(db, { buffer: encoded.buffer, importedBy: "user1", source: "usb" });
    reimportDTU(db, { buffer: encoded.buffer, importedBy: "user1", source: "cloud" });

    const history = getReimports(db, { importedBy: "user1" });
    assert.equal(history.ok, true);
    assert.equal(history.reimports.length, 2);
  });
});

// ═════════════════════════════════════════════════════════════════════
// DTU AS UNIVERSAL CONTAINER — INVARIANTS
// ═════════════════════════════════════════════════════════════════════

describe("DTU Universal Container Invariants", () => {
  it("any DTU can be read regardless of what lens created it", () => {
    // Music DTU
    const musicDTU = encodeDTU({
      id: "music_001", creatorId: "artist", artifactType: "beat",
      humanLayer: { summary: "A beat" },
      artifactData: Buffer.from("audio bytes"),
    });
    // Code DTU
    const codeDTU = encodeDTU({
      id: "code_001", creatorId: "dev", artifactType: "library",
      humanLayer: { summary: "A library" },
      coreLayer: { definitions: ["utility functions"] },
      machineLayer: { kind: "javascript" },
    });
    // Culture DTU
    const cultureDTU = encodeDTU({
      id: "culture_001", creatorId: "human", contentType: "text",
      humanLayer: { summary: "A memory" },
    });

    // All three decode with the same decoder
    assert.equal(decodeDTU(musicDTU.buffer).ok, true);
    assert.equal(decodeDTU(codeDTU.buffer).ok, true);
    assert.equal(decodeDTU(cultureDTU.buffer).ok, true);

    // Each has correct primary type
    assert.equal(decodeDTU(musicDTU.buffer).header.primaryTypeName, "play_audio");
    assert.equal(decodeDTU(codeDTU.buffer).header.primaryTypeName, "render_code");
    assert.equal(decodeDTU(cultureDTU.buffer).header.primaryTypeName, "culture_memory");
  });

  it("same structure regardless of content type — same four layers", () => {
    const types = ["beat", "illustration", "short_film", "novel", "library", "dataset"];
    for (const type of types) {
      const encoded = encodeDTU({
        id: `dtu_${type}`, creatorId: "test",
        artifactType: type,
        humanLayer: { summary: `A ${type}` },
        coreLayer: { definitions: [`${type} content`] },
      });
      assert.equal(encoded.ok, true);
      const decoded = decodeDTU(encoded.buffer);
      assert.equal(decoded.ok, true);
      assert.ok(decoded.humanLayer);
      assert.ok(decoded.metadata.id === `dtu_${type}`);
    }
  });

  it("verification works identically for all content types", () => {
    const music = encodeDTU({ id: "m", creatorId: "a", artifactType: "beat", humanLayer: { summary: "m" } });
    const code = encodeDTU({ id: "c", creatorId: "a", artifactType: "library", humanLayer: { summary: "c" } });

    const vMusic = verifyDTU(music.buffer, { expectedHash: music.contentHash, expectedSignature: music.signature });
    const vCode = verifyDTU(code.buffer, { expectedHash: code.contentHash, expectedSignature: code.signature });

    assert.equal(vMusic.tampered, false);
    assert.equal(vCode.tampered, false);
    assert.equal(vMusic.headerValid, true);
    assert.equal(vCode.headerValid, true);
  });
});
