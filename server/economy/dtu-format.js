/**
 * DTU File Format Engine — v1.0
 *
 * Encode DTUs into the universal .dtu binary format.
 * Decode .dtu files back into structured DTU objects.
 * Verify authenticity and integrity offline.
 * Track exports and reimports.
 *
 * The .dtu format is a self-describing, self-verifying knowledge
 * container: 48-byte header + compressed metadata + layers + artifact.
 */

import { randomUUID, createHash, createHmac } from "crypto";
import { gzipSync, gunzipSync } from "zlib";
import {
  DTU_FORMAT_CONSTANTS,
  DTU_FILE_FORMAT,
  DTU_BINARY_LAYOUT,
} from "../lib/dtu-format-constants.js";

function uid(prefix = "dtuf") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// Platform signing key (in production, loaded from secure storage)
const SIGNING_KEY = "concord-platform-signing-key-v1";

// ─────────────────────────────────────────────────────────────────────
// DTU Header Operations
// ─────────────────────────────────────────────────────────────────────

/**
 * Determine the primary type code for a DTU based on its content.
 */
export function determinePrimaryType(artifactType, contentType) {
  const C = DTU_FORMAT_CONSTANTS;

  if (!artifactType && !contentType) return C.PRIMARY_CONDENSED;

  const typeMap = {
    beat: C.PRIMARY_PLAY_AUDIO,
    song: C.PRIMARY_PLAY_AUDIO,
    remix: C.PRIMARY_PLAY_AUDIO,
    cover: C.PRIMARY_PLAY_AUDIO,
    sample_pack: C.PRIMARY_PLAY_AUDIO,
    album: C.PRIMARY_PLAY_AUDIO,
    illustration: C.PRIMARY_DISPLAY_IMAGE,
    photography: C.PRIMARY_DISPLAY_IMAGE,
    graphic_design: C.PRIMARY_DISPLAY_IMAGE,
    "3d_model": C.PRIMARY_DISPLAY_3D,
    animation: C.PRIMARY_PLAY_VIDEO,
    short_film: C.PRIMARY_PLAY_VIDEO,
    music_video: C.PRIMARY_PLAY_VIDEO,
    documentary: C.PRIMARY_PLAY_VIDEO,
    tutorial: C.PRIMARY_PLAY_VIDEO,
    film: C.PRIMARY_PLAY_VIDEO,
    episode: C.PRIMARY_PLAY_VIDEO,
    series: C.PRIMARY_PLAY_VIDEO,
    novel: C.PRIMARY_RENDER_DOCUMENT,
    poetry: C.PRIMARY_RENDER_DOCUMENT,
    essay: C.PRIMARY_RENDER_DOCUMENT,
    screenplay: C.PRIMARY_RENDER_DOCUMENT,
    article: C.PRIMARY_RENDER_DOCUMENT,
    library: C.PRIMARY_RENDER_CODE,
    application: C.PRIMARY_RENDER_CODE,
    script: C.PRIMARY_RENDER_CODE,
    plugin: C.PRIMARY_RENDER_CODE,
    template: C.PRIMARY_RENDER_CODE,
    dataset: C.PRIMARY_DISPLAY_DATASET,
    paper: C.PRIMARY_DISPLAY_RESEARCH,
    analysis: C.PRIMARY_DISPLAY_RESEARCH,
    report: C.PRIMARY_DISPLAY_RESEARCH,
  };

  if (artifactType && typeMap[artifactType]) return typeMap[artifactType];

  // Domain-specific content types (mesh/mobile semantic types)
  const domainMap = {
    sensor_reading: C.DOMAIN_SENSOR_READING,
    sensor: C.DOMAIN_SENSOR_READING,
    shield_threat: C.DOMAIN_SHIELD_THREAT,
    threat: C.DOMAIN_SHIELD_THREAT,
    economy_transaction: C.DOMAIN_ECONOMY_TRANSACTION,
    transaction: C.DOMAIN_ECONOMY_TRANSACTION,
    identity_assertion: C.DOMAIN_IDENTITY_ASSERTION,
    identity: C.DOMAIN_IDENTITY_ASSERTION,
    mesh_control: C.DOMAIN_MESH_CONTROL,
    emergency_alert: C.DOMAIN_EMERGENCY_ALERT,
    emergency: C.DOMAIN_EMERGENCY_ALERT,
    broadcast_relay: C.DOMAIN_BROADCAST_RELAY,
    broadcast: C.DOMAIN_BROADCAST_RELAY,
    atlas_signal: C.DOMAIN_ATLAS_SIGNAL,
    lineage_ref: C.DOMAIN_LINEAGE_REF,
    geospatial: C.DOMAIN_GEOSPATIAL,
    time_series: C.DOMAIN_TIME_SERIES,
    structured_knowledge: C.DOMAIN_STRUCTURED_KNOWLEDGE,
  };

  if (contentType && domainMap[contentType]) return domainMap[contentType];

  // Culture content
  if (contentType === "text") return C.PRIMARY_CULTURE;
  if (contentType === "image") return C.PRIMARY_DISPLAY_IMAGE;
  if (contentType === "audio") return C.PRIMARY_PLAY_AUDIO;
  if (contentType === "video") return C.PRIMARY_PLAY_VIDEO;
  if (contentType === "mixed") return C.PRIMARY_MIXED;

  return C.PRIMARY_CONDENSED;
}

