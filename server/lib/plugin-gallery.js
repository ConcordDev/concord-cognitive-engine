/**
 * Plugin gallery — the marketplace surface for browsable, installable
 * plugin packages. Each entry tracks: author, signed source, version,
 * description, install count, and a verified-trust flag (computed from
 * plugin-signing).
 *
 * Persistence: in-memory map plus optional db backing via the
 * plugin_gallery table from migration 086.
 *
 * SDK-H (author identity/reputation): every entry from `listGallery` /
 * `getGalleryEntry` also carries `authorReputationSummary` — the author's
 * REAL peer-visible reputation (citations/DTUs/badges), reused from the
 * general reputation system (`profile.reputation-summary` + `reputation-
 * badges.js`), never a parallel one. See `computeAuthorReputation` below for
 * how it's derived and degrades honestly. This is deliberately a DIFFERENT
 * trust signal from `trusted`/`trustDescription` (self-attested signing) —
 * never conflate the two on the client.
 */

import { verifyPluginPackage, computePluginHash } from "./plugin-signing.js";
import { LruMap, LruSet } from "./lru-map.js";
import { listBadges } from "./reputation-badges.js";
import {
  loadPluginFromSource,
  getPlugin as getLoadedPlugin,
  unloadPlugin as unloadLoadedPlugin,
  DEFAULT_PLUGIN_MACRO_GRANTS,
} from "../plugins/loader.js";

const _gallery = new LruMap(); // pluginId -> entry
const _installs = new LruMap(); // pluginId -> Set<userId>

// Capability disclosure: sanitize a publisher-supplied `manifest.macros`
// list down to non-empty strings only. Anything malformed is dropped rather
// than rejecting the publish — the loader's own confinement (makeConfinedCtx
// / the forbidden-domain hard-denylist in confined-ctx.js) is what actually
// enforces safety regardless of what a manifest claims, so a sloppy manifest
// degrades to the safe default, never to a wider grant than intended.
function sanitizeDeclaredMacros(manifest) {
  if (!Array.isArray(manifest?.macros) || !manifest.macros.length) return null;
  const grants = manifest.macros
    .map((g) => (typeof g === "string" ? g.trim() : ""))
    .filter(Boolean);
  return grants.length ? grants : null;
}

// Always present alongside the existing `trusted` boolean (never renamed —
// that would be a breaking API change for any consumer). States plainly what
// `trusted` actually means today under the user-approved "lightweight
// automated gate + honest labeling" scope: self-attestation, not review.
function trustDescriptionFor(trusted) {
  return trusted
    ? "Self-attested: signed with a key this author registered for themselves. Not independently reviewed."
    : "Unsigned, or the signature doesn't verify against a registered key. Not independently reviewed.";
}

// SDK-H — author identity/reputation. Rank used to pick the single
// highest-tier badge to headline on a gallery card, matching the tier
// ordering already authored in reputation-badges.js's TIER_TABLE.
const _BADGE_TIER_RANK = { bronze: 1, silver: 2, gold: 3, platinum: 4, diamond: 5 };

function pickTopBadge(badges) {
  if (!Array.isArray(badges) || badges.length === 0) return null;
  return badges.reduce((best, b) => {
    if (!best) return b;
    const rank = _BADGE_TIER_RANK[b.tier] || 0;
    const bestRank = _BADGE_TIER_RANK[best.tier] || 0;
    if (rank > bestRank) return b;
    // Tie-break toward the composite headline category — it's the one
    // meant to read as "the" tier when several single-axis badges tie.
    if (rank === bestRank && b.category === "knowledge_entrepreneur" && best.category !== "knowledge_entrepreneur") return b;
    return best;
  }, null);
}

