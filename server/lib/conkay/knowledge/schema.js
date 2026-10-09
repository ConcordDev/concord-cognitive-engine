// server/lib/conkay/knowledge/schema.js
//
// The universal entity record (deliverable 1 of
// ~/.zuko/remaining-work/CONKAY-UNIVERSAL-KNOWLEDGE-LAYER-2026-10-09.md).
//
// One record shape for a material, a formulation, a substance, a recipe, a
// component, a formula or a piece of software. Eight blocks answer the four
// questions (what is it made of / how does it behave / how is it produced /
// how do we verify it): identity, composition, properties, process, evidence,
// validation, safety, relationships; plus discipline extensions.
//
// The central rule: a property is never a bare number. It is a Claim: value,
// unit, conditions, uncertainty, method, status flags and evidence refs. The
// JSON Schema below fixes the shape; claims.js enforces the rules a shape
// can't express (a claim without evidence can't be Sourced or Validated, an
// Unknown claim has no value, an estimate states its assumptions...).

import { validateAgainst } from "./json-schema-lite.js";

export const SCHEMA_VERSION = "1.1.0";
/** 1.1.0 is additive (hypothesis/contradicted statuses, bin, "law" evidence): 1.0.0 records stay valid. */
export const SUPPORTED_SCHEMA_VERSIONS = ["1.0.0", "1.1.0"];

export const ENTITY_KINDS = [
  "material", "formulation", "substance", "mixture", "fluid", "recipe", "component", "assembly",
  "formula", "algorithm", "biological_system", "software", "process",
];

/**
 * Status flags. Not mutually exclusive except "unknown", "hypothesis" and
 * "contradicted", which each stand alone (1.1.0 adds the last two):
 *   hypothesis   proposed, not established; may carry the asserted value.
 *   contradicted conflicts with a conservation law, geometry or a sourced
 *                value; needs that law/source AND the calculation showing it.
 */
export const STATUS_FLAGS = ["sourced", "measured", "computed", "estimated", "simulated", "validated", "unknown", "hypothesis", "contradicted"];

/** Statuses that stand alone. */
export const EXCLUSIVE_STATUSES = ["unknown", "hypothesis", "contradicted"];

/**
 * Disposition bins (Sentinel/RAM spec rev 1.0, section 0). A claim in
 * "unsupported-as-stated" is never promoted into a fabrication or acceptance
 * step because an internal calculation is self-consistent.
 */
export const CLAIM_BINS = ["buildable", "research-stage", "unsupported-as-stated"];

/** Whether the evidence supports what the claim asserts (independent of how a value was obtained). */
export const SUPPORT_STATES = ["unsupported", "supported", "partially_supported", "contradicted", "not_applicable"];

// "law" (1.1.0): a conservation law or geometric identity, cited by name
// (sourceId "law:<id>"), the basis a "contradicted" claim can rest on.
export const EVIDENCE_KINDS = ["document", "url", "dataset", "standard", "test_record", "calculation", "user_statement", "law"];

export const RELATIONSHIP_TYPES = [
  "made_from", "reacts_with", "contains", "depends_on", "fits_into", "derived_from",
  "version_of", "process_for", "tested_by", "supersedes",
];

const str = { type: "string", minLength: 1 };
const strOrNull = { type: ["string", "null"] };
const strList = { type: "array", items: str };