/**
 * Calculate which DTU layers are present.
 * Returns a bitfield.
 */
export function calculateLayersBitfield({ humanLayer, coreLayer, machineLayer, artifactLayer }) {
  const C = DTU_FORMAT_CONSTANTS;
  let bits = 0;
  if (humanLayer) bits |= C.LAYER_HUMAN;
  if (coreLayer) bits |= C.LAYER_CORE;
  if (machineLayer) bits |= C.LAYER_MACHINE;
  if (artifactLayer) bits |= C.LAYER_ARTIFACT;
  return bits;
}

/**
 * Build a 48-byte DTU header buffer.
 */
export function buildHeader({
  formatType = DTU_FORMAT_CONSTANTS.TYPE_DTU,
  totalSize,
  primaryType,
  artifactPresent = false,
  artifactType = "",
  artifactSize = 0,
  layersPresent = 0,
  compressionType = DTU_FORMAT_CONSTANTS.COMPRESSION_GZIP,
}) {
  const header = Buffer.alloc(DTU_FORMAT_CONSTANTS.HEADER_SIZE);
  let offset = 0;

  // Magic bytes: "CDTU"
  header.write("CDTU", offset, 4, "ascii");
  offset += 4;

  // Version (uint16)
  header.writeUInt16BE(DTU_FORMAT_CONSTANTS.FORMAT_VERSION, offset);
  offset += 2;

  // Format type (uint8)
  header.writeUInt8(formatType, offset);
  offset += 1;

  // Total size (uint64 — using two uint32 for simplicity)
  const high = Math.floor(totalSize / 0x100000000);
  const low = totalSize % 0x100000000;
  header.writeUInt32BE(high, offset);
  offset += 4;
  header.writeUInt32BE(low, offset);
  offset += 4;

  // Primary type (uint8)
  header.writeUInt8(primaryType, offset);
  offset += 1;

  // Artifact present (uint8)
  header.writeUInt8(artifactPresent ? 1 : 0, offset);
  offset += 1;

  // Artifact type (16 bytes, padded)
  const artTypeStr = (artifactType || "").slice(0, 16);
  header.write(artTypeStr, offset, 16, "ascii");
  offset += 16;

  // Artifact size (uint64)
  const artHigh = Math.floor(artifactSize / 0x100000000);
  const artLow = artifactSize % 0x100000000;
  header.writeUInt32BE(artHigh, offset);
  offset += 4;
  header.writeUInt32BE(artLow, offset);
  offset += 4;

  // Layers present (uint8 bitfield)
  header.writeUInt8(layersPresent, offset);
  offset += 1;

  // Compression type (uint8)
  header.writeUInt8(compressionType, offset);
  offset += 1;

  // Header checksum (CRC32 of first 44 bytes)
  const crc = crc32(header.subarray(0, offset));
  header.writeUInt32BE(crc, offset);

  return header;
}

