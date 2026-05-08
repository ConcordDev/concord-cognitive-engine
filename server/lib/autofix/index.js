// server/lib/autofix/index.js
//
// Phase 5 — central registry for repair-cortex auto-fixes.
//
// Each fix is a tuple:
//   { id, label, riskTier: "low"|"medium"|"high",
//     matchFinding(f) → boolean,
//     isApplicable(filePath, content, finding) → boolean,
//     apply(content, finding) → newContent | null,
//     describe(finding) → string }
//
// Hard refusals (paths under server.js / migrations / tests / economy /
// invariant / sovereign / refusal-field) are enforced in apply()'s entry
// point so even a buggy fix can't touch the third rail.

import { syncFsFix } from "./sync-fs.js";
import { unusedImportFix } from "./unused-import.js";
import { selectStarFix } from "./select-star.js";
import { preferConstFix } from "./prefer-const.js";
import { dropConsoleLogFix } from "./drop-console-log.js";
import { emptyCatchFix } from "./empty-catch.js";

const FIXES = new Map();

export function registerFix(fix) {
  if (!fix?.id || typeof fix.apply !== "function") {
    throw new Error("registerFix: { id, apply } required");
  }
  FIXES.set(fix.id, fix);
}

export function listFixes() { return Array.from(FIXES.values()); }
export function getFix(id) { return FIXES.get(id); }

const HARD_REFUSAL_RE = /(?:^|\/)server\/(?:server\.js|migrations\/|tests?\/)|\/(?:economy|royalty|sovereign|refusal-field|invariant)/i;

/**
 * Apply a fix to the given file content. Returns { ok, content?, reason? }.
 * Never throws.
 */
export function safeApply(fix, filePath, content, finding) {
  if (HARD_REFUSAL_RE.test(filePath)) {
    return { ok: false, reason: "hard_refusal_path" };
  }
  if (typeof fix.isApplicable === "function" && !fix.isApplicable(filePath, content, finding)) {
    return { ok: false, reason: "not_applicable" };
  }
  let next;
  try { next = fix.apply(content, finding); }
  catch (err) { return { ok: false, reason: "apply_threw", error: err?.message }; }
  if (next == null || next === content) return { ok: false, reason: "no_change" };
  return { ok: true, content: next };
}

// Built-in registrations.
registerFix(syncFsFix);
registerFix(unusedImportFix);
registerFix(selectStarFix);
registerFix(preferConstFix);
registerFix(dropConsoleLogFix);
registerFix(emptyCatchFix);
