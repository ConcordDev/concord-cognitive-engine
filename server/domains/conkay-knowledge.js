// server/domains/conkay-knowledge.js
//
// Lens actions for the ConKay knowledge layer (lib/conkay/knowledge). Pure
// and deterministic: no database, no network, no model. Nothing is stored.
//
//   conkay_knowledge.formulation-report { fixture } | { text, name? }
//                                         → source record, proposed version,
//                                           composition checks, computed
//                                           claims + receipts, unsupported
//                                           claims, flags, test plan, markdown
//   conkay_knowledge.schema   {}          → entity + claim JSON Schema, status
//                                           flags, discipline extensions
//   conkay_knowledge.validate { record }  → schema + claim-rule + extension check
//   conkay_knowledge.fixtures {}          → built-in source texts
//   conkay_knowledge.mixture-report {}    → demo 2: methanol-water resolved through the PubChem and NIST
//                                           WebBook connectors (recorded excerpts, no network), computed
//                                           as far as the evidence goes; unknowns, test plan, review queue

import {
  buildFormulationReport, renderFormulationMarkdown, loadFixture, FIXTURES,
  ENTITY_SCHEMA, STATUS_FLAGS, SUPPORT_STATES, listExtensions, validateEntity, STANDARDS,
  mixtureReport, renderMixtureMarkdown, replayGetter, loadConnectorRecordings,
} from "../lib/conkay/knowledge/index.js";

const MAX_TEXT = 20000;

export default function registerConkayKnowledgeActions(registerLensAction) {
  registerLensAction("conkay_knowledge", "formulation-report", (_ctx, _artifact, params) => {
    let text;
    let meta;
    if (typeof params?.fixture === "string") {
      const f = loadFixture(params.fixture);
      if (!f) return { ok: false, error: `no fixture "${params.fixture}" (have: ${Object.keys(FIXTURES).join(", ")})` };
      ({ text, meta } = f);
    } else if (typeof params?.text === "string" && params.text.trim()) {
      if (params.text.length > MAX_TEXT) return { ok: false, error: `text is longer than ${MAX_TEXT} characters` };
      text = params.text;
      meta = { slug: typeof params.name === "string" ? params.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || undefined : undefined };
    } else {
      return { ok: false, error: "send { fixture } or { text }" };
    }
    const report = buildFormulationReport(text, meta);
    if (!report.source.composition.ingredients.length) return { ok: false, error: "no ingredient lines found (expected lines like '- Name: 10-15% — note')" };
    return { ok: true, result: { report, markdown: renderFormulationMarkdown(report) } };
  });

  registerLensAction("conkay_knowledge", "schema", () => ({
    ok: true,
    result: { entity: ENTITY_SCHEMA, statusFlags: STATUS_FLAGS, supportStates: SUPPORT_STATES, extensions: listExtensions(), standards: STANDARDS },
  }));

  registerLensAction("conkay_knowledge", "validate", (_ctx, _artifact, params) => {
    if (!params?.record || typeof params.record !== "object") return { ok: false, error: "send { record }" };
    return { ok: true, result: validateEntity(params.record) };
  });

  registerLensAction("conkay_knowledge", "mixture-report", async () => {
    const rec = await loadConnectorRecordings();
    const report = await mixtureReport(replayGetter(rec.recordings));
    if (!report.ok) return { ok: false, error: report.reason };
    return { ok: true, result: { recordedOn: rec.captured, report, markdown: renderMixtureMarkdown(report) } };
  });

  registerLensAction("conkay_knowledge", "fixtures", () => ({ ok: true, result: { fixtures: Object.keys(FIXTURES) } }));
}
