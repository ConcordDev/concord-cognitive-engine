// server/lib/runtime/cognitive-recovery.js
//
// Recoverable compression — every non-FULL field carries a recovery contract.
// Progressive disclosure: recompile one field without expanding the whole packet.

import crypto from "node:crypto";
import {
  REPRESENTATION_TIERS,
  renderFieldAtTier,
  classifyRepresentationTier,
} from "./dhtp-cognitive-compiler.js";

const DEFAULT_LOSS_BUDGET = Number(process.env.DHTP_RECOVERY_LOSS_BUDGET ?? 0.05);

function hashContent(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, 16);
}

function serializeValue(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join("|");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Build recovery contract for one compressed field.
 */
export function buildRecoveryContract(field, value, tier, scored = {}) {
  const text = serializeValue(value);
  const contentHash = hashContent(text);
  const pointer = `rc_${field}_${contentHash.slice(0, 8)}`;

  const recoverable = tier !== REPRESENTATION_TIERS.FORBIDDEN
    && tier !== REPRESENTATION_TIERS.FULL;

  return {
    field,
    representation: tier,
    confidence: scored.confidence ?? scored.importance ?? 0.5,
    source: scored.source || "cognitive_ir",
    hash: contentHash,
    recovery_pointer: recoverable ? pointer : null,
    loss_budget: tier === REPRESENTATION_TIERS.HASH ? DEFAULT_LOSS_BUDGET * 2
      : tier === REPRESENTATION_TIERS.REFERENCE ? DEFAULT_LOSS_BUDGET
        : tier === REPRESENTATION_TIERS.PREDICTIVE ? DEFAULT_LOSS_BUDGET * 1.5
          : DEFAULT_LOSS_BUDGET,
    recoverable,
    byteLength: text.length,
  };
}

/**
 * Attach recovery contracts to a compiled packet.
 */
export function attachRecoveryContracts(ir, compiled, policyFn) {
  const contracts = {};
  const fieldTiers = compiled.fieldTiers || [];

  for (const { field, tier } of fieldTiers) {
    const raw = ir[field];
    if (raw == null) continue;
    const scored = policyFn ? policyFn(field, raw) : {};
    contracts[field] = buildRecoveryContract(field, raw, tier, scored);
  }

  return {
    ...compiled,
    recoveryContracts: contracts,
    recoverableFieldCount: Object.values(contracts).filter((c) => c.recoverable).length,
  };
}

/**
 * Progressive disclosure — expand one field to FULL in an existing packet.
 */
export function recompileField(compiled, pointer, { ir, policyFn } = {}) {
  if (!compiled?.recoveryContracts || !pointer || !ir) {
    return { ok: false, reason: "missing_inputs" };
  }

  // Delegate to resolveRecoveryPointer (below) rather than a plain exact
  // match against `recovery_pointer` — a real model-issued request can come
  // in as a direct contract key, an exact recovery_pointer, or a shorthand
  // like "REF_81" that only fuzzy-matches by field name or hash prefix (see
  // that function's own doc comment). This entry point is exactly the "model
  // request" case it describes, so it should use the same resolver — a
  // duplicated exact-only match here silently rejected the shorthand form.
  const resolved = resolveRecoveryPointer(pointer, compiled.recoveryContracts);

  if (!resolved) {
    return { ok: false, reason: "pointer_not_found", pointer };
  }

  const { field } = resolved;
  const value = ir[field];
  if (value == null) {
    return { ok: false, reason: "field_missing", field };
  }

  const scored = policyFn ? policyFn(field, value) : { importance: 1, decisionImpact: 1 };
  const fullLine = renderFieldAtTier(field, value, REPRESENTATION_TIERS.FULL);
  if (!fullLine) {
    return { ok: false, reason: "render_failed", field };
  }

  const lines = (compiled.packet || "").split("\n");
  const idx = lines.findIndex((l) => l.startsWith(`@${field} `));
  if (idx >= 0) {
    lines[idx] = fullLine;
  } else {
    lines.push(fullLine);
  }

  const updatedContracts = { ...compiled.recoveryContracts };
  updatedContracts[field] = buildRecoveryContract(field, value, REPRESENTATION_TIERS.FULL, scored);

  const packet = lines.join("\n");
  return {
    ok: true,
    field,
    pointer,
    packet,
    line: fullLine,
    recoveryContracts: updatedContracts,
    recoveryRequired: true,
    tokensAdded: Math.ceil(fullLine.length / 4),
  };
}

/**
 * Resolve recovery pointer from model request ("REF_81" / "rc_FIELD_hash").
 */
export function resolveRecoveryPointer(pointer, recoveryContracts) {
  if (!pointer || !recoveryContracts) return null;
  const direct = recoveryContracts[pointer];
  if (direct) return { field: pointer, contract: direct };

  for (const [field, contract] of Object.entries(recoveryContracts)) {
    if (contract.recovery_pointer === pointer) {
      return { field, contract };
    }
    if (pointer.includes(field) || contract.hash?.startsWith(pointer.replace(/^#?ref[_-]?/i, ""))) {
      return { field, contract };
    }
  }
  return null;
}

/**
 * Persist recovery event for learning loop.
 */
export function recordRecoveryEvent(db, {
  missionId, field, pointer, success, latencyMs,
} = {}) {
  if (!db) return { ok: false };
  try {
    db.prepare(`
      INSERT INTO cognitive_recovery_events
        (mission_id, field, recovery_pointer, success, latency_ms)
      VALUES (?, ?, ?, ?, ?)
    `).run(missionId || null, field, pointer, success ? 1 : 0, latencyMs ?? null);
    return { ok: true };
  } catch {
    return { ok: false, reason: "table_missing" };
  }
}
