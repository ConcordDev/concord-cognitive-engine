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

const _gallery = new Map(); // pluginId -> entry
const _installs = new Map(); // pluginId -> Set<userId>

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

export function listGallery({ trustedOnly = false, search = null, limit = 50 } = {}) {
  const out = [];
  for (const e of _gallery.values()) {
    if (trustedOnly && !e.trusted) continue;
    if (search) {
      const s = search.toLowerCase();
      if (!e.name.toLowerCase().includes(s) && !e.description.toLowerCase().includes(s)) continue;
    }
    out.push({ ...e, source: undefined });
  }
  out.sort((a, b) => b.installs - a.installs);
  return { ok: true, plugins: out.slice(0, limit) };
}

export function getGalleryEntry(pluginId) {
  const e = _gallery.get(pluginId);
  if (!e) return { ok: false, error: "not_found" };
  return { ok: true, plugin: e };
}

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

export function ratePlugin(pluginId, userId, vote) {
  const entry = _gallery.get(pluginId);
  if (!entry) return { ok: false, error: "plugin_not_found" };
  if (vote === "up") entry.rating.up++;
  else if (vote === "down") entry.rating.down++;
  else return { ok: false, error: "invalid_vote" };
  return { ok: true, rating: entry.rating };
}
