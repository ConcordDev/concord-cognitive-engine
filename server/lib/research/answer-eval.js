// server/lib/research/answer-eval.js
//
// RAGAS-shaped answer evaluation — the research-grounding gap #1 harness
// (docs/NEXT_ARC_PLAN.md / V1.1 R3 "Research/answer competitiveness"):
// atomic-claim decomposition -> NLI-style entailment vs retrieved context ->
// Faithfulness / Answer-Relevancy / Context-Precision, plus a citation-
// attribution penalty folded in from the EXISTING `reason.verify` machinery
// (server/lib/reason-verify.js) rather than re-implemented here.
//
// Honest-by-construction (CLAUDE.md "How we work here" #3), same shape as
// reason-verify.js: every scoring function has a DETERMINISTIC floor that
// works with zero brains reachable, and an opt-in LLM-enhanced path that
// degrades to the deterministic floor on any failure/timeout — never a
// fabricated verdict. Nothing here duplicates reason-verify.js's citation
// resolution / council-judge logic; `evaluateAnswer` imports and calls
// `verifyClaim` directly for the citation-attribution axis.
//
// Three axes, RAGAS-standard:
//   - decomposeIntoClaims   -> atomic factual claims from an answer
//   - scoreEntailment       -> per-claim entailed | neutral | contradicted
//                              vs the retrieved context
//   - computeFaithfulness   -> aggregate: fraction entailed (RAGAS
//                              convention: >0.9 = "grounded"), plus
//                              answerRelevancy + contextPrecision
//   - evaluateAnswer        -> orchestrates all of the above + folds in
//                              reason-verify.js's citation floor for a
//                              single, non-double-counted verdict
//   - toCapabilityVerdict   -> adapter to the exact shape
//                              concord-frontend/components/common/
//                              CapabilityBadge.tsx's `CapabilityVerdict`
//                              expects, so this harness's output can drive
//                              that badge without CapabilityBadge growing
//                              new verdict strings.

import logger from "../../logger.js";
import { verifyClaim } from "../reason-verify.js";

// ── Shared small heuristics (deliberately NOT reused from grounding.js —
// that file's helpers are shaped for a single caller-supplied compound claim
// + hand-typed evidence list; this module decomposes a full multi-sentence
// ANSWER and scores it against DTU-shaped retrieved context. Similar spirit,
// different input shape, so a fresh compact implementation here is honest
// rather than a forced/fragile reuse.) ──────────────────────────────────────

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being", "have",
  "has", "had", "do", "does", "did", "will", "would", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "and", "but", "or", "not", "so",
  "if", "that", "this", "it", "its", "i", "we", "you", "they", "he", "she",
  "what", "which", "who", "how", "where", "why", "there", "their",
]);

