// @sync-fs-ok: lazy, memoized one-time reference-catalog content load. Sync fs
// in this file is intentional and not on the user request path.
// server/lib/healthcare-protocols.js
//
// Reference library of well-established clinical care protocols for
// healthcare.protocolMatch (server/domains/healthcare.js) to match a
// patient's active conditions against, when the caller doesn't supply its
// own params.protocols.
//
// Every entry is a faithful, general-level summary of a REAL, published
// guideline from a real clinical organization (ADA, AHA/ACC, IDSA/ATS,
// Surviving Sepsis Campaign, GINA, GOLD, AAP, ACP, AHS, KDIGO, WAO, etc.) —
// see `source` on each record. Nothing here is invented; this is a
// reference/education surface for Concord's knowledge platform, NOT
// authoritative real-time bedside clinical decision support — see the
// disclaimer surfaced in the frontend ProtocolsPanel.
//
// Authored content lives in `content/healthcare-protocols.json`. This file
// only loads + memoizes it, mirroring the pattern in `server/lib/farming.js`
// (content/crops.json) and `server/lib/ecosystem/releasers.js`
// (content/releaser-tables.json) — no DB persistence needed since the
// library is static reference content, not per-user simulation state.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_FILE = path.resolve(__dirname, "..", "..", "content", "healthcare-protocols.json");

let _catalog = null;

function _loadCatalog() {
  if (_catalog) return _catalog;
  try {
    const raw = JSON.parse(fs.readFileSync(CONTENT_FILE, "utf8"));
    _catalog = Array.isArray(raw) ? raw : [];
  } catch (err) {
    logger.warn?.("healthcare-protocols", "content_file_unreadable", { error: err?.message });
    _catalog = [];
  }
  return _catalog;
}

/** Full protocol library, as loaded from content/healthcare-protocols.json. */
export function listProtocols() {
  return _loadCatalog().slice();
}

/** Single protocol by id, or null. */
export function getProtocol(id) {
  return _loadCatalog().find((p) => p.id === id) || null;
}

/** Distinct specialties represented in the library, for browse/filter UI. */
export function listSpecialties() {
  const set = new Set();
  for (const p of _loadCatalog()) if (p.specialty) set.add(p.specialty);
  return Array.from(set).sort();
}
