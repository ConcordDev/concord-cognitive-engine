// server/emergent/repo-graph-cycle.js
//
// Keeps repo world-model graphs fresh for Dila planning.

import { ensureRepoIndexFresh } from "../lib/runtime/repo-graph.js";

export async function runRepoGraphCycle({ db } = {}) {
  if (process.env.CONCORD_REPO_GRAPH_CYCLE === "0") {
    return { ok: true, reason: "disabled" };
  }
  const database = db || globalThis._concordDB || globalThis.STATE?.db;
  if (!database) return { ok: false, reason: "no_db" };

  try {
    const r = await ensureRepoIndexFresh(database);
    return {
      ok: r.ok !== false,
      refreshed: !!r.refreshed,
      filesIndexed: r.filesIndexed || r.files,
      edgeCount: r.edgeCount || r.edges,
      stale: r.stale,
    };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}
