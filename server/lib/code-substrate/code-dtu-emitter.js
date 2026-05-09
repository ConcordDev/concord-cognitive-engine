// server/lib/code-substrate/code-dtu-emitter.js
//
// Phase 7 / T2 — Code-DTU emitter.
//
// Walks the cartograph runtime introspect output (or, when unavailable,
// re-reads the source tree) and emits one DTU per:
//   - HTTP route
//   - Migration file
//   - Module under server/{lib, emergent, domains, economy}
//   - Macro registration
//
// DTU shape (kind='code_artifact'):
//   {
//     id: "code:<sha1(path:line:kind)>",
//     kind: 'code_artifact',
//     scope: 'system',
//     human: "<one-line summary derived from JSDoc / first comment / fn name>",
//     core: { path, artifact_kind, importers, exports, last_changed_sha,
//             detector_findings, loc, domain_tags },
//     machine: { domain_tags },
//     artifact: null
//   }
//
// Idempotent — re-emitting with the same path/kind updates the row in place.

import path from "node:path";
import crypto from "node:crypto";
import { walk, readSafe, relPath } from "../detectors/_framework.js";

const ROUTE_RE = /\b(?:app|router)\.(get|post|put|patch|delete|head)\s*\(\s*['"`]([^'"`]+)['"`]/g;
const REGISTER_RE = /register\s*\(\s*['"`]([a-zA-Z0-9_-]+)['"`]\s*,\s*['"`]([a-zA-Z0-9_.-]+)['"`]/g;
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm;
const FIRST_COMMENT_RE = /^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/\s*\n)+/;
const JSDOC_FIRST_RE = /^\s*\/\*\*([\s\S]*?)\*\//;

function makeId(p, line, artifactKind) {
  const h = crypto.createHash("sha1");
  h.update(`${p}:${line}:${artifactKind}`);
  return `code:${h.digest("hex").slice(0, 16)}`;
}

function summaryFor(content) {
  if (!content) return "";
  const jsdoc = JSDOC_FIRST_RE.exec(content);
  if (jsdoc) {
    const firstSentence = jsdoc[1].split("\n").map(l => l.replace(/^\s*\*\s*/, "").trim()).filter(Boolean)[0] || "";
    if (firstSentence) return firstSentence.slice(0, 200);
  }
  const m = FIRST_COMMENT_RE.exec(content);
  if (m) {
    const line1 = m[0].split("\n")[0].replace(/^\/\/\s*/, "").trim();
    if (line1) return line1.slice(0, 200);
  }
  return "";
}

function deriveTags(p) {
  const tags = new Set();
  if (/economy|royalty|marketplace|stripe|fee/.test(p)) tags.add("economy");
  if (/persistence|snapshot|backup/.test(p)) tags.add("persistence");
  if (/narrative|oracle|npc|dialogue/.test(p)) tags.add("narrative");
  if (/world|concordia|physics|terrain/.test(p)) tags.add("world");
  if (/refusal-field|sovereign|invariant/.test(p)) tags.add("invariants");
  if (/detector|repair-cortex|prophet|guardian|surgeon|reflex/.test(p)) tags.add("self-care");
  if (/migrations\//.test(p)) tags.add("schema");
  if (/routes\//.test(p)) tags.add("http");
  if (/lib\/governance|council|voting/.test(p)) tags.add("governance");
  if (/auth|jwt|cookie/.test(p)) tags.add("auth");
  return [...tags];
}

/**
 * Emit code-artifact DTUs into the dtus table. Returns counts.
 *
 * @param {object} db
 * @param {string} root
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] — collect without inserting
 */
export async function emitCodeDtus(db, root, opts = {}) {
  if (!db || !root) return { ok: false, reason: "missing_db_or_root" };

  const out = { modules: 0, migrations: 0, routes: 0, macros: 0, skipped: 0, errors: [] };
  const collected = [];

  const collect = (dtu) => {
    collected.push(dtu);
    out[dtu.core.artifact_kind === "module" ? "modules"
       : dtu.core.artifact_kind === "migration" ? "migrations"
       : dtu.core.artifact_kind === "route" ? "routes"
       : dtu.core.artifact_kind === "macro" ? "macros" : "skipped"]++;
  };

  // ── Modules under server/{lib, emergent, domains, economy} ────────────
  const moduleDirs = ["lib", "emergent", "domains", "economy"].map(d => path.join(root, "server", d));
  const moduleFiles = (await Promise.all(moduleDirs.map(d => walk(d, [".js"])))).flat();
  for (const f of moduleFiles) {
    if (/\.test\.js$/.test(f) || /\/tests?\//.test(f)) continue;
    const c = await readSafe(f);
    if (!c) continue;
    const rel = relPath(root, f);
    const exports = [];
    EXPORT_RE.lastIndex = 0;
    let m;
    while ((m = EXPORT_RE.exec(c)) != null) exports.push(m[1]);
    collect({
      id: makeId(rel, 1, "module"),
      kind: "code_artifact",
      scope: "system",
      human: summaryFor(c) || `Module: ${path.basename(rel)}`,
      core: {
        path: rel,
        artifact_kind: "module",
        exports: exports.slice(0, 50),
        loc: c.split("\n").length,
        domain_tags: deriveTags(rel),
      },
      machine: { domain_tags: deriveTags(rel) },
      artifact: null,
    });
  }

  // ── Migrations ─────────────────────────────────────────────────────────
  const migrationFiles = await walk(path.join(root, "server", "migrations"), [".js"]);
  for (const f of migrationFiles) {
    const c = await readSafe(f);
    if (!c) continue;
    const rel = relPath(root, f);
    collect({
      id: makeId(rel, 1, "migration"),
      kind: "code_artifact",
      scope: "system",
      human: summaryFor(c) || `Migration: ${path.basename(rel)}`,
      core: {
        path: rel,
        artifact_kind: "migration",
        loc: c.split("\n").length,
        domain_tags: ["schema"],
      },
      machine: { domain_tags: ["schema"] },
      artifact: null,
    });
  }

  // ── Routes (parse all server/routes + server.js for app.<verb>) ────────
  const routeFiles = [
    ...await walk(path.join(root, "server", "routes"), [".js"]),
    path.join(root, "server", "server.js"),
  ];
  for (const f of routeFiles) {
    const c = await readSafe(f);
    if (!c) continue;
    const rel = relPath(root, f);
    ROUTE_RE.lastIndex = 0;
    let m;
    while ((m = ROUTE_RE.exec(c)) != null) {
      const method = m[1].toUpperCase();
      const route = m[2];
      const lineNum = c.slice(0, m.index).split("\n").length;
      collect({
        id: makeId(rel, lineNum, "route"),
        kind: "code_artifact",
        scope: "system",
        human: `${method} ${route}`,
        core: {
          path: rel,
          line: lineNum,
          artifact_kind: "route",
          method,
          route,
          domain_tags: deriveTags(rel),
        },
        machine: { domain_tags: deriveTags(rel) },
        artifact: null,
      });
      if (out.routes > 5000) break; // bound
    }
  }

  // ── Macros (server.js register("d", "n", …)) ──────────────────────────
  const serverContent = await readSafe(path.join(root, "server", "server.js"));
  REGISTER_RE.lastIndex = 0;
  let mm;
  while (serverContent && (mm = REGISTER_RE.exec(serverContent)) != null) {
    const lineNum = serverContent.slice(0, mm.index).split("\n").length;
    collect({
      id: makeId("server/server.js", lineNum, "macro"),
      kind: "code_artifact",
      scope: "system",
      human: `Macro: ${mm[1]}.${mm[2]}`,
      core: {
        path: "server/server.js",
        line: lineNum,
        artifact_kind: "macro",
        domain: mm[1],
        macro: mm[2],
        domain_tags: ["macro", mm[1]],
      },
      machine: { domain_tags: ["macro", mm[1]] },
      artifact: null,
    });
  }

  if (opts.dryRun) {
    return { ok: true, ...out, dtuCount: collected.length, sample: collected.slice(0, 3) };
  }

  // Persist. Tolerant of varying dtus schema across builds.
  const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dtus'`).get();
  if (!tableExists) {
    return { ok: false, reason: "dtus_table_missing" };
  }
  const cols = new Set(db.prepare(`PRAGMA table_info(dtus)`).all().map(r => r.name));
  const hasMetadata = cols.has("metadata_json");
  const hasContent = cols.has("content");
  const hasContentType = cols.has("content_type");
  const hasScope = cols.has("scope");
  const hasCreator = cols.has("creator_id");
  const hasTitle = cols.has("title");
  const hasUpdatedAt = cols.has("updated_at");
  const hasCreatedAt = cols.has("created_at");

  // Build INSERT statement with the columns that actually exist.
  const colList = ["id", "kind"];
  const vals = ["?", "?"];
  const projectFns = [(d) => d.id, (d) => d.kind];

  if (hasScope)      { colList.push("scope");        vals.push("?"); projectFns.push(d => d.scope || "system"); }
  if (hasCreator)    { colList.push("creator_id");   vals.push("?"); projectFns.push(_d => "system"); }
  if (hasTitle)      { colList.push("title");        vals.push("?"); projectFns.push(d => (d.human || "").slice(0, 200)); }
  if (hasContent)    { colList.push("content");      vals.push("?"); projectFns.push(d => JSON.stringify(d.core).slice(0, 8000)); }
  if (hasContentType){ colList.push("content_type"); vals.push("?"); projectFns.push(_d => "application/code-artifact"); }
  if (hasMetadata)   { colList.push("metadata_json");vals.push("?"); projectFns.push(d => JSON.stringify({ machine: d.machine, human: d.human }).slice(0, 4000)); }
  if (hasCreatedAt)  { colList.push("created_at");   vals.push("?"); projectFns.push(_d => new Date().toISOString()); }
  if (hasUpdatedAt)  { colList.push("updated_at");   vals.push("?"); projectFns.push(_d => new Date().toISOString()); }

  const sql = `INSERT OR REPLACE INTO dtus (${colList.join(", ")}) VALUES (${vals.join(", ")})`;
  const stmt = db.prepare(sql);
  const tx = db.transaction((rows) => {
    for (const d of rows) {
      try { stmt.run(...projectFns.map(fn => fn(d))); }
      catch (err) { out.errors.push({ id: d.id, msg: err?.message?.slice(0, 200) }); }
    }
  });
  tx(collected);

  return { ok: true, ...out, dtuCount: collected.length };
}

