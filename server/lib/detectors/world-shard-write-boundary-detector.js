// server/lib/detectors/world-shard-write-boundary-detector.js
//
// CLAUDE.md's "DB write-ownership rules (Phase F)" invariant: once
// CONCORD_SHARD_WORLDS=true, each per-world table (lib/world-shard-protocol.js
// PER_WORLD_WRITE_TABLES) is write-owned by that world's forked child process.
// "New code that writes to a per-world table from an HTTP route or from a
// scope:'global' module is wrong: it will work in single-process mode but
// will race the shard writer once Phase F is enabled."
//
// That invariant has never had an automated check — CONCORD_SHARD_WORLDS
// defaults OFF, so a violation is invisible in every normal test run and
// would only surface as real data corruption the first time an operator
// flips the flag in production. This detector makes the invariant checkable
// without ever needing to actually boot a sharded cluster: it's pure static
// text analysis, same posture as the other write-ownership-shaped detectors
// in this suite (authz-coverage, money-txn-hygiene).
//
// Two surfaces, per the documented rule:
//   (a) server/routes/*.js — these only ever run on the parent process.
//   (b) any heartbeat module registered with `scope: "global"` — the
//       handler function runs on the parent, not a world shard.
// Both scanned for a write statement (INSERT/UPDATE/DELETE, or a bare
// db.prepare(...).run(...) built from a template containing the table name)
// targeting a table in PER_WORLD_WRITE_TABLES.

import path from "node:path";
import { readSafe, makeReport, makeError, relPath, lineOf, walk } from "./_framework.js";

const HEARTBEAT_GLOBAL_RE = /registerHeartbeat\s*\(\s*["'`]([\w-]+)["'`]\s*,\s*\{[^}]*?scope\s*:\s*["'`]global["'`][^}]*?\}/gs;
const HANDLER_IDENT_RE = /handler\s*:\s*([A-Za-z_$][\w$]*)/;

// Matches an INSERT/UPDATE/DELETE statement (typically inside a db.prepare(`...`)
// template literal) naming one of the given tables. Table name must appear
// right after INTO/UPDATE, or as the FROM target of a DELETE.
function buildTableWriteRe(tables) {
  const alt = Array.from(tables).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`\\b(?:INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO|UPDATE|DELETE\\s+FROM)\\s+(${alt})\\b`, "gi");
}

