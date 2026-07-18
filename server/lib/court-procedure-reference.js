// @sync-fs-ok: lazy, memoized one-time reference-catalog content load. Sync fs
// in this file is intentional and not on the user request path.
// server/lib/court-procedure-reference.js
//
// Reference library of state civil-procedure rule pointers (service of
// process, time-to-answer, summary judgment) for legal.procedure-reference
// (server/domains/legal.js) to look up by state.
//
// Same pattern + same honesty rationale as server/lib/intestacy-reference.js
// and server/lib/healthcare-protocols.js: state rules of civil procedure are
// real, published, public-domain primary legal text, but — per the
// investigated-and-deferred finding in docs/lens-specs/legal-capability-map.md
// ("No cross-jurisdiction state-specific court rules... there is no free/open
// equivalent dataset to wire") — there is no free aggregating API for them
// the way CourtListener aggregates case opinions. Track D CURATION
// (reclassified from DATA-SOURCING): the honest path is authored + cited
// reference content, not a fabricated table and not a nonexistent API wire.
//
// Every entry is a PARAPHRASED, SIMPLIFIED summary of real published rules
// — see `citation`/`source` on each record — for educational/reference use
// only. This is NOT legal advice, and deadlines have many exceptions
// (extensions, local court rules, service method, party type) not captured
// here. Every entry carries its own `disclaimer`; the domain macro also
// always injects a top-level disclaimer + "representative subset" framing.
// Where a specific rule number could not be confidently verified (see the
// Illinois "time to appear/answer" entry), the citation says so generically
// rather than asserting a rule number that might not be real.
//
// This is intentionally a SMALL, REPRESENTATIVE SUBSET of US states (the
// same 8 as intestacy-reference.js: CA, TX, NY, FL, IL, PA, OH, GA) — NOT a
// claim of 50-state coverage. An uncovered state returns an honest "not in
// reference set" response, never a fabricated rule table.
//
// Authored content lives in `content/court-procedure-reference.json`. This
// file only loads + memoizes it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_FILE = path.resolve(__dirname, "..", "..", "content", "court-procedure-reference.json");

let _catalog = null;

function _loadCatalog() {
  if (_catalog) return _catalog;
  try {
    const raw = JSON.parse(fs.readFileSync(CONTENT_FILE, "utf8"));
    _catalog = Array.isArray(raw) ? raw : [];
  } catch (err) {
    logger.warn?.("court-procedure-reference", "content_file_unreadable", { error: err?.message });
    _catalog = [];
  }
  return _catalog;
}

function _norm(s) {
  return String(s || "").trim().toLowerCase();
}

/** Full reference library, as loaded from content/court-procedure-reference.json. */
export function listProcedureStates() {
  return _loadCatalog().slice();
}

/** Just the covered state names + codes, for a browse/select UI. */
export function listProcedureStateSummaries() {
  return _loadCatalog().map((s) => ({ state: s.state, stateCode: s.stateCode, rulesBody: s.rulesBody }));
}

/**
 * Look up by state name (case-insensitive) or two-letter code. Returns null
 * when not in the reference set — callers must handle that as an honest
 * "not covered" response, never synthesize a fallback rule table.
 */
export function getProcedureForState(stateNameOrCode) {
  const q = _norm(stateNameOrCode);
  if (!q) return null;
  const catalog = _loadCatalog();
  return (
    catalog.find((s) => _norm(s.state) === q) ||
    catalog.find((s) => _norm(s.stateCode) === q) ||
    null
  );
}
