// server/lib/conkay/demos/blend-d-candidates.js
//
// Reruns every registered Blend D check (material.*, process.*, vessel.* solvers
// that target a formulated Material node) with the unidentified co-polymer as
// it stands and with each sourced candidate in its place (knowledge/
// copolymer-candidates.js), and renders the comparison. Nothing here sets a
// value: each cell is the solver's own envelope status and output.

import { loadFixture } from "../knowledge/index.js";
import { materialIrFromText } from "../knowledge/material-ir.js";
import { COPOLYMER_CANDIDATES, CANDIDATE_IDS, withCopolymerCandidate } from "../knowledge/copolymer-candidates.js";
import { openDesign, listSolvers } from "../index.js";

const CHECKED = /^(material|process|vessel)\./;
// The configuration the earlier Blend D items ran with: basalt fibre as the stiffness filler.
const MICRO = Object.freeze({ filler: "basalt-fiber", shape: "fibre" });
const PROCESS_C = 200;

const MBA_WINDOW = { lowC: 190, highC: 220, recommendedC: 200, source: "MBA Polymers PP 2143 TDS p.2: 'Melt Temperature Range 190-220 °C', 'Recommended Melt Temperature 200 °C'" };

function runAll(ir) {
  const s = openDesign({ nodes: [{ id: "M", kind: "Material", props: { formulation: ir, micromechanics: MICRO } }] }).session;
  const out = {};
  for (const x of listSolvers()) {
    if (!CHECKED.test(x.id)) continue;
    const r = s.result(`${x.id}@M`);
    if (r) out[x.id] = r;
  }
  return out;
}

/** The candidate's own melting against the stated 200 °C (a screen the HDPE-only process.window does not do). */
function candidateMeltScreen(id) {
  const tm = COPOLYMER_CANDIDATES[id].properties.meltTemperature;
  const lo = tm.range ? tm.range.min : tm.value, hi = tm.range ? tm.range.max : tm.value;
  const melts = hi - 273.15 < PROCESS_C;
  const window = id === "recycled-impact-pp" ? { inside: PROCESS_C >= MBA_WINDOW.lowC && PROCESS_C <= MBA_WINDOW.highC, source: MBA_WINDOW.source } : null;
  return {
    meltC: [+(lo - 273.15).toFixed(2), +(hi - 273.15).toFixed(2)], melts, claimRef: tm.id,
    window: window || { inside: null, source: "no processing window read for this candidate (not computed)" },
    degradation: "thermal stability at 200 °C is not computed: no TGA / OIT read for this candidate",
  };
}

export const BASES_TRIED = Object.freeze(["mass", "volume"]);

export function runCandidateChecks() {
  const { text, meta } = loadFixture("usb-blend-d");
  const base = materialIrFromText(text, meta);
  const runs = { unidentified: { ir: base, results: runAll(base) } };
  for (const id of CANDIDATE_IDS) {
    const ir = withCopolymerCandidate(base, id);
    runs[id] = { ir, results: runAll(ir), melt: candidateMeltScreen(id) };
  }
  // The same checks with each basis taken as given (the source states neither).
  const byBasis = {};
  for (const id of ["unidentified", ...CANDIDATE_IDS]) {
    byBasis[id] = {};
    for (const b of BASES_TRIED) {
      const ir = { ...runs[id].ir, basis: b, basisNote: `assumed ${b} for comparison: the source does not say` };
      byBasis[id][b] = runAll(ir);
    }
  }
  return { basis: base.basis, basisNote: base.basisNote, runs, byBasis };
}

const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "—");

function cell(r) {
  if (!r) return "not targeted";
  if (r.status === "NOT_COMPUTED") return `NOT_COMPUTED: ${r.reason.replace(/\|/g, "/").slice(0, 140)}${r.reason.length > 140 ? "…" : ""}`;
  const o = r.outputs || {};
  if (o.density?.value?.nominal) return `${r.status}: ${fmt(o.density.value.low)}–${fmt(o.density.value.high)} kg/m³ (nominal ${fmt(o.density.value.nominal)})`;
  const gpa = (x) => (x / 1e9).toFixed(2);
  if (o.lower?.value?.E && o.upper?.value?.E) return `${r.status}: E ${gpa(o.lower.value.E)}–${gpa(o.upper.value.E)} GPa (HS bounds)`;
  if (o.reuss?.value && o.voigt?.value) return `${r.status}: Reuss ${gpa(o.reuss.value.low)}–${gpa(o.reuss.value.high)}, Voigt ${gpa(o.voigt.value.low)}–${gpa(o.voigt.value.high)} GPa`;
  if (o.mass?.value?.residue) {
    const f = (b) => (b.notComputed ? "n/c" : `${fmt(b.low, b.low > 100 ? 0 : 1)}–${fmt(b.high, b.high > 100 ? 0 : 1)}`);
    return `${r.status}: mass ρ ${f(o.mass.value.density)}, ash ${f(o.mass.value.residue)} %; volume ρ ${f(o.volume.value.density)}, ash ${f(o.volume.value.residue)} %`;
  }
  if (o.volumeFractions?.value) {
    const v = o.volumeFractions.value["hdpe-hc-co-polymer"];
    return v ? `${r.status}: co-polymer ${fmt(v.min, 2)}–${fmt(v.max, 2)} vol % (nominal ${fmt(v.pct, 2)})` : r.status;
  }
  return r.status;
}

