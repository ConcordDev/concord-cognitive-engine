// server/lib/runtime/repo-graph-ast.js
//
// AST-enhanced repo graph using acorn — functions, classes, call graph hints.

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as acorn from "acorn";

const MAX_AST_FILES = Number(process.env.CONCORD_REPO_AST_MAX_FILES) || 500;

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
    `).run(repoRoot, fromRef, toRef, edgeKind, meta ? JSON.stringify(meta) : null, Math.floor(Date.now() / 1000));
  } catch { /* best effort */ }
}

function walkAst(node, visitors) {
  if (!node || typeof node !== "object") return;
  for (const [kind, fn] of Object.entries(visitors)) {
    if (node.type === kind) fn(node);
  }
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) walkAst(c, visitors);
    } else if (child && typeof child === "object" && child.type) {
      walkAst(child, visitors);
    }
  }
}

export function parseFileAst(filePath, content) {
  const symbols = [];
  const calls = [];
  try {
    const ast = acorn.parse(content, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
    });
    walkAst(ast, {
      FunctionDeclaration(node) {
        if (node.id?.name) symbols.push({ kind: "function", name: node.id.name, line: node.loc?.start?.line });
      },
      ClassDeclaration(node) {
        if (node.id?.name) symbols.push({ kind: "class", name: node.id.name, line: node.loc?.start?.line });
      },
      CallExpression(node) {
        if (node.callee?.type === "Identifier") {
          calls.push({ name: node.callee.name, line: node.loc?.start?.line });
        } else if (node.callee?.type === "MemberExpression" && node.callee.property?.name) {
          calls.push({ name: node.callee.property.name, line: node.loc?.start?.line });
        }
      },
    });
  } catch {
    return { symbols: [], calls: [], parseError: true };
  }
  return { symbols, calls, parseError: false };
}

/**
 * Augment existing repo index with AST symbols and call edges.
 */
export function indexAstLayer(db, repoRoot, filePaths = []) {
  if (!db || !repoRoot) return { ok: false, reason: "missing_inputs" };
  const root = repoRoot;
  const files = filePaths.slice(0, MAX_AST_FILES);
  let symbolCount = 0;
  let callEdges = 0;

  const insert = db.prepare(`
    INSERT OR REPLACE INTO runtime_repo_symbols
      (repo_root, file_path, symbol_kind, symbol_name, line_number, imports_json, indexed_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `);
  const ts = Math.floor(Date.now() / 1000);

  for (const filePath of files) {
    if (!/\.(js|mjs|cjs)$/.test(filePath)) continue;
    let content;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const rel = relative(root, filePath);
    const { symbols, calls } = parseFileAst(filePath, content);
    for (const sym of symbols) {
      insert.run(root, rel, sym.kind, sym.name, sym.line || 0, ts);
      symbolCount++;
    }
    for (const call of calls) {
      insertEdge(db, root, rel, `symbol:${call.name}`, "call", { line: call.line });
      callEdges++;
    }
  }

  return { ok: true, symbolCount, callEdges, filesParsed: files.length };
}

export function findImpactRadius(db, repoRoot, symbolName) {
  if (!db || !symbolName) return { ok: false, reason: "missing_inputs" };
  try {
    const root = repoRoot || process.cwd();
    const symbols = db.prepare(`
      SELECT file_path, symbol_kind, symbol_name, line_number
      FROM runtime_repo_symbols
      WHERE repo_root = ? AND symbol_name = ?
    `).all(root, symbolName);
    const callers = db.prepare(`
      SELECT from_ref, to_ref, meta_json FROM runtime_repo_edges
      WHERE repo_root = ? AND to_ref = ? AND edge_kind = 'call'
    `).all(root, `symbol:${symbolName}`);
    const imports = db.prepare(`
      SELECT from_ref, to_ref FROM runtime_repo_edges
      WHERE repo_root = ? AND to_ref LIKE ? AND edge_kind = 'import'
    `).all(root, `%${symbolName}%`);
    return { ok: true, symbolName, definitions: symbols, callers, imports };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}