const NEGATION_WORDS = new Set([
  "not", "no", "never", "neither", "nobody", "nothing", "nowhere", "nor",
  "cannot", "isn't", "aren't", "wasn't", "weren't", "doesn't", "don't",
  "didn't", "won't", "can't", "hasn't", "haven't", "hadn't",
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

function hasNegation(text) {
  const words = String(text || "").toLowerCase().split(/\s+/);
  return words.some((w) => NEGATION_WORDS.has(w) || w.endsWith("n't"));
}

/** Jaccard-ish overlap: fraction of A's significant tokens that appear in B. */
function overlapScore(a, b) {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0) return 0;
  let hits = 0;
  for (const t of tokensA) { if (tokensB.has(t)) hits++; }
  return hits / tokensA.size;
}

// ── 1. Atomic-claim decomposition ───────────────────────────────────────────

function splitSentences(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Pragmatic compound-clause split: breaks a sentence on conjunctions that
// typically join two independently-checkable assertions. Deliberately
// conservative (only splits on ", and"/", but"/"; "/leading connective
// adverbs) to avoid shredding a single claim mid-clause.
function splitClauses(sentence) {
  const parts = String(sentence || "")
    .split(/(?:,\s+(?:and|but)\s+|;\s*|\s+(?:however|moreover|furthermore|additionally|also)\s+,?\s*)/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [sentence];
}

function deterministicDecompose(answerText) {
  const text = String(answerText || "").trim();
  if (!text) return [];
  const claims = [];
  for (const sentence of splitSentences(text)) {
    for (const clause of splitClauses(sentence)) {
      const trimmed = clause.replace(/[,;]\s*$/, "").trim();
      if (trimmed.length >= 3) claims.push(trimmed);
    }
  }
  return claims.length > 0 ? claims : [text];
}

// Opt-in LLM decomposer — same client + honest-timeout-fallback shape as
// reason-verify.js's council/proof paths (byo-router's brainChat, subconscious
// slot, dynamic import so a missing/offline brain never breaks the deterministic
// caller). Returns null (never throws) on any failure, timeout, or unparsable
// response — the caller falls back to the deterministic splitter.
async function llmDecompose(answerText, { db, requesterId, timeoutMs = 8000 } = {}) {
  try {
    const { brainChat } = await import("../byo-router.js");
    const prompt =
      `Break the following answer into a JSON array of short, atomic, ` +
      `independently-checkable factual claims (one fact per string, no ` +
      `commentary, no markdown). Respond with ONLY a JSON array of strings.\n\n` +
      `Answer:\n"""${String(answerText || "").slice(0, 4000)}"""`;
    const call = brainChat({ db, userId: requesterId, slot: "subconscious", messages: [{ role: "user", content: prompt }] });
    // Braced so the executor does not RETURN setTimeout's handle
    // (no-promise-executor-return): the return value is meaningless to the
    // promise and reading it is a common source of confusion.
    const timeout = new Promise((resolve) => { setTimeout(() => resolve(null), timeoutMs); });
    const result = await Promise.race([call, timeout]);
    if (!result) return null; // honest timeout — never fabricate a decomposition
    const text = String(result?.text || "");
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return null;
    const claims = parsed.map((c) => String(c || "").trim()).filter(Boolean);
    return claims.length > 0 ? claims : null;
  } catch (e) {
    try { logger.debug?.("answer-eval", "llm_decompose_unavailable", { error: e?.message }); } catch { /* decoration only */ }
    return null;
  }
}

/**
 * Split an answer into atomic factual claims.
 * @param {string} answerText
 * @param {{ useLLM?: boolean, db?: object, requesterId?: string|null, timeoutMs?: number }} [opts]
 * @returns {Promise<string[]>|string[]} deterministic path is sync; useLLM path is async
 */
export function decomposeIntoClaims(answerText, opts = {}) {
  if (!opts.useLLM) return deterministicDecompose(answerText);
  return (async () => {
    const llmClaims = await llmDecompose(answerText, opts);
    return llmClaims || deterministicDecompose(answerText);
  })();
}

// ── 2. Entailment scoring (per claim vs retrieved context) ─────────────────

const ENTAIL_THRESHOLD = 0.45;
const NEUTRAL_FLOOR = 0.12;

function normalizeContext(retrievedContext) {
  const arr = Array.isArray(retrievedContext) ? retrievedContext : (retrievedContext ? [retrievedContext] : []);
  return arr.map((c, i) => {
    if (typeof c === "string") return { index: i, id: null, text: c };
    const text = [c?.title, c?.text, c?.content, c?.data].filter(Boolean).join(" ");
    return { index: i, id: c?.id ?? null, text: String(text || "") };
  }).filter((c) => c.text && c.text.trim().length > 0);
}

function deterministicEntailment(claim, contexts) {
  if (contexts.length === 0) {
    // Nothing to check against — the honest answer is "neutral, unverified",
    // never a fabricated "entailed".
    return { label: "neutral", method: "unverified", score: 0, matchedIndex: null };
  }
  let best = { score: -1, index: null, text: "" };
  for (const c of contexts) {
    const s = overlapScore(claim, c.text);
    if (s > best.score) best = { score: s, index: c.index, text: c.text };
  }
  if (best.score < NEUTRAL_FLOOR) {
    return { label: "neutral", method: "keyword-overlap", score: Math.round(best.score * 1000) / 1000, matchedIndex: null };
  }
  if (best.score >= ENTAIL_THRESHOLD) {
    // Polarity check: if the claim negates and the best-matching context
    // doesn't (or vice versa), treat strong overlap as a contradiction signal
    // rather than entailment — a cheap but honest negation-mismatch heuristic.
    const mismatch = hasNegation(claim) !== hasNegation(best.text);
    return {
      label: mismatch ? "contradicted" : "entailed",
      method: "keyword-overlap",
      score: Math.round(best.score * 1000) / 1000,
      matchedIndex: best.index,
    };
  }
  return { label: "neutral", method: "keyword-overlap", score: Math.round(best.score * 1000) / 1000, matchedIndex: best.index };
}

// Opt-in LLM-as-judge path — reuses the SAME council-judge pattern as
// reason-verify.js's `verifyClaim` (server/lib/reason-verify.js:85-114):
// `councilDecision` from lib/agentic/council.js, subconscious brain role.
// Degrades to the deterministic heuristic on any failure — never fabricates
// a verdict when the council is unreachable.
async function llmEntailment(claim, contexts, { db } = {}) {
  if (contexts.length === 0) return null; // nothing to judge — stay honest, let caller use the deterministic path
  try {
    const { councilDecision } = await import("../agentic/council.js");
    const excerpts = contexts.map((c) => `[${c.index + 1}] ${c.text.slice(0, 600)}`).join("\n");
    const question =
      `Sources:\n${excerpts}\n\n` +
      `Classify the following claim against the sources above as exactly one ` +
      `of ENTAILED (the sources support it), CONTRADICTED (the sources ` +
      `directly conflict with it), or NEUTRAL (the sources neither support ` +
      `nor conflict with it). Answer with the single word, then one short reason.\n` +
      `Claim: "${claim}"`;
    const decision = await councilDecision({ question, db, brainRole: "subconscious" });
    const text = String(decision?.decision || "").toLowerCase();
    let label = null;
    if (/\bcontradicted\b/.test(text)) label = "contradicted";
    else if (/\bentailed\b/.test(text)) label = "entailed";
    else if (/\bneutral\b/.test(text)) label = "neutral";
    if (!label) return null;
    return {
      label,
      method: "llm-judge",
      score: typeof decision?.confidence === "number" ? decision.confidence : null,
      matchedIndex: null,
    };
  } catch (e) {
    try { logger.debug?.("answer-eval", "llm_entailment_unavailable", { error: e?.message }); } catch { /* decoration only */ }
    return null;
  }
}

/**
 * Classify a single claim against retrieved context.
 * @param {string} claim
 * @param {Array<string|object>} retrievedContext - DTU-shaped ({id,title,data}) or plain strings
 * @param {{ useLLM?: boolean, db?: object }} [opts]
 * @returns {Promise<{ label: 'entailed'|'neutral'|'contradicted', method: string, score: number|null, matchedIndex: number|null }>}
 */
export async function scoreEntailment(claim, retrievedContext, opts = {}) {
  const contexts = normalizeContext(retrievedContext);
  if (opts.useLLM) {
    const llmResult = await llmEntailment(claim, contexts, opts);
    if (llmResult) return llmResult;
  }
  return deterministicEntailment(claim, contexts);
}

// ── 3. Aggregate metrics ────────────────────────────────────────────────────

/**
 * Aggregate per-claim entailment results into RAGAS-style Faithfulness.
 * @param {Array<{ label: 'entailed'|'neutral'|'contradicted' }>} claimResults
 * @returns {{ faithfulness: number|null, entailedCount, contradictedCount, neutralCount, total, verdict }}
 */
export function computeFaithfulness(claimResults) {
  const list = Array.isArray(claimResults) ? claimResults : [];
  const total = list.length;
  if (total === 0) {
    return { faithfulness: null, entailedCount: 0, contradictedCount: 0, neutralCount: 0, total: 0, verdict: "unverified" };
  }
  const entailedCount = list.filter((c) => c.label === "entailed").length;
  const contradictedCount = list.filter((c) => c.label === "contradicted").length;
  const neutralCount = total - entailedCount - contradictedCount;
  const faithfulness = Math.round((entailedCount / total) * 1000) / 1000;

  let verdict;
  if (contradictedCount > 0) verdict = "contradicted";
  else if (faithfulness > 0.9) verdict = "grounded"; // RAGAS convention cited in research grounding
  else if (faithfulness > 0.5) verdict = "partially_grounded";
  else verdict = "unverified"; // low support isn't necessarily WRONG — just nothing to hang confidence on

  return { faithfulness, entailedCount, contradictedCount, neutralCount, total, verdict };
}

/**
 * Answer-Relevancy: does the answer actually address the question?
 * Deterministic floor: keyword-overlap heuristic (honest, weak signal).
 */
export function computeAnswerRelevancy(question, answerText) {
  const q = String(question || "").trim();
  const a = String(answerText || "").trim();
  if (!q || !a) return { score: null, method: "unverified" };
  const score = Math.round(overlapScore(q, a) * 1000) / 1000;
  return { score, method: "keyword-overlap" };
}

/**
 * Context-Precision: fraction of the retrieved context chunks that were
 * actually USED by an entailed claim (i.e. genuinely informed the grounded
 * part of the answer), vs. retrieved-but-unused chunks (noise in the
 * retrieval step, not the answer's fault).
 */
export function computeContextPrecision(claimResults, retrievedContext) {
  const contexts = normalizeContext(retrievedContext);
  if (contexts.length === 0) return { score: null, usedCount: 0, totalCount: 0 };
  const used = new Set(
    (Array.isArray(claimResults) ? claimResults : [])
      .filter((c) => c.label === "entailed" && c.matchedIndex != null)
      .map((c) => c.matchedIndex)
  );
  const score = Math.round((used.size / contexts.length) * 1000) / 1000;
  return { score, usedCount: used.size, totalCount: contexts.length };
}

// ── 4. Orchestration ────────────────────────────────────────────────────────

/**
 * Full RAGAS-shaped evaluation of an answer against retrieved DTU context,
 * folding in reason-verify.js's citation-resolution floor for the
 * citation-attribution axis (NOT re-implemented here).
 *
 * @param {string} answerText
 * @param {string} question
 * @param {Array<string|object>} retrievedDtus - DTU-shaped ({id,title,data}) or plain strings
 * @param {{ db?: object, requesterId?: string|null, citationIds?: Array,
 *           useLLMDecompose?: boolean, useLLMEntailment?: boolean,
 *           useCitationCouncil?: boolean }} [opts]
 * @returns {Promise<object>} evaluation result (see fields below)
 */
export async function evaluateAnswer(answerText, question, retrievedDtus = [], opts = {}) {
  const text = String(answerText || "").trim();
  if (!text) return { ok: false, reason: "no_answer" };

  const claimTexts = await decomposeIntoClaims(text, {
    useLLM: !!opts.useLLMDecompose,
    db: opts.db,
    requesterId: opts.requesterId,
  });

  const anyLLM = { decompose: false, entailment: false };
  // decomposeIntoClaims degrades silently on LLM failure; we can't observe
  // from here whether the LLM path actually fired vs fell back, so `mode`
  // below reports "requested" intent, not a guaranteed LLM hit — honest
  // about what we can and can't observe.
  if (opts.useLLMDecompose) anyLLM.decompose = true;

  const entailments = [];
  for (const claim of claimTexts) {
    // Sequential on purpose: per-claim and order-independent, but serializing
    // keeps LLM calls (when enabled) rate-friendly.
    const e = await scoreEntailment(claim, retrievedDtus, { useLLM: !!opts.useLLMEntailment, db: opts.db });
    if (opts.useLLMEntailment && e.method === "llm-judge") anyLLM.entailment = true;
    entailments.push({ text: claim, ...e });
  }

  const faith = computeFaithfulness(entailments);
  const relevancy = computeAnswerRelevancy(question, text);
  const precision = computeContextPrecision(entailments, retrievedDtus);

  // Citation-attribution axis — reuse reason-verify.js's `verifyClaim`
  // directly (deterministic citation-resolution floor + optional council),
  // rather than re-scoring citations here. Only runs when citationIds were
  // supplied; otherwise this axis is honestly absent (null), not fabricated.
  let citation = null;
  const citationIds = Array.isArray(opts.citationIds) ? opts.citationIds : [];
  if (opts.db && citationIds.length > 0) {
    try {
      citation = await verifyClaim(opts.db, {
        claim: text,
        citationIds,
        requesterId: opts.requesterId || null,
        useCouncil: opts.useCitationCouncil === true, // default off — this harness already judges entailment itself
        useProof: false,
      });
    } catch (e) {
      try { logger.debug?.("answer-eval", "citation_check_failed", { error: e?.message }); } catch { /* decoration only */ }
      citation = null;
    }
  }

  // Single combined verdict — a fabricated citation is the strongest, most
  // unambiguous red flag (an assertion that doesn't exist can't have been
  // legitimately retrieved), so it overrides the faithfulness verdict rather
  // than being averaged into it (the "penalized once, not twice" rule: a
  // fabricated citation isn't ALSO double-counted as a contradicted claim).
  let verdict = faith.verdict;
  if (citation?.verdict === "fabricated_citation") verdict = "fabricated_citation";

  const mode = (anyLLM.decompose || anyLLM.entailment) ? "llm-enhanced" : "deterministic";

  return {
    ok: true,
    question: question || null,
    answer: text,
    claims: entailments,
    faithfulness: faith.faithfulness,
    faithfulnessBreakdown: {
      entailedCount: faith.entailedCount,
      contradictedCount: faith.contradictedCount,
      neutralCount: faith.neutralCount,
      total: faith.total,
    },
    answerRelevancy: relevancy.score,
    answerRelevancyMethod: relevancy.method,
    contextPrecision: precision.score,
    contextPrecisionDetail: { usedCount: precision.usedCount, totalCount: precision.totalCount },
    citation,
    verdict,
    mode,
  };
}

// ── 5. CapabilityBadge adapter ──────────────────────────────────────────────

// Translates this harness's own verdict vocabulary
// (grounded | partially_grounded | contradicted | unverified | fabricated_citation)
// onto the exact 7-string vocabulary
// concord-frontend/components/common/CapabilityBadge.tsx's `capabilityTierFor`
// recognizes, so the badge's tier classification (proven/flagged/reasoned/
// unverified) is guaranteed correct rather than relying on its "anything
// unrecognized -> reasoned" fallback. Only 'contradicted' needs remapping:
// RAGAS treats a context-CONTRADICTED claim as the strongest faithfulness
// failure, deserving the same red "flagged" tier as a Z3-refuted claim, not
// the amber "reasoned" tier an unrecognized string would fall into.
const VERDICT_TO_CAPABILITY = {
  grounded: "grounded",                     // proven tier (green)
  fabricated_citation: "fabricated_citation", // flagged tier (red) — passthrough from reason-verify.js
  contradicted: "refuted",                  // flagged tier (red) — context directly conflicts with the answer
  partially_grounded: "unsupported",        // reasoned tier (amber)
  unverified: "unverified",                 // reasoned tier (amber, per CapabilityBadge's own doc comment: a check DID run, just nothing to check against)
};

/**
 * Adapt an `evaluateAnswer` result into CapabilityBadge's `CapabilityVerdict`
 * prop shape (concord-frontend/components/common/CapabilityBadge.tsx).
 * @param {object} evalResult - the return value of evaluateAnswer()
 * @returns {object} CapabilityVerdict-shaped object
 */
export function toCapabilityVerdict(evalResult) {
  if (!evalResult || evalResult.ok !== true) return { ok: false };
  const citation = evalResult.citation || null;
  return {
    ok: true,
    verdict: VERDICT_TO_CAPABILITY[evalResult.verdict] || "unverified",
    mode: evalResult.mode === "llm-enhanced" ? "council" : "deterministic",
    confidence: typeof evalResult.faithfulness === "number" ? evalResult.faithfulness : (citation?.confidence ?? null),
    claim: evalResult.question || evalResult.answer || null,
    citationsTotal: citation?.citationsTotal ?? 0,
    citationsResolved: citation?.citationsResolved ?? 0,
    allResolved: citation ? citation.allResolved : undefined,
    unresolvedIds: citation?.unresolvedIds ?? [],
    supported: evalResult.verdict === "grounded" ? true : evalResult.verdict === "contradicted" ? false : (citation?.supported ?? null),
  };
}

export default {
  decomposeIntoClaims,
  scoreEntailment,
  computeFaithfulness,
  computeAnswerRelevancy,
  computeContextPrecision,
  evaluateAnswer,
  toCapabilityVerdict,
};
