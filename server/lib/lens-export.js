// server/lib/lens-export.js
//
// Q79: the shared top-bar Export must download the lens's REAL data.
//
// The generic artifact store (STATE.lensArtifacts, read by lens.list)
// is only half of what a lens holds: many lenses keep their records in
// per-domain state (Calendar's events live in STATE.calendarLens), so
// an artifacts-only export is hollow — an honest empty notice when the
// store is empty, a misleading partial bundle when it is not. And the
// store can contain dispatcher scaffolding rows (type "domain_action",
// minted by a legacy path) that are invocation plumbing, never user
// data; exporting them produced the "Copy of undefined" garbage rows.
//
// This module is the export-side fix, deliberately separate from
// lens.list (which other surfaces render from and whose contract does
// not change):
//   - collectLensExport merges (a) artifacts obtained through the
//     canonical lens.list macro — so the ownership/visibility rules are
//     reused, never duplicated — with scaffolding types filtered out,
//     and (b) rows from the domain's registered export provider.
//   - A domain adopts state-backed export by registering a provider:
//     registerLensExportProvider(domain, (ctx) => rows). A provider
//     receives the caller's ctx and MUST scope rows to that caller.
//     Rows are export-shaped: { id, title, type, createdAt, updatedAt,
//     data }.
//   - The result reports its provenance (sources + stateBacked) so the
//     UI can be honest about what an export does and does not include.

import { dtuMatchesDomain } from "./art-dtu-filter.js";
import { dtuListedOwner } from "./dtu-list-source.js";

const SCAFFOLDING_TYPES = new Set(["domain_action"]);

/** A DTU may ride in this lens's export only when it is this domain, or untagged and not another lens's exhaust. */
export function dtuBelongsInLensExport(dtu, domain, callerId) {
  if (!dtu || typeof dtu !== "object") return false;
  // GB-1536 §4 follow-up (B8 D6 pointer, 2026-11-14): owner resolution
  // is the canonical dtuListedOwner chain (author‖ownerId‖userId‖
  // createdBy‖authorId‖creator_id) plus meta.ownerId — the same
  // resolution the artifacts leg (exportScoped) applies. The old
  // three-field chain misread author-stamped rows as ownerless, and
  // ownerless rows then RODE a personal export; under the office's
  // ownerless call (CB-0594) they FALL here too — a personal export
  // carries only the caller's own rows.
  const owner = dtuListedOwner(dtu) || dtu.meta?.ownerId || null;
  if (!owner || !callerId) return false;
  if (owner === "system") return false;
  if (String(owner) !== String(callerId)) return false;
  const tagged = String(dtu.domain || dtu.meta?.lens || dtu.machine?.kind || dtu.kind || "").trim();
  if (tagged) return dtuMatchesDomain(dtu, domain);
  const title = String(dtu.title || "");
  if (title.startsWith("Lens:")) return false;
  if (/chat context/i.test(title) && String(domain) !== "chat") return false;
  return true;
}

const providers = new Map(); // domain -> (ctx) => rows[] | Promise<rows[]>

export function registerLensExportProvider(domain, provider) {
  if (!domain || typeof provider !== "function") return false;
  providers.set(domain, provider);
  return true;
}

export function hasLensExportProvider(domain) {
  return providers.has(domain);
}

export function _clearLensExportProvidersForTests() {
  providers.clear();
}

/** Keys that are indexes, caches, or shared rooms — never a user's records. */
const STRUCTURAL_STATE_KEYS = new Set([
  "seq", "seqs", "cache", "sharecache", "timers", "votes", "sharedvotes",
  "sharedboards", "voicerooms", "voicepeers", "overlayprefs", "participants",
]);

function exportActorId(ctx) {
  const id = ctx?.actor?.userId || ctx?.actor?.id || ctx?.userId || null;
  return id ? String(id) : null;
}

/**
 * Short bags whose key is not `<domain>Lens`. The records inside are still
 * caller-scoped by exportCallerLensState.
 */
const LENS_BAG_ALIASES = {
  creativewriting: "writingLens",
  construction: "conLens",
  insurance: "insLens",
  telecommunications: "telecom",
};

/**
 * Find `STATE.<domain>Lens` for "film-studios" / "filmStudiosLens" alike.
 * When that bag is absent, use a known alias (writingLens, conLens) or the
 * root maps named `<domain><CamelRest>` (sentinelCases). Returns null when
 * this domain keeps no such store.
 */