/**
 * Lookup a code-artifact DTU by source path. Returns the row or null.
 */
export function getCodeDtuForPath(db, p) {
  if (!db || !p) return null;
  const rows = db.prepare(
    // TODO: project explicit columns (auto-fix suggestion)
    `SELECT * FROM dtus WHERE kind='code_artifact' AND (content LIKE ? OR title LIKE ?) LIMIT 50`,
  ).all(`%${p}%`, `%${p}%`);
  // Prefer module-kind rows for path matches (route/macro entries can also match path).
  for (const r of rows) {
    try {
      const core = JSON.parse(r.content || "{}");
      if (core.path === p && core.artifact_kind === "module") return { row: r, core };
    } catch { /* ignore */ }
  }
  return rows[0] ? { row: rows[0], core: null } : null;
}

/**
 * Query code DTUs by tag / artifact_kind / location pattern.
 */
export function queryCodeDtus(db, { tag, artifactKind, limit = 100 } = {}) {
  if (!db) return [];
  const rows = db.prepare(
    `SELECT id, kind, title, content FROM dtus WHERE kind='code_artifact' LIMIT ?`,
  ).all(Math.min(limit, 1000));
  return rows.filter(r => {
    if (!artifactKind && !tag) return true;
    try {
      const core = JSON.parse(r.content || "{}");
      if (artifactKind && core.artifact_kind !== artifactKind) return false;
      if (tag && !(core.domain_tags || []).includes(tag)) return false;
      return true;
    } catch { return false; }
  });
}
