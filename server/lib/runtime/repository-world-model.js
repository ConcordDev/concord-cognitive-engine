// server/lib/runtime/repository-world-model.js
//
// Unified repository world model — merges repo-graph indexing, DTU linkage,
// and task-scoped context assembly for coding missions.

import {
  indexRepo,
  repoGraphOverview,
  buildFullRepoGraph,
  findSymbol,
  getFileNeighborhood,
  ensureRepoIndexFresh,
} from "./repo-graph.js";
import {
  linkDtuToRepo,
  getDtuRepoLinks,
  getCognitiveMeta,
} from "../dtu-cognitive-schema.js";

/**
 * Ensure repo graph is indexed (lightweight on-demand).
 */
export async function ensureRepoWorldModel(db, repoRoot) {
  const root = repoRoot || process.cwd();
  const overview = repoGraphOverview(db, root);

  if (!overview.ok) return overview;
  if (overview.stale || overview.files === 0) {
    const indexed = await indexRepo(db, root);
    return { ...indexed, refreshed: true };
  }

  return { ok: true, repoRoot: root, refreshed: false, overview };
}

/**
 * Link a DTU to repo symbols discovered from its content/tags.
 */
export function enrichDtuWithRepoLinks(db, dtuId, { repoRefs = [], linkKind = "references" } = {}) {
  const links = [];
  for (const ref of repoRefs) {
    const res = linkDtuToRepo(db, dtuId, ref, linkKind);
    if (res.ok) links.push(res);
  }
  return { ok: true, dtuId, links };
}

/**
 * Build coding-context slice for a task (files, routes, linked DTUs).
 */
export function buildRepoContextForTask(db, task, { repoRoot, maxFiles = 8 } = {}) {
  const root = repoRoot || process.cwd();
  const query = [
    task?.intent,
    task?.goal,
    task?.file,
    task?.symbol,
    ...(task?.keywords || []),
  ].filter(Boolean).join(" ");

  const symbols = findSymbol(db, root, task?.symbol || query.split(/\s+/)[0] || "");
  const files = symbols.slice(0, maxFiles).map((s) => s.file_path);

  const neighborhoods = files.slice(0, 3).map((f) => ({
    file: f,
    neighborhood: getFileNeighborhood(db, root, f),
  }));

  const graph = buildFullRepoGraph(db, root);

  return {
    ok: true,
    repoRoot: root,
    query,
    symbolHits: symbols.length,
    files,
    neighborhoods,
    graphSummary: graph?.graphs || graph?.graphs,
    edgesByKind: graph?.edgesByKind || {},
  };
}

/**
 * Resolve DTUs linked to a repo ref (reverse lookup).
 */
export function getDtusForRepoRef(db, repoRef) {
  if (!db || !repoRef) return [];
  try {
    return db.prepare(`
      SELECT dtu_id, link_kind, meta_json, created_at
      FROM dtu_repo_links WHERE repo_ref = ?
      ORDER BY created_at DESC LIMIT 50
    `).all(repoRef).map((r) => ({
      dtuId: r.dtu_id,
      linkKind: r.link_kind,
      meta: r.meta_json ? JSON.parse(r.meta_json) : null,
      cognitive: getCognitiveMeta(db, r.dtu_id),
    }));
  } catch {
    return [];
  }
}

/**
 * Full world-model snapshot for MCP / mission planner.
 */
export async function getRepositoryWorldModel(db, { repoRoot, task } = {}) {
  const ensured = await ensureRepoWorldModel(db, repoRoot);
  const root = ensured.repoRoot || repoRoot || process.cwd();
  const overview = repoGraphOverview(db, root);
  const full = buildFullRepoGraph(db, root);
  const taskContext = task ? buildRepoContextForTask(db, task, { repoRoot: root }) : null;

  return {
    ok: ensured.ok !== false,
    repoRoot: root,
    refreshed: ensured.refreshed ?? false,
    overview,
    fullGraph: full,
    taskContext,
  };
}

export {
  indexRepo as indexRepoGraph,
  repoGraphOverview,
  buildFullRepoGraph,
  findSymbol,
  getFileNeighborhood,
  ensureRepoIndexFresh,
  linkDtuToRepo,
  getDtuRepoLinks,
};
