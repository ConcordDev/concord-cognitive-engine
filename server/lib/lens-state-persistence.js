// server/lib/lens-state-persistence.js
//
// Bucket 2 Gap A — persistent backing for the 26 STATE.<lens>Lens stores.
//
// Background: every domain file under server/domains/ that ships a workbench
// drawer stores per-user data under STATE.<lens>Lens = { ...: Map<userId, X> }
// where X ∈ Map | Set | Array | object. Before this module existed, the
// snapshot in server.js#_serializeState() never included these keys, so a
// hard restart wiped every user's saved projects/prompts/notes/journal/etc.
//
// This module exports two helpers plumbed into the existing snapshot
// mechanism (server.js _serializeState/_hydrateState). No new SQLite tables
// needed — the existing state_snapshots table already holds the JSON blob.

// Canonical list of lens state keys. Add new entries here when a new
// lens domain file ships its own STATE.<x>Lens store.
export const LENS_STATE_KEYS = Object.freeze([
  "accountingLens", "agricultureLens", "aviationLens", "bioLens",
  "chatLens", "cryptoLens", "ecoLens", "educationLens",
  "financeLens", "fitnessLens", "foodLens", "govLens",
  "healthLens", "insLens", "legalLens", "logLens",
  "marketsLens", "messageLens", "realestateLens", "researchLens",
  "retailLens", "scienceLens", "studioLens", "tradesLens",
  "whiteboardLens", "worldLens",
]);

function serializeValue(v) {
  if (v instanceof Map) {
    return {
      __type: "Map",
      entries: Array.from(v.entries()).map(([k, vv]) => [k, serializeValue(vv)]),
    };
  }
  if (v instanceof Set) {
    return { __type: "Set", values: Array.from(v) };
  }
  // Arrays of plain objects + plain objects pass through (JSON-safe).
  return v;
}

function deserializeValue(v) {
  if (v && typeof v === "object" && v.__type === "Map" && Array.isArray(v.entries)) {
    return new Map(v.entries.map(([k, vv]) => [k, deserializeValue(vv)]));
  }
  if (v && typeof v === "object" && v.__type === "Set" && Array.isArray(v.values)) {
    return new Set(v.values);
  }
  return v;
}

// Walk every registered lens key on STATE, serialize nested Map/Set into
// JSON-safe envelopes. Returns a plain object suitable for JSON.stringify.
export function serializeLensState(STATE) {
  if (!STATE || typeof STATE !== "object") return {};
  const out = {};
  for (const key of LENS_STATE_KEYS) {
    const lens = STATE[key];
    if (!lens || typeof lens !== "object") continue;
    const lensOut = {};
    for (const [field, val] of Object.entries(lens)) {
      lensOut[field] = serializeValue(val);
    }
    out[key] = lensOut;
  }
  return out;
}

// Inverse: take the persisted blob and restore STATE.<lens>Lens with
// proper Map/Set instances. Unknown lens keys are silently ignored
// (forward-compat — old snapshots may carry lens keys that were renamed
// or removed; we don't want a single malformed entry to block startup).
export function hydrateLensState(STATE, persisted) {
  if (!STATE || typeof STATE !== "object") return;
  if (!persisted || typeof persisted !== "object") return;
  for (const key of LENS_STATE_KEYS) {
    const lensPersisted = persisted[key];
    if (!lensPersisted || typeof lensPersisted !== "object") continue;
    const lensOut = {};
    for (const [field, val] of Object.entries(lensPersisted)) {
      lensOut[field] = deserializeValue(val);
    }
    STATE[key] = lensOut;
  }
}
