// server/lib/understanding-engine.js
//
// Understanding primitive — the discrete `understand(x) → model` macro
// the substrate has been missing.
//
// Pattern-matching is interpolation. Understanding is extrapolation:
// you can only generate abnormal patterns if you have a model of the
// material to deviate from. Most LLM stacks have no architectural slot
// where understanding happens — the transformer just predicts the next
// token. Concord has the pieces (DTU.machine layer, HLM topology, HLR
// reasoning, drift contradiction-detection, forward-sim prediction)
// but until now they weren't wired as a single primitive.
//
// Architecture (honoring the original DTU template intent):
//
//   DTU.machine layer          ← machine-readable substrate
//        ↓
//   HLM (High-Level Mapping)   ← machine-language structure
//        ↓                       (clusters / bridges / orphans / gaps / topology)
//   HLR (High-Level Reasoning) ← reasons over HLM output
//        ↓                       (constraint_check / deductive / abductive / …)
//   Understanding              ← typed model: entities + claims + relations
//                                + constraints + consistency + gaps +
//                                predictions + confidence
//
// Output is queryable by other lenses. Chat/council/cognition/forge can
// call `understanding.parse(input)` and get a structured model back
// instead of orchestrating five engines themselves.

import crypto from "crypto";

import { runHLMPass } from "../emergent/hlm-engine.js";
import { runHLR, REASONING_MODES } from "../emergent/hlr-engine.js";

// ── Constants ─────────────────────────────────────────────────────────────

export const COMPOSER_DETERMINISTIC = "deterministic";
export const COMPOSER_HLR = "hlr";
export const COMPOSER_LLM = "llm";

export const SUBJECT_KINDS = Object.freeze([
  "dtu", "claims", "raw", "entity", "world", "faction",
]);

const CONSTRAINT_RE = /\b(must not|must-not|cannot|never|must|requires|implies|should)\b/i;
const NEGATION_RE  = /\bnot\b|\bno\b|\bcannot\b|\bnever\b/i;

const DEFAULT_TTL_DAYS = 30;

// ── Internal helpers ──────────────────────────────────────────────────────

function uid(prefix = "und") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function expiryISO(days = DEFAULT_TTL_DAYS) {
  const d = new Date(Date.now() + days * 86400_000);
  return d.toISOString().replace("T", " ").replace("Z", "");
}

function safeJSON(value, fallback) {
  try { return JSON.stringify(value); }
  catch { return JSON.stringify(fallback); }
}

function parseJSON(s, fallback) {
  if (s == null) return fallback;
  try { return JSON.parse(s); }
  catch { return fallback; }
}

// ── Claim shape extraction ────────────────────────────────────────────────

/**
 * Extract a claim from a DTU's machine layer or core layer.
 * The DTU template's `machine` payload is the canonical source — when
 * present we trust it; otherwise we fall back to `core` claim arrays;
 * otherwise we shed back to the human summary as a low-confidence claim.
 */
function dtuClaims(dtu) {
  if (!dtu || typeof dtu !== "object") return [];
  const out = [];
  const machine = dtu.machine || dtu.machine_json || (dtu.body_json && dtu.body_json.machine);
  if (machine) {
    if (Array.isArray(machine.claims)) {
      for (const c of machine.claims) {
        if (typeof c === "string" && c.trim()) out.push({ text: c.trim(), source: "machine", confidence: 0.9 });
        else if (c && typeof c === "object" && c.text) out.push({ text: String(c.text).trim(), source: "machine", confidence: typeof c.confidence === "number" ? c.confidence : 0.9, ...c });
      }
    }
    if (Array.isArray(machine.tags)) {
      for (const t of machine.tags) {
        if (typeof t === "string" && t.trim()) out.push({ text: `tagged: ${t.trim()}`, source: "machine.tags", confidence: 0.7 });
      }
    }
  }
  const core = dtu.core || dtu.core_json || (dtu.body_json && dtu.body_json.core);
  if (core && Array.isArray(core.claims)) {
    for (const c of core.claims) {
      if (typeof c === "string" && c.trim()) out.push({ text: c.trim(), source: "core", confidence: 0.8 });
    }
  }
  if (out.length === 0) {
    const summary = dtu.human?.summary || dtu.summary || dtu.title;
    if (summary) out.push({ text: String(summary), source: "human", confidence: 0.5 });
  }
  return out;
}

