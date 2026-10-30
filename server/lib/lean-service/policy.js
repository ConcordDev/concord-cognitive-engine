// server/lib/lean-service/policy.js
//
// What a Lean source must NOT contain to count as a proof, shared by the check
// service (pod) and the backend client so both refuse the same things. Pure, no imports.
//
// A proof that uses `sorry`/`admit`, adds an `axiom`, or runs code at elaboration
// time (`#eval`, `run_cmd`, `elab`, IO, ...) is not a proof of the claim and, for the
// last group, could touch the file system or network of the box that checks it.
// The service additionally runs `#print axioms` on every theorem and accepts only
// the three standard axioms.

export const MAX_SOURCE_BYTES = 20_000;
export const STANDARD_AXIOMS = Object.freeze(["propext", "Classical.choice", "Quot.sound"]);
export const ALLOWED_IMPORT_ROOTS = Object.freeze(["Mathlib", "Std", "Batteries", "Init", "Lean.Elab.Tactic.Omega"]);

const FORBIDDEN = [
  [/\bsorry\b/, "uses sorry"],
  [/\badmit\b/, "uses admit"],
  [/\baxiom\b/, "declares an axiom"],
  [/\bunsafe\b/, "uses unsafe"],
  [/\bnative_decide\b/, "uses native_decide (trusts compiled code)"],
  [/\bimplemented_by\b|\bextern\b|\bexport\b/, "uses implemented_by/extern/export"],
  [/#eval\b|#reduce\b|#print\s+(?!axioms)/, "uses #eval/#reduce/#print"],
  [/\brun_cmd\b|\brun_elab\b|\brun_meta\b/, "runs code at elaboration time"],
  [/\belab\b|\belab_rules\b|\bsyntax\b|\bmacro_rules\b|\bmacro\b|\bdeclare_syntax_cat\b/, "defines syntax, macros or elaborators"],
  [/\binitialize\b|\bbuiltin_initialize\b/, "uses initialize"],
  [/\bIO\.|\bSystem\.|\bEIO\b|\bBaseIO\b|\bIO\s*\(/, "uses IO or System"],
  [/\binclude_str\b|\bimport_all\b/, "reads files"],
  [/\bset_option\s+maxRecDepth\s+\d{6,}|\bset_option\s+maxHeartbeats\s+0\b/, "removes resource limits"],
];

/** @returns {string[]} reasons the source cannot count as a proof (empty = acceptable). */
export function leanSourceIssues(source) {
  const src = String(source ?? "");
  const issues = [];
  if (!src.trim()) return ["empty source"];
  if (Buffer.byteLength(src, "utf8") > MAX_SOURCE_BYTES) issues.push(`source larger than ${MAX_SOURCE_BYTES} bytes`);
  // strip comments and string literals so a word in a comment does not trigger (and cannot hide a real use)
  const code = src.replace(/\/-[\s\S]*?-\//g, " ").replace(/--[^\n]*/g, " ").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  for (const [re, why] of FORBIDDEN) if (re.test(code)) issues.push(why);
  for (const m of code.matchAll(/^\s*import\s+([A-Za-z0-9_.]+)/gm)) {
    const root = m[1];
    if (!ALLOWED_IMPORT_ROOTS.some((r) => root === r || root.startsWith(`${r}.`))) issues.push(`imports ${root} (allowed: ${ALLOWED_IMPORT_ROOTS.join(", ")})`);
  }
  if (!/\b(theorem|lemma|example)\b/.test(code)) issues.push("states no theorem, lemma or example");
  return [...new Set(issues)];
}

/** Names to `#print axioms` for: every theorem/lemma. */
export function theoremNames(source) {
  const names = [];
  for (const m of String(source).matchAll(/^\s*(?:private\s+|protected\s+)?(?:theorem|lemma)\s+([A-Za-z_][A-Za-z0-9_'.]*)/gm)) names.push(m[1]);
  return [...new Set(names)];
}

/**
 * Read `#print axioms` output. Returns { ok, extra } where extra lists axioms outside the standard three.
 * Lean prints either "'t' depends on axioms: [a, b]" or "'t' does not depend on any axioms".
 */
export function axiomsVerdict(output) {
  const extra = new Set();
  let seen = 0;
  for (const m of String(output).matchAll(/depends on axioms:\s*\[([^\]]*)\]/g)) {
    seen++;
    for (const a of m[1].split(",").map((s) => s.trim()).filter(Boolean)) if (!STANDARD_AXIOMS.includes(a)) extra.add(a);
  }
  seen += (String(output).match(/does not depend on any axioms/g) || []).length;
  return { ok: extra.size === 0, extra: [...extra], seen };
}
