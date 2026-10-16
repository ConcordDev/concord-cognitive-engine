// server/domains/silver.js
//
// Universal Silver registry, read-only (phase 1). Every compute surface the
// server has (ConKay solvers, Runtime capabilities, LENS_ACTIONS + MACROS)
// scored against the Silver solver contract, from the live maps of THIS
// process. Nothing here runs a solver, writes state or promotes anything.
//
//   silver.summary   counts, per-field coverage per source, promotion candidates
//   silver.entries   filtered entries { source?, domain?, field?, state?, candidate?, offset?, limit? }
//   silver.entry     one entry { key } (e.g. "macro:chem.molecular-weight", "conkay:structure.frame")

import { buildSilverRegistry, collectLiveSources } from "../lib/silver/registry.js";
import { isPromotionCandidate } from "../lib/silver/contract.js";

const TTL_MS = 60_000;
let cache = null;

async function registry() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.reg;
  const reg = buildSilverRegistry(await collectLiveSources());
  cache = { at: Date.now(), reg };
  return reg;
}

export default function registerSilverActions(registerLensAction) {
  registerLensAction("silver", "summary", async () => {
    try {
      const r = await registry();
      return { ok: true, result: { contractVersion: r.contractVersion, fields: r.fields, summary: r.summary } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("silver", "entries", async (_ctx, _artifact, params = {}) => {
    try {
      const r = await registry();
      const { source, domain, field, state, candidate } = params || {};
      const offset = Math.max(0, Number.isInteger(params?.offset) ? params.offset : 0);
      const limit = Math.min(500, Math.max(1, Number.isInteger(params?.limit) ? params.limit : 100));
      if (state && !field) return { ok: false, error: "state filter needs a field" };
      let rows = r.entries;
      if (source) rows = rows.filter((e) => e.source === source);
      if (domain) rows = rows.filter((e) => e.domain === domain);
      if (field && state) rows = rows.filter((e) => e.fields[field] === state);
      if (candidate === true) rows = rows.filter(isPromotionCandidate);
      return { ok: true, result: { total: rows.length, offset, limit, entries: rows.slice(offset, offset + limit) } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("silver", "entry", async (_ctx, _artifact, params = {}) => {
    const key = typeof params?.key === "string" ? params.key : "";
    if (!key) return { ok: false, error: "key required (e.g. \"conkay:structure.frame\" or \"macro:chem.molecular-weight\")" };
    try {
      const e = (await registry()).entries.find((x) => x.key === key);
      return e ? { ok: true, result: e } : { ok: false, error: `no registry entry ${key}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
