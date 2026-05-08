// server/lib/understanding-consumers.js
//
// Consumer-side helpers for the Understanding Engine. Each function is
// the thin call-site shim a specific lens / pipeline calls — keeping
// the engine itself agnostic and centralising the "how does this lens
// use understanding?" decision in one auditable place.
//
// Wiring map (where each helper is called from):
//   noteCitationAsEvidence  → server/economy/royalty-cascade.js
//                              registerCitation success path
//   composeForChatTurn      → chat send pipeline (per-turn evidence)
//   verifyAgainstConstraints → forge.generate / council vote-prep
//   composeForCognition     → cognition macro unifier
//
// All functions are best-effort: they NEVER throw to the caller, and
// they NEVER block the primary pipeline. Failures degrade silently and
// log; the citation / chat / forge / vote / cognition flow continues
// regardless. This is the same robustness contract as the heartbeat
// modules — additive only, silent-failure.

import {
  parseUnderstanding,
  saveUnderstanding,
  composeAndSave,
  getUnderstanding,
} from "./understanding-engine.js";
import { recordEvidence } from "./understanding-evolve.js";

function safeLog(level, label, payload = {}) {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, label, ...payload });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
  } catch { /* swallow */ }
}

// ── DTU citation → confirm evidence ─────────────────────────────────────────

/**
 * When a citation A → B is registered, that's a "this parent's claims
 * proved useful" signal. We mirror that into the Understanding loop:
 * every active (candidate / promoted) understanding whose subject_id
 * is the cited parent gets a confirm-evidence beat.
 *
 * Idempotent on `lineageId` — replaying the same citation event won't
 * double-count.
 *
 * @param {object} db
 * @param {object} cite
 * @param {string} cite.parentId   - DTU being cited
 * @param {string} cite.childId    - DTU doing the citing
 * @param {string} [cite.lineageId] - the royalty_lineage row id (idempotency key)
 * @returns {object} { ok, evidenced } — counts of understandings beaten
 */
export function noteCitationAsEvidence(db, { parentId, childId, lineageId } = {}) {
  if (!db || !parentId) return { ok: false, error: "invalid_args" };
  try {
    // Find live understandings of the parent. Skip disputed/archived —
    // those have already exited the loop, additional citations on them
    // are noise, not evidence.
    const rows = db.prepare(`
      SELECT id FROM understandings
      WHERE subject_id = ?
        AND status IN ('candidate', 'promoted')
        AND consolidated_into_id IS NULL
      LIMIT 50
    `).all(parentId);

    if (rows.length === 0) return { ok: true, evidenced: 0 };

    let count = 0;
    for (const row of rows) {
      const r = recordEvidence(db, {
        understandingId: row.id,
        kind: "confirm",
        evidenceRefId: lineageId ? `lineage:${lineageId}:${row.id}` : null,
        payload: { source: "citation", childId, parentId, lineageId },
      });
      if (r.ok && !r.idempotent) count++;
    }
    return { ok: true, evidenced: count };
  } catch (e) {
    safeLog("warn", "understanding_citation_hook_failed", { error: e?.message, parentId });
    return { ok: false, error: e?.message || "citation_hook_failed" };
  }
}

// ── Chat turn → compose + recompose ─────────────────────────────────────────

/**
 * A chat turn comes in. If this is the first substantive turn in the
 * thread, compose an understanding from the user's prompt + the model's
 * reply (subjectKind='raw', subjectId=threadId). On subsequent turns,
 * recordEvidence on the existing thread understanding — confirm if the
 * turn extends/agrees, contradict if the user explicitly rejects.
 *
 * Caller passes a verdict: 'compose' (first turn or new topic),
 * 'confirm' (turn extends), 'contradict' (turn rejects). The caller
 * decides verdict; this helper only persists.
 *
 * Returns the live understanding id so the chat lens can surface it
 * (e.g. "this conversation has 3 unresolved gaps").
 */
