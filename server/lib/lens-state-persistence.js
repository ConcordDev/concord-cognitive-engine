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
  "calendarLens", "chatLens", "cryptoLens", "ecoLens", "educationLens",
  "eventTimelineLens",
  "financeLens", "fitnessLens", "foodLens", "govLens",
  "healthLens", "insLens", "legalLens", "logLens",
  "marketsLens", "marketplaceLens", "messageLens", "privacyLens", "projectsLens", "realestateLens", "researchLens",
  "retailLens", "scienceLens", "studioLens", "threadLens", "tradesLens",
  "whiteboardLens", "worldLens",
  // 32 -> 33: "codeLens" so a virtual project, its files, and its git log
  // survive a restart. The Code domain stores workspaces here; without this
  // key a hard restart wiped every project while the editor still showed it.
  "codeLens",
  // 33 -> 34: "graphLens" so a user's saved mind maps, nodes, edges,
  // filters, group rules, and layouts survive a restart. The Graph domain
  // stores per-user maps here; without this key a hard restart wiped every
  // map while the UI still showed it.
  "graphLens",
  // 34 -> 35: "hypothesisLens" so a user's imported datasets, saved
  // analyses, and pre-registered hypotheses survive a restart. The
  // Hypothesis domain stores per-user data here; without this key a hard
  // restart wiped every pre-registration while the registry still showed it.
  "hypothesisLens",
  // 35 -> 36: "srsLens" so a user's decks, cards, review log, and media
  // survive a restart. The SRS domain stores per-user Anki-shape data here;
  // without this key a hard restart wiped every deck while the study UI
  // still showed it.
  "srsLens",
  // 36 -> 37: "travelLens" so a user's trips, itineraries, bookings,
  // budgets, checklists, price watches, docs, and loyalty accounts survive
  // a restart. The Travel domain stores per-user data here; without this
  // key a hard restart wiped every trip while the TripWorkspace still
  // showed it.
  "travelLens",
  // 37 -> 38: "engineeringLens" so a user's saved parts, load cases,
  // and FEA sim-job history survive a restart. The Engineering domain
  // stores per-user data here; without this key a hard restart wiped
  // every part and FEA run while the ResultsPanel still showed it.
  "engineeringLens",
  // 38 -> 39: "physicsLens" so a user's saved PhET scenes and share codes
  // survive a restart. The Physics domain stores per-user data here;
  // without this key a hard restart wiped every scene while the PhysicsLab
  // still showed it.
  "physicsLens",
  // 39 -> 40: "hvacLens" so a user's technicians, appointments, bookings,
  // equipment assets, payments, agreements, and field visits survive a
  // restart. The HVAC domain stores per-user data here; without this key a
  // hard restart wiped every dispatch board and equipment record while the
  // FieldService panels still showed them.
  "hvacLens",
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