export function lensStateBag(state, domain) {
  if (!state || typeof state !== "object" || !domain) return null;
  const want = String(domain).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!want) return null;
  if (state instanceof Map) return null;
  for (const key of Object.keys(state)) {
    if (!/lens$/i.test(key)) continue;
    const stem = key.slice(0, -4).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (stem === want) return state[key];
  }
  const alias = LENS_BAG_ALIASES[want];
  if (alias && state[alias] && typeof state[alias] === "object") return state[alias];
  const prefixed = {};
  for (const key of Object.keys(state)) {
    if (typeof state[key] === "function") continue;
    const flat = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (flat === want) {
      const value = state[key];
      // A namesake object (cognitiveReplay) is the bag. A namesake Map
      // stays in the prefixed set so only the caller's bucket is read.
      if (value && typeof value === "object" && !(value instanceof Map) && !Array.isArray(value)) {
        return value;
      }
      prefixed[key] = value;
      continue;
    }
    if (key.length > want.length && key.toLowerCase().startsWith(want)) {
      const boundary = key[want.length];
      if (boundary === boundary.toUpperCase() && boundary !== boundary.toLowerCase()) {
        prefixed[key] = state[key];
      }
    }
  }
  return Object.keys(prefixed).length ? prefixed : null;
}

function isExportRecord(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value) || value instanceof Map || value instanceof Set) return false;
  return typeof value.id === "string" || typeof value.id === "number"
    || typeof value.title === "string" || typeof value.name === "string";
}

function plainRecord(rec) {
  const data = {};
  for (const [key, value] of Object.entries(rec)) {
    if (typeof value === "function") continue;
    if (value instanceof Map || value instanceof Set) continue;
    data[key] = value;
  }
  return data;
}

function rowFromRecord(rec, type) {
  const data = plainRecord(rec);
  return {
    id: rec.id ?? null,
    type: typeof type === "string" && type ? type : "record",
    title: (typeof rec.title === "string" && rec.title)
      || (typeof rec.name === "string" && rec.name)
      || (typeof rec.label === "string" && rec.label)
      || (rec.id != null ? String(rec.id) : type),
    createdAt: rec.createdAt ?? rec.created_at ?? null,
    updatedAt: rec.updatedAt ?? rec.updated_at ?? rec.createdAt ?? rec.created_at ?? null,
    data,
  };
}

function recordsInBucket(bucket) {
  if (Array.isArray(bucket)) return bucket.filter(isExportRecord);
  if (bucket instanceof Map) return [...bucket.values()].filter(isExportRecord);
  if (isExportRecord(bucket)) return [bucket];
  return [];
}

/**
 * Panel records stored on `STATE.<domain>Lens` (per-user Map or owned
 * array). Only the caller's bucket is read. A map that is NOT keyed by
 * the caller — shared boards, rooms, other people's rows — contributes
 * nothing.
 */
export function exportCallerLensState(state, domain, ctx, limit = 1000) {
  const userId = exportActorId(ctx);
  if (!userId) return [];
  const bag = lensStateBag(state, domain);
  if (!bag || typeof bag !== "object") return [];
  const cap = Number.isFinite(limit) && limit > 0 ? limit : 1000;
  const rows = [];

  const take = (type, bucket) => {
    for (const rec of recordsInBucket(bucket)) {
      if (rows.length >= cap) return;
      rows.push(rowFromRecord(rec, type));
    }
  };

  if (bag instanceof Map) {
    take("record", bag.get(userId));
    return rows;
  }

  for (const [key, value] of Object.entries(bag)) {
    if (rows.length >= cap) break;
    if (STRUCTURAL_STATE_KEYS.has(String(key).toLowerCase())) continue;
    if (value instanceof Map) {
      take(key, value.get(userId));
      continue;
    }
    if (Array.isArray(value)) {
      for (const rec of value) {
        if (rows.length >= cap) break;
        if (!isExportRecord(rec)) continue;
        const owner = rec.ownerId || rec.userId || rec.user_id || null;
        if (owner == null || String(owner) !== userId) continue;
        rows.push(rowFromRecord(rec, key));
      }
    }
  }
  return rows;
}

function normalizeRow(row, domain) {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id ?? null,
    domain,
    type: typeof row.type === "string" ? row.type : "record",
    title: typeof row.title === "string" ? row.title : (typeof row.name === "string" ? row.name : ""),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? row.createdAt ?? null,
    data: row.data && typeof row.data === "object" ? row.data : row,
  };
}

/**
 * @param {object} deps
 * @param {(domain: string, action: string, input: object, ctx: object) => Promise<object>} deps.runMacro
 * @param {string} deps.domain
 * @param {object} deps.ctx - the caller's macro context (actor scoping rides on it)
 * @param {number} [deps.limit]
 */
