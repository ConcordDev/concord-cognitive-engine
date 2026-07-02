// @env-config-ok: intentional external URL references
/**
 * DTU Protocol Reference Implementation
 *
 * Defines the canonical way to create, validate, serialize, hash, and verify
 * Digital Twin Unit (DTU) documents. Every DTU follows the same envelope
 * structure regardless of content type:
 *
 *   { $schema, dtuVersion, id, type, creator, content, citations, metadata }
 *
 * The content hash (SHA-256 of canonically sorted content JSON) serves as
 * the immutable identity of the DTU's semantic payload. The id field is
 * derived from this hash at creation time.
 *
 * Core invariants:
 *   - Every DTU has a content hash that can be independently verified
 *   - Citations are append-only (you can add, never remove)
 *   - Version bumps follow semver and record changelog entries
 *   - Serialization is canonical (sorted keys) for deterministic hashing
 */

import { createHash, randomUUID } from "node:crypto";

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

const DTU_VERSION = "1.0";
const SCHEMA_BASE = "https://concord.dev/schemas/dtu";

const VALID_DTU_TYPES = new Set([
  "component", "structure", "material", "npc", "quest", "policy",
  "environment", "vehicle", "item", "zone", "event",
  // "ingest" — an externally-sourced record captured through the
  // provenance-stamped ingest path (data.gov, USAspending, ...). It has no
  // required content fields (see REQUIRED_FIELDS_BY_TYPE); its trustworthiness
  // comes from the C2PA-style metadata.provenance assertion, not a fixed shape.
  "ingest",
]);

const REQUIRED_ENVELOPE_FIELDS = ["$schema", "dtuVersion", "id", "type", "creator", "content", "citations", "metadata"];

const REQUIRED_FIELDS_BY_TYPE = {
  component: ["geometry", "material", "performance"],
  structure: ["members", "connections"],
  material: ["mechanical"],
  npc: ["identity", "personality"],
  quest: ["objectives", "rewards"],
  policy: ["rules", "jurisdiction"],
};

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function nowISO() {
  return new Date().toISOString();
}

function canonicalStringify(content) {
  // Deterministic, order-independent JSON with keys sorted at EVERY nesting
  // level. We use a replacer FUNCTION (not an array): a JSON.stringify array
  // replacer is a property ALLOWLIST applied recursively, so the previous
  // `Object.keys(content).sort()` array silently DROPPED every nested key that
  // didn't also appear at the top level — e.g. `{record:{amount:1}}` hashed as
  // `{record:{}}`. That broke content-hash tamper detection for any nested
  // payload (the whole point of the provenance contentSha256 anchor, and of
  // dedup by content hash). The function form below re-emits each plain object
  // with its own keys sorted, leaving arrays (whose order is significant) and
  // primitives untouched. This matches the correct recursive canonicalizer
  // already used in lib/dtu-portability.js.
  return JSON.stringify(content, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) sorted[k] = value[k];
      return sorted;
    }
    return value;
  });
}

function computeContentHash(content) {
  return createHash("sha256").update(canonicalStringify(content)).digest("hex");
}

function generateId(contentHash, type) {
  const prefix = type ? type.slice(0, 4) : "dtu";
  return `dtu_${prefix}_${contentHash.slice(0, 16)}`;
}

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

// A provenance value must be a string or null (never any other type).
function isStringOrNull(v) {
  return v === null || typeof v === "string";
}

// ══════════════════════════════════════════════════════════════════════════════
// DTU PROTOCOL CLASS
// ══════════════════════════════════════════════════════════════════════════════

class DTUProtocol {
  constructor() {
    this.version = DTU_VERSION;
  }

