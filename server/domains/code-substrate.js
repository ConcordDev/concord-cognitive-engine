// server/domains/code-substrate.js
//
// Phase 7 / T2 — code-substrate macros. Surfaces:
//   code.dtu_for(path)       — return the code-artifact DTU for a given path
//   code.dtu_query({...})    — query code DTUs by tag / kind
//   code.cluster_for(tag)    — return the cluster MEGA for a domain_tag
//   code.refresh()           — re-emit the code-artifact DTU set
//
// Read-only macros for HUD / repair-cortex / cartograph reasoning.

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  emitCodeDtus,
  getCodeDtuForPath,
  queryCodeDtus,
} from "../lib/code-substrate/code-dtu-emitter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");

export default function registerCodeSubstrateMacros(register) {
  register("code", "dtu_for", async (ctx, input = {}) => {
    if (!input?.path) return { ok: false, reason: "path_required" };
    if (!ctx?.db) return { ok: false, reason: "no_db" };
    const dtu = getCodeDtuForPath(ctx.db, input.path);
    return { ok: true, dtu };
  }, { note: "fetch a code-artifact DTU by path" });

  register("code", "dtu_query", async (ctx, input = {}) => {
    if (!ctx?.db) return { ok: false, reason: "no_db" };
    const rows = queryCodeDtus(ctx.db, {
      tag: input.tag,
      artifactKind: input.kind || input.artifactKind,
      limit: Math.min(input.limit || 100, 1000),
    });
    return { ok: true, count: rows.length, rows: rows.slice(0, 200) };
  }, { note: "query code DTUs by tag / kind" });

  register("code", "cluster_for", async (ctx, input = {}) => {
    if (!ctx?.db) return { ok: false, reason: "no_db" };
    if (!input?.tag) return { ok: false, reason: "tag_required" };
    const rows = queryCodeDtus(ctx.db, { tag: input.tag, limit: 1000 });
    return {
      ok: true,
      cluster: input.tag,
      memberCount: rows.length,
      members: rows.slice(0, 200),
    };
  }, { note: "list members of a code-substrate cluster" });

  register("code", "refresh", async (ctx, _input = {}) => {
    if (!ctx?.db) return { ok: false, reason: "no_db" };
    const r = await emitCodeDtus(ctx.db, REPO_ROOT);
    return { ok: r.ok, ...r };
  }, { note: "re-emit code-artifact DTUs (idempotent)" });
}
