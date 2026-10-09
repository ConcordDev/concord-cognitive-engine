// server/lib/conkay/knowledge/index.js
//
// ConKay knowledge layer: universal entity / Property-as-Claim schema, the
// formulation engine, the claim analyzer and test-plan generator.
// Plan: ~/.zuko/remaining-work/CONKAY-UNIVERSAL-KNOWLEDGE-LAYER-2026-10-09.md
//
// North star: deterministic computation only, and an absent value is never
// turned into a fact. Nothing in here calls a model or the network.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export { ENTITY_SCHEMA, CLAIM_SCHEMA, SCHEMA_VERSION, STATUS_FLAGS, SUPPORT_STATES, ENTITY_KINDS, validateEntityShape, validateClaimShape } from "./schema.js";
export { validateClaim, makeClaim } from "./claims.js";
export { validateEntity } from "./validate.js";
export { registerExtension, listExtensions, validateExtensions } from "./extensions/index.js";
export { parseFormulationText, sourceFormulation, checkComposition, proposeVersion, processVersion, uniformRangePosition } from "./formulation.js";
export { ruleOfMixturesDensity, mixtureDensity } from "./rule-of-mixtures.js";
export { buildTestPlan } from "./test-plan.js";
export { buildFormulationReport, renderFormulationMarkdown } from "./formulation-report.js";
export { SOURCES, DOCUMENTS, CONNECTOR_DUTIES } from "./sources.js";
export { STANDARDS } from "./standards.js";
export { PROPERTIES } from "./properties.js";
export * as units from "./units.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Built-in fixtures (verbatim source texts). */
export const FIXTURES = {
  "usb-blend-d": { file: "usb-blend-d.txt", author: "Dutch (Ramaj)", date: "2026-09-05", document: "~/.zuko/usb-formulas/blend-d-viscoelastic.md (as relayed 2026-10-09)" },
};

export function loadFixture(id) {
  const f = FIXTURES[id];
  if (!f) return null;
  return { text: readFileSync(path.join(HERE, "fixtures", f.file), "utf8"), meta: { fixture: id, slug: id, author: f.author, date: f.date, document: f.document } };
}
