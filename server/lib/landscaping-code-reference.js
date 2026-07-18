// @sync-fs-ok: lazy, memoized one-time reference-catalog content load. Sync fs
// in this file is intentional and not on the user request path.
// server/lib/landscaping-code-reference.js
//
// Reference library of PARAPHRASED, CITED zoning/setback/planting permit
// quick-reference entries for landscaping.permit-reference
// (server/domains/landscaping.js).
//
// COPYRIGHT / SOURCING CONSTRAINT (Track D audit): unlike plumbing (one
// national model code family), there is no single national source for
// landscaping/zoning permit rules — municipal ordinances are public record
// but vary by jurisdiction and change over time. Every entry here names a
// SPECIFIC example jurisdiction and cites the real, verifiable ordinance/
// program name (never a fabricated section number the author isn't
// confident of — see `citationConfidence: "general-pattern"` entries, which
// intentionally omit a specific citation rather than invent one). This is a
// small, representative sample of named jurisdictions, not a comprehensive
// or authoritative permit database. Mirrors the pattern in
// server/lib/healthcare-protocols.js (content/healthcare-protocols.json).
//
// Authored content lives in content/landscaping-code-reference.json. This
// file only loads + memoizes it — no DB persistence needed since the
// library is static reference content, not per-user simulation state.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_FILE = path.resolve(__dirname, "..", "..", "content", "landscaping-code-reference.json");

export const LANDSCAPING_PERMIT_DISCLAIMER =
  "Quick-reference only — paraphrased from real, named municipal ordinances/programs for " +
  "a small set of example jurisdictions, never verbatim ordinance text, and not a " +
  "comprehensive or authoritative permit database. Zoning, setback, and permitting rules " +
  "vary by jurisdiction, by sub-zone, and change over time — always confirm current " +
  "requirements with your local planning/zoning department before design or construction.";

let _catalog = null;

function _loadCatalog() {
  if (_catalog) return _catalog;
  try {
    const raw = JSON.parse(fs.readFileSync(CONTENT_FILE, "utf8"));
    _catalog = Array.isArray(raw) ? raw : [];
  } catch (err) {
    logger.warn?.("landscaping-code-reference", "content_file_unreadable", { error: err?.message });
    _catalog = [];
  }
  return _catalog;
}

/** Full reference library, as loaded from content/landscaping-code-reference.json. */
export function listPermitReferences() {
  return _loadCatalog().slice();
}

/** Distinct example jurisdictions represented in the library, for browse/filter UI. */
export function listPermitReferenceJurisdictions() {
  const set = new Set();
  for (const e of _loadCatalog()) if (e.jurisdiction) set.add(e.jurisdiction);
  return Array.from(set).sort();
}

/** Distinct categories represented in the library, for browse/filter UI. */
export function listPermitReferenceCategories() {
  const set = new Set();
  for (const e of _loadCatalog()) if (e.category) set.add(e.category);
  return Array.from(set).sort();
}