/**
 * Lift a list of free-text claims into the same internal claim shape.
 */
function liftClaims(rawClaims) {
  if (!Array.isArray(rawClaims)) return [];
  const out = [];
  for (const c of rawClaims) {
    if (typeof c === "string" && c.trim()) {
      out.push({ text: c.trim(), source: "raw", confidence: 0.6 });
    } else if (c && typeof c === "object" && c.text) {
      out.push({
        text: String(c.text).trim(),
        source: c.source || "raw",
        confidence: typeof c.confidence === "number" ? c.confidence : 0.6,
      });
    }
  }
  return out;
}

/**
 * Detect entities mentioned in a claim. Cheap heuristic: capitalised
 * tokens of length ≥3 not at sentence start. Returns a Set of strings.
 */
function detectEntities(text) {
  const found = new Set();
  if (!text) return found;
  const tokens = text.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/[.,;:!?()'"]/g, "");
    if (t.length < 3) continue;
    if (i === 0) continue;                // sentence-initial tokens skipped
    if (/^[A-Z][a-zA-Z0-9_-]+$/.test(t)) found.add(t);
  }
  return found;
}

/**
 * Detect constraint statements ("X must Y", "X cannot Y", "X should Y")
 * and return a typed constraint shape.
 */
function detectConstraint(text, claimId) {
  if (!CONSTRAINT_RE.test(text)) return null;
  const lower = text.toLowerCase();
  const negated = NEGATION_RE.test(lower) || /must not|cannot/i.test(text);
  let kind = "should";
  if (/\bmust not\b|\bmust-not\b|\bcannot\b|\bnever\b/i.test(text)) kind = "must-not";
  else if (/\bmust\b|\brequires\b/i.test(text)) kind = "must";
  return {
    id: `${claimId}_c`,
    statement: text,
    kind,
    negated,
    satisfied: false,         // optimistic; later passes flip true on evidence
    evidence: [],
  };
}

/**
 * Pairwise contradiction scan within the claim list. Detects direct
 * negations of the same predicate ("X is hot" vs "X is not hot" /
 * "X is cold"). Cheap surface heuristic — HLR will catch deeper ones.
 */
function pairwiseContradictions(claims) {
  const conflicts = [];
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i].text.toLowerCase();
      const b = claims[j].text.toLowerCase();
      if (!a || !b) continue;
      // direct negation: same content, one negated
      const aNeg = NEGATION_RE.test(a);
      const bNeg = NEGATION_RE.test(b);
      if (aNeg !== bNeg) {
        const aBare = a.replace(NEGATION_RE, "").replace(/\s+/g, " ").trim();
        const bBare = b.replace(NEGATION_RE, "").replace(/\s+/g, " ").trim();
        if (aBare && bBare && (aBare === bBare || (aBare.length > 8 && bBare.includes(aBare)) || (bBare.length > 8 && aBare.includes(bBare)))) {
          conflicts.push({ a: claims[i].id, b: claims[j].id, reason: "direct_negation" });
          continue;
        }
      }
      // antonym pair (small starter table — extend at call site if needed)
      const ANTONYMS = [["hot", "cold"], ["alive", "dead"], ["public", "private"], ["citable", "not citable"]];
      for (const [w1, w2] of ANTONYMS) {
        if (a.includes(w1) && b.includes(w2)) {
          // same subject implied? cheap proxy: shared head-token
          const aHead = a.split(/\s+/)[0];
          const bHead = b.split(/\s+/)[0];
          if (aHead && aHead === bHead) {
            conflicts.push({ a: claims[i].id, b: claims[j].id, reason: `antonym:${w1}/${w2}` });
          }
        }
      }
    }
  }
  return conflicts;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Build an understanding model from a subject. Honors the DTU template:
 * machine-layer claims dominate; core fallback; human as last resort.
 *
 * @param {object} input
 * @param {string} [input.subjectId]   - DTU id when known
 * @param {string} [input.subjectKind] - one of SUBJECT_KINDS
 * @param {object} [input.dtu]         - inline DTU (mainly for tests)
 * @param {object[]} [input.relatedDtus] - related DTUs to fold into HLM
 * @param {string[]|object[]} [input.claims] - raw claim list when no DTU
 * @param {string} [input.question]    - optional reasoning prompt for HLR
 * @returns {object} Understanding artifact
 */
