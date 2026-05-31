// server/lib/social-gatherings.js
//
// Slice-of-Life SL5 — social gathering composer. The drama engine already
// GENERATES the relationships (courtship, family, grudges, grief); this surfaces
// them as the public beats players actually witness: a wedding pulls in the
// couple's partners + family + a grudge-holder for tension; a funeral assembles
// the bereaved + rivals and fires the npc-legacy grief path; a festival gathers
// a broad community sample. The composer is PURE (takes pre-fetched relations →
// attendee list + beats); a thin db-reader wraps it. Behind CONCORD_SOCIAL_EVENTS
// at the caller.

export const GATHERING_KINDS = Object.freeze(["wedding", "funeral", "festival"]);

const person = (name, role, id = null) => ({ id, name: String(name), role });

/**
 * Compose a gathering from the live relationship web.
 * @param {object} cfg
 * @param {'wedding'|'funeral'|'festival'} cfg.kind
 * @param {string} cfg.focalName            the celebrant / deceased / host
 * @param {string[]} [cfg.partners]         courtship/marriage partners
 * @param {string[]} [cfg.family]           kin
 * @param {string[]} [cfg.friends]          allies / friendly NPCs
 * @param {string[]} [cfg.grudgeHolders]    those who bear the focal a grudge
 * @returns {{ kind:string, attendees:object[], beats:string[], triggersGrief:boolean }}
 */
export function composeGathering(cfg = {}) {
  const kind = GATHERING_KINDS.includes(cfg.kind) ? cfg.kind : "festival";
  const focalName = String(cfg.focalName || "Someone");
  const partners = (cfg.partners || []).map(String);
  const family = (cfg.family || []).map(String);
  const friends = (cfg.friends || []).map(String);
  const grudgeHolders = (cfg.grudgeHolders || []).map(String);

  const attendees = [];
  const beats = [];
  let triggersGrief = false;

  if (kind === "wedding") {
    attendees.push(person(focalName, "celebrant"));
    partners.forEach((p) => attendees.push(person(p, "partner")));
    family.forEach((f) => attendees.push(person(f, "family")));
    friends.forEach((f) => attendees.push(person(f, "guest")));
    beats.push(`${focalName} exchanges vows`, "a toast to the union");
    // one grudge-holder attends for tension (the uninvited rival who came anyway)
    if (grudgeHolders.length) {
      attendees.push(person(grudgeHolders[0], "uninvited"));
      beats.push(`${grudgeHolders[0]} watches from the back, unsmiling`);
    } else {
      beats.push("the hall is warm with celebration");
    }
  } else if (kind === "funeral") {
    family.forEach((f) => attendees.push(person(f, "bereaved")));
    partners.forEach((p) => attendees.push(person(p, "bereaved")));
    friends.forEach((f) => attendees.push(person(f, "mourner")));
    // rivals come to confirm the death / make peace
    grudgeHolders.forEach((g) => attendees.push(person(g, "rival")));
    beats.push(`a eulogy for ${focalName}`, "the bereaved lay their tokens");
    if (grudgeHolders.length) beats.push(`${grudgeHolders[0]} lingers — old grudges outlive the dead`);
    triggersGrief = true; // caller fires npc-legacy onNpcDeath / grief path
  } else {
    // festival — a broad community sample (everyone the host knows)
    attendees.push(person(focalName, "host"));
    [...family, ...friends, ...partners].forEach((n) => attendees.push(person(n, "reveler")));
    beats.push(`${focalName} opens the festival`, "music and shared food", "the season turns");
  }

  // de-dupe attendees by name (a partner who is also family appears once)
  const seen = new Set();
  const unique = attendees.filter((a) => (seen.has(a.name) ? false : (seen.add(a.name), true)));

  return { kind, attendees: unique, beats, triggersGrief };
}

/** Best-effort NPC display name from world_npcs.state JSON, fallback to id. */
function _npcName(db, npcId) {
  if (!db || !npcId) return String(npcId || "an unknown");
  try {
    const row = db.prepare("SELECT state FROM world_npcs WHERE id = ?").get(npcId);
    if (row && row.state) {
      const st = typeof row.state === "string" ? JSON.parse(row.state) : row.state;
      if (st && st.name) return String(st.name);
    }
  } catch { /* state optional / unparseable */ }
  return String(npcId);
}

/**
 * SL5 — the thin db-reader that fetches the LIVE relationship web for a focal
 * entity and composes the gathering. Pure composeGathering does the shaping;
 * this resolves who attends from the real tables (npc_relationships,
 * player_courtship, npc_grudges). Best-effort + table-optional so it degrades
 * to a sparse-but-valid gathering rather than throwing. Behind
 * CONCORD_SOCIAL_EVENTS at the caller.
 *
 * @param {object} db
 * @param {object} cfg  { kind, focalKind:'npc'|'player', focalId }
 * @returns the composeGathering result (+ resolved focalId/focalKind echoed)
 */
export function gatherAttendees(db, cfg = {}) {
  const kind = GATHERING_KINDS.includes(cfg.kind) ? cfg.kind : "festival";
  const focalKind = cfg.focalKind === "player" ? "player" : "npc";
  const focalId = String(cfg.focalId || "");
  const partners = [];
  const family = [];
  const friends = [];
  const grudgeHolders = [];
  let focalName = focalId || "Someone";

  if (db && focalId) {
    if (focalKind === "npc") {
      focalName = _npcName(db, focalId);
      try {
        const rels = db.prepare(
          "SELECT related_id, rel_type, strength FROM npc_relationships WHERE npc_id = ?",
        ).all(focalId);
        for (const r of rels) {
          const nm = _npcName(db, r.related_id);
          if (r.rel_type === "spouse") partners.push(nm);
          else if (r.rel_type === "parent" || r.rel_type === "child" || r.rel_type === "sibling") family.push(nm);
          else if (r.rel_type === "friend" && Number(r.strength ?? 1) >= 0.5) friends.push(nm);
        }
      } catch { /* relationship graph optional */ }
      try {
        const holders = db.prepare(
          "SELECT DISTINCT npc_id FROM npc_grudges WHERE target_kind = 'npc' AND target_id = ? AND resolved_at IS NULL ORDER BY severity DESC LIMIT 5",
        ).all(focalId);
        for (const h of holders) grudgeHolders.push(_npcName(db, h.npc_id));
      } catch { /* grudges optional */ }
    } else {
      // player focal — resolve username + active courtship partners + grudge-holders
      try {
        const u = db.prepare("SELECT username FROM users WHERE id = ?").get(focalId);
        if (u && u.username) focalName = String(u.username);
      } catch { /* users optional */ }
      try {
        const ps = db.prepare(
          "SELECT partner_kind, partner_id, status FROM player_courtship WHERE player_user_id = ? AND status IN ('courting','engaged','married')",
        ).all(focalId);
        for (const p of ps) partners.push(p.partner_kind === "npc" ? _npcName(db, p.partner_id) : String(p.partner_id));
      } catch { /* courtship optional */ }
      try {
        const holders = db.prepare(
          "SELECT DISTINCT npc_id FROM npc_grudges WHERE target_kind = 'player' AND target_id = ? AND resolved_at IS NULL ORDER BY severity DESC LIMIT 5",
        ).all(focalId);
        for (const h of holders) grudgeHolders.push(_npcName(db, h.npc_id));
      } catch { /* grudges optional */ }
    }
  }

  const composed = composeGathering({ kind, focalName, partners, family, friends, grudgeHolders });
  return { ...composed, focalKind, focalId };
}
