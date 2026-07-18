// @sync-fs-ok: lazy, memoized one-time reference-catalog content load. Sync fs
// in this file is intentional and not on the user request path.
// server/lib/intestacy-reference.js
//
// Reference library of state intestate-succession (who-inherits-when-there's-
// no-will) share tables for inheritance.intestacy-lookup
// (server/domains/inheritance.js) to look up by state.
//
// This mirrors the healthcare-protocols.js / content/healthcare-protocols.json
// pattern (server/lib/healthcare-protocols.js): a REAL public-domain primary
// source (state probate statutes) with no aggregating free API, so the honest
// path is an authored, cited reference set rather than fabricated data or a
// nonexistent API wire. Track D CURATION (reclassified from DATA-SOURCING —
// see docs/lens-specs/inheritance-capability-map.md's "Genuinely missing"
// row): state intestacy statutes are real, published, public-domain primary
// legal text, but there is no free structured API that aggregates them the
// way CourtListener aggregates case opinions — so this is authored + cited
// content, not an API integration.
//
// Every entry is a SIMPLIFIED, PARAPHRASED summary of a real state statute
// — see `citation`/`source` on each record — for educational/reference use
// only. This is NOT legal advice and does NOT cover every scenario (adopted
// children, half-relatives, disclaimers, advancements, putative spouses,
// community-property nuances, etc.). Every entry carries its own
// `disclaimer` field; the domain macro also always injects a top-level
// disclaimer + the "representative subset" framing so a caller can never
// get a share table without also getting the caveat.
//
// This is intentionally a SMALL, REPRESENTATIVE SUBSET of US states (8: CA,
// TX, NY, FL, IL, PA, OH, GA — spanning community-property states (CA, TX)
// and common-law states (the rest)) — NOT a claim of 50-state coverage. An
// uncovered state returns an honest "not in reference set" response, never
// a fabricated share table.
//
// Authored content lives in `content/intestacy-reference.json`. This file
// only loads + memoizes it, mirroring `server/lib/healthcare-protocols.js`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_FILE = path.resolve(__dirname, "..", "..", "content", "intestacy-reference.json");

let _catalog = null;

function _loadCatalog() {
  if (_catalog) return _catalog;
  try {
    const raw = JSON.parse(fs.readFileSync(CONTENT_FILE, "utf8"));
    _catalog = Array.isArray(raw) ? raw : [];
  } catch (err) {
    logger.warn?.("intestacy-reference", "content_file_unreadable", { error: err?.message });
    _catalog = [];
  }
  return _catalog;
}

function _norm(s) {
  return String(s || "").trim().toLowerCase();
}

/** Full reference library, as loaded from content/intestacy-reference.json. */
export function listIntestacyStates() {
  return _loadCatalog().slice();
}

/** Just the covered state names + codes, for a browse/select UI. */
export function listIntestacyStateSummaries() {
  return _loadCatalog().map((s) => ({ state: s.state, stateCode: s.stateCode, propertyRegime: s.propertyRegime }));
}

/**
 * Look up by state name (case-insensitive, e.g. "california") or two-letter
 * code (e.g. "CA" / "ca"). Returns null when not in the reference set —
 * callers must handle that as an honest "not covered" response, never
 * synthesize a fallback table.
 */
export function getIntestacyForState(stateNameOrCode) {
  const q = _norm(stateNameOrCode);
  if (!q) return null;
  const catalog = _loadCatalog();
  return (
    catalog.find((s) => _norm(s.state) === q) ||
    catalog.find((s) => _norm(s.stateCode) === q) ||
    null
  );
}
