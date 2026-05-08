// server/scripts/cartographer/static-parse.js
//
// Regex-based static parse of the Concord codebase. Pulls:
//   - tables (CREATE TABLE in migrations)
//   - routes (Express router/app endpoints)
//   - socket events (realtimeEmit / io.emit / socket.emit)
//   - env var reads (process.env.CONCORD_*)
//   - macro registration callsites (register("d", "n", ...))
//   - heartbeat callsites (registerHeartbeat("id", { frequency: N }))
//   - migration files (file order + table count)
//   - frontend lens directories
//   - SELECT/INSERT/UPDATE/DELETE table references (for dead-table detection)
//
// Convention follows server/scripts/audit-wiring.js + gen-module-registry.js:
// regex over file contents, no AST. Sub-second on 66k-LOC server.js.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const SERVER_DIR_NAME = "server";
const FRONTEND_DIR_NAME = "concord-frontend";

// ── File walking ────────────────────────────────────────────────────────────

async function walk(dir, exts = [".js", ".ts", ".tsx", ".jsx"], skip = ["node_modules", ".git", ".next", "dist", "build", "data", "audit"]) {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skip.includes(e.name)) continue;
      out.push(...await walk(p, exts, skip));
    } else if (e.isFile() && exts.some(x => e.name.endsWith(x))) {
      out.push(p);
    }
  }
  return out;
}

async function readSafe(p) {
  try { return await readFile(p, "utf-8"); } catch { return ""; }
}

function lineOf(content, idx) {
  if (idx < 0 || idx >= content.length) return 1;
  let n = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

// ── Migrations + tables ────────────────────────────────────────────────────

const TABLE_RE = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;

async function parseMigrations(serverDir) {
  const migrationsDir = path.join(serverDir, "migrations");
  const tables = [];
  const migrations = [];
  let files;
  try { files = (await readdir(migrationsDir)).filter(f => f.endsWith(".js")).sort(); }
  catch { return { tables, migrations }; }

  for (const file of files) {
    const full = path.join(migrationsDir, file);
    const content = await readSafe(full);
    const idMatch = file.match(/^(\d+)_/);
    const id = idMatch ? parseInt(idMatch[1], 10) : -1;
    const tNames = [];
    let m;
    TABLE_RE.lastIndex = 0;
    while ((m = TABLE_RE.exec(content))) {
      const tName = m[1];
      tNames.push(tName);
      tables.push({
        name: tName,
        migrationFile: path.relative(path.dirname(serverDir), full),
        line: lineOf(content, m.index),
        columnCount: countColumnsAfter(content, m.index),
        createdAtMigration: id,
      });
    }
    let st;
    try { st = await stat(full); } catch { st = null; }
    migrations.push({
      id, file: path.relative(path.dirname(serverDir), full),
      tables: tNames, sizeBytes: st?.size ?? 0,
    });
  }
  return { tables, migrations };
}

function countColumnsAfter(content, openIdx) {
  const slice = content.slice(openIdx, openIdx + 4000);
  const open = slice.indexOf("(");
  if (open < 0) return 0;
  let depth = 0;
  let count = 1;
  for (let i = open; i < slice.length; i++) {
    const c = slice[i];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return count; }
    else if (c === "," && depth === 1) count++;
  }
  return count;
}

// ── Routes ─────────────────────────────────────────────────────────────────

