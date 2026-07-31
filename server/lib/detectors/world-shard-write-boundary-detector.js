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
//
// Severity + fingerprinting, corrected after running this detector against
// the live tree (not just synthetic fixtures):
//
// - `world_shard_write_from_global_heartbeat` never set a `location` field
//   at all. The ratchet fingerprints on sha256(detector|ruleId|location|
//   severity), and an absent location becomes the empty string — so EVERY
//   finding of this ruleId collapsed onto ONE shared fingerprint regardless
//   of which heartbeat/table it was about, hiding all but the first from
//   baseline/ratchet tracking (the exact bug class public-read-write-verb-
//   detector was independently found and fixed for). Fixed: every finding
//   now resolves the handler's real defining file, and `location` is that
//   file's `path:line`, which is unique per handler.
//
// - Both finding severities were downgraded from "high" to "medium" after
//   running against the live tree: CONCORD_SHARD_WORLDS defaults off, and —
//   confirmed by reading world-shard-manager.js and grepping every call site
//   of shardingEnabled() — NO write-forwarding plumbing exists anywhere in
//   this codebase for HTTP routes today (the manager only forks child
//   processes to run scope:"world" HEARTBEATS; there is no mechanism for a
//   synchronous Express route to defer its write to a shard and wait for
//   the result). That means virtually every per-world-table write in the
//   ENTIRE codebase currently originates from the parent process — this is
//   the app's actual, universal, working architecture today, not a
//   localized bug in freshly-written code. A "high" severity blocking gate
//   on a condition this systemic and this far from exploitable (sharding
//   isn't live anywhere) would never be clearable without either building
//   the (currently nonexistent) route-to-shard forwarding infrastructure
//   for the whole app in one pass, or systematically muting the detector —
//   neither of which this pass does. "Medium" keeps the signal — real,
//   worth fixing when Phase F write-forwarding is actually built — without
//   miscalibrating a first-time severity guess as an actionable blocker for
//   debt that predates this detector and spans the whole write layer.

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

// Reviewed, confirmed-intentional instances — same posture as
// internal-actor-stamp-detector.js's ALLOWLIST: named exact site + reason.
const ALLOWLIST = [
  {
    heartbeat: "npc-ambition-cycle",
    reason:
      "Deliberately scope:'global' per the adjacent server.js comment (Phase T, right above the registerHeartbeat call): its top-N-ambitious query is a single cross-world budget with no world_id filter, and sharding it per-world would either duplicate-process the same rows on every shard or silently never run at all — the same documented tradeoff already made for its two sibling heartbeats (npc-travel-cycle, npc-vs-npc-combat). This is a reviewed, load-bearing design choice, not an oversight.",
  },
  {
    heartbeat: "npc-travel-cycle",
    reason:
      "Same adjacent server.js comment as npc-ambition-cycle (Phase T): explicitly moves NPCs BETWEEN worlds in one operation and its candidate query has no world_id filter — sharding it per-world would either duplicate-process the same rows on every shard or silently never run at all. Reviewed, load-bearing design choice, not an oversight.",
  },
];

function isAllowlisted(heartbeatName) {
  return ALLOWLIST.some((a) => a.heartbeat === heartbeatName);
}

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
          severity: "medium",
          kind: "static",
          category: "correctness",
          subject: { kind: "file", path: rel, table },
          message: `${rel}:${lineNo} writes to per-world table "${table}" from a route (parent-process-only) — will race the world-shard writer once CONCORD_SHARD_WORLDS=true. No route-to-shard write forwarding exists anywhere in this codebase yet (sharding only forks scope:'world' heartbeats), so this reflects the app's current universal architecture, not a localized new-code bug.`,
          location: `${rel}:${lineNo}`,
          evidence: { table, surface: "route" },
          fixHint: "move_write_into_world_shard_or_tag_scope_world",
        });
      }
    }

    // (b) scope:"global" heartbeat handlers — resolve the handler function's
    // definition anywhere under server/ and scan its body. Search each file
    // individually (not one concatenated blob) so a resolved handler's
    // location can point at its real defining file:line — a shared/absent
    // location collapses every finding of this ruleId onto one fingerprint
    // (see file header).
    const serverFiles = [
      path.join(root, "server", "server.js"),
      ...(await walk(path.join(root, "server", "emergent"), [".js"])),
      ...(await walk(path.join(root, "server", "lib"), [".js"])),
    ];
    const blobByFile = [];
    for (const f of serverFiles) {
      const c = await readSafe(f);
      if (!c) continue;
      blobByFile.push({ rel: relPath(root, f), content: c });
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

    let scanned = 0, allowlistedCount = 0;
    for (const { name, handlerIdent } of globalHeartbeats) {
      let found = null, foundRel = null, foundContent = null;
      for (const bf of blobByFile) {
        found = findFunctionBody(bf.content, handlerIdent);
        if (found) { foundRel = bf.rel; foundContent = bf.content; break; }
      }
      if (!found) continue; // can't locate — not a finding, just unresolved (info-level noise avoided)
      scanned++;
      writeRe.lastIndex = 0;
      let m;
      while ((m = writeRe.exec(found.body)) != null) {
        const table = m[1];
        if (isAllowlisted(name)) { allowlistedCount++; continue; }
        // Absolute offset within the real file = where the function body
        // started + how far into that body the write statement is.
        const lineNo = lineOf(foundContent, found.offset + m.index);
        findings.push({
          id: "world_shard_write_from_global_heartbeat",
          severity: "medium",
          kind: "static",
          category: "correctness",
          subject: { kind: "heartbeat", name, table },
          message: `heartbeat "${name}" (scope:"global", handler ${handlerIdent} at ${foundRel}) writes to per-world table "${table}" — global-scope heartbeats run on the parent process and will race the world-shard writer once CONCORD_SHARD_WORLDS=true.`,
          location: `${foundRel}:${lineNo}:${name}`,
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
      message: `Scanned ${routeFiles.length} route file(s) + ${scanned}/${globalHeartbeats.length} resolvable global-scope heartbeat handler(s) against ${tables.size} per-world write-owned table(s); ${allowlistedCount} write(s) already reviewed+allowlisted`,
      evidence: { routeFiles: routeFiles.length, globalHeartbeats: globalHeartbeats.length, resolved: scanned, tableCount: tables.size, allowlistedCount },
    });

    return makeReport("world-shard-write-boundary", findings, t0);
  } catch (err) {
    return makeError("world-shard-write-boundary", "exception", err, t0);
  }
}
