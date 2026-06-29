#!/usr/bin/env node
// scripts/audit-emergent-wiring.mjs
//
// T2.4 — emergent-module reconciliation audit.
//
// Layer 12 found that several production-grade emergent engines had macros but
// no heartbeat schedule (drift-monitor, breakthrough-clusters, cnet-federation,
// hlr-engine) and were dark forever. This script makes that class of bug
// auditable: it scans every server/emergent/*.js for an exported cycle handler
// (run*/tick*/sweep* taking a context object) and checks whether server.js
// actually references it — via registerHeartbeat, an inline governorTick call,
// or a direct import+invoke.
//
// A module is classified:
//   WIRED         — its handler (or its name) is referenced in server.js / an
//                   orchestrator and is therefore reachable on a clock.
//   ENTITY-INLINE — no top-level cycle handler; it's a per-entity module driven
//                   by store.registerEmergent (decideBehavior/tick(entity)).
//   ORPHAN        — exports a cycle handler that nothing schedules. The bug.
//
// Output: console summary + reports/emergent-wiring-audit.json. Exit 0 always
// (advisory); CI can diff the ORPHAN list against an allowlist.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const EMERGENT_DIR = path.join(ROOT, "server", "emergent");
const SERVER_JS = path.join(ROOT, "server", "server.js");

// Handlers that take a ctx object ({ db, io, state, ... }) are cycle handlers.
// We detect them by the export + a first-arg that's an object/destructure.
const CYCLE_EXPORT_RE = /export\s+(?:async\s+)?function\s+((?:run|tick|sweep|pump|advance)[A-Za-z0-9_]*)\s*\(\s*(\{|[a-zA-Z_])/g;

// Orphan allowlist: handlers intentionally invoked from places other than
// server.js (e.g. from another orchestrator/module, or test-only). Keep tight.
const ORPHAN_ALLOWLIST = new Set([
  // lattice-orchestrator handlers are invoked by the orchestrator, not server.js
  // directly; they're reachable. Listed here so the audit stays green.
]);

function readSafe(p) { try { return readFileSync(p, "utf8"); } catch { return ""; } }

const serverSrc = readSafe(SERVER_JS);

// Reachability corpus: a handler is "scheduled/reachable" if its name appears
// anywhere that can drive it — server.js (registerHeartbeat / governorTick),
// any other emergent module (an orchestrator or scheduler calling it), any
// route (on-demand step functions like advancePipeline / runScenario), or any
// domain macro. We exclude the handler's own defining file so a self-reference
// doesn't count as "reached".
function readDir(dir, filter = (f) => f.endsWith(".js")) {
  try {
    return readdirSync(dir).filter(filter).map((f) => ({ file: f, src: readSafe(path.join(dir, f)) }));
  } catch { return []; }
}
const emergentSrcs = readDir(EMERGENT_DIR);
const routeSrcs = readDir(path.join(ROOT, "server", "routes"));
const domainSrcs = readDir(path.join(ROOT, "server", "domains"));

const files = readdirSync(EMERGENT_DIR).filter((f) => f.endsWith(".js")).sort();

const results = { wired: [], entityInline: [], orphan: [], scannedAt: new Date().toISOString() };

for (const file of files) {
  const full = path.join(EMERGENT_DIR, file);
  const src = readSafe(full);
  const handlers = [];
  let m;
  CYCLE_EXPORT_RE.lastIndex = 0;
  while ((m = CYCLE_EXPORT_RE.exec(src)) !== null) handlers.push(m[1]);

  // Per-file reachability corpus: server.js + every OTHER emergent module +
  // all routes + all domains (excludes the file's own source).
  const schedulingCorpus = [
    serverSrc,
    ...emergentSrcs.filter((e) => e.file !== file).map((e) => e.src),
    ...routeSrcs.map((e) => e.src),
    ...domainSrcs.map((e) => e.src),
  ].join("\n");

  if (handlers.length === 0) {
    // No top-level cycle handler. If it exports a per-entity tick or is in the
    // module registry, it's entity-inline; otherwise still entity-inline (lib).
    results.entityInline.push({ file, handlers: [] });
    continue;
  }

  // A handler is scheduled if its name appears anywhere in the scheduling
  // corpus (registerHeartbeat handler ref, governorTick call, or import+call).
  const scheduled = handlers.filter(
    (h) => schedulingCorpus.includes(h) || ORPHAN_ALLOWLIST.has(h),
  );
  const unscheduled = handlers.filter(
    (h) => !schedulingCorpus.includes(h) && !ORPHAN_ALLOWLIST.has(h),
  );

  if (unscheduled.length === 0) {
    results.wired.push({ file, handlers });
  } else {
    results.orphan.push({ file, handlers, unscheduled, scheduled });
  }
}

const total = files.length;
console.log(`\nEmergent-module wiring audit — ${total} files in server/emergent/`);
console.log(`  WIRED          : ${results.wired.length}`);
console.log(`  ENTITY-INLINE  : ${results.entityInline.length}`);
console.log(`  ORPHAN         : ${results.orphan.length}`);
if (results.orphan.length > 0) {
  console.log(`\nORPHANED cycle handlers (export a run/tick handler nothing schedules):`);
  for (const o of results.orphan) {
    console.log(`  - ${o.file}: ${o.unscheduled.join(", ")}`);
  }
} else {
  console.log(`\n✓ No orphaned cycle handlers — every run/tick/sweep export is reachable.`);
}

const outDir = path.join(ROOT, "reports");
try { mkdirSync(outDir, { recursive: true }); } catch { /* exists */ }
writeFileSync(path.join(outDir, "emergent-wiring-audit.json"), JSON.stringify(results, null, 2));
console.log(`\nWrote reports/emergent-wiring-audit.json`);

// CI gate (--ci): the baseline is ZERO orphaned cycle handlers (every run/tick/
// sweep export in server/emergent/ is reachable from the scheduling corpus). A
// NEW orphan — a handler nothing schedules — is a dead game-loop: it looks wired
// but never fires. Fail the build so the regression is caught at PR time. Wire
// the handler (a registerHeartbeat call or an orchestrator) or mark it
// entity-inline. Default (no --ci) stays advisory for local exploration.
const ciGate = process.argv.includes("--ci");
if (ciGate && results.orphan.length > 0) {
  console.error(`\n✗ CI gate: ${results.orphan.length} orphaned emergent cycle handler(s) — baseline is 0. Schedule them or make them entity-inline.`);
  process.exit(1);
}
process.exit(0);
