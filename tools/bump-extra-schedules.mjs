// Phase F1.1 — bump the 59 Phase-E2 NPCs in npcs-extra.json from
// 1-3 block schedules to full 6-block schedules.
//
// Strategy: read the existing 1-3 blocks (which set the NPC's anchor
// locations) and fill missing phases with archetype-appropriate
// activities tied to the anchor locations.

import { readFileSync, writeFileSync } from "node:fs";

const DIRS = ["concord-link-frontier", "crime", "cyber", "fantasy", "lattice-crucible", "sovereign-ruins", "superhero", "concordia-hub"];
const FILES = ["npcs.json", "npcs-extra.json"];
const PHASES = ["Dominus", "Stratus", "Freeus", "Quartus", "Penanus", "Solnus"];
const PHASE_HOURS = { Dominus: [1, 4], Stratus: [5, 8], Freeus: [9, 12], Quartus: [13, 16], Penanus: [17, 20], Solnus: [21, 24] };

// Archetype activity templates by phase. Each maps to a verb + need.
// The script picks an unused location from the NPC's existing blocks
// (or falls back to a generic location string).
const ARCHETYPE_TEMPLATES = {
  warrior: {
    Dominus: { activity: "private dawn drill; sharpens his blade", need: "duty", interactable: false },
    Stratus: { activity: "morning patrol or war-council", need: "duty", interactable: true },
    Freeus:  { activity: "open drill; trains the war-band", need: "duty", interactable: true },
    Quartus: { activity: "afternoon command duties; coordinates with allies", need: "duty", interactable: false },
    Penanus: { activity: "evening hall; settles internal grievances", need: "duty", interactable: true },
    Solnus:  { activity: "reviews the day's reports; sleeps with the blade beside him", need: "duty", interactable: false },
  },
  warlord: {
    Dominus: { activity: "private war-vigil; speaks to no one", need: "rule", interactable: false },
    Stratus: { activity: "morning war-hall; receives the war captains", need: "rule", interactable: true },
    Freeus:  { activity: "inspects the levy; cohort training", need: "rule", interactable: true },
    Quartus: { activity: "war-council; coordinates with envoys", need: "rule", interactable: false },
    Penanus: { activity: "open supper; clan business", need: "rule", interactable: true },
    Solnus:  { activity: "private correspondence; sleeps lightly", need: "rule", interactable: false },
  },
  scholar: {
    Dominus: { activity: "early indexing pass; checks overnight work", need: "scholarship", interactable: false },
    Stratus: { activity: "opens the day; receives morning visitors", need: "scholarship", interactable: true },
    Freeus:  { activity: "research consultations; runs queries", need: "scholarship", interactable: true },
    Quartus: { activity: "private cataloguing; coordinates with peers", need: "scholarship", interactable: false },
    Penanus: { activity: "supper; reads correspondence", need: "scholarship", interactable: false },
    Solnus:  { activity: "personal study; writes reports", need: "scholarship", interactable: false },
  },
  guard: {
    Dominus: { activity: "rotates night-watch; checks the perimeter", need: "patrol", interactable: false },
    Stratus: { activity: "morning shift; secures the audience", need: "patrol", interactable: true },
    Freeus:  { activity: "open patrol; mediates disputes", need: "patrol", interactable: true },
    Quartus: { activity: "drills new recruits", need: "patrol", interactable: true },
    Penanus: { activity: "off-duty supper with the watch", need: "patrol", interactable: true },
    Solnus:  { activity: "sleeps; on call", need: "patrol", interactable: false },
  },
  healer: {
    Dominus: { activity: "tends the sick through the cold hours", need: "healing", interactable: false },
    Stratus: { activity: "morning clinic; treats the queue", need: "healing", interactable: true },
    Freeus:  { activity: "tends the herb beds and the recovering", need: "healing", interactable: true },
    Quartus: { activity: "afternoon clinic; receives supplies", need: "healing", interactable: true },
    Penanus: { activity: "private surgeries; teaches the apprentice", need: "healing", interactable: true },
    Solnus:  { activity: "sleeps; on emergency call", need: "healing", interactable: false },
  },
  trader: {
    Dominus: { activity: "checks the day's inventory; reviews ledgers", need: "trade", interactable: false },
    Stratus: { activity: "morning market intake; receives suppliers", need: "trade", interactable: true },
    Freeus:  { activity: "open shop; sells and negotiates", need: "trade", interactable: true },
    Quartus: { activity: "afternoon trade; private clients", need: "trade", interactable: true },
    Penanus: { activity: "supper with informants and partners", need: "trade", interactable: true },
    Solnus:  { activity: "reconciles the day; sleeps", need: "trade", interactable: false },
  },
  mystic: {
    Dominus: { activity: "moon-vigil at the holy place", need: "spirit_walk", interactable: false },
    Stratus: { activity: "morning meditation", need: "spirit_walk", interactable: false },
    Freeus:  { activity: "open audience; receives petitioners", need: "spirit_walk", interactable: true },
    Quartus: { activity: "spirit-walk along the sacred paths", need: "spirit_walk", interactable: false },
    Penanus: { activity: "evening audience; clan disputes", need: "spirit_walk", interactable: true },
    Solnus:  { activity: "private prayer; sleeps", need: "spirit_walk", interactable: false },
  },
  hunter: {
    Dominus: { activity: "dawn track-reading; checks last evening's prints", need: "tracking", interactable: false },
    Stratus: { activity: "morning patrol; scouts the perimeter", need: "tracking", interactable: false },
    Freeus:  { activity: "open hunt; gathers food and intel", need: "tracking", interactable: true },
    Quartus: { activity: "afternoon return; processes the take", need: "tracking", interactable: true },
    Penanus: { activity: "evening reports to the chief", need: "tracking", interactable: true },
    Solnus:  { activity: "sleeps; on alarm-call rotation", need: "tracking", interactable: false },
  },
  noble: {
    Dominus: { activity: "private dawn meditation; reviews family ledgers", need: "rule", interactable: false },
    Stratus: { activity: "morning court; receives advisors", need: "rule", interactable: true },
    Freeus:  { activity: "open audience; petitioners", need: "rule", interactable: true },
    Quartus: { activity: "private council with closest advisors", need: "rule", interactable: false },
    Penanus: { activity: "open supper with the court", need: "rule", interactable: true },
    Solnus:  { activity: "private correspondence; sleeps", need: "rule", interactable: false },
  },
  default: {
    Dominus: { activity: "private morning routine", need: "personal", interactable: false },
    Stratus: { activity: "morning errands and chores", need: "personal", interactable: true },
    Freeus:  { activity: "open day's work", need: "personal", interactable: true },
    Quartus: { activity: "afternoon focus on craft", need: "personal", interactable: true },
    Penanus: { activity: "evening supper and friends", need: "personal", interactable: true },
    Solnus:  { activity: "private rest; sleeps", need: "personal", interactable: false },
  },
};

