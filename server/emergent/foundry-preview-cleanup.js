// server/emergent/foundry-preview-cleanup.js
//
// Foundry — preview-world cleanup heartbeat (Phase 5).
//
// foundry.preview mints throwaway `worlds` rows (status='preview') so
// ConcordiaScene can render a draft live. foundry.preview_end tears
// them down when the builder closes the panel — but a closed tab, a
// crash, or a lost connection leaves an orphan. This heartbeat sweeps
// preview rows whose created_at (refreshed on every foundry.preview
// call) is older than the TTL, and clears any dangling
// foundry_worlds.preview_world_id pointers.
//
// Registered in server.js via registerHeartbeat. Frequency is low
// (~1h) — preview rows are tiny and a short-lived orphan is harmless;
// this is housekeeping, not a hot path. Heartbeat-safe: always returns
// a plain { ok } object, never throws.

const PREVIEW_TTL_SECONDS = 2 * 60 * 60; // 2h — well past any real editing session

/**
 * @param {{ db: object }} ctx
 * @returns {{ ok: boolean, swept?: number, danglingCleared?: number, reason?: string }}
 */
export function runFoundryPreviewCleanup(ctx = {}) {
  const db = ctx && ctx.db;
  if (!db) return { ok: true, reason: "no_db" };

  try {
    const cutoff = Math.floor(Date.now() / 1000) - PREVIEW_TTL_SECONDS;

    // Sweep stale preview worlds.
    const stale = db.prepare(
      `SELECT id FROM worlds WHERE status = 'preview' AND created_at < ?`,
    ).all(cutoff);
    let swept = 0;
    if (stale.length) {
      const del = db.prepare(`DELETE FROM worlds WHERE id = ?`);
      for (const row of stale) { del.run(row.id); swept += 1; }
    }

    // Clear foundry_worlds.preview_world_id pointers that no longer
    // resolve to a live preview row (swept above, or gone any other way).
    let danglingCleared = 0;
    try {
      const r = db.prepare(`
        UPDATE foundry_worlds
        SET preview_world_id = NULL
        WHERE preview_world_id IS NOT NULL
          AND preview_world_id NOT IN (SELECT id FROM worlds WHERE status = 'preview')
      `).run();
      danglingCleared = r.changes || 0;
    } catch (_e) {
      // foundry_worlds may not exist in some minimal contexts — non-fatal.
    }

    return { ok: true, swept, danglingCleared };
  } catch (e) {
    return { ok: false, reason: "cleanup_failed", error: String(e?.message || e) };
  }
}

export const FOUNDRY_PREVIEW_CLEANUP_INTERNALS = Object.freeze({ PREVIEW_TTL_SECONDS });
