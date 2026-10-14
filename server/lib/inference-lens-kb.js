// Shared per-user inference knowledge base (STATE.inferenceLens).
// Desk macros (add_fact / query / status) and Prolog kb-* lens actions
// must read and write this same store so Facts tiles, kb-list, and
// reload all see what Add Fact persisted.

import crypto from "node:crypto";

function clamp01(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

export function getInferenceLensState() {
  const STATE = globalThis._concordSTATE;
  if (!STATE) return null;
  if (!STATE.inferenceLens) {
    STATE.inferenceLens = { kb: new Map() };
  }
  if (!(STATE.inferenceLens.kb instanceof Map)) {
    const raw = STATE.inferenceLens.kb;
    STATE.inferenceLens.kb = raw && typeof raw === "object"
      ? new Map(Object.entries(raw))
      : new Map();
  }
  return STATE.inferenceLens;
}

export function saveInferenceLens() {
  if (typeof globalThis._concordSaveStateDebounced === "function") {
    try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
  }
}

export function actorIdFromCtx(ctx) {
  return String(ctx?.actor?.userId || ctx?.userId || "anon");
}

export function userInferenceKb(userId) {
  const s = getInferenceLensState();
  if (!s) return null;
  const id = String(userId || "anon");
  if (!s.kb.has(id)) s.kb.set(id, { facts: [], rules: [] });
  const kb = s.kb.get(id);
  if (!Array.isArray(kb.facts)) kb.facts = [];
  if (!Array.isArray(kb.rules)) kb.rules = [];
  return kb;
}

/** Project a stored fact into the desk SPO shape the REST clients expect. */
export function spoView(fact) {
  if (!fact || typeof fact !== "object") return null;
  const args = Array.isArray(fact.args) ? fact.args : [];
  return {
    id: fact.id,
    subject: fact.subject != null ? String(fact.subject) : String(args[0] ?? ""),
    predicate: String(fact.predicate || ""),
    object: fact.object != null ? String(fact.object) : String(args[1] ?? ""),
    negated: Boolean(fact.negated),
    universal: Boolean(fact.universal),
    confidence: clamp01(fact.confidence == null ? 1 : fact.confidence),
    source: String(fact.source || "user").slice(0, 100),
    createdAt: fact.createdAt || fact.addedAt || null,
  };
}

function spoKey(subject, predicate, object) {
  return `${predicate}\0${subject}\0${object}`;
}

function factSpoKey(fact) {
  const v = spoView(fact);
  return spoKey(v.subject, v.predicate, v.object);
}

/**
 * Persist an SPO triple into the same per-user store kb-list reads.
 * Identity is the auth actor id — never a client-supplied user id field.
 */
export function addSpoFact(userId, input = {}) {
  const kb = userInferenceKb(userId);
  if (!kb) return { ok: false, error: "STATE unavailable" };

  const subject = String(input.subject || "").slice(0, 200);
  const predicate = String(input.predicate || "").slice(0, 100);
  const object = String(input.object || "").slice(0, 200);
  if (!subject || !predicate || !object) {
    return { ok: false, error: "subject, predicate, and object are required" };
  }

  const key = spoKey(subject, predicate, object);
  const existing = kb.facts.find((f) => factSpoKey(f) === key);
  if (existing) {
    return { ok: true, fact: spoView(existing), newDerivations: 0, duplicate: true };
  }

  const now = new Date().toISOString();
  const fact = {
    id: `fact_${crypto.randomBytes(10).toString("hex")}`,
    subject,
    predicate,
    object,
    // Prolog kb-* engine reads predicate + args
    args: [subject, object],
    negated: Boolean(input.negated),
    universal: Boolean(input.universal),
    confidence: clamp01(input.confidence == null ? 1 : input.confidence),
    source: String(input.source || "user").slice(0, 100),
    createdAt: now,
    addedAt: now,
  };
  kb.facts.push(fact);
  saveInferenceLens();
  return { ok: true, fact: spoView(fact), newDerivations: 0 };
}

export function matchSpoFact(pattern, fact) {
  const v = spoView(fact);
  if (!v) return false;
  if (pattern.subject && pattern.subject !== v.subject) return false;
  if (pattern.predicate && pattern.predicate !== v.predicate) return false;
  if (pattern.object && pattern.object !== v.object) return false;
  if (pattern.negated !== undefined && Boolean(pattern.negated) !== v.negated) return false;
  return true;
}

export function querySpoFacts(userId, query = {}) {
  const kb = userInferenceKb(userId);
  if (!kb) return { ok: false, error: "STATE unavailable" };

  const pattern = {
    subject: query.subject ? String(query.subject) : "",
    predicate: query.predicate ? String(query.predicate) : "",
    object: query.object ? String(query.object) : "",
    negated: query.negated,
  };

  const matches = kb.facts.filter((f) => matchSpoFact(pattern, f)).map(spoView);

  if (matches.length > 0) {
    return {
      ok: true,
      found: true,
      facts: matches,
      explanation: matches.map((f) =>
        `"${f.subject} ${f.predicate} ${f.object}" is a known fact`
      ),
    };
  }

  return {
    ok: true,
    found: false,
    facts: [],
    explanation: ["No matching facts found in knowledge base"],
  };
}

export function getDeskStatus(userId) {
  const kb = userInferenceKb(userId);
  if (!kb) return { ok: false, error: "STATE unavailable" };
  const factCount = kb.facts.length;
  const ruleCount = kb.rules.length;
  return {
    ok: true,
    // Desk tiles read factCount / ruleCount (InferenceDeskPanel).
    factCount,
    ruleCount,
    // Back-compat aliases for older status consumers.
    facts: factCount,
    rules: ruleCount,
    derived: 0,
    stats: {
      inferencesPerformed: 0,
      factsDeduced: 0,
      rulesApplied: 0,
    },
  };
}

export function findFactById(userId, id) {
  const kb = userInferenceKb(userId);
  if (!kb || !id) return null;
  return kb.facts.find((f) => f.id === id) || null;
}

/** Stamp subject/object onto a Prolog-shaped fact when args are binary. */
export function enrichPrologFact(fact) {
  if (!fact || typeof fact !== "object") return fact;
  const args = Array.isArray(fact.args) ? fact.args : [];
  if (fact.subject == null && args[0] != null) fact.subject = args[0];
  if (fact.object == null && args[1] != null) fact.object = args[1];
  return fact;
}
