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
//     kind: string,          // category, e.g. "stale-code", "secret"
//     message: string,       // human-readable
//     location?: string,     // "file:line" when applicable
//     evidence?: any,        // small extra payload; keep < 256 chars per finding
//   }
//
// Detectors must be exception-safe — wrap their body in try/catch and report
// `ok:false, reason` on internal failure rather than throwing. They are run
// from a heartbeat, a CLI script, AND a macro endpoint.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const SEVERITY_ORDER = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export function makeReport(id, findings, t0) {
  const arr = Array.isArray(findings) ? findings : [];
  const summary = { total: arr.length, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of arr) {
    const sev = SEVERITY_ORDER[f.severity] != null ? f.severity : "info";
    summary[sev] = (summary[sev] ?? 0) + 1;
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
