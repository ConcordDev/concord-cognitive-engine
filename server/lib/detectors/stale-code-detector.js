// server/lib/detectors/stale-code-detector.js
//
// Finds dead code:
//   - macros declared via register("d","n", …) that no callsite invokes
//     (search runMacro / lens.run / domains in lens-manifest)
//   - express routes with no client-side fetch reference
//   - migration tables with no SELECT/INSERT/UPDATE/DELETE callsite
//   - emergent/lib modules that no other file imports
//
// Conservative: each rule has explicit allow-paths so legitimate dynamic
// dispatch isn't reported as dead.

import path from "node:path";
import {
  walk, readSafe, makeReport, makeError, lineOf, relPath, snippet,
  loadOpenDispatchers, loadLensManifestMacros,
} from "./_framework.js";

// Macros that are public via the lens manifest / chat router are dispatched
// dynamically; the static parse can miss them. We treat them as live if
// their domain appears in the lens manifest. Used as a defense-in-depth
// fallback when the dispatcher annotation isn't present.
const DYNAMIC_DOMAINS_HINT = new Set([
  "chat", "lens", "atlas", "dtu", "system", "settings",
]);

const ROUTE_RE = /\b(?:app|router)\.(get|post|put|patch|delete|head)\s*\(\s*['"`]([^'"`]+)['"`]/g;
const REGISTER_RE = /register\s*\(\s*['"`]([a-zA-Z0-9_-]+)['"`]\s*,\s*['"`]([a-zA-Z0-9_.\-]+)['"`]/g;
const RUN_MACRO_RE = /runMacro\s*\(\s*['"`]([a-zA-Z0-9_-]+)['"`]\s*,\s*['"`]([a-zA-Z0-9_.\-]+)['"`]/g;
const LENS_RUN_BODY_RE = /domain\s*:\s*['"`]([a-zA-Z0-9_-]+)['"`]\s*,\s*name\s*:\s*['"`]([a-zA-Z0-9_.\-]+)['"`]/g;
const TABLE_DDL_RE = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
const TABLE_REF_RE = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
// Recognize tables retired by later migrations. A table flagged orphan
// purely because the read sites disappeared but the CREATE remains
// shouldn't be reported once a DROP migration has shipped.
const TABLE_DROP_RE = /DROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
// Migrations 120-124 use a shared rescue helper — pull table names out of
// the array literal too.
const RESCUE_DROP_RE = /dropDeadTables\s*\(\s*[a-zA-Z_]\w*\s*,\s*\[([^\]]*)\]/g;
const IMPORT_RE = /(?:import\s+(?:[^'"`]+?\s+from\s+)?['"`]([^'"`]+)['"`])|(?:require\s*\(\s*['"`]([^'"`]+)['"`]\s*\))|(?:import\s*\(\s*['"`]([^'"`]+)['"`]\s*\))/g;

// Tables that are populated externally (writes from migrations only) or are
// system-level — exclude from dead-table flagging.
const SYSTEM_TABLES = new Set([
  "schema_version", "schema_migrations", "_sqlite_sequence", "sqlite_sequence",
  "sqlite_master", "sqlite_temp_master",
]);

// Modules that are wired dynamically (heartbeat-registry imports, dynamic
// router mount loops). Static parse will report them as orphans incorrectly.
const DYNAMIC_LOAD_HINT = [
  /server\/scripts\//,
  /server\/migrations\//,
  /server\/tests\//,
  /server\/routes\//,    // mounted by app.use loop
  /server\/domains\//,   // wired via domain registration scan
  /server\/emergent\//,  // wired via module-registry / heartbeat-registry
  /\.test\.js$/,
  /server\/server\.js$/,
];

export async function runStaleCodeDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("stale-code", "no_root", null, t0);

  try {
    const serverDir = path.join(root, "server");
    const frontendDir = path.join(root, "concord-frontend");

    const serverFiles = await walk(serverDir, [".js"]);
    const frontendFiles = await walk(frontendDir, [".js", ".ts", ".tsx", ".jsx"]);

    // Open dispatchers + lens manifest entries — macros reachable via these
    // are NOT dead even if no static callsite mentions them by name.
    const dispatchers = await loadOpenDispatchers(root);
    const dispatcherActive = dispatchers.length > 0;
    const manifestKeys = await loadLensManifestMacros(root);

    const findings = [];

    // ── 1. Dead macros ────────────────────────────────────────────────────
    const declared = new Map(); // "domain.name" -> { file, line }
    const calls = new Set();   // "domain.name"

    for (const f of serverFiles) {
      const c = await readSafe(f);
      if (!c) continue;
      // Skip the test files for declarations (test fixtures register fake macros)
      const isTest = /\/tests\//.test(f);

      let m;
      REGISTER_RE.lastIndex = 0;
      while ((m = REGISTER_RE.exec(c)) != null) {
        if (isTest) continue;
        const key = `${m[1]}.${m[2]}`;
        if (!declared.has(key)) {
          declared.set(key, { file: relPath(root, f), line: lineOf(c, m.index) });
        }
      }
      RUN_MACRO_RE.lastIndex = 0;
      while ((m = RUN_MACRO_RE.exec(c)) != null) calls.add(`${m[1]}.${m[2]}`);
      LENS_RUN_BODY_RE.lastIndex = 0;
      while ((m = LENS_RUN_BODY_RE.exec(c)) != null) calls.add(`${m[1]}.${m[2]}`);
    }
    for (const f of frontendFiles) {
      const c = await readSafe(f);
      if (!c) continue;
      let m;
      RUN_MACRO_RE.lastIndex = 0;
      while ((m = RUN_MACRO_RE.exec(c)) != null) calls.add(`${m[1]}.${m[2]}`);
      LENS_RUN_BODY_RE.lastIndex = 0;
      while ((m = LENS_RUN_BODY_RE.exec(c)) != null) calls.add(`${m[1]}.${m[2]}`);
    }

    for (const [key, loc] of declared.entries()) {
      const [domain] = key.split(".");
      if (calls.has(key)) continue;
      // Whole-domain consumer (chat / atlas / dtu) — they're called via
      // pattern dispatch from lens manifests; allow.
      if (DYNAMIC_DOMAINS_HINT.has(domain)) continue;
      // Reachable via open dispatcher (POST /api/macros/run) OR lens manifest?
      // These are not dead — they're dynamically invokable.
      if (dispatcherActive || manifestKeys.has(key)) continue;
      findings.push({
        id: "macro_unused",
        severity: "low",
        kind: "static",
        category: "stale-code",
        message: `Macro ${key} is registered but never called by name`,
        location: `${loc.file}:${loc.line}`,
        evidence: { domain, name: key.split(".").slice(1).join(".") },
      });
    }

    // ── 2. Orphan tables ──────────────────────────────────────────────────
    const tables = new Map(); // tableName -> { file, line }
    const tableUses = new Set();

    const migrationsDir = path.join(serverDir, "migrations");
    const migrationFiles = serverFiles.filter(f => f.startsWith(migrationsDir + path.sep));
    // Track which migration files each table is touched in — used to
    // detect `_fix` staging tables (created and renamed back within the
    // same migration; e.g. mig 107).
    const tableMigrations = new Map(); // tableName -> Set<migration file content>
    // Tables that any later migration drops — either via raw `DROP TABLE`
    // or via the shared `dropDeadTables(db, [...])` helper used by 120-124.
    const droppedTables = new Set();
    for (const f of migrationFiles) {
      const c = await readSafe(f);
      if (!c) continue;
      let m;
      TABLE_DDL_RE.lastIndex = 0;
      while ((m = TABLE_DDL_RE.exec(c)) != null) {
        const t = m[1].toLowerCase();
        if (SYSTEM_TABLES.has(t)) continue;
        if (!tables.has(t)) tables.set(t, { file: relPath(root, f), line: lineOf(c, m.index) });
        if (!tableMigrations.has(t)) tableMigrations.set(t, new Set());
        tableMigrations.get(t).add(c);
      }
      TABLE_DROP_RE.lastIndex = 0;
      while ((m = TABLE_DROP_RE.exec(c)) != null) {
        droppedTables.add(m[1].toLowerCase());
      }
      RESCUE_DROP_RE.lastIndex = 0;
      while ((m = RESCUE_DROP_RE.exec(c)) != null) {
        // Pull individual quoted strings out of the array literal body.
        for (const lit of m[1].matchAll(/['"`]([a-zA-Z_][a-zA-Z0-9_]*)['"`]/g)) {
          droppedTables.add(lit[1].toLowerCase());
        }
      }
    }
    for (const f of serverFiles) {
      if (f.startsWith(migrationsDir + path.sep)) continue;
      const c = await readSafe(f);
      if (!c) continue;
      let m;
      TABLE_REF_RE.lastIndex = 0;
      while ((m = TABLE_REF_RE.exec(c)) != null) {
        tableUses.add(m[1].toLowerCase());
      }
    }
    for (const [t, loc] of tables.entries()) {
      if (tableUses.has(t)) continue;
      // Already retired by a later DROP migration — don't flag.
      if (droppedTables.has(t)) continue;
      // `_fix` staging tables — created in a migration that ALSO renames
      // or drops them in the same file (mig 107 pattern). Skip.
      if (t.endsWith("_fix")) {
        const base = t.slice(0, -"_fix".length);
        const migrationsContent = Array.from(tableMigrations.get(t) || []);
        const renamesOrDrops = migrationsContent.some(mc =>
          new RegExp(`ALTER\\s+TABLE\\s+${t}\\s+RENAME\\s+TO\\s+${base}\\b`, "i").test(mc) ||
          new RegExp(`DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?\\s+${t}\\b`, "i").test(mc),
        );
        if (renamesOrDrops) continue;
      }
      findings.push({
        id: "table_orphan",
        severity: "medium",
        kind: "static",
        category: "stale-code",
        message: `Table ${t} is created but never read or written outside migrations`,
        location: `${loc.file}:${loc.line}`,
        evidence: { table: t },
        fixHint: "drop_via_migration_or_wire_consumer",
      });
    }

    // ── 3. Ghost modules (lib/ files no one imports) ─────────────────────
    const libDir = path.join(serverDir, "lib");
    const emergentDir = path.join(serverDir, "emergent");
    const allCandidates = serverFiles.filter(f =>
      (f.startsWith(libDir + path.sep) || f.startsWith(emergentDir + path.sep)) &&
      !DYNAMIC_LOAD_HINT.some(re => re.test(f)) &&
      !/\.test\.js$/.test(f) &&
      !/[/\\]index\.js$/.test(f),
    );
    const importBags = new Set();
    const allFiles = serverFiles.concat(frontendFiles);
    for (const f of allFiles) {
      const c = await readSafe(f);
      if (!c) continue;
      let m;
      IMPORT_RE.lastIndex = 0;
      while ((m = IMPORT_RE.exec(c)) != null) {
        const spec = m[1] || m[2] || m[3];
        if (!spec) continue;
        if (!spec.startsWith(".") && !spec.startsWith("/")) continue;
        const target = path.resolve(path.dirname(f), spec.replace(/\.(js|ts|tsx|jsx)$/, ""));
        importBags.add(target);
        importBags.add(target + ".js");
        importBags.add(target + "/index.js");
      }
    }
    for (const cand of allCandidates) {
      const stem = cand.replace(/\.js$/, "");
      if (importBags.has(cand) || importBags.has(stem) || importBags.has(stem + "/index.js")) continue;
      // Exempt files referenced via runtime introspection registries
      const c = await readSafe(cand);
      if (/registerHeartbeat\(|register\(\s*['"`]/.test(c)) continue;
      findings.push({
        id: "module_orphan",
        severity: "low",
        kind: "static",
        category: "stale-code",
        message: `Module is never imported`,
        location: relPath(root, cand),
        evidence: { hint: "verify before deletion — may be loaded dynamically" },
      });
    }

    // ── 4. Dead routes ────────────────────────────────────────────────────
    const declaredRoutes = new Map(); // METHOD path -> {file, line}
    for (const f of serverFiles) {
      if (f.includes("/scripts/") || /\.test\.js$/.test(f)) continue;
      const c = await readSafe(f);
      if (!c) continue;
      let m;
      ROUTE_RE.lastIndex = 0;
      while ((m = ROUTE_RE.exec(c)) != null) {
        const method = m[1].toUpperCase();
        const route = m[2];
        const key = `${method} ${route}`;
        if (!declaredRoutes.has(key)) declaredRoutes.set(key, { file: relPath(root, f), line: lineOf(c, m.index) });
      }
    }
    // For dead-route detection, look for fetch("…path…") strings in frontend.
    const fetchTargets = new Set();
    for (const f of frontendFiles) {
      const c = await readSafe(f);
      if (!c) continue;
      const re = /['"`](\/api\/[a-zA-Z0-9_/:.\-]+)['"`]/g;
      let m;
      while ((m = re.exec(c)) != null) fetchTargets.add(m[1].split("?")[0]);
    }

    // Be conservative: flag only routes that have NO substring match in any
    // frontend fetch target. Routes with :params count as referenced if any
    // frontend URL begins with the same prefix.
    const fetchTargetsArr = Array.from(fetchTargets);
    let routeOrphanCount = 0;
    for (const [key, loc] of declaredRoutes.entries()) {
      const [, route] = key.split(" ", 2);
      const cleanRoute = route.replace(/:\w+/g, "");
      const cleanRouteParts = cleanRoute.split("/").filter(Boolean);
      if (cleanRouteParts.length < 2) continue;
      const stem = "/" + cleanRouteParts.slice(0, 3).join("/");
      const hasMatch = fetchTargetsArr.some(t => t.startsWith(stem));
      if (hasMatch) continue;
      // Also referenced from server-side tests / scripts?
      // We deliberately only count frontend fetches — internal routes
      // wired from server-side admin tools are out-of-scope here.
      if (routeOrphanCount >= 200) break; // bound the report
      routeOrphanCount++;
      findings.push({
        id: "route_orphan",
        severity: "info",
        kind: "static",
        category: "stale-code",
        message: `Route ${key} has no frontend caller`,
        location: `${loc.file}:${loc.line}`,
        evidence: snippet(key),
      });
    }

    return makeReport("stale-code", findings, t0);
  } catch (err) {
    return makeError("stale-code", "exception", err, t0);
  }
}
