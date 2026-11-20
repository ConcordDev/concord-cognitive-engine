// server/lib/dtu-publish-gate.js
//
// What has to be true before a DTU goes public. One function, called by every
// publish path (the public lattice publish and the marketplace listing), so a
// rule can't be skipped by publishing a different way.
//
//   - Personal context and system rows are never published by accident.
//   - Knowledge and claimed-empirical DTUs need a current check receipt from
//     the verification gate (lib/verify-gate): checked against the text as it
//     stands now (body hash), not refuted, not still pending; and an empirical
//     claim must cite at least one outside source, not only other DTUs.
//   - Everything else (works, specs, documents) publishes as before.
//
// The receipt itself is written by dtus.card-check; this module only reads it.

import { createHash } from "node:crypto";
import { candidateOf } from "./verify-gate/service.js";
import { collectWebSources } from "./dtu-grounding.js";
import { shelfOf, needsPublishCheck } from "./dtu-shelf.js";

export const bodyHashOf = (dtu) => createHash("sha256").update(String(candidateOf(dtu).body || "")).digest("hex");

/** The receipt, if it was made for the DTU's current text. */
export function currentReceipt(dtu) {
  const v = dtu?.meta?.verification;
  if (!v || !v.outcome) return null;
  return v.bodyHash && v.bodyHash === bodyHashOf(dtu) ? v : null;
}

/**
 * @returns {null | { error: string, message: string }} null when the DTU may be published
 */
export function publishGateDenial(dtu) {
  if (!dtu) return { error: "not_found", message: "DTU not found." };
  const s = shelfOf(dtu);
  if (s.shelf === "system") return { error: "private_shelf", message: `This is ${s.reason}; system rows are not published.` };
  if (s.shelf === "records" && s.reason === "personal context") return { error: "private_shelf", message: "This is personal context (chat memory, notes, records); it is not published." };
  if (!needsPublishCheck(dtu)) return null;
  const v = currentReceipt(dtu);
  if (!v) return { error: "check_required", message: "Knowledge is checked before it is published. Run the check on its current text first." };
  if (v.outcome === "REFUTED") return { error: "refuted", message: "A claim in it was shown false. Fix it and check again." };
  if (v.outcome === "PENDING") return { error: "check_pending", message: "A checker is unavailable right now; the check has not finished." };
  if (s.kind === "empirical" && collectWebSources(dtu).length === 0) {
    return { error: "no_outside_source", message: "An empirical claim needs at least one outside source (a link), not only other DTUs." };
  }
  return null;
}
