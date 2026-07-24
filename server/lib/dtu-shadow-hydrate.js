// server/lib/dtu-shadow-hydrate.js
//
// Lazy SQL → in-memory hydration for STATE.dtus.
//
// Background (grounding audit, 2026-07): dozens of call sites across the
// codebase (`server/domains/gamedesign.js#building-publish`,
// `server/lib/forge-marketplace.js#mintForgeAppAsDtu`, and ~20 others —
// grep `INSERT INTO dtus` under `server/`) mint a DTU with a raw SQL
// `INSERT INTO dtus (...)`, which is a real, durable row in the SQL `dtus`
// table. But `dtu.create` (server.js) is the ONLY writer that also populates
// the in-memory `STATE.dtus` Map, and the legacy marketplace macros
// (`marketplace.list` / `marketplace.purchaseWithRoyalties` in server.js)
// read and write exclusively against `STATE.dtus`. The result: a DTU minted
// via a raw INSERT is a real row nobody can list or buy — it's invisible to
// the marketplace even though it durably exists.
//
// This module is the fix's read-side half: given a raw `dtus` SQL row,
// reconstruct the equivalent `STATE.dtus` entry (the shape `dtu.create`
// itself builds — see server.js's `register("dtu","create", ...)`). It is
// intentionally a PURE function of the row — no STATE access, no caching —
// so it's trivially unit-testable and so the caller (server.js, which owns
// STATE) decides whether/how to cache the result into STATE.dtus.
//
// Honesty rule: every field on the hydrated object either came from a real
// SQL column/JSON-blob or is the same neutral/empty default `dtu.create`
// uses for a field the caller didn't supply (e.g. `core.claims: []`). A
// field this table genuinely has no column for (there is no `scope` column
// on `dtus` at all) is left unset — never fabricated — matching the
// existing "only gate DTUs with a concrete signal" convention already used
// by marketplace.list's ownership/scope checks for legacy/unowned DTUs.
//
// The `dtus` table has grown at least three disjoint write shapes over time
// (see `server/migrations/295_dtus_pipeline_reconcile.js` for the documented
// precedent — that migration added columns for exactly this reason, a
// self-consistent module writing a shape the canonical CREATE didn't have):
//   (1) "body_json" shape — owner_user_id / title / body_json / tags_json /
//       visibility / tier. Used by `gamedesign.js#building-publish`,
//       `art.js`, `creatures.js`, `guidance.js`, `durable.js`, and others.
//       `body_json` itself nests `{ title, meta, human, lineage }`.
//   (2) "data" shape — type / creator_id / data / skill_level /
//       total_experience. Used by `forge-marketplace.js#mintForgeAppAsDtu`
//       and most skill/crafting/npc lib helpers. `data` is a flat meta blob.
//   (3) "content" shape — creator_id / content / content_type /
//       metadata_json / status. Used by `server/economy/dtu-pipeline.js`.
// A given row only ever populates the columns ITS writer used, so this
// hydrator reads whichever JSON blob(s) are actually present and merges
// them — it never invents a field none of the three shapes wrote.

