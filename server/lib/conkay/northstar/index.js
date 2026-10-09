// server/lib/conkay/northstar/index.js
//
// The north-star run on the Sentinel/RAM spec: ingest the whole document
// into claim records, re-check every computed claim, carry the
// hypothesis/contradicted claims forward, and run Sentinel Milestone 1
// through the generic iterate-to-physical loop. renderNorthStarMarkdown()
// writes the report the spec asks for (section 10): passed and failed
// checks per domain, repairs with before/after, assumptions, unknowns, and
// the claims that remain hypothesis or contradicted, with reasons.

import { parseSpecMarkdown, summarizeSpec } from "../knowledge/spec-parser.js";
import { runRechecks } from "../knowledge/spec-rechecks.js";
import { makeClaim, validateClaim } from "../knowledge/claims.js";
import { loadFixture } from "../knowledge/index.js";
import { runSentinelM1 } from "../demos/sentinel-m1.js";
import "../index.js"; // registers every solver

/** Passages the spec itself marks hypothesis/contradicted, as ConKay claims. */
export function statedClaims(parsed, contradicted = [], rows = []) {
  const covered = new Map(contradicted.filter((c) => c.passage).map((c) => [c.passage.id, c.claim.id]));
  const out = [];
  for (const p of parsed.claims) {
    const s = p.statedStatus;
    if (!s.includes("hypothesis") && !s.includes("contradicted")) continue;
    if (covered.has(p.id) && !s.includes("hypothesis")) continue; // re-derived as a contra.* claim
    const id = `spec.${p.provenance.lines[0]}`;
    const evidence = [{ kind: "user_statement", title: parsed.doc.title || "spec", locator: `lines ${p.provenance.lines.join("-")}`, excerpt: p.text.slice(0, 300) }];
    const notes = [];
    for (const r of rows) if (r.passage?.id === p.id && r.verdict === "disagree" && r.note) notes.push(`ConKay re-check ${r.id} disagrees: ${r.note}`);
    if (covered.has(p.id)) notes.push(`contradiction re-derived as ${covered.get(p.id)}`);
    else if (s.includes("contradicted")) notes.push("spec says contradicted; ConKay has no law/source + calculation for this passage, so it stays a hypothesis");
    const claim = makeClaim({ id, subject: parsed.doc.sourceId, property: p.kind, kind: "qualitative", statement: p.text.slice(0, 400), value: null, status: ["hypothesis"], support: "unsupported", bin: p.bin, evidence, notes: [`spec status: ${s.join(", ")}`, ...notes] });
    // A hypothesis with no value: the asserted value lives in the statement.
    claim.value = p.text.slice(0, 120);
    out.push({ claim, errors: validateClaim(claim) });
  }
  return out;
}

export function runNorthStar({ specText = loadFixture("sentinel-ram-spec-r1").text, sourceId = "sentinel-ram-r1" } = {}) {
  const parsed = parseSpecMarkdown(specText, { sourceId });
  const rechecks = runRechecks(parsed);
  const stated = statedClaims(parsed, rechecks.contradicted, rechecks.rows);
  const claims = [...rechecks.contradicted.map((c) => c.claim), ...stated.map((c) => c.claim)];
  const sentinel = runSentinelM1({ claims });
  return {
    spec: { doc: parsed.doc, summary: summarizeSpec(parsed), parser: parsed.parser },
    parsed,
    rechecks,
    statedClaims: stated,
    sentinel,
    invalidClaims: [...rechecks.contradicted, ...stated].filter((c) => c.errors.length).map((c) => ({ id: c.claim.id, errors: c.errors })),
  };
}

const f = (v, d = 3) => (Number.isFinite(v) ? (Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(d) : +v.toFixed(d)) : String(v));

