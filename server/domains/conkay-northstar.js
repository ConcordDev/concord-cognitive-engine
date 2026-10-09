// server/domains/conkay-northstar.js
//
// Lens actions for the ConKay north star: iterate a spec toward something
// physically buildable. Pure and deterministic: no database, no network, no
// model; nothing is stored.
//
//   conkay_northstar.ingest-spec { fixture } | { text }  → claim records with
//                                       provenance + stated status + bin
//   conkay_northstar.recheck-spec { fixture } | { text } → spec value vs ConKay
//                                       value per computed claim, contradicted
//                                       claims with law/source + calculation
//   conkay_northstar.sentinel-m1 {}   → the iterate-to-physical loop on
//                                       Sentinel Milestone 1, gate, markdown
//   conkay_northstar.verify-receipt { receipt, ir? } → still valid for this IR
//                                       and the current solver versions?

import { parseSpecMarkdown, summarizeSpec, loadFixture, FIXTURES } from "../lib/conkay/knowledge/index.js";
import { runRechecks } from "../lib/conkay/knowledge/spec-rechecks.js";
import { runNorthStar, renderNorthStarMarkdown } from "../lib/conkay/northstar/index.js";
import { buildSentinelM1IR } from "../lib/conkay/demos/sentinel-m1.js";
import { verifyReceipt } from "../lib/conkay/iterate/receipt.js";

const MAX_TEXT = 200000;

function specText(params) {
  if (typeof params?.fixture === "string") {
    const f = loadFixture(params.fixture);
    return f ? { text: f.text, sourceId: params.fixture } : { error: `no fixture "${params.fixture}" (have: ${Object.keys(FIXTURES).join(", ")})` };
  }
  if (typeof params?.text === "string" && params.text.trim()) {
    if (params.text.length > MAX_TEXT) return { error: `text is longer than ${MAX_TEXT} characters` };
    return { text: params.text, sourceId: "spec" };
  }
  return { error: "send { fixture } or { text }" };
}

export default function registerConkayNorthstarActions(registerLensAction) {
  registerLensAction("conkay_northstar", "ingest-spec", (_ctx, _artifact, params) => {
    const s = specText(params);
    if (s.error) return { ok: false, error: s.error };
    const parsed = parseSpecMarkdown(s.text, { sourceId: s.sourceId });
    return { ok: true, result: { summary: summarizeSpec(parsed), ...parsed } };
  });

  registerLensAction("conkay_northstar", "recheck-spec", (_ctx, _artifact, params) => {
    const s = specText(params);
    if (s.error) return { ok: false, error: s.error };
    const r = runRechecks(parseSpecMarkdown(s.text, { sourceId: s.sourceId }));
    return { ok: true, result: { ...r, rows: r.rows.map(({ anchorRx, ...row }) => row) } };
  });

  registerLensAction("conkay_northstar", "sentinel-m1", () => {
    const ns = runNorthStar();
    const r = ns.sentinel;
    return { ok: true, result: { report: { ...r.report, finalDesign: undefined }, gate: r.gate, catalog: r.catalog, markdown: renderNorthStarMarkdown(ns) } };
  });

  registerLensAction("conkay_northstar", "verify-receipt", (_ctx, _artifact, params) => {
    if (!params?.receipt || typeof params.receipt !== "object") return { ok: false, error: "send { receipt, ir? }" };
    return { ok: true, result: verifyReceipt(params.receipt, params.ir || buildSentinelM1IR()) };
  });
}
