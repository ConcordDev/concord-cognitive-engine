// server/lib/sandwich/format-gate.js
//
// Format gate — the BOTTOM slice of the verified sandwich.
//
// Turns the raw deterministic DAG result into prose, CONSTRAINED so the model
// can only restate what the data already says, then VERIFIES the prose two ways
// before trusting it:
//
//   (a) Programmatic fact guard (deterministic, no model): extract every number
//       and identifier-like entity from the generated prose and assert each one
//       actually appears in the result data. If the model invented a number or
//       entity that isn't in the data, we DROP the prose and fall back to a
//       deterministic template (a plain stringification of the key result
//       fields), marking verified:false, reason:'formatter_added_facts'.
//
//   (b) Claim verification (verifyClaim): when there's a cited claim + db, run
//       the existing deterministic citation floor / council judge and carry its
//       verdict through.
//
// HONESTY: this gate is "verified, not hallucination-proof". The guard catches
// invented numbers/entities — it does not certify that grammatically-clean,
// data-consistent prose is true. Purely-structured results take the template
// path with NO model at all (the honest default — nothing to "format").
//
// All of this runs on CPU. The only model touchpoint is the optional
// constrained-synthesizer pass; there is no acceleration claim.

import { verifyClaim } from "../reason-verify.js";
import { ollamaChat } from "../inference/ollama-client.js";
import { TASK_PROMPTS } from "../prompt-registry.js";

const FORMAT_BRAIN = "utility";

/**
 * Default LLM function — utility brain, low temperature (faithful, not creative).
 */
async function defaultLlmFn({ messages }) {
  return ollamaChat(FORMAT_BRAIN, messages, { temperature: 0.1 });
}

/**
 * Deterministic template formatter — the honest fallback. Renders the key
 * result fields without a model. Used both when there is no model (pure
 * structured result) and when the fact guard rejects the model's prose.
 */
export function templateFormat(resultData) {
  if (resultData === null || resultData === undefined) return "No result.";
  if (typeof resultData !== "object") return String(resultData);

  // Prefer a flat, human-readable line per leaf field. Keep it bounded.
  const lines = [];
  const walk = (obj, prefix) => {
    if (lines.length >= 40) return;
    if (obj === null || obj === undefined) {
      lines.push(`${prefix}: (none)`);
      return;
    }
    if (typeof obj !== "object") {
      lines.push(`${prefix}: ${String(obj)}`);
      return;
    }
    if (Array.isArray(obj)) {
      lines.push(`${prefix}: [${obj.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ")}]`);
      return;
    }
    for (const k of Object.keys(obj)) {
      walk(obj[k], prefix ? `${prefix}.${k}` : k);
    }
  };
  walk(resultData, "");
  return lines.length ? lines.join("\n") : JSON.stringify(resultData);
}

/**
 * Build the canonical "data corpus" string the fact guard checks prose tokens
 * against — a normalized concatenation of every primitive value in the data.
 */
function dataCorpus(resultData) {
  const parts = [];
  const walk = (v) => {
    if (v === null || v === undefined) return;
    if (typeof v === "object") {
      if (Array.isArray(v)) v.forEach(walk);
      else Object.values(v).forEach(walk);
      return;
    }
    parts.push(String(v));
  };
  walk(resultData);
  return parts.join("  ");
}

