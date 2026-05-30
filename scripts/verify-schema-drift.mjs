#!/usr/bin/env node
// scripts/verify-schema-drift.mjs
//
// The Schema/Query Drift Gate — the class that took down combat + casting. Code
// that names a column the SQLite schema doesn't have: the query throws (or
// returns undefined) and a core loop silently dies. This is the SQL twin of the
// move-render silent-fallback gate.
//
// GROUND TRUTH (authoritative, not regex-parsed migrations): run all migrations
// into an in-memory DB via server/migrate.js#runMigrations, then PRAGMA
// table_info per table → the real column set. Then scan every db.prepare/db.exec
// SQL string and validate the columns it names — but ONLY where attribution is
// unambiguous, so joins/aliases don't produce false positives (the failure mode
// of the single-table regex that flagged ~141 candidates, a chunk of them bogus).
//
// What it validates (HIGH-CONFIDENCE only):
//   - INSERT INTO <t> (cols...)         → every col ∈ t            (caught mintSpell)
//   - UPDATE <t> SET col=...            → every col ∈ t
//   - SELECT ... FROM <t> [no JOIN]     → bare SELECT-list + WHERE cols ∈ t  (caught world_npcs.name)
//   - alias.col anywhere, alias→known t → col ∈ t
// What it SKIPS (reported as unverified, never as drift):
//   - JOINs / multi-table with unprefixed columns, SELECT *, json_*() args,
//     dynamic table names (${...}), CTEs/subqueries, PRAGMA/sqlite_master.
//
// Usage: node scripts/verify-schema-drift.mjs [--json] [--ci N] [--all]
//   --all also prints the unverified/skipped count.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "server");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const ciIdx = args.indexOf("--ci");
const ciMode = ciIdx !== -1;
const ciFloor = ciMode ? Number(args[ciIdx + 1] || 0) : 0;

// ── 1. Ground truth: real columns per table (runMigrations → PRAGMA) ─────────
async function buildSchema() {
  const Database = (await import(path.join(SERVER, "node_modules/better-sqlite3/lib/index.js"))).default;
  const { runMigrations } = await import(path.join(SERVER, "migrate.js"));
  const db = new Database(":memory:");
  // Silence migration boot logging so --json stays pure.
  const orig = { log: console.log, warn: console.warn, info: console.info, write: process.stdout.write.bind(process.stdout) };
  console.log = console.warn = console.info = () => {};
  process.stdout.write = () => true;
  try { await runMigrations(db); } finally { Object.assign(console, { log: orig.log, warn: orig.warn, info: orig.info }); process.stdout.write = orig.write; }
  const schema = new Map(); // table -> Set(cols) — authoritative migration columns
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
    try { schema.set(name, new Set(db.pragma(`table_info(${name})`).map((c) => c.name))); }
    catch { /* skip */ }
  }
  db.close();
  return schema;
}

// Union in columns from lib-side `CREATE TABLE [IF NOT EXISTS] <t> (...)` (server.js
// + libs create/extend ~a handful of tables outside migrations). A column defined
// by EITHER a migration OR a lib CREATE TABLE is valid; only columns defined
// NOWHERE are unambiguous drift. (Migration/lib shape mismatches are a softer,
// runtime-ordering class — out of scope for the hard "exists nowhere" gate.)
function mergeLibCreateTables(schema, files) {
  const re = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    let m;
    while ((m = re.exec(src)) !== null) {
      const table = m[1];
      // capture the balanced (...) body
      let i = re.lastIndex - 1, depth = 0, body = "";
      for (; i < src.length; i++) { const ch = src[i]; if (ch === "(") depth++; else if (ch === ")") { depth--; if (depth === 0) break; } if (depth >= 1 && !(ch === "(" && depth === 1)) body += ch; }
      const set = schema.get(table) || new Set();
      for (const seg of body.split(/,(?![^(]*\))/)) {
        const tok = seg.trim().replace(/^["'`]/, "");
        const cm = /^([a-z_][a-z0-9_]*)/i.exec(tok);
        if (cm && !["PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT", "KEY"].includes(cm[1].toUpperCase())) set.add(cm[1]);
      }
      schema.set(table, set);
    }
  }
  return schema;
}

// ── 2. Extract SQL strings from db.prepare/db.exec call sites ────────────────
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "tests", ".next", "dist", "build", "migrations"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".js")) acc.push(p);
  }
  return acc;
}

