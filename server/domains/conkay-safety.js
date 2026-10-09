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

import "../lib/conkay/index.js";
import { runSafetyCaseDemo, renderSafetyCaseMarkdown, minimalCutSets, verifyChain, BANNER } from "../lib/conkay/safety-case/index.js";

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

  registerLensAction("conkay_safety", "verify-log", (_ctx, _artifact, params) => {
    if (!Array.isArray(params?.entries)) return { ok: false, error: "send { entries }" };
    return { ok: true, result: verifyChain(params.entries) };
  });
}
