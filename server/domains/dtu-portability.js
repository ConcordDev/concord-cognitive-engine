// server/domains/dtu-portability.js
//
// Phase 6b — macros: export user's DTU corpus + validate/import envelope.

import {
  exportUserCorpus,
  validateEnvelope,
  importEnvelope,
} from "../lib/dtu-portability.js";

export default function registerDtuPortabilityMacros(register) {
  register("dtu_portability", "export", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return exportUserCorpus(db, userId, {
      includeEconomy: input.includeEconomy !== false,
      limit: input.limit,
    });
  }, { note: "pack user's DTU corpus into a transportable envelope" });

  register("dtu_portability", "validate", async (_ctx, input = {}) => {
    return validateEnvelope(input.envelope);
  }, { note: "validate an envelope's integrity (no DB writes)" });

  register("dtu_portability", "import", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return importEnvelope(db, input.envelope, {
      importCitations: input.importCitations !== false,
    });
  }, { note: "import an envelope (idempotent on dtu.id)" });
}