  /**
   * Build a base DTU envelope. All create methods delegate here.
   *
   * @param {string} type - DTU type
   * @param {object} content - The content payload
   * @param {object} creatorInfo - { name, id }
   * @returns {object} Full DTU document
   */
  _buildEnvelope(type, content, creatorInfo = {}) {
    const contentHash = computeContentHash(content);
    const id = generateId(contentHash, type);
    const now = nowISO();

    return {
      $schema: `${SCHEMA_BASE}/${type}/v1`,
      dtuVersion: DTU_VERSION,
      id,
      type,
      creator: {
        name: creatorInfo.name || "anonymous",
        id: creatorInfo.id || `creator_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      },
      content,
      citations: [],
      // Universal file format: any binary attached to this DTU rides here as
      // a content-addressed artifact-store reference. Each entry is
      // { name, mime, size, sha256, artifactRef, description? }.
      // Empty array on creation; populated by attachFile() as needed.
      attachments: [],
      metadata: {
        contentHash,
        version: "1.0.0",
        createdAt: now,
        updatedAt: now,
        changelog: [{ version: "1.0.0", date: now, note: "Initial creation" }],
        tags: [],
      },
    };
  }

  /**
   * Append an attachment descriptor to a DTU. The bytes themselves live in
   * the content-addressed artifact-store; this records the reference.
   *
   * Pass an artifact-store result object (from storeArtifact) OR pre-computed
   * `{ name, mime, size, sha256, artifactRef, description? }`.
   *
   * The DTU's content hash is NOT mutated by attachments — content is the
   * semantic payload, attachments are bytes that ride alongside it. This
   * keeps deduplication/citation behaviour unchanged when the same DTU
   * gains/loses attachments.
   *
   * @param {object} dtu
   * @param {object} attachment - { name, mime, size, sha256, artifactRef, description? }
   * @returns {object} updated DTU
   */
  attachFile(dtu, attachment) {
    if (!dtu || typeof dtu !== "object") throw new Error("dtu must be an object");
    if (!attachment || typeof attachment !== "object") throw new Error("attachment must be an object");
    const { name, mime, size, sha256, artifactRef, description } = attachment;
    if (!name || !mime || typeof size !== "number" || !sha256 || !artifactRef) {
      throw new Error("attachment requires {name, mime, size, sha256, artifactRef}");
    }
    if (!Array.isArray(dtu.attachments)) dtu.attachments = [];
    dtu.attachments.push({
      name,
      mime,
      size,
      sha256,
      artifactRef,
      ...(description ? { description } : {}),
      attachedAt: nowISO(),
    });
    if (dtu.metadata) dtu.metadata.updatedAt = nowISO();
    return dtu;
  }

  /**
   * Stamp a C2PA-style provenance assertion onto an existing DTU.
   *
   * This records WHERE a DTU's content came from (source URL/id), WHEN it was
   * fetched, an optional media timecode, an optional signer, and — crucially —
   * a `contentSha256` computed from the DTU's OWN `content` via the existing
   * `computeContentHash`. That hash is the tamper-evidence anchor: if anyone
   * edits `content` after stamping, `verify()` will detect the mismatch.
   *
   * APPEND-SAFE: provenance lives in `metadata.provenance`, a sibling of the
   * existing `metadata.contentHash`. `id` is derived at creation from the
   * content hash + type (see `generateId`) and is NOT touched here — stamping
   * provenance on a valid DTU never changes its identity. This makes the field
   * strictly additive: DTUs created before provenance existed keep validating.
   *
   * @param {object} dtu - an existing DTU envelope (must have `content` + `metadata`)
   * @param {object} [provenanceInput]
   * @param {string|null} [provenanceInput.sourceUrl]  - the fetched URL, if any
   * @param {string|null} [provenanceInput.sourceId]   - upstream record id, if any
   * @param {string|null} [provenanceInput.timecode]   - media timecode, if any
   * @param {string|null} [provenanceInput.fetchedAt]  - ISO fetch time (defaults to now)
   * @param {string|null} [provenanceInput.signer]     - signing identity, if any
   * @returns {object} the same DTU, with `metadata.provenance` set
   */
  stampProvenance(dtu, provenanceInput = {}) {
    if (!dtu || typeof dtu !== "object") throw new Error("dtu must be an object");
    if (!dtu.content) throw new Error("Cannot stamp provenance on a DTU without content");
    if (!dtu.metadata || typeof dtu.metadata !== "object") {
      throw new Error("Cannot stamp provenance on a DTU without metadata");
    }

    // The provenance content hash is computed from the DTU's own content using
    // the SAME canonical hash function the rest of the protocol uses — so it is
    // deterministic and independently reproducible by any verifier.
    const contentSha256 = computeContentHash(dtu.content);

    dtu.metadata.provenance = {
      sourceUrl: provenanceInput.sourceUrl ?? null,
      sourceId: provenanceInput.sourceId ?? null,
      contentSha256,
      timecode: provenanceInput.timecode ?? null,
      fetchedAt: provenanceInput.fetchedAt ?? nowISO(),
      signer: provenanceInput.signer ?? null,
    };
    dtu.metadata.updatedAt = nowISO();
    // NOTE: `dtu.id` and `dtu.metadata.contentHash` are intentionally left
    // untouched — provenance is metadata, not part of the semantic identity.
    return dtu;
  }

  /**
   * Create a Component DTU with geometry, material, and performance data.
   *
   * @param {object} config
   * @param {object} config.geometry - { shape, dimensions, connections, ... }
   * @param {object} config.material - { type, grade, properties, ... }
   * @param {object} config.performance - { loadCapacity, fireRating, ... }
   * @param {string} [config.name]
   * @param {string} [config.description]
   * @param {object} [config.creator] - { name, id }
   * @returns {object} Component DTU
   */
  createComponent(config = {}) {
    const content = {
      name: config.name || "Unnamed Component",
      description: config.description || "",
      geometry: config.geometry || { shape: "rectangular", dimensions: {}, connections: [] },
      material: config.material || { type: "steel", grade: "A36", properties: {} },
      performance: config.performance || {},
      specifications: config.specifications || {},
    };
    return this._buildEnvelope("component", content, config.creator);
  }

  /**
   * Create a Structure DTU with members, connections, and systems.
   *
   * @param {object} config
   * @param {object[]} config.members - Structural members (beams, columns, etc.)
   * @param {object[]} config.connections - Connection details between members
   * @param {object} [config.systems] - Building systems (HVAC, electrical, plumbing)
   * @param {string} [config.name]
   * @param {object} [config.creator]
   * @returns {object} Structure DTU
   */
  createStructure(config = {}) {
    const content = {
      name: config.name || "Unnamed Structure",
      description: config.description || "",
      members: config.members || [],
      connections: config.connections || [],
      systems: config.systems || {},
      loadPath: config.loadPath || { gravity: [], lateral: [] },
      codes: config.codes || [],
    };
    return this._buildEnvelope("structure", content, config.creator);
  }

  /**
   * Create a Material DTU with mechanical, thermal, and environmental properties.
   *
   * @param {object} config
   * @param {object} config.mechanical - { tensileStrength, compressiveStrength, elasticModulus, ... }
   * @param {object} [config.thermal] - { conductivity, expansionCoeff, meltingPoint, ... }
   * @param {object} [config.environmental] - { recyclable, embodiedCarbon, toxicity, ... }
   * @param {string} [config.name]
   * @param {object} [config.creator]
   * @returns {object} Material DTU
   */
  createMaterial(config = {}) {
    const content = {
      name: config.name || "Unnamed Material",
      description: config.description || "",
      classification: config.classification || "general",
      mechanical: config.mechanical || {},
      thermal: config.thermal || {},
      environmental: config.environmental || {},
      certifications: config.certifications || [],
      datasheet: config.datasheet || null,
    };
    return this._buildEnvelope("material", content, config.creator);
  }

  /**
   * Create an NPC DTU with identity, personality, schedule, and dialogue.
   *
   * @param {object} config
   * @param {object} config.identity - { name, role, species, appearance, ... }
   * @param {object} config.personality - { traits, motivations, fears, ... }
   * @param {object[]} [config.schedule] - Daily schedule entries
   * @param {object} [config.dialogue] - { greetings, topics, farewells, ... }
   * @param {object} [config.creator]
   * @returns {object} NPC DTU
   */
  createNPC(config = {}) {
    const content = {
      identity: config.identity || { name: "Unnamed NPC", role: "citizen" },
      personality: config.personality || { traits: [], motivations: [], fears: [] },
      schedule: config.schedule || [
        { time: "08:00", activity: "work", location: "workplace" },
        { time: "12:00", activity: "lunch", location: "tavern" },
        { time: "18:00", activity: "leisure", location: "home" },
        { time: "22:00", activity: "sleep", location: "home" },
      ],
      dialogue: config.dialogue || { greetings: [], topics: [], farewells: [] },
      inventory: config.inventory || [],
      relationships: config.relationships || [],
      stats: config.stats || { health: 100, stamina: 100, morale: 75 },
    };
    return this._buildEnvelope("npc", content, config.creator);
  }

  /**
   * Create a Quest DTU with objectives, rewards, and prerequisites.
   *
   * @param {object} config
   * @param {object[]} config.objectives - Quest objectives with conditions
   * @param {object} config.rewards - { xp, currency, items, reputation, ... }
   * @param {string[]} [config.prerequisites] - Required quest IDs or conditions
   * @param {string} [config.name]
   * @param {object} [config.creator]
   * @returns {object} Quest DTU
   */
  createQuest(config = {}) {
    const content = {
      name: config.name || "Unnamed Quest",
      description: config.description || "",
      type: config.questType || "main",
      difficulty: config.difficulty || "normal",
      objectives: config.objectives || [],
      rewards: config.rewards || { xp: 0, currency: 0, items: [] },
      prerequisites: config.prerequisites || [],
      branches: config.branches || [],
      failConditions: config.failConditions || [],
      timeLimit: config.timeLimit || null,
      repeatable: config.repeatable || false,
    };
    return this._buildEnvelope("quest", content, config.creator);
  }

  /**
   * Create a Policy DTU with rules, jurisdiction, and enforcement details.
   *
   * @param {object} config
   * @param {object[]} config.rules - Policy rules with conditions and actions
   * @param {object} config.jurisdiction - { scope, areas, entities, ... }
   * @param {object} [config.enforcement] - { mechanism, penalties, appeals, ... }
   * @param {string} [config.name]
   * @param {object} [config.creator]
   * @returns {object} Policy DTU
   */
  createPolicy(config = {}) {
    const content = {
      name: config.name || "Unnamed Policy",
      description: config.description || "",
      category: config.category || "general",
      rules: config.rules || [],
      jurisdiction: config.jurisdiction || { scope: "local", areas: [], entities: [] },
      enforcement: config.enforcement || { mechanism: "automatic", penalties: [], appeals: true },
      effectiveDate: config.effectiveDate || nowISO(),
      expirationDate: config.expirationDate || null,
      supersedes: config.supersedes || [],
      authority: config.authority || "platform",
    };
    return this._buildEnvelope("policy", content, config.creator);
  }

  /**
   * Create an Ingest DTU wrapping an externally-sourced record. The record's
   * trust anchor is the provenance assertion added by `stampProvenance`, not a
   * fixed content schema — so any JSON-shaped upstream record is admissible.
   *
   * @param {object} config
   * @param {string} [config.name]        - human label for the ingested record
   * @param {object} [config.source]      - { url, id } of the upstream record
   * @param {*}      [config.record]      - the raw/shaped upstream record payload
   * @param {string} [config.ingestKind]  - e.g. "open-data"
   * @param {object} [config.creator]     - { name, id }
   * @returns {object} Ingest DTU (call stampProvenance() next)
   */
  createIngest(config = {}) {
    const content = {
      name: config.name || "Ingested Record",
      ingestKind: config.ingestKind || "external",
      source: config.source || { url: null, id: null },
      record: config.record ?? {},
    };
    return this._buildEnvelope("ingest", content, config.creator);
  }

  /**
   * Validate a DTU document against the protocol schema.
   *
   * @param {object} dtu
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(dtu) {
    const errors = [];

    if (!dtu || typeof dtu !== "object") {
      return { valid: false, errors: ["DTU must be a non-null object"] };
    }

    // Check required envelope fields
    for (const field of REQUIRED_ENVELOPE_FIELDS) {
      if (!(field in dtu)) {
        errors.push(`Missing required field: '${field}'`);
      }
    }

    // Check dtuVersion
    if (dtu.dtuVersion && dtu.dtuVersion !== DTU_VERSION) {
      errors.push(`Unsupported DTU version: '${dtu.dtuVersion}' (expected '${DTU_VERSION}')`);
    }

    // Check type
    if (dtu.type && !VALID_DTU_TYPES.has(dtu.type)) {
      errors.push(`Unknown DTU type: '${dtu.type}'`);
    }

    // Check creator structure
    if (dtu.creator && typeof dtu.creator === "object") {
      if (!dtu.creator.name) errors.push("Creator must have a 'name' field");
      if (!dtu.creator.id) errors.push("Creator must have an 'id' field");
    } else if (dtu.creator !== undefined) {
      errors.push("Creator must be an object with 'name' and 'id'");
    }

    // Check content has required fields for its type
    if (dtu.type && dtu.content && REQUIRED_FIELDS_BY_TYPE[dtu.type]) {
      for (const field of REQUIRED_FIELDS_BY_TYPE[dtu.type]) {
        if (!(field in dtu.content)) {
          errors.push(`Content missing required field for type '${dtu.type}': '${field}'`);
        }
      }
    }

    // Check citations is an array
    if (dtu.citations !== undefined && !Array.isArray(dtu.citations)) {
      errors.push("Citations must be an array");
    }

    // Universal-file-format: validate attachments[] entries if present.
    // Optional field — pre-1.1 DTUs without attachments stay valid.
    if (dtu.attachments !== undefined) {
      if (!Array.isArray(dtu.attachments)) {
        errors.push("Attachments must be an array");
      } else {
        for (let i = 0; i < dtu.attachments.length; i++) {
          const att = dtu.attachments[i];
          if (!att || typeof att !== "object") {
            errors.push(`Attachment[${i}] must be an object`);
            continue;
          }
          for (const f of ["name", "mime", "size", "sha256", "artifactRef"]) {
            if (!(f in att)) errors.push(`Attachment[${i}] missing field '${f}'`);
          }
          if ("size" in att && typeof att.size !== "number") {
            errors.push(`Attachment[${i}].size must be a number`);
          }
        }
      }
    }

    // Check metadata structure
    if (dtu.metadata && typeof dtu.metadata === "object") {
      if (!dtu.metadata.contentHash) errors.push("Metadata must include 'contentHash'");
      if (!dtu.metadata.version) errors.push("Metadata must include 'version'");
      if (!dtu.metadata.createdAt) errors.push("Metadata must include 'createdAt'");

      // Provenance is OPTIONAL — pre-provenance DTUs without the field stay
      // valid (strictly additive). When present, its shape is validated:
      // `contentSha256` is required + must be 64-hex; the rest may be null.
      if (dtu.metadata.provenance !== undefined) {
        const prov = dtu.metadata.provenance;
        if (!prov || typeof prov !== "object" || Array.isArray(prov)) {
          errors.push("Metadata provenance must be an object");
        } else {
          if (typeof prov.contentSha256 !== "string" || !SHA256_HEX_RE.test(prov.contentSha256)) {
            errors.push("Provenance 'contentSha256' must be a 64-char lowercase hex string");
          }
          for (const f of ["sourceUrl", "sourceId", "timecode", "fetchedAt", "signer"]) {
            if (f in prov && !isStringOrNull(prov[f])) {
              errors.push(`Provenance '${f}' must be a string or null`);
            }
          }
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Serialize a DTU to canonical JSON (sorted keys for deterministic output).
   *
   * @param {object} dtu
   * @returns {string}
   */
  serialize(dtu) {
    return JSON.stringify(dtu, Object.keys(dtu).sort(), 2);
  }

  /**
   * Parse a DTU from a JSON string.
   *
   * @param {string} json
   * @returns {{ dtu: object|null, error?: string }}
   */
  parse(json) {
    try {
      const dtu = JSON.parse(json);
      const validation = this.validate(dtu);
      if (!validation.valid) {
        return { dtu: null, error: `Invalid DTU: ${validation.errors.join("; ")}` };
      }
      return { dtu, error: null };
    } catch (e) {
      return { dtu: null, error: `JSON parse error: ${e.message}` };
    }
  }

  /**
   * Compute the SHA-256 hash of a DTU's content field.
   * Uses canonical (sorted-key) serialization for determinism.
   *
   * @param {object} dtu
   * @returns {string} Hex-encoded SHA-256 hash
   */
  hash(dtu) {
    if (!dtu || !dtu.content) {
      throw new Error("Cannot hash DTU without content field");
    }
    return computeContentHash(dtu.content);
  }

  /**
   * Verify that a DTU's stored content hash matches its actual content.
   *
   * When `metadata.provenance` is present, this ADDITIONALLY verifies that the
   * provenance `contentSha256` still matches the live content hash — tamper
   * detection: if `content` was edited after the provenance was stamped, the
   * mismatch is the signal. The `provenance` sub-object in the return reports
   * that check independently; overall `verified` is true only when BOTH the
   * metadata content-hash and (if present) the provenance hash match.
   *
   * When provenance is absent, the return shape and semantics are EXACTLY as
   * before (no `provenance` key) — strictly backward compatible.
   *
   * @param {object} dtu
   * @returns {{ verified: boolean, expected: string|null, actual: string|null, provenance?: object }}
   */
  verify(dtu) {
    if (!dtu || !dtu.content || !dtu.metadata || !dtu.metadata.contentHash) {
      return { verified: false, expected: null, actual: null };
    }

    const actual = computeContentHash(dtu.content);
    const expected = dtu.metadata.contentHash;
    const metadataHashMatch = actual === expected;

    // No provenance → behave exactly as today.
    if (dtu.metadata.provenance === undefined) {
      return { verified: metadataHashMatch, expected, actual };
    }

    // Provenance present → verify its content hash too and report both checks.
    const prov = dtu.metadata.provenance;
    const provExpected = prov && typeof prov === "object" ? (prov.contentSha256 ?? null) : null;
    const provMatch = provExpected === actual;

    return {
      verified: metadataHashMatch && provMatch,
      expected,
      actual,
      provenance: {
        present: true,
        expected: provExpected,
        actual,
        match: provMatch,
        // Which checks passed, for callers that want a per-check breakdown.
        checks: { metadataContentHash: metadataHashMatch, provenanceContentHash: provMatch },
      },
    };
  }

  /**
   * Add a citation from one DTU to another.
   * Citations are append-only.
   *
   * @param {object} citingDtu - The DTU that is citing another
   * @param {string} citedDtuId - The ID of the DTU being cited
   * @param {string} relationship - e.g. "derived-from", "references", "extends", "uses"
   * @returns {object} The updated citing DTU
   */
  addCitation(citingDtu, citedDtuId, relationship = "references") {
    if (!citingDtu || !citingDtu.citations) {
      throw new Error("Invalid citing DTU: missing citations array");
    }
    if (!citedDtuId) {
      throw new Error("Cited DTU ID is required");
    }

    const citation = {
      dtuId: citedDtuId,
      relationship,
      addedAt: nowISO(),
    };

    citingDtu.citations.push(citation);
    citingDtu.metadata.updatedAt = nowISO();

    return citingDtu;
  }

  /**
   * Bump the version of a DTU (major, minor, or patch).
   * Recalculates the content hash after any content changes.
   *
   * @param {object} dtu - The DTU to bump
   * @param {string} [bump="patch"] - "major", "minor", or "patch"
   * @param {string} [changelog] - Description of the change
   * @returns {object} The updated DTU with new version and hash
   */
  bumpVersion(dtu, bump = "patch", changelog = "") {
    if (!dtu || !dtu.metadata || !dtu.metadata.version) {
      throw new Error("Invalid DTU: missing metadata.version");
    }

    const parts = dtu.metadata.version.split(".").map(Number);
    switch (bump) {
      case "major":
        parts[0] += 1;
        parts[1] = 0;
        parts[2] = 0;
        break;
      case "minor":
        parts[1] += 1;
        parts[2] = 0;
        break;
      case "patch":
      default:
        parts[2] += 1;
        break;
    }

    const newVersion = parts.join(".");
    const now = nowISO();

    dtu.metadata.version = newVersion;
    dtu.metadata.updatedAt = now;
    dtu.metadata.contentHash = computeContentHash(dtu.content);

    // Update the ID to reflect new content hash
    dtu.id = generateId(dtu.metadata.contentHash, dtu.type);

    // Append changelog entry
    if (!dtu.metadata.changelog) dtu.metadata.changelog = [];
    dtu.metadata.changelog.push({
      version: newVersion,
      date: now,
      note: changelog || `Version bump (${bump})`,
    });

    return dtu;
  }
}

// Phase C — converted from CommonJS to ESM. Original `module.exports`
// retained as named + default export for callers that want either form.
export default DTUProtocol;
export { DTUProtocol, canonicalStringify, computeContentHash, generateId };
