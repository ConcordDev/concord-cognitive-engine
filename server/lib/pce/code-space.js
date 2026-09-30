// server/lib/pce/code-space.js
//
// Code Space — R = (S, B, D, I, T, C, H, P) repository state model.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { indexFileAst } from "./ast-cache.js";
import { captureWorkspaceSnapshot } from "../runtime/workspace-sensor.js";

const CODE_EXT = /\.(js|mjs|cjs|ts|tsx)$/i;

function walkRepo(root, sub = "", depth = 0, files = []) {
  if (depth > 10 || files.length > 2000) return files;
  const dir = join(root, sub);
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
    const rel = sub ? `${sub}/${ent.name}` : ent.name;
    if (ent.isDirectory()) walkRepo(root, rel, depth + 1, files);
    else if (CODE_EXT.test(ent.name)) files.push(rel);
  }
  return files;
}

/**
 * Build full Code Space snapshot for a repository.
 */
export async function buildCodeSpace(db, repoRoot, { maxFiles = 500, watchPaths = [] } = {}) {
  const root = repoRoot || process.cwd().replace(/\/server$/, "") || process.cwd();
  const files = walkRepo(root).slice(0, maxFiles);

  const structural = { files: [], symbolCount: 0, parseErrors: 0 };
  const interfaces = { exports: [], imports: [] };
  const dependencies = { edges: [] };

  for (const fp of files) {
    const idx = indexFileAst(db, root, fp);
    if (!idx.ok) continue;
    structural.files.push({
      path: fp,
      symbols: idx.symbols?.length || 0,
      parseOk: idx.parseOk,
    });
    structural.symbolCount += idx.symbols?.length || 0;
    if (!idx.parseOk) structural.parseErrors += 1;
    for (const ex of idx.exports || []) interfaces.exports.push({ file: fp, name: ex });
    for (const im of idx.imports || []) {
      interfaces.imports.push({ file: fp, module: im });
      dependencies.edges.push({ from: fp, to: im, kind: "import" });
    }
  }

  let workspace = null;
  try {
    workspace = await captureWorkspaceSnapshot(db, { repoRoot: root, watchPaths });
  } catch { /* optional */ }

  const history = workspace?.snapshot ? {
    branch: workspace.snapshot.branch,
    commitHash: workspace.snapshot.commit_hash,
    dirty: workspace.snapshot.dirty === 1,
  } : {};

  const provenance = { sources: [], patterns: [] };
  if (db) {
    try {
      const rows = db.prepare(`SELECT source_id, repository, license FROM pce_provenance LIMIT 50`).all();
      provenance.sources = rows;
    } catch { /* optional */ }
  }

  return {
    ok: true,
    repoRoot: root,
    state: {
      S: structural,
      B: { note: "behavior graph — derived from tests + runtime traces" },
      D: dependencies,
      I: interfaces,
      T: { fileCount: files.length, testFiles: files.filter((f) => /test|spec/i.test(f)).length },
      C: { workspace: workspace?.snapshot || null },
      H: history,
      P: provenance,
    },
    fileCount: files.length,
  };
}

export function codeSpaceSummary(codeSpace) {
  const s = codeSpace?.state || {};
  return {
    files: s.S?.files?.length || 0,
    symbols: s.S?.symbolCount || 0,
    parseErrors: s.S?.parseErrors || 0,
    exports: s.I?.exports?.length || 0,
    imports: s.I?.imports?.length || 0,
    testFiles: s.T?.testFiles || 0,
    dirty: s.H?.dirty || false,
  };
}