export function parseUnderstanding(input = {}) {
  const subjectKind = input.subjectKind || (input.dtu ? "dtu" : input.claims ? "claims" : "raw");
  const undId = uid();
  const composedAt = nowISO();

  // Step 1: Gather raw claims from DTU.machine / core / human, OR from raw input.
  const claims = [];
  let claimSeq = 0;
  const addClaim = (c) => {
    const id = `cl_${claimSeq++}`;
    claims.push({ id, ...c });
  };
  if (input.dtu) {
    for (const c of dtuClaims(input.dtu)) addClaim(c);
  }
  if (Array.isArray(input.relatedDtus)) {
    for (const d of input.relatedDtus) {
      for (const c of dtuClaims(d)) addClaim({ ...c, fromDtu: d.id || null });
    }
  }
  if (input.claims) {
    for (const c of liftClaims(input.claims)) addClaim(c);
  }

  // Step 2: Extract entities, relations, constraints from claim text.
  const entitySet = new Set();
  const constraints = [];
  const relations = [];
  for (const c of claims) {
    detectEntities(c.text).forEach((e) => entitySet.add(e));
    const constr = detectConstraint(c.text, c.id);
    if (constr) constraints.push(constr);
    // simple subject→object relation: "<E1> verbs <E2>"
    const m = c.text.match(/^([A-Z][a-zA-Z0-9_-]+)\s+([a-z]+(?:s|ed|ing)?)\s+([A-Z][a-zA-Z0-9_-]+)/);
    if (m) {
      relations.push({ from: m[1], to: m[3], kind: m[2], claimId: c.id });
      entitySet.add(m[1]);
      entitySet.add(m[3]);
    }
  }
  const entities = [...entitySet].map((label) => ({ id: label, label }));

  // Step 3: Run HLM over the input + related DTUs to surface
  // machine-language topology. Best-effort — HLM tolerates empty input.
  const allDtus = [];
  if (input.dtu) allDtus.push(input.dtu);
  if (Array.isArray(input.relatedDtus)) allDtus.push(...input.relatedDtus);
  let hlm = null;
  try {
    if (allDtus.length > 0) hlm = runHLMPass(allDtus);
  } catch (e) {
    hlm = { ok: false, error: e?.message || "hlm_threw" };
  }

  // Step 4: Run HLR for constraint-check reasoning over the synthesized topic.
  // We hand HLR the question (or a synthesized topic from claims) plus
  // the related DTUs so its reasoning chains have substrate to reach into.
  const topic = input.question || (claims[0]?.text || "Understand the subject");
  let hlr = null;
  try {
    hlr = runHLR({
      topic,
      mode: REASONING_MODES.CONSTRAINT_CHECK || "constraint_check",
      depth: 2,
      relatedDTUs: allDtus,
    });
  } catch (e) {
    hlr = { ok: false, error: e?.message || "hlr_threw" };
  }

  // Step 5: Contradictions = pairwise scan + any HLR-flagged conflicts.
  const contradictions = pairwiseContradictions(claims);
  if (hlr?.findings && Array.isArray(hlr.findings)) {
    for (const f of hlr.findings) {
      if (f && (f.kind === "contradiction" || f.severity === "high")) {
        contradictions.push({
          a: f.a || null,
          b: f.b || null,
          reason: `hlr:${f.kind || f.type || "finding"}`,
        });
      }
    }
  }

  // Step 6: Gaps = stated constraints whose satisfaction we can't verify
  // from the claim list. (A claim asserting the constraint's body counts
  // as satisfaction; absence counts as a gap.)
  const gaps = [];
  for (const c of constraints) {
    const body = c.statement.toLowerCase().replace(CONSTRAINT_RE, "").replace(/\s+/g, " ").trim();
    const sourceClaimId = c.id.replace(/_c$/, "");
    const satisfied = claims.some((cl) => {
      if (cl.id === sourceClaimId) return false;          // the constraint claim itself doesn't count as evidence
      const norm = cl.text.toLowerCase().replace(/\s+/g, " ").trim();
      return body.length > 0 && norm.includes(body);
    });
    c.satisfied = satisfied;
    if (!satisfied) gaps.push({ constraintId: c.id, why: "no_supporting_claim" });
  }
  if (hlm && Array.isArray(hlm.gaps?.gaps)) {
    for (const g of hlm.gaps.gaps) {
      gaps.push({ constraintId: `hlm:${g.id || g.cluster || "gap"}`, why: g.reason || "hlm_topology_gap" });
    }
  }

  // Step 7: Predictions = HLR-implied conclusions (when HLR returned chains).
  const predictions = [];
  if (hlr?.chains && Array.isArray(hlr.chains)) {
    for (const chain of hlr.chains.slice(0, 5)) {
      const concl = chain.conclusion || chain.output || null;
      if (concl) {
        predictions.push({
          claim: typeof concl === "string" ? concl : (concl.text || JSON.stringify(concl).slice(0, 200)),
          confidence: typeof chain.confidence === "number" ? chain.confidence : 0.5,
          basis: Array.isArray(chain.basis) ? chain.basis : [],
        });
      }
    }
  }

  // Step 8: Consistency aggregate.
  let consistency = "consistent";
  if (contradictions.length > 0) consistency = "inconsistent";
  else if (gaps.length > 0) consistency = "partial";
  else if (claims.length === 0) consistency = "unknown";

  // Step 9: Confidence — coverage / contradiction count blend.
  const claimAvgConf = claims.length === 0
    ? 0.0
    : claims.reduce((s, c) => s + (typeof c.confidence === "number" ? c.confidence : 0.5), 0) / claims.length;
  const contradictionPenalty = Math.min(0.4, 0.1 * contradictions.length);
  const gapPenalty = Math.min(0.2, 0.05 * gaps.length);
  const confidence = Math.max(0, Math.min(1, claimAvgConf - contradictionPenalty - gapPenalty));

  return {
    id: undId,
    subjectId: input.subjectId ?? null,
    subjectKind,
    composedAt,
    composer: COMPOSER_DETERMINISTIC,
    // The model
    entities,
    claims,
    relations,
    constraints,
    // Outputs
    consistency,
    contradictions,
    gaps,
    predictions,
    confidence: Number(confidence.toFixed(3)),
    // Trace links
    hlmPassId: hlm?.passId ?? null,
    hlrTraceId: hlr?.traceId ?? null,
    reasoningTrace: {
      hlm: hlm ? { ok: hlm.ok ?? true, summary: hlm.summary || null } : null,
      hlr: hlr ? { ok: hlr.ok ?? true, mode: hlr.input?.mode || null } : null,
      contradictionScan: { method: "pairwise+hlr", count: contradictions.length },
    },
  };
}

