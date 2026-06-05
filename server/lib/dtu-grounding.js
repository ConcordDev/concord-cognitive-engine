// server/lib/dtu-grounding.js
//
// "Show your work" — the quality gate for AUTONOMOUS (subconscious/autogen) DTUs. An
// autonomous knowledge unit may not launder into VERIFIED/GLOBAL knowledge on internal
// vibes alone. It must be grounded in REALITY:
//
//   • EMPIRICAL claim  → at least one EXTERNAL web source (a real http(s) URL), not just
//                        other DTUs citing other DTUs (that's confidence laundering).
//   • CREATIVE / generative (a formula, recipe, spell, skill, blueprint, code) → it must
//                        be EXECUTABLE and REPRODUCIBLE: re-running the embedded computation
//                        twice yields the same result (and matches any declared expected).
//
// Anything that can't show its work is flagged PROBATION (confidence-capped, not promoted,
// not published) rather than rejected — so the subconscious can keep proposing, but only
// grounded proposals graduate. Pure + total; the actual re-run is delegated to injected
// runners so this module stays dependency-free and testable.

const URL_RE = /\bhttps?:\/\/[^\s)"'<>]+/i;
const CREATIVE_KINDS = new Set([
  "spell_recipe", "blueprint", "fighting_style_recipe", "recipe", "skill_recipe",
  "formula", "craft", "code", "program", "derivation", "proof", "evo_asset",
]);

/** Pull every external web URL referenced anywhere on the DTU (sources/citations/claims). */
export function collectWebSources(dtu) {
  const out = new Set();
  const push = (v) => { if (typeof v === "string") { const m = v.match(URL_RE); if (m) out.add(m[0]); } };
  const scan = (arr) => { for (const x of (Array.isArray(arr) ? arr : [])) {
    if (!x) continue;
    if (typeof x === "string") push(x);
    else { push(x.url); push(x.sourceUrl); push(x.source_url); push(x.href); push(x.link); push(x.source); }
  } };
  const m = dtu?.meta || {};
  scan(m.sources); scan(m.citations); scan(m.evidence); scan(m.references);
  scan(dtu?.machine?.sources); scan(dtu?.sources);
  scan(dtu?.claimAnnotations); scan(dtu?.machine?.claimAnnotations);
  push(m.sourceUrl); push(m.url);
  return [...out];
}

/** What kind of grounding does this DTU OWE? empirical (claims feasibility) vs creative. */
export function classifyGrounding(dtu) {
  const kind = String(dtu?.kind || dtu?.content_type || "").toLowerCase();
  const tags = (Array.isArray(dtu?.tags) ? dtu.tags : []).map(t => String(t).toLowerCase());
  if (CREATIVE_KINDS.has(kind) || tags.some(t => /spell|recipe|blueprint|skill|formula|craft|generative|creative/.test(t))) {
    return "creative";
  }
  // claim-bearing: research/insight/claim kinds, or any fact/hypothesis annotation
  const anns = dtu?.claimAnnotations || dtu?.machine?.claimAnnotations || [];
  const assertsFact = Array.isArray(anns) && anns.some(a => /fact|hypothesis|inference|feasib/i.test(String(a?.type || "")));
  if (/research|claim|insight|finding|hypothesis|analysis|report/.test(kind) || assertsFact) return "empirical";
  return "definitional"; // definitions/enums/formatting — no external grounding owed
}

/** Does the DTU carry an executable spec we could re-run? (machine.executable or a recipe). */
export function hasExecutable(dtu) {
  const ex = dtu?.machine?.executable || dtu?.executable;
  if (ex && (ex.expr || ex.code || ex.src || ex.recipe || ex.formula)) return ex;
  // a structured creative recipe with numeric inputs counts as executable
  const r = dtu?.recipe || dtu?.machine?.recipe || dtu?.core?.recipe;
  if (r && (Array.isArray(r.inputs) || r.formula || typeof r.potency === "number")) return { kind: "recipe", recipe: r };
  return null;
}

/**
 * Re-run the embedded computation twice; reproducible iff both runs agree (and match any
 * declared `expected`). `runners` = { formula(expr)->value, code(src)->value, recipe(r)->value }
 * injected by the caller (math evaluator / code VM / craft-resolve), so this stays pure.
 */
export function verifyReproducible(dtu, runners = {}) {
  const ex = hasExecutable(dtu);
  if (!ex) return { ran: false, reproducible: false, reason: "no_executable_representation" };
  const run = ex.expr ? runners.formula : ex.code || ex.src ? runners.code : runners.recipe;
  if (typeof run !== "function") return { ran: false, reproducible: false, reason: "no_runner" };
  try {
    const a = run(ex.expr || ex.code || ex.src || ex.recipe || ex.formula);
    const b = run(ex.expr || ex.code || ex.src || ex.recipe || ex.formula);
    const stable = JSON.stringify(a) === JSON.stringify(b);
    const expected = ex.expected;
    const matchesExpected = expected === undefined || JSON.stringify(a) === JSON.stringify(expected);
    return { ran: true, reproducible: stable && matchesExpected, stable, matchesExpected, result: a };
  } catch (e) { return { ran: true, reproducible: false, reason: "threw", error: String(e?.message || e) }; }
}

/**
 * The gate. Returns the grounding assessment + a recommended action.
 * grounded === false → caller should PROBATION the DTU (cap confidence, don't publish).
 */
export function assessGrounding(dtu, runners = {}) {
  const kind = classifyGrounding(dtu);
  if (kind === "definitional") {
    return { kind, grounded: true, reason: "no_external_grounding_owed", webSources: [], gaps: [] };
  }
  if (kind === "empirical") {
    const webSources = collectWebSources(dtu);
    const grounded = webSources.length > 0;
    return {
      kind, grounded, webSources,
      gaps: grounded ? [] : ["needs_web_sources"],
      confidenceCap: grounded ? null : 0.4,
      showWork: grounded ? `Backed by ${webSources.length} external source(s).` : "UNVERIFIED: no external web source for this claim.",
    };
  }
  // creative
  const rep = verifyReproducible(dtu, runners);
  return {
    kind, grounded: rep.reproducible, reproduced: rep,
    webSources: collectWebSources(dtu),
    gaps: rep.reproducible ? [] : [rep.reason || "needs_reproducibility"],
    confidenceCap: rep.reproducible ? null : 0.4,
    showWork: rep.reproducible
      ? `Reproducible: re-ran the computation, stable${rep.matchesExpected === false ? " but ≠ expected" : ""}.`
      : `NOT REPRODUCIBLE (${rep.reason || "no executable representation"}).`,
  };
}

/** Stamp the assessment onto the DTU (the show-your-work trail) + probation if ungrounded. */
export function stampGrounding(dtu, assessment) {
  if (!dtu || !assessment) return dtu;
  dtu.machine = dtu.machine || {};
  dtu.machine.grounding = {
    kind: assessment.kind,
    grounded: assessment.grounded,
    webSources: assessment.webSources || [],
    reproduced: assessment.reproduced || null,
    showWork: assessment.showWork,
    assessedAt: new Date().toISOString(),
  };
  if (!assessment.grounded) {
    dtu.meta = dtu.meta || {};
    dtu.meta.probation = true;
    dtu.meta.probationReason = assessment.gaps?.[0] || "ungrounded";
    if (assessment.confidenceCap != null) {
      dtu.meta.confidence = Math.min(Number(dtu.meta.confidence ?? 1), assessment.confidenceCap);
    }
  }
  return dtu;
}

export default { classifyGrounding, collectWebSources, hasExecutable, verifyReproducible, assessGrounding, stampGrounding };
