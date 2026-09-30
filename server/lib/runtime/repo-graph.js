// server/lib/runtime/repo-graph.js
//
// P5 — Coding intelligence: lightweight repo graph (imports + exports)
// without full AST. Indexes server/ + concord-frontend/ on demand.

import { readdir, readFile, stat } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { join, relative, extname, resolve } from "node:path";

const DEFAULT_ROOTS = ["server", "concord-frontend"];
const MAX_FILES = Number(process.env.CONCORD_REPO_GRAPH_MAX_FILES) || 2000;
const STALE_SEC = Number(process.env.CONCORD_REPO_INDEX_STALE_SEC) || 3600;
const IMPORT_RE = /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g;
const EXPORT_RE = /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g;
const ROUTE_RE = /(?:app|router)\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;
const MIGRATION_RE = /(\d{3})_[\w-]+\.js$/;

/** The workspace this server runs from (repo root, not server/). */
export function defaultRepoRoot() {
  return process.cwd().replace(/\/server$/, "") || process.cwd();
}

/**
 * Roots a request may ask to index: the workspace root plus any listed in
 * CONCORD_REPO_GRAPH_ROOTS (":"-separated). Returns the matching allowlist
 * entry — never the caller's string — or null. Omitted → the workspace root.
 * Use at every boundary where repoRoot comes from outside (HTTP, missions).
 */
export function allowedRepoRoot(requested) {
  const allowed = [defaultRepoRoot(), ...String(process.env.CONCORD_REPO_GRAPH_ROOTS || "").split(":").filter(Boolean)]
    .map((r) => resolve(r));
  if (requested == null || requested === "") return allowed[0];
  if (typeof requested !== "string") return null;
  const want = resolve(requested);
  return allowed.find((r) => r === want) || null;
}

function edgesTableReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_repo_edges'`).get();
  } catch {
    return false;
  }
}

// One prepared INSERT per db, not a sqlite_master lookup + prepare per edge.
// (Profiled 2026-09-27: per-edge table checks and prepares made a full index
// hold the event loop ~1 s inside one transaction.) indexRepo clears the cache
// at the start of each run so a table created by a later migration is found.
const _edgeStmts = new WeakMap();
function edgeStmt(db) {
  if (!db) return null;
  if (_edgeStmts.has(db)) return _edgeStmts.get(db);
  let st = null;
  if (edgesTableReady(db)) {
    try {
      st = db.prepare(`
        INSERT OR IGNORE INTO runtime_repo_edges (repo_root, from_ref, to_ref, edge_kind, meta_json, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
    } catch { st = null; }
  }
  _edgeStmts.set(db, st);
  return st;
}

function insertEdge(db, repoRoot, fromRef, toRef, edgeKind, meta = null) {
  const st = edgeStmt(db);
  if (!st) return;
  try {
    st.run(repoRoot, fromRef, toRef, edgeKind, meta ? JSON.stringify(meta) : null, nowSec());
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

async function indexApiRouteGraph(db, repoRoot) {
  const paths = ["server/server.js"];
  let count = 0;
  for (const rel of paths) {
    let content;
    try {
      content = await readFile(join(repoRoot, rel), "utf8");
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

const INDEX_BATCH_FILES = 100;
const TEST_FILE_RE = /\.test\.(js|ts)$/;

/**
 * Index imports/exports (+ test-coverage, migration and route edges).
 * Files are read asynchronously and committed in batches of
 * INDEX_BATCH_FILES, yielding to the event loop between batches, so a full
 * index never stalls live traffic. Readers can briefly see a partial index
 * while it runs; it is a cache, not a record.
 * @param {object} db
 * @param {string} [repoRoot] workspace root
 * @param {{maxFiles?: number}} [opts]
 */
export async function indexRepo(db, repoRoot, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const root = repoRoot || defaultRepoRoot();
  let files = [];
  for (const sub of DEFAULT_ROOTS) {
    await walkDir(join(root, sub), files);
  }
  const maxFiles = Number(opts?.maxFiles);
  if (Number.isInteger(maxFiles) && maxFiles > 0) files = files.slice(0, maxFiles);

  _edgeStmts.delete(db);
  if (edgeStmt(db)) {
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
  let testEdges = 0;
  const ts = nowSec();
  db.prepare(`DELETE FROM runtime_repo_symbols WHERE repo_root = ?`).run(root);
  for (let start = 0; start < files.length; start += INDEX_BATCH_FILES) {
    const batch = await Promise.all(files.slice(start, start + INDEX_BATCH_FILES).map(async (filePath) => {
      try { return [filePath, await readFile(filePath, "utf8")]; } catch { return null; }
    }));
    db.transaction(() => {
      for (const entry of batch) {
        if (!entry) continue;
        const [filePath, content] = entry;
        const rel = relative(root, filePath);
        const imports = parseImports(content);
        insert.run(root, rel, "file", rel, 0, JSON.stringify(imports), ts);
        symbolCount++;
        for (const imp of imports) {
          insertEdge(db, root, rel, imp, "import");
          edgeCount++;
        }
        for (const sym of parseExports(content)) {
          insert.run(root, rel, "export", sym, 0, null, ts);
          symbolCount++;
        }
        if (TEST_FILE_RE.test(filePath)) {
          for (const imp of imports) {
            if (imp.startsWith(".") || imp.includes("/")) {
              insertEdge(db, root, rel, imp, "test", { kind: "covers" });
              testEdges++;
            }
          }
        }
      }
    })();
    await new Promise((r) => { setImmediate(r); });
  }

  const mig = indexMigrationGraph(db, root);
  const routes = await indexApiRouteGraph(db, root);
  const tests = { count: testEdges };
  edgeCount += mig.count + routes.count + tests.count;

  if (edgeStmt(db)) {
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
