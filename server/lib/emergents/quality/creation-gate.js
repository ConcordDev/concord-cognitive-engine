// server/lib/emergents/quality/creation-gate.js
// Per-creation quality gate for background (emergent) output. Fast sync checks
// plus optional lightweight critique sampling.

import crypto from "node:crypto";
import { runDeterministicGates } from "./deterministic-gates.js";
import { recordQualityOutcome } from "./track.js";
import { registerQualityStatsProvider } from "../../background-governor.js";
import { infer } from "../../inference/index.js";

// ── Module counters ───────────────────────────────────────────────────────────

const counters = {
  assessed: 0,
  accepted: 0,
  rejected: 0,
  reasons: {},
  byKind: {},
  critiques: { sampled: 0, ok: 0, failed: 0, avgScore: 0 },
};

// Map of normalized-creation hash → timestamp, capped at 20k entries.
const recentCreations = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isCommunicationKind(kind) {
  return kind === "communication" || kind === "idle-communicate";
}

function kindToTaskType(kind) {
  switch (kind) {
    case "communication":
    case "idle-communicate":
      return "communication";
    case "observe":
    case "observation":
      return "observation";
    case "dream":
      return "dream";
    case "synthesis":
      return "synthesis";
    case "governance":
      return "governance";
    default:
      return "default";
  }
}

function evictOldestIfNeeded() {
  if (recentCreations.size <= 20000) return;
  let oldestKey = null;
  let oldestTs = Infinity;
  for (const [k, v] of recentCreations) {
    if (v.ts < oldestTs) {
      oldestTs = v.ts;
      oldestKey = k;
    }
  }
  if (oldestKey) recentCreations.delete(oldestKey);
}

