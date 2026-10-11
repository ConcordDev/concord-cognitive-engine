// server/lib/conkay/knowledge/claim-rules.js
//
// Deterministic claim classification: a curated table of phrases → the
// properties a statement is about. No LLM, no inference beyond these
// patterns. A statement that matches nothing is NOT dropped: it becomes an
// unclassified claim flagged for human review. Extend the table, don't guess.

export const RULES = [
  { id: "impact", re: /\bimpact\b|bends not breaks|rather than cracking|absorbs energy|\bcrash\b/i, properties: ["impact_resistance"] },
  { id: "recovery", re: /viscoelastic|returns to shape|springs back|\bdeforms?\b/i, properties: ["viscoelastic_recovery"] },
  { id: "tensile", re: /tensile|brittle|structural integrity|rigid|strong until fracture/i, properties: ["tensile_properties"] },
  { id: "pressure", re: /pressure resistance/i, properties: ["pressure_containment"] },
  { id: "hardness", re: /hardness/i, properties: ["surface_hardness"] },
  { id: "containment", re: /stays contained|seal integrity/i, properties: ["hydrogen_permeability", "vessel_containment"] },
  { id: "h2-compat", re: /resist\w*[^.]*\bhydrogen\b|\bfuel contact\b|degradation/i, properties: ["hydrogen_compatibility"] },
  { id: "saltwater", re: /salt ?water|seawater/i, properties: ["saltwater_resistance"] },
  { id: "thermal", re: /thermal conductivity|heat dissipation/i, properties: ["thermal_conductivity"] },
  { id: "composition", re: /more polymer|less aggregate|polymer ratio/i, properties: ["composition_verification"] },
  { id: "uv", re: /\bUV\b|weather/i, properties: ["uv_weathering"] },
];

/** Statements whose subject is a material class in general, not this formulation. */
export const GENERIC_SUBJECT = /^(aggregates?|polymers?|fillers?)\b/i;

/** Statements that compare with another formulation by name. */
export const COMPARISON = /marine (?:blend|spec)/i;

/** Vague wording that names no measurable property. */
export const VAGUE = [
  { re: /structural integrity/i, note: "'structural integrity' is not a measurable property; mapped to tensile properties, needs a stated requirement" },
  { re: /splitting cycles/i, note: "'splitting cycles' is an undefined operating condition (temperature, duration, heat flux?)" },
];

/** Properties a statement is about (ordered, unique). */
export function classify(text) {
  const out = [];
  for (const r of RULES) if (r.re.test(text)) for (const p of r.properties) if (!out.includes(p)) out.push(p);
  return out;
}