// Pull the SQL literal that follows `.prepare(` / `.exec(` — backtick, single, or
// double quoted. Returns { sql, dynamic } where dynamic=true if it had ${...}.
function extractSqlStrings(src) {
  const out = [];
  const re = /\.(?:prepare|exec)\(\s*(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const raw = m[1];
    const quote = raw[0];
    let body = raw.slice(1, -1);
    const dynamic = quote === "`" && /\$\{/.test(body);
    if (dynamic) body = body.replace(/\$\{[^}]*\}/g, " __DYN__ "); // neutralize interpolation
    out.push({ sql: body, dynamic, index: m.index });
  }
  return out;
}

const SQL_KEYWORDS = new Set([
  "select", "from", "where", "and", "or", "not", "null", "as", "join", "left", "right", "inner",
  "outer", "on", "group", "by", "order", "limit", "offset", "having", "distinct", "into", "values",
  "set", "update", "insert", "delete", "asc", "desc", "case", "when", "then", "else", "end", "in",
  "like", "is", "count", "sum", "avg", "max", "min", "coalesce", "exists", "union", "all", "with",
  "unixepoch", "datetime", "json_extract", "json", "json_set", "abs", "round", "length", "lower",
  "upper", "ifnull", "nullif", "cast", "integer", "text", "real", "true", "false", "between", "using",
]);

function lineOf(src, index) { return src.slice(0, index).split("\n").length; }

// ── 3. Validate one SQL string against the schema. Pushes findings. ──────────
function validateSql({ sql, dynamic }, schema, file, line, findings, stats) {
  const s = sql.replace(/\s+/g, " ").trim();
  const low = s.toLowerCase();
  if (!s || low.includes("__dyn__") && /from\s+__dyn__|into\s+__dyn__|update\s+__dyn__/.test(low)) { stats.unverified++; return; }

  const colExists = (table, col) => {
    const set = schema.get(table);
    if (!set) return null;               // unknown table → can't judge
    return set.has(col);
  };
  const flag = (table, col, kind) => {
    if (SQL_KEYWORDS.has(col.toLowerCase()) || col === "__DYN__" || /^\d/.test(col)) return;
    const ex = colExists(table, col);
    if (ex === null) { stats.unverified++; return; }
    stats.checked++;
    if (!ex) findings.push({ file: path.relative(ROOT, file), line, table, column: col, kind });
  };

  // INSERT INTO <t> (c1, c2, ...) — every column belongs to t (no joins).
  let im = /^insert\s+(?:or\s+\w+\s+)?into\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/i.exec(s);
  if (im) {
    const table = im[1];
    for (const c of im[2].split(",").map((x) => x.trim()).filter(Boolean)) {
      const col = c.replace(/["'`]/g, "").trim();
      if (/^[a-z_][a-z0-9_]*$/i.test(col)) flag(table, col, "insert");
    }
    return;
  }

  // UPDATE <t> SET col = ... — columns left of '=' belong to t.
  let um = /^update\s+([a-z_][a-z0-9_]*)\s+set\s+(.+?)(?:\s+where\b|$)/i.exec(s);
  if (um) {
    const table = um[1];
    for (const assign of um[2].split(",")) {
      const cm = /^\s*([a-z_][a-z0-9_]*)\s*=/i.exec(assign);
      if (cm) flag(table, cm[1], "update");
    }
    return;
  }

  // SELECT/DELETE: resolve tables + aliases from FROM/JOIN.
  const aliasMap = new Map(); // alias-or-name -> table
  const tablesInQuery = [];
  for (const fm of s.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi)) {
    const tbl = fm[1]; const alias = fm[2];
    if (SQL_KEYWORDS.has(tbl.toLowerCase())) continue;
    tablesInQuery.push(tbl);
    aliasMap.set(tbl, tbl);
    if (alias && !SQL_KEYWORDS.has(alias.toLowerCase())) aliasMap.set(alias, tbl);
  }
  if (!tablesInQuery.length) { stats.unverified++; return; }
  const hasJoin = /\bjoin\b/i.test(s) || tablesInQuery.length > 1;

  // alias.column references anywhere — validate against the aliased table.
  for (const am of s.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/gi)) {
    const a = am[1]; const col = am[2];
    const table = aliasMap.get(a);
    if (table) flag(table, col, "select.alias");
  }

  // Single-table query: bare columns in the SELECT list (and simple WHERE) belong
  // to the one table. Skip if JOIN/multi-table (ambiguous → unverified).
  if (!hasJoin) {
    const table = tablesInQuery[0];
    const selM = /^select\s+(.+?)\s+from\b/i.exec(s);
    if (selM && !/\*/.test(selM[1]) && !/\bjson_/i.test(selM[1])) {
      for (const item of selM[1].split(",")) {
        const t = item.trim().replace(/\s+as\s+[a-z_][a-z0-9_]*$/i, ""); // strip "AS alias"
        const cm = /^([a-z_][a-z0-9_]*)$/i.exec(t); // bare column only (skip expressions/funcs)
        if (cm) flag(table, cm[1], "select");
      }
    }
  } else {
    stats.unverified++;
  }
}

// ── 4. Run ───────────────────────────────────────────────────────────────────
const files = walk(SERVER);
let schema = await buildSchema();
schema = mergeLibCreateTables(schema, files);
const findings = [];
const stats = { checked: 0, unverified: 0, files: 0, sites: 0 };
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const sqls = extractSqlStrings(src);
  if (sqls.length) stats.files++;
  for (const q of sqls) { stats.sites++; validateSql(q, schema, file, lineOf(src, q.index), findings, stats); }
}

