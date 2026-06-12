// server/lib/proof-gate.js
//
// Formal-proof gate — the SOUND layer for reason.verify, borrowed from MOTO's
// "only store what the checker accepts" discipline and wired onto the
// subconscious brain (the autonomous formaliser) + Z3 (the SMT checker).
//
// reason.verify already does two things well:
//   • a deterministic citation-resolution floor (catches fabricated citations)
//   • a multi-brain COUNCIL judge (semantic "do these sources support this?")
// Both are *semantic* — a confident LLM can still be wrong. This file adds the
// missing third layer for the one slice where soundness is achievable:
// mathematical / logical claims. For those, we don't ask a brain "is this true?"
// — we ask Z3.
//
// Flow (all three steps are cheap-gated so non-math claims cost nothing):
//   1. classifyAmenable(claim)   — deterministic heuristic: does this LOOK like a
//      math/logic statement worth formalising? Pure regex, no brain, no Z3.
//   2. formaliseClaim(claim)     — the subconscious brain translates the claim into
//      SMT-LIB that asserts the NEGATION of the claim (prove-by-refutation).
//   3. runZ3(smtlib)             — Z3 checks: `unsat` ⇒ the negation is impossible
//      ⇒ the claim is VALID (proven); `sat` ⇒ the negation has a model ⇒ the claim
//      is REFUTED (and the model is a counterexample); `unknown`/timeout ⇒ inconclusive.
//
// HONESTY (encoded, not aspirational):
//   • Z3's verdict is SOUND *relative to the formalisation*. The NL→SMT step is
//     brain-dependent, so a "proven" verdict means "the SMT the subconscious brain
//     produced was machine-checked valid" — the emitted `smt` is returned so a human
//     can audit the translation. This is exactly MOTO's Lean caveat ("view with
//     scrutiny"), made explicit.
//   • If Z3 is not installed, the gate returns verdict:"unavailable" and changes
//     NOTHING about the existing citation/council verdict — pure graceful
//     degradation, identical to the council-offline path. Ships safely with no Z3.
//   • Every checker call is injectable (z3Runner / brainFn) so the whole gate is
//     deterministically testable offline — mirrors the connectorFetch fetchImpl seam.

import { execFile } from "node:child_process";
import logger from "../logger.js";

const DEFAULT_TIMEOUT_MS = 8000;
const SMT_MAX_BYTES = 20_000; // a formalisation larger than this is almost certainly garbage

// ── 1. Amenability heuristic (deterministic, cheap) ──────────────────────────
// We only spend a brain call + Z3 run on claims that read as math/logic. The
// heuristic is intentionally conservative: false-negatives (skipping a provable
// claim) just fall back to the council; false-positives waste one gated call.
const AMENABLE_SIGNALS = [
  { key: "comparison", re: /[<>]=?|≤|≥|≠|\bequals?\b|=/ },
  { key: "quantifier", re: /\b(for all|for every|there exists|for any|forall|exists)\b/i },
  { key: "arithmetic", re: /\b\d+\s*[+\-*/^]\s*\d+\b|\b(sum|product|divisible|modulo|remainder)\b/i },
  { key: "number_theory", re: /\b(prime|even|odd|integer|natural number|rational|divides|gcd|factorial)\b/i },
  { key: "logic", re: /\b(implies|if and only if|iff|therefore|contradiction|tautolog)/i },
  { key: "algebra", re: /\b(polynomial|inequality|equation|root|monoton|convex|continuous)\b/i },
  { key: "set", re: /\b(subset|superset|union|intersection|cardinality|element of)\b/i },
];

// A claim that is mostly prose with none of the structural signals is not worth
// formalising. Require at least one signal AND a comparison/quantifier/logic anchor
// (the things SMT can actually express) — otherwise it's "soft" math talk.
const ANCHOR_KEYS = new Set(["comparison", "quantifier", "logic", "arithmetic"]);

export function classifyAmenable(claim) {
  const text = String(claim || "").trim();
  if (!text || text.length < 3) return { amenable: false, signals: [], reason: "empty" };
  if (text.length > 2000) return { amenable: false, signals: [], reason: "too_long" };
  const signals = AMENABLE_SIGNALS.filter((s) => s.re.test(text)).map((s) => s.key);
  const hasAnchor = signals.some((k) => ANCHOR_KEYS.has(k));
  const amenable = signals.length > 0 && hasAnchor;
  return { amenable, signals, reason: amenable ? "ok" : "no_formalisable_structure" };
}

