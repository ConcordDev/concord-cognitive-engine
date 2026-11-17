// server/lib/conkay/physics/solvers/refdata-lookup.js
//
// refdata.lookup — SX-XC-03 (ConKay solver catalogue, Wave 0).
//
// The solver-facing consumer of the SXE-41 reference-data store.
// A value is accepted ONLY when the store's literal re-find locates
// it in the record's content at the locator: the caller names a
// record (by store id or by sourceUrl) and the literal it expects
// the source to contain; the lookup re-finds the literal in the
// stored content and returns the record's provenance beside it.
//
//   - literal found     → PASS with {found, occurrences, sha256,
//                          sourceUrl, licence, retrievedAt}
//   - literal absent    → NOT_COMPUTED refdata_value_not_found
//                          (a forged value at a real locator is
//                          rejected, never served)
//   - record absent     → NOT_COMPUTED refdata_not_found
//   - no record named   → NOT_COMPUTED missing_input (SC-03)
//
// The store is the SXE-41 module (server/lib/conkay/refdata/): every
// record it holds carries provenance by construction, so a served
// value always rides with its source. The template's
// engine_unavailable leg maps here to record absence: this tier is
// in-process, and an absent record is the honest NOT_COMPUTED.

import { registerSolver } from "../registry.js";
import { refdataStore } from "../../refdata/index.js";

/** Resolve a record by store id, falling back to a sourceUrl scan. */
export function findRecord(store, { recordId, sourceUrl }) {
  if (recordId) {
    const got = store.get(recordId); // SXE-41 get returns {record, content}
    if (got) return got.record;
  }
  if (sourceUrl) {
    return store.list().find((r) => r.sourceUrl === sourceUrl) || null;
  }
  return null;
}

export function lookupRun(ctx, target, store = refdataStore()) {
  const inputs = ctx?.inputs || {};
  const { recordId, sourceUrl, literal } = inputs;
  if (!recordId && !sourceUrl) {
    return { notComputed: "missing_input:recordId or sourceUrl required (SC-03: no record assumed)" };
  }
  if (literal == null || literal === "") {
    return { notComputed: "missing_input:literal (the value to re-find must be named)" };
  }
  const rec = findRecord(store, { recordId, sourceUrl });
  if (!rec) {
    return { notComputed: `refdata_not_found:${recordId || sourceUrl}` };
  }
  const hit = store.refind(rec.id, String(literal));
  if (!hit.found) {
    return {
      notComputed:
        `refdata_value_not_found: literal not present in record ${rec.id} ` +
        `(source ${rec.sourceUrl}); a value is accepted only when re-found at its locator`,
    };
  }
  return {
    inputs: { recordId: rec.id, sourceUrl: rec.sourceUrl, literal: String(literal) },
    outputs: {
      found: true,
      occurrences: hit.occurrences,
      value: String(literal),
      sha256: rec.sha256,
      sourceUrl: rec.sourceUrl,
      licence: rec.licence,
      retrievedAt: rec.retrievedAt,
      retrievedVia: rec.retrievedVia,
      provenance: `${rec.sourceUrl} (${rec.licence}), retrieved ${rec.retrievedAt} via ${rec.retrievedVia}`,
    },
    margins: [],
    covers: [target],
  };
}

export const refdataLookup = registerSolver({
  id: "refdata.lookup",
  version: "1.0.0",
  domain: "reference-data",
  domains: ["reference-data", "conkay"],
  fidelity: 1,
  method: "provenance store lookup; a value is accepted only when a matcher re-finds it literally in the stored record (SXE-41 re-find)",
  reference: "all sources in SXE-41 (the store's provenance records are the citations)",
  regime: "sourced records only — what the SXE-41 store holds, nothing else",
  units: { inputs: "recordId or sourceUrl, literal string", outputs: "re-find verdict + the record's provenance" },
  tolerance: "exact literal match (occurrence count reported)",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: (ctx, target) => lookupRun(ctx, target),
});