export const ENTITY_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "concord:conkay/knowledge/entity/1.0.0",
  title: "ConKay universal entity record",
  type: "object",
  required: ["schemaVersion", "id", "kind", "identity"],
  additionalProperties: false,
  properties: {
    schemaVersion: { enum: SUPPORTED_SCHEMA_VERSIONS },
    id: { $ref: "#/$defs/Id" },
    kind: { enum: ENTITY_KINDS },
    identity: { $ref: "#/$defs/Identity" },
    composition: { $ref: "#/$defs/Composition" },
    properties: { type: "array", items: { $ref: "#/$defs/Claim" } },
    process: { $ref: "#/$defs/Process" },
    evidence: { type: "array", items: { $ref: "#/$defs/EvidenceRef" } },
    validation: { $ref: "#/$defs/Validation" },
    safety: { $ref: "#/$defs/Safety" },
    relationships: { type: "array", items: { $ref: "#/$defs/Relationship" } },
    extensions: { type: "object", additionalProperties: { type: "object" } },
    provenance: { $ref: "#/$defs/Provenance" },
  },
  $defs: {
    Id: { type: "string", pattern: "^[a-z][a-z0-9_.:-]*$" },
    Identity: {
      type: "object",
      required: ["name", "version"],
      additionalProperties: false,
      properties: {
        name: str,
        aliases: strList,
        category: strOrNull,
        version: str,
        identifiers: { type: "object", additionalProperties: { type: ["string", "number"] } },
        variant: strOrNull,
      },
    },
    Quantity: {
      type: "object",
      required: ["value", "unit"],
      additionalProperties: false,
      properties: { value: { type: "number" }, unit: { type: "string" } },
    },
    Range: {
      type: "object",
      required: ["min", "max", "unit"],
      additionalProperties: false,
      properties: { min: { type: "number" }, max: { type: "number" }, unit: { type: "string" } },
    },
    Ingredient: {
      type: "object",
      required: ["id", "name", "amount"],
      additionalProperties: false,
      properties: {
        id: { $ref: "#/$defs/Id" },
        name: str,
        ref: strOrNull,
        amount: { anyOf: [{ $ref: "#/$defs/Quantity" }, { $ref: "#/$defs/Range" }] },
        tolerance: { anyOf: [{ $ref: "#/$defs/Quantity" }, { type: "null" }] },
        role: strOrNull,
        locator: strOrNull,
      },
    },
    Composition: {
      type: "object",
      required: ["basis", "ingredients"],
      additionalProperties: false,
      properties: {
        basis: { enum: ["mass", "volume", "mole", "unspecified"] },
        ingredients: { type: "array", items: { $ref: "#/$defs/Ingredient" } },
        statedTotal: { anyOf: [{ $ref: "#/$defs/Quantity" }, { type: "null" }] },
        structure: strOrNull,
        exact: { type: "boolean" },
      },
    },
    ProcessStep: {
      type: "object",
      required: ["id", "action"],
      additionalProperties: false,
      properties: {
        id: { $ref: "#/$defs/Id" },
        order: { type: "integer", minimum: 0 },
        action: str,
        equipment: strOrNull,
        conditions: { type: "object" },
        constraints: strList,
        statedAs: strOrNull,
        locator: strOrNull,
      },
    },
    Process: {
      type: "object",
      required: ["steps"],
      additionalProperties: false,
      properties: {
        versionRef: strOrNull,
        steps: { type: "array", items: { $ref: "#/$defs/ProcessStep" } },
        missing: strList,
      },
    },
    EvidenceRef: {
      type: "object",
      required: ["kind", "title"],
      additionalProperties: false,
      properties: {
        kind: { enum: EVIDENCE_KINDS },
        sourceId: strOrNull,
        title: str,
        url: { type: ["string", "null"], pattern: "^https?://" },
        document: strOrNull,
        author: strOrNull,
        date: strOrNull,
        retrieved: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        locator: strOrNull,
        excerpt: strOrNull,
        sha256: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" },
        license: strOrNull,
        receiptRef: strOrNull,
      },
    },
    Uncertainty: {
      type: "object",
      required: ["type"],
      additionalProperties: false,
      properties: {
        type: { enum: ["range", "stddev", "expanded", "pct", "unknown"] },
        low: { type: "number" },
        high: { type: "number" },
        value: { type: "number" },
        coverageFactor: { type: "number" },
        note: strOrNull,
      },
    },
    Method: {
      type: "object",
      required: ["kind"],
      additionalProperties: false,
      properties: {
        kind: { enum: ["source_document", "test", "calculation", "estimate", "simulation", "assertion", "none"] },
        description: strOrNull,
        standard: strOrNull,
        receiptRef: strOrNull,
        assumptions: strList,
      },
    },
    RequiredEvidence: {
      type: "object",
      required: ["kind", "reason"],
      additionalProperties: false,
      properties: {
        kind: { enum: ["test", "source_document", "identification", "record", "review"] },
        property: strOrNull,
        reason: str,
        testPlanRef: strOrNull,
      },
    },
    Claim: {
      type: "object",
      required: ["id", "subject", "property", "status", "support", "evidence", "conditions"],
      additionalProperties: false,
      properties: {
        id: { $ref: "#/$defs/Id" },
        subject: str,
        property: { type: ["string", "null"] },
        relatedProperties: strList,
        kind: { enum: ["quantitative", "qualitative"] },
        value: { type: ["number", "string", "boolean", "null"] },
        range: { anyOf: [{ type: "object", required: ["min", "max"], additionalProperties: false, properties: { min: { type: "number" }, max: { type: "number" } } }, { type: "null" }] },
        unit: strOrNull,
        statement: strOrNull,
        conditions: { type: "object" },
        missingConditions: strList,
        uncertainty: { anyOf: [{ $ref: "#/$defs/Uncertainty" }, { type: "null" }] },
        method: { $ref: "#/$defs/Method" },
        status: { type: "array", minItems: 1, uniqueItems: true, items: { enum: STATUS_FLAGS } },
        support: { enum: SUPPORT_STATES },
        bin: { enum: [...CLAIM_BINS, null] },
        evidence: { type: "array", items: { $ref: "#/$defs/EvidenceRef" } },
        requiredEvidence: { type: "array", items: { $ref: "#/$defs/RequiredEvidence" } },
        assertedBy: { anyOf: [{ type: "object", required: ["source"], additionalProperties: false, properties: { source: str, locator: strOrNull, quote: strOrNull } }, { type: "null" }] },
        attributedTo: strOrNull,
        label: strOrNull,
        flags: strList,
        notes: strList,
      },
    },
    Validation: {
      type: "object",
      additionalProperties: false,
      properties: {
        tests: { type: "array", items: { type: "object" } },
        referenceResults: { type: "array", items: { type: "object" } },
        failedChecks: { type: "array", items: { type: "object" } },
        confidence: { enum: ["none", "low", "medium", "high"] },
        knownLimitations: strList,
      },
    },
    Safety: {
      type: "object",
      additionalProperties: false,
      properties: {
        hazards: { type: "array", items: { type: "object" } },
        incompatibilities: { type: "array", items: { type: "object" } },
        exposureLimits: { type: "array", items: { type: "object" } },
        intendedUseRestrictions: strList,
      },
    },
    Relationship: {
      type: "object",
      required: ["type", "target"],
      additionalProperties: false,
      properties: { type: { enum: RELATIONSHIP_TYPES }, target: str, note: strOrNull },
    },
    Provenance: {
      type: "object",
      additionalProperties: false,
      properties: {
        createdBy: strOrNull,
        createdAt: strOrNull,
        immutable: { type: "boolean" },
        contentSha256: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" },
        rule: { type: "object" },
        derivedFrom: strOrNull,
      },
    },
  },
};

/** The claim schema on its own (shares the entity schema's $defs). */
export const CLAIM_SCHEMA = { $ref: "#/$defs/Claim", $defs: ENTITY_SCHEMA.$defs };

/** Shape-check an entity record (not the claim rules; see validateEntity in index.js). */
export function validateEntityShape(record) {
  return validateAgainst(ENTITY_SCHEMA, record);
}

/** Shape-check a single claim. */
export function validateClaimShape(claim, path = "$") {
  return validateAgainst(CLAIM_SCHEMA, claim, path);
}