let totalPatched = 0;
for (const dir of DIRS) {
  for (const file of FILES) {
    const path = `content/world/${dir}/${file}`;
    let arr;
    try { arr = JSON.parse(readFileSync(path, "utf8")); }
    catch { continue; } // file doesn't exist
  let dirPatched = 0;
  for (const npc of arr) {
    const existing = Array.isArray(npc.daily_schedule) ? npc.daily_schedule : [];
    const usedPhases = new Set(existing.map((b) => b.phase));
    if (existing.length >= 6 && PHASES.every((p) => usedPhases.has(p))) continue;

    // Resolve archetype templates (fall back to default).
    const arch = ARCHETYPE_TEMPLATES[npc.archetype] || ARCHETYPE_TEMPLATES.default;

    // Use the first non-public location from existing as the residence;
    // first public-facing location as the work location.
    const publicLoc = existing.find((b) => b.interactable_by_player)?.location;
    const privateLoc = existing.find((b) => !b.interactable_by_player)?.location;
    const fallbackLoc = existing[0]?.location || `${dir}_settlement_main`;
    const residence = privateLoc || existing[existing.length - 1]?.location || fallbackLoc;
    const workplace = publicLoc || fallbackLoc;

    const newBlocks = [...existing];
    for (const phase of PHASES) {
      if (usedPhases.has(phase)) continue;
      const tpl = arch[phase];
      // Pick location: morning/evening private → residence, midday → workplace.
      const loc = (phase === "Dominus" || phase === "Solnus") ? residence : workplace;
      newBlocks.push({
        phase,
        phase_hours: PHASE_HOURS[phase],
        location: loc,
        activity: tpl.activity,
        need_addressed: tpl.need,
        interactable_by_player: tpl.interactable,
      });
    }
    // Sort by phase order so the blocks are chronological.
    newBlocks.sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));
    npc.daily_schedule = newBlocks;
    dirPatched++;
  }
    writeFileSync(path, JSON.stringify(arr, null, 2) + "\n", "utf8");
    if (dirPatched > 0) console.log(`${dir}/${file}: patched ${dirPatched}/${arr.length}`);
    totalPatched += dirPatched;
  }
}
console.log("--- total patched:", totalPatched);