// Numbers like 42, -3.5, 1,000, 1.2e9 (we strip thousands separators for compare).
const NUMBER_RE = /-?\d[\d,]*(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
// Identifier-ish entities: dtu- abc, snake_case ids, CamelCase, UUIDs, etc.
const ENTITY_RE = /\b[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+\b/g;

function normalizeNumber(s) {
  return s.replace(/,/g, "");
}

/**
 * Does the data corpus contain this numeric token? We compare numerically so
 * "3.0" in prose matches "3" in data, and we tolerate thousands separators.
 * A bare integer that is part of a larger number in the data also counts as
 * present (substring) to avoid false positives on formatting.
 */
function numberInCorpus(num, corpus, corpusNumbers) {
  const target = Number(normalizeNumber(num));
  if (!Number.isFinite(target)) return true; // un-parseable → don't fail on it
  for (const c of corpusNumbers) {
    if (c === target) return true;
  }
  // Substring fallback (handles ids embedded in strings, e.g. "v2").
  return corpus.includes(normalizeNumber(num));
}

function extractCorpusNumbers(corpus) {
  const out = [];
  const m = corpus.match(NUMBER_RE) || [];
  for (const t of m) {
    const n = Number(normalizeNumber(t));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * Programmatic fact guard. Returns { ok, invented:[...] }.
 * ok=false means the prose introduced a number/entity absent from the data.
 */
export function factGuard(prose, resultData) {
  const text = String(prose || "");
  const corpus = dataCorpus(resultData);
  const corpusLower = corpus.toLowerCase();
  const corpusNumbers = extractCorpusNumbers(corpus);
  const invented = [];

  for (const num of text.match(NUMBER_RE) || []) {
    if (!numberInCorpus(num, corpus, corpusNumbers)) invented.push({ kind: "number", value: num });
  }
  for (const ent of text.match(ENTITY_RE) || []) {
    // entities are identifier-shaped tokens (have a - or _); compare case-insensitively
    if (!corpusLower.includes(ent.toLowerCase())) invented.push({ kind: "entity", value: ent });
  }

  return { ok: invented.length === 0, invented };
}

/**
 * Format a DAG result into verified prose.
 *
 * @param {*} resultData - the deterministic DAG output (or its key result field)
 * @param {{ claimText?:string, db?:object, requesterId?:string|null,
 *           citationIds?:string[], llmFn?:Function, useLlm?:boolean }} opts
 * @returns {Promise<{ prose:string, verified:boolean, verdict:string|null, usedTemplate:boolean, invented?:Array }>}
 */
export async function formatResult(resultData, opts = {}) {
  const {
    claimText = "",
    db = null,
    requesterId = null,
    citationIds = [],
    llmFn = defaultLlmFn,
    useLlm = true,
  } = opts;

  // (b) Claim verification verdict (deterministic floor; council if brains up).
  // Runs independent of how we render the prose. No citations → 'unverified'.
  let verdict = null;
  if (db && (claimText || citationIds.length)) {
    try {
      const v = await verifyClaim(db, {
        claim: claimText,
        citationIds,
        requesterId,
        // keep the gate cheap + deterministic by default; callers opt into council/proof
        useCouncil: opts.useCouncil === true,
        useProof: opts.useProof === true,
      });
      verdict = v?.verdict || null;
    } catch {
      verdict = null;
    }
  }

  // Honest default: a purely-structured result needs no model. Render the
  // template directly — nothing to hallucinate, fully verified by construction.
  if (!useLlm || typeof llmFn !== "function") {
    return { prose: templateFormat(resultData), verified: true, verdict, usedTemplate: true };
  }

  // (a) Constrained synthesis pass.
  let prose = "";
  try {
    const system = TASK_PROMPTS.constrainedSynthesizer({ claimText });
    const messages = [
      { role: "system", content: system },
      {
        role: "user",
        content: `STRUCTURED RESULT (the only source of truth):\n${JSON.stringify(resultData, null, 2)}`,
      },
    ];
    const res = await llmFn({ messages });
    if (res && res.ok !== false && res.text) prose = String(res.text).trim();
  } catch {
    prose = "";
  }

  // Model produced nothing → deterministic template, honestly verified.
  if (!prose) {
    return { prose: templateFormat(resultData), verified: true, verdict, usedTemplate: true };
  }

  // Fact guard — the verified-not-trusted core. If the prose invented any
  // number/entity not in the data, drop it for the deterministic template.
  const guard = factGuard(prose, resultData);
  if (!guard.ok) {
    return {
      prose: templateFormat(resultData),
      verified: false,
      verdict: "formatter_added_facts",
      usedTemplate: true,
      invented: guard.invented,
    };
  }

  // Prose passed the fact guard. It is verified (every number/entity traces to
  // the data); the citation verdict (if any) rides alongside. We do NOT claim
  // the prose is "true" beyond data-consistency — that's the honest ceiling.
  return { prose, verified: true, verdict, usedTemplate: false };
}

export default { formatResult, factGuard, templateFormat };
