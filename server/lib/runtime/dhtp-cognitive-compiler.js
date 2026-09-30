// server/lib/runtime/dhtp-cognitive-compiler.js
//
// DHTP Cognitive Compiler — world state → optimal model state.
// Representation tiers: FULL | COMPACT | HASH | REFERENCE | PREDICTIVE | FORBIDDEN

import crypto from "node:crypto";
import { COGNITIVE_IR_FIELDS } from "../dhtp-cognitive-ir.js";
import { scoreBlock } from "../dhtp-cognitive-ir.js";

export const REPRESENTATION_TIERS = Object.freeze({
  FULL: "full",
  COMPACT: "compact",
  HASH: "hash",
  REFERENCE: "reference",
  PREDICTIVE: "predictive",
  FORBIDDEN: "forbidden",
});

const FORBIDDEN_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /password/i,
  /bearer\s+[a-z0-9._-]+/i,
  /sk-[a-zA-Z0-9]{20,}/,
  /deploy_production/i,
  /mutate_schema/i,
];

const STALE_MARKERS = [/stale:\s*true/i, /deprecated/i, /legacy.*2019/i];

/**
 * Classify one IR field into a representation tier.
 */
export function classifyRepresentationTier(field, value, scored = {}) {
  const text = serializeValue(value);

  if (shouldForbid(field, value, text)) {
    return { tier: REPRESENTATION_TIERS.FORBIDDEN, reason: "forbidden_content" };
  }

  if (scored.decisionImpact >= 0.95 || scored.importance >= 0.95) {
    return { tier: REPRESENTATION_TIERS.FULL, reason: "high_decision_impact" };
  }

  if (field === "RELEVANT_MEMORY" && Array.isArray(value) && value.length > 0) {
    if (scored.importance >= 0.6) {
      return { tier: REPRESENTATION_TIERS.REFERENCE, reason: "dtu_reference" };
    }
    return { tier: REPRESENTATION_TIERS.HASH, reason: "memory_hash" };
  }

  if (field === "HYPOTHESES" || field === "UNCERTAINTY") {
    return { tier: REPRESENTATION_TIERS.PREDICTIVE, reason: "anticipatory" };
  }

  if (scored.importance < 0.3 && scored.freshness < 0.3) {
    return { tier: REPRESENTATION_TIERS.FORBIDDEN, reason: "stale_low_importance" };
  }

  if (scored.importance < 0.4) {
    return { tier: REPRESENTATION_TIERS.REFERENCE, reason: "low_importance_ref" };
  }

  if (scored.importance >= 0.7) {
    return { tier: REPRESENTATION_TIERS.COMPACT, reason: "structured_summary" };
  }

  return { tier: REPRESENTATION_TIERS.HASH, reason: "default_hash" };
}

function shouldForbid(field, value, text) {
  if (field === "CONSTRAINTS") return false;
  for (const pat of FORBIDDEN_PATTERNS) {
    if (pat.test(text)) return true;
  }
  for (const pat of STALE_MARKERS) {
    if (pat.test(text)) return true;
  }
  if (typeof value === "object" && value?.stale === true) return true;
  return false;
}

function serializeValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join("|");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function hashContent(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/**
 * Render one field at its assigned tier.
 */
export function renderFieldAtTier(field, value, tier) {
  const text = serializeValue(value);
  if (!text) return null;

  switch (tier) {
    case REPRESENTATION_TIERS.FORBIDDEN:
      return null;
    case REPRESENTATION_TIERS.FULL:
      return `@${field} ${text}`;
    case REPRESENTATION_TIERS.COMPACT: {
      const limit = field === "OBJECTIVE" ? 200 : 80;
      return `@${field} ${text.slice(0, limit)}${text.length > limit ? "…" : ""}`;
    }
    case REPRESENTATION_TIERS.HASH:
      return `@${field} #h[${hashContent(text)}]`;
    case REPRESENTATION_TIERS.REFERENCE:
      if (Array.isArray(value) && value[0]?.id) {
        const ids = value.map((v) => v.id?.slice(0, 8) || "?").join("+");
        return `@${field} #ref[${ids}]`;
      }
      return `@${field} #ref[${hashContent(text)}]`;
    case REPRESENTATION_TIERS.PREDICTIVE:
      return `@${field} #next[${text.slice(0, 40)}]`;
    default:
      return `@${field} ${text.slice(0, 80)}`;
  }
}

/**
 * Compile IR to cognitive packet with explicit tier assignments.
 */
export function compileCognitivePacket(ir, {
  policyFn,
  forceTier = null,
} = {}) {
  const lines = ["@DHTP2 cognitive_compiler"];
  let fullTokens = 0;
  let packetTokens = 0;
  const tierCounts = Object.fromEntries(Object.values(REPRESENTATION_TIERS).map((t) => [t, 0]));
  const fieldTiers = [];

  for (const field of COGNITIVE_IR_FIELDS) {
    const raw = ir[field];
    if (raw == null || raw === "" || (Array.isArray(raw) && !raw.length)) continue;

    const scored = policyFn ? policyFn(field, raw) : scoreBlock(field, raw, {});
    const classification = forceTier
      ? { tier: forceTier, reason: "forced" }
      : classifyRepresentationTier(field, raw, scored);

    fullTokens += Math.ceil(serializeValue(raw).length / 4);

    const line = renderFieldAtTier(field, raw, classification.tier);
    if (line) {
      lines.push(line);
      packetTokens += Math.ceil(line.length / 4);
      tierCounts[classification.tier] = (tierCounts[classification.tier] || 0) + 1;
    } else {
      tierCounts[REPRESENTATION_TIERS.FORBIDDEN]++;
    }

    fieldTiers.push({ field, tier: classification.tier, reason: classification.reason });
  }

  const packet = lines.join("\n");
  return {
    packet,
    fieldTiers,
    tierCounts,
    fullContextTokens: fullTokens,
    packetTokens,
    tokensSaved: Math.max(0, fullTokens - packetTokens),
    compressionRatio: packetTokens > 0 ? fullTokens / packetTokens : 1,
    forbiddenCount: tierCounts[REPRESENTATION_TIERS.FORBIDDEN] || 0,
  };
}

/**
 * Context ROI score — expected task quality per token.
 */
export function scoreContextROI({
  relevance = 0.5,
  reliability = 0.5,
  freshness = 0.5,
  causalImportance = 0.5,
  taskDependency = 0.5,
  expectedInformationGain = 0.5,
  tokenCost = 1,
  latencyCost = 0,
  retrievalCost = 0,
} = {}) {
  const value = relevance * reliability * freshness * causalImportance * taskDependency * expectedInformationGain;
  const cost = tokenCost + latencyCost + retrievalCost;
  return {
    contextValue: value,
    contextCost: cost,
    roi: cost > 0 ? value / cost : value,
  };
}

/**
 * Map legacy compression levels to cognitive compiler tiers.
 */
export function legacyLevelToTier(level) {
  const map = {
    verbatim: REPRESENTATION_TIERS.FULL,
    compact: REPRESENTATION_TIERS.COMPACT,
    hash: REPRESENTATION_TIERS.HASH,
    archive: REPRESENTATION_TIERS.REFERENCE,
    forget: REPRESENTATION_TIERS.FORBIDDEN,
    recover_on_demand: REPRESENTATION_TIERS.REFERENCE,
  };
  return map[level] || REPRESENTATION_TIERS.COMPACT;
}
