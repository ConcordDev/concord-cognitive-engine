// server/domains/dtu-portability.js
//
// Phase 6b — macros: export user's DTU corpus + validate/import envelope.

import {
  exportUserCorpus,
  validateEnvelope,
  importEnvelope,
} from "../lib/dtu-portability.js";

export default function registerDtuPortabilityMacros(register) {
  // `error` mirrors `reason` on every early-return failure below (added,
  // not replacing `reason`) so the frontend `lensRun()` helper — which
  // discards everything but a top-level `error` string when a macro
  // returns `{ok:false, ...}` — still surfaces the real cause instead of
  // its generic "lens error" fallback text.
  register("dtu_portability", "export", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db", error: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor", error: "no_actor" };
    return exportUserCorpus(db, userId, {
      includeEconomy: input.includeEconomy !== false,
      includeAttachments: input.includeAttachments === true,
      limit: input.limit,
    });
  }, { note: "pack user's DTU corpus into a transportable envelope (set includeAttachments:true to inline file bytes)" });

  register("dtu_portability", "validate", async (_ctx, input = {}) => {
    return validateEnvelope(input.envelope);
  }, { note: "validate an envelope's integrity (no DB writes)" });

  register("dtu_portability", "import", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db", error: "no_db" };
    return await importEnvelope(db, input.envelope, {
      importCitations: input.importCitations !== false,
      importAttachments: input.importAttachments !== false,
    });
  }, { note: "import an envelope (idempotent on dtu.id, attachments restored to artifact-store)" });
}