/**
 * Parse a 48-byte DTU header from a buffer.
 */
export function parseHeader(buffer) {
  if (!buffer || buffer.length < DTU_FORMAT_CONSTANTS.HEADER_SIZE) {
    return { ok: false, error: "buffer_too_small", minSize: DTU_FORMAT_CONSTANTS.HEADER_SIZE };
  }

  let offset = 0;

  const magic = buffer.toString("ascii", offset, offset + 4);
  offset += 4;
  if (magic !== "CDTU") {
    return { ok: false, error: "invalid_magic", expected: "CDTU", got: magic };
  }

  const version = buffer.readUInt16BE(offset);
  offset += 2;

  const formatType = buffer.readUInt8(offset);
  offset += 1;

  const totalSizeHigh = buffer.readUInt32BE(offset);
  offset += 4;
  const totalSizeLow = buffer.readUInt32BE(offset);
  offset += 4;
  const totalSize = totalSizeHigh * 0x100000000 + totalSizeLow;

  const primaryType = buffer.readUInt8(offset);
  offset += 1;

  const artifactPresent = buffer.readUInt8(offset) === 1;
  offset += 1;

  const artifactType = buffer.toString("ascii", offset, offset + 16).replace(/\0+$/, "");
  offset += 16;

  const artSizeHigh = buffer.readUInt32BE(offset);
  offset += 4;
  const artSizeLow = buffer.readUInt32BE(offset);
  offset += 4;
  const artifactSize = artSizeHigh * 0x100000000 + artSizeLow;

  const layersPresent = buffer.readUInt8(offset);
  offset += 1;

  const compressionType = buffer.readUInt8(offset);
  offset += 1;

  const storedChecksum = buffer.readUInt32BE(offset);
  const computedChecksum = crc32(buffer.subarray(0, offset));

  const C = DTU_FORMAT_CONSTANTS;
  const primaryTypeName = DTU_BINARY_LAYOUT.primaryTypes[primaryType] || "unknown";
  const formatTypeName = formatType === C.TYPE_DTU ? "dtu" : formatType === C.TYPE_MEGA ? "mega" : formatType === C.TYPE_HYPER ? "hyper" : "unknown";

  return {
    ok: true,
    header: {
      magic,
      version,
      formatType,
      formatTypeName,
      totalSize,
      primaryType,
      primaryTypeName,
      artifactPresent,
      artifactType: artifactType || null,
      artifactSize,
      layersPresent,
      layers: {
        human: !!(layersPresent & C.LAYER_HUMAN),
        core: !!(layersPresent & C.LAYER_CORE),
        machine: !!(layersPresent & C.LAYER_MACHINE),
        artifact: !!(layersPresent & C.LAYER_ARTIFACT),
      },
      compressionType,
      headerValid: storedChecksum === computedChecksum,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// DTU Encoding / Decoding
// ─────────────────────────────────────────────────────────────────────

/**
 * Encode a DTU object into a .dtu binary buffer.
 */
export function encodeDTU({
  id,
  creatorId,
  createdAt,
  regional,
  national,
  federationTier,
  artifactType,
  contentType,
  lineage,
  economics,
  license,
  humanLayer,
  coreLayer,
  machineLayer,
  artifactData,
  artifactMimeType,
  formatType = DTU_FORMAT_CONSTANTS.TYPE_DTU,
}) {
  if (!id) return { ok: false, error: "missing_id" };
  if (!humanLayer) return { ok: false, error: "missing_human_layer" };

  const primaryType = determinePrimaryType(artifactType, contentType);
  const layersBitfield = calculateLayersBitfield({
    humanLayer, coreLayer, machineLayer, artifactLayer: artifactData,
  });

  // Compress each layer
  const metadataJson = JSON.stringify({
    id,
    createdAt: createdAt || nowISO(),
    creatorId,
    regional,
    national,
    federationTier,
    lineage: lineage || null,
    economics: economics || null,
    license: license || null,
  });

  const humanJson = JSON.stringify(humanLayer);
  const coreJson = coreLayer ? JSON.stringify(coreLayer) : null;
  const machineJson = machineLayer ? JSON.stringify(machineLayer) : null;

  const compressedMetadata = gzipSync(Buffer.from(metadataJson));
  const compressedHuman = gzipSync(Buffer.from(humanJson));
  const compressedCore = coreJson ? gzipSync(Buffer.from(coreJson)) : Buffer.alloc(0);
  const compressedMachine = machineJson ? gzipSync(Buffer.from(machineJson)) : Buffer.alloc(0);
  const compressedArtifact = artifactData ? gzipSync(artifactData) : Buffer.alloc(0);

  // Build section length table (4 bytes each, 5 sections)
  const sectionTable = Buffer.alloc(20);
  sectionTable.writeUInt32BE(compressedMetadata.length, 0);
  sectionTable.writeUInt32BE(compressedHuman.length, 4);
  sectionTable.writeUInt32BE(compressedCore.length, 8);
  sectionTable.writeUInt32BE(compressedMachine.length, 12);
  sectionTable.writeUInt32BE(compressedArtifact.length, 16);

  const payloadSize = 20 + compressedMetadata.length + compressedHuman.length
    + compressedCore.length + compressedMachine.length + compressedArtifact.length;
  const totalSize = DTU_FORMAT_CONSTANTS.HEADER_SIZE + payloadSize;

  const header = buildHeader({
    formatType,
    totalSize,
    primaryType,
    artifactPresent: !!artifactData,
    artifactType: artifactMimeType || "",
    artifactSize: artifactData ? artifactData.length : 0,
    layersPresent: layersBitfield,
    compressionType: DTU_FORMAT_CONSTANTS.COMPRESSION_GZIP,
  });

  // Combine all sections
  const dtuBuffer = Buffer.concat([
    header,
    sectionTable,
    compressedMetadata,
    compressedHuman,
    compressedCore,
    compressedMachine,
    compressedArtifact,
  ]);

  // Generate content hash and signature
  const contentHash = createHash("sha256").update(dtuBuffer).digest("hex");
  const signature = createHmac("sha256", SIGNING_KEY).update(dtuBuffer).digest("hex");

  return {
    ok: true,
    buffer: dtuBuffer,
    contentHash,
    signature,
    totalSize: dtuBuffer.length,
    primaryType,
    primaryTypeName: DTU_BINARY_LAYOUT.primaryTypes[primaryType] || "unknown",
    layersPresent: layersBitfield,
    compressionType: DTU_FORMAT_CONSTANTS.COMPRESSION_GZIP,
  };
}

/**
 * Decode a .dtu binary buffer back into a structured DTU object.
 */
export function decodeDTU(buffer) {
  if (!buffer || buffer.length < DTU_FORMAT_CONSTANTS.HEADER_SIZE + 20) {
    return { ok: false, error: "buffer_too_small" };
  }

  const headerResult = parseHeader(buffer);
  if (!headerResult.ok) return headerResult;
  if (!headerResult.header.headerValid) {
    return { ok: false, error: "header_checksum_mismatch" };
  }

  const headerSize = DTU_FORMAT_CONSTANTS.HEADER_SIZE;

  // Read section table
  const sectionTable = buffer.subarray(headerSize, headerSize + 20);
  const metadataLen = sectionTable.readUInt32BE(0);
  const humanLen = sectionTable.readUInt32BE(4);
  const coreLen = sectionTable.readUInt32BE(8);
  const machineLen = sectionTable.readUInt32BE(12);
  const artifactLen = sectionTable.readUInt32BE(16);

  let offset = headerSize + 20;

  // Decompress sections
  const metadataRaw = buffer.subarray(offset, offset + metadataLen);
  offset += metadataLen;
  const metadata = JSON.parse(gunzipSync(metadataRaw).toString());

  const humanRaw = buffer.subarray(offset, offset + humanLen);
  offset += humanLen;
  const humanLayer = JSON.parse(gunzipSync(humanRaw).toString());

  let coreLayer = null;
  if (coreLen > 0) {
    const coreRaw = buffer.subarray(offset, offset + coreLen);
    offset += coreLen;
    coreLayer = JSON.parse(gunzipSync(coreRaw).toString());
  } else {
    offset += coreLen;
  }

  let machineLayer = null;
  if (machineLen > 0) {
    const machineRaw = buffer.subarray(offset, offset + machineLen);
    offset += machineLen;
    machineLayer = JSON.parse(gunzipSync(machineRaw).toString());
  } else {
    offset += machineLen;
  }

  let artifactData = null;
  if (artifactLen > 0) {
    const artifactRaw = buffer.subarray(offset, offset + artifactLen);
    artifactData = gunzipSync(artifactRaw);
  }

  return {
    ok: true,
    header: headerResult.header,
    metadata,
    humanLayer,
    coreLayer,
    machineLayer,
    artifactData,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Verification
// ─────────────────────────────────────────────────────────────────────

/**
 * Verify a DTU buffer's integrity and authenticity.
 */
export function verifyDTU(buffer, { expectedHash, expectedSignature } = {}) {
  if (!buffer) return { ok: false, error: "missing_buffer" };

  // Check header
  const headerResult = parseHeader(buffer);
  if (!headerResult.ok) return { ok: false, error: "invalid_header", detail: headerResult.error };
  if (!headerResult.header.headerValid) {
    return { ok: false, error: "header_checksum_mismatch", tampered: true };
  }

  // Compute content hash
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const signature = createHmac("sha256", SIGNING_KEY).update(buffer).digest("hex");

  const hashMatch = expectedHash ? contentHash === expectedHash : true;
  const signatureMatch = expectedSignature ? signature === expectedSignature : true;

  return {
    ok: true,
    headerValid: headerResult.header.headerValid,
    contentHash,
    hashMatch,
    signatureValid: signatureMatch,
    tampered: !hashMatch || !signatureMatch,
    header: headerResult.header,
  };
}

// ─────────────────────────────────────────────────────────────────────
// DTU File Registry (DB operations)
// ─────────────────────────────────────────────────────────────────────

/**
 * Export a DTU and register it in the file registry.
 */
export function registerDTUExport(db, {
  dtuId, exportId, fileHash, signature, formatVersion,
  primaryType, artifactType, artifactSize, totalSize,
  compressionType, layersPresent, exportedBy,
}) {
  if (!dtuId || !exportId || !fileHash || !signature || !exportedBy) {
    return { ok: false, error: "missing_required_fields" };
  }

  const id = uid("dtuf");
  const now = nowISO();

  try {
    db.prepare(`
      INSERT INTO dtu_file_registry (
        id, dtu_id, export_id, file_hash, signature,
        format_version, primary_type, artifact_type, artifact_size,
        total_size, compression_type, layers_present, exported_by, exported_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, dtuId, exportId, fileHash, signature,
      formatVersion || DTU_FORMAT_CONSTANTS.FORMAT_VERSION,
      primaryType, artifactType || null, artifactSize || 0,
      totalSize, compressionType || DTU_FORMAT_CONSTANTS.COMPRESSION_GZIP,
      layersPresent || DTU_FORMAT_CONSTANTS.LAYER_HUMAN,
      exportedBy, now,
    );

    return {
      ok: true,
      fileRecord: { id, dtuId, exportId, fileHash, signature, totalSize, exportedAt: now },
    };
  } catch (err) {
    console.error("[economy] registration_failed:", err.message);
    return { ok: false, error: "registration_failed" };
  }
}

/**
 * Look up a DTU file by its content hash.
 */
export function lookupDTUByHash(db, fileHash) {
  const row = db.prepare(
    "SELECT * FROM dtu_file_registry WHERE file_hash = ? ORDER BY exported_at DESC LIMIT 1"
  ).get(fileHash);
  if (!row) return null;
  return {
    id: row.id,
    dtuId: row.dtu_id,
    exportId: row.export_id,
    fileHash: row.file_hash,
    signature: row.signature,
    formatVersion: row.format_version,
    primaryType: row.primary_type,
    artifactType: row.artifact_type,
    artifactSize: row.artifact_size,
    totalSize: row.total_size,
    compressionType: row.compression_type,
    layersPresent: row.layers_present,
    exportedBy: row.exported_by,
    exportedAt: row.exported_at,
  };
}

/**
 * Get all exports for a DTU.
 */
export function getDTUExports(db, dtuId) {
  const rows = db.prepare(
    "SELECT * FROM dtu_file_registry WHERE dtu_id = ? ORDER BY exported_at DESC"
  ).all(dtuId);
  return {
    ok: true,
    exports: rows.map(r => ({
      id: r.id,
      dtuId: r.dtu_id,
      fileHash: r.file_hash,
      totalSize: r.total_size,
      exportedBy: r.exported_by,
      exportedAt: r.exported_at,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Reimport
// ─────────────────────────────────────────────────────────────────────

/**
 * Reimport a DTU file into the platform.
 * Validates signature, tracks the reimport.
 */
export function reimportDTU(db, { buffer, importedBy, source }) {
  if (!buffer || !importedBy) return { ok: false, error: "missing_required_fields" };

  // Parse and verify
  const headerResult = parseHeader(buffer);
  if (!headerResult.ok) return { ok: false, error: "invalid_dtu_file", detail: headerResult.error };

  const decoded = decodeDTU(buffer);
  if (!decoded.ok) return { ok: false, error: "decode_failed", detail: decoded.error };

  const fileHash = createHash("sha256").update(buffer).digest("hex");

  // Check if this was exported from our platform
  const existing = lookupDTUByHash(db, fileHash);
  const signatureVerified = !!existing;

  const id = uid("ri");
  const now = nowISO();

  try {
    db.prepare(`
      INSERT INTO dtu_reimports (id, original_dtu_id, file_hash, signature_verified, imported_by, imported_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, decoded.metadata.id, fileHash,
      signatureVerified ? 1 : 0,
      importedBy, now, source || null,
    );

    return {
      ok: true,
      reimport: {
        id,
        originalDtuId: decoded.metadata.id,
        fileHash,
        signatureVerified,
        importedBy,
        importedAt: now,
        source,
      },
      dtu: decoded,
    };
  } catch (err) {
    console.error("[economy] reimport_failed:", err.message);
    return { ok: false, error: "reimport_failed" };
  }
}

/**
 * Get reimport history for a user.
 */
export function getReimports(db, { importedBy, limit = 50 } = {}) {
  // @select-star-ok: dtu_reimports admin list — caller renders every column
  let query = "SELECT * FROM dtu_reimports";
  const params = [];
  if (importedBy) {
    query += " WHERE imported_by = ?";
    params.push(importedBy);
  }
  query += " ORDER BY imported_at DESC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(query).all(...params);
  return {
    ok: true,
    reimports: rows.map(r => ({
      id: r.id,
      originalDtuId: r.original_dtu_id,
      fileHash: r.file_hash,
      signatureVerified: !!r.signature_verified,
      importedBy: r.imported_by,
      importedAt: r.imported_at,
      source: r.source,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Simple CRC32 implementation for header checksums.
 */
function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Re-export constants
export {
  DTU_FILE_FORMAT, DTU_BINARY_LAYOUT, DTU_OS_ACTIONS,
  DTU_VIEWER, DTU_CODEC, DTU_SMART_OPEN, DTU_SHARING,
  DTU_PLATFORM_REGISTRATION, DTU_IANA_REGISTRATION,
  DTU_FORMAT_CONSTANTS,
} from "../lib/dtu-format-constants.js";
