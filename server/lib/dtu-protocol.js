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

const { createHash, randomUUID } = require("crypto");

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

const DTU_VERSION = "1.0";
const SCHEMA_BASE = "https://concord.dev/schemas/dtu";

const VALID_DTU_TYPES = new Set([
  "component", "structure", "material", "npc", "quest", "policy",
  "environment", "vehicle", "item", "zone", "event",
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
  return JSON.stringify(content, Object.keys(content).sort());
}

function computeContentHash(content) {
  return createHash("sha256").update(canonicalStringify(content)).digest("hex");
}

function generateId(contentHash, type) {
  const prefix = type ? type.slice(0, 4) : "dtu";
  return `dtu_${prefix}_${contentHash.slice(0, 16)}`;
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

    // Check metadata structure
    if (dtu.metadata && typeof dtu.metadata === "object") {
      if (!dtu.metadata.contentHash) errors.push("Metadata must include 'contentHash'");
      if (!dtu.metadata.version) errors.push("Metadata must include 'version'");
      if (!dtu.metadata.createdAt) errors.push("Metadata must include 'createdAt'");
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
   * @param {object} dtu
   * @returns {{ verified: boolean, expected: string, actual: string }}
   */
  verify(dtu) {
    if (!dtu || !dtu.content || !dtu.metadata || !dtu.metadata.contentHash) {
      return { verified: false, expected: null, actual: null };
    }

    const actual = computeContentHash(dtu.content);
    const expected = dtu.metadata.contentHash;

    return {
      verified: actual === expected,
      expected,
      actual,
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

module.exports = DTUProtocol;