/**
 * Author-identity reputation for a gallery entry (SDK-H). Reuses the two REAL
 * peer-visible reputation sources this codebase already has — never invents a
 * parallel one:
 *
 *   - `profile.reputation-summary` (`server/domains/profile.js`, V1.2 Wave A),
 *     reached via the injected `getAuthorReputation(authorId)` callback.
 *     `server.js` wires this to the real registered lens-action handler with
 *     a real `ctx.db`, calling it with `targetUserId = authorId` — the SAME
 *     peer-view path a human clicking "View Profile" on another user takes,
 *     so it inherits that path's honesty (real DTU/citation counts, redacted
 *     to public/marketplace-visible DTUs for a non-self view, all-zeros with
 *     no fabricated reputation polygon when the author has no activity).
 *     `plugin-gallery.js` never talks to `ctx.db` directly for this — it
 *     only accepts already-resolved results through the callback, so this
 *     module stays decoupled from the profile domain and the server.js boot
 *     order (see CLAUDE.md's LENS_ACTIONS TDZ note).
 *   - `listBadges` (`server/lib/reputation-badges.js`) — REAL tiered badges
 *     (bronze/silver/gold/platinum/diamond) already granted to this user from
 *     citation/download/lineage/listing activity. Imported directly (no db
 *     dependency), so a real badge still shows even when the caller omits
 *     `getAuthorReputation` entirely.
 *
 * Best-effort + honest by construction: a missing callback, an unregistered
 * handler, a db error, or simply an author with no activity all degrade to
 * `available:false` / `hasActivity:false` / empty `badges` — NEVER a
 * fabricated tier or count. This is a SEPARATE trust signal from the
 * gallery's own self-attested `trusted`/`trustDescription` (plugin-signing.js)
 * — the two must never be merged into one badge/boolean on the client (see
 * `AuthorBadge.tsx`).
 *
 * @param {string} authorId
 * @param {{ getAuthorReputation?: (authorId: string) => ({ ok: boolean, result?: object } | null) }} [opts]
 */
function computeAuthorReputation(authorId, { getAuthorReputation = null } = {}) {
  const out = {
    authorId,
    available: false,
    hasActivity: false,
    totalCitations: 0,
    dtuCount: 0,
    worldsOwned: 0,
    reputationDomains: [],
    badges: [],
    topBadge: null,
  };
  if (!authorId) return out;

  if (typeof getAuthorReputation === "function") {
    try {
      const r = getAuthorReputation(authorId);
      if (r && r.ok && r.result) {
        out.available = true;
        out.totalCitations = Number(r.result.totalCitations) || 0;
        out.dtuCount = Number(r.result.dtuCount) || 0;
        out.worldsOwned = Number(r.result.worldsOwned) || 0;
        out.reputationDomains = Array.isArray(r.result.reputation) ? r.result.reputation : [];
        out.hasActivity = out.dtuCount > 0 || out.totalCitations > 0;
      }
    } catch { /* best-effort — a reputation-lookup failure never blocks the gallery */ }
  }

  try {
    const b = listBadges(authorId);
    out.badges = Array.isArray(b?.badges) ? b.badges : [];
    out.topBadge = pickTopBadge(out.badges);
    if (out.badges.length > 0) out.hasActivity = true;
  } catch { /* leave badges empty — honest, not fabricated */ }

  return out;
}