/** Locate a named function's definition body (function decl or const-arrow) — bounded heuristic scan, same convention as public-read-write-verb-detector. */
export function findFunctionBody(blob, name) {
  const patterns = [
    new RegExp(`function\\s+${escapeRe(name)}\\s*\\(`),
    new RegExp(`(?:const|let)\\s+${escapeRe(name)}\\s*=\\s*(?:async\\s*)?(?:function\\s*)?\\(`),
    new RegExp(`(?:const|let)\\s+${escapeRe(name)}\\s*=\\s*async\\s*[\\w(]`),
  ];
  for (const re of patterns) {
    const m = re.exec(blob);
    if (m) return { body: blob.slice(m.index, m.index + 6000), offset: m.index };
  }
  return null;
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export async function runWorldShardWriteBoundaryDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("world-shard-write-boundary", "no_root", null, t0);
  try {
    const protocolPath = path.join(root, "server", "lib", "world-shard-protocol.js");
    const protocolSrc = await readSafe(protocolPath);
    if (!protocolSrc) return makeError("world-shard-write-boundary", "world_shard_protocol_unreadable", null, t0);

    const tableSetMatch = /PER_WORLD_WRITE_TABLES\s*=\s*Object\.freeze\(new Set\(\[([^\]]*)\]\)\)/s.exec(protocolSrc);
    if (!tableSetMatch) return makeError("world-shard-write-boundary", "per_world_write_tables_not_found", null, t0);
    const tables = new Set();
    for (const m of tableSetMatch[1].matchAll(/["'`]([\w]+)["'`]/g)) tables.add(m[1]);
    if (tables.size === 0) return makeError("world-shard-write-boundary", "per_world_write_tables_empty", null, t0);

    const writeRe = buildTableWriteRe(tables);
    const findings = [];

    // (a) server/routes/*.js — parent-process-only surface.
    const routeFiles = await walk(path.join(root, "server", "routes"), [".js"]);
    for (const f of routeFiles) {
      const content = await readSafe(f);
      if (!content) continue;
      const rel = relPath(root, f);
      writeRe.lastIndex = 0;
      let m;
      while ((m = writeRe.exec(content)) != null) {
        const table = m[1];
        const lineNo = lineOf(content, m.index);
        findings.push({
          id: "world_shard_write_from_route",
          severity: "high",
          kind: "static",
          category: "correctness",
          subject: { kind: "file", path: rel, table },
          message: `${rel}:${lineNo} writes to per-world table "${table}" from a route (parent-process-only) — will race the world-shard writer once CONCORD_SHARD_WORLDS=true`,
          location: `${rel}:${lineNo}`,
          evidence: { table, surface: "route" },
          fixHint: "move_write_into_world_shard_or_tag_scope_world",
        });
      }
    }

    // (b) scope:"global" heartbeat handlers — resolve the handler function's
    // definition anywhere under server/ and scan its body.
    const serverFiles = [
      path.join(root, "server", "server.js"),
      ...(await walk(path.join(root, "server", "emergent"), [".js"])),
      ...(await walk(path.join(root, "server", "lib"), [".js"])),
    ];
    let wholeBlob = "";
    const blobByFile = [];
    for (const f of serverFiles) {
      const c = await readSafe(f);
      if (!c) continue;
      blobByFile.push({ file: f, content: c });
      wholeBlob += "\n" + c;
    }

    const globalHeartbeats = [];
    for (const { content } of blobByFile) {
      HEARTBEAT_GLOBAL_RE.lastIndex = 0;
      let m;
      while ((m = HEARTBEAT_GLOBAL_RE.exec(content)) != null) {
        const name = m[1];
        const handlerM = HANDLER_IDENT_RE.exec(m[0]);
        if (handlerM) globalHeartbeats.push({ name, handlerIdent: handlerM[1] });
      }
    }

    let scanned = 0;
    for (const { name, handlerIdent } of globalHeartbeats) {
      const found = findFunctionBody(wholeBlob, handlerIdent);
      if (!found) continue; // can't locate — not a finding, just unresolved (info-level noise avoided)
      scanned++;
      writeRe.lastIndex = 0;
      let m;
      while ((m = writeRe.exec(found.body)) != null) {
        const table = m[1];
        findings.push({
          id: "world_shard_write_from_global_heartbeat",
          severity: "high",
          kind: "static",
          category: "correctness",
          subject: { kind: "heartbeat", name, table },
          message: `heartbeat "${name}" (scope:"global", handler ${handlerIdent}) writes to per-world table "${table}" — global-scope heartbeats run on the parent process and will race the world-shard writer once CONCORD_SHARD_WORLDS=true`,
          evidence: { heartbeat: name, handlerIdent, table, surface: "global-heartbeat" },
          fixHint: "retag_heartbeat_scope_world_or_move_write_into_shard",
        });
      }
    }

    findings.unshift({
      id: "world_shard_write_boundary_summary",
      severity: "info",
      kind: "static",
      category: "correctness",
      message: `Scanned ${routeFiles.length} route file(s) + ${scanned}/${globalHeartbeats.length} resolvable global-scope heartbeat handler(s) against ${tables.size} per-world write-owned table(s)`,
      evidence: { routeFiles: routeFiles.length, globalHeartbeats: globalHeartbeats.length, resolved: scanned, tableCount: tables.size },
    });

    return makeReport("world-shard-write-boundary", findings, t0);
  } catch (err) {
    return makeError("world-shard-write-boundary", "exception", err, t0);
  }
}
