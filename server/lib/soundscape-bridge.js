// server/lib/soundscape-bridge.js
//
// v2.0 instantiation: community-uploaded music DTUs flow into Concordia
// district soundscapes. Reads music DTUs by tag overlap with the requested
// district (and optional universe), returns a playlist for the
// SoundscapeEngine to layer over its procedural ambient stems.
//
// Music DTUs may opt in to in-world play via tags. Recognised tags:
//   - 'soundscape'           — opted in (required)
//   - 'district:<name>'      — pin to a specific district
//   - 'concordia'            — pin to the Concordia universe (optional)
//   - 'mood:<name>'          — bias playback by mood (calm/intense/etc.)
//
// Privacy: music DTUs must have visibility != 'private' to surface here.
// Authors implicitly consent to in-world playback by adding 'soundscape'
// tag — we never auto-include private music.

// Per-district playlist cap. Default 100 with env override; soundscape
// engine cycles tracks one at a time so memory cost is the row metadata,
// not active audio.
const PLAYLIST_LIMIT = Number(process.env.CONCORD_PLAYLIST_LIMIT) || 100;

/**
 * Return a playlist of community music tracks for a district.
 * @param {object} db
 * @param {string} districtId  e.g. "plaza", "forge", "arena"
 * @param {object} [opts]
 * @param {string} [opts.universe]  e.g. "concordia"
 * @param {string} [opts.mood]      optional mood bias
 * @returns {{ tracks: Array<{ dtuId, title, ownerUserId, mood?, durationMs? }> }}
 */
export function getDistrictPlaylist(db, districtId, opts = {}) {
  if (!db) return { tracks: [] };
  if (!districtId || typeof districtId !== "string") return { tracks: [] };

  const districtTag = `district:${districtId.toLowerCase()}`;
  const moodTag = opts.mood ? `mood:${String(opts.mood).toLowerCase()}` : null;
  const universeTag = opts.universe ? String(opts.universe).toLowerCase() : null;

  // Pull recent soundscape-tagged music DTUs that mention this district.
  // We require both 'soundscape' (opt-in) and the district tag. Visibility
  // gate excludes private DTUs at the SQL layer.
  const rows = db.prepare(`
    SELECT id, owner_user_id, title, body_json, tags_json, created_at
    FROM dtus
    WHERE tags_json LIKE '%soundscape%'
      AND tags_json LIKE ?
      AND visibility != 'private'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(`%${districtTag}%`, PLAYLIST_LIMIT * 2); // overshoot, then filter in JS

  const tracks = [];
  for (const row of rows) {
    if (tracks.length >= PLAYLIST_LIMIT) break;
    let tags = [];
    try { tags = JSON.parse(row.tags_json || "[]"); } catch { /* ignore malformed */ }
    if (!Array.isArray(tags)) continue;
    if (!tags.includes("soundscape")) continue; // double-check; LIKE may match in body
    if (!tags.includes(districtTag)) continue;
    if (universeTag && !tags.includes(universeTag)) continue;

    let body = {};
    try { body = JSON.parse(row.body_json || "{}"); } catch { /* ignore */ }
    if (body?.type && body.type !== "music_track") continue;

    const mood = (tags.find((t) => typeof t === "string" && t.startsWith("mood:")) ?? "")
      .toString().slice(5) || null;

    if (moodTag && mood && `mood:${mood}` !== moodTag) continue;

    tracks.push({
      dtuId:        row.id,
      title:        row.title || "Untitled track",
      ownerUserId:  row.owner_user_id,
      mood,
      durationMs:   typeof body?.durationMs === "number" ? body.durationMs : null,
    });
  }

  return { tracks };
}
