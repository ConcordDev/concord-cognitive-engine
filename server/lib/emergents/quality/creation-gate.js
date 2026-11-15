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

// ── IDLE-03 (GB-1540): real near-duplicate detection ─────────────────────────
// The exact-hash check below only catches byte-identical repeats. The
// novelty gate compares word 3-shingle sets (Jaccard) against recent
// creations recorded in emergent_quality_history — the citizen's own and
// a fleet window — so paraphrases and cross-citizen copies are caught.
// Each assessment stores its own shingle signature in stages_json; rows
// written before this gate have none and are skipped (the check
// strengthens as new rows accumulate). Deterministic — no model call:
// the gate must not spend what IDLE-01 budgets.
export const NEAR_DUP_THRESHOLD = 0.8;

export function shingleSet(text) {
  const words = normalize(text).split(" ").filter(Boolean);
  const out = new Set();
  if (words.length < 3) {
    if (words.length) out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i + 3 <= words.length; i++) out.add(words.slice(i, i + 3).join(" "));
  return out;
}

export function jaccardSimilarity(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const s of a) if (b.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

function shingleSignature(shingles) {
  return [...shingles]
    .map((s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12))
    .sort()
    .join(",");
}

function maxRecentSimilarity(db, emergentId, shingles, now) {
  if (!db || !shingles.size) return 0;
  try {
    const rows = db.prepare(`
      SELECT stages_json FROM emergent_quality_history
      WHERE created_at > ?
      ORDER BY created_at DESC
      LIMIT 300
    `).all(now - 24 * 3600 * 1000);
    let max = 0;
    const mine = new Set(shingleSignature(shingles).split(","));
    for (const row of rows) {
      try {
        const sig = JSON.parse(row.stages_json || "{}")?.shingleSig;
        if (!sig) continue;
        const prior = new Set(sig.split(","));
        // Signatures store shingle HASHES; compare in hash space.
        const sim = jaccardSimilarity(mine, prior);
        if (sim > max) max = sim;
        if (max >= 1) break;
      } catch { /* skip malformed rows */ }
    }
    return max;
  } catch { return 0; }
}

// ── Main assessment ─────────────────────────────────────────────────────────

/**
 * Assess a single background creation.
 * IDLE-03 (GB-1540): substrate-derived kinds pass requireDtuLink with
 * their source DTU ids in artifactIds — the link is recorded in
 * artifact_id, and without it the creation is rejected before
 * persistence. `promotable` is a positive proof (accepted AND carrying
 * a DTU link), not the old 1.0-by-default: the score stays a violation
 * counter, but approval alone no longer promotes.
 * @returns {{ status: "accepted"|"rejected", reasons: string[], score: number, gates: object[], historyId: string|null, promotable: boolean }}
 */
export function assessCreation({ kind, text, emergentId, taskId = null, db = null, title = null, artifactIds = null, requireDtuLink = false }) {
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

  // IDLE-03: similarity near-duplicate against recent recorded creations
  // (own + fleet window). The exact hash above is only the cheap first
  // pass; a paraphrase or a cross-citizen copy is caught here.
  const shingles = body ? shingleSet(body) : new Set();
  if (body && db && !reasons.includes("near_duplicate")) {
    const sim = maxRecentSimilarity(db, emergentId, shingles, Date.now());
    if (sim >= NEAR_DUP_THRESHOLD) reasons.push("near_duplicate");
  }

  // IDLE-03: a substrate-derived creation must carry its DTU link.
  const linkIds = Array.isArray(artifactIds) ? artifactIds.filter(Boolean) : [];
  if (requireDtuLink && linkIds.length === 0) reasons.push("missing_dtu_link");

  if (REFUSAL_RE.test(body) || body.includes("[no response generated]")) {
    reasons.push("refusal_or_meta");
  }

  const status = reasons.length > 0 ? "rejected" : "accepted";
  const score = 1 - Math.min(1, reasons.length * 0.25);
  // IDLE-03: promotion is a positive proof — accepted AND DTU-linked.
  // Kinds with no substrate link by design (dreams, messages) persist on
  // acceptance but are never promotable.
  const promotable = status === "accepted" && linkIds.length > 0;

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
    artifactIds: linkIds,
    promotable,
    shingleSig: shingleSignature(shingles),
  };
  const historyId = recordQualityOutcome({
    emergentId,
    taskId,
    artifactId: linkIds[0] || null,
    decision: status === "accepted" ? "approve" : "reject",
    stages,
    qualityScore: score,
  }, db);

  return { status, reasons, score, gates, historyId, promotable };
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
