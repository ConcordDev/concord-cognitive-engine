// @sync-fs-ok: static codebase scanner with TTL cache — runs at boot and on cache-miss only
/**
 * @fileoverview Codebase Inventory & Wiring Map System
 *
 * Provides file-based scanning of the Concord codebase to build an index of
 * frontend components, server libraries, lens pages, and their interconnections.
 * All results are cached with a 5-minute TTL to avoid re-scanning on every request.
 *
 * @module codebase-inventory
 */

import fs from "fs";
import path from "path";

// ── Root paths ──────────────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
const FRONTEND_ROOT = path.join(PROJECT_ROOT, "concord-frontend");
const SERVER_ROOT = path.join(PROJECT_ROOT, "server");

const COMPONENTS_DIR = path.join(FRONTEND_ROOT, "components");
const LENSES_DIR = path.join(FRONTEND_ROOT, "app", "lenses");
const SERVER_LIB_DIR = path.join(SERVER_ROOT, "lib");
const SERVER_ROUTES_DIR = path.join(SERVER_ROOT, "routes");

// ── Cache with 5-minute TTL ────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map();

function getCached(key) {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;
  return null;
}

function setCache(key, data) {
  _cache.set(key, { data, ts: Date.now() });
  return data;
}

/** Bust all cached data (e.g. after a deploy). */
export function clearCache() {
  _cache.clear();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Recursively collect files matching an extension set under a directory.
 * Skips node_modules and hidden directories.
 */
function walkDir(dir, extensions, results = []) {
  if (!fs.existsSync(dir)) return results;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, extensions, results);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Read a file and extract export names via simple regex matching.
 * Looks for: export function X, export default function X, export const X,
 * export default X, export { X }.
 */
function extractExports(content) {
  const exports = [];
  const patterns = [
    /export\s+function\s+(\w+)/g,
    /export\s+default\s+function\s+(\w+)/g,
    /export\s+const\s+(\w+)/g,
    /export\s+let\s+(\w+)/g,
    /export\s+class\s+(\w+)/g,
    /export\s+default\s+class\s+(\w+)/g,
    /export\s+default\s+(\w+)\s*;/g,
    /export\s*\{\s*([^}]+)\s*\}/g,
  ];
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(content)) !== null) {
      if (pat.source.includes("{")) {
        // Named re-exports: export { A, B as C }
        const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop().trim());
        exports.push(...names.filter(Boolean));
      } else {
        exports.push(m[1]);
      }
    }
  }
  return [...new Set(exports)];
}

/**
 * Extract import sources from file content — returns the `from '...'` paths.
 */
function extractImports(content) {
  const imports = [];
  const pat = /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = pat.exec(content)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

/**
 * Get the line count and last-modified date for a file path.
 */
function fileMeta(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, "utf-8");
    return {
      lineCount: content.split("\n").length,
      lastModified: stat.mtime.toISOString(),
      content,
    };
  } catch {
    return { lineCount: 0, lastModified: null, content: "" };
  }
}

// ── 1. scanFrontendComponents ───────────────────────────────────────────────

/**
 * Scan concord-frontend/components/ recursively.
 * For each .tsx/.ts file: extract filename, directory, export names, line count,
 * last modified date.
 *
 * @returns {Array<{path: string, directory: string, exports: string[], lineCount: number, lastModified: string}>}
 */
export function scanFrontendComponents() {
  const cached = getCached("frontendComponents");
  if (cached) return cached;

  const files = walkDir(COMPONENTS_DIR, [".tsx", ".ts"]);
  const results = files.map((filePath) => {
    const { lineCount, lastModified, content } = fileMeta(filePath);
    const relPath = path.relative(PROJECT_ROOT, filePath);
    return {
      path: relPath,
      directory: path.relative(PROJECT_ROOT, path.dirname(filePath)),
      exports: extractExports(content),
      lineCount,
      lastModified,
    };
  });

  return setCache("frontendComponents", results);
}

// ── 2. scanServerLibraries ──────────────────────────────────────────────────

/**
 * Scan server/lib/ and server/routes/ for .js files.
 * For each: extract filename, exports, line count, last modified, and type.
 *
 * @returns {Array<{path: string, type: 'lib'|'route', exports: string[], lineCount: number, lastModified: string}>}
 */