// ── 2. SMT extraction from brain output ──────────────────────────────────────
// The brain is asked for a fenced ```smt block; be liberal in what we accept
// (```smt / ```smt2 / ```lisp / ```scheme) and fall back to grabbing the balanced
// S-expression region that contains a (check-sat).
export function extractSmt(text) {
  const raw = String(text || "");
  const fence = raw.match(/```(?:smt2?|lisp|scheme|z3)?\s*([\s\S]*?)```/i);
  let body = fence ? fence[1] : raw;
  // Keep only from the first declaration/assert to the check-sat (inclusive).
  const start = body.search(/\(\s*(declare-|assert|set-logic|define-)/);
  const end = body.search(/\(\s*check-sat\s*\)/);
  if (start >= 0 && end >= 0) {
    body = body.slice(start, end + body.slice(end).indexOf(")") + 1);
  }
  body = body.trim();
  if (!body || body.length > SMT_MAX_BYTES) return null;
  if (!/\(\s*check-sat\s*\)/.test(body)) {
    // Be forgiving: append a check-sat if the brain forgot it but gave assertions.
    if (/\(\s*assert\b/.test(body)) body += "\n(check-sat)";
    else return null;
  }
  return body;
}

// ── 3. Z3 runner (injectable; degrades to unavailable) ───────────────────────
function locateZ3() {
  return process.env.CONCORD_Z3_PATH || process.env.Z3_PATH || "z3";
}

/**
 * Run an SMT-LIB script through Z3. Returns { available, result, raw }.
 * result ∈ "sat" | "unsat" | "unknown" | null. available:false ⇒ no Z3 binary.
 * Injectable for tests via opts.runner(smtlib) → { available, result, raw }.
 */
export async function runZ3(smtlib, opts = {}) {
  if (typeof opts.runner === "function") {
    try { return await opts.runner(smtlib); }
    catch (e) { return { available: false, result: null, raw: String(e?.message || e) }; }
  }
  const z3 = opts.z3Path || locateZ3();
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(
        z3,
        ["-in", `-T:${Math.ceil(timeoutMs / 1000)}`],
        { timeout: timeoutMs, maxBuffer: 1_000_000 },
        (err, stdout, stderr) => {
          const out = String(stdout || "");
          // ENOENT ⇒ no binary ⇒ unavailable (the safe-degrade path).
          if (err && (err.code === "ENOENT" || /ENOENT|not found/i.test(String(err.message)))) {
            return resolve({ available: false, result: null, raw: String(stderr || err.message) });
          }
          const first = (out.match(/\b(sat|unsat|unknown)\b/) || [])[1] || null;
          resolve({ available: true, result: first, raw: out.trim() || String(stderr || "") });
        },
      );
    } catch (e) {
      resolve({ available: false, result: null, raw: String(e?.message || e) });
      return;
    }
    try { child.stdin.write(String(smtlib || "")); child.stdin.end(); } catch { /* execFile error already handled */ }
  });
}

const FORMALISE_SYSTEM =
  "You are a formal-methods translator. Convert the user's mathematical claim into " +
  "an SMT-LIB 2 script that PROVES IT BY REFUTATION: declare the needed sorts/consts, " +
  "then ASSERT THE NEGATION of the claim, and end with (check-sat). If Z3 returns " +
  "unsat the claim is valid. Use (set-logic ...) when helpful. Output ONLY a single " +
  "```smt code block — no prose. If the claim cannot be faithfully formalised in " +
  "SMT-LIB, output exactly ```smt\\n; UNFORMALISABLE\\n```.";

/**
 * Ask the subconscious brain to formalise a claim into refutation-style SMT-LIB.
 * Injectable via opts.brainFn(messages) → { ok, text }. Returns { smt, raw } | null.
 */