function safeJsonParse(raw, fallback) {
  if (raw == null) return fallback;
  if (typeof raw === "object") return raw; // already parsed (defensive)
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// Several writers store `created_at`/`updated_at` as `unixepoch()` integers
// (seconds since epoch — forge-marketplace.js, several skill/crafting/npc
// paths) while others store SQLite `datetime('now')` strings or full ISO
// strings. Normalise all three to ISO so the hydrated shape matches
// `dtu.create`'s `nowISO()`-stamped fields.
function toIso(value, fallbackIso) {
  if (value == null) return fallbackIso;
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  const s = String(value);
  const normalised = s.includes(" ") && !s.includes("T") ? `${s.replace(" ", "T")}Z` : s;
  const asDate = new Date(normalised);
  return Number.isNaN(asDate.getTime()) ? fallbackIso : asDate.toISOString();
}

/**
 * Pure mapper: raw `dtus` SQL row → canonical STATE.dtus in-memory shape.
 * Returns null for a falsy/id-less row (never throws on a malformed row).
 */
export function hydrateDtuRow(row) {
  if (!row || !row.id) return null;

  const bodyJson = safeJsonParse(row.body_json, null);
  const dataJson = safeJsonParse(row.data, null);
  const metadataJson = safeJsonParse(row.metadata_json, null);
  const tagsParsed = safeJsonParse(row.tags_json, []);

  const meta = {
    ...(dataJson && typeof dataJson === "object" ? dataJson : {}),
    ...(metadataJson && typeof metadataJson === "object" ? metadataJson : {}),
    ...(bodyJson?.meta && typeof bodyJson.meta === "object" ? bodyJson.meta : {}),
  };

  const ownerId = row.owner_user_id || row.creator_id || null;
  const title = row.title || bodyJson?.title || "Untitled DTU";
  const createdAtIso = toIso(row.created_at, new Date().toISOString());
  const updatedAtIso = toIso(row.updated_at ?? row.created_at, createdAtIso);

  const humanSummary =
    bodyJson?.human?.summary ||
    meta.summary ||
    (typeof row.content === "string" ? row.content.slice(0, 320) : "") ||
    title;

  return {
    id: row.id,
    title,
    tags: Array.isArray(tagsParsed) ? tagsParsed : [],
    tier: String(row.tier || "regular").toLowerCase(),
    // Real lineage only when the writer actually stored one (the
    // "body_json" shape is the only one of the three that carries
    // `lineage.parents` today) — never fabricate a parent relationship.
    // `computeRoyaltyCascade` reads `currentDtu.lineage?.parents || []`, so
    // an empty object here is equivalent to "no known parents", same as any
    // native STATE.dtus entry with no lineage.
    lineage: bodyJson?.lineage && typeof bodyJson.lineage === "object" ? bodyJson.lineage : {},
    source: "sql_shadow",
    meta,
    ownerId,
    visibility: row.visibility || "private",
    consent: {},
    federation_tier: row.federation_tier || null,
    location_regional: row.location_regional || null,
    location_national: row.location_national || null,
    creatorType: ownerId ? "user" : "system",
    core: { definitions: [], invariants: [], examples: [], claims: [], nextActions: [] },
    human: {
      summary: String(humanSummary || ""),
      bullets: Array.isArray(bodyJson?.human?.bullets) ? bodyJson.human.bullets : [],
      examples: Array.isArray(bodyJson?.human?.examples) ? bodyJson.human.examples : [],
    },
    machine: {},
    cretiHuman: "",
    // No `scope` column exists on `dtus` at all — leave it unset rather
    // than invent one. marketplace.list's gate (`dtu.scope && dtu.scope
    // !== "personal"`) treats a falsy scope as "no restriction", the same
    // convention already documented there for legacy/unowned DTUs.
    scope: undefined,
    createdAt: createdAtIso,
    updatedAt: updatedAtIso,
    authority: { model: "council", score: 0, votes: {} },
    domain: row.lens_id || meta.lens || null,
    hash: row.content_hash || null,
    worldId: row.world_id || null,
    // Marker so callers/debuggers can tell this STATE.dtus entry is a
    // lazily-hydrated shadow of a real SQL row, not a dtu.create original.
    sqlShadow: true,
  };
}

/**
 * Reads the raw `dtus` row for `dtuId` and hydrates it. Returns null when
 * there's no db handle, no dtuId, no matching row, or the query throws
 * (e.g. table missing in a minimal test db) — callers should treat null as
 * "not found", same as a plain `STATE.dtus.get(dtuId)` miss.
 */
export function readAndHydrateDtu(db, dtuId) {
  if (!db || !dtuId) return null;
  let row;
  try {
    row = db.prepare("SELECT * FROM dtus WHERE id = ?").get(dtuId);
  } catch {
    return null;
  }
  if (!row) return null;
  return hydrateDtuRow(row);
}