export function scanServerLibraries() {
  const cached = getCached("serverLibraries");
  if (cached) return cached;

  const libFiles = walkDir(SERVER_LIB_DIR, [".js"]);
  const routeFiles = walkDir(SERVER_ROUTES_DIR, [".js"]);

  const mapFiles = (files, type) =>
    files.map((filePath) => {
      const { lineCount, lastModified, content } = fileMeta(filePath);
      return {
        path: path.relative(PROJECT_ROOT, filePath),
        type,
        exports: extractExports(content),
        lineCount,
        lastModified,
      };
    });

  const results = [
    ...mapFiles(libFiles, "lib"),
    ...mapFiles(routeFiles, "route"),
  ];

  return setCache("serverLibraries", results);
}

// ── 3. scanLensPages ────────────────────────────────────────────────────────

/**
 * Scan concord-frontend/app/lenses/ for lens directories containing page.tsx.
 * For each: extract lens name, line count, component/lib imports, last modified.
 *
 * @returns {Array<{name: string, lineCount: number, imports: string[], lastModified: string}>}
 */
export function scanLensPages() {
  const cached = getCached("lensPages");
  if (cached) return cached;

  const results = [];
  if (!fs.existsSync(LENSES_DIR)) return setCache("lensPages", results);

  let entries;
  try {
    entries = fs.readdirSync(LENSES_DIR, { withFileTypes: true });
  } catch {
    return setCache("lensPages", results);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pagePath = path.join(LENSES_DIR, entry.name, "page.tsx");
    if (!fs.existsSync(pagePath)) continue;

    const { lineCount, lastModified, content } = fileMeta(pagePath);
    const allImports = extractImports(content);

    // Filter to only component and lib imports (project-internal)
    const projectImports = allImports.filter(
      (imp) => imp.startsWith("@/components") || imp.startsWith("@/lib")
    );

    results.push({
      name: entry.name,
      lineCount,
      imports: projectImports,
      lastModified,
    });
  }

  return setCache("lensPages", results);
}

// ── 4. findOrphans ──────────────────────────────────────────────────────────

/**
 * Cross-reference components against lens imports and other component imports.
 * A component is orphaned if its export name does not appear in any lens page
 * or any other component file.
 *
 * @returns {Array<{path: string, exports: string[]}>}
 */
export function findOrphans() {
  const cached = getCached("orphans");
  if (cached) return cached;

  const components = scanFrontendComponents();
  const lenses = scanLensPages();

  // Build a set of all import references that appear across the project
  const referencedTokens = new Set();

  // Collect all import paths and the tokens they reference from lens pages
  for (const lens of lenses) {
    const pagePath = path.join(LENSES_DIR, lens.name, "page.tsx");
    if (!fs.existsSync(pagePath)) continue;
    const content = fs.readFileSync(pagePath, "utf-8");
    // Extract all imported identifiers
    const importPat = /import\s+(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]*)\})?\s+from\s+['"][^'"]+['"]/g;
    let m;
    while ((m = importPat.exec(content)) !== null) {
      if (m[1]) referencedTokens.add(m[1]);
      if (m[2]) {
        m[2].split(",").forEach((s) => {
          const name = s.trim().split(/\s+as\s+/)[0].trim();
          if (name) referencedTokens.add(name);
        });
      }
    }
  }

  // Also collect references from other component files (cross-component imports)
  for (const comp of components) {
    const fullPath = path.join(PROJECT_ROOT, comp.path);
    let content;
    try {
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }
    const importPat = /import\s+(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]*)\})?\s+from\s+['"][^'"]+['"]/g;
    let m;
    while ((m = importPat.exec(content)) !== null) {
      if (m[1]) referencedTokens.add(m[1]);
      if (m[2]) {
        m[2].split(",").forEach((s) => {
          const name = s.trim().split(/\s+as\s+/)[0].trim();
          if (name) referencedTokens.add(name);
        });
      }
    }
  }

  // A component is orphaned if none of its exports appear in any reference set
  const orphans = components.filter((comp) => {
    if (comp.exports.length === 0) return true;
    return !comp.exports.some((exp) => referencedTokens.has(exp));
  });

  return setCache(
    "orphans",
    orphans.map((c) => ({ path: c.path, exports: c.exports }))
  );
}