export function renderCandidateReport(run = runCandidateChecks()) {
  const ids = ["unidentified", ...CANDIDATE_IDS];
  const lines = [];
  const p = (s = "") => lines.push(s);
  p("# USB Blend D — co-polymer candidates");
  p();
  p("The source names an 'HDPE/HC co-polymer' (10–15 %) without identifying it. Dutch (2026-10-16) targets discarded plastics and asked for two candidates in its place, each with sourced properties, and every Blend D check rerun for each. A candidate is a what-if: the source still does not say what the co-polymer is.");
  p();
  p(`Basis: **${run.basis}** — ${run.basisNote || "stated"}. Still needed from Dutch: whether the percentages are by weight or by volume. Until then the checks read them as mass fractions and say so on every result that depends on it.`);
  p();
  p("## Candidates");
  p();
  for (const id of CANDIDATE_IDS) {
    const c = COPOLYMER_CANDIDATES[id];
    p(`### ${c.rank}: ${c.label}`);
    p();
    p(`Feedstock: ${c.feedstock}.`);
    p();
    p("| Property | Span | Sources | Notes |");
    p("|---|---|---|---|");
    for (const [k, cl] of Object.entries(c.properties)) {
      const lo = cl.range ? cl.range.min : cl.value, hi = cl.range ? cl.range.max : cl.value;
      const v = cl.unit === "Pa" ? `${fmt(lo / 1e6, 1)}–${fmt(hi / 1e6, 1)} MPa` : cl.unit === "K" ? `${fmt(lo - 273.15, 1)}–${fmt(hi - 273.15, 1)} °C` : cl.unit === "kg/m3" ? `${fmt(lo)}–${fmt(hi)} kg/m³` : `${lo}–${hi}`;
      p(`| ${k} | ${v} | ${cl.evidence.map((e) => e.document).join(", ")} | ${(cl.notes || []).join(" ").replace(/\|/g, "/")}${cl.flags?.length ? ` Flags: ${cl.flags.join(", ")}.` : ""} |`);
    }
    p();
    p(`Unknown (checks that need these are NOT_COMPUTED): ${c.unknown}.`);
    p();
    p(`Variability: ${c.variability}`);
    p();
  }
  p("## Every Blend D check, rerun");
  p();
  p(`Material node with the formulation and props.micromechanics = ${JSON.stringify(MICRO)} (as in the earlier Blend D items). The vessel structure checks (vessel.hoop-stress, burst-margin, crash-seal-screen) target a chamber node, not the material, and read the wall's strength, which no candidate supplies; they are unchanged.`);
  p();
  p(`| Check | ${ids.join(" | ")} |`);
  p(`|---|${ids.map(() => "---").join("|")}|`);
  const checks = Object.keys(run.runs.unidentified.results);
  for (const id of checks) p(`| \`${id}\` | ${ids.map((r) => cell(run.runs[r].results[id])).join(" | ")} |`);
  p();
  p("## Weight or volume: every check under each reading");
  p();
  p("The source does not say. Each case below is run twice, with the percentages taken as mass and as volume fractions. Neither reading can be called correct from the text: the source states no density, ash content or other measured value to check against. What decides it is a measurement on a batch; material.basis-discriminator names it.");
  p();
  const cols = [];
  for (const id of ["unidentified", ...CANDIDATE_IDS]) for (const b of BASES_TRIED) cols.push([id, b]);
  p(`| Check | ${cols.map(([i, b]) => `${i} (${b})`).join(" | ")} |`);
  p(`|---|${cols.map(() => "---").join("|")}|`);
  for (const id of Object.keys(run.byBasis.unidentified.mass)) p(`| \`${id}\` | ${cols.map(([i, b]) => cell(run.byBasis[i][b][id])).join(" | ")} |`);
  p();
  const disc = run.byBasis["recycled-impact-pp"].mass["material.basis-discriminator"];
  if (disc?.outputs?.decidingTests?.value) {
    p("Deciding measurements (recycled impact PP case; the EVA case is within a few kg/m³ and tenths of a percent):");
    p();
    for (const t of disc.outputs.decidingTests.value) p(`- ${t}`);
    p();
  }
  p("## Candidate melting against the stated 200 °C");
  p();
  p("process.window checks the HDPE matrix only. This screen adds the candidate's own melting point; it does not check thermal degradation.");
  p();
  for (const id of CANDIDATE_IDS) {
    const m = run.runs[id].melt;
    p(`- ${id}: melting ${m.meltC[0]}–${m.meltC[1]} °C (${m.claimRef}) → ${m.melts ? "molten" : "NOT molten"} at 200 °C. Processing window: ${m.window.inside === null ? m.window.source : `${m.window.inside ? "inside" : "outside"} — ${m.window.source}`}. ${m.degradation}.`);
  }
  p();
  p("## What changed and what did not");
  p();
  p("- With either candidate the strict rule-of-mixtures density and the mass-to-volume fractions are computed (they were NOT_COMPUTED for want of the co-polymer's density). Both remain estimates: no voids, and the basis as stated (unknown, read as mass) unless a column above says otherwise.");
  p("- Stiffness, strength, conductivity and CTE models stay NOT_COMPUTED: CaCO3 and silica have no cited modulus, and the two-phase models do not cover six constituents. A candidate does not change that.");
  p("- Viscoelastic, hydrogen, compatibility and thermal-transition checks read the HDPE matrix or need compound tests; the candidate adds no data to them, and the compatibility table does not cover either candidate.");
  p("- Nothing here is a measurement of a Blend D batch. Measure the lot: ASTM D792, D638/D790, D1238, D3418.");
  p();
  return lines.join("\n");
}
