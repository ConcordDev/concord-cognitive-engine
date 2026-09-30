// server/lib/dhtp-cognitive-ir.js
//
// DHTP-2 — typed cognitive intermediate representation for executive transport.
// DTU = cognitive object; DHTP = transport; model returns structured deltas.

/** Canonical IR field keys (ordered for stable serialization). */
export const COGNITIVE_IR_FIELDS = Object.freeze([
  "MISSION",
  "OBJECTIVE",
  "STATE",
  "EVIDENCE",
  "BELIEFS",
  "HYPOTHESES",
  "CONSTRAINTS",
  "AVAILABLE_CAPABILITIES",
  "RELEVANT_MEMORY",
  "FAILURE_HISTORY",
  "DEPENDENCIES",
  "UNCERTAINTY",
  "REQUEST",
  "EXPECTED_OUTPUT",
]);

/** Structured delta fields the model may return (proposals only — runtime commits). */
export const COGNITIVE_DELTA_FIELDS = Object.freeze([
  "BELIEF_UPDATE",
  "HYPOTHESIS",
  "ACTION",
  "RATIONALE_REF",
  "CONFIDENCE",
  "REQUIRED_EVIDENCE",
  "EXPECTED_RESULT",
]);

const FIELD_LINE = /^@([A-Z_]+)\s+(.+)$/;

/**
 * Build a cognitive IR object from executive world state.
 */
export function buildCognitiveIR({
  mission,
  step,
  stepIndex,
  route,
  ledger,
  lessons = [],
  recallPack,
  observation,
  priorSteps = [],
  constraints = [],
  request = "execute_step",
  expectedOutput = "structured_action",
  repoContext = null,
  toolHints = [],
} = {}) {
  const ir = {
    MISSION: mission?.id || null,
    OBJECTIVE: mission?.goal || mission?.title || "",
    STATE: [
      mission?.status,
      step?.tool ? `step:${stepIndex + 1}/${mission?.total_steps || "?"}:${step.tool}` : null,
      route?.taskClass ? `class:${route.taskClass}` : null,
      route?.workerId ? `worker:${route.workerId}` : null,
    ].filter(Boolean).join(" "),
    EVIDENCE: [],
    BELIEFS: [],
    HYPOTHESES: [],
    CONSTRAINTS: constraints.length ? constraints : [
      "model_proposes_concord_commits",
      "f0_authority_required_for_mutations",
      "deterministic_validation_before_commit",
    ],
    AVAILABLE_CAPABILITIES: route?.workerCandidates?.map((w) => w.id).join(",") || route?.workerId || "",
    RELEVANT_MEMORY: [],
    FAILURE_HISTORY: [],
    DEPENDENCIES: mission?.template || "",
    UNCERTAINTY: mission?.recovery_attempts > 0 ? `recovery_attempts:${mission.recovery_attempts}` : "",
    REQUEST: request,
    EXPECTED_OUTPUT: expectedOutput,
  };

  if (recallPack?.ok) {
    for (const r of (recallPack.recent || []).slice(0, 8)) {
      ir.RELEVANT_MEMORY.push({ id: r.id, title: r.title, kind: r.memory_kind, tier: r.tier });
    }
    for (const r of (recallPack.pinned || []).slice(0, 4)) {
      ir.RELEVANT_MEMORY.push({ id: r.id, title: r.title, kind: r.memory_kind, pinned: true });
    }
  }

  for (const l of (lessons || []).slice(0, 3)) {
    ir.BELIEFS.push(typeof l === "string" ? l : l.lesson || l.text);
  }

  if (ledger?.failed?.length) {
    for (const f of ledger.failed.slice(-3)) {
      ir.FAILURE_HISTORY.push(`${f.tool || "?"}:${f.reason || f.outcome || "failed"}`);
    }
  }
  if (ledger?.invalidated?.length) {
    for (const inv of ledger.invalidated.slice(-2)) {
      ir.FAILURE_HISTORY.push(`invalidated:${inv.reason || "workspace_changed"}`);
    }
  }

  if (priorSteps?.length) {
    ir.EVIDENCE.push(...priorSteps.map((p) => `${p.tool_name || p.tool}:${p.status}`));
  }

  if (observation) {
    const snap = typeof observation === "object"
      ? `missions:${observation.missions_running || 0} alerts:${observation.alerts_open || 0}`
      : String(observation).slice(0, 120);
    ir.EVIDENCE.push(snap);
  }

  if (repoContext?.files?.length) {
    ir.EVIDENCE.push(`repo_files:${repoContext.files.slice(0, 5).join(",")}`);
  }
  if (repoContext?.symbolHits) {
    ir.EVIDENCE.push(`repo_symbol_hits:${repoContext.symbolHits}`);
  }

  if (toolHints?.length) {
    const caps = ir.AVAILABLE_CAPABILITIES ? `${ir.AVAILABLE_CAPABILITIES},` : "";
    ir.AVAILABLE_CAPABILITIES = `${caps}tools:${toolHints.slice(0, 8).join(",")}`;
  }

  return ir;
}

/**
 * Score a block for adaptive compression policy.
 */
