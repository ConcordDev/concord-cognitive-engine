// server/lib/detectors/_framework.js
//
// Shared scaffolding for code-quality detectors. Each detector exports a
// `run({ root, db, opts? })` function that returns a `DetectorReport`:
//
//   {
//     id: string,            // detector id, kebab-case
//     ok: boolean,           // false only if the detector itself crashed
//     reason?: string,       // populated when ok=false
//     summary: {             // counts by severity (info|low|medium|high|critical)
//       total, critical, high, medium, low, info
//     },
//     findings: Finding[],
//     durationMs: number,
//   }
//
// A Finding is:
//
//   {
//     id: string,            // stable rule-key, e.g. "macro_unused"
//     severity: "info"|"low"|"medium"|"high"|"critical",
//     kind: "static"|"semantic"|"historical"|"predictive"|"architectural",  // T1 axis
//     category?: string,     // legacy free-form tag (e.g. "stale-code"); kept for back-compat
//     message: string,
//     location?: string,     // "file:line" when applicable
//     evidence?: any,        // small extra payload; keep < 256 chars per finding
//     subject?: any,         // routing target for repair-cortex / Concordia
//     fixHint?: string,      // hint for repair-cortex registry routing
//   }
//
// Detectors must be exception-safe — wrap their body in try/catch and report
// `ok:false, reason` on internal failure rather than throwing. They are run
// from a heartbeat, a CLI script, AND a macro endpoint.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const SEVERITY_ORDER = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
export const FINDING_KINDS = new Set(["static", "semantic", "historical", "predictive", "architectural"]);

export function makeReport(id, findings, t0) {
  const arr = Array.isArray(findings) ? findings : [];
  const summary = { total: arr.length, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of arr) {
    const sev = SEVERITY_ORDER[f.severity] != null ? f.severity : "info";
    summary[sev] = (summary[sev] ?? 0) + 1;
    // Default kind to "static" for back-compat. New detectors set it explicitly.
    if (!f.kind || !FINDING_KINDS.has(f.kind)) f.kind = "static";
  }
  return {
    id,
    ok: true,
    summary,
    findings: arr,
    durationMs: Date.now() - t0,
  };
}

export function makeError(id, reason, error, t0) {
  return {
    id,
    ok: false,
    reason: reason || "unknown_error",
    error: error?.message || String(error || ""),
    summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    findings: [],
    durationMs: Date.now() - t0,
  };
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "data", "audit",
  "coverage", ".cache", ".turbo", "__pycache__", "out",
]);

export async function walk(dir, exts = [".js"], skip = SKIP_DIRS) {
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...await walk(p, exts, skip));
    } else if (e.isFile() && (exts.length === 0 || exts.some(x => e.name.endsWith(x)))) {
      out.push(p);
    }
  }
  return out;
}

export async function readSafe(p) {
  try { return await readFile(p, "utf-8"); } catch { return ""; }
}

export async function existsSafe(p) {
  try { await stat(p); return true; } catch { return false; }
}

export function lineOf(content, idx) {
  if (idx < 0 || idx >= content.length) return 1;
  let n = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

export function relPath(root, p) {
  const r = path.relative(root, p);
  return r.startsWith("..") ? p : r;
}

/** Truncate any string-ish evidence value so reports stay bounded. */
export function snippet(s, max = 160) {
  if (s == null) return "";
  const str = String(s);
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + "…";
}

// ── Open-dispatcher recognition ───────────────────────────────────────────
// Files that contain `// @macro-dispatcher` AND a `runMacro(<ident>, <ident>, …)`
// callsite are open dispatchers — every registered (domain, name) pair is
// reachable via them. Detectors consult this so dynamically-dispatched
// macros aren't reported as dead.

const RUN_MACRO_DYN_RE = /runMacro\s*\(\s*([a-zA-Z_]\w*)\s*,\s*([a-zA-Z_]\w*)\s*,/g;
const DISPATCHER_MARK = /@macro-dispatcher\b/;

export async function loadOpenDispatchers(root) {
  if (!root) return [];
  const dispatchers = [];
  const files = await walk(path.join(root, "server"), [".js"]);
  for (const f of files) {
    const c = await readSafe(f);
    if (!c || !DISPATCHER_MARK.test(c)) continue;
    RUN_MACRO_DYN_RE.lastIndex = 0;
    let m;
    while ((m = RUN_MACRO_DYN_RE.exec(c)) != null) {
      dispatchers.push({
        file: relPath(root, f),
        line: lineOf(c, m.index),
        domainVar: m[1],
        nameVar: m[2],
      });
    }
  }
  return dispatchers;
}

// ── Lens-manifest macro scanner ───────────────────────────────────────────
// Reads server/lib/lens-manifest.js for { lensId, domain, actions: [...] }
// shapes and returns the set of (domain, action) pairs it mentions.

export async function loadLensManifestMacros(root) {
  if (!root) return new Set();
  const manifestPath = path.join(root, "server", "lib", "lens-manifest.js");
  const c = await readSafe(manifestPath);
  if (!c) return new Set();
  const set = new Set();
  const blockRe = /domain\s*:\s*['"`]([a-zA-Z0-9_-]+)['"`][\s\S]{0,500}?actions\s*:\s*\[([^\]]+)\]/g;
  let m;
  while ((m = blockRe.exec(c)) != null) {
    const domain = m[1];
    const actionsBlob = m[2];
    const actionRe = /['"`]([a-zA-Z0-9_.\-]+)['"`]/g;
    let am;
    while ((am = actionRe.exec(actionsBlob)) != null) set.add(`${domain}.${am[1]}`);
  }
  // Also catch `lensId: 'foo', domain: 'foo'` shape — those lenses use the
  // lensId as the domain by convention with a default `.run` action.
  const lensIdRe = /lensId\s*:\s*['"`]([a-zA-Z0-9_-]+)['"`]/g;
  while ((m = lensIdRe.exec(c)) != null) set.add(`${m[1]}.run`);
  return set;
}

// ── Sync-fs annotation scanner ─────────────────────────────────────────────
// Files that contain `// @sync-fs-ok: <reason>` are exempt from the
// PerformanceHotspotDetector sync-fs rule. Path-based defaults still apply.

const SYNC_FS_OK_MARK = /@sync-fs-ok\b/;
const STARTUP_PATH_HINT = /[/\\](?:persistence|bootstrap|seed|init|migration|repair-cortex|prophet)/i;
const SQL_LOOP_OK_MARK = /@sql-loop-ok\b/;

export function syncFsExempt(filePath, content) {
  if (SYNC_FS_OK_MARK.test(content)) return true;
  return STARTUP_PATH_HINT.test(filePath);
}

/**
 * `@sql-loop-ok` annotation — operator opt-out for the N+1 SQL detector.
 * Used for files where the per-row work is required (e.g. business logic
 * that depends on the previous iteration), or where the loop iterates a
 * tiny constant set of table names.
 */
export function sqlLoopExempt(_filePath, content) {
  return SQL_LOOP_OK_MARK.test(content);
}
