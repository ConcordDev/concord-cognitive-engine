/**
 * Plugin gallery — the marketplace surface for browsable, installable
 * plugin packages. Each entry tracks: author, signed source, version,
 * description, install count, and a verified-trust flag (computed from
 * plugin-signing).
 *
 * Persistence: in-memory map plus optional db backing via the
 * plugin_gallery table from migration 086.
 */

import { verifyPluginPackage, computePluginHash } from "./plugin-signing.js";
import { LruMap, LruSet } from "./lru-map.js";
import { loadPluginFromSource, getPlugin as getLoadedPlugin } from "../plugins/loader.js";

const _gallery = new LruMap(); // pluginId -> entry
const _installs = new LruMap(); // pluginId -> Set<userId>

export function publishPlugin({ pluginId, authorId, name, description, version, source, signature, db = null }) {
  if (!pluginId || !authorId || !source) {
    return { ok: false, error: "missing_pluginId_authorId_or_source" };
  }
  const verify = verifyPluginPackage({ source, signature, authorId, db });
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
  };
  _gallery.set(pluginId, entry);

  if (db) {
    try {
      db.prepare(`INSERT OR REPLACE INTO plugin_gallery
                  (plugin_id, author_id, name, description, version, source, signature, hash, trusted, published_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(pluginId, authorId, entry.name, entry.description, entry.version,
             source, signature ?? null, entry.hash, entry.trusted ? 1 : 0, entry.publishedAt);
    } catch { /* table may not exist on first run */ }
  }
  return { ok: true, plugin: { ...entry, source: undefined } }; // strip source from response
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
function withLoadedFlag(entry, STATE) {
  const out = { ...entry, source: undefined };
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

export function listGallery({ trustedOnly = false, search = null, limit = 50, STATE = null } = {}) {
  const out = [];
  for (const e of _gallery.values()) {
    if (trustedOnly && !e.trusted) continue;
    if (search) {
      const s = search.toLowerCase();
      if (!e.name.toLowerCase().includes(s) && !e.description.toLowerCase().includes(s)) continue;
    }
    out.push(withLoadedFlag(e, STATE));
  }
  out.sort((a, b) => b.installs - a.installs);
  return { ok: true, plugins: out.slice(0, limit) };
}

export function getGalleryEntry(pluginId, STATE = null) {
  const e = _gallery.get(pluginId);
  if (!e) return { ok: false, error: "not_found" };
  return { ok: true, plugin: withLoadedFlag(e, STATE) };
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

  const loadResult = await loadPluginFromSource(STATE, entry.source, opts);

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