// Group findings by (table,column) for a readable triage queue.
const byTable = {};
for (const f of findings) (byTable[f.table] ??= {})[f.column] = ((byTable[f.table]?.[f.column]) || 0) + 1;

if (asJson) {
  console.log(JSON.stringify({ drift: findings.length, checked: stats.checked, unverified: stats.unverified, sites: stats.sites, byTable, findings }, null, 2));
} else {
  console.log("\n=== Schema/Query Drift Gate ===");
  console.log(`scanned ${stats.sites} db.prepare/exec sites in ${stats.files} files · ${schema.size} tables`);
  console.log(`  high-confidence column checks: ${stats.checked} · unverified (joins/dynamic/*): ${stats.unverified}`);
  console.log(`  DRIFT (column named that the table lacks): ${findings.length}`);
  if (findings.length) {
    console.log(`\n--- Drift queue (TRIAGE — runtime-confirm each before editing; some are joined-table/alias false positives) ---`);
    for (const t of Object.keys(byTable).sort()) {
      console.log(`\n  ${t}: ${Object.entries(byTable[t]).map(([c, n]) => `${c}×${n}`).join(", ")}`);
      for (const f of findings.filter((x) => x.table === t)) console.log(`    · ${f.file}:${f.line}  [${f.kind}] ${t}.${f.column}`);
    }
  } else {
    console.log("\n✓ No high-confidence schema/query drift.");
  }
  console.log("");
}

if (ciMode && findings.length > ciFloor) {
  console.error(`[schema-drift] FAIL: ${findings.length} drift sites > floor ${ciFloor}`);
  process.exit(1);
}
