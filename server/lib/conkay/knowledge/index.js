// server/lib/conkay/knowledge/index.js
//
// ConKay knowledge layer: universal entity / Property-as-Claim schema, the
// formulation engine, the claim analyzer and test-plan generator.
// Plan: ~/.zuko/remaining-work/CONKAY-UNIVERSAL-KNOWLEDGE-LAYER-2026-10-09.md
//
// North star: deterministic computation only, and an absent value is never
// turned into a fact. Nothing in here calls a model; the connectors reach the
// network only through a getter they are given (the server and the tests use
// recorded excerpts; scripts/conkay-capture-knowledge.mjs captures them live).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export { ENTITY_SCHEMA, CLAIM_SCHEMA, SCHEMA_VERSION, STATUS_FLAGS, SUPPORT_STATES, ENTITY_KINDS, CLAIM_BINS, EXCLUSIVE_STATUSES, validateEntityShape, validateClaimShape } from "./schema.js";
export { validateClaim, makeClaim, promotionGate } from "./claims.js";
export { parseSpecMarkdown, summarizeSpec } from "./spec-parser.js";
export { validateEntity } from "./validate.js";
export { registerExtension, listExtensions, validateExtensions } from "./extensions/index.js";
export { parseFormulationText, sourceFormulation, checkComposition, proposeVersion, processVersion, uniformRangePosition } from "./formulation.js";
export { ruleOfMixturesDensity, mixtureDensity } from "./rule-of-mixtures.js";
export { buildTestPlan } from "./test-plan.js";
export { renderLabPlan, LAB_PLAN_VERSION, SPECIMEN_MINIMUM } from "./lab-plan.js";
export { buildFormulationReport, renderFormulationMarkdown } from "./formulation-report.js";
export { SOURCES, DOCUMENTS, CONNECTOR_DUTIES } from "./sources.js";
export { STANDARDS } from "./standards.js";
export { PROPERTIES } from "./properties.js";
export * as units from "./units.js";
export { liveGetter, replayGetter, EvidenceStore, documentEvidence } from "./connectors/fetcher.js";
export { identify as pubchemIdentify, experimental as pubchemExperimental, resolveName as pubchemResolveName, pubchemUrls } from "./connectors/pubchem.js";
export { isobar as nistIsobar, NIST_FLUIDS, NIST_UNCERTAINTY, nistUrls } from "./connectors/nist-webbook.js";
export { checkClaims, crossCheckDensities, selectReference, REVIEW_DECISION } from "./connectors/review.js";
export { mixtureReport, renderMixtureMarkdown, DEMO2 } from "./connectors/mixture.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Built-in fixtures (verbatim source texts). */
export const FIXTURES = {
  "usb-blend-d": { file: "usb-blend-d.txt", author: "Dutch (Ramaj)", date: "2026-09-05", document: "~/.zuko/usb-formulas/blend-d-viscoelastic.md (as relayed 2026-10-09)" },
  "sentinel-ram-spec-r1": { file: "sentinel-ram-spec-rev1.0.md", author: "Dutch (Ramaj)", date: "2026-10-09", document: "SENTINEL / RAM — Physics-Grounded Engineering Specification rev 1.0 (~/.zuko/remaining-work/SENTINEL-RAM-SPEC-2026-10-09.md), sha256 986817b3c27d840974f0969d2f1a5686f99ba0aa3065159822acfc5bca35419a" },
};

export function loadFixture(id) {
  const f = FIXTURES[id];
  if (!f) return null;
  return { text: readFileSync(path.join(HERE, "fixtures", f.file), "utf8"), meta: { fixture: id, slug: id, author: f.author, date: f.date, document: f.document } };
}

/** Recorded connector responses (excerpts + full-response hashes) for the offline demo and tests. */
export async function loadConnectorRecordings() {
  const { readFile } = await import("node:fs/promises");
  return JSON.parse(await readFile(path.join(HERE, "fixtures", "connector-recordings.json"), "utf8"));
}
