// server/lib/pce/ast-cache.js
//
// PCE-0 — incremental AST cache (acorn primary; tree-sitter optional future path).

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFileAst } from "../runtime/repo-graph-ast.js";

function tablesReady(db) {
  try {
    return !!db?.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='pce_ast_cache'`).get();
  } catch {
    return false;
  }
}

function contentHash(content) {
  return createHash("sha256").update(content).digest("hex").slice(0, 24);
}

function extractImportsExports(content) {
  const imports = [];
  const exports = [];
  for (const line of content.split("\n")) {
    const imp = line.match(/^\s*import\s+.+\s+from\s+['"]([^'"]+)['"]/);
    if (imp) imports.push(imp[1]);
    const exp = line.match(/^\s*export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/);
    if (exp) exports.push(exp[1]);
    const expNamed = line.match(/^\s*export\s*\{\s*([^}]+)\s*\}/);
    if (expNamed) {
      for (const part of expNamed[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) exports.push(name);
      }
    }
  }
  return { imports, exports };
}

export function parseAndIndexFile(filePath, content) {
  const ast = parseFileAst(filePath, content);
  const { imports, exports } = extractImportsExports(content);
  return {
    parseOk: !ast.parseError,
    symbols: ast.symbols || [],
    calls: ast.calls || [],
    imports,
    exports,
  };
}

export function getCachedAst(db, repoRoot, filePath) {
  if (!db || !tablesReady(db)) return null;
  try {
    return db.prepare(`
      SELECT * FROM pce_ast_cache WHERE repo_root = ? AND file_path = ?
    `).get(repoRoot, filePath);
  } catch {
    return null;
  }
}

export function indexFileAst(db, repoRoot, filePath, { force = false } = {}) {
  if (!db || !repoRoot || !filePath) return { ok: false, reason: "missing_inputs" };
  if (!tablesReady(db)) return { ok: false, reason: "migration_required" };

  const abs = join(repoRoot, filePath);
  let content;
  try {
    content = readFileSync(abs, "utf8");
  } catch (e) {
    return { ok: false, reason: "read_failed", error: e.message };
  }

  const hash = contentHash(content);
  const cached = getCachedAst(db, repoRoot, filePath);
  if (!force && cached?.content_hash === hash) {
    return { ok: true, cached: true, filePath, contentHash: hash };
  }

  const parsed = parseAndIndexFile(filePath, content);
  const ts = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO pce_ast_cache
      (repo_root, file_path, content_hash, ast_json, symbols_json, imports_json, exports_json, parse_ok, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_root, file_path) DO UPDATE SET
      content_hash = excluded.content_hash,
      ast_json = excluded.ast_json,
      symbols_json = excluded.symbols_json,
      imports_json = excluded.imports_json,
      exports_json = excluded.exports_json,
      parse_ok = excluded.parse_ok,
      indexed_at = excluded.indexed_at
  `).run(
    repoRoot,
    filePath,
    hash,
    JSON.stringify({ symbolCount: parsed.symbols.length, callCount: parsed.calls.length }),
    JSON.stringify(parsed.symbols),
    JSON.stringify(parsed.imports),
    JSON.stringify(parsed.exports),
    parsed.parseOk ? 1 : 0,
    ts,
  );

  return { ok: true, cached: false, filePath, contentHash: hash, ...parsed };
}

export function invalidateAstCache(db, repoRoot, filePaths = []) {
  if (!db || !tablesReady(db)) return { ok: false, reason: "migration_required" };
  const delStmt = db.prepare(`DELETE FROM pce_ast_cache WHERE repo_root = ? AND file_path = ?`);
  for (const fp of filePaths) {
    try { delStmt.run(repoRoot, fp); } catch { /* optional */ }
  }
  return { ok: true, invalidated: filePaths.length };
}
