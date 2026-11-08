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
  let predicate = String(input.predicate || "").slice(0, 100);
  const object = String(input.object || "").slice(0, 200);
  if (!subject || !predicate || !object) {
    return { ok: false, error: "subject, predicate, and object are required" };
  }

  // S-INF-2 (F3): negation is logic, not a string. "is not" / "isn't" in
  // the predicate is parsed as a negated "is" (an explicit negated flag
  // from the form's control wins), so the KB can hold P and ¬P as the
  // contradiction they are instead of two unrelated predicates.
  let negated = Boolean(input.negated);
  if (/^is\s*(not|n't)$/i.test(predicate.trim()) || /^isnt$/i.test(predicate.trim())) {
    predicate = "is";
    negated = !negated;
  }

  const key = spoKey(subject, predicate, object);
  // Identity is triple + polarity: the same triple at the SAME polarity
  // is a duplicate, but the OPPOSITE polarity is a different fact — the
  // contradiction (S-INF-2/F3). Keying on the triple alone silently
  // swallowed every negation of a standing fact as a "duplicate".
  const existing = kb.facts.find((f) => factSpoKey(f) === key && Boolean(f.negated) === negated);
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
    negated,
    universal: Boolean(input.universal),
    confidence: clamp01(input.confidence == null ? 1 : input.confidence),
    source: String(input.source || "user").slice(0, 100),
    createdAt: now,
    addedAt: now,
  };
  kb.facts.push(fact);
  // S-INF-2 (F3): a fact that contradicts a standing one is flagged at
  // entry — same triple, opposite polarity.
  const twin = kb.facts.find((f) => f.id !== fact.id && factSpoKey(f) === key && Boolean(f.negated) !== negated);
  saveInferenceLens();
  return {
    ok: true,
    fact: spoView(fact),
    newDerivations: 0,
    ...(twin ? { contradiction: { withFactId: twin.id, statement: `${subject} ${predicate} ${object}`, negated } } : {}),
  };
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
  deskCounters(kb).queries += 1;
  saveInferenceLens();

  if (matches.length > 0) {
    // S-INF-2 (F3): a matched fact whose opposite-polarity twin also
    // stands is flagged in the result, not presented with equal calm.
    const contradictions = [];
    const seenContra = new Set();
    for (const m of matches) {
      const twin = kb.facts.find((f) => factSpoKey(f) === spoKey(m.subject, m.predicate, m.object) && Boolean(f.negated) !== Boolean(m.negated));
      const ck = spoKey(m.subject, m.predicate, m.object);
      if (twin && !seenContra.has(ck)) {
        seenContra.add(ck);
        contradictions.push({ subject: m.subject, predicate: m.predicate, object: m.object });
      }
    }
    return {
      ok: true,
      found: true,
      facts: matches,
      ...(contradictions.length > 0 ? { contradictions } : {}),
      explanation: [
        ...matches.map((f) =>
          `"${f.subject} ${f.predicate} ${f.object}" is a known fact${f.negated ? " (negated)" : ""}`
        ),
        ...contradictions.map((c) =>
          `Contradiction: the knowledge base holds both "${c.subject} ${c.predicate} ${c.object}" and its negation`
        ),
      ],
    };
  }

  return {
    ok: true,
    found: false,
    facts: [],
    explanation: ["No matching facts found in knowledge base"],
  };
}

/** Desk operation counters (F6): the tiles count what they name. */
export function deskCounters(kb) {
  if (!kb.counters) kb.counters = { queries: 0, inferences: 0, derivations: 0 };
  return kb.counters;
}

export function noteDeskOperation(userId, kind, n = 1) {
  const kb = userInferenceKb(userId);
  if (!kb) return;
  const c = deskCounters(kb);
  if (kind === "query") c.queries += n;
  else if (kind === "inference") c.inferences += n;
  else if (kind === "derivation") c.derivations += n;
  saveInferenceLens();
}

export function getDeskStatus(userId) {
  const kb = userInferenceKb(userId);
  if (!kb) return { ok: false, error: "STATE unavailable" };
  const factCount = kb.facts.length;
  const ruleCount = kb.rules.length;
  const counters = deskCounters(kb);
  return {
    ok: true,
    // Desk tiles read factCount / ruleCount (InferenceDeskPanel).
    factCount,
    ruleCount,
    // Back-compat aliases for older status consumers.
    facts: factCount,
    rules: ruleCount,
    derived: counters.derivations,
    counters,
    stats: {
      inferencesPerformed: counters.inferences,
      factsDeduced: counters.derivations,
      rulesApplied: counters.inferences,
      queriesRun: counters.queries,
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