// ── 5. buildWiringMap ───────────────────────────────────────────────────────

/**
 * Build a JSON map of what connects to what:
 *  - For each lens: which components it imports, which server routes it calls
 *  - For each component: which lenses use it
 *  - For each server lib: basic metadata
 *
 * @returns {{lenses: Object, components: Object, serverLibs: Object}}
 */
export function buildWiringMap() {
  const cached = getCached("wiringMap");
  if (cached) return cached;

  const components = scanFrontendComponents();
  const lenses = scanLensPages();
  const serverLibs = scanServerLibraries();

  // Build lens map
  const lensMap = {};
  for (const lens of lenses) {
    const pagePath = path.join(LENSES_DIR, lens.name, "page.tsx");
    let content = "";
    try {
      content = fs.readFileSync(pagePath, "utf-8");
    } catch {
      // skip
    }

    // Component imports (from @/components/...)
    const componentImports = lens.imports
      .filter((imp) => imp.startsWith("@/components"))
      .map((imp) => imp.replace("@/", "concord-frontend/"));

    // Server route calls: look for fetch('/api/...') or api.get('/api/...') patterns
    const apiCalls = [];
    const apiPat = /['"`]\/api\/([a-zA-Z0-9/_-]+)['"`]/g;
    let m;
    while ((m = apiPat.exec(content)) !== null) {
      apiCalls.push("/api/" + m[1]);
    }

    lensMap[lens.name] = {
      components: componentImports,
      serverRoutes: [...new Set(apiCalls)],
      lineCount: lens.lineCount,
      lastModified: lens.lastModified,
    };
  }

  // Build component map: for each component, which lenses use it
  const componentMap = {};
  for (const comp of components) {
    const compImportPath = comp.path
      .replace("concord-frontend/", "@/")
      .replace(/\.(tsx|ts)$/, "");

    const usedByLenses = [];
    for (const lens of lenses) {
      const matches = lens.imports.some((imp) => {
        const normalized = imp.replace(/\.(tsx|ts)$/, "");
        return normalized === compImportPath || compImportPath.endsWith(normalized.replace("@/", ""));
      });
      if (matches) usedByLenses.push(lens.name);
    }

    // Also check if any lens page.tsx content references this component's exports
    if (usedByLenses.length === 0) {
      for (const lens of lenses) {
        const pagePath = path.join(LENSES_DIR, lens.name, "page.tsx");
        let content = "";
        try {
          content = fs.readFileSync(pagePath, "utf-8");
        } catch {
          continue;
        }
        const isReferenced = comp.exports.some(
          (exp) => content.includes(exp) && exp.length > 2
        );
        if (isReferenced) usedByLenses.push(lens.name);
      }
    }

    componentMap[comp.path] = {
      exports: comp.exports,
      usedByLenses: [...new Set(usedByLenses)],
      lineCount: comp.lineCount,
      lastModified: comp.lastModified,
    };
  }

  // Server libs map
  const serverLibMap = {};
  for (const lib of serverLibs) {
    serverLibMap[lib.path] = {
      type: lib.type,
      exports: lib.exports,
      lineCount: lib.lineCount,
      lastModified: lib.lastModified,
    };
  }

  const result = {
    lenses: lensMap,
    components: componentMap,
    serverLibs: serverLibMap,
  };

  return setCache("wiringMap", result);
}

// ── 6. searchInventory ──────────────────────────────────────────────────────

/**
 * Fuzzy search across all inventory — component names, export names,
 * file paths, and lens names.
 *
 * @param {string} query - Search query
 * @returns {Array<{type: string, name: string, path: string, score: number, exports?: string[]}>}
 */
export function searchInventory(query) {
  if (!query || typeof query !== "string") return [];

  const q = query.toLowerCase().trim();
  if (!q) return [];

  const tokens = q.split(/\s+/);
  const results = [];

  /**
   * Simple fuzzy scoring: count how many query tokens appear as substrings
   * in the target string, weighted by position (earlier = higher).
   */
  function score(target) {
    const t = target.toLowerCase();
    let s = 0;
    for (const tok of tokens) {
      const idx = t.indexOf(tok);
      if (idx !== -1) {
        // Base match + bonus for early position + bonus for exact word match
        s += 10;
        if (idx === 0) s += 5;
        if (t === tok) s += 20;
        // Bonus for matching a larger portion of the target
        s += (tok.length / t.length) * 5;
      }
    }
    return s;
  }

  // Search components
  const components = scanFrontendComponents();
  for (const comp of components) {
    const fileName = path.basename(comp.path, path.extname(comp.path));
    const bestExportScore = Math.max(0, ...comp.exports.map((e) => score(e)));
    const pathScore = score(comp.path);
    const nameScore = score(fileName);
    const total = Math.max(bestExportScore, pathScore, nameScore);

    if (total > 0) {
      results.push({
        type: "component",
        name: fileName,
        path: comp.path,
        score: total,
        exports: comp.exports,
      });
    }
  }

  // Search lenses
  const lenses = scanLensPages();
  for (const lens of lenses) {
    const s = score(lens.name);
    if (s > 0) {
      results.push({
        type: "lens",
        name: lens.name,
        path: `concord-frontend/app/lenses/${lens.name}/page.tsx`,
        score: s,
      });
    }
  }

  // Search server libs
  const serverLibs = scanServerLibraries();
  for (const lib of serverLibs) {
    const fileName = path.basename(lib.path, ".js");
    const bestExportScore = Math.max(0, ...lib.exports.map((e) => score(e)));
    const pathScore = score(lib.path);
    const nameScore = score(fileName);
    const total = Math.max(bestExportScore, pathScore, nameScore);

    if (total > 0) {
      results.push({
        type: lib.type === "route" ? "route" : "serverLib",
        name: fileName,
        path: lib.path,
        score: total,
        exports: lib.exports,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}

// ── 7. getInventorySummary ──────────────────────────────────────────────────

/**
 * High-level stats across the entire codebase.
 *
 * @returns {{
 *   totalComponents: number,
 *   totalLenses: number,
 *   totalServerLibs: number,
 *   totalRoutes: number,
 *   totalExports: number,
 *   orphanedCount: number,
 *   largestFiles: Array<{path: string, lineCount: number}>,
 *   mostImportedComponents: Array<{path: string, usedByCount: number}>,
 *   scanTimestamp: string
 * }}
 */
export function getInventorySummary() {
  const cached = getCached("summary");
  if (cached) return cached;

  const components = scanFrontendComponents();
  const lenses = scanLensPages();
  const serverLibs = scanServerLibraries();
  const orphans = findOrphans();
  const wiring = buildWiringMap();

  const libs = serverLibs.filter((s) => s.type === "lib");
  const routes = serverLibs.filter((s) => s.type === "route");

  // Count total exports across all files
  const totalExports =
    components.reduce((n, c) => n + c.exports.length, 0) +
    serverLibs.reduce((n, s) => n + s.exports.length, 0);

  // Largest files (top 20 across everything)
  const allFiles = [
    ...components.map((c) => ({ path: c.path, lineCount: c.lineCount })),
    ...lenses.map((l) => ({
      path: `concord-frontend/app/lenses/${l.name}/page.tsx`,
      lineCount: l.lineCount,
    })),
    ...serverLibs.map((s) => ({ path: s.path, lineCount: s.lineCount })),
  ];
  allFiles.sort((a, b) => b.lineCount - a.lineCount);
  const largestFiles = allFiles.slice(0, 20);

  // Most-imported components (by how many lenses reference them)
  const componentUsage = Object.entries(wiring.components)
    .map(([p, info]) => ({ path: p, usedByCount: info.usedByLenses.length }))
    .filter((c) => c.usedByCount > 0)
    .sort((a, b) => b.usedByCount - a.usedByCount)
    .slice(0, 20);

  const summary = {
    totalComponents: components.length,
    totalLenses: lenses.length,
    totalServerLibs: libs.length,
    totalRoutes: routes.length,
    totalExports,
    orphanedCount: orphans.length,
    largestFiles,
    mostImportedComponents: componentUsage,
    scanTimestamp: new Date().toISOString(),
  };

  return setCache("summary", summary);
}