export async function formaliseClaim(claim, opts = {}) {
  const messages = [
    { role: "system", content: FORMALISE_SYSTEM },
    { role: "user", content: `Claim: "${String(claim || "").trim()}"` },
  ];
  let text = "";
  try {
    if (typeof opts.brainFn === "function") {
      const r = await opts.brainFn(messages);
      text = String(r?.text ?? r ?? "");
    } else {
      return null; // no brain wired ⇒ caller degrades
    }
  } catch (e) {
    try { logger.debug?.("proof-gate", "formalise_failed", { error: e?.message }); } catch { /* ignore */ }
    return null;
  }
  if (/;\s*UNFORMALISABLE/i.test(text)) return { smt: null, raw: text, unformalisable: true };
  const smt = extractSmt(text);
  return smt ? { smt, raw: text } : { smt: null, raw: text };
}

// ── Orchestrator ─────────────────────────────────────────────────────────────
// verdicts: proven | refuted | unknown | not_amenable | unformalisable | unavailable
/**
 * @param {{ claim:string, brainFn?:Function, z3Runner?:Function, z3Path?:string,
 *           timeoutMs?:number }} opts
 */
export async function proveClaim(opts = {}) {
  const claim = String(opts.claim || "").trim();
  const out = { attempted: false, amenable: false, verdict: "not_amenable", result: null, smt: null, signals: [], z3Available: null };

  const cls = classifyAmenable(claim);
  out.amenable = cls.amenable;
  out.signals = cls.signals;
  if (!cls.amenable) return out;

  // Check Z3 availability BEFORE spending a brain call — a quick (check-sat) on a
  // trivial script tells us whether the binary exists without a real proof.
  const probe = await runZ3("(check-sat)", { runner: opts.z3Runner, z3Path: opts.z3Path, timeoutMs: 2000 });
  out.z3Available = probe.available === true;
  if (!out.z3Available) { out.verdict = "unavailable"; return out; }

  out.attempted = true;
  const f = await formaliseClaim(claim, { brainFn: opts.brainFn });
  if (!f) { out.verdict = "unavailable"; return out; } // no brain wired
  if (f.unformalisable || !f.smt) { out.verdict = "unformalisable"; out.smt = f.smt || null; return out; }
  out.smt = f.smt;

  const z = await runZ3(f.smt, { runner: opts.z3Runner, z3Path: opts.z3Path, timeoutMs: opts.timeoutMs });
  out.result = z.result;
  out.z3Raw = z.raw;
  if (z.result === "unsat") out.verdict = "proven";       // negation impossible ⇒ claim valid
  else if (z.result === "sat") out.verdict = "refuted";   // negation has a model ⇒ counterexample
  else out.verdict = "unknown";                            // unknown / timeout
  return out;
}

// ── Autonomous batch: verify a set of reasoning conclusions ──────────────────
// The autonomous loop (lattice-orchestrator → runHLR) produces conclusions; this
// runs the proof-amenable ones through the gate so the self-reasoning is formally
// self-checking — Concord's continuous analogue to MOTO's "verify the research".
// Bounded by `max` amenable checks so a heartbeat never spends unboundedly; the
// z3-availability probe inside proveClaim keeps it near-free when Z3 is absent.
/**
 * @param {string[]} conclusions
 * @param {{ brainFn?:Function, z3Runner?:Function, max?:number }} opts
 * @returns {Promise<{ checked:number, proven:number, refuted:number, results:object[] }>}
 */
export async function verifyConclusions(conclusions, opts = {}) {
  const max = Math.max(1, Math.min(10, opts.max ?? 3));
  const list = (Array.isArray(conclusions) ? conclusions : [])
    .map((c) => String(c || "").trim())
    .filter(Boolean);
  const out = { checked: 0, proven: 0, refuted: 0, results: [] };
  for (const claim of list) {
    if (out.checked >= max) break;
    if (!classifyAmenable(claim).amenable) continue;
    let r;
    try { r = await proveClaim({ claim, brainFn: opts.brainFn, z3Runner: opts.z3Runner }); }
    catch { continue; }
    // "unavailable"/"not_amenable" don't count as a real check — only a checker verdict does.
    if (r.verdict === "unavailable") break; // no Z3 ⇒ stop, the rest would be no-ops too
    if (r.verdict === "proven" || r.verdict === "refuted" || r.verdict === "unknown") {
      out.checked++;
      if (r.verdict === "proven") out.proven++;
      if (r.verdict === "refuted") out.refuted++;
      out.results.push({ claim, verdict: r.verdict, smt: r.smt || null });
    }
  }
  return out;
}

export default { classifyAmenable, extractSmt, runZ3, formaliseClaim, proveClaim, verifyConclusions };
