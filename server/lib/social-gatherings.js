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