export function renderNorthStarMarkdown(ns) {
  const L = [];
  const R = ns.sentinel.report;
  const run = (id) => R.checks.find((c) => c.runId === id);
  const first = (id) => R.initial.find((c) => c.runId === id);
  L.push(`# ConKay north star — Sentinel/RAM spec run`, "");
  L.push(`Spec: ${ns.spec.doc.title} (${ns.spec.doc.revision || "rev ?"}), sha256 \`${ns.spec.doc.sha256}\`, ${ns.spec.doc.lineCount} lines.`);
  L.push(`Ingestion (${ns.spec.parser.id} ${ns.spec.parser.version}): ${ns.spec.summary.claims} claim records; by kind ${JSON.stringify(ns.spec.summary.byKind)}; by bin ${JSON.stringify(ns.spec.summary.byBin)}.`, "");
  L.push("## Re-check of the spec's computed claims", "", "| Check | Spec lines | Spec value | ConKay value | Δ % | Verdict | Inputs (source) |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of ns.rechecks.rows) {
    const src = Object.entries(r.inputs).map(([k, i]) => `${k}=${f(i.value, 6)} ${i.unit} (${i.source})`).join("; ");
    const ck = r.kind === "feasibility" ? (r.conkay.value ? "100 % reachable" : "100 % not reachable") : f(r.conkay.value, 4);
    const dv = r.kind === "feasibility" ? `${r.inputs.sums.value} %; "contradicted"` : `${r.doc.text}${r.doc.unit === "1" ? "" : ` ${r.doc.unit}`}`;
    L.push(`| ${r.label} | ${r.passage ? r.passage.lines.join("–") : "—"} | ${dv} | ${ck} | ${r.deltaPct == null ? "—" : r.deltaPct.toFixed(2)} | **${r.verdict}** | ${src || "—"} |`);
  }
  L.push("", ...ns.rechecks.rows.filter((r) => r.note || r.assumptions.length).map((r) => `- \`${r.id}\`: ${[r.note, ...r.assumptions].filter(Boolean).join(" ")}`), "");
  L.push("## Contradicted (law/source + calculation on file)", "");
  for (const c of ns.rechecks.contradicted) L.push(`- \`${c.claim.id}\` (${c.claim.bin}): ${c.claim.statement}. Basis: ${c.claim.evidence.filter((e) => e.kind !== "calculation").map((e) => e.title).join("; ")}. ${c.claim.notes.join(" ")}`);
  L.push("", "## Sentinel Milestone 1", "", `Loop ${R.loopVersion}: ${R.converged ? "converged" : "did NOT converge"} in ${R.iterations} iteration(s) (limit ${R.maxIterations}); requirements unchanged (hash \`${R.requirementsHash.slice(0, 16)}…\`). Receipt \`${R.receipt.sha256}\`.`, "");
  const mb0 = first("mass.budget@sentinel").outputs; const mb = run("mass.budget@sentinel").outputs;
  L.push("### Mass and CG", "", `Known mass ${f(mb0.knownMass.value)} kg → ${f(mb.knownMass.value)} kg after repairs (sourced ${f(mb.massByState.value.sourced)}, computed ${f(mb.massByState.value.computed)}, requirement ${f(mb.massByState.value.requirement)} kg). CG of known mass (x fwd, y left, z up): (${f(mb.cgX.value)}, ${f(Math.abs(mb.cgY.value) < 1e-12 ? 0 : mb.cgY.value)}, ${f(mb.cgZ.value)}) m.`, "", "Unknown mass (a gap, not zero):", ...mb.unknownItems.value.map((u) => `- ${u.id}: ${u.name} — ${u.reason}`), "");
  const st0 = first("stability.static@sentinel").outputs; const st = run("stability.static@sentinel").outputs;
  L.push("### Static stability", "", `CG inside the two-foot support polygon; margin ${f(st0.stabilityMargin.value)} m → ${f(st.stabilityMargin.value)} m after the battery repair (requirement ≥ 0.05 m: ${run("requirement.check@R-stability").status}).`, "");
  const cl = run("geometry.clearance@sentinel");
  L.push("### Collision / clearance", "", `Overall height ${f(cl.outputs.overallHeight.value)} m (R-height ${run("requirement.check@R-height").status}); interferences: ${cl.outputs.interferences.value.length}; service envelopes blocked: ${cl.outputs.serviceBlocked.value.length}. ${cl.warnings.join(" ")}`, "");
  const tb0 = first("structural.tube-bending@bracket"); const tb = run("structural.tube-bending@bracket");
  L.push("### Structure", "", `Failed member: **bracket** (payload hard-point cantilever). σ = ${f(tb0.outputs.stress.value / 1e6, 1)} MPa vs allowable ${f(tb0.outputs.allowable.value / 1e6, 1)} MPa (Fy 35 ksi ASTM B221 min ÷ 2) → ${tb0.status}. After repair σ = ${f(tb.outputs.stress.value / 1e6, 1)} MPa, utilization ${f(tb.margins[0].utilization)} → ${tb.status}.`, ...tb.warnings.map((w) => `- ${w}`), "");
  const e0 = first("electrical.budget@sentinel").outputs; const e1 = run("electrical.budget@sentinel").outputs;
  L.push("### Power budget", "", `Peak ${f(e1.peakPower.value, 1)} W, average ${f(e1.averagePower.value, 1)} W (rails ${Object.entries(e1.rails.value).map(([k, v]) => `${k} ${f(v.averageW, 1)}/${f(v.peakW, 1)} W avg/peak`).join(", ")}).`);
  L.push(`Battery start 13S2P: ${f(e0.batteryNominalEnergy.value, 1)} Wh nominal, ${f(e0.missionEnergy.value, 1)} Wh for the mission → **${f(e0.operatingDurationHours.value)} h** (< 1 h: FAIL); peak current ${f(e0.peakCurrentAtMinV.value, 1)} A at ${f(e0.packVoltage.value.min, 1)} V vs ${f(e0.continuousCurrentRating.value)} A rating (FAIL).`);
  L.push(`After repair: ${f(e1.batteryNominalEnergy.value, 1)} Wh → **${f(e1.operatingDurationHours.value)} h**; ${f(e1.peakCurrentAtMinV.value, 1)} A vs ${f(e1.continuousCurrentRating.value)} A.`);
  const so = run("energy.solar-yield@sentinel").outputs; const ce = run("conservation.energy@sentinel").outputs;
  L.push(`Solar (estimated): ${f(so.dailyEnergy.value, 1)} Wh/day → ${f(ce.solarOnlyHoursPerDay.value)} h of average-load operation per day; daily net at 1 h/day ${f(ce.dailyNet.value, 1)} Wh. Energy balance: no perpetual operation.`, "");
  L.push("### Repairs (bounded; requirements unchanged)", "", "| Iter | Failing check | Variable | Before | After | Result | Why |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const x of R.repairs) L.push(`| ${x.iteration} | ${x.failingRun} | ${x.variable} | ${x.before} | ${x.after} | ${x.result} | ${x.reason || (x.statusChanges || []).map((c) => `${c.runId}: ${c.from}→${c.to}`).join(", ")} |`);
  L.push("", "### Final status per domain (no combined score)", "", "| Domain | PASS | WARN | FAIL | NOT_COMPUTED |", "| --- | --- | --- | --- | --- |");
  for (const [d, v] of Object.entries(R.byDomain)) L.push(`| ${d} | ${v.PASS || 0} | ${v.WARN || 0} | ${v.FAIL || 0} | ${v.NOT_COMPUTED || 0} |`);
  L.push("", `WARN = passes, but rests on estimates or unknowns listed in the run. Gate: ${ns.sentinel.gate.accepted ? "accepted" : "NOT accepted"} (${ns.sentinel.gate.scope}).`);
  if (ns.sentinel.gate.blockers.length) L.push(...ns.sentinel.gate.blockers.map((b) => `- blocker: ${b.kind} ${b.runId || b.claim}: ${b.detail}`));
  L.push("", "Physical tests still owed:", ...ns.sentinel.gate.physicalTestsOutstanding.map((t) => `- ${t}`), "");
  L.push("### Excluded solvers", "", ...R.excludedSolvers.map((x) => `- ${x.id}: ${x.reason}`), "");
  L.push("### Stock-catalogue cross-check", "", ...ns.sentinel.catalog.map((c) => `- ${c.id}: listed ${f(c.listedKgPerM)} kg/m, computed ${f(c.computedKgPerM)} kg/m (${c.deltaPct.toFixed(1)} %)${c.flag ? ` — ${c.flag}` : ""}`), "");
  L.push("### Assumptions", "", ...R.assumptions.map((a) => `- ${a}`), "");
  L.push("### Claims that remain hypothesis or contradicted", "");
  for (const c of R.remainingClaims) L.push(`- \`${c.id}\` [${c.status.join(", ")}${c.bin ? `; ${c.bin}` : ""}]: ${(c.statement || "").slice(0, 200)}${c.notes.length ? ` — ${c.notes.join(" ")}` : ""}`);
  return L.join("\n");
}