export function scoreBlock(field, value, { stepIndex = 0, missionAge = 0 } = {}) {
  const importance = ["OBJECTIVE", "REQUEST", "CONSTRAINTS", "EXPECTED_OUTPUT"].includes(field) ? 1.0
    : ["STATE", "ACTION", "EVIDENCE"].includes(field) ? 0.85
      : ["RELEVANT_MEMORY", "FAILURE_HISTORY", "BELIEFS"].includes(field) ? 0.7
        : 0.5;

  const freshness = field === "STATE" ? 1.0 : field === "EVIDENCE" ? 0.9 : 0.6;
  const decisionImpact = ["OBJECTIVE", "REQUEST", "CONSTRAINTS"].includes(field) ? 1.0 : 0.5;
  const recoverability = ["RELEVANT_MEMORY", "EVIDENCE"].includes(field) ? 0.9 : 0.4;

  return {
    field,
    importance,
    freshness,
    confidence: 0.8,
    dependency: field === "DEPENDENCIES" ? 0.8 : 0.3,
    provenance: "executive_compiler",
    compressionLevel: importance >= 0.9 ? "verbatim" : importance >= 0.7 ? "compact" : "hash",
    recoverability,
    tokenCost: estimateTokenCost(value),
    decisionImpact,
    missionAge,
    stepIndex,
  };
}

function estimateTokenCost(value) {
  const s = serializeFieldValue(value);
  return Math.ceil(s.length / 4);
}

function serializeFieldValue(value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) {
    if (!value.length) return "";
    if (typeof value[0] === "object") {
      return value.map((v) => v.id ? `#${String(v.id).slice(0, 8)}:${(v.title || "").slice(0, 24)}` : JSON.stringify(v)).join("|");
    }
    return value.join("|");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Serialize cognitive IR to compact transport packet.
 */
export function serializeCognitivePacket(ir, { policyFn = scoreBlock } = {}) {
  const lines = ["@DHTP2 executive"];
  let fullTokens = 0;
  let packetTokens = 0;
  const blockMeta = [];

  for (const field of COGNITIVE_IR_FIELDS) {
    const raw = ir[field];
    if (raw == null || raw === "" || (Array.isArray(raw) && !raw.length)) continue;

    const policy = policyFn(field, raw);
    const full = `@${field} ${serializeFieldValue(raw)}`;
    fullTokens += estimateTokenCost(raw);

    let line;
    if (policy.compressionLevel === "verbatim") {
      line = full;
    } else if (policy.compressionLevel === "compact") {
      const compact = serializeFieldValue(raw).slice(0, policy.decisionImpact >= 0.8 ? 200 : 80);
      line = `@${field} ${compact}`;
    } else if (field === "RELEVANT_MEMORY" && Array.isArray(raw) && raw.length > 3) {
      const ids = raw.map((m) => m.id?.slice(0, 8) || "?").join("+");
      line = `@${field} #${ids}[${raw.length}]`;
    } else {
      line = `@${field} #ref[${Array.isArray(raw) ? raw.length : 1}]`;
    }

    lines.push(line);
    packetTokens += Math.ceil(line.length / 4);
    blockMeta.push(policy);
  }

  const packet = lines.join("\n");
  return {
    packet,
    blockMeta,
    fullContextTokens: fullTokens,
    packetTokens,
    tokensSaved: Math.max(0, fullTokens - packetTokens),
    compressionRatio: packetTokens > 0 ? fullTokens / packetTokens : 1,
  };
}

/**
 * Parse model response into structured cognitive delta (proposal only).
 */
export function parseCognitiveDelta(text) {
  if (!text) return { ok: false, reason: "empty_response" };

  const delta = {};
  const lines = String(text).split("\n");
  let structured = false;

  for (const line of lines) {
    const m = line.trim().match(FIELD_LINE);
    if (!m) continue;
    const [, field, value] = m;
    if (!COGNITIVE_DELTA_FIELDS.includes(field) && !COGNITIVE_IR_FIELDS.includes(field)) continue;
    structured = true;
    if (field === "CONFIDENCE") {
      delta[field] = Math.min(1, Math.max(0, Number(value) || 0));
    } else {
      delta[field] = value.trim();
    }
  }

  if (!structured) {
    const jsonMatch = String(text).match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        for (const f of COGNITIVE_DELTA_FIELDS) {
          if (parsed[f] != null) delta[f] = parsed[f];
        }
        structured = Object.keys(delta).length > 0;
      } catch { /* fall through */ }
    }
  }

  if (!structured) {
    return { ok: false, reason: "no_structured_delta", raw: text.slice(0, 500) };
  }

  return {
    ok: true,
    delta,
    proposal: true,
    requiresValidation: true,
    requiresF0: delta.ACTION && /mutate|deploy|execute|write|delete/i.test(String(delta.ACTION)),
  };
}

/**
 * Validate delta against authority rules — model proposes, Concord commits.
 */
export function validateCognitiveDelta(delta, { f0Authorized = false } = {}) {
  if (!delta || typeof delta !== "object") {
    return { ok: false, reason: "invalid_delta" };
  }

  if (delta.ACTION && !delta.RATIONALE_REF) {
    return { ok: false, reason: "action_requires_rationale_ref" };
  }

  if (delta.CONFIDENCE != null && delta.CONFIDENCE < 0.3 && delta.ACTION) {
    return { ok: false, reason: "low_confidence_action_blocked" };
  }

  const needsF0 = delta.ACTION && /mutate|deploy|execute|write|delete|promote/i.test(String(delta.ACTION));
  if (needsF0 && !f0Authorized) {
    return { ok: false, reason: "f0_authority_required", blocked: true };
  }

  return { ok: true, validated: true };
}
