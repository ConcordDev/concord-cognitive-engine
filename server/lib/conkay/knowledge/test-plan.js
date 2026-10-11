// server/lib/conkay/knowledge/test-plan.js
//
// Test plan: what to measure, by which verified standard, to settle each
// claim that isn't supported. When data are missing the layer produces this
// plan instead of a number. One item per property; each item lists every
// claim it would settle. Characterisation items (identify what is being
// tested, check the batch matches the version) are always included for a
// formulation, because no property result means anything without them.

import { PROPERTIES, testsFor } from "./properties.js";

const PRIORITY = {
  composition_verification: "P0 prerequisite", melt_flow_rate: "P0 prerequisite", thermal_transitions: "P0 prerequisite",
  processing_temperature: "P0 prerequisite", density: "P0 prerequisite",
  hydrogen_permeability: "P1 safety-critical", hydrogen_compatibility: "P1 safety-critical",
  vessel_containment: "P1 safety-critical", pressure_containment: "P1 safety-critical",
};
const ORDER = ["P0 prerequisite", "P1 safety-critical", "P2 performance"];

const ACCEPTANCE = {
  hydrogen_permeability: "No limit is stated in the source. Reference only (vessel level, not material): ISO 19881 Type IV containers < 6 NmL/(h·L) at NWP and 15 °C, < 46 NmL/(h·L) at 1.15 NWP and 55 °C.",
  composition_verification: "Measured inorganic residue must match the formulation version's basalt + CaCO3 + silica loading within an agreed tolerance (none stated yet).",
  density: "Replaces the rule-of-mixtures estimate; the difference from the estimate indicates void content.",
};

export const ALWAYS = ["composition_verification", "melt_flow_rate", "thermal_transitions", "density"];

/**
 * claims: Claim[]; ctx: { formulationVersion, processVersion }.
 * Returns { items, unsupportedClaims, excluded }.
 */
export function buildTestPlan(claims, ctx = {}) {
  const byProp = new Map();
  const add = (p, claimId) => {
    if (!PROPERTIES[p]) return;
    if (!byProp.has(p)) byProp.set(p, new Set());
    if (claimId) byProp.get(p).add(claimId);
  };
  const needing = claims.filter((c) => c.support !== "supported" && c.support !== "not_applicable");
  const excluded = [];
  for (const c of needing) {
    const tests = (c.requiredEvidence || []).filter((r) => r.kind === "test" && r.property);
    if (!tests.length) { excluded.push({ claim: c.id, reason: (c.requiredEvidence || []).map((r) => r.reason).join("; ") || "no test applies" }); continue; }
    for (const r of tests) add(r.property, c.id);
  }
  for (const p of ALWAYS) add(p, null);
  const items = [...byProp.entries()].map(([p, ids]) => {
    const def = PROPERTIES[p];
    return {
      id: `test:${p}`,
      property: p,
      label: def.label,
      priority: PRIORITY[p] || "P2 performance",
      scope: def.scope || "material",
      tests: testsFor(p),
      conditionsToRecord: def.requiredConditions,
      specimens: `moulded from formulation ${ctx.formulationVersion || "(version)"} with process ${ctx.processVersion || "(process version)"}; record batch, supplier lots and deviations`,
      acceptance: ACCEPTANCE[p] || "Not stated in the source; set it from the intended use before testing.",
      settles: [...ids].sort(),
    };
  });
  items.sort((a, b) => ORDER.indexOf(a.priority) - ORDER.indexOf(b.priority) || a.property.localeCompare(b.property));
  return { items, unsupportedClaims: needing.map((c) => c.id), excluded };
}
