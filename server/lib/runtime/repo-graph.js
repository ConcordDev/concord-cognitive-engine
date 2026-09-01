// server/lib/runtime/repo-graph.js
//
// P5 — Coding intelligence: lightweight repo graph (imports + exports)
// without full AST. Indexes server/ + concord-frontend/ on demand.

import { readdir, readFile, stat } from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, extname } from "node:path";

const DEFAULT_ROOTS = ["server", "concord-frontend"];
const MAX_FILES = Number(process.env.CONCORD_REPO_GRAPH_MAX_FILES) || 2000;
const STALE_SEC = Number(process.env.CONCORD_REPO_INDEX_STALE_SEC) || 3600;
const IMPORT_RE = /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g;
const EXPORT_RE = /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g;
const ROUTE_RE = /(?:app|router)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;
const MIGRATION_RE = /(\d{3})_[\w-]+\.js$/;

function edgesTableReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_repo_edges'`).get();
  } catch {
    return false;
  }
}

function insertEdge(db, repoRoot, fromRef, toRef, edgeKind, meta = null) {
  if (!edgesTableReady(db)) return;
  try {
    db.prepare(`
      INSERT OR IGNORE INTO runtime_repo_edges (repo_root, from_ref, to_ref, edge_kind, meta_json, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(repoRoot, fromRef, toRef, edgeKind, meta ? JSON.stringify(meta) : null, nowSec());
  } catch { /* best effort */ }
}

function indexMigrationGraph(db, repoRoot) {
  const migDir = join(repoRoot, "server/migrations");
  let files = [];
  try {
    files = readdirSync(migDir).filter((f) => MIGRATION_RE.test(f));
  } catch {
    return { count: 0 };
  }
  let prev = null;
  for (const f of files.sort()) {
    const num = f.match(MIGRATION_RE)?.[1];
    const ref = `migration:${num}`;
    insertEdge(db, repoRoot, "schema", ref, "migration", { file: f });
    if (prev) insertEdge(db, repoRoot, prev, ref, "migration", { chain: true });
    prev = ref;
  }
  return { count: files.length };
}

function indexApiRouteGraph(db, repoRoot) {
  const paths = ["server/server.js"];
  let count = 0;
  for (const rel of paths) {
    let content;
    try {
      content = readFileSync(join(repoRoot, rel), "utf8");
    } catch {
      continue;
    }
    let m;
    ROUTE_RE.lastIndex = 0;
    while ((m = ROUTE_RE.exec(content)) !== null) {
      insertEdge(db, repoRoot, rel, `route:${m[2]}`, "route", { method: m[1] });
      count++;
    }
  }
  return { count };
}

function indexTestGraph(db, repoRoot, sourceFiles) {
  let count = 0;
  for (const filePath of sourceFiles) {
    if (!/\.test\.(js|ts)$/.test(filePath)) continue;
    let content;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const rel = relative(repoRoot, filePath);
    const imports = parseImports(content);
    for (const imp of imports) {
      if (imp.startsWith(".") || imp.includes("/")) {
        insertEdge(db, repoRoot, rel, imp, "test", { kind: "covers" });
        count++;
      }
    }
  }
  return { count };
}

function persistRepoMeta(db, repoRoot, { filesCount, edgesCount, graphs }) {
  if (!edgesTableReady(db)) return;
  try {
    db.prepare(`
      INSERT INTO runtime_repo_meta (repo_root, last_full_index_at, files_count, edges_count, graphs_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(repo_root) DO UPDATE SET
        last_full_index_at = excluded.last_full_index_at,
        files_count = excluded.files_count,
        edges_count = excluded.edges_count,
        graphs_json = excluded.graphs_json
    `).run(repoRoot, nowSec(), filesCount, edgesCount, JSON.stringify(graphs));
  } catch { /* optional */ }
}

async function walkDir(dir, files = [], depth = 0) {
  if (files.length >= MAX_FILES || depth > 12) return files;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".") || ent.name === "node_modules" || ent.name === "build" || ent.name === ".next") continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      await walkDir(full, files, depth + 1);
    } else if (/\.(js|ts|tsx|mjs|cjs)$/.test(ent.name)) {
      files.push(full);
    }
    if (files.length >= MAX_FILES) break;
  }
  return files;
}

function parseImports(content) {
  const imports = [];
  let m;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

function parseExports(content) {
  const exports = [];
  let m;
  while ((m = EXPORT_RE.exec(content)) !== null) {
    exports.push(m[1]);
  }
  return exports;
}

/**
 * @param {object} db
 * @param {string} [repoRoot] workspace root
 */
export async function indexRepo(db, repoRoot) {
  if (!db) return { ok: false, reason: "no_db" };
  const root = repoRoot || process.cwd().replace(/\/server$/, "") || process.cwd();
  const files = [];
  for (const sub of DEFAULT_ROOTS) {
    await walkDir(join(root, sub), files);
  }

  if (edgesTableReady(db)) {
    try {
      db.prepare(`DELETE FROM runtime_repo_edges WHERE repo_root = ?`).run(root);
    } catch { /* optional */ }
  }

  const insert = db.prepare(`
    INSERT OR REPLACE INTO runtime_repo_symbols
      (repo_root, file_path, symbol_kind, symbol_name, line_number, imports_json, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let symbolCount = 0;
  let edgeCount = 0;
  const ts = nowSec();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM runtime_repo_symbols WHERE repo_root = ?`).run(root);
    for (const filePath of files) {
      let content;
      try {
        content = readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      const rel = relative(root, filePath);
      const imports = parseImports(content);
      insert.run(root, rel, "file", rel, 0, JSON.stringify(imports), ts);
      symbolCount++;
      for (const imp of imports) {
        insertEdge(db, root, rel, imp, "import");
        edgeCount++;
      }
      const exports = parseExports(content);
      for (const sym of exports) {
        insert.run(root, rel, "export", sym, 0, null, ts);
        symbolCount++;
      }
    }
  });
  tx();

  const mig = indexMigrationGraph(db, root);
  const routes = indexApiRouteGraph(db, root);
  const tests = indexTestGraph(db, root, files);
  edgeCount += mig.count + routes.count + tests.count;

  if (edgesTableReady(db)) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM runtime_repo_edges WHERE repo_root = ?`).get(root);
      edgeCount = row?.c || edgeCount;
    } catch { /* optional */ }
  }

  const graphs = {
    architecture: { files: files.length, symbols: symbolCount },
    dependency: { importEdges: edgeCount },
    migration: mig,
    api: routes,
    test: tests,
  };
  persistRepoMeta(db, root, { filesCount: files.length, edgesCount: edgeCount, graphs });

  return { ok: true, repoRoot: root, filesIndexed: files.length, symbolCount, edgeCount, graphs };
}

export function findSymbol(db, repoRoot, symbolName) {
  if (!db || !symbolName) return [];
  try {
    return db.prepare(`
      SELECT file_path, symbol_kind, symbol_name, imports_json
      FROM runtime_repo_symbols
      WHERE repo_root = ? AND symbol_name LIKE ?
      ORDER BY file_path LIMIT 100
    `).all(repoRoot || process.cwd(), `%${symbolName}%`);
  } catch {
    return [];
  }
}

export function getFileNeighborhood(db, repoRoot, filePath) {
  if (!db || !filePath) return { file: null, imports: [], dependents: [] };
  try {
    const file = db.prepare(`
      SELECT * FROM runtime_repo_symbols
      WHERE repo_root = ? AND file_path = ? AND symbol_kind = 'file'
      LIMIT 1
    `).get(repoRoot, filePath);
    const imports = file?.imports_json ? JSON.parse(file.imports_json) : [];
    const dependents = db.prepare(`
      SELECT file_path, imports_json FROM runtime_repo_symbols
      WHERE repo_root = ? AND symbol_kind = 'file' AND imports_json LIKE ?
      LIMIT 50
    `).all(repoRoot, `%${filePath}%`);
    return { file, imports, dependents };
  } catch {
    return { file: null, imports: [], dependents: [] };
  }
}

export function repoGraphOverview(db, repoRoot) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const root = repoRoot || process.cwd();
    const files = db.prepare(`
      SELECT COUNT(*) AS c FROM runtime_repo_symbols WHERE repo_root = ? AND symbol_kind = 'file'
    `).get(root)?.c || 0;
    const exports = db.prepare(`
      SELECT COUNT(*) AS c FROM runtime_repo_symbols WHERE repo_root = ? AND symbol_kind = 'export'
    `).get(root)?.c || 0;
    const last = db.prepare(`
      SELECT MAX(indexed_at) AS t FROM runtime_repo_symbols WHERE repo_root = ?
    `).get(root)?.t;
    let edges = 0;
    let graphs = null;
    let lastFullIndex = last;
    if (edgesTableReady(db)) {
      edges = db.prepare(`SELECT COUNT(*) AS c FROM runtime_repo_edges WHERE repo_root = ?`).get(root)?.c || 0;
      const meta = db.prepare(`SELECT * FROM runtime_repo_meta WHERE repo_root = ?`).get(root);
      if (meta) {
        lastFullIndex = meta.last_full_index_at;
        graphs = meta.graphs_json ? JSON.parse(meta.graphs_json) : null;
      }
    }
    return {
      ok: true,
      repoRoot: root,
      files,
      exports,
      edges,
      graphs,
      lastIndexedAt: last,
      lastFullIndexAt: lastFullIndex,
      stale: lastFullIndex ? (nowSec() - lastFullIndex) > STALE_SEC : true,
    };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

export function buildFullRepoGraph(db, repoRoot) {
  const overview = repoGraphOverview(db, repoRoot);
  if (!overview.ok) return overview;
  const root = overview.repoRoot;
  let edgesByKind = {};
  try {
    if (edgesTableReady(db)) {
      const rows = db.prepare(`
        SELECT edge_kind, COUNT(*) AS c FROM runtime_repo_edges
        WHERE repo_root = ? GROUP BY edge_kind
      `).all(root);
      edgesByKind = Object.fromEntries(rows.map((r) => [r.edge_kind, r.c]));
    }
  } catch { /* optional */ }
  return {
    ok: true,
    repoRoot: root,
    graphs: {
      architecture: { files: overview.files, exports: overview.exports },
      dependency: { edges: overview.edges, byKind: edgesByKind },
      migration: overview.graphs?.migration || edgesByKind.migration || 0,
      api: overview.graphs?.api || { count: edgesByKind.route || 0 },
      test: overview.graphs?.test || { count: edgesByKind.test || 0 },
    },
    lastFullIndexAt: overview.lastFullIndexAt,
    stale: overview.stale,
  };
}

export async function ensureRepoIndexFresh(db, repoRoot, maxAgeSec = STALE_SEC) {
  const overview = repoGraphOverview(db, repoRoot);
  if (overview.ok && !overview.stale && overview.files > 0) {
    return { ok: true, refreshed: false, ...overview };
  }
  const idx = await indexRepo(db, repoRoot);
  return { ok: idx.ok !== false, refreshed: true, ...idx };
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}
