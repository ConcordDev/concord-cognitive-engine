#!/usr/bin/env node
// server/scripts/audit-wiring.js
// Phase 2: Built-but-not-wired audit.
// Finds modules that exist but are never imported from any production path.
// Usage: node server/scripts/audit-wiring.js [--json] [--fix]

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../");
const SERVER_DIR = path.join(ROOT, "server");
const FRONTEND_DIR = path.join(ROOT, "concord-frontend");

const JSON_MODE = process.argv.includes("--json");

// ── File collection ────────────────────────────────────────────────────────────

async function getFilesRecursive(dir, exts = [".js", ".ts", ".tsx", ".jsx"], exclude = []) {
  const results = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return results; }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", ".next", "dist", "build", "__pycache__"].includes(entry.name)) continue;
      if (exclude.some(e => fullPath.includes(e))) continue;
      results.push(...await getFilesRecursive(fullPath, exts, exclude));
    } else if (entry.isFile() && exts.some(ext => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Import parsing ─────────────────────────────────────────────────────────────

const IMPORT_PATTERNS = [
  /import\s+(?:[\w{},\s*]+\s+from\s+)?['"]([^'"]+)['"]/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /from\s+['"]([^'"]+)['"]/g,
];

const DYNAMIC_REGISTRY_PATTERNS = [
  /lensRegistry\s*\.\s*register/,
  /macroRegistry\s*\.\s*register/,
  /register\s*\(\s*['"]([^'"]+)['"]/,
  /skillRegistry/,
  /pluginRegistry/,
  /\bdynamicImport\b/,
  /\bloadModule\b/,
  /glob\s*\(/,
  /readdir.*\.js/,
];

function extractImports(content, filePath) {
  const imports = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(content)) !== null) {
      const spec = m[1];
      if (spec.startsWith(".") || spec.startsWith("/")) {
        const resolved = resolveRelative(spec, filePath);
        if (resolved) imports.add(resolved);
      }
    }
  }
  return imports;
}

function resolveRelative(spec, fromFile) {
  const base = path.dirname(fromFile);
  const exts = ["", ".js", ".ts", ".tsx", "/index.js", "/index.ts"];
  for (const ext of exts) {
    const candidate = path.resolve(base, spec + ext);
    return candidate; // return first candidate; existence checked later
  }
  return null;
}

function hasDynamicReference(content) {
  return DYNAMIC_REGISTRY_PATTERNS.some(p => p.test(content));
}

function parseExports(content) {
  const exports = [];
  const patterns = [
    /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g,
    /export\s*\{\s*([^}]+)\}/g,
  ];
  for (const p of patterns) {
    p.lastIndex = 0;
    let m;
    while ((m = p.exec(content)) !== null) exports.push(m[1].split(",")[0].trim());
  }
  return exports;
}

// ── Main audit ─────────────────────────────────────────────────────────────────

async function main() {
  log("Scanning files...");

  const serverFiles = await getFilesRecursive(path.join(SERVER_DIR, "lib"), [".js"]);
  const routeFiles = await getFilesRecursive(path.join(SERVER_DIR, "routes"), [".js"]);
  const frontendLibFiles = await getFilesRecursive(path.join(FRONTEND_DIR, "lib"), [".ts", ".tsx"]);
  const componentFiles = await getFilesRecursive(path.join(FRONTEND_DIR, "components"), [".ts", ".tsx"]);

  const allSourceFiles = [...serverFiles, ...routeFiles, ...frontendLibFiles, ...componentFiles];
  log(`Found ${allSourceFiles.length} source files`);

  // Build content + import map
  const fileContents = new Map();
  const fileImports = new Map(); // file → Set of imported absolute paths
  const fileDynamic = new Map();

  await Promise.all(allSourceFiles.map(async f => {
    const content = await readFile(f, "utf-8").catch(() => "");
    fileContents.set(f, content);
    fileImports.set(f, extractImports(content, f));
    fileDynamic.set(f, hasDynamicReference(content));
  }));

  // Entry points — production paths
  const entryPoints = [
    path.join(SERVER_DIR, "server.js"),
    path.join(FRONTEND_DIR, "app/layout.tsx"),
    path.join(FRONTEND_DIR, "app/page.tsx"),
  ];

  // Build union of all imported files (transitive — 1 level from all files)
  const allImported = new Set();
  for (const [, imports] of fileImports) {
    for (const imp of imports) allImported.add(imp);
  }

  // Also check server.js directly
  const serverJsContent = await readFile(path.join(SERVER_DIR, "server.js"), "utf-8").catch(() => "");
  const serverJsImports = extractImports(serverJsContent, path.join(SERVER_DIR, "server.js"));
  for (const imp of serverJsImports) allImported.add(imp);

  // Find orphaned — in lib/ but never imported
  const orphaned = [];
  for (const f of serverFiles) {
    const content = fileContents.get(f) || "";
    const exports = parseExports(content);
    if (exports.length === 0) continue; // no exports = not a module

    const isImported = [...allImported].some(imp => {
      return imp === f || imp.replace(/\.[^.]+$/, "") === f.replace(/\.[^.]+$/, "");
    });

    const dynamic = fileDynamic.get(f);

    if (!isImported && !dynamic) {
      const stats = await stat(f).catch(() => ({ size: 0, mtime: new Date() }));
      orphaned.push({
        path: f,
        relativePath: path.relative(ROOT, f),
        exports,
        sizeBytes: stats.size,
        lastModified: stats.mtime,
        recommendation: "Wire into production path or remove if obsolete",
      });
    }
  }

  // Result
  const result = {
    scanned: allSourceFiles.length,
    orphanedCount: orphaned.length,
    orphaned,
    generatedAt: new Date().toISOString(),
  };

  if (JSON_MODE) {
    process.stdout.write(JSON.stringify(result, null, 2));
  } else {
    log(`\n══ WIRING AUDIT RESULTS ══`);
    log(`Scanned: ${result.scanned} files`);
    log(`Orphaned: ${result.orphanedCount} modules\n`);

    for (const o of orphaned) {
      log(`  ✗ ${o.relativePath}`);
      log(`    exports: ${o.exports.slice(0, 3).join(", ")}`);
      log(`    size: ${(o.sizeBytes / 1024).toFixed(1)}KB | modified: ${o.lastModified.toLocaleDateString()}`);
    }

    if (orphaned.length === 0) {
      log("  ✓ No orphaned modules found");
    }
  }

  return result;
}

function log(...args) {
  if (!JSON_MODE) console.log(...args);
}

main().catch(e => { console.error(e.message); process.exit(1); });
