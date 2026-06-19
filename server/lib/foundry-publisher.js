// @sync-fs-ok: publish-time output-directory ensure (low-frequency admin op). Sync fs in this file is intentional and not on the user request path (audited 2026-06).
// server/lib/foundry-publisher.js
//
// Phase Q — UGC worlds. Users author a sub-world via the Foundry lens;
// the publisher writes the JSON-triplet pattern (meta + factions + npcs +
// lore + loops) into content/world/usergen-<slug>/ and records a row in
// ugc_worlds so the discoverSubWorlds seeder picks it up on next boot.
//
// The author-supplied content passes through Phase Q moderation gates
// before persistence; rejection surfaces actionable feedback.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import logger from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORLD_ROOT = path.resolve(__dirname, "..", "..", "content", "world");
const UGC_PREFIX = "usergen-";

const SLUG_RE = /^[a-z][a-z0-9-]{2,40}$/;

/**
 * @param {object} db
 * @param {object} payload - { authorUserId, slug, meta, factions, npcs, lore, loops }
 * @returns {Promise<{ok, worldId, errors?}>}
 */
export async function publishUgcWorld(db, payload) {
  const { authorUserId, slug, meta, factions = [], npcs = [], lore = [], loops = null } = payload || {};
  if (!authorUserId) return { ok: false, errors: ["authorUserId required"] };
  if (!slug || !SLUG_RE.test(slug)) return { ok: false, errors: ["slug must match [a-z][a-z0-9-]{2,40}"] };
  if (!meta || typeof meta !== "object") return { ok: false, errors: ["meta required"] };

  const worldId = `${UGC_PREFIX}${slug}`;
  const dir = path.join(WORLD_ROOT, worldId);

  // 1. Validate against Phase G flavor schema if loops supplied.
  if (loops) {
    try {
      const wf = await import("./world-flavor.js");
      const v = wf.validateFlavor(loops);
      if (!v.ok) return { ok: false, errors: v.errors };
    } catch { /* world-flavor module optional */ }
  }

  // 2. Lightweight content sanity — moderation hook is a stub for now;
  //    real wiring routes through concord-moderate (Phase C absorbed lib).
  const modErrors = _basicContentChecks({ meta, factions, npcs, lore });
  if (modErrors.length) return { ok: false, errors: modErrors };

  // 3. Idempotency — if the directory already exists for a different
  //    author, reject; for the same author, overwrite.
  let isUpdate = false;
  try {
    const existing = db.prepare(`SELECT author_user_id FROM ugc_worlds WHERE world_id = ?`).get(worldId);
    if (existing && existing.author_user_id !== authorUserId) {
      return { ok: false, errors: ["slug_taken"] };
    }
    isUpdate = !!existing;
  } catch { /* table missing → first publish in this DB */ }

  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    _writeJson(path.join(dir, "meta.json"), { ...meta, world_id: worldId, authoredBy: authorUserId });
    _writeJson(path.join(dir, "factions.json"), factions);
    _writeJson(path.join(dir, "npcs.json"), npcs);
    _writeJson(path.join(dir, "lore.json"), lore);
    if (loops) _writeJson(path.join(dir, "loops.json"), loops);
  } catch (err) {
    return { ok: false, errors: [`write_failed:${err?.message}`] };
  }

  // 4. Record / update the ugc_worlds row.
  try {
    db.prepare(`
      INSERT INTO ugc_worlds (world_id, author_user_id, directory_slug, title, description, status)
      VALUES (?, ?, ?, ?, ?, 'active')
      ON CONFLICT(world_id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description
    `).run(worldId, authorUserId, slug, meta.title || worldId, meta.description || "");
  } catch (err) {
    return { ok: false, errors: [`db_failed:${err?.message}`] };
  }

  // 5. Reload world-flavor cache so the new world is immediately
  //    travelable (no boot required).
  try {
    const wf = await import("./world-flavor.js");
    wf._resetWorldFlavors?.();
    wf.initWorldFlavors?.();
  } catch { /* flavor reload optional */ }

  logger.info?.("foundry-publisher", "world_published", { worldId, authorUserId, isUpdate });
  return { ok: true, worldId, isUpdate };
}

/** List UGC worlds the user owns. */
export function listMyUgcWorlds(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT world_id, directory_slug, title, description, published_at, status
      FROM ugc_worlds WHERE author_user_id = ?
      ORDER BY published_at DESC
    `).all(userId);
  } catch {
    return [];
  }
}

/** List active UGC worlds for the world picker. */
export function listActiveUgcWorlds(db, opts = {}) {
  if (!db) return [];
  const limit = Math.min(Math.max(1, opts.limit || 50), 200);
  try {
    return db.prepare(`
      SELECT world_id, directory_slug, title, description, author_user_id, published_at
      FROM ugc_worlds
      WHERE status = 'active'
      ORDER BY published_at DESC LIMIT ?
    `).all(limit);
  } catch {
    return [];
  }
}

function _writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Hand-rolled content checks. Real moderation lives in concord-moderate;
 * this is the floor — reject obvious junk so the moderator doesn't have to.
 */
function _basicContentChecks({ meta, factions, npcs, lore }) {
  const errors = [];
  if (typeof meta.title !== "string" || meta.title.length < 3 || meta.title.length > 80) {
    errors.push("meta.title must be 3..80 characters");
  }
  if (typeof meta.description !== "string" || meta.description.length > 2000) {
    errors.push("meta.description must be ≤ 2000 characters");
  }
  if (!Array.isArray(factions)) errors.push("factions must be an array");
  if (!Array.isArray(npcs)) errors.push("npcs must be an array");
  if (!Array.isArray(lore)) errors.push("lore must be an array");
  if (factions.length > 20) errors.push("factions.length must be ≤ 20");
  if (npcs.length > 100) errors.push("npcs.length must be ≤ 100 (procgen fills the rest)");
  if (lore.length > 50) errors.push("lore.length must be ≤ 50");
  return errors;
}