export function publishPlugin({ pluginId, authorId, name, description, version, source, signature, manifest = null, db = null }) {
  if (!pluginId || !authorId || !source) {
    return { ok: false, error: "missing_pluginId_authorId_or_source" };
  }
  const verify = verifyPluginPackage({ source, signature, authorId, db });
  // Item 3/4 — capability disclosure. `declaredMacros` is the SAME grant
  // list `installFromGallery` forwards to `loadPluginFromSource` as its
  // manifest (see below), so what's displayed here is what actually gets
  // enforced at install time, never a hand-maintained parallel description.
  // A publisher who declares nothing gets the loader's own default set —
  // imported from loader.js, not re-typed here.
  const declaredMacros = sanitizeDeclaredMacros(manifest) || [...DEFAULT_PLUGIN_MACRO_GRANTS];
  // Allow unsigned publish for emergent-gen / dev plugins; just flag trust=false.
  const entry = {
    pluginId,
    authorId,
    name: name ?? pluginId,
    description: description ?? "",
    version: version ?? "0.0.1",
    source,
    signature: signature ?? null,
    hash: verify.hash ?? computePluginHash(source),
    trusted: verify.ok && verify.trusted,
    declaredMacros,
    publishedAt: new Date().toISOString(),
    installs: 0,
    rating: { up: 0, down: 0 },
    // The gallery's own publish-time key (`pluginId`, e.g.
    // "gallery.install-target") and the loader's internal plugin identity
    // (the module's own exported `id`, e.g. "example.gallery-install-target")
    // are two independent namespaces — a publisher has no obligation to make
    // them match. `loadedPluginId` records the REAL internal id once a
    // successful `loadPluginFromSource` call tells us what it is, so
    // `withLoadedFlag`/`installFromGallery` can look the plugin up in the
    // loader's own store correctly instead of guessing it equals `pluginId`.
    loadedPluginId: null,
    // Takedown path (item 5) — both null until an admin calls delistPlugin.
    delistedAt: null,
    delistedReason: null,
    delistedBy: null,
  };
  _gallery.set(pluginId, entry);

  if (db) {
    try {
      db.prepare(`INSERT OR REPLACE INTO plugin_gallery
                  (plugin_id, author_id, name, description, version, source, signature, hash, trusted, published_at, declared_macros_json)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(pluginId, authorId, entry.name, entry.description, entry.version,
             source, signature ?? null, entry.hash, entry.trusted ? 1 : 0, entry.publishedAt,
             JSON.stringify(declaredMacros));
    } catch { /* table may not exist on first run, or declared_macros_json predates migration 393 */ }
  }
  return { ok: true, plugin: withLoadedFlag(entry, null) }; // strip source from response
}

// `trusted` (self-attested signature verification, see plugin-signing.js) and
// `loaded` (is this plugin's code ACTUALLY running in this process right now,
// per the loader's own record) are deliberately two separate fields on every
// entry this module hands back. Conflating them would let an unsigned-but-
// running plugin read as "less real" than a signed-but-never-loaded one, or
// vice versa — neither implies the other (see docs/PLUGIN_AUTHORING_GUIDE.md
// §4). `STATE` is optional so callers that only need metadata (no loader
// lookup) can omit it; `loaded` is simply absent from the response then,
// never a guessed/defaulted `false`.
//
// This function also attaches the gallery's honesty fields, unconditionally
// (they never depend on STATE): `declaredCapabilities` (capability
// disclosure — the macro grants the plugin is confined to; see
// publishPlugin) and `trustDescription` (a plain-language gloss on what the
// existing `trusted` boolean actually means today — self-attestation, not
// review; `trusted` itself is left exactly as-is for back-compat). Delisting
// fields (`delistedAt`/`delistedReason`/`delistedBy`) pass through as-is —
// null on a never-delisted entry, populated on one an admin took down (see
// delistPlugin).
function withLoadedFlag(entry, STATE) {
  const out = {
    ...entry,
    source: undefined,
    declaredCapabilities: entry.declaredMacros ? [...entry.declaredMacros] : [...DEFAULT_PLUGIN_MACRO_GRANTS],
    trustDescription: trustDescriptionFor(!!entry.trusted),
  };
  if (STATE) {
    // Look up by the loader's own recorded internal id first (set on a
    // successful load — see loadedPluginId above); only fall back to the
    // gallery publish-key for the rare case a publisher chose the same
    // string for both, or for a legacy entry with no loadedPluginId at all.
    const lookupId = entry.loadedPluginId || entry.pluginId;
    out.loaded = !!getLoadedPlugin(STATE, lookupId).ok;
  }
  return out;
}

export function listGallery({ trustedOnly = false, search = null, limit = 50, STATE = null, getAuthorReputation = null } = {}) {
  const out = [];
  for (const e of _gallery.values()) {
    if (e.delistedAt) continue; // taken down — see delistPlugin; still reachable via getGalleryEntry for audit
    if (trustedOnly && !e.trusted) continue;
    if (search) {
      const s = search.toLowerCase();
      if (!e.name.toLowerCase().includes(s) && !e.description.toLowerCase().includes(s)) continue;
    }
    out.push(withLoadedFlag(e, STATE));
  }
  out.sort((a, b) => b.installs - a.installs);
  const sliced = out.slice(0, limit);

  // SDK-H — author identity/reputation, computed once per unique author
  // rather than once per entry, so N gallery entries by the same author
  // (a prolific publisher) cost one lookup, not N — the reasonable ceiling
  // for a page capped at `limit` (max 50) entries.
  const repCache = new Map();
  for (const p of sliced) {
    if (!repCache.has(p.authorId)) {
      repCache.set(p.authorId, computeAuthorReputation(p.authorId, { getAuthorReputation }));
    }
    p.authorReputationSummary = repCache.get(p.authorId);
  }

  return { ok: true, plugins: sliced };
}

export function getGalleryEntry(pluginId, STATE = null, { getAuthorReputation = null } = {}) {
  const e = _gallery.get(pluginId);
  if (!e) return { ok: false, error: "not_found" };
  const plugin = withLoadedFlag(e, STATE);
  plugin.authorReputationSummary = computeAuthorReputation(plugin.authorId, { getAuthorReputation });
  return { ok: true, plugin };
}

/**
 * Legacy bookkeeping-only install record — bumps the install counter/Set
 * WITHOUT ever running the plugin's code. Kept for reference/back-compat;
 * the real HTTP install path now calls `installFromGallery` below, which
 * subsumes this behavior and additionally executes the plugin through the
 * hardened sandbox. Do not wire new callers to this function — an "install"
 * that never loads the plugin is exactly the honesty gap that motivated
 * `installFromGallery`.
 */
export function recordInstall(pluginId, userId) {
  const entry = _gallery.get(pluginId);
  if (!entry) return { ok: false, error: "plugin_not_found" };
  if (!_installs.has(pluginId)) _installs.set(pluginId, new Set());
  const set = _installs.get(pluginId);
  if (set.has(userId)) return { ok: true, alreadyInstalled: true };
  set.add(userId);
  entry.installs++;
  return { ok: true };
}

/**
 * Actually install a gallery entry: runs its stored source through the SAME
 * hardened path every disk-scanned plugin goes through —
 * `loadPluginFromSource` (`server/plugins/loader.js`), i.e. the static
 * pattern gate + `PluginSandbox` worker+vm isolation + the full 4-gate
 * validator run again against the sandbox's reflected shape. There is no
 * shortcut: a gallery install and a boot-time disk-scan install terminate at
 * the exact same function, with the exact same confinement.
 *
 * A loaded plugin is process-global — its macros/hooks are registered once
 * for the whole server, not per user — so a SECOND user installing an
 * already-running plugin doesn't need (and must not attempt) to reload it;
 * that's recorded as a genuine "you now have this" success (`freshLoad:
 * false`) without touching the sandbox again. A REAL validation/sandbox
 * failure is reported honestly and NEVER silently recorded as an install —
 * the install counter and the per-user install Set are only touched on an
 * actual success (fresh load or already-running), never on failure.
 *
 * @param {Object} STATE
 * @param {string} pluginId - the gallery entry's id
 * @param {string} userId - the installing user
 * @param {Object} [opts] - forwarded to loadPluginFromSource:
 *   { register, helpers, runMacro, manifest, timeoutMs, resourceLimits }
 * @returns {Promise<{ ok, error?, reason?, validation?, loaded?, freshLoad?, alreadyInstalled?, pluginId? }>}
 */
export async function installFromGallery(STATE, pluginId, userId, opts = {}) {
  const entry = _gallery.get(pluginId);
  if (!entry) return { ok: false, error: "plugin_not_found" };
  if (!userId) return { ok: false, error: "user_required" };
  // A delisted entry stays readable (see getGalleryEntry) but is no longer
  // installable — otherwise the takedown path would be cosmetic for anyone
  // who already has (or guesses) the pluginId.
  if (entry.delistedAt) {
    return { ok: false, error: "plugin_delisted", reason: entry.delistedReason || null };
  }

  if (!_installs.has(pluginId)) _installs.set(pluginId, new Set());
  const userSet = _installs.get(pluginId);
  if (userSet.has(userId)) {
    return { ok: true, alreadyInstalled: true, loaded: true, pluginId: entry.loadedPluginId || entry.pluginId };
  }

  // Already running process-wide (a prior user's install already triggered
  // the real sandboxed load) — don't reload, just record this user's
  // membership on the install roster. Looked up by the LOADER's own
  // internal id (recorded on the first successful load below), never by
  // the gallery's publish-time key — the two namespaces are independent.
  if (entry.loadedPluginId && getLoadedPlugin(STATE, entry.loadedPluginId).ok) {
    userSet.add(userId);
    entry.installs++;
    return { ok: true, loaded: true, freshLoad: false, pluginId: entry.loadedPluginId };
  }

  if (!entry.source) {
    return { ok: false, error: "no_source_available" };
  }

  // Item 3/4 — enforce the SAME grants the gallery discloses as
  // `declaredCapabilities`. A caller-supplied `opts.manifest` (none of the
  // current HTTP routes set one) wins if present; otherwise the entry's own
  // declared/default grants are what actually gets confined, so disclosure
  // and enforcement can never drift apart.
  const loadOpts = opts.manifest ? opts : { ...opts, manifest: { macros: entry.declaredMacros || [...DEFAULT_PLUGIN_MACRO_GRANTS] } };
  const loadResult = await loadPluginFromSource(STATE, entry.source, loadOpts);

  if (!loadResult.ok) {
    // A concurrent install from another user may have won the race between
    // our getLoadedPlugin check above and this load call — that specific
    // failure (id_collision) is a genuine success from THIS user's point of
    // view, not a broken install. Anything else is an honest failure: do
    // NOT bump the install counter or add the user to the install set.
    const isRaceCollision = loadResult.error === "validation_failed"
      && loadResult.validation?.errors?.some((e) => String(e).includes("id_collision"));
    if (!isRaceCollision) {
      return {
        ok: false,
        error: "install_failed",
        reason: loadResult.error,
        validation: loadResult.validation || null,
      };
    }
  }

  if (loadResult.ok) entry.loadedPluginId = loadResult.pluginId;

  userSet.add(userId);
  entry.installs++;
  return {
    ok: true,
    loaded: true,
    freshLoad: loadResult.ok,
    pluginId: (loadResult.ok ? loadResult.pluginId : null) || entry.loadedPluginId || entry.pluginId,
  };
}

export function ratePlugin(pluginId, userId, vote) {
  const entry = _gallery.get(pluginId);
  if (!entry) return { ok: false, error: "plugin_not_found" };
  if (vote === "up") entry.rating.up++;
  else if (vote === "down") entry.rating.down++;
  else return { ok: false, error: "invalid_vote" };
  return { ok: true, rating: entry.rating };
}

/**
 * Admin-only takedown path (item 5 of the gallery-honesty pass). This is
 * NOT a review/moderation queue — the user explicitly chose "lightweight
 * automated gate + honest labeling" over that — it's the missing piece that
 * makes "an admin can stop a running plugin" also mean "and the gallery
 * stops advertising it." Delisting:
 *   - stamps delistedAt/delistedReason/delistedBy on the entry (persisted if
 *     `db` is supplied);
 *   - excludes the entry from `listGallery` going forward (see the
 *     `e.delistedAt` skip there) — but NOT from `getGalleryEntry` by direct
 *     id, which still returns it (with the delisted fields visible) for
 *     audit purposes;
 *   - blocks future `installFromGallery` calls (see the delistedAt guard
 *     there);
 *   - if the plugin is CURRENTLY loaded, reuses the loader's own
 *     `unloadPlugin` (never reimplements teardown) to actually stop it.
 *
 * Idempotent: delisting an already-delisted entry is a no-op success (the
 * original delistedAt/reason/by are preserved, not overwritten).
 *
 * @param {string} pluginId
 * @param {string} adminId - the acting admin's user id (recorded, not persisted to the DB column — the migration only adds delisted_at/delisted_reason)
 * @param {string} [reason]
 * @param {Object} [opts]
 * @param {Object} [opts.db] - persists the takedown; best-effort, matches publishPlugin's convention
 * @param {Object} [opts.STATE] - required to actually stop a currently-running plugin
 * @returns {{ ok, error?, plugin?, alreadyDelisted?, unloaded? }}
 */
export function delistPlugin(pluginId, adminId, reason = null, { db = null, STATE = null } = {}) {
  const entry = _gallery.get(pluginId);
  if (!entry) return { ok: false, error: "plugin_not_found" };

  if (entry.delistedAt) {
    return { ok: true, alreadyDelisted: true, plugin: withLoadedFlag(entry, STATE) };
  }

  entry.delistedAt = new Date().toISOString();
  entry.delistedReason = reason ?? null;
  entry.delistedBy = adminId ?? null;

  // Reuse the loader's own unload — never reimplement teardown here.
  let unloaded = null;
  const lookupId = entry.loadedPluginId || entry.pluginId;
  if (STATE && getLoadedPlugin(STATE, lookupId).ok) {
    const result = unloadLoadedPlugin(STATE, lookupId);
    unloaded = !!result.ok;
  }

  if (db) {
    try {
      db.prepare(`UPDATE plugin_gallery SET delisted_at = ?, delisted_reason = ? WHERE plugin_id = ?`)
        .run(entry.delistedAt, entry.delistedReason, pluginId);
    } catch { /* table/columns may predate migration 393, or entry was never persisted */ }
  }

  return { ok: true, plugin: withLoadedFlag(entry, STATE), unloaded };
}