export function composeForChatTurn(db, {
  threadId,
  userMessage,
  assistantReply,
  verdict = "compose",
  composerUserId,
  evidenceRefId,
} = {}) {
  if (!db || !threadId) return { ok: false, error: "invalid_args" };

  try {
    if (verdict === "compose") {
      // First turn or topic-shift — fresh understanding.
      const claims = [];
      if (userMessage) claims.push({ text: String(userMessage).slice(0, 500), confidence: 0.6 });
      if (assistantReply) claims.push({ text: String(assistantReply).slice(0, 500), confidence: 0.7 });
      if (claims.length === 0) return { ok: true, skipped: "no_text" };

      const u = parseUnderstanding({ subjectId: threadId, subjectKind: "raw", claims });
      const saved = saveUnderstanding(db, u);
      if (!saved.ok) return saved;
      if (composerUserId) {
        try { db.prepare(`UPDATE understandings SET composer_user_id = ? WHERE id = ?`).run(composerUserId, u.id); }
        catch { /* tolerate */ }
      }
      return { ok: true, understandingId: u.id, action: "composed" };
    }

    if (verdict === "confirm" || verdict === "contradict") {
      // Find the most-recent live understanding for this thread.
      const row = db.prepare(`
        SELECT id FROM understandings
        WHERE subject_id = ? AND subject_kind = 'raw'
          AND status IN ('candidate', 'promoted')
          AND consolidated_into_id IS NULL
        ORDER BY composed_at DESC LIMIT 1
      `).get(threadId);
      if (!row) {
        // No prior thread understanding — fall back to compose.
        return composeForChatTurn(db, { threadId, userMessage, assistantReply, verdict: "compose", composerUserId });
      }
      const r = recordEvidence(db, {
        understandingId: row.id,
        kind: verdict,
        evidenceRefId: evidenceRefId || null,
        payload: { source: "chat_turn", userMessage: userMessage?.slice?.(0, 200) },
      });
      return r.ok ? { ok: true, understandingId: row.id, action: verdict } : r;
    }

    return { ok: false, error: "unknown_verdict" };
  } catch (e) {
    safeLog("warn", "understanding_chat_hook_failed", { error: e?.message, threadId });
    return { ok: false, error: e?.message || "chat_hook_failed" };
  }
}

// ── Constraint verification (forge / council / generic) ────────────────────

/**
 * Compose an understanding of `input` and return whether all stated
 * constraints are satisfied. Used by:
 *   - forge.generate — block publish if a recipe's constraints are
 *     unmet (e.g. "must include signature", "cannot exceed cap")
 *   - council vote-prep — surface gaps/contradictions to voters BEFORE
 *     the ballot opens
 *   - any lens that wants the gate "do the inputs cohere?"
 *
 * Does NOT save the understanding by default — caller passes
 * `{ persist: true }` if they want the artifact retained for audit.
 * (Keeps the verify path cheap when used as a gate.)
 *
 * @returns { ok, satisfied, blockers, understanding }
 *   - satisfied: true if zero unsatisfied constraints + zero contradictions
 *   - blockers: array of { kind, detail } for the failing items
 */
export function verifyAgainstConstraints(db, input = {}, opts = {}) {
  try {
    const u = parseUnderstanding(input);
    const blockers = [];
    for (const c of u.constraints || []) {
      if (!c.satisfied) blockers.push({ kind: "unsatisfied_constraint", detail: c });
    }
    for (const conf of u.contradictions || []) {
      blockers.push({ kind: "contradiction", detail: conf });
    }
    const satisfied = blockers.length === 0;
    if (db && opts.persist) {
      try { saveUnderstanding(db, u); } catch { /* tolerate */ }
    }
    return { ok: true, satisfied, blockers, understanding: u };
  } catch (e) {
    safeLog("warn", "understanding_verify_failed", { error: e?.message });
    return { ok: false, error: e?.message || "verify_failed" };
  }
}

// ── Cognition macro unifier ────────────────────────────────────────────────

/**
 * Cognition is the lens that already dispatches to hlr/hlm/breakthrough/
 * forgetting/drift. Adding a `cognition.understand(input)` macro that
 * funnels through composeAndSave gives every cognition consumer a
 * single entry point that materialises the typed Understanding —
 * without the consumer having to know about the five engines.
 *
 * Same shape as `understanding.compose` but wraps the call so the
 * cognition macro file stays a thin dispatcher.
 */
export function composeForCognition(db, input = {}) {
  try {
    return composeAndSave(db, input);
  } catch (e) {
    safeLog("warn", "understanding_cognition_unifier_failed", { error: e?.message });
    return { ok: false, error: e?.message || "cognition_unifier_failed" };
  }
}

// ── Lookup helpers used by lenses to surface state ─────────────────────────

/**
 * "How is the model thinking about this subject right now?" — returns
 * the most-recent live understanding for a subject. Used by chat /
 * council / forge surfaces to show the user what the substrate
 * believes about X without rerunning the pipeline.
 */
export function liveUnderstandingForSubject(db, { subjectId, subjectKind } = {}) {
  if (!db || !subjectId) return null;
  try {
    const row = db.prepare(`
      SELECT id FROM understandings
      WHERE subject_id = ?
        ${subjectKind ? "AND subject_kind = ?" : ""}
        AND status IN ('candidate', 'promoted')
        AND consolidated_into_id IS NULL
      ORDER BY composed_at DESC LIMIT 1
    `).get(...(subjectKind ? [subjectId, subjectKind] : [subjectId]));
    return row ? getUnderstanding(db, row.id) : null;
  } catch { return null; }
}