/**
 * Persist an understanding artifact. Caller passes the parsed object;
 * this does the single-tx insert into the `understandings` table.
 */
export function saveUnderstanding(db, understanding, { ttlDays } = {}) {
  if (!db || !understanding) return { ok: false, error: "missing_db_or_understanding" };
  const u = understanding;
  try {
    db.prepare(`
      INSERT INTO understandings (
        id, subject_id, subject_kind,
        model_json, consistency, contradictions_json, gaps_json, predictions_json,
        confidence, composer, composed_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      u.id,
      u.subjectId,
      u.subjectKind,
      safeJSON({
        entities: u.entities,
        claims: u.claims,
        relations: u.relations,
        constraints: u.constraints,
        reasoningTrace: u.reasoningTrace,
        hlmPassId: u.hlmPassId,
        hlrTraceId: u.hlrTraceId,
      }, {}),
      u.consistency,
      safeJSON(u.contradictions, []),
      safeJSON(u.gaps, []),
      safeJSON(u.predictions, []),
      u.confidence,
      u.composer || COMPOSER_DETERMINISTIC,
      u.composedAt || nowISO(),
      expiryISO(ttlDays || DEFAULT_TTL_DAYS),
    );
    return { ok: true, id: u.id };
  } catch (e) {
    return { ok: false, error: e?.message || "save_failed" };
  }
}

/**
 * Load an understanding by id (re-hydrates the model from JSON columns).
 */
export function getUnderstanding(db, id) {
  if (!db || !id) return null;
  try {
    const row = db.prepare(`SELECT * FROM understandings WHERE id = ?`).get(id);
    if (!row) return null;
    const model = parseJSON(row.model_json, {});
    return {
      id: row.id,
      subjectId: row.subject_id,
      subjectKind: row.subject_kind,
      composedAt: row.composed_at,
      recomposedAt: row.recomposed_at,
      composer: row.composer,
      consistency: row.consistency,
      confidence: row.confidence,
      entities: model.entities || [],
      claims: model.claims || [],
      relations: model.relations || [],
      constraints: model.constraints || [],
      contradictions: parseJSON(row.contradictions_json, []),
      gaps: parseJSON(row.gaps_json, []),
      predictions: parseJSON(row.predictions_json, []),
      reasoningTrace: model.reasoningTrace || null,
      hlmPassId: model.hlmPassId || null,
      hlrTraceId: model.hlrTraceId || null,
      expiresAt: row.expires_at,
    };
  } catch { return null; }
}

/**
 * List understandings for a subject (most recent first).
 */
export function listUnderstandings(db, { subjectId, subjectKind, limit = 20 } = {}) {
  if (!db) return [];
  try {
    if (subjectId && subjectKind) {
      return db.prepare(`
        SELECT id, subject_id, subject_kind, consistency, confidence, composed_at
        FROM understandings
        WHERE subject_id = ? AND subject_kind = ?
        ORDER BY composed_at DESC
        LIMIT ?
      `).all(subjectId, subjectKind, limit);
    }
    if (subjectKind) {
      return db.prepare(`
        SELECT id, subject_id, subject_kind, consistency, confidence, composed_at
        FROM understandings
        WHERE subject_kind = ?
        ORDER BY composed_at DESC
        LIMIT ?
      `).all(subjectKind, limit);
    }
    return db.prepare(`
      SELECT id, subject_id, subject_kind, consistency, confidence, composed_at
      FROM understandings
      ORDER BY composed_at DESC
      LIMIT ?
    `).all(limit);
  } catch { return []; }
}

/**
 * Re-run an existing understanding's pipeline against the current
 * subject (DTU). Useful after the underlying DTU has been edited.
 */
export function recomposeUnderstanding(db, id, opts = {}) {
  const prior = getUnderstanding(db, id);
  if (!prior) return { ok: false, error: "not_found" };
  const fresh = parseUnderstanding({
    subjectId: prior.subjectId,
    subjectKind: prior.subjectKind,
    ...opts,
  });
  // Persist as a new row + back-link via a recomposed_at flag on prior.
  const saved = saveUnderstanding(db, fresh, opts);
  if (saved.ok) {
    try {
      db.prepare(`UPDATE understandings SET recomposed_at = ? WHERE id = ?`).run(nowISO(), prior.id);
    } catch { /* best-effort */ }
  }
  return saved.ok ? { ok: true, id: fresh.id, supersedes: prior.id } : saved;
}

/**
 * Sweep expired understandings. Called from a heartbeat (one-line wire).
 */
export function sweepExpiredUnderstandings(db) {
  if (!db) return { ok: false, error: "no_db" };
  try {
    const r = db.prepare(`DELETE FROM understandings WHERE expires_at < ?`).run(nowISO());
    return { ok: true, deleted: r.changes };
  } catch (e) {
    return { ok: false, error: e?.message || "sweep_failed" };
  }
}

/**
 * Single-call convenience: parse → save → return both.
 */
export function composeAndSave(db, input = {}, opts = {}) {
  const u = parseUnderstanding(input);
  const saved = db ? saveUnderstanding(db, u, opts) : { ok: true, id: u.id, skippedSave: true };
  return { ok: saved.ok, understanding: u, error: saved.error };
}
