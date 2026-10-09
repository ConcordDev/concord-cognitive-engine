// server/lib/conkay/knowledge/extensions/materials.js
//
// Materials / formulation extension: the spec's materials fields. Every
// field that matters to the composite's behaviour is explicit, and an
// unspecified one is null (not omitted), so `underspecified()` can list
// exactly what the formulation doesn't say.

const nullableStr = { type: ["string", "null"] };
const qty = { anyOf: [{ type: "object", required: ["value", "unit"], additionalProperties: false, properties: { value: { type: "number" }, unit: { type: "string" } } }, { type: "null" }] };

export const CONSTITUENT_SPEC_FIELDS = ["grade", "supplier", "variant", "particleSize", "fiberLength", "fiberDiameter", "sizing", "surfaceTreatment", "purity", "meltFlowRate"];

// Which spec fields matter for which constituent class (a fibre's length
// matters, a powder's doesn't have one).
const RELEVANT = {
  polymer: ["grade", "supplier", "meltFlowRate"],
  copolymer: ["grade", "supplier", "variant", "meltFlowRate"],
  fiber: ["grade", "supplier", "fiberLength", "fiberDiameter", "sizing"],
  mineral_filler: ["grade", "supplier", "particleSize", "surfaceTreatment", "purity"],
  nanofiller: ["grade", "supplier", "variant", "particleSize", "surfaceTreatment"],
  other: ["grade", "supplier"],
};

export const materialsExtension = {
  status: "implemented",
  description: "Materials and formulations: constituents with exact grade/variant, particle or fibre size, surface treatment, mixing order, processing temperatures, cooling/curing profile.",
  plannedFields: ["constituents", "exact fractions", "grade", "particle/fiber size", "surface treatment", "mixing order", "processing temps", "cooling/curing profile", "density", "tensile/compressive", "modulus", "impact", "creep", "fatigue", "permeability", "CTE", "chemical compatibility"],
  schema: {
    type: "object",
    required: ["constituents", "mixingOrder", "processingTemperatures", "coolingProfile", "curingProfile"],
    additionalProperties: false,
    properties: {
      polymerClass: { enum: ["thermoplastic", "thermoset", "elastomer", "unknown", null] },
      constituents: {
        type: "array",
        items: {
          type: "object",
          required: ["ingredientId", "class", ...CONSTITUENT_SPEC_FIELDS],
          additionalProperties: false,
          properties: {
            ingredientId: { type: "string", minLength: 1 },
            class: { enum: Object.keys(RELEVANT) },
            grade: nullableStr, supplier: nullableStr, variant: nullableStr,
            particleSize: qty, fiberLength: qty, fiberDiameter: qty,
            sizing: nullableStr, surfaceTreatment: nullableStr, purity: qty, meltFlowRate: qty,
          },
        },
      },
      mixingOrder: { type: ["array", "null"], items: { type: "string" } },
      processingTemperatures: { type: "array", items: { type: "object" } },
      coolingProfile: nullableStr,
      curingProfile: nullableStr,
    },
  },
  rules(data, entity) {
    const errors = [];
    const ids = new Set((entity?.composition?.ingredients || []).map((i) => i.id));
    for (const c of data.constituents || []) {
      if (ids.size && !ids.has(c.ingredientId)) errors.push(`$.extensions.materials: constituent "${c.ingredientId}" is not an ingredient of the composition`);
    }
    if (data.polymerClass === "thermoplastic" && data.curingProfile) {
      errors.push("$.extensions.materials: a thermoplastic has no curing profile; record a cooling profile instead");
    }
    return errors;
  },
};

/** List the unspecified fields that matter for each constituent, plus missing process fields. */
export function underspecified(data) {
  const out = [];
  for (const c of data?.constituents || []) {
    const missing = (RELEVANT[c.class] || RELEVANT.other).filter((f) => c[f] == null);
    if (missing.length) out.push({ ingredientId: c.ingredientId, missing });
  }
  const process = [];
  if (!data?.mixingOrder || !data.mixingOrder.length) process.push("mixingOrder");
  if (!data?.coolingProfile) process.push("coolingProfile");
  return { constituents: out, process };
}
