// @sync-fs-ok: lazy, memoized one-time reference-catalog content load. Sync fs
// in this file is intentional and not on the user request path.
// server/lib/plumbing-code-reference.js
//
// Reference library of PARAPHRASED, CITED plumbing-code quick-reference
// values for plumbing.codeReference (server/domains/plumbing.js).
//
// COPYRIGHT CONSTRAINT (Track D audit): the IPC (International Plumbing
// Code) and UPC (Uniform Plumbing Code) are copyrighted model codes — a
// verbatim code-text library would be a licensing violation. Every entry
// here is a paraphrased summary that cites a real table/section number ONLY
// when that citation is confident (`citationConfidence: "table-cited"`);
// values the author isn't fully confident of the exact numbered section for
// are described as a general cross-code-family pattern with `citation: null`
// (`citationConfidence: "general-pattern"`) rather than risking a fabricated
// citation. Nothing here reproduces the verbatim table text — this is a
// paraphrased quick-reference surface, not a code library, and every entry
// carries its own "verify locally" disclaimer. Mirrors the pattern in
// server/lib/healthcare-protocols.js (content/healthcare-protocols.json).
//
// Authored content lives in content/plumbing-code-reference.json. This file
// only loads + memoizes it — no DB persistence needed since the library is
// static reference content, not per-user simulation state.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_FILE = path.resolve(__dirname, "..", "..", "content", "plumbing-code-reference.json");

export const PLUMBING_CODE_DISCLAIMER =
  "Quick-reference only — paraphrased from real code tables/sections for convenience, " +
  "never the verbatim code text, and not a substitute for the current locally adopted " +
  "edition of the IPC/UPC plus any local amendments. Code requirements vary by " +
  "jurisdiction, by code edition, and change over time — always verify against your " +
  "Authority Having Jurisdiction (AHJ) before design or construction.";

let _catalog = null;

function _loadCatalog() {
  if (_catalog) return _catalog;
  try {
    const raw = JSON.parse(fs.readFileSync(CONTENT_FILE, "utf8"));
    _catalog = Array.isArray(raw) ? raw : [];
  } catch (err) {
    logger.warn?.("plumbing-code-reference", "content_file_unreadable", { error: err?.message });
    _catalog = [];
  }
  return _catalog;
}

/** Full reference library, as loaded from content/plumbing-code-reference.json. */
export function listCodeReferences() {
  return _loadCatalog().slice();
}

/** Distinct categories represented in the library, for browse/filter UI. */
export function listCodeReferenceCategories() {
  const set = new Set();
  for (const e of _loadCatalog()) if (e.category) set.add(e.category);
  return Array.from(set).sort();
}
