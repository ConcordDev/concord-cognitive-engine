// server/lib/reason-verify.js
//
// LLM-as-judge verification with a DETERMINISTIC anti-hallucination floor.
//
// A trustworthy assistant must be able to answer "is this claim actually backed
// by what it cites?" Two layers:
//
//   1. Citation-resolution floor (deterministic, no brains): does every cited
//      DTU id actually EXIST and is it VISIBLE to the requester? A citation that
//      resolves to nothing is a fabricated citation — the clearest hallucination
//      signal there is, and we catch it without an LLM. Works offline; tested.
//
//   2. Council judge (brains): when the brains are up, the multi-brain council
//      (lib/agentic/council.js#councilDecision — self-scaling: confident → one
//      pass, uncertain → parallel explorations + critic synthesis) reads the
//      cited DTUs' content and rules SUPPORTED / UNSUPPORTED. Gracefully degrades
//      to the deterministic verdict when brains are offline — never fabricates a
//      "verified" stamp.
//
// verdicts:
//   fabricated_citation — cited a DTU that doesn't exist / isn't visible
//   unsupported         — citations resolve, but the council says they don't back the claim
//   grounded            — citations resolve AND the council says they support the claim
//   citations_resolve   — citations resolve; support not judged (brains offline)
//   unverified          — nothing cited to check against

import logger from "../logger.js";

function resolveCitations(db, citationIds, requesterId) {
  const resolved = [];
  const unresolved = [];
  // Prepare once, reuse per id — avoids an N+1 statement-compile on every cite.
  let stmt = null;
  try { stmt = db.prepare("SELECT id, creator_id, title, data FROM dtus WHERE id = ?"); } catch { stmt = null; }
  for (const raw of citationIds) {
    const id = String(raw);
    let row = null;
    try {
      row = stmt ? stmt.get(id) : null;
    } catch { row = null; }
    if (!row) { unresolved.push(id); continue; }
    // Personal-scoped DTUs are only "resolvable" for their owner — citing one you
    // can't see is, for verification purposes, an unresolved (inaccessible) cite.
    const personal = typeof row.data === "string" && row.data.includes('"scope":"personal"');
    const visible = !personal || (requesterId && row.creator_id === requesterId);
    if (visible) resolved.push({ id: row.id, title: row.title });
    else unresolved.push(id);
  }
  return { resolved, unresolved };
}

/**
 * @param {object} db
 * @param {{ claim?: string, citationIds?: string[], requesterId?: string|null,
 *           useCouncil?: boolean, useProof?: boolean,
 *           proofBrainFn?: Function, proofZ3Runner?: Function }} opts
 * @returns {Promise<object>} verification verdict
 */
export async function verifyClaim(db, { claim, citationIds = [], requesterId = null, useCouncil = true, useProof = true, proofBrainFn = null, proofZ3Runner = null } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const ids = (Array.isArray(citationIds) ? citationIds : []).map(String).filter(Boolean);
  const claimText = String(claim || "").trim();

  const { resolved, unresolved } = resolveCitations(db, ids, requesterId);
  const citationsTotal = ids.length;
  const allResolved = citationsTotal > 0 && unresolved.length === 0;

  // Deterministic verdict floor.
  let verdict;
  let supported = null;
  let confidence = null;
  let mode = "deterministic";
  let council = null;

  if (citationsTotal === 0) verdict = "unverified";
  else if (unresolved.length > 0) verdict = "fabricated_citation";
  else verdict = "citations_resolve";

  // Council (LLM) semantic layer — only worth running when the citations are real
  // and there's a claim to judge. Never blocks; offline → keep the floor verdict.
  if (useCouncil && claimText && allResolved) {
    try {
      const { councilDecision } = await import("./agentic/council.js");
      const excerpts = resolved.map((r, i) => {
        let body = r.title || "";
        try {
          const full = db.prepare("SELECT title, data FROM dtus WHERE id = ?").get(r.id);
          body = `${full?.title || r.title || ""} ${String(full?.data || "").slice(0, 600)}`;
        } catch { /* keep title */ }
        return `[${i + 1}] ${body}`;
      }).join("\n");
      const question =
        `Sources:\n${excerpts}\n\n` +
        `Is the following claim SUPPORTED by the sources above? ` +
        `Answer strictly with "SUPPORTED" or "UNSUPPORTED", then one short reason.\n` +
        `Claim: "${claimText}"`;
      const decision = await councilDecision({ question, db, brainRole: "subconscious" });
      council = decision?.decision || null;
      const text = String(council || "").toLowerCase();
      if (/\bunsupported\b/.test(text)) { supported = false; verdict = "unsupported"; }
      else if (/\bsupported\b/.test(text)) { supported = true; verdict = "grounded"; }
      confidence = typeof decision?.confidence === "number" ? decision.confidence : null;
      mode = "council";
    } catch (e) {
      try { logger.debug?.("reason-verify", "council_unavailable", { error: e?.message }); } catch { /* ignore */ }
    }
  }

  // Formal-proof gate (sound layer) — orthogonal to citation grounding: it answers
  // "is this claim mathematically VALID?" not "do its sources back it?". Only fires
  // for proof-amenable claims (cheap deterministic heuristic) and only when Z3 is
  // installed; otherwise it's a no-op that leaves the verdict above untouched. A
  // sound `proven`/`refuted` result is stronger than the semantic council, so it
  // upgrades the top-level verdict; everything else is additive-only.
  let proof = null;
  if (useProof && claimText) {
    try {
      const { proveClaim, classifyAmenable } = await import("./proof-gate.js");
      // Skip the brain-wiring cost entirely when the claim isn't proof-amenable.
      if (classifyAmenable(claimText).amenable) {
        // Default formaliser = the subconscious brain (the autonomous slot), via the
        // BYO-aware brainChat router. Injectable for offline tests.
        let brainFn = proofBrainFn;
        if (!brainFn) {
          try {
            const { brainChat } = await import("./byo-router.js");
            brainFn = async (messages) => {
              const r = await brainChat({ db, userId: requesterId, slot: "subconscious", messages });
              return { text: r?.text || "" };
            };
          } catch { brainFn = null; }
        }
        proof = await proveClaim({ claim: claimText, brainFn, z3Runner: proofZ3Runner });
        if (proof?.verdict === "proven") { supported = true; verdict = "proven"; mode = "proof"; confidence = 1; }
        else if (proof?.verdict === "refuted") { supported = false; verdict = "refuted"; mode = "proof"; confidence = 1; }
        // A sound verdict is durable knowledge — mint it as a citable proven_claim
        // DTU (idempotent on the claim). Best-effort; never affects the verdict.
        if (proof?.verdict === "proven" || proof?.verdict === "refuted") {
          try {
            const { persistProvenClaim } = await import("./proof-gate.js");
            const p = persistProvenClaim(db, { claim: claimText, verdict: proof.verdict, smt: proof.smt, creatorId: requesterId });
            if (p?.ok) proof.dtuId = p.dtuId;
          } catch { /* persistence best-effort */ }
        }
      }
    } catch (e) {
      try { logger.debug?.("reason-verify", "proof_gate_unavailable", { error: e?.message }); } catch { /* ignore */ }
    }
  }

  return {
    ok: true,
    claim: claimText || null,
    citationsTotal,
    citationsResolved: resolved.length,
    allResolved,
    unresolvedIds: unresolved,
    supported,
    confidence,
    mode,
    verdict,
    council,
    proof,
  };
}

export default { verifyClaim };
