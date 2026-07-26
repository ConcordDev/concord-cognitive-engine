/**
 * System: Dream Capture Pipeline
 *
 * Voice memo or text → DTU with source:dream tag → convergence check against
 * existing lattice. The meta-derivation module is the brain. This is the ears.
 *
 * Convergence detection: when dream inputs and lattice derivations independently
 * arrive at the same truth, flag as potentially validated and queue for
 * meta-derivation evaluation.
 *
 * All state in module-level structures. Silent failure. Additive only.
 */

import crypto from "crypto";
import logger from '../logger.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "dream") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function getSTATE() { return globalThis._concordSTATE || null; }

// ── Retrieval Helper ────────────────────────────────────────────────────────

async function retrieveDTUs(query, opts = {}) {
  if (typeof globalThis._concordRetrieve === "function") {
    try { return await globalThis._concordRetrieve(query, opts); } catch (_e) { logger.debug('emergent:dream-capture', 'fallback', { error: _e?.message }); }
  }
  const STATE = getSTATE();
  if (!STATE?.dtus) return [];

  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const results = [];
  for (const dtu of STATE.dtus.values()) {
    const text = `${dtu.human?.summary || ""} ${(dtu.tags || []).join(" ")}`.toLowerCase();
    const matchCount = terms.filter(t => text.includes(t)).length;
    if (matchCount > 0) {
      results.push({ ...dtu, _score: matchCount / terms.length });
    }
  }
  results.sort((a, b) => b._score - a._score);
  return results.slice(0, opts.topK || 10);
}

// ── Key Point Extraction ────────────────────────────────────────────────────

function extractKeyPoints(text) {
  // Simple sentence-based extraction
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  return sentences.slice(0, 5).map(s => s.trim());
}

// ── Convergence Detection ───────────────────────────────────────────────────

async function checkConvergence(dreamText, STATE) {
  const similar = await retrieveDTUs(dreamText, { topK: 10 });

  // Filter for high similarity that were NOT created by sovereign/user
  // (convergence = independent discovery, not self-referencing)
  const independent = similar.filter(d =>
    d.source !== "sovereign" &&
    d.source !== "user" &&
    d.source !== "dream" &&
    d._score > 0.7
  );

  if (independent.length === 0) return { found: false, matches: [], similarity: 0 };

  return {
    found: true,
    matches: independent.slice(0, 5),
    similarity: independent[0]._score,
  };
}

// ── Landmark Logging ────────────────────────────────────────────────────────

function logLandmark(type, data, STATE) {
  if (!STATE._landmarks) STATE._landmarks = [];
  STATE._landmarks.push({
    type,
    ...data,
    timestamp: nowISO(),
  });
  // Cap at 1000
  if (STATE._landmarks.length > 1000) {
    STATE._landmarks = STATE._landmarks.slice(-1000);
  }
}

// ── Dream Capture ───────────────────────────────────────────────────────────

export async function captureDream(input) {
  const STATE = getSTATE();
  if (!STATE?.dtus) return { ok: false, error: "STATE not available" };

  const { text, tags = [], title, urgency = "normal" } = input || {};
  if (!text || text.length < 10) return { ok: false, error: "Too short (min 10 chars)" };

  // 1. Create dream DTU
  const dtu = {
    id: uid("dream"),
    type: "dream_derivation",
    tier: "shadow",
    title: title || `Dream: ${text.slice(0, 60)}${text.length > 60 ? "..." : ""}`,
    human: {
      summary: text,
      bullets: extractKeyPoints(text),
    },
    machine: {
      kind: "dream_derivation",
      capturedAt: nowISO(),
      urgency,
      rawLength: text.length,
    },
    tags: ["dream", "source:dream", "meta_derivation_candidate", ...tags],
    source: "dream",
    authority: { model: "sovereign_dream", score: 0.9 },
    lineage: { parents: [], children: [] },
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  STATE.dtus.set(dtu.id, dtu);

  // 2. Run convergence check
  const convergenceResult = await checkConvergence(text, STATE);

  if (convergenceResult.found) {
    dtu.machine.convergence = {
      found: true,
      matchingDTUs: convergenceResult.matches.map(m => m.id),
      similarity: convergenceResult.similarity,
      significance: "Dream derivation converges with independent lattice derivation",
    };
    dtu.tags.push("convergence_detected");

    logLandmark("dream_convergence", {
      dreamId: dtu.id,
      matchIds: convergenceResult.matches.map(m => m.id),
      similarity: convergenceResult.similarity,
    }, STATE);
  }

  // 3. Queue for meta-derivation evaluation
  if (!STATE._metaDerivationQueue) STATE._metaDerivationQueue = [];
  STATE._metaDerivationQueue.push(dtu.id);

  // 4. Emit for dashboard
  if (typeof globalThis.realtimeEmit === "function") {
    globalThis.realtimeEmit("dream:captured", {
      id: dtu.id,
      title: dtu.title,
      convergence: convergenceResult.found,
    });
  }

  return {
    ok: true,
    dtu: { id: dtu.id, title: dtu.title },
    convergence: convergenceResult,
  };
}

// ── Query Helpers ───────────────────────────────────────────────────────────

export function getDreamHistory(limit = 50) {
  const STATE = getSTATE();
  if (!STATE?.dtus) return { ok: true, dreams: [] };

  const dreams = [];
  for (const d of STATE.dtus.values()) {
    if (d.source === "dream") dreams.push(d);
  }

  dreams.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    ok: true,
    dreams: dreams.slice(0, limit).map(d => ({
      id: d.id,
      title: d.title,
      summary: d.human?.summary?.slice(0, 200),
      convergence: d.machine?.convergence?.found || false,
      capturedAt: d.machine?.capturedAt,
      tags: d.tags,
    })),
  };
}

export function getConvergences() {
  const STATE = getSTATE();
  if (!STATE?.dtus) return { ok: true, convergences: [] };

  const convergences = [];
  for (const d of STATE.dtus.values()) {
    if (d.source === "dream" && d.tags?.includes("convergence_detected")) {
      convergences.push(d);
    }
  }

  convergences.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { ok: true, convergences };
}

export function getDreamQueue() {
  const STATE = getSTATE();
  return {
    ok: true,
    queue: (STATE?._metaDerivationQueue || []).slice(),
  };
}

export function countDreams() {
  const STATE = getSTATE();
  if (!STATE?.dtus) return 0;
  let count = 0;
  for (const d of STATE.dtus.values()) {
    if (d.source === "dream") count++;
  }
  return count;
}

export function countConvergences() {
  const STATE = getSTATE();
  if (!STATE?.dtus) return 0;
  let count = 0;
  for (const d of STATE.dtus.values()) {
    if (d.source === "dream" && d.tags?.includes("convergence_detected")) count++;
  }
  return count;
}

// ── Sovereign Command Handler ───────────────────────────────────────────────

export function handleDreamCommand(parts) {
  const sub = parts[0]?.toLowerCase();

  switch (sub) {
    case "dream":
      return captureDream({ text: parts.slice(1).join(" ") });
    case "dream-history":
      return getDreamHistory(parseInt(parts[1] || "20", 10));
    case "dream-convergences":
      return getConvergences();
    case "dream-queue":
      return getDreamQueue();
    default:
      return { ok: false, error: `Unknown dream command: ${sub}` };
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

// `helpers` was destructured here and never referenced — the signature
// implied a dependency this module does not have. STATE is genuinely used
// below. Callers still pass both; extra arguments are ignored.
export function init({ STATE } = {}) {
  if (STATE) globalThis._concordSTATE = STATE;
  return { ok: true };
}