export async function collectLensExport({ runMacro, domain, ctx, limit = 1000 }) {
  if (!domain) return { ok: false, error: "domain required" };
  if (typeof runMacro !== "function") return { ok: false, error: "run_macro_unavailable" };

  const listed = await runMacro("lens", "list", { domain, limit }, ctx);
  if (!listed || listed.ok === false) {
    return { ok: false, error: listed?.error || "lens_list_failed" };
  }
  const callerId = ctx?.actor?.userId || ctx?.actor?.id || null;
  const isActivityMint = (a) => {
    const from = a?.meta?.createdFrom;
    if (from === "dtu-auto-sync" || from === "integrity-repair") return true;
    if (typeof a?.id === "string" && a.id.startsWith("dtu_lens_")) return true;
    if (typeof a?.title === "string" && a.title.startsWith("Lens:")) return true;
    return false;
  };
  // Owner-scoped export contract (lens-export ruling, 2026-11-14 —
  // FIX-research-001 / FIX-export-011): a per-lens export is the
  // caller's own takeout, so this leg is scoped to caller-owned rows
  // via the canonical dtuListedOwner chain (plus meta.ownerId, where
  // artifacts stamp it). System rows never ride a personal export,
  // and another owner's row never rides, public or published — the
  // 2026-11-09 hotfix's blanket keep of "genuine non-activity public
  // catalog rows" is retired: it is what dumped 999 system feed
  // articles into a research export that should have carried the
  // user's references or nothing. The caller's own records ride at
  // any visibility. OWNERLESS ROWS FALL (office call, 2026-11-14,
  // B5's reading governs): the contract is the caller's own records,
  // and an ownerless row is not the caller's — the public catalog
  // stays browsable in-app; it is not a takeout. The activity-mint
  // filter below still applies on top (a caller-owned activity
  // mirror rides; anyone else's is already gone by this filter).
  const exportScoped = (a) => {
    const owner = dtuListedOwner(a) || a?.meta?.ownerId || null;
    if (!owner || owner === "system") return false;
    return !!(callerId && String(owner) === String(callerId));
  };
  const artifacts = (Array.isArray(listed.artifacts) ? listed.artifacts : [])
    .filter((a) => a && !SCAFFOLDING_TYPES.has(a.type))
    .filter(exportScoped)
    .filter((a) => {
      if (!isActivityMint(a)) return true;
      return !!(callerId && a.ownerId && a.ownerId === callerId && a.ownerId !== "system" && a.ownerId !== "anon");
    });

  let providerRows = [];
  let providerError = null;
  const provider = providers.get(domain);
  if (provider) {
    try {
      const raw = await provider(ctx);
      providerRows = (Array.isArray(raw) ? raw : [])
        .map((r) => normalizeRow(r, domain))
        .filter(Boolean);
    } catch (err) {
      // A failing provider must not take the artifact export down with
      // it — but the failure is reported, never silently swallowed.
      providerError = err?.message || "export_provider_failed";
    }
  }

  // ── A4 Leg A: the caller's own canonical DTUs in this domain ──────
  // Work a user saves inside a lens (SaveAsDtuButton / recordKeep →
  // dtu.create) is a canonical DTU: it is neither a lens artifact nor a
  // provider row, so a two-source export told the user "this lens has
  // no saved data" over their own saved work (Transfer F9 + its ↓.dtu
  // recurrences). The canonical list macro already owns the visibility
  // rules (mine = the caller's own, any scope; domain via
  // dtuMatchesDomain) — reuse them, never duplicate them. A failing
  // dtu leg degrades to the two-source behaviour and is REPORTED in
  // sources, never silently swallowed.
  let dtuRows = [];
  let dtuError = null;
  try {
    const mine = await runMacro("dtu", "list", { domain, mine: true, limit }, ctx);
    const list = Array.isArray(mine?.dtus) ? mine.dtus : (Array.isArray(mine?.items) ? mine.items : []);
    const seen = new Set([...artifacts, ...providerRows].map((r) => r?.id).filter(Boolean));
    dtuRows = list
      .filter((d) => d && d.id && !seen.has(d.id) && dtuBelongsInLensExport(d, domain, callerId))
      .map((d) => normalizeRow({
        id: d.id,
        type: "dtu",
        title: typeof d.title === "string" ? d.title : "",
        createdAt: d.createdAt ?? null,
        data: {
          title: typeof d.title === "string" ? d.title : "",
          tags: Array.isArray(d.tags) ? d.tags : [],
          summary: (typeof d.human?.summary === "string" && d.human.summary)
            || (typeof d.cretiHuman === "string" ? d.cretiHuman : ""),
          content: typeof d.content === "string" ? d.content : "",
        },
      }, domain))
      .filter(Boolean);
  } catch (err) {
    dtuError = err?.message || "dtu_list_failed";
  }

  // Panel records that live in STATE.<domain>Lens rather than the
  // artifact store. Caller-scoped. Deduped against provider rows so a
  // domain that already registers a provider is not exported twice.
  const seen = new Set(
    [...artifacts, ...providerRows, ...dtuRows].map((r) => r?.id).filter((id) => id != null),
  );
  const stateRows = exportCallerLensState(globalThis._concordSTATE, domain, ctx, limit)
    .map((r) => normalizeRow(r, domain))
    .filter((r) => r && (r.id == null || !seen.has(r.id)));

  const rows = [...artifacts, ...providerRows, ...stateRows, ...dtuRows];
  return {
    ok: true,
    domain,
    artifacts: rows,
    total: rows.length,
    sources: {
      artifacts: artifacts.length,
      stateRecords: providerRows.length + stateRows.length,
      ownDtus: dtuRows.length,
    },
    stateBacked: Boolean(provider) || lensStateBag(globalThis._concordSTATE, domain) != null,
    ...(providerError ? { providerError } : {}),
    ...(dtuError ? { dtuError } : {}),
  };
}
