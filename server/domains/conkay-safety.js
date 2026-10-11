// server/domains/conkay-safety.js
//
// Lens actions for the ConKay safety-case layer (lib/conkay/safety-case).
// Pure and deterministic: no database, no network, no model; nothing stored.
// Screening only: every result carries the banner, and no output status is
// ever a safety determination.
//
//   conkay_safety.case-report {}        → generic demo: requirements completeness,
//                                         findings with paths, order-≤2 cut sets,
//                                         proposals (pending human decision),
//                                         open items, sign-offs needed, markdown
//   conkay_safety.cut-sets { ft, top, maxOrder? } → minimal cut sets of a coherent fault tree
//   conkay_safety.verify-log { entries } → hash-chain check of an exported change log
//   conkay_safety.quantify { ft, top, p, maxOrder? } → cut sets, rare-event, min-cut upper bound, exact (BDD)
//                                         probability and exact importance measures (FV, RAW, RRW, Birnbaum)
//   conkay_safety.pra-demo { samples?, seed? } → Phase 2 toy LOOP / LOCHS event trees on NUREG/CR-6928 2020
//                                         data: sequences, uncertainty, importance, data trail, gaps, markdown
//   conkay_safety.facility-us600 { modules? } → Phase 3 facility SSC skeleton of the NRC-certified NuScale US600
//                                         (public sources only), Phase 1 screen + cross-system checks + Phase 2
//                                         link, review queue, markdown
//   conkay_safety.facility-us600-drawing { modules? } → schematic plant GA (plan + section A-A, SSC register, FSAR gap
//                                         pull list) from the same model; revision = model hash; unknowns not drawn

import "../lib/conkay/index.js";
import { runSafetyCaseDemo, renderSafetyCaseMarkdown, minimalCutSets, verifyChain, BANNER, quantifyTree, importance, runPraDemo, renderPraMarkdown, buildUS600Facility, runFacilityScreen, renderFacilityMarkdown, drawFacility } from "../lib/conkay/safety-case/index.js";
import { toSvg } from "../lib/conkay/drawings/sheet.js";

export default function registerConkaySafetyActions(registerLensAction) {
  registerLensAction("conkay_safety", "case-report", () => {
    const r = runSafetyCaseDemo();
    if (!r.ok) return { ok: false, error: r.errors.join("; "), banner: BANNER };
    return { ok: true, result: { banner: BANNER, report: r, markdown: renderSafetyCaseMarkdown(r) } };
  });

  registerLensAction("conkay_safety", "cut-sets", (_ctx, _artifact, params) => {
    if (!params?.ft?.gates || typeof params.top !== "string") return { ok: false, error: "send { ft: { gates }, top, maxOrder? }" };
    try {
      const maxOrder = Number.isInteger(params.maxOrder) && params.maxOrder > 0 ? params.maxOrder : Infinity;
      return { ok: true, result: { banner: BANNER, cutSets: minimalCutSets(params.ft, params.top, { maxOrder }) } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  registerLensAction("conkay_safety", "quantify", (_ctx, _artifact, params) => {
    if (!params?.ft?.gates || typeof params.top !== "string" || !params.p || typeof params.p !== "object") return { ok: false, error: "send { ft: { gates }, top, p: { event: probability }, maxOrder? }" };
    try {
      const maxOrder = Number.isInteger(params.maxOrder) && params.maxOrder > 0 ? params.maxOrder : Infinity;
      const q = quantifyTree(params.ft, params.top, params.p, { maxOrder });
      return { ok: true, result: { banner: BANNER, ...q, importance: importance(params.ft, params.top, params.p) } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  registerLensAction("conkay_safety", "pra-demo", (_ctx, _artifact, params) => {
    const samples = Number.isInteger(params?.samples) && params.samples > 0 && params.samples <= 50000 ? params.samples : 4000;
    const r = runPraDemo({ samples, seed: typeof params?.seed === "string" ? params.seed : "conkay-pra-demo" });
    return { ok: true, result: { ...r, markdown: renderPraMarkdown(r) } };
  });

  registerLensAction("conkay_safety", "facility-us600", (_ctx, _artifact, params) => {
    const modules = Number.isInteger(params?.modules) ? params.modules : 12;
    if (modules < 1 || modules > 12) return { ok: false, error: "modules must be 1..12", banner: BANNER };
    const r = runFacilityScreen(buildUS600Facility({ modules }));
    if (!r.ok) return { ok: false, error: r.errors.join("; "), banner: BANNER };
    return { ok: true, result: { ...r, markdown: renderFacilityMarkdown(r) } };
  });

  registerLensAction("conkay_safety", "facility-us600-drawing", (_ctx, _artifact, params) => {
    const modules = Number.isInteger(params?.modules) ? params.modules : 12;
    if (modules < 1 || modules > 12) return { ok: false, error: "modules must be 1..12", banner: BANNER };
    const r = drawFacility(buildUS600Facility({ modules }));
    if (!r.ok) return { ok: false, error: r.errors.join("; "), banner: BANNER };
    const { _sheets, ...rest } = r;
    return { ok: true, result: { ...rest, svg: _sheets.map((s, i) => toSvg(s, { drawing: r.drawing, revision: r.revision, modelHash: r.modelHash, sheet: i + 1 })) } };
  });

  registerLensAction("conkay_safety", "verify-log", (_ctx, _artifact, params) => {
    if (!Array.isArray(params?.entries)) return { ok: false, error: "send { entries }" };
    return { ok: true, result: verifyChain(params.entries) };
  });
}
