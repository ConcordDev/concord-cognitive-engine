// server/lib/silver/report.js
//
// The Universal Silver gap report (markdown) from a buildSilverRegistry()
// result. Numbers only; it reads nothing and judges nothing beyond the
// contract states the registry assigned.

import { isPromotionCandidate } from "./contract.js";

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)} %` : "n/a");
const STATES = ["declared", "runtime", "hint", "inferred", "missing"];

export function renderGapReport(reg, { generatedAt, head, note, precisionSample = null } = {}) {
  const s = reg.summary;
  const L = [];
  L.push("# Universal Silver: registry gap report (phase 1)", "");
  L.push(`Generated ${generatedAt || "(unstamped)"}${head ? ` at \`${head}\`` : ""} by \`server/scripts/silver-registry-report.mjs\`, from the live maps of an in-process server boot. Contract ${reg.contractVersion}. Read-only: nothing was run or promoted.`, "");
  if (note) L.push(note, "");
  if (s.registryKeys) {
    const k = s.registryKeys;
    L.push("## Registry keys vs distinct engines", "");
    L.push(`The live LENS_ACTIONS + MACROS maps hold **${k.raw}** keys. ${k.subLensDelegatesFolded} are sub-lens delegates (\`lib/sub-lens-handlers.js\`: \`code.rust.git-commit\` forwards to \`code.git-commit\`), folded into their parent. ${k.sharedHandlerKeysFolded} more are one shared handler mounted on many domains (save, share, star, ...), folded into one entry each. That leaves **${k.distinctMacroEntries}** distinct macro entries. (CLAUDE.md's ~10,600 counts literal \`register\` calls in source; the live maps also hold loop-registered and generated actions.)`, "");
  }
  L.push("## Totals", "");
  L.push(`| | count |`, `|---|---:|`);
  L.push(`| registry entries | ${s.total} |`, `| domains | ${s.domains} |`);
  for (const [src, row] of Object.entries(s.bySource)) L.push(`| ${src} | ${row.count} |`);
  L.push(`| fully declared (every contract field \`declared\`) | ${s.fullyDeclared} |`);
  L.push(`| validation: uncertified / benchmarked / accepted | ${s.validation.uncertified} / ${s.validation.benchmarked} / ${s.validation.accepted} |`, "");
  L.push("Every entry is `uncertified` in v0 by construction: `benchmarked` needs a cited benchmark passing within tolerance, which the registry cannot see. Evidence (tests that exist, oracle cases) is listed, never counted as certification.", "");

  L.push("## Contract coverage by source", "");
  L.push("Per field, the share of entries in each state. `runtime` = reported per run only (ConKay receipts); `hint` = an informal doc-comment hint; `inferred` = derived by a heuristic here, not stated by the owner.", "");
  for (const [src, row] of Object.entries(s.bySource)) {
    L.push(`### ${src} (${row.count})`, "");
    L.push(`| field | ${STATES.join(" | ")} |`, `|---|${STATES.map(() => "---:").join("|")}|`);
    for (const f of reg.fields) {
      const r = row.fields[f.id] || {};
      L.push(`| ${f.label} | ${STATES.map((st) => (r[st] ? `${r[st]} (${pct(r[st], row.count)})` : "")).join(" | ")} |`);
    }
    L.push("");
  }

  L.push("## Macros", "");
  L.push(`| | count |`, `|---|---:|`);
  for (const [c, n] of Object.entries(s.macroClasses).sort()) L.push(`| classifier class ${c} | ${n} |`);
  L.push(`| with a behavioural test (macro-depth honest) | ${s.macrosWithBehavioralTest} |`);
  L.push(`| invoked by a substrate oracle case | ${s.macrosInOracleCases} |`);
  L.push(`| with an input hint | ${s.macrosWithInputHint} |`);
  L.push(`| registered in both LENS_ACTIONS and MACROS | ${s.macrosInBothRegistries} |`, "");
  L.push("Classes (runtime/macro-capability-classifier.js, name heuristics): A deterministic calculator or read-only, B structured mutation, C external I/O or LLM, D stateful-domain mutation, E destructive or skipped domain.", "");

  L.push("## Promotion candidates (where phase 4 starts)", "");
  L.push(`${s.promotionCandidates} macros have a behavioural test or an oracle case and are either named like a deterministic calculator by the classifier (${s.promotionCandidatesBy.classifier}) or parsed as pure compute by the macro-depth grader: no state, I/O, emits or writes in the handler (${s.promotionCandidatesBy.pureCompute}). ${s.macrosPureCompute} macros are pure compute in total, tested or not. A candidate is not a promotion: each still needs units, limits, a cited benchmark within tolerance and invalid-input tests. The classifier works from names only, so it undercounts calculators with camelCase names; the pure-compute signal is read from the code.`, "");
  if (precisionSample) {
    const judged = precisionSample.rows.filter((r) => r.solver !== null);
    const tp = judged.filter((r) => r.solver).length;
    L.push(`**Measured precision of the pure-compute signal:** ${tp} of ${judged.length} sampled candidates (${pct(tp, judged.length)}) are real deterministic computations when their handlers are read (${precisionSample.rows.length - judged.length} could not be located). Sample and per-item reasons: \`server/lib/silver/precision-sample.json\` (${precisionSample.judgedAt}). The misses are writes the grader's state check does not see (\`ctx.db\`, module-level stores), an external fetch it missed, catalogues and status summaries. So read the ${s.promotionCandidatesBy.pureCompute} as roughly ${Math.round((s.promotionCandidatesBy.pureCompute * tp) / Math.max(1, judged.length))} real computations, most of them business or analysis calculations rather than physics. Phase 4 reads every handler before promoting it.`, "");
  }
  L.push("| domain | candidates |", "|---|---:|");
  for (const [d, n] of s.promotionCandidateDomains.slice(0, 30)) L.push(`| ${d} | ${n} |`);
  if (s.promotionCandidateDomains.length > 30) L.push(`| (${s.promotionCandidateDomains.length - 30} more domains) | |`);
  L.push("");
  const oracle = reg.entries.filter((e) => e.source === "macro" && e.evidence.oracleCases.length);
  if (oracle.length) {
    L.push("Oracle-invoked macros (each already has an exact-value check through the real dispatch):", "");
    for (const e of oracle) L.push(`- \`${e.id}\`: ${e.evidence.oracleCases.join(", ")}${isPromotionCandidate(e) ? "" : ` (class ${e.evidence.class}, not counted as a candidate)`}`);
    L.push("");
  }

  L.push("## ConKay solvers", "");
  L.push(`${s.bySource["conkay-solver"]?.count || 0} registered; ${s.conkaySolversWithReferencedTests} name a test file in their reference that exists. Missing fields per solver:`, "");
  L.push("| solver | fidelity | missing | referenced tests |", "|---|---:|---|---|");
  for (const e of reg.entries.filter((x) => x.source === "conkay-solver")) {
    const missing = Object.entries(e.fields).filter(([, st]) => st === "missing").map(([f]) => f).join(", ") || "none";
    const tests = e.evidence.referencedTests.map((t) => `${t.path}${t.exists ? "" : " (missing!)"}`).join("<br>") || "none";
    L.push(`| \`${e.id}\` ${e.version} | L${e.fidelity} | ${missing} | ${tests} |`);
  }
  L.push("");

  const outside = reg.entries.filter((e) => e.source === "runtime-capability");
  if (outside.length) {
    L.push("## Runtime capabilities outside the macro maps", "");
    L.push(`${outside.length} capabilities have no LENS_ACTIONS / MACROS entry: ${Object.entries(s.capabilitiesByImplementation).map(([k, v]) => `${v} implemented as ${k}`).join(", ")}. ${s.capabilitiesUnregisteredMacro} declare a macro implementation that is not registered (orphans).`, "");
    for (const e of outside) L.push(`- \`${e.id}\` (owner ${e.owner}, ${e.evidence.implementation}${e.evidence.mcpTool ? ` tool \`${e.evidence.mcpTool}\`` : ""}${e.evidence.unregisteredMacro ? ", **orphan**" : ""})`);
    L.push("");
  }

  L.push("## What the gaps mean (phase 2 onwards)", "");
  L.push("- **frame** is missing everywhere: there is no coordinate-frame object yet (phase 2).");
  L.push("- **units, limits, outputs** are missing for almost every macro: declaring them is the bulk of phase 4, starting with the candidates above.");
  L.push("- **provenance** exists only for ConKay solvers (the receipt envelope); macros return raw results.");
  L.push("- **risk** for macros is a name heuristic, not an owner's declaration.", "");
  return L.join("\n");
}
