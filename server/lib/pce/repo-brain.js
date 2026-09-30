// server/lib/pce/repo-brain.js
//
// Repository brain — AST + dependency + test + migration + impact graphs.

import { join } from "node:path";
import { buildCodeSpace, codeSpaceSummary } from "./code-space.js";
import { findSymbol, repoGraphOverview } from "../runtime/repo-graph.js";

/**
 * Build enriched repository brain for change-impact analysis.
 */
export async function buildRepoBrain(db, repoRoot, { query } = {}) {
  const root = repoRoot || process.cwd().replace(/\/server$/, "") || process.cwd();
  const codeSpace = await buildCodeSpace(db, root);
  let graph = { ok: false };
  try {
    graph = repoGraphOverview(db, root) || { ok: false };
  } catch { /* optional */ }

  const summary = codeSpaceSummary(codeSpace);
  const edges = graph.edges || graph.overview?.edges || [];

  const dependencyGraph = {
    imports: codeSpace.state?.I?.imports || [],
    edges: edges.filter((e) => e.kind === "import" || e.edge_kind === "import"),
  };

  const testGraph = {
    testFiles: (codeSpace.state?.S?.files || []).filter((f) => /test|spec/i.test(f.path)).map((f) => f.path),
    count: summary.testFiles,
  };

  const migrationGraph = {
    migrations: edges.filter((e) => e.kind === "migration" || e.edge_kind === "migration"),
  };

  const routeGraph = {
    routes: edges.filter((e) => e.kind === "route" || e.edge_kind === "route"),
  };

  let queryHits = [];
  if (query && db) {
    try {
      queryHits = findSymbol(db, root, query).slice(0, 20);
    } catch { /* optional */ }
  }

  return {
    ok: true,
    repoRoot: root,
    summary,
    graphs: {
      structural: codeSpace.state?.S,
      dependency: dependencyGraph,
      test: testGraph,
      migration: migrationGraph,
      route: routeGraph,
      behavioral: codeSpace.state?.B,
      history: codeSpace.state?.H,
      provenance: codeSpace.state?.P,
    },
    queryHits,
  };
}

/**
 * Estimate blast radius for a symbol or file change.
 */
export function impactAnalysis(brain, { filePath, symbol } = {}) {
  const deps = brain?.graphs?.dependency?.edges || [];
  const tests = brain?.graphs?.test?.testFiles || [];
  const affectedModules = new Set();
  const affectedTests = new Set();

  if (filePath) {
    for (const e of deps) {
      const from = e.from || e.from_ref;
      const to = e.to || e.to_ref;
      if (from === filePath || to === filePath) {
        if (from) affectedModules.add(from);
        if (to) affectedModules.add(to);
      }
    }
    for (const t of tests) {
      if (t.includes(filePath.split("/").pop()?.replace(/\.\w+$/, "") || "___")) {
        affectedTests.add(t);
      }
    }
  }

  if (symbol) {
    for (const hit of brain?.queryHits || []) {
      if (hit.name === symbol || hit.symbol === symbol) {
        if (hit.file) affectedModules.add(hit.file);
      }
    }
  }

  return {
    ok: true,
    filePath,
    symbol,
    affectedModules: [...affectedModules],
    affectedTests: [...affectedTests],
    blastRadius: affectedModules.size + affectedTests.size,
    routes: (brain?.graphs?.route?.routes || []).length,
    migrations: (brain?.graphs?.migration?.migrations || []).length,
  };
}
