// server/lib/conkay/demos/blend-d-status.js
//
// USB Blend D, every aspect: each registered check's status for the recycled-PP and EVA co-polymer candidates
// under the mass and the volume reading, the computed bands, and every NOT_COMPUTED reason mapped to the
// input that would close it and how that input is obtained. Nothing here sets a value.

import { runCandidateChecks } from "./blend-d-candidates.js";

/** Each gap: what is missing, how to get it, and the reason text it closes. Order = how much it unblocks. */
export const GAPS = Object.freeze([
  { id: "shapes", input: "filler shapes: basalt fibre length after compounding, CaCO3 and silica particle shape, co-polymer droplet morphology", obtain: "micrographs of a moulded batch (SEM / optical), fibre-length analysis of the ashed residue; supplier particle data", match: /no shape|no aspect ratio|fibre length after compounding|sphere model|spherical fillers only|platelets and fibres are not claimed|shape = sphere|this model is two-phase|no multi-filler extension|fibres and platelets use/ },
  { id: "basalt-k", input: "basalt fibre thermal conductivity (solid fibre)", obtain: "supplier data for the chosen fibre, or ASTM E1461 diffusivity on the fibre; every open value read is mineral wool's", match: /thermal conductivity for: .*basalt-fiber/ },
  { id: "copolymer", input: "the co-polymer's identity and its own data (relaxation spectrum; for EVA also k and CTE)", obtain: "name the stream/grade (Dutch's candidates: recycled impact PP, EVA); DMA (ASTM D4065/D5026) for the spectrum; ISO 22007-2 and ASTM E831 for EVA's k and CTE", match: /for: .*hdpe-hc-co-polymer|hdpe-hc-co-polymer \(|relaxation spectrum for the polymer phase|it is not treated as elastic/ },
  { id: "compound-relaxation", input: "the compound's relaxation spectrum", obtain: "DMA frequency sweep or stress relaxation of a moulded batch (ASTM D4065/D5026, D2990)", match: /no relaxation data for this compound|unfilled-HDPE series is not the compound's/ },
  { id: "strength", input: "basalt–HDPE interfacial shear strength, matrix stress at composite failure, fibre orientation factor", obtain: "single-fibre pull-out or fragmentation test; tensile test of the matrix; micrograph orientation analysis", match: /interfacial shear strength|matrix stress at composite failure|orientation factor/ },
  { id: "load-case", input: "the load case: impact strain amplitude and frequency, service frequency", obtain: "design input from the crash/impact scenario (not a material property)", match: /props\.impact\.|frequencyHz/ },
  { id: "lewis-nielsen", input: "Lewis–Nielsen shape constants A and φ_max for fibres and platelets", obtain: "Nielsen's published shape tables (not read here)", match: /Lewis–Nielsen needs|only the sphere values are cited/ },
  { id: "lab-only", input: "notched impact strength", obtain: "ASTM D256 / ISO 179 on moulded bars: no model predicts it", match: /Charpy|Izod/ },
]);

/** Every gap a reason names (one reason can name two: "no conductivity for: co-polymer, basalt"). */
export function gapsFor(reasonPart) {
  return GAPS.filter((x) => x.match.test(reasonPart));
}

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const g = (x) => fmt(x / 1e9);

function summary(id, r) {
  if (!r) return "not targeted";
  if (r.status === "NOT_COMPUTED") return "NOT_COMPUTED";
  const o = r.outputs || {};
  switch (id) {
    case "material.density-rom": return `${fmt(o.density.value.low, 0)}–${fmt(o.density.value.high, 0)} kg/m³`;
    case "material.basis-discriminator": return `ash: mass ${fmt(o.mass.value.residue.low, 1)}–${fmt(o.mass.value.residue.high, 1)} %, volume ${o.volume.value.residue.low ? `${fmt(o.volume.value.residue.low, 1)}–${fmt(o.volume.value.residue.high, 1)} %` : "n/c"}`;
    case "material.modulus-bounds": return `E Reuss ${g(o.reuss.value.low)}–${g(o.reuss.value.high)} / Voigt ${g(o.voigt.value.low)}–${g(o.voigt.value.high)} GPa`;
    case "material.modulus-hashin-shtrikman": return `E ${g(o.lower.value.E)}–${g(o.upper.value.E)} GPa`;
    case "material.cte-multiphase": return `Turner ${fmt(o.turner.value.low * 1e6, 1)}–${fmt(o.turner.value.high * 1e6, 1)} ppm/K (low for a soft matrix)${o.moriTanaka?.value ? `; MT ${fmt(o.moriTanaka.value.low * 1e6, 1)}–${fmt(o.moriTanaka.value.high * 1e6, 1)}` : ""}`;
    default: return r.status;
  }
}

export function renderStatus(run = runCandidateChecks()) {
  const cases = [["recycled-impact-pp", "mass"], ["recycled-impact-pp", "volume"], ["eva", "mass"], ["eva", "volume"]];
  const ids = Object.keys(run.byBasis["recycled-impact-pp"].mass);
  const lines = [], p = (s = "") => lines.push(s);
  p("# USB Blend D — every aspect");
  p();
  p("Each registered material, process and hydrogen check, run on Blend D with each co-polymer candidate under each reading of the percentages. A number is a model result with the stated inputs; NOT_COMPUTED names what is missing. Nothing here is a measurement of a batch.");
  p();
  p(`| Check | ${cases.map(([c, b]) => `${c} (${b})`).join(" | ")} |`);
  p(`|---|${cases.map(() => "---").join("|")}|`);
  for (const id of ids) p(`| \`${id}\` | ${cases.map(([c, b]) => summary(id, run.byBasis[c][b][id])).join(" | ")} |`);
  p();
  // gaps
  const blocked = new Map(GAPS.map((x) => [x.id, new Set()]));
  const unmapped = new Set();
  for (const [c, b] of cases) {
    for (const id of ids) {
      const r = run.byBasis[c][b][id];
      if (r?.status !== "NOT_COMPUTED") continue;
      for (const part of r.reason.split(/;\s+|\.\s+/)) {
        const t = part.trim();
        if (!t) continue;
        const gaps = gapsFor(t);
        if (gaps.length) for (const x of gaps) blocked.get(x.id).add(id); else unmapped.add(`${id}: ${t}`);
      }
    }
  }
  p("## What closes the gaps");
  p();
  p("| Missing input | How to get it | Checks it unblocks |");
  p("|---|---|---|");
  for (const x of GAPS) if (blocked.get(x.id).size) p(`| ${x.input} | ${x.obtain} | ${[...blocked.get(x.id)].map((i) => `\`${i}\``).join(", ")} |`);
  p();
  p("Also open, outside the material checks: whether the percentages are by weight or by volume (one ash test decides, material.basis-discriminator); HDPE's hydrogen-permeation activation energy for 55 °C (none found in open sources); the chamber's geometry and working pressure (vessel design).");
  p();
  return { markdown: lines.join("\n"), unmapped: [...unmapped], blocked };
}