const ROUTE_RE = /\b(?:app|router)\s*\.\s*(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/g;
const MOUNT_RE = /\bapp\s*\.\s*use\s*\(\s*["']([^"']+)["']\s*,\s*([a-zA-Z_$][\w$]*)/g;

async function parseRoutes(repoRoot) {
  const serverDir = path.join(repoRoot, SERVER_DIR_NAME);
  const routesDir = path.join(serverDir, "routes");
  const out = [];

  // Routes inside server.js
  const serverJs = path.join(serverDir, "server.js");
  const serverContent = await readSafe(serverJs);
  let m;
  ROUTE_RE.lastIndex = 0;
  while ((m = ROUTE_RE.exec(serverContent))) {
    out.push({
      method: m[1].toUpperCase(),
      path: m[2],
      file: "server/server.js",
      line: lineOf(serverContent, m.index),
      mountedUnder: "/",
    });
  }

  // Mount sites in server.js (router files mounted under prefix)
  const mounts = new Map();
  MOUNT_RE.lastIndex = 0;
  while ((m = MOUNT_RE.exec(serverContent))) {
    mounts.set(m[2], m[1]);
  }

  // Routes inside server/routes/*.js
  let routeFiles = [];
  try { routeFiles = (await readdir(routesDir)).filter(f => f.endsWith(".js")); } catch { /* ignore */ }
  for (const f of routeFiles) {
    const full = path.join(routesDir, f);
    const content = await readSafe(full);
    const factory = guessFactoryName(content);
    const mountedUnder = factory ? mounts.get(factory) ?? null : null;
    ROUTE_RE.lastIndex = 0;
    let r;
    while ((r = ROUTE_RE.exec(content))) {
      out.push({
        method: r[1].toUpperCase(),
        path: r[2],
        file: `server/routes/${f}`,
        line: lineOf(content, r.index),
        mountedUnder: mountedUnder ?? "(unmounted)",
      });
    }
  }

  return out;
}

function guessFactoryName(content) {
  const m = content.match(/export\s+function\s+(create[A-Z][\w]*)/) ||
            content.match(/export\s+default\s+function\s+(create[A-Z][\w]*)/) ||
            content.match(/function\s+(create[A-Z][\w]*)\s*\(/);
  return m ? m[1] : null;
}

// ── Socket events ─────────────────────────────────────────────────────────

const SOCKET_RE_LIST = [
  { name: "realtimeEmit",    re: /\brealtimeEmit\s*\(\s*["']([^"']+)["']/g },
  { name: "io.to.emit",      re: /\bio\s*\.\s*to\s*\([^)]*\)\s*\.\s*emit\s*\(\s*["']([^"']+)["']/g },
  { name: "io.emit",         re: /\bio\s*\.\s*emit\s*\(\s*["']([^"']+)["']/g },
  { name: "socket.emit",     re: /\bsocket\s*\.\s*emit\s*\(\s*["']([^"']+)["']/g },
  { name: "io.locals.emit",  re: /req\.app\.locals\.io\??\.\s*to\s*\([^)]*\)\s*\.\s*emit\s*\(\s*["']([^"']+)["']/g },
];

async function parseSocketEvents(repoRoot) {
  const serverDir = path.join(repoRoot, SERVER_DIR_NAME);
  const files = await walk(serverDir, [".js"]);
  const out = [];
  for (const f of files) {
    const content = await readSafe(f);
    for (const { name, re } of SOCKET_RE_LIST) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content))) {
        out.push({
          event: m[1],
          file: path.relative(repoRoot, f),
          line: lineOf(content, m.index),
          emitter: name,
        });
      }
    }
  }
  return out;
}

// ── Env vars ──────────────────────────────────────────────────────────────

const ENV_RE = /\bprocess\.env\.(CONCORD_[A-Z0-9_]+)\b/g;

async function parseEnvVars(repoRoot) {
  const serverDir = path.join(repoRoot, SERVER_DIR_NAME);
  const files = await walk(serverDir, [".js"]);
  const map = new Map();
  for (const f of files) {
    const content = await readSafe(f);
    let m;
    ENV_RE.lastIndex = 0;
    while ((m = ENV_RE.exec(content))) {
      const name = m[1];
      const ref = { file: path.relative(repoRoot, f), line: lineOf(content, m.index) };
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(ref);
    }
  }
  return Array.from(map, ([name, refs]) => ({ name, refs }));
}

// ── Macro registration callsites ──────────────────────────────────────────

const MACRO_REGISTER_RE = /\bregister\s*\(\s*["']([a-z_][a-z0-9_]*)["']\s*,\s*["']([a-z_][a-z0-9_]*)["']/g;

async function parseMacroCallsites(repoRoot) {
  const serverJs = path.join(repoRoot, SERVER_DIR_NAME, "server.js");
  const content = await readSafe(serverJs);
  const out = [];
  let m;
  MACRO_REGISTER_RE.lastIndex = 0;
  while ((m = MACRO_REGISTER_RE.exec(content))) {
    out.push({
      domain: m[1], name: m[2],
      file: "server/server.js",
      line: lineOf(content, m.index),
    });
  }
  return out;
}

// ── Heartbeat callsites ───────────────────────────────────────────────────

const HEARTBEAT_RE = /\bregisterHeartbeat\s*\(\s*["']([a-z_-][a-z0-9_-]*)["']\s*,\s*\{[^}]*frequency\s*:\s*(\d+)/g;

async function parseHeartbeatCallsites(repoRoot) {
  const serverJs = path.join(repoRoot, SERVER_DIR_NAME, "server.js");
  const content = await readSafe(serverJs);
  const out = [];
  let m;
  HEARTBEAT_RE.lastIndex = 0;
  while ((m = HEARTBEAT_RE.exec(content))) {
    out.push({
      id: m[1],
      frequency: parseInt(m[2], 10),
      file: "server/server.js",
      line: lineOf(content, m.index),
    });
  }
  return out;
}

// ── Frontend lens directories ─────────────────────────────────────────────

async function parseLensDirs(repoRoot) {
  const lensRoot = path.join(repoRoot, FRONTEND_DIR_NAME, "app", "lenses");
  const out = [];
  let entries;
  try { entries = await readdir(lensRoot, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const pageTsx = path.join(lensRoot, e.name, "page.tsx");
    let pageBytes = 0;
    try { pageBytes = (await stat(pageTsx)).size; } catch { /* missing */ }
    out.push({ name: e.name, hasPage: pageBytes > 0, pageBytes });
  }
  return out;
}

// ── Table reference scan (for dead-table detection) ──────────────────────

async function parseTableRefs(repoRoot, tableNames) {
  if (!tableNames || tableNames.length === 0) return new Map();
  const serverDir = path.join(repoRoot, SERVER_DIR_NAME);
  const files = await walk(serverDir, [".js"], ["node_modules", ".git", ".next", "dist", "build", "migrations", "data", "audit"]);
  const refs = new Map(tableNames.map(t => [t, 0]));
  const refRe = new RegExp(`\\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\\s+(${tableNames.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
  for (const f of files) {
    const content = await readSafe(f);
    let m;
    refRe.lastIndex = 0;
    while ((m = refRe.exec(content))) {
      const t = m[1];
      refs.set(t, (refs.get(t) || 0) + 1);
    }
  }
  return refs;
}

// ── Public entry ──────────────────────────────────────────────────────────

export async function staticParseAll(repoRoot) {
  const t0 = Date.now();
  const [{ tables, migrations }, routes, socketEvents, envVars, macroCallsites, heartbeatCallsites, lensDirs] = await Promise.all([
    parseMigrations(path.join(repoRoot, SERVER_DIR_NAME)),
    parseRoutes(repoRoot),
    parseSocketEvents(repoRoot),
    parseEnvVars(repoRoot),
    parseMacroCallsites(repoRoot),
    parseHeartbeatCallsites(repoRoot),
    parseLensDirs(repoRoot),
  ]);
  const tableRefs = await parseTableRefs(repoRoot, tables.map(t => t.name));
  return {
    tables, migrations, routes, socketEvents, envVars,
    macroCallsites, heartbeatCallsites, lensDirs,
    tableRefs: Array.from(tableRefs, ([name, count]) => ({ name, count })),
    elapsedMs: Date.now() - t0,
  };
}

export { walk, readSafe, lineOf };