const REFUSAL_RE = /^(as an ai|i (can't|cannot) (help|assist)|i'm sorry,? but)/i;

// ── Main assessment ─────────────────────────────────────────────────────────

/**
 * Assess a single background creation.
 * @returns {{ status: "accepted"|"rejected", reasons: string[], score: number, gates: object[], historyId: string|null }}
 */
export function assessCreation({ kind, text, emergentId, taskId = null, db = null, title = null }) {
  const body = String(text || "").trim();
  const len = body.length;
  const taskType = kindToTaskType(kind);

  // Run deterministic gates; the communication kind gets its own length window.
  const gateResult = runDeterministicGates({
    body,
    task_type: taskType,
    title,
    emergent_id: emergentId,
  }, db);

  const reasons = [];
  const gates = [];
  for (const g of gateResult.details) {
    let passed = g.passed;
    if (g.name === "length" && !passed && isCommunicationKind(kind) && len >= 20 && len <= 600) {
      passed = true;
    }
    gates.push({ gate: g.name, passed });
    if (!passed) reasons.push(g.name);
  }

  // Own fast checks.
  if (!body) {
    reasons.push("empty");
  } else if (len < 20) {
    reasons.push("too_short");
  }

  const words = body.split(/\s+/).filter(Boolean);
  if (words.length >= 12) {
    const unique = new Set(words.map((w) => w.toLowerCase()));
    if (unique.size / words.length < 0.3) reasons.push("repetitive");
  }

  if (body) {
    const norm = normalize(body);
    if (norm) {
      const hash = crypto.createHash("sha256").update(`${emergentId}:${norm}`).digest("hex");
      evictOldestIfNeeded();
      const now = Date.now();
      const seen = recentCreations.get(hash);
      if (seen && seen.emergentId === emergentId && now - seen.ts < 24 * 3600 * 1000) {
        reasons.push("near_duplicate");
      }
      recentCreations.set(hash, { ts: now, emergentId });
    }
  }

  if (REFUSAL_RE.test(body) || body.includes("[no response generated]")) {
    reasons.push("refusal_or_meta");
  }

  const status = reasons.length > 0 ? "rejected" : "accepted";
  const score = 1 - Math.min(1, reasons.length * 0.25);

  // Update counters.
  counters.assessed++;
  if (status === "accepted") counters.accepted++;
  else counters.rejected++;
  for (const r of reasons) counters.reasons[r] = (counters.reasons[r] || 0) + 1;
  counters.byKind[kind] = counters.byKind[kind] || { accepted: 0, rejected: 0 };
  counters.byKind[kind][status]++;

  // Record every assessment.
  const stages = {
    kind,
    reasons,
    gates,
    len,
  };
  const historyId = recordQualityOutcome({
    emergentId,
    taskId,
    artifactId: null,
    decision: status === "accepted" ? "approve" : "reject",
    stages,
    qualityScore: score,
  }, db);

  return { status, reasons, score, gates, historyId };
}

// ── Optional lightweight critique ───────────────────────────────────────────

/**
 * Sample accepted creations for a lightweight LLM critique.
 * Never throws.
 */
export async function maybeCritique({
  kind,
  text,
  emergentId,
  historyId,
  db,
  sampleRate = Number(process.env.CONCORD_BG_CRITIQUE_SAMPLE ?? 0.1),
  random = Math.random,
}) {
  if (!historyId || !db) return null;
  if (random() >= sampleRate) return null;

  counters.critiques.sampled++;
  let parsed = null;
  let errorReason = null;

  try {
    const result = await infer({
      role: "subconscious",
      callerId: `emergent:${emergentId}:critique`,
      intent: `Rate the usefulness and clarity of this background creation. ` +
        `Respond ONLY with a JSON object {"score":0-10,"issue":"<short issue or empty>"}.\n\n` +
        `Text: ${String(text || "").slice(0, 800)}`,
      maxSteps: 1,
    }, db);

    if (result?.error) {
      errorReason = String(result.error);
    } else {
      const match = String(result?.finalText || "").match(/\{[\s\S]*?\}/);
      if (!match) throw new Error("no_json");
      parsed = JSON.parse(match[0]);
      if (typeof parsed.score !== "number" || typeof parsed.issue !== "string") {
        throw new Error("bad_shape");
      }
    }
  } catch (err) {
    errorReason = errorReason || String(err?.message || err || "parse_failed");
  }

  try {
    if (parsed) {
      db.prepare(`
        UPDATE emergent_quality_history
        SET stages_json = json_set(COALESCE(stages_json,'{}'), '$.critique', json(?))
        WHERE id = ?
      `).run(JSON.stringify({ score: parsed.score, issue: parsed.issue }), historyId);
      counters.critiques.ok++;
      counters.critiques.avgScore =
        (counters.critiques.avgScore * (counters.critiques.ok - 1) + parsed.score) /
        counters.critiques.ok;
      return parsed;
    }

    db.prepare(`
      UPDATE emergent_quality_history
      SET stages_json = json_set(COALESCE(stages_json,'{}'), '$.critique', json(?))
      WHERE id = ?
    `).run(JSON.stringify({ error: errorReason }), historyId);
    counters.critiques.failed++;
    return { error: errorReason };
  } catch {
    counters.critiques.failed++;
    return { error: errorReason };
  }
}

// ── Stats export ────────────────────────────────────────────────────────────

export function getCreationGateStats() {
  return {
    assessed: counters.assessed,
    accepted: counters.accepted,
    rejected: counters.rejected,
    reasons: { ...counters.reasons },
    byKind: JSON.parse(JSON.stringify(counters.byKind)),
    critiques: { ...counters.critiques },
  };
}

/** Test-only reset of module-level counters and dedupe cache. */
export function _resetForTest() {
  counters.assessed = 0;
  counters.accepted = 0;
  counters.rejected = 0;
  counters.reasons = {};
  counters.byKind = {};
  counters.critiques = { sampled: 0, ok: 0, failed: 0, avgScore: 0 };
  recentCreations.clear();
}

// Wire stats into the governor status payload without a static import cycle.
registerQualityStatsProvider(getCreationGateStats);
